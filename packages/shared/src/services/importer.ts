// Миграция и загрузка данных (ТЗ PR-GEN-019 / PR-GEN-047): цели импорта со схемой полей,
// автосопоставление колонок, разбор значений (числа, даты, ИНН, перечисления, да/нет),
// проверка правил по каждому полю, дубликаты в файле и в системе, протокол ошибок, журнал загрузок.
import type { ID, Localized, User, CounterpartyType } from '../types';
import { api } from '../api';
import { DqError, orgApi, validateCostCenter, type CostCenterDraft } from '../org';
import { directory } from '../directory';
import { emit, nextId, now } from '../bus';
import { later, serviceAudit } from './hooks';
import type { XlsxSheet } from './xlsx';
import { apiError } from '../errors';

export type ImportFieldType = 'string' | 'number' | 'integer' | 'date' | 'tin' | 'enum' | 'boolean' | 'email' | 'phone';

export interface ImportOption {
  value: string;
  label: Localized;
  aliases?: string[];
}

export interface ImportField {
  key: string;
  label: Localized;
  type: ImportFieldType;
  required?: boolean;
  /** Значение должно быть уникальным в файле. */
  unique?: boolean;
  options?: ImportOption[];
  min?: number;
  max?: number;
  /** Регулярное выражение (source) для строк. */
  pattern?: string;
  patternHint?: string;
  maxLength?: number;
  /** Дополнительные варианты заголовка колонки для автосопоставления. */
  aliases?: string[];
  /** Пример значения для шаблона. */
  sample?: string;
}

export type ImportValue = string | number | boolean | null;

export interface ImportCommitResult {
  created: number;
  updated: number;
  skipped: number;
  /** Создано заявок на изменение (MDM), ожидающих утверждения. */
  pending?: number;
  /** Строки, отклонённые системой при записи (номер строки → ключи сообщений). */
  rejected?: { line: number; messages: string[] }[];
}

export interface ImportCommitContext {
  fileName: string;
  /** Номера строк файла для каждой передаваемой записи (в том же порядке). */
  lines: number[];
}

export interface ImportTarget {
  id: string;
  name: Localized;
  description: Localized;
  fields: ImportField[];
  /** Поле-ключ для поиска существующих записей (обновление вместо создания). */
  keyField?: string;
  /** Ключи записей, уже существующих в системе. */
  existingKeys?: () => Promise<string[]>;
  /** Дополнительная проверка по данным системы (справочники, барьер качества MDM): замечания по каждой строке. */
  extraValidate?: (rows: Record<string, ImportValue>[]) => Promise<ImportIssue[][]>;
  commit: (rows: Record<string, ImportValue>[], user: User, mode: ImportMode, ctx: ImportCommitContext) => Promise<ImportCommitResult>;
}

/** create — только новые (существующие пропускаются с предупреждением); upsert — новые и обновление существующих. */
export type ImportMode = 'create' | 'upsert';

export type ImportIssueCode = 'required' | 'number' | 'integer' | 'date' | 'tin' | 'enum' | 'boolean' | 'email' | 'phone' | 'min' | 'max' | 'pattern' | 'maxLength' | 'duplicate' | 'exists' | 'reference' | 'rule';

export interface ImportIssue {
  field: string;
  code: ImportIssueCode;
  value: string;
  severity: 'error' | 'warning';
  /** Ключ словаря с текстом замечания (для правил из других сервисов, например барьера качества MDM). */
  messageKey?: string;
  detail?: string;
}

export interface ValidatedRow {
  /** Номер строки в исходном файле (1 — заголовок). */
  line: number;
  values: Record<string, ImportValue>;
  raw: Record<string, string>;
  issues: ImportIssue[];
  ok: boolean;
  exists: boolean;
}

/** Сопоставление: ключ поля → номер колонки файла (-1 — не загружать). */
export type ImportMapping = Record<string, number>;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ʻʼ‘’`']/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-яўқғҳ0-9]+/gi, '');

/** Автосопоставление колонок файла с полями по названиям (ru/uz/en, ключ и синонимы). */
export function autoMap(headers: string[], fields: ImportField[]): ImportMapping {
  const h = headers.map(norm);
  const used = new Set<number>();
  const out: ImportMapping = {};
  for (const f of fields) {
    const names = [f.key, f.label.ru, f.label.uz, f.label.en ?? '', ...(f.aliases ?? [])].map(norm).filter(Boolean);
    let idx = h.findIndex((x, i) => !used.has(i) && names.includes(x));
    if (idx < 0) idx = h.findIndex((x, i) => !used.has(i) && x.length > 2 && names.some((n) => n.length > 2 && (x.startsWith(n) || n.startsWith(x))));
    out[f.key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return out;
}

/** Число из «1 234 567,89», «1,234,567.89», «12.5%». */
export function parseNumber(s: string): number | null {
  let t = s.replace(/[\s  ']/g, '').replace(/(UZS|сум|so['ʻ‘]m|%)$/i, '');
  if (!t) return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Дата из YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, серийного номера Excel → YYYY-MM-DD. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let mm: RegExpExecArray | null;
  if ((mm = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(t))) [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else if ((mm = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t))) [d, m, y] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else if (/^\d{4,5}(\.\d+)?$/.test(t)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000);
    return dt.toISOString().slice(0, 10);
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const TRUE = ['да', 'yes', 'ha', 'true', '1', 'истина', 'y', 'д', '+'];
const FALSE = ['нет', 'no', 'yoq', 'false', '0', 'ложь', 'n', 'н', '-', 'yuq'];

function parseValue(f: ImportField, raw: string): { value: ImportValue; code?: ImportIssueCode } {
  const s = raw.trim();
  if (!s) return { value: null };
  switch (f.type) {
    case 'number':
    case 'integer': {
      const n = parseNumber(s);
      if (n === null) return { value: null, code: 'number' };
      if (f.type === 'integer' && !Number.isInteger(n)) return { value: null, code: 'integer' };
      if (f.min !== undefined && n < f.min) return { value: n, code: 'min' };
      if (f.max !== undefined && n > f.max) return { value: n, code: 'max' };
      return { value: n };
    }
    case 'date': {
      const d = parseDate(s);
      return d ? { value: d } : { value: null, code: 'date' };
    }
    case 'tin': {
      const digits = s.replace(/\s/g, '');
      return /^\d{9}$/.test(digits) ? { value: digits } : { value: null, code: 'tin' };
    }
    case 'boolean': {
      const k = norm(s);
      if (TRUE.includes(k) || TRUE.includes(s.toLowerCase())) return { value: true };
      if (FALSE.includes(k) || FALSE.includes(s.toLowerCase())) return { value: false };
      return { value: null, code: 'boolean' };
    }
    case 'enum': {
      const k = norm(s);
      const opt = f.options?.find((o) => [o.value, o.label.ru, o.label.uz, o.label.en ?? '', ...(o.aliases ?? [])].map(norm).includes(k));
      return opt ? { value: opt.value } : { value: null, code: 'enum' };
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s } : { value: null, code: 'email' };
    case 'phone': {
      const p = s.replace(/[\s()-]/g, '');
      return /^\+?\d{9,12}$/.test(p) ? { value: s } : { value: null, code: 'phone' };
    }
    default: {
      if (f.maxLength && s.length > f.maxLength) return { value: s, code: 'maxLength' };
      if (f.pattern && !new RegExp(f.pattern).test(s)) return { value: s, code: 'pattern' };
      return { value: s };
    }
  }
}

/** Проверить строки файла (без строки заголовка; firstLine — номер первой строки данных в файле). */
export function validateRows(data: string[][], mapping: ImportMapping, target: Pick<ImportTarget, 'fields' | 'keyField'>, existing: string[] = [], firstLine = 2, mode: ImportMode = 'create'): ValidatedRow[] {
  const seen = new Map<string, Map<string, number>>();
  const existingSet = new Set(existing.map((x) => x.toLowerCase()));
  return data
    .map((cells, i) => ({ cells, line: firstLine + i }))
    .filter(({ cells }) => cells.some((c) => c && c.trim() !== ''))
    .map(({ cells, line }) => {
      const values: Record<string, ImportValue> = {};
      const raw: Record<string, string> = {};
      const issues: ImportIssue[] = [];
      for (const f of target.fields) {
        const col = mapping[f.key] ?? -1;
        const s = col >= 0 ? (cells[col] ?? '').toString() : '';
        raw[f.key] = s;
        const { value, code } = parseValue(f, s);
        values[f.key] = value;
        if (code) issues.push({ field: f.key, code, value: s, severity: 'error' });
        else if (f.required && (value === null || value === '')) issues.push({ field: f.key, code: 'required', value: s, severity: 'error' });
        if (f.unique && value !== null && value !== '') {
          const m = seen.get(f.key) ?? new Map<string, number>();
          const k = String(value).toLowerCase();
          if (m.has(k)) issues.push({ field: f.key, code: 'duplicate', value: s, severity: 'error' });
          else m.set(k, line);
          seen.set(f.key, m);
        }
      }
      const key = target.keyField ? values[target.keyField] : null;
      const exists = key !== null && key !== undefined && existingSet.has(String(key).toLowerCase());
      if (exists) issues.push({ field: target.keyField!, code: 'exists', value: String(key), severity: mode === 'create' ? 'warning' : 'warning' });
      return { line, values, raw, issues, ok: !issues.some((x) => x.severity === 'error'), exists };
    });
}

// ---------- Реестр целей и журнал ----------

export interface ImportLogEntry {
  id: ID;
  targetId: string;
  fileName: string;
  at: string;
  userId: ID;
  total: number;
  errors: number;
  created: number;
  updated: number;
  skipped: number;
  pending: number;
  mode: ImportMode;
}

const targets = new Map<string, ImportTarget>();
const log: ImportLogEntry[] = [];
/** Записи, загруженные в «буферную» область (для справочников без API записи — до подключения MDM). */
const staging = new Map<string, Record<string, ImportValue>[]>();

export const importRegistry = {
  register(t: ImportTarget): void {
    targets.set(t.id, t);
  },
  /** Переопределить запись в систему (например, P1-ORG подключает МВЗ через заявки MDM). */
  override(id: string, patch: Partial<Pick<ImportTarget, 'commit' | 'existingKeys'>>): void {
    const t = targets.get(id);
    if (t) targets.set(id, { ...t, ...patch });
  },
  list(): ImportTarget[] {
    return [...targets.values()];
  },
  get(id: string): ImportTarget | undefined {
    return targets.get(id);
  },
};

export const importApi = {
  async existing(targetId: string): Promise<string[]> {
    const t = targets.get(targetId);
    return t?.existingKeys ? t.existingKeys() : [];
  },
  /** Дополнительные проверки цели (по данным системы) поверх validateRows. */
  async extraValidate(targetId: string, rows: ValidatedRow[]): Promise<ValidatedRow[]> {
    const t = targets.get(targetId);
    const candidates = rows.filter((r) => r.ok);
    if (!t?.extraValidate || !candidates.length) return rows;
    const extra = await t.extraValidate(candidates.map((r) => r.values));
    const byLine = new Map(candidates.map((r, i) => [r.line, extra[i] ?? []]));
    return rows.map((r) => {
      const add = byLine.get(r.line);
      if (!add?.length) return r;
      const issues = [...r.issues, ...add];
      return { ...r, issues, ok: !issues.some((x) => x.severity === 'error') };
    });
  },
  /** Загрузить проверенные строки (только без ошибок). Возвращает запись журнала. */
  async commit(targetId: string, rows: ValidatedRow[], user: User, fileName: string, mode: ImportMode): Promise<ImportLogEntry> {
    const t = targets.get(targetId);
    if (!t) throw apiError('UNKNOWN_IMPORT_TARGET');
    const good = rows.filter((r) => r.ok && (mode === 'upsert' || !r.exists));
    const res = await t.commit(good.map((r) => r.values), user, mode, { fileName, lines: good.map((r) => r.line) });
    const entry: ImportLogEntry = {
      id: nextId('im'),
      targetId,
      fileName,
      at: now(),
      userId: user.id,
      total: rows.length,
      errors: rows.filter((r) => !r.ok).length + (res.rejected?.length ?? 0),
      created: res.created,
      updated: res.updated,
      skipped: res.skipped + (rows.length - good.length - rows.filter((r) => !r.ok).length),
      pending: res.pending ?? 0,
      mode,
    };
    log.unshift(entry);
    serviceAudit({ userId: user.id, action: 'import.commit', entity: targetId, entityId: entry.id, details: `${fileName}: +${res.created} ~${res.updated}, errors ${entry.errors}` });
    emit();
    return later(entry);
  },
  log(targetId?: string): Promise<ImportLogEntry[]> {
    return later(log.filter((l) => !targetId || l.targetId === targetId).map((l) => ({ ...l })));
  },
  staged(targetId: string): Promise<Record<string, ImportValue>[]> {
    return later((staging.get(targetId) ?? []).map((r) => ({ ...r })));
  },
};

type Lang4 = 'ru' | 'uz' | 'uzc' | 'en';
const lbl = (l: Localized, lang: Lang4) => (lang === 'ru' ? l.ru : lang === 'en' ? l.en ?? l.uz : l.uz);

/** Шаблон для загрузки: лист с заголовками и примером + лист-инструкция с правилами полей. */
export function importTemplate(t: ImportTarget, lang: Lang4, labels: { field: string; type: string; required: string; values: string; yes: string; no: string; instruction: string; types: Record<ImportFieldType, string> }): XlsxSheet[] {
  return [
    {
      name: lbl(t.name, lang),
      columns: t.fields.map((f) => ({ header: lbl(f.label, lang) + (f.required ? ' *' : ''), format: 'text' as const, width: Math.max(14, lbl(f.label, lang).length + 4) })),
      rows: [t.fields.map((f) => f.sample ?? '')],
    },
    {
      name: labels.instruction,
      columns: [{ header: labels.field, width: 32 }, { header: labels.type, width: 18 }, { header: labels.required, width: 14 }, { header: labels.values, width: 60 }],
      rows: t.fields.map((f) => [
        lbl(f.label, lang),
        labels.types[f.type],
        f.required ? labels.yes : labels.no,
        f.options ? f.options.map((o) => `${o.value} — ${lbl(o.label, lang)}`).join('; ') : f.patternHint ?? (f.min !== undefined || f.max !== undefined ? `${f.min ?? ''}…${f.max ?? ''}` : ''),
      ]),
    },
  ];
}

// ---------- Встроенные цели ----------
const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

importRegistry.register({
  id: 'counterparties',
  name: L('Контрагенты', 'Kontragentlar', 'Counterparties'),
  description: L('Поставщики и подрядчики: ИНН, тип, адрес, телефон, рейтинг', 'Yetkazib beruvchilar va pudratchilar: STIR, turi, manzil, telefon, reyting', 'Suppliers and contractors: TIN, type, address, phone, rating'),
  keyField: 'tin',
  fields: [
    { key: 'name', label: L('Наименование', 'Nomi', 'Name'), type: 'string', required: true, maxLength: 200, aliases: ['название', 'организация', 'company'], sample: 'ООО «Пример Сервис»' },
    { key: 'tin', label: L('ИНН', 'STIR', 'TIN'), type: 'tin', required: true, unique: true, aliases: ['inn', 'stir'], sample: '305551234', patternHint: '9 цифр / 9 raqam' },
    { key: 'type', label: L('Тип', 'Turi', 'Type'), type: 'enum', required: true, sample: 'legal', options: [
      { value: 'legal', label: L('Юридическое лицо', 'Yuridik shaxs', 'Legal entity'), aliases: ['юл', 'ооо', 'llc'] },
      { value: 'individual_entrepreneur', label: L('ИП', 'YaTT', 'Sole proprietor'), aliases: ['индивидуальный предприниматель', 'ип'] },
      { value: 'foreign', label: L('Иностранная компания', 'Xorijiy kompaniya', 'Foreign company'), aliases: ['нерезидент'] },
    ] },
    { key: 'address', label: L('Адрес', 'Manzil', 'Address'), type: 'string', maxLength: 300, sample: 'г. Ташкент, ул. Примерная, 1' },
    { key: 'phone', label: L('Телефон', 'Telefon', 'Phone'), type: 'phone', sample: '+998 71 200 00 00' },
    { key: 'rating', label: L('Рейтинг (1–5)', 'Reyting (1–5)', 'Rating (1–5)'), type: 'integer', min: 1, max: 5, sample: '4' },
    { key: 'blocked', label: L('Заблокирован', 'Bloklangan', 'Blocked'), type: 'boolean', sample: 'нет' },
  ],
  existingKeys: async () => (await api.listCounterparties()).map((c) => c.tin),
  async commit(rows, _user, mode) {
    const existing = await api.listCounterparties();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const r of rows) {
      const found = existing.find((c) => c.tin === r.tin);
      if (found && mode === 'create') {
        skipped++;
        continue;
      }
      await api.saveCounterparty({
        ...(found ? { id: found.id } : {}),
        name: String(r.name),
        tin: String(r.tin),
        type: (r.type as CounterpartyType) ?? 'legal',
        address: r.address ? String(r.address) : found?.address ?? '',
        phone: r.phone ? String(r.phone) : found?.phone ?? '',
        rating: typeof r.rating === 'number' ? r.rating : found?.rating ?? 3,
        blocked: typeof r.blocked === 'boolean' ? r.blocked : found?.blocked ?? false,
      });
      if (found) updated++;
      else created++;
    }
    return { created, updated, skipped };
  },
});

const SEGMENTS: ImportOption[] = [
  { value: 'retail', label: L('Розничный бизнес', 'Chakana biznes', 'Retail') },
  { value: 'corporate', label: L('Корпоративный бизнес', 'Korporativ biznes', 'Corporate') },
  { value: 'sme', label: L('МСБ', 'KOB', 'SME') },
  { value: 'treasury', label: L('Казначейство', 'G‘aznachilik', 'Treasury') },
  { value: 'support', label: L('Поддержка', 'Qo‘llab-quvvatlash', 'Support') },
  { value: 'it', label: L('ИТ', 'AT', 'IT') },
];

function stagingCommit(id: string, keyField: string) {
  return async (rows: Record<string, ImportValue>[], _u: User, mode: ImportMode): Promise<ImportCommitResult> => {
    const list = staging.get(id) ?? [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const r of rows) {
      const i = list.findIndex((x) => String(x[keyField]).toLowerCase() === String(r[keyField]).toLowerCase());
      if (i >= 0 && mode === 'create') skipped++;
      else if (i >= 0) {
        list[i] = r;
        updated++;
      } else {
        list.push(r);
        created++;
      }
    }
    staging.set(id, list);
    return { created, updated, skipped };
  };
}

// МВЗ загружаются через заявки MDM (P1-ORG): барьер качества данных проверяется до загрузки,
// каждая строка становится заявкой «создание МВЗ», которая вступает в силу после утверждения (4 глаза).
const DQ_FIELD: Record<string, string> = { code: 'code', nameRu: 'nameRu', nameUz: 'nameUz', orgUnitKey: 'orgUnit', cbuCode: 'cbuCode', segment: 'segment', expenseGroupId: 'expenseGroup', responsibleId: 'responsible' };

async function costCenterDrafts(rows: Record<string, ImportValue>[]) {
  const [units, groups] = await Promise.all([orgApi.listOrgUnits(), orgApi.listExpenseGroups()]);
  const users = directory.users();
  return rows.map((r) => {
    const issues: ImportIssue[] = [];
    const unit = units.find((u) => u.code.toLowerCase() === String(r.orgUnit ?? '').trim().toLowerCase());
    if (r.orgUnit && !unit) issues.push({ field: 'orgUnit', code: 'reference', value: String(r.orgUnit), severity: 'error' });
    const group = groups.find((g) => g.code.toLowerCase() === String(r.expenseGroup ?? '').trim().toLowerCase() || g.id === r.expenseGroup);
    if (r.expenseGroup && !group) issues.push({ field: 'expenseGroup', code: 'reference', value: String(r.expenseGroup), severity: 'error' });
    const resp = r.responsible ? users.find((u) => u.email.toLowerCase() === String(r.responsible).toLowerCase()) : undefined;
    if (r.responsible && !resp) issues.push({ field: 'responsible', code: 'reference', value: String(r.responsible), severity: 'warning' });
    const draft: CostCenterDraft = {
      code: String(r.code ?? '').trim(),
      name: { ru: String(r.nameRu ?? ''), uz: String(r.nameUz ?? '') },
      ...(unit ? { orgUnitKey: unit.key } : {}),
      cbuCode: String(r.cbuCode ?? '').trim(),
      segment: (r.segment as CostCenterDraft['segment']) ?? '',
      ...(group ? { expenseGroupId: group.id } : {}),
      ...(resp ? { responsibleId: resp.id } : {}),
    };
    return { draft, issues, effectiveFrom: String(r.validFrom ?? '') };
  });
}

importRegistry.register({
  id: 'cost_centers',
  name: L('МВЗ (места возникновения затрат)', 'XJM (xarajatlar joylari)', 'Cost centres'),
  description: L(
    'Код МВЗ, наименование, оргединица, ЦБУ, сегмент, группа расходов. Строки проходят барьер качества MDM и становятся заявками на создание МВЗ (вступают в силу после утверждения).',
    'XJM kodi, nomi, tashkiliy birlik, BXM, segment, xarajat guruhi. Qatorlar MDM sifat to‘sig‘idan o‘tadi va XJM yaratish arizalariga aylanadi (tasdiqlangandan keyin kuchga kiradi).',
    'Code, name, org unit, branch, segment, expense group. Rows pass the MDM data-quality firewall and become cost-centre creation requests (effective after approval).',
  ),
  keyField: 'code',
  fields: [
    { key: 'code', label: L('Код МВЗ', 'XJM kodi', 'Cost centre code'), type: 'string', required: true, unique: true, pattern: '^MVZ-\\d{2}-\\d{3}-[A-Z0-9]{2,3}$', patternHint: 'MVZ-RR-UUU-NN', aliases: ['mvz', 'код'], sample: 'MVZ-01-001-90' },
    { key: 'nameRu', label: L('Наименование (рус.)', 'Nomi (rus.)', 'Name (Russian)'), type: 'string', required: true, maxLength: 200, sample: 'Сектор методологии' },
    { key: 'nameUz', label: L('Наименование (узб.)', 'Nomi (o‘zb.)', 'Name (Uzbek)'), type: 'string', required: true, maxLength: 200, sample: 'Metodologiya sektori' },
    { key: 'orgUnit', label: L('Код оргединицы', 'Tashkiliy birlik kodi', 'Org unit code'), type: 'string', required: true, sample: '01001' },
    { key: 'cbuCode', label: L('Код ЦБУ', 'BXM kodi', 'Branch code'), type: 'string', required: true, pattern: '^\\d{5}$', patternHint: '5 цифр / 5 raqam / 5 digits', sample: '01001' },
    { key: 'segment', label: L('Сегмент', 'Segment', 'Segment'), type: 'enum', required: true, options: SEGMENTS, sample: 'retail' },
    { key: 'expenseGroup', label: L('Группа расходов (код)', 'Xarajat guruhi (kod)', 'Expense group (code)'), type: 'string', required: true, sample: 'EG-OTH', patternHint: 'EG-IT, EG-MKT, EG-DEV, EG-PERS, EG-ADM, EG-OTH' },
    { key: 'validFrom', label: L('Действует с', 'Amal qilish sanasi', 'Valid from'), type: 'date', required: true, sample: '01.01.2027' },
    { key: 'responsible', label: L('Ответственный (e-mail)', 'Mas’ul (e-mail)', 'Responsible (e-mail)'), type: 'email', sample: 'b.azizov@example.uz' },
  ],
  existingKeys: async () => {
    const page = await orgApi.listCostCenters({ pageSize: 100_000, status: '' });
    return page.rows.map((c) => c.code);
  },
  async extraValidate(rows) {
    const drafts = await costCenterDrafts(rows);
    return drafts.map(({ draft, issues, effectiveFrom }) => [
      ...issues,
      ...validateCostCenter(draft, undefined, effectiveFrom || undefined)
        .filter((d) => !(d.field === 'orgUnitKey' && issues.some((i) => i.field === 'orgUnit')) && !(d.field === 'expenseGroupId' && issues.some((i) => i.field === 'expenseGroup')))
        .map((d) => ({ field: DQ_FIELD[d.field] ?? 'code', code: 'rule' as const, value: d.detail ?? '', severity: d.severity, messageKey: d.code, ...(d.detail ? { detail: d.detail } : {}) })),
    ]);
  },
  async commit(rows, user, _mode, ctx) {
    const drafts = await costCenterDrafts(rows);
    let pending = 0;
    const rejected: { line: number; messages: string[] }[] = [];
    for (let i = 0; i < drafts.length; i++) {
      const { draft, effectiveFrom } = drafts[i]!;
      try {
        await orgApi.submitChange({ entity: 'cost_center', action: 'create', payload: draft as Record<string, unknown>, effectiveFrom, reason: `Импорт / Import: ${ctx.fileName}`, attachment: { name: ctx.fileName, size: rows.length } }, user);
        pending++;
      } catch (e) {
        rejected.push({ line: ctx.lines[i] ?? 0, messages: e instanceof DqError ? e.issues.map((x) => x.code) : ['actionFailed'] });
      }
    }
    return { created: 0, updated: 0, skipped: 0, pending, rejected };
  },
});

importRegistry.register({
  id: 'items',
  name: L('Номенклатура ТМЦ', 'TMB nomenklaturasi', 'Inventory items'),
  description: L('Артикул, наименование, категория, единица, минимальный остаток, цена', 'Artikul, nomi, toifa, o‘lchov birligi, minimal qoldiq, narx', 'SKU, name, category, unit, min stock, price'),
  keyField: 'sku',
  fields: [
    { key: 'sku', label: L('Артикул', 'Artikul', 'SKU'), type: 'string', required: true, unique: true, pattern: '^[A-Z0-9-]{3,20}$', patternHint: 'A-Z, 0-9, «-»', sample: 'IT-0101' },
    { key: 'name', label: L('Наименование', 'Nomi', 'Name'), type: 'string', required: true, maxLength: 200, sample: 'Картридж лазерный' },
    { key: 'category', label: L('Категория', 'Toifa', 'Category'), type: 'enum', required: true, sample: 'it', options: [
      { value: 'office', label: L('Канцтовары', 'Kanselyariya', 'Office supplies') },
      { value: 'it', label: L('ИТ-оборудование', 'AT uskunalari', 'IT equipment') },
      { value: 'forms', label: L('Бланки', 'Blankalar', 'Forms') },
      { value: 'household', label: L('Хозтовары', 'Xo‘jalik mollari', 'Household') },
      { value: 'security', label: L('Средства охраны', 'Qo‘riqlash vositalari', 'Security') },
    ] },
    { key: 'unit', label: L('Ед. изм.', 'O‘lch. birl.', 'Unit'), type: 'string', required: true, maxLength: 10, sample: 'шт' },
    { key: 'minQty', label: L('Мин. остаток', 'Min. qoldiq', 'Min stock'), type: 'integer', min: 0, sample: '10' },
    { key: 'unitCost', label: L('Цена, UZS', 'Narx, UZS', 'Price, UZS'), type: 'number', min: 0, sample: '450000' },
  ],
  existingKeys: async () => (staging.get('items') ?? []).map((r) => String(r.sku)),
  commit: stagingCommit('items', 'sku'),
});
