// Безопасность ядра: роли и матрица прав (RBAC), пользователи, аутентификация (пароль + 2FA,
// блокировка после неудачных попыток, OneID), подтверждение операций высокого риска (step-up),
// парольная политика и параметры сессий. ТЗ PR-GEN-008/036/037/042/043/045/063, PR-SEC-001…013, 035…038.
//
// Для модулей (Phase 2):
//   can(user, 'warehouse', 'edit')      — проверка права на модуль (none < view < edit < approve < admin)
//   registerModuleAccess('my-module', { employee: 'view', accountant: 'edit' }) — права по умолчанию для нового модуля
// В вебе: useCan() из apps/web/src/lib/access.tsx, useStepUp() — повторный ввод кода для операций высокого риска.
//
// Демо: пароли не хранятся и не передаются никуда — один демо-пароль для всех учётных записей,
// одноразовый код показывается в подсказке на экране. В продуктиве — AD/LDAP + OTP (SMS/токен) на сервере.
import { audit, diffFields } from './audit';
import { clone, delay, emit } from './bus';
import { sha256Hex } from './services/bytes';
import type { ID, Position, Role, User } from './types';
import { apiError } from './errors';

// ---------- Роли ----------

export const ROLES: Role[] = [
  'employee', 'data_entry', 'approver', 'dept_head', 'procurement', 'finance', 'legal', 'accountant', 'treasury',
  'analyst', 'cash_operator', 'hr', 'storekeeper', 'driver', 'archivist', 'tax_officer', 'support', 'auditor', 'admin',
];

/** Категории ТЗ PR-GEN-063 → роли системы. */
export const ROLE_CATEGORIES: { category: string; roles: Role[] }[] = [
  { category: 'end_user', roles: ['employee', 'dept_head', 'procurement', 'legal', 'treasury', 'hr', 'storekeeper', 'driver', 'archivist', 'tax_officer'] },
  { category: 'data_entry', roles: ['data_entry'] },
  { category: 'approver', roles: ['approver', 'dept_head', 'finance'] },
  { category: 'accountant', roles: ['accountant'] },
  { category: 'analyst', roles: ['analyst'] },
  { category: 'cash_operator', roles: ['cash_operator'] },
  { category: 'admin', roles: ['admin'] },
  { category: 'support', roles: ['support'] },
  { category: 'auditor', roles: ['auditor'] },
];

// ---------- Уровни доступа и матрица ----------

export type AccessLevel = 'none' | 'view' | 'edit' | 'approve' | 'admin';
export const ACCESS_LEVELS: AccessLevel[] = ['none', 'view', 'edit', 'approve', 'admin'];
const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, approve: 3, admin: 4 };

/** Бизнес-модули платформы (id совпадают с apps/web/src/modules.tsx). */
export const BUSINESS_MODULES = [
  'dashboard', 'approvals', 'ai', 'master-data', 'procurement', 'contracts', 'einvoices', 'warehouse', 'assets', 'fleet', 'terminals', 'cash',
  'documents', 'archive', 'requests', 'trips', 'budgeting', 'allocation', 'ftp', 'taxes', 'ifrs', 'reporting', 'operations',
];
/** Разделы администрирования. */
export const ADMIN_MODULES = ['users', 'roles', 'security', 'audit'];

type RoleMap = Partial<Record<string, AccessLevel>>;
// P4-SEC (PR-SEC-047, security by default): «бизнес-роли» больше не получают просмотр всех бизнес-разделов.
// Явная матрица наименьших привилегий: BASELINE (что нужно роли для её процессов, включая шаги маршрутов
// согласования, где роль — согласующий) + OVERRIDES (рабочие права). Всё, что не перечислено, — 'none'.
// Аудитор — сквозной просмотр бизнес-разделов (функция контроля). Права модулей, объявленные через
// registerModuleAccess, применяются как прежде; неклассифицированный раздел закрыт для всех, кроме администратора.
const COMMON: RoleMap = { dashboard: 'view', approvals: 'view', ai: 'view', 'master-data': 'view', requests: 'view', trips: 'view', documents: 'view', archive: 'view' }; // архив — поиск дел с учётом грифа
const BASELINE: Partial<Record<Role, RoleMap>> = {
  // Сотрудник: бюджет подразделения (инициирование изменений), закреплённые ОС (МОЛ), заявки на обеспечение со склада
  // и каталог, подписки на отчёты. Финансовые разделы (налоги, МСФО, FTP, аллокация, касса, терминалы,
  // ЭСФ) сотруднику закрыты — минимально необходимые права (PR-SEC-047).
  employee: { ...COMMON, budgeting: 'view', assets: 'view', reporting: 'view', warehouse: 'view' },
  dept_head: { ...COMMON, contracts: 'view', einvoices: 'view', warehouse: 'view', terminals: 'view', reporting: 'view', 'print-forms': 'view' },
  procurement: { ...COMMON, einvoices: 'view', budgeting: 'view', assets: 'view', reporting: 'view', 'print-forms': 'view' },
  finance: { ...COMMON, procurement: 'view', einvoices: 'view', assets: 'view', cash: 'view', reporting: 'view', 'print-forms': 'view' },
  legal: { ...COMMON, procurement: 'view', archive: 'view', 'print-forms': 'view' },
  accountant: { ...COMMON, contracts: 'view', procurement: 'view', cash: 'view', terminals: 'view', budgeting: 'view', reporting: 'view', 'print-forms': 'view' },
  treasury: { ...COMMON, budgeting: 'view', reporting: 'view', 'print-forms': 'view' },
};

const OVERRIDES: Record<Role, RoleMap> = {
  employee: { procurement: 'edit', requests: 'edit', trips: 'edit', documents: 'edit' },
  dept_head: { approvals: 'approve', procurement: 'approve', requests: 'approve', trips: 'approve', documents: 'approve', budgeting: 'approve', assets: 'approve', fleet: 'edit', archive: 'edit' },
  procurement: { procurement: 'edit', contracts: 'edit', 'master-data': 'edit', warehouse: 'edit', approvals: 'approve' },
  finance: { budgeting: 'edit', allocation: 'edit', ftp: 'edit', ifrs: 'edit', taxes: 'edit', approvals: 'approve', contracts: 'edit', 'master-data': 'edit' },
  legal: { contracts: 'approve', documents: 'edit', approvals: 'approve' },
  accountant: { einvoices: 'edit', assets: 'edit', warehouse: 'edit', taxes: 'edit', ifrs: 'edit', allocation: 'edit', trips: 'approve', approvals: 'approve' },
  treasury: { cash: 'edit', ftp: 'edit', terminals: 'edit', contracts: 'edit' },
  admin: {},
  data_entry: { dashboard: 'view', approvals: 'view', 'master-data': 'edit', procurement: 'edit', documents: 'edit', einvoices: 'edit', warehouse: 'edit', requests: 'edit', import: 'edit' },
  approver: { dashboard: 'view', approvals: 'approve', procurement: 'approve', contracts: 'view', documents: 'approve', requests: 'approve', trips: 'approve', budgeting: 'approve', reporting: 'view' },
  analyst: { dashboard: 'view', ai: 'view', reporting: 'edit', operations: 'view', budgeting: 'view', allocation: 'view', ftp: 'view', ifrs: 'view', taxes: 'view', 'master-data': 'view' },
  cash_operator: { dashboard: 'view', cash: 'edit', terminals: 'view', requests: 'edit', approvals: 'view' },
  hr: { dashboard: 'view', requests: 'approve', trips: 'approve', documents: 'edit', users: 'view', approvals: 'view', 'master-data': 'view' },
  storekeeper: { dashboard: 'view', warehouse: 'edit', assets: 'edit', requests: 'edit', approvals: 'view' },
  driver: { dashboard: 'view', fleet: 'view', trips: 'edit', requests: 'edit' },
  archivist: { dashboard: 'view', archive: 'approve', documents: 'view', requests: 'edit', approvals: 'view' }, // P2-DOCS: приём дел в архив; HR — проверка командировок
  tax_officer: { dashboard: 'view', taxes: 'edit', einvoices: 'view', ifrs: 'view', reporting: 'view', requests: 'edit' },
  support: { dashboard: 'view', users: 'view', roles: 'view', security: 'view', integrations: 'view', 'master-data': 'view', requests: 'edit' },
  auditor: { audit: 'view', users: 'view', roles: 'view', security: 'view' },
};

/** Права по умолчанию для разделов, которые добавляют другие сервисы платформы. */
const moduleDefaults = new Map<string, RoleMap>([
  ['notifications', Object.fromEntries(ROLES.map((r) => [r, 'view' as AccessLevel]))],
  ['integrations', { support: 'view', auditor: 'view' }],
  ['import', { data_entry: 'edit' }],
]);

function defaultLevel(role: Role, moduleId: string): AccessLevel {
  if (role === 'admin') return 'admin';
  const o = OVERRIDES[role][moduleId];
  if (o) return o;
  const reg = moduleDefaults.get(moduleId);
  if (reg?.[role]) return reg[role]!;
  const b = BASELINE[role]?.[moduleId];
  if (b) return b;
  if (reg) return 'none';
  if (BUSINESS_MODULES.includes(moduleId)) return role === 'auditor' ? 'view' : 'none';
  // Раздел администрирования или не классифицированный в матрице — закрыт (security by default).
  return 'none';
}

/** P4-SEC: эталонная матрица по умолчанию (без настроек администратора) — для экрана «Роли и права». */
export function defaultRoleAccess(role: Role, moduleId: string): AccessLevel {
  return defaultLevel(role, moduleId);
}

/** Явно заданные администратором значения (поверх значений по умолчанию). */
let custom: Partial<Record<Role, RoleMap>> = {};

/** Новый модуль объявляет права по умолчанию (вызвать при загрузке модуля). */
export function registerModuleAccess(moduleId: string, defaults: Partial<Record<Role, AccessLevel>>): void {
  moduleDefaults.set(moduleId, defaults);
}

export function roleAccess(role: Role, moduleId: string): AccessLevel {
  return custom[role]?.[moduleId] ?? defaultLevel(role, moduleId);
}

/** Учётная запись временно ограничена (трудовой отпуск по событию HR) на текущую дату. */
export function isSuspended(user: Pick<User, 'suspendedUntil'> | null | undefined): boolean {
  return !!user?.suspendedUntil && user.suspendedUntil >= new Date().toISOString().slice(0, 10);
}

export function userRoles(user: Pick<User, 'role' | 'extraRoles'>): Role[] {
  return [...new Set([user.role, ...(user.extraRoles ?? [])])];
}

/** Итоговый уровень пользователя на модуле — максимум по всем его ролям. */
export function accessLevel(user: Pick<User, 'role' | 'extraRoles' | 'active' | 'suspendedUntil'> | null | undefined, moduleId: string): AccessLevel {
  if (!user || user.active === false) return 'none';
  if (isSuspended(user)) return 'none'; // P3-GEN: временное ограничение по HR-событию (отпуск), PR-SEC-002
  const level = userRoles(user).reduce<AccessLevel>((best, r) => {
    const l = roleAccess(r, moduleId);
    return RANK[l] > RANK[best] ? l : best;
  }, 'none');
  // P4-GEN (PR-GEN-059): режим «только чтение» (аварийный режим / регламентное окно) ограничивает права
  const cap = accessCap?.(user, moduleId);
  return cap && RANK[cap] < RANK[level] ? cap : level;
}

/** P4-GEN: внешнее ограничение уровня доступа (режим работы ИС); null — без ограничения. */
let accessCap: ((user: Pick<User, 'role' | 'extraRoles'>, moduleId: string) => AccessLevel | null) | null = null;
export function registerAccessCap(fn: (user: Pick<User, 'role' | 'extraRoles'>, moduleId: string) => AccessLevel | null): void {
  accessCap = fn;
}

/** Есть ли у пользователя право не ниже level на модуль. */
export function can(user: Pick<User, 'role' | 'extraRoles' | 'active'> | null | undefined, moduleId: string, level: AccessLevel = 'view'): boolean {
  return RANK[accessLevel(user, moduleId)] >= RANK[level];
}

export function levelRank(level: AccessLevel): number {
  return RANK[level];
}

/** Конфликты разделения полномочий (SoD): одна учётная запись не должна совмещать эти права. */
export const SOD_RULES: { id: string; a: [string, AccessLevel]; b: [string, AccessLevel] }[] = [
  { id: 'sod_vendor_purchase', a: ['master-data', 'edit'], b: ['procurement', 'approve'] },
  { id: 'sod_contract_pay', a: ['contracts', 'approve'], b: ['cash', 'edit'] },
  { id: 'sod_budget_spend', a: ['budgeting', 'approve'], b: ['procurement', 'edit'] },
  { id: 'sod_admin_audit', a: ['roles', 'edit'], b: ['audit', 'view'] },
];

// ---------- Парольная политика и параметры сессий ----------

export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  expiryDays: number;
  history: number;
  maxAttempts: number;
  lockMinutes: number;
}
export interface SessionPolicy {
  idleMinutes: number;
  warnSeconds: number;
  maxHours: number;
  maxSessions: number;
  workHoursEnforced: boolean;
  workFrom: string; // HH:MM
  workTo: string;
  require2fa: boolean;
}
export interface SecurityPolicy {
  password: PasswordPolicy;
  session: SessionPolicy;
}

/** Минимальные требования политики ИБ банка: настройки слабее этих значений не допускаются (PR-SEC-037). */
export const POLICY_FLOOR = { minLength: 12, maxExpiryDays: 90, minHistory: 5, maxAttempts: 3, minLockMinutes: 15, maxIdleMinutes: 15, maxHours: 12, maxSessions: 2 };

const DEFAULT_POLICY: SecurityPolicy = {
  password: { minLength: 12, requireUpper: true, requireLower: true, requireDigit: true, requireSpecial: true, expiryDays: 90, history: 5, maxAttempts: 3, lockMinutes: 15 },
  session: { idleMinutes: 15, warnSeconds: 60, maxHours: 10, maxSessions: 1, workHoursEnforced: false, workFrom: '08:00', workTo: '20:00', require2fa: true },
};
let policy: SecurityPolicy = clone(DEFAULT_POLICY);

export function getSecurityPolicy(): SecurityPolicy {
  return clone(policy);
}

/** Нарушения политики ИБ в предлагаемых настройках (ключи словаря sec_floor_*). */
export function policyViolations(p: SecurityPolicy): string[] {
  const out: string[] = [];
  if (p.password.minLength < POLICY_FLOOR.minLength) out.push('sec_floor_minLength');
  if (!(p.password.requireUpper && p.password.requireLower && p.password.requireDigit && p.password.requireSpecial)) out.push('sec_floor_complexity');
  if (p.password.expiryDays < 1 || p.password.expiryDays > POLICY_FLOOR.maxExpiryDays) out.push('sec_floor_expiry');
  if (p.password.history < POLICY_FLOOR.minHistory) out.push('sec_floor_history');
  if (p.password.maxAttempts < 1 || p.password.maxAttempts > POLICY_FLOOR.maxAttempts) out.push('sec_floor_attempts');
  if (p.password.lockMinutes < POLICY_FLOOR.minLockMinutes) out.push('sec_floor_lock');
  if (p.session.idleMinutes < 1 || p.session.idleMinutes > POLICY_FLOOR.maxIdleMinutes) out.push('sec_floor_idle');
  if (p.session.maxHours < 1 || p.session.maxHours > POLICY_FLOOR.maxHours) out.push('sec_floor_hours');
  if (p.session.maxSessions < 1 || p.session.maxSessions > POLICY_FLOOR.maxSessions) out.push('sec_floor_sessions');
  if (!p.session.require2fa) out.push('sec_floor_2fa');
  if (p.session.workHoursEnforced && !(p.session.workFrom < p.session.workTo)) out.push('sec_floor_workhours');
  return out;
}

/** Проверка пароля по политике → список нарушенных правил (ключи словаря pwd_rule_*). */
export function passwordViolations(password: string, p: PasswordPolicy = policy.password): string[] {
  const out: string[] = [];
  if (password.length < p.minLength) out.push('pwd_rule_length');
  if (p.requireUpper && !/[A-ZА-ЯЁ]/.test(password)) out.push('pwd_rule_upper');
  if (p.requireLower && !/[a-zа-яё]/.test(password)) out.push('pwd_rule_lower');
  if (p.requireDigit && !/\d/.test(password)) out.push('pwd_rule_digit');
  if (p.requireSpecial && !/[^A-Za-zА-Яа-яЁё0-9]/.test(password)) out.push('pwd_rule_special');
  return out;
}

// ---------- Пользователи и состояние учётных записей ----------

// ---------- P4-SEC (PR-SEC-043): режим сборки ----------
// Сборка по умолчанию — демо-стенд. Промышленная сборка: esbuild --define:__XB_MODE__='"production"'
// или Vite с переменной окружения VITE_XB_MODE=production (см. README). В промышленной сборке нет общего
// демо-пароля, быстрого входа без пароля, имитации OneID с выбором учётной записи и подсказок одноразового кода:
// вход только логин + пароль + 2FA, начальные пароли выдаются администратором и меняются при первом входе.
declare const __XB_MODE__: string | undefined;
export const XB_BUILD_MODE: 'demo' | 'production' = typeof __XB_MODE__ !== 'undefined' && __XB_MODE__ === 'production' ? 'production' : 'demo';
export const IS_DEMO_BUILD = XB_BUILD_MODE === 'demo';

/**
 * Демо-пароль для всех демо-учётных записей (вымышленный; только демо-сборка). Условие записано через __XB_MODE__
 * напрямую, чтобы минификатор промышленной сборки вырезал строку из бандла целиком.
 */
export const DEMO_PASSWORD = typeof __XB_MODE__ !== 'undefined' && __XB_MODE__ === 'production' ? '' : 'Xalq#Demo2026';

interface AuthState {
  failed: number;
  lockedUntil?: number;
}

let users: User[] = [];
let positionList: Position[] = [];
const authState = new Map<ID, AuthState>();

interface Challenge {
  id: string;
  userId: ID;
  code: string;
  expires: number;
  purpose: 'login' | 'step_up';
  action?: string;
  method?: string;
  mustChangePassword?: boolean;
}
const challenges = new Map<string, Challenge>();
let challengeSeq = 0;
/** P4-SEC: время последнего успешного step-up пользователя. */
const stepUps = new Map<ID, number>();

/**
 * P4-SEC: был ли у пользователя успешный step-up за последние maxAgeMs (по умолчанию 5 мин).
 * Однократное использование: подтверждение «расходуется» операцией высокого риска.
 */
export function consumeStepUp(userId: ID, maxAgeMs = 5 * 60_000): boolean {
  const at = stepUps.get(userId);
  if (!at || Date.now() - at > maxAgeMs) return false;
  stepUps.delete(userId);
  return true;
}

function makeCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function newChallenge(userId: ID, purpose: Challenge['purpose'], extra: Partial<Challenge> = {}): Challenge {
  const c: Challenge = { id: `ch${++challengeSeq}`, userId, code: makeCode(), expires: Date.now() + 5 * 60_000, purpose, ...extra };
  challenges.set(c.id, c);
  return c;
}

// ---------- P3-GEN: реестр сессий (PR-SEC-011/012/038/039) ----------
// Идентификатор сессии — 128 бит из криптографического ГСЧ; новый при каждом входе и при изменении полномочий
// (ротация), аннулируется при выходе, таймауте, блокировке, деактивации, превышении длительности или числа
// параллельных сессий и вне разрешённого рабочего времени. В продуктиве — серверная сессия в cookie
// Secure/HttpOnly/SameSite=Strict; в демо ID хранится в памяти и localStorage только для восстановления вкладки.

export type SessionEndReason = 'logout' | 'timeout' | 'concurrent' | 'max_duration' | 'off_hours' | 'admin' | 'locked' | 'deactivated' | 'suspended' | 'rotated';
export interface SessionRecord {
  id: string;
  userId: ID;
  userName: string;
  method: string;
  startedAt: string;
  lastSeenAt: string;
  ip: string;
  device: string;
  status: 'active' | 'ended';
  endedAt?: string;
  endReason?: SessionEndReason;
  /** ID сессии, выданный взамен при ротации. */
  rotatedTo?: string;
}
export type SessionCheck = { ok: true; id: string; rotated?: boolean } | { ok: false; reason: SessionEndReason | 'unknown' };

const sessions = new Map<string, SessionRecord>();
const rotateUsers = new Set<ID>();
let currentSid: string | null = null;
let sessionClient = { ip: '10.12.0.15 (demo)', device: 'web' };

/** Криптографически случайный идентификатор (128 бит, hex). */
export function newSessionId(): string {
  const b = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function endSession(s: SessionRecord, reason: SessionEndReason, by?: User | null): void {
  if (s.status !== 'active') return;
  s.status = 'ended';
  s.endedAt = new Date().toISOString();
  s.endReason = reason;
  if (reason !== 'logout' && reason !== 'timeout' && reason !== 'rotated') {
    audit.log({
      action: 'session_terminated', entity: 'session', entityId: s.userId, entityLabel: `${s.userName} · ${s.device}`,
      details: `${reason} · sid …${s.id.slice(-6)}`, result: 'failure', ...(by === undefined ? {} : { user: by ? pub(by) : null }),
    });
  }
}

function terminateUserSessions(userId: ID, reason: SessionEndReason, exceptId?: string): number {
  let n = 0;
  for (const s of sessions.values()) if (s.userId === userId && s.status === 'active' && s.id !== exceptId) (endSession(s, reason), n++);
  return n;
}

function createSession(u: User, method: string): SessionRecord {
  const max = Math.max(1, policy.session.maxSessions);
  const active = [...sessions.values()].filter((s) => s.userId === u.id && s.status === 'active').sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  // PR-SEC-012: при превышении лимита параллельных сессий завершаются самые старые
  while (active.length >= max) endSession(active.shift()!, 'concurrent', u);
  const t = new Date().toISOString();
  const s: SessionRecord = { id: newSessionId(), userId: u.id, userName: u.fullName, method, startedAt: t, lastSeenAt: t, ip: sessionClient.ip, device: sessionClient.device, status: 'active' };
  sessions.set(s.id, s);
  rotateUsers.delete(u.id);
  currentSid = s.id;
  return s;
}

function seedSessions(): void {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const seed: [ID, string, string, number][] = [
    ['u1', 'XB Mobile / Android 13', '10.40.7.12', 95],
    ['u2', 'Safari / iPadOS 17', '10.12.4.37', 40],
    ['u4', 'Chrome 129 / Windows 11', '10.12.8.3', 25],
  ];
  for (const [uid, device, ip, min] of seed) {
    const u = users.find((x) => x.id === uid);
    if (!u) continue;
    const s: SessionRecord = { id: newSessionId(), userId: uid, userName: u.fullName, method: 'password+otp', startedAt: ago(min), lastSeenAt: ago(Math.min(min, 3)), ip, device, status: 'active' };
    sessions.set(s.id, s);
  }
}

// ---------- P3-GEN: пароли (PR-SEC-037) ----------
// Демо-хранилище: соль + SHA-256 (в продуктиве — Argon2id/bcrypt на сервере, PR-SEC-016). История — последние N хэшей.
interface PasswordRecord {
  salt: string;
  hashes: string[]; // новые первыми
  changedAt: string;
  mustChange?: boolean;
}
const passwords = new Map<ID, PasswordRecord>();
const pwdHash = (salt: string, pwd: string) => sha256Hex(`${salt}:${pwd}`);

function pwdRecord(userId: ID): PasswordRecord {
  let r = passwords.get(userId);
  if (!r) {
    const salt = newSessionId().slice(0, 16);
    // промышленная сборка: общего пароля нет — случайный неизвестный секрет, вход после выдачи пароля администратором
    r = { salt, hashes: [pwdHash(salt, IS_DEMO_BUILD ? DEMO_PASSWORD : newSessionId())], changedAt: new Date().toISOString(), ...(IS_DEMO_BUILD ? {} : { mustChange: true }) };
    passwords.set(userId, r);
  }
  return r;
}

export interface PasswordInfo {
  changedAt: string;
  expiresAt: string;
  expired: boolean;
  mustChange: boolean;
  daysLeft: number;
}
function passwordInfoOf(userId: ID): PasswordInfo {
  const r = pwdRecord(userId);
  const exp = new Date(new Date(r.changedAt).getTime() + policy.password.expiryDays * 86_400_000);
  const daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86_400_000);
  return { changedAt: r.changedAt, expiresAt: exp.toISOString(), expired: daysLeft <= 0, mustChange: !!r.mustChange, daysLeft };
}

/** Нарушения при смене пароля: политика + история + совпадение с логином (ключи словаря pwd_rule_*). */
function newPasswordIssues(u: User, next: string): string[] {
  const out = passwordViolations(next);
  const r = pwdRecord(u.id);
  if (u.login && next.toLowerCase().includes(u.login.toLowerCase())) out.push('pwd_rule_login');
  if (r.hashes.slice(0, Math.max(1, policy.password.history)).includes(pwdHash(r.salt, next))) out.push('pwd_rule_history');
  return out;
}

function setPassword(u: User, next: string, by: 'self' | 'expired'): void {
  const r = pwdRecord(u.id);
  r.hashes = [pwdHash(r.salt, next), ...r.hashes].slice(0, 24);
  r.changedAt = new Date().toISOString();
  delete r.mustChange;
  audit.log({ action: 'password_change', entity: 'user', entityId: u.id, entityLabel: u.fullName, details: by === 'expired' ? 'expired → changed at sign-in' : 'changed by user', user: pub(u) });
}

function seedPasswords(): void {
  passwords.clear();
  for (const u of users) pwdRecord(u.id);
  // демо: у налогового специалиста пароль просрочен (смена 120 дней назад) — при входе по паролю требуется смена
  const r = passwords.get('u17');
  if (r) r.changedAt = new Date(Date.now() - 120 * 86_400_000).toISOString();
}

/** Ошибка аутентификации с кодом для экрана входа. */
export class AuthError extends Error {
  constructor(
    public code: 'invalid' | 'locked' | 'inactive' | 'otp_invalid' | 'otp_expired' | 'not_allowed' | 'off_hours' | 'suspended' | 'service_account' | 'pwd_policy',
    public extra: { until?: string; attemptsLeft?: number; issues?: string[] } = {},
  ) {
    super(`auth:${code}`);
  }
}

/** Инициализация хранилища пользователей (вызывается createMockApi). */
export function initSecurityStore(seedUsers: User[], seedPositions: Position[]): User[] {
  users = clone(seedUsers);
  positionList = clone(seedPositions);
  authState.clear();
  challenges.clear();
  stepUps.clear();
  custom = {};
  policy = clone(DEFAULT_POLICY);
  sessions.clear();
  rotateUsers.clear();
  currentSid = null;
  seedPasswords();
  seedSessions();
  // демо: у бывшего сотрудника (u20) до увольнения была блокировка за неудачные попытки
  return users;
}

export function getUsersRef(): User[] {
  return users;
}

const findUser = (id: ID) => users.find((u) => u.id === id);
const pub = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });
const phoneMask = (u: User) => '+998 ** ***-**-' + String(10 + (Number(u.id.replace(/\D/g, '')) * 7) % 90);

function lockInfo(userId: ID): { locked: boolean; until?: string; failed: number } {
  const st = authState.get(userId);
  if (st?.lockedUntil && st.lockedUntil > Date.now()) return { locked: true, until: new Date(st.lockedUntil).toISOString(), failed: st.failed };
  return { locked: false, failed: st?.failed ?? 0 };
}

function registerFailure(u: User, reason: string): AuthError {
  const st = authState.get(u.id) ?? { failed: 0 };
  st.failed += 1;
  const max = policy.password.maxAttempts;
  if (st.failed >= max) {
    st.lockedUntil = Date.now() + policy.password.lockMinutes * 60_000;
    authState.set(u.id, st);
    audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: reason, result: 'failure', user: pub(u) });
    audit.log({ action: 'lockout', entity: 'user', entityId: u.id, entityLabel: u.fullName, details: `${st.failed}/${max} · ${policy.password.lockMinutes} min`, result: 'failure', user: pub(u) });
    terminateUserSessions(u.id, 'locked', undefined); // PR-SEC-039: сессии аннулируются при блокировке
    lockoutListeners.forEach((fn) => fn(u, st.failed));
    emit();
    return new AuthError('locked', { until: new Date(st.lockedUntil).toISOString() });
  }
  authState.set(u.id, st);
  audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: reason, result: 'failure', user: pub(u) });
  emit();
  return new AuthError(reason === 'otp' ? 'otp_invalid' : 'invalid', { attemptsLeft: max - st.failed });
}

function startSession(u: User, method: string): User {
  if (!withinWorkHours()) {
    audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: `off hours · ${method}`, result: 'failure', user: pub(u) });
    emit();
    throw new AuthError('off_hours');
  }
  if (isSuspended(u)) {
    audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: `suspended until ${u.suspendedUntil}`, result: 'failure', user: pub(u) });
    emit();
    throw new AuthError('suspended', { until: u.suspendedUntil! });
  }
  authState.set(u.id, { failed: 0 });
  audit.setActor(u);
  const s = createSession(u, method);
  audit.log({ action: 'login', entity: 'session', entityId: u.id, entityLabel: u.login, details: `${method} · sid …${s.id.slice(-6)}` });
  emit();
  return u;
}

/** Подписчики на блокировку учётной записи (оповещение ИБ / SIEM). */
const lockoutListeners: ((u: User, failed: number) => void)[] = [];
export function onAccountLockout(fn: (u: User, failed: number) => void): void {
  lockoutListeners.push(fn);
}

function withinWorkHours(): boolean {
  if (!policy.session.workHoursEnforced) return true;
  const d = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return hm >= policy.session.workFrom && hm <= policy.session.workTo;
}

export interface UserInput {
  id?: ID;
  fullName: string;
  login: string;
  email: string;
  phone?: string;
  positionId: ID;
  role: Role;
  extraRoles: Role[];
  departmentId: ID;
  orgUnitKey?: string;
  costCenterKey?: string;
}

export interface AccessReviewRow {
  userId: ID;
  fullName: string;
  login: string;
  active: boolean;
  roles: Role[];
  positionId?: ID;
  levels: Record<string, AccessLevel>;
  lastLogin?: string;
  flags: ('privileged' | 'inactive_with_access' | 'unused' | 'locked' | 'extra_roles')[];
  sod: string[];
}

export interface UserAuthInfo {
  locked: boolean;
  until?: string;
  failed: number;
  lastLogin?: string;
}

// P2-WMS: правила, блокирующие кадровые события (увольнение, перевод) — модули регистрируют проверки.
// Проверка возвращает текст причины (на языке интерфейса) или null.
export type UserChangeKind = { kind: 'deactivate' } | { kind: 'transfer'; departmentId: ID; orgUnitKey?: string };
export type UserChangeGuard = (user: User, change: UserChangeKind) => string | null;
const userChangeGuards: UserChangeGuard[] = [];
export function registerUserChangeGuard(guard: UserChangeGuard): void {
  userChangeGuards.push(guard);
}
export function checkUserChange(user: User, change: UserChangeKind): string | null {
  for (const g of userChangeGuards) {
    const msg = g(user, change);
    if (msg) return msg;
  }
  return null;
}

/** Ошибка валидации формы пользователя: поле → ключ словаря. */
export class ValidationError extends Error {
  constructor(public issues: Record<string, string>) {
    super('validation');
  }
}

export const securityApi = {
  // ---- Аутентификация ----
  /** Шаг 1: логин + пароль → одноразовый код (2FA). В демо код возвращается для подсказки на экране. */
  async authenticate(login: string, password: string): Promise<{ challengeId: string; demoCode: string; phoneMask: string; userName: string; mustChangePassword: boolean; passwordDaysLeft: number }> {
    // PR-SEC-040: сервисные учётные записи интеграций — интерактивный вход запрещён
    if (/^svc[-_.]/i.test(login.trim())) {
      audit.log({ action: 'login_failed', entity: 'service_account', entityLabel: login.trim().slice(0, 40), details: 'interactive login of service account denied', result: 'failure', user: null });
      emit();
      await delay(null);
      throw new AuthError('service_account');
    }
    const u = users.find((x) => x.login?.toLowerCase() === login.trim().toLowerCase());
    if (!u) {
      audit.log({ action: 'login_failed', entity: 'session', entityLabel: login.trim().slice(0, 40), details: 'unknown login', result: 'failure', user: null });
      emit();
      await delay(null);
      throw new AuthError('invalid');
    }
    if (u.active === false) {
      audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: 'inactive', result: 'failure', user: pub(u) });
      emit();
      await delay(null);
      throw new AuthError('inactive');
    }
    const li = lockInfo(u.id);
    if (li.locked) {
      audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: 'locked', result: 'failure', user: pub(u) });
      emit();
      await delay(null);
      throw new AuthError('locked', { until: li.until! });
    }
    if (!withinWorkHours()) {
      audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: 'off hours', result: 'failure', user: pub(u) });
      emit();
      await delay(null);
      throw new AuthError('off_hours');
    }
    const pr = pwdRecord(u.id);
    if (pwdHash(pr.salt, password) !== pr.hashes[0]) {
      const err = registerFailure(u, 'password');
      await delay(null);
      throw err;
    }
    const c = newChallenge(u.id, 'login', { method: 'password+otp' });
    // PR-SEC-037: просроченный пароль (или требование администратора) — смена до второго фактора
    const pi = passwordInfoOf(u.id);
    if (pi.expired || pi.mustChange) {
      c.mustChangePassword = true;
      audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: pi.mustChange ? 'password change required' : 'password expired', result: 'failure', user: pub(u) });
      emit();
      return delay({ challengeId: c.id, demoCode: '', phoneMask: '', userName: u.fullName, mustChangePassword: true, passwordDaysLeft: pi.daysLeft });
    }
    audit.log({ action: 'otp_sent', entity: 'session', entityId: u.id, entityLabel: u.login, details: 'SMS (demo)', user: pub(u) });
    emit();
    return delay({ challengeId: c.id, demoCode: IS_DEMO_BUILD ? c.code : '', phoneMask: phoneMask(u), userName: u.fullName, mustChangePassword: false, passwordDaysLeft: pi.daysLeft });
  },

  /** Смена просроченного пароля на шаге входа (после проверки текущего пароля) → затем второй фактор. */
  async changeExpiredPassword(challengeId: string, next: string): Promise<{ challengeId: string; demoCode: string; phoneMask: string; userName: string }> {
    const c = challenges.get(challengeId);
    if (!c || c.purpose !== 'login' || !c.mustChangePassword || c.expires < Date.now()) throw new AuthError('otp_expired');
    const u = findUser(c.userId)!;
    const issues = newPasswordIssues(u, next);
    if (issues.length) {
      await delay(null);
      throw new AuthError('pwd_policy', { issues });
    }
    setPassword(u, next, 'expired');
    c.mustChangePassword = false;
    c.code = makeCode();
    c.expires = Date.now() + 5 * 60_000;
    audit.log({ action: 'otp_sent', entity: 'session', entityId: u.id, entityLabel: u.login, details: 'SMS (demo)', user: pub(u) });
    emit();
    return delay({ challengeId: c.id, demoCode: IS_DEMO_BUILD ? c.code : '', phoneMask: phoneMask(u), userName: u.fullName });
  },

  /** Смена пароля пользователем (меню профиля): текущий пароль + новый по политике и истории. */
  async changePassword(current: string, next: string): Promise<void> {
    const a = audit.getActor();
    const u = a ? findUser(a.id) : undefined;
    if (!u) throw new AuthError('not_allowed');
    const pr = pwdRecord(u.id);
    if (pwdHash(pr.salt, current) !== pr.hashes[0]) {
      audit.log({ action: 'password_change', entity: 'user', entityId: u.id, entityLabel: u.fullName, details: 'wrong current password', result: 'failure' });
      emit();
      await delay(null);
      throw new AuthError('invalid');
    }
    const issues = newPasswordIssues(u, next);
    if (issues.length) {
      await delay(null);
      throw new AuthError('pwd_policy', { issues });
    }
    setPassword(u, next, 'self');
    emit();
    await delay(null);
  },

  /** Срок действия пароля пользователя (для профиля и карточки пользователя). */
  passwordInfo: (userId: ID): Promise<PasswordInfo> => delay(passwordInfoOf(userId)),

  /** Администратор: потребовать смену пароля при следующем входе. */
  async requirePasswordChange(userId: ID): Promise<void> {
    const u = findUser(userId);
    if (!u) throw apiError('USER_NOT_FOUND');
    pwdRecord(userId).mustChange = true;
    audit.log({ action: 'settings', entity: 'user', entityId: userId, entityLabel: u.fullName, details: 'password change required at next sign-in' });
    emit();
    await delay(null);
  },

  // ---- Сессии (PR-SEC-011/012/038/039) ----
  /** Сведения о клиенте для новых сессий (браузер/ОС, IP определяет сервер). */
  setSessionClient(info: { ip?: string; device?: string }): void {
    sessionClient = { ...sessionClient, ...info };
  },
  /** ID сессии этой вкладки (выдаётся при входе). */
  currentSessionId: (): string | null => currentSid,
  /**
   * Проверка сессии (вызывается вкладкой раз в секунду): аннулирована / просрочена по длительности /
   * вне рабочего времени / пользователь заблокирован, ограничен или деактивирован → ok:false;
   * после изменения полномочий — ротация ID (ok:true, rotated).
   */
  checkSession(sid: string | null): SessionCheck {
    const s = sid ? sessions.get(sid) : undefined;
    if (!s) return { ok: false, reason: 'unknown' };
    if (s.status !== 'active') {
      if (s.endReason === 'rotated' && s.rotatedTo) return securityApi.checkSession(s.rotatedTo);
      return { ok: false, reason: s.endReason ?? 'unknown' };
    }
    const u = findUser(s.userId);
    let reason: SessionEndReason | null = null;
    if (!u || u.active === false) reason = 'deactivated';
    else if (lockInfo(u.id).locked) reason = 'locked';
    else if (isSuspended(u)) reason = 'suspended';
    else if (Date.now() - new Date(s.startedAt).getTime() > policy.session.maxHours * 3_600_000) reason = 'max_duration';
    else if (!withinWorkHours()) reason = 'off_hours';
    if (reason) {
      endSession(s, reason, null);
      // currentSid сохраняется: вкладка при следующей проверке получит причину завершения
      if (currentSid === s.id) audit.setActor(null);
      emit();
      return { ok: false, reason };
    }
    if (rotateUsers.has(s.userId)) {
      // PR-SEC-039: новый идентификатор после изменения полномочий
      rotateUsers.delete(s.userId);
      const n: SessionRecord = { ...s, id: newSessionId(), lastSeenAt: new Date().toISOString() };
      delete n.endedAt;
      delete n.endReason;
      sessions.set(n.id, n);
      s.status = 'ended';
      s.endedAt = n.lastSeenAt;
      s.endReason = 'rotated';
      s.rotatedTo = n.id;
      for (const o of sessions.values()) if (o.userId === s.userId && o.status === 'active' && o.id !== n.id) o.rotatedTo = undefined;
      if (currentSid === s.id) currentSid = n.id;
      audit.log({ action: 'session_rotated', entity: 'session', entityId: s.userId, entityLabel: s.userName, details: `…${s.id.slice(-6)} → …${n.id.slice(-6)} (access change)`, user: u ? pub(u) : null });
      emit();
      return { ok: true, id: n.id, rotated: true };
    }
    if (Date.now() - new Date(s.lastSeenAt).getTime() > 30_000) s.lastSeenAt = new Date().toISOString();
    return { ok: true, id: s.id };
  },
  /** Восстановление вкладки после перезагрузки: та же сессия, если она действительна, иначе — новая. */
  async restoreSession(userId: ID, sid: string | null): Promise<User> {
    const u = findUser(userId);
    if (!u) throw apiError('USER_NOT_FOUND');
    if (u.active === false) throw new AuthError('inactive');
    const s = sid ? sessions.get(sid) : undefined;
    if (s && s.status === 'active' && s.userId === userId && securityApi.checkSession(sid).ok) {
      currentSid = s.id;
      audit.setActor(u);
      return delay(u);
    }
    // вкладка восстановлена без действующей сессии (демо-данные в памяти сброшены) — новая сессия без записи «вход»;
    // в промышленной сборке — только повторный вход (пароль + 2FA)
    if (!IS_DEMO_BUILD) throw new AuthError('not_allowed');
    if (!withinWorkHours()) throw new AuthError('off_hours');
    if (isSuspended(u) || lockInfo(u.id).locked) throw new AuthError('inactive');
    audit.setActor(u);
    createSession(u, 'restore');
    return delay(u);
  },
  /** Активные и недавно завершённые сессии (экран «Безопасность»). */
  listSessions(): Promise<SessionRecord[]> {
    for (const s of sessions.values()) if (s.status === 'active') securityApi.checkSession(s.id);
    const all = [...sessions.values()].filter((s) => s.endReason !== 'rotated');
    const active = all.filter((s) => s.status === 'active').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const ended = all.filter((s) => s.status !== 'active').sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '')).slice(0, 30);
    return delay([...active, ...ended].map((s) => ({ ...s, id: `${s.id.slice(0, 4)}…${s.id.slice(-6)}`, key: s.id }) as SessionRecord & { key: string }));
  },
  /** Принудительное завершение сессии администратором ИБ. */
  async terminateSession(key: string): Promise<void> {
    const a = audit.getActor();
    const actor = a ? findUser(a.id) : undefined;
    if (!actor || !can(actor, 'security', 'edit')) throw new AuthError('not_allowed');
    const s = sessions.get(key);
    if (!s) throw apiError('SESSION_NOT_FOUND');
    endSession(s, 'admin', actor);
    emit();
    await delay(null);
  },

  /** Шаг 2: проверка одноразового кода → вход. Неверный код считается неудачной попыткой. */
  async verifyOtp(challengeId: string, code: string): Promise<User> {
    const c = challenges.get(challengeId);
    if (!c || c.purpose !== 'login' || c.mustChangePassword) throw new AuthError('otp_expired');
    const u = findUser(c.userId)!;
    if (c.expires < Date.now()) {
      challenges.delete(challengeId);
      throw new AuthError('otp_expired');
    }
    if (lockInfo(u.id).locked) throw new AuthError('locked', { until: lockInfo(u.id).until! });
    if (code.trim() !== c.code) {
      const err = registerFailure(u, 'otp');
      if (err.code === 'locked') challenges.delete(challengeId);
      await delay(null);
      throw err;
    }
    challenges.delete(challengeId);
    return delay(startSession(u, c.method ?? 'password+otp'));
  },

  async resendOtp(challengeId: string): Promise<{ demoCode: string }> {
    const c = challenges.get(challengeId);
    if (!c) throw new AuthError('otp_expired');
    c.code = makeCode();
    c.expires = Date.now() + 5 * 60_000;
    audit.log({ action: 'otp_sent', entity: 'session', entityId: c.userId, details: 'resend', user: pub(findUser(c.userId)!) });
    return delay({ demoCode: IS_DEMO_BUILD ? c.code : '' });
  },

  /** Вход через OneID (id.egov.uz) — имитация: учётная запись сопоставляется по ПИНФЛ. */
  async oneIdLogin(userId: ID): Promise<User> {
    if (!IS_DEMO_BUILD) throw apiError('DEMO_DISABLED'); // в продуктиве — OAuth2-редирект id.egov.uz, без выбора учётной записи
    const u = findUser(userId);
    if (!u || u.active === false) throw new AuthError('inactive');
    if (lockInfo(u.id).locked) throw new AuthError('locked', { until: lockInfo(u.id).until! });
    return delay(startSession(u, 'OneID'));
  },

  /**
   * P4-GEN (PR-GEN-018): шаг 1 входа доменной учётной записью — пароль проверяет внешний каталог (AD/LDAP,
   * verify()), дальше те же правила, что и для пароля банка: деактивация, блокировка после неудачных попыток,
   * рабочее время и второй фактор (OTP).
   */
  async authenticateExternal(login: string, verify: () => Promise<'ok' | 'invalid' | 'disabled'>, method: string): Promise<{ challengeId: string; demoCode: string; phoneMask: string; userName: string }> {
    const u = users.find((x) => x.login?.toLowerCase() === login.trim().toLowerCase());
    if (!u) {
      audit.log({ action: 'login_failed', entity: 'session', entityLabel: login.trim().slice(0, 40), details: `unknown login · ${method}`, result: 'failure', user: null });
      emit();
      await delay(null);
      throw new AuthError('invalid');
    }
    const li = lockInfo(u.id);
    if (li.locked) {
      audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: `locked · ${method}`, result: 'failure', user: pub(u) });
      emit();
      throw new AuthError('locked', { until: li.until! });
    }
    const res = await verify();
    if (res === 'disabled' || u.active === false) {
      audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: `inactive · ${method}`, result: 'failure', user: pub(u) });
      emit();
      throw new AuthError('inactive');
    }
    if (!withinWorkHours()) {
      audit.log({ action: 'login_failed', entity: 'session', entityId: u.id, entityLabel: u.login, details: `off hours · ${method}`, result: 'failure', user: pub(u) });
      emit();
      throw new AuthError('off_hours');
    }
    if (res !== 'ok') throw registerFailure(u, 'password');
    const c = newChallenge(u.id, 'login', { method: `${method}+otp` });
    audit.log({ action: 'otp_sent', entity: 'session', entityId: u.id, entityLabel: u.login, details: `SMS (demo) · ${method}`, user: pub(u) });
    emit();
    return delay({ challengeId: c.id, demoCode: IS_DEMO_BUILD ? c.code : '', phoneMask: phoneMask(u), userName: u.fullName });
  },

  /** Быстрый демо-вход (выбор пользователя) и восстановление сессии после перезагрузки. */
  async demoLogin(userId: ID, method = 'demo'): Promise<User> {
    if (!IS_DEMO_BUILD) {
      audit.log({ action: 'login_failed', entity: 'session', entityId: userId, details: 'demo sign-in disabled (production build)', result: 'failure', user: null });
      emit();
      throw apiError('DEMO_DISABLED');
    }
    const u = findUser(userId);
    if (!u) throw apiError('USER_NOT_FOUND');
    if (u.active === false) throw new AuthError('inactive');
    if (method === 'session_restore') return securityApi.restoreSession(userId, null);
    return delay(startSession(u, method));
  },

  async logout(reason: 'manual' | 'timeout' = 'manual'): Promise<void> {
    const a = audit.getActor();
    if (a) audit.log({ action: reason === 'timeout' ? 'session_timeout' : 'logout', entity: 'session', entityId: a.id });
    const s = currentSid ? sessions.get(currentSid) : undefined;
    if (s) endSession(s, reason === 'timeout' ? 'timeout' : 'logout');
    currentSid = null;
    audit.setActor(null);
    emit();
    await delay(null);
  },

  /** Подтверждение операции высокого риска: выдаёт новый одноразовый код текущему пользователю. */
  async requestStepUp(action: string): Promise<{ challengeId: string; demoCode: string }> {
    const a = audit.getActor();
    if (!a) throw new AuthError('not_allowed');
    const c = newChallenge(a.id, 'step_up', { action });
    return delay({ challengeId: c.id, demoCode: IS_DEMO_BUILD ? c.code : '' });
  },

  async verifyStepUp(challengeId: string, code: string): Promise<void> {
    const c = challenges.get(challengeId);
    if (!c || c.purpose !== 'step_up' || c.expires < Date.now()) throw new AuthError('otp_expired');
    if (code.trim() !== c.code) {
      audit.log({ action: 'step_up_failed', entity: 'session', details: c.action, result: 'failure' });
      emit();
      await delay(null);
      throw new AuthError('otp_invalid');
    }
    challenges.delete(challengeId);
    stepUps.set(c.userId, Date.now()); // P4-SEC: для операций под контролем двух лиц (проверка на стороне API)
    audit.log({ action: 'step_up', entity: 'session', details: c.action });
    emit();
    await delay(null);
  },

  // ---- Пользователи (PR-GEN-036, PR-SEC-002/008) ----
  listPositions: (): Promise<Position[]> => delay(positionList),

  authInfo(): Promise<Record<ID, UserAuthInfo>> {
    const out: Record<ID, UserAuthInfo> = {};
    for (const u of users) {
      const li = lockInfo(u.id);
      const last = audit.lastLogin(u.id);
      out[u.id] = { ...li, ...(last ? { lastLogin: last } : {}) };
    }
    return delay(out);
  },

  async saveUser(input: UserInput): Promise<User> {
    const issues: Record<string, string> = {};
    if (!input.fullName.trim()) issues.fullName = 'formRequired';
    if (!/^[a-z0-9._-]{3,32}$/.test(input.login.trim())) issues.login = 'usr_err_login';
    else if (users.some((u) => u.login === input.login.trim() && u.id !== input.id)) issues.login = 'usr_err_login_dup';
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(input.email.trim())) issues.email = 'usr_err_email';
    else if (users.some((u) => u.email.toLowerCase() === input.email.trim().toLowerCase() && u.id !== input.id)) issues.email = 'usr_err_email_dup';
    if (!input.positionId) issues.positionId = 'formRequired';
    if (!input.departmentId) issues.departmentId = 'formRequired';
    if (Object.keys(issues).length) throw new ValidationError(issues);
    // P2-WMS: перевод сотрудника в другое подразделение блокируется, пока за ним числятся ценности.
    if (input.id) {
      const cur = findUser(input.id);
      if (cur && (cur.departmentId !== input.departmentId || (cur.orgUnitKey ?? '') !== (input.orgUnitKey ?? ''))) {
        const msg = checkUserChange(cur, { kind: 'transfer', departmentId: input.departmentId, ...(input.orgUnitKey ? { orgUnitKey: input.orgUnitKey } : {}) });
        if (msg) throw new ValidationError({ departmentId: msg });
      }
    }
    const pos = positionList.find((p) => p.id === input.positionId);
    const fields = {
      fullName: input.fullName.trim(),
      login: input.login.trim(),
      email: input.email.trim(),
      ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
      positionId: input.positionId,
      position: pos ? clone(pos.name) : { ru: '', uz: '' },
      role: input.role,
      extraRoles: input.extraRoles.filter((r) => r !== input.role),
      departmentId: input.departmentId,
      ...(input.orgUnitKey ? { orgUnitKey: input.orgUnitKey } : {}),
      ...(input.costCenterKey ? { costCenterKey: input.costCenterKey } : {}),
    };
    let u = input.id ? findUser(input.id) : undefined;
    if (u) {
      const before = clone(u);
      Object.assign(u, fields);
      if (!input.orgUnitKey) delete u.orgUnitKey;
      if (!input.costCenterKey) delete u.costCenterKey;
      const changes = diffFields(before, u, ['fullName', 'login', 'email', 'phone', 'positionId', 'role', 'extraRoles', 'departmentId', 'orgUnitKey', 'costCenterKey']);
      if (changes.length) {
        const accessChanged = changes.some((c) => c.field === 'role' || c.field === 'extraRoles');
        audit.log({ action: accessChanged ? 'access_change' : 'update', entity: 'user', entityId: u.id, entityLabel: u.fullName, changes });
        if (accessChanged) rotateUsers.add(u.id); // PR-SEC-039: ротация ID сессии при изменении полномочий
      }
    } else {
      const max = users.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
      u = { id: `u${max + 1}`, ...fields, active: true };
      users.push(u);
      audit.log({ action: 'create', entity: 'user', entityId: u.id, entityLabel: u.fullName, changes: diffFields({}, u, ['fullName', 'login', 'email', 'positionId', 'role', 'extraRoles', 'departmentId', 'orgUnitKey']) });
    }
    emit();
    return delay(u);
  },

  async setUserActive(id: ID, active: boolean): Promise<void> {
    const u = findUser(id);
    if (!u) throw apiError('USER_NOT_FOUND');
    if (audit.getActor()?.id === id && !active) throw apiError('USER_SELF_DEACTIVATE');
    if (!active) {
      const msg = checkUserChange(u, { kind: 'deactivate' }); // P2-WMS: увольнение при числящихся ценностях
      if (msg) throw new Error(msg);
    }
    u.active = active;
    audit.log({ action: active ? 'activate' : 'deactivate', entity: 'user', entityId: id, entityLabel: u.fullName, changes: [{ field: 'active', from: String(!active), to: String(active) }] });
    if (!active) terminateUserSessions(id, 'deactivated');
    emit();
    await delay(null);
  },

  /** P3-GEN: временное ограничение доступа по HR-событию (отпуск) — по дату включительно; null — снять. */
  async setSuspension(id: ID, until: string | null, details: string): Promise<void> {
    const u = findUser(id);
    if (!u) throw apiError('USER_NOT_FOUND');
    const before = u.suspendedUntil ?? '';
    if (until) u.suspendedUntil = until;
    else delete u.suspendedUntil;
    audit.log({ action: until ? 'block' : 'unblock', entity: 'user', entityId: id, entityLabel: u.fullName, changes: [{ field: 'suspendedUntil', from: before || '—', to: until ?? '—' }], details });
    if (until && isSuspended(u)) terminateUserSessions(id, 'suspended');
    emit();
    await delay(null);
  },

  /** P3-GEN (PR-SEC-003): отзыв дополнительных ролей уполномоченным лицом по итогам access review. */
  async revokeExtraRoles(id: ID, details: string): Promise<void> {
    const u = findUser(id);
    if (!u) throw apiError('USER_NOT_FOUND');
    const a = audit.getActor();
    const actor = a ? findUser(a.id) : undefined;
    if (!actor || !can(actor, 'users', 'edit')) throw new AuthError('not_allowed');
    const before = u.extraRoles ?? [];
    if (!before.length) return;
    u.extraRoles = [];
    audit.log({ action: 'access_change', entity: 'user', entityId: id, entityLabel: u.fullName, changes: [{ field: 'extraRoles', from: before.join(', '), to: '—' }], details });
    rotateUsers.add(id);
    emit();
    await delay(null);
  },

  /** Разблокировка учётной записи администратором (по регламенту). */
  async unlockUser(id: ID): Promise<void> {
    const u = findUser(id);
    if (!u) throw apiError('USER_NOT_FOUND');
    authState.set(id, { failed: 0 });
    audit.log({ action: 'unlock', entity: 'user', entityId: id, entityLabel: u.fullName });
    emit();
    await delay(null);
  },

  // ---- Матрица прав (PR-SEC-035) ----
  getMatrix(moduleIds: string[]): Promise<Record<Role, Record<string, AccessLevel>>> {
    const out = {} as Record<Role, Record<string, AccessLevel>>;
    for (const r of ROLES) out[r] = Object.fromEntries(moduleIds.map((m) => [m, roleAccess(r, m)]));
    return delay(out);
  },

  async setAccess(role: Role, moduleId: string, level: AccessLevel): Promise<void> {
    if (role === 'admin' && ADMIN_MODULES.includes(moduleId) && level !== 'admin') throw apiError('ADMIN_LOCKOUT');
    const before = roleAccess(role, moduleId);
    if (before === level) return;
    custom[role] = { ...(custom[role] ?? {}), [moduleId]: level };
    audit.log({ action: 'access_change', entity: 'role_access', entityId: `${role}:${moduleId}`, entityLabel: `${role} · ${moduleId}`, changes: [{ field: moduleId, from: before, to: level }] });
    users.filter((u) => userRoles(u).includes(role)).forEach((u) => rotateUsers.add(u.id));
    emit();
    await delay(null);
  },

  async resetMatrix(): Promise<void> {
    custom = {};
    audit.log({ action: 'access_change', entity: 'role_access', details: 'reset to defaults' });
    emit();
    await delay(null);
  },

  /** Отчёт access review: кто к чему имеет доступ, конфликты SoD, избыточные/неиспользуемые права. */
  accessReview(moduleIds: string[]): Promise<AccessReviewRow[]> {
    const nowMs = Date.now();
    const rows = users.map<AccessReviewRow>((u) => {
      const asActive = { ...u, active: true };
      const levels = Object.fromEntries(moduleIds.map((m) => [m, accessLevel(asActive, m)]));
      const last = audit.lastLogin(u.id);
      const flags: AccessReviewRow['flags'] = [];
      if (Object.values(levels).includes('admin')) flags.push('privileged');
      if (u.active === false && Object.values(levels).some((l) => l !== 'none')) flags.push('inactive_with_access');
      if (u.active !== false && (!last || nowMs - new Date(last).getTime() > 90 * 86_400_000)) flags.push('unused');
      if (lockInfo(u.id).locked) flags.push('locked');
      if (u.extraRoles?.length) flags.push('extra_roles');
      const sod = SOD_RULES.filter((r) => can(asActive, r.a[0], r.a[1]) && can(asActive, r.b[0], r.b[1])).map((r) => r.id);
      return { userId: u.id, fullName: u.fullName, login: u.login ?? '', active: u.active !== false, roles: userRoles(u), ...(u.positionId ? { positionId: u.positionId } : {}), levels, ...(last ? { lastLogin: last } : {}), flags, sod };
    });
    return delay(rows);
  },

  // ---- Политика (PR-SEC-037/038) ----
  getPolicy: (): Promise<SecurityPolicy> => delay(policy),

  async savePolicy(next: SecurityPolicy): Promise<void> {
    const v = policyViolations(next);
    if (v.length) throw new ValidationError(Object.fromEntries(v.map((k) => [k, k])));
    const before = policy;
    policy = clone(next);
    const changes = [...diffFields(before.password, policy.password).map((c) => ({ ...c, field: `password.${c.field}` })), ...diffFields(before.session, policy.session).map((c) => ({ ...c, field: `session.${c.field}` }))];
    if (changes.length) audit.log({ action: 'settings', entity: 'security_policy', entityLabel: 'policy', changes });
    emit();
    await delay(null);
  },
};

/** Засев демо-истории журнала (входы, неудачные попытки, блокировка) — детерминированно. */
export function seedSecurityAudit(extra: Parameters<typeof audit.log>[0][] = []): void {
  const queue: Parameters<typeof audit.log>[0][] = [...extra];
  const push = (e: Parameters<typeof audit.log>[0]) => queue.push(e);
  const day = (d: number, h: number, m = 0) => {
    const base = new Date();
    const t = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - d, h, m, 7));
    return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
  };
  const ips = ['10.12.4.21', '10.12.4.37', '10.40.1.15', '10.12.8.3', '10.70.2.44'];
  const ua = 'Chrome 129 / Windows 10';
  const active = users.filter((u) => u.active !== false && !['u10', 'u15'].includes(u.id));
  for (let d = 14; d >= 1; d--) {
    active.forEach((u, i) => {
      if ((d + i) % 3 === 0) return;
      const ip = ips[i % ips.length]!;
      push({ action: 'login', entity: 'session', entityId: u.id, entityLabel: u.login, details: i % 4 === 0 ? 'OneID' : 'password+otp', user: pub(u), at: day(d, 3 + (i % 5), (i * 7) % 60), ip, device: ua });
      if (i % 2 === 0) push({ action: 'logout', entity: 'session', entityId: u.id, user: pub(u), at: day(d, 12 + (i % 4), (i * 11) % 60), ip, device: ua });
    });
  }
  const s = users.find((u) => u.id === 'u20');
  if (s) {
    for (let k = 1; k <= 3; k++) push({ action: 'login_failed', entity: 'session', entityId: s.id, entityLabel: s.login, details: 'password', result: 'failure', user: pub(s), at: day(9, 6, k), ip: '10.40.9.9', device: 'Firefox 131 / Windows 11' });
    push({ action: 'lockout', entity: 'user', entityId: s.id, entityLabel: s.fullName, details: '3/3 · 15 min', result: 'failure', user: pub(s), at: day(9, 6, 4), ip: '10.40.9.9', device: 'Firefox 131 / Windows 11' });
    const adm = users.find((u) => u.id === 'u6')!;
    push({ action: 'deactivate', entity: 'user', entityId: s.id, entityLabel: s.fullName, changes: [{ field: 'active', from: 'true', to: 'false' }], details: 'HR: увольнение (демо)', user: pub(adm), at: day(8, 9, 30), ip: ips[0], device: ua });
  }
  push({ action: 'login_failed', entity: 'session', entityLabel: 'admin', details: 'unknown login', result: 'failure', user: null, at: day(3, 1, 12), ip: '10.99.0.7', device: 'curl/8.4' });
  // журнал пишется в хронологическом порядке (цепочка хэшей)
  queue.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')).forEach((e) => audit.log(e));
}
