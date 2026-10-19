// API модуля «Автопарк» (ТЗ 4.2.6): реестр ТС и генераторов, водители, закрепления (распоряжения + акты),
// путевые листы в два шага (открытие с подписью диспетчера, закрытие с одометром/топливом), ГСМ и лимиты,
// топливные карты (зачисление через iABS, транзакции процессинга), ТО и ремонт, страхование, прочие расходы,
// штрафы УБДД, проводки в iABS, предупреждения о сроках, отчёты и дашборд.
import { clone, delay, emit, nextId, nextNumber, now, today } from '../../bus';
import { matches, registerSearchProvider } from '../../search';
import { approvalEngine } from '../../engine';
import { audit, diffFields } from '../../audit';
import { can, registerModuleAccess } from '../../security';
import { directory } from '../../directory';
import { notify } from '../../notifications';
import { orgApi } from '../../org';
import { integrationHub } from '../../services/integrations';
import { importRegistry, type ImportValue } from '../../services/importer';
import { api } from '../../api';
import { assetsApi, onAssetEvent } from '../assets';
import type { HistoryEvent, ID, User } from '../../types';
import {
  fleetAssignmentsSeed, fleetCardsSeed, fleetDocumentsSeed, fleetDriversSeed, fleetExpensesSeed, fleetFaultsSeed, fleetFinesSeed,
  fleetFuelUpsSeed, fleetRunLogsSeed, fleetServicesSeed, fleetSettingsSeed, fleetStatusEventsSeed, fleetTopUpsSeed, fleetTripsSeed, fleetVehiclesSeed,
} from './data';
import {
  fleetAddDays, fleetBuildReport, fleetCurrentPeriod, fleetDeviationPct, fleetNextService, fleetNormLitres, fleetServiceCost, fleetServiceTotal,
  fleetVehicleRow, type FleetDataSnapshot,
} from './calc';
import type {
  FleetAlert, FleetAssignment, FleetAssignmentInput, FleetChecklistItem, FleetDashboard, FleetDocType, FleetDocument, FleetDocumentInput, FleetDriver,
  FleetDriverInput, FleetExpense, FleetExpenseInput, FleetFaultReport, FleetFine, FleetFineInput, FleetFineStatus, FleetFuelCard, FleetFuelUp,
  FleetFuelUpInput, FleetKind, FleetPeriod, FleetPosting, FleetPostingSource, FleetPurpose, FleetReport, FleetRunLog, FleetService, FleetServiceInput,
  FleetSettings, FleetStats, FleetStatus, FleetStatusEvent, FleetTopUp, FleetTopUpLine, FleetTrip, FleetTripCloseInput, FleetTripInput, FleetTripStatus,
  FleetVehicle, FleetVehicleInput, FleetVehicleReportRow, FleetVehicleType, FleetVehicleView, FleetWorkLine, FleetPartLine, FleetWriteoffInput,
} from './types';

export { fleetTripRate } from './calc';

// ---------------------------------------------------------------------------------------------
// Состояние (in-memory)

const vehicles = clone(fleetVehiclesSeed);
const drivers = clone(fleetDriversSeed);
const documents = clone(fleetDocumentsSeed);
const trips = clone(fleetTripsSeed);
const runLogs = clone(fleetRunLogsSeed);
const fuelUps = clone(fleetFuelUpsSeed);
const cards = clone(fleetCardsSeed);
const topUps = clone(fleetTopUpsSeed);
const services = clone(fleetServicesSeed);
const faults = clone(fleetFaultsSeed);
const expenses = clone(fleetExpensesSeed);
const fines = clone(fleetFinesSeed);
const assignments = clone(fleetAssignmentsSeed);
const statusEvents = clone(fleetStatusEventsSeed);
const postings: FleetPosting[] = [];
let settings: FleetSettings = clone(fleetSettingsSeed);

/** Сведения о связанных карточках ОС (обновляются при чтении — модуль «Основные средства»). */
const assetCache = new Map<ID, { inventoryNo: string; nbv: number; status: string }>();

// ---------------------------------------------------------------------------------------------
// Ошибки и права

export type FleetErrorCode =
  | 'forbidden' | 'required' | 'not_found' | 'not_allowed' | 'plate_dup' | 'vin' | 'year' | 'norm' | 'amount' | 'odometer' | 'date' | 'time'
  | 'fuel' | 'fuel_type' | 'fuel_balance' | 'driver_license' | 'driver_medical' | 'driver_inactive' | 'driver_not_assigned' | 'doc_expired'
  | 'vehicle_busy' | 'vehicle_unavailable' | 'over_limit' | 'overrun_reason' | 'card' | 'card_balance' | 'card_limit' | 'no_lines'
  | 'return_before_depart' | 'cost_center' | 'org_unit' | 'generator_only' | 'vehicle_only' | 'duplicate_pending' | 'same_driver' | 'asset' | 'valid_until'
  | 'driver_category';

export class FleetError extends Error {
  constructor(public code: FleetErrorCode, public detail?: string) {
    super(`fleet: ${code}${detail ? ` (${detail})` : ''}`);
  }
}

// Права на модуль по умолчанию (поверх OVERRIDES ядра: руководитель — edit, водитель — view, админ — admin):
// бизнес-роли — просмотр; кадры (приказ о закреплении), аналитик (отчёты), согласующий, кладовщик — просмотр.
registerModuleAccess('fleet', {
  employee: 'view', procurement: 'view', finance: 'view', legal: 'view', accountant: 'view', treasury: 'view', auditor: 'view',
  hr: 'view', analyst: 'view', approver: 'view', storekeeper: 'view',
});
// Проводки автопарка — бухгалтерия (отдельный раздел матрицы прав; администратор — всегда).
registerModuleAccess('fleet-posting', { accountant: 'edit', finance: 'view', auditor: 'view', dept_head: 'view' });

/** Управление автопарком (карточки, путевые листы, расходы) — право «изменение» на модуль. */
export const fleetCanManage = (user: User | null | undefined): boolean => can(user, 'fleet', 'edit');
/** Совместимость со старым API экрана. */
export const canManageFleet = fleetCanManage;
/** Отправка проводок в iABS — бухгалтерия. */
export const fleetCanPost = (user: User | null | undefined): boolean => can(user, 'fleet-posting', 'edit');

const driverOfUser = (userId: ID | undefined): FleetDriver | undefined => (userId ? drivers.find((d) => d.userId === userId && d.active) : undefined);
/** Водитель, связанный с учётной записью (самообслуживание: «мой автомобиль», «мои путевые листы»). */
export const fleetDriverOf = (user: User | null | undefined): FleetDriver | undefined => driverOfUser(user?.id);

const isVehicleDriver = (user: User, v: FleetVehicle): boolean => {
  const d = driverOfUser(user.id);
  return !!d && (v.primaryDriverId === d.id || v.reserveDriverId === d.id);
};

function guardManage(user: User): void {
  if (!fleetCanManage(user)) throw new FleetError('forbidden');
}

const byId = <T extends { id: ID }>(list: T[], id: ID | undefined): T | undefined => (id ? list.find((x) => x.id === id) : undefined);
function vehicleOr404(id: ID): FleetVehicle {
  const v = byId(vehicles, id);
  if (!v) throw new FleetError('not_found');
  return v;
}

/** Категория водительского удостоверения, требуемая для типа ТС (легковой — B, грузовой / спецтранспорт — C, автобус — D). */
export const FLEET_LICENSE_CATEGORY: Record<FleetVehicleType, string | undefined> = { car: 'B', truck: 'C', special: 'C', bus: 'D', generator: undefined };
function checkCategory(d: FleetDriver, v: FleetVehicle): void {
  const need = FLEET_LICENSE_CATEGORY[v.vehicleType];
  if (need && !d.licenseCategories.includes(need)) throw new FleetError('driver_category', need);
}

const isInt = (n: number) => Number.isFinite(n) && Number.isInteger(n);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const normPlate = (p: string) => p.replace(/\s+/g, '').toUpperCase();
const actor = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });
const ev = (userId: ID, action: HistoryEvent['action'], comment?: string): HistoryEvent => ({ at: now(), userId, action, ...(comment ? { comment } : {}) });

// ---------------------------------------------------------------------------------------------
// Справочные вычисления

const activeDoc = (vehicleId: ID, type: FleetDocType): FleetDocument | undefined =>
  documents.filter((d) => d.vehicleId === vehicleId && d.type === type && d.status === 'active').sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];

const openTripOf = (vehicleId: ID): FleetTrip | undefined => trips.find((t) => t.vehicleId === vehicleId && t.status === 'open');
const driverName = (id: ID | undefined) => byId(drivers, id)?.fullName;

function toView(v: FleetVehicle): FleetVehicleView {
  const open = openTripOf(v.id);
  const pending = trips.find((t) => t.vehicleId === v.id && (t.status === 'pending' || t.status === 'returned'));
  const next = fleetNextService(v);
  const asset = v.assetId ? assetCache.get(v.assetId) : undefined;
  const dn = driverName(v.primaryDriverId);
  const rn = driverName(v.reserveDriverId);
  const ins = activeDoc(v.id, 'osago')?.validUntil;
  const insp = activeDoc(v.id, 'inspection')?.validUntil;
  const tp = activeDoc(v.id, 'tech_passport')?.validUntil;
  return {
    ...v,
    onTrip: !!open,
    ...(open ? { openTripId: open.id } : {}),
    ...(pending ? { pendingTripId: pending.id } : {}),
    ...(ins ? { insuranceUntil: ins } : {}),
    ...(insp ? { inspectionUntil: insp } : {}),
    ...(tp ? { techPassportUntil: tp } : {}),
    nextServiceKm: next.km,
    nextServiceDate: next.date,
    balanceValue: asset ? asset.nbv : v.bookValue,
    ...(asset ? { assetInventoryNo: asset.inventoryNo } : {}),
    ...(dn ? { driverName: dn } : {}),
    ...(rn ? { reserveDriverName: rn } : {}),
  };
}

function setStatusInternal(v: FleetVehicle, to: FleetStatus, userId: ID, reason?: string): void {
  if (v.status === to) return;
  statusEvents.push({ id: nextId('fse'), vehicleId: v.id, from: v.status, to, at: now(), userId, ...(reason ? { reason } : {}) });
  v.status = to;
}

/** Ответственные за ТС: администраторы и руководитель закреплённого подразделения. */
function managersFor(orgUnitKey: string | undefined): ID[] {
  const head = directory.headOf(orgUnitKey);
  return [...new Set([...directory.admins().map((u) => u.id), ...(head ? [head.id] : []), ...(directory.headOf('d2') ? [directory.headOf('d2')!.id] : [])])];
}

let contractors = new Map<ID, string>();
async function loadContractors(): Promise<void> {
  contractors = new Map((await api.listCounterparties()).map((c) => [c.id, c.name]));
}

function snapshot(): FleetDataSnapshot {
  return {
    vehicles, drivers, trips, runLogs, fuelUps, services, expenses, fines, documents, statusEvents, settings,
    contractorName: (id) => (id ? contractors.get(id) ?? id : ''),
  };
}

/** Использование месячного лимита топлива ТС. */
function limitUsage(vehicleId: ID, month: string, extra = { litres: 0, amount: 0 }) {
  const list = fuelUps.filter((f) => f.vehicleId === vehicleId && f.date.startsWith(month));
  return {
    litres: Math.round((list.reduce((a, f) => a + f.litres, 0) + extra.litres) * 10) / 10,
    amount: list.reduce((a, f) => a + f.amount, 0) + extra.amount,
  };
}

// ---------------------------------------------------------------------------------------------
// Проводки (PR-FLT-052, 059, 068, 076, 083): Дт счёт затрат / Кт расчёты. Счета — демо (8 цифр, формат iABS).

export const FLEET_ACCOUNTS: Record<FleetPostingSource, { debit: string; credit: string }> = {
  fuel: { debit: '56811000', credit: '29896000' },
  maintenance: { debit: '56812000', credit: '29896000' },
  repair: { debit: '56813000', credit: '29896000' },
  insurance: { debit: '56814000', credit: '29896000' },
  other: { debit: '56815000', credit: '29896000' },
  fine: { debit: '56816000', credit: '29896000' },
  topup: { debit: '22602000', credit: '16103000' },
};
/** Счёт корпоративных топливных карт (Кт при заправке по карте). */
export const FLEET_CARD_ACCOUNT = '22602000';

function addPosting(source: FleetPostingSource, sourceId: ID, sourceNumber: string, vehicleId: ID, costCenterKey: string, amount: number, date: string, description: string, opts: { credit?: string; status?: FleetPosting['status']; batch?: string } = {}): FleetPosting | undefined {
  if (!(amount > 0)) return undefined;
  const acc = FLEET_ACCOUNTS[source];
  const p: FleetPosting = {
    id: nextId('fp'),
    number: nextNumber('FP'),
    date,
    source,
    sourceId,
    sourceNumber,
    vehicleId,
    costCenterKey,
    debit: acc.debit,
    credit: opts.credit ?? acc.credit,
    amount: Math.round(amount),
    description,
    status: opts.status ?? 'draft',
    ...(opts.batch ? { batch: opts.batch, postedAt: `${date}T18:00:00Z` } : {}),
  };
  postings.push(p);
  return p;
}

// Демо-проводки по засеянным операциям: сентябрь — проведены в iABS, октябрь — сформированы (ждут отправки).
(function seedPostings() {
  const st = (d: string) => (d < '2026-10-01' ? { status: 'posted' as const, batch: 'PK-2026-0930-FL' } : {});
  const plate = (id: ID) => byId(vehicles, id)?.plate ?? '';
  for (const f of fuelUps) addPosting('fuel', f.id, f.number, f.vehicleId, f.costCenterKey, f.amount, f.date, `ГСМ ${plate(f.vehicleId)}: ${f.litres} л, ${f.station}`, { ...(f.cardId ? { credit: FLEET_CARD_ACCOUNT } : {}), ...st(f.date) });
  for (const s of services.filter((x) => x.status === 'done')) addPosting(s.kind === 'maintenance' ? 'maintenance' : 'repair', s.id, s.number, s.vehicleId, s.costCenterKey, fleetServiceCost(s), s.doneDate ?? s.date, `${s.kind === 'maintenance' ? 'ТО' : 'Ремонт'} ${plate(s.vehicleId)}: ${s.fault}`, st(s.doneDate ?? s.date));
  for (const d of documents.filter((x) => (x.type === 'osago' || x.type === 'kasko') && x.validFrom >= '2026-01-01')) addPosting('insurance', d.id, d.number, d.vehicleId, byId(vehicles, d.vehicleId)?.costCenterKey ?? '', d.cost, d.validFrom, `${d.type === 'osago' ? 'ОСАГО' : 'КАСКО'} ${plate(d.vehicleId)}: ${d.number}`, st(d.validFrom));
  for (const e of expenses) addPosting('other', e.id, e.number, e.vehicleId, e.costCenterKey, e.amount, e.date, `${e.description} (${plate(e.vehicleId)})`, st(e.date));
  for (const f of fines.filter((x) => x.status === 'paid')) addPosting('fine', f.id, f.protocolNo, f.vehicleId, f.costCenterKey, f.amount, f.paidAt ?? f.date, `Штраф ${plate(f.vehicleId)}: ${f.violation}`, st(f.paidAt ?? f.date));
})();

// ---------------------------------------------------------------------------------------------
// Интеграции: операция процессинга топливных карт регистрируется в шине (система «Платёжные системы»).

(function registerFuelCardOperation() {
  const sys = integrationHub.systems.find((s) => s.id === 'payments');
  if (!sys || sys.operations.some((o) => o.id === 'fuelcard.transactions')) return;
  if (!sys.modules.includes('fleet')) sys.modules.push('fleet');
  sys.operations.push({
    id: 'fuelcard.transactions',
    direction: 'in',
    schemaVersion: '1.0',
    name: { ru: 'Транзакции топливных карт', uz: "Yoqilg'i kartalari tranzaksiyalari", en: 'Fuel card transactions' },
    sample: () => ({ cards: [{ card: '8600••••4411', fuel: 'petrol', price: 10_500 }], since: '2026-10-01' }),
    validate: (p) => (Array.isArray(p.cards) && p.cards.length ? null : { code: 'validation', message: 'cards: empty list' }),
    count: (p) => (Array.isArray(p.cards) ? p.cards.length : 0),
    respond: (p, rnd) => {
      const list = Array.isArray(p.cards) ? (p.cards as { card: string; fuel: string; price: number; station?: string }[]) : [];
      return {
        transactions: list.map((c, i) => {
          const litres = Math.round(20 + rnd() * 30);
          return { id: `TX-${Date.now().toString(36)}-${i}`, card: c.card, litres, amount: Math.round(litres * c.price), station: c.station ?? 'АЗС №12, Юнусабад (демо)' };
        }),
      };
    },
  });
})();

// ---------------------------------------------------------------------------------------------
// Согласования: путевой лист (подпись диспетчера), распоряжение о закреплении, зачисление на карты.

approvalEngine.register('fleet_trip', {
  onHistory: (id, e) => {
    const t = byId(trips, id);
    if (!t) return;
    t.history.push(e);
    if (e.action === 'approved') {
      t.dispatcherId = e.onBehalfOf ?? e.userId;
      t.dispatchedAt = e.at;
    }
  },
  onFinal: (id, approved) => {
    const t = byId(trips, id);
    if (!t) return;
    t.status = approved ? 'open' : 'rejected';
    const d = byId(drivers, t.driverId);
    const v = byId(vehicles, t.vehicleId);
    notify({
      userIds: [...new Set([t.createdBy, ...(d?.userId ? [d.userId] : [])])],
      title: { key: approved ? 'fleet_n_tripOpened' : 'fleet_n_tripRejected', params: { number: t.number } },
      body: `${v?.plate ?? ''} · ${t.routeFrom} → ${t.routeTo}`,
      link: `/fleet/trips/${t.id}`,
      level: approved ? 'success' : 'danger',
      kind: approved ? 'approved' : 'rejected',
    });
  },
  onReturned: (id) => {
    const t = byId(trips, id);
    if (t) t.status = 'returned';
  },
  onResubmitted: (id) => {
    const t = byId(trips, id);
    if (t) t.status = 'pending';
  },
  getContext: (id) => {
    const t = byId(trips, id);
    const v = t ? byId(vehicles, t.vehicleId) : undefined;
    return v ? { subtype: v.purpose, orgUnitKey: v.orgUnitKey } : undefined;
  },
});

approvalEngine.register('fleet_assignment', {
  onHistory: (id, e) => byId(assignments, id)?.history.push(e),
  onFinal: (id, approved) => {
    const a = byId(assignments, id);
    if (!a) return;
    a.status = approved ? 'approved' : 'rejected';
    const v = byId(vehicles, a.vehicleId);
    notify({
      userIds: [a.createdBy],
      title: { key: approved ? 'fleet_n_assignmentApproved' : 'fleet_n_assignmentRejected', params: { number: a.number } },
      body: `${v?.plate ?? ''} → ${driverName(a.driverId) ?? ''}`,
      link: `/fleet/assignments/${a.id}`,
      level: approved ? 'success' : 'danger',
      kind: approved ? 'approved' : 'rejected',
    });
  },
  onReturned: (id) => {
    const a = byId(assignments, id);
    if (a) a.status = 'returned';
  },
  onResubmitted: (id) => {
    const a = byId(assignments, id);
    if (a) a.status = 'pending';
  },
  getContext: (id) => {
    const a = byId(assignments, id);
    return a ? { subtype: a.basis } : undefined;
  },
});

approvalEngine.register('fleet_topup', {
  onHistory: (id, e) => byId(topUps, id)?.history.push(e),
  onFinal: (id, approved) => {
    const t = byId(topUps, id);
    if (!t) return;
    if (!approved) {
      t.status = 'rejected';
      return;
    }
    t.status = 'approved';
    const by = [...t.history].reverse().find((h) => h.action === 'approved')?.userId ?? t.createdBy;
    void executeTopUp(t, by);
  },
  onReturned: (id) => {
    const t = byId(topUps, id);
    if (t) t.status = 'returned';
  },
  onResubmitted: (id) => {
    const t = byId(topUps, id);
    if (t) t.status = 'pending';
  },
  getContext: (id) => {
    const t = byId(topUps, id);
    return t ? { amount: t.total } : undefined;
  },
});

const isoAt = (d: string, h = '09:00') => `${d}T${h}:00Z`;
approvalEngine.seed([
  { id: 'a-flt-1', entity: 'fleet_trip', entityId: 'ft8', title: '01 A 123 BC · Головной офис → Ташкентский областной филиал (Нурафшан)', number: 'PL-2026-3334', requesterId: 'u15', assigneeRole: 'dept_head', step: 1, totalSteps: 1, createdAt: '2026-10-18T09:10:00Z', dueAt: '2026-10-18T13:10:00Z', status: 'pending' },
  { id: 'a-flt-2', entity: 'fleet_assignment', entityId: 'fa9', title: '40 E 654 JK → Рахматов Шухрат (резервный)', number: 'RS-2026-0118', requesterId: 'u6', assigneeRole: 'dept_head', step: 1, totalSteps: 2, createdAt: '2026-10-17T11:00:00Z', dueAt: isoAt('2026-10-18', '11:00'), status: 'pending' },
  { id: 'a-flt-3', entity: 'fleet_topup', entityId: 'tu2', title: 'Зачисление на топливные карты, 2026-11', number: 'TU-2026-1017', amount: 11_600_000, currency: 'UZS', requesterId: 'u6', assigneeRole: 'dept_head', step: 1, totalSteps: 2, createdAt: '2026-10-17T10:00:00Z', dueAt: isoAt('2026-10-18', '10:00'), status: 'pending' },
]);

/** Зачисление средств на топливные карты через iABS (платёжное поручение на счёт карты). */
async function executeTopUp(t: FleetTopUp, userId: ID): Promise<void> {
  t.status = 'sent';
  emit();
  for (const [i, line] of t.lines.entries()) {
    if (line.state === 'success') continue;
    const card = byId(cards, line.cardId);
    if (!card) {
      line.state = 'failed';
      continue;
    }
    try {
      const rec = await integrationHub.call('iabs', 'payment.send', { doc: `${t.number}-${i + 1}`, account: card.account, mfo: '00873', amount: line.amount, purpose: `Пополнение топливной карты ${card.number} (${t.period})` }, { userId, idempotencyKey: `${t.id}:${card.id}` });
      line.exchangeId = rec.id;
      applyTopUpLine(t, line, rec.status);
    } catch {
      line.state = 'failed';
    }
  }
  finishTopUp(t);
  emit();
}

function applyTopUpLine(t: FleetTopUp, line: FleetTopUpLine, status: string): void {
  const card = byId(cards, line.cardId);
  if (status === 'success' && line.state !== 'success') {
    line.state = 'success';
    if (card) {
      card.balance += line.amount;
      addPosting('topup', t.id, t.number, card.vehicleId, byId(vehicles, card.vehicleId)?.costCenterKey ?? '', line.amount, today(), `Зачисление на топливную карту ${card.number}`);
    }
  } else if (status === 'queued' || status === 'pending') line.state = 'queued';
  else if (status !== 'success') line.state = 'failed';
}

function finishTopUp(t: FleetTopUp): void {
  if (t.lines.every((l) => l.state === 'success')) t.status = 'done';
  else if (t.lines.some((l) => l.state === 'failed')) t.status = 'failed';
  else t.status = 'sent';
}

// ---------------------------------------------------------------------------------------------
// Связь с модулем «Основные средства»: балансовая стоимость и списание.

async function syncAssets(): Promise<void> {
  let changed = false;
  for (const v of vehicles.filter((x) => x.assetId)) {
    let a: unknown;
    try {
      a = await assetsApi.get(v.assetId!);
    } catch {
      continue;
    }
    const rec = a as { inventoryNo?: string; cost?: number; accumulated?: number; status?: string } | undefined;
    if (!rec) continue;
    assetCache.set(v.assetId!, { inventoryNo: rec.inventoryNo ?? '', nbv: Math.max(0, (rec.cost ?? 0) - (rec.accumulated ?? 0)), status: rec.status ?? '' });
    if (v.status === 'writeoff_pending') {
      if (rec.status === 'written_off') {
        setStatusInternal(v, 'written_off', 'system', `ОС ${rec.inventoryNo ?? ''} списано`);
        v.primaryDriverId = undefined;
        v.reserveDriverId = undefined;
        changed = true;
      } else if (rec.status && rec.status !== 'pending_writeoff') {
        setStatusInternal(v, v.statusBeforeWriteoff ?? 'reserve', 'system', 'Списание ОС отклонено');
        changed = true;
      }
    }
  }
  if (changed) emit();
}

// События модуля ОС: списание ТС блокируется при открытом путевом листе; решение по акту ОС-4 и передача ОС
// отражаются в карточке ТС (статус, подразделение, МВЗ).
onAssetEvent((e, user) => {
  const v = vehicles.find((x) => x.assetId === e.asset.id);
  if (!v) return;
  if (e.type === 'writeoff_requested') {
    if (openTripOf(v.id)) throw new Error('BLOCKED_BY_FLEET_TRIP');
    if (v.status !== 'writeoff_pending') {
      v.statusBeforeWriteoff = v.status;
      v.writeoffReason = e.act.reason;
      v.writeoffActId = e.act.id;
      setStatusInternal(v, 'writeoff_pending', user.id, `ОС-4 ${e.act.number}`);
    }
  } else if (e.type === 'writeoff_rejected' && v.status === 'writeoff_pending') {
    setStatusInternal(v, v.statusBeforeWriteoff ?? 'reserve', user.id || 'system', `ОС-4 ${e.act.number}: отклонено`);
  } else if (e.type === 'written_off' && v.status !== 'written_off') {
    setStatusInternal(v, 'written_off', user.id || 'system', `ОС-4 ${e.act.number}`);
    v.primaryDriverId = undefined;
    v.reserveDriverId = undefined;
  } else if (e.type === 'transferred') {
    const a = e.asset as { orgUnitKey?: string; costCenterId?: string };
    if (a.orgUnitKey && a.orgUnitKey !== v.orgUnitKey) v.orgUnitKey = a.orgUnitKey;
    if (a.costCenterId && a.costCenterId !== v.costCenterKey) v.costCenterKey = a.costCenterId;
  }
});

// ---------------------------------------------------------------------------------------------
// Поиск

registerSearchProvider((q) => [
  ...vehicles
    .filter((v) => matches(q, v.plate, v.plate.replace(/\s/g, ''), v.brand, v.model, v.vin, driverName(v.primaryDriverId)))
    .map((v) => ({ group: 'fleet_title', title: `${v.plate} · ${v.brand} ${v.model}`, subtitle: driverName(v.primaryDriverId) ?? '', to: `/fleet/${v.id}` })),
  ...trips
    .filter((t) => matches(q, t.number))
    .map((t) => ({ group: 'fleet_title', title: `${t.number} · ${byId(vehicles, t.vehicleId)?.plate ?? ''}`, subtitle: `${t.routeFrom} → ${t.routeTo}`, to: `/fleet/${t.vehicleId}` })),
  ...drivers
    .filter((d) => matches(q, d.fullName, d.personnelNo, d.licenseNo))
    .map((d) => ({ group: 'fleet_title', title: `${d.fullName} · ${d.personnelNo}`, subtitle: d.licenseNo, to: `/fleet/drivers/${d.id}` })),
  ...services
    .filter((s) => matches(q, s.number))
    .map((s) => ({ group: 'fleet_title', title: `${s.number} · ${byId(vehicles, s.vehicleId)?.plate ?? ''}`, subtitle: s.fault, to: `/fleet/service/${s.id}` })),
  ...assignments
    .filter((a) => matches(q, a.number))
    .map((a) => ({ group: 'fleet_title', title: `${a.number} · ${byId(vehicles, a.vehicleId)?.plate ?? ''}`, subtitle: driverName(a.driverId) ?? '', to: `/fleet/assignments/${a.id}` })),
]);

// ---------------------------------------------------------------------------------------------
// Предупреждения о сроках (PR-FLT-028, 041, 058, 075) и уведомления

const DOC_ALERT: Partial<Record<FleetDocType, FleetAlert['kind']>> = { osago: 'insurance', kasko: 'kasko', inspection: 'inspection', tech_passport: 'tech_passport', power_of_attorney: 'power_of_attorney' };

function computeAlerts(): FleetAlert[] {
  const d0 = today();
  const horizon = fleetAddDays(d0, settings.alertHorizonDays);
  const month = d0.slice(0, 7);
  const out: FleetAlert[] = [];
  for (const v of vehicles.filter((x) => x.status !== 'written_off')) {
    for (const [type, kind] of Object.entries(DOC_ALERT) as [FleetDocType, FleetAlert['kind']][]) {
      const doc = activeDoc(v.id, type);
      if (doc?.validUntil && doc.validUntil <= horizon) out.push({ id: `${kind}:${v.id}`, kind, vehicleId: v.id, due: doc.validUntil, expired: doc.validUntil < d0, detail: `${v.plate} · ${doc.number}` });
    }
    const next = fleetNextService(v);
    const kmLeft = next.km - v.mileage;
    const kmWarn = v.kind === 'generator' ? 25 : 1000;
    if (kmLeft <= kmWarn || next.date <= fleetAddDays(d0, 14))
      out.push({ id: `service:${v.id}`, kind: 'service', vehicleId: v.id, due: next.date, expired: kmLeft < 0 || next.date < d0, detail: `${v.plate} · ${v.mileage} / ${next.km} ${v.kind === 'generator' ? 'h' : 'km'}` });
    const last = trips.filter((t) => t.vehicleId === v.id && t.status === 'closed').sort((a, b) => b.date.localeCompare(a.date) || b.odoStart - a.odoStart)[0];
    if (last?.fuelUsed && last.fuelNormUsed && last.fuelUsed > last.fuelNormUsed * (1 + settings.overrunTolerancePct / 100))
      out.push({ id: `overconsumption:${v.id}`, kind: 'overconsumption', vehicleId: v.id, expired: false, detail: `${v.plate} · ${last.number}: ${last.fuelUsed} / ${last.fuelNormUsed} (+${fleetDeviationPct(last.fuelUsed, last.fuelNormUsed)}%)` });
    if (v.limitLitres > 0 || v.limitSum > 0) {
      const u = limitUsage(v.id, month);
      if ((v.limitLitres > 0 && u.litres > v.limitLitres) || (v.limitSum > 0 && u.amount > v.limitSum))
        out.push({ id: `limit:${v.id}`, kind: 'limit', vehicleId: v.id, expired: true, detail: `${v.plate} · ${u.litres} / ${v.limitLitres}` });
    }
  }
  for (const d of drivers.filter((x) => x.active)) {
    if (d.licenseUntil <= horizon) out.push({ id: `license:${d.id}`, kind: 'license', driverId: d.id, due: d.licenseUntil, expired: d.licenseUntil < d0, detail: `${d.fullName} · ${d.licenseNo}` });
    if (d.medicalUntil <= horizon) out.push({ id: `medical:${d.id}`, kind: 'medical', driverId: d.id, due: d.medicalUntil, expired: d.medicalUntil < d0, detail: d.fullName });
  }
  return out.sort((a, b) => Number(b.expired) - Number(a.expired) || (a.due ?? '9').localeCompare(b.due ?? '9'));
}

/** Рассылка уведомлений по предупреждениям (дедупликация по ключу — повторно не создаются). */
function scanExpiries(): number {
  let sent = 0;
  for (const a of computeAlerts()) {
    const v = byId(vehicles, a.vehicleId);
    const d = byId(drivers, a.driverId);
    const recipients = new Set<ID>(managersFor(v?.orgUnitKey ?? d?.orgUnitKey));
    if (d?.userId) recipients.add(d.userId);
    if (v) for (const dr of [v.primaryDriverId, v.reserveDriverId]) {
      const u = byId(drivers, dr)?.userId;
      if (u && a.kind !== 'limit' && a.kind !== 'overconsumption') recipients.add(u);
    }
    const out = notify({
      userIds: [...recipients],
      title: { key: `fleet_alert_${a.kind}` },
      body: a.due ? `${a.detail} · ${a.due}` : a.detail,
      link: v ? `/fleet/${v.id}` : d ? `/fleet/drivers/${d.id}` : '/fleet/alerts',
      level: a.expired ? 'danger' : 'warning',
      kind: 'system',
      dedupeKey: `fleet:${a.id}:${a.due ?? today().slice(0, 7)}`,
    });
    sent += out.length;
  }
  if (sent) emit();
  return sent;
}

let scanned = false;
const autoScan = () => {
  if (scanned) return;
  scanned = true;
  scanExpiries();
};

// ---------------------------------------------------------------------------------------------
// Фильтры

export interface FleetFilter {
  status?: FleetStatus | 'active';
  purpose?: FleetPurpose;
  kind?: FleetKind;
  vehicleType?: FleetVehicleType;
  orgUnitKey?: string;
  search?: string;
}

export interface FleetTripFilter {
  vehicleId?: ID;
  driverId?: ID;
  status?: FleetTripStatus;
  from?: string;
  to?: string;
  search?: string;
}

export interface FleetListFilter {
  vehicleId?: ID;
  driverId?: ID;
  from?: string;
  to?: string;
}

const inPeriod = (d: string, f: FleetListFilter) => (!f.from || d >= f.from) && (!f.to || d <= f.to);

// ---------------------------------------------------------------------------------------------
// Импорт из Excel (4.2.6.1: «загрузка из Excel»)

const L = (ru: string, uz: string, en: string) => ({ ru, uz, en });
importRegistry.register({
  id: 'fleet_vehicles',
  name: L('Автопарк: транспорт и генераторы', 'Avtopark: transport va generatorlar', 'Fleet: vehicles and generators'),
  description: L(
    'Госномер, марка, модель, год, VIN, техпаспорт, тип, топливо, норма, лимиты, балансовая стоимость, подразделение, МВЗ. Существующие карточки (по госномеру) обновляются.',
    "Davlat raqami, marka, model, yil, VIN, texpasport, tur, yoqilg'i, me'yor, limitlar, balans qiymati, bo'linma, XJM. Mavjud kartochkalar (davlat raqami bo'yicha) yangilanadi.",
    'Plate, make, model, year, VIN, registration certificate, type, fuel, norm, limits, book value, unit, cost centre. Existing cards (by plate) are updated.',
  ),
  keyField: 'plate',
  fields: [
    { key: 'plate', label: L('Госномер', 'Davlat raqami', 'Plate number'), type: 'string', required: true, unique: true, maxLength: 20, sample: '01 K 777 AA' },
    { key: 'kind', label: L('Вид учёта', 'Hisob turi', 'Kind'), type: 'enum', required: true, sample: 'vehicle', options: [{ value: 'vehicle', label: L('Автомобиль', 'Avtomobil', 'Vehicle'), aliases: ['авто', 'ТС'] }, { value: 'generator', label: L('Генератор', 'Generator', 'Generator'), aliases: ['ДГУ'] }] },
    { key: 'brand', label: L('Марка', 'Marka', 'Make'), type: 'string', required: true, maxLength: 40, sample: 'Chevrolet' },
    { key: 'model', label: L('Модель', 'Model', 'Model'), type: 'string', required: true, maxLength: 80, sample: 'Onix' },
    { key: 'year', label: L('Год выпуска', 'Ishlab chiqarilgan yil', 'Year'), type: 'integer', required: true, min: 1980, max: 2027, sample: '2024' },
    { key: 'vin', label: L('VIN / заводской номер', 'VIN / zavod raqami', 'VIN / serial'), type: 'string', required: true, maxLength: 30, sample: 'XWBJA69V0RA000001' },
    { key: 'techPassportNo', label: L('Номер техпаспорта', 'Texpasport raqami', 'Registration certificate'), type: 'string', required: true, maxLength: 20, sample: 'AAK 0000001' },
    { key: 'vehicleType', label: L('Тип ТС', 'TV turi', 'Vehicle type'), type: 'enum', required: true, sample: 'car', options: [
      { value: 'car', label: L('Легковой', 'Yengil', 'Car') }, { value: 'truck', label: L('Грузовой', 'Yuk', 'Truck') }, { value: 'special', label: L('Специальный', 'Maxsus', 'Special') },
      { value: 'bus', label: L('Автобус', 'Avtobus', 'Bus') }, { value: 'generator', label: L('Генератор', 'Generator', 'Generator') },
    ] },
    { key: 'purpose', label: L('Назначение', 'Vazifasi', 'Assignment'), type: 'enum', required: true, sample: 'business', options: [
      { value: 'collection', label: L('Инкассация', 'Inkassatsiya', 'Cash collection') }, { value: 'business', label: L('Служебные поездки', 'Xizmat safarlari', 'Business trips') },
      { value: 'management', label: L('Руководство', 'Rahbariyat', 'Management') }, { value: 'service', label: L('Хозяйственный', "Xo'jalik", 'Utility') }, { value: 'power', label: L('Электроснабжение', "Elektr ta'minoti", 'Power supply') },
    ] },
    { key: 'fuel', label: L('Топливо', "Yoqilg'i", 'Fuel'), type: 'enum', required: true, sample: 'petrol', options: [
      { value: 'petrol', label: L('Бензин', 'Benzin', 'Petrol') }, { value: 'diesel', label: L('Дизель', 'Dizel', 'Diesel') }, { value: 'methane', label: L('Метан', 'Metan', 'Methane') },
      { value: 'propane', label: L('Пропан', 'Propan', 'Propane') }, { value: 'electric', label: L('Электро', 'Elektr', 'Electric') },
    ] },
    { key: 'fuelNorm', label: L('Норма расхода', "Sarf me'yori", 'Fuel norm'), type: 'number', required: true, min: 0.1, max: 200, sample: '8.5' },
    { key: 'limitLitres', label: L('Лимит, л/мес', 'Limit, l/oy', 'Limit, L/month'), type: 'integer', min: 0, sample: '150' },
    { key: 'limitSum', label: L('Лимит, сум/мес', "Limit, so'm/oy", 'Limit, UZS/month'), type: 'integer', min: 0, sample: '1500000' },
    { key: 'bookValue', label: L('Балансовая стоимость', 'Balans qiymati', 'Book value'), type: 'integer', min: 0, sample: '250000000' },
    { key: 'orgUnit', label: L('Код оргединицы', 'Tashkiliy birlik kodi', 'Org unit key'), type: 'string', required: true, sample: 'd2' },
    { key: 'costCenter', label: L('Код МВЗ', 'XJM kodi', 'Cost centre code'), type: 'string', required: true, pattern: '^MVZ-\\d{2}-\\d{3}-[A-Z0-9]{2,3}$', patternHint: 'MVZ-RR-UUU-NN', sample: 'MVZ-00-002-02' },
    { key: 'mileage', label: L('Пробег / моточасы', 'Yurgan masofa / motosoat', 'Mileage / run hours'), type: 'integer', min: 0, sample: '1200' },
  ],
  existingKeys: async () => vehicles.map((v) => normPlate(v.plate)),
  async extraValidate(rows) {
    const units = await orgApi.listOrgUnits();
    const page = await orgApi.listCostCenters({ pageSize: 100_000 });
    return rows.map((r) => {
      const issues: { field: string; code: 'reference' | 'rule'; value: string; severity: 'error' | 'warning'; messageKey?: string }[] = [];
      if (r.orgUnit && !units.some((u) => u.key === String(r.orgUnit))) issues.push({ field: 'orgUnit', code: 'reference', value: String(r.orgUnit), severity: 'error' });
      const cc = page.rows.find((c) => c.code === String(r.costCenter ?? ''));
      if (r.costCenter && !cc) issues.push({ field: 'costCenter', code: 'reference', value: String(r.costCenter), severity: 'error' });
      if (r.kind === 'vehicle' && r.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(String(r.vin).toUpperCase())) issues.push({ field: 'vin', code: 'rule', value: String(r.vin), severity: 'error', messageKey: 'fleet_err_vin' });
      return issues;
    });
  },
  async commit(rows, user, mode) {
    const page = await orgApi.listCostCenters({ pageSize: 100_000 });
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const rejected: { line: number; messages: string[] }[] = [];
    rows.forEach((r, i) => {
      const num = (k: string, def = 0) => (typeof r[k] === 'number' ? (r[k] as number) : def);
      const str = (k: string) => (r[k] === null || r[k] === undefined ? '' : String(r[k] as ImportValue));
      const kind = str('kind') as FleetKind;
      const input: FleetVehicleInput = {
        kind, plate: str('plate'), brand: str('brand'), model: str('model'), year: num('year'), vin: str('vin').toUpperCase(), techPassportNo: str('techPassportNo'),
        vehicleType: str('vehicleType') as FleetVehicleType, purpose: str('purpose') as FleetPurpose, fuel: str('fuel') as FleetVehicle['fuel'], fuelNorm: num('fuelNorm'),
        winterPct: kind === 'generator' ? 5 : 10, cityPct: kind === 'generator' ? 0 : 15, limitLitres: num('limitLitres'), limitSum: num('limitSum'), bookValue: num('bookValue'),
        orgUnitKey: str('orgUnit'), costCenterKey: page.rows.find((c) => c.code === str('costCenter'))?.key ?? '', expenseAccount: '56811000', mileage: num('mileage'),
        serviceIntervalKm: kind === 'generator' ? 250 : 10_000, serviceIntervalMonths: 12, tankLitres: kind === 'generator' ? 200 : 60,
      };
      const existing = vehicles.find((v) => normPlate(v.plate) === normPlate(input.plate));
      try {
        if (existing) {
          if (mode !== 'upsert') {
            skipped++;
            return;
          }
          updateVehicleInternal(existing, { ...input, mileage: Math.max(existing.mileage, input.mileage) }, user);
          updated++;
        } else {
          createVehicleInternal(input, user);
          created++;
        }
      } catch (e) {
        rejected.push({ line: i + 2, messages: [e instanceof FleetError ? `fleet_err_${e.code}` : 'actionFailed'] });
      }
    });
    emit();
    return { created, updated, skipped, rejected };
  },
});

// ---------------------------------------------------------------------------------------------
// Карточки ТС

function validateVehicle(input: FleetVehicleInput, selfId?: ID): void {
  if (!input.plate.trim() || !input.brand.trim() || !input.model.trim() || !input.techPassportNo.trim() || !input.orgUnitKey || !input.vin.trim()) throw new FleetError('required');
  if (vehicles.some((v) => v.id !== selfId && normPlate(v.plate) === normPlate(input.plate))) throw new FleetError('plate_dup');
  if (input.kind === 'vehicle' && !/^[A-HJ-NPR-Z0-9]{17}$/.test(input.vin.trim().toUpperCase())) throw new FleetError('vin');
  if (input.kind === 'vehicle' && input.vehicleType === 'generator') throw new FleetError('vehicle_only');
  if (input.kind === 'generator' && input.vehicleType !== 'generator') throw new FleetError('generator_only');
  const y = Number(today().slice(0, 4));
  if (!isInt(input.year) || input.year < 1980 || input.year > y + 1) throw new FleetError('year');
  if (!(input.fuelNorm > 0) || input.winterPct < 0 || input.cityPct < 0 || input.winterPct > 50 || input.cityPct > 50) throw new FleetError('norm');
  for (const n of [input.limitLitres, input.limitSum, input.bookValue, input.mileage]) if (!isInt(n) || n < 0) throw new FleetError('amount');
  if (!isInt(input.serviceIntervalKm) || input.serviceIntervalKm <= 0 || !isInt(input.serviceIntervalMonths) || input.serviceIntervalMonths <= 0 || !(input.tankLitres > 0)) throw new FleetError('amount');
  if (!input.costCenterKey) throw new FleetError('cost_center');
}

function createVehicleInternal(input: FleetVehicleInput, user: User): FleetVehicle {
  validateVehicle(input);
  const d = today();
  const v: FleetVehicle = {
    id: nextId('fv'),
    ...input,
    plate: input.plate.trim().toUpperCase(),
    vin: input.vin.trim().toUpperCase(),
    status: input.status && input.status !== 'written_off' && input.status !== 'writeoff_pending' ? input.status : 'in_operation',
    lastServiceKm: input.mileage,
    lastServiceDate: d,
    createdAt: d,
  };
  vehicles.push(v);
  statusEvents.push({ id: nextId('fse'), vehicleId: v.id, from: null, to: v.status, at: now(), userId: user.id });
  audit.log({ user: actor(user), action: 'create', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, details: `${v.brand} ${v.model} · ${v.vin}` });
  return v;
}

const VEHICLE_FIELDS = ['plate', 'brand', 'model', 'year', 'vin', 'techPassportNo', 'vehicleType', 'purpose', 'fuel', 'fuelNorm', 'winterPct', 'cityPct', 'limitLitres', 'limitSum', 'bookValue', 'orgUnitKey', 'costCenterKey', 'expenseAccount', 'mileage', 'serviceIntervalKm', 'serviceIntervalMonths', 'tankLitres'];

function updateVehicleInternal(v: FleetVehicle, input: FleetVehicleInput, user: User): void {
  validateVehicle(input, v.id);
  if (input.mileage < v.mileage) throw new FleetError('odometer');
  const before = clone(v);
  Object.assign(v, { ...input, kind: v.kind, status: v.status, plate: input.plate.trim().toUpperCase(), vin: input.vin.trim().toUpperCase() });
  const changes = diffFields(before, v, VEHICLE_FIELDS);
  if (changes.length) audit.log({ user: actor(user), action: 'update', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, changes });
}

// ---------------------------------------------------------------------------------------------
// Путевые листы

function validateTripInput(input: FleetTripInput, v: FleetVehicle, selfId?: ID): FleetDriver {
  if (!input.vehicleId || !input.driverId || !input.date || !input.returnDate || !input.routeFrom.trim() || !input.routeTo.trim() || !input.purpose.trim()) throw new FleetError('required');
  if (v.kind !== 'vehicle') throw new FleetError('vehicle_only');
  if (v.status !== 'in_operation') throw new FleetError('vehicle_unavailable');
  if (trips.some((t) => t.id !== selfId && t.vehicleId === v.id && (t.status === 'open' || t.status === 'pending' || t.status === 'returned'))) throw new FleetError('vehicle_busy');
  if (!TIME_RE.test(input.departTime) || !TIME_RE.test(input.returnTime)) throw new FleetError('time');
  const d0 = today();
  if (input.date < fleetAddDays(d0, -7) || input.date > fleetAddDays(d0, 30)) throw new FleetError('date');
  if (`${input.returnDate}T${input.returnTime}` <= `${input.date}T${input.departTime}`) throw new FleetError('return_before_depart');
  const d = byId(drivers, input.driverId);
  if (!d || !d.active) throw new FleetError('driver_inactive');
  if (v.primaryDriverId !== d.id && v.reserveDriverId !== d.id) throw new FleetError('driver_not_assigned');
  checkCategory(d, v);
  if (d.licenseUntil < input.returnDate) throw new FleetError('driver_license', d.licenseUntil);
  if (d.medicalUntil < input.returnDate) throw new FleetError('driver_medical', d.medicalUntil);
  for (const type of ['osago', 'inspection'] as const) {
    const doc = activeDoc(v.id, type);
    if (!doc?.validUntil || doc.validUntil < input.returnDate) throw new FleetError('doc_expired', type);
  }
  if (!isInt(input.odoStart) || input.odoStart < v.mileage) throw new FleetError('odometer');
  if (!(input.fuelStart >= 0) || input.fuelStart > v.tankLitres) throw new FleetError('fuel');
  return d;
}

const tripRefuels = (tripId: ID) => fuelUps.filter((f) => f.tripId === tripId).reduce((a, f) => a + f.litres, 0);

/** Каноническое содержимое путевого листа для подписи E-IMZO (не зависит от языка интерфейса). */
export function fleetTripSignContent(t: FleetTrip): Record<string, unknown> {
  return {
    type: 'fleet_trip', number: t.number, vehicle: byId(vehicles, t.vehicleId)?.plate ?? '', driver: driverName(t.driverId) ?? '', date: t.date, depart: t.departTime, return: `${t.returnDate} ${t.returnTime}`,
    route: `${t.routeFrom} → ${t.routeTo}`, odoStart: t.odoStart, odoEnd: t.odoEnd ?? null, fuelUsed: t.fuelUsed ?? null, fuelNorm: t.fuelNormUsed ?? null, status: t.status,
  };
}

/** Каноническое содержимое акта приёма-передачи для подписи E-IMZO. */
export function fleetActSignContent(a: FleetAssignment): Record<string, unknown> {
  return { type: 'fleet_act', number: a.act?.number ?? a.number, order: a.number, vehicle: byId(vehicles, a.vehicleId)?.plate ?? '', from: driverName(a.fromDriverId) ?? '', to: driverName(a.driverId) ?? '', odometer: a.act?.odometer ?? null, fuel: a.act?.fuelLevel ?? null, checklist: a.act?.checklist ?? null, defects: a.act?.defects ?? '' };
}

// ---------------------------------------------------------------------------------------------
// Публичное API

export const fleetApi = {
  // ----- настройки -----
  getSettings: () => delay(settings),
  async saveSettings(patch: Partial<FleetSettings>, user: User) {
    guardManage(user);
    const next = { ...settings, ...patch, fuelPrices: { ...settings.fuelPrices, ...(patch.fuelPrices ?? {}) } };
    if (!isInt(next.alertHorizonDays) || next.alertHorizonDays < 1 || next.alertHorizonDays > 180) throw new FleetError('amount');
    if (!(next.overrunTolerancePct >= 0) || next.overrunTolerancePct > 50) throw new FleetError('amount');
    const changes = diffFields(settings, next, ['alertHorizonDays', 'overrunTolerancePct']);
    settings = next;
    audit.log({ user: actor(user), action: 'settings', entity: 'fleet_settings', entityId: 'fleet', changes });
    emit();
    await delay(null);
  },

  // ----- транспорт и генераторы -----
  async list(filter: FleetFilter = {}): Promise<FleetVehicleView[]> {
    await syncAssets();
    autoScan();
    const q = filter.search?.trim().toLowerCase();
    return delay(
      vehicles
        .filter((v) => !filter.status || (filter.status === 'active' ? v.status !== 'written_off' : v.status === filter.status))
        .filter((v) => !filter.purpose || v.purpose === filter.purpose)
        .filter((v) => !filter.kind || v.kind === filter.kind)
        .filter((v) => !filter.vehicleType || v.vehicleType === filter.vehicleType)
        .filter((v) => !filter.orgUnitKey || v.orgUnitKey === filter.orgUnitKey)
        .filter((v) => !q || [v.plate, v.plate.replace(/\s/g, ''), v.brand, v.model, v.vin, driverName(v.primaryDriverId) ?? ''].some((s) => s.toLowerCase().includes(q)))
        .map(toView),
    );
  },
  async get(id: ID): Promise<FleetVehicleView | undefined> {
    await syncAssets();
    const v = byId(vehicles, id);
    return delay(v ? toView(v) : undefined);
  },
  async create(input: FleetVehicleInput, user: User): Promise<FleetVehicle> {
    guardManage(user);
    const v = createVehicleInternal(input, user);
    emit();
    return delay(v);
  },
  async update(id: ID, input: FleetVehicleInput, user: User): Promise<void> {
    guardManage(user);
    const v = vehicleOr404(id);
    if (v.status === 'written_off') throw new FleetError('not_allowed');
    updateVehicleInternal(v, input, user);
    emit();
    await delay(null);
  },
  /** Смена статуса (эксплуатация, ремонт, техосмотр, резерв). Списание — отдельной операцией через ОС. */
  async setStatus(id: ID, status: FleetStatus, user: User, reason?: string): Promise<void> {
    guardManage(user);
    const v = vehicleOr404(id);
    if (status === 'written_off' || status === 'writeoff_pending' || v.status === 'written_off' || v.status === 'writeoff_pending') throw new FleetError('not_allowed');
    if (v.status === status) return;
    if (openTripOf(v.id) && status !== 'in_operation') throw new FleetError('vehicle_busy');
    const from = v.status;
    setStatusInternal(v, status, user.id, reason?.trim() || undefined);
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, changes: [{ field: 'status', from, to: status }], ...(reason ? { details: reason } : {}) });
    emit();
    await delay(null);
  },
  listStatusEvents: (vehicleId: ID): Promise<FleetStatusEvent[]> => delay(statusEvents.filter((e) => e.vehicleId === vehicleId).sort((a, b) => b.at.localeCompare(a.at))),

  /** Списание: при связи с ОС — акт ОС-4 с комиссией (модуль «Основные средства»: подписи комиссии, маршрут, проводки); иначе — сразу. */
  async requestWriteoff(id: ID, input: FleetWriteoffInput, user: User): Promise<'pending' | 'written_off'> {
    guardManage(user);
    const v = vehicleOr404(id);
    const reason = input.reason.trim();
    if (!reason) throw new FleetError('required');
    if (v.status === 'written_off' || v.status === 'writeoff_pending' || openTripOf(v.id)) throw new FleetError('not_allowed');
    if (v.assetId) {
      if (!input.protocolNo?.trim() || !input.chairmanId || (input.memberIds ?? []).filter(Boolean).length < 2) throw new FleetError('required');
      const before = v.status;
      let actId: ID;
      try {
        const act = (await assetsApi.createWriteoff({ kind: input.kind ?? 'liquidation', assetIds: [v.assetId], reason, commission: { chairmanId: input.chairmanId, memberIds: (input.memberIds ?? []).filter(Boolean), protocolNo: input.protocolNo.trim() } }, user)) as { id: ID };
        actId = act.id;
        await assetsApi.sendWriteoffToCommission(actId, user);
      } catch (e) {
        throw new FleetError('asset', e instanceof Error ? e.message : undefined);
      }
      v.statusBeforeWriteoff = before;
      v.writeoffReason = reason;
      v.writeoffActId = actId;
      setStatusInternal(v, 'writeoff_pending', user.id, reason);
      audit.log({ user: actor(user), action: 'submit', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, details: `Списание через акт ОС-4 ${actId}: ${reason}` });
      emit();
      return delay('pending' as const);
    }
    const from = v.status;
    v.writeoffReason = reason;
    setStatusInternal(v, 'written_off', user.id, reason);
    v.primaryDriverId = undefined;
    v.reserveDriverId = undefined;
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, changes: [{ field: 'status', from, to: 'written_off' }], details: reason });
    emit();
    return delay('written_off' as const);
  },
  /** Поставить ТС на учёт как основное средство (модуль «Основные средства», группа «Транспортные средства»). */
  async registerAsFixedAsset(id: ID, user: User): Promise<void> {
    guardManage(user);
    const v = vehicleOr404(id);
    if (v.assetId || v.kind !== 'vehicle' || v.status === 'written_off') throw new FleetError('not_allowed');
    if (!can(user, 'assets', 'edit')) throw new FleetError('forbidden');
    if (!(v.bookValue > 0)) throw new FleetError('amount');
    let asset: { id: ID; inventoryNo: string };
    try {
      asset = (await assetsApi.registerAsset({
        name: `Автомобиль ${v.brand} ${v.model}, ${v.plate}`, groupId: 'ag-veh', orgUnitKey: v.orgUnitKey, departmentId: /^d\d+$/.test(v.orgUnitKey) ? v.orgUnitKey : 'd2', costCenterId: v.costCenterKey,
        responsibleId: byId(drivers, v.primaryDriverId)?.userId ?? user.id, acquiredAt: `${v.year}-01-15`, cost: v.bookValue, usefulLifeMonths: 72, method: 'linear', source: 'purchase', location: 'Автопарк', serialNo: v.vin, model: `${v.brand} ${v.model}`,
      }, user)) as { id: ID; inventoryNo: string };
    } catch (e) {
      throw new FleetError('asset', e instanceof Error ? e.message : undefined);
    }
    v.assetId = asset.id;
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, changes: [{ field: 'assetId', from: '', to: asset.id }], details: `ОС ${asset.inventoryNo}` });
    emit();
    await delay(null);
  },
  /** Связать карточку ТС с основным средством (модуль «Основные средства»). */
  async linkAsset(id: ID, assetId: ID | undefined, user: User): Promise<void> {
    guardManage(user);
    const v = vehicleOr404(id);
    if (assetId && vehicles.some((x) => x.id !== id && x.assetId === assetId)) throw new FleetError('asset');
    if (assetId && !(await assetsApi.get(assetId))) throw new FleetError('asset');
    const from = v.assetId ?? '';
    if (assetId) v.assetId = assetId;
    else delete v.assetId;
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, changes: [{ field: 'assetId', from, to: assetId ?? '' }] });
    emit();
    await delay(null);
  },
  /** Карточки ОС категории «Транспорт» для привязки. */
  async listVehicleAssets(): Promise<{ id: ID; inventoryNo: string; name: string; nbv: number; status: string; linkedTo?: string }[]> {
    const list = (await assetsApi.list({ category: 'vehicles' })) as unknown as { id: ID; inventoryNo: string; name: string; cost: number; accumulated: number; status: string }[];
    return list.map((a) => {
      const linked = vehicles.find((v) => v.assetId === a.id)?.plate;
      return { id: a.id, inventoryNo: a.inventoryNo, name: a.name, nbv: Math.max(0, a.cost - a.accumulated), status: a.status, ...(linked ? { linkedTo: linked } : {}) };
    });
  },

  // ----- водители -----
  listDrivers: (filter: { search?: string; active?: boolean } = {}): Promise<FleetDriver[]> => {
    const q = filter.search?.trim().toLowerCase();
    return delay(drivers.filter((d) => filter.active === undefined || d.active === filter.active).filter((d) => !q || [d.fullName, d.personnelNo, d.licenseNo].some((s) => s.toLowerCase().includes(q))));
  },
  getDriver: (id: ID) => delay(byId(drivers, id)),
  driverOf: (user: User) => delay(driverOfUser(user.id)),
  async saveDriver(input: FleetDriverInput, user: User, id?: ID): Promise<FleetDriver> {
    guardManage(user);
    if (!input.fullName.trim() || !input.personnelNo.trim() || !input.licenseNo.trim() || !input.licenseUntil || !input.medicalUntil || !input.orgUnitKey || !input.licenseCategories.length) throw new FleetError('required');
    if (drivers.some((d) => d.id !== id && d.personnelNo.trim() === input.personnelNo.trim())) throw new FleetError('duplicate_pending');
    if (input.userId && drivers.some((d) => d.id !== id && d.userId === input.userId)) throw new FleetError('duplicate_pending');
    let d = id ? byId(drivers, id) : undefined;
    if (id && !d) throw new FleetError('not_found');
    if (d) {
      const before = clone(d);
      Object.assign(d, { ...input, fullName: input.fullName.trim() });
      if (!input.userId) delete d.userId;
      const changes = diffFields(before, d, ['fullName', 'personnelNo', 'phone', 'licenseNo', 'licenseCategories', 'licenseUntil', 'medicalUntil', 'orgUnitKey', 'active', 'userId']);
      if (changes.length) audit.log({ user: actor(user), action: 'update', entity: 'fleet_driver', entityId: d.id, entityLabel: d.fullName, changes });
    } else {
      d = { id: nextId('fd'), ...input, fullName: input.fullName.trim() };
      if (!input.userId) delete d.userId;
      drivers.push(d);
      audit.log({ user: actor(user), action: 'create', entity: 'fleet_driver', entityId: d.id, entityLabel: d.fullName });
    }
    emit();
    return delay(d);
  },
  /** Закреплённые за водителем ТС (основной / резервный). */
  driverVehicles: (driverId: ID) => delay(vehicles.filter((v) => v.primaryDriverId === driverId || v.reserveDriverId === driverId).map(toView)),

  // ----- документы ТС -----
  listDocuments: (filter: { vehicleId?: ID; type?: FleetDocType; includeReplaced?: boolean } = {}) =>
    delay(
      documents
        .filter((d) => (!filter.vehicleId || d.vehicleId === filter.vehicleId) && (!filter.type || d.type === filter.type) && (filter.includeReplaced || d.status === 'active'))
        .sort((a, b) => a.type.localeCompare(b.type) || b.validFrom.localeCompare(a.validFrom)),
    ),
  /** Новый документ / продление (предыдущий документ того же вида помечается «заменён»). */
  async addDocument(input: FleetDocumentInput, user: User): Promise<FleetDocument> {
    guardManage(user);
    const v = vehicleOr404(input.vehicleId);
    if (!input.number.trim() || !input.validFrom || !input.issuer.trim()) throw new FleetError('required');
    const needsUntil = input.type !== 'tech_passport';
    if (needsUntil && !input.validUntil) throw new FleetError('valid_until');
    if (input.validUntil && input.validUntil < input.validFrom) throw new FleetError('valid_until');
    if (!isInt(input.cost) || input.cost < 0) throw new FleetError('amount');
    if (input.type === 'power_of_attorney' && !input.driverId) throw new FleetError('required');
    const doc: FleetDocument = {
      id: nextId('fdoc'), vehicleId: v.id, type: input.type, number: input.number.trim(), issuer: input.issuer.trim(), validFrom: input.validFrom,
      ...(input.validUntil ? { validUntil: input.validUntil } : {}), cost: input.cost, ...(input.driverId ? { driverId: input.driverId } : {}),
      status: 'active', createdAt: now(), createdBy: user.id,
    };
    for (const old of documents.filter((d) => d.vehicleId === v.id && d.type === input.type && d.status === 'active' && (input.type !== 'power_of_attorney' || d.driverId === input.driverId))) {
      old.status = 'replaced';
      old.replacedById = doc.id;
    }
    documents.push(doc);
    if (input.type === 'tech_passport') v.techPassportNo = doc.number;
    if ((input.type === 'osago' || input.type === 'kasko') && input.cost > 0)
      addPosting('insurance', doc.id, doc.number, v.id, v.costCenterKey, input.cost, input.validFrom <= today() ? input.validFrom : today(), `${input.type === 'osago' ? 'ОСАГО' : 'КАСКО'} ${v.plate}: ${doc.number}`);
    if (input.type === 'inspection' && v.status === 'inspection') setStatusInternal(v, 'in_operation', user.id, `Техосмотр ${doc.number}`);
    audit.log({ user: actor(user), action: 'create', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, details: `${input.type}: ${doc.number} ${doc.validFrom}…${doc.validUntil ?? ''}` });
    emit();
    return delay(doc);
  },

  // ----- закрепление и смена водителя -----
  listAssignments: (filter: { vehicleId?: ID; driverId?: ID; status?: FleetAssignment['status'] } = {}) =>
    delay(
      assignments
        .filter((a) => (!filter.vehicleId || a.vehicleId === filter.vehicleId) && (!filter.driverId || a.driverId === filter.driverId || a.fromDriverId === filter.driverId) && (!filter.status || a.status === filter.status))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt)),
    ),
  getAssignment: (id: ID) => delay(byId(assignments, id)),
  /** Распоряжение о закреплении ТС (приказ / доверенность) → маршрут согласования. */
  async createAssignment(input: FleetAssignmentInput, user: User): Promise<FleetAssignment> {
    guardManage(user);
    const v = vehicleOr404(input.vehicleId);
    if (!input.driverId || !input.effectiveFrom || !input.reason.trim()) throw new FleetError('required');
    if (v.status === 'written_off' || v.status === 'writeoff_pending' || v.kind !== 'vehicle') throw new FleetError('not_allowed');
    const d = byId(drivers, input.driverId);
    if (!d || !d.active) throw new FleetError('driver_inactive');
    if (d.licenseUntil < input.effectiveFrom) throw new FleetError('driver_license', d.licenseUntil);
    if (d.medicalUntil < input.effectiveFrom) throw new FleetError('driver_medical', d.medicalUntil);
    checkCategory(d, v);
    const current = input.role === 'primary' ? v.primaryDriverId : v.reserveDriverId;
    if (current === d.id) throw new FleetError('same_driver');
    if (assignments.some((a) => a.vehicleId === v.id && a.role === input.role && ['pending', 'returned', 'approved'].includes(a.status))) throw new FleetError('duplicate_pending');
    const a: FleetAssignment = {
      id: nextId('fa'), number: nextNumber('RS'), vehicleId: v.id, driverId: d.id, ...(current ? { fromDriverId: current } : {}), role: input.role, basis: input.basis,
      effectiveFrom: input.effectiveFrom, reason: input.reason.trim(), status: 'pending', createdBy: user.id, createdAt: now(), history: [ev(user.id, 'submitted')],
    };
    assignments.push(a);
    approvalEngine.open({ entity: 'fleet_assignment', entityId: a.id, number: a.number, title: `${v.plate} → ${d.fullName}`, requesterId: user.id, context: { subtype: a.basis, orgUnitKey: v.orgUnitKey } });
    audit.log({ user: actor(user), action: 'submit', entity: 'fleet_assignment', entityId: a.id, entityLabel: a.number, details: `${v.plate} → ${d.fullName} (${a.role}, ${a.basis})` });
    emit();
    return delay(a);
  },
  async resubmitAssignment(id: ID, patch: Partial<Pick<FleetAssignmentInput, 'effectiveFrom' | 'reason' | 'basis'>>, user: User): Promise<void> {
    guardManage(user);
    const a = byId(assignments, id);
    if (!a || (a.status !== 'returned' && a.status !== 'rejected')) throw new FleetError('not_allowed');
    if (patch.reason !== undefined && !patch.reason.trim()) throw new FleetError('required');
    Object.assign(a, { ...(patch.effectiveFrom ? { effectiveFrom: patch.effectiveFrom } : {}), ...(patch.reason ? { reason: patch.reason.trim() } : {}), ...(patch.basis ? { basis: patch.basis } : {}) });
    approvalEngine.resubmit(a.id, user);
    a.status = 'pending';
    emit();
    await delay(null);
  },
  async cancelAssignment(id: ID, user: User): Promise<void> {
    guardManage(user);
    const a = byId(assignments, id);
    if (!a || !['returned', 'rejected', 'approved'].includes(a.status)) throw new FleetError('not_allowed');
    a.status = 'cancelled';
    a.history.push(ev(user.id, 'status_changed', 'cancelled'));
    emit();
    await delay(null);
  },
  /** Акт приёма-передачи: фиксация пробега, топлива и состояния; применяет закрепление (PR-FLT-032, 044, 045). */
  async completeAct(id: ID, input: { date: string; odometer: number; fuelLevel: number; checklist: Record<FleetChecklistItem, boolean>; defects: string }, user: User): Promise<void> {
    guardManage(user);
    const a = byId(assignments, id);
    if (!a || a.status !== 'approved') throw new FleetError('not_allowed');
    const v = vehicleOr404(a.vehicleId);
    if (!input.date || input.date > today()) throw new FleetError('date');
    if (!isInt(input.odometer) || input.odometer < v.mileage) throw new FleetError('odometer');
    if (!(input.fuelLevel >= 0) || input.fuelLevel > v.tankLitres) throw new FleetError('fuel');
    if (Object.values(input.checklist).some((ok) => !ok) && !input.defects.trim()) throw new FleetError('required');
    if (openTripOf(v.id)) throw new FleetError('vehicle_busy');
    a.act = { number: `AP-${a.number.slice(3)}`, date: input.date, odometer: input.odometer, fuelLevel: input.fuelLevel, checklist: input.checklist, defects: input.defects.trim(), completedBy: user.id, completedAt: now() };
    a.status = 'completed';
    a.effectiveFrom = input.date;
    a.history.push(ev(user.id, 'status_changed', 'act'));
    // закрыть предыдущий период закрепления той же роли
    for (const prev of assignments.filter((x) => x.id !== a.id && x.vehicleId === v.id && x.role === a.role && x.status === 'completed' && !x.effectiveTo)) prev.effectiveTo = fleetAddDays(input.date, -1);
    const before = { primaryDriverId: v.primaryDriverId ?? '', reserveDriverId: v.reserveDriverId ?? '', mileage: v.mileage };
    if (a.role === 'primary') {
      v.primaryDriverId = a.driverId;
      if (v.reserveDriverId === a.driverId) v.reserveDriverId = undefined;
    } else v.reserveDriverId = a.driverId;
    v.mileage = input.odometer;
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, changes: diffFields(before, { primaryDriverId: v.primaryDriverId ?? '', reserveDriverId: v.reserveDriverId ?? '', mileage: v.mileage }), details: `${a.number} / ${a.act.number}` });
    const du = byId(drivers, a.driverId)?.userId;
    if (du) notify({ userIds: [du], title: { key: 'fleet_n_assigned', params: { plate: v.plate } }, body: `${a.number} · ${a.act.number}`, link: '/fleet/my', level: 'info', kind: 'system' });
    emit();
    await delay(null);
  },

  // ----- путевые листы -----
  listTrips(filter: FleetTripFilter = {}): Promise<FleetTrip[]> {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      trips
        .filter((t) => (!filter.vehicleId || t.vehicleId === filter.vehicleId) && (!filter.driverId || t.driverId === filter.driverId) && (!filter.status || t.status === filter.status))
        .filter((t) => (!filter.from || t.date >= filter.from) && (!filter.to || t.date <= filter.to))
        .filter((t) => !q || [t.number, t.routeFrom, t.routeTo, t.waypoints, t.purpose].some((s) => s.toLowerCase().includes(q)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)),
    );
  },
  getTrip: (id: ID) => delay(byId(trips, id)),
  /** Открыть путевой лист → подпись диспетчера (маршрут согласования). Водитель — только на закреплённое ТС. */
  async openTrip(input: FleetTripInput, user: User): Promise<FleetTrip> {
    const v = vehicleOr404(input.vehicleId);
    if (!fleetCanManage(user) && !(isVehicleDriver(user, v) && driverOfUser(user.id)?.id === input.driverId)) throw new FleetError('forbidden');
    validateTripInput(input, v);
    const t: FleetTrip = {
      id: nextId('ft'), number: nextNumber('PL'), vehicleId: v.id, driverId: input.driverId, status: 'pending', date: input.date, departTime: input.departTime, returnDate: input.returnDate, returnTime: input.returnTime,
      routeFrom: input.routeFrom.trim(), routeTo: input.routeTo.trim(), waypoints: input.waypoints.trim(), purpose: input.purpose.trim(), city: input.city, odoStart: input.odoStart, fuelStart: input.fuelStart,
      costCenterKey: v.costCenterKey, createdBy: user.id, createdAt: now(), history: [ev(user.id, 'submitted')],
    };
    trips.push(t);
    approvalEngine.open({ entity: 'fleet_trip', entityId: t.id, number: t.number, title: `${v.plate} · ${t.routeFrom} → ${t.routeTo}`, requesterId: user.id, context: { subtype: v.purpose, orgUnitKey: v.orgUnitKey } });
    audit.log({ user: actor(user), action: 'submit', entity: 'fleet_trip', entityId: t.id, entityLabel: t.number, details: `${v.plate} · ${t.date} ${t.departTime}` });
    emit();
    return delay(t);
  },
  /** Исправить возвращённый путевой лист и отправить повторно. */
  async resubmitTrip(id: ID, input: FleetTripInput, user: User): Promise<void> {
    const t = byId(trips, id);
    if (!t || (t.status !== 'returned' && t.status !== 'rejected')) throw new FleetError('not_allowed');
    const v = vehicleOr404(t.vehicleId);
    if (!fleetCanManage(user) && t.createdBy !== user.id) throw new FleetError('forbidden');
    validateTripInput({ ...input, vehicleId: t.vehicleId }, v, t.id);
    Object.assign(t, { driverId: input.driverId, date: input.date, departTime: input.departTime, returnDate: input.returnDate, returnTime: input.returnTime, routeFrom: input.routeFrom.trim(), routeTo: input.routeTo.trim(), waypoints: input.waypoints.trim(), purpose: input.purpose.trim(), city: input.city, odoStart: input.odoStart, fuelStart: input.fuelStart });
    approvalEngine.resubmit(t.id, user);
    t.status = 'pending';
    emit();
    await delay(null);
  },
  async cancelTrip(id: ID, user: User): Promise<void> {
    const t = byId(trips, id);
    if (!t || !['returned', 'rejected', 'pending'].includes(t.status)) throw new FleetError('not_allowed');
    if (!fleetCanManage(user) && t.createdBy !== user.id) throw new FleetError('forbidden');
    if (t.status === 'pending') {
      const task = approvalEngine.openFor(t.id);
      if (task) throw new FleetError('not_allowed');
    }
    t.status = 'cancelled';
    t.history.push(ev(user.id, 'status_changed', 'cancelled'));
    emit();
    await delay(null);
  },
  /** Закрыть путевой лист: возврат, одометр, остаток топлива; расход = остаток при выезде + заправки − остаток при возврате. */
  async closeTrip(id: ID, input: FleetTripCloseInput, user: User): Promise<FleetTrip> {
    const t = byId(trips, id);
    if (!t || t.status !== 'open') throw new FleetError('not_allowed');
    const v = vehicleOr404(t.vehicleId);
    if (!fleetCanManage(user) && driverOfUser(user.id)?.id !== t.driverId) throw new FleetError('forbidden');
    if (!input.returnDate || !TIME_RE.test(input.returnTime)) throw new FleetError('time');
    if (`${input.returnDate}T${input.returnTime}` <= `${t.date}T${t.departTime}`) throw new FleetError('return_before_depart');
    if (input.returnDate > today()) throw new FleetError('date');
    if (!isInt(input.odoEnd) || input.odoEnd <= t.odoStart) throw new FleetError('odometer');
    const refuel = tripRefuels(t.id);
    if (!(input.fuelEnd >= 0) || input.fuelEnd > t.fuelStart + refuel) throw new FleetError('fuel_balance');
    const km = input.odoEnd - t.odoStart;
    const used = Math.round((t.fuelStart + refuel - input.fuelEnd) * 10) / 10;
    const norm = fleetNormLitres(v, km, t.date, t.city);
    const over = used > norm * (1 + settings.overrunTolerancePct / 100);
    if (over && !input.overrunReason?.trim()) throw new FleetError('overrun_reason', `${used}/${norm}`);
    Object.assign(t, { status: 'closed', returnDate: input.returnDate, returnTime: input.returnTime, odoEnd: input.odoEnd, fuelEnd: input.fuelEnd, fuelUsed: used, fuelNormUsed: norm, closedBy: user.id, closedAt: now() });
    if (over) t.overrunReason = input.overrunReason!.trim();
    t.history.push(ev(user.id, 'status_changed', 'closed'));
    v.mileage = Math.max(v.mileage, input.odoEnd);
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_trip', entityId: t.id, entityLabel: t.number, details: `закрыт: ${km} км, ${used} л (норма ${norm})` });
    if (over)
      notify({ userIds: managersFor(v.orgUnitKey), excludeIds: [user.id], title: { key: 'fleet_n_overrun', params: { number: t.number } }, body: `${v.plate}: ${used} / ${norm} (+${fleetDeviationPct(used, norm)}%) · ${t.overrunReason}`, link: `/fleet/trips/${t.id}`, level: 'warning', kind: 'system' });
    emit();
    return delay(t);
  },
  /** Расчёт нормы для формы закрытия (без сохранения). */
  previewClose(id: ID, odoEnd: number, fuelEnd: number): { km: number; used: number; norm: number; deviationPct: number; over: boolean; refuel: number } | null {
    const t = byId(trips, id);
    const v = t ? byId(vehicles, t.vehicleId) : undefined;
    if (!t || !v || !(odoEnd > t.odoStart)) return null;
    const refuel = tripRefuels(t.id);
    const km = odoEnd - t.odoStart;
    const used = Math.round((t.fuelStart + refuel - fuelEnd) * 10) / 10;
    const norm = fleetNormLitres(v, km, t.date, t.city);
    return { km, used, norm, deviationPct: fleetDeviationPct(used, norm), over: used > norm * (1 + settings.overrunTolerancePct / 100), refuel };
  },

  // ----- генераторы: журнал работы -----
  listRunLogs: (vehicleId?: ID) => delay(runLogs.filter((r) => !vehicleId || r.vehicleId === vehicleId).sort((a, b) => b.date.localeCompare(a.date))),
  async addRunLog(vehicleId: ID, input: { date: string; hoursEnd: number; fuelUsed: number; note: string }, user: User): Promise<FleetRunLog> {
    guardManage(user);
    const v = vehicleOr404(vehicleId);
    if (v.kind !== 'generator') throw new FleetError('generator_only');
    if (!input.date || input.date > today()) throw new FleetError('date');
    if (!(input.hoursEnd > v.mileage)) throw new FleetError('odometer');
    if (!(input.fuelUsed > 0)) throw new FleetError('fuel');
    const hours = Math.round((input.hoursEnd - v.mileage) * 10) / 10;
    const r: FleetRunLog = { id: nextId('frl'), vehicleId, date: input.date, hoursStart: v.mileage, hoursEnd: input.hoursEnd, fuelUsed: input.fuelUsed, fuelNormUsed: fleetNormLitres(v, hours, input.date), note: input.note.trim(), userId: user.id };
    runLogs.push(r);
    v.mileage = input.hoursEnd;
    audit.log({ user: actor(user), action: 'create', entity: 'fleet_vehicle', entityId: v.id, entityLabel: v.plate, details: `моточасы ${r.hoursStart}→${r.hoursEnd}, ${r.fuelUsed} л (норма ${r.fuelNormUsed})` });
    emit();
    return delay(r);
  },

  // ----- ГСМ -----
  listFuelUps: (filter: FleetListFilter & { source?: FleetFuelUp['source']; tripId?: ID } = {}) =>
    delay(fuelUps.filter((f) => (!filter.vehicleId || f.vehicleId === filter.vehicleId) && (!filter.driverId || f.driverId === filter.driverId) && (!filter.source || f.source === filter.source) && (!filter.tripId || f.tripId === filter.tripId) && inPeriod(f.date, filter)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))),
  limitUsage: (vehicleId: ID, month = today().slice(0, 7)) => {
    const v = byId(vehicles, vehicleId);
    return delay({ ...limitUsage(vehicleId, month), limitLitres: v?.limitLitres ?? 0, limitSum: v?.limitSum ?? 0 });
  },
  /** Регистрация заправки (дата, АЗС, вид, объём, сумма); привязка к путевому листу; контроль лимита. */
  async addFuelUp(input: FleetFuelUpInput, user: User): Promise<FleetFuelUp> {
    const v = vehicleOr404(input.vehicleId);
    const self = isVehicleDriver(user, v);
    if (!fleetCanManage(user) && !self) throw new FleetError('forbidden');
    if (v.status === 'written_off') throw new FleetError('not_allowed');
    if (!input.date || !input.station.trim()) throw new FleetError('required');
    if (input.date > today()) throw new FleetError('date');
    if (!(input.litres > 0) || input.litres > v.tankLitres * 1.05) throw new FleetError('fuel');
    if (!isInt(input.amount) || input.amount <= 0) throw new FleetError('amount');
    if (input.fuel !== v.fuel) throw new FleetError('fuel_type');
    let card: FleetFuelCard | undefined;
    if (input.cardId) {
      card = byId(cards, input.cardId);
      if (!card || card.vehicleId !== v.id || card.status !== 'active') throw new FleetError('card');
      if (card.balance < input.amount) throw new FleetError('card_balance');
    }
    if (input.tripId) {
      const t = byId(trips, input.tripId);
      if (!t || t.vehicleId !== v.id || t.status !== 'open') throw new FleetError('not_allowed');
    }
    const month = input.date.slice(0, 7);
    const u = limitUsage(v.id, month, { litres: input.litres, amount: input.amount });
    const over = (v.limitLitres > 0 && u.litres > v.limitLitres) || (v.limitSum > 0 && u.amount > v.limitSum);
    if (over && !input.overLimitReason?.trim()) throw new FleetError('over_limit', `${u.litres}/${v.limitLitres} · ${u.amount}/${v.limitSum}`);
    const me = driverOfUser(user.id);
    const f: FleetFuelUp = {
      id: nextId('ff'), number: nextNumber('GSM'), vehicleId: v.id, ...(input.driverId ? { driverId: input.driverId } : self && me ? { driverId: me.id } : {}), ...(input.tripId ? { tripId: input.tripId } : {}),
      date: input.date, station: input.station.trim(), fuel: input.fuel, litres: input.litres, amount: input.amount, ...(card ? { cardId: card.id } : {}),
      source: card ? 'card' : self && !fleetCanManage(user) ? 'driver' : 'manual', ...(over ? { overLimit: true, overLimitReason: input.overLimitReason!.trim() } : {}),
      costCenterKey: input.costCenterKey || v.costCenterKey, createdBy: user.id,
    };
    fuelUps.push(f);
    if (card) card.balance -= input.amount;
    addPosting('fuel', f.id, f.number, v.id, f.costCenterKey, f.amount, f.date, `ГСМ ${v.plate}: ${f.litres} л, ${f.station}`, card ? { credit: FLEET_CARD_ACCOUNT } : {});
    audit.log({ user: actor(user), action: 'create', entity: 'fleet_fuel', entityId: f.id, entityLabel: f.number, details: `${v.plate}: ${f.litres} л / ${f.amount}${over ? ' · сверх лимита' : ''}` });
    if (over) notify({ userIds: managersFor(v.orgUnitKey), excludeIds: [user.id], title: { key: 'fleet_n_overLimit', params: { plate: v.plate } }, body: `${f.number}: ${u.litres} / ${v.limitLitres} · ${f.overLimitReason}`, link: `/fleet/${v.id}`, level: 'warning', kind: 'system' });
    emit();
    return delay(f);
  },

  // ----- топливные карты -----
  listCards: () => delay(cards),
  async setCardStatus(id: ID, status: FleetFuelCard['status'], user: User): Promise<void> {
    guardManage(user);
    const c = byId(cards, id);
    if (!c) throw new FleetError('not_found');
    const from = c.status;
    c.status = status;
    audit.log({ user: actor(user), action: status === 'blocked' ? 'block' : 'unblock', entity: 'fleet_card', entityId: c.id, entityLabel: c.number, changes: [{ field: 'status', from, to: status }] });
    emit();
    await delay(null);
  },
  async setCardLimit(id: ID, monthlyLimit: number, user: User): Promise<void> {
    guardManage(user);
    const c = byId(cards, id);
    if (!c) throw new FleetError('not_found');
    if (!isInt(monthlyLimit) || monthlyLimit < 0) throw new FleetError('amount');
    const from = String(c.monthlyLimit);
    c.monthlyLimit = monthlyLimit;
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_card', entityId: c.id, entityLabel: c.number, changes: [{ field: 'monthlyLimit', from, to: String(monthlyLimit) }] });
    emit();
    await delay(null);
  },
  /** Остаток лимита карты на период (лимит − уже распоряжено в этом периоде). */
  cardRemaining(cardId: ID, period: string, excludeTopUpId?: ID): number {
    const c = byId(cards, cardId);
    if (!c) return 0;
    const used = topUps.filter((t) => t.id !== excludeTopUpId && t.period === period && !['rejected', 'draft'].includes(t.status)).reduce((a, t) => a + t.lines.filter((l) => l.cardId === cardId).reduce((s, l) => s + l.amount, 0), 0);
    return Math.max(0, c.monthlyLimit - used);
  },
  listTopUps: () => delay([...topUps].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getTopUp: (id: ID) => delay(byId(topUps, id)),
  /** Электронное распоряжение на зачисление средств на топливные карты в пределах лимитов. */
  async createTopUp(input: { period: string; lines: { cardId: ID; amount: number }[]; comment: string }, user: User): Promise<FleetTopUp> {
    guardManage(user);
    if (!/^\d{4}-\d{2}$/.test(input.period)) throw new FleetError('date');
    const lines = input.lines.filter((l) => l.amount > 0);
    if (!lines.length) throw new FleetError('no_lines');
    for (const l of lines) {
      const c = byId(cards, l.cardId);
      if (!c || c.status !== 'active') throw new FleetError('card');
      if (!isInt(l.amount)) throw new FleetError('amount');
      if (l.amount > fleetApi.cardRemaining(l.cardId, input.period)) throw new FleetError('card_limit', c.number);
    }
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const t: FleetTopUp = { id: nextId('tu'), number: nextNumber('TU'), period: input.period, lines: lines.map((l) => ({ cardId: l.cardId, amount: l.amount })), total, status: 'pending', comment: input.comment.trim(), createdBy: user.id, createdAt: now(), history: [ev(user.id, 'submitted')] };
    topUps.push(t);
    approvalEngine.open({ entity: 'fleet_topup', entityId: t.id, number: t.number, title: `Зачисление на топливные карты, ${t.period}`, requesterId: user.id, amount: total, currency: 'UZS', context: { amount: total } });
    audit.log({ user: actor(user), action: 'submit', entity: 'fleet_topup', entityId: t.id, entityLabel: t.number, details: `${t.period}: ${lines.length} карт, ${total}` });
    emit();
    return delay(t);
  },
  /** Сверка распоряжения с журналом обмена iABS; повтор неуспешных зачислений. */
  async reconcileTopUp(id: ID, user: User): Promise<FleetTopUp> {
    guardManage(user);
    const t = byId(topUps, id);
    if (!t || !['sent', 'failed'].includes(t.status)) throw new FleetError('not_allowed');
    for (const line of t.lines.filter((l) => l.state !== 'success')) {
      if (!line.exchangeId) continue;
      let rec = await integrationHub.getExchange(line.exchangeId);
      if (rec && (rec.status === 'failed' || rec.status === 'quarantined')) rec = await integrationHub.retry(rec.id, user.id);
      if (rec) applyTopUpLine(t, line, rec.status);
    }
    if (t.lines.some((l) => !l.exchangeId && l.state !== 'success')) await executeTopUp(t, user.id);
    finishTopUp(t);
    emit();
    return delay(t);
  },
  /** Загрузка транзакций процессинга топливных карт → заправки (источник «карта») и проводки. */
  async syncCardTransactions(user: User): Promise<{ created: number; status: string }> {
    guardManage(user);
    const active = cards.filter((c) => c.status === 'active');
    const payload = { cards: active.map((c) => ({ card: c.number, fuel: byId(vehicles, c.vehicleId)?.fuel ?? 'petrol', price: settings.fuelPrices[byId(vehicles, c.vehicleId)?.fuel ?? 'petrol'] })), since: fleetAddDays(today(), -1) };
    const rec = await integrationHub.call('payments', 'fuelcard.transactions', payload, { userId: user.id });
    let created = 0;
    if (rec.status === 'success') {
      const list = ((rec.response?.transactions ?? []) as { id: string; card: string; litres: number; amount: number; station: string }[]);
      for (const tx of list) {
        if (fuelUps.some((f) => f.externalId === tx.id)) continue;
        const c = active.find((x) => x.number === tx.card);
        const v = c ? byId(vehicles, c.vehicleId) : undefined;
        if (!c || !v || c.balance < tx.amount) continue;
        const f: FleetFuelUp = { id: nextId('ff'), number: nextNumber('GSM'), vehicleId: v.id, ...(c.driverId ? { driverId: c.driverId } : {}), ...(openTripOf(v.id) ? { tripId: openTripOf(v.id)!.id } : {}), date: today(), station: tx.station, fuel: v.fuel, litres: tx.litres, amount: tx.amount, cardId: c.id, source: 'card', externalId: tx.id, costCenterKey: v.costCenterKey, createdBy: user.id };
        const u = limitUsage(v.id, f.date.slice(0, 7), { litres: f.litres, amount: f.amount });
        if ((v.limitLitres > 0 && u.litres > v.limitLitres) || (v.limitSum > 0 && u.amount > v.limitSum)) {
          f.overLimit = true;
          f.overLimitReason = 'Транзакция процессинга сверх лимита';
        }
        fuelUps.push(f);
        c.balance -= tx.amount;
        addPosting('fuel', f.id, f.number, v.id, f.costCenterKey, f.amount, f.date, `ГСМ ${v.plate}: ${f.litres} л, ${f.station}`, { credit: FLEET_CARD_ACCOUNT });
        created++;
      }
    }
    audit.log({ user: actor(user), action: 'create', entity: 'fleet_card', entityId: rec.id, details: `транзакции карт: ${rec.status}, создано заправок ${created}` });
    emit();
    return delay({ created, status: rec.status });
  },

  // ----- ТО и ремонт -----
  listServices: (filter: FleetListFilter & { kind?: FleetService['kind']; status?: FleetService['status'] } = {}) =>
    delay(services.filter((s) => (!filter.vehicleId || s.vehicleId === filter.vehicleId) && (!filter.kind || s.kind === filter.kind) && (!filter.status || s.status === filter.status) && inPeriod(s.doneDate ?? s.date, filter)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))),
  getService: (id: ID) => delay(byId(services, id)),
  async createService(input: FleetServiceInput, user: User): Promise<FleetService> {
    guardManage(user);
    const v = vehicleOr404(input.vehicleId);
    if (v.status === 'written_off') throw new FleetError('not_allowed');
    if (!input.date || !input.fault.trim()) throw new FleetError('required');
    if (input.date > today()) throw new FleetError('date');
    if (!isInt(input.odometer) || input.odometer < 0) throw new FleetError('odometer');
    validateLines(input.works, input.parts);
    if (input.takeOffline && openTripOf(v.id)) throw new FleetError('vehicle_busy');
    const s: FleetService = {
      id: nextId('fs'), number: nextNumber(input.kind === 'maintenance' ? 'TO' : 'TR'), vehicleId: v.id, kind: input.kind, status: 'open', date: input.date, odometer: input.odometer, fault: input.fault.trim(),
      works: input.works.map((w) => ({ ...w, name: w.name.trim() })), parts: input.parts.map((p) => ({ ...p, name: p.name.trim() })), ...(input.contractorId ? { contractorId: input.contractorId } : {}),
      warranty: input.warranty, warrantyNote: input.warrantyNote.trim(), ...(input.faultReportId ? { faultReportId: input.faultReportId } : {}), costCenterKey: input.costCenterKey || v.costCenterKey, createdBy: user.id,
      tookOffline: input.takeOffline && v.status !== 'repair' ? true : input.takeOffline,
    };
    services.push(s);
    if (input.takeOffline && v.status !== 'repair') setStatusInternal(v, 'repair', user.id, s.number);
    if (input.faultReportId) {
      const fr = byId(faults, input.faultReportId);
      if (fr) {
        fr.status = 'in_repair';
        fr.serviceId = s.id;
      }
    }
    audit.log({ user: actor(user), action: 'create', entity: 'fleet_service', entityId: s.id, entityLabel: s.number, details: `${v.plate}: ${s.fault}` });
    emit();
    return delay(s);
  },
  async updateService(id: ID, patch: { works: FleetWorkLine[]; parts: FleetPartLine[]; contractorId?: ID; warranty: boolean; warrantyNote: string; fault: string }, user: User): Promise<void> {
    guardManage(user);
    const s = byId(services, id);
    if (!s || s.status !== 'open') throw new FleetError('not_allowed');
    if (!patch.fault.trim()) throw new FleetError('required');
    validateLines(patch.works, patch.parts);
    const before = { total: fleetServiceTotal(s).total, contractorId: s.contractorId ?? '', warranty: s.warranty, fault: s.fault };
    Object.assign(s, { works: patch.works, parts: patch.parts, warranty: patch.warranty, warrantyNote: patch.warrantyNote.trim(), fault: patch.fault.trim() });
    if (patch.contractorId) s.contractorId = patch.contractorId;
    else delete s.contractorId;
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_service', entityId: s.id, entityLabel: s.number, changes: diffFields(before, { total: fleetServiceTotal(s).total, contractorId: s.contractorId ?? '', warranty: s.warranty, fault: s.fault }) });
    emit();
    await delay(null);
  },
  /** Завершить ТО/ремонт: стоимость (кроме гарантийного), проводка, возврат ТС в эксплуатацию, сброс планового ТО. */
  async completeService(id: ID, input: { doneDate: string }, user: User): Promise<void> {
    guardManage(user);
    const s = byId(services, id);
    if (!s || s.status !== 'open') throw new FleetError('not_allowed');
    const v = vehicleOr404(s.vehicleId);
    if (!input.doneDate || input.doneDate < s.date || input.doneDate > today()) throw new FleetError('date');
    if (!s.works.length && !s.parts.length) throw new FleetError('no_lines');
    if (!s.contractorId) throw new FleetError('required');
    s.status = 'done';
    s.doneDate = input.doneDate;
    if (s.kind === 'maintenance') {
      v.lastServiceKm = Math.max(s.odometer, v.lastServiceKm);
      v.lastServiceDate = input.doneDate;
    }
    v.mileage = Math.max(v.mileage, s.odometer);
    const stillOpen = services.some((x) => x.id !== s.id && x.vehicleId === v.id && x.status === 'open' && x.tookOffline);
    if (v.status === 'repair' && !stillOpen) setStatusInternal(v, 'in_operation', user.id, s.number);
    const cost = fleetServiceCost(s);
    addPosting(s.kind === 'maintenance' ? 'maintenance' : 'repair', s.id, s.number, v.id, s.costCenterKey, cost, input.doneDate, `${s.kind === 'maintenance' ? 'ТО' : 'Ремонт'} ${v.plate}: ${s.fault}`);
    const fr = byId(faults, s.faultReportId);
    if (fr) fr.status = 'closed';
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_service', entityId: s.id, entityLabel: s.number, changes: [{ field: 'status', from: 'open', to: 'done' }], details: `${cost}${s.warranty ? ' (гарантия)' : ''}` });
    emit();
    await delay(null);
  },
  async cancelService(id: ID, user: User): Promise<void> {
    guardManage(user);
    const s = byId(services, id);
    if (!s || s.status !== 'open') throw new FleetError('not_allowed');
    s.status = 'cancelled';
    const v = vehicleOr404(s.vehicleId);
    if (v.status === 'repair' && !services.some((x) => x.vehicleId === v.id && x.status === 'open' && x.tookOffline)) setStatusInternal(v, 'in_operation', user.id, `${s.number}: отменён`);
    const fr = byId(faults, s.faultReportId);
    if (fr) fr.status = 'new';
    emit();
    await delay(null);
  },

  // ----- неисправности от водителя -----
  listFaults: (filter: { vehicleId?: ID; driverId?: ID; status?: FleetFaultReport['status'] } = {}) =>
    delay(faults.filter((f) => (!filter.vehicleId || f.vehicleId === filter.vehicleId) && (!filter.driverId || f.driverId === filter.driverId) && (!filter.status || f.status === filter.status)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))),
  async reportFault(input: { vehicleId: ID; description: string; severity: FleetFaultReport['severity'] }, user: User): Promise<FleetFaultReport> {
    const v = vehicleOr404(input.vehicleId);
    const me = driverOfUser(user.id);
    if (!fleetCanManage(user) && !isVehicleDriver(user, v)) throw new FleetError('forbidden');
    if (!input.description.trim()) throw new FleetError('required');
    const driverId = me?.id ?? v.primaryDriverId;
    if (!driverId) throw new FleetError('driver_not_assigned');
    const f: FleetFaultReport = { id: nextId('fr'), number: nextNumber('NS'), vehicleId: v.id, driverId, date: today(), description: input.description.trim(), severity: input.severity, status: 'new', createdBy: user.id };
    faults.push(f);
    notify({ userIds: managersFor(v.orgUnitKey), excludeIds: [user.id], title: { key: 'fleet_n_fault', params: { plate: v.plate } }, body: `${f.number}: ${f.description}`, link: `/fleet/${v.id}`, level: input.severity === 'high' ? 'danger' : 'warning', kind: 'system' });
    audit.log({ user: actor(user), action: 'create', entity: 'fleet_fault', entityId: f.id, entityLabel: f.number, details: `${v.plate}: ${f.description}` });
    emit();
    return delay(f);
  },

  // ----- прочие расходы и штрафы -----
  listExpenses: (filter: FleetListFilter & { kind?: FleetExpense['kind'] } = {}) =>
    delay(expenses.filter((e) => (!filter.vehicleId || e.vehicleId === filter.vehicleId) && (!filter.kind || e.kind === filter.kind) && (!filter.driverId || e.driverId === filter.driverId) && inPeriod(e.date, filter)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))),
  async addExpense(input: FleetExpenseInput, user: User): Promise<FleetExpense> {
    guardManage(user);
    const v = vehicleOr404(input.vehicleId);
    if (!input.date || !input.description.trim()) throw new FleetError('required');
    if (input.date > today()) throw new FleetError('date');
    if (!isInt(input.amount) || input.amount <= 0) throw new FleetError('amount');
    const e: FleetExpense = { id: nextId('fx'), number: nextNumber('PR'), vehicleId: v.id, kind: input.kind, date: input.date, amount: input.amount, description: input.description.trim(), ...(input.contractorId ? { contractorId: input.contractorId } : {}), ...(input.driverId ? { driverId: input.driverId } : {}), costCenterKey: input.costCenterKey || v.costCenterKey, createdBy: user.id };
    expenses.push(e);
    addPosting('other', e.id, e.number, v.id, e.costCenterKey, e.amount, e.date, `${e.description} (${v.plate})`);
    audit.log({ user: actor(user), action: 'create', entity: 'fleet_expense', entityId: e.id, entityLabel: e.number, details: `${v.plate}: ${input.kind} ${e.amount}` });
    emit();
    return delay(e);
  },
  listFines: (filter: FleetListFilter & { status?: FleetFineStatus } = {}) =>
    delay(fines.filter((f) => (!filter.vehicleId || f.vehicleId === filter.vehicleId) && (!filter.driverId || f.driverId === filter.driverId) && (!filter.status || f.status === filter.status) && inPeriod(f.date, filter)).sort((a, b) => b.date.localeCompare(a.date))),
  async addFine(input: FleetFineInput, user: User): Promise<FleetFine> {
    guardManage(user);
    const v = vehicleOr404(input.vehicleId);
    if (!input.date || !input.protocolNo.trim() || !input.violation.trim()) throw new FleetError('required');
    if (input.date > today()) throw new FleetError('date');
    if (!isInt(input.amount) || input.amount <= 0) throw new FleetError('amount');
    if (fines.some((f) => f.protocolNo === input.protocolNo.trim())) throw new FleetError('duplicate_pending');
    const f: FleetFine = { id: nextId('fn'), vehicleId: v.id, ...(input.driverId ? { driverId: input.driverId } : v.primaryDriverId ? { driverId: v.primaryDriverId } : {}), date: input.date, protocolNo: input.protocolNo.trim(), violation: input.violation.trim(), amount: input.amount, status: 'unpaid', source: 'manual', recoverFromDriver: false, costCenterKey: v.costCenterKey };
    fines.push(f);
    audit.log({ user: actor(user), action: 'create', entity: 'fleet_fine', entityId: f.id, entityLabel: f.protocolNo, details: `${v.plate}: ${f.amount}` });
    emit();
    return delay(f);
  },
  async setFineStatus(id: ID, status: FleetFineStatus, user: User, opts: { recoverFromDriver?: boolean } = {}): Promise<void> {
    guardManage(user);
    const f = byId(fines, id);
    if (!f || f.status === 'paid' || f.status === 'cancelled') throw new FleetError('not_allowed');
    const from = f.status;
    f.status = status;
    if (opts.recoverFromDriver !== undefined) f.recoverFromDriver = opts.recoverFromDriver;
    if (status === 'paid') {
      f.paidAt = today();
      const v = byId(vehicles, f.vehicleId);
      addPosting('fine', f.id, f.protocolNo, f.vehicleId, f.costCenterKey, f.amount, f.paidAt, `Штраф ${v?.plate ?? ''}: ${f.violation}`);
    }
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_fine', entityId: f.id, entityLabel: f.protocolNo, changes: [{ field: 'status', from, to: status }] });
    emit();
    await delay(null);
  },
  async setFineRecovery(id: ID, recover: boolean, user: User): Promise<void> {
    guardManage(user);
    const f = byId(fines, id);
    if (!f) throw new FleetError('not_found');
    f.recoverFromDriver = recover;
    audit.log({ user: actor(user), action: 'update', entity: 'fleet_fine', entityId: f.id, entityLabel: f.protocolNo, changes: [{ field: 'recoverFromDriver', from: String(!recover), to: String(recover) }] });
    emit();
    await delay(null);
  },
  /**
   * Обновление штрафов из УБДД (интеграционная шина): по каждому ТС. Новые постановления добавляются (по номеру протокола —
   * без дублей при повторном запросе), по имеющимся обновляется статус оплаты (оплачен в УБДД → «Оплачен» + проводка).
   */
  async fetchFines(user: User): Promise<{ checked: number; created: number; updated: number; failed: number }> {
    guardManage(user);
    let created = 0;
    let updated = 0;
    let failed = 0;
    const list = vehicles.filter((v) => v.kind === 'vehicle' && v.status !== 'written_off');
    for (const v of list) {
      const rec = await integrationHub.call('ubdd', 'fines.get', { plate: normPlate(v.plate) }, { userId: user.id });
      if (rec.status !== 'success') {
        failed++;
        continue;
      }
      const items = ((rec.response as { fines?: unknown } | undefined)?.fines ?? []) as { protocolNo: string; date: string; violation: string; amount: number; paid?: boolean }[];
      for (const it of Array.isArray(items) ? items : []) {
        if (!it?.protocolNo || !(it.amount > 0)) continue;
        const existing = fines.find((f) => f.protocolNo === it.protocolNo);
        if (existing) {
          if (it.paid && (existing.status === 'unpaid' || existing.status === 'disputed')) {
            const from = existing.status;
            existing.status = 'paid';
            existing.paidAt = today();
            existing.exchangeId = rec.id;
            addPosting('fine', existing.id, existing.protocolNo, existing.vehicleId, existing.costCenterKey, existing.amount, existing.paidAt, `Штраф ${v.plate}: ${existing.violation}`);
            audit.log({ user: actor(user), action: 'update', entity: 'fleet_fine', entityId: existing.id, entityLabel: existing.protocolNo, changes: [{ field: 'status', from, to: 'paid' }], details: 'УБДД' });
            updated++;
          }
          continue;
        }
        const date = it.date && it.date <= today() ? it.date : today();
        const f: FleetFine = {
          id: nextId('fn'), vehicleId: v.id, ...(v.primaryDriverId ? { driverId: v.primaryDriverId } : {}), date, protocolNo: it.protocolNo, violation: it.violation || '—', amount: Math.round(it.amount),
          status: it.paid ? 'paid' : 'unpaid', source: 'ubdd', recoverFromDriver: false, exchangeId: rec.id, costCenterKey: v.costCenterKey, ...(it.paid ? { paidAt: date } : {}),
        };
        fines.push(f);
        if (it.paid) addPosting('fine', f.id, f.protocolNo, v.id, f.costCenterKey, f.amount, date, `Штраф ${v.plate}: ${f.violation}`);
        created++;
      }
    }
    if (created) notify({ userIds: managersFor('d2'), excludeIds: [user.id], title: { key: 'fleet_n_fines', params: { count: String(created) } }, link: '/fleet/expenses?tab=fines', level: 'warning', kind: 'system' });
    audit.log({ user: actor(user), action: 'create', entity: 'fleet_fine', entityId: 'ubdd', details: `УБДД: проверено ${list.length}, новых ${created}, обновлено ${updated}, ошибок ${failed}` });
    emit();
    return delay({ checked: list.length, created, updated, failed });
  },

  // ----- проводки -----
  async listPostings(filter: { status?: FleetPosting['status']; source?: FleetPostingSource; vehicleId?: ID; from?: string; to?: string } = {}): Promise<FleetPosting[]> {
    // обновить статусы отправленных пакетов по журналу обмена (очередь iABS)
    for (const p of postings.filter((x) => x.status === 'queued' && x.exchangeId)) {
      const rec = await integrationHub.getExchange(p.exchangeId!);
      if (rec?.status === 'success') {
        p.status = 'posted';
        p.postedAt = rec.updatedAt;
      } else if (rec && (rec.status === 'failed' || rec.status === 'quarantined' || rec.status === 'discarded')) {
        p.status = 'failed';
        p.error = rec.errorMessage ?? rec.error ?? rec.status;
      }
    }
    return delay(
      postings
        .filter((p) => (!filter.status || p.status === filter.status) && (!filter.source || p.source === filter.source) && (!filter.vehicleId || p.vehicleId === filter.vehicleId) && (!filter.from || p.date >= filter.from) && (!filter.to || p.date <= filter.to))
        .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)),
    );
  },
  /** Отправить проводки пакетом в iABS (контрольная сумма, идемпотентность по номеру пакета). */
  async sendPostings(ids: ID[], user: User): Promise<{ batch: string; status: string; count: number; amount: number }> {
    if (!fleetCanPost(user)) throw new FleetError('forbidden');
    const list = postings.filter((p) => ids.includes(p.id) && (p.status === 'draft' || p.status === 'failed'));
    if (!list.length) throw new FleetError('no_lines');
    const batch = `PK-${today().replace(/-/g, '')}-FL-${nextId('').slice(-4)}`;
    const amount = list.reduce((a, p) => a + p.amount, 0);
    list.forEach((p) => {
      p.status = 'sending';
      p.batch = batch;
      delete p.error;
    });
    emit();
    const payload = { batch, entries: list.map((p) => ({ debit: p.debit, credit: p.credit, amount: p.amount, costCenter: p.costCenterKey, ref: p.number })), controlSum: amount };
    const rec = await integrationHub.call('iabs', 'postings.batch', payload, { userId: user.id, idempotencyKey: batch });
    for (const p of list) {
      p.exchangeId = rec.id;
      if (rec.status === 'success') {
        p.status = 'posted';
        p.postedAt = rec.updatedAt;
      } else if (rec.status === 'queued' || rec.status === 'pending') p.status = 'queued';
      else {
        p.status = 'failed';
        p.error = rec.errorMessage ?? rec.error ?? rec.status;
      }
    }
    audit.log({ user: actor(user), action: 'submit', entity: 'fleet_posting', entityId: batch, details: `iABS ${rec.status}: ${list.length} проводок, ${amount}` });
    emit();
    return delay({ batch, status: rec.status, count: list.length, amount });
  },

  // ----- предупреждения, уведомления, статистика -----
  listAlerts: () => delay(computeAlerts()),
  async scanExpiries(user: User): Promise<number> {
    guardManage(user);
    const n = scanExpiries();
    return delay(n);
  },
  getStats(): Promise<FleetStats> {
    autoScan();
    const month = today().slice(0, 7);
    const mt = trips.filter((t) => t.status === 'closed' && t.date.startsWith(month));
    const live = vehicles.filter((v) => v.status !== 'written_off');
    return delay({
      vehicles: live.filter((v) => v.kind === 'vehicle').length,
      generators: live.filter((v) => v.kind === 'generator').length,
      onTrip: vehicles.filter((v) => openTripOf(v.id)).length,
      maintenance: vehicles.filter((v) => v.status === 'repair' || v.status === 'inspection').length,
      kmMonth: mt.reduce((s, t) => s + ((t.odoEnd ?? t.odoStart) - t.odoStart), 0),
      fuelMonth: Math.round(mt.reduce((s, t) => s + (t.fuelUsed ?? 0), 0)),
      alerts: computeAlerts().length,
    });
  },
  /** Дашборд автопарка за период (PR-FLT-126…131). */
  async dashboard(period: FleetPeriod): Promise<FleetDashboard> {
    await syncAssets();
    autoScan();
    const snap = snapshot();
    const rep = fleetBuildReport(snap, period, today());
    const byStatus = { in_operation: 0, repair: 0, inspection: 0, reserve: 0, writeoff_pending: 0, written_off: 0 } as Record<FleetStatus, number>;
    for (const v of vehicles) byStatus[v.status]++;
    const alerts = computeAlerts();
    const cats = (['fuel', 'maintenance', 'repair', 'insurance', 'other', 'fines'] as const).map((k) => ({ key: k, total: rep.totals[k] })).sort((a, b) => b.total - a.total);
    return delay({
      period,
      byStatus,
      onTrip: vehicles.filter((v) => openTripOf(v.id)).length,
      vehicles: vehicles.filter((v) => v.kind === 'vehicle').length,
      generators: vehicles.filter((v) => v.kind === 'generator').length,
      costs: { fuel: rep.totals.fuel, maintenance: rep.totals.maintenance, repair: rep.totals.repair, insurance: rep.totals.insurance, other: rep.totals.other, fines: rep.totals.fines, total: rep.totals.total },
      topVehicles: [...rep.vehicles].sort((a, b) => b.total - a.total).filter((r) => r.total > 0).slice(0, 5).map((r) => ({ vehicleId: r.vehicleId, plate: r.plate, total: r.total })),
      topCategories: cats,
      needService: alerts.filter((a) => a.kind === 'service').map((a) => ({ vehicleId: a.vehicleId!, plate: byId(vehicles, a.vehicleId)?.plate ?? '', detail: a.detail, ...(a.due ? { due: a.due } : {}), overdue: a.expired })),
      expiringDocs: alerts.filter((a) => !['service', 'overconsumption', 'limit'].includes(a.kind)),
      km: rep.totals.km,
      fuelLitres: rep.totals.fuelLitres,
      pendingTrips: trips.filter((t) => t.status === 'pending').length,
      openTrips: trips.filter((t) => t.status === 'open').length,
      draftPostings: postings.filter((p) => p.status === 'draft' || p.status === 'failed').length,
    });
  },
  /** Отчёты автопарка за месяц / квартал / год (PR-FLT-118…125). */
  async report(period: FleetPeriod): Promise<FleetReport> {
    await syncAssets();
    await loadContractors();
    return delay(fleetBuildReport(snapshot(), period, today()));
  },
  /** Отчёт по карточке ТС за период (PR-FLT-015). */
  async vehicleReport(id: ID, period: FleetPeriod): Promise<{ row: FleetVehicleReportRow; trips: FleetTrip[]; fuelUps: FleetFuelUp[]; services: FleetService[]; expenses: FleetExpense[]; fines: FleetFine[] } | undefined> {
    const v = byId(vehicles, id);
    if (!v) return delay(undefined);
    const inP = (d: string) => d >= period.from && d <= period.to;
    return delay({
      row: fleetVehicleRow(snapshot(), v, period, today()),
      trips: trips.filter((t) => t.vehicleId === id && t.status === 'closed' && inP(t.date)),
      fuelUps: fuelUps.filter((f) => f.vehicleId === id && inP(f.date)),
      services: services.filter((s) => s.vehicleId === id && s.status === 'done' && inP(s.doneDate ?? s.date)),
      expenses: expenses.filter((e) => e.vehicleId === id && inP(e.date)),
      fines: fines.filter((f) => f.vehicleId === id && inP(f.date)),
    });
  },
  currentPeriod: (type: FleetPeriod['type'] = 'month') => fleetCurrentPeriod(type, today()),
};

function validateLines(works: FleetWorkLine[], parts: FleetPartLine[]): void {
  for (const w of works) if (!w.name.trim() || !(w.hours >= 0) || !isInt(w.cost) || w.cost < 0) throw new FleetError('amount');
  for (const p of parts) if (!p.name.trim() || !(p.qty > 0) || !p.unit.trim() || !isInt(p.price) || p.price < 0) throw new FleetError('amount');
}
