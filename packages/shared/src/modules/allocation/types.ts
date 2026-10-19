// Типы модуля «Аллокация» (ТЗ 4.2.14): распределение косвенных затрат между центрами ответственности (МВЗ)
// и бизнес-направлениями прямым, каскадным (step-down) и взаимным (матричным) методами по драйверам.
import type { ID, ISODate, Localized } from '../../types';

/** Идентификатор драйвера из библиотеки драйверов (системные: headcount, area, transactions, revenue…). */
export type AllocationDriver = string;

export type AllocationCenterType = 'admin' | 'service' | 'business';
export type AllocationBusinessKind = 'line' | 'branch' | 'cbu' | 'channel';

/** Центр ответственности (МВЗ-агрегат): административный, обслуживающий или бизнес-центр (центр прибыли). */
export interface AllocationCenter {
  id: ID;
  code: string;
  name: Localized;
  type: AllocationCenterType;
  kind?: AllocationBusinessKind;
  departmentId?: ID;
  /** Оргединица оргструктуры (филиал/ЦБУ) для бизнес-центров сети. */
  orgUnitKey?: string;
  /** Направление FTP (для драйверов портфеля и доходности). */
  ftpUnitId?: ID;
}

export type AllocationPoolCategory = 'it' | 'hr' | 'admin' | 'premises' | 'operations' | 'security' | 'marketing' | 'corporate' | 'taxes';

export interface AllocationPool {
  id: ID;
  code: string;
  name: Localized;
  departmentId: ID; // подразделение-источник затрат
  centerId: ID; // центр ответственности-источник
  category: AllocationPoolCategory;
}

/** Бизнес-центр (направление) — получатель затрат; значения драйверов по периодам. */
export interface AllocationUnit extends AllocationCenter {
  /** Значения драйверов по периодам: drivers[period][driver]. */
  drivers: Record<string, Record<AllocationDriver, number>>;
}

export interface AllocationRule {
  poolId: ID;
  driver: AllocationDriver;
  updatedAt: ISODate;
  updatedBy: ID;
}

export type AllocationMethod = 'direct' | 'step_down' | 'reciprocal';

export interface AllocationSettings {
  method: AllocationMethod;
  /** Последовательность каскада step-down: обслуживающие и административные центры. */
  chain: ID[];
  updatedAt: ISODate;
  updatedBy: ID;
  version: number;
}

export type AllocationDriverSource = 'hr' | 'assets' | 'abs' | 'timesheets' | 'portfolio' | 'profit' | 'manual' | 'formula';

export interface AllocationDriverDef {
  id: AllocationDriver;
  code: string;
  name: Localized;
  unit: string;
  source: AllocationDriverSource;
  /** Формула (для source = formula) над другими драйверами: «transactions / 1000 + headcount * 10». */
  formula?: string;
  system: boolean;
  createdBy?: ID;
  updatedAt?: ISODate;
}

export interface AllocationDriverValue {
  value: number;
  source: 'auto' | 'manual';
  updatedAt: ISODate;
  updatedBy: ID | 'system';
  reason?: string;
}

export interface AllocationDriverLog {
  id: ID;
  at: ISODate;
  userId: ID | 'system';
  period: string;
  centerId: ID;
  driverId: AllocationDriver;
  from: number;
  to: number;
  source: 'manual' | 'auto';
  reason?: string;
}

/** Связь драйвера с источником данных (Mapping): система, операция, поле и ключи центров в источнике. */
export interface AllocationMapping {
  driverId: AllocationDriver;
  system: string;
  operation: string;
  field: string;
  centerKeys: Record<ID, string>;
  updatedAt: ISODate;
  updatedBy: ID;
}

export interface AllocationResultCell {
  poolId: ID;
  unitId: ID;
  amount: number;
  driverValue: number;
  sharePct: number; // доля единицы в итоговом распределении пула, %
}

/** Вторичное распределение между центрами (step-down / взаимный метод). */
export interface AllocationFlow {
  from: ID;
  to: ID;
  amount: number;
}

export interface AllocationRun {
  id: ID;
  number: string;
  period: string; // 2026-Q1
  createdAt: ISODate;
  userId: ID;
  method: AllocationMethod;
  chain: ID[];
  rules: { poolId: ID; driver: AllocationDriver }[];
  cells: AllocationResultCell[];
  flows: AllocationFlow[];
  total: number;
  /** Взаимный метод: итерации сходимости (Якоби) и погрешность матричного решения. */
  iterations?: number;
  residual?: number;
}

export interface AllocationUnitTotal {
  unitId: ID;
  amount: number;
  sharePct: number;
}

export interface AllocationOverview {
  periods: string[];
  lastRun?: AllocationRun;
  poolTotalLatest: number;
  runs: number;
  closedPeriods: string[];
  method: AllocationMethod;
}

export type AllocationGlCategory = 'payroll' | 'depreciation' | 'taxes' | 'other';

/** Обороты бухгалтерских счетов расходов (iABS) в разрезе сотрудника/подразделения/ЦБУ. */
export interface AllocationGlEntry {
  id: ID;
  period: string;
  account: string;
  category: AllocationGlCategory;
  poolId: ID;
  departmentId: ID;
  orgUnitKey: string;
  employee?: string;
  amount: number;
}

export interface AllocationGlLoad {
  period: string;
  at: ISODate;
  userId: ID | 'system';
  exchangeId?: ID;
  entries: number;
  total: number;
}

export interface AllocationSnapshot {
  period: string;
  closedAt: ISODate;
  closedBy: ID;
  runId: ID;
  runNumber: string;
  settings: AllocationSettings;
  rules: AllocationRule[];
  drivers: AllocationDriverDef[];
  centers: AllocationCenter[];
  pools: AllocationPool[];
  poolAmounts: Record<ID, number>;
  driverValues: Record<ID, Record<AllocationDriver, number>>;
  mapping: AllocationMapping[];
  total: number;
}

export interface AllocationScenario {
  id: ID;
  name: string;
  poolPct: Record<ID, number>;
  driverPct: Record<AllocationDriver, number>;
  method?: AllocationMethod;
  createdBy: ID;
  createdAt: ISODate;
}

export interface AllocationWhatIfRow {
  unitId: ID;
  base: number;
  scenario: number;
  delta: number;
  income: number;
  profitBase: number;
  profitScenario: number;
}

export interface AllocationWhatIfProduct {
  productId: ID;
  name: Localized;
  base: number;
  scenario: number;
  delta: number;
}

export interface AllocationWhatIf {
  period: string;
  base: AllocationRun;
  scenario: AllocationRun;
  units: AllocationWhatIfRow[];
  products: AllocationWhatIfProduct[];
}

/** Косвенные затраты для расчёта себестоимости продуктов (модуль анализа операций). */
export interface AllocationCostingFeed {
  period: string;
  runId?: ID;
  runNumber?: string;
  source: 'run' | 'preview';
  method: AllocationMethod;
  /** Бизнес-центр → категория пула → сумма. */
  byUnit: { unitId: ID; ftpUnitId?: ID; total: number; byCategory: Record<AllocationPoolCategory, number> }[];
  total: number;
}
