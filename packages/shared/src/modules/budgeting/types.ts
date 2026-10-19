// Типы модуля «Бюджетирование и мониторинг» (ТЗ 4.2.13).
import type { HistoryEvent, ID, ISODate, Localized } from '../../types';

export type BudgetingArticleGroup = 'opex' | 'capex';
/** Режим бюджетного контроля статьи: hard — блокировка транзакции, soft — предупреждение + подтверждение руководителя. */
export type BudgetingControlMode = 'hard' | 'soft';

export interface BudgetingArticle {
  id: ID;
  code: string;
  name: Localized;
  group: BudgetingArticleGroup;
  controlMode: BudgetingControlMode;
  /** Код статьи справочника MDM / ядра (2026-IT-HW…) — связь «единого источника» со статьями закупок. */
  mdmCode?: string;
}

/** Стратегическая цель банка (ZBB: каждая статья расходов связывается с целью). */
export interface BudgetingGoal {
  id: ID;
  code: string;
  name: Localized;
}

/** Обоснование ZBB строки бюджета (экономическое обоснование, цель, риски нефинансирования). */
export interface BudgetingZbbBasis {
  justification: string;
  goalId: ID;
  impact: string;
  packageId?: ID;
}

/** Строка бюджета: центр затрат × статья × оргединица (подразделение ГО или филиал), помесячно на 2026 год (UZS). */
export interface BudgetingLine {
  id: ID;
  departmentId: ID;
  articleId: ID;
  /** Оргединица (ключ оргструктуры): d1…d11 — подразделения ГО, R01…R14 — региональные филиалы. */
  orgUnitKey: string;
  /** МВЗ (ключ справочника МВЗ оргструктуры), определяется по оргединице. */
  costCenterKey?: string;
  plan: number[];
  actual: number[]; // факт за закрытые месяцы, 0 — для будущих
  forecast: number[]; // прогноз за оставшиеся месяцы, 0 — для закрытых
  zbb?: BudgetingZbbBasis;
}

export type BudgetingAlertLevel = 'ok' | 'warning' | 'overrun';

/** Расчётные показатели строки (или агрегата). */
export interface BudgetingSummary {
  planYear: number;
  planYtd: number;
  actualYtd: number;
  forecastYear: number; // факт YTD + прогноз до конца года
  varianceYtd: number; // факт − план YTD (плюс = перерасход)
  executionPct: number; // факт YTD / годовой план, %
  ytdPct: number; // факт YTD / план YTD, %
  alert: BudgetingAlertLevel;
  /** Исполнение текущего открытого периода из ERP-транзакций (платежи) и резервы (одобренные заявки). */
  consumedOpen: number;
  reservedOpen: number;
  /** Освоение лимита: (факт + списано + резерв) / годовой план, %. */
  usagePct: number;
}

export interface BudgetingLineView extends BudgetingLine, BudgetingSummary {}

export interface BudgetingDepartmentView extends BudgetingSummary {
  departmentId: ID;
  lines: number;
}

export interface BudgetingMonthPoint {
  month: number; // 0..11
  plan: number;
  actual: number;
  forecast: number;
}

export type BudgetingChangeType = 'transfer' | 'increase';
export type BudgetingChangeStatus = 'pending' | 'approved' | 'rejected' | 'returned';

export interface BudgetingChange {
  id: ID;
  number: string;
  type: BudgetingChangeType;
  departmentId: ID;
  fromArticleId?: ID;
  toArticleId: ID;
  amount: number;
  reason: string;
  status: BudgetingChangeStatus;
  requesterId: ID;
  createdAt: ISODate;
  appliedAt?: ISODate;
  history: HistoryEvent[];
}

export interface BudgetingOverview {
  year: number;
  closedMonths: number; // сколько месяцев закрыто фактом
  total: BudgetingSummary;
  opex: BudgetingSummary;
  capex: BudgetingSummary;
  alerts: { warning: number; overrun: number };
  pendingChanges: number;
  pendingOverruns: number;
  blockedTxns: number;
}

export interface BudgetingFilter {
  departmentId?: ID;
  group?: BudgetingArticleGroup;
  alertsOnly?: boolean;
  orgUnitKey?: string;
}

export interface BudgetingChangeInput {
  type: BudgetingChangeType;
  departmentId: ID;
  fromArticleId?: ID;
  toArticleId: ID;
  amount: number;
  reason: string;
}

// ---------- Бюджетный контроль (4.2.13.2) ----------

/** Откуда пришла транзакция расхода. */
export type BudgetingSource = 'procurement' | 'payment' | 'trip' | 'employee_request' | 'contract' | 'project' | 'manual';

export interface BudgetingCheckInput {
  /** Статья модуля (ba1…) — или код статьи MDM (mdmCode), или статья ядра (budgetLineId b1…). */
  articleId?: ID;
  mdmCode?: string;
  budgetLineId?: ID;
  /** МВЗ (ключ справочника МВЗ) — основной способ указать центр затрат. */
  costCenterKey?: string;
  departmentId?: ID;
  orgUnitKey?: string;
  amount: number;
  /** Месяц освоения (0..11), по умолчанию — первый открытый месяц. */
  month?: number;
  source: BudgetingSource;
  /** Документ-основание (идентификатор), чтобы не учитывать его собственный резерв повторно. */
  ref?: string;
  /** ТМЦ заявки — для проверки складских остатков (предложение внутреннего ресурса). */
  items?: { name: string; qty: number }[];
  /** Согласованное подтверждение превышения (soft-check). */
  overrunId?: ID;
}

export interface BudgetingLimitBlock {
  limit: number;
  used: number;
  available: number;
  ok: boolean;
}

export interface BudgetingStockHit {
  itemId: ID;
  sku: string;
  name: string;
  qty: number;
  unit: string;
  warehouseId: ID;
  requested: number;
}

export type BudgetingCheckStatus = 'ok' | 'warning' | 'exceeded';

export interface BudgetingCheckResult {
  lineId?: ID;
  articleId?: ID;
  departmentId?: ID;
  orgUnitKey?: string;
  costCenterKey?: string;
  mode: BudgetingControlMode;
  status: BudgetingCheckStatus;
  /** Hard-check: транзакцию нельзя провести. */
  blocked: boolean;
  /** Soft-check: нужно электронное подтверждение ответственного руководителя. */
  requiresConfirmation: boolean;
  overrunApproved: boolean;
  annual: BudgetingLimitBlock;
  monthly: BudgetingLimitBlock & { month: number };
  cash: BudgetingLimitBlock & { month: number };
  stock: BudgetingStockHit[];
  usagePctBefore: number;
  usagePctAfter: number;
  thresholdsCrossed: number[];
  messages: Localized[];
}

export type BudgetingTxnKind = 'reserve' | 'consume' | 'release' | 'blocked';

export interface BudgetingTxn {
  id: ID;
  lineId: ID;
  month: number;
  kind: BudgetingTxnKind;
  amount: number;
  source: BudgetingSource;
  ref: string;
  refLabel: string;
  userId: ID;
  at: ISODate;
  mode: BudgetingControlMode;
  overrunId?: ID;
  note?: string;
}

export type BudgetingOverrunStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'used';

/** Запрос на подтверждение превышения лимита (soft-check, PR-BUD-010/015). */
export interface BudgetingOverrun {
  id: ID;
  number: string;
  lineId: ID;
  amount: number;
  excess: number;
  source: BudgetingSource;
  ref: string;
  refLabel: string;
  reason: string;
  impact: string;
  status: BudgetingOverrunStatus;
  requesterId: ID;
  createdAt: ISODate;
  history: HistoryEvent[];
}

export interface BudgetingSettings {
  thresholds: number[]; // 70, 80, 90
  checkMonthly: boolean;
  checkCash: boolean;
  checkStock: boolean;
}

/** Отправленный сигнал освоения лимита. */
export interface BudgetingSignal {
  id: ID;
  lineId: ID;
  threshold: number;
  usagePct: number;
  at: ISODate;
  recipients: ID[];
}

/** Кассовый план (ОДДС) подразделения по месяцам. */
export interface BudgetingCashPlanRow {
  departmentId: ID;
  plan: number[];
  paid: number[]; // факт выплат за закрытые месяцы
}

export interface BudgetingCashPlanView extends BudgetingCashPlanRow {
  used: number[]; // выплаты/резервы ERP в открытых месяцах
  available: number[];
}

// ---------- Скользящий прогноз (PR-BUD-002) ----------

export type BudgetingForecastMethod = 'avg3' | 'avg6' | 'trend';

export interface BudgetingRollingPoint {
  ym: string; // 2026-10
  plan: number; // план (2026) или базовый план следующего года
  forecast: number;
}

export interface BudgetingRollingRun {
  id: ID;
  at: ISODate;
  userId: ID | 'system';
  basedOnMonths: number;
  method: BudgetingForecastMethod;
  horizon: BudgetingRollingPoint[];
  total: number;
  auto: boolean;
}

export interface BudgetingRollingRow {
  departmentId: ID;
  points: BudgetingRollingPoint[];
  ratio: number;
}

// ---------- Сценарии (PR-BUD-003) ----------

export interface BudgetingScenario {
  id: ID;
  code: 'base' | 'optimistic' | 'pessimistic' | string;
  name: Localized;
  opexPct: number;
  capexPct: number;
  /** Изменения по отдельным статьям, %. */
  articlePct: Record<ID, number>;
  fxUsd: number;
  headcountPct: number;
  updatedAt: ISODate;
  updatedBy: ID;
  system: boolean;
}

export interface BudgetingScenarioRow {
  articleId: ID;
  group: BudgetingArticleGroup;
  base: number;
  values: Record<ID, number>;
}

// ---------- ZBB (PR-BUD-001) ----------

export type BudgetingZbbPriority = 'mandatory' | 'important' | 'desirable';
export type BudgetingDocStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'returned';

export interface BudgetingZbbItem {
  id: ID;
  articleId: ID;
  amount: number;
  calc: string;
  justification: string;
  goalId: ID;
  impact: string;
  priority: BudgetingZbbPriority;
}

export interface BudgetingZbbPackage {
  id: ID;
  number: string;
  year: number;
  departmentId: ID;
  title: string;
  items: BudgetingZbbItem[];
  status: BudgetingDocStatus;
  requesterId: ID;
  createdAt: ISODate;
  history: HistoryEvent[];
}

export interface BudgetingZbbInput {
  id?: ID;
  departmentId: ID;
  title: string;
  items: Omit<BudgetingZbbItem, 'id'>[];
}

// ---------- CAPEX и инвестпроекты (4.2.13.3) ----------

export type BudgetingCapexKind = 'capex' | 'large_purchase' | 'investment';

export interface BudgetingCapexRequest {
  id: ID;
  number: string;
  kind: BudgetingCapexKind;
  departmentId: ID;
  articleId: ID;
  title: string;
  amount: number;
  /** График финансирования: месяц (YYYY-MM) → сумма. */
  schedule: { ym: string; amount: number }[];
  justification: string;
  comments: string;
  goalId: ID;
  impact: string;
  status: BudgetingDocStatus;
  requesterId: ID;
  createdAt: ISODate;
  projectId?: ID;
  history: HistoryEvent[];
}

export interface BudgetingCapexInput {
  kind: BudgetingCapexKind;
  departmentId: ID;
  articleId: ID;
  title: string;
  schedule: { ym: string; amount: number }[];
  justification: string;
  comments: string;
  goalId: ID;
  impact: string;
}

export type BudgetingProjectType = 'construction' | 'it' | 'equipment' | 'other';
export type BudgetingProjectStatus = 'initiation' | 'in_progress' | 'on_hold' | 'completed';
export type BudgetingMilestoneStatus = 'planned' | 'in_progress' | 'done' | 'delayed';

export interface BudgetingMilestone {
  id: ID;
  name: string;
  start: ISODate;
  end: ISODate;
  budget: number;
  actual: number;
  progressPct: number;
  status: BudgetingMilestoneStatus;
}

/** Паспорт инвестиционного проекта (PR-BUD-012). */
export interface BudgetingProjectPassport {
  goal: string;
  scope: string;
  kpi: string;
  fundingSource: string;
  risks: string;
  sponsorId: ID;
  managerId: ID;
}

export interface BudgetingProject {
  id: ID;
  code: string;
  name: string;
  type: BudgetingProjectType;
  departmentId: ID;
  articleId: ID;
  goalId: ID;
  start: ISODate;
  end: ISODate;
  budget: number;
  status: BudgetingProjectStatus;
  passport: BudgetingProjectPassport;
  milestones: BudgetingMilestone[];
  capexRequestId?: ID;
}

// ---------- Закрытие месяца и снимки справочников ----------

export interface BudgetingSnapshot {
  id: ID;
  period: string; // 2026-09
  month: number;
  takenAt: ISODate;
  takenBy: ID | 'system';
  articles: BudgetingArticle[];
  goals: BudgetingGoal[];
  settings: BudgetingSettings;
  lines: { id: ID; departmentId: ID; articleId: ID; orgUnitKey: string; costCenterKey?: string; planYear: number; planYtd: number; actualYtd: number; forecastYear: number }[];
  totals: { planYear: number; actualYtd: number; forecastYear: number };
}

export interface BudgetingBranchRow {
  key: string; // HO | R01…
  name: Localized;
  lines: number;
  planYear: number;
  actualYtd: number;
  forecastYear: number;
  usagePct: number;
  costCenters: number;
}
