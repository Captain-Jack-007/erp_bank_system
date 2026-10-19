// P3-GEN: управление учётными записями по кадровым событиям и периодический пересмотр прав.
//   hrSyncApi        — события HR-источника (Laborlaw): приём, перевод, отпуск, выход из отпуска, увольнение →
//                      автоматическое создание / изменение / временное ограничение / блокировка учётной записи
//                      (ТЗ PR-SEC-002, PR-SEC-056). Получение — через интеграционную шину (журнал обмена).
//   accessReviewApi  — фиксация результата ежемесячного пересмотра пользователей, ролей и конфликтов SoD
//                      с участием представителя Службы ИБ (ТЗ PR-SEC-035, PR-SEC-056).
import { audit } from './audit';
import { clone, delay, emit } from './bus';
import { notify } from './notifications';
import { getUsersRef, securityApi, ValidationError } from './security';
import { integrationHub } from './services/integrations';
import type { ID, Localized, Role, User } from './types';
import { apiError } from './errors';

export type HrEventKind = 'hire' | 'transfer' | 'leave' | 'return' | 'dismissal';
export type HrEventStatus = 'applied' | 'error';

export interface HrEvent {
  id: ID;
  kind: HrEventKind;
  /** Табельный номер в HR-системе. */
  employeeNo: string;
  fullName: string;
  userId?: ID;
  positionId?: ID;
  departmentId?: ID;
  orgUnitKey?: string;
  /** Отпуск: с / по (YYYY-MM-DD). */
  from?: string;
  to?: string;
  effectiveDate: string;
  receivedAt: string;
  exchangeId?: ID;
  status: HrEventStatus;
  appliedAt?: string;
  /** Итог обработки (на языке интерфейса нет — нейтральная строка с ключевыми значениями). */
  result?: string;
  /** Итог для экрана (переводится на языке интерфейса). */
  outcome?: { kind: 'created' | 'changed' | 'suspended' | 'restored' | 'deactivated'; login?: string; fromRoles?: Role[]; toRole?: Role; until?: string };
  error?: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

/** События, ещё не полученные из Laborlaw (поступят при следующем обмене). */
let remote: Omit<HrEvent, 'receivedAt' | 'status'>[] = [];
let events: HrEvent[] = [];
let seq = 0;

function seedRemote(): void {
  const today = iso(new Date());
  remote = [
    { id: 'hr1', kind: 'hire', employeeNo: 'T-10482', fullName: 'Эргашева Мадина', positionId: 'p11', departmentId: 'd3', orgUnitKey: 'd3', effectiveDate: today },
    { id: 'hr2', kind: 'transfer', employeeNo: 'T-07731', fullName: 'Норматова Шахноза', userId: 'u9', positionId: 'p11', departmentId: 'd3', orgUnitKey: 'd3', effectiveDate: today },
    { id: 'hr3', kind: 'leave', employeeNo: 'T-03305', fullName: 'Ташкентов Шерзод', userId: 'u5', from: today, to: addDays(14), effectiveDate: today },
    { id: 'hr4', kind: 'dismissal', employeeNo: 'T-02218', fullName: 'Ергашев Сардор', userId: 'u8', effectiveDate: today },
    { id: 'hr5', kind: 'dismissal', employeeNo: 'T-05190', fullName: 'Абдуллаев Фаррух', userId: 'u10', effectiveDate: today },
  ];
  seq = remote.length;
}
seedRemote();

const LAT: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', қ: 'q', ғ: 'g', ҳ: 'h', ў: 'o' };
const latin = (s: string) => s.toLowerCase().split('').map((c) => LAT[c] ?? c).join('').replace(/[^a-z]/g, '');

/** Логин по ФИО: «и.фамилия», при совпадении — с цифрой. */
function makeLogin(fullName: string, users: User[]): string {
  const [last = 'user', first = 'x'] = fullName.trim().split(/\s+/);
  const baseLogin = `${latin(first).slice(0, 1) || 'x'}.${latin(last) || 'user'}`;
  let login = baseLogin;
  for (let i = 2; users.some((u) => u.login === login); i++) login = `${baseLogin}${i}`;
  return login;
}

async function apply(e: HrEvent): Promise<void> {
  const users = getUsersRef();
  const positions = await securityApi.listPositions();
  const tag = `HR ${e.kind} · ${e.employeeNo}`;
  try {
    if (e.kind === 'hire') {
      const pos = positions.find((p) => p.id === e.positionId);
      if (!pos) throw apiError('POSITION_NOT_FOUND');
      const login = makeLogin(e.fullName, users);
      const u = await securityApi.saveUser({ fullName: e.fullName, login, email: `${login}@example.uz`, positionId: pos.id, role: pos.defaultRole, extraRoles: [], departmentId: e.departmentId ?? 'd1', ...(e.orgUnitKey ? { orgUnitKey: e.orgUnitKey } : {}) });
      await securityApi.requirePasswordChange(u.id);
      e.userId = u.id;
      e.result = `+ ${login} · role=${pos.defaultRole} · ${pos.code}`;
      e.outcome = { kind: 'created', login, toRole: pos.defaultRole };
    } else {
      const u = users.find((x) => x.id === e.userId);
      if (!u) throw apiError('EMPLOYEE_ACCOUNT_NOT_FOUND');
      if (e.kind === 'transfer') {
        const pos = positions.find((p) => p.id === e.positionId);
        if (!pos) throw apiError('POSITION_NOT_FOUND');
        const fromRoles = [u.role, ...(u.extraRoles ?? [])];
        const prevRoles = fromRoles.join(', ');
        await securityApi.saveUser({
          id: u.id, fullName: u.fullName, login: u.login ?? '', email: u.email, ...(u.phone ? { phone: u.phone } : {}),
          positionId: pos.id, role: pos.defaultRole, extraRoles: [], departmentId: e.departmentId ?? u.departmentId, ...(e.orgUnitKey ? { orgUnitKey: e.orgUnitKey } : {}),
        });
        e.result = `${prevRoles} → ${pos.defaultRole} · ${pos.code}`;
        e.outcome = { kind: 'changed', fromRoles, toRole: pos.defaultRole };
      } else if (e.kind === 'leave') {
        await securityApi.setSuspension(u.id, e.to!, `${tag} · ${e.from}…${e.to}`);
        e.result = `≤ ${e.to}`;
        e.outcome = { kind: 'suspended', until: e.to! };
      } else if (e.kind === 'return') {
        await securityApi.setSuspension(u.id, null, tag);
        e.result = 'restored';
        e.outcome = { kind: 'restored' };
      } else {
        await securityApi.setUserActive(u.id, false);
        e.result = 'deactivated';
        e.outcome = { kind: 'deactivated' };
      }
    }
    e.status = 'applied';
    e.appliedAt = new Date().toISOString();
    delete e.error;
    audit.log({ action: 'update', entity: 'hr_event', entityId: e.id, entityLabel: `${e.fullName} · ${e.kind}`, details: `${tag} → ${e.result}` });
  } catch (err) {
    e.status = 'error';
    e.error = err instanceof ValidationError ? Object.values(err.issues).join('; ') : err instanceof Error ? err.message : String(err);
    audit.log({ action: 'update', entity: 'hr_event', entityId: e.id, entityLabel: `${e.fullName} · ${e.kind}`, details: `${tag} → error: ${e.error}`, result: 'failure' });
    notify({
      roles: ['admin', 'hr'],
      title: { ru: 'Кадровое событие не применено', uz: 'Kadrlar voqeasi qo‘llanilmadi', en: 'HR event not applied' } as Localized,
      body: `${e.fullName}: ${e.error}`,
      link: '/settings/users?tab=hr',
      level: 'warning',
      kind: 'system',
      dedupeKey: `hr-${e.id}-${e.error}`,
    });
  }
}

export const hrSyncApi = {
  list: (): Promise<HrEvent[]> => delay(events.slice().reverse()),
  pendingCount: (): number => remote.length,
  /** Получить события из Laborlaw (интеграционная шина) и автоматически применить их к учётным записям. */
  async sync(userId?: ID): Promise<{ received: number; applied: number; errors: number; exchangeId?: ID }> {
    const since = events.length ? events[events.length - 1]!.receivedAt : `${iso(new Date())}T00:00:00+05:00`;
    const rec = await integrationHub.call('laborlaw', 'hr.events', { since, count: remote.length }, { ...(userId ? { userId } : {}), mode: 'async' });
    if (rec.status !== 'success') {
      emit();
      return { received: 0, applied: 0, errors: 0, exchangeId: rec.id };
    }
    const batch = remote.map<HrEvent>((r) => ({ ...r, receivedAt: new Date().toISOString(), exchangeId: rec.id, status: 'error' }));
    remote = [];
    for (const e of batch) {
      events.push(e);
      await apply(e);
    }
    emit();
    return { received: batch.length, applied: batch.filter((e) => e.status === 'applied').length, errors: batch.filter((e) => e.status === 'error').length, exchangeId: rec.id };
  },
  /** Повторно применить событие после устранения причины (например, передачи ценностей другому МОЛ). */
  async retry(id: ID): Promise<HrEvent> {
    const e = events.find((x) => x.id === id);
    if (!e) throw new Error('HR event not found');
    await apply(e);
    emit();
    return delay(e);
  },
  /** Демо: поставить в HR-систему событие «выход из отпуска» для сотрудника. */
  queueReturn(userId: ID): void {
    const u = getUsersRef().find((x) => x.id === userId);
    if (!u) return;
    remote.push({ id: `hr${++seq}`, kind: 'return', employeeNo: `T-${String(10000 + Number(userId.replace(/\D/g, '')) * 37).slice(-5)}`, fullName: u.fullName, userId, effectiveDate: iso(new Date()) });
    emit();
  },
  /** Только для сброса демо-данных. */
  reset(): void {
    events = [];
    seedRemote();
  },
};

// ---------- Пересмотр прав (access review) ----------

export interface AccessReviewRecord {
  id: ID;
  at: string;
  reviewerId: ID;
  reviewerName: string;
  /** Представитель Службы обеспечения ИБ и КБ — второе лицо, обязательно отличается от проводящего. */
  securityOfficerId: ID;
  securityOfficerName: string;
  users: number;
  privileged: number;
  sod: number;
  inactiveWithAccess: number;
  unused: number;
  revoked: number;
  comment: string;
}

export const ACCESS_REVIEW_PERIOD_DAYS = 30;
let reviews: AccessReviewRecord[] = [];
let revokedSinceLast = 0;

function seedReviews(): void {
  const at = new Date(Date.now() - 34 * 86_400_000).toISOString();
  reviews = [{ id: 'ar1', at, reviewerId: 'u6', reviewerName: 'Мирзаев Отабек', securityOfficerId: 'u19', securityOfficerName: 'Рашидова Зарина', users: 20, privileged: 1, sod: 2, inactiveWithAccess: 1, unused: 2, revoked: 1, comment: 'Ежемесячный пересмотр: отозваны права уволенного сотрудника (демо).' }];
  revokedSinceLast = 0;
}
seedReviews();

export const accessReviewApi = {
  list: (): Promise<AccessReviewRecord[]> => delay(reviews.slice().reverse()),
  /** Дата следующего обязательного пересмотра и признак просрочки. */
  due(): { last?: string; nextDue: string; overdue: boolean } {
    const last = reviews[reviews.length - 1]?.at;
    const next = new Date((last ? new Date(last).getTime() : Date.now()) + ACCESS_REVIEW_PERIOD_DAYS * 86_400_000);
    return { ...(last ? { last } : {}), nextDue: next.toISOString(), overdue: next.getTime() < Date.now() };
  },
  noteRevoked(): void {
    revokedSinceLast++;
  },
  /** Зафиксировать результат пересмотра (снимок показателей + второе лицо от Службы ИБ). */
  async sign(input: { securityOfficerId: ID; comment: string; stats: Pick<AccessReviewRecord, 'users' | 'privileged' | 'sod' | 'inactiveWithAccess' | 'unused'> }): Promise<AccessReviewRecord> {
    const a = audit.getActor();
    const issues: Record<string, string> = {};
    if (!input.securityOfficerId) issues.securityOfficerId = 'formRequired';
    else if (a && input.securityOfficerId === a.id) issues.securityOfficerId = 'review_err_same_person';
    if (!input.comment.trim()) issues.comment = 'formRequired';
    if (Object.keys(issues).length) throw new ValidationError(issues);
    const so = getUsersRef().find((u) => u.id === input.securityOfficerId);
    const rec: AccessReviewRecord = {
      id: `ar${reviews.length + 1}`, at: new Date().toISOString(), reviewerId: a?.id ?? 'system', reviewerName: a?.fullName ?? '—',
      securityOfficerId: input.securityOfficerId, securityOfficerName: so?.fullName ?? input.securityOfficerId, ...input.stats, revoked: revokedSinceLast, comment: input.comment.trim(),
    };
    reviews.push(rec);
    revokedSinceLast = 0;
    audit.log({ action: 'approve', entity: 'access_review', entityId: rec.id, entityLabel: `${rec.reviewerName} + ${rec.securityOfficerName}`, details: `users ${rec.users} · SoD ${rec.sod} · privileged ${rec.privileged} · inactive ${rec.inactiveWithAccess} · revoked ${rec.revoked}` });
    emit();
    return delay(clone(rec));
  },
  reset(): void {
    seedReviews();
  },
};
