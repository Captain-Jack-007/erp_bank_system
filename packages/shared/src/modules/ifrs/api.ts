// API модуля МСФО: трансформация ОСВ банка, корректировки, консолидация группы с элиминациями и НКД.
import { clone, delay, emit, nextId, nextNumber, now } from '../../bus';
import { localize, tk, translate } from '../../i18n';
import { matches, registerSearchProvider } from '../../search';
import { audit } from '../../audit';
import { can } from '../../security';
import type { ID, Role, User } from '../../types';
import { IFRS_PACKAGE_PERIOD, ifrsDividends, ifrsStatementFromPackage } from './subs';
import {
  IFRS_PERIOD,
  IFRS_USD_RATE,
  ifrsAdjustmentsSeed,
  ifrsCloseTasksSeed,
  ifrsEntitiesSeed,
  ifrsIntragroupSeed,
  ifrsStatementsSeed,
  ifrsTrialBalanceSeed,
} from './data';
import type {
  IfrsAdjustment,
  IfrsAdjustmentType,
  IfrsConsolidatedRow,
  IfrsConsolidation,
  IfrsEntity,
  IfrsLine,
  IfrsLineValues,
  IfrsNewAdjustmentInput,
  IfrsPlLine,
  IfrsSfpLine,
} from './types';
import { apiError } from '../../errors';

export const IFRS_ASSET_LINES: IfrsSfpLine[] = ['cash', 'due_banks', 'loans', 'investments', 'fixed_assets', 'other_assets', 'goodwill'];
export const IFRS_LIABILITY_LINES: IfrsSfpLine[] = ['deposits', 'borrowings', 'other_liabilities'];
export const IFRS_EQUITY_LINES: IfrsSfpLine[] = ['share_capital', 'retained'];
export const IFRS_INCOME_LINES: IfrsPlLine[] = ['interest_income', 'fee_income', 'other_income', 'share_associates'];
export const IFRS_EXPENSE_LINES: IfrsPlLine[] = ['interest_expense', 'opex', 'ecl_charge', 'tax'];
export const IFRS_PL_LINES: IfrsPlLine[] = ['interest_income', 'interest_expense', 'fee_income', 'other_income', 'opex', 'ecl_charge', 'share_associates', 'tax'];
export const IFRS_ALL_LINES: IfrsLine[] = [...IFRS_ASSET_LINES, ...IFRS_LIABILITY_LINES, ...IFRS_EQUITY_LINES, ...IFRS_PL_LINES];

/** Шаблоны проводок корректировок: всегда сбалансированы (актив = обязательства + капитал + прибыль). */
export const IFRS_ADJUSTMENT_TEMPLATES: Record<IfrsAdjustmentType, { line: IfrsLine; sign: 1 | -1 }[]> = {
  ecl: [{ line: 'loans', sign: -1 }, { line: 'ecl_charge', sign: 1 }],
  lease: [{ line: 'fixed_assets', sign: 1 }, { line: 'other_liabilities', sign: 1 }],
  deferred_tax: [{ line: 'other_assets', sign: 1 }, { line: 'tax', sign: -1 }],
  fair_value: [{ line: 'investments', sign: 1 }, { line: 'other_income', sign: 1 }],
  fixed_assets: [{ line: 'fixed_assets', sign: -1 }, { line: 'opex', sign: 1 }],
};

/** Кто может менять данные МСФО (сопоставление, корректировки, закрытие периода). Остальные — только просмотр. */
export const IFRS_EDIT_ROLES: Role[] = ['finance', 'accountant', 'admin'];
/** Право на изменение — по матрице прав (модуль ifrs, уровень «изменение»). */
export const ifrsCanEdit = (user: Pick<User, 'role'> | null | undefined): boolean => !!user && can(user as User, 'ifrs', 'edit');
function assertEditor(user: Pick<User, 'role'> | null | undefined) {
  if (!ifrsCanEdit(user)) throw new Error('ifrs_err_forbidden');
}

const db = {
  entities: clone(ifrsEntitiesSeed),
  trialBalance: clone(ifrsTrialBalanceSeed),
  statements: clone(ifrsStatementsSeed),
  intragroup: clone(ifrsIntragroupSeed),
  adjustments: clone(ifrsAdjustmentsSeed),
  closeTasks: clone(ifrsCloseTasksSeed),
};

const v = (vals: IfrsLineValues, line: IfrsLine) => vals[line] ?? 0;

export function ifrsProfit(vals: IfrsLineValues): number {
  return IFRS_INCOME_LINES.reduce((s, l) => s + v(vals, l), 0) - IFRS_EXPENSE_LINES.reduce((s, l) => s + v(vals, l), 0);
}

/** Входящие остатки на 01.01 (для отчёта о движении денежных средств): неденежные активы и обязательства — по
 *  данным начала года, денежные средства — остаток, балансирующий входящий баланс; без корректировок и прибыли года. */
const OPEN_ASSET = 0.9;
const OPEN_LIAB = 0.92;
const ASSET_LINES_NC: IfrsLine[] = ['due_banks', 'loans', 'investments', 'fixed_assets', 'other_assets'];
function openingOf(vals: IfrsLineValues): IfrsLineValues {
  const out: IfrsLineValues = {};
  for (const l of ASSET_LINES_NC) if (vals[l]) out[l] = Math.round(vals[l]! * OPEN_ASSET);
  for (const l of ['deposits', 'borrowings', 'other_liabilities'] as IfrsLine[]) if (vals[l]) out[l] = Math.round(vals[l]! * OPEN_LIAB);
  out.share_capital = vals.share_capital ?? 0;
  out.retained = vals.retained ?? 0;
  const nc = ASSET_LINES_NC.reduce((s, l) => s + (out[l] ?? 0), 0);
  out.cash = (out.deposits ?? 0) + (out.borrowings ?? 0) + (out.other_liabilities ?? 0) + out.share_capital + out.retained - nc;
  return out;
}

/** Отчётность дочерней в функциональной валюте: из принятого пакета за отчётный месяц, иначе — предварительные данные. */
function subStatement(entityId: ID): IfrsLineValues {
  return ifrsStatementFromPackage(entityId, IFRS_PACKAGE_PERIOD) ?? db.statements.find((s) => s.entityId === entityId)?.values ?? {};
}

/** Отчётность сущности в UZS после корректировок МСФО. Банк — из сопоставленных счетов ОСВ. */
function entityValues(entity: IfrsEntity, opening = false): IfrsLineValues {
  const out: IfrsLineValues = {};
  const add = (line: IfrsLine, amount: number) => {
    out[line] = (out[line] ?? 0) + amount;
  };
  const base: IfrsLineValues = {};
  if (entity.type === 'parent') {
    for (const row of db.trialBalance) if (row.ifrsLine) base[row.ifrsLine] = (base[row.ifrsLine] ?? 0) + row.balance;
  } else {
    const rate = entity.currency === 'USD' ? IFRS_USD_RATE : 1;
    for (const [line, amount] of Object.entries(subStatement(entity.id))) base[line as IfrsLine] = Math.round((amount ?? 0) * rate);
  }
  for (const [line, amount] of Object.entries(opening ? openingOf(base) : base)) add(line as IfrsLine, amount ?? 0);
  if (opening) return out;
  for (const adj of db.adjustments.filter((a) => a.entityId === entity.id)) for (const l of adj.lines) add(l.line, l.delta);
  // Объявленные внутригрупповые дивиденды отражены сторонами: банк — доход и дебиторская задолженность (своя доля),
  // дочерняя — уменьшение нераспределённой прибыли и задолженность перед участниками (PR-SUB-015).
  for (const d of ifrsDividends()) {
    const payer = db.entities.find((e) => e.id === d.entityId);
    if (!payer) continue;
    const amt = Math.round(d.amount * (payer.currency === 'USD' ? IFRS_USD_RATE : 1));
    if (entity.type === 'parent') {
      add('other_assets', Math.round((amt * payer.ownership) / 100));
      add('other_income', Math.round((amt * payer.ownership) / 100));
    } else if (entity.id === d.entityId) {
      add('other_liabilities', amt);
      add('retained', -amt);
    }
  }
  return out;
}

export function computeIfrsConsolidation(opts: { opening?: boolean } = {}): IfrsConsolidation {
  const opening = !!opts.opening;
  const consolidated = db.entities.filter((e) => e.method === 'parent' || e.method === 'full');
  const associates = db.entities.filter((e) => e.method === 'equity');
  const values = Object.fromEntries(consolidated.map((e) => [e.id, entityValues(e, opening)])) as Record<ID, IfrsLineValues>;
  const elim: Record<string, number> = {};
  const journal: NonNullable<IfrsConsolidation['journal']> = [];
  const addElim = (key: string, amount: number) => {
    elim[key] = (elim[key] ?? 0) + Math.round(amount);
  };
  const entry = (source: NonNullable<IfrsConsolidation['journal']>[number]['source'], ref: string, description: { ru: string; uz: string; en?: string }, lines: [IfrsLine, number][]) => {
    for (const [l, a] of lines) addElim(l, a);
    journal.push({ source, ref, description, lines: lines.filter(([, a]) => Math.round(a) !== 0).map(([line, amount]) => ({ line, amount: Math.round(amount) })) });
  };

  // 1. Внутригрупповые остатки и обороты
  for (const ig of db.intragroup) {
    const k = opening ? OPEN_ASSET : 1;
    entry('intragroup', ig.id, ig.description, [[ig.assetLine, -ig.amount * k], [ig.liabilityLine, -ig.amount * k], ...(opening ? [] : ([[ig.incomeLine, -ig.plAmount], [ig.expenseLine, -ig.plAmount]] as [IfrsLine, number][]))]);
  }
  // 1а. Внутригрупповые дивиденды: доход банка против нераспределённой прибыли, взаимная задолженность
  if (!opening) {
    for (const d of ifrsDividends()) {
      const payer = db.entities.find((e) => e.id === d.entityId);
      if (!payer || payer.method !== 'full') continue;
      const bankShare = Math.round((d.amount * (payer.currency === 'USD' ? IFRS_USD_RATE : 1) * payer.ownership) / 100);
      entry('dividend', d.id, { ru: `Дивиденды ${payer.shortName} банку`, uz: `${payer.shortName} dividendlari bankka`, en: `${payer.shortName} dividends to the bank` }, [['other_income', -bankShare], ['retained', bankShare], ['other_assets', -bankShare], ['other_liabilities', -bankShare]]);
    }
  }

  // 2. Инвестиции в дочерние: исключение против капитала, гудвил, доля неконтролирующих участников
  let nci = 0;
  let profitNci = 0;
  let goodwill = 0;
  for (const sub of consolidated.filter((e) => e.method === 'full')) {
    const vals = values[sub.id]!;
    const own = sub.ownership / 100;
    const sc = v(vals, 'share_capital');
    const re = v(vals, 'retained');
    const p = ifrsProfit(vals);
    const gw = Math.round(sub.investmentCost - own * sc);
    goodwill += gw;
    entry('investment', sub.id, { ru: `Исключение инвестиции в ${sub.shortName}, гудвил, доля НКД`, uz: `${sub.shortName} investitsiyasini chiqarish, gudvil, NNU ulushi`, en: `Elimination of investment in ${sub.shortName}, goodwill, NCI` }, [['investments', -sub.investmentCost], ['goodwill', gw], ['share_capital', -sc], ['retained', -(1 - own) * re]]);
    nci += Math.round((1 - own) * (sc + re + p));
    profitNci += Math.round((1 - own) * p);
  }

  // 3. Ассоциированные компании — метод долевого участия
  let associatesShare = 0;
  for (const a of associates) {
    const vals = subStatement(a.id);
    const own = a.ownership / 100;
    const share = opening ? 0 : Math.round(own * ifrsProfit(vals));
    associatesShare += share;
    entry('associate', a.id, { ru: `Метод долевого участия: ${a.shortName}`, uz: `Ulushli ishtirok usuli: ${a.shortName}`, en: `Equity method: ${a.shortName}` }, [['investments', own * v(vals, 'retained') + share], ['retained', own * v(vals, 'retained')], ['share_associates', share]]);
  }

  const sum = (line: IfrsLine) => consolidated.reduce((s, e) => s + v(values[e.id]!, line), 0);
  const cons = (line: IfrsLine) => sum(line) + (elim[line] ?? 0);
  const row = (line: IfrsLine): IfrsConsolidatedRow => ({
    line,
    byEntity: Object.fromEntries(consolidated.map((e) => [e.id, v(values[e.id]!, line)])),
    eliminations: elim[line] ?? 0,
    consolidated: cons(line),
    kind: 'line',
  });
  const subtotal = (line: IfrsConsolidatedRow['line'], perEntity: (vals: IfrsLineValues) => number, total: number, kind: 'subtotal' | 'total' = 'subtotal'): IfrsConsolidatedRow => {
    const byEntity = Object.fromEntries(consolidated.map((e) => [e.id, perEntity(values[e.id]!)]));
    const s = Object.values(byEntity).reduce((a, b) => a + b, 0);
    return { line, byEntity, eliminations: total - s, consolidated: total, kind };
  };

  const netProfit = IFRS_INCOME_LINES.reduce((s, l) => s + cons(l), 0) - IFRS_EXPENSE_LINES.reduce((s, l) => s + cons(l), 0);
  const profitOwners = netProfit - profitNci;
  const totalAssets = IFRS_ASSET_LINES.reduce((s, l) => s + cons(l), 0);
  const totalLiabilities = IFRS_LIABILITY_LINES.reduce((s, l) => s + cons(l), 0);
  const totalEquity = cons('share_capital') + cons('retained') + profitOwners + nci;
  const assetsOf = (vals: IfrsLineValues) => IFRS_ASSET_LINES.reduce((s, l) => s + v(vals, l), 0);
  const liabOf = (vals: IfrsLineValues) => IFRS_LIABILITY_LINES.reduce((s, l) => s + v(vals, l), 0);
  const equityOf = (vals: IfrsLineValues) => v(vals, 'share_capital') + v(vals, 'retained') + ifrsProfit(vals);

  const sfp: IfrsConsolidatedRow[] = [
    ...IFRS_ASSET_LINES.map(row),
    subtotal('total_assets', assetsOf, totalAssets, 'total'),
    ...IFRS_LIABILITY_LINES.map(row),
    subtotal('total_liabilities', liabOf, totalLiabilities),
    ...IFRS_EQUITY_LINES.map(row),
    subtotal('profit', ifrsProfit, profitOwners),
    subtotal('nci', () => 0, nci),
    subtotal('total_equity', equityOf, totalEquity),
    subtotal('total_equity_liabilities', (vals) => liabOf(vals) + equityOf(vals), totalLiabilities + totalEquity, 'total'),
  ];
  const pl: IfrsConsolidatedRow[] = [
    ...IFRS_PL_LINES.map(row),
    subtotal('net_profit', ifrsProfit, netProfit, 'total'),
    subtotal('profit_owners', ifrsProfit, profitOwners),
    subtotal('profit_nci', () => 0, profitNci),
  ];

  return {
    period: IFRS_PERIOD,
    entities: consolidated,
    sfp,
    pl,
    totalAssets,
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1_000_000,
    netProfit,
    profitOwners,
    profitNci,
    nci,
    goodwill,
    associatesShare,
    unmappedAccounts: db.trialBalance.filter((r) => !r.ifrsLine).length,
    journal,
    fromPackages: db.entities.filter((e) => e.type !== 'parent' && ifrsStatementFromPackage(e.id, IFRS_PACKAGE_PERIOD)).map((e) => e.id),
  };
}

/** Отчётность сущности (UZS, после корректировок) — для аналитики (KPI, ДДС). */
export function ifrsEntityValues(entityId: ID, opening = false): IfrsLineValues {
  const e = db.entities.find((x) => x.id === entityId);
  if (!e) return {};
  return e.method === 'equity' ? subStatement(e.id) : entityValues(e, opening);
}

export interface IfrsEntitySummary {
  entity: IfrsEntity;
  totalAssets: number;
  equity: number;
  profit: number;
  rate: number;
}

export const ifrsApi = {
  period: IFRS_PERIOD,
  usdRate: IFRS_USD_RATE,

  listEntities: () => delay(db.entities),

  /** Ключевые показатели каждой сущности группы (в UZS, после корректировок). */
  entitySummaries(): Promise<IfrsEntitySummary[]> {
    return delay(
      db.entities.map((entity) => {
        const vals = entity.method === 'equity' ? subStatement(entity.id) : entityValues(entity);
        return {
          entity,
          totalAssets: IFRS_ASSET_LINES.reduce((s, l) => s + v(vals, l), 0),
          equity: v(vals, 'share_capital') + v(vals, 'retained') + ifrsProfit(vals),
          profit: ifrsProfit(vals),
          rate: entity.currency === 'USD' ? IFRS_USD_RATE : 1,
        };
      }),
    );
  },

  getConsolidation: () => delay(computeIfrsConsolidation()),

  listTrialBalance: () => delay(db.trialBalance),

  async mapAccount(accountCode: string, line: IfrsLine | null, user: User) {
    assertEditor(user);
    if (line === 'goodwill' || line === 'share_associates' || (line !== null && !IFRS_ALL_LINES.includes(line))) throw apiError('INVALID_LINE');
    const row = db.trialBalance.find((r) => r.accountCode === accountCode);
    if (!row) throw apiError('ACCOUNT_NOT_FOUND');
    row.ifrsLine = line;
    emit();
    await delay(null);
  },

  listAdjustments: () => delay([...db.adjustments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),

  async addAdjustment(input: IfrsNewAdjustmentInput, user: User): Promise<IfrsAdjustment> {
    assertEditor(user);
    if (!(input.amount > 0)) throw apiError('AMOUNT_MUST_BE_POSITIVE');
    const entity = db.entities.find((e) => e.id === input.entityId);
    if (!entity || entity.method === 'equity') throw apiError('ENTITY_IS_NOT_CONSOLIDATED_LINE_BY_LINE');
    if (!input.description.trim()) throw apiError('DESCRIPTION_REQUIRED');
    const adj: IfrsAdjustment = {
      id: nextId('adj'),
      number: nextNumber('IFRS'),
      entityId: input.entityId,
      type: input.type,
      amount: Math.round(input.amount),
      description: input.description.trim(),
      createdBy: user.id,
      createdAt: now(),
      lines: IFRS_ADJUSTMENT_TEMPLATES[input.type].map((t) => ({ line: t.line, delta: t.sign * Math.round(input.amount) })),
    };
    db.adjustments.push(adj);
    emit();
    return delay(adj);
  },

  async removeAdjustment(id: ID, user: User) {
    assertEditor(user);
    db.adjustments = db.adjustments.filter((a) => a.id !== id);
    audit.log({ action: 'delete', entity: 'ifrs_adjustment', entityId: id });
    emit();
    await delay(null);
  },

  /** Автоматическая корректировка Adjustments Engine: заменяет предыдущую с тем же источником (PR-SUB-017…019). */
  async setAutoAdjustment(input: { entityId: ID; type: IfrsAdjustmentType; source: string; description: string; lines: { line: IfrsLine; delta: number }[] }, user: User): Promise<IfrsAdjustment> {
    assertEditor(user);
    const lines = input.lines.filter((l) => Math.round(l.delta) !== 0).map((l) => ({ line: l.line, delta: Math.round(l.delta) }));
    db.adjustments = db.adjustments.filter((a) => !(a.auto && a.source === input.source));
    const adj: IfrsAdjustment = {
      id: nextId('adj'), number: nextNumber('IFRS'), entityId: input.entityId, type: input.type, amount: Math.max(...lines.map((l) => Math.abs(l.delta)), 0),
      description: input.description, createdBy: user.id, createdAt: now(), lines, auto: true, source: input.source,
    };
    db.adjustments.push(adj);
    audit.log({ action: 'create', entity: 'ifrs_adjustment', entityId: adj.id, details: `auto ${input.type} ${input.source}` });
    emit();
    return delay(adj);
  },

  listIntragroup: () => delay(db.intragroup),

  /** Добавить внутригрупповую операцию в элиминации (из автовыявления по реестрам). */
  async addIntragroup(input: { assetEntityId: ID; liabilityEntityId: ID; amount: number; description: string; plAmount: number; assetLine?: IfrsSfpLine; liabilityLine?: IfrsSfpLine; incomeLine?: IfrsPlLine; expenseLine?: IfrsPlLine }, user: User) {
    assertEditor(user);
    if (!(input.amount > 0)) throw new Error('ifrs_err_amount');
    const ig = {
      id: nextId('ig'), description: { ru: input.description, uz: input.description, en: input.description }, assetEntityId: input.assetEntityId, assetLine: input.assetLine ?? 'other_assets', liabilityEntityId: input.liabilityEntityId,
      liabilityLine: input.liabilityLine ?? 'other_liabilities', amount: Math.round(input.amount), incomeLine: input.incomeLine ?? 'fee_income', expenseLine: input.expenseLine ?? 'opex', plAmount: Math.round(Math.max(0, input.plAmount)),
    };
    db.intragroup.push(ig);
    audit.log({ action: 'create', entity: 'ifrs_intragroup', entityId: ig.id, details: `${ig.assetEntityId}→${ig.liabilityEntityId}: ${ig.amount}` });
    emit();
    await delay(null);
  },

  listCloseTasks: () => delay(db.closeTasks),

  async toggleCloseTask(id: ID, user: User) {
    assertEditor(user);
    const t = db.closeTasks.find((x) => x.id === id);
    if (t) t.done = !t.done;
    emit();
    await delay(null);
  },
};

// Глобальный поиск: корректировки, компании группы и счета ОСВ → соответствующая вкладка экрана МСФО.
registerSearchProvider((q, lang) => [
  ...db.adjustments
    .filter((a) => matches(q, a.number, a.description))
    .map((a) => ({ group: 'ifrs_title', title: `${a.number} · ${a.description}`, subtitle: db.entities.find((e) => e.id === a.entityId)?.shortName ?? '', to: '/ifrs?tab=adjustments' })),
  ...db.entities
    .filter((e) => matches(q, e.name, e.shortName))
    .map((e) => ({ group: 'ifrs_title', title: e.name, subtitle: `${e.ownership}% · ${localize(e.activity, lang)}`, to: '/ifrs?tab=structure' })),
  ...db.trialBalance
    .filter((r) => matches(q, r.accountCode, r.name.ru, r.name.uz))
    .map((r) => ({ group: 'ifrs_title', title: `${r.accountCode} · ${localize(r.name, lang)}`, subtitle: r.ifrsLine ? translate(lang, tk('ifrs_line_', r.ifrsLine)) : translate(lang, 'ifrs_unmapped'), to: '/ifrs?tab=mapping' })),
]);
