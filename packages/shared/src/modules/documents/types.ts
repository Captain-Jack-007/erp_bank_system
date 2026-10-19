// Типы модуля «Документооборот» (ТЗ 4.2.9): входящие / исходящие / внутренние документы, письма my3.soliq.uz и
// решения МИБ, 24-часовое окно принятия, 10-дневный срок со светофором, ответ только с файлом, акт о нарушении
// исполнительской дисциплины и KPI, механизм «Акцепт» (оплата по решениям МИБ, инкассо, требованиям НО),
// сводная папка АУР и закрытие операционного дня, передача в архив.
import type { HistoryEvent, ID, ISODate } from '../../types';

export type DocumentKind = 'incoming' | 'outgoing' | 'internal';
export type DocumentCategory =
  | 'letter' | 'order' | 'memo' | 'instruction' | 'appeal' | 'act' | 'protocol'
  | 'mib_decision' | 'tax_demand' | 'notice' | 'collection_order' | 'payment_demand' | 'aur';
/**
 * Статусы: зарегистрирован → (согласование) → направлен исполнителю (24 ч на принятие) → на исполнении →
 * ответ дан (файл ответа подтверждён) / в процессе оплаты → исполнен. Отклонён — по маршруту или исполнителем.
 */
export type DocumentStatus = 'registered' | 'pending' | 'assigned' | 'in_progress' | 'answered' | 'payment' | 'done' | 'rejected';
export type DocumentPriority = 'normal' | 'high';
export type DocumentSource = 'manual' | 'soliq' | 'mib' | 'scan';
/** Светофор 10-дневного срока (п. 4.2.9.3). */
export type DocumentLight = 'green' | 'yellow' | 'red' | 'black' | 'closed';

export interface DocumentResolution {
  authorId: ID;
  text: string;
  at: ISODate;
}

/** Реквизиты платежа из решения МИБ / инкассо / требования НО (PR-DOC-029). */
export interface DocumentPaymentDetails {
  amount: number;
  recipient: string;
  recipientTin: string;
  account: string; // 20 знаков
  mfo: string; // 5 знаков
  treasuryAccount?: string; // казначейский лицевой счёт
  purpose: string;
}

export type DocumentPaymentStatus = 'draft' | 'second_approval' | 'ready' | 'queued' | 'in_payment' | 'paid' | 'rejected';

/** Платёж по документу: «Акцепт» исполнителя → АБС («Готов») → списание («Исполнено»). */
export interface DocumentPayment {
  orderNumber: string; // мемориальный ордер
  status: DocumentPaymentStatus;
  acceptedBy?: ID;
  acceptedAt?: ISODate;
  secondApproval: boolean;
  exchangeId?: ID;
  mfo?: string;
  transactionId?: string;
  paidAt?: ISODate;
  debtClosedAt?: ISODate;
}

/** Нарушение исполнительской дисциплины (PR-DOC-026, 027). */
export interface DocumentViolation {
  actNumber: string;
  at: ISODate;
  executorId: ID;
  departmentId: ID;
  overdueDays: number;
  /** Снижение ежемесячного бонуса, % (за каждый день просрочки). */
  bonusCutPct: number;
}

export interface DocumentRecord {
  id: ID;
  number: string; // регистрационный номер
  kind: DocumentKind;
  type: DocumentCategory;
  source: DocumentSource;
  correspondent: string; // организация-отправитель / получатель; для внутренних — подразделение
  correspondentNumber?: string; // исходящий номер корреспондента
  subject: string;
  summary: string;
  /** Текст проекта исходящего / внутреннего документа. */
  body?: string;
  /** Распознанный текст скан-образа (OCR). */
  ocrText?: string;
  /** Момент загрузки/регистрации с точностью до секунды — день 0 срока (PR-DOC-009). */
  registeredAt: ISODate;
  deadline?: ISODate;
  /** Документ на 10-дневном контроле (письма НК, решения МИБ, требования). */
  hardDeadline?: boolean;
  executorId: ID;
  departmentId: ID;
  /** Подразделение определено автоматически по содержанию (PR-DOC-010). */
  autoRouted?: { departmentId: ID; keywords: string[] };
  priority: DocumentPriority;
  control: boolean; // на контроле
  status: DocumentStatus;
  /** Направлено исполнителю — окно 24 ч на принятие или отклонение с обоснованием (PR-DOC-014, 015). */
  assignedAt?: ISODate;
  acceptedAt?: ISODate;
  autoAccepted?: boolean;
  declineReason?: string;
  resolution?: DocumentResolution;
  pages: number;
  /** Ответ: файл загружен исполнителем и подтверждён (статус «Ответ дан», PR-DOC-024, 025). */
  responseFileId?: ID;
  responseNote?: string;
  responseConfirmedBy?: ID;
  responseConfirmedAt?: ISODate;
  /** Связь с договором (платёжное требование, PR-DOC-028). */
  contractId?: ID;
  paymentDetails?: DocumentPaymentDetails;
  payment?: DocumentPayment;
  /** Отправка исходящего адресату через внешний ЭДО. */
  sentAt?: ISODate;
  sentExchangeId?: ID;
  signatureIds?: ID[];
  /** АУР: сумма расхода, МВЗ, статья (сводная папка операционного дня). */
  aur?: { amount: number; costCenterKey: string; article: string; opDay: string };
  violation?: DocumentViolation;
  warningSentAt?: ISODate;
  managementNotifiedAt?: ISODate;
  /** Срок хранения по типу документа (лет; 0 — постоянно), PR-DOC-019. */
  retentionYears: number;
  archivedAt?: ISODate;
  archiveRef?: string;
  history: HistoryEvent[];
}

export interface DocumentFilter {
  kind?: DocumentKind;
  status?: DocumentStatus;
  type?: DocumentCategory;
  executorId?: ID;
  departmentId?: ID;
  overdueOnly?: boolean;
  light?: DocumentLight;
  source?: DocumentSource;
  search?: string;
}

export interface NewDocumentInput {
  kind: DocumentKind;
  type: DocumentCategory;
  correspondent: string;
  correspondentNumber?: string;
  subject: string;
  summary: string;
  body?: string;
  ocrText?: string;
  source?: DocumentSource;
  deadline?: ISODate;
  executorId: ID;
  departmentId: ID;
  priority: DocumentPriority;
  control: boolean;
  pages: number;
  contractId?: ID;
  paymentDetails?: DocumentPaymentDetails;
  aur?: { amount: number; costCenterKey: string; article: string };
  submit: boolean; // отправить на согласование руководителю
}

export interface DocumentStats {
  registeredMonth: number;
  onControl: number;
  overdue: number;
  dueSoon: number;
  pending: number;
  awaitingAccept: number;
  lights: Record<Exclude<DocumentLight, 'closed'>, number>;
  inPayment: number;
}

export interface DocumentDisciplineRow {
  executorId: ID;
  departmentId: ID;
  total: number;
  closed: number;
  onTime: number;
  open: number;
  overdue: number;
  black: number;
  overdueDays: number;
  bonusCutPct: number;
  autoAccepted: number;
}

export interface DocumentClassification {
  departmentId: ID;
  keywords: string[];
  executorId?: ID;
}

/** Сверка сводной папки АУР с бухгалтерским журналом за операционный день (PR-DOC-005). */
export interface DocumentAurReconciliation {
  opDay: string;
  docs: { id: ID; number: string; amount: number; costCenterKey: string; article: string; matched: boolean }[];
  journal: { ref: string; amount: number; account: string; matched: boolean }[];
  docsTotal: number;
  journalTotal: number;
  diff: number;
  exchangeId?: ID;
  closed: boolean;
  closedAt?: ISODate;
  closedBy?: ID;
  archiveRef?: string;
}

export interface DocumentIntakeResult {
  exchangeId: ID;
  status: string;
  created: { id: ID; number: string; type: DocumentCategory }[];
}
