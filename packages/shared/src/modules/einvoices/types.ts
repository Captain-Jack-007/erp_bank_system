// Типы модуля «Электронные счета-фактуры» (ТЗ 4.2.3): счета-фактуры, акты выполненных работ, акты сверки,
// документы в свободной форме; приём через API Налогового комитета, направление в подразделения ЦА и
// региональные центры, сроки (5 дней — подразделению, 10 дней — ПКМ № 489), маршрут согласования, проводки,
// мемориальный ордер, печатные формы с QR.
import type { HistoryEvent, ID, ISODate, Localized } from '../../types';

export type EinvoiceDirection = 'incoming' | 'outgoing';
/** Вид документа: счёт-фактура, акт выполненных работ, акт сверки, документ в свободной форме. */
export type EinvoiceKind = 'invoice' | 'work_act' | 'reconciliation_act' | 'free_form';
export type EinvoiceStatus = 'draft' | 'new' | 'routed' | 'pending' | 'approved' | 'sent' | 'accepted' | 'signed' | 'rejected';
/** Источник: API Налогового комитета (оператор ЭСФ) или ручной ввод. */
export type EinvoiceSource = 'soliq' | 'manual';
/** Светофор 10-дневного срока: 1–5 дней — зелёный, 6–8 — жёлтый, 9–10 — красный, 10+ — чёрный. */
export type EinvoiceLight = 'green' | 'yellow' | 'red' | 'black' | 'done';
/** Основание исходящего документа (поставка, продажа, передача ОС, аренда, услуги). */
export type EinvoiceBasis = 'goods' | 'asset_sale' | 'asset_transfer' | 'lease' | 'service' | 'other';

export interface EinvoiceLine {
  name: string;
  qty: number;
  unit: string;
  unitPrice: number; // без НДС
}

/** Направление документа в структурное подразделение ЦА / региональный центр / ЦБУ (оргструктура orgApi). */
export interface EinvoiceAssignment {
  orgUnitKey: string;
  unitName: Localized;
  unitType: 'department' | 'region' | 'branch_office' | 'head_office';
  assigneeIds: ID[];
  routedAt: ISODate;
  routedBy: ID;
  /** Срок исполнения подразделением (по умолчанию 5 рабочих дней — PR-EHF-017). */
  dueAt: ISODate;
  comment?: string;
  decision?: 'confirmed' | 'rejected';
  decidedAt?: ISODate;
  decidedBy?: ID;
  reason?: string;
}

/** Нарушение срока подразделением — штрафная мера KPI (PR-EHF-017). */
export interface EinvoicePenalty {
  orgUnitKey: string;
  unitName: Localized;
  userIds: ID[];
  days: number;
  points: number;
  at: ISODate;
}

export interface EinvoicePosting {
  debit: string; // счёт (8 знаков)
  credit: string;
  amount: number;
  purpose: string;
}

export type EinvoicePaymentStatus = 'draft' | 'sent' | 'queued' | 'paid' | 'failed';

/** Мемориальный ордер на оплату по документу (PR-EHF-029). */
export interface EinvoicePaymentOrder {
  number: string;
  createdAt: ISODate;
  createdBy: ID;
  debit: string;
  credit: string;
  account: string; // 20 знаков, счёт получателя
  mfo: string;
  amount: number;
  purpose: string;
  status: EinvoicePaymentStatus;
  exchangeId?: ID;
  transactionId?: string;
  paidAt?: ISODate;
  contractPaymentIndex?: number;
}

/** Строка акта сверки взаиморасчётов. */
export interface EinvoiceReconLine {
  date: ISODate;
  doc: string;
  debit: number; // начислено (документы поставщика)
  credit: number; // оплачено банком
}

export interface EinvoiceReconciliation {
  periodFrom: ISODate;
  periodTo: ISODate;
  opening: number;
  lines: EinvoiceReconLine[];
  closing: number;
}

export interface EinvoiceDoc {
  id: ID;
  number: string;
  direction: EinvoiceDirection;
  kind: EinvoiceKind;
  source: EinvoiceSource;
  date: ISODate;
  /** Момент поступления в систему (начало 10-дневного срока). */
  receivedAt: ISODate;
  counterpartyId: ID;
  contractId?: ID;
  status: EinvoiceStatus;
  lines: EinvoiceLine[];
  vatRate: number; // 12
  operatorId: string; // идентификатор документа у оператора ЭСФ
  /** Подразделение-оформитель исходящего документа (оргструктура). */
  issuerUnitKey?: string;
  basis?: EinvoiceBasis;
  basisRef?: string;
  /** Текст документа в свободной форме / комментарий к акту. */
  text?: string;
  reconciliation?: EinvoiceReconciliation;
  assignment?: EinvoiceAssignment;
  penalties?: EinvoicePenalty[];
  postings?: EinvoicePosting[];
  postedAt?: ISODate;
  postingExchangeId?: ID;
  paymentOrder?: EinvoicePaymentOrder;
  /** Подписи E-IMZO (signatureService). */
  signatureIds?: ID[];
  signedBy?: ID;
  signedAt?: ISODate;
  rejectReason?: string;
  /** Передан в электронный архив (ARXIV 360). */
  archivedAt?: ISODate;
  archiveRef?: string;
  history: HistoryEvent[];
}

export interface EinvoiceTotals {
  net: number;
  vat: number;
  total: number;
}

export interface EinvoiceFilter {
  direction?: EinvoiceDirection;
  kind?: EinvoiceKind;
  status?: EinvoiceStatus;
  counterpartyId?: ID;
  search?: string;
  light?: EinvoiceLight;
  /** Документы, ожидающие решения пользователя (подразделение-исполнитель). */
  assignedTo?: ID;
  orgUnitKey?: string;
  from?: string;
  to?: string;
}

export interface NewEinvoiceInput {
  kind?: EinvoiceKind;
  counterpartyId: ID;
  contractId?: ID;
  date: ISODate;
  lines: EinvoiceLine[];
  issuerUnitKey?: string;
  basis?: EinvoiceBasis;
  basisRef?: string;
  text?: string;
  reconciliation?: EinvoiceReconciliation;
  submit: boolean;
}

export interface EinvoiceStats {
  incomingNew: number;
  outgoingPending: number;
  signedMonth: number;
  vatMonth: number;
  rejected: number;
  routed: number;
  myTasks: number;
  lights: Record<Exclude<EinvoiceLight, 'done'>, number>;
}

export interface EinvoiceContractMatch {
  contractId: ID;
  contractAmount: number;
  invoicedTotal: number; // по всем ЭСФ договора (кроме отклонённых)
  remaining: number;
  exceeds: boolean;
}

/** Результат валидации документа (PR-EHF-021). */
export interface EinvoiceCheck {
  code: 'tin' | 'blocked' | 'contract' | 'contract_amount' | 'order' | 'vat' | 'duplicate' | 'act' | 'invoice' | 'lines';
  ok: boolean;
  warn?: boolean;
  details?: string;
}

export interface EinvoiceIntakeResult {
  exchangeId: ID;
  status: 'success' | 'queued' | 'failed' | 'quarantined';
  created: { id: ID; number: string; kind: EinvoiceKind }[];
  autoRouted: number;
}

export interface EinvoiceUnitReportRow {
  orgUnitKey: string;
  unitName: Localized;
  routed: number;
  confirmed: number;
  rejected: number;
  open: number;
  overdue: number;
  penaltyPoints: number;
  avgDays: number;
}

export interface EinvoiceReportRow {
  kind: EinvoiceKind;
  direction: EinvoiceDirection;
  count: number;
  net: number;
  vat: number;
  total: number;
  accepted: number;
  rejected: number;
  open: number;
}

export interface EinvoiceDashboard {
  lights: Record<Exclude<EinvoiceLight, 'done'>, number>;
  byUnit: EinvoiceUnitReportRow[];
  daily: { date: string; received: number; decided: number }[];
  critical: { id: ID; number: string; kind: EinvoiceKind; light: EinvoiceLight; day: number; holder: string }[];
}
