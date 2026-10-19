// P4-SEC (PR-SEC-021): архивирование и уничтожение журнала аудита по истечении срока хранения —
// только по утверждённому регламенту, под контролем двух уполномоченных лиц и с отдельной записью аудита.
//
// Процесс: администратор ИБ (право 'admin' на раздел audit_retention) подаёт заявку с подтверждением 2FA →
// заявка уходит в движок согласований (тип audit_retention) внутреннему аудитору (другое лицо, право 'approve') →
// аудитор утверждает с подтверждением 2FA → сервис повторно проверяет цепочку хэшей и неизменность сегмента и
// выполняет действие: «архивирование» — экспорт сегмента с результатами проверки цепочки (пакет JSON с дайджестом),
// «уничтожение» — только уже архивированного сегмента; в журнале остаётся якорь (последний хэш сегмента),
// поэтому проверка целостности оставшейся цепочки продолжает работать. Каждый шаг пишется в журнал.
// В продуктиве — сервер: WORM-хранилище, архив на отчуждаемом носителе, подпись пакета ЭЦП.
import { audit, auditSegmentDigest, AUDIT_RETENTION_YEARS, type AuditAnchor, type AuditEntry } from './audit';
import { clone, delay, emit, now } from './bus';
import { approvalEngine } from './engine';
import { apiError } from './errors';
import { can, consumeStepUp, getUsersRef, registerModuleAccess } from './security';
import { sha256Hex } from './services/bytes';
import type { HistoryEvent, ID, User } from './types';

// Раздел матрицы прав: администратор (admin) — инициирует; внутренний аудитор (approve) — утверждает.
registerModuleAccess('audit_retention', { auditor: 'approve' });

export type AuditRetentionKind = 'archive' | 'destroy';
export type AuditRetentionStatus = 'pending' | 'executed' | 'rejected' | 'failed';

export interface AuditRetentionRequest {
  id: ID;
  number: string;
  kind: AuditRetentionKind;
  status: AuditRetentionStatus;
  /** Записи старше этой даты (YYYY-MM-DD) — срок хранения истёк. */
  cutoff: string;
  retentionYears: number;
  fromSeq: number;
  toSeq: number;
  count: number;
  firstAt: string;
  lastAt: string;
  /** hash последней записи сегмента на момент подачи — повторно сверяется перед исполнением. */
  lastHash: string;
  segmentDigest: string;
  /** Основание: пункт регламента / приказ. */
  regulation: string;
  reason: string;
  initiatorId: ID;
  createdAt: string;
  approverId?: ID;
  decidedAt?: string;
  failure?: string;
  /** Архивирование: пакет (JSON) и его SHA-256; уничтожение: якорь цепочки. */
  archive?: { fileName: string; sha256: string; size: number; chainOk: boolean; payload: string };
  anchor?: AuditAnchor;
  history: HistoryEvent[];
}

export interface AuditRetentionOverview {
  retentionYears: number;
  cutoff: string;
  chain: { ok: boolean; checked: number; brokenAt?: number };
  /** Начальный сегмент с истёкшим сроком хранения (непрерывный, от первой записи журнала). */
  due: { count: number; fromSeq: number; toSeq: number; firstAt: string; lastAt: string; lastHash: string; archived: boolean } | null;
  totalEntries: number;
  anchors: AuditAnchor[];
  pending: AuditRetentionRequest | null;
}

let requests: AuditRetentionRequest[] = [];
let seqNo = 0;

const findUser = (id: ID) => getUsersRef().find((u) => u.id === id);
const actor = (): User | undefined => {
  const a = audit.getActor();
  return a ? findUser(a.id) : undefined;
};

function cutoffDate(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** Непрерывный начальный сегмент журнала с датой раньше cutoff. */
function dueSegment(cutoff: string): AuditEntry[] {
  const all = audit.query().slice().reverse(); // хронологически
  const out: AuditEntry[] = [];
  for (const e of all) {
    if (e.at.slice(0, 10) >= cutoff) break;
    out.push(e);
  }
  return out;
}

const archivedUpTo = () => Math.max(0, ...requests.filter((r) => r.kind === 'archive' && r.status === 'executed').map((r) => r.toSeq));

function overview(): AuditRetentionOverview {
  const cutoff = cutoffDate(AUDIT_RETENTION_YEARS);
  const seg = dueSegment(cutoff);
  const last = seg[seg.length - 1];
  return {
    retentionYears: AUDIT_RETENTION_YEARS,
    cutoff,
    chain: audit.verify(),
    due: seg.length && last
      ? { count: seg.length, fromSeq: seg[0]!.seq, toSeq: last.seq, firstAt: seg[0]!.at, lastAt: last.at, lastHash: last.hash, archived: archivedUpTo() >= last.seq }
      : null,
    totalEntries: audit.query().length,
    anchors: audit.anchors(),
    pending: clone(requests.find((r) => r.status === 'pending') ?? null),
  };
}

function hist(r: AuditRetentionRequest, userId: ID, action: HistoryEvent['action'], comment?: string) {
  r.history.push({ at: now(), userId, action, ...(comment ? { comment } : {}) });
}

function logRequest(r: AuditRetentionRequest, details: string, result: 'success' | 'failure' = 'success') {
  audit.log({ action: r.kind, entity: 'audit_log', entityId: r.id, entityLabel: r.number, details: `${details} · seq ${r.fromSeq}–${r.toSeq} (${r.count}) · ${r.regulation}`, result });
}

/** Архивный пакет: заголовок с результатами проверки цепочки + записи сегмента. */
function buildArchive(r: AuditRetentionRequest, seg: AuditEntry[], approver: User) {
  const prevOk = seg.every((e, i) => i === 0 || e.prevHash === seg[i - 1]!.hash);
  const chain = audit.verify();
  const header = {
    format: 'XB-ERP audit archive v1',
    request: r.number,
    regulation: r.regulation,
    retentionYears: r.retentionYears,
    cutoff: r.cutoff,
    fromSeq: r.fromSeq,
    toSeq: r.toSeq,
    count: seg.length,
    firstAt: seg[0]!.at,
    lastAt: seg[seg.length - 1]!.at,
    firstPrevHash: seg[0]!.prevHash,
    lastHash: seg[seg.length - 1]!.hash,
    segmentDigest: auditSegmentDigest(seg),
    chainVerified: chain.ok && prevOk,
    initiator: findUser(r.initiatorId)?.fullName ?? r.initiatorId,
    approver: approver.fullName,
    createdAt: now(),
  };
  const payload = JSON.stringify({ header, entries: seg }, null, 1);
  return { fileName: `audit-archive-${r.number}.json`, sha256: sha256Hex(payload), size: payload.length, chainOk: header.chainVerified, payload };
}

function execute(r: AuditRetentionRequest, approver: User): void {
  const chain = audit.verify();
  if (!chain.ok) throw apiError('RETENTION_CHAIN_BROKEN');
  const seg = audit.segment(r.toSeq);
  const last = seg[seg.length - 1];
  if (!last || last.hash !== r.lastHash || seg[0]!.seq !== r.fromSeq) throw apiError('RETENTION_SEGMENT_CHANGED');
  if (r.kind === 'archive') {
    r.archive = buildArchive(r, seg, approver);
  } else {
    if (archivedUpTo() < r.toSeq) throw apiError('RETENTION_NOT_ARCHIVED');
    r.anchor = audit.removeSegment(r.toSeq, { requestId: r.id, initiatorId: r.initiatorId, approverId: approver.id });
  }
}

approvalEngine.register('audit_retention', {
  onHistory: (id, e) => {
    const r = requests.find((x) => x.id === id);
    if (r) r.history.push(e);
  },
  onFinal: (id, approved) => {
    const r = requests.find((x) => x.id === id);
    if (!r || r.status !== 'pending') return;
    const a = actor();
    r.decidedAt = now();
    if (a) r.approverId = a.id;
    if (!approved) {
      r.status = 'rejected';
      logRequest(r, 'request rejected by second person', 'failure');
      return;
    }
    try {
      // контроль двух лиц на стороне API: другое лицо, право утверждения и свежее подтверждение 2FA
      if (!a || a.id === r.initiatorId) throw apiError('DUAL_CONTROL_SAME_PERSON');
      if (!can(a, 'audit_retention', 'approve')) throw apiError('NOT_ALLOWED');
      if (!consumeStepUp(a.id)) throw apiError('STEP_UP_REQUIRED');
      execute(r, a);
      r.status = 'executed';
      hist(r, a.id, 'status_changed', r.kind === 'archive' ? `archive ${r.archive?.sha256.slice(0, 12)}…` : `anchor ${r.anchor?.lastHash}`);
      logRequest(r, r.kind === 'archive' ? `segment archived · sha256 ${r.archive?.sha256.slice(0, 16)}… · chain ${r.archive?.chainOk ? 'ok' : 'BROKEN'} · approved by ${a.fullName}` : `segment destroyed · anchor ${r.anchor?.lastHash} · digest ${r.anchor?.segmentDigest} · approved by ${a.fullName}`);
    } catch (e) {
      r.status = 'failed';
      r.failure = e instanceof Error ? e.message : String(e);
      logRequest(r, `execution refused: ${r.failure}`, 'failure');
    }
  },
});

export const auditRetentionApi = {
  overview: (): Promise<AuditRetentionOverview> => delay(overview()),
  list: (): Promise<AuditRetentionRequest[]> => delay(clone(requests).reverse()),

  /** Подать заявку (инициатор — администратор ИБ, после подтверждения 2FA). */
  async request(input: { kind: AuditRetentionKind; regulation: string; reason: string }): Promise<AuditRetentionRequest> {
    const a = actor();
    if (!a || !can(a, 'audit_retention', 'admin')) throw apiError('NOT_ALLOWED');
    if (!input.regulation.trim()) throw apiError('REGULATION_REQUIRED');
    if (!consumeStepUp(a.id)) throw apiError('STEP_UP_REQUIRED');
    const ov = overview();
    if (!ov.chain.ok) throw apiError('RETENTION_CHAIN_BROKEN');
    if (!ov.due) throw apiError('RETENTION_NOTHING_DUE');
    if (ov.pending) throw apiError('RETENTION_PENDING_EXISTS');
    if (input.kind === 'destroy' && !ov.due.archived) throw apiError('RETENTION_NOT_ARCHIVED');
    const seg = audit.segment(ov.due.toSeq);
    const r: AuditRetentionRequest = {
      id: `ar${++seqNo}`,
      number: `AR-${new Date().getFullYear()}-${String(seqNo).padStart(4, '0')}`,
      kind: input.kind,
      status: 'pending',
      cutoff: ov.cutoff,
      retentionYears: ov.retentionYears,
      fromSeq: ov.due.fromSeq,
      toSeq: ov.due.toSeq,
      count: ov.due.count,
      firstAt: ov.due.firstAt,
      lastAt: ov.due.lastAt,
      lastHash: ov.due.lastHash,
      segmentDigest: auditSegmentDigest(seg),
      regulation: input.regulation.trim(),
      reason: input.reason.trim(),
      initiatorId: a.id,
      createdAt: now(),
      history: [],
    };
    requests.push(r);
    hist(r, a.id, 'created', r.reason || undefined);
    logRequest(r, `request filed (${r.kind}), awaiting second person`);
    approvalEngine.open({ entity: 'audit_retention', entityId: r.id, number: r.number, title: `${r.kind === 'archive' ? 'Архивирование' : 'Уничтожение'} журнала аудита: ${r.count} записей до ${r.cutoff}`, requesterId: a.id, context: { subtype: r.kind } });
    emit();
    return delay(clone(r));
  },

  /** Архивный пакет исполненной заявки (для сохранения на носитель). Выгрузка тоже пишется в журнал. */
  async download(id: ID): Promise<{ fileName: string; content: string; sha256: string }> {
    const a = actor();
    if (!a || !can(a, 'audit_retention', 'approve')) throw apiError('NOT_ALLOWED');
    const r = requests.find((x) => x.id === id);
    if (!r?.archive) throw apiError('NOT_FOUND');
    audit.log({ action: 'export', entity: 'audit_log', entityId: r.id, entityLabel: r.number, details: `archive package ${r.archive.fileName} · sha256 ${r.archive.sha256.slice(0, 16)}…` });
    emit();
    return delay({ fileName: r.archive.fileName, content: r.archive.payload, sha256: r.archive.sha256 });
  },
};

/**
 * Демо-история журнала старше срока хранения (2018–2019): входы, изменения прав и настроек в прежней версии
 * системы. Пишется первой — до остальной демо-истории (цепочка хэшей хронологическая).
 */
export function auditRetentionSeed(): Parameters<typeof audit.log>[0][] {
  requests = [];
  seqNo = 0;
  const users = getUsersRef();
  const pick = (i: number) => users[i % users.length]!;
  const out: Parameters<typeof audit.log>[0][] = [];
  const base = Date.UTC(2018, 2, 12, 5, 0, 7);
  for (let i = 0; i < 36; i++) {
    const u = pick(i * 5 + 1);
    const at = new Date(base + i * 17 * 86_400_000 + (i % 7) * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const who = { id: u.id, fullName: u.fullName, role: u.role };
    const kind = i % 6;
    if (kind === 5) out.push({ action: 'settings', entity: 'security_policy', entityLabel: 'policy', details: 'legacy ERP v1: password policy reviewed', user: who, at, ip: '10.12.1.10', device: 'IE 11 / Windows 7' });
    else if (kind === 4) out.push({ action: 'access_change', entity: 'role_access', entityLabel: `${u.role} · legacy`, details: 'legacy ERP v1: role review', user: who, at, ip: '10.12.1.10', device: 'IE 11 / Windows 7' });
    else out.push({ action: 'login', entity: 'session', entityId: u.id, entityLabel: u.login, details: 'password (legacy v1)', user: who, at, ip: `10.12.1.${10 + (i % 30)}`, device: 'IE 11 / Windows 7' });
  }
  return out;
}
