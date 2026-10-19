// Типы модуля «Налоги и налогообложение» (ТЗ 4.2.17).
import type { HistoryEvent, ID, ISODate, Localized } from '../../types';

export type TaxType = 'vat' | 'profit' | 'property' | 'social' | 'pit' | 'withholding' | 'land' | 'water' | 'rent_pit';
export type TaxPeriodicity = 'monthly' | 'quarterly';
export type TaxReturnStatus = 'draft' | 'calculated' | 'submitted' | 'accepted';

/** Настройки налога (демо-значения, не являются нормативной справкой). */
export interface TaxSetting {
  type: TaxType;
  rate: number; // %
  factor: number; // доля годовой ставки за период (налог на имущество: 0.25 — квартальный авансовый платёж)
  periodicity: TaxPeriodicity;
  dueDay: number; // число месяца, следующего за периодом
  baseHint: Localized;
}

export interface TaxBaseLine {
  label: Localized;
  amount: number;
  /** Филиал (ключ оргединицы: HO, R01…R14) — разрез по филиалам (PR-TAX-036). */
  branchKey?: string;
  /** Налог по строке, если ставка различается по объектам (имущество 1,5%/3%, земля за га, вода за м³). */
  tax?: number;
  /** Ссылка на объект реестра (кадастровый номер, договор, филиал). */
  ref?: string;
  /** Единица базы: сумма (по умолчанию), м² (земля), м³ (вода). */
  unit?: 'uzs' | 'm2' | 'm3';
}

export interface TaxCalculation {
  base: number;
  rate: number;
  factor: number;
  gross: number; // база × ставка × коэффициент
  credits: number; // зачёт (входящий НДС, уплаченные авансы и т. п.)
  amount: number; // к уплате = max(0, gross − credits)
  calculatedAt: ISODate;
}

export interface TaxPayment {
  date: ISODate;
  amount: number;
  reference: string;
}

export interface TaxReturn {
  id: ID;
  number: string;
  type: TaxType;
  period: string; // 2026-09 или 2026-Q3
  dueDate: ISODate;
  status: TaxReturnStatus;
  baseLines: TaxBaseLine[];
  credits: number;
  creditsLabel?: Localized;
  calc?: TaxCalculation;
  payments: TaxPayment[];
  history: HistoryEvent[];
  /** Источник строк базы: ручной ввод или автоматически из реестров/ABS (PR-TAX-001, PR-TAX-009). */
  source?: 'manual' | 'registry';
  /** Отправка файла в налоговый орган через интеграционную шину (PR-TAX-042, PR-TAX-054). */
  filing?: { exchangeId: string; status: string; fileName: string; at: ISODate; receipt?: string };
}

export interface TaxReturnView extends TaxReturn {
  base: number;
  amount: number; // к уплате по последнему расчёту (0, если не рассчитан)
  paid: number;
  outstanding: number;
  overdue: boolean;
  daysLeft: number; // до срока (отрицательное — просрочено)
}

export interface TaxOverview {
  dueThisMonth: { count: number; amount: number };
  overdue: number;
  liabilityYtd: number;
  paidYtd: number;
  outstanding: number;
}

// ---------------------------------------------------------------------------------------------
// Реестры налоговой базы (ТЗ 4.2.17.2–4.2.17.6)

export type TaxRateTax = 'property' | 'property_construction' | 'land' | 'water_surface' | 'water_underground' | 'pit_rent' | 'vat' | 'profit';
export type TaxRateKind = 'percent' | 'per_ha' | 'per_m3';
export type TaxRateSource = 'tax_code' | 'budget_law' | 'kengash';

/** Ставка налога с периодом действия (PR-TAX-030…035). regionCode '*' — для всех регионов. */
export interface TaxRate {
  id: ID;
  tax: TaxRateTax;
  kind: TaxRateKind;
  value: number;
  regionCode: string;
  source: TaxRateSource;
  docRef: string;
  validFrom: ISODate;
  validTo?: ISODate;
  createdBy?: ID;
}

/** Объект недвижимости (счёт 16509) или незавершённого строительства (16505). */
export interface TaxPropertyObject {
  id: ID;
  cadastralNo: string;
  name: Localized;
  branchKey: string;
  address: string;
  account: '16509' | '16505';
  areaM2: number;
  zone: 'A' | 'B' | 'C';
  /** Связь с карточкой модуля ОС (PR-TAX-058). */
  assetId?: ID;
  initialCost: number;
  monthlyDepreciation: number;
  /** Накопленная амортизация на 01.01 отчётного года. */
  accumulatedAtYearStart: number;
  acquiredAt: ISODate;
  disposedAt?: ISODate;
  /** Минимальная стоимость с my.soliq.uz (PR-TAX-002, PR-TAX-017). */
  minValue?: number;
  minValueAt?: ISODate;
  /** НЗС: начало строительства, нормативный срок (мес.), дата ввода (PR-TAX-052). */
  constructionStart?: ISODate;
  normativeMonths?: number;
  completedAt?: ISODate;
  /** Последняя загрузка остатков из ABS. */
  absLoadedAt?: ISODate;
  saleEsfId?: ID;
}

export interface TaxPropertyCalc {
  objectId: ID;
  residualNow: number;
  avgResidual: number;
  minValue: number;
  base: number;
  baseSource: 'abs' | 'soliq';
  rate: number;
  overdue: boolean;
  deadline?: ISODate;
  daysToDeadline?: number;
  annualTax: number;
  months: number;
}

export type TaxLandRight = 'own' | 'possession' | 'use' | 'lease';

export interface TaxLandPlot {
  id: ID;
  cadastralNo: string;
  branchKey: string;
  address: string;
  areaHa: number;
  right: TaxLandRight;
  regionCode: string;
  acquiredAt: ISODate;
  disposedAt?: ISODate;
  cadastreCheckedAt?: ISODate;
}

export type TaxWaterSource = 'surface' | 'underground';
export type TaxWaterMethod = 'meter' | 'invoice' | 'letter';

export interface TaxWaterReading {
  id: ID;
  branchKey: string;
  objectName: string;
  month: string; // 2026-09
  source: TaxWaterSource;
  m3: number;
  method: TaxWaterMethod;
  docRef?: string;
  createdBy?: ID;
}

export type TaxLeaseObjectType = 'residential' | 'non_residential';
export type TaxIjaraStatus = 'registered' | 'not_registered' | 'pending';

export interface TaxLeasePayment {
  month: string;
  rent: number;
  minRent: number;
  base: number;
  pit: number;
  net: number;
  status: 'paid' | 'blocked';
  reference?: string;
  at: ISODate;
}

/** Договор аренды недвижимости у физического лица (PR-TAX-003, PR-TAX-062). */
export interface TaxLease {
  id: ID;
  contractNo: string;
  lessorName: string;
  lessorPinfl: string;
  lessorTin?: string;
  address: string;
  regionCode: string;
  branchKey: string;
  objectType: TaxLeaseObjectType;
  areaM2: number;
  monthlyRent: number;
  startDate: ISODate;
  endDate: ISODate;
  ijara: { status: TaxIjaraStatus; regNo?: string; checkedAt?: ISODate };
  responsibleId: ID;
  source: 'abs' | 'manual';
  payments: TaxLeasePayment[];
}

/** Минимальная ставка арендной платы за 1 м² в месяц (PR-TAX-005, PR-TAX-061). */
export interface TaxMinRent {
  id: ID;
  year: number;
  regionCode: string;
  objectType: TaxLeaseObjectType;
  ratePerM2: number;
}

export type TaxLedgerClass = 'taxable' | 'deductible' | 'non_deductible' | 'non_taxable';

/** Обороты главной книги по филиалу за период (налог на прибыль, PR-TAX-025…028). */
export interface TaxLedgerLine {
  id: ID;
  branchKey: string;
  period: string; // 2026-Q3 (нарастающим итогом с начала года)
  account: string;
  name: Localized;
  kind: 'income' | 'expense';
  amount: number;
  cls: TaxLedgerClass;
}

/** Налоговая льгота по налогу на прибыль (PR-TAX-066). */
export interface TaxBenefit {
  id: ID;
  code: string;
  name: Localized;
  basis: string;
  period: string;
  amount: number;
  branchKey?: string;
  active: boolean;
}

export interface TaxProfitBranchRow {
  branchKey: string;
  income: number;
  nonTaxableIncome: number;
  expense: number;
  nonDeductible: number;
  taxableProfit: number;
  /** Доля налога, покрываемая филиалом (только прибыльные филиалы, PR-TAX-039). */
  share: number;
  tax: number;
}

export interface TaxProfitSummary {
  period: string;
  rows: TaxProfitBranchRow[];
  taxableProfit: number;
  benefits: number;
  base: number;
  rate: number;
  tax: number;
}

/** Ежемесячный авансовый платёж по налогу на прибыль (PR-TAX-049). */
export interface TaxAdvance {
  month: string;
  dueDate: ISODate;
  amount: number;
  paid: number;
  paidAt?: ISODate;
  reference?: string;
}

/** Сверка счетов 19931 (авансы) и 22502 (начислено) — PR-TAX-067. */
export interface TaxRecon19931 {
  period: string;
  advances: number;
  accrued: number;
  difference: number; // > 0 — переплата, < 0 — недоплата
  status: 'open' | 'closed';
  closedAt?: ISODate;
  closedBy?: ID;
  exchangeId?: string;
}

export interface TaxVatTurnover {
  id: ID;
  branchKey: string;
  month: string;
  category: 'rent' | 'collateral' | 'services';
  amount: number;
  inputVat: number;
  source: 'esf' | 'abs';
}

export interface TaxFixedService {
  id: ID;
  code: string;
  name: Localized;
  price: number;
}

export interface TaxServiceClient {
  id: ID;
  name: string;
  tin: string;
  branchKey: string;
  serviceIds: ID[];
}

/** ЭСФ, сформированный автоматически (услуги с фиксированной стоимостью, продажа имущества). */
export interface TaxAutoEsf {
  id: ID;
  number: string;
  kind: 'service' | 'asset_sale';
  month: string;
  clientName: string;
  tin: string;
  branchKey: string;
  net: number;
  vat: number;
  total: number;
  status: 'sent' | 'delivered' | 'failed' | 'queued';
  exchangeId?: string;
  createdAt: ISODate;
  ref?: string;
}

export type TaxBaseChangeKind = 'acquisition' | 'disposal' | 'area_change' | 'min_value' | 'abs_load' | 'rate_change' | 'water' | 'lease' | 'deadline';

/** Журнал мониторинга изменений налоговой базы (PR-TAX-057…060). */
export interface TaxBaseChange {
  id: ID;
  at: ISODate;
  kind: TaxBaseChangeKind;
  tax: TaxType;
  branchKey: string;
  ref: string;
  before: number;
  after: number;
  recalculated: string[]; // номера пересчитанных расчётов
  userId?: ID;
}

/** Строка акта сверки с бюджетом по филиалу (PR-TAX-063). */
export interface TaxActRow {
  tax: TaxType;
  accrued: number;
  paid: number;
  difference: number;
}

export interface TaxReconAct {
  id: string; // ACT-<branch>-<month>
  branchKey: string;
  month: string;
  rows: TaxActRow[];
  accrued: number;
  paid: number;
  difference: number;
}
