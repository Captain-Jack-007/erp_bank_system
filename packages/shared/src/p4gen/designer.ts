// P4-GEN (ТЗ PR-GEN-020): конструктор интеграций — сотрудник банка создаёт новую интеграцию из интерфейса:
// система, протокол (REST/SOAP/файл/MQ), адрес, способ аутентификации, операции с маппингом полей запроса
// и ответа, расписание, политика повторов, включение/отключение. Интеграция регистрируется в integrationHub
// (видна в мониторе, вызывается как любая система, повторы и очередь — по своей политике), обращения идут
// на имитируемую конечную точку. Изменения подтверждаются кодом 2FA (в UI) и пишутся в аудит.
// Описание операций выгружается в OpenAPI 3.0 (JSON).
import { audit, diffFields } from '../audit';
import { clone, delay, emit } from '../bus';
import { getUsersRef } from '../security';
import { INTEGRATION_SYSTEMS, integrationHub, type ExchangeRecord, type IntegrationErrorCode, type IntegrationSystem } from '../services/integrations';
import type { ID, Localized } from '../types';

export type CustomProtocol = 'rest' | 'soap' | 'file' | 'mq';
export type CustomAuth = 'none' | 'basic' | 'api_key' | 'oauth2' | 'mtls';
export type CustomFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'date';
export type CustomMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export const CUSTOM_PROTOCOLS: CustomProtocol[] = ['rest', 'soap', 'file', 'mq'];
export const CUSTOM_AUTHS: CustomAuth[] = ['none', 'basic', 'api_key', 'oauth2', 'mtls'];
export const CUSTOM_FIELD_TYPES: CustomFieldType[] = ['string', 'number', 'integer', 'boolean', 'date'];
export const CUSTOM_METHODS: CustomMethod[] = ['GET', 'POST', 'PUT', 'DELETE'];

export interface CustomField {
  /** Имя поля во внешней системе. */
  name: string;
  type: CustomFieldType;
  required: boolean;
  /** Поле XB-ERP, из которого берётся (запрос) или в которое пишется (ответ) значение, например contract.number. */
  mapTo: string;
}

export interface CustomOperation {
  id: string;
  name: string;
  direction: 'out' | 'in';
  /** REST — HTTP-метод; SOAP — POST (SOAPAction = id); файл/MQ — не используется. */
  method: CustomMethod;
  /** REST — путь (/rates/{date}); SOAP — SOAPAction; файл — маска имени; MQ — очередь/топик. */
  target: string;
  request: CustomField[];
  response: CustomField[];
}

export type CustomSchedule = { kind: 'online' } | { kind: 'interval'; minutes: number } | { kind: 'daily'; time: string };

export interface CustomIntegration {
  id: ID;
  systemId: string;
  name: string;
  owner: string;
  description: string;
  protocol: CustomProtocol;
  endpoint: string;
  auth: CustomAuth;
  operations: CustomOperation[];
  schedule: CustomSchedule;
  retry: { maxAttempts: number; backoffMs: number };
  enabled: boolean;
  version: number;
  createdBy: ID;
  createdAt: string;
  updatedBy: ID;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export type CustomIntegrationInput = Omit<CustomIntegration, 'id' | 'systemId' | 'version' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt' | 'lastRunAt' | 'nextRunAt'> & { id?: ID };

/** Ошибки проверки: поле → ключ словаря. */
export class CustomIntegrationError extends Error {
  constructor(public issues: Record<string, string>) {
    super('custom integration invalid');
  }
}

const items: CustomIntegration[] = [];
let seq = 0;
const L = (s: string): Localized => ({ ru: s, uz: s, en: s });

const PROTOCOL_LABEL: Record<CustomProtocol, IntegrationSystem['passport']['protocol']> = { rest: 'REST/JSON', soap: 'SOAP/XML', file: 'SFTP/ETL', mq: 'MQ (AMQP)' };
const AUTH_LABEL: Record<CustomAuth, string> = { none: 'Без аутентификации', basic: 'HTTP Basic', api_key: 'API-ключ (заголовок X-API-Key)', oauth2: 'OAuth 2.0 client credentials', mtls: 'mTLS (сертификат клиента)' };
const ENDPOINT_RE: Record<CustomProtocol, RegExp> = { rest: /^https?:\/\/[\w.-]+(:\d+)?(\/\S*)?$/i, soap: /^https?:\/\/[\w.-]+(:\d+)?(\/\S*)?$/i, file: /^sftp:\/\/[\w.-]+(:\d+)?(\/\S*)?$/i, mq: /^amqps?:\/\/[\w.-]+(:\d+)?(\/\S*)?$/i };
const IDENT = /^[A-Za-z_][\w.]{0,63}$/;
const OP_ID = /^[a-z][a-z0-9_.-]{1,40}$/;

function slug(name: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };
  const s = name.toLowerCase().split('').map((c) => map[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return s || 'custom';
}

/** Пример значения по типу поля (для тестового вызова и ответа имитируемой конечной точки). */
function sampleValue(f: CustomField, rnd: () => number = Math.random, i = 0): unknown {
  switch (f.type) {
    case 'number':
      return Math.round(rnd() * 1_000_000) / 100;
    case 'integer':
      return Math.floor(rnd() * 1000) + i;
    case 'boolean':
      return rnd() > 0.3;
    case 'date':
      return new Date().toISOString().slice(0, 10);
    default:
      return f.mapTo ? `${f.mapTo.split('.').pop()}-${String(Math.floor(rnd() * 9000) + 1000)}` : 'demo';
  }
}

function checkType(f: CustomField, v: unknown): boolean {
  switch (f.type) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
    default:
      return typeof v === 'string';
  }
}

function hostOf(endpoint: string): string {
  return endpoint.replace(/^\w+:\/\//, '').split(/[/:]/)[0] ?? endpoint;
}

/** Ближайший запуск по расписанию (online — без расписания). */
export function nextRun(s: CustomSchedule, from: number): string | undefined {
  if (s.kind === 'interval') return new Date(from + Math.max(5, s.minutes) * 60_000).toISOString();
  if (s.kind === 'daily') {
    const [h, m] = s.time.split(':').map(Number);
    const d = new Date(from);
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  return undefined;
}

/** Описание системы для интеграционной шины. */
function toSystem(c: CustomIntegration): IntegrationSystem {
  return {
    id: c.systemId,
    tz: 'PR-GEN-020',
    kind: 'external',
    hosts: hostOf(c.endpoint),
    name: L(c.name),
    purpose: L(c.description || c.name),
    modules: ['integrations'],
    latency: [120, 420],
    retry: { ...c.retry },
    disabled: !c.enabled,
    passport: {
      source: 'XB-ERP',
      target: c.name,
      owner: L(c.owner || '—'),
      protocol: PROTOCOL_LABEL[c.protocol],
      format: c.protocol === 'soap' ? 'XML (SOAP 1.1), UTF-8' : c.protocol === 'file' ? 'CSV/JSON файлы, UTF-8' : 'JSON, UTF-8',
      endpoint: c.endpoint,
      auth: AUTH_LABEL[c.auth],
      schedule: L(c.schedule.kind === 'online' ? 'Online' : c.schedule.kind === 'interval' ? `Every ${c.schedule.minutes} min` : `Daily ${c.schedule.time}`),
      volume: L('—'),
      sla: '—',
      idempotency: 'Idempotency-Key (UUID)',
      errorCodes: 'timeout, http_500, http_503, validation',
      controlTotals: L('—'),
    },
    operations: c.operations.map((o) => ({
      id: o.id,
      name: L(o.name),
      direction: o.direction,
      schemaVersion: String(c.version),
      sample: () => Object.fromEntries(o.request.map((f, i) => [f.name, sampleValue(f, Math.random, i)])),
      validate: (p) => {
        const miss = o.request.filter((f) => f.required && (p[f.name] === undefined || p[f.name] === null || p[f.name] === ''));
        if (miss.length) return { code: 'validation' as IntegrationErrorCode, message: `Missing: ${miss.map((f) => f.name).join(', ')}` };
        const bad = o.request.filter((f) => p[f.name] !== undefined && p[f.name] !== null && p[f.name] !== '' && !checkType(f, p[f.name]));
        if (bad.length) return { code: 'validation' as IntegrationErrorCode, message: `Type mismatch: ${bad.map((f) => `${f.name}:${f.type}`).join(', ')}` };
        return null;
      },
      // Имитируемая конечная точка: ответ строится по описанию полей ответа.
      respond: (_p, rnd) => Object.fromEntries(o.response.map((f, i) => [f.name, sampleValue(f, rnd, i)])),
      count: () => 1,
    })),
  };
}

function register(c: CustomIntegration): void {
  const sys = toSystem(c);
  const i = INTEGRATION_SYSTEMS.findIndex((s) => s.id === c.systemId);
  if (i >= 0) INTEGRATION_SYSTEMS.splice(i, 1, sys);
  else INTEGRATION_SYSTEMS.push(sys);
}

function validate(input: CustomIntegrationInput): Record<string, string> {
  const issues: Record<string, string> = {};
  if (!input.name.trim()) issues.name = 'formRequired';
  else if (items.some((x) => x.name.trim().toLowerCase() === input.name.trim().toLowerCase() && x.id !== input.id)) issues.name = 'p4g_int_err_dup';
  if (!ENDPOINT_RE[input.protocol].test(input.endpoint.trim())) issues.endpoint = `p4g_int_err_endpoint_${input.protocol}`;
  if (!input.operations.length) issues.operations = 'p4g_int_err_noops';
  const ids = new Set<string>();
  input.operations.forEach((o, i) => {
    if (!OP_ID.test(o.id)) issues[`op${i}.id`] = 'p4g_int_err_opid';
    else if (ids.has(o.id)) issues[`op${i}.id`] = 'p4g_int_err_opdup';
    ids.add(o.id);
    if (!o.name.trim()) issues[`op${i}.name`] = 'formRequired';
    if (!o.target.trim()) issues[`op${i}.target`] = 'formRequired';
    for (const [side, list] of [['req', o.request], ['res', o.response]] as const) {
      const names = new Set<string>();
      list.forEach((f, j) => {
        if (!IDENT.test(f.name) || names.has(f.name)) issues[`op${i}.${side}${j}`] = 'p4g_int_err_field';
        names.add(f.name);
      });
    }
    if (!o.response.length) issues[`op${i}.res`] = 'p4g_int_err_nores';
  });
  if (input.schedule.kind === 'interval' && !(input.schedule.minutes >= 5 && input.schedule.minutes <= 1440)) issues.schedule = 'p4g_int_err_interval';
  if (input.schedule.kind === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.schedule.time)) issues.schedule = 'p4g_int_err_time';
  if (!(input.retry.maxAttempts >= 1 && input.retry.maxAttempts <= 10)) issues.retry = 'p4g_int_err_retry';
  if (!(input.retry.backoffMs >= 100 && input.retry.backoffMs <= 60_000)) issues.retry = 'p4g_int_err_retry';
  return issues;
}

const actor = (id: ID) => {
  const u = getUsersRef().find((x) => x.id === id);
  return u ? { id: u.id, fullName: u.fullName, role: u.role } : null;
};

export const integrationDesignerApi = {
  list(): Promise<CustomIntegration[]> {
    return delay(items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  },

  get(id: ID): Promise<CustomIntegration | undefined> {
    return delay(items.find((x) => x.id === id));
  },

  /** Шаблон новой интеграции (одна операция REST). */
  blank(): CustomIntegrationInput {
    return {
      name: '', owner: '', description: '', protocol: 'rest', endpoint: 'https://', auth: 'oauth2', enabled: true,
      schedule: { kind: 'online' }, retry: { maxAttempts: 3, backoffMs: 400 },
      operations: [{ id: 'data.get', name: '', direction: 'in', method: 'GET', target: '/', request: [{ name: 'date', type: 'date', required: true, mapTo: 'report.date' }], response: [{ name: 'value', type: 'number', required: true, mapTo: 'report.value' }] }],
    };
  },

  /** Сохранить (создать или новая версия) и зарегистрировать в интеграционной шине. */
  async save(input: CustomIntegrationInput, userId: ID): Promise<CustomIntegration> {
    const issues = validate(input);
    if (Object.keys(issues).length) throw new CustomIntegrationError(issues);
    const t = new Date().toISOString();
    const clean: CustomIntegrationInput = { ...clone(input), name: input.name.trim(), endpoint: input.endpoint.trim(), owner: input.owner.trim(), description: input.description.trim() };
    let c = input.id ? items.find((x) => x.id === input.id) : undefined;
    if (c) {
      const before = clone(c);
      Object.assign(c, clean, { version: c.version + 1, updatedBy: userId, updatedAt: t });
      const next = nextRun(c.schedule, Date.now());
      if (next) c.nextRunAt = next;
      else delete c.nextRunAt;
      const changes = diffFields(
        { ...before, operations: JSON.stringify(before.operations), schedule: JSON.stringify(before.schedule), retry: JSON.stringify(before.retry) },
        { ...c, operations: JSON.stringify(c.operations), schedule: JSON.stringify(c.schedule), retry: JSON.stringify(c.retry) },
        ['name', 'owner', 'protocol', 'endpoint', 'auth', 'operations', 'schedule', 'retry', 'enabled'],
      );
      audit.log({ action: 'update', entity: 'custom_integration', entityId: c.systemId, entityLabel: c.name, changes, details: `v${c.version}`, user: actor(userId) });
    } else {
      let systemId = `x-${slug(clean.name)}`;
      while (INTEGRATION_SYSTEMS.some((s) => s.id === systemId)) systemId = `x-${slug(clean.name)}-${++seq}`;
      const next = nextRun(clean.schedule, Date.now());
      c = { ...clean, id: `ci${++seq}`, systemId, version: 1, createdBy: userId, createdAt: t, updatedBy: userId, updatedAt: t, ...(next ? { nextRunAt: next } : {}) };
      items.push(c);
      audit.log({ action: 'create', entity: 'custom_integration', entityId: c.systemId, entityLabel: c.name, changes: diffFields({}, { ...c, operations: c.operations.map((o) => o.id).join(', ') }, ['name', 'protocol', 'endpoint', 'auth', 'operations', 'enabled']), user: actor(userId) });
    }
    register(c);
    emit();
    return delay(c);
  },

  async setEnabled(id: ID, enabled: boolean, userId: ID): Promise<void> {
    const c = items.find((x) => x.id === id);
    if (!c) throw new Error('not found');
    if (c.enabled === enabled) return;
    c.enabled = enabled;
    c.updatedBy = userId;
    c.updatedAt = new Date().toISOString();
    audit.log({ action: enabled ? 'activate' : 'deactivate', entity: 'custom_integration', entityId: c.systemId, entityLabel: c.name, changes: [{ field: 'enabled', from: String(!enabled), to: String(enabled) }], user: actor(userId) });
    register(c);
    emit();
    await delay(null);
  },

  async remove(id: ID, userId: ID): Promise<void> {
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return;
    const c = items[i]!;
    items.splice(i, 1);
    // история обмена сохраняется; система остаётся в справочнике шины отключённой (для журнала)
    register({ ...c, enabled: false });
    audit.log({ action: 'delete', entity: 'custom_integration', entityId: c.systemId, entityLabel: c.name, user: actor(userId) });
    emit();
    await delay(null);
  },

  /** Пример запроса для операции. */
  sample(c: CustomIntegration, opId: string): Record<string, unknown> {
    const op = c.operations.find((o) => o.id === opId);
    return op ? Object.fromEntries(op.request.map((f, i) => [f.name, sampleValue(f, Math.random, i)])) : {};
  },

  /** Тестовый вызов имитируемой конечной точки через шину (по политике повторов интеграции). */
  async testCall(id: ID, opId: string, payload: Record<string, unknown>, userId: ID): Promise<ExchangeRecord> {
    const c = items.find((x) => x.id === id);
    if (!c) throw new Error('not found');
    return integrationHub.call(c.systemId, opId, payload, { userId });
  },

  /** Плановые запуски по расписанию (вызывается фоновым таймером приложения). */
  async runDue(now = Date.now()): Promise<number> {
    let n = 0;
    for (const c of items) {
      if (!c.enabled || c.schedule.kind === 'online') continue;
      if (!c.nextRunAt) {
        const next = nextRun(c.schedule, now);
        if (next) c.nextRunAt = next;
        continue;
      }
      if (new Date(c.nextRunAt).getTime() > now) continue;
      const op = c.operations.find((o) => o.direction === 'in') ?? c.operations[0];
      if (!op) continue;
      c.lastRunAt = new Date(now).toISOString();
      const next = nextRun(c.schedule, now);
      if (next) c.nextRunAt = next;
      void integrationHub.call(c.systemId, op.id, integrationDesignerApi.sample(c, op.id), { userId: 'system', background: true }).catch(() => undefined);
      n++;
    }
    if (n) emit();
    return n;
  },

  /** OpenAPI 3.0 описание операций интеграции. */
  openApi(c: CustomIntegration): Record<string, unknown> {
    const schema = (fields: CustomField[]) => ({
      type: 'object',
      required: fields.filter((f) => f.required).map((f) => f.name),
      properties: Object.fromEntries(
        fields.map((f) => [f.name, { type: f.type === 'date' ? 'string' : f.type, ...(f.type === 'date' ? { format: 'date' } : {}), ...(f.mapTo ? { 'x-xb-erp-field': f.mapTo } : {}) }]),
      ),
    });
    const security: Record<string, unknown> = {
      basic: { type: 'http', scheme: 'basic' },
      api_key: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      oauth2: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: `${c.endpoint.replace(/\/$/, '')}/oauth/token`, scopes: {} } } },
      mtls: { type: 'mutualTLS' },
    };
    const paths: Record<string, Record<string, unknown>> = {};
    for (const o of c.operations) {
      const path = c.protocol === 'rest' ? (o.target.startsWith('/') ? o.target : `/${o.target}`) : `/${c.protocol}/${o.id}`;
      const method = (c.protocol === 'rest' ? o.method : 'POST').toLowerCase();
      const params = c.protocol === 'rest' && (o.method === 'GET' || o.method === 'DELETE');
      paths[path] = {
        ...(paths[path] ?? {}),
        [method]: {
          operationId: o.id,
          summary: o.name,
          tags: [c.name],
          'x-direction': o.direction,
          ...(c.protocol !== 'rest' ? { 'x-transport': { protocol: c.protocol, target: o.target } } : {}),
          ...(params
            ? { parameters: o.request.map((f) => ({ name: f.name, in: path.includes(`{${f.name}}`) ? 'path' : 'query', required: f.required || path.includes(`{${f.name}}`), schema: { type: f.type === 'date' ? 'string' : f.type, ...(f.type === 'date' ? { format: 'date' } : {}) } })) }
            : { requestBody: { required: true, content: { [c.protocol === 'soap' ? 'text/xml' : 'application/json']: { schema: schema(o.request) } } } }),
          responses: {
            '200': { description: 'OK', content: { 'application/json': { schema: schema(o.response) } } },
            '400': { description: 'validation' },
            '503': { description: 'unavailable (queued, retry policy applies)' },
          },
        },
      };
    }
    return {
      openapi: '3.0.3',
      info: { title: c.name, version: `${c.version}.0.0`, description: c.description || c.name, 'x-owner': c.owner, 'x-generated-by': 'XB-ERP integration designer' },
      servers: [{ url: c.endpoint }],
      paths,
      components: { securitySchemes: c.auth === 'none' ? {} : { [c.auth]: security[c.auth] } },
      ...(c.auth === 'none' ? {} : { security: [{ [c.auth]: [] }] }),
      'x-xb-erp': { systemId: c.systemId, protocol: c.protocol, schedule: c.schedule, retry: c.retry, enabled: c.enabled },
    };
  },
};
