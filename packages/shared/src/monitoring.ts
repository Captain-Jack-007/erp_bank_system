// P3-GEN: мониторинг, диагностика и технический журнал (ТЗ PR-GEN-059/060/061, PR-SEC-010/027/042, PR-FUN-005).
//   reportAppError()  — ошибка приложения → идентификатор события (EV-…), запись в технический журнал и аудит.
//   techLogApi        — единый технический журнал: ошибки приложения, сбои интеграций, события безопасности,
//                       оповещения мониторинга; выгрузка для SIEM (CEF / JSON).
//   monitoringApi     — состояние компонентов, метрики и пороги, инциденты (Service Desk) с уведомлением дежурного,
//                       диагностический отчёт. В продуктиве метрики собирают Prometheus/Zabbix банка; здесь — демо.
import { audit, type AuditEntry } from './audit';
import { clone, delay, emit } from './bus';
import { notify } from './notifications';
import { integrationHub } from './services/integrations';
import { onAccountLockout } from './security';
import type { ID, Localized } from './types';

export type TechLevel = 'error' | 'warning' | 'security' | 'info';
export type TechSource = 'app' | 'integration' | 'security' | 'monitoring';

export interface TechLogEntry {
  id: string;
  at: string;
  level: TechLevel;
  source: TechSource;
  message: string;
  /** Для перевода на экране: код действия аудита / ошибки интеграции. */
  code?: string;
  system?: string;
  details?: string;
  userName?: string;
  /** Отправлено в SIEM (демо: сформирована запись CEF). */
  siem?: boolean;
}

const appErrors: TechLogEntry[] = [];
const monitorLog: TechLogEntry[] = [];
let evSeq = 0;

function eventId(): string {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `EV-${ymd}-${String(++evSeq).padStart(4, '0')}`;
}

/**
 * Зафиксировать ошибку приложения: технические подробности — в журнал (не пользователю), пользователю —
 * идентификатор события для обращения в поддержку (PR-FUN-005, PR-TEC-008).
 */
export function reportAppError(message: string, details?: string): string {
  const id = eventId();
  const a = audit.getActor();
  appErrors.push({ id, at: new Date().toISOString(), level: 'error', source: 'app', message: message.slice(0, 300), ...(details ? { details: details.slice(0, 2000) } : {}), ...(a ? { userName: a.fullName } : {}) });
  if (appErrors.length > 500) appErrors.shift();
  audit.log({ action: 'error', entity: 'app', entityId: id, details: message.slice(0, 300), result: 'failure' });
  emit();
  return id;
}

const SECURITY_ACTIONS = new Set(['login_failed', 'lockout', 'step_up_failed', 'session_terminated']);

export interface TechLogFilter {
  level?: TechLevel | '';
  source?: TechSource | '';
  q?: string;
}

export const techLogApi = {
  async list(filter: TechLogFilter = {}): Promise<TechLogEntry[]> {
    const ex = await integrationHub.listExchanges({});
    const integ: TechLogEntry[] = ex
      .filter((r) => r.status === 'failed' || r.status === 'quarantined' || r.attempts.some((x) => !x.ok))
      .map((r) => ({
        id: r.id,
        at: r.updatedAt,
        level: r.status === 'failed' || r.status === 'quarantined' ? 'error' : 'warning',
        source: 'integration',
        message: `${r.systemId} · ${r.operation}: ${r.status === 'success' ? `retry ok (${r.attempts.length})` : r.error ?? r.status}`,
        code: r.status === 'success' ? 'retry_ok' : r.error ?? r.status,
        system: `${r.systemId} · ${r.operation}`,
        ...(r.errorMessage ? { details: r.errorMessage } : {}),
      }));
    const sec: TechLogEntry[] = audit
      .query()
      .filter((e) => SECURITY_ACTIONS.has(e.action) || (e.action === 'view' && e.result === 'failure'))
      .map((e) => ({ id: e.id, at: e.at, level: 'security', source: 'security', message: `${e.action}${e.entityLabel ? ` · ${e.entityLabel}` : ''}`, code: `audit:${e.action}`, ...(e.entityLabel ? { system: e.entityLabel } : {}), ...(e.details ? { details: e.details } : {}), userName: e.userName, siem: true }));
    const q = filter.q?.trim().toLowerCase();
    return delay(
      [...appErrors, ...monitorLog, ...integ, ...sec]
        .filter((e) => (!filter.level || e.level === filter.level) && (!filter.source || e.source === filter.source))
        .filter((e) => !q || [e.id, e.message, e.details, e.userName].filter(Boolean).some((s) => String(s).toLowerCase().includes(q)))
        .sort((a, b) => b.at.localeCompare(a.at)),
    );
  },
};

// ---------- SIEM: syslog/CEF и JSON (PR-SEC-042) ----------

const cefEsc = (v: string) => v.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/\r?\n/g, ' ');
const SEVERITY: Partial<Record<AuditEntry['action'], number>> = { lockout: 8, login_failed: 5, step_up_failed: 6, session_terminated: 5, access_change: 6, settings: 6, delete: 5, error: 7 };

/** Записи журнала аудита в формате для SIEM банка. */
export function toSiem(entries: AuditEntry[], format: 'cef' | 'json'): string {
  if (format === 'json') {
    return entries
      .map((e) => JSON.stringify({ ts: e.at, product: 'XB-ERP', seq: e.seq, user_id: e.userId, user: e.userName, role: e.role ?? null, action: e.action, object: e.entity, object_id: e.entityId ?? null, changes: e.changes ?? [], details: e.details ?? null, src_ip: e.ip, device: e.device, outcome: e.result, hash: e.hash, prev_hash: e.prevHash }))
      .join('\n');
  }
  return entries
    .map((e) => {
      const sev = e.result === 'failure' ? Math.max(SEVERITY[e.action] ?? 4, 5) : (SEVERITY[e.action] ?? 3);
      const ext = [
        `rt=${new Date(e.at).getTime()}`,
        `suser=${cefEsc(e.userId ?? '-')}`,
        `suid=${cefEsc(e.userName)}`,
        `src=${cefEsc(e.ip)}`,
        `cs1Label=device cs1=${cefEsc(e.device)}`,
        `cs2Label=object cs2=${cefEsc([e.entity, e.entityId].filter(Boolean).join(':'))}`,
        `outcome=${e.result}`,
        `cs3Label=hash cs3=${e.hash}`,
        ...(e.changes?.length ? [`msg=${cefEsc(e.changes.map((c) => `${c.field}: ${c.from} -> ${c.to}`).join('; '))}`] : e.details ? [`msg=${cefEsc(e.details)}`] : []),
      ].join(' ');
      return `CEF:0|XalqBank|XB-ERP|0.2|${e.action}|${e.action} ${e.entity}|${sev}|${ext}`;
    })
    .join('\n');
}

// ---------- Мониторинг компонентов ----------

export type HealthStatus = 'ok' | 'warning' | 'critical' | 'down';
export interface ComponentHealth {
  id: string;
  name: Localized;
  kind: 'app' | 'db' | 'storage' | 'backup' | 'queue' | 'integration';
  status: HealthStatus;
  value: string;
  threshold: string;
}
export interface Incident {
  id: string;
  componentId: string;
  title: string;
  openedAt: string;
  notifiedAt: string;
  resolvedAt?: string;
  status: 'open' | 'resolved';
}

export interface MonitoringThresholds {
  queueWarn: number;
  queueCritical: number;
  errorsWarn: number;
  errorsCritical: number;
  diskWarnPct: number;
  diskCriticalPct: number;
}
let thresholds: MonitoringThresholds = { queueWarn: 1, queueCritical: 10, errorsWarn: 3, errorsCritical: 10, diskWarnPct: 75, diskCriticalPct: 90 };
const incidents: Incident[] = [];
let sdSeq = 0;

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const lvl = (v: number, warn: number, crit: number): HealthStatus => (v >= crit ? 'critical' : v >= warn ? 'warning' : 'ok');

async function computeHealth(): Promise<ComponentHealth[]> {
  const systems = await integrationHub.listSystems();
  const hourAgo = Date.now() - 3_600_000;
  const errors = appErrors.filter((e) => new Date(e.at).getTime() >= hourAgo).length;
  const queue = integrationHub.queueLength();
  const auditCount = audit.query().length;
  const dbGb = 412 + Math.round(auditCount / 100) / 10; // демо: объём растёт с журналом
  const dbPct = Math.round((dbGb / 2048) * 100);
  const filesPct = 63;
  const now = new Date();
  const lastBackup = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 5, 0);
  if (lastBackup.getTime() > now.getTime()) lastBackup.setHours(lastBackup.getHours() - 1);
  const backupAgeMin = Math.round((now.getTime() - lastBackup.getTime()) / 60_000);
  const comps: ComponentHealth[] = [
    { id: 'app', name: L('Сервер приложений', 'Ilova serveri', 'Application server'), kind: 'app', status: lvl(errors, thresholds.errorsWarn, thresholds.errorsCritical), value: `p95 ≈ 180 ms · ${errors} err/h`, threshold: `≤ 300 ms · < ${thresholds.errorsWarn} err/h` },
    { id: 'db', name: L('База данных (PostgreSQL, репликация)', 'Ma’lumotlar bazasi (PostgreSQL)', 'Database (PostgreSQL, replication)'), kind: 'db', status: lvl(dbPct, thresholds.diskWarnPct, thresholds.diskCriticalPct), value: `${dbGb.toFixed(1)} GB / 2 TB (${dbPct}%) · lag 0.4 s`, threshold: `< ${thresholds.diskWarnPct}%` },
    { id: 'storage', name: L('Файловое хранилище и архив', 'Fayl ombori va arxiv', 'File storage and archive'), kind: 'storage', status: lvl(filesPct, thresholds.diskWarnPct, thresholds.diskCriticalPct), value: `${filesPct}%`, threshold: `< ${thresholds.diskWarnPct}%` },
    { id: 'backup', name: L('Резервное копирование', 'Zaxira nusxalash', 'Backup'), kind: 'backup', status: backupAgeMin <= 60 ? 'ok' : 'critical', value: `${lastBackup.toISOString().slice(0, 16).replace('T', ' ')} UTC (${backupAgeMin} min)`, threshold: 'RPO ≤ 60 min' },
    { id: 'queue', name: L('Очередь исходящих сообщений', 'Chiquvchi xabarlar navbati', 'Outbound message queue'), kind: 'queue', status: lvl(queue, thresholds.queueWarn, thresholds.queueCritical), value: String(queue), threshold: `< ${thresholds.queueWarn}` },
    ...systems.map<ComponentHealth>((s) => ({
      id: `int:${s.id}`,
      name: s.system.name,
      kind: 'integration',
      status: !s.up ? 'down' : s.quarantined > 0 || s.queued > 0 ? 'warning' : 'ok',
      value: `${s.up ? 'UP' : 'DOWN'} · ${Math.round(s.successRate * 100)}% · ${s.avgMs} ms`,
      threshold: s.system.passport.sla,
    })),
  ];
  return comps;
}

let scanning = false;
export const monitoringApi = {
  health: (): Promise<ComponentHealth[]> => computeHealth(),
  incidents: (): Promise<Incident[]> => delay(incidents.slice().reverse()),
  getThresholds: (): Promise<MonitoringThresholds> => delay(thresholds),
  async setThresholds(next: MonitoringThresholds): Promise<void> {
    const before = thresholds;
    thresholds = clone(next);
    audit.log({ action: 'settings', entity: 'monitoring', entityLabel: 'thresholds', changes: Object.keys(next).filter((k) => before[k as keyof MonitoringThresholds] !== next[k as keyof MonitoringThresholds]).map((k) => ({ field: k, from: String(before[k as keyof MonitoringThresholds]), to: String(next[k as keyof MonitoringThresholds]) })) });
    emit();
    await delay(null);
  },
  /**
   * Проверка состояния (приложение запускает каждые 30 с): отказ или критический порог → инцидент в Service Desk
   * и уведомление дежурному (роль «Техническая поддержка») немедленно; восстановление → закрытие инцидента.
   */
  async scan(): Promise<{ opened: number; resolved: number }> {
    if (scanning) return { opened: 0, resolved: 0 };
    scanning = true;
    try {
      const comps = await computeHealth();
      let opened = 0;
      let resolved = 0;
      for (const c of comps) {
        const open = incidents.find((i) => i.componentId === c.id && i.status === 'open');
        const bad = c.status === 'down' || c.status === 'critical';
        if (bad && !open) {
          const t = new Date().toISOString();
          const inc: Incident = { id: `SD-${t.slice(0, 4)}-${String(++sdSeq).padStart(5, '0')}`, componentId: c.id, title: `${c.name.ru}: ${c.status.toUpperCase()} (${c.value})`, openedAt: t, notifiedAt: t, status: 'open' };
          incidents.push(inc);
          monitorLog.push({ id: inc.id, at: t, level: 'error', source: 'monitoring', message: inc.title, details: 'Service Desk + duty notification', siem: true });
          audit.log({ action: 'create', entity: 'incident', entityId: inc.id, entityLabel: inc.title, details: 'auto: monitoring', user: null });
          notify({
            role: 'support',
            title: { ru: `Внеплановая остановка: ${c.name.ru}`, uz: `Rejadan tashqari to‘xtash: ${c.name.uz}`, en: `Unplanned outage: ${c.name.en ?? c.name.ru}` },
            body: `${inc.id} · ${c.value}`,
            link: '/monitoring',
            level: 'danger',
            kind: 'system',
            dedupeKey: inc.id,
          });
          // P4-GEN (PR-GEN-060): инцидент регистрируется и во внешнем Service Desk через интеграционную шину
          if (integrationHub.systems.some((x) => x.id === 'servicedesk')) void integrationHub.call('servicedesk', 'ticket.create', { type: 'incident', category: 'error', priority: 'critical', title: inc.title.slice(0, 120), description: `${inc.id} · auto: monitoring`, module: 'monitoring', reporter: 'monitoring' }, { background: true }).catch(() => undefined);
          opened++;
        } else if (!bad && open) {
          open.status = 'resolved';
          open.resolvedAt = new Date().toISOString();
          monitorLog.push({ id: `${open.id}-r`, at: open.resolvedAt, level: 'info', source: 'monitoring', message: `${open.id} resolved`, details: c.value });
          audit.log({ action: 'update', entity: 'incident', entityId: open.id, entityLabel: open.title, details: 'auto: resolved', user: null });
          resolved++;
        }
      }
      if (opened || resolved) emit();
      return { opened, resolved };
    } finally {
      scanning = false;
    }
  },
  /** Диагностический отчёт: состояние, метрики, очереди, инциденты, последние записи технического журнала. */
  async diagnosticReport(): Promise<{ generatedAt: string; version: string; components: ComponentHealth[]; incidents: Incident[]; queue: number; techLog: TechLogEntry[]; auditIntegrity: { ok: boolean; checked: number } }> {
    const components = await computeHealth();
    const log = await techLogApi.list({});
    const v = audit.verify();
    return { generatedAt: new Date().toISOString(), version: 'XB-ERP 0.2 (demo)', components, incidents: incidents.slice(), queue: integrationHub.queueLength(), techLog: log.slice(0, 200), auditIntegrity: { ok: v.ok, checked: v.checked } };
  },
};


// PR-SEC-010: блокировка учётной записи → событие безопасности в SIEM (CEF) и оповещение дежурного ИБ.
onAccountLockout((u, failed) => {
  const t = new Date().toISOString();
  monitorLog.push({ id: eventId(), at: t, level: 'security', source: 'security', message: `lockout · ${u.login ?? u.id}`, code: 'audit:lockout', system: u.login ?? u.id, details: `CEF:0|XalqBank|XB-ERP|0.2|lockout|account locked|8|suser=${u.id} cnt=${failed}`, userName: u.fullName, siem: true });
  notify({
    role: 'support',
    title: { ru: `Блокировка учётной записи: ${u.fullName}`, uz: `Hisob yozuvi bloklandi: ${u.fullName}`, en: `Account locked: ${u.fullName}` },
    body: `${failed} × login_failed → SIEM`,
    link: '/monitoring?tab=log',
    level: 'warning',
    kind: 'system',
  });
});
