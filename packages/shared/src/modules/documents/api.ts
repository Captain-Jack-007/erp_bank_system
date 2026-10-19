// API модуля «Документооборот» (СЭД, ТЗ 4.2.9): регистрация (вручную, скан + OCR, загрузка писем my3.soliq.uz и
// решений МИБ), автонаправление по содержанию, гибкие маршруты по типу документа (движок), резолюции, 24-часовое
// окно принятия, 10-дневный срок со светофором и многоуровневым оповещением, ответ только с файлом, акт о
// нарушении исполнительской дисциплины и снижение бонуса, механизм «Акцепт» (оплата через АБС с вторым
// подтверждением сверх 50 млн), исходящие с ЭЦП и электронной отправкой, сводная папка АУР, передача в архив.
import { addDays, clone, delay, emit, historyEvent, nextId, nextNumber, now, today } from '../../bus';
import { audit } from '../../audit';
import { directory } from '../../directory';
import { approvalEngine } from '../../engine';
import { tk, translate } from '../../i18n';
import { notify } from '../../notifications';
import { matches, registerSearchProvider } from '../../search';
import { can, registerModuleAccess } from '../../security';
import { utf8Decode } from '../../services/bytes';
import { filesApi } from '../../services/files';
import { integrationHub } from '../../services/integrations';
import { signatureService } from '../../services/signature';
import type { ID, Localized, User } from '../../types';
import { archiveApi, registerArchiveSource } from '../archive/api';
import { DOCUMENT_RETENTION, documentApprovalSeed, documentInboxQueue, documentSeed } from './data';
import { registerDocsIntegrationOps } from './integrationOps';
import type {
  DocumentAurReconciliation,
  DocumentCategory,
  DocumentClassification,
  DocumentDisciplineRow,
  DocumentFilter,
  DocumentIntakeResult,
  DocumentKind,
  DocumentLight,
  DocumentPaymentDetails,
  DocumentRecord,
  DocumentStats,
  NewDocumentInput,
} from './types';
import { apiError } from '../../errors';

registerDocsIntegrationOps();
// Права по умолчанию для ролей без явной настройки: бухгалтерия, казначейство и налоговый специалист исполняют письма
// НК / решения МИБ и платежи («Акцепт»); остальные роли бизнес-пользователей — просмотр.
registerModuleAccess('documents', { accountant: 'edit', treasury: 'edit', tax_officer: 'edit', finance: 'edit', procurement: 'view', analyst: 'view', cash_operator: 'view', storekeeper: 'view', support: 'view', auditor: 'view' });

const db: DocumentRecord[] = clone(documentSeed);
const byId = (id: ID) => db.find((d) => d.id === id);
const inbox = clone(documentInboxQueue);
const aurDays = new Map<string, DocumentAurReconciliation>();
let regSeq = 5000;
const DAY = 86_400_000;
const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const who = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });

const PREFIX: Record<DocumentKind, string> = { incoming: 'VH', outgoing: 'IS', internal: 'VN' };
/** Жёсткий срок исполнения писем НК / решений МИБ, календарных дней (п. 4.2.9.3). */
export const DOCUMENT_HARD_DAYS = 10;
/** Окно принятия к исполнению, часов (PR-DOC-014, 015). */
export const DOCUMENT_ACCEPT_HOURS = 24;
/** Норматив, сверх которого платёж требует второго подтверждения (PR-DOC-034). */
export const DOCUMENT_PAYMENT_THRESHOLD = 50_000_000;
/** Снижение ежемесячного бонуса за каждый день просрочки, % (PR-DOC-027). */
export const DOCUMENT_BONUS_CUT_PER_DAY = 5;
export const DOCUMENT_PAYMENT_TYPES: DocumentCategory[] = ['mib_decision', 'collection_order', 'tax_demand', 'payment_demand'];
export const DOCUMENT_CATEGORIES: DocumentCategory[] = ['letter', 'order', 'memo', 'instruction', 'appeal', 'act', 'protocol', 'mib_decision', 'tax_demand', 'notice', 'collection_order', 'payment_demand', 'aur'];
const typeRu: Record<DocumentCategory, string> = { letter: 'Письмо', order: 'Приказ', memo: 'Служебная записка', instruction: 'Распоряжение', appeal: 'Обращение', act: 'Акт', protocol: 'Протокол', mib_decision: 'Решение МИБ', tax_demand: 'Требование налогового органа', notice: 'Уведомление', collection_order: 'Инкассо', payment_demand: 'Платёжное требование', aur: 'Документ АУР' };

/** Каноническое содержимое документа для подписи E-IMZO. */
export function documentSignContent(d: DocumentRecord) {
  return { number: d.number, kind: d.kind, type: d.type, subject: d.subject, summary: d.summary, body: d.body ?? '', correspondent: d.correspondent };
}

const OPEN: DocumentRecord['status'][] = ['registered', 'pending', 'assigned', 'in_progress', 'payment'];
const isClosed = (d: Pick<DocumentRecord, 'status'>) => !OPEN.includes(d.status);

/** Документ не исполнен и срок прошёл. */
export function documentIsOverdue(d: Pick<DocumentRecord, 'status' | 'deadline'>): boolean {
  return !!d.deadline && !isClosed(d) && d.deadline < today();
}

/** День срока: 1 — первые сутки с момента загрузки (день 0 = секунда загрузки). */
export function documentDay(d: Pick<DocumentRecord, 'registeredAt'>, at = Date.now()): number {
  return Math.max(1, Math.floor((at - new Date(d.registeredAt).getTime()) / DAY) + 1);
}

/**
 * Светофор: для писем НК / МИБ — по дням с момента загрузки (1–5 зелёный, 6–8 жёлтый, 9–10 красный, 10+ чёрный);
 * для прочих контрольных документов — по оставшимся до срока дням (≤3 жёлтый, ≤1 красный, просрочен — чёрный).
 */
export function documentLight(d: Pick<DocumentRecord, 'status' | 'deadline' | 'registeredAt' | 'hardDeadline'>, at = Date.now()): DocumentLight {
  if (isClosed(d) || d.status === 'pending' || (d.status === 'payment' && !d.hardDeadline)) return 'closed';
  if (d.hardDeadline) {
    const day = documentDay(d, at);
    return day <= 5 ? 'green' : day <= 8 ? 'yellow' : day <= DOCUMENT_HARD_DAYS ? 'red' : 'black';
  }
  if (!d.deadline) return 'closed';
  const left = Math.round((new Date(`${d.deadline}T00:00:00Z`).getTime() - new Date(`${new Date(at).toISOString().slice(0, 10)}T00:00:00Z`).getTime()) / DAY);
  return left < 0 ? 'black' : left <= 1 ? 'red' : left <= 3 ? 'yellow' : 'green';
}

/** Просрочка, дней (для KPI): от жёсткого срока или от срока исполнения. */
export function documentOverdueDays(d: Pick<DocumentRecord, 'status' | 'deadline' | 'registeredAt' | 'hardDeadline' | 'responseConfirmedAt'>, at = Date.now()): number {
  const end = d.responseConfirmedAt ? new Date(d.responseConfirmedAt).getTime() : isClosed(d) ? 0 : at;
  if (!end) return 0;
  const due = d.hardDeadline ? new Date(d.registeredAt).getTime() + DOCUMENT_HARD_DAYS * DAY : d.deadline ? new Date(`${d.deadline}T23:59:59Z`).getTime() : 0;
  if (!due) return 0;
  return end > due ? Math.ceil((end - due) / DAY) : 0;
}

/** Часы до автопринятия (окно 24 ч). */
export function documentAcceptHoursLeft(d: Pick<DocumentRecord, 'status' | 'assignedAt'>, at = Date.now()): number | undefined {
  if (d.status !== 'assigned' || !d.assignedAt) return undefined;
  return Math.max(0, DOCUMENT_ACCEPT_HOURS - (at - new Date(d.assignedAt).getTime()) / 3_600_000);
}

// ---------- Классификатор: направление по содержанию (PR-DOC-010) ----------

const RULES: { departmentId: ID; words: string[] }[] = [
  { departmentId: 'd5', words: ['миб', 'суд', 'иск', 'исполнительн', 'арест', 'претензи', 'взыскан'] },
  { departmentId: 'd8', words: ['инкассо', 'казначей', 'списан', 'пени', 'недоимк'] },
  { departmentId: 'd7', words: ['ндс', 'налог', 'декларац', 'отчётност', 'бухгалтер', 'сверк', 'ндфл', 'счёт-фактур', 'камеральн'] },
  { departmentId: 'd10', words: ['кредит', 'залог', 'заём', 'заемщик', 'заёмщик'] },
  { departmentId: 'd9', words: ['операци', 'касс', 'вклад', 'карт', 'счетах', 'счета клиента', 'остатк', 'цбу', 'обращени'] },
  { departmentId: 'd6', words: ['кадр', 'персонал', 'трудов', 'сотрудник'] },
  { departmentId: 'd1', words: ['информацион', 'сервер', 'ит-', 'программ', 'цод'] },
];

export function classifyDocument(text: string): DocumentClassification | undefined {
  const t = text.toLowerCase();
  let best: { departmentId: ID; keywords: string[] } | undefined;
  for (const r of RULES) {
    const hit = r.words.filter((w) => t.includes(w));
    if (hit.length && (!best || hit.length > best.keywords.length)) best = { departmentId: r.departmentId, keywords: hit };
  }
  if (!best) return undefined;
  const head = directory.department(best.departmentId)?.headId;
  return { ...best, ...(head ? { executorId: head } : {}) };
}

/** Извлечение суммы и реквизитов из текста решения МИБ / инкассо / требования (PR-DOC-029). */
export function extractPaymentDetails(text: string, fallbackPurpose: string): DocumentPaymentDetails | undefined {
  const amountM = /сумм[аы]?:?\s*([\d\s ]{4,})\s*сум/i.exec(text) ?? /([\d\s ]{6,})\s*сум/i.exec(text);
  const account = /\b(\d{20})\b/.exec(text)?.[1];
  const mfo = /МФО\s*(\d{5})/i.exec(text)?.[1];
  const tin = /ИНН\s*(\d{9})/i.exec(text)?.[1];
  const treasury = /\b(\d{27})\b/.exec(text)?.[1];
  const recipient = /Получатель:?\s*([^,.]+)/i.exec(text)?.[1]?.trim();
  const amount = amountM ? Number(amountM[1]!.replace(/[\s ]/g, '')) : 0;
  if (!amount || !account || !mfo) return undefined;
  return { amount, recipient: recipient ?? '—', recipientTin: tin ?? '', account, mfo, ...(treasury ? { treasuryAccount: treasury } : {}), purpose: fallbackPurpose };
}

// ---------- Согласование: маршрут документа и второе подтверждение платежа ----------

approvalEngine.register('document', {
  onHistory: (id, e) => byId(id)?.history.push(e),
  onFinal: (id, ok) => {
    const d = byId(id);
    if (!d) return;
    if (!ok) {
      d.status = 'rejected';
      return;
    }
    // Входящий после согласования — к исполнителю (24 ч на принятие); внутренний / исходящий — на исполнение / к отправке.
    if (d.kind === 'incoming') {
      d.status = 'assigned';
      d.assignedAt = now();
      notifyAssigned(d);
    } else d.status = 'in_progress';
  },
  onReturned: (id, comment) => {
    const d = byId(id);
    if (d) {
      d.status = 'registered';
      d.history.push(historyEvent('system', 'returned', comment));
    }
  },
  getContext: (id) => {
    const d = byId(id);
    return d ? { subtype: d.type, kind: d.kind, departmentId: d.departmentId } : undefined;
  },
});
approvalEngine.seed(documentApprovalSeed);

approvalEngine.register('doc_payment', {
  onHistory: (id, e) => byId(id.split(':')[0]!)?.history.push({ ...e, comment: `Второе подтверждение платежа: ${e.comment ?? translateAction(e.action)}` }),
  onFinal: (id, ok) => {
    const d = byId(id.split(':')[0]!);
    if (!d?.payment) return;
    if (ok) void sendPaymentToAbs(d, d.payment.acceptedBy ?? 'system');
    else {
      d.payment.status = 'rejected';
      d.status = 'in_progress';
    }
  },
});
const translateAction = (a: string) => (a === 'approved' ? 'согласовано' : a === 'rejected' ? 'отклонено' : a);

/** Кто налагает резолюции и подтверждает ответы (контроль исполнения): documents ≥ approve. */
export function canResolveDocuments(user: User): boolean {
  return can(user, 'documents', 'approve');
}
function assertRegistrar(user: User) {
  if (!can(user, 'documents', 'edit')) throw apiError('NOT_ALLOWED');
}
const isExecutor = (d: DocumentRecord, user: User) => d.executorId === user.id || directory.hasRole(user, 'admin');

registerSearchProvider((q, lang) =>
  db
    .filter((d) => matches(q, d.number, d.subject, d.correspondent, d.correspondentNumber, d.summary, d.ocrText, d.body))
    .map((d) => ({
      group: 'documents_title',
      title: `${d.number} · ${d.subject}`,
      subtitle: `${translate(lang, tk('documents_kind_', d.kind))} · ${translate(lang, tk('documents_status_', d.status))}`,
      to: `/documents/${d.id}`,
    })),
);

function notifyAssigned(d: DocumentRecord) {
  notify({
    userIds: [d.executorId],
    kind: 'task',
    level: d.priority === 'high' ? 'warning' : 'info',
    title: L(`${d.number}: документ направлен вам на исполнение`, `${d.number}: hujjat sizga ijro uchun yuborildi`, `${d.number}: document assigned to you`),
    body: L(`Примите к исполнению или отклоните с обоснованием в течение ${DOCUMENT_ACCEPT_HOURS} ч`, `${DOCUMENT_ACCEPT_HOURS} soat ichida ijroga qabul qiling yoki asoslab rad eting`, `Accept or decline with justification within ${DOCUMENT_ACCEPT_HOURS} h`),
    link: `/documents/${d.id}`,
  });
}

function openRoute(d: DocumentRecord, user: User) {
  approvalEngine.open({ entity: 'document', entityId: d.id, number: d.number, title: d.subject, requesterId: user.id, context: { subtype: d.type, kind: d.kind, departmentId: d.departmentId } });
}

// ---------- Платёж («Акцепт», PR-DOC-028…036) ----------

async function sendPaymentToAbs(d: DocumentRecord, userId: ID): Promise<void> {
  const p = d.payment;
  const det = d.paymentDetails;
  if (!p || !det) return;
  try {
    const rec = await integrationHub.call('iabs', 'payment.send', { doc: p.orderNumber, account: det.account, mfo: det.mfo, amount: det.amount, purpose: det.purpose, treasury: det.treasuryAccount ?? '' }, { idempotencyKey: `doc-pay-${d.id}-${p.orderNumber}`, userId });
    p.exchangeId = rec.id;
    if (rec.status === 'success') {
      p.status = 'ready';
      d.status = 'payment';
      d.history.push(historyEvent(userId, 'status_changed', `Платёжный документ ${p.orderNumber} передан в АБС: статус «Готов»; документ — «В процессе оплаты»`));
      notify({ roles: ['accountant'], kind: 'system', level: 'info', title: L(`${p.orderNumber}: платёж готов к исполнению`, `${p.orderNumber}: to'lov ijroga tayyor`, `${p.orderNumber}: payment ready`), body: d.subject, link: `/documents/${d.id}` });
    } else {
      p.status = 'queued';
      d.history.push(historyEvent(userId, 'status_changed', `АБС: ${rec.status} — платёж в очереди`));
    }
  } catch {
    p.status = 'queued';
  }
  emit();
}

async function archiveDoc(d: DocumentRecord, userId: ID): Promise<void> {
  if (d.archivedAt) return;
  try {
    const u = directory.user(userId) ?? directory.admins()[0]!;
    const r = await archiveApi.receiveElectronic({
      source: 'sed',
      sourceRef: d.id,
      docNumber: d.number,
      docDate: d.registeredAt.slice(0, 10),
      title: d.subject,
      kind: typeRu[d.type],
      departmentId: d.departmentId,
      responsibleId: d.executorId,
      createdAt: d.registeredAt,
      pages: d.pages,
      text: [d.summary, d.body, d.ocrText, d.responseNote].filter(Boolean).join('\n'),
      content: { number: d.number, type: d.type, subject: d.subject, summary: d.summary, body: d.body ?? '', status: d.status },
      signatureEntity: { entity: 'document', entityId: d.id },
      signatureContent: documentSignContent(d),
      fileEntity: { entity: 'document', entityId: d.id },
    }, u);
    d.archivedAt = now();
    d.archiveRef = r.number;
    d.history.push(historyEvent(userId, 'status_changed', `Передан в архив: ${r.number} (срок хранения: ${d.retentionYears ? `${d.retentionYears} лет` : 'постоянно'})`));
  } catch {
    /* повтор — через «Приём из систем» в архиве */
  }
}

registerArchiveSource('sed', {
  name: L('СЭД: исполненные документы', 'EHA: ijro etilgan hujjatlar', 'EDMS: executed documents'),
  pending: () => db.filter((d) => isClosed(d) && d.status !== 'rejected' && !d.archivedAt).length,
  pull: async (user) => {
    const list = db.filter((d) => isClosed(d) && d.status !== 'rejected' && !d.archivedAt);
    for (const d of list) await archiveDoc(d, user.id);
    emit();
    return list.length;
  },
});

// ---------- Сроки и оповещения (п. 4.2.9.3) ----------

let lastScan = 0;
/** Сканер: автопринятие через 24 ч, предупредительное письмо (жёлтый), руководство (красный), акт и KPI (чёрный). */
export function documentsScan(at = Date.now()): number {
  let changed = 0;
  for (const d of db) {
    const left = documentAcceptHoursLeft(d, at);
    if (left !== undefined && left <= 0) {
      d.status = 'in_progress';
      d.acceptedAt = new Date(new Date(d.assignedAt!).getTime() + DOCUMENT_ACCEPT_HOURS * 3_600_000).toISOString();
      d.autoAccepted = true;
      d.history.push(historyEvent('system', 'status_changed', 'Принято к исполнению автоматически: 24 часа без ответа'));
      changed++;
    }
    const light = documentLight(d, at);
    const link = `/documents/${d.id}`;
    if ((light === 'yellow' || light === 'red' || light === 'black') && !d.warningSentAt && d.control) {
      d.warningSentAt = new Date(at).toISOString();
      d.history.push(historyEvent('system', 'commented', 'Направлено предупредительное письмо исполнителю'));
      notify({ userIds: [d.executorId], kind: 'sla_soon', level: 'warning', title: L(`${d.number}: предупреждение о сроке исполнения`, `${d.number}: ijro muddati haqida ogohlantirish`, `${d.number}: deadline warning`), body: L(`День ${documentDay(d, at)} из ${DOCUMENT_HARD_DAYS}`, `${DOCUMENT_HARD_DAYS} kundan ${documentDay(d, at)}-kun`, `Day ${documentDay(d, at)} of ${DOCUMENT_HARD_DAYS}`), link, dedupeKey: `doc-warn:${d.id}` });
      changed++;
    }
    if ((light === 'red' || light === 'black') && !d.managementNotifiedAt && d.control) {
      d.managementNotifiedAt = new Date(at).toISOString();
      const head = directory.headOf(d.departmentId);
      d.history.push(historyEvent('system', 'commented', 'Критический срок: уведомлено руководство'));
      notify({ userIds: [head?.id ?? '', ...directory.admins().map((u) => u.id)].filter(Boolean), kind: 'escalation', level: 'danger', title: L(`${d.number}: критический срок исполнения`, `${d.number}: kritik ijro muddati`, `${d.number}: critical deadline`), body: L(`Исполнитель: ${directory.user(d.executorId)?.fullName ?? ''}`, `Ijrochi: ${directory.user(d.executorId)?.fullName ?? ''}`, `Executor: ${directory.user(d.executorId)?.fullName ?? ''}`), link, dedupeKey: `doc-red:${d.id}` });
      changed++;
    }
    if (light === 'black' && d.control) {
      const days = documentOverdueDays(d, at);
      if (!d.violation) {
        d.violation = { actNumber: nextNumber('AKT-ID'), at: new Date(at).toISOString(), executorId: d.executorId, departmentId: d.departmentId, overdueDays: days, bonusCutPct: Math.min(100, days * DOCUMENT_BONUS_CUT_PER_DAY) };
        d.history.push(historyEvent('system', 'status_changed', `Сформирован акт «О нарушении исполнительской дисциплины» ${d.violation.actNumber}; направлен в Департамент кадров`));
        notify({ roles: ['hr'], userIds: [d.executorId], kind: 'system', level: 'danger', title: L(`${d.violation.actNumber}: нарушение исполнительской дисциплины`, `${d.violation.actNumber}: ijro intizomi buzilishi`, `${d.violation.actNumber}: executive discipline breach`), body: L(`${d.number} · ${directory.user(d.executorId)?.fullName ?? ''}`, `${d.number} · ${directory.user(d.executorId)?.fullName ?? ''}`, `${d.number} · ${directory.user(d.executorId)?.fullName ?? ''}`), link, dedupeKey: `doc-act:${d.id}` });
        changed++;
      } else if (d.violation.overdueDays !== days && days > 0) {
        d.violation.overdueDays = days;
        d.violation.bonusCutPct = Math.min(100, days * DOCUMENT_BONUS_CUT_PER_DAY);
        changed++;
      }
    }
  }
  lastScan = at;
  return changed;
}
function maybeScan() {
  if (Date.now() - lastScan > 30_000 && documentsScan()) emit();
}

// ---------- Публичный API ----------

export const documentsApi = {
  list(filter: DocumentFilter = {}): Promise<DocumentRecord[]> {
    maybeScan();
    const q = filter.search?.trim().toLowerCase();
    return delay(
      db
        .filter((d) => !filter.kind || d.kind === filter.kind)
        .filter((d) => !filter.status || d.status === filter.status)
        .filter((d) => !filter.type || d.type === filter.type)
        .filter((d) => !filter.executorId || d.executorId === filter.executorId)
        .filter((d) => !filter.departmentId || d.departmentId === filter.departmentId)
        .filter((d) => !filter.source || d.source === filter.source)
        .filter((d) => !filter.overdueOnly || documentIsOverdue(d) || documentLight(d) === 'black')
        .filter((d) => !filter.light || documentLight(d) === filter.light)
        .filter((d) => !q || [d.number, d.subject, d.correspondent, d.correspondentNumber ?? '', d.summary, d.body ?? '', d.ocrText ?? ''].some((x) => x.toLowerCase().includes(q)))
        .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)),
    );
  },

  get: (id: ID): Promise<DocumentRecord | undefined> => {
    maybeScan();
    return delay(byId(id));
  },

  stats(user?: User): Promise<DocumentStats> {
    maybeScan();
    const month = now().slice(0, 7);
    const soon = addDays(3).slice(0, 10);
    const open = db.filter((d) => !isClosed(d));
    const lights = { green: 0, yellow: 0, red: 0, black: 0 };
    for (const d of db) {
      const l = documentLight(d);
      if (l !== 'closed') lights[l]++;
    }
    return delay({
      registeredMonth: db.filter((d) => d.registeredAt.startsWith(month)).length,
      onControl: open.filter((d) => d.control).length,
      overdue: open.filter((d) => documentIsOverdue(d) || documentLight(d) === 'black').length,
      dueSoon: open.filter((d) => d.deadline && d.deadline >= today() && d.deadline <= soon).length,
      pending: db.filter((d) => d.status === 'pending').length,
      awaitingAccept: db.filter((d) => d.status === 'assigned' && (!user || d.executorId === user.id)).length,
      lights,
      inPayment: db.filter((d) => d.status === 'payment').length,
    });
  },

  /** Подсказка департамента по содержанию (форма регистрации). */
  classify: (text: string): Promise<DocumentClassification | undefined> => delay(classifyDocument(text)),

  async register(input: NewDocumentInput, user: User): Promise<DocumentRecord> {
    assertRegistrar(user);
    if (!input.correspondent.trim() || !input.subject.trim() || !input.summary.trim() || !(input.pages > 0)) throw apiError('INVALID_INPUT');
    if (input.control && !input.deadline && !['mib_decision', 'tax_demand', 'collection_order', 'notice'].includes(input.type)) throw apiError('DEADLINE_REQUIRED');
    if (input.type === 'payment_demand' && !input.contractId) throw apiError('CONTRACT_REQUIRED');
    if (input.paymentDetails && (!(input.paymentDetails.amount > 0) || !/^\d{20}$/.test(input.paymentDetails.account) || !/^\d{5}$/.test(input.paymentDetails.mfo))) throw apiError('INVALID_PAYMENT_DETAILS');
    if (input.type === 'aur' && (!input.aur || !(input.aur.amount > 0) || !input.aur.costCenterKey)) throw new Error('AUR details required');
    const at = now().replace(/\.\d{3}Z$/, 'Z');
    const hard = input.kind === 'incoming' && (['mib_decision', 'tax_demand', 'collection_order', 'notice'].includes(input.type) || input.source === 'soliq' || input.source === 'mib');
    const doc: DocumentRecord = {
      id: nextId('doc'),
      number: `${PREFIX[input.kind]}-2026-${String(++regSeq).padStart(5, '0')}`,
      kind: input.kind,
      type: input.type,
      source: input.source ?? 'manual',
      correspondent: input.correspondent.trim(),
      ...(input.correspondentNumber ? { correspondentNumber: input.correspondentNumber } : {}),
      subject: input.subject.trim(),
      summary: input.summary.trim(),
      ...(input.body ? { body: input.body } : {}),
      ...(input.ocrText ? { ocrText: input.ocrText } : {}),
      registeredAt: at,
      ...(hard ? { deadline: new Date(new Date(at).getTime() + DOCUMENT_HARD_DAYS * DAY).toISOString().slice(0, 10), hardDeadline: true } : input.deadline ? { deadline: input.deadline } : {}),
      executorId: input.executorId,
      departmentId: input.departmentId,
      priority: input.priority,
      control: input.control || hard,
      status: input.submit ? 'pending' : 'registered',
      pages: input.pages,
      ...(input.contractId ? { contractId: input.contractId } : {}),
      ...(input.paymentDetails ? { paymentDetails: input.paymentDetails } : {}),
      ...(input.aur ? { aur: { ...input.aur, opDay: today() } } : {}),
      retentionYears: DOCUMENT_RETENTION[input.type],
      history: [historyEvent(user.id, 'created', input.source === 'scan' ? 'Зарегистрирован по скан-образу' : undefined)],
    };
    const cls = classifyDocument(`${doc.subject} ${doc.summary} ${doc.ocrText ?? ''}`);
    if (cls && cls.departmentId === doc.departmentId) doc.autoRouted = { departmentId: cls.departmentId, keywords: cls.keywords };
    db.push(doc);
    audit.log({ action: 'create', entity: 'document', entityId: doc.id, entityLabel: doc.number, details: `${doc.kind}/${doc.type}`, user: who(user) });
    if (input.submit) {
      doc.history.push(historyEvent(user.id, 'submitted'));
      openRoute(doc, user);
    }
    emit();
    return delay(doc);
  },

  async submit(id: ID, user: User): Promise<void> {
    const d = byId(id);
    if (!d || d.status !== 'registered') throw apiError('DOCUMENT_CANNOT_BE_SUBMITTED');
    d.status = 'pending';
    d.history.push(historyEvent(user.id, 'submitted'));
    openRoute(d, user);
    emit();
    await delay(null);
  },

  /** Резолюция руководителя: поручение исполнителю со сроком; исполнитель получает 24 ч на принятие. */
  async setResolution(id: ID, user: User, input: { text: string; executorId: ID; deadline?: string; control: boolean }): Promise<void> {
    if (!canResolveDocuments(user)) throw apiError('NOT_ALLOWED');
    if (!input.text.trim()) throw apiError('TEXT_REQUIRED');
    const d = byId(id);
    if (!d || isClosed(d) || d.status === 'pending' || d.status === 'payment') throw apiError('DOCUMENT_IS_CLOSED');
    const before = { executorId: d.executorId, deadline: d.deadline ?? '', control: String(d.control) };
    d.resolution = { authorId: user.id, text: input.text, at: now() };
    const changedExecutor = d.executorId !== input.executorId;
    d.executorId = input.executorId;
    const ex = directory.user(input.executorId);
    if (ex && d.kind === 'incoming') d.departmentId = ex.departmentId;
    if (input.deadline && !d.hardDeadline) d.deadline = input.deadline;
    d.control = input.control || !!d.hardDeadline;
    if (d.status === 'registered' || (changedExecutor && ['assigned', 'in_progress'].includes(d.status))) {
      d.status = d.kind === 'incoming' ? 'assigned' : 'in_progress';
      d.assignedAt = now();
      delete d.acceptedAt;
      delete d.autoAccepted;
      delete d.declineReason;
      if (d.kind === 'incoming') notifyAssigned(d);
    }
    d.history.push(historyEvent(user.id, 'commented', `Резолюция: ${input.text}`));
    audit.log({ action: 'update', entity: 'document', entityId: d.id, entityLabel: d.number, changes: [
      { field: 'executorId', from: before.executorId, to: d.executorId },
      { field: 'deadline', from: before.deadline, to: d.deadline ?? '' },
      { field: 'control', from: before.control, to: String(d.control) },
    ].filter((c) => c.from !== c.to), details: input.text, user: who(user) });
    emit();
    await delay(null);
  },

  /** Принять к исполнению (в течение 24 ч). */
  async accept(id: ID, user: User): Promise<void> {
    const d = byId(id);
    if (!d || d.status !== 'assigned') throw apiError('NOT_ASSIGNED');
    if (!isExecutor(d, user)) throw apiError('NOT_ALLOWED');
    d.status = 'in_progress';
    d.acceptedAt = now();
    d.history.push(historyEvent(user.id, 'status_changed', 'Принято к исполнению'));
    audit.log({ action: 'approve', entity: 'document', entityId: d.id, entityLabel: d.number, details: 'accepted', user: who(user) });
    emit();
    await delay(null);
  },

  /** Отклонить с обоснованием (в течение 24 ч) — документ возвращается регистратору / руководителю. */
  async decline(id: ID, user: User, reason: string): Promise<void> {
    const d = byId(id);
    if (!d || d.status !== 'assigned') throw apiError('NOT_ASSIGNED');
    if (!isExecutor(d, user)) throw apiError('NOT_ALLOWED');
    if (!reason.trim()) throw apiError('REASON_REQUIRED');
    d.status = 'registered';
    d.declineReason = reason.trim();
    d.history.push(historyEvent(user.id, 'rejected', `Отклонено исполнителем: ${reason.trim()}`));
    notify({ userIds: [d.resolution?.authorId ?? '', ...directory.byRole('admin').map((u) => u.id)].filter(Boolean), excludeIds: [user.id], kind: 'rejected', level: 'warning', title: L(`${d.number}: исполнитель отклонил документ`, `${d.number}: ijrochi hujjatni rad etdi`, `${d.number}: executor declined the document`), body: reason.trim(), link: `/documents/${d.id}` });
    audit.log({ action: 'reject', entity: 'document', entityId: d.id, entityLabel: d.number, details: reason, user: who(user) });
    emit();
    await delay(null);
  },

  /** Распознать скан-образ (OCR): текстовый слой PDF / текстовые файлы; реквизиты платежа извлекаются автоматически. */
  async recognize(id: ID, user: User, fileId: ID): Promise<{ text: string; extracted: boolean }> {
    const d = byId(id);
    if (!d) throw apiError('NOT_FOUND');
    const f = await filesApi.content(fileId);
    let text = '';
    if (f.mime.startsWith('text/') || /\.(txt|csv|md|xml|json)$/i.test(f.name)) text = utf8Decode(f.data);
    else if (f.mime === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      const raw = utf8Decode(f.data);
      text = [...raw.matchAll(/\(([^()]{2,})\)\s*T[jJ]/g)].map((m) => m[1]).join(' ');
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) text = `[OCR] ${f.name}: ${d.subject}. ${d.summary}`;
    d.ocrText = text.slice(0, 4000);
    let extracted = false;
    if (DOCUMENT_PAYMENT_TYPES.includes(d.type) && !d.paymentDetails) {
      const p = extractPaymentDetails(text, d.subject);
      if (p) {
        d.paymentDetails = p;
        extracted = true;
      }
    }
    d.history.push(historyEvent(user.id, 'status_changed', `Распознан текст скан-образа (${f.name})${extracted ? '; извлечены реквизиты платежа' : ''}`));
    emit();
    return delay({ text: d.ocrText, extracted });
  },

  /** Загрузка писем my3.soliq.uz и решений МИБ (PR-DOC-007): секунда загрузки — день 0, автонаправление по содержанию. */
  async loadFromSources(user: User, sources: ('soliq' | 'mib')[] = ['soliq', 'mib']): Promise<DocumentIntakeResult> {
    assertRegistrar(user);
    const created: DocumentIntakeResult['created'] = [];
    let status = 'success';
    let exchangeId = '';
    for (const src of sources) {
      const rec = src === 'soliq' ? await integrationHub.call('soliq', 'letters.receive', { since: new Date(Date.now() - DAY).toISOString() }, { userId: user.id }) : await integrationHub.call('mysud', 'decisions.receive', { since: new Date(Date.now() - DAY).toISOString() }, { userId: user.id });
      exchangeId = rec.id;
      if (rec.status !== 'success') {
        status = rec.status;
        continue;
      }
      const idx = inbox.findIndex((x) => x.source === src);
      if (idx < 0) continue;
      const s = inbox.splice(idx, 1)[0]!;
      const cls = classifyDocument(`${s.subject} ${s.text}`);
      const departmentId = cls?.departmentId ?? 'd2';
      const executorId = cls?.executorId ?? directory.headOf(departmentId)?.id ?? directory.admins()[0]!.id;
      const at = now().replace(/\.\d{3}Z$/, 'Z');
      const doc: DocumentRecord = {
        id: nextId('doc'),
        number: `VH-2026-${String(++regSeq).padStart(5, '0')}`,
        kind: 'incoming',
        type: s.type,
        source: s.source,
        correspondent: s.correspondent,
        correspondentNumber: s.correspondentNumber,
        subject: s.subject,
        summary: s.text.slice(0, 220),
        ocrText: s.text,
        registeredAt: at,
        deadline: new Date(new Date(at).getTime() + DOCUMENT_HARD_DAYS * DAY).toISOString().slice(0, 10),
        hardDeadline: true,
        executorId,
        departmentId,
        ...(cls ? { autoRouted: { departmentId: cls.departmentId, keywords: cls.keywords } } : {}),
        priority: DOCUMENT_PAYMENT_TYPES.includes(s.type) ? 'high' : 'normal',
        control: true,
        status: 'assigned',
        assignedAt: at,
        pages: 1,
        retentionYears: DOCUMENT_RETENTION[s.type],
        history: [historyEvent(user.id, 'created', `Загружено из ${src === 'soliq' ? 'my3.soliq.uz' : 'МИБ'} (обмен ${rec.id}); направлено по содержанию: ${directory.department(departmentId)?.name.ru ?? departmentId}`)],
      };
      if (DOCUMENT_PAYMENT_TYPES.includes(s.type)) {
        const p = extractPaymentDetails(s.text, s.subject);
        if (p) doc.paymentDetails = p;
      }
      db.push(doc);
      notifyAssigned(doc);
      created.push({ id: doc.id, number: doc.number, type: doc.type });
    }
    audit.log({ action: 'create', entity: 'document', entityId: exchangeId, details: `intake ${sources.join('+')}: ${created.length}`, user: who(user) });
    emit();
    return delay({ exchangeId, status: created.length ? 'success' : status, created });
  },

  /** Ответ исполнителя: файл (скан ответного письма / платёжного поручения) обязателен (PR-DOC-024). */
  async submitResponse(id: ID, user: User, fileId: ID, note: string): Promise<void> {
    const d = byId(id);
    if (!d || !['in_progress', 'payment'].includes(d.status)) throw apiError('RESPONSE_NOT_EXPECTED');
    if (!isExecutor(d, user)) throw apiError('NOT_ALLOWED');
    const files = await filesApi.list('document', d.id);
    if (!files.some((f) => f.id === fileId)) throw apiError('FILE_REQUIRED');
    d.responseFileId = fileId;
    if (note.trim()) d.responseNote = note.trim();
    else delete d.responseNote;
    d.history.push(historyEvent(user.id, 'status_changed', `Загружен ответ: ${files.find((f) => f.id === fileId)?.name ?? ''}${note.trim() ? ` — ${note.trim()}` : ''}`));
    const ctl = [d.resolution?.authorId, directory.headOf(d.departmentId)?.id].filter((x): x is string => !!x && x !== user.id);
    notify({ userIds: ctl.length ? ctl : directory.admins().map((u) => u.id), kind: 'task', level: 'info', title: L(`${d.number}: ответ загружен — подтвердите`, `${d.number}: javob yuklandi — tasdiqlang`, `${d.number}: response uploaded — confirm`), link: `/documents/${d.id}` });
    emit();
    await delay(null);
  },

  /** Подтвердить файл ответа — статус «Ответ дан» (PR-DOC-025); документ уходит в архив. */
  async confirmResponse(id: ID, user: User): Promise<void> {
    const d = byId(id);
    if (!d || !d.responseFileId || !['in_progress', 'payment'].includes(d.status)) throw apiError('NOTHING_TO_CONFIRM');
    if (!canResolveDocuments(user) && d.resolution?.authorId !== user.id) throw apiError('NOT_ALLOWED');
    if (d.executorId === user.id && !directory.hasRole(user, 'admin')) throw apiError('EXECUTOR_CANNOT_CONFIRM_OWN_RESPONSE');
    d.status = d.payment?.status === 'paid' ? 'done' : 'answered';
    d.responseConfirmedBy = user.id;
    d.responseConfirmedAt = now();
    d.history.push(historyEvent(user.id, 'approved', 'Файл ответа подтверждён: «Ответ дан»'));
    audit.log({ action: 'approve', entity: 'document', entityId: d.id, entityLabel: d.number, details: 'response confirmed', user: who(user) });
    if (d.source === 'soliq') void integrationHub.call('soliq', 'letter.reply', { number: d.number, inReplyTo: d.correspondentNumber ?? '' }, { idempotencyKey: `doc-reply-${d.id}`, userId: user.id, background: true }).catch(() => undefined);
    await archiveDoc(d, user.id);
    emit();
    await delay(null);
  },

  /** Исполнение внутреннего документа (приказ доведён, протокол оформлен) — без ответа внешнему адресату. */
  async complete(id: ID, user: User, note: string): Promise<void> {
    const d = byId(id);
    if (!d || !['registered', 'in_progress'].includes(d.status)) throw apiError('DOCUMENT_CANNOT_BE_COMPLETED');
    if (d.kind === 'incoming') throw apiError('RESPONSE_FILE_REQUIRED');
    if (d.kind === 'outgoing') throw apiError('USE_SEND');
    if (!isExecutor(d, user)) throw apiError('NOT_ALLOWED');
    d.status = 'done';
    d.history.push(historyEvent(user.id, 'status_changed', `Исполнено${note ? `: ${note}` : ''}`));
    await archiveDoc(d, user.id);
    emit();
    await delay(null);
  },

  /** Зафиксировать подпись E-IMZO документа (запись создаёт платформенный SignModal). */
  async attachSignature(id: ID, user: User, signatureId: ID): Promise<void> {
    const d = byId(id);
    const s = signatureService.get(signatureId);
    if (!d || !s || s.entity !== 'document' || s.entityId !== id || s.userId !== user.id) throw apiError('SIGNATURE_NOT_FOUND');
    d.signatureIds = [...(d.signatureIds ?? []), s.id];
    d.history.push(historyEvent(user.id, 'approved', `Подписано ЭЦП E-IMZO (серт. ${s.certSerial})`));
    emit();
    await delay(null);
  },

  /** Регистрация и электронная отправка исходящего адресату (требуется подпись ЭЦП, PR-DOC-002, 012). */
  async send(id: ID, user: User): Promise<void> {
    const d = byId(id);
    if (!d || d.kind !== 'outgoing' || d.status !== 'in_progress') throw apiError('DOCUMENT_CANNOT_BE_SENT');
    if (!isExecutor(d, user) && !canResolveDocuments(user)) throw apiError('NOT_ALLOWED');
    if (!d.signatureIds?.length) throw apiError('SIGNATURE_REQUIRED');
    const tax = /гни|налог|soliq/i.test(d.correspondent);
    const rec = tax
      ? await integrationHub.call('soliq', 'letter.reply', { number: d.number, inReplyTo: d.correspondentNumber ?? '' }, { idempotencyKey: `doc-send-${d.id}`, userId: user.id })
      : await integrationHub.call('mygov', 'edo.send', { number: d.number, addressee: d.correspondent }, { idempotencyKey: `doc-send-${d.id}`, userId: user.id });
    d.sentExchangeId = rec.id;
    if (rec.status === 'success') {
      d.sentAt = now();
      d.status = 'done';
      d.history.push(historyEvent(user.id, 'status_changed', `Отправлено адресату в электронном виде (${tax ? 'my3.soliq.uz' : 'межведомственный ЭДО'}, обмен ${rec.id})`));
      await archiveDoc(d, user.id);
    } else d.history.push(historyEvent(user.id, 'status_changed', `Отправка: ${rec.status} — повтор после восстановления канала`));
    emit();
    await delay(null);
  },

  /** «Отправить на оплату» — Акцепт исполнителя (PR-DOC-031, 032); сверх 50 млн — второе подтверждение (PR-DOC-034). */
  async acceptPayment(id: ID, user: User): Promise<void> {
    const d = byId(id);
    if (!d || !d.paymentDetails || d.status !== 'in_progress') throw apiError('PAYMENT_NOT_AVAILABLE');
    if (!isExecutor(d, user)) throw apiError('NOT_ALLOWED');
    if (d.payment && !['rejected'].includes(d.payment.status)) throw apiError('PAYMENT_EXISTS');
    if (d.type === 'payment_demand' && !d.contractId) throw apiError('CONTRACT_REQUIRED');
    const second = d.paymentDetails.amount > DOCUMENT_PAYMENT_THRESHOLD;
    d.payment = { orderNumber: d.payment?.orderNumber ?? nextNumber('MO'), status: second ? 'second_approval' : 'draft', acceptedBy: user.id, acceptedAt: now(), secondApproval: second };
    d.history.push(historyEvent(user.id, 'approved', `Акцепт исполнителя: «Отправить на оплату» (${d.payment.orderNumber})`));
    audit.log({ action: 'approve', entity: 'document', entityId: d.id, entityLabel: d.number, details: `payment accept ${d.paymentDetails.amount}${second ? ' (2nd approval)' : ''}`, user: who(user) });
    if (second) {
      d.status = 'payment';
      approvalEngine.open({ entity: 'doc_payment', entityId: `${d.id}:pay`, number: d.payment.orderNumber, title: `${typeRu[d.type]} ${d.correspondentNumber ?? d.number}: ${d.paymentDetails.purpose}`, requesterId: user.id, amount: d.paymentDetails.amount, context: { subtype: d.type, documentId: d.id } });
    } else await sendPaymentToAbs(d, user.id);
    emit();
    await delay(null);
  },

  /** Повторная отправка платежа в АБС (после восстановления связи). */
  async resendPayment(id: ID, user: User): Promise<void> {
    const d = byId(id);
    if (!d?.payment || d.payment.status !== 'queued') throw apiError('NOTHING_TO_RESEND');
    if (!isExecutor(d, user) && !can(user, 'documents', 'approve')) throw apiError('NOT_ALLOWED');
    await sendPaymentToAbs(d, user.id);
    await delay(null);
  },

  /** Статус списания из АБС: «Исполнено», МФО и № транзакции, ответ «Задолженность закрыта» (PR-DOC-033, 035, 036). */
  async syncPaymentStatus(id: ID, user: User): Promise<void> {
    const d = byId(id);
    const p = d?.payment;
    if (!d || !p || !['ready', 'in_payment'].includes(p.status)) throw apiError('NO_PAYMENT_IN_PROGRESS');
    const rec = await integrationHub.call('iabs', 'payment.status', { doc: p.orderNumber }, { userId: user.id });
    if (rec.status !== 'success') throw new Error('ABS unavailable');
    const r = rec.response as { status?: string; transaction?: string; mfo?: string } | undefined;
    p.status = 'paid';
    p.paidAt = now();
    p.mfo = r?.mfo ?? d.paymentDetails?.mfo ?? '';
    p.transactionId = r?.transaction ?? rec.id;
    p.debtClosedAt = now();
    d.status = 'done';
    d.responseNote = `Задолженность закрыта: оплата ${d.paymentDetails?.amount ?? 0} сум, МФО ${p.mfo}, транзакция ${p.transactionId}`;
    d.responseConfirmedAt = d.responseConfirmedAt ?? now();
    d.history.push(historyEvent(user.id, 'status_changed', `Списание подтверждено АБС (МФО ${p.mfo}, ${p.transactionId}); статус «Исполнено», ответ «Задолженность закрыта» подготовлен`));
    if (d.source === 'mib' || d.type === 'mib_decision') void integrationHub.call('mysud', 'debt.closed', { doc: d.correspondentNumber ?? d.number, transaction: p.transactionId, mfo: p.mfo }, { idempotencyKey: `doc-debt-${d.id}`, userId: user.id, background: true }).catch(() => undefined);
    if (d.source === 'soliq') void integrationHub.call('soliq', 'letter.reply', { number: d.number, inReplyTo: d.correspondentNumber ?? '', status: 'debt_closed' }, { idempotencyKey: `doc-debt-${d.id}`, userId: user.id, background: true }).catch(() => undefined);
    await archiveDoc(d, user.id);
    emit();
    await delay(null);
  },

  /** Отчёт по исполнительской дисциплине по исполнителям (PR-DOC-013, 027). */
  discipline(filter: { from?: string; to?: string; departmentId?: ID } = {}): Promise<DocumentDisciplineRow[]> {
    maybeScan();
    const list = db.filter((d) => d.control && d.kind === 'incoming' && (!filter.from || d.registeredAt.slice(0, 10) >= filter.from) && (!filter.to || d.registeredAt.slice(0, 10) <= filter.to) && (!filter.departmentId || d.departmentId === filter.departmentId));
    const map = new Map<ID, DocumentDisciplineRow>();
    for (const d of list) {
      const r = map.get(d.executorId) ?? { executorId: d.executorId, departmentId: directory.user(d.executorId)?.departmentId ?? d.departmentId, total: 0, closed: 0, onTime: 0, open: 0, overdue: 0, black: 0, overdueDays: 0, bonusCutPct: 0, autoAccepted: 0 };
      r.total++;
      const days = documentOverdueDays(d);
      if (isClosed(d)) {
        r.closed++;
        if (!days) r.onTime++;
      } else r.open++;
      if (days) {
        r.overdue++;
        r.overdueDays += days;
      }
      if (documentLight(d) === 'black') r.black++;
      if (d.autoAccepted) r.autoAccepted++;
      map.set(d.executorId, r);
    }
    return delay([...map.values()].map((r) => ({ ...r, bonusCutPct: Math.min(100, r.overdueDays * DOCUMENT_BONUS_CUT_PER_DAY) })).sort((a, b) => b.overdueDays - a.overdueDays || b.total - a.total));
  },

  /** Акты о нарушении исполнительской дисциплины. */
  violations(): Promise<DocumentRecord[]> {
    maybeScan();
    return delay(db.filter((d) => d.violation).sort((a, b) => b.violation!.at.localeCompare(a.violation!.at)));
  },

  // ----- АУР: сводная папка операционного дня (PR-DOC-004, 005, 006, 016) -----

  async aurReconcile(opDay: string, user: User): Promise<DocumentAurReconciliation> {
    const docs = db.filter((d) => d.type === 'aur' && d.aur?.opDay === opDay && d.status !== 'rejected');
    const existing = aurDays.get(opDay);
    if (existing?.closed) return delay(existing);
    const rec = await integrationHub.call('iabs', 'journal.get', { date: opDay }, { userId: user.id });
    if (rec.status !== 'success') throw new Error('ABS unavailable');
    // Журнал АБС (имитация): проводки по счетам расходов АУР за день. На демо-дату — одна проводка без документа.
    const journal = docs.map((d) => ({ ref: d.number, amount: d.aur!.amount, account: '56802000', matched: true }));
    if (opDay === today() && docs.length >= 3) journal.push({ ref: 'ЖО-56802-0177', amount: 2_350_000, account: '56802000', matched: false });
    const r: DocumentAurReconciliation = {
      opDay,
      docs: docs.map((d) => ({ id: d.id, number: d.number, amount: d.aur!.amount, costCenterKey: d.aur!.costCenterKey, article: d.aur!.article, matched: journal.some((j) => j.ref === d.number && j.amount === d.aur!.amount) })),
      journal,
      docsTotal: docs.reduce((s, d) => s + d.aur!.amount, 0),
      journalTotal: journal.reduce((s, j) => s + j.amount, 0),
      diff: 0,
      exchangeId: rec.id,
      closed: false,
    };
    r.diff = r.journalTotal - r.docsTotal;
    aurDays.set(opDay, r);
    emit();
    return delay(r);
  },

  getAurDay: (opDay: string): Promise<DocumentAurReconciliation | undefined> => delay(aurDays.get(opDay)),

  /** Закрыть операционный день: сводная папка АУР передаётся в электронный архив. Расхождения — с обоснованием. */
  async aurCloseDay(opDay: string, user: User, justification?: string): Promise<DocumentAurReconciliation> {
    if (!can(user, 'documents', 'approve') && !can(user, 'einvoices', 'edit')) throw apiError('NOT_ALLOWED');
    const r = aurDays.get(opDay);
    if (!r || r.closed) throw apiError('RECONCILE_FIRST');
    if (r.diff !== 0 && !justification?.trim()) throw apiError('JUSTIFICATION_REQUIRED');
    const docs = db.filter((d) => r.docs.some((x) => x.id === d.id));
    const res = await archiveApi.receiveElectronic({
      source: 'sed',
      sourceRef: `AUR-${opDay}`,
      docNumber: `АУР-${opDay}`,
      docDate: opDay,
      title: `Сводная папка АУР за ${opDay}: ${docs.length} док., ${r.docsTotal} сум`,
      kind: 'Сводная папка АУР',
      departmentId: 'd7',
      responsibleId: user.id,
      pages: docs.reduce((s, d) => s + d.pages, 0),
      text: [...docs.map((d) => `${d.number} ${d.subject} ${d.aur!.amount} ${d.aur!.costCenterKey}`), justification ? `Расхождение ${r.diff}: ${justification}` : ''].filter(Boolean).join('\n'),
      content: r,
      nomenclatureIndex: '07-01',
    }, user);
    r.closed = true;
    r.closedAt = now();
    r.closedBy = user.id;
    r.archiveRef = res.number;
    for (const d of docs) {
      d.archivedAt = now();
      d.archiveRef = res.number;
      d.history.push(historyEvent(user.id, 'status_changed', `Сведён в сводную папку АУР за ${opDay} и передан в архив (${res.number})`));
    }
    audit.log({ action: 'approve', entity: 'document_aur_day', entityId: opDay, details: `closed: ${docs.length}, diff ${r.diff}${justification ? `: ${justification}` : ''}`, user: who(user) });
    emit();
    return delay(r);
  },

  /** Регистрация внутреннего документа другим модулем (приказ о командировке — PR-TRV-003). */
  async registerInternal(input: { type: DocumentCategory; subject: string; summary: string; body?: string; departmentId: ID; executorId: ID; correspondent: string }, user: User): Promise<DocumentRecord> {
    const at = now().replace(/\.\d{3}Z$/, 'Z');
    const doc: DocumentRecord = {
      id: nextId('doc'),
      number: `VN-2026-${String(++regSeq).padStart(5, '0')}`,
      kind: 'internal',
      type: input.type,
      source: 'manual',
      correspondent: input.correspondent,
      subject: input.subject,
      summary: input.summary,
      ...(input.body ? { body: input.body } : {}),
      registeredAt: at,
      executorId: input.executorId,
      departmentId: input.departmentId,
      priority: 'normal',
      control: false,
      status: 'done',
      pages: 1,
      retentionYears: DOCUMENT_RETENTION[input.type],
      history: [historyEvent(user.id, 'created', 'Зарегистрирован автоматически в журнале приказов')],
    };
    db.push(doc);
    audit.log({ action: 'create', entity: 'document', entityId: doc.id, entityLabel: doc.number, details: `auto ${input.type}`, user: who(user) });
    emit();
    return delay(doc);
  },
};

export { typeRu as documentTypeNamesRu };
