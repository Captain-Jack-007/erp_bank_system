// Журнал аудита (Audit Trail) — общий сервис ядра (ТЗ PR-GEN-040, PR-SEC-017…025, 029, 030, 042).
// Только добавление записей: API не умеет изменять или удалять запись. Каждая запись содержит хэш
// предыдущей (цепочка), поэтому любое изменение «задним числом» обнаруживается проверкой целостности.
// В продуктиве журнал пишет сервер в append-only хранилище (WORM) и передаёт в SIEM; срок хранения — 7 лет.
//
// Использование в модулях:  audit.log({ action: 'update', entity: 'warehouse_item', entityId: id, changes: diffFields(before, after) })
// Пользователь, IP и устройство подставляются автоматически (текущая сессия).
import { clone, delay, emit, now } from './bus';
import type { ID, Role } from './types';

export type AuditAction =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'session_timeout'
  | 'lockout'
  | 'unlock'
  | 'otp_sent'
  | 'step_up'
  | 'step_up_failed'
  | 'create'
  | 'update'
  | 'delete'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'export'
  | 'view'
  | 'print'
  | 'block'
  | 'unblock'
  | 'activate'
  | 'deactivate'
  | 'access_change'
  | 'settings'
  // P3-GEN: сессии, пароли, ошибки (PR-SEC-012/027/037/039, PR-FUN-005)
  | 'session_terminated'
  | 'session_rotated'
  | 'password_change'
  | 'error'
  // P4-SEC: хранение журнала и ПДн под контролем двух лиц (PR-SEC-021/049)
  | 'archive'
  | 'destroy'
  | 'anonymize';

export const AUDIT_ACTIONS: AuditAction[] = [
  'login', 'login_failed', 'logout', 'session_timeout', 'lockout', 'unlock', 'otp_sent', 'step_up', 'step_up_failed',
  'create', 'update', 'delete', 'submit', 'approve', 'reject', 'export', 'view', 'print', 'block', 'unblock', 'activate', 'deactivate', 'access_change', 'settings',
  'session_terminated', 'session_rotated', 'password_change', 'error',
  'archive', 'destroy', 'anonymize',
];

/** Срок хранения журналов аудита, лет (уничтожение — по регламенту, комиссией из двух лиц). */
export const AUDIT_RETENTION_YEARS = 7;

export interface AuditChange {
  field: string;
  from: string;
  to: string;
}

export interface AuditEntry {
  id: ID;
  seq: number;
  /** Дата и время с точностью до секунды (ISO 8601, UTC). */
  at: string;
  userId: ID | null;
  userName: string;
  role?: Role;
  action: AuditAction;
  /** Тип объекта: counterparty, cost_center, org_unit, user, role_access, procurement, contract, session… */
  entity: string;
  entityId?: string;
  entityLabel?: string;
  changes?: AuditChange[];
  details?: string;
  ip: string;
  device: string;
  result: 'success' | 'failure';
  prevHash: string;
  hash: string;
}

export interface AuditInput {
  action: AuditAction;
  entity: string;
  entityId?: string;
  entityLabel?: string;
  changes?: AuditChange[];
  details?: string;
  result?: 'success' | 'failure';
  /** Явный пользователь (например, неудачный вход до создания сессии). По умолчанию — текущий. */
  user?: { id: ID; fullName: string; role?: Role } | null;
  /** Для засева демо-истории. */
  at?: string;
  ip?: string;
  device?: string;
}

export interface AuditFilter {
  userId?: ID;
  action?: AuditAction | '';
  entity?: string;
  entityId?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  result?: 'success' | 'failure' | '';
  q?: string;
}

let entries: AuditEntry[] = [];
let seq = 0;

/**
 * P4-SEC (PR-SEC-021): контрольная точка (якорь) уничтоженного по сроку хранения сегмента журнала.
 * Хранит последний хэш удалённого сегмента: первая оставшаяся запись ссылается на него (prevHash),
 * поэтому цепочка остаётся проверяемой, а подмена или удаление записей «в середине» по-прежнему обнаруживается.
 */
export interface AuditAnchor {
  id: ID;
  fromSeq: number;
  toSeq: number;
  count: number;
  firstAt: string;
  lastAt: string;
  /** prevHash первой записи сегмента (= hash предыдущего якоря или 00000000). */
  firstPrevHash: string;
  /** hash последней записи сегмента — на него ссылается следующая запись журнала. */
  lastHash: string;
  /** Дайджест всего сегмента (совпадает с дайджестом архивного пакета). */
  segmentDigest: string;
  requestId: ID;
  initiatorId: ID;
  approverId: ID;
  removedAt: string;
}
let anchors: AuditAnchor[] = [];

/** Дайджест сегмента журнала (для архивного пакета и якоря). */
export function auditSegmentDigest(list: AuditEntry[]): string {
  return fnv(list.map((e) => e.hash).join('|'));
}
let actor: { id: ID; fullName: string; role?: Role } | null = null;
let client = { ip: '10.0.0.1 (demo)', device: 'web' };

/** FNV-1a (32 бит) — достаточно для демонстрации цепочки; на сервере — SHA-256 + подпись. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function digest(e: Omit<AuditEntry, 'hash'>): string {
  return fnv(JSON.stringify([e.seq, e.at, e.userId, e.action, e.entity, e.entityId ?? '', e.changes ?? [], e.details ?? '', e.result, e.ip, e.device, e.prevHash]));
}

function toText(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.ru === 'string' && typeof o.uz === 'string') return o.ru === o.uz ? o.ru : `${o.ru} / ${o.uz}`;
    return JSON.stringify(v);
  }
  return String(v);
}

/** Пополевая разница «было → стало» для записи в журнал (fields — ограничить список полей). */
export function diffFields(before: object | null | undefined, after: object | null | undefined, fields?: string[]): AuditChange[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = fields ?? [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const skip = new Set(['id', 'history', 'version', 'validFrom', 'validTo', 'changedAt', 'changedBy', 'changeReason', 'changeRequestId']);
  return keys
    .filter((k) => !skip.has(k) && JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null))
    .map((k) => ({ field: k, from: toText(b[k]), to: toText(a[k]) }));
}

export const audit = {
  /** Текущий пользователь сессии (устанавливается при входе/выходе). */
  setActor(user: { id: ID; fullName: string; role?: Role } | null): void {
    actor = user ? { id: user.id, fullName: user.fullName, role: user.role } : null;
  },
  getActor() {
    return actor;
  },
  /** Сведения о клиенте: IP и устройство (в вебе — из браузера; IP в продуктиве определяет сервер). */
  setClient(info: { ip?: string; device?: string }): void {
    client = { ...client, ...info };
  },

  log(input: AuditInput): AuditEntry {
    const who = input.user === undefined ? actor : input.user;
    const prevHash = entries.length ? entries[entries.length - 1]!.hash : '00000000';
    const base: Omit<AuditEntry, 'hash'> = {
      id: `al${++seq}`,
      seq,
      at: (input.at ?? now()).replace(/\.\d{3}Z$/, 'Z'),
      userId: who?.id ?? null,
      userName: who?.fullName ?? '—',
      ...(who?.role ? { role: who.role } : {}),
      action: input.action,
      entity: input.entity,
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(input.entityLabel ? { entityLabel: input.entityLabel } : {}),
      ...(input.changes?.length ? { changes: input.changes } : {}),
      ...(input.details ? { details: input.details } : {}),
      ip: input.ip ?? client.ip,
      device: input.device ?? client.device,
      result: input.result ?? 'success',
      prevHash,
    };
    const entry: AuditEntry = { ...base, hash: digest(base) };
    entries.push(entry);
    return entry;
  },

  /** Записи по фильтру, новые сверху. */
  query(filter: AuditFilter = {}): AuditEntry[] {
    const q = filter.q?.trim().toLowerCase();
    return entries
      .filter((e) => !filter.userId || e.userId === filter.userId)
      .filter((e) => !filter.action || e.action === filter.action)
      .filter((e) => !filter.entity || e.entity === filter.entity)
      .filter((e) => !filter.entityId || e.entityId === filter.entityId)
      .filter((e) => !filter.result || e.result === filter.result)
      .filter((e) => !filter.from || e.at.slice(0, 10) >= filter.from)
      .filter((e) => !filter.to || e.at.slice(0, 10) <= filter.to)
      .filter(
        (e) =>
          !q ||
          [e.userName, e.entity, e.entityId, e.entityLabel, e.details, e.ip, ...(e.changes ?? []).flatMap((c) => [c.field, c.from, c.to])]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(q)),
      )
      .slice()
      .reverse();
  },

  /** Проверка цепочки хэшей: изменение любой записи нарушает цепочку. */
  verify(): { ok: boolean; checked: number; brokenAt?: number } {
    // P4-SEC: после уничтожения сегмента по сроку цепочка начинается с якоря (последний хэш удалённого сегмента)
    const anchor = anchors[anchors.length - 1];
    let prev = anchor ? anchor.lastHash : '00000000';
    if (anchor && entries.length && entries[0]!.seq !== anchor.toSeq + 1) return { ok: false, checked: entries.length, brokenAt: entries[0]!.seq };
    for (const e of entries) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prev || digest(rest) !== hash) return { ok: false, checked: entries.length, brokenAt: e.seq };
      prev = hash;
    }
    return { ok: true, checked: entries.length };
  },

  /** Последний успешный вход пользователя. */
  lastLogin(userId: ID): string | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.userId === userId && e.action === 'login' && e.result === 'success') return e.at;
    }
    return undefined;
  },

  /** Только для сброса демо-данных при создании mock-API. */
  reset(): void {
    entries = [];
    seq = 0;
    anchors = [];
  },

  /** P4-SEC: начальный сегмент журнала (записи с seq ≤ toSeq) — копия для архивирования. */
  segment(toSeq: number): AuditEntry[] {
    return clone(entries.filter((e) => e.seq <= toSeq));
  },
  /** P4-SEC: якоря уничтоженных сегментов (старые первыми). */
  anchors(): AuditAnchor[] {
    return clone(anchors);
  },
  /**
   * P4-SEC (PR-SEC-021): уничтожение начального сегмента журнала по истечении срока хранения.
   * Штатными средствами недоступно: вызывается только сервисом хранения журнала (auditRetention.ts) после
   * утверждения заявки вторым уполномоченным лицом; удаляется только непрерывный начальный сегмент,
   * цепочка до него должна быть цела; создаётся якорь, сам факт уничтожения пишется в журнал отдельной записью.
   */
  removeSegment(toSeq: number, approval: { requestId: ID; initiatorId: ID; approverId: ID }): AuditAnchor {
    if (!approval.requestId || !approval.initiatorId || !approval.approverId || approval.initiatorId === approval.approverId) throw new Error('DUAL_CONTROL_SAME_PERSON');
    if (!audit.verify().ok) throw new Error('RETENTION_CHAIN_BROKEN');
    const seg = entries.filter((e) => e.seq <= toSeq);
    if (!seg.length) throw new Error('RETENTION_NOTHING_DUE');
    const a: AuditAnchor = {
      id: `anc${anchors.length + 1}`,
      fromSeq: seg[0]!.seq,
      toSeq: seg[seg.length - 1]!.seq,
      count: seg.length,
      firstAt: seg[0]!.at,
      lastAt: seg[seg.length - 1]!.at,
      firstPrevHash: seg[0]!.prevHash,
      lastHash: seg[seg.length - 1]!.hash,
      segmentDigest: auditSegmentDigest(seg),
      requestId: approval.requestId,
      initiatorId: approval.initiatorId,
      approverId: approval.approverId,
      removedAt: now().replace(/\.\d{3}Z$/, 'Z'),
    };
    anchors.push(a);
    entries = entries.filter((e) => e.seq > toSeq);
    return clone(a);
  },
};

export interface AuditPage {
  rows: AuditEntry[];
  total: number;
  entities: string[];
}

/** API журнала (экран «Журнал аудита»). Доступ — роли auditor и admin (матрица прав, модуль `audit`). */
export const auditApi = {
  list(filter: AuditFilter = {}, page = 1, pageSize = 25): Promise<AuditPage> {
    const all = audit.query(filter);
    const entities = [...new Set(audit.query().map((e) => e.entity))].sort();
    return delay({ rows: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, entities });
  },
  /** Все записи по фильтру — для экспорта. Сам факт экспорта тоже попадает в журнал. */
  async exportRows(filter: AuditFilter = {}, format = 'csv'): Promise<AuditEntry[]> {
    const rows = audit.query(filter);
    audit.log({ action: 'export', entity: 'audit_log', details: `${format.toUpperCase()} · ${rows.length}` });
    emit();
    return delay(rows);
  },
  /** История изменений записи (пополевая): кто, когда, какое поле, с какого значения на какое. */
  history(entity: string, entityId: string): Promise<AuditEntry[]> {
    return delay(audit.query({ entity, entityId }));
  },
  verify(): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
    return delay(audit.verify());
  },
  /** Синхронный снимок (для отчётов внутри ядра). */
  snapshot(): AuditEntry[] {
    return clone(audit.query());
  },
};
