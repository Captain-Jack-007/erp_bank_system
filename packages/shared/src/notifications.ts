// Центр уведомлений (ядро платформы, PR-GEN-080). Один на все модули.
// Модуль вызывает notify({ userIds | role, title, body, link, level }) — получатели видят уведомление
// в колокольчике и на странице /notifications, а при включённой настройке — письмо (mock-почта).
// Бэкенд заменит хранилище на таблицу + рассылку (SMTP/Telegram/push), контракт не меняется.
import { clone, delay, emit, nextId, now } from './bus';
import { directory } from './directory';
import { localize, translate, type TKey } from './i18n';
import type { ID, Lang, Localized, Role, User } from './types';

export type NotificationLevel = 'info' | 'success' | 'warning' | 'danger';
export type NotificationKind =
  | 'task' // назначена задача согласования
  | 'returned' // документ возвращён на доработку
  | 'rejected' // документ отклонён
  | 'approved' // документ окончательно согласован
  | 'sla_soon' // срок задачи скоро истекает
  | 'sla_overdue' // срок задачи истёк
  | 'escalation' // задача эскалирована руководителю
  | 'info_request' // согласующий запросил информацию
  | 'comment' // комментарий по документу
  | 'delegation' // назначен заместителем
  | 'system'; // прочие уведомления модулей

export const NOTIFICATION_KINDS: NotificationKind[] = ['task', 'returned', 'rejected', 'approved', 'sla_soon', 'sla_overdue', 'escalation', 'info_request', 'comment', 'delegation', 'system'];

/** Параметр текста: строка, ключ словаря или значение на нескольких языках. */
export type NotificationParam = string | number | { key: string } | Localized;
/** Текст уведомления: Localized или ключ словаря с параметрами {name}. */
export type NotificationText = string | Localized | { key: string; params?: Record<string, NotificationParam> };

export interface AppNotification {
  id: ID;
  userId: ID;
  kind: NotificationKind;
  level: NotificationLevel;
  title: NotificationText;
  body?: NotificationText;
  link?: string;
  createdAt: string;
  read: boolean;
  dedupeKey?: string;
}

export interface NotifyInput {
  userIds?: ID[];
  role?: Role;
  roles?: Role[];
  /** Не уведомлять этих пользователей (например, автора действия). */
  excludeIds?: ID[];
  title: NotificationText;
  body?: NotificationText;
  link?: string;
  level?: NotificationLevel;
  kind?: NotificationKind;
  /** Повторное уведомление с тем же ключом тому же пользователю не создаётся. */
  dedupeKey?: string;
}

export interface NotificationPrefs {
  userId: ID;
  inApp: Record<NotificationKind, boolean>;
  email: Record<NotificationKind, boolean>;
}

export interface MockEmail {
  id: ID;
  userId: ID;
  to: string;
  subject: NotificationText;
  body?: NotificationText;
  link?: string;
  at: string;
}

const all = <T>(v: T) => Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, v])) as Record<NotificationKind, T>;
const EMAIL_DEFAULT: NotificationKind[] = ['task', 'returned', 'rejected', 'sla_overdue', 'escalation'];
const defaultPrefs = (userId: ID): NotificationPrefs => ({
  userId,
  inApp: all(true),
  email: Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, EMAIL_DEFAULT.includes(k)])) as Record<NotificationKind, boolean>,
});

let items: AppNotification[] = [];
let outbox: MockEmail[] = [];
const prefs = new Map<ID, NotificationPrefs>();

export function resetNotifications(): void {
  items = [];
  outbox = [];
  prefs.clear();
}

function prefsOf(userId: ID): NotificationPrefs {
  return prefs.get(userId) ?? defaultPrefs(userId);
}

/** Отправить уведомление. Возвращает созданные записи (по одной на получателя). */
export function notify(input: NotifyInput): AppNotification[] {
  const ids = new Set<ID>(input.userIds ?? []);
  for (const r of [...(input.roles ?? []), ...(input.role ? [input.role] : [])]) directory.byRole(r).forEach((u) => ids.add(u.id));
  for (const x of input.excludeIds ?? []) ids.delete(x);
  const kind = input.kind ?? 'system';
  const created: AppNotification[] = [];
  for (const userId of ids) {
    if (input.dedupeKey && items.some((n) => n.userId === userId && n.dedupeKey === input.dedupeKey)) continue;
    const p = prefsOf(userId);
    const user = directory.user(userId);
    if (p.email[kind] && user?.email) {
      outbox.unshift({ id: nextId('m'), userId, to: user.email, subject: input.title, ...(input.body ? { body: input.body } : {}), ...(input.link ? { link: input.link } : {}), at: now() });
    }
    if (!p.inApp[kind]) continue;
    const n: AppNotification = {
      id: nextId('n'),
      userId,
      kind,
      level: input.level ?? 'info',
      title: input.title,
      ...(input.body ? { body: input.body } : {}),
      ...(input.link ? { link: input.link } : {}),
      createdAt: now(),
      read: false,
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    };
    items.unshift(n);
    created.push(n);
  }
  return created;
}

function param(v: NotificationParam, lang: Lang): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if ('key' in v) return translate(lang, v.key as TKey);
  return localize(v, lang);
}

/** Текст уведомления на языке интерфейса (подставляет {параметры}). */
export function renderNotificationText(text: NotificationText | undefined, lang: Lang): string {
  if (text === undefined) return '';
  if (typeof text === 'string') return text;
  if ('key' in text) {
    let s = translate(lang, text.key as TKey);
    for (const [k, v] of Object.entries(text.params ?? {})) s = s.split(`{${k}}`).join(param(v, lang));
    return s;
  }
  return localize(text, lang);
}

export const notificationEngine = {
  list(userId: ID): AppNotification[] {
    return items.filter((n) => n.userId === userId);
  },
  unread(userId: ID): number {
    return items.filter((n) => n.userId === userId && !n.read).length;
  },
  all(): AppNotification[] {
    return items;
  },
};

/** API центра уведомлений для экранов (асинхронный, как HTTP). */
export const notificationsApi = {
  list(user: User, filter: { unreadOnly?: boolean; kind?: NotificationKind } = {}): Promise<AppNotification[]> {
    return delay(notificationEngine.list(user.id).filter((n) => (!filter.unreadOnly || !n.read) && (!filter.kind || n.kind === filter.kind)));
  },
  unreadCount(user: User): Promise<number> {
    return delay(notificationEngine.unread(user.id));
  },
  async markRead(id: ID, user: User): Promise<void> {
    const n = items.find((x) => x.id === id && x.userId === user.id);
    if (n && !n.read) {
      n.read = true;
      emit();
    }
    await delay(null);
  },
  async markAllRead(user: User): Promise<void> {
    items.filter((x) => x.userId === user.id).forEach((x) => (x.read = true));
    emit();
    await delay(null);
  },
  getPrefs(user: User): Promise<NotificationPrefs> {
    return delay(prefsOf(user.id));
  },
  async savePrefs(user: User, next: Omit<NotificationPrefs, 'userId'>): Promise<void> {
    prefs.set(user.id, { userId: user.id, inApp: { ...all(true), ...next.inApp }, email: { ...all(false), ...next.email } });
    emit();
    await delay(null);
  },
  /** Mock-почта: письма, которые получил бы пользователь. */
  listOutbox(user: User): Promise<MockEmail[]> {
    return delay(outbox.filter((m) => m.userId === user.id || user.role === 'admin').slice(0, 100));
  },
  /** Модули Phase 2: отправить уведомление и обновить экраны. */
  async send(input: NotifyInput): Promise<AppNotification[]> {
    const out = notify(input);
    emit();
    return delay(clone(out));
  },
};
