// Типы модуля «Архив» (ТЗ 4.2.10, ARXIV 360): приём и регистрация документов из систем Банка и вручную,
// формирование дел по номенклатуре, контроль полноты, сдача-приём в архив, учёт места хранения, выдача и
// копирование, сроки хранения, уничтожение и передача в госархив, журнал движения и отчёты.
import type { ID, ISODate, Localized } from '../../types';

export interface ArchiveNomenclatureItem {
  id: ID;
  index: string; // индекс дела по номенклатуре, напр. 01-05
  title: string;
  departmentId: ID;
  retentionYears: number; // 0 — постоянно
  article: string; // статья перечня типовых документов
  /** Виды документов, которые сводятся в дело этой статьи. */
  kinds?: string[];
}

/** Источник поступления документа (PR-ARC-009…013). */
export type ArchiveSource = 'manual' | 'scan' | 'migration' | 'sed' | 'einvoices' | 'trips' | 'abs' | 'dwh' | 'integration' | 'audit';

export type ArchiveCaseStatus = 'forming' | 'submitted' | 'stored' | 'issued' | 'expired' | 'destroyed' | 'transferred';

export interface ArchiveLocation {
  room: string;
  rack: string;
  shelf: number;
  box: string;
}

export type ArchiveMovementAction =
  | 'received' | 'formed' | 'added' | 'removed' | 'checked' | 'submitted' | 'accepted' | 'returned_dept' | 'issued' | 'returned'
  | 'moved' | 'copied' | 'version' | 'act' | 'destroyed' | 'transferred' | 'viewed';

/** Запись журнала движения дела/документа (неизменяемая история, PR-ARC-019, 025). */
export interface ArchiveMovement {
  at: ISODate;
  userId: ID;
  action: ArchiveMovementAction;
  details?: string;
}

/** Результат проверки (полнота дела, целостность принятых данных). */
export interface ArchiveCheck {
  code: 'has_docs' | 'attributes' | 'numbering' | 'integrity' | 'signatures' | 'period' | 'pages' | 'files';
  ok: boolean;
  warn?: boolean;
  details?: string;
}

export interface ArchiveCase {
  id: ID;
  number: string; // 01-05/2019
  nomenclatureId: ID;
  title: string;
  year: number;
  departmentId: ID;
  documents: number;
  pages: number;
  location: ArchiveLocation;
  status: ArchiveCaseStatus;
  retentionUntil: ISODate | null; // null — постоянное хранение
  transferredAt: ISODate;
  /** Электронное дело (сводная папка) из документов систем Банка. */
  electronic?: boolean;
  /** Ограниченный доступ (гриф «ДСП»): видят архив, руководство и подразделение-владелец. */
  restricted?: boolean;
  responsibleId?: ID;
  periodFrom?: ISODate;
  periodTo?: ISODate;
  formedAt?: ISODate;
  formedBy?: ID;
  submittedAt?: ISODate;
  submittedBy?: ID;
  acceptedAt?: ISODate;
  acceptedBy?: ID;
  acceptanceActNo?: string;
  returnReason?: string;
  completeness?: ArchiveCheck[];
  signatureIds?: ID[];
  movements: ArchiveMovement[];
}

export interface ArchiveDocVersion {
  version: number;
  at: ISODate;
  by: ID;
  checksum: string;
  note?: string;
}

export interface ArchiveDocument {
  id: ID;
  /** Единый идентификатор в архиве (ARC-…). */
  uid: string;
  caseId: ID | null;
  docNumber: string;
  docDate: ISODate;
  title: string;
  kind: string;
  source: ArchiveSource;
  sourceRef?: string;
  departmentId: ID;
  responsibleId?: ID;
  /** Время создания документа в системе-источнике (PR-ARC-037). */
  createdAt: ISODate;
  receivedAt: ISODate;
  pages?: number;
  /** Текст (OCR / содержимое) — для полнотекстового поиска. */
  text?: string;
  /** SHA-256 канонического содержимого (контроль целостности). */
  checksum: string;
  /** Документ-источник подписей E-IMZO и файлов (signatureService / filesApi). */
  signatureEntity?: { entity: string; entityId: ID };
  fileEntity?: { entity: string; entityId: ID };
  signatures?: number;
  nomenclatureIndex?: string;
  restricted?: boolean;
  version: number;
  versions: ArchiveDocVersion[];
  movements: ArchiveMovement[];
}

export type ArchiveRequestStatus = 'new' | 'issued' | 'returned' | 'rejected';

export interface ArchiveRequest {
  id: ID;
  number: string;
  caseId: ID;
  requesterId: ID;
  purpose: string;
  requestedAt: ISODate;
  dueBack: ISODate;
  status: ArchiveRequestStatus;
  issuedAt?: ISODate;
  returnedAt?: ISODate;
  comment?: string;
  /** Выдача заверенной копии вместо подлинника (PR-ARC-044). */
  copy?: boolean;
}

export type ArchiveActKind = 'destruction' | 'state_transfer';
export type ArchiveActStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'signed';

export interface ArchiveDestructionAct {
  id: ID;
  number: string;
  kind: ArchiveActKind;
  caseIds: ID[];
  createdAt: ISODate;
  createdBy: ID;
  status: ArchiveActStatus;
  signedAt?: ISODate;
  signedBy?: ID;
  signatureIds?: ID[];
  rejectReason?: string;
  history: { at: ISODate; userId: ID; action: string; comment?: string }[];
}

/** Поручение подразделению подготовить и сдать дело в архив (PR-ARC-014, 017, 018). */
export interface ArchiveTransferTask {
  id: ID;
  number: string;
  departmentId: ID;
  nomenclatureId: ID;
  year: number;
  responsibleId: ID;
  dueDate: ISODate;
  createdAt: ISODate;
  createdBy: ID;
  status: 'open' | 'done';
  caseId?: ID;
  doneAt?: ISODate;
}

/** Ошибка приёма данных: дубль, неполные реквизиты, нарушение целостности, сбой интеграции (PR-ARC-051). */
export interface ArchiveIntakeError {
  id: ID;
  at: ISODate;
  source: ArchiveSource;
  sourceRef?: string;
  docNumber?: string;
  reason: 'duplicate' | 'incomplete' | 'integrity' | 'integration';
  details: string;
  status: 'open' | 'resolved' | 'discarded';
  exchangeId?: ID;
}

export interface ArchiveCaseFilter {
  search?: string;
  departmentId?: ID;
  status?: ArchiveCaseStatus;
  year?: number;
  electronic?: boolean;
}

export interface ArchiveStats {
  cases: number;
  documents: number;
  issued: number;
  overdueReturns: number;
  expired: number;
  registry: number;
  submitted: number;
  errors: number;
  openTasks: number;
}

export interface ArchiveSearchFilter {
  query?: string;
  from?: string;
  to?: string;
  departmentId?: ID;
  kind?: string;
  caseId?: ID;
  responsibleId?: ID;
  source?: ArchiveSource;
  status?: 'registry' | 'in_case';
}

export interface ArchiveSearchHit {
  doc: ArchiveDocument;
  caseNumber: string;
  caseTitle: string;
  location: ArchiveLocation | null;
  /** Фрагмент текста с найденным словом. */
  snippet?: string;
}

/** Ввод документа уполномоченным сотрудником / приём из систем. */
export interface ArchiveIntakeInput {
  source: ArchiveSource;
  sourceRef?: string;
  docNumber: string;
  docDate: ISODate;
  title: string;
  kind: string;
  departmentId: ID;
  responsibleId?: ID;
  createdAt?: ISODate;
  pages?: number;
  text?: string;
  content?: unknown;
  signatureEntity?: { entity: string; entityId: ID };
  /** Каноническое содержимое, которое подписывалось в источнике: подписи сверяются с ним при приёме (PR-ARC-034). */
  signatureContent?: unknown;
  fileEntity?: { entity: string; entityId: ID };
  nomenclatureIndex?: string;
  restricted?: boolean;
}

export interface ArchiveSourceInfo {
  id: ArchiveSource;
  name: Localized;
  kind: 'module' | 'system';
  pending: number;
}

export interface ArchiveFormCaseInput {
  nomenclatureId: ID;
  year: number;
  departmentId: ID;
  periodFrom?: ISODate;
  periodTo?: ISODate;
  title?: string;
  responsibleId?: ID;
  restricted?: boolean;
}

export interface ArchiveMovementReportRow {
  month: string;
  received: number;
  accepted: number;
  issued: number;
  returned: number;
  copies: number;
  destroyed: number;
}

export interface ArchiveDisciplineRow {
  userId: ID;
  departmentId: ID;
  issued: number;
  overdue: number;
  overdueDays: number;
  tasksOpen: number;
  tasksOverdue: number;
}

export interface ArchiveFundRow {
  departmentId: ID;
  cases: number;
  electronic: number;
  documents: number;
  pages: number;
  permanent: number;
  expiring: number;
}
