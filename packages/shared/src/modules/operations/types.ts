// Типы модуля «Анализ операций XB-ERP» (ТЗ 4.2.16): нагрузка по модулям, длительность согласований,
// нарушения SLA, узкие места и активность пользователей.
import type { ApprovalEntity, ID, ISODate, Localized, Role } from '../../types';

export type OperationsModuleKey =
  | 'procurement'
  | 'contracts'
  | 'requests'
  | 'einvoices'
  | 'warehouse'
  | 'assets'
  | 'fleet'
  | 'documents'
  | 'trips'
  | 'budgeting'
  | 'cash';

export interface OperationsModuleInfo {
  key: OperationsModuleKey;
  name: Localized;
  entity?: ApprovalEntity; // тип документа в движке согласований
}

/** Документы, созданные и закрытые в модуле за месяц. */
export interface OperationsMonthly {
  month: string; // 2026-04
  module: OperationsModuleKey;
  created: number;
  closed: number;
}

/** Завершённый этап согласования (журнал движка за прошлые периоды). */
export interface OperationsApprovalLog {
  id: ID;
  entity: ApprovalEntity;
  step: number;
  role: Role;
  departmentId: ID;
  startedAt: ISODate;
  finishedAt: ISODate;
  decision: 'approved' | 'rejected';
}

export interface OperationsUserActivity {
  month: string;
  departmentId: ID;
  actions: number;
  activeUsers: number;
}

export interface OperationsFilter {
  months: 3 | 6;
  module?: OperationsModuleKey;
}

export interface OperationsCycleRow {
  entity: ApprovalEntity;
  count: number;
  avgHours: number;
  p90Hours: number;
  rejectPct: number;
}

export interface OperationsBottleneckRow {
  role: Role;
  steps: number;
  avgHours: number;
  slaHours: number;
  breaches: number;
  breachPct: number;
  openNow: number;
  overdueNow: number;
}

export interface OperationsDeptRow {
  departmentId: ID;
  actions: number;
  activeUsers: number;
  perUser: number;
}

export interface OperationsTrendRow {
  month: string;
  created: number;
  closed: number;
  backlog: number; // накопленный остаток открытых документов
}

export interface OperationsAnalysis {
  months: string[];
  kpis: {
    processed: number;
    avgCycleHours: number;
    slaBreachPct: number;
    openNow: number;
    overdueNow: number;
  };
  byModule: { module: OperationsModuleKey; values: number[]; total: number }[];
  trend: OperationsTrendRow[];
  cycle: OperationsCycleRow[];
  bottlenecks: OperationsBottleneckRow[];
  departments: OperationsDeptRow[];
}

// ---------- P2-FINPLAN: себестоимость продуктов и анализ трансфертной маржи (ТЗ 4.2.16) ----------

export type OpaStaff = 'front' | 'back' | 'credit' | 'it';
export type OpaIndirectBasis = 'balance' | 'operations' | 'time';
export type OpaDirectMethod = 'standard' | 'timesheet';
export type OpaCostCategory = 'rent' | 'it' | 'support' | 'general' | 'marketing';

/** Объект себестоимости: продукт баланса (из FTP) или услуга (комиссионный продукт). */
export interface OpaProduct {
  id: ID;
  name: Localized;
  kind: 'balance' | 'service';
  segment: 'retail' | 'corporate' | 'sme' | 'treasury';
  ftpUnitId: ID;
  /** Комиссионный доход на операцию, UZS (для услуг). */
  feePerOp?: number;
  /** Прямые расходы на операцию (материалы, процессинг), UZS. */
  directPerOp: number;
  /** Доли каналов продаж. */
  channels: Record<string, number>;
  credit: boolean;
}

export interface OpaTimeStandard {
  productId: ID;
  activity: Localized;
  minutes: number;
  staff: OpaStaff;
}

export interface OpaElInput {
  productId: ID;
  pd: number; // %
  lgd: number; // %
  reserve: number; // UZS — сформированный резерв
  source: 'import' | 'manual';
  period: string;
  updatedAt: ISODate;
  updatedBy: ID | 'system';
  reason?: string;
}

export interface OpaCostProfile {
  id: ID;
  orgUnitKey: string;
  regionCode: string;
  tariff: 'urban' | 'standard' | 'rural';
  laborFactor: number;
  rentPerSqm: number;
  validFrom: ISODate;
  validTo: ISODate | null;
  auto: boolean;
  note: string;
  createdBy: ID | 'system';
}

export interface OpaSettings {
  indirectBasis: OpaIndirectBasis;
  directMethod: OpaDirectMethod;
  laborRates: Record<OpaStaff, number>; // UZS/час
  updatedAt: ISODate;
  updatedBy: ID | 'system';
}

export interface OpaProductCost {
  productId: ID;
  name: Localized;
  kind: OpaProduct['kind'];
  segment: OpaProduct['segment'];
  ftpUnitId: ID;
  side?: 'asset' | 'liability';
  currency?: string;
  balance: number;
  operations: number;
  minutes: number;
  /** Квартал: процентный доход (актив) / процентный расход (пассив, со знаком −) / комиссии (услуги). */
  clientIncome: number;
  /** Плата за ресурсы FTP (актив: −) или кредит за привлечение (пассив: +). */
  ftp: number;
  netInterest: number;
  fees: number;
  direct: number;
  indirect: number;
  indirectBy: Record<OpaCostCategory, number>;
  el: number;
  /** Себестоимость = прямые + косвенные + EL + стоимость ресурсов (для активов). */
  cost: number;
  profit: number;
  marginPct: number;
  costPerOp: number;
}

export interface OpaCostingResult {
  period: string;
  allocationSource: 'run' | 'preview';
  allocationRun?: string;
  methodology: string;
  basis: OpaIndirectBasis;
  products: OpaProductCost[];
  totals: { revenue: number; ftp: number; direct: number; indirect: number; el: number; profit: number; allocated: number; treasury: number };
}

export interface OpaBreakdownRow {
  key: string;
  revenue: number;
  direct: number;
  indirect: number;
  el: number;
  ftp: number;
  profit: number;
}

export interface OpaMarginRow {
  productId: ID;
  name: Localized;
  side: 'asset' | 'liability';
  currency: string;
  balance: number;
  commercial: number;
  treasury: number;
  liquidity: number;
  optionality: number;
  total: number;
}

export interface OpaTreasuryCcRow {
  costCenterKey: string;
  code: string;
  name: Localized;
  book: 'uzs' | 'fx' | 'liquidity';
  profit: number;
}
