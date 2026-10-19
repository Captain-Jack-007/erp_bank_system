// Типы контура НДО (ТЗ 4.2.20): объекты кассовой инфраструктуры, классификаторы, наборы данных и загрузки,
// факты и корректировки, бюджет, остатки и стоимость фондирования, аллокация, себестоимость, P&L, тарифы,
// качество данных и закрытие периода.
import type { ID, ISODate, Localized, Role } from '../../types';
import type { CashCurrency } from './types';

export type NdoObjectType = 'ekc' | 'vault' | 'cbu' | 'cash_desk' | 'mobile_desk' | 'exchange' | 'cit_route' | 'vehicle' | 'equipment' | 'atm' | 'cash_in' | 'recycler';
export type NdoObjectStatus = 'active' | 'suspended' | 'closed';

/** Версия объекта кассовой инфраструктуры (SCD-2): единый ключ, период действия, связь с оргструктурой и МВЗ (BR-NDO-01). */
export interface NdoObject {
  key: string;
  version: number;
  validFrom: ISODate;
  validTo?: ISODate;
  type: NdoObjectType;
  code: string;
  name: Localized;
  status: NdoObjectStatus;
  parentKey?: string;
  orgUnitKey: string;
  costCenterCode: string;
  respCenter: string;
  cashBranchId?: ID;
  /** Норматив остатка (UZS-экв.) — нижняя граница «нормативного» остатка. */
  normative?: number;
  routeKm?: number;
  model?: string;
  changedBy?: ID;
  changeReason?: string;
}

export type NdoClassKind = 'process' | 'article' | 'currency' | 'cash_state' | 'device_type' | 'driver';

/** Элемент единого классификатора НДО (версионируемый, BR-NDO-02). */
export interface NdoClassItem {
  kind: NdoClassKind;
  code: string;
  name: Localized;
  version: number;
  validFrom: ISODate;
  validTo?: ISODate;
  /** Для статей: доход/расход, прямой/косвенный, внешний/внутренний расчёт. */
  direction?: 'income' | 'expense';
  nature?: 'direct' | 'indirect';
  external?: boolean;
  unit?: string;
}

export type NdoSystem = 'iabs' | 'cashsys' | 'optiload' | 'processing' | 'servicedesk' | 'laborlaw' | 'erp_ftp' | 'erp_alloc';

/** Паспорт набора данных: источник, владелец, периодичность, детализация, бизнес-ключи, правила, контрольные итоги (BR-NDO-04). */
export interface NdoDataset {
  id: string;
  name: Localized;
  system: NdoSystem;
  integration?: { systemId: string; operation: string };
  owner: Localized;
  periodicity: 'daily' | 'monthly';
  granularity: Localized;
  businessKeys: string[];
  transform: Localized;
  controlTotal: Localized;
  mandatory: boolean;
}

export type NdoLoadStatus = 'success' | 'mismatch' | 'failed' | 'queued';

export interface NdoLoad {
  id: ID;
  datasetId: string;
  period: string;
  at: ISODate;
  by: ID;
  exchangeId?: string;
  status: NdoLoadStatus;
  rows: number;
  inserted: number;
  updated: number;
  duplicates: number;
  rejected: number;
  controlSource: number;
  controlLoaded: number;
  hash: string;
}

/** Факт дохода/расхода/объёма (первичные данные хранятся без изменений). */
export interface NdoFact {
  id: string; // бизнес-ключ
  datasetId: string;
  period: string;
  article: string;
  objectKey?: string;
  pool?: string;
  process?: string;
  currency: CashCurrency;
  amount: number; // UZS-экв.
  amountFx?: number;
  external: boolean;
  sourceRef: string;
  loadId: ID;
}

/** Драйвер / операционный объём по объекту за период. */
export interface NdoVolume {
  id: string;
  period: string;
  objectKey: string;
  driver: 'volume' | 'transactions' | 'collections' | 'route_km' | 'fte' | 'downtime_h' | 'incidents' | 'loads';
  value: number;
  sourceRef: string;
  loadId: ID;
}

/** Ошибочная запись источника, направленная на исправление (BR-NDO-23). */
export interface NdoErrorRecord {
  id: ID;
  datasetId: string;
  period: string;
  sourceRef: string;
  reason: 'unknown_object' | 'unknown_article' | 'negative';
  sourceCode: string;
  amount: number;
  status: 'open' | 'fixed';
  fixedObjectKey?: string;
  fixedBy?: ID;
  ownerRole: Role;
}

/** Ручная корректировка управленческого слоя (BR-NDO-06): первичные данные не меняются. */
export interface NdoAdjustment {
  id: ID;
  period: string;
  article: string;
  objectKey?: string;
  amount: number;
  reason: string;
  createdBy: ID;
  at: ISODate;
  status: 'draft' | 'approved' | 'rejected';
  approvedBy?: ID;
}

export type NdoScenarioKind = 'base' | 'optimistic' | 'stress';

/** Строка бюджета НДО (BR-NDO-07/08): ZBB или драйверный метод, сценарий, МВЗ, процесс, валюта. */
export interface NdoBudgetLine {
  id: ID;
  period: string;
  scenario: NdoScenarioKind;
  article: string;
  objectKey: string;
  costCenterCode: string;
  process: string;
  currency: CashCurrency;
  method: 'zbb' | 'driver';
  driver?: NdoVolume['driver'];
  driverVolume?: number;
  rate?: number; // цена за единицу драйвера
  fxRate?: number;
  amount: number; // UZS-экв.
  justification?: string;
}

export interface NdoFactorRow {
  article: string;
  plan: number;
  actual: number;
  variance: number;
  volume: number;
  price: number;
  structure: number;
  fx: number;
  ftp: number;
  allocation: number;
}

/** Ежедневный остаток по объекту/валюте/состоянию (BR-NDO-10). */
export interface NdoBalance {
  date: ISODate;
  objectKey: string;
  currency: CashCurrency;
  state: 'vault' | 'desk' | 'device' | 'processing' | 'transit';
  amount: number; // в валюте
  denominations?: Record<string, number>;
  unfit?: number; // доля ветхих банкнот, %
}

export interface NdoTransitItem {
  orderId: ID;
  number: string;
  ownerKey: string; // единственный учётный владелец (маршрут инкассации)
  fromKey: string;
  toKey: string;
  currency: CashCurrency;
  amount: number;
  since: ISODate;
}

export interface NdoFundingRow {
  objectKey: string;
  currency: CashCurrency;
  avgBalance: number; // в валюте
  avgUzs: number;
  normative: number;
  necessary: number;
  excess: number;
  ftpRate: number;
  fxRate: number;
  days: number;
  cost: number;
  costNormative: number;
  costNecessary: number;
  costExcess: number;
}

export interface NdoScenario {
  id: ID;
  name: string;
  balancePct: number;
  storageDays: number;
  fxPct: number;
  ftpBp: number;
  createdBy: ID;
  at: ISODate;
}

export type NdoRuleStep = 'ndo_internal' | 'bank_share' | 'final';
export type NdoRuleStatus = 'draft' | 'pending' | 'active' | 'rejected' | 'retired';

/** Правило аллокации НДО: источник, получатели, драйвер, формула, период действия, маршрут согласования (BR-NDO-15). */
export interface NdoRule {
  id: ID;
  code: string;
  name: Localized;
  step: NdoRuleStep;
  pool: string;
  receiverTypes: NdoObjectType[];
  driver: NdoVolume['driver'];
  formula: Localized;
  validFrom: ISODate;
  validTo?: ISODate;
  status: NdoRuleStatus;
  version: number;
  createdBy: ID;
  approvedBy?: ID;
}

export interface NdoAllocRow {
  ruleId: ID;
  step: NdoRuleStep;
  pool: string;
  receiver: string;
  driverValue: number;
  share: number;
  amount: number;
}

export interface NdoObjectResult {
  key: string;
  income: number;
  incomeInternal: number;
  direct: number;
  ndoAlloc: number;
  hoAlloc: number;
  funding: number;
  total: number;
  result: number;
  volume: number;
  transactions: number;
  collections: number;
  costPerMln: number;
}

export interface NdoResults {
  period: string;
  objects: NdoObjectResult[];
  allocation: NdoAllocRow[];
  pools: { pool: string; amount: number; allocated: number }[];
  funding: NdoFundingRow[];
  byProcess: { process: string; cost: number }[];
  totals: { income: number; incomeInternal: number; direct: number; ndoAlloc: number; hoAlloc: number; funding: number; total: number; result: number; volume: number };
  methodology: string;
  hash: string;
}

export type NdoCloseStep = 'load' | 'dq' | 'direct' | 'funding' | 'allocation' | 'cost' | 'approve' | 'closed';

export interface NdoPeriodState {
  period: string;
  steps: Partial<Record<NdoCloseStep, { at: ISODate; by: ID }>>;
  status: 'open' | 'pending_approval' | 'closed';
  snapshot?: { at: ISODate; hash: string; results: NdoResults; frozen: unknown; versions: Record<string, number | string> };
  calcBy?: ID;
}

export interface NdoDqCheck {
  code: string;
  name: Localized;
  ok: boolean;
  severity: 'blocker' | 'warning';
  detail: string;
}

export interface NdoParams {
  methodology: string;
  storageDays: number;
  necessaryFactor: number;
  targetMargin: number; // %
  vatRate: number;
  excessThresholdPct: number;
  costPerMlnThreshold: number;
  glTolerance: number; // допустимое расхождение с ГК, UZS
  roles: { input: Role[]; calc: Role[]; check: Role[]; approve: Role[] };
}

export interface NdoTariff {
  code: string;
  name: Localized;
  unit: Localized;
  driver: NdoVolume['driver'];
  currentTariff: number;
  plannedVolume: number;
  benefitPct: number;
  vatApplies: boolean;
}

export interface NdoTariffCalc extends NdoTariff {
  unitCost: number;
  unitFtp: number;
  margin: number;
  tax: number;
  recommended: number;
  gapPct: number;
  plannedIncome: number;
}

export interface NdoOptiRec {
  id: string;
  period: string;
  objectKey: string;
  date: ISODate;
  recommended: number;
  actual: number;
  followed: boolean;
  cashOutHours: number;
  excessAfter: number;
}
