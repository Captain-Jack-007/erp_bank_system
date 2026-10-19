// P4-SEC (PR-SEC-049): минимизация персональных данных и обезличивание по истечении срока хранения.
//
// • Реестр ПДн: какие объекты и поля содержат ПДн, цель обработки, правовое основание, срок хранения и событие,
//   от которого он исчисляется. Срок меняет администратор (с 2FA), изменение пишется в журнал.
// • Поиск записей с истёкшим сроком — расчётом из данных источников (уволенные сотрудники — дата деактивации
//   по журналу; контрагенты-физлица — окончание последнего договора; журнал пропусков — дата визита).
// • Обезличивание — заявка (администратор / HR, 2FA) → согласование юристом в движке согласований (другое лицо, 2FA)
//   → замена ПДн обезличенными значениями; каждое действие и каждая запись — в журнале аудита (без самих значений).
// • Маскирование при показе: maskPd() для ролей без права «Просмотр ПДн» (раздел pd_full матрицы прав).
// В продуктиве — серверная процедура по утверждённому регламенту, обезличивание в БД и резервных копиях.
import { audit } from './audit';
import { clone, delay, emit, now } from './bus';
import { approvalEngine } from './engine';
import { apiError } from './errors';
import { can, consumeStepUp, getUsersRef, registerModuleAccess } from './security';
import { coreTables } from './api/procStore';
import type { HistoryEvent, ID, Localized, User } from './types';

// Раздел «Персональные данные»: администратор и HR — ведение и заявки; юрист — утверждение; аудитор — просмотр.
registerModuleAccess('privacy', { hr: 'edit', legal: 'approve', auditor: 'view' });
// Право видеть ПДн без маскирования (паспорт, ПИНФЛ, телефон, e-mail): HR, юрист (и администратор).
registerModuleAccess('pd_full', { hr: 'view', legal: 'view' });

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

export type PdFieldKind = 'name' | 'passport' | 'pinfl' | 'phone' | 'email' | 'address' | 'tin' | 'account' | 'login';
export type PdCategory = 'employees' | 'counterparties' | 'visitors';

export interface PdField {
  key: string;
  kind: PdFieldKind;
  label: Localized;
}

export interface PdRegisterEntry {
  id: PdCategory;
  name: Localized;
  source: Localized;
  /** Маршрут экрана-источника. */
  link: string;
  fields: PdField[];
  purpose: Localized;
  legalBasis: Localized;
  retentionMonths: number;
  trigger: Localized;
}

export interface PdRecord {
  key: string;
  category: PdCategory;
  id: ID;
  label: string;
  /** Дата события, от которого исчисляется срок (YYYY-MM-DD) или null — срок не начался (действующие отношения). */
  since: string | null;
  dueDate: string | null;
  due: boolean;
  anonymized: boolean;
  values: Record<string, string>;
}

export type PdRequestStatus = 'pending' | 'executed' | 'rejected' | 'failed';
export interface PdRequest {
  id: ID;
  number: string;
  status: PdRequestStatus;
  keys: string[];
  labels: string[];
  regulation: string;
  initiatorId: ID;
  createdAt: string;
  approverId?: ID;
  decidedAt?: string;
  done?: number;
  failure?: string;
  history: HistoryEvent[];
}

export interface PdVisitor {
  id: ID;
  fullName: string;
  passport: string;
  pinfl: string;
  phone: string;
  visitDate: string;
  hostId: ID;
  purpose: string;
  anonymized?: boolean;
}

const F = (key: string, kind: PdFieldKind, ru: string, uz: string, en: string): PdField => ({ key, kind, label: L(ru, uz, en) });

const REGISTER_SEED: PdRegisterEntry[] = [
  {
    id: 'employees',
    name: L('Учётные записи уволенных сотрудников', 'Ishdan bo‘shagan xodimlarning hisob qaydnomalari', 'Accounts of dismissed employees'),
    source: L('Пользователи и доступ', 'Foydalanuvchilar va kirish', 'Users and access'),
    link: '/settings/users',
    fields: [F('fullName', 'name', 'ФИО', 'F.I.Sh.', 'Full name'), F('email', 'email', 'E-mail', 'E-mail', 'E-mail'), F('phone', 'phone', 'Телефон', 'Telefon', 'Phone'), F('login', 'login', 'Логин', 'Login', 'Login')],
    purpose: L('Управление доступом, расследование инцидентов ИБ', 'Kirishni boshqarish, axborot xavfsizligi hodisalarini tekshirish', 'Access management, security incident investigation'),
    legalBasis: L('Трудовой договор; Закон РУз «О персональных данных», ст. 25', 'Mehnat shartnomasi; «Shaxsga doir ma’lumotlar to‘g‘risida»gi Qonun, 25-modda', 'Employment contract; Law on Personal Data, art. 25'),
    retentionMonths: 60,
    trigger: L('Дата увольнения (деактивации учётной записи)', 'Ishdan bo‘shash (hisobni o‘chirish) sanasi', 'Dismissal (account deactivation) date'),
  },
  {
    id: 'counterparties',
    name: L('Контрагенты — физические лица и ИП', 'Kontragentlar — jismoniy shaxslar va YaTT', 'Counterparties — individuals and sole traders'),
    source: L('Справочник контрагентов', 'Kontragentlar ma’lumotnomasi', 'Counterparty directory'),
    link: '/master-data',
    fields: [F('name', 'name', 'ФИО / наименование', 'F.I.Sh. / nomi', 'Name'), F('tin', 'tin', 'ИНН / ПИНФЛ', 'STIR / JShShIR', 'TIN / PINFL'), F('phone', 'phone', 'Телефон', 'Telefon', 'Phone'), F('address', 'address', 'Адрес', 'Manzil', 'Address'), F('bankAccount', 'account', 'Счёт', 'Hisob raqami', 'Bank account')],
    purpose: L('Заключение и исполнение договоров, налоговый учёт', 'Shartnomalarni tuzish va bajarish, soliq hisobi', 'Conclusion and performance of contracts, tax accounting'),
    legalBasis: L('Договор; Налоговый кодекс (хранение 5 лет)', 'Shartnoma; Soliq kodeksi (5 yil saqlash)', 'Contract; Tax Code (5-year retention)'),
    retentionMonths: 60,
    trigger: L('Окончание последнего договора', 'Oxirgi shartnoma tugashi', 'End of the last contract'),
  },
  {
    id: 'visitors',
    name: L('Журнал пропусков посетителей', 'Tashrif buyuruvchilar ruxsatnomalari jurnali', 'Visitor pass log'),
    source: L('Бюро пропусков (раздел «Персональные данные»)', 'Ruxsatnomalar byurosi («Shaxsiy ma’lumotlar» bo‘limi)', 'Pass office («Personal data» section)'),
    link: '/privacy?tab=visitors',
    fields: [F('fullName', 'name', 'ФИО', 'F.I.Sh.', 'Full name'), F('passport', 'passport', 'Паспорт', 'Pasport', 'Passport'), F('pinfl', 'pinfl', 'ПИНФЛ', 'JShShIR', 'PINFL'), F('phone', 'phone', 'Телефон', 'Telefon', 'Phone')],
    purpose: L('Пропускной режим и безопасность зданий банка', 'Bank binolarining o‘tkazish rejimi va xavfsizligi', 'Access control and security of bank premises'),
    legalBasis: L('Положение о пропускном режиме; согласие субъекта', 'O‘tkazish rejimi to‘g‘risidagi nizom; subyekt roziligi', 'Access control regulation; data subject consent'),
    retentionMonths: 36,
    trigger: L('Дата визита', 'Tashrif sanasi', 'Visit date'),
  },
];

let register: PdRegisterEntry[] = clone(REGISTER_SEED);
let visitors: PdVisitor[] = [];
let requests: PdRequest[] = [];
let reqSeq = 0;
let visSeq = 0;
const anonymizedKeys = new Set<string>();

function seedVisitors(): PdVisitor[] {
  // Вымышленные посетители (данные синтетические): визиты 2021–2026
  const names = ['Тошматов Алишер', 'Расулова Мадина', 'Иргашев Бобур', 'Назарова Камола', 'Юнусов Шухрат', 'Мирзаева Лола', 'Хакимов Отабек', 'Саидова Нодира', 'Каримов Жахонгир', 'Абдуллаева Гулрух', 'Ахмедов Санжар', 'Олимова Дилноза', 'Рустамов Фарход', 'Эргашева Севара'];
  const dates = ['2021-03-15', '2021-09-02', '2022-02-21', '2022-07-11', '2023-01-30', '2023-05-18', '2023-09-04', '2024-03-12', '2024-11-25', '2025-04-08', '2025-08-19', '2026-02-03', '2026-06-22', '2026-10-06'];
  const hosts = ['u3', 'u4', 'u5', 'u2', 'u8', 'u7', 'u13'];
  const purposes = ['Переговоры по договору', 'Собеседование', 'Сдача тендерной документации', 'Аудит поставщика', 'Монтаж оборудования'];
  return names.map((n, i) => ({
    id: `vis${i + 1}`,
    fullName: n,
    passport: `A${String.fromCharCode(65 + (i % 26))}${String(1_200_000 + i * 73_911).slice(0, 7)}`,
    pinfl: `3${String(10_101_900_000_000 + i * 7_919_311).slice(0, 13)}`,
    phone: `+998 9${i % 10} ${String(100 + i * 37).slice(0, 3)}-${String(10 + i * 3).slice(-2)}-${String(20 + i * 7).slice(-2)}`,
    visitDate: dates[i]!,
    hostId: hosts[i % hosts.length]!,
    purpose: purposes[i % purposes.length]!,
  }));
}

function reset(): void {
  register = clone(REGISTER_SEED);
  visitors = seedVisitors();
  visSeq = visitors.length;
  requests = [];
  reqSeq = 0;
  anonymizedKeys.clear();
}
reset();

const today = () => new Date().toISOString().slice(0, 10);
function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
const findUser = (id: ID) => getUsersRef().find((u) => u.id === id);
const actor = (): User | undefined => {
  const a = audit.getActor();
  return a ? findUser(a.id) : undefined;
};
const entry = (c: PdCategory) => register.find((r) => r.id === c)!;

/** Дата деактивации учётной записи по журналу аудита. */
function deactivatedAt(userId: ID): string | null {
  const e = audit.query({ entity: 'user', entityId: userId, action: 'deactivate' })[0];
  return e ? e.at.slice(0, 10) : null;
}

function makeRecord(category: PdCategory, id: ID, label: string, since: string | null, values: Record<string, string>): PdRecord {
  const key = `${category}:${id}`;
  const dueDate = since ? addMonths(since, entry(category).retentionMonths) : null;
  const anonymized = anonymizedKeys.has(key);
  return { key, category, id, label, since, dueDate, due: !anonymized && !!dueDate && dueDate <= today(), anonymized, values };
}

/** Все записи с ПДн по реестру (значения — без маскирования; маскирует экран по праву пользователя). */
function allRecords(): PdRecord[] {
  const out: PdRecord[] = [];
  for (const u of getUsersRef().filter((x) => x.active === false)) {
    out.push(makeRecord('employees', u.id, u.fullName, deactivatedAt(u.id), { fullName: u.fullName, email: u.email, phone: u.phone ?? '', login: u.login ?? '' }));
  }
  let core: ReturnType<typeof coreTables> | null = null;
  try {
    core = coreTables();
  } catch {
    core = null;
  }
  if (core) {
    for (const c of core.counterparties.filter((x) => x.type === 'individual_entrepreneur')) {
      const ends = core.contracts.filter((k) => k.counterpartyId === c.id).map((k) => k.endDate).sort();
      const active = core.contracts.some((k) => k.counterpartyId === c.id && !['closed', 'terminated', 'rejected'].includes(k.status));
      const since = ends.length && !active ? ends[ends.length - 1]!.slice(0, 10) : null;
      out.push(makeRecord('counterparties', c.id, c.name, since, { name: c.name, tin: c.tin, phone: c.phone, address: c.address, bankAccount: c.bankAccount ?? '' }));
    }
  }
  for (const v of visitors) out.push(makeRecord('visitors', v.id, v.fullName, v.visitDate, { fullName: v.fullName, passport: v.passport, pinfl: v.pinfl, phone: v.phone }));
  return out;
}

// ---------- Маскирование ----------

/** Маскирование значения ПДн по виду поля (для ролей без права «Просмотр ПДн»). */
export function maskPd(value: string | undefined | null, kind: PdFieldKind): string {
  const v = (value ?? '').trim();
  if (!v || v === '—') return v || '—';
  switch (kind) {
    case 'phone': {
      const d = v.replace(/\D/g, '');
      return d.length >= 4 ? `+${d.slice(0, 3)} ** ***-**-${d.slice(-2)}` : '***';
    }
    case 'email': {
      const [name, domain] = v.split('@');
      return domain ? `${(name ?? '').slice(0, 1)}•••@${domain}` : '•••';
    }
    case 'passport':
      return v.length > 4 ? `${v.slice(0, 2)}${'*'.repeat(v.length - 4)}${v.slice(-2)}` : '****';
    case 'pinfl':
    case 'tin':
    case 'account':
      return v.length > 4 ? `${v.slice(0, 1)}${'*'.repeat(v.length - 4)}${v.slice(-3)}` : '****';
    case 'address':
      return `${v.split(/[,\s]/)[0]} …`;
    case 'login':
      return `${v.slice(0, 1)}•••`;
    case 'name': {
      const [last, ...rest] = v.split(/\s+/);
      return [last, ...rest.map((p) => `${p.slice(0, 1)}.`)].join(' ');
    }
  }
}

/** Может ли пользователь видеть ПДн без маскирования. */
export function canSeePd(user: Pick<User, 'role' | 'extraRoles' | 'active'> | null | undefined): boolean {
  return can(user, 'pd_full', 'view');
}

/** Значение для показа: полное (есть право) или маскированное. */
export function showPd(user: Pick<User, 'role' | 'extraRoles' | 'active'> | null | undefined, value: string | undefined | null, kind: PdFieldKind): string {
  return canSeePd(user) ? (value ?? '') || '—' : maskPd(value, kind);
}

// ---------- Обезличивание ----------

const ANON = (id: ID) => `Обезличено (${id})`;

function anonymize(rec: PdRecord, req: PdRequest, approver: User): void {
  const fields = entry(rec.category).fields.map((f) => f.key);
  if (rec.category === 'visitors') {
    const v = visitors.find((x) => x.id === rec.id);
    if (!v) return;
    Object.assign(v, { fullName: ANON(v.id), passport: '—', pinfl: '—', phone: '—', anonymized: true });
  } else if (rec.category === 'employees') {
    const u = getUsersRef().find((x) => x.id === rec.id);
    if (!u || u.active !== false) return;
    u.fullName = ANON(u.id);
    u.email = `anon-${u.id}@anon.invalid`;
    delete u.phone;
    u.login = `anon.${u.id}`;
  } else {
    const c = coreTables().counterparties.find((x) => x.id === rec.id);
    if (!c) return;
    Object.assign(c, { name: ANON(c.id), phone: '—', address: '—' });
    delete c.bankAccount;
  }
  anonymizedKeys.add(rec.key);
  audit.log({
    action: 'anonymize', entity: `pd_${rec.category}`, entityId: rec.id, entityLabel: ANON(rec.id),
    changes: fields.map((f) => ({ field: f, from: '***', to: 'anonymized' })),
    details: `${req.number} · retention ${entry(rec.category).retentionMonths} m since ${rec.since} · approved by ${approver.fullName}`,
  });
}

approvalEngine.register('pd_anonymize', {
  onHistory: (id, e) => {
    requests.find((x) => x.id === id)?.history.push(e);
  },
  onFinal: (id, approved) => {
    const r = requests.find((x) => x.id === id);
    if (!r || r.status !== 'pending') return;
    const a = actor();
    r.decidedAt = now();
    if (a) r.approverId = a.id;
    if (!approved) {
      r.status = 'rejected';
      audit.log({ action: 'anonymize', entity: 'pd_request', entityId: r.id, entityLabel: r.number, details: 'rejected by second person', result: 'failure' });
      return;
    }
    try {
      if (!a || a.id === r.initiatorId) throw apiError('DUAL_CONTROL_SAME_PERSON');
      if (!can(a, 'privacy', 'approve')) throw apiError('NOT_ALLOWED');
      if (!consumeStepUp(a.id)) throw apiError('STEP_UP_REQUIRED');
      const recs = allRecords().filter((x) => r.keys.includes(x.key) && x.due); // срок повторно проверяется при исполнении
      recs.forEach((rec) => anonymize(rec, r, a));
      r.done = recs.length;
      r.status = 'executed';
      r.history.push({ at: now(), userId: a.id, action: 'status_changed', comment: `anonymized ${recs.length}` });
      audit.log({ action: 'anonymize', entity: 'pd_request', entityId: r.id, entityLabel: r.number, details: `executed: ${recs.length}/${r.keys.length} records · ${r.regulation} · approved by ${a.fullName}` });
    } catch (e) {
      r.status = 'failed';
      r.failure = e instanceof Error ? e.message : String(e);
      audit.log({ action: 'anonymize', entity: 'pd_request', entityId: r.id, entityLabel: r.number, details: `execution refused: ${r.failure}`, result: 'failure' });
    }
  },
});

export const privacyApi = {
  register: (): Promise<PdRegisterEntry[]> => delay(clone(register)),
  /** Записи с ПДн (по категории); due=true — срок хранения истёк. */
  records: (category?: PdCategory): Promise<PdRecord[]> => delay(allRecords().filter((r) => !category || r.category === category)),
  requests: (): Promise<PdRequest[]> => delay(clone(requests).reverse()),
  visitors: (): Promise<PdVisitor[]> => delay(clone(visitors).sort((a, b) => b.visitDate.localeCompare(a.visitDate))),

  /** Срок хранения категории (месяцы) — администратор, после 2FA. */
  async setRetention(category: PdCategory, months: number): Promise<void> {
    const a = actor();
    if (!a || !can(a, 'privacy', 'admin')) throw apiError('NOT_ALLOWED');
    if (!Number.isInteger(months) || months < 1 || months > 600) throw apiError('PD_RETENTION_INVALID');
    if (!consumeStepUp(a.id)) throw apiError('STEP_UP_REQUIRED');
    const e = entry(category);
    const before = e.retentionMonths;
    if (before === months) return;
    e.retentionMonths = months;
    audit.log({ action: 'settings', entity: 'pd_register', entityId: category, entityLabel: e.name.ru, changes: [{ field: 'retentionMonths', from: String(before), to: String(months) }] });
    emit();
    await delay(null);
  },

  /** Регистрация посетителя: собираются только поля, нужные для пропускного режима (минимизация). */
  async addVisitor(input: { fullName: string; passport: string; pinfl: string; phone: string; hostId: ID; purpose: string }): Promise<PdVisitor> {
    const a = actor();
    if (!a || !can(a, 'privacy', 'edit')) throw apiError('NOT_ALLOWED');
    if (!input.fullName.trim() || !input.hostId || !input.purpose.trim()) throw apiError('REQUIRED');
    if (!/^[A-Z]{2}\d{7}$/.test(input.passport.trim().toUpperCase())) throw apiError('PD_PASSPORT_FORMAT');
    if (input.pinfl.trim() && !/^\d{14}$/.test(input.pinfl.trim())) throw apiError('PD_PINFL_FORMAT');
    const v: PdVisitor = { id: `vis${++visSeq}`, fullName: input.fullName.trim(), passport: input.passport.trim().toUpperCase(), pinfl: input.pinfl.trim(), phone: input.phone.trim(), visitDate: today(), hostId: input.hostId, purpose: input.purpose.trim() };
    visitors.push(v);
    audit.log({ action: 'create', entity: 'pd_visitors', entityId: v.id, entityLabel: `pass ${v.id}`, details: `host ${input.hostId}` });
    emit();
    return delay(clone(v));
  },

  /** Заявка на обезличивание записей с истёкшим сроком (администратор / HR, после 2FA) → юрист. */
  async requestAnonymization(keys: string[], regulation: string): Promise<PdRequest> {
    const a = actor();
    if (!a || !can(a, 'privacy', 'edit')) throw apiError('NOT_ALLOWED');
    if (!regulation.trim()) throw apiError('REGULATION_REQUIRED');
    const due = allRecords().filter((r) => keys.includes(r.key) && r.due);
    if (!due.length) throw apiError('PD_NOTHING_SELECTED');
    if (requests.some((r) => r.status === 'pending' && r.keys.some((k) => due.some((d) => d.key === k)))) throw apiError('RETENTION_PENDING_EXISTS');
    if (!consumeStepUp(a.id)) throw apiError('STEP_UP_REQUIRED');
    const r: PdRequest = {
      id: `pdr${++reqSeq}`,
      number: `PD-${new Date().getFullYear()}-${String(reqSeq).padStart(4, '0')}`,
      status: 'pending',
      keys: due.map((d) => d.key),
      labels: due.map((d) => `${d.category}:${d.id}`),
      regulation: regulation.trim(),
      initiatorId: a.id,
      createdAt: now(),
      history: [{ at: now(), userId: a.id, action: 'created' }],
    };
    requests.push(r);
    audit.log({ action: 'anonymize', entity: 'pd_request', entityId: r.id, entityLabel: r.number, details: `request filed: ${r.keys.length} records (${r.labels.join(', ')}) · ${r.regulation}, awaiting second person` });
    approvalEngine.open({ entity: 'pd_anonymize', entityId: r.id, number: r.number, title: `Обезличивание ПДн: ${r.keys.length} записей с истёкшим сроком хранения`, requesterId: a.id });
    emit();
    return delay(clone(r));
  },

  /** Только для демо-сброса. */
  reset,
};
