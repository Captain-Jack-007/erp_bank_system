// МСФО: сбор данных дочерних предприятий (API/ETL из SAP, Oracle, 1С; веб-формы с подписью; импорт Excel),
// планы счетов дочерних и матрица трансформации НСБУ → МСФО, синхронизация НСИ, внутригрупповые дивиденды
// и автовыявление внутригрупповых операций (ТЗ 4.2.18, блоки А–В).
import { clone, delay, emit, nextId, now } from '../../bus';
import { audit } from '../../audit';
import { notify } from '../../notifications';
import { can } from '../../security';
import { INTEGRATION_SYSTEMS, integrationHub } from '../../services/integrations';
import { importRegistry } from '../../services/importer';
import type { ID, Localized, User } from '../../types';
import { IFRS_PERIOD, ifrsEntitiesSeed, ifrsIntragroupSeed, ifrsStatementsSeed } from './data';
import type {
  IfrsArApRow, IfrsConnector, IfrsDividend, IfrsGroupClassItem, IfrsIntragroupCandidate, IfrsLine, IfrsLineValues, IfrsLocalAccount, IfrsMappingRule, IfrsNsbuClass,
  IfrsNsiItem, IfrsNsiKind, IfrsPackageRow, IfrsPackageView, IfrsPortfolioRow, IfrsSubPackage, IfrsValidationIssue,
} from './types';
import { apiError } from '../../errors';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const B = 1_000_000_000;

/** Месяц консолидации (отчётная дата 30.09.2026). */
export const IFRS_PACKAGE_PERIOD = IFRS_PERIOD.slice(0, 7);
export const IFRS_ENTITY_TIN: Record<ID, string> = { e0: '200000001', e1: '301000101', e2: '301000202', e3: '301000303', e4: '301000404', e5: '301000505' };
export const IFRS_CONNECTORS: Record<ID, IfrsConnector> = { e1: '1c', e2: 'sap', e3: 'oracle', e4: 'web', e5: 'excel' };

// ---------- План счетов дочерних (НСБУ) и разбиение строк МСФО на счета ----------
type Acc = [code: string, ru: string, uz: string, en: string, share: number];
const LINE_ACCOUNTS: Partial<Record<IfrsLine, Acc[]>> = {
  cash: [['5010', 'Касса', 'Kassa', 'Cash on hand', 0.15], ['5110', 'Расчётный счёт', 'Hisob-kitob hisobvarag‘i', 'Settlement account', 0.85]],
  due_banks: [['5530', 'Депозиты в банках', 'Banklardagi depozitlar', 'Deposits with banks', 1]],
  loans: [['4810', 'Займы и лизинг выданные (краткосрочные)', 'Berilgan qarzlar va lizing (qisqa muddatli)', 'Loans and leases granted (short-term)', 0.65], ['0910', 'Долгосрочная дебиторская задолженность по займам/лизингу', 'Qarz/lizing bo‘yicha uzoq muddatli debitorlik', 'Long-term loan/lease receivables', 0.35]],
  investments: [['0610', 'Долгосрочные ценные бумаги', 'Uzoq muddatli qimmatli qog‘ozlar', 'Long-term securities', 0.6], ['5810', 'Краткосрочные инвестиции', 'Qisqa muddatli investitsiyalar', 'Short-term investments', 0.4]],
  fixed_assets: [['0120', 'Здания и сооружения (остаточная)', 'Binolar va inshootlar (qoldiq)', 'Buildings (net)', 0.55], ['0160', 'Оборудование и транспорт (остаточная)', 'Uskunalar va transport (qoldiq)', 'Equipment and vehicles (net)', 0.45]],
  other_assets: [['4010', 'Дебиторская задолженность покупателей', 'Xaridorlar debitorlik qarzi', 'Trade receivables', 0.6], ['4310', 'Авансы выданные', 'Berilgan avanslar', 'Advances paid', 0.4]],
  borrowings: [['6810', 'Краткосрочные кредиты банков', 'Banklarning qisqa muddatli kreditlari', 'Short-term bank loans', 0.45], ['7810', 'Долгосрочные кредиты банков', 'Banklarning uzoq muddatli kreditlari', 'Long-term bank loans', 0.55]],
  other_liabilities: [['6010', 'Кредиторская задолженность поставщикам', 'Yetkazib beruvchilarga kreditorlik qarzi', 'Trade payables', 0.5], ['6410', 'Задолженность по платежам в бюджет', 'Byudjetga to‘lovlar bo‘yicha qarz', 'Taxes payable', 0.2], ['6990', 'Прочие обязательства', 'Boshqa majburiyatlar', 'Other liabilities', 0.3]],
  share_capital: [['8330', 'Уставный капитал', 'Ustav kapitali', 'Charter capital', 1]],
  retained: [['8710', 'Нераспределённая прибыль прошлых лет', 'O‘tgan yillar taqsimlanmagan foydasi', 'Retained earnings (prior years)', 1]],
  interest_income: [['9510', 'Процентные доходы', 'Foiz daromadlari', 'Interest income', 1]],
  interest_expense: [['9610', 'Расходы по процентам', 'Foiz xarajatlari', 'Interest expense', 1]],
  fee_income: [['9010', 'Доход от реализации услуг', 'Xizmatlarni sotishdan daromad', 'Revenue from services', 1]],
  other_income: [['9390', 'Прочие операционные доходы', 'Boshqa operatsion daromadlar', 'Other operating income', 1]],
  opex: [['9410', 'Расходы по реализации', 'Sotish xarajatlari', 'Selling expenses', 0.2], ['9420', 'Административные расходы', 'Ma’muriy xarajatlar', 'Administrative expenses', 0.6], ['9430', 'Прочие операционные расходы', 'Boshqa operatsion xarajatlar', 'Other operating expenses', 0.2]],
  ecl_charge: [['9440', 'Резерв по сомнительным долгам', 'Shubhali qarzlar bo‘yicha zaxira', 'Doubtful debt provision', 1]],
  tax: [['9810', 'Расходы по налогу на прибыль', 'Foyda solig‘i xarajatlari', 'Income tax expense', 1]],
};
const CLASS_OF: Record<IfrsLine, IfrsNsbuClass> = {
  cash: 'asset', due_banks: 'asset', loans: 'asset', investments: 'asset', fixed_assets: 'asset', other_assets: 'asset', goodwill: 'asset',
  deposits: 'liability', borrowings: 'liability', other_liabilities: 'liability', share_capital: 'equity', retained: 'equity',
  interest_income: 'income', fee_income: 'income', other_income: 'income', share_associates: 'income', interest_expense: 'expense', opex: 'expense', ecl_charge: 'expense', tax: 'expense',
};

const accounts: IfrsLocalAccount[] = [];
for (const e of ifrsEntitiesSeed.filter((x) => x.type !== 'parent')) {
  for (const accs of Object.entries(LINE_ACCOUNTS)) {
    const [line, list] = accs as [IfrsLine, Acc[]];
    for (const [code, ru, uz, en] of list) accounts.push({ entityId: e.id, code, name: L(ru, uz, en), cls: CLASS_OF[line] });
  }
}
// Отраслевые счета: страховые резервы (SAP «XB Sug'urta»), прочие финансовые расходы (МФО).
accounts.push({ entityId: 'e2', code: '6970', name: L('Страховые резервы', 'Sug‘urta zaxiralari', 'Insurance reserves'), cls: 'liability' });
accounts.push({ entityId: 'e4', code: '9720', name: L('Прочие расходы от финансовой деятельности', 'Moliyaviy faoliyatdan boshqa xarajatlar', 'Other finance expenses'), cls: 'expense' });

/** Матрица правил: общие (*) и специфичные для предприятия; побеждает самый длинный подходящий шаблон. */
const rulesSeed: IfrsMappingRule[] = [
  ['50', 'cash'], ['51', 'cash'], ['55', 'due_banks'], ['48', 'loans'], ['09', 'loans'], ['06', 'investments'], ['58', 'investments'], ['01', 'fixed_assets'],
  ['40', 'other_assets'], ['43', 'other_assets'], ['68', 'borrowings'], ['78', 'borrowings'], ['60', 'other_liabilities'], ['64', 'other_liabilities'], ['69', 'other_liabilities'],
  ['83', 'share_capital'], ['87', 'retained'], ['95', 'interest_income'], ['96', 'interest_expense'], ['90', 'fee_income'], ['93', 'other_income'],
  ['94', 'opex'], ['944', 'ecl_charge'], ['98', 'tax'],
].map(([pattern, line], i) => ({ id: `mr${i + 1}`, entityId: '*' as const, pattern: pattern!, line: line as IfrsLine }));
rulesSeed.push({ id: 'mr-e2-1', entityId: 'e2', pattern: '697', line: 'other_liabilities', note: L('Страховые резервы → прочие обязательства', 'Sug‘urta zaxiralari → boshqa majburiyatlar', 'Insurance reserves → other liabilities') });
const rule9420 = rulesSeed.find((r) => r.pattern === '94')!;
rule9420.note = L('Счёт 9420 «Административные расходы» (1С) и прочие 94xx → OPEX', '9420 «Ma’muriy xarajatlar» (1C) va boshqa 94xx → OPEX', 'Account 9420 “Administrative expenses” (1C) and other 94xx → OPEX');

// ---------- Пакеты за отчётный месяц (повторяют утверждённую отчётность; без расхождений) ----------
function rowsFromValues(entityId: ID, values: IfrsLineValues, k = 1): IfrsPackageRow[] {
  const rows: IfrsPackageRow[] = [];
  for (const [line, amount] of Object.entries(values) as [IfrsLine, number][]) {
    const list = LINE_ACCOUNTS[line];
    if (!list || !amount) continue;
    const total = Math.round(amount * k);
    let left = total;
    list.forEach(([code, ru], i) => {
      const v = i === list.length - 1 ? left : Math.round(total * list[i]![4]);
      left -= v;
      rows.push({ account: code, name: ru, balance: v });
    });
  }
  // e2: часть прочих обязательств ведётся на счёте страховых резервов
  if (entityId === 'e2') {
    const r = rows.find((x) => x.account === '6990');
    if (r) {
      const part = Math.round(r.balance * 0.6);
      r.balance -= part;
      rows.push({ account: '6970', name: 'Страховые резервы', balance: part });
    }
  }
  return rows;
}

const ARAP: Record<ID, IfrsArApRow[]> = {
  e1: [
    { counterparty: 'АКБ «Народный банк»', tin: IFRS_ENTITY_TIN.e0!, kind: 'payable', amount: 600 * B, overdueDays: 0 },
    { counterparty: "AJ «XB Sug'urta»", tin: IFRS_ENTITY_TIN.e2!, kind: 'payable', amount: 6 * B, overdueDays: 0 },
    { counterparty: 'ООО «Демо Транс»', tin: '305111222', kind: 'receivable', amount: 31 * B, overdueDays: 45 },
    { counterparty: 'ООО «Демо Агро»', tin: '305222333', kind: 'receivable', amount: 17 * B, overdueDays: 10 },
  ],
  e2: [
    { counterparty: 'АКБ «Народный банк» (депозит)', tin: IFRS_ENTITY_TIN.e0!, kind: 'receivable', amount: 150 * B, overdueDays: 0 },
    { counterparty: 'OOO «XB Lizing»', tin: IFRS_ENTITY_TIN.e1!, kind: 'receivable', amount: 6 * B, overdueDays: 0 },
    { counterparty: 'Страхователи (физлица)', tin: '000000000', kind: 'receivable', amount: 12 * B, overdueDays: 35 },
  ],
  e3: [{ counterparty: 'Demo Fund LP', tin: '000000000', kind: 'payable', amount: 210_000, overdueDays: 0 }],
  e4: [
    { counterparty: 'АКБ «Народный банк»', tin: IFRS_ENTITY_TIN.e0!, kind: 'payable', amount: 200 * B, overdueDays: 0 },
    { counterparty: 'Заёмщики-физлица (просрочка)', tin: '000000000', kind: 'receivable', amount: 9 * B, overdueDays: 75 },
  ],
  e5: [],
};
const PORTFOLIO: Record<ID, IfrsPortfolioRow[]> = {
  e1: [{ kind: 'loans', amount: 1_900 * B, count: 412 }],
  e2: [{ kind: 'investments', amount: 380 * B, count: 18 }, { kind: 'deposits', amount: 210 * B, count: 4 }],
  e3: [{ kind: 'investments', amount: 3_550_000, count: 27 }],
  e4: [{ kind: 'loans', amount: 480 * B, count: 5_840 }],
  e5: [],
};

const ev = (at: string, userId: string, action: string, comment?: string) => ({ at, userId, action, ...(comment ? { comment } : {}) });
const packagesSeed: IfrsSubPackage[] = ifrsStatementsSeed.map((st, i) => {
  const e = ifrsEntitiesSeed.find((x) => x.id === st.entityId)!;
  const connector = IFRS_CONNECTORS[e.id]!;
  const source = connector === 'web' ? 'manual' : connector === 'excel' ? 'excel' : 'api';
  return {
    id: `pk${i + 1}`, entityId: e.id, period: IFRS_PACKAGE_PERIOD, source, connector, status: 'accepted', rows: rowsFromValues(e.id, st.values), arap: ARAP[e.id] ?? [], portfolio: PORTFOLIO[e.id] ?? [],
    submittedBy: source === 'api' ? 'system' : 'u9', submittedAt: '2026-10-06T10:00:00Z', acceptedBy: 'u7', acceptedAt: '2026-10-07T12:00:00Z', updatedAt: '2026-10-07T12:00:00Z',
    history: [ev('2026-10-06T10:00:00Z', source === 'api' ? 'system' : 'u9', source === 'api' ? 'fetched' : 'submitted'), ev('2026-10-07T12:00:00Z', 'u7', 'accepted')],
  };
});
// Октябрь: веб-форма МФО в работе (черновик с неразнесённым счётом 9720).
const e4Oct = rowsFromValues('e4', ifrsStatementsSeed.find((s) => s.entityId === 'e4')!.values, 1.04);
const e4Opex = e4Oct.find((r) => r.account === '9430')!;
e4Opex.balance -= 2 * B;
e4Oct.push({ account: '9720', name: 'Прочие расходы от финансовой деятельности', balance: 2 * B });
packagesSeed.push({ id: 'pk-e4-10', entityId: 'e4', period: '2026-10', source: 'manual', connector: 'web', status: 'draft', rows: e4Oct, arap: ARAP.e4!, portfolio: PORTFOLIO.e4!, updatedAt: '2026-10-16T09:00:00Z', history: [ev('2026-10-16T09:00:00Z', 'u9', 'created')] });

/** «Внешние системы» дочерних: данные, которые вернёт API/ETL за октябрь (рост к сентябрю). */
const EXTERNAL_GROWTH: Record<ID, number> = { e1: 1.03, e2: 1.02, e3: 1.01 };

// ---------- Единые классификаторы группы и НСИ дочерних ----------
const groupClassSeed: IfrsGroupClassItem[] = [
  ...ifrsEntitiesSeed.map((e) => ({ kind: 'counterparty' as const, code: `GC-${e.shortName.replace(/\W/g, '').toUpperCase().slice(0, 8)}`, name: L(e.name, e.name, e.name), tin: IFRS_ENTITY_TIN[e.id]! })),
  { kind: 'counterparty', code: 'GC-EXT', name: L('Внешние контрагенты', 'Tashqi kontragentlar', 'External counterparties') },
  { kind: 'expense', code: 'OPEX-STAFF', name: L('Расходы на персонал', 'Xodimlar xarajatlari', 'Staff costs'), keywords: ['зарплат', 'персонал', 'оплата труда', 'ish haqi', 'salary'] },
  { kind: 'expense', code: 'OPEX-RENT', name: L('Аренда и содержание', 'Ijara va saqlash', 'Rent and maintenance'), keywords: ['аренд', 'содержан', 'ijara', 'rent'] },
  { kind: 'expense', code: 'OPEX-IT', name: L('ИТ и связь', 'AT va aloqa', 'IT and telecom'), keywords: ['программ', 'связ', 'it', 'лиценз', 'software'] },
  { kind: 'expense', code: 'OPEX-MKT', name: L('Маркетинг и реклама', 'Marketing va reklama', 'Marketing'), keywords: ['реклам', 'маркет', 'reklama'] },
  { kind: 'expense', code: 'OPEX-ADM', name: L('Административные расходы', 'Ma’muriy xarajatlar', 'Administrative'), keywords: ['канц', 'командир', 'админ', 'офис'] },
  { kind: 'asset', code: 'FA-BLD', name: L('Здания и сооружения', 'Binolar va inshootlar', 'Buildings'), keywords: ['здан', 'офис', 'помещ', 'bino'] },
  { kind: 'asset', code: 'FA-EQP', name: L('Оборудование', 'Uskunalar', 'Equipment'), keywords: ['оборуд', 'сервер', 'компьют', 'uskuna'] },
  { kind: 'asset', code: 'FA-VEH', name: L('Транспорт', 'Transport', 'Vehicles'), keywords: ['авто', 'машин', 'транспорт', 'avto'] },
  { kind: 'asset', code: 'FA-INT', name: L('Нематериальные активы', 'Nomoddiy aktivlar', 'Intangibles'), keywords: ['лиценз', 'нма', 'програм'] },
];
const N = (id: string, entityId: ID, kind: IfrsNsiKind, localCode: string, localName: string, tin?: string, groupCode?: string): IfrsNsiItem => ({ id, entityId, kind, localCode, localName, ...(tin ? { tin } : {}), ...(groupCode ? { groupCode, matchedBy: 'manual' as const } : {}) });
const nsiSeed: IfrsNsiItem[] = [
  N('n1', 'e1', 'counterparty', 'K-0001', 'Народный банк АКБ', IFRS_ENTITY_TIN.e0, 'GC-XB'),
  N('n2', 'e1', 'counterparty', 'K-0002', "XB Sug'urta AJ", IFRS_ENTITY_TIN.e2),
  N('n3', 'e1', 'counterparty', 'K-0103', 'Демо Транс ООО', '305111222'),
  N('n4', 'e1', 'expense', '9420-01', 'Оплата труда АУП'),
  N('n5', 'e1', 'expense', '9420-04', 'Аренда офиса'),
  N('n6', 'e1', 'expense', '9420-07', 'Лицензии на программы 1С'),
  N('n7', 'e2', 'counterparty', 'SAP-BP-100', 'XALQ BANKI', IFRS_ENTITY_TIN.e0),
  N('n8', 'e2', 'expense', 'SAP-CE-6100', 'Рекламные кампании'),
  N('n9', 'e2', 'asset', 'SAP-AC-2100', 'Серверное оборудование'),
  N('n10', 'e3', 'expense', 'ORA-5110', 'Salary and bonuses'),
  N('n11', 'e3', 'asset', 'ORA-1510', 'Office premises'),
  N('n12', 'e4', 'counterparty', 'MFO-01', 'Народный банк (кредитная линия)', IFRS_ENTITY_TIN.e0),
  N('n13', 'e4', 'asset', 'MFO-OS-3', 'Служебный автомобиль'),
];

const db = {
  accounts,
  rules: clone(rulesSeed),
  packages: clone(packagesSeed),
  groupClass: clone(groupClassSeed),
  nsi: clone(nsiSeed),
  dividends: [{ id: 'dv1', entityId: 'e2', amount: 40 * B, declaredAt: '2026-09-25', status: 'declared' }] as IfrsDividend[],
  intragroupAdded: [] as { key: string; id: ID }[],
};

export function ifrsAssertEditor(user: User | null | undefined) {
  if (!can(user, 'ifrs', 'edit')) throw new Error('ifrs_err_forbidden');
}

// ---------- Трансформация ----------
/** Правило для счёта: специфичные для предприятия приоритетнее, затем самый длинный префикс. */
export function ifrsRuleFor(entityId: ID, account: string): IfrsMappingRule | undefined {
  return db.rules
    .filter((r) => (r.entityId === entityId || r.entityId === '*') && account.startsWith(r.pattern))
    .sort((a, b) => (a.entityId === '*' ? 1 : 0) - (b.entityId === '*' ? 1 : 0) || b.pattern.length - a.pattern.length)[0];
}

export function ifrsTransform(pkg: Pick<IfrsSubPackage, 'entityId' | 'rows'>): { values: IfrsLineValues; unmapped: string[] } {
  const values: IfrsLineValues = {};
  const unmapped: string[] = [];
  for (const r of pkg.rows) {
    const rule = ifrsRuleFor(pkg.entityId, r.account);
    if (!rule) {
      unmapped.push(r.account);
      continue;
    }
    values[rule.line] = (values[rule.line] ?? 0) + r.balance;
  }
  return { values, unmapped };
}

const classOfAccount = (entityId: ID, code: string): IfrsNsbuClass | undefined => {
  const a = db.accounts.find((x) => x.entityId === entityId && x.code === code);
  if (a) return a.cls;
  const rule = ifrsRuleFor(entityId, code);
  return rule ? CLASS_OF[rule.line] : undefined;
};

/** Автоматическая валидация пакета (PR-SUB-007): баланс, сопоставление счетов, обязательные счета, знаки, сверка с реестром. */
export function ifrsValidatePackage(pkg: IfrsSubPackage): { issues: IfrsValidationIssue[]; totals: Record<IfrsNsbuClass, number> } {
  const issues: IfrsValidationIssue[] = [];
  const totals: Record<IfrsNsbuClass, number> = { asset: 0, liability: 0, equity: 0, income: 0, expense: 0 };
  if (!pkg.rows.length) issues.push({ code: 'empty', severity: 'error' });
  for (const r of pkg.rows) {
    const cls = classOfAccount(pkg.entityId, r.account);
    if (!ifrsRuleFor(pkg.entityId, r.account)) issues.push({ code: 'unmapped', severity: 'error', account: r.account });
    if (cls) totals[cls] += r.balance;
    if (cls === 'asset' && r.balance < 0) issues.push({ code: 'negative', severity: 'warning', account: r.account });
  }
  const diff = totals.asset - totals.liability - totals.equity - (totals.income - totals.expense);
  if (Math.abs(diff) > 1) issues.push({ code: 'balance', severity: 'error', detail: String(diff) });
  for (const req of ['8330']) if (!pkg.rows.some((r) => r.account.startsWith(req))) issues.push({ code: 'required', severity: 'error', account: req });
  const tbRec = pkg.rows.filter((r) => r.account === '4010').reduce((s, r) => s + r.balance, 0);
  const regRec = pkg.arap.filter((a) => a.kind === 'receivable' && !Object.values(IFRS_ENTITY_TIN).includes(a.tin)).reduce((s, a) => s + a.amount, 0);
  if (tbRec && regRec > tbRec) issues.push({ code: 'arap', severity: 'warning', detail: `${regRec} > ${tbRec}` });
  return { issues, totals };
}

function view(pkg: IfrsSubPackage): IfrsPackageView {
  const { issues, totals } = ifrsValidatePackage(pkg);
  return { ...pkg, issues, totals, mapped: ifrsTransform(pkg).values };
}

/** Отчётность сущности за отчётный месяц из принятого пакета (если есть). */
export function ifrsStatementFromPackage(entityId: ID, period = IFRS_PACKAGE_PERIOD): IfrsLineValues | undefined {
  const pkg = db.packages.find((p) => p.entityId === entityId && p.period === period && p.status === 'accepted');
  return pkg ? ifrsTransform(pkg).values : undefined;
}

/** Доля просроченной (> days дней) дебиторской задолженности в реестре ДЗ/КЗ принятого пакета, %; undefined — пакета нет. */
export function ifrsOverdueShare(entityId: ID, period = IFRS_PACKAGE_PERIOD, days = 30): number | undefined {
  const pkg = db.packages.find((p) => p.entityId === entityId && p.period === period && p.status === 'accepted');
  if (!pkg) return undefined;
  const rec = pkg.arap.filter((a) => a.kind === 'receivable');
  const total = rec.reduce((s, a) => s + a.amount, 0);
  const overdue = rec.filter((a) => a.overdueDays > days).reduce((s, a) => s + a.amount, 0);
  return total ? Math.round((overdue / total) * 1000) / 10 : 0;
}

export function ifrsDividends(): IfrsDividend[] {
  return db.dividends;
}

// ---------- Интеграция с учётными системами дочерних ----------
if (!INTEGRATION_SYSTEMS.some((s) => s.id === 'subsidiaries')) {
  INTEGRATION_SYSTEMS.push({
    id: 'subsidiaries', tz: '4.2.18', kind: 'external', hosts: 'SAP S/4HANA, Oracle EBS, 1С:Предприятие (дочерние)', modules: ['ifrs'], latency: [250, 800],
    name: L('Учётные системы дочерних (SAP, Oracle, 1С)', "Sho'ba korxonalar hisob tizimlari (SAP, Oracle, 1C)", 'Subsidiary accounting systems (SAP, Oracle, 1C)'),
    purpose: L('Ежемесячный пакет: ОСВ, баланс, дебиторка/кредиторка, портфели', "Oylik paket: AQV, balans, debitorlik/kreditorlik, portfellar", 'Monthly package: trial balance, balance sheet, AR/AP, portfolios'),
    passport: {
      source: 'SAP/Oracle/1С', target: 'XB-ERP', owner: L('Департамент МСФО и дочерних', "MHXS va sho'ba korxonalar departamenti", 'IFRS & Subsidiaries Department'), protocol: 'REST/JSON + ETL',
      format: 'JSON (OpenAPI v1) / XLSX-макет, UTF-8', endpoint: 'https://subs-gw.bank.local/api/v1/packages', auth: 'OAuth 2.0 client credentials, mTLS', schedule: L('Ежемесячно, до 5-го числа', 'Har oy, 5-sanagacha', 'Monthly, by the 5th'),
      volume: L('до 2 000 строк ОСВ на предприятие', 'korxonaga 2 000 tagacha AQV satri', 'up to 2,000 TB rows per entity'), sla: '99%, ≤ 10 s', idempotency: 'entity + period + version',
      errorCodes: 'timeout, http_500, http_503, validation, control_total_mismatch', controlTotals: L('Сумма дебетовых и кредитовых остатков ОСВ', 'AQV debet va kredit qoldiqlari summasi', 'Sum of TB debit and credit balances'),
    },
    operations: [{
      id: 'package.fetch', direction: 'in', schemaVersion: '1.0', name: L('Получить пакет отчётности за месяц', 'Oylik hisobot paketini olish', 'Fetch monthly reporting package'),
      sample: () => ({ entity: 'e1', connector: '1c', period: '2026-10' }),
      validate: (p) => (p.entity && p.period ? null : { code: 'validation', message: 'entity, period required' }),
      respond: (p) => ({ entity: p.entity, period: p.period, rows: Math.round(30 + Number(EXTERNAL_GROWTH[String(p.entity)] ?? 1) * 10), status: 'ready' }),
      count: () => 1,
    }],
  });
}

// ---------- Импорт Excel регламентированного макета (PR-SUB-007) ----------
importRegistry.register({
  id: 'ifrs_sub_tb',
  name: L('Пакет дочернего предприятия (макет Excel: ОСВ)', "Sho'ba korxona paketi (Excel maketi: AQV)", 'Subsidiary package (Excel template: trial balance)'),
  description: L('Колонки: предприятие (e1…e5 или краткое имя), период (ГГГГ-ММ), счёт НСБУ, наименование, сальдо. Проверяются предприятие, формат периода, сопоставление счёта с МСФО; пакет создаётся черновиком и проходит автовалидацию баланса.', "Ustunlar: korxona (e1…e5 yoki qisqa nom), davr (YYYY-MM), MBHS hisobvarag‘i, nomi, saldo. Korxona, davr formati, hisobvaraqning MHXS bilan moslashuvi tekshiriladi; paket qoralama sifatida yaratiladi va balans avtotekshiruvidan o‘tadi.", 'Columns: entity (e1…e5 or short name), period (YYYY-MM), NAS account, name, balance. Entity, period format and IFRS mapping are checked; the package is created as a draft and passes automatic balance validation.'),
  fields: [
    { key: 'entity', label: L('Предприятие', 'Korxona', 'Entity'), type: 'string', required: true, sample: 'e2', aliases: ['company', 'компания'] },
    { key: 'period', label: L('Период', 'Davr', 'Period'), type: 'string', required: true, pattern: '^\\d{4}-\\d{2}$', patternHint: 'YYYY-MM', sample: '2026-10' },
    { key: 'account', label: L('Счёт', 'Hisobvaraq', 'Account'), type: 'string', required: true, pattern: '^\\d{4}$', patternHint: '4 цифры / 4 raqam / 4 digits', sample: '5110' },
    { key: 'name', label: L('Наименование', 'Nomi', 'Name'), type: 'string', maxLength: 200, sample: 'Расчётный счёт' },
    { key: 'balance', label: L('Сальдо', 'Saldo', 'Balance'), type: 'number', required: true, sample: '25500000000' },
  ],
  async extraValidate(rows) {
    return rows.map((r) => {
      const ent = ifrsEntitiesSeed.find((e) => e.id === r.entity || e.shortName.toLowerCase() === String(r.entity).toLowerCase());
      const out: { field: string; code: 'reference' | 'rule'; value: string; severity: 'error' | 'warning'; detail?: string }[] = [];
      if (!ent || ent.type === 'parent') out.push({ field: 'entity', code: 'reference', value: String(r.entity), severity: 'error' });
      else if (!ifrsRuleFor(ent.id, String(r.account))) out.push({ field: 'account', code: 'rule', value: String(r.account), severity: 'warning', detail: 'no IFRS mapping rule' });
      return out;
    });
  },
  async commit(rows, user, _mode, ctx) {
    const groups = new Map<string, IfrsPackageRow[]>();
    for (const r of rows) {
      const ent = ifrsEntitiesSeed.find((e) => e.id === r.entity || e.shortName.toLowerCase() === String(r.entity).toLowerCase())!;
      const k = `${ent.id}|${r.period}`;
      groups.set(k, [...(groups.get(k) ?? []), { account: String(r.account), name: String(r.name ?? ''), balance: Math.round(Number(r.balance)) }]);
    }
    let created = 0;
    let updated = 0;
    for (const [k, list] of groups) {
      const [entityId, period] = k.split('|') as [ID, string];
      const ex = db.packages.find((p) => p.entityId === entityId && p.period === period);
      if (ex && (ex.status === 'submitted' || ex.status === 'accepted')) continue;
      if (ex) {
        ex.rows = list;
        ex.source = 'excel';
        ex.updatedAt = now();
        ex.history.push({ at: now(), userId: user.id, action: 'imported', comment: ctx.fileName });
        updated++;
      } else {
        db.packages.push({ id: nextId('pk'), entityId, period, source: 'excel', connector: 'excel', status: 'draft', rows: list, arap: [], portfolio: [], updatedAt: now(), history: [{ at: now(), userId: user.id, action: 'imported', comment: ctx.fileName }] });
        created++;
      }
    }
    emit();
    return { created, updated, skipped: 0 };
  },
});

// ---------- Публичный API ----------
const findPkg = (id: ID) => {
  const p = db.packages.find((x) => x.id === id);
  if (!p) throw apiError('PACKAGE_NOT_FOUND');
  return p;
};

export const ifrsSubsApi = {
  connectors: IFRS_CONNECTORS,
  tins: IFRS_ENTITY_TIN,

  listPackages: (filter: { entityId?: ID; period?: string } = {}) =>
    delay(db.packages.filter((p) => (!filter.entityId || p.entityId === filter.entityId) && (!filter.period || p.period === filter.period)).map(view).sort((a, b) => b.period.localeCompare(a.period) || a.entityId.localeCompare(b.entityId))),
  getPackage: (id: ID) => delay(db.packages.find((p) => p.id === id) ? view(findPkg(id)) : undefined),

  /** Автоматическое получение пакета из SAP / Oracle / 1С через интеграционную шину (PR-SUB-001…003). */
  async fetchPackage(entityId: ID, period: string, user: User): Promise<IfrsPackageView> {
    ifrsAssertEditor(user);
    const connector = IFRS_CONNECTORS[entityId];
    if (!connector || connector === 'web' || connector === 'excel') throw new Error('ifrs_err_no_api');
    const ex = db.packages.find((p) => p.entityId === entityId && p.period === period);
    if (ex && ex.status === 'accepted') throw new Error('ifrs_err_pkg_accepted');
    const r = await integrationHub.call('subsidiaries', 'package.fetch', { entity: entityId, connector, period }, { userId: user.id, idempotencyKey: `subs-${entityId}-${period}-${Date.now()}` });
    if (r.status !== 'success') throw new Error('ifrs_err_fetch');
    const base = ifrsStatementsSeed.find((s) => s.entityId === entityId)!.values;
    const k = EXTERNAL_GROWTH[entityId] ?? 1;
    const rows = rowsFromValues(entityId, base, k);
    // Баланс внешнего пакета: рост капитала отражается в нераспределённой прибыли.
    const tmp: IfrsSubPackage = { id: 'tmp', entityId, period, source: 'api', connector, status: 'submitted', rows, arap: ARAP[entityId] ?? [], portfolio: PORTFOLIO[entityId] ?? [], updatedAt: now(), history: [] };
    const t = ifrsValidatePackage(tmp).totals;
    const diff = t.asset - t.liability - t.equity - (t.income - t.expense);
    const re = rows.find((x) => x.account === '8710');
    if (re) re.balance += diff;
    const pkg: IfrsSubPackage = ex ?? { id: nextId('pk'), entityId, period, source: 'api', connector, status: 'submitted', rows: [], arap: [], portfolio: [], updatedAt: now(), history: [] };
    Object.assign(pkg, { rows, arap: clone(ARAP[entityId] ?? []), portfolio: clone(PORTFOLIO[entityId] ?? []), status: 'submitted', source: 'api', exchangeId: r.id, submittedBy: 'system', submittedAt: now(), updatedAt: now() });
    pkg.history.push({ at: now(), userId: user.id, action: 'fetched', comment: `${connector.toUpperCase()} · ${r.id}` });
    if (!ex) db.packages.push(pkg);
    audit.log({ action: 'create', entity: 'ifrs_package', entityId: pkg.id, details: `${entityId} ${period} ← ${connector} (${r.id})` });
    emit();
    return delay(view(pkg));
  },

  /** Новый пакет веб-формы (ручной ввод) — счета плана счетов предприятия с нулевыми остатками. */
  async createManualPackage(entityId: ID, period: string, user: User): Promise<IfrsPackageView> {
    ifrsAssertEditor(user);
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('ifrs_err_period');
    if (db.packages.some((p) => p.entityId === entityId && p.period === period)) throw new Error('ifrs_err_pkg_exists');
    const rows = db.accounts.filter((a) => a.entityId === entityId).map((a) => ({ account: a.code, name: a.name.ru, balance: 0 }));
    const pkg: IfrsSubPackage = { id: nextId('pk'), entityId, period, source: 'manual', connector: 'web', status: 'draft', rows, arap: [], portfolio: [], updatedAt: now(), history: [{ at: now(), userId: user.id, action: 'created' }] };
    db.packages.push(pkg);
    emit();
    return delay(view(pkg));
  },

  async updatePackageRow(id: ID, account: string, balance: number, user: User) {
    ifrsAssertEditor(user);
    const pkg = findPkg(id);
    if (pkg.status !== 'draft' && pkg.status !== 'returned') throw new Error('ifrs_err_pkg_locked');
    if (!Number.isFinite(balance)) throw new Error('ifrs_err_amount');
    const row = pkg.rows.find((r) => r.account === account);
    if (row) row.balance = Math.round(balance);
    else pkg.rows.push({ account, name: db.accounts.find((a) => a.entityId === pkg.entityId && a.code === account)?.name.ru ?? account, balance: Math.round(balance) });
    pkg.updatedAt = now();
    emit();
    await delay(null);
  },

  /** Отправка пакета с подписью E-IMZO (PR-SUB-006): только без ошибок валидации. */
  async submitPackage(id: ID, signatureId: ID, user: User) {
    ifrsAssertEditor(user);
    const pkg = findPkg(id);
    if (pkg.status !== 'draft' && pkg.status !== 'returned') throw new Error('ifrs_err_pkg_locked');
    if (ifrsValidatePackage(pkg).issues.some((i) => i.severity === 'error')) throw new Error('ifrs_err_pkg_invalid');
    if (!signatureId) throw new Error('ifrs_err_sign');
    Object.assign(pkg, { status: 'submitted', signatureId, submittedBy: user.id, submittedAt: now(), updatedAt: now() });
    delete pkg.returnComment;
    pkg.history.push({ at: now(), userId: user.id, action: 'submitted', comment: 'E-IMZO' });
    audit.log({ action: 'submit', entity: 'ifrs_package', entityId: pkg.id, details: `${pkg.entityId} ${pkg.period}, подпись ${signatureId}` });
    notify({ roles: ['accountant', 'finance'], excludeIds: [user.id], title: L(`Пакет ${pkg.entityId} за ${pkg.period} отправлен`, `${pkg.entityId} paketi ${pkg.period} uchun yuborildi`, `Package ${pkg.entityId} for ${pkg.period} submitted`), link: '/ifrs?tab=packages', level: 'info', kind: 'task' });
    emit();
    await delay(null);
  },

  /** Приёмка пакета банком (другим сотрудником, не отправителем). Принятый пакет за отчётный месяц попадает в консолидацию. */
  async acceptPackage(id: ID, user: User) {
    ifrsAssertEditor(user);
    const pkg = findPkg(id);
    if (pkg.status !== 'submitted') throw new Error('ifrs_err_pkg_state');
    if (pkg.submittedBy === user.id) throw new Error('ifrs_err_sod');
    if (ifrsValidatePackage(pkg).issues.some((i) => i.severity === 'error')) throw new Error('ifrs_err_pkg_invalid');
    Object.assign(pkg, { status: 'accepted', acceptedBy: user.id, acceptedAt: now(), updatedAt: now() });
    pkg.history.push({ at: now(), userId: user.id, action: 'accepted' });
    audit.log({ action: 'approve', entity: 'ifrs_package', entityId: pkg.id, details: `${pkg.entityId} ${pkg.period}` });
    emit();
    await delay(null);
  },

  async returnPackage(id: ID, comment: string, user: User) {
    ifrsAssertEditor(user);
    const pkg = findPkg(id);
    if (pkg.status !== 'submitted') throw new Error('ifrs_err_pkg_state');
    if (!comment.trim()) throw new Error('ifrs_err_comment');
    Object.assign(pkg, { status: 'returned', returnComment: comment.trim(), updatedAt: now() });
    pkg.history.push({ at: now(), userId: user.id, action: 'returned', comment: comment.trim() });
    audit.log({ action: 'reject', entity: 'ifrs_package', entityId: pkg.id, details: comment.trim() });
    if (pkg.submittedBy && pkg.submittedBy !== 'system') notify({ userIds: [pkg.submittedBy], title: L(`Пакет ${pkg.entityId} за ${pkg.period} возвращён`, `${pkg.entityId} paketi qaytarildi`, `Package ${pkg.entityId} returned`), body: comment.trim(), link: '/ifrs?tab=packages', level: 'warning', kind: 'returned' });
    emit();
    await delay(null);
  },

  // --- план счетов и матрица ---
  listAccounts: (entityId?: ID) => delay(db.accounts.filter((a) => !entityId || a.entityId === entityId)),
  listRules: () => delay(db.rules),
  ruleFor: (entityId: ID, account: string) => ifrsRuleFor(entityId, account),
  async addRule(input: { entityId: ID | '*'; pattern: string; line: IfrsLine; note?: string }, user: User): Promise<IfrsMappingRule> {
    ifrsAssertEditor(user);
    if (!/^\d{1,4}$/.test(input.pattern)) throw new Error('ifrs_err_pattern');
    if (input.line === 'goodwill' || input.line === 'share_associates') throw apiError('INVALID_LINE');
    if (db.rules.some((r) => r.entityId === input.entityId && r.pattern === input.pattern)) throw new Error('ifrs_err_rule_exists');
    const rule: IfrsMappingRule = { id: nextId('mr'), entityId: input.entityId, pattern: input.pattern, line: input.line, ...(input.note ? { note: L(input.note, input.note, input.note) } : {}), createdBy: user.id };
    db.rules.push(rule);
    audit.log({ action: 'create', entity: 'ifrs_mapping_rule', entityId: rule.id, details: `${rule.entityId}: ${rule.pattern}* → ${rule.line}` });
    emit();
    return delay(rule);
  },
  async removeRule(id: ID, user: User) {
    ifrsAssertEditor(user);
    db.rules = db.rules.filter((r) => r.id !== id);
    audit.log({ action: 'delete', entity: 'ifrs_mapping_rule', entityId: id });
    emit();
    await delay(null);
  },

  // --- НСИ ---
  listGroupClass: () => delay(db.groupClass),
  listNsi: (kind?: IfrsNsiKind) => delay(db.nsi.filter((n) => !kind || n.kind === kind)),
  /** Автосопоставление: контрагенты — по ИНН, статьи и активы — по ключевым словам. */
  async autoMatchNsi(user: User): Promise<number> {
    ifrsAssertEditor(user);
    let n = 0;
    for (const item of db.nsi.filter((x) => !x.groupCode)) {
      let hit: IfrsGroupClassItem | undefined;
      if (item.kind === 'counterparty') hit = db.groupClass.find((g) => g.kind === 'counterparty' && g.tin && g.tin === item.tin) ?? db.groupClass.find((g) => g.code === 'GC-EXT');
      else hit = db.groupClass.find((g) => g.kind === item.kind && g.keywords?.some((k) => item.localName.toLowerCase().includes(k)));
      if (hit) {
        item.groupCode = hit.code;
        item.matchedBy = 'auto';
        n++;
      }
    }
    audit.log({ action: 'update', entity: 'ifrs_nsi', details: `auto-match: ${n}` });
    emit();
    return delay(n);
  },
  async setNsi(id: ID, groupCode: string, user: User) {
    ifrsAssertEditor(user);
    const item = db.nsi.find((x) => x.id === id);
    if (!item) throw apiError('NOT_FOUND');
    item.groupCode = groupCode || undefined;
    item.matchedBy = 'manual';
    emit();
    await delay(null);
  },

  // --- дивиденды ---
  listDividends: () => delay(db.dividends),
  async addDividend(input: { entityId: ID; amount: number; declaredAt: string }, user: User): Promise<IfrsDividend> {
    ifrsAssertEditor(user);
    const e = ifrsEntitiesSeed.find((x) => x.id === input.entityId);
    if (!e || e.method !== 'full') throw new Error('ifrs_err_entity');
    if (!(input.amount > 0)) throw new Error('ifrs_err_amount');
    const d: IfrsDividend = { id: nextId('dv'), entityId: input.entityId, amount: Math.round(input.amount), declaredAt: input.declaredAt, status: 'declared' };
    db.dividends.push(d);
    audit.log({ action: 'create', entity: 'ifrs_dividend', entityId: d.id, details: `${d.entityId}: ${d.amount}` });
    emit();
    return delay(d);
  },
  async removeDividend(id: ID, user: User) {
    ifrsAssertEditor(user);
    db.dividends = db.dividends.filter((d) => d.id !== id);
    emit();
    await delay(null);
  },

  /** Автовыявление внутригрупповых остатков по реестрам дебиторки/кредиторки принятых пакетов (PR-SUB-013). */
  detectIntragroup(intragroup: { id: ID; assetEntityId: ID; liabilityEntityId: ID; amount: number }[]): Promise<IfrsIntragroupCandidate[]> {
    const byTin = Object.fromEntries(Object.entries(IFRS_ENTITY_TIN).map(([id, tin]) => [tin, id])) as Record<string, ID>;
    const out = new Map<string, IfrsIntragroupCandidate>();
    for (const pkg of db.packages.filter((p) => p.period === IFRS_PACKAGE_PERIOD && p.status === 'accepted')) {
      const rate = pkg.entityId === 'e3' ? 12_650 : 1;
      for (const a of pkg.arap) {
        const other = byTin[a.tin];
        if (!other || other === pkg.entityId) continue;
        const assetEntityId = a.kind === 'receivable' ? pkg.entityId : other;
        const liabilityEntityId = a.kind === 'receivable' ? other : pkg.entityId;
        const key = `${assetEntityId}>${liabilityEntityId}`;
        const c = out.get(key) ?? { key, assetEntityId, liabilityEntityId, assetAmount: 0, liabilityAmount: 0, difference: 0, description: a.counterparty, status: 'new' as const };
        if (a.kind === 'receivable') c.assetAmount += a.amount * rate;
        else c.liabilityAmount += a.amount * rate;
        out.set(key, c);
      }
    }
    // Банк не сдаёт пакет: его сторона — из реестра внутригрупповых операций банка (ОСВ).
    for (const c of out.values()) {
      if (c.assetEntityId === 'e0' && !c.assetAmount) c.assetAmount = intragroup.find((i) => i.assetEntityId === 'e0' && i.liabilityEntityId === c.liabilityEntityId)?.amount ?? 0;
      if (c.liabilityEntityId === 'e0' && !c.liabilityAmount) c.liabilityAmount = intragroup.find((i) => i.liabilityEntityId === 'e0' && i.assetEntityId === c.assetEntityId)?.amount ?? 0;
      c.difference = c.assetAmount - c.liabilityAmount;
      const existing = intragroup.find((i) => i.assetEntityId === c.assetEntityId && i.liabilityEntityId === c.liabilityEntityId);
      if (existing) {
        c.intragroupId = existing.id;
        c.status = Math.abs(existing.amount - Math.min(c.assetAmount, c.liabilityAmount)) < 1 && Math.abs(c.difference) < 1 ? 'matched' : 'mismatch';
      } else c.status = Math.abs(c.difference) < 1 ? 'new' : 'mismatch';
    }
    return delay([...out.values()]);
  },
};

export const IFRS_SEED_INTRAGROUP = ifrsIntragroupSeed;
