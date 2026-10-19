// Расчёты модуля «Автопарк» (чистые функции): периоды отчётов, нормы расхода с надбавками, плановое ТО,
// использование и простои, стоимость владения, сводные отчёты (ТЗ 4.2.6.2 Е, PR-FLT-049/050/054/094/101/118…131).
import type {
  FleetCostBreakdown, FleetDocument, FleetDriver, FleetDriverReportRow, FleetExpense, FleetExpenseKind, FleetFine, FleetFuel,
  FleetFuelTypeRow, FleetFuelUp, FleetPeriod, FleetPeriodType, FleetReport, FleetRunLog, FleetService, FleetServiceReportRow,
  FleetSettings, FleetStatusEvent, FleetTrip, FleetVehicle, FleetVehicleReportRow,
} from './types';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Период отчёта: месяц (2026-10), квартал (2026-Q4) или год (2026). */
export function fleetPeriod(type: FleetPeriodType, value: string): FleetPeriod {
  if (type === 'year') {
    const y = Number(value.slice(0, 4));
    return { type, value: String(y), from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (type === 'quarter') {
    const y = Number(value.slice(0, 4));
    const q = Math.min(4, Math.max(1, Number(value.match(/Q(\d)/)?.[1] ?? 1)));
    const m1 = (q - 1) * 3 + 1;
    return { type, value: `${y}-Q${q}`, from: `${y}-${pad(m1)}-01`, to: `${y}-${pad(m1 + 2)}-${lastDay(y, m1 + 2)}` };
  }
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7)) || 1;
  return { type: 'month', value: `${y}-${pad(m)}`, from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${lastDay(y, m)}` };
}

/** Текущий период заданного типа для даты (YYYY-MM-DD). */
export function fleetCurrentPeriod(type: FleetPeriodType, date: string): FleetPeriod {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  return fleetPeriod(type, type === 'year' ? y : type === 'quarter' ? `${y}-Q${Math.ceil(m / 3)}` : date.slice(0, 7));
}

/** Список периодов для выбора (последние N от даты). */
export function fleetPeriodOptions(type: FleetPeriodType, date: string, count = 12): FleetPeriod[] {
  const out: FleetPeriod[] = [];
  let y = Number(date.slice(0, 4));
  let m = Number(date.slice(5, 7));
  let q = Math.ceil(m / 3);
  for (let i = 0; i < count; i++) {
    if (type === 'month') {
      out.push(fleetPeriod('month', `${y}-${pad(m)}`));
      m--;
      if (m === 0) { m = 12; y--; }
    } else if (type === 'quarter') {
      out.push(fleetPeriod('quarter', `${y}-Q${q}`));
      q--;
      if (q === 0) { q = 4; y--; }
    } else {
      out.push(fleetPeriod('year', String(y)));
      y--;
    }
  }
  return out;
}

export const fleetDaysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export const fleetAddDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function fleetAddMonths(date: string, months: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + months;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12 + 1;
  const d = Math.min(Number(date.slice(8, 10)), lastDay(yy, mm));
  return `${yy}-${pad(mm)}-${pad(d)}`;
}

/** Зимний период для надбавки к норме: ноябрь–март. */
export const fleetIsWinter = (date: string): boolean => {
  const m = Number(date.slice(5, 7));
  return m >= 11 || m <= 3;
};

/** Нормативный расход: км/100 × норма × (1 + зимняя) × (1 + городская); для генератора — моточасы × норма × (1 + зимняя). */
export function fleetNormLitres(v: Pick<FleetVehicle, 'kind' | 'fuelNorm' | 'winterPct' | 'cityPct'>, distance: number, date: string, city = false): number {
  const base = v.kind === 'generator' ? distance * v.fuelNorm : (distance / 100) * v.fuelNorm;
  const k = (1 + (fleetIsWinter(date) ? v.winterPct : 0) / 100) * (1 + (city && v.kind !== 'generator' ? v.cityPct : 0) / 100);
  return Math.round(base * k * 10) / 10;
}

/** Фактический расход на 100 км (или на моточас) по путевому листу. */
export const fleetTripRate = (t: Pick<FleetTrip, 'odoStart' | 'odoEnd' | 'fuelUsed'>): number => {
  const km = (t.odoEnd ?? t.odoStart) - t.odoStart;
  return km > 0 && t.fuelUsed ? Math.round((t.fuelUsed / km) * 1000) / 10 : 0;
};

/** Отклонение от нормы, % (+ перерасход, − экономия). */
export const fleetDeviationPct = (used: number, norm: number): number => (norm > 0 ? Math.round(((used - norm) / norm) * 1000) / 10 : 0);

/** Плановое ТО: следующее по пробегу и по времени (что наступит раньше). */
export function fleetNextService(v: Pick<FleetVehicle, 'lastServiceKm' | 'serviceIntervalKm' | 'lastServiceDate' | 'serviceIntervalMonths'>): { km: number; date: string } {
  return { km: v.lastServiceKm + v.serviceIntervalKm, date: fleetAddMonths(v.lastServiceDate, v.serviceIntervalMonths) };
}

export const fleetServiceTotal = (s: Pick<FleetService, 'works' | 'parts'>): { works: number; parts: number; total: number } => {
  const works = s.works.reduce((a, w) => a + Math.round(w.cost), 0);
  const parts = s.parts.reduce((a, p) => a + Math.round(p.qty * p.price), 0);
  return { works, parts, total: works + parts };
};

/** Стоимость обслуживания для банка: гарантийный ремонт — 0. */
export const fleetServiceCost = (s: Pick<FleetService, 'works' | 'parts' | 'warranty'>): number => (s.warranty ? 0 : fleetServiceTotal(s).total);

/** Дни простоя (ремонт, техосмотр) в периоде по журналу статусов. */
export function fleetDowntimeDays(events: FleetStatusEvent[], vehicleId: string, from: string, to: string, today: string): number {
  const ev = events.filter((e) => e.vehicleId === vehicleId).sort((a, b) => a.at.localeCompare(b.at));
  const end = to < today ? to : today;
  if (end < from) return 0;
  let days = 0;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]!;
    if (e.to !== 'repair' && e.to !== 'inspection') continue;
    const s = e.at.slice(0, 10);
    const f = ev[i + 1] ? ev[i + 1]!.at.slice(0, 10) : end;
    const a = s > from ? s : from;
    const b = f < end ? f : end;
    if (b >= a) days += fleetDaysBetween(a, b);
  }
  return Math.min(days, fleetDaysBetween(from, end));
}

/** Дни, когда ТС было списано / в резерве / на списании (не входят в доступный фонд). */
function inactiveDays(events: FleetStatusEvent[], vehicleId: string, from: string, end: string): number {
  const ev = events.filter((e) => e.vehicleId === vehicleId).sort((a, b) => a.at.localeCompare(b.at));
  let days = 0;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]!;
    if (!['reserve', 'written_off', 'writeoff_pending'].includes(e.to)) continue;
    const s = e.at.slice(0, 10);
    const f = ev[i + 1] ? ev[i + 1]!.at.slice(0, 10) : end;
    const a = s > from ? s : from;
    const b = f < end ? f : end;
    if (b >= a) days += fleetDaysBetween(a, b);
  }
  return days;
}

export interface FleetDataSnapshot {
  vehicles: FleetVehicle[];
  drivers: FleetDriver[];
  trips: FleetTrip[];
  runLogs: FleetRunLog[];
  fuelUps: FleetFuelUp[];
  services: FleetService[];
  expenses: FleetExpense[];
  fines: FleetFine[];
  documents: FleetDocument[];
  statusEvents: FleetStatusEvent[];
  settings: FleetSettings;
  contractorName: (id?: string) => string;
}

const inRange = (d: string | undefined, from: string, to: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;

export function fleetEmptyCosts(): FleetCostBreakdown {
  return { fuel: 0, maintenance: 0, repair: 0, insurance: 0, other: 0, fines: 0, total: 0 };
}

/** Расходы по ТС за период (по категориям). */
export function fleetVehicleCosts(s: FleetDataSnapshot, vehicleId: string, from: string, to: string): FleetCostBreakdown {
  const c = fleetEmptyCosts();
  c.fuel = s.fuelUps.filter((f) => f.vehicleId === vehicleId && inRange(f.date, from, to)).reduce((a, f) => a + f.amount, 0);
  for (const sv of s.services.filter((x) => x.vehicleId === vehicleId && x.status === 'done' && inRange(x.doneDate ?? x.date, from, to))) {
    if (sv.kind === 'maintenance') c.maintenance += fleetServiceCost(sv);
    else c.repair += fleetServiceCost(sv);
  }
  c.insurance = s.documents.filter((d) => d.vehicleId === vehicleId && (d.type === 'osago' || d.type === 'kasko') && inRange(d.validFrom, from, to)).reduce((a, d) => a + d.cost, 0);
  c.other = s.expenses.filter((e) => e.vehicleId === vehicleId && inRange(e.date, from, to)).reduce((a, e) => a + e.amount, 0);
  c.fines = s.fines.filter((f) => f.vehicleId === vehicleId && f.status !== 'cancelled' && inRange(f.date, from, to)).reduce((a, f) => a + f.amount, 0);
  c.total = c.fuel + c.maintenance + c.repair + c.insurance + c.other + c.fines;
  return c;
}

/** Средняя цена литра по заправкам за период (или справочная). */
export function fleetAvgPrice(s: FleetDataSnapshot, fuel: FleetFuel, from?: string, to?: string): number {
  const list = s.fuelUps.filter((f) => f.fuel === fuel && (!from || !to || inRange(f.date, from, to)));
  const l = list.reduce((a, f) => a + f.litres, 0);
  return l > 0 ? Math.round(list.reduce((a, f) => a + f.amount, 0) / l) : s.settings.fuelPrices[fuel];
}

export function fleetVehicleRow(s: FleetDataSnapshot, v: FleetVehicle, p: FleetPeriod, today: string): FleetVehicleReportRow {
  const costs = fleetVehicleCosts(s, v.id, p.from, p.to);
  const trips = s.trips.filter((t) => t.vehicleId === v.id && t.status === 'closed' && inRange(t.date, p.from, p.to));
  const logs = s.runLogs.filter((r) => r.vehicleId === v.id && inRange(r.date, p.from, p.to));
  const km = v.kind === 'generator' ? logs.reduce((a, r) => a + (r.hoursEnd - r.hoursStart), 0) : trips.reduce((a, t) => a + ((t.odoEnd ?? t.odoStart) - t.odoStart), 0);
  const usedLitres = Math.round((v.kind === 'generator' ? logs.reduce((a, r) => a + r.fuelUsed, 0) : trips.reduce((a, t) => a + (t.fuelUsed ?? 0), 0)) * 10) / 10;
  const normLitres = Math.round((v.kind === 'generator' ? logs.reduce((a, r) => a + r.fuelNormUsed, 0) : trips.reduce((a, t) => a + (t.fuelNormUsed ?? 0), 0)) * 10) / 10;
  const fuelLitres = Math.round(s.fuelUps.filter((f) => f.vehicleId === v.id && inRange(f.date, p.from, p.to)).reduce((a, f) => a + f.litres, 0) * 10) / 10;
  const end = p.to < today ? p.to : today;
  const days = end >= p.from ? fleetDaysBetween(p.from, end) : 0;
  const created = v.createdAt > p.from ? v.createdAt : p.from;
  const inactive = days ? inactiveDays(s.statusEvents, v.id, created, end) + (created > p.from ? fleetDaysBetween(p.from, created) - 1 : 0) : 0;
  const downtimeDays = days ? fleetDowntimeDays(s.statusEvents, v.id, p.from, p.to, today) : 0;
  const usedSet = new Set((v.kind === 'generator' ? logs.map((r) => r.date) : trips.map((t) => t.date)).filter((d) => d <= end));
  const usedDays = usedSet.size;
  const available = Math.max(0, days - downtimeDays - inactive);
  const idleDays = Math.max(0, available - usedDays);
  const months = p.type === 'year' ? 12 : p.type === 'quarter' ? 3 : 1;
  // одометр на начало/конец периода: по путевым листам, иначе текущий
  const allClosed = s.trips.filter((t) => t.vehicleId === v.id && t.status === 'closed').sort((a, b) => a.odoStart - b.odoStart);
  const before = allClosed.filter((t) => t.date < p.from);
  const odoStart = (trips.length ? Math.min(...trips.map((t) => t.odoStart)) : undefined) ?? (before.length ? before[before.length - 1]!.odoEnd ?? v.mileage : v.mileage - km);
  const odoEnd = odoStart + km;
  const price = fleetAvgPrice(s, v.fuel, p.from, p.to);
  return {
    vehicleId: v.id,
    plate: v.plate,
    model: `${v.brand} ${v.model}`,
    kind: v.kind,
    fuelType: v.fuel,
    costCenterKey: v.costCenterKey,
    ...costs,
    km,
    trips: v.kind === 'generator' ? logs.length : trips.length,
    fuelLitres,
    normLitres,
    usedLitres,
    deviationSum: Math.round((usedLitres - normLitres) * price),
    limitLitres: v.limitLitres * months,
    limitSum: v.limitSum * months,
    odoStart,
    odoEnd,
    days,
    usedDays,
    downtimeDays,
    idleDays,
    utilizationPct: available > 0 ? Math.round((usedDays / available) * 1000) / 10 : 0,
    costPerKm: km > 0 ? Math.round(costs.total / km) : 0,
  };
}

/** Сводный отчёт автопарка за период (все разрезы). */
export function fleetBuildReport(s: FleetDataSnapshot, p: FleetPeriod, today: string): FleetReport {
  const active = s.vehicles.filter((v) => v.createdAt <= p.to);
  const vehicles = active.map((v) => fleetVehicleRow(s, v, p, today));
  // по водителям
  const drivers: FleetDriverReportRow[] = s.drivers.map((d) => {
    const trips = s.trips.filter((t) => t.driverId === d.id && t.status === 'closed' && inRange(t.date, p.from, p.to));
    const used = trips.reduce((a, t) => a + (t.fuelUsed ?? 0), 0);
    const norm = trips.reduce((a, t) => a + (t.fuelNormUsed ?? 0), 0);
    const over = trips.reduce((a, t) => a + Math.max(0, (t.fuelUsed ?? 0) - (t.fuelNormUsed ?? 0)), 0);
    const save = trips.reduce((a, t) => a + Math.max(0, (t.fuelNormUsed ?? 0) - (t.fuelUsed ?? 0)), 0);
    const priceOf = (t: FleetTrip) => fleetAvgPrice(s, s.vehicles.find((v) => v.id === t.vehicleId)?.fuel ?? 'petrol', p.from, p.to);
    const overSum = trips.reduce((a, t) => a + Math.max(0, (t.fuelUsed ?? 0) - (t.fuelNormUsed ?? 0)) * priceOf(t), 0);
    const saveSum = trips.reduce((a, t) => a + Math.max(0, (t.fuelNormUsed ?? 0) - (t.fuelUsed ?? 0)) * priceOf(t), 0);
    const fuelSum = s.fuelUps.filter((f) => f.driverId === d.id && inRange(f.date, p.from, p.to)).reduce((a, f) => a + f.amount, 0);
    const fines = s.fines.filter((f) => f.driverId === d.id && f.status !== 'cancelled' && inRange(f.date, p.from, p.to));
    const exp = s.expenses.filter((e) => e.driverId === d.id && inRange(e.date, p.from, p.to)).reduce((a, e) => a + e.amount, 0);
    const finesSum = fines.reduce((a, f) => a + f.amount, 0);
    return {
      driverId: d.id,
      name: d.fullName,
      trips: trips.length,
      km: trips.reduce((a, t) => a + ((t.odoEnd ?? t.odoStart) - t.odoStart), 0),
      usedLitres: Math.round(used * 10) / 10,
      normLitres: Math.round(norm * 10) / 10,
      overrunLitres: Math.round(over * 10) / 10,
      savingLitres: Math.round(save * 10) / 10,
      overrunSum: Math.round(overSum),
      savingSum: Math.round(saveSum),
      fuelSum,
      fines: finesSum,
      finesCount: fines.length,
      expenses: fuelSum + finesSum + exp,
    };
  });
  // по видам топлива
  const fuelMap = new Map<FleetFuel, FleetFuelTypeRow>();
  for (const f of s.fuelUps.filter((x) => inRange(x.date, p.from, p.to))) {
    const r = fuelMap.get(f.fuel) ?? { fuel: f.fuel, litres: 0, amount: 0, vehicles: 0 };
    r.litres = Math.round((r.litres + f.litres) * 10) / 10;
    r.amount += f.amount;
    fuelMap.set(f.fuel, r);
  }
  for (const r of fuelMap.values()) r.vehicles = new Set(s.fuelUps.filter((x) => x.fuel === r.fuel && inRange(x.date, p.from, p.to)).map((x) => x.vehicleId)).size;
  // ТО и ремонт
  const plate = (id: string) => s.vehicles.find((v) => v.id === id)?.plate ?? id;
  const services: FleetServiceReportRow[] = s.services
    .filter((x) => x.status !== 'cancelled' && inRange(x.doneDate ?? x.date, p.from, p.to))
    .map((x) => {
      const t = fleetServiceTotal(x);
      return { serviceId: x.id, number: x.number, vehicleId: x.vehicleId, plate: plate(x.vehicleId), kind: x.kind, date: x.doneDate ?? x.date, contractor: s.contractorName(x.contractorId), warranty: x.warranty, works: t.works, parts: t.parts, total: t.total, status: x.status };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const otherByKind = { wash: 0, parking: 0, tires: 0, accessories: 0, other: 0 } as Record<FleetExpenseKind, number>;
  for (const e of s.expenses.filter((x) => inRange(x.date, p.from, p.to))) otherByKind[e.kind] += e.amount;
  const sum = (k: keyof FleetVehicleReportRow) => vehicles.reduce((a, r) => a + (r[k] as number), 0);
  return {
    period: p,
    vehicles,
    drivers,
    fuelTypes: [...fuelMap.values()].sort((a, b) => b.amount - a.amount),
    services,
    otherByKind,
    totals: {
      fuel: sum('fuel'),
      maintenance: sum('maintenance'),
      repair: sum('repair'),
      insurance: sum('insurance'),
      other: sum('other'),
      fines: sum('fines'),
      total: sum('total'),
      km: vehicles.filter((v) => v.kind === 'vehicle').reduce((a, r) => a + r.km, 0),
      fuelLitres: Math.round(sum('fuelLitres') * 10) / 10,
      usedLitres: Math.round(sum('usedLitres') * 10) / 10,
      normLitres: Math.round(sum('normLitres') * 10) / 10,
    },
  };
}
