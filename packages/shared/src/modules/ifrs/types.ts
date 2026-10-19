// Типы модуля МСФО (ТЗ 4.2.18): структура группы, трансформация НСБУ → МСФО, корректировки, консолидация.
import type { ID, ISODate, Localized } from '../../types';

export type IfrsEntityType = 'parent' | 'subsidiary' | 'associate';
export type IfrsConsolidationMethod = 'parent' | 'full' | 'equity';
export type IfrsCurrency = 'UZS' | 'USD';

export interface IfrsEntity {
  id: ID;
  name: string;
  shortName: string;
  type: IfrsEntityType;
  ownership: number; // доля банка, %
  method: IfrsConsolidationMethod;
  currency: IfrsCurrency; // функциональная валюта
  activity: Localized;
  investmentCost: number; // стоимость инвестиции у материнского банка, UZS (0 для банка)
}

/** Строки отчётности МСФО. SFP — отчёт о финансовом положении, PL — о прибылях и убытках. */
export type IfrsSfpLine =
  | 'cash'
  | 'due_banks'
  | 'loans'
  | 'investments'
  | 'fixed_assets'
  | 'other_assets'
  | 'goodwill'
  | 'deposits'
  | 'borrowings'
  | 'other_liabilities'
  | 'share_capital'
  | 'retained';

export type IfrsPlLine =
  | 'interest_income'
  | 'interest_expense'
  | 'fee_income'
  | 'other_income'
  | 'opex'
  | 'ecl_charge'
  | 'share_associates'
  | 'tax';

export type IfrsLine = IfrsSfpLine | IfrsPlLine;
export type IfrsLineValues = Partial<Record<IfrsLine, number>>;

export interface IfrsEntityStatement {
  entityId: ID;
  /** Значения в функциональной валюте сущности (для USD — в долларах). */
  values: IfrsLineValues;
}

/** Счёт оборотно-сальдовой ведомости банка по НСБУ (план счетов ЦБ РУз) и его сопоставление со строкой МСФО. */
export interface IfrsTrialBalanceRow {
  accountCode: string;
  name: Localized;
  balance: number; // UZS
  ifrsLine: IfrsLine | null;
}

export type IfrsAdjustmentType = 'ecl' | 'lease' | 'deferred_tax' | 'fair_value' | 'fixed_assets';

export interface IfrsAdjustment {
  id: ID;
  number: string;
  entityId: ID;
  type: IfrsAdjustmentType;
  amount: number; // UZS
  description: string;
  createdBy: ID;
  createdAt: ISODate;
  /** Проводка, построенная по шаблону типа: изменение строк отчётности. */
  lines: { line: IfrsLine; delta: number }[];
  /** Автоматическая корректировка Adjustments Engine (амортизация/переоценка ОС, МСФО 16) и её источник. */
  auto?: boolean;
  source?: string;
}

export interface IfrsIntragroup {
  id: ID;
  description: Localized;
  assetEntityId: ID;
  assetLine: IfrsSfpLine;
  liabilityEntityId: ID;
  liabilityLine: IfrsSfpLine;
  amount: number; // UZS
  incomeLine: IfrsPlLine;
  expenseLine: IfrsPlLine;
  plAmount: number; // проценты за период, UZS
}

export interface IfrsCloseTask {
  id: ID;
  title: Localized;
  ownerId: ID;
  dueDate: ISODate;
  done: boolean;
}

/** Строка консолидированного отчёта: по сущностям (после корректировок), элиминации, итог. */
export interface IfrsConsolidatedRow {
  line: IfrsLine | 'total_assets' | 'total_liabilities' | 'profit' | 'nci' | 'total_equity' | 'net_profit' | 'profit_owners' | 'profit_nci' | 'total_equity_liabilities';
  byEntity: Record<ID, number>;
  eliminations: number;
  consolidated: number;
  kind: 'line' | 'subtotal' | 'total';
}

export interface IfrsConsolidation {
  period: string;
  entities: IfrsEntity[]; // сущности, консолидируемые построчно (банк + full)
  sfp: IfrsConsolidatedRow[];
  pl: IfrsConsolidatedRow[];
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
  netProfit: number;
  profitOwners: number;
  profitNci: number;
  nci: number;
  goodwill: number;
  associatesShare: number;
  unmappedAccounts: number;
  /** Журнал элиминаций и консолидационных проводок (PR-SUB-012…016). */
  journal?: IfrsElimEntry[];
  /** Сущности, по которым отчётность взята из принятого пакета (иначе — предварительные данные). */
  fromPackages?: ID[];
}

export interface IfrsElimEntry {
  source: 'intragroup' | 'investment' | 'associate' | 'dividend';
  ref: string;
  description: Localized;
  lines: { line: IfrsLine; amount: number }[];
}

export interface IfrsNewAdjustmentInput {
  entityId: ID;
  type: IfrsAdjustmentType;
  amount: number;
  description: string;
}

// ---------------------------------------------------------------------------------------------
// Сбор данных дочерних, план счетов и маппинг, НСИ, дивиденды (ТЗ 4.2.18 А–В)

export type IfrsConnector = 'sap' | 'oracle' | '1c' | 'web' | 'excel';
export type IfrsPackageSource = 'api' | 'manual' | 'excel';
export type IfrsPackageStatus = 'draft' | 'submitted' | 'accepted' | 'returned';
export type IfrsNsbuClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

/** Счёт плана счетов дочернего предприятия (НСБУ). */
export interface IfrsLocalAccount {
  entityId: ID;
  code: string;
  name: Localized;
  cls: IfrsNsbuClass;
}

/** Правило матрицы трансформации: шаблон счёта (префикс) → строка МСФО (PR-SUB-009/010). */
export interface IfrsMappingRule {
  id: ID;
  entityId: ID | '*';
  pattern: string;
  line: IfrsLine;
  note?: Localized;
  createdBy?: ID;
}

export interface IfrsPackageRow {
  account: string;
  name: string;
  balance: number;
}

export interface IfrsArApRow {
  counterparty: string;
  tin: string;
  kind: 'receivable' | 'payable';
  amount: number;
  overdueDays: number;
}

export interface IfrsPortfolioRow {
  kind: 'loans' | 'deposits' | 'investments';
  amount: number;
  count: number;
}

export interface IfrsValidationIssue {
  code: 'balance' | 'unmapped' | 'required' | 'negative' | 'arap' | 'empty';
  severity: 'error' | 'warning';
  account?: string;
  detail?: string;
}

/** Пакет отчётности дочернего предприятия за месяц (ОСВ, баланс, дебиторка/кредиторка, портфель) — PR-SUB-003. */
export interface IfrsSubPackage {
  id: ID;
  entityId: ID;
  period: string; // 2026-09
  source: IfrsPackageSource;
  connector: IfrsConnector;
  status: IfrsPackageStatus;
  rows: IfrsPackageRow[];
  arap: IfrsArApRow[];
  portfolio: IfrsPortfolioRow[];
  signatureId?: ID;
  submittedBy?: ID;
  submittedAt?: ISODate;
  acceptedBy?: ID;
  acceptedAt?: ISODate;
  returnComment?: string;
  exchangeId?: string;
  updatedAt: ISODate;
  history: { at: ISODate; userId: ID; action: string; comment?: string }[];
}

export interface IfrsPackageView extends IfrsSubPackage {
  issues: IfrsValidationIssue[];
  totals: Record<IfrsNsbuClass, number>;
  mapped: IfrsLineValues;
}

export type IfrsNsiKind = 'counterparty' | 'expense' | 'asset';

/** Элемент локального справочника дочернего предприятия и его сопоставление с единым классификатором группы (PR-SUB-011). */
export interface IfrsNsiItem {
  id: ID;
  entityId: ID;
  kind: IfrsNsiKind;
  localCode: string;
  localName: string;
  tin?: string;
  groupCode?: string;
  matchedBy?: 'auto' | 'manual';
}

export interface IfrsGroupClassItem {
  kind: IfrsNsiKind;
  code: string;
  name: Localized;
  tin?: string;
  keywords?: string[];
}

/** Внутригрупповые дивиденды (PR-SUB-015). Сумма — в функциональной валюте выплачивающей компании. */
export interface IfrsDividend {
  id: ID;
  entityId: ID;
  amount: number;
  declaredAt: ISODate;
  status: 'declared' | 'paid';
}

/** Кандидат внутригрупповой операции, найденный по реестрам дебиторки/кредиторки (PR-SUB-013). */
export interface IfrsIntragroupCandidate {
  key: string;
  assetEntityId: ID;
  liabilityEntityId: ID;
  assetAmount: number;
  liabilityAmount: number;
  difference: number;
  description: string;
  status: 'matched' | 'new' | 'mismatch';
  intragroupId?: ID;
}
