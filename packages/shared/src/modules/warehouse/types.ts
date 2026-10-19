// Типы модуля «Склад» (ТЗ 4.2.4) и подмодуля «Учёт МБП» (ТЗ 4.2.4.4).
import type { HistoryEvent, ID, ISODate, Localized } from '../../types';

/** Категория номенклатуры (укрупнённо, для фильтров и дашборда). Определяется группой карточки. */
export type WarehouseCategory = 'office' | 'it' | 'forms' | 'household' | 'security' | 'mbp' | 'fixed';
export type WarehouseMovementType = 'receipt' | 'issue' | 'transfer' | 'writeoff';
/** Вид учёта группы: ТМЗ (расход на затраты), МБП (выдача в эксплуатацию → внебаланс), ОС (приёмка в модуль ОС). */
export type WarehouseGroupKind = 'tmz' | 'mbp' | 'fa';

/** Настройки склада (PR-WMS-040): порог залежалости, дней — общий и по категориям; горизонт срока годности, дней. */
export interface WarehouseSettings {
  staleDays: number;
  staleByCategory: Partial<Record<WarehouseCategory, number>>;
  expiryWarnDays: number;
}

export interface WarehouseLocation {
  id: ID;
  code: string;
  name: string;
  city: string;
  kind: 'central' | 'regional';
  /** Заведующий складом (кладовщик). */
  managerId: ID;
  /** Закреплённый руководитель (подписывает расход). */
  headId: ID;
  /** Оргединица (подразделение/филиал) и МВЗ склада. */
  orgUnitKey: string;
  costCenterId: string;
}

/** Группа ТМЦ с привязкой к балансовому, внебалансовому и расходному счетам (8 знаков, демо-план счетов). */
export interface WarehouseGroup {
  id: ID;
  code: string;
  name: Localized;
  kind: WarehouseGroupKind;
  category: WarehouseCategory;
  account: string;
  offBalanceAccount?: string;
  expenseAccount: string;
}

/** Статус жизненного цикла карточки. */
export type WarehouseCardStatus = 'active' | 'control' | 'blocked' | 'archived';

/** Карточка товара (номенклатура). Каждый вид товара — отдельная карточка; однотипные привязываются к общей (parentId). */
export interface WarehouseCard {
  id: ID;
  cardNo: string;
  name: string;
  groupId: ID;
  unit: string;
  /** EAN-13 (внутренний диапазон 200…). */
  barcode: string;
  parentId?: ID;
  status: WarehouseCardStatus;
  /** Ценности на контроле — учёт на внебалансовом счёте. */
  offBalance: boolean;
  trackExpiry: boolean;
  shelfLifeDays?: number;
  defaultPrice: number;
  note?: string;
  version: number;
  createdAt: ISODate;
  createdBy: ID;
  updatedAt: ISODate;
  archivedAt?: ISODate;
}

/** Архивная версия карточки (сохраняется при каждом изменении). */
export interface WarehouseCardVersion {
  cardId: ID;
  version: number;
  at: ISODate;
  by: ID;
  reason: string;
  snapshot: Omit<WarehouseCard, 'id'>;
}

/** Складская позиция: карточка × склад. Остаток = сумма остатков партий. */
export interface WarehouseItem {
  id: ID;
  cardId: ID;
  warehouseId: ID;
  qty: number;
  reserved: number;
  minQty: number;
  /** Лимит «ходового» товара: при доступном остатке ≤ лимита — уведомление и черновик заявки на закупку. */
  limitQty?: number;
  /** Средняя стоимость единицы по остаткам партий (FIFO). */
  unitCost: number;
  /** Черновик заявки на закупку, созданный по лимиту (не создаётся повторно до пополнения). */
  reorderRequestId?: ID;
  // Денормализованные поля карточки (для реестров и поиска).
  sku: string;
  name: string;
  category: WarehouseCategory;
  unit: string;
}

export interface WarehouseBatch {
  id: ID;
  itemId: ID;
  batchNo: string;
  receiptId?: ID;
  receivedAt: ISODate;
  qtyIn: number;
  qtyLeft: number;
  unitCost: number;
  expiryDate?: ISODate;
}

export interface WarehouseBatchAlloc {
  batchId: ID;
  qty: number;
  unitCost: number;
}

export interface WarehouseMovement {
  id: ID;
  number: string;
  type: WarehouseMovementType;
  itemId: ID;
  qty: number;
  warehouseId: ID;
  toWarehouseId?: ID;
  departmentId?: ID;
  counterpartyId?: ID;
  userId: ID;
  at: ISODate;
  comment?: string;
  /** Стоимость операции (FIFO по партиям). */
  amount: number;
  costCenterId: string;
  docType?: 'receipt' | 'issue' | 'writeoff' | 'inventory' | 'transfer' | 'mbp';
  docId?: ID;
  docNumber?: string;
  allocs?: WarehouseBatchAlloc[];
  /** Сторно: движение отменено корректировкой. */
  reversed?: boolean;
  reversalOf?: ID;
}

export interface WarehouseStats {
  items: number;
  stockValue: number;
  lowStock: number;
  movementsMonth: number;
  reservedValue: number;
  expiring: number;
  stale: number;
  pendingIssues: number;
  unfinished: number;
  postingsError: number;
}

export interface NewWarehouseMovementInput {
  type: WarehouseMovementType;
  itemId: ID;
  qty: number;
  toWarehouseId?: ID;
  departmentId?: ID;
  counterpartyId?: ID;
  comment?: string;
  /** Приход: цена за единицу (без НДС), срок годности партии, реквизиты накладной. */
  unitCost?: number;
  expiryDate?: ISODate;
  costCenterId?: string;
  /** Выдача: основание (номер заявки или разнарядки) — обязательно. */
  basis?: string;
}

// ---------- Поступление ----------

export type WarehouseReceiptStatus = 'draft' | 'posted' | 'reversed';
export type WarehouseReceiptSource = 'manual' | 'einvoice' | 'contract';

export interface WarehouseReceiptLine {
  cardId: ID;
  qty: number;
  price: number;
  expiryDate?: ISODate;
  /** Данные ЭСФ для сверки (если поступление связано со счётом-фактурой). */
  invoiceName?: string;
  invoiceQty?: number;
  invoicePrice?: number;
}

export interface WarehouseReconDiff {
  line: number;
  field: 'qty' | 'price' | 'missing' | 'extra' | 'total';
  expected: number | string;
  actual: number | string;
}

export interface WarehouseReceipt {
  id: ID;
  /** Номер приходного ордера (М-4). */
  number: string;
  date: ISODate;
  warehouseId: ID;
  supplierId?: ID;
  contractId?: ID;
  procurementId?: ID;
  einvoiceId?: ID;
  einvoiceNumber?: string;
  waybillNo: string;
  waybillDate: ISODate;
  source: WarehouseReceiptSource;
  lines: WarehouseReceiptLine[];
  costCenterId: string;
  status: WarehouseReceiptStatus;
  /** Расхождения со счётом-фактурой и решение по ним. */
  diffs?: WarehouseReconDiff[];
  diffAccepted?: string;
  createdBy: ID;
  createdAt: ISODate;
  postedAt?: ISODate;
  postingId?: ID;
  correctionOf?: ID;
  correctedBy?: ID;
  history: HistoryEvent[];
}

// ---------- Выдача (электронная заявка на выдачу) ----------

export type WarehouseIssueStatus = 'draft' | 'pending' | 'returned' | 'rejected' | 'approved' | 'issued' | 'received' | 'cancelled';
/** Основание: электронная заявка в модуле склада, заявка на обеспечение (модуль заявок), разнарядка ЦБУ. */
export type WarehouseIssueSource = 'request' | 'supply_request' | 'allotment';
export type WarehouseSignRole = 'head' | 'operator' | 'storekeeper' | 'recipient';

export interface WarehouseIssueLine {
  itemId: ID;
  qty: number;
  amount?: number;
}

export interface WarehouseIssueSignature {
  role: WarehouseSignRole;
  userId: ID;
  signatureId: ID;
  at: ISODate;
}

export interface WarehouseIssue {
  id: ID;
  number: string;
  source: WarehouseIssueSource;
  externalRef?: { module: string; id: ID; number: string };
  allotmentNo?: string;
  warehouseId: ID;
  requesterId: ID;
  recipientId: ID;
  departmentId: ID;
  orgUnitKey: string;
  costCenterId: string;
  purpose: string;
  lines: WarehouseIssueLine[];
  status: WarehouseIssueStatus;
  signatures: WarehouseIssueSignature[];
  /** Номер электронного счёта-фактуры (внутренней накладной) получателя. */
  invoiceNo?: string;
  amount: number;
  createdAt: ISODate;
  submittedAt?: ISODate;
  issuedAt?: ISODate;
  receivedAt?: ISODate;
  postingId?: ID;
  history: HistoryEvent[];
}

/** Строка заявки на обеспечение (модуль заявок) для резервирования на складе. */
export interface WarehouseRequestLine {
  itemId?: ID;
  cardId?: ID;
  /** Если карточка не указана — поиск по наименованию. */
  name?: string;
  qty: number;
}

export interface WarehouseReserveInput {
  requestId: ID;
  requestNumber: string;
  requesterId: ID;
  recipientId?: ID;
  departmentId: ID;
  costCenterId?: string;
  orgUnitKey?: string;
  warehouseId?: ID;
  purpose?: string;
  lines: WarehouseRequestLine[];
}

// ---------- Списание (акт) ----------

export type WarehouseWriteoffKind = 'tmz' | 'mbp';
export type WarehouseWriteoffReason = 'damage' | 'expired' | 'shortage' | 'obsolete' | 'wear' | 'lost' | 'other';
export type WarehouseWriteoffStatus = 'draft' | 'commission' | 'pending' | 'returned' | 'rejected' | 'posted';

export interface WarehouseWriteoffLine {
  /** ТМЗ — складская позиция; МБП — запись реестра МБП. */
  refId: ID;
  qty: number;
  amount: number;
}

export interface WarehouseCommission {
  chairmanId: ID;
  memberIds: ID[];
  orderNo: string;
}

export interface WarehouseWriteoff {
  id: ID;
  number: string;
  kind: WarehouseWriteoffKind;
  date: ISODate;
  warehouseId?: ID;
  orgUnitKey?: string;
  reason: WarehouseWriteoffReason;
  reasonText: string;
  commission: WarehouseCommission;
  commissionSignatures: { userId: ID; signatureId: ID; at: ISODate }[];
  lines: WarehouseWriteoffLine[];
  amount: number;
  costCenterId: string;
  status: WarehouseWriteoffStatus;
  inventoryId?: ID;
  postingId?: ID;
  createdBy: ID;
  createdAt: ISODate;
  history: HistoryEvent[];
}

// ---------- Инвентаризация ТМЗ / МБП ----------

export type WarehouseInventoryScope = 'tmz' | 'mbp';
export type WarehouseInventoryStatus = 'counting' | 'completed' | 'approved';

export interface WarehouseInventoryLine {
  refId: ID;
  expectedQty: number;
  actualQty?: number;
  unitCost: number;
  scannedAt?: ISODate;
  note?: string;
}

export interface WarehouseInventory {
  id: ID;
  number: string;
  scope: WarehouseInventoryScope;
  warehouseId?: ID;
  orgUnitKey?: string;
  method: 'scan' | 'list';
  commission: WarehouseCommission;
  date: ISODate;
  status: WarehouseInventoryStatus;
  lines: WarehouseInventoryLine[];
  createdBy: ID;
  approvedBy?: ID;
  approvedAt?: ISODate;
  writeoffId?: ID;
  postingIds: ID[];
  history: HistoryEvent[];
}

// ---------- МБП в эксплуатации (ТЗ 4.2.4.4) ----------

export type MbpStatus = 'in_use' | 'pending_writeoff' | 'written_off' | 'lost';

export interface MbpRecord {
  id: ID;
  number: string;
  cardId: ID;
  name: string;
  unit: string;
  qty: number;
  /** Средняя цена (при объединении однотипных — средневзвешенная). */
  unitCost: number;
  issuedAt: ISODate;
  issueId?: ID;
  orgUnitKey: string;
  departmentId: ID;
  responsibleId: ID;
  costCenterId: string;
  offBalanceAccount: string;
  status: MbpStatus;
  barcode: string;
  history: HistoryEvent[];
}

// ---------- Проводки и мониторинг ----------

export type WmsModule = 'warehouse' | 'mbp' | 'assets' | 'terminals';
export type WmsPostingStatus = 'unsigned' | 'sending' | 'confirmed' | 'error' | 'queued' | 'reversed';

export interface WmsPostingEntry {
  debit: string;
  credit: string;
  amount: number;
  costCenterId: string;
  text: string;
}

export interface WmsPosting {
  id: ID;
  number: string;
  date: ISODate;
  module: WmsModule;
  docType: string;
  docId: ID;
  docNumber: string;
  entries: WmsPostingEntry[];
  amount: number;
  status: WmsPostingStatus;
  /** Проводка требует подписи E-IMZO до передачи в iABS (МБП, PR-WMS-069). */
  requireSign?: boolean;
  signatureId?: ID;
  exchangeId?: ID;
  error?: string;
  createdBy: ID;
  createdAt: ISODate;
  confirmedAt?: ISODate;
  reversalOf?: ID;
}

export interface WmsReconRow {
  module: WmsModule;
  account: string;
  name: Localized;
  erp: number;
  iabs: number;
  diff: number;
}

export interface WmsMonitoringRun {
  id: ID;
  at: ISODate;
  by: ID;
  auto: boolean;
  rows: WmsReconRow[];
  discrepancies: number;
  unfinished: number;
  lowStock: number;
  expiring: number;
  stale: number;
  exchangeId?: ID;
}

/** Строка отчёта «по подразделениям и сегментам». */
export interface WarehouseIssueReportRow {
  key: string;
  label: string;
  segment?: string;
  qty: number;
  amount: number;
  operations: number;
}
