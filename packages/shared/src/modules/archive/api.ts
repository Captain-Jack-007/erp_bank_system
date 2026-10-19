// API модуля «Архив» (ARXIV 360, ТЗ 4.2.10): приём и регистрация документов (вручную, из модулей ERP и систем
// Банка через интеграционную шину), реестр принятых документов, формирование дел по номенклатуре и проверка
// полноты, сдача-приём в архив с актом и ЭЦП, учёт места хранения, выдача и копии, сроки хранения, уничтожение
// и передача в госархив через экспертную комиссию (движок согласований), журнал движения, отчёты.
import { addDays, clone, delay, emit, nextId, nextNumber, now, today } from '../../bus';
import { audit, type AuditAction } from '../../audit';
import { directory } from '../../directory';
import { approvalEngine } from '../../engine';
import { tk, translate } from '../../i18n';
import { notify } from '../../notifications';
import { matches, registerSearchProvider } from '../../search';
import { can } from '../../security';
import { sha256Hex } from '../../services/bytes';
import { canonicalize, checkSignature, signatureService } from '../../services/signature';
import { integrationHub } from '../../services/integrations';
import type { ID, Localized, User } from '../../types';
import { registerDocsIntegrationOps } from '../documents/integrationOps';
import { archiveActSeed, archiveCaseSeed, archiveDocumentSeed, archiveErrorSeed, archiveNomenclatureSeed, archiveRequestSeed, archiveTaskSeed } from './data';
import type {
  ArchiveCase,
  ArchiveCaseFilter,
  ArchiveCheck,
  ArchiveDestructionAct,
  ArchiveDisciplineRow,
  ArchiveDocument,
  ArchiveFormCaseInput,
  ArchiveFundRow,
  ArchiveIntakeError,
  ArchiveIntakeInput,
  ArchiveLocation,
  ArchiveMovement,
  ArchiveMovementReportRow,
  ArchiveNomenclatureItem,
  ArchiveRequest,
  ArchiveSearchFilter,
  ArchiveSearchHit,
  ArchiveSource,
  ArchiveSourceInfo,
  ArchiveStats,
  ArchiveTransferTask,
} from './types';
import { apiError } from '../../errors';

registerDocsIntegrationOps();

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const DAY = 86_400_000;
const checksumOf = (content: unknown) => sha256Hex(canonicalize(content));
let uidSeq = 10_240;
const newUid = () => `ARC-2026-${String(++uidSeq).padStart(6, '0')}`;

function normalizeDoc(d: (typeof archiveDocumentSeed)[number], cases: ArchiveCase[]): ArchiveDocument {
  const c = cases.find((x) => x.id === d.caseId);
  const createdAt = d.createdAt ?? `${d.docDate}T09:00:00Z`;
  const content = { number: d.docNumber, date: d.docDate, title: d.title, kind: d.kind, text: d.text ?? '' };
  const checksum = checksumOf(content);
  return {
    ...d,
    uid: newUid(),
    source: d.source ?? 'migration',
    departmentId: d.departmentId ?? c?.departmentId ?? 'd2',
    createdAt,
    receivedAt: d.receivedAt ?? (c ? `${c.transferredAt}T09:00:00Z` : createdAt),
    checksum,
    version: 1,
    versions: [{ version: 1, at: createdAt, by: 'u16', checksum, note: 'Начальная версия' }],
    movements: [{ at: d.receivedAt ?? createdAt, userId: 'u16', action: 'received', details: d.source ? `Источник: ${d.source}` : 'Миграция данных прошлых лет' }],
  };
}

const db = (() => {
  const cases = clone(archiveCaseSeed);
  return {
    nomenclature: clone(archiveNomenclatureSeed),
    cases,
    documents: clone(archiveDocumentSeed).map((d) => normalizeDoc(d, cases)),
    requests: clone(archiveRequestSeed),
    acts: clone(archiveActSeed),
    tasks: clone(archiveTaskSeed),
    errors: clone(archiveErrorSeed),
    /** Источник и исходный документ → контент для повторной проверки целостности. */
    contents: new Map<ID, unknown>(),
  };
})();
for (const d of db.documents) db.contents.set(d.id, { number: d.docNumber, date: d.docDate, title: d.title, kind: d.kind, text: d.text ?? '' });

/** Срок хранения истёк — дело подлежит экспертизе и уничтожению. */
function refreshExpired() {
  const d = today();
  for (const c of db.cases) if (c.status === 'stored' && c.retentionUntil && c.retentionUntil < d) c.status = 'expired';
}
refreshExpired();

const caseById = (id: ID) => db.cases.find((c) => c.id === id);
const nomById = (id: ID) => db.nomenclature.find((n) => n.id === id);
const inActs = (caseId: ID) => db.acts.some((a) => ['draft', 'pending', 'approved'].includes(a.status) && a.caseIds.includes(caseId));
const who = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });
function log(user: User, action: AuditAction, entity: string, entityId: string, label: string, details?: string) {
  audit.log({ action, entity, entityId, entityLabel: label, ...(details ? { details } : {}), user: who(user) });
}
function move(target: { movements: ArchiveMovement[] }, user: User | ID, action: ArchiveMovement['action'], details?: string) {
  target.movements.push({ at: now(), userId: typeof user === 'string' ? user : user.id, action, ...(details ? { details } : {}) });
}

/** Архивариус: приём дел, выдача, акты, перемещение, ошибки приёма (матрица прав: archive ≥ approve). */
export function canManageArchive(user: User): boolean {
  return can(user, 'archive', 'approve');
}
/** Подразделение: формирование и сдача дел, ввод документов (archive ≥ edit). */
export function canSubmitArchive(user: User): boolean {
  return can(user, 'archive', 'edit');
}
function assertManager(user: User) {
  if (!canManageArchive(user)) throw apiError('NOT_ALLOWED');
}
function assertSubmitter(user: User) {
  if (!canSubmitArchive(user)) throw apiError('NOT_ALLOWED');
}

/** Видимость дел и документов: гриф «ДСП» — архив, аудит и подразделение-владелец (PR-ARC-054). */
export function archiveCanSee(user: User | null | undefined, item: { restricted?: boolean; departmentId: ID }): boolean {
  if (!item.restricted) return true;
  if (!user) return false;
  return canManageArchive(user) || can(user, 'audit', 'view') || user.departmentId === item.departmentId;
}

/** Номенклатура для вида документа (или по индексу). */
function nomenclatureFor(kind: string, index?: string): ArchiveNomenclatureItem | undefined {
  return (index ? db.nomenclature.find((n) => n.index === index) : undefined) ?? db.nomenclature.find((n) => n.kinds?.includes(kind));
}

registerSearchProvider((q, lang) => [
  ...db.cases
    .filter((c) => !c.restricted && matches(q, c.number, c.title))
    .map((c) => ({ group: 'archive_title', title: `${c.number} · ${c.title}`, subtitle: translate(lang, tk('archive_status_', c.status)), to: `/archive/${c.id}` })),
  ...db.documents
    .filter((d) => !d.restricted && matches(q, d.docNumber, d.title, d.uid))
    .flatMap((d) => {
      const c = d.caseId ? caseById(d.caseId) : undefined;
      if (c && c.status === 'destroyed') return [];
      return [{ group: 'archive_title', title: `${d.docNumber} · ${d.title}`, subtitle: c ? `${translate(lang, 'archive_inCase')} ${c.number}` : d.uid, to: c ? `/archive/${c.id}` : `/archive/docs/${d.id}` }];
    }),
]);

export function archiveRequestOverdue(r: Pick<ArchiveRequest, 'status' | 'dueBack'>): boolean {
  return r.status === 'issued' && r.dueBack < today();
}

// ---------- Согласование актов (экспертная комиссия, PR-ARC-002, 015, 027) ----------

approvalEngine.register('archive_act', {
  onHistory: (id, e) => db.acts.find((a) => a.id === id)?.history.push({ at: e.at, userId: e.userId, action: e.action, ...(e.comment ? { comment: e.comment } : {}) }),
  onFinal: (id, ok) => {
    const act = db.acts.find((a) => a.id === id);
    if (!act) return;
    act.status = ok ? 'approved' : 'rejected';
    if (!ok) act.rejectReason = act.history.filter((h) => h.action === 'rejected').slice(-1)[0]?.comment ?? '';
    notify({ roles: ['archivist'], kind: ok ? 'approved' : 'rejected', level: ok ? 'success' : 'danger', title: L(`${act.number}: ${ok ? 'согласован комиссией' : 'отклонён'}`, `${act.number}: ${ok ? 'komissiya tasdiqladi' : 'rad etildi'}`, `${act.number}: ${ok ? 'approved by commission' : 'rejected'}`), link: `/archive/acts/${act.id}` });
  },
  onReturned: (id, comment) => {
    const act = db.acts.find((a) => a.id === id);
    if (act) {
      act.status = 'draft';
      act.rejectReason = comment;
    }
  },
  getContext: (id) => {
    const act = db.acts.find((a) => a.id === id);
    return act ? { subtype: act.kind } : undefined;
  },
});

// ---------- Источники данных для электронного архива (PR-ARC-009, 010, 028…032, 048) ----------

export interface ArchiveSourceProvider {
  name: Localized;
  pending: () => number;
  pull: (user: User) => Promise<number>;
}
const providers = new Map<ArchiveSource, ArchiveSourceProvider>();
/** Модуль ERP регистрирует себя как источник документов для электронного архива. */
export function registerArchiveSource(id: ArchiveSource, p: ArchiveSourceProvider): void {
  providers.set(id, p);
}

const SYSTEM_SOURCES: { id: ArchiveSource; name: Localized }[] = [
  { id: 'abs', name: L('АБС: данные операционного дня', 'ABS: operatsion kun maʼlumotlari', 'Core banking: operational day') },
  { id: 'dwh', name: L('DWH: электронные реестры и отчёты', 'DWH: elektron reestrlar va hisobotlar', 'DWH: electronic registers and reports') },
  { id: 'integration', name: L('Протоколы информационного обмена', "Axborot almashinuvi protokollari", 'Information exchange protocols') },
  { id: 'audit', name: L('Системные журналы и данные аудита', 'Tizim jurnallari va audit maʼlumotlari', 'System logs and audit data') },
];
const pulledDays = new Set<string>();

// ---------- Приём документа (общая точка) ----------

const REQUIRED: (keyof ArchiveIntakeInput)[] = ['docNumber', 'docDate', 'title', 'kind', 'departmentId'];

function intakeError(input: Partial<ArchiveIntakeInput> & { source: ArchiveSource }, reason: ArchiveIntakeError['reason'], details: string, exchangeId?: ID): ArchiveIntakeError {
  const e: ArchiveIntakeError = { id: nextId('ae'), at: now(), source: input.source, ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}), ...(input.docNumber ? { docNumber: input.docNumber } : {}), reason, details, status: 'open', ...(exchangeId ? { exchangeId } : {}) };
  db.errors.unshift(e);
  notify({ roles: ['archivist'], kind: 'system', level: 'warning', title: L(`Архив: ошибка приёма ${input.docNumber ?? ''}`, `Arxiv: qabul xatosi ${input.docNumber ?? ''}`, `Archive: intake error ${input.docNumber ?? ''}`), body: details, link: '/archive?tab=intake', dedupeKey: `arc-err:${e.id}` });
  return e;
}

export class ArchiveIntakeRejected extends Error {
  constructor(public reason: ArchiveIntakeError['reason'], public missing: string[] = [], public duplicateOf?: string) {
    super(`Archive intake rejected: ${reason}`);
  }
}

async function doIntake(input: ArchiveIntakeInput, user: User, opts: { logErrors: boolean }): Promise<ArchiveDocument> {
  const missing = REQUIRED.filter((k) => !String(input[k] ?? '').trim());
  if (input.pages !== undefined && !(input.pages > 0)) missing.push('pages');
  if (missing.length) {
    if (opts.logErrors) intakeError(input, 'incomplete', `Не заполнены реквизиты: ${missing.join(', ')}`);
    throw new ArchiveIntakeRejected('incomplete', missing as string[]);
  }
  // Повтор из той же системы с тем же идентификатором — идемпотентно возвращаем принятый документ.
  if (input.sourceRef) {
    const same = db.documents.find((d) => d.source === input.source && d.sourceRef === input.sourceRef);
    if (same) return same;
  }
  const dup = db.documents.find((d) => d.docNumber.trim().toLowerCase() === input.docNumber.trim().toLowerCase() && d.docDate === input.docDate && d.departmentId === input.departmentId);
  if (dup) {
    if (opts.logErrors) intakeError(input, 'duplicate', `Документ с этим номером и датой уже принят (${dup.uid})`);
    throw new ArchiveIntakeRejected('duplicate', [], dup.uid);
  }
  const content = input.content ?? { number: input.docNumber, date: input.docDate, title: input.title, kind: input.kind, text: input.text ?? '' };
  const checksum = checksumOf(content);
  // Целостность: подписи E-IMZO документа-источника должны соответствовать содержимому (PR-ARC-034, 036).
  let signatures = 0;
  if (input.signatureEntity) {
    const sigs = await signatureService.list(input.signatureEntity.entity, input.signatureEntity.entityId);
    signatures = sigs.length;
    const broken = sigs.filter((s) => checkSignature(s, input.signatureContent).status === 'tampered');
    if (broken.length) {
      if (opts.logErrors) intakeError(input, 'integrity', `Подпись не соответствует содержимому (${broken.length})`);
      throw new ArchiveIntakeRejected('integrity');
    }
  }
  const at = now();
  const nom = nomenclatureFor(input.kind, input.nomenclatureIndex);
  const doc: ArchiveDocument = {
    id: nextId('ad'),
    uid: newUid(),
    caseId: null,
    docNumber: input.docNumber.trim(),
    docDate: input.docDate,
    title: input.title.trim(),
    kind: input.kind,
    source: input.source,
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    departmentId: input.departmentId,
    ...(input.responsibleId ? { responsibleId: input.responsibleId } : {}),
    createdAt: input.createdAt ?? at,
    receivedAt: at,
    ...(input.pages ? { pages: input.pages } : {}),
    ...(input.text ? { text: input.text } : {}),
    checksum,
    ...(input.signatureEntity ? { signatureEntity: input.signatureEntity } : {}),
    ...(input.fileEntity ? { fileEntity: input.fileEntity } : {}),
    signatures,
    ...(nom ? { nomenclatureIndex: nom.index } : input.nomenclatureIndex ? { nomenclatureIndex: input.nomenclatureIndex } : {}),
    ...(input.restricted ? { restricted: true } : {}),
    version: 1,
    versions: [{ version: 1, at, by: user.id, checksum, note: 'Принят в архив' }],
    movements: [{ at, userId: user.id, action: 'received', details: `Источник: ${input.source}${input.sourceRef ? ` (${input.sourceRef})` : ''}` }],
  };
  db.documents.push(doc);
  db.contents.set(doc.id, content);
  log(user, 'create', 'archive_document', doc.id, doc.uid, `${input.source} · ${doc.docNumber} · sha256 ${checksum.slice(0, 12)}…`);
  return doc;
}

// ---------- Проверка полноты дела (PR-ARC-020, 021) ----------

function caseChecks(c: ArchiveCase): ArchiveCheck[] {
  const docs = db.documents.filter((d) => d.caseId === c.id);
  const out: ArchiveCheck[] = [];
  out.push({ code: 'has_docs', ok: docs.length > 0 || !c.electronic, details: String(docs.length) });
  const noAttr = docs.filter((d) => !d.docNumber || !d.docDate || !d.title || !d.kind);
  out.push({ code: 'attributes', ok: !noAttr.length, details: noAttr.map((d) => d.uid).join(', ') });
  // Нумерация: номера с общим префиксом и числовым хвостом должны идти без пропусков.
  const nums = docs.map((d) => /^(.*?)(\d+)$/.exec(d.docNumber)).filter((m): m is RegExpExecArray => !!m);
  const byPrefix = new Map<string, number[]>();
  for (const m of nums) byPrefix.set(m[1]!, [...(byPrefix.get(m[1]!) ?? []), Number(m[2])]);
  const gaps: string[] = [];
  for (const [p, list] of byPrefix) {
    const s = [...list].sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) if (s[i]! - s[i - 1]! > 1) gaps.push(`${p}${s[i - 1]! + 1}…${p}${s[i]! - 1}`);
  }
  out.push({ code: 'numbering', ok: !gaps.length, warn: true, details: gaps.join(', ') });
  const broken = docs.filter((d) => checksumOf(db.contents.get(d.id) ?? {}) !== d.checksum);
  out.push({ code: 'integrity', ok: !broken.length, details: broken.map((d) => d.uid).join(', ') });
  const unsigned = docs.filter((d) => d.signatureEntity && !d.signatures);
  out.push({ code: 'signatures', ok: !unsigned.length, warn: true, details: unsigned.map((d) => d.docNumber).join(', ') });
  const outOfPeriod = docs.filter((d) => !d.docDate.startsWith(String(c.year)) || (c.periodFrom && d.docDate < c.periodFrom) || (c.periodTo && d.docDate > c.periodTo));
  out.push({ code: 'period', ok: !outOfPeriod.length, details: outOfPeriod.map((d) => d.docNumber).join(', ') });
  out.push({ code: 'pages', ok: c.pages > 0, details: String(c.pages) });
  return out;
}
const blocking = (checks: ArchiveCheck[]) => checks.filter((x) => !x.ok && !x.warn);

function recount(c: ArchiveCase) {
  if (!c.electronic && c.status !== 'forming') return;
  const docs = db.documents.filter((d) => d.caseId === c.id);
  c.documents = docs.length;
  c.pages = docs.reduce((s, d) => s + (d.pages ?? 1), 0);
}

// ---------- Контроль сроков (PR-ARC-017, 018) ----------

let lastScan = 0;
export function archiveScan(at = Date.now()): void {
  const d = new Date(at).toISOString().slice(0, 10);
  for (const r of db.requests) {
    if (archiveRequestOverdue(r)) notify({ userIds: [r.requesterId], roles: ['archivist'], kind: 'sla_overdue', level: 'danger', title: L(`${r.number}: просрочен возврат дела`, `${r.number}: ish qaytarish muddati o'tdi`, `${r.number}: case return overdue`), body: L(`Срок возврата: ${r.dueBack}`, `Qaytarish muddati: ${r.dueBack}`, `Due back: ${r.dueBack}`), link: '/archive?tab=requests', dedupeKey: `arc-req-overdue:${r.id}` });
    else if (r.status === 'issued' && r.dueBack <= new Date(at + DAY).toISOString().slice(0, 10)) notify({ userIds: [r.requesterId], kind: 'sla_soon', level: 'warning', title: L(`${r.number}: завтра срок возврата дела`, `${r.number}: ertaga ishni qaytarish muddati`, `${r.number}: case due back tomorrow`), link: '/archive?tab=requests', dedupeKey: `arc-req-soon:${r.id}` });
  }
  for (const t of db.tasks) {
    if (t.status !== 'open') continue;
    if (t.dueDate < d) notify({ userIds: [t.responsibleId], roles: ['archivist'], kind: 'sla_overdue', level: 'danger', title: L(`${t.number}: просрочена сдача дела в архив`, `${t.number}: ishni arxivga topshirish muddati o'tdi`, `${t.number}: case hand-over overdue`), link: '/archive?tab=forming', dedupeKey: `arc-task-overdue:${t.id}` });
    else if (t.dueDate <= new Date(at + 3 * DAY).toISOString().slice(0, 10)) notify({ userIds: [t.responsibleId], kind: 'sla_soon', level: 'warning', title: L(`${t.number}: скоро срок сдачи дела в архив`, `${t.number}: ishni arxivga topshirish muddati yaqin`, `${t.number}: case hand-over due soon`), link: '/archive?tab=forming', dedupeKey: `arc-task-soon:${t.id}` });
  }
  for (const c of db.cases) if (c.status === 'expired') notify({ roles: ['archivist'], kind: 'system', level: 'warning', title: L(`${c.number}: истёк срок хранения`, `${c.number}: saqlash muddati tugadi`, `${c.number}: retention expired`), body: L('Дело подлежит экспертизе ценности', 'Ish qimmatini ekspertiza qilish kerak', 'Case requires appraisal'), link: `/archive/${c.id}`, dedupeKey: `arc-expired:${c.id}` });
  lastScan = at;
}
const maybeScan = () => {
  if (Date.now() - lastScan > 30_000) archiveScan();
};

const retentionFor = (n: ArchiveNomenclatureItem | undefined, year: number): string | null => (n && n.retentionYears > 0 ? `${year + 1 + n.retentionYears}-01-01` : null);
const nextBox = () => `К-${String(900 + db.cases.length).padStart(4, '0')}`;

// ---------- Публичный API ----------

export const archiveApi = {
  stats(): Promise<ArchiveStats> {
    refreshExpired();
    maybeScan();
    const live = db.cases.filter((c) => !['destroyed', 'transferred', 'forming', 'submitted'].includes(c.status));
    return delay({
      cases: live.length,
      documents: live.reduce((s, c) => s + c.documents, 0),
      issued: db.requests.filter((r) => r.status === 'issued').length,
      overdueReturns: db.requests.filter(archiveRequestOverdue).length,
      expired: db.cases.filter((c) => c.status === 'expired').length,
      registry: db.documents.filter((d) => !d.caseId).length,
      submitted: db.cases.filter((c) => c.status === 'submitted').length,
      errors: db.errors.filter((e) => e.status === 'open').length,
      openTasks: db.tasks.filter((t) => t.status === 'open').length,
    });
  },

  /** Id дел, включённых в проекты актов (их нельзя выдавать). */
  casesInDraftActs: (): Promise<ID[]> => delay(db.cases.filter((c) => inActs(c.id)).map((c) => c.id)),

  listNomenclature: (): Promise<ArchiveNomenclatureItem[]> => delay(db.nomenclature),

  listCases(filter: ArchiveCaseFilter = {}, user?: User): Promise<ArchiveCase[]> {
    refreshExpired();
    const q = filter.search?.trim().toLowerCase();
    return delay(
      db.cases
        .filter((c) => !user || archiveCanSee(user, c))
        .filter((c) => (filter.status ? c.status === filter.status : !['forming', 'submitted'].includes(c.status)))
        .filter((c) => !filter.departmentId || c.departmentId === filter.departmentId)
        .filter((c) => !filter.year || c.year === filter.year)
        .filter((c) => filter.electronic === undefined || !!c.electronic === filter.electronic)
        .filter((c) => !q || c.number.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
        .sort((a, b) => b.year - a.year || a.number.localeCompare(b.number)),
    );
  },

  /** Дела в работе подразделений: формируются и сданы на приём. */
  listWorkCases(user?: User): Promise<ArchiveCase[]> {
    return delay(db.cases.filter((c) => ['forming', 'submitted'].includes(c.status) && (!user || archiveCanSee(user, c))).sort((a, b) => (b.formedAt ?? '').localeCompare(a.formedAt ?? '')));
  },

  async getCase(id: ID, user?: User): Promise<{ case: ArchiveCase; docs: ArchiveDocument[]; nomenclature?: ArchiveNomenclatureItem } | undefined> {
    refreshExpired();
    const c = caseById(id);
    if (!c || (user && !archiveCanSee(user, c))) return delay(undefined);
    return delay({ case: c, docs: db.documents.filter((d) => d.caseId === id), ...(nomById(c.nomenclatureId) ? { nomenclature: nomById(c.nomenclatureId)! } : {}) });
  },

  async getDocument(id: ID, user?: User): Promise<{ doc: ArchiveDocument; case?: ArchiveCase; integrity: boolean } | undefined> {
    const d = db.documents.find((x) => x.id === id);
    if (!d || (user && !archiveCanSee(user, d))) return delay(undefined);
    const c = d.caseId ? caseById(d.caseId) : undefined;
    return delay({ doc: d, ...(c ? { case: c } : {}), integrity: checksumOf(db.contents.get(d.id) ?? {}) === d.checksum });
  },

  /** Поиск по реквизитам, тексту, дате, подразделению, виду, делу, исполнителю, статусу (PR-ARC-043, PR-DOC-018). */
  searchDocuments(input: string | ArchiveSearchFilter, user?: User): Promise<ArchiveSearchHit[]> {
    const f: ArchiveSearchFilter = typeof input === 'string' ? { query: input } : input;
    const q = f.query?.trim().toLowerCase() ?? '';
    const anyFilter = q || f.from || f.to || f.departmentId || f.kind || f.caseId || f.responsibleId || f.source || f.status;
    if (!anyFilter) return delay([]);
    return delay(
      db.documents
        .filter((d) => !user || archiveCanSee(user, d))
        .filter((d) => !q || [d.title, d.docNumber, d.kind, d.uid, d.text ?? ''].some((x) => x.toLowerCase().includes(q)))
        .filter((d) => !f.from || d.docDate >= f.from)
        .filter((d) => !f.to || d.docDate <= f.to)
        .filter((d) => !f.departmentId || d.departmentId === f.departmentId)
        .filter((d) => !f.kind || d.kind === f.kind)
        .filter((d) => !f.caseId || d.caseId === f.caseId)
        .filter((d) => !f.responsibleId || d.responsibleId === f.responsibleId)
        .filter((d) => !f.source || d.source === f.source)
        .filter((d) => !f.status || (f.status === 'registry' ? !d.caseId : !!d.caseId))
        .flatMap((doc) => {
          const c = doc.caseId ? caseById(doc.caseId) : undefined;
          if (c && (c.status === 'destroyed' || (user && !archiveCanSee(user, c)))) return [];
          const t = doc.text ?? '';
          const i = q ? t.toLowerCase().indexOf(q) : -1;
          const snippet = i >= 0 ? `${i > 30 ? '…' : ''}${t.slice(Math.max(0, i - 30), i + q.length + 40)}${i + q.length + 40 < t.length ? '…' : ''}` : undefined;
          return [{ doc, caseNumber: c?.number ?? '', caseTitle: c?.title ?? '', location: c?.location ?? null, ...(snippet ? { snippet } : {}) }];
        }),
    );
  },

  /** Виды документов (для фильтров). */
  listKinds: (): Promise<string[]> => delay([...new Set([...db.documents.map((d) => d.kind), ...db.nomenclature.flatMap((n) => n.kinds ?? [])])].sort()),

  // ----- приём и регистрация -----

  /** Ввод документа уполномоченным сотрудником или по скану (PR-ARC-012, 013): единый ID, контроль дублей и неполных данных. */
  async registerDocument(input: ArchiveIntakeInput, user: User): Promise<ArchiveDocument> {
    assertSubmitter(user);
    const doc = await doIntake({ ...input, source: input.source === 'scan' || input.source === 'migration' ? input.source : 'manual' }, user, { logErrors: false });
    emit();
    return delay(doc);
  },

  /** Приём электронного документа из модуля ERP / системы Банка (идемпотентно по источнику и идентификатору). */
  async receiveElectronic(input: ArchiveIntakeInput, user: User): Promise<{ id: ID; number: string }> {
    const doc = await doIntake(input, user, { logErrors: true });
    emit();
    return delay({ id: doc.id, number: doc.uid });
  },

  /** Источники: модули ERP (СЭД, ЭСФ, командировки) и системы Банка через шину. */
  listSources(): Promise<ArchiveSourceInfo[]> {
    const d = today();
    return delay([
      ...[...providers.entries()].map(([id, p]) => ({ id, name: p.name, kind: 'module' as const, pending: p.pending() })),
      ...SYSTEM_SOURCES.map((s) => ({ id: s.id, name: s.name, kind: 'system' as const, pending: pulledDays.has(`${s.id}:${d}`) ? 0 : 1 })),
    ]);
  },

  /** Принять данные из источника. Возвращает число принятых документов; ошибки — в журнал ошибок приёма. */
  async pullSource(source: ArchiveSource, user: User): Promise<{ received: number; status: string; exchangeId?: ID }> {
    assertManager(user);
    const p = providers.get(source);
    if (p) {
      const n = await p.pull(user);
      log(user, 'create', 'archive_intake', source, source, `${n}`);
      emit();
      return delay({ received: n, status: 'success' });
    }
    const d = today();
    const key = `${source}:${d}`;
    if (pulledDays.has(key)) return delay({ received: 0, status: 'success' });
    let rec;
    let made: ArchiveIntakeInput[] = [];
    if (source === 'abs') {
      rec = await integrationHub.call('iabs', 'opday.export', { date: d }, { userId: user.id, idempotencyKey: `arc-opday-${d}` });
      const r = rec.response as { files?: number; entries?: number } | undefined;
      made = [
        { source, sourceRef: `OPDAY-${d}`, docNumber: `ОД-${d}`, docDate: d, title: `Данные операционного дня ${d}: баланс, обороты, журнал проводок`, kind: 'Операционный день', departmentId: 'd7', responsibleId: 'u7', pages: r?.files ?? 3, text: `Проводок: ${r?.entries ?? 0}` },
      ];
    } else if (source === 'dwh') {
      const period = d.slice(0, 7);
      rec = await integrationHub.call('dwh', 'registry.export', { period }, { userId: user.id, idempotencyKey: `arc-dwh-${d}` });
      const n = (rec.response as { files?: number } | undefined)?.files ?? 2;
      made = Array.from({ length: n }, (_, i) => ({ source, sourceRef: `REG-${d}-${i + 1}`, docNumber: `РЕЕСТР-${period}-${i + 1}`, docDate: d, title: [`Реестр платёжных документов за ${period}`, `Отчёт об исполнении бюджета АУР за ${period}`, `Реестр выданных доверенностей за ${period}`, `Сводный отчёт по кассовым операциям за ${period}`][i % 4]!, kind: 'Реестр', departmentId: 'd7', responsibleId: 'u11', pages: 4 }));
    } else if (source === 'integration') {
      const list = await integrationHub.listExchanges({});
      made = [{ source, sourceRef: `IXLOG-${d}`, docNumber: `ПИО-${d}`, docDate: d, title: `Протокол информационного обмена за ${d} (${list.length} сообщений)`, kind: 'Протокол обмена', departmentId: 'd1', responsibleId: 'u18', pages: Math.max(1, Math.ceil(list.length / 40)), content: list.map((x) => [x.id, x.systemId, x.operation, x.status, x.payloadHash]), text: list.slice(0, 50).map((x) => `${x.systemId} ${x.operation} ${x.status}`).join('\n') }];
    } else if (source === 'audit') {
      const entries = audit.query({});
      made = [{ source, sourceRef: `AUDIT-${d}`, docNumber: `ЖА-${d}`, docDate: d, title: `Журнал аудита за ${d} (${entries.length} записей, цепочка хэшей)`, kind: 'Журнал аудита', departmentId: 'd11', responsibleId: 'u19', pages: Math.max(1, Math.ceil(entries.length / 50)), content: entries.map((e) => e.hash), restricted: true }];
    }
    if (rec && rec.status !== 'success') {
      intakeError({ source, docNumber: made[0]?.docNumber ?? source }, 'integration', `${rec.systemId}/${rec.operation}: ${rec.status}${rec.error ? ` (${rec.error})` : ''}`, rec.id);
      emit();
      return delay({ received: 0, status: rec.status, exchangeId: rec.id });
    }
    let n = 0;
    for (const m of made) {
      try {
        await doIntake(m, user, { logErrors: true });
        n++;
      } catch {
        /* ошибка уже в журнале */
      }
    }
    pulledDays.add(key);
    // Обмен статусом: система-источник получает подтверждение архивации (PR-ARC-049).
    log(user, 'create', 'archive_intake', source, source, `${n}${rec ? ` · ${rec.id}` : ''}`);
    emit();
    return delay({ received: n, status: 'success', ...(rec ? { exchangeId: rec.id } : {}) });
  },

  listErrors: (): Promise<ArchiveIntakeError[]> => delay(db.errors),

  /** Ошибка приёма: повторить обмен (для сбоев интеграции) или закрыть с отметкой. */
  async resolveError(id: ID, user: User, action: 'retry' | 'discard'): Promise<void> {
    assertManager(user);
    const e = db.errors.find((x) => x.id === id);
    if (!e || e.status !== 'open') throw apiError('ERROR_NOT_OPEN');
    if (action === 'retry') {
      if (e.exchangeId) {
        const rec = await integrationHub.retry(e.exchangeId, user.id).catch(() => undefined);
        if (rec?.status !== 'success') throw apiError('RETRY_FAILED');
      }
      if (e.reason === 'integration') pulledDays.delete(`${e.source}:${today()}`);
      e.status = 'resolved';
    } else e.status = 'discarded';
    log(user, 'update', 'archive_intake_error', e.id, e.docNumber ?? e.id, action);
    emit();
    await delay(null);
  },

  /** Реестр принятых документов, ещё не сведённых в дела. */
  listRegistry(user?: User): Promise<ArchiveDocument[]> {
    return delay(db.documents.filter((d) => !d.caseId && (!user || archiveCanSee(user, d))).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)));
  },

  /** Новая версия электронного документа (изменение реквизитов/текста) с журналом версий (PR-ARC-025). */
  async addVersion(docId: ID, user: User, patch: { title?: string; text?: string; note: string }): Promise<void> {
    assertManager(user);
    const d = db.documents.find((x) => x.id === docId);
    if (!d || !patch.note.trim()) throw apiError('INVALID_VERSION');
    const c = d.caseId ? caseById(d.caseId) : undefined;
    if (c && ['stored', 'issued', 'destroyed', 'transferred', 'expired'].includes(c.status)) throw apiError('CASE_IS_CLOSED');
    if (patch.title?.trim()) d.title = patch.title.trim();
    if (patch.text !== undefined) d.text = patch.text;
    const content = { number: d.docNumber, date: d.docDate, title: d.title, kind: d.kind, text: d.text ?? '' };
    d.checksum = checksumOf(content);
    db.contents.set(d.id, content);
    d.version += 1;
    d.versions.push({ version: d.version, at: now(), by: user.id, checksum: d.checksum, note: patch.note.trim() });
    move(d, user, 'version', `v${d.version}: ${patch.note.trim()}`);
    log(user, 'update', 'archive_document', d.id, d.uid, `v${d.version}: ${patch.note}`);
    emit();
    await delay(null);
  },

  // ----- формирование и сдача дел -----

  /** Сформировать электронное дело по номенклатуре, году (периоду) и подразделению из реестра (PR-ARC-004, 020). */
  async formCase(input: ArchiveFormCaseInput, user: User): Promise<ArchiveCase> {
    assertSubmitter(user);
    const n = nomById(input.nomenclatureId);
    if (!n || !(input.year >= 2000 && input.year <= 2100) || !input.departmentId) throw apiError('INVALID_INPUT');
    const docs = db.documents.filter((d) => !d.caseId && d.departmentId === input.departmentId && (d.nomenclatureIndex === n.index || n.kinds?.includes(d.kind)) && d.docDate.startsWith(String(input.year)) && (!input.periodFrom || d.docDate >= input.periodFrom) && (!input.periodTo || d.docDate <= input.periodTo));
    const vol = db.cases.filter((c) => c.nomenclatureId === n.id && c.year === input.year).length + 1;
    const c: ArchiveCase = {
      id: nextId('ac'),
      number: `${n.index}/${input.year}${vol > 1 ? `-${vol}` : ''}`,
      nomenclatureId: n.id,
      title: input.title?.trim() || `${n.title}, ${input.year} г.${vol > 1 ? `, т. ${vol}` : ''}`,
      year: input.year,
      departmentId: input.departmentId,
      documents: 0,
      pages: 0,
      location: { room: '—', rack: '—', shelf: 0, box: '—' },
      status: 'forming',
      retentionUntil: retentionFor(n, input.year),
      transferredAt: '',
      electronic: true,
      ...(input.restricted ? { restricted: true } : {}),
      responsibleId: input.responsibleId ?? user.id,
      ...(input.periodFrom ? { periodFrom: input.periodFrom } : {}),
      ...(input.periodTo ? { periodTo: input.periodTo } : {}),
      formedAt: now(),
      formedBy: user.id,
      movements: [],
    };
    db.cases.push(c);
    for (const d of docs) {
      d.caseId = c.id;
      move(d, user, 'added', c.number);
    }
    recount(c);
    c.completeness = caseChecks(c);
    move(c, user, 'formed', `${docs.length} док.`);
    log(user, 'create', 'archive_case', c.id, c.number, `formed: ${docs.length}`);
    const task = db.tasks.find((t) => t.status === 'open' && t.departmentId === c.departmentId && t.nomenclatureId === c.nomenclatureId && t.year === c.year);
    if (task) task.caseId = c.id;
    emit();
    return delay(c);
  },

  async addToCase(caseId: ID, docIds: ID[], user: User): Promise<void> {
    assertSubmitter(user);
    const c = caseById(caseId);
    if (!c || c.status !== 'forming') throw apiError('CASE_IS_NOT_FORMING');
    for (const id of docIds) {
      const d = db.documents.find((x) => x.id === id && !x.caseId);
      if (!d) continue;
      d.caseId = c.id;
      move(d, user, 'added', c.number);
      move(c, user, 'added', d.uid);
    }
    recount(c);
    c.completeness = caseChecks(c);
    emit();
    await delay(null);
  },

  async removeFromCase(caseId: ID, docId: ID, user: User): Promise<void> {
    assertSubmitter(user);
    const c = caseById(caseId);
    const d = db.documents.find((x) => x.id === docId && x.caseId === caseId);
    if (!c || !d || c.status !== 'forming') throw apiError('CANNOT_REMOVE');
    d.caseId = null;
    move(d, user, 'removed', c.number);
    move(c, user, 'removed', d.uid);
    recount(c);
    c.completeness = caseChecks(c);
    emit();
    await delay(null);
  },

  /** Проверка полноты и целостности дела. */
  async checkCase(caseId: ID, user: User): Promise<ArchiveCheck[]> {
    const c = caseById(caseId);
    if (!c) throw apiError('NOT_FOUND');
    c.completeness = caseChecks(c);
    move(c, user, 'checked', c.completeness.filter((x) => !x.ok).map((x) => x.code).join(', ') || 'OK');
    emit();
    return delay(c.completeness);
  },

  /** Сдать дело в архив с описью (подразделение). Блокирующие замечания проверки не допускаются. */
  async submitCase(caseId: ID, user: User): Promise<void> {
    assertSubmitter(user);
    const c = caseById(caseId);
    if (!c || c.status !== 'forming') throw apiError('CASE_IS_NOT_FORMING');
    c.completeness = caseChecks(c);
    if (blocking(c.completeness).length) throw apiError('COMPLETENESS_CHECK_FAILED');
    c.status = 'submitted';
    c.submittedAt = now();
    c.submittedBy = user.id;
    delete c.returnReason;
    move(c, user, 'submitted', `Опись: ${c.documents} док., ${c.pages} л.`);
    log(user, 'submit', 'archive_case', c.id, c.number);
    notify({ roles: ['archivist'], kind: 'task', level: 'info', title: L(`${c.number}: дело сдано на приём в архив`, `${c.number}: ish arxivga qabulga topshirildi`, `${c.number}: case submitted to archive`), link: `/archive/${c.id}` });
    emit();
    await delay(null);
  },

  /** Принять дело в архивный фонд: акт приёма-передачи, место хранения, подпись архивариуса (PR-ARC-005, 022, 023). */
  async acceptCase(caseId: ID, user: User, input: { location: ArchiveLocation; signatureId?: ID }): Promise<void> {
    assertManager(user);
    const c = caseById(caseId);
    if (!c || c.status !== 'submitted') throw apiError('CASE_IS_NOT_SUBMITTED');
    const loc = input.location;
    if (!loc.room.trim() || !loc.rack.trim() || !(loc.shelf > 0) || !loc.box.trim()) throw apiError('LOCATION_REQUIRED');
    if (input.signatureId) {
      const s = signatureService.get(input.signatureId);
      if (!s || s.entity !== 'archive_case' || s.entityId !== c.id) throw apiError('SIGNATURE_NOT_FOUND');
      c.signatureIds = [...(c.signatureIds ?? []), s.id];
    }
    c.location = { room: loc.room.trim(), rack: loc.rack.trim(), shelf: loc.shelf, box: loc.box.trim() };
    c.status = 'stored';
    c.acceptedAt = now();
    c.acceptedBy = user.id;
    c.transferredAt = today();
    c.acceptanceActNo = nextNumber('APP');
    move(c, user, 'accepted', `${c.acceptanceActNo} · ${c.location.room}/${c.location.rack}/${c.location.shelf}/${c.location.box}`);
    log(user, 'approve', 'archive_case', c.id, c.number, `accepted ${c.acceptanceActNo}`);
    const task = db.tasks.find((t) => t.status === 'open' && (t.caseId === c.id || (t.departmentId === c.departmentId && t.nomenclatureId === c.nomenclatureId && t.year === c.year)));
    if (task) {
      task.status = 'done';
      task.doneAt = now();
      task.caseId = c.id;
    }
    refreshExpired();
    if (c.submittedBy) notify({ userIds: [c.submittedBy], kind: 'approved', level: 'success', title: L(`${c.number}: принято в архив`, `${c.number}: arxivga qabul qilindi`, `${c.number}: accepted to archive`), body: c.acceptanceActNo, link: `/archive/${c.id}` });
    emit();
    await delay(null);
  },

  /** Вернуть дело подразделению на доработку (архивариус). */
  async returnCaseToDept(caseId: ID, user: User, reason: string): Promise<void> {
    assertManager(user);
    const c = caseById(caseId);
    if (!c || c.status !== 'submitted' || !reason.trim()) throw apiError('CANNOT_RETURN');
    c.status = 'forming';
    c.returnReason = reason.trim();
    move(c, user, 'returned_dept', reason.trim());
    log(user, 'reject', 'archive_case', c.id, c.number, reason);
    if (c.submittedBy) notify({ userIds: [c.submittedBy], kind: 'returned', level: 'warning', title: L(`${c.number}: возвращено на доработку`, `${c.number}: qayta ishlashga qaytarildi`, `${c.number}: returned for rework`), body: reason, link: `/archive/${c.id}` });
    emit();
    await delay(null);
  },

  /** Перемещение дела (учёт места хранения бумажных документов, PR-ARC-024). */
  async moveCase(caseId: ID, location: ArchiveLocation, user: User): Promise<void> {
    assertManager(user);
    const c = caseById(caseId);
    if (!c || ['forming', 'submitted', 'destroyed', 'transferred'].includes(c.status)) throw apiError('CANNOT_MOVE');
    if (!location.room.trim() || !location.rack.trim() || !(location.shelf > 0) || !location.box.trim()) throw apiError('LOCATION_REQUIRED');
    const from = `${c.location.room}/${c.location.rack}/${c.location.shelf}/${c.location.box}`;
    c.location = { ...location, room: location.room.trim(), rack: location.rack.trim(), box: location.box.trim() };
    const to = `${c.location.room}/${c.location.rack}/${c.location.shelf}/${c.location.box}`;
    move(c, user, 'moved', `${from} → ${to}`);
    audit.log({ action: 'update', entity: 'archive_case', entityId: c.id, entityLabel: c.number, changes: [{ field: 'location', from, to }], user: who(user) });
    emit();
    await delay(null);
  },

  // ----- поручения подразделениям -----

  listTasks: (): Promise<ArchiveTransferTask[]> => delay([...db.tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate))),

  /** Направить подразделению поручение подготовить и сдать дело в срок (PR-ARC-014). */
  async createTask(input: { departmentId: ID; nomenclatureId: ID; year: number; responsibleId: ID; dueDate: string }, user: User): Promise<ArchiveTransferTask> {
    assertManager(user);
    if (!input.departmentId || !nomById(input.nomenclatureId) || !input.responsibleId || !input.dueDate || input.dueDate < today()) throw apiError('INVALID_INPUT');
    const t: ArchiveTransferTask = { id: nextId('at'), number: nextNumber('SD'), ...input, createdAt: now(), createdBy: user.id, status: 'open' };
    db.tasks.push(t);
    const n = nomById(input.nomenclatureId)!;
    notify({ userIds: [input.responsibleId], kind: 'task', level: 'info', title: L(`${t.number}: подготовить дело ${n.index}/${input.year} к сдаче в архив`, `${t.number}: ${n.index}/${input.year} ishini arxivga topshirishga tayyorlang`, `${t.number}: prepare case ${n.index}/${input.year} for the archive`), body: L(`Срок: ${input.dueDate}`, `Muddat: ${input.dueDate}`, `Due: ${input.dueDate}`), link: '/archive?tab=forming' });
    log(user, 'create', 'archive_task', t.id, t.number, `${input.departmentId} ${n.index}/${input.year} → ${input.responsibleId} до ${input.dueDate}`);
    emit();
    return delay(t);
  },

  // ----- выдача и копии -----

  listRequests(): Promise<ArchiveRequest[]> {
    maybeScan();
    return delay([...db.requests].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)));
  },

  async createRequest(input: { caseId: ID; purpose: string; days: number; copy?: boolean }, user: User): Promise<ArchiveRequest> {
    const c = caseById(input.caseId);
    if (!c || ['destroyed', 'transferred', 'forming', 'submitted'].includes(c.status) || inActs(c.id) || !archiveCanSee(user, c)) throw apiError('CASE_NOT_AVAILABLE');
    if (!input.purpose.trim() || !(input.days >= 1 && input.days <= 90)) throw apiError('INVALID_INPUT');
    const r: ArchiveRequest = {
      id: nextId('ar'),
      number: nextNumber('AV'),
      caseId: input.caseId,
      requesterId: user.id,
      purpose: input.purpose,
      requestedAt: now(),
      dueBack: addDays(input.days).slice(0, 10),
      status: 'new',
      ...(input.copy ? { copy: true } : {}),
    };
    db.requests.push(r);
    log(user, 'create', 'archive_request', r.id, r.number, `${c.number}${input.copy ? ' (копия)' : ''}`);
    notify({ roles: ['archivist'], excludeIds: [user.id], kind: 'task', level: 'info', title: L(`${r.number}: заявка на ${input.copy ? 'копию' : 'выдачу'} дела ${c.number}`, `${r.number}: ${c.number} ishi bo'yicha ariza`, `${r.number}: request for case ${c.number}`), link: '/archive?tab=requests' });
    emit();
    return delay(r);
  },

  /** Выдать дело по заявке (архивариус). Копия — выдаётся без изъятия подлинника и закрывается сразу. */
  async issue(requestId: ID, user: User): Promise<void> {
    assertManager(user);
    const r = db.requests.find((x) => x.id === requestId);
    const c = r && caseById(r.caseId);
    if (!r || !c || r.status !== 'new') throw apiError('REQUEST_CANNOT_BE_ISSUED');
    if (r.copy) {
      r.status = 'returned';
      r.issuedAt = now();
      r.returnedAt = now();
      move(c, user, 'copied', `${r.number} → ${directory.user(r.requesterId)?.fullName ?? r.requesterId}`);
      log(user, 'export', 'archive_case', c.id, c.number, `certified copy ${r.number}`);
    } else {
      if (c.status === 'issued' || c.status === 'destroyed' || inActs(c.id)) throw apiError('CASE_NOT_AVAILABLE');
      r.status = 'issued';
      r.issuedAt = now();
      c.status = 'issued';
      move(c, user, 'issued', `${r.number} → ${directory.user(r.requesterId)?.fullName ?? r.requesterId} до ${r.dueBack}`);
      log(user, 'update', 'archive_case', c.id, c.number, `issued ${r.number}`);
    }
    notify({ userIds: [r.requesterId], kind: 'approved', level: 'success', title: L(`${r.number}: ${r.copy ? 'копия готова' : 'дело выдано'}`, `${r.number}: ${r.copy ? 'nusxa tayyor' : 'ish berildi'}`, `${r.number}: ${r.copy ? 'copy ready' : 'case issued'}`), link: '/archive?tab=requests' });
    emit();
    await delay(null);
  },

  async returnCase(requestId: ID, user: User): Promise<void> {
    assertManager(user);
    const r = db.requests.find((x) => x.id === requestId);
    const c = r && caseById(r.caseId);
    if (!r || !c || r.status !== 'issued') throw apiError('REQUEST_IS_NOT_ISSUED');
    r.status = 'returned';
    r.returnedAt = now();
    c.status = 'stored';
    move(c, user, 'returned', r.number);
    log(user, 'update', 'archive_case', c.id, c.number, `returned ${r.number}`);
    refreshExpired();
    emit();
    await delay(null);
  },

  async rejectRequest(requestId: ID, comment: string, user: User): Promise<void> {
    assertManager(user);
    if (!comment.trim()) throw apiError('COMMENT_REQUIRED');
    const r = db.requests.find((x) => x.id === requestId);
    if (!r || r.status !== 'new') throw apiError('REQUEST_CANNOT_BE_REJECTED');
    r.status = 'rejected';
    r.comment = comment;
    log(user, 'reject', 'archive_request', r.id, r.number, comment);
    emit();
    await delay(null);
  },

  /** Отметка о просмотре документа (журнал действий пользователей, PR-ARC-056). */
  logView(docId: ID, user: User): void {
    const d = db.documents.find((x) => x.id === docId);
    if (d) log(user, 'view', 'archive_document', d.id, d.uid);
  },

  // ----- акты: уничтожение и передача в госархив -----

  listActs(): Promise<ArchiveDestructionAct[]> {
    return delay([...db.acts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },
  getAct: (id: ID): Promise<ArchiveDestructionAct | undefined> => delay(db.acts.find((a) => a.id === id)),

  /** Дела с истёкшим сроком, ещё не включённые в проект акта. */
  listDestructionCandidates(): Promise<ArchiveCase[]> {
    refreshExpired();
    return delay(db.cases.filter((c) => c.status === 'expired' && !inActs(c.id)));
  },

  /** Дела постоянного хранения старше 10 лет — кандидаты на передачу в госархив. */
  listStateCandidates(): Promise<ArchiveCase[]> {
    const y = Number(today().slice(0, 4));
    return delay(db.cases.filter((c) => c.status === 'stored' && c.retentionUntil === null && y - c.year >= 10 && !inActs(c.id)));
  },

  async createAct(caseIds: ID[], user: User, kind: 'destruction' | 'state_transfer' = 'destruction'): Promise<ArchiveDestructionAct> {
    assertManager(user);
    const y = Number(today().slice(0, 4));
    const ok = (id: ID) => {
      const c = caseById(id);
      if (!c || inActs(id)) return false;
      return kind === 'destruction' ? c.status === 'expired' : c.status === 'stored' && c.retentionUntil === null && y - c.year >= 10;
    };
    const ids = caseIds.filter(ok);
    if (!ids.length) throw apiError('NO_ELIGIBLE_CASES_SELECTED');
    const act: ArchiveDestructionAct = { id: nextId('aa'), number: nextNumber(kind === 'destruction' ? 'AU' : 'GA'), kind, caseIds: ids, createdAt: now(), createdBy: user.id, status: 'draft', history: [{ at: now(), userId: user.id, action: 'created' }] };
    db.acts.push(act);
    for (const id of ids) move(caseById(id)!, user, 'act', act.number);
    log(user, 'create', 'archive_act', act.id, act.number, `${kind}: ${ids.length}`);
    emit();
    return delay(act);
  },

  /** Отправить акт экспертной комиссии (движок согласований). */
  async submitAct(actId: ID, user: User): Promise<void> {
    assertManager(user);
    const act = db.acts.find((a) => a.id === actId);
    if (!act || !['draft', 'rejected'].includes(act.status)) throw apiError('ACT_CANNOT_BE_SUBMITTED');
    act.status = 'pending';
    act.history.push({ at: now(), userId: user.id, action: 'submitted' });
    const pages = act.caseIds.reduce((s, id) => s + (caseById(id)?.pages ?? 0), 0);
    approvalEngine.open({ entity: 'archive_act', entityId: act.id, number: act.number, title: `${act.kind === 'destruction' ? 'Акт о выделении дел к уничтожению' : 'Акт передачи дел в госархив'}: ${act.caseIds.length} дел, ${pages} л.`, requesterId: user.id, context: { subtype: act.kind } });
    log(user, 'submit', 'archive_act', act.id, act.number);
    emit();
    await delay(null);
  },

  /** Исполнить согласованный акт: подпись E-IMZO архивариуса, дела уничтожены / переданы в госархив. */
  async signAct(actId: ID, user: User, signatureId?: ID): Promise<void> {
    assertManager(user);
    const act = db.acts.find((a) => a.id === actId);
    if (!act || act.status !== 'approved') throw apiError('ACT_CANNOT_BE_SIGNED');
    if (act.caseIds.some((id) => caseById(id)?.status === 'issued')) throw apiError('CASE_IS_ISSUED');
    if (signatureId) {
      const s = signatureService.get(signatureId);
      if (!s || s.entity !== 'archive_act' || s.entityId !== act.id) throw apiError('SIGNATURE_NOT_FOUND');
      act.signatureIds = [...(act.signatureIds ?? []), s.id];
    }
    act.status = 'signed';
    act.signedAt = now();
    act.signedBy = user.id;
    act.history.push({ at: now(), userId: user.id, action: 'signed' });
    for (const id of act.caseIds) {
      const c = caseById(id);
      if (!c) continue;
      c.status = act.kind === 'destruction' ? 'destroyed' : 'transferred';
      move(c, user, act.kind === 'destruction' ? 'destroyed' : 'transferred', act.number);
    }
    log(user, 'approve', 'archive_act', act.id, act.number, act.kind);
    emit();
    await delay(null);
  },

  /** История действий по делу: журнал движения + записи журнала аудита. */
  async history(caseId: ID): Promise<ArchiveMovement[]> {
    const c = caseById(caseId);
    return delay(c ? [...c.movements].sort((a, b) => b.at.localeCompare(a.at)) : []);
  },

  // ----- отчёты (PR-ARC-045…047) -----

  movementReport(filter: { from?: string; to?: string } = {}): Promise<ArchiveMovementReportRow[]> {
    const all = [...db.cases.flatMap((c) => c.movements), ...db.documents.flatMap((d) => d.movements)].filter((m) => (!filter.from || m.at.slice(0, 10) >= filter.from) && (!filter.to || m.at.slice(0, 10) <= filter.to));
    const months = [...new Set(all.map((m) => m.at.slice(0, 7)))].sort().reverse();
    return delay(months.map((month) => {
      const ms = all.filter((m) => m.at.startsWith(month));
      const c = (a: ArchiveMovement['action']) => ms.filter((m) => m.action === a).length;
      return { month, received: c('received'), accepted: c('accepted'), issued: c('issued'), returned: c('returned'), copies: c('copied'), destroyed: c('destroyed') + c('transferred') };
    }));
  },

  disciplineReport(): Promise<ArchiveDisciplineRow[]> {
    const users = new Set([...db.requests.map((r) => r.requesterId), ...db.tasks.map((t) => t.responsibleId)]);
    const d = today();
    return delay([...users].map((userId) => {
      const reqs = db.requests.filter((r) => r.requesterId === userId && !r.copy);
      const late = reqs.filter((r) => (r.status === 'issued' && r.dueBack < d) || (r.status === 'returned' && r.returnedAt && r.returnedAt.slice(0, 10) > r.dueBack));
      const days = late.reduce((s, r) => s + Math.max(0, Math.round((new Date((r.returnedAt ?? now()).slice(0, 10)).getTime() - new Date(r.dueBack).getTime()) / DAY)), 0);
      const tasks = db.tasks.filter((t) => t.responsibleId === userId);
      return { userId, departmentId: directory.user(userId)?.departmentId ?? '', issued: reqs.filter((r) => r.issuedAt).length, overdue: late.length, overdueDays: days, tasksOpen: tasks.filter((t) => t.status === 'open').length, tasksOverdue: tasks.filter((t) => t.status === 'open' && t.dueDate < d).length };
    }).sort((a, b) => b.overdue + b.tasksOverdue - (a.overdue + a.tasksOverdue)));
  },

  fundReport(): Promise<ArchiveFundRow[]> {
    const y = Number(today().slice(0, 4));
    const live = db.cases.filter((c) => !['destroyed', 'transferred', 'forming', 'submitted'].includes(c.status));
    const deps = [...new Set(live.map((c) => c.departmentId))];
    return delay(deps.map((departmentId) => {
      const cs = live.filter((c) => c.departmentId === departmentId);
      return { departmentId, cases: cs.length, electronic: cs.filter((c) => c.electronic).length, documents: cs.reduce((s, c) => s + c.documents, 0), pages: cs.reduce((s, c) => s + c.pages, 0), permanent: cs.filter((c) => c.retentionUntil === null).length, expiring: cs.filter((c) => c.retentionUntil && Number(c.retentionUntil.slice(0, 4)) <= y + 1).length };
    }).sort((a, b) => b.cases - a.cases));
  },
};

export { nextBox as archiveSuggestBox };
