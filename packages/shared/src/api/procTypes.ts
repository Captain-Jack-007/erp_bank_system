// P2-PROC: расширенные типы закупок (ТЗ 4.2.1), договоров (4.2.2) и заявок сотрудников на обеспечение (4.2.7).
// Базовые сущности (ProcurementRequest, Contract, EmployeeRequest…) объявлены в ../types.ts и расширяют
// интерфейсы *Extra отсюда — все новые поля необязательны, поэтому mobile и старые данные совместимы.
import type { HistoryEvent, ID, ISODate, Localized } from '../types';

// ---------------------------------------------------------------------------------------------
// Закупки

/** Вид закупки (PR-PROC-002): влияет на маршрут, процесс и форму приёмки. */
export type ProcurementKind = 'goods' | 'services' | 'works';

/** Категория номенклатуры: определяет согласующих (PR-PROC-018), бюджетную статью и процесс. */
export type ProcItemCategory = 'it_hw' | 'software' | 'office' | 'furniture' | 'household' | 'security' | 'vehicles' | 'construction' | 'services' | 'utilities';

/** Позиция номенклатурного справочника закупок (PR-PROC-003). */
export interface ProcCatalogItem {
  id: ID;
  code: string;
  name: Localized;
  kind: ProcurementKind;
  category: ProcItemCategory;
  unit: string;
  /** Справочная (ориентировочная) цена за единицу, UZS — для расчёта стоимости и анализа цен. */
  refPrice: number;
  /** Типовые технические характеристики. */
  spec?: string;
  /** Артикул складской номенклатуры (для автоматического оприходования). */
  warehouseSku?: string;
  budgetLineId?: ID;
  origin?: 'local' | 'import';
  /** Требует монтажа/установки. */
  install?: boolean;
  /** Лицензия/право использования ПО. */
  license?: boolean;
  /** Учитывается как основное средство (иначе МБП/ТМЗ). */
  fixedAsset?: boolean;
  active: boolean;
  /** P4 (PR-MDM-003): статус согласования записи — новая позиция активна только после финального утверждения. */
  mdmStatus?: 'pending' | 'approved' | 'rejected';
  /** P4: заявка MDM на утверждении по этой записи. */
  pendingChangeId?: ID;
}

/** Группа бизнес-плана (PR-PROC-007): объединяет статьи бюджета; у группы — лимит по подразделениям. */
export interface ProcBusinessGroup {
  id: ID;
  code: string;
  name: Localized;
  budgetLineIds: ID[];
}

export interface ProcVerificationCheck {
  code: string;
  ok: boolean;
  severity: 'error' | 'warning';
  detail?: string;
}

/** Результат верификации заявки (PR-PROC-013). */
export interface ProcVerification {
  at: ISODate;
  by: ID;
  ok: boolean;
  checks: ProcVerificationCheck[];
}

/** Уровень приёма заявки ЦБУ: областной региональный центр → центральный аппарат → согласование (PR-PROC-021/022). */
export type ProcIntake = 'region' | 'central' | 'approval';

export type ExchangeLotStatus = 'submitted' | 'trading' | 'won' | 'failed';

/** Биржевая закупка через УзРТСБ (PR-PROC-027…032). */
export interface ProcExchangeLot {
  lotNo?: string;
  status: ExchangeLotStatus;
  submittedAt: ISODate;
  syncedAt?: ISODate;
  exchangeId?: ID;
  startPrice: number;
  /** Результаты торгов. */
  winnerId?: ID;
  winnerTin?: string;
  price?: number;
  contractId?: ID;
  /** Аванс (гарантийный взнос), перечисленный на биржу — запись «прочие дебиторские платежи». */
  advanceContractId?: ID;
}

export interface ProcurementExtra {
  kind?: ProcurementKind;
  /** МВЗ (бизнес-ключ), на который относятся расходы (PR-PROC-009). */
  costCenterKey?: string;
  businessGroupId?: ID;
  /** Филиал/ЦБУ инициатора (orgBranchOf); HO — центральный аппарат. */
  branchKey?: string;
  intake?: ProcIntake;
  /** Причина возврата на доработку (областной центр / центральный аппарат). */
  returnReason?: string;
  verification?: ProcVerification;
  /** Заявка включена в сводную закупку. */
  consolidationId?: ID;
  /** Сводная (консолидированная) закупка: из каких заявок собрана. */
  consolidatedFrom?: ID[];
  exchange?: ProcExchangeLot;
  /** Подписи E-IMZO заявки (signatureService). */
  signatureIds?: ID[];
  /** Ключ вложений (ТЗ, спецификации), загруженных в форме до создания заявки. */
  attachmentKey?: string;
}

export type ConsolidationLevel = 'region' | 'central';
export type ConsolidationStatus = 'sent' | 'accepted' | 'returned' | 'purchased' | 'distributed';

export interface ProcDistributionLine {
  requestId: ID;
  branchKey: string;
  itemName: string;
  unit: string;
  qty: number;
  warehouseId: string;
  status: 'planned' | 'done';
  movementId?: ID;
}

/** Сводная заявка: региональная (обобщение заявок ЦБУ) или центральная (консолидированная закупка). */
export interface ProcConsolidation {
  id: ID;
  number: string;
  level: ConsolidationLevel;
  /** Ключ регионального филиала (для level = region). */
  regionKey?: string;
  title: string;
  requestIds: ID[];
  status: ConsolidationStatus;
  /** Сводная закупка (для level = central). */
  resultRequestId?: ID;
  createdBy: ID;
  createdAt: ISODate;
  decidedBy?: ID;
  decidedAt?: ISODate;
  returnReason?: string;
  distribution?: ProcDistributionLine[];
  history: HistoryEvent[];
}

export interface TenderExtra {
  platform?: 'etender' | 'xarid';
  externalId?: string;
  publishedAt?: ISODate;
  exchangeId?: ID;
  /** Тендерная документация: требования и критерии (передаётся на площадку). */
  docs?: { requirements: string; criteria: string; sentAt?: ISODate };
  /** Источник предложений: площадка или ручной ввод. */
  bidSources?: Record<ID, 'platform' | 'manual'>;
  resultsAt?: ISODate;
}

// ---------------------------------------------------------------------------------------------
// Поставщики

export interface CounterpartyExtra {
  director?: string;
  vatPayer?: boolean;
  bankName?: string;
  bankAccount?: string;
  mfo?: string;
  /** SWIFT/BIC и IBAN — для иностранных поставщиков. */
  swiftBic?: string;
  iban?: string;
  soliqSyncedAt?: ISODate;
  /** Статус налогоплательщика по данным ГНК. */
  taxStatus?: 'active' | 'suspended' | 'liquidated';
  /** Сведения с биржевых и тендерных площадок. */
  platformStats?: { lots: number; wins: number; syncedAt: ISODate };
}

export type SupplierCheckList = 'blacklist' | 'sanctions' | 'internal_control' | 'suspicious_tax' | 'debts';

export interface SupplierCheckResult {
  id: ID;
  counterpartyId: ID;
  at: ISODate;
  by: ID;
  results: { list: SupplierCheckList; hit: boolean; detail?: string }[];
  /** Итог: допускается ли к закупкам. */
  passed: boolean;
}

/** Запись внутреннего «чёрного списка» / санкционного списка (локальная копия). */
export interface SupplierListEntry {
  tin: string;
  name: string;
  list: 'blacklist' | 'sanctions' | 'suspicious_tax';
  reason: string;
  since: ISODate;
}

// ---------------------------------------------------------------------------------------------
// Приёмка товаров и услуг

export interface AcceptanceLine {
  name: string;
  catalogId?: ID;
  warehouseSku?: string;
  unit: string;
  orderedQty: number;
  deliveredQty: number;
  acceptedQty: number;
  unitPrice: number;
  /** Соответствие спецификации (PR-PROC-060). */
  specOk: boolean;
  quality: 'ok' | 'defect';
  note?: string;
}

export type AcceptanceStatus = 'draft' | 'accepted' | 'received';

/** Акт приёмки товаров (PR-PROC-058…069). */
export interface ProcAcceptance {
  id: ID;
  number: string;
  contractId: ID;
  requestId?: ID;
  date: ISODate;
  warehouseId: string;
  lines: AcceptanceLine[];
  status: AcceptanceStatus;
  /** Счёт-фактура поставщика (PR-PROC-063). */
  einvoiceId?: ID;
  costCenterKey?: string;
  /** Кто нажал «Принял» (подразделение-заявитель или завсклад). */
  acceptedBy?: ID;
  acceptedAt?: ISODate;
  movementIds?: ID[];
  /** Приходный ордер склада (М-4), созданный по «Принял»; его проводки ведёт модуль «Склад» (PR-PROC-065/066). */
  receiptId?: ID;
  postingId?: ID;
  claimIds?: ID[];
  createdBy: ID;
  createdAt: ISODate;
  history: HistoryEvent[];
}

export type ClaimType = 'shortage' | 'quality' | 'spec' | 'delay' | 'defect';
export type ClaimStatus = 'open' | 'sent' | 'satisfied' | 'rejected' | 'closed';

/** Претензия поставщику (PR-PROC-062, PR-CON-030). */
export interface ProcClaim {
  id: ID;
  number: string;
  counterpartyId: ID;
  contractId: ID;
  acceptanceId?: ID;
  actId?: ID;
  type: ClaimType;
  description: string;
  amount: number;
  dueDate: ISODate;
  status: ClaimStatus;
  response?: string;
  createdBy: ID;
  createdAt: ISODate;
  history: HistoryEvent[];
}

export interface WorkActLine {
  description: string;
  unit: string;
  qty: number;
  unitPrice: number;
}

export type WorkActStatus = 'draft' | 'pending' | 'approved' | 'signed' | 'sent' | 'completed' | 'rejected';

export interface WorkActDefect {
  id: ID;
  description: string;
  dueDate: ISODate;
  status: 'open' | 'fixed';
  fixedAt?: ISODate;
  /** Номер акта об устранении недостатков. */
  fixActNumber?: string;
}

/** Акт выполненных работ / оказанных услуг (PR-PROC-070…082). */
export interface ProcWorkAct {
  id: ID;
  number: string;
  contractId: ID;
  requestId?: ID;
  periodFrom: ISODate;
  periodTo: ISODate;
  description: string;
  lines: WorkActLine[];
  vatRate: number;
  costCenterKey?: string;
  status: WorkActStatus;
  einvoiceId?: ID;
  customerSignatureId?: ID;
  /** Подпись исполнителя (через оператора ЭДО Didox) — двустороннее подписание. */
  contractorSigned?: { at: ISODate; name: string; extId: string };
  platformExchangeId?: ID;
  quality?: { score: number; comment: string; by: ID; at: ISODate };
  defects: WorkActDefect[];
  postingId?: ID;
  createdBy: ID;
  createdAt: ISODate;
  history: HistoryEvent[];
}

// ---------------------------------------------------------------------------------------------
// Бухгалтерские проводки (PR-PROC-039/040/057/066, PR-CON-044/050)

export interface PostingEntry {
  debit: string;
  credit: string;
  amount: number;
  purpose: string;
}

export type PostingSource = 'contract' | 'receipt' | 'act' | 'payment' | 'advance' | 'reserve' | 'reserve_reversal' | 'writeoff' | 'income' | 'schedule';
export type PostingStatus = 'draft' | 'signed' | 'sent' | 'posted' | 'failed';

export interface ProcPosting {
  id: ID;
  number: string;
  date: ISODate;
  source: PostingSource;
  docKind: 'contract' | 'acceptance' | 'act' | 'payment_order' | 'reserve' | 'platform';
  docId: ID;
  docNumber: string;
  contractId?: ID;
  entries: PostingEntry[];
  costCenterKey?: string;
  status: PostingStatus;
  signatureId?: ID;
  exchangeId?: ID;
  createdBy: ID;
  createdAt: ISODate;
}

// ---------------------------------------------------------------------------------------------
// Электронные договоры с платформ Soliqservis (Didox, Factura.uz, my.soliq.uz)

export type PlatformName = 'didox' | 'factura' | 'soliq';
export type PlatformContractStatus = 'incoming' | 'signed' | 'rejected' | 'sent' | 'counter_signed';

export interface PlatformContract {
  id: ID;
  platform: PlatformName;
  extId: string;
  direction: 'in' | 'out';
  number: string;
  date: ISODate;
  counterpartyTin: string;
  counterpartyName: string;
  subject: string;
  amount: number;
  status: PlatformContractStatus;
  contractId?: ID;
  signatureId?: ID;
  rejectReason?: string;
  receivedAt: ISODate;
}

// ---------------------------------------------------------------------------------------------
// Договоры

/** Виды договоров (меню ТЗ 4.2.2.1). */
export type ContractKind = 'services' | 'long_term' | 'fixed_assets' | 'utilities' | 'other_receivables' | 'rent' | 'construction' | 'swift' | 'bank_services';

export type ContractSubkind =
  // аренда
  | 'building_legal' | 'building_individual' | 'atm_legal' | 'atm_individual' | 'housing'
  // коммунальные
  | 'gas' | 'electricity' | 'water' | 'waste' | 'heating'
  // строительство
  | 'construction' | 'current_repair' | 'capital_repair'
  // услуги банка
  | 'property_sale' | 'bank_service'
  // прочие
  | 'invoice' | 'exchange_advance';

export type PaymentTermsType = 'full' | 'advance' | 'periodic' | 'by_invoice' | 'by_act';

export interface ContractPaymentTerms {
  type: PaymentTermsType;
  advancePct?: number;
  periodicity?: 'monthly' | 'quarterly';
}

export type ContractStageStatus = 'planned' | 'done';

/** Этап/обязательство по договору (PR-CON-026/027/033). */
export interface ContractStage {
  id: ID;
  name: string;
  obligation: 'delivery' | 'works' | 'acceptance' | 'payment' | 'other';
  dueDate: ISODate;
  amount?: number;
  status: ContractStageStatus;
  doneAt?: ISODate;
  /** Документ-основание исполнения (акт приёмки / акт работ). */
  docRef?: string;
}

/** Применённая санкция (неустойка/пеня) — PR-CON-030. */
export interface ContractSanction {
  id: ID;
  stageId?: ID;
  days: number;
  base: number;
  amount: number;
  at: ISODate;
  by: ID;
  claimId?: ID;
  status: 'calculated' | 'claimed' | 'paid' | 'waived';
}

export type ReserveClass = 'standard' | 'substandard' | 'unsatisfactory' | 'doubtful' | 'bad';

/** Резерв на возможные убытки по просроченной дебиторской задолженности (Положение № 2696) — PR-CON-040/041. */
export interface ContractReserve {
  classification: ReserveClass;
  pct: number;
  base: number;
  amount: number;
  overdueDays: number;
  updatedAt: ISODate;
  /** Списано на внебалансовый счёт (безнадёжная задолженность). */
  writtenOff?: { at: ISODate; amount: number };
  /** Погашения после списания (мониторинг). */
  recoveries?: { at: ISODate; amount: number }[];
  history: { at: ISODate; action: 'create' | 'increase' | 'decrease' | 'reverse' | 'writeoff' | 'recovery'; amount: number; classification: ReserveClass }[];
}

export interface ContractExtra {
  kind?: ContractKind;
  subkind?: ContractSubkind;
  paymentTerms?: ContractPaymentTerms;
  /** Подразделения-инициаторы (несколько), основное — departmentId (PR-CON-019/020). */
  initiatorDeptIds?: ID[];
  costCenterKey?: string;
  source?: 'request' | 'manual' | 'tender' | 'exchange' | 'platform' | 'import';
  templateId?: ID;
  /** Текст договора, сформированный по шаблону с подстановкой реквизитов (PR-CON-021/022). */
  text?: string;
  stages?: ContractStage[];
  /** Неустойка: % в день от просроченной суммы и предел, % от суммы договора. */
  penalty?: { ratePerDay: number; capPct: number };
  sanctions?: ContractSanction[];
  reserve?: ContractReserve;
  /** Прочие дебиторские платежи без договора: инвойс-основание (PR-CON-010). */
  invoiceRef?: { number: string; date: ISODate };
  /** Объект аренды / адрес / лицевой счёт коммунальных услуг. */
  objectInfo?: string;
  /** Электронный договор на платформе (Didox и др.). */
  platform?: { name: PlatformName; extId: string; status: PlatformContractStatus; exchangeId?: ID };
  signatureIds?: ID[];
  /** Доходный договор (услуги/имущество банка): поступления от покупателя. */
  receipts?: { at: ISODate; amount: number; einvoiceId?: ID }[];
}

export interface ContractPaymentExtra {
  kind?: 'advance' | 'final' | 'periodic' | 'by_invoice' | 'by_act';
  einvoiceId?: ID;
  orderId?: ID;
  paidAt?: ISODate;
  note?: string;
}

/** Шаблон договора (PR-CON-021): текст с подстановками {{number}}, {{counterparty}}, {{amount}}… */
export interface ContractTemplate {
  id: ID;
  kind: ContractKind;
  name: Localized;
  body: string;
  defaultTerms: ContractPaymentTerms;
  penalty: { ratePerDay: number; capPct: number };
}

/** Счёт плана счетов (демо) для настройки расчётов по договорам (PR-CON-034). */
export interface ContractAccount {
  code: string;
  name: Localized;
  type: 'receivable' | 'payable' | 'expense' | 'income' | 'asset' | 'cash' | 'offbalance' | 'reserve';
}

/** Настройка вида договора: счета и условия по умолчанию (PR-CON-036). */
export interface ContractKindSetting {
  kind: ContractKind;
  advanceAccount: string;
  payableAccount: string;
  expenseAccount: string;
  defaultTerms: ContractPaymentTerms;
  active: boolean;
}

export type PaymentOrderStatus = 'draft' | 'pending' | 'approved' | 'signed' | 'sent' | 'executed' | 'rejected' | 'failed';

/** Платёжное поручение по договору (PR-CON-045…049). */
export interface PaymentOrder {
  id: ID;
  number: string;
  contractId: ID;
  paymentIndex?: number;
  date: ISODate;
  amount: number;
  currency: 'UZS' | 'USD' | 'EUR';
  purpose: string;
  type: 'domestic' | 'swift';
  basis: 'schedule' | 'einvoice' | 'act' | 'advance' | 'manual';
  einvoiceId?: ID;
  actId?: ID;
  beneficiary: { name: string; tin: string; account: string; mfo: string; bank: string; swiftBic?: string; iban?: string };
  payerAccount: string;
  status: PaymentOrderStatus;
  signatureId?: ID;
  exchangeId?: ID;
  postingId?: ID;
  costCenterKey?: string;
  auto?: boolean;
  createdBy: ID;
  createdAt: ISODate;
  history: HistoryEvent[];
}

/** Пользовательская форма отчёта по договорам (PR-CON-038). */
export interface ContractReportForm {
  id: ID;
  name: string;
  columns: string[];
  kind?: ContractKind | '';
  status?: string;
  groupBy?: 'kind' | 'department' | 'counterparty' | '';
  createdBy: ID;
  createdAt: ISODate;
}

// ---------------------------------------------------------------------------------------------
// Заявки сотрудников на обеспечение (ТЗ 4.2.7)

export interface SupplyItem {
  warehouseItemId?: ID;
  sku?: string;
  name: string;
  unit: string;
  qty: number;
  unitCost: number;
  reservedQty?: number;
  issuedQty?: number;
  /** Номер движения склада «выдача». */
  movementId?: ID;
}

export interface EmployeeRequestExtra {
  items?: SupplyItem[];
  departmentId?: ID;
  costCenterKey?: string;
  amount?: number;
  budgetLineId?: ID;
  warehouseId?: string;
  signatureIds?: ID[];
  /** Получатель подтвердил получение («Принял»). */
  receivedAt?: ISODate;
  receivedBy?: ID;
  /** Исполнитель услуги отметил оказание. */
  serviceDoneAt?: ISODate;
  returnReason?: string;
}
