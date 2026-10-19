// МСФО: Adjustments Engine (амортизация и переоценка ОС по МСФО, аренда по МСФО 16), отчёт о движении ОС,
// отчёт о движении денежных средств (прямой и косвенный методы), KPI в динамике, план-факт и ZBB по дочерним,
// система раннего предупреждения («красные флажки») с настраиваемыми триггерами (ТЗ 4.2.18, блоки В–Г).
import { clone, delay, emit, nextId, now } from '../../bus';
import { audit } from '../../audit';
import { notify } from '../../notifications';
import type { ID, Localized, Role, User } from '../../types';
import { assetsApi } from '../assets';
import { computeIfrsConsolidation, ifrsApi, ifrsEntityValues, ifrsProfit, IFRS_ASSET_LINES, IFRS_LIABILITY_LINES } from './api';
import { IFRS_USD_RATE, ifrsEntitiesSeed } from './data';
import { ifrsAssertEditor, ifrsOverdueShare, ifrsSubsApi } from './subs';
import type { IfrsConsolidation, IfrsLine, IfrsLineValues } from './types';
import { apiError } from '../../errors';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const B = 1_000_000_000;
const M = 1_000_000;
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

// ---------------------------------------------------------------------------------------------
// ОС по МСФО: классы ОС дочерних (НСБУ → МСФО), политика сроков полезного использования, переоценка

export interface IfrsFaClass {
  id: ID;
  entityId: ID;
  name: Localized;
  cost: number;
  accDepOpen: number; // накопленная амортизация НСБУ на 01.01
  nsbuLifeYears: number;
  ifrsLifeYears: number;
  fairValue?: number; // модель переоценки
  additions: number;
  disposals: number;
}

const faSeed: IfrsFaClass[] = [
  { id: 'fa1', entityId: 'e0', name: L('Здания (модель переоценки)', 'Binolar (qayta baholash modeli)', 'Buildings (revaluation model)'), cost: 2_100 * B, accDepOpen: 380 * B, nsbuLifeYears: 20, ifrsLifeYears: 50, fairValue: 2_050 * B, additions: 0, disposals: 0 },
  { id: 'fa2', entityId: 'e0', name: L('Оборудование и банкоматы', 'Uskunalar va bankomatlar', 'Equipment and ATMs'), cost: 1_150 * B, accDepOpen: 410 * B, nsbuLifeYears: 5, ifrsLifeYears: 7, additions: 160 * B, disposals: 25 * B },
  { id: 'fa3', entityId: 'e1', name: L('Офисы и оборудование', 'Ofislar va uskunalar', 'Offices and equipment'), cost: 165 * B, accDepOpen: 38 * B, nsbuLifeYears: 10, ifrsLifeYears: 15, additions: 6 * B, disposals: 0 },
  { id: 'fa4', entityId: 'e2', name: L('Оборудование', 'Uskunalar', 'Equipment'), cost: 41 * B, accDepOpen: 12 * B, nsbuLifeYears: 5, ifrsLifeYears: 6, additions: 2 * B, disposals: 1 * B },
  { id: 'fa5', entityId: 'e4', name: L('Транспорт и техника', 'Transport va texnika', 'Vehicles and equipment'), cost: 18 * B, accDepOpen: 6 * B, nsbuLifeYears: 5, ifrsLifeYears: 5, additions: 1 * B, disposals: 0 },
];

export interface IfrsFaCalc {
  cls: IfrsFaClass;
  nsbuDep: number;
  ifrsDep: number;
  depDiff: number;
  ifrsCarrying: number;
  revaluation: number;
}

const PERIOD_FRACTION = 9 / 12;
export function ifrsFaCalc(c: IfrsFaClass): IfrsFaCalc {
  const avgCost = c.cost + (c.additions - c.disposals) / 2;
  const nsbuDep = Math.round((avgCost / c.nsbuLifeYears) * PERIOD_FRACTION);
  const ifrsDep = Math.round((avgCost / c.ifrsLifeYears) * PERIOD_FRACTION);
  const ifrsCarrying = c.cost + c.additions - c.disposals - c.accDepOpen - ifrsDep;
  const revaluation = c.fairValue !== undefined ? c.fairValue - ifrsCarrying : 0;
  return { cls: c, nsbuDep, ifrsDep, depDiff: ifrsDep - nsbuDep, ifrsCarrying, revaluation };
}

// ---------------------------------------------------------------------------------------------
// МСФО 16: договоры аренды → актив в форме права пользования, обязательство, график

export interface IfrsLease16 {
  id: ID;
  entityId: ID;
  name: Localized;
  monthlyPayment: number;
  termMonths: number;
  startDate: string;
  discountRate: number; // % годовых
}

const leaseSeed: IfrsLease16[] = [
  { id: 'l16a', entityId: 'e0', name: L('Аренда помещений мини-банков (пакет 24 договора)', 'Mini-banklar binolari ijarasi (24 ta shartnoma)', 'Mini-bank premises lease (24 contracts)'), monthlyPayment: 1_450 * M, termMonths: 60, startDate: '2025-07-01', discountRate: 21 },
  { id: 'l16b', entityId: 'e1', name: L('Аренда офиса XB Lizing', 'XB Lizing ofisi ijarasi', 'XB Lizing office lease'), monthlyPayment: 120 * M, termMonths: 36, startDate: '2026-01-01', discountRate: 22 },
  { id: 'l16c', entityId: 'e4', name: L('Аренда точек выдачи микрозаймов', 'Mikroqarz berish shoxobchalari ijarasi', 'Microloan outlet leases'), monthlyPayment: 85 * M, termMonths: 24, startDate: '2026-03-01', discountRate: 24 },
];

export interface IfrsLeaseRow {
  month: number;
  date: string;
  payment: number;
  interest: number;
  principal: number;
  liability: number;
  depreciation: number;
  rou: number;
}

export interface IfrsLeaseCalc {
  lease: IfrsLease16;
  pv: number;
  elapsed: number;
  schedule: IfrsLeaseRow[];
  liability: number;
  rou: number;
  interestYtd: number;
  depreciationYtd: number;
  paidYtd: number;
  lines: { line: IfrsLine; delta: number }[];
}

const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));

/** Расчёт по МСФО 16 на 30.09.2026: корректировка устраняет арендный расход НСБУ (платежи текущего года)
 *  и признаёт амортизацию права пользования и процентный расход; баланс: актив = обязательство + эффект на капитал. */
export function ifrsLeaseCalc(l: IfrsLease16, asOf = '2026-09-30'): IfrsLeaseCalc {
  const r = l.discountRate / 100 / 12;
  const pv = Math.round(l.monthlyPayment * ((1 - (1 + r) ** -l.termMonths) / r));
  const schedule: IfrsLeaseRow[] = [];
  let liab = pv;
  const dep = pv / l.termMonths;
  for (let m = 1; m <= l.termMonths; m++) {
    const interest = Math.round(liab * r);
    const principal = l.monthlyPayment - interest;
    liab = Math.max(0, liab - principal);
    const d = new Date(Date.parse(l.startDate + 'T00:00:00Z'));
    d.setUTCMonth(d.getUTCMonth() + m - 1);
    schedule.push({ month: m, date: d.toISOString().slice(0, 7), payment: l.monthlyPayment, interest, principal, liability: Math.round(liab), depreciation: Math.round(dep), rou: Math.round(pv - dep * m) });
  }
  const elapsed = Math.max(0, Math.min(l.termMonths, monthsBetween(l.startDate, asOf) + 1));
  const ytd = schedule.filter((s) => s.month <= elapsed && s.date >= '2026-01');
  const prior = schedule.filter((s) => s.month <= elapsed && s.date < '2026-01');
  const liability = elapsed ? schedule[elapsed - 1]!.liability : pv;
  const rou = elapsed ? schedule[elapsed - 1]!.rou : pv;
  const interestYtd = ytd.reduce((s, x) => s + x.interest, 0);
  const depreciationYtd = ytd.reduce((s, x) => s + x.depreciation, 0);
  const paidYtd = ytd.reduce((s, x) => s + x.payment, 0);
  // Эффект прошлых лет (до 01.01) — через нераспределённую прибыль.
  // = Σ (платёж − процент − амортизация) за месяцы до 01.01; считается балансирующей величиной, чтобы
  // округления графика не нарушали равенство актив = обязательства + капитал.
  void prior;
  const priorEffect = rou - liability - paidYtd + interestYtd + depreciationYtd;
  const lines: { line: IfrsLine; delta: number }[] = [
    { line: 'fixed_assets', delta: rou },
    { line: 'other_liabilities', delta: liability },
    { line: 'opex', delta: depreciationYtd - paidYtd },
    { line: 'interest_expense', delta: interestYtd },
    { line: 'retained', delta: priorEffect },
  ];
  return { lease: l, pv, elapsed, schedule, liability, rou, interestYtd, depreciationYtd, paidYtd, lines };
}

// ---------------------------------------------------------------------------------------------
// Движение денежных средств (PR-SUB-021)

export interface IfrsCashFlow {
  scope: ID | 'group';
  opening: number;
  closing: number;
  indirect: { key: string; label: Localized; amount: number; section: 'operating' | 'investing' | 'financing' }[];
  direct: { key: string; label: Localized; amount: number }[];
  operating: number;
  investing: number;
  financing: number;
  check: number; // operating + investing + financing − Δcash (должно быть 0)
}

const val = (v: IfrsLineValues, l: IfrsLine) => v[l] ?? 0;

function cashFlowFrom(open: IfrsLineValues, close: IfrsLineValues, profit: number, eclCharge: number, shareAssoc: number, scope: ID | 'group', nciDelta = 0): IfrsCashFlow {
  const d = (l: IfrsLine) => val(close, l) - val(open, l);
  const indirect: IfrsCashFlow['indirect'] = [
    { key: 'profit', label: L('Чистая прибыль', 'Sof foyda', 'Net profit'), amount: profit, section: 'operating' },
    { key: 'ecl', label: L('Резерв ОКУ (неденежная статья)', 'KKZ zaxirasi (pulsiz modda)', 'ECL charge (non-cash)'), amount: eclCharge, section: 'operating' },
    { key: 'assoc', label: L('Доля в прибыли ассоциированных (неденежная)', 'Assotsiatsiyalanganlar foydasidagi ulush (pulsiz)', 'Share of associates (non-cash)'), amount: -shareAssoc, section: 'operating' },
    { key: 'loans', label: L('Изменение кредитов и лизинга (брутто)', 'Kreditlar va lizing o‘zgarishi (brutto)', 'Change in loans and leases (gross)'), amount: -(d('loans') + eclCharge), section: 'operating' },
    { key: 'due', label: L('Изменение средств в банках', 'Banklardagi mablag‘lar o‘zgarishi', 'Change in due from banks'), amount: -d('due_banks'), section: 'operating' },
    { key: 'oa', label: L('Изменение прочих активов', 'Boshqa aktivlar o‘zgarishi', 'Change in other assets'), amount: -d('other_assets'), section: 'operating' },
    { key: 'dep', label: L('Изменение депозитов клиентов', 'Mijozlar depozitlari o‘zgarishi', 'Change in customer deposits'), amount: d('deposits'), section: 'operating' },
    { key: 'ol', label: L('Изменение прочих обязательств', 'Boshqa majburiyatlar o‘zgarishi', 'Change in other liabilities'), amount: d('other_liabilities'), section: 'operating' },
    { key: 'inv', label: L('Инвестиции в ценные бумаги и компании', 'Qimmatli qog‘ozlar va kompaniyalarga investitsiyalar', 'Investments in securities and companies'), amount: -(d('investments') - shareAssoc), section: 'investing' },
    { key: 'fa', label: L('Приобретение ОС (нетто)', 'AV sotib olish (netto)', 'Purchase of fixed assets (net)'), amount: -(d('fixed_assets') + d('goodwill')), section: 'investing' },
    { key: 'borr', label: L('Привлечение / погашение заимствований', 'Qarzlarni jalb qilish / so‘ndirish', 'Borrowings raised / repaid'), amount: d('borrowings'), section: 'financing' },
    { key: 'eq', label: L('Капитал, дивиденды и доля НКД', 'Kapital, dividendlar va NNU ulushi', 'Equity, dividends and NCI'), amount: d('share_capital') + d('retained') + nciDelta, section: 'financing' },
  ];
  const sum = (s: string) => indirect.filter((x) => x.section === s).reduce((a, x) => a + x.amount, 0);
  const operating = sum('operating');
  const investing = sum('investing');
  const financing = sum('financing');
  const wc = -(d('loans') + eclCharge) - d('due_banks') - d('other_assets') + d('deposits') + d('other_liabilities');
  const direct: IfrsCashFlow['direct'] = [
    { key: 'ii', label: L('Проценты полученные', 'Olingan foizlar', 'Interest received'), amount: val(close, 'interest_income') },
    { key: 'ie', label: L('Проценты уплаченные', 'To‘langan foizlar', 'Interest paid'), amount: -val(close, 'interest_expense') },
    { key: 'fee', label: L('Комиссии и прочие доходы полученные', 'Olingan komissiyalar va boshqa daromadlar', 'Fees and other income received'), amount: val(close, 'fee_income') + val(close, 'other_income') },
    { key: 'opex', label: L('Операционные расходы уплаченные', 'To‘langan operatsion xarajatlar', 'Operating expenses paid'), amount: -val(close, 'opex') },
    { key: 'tax', label: L('Налог на прибыль уплаченный', 'To‘langan foyda solig‘i', 'Income tax paid'), amount: -val(close, 'tax') },
    { key: 'wc', label: L('Изменение операционных активов и обязательств', 'Operatsion aktiv va majburiyatlar o‘zgarishi', 'Change in operating assets and liabilities'), amount: wc },
  ];
  const opening = val(open, 'cash');
  const closing = val(close, 'cash');
  return { scope, opening, closing, indirect, direct, operating, investing, financing, check: operating + investing + financing - (closing - opening) };
}

function consValues(c: IfrsConsolidation): IfrsLineValues {
  const out: IfrsLineValues = {};
  for (const r of [...c.sfp, ...c.pl]) if (r.kind === 'line') out[r.line as IfrsLine] = r.consolidated;
  return out;
}

export function ifrsCashFlow(scope: ID | 'group'): IfrsCashFlow {
  if (scope === 'group') {
    const close = computeIfrsConsolidation();
    const open = computeIfrsConsolidation({ opening: true });
    const cv = consValues(close);
    const ov = consValues(open);
    // Профит в косвенном методе — вся чистая прибыль (включая НКД); изменение НКД без её прибыли — в финансовой деятельности.
    const nciDelta = close.nci - open.nci - close.profitNci;
    return cashFlowFrom(ov, cv, close.netProfit, val(cv, 'ecl_charge'), close.associatesShare, 'group', nciDelta);
  }
  const close = ifrsEntityValues(scope);
  const open = ifrsEntityValues(scope, true);
  return cashFlowFrom(open, close, ifrsProfit(close), val(close, 'ecl_charge'), 0, scope);
}

// ---------------------------------------------------------------------------------------------
// KPI (PR-SUB-022): ROA, ROE, EBITDA, CIR, Net Profit Margin — по предприятиям и группе, в динамике

export interface IfrsKpi {
  scope: ID | 'group';
  roa: number;
  roe: number;
  ebitda: number;
  cir: number;
  npm: number;
  profit: number;
  assets: number;
  equity: number;
}

function kpiFrom(scope: ID | 'group', v: IfrsLineValues, open: IfrsLineValues, months: number, nci = 0): IfrsKpi {
  const profit = ifrsProfit(v);
  const assets = IFRS_ASSET_LINES.reduce((s, l) => s + val(v, l), 0);
  const assetsOpen = IFRS_ASSET_LINES.reduce((s, l) => s + val(open, l), 0);
  const equity = val(v, 'share_capital') + val(v, 'retained') + profit + nci;
  const equityOpen = val(open, 'share_capital') + val(open, 'retained') + nci;
  const ann = 12 / months;
  const da = Math.round(val(v, 'fixed_assets') * 0.1 * (months / 12));
  const income = val(v, 'interest_income') - val(v, 'interest_expense') + val(v, 'fee_income') + val(v, 'other_income') + val(v, 'share_associates');
  const gross = val(v, 'interest_income') + val(v, 'fee_income') + val(v, 'other_income') + val(v, 'share_associates');
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    scope,
    roa: r1((profit * ann * 100) / Math.max(1, (assets + assetsOpen) / 2)),
    roe: r1((profit * ann * 100) / Math.max(1, (equity + equityOpen) / 2)),
    ebitda: profit + val(v, 'tax') + val(v, 'interest_expense') + da,
    cir: r1((val(v, 'opex') * 100) / Math.max(1, income)),
    npm: r1((profit * 100) / Math.max(1, gross)),
    profit,
    assets,
    equity,
  };
}

export function ifrsKpis(): IfrsKpi[] {
  const out: IfrsKpi[] = [];
  for (const e of ifrsEntitiesSeed.filter((x) => x.method !== 'equity')) out.push(kpiFrom(e.id, ifrsEntityValues(e.id), ifrsEntityValues(e.id, true), 9));
  const c = computeIfrsConsolidation();
  const o = computeIfrsConsolidation({ opening: true });
  const cv = consValues(c);
  const k = kpiFrom('group', cv, consValues(o), 9);
  k.profit = c.netProfit;
  k.equity = c.totalLiabilitiesAndEquity - IFRS_LIABILITY_LINES.reduce((s, l) => s + val(cv, l), 0);
  out.push(k);
  return out;
}

/** Динамика KPI по месяцам (нарастающим итогом): прибыль распределена по месяцам профилем, активы — линейно от входящих. */
const PROFILE = [0.09, 0.1, 0.11, 0.105, 0.11, 0.115, 0.12, 0.12, 0.13];
export function ifrsKpiTrend(scope: ID | 'group'): { month: string; roa: number; roe: number; cir: number; npm: number }[] {
  const closeVals = scope === 'group' ? consValues(computeIfrsConsolidation()) : ifrsEntityValues(scope);
  const openVals = scope === 'group' ? consValues(computeIfrsConsolidation({ opening: true })) : ifrsEntityValues(scope, true);
  const totalW = PROFILE.reduce((a, b) => a + b, 0);
  let cum = 0;
  return MONTHS.map((month, i) => {
    cum += PROFILE[i]!;
    const share = cum / totalW;
    const t = (i + 1) / 9;
    const v: IfrsLineValues = {};
    for (const l of [...IFRS_ASSET_LINES, ...IFRS_LIABILITY_LINES, 'share_capital', 'retained'] as IfrsLine[]) v[l] = Math.round(val(openVals, l) + (val(closeVals, l) - val(openVals, l)) * t);
    for (const l of ['interest_income', 'interest_expense', 'fee_income', 'other_income', 'opex', 'ecl_charge', 'share_associates', 'tax'] as IfrsLine[]) {
      // Небольшая сезонность расходов: CIR колеблется по месяцам.
      const season = l === 'opex' ? 1 + Math.sin(i) * 0.04 : 1;
      v[l] = Math.round(val(closeVals, l) * share * season);
    }
    const k = kpiFrom(scope, v, openVals, i + 1);
    return { month, roa: k.roa, roe: k.roe, cir: k.cir, npm: k.npm };
  });
}

// ---------------------------------------------------------------------------------------------
// План-факт и ZBB по дочерним (PR-SUB-023…025)

export type IfrsBudgetItem = 'income' | 'staff' | 'rent' | 'it' | 'marketing' | 'admin' | 'capex';
export interface IfrsBudgetLine {
  id: ID;
  entityId: ID;
  month: string;
  item: IfrsBudgetItem;
  plan: number;
  actual?: number;
  justification: string; // обоснование по ZBB (с нуля)
  driver: string;
  approvedAt: string;
  varianceComment?: string;
}

const BL = (id: string, entityId: ID, month: string, item: IfrsBudgetItem, plan: number, actual: number | undefined, justification: string, driver: string): IfrsBudgetLine => ({
  id, entityId, month, item, plan, ...(actual !== undefined ? { actual } : {}), justification, driver, approvedAt: `${month}-01`,
});
const budgetSeed: IfrsBudgetLine[] = [
  ...(['2026-08', '2026-09'] as const).flatMap((m, mi) => [
    BL(`b1${mi}`, 'e1', m, 'income', 38 * B, mi ? 36.4 * B : 37.6 * B, 'Портфель лизинга 1,9 трлн × доходность 22% / 12', 'портфель × ставка'),
    BL(`b2${mi}`, 'e1', m, 'staff', 2.6 * B, mi ? 2.65 * B : 2.58 * B, '64 шт. ед. × средняя зарплата', 'штатные единицы'),
    BL(`b3${mi}`, 'e1', m, 'rent', 0.12 * B, 0.12 * B, 'Договор аренды офиса (МСФО 16)', 'договор'),
    BL(`b4${mi}`, 'e1', m, 'it', 0.35 * B, mi ? 0.52 * B : 0.41 * B, 'Лицензии 1С и сопровождение', 'лицензии'),
    BL(`b5${mi}`, 'e1', m, 'marketing', 0.4 * B, mi ? 0.71 * B : 0.46 * B, '', ''),
    BL(`b6${mi}`, 'e2', m, 'income', 17 * B, mi ? 17.9 * B : 16.4 * B, 'Страховые премии по плану продаж', 'договоры × премия'),
    BL(`b7${mi}`, 'e2', m, 'staff', 7.2 * B, 7.3 * B, '118 шт. ед.', 'штатные единицы'),
    BL(`b8${mi}`, 'e2', m, 'admin', 2.1 * B, mi ? 2.9 * B : 2.3 * B, 'Офисные расходы по нормативу на сотрудника', 'численность'),
    BL(`b9${mi}`, 'e4', m, 'income', 15 * B, mi ? 13.1 * B : 14.2 * B, 'Портфель микрозаймов × ставка', 'портфель × ставка'),
    BL(`b10${mi}`, 'e4', m, 'staff', 3.1 * B, 3.2 * B, '86 шт. ед.', 'штатные единицы'),
    BL(`b11${mi}`, 'e4', m, 'capex', 0.6 * B, mi ? 1.4 * B : 0.2 * B, 'Обновление точек выдачи', 'план открытия точек'),
  ]),
  BL('b20', 'e1', '2026-10', 'income', 39 * B, undefined, 'Портфель лизинга × доходность', 'портфель × ставка'),
  BL('b21', 'e1', '2026-10', 'marketing', 0.4 * B, undefined, 'Кампания «Автолизинг»: 3 канала × бюджет', 'каналы'),
  BL('b22', 'e4', '2026-10', 'capex', 0.8 * B, undefined, '', ''),
];

export interface IfrsBudgetView extends IfrsBudgetLine {
  variance?: number;
  variancePct?: number;
  adverse: boolean;
  flags: ('no_justification' | 'variance' | 'no_comment')[];
}

// ---------------------------------------------------------------------------------------------
// Красные флажки (PR-SUB-026/027)

export type IfrsTriggerKind = 'receivables_overdue' | 'liquidity' | 'plan_deviation';
export interface IfrsTrigger {
  id: ID;
  kind: IfrsTriggerKind;
  name: Localized;
  threshold: number;
  enabled: boolean;
  roles: Role[];
}
export interface IfrsRedFlag {
  id: string;
  triggerId: ID;
  kind: IfrsTriggerKind;
  entityId: ID;
  value: number;
  threshold: number;
  trend: number[];
  severity: 'warning' | 'danger';
  message: Localized;
}

const triggersSeed: IfrsTrigger[] = [
  { id: 'tr1', kind: 'receivables_overdue', name: L('Рост просроченной дебиторской задолженности (> 30 дн.), % от дебиторки', "Muddati o'tgan debitorlik ulushining o'sishi (> 30 kun), %", 'Rising overdue receivables (> 30 days), % of receivables'), threshold: 25, enabled: true, roles: ['finance', 'dept_head'] },
  { id: 'tr2', kind: 'liquidity', name: L('Коэффициент ликвидности ниже критического уровня', 'Likvidlik koeffitsienti kritik darajadan past', 'Liquidity ratio below critical level'), threshold: 0.3, enabled: true, roles: ['finance', 'treasury'] },
  { id: 'tr3', kind: 'plan_deviation', name: L('Негативное отклонение расходов от плана растёт, %', "Xarajatlarning rejadan salbiy og'ishi o'smoqda, %", 'Adverse cost deviation from plan increasing, %'), threshold: 15, enabled: true, roles: ['finance'] },
];
/** Доля просроченной (> 30 дн.) дебиторки за июль–август (архив реестров); сентябрь считается из реестра ДЗ/КЗ принятого пакета. */
const OVERDUE_PRIOR: Record<ID, number[]> = { e1: [21, 27], e2: [5, 6], e3: [0, 0], e4: [80, 86] };
function overdueHistory(): Record<ID, number[]> {
  return Object.fromEntries(Object.entries(OVERDUE_PRIOR).map(([id, h]) => {
    const cur = ifrsOverdueShare(id);
    return [id, cur === undefined ? h : [...h, cur]];
  }));
}

const db = {
  fa: clone(faSeed),
  leases: clone(leaseSeed),
  budget: clone(budgetSeed),
  triggers: clone(triggersSeed),
  flagChecks: [] as { at: string; flags: number; notified: number }[],
};

function budgetView(b: IfrsBudgetLine): IfrsBudgetView {
  const flags: IfrsBudgetView['flags'] = [];
  if (!b.justification.trim()) flags.push('no_justification');
  let variance: number | undefined;
  let variancePct: number | undefined;
  let adverse = false;
  if (b.actual !== undefined) {
    variance = b.actual - b.plan;
    variancePct = b.plan ? Math.round((variance / b.plan) * 1000) / 10 : 0;
    adverse = b.item === 'income' ? variance < 0 : variance > 0;
    if (adverse && Math.abs(variancePct) > 10) {
      flags.push('variance');
      if (!b.varianceComment) flags.push('no_comment');
    }
  }
  return { ...b, ...(variance !== undefined ? { variance, variancePct } : {}), adverse, flags };
}

function evaluateFlags(): IfrsRedFlag[] {
  const out: IfrsRedFlag[] = [];
  for (const t of db.triggers.filter((x) => x.enabled)) {
    for (const e of ifrsEntitiesSeed.filter((x) => x.type === 'subsidiary')) {
      if (t.kind === 'receivables_overdue') {
        const h = overdueHistory()[e.id] ?? [];
        const rising = h.length >= 3 && h[2]! > h[1]! && h[1]! > h[0]!;
        if (rising && h[2]! > t.threshold) out.push({ id: `${t.id}-${e.id}`, triggerId: t.id, kind: t.kind, entityId: e.id, value: h[2]!, threshold: t.threshold, trend: h, severity: h[2]! > t.threshold * 2 ? 'danger' : 'warning', message: L(`${e.shortName}: просрочка дебиторки растёт 2 месяца подряд — ${h.join('% → ')}%`, `${e.shortName}: debitorlik muddati 2 oy ketma-ket o'smoqda — ${h.join('% → ')}%`, `${e.shortName}: overdue receivables rising 2 months in a row — ${h.join('% → ')}%`) });
      }
      if (t.kind === 'liquidity') {
        const v = ifrsEntityValues(e.id);
        const liquid = val(v, 'cash') + val(v, 'due_banks');
        const shortLiab = val(v, 'other_liabilities') + val(v, 'borrowings') * 0.45;
        const ratio = Math.round((liquid / Math.max(1, shortLiab)) * 100) / 100;
        if (ratio < t.threshold) out.push({ id: `${t.id}-${e.id}`, triggerId: t.id, kind: t.kind, entityId: e.id, value: ratio, threshold: t.threshold, trend: [Math.round(ratio * 115) / 100, Math.round(ratio * 106) / 100, ratio], severity: ratio < t.threshold / 2 ? 'danger' : 'warning', message: L(`${e.shortName}: ликвидность ${ratio} ниже порога ${t.threshold}`, `${e.shortName}: likvidlik ${ratio} chegaradan (${t.threshold}) past`, `${e.shortName}: liquidity ${ratio} below threshold ${t.threshold}`) });
      }
      if (t.kind === 'plan_deviation') {
        const dev = (month: string) => {
          const rows = db.budget.filter((b) => b.entityId === e.id && b.month === month && b.item !== 'income' && b.actual !== undefined);
          const plan = rows.reduce((s, b) => s + b.plan, 0);
          const act = rows.reduce((s, b) => s + (b.actual ?? 0), 0);
          return plan ? Math.round(((act - plan) / plan) * 1000) / 10 : 0;
        };
        const aug = dev('2026-08');
        const sep = dev('2026-09');
        if (sep > aug && sep > t.threshold) out.push({ id: `${t.id}-${e.id}`, triggerId: t.id, kind: t.kind, entityId: e.id, value: sep, threshold: t.threshold, trend: [aug, sep], severity: sep > t.threshold * 2 ? 'danger' : 'warning', message: L(`${e.shortName}: перерасход к плану растёт — ${aug}% → ${sep}%`, `${e.shortName}: rejaga nisbatan ortiqcha xarajat o'smoqda — ${aug}% → ${sep}%`, `${e.shortName}: overspend vs plan increasing — ${aug}% → ${sep}%`) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Публичный API аналитики

export interface IfrsFaMovementRow {
  entityId: ID;
  group: string;
  openCost: number;
  additions: number;
  disposals: number;
  closeCost: number;
  depNsbu: number;
  depIfrs: number;
  carryingNsbu: number;
  carryingIfrs: number;
}

export const ifrsAnalyticsApi = {
  // --- ОС ---
  listFaClasses: () => delay(db.fa.map(ifrsFaCalc)),
  async updateFaClass(id: ID, patch: Partial<Pick<IfrsFaClass, 'ifrsLifeYears' | 'fairValue'>>, user: User) {
    ifrsAssertEditor(user);
    const c = db.fa.find((x) => x.id === id);
    if (!c) throw apiError('NOT_FOUND');
    if (patch.ifrsLifeYears !== undefined && !(patch.ifrsLifeYears > 0)) throw new Error('ifrs_err_amount');
    audit.log({ action: 'update', entity: 'ifrs_fa_class', entityId: id, changes: Object.entries(patch).map(([k, v]) => ({ field: k, from: String((c as unknown as Record<string, unknown>)[k] ?? '—'), to: String(v ?? '—') })) });
    Object.assign(c, patch);
    emit();
    await delay(null);
  },
  /** Автоматическая корректировка амортизации и переоценки ОС по МСФО для предприятия (PR-SUB-018). */
  async applyFaAdjustment(entityId: ID, user: User) {
    const calcs = db.fa.filter((c) => c.entityId === entityId).map(ifrsFaCalc);
    if (!calcs.length) throw apiError('NOT_FOUND');
    const depDiff = calcs.reduce((s, c) => s + c.depDiff, 0);
    const reval = calcs.reduce((s, c) => s + c.revaluation, 0);
    return ifrsApi.setAutoAdjustment({
      entityId, type: 'fixed_assets', source: `fa:${entityId}`,
      description: `Амортизация ОС по МСФО (разница со сроками НСБУ: ${Math.round(depDiff / M)} млн) и переоценка (${Math.round(reval / M)} млн, резерв переоценки в капитале) — расчёт Adjustments Engine`,
      lines: [{ line: 'fixed_assets', delta: -depDiff + reval }, { line: 'opex', delta: depDiff }, { line: 'retained', delta: reval }],
    }, user);
  },
  /** Регламентированный отчёт о движении ОС (НСБУ и МСФО): банк — из модуля ОС, дочерние — из классов ОС (PR-SUB-020). */
  async faMovement(): Promise<IfrsFaMovementRow[]> {
    const rows: IfrsFaMovementRow[] = [];
    const assets = await assetsApi.list();
    const groups = [...new Set(assets.map((a) => a.category))];
    for (const g of groups) {
      const list = assets.filter((a) => a.category === g);
      const additions = list.filter((a) => a.acquiredAt >= '2026-01-01').reduce((s, a) => s + a.cost, 0);
      const disposals = list.filter((a) => a.status === 'written_off').reduce((s, a) => s + a.cost, 0);
      const closeCost = list.reduce((s, a) => s + a.cost, 0) - disposals;
      const depNsbu = list.reduce((s, a) => s + Math.min(a.accumulated, Math.round((a.cost / Math.max(1, a.usefulLifeMonths)) * 9)), 0);
      const lifeK = g === 'buildings' ? 2.5 : g === 'atm' || g === 'computers' ? 1.4 : 1.2;
      const depIfrs = Math.round(depNsbu / lifeK);
      const acc = list.reduce((s, a) => s + a.accumulated, 0);
      rows.push({ entityId: 'e0', group: g, openCost: closeCost - additions + disposals, additions, disposals, closeCost, depNsbu, depIfrs, carryingNsbu: closeCost - acc, carryingIfrs: closeCost - acc + depNsbu - depIfrs });
    }
    for (const c of db.fa.filter((x) => x.entityId !== 'e0').map(ifrsFaCalc)) {
      const closeCost = c.cls.cost + c.cls.additions - c.cls.disposals;
      rows.push({ entityId: c.cls.entityId, group: c.cls.name.ru, openCost: c.cls.cost, additions: c.cls.additions, disposals: c.cls.disposals, closeCost, depNsbu: c.nsbuDep, depIfrs: c.ifrsDep, carryingNsbu: closeCost - c.cls.accDepOpen - c.nsbuDep, carryingIfrs: c.ifrsCarrying });
    }
    return delay(rows);
  },

  // --- МСФО 16 ---
  listLeases16: () => delay(db.leases.map((l) => ifrsLeaseCalc(l))),
  async addLease16(input: Omit<IfrsLease16, 'id' | 'name'> & { name: string }, user: User) {
    ifrsAssertEditor(user);
    if (!(input.monthlyPayment > 0) || !(input.termMonths > 0) || !(input.discountRate > 0) || !input.name.trim()) throw new Error('ifrs_err_amount');
    const l: IfrsLease16 = { ...input, id: nextId('l16'), name: L(input.name, input.name, input.name) };
    db.leases.push(l);
    audit.log({ action: 'create', entity: 'ifrs_lease16', entityId: l.id, details: `${l.entityId}: ${l.monthlyPayment} × ${l.termMonths}` });
    emit();
    return delay(ifrsLeaseCalc(l));
  },
  /** Корректировка по МСФО 16: право пользования, обязательство, процент и амортизация вместо аренды (PR-SUB-019). */
  async applyLease16(id: ID, user: User) {
    const l = db.leases.find((x) => x.id === id);
    if (!l) throw apiError('NOT_FOUND');
    const c = ifrsLeaseCalc(l);
    return ifrsApi.setAutoAdjustment({ entityId: l.entityId, type: 'lease', source: `l16:${l.id}`, description: `МСФО 16: ${l.name.ru} — право пользования ${Math.round(c.rou / M)} млн, обязательство ${Math.round(c.liability / M)} млн, проценты ${Math.round(c.interestYtd / M)} млн`, lines: c.lines }, user);
  },

  // --- ДДС и KPI ---
  cashFlow: (scope: ID | 'group') => delay(ifrsCashFlow(scope)),
  kpis: () => delay(ifrsKpis()),
  kpiTrend: (scope: ID | 'group') => delay(ifrsKpiTrend(scope)),

  // --- план-факт и ZBB ---
  listBudget: (filter: { entityId?: ID; month?: string } = {}) => delay(db.budget.filter((b) => (!filter.entityId || b.entityId === filter.entityId) && (!filter.month || b.month === filter.month)).map(budgetView)),
  async updateBudgetLine(id: ID, patch: Partial<Pick<IfrsBudgetLine, 'justification' | 'driver' | 'varianceComment' | 'plan'>>, user: User) {
    ifrsAssertEditor(user);
    const b = db.budget.find((x) => x.id === id);
    if (!b) throw apiError('NOT_FOUND');
    if (patch.plan !== undefined && b.month <= '2026-09') throw new Error('ifrs_err_plan_locked');
    audit.log({ action: 'update', entity: 'ifrs_budget', entityId: id, changes: Object.entries(patch).map(([k, v]) => ({ field: k, from: String((b as unknown as Record<string, unknown>)[k] ?? '—'), to: String(v ?? '—') })) });
    Object.assign(b, patch);
    emit();
    await delay(null);
  },

  // --- красные флажки ---
  listTriggers: () => delay(db.triggers),
  async updateTrigger(id: ID, patch: Partial<Pick<IfrsTrigger, 'threshold' | 'enabled'>>, user: User) {
    ifrsAssertEditor(user);
    const t = db.triggers.find((x) => x.id === id);
    if (!t) throw apiError('NOT_FOUND');
    if (patch.threshold !== undefined && !(patch.threshold >= 0)) throw new Error('ifrs_err_amount');
    audit.log({ action: 'settings', entity: 'ifrs_trigger', entityId: id, changes: Object.entries(patch).map(([k, v]) => ({ field: k, from: String((t as unknown as Record<string, unknown>)[k]), to: String(v) })) });
    Object.assign(t, patch);
    emit();
    await delay(null);
  },
  redFlags: () => delay(evaluateFlags()),
  overdueHistory: () => delay(overdueHistory()),
  /** Проверка триггеров и рассылка «красных флажков» ответственным руководителям. */
  async checkFlags(user: User): Promise<{ flags: number; notified: number }> {
    const flags = evaluateFlags();
    let notified = 0;
    for (const f of flags) {
      const t = db.triggers.find((x) => x.id === f.triggerId)!;
      notified += notify({ roles: t.roles, title: L('Красный флажок по дочернему предприятию', "Sho'ba korxona bo'yicha qizil bayroq", 'Red flag at a subsidiary'), body: f.message, link: '/ifrs?tab=flags', level: f.severity === 'danger' ? 'danger' : 'warning', kind: 'system', dedupeKey: `ifrs-flag-${f.id}-${f.value}` }).length;
    }
    db.flagChecks.unshift({ at: now(), flags: flags.length, notified });
    audit.log({ action: 'view', entity: 'ifrs_red_flags', details: `${user.id}: flags ${flags.length}, notified ${notified}` });
    emit();
    return delay({ flags: flags.length, notified });
  },
  usdRate: IFRS_USD_RATE,
};

