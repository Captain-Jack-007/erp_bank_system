// Реестры налоговой базы (ТЗ 4.2.17.2–4.2.17.6): имущество и НЗС (счета 16509/16505), земельные участки,
// водопотребление, аренда у физических лиц, минимальные ставки, ставки налогов с периодами действия,
// обороты главной книги для налога на прибыль, льготы, авансы, сверка 19931/22502, обороты НДС по филиалам,
// автоматические ЭСФ. Внешние и внутренние источники — через integrationHub (my.soliq.uz, ijara.soliq.uz,
// soliq.servis.uz, кадастр, ABS). Любое изменение базы фиксируется в журнале мониторинга и автоматически
// пересчитывает открытые расчёты (PR-TAX-057…060).
import { clone, delay, emit, nextId, nextNumber, now, today } from '../../bus';
import { audit } from '../../audit';
import { notify } from '../../notifications';
import { can } from '../../security';
import { INTEGRATION_SYSTEMS, integrationHub, type IntegrationOperation } from '../../services/integrations';
import { importRegistry, type ImportValue } from '../../services/importer';
import type { ID, Localized, User } from '../../types';
import {
  absLeaseExtra, absPropertyExtra, IJARA_REGISTRY, KADASTR_AREA_HA, SOLIQ_MIN_PER_M2, SOLIQ_WATER_INVOICES, TAX_BANK_TIN, TAX_BRANCHES, taxBenefitsSeed, taxFixedServicesSeed,
  taxLandSeed, taxLeaseSeed, taxLedgerSeed, taxMinRentSeed, taxPropertySeed, taxRatesSeed, taxRegionOf, taxServiceClientsSeed, taxVatSeed, taxWaterSeed,
} from './registryData';
import type {
  TaxAdvance, TaxAutoEsf, TaxBaseChange, TaxBaseChangeKind, TaxBaseLine, TaxBenefit, TaxLandPlot, TaxLease, TaxLeaseObjectType, TaxLeasePayment, TaxLedgerClass, TaxMinRent,
  TaxProfitBranchRow, TaxProfitSummary, TaxPropertyCalc, TaxPropertyObject, TaxRate, TaxRateKind, TaxRateSource, TaxRateTax, TaxRecon19931, TaxType, TaxVatTurnover, TaxWaterReading,
  TaxWaterSource, TaxWaterMethod,
} from './types';
import { apiError } from '../../errors';

export { TAX_BRANCHES, TAX_BANK_TIN, taxRegionOf };

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

const db = {
  rates: clone(taxRatesSeed),
  property: clone(taxPropertySeed),
  land: clone(taxLandSeed),
  water: clone(taxWaterSeed),
  leases: clone(taxLeaseSeed),
  minRent: clone(taxMinRentSeed),
  ledger: clone(taxLedgerSeed),
  benefits: clone(taxBenefitsSeed),
  vat: clone(taxVatSeed),
  services: clone(taxFixedServicesSeed),
  clients: clone(taxServiceClientsSeed),
  esf: [] as TaxAutoEsf[],
  changes: [] as TaxBaseChange[],
  advances: [] as TaxAdvance[],
  recon: [] as TaxRecon19931[],
  ledgerLoads: [] as { at: string; period: string; rows: number; controlSum: number; matched: boolean; exchangeId: string }[],
};

export function assertTaxEditor(user: User | null | undefined) {
  if (!can(user, 'taxes', 'edit')) throw apiError('FORBIDDEN');
}

// ---------------------------------------------------------------------------------------------
// Периоды и ставки

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Месяцы периода: «2026-Q3» → 07, 08, 09; «2026-09» → 09. */
export function taxPeriodMonths(period: string): string[] {
  const [y, p] = period.split('-');
  if (p?.startsWith('Q')) {
    const q = Number(p.slice(1));
    return [1, 2, 3].map((i) => `${y}-${pad((q - 1) * 3 + i)}`);
  }
  return [period];
}
/** Последний день периода. */
export function taxPeriodEnd(period: string): string {
  const m = taxPeriodMonths(period).at(-1)!;
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return `${m}-${pad(lastDay(y, mm))}`;
}

/** Действующая ставка: региональная (кенгаш / Закон о Госбюджете) приоритетнее общей, последняя по дате начала. */
export function taxRateFor(tax: TaxRateTax, regionCode: string, asOf: string): TaxRate | undefined {
  const active = db.rates.filter((r) => r.tax === tax && r.validFrom <= asOf && (!r.validTo || r.validTo >= asOf));
  const regional = active.filter((r) => r.regionCode === regionCode).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  return regional ?? active.filter((r) => r.regionCode === '*').sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
}
const rateValue = (tax: TaxRateTax, region: string, asOf: string) => taxRateFor(tax, region, asOf)?.value ?? 0;

// ---------------------------------------------------------------------------------------------
// Имущество и НЗС

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);

/** Остаточная стоимость на дату (первоначальная − амортизация). */
function residualAt(o: TaxPropertyObject, date: string, year: number): number {
  if (o.acquiredAt > date || (o.disposedAt && o.disposedAt <= date)) return 0;
  if (o.account === '16505') return o.completedAt && o.completedAt <= date ? 0 : o.initialCost;
  const yearStart = `${year}-01-01`;
  const startMonth = o.acquiredAt > yearStart ? addMonthsIso(o.acquiredAt.slice(0, 7) + '-01', 1) : yearStart;
  const dateMonth = date.endsWith('-01') ? date : addMonthsIso(date.slice(0, 7) + '-01', 1);
  const months = Math.max(0, (Number(dateMonth.slice(0, 4)) - Number(startMonth.slice(0, 4))) * 12 + Number(dateMonth.slice(5, 7)) - Number(startMonth.slice(5, 7)));
  return Math.max(0, o.initialCost - o.accumulatedAtYearStart - o.monthlyDepreciation * months);
}

/** Расчёт базы по объекту: среднегодовая остаточная стоимость, сравнение с минимальной стоимостью my.soliq.uz, ставка 1,5% / 3%. */
export function taxPropertyCalc(o: TaxPropertyObject, period: string): TaxPropertyCalc {
  const end = taxPeriodEnd(period);
  const year = Number(end.slice(0, 4));
  const months = Number(end.slice(5, 7));
  const points: number[] = [];
  for (let m = 1; m <= months; m++) points.push(residualAt(o, `${year}-${pad(m)}-01`, year));
  points.push(residualAt(o, end, year));
  const avgResidual = Math.round(points.reduce((s, v) => s + v, 0) / points.length);
  const exists = o.acquiredAt <= end && (!o.disposedAt || o.disposedAt > `${year}-01-01`);
  const minValue = exists ? o.minValue ?? 0 : 0;
  const base = Math.max(avgResidual, minValue);
  const region = taxRegionOf(o.branchKey);
  let rate = rateValue('property', region, end);
  let overdue = false;
  let deadline: string | undefined;
  let daysToDeadline: number | undefined;
  if (o.account === '16505' && o.constructionStart && o.normativeMonths) {
    deadline = addMonthsIso(o.constructionStart, o.normativeMonths);
    daysToDeadline = daysBetween(today(), deadline);
    overdue = !o.completedAt && deadline < end;
    // НЗС облагается только после истечения нормативного срока строительства — по повышенной ставке.
    rate = overdue ? rateValue('property_construction', region, end) : 0;
  }
  return {
    objectId: o.id, residualNow: residualAt(o, today(), Number(today().slice(0, 4))), avgResidual, minValue, base, baseSource: minValue > avgResidual ? 'soliq' : 'abs',
    rate, overdue, ...(deadline ? { deadline } : {}), ...(daysToDeadline !== undefined ? { daysToDeadline } : {}), annualTax: Math.round((base * rate) / 100), months,
  };
}

// ---------------------------------------------------------------------------------------------
// Земля, вода, аренда

export function taxLandCalc(p: TaxLandPlot, period: string) {
  const end = taxPeriodEnd(period);
  const year = end.slice(0, 4);
  const rate = taxRateFor('land', p.regionCode, end);
  // Месяцы владения в году (месяц возникновения права считается полным, выбытия — не считается).
  let months = 12;
  if (p.acquiredAt.slice(0, 4) === year) months = 12 - Number(p.acquiredAt.slice(5, 7)) + 1;
  if (p.disposedAt && p.disposedAt.slice(0, 4) === year) months -= 12 - Number(p.disposedAt.slice(5, 7)) + 1;
  if (p.acquiredAt > end || (p.disposedAt && p.disposedAt < `${year}-01-01`)) months = 0;
  const annualTax = Math.round((p.areaHa * (rate?.value ?? 0) * Math.max(0, months)) / 12);
  return { plotId: p.id, areaM2: Math.round(p.areaHa * 10_000), rate: rate?.value ?? 0, rateSource: rate?.source, rateDoc: rate?.docRef, months: Math.max(0, months), annualTax };
}

export function taxWaterRate(source: TaxWaterSource, asOf: string): number {
  return rateValue(source === 'surface' ? 'water_surface' : 'water_underground', '*', asOf);
}

export function taxMinRentFor(year: number, regionCode: string, type: TaxLeaseObjectType): TaxMinRent | undefined {
  const list = db.minRent.filter((m) => m.year === year && m.objectType === type);
  return list.find((m) => m.regionCode === regionCode) ?? list.find((m) => m.regionCode === '*');
}

/** Налоговая база по аренде за месяц: договорная плата, но не ниже минимальной (PR-TAX-005/008/023). */
export function taxLeaseBase(l: TaxLease, month: string) {
  const min = taxMinRentFor(Number(month.slice(0, 4)), l.regionCode, l.objectType);
  const minRent = Math.round((min?.ratePerM2 ?? 0) * l.areaM2);
  const base = Math.max(l.monthlyRent, minRent);
  const rate = rateValue('pit_rent', '*', `${month}-01`);
  return { rent: l.monthlyRent, minRent, base, recalculated: base > l.monthlyRent, rate, pit: Math.round((base * rate) / 100) };
}
const leaseActive = (l: TaxLease, month: string) => l.startDate.slice(0, 7) <= month && l.endDate.slice(0, 7) >= month;

// Демо-история платежей аренды (июль–сентябрь) — по зарегистрированным договорам.
for (const l of db.leases) {
  for (const month of ['2026-07', '2026-08', '2026-09']) {
    if (!leaseActive(l, month) || l.ijara.status !== 'registered') continue;
    const b = taxLeaseBase(l, month);
    l.payments.push({ month, rent: b.rent, minRent: b.minRent, base: b.base, pit: b.pit, net: b.rent - b.pit, status: 'paid', reference: `PP-AR-${l.contractNo.slice(-4)}-${month.slice(5)}`, at: `${month}-05T09:00:00Z` });
  }
}

// ---------------------------------------------------------------------------------------------
// Налог на прибыль

const CLS_LABEL: Record<TaxLedgerClass, Localized> = {
  taxable: L('Облагаемые доходы', 'Soliq solinadigan daromadlar', 'Taxable income'),
  deductible: L('Вычитаемые расходы', 'Chegiriladigan xarajatlar', 'Deductible expenses'),
  non_deductible: L('Невычитаемые расходы', 'Chegirilmaydigan xarajatlar', 'Non-deductible expenses'),
  non_taxable: L('Необлагаемые доходы', 'Soliq solinmaydigan daromadlar', 'Non-taxable income'),
};
export const TAX_LEDGER_CLASS_LABEL = CLS_LABEL;

export function taxProfitSummary(period = '2026-Q3'): TaxProfitSummary {
  const lines = db.ledger.filter((l) => l.period === period);
  const rate = rateValue('profit', '*', taxPeriodEnd(period));
  const rows: TaxProfitBranchRow[] = TAX_BRANCHES.map((b) => {
    const ls = lines.filter((l) => l.branchKey === b);
    const s = (f: (l: (typeof ls)[number]) => boolean) => ls.filter(f).reduce((a, l) => a + l.amount, 0);
    const income = s((l) => l.kind === 'income');
    const nonTaxableIncome = s((l) => l.cls === 'non_taxable');
    const expense = s((l) => l.kind === 'expense');
    const nonDeductible = s((l) => l.cls === 'non_deductible');
    return { branchKey: b, income, nonTaxableIncome, expense, nonDeductible, taxableProfit: income - nonTaxableIncome - (expense - nonDeductible), share: 0, tax: 0 };
  }).filter((r) => r.income || r.expense);
  const taxableProfit = rows.reduce((s, r) => s + r.taxableProfit, 0);
  const benefits = db.benefits.filter((b) => b.active && b.period === period).reduce((s, b) => s + b.amount, 0);
  const base = Math.max(0, taxableProfit - benefits);
  const tax = Math.round((base * rate) / 100);
  // Налог покрывают филиалы с положительным результатом — пропорционально их прибыли (PR-TAX-039).
  const positive = rows.filter((r) => r.taxableProfit > 0);
  const posSum = positive.reduce((s, r) => s + r.taxableProfit, 0);
  let left = tax;
  positive.forEach((r, i) => {
    r.share = posSum ? r.taxableProfit / posSum : 0;
    r.tax = i === positive.length - 1 ? left : Math.round(tax * r.share);
    left -= r.tax;
  });
  return { period, rows, taxableProfit, benefits, base, rate, tax };
}

// Авансовые платежи: июль–сентябрь уплачены по итогам 2 квартала; октябрь–декабрь рассчитываются по 3 кварталу.
for (const [month, amount] of [['2026-07', 14_500_000_000], ['2026-08', 14_500_000_000], ['2026-09', 14_500_000_000]] as const) {
  db.advances.push({ month, dueDate: `${month}-23`, amount, paid: amount, paidAt: `${month}-21`, reference: `PP-AV-${month.slice(5)}` });
}

function quarterOfMonth(month: string): string {
  return `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
}

// ---------------------------------------------------------------------------------------------
// Мониторинг изменений базы и автопересчёт

type RecalcHandler = (tax: TaxType, userId: ID | undefined) => string[];
let recalcHandler: RecalcHandler = () => [];
/** api.ts подключает пересчёт открытых расчётов. */
export function setTaxRecalcHandler(fn: RecalcHandler) {
  recalcHandler = fn;
}

function baseChanged(kind: TaxBaseChangeKind, tax: TaxType, branchKey: string, ref: string, before: number, after: number, user?: User) {
  const recalculated = recalcHandler(tax, user?.id);
  const ch: TaxBaseChange = { id: nextId('tbc'), at: now(), kind, tax, branchKey, ref, before, after, recalculated, ...(user ? { userId: user.id } : {}) };
  db.changes.unshift(ch);
  notify({
    roles: ['tax_officer', 'accountant'],
    ...(user ? { excludeIds: [user.id] } : {}),
    title: L('Изменилась налоговая база', "Soliq bazasi o'zgardi", 'Tax base changed'),
    body: L(`${ref}: ${before.toLocaleString('ru-RU')} → ${after.toLocaleString('ru-RU')}${recalculated.length ? `; пересчитано: ${recalculated.join(', ')}` : ''}`, `${ref}: ${before.toLocaleString('ru-RU')} → ${after.toLocaleString('ru-RU')}${recalculated.length ? `; qayta hisoblandi: ${recalculated.join(', ')}` : ''}`, `${ref}: ${before.toLocaleString('en-US')} → ${after.toLocaleString('en-US')}${recalculated.length ? `; recalculated: ${recalculated.join(', ')}` : ''}`),
    link: '/taxes/registers?tab=monitor',
    level: 'info',
    kind: 'system',
  });
  return ch;
}

// ---------------------------------------------------------------------------------------------
// Строки расчётов из реестров (используются api.ts)

const CURRENT_YEAR_PERIOD = (period: string) => (period.includes('-Q') ? period : quarterOfMonth(period));

/** Строки базы для расчёта по виду налога за период; undefined — вид налога ведётся вручную. */
export function taxRegistryLines(type: TaxType, period: string): { lines: TaxBaseLine[]; credits?: number; creditsLabel?: Localized } | undefined {
  if (type === 'property') {
    const p = CURRENT_YEAR_PERIOD(period);
    return {
      lines: db.property
        .map((o) => ({ o, c: taxPropertyCalc(o, p) }))
        .filter(({ c }) => c.base > 0 && c.rate > 0)
        .map(({ o, c }) => ({ label: o.name, amount: c.base, tax: c.annualTax, branchKey: o.branchKey, ref: o.cadastralNo, unit: 'uzs' as const })),
    };
  }
  if (type === 'land') {
    const p = CURRENT_YEAR_PERIOD(period);
    return {
      lines: db.land
        .map((pl) => ({ pl, c: taxLandCalc(pl, p) }))
        .filter(({ c }) => c.months > 0)
        .map(({ pl, c }) => ({ label: L(pl.address, pl.address, pl.address), amount: c.areaM2, tax: c.annualTax, branchKey: pl.branchKey, ref: pl.cadastralNo, unit: 'm2' as const })),
    };
  }
  if (type === 'water') {
    const months = taxPeriodMonths(period);
    const end = taxPeriodEnd(period);
    const groups = new Map<string, { branchKey: string; source: TaxWaterSource; m3: number }>();
    for (const w of db.water.filter((x) => months.includes(x.month))) {
      const k = `${w.branchKey}|${w.source}`;
      const g = groups.get(k) ?? { branchKey: w.branchKey, source: w.source, m3: 0 };
      g.m3 += w.m3;
      groups.set(k, g);
    }
    return {
      lines: [...groups.values()].map((g) => ({
        label: g.source === 'surface' ? L('Поверхностные источники', "Yer usti manbalari", 'Surface sources') : L('Подземные источники', 'Yer osti manbalari', 'Underground sources'),
        amount: g.m3, tax: g.m3 * taxWaterRate(g.source, end), branchKey: g.branchKey, ref: g.source, unit: 'm3' as const,
      })),
    };
  }
  if (type === 'rent_pit') {
    const months = taxPeriodMonths(period);
    const lines: TaxBaseLine[] = [];
    for (const l of db.leases) {
      if (l.ijara.status !== 'registered') continue;
      for (const m of months) {
        if (!leaseActive(l, m)) continue;
        const b = taxLeaseBase(l, m);
        lines.push({ label: L(`${l.contractNo} · ${l.lessorName}`, `${l.contractNo} · ${l.lessorName}`, `${l.contractNo} · ${l.lessorName}`), amount: b.base, tax: b.pit, branchKey: l.branchKey, ref: l.contractNo, unit: 'uzs' });
      }
    }
    return { lines };
  }
  if (type === 'profit') {
    // Ежемесячный расчёт — по оборотам месяца; если их ещё нет — треть квартальной базы.
    const hasOwn = db.ledger.some((l) => l.period === period);
    const s = taxProfitSummary(hasOwn ? period : quarterOfMonth(period));
    const months = taxPeriodMonths(period);
    const k = hasOwn || period.includes('-Q') ? 1 : 1 / 3;
    const lines: TaxBaseLine[] = s.rows.map((r) => ({
      label: L(`Налогооблагаемая прибыль филиала ${r.branchKey}`, `${r.branchKey} filialining soliq solinadigan foydasi`, `Taxable profit, branch ${r.branchKey}`),
      amount: Math.round(r.taxableProfit * k), tax: Math.round(r.tax * k), branchKey: r.branchKey, ref: r.branchKey, unit: 'uzs',
    }));
    if (s.benefits) lines.push({ label: L('Налоговые льготы (уменьшение базы)', "Soliq imtiyozlari (bazani kamaytirish)", 'Tax benefits (base reduction)'), amount: -Math.round(s.benefits * k), tax: 0, ref: 'benefits', unit: 'uzs' });
    const credits = db.advances.filter((a) => months.includes(a.month) || (period.includes('-Q') && quarterOfMonth(a.month) === period)).reduce((a, x) => a + x.paid, 0);
    return { lines, credits, creditsLabel: L('Уплаченные авансовые платежи (счёт 19931)', "To'langan avans to'lovlari (19931 hisobvarag'i)", 'Advance payments made (account 19931)') };
  }
  if (type === 'vat') {
    const rows = db.vat.filter((v) => taxPeriodMonths(period).includes(v.month));
    if (!rows.length) return undefined;
    const CAT: Record<TaxVatTurnover['category'], Localized> = {
      rent: L('Сдача имущества в аренду', 'Mol-mulkni ijaraga berish', 'Property rental'),
      collateral: L('Реализация залогового имущества', 'Garov mulkini sotish', 'Sale of collateral'),
      services: L('Небанковские комиссии и услуги', "Bank bo'lmagan komissiyalar va xizmatlar", 'Non-banking fees and services'),
    };
    return {
      lines: rows.map((v) => ({ label: CAT[v.category], amount: v.amount, branchKey: v.branchKey, ref: v.category, unit: 'uzs' as const })),
      credits: rows.reduce((s, v) => s + v.inputVat, 0),
      creditsLabel: L('Входящий НДС к зачёту (по филиалам)', "Hisobga olinadigan kiruvchi QQS (filiallar bo'yicha)", 'Input VAT credit (by branch)'),
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Интеграции (my.soliq.uz, ijara.soliq.uz, soliq.servis.uz, кадастр, ABS)

function addOps(systemId: string, ops: IntegrationOperation[]) {
  const sys = INTEGRATION_SYSTEMS.find((s) => s.id === systemId);
  if (!sys) return;
  for (const o of ops) if (!sys.operations.some((x) => x.id === o.id)) sys.operations.push(o);
  if (!sys.modules.includes('taxes')) sys.modules.push('taxes');
}
const need = (p: Record<string, unknown>, keys: string[]) => {
  const miss = keys.filter((k) => p[k] === undefined || p[k] === '');
  return miss.length ? { code: 'validation' as const, message: `Missing: ${miss.join(', ')}` } : null;
};
const numOf = (p: Record<string, unknown>, k: string) => Number(p[k] ?? 0);

addOps('soliq', [
  { id: 'cadastre.minValue', direction: 'in', schemaVersion: '1.0', name: L('my.soliq.uz: минимальная стоимость объекта', 'my.soliq.uz: obyektning minimal qiymati', 'my.soliq.uz: minimum property value'),
    sample: () => ({ cadastralNo: '10:07:01:01:02:0011', areaM2: 1000, zone: 'A' }), validate: (p) => need(p, ['cadastralNo']),
    respond: (p) => ({ cadastralNo: p.cadastralNo, minValue: Math.round(numOf(p, 'areaM2') * (SOLIQ_MIN_PER_M2[(p.zone as 'A' | 'B' | 'C') ?? 'C'] ?? 0)), currency: 'UZS' }) },
  { id: 'lease.status', direction: 'in', schemaVersion: '1.0', name: L('ijara.soliq.uz: статус регистрации договора', 'ijara.soliq.uz: shartnoma holati', 'ijara.soliq.uz: lease registration status'),
    sample: () => ({ contract: 'AR-2026-0021' }), validate: (p) => need(p, ['contract']),
    respond: (p) => ({ contract: p.contract, ...(IJARA_REGISTRY[String(p.contract)] ?? { status: 'not_registered' }) }) },
  { id: 'water.invoices', direction: 'in', schemaVersion: '1.0', name: L('soliq.servis.uz: счета-фактуры водоканала', 'soliq.servis.uz: suv ta’minoti hisob-fakturalari', 'soliq.servis.uz: water utility invoices'),
    sample: () => ({ month: '2026-09' }), validate: (p) => need(p, ['month']), respond: (p) => ({ month: p.month, invoices: SOLIQ_WATER_INVOICES }), count: () => SOLIQ_WATER_INVOICES.length },
  { id: 'report.submit', direction: 'out', schemaVersion: '2.1', name: L('Сдача налоговой отчётности (файл ГНК)', 'Soliq hisobotini topshirish (DSQ fayli)', 'Tax report filing (tax authority file)'),
    sample: () => ({ form: 'VAT-M', period: '2026-09', tin: TAX_BANK_TIN, controlSum: 1_000_000, lines: 3 }), validate: (p) => need(p, ['form', 'period', 'tin', 'controlSum']),
    amount: (p) => numOf(p, 'controlSum'), count: (p) => numOf(p, 'lines'), respond: (p) => ({ accepted: true, receipt: `GNK-${String(p.form)}-${String(p.period)}-${Math.abs(numOf(p, 'controlSum')) % 100000}`, acceptedAmount: numOf(p, 'controlSum') }) },
]);
addOps('kadastr', [
  { id: 'land.get', direction: 'in', schemaVersion: '1.0', name: L('Сведения о земельном участке', 'Yer uchastkasi ma’lumotlari', 'Land plot record'),
    sample: () => ({ cadastralNo: '03:01:02:01:01:0132', areaHa: 0.24 }), validate: (p) => need(p, ['cadastralNo']),
    respond: (p) => ({ cadastralNo: p.cadastralNo, areaHa: KADASTR_AREA_HA[String(p.cadastralNo)] ?? numOf(p, 'areaHa'), right: 'own' }) },
]);
addOps('iabs', [
  { id: 'ledger.balances', direction: 'in', schemaVersion: '1.0', name: L('Остатки счетов 16509/16505 по объектам', '16509/16505 hisobvaraqlari qoldiqlari', 'Balances of accounts 16509/16505'),
    sample: () => ({ accounts: ['16509', '16505'], date: '2026-10-01' }), validate: (p) => need(p, ['accounts']),
    respond: (p) => ({ objects: (Array.isArray(p.known) ? (p.known as unknown[]).length : 0) + 1, newObjects: [absPropertyExtra.cadastralNo] }), count: (p) => (Array.isArray(p.known) ? (p.known as unknown[]).length : 0) },
  { id: 'lease.registry', direction: 'in', schemaVersion: '1.0', name: L('Реестр договоров аренды Банка', 'Bank ijara shartnomalari reyestri', 'Bank lease contract registry'),
    sample: () => ({ date: '2026-10-01' }), respond: () => ({ contracts: [absLeaseExtra.contractNo] }) },
  { id: 'ledger.turnovers', direction: 'in', schemaVersion: '1.0', name: L('Обороты главной книги по филиалам', 'Filiallar bo‘yicha bosh kitob aylanmalari', 'General ledger turnovers by branch'),
    sample: () => ({ period: '2026-Q3' }), validate: (p) => need(p, ['period']),
    respond: (p) => {
      const rows = taxLedgerSeed.filter((l) => l.period === p.period);
      return { period: p.period, rows: rows.length, controlSum: rows.reduce((s, l) => s + l.amount, 0) };
    },
    amount: (p) => numOf(p, 'expectedSum') },
]);

// ---------------------------------------------------------------------------------------------
// Сроки: аренда (10 дней), НЗС (переход на 3%), авансы

export function taxesScanDeadlines(): number {
  let sent = 0;
  const t = today();
  for (const l of db.leases) {
    const d = daysBetween(t, l.endDate);
    if (d >= 0 && d <= 10) {
      sent += notify({
        userIds: [l.responsibleId],
        title: L(`Истекает договор аренды ${l.contractNo}`, `${l.contractNo} ijara shartnomasi muddati tugaydi`, `Lease ${l.contractNo} expires soon`),
        body: L(`Срок действия заканчивается ${l.endDate} (через ${d} дн.). ${l.address}`, `Amal qilish muddati ${l.endDate} da tugaydi (${d} kundan keyin). ${l.address}`, `Expires on ${l.endDate} (in ${d} days). ${l.address}`),
        link: '/taxes/registers?tab=leases', level: 'warning', kind: 'system', dedupeKey: `tax-lease-${l.id}-${l.endDate}`,
      }).length;
    }
  }
  for (const o of db.property.filter((x) => x.account === '16505' && !x.completedAt && !x.disposedAt)) {
    const c = taxPropertyCalc(o, CURRENT_YEAR_PERIOD(t.slice(0, 7)));
    if (c.deadline && (c.daysToDeadline ?? 99) <= 30) {
      const over = (c.daysToDeadline ?? 0) < 0;
      sent += notify({
        roles: ['tax_officer', 'accountant'],
        title: over ? L(`НЗС: нормативный срок истёк — ставка 3%`, `TQ: me'yoriy muddat o'tdi — stavka 3%`, 'CIP: normative term expired — 3% rate') : L('НЗС: скоро истекает нормативный срок строительства', "TQ: qurilishning me'yoriy muddati tugayapti", 'CIP: normative construction term ends soon'),
        body: L(`${o.name.ru} (${o.cadastralNo}), срок ${c.deadline}`, `${o.name.uz} (${o.cadastralNo}), muddat ${c.deadline}`, `${o.name.en ?? o.name.ru} (${o.cadastralNo}), deadline ${c.deadline}`),
        link: '/taxes/registers?tab=construction', level: over ? 'danger' : 'warning', kind: 'system', dedupeKey: `tax-cip-${o.id}-${over ? 'over' : 'soon'}`,
      }).length;
    }
  }
  for (const a of db.advances.filter((x) => x.paid < x.amount && x.dueDate < t)) {
    sent += notify({ roles: ['tax_officer', 'accountant'], title: L(`Просрочен аванс по налогу на прибыль за ${a.month}`, `${a.month} uchun foyda solig'i avansi muddati o'tdi`, `Profit tax advance for ${a.month} overdue`), link: '/taxes/profit?tab=advances', level: 'danger', kind: 'system', dedupeKey: `tax-adv-${a.month}` }).length;
  }
  return sent;
}
if ((globalThis as { document?: unknown }).document) setTimeout(() => taxesScanDeadlines(), 1500);

// ---------------------------------------------------------------------------------------------
// Импорт: ставки (Закон о Госбюджете, решения кенгашей), минимальные ставки аренды, показания воды

const RATE_TAX_OPTIONS = (['property', 'property_construction', 'land', 'water_surface', 'water_underground', 'pit_rent', 'vat', 'profit'] as TaxRateTax[]).map((v) => ({ value: v, label: L(v, v, v) }));
importRegistry.register({
  id: 'tax_rates',
  name: L('Налоговые ставки (Закон о Госбюджете, решения кенгашей)', "Soliq stavkalari (Davlat byudjeti to'g'risidagi qonun, kengash qarorlari)", 'Tax rates (State Budget Law, kengash decisions)'),
  description: L('Вид налога, тип ставки (% / за га / за м³), значение, регион (01–14 или *), источник, документ, дата начала действия. Предыдущая версия ставки закрывается автоматически.', "Soliq turi, stavka turi (% / ga / m³), qiymat, hudud (01–14 yoki *), manba, hujjat, amal qilish sanasi. Oldingi versiya avtomatik yopiladi.", 'Tax, rate kind (% / per ha / per m³), value, region (01–14 or *), source, document, effective date. The previous version is closed automatically.'),
  fields: [
    { key: 'tax', label: L('Налог', 'Soliq', 'Tax'), type: 'enum', required: true, options: RATE_TAX_OPTIONS, sample: 'land' },
    { key: 'kind', label: L('Тип ставки', 'Stavka turi', 'Rate kind'), type: 'enum', required: true, options: [{ value: 'percent', label: L('%', '%', '%') }, { value: 'per_ha', label: L('за 1 га', '1 ga uchun', 'per ha') }, { value: 'per_m3', label: L('за 1 м³', '1 m³ uchun', 'per m³') }], sample: 'per_ha' },
    { key: 'value', label: L('Значение', 'Qiymat', 'Value'), type: 'number', required: true, min: 0, sample: '120000000' },
    { key: 'region', label: L('Регион', 'Hudud', 'Region'), type: 'string', required: true, pattern: '^(\\*|\\d{2})$', patternHint: '01–14 / *', sample: '03' },
    { key: 'source', label: L('Источник', 'Manba', 'Source'), type: 'enum', required: true, options: [{ value: 'tax_code', label: L('Налоговый кодекс', 'Soliq kodeksi', 'Tax Code') }, { value: 'budget_law', label: L('Закон о Госбюджете', "Davlat byudjeti to'g'risidagi qonun", 'State Budget Law') }, { value: 'kengash', label: L('Решение кенгаша', 'Kengash qarori', 'Kengash decision') }], sample: 'budget_law' },
    { key: 'docRef', label: L('Документ', 'Hujjat', 'Document'), type: 'string', required: true, maxLength: 200, sample: 'Закон о Госбюджете на 2027 г.' },
    { key: 'validFrom', label: L('Действует с', 'Amal qilish sanasi', 'Valid from'), type: 'date', required: true, sample: '01.01.2027' },
  ],
  async commit(rows, user) {
    let created = 0;
    for (const r of rows) {
      await taxRegistryApi.addRate({ tax: r.tax as TaxRateTax, kind: r.kind as TaxRateKind, value: Number(r.value), regionCode: String(r.region), source: r.source as TaxRateSource, docRef: String(r.docRef), validFrom: String(r.validFrom) }, user);
      created++;
    }
    return { created, updated: 0, skipped: 0 };
  },
});
importRegistry.register({
  id: 'tax_min_rent',
  name: L('Минимальные ставки арендной платы', "Ijara haqining minimal stavkalari", 'Minimum rent rates'),
  description: L('Ежегодное обновление: год, регион, тип помещения (жилое/нежилое), ставка за 1 м² в месяц.', "Har yili yangilanadi: yil, hudud, joy turi (turar/noturar), 1 m² uchun oylik stavka.", 'Annual update: year, region, premises type (residential/non-residential), rate per m² per month.'),
  keyField: 'key',
  fields: [
    { key: 'year', label: L('Год', 'Yil', 'Year'), type: 'integer', required: true, min: 2020, max: 2100, sample: '2027' },
    { key: 'region', label: L('Регион', 'Hudud', 'Region'), type: 'string', required: true, pattern: '^(\\*|\\d{2})$', patternHint: '01–14 / *', sample: '01' },
    { key: 'objectType', label: L('Тип помещения', 'Joy turi', 'Premises type'), type: 'enum', required: true, options: [{ value: 'residential', label: L('Жилое', 'Turar joy', 'Residential'), aliases: ['жилое'] }, { value: 'non_residential', label: L('Нежилое', 'Noturar joy', 'Non-residential'), aliases: ['нежилое'] }], sample: 'non_residential' },
    { key: 'ratePerM2', label: L('Ставка за 1 м² в месяц', '1 m² uchun oylik stavka', 'Rate per m² per month'), type: 'number', required: true, min: 0, sample: '56000' },
  ],
  async commit(rows, user) {
    let created = 0;
    let updated = 0;
    for (const r of rows) {
      const res = await taxRegistryApi.upsertMinRent({ year: Number(r.year), regionCode: String(r.region), objectType: r.objectType as TaxLeaseObjectType, ratePerM2: Number(r.ratePerM2) }, user);
      if (res === 'created') created++;
      else updated++;
    }
    return { created, updated, skipped: 0 };
  },
});
importRegistry.register({
  id: 'tax_water',
  name: L('Показания счётчиков воды / письма водоканалов', "Suv hisoblagichlari ko'rsatkichlari / suv ta'minoti xatlari", 'Water meter readings / utility letters'),
  description: L('Филиал (HO, R01…R14), объект, месяц (ГГГГ-ММ), источник (поверхностный/подземный), объём м³, основание.', "Filial (HO, R01…R14), obyekt, oy (YYYY-MM), manba (yer usti/yer osti), hajm m³, asos.", 'Branch (HO, R01…R14), object, month (YYYY-MM), source (surface/underground), volume m³, basis.'),
  fields: [
    { key: 'branch', label: L('Филиал', 'Filial', 'Branch'), type: 'string', required: true, pattern: '^(HO|R\\d{2})$', patternHint: 'HO / R01…R14', sample: 'R03' },
    { key: 'object', label: L('Объект', 'Obyekt', 'Object'), type: 'string', required: true, maxLength: 120, sample: 'Андижанский филиал' },
    { key: 'month', label: L('Месяц', 'Oy', 'Month'), type: 'string', required: true, pattern: '^\\d{4}-\\d{2}$', patternHint: 'YYYY-MM', sample: '2026-09' },
    { key: 'source', label: L('Источник', 'Manba', 'Source'), type: 'enum', required: true, options: [{ value: 'surface', label: L('Поверхностный', 'Yer usti', 'Surface') }, { value: 'underground', label: L('Подземный', 'Yer osti', 'Underground') }], sample: 'surface' },
    { key: 'm3', label: L('Объём, м³', 'Hajm, m³', 'Volume, m³'), type: 'integer', required: true, min: 0, sample: '260' },
    { key: 'method', label: L('Основание', 'Asos', 'Basis'), type: 'enum', required: true, options: [{ value: 'meter', label: L('Счётчик', 'Hisoblagich', 'Meter') }, { value: 'invoice', label: L('Счёт-фактура', 'Hisob-faktura', 'Invoice') }, { value: 'letter', label: L('Письмо', 'Xat', 'Letter') }], sample: 'letter' },
    { key: 'docRef', label: L('Документ', 'Hujjat', 'Document'), type: 'string', maxLength: 120, sample: 'Письмо № 12' },
  ],
  async commit(rows, user) {
    for (const r of rows) await taxRegistryApi.addWater({ branchKey: String(r.branch), objectName: String(r.object), month: String(r.month), source: r.source as TaxWaterSource, m3: Number(r.m3), method: r.method as TaxWaterMethod, ...(r.docRef ? { docRef: String(r.docRef) } : {}) }, user);
    return { created: rows.length, updated: 0, skipped: 0 };
  },
});

// ---------------------------------------------------------------------------------------------
// Публичный API реестров

const findOr = <T extends { id: ID }>(list: T[], id: ID): T => {
  const x = list.find((i) => i.id === id);
  if (!x) throw apiError('NOT_FOUND');
  return x;
};
const propertyTotal = (branchKey: string) => db.property.filter((o) => o.branchKey === branchKey).reduce((s, o) => s + taxPropertyCalc(o, CURRENT_YEAR_PERIOD(today().slice(0, 7))).base, 0);

export interface TaxPropertyView extends TaxPropertyObject {
  calc: TaxPropertyCalc;
}

export const taxRegistryApi = {
  // --- ставки ---
  listRates: () => delay([...db.rates].sort((a, b) => a.tax.localeCompare(b.tax) || b.validFrom.localeCompare(a.validFrom))),
  async addRate(input: Omit<TaxRate, 'id' | 'validTo' | 'createdBy'>, user: User): Promise<TaxRate> {
    assertTaxEditor(user);
    if (!(input.value >= 0) || !input.validFrom || !input.docRef.trim()) throw new Error('taxes_err_rate');
    const prev = db.rates.filter((r) => r.tax === input.tax && r.regionCode === input.regionCode && !r.validTo && r.validFrom < input.validFrom);
    const dayBefore = new Date(Date.parse(input.validFrom) - 86_400_000).toISOString().slice(0, 10);
    for (const p of prev) p.validTo = dayBefore;
    const rate: TaxRate = { ...input, id: nextId('rt'), createdBy: user.id };
    db.rates.push(rate);
    audit.log({ action: 'create', entity: 'tax_rate', entityId: rate.id, details: `${rate.tax} ${rate.value} (${rate.regionCode}) с ${rate.validFrom}` });
    const tax: TaxType = input.tax.startsWith('water') ? 'water' : input.tax.startsWith('property') ? 'property' : input.tax === 'pit_rent' ? 'rent_pit' : (input.tax as TaxType);
    baseChanged('rate_change', tax, input.regionCode === '*' ? 'HO' : `R${input.regionCode}`, `${input.tax} ${input.value}`, prev[0]?.value ?? 0, input.value, user);
    emit();
    return delay(rate);
  },

  // --- имущество и НЗС ---
  listProperty(account?: '16509' | '16505', period = CURRENT_YEAR_PERIOD(today().slice(0, 7))): Promise<TaxPropertyView[]> {
    return delay(db.property.filter((o) => !account || o.account === account).map((o) => ({ ...o, calc: taxPropertyCalc(o, period) })));
  },
  /** Минимальная стоимость по каждому кадастровому номеру с my.soliq.uz (PR-TAX-002, PR-TAX-046). */
  async fetchMinValues(user: User): Promise<{ updated: number; failed: number }> {
    assertTaxEditor(user);
    const targets = db.property.filter((o) => o.account === '16509' && !o.disposedAt);
    const res = await Promise.all(targets.map((o) => integrationHub.call('soliq', 'cadastre.minValue', { cadastralNo: o.cadastralNo, areaM2: o.areaM2, zone: o.zone }, { userId: user.id })));
    let updated = 0;
    let failed = 0;
    res.forEach((r, i) => {
      const o = targets[i]!;
      if (r.status !== 'success') return void failed++;
      const mv = Number((r.response as { minValue?: number })?.minValue ?? 0);
      if (mv !== o.minValue) {
        const before = propertyTotal(o.branchKey);
        o.minValue = mv;
        o.minValueAt = now();
        updated++;
        const after = propertyTotal(o.branchKey);
        if (before !== after) baseChanged('min_value', 'property', o.branchKey, o.cadastralNo, before, after, user);
      } else o.minValueAt = now();
    });
    emit();
    return { updated, failed };
  },
  /** Загрузка остатков счетов 16509/16505 из ABS: новые объекты заводятся автоматически (PR-TAX-012/013/058). */
  async loadPropertyFromAbs(user: User): Promise<{ added: number; exchangeId: string; status: string }> {
    assertTaxEditor(user);
    const r = await integrationHub.call('iabs', 'ledger.balances', { accounts: ['16509', '16505'], date: today(), known: db.property.map((o) => o.cadastralNo) }, { userId: user.id });
    let added = 0;
    if (r.status === 'success') {
      for (const o of db.property) o.absLoadedAt = now();
      if (!db.property.some((o) => o.cadastralNo === absPropertyExtra.cadastralNo)) {
        const before = propertyTotal(absPropertyExtra.branchKey);
        db.property.push({ ...clone(absPropertyExtra), absLoadedAt: now() });
        added++;
        baseChanged('acquisition', 'property', absPropertyExtra.branchKey, absPropertyExtra.cadastralNo, before, propertyTotal(absPropertyExtra.branchKey), user);
      }
    }
    emit();
    return { added, exchangeId: r.id, status: r.status };
  },
  /** Ввод объекта НЗС в эксплуатацию (перевод на счёт 16509). */
  async completeConstruction(id: ID, date: string, user: User) {
    assertTaxEditor(user);
    const o = findOr(db.property, id);
    if (o.account !== '16505' || o.completedAt) throw apiError('NOT_A_CONSTRUCTION_OBJECT');
    const before = propertyTotal(o.branchKey);
    o.completedAt = date;
    const { completedAt: _c, constructionStart: _s, normativeMonths: _n, ...rest } = clone(o);
    db.property.push({ ...rest, id: nextId('po'), account: '16509', acquiredAt: date, accumulatedAtYearStart: 0, monthlyDepreciation: Math.round(o.initialCost / 600) });
    baseChanged('acquisition', 'property', o.branchKey, o.cadastralNo, before, propertyTotal(o.branchKey), user);
    emit();
    await delay(null);
  },
  /** Продажа имущества банка: выбытие, автоматический ЭСФ покупателю, пересчёт базы (PR-TAX-056, PR-TAX-058). */
  async sellProperty(id: ID, input: { buyerName: string; buyerTin: string; price: number; date: string }, user: User): Promise<TaxAutoEsf> {
    assertTaxEditor(user);
    const o = findOr(db.property, id);
    if (o.disposedAt) throw new Error('taxes_err_disposed');
    if (!/^\d{9}$/.test(input.buyerTin)) throw new Error('taxes_err_tin');
    if (!(input.price > 0) || !input.buyerName.trim()) throw new Error('taxes_err_required');
    const before = propertyTotal(o.branchKey);
    o.disposedAt = input.date;
    const esf = await sendEsf({ kind: 'asset_sale', month: input.date.slice(0, 7), clientName: input.buyerName.trim(), tin: input.buyerTin, branchKey: o.branchKey, net: Math.round(input.price), ref: o.cadastralNo }, user);
    o.saleEsfId = esf.id;
    baseChanged('disposal', 'property', o.branchKey, o.cadastralNo, before, propertyTotal(o.branchKey), user);
    audit.log({ action: 'update', entity: 'tax_property', entityId: o.id, details: `Продажа: ${input.buyerName}, ${input.price}; ЭСФ ${esf.number}` });
    emit();
    return delay(esf);
  },
  /** Синхронизация со зданиями модуля ОС: выбывшие/списанные карточки исключаются из базы. */
  async syncWithAssets(assets: { id: ID; category: string; status: string; name: string }[], user?: User): Promise<number> {
    let changed = 0;
    for (const a of assets.filter((x) => x.category === 'buildings')) {
      const o = db.property.find((p) => p.assetId === a.id);
      if (o && a.status === 'written_off' && !o.disposedAt) {
        const before = propertyTotal(o.branchKey);
        o.disposedAt = today();
        changed++;
        baseChanged('disposal', 'property', o.branchKey, o.cadastralNo, before, propertyTotal(o.branchKey), user);
      }
    }
    if (changed) emit();
    return changed;
  },

  // --- земля ---
  listLand: (period = CURRENT_YEAR_PERIOD(today().slice(0, 7))) => delay(db.land.map((p) => ({ ...p, calc: taxLandCalc(p, period) }))),
  async updateLandArea(id: ID, areaHa: number, user: User) {
    assertTaxEditor(user);
    const p = findOr(db.land, id);
    if (!(areaHa > 0)) throw new Error('taxes_err_required');
    const before = Math.round(p.areaHa * 10_000);
    p.areaHa = Math.round(areaHa * 10_000) / 10_000;
    audit.log({ action: 'update', entity: 'tax_land', entityId: p.id, changes: [{ field: 'areaHa', from: String(before / 10_000), to: String(p.areaHa) }] });
    baseChanged('area_change', 'land', p.branchKey, p.cadastralNo, before, Math.round(p.areaHa * 10_000), user);
    emit();
    await delay(null);
  },
  async addLand(input: Omit<TaxLandPlot, 'id' | 'regionCode'>, user: User): Promise<TaxLandPlot> {
    assertTaxEditor(user);
    if (!input.cadastralNo.trim() || !(input.areaHa > 0) || !input.address.trim()) throw new Error('taxes_err_required');
    if (db.land.some((p) => p.cadastralNo === input.cadastralNo.trim())) throw new Error('taxes_err_duplicate');
    const plot: TaxLandPlot = { ...input, cadastralNo: input.cadastralNo.trim(), id: nextId('lp'), regionCode: taxRegionOf(input.branchKey) };
    db.land.push(plot);
    baseChanged('acquisition', 'land', plot.branchKey, plot.cadastralNo, 0, Math.round(plot.areaHa * 10_000), user);
    emit();
    return delay(plot);
  },
  async disposeLand(id: ID, date: string, user: User) {
    assertTaxEditor(user);
    const p = findOr(db.land, id);
    p.disposedAt = date;
    baseChanged('disposal', 'land', p.branchKey, p.cadastralNo, Math.round(p.areaHa * 10_000), 0, user);
    emit();
    await delay(null);
  },
  /** Сверка площади с кадастром (Агентство по кадастру): при расхождении площадь обновляется. */
  async checkLandCadastre(id: ID, user: User): Promise<{ changed: boolean; areaHa: number; status: string }> {
    assertTaxEditor(user);
    const p = findOr(db.land, id);
    const r = await integrationHub.call('kadastr', 'land.get', { cadastralNo: p.cadastralNo, areaHa: p.areaHa }, { userId: user.id });
    const area = Number((r.response as { areaHa?: number })?.areaHa ?? p.areaHa);
    p.cadastreCheckedAt = now();
    let changed = false;
    if (r.status === 'success' && Math.abs(area - p.areaHa) > 1e-6) {
      const before = Math.round(p.areaHa * 10_000);
      p.areaHa = area;
      changed = true;
      baseChanged('area_change', 'land', p.branchKey, p.cadastralNo, before, Math.round(area * 10_000), user);
    }
    emit();
    return { changed, areaHa: p.areaHa, status: r.status };
  },

  // --- вода ---
  listWater: (month?: string) => delay(db.water.filter((w) => !month || w.month === month).sort((a, b) => b.month.localeCompare(a.month) || a.branchKey.localeCompare(b.branchKey))),
  async addWater(input: Omit<TaxWaterReading, 'id' | 'createdBy'>, user: User): Promise<TaxWaterReading> {
    assertTaxEditor(user);
    if (!(input.m3 >= 0) || !/^\d{4}-\d{2}$/.test(input.month) || !input.objectName.trim()) throw new Error('taxes_err_required');
    const w: TaxWaterReading = { ...input, id: nextId('w'), createdBy: user.id };
    db.water.push(w);
    baseChanged('water', 'water', w.branchKey, `${w.objectName} ${w.month}`, 0, w.m3, user);
    emit();
    return delay(w);
  },
  /** Счета-фактуры водоканалов с soliq.servis.uz (PR-TAX-006). */
  async fetchWaterInvoices(month: string, user: User): Promise<{ added: number; status: string }> {
    assertTaxEditor(user);
    const r = await integrationHub.call('soliq', 'water.invoices', { month }, { userId: user.id });
    let added = 0;
    if (r.status === 'success') {
      for (const inv of SOLIQ_WATER_INVOICES) {
        if (db.water.some((w) => w.branchKey === inv.branchKey && w.month === month && w.method === 'invoice')) continue;
        db.water.push({ id: nextId('w'), branchKey: inv.branchKey, objectName: inv.objectName, month, source: inv.source, m3: inv.m3, method: 'invoice', docRef: `soliq.servis ${month}`, createdBy: user.id });
        added++;
      }
      if (added) baseChanged('water', 'water', 'HO', `soliq.servis ${month}`, 0, added, user);
    }
    emit();
    return { added, status: r.status };
  },
  waterRate: (source: TaxWaterSource, asOf: string) => taxWaterRate(source, asOf),

  // --- аренда ---
  listLeases: () => delay(db.leases.map((l) => ({ ...l, daysToEnd: daysBetween(today(), l.endDate), current: taxLeaseBase(l, today().slice(0, 7)) }))),
  listMinRent: () => delay([...db.minRent].sort((a, b) => b.year - a.year || a.regionCode.localeCompare(b.regionCode))),
  async upsertMinRent(input: Omit<TaxMinRent, 'id'>, user: User): Promise<'created' | 'updated'> {
    assertTaxEditor(user);
    if (!(input.ratePerM2 >= 0)) throw new Error('taxes_err_required');
    const ex = db.minRent.find((m) => m.year === input.year && m.regionCode === input.regionCode && m.objectType === input.objectType);
    if (ex) ex.ratePerM2 = input.ratePerM2;
    else db.minRent.push({ ...input, id: nextId('mr') });
    baseChanged('lease', 'rent_pit', input.regionCode === '*' ? 'HO' : `R${input.regionCode}`, `min ${input.year} ${input.objectType}`, ex?.ratePerM2 ?? 0, input.ratePerM2, user);
    emit();
    await delay(null);
    return ex ? 'updated' : 'created';
  },
  async addLease(input: Omit<TaxLease, 'id' | 'payments' | 'ijara' | 'source' | 'regionCode'>, user: User): Promise<TaxLease> {
    assertTaxEditor(user);
    if (!input.contractNo.trim() || !input.lessorName.trim() || !input.address.trim()) throw new Error('taxes_err_required');
    if (!/^\d{14}$/.test(input.lessorPinfl)) throw new Error('taxes_err_pinfl');
    if (!(input.monthlyRent > 0) || !(input.areaM2 > 0) || input.endDate <= input.startDate) throw new Error('taxes_err_required');
    if (db.leases.some((l) => l.contractNo === input.contractNo.trim())) throw new Error('taxes_err_duplicate');
    const l: TaxLease = { ...input, contractNo: input.contractNo.trim(), id: nextId('ls'), regionCode: taxRegionOf(input.branchKey), ijara: { status: 'not_registered' }, source: 'manual', payments: [] };
    db.leases.push(l);
    audit.log({ action: 'create', entity: 'tax_lease', entityId: l.id, details: l.contractNo });
    emit();
    return delay(l);
  },
  /** Реестр договоров аренды из ABS (PR-TAX-011). */
  async loadLeasesFromAbs(user: User): Promise<{ added: number; status: string }> {
    assertTaxEditor(user);
    const r = await integrationHub.call('iabs', 'lease.registry', { date: today() }, { userId: user.id });
    let added = 0;
    if (r.status === 'success' && !db.leases.some((l) => l.contractNo === absLeaseExtra.contractNo)) {
      db.leases.push(clone(absLeaseExtra));
      added++;
      baseChanged('lease', 'rent_pit', absLeaseExtra.branchKey, absLeaseExtra.contractNo, 0, absLeaseExtra.monthlyRent, user);
    }
    emit();
    return { added, status: r.status };
  },
  /** Проверка регистрации договора на ijara.soliq.uz (PR-TAX-007). */
  async checkIjara(id: ID, user: User): Promise<TaxLease['ijara']> {
    assertTaxEditor(user);
    const l = findOr(db.leases, id);
    const r = await integrationHub.call('soliq', 'lease.status', { contract: l.contractNo }, { userId: user.id });
    if (r.status === 'success') {
      const resp = r.response as { status?: 'registered' | 'not_registered'; regNo?: string };
      l.ijara = { status: resp.status ?? 'not_registered', ...(resp.regNo ? { regNo: resp.regNo } : {}), checkedAt: now() };
    }
    emit();
    return delay(l.ijara);
  },
  /** Отправка договора на регистрацию в ijara.soliq.uz. */
  async registerIjara(id: ID, user: User): Promise<TaxLease['ijara']> {
    assertTaxEditor(user);
    const l = findOr(db.leases, id);
    const r = await integrationHub.call('soliq', 'lease.register', { contract: l.contractNo, tin: TAX_BANK_TIN, lessorPinfl: l.lessorPinfl, amount: l.monthlyRent }, { userId: user.id });
    if (r.status === 'success') {
      const regNo = `IJ-2026-${String(Math.abs([...l.contractNo].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 900_000 + 100_000)}`;
      IJARA_REGISTRY[l.contractNo] = { status: 'registered', regNo };
      l.ijara = { status: 'registered', regNo, checkedAt: now() };
      audit.log({ action: 'submit', entity: 'tax_lease', entityId: l.id, details: `ijara.soliq.uz ${regNo}` });
    } else l.ijara = { status: 'pending', checkedAt: now() };
    emit();
    return delay(l.ijara);
  },
  /** Оплата аренды за месяц с удержанием НДФЛ. Платёж блокируется, если договор не зарегистрирован (PR-TAX-048). */
  async payLease(id: ID, month: string, user: User): Promise<TaxLeasePayment> {
    assertTaxEditor(user);
    const l = findOr(db.leases, id);
    if (!leaseActive(l, month)) throw new Error('taxes_err_lease_period');
    if (l.payments.some((p) => p.month === month && p.status === 'paid')) throw new Error('taxes_err_lease_paid');
    const b = taxLeaseBase(l, month);
    if (l.ijara.status !== 'registered') {
      const blocked: TaxLeasePayment = { month, rent: b.rent, minRent: b.minRent, base: b.base, pit: b.pit, net: b.rent - b.pit, status: 'blocked', at: now() };
      l.payments.push(blocked);
      audit.log({ action: 'block', entity: 'tax_lease', entityId: l.id, result: 'failure', details: `Платёж ${month} заблокирован: договор не зарегистрирован на ijara.soliq.uz` });
      notify({ userIds: [l.responsibleId], excludeIds: [], title: L(`Платёж по аренде ${l.contractNo} заблокирован`, `${l.contractNo} ijara to'lovi bloklandi`, `Lease payment ${l.contractNo} blocked`), body: L('Договор не зарегистрирован на ijara.soliq.uz', "Shartnoma ijara.soliq.uz da ro'yxatdan o'tmagan", 'Contract is not registered at ijara.soliq.uz'), link: '/taxes/registers?tab=leases', level: 'danger', kind: 'system' });
      emit();
      throw new Error('taxes_err_lease_blocked');
    }
    const pay: TaxLeasePayment = { month, rent: b.rent, minRent: b.minRent, base: b.base, pit: b.pit, net: b.rent - b.pit, status: 'paid', reference: nextNumber('PP'), at: now() };
    l.payments.push(pay);
    audit.log({ action: 'create', entity: 'tax_lease_payment', entityId: l.id, details: `${month}: аренда ${b.rent}, НДФЛ ${b.pit}` });
    baseChanged('lease', 'rent_pit', l.branchKey, `${l.contractNo} ${month}`, 0, b.base, user);
    emit();
    return delay(pay);
  },

  // --- налог на прибыль ---
  listLedger: (period = '2026-Q3', branchKey?: string) => delay(db.ledger.filter((l) => l.period === period && (!branchKey || l.branchKey === branchKey))),
  profitSummary: (period = '2026-Q3') => delay(taxProfitSummary(period)),
  async classifyLedger(id: ID, cls: TaxLedgerClass, user: User) {
    assertTaxEditor(user);
    const l = findOr(db.ledger, id);
    if ((l.kind === 'income') !== (cls === 'taxable' || cls === 'non_taxable')) throw new Error('taxes_err_class');
    const before = taxProfitSummary(l.period).base;
    audit.log({ action: 'update', entity: 'tax_ledger', entityId: l.id, changes: [{ field: 'cls', from: l.cls, to: cls }] });
    l.cls = cls;
    baseChanged('abs_load', 'profit', l.branchKey, `${l.account} ${l.branchKey}`, before, taxProfitSummary(l.period).base, user);
    emit();
    await delay(null);
  },
  /** Загрузка оборотов главной книги из ABS с проверкой контрольной суммы (PR-TAX-010). */
  async loadLedgerFromAbs(period: string, user: User) {
    assertTaxEditor(user);
    const expected = db.ledger.filter((l) => l.period === period).reduce((s, l) => s + l.amount, 0);
    const r = await integrationHub.call('iabs', 'ledger.turnovers', { period, expectedSum: expected }, { userId: user.id });
    const resp = r.response as { rows?: number; controlSum?: number } | undefined;
    const entry = { at: now(), period, rows: resp?.rows ?? 0, controlSum: resp?.controlSum ?? 0, matched: r.status === 'success' && resp?.controlSum === expected, exchangeId: r.id };
    db.ledgerLoads.unshift(entry);
    audit.log({ action: 'create', entity: 'tax_ledger_load', entityId: r.id, result: entry.matched ? 'success' : 'failure', details: `${period}: ${entry.rows} строк, контрольная сумма ${entry.controlSum}` });
    emit();
    return delay(entry);
  },
  listLedgerLoads: () => delay(db.ledgerLoads),
  listBenefits: () => delay(db.benefits),
  async addBenefit(input: Omit<TaxBenefit, 'id' | 'active'>, user: User): Promise<TaxBenefit> {
    assertTaxEditor(user);
    if (!input.code.trim() || !input.basis.trim() || !(input.amount > 0)) throw new Error('taxes_err_required');
    const before = taxProfitSummary(input.period).base;
    const b: TaxBenefit = { ...input, id: nextId('bf'), active: true };
    db.benefits.push(b);
    audit.log({ action: 'create', entity: 'tax_benefit', entityId: b.id, details: `${b.code}: ${b.amount}` });
    baseChanged('abs_load', 'profit', b.branchKey ?? 'HO', b.code, before, taxProfitSummary(input.period).base, user);
    emit();
    return delay(b);
  },
  async toggleBenefit(id: ID, user: User) {
    assertTaxEditor(user);
    const b = findOr(db.benefits, id);
    const before = taxProfitSummary(b.period).base;
    b.active = !b.active;
    baseChanged('abs_load', 'profit', b.branchKey ?? 'HO', b.code, before, taxProfitSummary(b.period).base, user);
    emit();
    await delay(null);
  },
  listAdvances: () => delay([...db.advances].sort((a, b) => a.month.localeCompare(b.month))),
  /** Расчёт ежемесячных авансовых платежей на следующий квартал по итогам квартала (PR-TAX-049). */
  async computeAdvances(basePeriod: string, user: User): Promise<TaxAdvance[]> {
    assertTaxEditor(user);
    const s = taxProfitSummary(basePeriod);
    const [y, q] = basePeriod.split('-Q').map(Number) as [number, number];
    const nq = q === 4 ? 1 : q + 1;
    const ny = q === 4 ? y + 1 : y;
    const months = [1, 2, 3].map((i) => `${ny}-${pad((nq - 1) * 3 + i)}`);
    const monthly = Math.round(s.tax / 3);
    for (const m of months) {
      const ex = db.advances.find((a) => a.month === m);
      if (ex && ex.paid > 0) continue;
      if (ex) ex.amount = monthly;
      else db.advances.push({ month: m, dueDate: `${m}-23`, amount: monthly, paid: 0 });
    }
    audit.log({ action: 'update', entity: 'tax_advance', details: `${months.join(', ')}: ${monthly}` });
    emit();
    return delay(db.advances.filter((a) => months.includes(a.month)));
  },
  async payAdvance(month: string, user: User) {
    assertTaxEditor(user);
    const a = db.advances.find((x) => x.month === month);
    if (!a || a.paid >= a.amount) throw new Error('taxes_err_advance');
    a.paid = a.amount;
    a.paidAt = today();
    a.reference = nextNumber('PP');
    audit.log({ action: 'create', entity: 'tax_advance', entityId: month, details: `${a.amount} ${a.reference}` });
    emit();
    await delay(null);
  },
  /** Сверка 19931/22502 за квартал: авансы против начисленного налога (PR-TAX-067). */
  recon19931(period: string): Promise<TaxRecon19931> {
    const ex = db.recon.find((r) => r.period === period);
    if (ex) return delay(ex);
    const advances = db.advances.filter((a) => quarterOfMonth(a.month) === period).reduce((s, a) => s + a.paid, 0);
    const accrued = taxProfitSummary(period).tax;
    return delay({ period, advances, accrued, difference: advances - accrued, status: 'open' as const });
  },
  /** Автоматическое закрытие разницы проводкой в ABS (переплата → зачёт, недоплата → доначисление). */
  async closeRecon19931(period: string, user: User): Promise<TaxRecon19931> {
    assertTaxEditor(user);
    if (db.recon.some((r) => r.period === period && r.status === 'closed')) throw new Error('taxes_err_recon_closed');
    const advances = db.advances.filter((a) => quarterOfMonth(a.month) === period).reduce((s, a) => s + a.paid, 0);
    const accrued = taxProfitSummary(period).tax;
    const difference = advances - accrued;
    const amount = Math.abs(difference);
    const entries = amount ? [difference > 0 ? { debit: '19997000', credit: '19931000', amount } : { debit: '22502000', credit: '19931000', amount }] : [];
    let exchangeId: string | undefined;
    if (entries.length) {
      const r = await integrationHub.call('iabs', 'postings.batch', { batch: `TAX-${period}-19931`, entries, controlSum: amount }, { userId: user.id });
      exchangeId = r.id;
      if (r.status !== 'success' && r.status !== 'queued') throw new Error('taxes_err_posting');
    }
    const rec: TaxRecon19931 = { period, advances, accrued, difference, status: 'closed', closedAt: now(), closedBy: user.id, ...(exchangeId ? { exchangeId } : {}) };
    db.recon = db.recon.filter((r) => r.period !== period);
    db.recon.push(rec);
    audit.log({ action: 'approve', entity: 'tax_recon_19931', entityId: period, details: `Авансы ${advances}, начислено ${accrued}, разница ${difference}` });
    emit();
    return delay(rec);
  },

  // --- НДС по филиалам ---
  listVatTurnover: (month: string) => delay(db.vat.filter((v) => v.month === month)),

  // --- ЭСФ по услугам с фиксированной стоимостью ---
  listServices: () => delay(db.services),
  listServiceClients: () => delay(db.clients),
  listAutoEsf: () => delay([...db.esf].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  /** Формирование ЭСФ каждому клиенту за месяц и отправка через оператора ЭСФ (PR-TAX-055). */
  async generateServiceEsf(month: string, user: User): Promise<{ created: number; skipped: number }> {
    assertTaxEditor(user);
    let created = 0;
    let skipped = 0;
    await Promise.all(db.clients.map(async (c) => {
      if (db.esf.some((e) => e.kind === 'service' && e.month === month && e.tin === c.tin)) return void skipped++;
      const net = c.serviceIds.reduce((s, sid) => s + (db.services.find((x) => x.id === sid)?.price ?? 0), 0);
      await sendEsf({ kind: 'service', month, clientName: c.name, tin: c.tin, branchKey: c.branchKey, net, ref: c.serviceIds.join(',') }, user);
      created++;
    }));
    emit();
    return { created, skipped };
  },
  async resendEsf(id: ID, user: User) {
    assertTaxEditor(user);
    const e = findOr(db.esf, id);
    if (!e.exchangeId) throw apiError('NOT_FOUND');
    const r = await integrationHub.retry(e.exchangeId, user.id);
    e.status = r.status === 'success' ? 'delivered' : r.status === 'queued' ? 'queued' : 'failed';
    emit();
    await delay(null);
  },

  // --- мониторинг ---
  listBaseChanges: () => delay(db.changes),
  scanDeadlines: () => delay(taxesScanDeadlines()),
};

async function sendEsf(input: Pick<TaxAutoEsf, 'kind' | 'month' | 'clientName' | 'tin' | 'branchKey' | 'net' | 'ref'>, user: User): Promise<TaxAutoEsf> {
  const vatRate = rateValue('vat', '*', `${input.month}-01`);
  const vat = Math.round((input.net * vatRate) / 100);
  const esf: TaxAutoEsf = { id: nextId('esf'), number: nextNumber('XB-ESF'), status: 'sent', createdAt: now(), ...input, vat, total: input.net + vat };
  db.esf.push(esf);
  const r = await integrationHub.call('soliq', 'einvoice.send', { number: esf.number, tin: esf.tin, date: today(), amount: esf.total, vat: esf.vat }, { userId: user.id });
  esf.exchangeId = r.id;
  esf.status = r.status === 'success' ? 'delivered' : r.status === 'queued' ? 'queued' : 'failed';
  return esf;
}

/** Мутируемый доступ к авансам (для сверки в api.ts). */
/** Тексты ошибок API реестров. */
export const TAX_ERRORS: Record<string, Localized> = {
  Forbidden: L('Недостаточно прав', "Huquqlar yetarli emas", 'Insufficient rights'),
  taxes_err_rate: L('Укажите значение, документ и дату начала действия', "Qiymat, hujjat va amal qilish sanasini kiriting", 'Enter value, document and effective date'),
  taxes_err_disposed: L('Объект уже выбыл', "Obyekt allaqachon chiqib ketgan", 'Object already disposed'),
  taxes_err_tin: L('ИНН — 9 цифр', 'STIR — 9 ta raqam', 'TIN must be 9 digits'),
  taxes_err_pinfl: L('ПИНФЛ — 14 цифр', 'JShShIR — 14 ta raqam', 'PINFL must be 14 digits'),
  taxes_err_required: L('Заполните обязательные поля корректно', "Majburiy maydonlarni to'g'ri to'ldiring", 'Fill in the required fields correctly'),
  taxes_err_duplicate: L('Такая запись уже есть', 'Bunday yozuv allaqachon mavjud', 'Record already exists'),
  taxes_err_lease_period: L('Договор не действует в этом месяце', 'Shartnoma bu oyda amal qilmaydi', 'Lease is not active in this month'),
  taxes_err_lease_paid: L('Аренда за этот месяц уже оплачена', "Bu oy uchun ijara allaqachon to'langan", 'Rent for this month is already paid'),
  taxes_err_lease_blocked: L('Платёж заблокирован: договор не зарегистрирован на ijara.soliq.uz', "To'lov bloklandi: shartnoma ijara.soliq.uz da ro'yxatdan o'tmagan", 'Payment blocked: lease not registered at ijara.soliq.uz'),
  taxes_err_class: L('Класс не соответствует виду оборота (доход/расход)', "Sinf aylanma turiga mos emas (daromad/xarajat)", 'Class does not match the turnover kind (income/expense)'),
  taxes_err_advance: L('Аванс не найден или уже уплачен', "Avans topilmadi yoki to'langan", 'Advance not found or already paid'),
  taxes_err_recon_closed: L('Сверка за период уже закрыта', 'Davr uchun solishtirish yopilgan', 'Reconciliation for the period is already closed'),
  taxes_err_posting: L('Проводка не принята ABS — повторите позже', "Provodka ABS tomonidan qabul qilinmadi — keyinroq takrorlang", 'Posting rejected by ABS — retry later'),
};

export const taxRegistryInternal = { advancesPaid: (period: string) => db.advances.filter((a) => quarterOfMonth(a.month) === period).reduce((s, a) => s + a.paid, 0) };
export type { ImportValue };
