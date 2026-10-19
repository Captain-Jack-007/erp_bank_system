// Типы модуля «Трансфертное ценообразование (FTP)» (ТЗ 4.2.15).
// Границы с КХД (4.2.15.0): ставки и результаты FTP по кредитам и депозитам приходят из КХД готовыми —
// модуль принимает, проверяет, сверяет, версионирует и применяет их; собственный расчёт — контрольный и сценарный.
import type { ID, ISODate, Localized } from '../../types';

export type FtpCurrency = 'UZS' | 'USD' | 'EUR' | 'RUB' | 'CNY' | 'GBP' | 'KZT';
export type FtpSide = 'asset' | 'liability';
export type FtpInterpolation = 'linear' | 'cubic' | 'flat';
export type FtpCurveSource = 'manual' | 'khd' | 'import' | 'market';

export interface FtpCurvePoint {
  tenorMonths: number;
  label: string; // O/N, 1W, 1M, 3M, 1Y…
  rate: number; // % годовых
}

/** Кривая, действующая на дату (представление версии). */
export interface FtpCurve {
  currency: FtpCurrency;
  asOf: ISODate; // дата начала действия версии
  points: FtpCurvePoint[];
  interpolation: FtpInterpolation;
  versionId: ID;
  version: number;
  source: FtpCurveSource;
}

export type FtpCurveVersionStatus = 'active' | 'draft' | 'archived';

/** Версия кривой с датой вступления в силу — история кривых для расчёта на любую дату (PR-FTP-006). */
export interface FtpCurveVersion {
  id: ID;
  currency: FtpCurrency;
  version: number;
  validFrom: ISODate;
  points: FtpCurvePoint[];
  interpolation: FtpInterpolation;
  source: FtpCurveSource;
  status: FtpCurveVersionStatus;
  note: string;
  createdBy: ID | 'system';
  createdAt: ISODate;
}

export interface FtpCurveChange {
  at: ISODate;
  userId: ID;
  currency: FtpCurrency;
  label: string;
  from: number;
  to: number;
}

export interface FtpBusinessUnit {
  id: ID;
  name: Localized;
  departmentId: ID;
}

/** Категория обязательства для LCR (коэффициент оттока). */
export type FtpLcrCategory = 'retail_stable' | 'retail_less_stable' | 'corp_operational' | 'corp_non_operational' | 'financial' | 'none';

export interface FtpProduct {
  id: ID;
  name: Localized;
  side: FtpSide;
  currency: FtpCurrency;
  unitId: ID;
  balance: number; // остаток в эквиваленте UZS
  tenorMonths: number; // срок для подбора ставки по кривой (matched maturity)
  clientRate: number; // % годовых
  lcrCategory?: FtpLcrCategory;
  /** Ставка досрочного погашения в год, % (опцион клиента — Optionality Effect). */
  prepaymentPct?: number;
  accountCode?: string;
}

/** Расчёт по продукту: ставка FTP, маржа, вклад в чистый процентный доход (годовой). */
export interface FtpProductResult extends FtpProduct {
  /** Базовая ставка: кривая на срок (matched maturity) или единая ставка пула (single pool) + сдвиг сценария. */
  curveRate: number;
  /** Надбавка за ликвидность (Liquidity Premium), п.п. */
  lp: number;
  /** Регуляторные компоненты (ФОР, LCR) для обязательств, п.п. (уменьшают кредит за привлечение). */
  reg: number;
  reserveCost: number;
  lcrCost: number;
  /** Корректировки правил применения (филиал/направление/валюта/срок), п.п. */
  adj: number;
  /** Итоговая ставка FTP. */
  ftpRate: number;
  margin: number; // актив: клиентская − FTP; пассив: FTP − клиентская
  clientNii: number; // маржинальный доход направления, UZS/год
  ftpCharge: number; // актив: плата за фондирование; пассив: кредит за привлечение (UZS/год)
  rules: ID[];
}

export interface FtpUnitResult {
  unitId: ID;
  assets: number;
  liabilities: number;
  clientNii: number; // доход от клиентской маржи
  fundingNii: number; // для центра фондирования (казначейство) — маржа несовпадения сроков
  totalNii: number;
  clientMarginPct: number; // клиентская маржа к среднему балансу, %
  fundingMarginPct: number;
  nimPct: number;
  ftpIncome: number; // кредит за привлечённые ресурсы
  ftpExpense: number; // плата за размещённые ресурсы
  liquidityCost: number; // ФОР + LCR по обязательствам направления, UZS/год
  lpCharge: number; // надбавка за ликвидность по активам, UZS/год
}

export interface FtpAccountResult {
  code: string;
  name: Localized;
  side: FtpSide;
  currency: FtpCurrency;
  unitId: ID;
  balance: number;
  wal: number; // средневзвешенный срок, мес.
  rate: number;
}

export interface FtpLiquiditySummary {
  hqla: number;
  hqlaL1: number;
  hqlaL2: number;
  outflows: number;
  inflows: number;
  nco: number;
  lcrPct: number;
  reserveCost: number; // UZS/год
  lcrCost: number; // UZS/год
  lpCost: number; // UZS/год
}

export interface FtpResults {
  shiftBp: number;
  asOf: ISODate;
  methodologyId: ID;
  methodologyVersion: number;
  method: FtpMethod;
  products: FtpProductResult[];
  units: FtpUnitResult[];
  accounts: FtpAccountResult[];
  liquidity: FtpLiquiditySummary;
  bank: { assets: number; liabilities: number; nii: number; clientNii: number; fundingNii: number; nimPct: number };
}

// ---------- Методологии (4.2.15.2) ----------

export type FtpMethod = 'matched_maturity' | 'single_pool';
export type FtpMethodologyStatus = 'draft' | 'approved' | 'retired';

export interface FtpMethodologyVersion {
  version: number;
  validFrom: ISODate;
  method: FtpMethod;
  /** Единая ставка пула по валютам (single pool), %. */
  poolRates: Partial<Record<FtpCurrency, number>>;
  includeLp: boolean;
  includeRegulatory: boolean;
  applyRules: boolean;
  status: FtpMethodologyStatus;
  note: string;
  createdBy: ID;
  createdAt: ISODate;
  approvedBy?: ID;
  approvedAt?: ISODate;
}

export interface FtpMethodology {
  id: ID;
  code: string;
  name: Localized;
  versions: FtpMethodologyVersion[];
}

// ---------- Регуляторные параметры (4.2.15.3) ----------

export interface FtpRegParams {
  version: number;
  validFrom: ISODate;
  /** Нормативы обязательных резервов, %: до 1 года и свыше. */
  reserve: Partial<Record<FtpCurrency, { short: number; long: number }>>;
  reserveRemuneration: number; // % годовых на резервы в ЦБ
  lcrMin: number; // норматив LCR, %
  runoff: Record<FtpLcrCategory, number>; // коэффициенты оттока, %
  haircut: { l1: number; l2a: number; l2b: number }; // дисконты HQLA, %
  l2Cap: number; // лимит активов 2-го уровня, % HQLA
  hqlaYield: number; // доходность HQLA, % (стоимость поддержания запаса = ставка 1Y − доходность)
  inflowCap: number; // ограничение притоков, % оттоков
  note: string;
  createdBy: ID;
  createdAt: ISODate;
}

export type FtpHqlaLevel = 'l1' | 'l2a' | 'l2b';
export interface FtpHqlaItem {
  id: ID;
  name: Localized;
  level: FtpHqlaLevel;
  amount: number;
}

// ---------- Надбавки за ликвидность и правила применения ставок ----------

export interface FtpLpPoint {
  tenorMonths: number;
  label: string;
  bp: number;
}

export interface FtpRateRule {
  id: ID;
  name: string;
  active: boolean;
  priority: number;
  currency?: FtpCurrency;
  branchKey?: string; // R01…R14
  unitId?: ID;
  side?: FtpSide;
  tenorFrom?: number;
  tenorTo?: number;
  kind: 'adjust' | 'fixed';
  value: number; // adjust — б.п., fixed — % годовых
  validFrom: ISODate;
  createdBy: ID;
  updatedAt: ISODate;
}

export interface FtpRateQuery {
  currency: FtpCurrency;
  side: FtpSide;
  tenorMonths: number;
  unitId?: ID;
  branchKey?: string;
  asOf?: ISODate;
  methodologyId?: ID;
  lcrCategory?: FtpLcrCategory;
}

export interface FtpRateBreakdown {
  base: number;
  baseLabel: string;
  lp: number;
  reserveCost: number;
  lcrCost: number;
  rules: { id: ID; name: string; kind: 'adjust' | 'fixed'; value: number }[];
  adj: number;
  rate: number;
  curveVersion?: number;
  methodology: string;
}

export interface FtpBranchRow {
  branchKey: string;
  assets: number;
  liabilities: number;
  ftpExpense: number;
  ftpIncome: number;
  clientNii: number;
  avgAssetFtp: number;
  avgLiabFtp: number;
}

// ---------- Расчёты и история (4.2.15.4) ----------

export type FtpRunKind = 'daily' | 'monthly' | 'adhoc';

export interface FtpRun {
  id: ID;
  number: string;
  asOf: ISODate;
  kind: FtpRunKind;
  methodologyId: ID;
  methodologyVersion: number;
  curveVersions: Record<string, number>;
  regVersion: number;
  bank: FtpResults['bank'];
  units: { unitId: ID; totalNii: number; ftpIncome: number; ftpExpense: number }[];
  productRates: { id: ID; ftpRate: number; ftpCharge: number }[];
  createdAt: ISODate;
  userId: ID | 'system';
  status: 'current' | 'superseded';
  rerunOf?: ID;
  reason?: string;
}

export interface FtpSchedule {
  daily: boolean;
  monthly: boolean;
  dailyTime: string;
  updatedAt: ISODate;
  updatedBy: ID | 'system';
}

// ---------- Приём из КХД (4.2.15.0) ----------

export type FtpKhdKind = 'results' | 'rates';
export type FtpKhdStatus = 'received' | 'validated' | 'errors' | 'reconciled' | 'accepted' | 'rejected' | 'superseded';

export interface FtpKhdRow {
  key: string; // productId или currency:label
  productId?: ID;
  unitId?: ID;
  currency: FtpCurrency;
  balance?: number;
  ftpRate: number;
  ftpCharge?: number;
  label?: string;
  tenorMonths?: number;
}

export interface FtpKhdIssue {
  row: number;
  field: string;
  code: 'required' | 'range' | 'duplicate' | 'unknown' | 'control_total';
  message: Localized;
}

export interface FtpKhdBatch {
  id: ID;
  number: string;
  kind: FtpKhdKind;
  period: string; // 2026-09
  version: number;
  receivedAt: ISODate;
  exchangeId?: ID;
  status: FtpKhdStatus;
  rows: FtpKhdRow[];
  control: { rows: number; balance: number; charge: number };
  issues: FtpKhdIssue[];
  recon?: { tolerance: number; matched: number; diffs: { key: string; khdRate: number; ctrlRate: number; diffBp: number; flagged: boolean }[]; checkedAt: ISODate };
  userId: ID | 'system';
  decidedBy?: ID;
  decidedAt?: ISODate;
  comment?: string;
}
