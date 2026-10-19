// API модуля «Бюджетирование и мониторинг» (ТЗ 4.2.13) — единый источник бюджетной правды банка.
//  • План / факт / прогноз по подразделениям, статьям и МВЗ (в т.ч. филиалы), мониторинг исполнения.
//  • Бюджетный контроль транзакций (закупки, платежи, командировки, заявки): checkLimit / reserve / consume —
//    триада «годовой и месячный лимит (ZBB) · кассовый план (ОДДС) · складские остатки», режимы hard/soft,
//    подтверждение руководителя (approvalEngine 'budget_overrun'), сигналы 70/80/90%.
//  • ZBB-пакеты (обоснование, цель, Impact of non-funding, уровни одобрения), скользящий прогноз на 12 месяцев,
//    сценарии, CAPEX/инвестпроекты (паспорт, этапы, Гант), закрытие месяца со снимком справочников.
//  • Статьи бюджета ядра (b1…, закупки/договоры) — представление строк модуля через budgetBridge.
import { clone, delay, emit, historyEvent, nextId, nextNumber, now } from '../../bus';
import { approvalEngine } from '../../engine';
import { localize, tk, translate } from '../../i18n';
import { matches, registerSearchProvider } from '../../search';
import { audit, diffFields } from '../../audit';
import { can } from '../../security';
import { directory } from '../../directory';
import { notify } from '../../notifications';
import { orgApi } from '../../org';
import { registerBudgetSource } from '../../budgetBridge';
import { warehouseApi } from '../warehouse';
import type { HistoryEvent, ID, Localized, User } from '../../types';
import { FL, finplanEnsureOp, integrationHub } from './integrationOps';
import {
  BUDGET_YEAR,
  CLOSED_MONTHS,
  CORE_LINE_MAP,
  USD_LINKED,
  buildCashPlan,
  budgetingArticles,
  budgetingCapex,
  budgetingChanges,
  budgetingGoals,
  budgetingLines,
  budgetingOverruns,
  budgetingProjects,
  budgetingRng,
  budgetingScenarios,
  budgetingSettings,
  budgetingTxns,
  budgetingZbb,
} from './data';
import type {
  BudgetingAlertLevel,
  BudgetingArticle,
  BudgetingBranchRow,
  BudgetingCapexInput,
  BudgetingCapexRequest,
  BudgetingCashPlanView,
  BudgetingChange,
  BudgetingChangeInput,
  BudgetingCheckInput,
  BudgetingCheckResult,
  BudgetingControlMode,
  BudgetingDepartmentView,
  BudgetingFilter,
  BudgetingForecastMethod,
  BudgetingLine,
  BudgetingLineView,
  BudgetingMilestone,
  BudgetingMonthPoint,
  BudgetingOverrun,
  BudgetingOverview,
  BudgetingProject,
  BudgetingProjectPassport,
  BudgetingRollingPoint,
  BudgetingRollingRow,
  BudgetingRollingRun,
  BudgetingScenario,
  BudgetingScenarioRow,
  BudgetingSettings,
  BudgetingSignal,
  BudgetingSnapshot,
  BudgetingSummary,
  BudgetingTxn,
  BudgetingZbbInput,
  BudgetingZbbPackage,
} from './types';
import { apiError } from '../../errors';

const db = {
  articles: clone(budgetingArticles),
  goals: clone(budgetingGoals),
  lines: clone(budgetingLines),
  changes: clone(budgetingChanges),
  txns: clone(budgetingTxns),
  overruns: clone(budgetingOverruns),
  settings: clone(budgetingSettings),
  cash: buildCashPlan(budgetingLines, budgetingArticles),
  scenarios: clone(budgetingScenarios),
  zbb: clone(budgetingZbb),
  capex: clone(budgetingCapex),
  projects: clone(budgetingProjects),
  signals: [] as BudgetingSignal[],
  snapshots: [] as BudgetingSnapshot[],
  rolling: [] as BudgetingRollingRun[],
  closed: CLOSED_MONTHS,
  ccByUnit: new Map<string, string>(),
};

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const roundM = (v: number) => Math.round(v / 1_000_000) * 1_000_000;
const ym = (year: number, m: number) => `${year}-${String(m + 1).padStart(2, '0')}`;

/** Порог допуска перерасхода прогноза над планом, после которого строка считается «перерасход». */
export const BUDGETING_OVERRUN_TOLERANCE = 0.02;
/** Порог исполнения годового плана, после которого включается предупреждение. */
export const BUDGETING_WARNING_PCT = 90;

/** Ошибка бюджетного контроля: code = blocked (hard-check) | confirmation_required (soft-check) | not_found. */
export class BudgetingControlError extends Error {
  constructor(public code: 'blocked' | 'confirmation_required' | 'not_found', public check?: BudgetingCheckResult) {
    super(code === 'blocked' ? 'budget_blocked' : code === 'confirmation_required' ? 'budget_confirmation_required' : 'budget_line_not_found');
  }
}

export function budgetingAlertLevel(s: Pick<BudgetingSummary, 'planYear' | 'forecastYear' | 'executionPct'>): BudgetingAlertLevel {
  if (s.forecastYear > s.planYear * (1 + BUDGETING_OVERRUN_TOLERANCE)) return 'overrun';
  if (s.forecastYear > s.planYear || s.executionPct >= BUDGETING_WARNING_PCT) return 'warning';
  return 'ok';
}

// ---------- Транзакции открытого периода: списания и резервы ----------

/** Резерв по документу на строке (резерв − высвобождение − списание по тому же документу, не меньше 0). */
function reservedFor(lineId: ID, ref: string, txns = db.txns): number {
  let r = 0;
  for (const t of txns) {
    if (t.lineId !== lineId || t.ref !== ref || t.month < db.closed) continue;
    if (t.kind === 'reserve') r += t.amount;
    else if (t.kind === 'release' || t.kind === 'consume') r -= t.amount;
  }
  return Math.max(0, r);
}

function openTxns(lineIds: Set<ID>, maxMonth = 11) {
  return db.txns.filter((t) => lineIds.has(t.lineId) && t.month >= db.closed && t.month <= maxMonth);
}

function consumedOpen(lineIds: Set<ID>, maxMonth = 11): number {
  return sum(openTxns(lineIds, maxMonth).filter((t) => t.kind === 'consume').map((t) => t.amount));
}

function reservedOpen(lineIds: Set<ID>, maxMonth = 11, excludeRef?: string): number {
  const refs = new Set(openTxns(lineIds, maxMonth).filter((t) => t.kind === 'reserve').map((t) => `${t.lineId}|${t.ref}`));
  let r = 0;
  for (const key of refs) {
    const [lineId, ref] = key.split('|') as [ID, string];
    if (ref === excludeRef) continue;
    r += reservedFor(lineId, ref, openTxns(lineIds, maxMonth));
  }
  return r;
}

/** Сводные показатели по набору строк. */
export function budgetingSummarize(lines: BudgetingLine[]): BudgetingSummary {
  const closed = db.closed;
  const planYear = sum(lines.map((l) => sum(l.plan)));
  const planYtd = sum(lines.map((l) => sum(l.plan.slice(0, closed))));
  const actualYtd = sum(lines.map((l) => sum(l.actual.slice(0, closed))));
  const forecastRest = sum(lines.map((l) => sum(l.forecast.slice(closed))));
  const ids = new Set(lines.map((l) => l.id));
  const consumed = consumedOpen(ids);
  const reserved = reservedOpen(ids);
  const forecastYear = actualYtd + Math.max(forecastRest, consumed + reserved);
  const executionPct = pct(actualYtd, planYear);
  return {
    planYear,
    planYtd,
    actualYtd,
    forecastYear,
    varianceYtd: actualYtd - planYtd,
    executionPct,
    ytdPct: pct(actualYtd, planYtd),
    alert: budgetingAlertLevel({ planYear, forecastYear, executionPct }),
    consumedOpen: consumed,
    reservedOpen: reserved,
    usagePct: pct(actualYtd + consumed + reserved, planYear),
  };
}

function articleOf(articleId: ID) {
  return db.articles.find((a) => a.id === articleId);
}
function articleGroup(articleId: ID) {
  return articleOf(articleId)?.group;
}

function filterLines(filter: BudgetingFilter = {}): BudgetingLine[] {
  return db.lines
    .filter((l) => !filter.departmentId || l.departmentId === filter.departmentId)
    .filter((l) => !filter.group || articleGroup(l.articleId) === filter.group)
    .filter((l) => !filter.orgUnitKey || l.orgUnitKey === filter.orgUnitKey);
}

/** Распределить сумму по оставшимся месяцам пропорционально весам (остаток — в последний месяц). */
function spread(amount: number, weights: number[]): number[] {
  const total = sum(weights) || weights.length;
  const parts = weights.map((w) => Math.floor((amount * (sum(weights) ? w : 1)) / total));
  parts[parts.length - 1]! += amount - sum(parts);
  return parts;
}

function remainingPlan(line: BudgetingLine): number {
  return sum(line.plan.slice(db.closed));
}

/** Строка подразделения по статье: сначала строка самого подразделения ГО, затем любая (сумма по филиалам). */
function findLine(departmentId: ID, articleId: ID) {
  return db.lines.find((l) => l.departmentId === departmentId && l.articleId === articleId && l.orgUnitKey === departmentId) ?? db.lines.find((l) => l.departmentId === departmentId && l.articleId === articleId);
}

function ensureLine(departmentId: ID, articleId: ID): BudgetingLine {
  let line = findLine(departmentId, articleId);
  if (!line) {
    line = { id: nextId('bl'), departmentId, articleId, orgUnitKey: departmentId, plan: Array(12).fill(0), actual: Array(12).fill(0), forecast: Array(12).fill(0) };
    db.lines.push(line);
  }
  return line;
}

/** Добавить сумму к плану строки в месяце (и к прогнозу — ожидаем освоение выделенных средств). */
function addPlan(line: BudgetingLine, month: number, amount: number) {
  line.plan[month]! += amount;
  if (month >= db.closed) line.forecast[month]! += amount;
}

/** Применить согласованное изменение к плану оставшихся месяцев года. */
function applyChange(change: BudgetingChange): void {
  const closed = db.closed;
  const rest = (arr: number[]) => arr.slice(closed);
  const to = ensureLine(change.departmentId, change.toArticleId);
  // Перенос: на статью-получатель уходит ровно столько, сколько удалось снять с источника
  // (остаток источника мог уменьшиться между подачей запроса и его согласованием).
  let amount = change.amount;
  if (change.type === 'transfer' && change.fromArticleId) {
    const from = findLine(change.departmentId, change.fromArticleId);
    amount = from ? Math.min(change.amount, remainingPlan(from)) : 0;
    if (from && amount > 0) {
      const cut = spread(amount, rest(from.plan));
      cut.forEach((v, i) => (from.plan[closed + i]! -= v));
    }
  }
  const weights = rest(to.plan).some((v) => v > 0) ? rest(to.plan) : rest(to.plan).map(() => 1);
  const add = spread(amount, weights);
  const isNew = sum(to.plan) === 0;
  add.forEach((v, i) => {
    to.plan[closed + i]! += v;
    if (isNew) to.forecast[closed + i]! += v; // новая строка: ожидаем освоение выделенной суммы
  });
  change.appliedAt = now();
}

const canEdit = (user: User) => can(user, 'budgeting', 'edit');
function assertEdit(user: User) {
  if (!canEdit(user)) throw apiError('FORBIDDEN');
}
const who = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });

// ---------- Согласования ----------

approvalEngine.register('budget_change', {
  onHistory(entityId: ID, event: HistoryEvent) {
    db.changes.find((c) => c.id === entityId)?.history.push(event);
  },
  onFinal(entityId: ID, approved: boolean) {
    const change = db.changes.find((c) => c.id === entityId);
    if (!change || (change.status !== 'pending' && change.status !== 'returned')) return;
    change.status = approved ? 'approved' : 'rejected';
    if (approved) applyChange(change);
  },
  onReturned(entityId: ID) {
    const change = db.changes.find((c) => c.id === entityId);
    if (change) change.status = 'returned';
  },
  onResubmitted(entityId: ID) {
    const change = db.changes.find((c) => c.id === entityId);
    if (change) change.status = 'pending';
  },
  getContext(entityId: ID) {
    const c = db.changes.find((x) => x.id === entityId);
    return c ? { departmentId: c.departmentId, subtype: c.type, articleGroup: articleGroup(c.toArticleId) } : undefined;
  },
});

// Демо-задачи согласования для запросов bc1, bc2 (этап 1 — руководитель подразделения).
approvalEngine.seed([
  {
    id: 'a_bg1', entity: 'budget_change', entityId: 'bc1', number: 'BC-2026-0011',
    title: 'Перенос: разработка ПО → ИТ-оборудование (ИТ)', amount: 9_000_000_000, requesterId: 'u1',
    assigneeRole: 'dept_head', step: 1, totalSteps: 2, createdAt: '2026-10-15T10:22:00Z', dueAt: '2026-10-19T18:00:00Z', status: 'pending',
  },
  {
    id: 'a_bg2', entity: 'budget_change', entityId: 'bc2', number: 'BC-2026-0012',
    title: 'Увеличение: маркетинг и реклама (Розничный бизнес)', amount: 12_500_000_000, requesterId: 'u2',
    assigneeRole: 'dept_head', step: 1, totalSteps: 2, createdAt: '2026-10-16T08:06:00Z', dueAt: '2026-10-21T18:00:00Z', status: 'pending',
  },
  {
    id: 'a_bg_zp1', entity: 'budget_zbb', entityId: 'zp1', number: 'ZBB-2027-0004',
    title: 'ZBB-пакет ИТ на 2027 год', amount: 318_000_000_000, requesterId: 'u1',
    assigneeRole: 'dept_head', step: 1, totalSteps: 3, createdAt: '2026-10-10T09:05:00Z', dueAt: '2026-10-20T18:00:00Z', status: 'pending',
  },
  {
    id: 'a_bg_cx2', entity: 'capex_request', entityId: 'cx2', number: 'CX-2026-0014',
    title: 'Система хранения данных для резервного ЦОД', amount: 12_000_000_000, requesterId: 'u1',
    assigneeRole: 'dept_head', step: 1, totalSteps: 3, createdAt: '2026-10-13T09:02:00Z', dueAt: '2026-10-21T18:00:00Z', status: 'pending',
  },
  {
    id: 'a_bg_bo1', entity: 'budget_overrun', entityId: 'bo1', number: 'BO-2026-0003',
    title: 'Превышение лимита: маркетинг и реклама (Розничный бизнес)', amount: 4_800_000_000, requesterId: 'u21',
    assigneeRole: 'dept_head', step: 1, totalSteps: 3, createdAt: '2026-10-16T14:01:00Z', dueAt: '2026-10-17T14:01:00Z', status: 'pending',
  },
]);

function docHandlers<T extends { id: ID; status: string; history: HistoryEvent[] }>(list: () => T[], onApproved: (doc: T) => void) {
  return {
    onHistory(entityId: ID, event: HistoryEvent) {
      list().find((d) => d.id === entityId)?.history.push(event);
    },
    onFinal(entityId: ID, approved: boolean) {
      const d = list().find((x) => x.id === entityId);
      if (!d || (d.status !== 'pending' && d.status !== 'returned')) return;
      d.status = approved ? 'approved' : 'rejected';
      if (approved) onApproved(d);
      emit();
    },
    onReturned(entityId: ID) {
      const d = list().find((x) => x.id === entityId);
      if (d) d.status = 'returned';
    },
    onResubmitted(entityId: ID) {
      const d = list().find((x) => x.id === entityId);
      if (d) d.status = 'pending';
    },
  };
}

approvalEngine.register('budget_zbb', {
  ...docHandlers(() => db.zbb, (p) => notify({ userIds: [p.requesterId], title: FL(`ZBB-пакет ${p.number} утверждён`, `ZBB paketi ${p.number} tasdiqlandi`, `ZBB package ${p.number} approved`), link: `/budgeting/zbb/${p.id}`, level: 'success', kind: 'approved' })),
  getContext: (id) => {
    const p = db.zbb.find((x) => x.id === id);
    return p ? { departmentId: p.departmentId, amount: zbbTotal(p) } : undefined;
  },
});

approvalEngine.register('capex_request', {
  ...docHandlers(() => db.capex, (c) => applyCapex(c)),
  getContext: (id) => {
    const c = db.capex.find((x) => x.id === id);
    return c ? { departmentId: c.departmentId, subtype: c.kind, amount: c.amount } : undefined;
  },
});

approvalEngine.register('budget_overrun', {
  ...docHandlers(() => db.overruns, (o) =>
    notify({ userIds: [o.requesterId], title: FL(`Превышение лимита подтверждено: ${o.number}`, `Limitdan oshish tasdiqlandi: ${o.number}`, `Limit overrun confirmed: ${o.number}`), body: o.refLabel, link: `/budgeting/control/${o.id}`, level: 'success', kind: 'approved' }),
  ),
  getContext: (id) => {
    const o = db.overruns.find((x) => x.id === id);
    const line = o ? db.lines.find((l) => l.id === o.lineId) : undefined;
    return o && line ? { departmentId: line.departmentId, amount: o.amount, articleGroup: articleGroup(line.articleId) } : undefined;
  },
});

// ---------- Разрешение строки бюджета по статье и МВЗ ----------

const SEGMENT_DEPT: Record<string, ID> = { retail: 'd9', corporate: 'd10', sme: 'd10', treasury: 'd8', it: 'd1', support: 'd2' };

async function resolveArticle(input: BudgetingCheckInput): Promise<BudgetingArticle | undefined> {
  if (input.articleId) return articleOf(input.articleId);
  if (input.mdmCode) return db.articles.find((a) => a.mdmCode === input.mdmCode);
  if (input.budgetLineId && CORE_LINE_MAP[input.budgetLineId]) return articleOf(CORE_LINE_MAP[input.budgetLineId]!.articleId);
  return undefined;
}

/** Найти строку бюджета для статьи и МВЗ / оргединицы / подразделения. */
async function resolveLine(input: BudgetingCheckInput): Promise<{ line?: BudgetingLine; costCenterKey?: string }> {
  const art = await resolveArticle(input);
  if (!art) return {};
  if (input.budgetLineId && CORE_LINE_MAP[input.budgetLineId] && !input.costCenterKey) {
    return { line: findLine(CORE_LINE_MAP[input.budgetLineId]!.departmentId, art.id) };
  }
  let orgUnitKey = input.orgUnitKey;
  let segment: string | undefined;
  if (input.costCenterKey) {
    const cc = (await orgApi.getCostCenter(input.costCenterKey)).current;
    if (cc) {
      orgUnitKey = cc.orgUnitKey;
      segment = cc.segment;
    }
  }
  if (orgUnitKey) {
    const units = await orgApi.listOrgUnits();
    let key: string | null | undefined = orgUnitKey;
    for (let i = 0; key && i < 8; i++) {
      const k: string = key;
      const hit = db.lines.find((l) => l.articleId === art.id && l.orgUnitKey === k);
      if (hit) return { line: hit, ...(input.costCenterKey ? { costCenterKey: input.costCenterKey } : {}) };
      key = units.find((u) => u.key === k)?.parentKey;
    }
    // Филиальная сеть: статья, не ведущаяся по филиалу, — у бизнес-подразделения по сегменту МВЗ, затем у розничного бизнеса.
    const deps = [orgUnitKey.startsWith('d') ? orgUnitKey : undefined, segment ? SEGMENT_DEPT[segment] : undefined, input.departmentId, orgUnitKey.startsWith('R') ? 'd9' : undefined].filter(Boolean) as ID[];
    for (const dep of deps) {
      const line = findLine(dep, art.id);
      if (line) return { line, ...(input.costCenterKey ? { costCenterKey: input.costCenterKey } : {}) };
    }
    return {};
  }
  if (input.departmentId) return { line: findLine(input.departmentId, art.id) };
  return {};
}

const BUDGETING_STOCK_MIN_WORD = 4;

async function stockHits(items: { name: string; qty: number }[] | undefined) {
  if (!items?.length) return [];
  const all = await warehouseApi.listItems();
  const out: BudgetingCheckResult['stock'] = [];
  for (const it of items) {
    const words = it.name.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((w) => w.length >= BUDGETING_STOCK_MIN_WORD);
    for (const w of all) {
      if (w.qty <= 0 || out.some((o) => o.itemId === w.id)) continue;
      const n = w.name.toLowerCase();
      if (words.some((x) => n.includes(x.slice(0, Math.max(BUDGETING_STOCK_MIN_WORD, x.length - 2))))) {
        out.push({ itemId: w.id, sku: w.sku, name: w.name, qty: w.qty, unit: w.unit, warehouseId: w.warehouseId, requested: it.qty });
      }
    }
  }
  return out.slice(0, 6);
}

function cashRow(departmentId: ID) {
  return db.cash.find((c) => c.departmentId === departmentId);
}

function cashUsed(departmentId: ID, month: number, excludeRef?: string): number {
  const ids = new Set(db.lines.filter((l) => l.departmentId === departmentId).map((l) => l.id));
  const tx = db.txns.filter((t) => ids.has(t.lineId) && t.month === month && t.month >= db.closed);
  const consumed = sum(tx.filter((t) => t.kind === 'consume').map((t) => t.amount));
  const refs = new Set(tx.filter((t) => t.kind === 'reserve' && t.ref !== excludeRef).map((t) => `${t.lineId}|${t.ref}`));
  let reserved = 0;
  for (const key of refs) {
    const [lineId, ref] = key.split('|') as [ID, string];
    reserved += reservedFor(lineId, ref, tx);
  }
  return consumed + reserved;
}

/** Бюджетный контроль транзакции: триада лимит (год/месяц) · кассовый план · склад; режим hard/soft. */
async function check(input: BudgetingCheckInput): Promise<BudgetingCheckResult> {
  const { line, costCenterKey } = await resolveLine(input);
  const amount = Math.max(0, Math.round(input.amount));
  const month = Math.min(11, Math.max(db.closed, input.month ?? db.closed));
  const art = line ? articleOf(line.articleId) : await resolveArticle(input);
  const mode: BudgetingControlMode = art?.controlMode ?? 'soft';
  const messages: Localized[] = [];
  const stock = db.settings.checkStock ? await stockHits(input.items) : [];
  if (!line) {
    messages.push(FL('Строка бюджета для статьи и МВЗ не найдена — расход не запланирован', 'Modda va MXJ uchun byudjet satri topilmadi — xarajat rejalashtirilmagan', 'No budget line for this article and cost centre — the expense is not planned'));
    const zero = { limit: 0, used: 0, available: 0, ok: amount === 0 };
    return {
      ...(art ? { articleId: art.id } : {}), mode, status: 'exceeded', blocked: mode === 'hard', requiresConfirmation: mode === 'soft', overrunApproved: false,
      annual: zero, monthly: { ...zero, month }, cash: { ...zero, month, ok: true }, stock, usagePctBefore: 0, usagePctAfter: 0, thresholdsCrossed: [], messages,
    };
  }
  const ids = new Set([line.id]);
  const own = input.ref ? reservedFor(line.id, input.ref) : 0;
  const effective = Math.max(0, amount - own); // документ уже зарезервировал часть суммы
  const actualYtd = sum(line.actual.slice(0, db.closed));
  const planYear = sum(line.plan);
  const usedYear = actualYtd + consumedOpen(ids) + reservedOpen(ids, 11, input.ref);
  const annual = { limit: planYear, used: usedYear, available: planYear - usedYear, ok: effective <= planYear - usedYear };
  const limitMonth = sum(line.plan.slice(0, month + 1));
  const usedMonth = actualYtd + consumedOpen(ids, month) + reservedOpen(ids, month, input.ref);
  const monthly = { month, limit: limitMonth, used: usedMonth, available: limitMonth - usedMonth, ok: !db.settings.checkMonthly || effective <= limitMonth - usedMonth };
  const cr = cashRow(line.departmentId);
  const cashLimit = cr?.plan[month] ?? 0;
  const cashUse = cashUsed(line.departmentId, month, input.ref);
  const cash = { month, limit: cashLimit, used: cashUse, available: cashLimit - cashUse, ok: !db.settings.checkCash || effective <= cashLimit - cashUse };
  const before = pct(usedYear, planYear);
  const after = pct(usedYear + effective, planYear);
  const thresholdsCrossed = db.settings.thresholds.filter((t) => before < t && after >= t);
  const overrun = input.overrunId ? db.overruns.find((o) => o.id === input.overrunId && o.lineId === line.id && o.status === 'approved' && o.amount >= amount) : undefined;
  const exceeded = !annual.ok || !monthly.ok || !cash.ok;
  if (!annual.ok) messages.push(FL('Превышен годовой лимит статьи (ZBB)', 'Moddaning yillik limiti (ZBB) oshib ketdi', 'Annual article limit (ZBB) exceeded'));
  if (annual.ok && !monthly.ok) messages.push(FL('Превышен лимит нарастающим итогом на месяц', 'Oy uchun o‘sib boruvchi limit oshib ketdi', 'Cumulative monthly limit exceeded'));
  if (!cash.ok) messages.push(FL('Сумма не помещается в кассовый план (ОДДС) подразделения на месяц', 'Summa bo‘linmaning oylik kassa rejasiga (PHO) sig‘maydi', 'Amount exceeds the unit’s monthly cash-flow plan'));
  if (thresholdsCrossed.length) messages.push(FL(`Освоение лимита превысит ${thresholdsCrossed.join('/')}%`, `Limitdan foydalanish ${thresholdsCrossed.join('/')}% dan oshadi`, `Limit usage will pass ${thresholdsCrossed.join('/')}%`));
  if (stock.length) messages.push(FL('На складе есть подходящие ТМЦ — рассмотрите выдачу со склада до закупки', 'Omborda mos TMB mavjud — xariddan oldin ombordan berishni ko‘rib chiqing', 'Matching stock is available — consider a warehouse issue before purchasing'));
  if (exceeded && mode === 'hard') messages.push(FL('Hard-check: транзакция заблокирована', 'Hard-check: tranzaksiya bloklandi', 'Hard-check: transaction blocked'));
  if (exceeded && mode === 'soft' && !overrun) messages.push(FL('Soft-check: требуется электронное подтверждение ответственного руководителя', 'Soft-check: mas’ul rahbarning elektron tasdig‘i talab qilinadi', 'Soft-check: electronic confirmation of the responsible manager is required'));
  if (overrun) messages.push(FL(`Превышение подтверждено (${overrun.number})`, `Oshish tasdiqlangan (${overrun.number})`, `Overrun confirmed (${overrun.number})`));
  return {
    lineId: line.id,
    articleId: line.articleId,
    departmentId: line.departmentId,
    orgUnitKey: line.orgUnitKey,
    ...(costCenterKey ?? line.costCenterKey ? { costCenterKey: costCenterKey ?? line.costCenterKey } : {}),
    mode,
    status: exceeded ? 'exceeded' : thresholdsCrossed.length || stock.length ? 'warning' : 'ok',
    blocked: exceeded && mode === 'hard',
    requiresConfirmation: exceeded && mode === 'soft' && !overrun,
    overrunApproved: !!overrun,
    annual,
    monthly,
    cash,
    stock,
    usagePctBefore: before,
    usagePctAfter: after,
    thresholdsCrossed,
    messages,
  };
}

function lineLabel(line: BudgetingLine, lang: 'ru' | 'uz' | 'en' = 'ru') {
  const dep = directory.department(line.departmentId);
  return `${dep?.code ?? line.departmentId}${line.orgUnitKey !== line.departmentId ? `/${line.orgUnitKey}` : ''} · ${localize(articleOf(line.articleId)?.name, lang) ?? line.articleId}`;
}

function responsibleOf(line: BudgetingLine): ID[] {
  const heads = directory.users().filter((u) => u.role === 'dept_head' && u.departmentId === line.departmentId).map((u) => u.id);
  return [...new Set([...heads, ...directory.users().filter((u) => u.role === 'finance').map((u) => u.id)])];
}

/** Сигнальная система: уведомления ответственным при освоении 70/80/90% лимита (один раз на порог). */
function runSignals(lines: BudgetingLine[] = db.lines, silent = false): BudgetingSignal[] {
  const created: BudgetingSignal[] = [];
  for (const line of lines) {
    const s = budgetingSummarize([line]);
    for (const th of db.settings.thresholds) {
      if (s.usagePct < th || db.signals.some((x) => x.lineId === line.id && x.threshold === th)) continue;
      const recipients = responsibleOf(line);
      const sig: BudgetingSignal = { id: nextId('bs'), lineId: line.id, threshold: th, usagePct: s.usagePct, at: silent ? `2026-${String(db.closed).padStart(2, '0')}-30T18:00:00Z` : now(), recipients };
      db.signals.push(sig);
      created.push(sig);
      if (!silent) {
        notify({
          userIds: recipients,
          title: FL(`Освоено ${th}% лимита: ${lineLabel(line)}`, `Limitning ${th}% i o‘zlashtirildi: ${lineLabel(line, 'uz')}`, `${th}% of the limit used: ${lineLabel(line, 'en')}`),
          body: FL(`Освоение ${s.usagePct}% годового плана`, `Yillik rejaning ${s.usagePct}% i o‘zlashtirildi`, `${s.usagePct}% of the annual plan used`),
          link: '/budgeting?tab=control',
          level: th >= 90 ? 'danger' : 'warning',
          kind: 'system',
          dedupeKey: `bud-${line.id}-${th}`,
        });
      }
    }
  }
  return created;
}

// История сигналов на момент загрузки (пороги, пройденные в закрытых месяцах) — без повторной рассылки.
runSignals(db.lines, true);

function recordTxn(kind: BudgetingTxn['kind'], res: BudgetingCheckResult, input: BudgetingCheckInput & { ref: string; refLabel: string }, user: User, amount: number, note?: string): BudgetingTxn {
  const t: BudgetingTxn = {
    id: nextId('bt'), lineId: res.lineId!, month: res.monthly.month, kind, amount, source: input.source, ref: input.ref, refLabel: input.refLabel,
    userId: user.id, at: now(), mode: res.mode, ...(input.overrunId ? { overrunId: input.overrunId } : {}), ...(note ? { note } : {}),
  };
  db.txns.push(t);
  return t;
}

/** Hard-check: заблокировать транзакцию, записать сигнал (PR-BUD-009/014). */
async function block(res: BudgetingCheckResult, input: BudgetingCheckInput & { ref: string; refLabel: string }, user: User): Promise<never> {
  if (res.lineId) {
    recordTxn('blocked', res, input, user, Math.round(input.amount), res.messages.map((m) => m.ru).join('; '));
    const line = db.lines.find((l) => l.id === res.lineId)!;
    notify({
      userIds: [...new Set([user.id, ...responsibleOf(line)])],
      title: FL(`Hard-check: транзакция заблокирована — ${input.refLabel}`, `Hard-check: tranzaksiya bloklandi — ${input.refLabel}`, `Hard-check: transaction blocked — ${input.refLabel}`),
      body: FL(`${lineLabel(line)}: превышение лимита`, `${lineLabel(line, 'uz')}: limitdan oshish`, `${lineLabel(line, 'en')}: limit exceeded`),
      link: '/budgeting?tab=control',
      level: 'danger',
      kind: 'system',
    });
  }
  audit.log({ action: 'block', entity: 'budget_control', entityId: input.ref, entityLabel: input.refLabel, details: `${input.source} · ${Math.round(input.amount)} · ${res.messages.map((m) => m.ru).join('; ')}`, result: 'failure', user: who(user) });
  emit();
  throw new BudgetingControlError('blocked', res);
}

function zbbTotal(p: BudgetingZbbPackage) {
  return sum(p.items.map((i) => i.amount));
}

/** Согласованная заявка CAPEX: суммы графика 2026 г. добавляются в план статьи, инвестпроект — в реестр. */
function applyCapex(c: BudgetingCapexRequest) {
  const line = ensureLine(c.departmentId, c.articleId);
  for (const s of c.schedule) {
    const [y, m] = s.ym.split('-').map(Number) as [number, number];
    if (y === BUDGET_YEAR && m - 1 >= db.closed) addPlan(line, m - 1, s.amount);
  }
  if (c.kind === 'investment' && !c.projectId) {
    const first = c.schedule[0]?.ym ?? ym(BUDGET_YEAR, db.closed);
    const last = c.schedule[c.schedule.length - 1]?.ym ?? first;
    const p: BudgetingProject = {
      id: nextId('pj'), code: `INV-2026-${String(db.projects.length + 1).padStart(2, '0')}`, name: c.title, type: 'other', departmentId: c.departmentId, articleId: c.articleId, goalId: c.goalId,
      start: `${first}-01`, end: `${last}-28`, budget: c.amount, status: 'initiation', capexRequestId: c.id,
      passport: { goal: c.justification, scope: c.comments, kpi: '', fundingSource: 'CAPEX', risks: c.impact, sponsorId: 'u4', managerId: c.requesterId },
      milestones: c.schedule.map((s, i) => ({ id: nextId('ms'), name: `Этап ${i + 1}`, start: `${s.ym}-01`, end: `${s.ym}-28`, budget: s.amount, actual: 0, progressPct: 0, status: 'planned' as const })),
    };
    db.projects.push(p);
    c.projectId = p.id;
  }
  notify({ userIds: [c.requesterId], title: FL(`Заявка ${c.number} утверждена и включена в план`, `${c.number} arizasi tasdiqlandi va rejaga kiritildi`, `Request ${c.number} approved and added to the plan`), link: `/budgeting/capex/${c.id}`, level: 'success', kind: 'approved' });
}

// ---------- Скользящий прогноз ----------

function lineRatio(line: BudgetingLine, method: BudgetingForecastMethod): number {
  const closed = db.closed;
  const k = method === 'avg6' ? 6 : 3;
  if (method === 'trend') {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let m = 0; m < closed; m++) if (line.plan[m]) (xs.push(m), ys.push((line.actual[m] ?? 0) / line.plan[m]!));
    if (xs.length < 2) return 1;
    const mx = sum(xs) / xs.length;
    const my = sum(ys) / ys.length;
    const b = sum(xs.map((x, i) => (x - mx) * (ys[i]! - my))) / (sum(xs.map((x) => (x - mx) ** 2)) || 1);
    const at = my + b * (closed + 2 - mx); // середина горизонта ближайшего квартала
    return Math.max(0.5, Math.min(1.5, at));
  }
  const from = Math.max(0, closed - k);
  const p = sum(line.plan.slice(from, closed));
  return p ? sum(line.actual.slice(from, closed)) / p : 1;
}

/** Базовый план следующего года по строке: утверждённые ZBB-пакеты (по сезонности), иначе план 2026 + индексация 6%. */
function nextYearBase(line: BudgetingLine, m: number): number {
  const approved = db.zbb.filter((p) => p.status === 'approved' && p.year === BUDGET_YEAR + 1 && p.departmentId === line.departmentId);
  const zbbAmount = sum(approved.flatMap((p) => p.items.filter((i) => i.articleId === line.articleId).map((i) => i.amount)));
  const linesOfArticle = db.lines.filter((l) => l.departmentId === line.departmentId && l.articleId === line.articleId);
  const share = sum(line.plan) / (sum(linesOfArticle.map((l) => sum(l.plan))) || 1);
  const season = (line.plan[m] ?? 0) / (sum(line.plan) || 1);
  const capexNext = sum(
    db.capex
      .filter((c) => c.status === 'approved' && c.departmentId === line.departmentId && c.articleId === line.articleId)
      .flatMap((c) => c.schedule.filter((s) => s.ym === ym(BUDGET_YEAR + 1, m)).map((s) => s.amount)),
  ) * share;
  if (zbbAmount) return roundM(zbbAmount * share * (season || 1 / 12) + capexNext);
  return roundM((line.plan[m] ?? 0) * 1.06 + capexNext);
}

function rollingPoints(lines: BudgetingLine[], method: BudgetingForecastMethod): BudgetingRollingPoint[] {
  const out: BudgetingRollingPoint[] = [];
  for (let i = 0; i < 12; i++) {
    const absolute = db.closed + i;
    const year = BUDGET_YEAR + Math.floor(absolute / 12);
    const m = absolute % 12;
    let plan = 0;
    let fc = 0;
    for (const l of lines) {
      const r = lineRatio(l, method);
      const p = year === BUDGET_YEAR ? (l.plan[m] ?? 0) : nextYearBase(l, m);
      plan += p;
      fc += roundM(p * r);
    }
    out.push({ ym: ym(year, m), plan, forecast: fc });
  }
  return out;
}

function makeRollingRun(method: BudgetingForecastMethod, userId: ID | 'system', auto: boolean): BudgetingRollingRun {
  const horizon = rollingPoints(db.lines, method);
  // Автообновление прогноза строк на оставшиеся месяцы текущего года по факту.
  for (const l of db.lines) {
    const r = lineRatio(l, method);
    for (let m = db.closed; m < 12; m++) {
      const own = consumedOpen(new Set([l.id]), m) - consumedOpen(new Set([l.id]), m - 1);
      l.forecast[m] = Math.max(roundM((l.plan[m] ?? 0) * r), own);
    }
  }
  const run: BudgetingRollingRun = { id: nextId('rf'), at: now(), userId, basedOnMonths: db.closed, method, horizon, total: sum(horizon.map((h) => h.forecast)), auto };
  db.rolling.unshift(run);
  return run;
}

// ---------- Снимки закрытых месяцев ----------

function takeSnapshot(month: number, userId: ID | 'system', at: string): BudgetingSnapshot {
  const lines = db.lines.map((l) => ({
    id: l.id, departmentId: l.departmentId, articleId: l.articleId, orgUnitKey: l.orgUnitKey, ...(l.costCenterKey ? { costCenterKey: l.costCenterKey } : {}),
    planYear: sum(l.plan), planYtd: sum(l.plan.slice(0, month)), actualYtd: sum(l.actual.slice(0, month)),
    forecastYear: sum(l.actual.slice(0, month)) + sum((month >= db.closed ? l.forecast : l.plan).slice(month)),
  }));
  return {
    id: nextId('bsn'), period: ym(BUDGET_YEAR, month - 1), month, takenAt: at, takenBy: userId,
    articles: clone(db.articles), goals: clone(db.goals), settings: clone(db.settings), lines,
    totals: { planYear: sum(lines.map((l) => l.planYear)), actualYtd: sum(lines.map((l) => l.actualYtd)), forecastYear: sum(lines.map((l) => l.forecastYear)) },
  };
}

for (let m = 1; m <= db.closed; m++) db.snapshots.unshift(takeSnapshot(m, 'system', `${ym(BUDGET_YEAR, m - 1)}-${m === 2 ? '28' : '30'}T20:00:00Z`));

// Операция iABS: факт главной книги за месяц (для закрытия бюджетного месяца).
finplanEnsureOp('iabs', {
  id: 'gl.balances', direction: 'in', schemaVersion: '1.0', name: FL('Обороты главной книги по счетам расходов', 'Xarajat hisoblari bo‘yicha bosh kitob aylanmalari', 'General ledger expense turnovers'),
  sample: () => ({ period: '2026-09', accounts: ['5'] }), validate: (p) => (p.period ? null : { code: 'validation', message: 'Missing: period' }),
  amount: (p) => Number(p.controlSum ?? 0), count: (p) => Number(p.rows ?? 0),
  respond: (p) => ({ accepted: true, period: p.period, rows: p.rows ?? 0, controlSum: p.controlSum ?? 0 }),
}, 'budgeting');

// ---------- Мост «единого источника» для ядра ----------

registerBudgetSource({
  lines(seed) {
    return seed.map((b) => {
      const map = CORE_LINE_MAP[b.id];
      const line = map ? findLine(map.departmentId, map.articleId) : undefined;
      if (!line) return b;
      const s = budgetingSummarize([line]);
      return { ...b, planned: s.planYear, spent: s.actualYtd + s.consumedOpen };
    });
  },
  payment(e) {
    // Hard-check блокирует создание платёжного поручения (PR-BUD-014); soft — платёж по согласованному договору проходит.
    const map = CORE_LINE_MAP[e.budgetLineId];
    const line = map ? findLine(map.departmentId, map.articleId) : undefined;
    if (!line) return;
    const art = articleOf(line.articleId)!;
    const base = { id: nextId('bt'), lineId: line.id, month: db.closed, amount: e.amount, source: 'payment' as const, ref: e.ref, refLabel: e.refLabel, userId: e.user.id, at: now(), mode: art.controlMode };
    if (!e.force && paymentOverLimit(line, e.amount, e.ref) && art.controlMode === 'hard') {
      db.txns.push({ ...base, kind: 'blocked', note: 'Превышен годовой лимит статьи' });
      notify({
        userIds: [...new Set([e.user.id, ...responsibleOf(line)])],
        title: FL(`Hard-check: платёж заблокирован — ${e.refLabel}`, `Hard-check: to‘lov bloklandi — ${e.refLabel}`, `Hard-check: payment blocked — ${e.refLabel}`),
        body: FL(`${lineLabel(line)}: превышение лимита`, `${lineLabel(line, 'uz')}: limitdan oshish`, `${lineLabel(line, 'en')}: limit exceeded`),
        link: '/budgeting?tab=control', level: 'danger', kind: 'system',
      });
      audit.log({ action: 'block', entity: 'budget_control', entityId: e.ref, entityLabel: e.refLabel, details: `payment · ${e.amount} · hard-check`, result: 'failure', user: who(e.user) });
      emit();
      throw new BudgetingControlError('blocked');
    }
    db.txns.push({ ...base, kind: 'consume' });
    runSignals([line]);
  },
  // P3: предварительная проверка — платёжное поручение по статье с hard-check сверх лимита не создаётся.
  paymentBlocked(e) {
    const map = CORE_LINE_MAP[e.budgetLineId];
    const line = map ? findLine(map.departmentId, map.articleId) : undefined;
    if (!line) return false;
    return articleOf(line.articleId)!.controlMode === 'hard' && paymentOverLimit(line, e.amount, e.ref);
  },
  // P3: триада для заявки на закупку (ядро): режим статьи, кассовый план подразделения на месяц, складские остатки.
  async control(e) {
    if (!CORE_LINE_MAP[e.budgetLineId]) return null;
    const res = await check({ budgetLineId: e.budgetLineId, amount: e.amount, source: 'procurement', ...(e.month !== undefined ? { month: e.month } : {}), ...(e.items ? { items: e.items } : {}) });
    if (!res.lineId) return null;
    return { mode: res.mode, cashOk: res.cash.ok, cashAvailable: res.cash.available, cashMonth: res.cash.month, stock: res.stock.map((s) => ({ name: s.name, qty: s.qty, unit: s.unit })) };
  },
});

/** Превышение годового лимита строки платежом (с учётом резерва документа). */
function paymentOverLimit(line: BudgetingLine, amount: number, ref: string): boolean {
  const own = reservedFor(line.id, ref);
  const ids = new Set([line.id]);
  const used = sum(line.actual.slice(0, db.closed)) + consumedOpen(ids) + reservedOpen(ids, 11, ref);
  return Math.max(0, amount - own) > sum(line.plan) - used;
}

// ---------- Глобальный поиск ----------

registerSearchProvider((q, lang) => [
  ...db.changes
    .filter((c) => matches(q, c.number, c.reason, localize(db.articles.find((a) => a.id === c.toArticleId)?.name, lang)))
    .map((c) => ({
      group: 'budgeting_title',
      title: `${c.number} · ${translate(lang, tk('budgeting_type_', c.type))}: ${localize(db.articles.find((a) => a.id === c.toArticleId)?.name, lang) ?? ''}`,
      subtitle: translate(lang, tk('budgeting_status_', c.status)),
      to: `/budgeting/changes/${c.id}`,
    })),
  ...db.zbb.filter((p) => matches(q, p.number, p.title)).map((p) => ({ group: 'budgeting_title', title: `${p.number} · ${p.title}`, subtitle: 'ZBB', to: `/budgeting/zbb/${p.id}` })),
  ...db.capex.filter((c) => matches(q, c.number, c.title)).map((c) => ({ group: 'budgeting_title', title: `${c.number} · ${c.title}`, subtitle: 'CAPEX', to: `/budgeting/capex/${c.id}` })),
  ...db.projects.filter((p) => matches(q, p.code, p.name)).map((p) => ({ group: 'budgeting_title', title: `${p.code} · ${p.name}`, subtitle: 'INV', to: `/budgeting/projects/${p.id}` })),
  ...db.overruns.filter((o) => matches(q, o.number, o.refLabel)).map((o) => ({ group: 'budgeting_title', title: `${o.number} · ${o.refLabel}`, subtitle: 'soft-check', to: `/budgeting/control/${o.id}` })),
]);

// ---------- Публичный API ----------

function validateZbb(input: BudgetingZbbInput) {
  if (!input.title.trim() || !input.items.length) throw new Error('budgeting_err_zbb_empty');
  for (const it of input.items) {
    if (!articleOf(it.articleId) || !(it.amount > 0)) throw new Error('budgeting_err_zbb_item');
    if (it.justification.trim().length < 20) throw new Error('budgeting_err_zbb_justification');
    if (!db.goals.some((g) => g.id === it.goalId)) throw new Error('budgeting_err_zbb_goal');
    if (it.impact.trim().length < 10) throw new Error('budgeting_err_zbb_impact');
  }
}

function validateCapex(input: BudgetingCapexInput) {
  if (!input.title.trim() || !articleOf(input.articleId) || articleOf(input.articleId)!.group !== 'capex') throw new Error('budgeting_err_capex_article');
  if (!input.schedule.length || input.schedule.some((s) => !/^\d{4}-\d{2}$/.test(s.ym) || !(s.amount > 0))) throw new Error('budgeting_err_capex_schedule');
  if (input.schedule.some((s) => s.ym < ym(BUDGET_YEAR, db.closed))) throw new Error('budgeting_err_capex_past');
  if (input.justification.trim().length < 20 || !input.impact.trim() || !db.goals.some((g) => g.id === input.goalId)) throw new Error('budgeting_err_capex_justification');
}

export const budgetingApi = {
  year: BUDGET_YEAR,
  get closedMonths() {
    return db.closed;
  },

  listArticles: () => delay(db.articles),
  listGoals: () => delay(db.goals),

  getOverview(): Promise<BudgetingOverview> {
    const views = db.lines.map((l) => budgetingSummarize([l]));
    return delay({
      year: BUDGET_YEAR,
      closedMonths: db.closed,
      total: budgetingSummarize(db.lines),
      opex: budgetingSummarize(filterLines({ group: 'opex' })),
      capex: budgetingSummarize(filterLines({ group: 'capex' })),
      alerts: { warning: views.filter((v) => v.alert === 'warning').length, overrun: views.filter((v) => v.alert === 'overrun').length },
      pendingChanges: db.changes.filter((c) => c.status === 'pending').length,
      pendingOverruns: db.overruns.filter((o) => o.status === 'pending').length,
      blockedTxns: db.txns.filter((t) => t.kind === 'blocked').length,
    });
  },

  listLines(filter: BudgetingFilter = {}): Promise<BudgetingLineView[]> {
    const rank: Record<BudgetingAlertLevel, number> = { overrun: 0, warning: 1, ok: 2 };
    return delay(
      filterLines(filter)
        .map((l) => ({ ...l, ...budgetingSummarize([l]) }))
        .filter((v) => !filter.alertsOnly || v.alert !== 'ok')
        .sort((a, b) => rank[a.alert] - rank[b.alert] || b.planYear - a.planYear),
    );
  },

  listDepartments(filter: Omit<BudgetingFilter, 'departmentId'> = {}): Promise<BudgetingDepartmentView[]> {
    const deps = [...new Set(db.lines.map((l) => l.departmentId))];
    return delay(
      deps
        .map((d) => {
          const lines = filterLines({ ...filter, departmentId: d });
          return { departmentId: d, lines: lines.length, ...budgetingSummarize(lines) };
        })
        .filter((v) => v.lines > 0)
        .sort((a, b) => b.planYear - a.planYear),
    );
  },

  monthly(filter: BudgetingFilter = {}): Promise<BudgetingMonthPoint[]> {
    const lines = filterLines(filter);
    return delay(
      Array.from({ length: 12 }, (_, m) => ({
        month: m,
        plan: sum(lines.map((l) => l.plan[m] ?? 0)),
        actual: sum(lines.map((l) => l.actual[m] ?? 0)),
        forecast: sum(lines.map((l) => l.forecast[m] ?? 0)),
      })),
    );
  },

  /** Доступный для переноса остаток плана по статье подразделения (оставшиеся месяцы года). */
  availableToTransfer(departmentId: ID, articleId: ID): Promise<number> {
    const line = findLine(departmentId, articleId);
    return delay(line ? remainingPlan(line) : 0);
  },

  listChanges: () => delay([...db.changes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getChange: (id: ID) => delay(db.changes.find((c) => c.id === id)),

  async requestChange(input: BudgetingChangeInput, user: User): Promise<BudgetingChange> {
    if (!(input.amount > 0)) throw apiError('AMOUNT_MUST_BE_POSITIVE');
    if (input.type === 'transfer') {
      if (!input.fromArticleId || input.fromArticleId === input.toArticleId) throw apiError('INVALID_TRANSFER');
      const from = findLine(input.departmentId, input.fromArticleId);
      if (!from || remainingPlan(from) < input.amount) throw apiError('INSUFFICIENT_BUDGET');
    }
    const change: BudgetingChange = {
      id: nextId('bc'),
      number: nextNumber('BC'),
      type: input.type,
      departmentId: input.departmentId,
      ...(input.type === 'transfer' && input.fromArticleId ? { fromArticleId: input.fromArticleId } : {}),
      toArticleId: input.toArticleId,
      amount: Math.round(input.amount),
      reason: input.reason,
      status: 'pending',
      requesterId: user.id,
      createdAt: now(),
      history: [historyEvent(user.id, 'created'), historyEvent(user.id, 'submitted')],
    };
    db.changes.push(change);
    const art = db.articles.find((a) => a.id === input.toArticleId);
    approvalEngine.open({
      entity: 'budget_change',
      entityId: change.id,
      number: change.number,
      title: `${input.type === 'transfer' ? 'Перенос' : 'Увеличение'}: ${art?.name.ru ?? ''}`,
      requesterId: user.id,
      amount: change.amount,
      context: { departmentId: input.departmentId, subtype: input.type, articleGroup: art?.group },
    });
    audit.log({ action: 'submit', entity: 'budget_change', entityId: change.id, entityLabel: change.number, details: `${input.type} · ${change.amount}`, user: who(user) });
    emit();
    return delay(change);
  },

  // ----- Бюджетный контроль -----

  /** Проверка лимита по статье и МВЗ без проведения транзакции (для форм закупок, платежей, командировок, заявок). */
  checkLimit: (input: BudgetingCheckInput) => check(input).then((r) => delay(r)),

  /**
   * Зарезервировать бюджет под документ (заявка на закупку/командировку/расход). Hard-check бросает BudgetingControlError('blocked'),
   * soft-check без согласованного превышения — BudgetingControlError('confirmation_required').
   */
  async reserve(input: BudgetingCheckInput & { ref: string; refLabel: string }, user: User): Promise<{ txn: BudgetingTxn; check: BudgetingCheckResult }> {
    const res = await check(input);
    if (!res.lineId) throw new BudgetingControlError('not_found', res);
    if (res.blocked) return block(res, input, user);
    if (res.requiresConfirmation) throw new BudgetingControlError('confirmation_required', res);
    const own = reservedFor(res.lineId, input.ref);
    const txn = recordTxn('reserve', res, input, user, Math.max(0, Math.round(input.amount) - own));
    if (input.overrunId) {
      const o = db.overruns.find((x) => x.id === input.overrunId);
      if (o) o.status = 'used';
    }
    runSignals(db.lines.filter((l) => l.id === res.lineId));
    audit.log({ action: 'create', entity: 'budget_control', entityId: input.ref, entityLabel: input.refLabel, details: `reserve · ${txn.amount} · ${res.mode}`, user: who(user) });
    emit();
    return delay({ txn, check: res });
  },

  /** Списать факт (оплата): резерв документа переходит в исполнение; превышение — по тем же правилам hard/soft. */
  async consume(input: BudgetingCheckInput & { ref: string; refLabel: string }, user: User): Promise<{ txn: BudgetingTxn; check: BudgetingCheckResult }> {
    const res = await check(input);
    if (!res.lineId) throw new BudgetingControlError('not_found', res);
    if (res.blocked) return block(res, input, user);
    if (res.requiresConfirmation) throw new BudgetingControlError('confirmation_required', res);
    const txn = recordTxn('consume', res, input, user, Math.round(input.amount));
    if (input.overrunId) {
      const o = db.overruns.find((x) => x.id === input.overrunId);
      if (o) o.status = 'used';
    }
    runSignals(db.lines.filter((l) => l.id === res.lineId));
    audit.log({ action: 'update', entity: 'budget_control', entityId: input.ref, entityLabel: input.refLabel, details: `consume · ${txn.amount}`, user: who(user) });
    emit();
    return delay({ txn, check: res });
  },

  /** Высвободить резерв документа (отклонение/отмена заявки). */
  async release(ref: string, user: User): Promise<number> {
    let total = 0;
    for (const lineId of new Set(db.txns.filter((t) => t.ref === ref).map((t) => t.lineId))) {
      const r = reservedFor(lineId, ref);
      if (r > 0) {
        const src = db.txns.find((t) => t.ref === ref && t.lineId === lineId)!;
        db.txns.push({ ...src, id: nextId('bt'), kind: 'release', amount: r, userId: user.id, at: now(), month: Math.max(src.month, db.closed) });
        total += r;
      }
    }
    if (total) {
      audit.log({ action: 'update', entity: 'budget_control', entityId: ref, details: `release · ${total}`, user: who(user) });
      emit();
    }
    return delay(total);
  },

  listTxns(filter: { lineId?: ID; kind?: BudgetingTxn['kind'] | ''; departmentId?: ID } = {}) {
    const lineIds = filter.departmentId ? new Set(db.lines.filter((l) => l.departmentId === filter.departmentId).map((l) => l.id)) : null;
    return delay(
      db.txns
        .filter((t) => (!filter.lineId || t.lineId === filter.lineId) && (!filter.kind || t.kind === filter.kind) && (!lineIds || lineIds.has(t.lineId)))
        .sort((a, b) => b.at.localeCompare(a.at)),
    );
  },

  /** Запрос подтверждения превышения (soft-check): электронное подтверждение руководителя по спец. маршруту. */
  async requestOverrun(input: BudgetingCheckInput & { ref: string; refLabel: string; reason: string; impact: string }, user: User): Promise<BudgetingOverrun> {
    if (input.reason.trim().length < 10 || input.impact.trim().length < 10) throw new Error('budgeting_err_overrun_reason');
    const res = await check(input);
    if (!res.lineId) throw new BudgetingControlError('not_found', res);
    if (res.mode === 'hard') throw new BudgetingControlError('blocked', res);
    if (res.status !== 'exceeded') throw new Error('budgeting_err_overrun_not_needed');
    const line = db.lines.find((l) => l.id === res.lineId)!;
    const excess = Math.max(0, Math.round(input.amount) - Math.min(res.annual.available, res.monthly.available, res.cash.available));
    const o: BudgetingOverrun = {
      id: nextId('bo'), number: nextNumber('BO'), lineId: line.id, amount: Math.round(input.amount), excess, source: input.source, ref: input.ref, refLabel: input.refLabel,
      reason: input.reason.trim(), impact: input.impact.trim(), status: 'pending', requesterId: user.id, createdAt: now(),
      history: [historyEvent(user.id, 'created'), historyEvent(user.id, 'submitted')],
    };
    db.overruns.push(o);
    approvalEngine.open({
      entity: 'budget_overrun', entityId: o.id, number: o.number, title: `Превышение лимита: ${lineLabel(line)}`, requesterId: user.id, amount: o.amount,
      context: { departmentId: line.departmentId, articleGroup: articleGroup(line.articleId), excess, source: input.source },
    });
    audit.log({ action: 'submit', entity: 'budget_overrun', entityId: o.id, entityLabel: o.number, details: `${input.refLabel} · ${o.amount} · excess ${excess}`, user: who(user) });
    emit();
    return delay(o);
  },

  listOverruns: () => delay([...db.overruns].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getOverrun: (id: ID) => delay(db.overruns.find((o) => o.id === id)),
  resubmitOverrun(id: ID, user: User) {
    approvalEngine.resubmit(id, user);
    emit();
    return delay(null);
  },

  getSettings: () => delay(db.settings),
  async updateSettings(patch: Partial<BudgetingSettings>, user: User): Promise<void> {
    assertEdit(user);
    const before = clone(db.settings);
    if (patch.thresholds) {
      const th = [...new Set(patch.thresholds.map((v) => Math.round(v)))].filter((v) => v > 0 && v < 100).sort((a, b) => a - b);
      if (!th.length) throw new Error('budgeting_err_thresholds');
      db.settings.thresholds = th;
    }
    for (const k of ['checkMonthly', 'checkCash', 'checkStock'] as const) if (patch[k] !== undefined) db.settings[k] = patch[k]!;
    const changes = diffFields(before as unknown as Record<string, unknown>, db.settings as unknown as Record<string, unknown>);
    if (changes.length) audit.log({ action: 'settings', entity: 'budget_settings', entityId: 'control', changes, user: who(user) });
    emit();
    await delay(null);
  },
  async setArticleMode(articleId: ID, mode: BudgetingControlMode, user: User): Promise<void> {
    assertEdit(user);
    const a = articleOf(articleId);
    if (!a) throw apiError('NOT_FOUND');
    if (a.controlMode !== mode) {
      audit.log({ action: 'settings', entity: 'budget_article', entityId: a.id, entityLabel: a.code, changes: [{ field: 'controlMode', from: a.controlMode, to: mode }], user: who(user) });
      a.controlMode = mode;
    }
    emit();
    await delay(null);
  },

  listSignals: () => delay([...db.signals].sort((a, b) => b.at.localeCompare(a.at))),
  /** Проверить пороги 70/80/90% по всем строкам и разослать недостающие сигналы. */
  async scanSignals(user: User): Promise<number> {
    assertEdit(user);
    const created = runSignals();
    emit();
    return delay(created.length);
  },

  cashPlan(): Promise<BudgetingCashPlanView[]> {
    return delay(
      db.cash.map((c) => {
        const used = c.plan.map((_, m) => (m >= db.closed ? cashUsed(c.departmentId, m) : 0));
        return { ...c, used, available: c.plan.map((p, m) => (m >= db.closed ? p - used[m]! : p - (c.paid[m] ?? 0))) };
      }),
    );
  },
  async updateCashPlan(departmentId: ID, month: number, amount: number, user: User): Promise<void> {
    assertEdit(user);
    const row = cashRow(departmentId);
    if (!row || month < db.closed || month > 11 || !(amount >= 0)) throw new Error('budgeting_err_cash');
    audit.log({ action: 'update', entity: 'budget_cash_plan', entityId: `${departmentId}:${month}`, changes: [{ field: `plan[${month}]`, from: String(row.plan[month]), to: String(Math.round(amount)) }], user: who(user) });
    row.plan[month] = Math.round(amount);
    emit();
    await delay(null);
  },

  // ----- Скользящий прогноз -----

  rolling(method: BudgetingForecastMethod = 'avg3'): Promise<{ horizon: BudgetingRollingPoint[]; departments: BudgetingRollingRow[] }> {
    const deps = [...new Set(db.lines.map((l) => l.departmentId))];
    return delay({
      horizon: rollingPoints(db.lines, method),
      departments: deps.map((d) => {
        const lines = db.lines.filter((l) => l.departmentId === d);
        const pts = rollingPoints(lines, method);
        return { departmentId: d, points: pts, ratio: Math.round((sum(pts.map((p) => p.forecast)) / (sum(pts.map((p) => p.plan)) || 1)) * 1000) / 1000 };
      }),
    });
  },
  listRollingRuns: () => delay(db.rolling),
  async runRolling(method: BudgetingForecastMethod, user: User): Promise<BudgetingRollingRun> {
    assertEdit(user);
    const r = makeRollingRun(method, user.id, false);
    audit.log({ action: 'update', entity: 'budget_forecast', entityId: r.id, details: `rolling 12m · ${method} · ${r.total}`, user: who(user) });
    emit();
    return delay(r);
  },

  // ----- Сценарии -----

  listScenarios: () => delay(db.scenarios),
  scenarioTable(year: number = BUDGET_YEAR): Promise<{ rows: BudgetingScenarioRow[]; totals: Record<ID, number> }> {
    const rows: BudgetingScenarioRow[] = db.articles.map((a) => {
      const lines = db.lines.filter((l) => l.articleId === a.id);
      const ytd = sum(lines.map((l) => sum(l.actual.slice(0, db.closed))));
      const rest = sum(lines.map((l) => sum(l.plan.slice(db.closed))));
      const full = sum(lines.map((l) => sum(l.plan)));
      const values: Record<ID, number> = {};
      for (const s of db.scenarios) {
        const p = (s.articlePct[a.id] ?? (a.group === 'opex' ? s.opexPct : s.capexPct)) / 100;
        const fx = (USD_LINKED[a.id] ?? 0) * (s.fxUsd / 12_650 - 1);
        const hc = a.id === 'ba1' ? s.headcountPct / 100 : 0;
        values[s.id] = year === BUDGET_YEAR ? roundM(ytd + rest * (1 + p + fx + hc)) : roundM(full * 1.06 * (1 + p + fx + hc));
      }
      return { articleId: a.id, group: a.group, base: year === BUDGET_YEAR ? ytd + rest : roundM(full * 1.06), values };
    }).filter((r) => r.base > 0);
    const totals: Record<ID, number> = {};
    for (const s of db.scenarios) totals[s.id] = sum(rows.map((r) => r.values[s.id] ?? 0));
    return delay({ rows, totals });
  },
  async saveScenario(input: Omit<BudgetingScenario, 'updatedAt' | 'updatedBy' | 'system' | 'id' | 'code'> & { id?: ID }, user: User): Promise<BudgetingScenario> {
    assertEdit(user);
    const bad = [input.opexPct, input.capexPct, input.headcountPct, ...Object.values(input.articlePct)].some((v) => !Number.isFinite(v) || v < -90 || v > 200);
    if (bad || !(input.fxUsd > 0) || !input.name.ru.trim()) throw new Error('budgeting_err_scenario');
    let s = input.id ? db.scenarios.find((x) => x.id === input.id) : undefined;
    if (s) {
      const before = clone(s);
      Object.assign(s, { name: input.name, opexPct: input.opexPct, capexPct: input.capexPct, articlePct: input.articlePct, fxUsd: input.fxUsd, headcountPct: input.headcountPct, updatedAt: now(), updatedBy: user.id });
      audit.log({ action: 'update', entity: 'budget_scenario', entityId: s.id, entityLabel: s.name.ru, changes: diffFields(before as unknown as Record<string, unknown>, s as unknown as Record<string, unknown>, ['opexPct', 'capexPct', 'fxUsd', 'headcountPct']), user: who(user) });
    } else {
      s = { ...input, id: nextId('sc'), code: `custom-${db.scenarios.length + 1}`, updatedAt: now(), updatedBy: user.id, system: false };
      db.scenarios.push(s);
      audit.log({ action: 'create', entity: 'budget_scenario', entityId: s.id, entityLabel: s.name.ru, user: who(user) });
    }
    emit();
    return delay(s);
  },
  async deleteScenario(id: ID, user: User): Promise<void> {
    assertEdit(user);
    const s = db.scenarios.find((x) => x.id === id);
    if (!s || s.system) throw new Error('budgeting_err_scenario_system');
    db.scenarios = db.scenarios.filter((x) => x.id !== id);
    audit.log({ action: 'delete', entity: 'budget_scenario', entityId: id, entityLabel: s.name.ru, user: who(user) });
    emit();
    await delay(null);
  },

  // ----- ZBB -----

  listZbb: () => delay([...db.zbb].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getZbb: (id: ID) => delay(db.zbb.find((p) => p.id === id)),
  zbbTotal,
  /** Утверждённый бюджет следующего года из ZBB-пакетов: по статьям. */
  plan2027(): Promise<{ articleId: ID; amount: number; packages: number }[]> {
    const items = db.zbb.filter((p) => p.status === 'approved').flatMap((p) => p.items);
    const arts = [...new Set(items.map((i) => i.articleId))];
    return delay(arts.map((a) => ({ articleId: a, amount: sum(items.filter((i) => i.articleId === a).map((i) => i.amount)), packages: db.zbb.filter((p) => p.status === 'approved' && p.items.some((i) => i.articleId === a)).length })));
  },
  async saveZbb(input: BudgetingZbbInput, submit: boolean, user: User): Promise<BudgetingZbbPackage> {
    if (!can(user, 'budgeting', 'view')) throw apiError('FORBIDDEN');
    if (submit) validateZbb(input);
    else if (!input.title.trim()) throw new Error('budgeting_err_zbb_empty');
    let p = input.id ? db.zbb.find((x) => x.id === input.id) : undefined;
    if (p && p.requesterId !== user.id && !can(user, 'budgeting', 'admin')) throw apiError('FORBIDDEN');
    if (p && !['draft', 'returned', 'rejected'].includes(p.status)) throw new Error('budgeting_err_not_editable');
    const items = input.items.map((i) => ({ ...i, id: nextId('zi'), amount: Math.round(i.amount) }));
    if (p) Object.assign(p, { title: input.title.trim(), departmentId: input.departmentId, items });
    else {
      p = { id: nextId('zp'), number: nextNumber('ZBB').replace('-2026-', '-2027-'), year: BUDGET_YEAR + 1, departmentId: input.departmentId, title: input.title.trim(), items, status: 'draft', requesterId: user.id, createdAt: now(), history: [historyEvent(user.id, 'created')] };
      db.zbb.push(p);
    }
    if (submit) {
      const prev = p.status;
      p.status = 'pending';
      if (prev === 'returned' || prev === 'rejected') approvalEngine.resubmit(p.id, user);
      else {
        p.history.push(historyEvent(user.id, 'submitted'));
        approvalEngine.open({ entity: 'budget_zbb', entityId: p.id, number: p.number, title: p.title, requesterId: user.id, amount: zbbTotal(p), context: { departmentId: p.departmentId } });
      }
    }
    audit.log({ action: submit ? 'submit' : 'update', entity: 'budget_zbb', entityId: p.id, entityLabel: p.number, details: `${p.items.length} · ${zbbTotal(p)}`, user: who(user) });
    emit();
    return delay(p);
  },

  // ----- CAPEX и инвестпроекты -----

  listCapex: () => delay([...db.capex].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getCapex: (id: ID) => delay(db.capex.find((c) => c.id === id)),
  /** План CAPEX/крупных закупок/инвестиций по месяцам на горизонте 2026–2027 (утверждённые и на согласовании). */
  capexPlan(): Promise<{ ym: string; approved: number; pending: number }[]> {
    const months = new Set(db.capex.flatMap((c) => c.schedule.map((s) => s.ym)));
    return delay(
      [...months].sort().map((m) => ({
        ym: m,
        approved: sum(db.capex.filter((c) => c.status === 'approved').flatMap((c) => c.schedule.filter((s) => s.ym === m).map((s) => s.amount))),
        pending: sum(db.capex.filter((c) => c.status === 'pending').flatMap((c) => c.schedule.filter((s) => s.ym === m).map((s) => s.amount))),
      })),
    );
  },
  async saveCapex(input: BudgetingCapexInput & { id?: ID }, submit: boolean, user: User): Promise<BudgetingCapexRequest> {
    if (!can(user, 'budgeting', 'view')) throw apiError('FORBIDDEN');
    if (submit) validateCapex(input);
    else if (!input.title.trim()) throw new Error('budgeting_err_capex_article');
    let c = input.id ? db.capex.find((x) => x.id === input.id) : undefined;
    if (c && c.requesterId !== user.id && !can(user, 'budgeting', 'admin')) throw apiError('FORBIDDEN');
    if (c && !['draft', 'returned', 'rejected'].includes(c.status)) throw new Error('budgeting_err_not_editable');
    const amount = sum(input.schedule.map((s) => Math.round(s.amount)));
    const fields = { kind: input.kind, departmentId: input.departmentId, articleId: input.articleId, title: input.title.trim(), schedule: input.schedule.map((s) => ({ ym: s.ym, amount: Math.round(s.amount) })), amount, justification: input.justification.trim(), comments: input.comments.trim(), goalId: input.goalId, impact: input.impact.trim() };
    if (c) Object.assign(c, fields);
    else {
      c = { id: nextId('cx'), number: nextNumber('CX'), ...fields, status: 'draft', requesterId: user.id, createdAt: now(), history: [historyEvent(user.id, 'created')] };
      db.capex.push(c);
    }
    if (submit) {
      const prev = c.status;
      c.status = 'pending';
      if (prev === 'returned' || prev === 'rejected') approvalEngine.resubmit(c.id, user);
      else {
        c.history.push(historyEvent(user.id, 'submitted'));
        approvalEngine.open({ entity: 'capex_request', entityId: c.id, number: c.number, title: c.title, requesterId: user.id, amount: c.amount, context: { departmentId: c.departmentId, subtype: c.kind } });
      }
    }
    audit.log({ action: submit ? 'submit' : 'update', entity: 'capex_request', entityId: c.id, entityLabel: c.number, details: `${c.kind} · ${c.amount}`, user: who(user) });
    emit();
    return delay(c);
  },

  listProjects: () => delay(db.projects),
  getProject: (id: ID) => delay(db.projects.find((p) => p.id === id)),
  async updatePassport(id: ID, patch: Partial<BudgetingProjectPassport> & { status?: BudgetingProject['status']; end?: string }, user: User): Promise<void> {
    const p = db.projects.find((x) => x.id === id);
    if (!p) throw apiError('NOT_FOUND');
    if (!canEdit(user) && p.passport.managerId !== user.id) throw apiError('FORBIDDEN');
    const before = { ...p.passport, status: p.status, end: p.end };
    const { status, end, ...pass } = patch;
    Object.assign(p.passport, pass);
    if (status) p.status = status;
    if (end) p.end = end;
    const changes = diffFields(before as unknown as Record<string, unknown>, { ...p.passport, status: p.status, end: p.end } as unknown as Record<string, unknown>);
    if (changes.length) audit.log({ action: 'update', entity: 'budget_project', entityId: p.id, entityLabel: p.code, changes, user: who(user) });
    emit();
    await delay(null);
  },
  async saveMilestone(projectId: ID, m: Omit<BudgetingMilestone, 'id' | 'actual'> & { id?: ID }, user: User): Promise<void> {
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) throw apiError('NOT_FOUND');
    if (!canEdit(user) && p.passport.managerId !== user.id) throw apiError('FORBIDDEN');
    if (!m.name.trim() || !(m.budget > 0) || m.end < m.start || m.progressPct < 0 || m.progressPct > 100) throw new Error('budgeting_err_milestone');
    const others = p.milestones.filter((x) => x.id !== m.id);
    if (sum(others.map((x) => x.budget)) + m.budget > p.budget) throw new Error('budgeting_err_milestone_budget');
    const ex = m.id ? p.milestones.find((x) => x.id === m.id) : undefined;
    if (ex) {
      const before = clone(ex);
      Object.assign(ex, { name: m.name.trim(), start: m.start, end: m.end, budget: Math.round(m.budget), progressPct: Math.round(m.progressPct), status: m.status });
      audit.log({ action: 'update', entity: 'budget_project', entityId: p.id, entityLabel: `${p.code} · ${ex.name}`, changes: diffFields(before as unknown as Record<string, unknown>, ex as unknown as Record<string, unknown>), user: who(user) });
    } else {
      p.milestones.push({ id: nextId('ms'), name: m.name.trim(), start: m.start, end: m.end, budget: Math.round(m.budget), actual: 0, progressPct: Math.round(m.progressPct), status: m.status });
      audit.log({ action: 'create', entity: 'budget_project', entityId: p.id, entityLabel: `${p.code} · ${m.name}`, user: who(user) });
    }
    p.milestones.sort((a, b) => a.start.localeCompare(b.start));
    emit();
    await delay(null);
  },
  /** Освоение по этапу проекта: проходит бюджетный контроль статьи проекта (hard/soft) и списывает факт. */
  async recordMilestoneSpend(projectId: ID, milestoneId: ID, amount: number, user: User): Promise<BudgetingCheckResult> {
    const p = db.projects.find((x) => x.id === projectId);
    const ms = p?.milestones.find((x) => x.id === milestoneId);
    if (!p || !ms) throw apiError('NOT_FOUND');
    if (!canEdit(user) && p.passport.managerId !== user.id) throw apiError('FORBIDDEN');
    if (!(amount > 0)) throw new Error('budgeting_err_amount');
    const { check: res } = await budgetingApi.consume({ departmentId: p.departmentId, articleId: p.articleId, amount, source: 'project', ref: `${p.id}:${ms.id}:${Date.now()}`, refLabel: `${p.code} · ${ms.name}` }, user);
    ms.actual += Math.round(amount);
    if (ms.status === 'planned') ms.status = 'in_progress';
    emit();
    return res;
  },

  // ----- МВЗ и филиалы -----

  /** МВЗ строк бюджета (по оргединице — МВЗ «аппарат» подразделения/филиала из справочника оргструктуры). */
  async ensureCostCenters(): Promise<void> {
    for (const key of new Set(db.lines.map((l) => l.orgUnitKey))) {
      if (db.ccByUnit.has(key)) continue;
      const page = await orgApi.listCostCenters({ orgUnitKey: key, status: 'active', pageSize: 1, sort: 'code' });
      if (page.rows[0]) db.ccByUnit.set(key, page.rows[0].key);
    }
    for (const l of db.lines) if (!l.costCenterKey && db.ccByUnit.has(l.orgUnitKey)) l.costCenterKey = db.ccByUnit.get(l.orgUnitKey)!;
  },
  async branches(): Promise<BudgetingBranchRow[]> {
    await budgetingApi.ensureCostCenters();
    const units = await orgApi.listOrgUnits();
    const counts = await orgApi.costCenterCounts();
    const groups = new Map<string, BudgetingLine[]>();
    for (const l of db.lines) {
      const key = l.orgUnitKey.startsWith('R') ? l.orgUnitKey : 'HO';
      groups.set(key, [...(groups.get(key) ?? []), l]);
    }
    const descendantsCount = (root: string) => {
      const keys = new Set([root]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const u of units) if (u.parentKey && keys.has(u.parentKey) && !keys.has(u.key)) (keys.add(u.key), (grew = true));
      }
      return sum([...keys].filter((k) => root !== 'HO' || !k.startsWith('R')).map((k) => counts[k] ?? 0));
    };
    return delay(
      [...groups.entries()]
        .map(([key, lines]) => {
          const s = budgetingSummarize(lines);
          const u = units.find((x) => x.key === key);
          return { key, name: u?.name ?? { ru: key, uz: key }, lines: lines.length, planYear: s.planYear, actualYtd: s.actualYtd, forecastYear: s.forecastYear, usagePct: s.usagePct, costCenters: descendantsCount(key) };
        })
        .sort((a, b) => (a.key === 'HO' ? -1 : b.key === 'HO' ? 1 : a.key.localeCompare(b.key))),
    );
  },

  // ----- Закрытие месяца и снимки -----

  listSnapshots: () => delay(db.snapshots),
  getSnapshot: (period: string) => delay(db.snapshots.find((s) => s.period === period)),
  /** Сравнение снимка закрытого месяца с текущим состоянием справочников и плана. */
  compareSnapshot(period: string) {
    const s = db.snapshots.find((x) => x.period === period);
    if (!s) return delay(undefined);
    const rows = s.lines.map((sl) => {
      const cur = db.lines.find((l) => l.id === sl.id);
      const curArt = cur ? articleOf(cur.articleId) : undefined;
      const snapArt = s.articles.find((a) => a.id === sl.articleId);
      return {
        id: sl.id, departmentId: sl.departmentId, articleId: sl.articleId, orgUnitKey: sl.orgUnitKey,
        snapPlan: sl.planYear, curPlan: cur ? sum(cur.plan) : 0, snapActual: sl.actualYtd,
        snapMode: snapArt?.controlMode, curMode: curArt?.controlMode, snapName: snapArt?.name, curName: curArt?.name,
      };
    });
    return delay({ snapshot: s, rows, changed: rows.filter((r) => r.snapPlan !== r.curPlan || r.snapMode !== r.curMode).length });
  },
  /** Закрыть текущий месяц: факт ГК из iABS, автообновление скользящего прогноза, снимок справочников, сигналы. */
  async closeMonth(user: User): Promise<BudgetingSnapshot> {
    assertEdit(user);
    if (db.closed >= 12) throw new Error('budgeting_err_year_closed');
    const m = db.closed;
    const rand = budgetingRng(7000 + m);
    let control = 0;
    const facts = db.lines.map((l) => {
      const consumed = consumedOpen(new Set([l.id]), m) - consumedOpen(new Set([l.id]), m - 1);
      const gl = roundM((l.forecast[m] ?? 0) * (0.95 + rand() * 0.08));
      const fact = Math.max(gl, consumed);
      control += fact;
      return { l, fact };
    });
    const rec = await integrationHub.call('iabs', 'gl.balances', { period: ym(BUDGET_YEAR, m), rows: facts.length, controlSum: control }, { userId: user.id, idempotencyKey: `bud-close-${ym(BUDGET_YEAR, m)}` });
    if (rec.status !== 'success') throw new Error('budgeting_err_gl_unavailable');
    for (const { l, fact } of facts) {
      l.actual[m] = fact;
      l.forecast[m] = 0;
    }
    // Резервы закрытого месяца переносятся на следующий месяц (обязательства не исчезают).
    for (const t of db.txns) if (t.month === m && t.kind === 'reserve' && reservedFor(t.lineId, t.ref) > 0 && m < 11) t.month = m + 1;
    db.closed = m + 1;
    const snap = takeSnapshot(db.closed, user.id, now());
    db.snapshots.unshift(snap);
    makeRollingRun('avg3', 'system', true);
    runSignals();
    audit.log({ action: 'update', entity: 'budget_period', entityId: snap.period, entityLabel: snap.period, details: `close month · GL ${control} · snapshot ${snap.id}`, user: who(user) });
    notify({ roles: ['finance'], title: FL(`Бюджетный месяц ${snap.period} закрыт`, `${snap.period} byudjet oyi yopildi`, `Budget month ${snap.period} closed`), body: FL('Снимок справочников сохранён, скользящий прогноз обновлён', 'Ma’lumotnomalar surati saqlandi, sirpanuvchi prognoz yangilandi', 'Directory snapshot saved, rolling forecast updated'), link: '/budgeting?tab=periods', level: 'info', kind: 'system' });
    emit();
    return delay(snap);
  },
};
