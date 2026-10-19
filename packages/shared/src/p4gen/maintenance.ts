// P4-GEN (ТЗ PR-GEN-059/060): режимы работы ИС и Service Desk.
//   maintenanceApi — регламентные технологические окна: планирование (дата/время, затрагиваемые системы,
//                    влияние), создание не позднее чем за 5 рабочих дней до начала, согласование через
//                    approvalEngine (тип 'maintenance_window'), уведомления пользователям и баннер до/во время окна;
//                    аварийный режим (только чтение) — переключатель администратора с баннером и инцидентом.
//   serviceDeskApi — обращения пользователей (инцидент / запрос) создают заявку в Service Desk через
//                    integrationHub (имитируемая система 'servicedesk'), статусы синхронизируются и показываются.
import { audit } from '../audit';
import { clone, delay, emit, historyEvent } from '../bus';
import { approvalEngine } from '../engine';
import { notify } from '../notifications';
import { getUsersRef, registerAccessCap, userRoles } from '../security';
import { INTEGRATION_SYSTEMS, integrationHub } from '../services/integrations';
import type { HistoryEvent, ID, Localized, User } from '../types';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

// ---------- Рабочие дни ----------

/** Праздничные (нерабочие) дни Республики Узбекистан с фиксированной датой, MM-DD. */
export const UZ_FIXED_HOLIDAYS = ['01-01', '01-14', '03-08', '03-21', '05-09', '09-01', '10-01', '12-08'];

export function isWorkingDay(d: Date): boolean {
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return !UZ_FIXED_HOLIDAYS.includes(md);
}

/** Число полных рабочих дней строго между датами (день подачи и день начала не считаются). */
export function workingDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let n = 0;
  for (let d = new Date(a.getTime() + 86_400_000); d < b; d = new Date(d.getTime() + 86_400_000)) if (isWorkingDay(d)) n++;
  return n;
}

/** Самая ранняя дата начала окна (YYYY-MM-DD): после 5 полных рабочих дней от сегодняшнего. */
export function earliestMaintenanceDate(now = Date.now(), minDays = MIN_WORKING_DAYS): string {
  const today = new Date(now);
  let d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  while (workingDaysBetween(today, d) < minDays) d = new Date(d.getTime() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const MIN_WORKING_DAYS = 5;

// ---------- Регламентные окна ----------

export type MaintenanceImpact = 'readonly' | 'partial' | 'full';
export type MaintenanceStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled';
/** Фаза согласованного окна по текущему времени. */
export type MaintenancePhase = 'scheduled' | 'in_progress' | 'completed';
export const MAINTENANCE_IMPACTS: MaintenanceImpact[] = ['readonly', 'partial', 'full'];

/** Компоненты платформы, которые могут затрагиваться окном (плюс системы интеграционной шины). */
export const MAINTENANCE_COMPONENTS: { id: string; name: Localized }[] = [
  { id: 'erp', name: L('XB-ERP целиком', 'XB-ERP to‘liq', 'XB-ERP (whole system)') },
  { id: 'web', name: L('Веб-приложение', 'Veb-ilova', 'Web application') },
  { id: 'mobile', name: L('Мобильное приложение', 'Mobil ilova', 'Mobile app') },
  { id: 'db', name: L('База данных', 'Ma’lumotlar bazasi', 'Database') },
  { id: 'files', name: L('Файловое хранилище и архив', 'Fayl ombori va arxiv', 'File storage and archive') },
  { id: 'reports', name: L('Отчётность и DWH', 'Hisobot va DWH', 'Reporting and DWH') },
];

export interface MaintenanceWindow {
  id: ID;
  number: string;
  title: string;
  description: string;
  start: string;
  end: string;
  systems: string[];
  impact: MaintenanceImpact;
  status: MaintenanceStatus;
  createdBy: ID;
  createdAt: string;
  /** Сколько рабочих дней было до начала на момент отправки. */
  workingDaysAhead: number;
  history: HistoryEvent[];
  notified: string[];
}

export interface MaintenanceInput {
  id?: ID;
  title: string;
  description: string;
  start: string;
  end: string;
  systems: string[];
  impact: MaintenanceImpact;
}

export class MaintenanceError extends Error {
  constructor(public issues: Record<string, string>) {
    super('maintenance invalid');
  }
}

export interface EmergencyState {
  on: boolean;
  reason: string;
  since?: string;
  by?: ID;
  ticketId?: ID;
}

export type SystemBanner =
  | { kind: 'emergency'; state: EmergencyState }
  | { kind: 'upcoming' | 'active'; window: MaintenanceWindow };

const windows: MaintenanceWindow[] = [];
let winSeq = 0;
let emergency: EmergencyState = { on: false, reason: '' };

const actorOf = (id: ID): User | undefined => getUsersRef().find((u) => u.id === id);
const pubActor = (id: ID) => {
  const u = actorOf(id);
  return u ? { id: u.id, fullName: u.fullName, role: u.role } : null;
};

export function maintenancePhase(w: MaintenanceWindow, now = Date.now()): MaintenancePhase | null {
  if (w.status !== 'approved') return null;
  const s = new Date(w.start).getTime();
  const e = new Date(w.end).getTime();
  return now < s ? 'scheduled' : now < e ? 'in_progress' : 'completed';
}

function allUserIds(): ID[] {
  return getUsersRef().filter((u) => u.active !== false).map((u) => u.id);
}

function windowText(w: MaintenanceWindow): string {
  const f = (iso: string) => iso.slice(0, 16).replace('T', ' ');
  return `${w.number} · ${f(w.start)} – ${f(w.end)} UTC`;
}

function validateWindow(input: MaintenanceInput, now: number): Record<string, string> {
  const issues: Record<string, string> = {};
  if (!input.title.trim()) issues.title = 'formRequired';
  const s = new Date(input.start);
  const e = new Date(input.end);
  if (!input.start || Number.isNaN(s.getTime())) issues.start = 'formRequired';
  if (!input.end || Number.isNaN(e.getTime())) issues.end = 'formRequired';
  if (!issues.start && workingDaysBetween(new Date(now), s) < MIN_WORKING_DAYS) issues.start = 'p4g_mw_err_lead';
  if (!issues.start && !issues.end && e.getTime() <= s.getTime()) issues.end = 'endBeforeStart';
  if (!issues.start && !issues.end && e.getTime() - s.getTime() > 24 * 3_600_000) issues.end = 'p4g_mw_err_long';
  if (!input.systems.length) issues.systems = 'p4g_mw_err_systems';
  return issues;
}

approvalEngine.register('maintenance_window', {
  onHistory(id, e) {
    windows.find((w) => w.id === id)?.history.push(e);
  },
  onFinal(id, approved) {
    const w = windows.find((x) => x.id === id);
    if (!w) return;
    w.status = approved ? 'approved' : 'rejected';
    audit.log({ action: approved ? 'approve' : 'reject', entity: 'maintenance_window', entityId: w.id, entityLabel: w.number, details: windowText(w) });
    if (approved) {
      // Уведомление всем пользователям о согласованном окне (PR-GEN-059: работы — только в утверждённом окне).
      notify({
        userIds: allUserIds(),
        title: { ru: `Регламентные работы: ${w.title}`, uz: `Reglament ishlari: ${w.title}`, en: `Scheduled maintenance: ${w.title}` },
        body: windowText(w),
        level: 'warning',
        kind: 'system',
        dedupeKey: `${w.id}:approved`,
      });
      w.notified.push('approved');
    } else {
      notify({ userIds: [w.createdBy], title: { ru: `Окно ${w.number} отклонено`, uz: `${w.number} oynasi rad etildi`, en: `Window ${w.number} rejected` }, link: '/maintenance', level: 'danger', kind: 'rejected' });
    }
    emit();
  },
  onReturned(id) {
    const w = windows.find((x) => x.id === id);
    if (!w) return;
    w.status = 'returned';
    emit();
  },
});

/** Режим «только чтение» действует: аварийный режим или идущее окно с влиянием «только чтение» / «полная остановка». */
export function readOnlyModeActive(now = Date.now()): boolean {
  return emergency.on || windows.some((w) => w.impact !== 'partial' && maintenancePhase(w, now) === 'in_progress');
}

// В режиме «только чтение» все, кроме администратора, получают не выше «просмотра»; обращения в Service Desk,
// справка и уведомления остаются доступными.
const RO_EXEMPT = ['service-desk', 'help', 'notifications'];
registerAccessCap((user, moduleId) => (RO_EXEMPT.includes(moduleId) || userRoles(user).includes('admin') || !readOnlyModeActive() ? null : 'view'));

export const maintenanceApi = {
  components(): { id: string; name: Localized }[] {
    return [...MAINTENANCE_COMPONENTS, ...INTEGRATION_SYSTEMS.filter((s) => !s.disabled).map((s) => ({ id: `int:${s.id}`, name: s.name }))];
  },

  list(): Promise<MaintenanceWindow[]> {
    return delay(windows.slice().sort((a, b) => b.start.localeCompare(a.start)));
  },

  get(id: ID): Promise<MaintenanceWindow | undefined> {
    return delay(windows.find((w) => w.id === id));
  },

  /** Создать окно и отправить на согласование (или повторно — после возврата на доработку). */
  async submit(input: MaintenanceInput, userId: ID, now = Date.now()): Promise<MaintenanceWindow> {
    const issues = validateWindow(input, now);
    if (Object.keys(issues).length) throw new MaintenanceError(issues);
    const t = new Date(now).toISOString();
    const days = workingDaysBetween(new Date(now), new Date(input.start));
    let w = input.id ? windows.find((x) => x.id === input.id) : undefined;
    const fields = { title: input.title.trim(), description: input.description.trim(), start: new Date(input.start).toISOString(), end: new Date(input.end).toISOString(), systems: [...input.systems], impact: input.impact };
    if (w) {
      if (w.status !== 'returned' && w.status !== 'rejected') throw new MaintenanceError({ title: 'p4g_mw_err_state' });
      Object.assign(w, fields, { status: 'pending', workingDaysAhead: days });
      w.history.push(historyEvent(userId, 'submitted'));
    } else {
      w = { id: `mw${++winSeq}`, number: `RW-${new Date(now).getFullYear()}-${String(winSeq).padStart(4, '0')}`, ...fields, status: 'pending', createdBy: userId, createdAt: t, workingDaysAhead: days, history: [historyEvent(userId, 'created'), historyEvent(userId, 'submitted')], notified: [] };
      windows.push(w);
      audit.log({ action: 'create', entity: 'maintenance_window', entityId: w.id, entityLabel: w.number, details: `${windowText(w)} · ${w.impact} · ${w.systems.join(', ')} · ${days} wd`, user: pubActor(userId) });
    }
    approvalEngine.open({ entity: 'maintenance_window', entityId: w.id, number: w.number, title: `${w.number}: ${w.title}`, requesterId: userId, context: { subtype: w.impact } });
    audit.log({ action: 'submit', entity: 'maintenance_window', entityId: w.id, entityLabel: w.number, user: pubActor(userId) });
    emit();
    return delay(w);
  },

  async cancel(id: ID, userId: ID, reason: string): Promise<void> {
    const w = windows.find((x) => x.id === id);
    if (!w) throw new Error('not found');
    if (maintenancePhase(w) === 'completed') throw new Error('completed');
    const was = w.status;
    w.status = 'cancelled';
    w.history.push(historyEvent(userId, 'status_changed', reason));
    audit.log({ action: 'update', entity: 'maintenance_window', entityId: w.id, entityLabel: w.number, changes: [{ field: 'status', from: was, to: 'cancelled' }], details: reason, user: pubActor(userId) });
    if (was === 'approved') notify({ userIds: allUserIds(), title: { ru: `Регламентные работы отменены: ${w.title}`, uz: `Reglament ishlari bekor qilindi: ${w.title}`, en: `Maintenance cancelled: ${w.title}` }, body: windowText(w), level: 'info', kind: 'system' });
    emit();
    await delay(null);
  },

  /** Баннеры для всех экранов: аварийный режим, идущее окно, ближайшее окно (за 72 ч до начала). */
  banners(now = Date.now()): SystemBanner[] {
    const out: SystemBanner[] = [];
    if (emergency.on) out.push({ kind: 'emergency', state: clone(emergency) });
    for (const w of windows) {
      const ph = maintenancePhase(w, now);
      if (ph === 'in_progress') out.push({ kind: 'active', window: clone(w) });
      else if (ph === 'scheduled' && new Date(w.start).getTime() - now <= 72 * 3_600_000) out.push({ kind: 'upcoming', window: clone(w) });
    }
    return out;
  },

  /** Фоновая проверка (таймер приложения): напоминание за 24 ч и уведомление о начале окна. */
  tick(now = Date.now()): number {
    let n = 0;
    for (const w of windows) {
      const ph = maintenancePhase(w, now);
      const left = new Date(w.start).getTime() - now;
      if (ph === 'scheduled' && left <= 24 * 3_600_000 && !w.notified.includes('24h')) {
        w.notified.push('24h');
        notify({ userIds: allUserIds(), title: { ru: `Через 24 часа — регламентные работы: ${w.title}`, uz: `24 soatdan so‘ng reglament ishlari: ${w.title}`, en: `Maintenance in 24 hours: ${w.title}` }, body: windowText(w), level: 'warning', kind: 'system', dedupeKey: `${w.id}:24h` });
        n++;
      }
      if (ph === 'in_progress' && !w.notified.includes('start')) {
        w.notified.push('start');
        notify({ userIds: allUserIds(), title: { ru: `Идут регламентные работы: ${w.title}`, uz: `Reglament ishlari olib borilmoqda: ${w.title}`, en: `Maintenance in progress: ${w.title}` }, body: windowText(w), level: 'warning', kind: 'system', dedupeKey: `${w.id}:start` });
        n++;
      }
    }
    if (n) emit();
    return n;
  },

  getEmergency(): Promise<EmergencyState> {
    return delay(emergency);
  },

  emergencyNow(): EmergencyState {
    return clone(emergency);
  },

  /** Аварийный режим: включает баннер «только чтение» на всех экранах, уведомляет пользователей и регистрирует инцидент в Service Desk. */
  async setEmergency(on: boolean, reason: string, userId: ID): Promise<EmergencyState> {
    if (on && !reason.trim()) throw new MaintenanceError({ reason: 'formRequired' });
    const before = emergency;
    if (on) {
      emergency = { on: true, reason: reason.trim(), since: new Date().toISOString(), by: userId };
      try {
        const tk = await serviceDeskApi.create({ type: 'incident', category: 'error', priority: 'critical', title: `Аварийный режим XB-ERP: ${reason.trim()}`.slice(0, 120), description: reason.trim(), moduleId: 'maintenance' }, userId);
        emergency.ticketId = tk.id;
      } catch {
        /* Service Desk недоступен — режим всё равно включается */
      }
    } else emergency = { on: false, reason: '' };
    audit.log({ action: 'settings', entity: 'emergency_mode', entityLabel: 'emergency', changes: [{ field: 'on', from: String(before.on), to: String(on) }], details: on ? reason.trim() : before.reason, user: pubActor(userId) });
    notify({
      userIds: allUserIds(),
      title: on
        ? { ru: 'Аварийный режим: система доступна только для чтения', uz: 'Avariya rejimi: tizim faqat o‘qish uchun', en: 'Emergency mode: the system is read-only' }
        : { ru: 'Аварийный режим снят — нормальный режим работы', uz: 'Avariya rejimi bekor qilindi — oddiy ish rejimi', en: 'Emergency mode lifted — normal operation' },
      ...(on ? { body: reason.trim() } : {}),
      level: on ? 'danger' : 'success',
      kind: 'system',
    });
    emit();
    return delay(emergency);
  },
};

// ---------- Service Desk ----------

export type SdTicketType = 'incident' | 'request';
export type SdCategory = 'access' | 'error' | 'data' | 'equipment' | 'other';
export type SdPriority = 'low' | 'medium' | 'high' | 'critical';
export type SdStatus = 'queued' | 'new' | 'in_progress' | 'resolved' | 'closed';
export const SD_TYPES: SdTicketType[] = ['incident', 'request'];
export const SD_CATEGORIES: SdCategory[] = ['access', 'error', 'data', 'equipment', 'other'];
export const SD_PRIORITIES: SdPriority[] = ['low', 'medium', 'high', 'critical'];

export interface SdTicket {
  id: ID;
  number: string;
  /** Номер заявки в Service Desk (после доставки). */
  externalId?: string;
  type: SdTicketType;
  category: SdCategory;
  priority: SdPriority;
  title: string;
  description: string;
  moduleId?: string;
  status: SdStatus;
  assignee?: string;
  resolution?: string;
  createdBy: ID;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  exchangeId: ID;
  history: { at: string; status: SdStatus; comment?: string }[];
}

export interface SdInput {
  type: SdTicketType;
  category: SdCategory;
  priority: SdPriority;
  title: string;
  description: string;
  moduleId?: string;
}

const tickets: SdTicket[] = [];
let sdSeq = 0;
let extSeq = 4810;
const NEXT: Record<string, SdStatus> = { new: 'in_progress', in_progress: 'resolved', resolved: 'resolved', closed: 'closed' };
const SD_GROUP: Record<SdCategory, string> = { access: 'IAM / доступы', error: 'Сопровождение XB-ERP (L2)', data: 'Data management', equipment: 'Hardware (L1)', other: 'Service Desk (L1)' };

if (!INTEGRATION_SYSTEMS.some((s) => s.id === 'servicedesk')) {
  INTEGRATION_SYSTEMS.push({
    id: 'servicedesk', tz: 'PR-GEN-060', kind: 'internal', hosts: 'servicedesk.xalq.local',
    name: L('Service Desk банка', 'Bank Service Desk', 'Bank Service Desk'),
    purpose: L('Регистрация инцидентов и запросов пользователей, синхронизация статусов', 'Foydalanuvchi insidentlari va so‘rovlarini ro‘yxatga olish, holatlarni sinxronlash', 'Registering user incidents and requests, status sync'),
    modules: ['service-desk', 'monitoring', 'maintenance'], latency: [150, 450],
    passport: {
      source: 'XB-ERP', target: 'Service Desk', owner: L('Департамент ИТ (Service Desk)', 'AT departamenti (Service Desk)', 'IT Department (Service Desk)'), protocol: 'REST/JSON',
      format: 'JSON (REST v2), UTF-8', endpoint: 'https://servicedesk.xalq.local/api/v2', auth: 'OAuth 2.0 client credentials (svc-xberp-sd)',
      schedule: L('Онлайн; синхронизация статусов — каждые 30 с и по запросу', 'Onlayn; holatlarni sinxronlash — har 30 s va so‘rov bo‘yicha', 'Online; status sync every 30 s and on demand'),
      volume: L('до 500 заявок/сутки', 'kuniga 500 tagacha ariza', 'up to 500 tickets/day'), sla: '99.5%, ≤ 2 s', idempotency: 'Idempotency-Key (UUID)',
      errorCodes: 'timeout, http_500, http_503, validation', controlTotals: L('Количество заявок за сутки', 'Kunlik arizalar soni', 'Daily ticket count'),
    },
    operations: [
      {
        id: 'ticket.create', direction: 'out', schemaVersion: '2.0', name: L('Создать заявку', 'Ariza yaratish', 'Create ticket'),
        sample: () => ({ type: 'incident', category: 'error', priority: 'medium', title: 'Ошибка при печати', description: 'Демо', reporter: 'b.azizov' }),
        validate: (p) => (p.title && p.type ? null : { code: 'validation', message: 'title, type required' }),
        respond: (p) => ({ ticketId: `SD-2026-${String(++extSeq).padStart(6, '0')}`, status: 'new', group: SD_GROUP[(p.category as SdCategory) ?? 'other'] ?? SD_GROUP.other }),
        count: () => 1,
      },
      {
        id: 'ticket.status', direction: 'in', schemaVersion: '2.0', name: L('Статус заявки', 'Ariza holati', 'Ticket status'),
        sample: () => ({ ticketId: 'SD-2026-004811', current: 'new' }),
        validate: (p) => (p.ticketId ? null : { code: 'validation', message: 'ticketId required' }),
        // Имитация работы Service Desk: при каждой синхронизации заявка продвигается на шаг.
        respond: (p) => {
          const next = NEXT[String(p.current)] ?? 'in_progress';
          return { ticketId: p.ticketId, status: next, assignee: next === 'in_progress' || next === 'resolved' ? 'Инженер L2 (дежурный)' : undefined, resolution: next === 'resolved' ? 'Причина устранена, проверьте, пожалуйста' : undefined };
        },
      },
      {
        id: 'ticket.close', direction: 'out', schemaVersion: '2.0', name: L('Подтвердить решение', 'Yechimni tasdiqlash', 'Confirm resolution'),
        sample: () => ({ ticketId: 'SD-2026-004811' }),
        validate: (p) => (p.ticketId ? null : { code: 'validation', message: 'ticketId required' }),
        respond: (p) => ({ ticketId: p.ticketId, status: 'closed' }),
      },
    ],
  });
}

function setStatus(t: SdTicket, status: SdStatus, comment?: string) {
  if (t.status === status) return;
  t.status = status;
  t.updatedAt = new Date().toISOString();
  t.history.push({ at: t.updatedAt, status, ...(comment ? { comment } : {}) });
  notify({
    userIds: [t.createdBy],
    title: { ru: `Обращение ${t.externalId ?? t.number}: статус изменён`, uz: `${t.externalId ?? t.number} murojaati: holat o‘zgardi`, en: `Ticket ${t.externalId ?? t.number}: status changed` },
    body: `${t.title} → ${status}`,
    link: `/service-desk?id=${t.id}`,
    level: status === 'resolved' ? 'success' : 'info',
    kind: 'system',
  });
}

export const serviceDeskApi = {
  /** Создать обращение: заявка уходит в Service Desk через интеграционную шину (при недоступности — очередь). */
  async create(input: SdInput, userId: ID): Promise<SdTicket> {
    const issues: Record<string, string> = {};
    if (!input.title.trim()) issues.title = 'formRequired';
    if (!input.description.trim()) issues.description = 'formRequired';
    if (Object.keys(issues).length) throw new MaintenanceError(issues);
    const u = actorOf(userId);
    const rec = await integrationHub.call('servicedesk', 'ticket.create', { type: input.type, category: input.category, priority: input.priority, title: input.title.trim(), description: input.description.trim(), module: input.moduleId ?? '', reporter: u?.login ?? userId }, { userId });
    const t0 = new Date().toISOString();
    const t: SdTicket = {
      id: `sr${++sdSeq}`, number: `SR-${t0.slice(0, 4)}-${String(sdSeq).padStart(4, '0')}`, type: input.type, category: input.category, priority: input.priority,
      title: input.title.trim(), description: input.description.trim(), ...(input.moduleId ? { moduleId: input.moduleId } : {}), status: 'queued',
      createdBy: userId, createdAt: t0, updatedAt: t0, exchangeId: rec.id, history: [{ at: t0, status: 'queued' }],
    };
    if (rec.status === 'success' && rec.response?.ticketId) {
      t.externalId = String(rec.response.ticketId);
      t.assignee = String(rec.response.group ?? '');
      t.status = 'new';
      t.history.push({ at: t0, status: 'new', comment: t.externalId });
      t.lastSyncAt = t0;
    }
    tickets.push(t);
    audit.log({ action: 'create', entity: 'sd_ticket', entityId: t.id, entityLabel: t.externalId ?? t.number, details: `${t.type} · ${t.priority} · ${t.title}`, user: pubActor(userId) });
    emit();
    return delay(t);
  },

  list(filter: { userId?: ID; all?: boolean } = {}): Promise<SdTicket[]> {
    return delay(tickets.filter((t) => filter.all || t.createdBy === filter.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },

  get(id: ID): Promise<SdTicket | undefined> {
    return delay(tickets.find((t) => t.id === id));
  },

  /** Синхронизация статусов с Service Desk (доставка из очереди, продвижение статусов). */
  async sync(filter: { userId?: ID; all?: boolean } = {}): Promise<{ checked: number; changed: number }> {
    let checked = 0;
    let changed = 0;
    for (const t of tickets.filter((x) => (filter.all || x.createdBy === filter.userId) && x.status !== 'closed')) {
      checked++;
      if (t.status === 'queued') {
        const rec = await integrationHub.getExchange(t.exchangeId);
        if (rec?.status === 'success' && rec.response?.ticketId) {
          t.externalId = String(rec.response.ticketId);
          t.assignee = String(rec.response.group ?? '');
          setStatus(t, 'new', t.externalId);
          t.lastSyncAt = new Date().toISOString();
          changed++;
        }
        continue;
      }
      if (t.status === 'resolved' || !t.externalId) continue;
      try {
        const rec = await integrationHub.call('servicedesk', 'ticket.status', { ticketId: t.externalId, current: t.status }, { mode: 'sync', ...(filter.userId ? { userId: filter.userId } : {}) });
        t.lastSyncAt = new Date().toISOString();
        const next = rec.response?.status as SdStatus | undefined;
        if (rec.response?.assignee) t.assignee = String(rec.response.assignee);
        if (rec.response?.resolution) t.resolution = String(rec.response.resolution);
        if (next && next !== t.status) {
          setStatus(t, next, t.resolution && next === 'resolved' ? t.resolution : undefined);
          changed++;
        }
      } catch {
        /* Service Desk недоступен — повторим при следующей синхронизации */
      }
    }
    emit();
    return delay({ checked, changed });
  },

  /** Пользователь подтверждает решение — заявка закрывается в Service Desk. */
  async confirm(id: ID, userId: ID): Promise<SdTicket> {
    const t = tickets.find((x) => x.id === id);
    if (!t || t.status !== 'resolved' || !t.externalId) throw new Error('not resolved');
    if (t.createdBy !== userId) throw new Error('not owner');
    await integrationHub.call('servicedesk', 'ticket.close', { ticketId: t.externalId }, { userId, mode: 'sync' });
    setStatus(t, 'closed');
    t.lastSyncAt = new Date().toISOString();
    audit.log({ action: 'update', entity: 'sd_ticket', entityId: t.id, entityLabel: t.externalId, changes: [{ field: 'status', from: 'resolved', to: 'closed' }], user: pubActor(userId) });
    emit();
    return delay(t);
  },
};

