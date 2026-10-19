// P4-GEN (ТЗ PR-GEN-018): единая идентификация — корпоративный каталог Active Directory / LDAP.
// Каталог банка имитируется внешней системой интеграционной шины (integrationHub, система 'ad'):
//   ldap.bind     — проверка пароля доменной учётной записи (пароль не попадает в журнал обмена —
//                   передаётся «защищённым каналом» по одноразовому идентификатору запроса);
//   users.delta   — выгрузка учётных записей подразделения OU=XB-ERP (для синхронизации).
// adApi: вход «Доменная учётная запись (AD)» (дальше — 2FA, как при обычном входе), синхронизация
// пользователей с предпросмотром различий (новые / изменённые / отключённые) и применением,
// сопоставление групп AD → роли XB-ERP (редактирование — с аудитом).
import { audit } from '../audit';
import { clone, delay, emit } from '../bus';
import { directory } from '../directory';
import { DEMO_PASSWORD, getUsersRef, ROLES, securityApi } from '../security';
import { INTEGRATION_SYSTEMS, integrationHub, IntegrationUnavailableError } from '../services/integrations';
import type { ID, Localized, Role, User } from '../types';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

export const AD_DOMAIN = 'XALQ';
export const AD_BASE_DN = 'OU=XB-ERP,DC=xalq,DC=local';

export interface AdAccount {
  /** sAMAccountName (совпадает с логином XB-ERP). */
  sam: string;
  displayName: string;
  mail: string;
  /** Код подразделения (атрибут department). */
  department: string;
  title: string;
  /** memberOf (CN групп), первая сопоставленная группа задаёт основную роль. */
  groups: string[];
  enabled: boolean;
  whenChanged: string;
}

export interface AdGroupMapping {
  group: string;
  /** null — группа не даёт роли в XB-ERP. */
  role: Role | null;
}

export type AdDiffKind = 'new' | 'changed' | 'disabled';
export interface AdDiffRow {
  key: string;
  kind: AdDiffKind;
  sam: string;
  userId?: ID;
  displayName: string;
  changes: { field: string; from: string; to: string }[];
  /** Проблема, из-за которой строку нельзя применить (нет сопоставленной роли и т.п.). */
  issue?: 'no_role' | 'no_department';
}
export interface AdSyncPreview {
  id: string;
  at: string;
  exchangeId: string;
  accounts: number;
  rows: AdDiffRow[];
  unchanged: number;
}
export interface AdSyncResult {
  key: string;
  ok: boolean;
  error?: string;
}
export interface AdSyncRun {
  id: string;
  at: string;
  userId: ID;
  applied: number;
  failed: number;
  results: AdSyncResult[];
}

// ---------- Имитация каталога ----------

const ROLE_GROUP: Record<Role, string> = {
  employee: 'XB-ERP-Employees', data_entry: 'XB-ERP-DataEntry', approver: 'XB-ERP-Approvers', dept_head: 'XB-ERP-DeptHeads',
  procurement: 'XB-ERP-Procurement', finance: 'XB-ERP-Finance', legal: 'XB-ERP-Legal', accountant: 'XB-ERP-Accounting',
  treasury: 'XB-ERP-Treasury', analyst: 'XB-ERP-Analysts', cash_operator: 'XB-ERP-CashOperators', hr: 'XB-ERP-HR',
  storekeeper: 'XB-ERP-Warehouse', driver: 'XB-ERP-Drivers', archivist: 'XB-ERP-Archive', tax_officer: 'XB-ERP-Tax',
  support: 'XB-ERP-Support', auditor: 'XB-ERP-Audit', admin: 'XB-ERP-Admins',
};

let accounts: AdAccount[] | null = null;
let mapping: AdGroupMapping[] = [];
const credentials = new Map<string, string>();
let nonceSeq = 0;
const previews: AdSyncPreview[] = [];
const runs: AdSyncRun[] = [];

function defaultMapping(): AdGroupMapping[] {
  return [...ROLES.map((r) => ({ group: ROLE_GROUP[r], role: r as Role | null })), { group: 'Domain Users', role: null }, { group: 'VPN-Users', role: null }];
}

/** Каталог AD — отдельная система: заполняется один раз (демо-учётные записи банка) и дальше живёт своей жизнью. */
function dir(): AdAccount[] {
  if (accounts) return accounts;
  const deptCode = (id: ID) => directory.department(id)?.code ?? '';
  const t = '2026-10-01T08:00:00Z';
  const list: AdAccount[] = getUsersRef()
    .filter((u) => u.login)
    .map((u) => ({
      sam: u.login!,
      displayName: u.fullName,
      mail: u.email,
      department: deptCode(u.departmentId),
      title: u.position.ru,
      groups: [ROLE_GROUP[u.role], ...(u.extraRoles ?? []).map((r) => ROLE_GROUP[r]), 'Domain Users'],
      enabled: u.active !== false,
      whenChanged: t,
    }));
  const upd = (sam: string, f: (a: AdAccount) => void) => {
    const a = list.find((x) => x.sam === sam);
    if (a) f(a);
  };
  // Изменения в каталоге после последней синхронизации (демо):
  upd('sh.normatova', (a) => { a.displayName = 'Норматова-Алиева Шахноза'; a.mail = 'sh.normatova-alieva@example.uz'; a.whenChanged = '2026-10-16T10:12:00Z'; });
  upd('g.ismoilova', (a) => { a.groups = ['XB-ERP-Analysts', 'XB-ERP-Finance', 'Domain Users']; a.whenChanged = '2026-10-15T07:40:00Z'; });
  upd('f.abdullaev', (a) => { a.enabled = false; a.whenChanged = '2026-10-17T14:05:00Z'; });
  list.push(
    { sam: 'm.nazarova', displayName: 'Назарова Мадина', mail: 'm.nazarova@example.uz', department: 'IT', title: 'Ведущий специалист', groups: ['XB-ERP-Employees', 'Domain Users', 'VPN-Users'], enabled: true, whenChanged: '2026-10-17T09:00:00Z' },
    { sam: 'k.ergashev', displayName: 'Эргашев Комил', mail: 'k.ergashev@example.uz', department: 'TRS', title: 'Специалист казначейства', groups: ['XB-ERP-Treasury', 'Domain Users'], enabled: true, whenChanged: '2026-10-17T11:30:00Z' },
    { sam: 'j.qodirov', displayName: 'Кодиров Жахонгир', mail: 'j.qodirov@example.uz', department: 'IT', title: 'Стажёр', groups: ['Domain Users'], enabled: true, whenChanged: '2026-10-17T12:00:00Z' },
  );
  accounts = list;
  return list;
}

function findAccount(raw: string): AdAccount | undefined {
  const s = raw.trim().toLowerCase();
  const sam = s.includes('\\') ? s.split('\\').pop()! : s.includes('@') ? s.split('@')[0]! : s;
  return dir().find((a) => a.sam.toLowerCase() === sam);
}

/** Нормализация доменного логина: XALQ\login, login@xalq.local или login → sAMAccountName. */
export function adSamOf(raw: string): string {
  const s = raw.trim();
  return s.includes('\\') ? s.split('\\').pop()! : s.includes('@') ? s.split('@')[0]! : s;
}

// Регистрация системы в интеграционной шине (появляется в мониторе интеграций).
if (!INTEGRATION_SYSTEMS.some((s) => s.id === 'ad')) {
  INTEGRATION_SYSTEMS.push({
    id: 'ad', tz: 'PR-GEN-018', kind: 'internal', hosts: 'dc01.xalq.local, dc02.xalq.local (LDAPS 636)',
    name: L('Active Directory (LDAP)', 'Active Directory (LDAP)', 'Active Directory (LDAP)'),
    purpose: L('Корпоративный каталог: доменный вход, учётные записи и группы для синхронизации пользователей и ролей', 'Korporativ katalog: domen orqali kirish, foydalanuvchi va rollarni sinxronlash uchun hisob yozuvlari va guruhlar', 'Corporate directory: domain sign-in, accounts and groups for user and role sync'),
    modules: ['users', 'core'], latency: [80, 260],
    passport: {
      source: 'XB-ERP', target: 'Active Directory', owner: L('Департамент ИТ (служба каталога)', 'AT departamenti (katalog xizmati)', 'IT Department (directory service)'),
      protocol: 'REST/JSON', format: 'LDAP v3 (LDAPS), UTF-8', endpoint: 'ldaps://dc01.xalq.local:636', auth: 'Сервисная учётная запись svc-xberp-ldap (bind), TLS 1.2+',
      schedule: L('Вход — онлайн; синхронизация — по запуску администратора', 'Kirish — onlayn; sinxronlash — administrator ishga tushirganda', 'Sign-in online; sync on administrator run'),
      volume: L('до 3 000 входов/сутки', 'kuniga 3 000 tagacha kirish', 'up to 3,000 sign-ins/day'), sla: '99.9%, ≤ 1 s', idempotency: '—',
      errorCodes: 'invalidCredentials (49), accountDisabled (533), noSuchObject (32), timeout', controlTotals: L('Количество учётных записей OU', 'OU hisob yozuvlari soni', 'Number of OU accounts'),
    },
    operations: [
      {
        id: 'ldap.bind', direction: 'out', schemaVersion: '3', name: L('Проверка пароля (bind)', 'Parolni tekshirish (bind)', 'Password check (bind)'),
        sample: () => ({ upn: 'b.azizov@xalq.local', nonce: 'demo' }),
        validate: (p) => (typeof p.upn === 'string' && p.upn ? null : { code: 'validation', message: 'upn required' }),
        respond: (p) => {
          const a = findAccount(String(p.upn));
          const pwd = credentials.get(String(p.nonce));
          credentials.delete(String(p.nonce));
          if (!a) return { result: 'noSuchObject', code: 32 };
          if (!a.enabled) return { result: 'accountDisabled', code: 533 };
          if (pwd !== DEMO_PASSWORD) return { result: 'invalidCredentials', code: 49 };
          return { result: 'success', code: 0, dn: `CN=${a.displayName},${AD_BASE_DN}`, memberOf: a.groups };
        },
      },
      {
        id: 'users.delta', direction: 'in', schemaVersion: '3', name: L('Выгрузка учётных записей OU', 'OU hisob yozuvlarini yuklash', 'Export OU accounts'),
        sample: () => ({ baseDn: AD_BASE_DN, filter: '(objectClass=user)' }),
        validate: (p) => (p.baseDn ? null : { code: 'validation', message: 'baseDn required' }),
        respond: () => ({ accounts: clone(dir()) }),
        count: () => dir().length,
      },
    ],
  });
}

// ---------- Вычисление различий ----------

function rolesOf(a: AdAccount): Role[] {
  const out: Role[] = [];
  for (const g of a.groups) {
    const r = mapping.find((m) => m.group.toLowerCase() === g.toLowerCase())?.role;
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

function departmentIdOf(code: string): ID | undefined {
  return directory.departments().find((d) => d.code === code)?.id;
}

function diffRows(list: AdAccount[]): { rows: AdDiffRow[]; unchanged: number } {
  const users = getUsersRef();
  const rows: AdDiffRow[] = [];
  let unchanged = 0;
  for (const a of list) {
    const u = users.find((x) => x.login?.toLowerCase() === a.sam.toLowerCase());
    const roles = rolesOf(a);
    if (!u) {
      if (!a.enabled) continue;
      const dep = departmentIdOf(a.department);
      rows.push({
        key: `new:${a.sam}`, kind: 'new', sam: a.sam, displayName: a.displayName,
        changes: [
          { field: 'fullName', from: '—', to: a.displayName },
          { field: 'email', from: '—', to: a.mail },
          { field: 'role', from: '—', to: roles[0] ?? '—' },
          ...(roles.length > 1 ? [{ field: 'extraRoles', from: '—', to: roles.slice(1).join(', ') }] : []),
          { field: 'departmentId', from: '—', to: a.department },
        ],
        ...(!roles.length ? { issue: 'no_role' as const } : !dep ? { issue: 'no_department' as const } : {}),
      });
      continue;
    }
    if (!a.enabled) {
      if (u.active !== false) rows.push({ key: `disabled:${a.sam}`, kind: 'disabled', sam: a.sam, userId: u.id, displayName: u.fullName, changes: [{ field: 'active', from: 'true', to: 'false' }] });
      else unchanged++;
      continue;
    }
    const changes: AdDiffRow['changes'] = [];
    if (u.fullName !== a.displayName) changes.push({ field: 'fullName', from: u.fullName, to: a.displayName });
    if (u.email !== a.mail) changes.push({ field: 'email', from: u.email, to: a.mail });
    if (roles.length && roles[0] !== u.role) changes.push({ field: 'role', from: u.role, to: roles[0]! });
    const extra = roles.slice(1).sort().join(', ');
    const cur = [...(u.extraRoles ?? [])].sort().join(', ');
    if (roles.length && extra !== cur) changes.push({ field: 'extraRoles', from: cur || '—', to: extra || '—' });
    const dep = departmentIdOf(a.department);
    if (dep && dep !== u.departmentId) changes.push({ field: 'departmentId', from: directory.department(u.departmentId)?.code ?? u.departmentId, to: a.department });
    if (u.active === false) changes.push({ field: 'active', from: 'false', to: 'true' });
    if (changes.length) rows.push({ key: `changed:${a.sam}`, kind: 'changed', sam: a.sam, userId: u.id, displayName: u.fullName, changes, ...(!roles.length ? { issue: 'no_role' as const } : {}) });
    else unchanged++;
  }
  const order: Record<AdDiffKind, number> = { new: 0, changed: 1, disabled: 2 };
  rows.sort((x, y) => order[x.kind] - order[y.kind] || x.sam.localeCompare(y.sam));
  return { rows, unchanged };
}

function actorOf(userId: ID): User | undefined {
  return getUsersRef().find((u) => u.id === userId);
}

export const adApi = {
  domain: AD_DOMAIN,

  /** Вход доменной учётной записью: bind в AD → те же проверки и второй фактор, что у пароля банка. */
  async authenticate(login: string, password: string): Promise<{ challengeId: string; demoCode: string; phoneMask: string; userName: string }> {
    const sam = adSamOf(login);
    return securityApi.authenticateExternal(
      sam,
      async () => {
        const nonce = `n${++nonceSeq}-${Date.now()}`;
        credentials.set(nonce, password);
        const rec = await integrationHub.call('ad', 'ldap.bind', { upn: `${sam}@xalq.local`, nonce }, { mode: 'sync' });
        const r = String(rec.response?.result ?? '');
        return r === 'success' ? 'ok' : r === 'accountDisabled' ? 'disabled' : 'invalid';
      },
      'AD/LDAP',
    );
  },

  isUnavailable(e: unknown): boolean {
    return e instanceof IntegrationUnavailableError;
  },

  getMapping(): Promise<AdGroupMapping[]> {
    if (!mapping.length) mapping = defaultMapping();
    return delay(mapping);
  },

  /** Группы, встречающиеся в каталоге (для добавления сопоставлений). */
  async listGroups(): Promise<{ group: string; members: number }[]> {
    const m = new Map<string, number>();
    for (const a of dir()) for (const g of a.groups) m.set(g, (m.get(g) ?? 0) + 1);
    return delay([...m.entries()].map(([group, members]) => ({ group, members })).sort((a, b) => a.group.localeCompare(b.group)));
  },

  /** Изменить сопоставление «группа AD → роль» (в UI — с подтверждением кодом 2FA). */
  async setMapping(group: string, role: Role | null, userId: ID): Promise<void> {
    if (!mapping.length) mapping = defaultMapping();
    const g = group.trim();
    if (!g) throw new Error('group required');
    const cur = mapping.find((m) => m.group.toLowerCase() === g.toLowerCase());
    const from = cur ? cur.role ?? '—' : '(new)';
    if (cur) cur.role = role;
    else mapping.push({ group: g, role });
    const u = actorOf(userId);
    audit.log({ action: 'access_change', entity: 'ad_mapping', entityId: g, entityLabel: g, changes: [{ field: 'role', from, to: role ?? '—' }], ...(u ? { user: { id: u.id, fullName: u.fullName, role: u.role } } : {}) });
    emit();
    await delay(null);
  },

  /** Предпросмотр синхронизации: выгрузка OU из AD через шину и сравнение с учётными записями XB-ERP. */
  async previewSync(userId: ID): Promise<AdSyncPreview> {
    if (!mapping.length) mapping = defaultMapping();
    const rec = await integrationHub.call('ad', 'users.delta', { baseDn: AD_BASE_DN, filter: '(objectClass=user)' }, { userId, mode: 'sync' });
    const list = (rec.response?.accounts ?? []) as AdAccount[];
    const { rows, unchanged } = diffRows(list);
    const p: AdSyncPreview = { id: `adp${previews.length + 1}`, at: new Date().toISOString(), exchangeId: rec.id, accounts: list.length, rows, unchanged };
    previews.push(p);
    return delay(p);
  },

  /** Применить выбранные строки предпросмотра: создать, изменить, деактивировать учётные записи (с аудитом). */
  async applySync(previewId: string, keys: string[], userId: ID): Promise<AdSyncRun> {
    const p = previews.find((x) => x.id === previewId);
    if (!p) throw new Error('preview not found');
    const positions = await securityApi.listPositions();
    const results: AdSyncResult[] = [];
    const users = getUsersRef();
    for (const row of p.rows.filter((r) => keys.includes(r.key))) {
      const a = dir().find((x) => x.sam === row.sam);
      try {
        if (!a) throw new Error('account not found');
        if (row.issue) throw new Error(row.issue);
        const roles = rolesOf(a);
        if (row.kind === 'disabled') {
          await securityApi.setUserActive(row.userId!, false);
        } else if (row.kind === 'new') {
          const role = roles[0]!;
          await securityApi.saveUser({ fullName: a.displayName, login: a.sam, email: a.mail, positionId: positions.find((x) => x.defaultRole === role)?.id ?? positions[0]!.id, role, extraRoles: roles.slice(1), departmentId: departmentIdOf(a.department)! });
        } else {
          const u = users.find((x) => x.id === row.userId)!;
          await securityApi.saveUser({
            id: u.id, fullName: a.displayName, login: u.login ?? a.sam, email: a.mail, ...(u.phone ? { phone: u.phone } : {}), positionId: u.positionId ?? positions[0]!.id,
            role: roles[0] ?? u.role, extraRoles: roles.length ? roles.slice(1) : u.extraRoles ?? [], departmentId: departmentIdOf(a.department) ?? u.departmentId,
            ...(u.orgUnitKey ? { orgUnitKey: u.orgUnitKey } : {}), ...(u.costCenterKey ? { costCenterKey: u.costCenterKey } : {}),
          });
          if (u.active === false) await securityApi.setUserActive(u.id, true);
        }
        results.push({ key: row.key, ok: true });
      } catch (e) {
        results.push({ key: row.key, ok: false, error: e instanceof Error ? (e as Error & { issues?: Record<string, string> }).issues ? Object.values((e as Error & { issues: Record<string, string> }).issues).join('; ') : e.message : String(e) });
      }
    }
    const run: AdSyncRun = { id: `ads${runs.length + 1}`, at: new Date().toISOString(), userId, applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
    runs.unshift(run);
    const u = actorOf(userId);
    audit.log({ action: 'update', entity: 'ad_sync', entityId: run.id, entityLabel: `${AD_DOMAIN} · ${AD_BASE_DN}`, details: `applied ${run.applied}, failed ${run.failed}: ${results.map((r) => `${r.key}${r.ok ? '' : ' ✗'}`).join(', ')}`, ...(u ? { user: { id: u.id, fullName: u.fullName, role: u.role } } : {}) });
    // применённые строки исчезают из предпросмотра
    p.rows = p.rows.filter((r) => !results.some((x) => x.key === r.key && x.ok));
    emit();
    return delay(run);
  },

  listRuns(): Promise<AdSyncRun[]> {
    return delay(runs);
  },

  /** Демо: состояние учётной записи в каталоге (для проверки входа отключённой записью). */
  directorySize(): number {
    return dir().length;
  },

  /** Учётные записи XB-ERP, отсутствующие в каталоге AD (для контроля). */
  notInDirectory(): Promise<User[]> {
    const sams = new Set(dir().map((a) => a.sam.toLowerCase()));
    return delay(getUsersRef().filter((u) => u.login && !sams.has(u.login.toLowerCase())));
  },
};

