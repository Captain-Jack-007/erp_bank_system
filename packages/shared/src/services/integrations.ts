// Интеграционная шина (ТЗ, раздел 5): реестр внешних и внутренних систем с паспортами интерфейсов
// (PR-INT-001), имитация обмена: задержки, сбои, повторные попытки с экспоненциальной паузой,
// ключи идемпотентности, очередь при недоступности системы с повторной отправкой после восстановления
// (PR-GEN-004 — отказ iABS), карантин некорректных сообщений, контрольные итоги и сверка (PR-INT-004),
// полный журнал обмена (PR-SEC-026).
import type { ID, Localized } from '../types';
import { emit, nextId } from '../bus';
import { sha256Hex } from './bytes';
import { later, seededRandom, serviceAudit, sleep } from './hooks';
import { apiError } from '../errors';

export type IntegrationKind = 'external' | 'internal';
export type ExchangeStatus = 'pending' | 'success' | 'failed' | 'queued' | 'quarantined' | 'discarded';
export type ExchangeDirection = 'out' | 'in';
/** Сценарий для демонстрации/тестов: обычный вызов, временный сбой (1-я попытка), постоянный сбой, битое сообщение. */
export type ExchangeSimulation = 'normal' | 'transient' | 'permanent' | 'invalid';
export type IntegrationErrorCode =
  | 'timeout'
  | 'http_503'
  | 'http_500'
  | 'validation'
  | 'control_total_mismatch'
  | 'idempotency_conflict'
  | 'unavailable'
  | 'unknown_operation';

type Payload = Record<string, unknown>;

export interface IntegrationOperation {
  id: string;
  name: Localized;
  direction: ExchangeDirection;
  schemaVersion: string;
  /** Пример сообщения для тестового вызова. */
  sample: () => Payload;
  /** Проверка сообщения: код ошибки и описание, либо null. */
  validate?: (p: Payload) => { code: IntegrationErrorCode; message: string } | null;
  /** Ответ системы-партнёра (имитация). */
  respond: (p: Payload, rnd: () => number) => Payload;
  /** Контрольная сумма сообщения (для сверки), UZS. */
  amount?: (p: Payload) => number;
  /** Количество записей в сообщении. */
  count?: (p: Payload) => number;
}

export interface IntegrationPassport {
  source: string;
  target: string;
  owner: Localized;
  protocol: 'REST/JSON' | 'SOAP/XML' | 'SFTP/ETL' | 'REST/JSON + ETL' | 'MQ (AMQP)'; // P4-GEN: MQ — интеграции из конструктора
  format: string;
  endpoint: string;
  auth: string;
  schedule: Localized;
  volume: Localized;
  sla: string;
  idempotency: string;
  errorCodes: string;
  controlTotals: Localized;
}

export interface IntegrationSystem {
  id: string;
  tz: string;
  kind: IntegrationKind;
  name: Localized;
  purpose: Localized;
  hosts: string;
  modules: string[];
  passport: IntegrationPassport;
  operations: IntegrationOperation[];
  /** Диапазон задержки ответа, мс. */
  latency: [number, number];
  /** P4-GEN (PR-GEN-020): политика повторов системы (конструктор интеграций); иначе — общая настройка шины. */
  retry?: { maxAttempts: number; backoffMs: number };
  /** P4-GEN: интеграция отключена администратором — вызовы отклоняются. */
  disabled?: boolean;
}

export interface ExchangeAttempt {
  n: number;
  at: string;
  ok: boolean;
  ms: number;
  error?: IntegrationErrorCode;
}

export interface ExchangeRecord {
  id: ID;
  systemId: string;
  operation: string;
  direction: ExchangeDirection;
  schemaVersion: string;
  idempotencyKey: string;
  payloadHash: string;
  payload: Payload;
  response?: Payload;
  status: ExchangeStatus;
  attempts: ExchangeAttempt[];
  createdAt: string;
  updatedAt: string;
  userId?: ID;
  error?: IntegrationErrorCode;
  errorMessage?: string;
  amount?: number;
  count?: number;
  /** Сколько раз этот же запрос (тот же ключ) был отправлен повторно и отсечён идемпотентностью. */
  duplicates: number;
  /** Причина снятия с карантина/отказа. */
  note?: string;
}

export interface SystemState {
  id: string;
  up: boolean;
  /** Вероятность случайного сбоя попытки (0..1). */
  failureRate: number;
  changedAt: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
}

export interface SystemSummary extends SystemState {
  total: number;
  success: number;
  failed: number;
  queued: number;
  quarantined: number;
  avgMs: number;
  successRate: number;
}

export interface ReconciliationRow {
  systemId: string;
  operation: string;
  sent: number;
  sentAmount: number;
  confirmed: number;
  confirmedAmount: number;
  rejected: number;
  inQueue: number;
  diffCount: number;
  diffAmount: number;
  ok: boolean;
}

export class IntegrationUnavailableError extends Error {
  constructor(public systemId: string) {
    super(`Integration system unavailable: ${systemId}`);
  }
}

// ---------- Справочник систем (ТЗ 5.1–5.2) ----------

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const req = (p: Payload, keys: string[]) => {
  const miss = keys.filter((k) => p[k] === undefined || p[k] === null || p[k] === '');
  return miss.length ? { code: 'validation' as const, message: `Missing: ${miss.join(', ')}` } : null;
};
const tin = (p: Payload, k = 'tin') => (/^\d{9}$/.test(String(p[k] ?? '')) ? null : { code: 'validation' as const, message: `${k}: 9 digits expected` });
const num = (p: Payload, k: string) => (typeof p[k] === 'number' ? (p[k] as number) : Number(p[k] ?? 0));
const ack = (p: Payload, extra: Payload = {}) => ({ accepted: true, externalId: `EXT-${Math.abs(hashCode(JSON.stringify(p))) % 1_000_000}`, ...extra });
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

const passport = (p: Partial<IntegrationPassport> & Pick<IntegrationPassport, 'target' | 'endpoint' | 'protocol' | 'owner'>): IntegrationPassport => ({
  source: 'XB-ERP',
  format: p.protocol === 'SOAP/XML' ? 'XML (XSD v1), UTF-8' : 'JSON (OpenAPI v1), UTF-8, ISO 8601 +05:00',
  auth: 'OAuth 2.0 client credentials, mTLS',
  schedule: L('Онлайн', 'Onlayn', 'Online'),
  volume: L('до 5 000 сообщений/сутки', 'kuniga 5 000 tagacha xabar', 'up to 5,000 messages/day'),
  sla: '99.5%, ≤ 3 s',
  idempotency: 'Idempotency-Key (UUID) в заголовке',
  errorCodes: 'timeout, http_500, http_503, validation, control_total_mismatch, idempotency_conflict',
  controlTotals: L('Количество и сумма за сутки', 'Kunlik soni va summasi', 'Daily count and amount'),
  ...p,
});

export const INTEGRATION_SYSTEMS: IntegrationSystem[] = [
  {
    id: 'soliq', tz: '5.1.1', kind: 'external', hosts: 'my3.soliq.uz, e-faktura, soliqservis, didox.uz, ijara.soliq.uz',
    name: L('Налоговый комитет', 'Soliq qo‘mitasi', 'Tax Committee'),
    purpose: L('ЭСФ, акты, договоры аренды, письма, отчёты по НДФЛ и ЕСП', 'EHF, dalolatnomalar, ijara shartnomalari, xatlar, JShDS va IST hisobotlari', 'E-invoices, acts, lease contracts, letters, PIT/social tax reports'),
    modules: ['einvoices', 'taxes', 'contracts'], latency: [180, 650],
    passport: passport({ target: 'Soliq (e-faktura)', endpoint: 'https://api.soliq.example/v1', protocol: 'REST/JSON', owner: L('Налоговый комитет', 'Soliq qo‘mitasi', 'Tax Committee'), auth: 'E-IMZO (ЭЦП организации) + OAuth 2.0' }),
    operations: [
      { id: 'einvoice.send', direction: 'out', schemaVersion: '1.2', name: L('Отправка ЭСФ', 'EHF yuborish', 'Send e-invoice'),
        sample: () => ({ number: 'XB-ESF-2026-0401', tin: '301112223', date: '2026-10-18', amount: 18_400_000, vat: 2_208_000 }),
        validate: (p) => req(p, ['number', 'tin', 'amount']) ?? tin(p), amount: (p) => num(p, 'amount'), respond: (p) => ack(p, { status: 'delivered', acceptedAmount: num(p, 'amount') }) },
      { id: 'einvoice.receive', direction: 'in', schemaVersion: '1.2', name: L('Приём входящих ЭСФ', 'Kiruvchi EHF qabul qilish', 'Receive incoming e-invoices'),
        sample: () => ({ since: '2026-10-17T00:00:00+05:00' }), respond: (_p, r) => ({ documents: Math.floor(r() * 6) + 1 }), count: () => 1 },
      { id: 'act.receive', direction: 'in', schemaVersion: '1.0', name: L('Автоприём актов выполненных работ', 'Bajarilgan ishlar dalolatnomalarini qabul qilish', 'Receive work-completion acts'),
        sample: () => ({ since: '2026-10-17T00:00:00+05:00' }), respond: (_p, r) => ({ documents: Math.floor(r() * 4) }) },
      { id: 'lease.register', direction: 'out', schemaVersion: '1.0', name: L('Регистрация договора аренды', 'Ijara shartnomasini ro‘yxatdan o‘tkazish', 'Register lease contract'),
        sample: () => ({ contract: 'DG-2026-0077', tin: '302223334', amount: 45_000_000 }), validate: (p) => req(p, ['contract', 'tin']) ?? tin(p), amount: (p) => num(p, 'amount'), respond: (p) => ack(p, { acceptedAmount: num(p, 'amount') }) },
    ],
  },
  {
    id: 'uzex', tz: '5.1.2', kind: 'external', hosts: 'uzex.uz, xarid.uzex.uz, cooperation.uz',
    name: L('Товарно-сырьевая биржа (УзРТСБ)', 'Tovar-xomashyo birjasi (O‘zRTXB)', 'Commodity Exchange (UzRTSB)'),
    purpose: L('Биржевые закупки: заявки, результаты торгов, цены, договоры', 'Birja xaridlari: arizalar, savdo natijalari, narxlar, shartnomalar', 'Exchange procurement: bids, results, prices, contracts'),
    modules: ['procurement', 'contracts'], latency: [250, 900],
    passport: passport({ target: 'UzEx', endpoint: 'https://api.uzex.example/v2', protocol: 'REST/JSON', owner: L('АО «УзРТСБ»', '“O‘zRTXB” AJ', 'UzRTSB JSC') }),
    operations: [
      { id: 'bid.submit', direction: 'out', schemaVersion: '2.0', name: L('Направить заявку на торги', 'Savdoga ariza yuborish', 'Submit bid'),
        sample: () => ({ request: 'ZK-2026-0141', lot: 'Ноутбуки 25 шт.', amount: 375_000_000 }), validate: (p) => req(p, ['request', 'amount']), amount: (p) => num(p, 'amount'), respond: (p) => ack(p, { lotNo: 'L-' + String(Math.abs(hashCode(String(p.request))) % 99999), acceptedAmount: num(p, 'amount') }) },
      { id: 'results.get', direction: 'in', schemaVersion: '2.0', name: L('Получить результаты торгов', 'Savdo natijalarini olish', 'Get auction results'),
        sample: () => ({ lotNo: 'L-10442' }), validate: (p) => req(p, ['lotNo']), respond: (_p, r) => ({ winnerTin: '30' + String(Math.floor(r() * 1e7)).padStart(7, '0'), price: Math.round(300_000_000 + r() * 60_000_000) }) },
      { id: 'prices.get', direction: 'in', schemaVersion: '2.0', name: L('Сведения о ценах', 'Narxlar to‘g‘risida ma’lumot', 'Price information'), sample: () => ({ category: 'IT' }), respond: (_p, r) => ({ items: Math.floor(r() * 50) + 10 }) },
    ],
  },
  {
    id: 'etender', tz: '5.1.3', kind: 'external', hosts: 'etender.uzex.uz',
    name: L('Тендерные платформы (госзакупки)', 'Tender platformalari (davlat xaridlari)', 'Tender platforms (public procurement)'),
    purpose: L('Тендерная документация, объявление, результаты, договоры', 'Tender hujjatlari, e’lon, natijalar, shartnomalar', 'Tender documents, announcement, results, contracts'),
    modules: ['procurement'], latency: [300, 1000],
    passport: passport({ target: 'eTender', endpoint: 'https://etender.example/api/v1', protocol: 'REST/JSON', owner: L('АО «УзРТСБ»', '“O‘zRTXB” AJ', 'UzRTSB JSC') }),
    operations: [
      { id: 'tender.announce', direction: 'out', schemaVersion: '1.0', name: L('Объявить тендер', 'Tender e’lon qilish', 'Announce tender'),
        sample: () => ({ tender: 'TN-2026-0012', deadline: '2026-11-15', amount: 1_250_000_000 }), validate: (p) => req(p, ['tender', 'deadline']), amount: (p) => num(p, 'amount'), respond: (p) => ack(p, { acceptedAmount: num(p, 'amount') }) },
      { id: 'tender.results', direction: 'in', schemaVersion: '1.0', name: L('Результаты тендера', 'Tender natijalari', 'Tender results'), sample: () => ({ tender: 'TN-2026-0012' }), respond: (_p, r) => ({ bids: Math.floor(r() * 7) + 2 }) },
    ],
  },
  {
    id: 'kadastr', tz: '5.1.4', kind: 'external', hosts: 'davreestr.kadastr.uz',
    name: L('Агентство по кадастру', 'Kadastr agentligi', 'Cadastre Agency'),
    purpose: L('Сведения об объектах недвижимости', 'Ko‘chmas mulk obyektlari to‘g‘risidagi ma’lumotlar', 'Real estate records'),
    modules: ['assets'], latency: [200, 700],
    passport: passport({ target: 'Davreestr', endpoint: 'https://api.kadastr.example/v1', protocol: 'SOAP/XML', owner: L('Агентство по кадастру', 'Kadastr agentligi', 'Cadastre Agency') }),
    operations: [
      { id: 'object.get', direction: 'in', schemaVersion: '1.0', name: L('Запрос сведений об объекте', 'Obyekt ma’lumotlarini so‘rash', 'Get property record'),
        sample: () => ({ cadastralNo: '10:01:02:03:04:0055' }), validate: (p) => req(p, ['cadastralNo']), respond: (_p, r) => ({ area: Math.round(200 + r() * 800), encumbrance: r() > 0.8 }) },
    ],
  },
  {
    id: 'uzsuv', tz: '5.1.5', kind: 'external', hosts: 'uzsuv.uz',
    name: L('«Узсувтаъминот»', '“O‘zsuvta’minot”', 'Uzsuvtaminot'),
    purpose: L('Тарифы на водоснабжение и водоотведение, объём потребления', 'Suv ta’minoti tariflari va iste’mol hajmi', 'Water tariffs and consumption'),
    modules: ['assets', 'budgeting'], latency: [250, 800],
    passport: passport({ target: 'Uzsuv', endpoint: 'https://api.uzsuv.example/v1', protocol: 'REST/JSON', owner: L('АО «Узсувтаъминот»', '“O‘zsuvta’minot” AJ', 'Uzsuvtaminot JSC'), schedule: L('Ежедневно 02:00', 'Har kuni 02:00', 'Daily 02:00') }),
    operations: [
      { id: 'consumption.get', direction: 'in', schemaVersion: '1.0', name: L('Объём потреблённой воды', 'Iste’mol qilingan suv hajmi', 'Water consumption'),
        sample: () => ({ account: 'W-0012345', period: '2026-09' }), validate: (p) => req(p, ['account', 'period']), respond: (_p, r) => ({ m3: Math.round(80 + r() * 300), tariff: 2_850 }) },
    ],
  },
  {
    id: 'eimzo', tz: '5.1.6', kind: 'external', hosts: 'e-imzo.soliq.uz',
    name: L('E-IMZO — электронная подпись', 'E-IMZO — elektron imzo', 'E-IMZO — e-signature'),
    purpose: L('Подписание документов, метка времени, проверка сертификатов', 'Hujjatlarni imzolash, vaqt tamg‘asi, sertifikatlarni tekshirish', 'Document signing, timestamp, certificate check'),
    modules: ['einvoices', 'contracts', 'documents'], latency: [120, 400],
    passport: passport({ target: 'E-IMZO / TSA', endpoint: 'https://e-imzo.example/api', protocol: 'REST/JSON', owner: L('ГУП «Центр электронной цифровой подписи»', 'ERI markazi DUK', 'Digital Signature Center'), sla: '99.9%, ≤ 1 s' }),
    operations: [
      { id: 'timestamp', direction: 'out', schemaVersion: '1.0', name: L('Метка времени (TSA)', 'Vaqt tamg‘asi (TSA)', 'Timestamp (TSA)'),
        sample: () => ({ hash: sha256Hex('demo') }), validate: (p) => (/^[0-9a-f]{64}$/.test(String(p.hash ?? '')) ? null : { code: 'validation', message: 'hash: sha256 hex expected' }),
        respond: (p) => ({ tsa: 'TSA-DEMO-01', serial: String(Math.abs(hashCode(String(p.hash))) % 1e9), time: new Date().toISOString() }) },
      { id: 'cert.verify', direction: 'out', schemaVersion: '1.0', name: L('Проверка сертификата (OCSP)', 'Sertifikatni tekshirish (OCSP)', 'Certificate check (OCSP)'),
        sample: () => ({ serial: '7A3F21C90B44' }), validate: (p) => req(p, ['serial']), respond: () => ({ status: 'good' }) },
    ],
  },
  {
    id: 'oneid', tz: '5.1.7', kind: 'external', hosts: 'id.egov.uz',
    name: L('OneID', 'OneID', 'OneID'), purpose: L('Аутентификация и верификация пользователей', 'Foydalanuvchilarni autentifikatsiya va verifikatsiya qilish', 'User authentication and verification'),
    modules: ['core'], latency: [150, 500],
    passport: passport({ target: 'OneID', endpoint: 'https://id.egov.example/oauth', protocol: 'REST/JSON', owner: L('Мининфоком (ЕПИГУ)', 'Axborot texnologiyalari vazirligi', 'Ministry of Digital Technologies'), auth: 'OAuth 2.0 / OpenID Connect' }),
    operations: [
      { id: 'user.verify', direction: 'out', schemaVersion: '1.0', name: L('Верификация пользователя', 'Foydalanuvchini tekshirish', 'Verify user'),
        sample: () => ({ pinfl: '30101900000000' }), validate: (p) => (/^\d{14}$/.test(String(p.pinfl ?? '')) ? null : { code: 'validation', message: 'pinfl: 14 digits expected' }), respond: () => ({ verified: true }) },
    ],
  },
  {
    id: 'ubdd', tz: '5.1.8', kind: 'external', hosts: 'yhxx.uz, ejarima.uz, saferoad',
    name: L('УБДД', 'YHXB', 'Traffic Police (UBDD)'), purpose: L('Штрафы и запреты по автотранспорту', 'Avtotransport bo‘yicha jarimalar va taqiqlar', 'Vehicle fines and restrictions'),
    modules: ['fleet'], latency: [200, 700],
    passport: passport({ target: 'UBDD', endpoint: 'https://api.yhxx.example/v1', protocol: 'REST/JSON', owner: L('МВД, УБДД', 'IIV, YHXB', 'Ministry of Interior'), schedule: L('Ежедневно 06:00', 'Har kuni 06:00', 'Daily 06:00') }),
    operations: [
      { id: 'fines.get', direction: 'in', schemaVersion: '1.0', name: L('Проверка штрафов', 'Jarimalarni tekshirish', 'Check fines'),
        sample: () => ({ plate: '01A123BC' }), validate: (p) => req(p, ['plate']),
        // Ответ УБДД детерминирован по госномеру: постановления (номер, дата, нарушение, сумма, признак оплаты) не меняются между запросами.
        respond: (p) => {
          const plate = String(p.plate ?? '');
          let h = 7;
          for (const ch of plate) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          const kinds: [string, number][] = [['Превышение скорости до 20 км/ч', 375_000], ['Нарушение правил остановки и стоянки', 225_000], ['Непристёгнутый ремень безопасности', 150_000], ['Проезд на запрещающий сигнал светофора', 1_125_000]];
          let st = h;
          const rnd = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 2 ** 32);
          const n = Math.floor(rnd() * 3);
          return {
            fines: Array.from({ length: n }, () => {
              const k = kinds[Math.floor(rnd() * kinds.length)]!;
              const date = new Date(Date.now() - (2 + Math.floor(rnd() * 25)) * 86_400_000).toISOString().slice(0, 10);
              return { protocolNo: `UB ${date.slice(0, 4)} ${1000 + Math.floor(rnd() * 9000)} ${1000 + Math.floor(rnd() * 9000)}`, date, violation: k[0], amount: k[1], paid: rnd() < 0.3 };
            }),
          };
        } },
    ],
  },
  {
    id: 'mysud', tz: '5.1.9', kind: 'external', hosts: 'mib.uz, my.sud.uz',
    name: L('MY.SUD и МИБ', 'MY.SUD va MIB', 'MY.SUD & Enforcement Bureau'), purpose: L('Исполнительные документы, судебные решения, задолженности', 'Ijro hujjatlari, sud qarorlari, qarzdorlik', 'Writs, court decisions, debts'),
    modules: ['contracts', 'documents'], latency: [300, 900],
    passport: passport({ target: 'MIB / MY.SUD', endpoint: 'https://api.mib.example/v1', protocol: 'SOAP/XML', owner: L('Бюро принудительного исполнения', 'Majburiy ijro byurosi', 'Enforcement Bureau') }),
    operations: [
      { id: 'debts.check', direction: 'in', schemaVersion: '1.0', name: L('Проверка задолженностей', 'Qarzdorlikni tekshirish', 'Check debts'),
        sample: () => ({ tin: '301112223' }), validate: (p) => tin(p), respond: (_p, r) => ({ writs: r() > 0.85 ? 1 : 0 }) },
    ],
  },
  {
    id: 'mygov', tz: '5.1.10', kind: 'external', hosts: 'my.gov.uz',
    name: L('ЕПИГУ (my.gov.uz)', 'YIDXP (my.gov.uz)', 'Public Services Portal'), purpose: L('Обмен с базами электронного правительства', 'Elektron hukumat bazalari bilan almashinuv', 'E-government data exchange'),
    modules: ['core'], latency: [250, 800],
    passport: passport({ target: 'my.gov.uz', endpoint: 'https://api.my.gov.example/v1', protocol: 'REST/JSON', owner: L('Мининфоком', 'Axborot texnologiyalari vazirligi', 'Ministry of Digital Technologies') }),
    operations: [
      { id: 'company.get', direction: 'in', schemaVersion: '1.0', name: L('Сведения о юрлице', 'Yuridik shaxs ma’lumotlari', 'Company record'), sample: () => ({ tin: '301112223' }), validate: (p) => tin(p), respond: () => ({ active: true }) },
    ],
  },
  {
    id: 'eauksion', tz: '5.1.11', kind: 'external', hosts: 'e-auksion.uz',
    name: L('E-auksion', 'E-auksion', 'E-auction'), purpose: L('Продажа имущества на аукционе: лоты и результаты', 'Mol-mulkni auksionda sotish: lotlar va natijalar', 'Asset auctions: lots and results'),
    modules: ['assets'], latency: [250, 800],
    passport: passport({ target: 'E-auksion', endpoint: 'https://api.e-auksion.example/v1', protocol: 'REST/JSON', owner: L('Госкомконкуренции', 'Raqobat qo‘mitasi', 'Competition Committee') }),
    operations: [
      { id: 'lot.publish', direction: 'out', schemaVersion: '1.0', name: L('Выставить лот', 'Lot joylashtirish', 'Publish lot'),
        sample: () => ({ asset: 'OS-000215', startPrice: 85_000_000 }), validate: (p) => req(p, ['asset', 'startPrice']), amount: (p) => num(p, 'startPrice'), respond: (p) => ack(p, { acceptedAmount: num(p, 'startPrice') }) },
    ],
  },
  {
    id: 'shaffof', tz: '5.1.12', kind: 'external', hosts: 'shaffofxarid.uz, dshk.shaffofqurilish.uz',
    name: L('«Прозрачное строительство»', '“Shaffof qurilish”', 'Transparent Construction'), purpose: L('Закупки в строительстве, экспертиза ПСД, лоты', 'Qurilish xaridlari, LSH ekspertizasi, lotlar', 'Construction procurement, design review, lots'),
    modules: ['procurement'], latency: [300, 900],
    passport: passport({ target: 'Shaffof qurilish', endpoint: 'https://api.shaffof.example/v1', protocol: 'REST/JSON', owner: L('Минстрой', 'Qurilish vazirligi', 'Ministry of Construction') }),
    operations: [
      { id: 'lot.sync', direction: 'in', schemaVersion: '1.0', name: L('Синхронизация лотов', 'Lotlarni sinxronlash', 'Sync lots'), sample: () => ({ since: '2026-10-01' }), respond: (_p, r) => ({ lots: Math.floor(r() * 10) }) },
    ],
  },
  {
    id: 'payments', tz: '5.1.13', kind: 'external', hosts: 'Uzcard, Humo, коммунальные службы, банки',
    name: L('Платёжные системы и поставщики', 'To‘lov tizimlari va yetkazib beruvchilar', 'Payment systems and utilities'), purpose: L('Uzcard, Humo, коммунальные платежи, другие банки', 'Uzcard, Humo, kommunal to‘lovlar, boshqa banklar', 'Uzcard, Humo, utility payments, other banks'),
    modules: ['cash', 'terminals'], latency: [150, 500],
    passport: passport({ target: 'Uzcard / Humo', endpoint: 'https://api.payments.example/v1', protocol: 'REST/JSON', owner: L('Процессинговые центры', 'Protsessing markazlari', 'Processing centers') }),
    operations: [
      { id: 'utility.pay', direction: 'out', schemaVersion: '1.0', name: L('Оплата коммунальных услуг', 'Kommunal xizmatlar uchun to‘lov', 'Pay utility bill'),
        sample: () => ({ provider: 'Hududgaz', account: 'G-778812', amount: 4_350_000 }), validate: (p) => req(p, ['provider', 'account', 'amount']), amount: (p) => num(p, 'amount'), respond: (p) => ack(p, { acceptedAmount: num(p, 'amount') }) },
    ],
  },
  // ---------- Внутренние системы банка (5.2) ----------
  {
    id: 'iabs', tz: '5.2.1', kind: 'internal', hosts: 'iABS (Core Banking)',
    name: L('iABS / ABS (Core Banking)', 'iABS / ABS (Core Banking)', 'iABS / ABS (Core Banking)'),
    purpose: L('Проводки по ТМЗ, ОС, амортизации, кадрам, автопарку, командировкам; платёжные документы', 'TMZ, AV, amortizatsiya, kadrlar, avtopark, safarlar bo‘yicha provodkalar; to‘lov hujjatlari', 'Postings (inventory, fixed assets, HR, fleet, trips); payment orders'),
    modules: ['warehouse', 'assets', 'fleet', 'trips', 'contracts', 'cash'], latency: [150, 600],
    passport: passport({ target: 'iABS', endpoint: 'https://iabs.bank.local/erp-gw/v1', protocol: 'REST/JSON', owner: L('Департамент бухгалтерского учёта', 'Buxgalteriya hisobi departamenti', 'Accounting Department'), auth: 'mTLS + сервисная учётная запись erp-svc', volume: L('до 50 000 проводок/сутки', 'kuniga 50 000 tagacha provodka', 'up to 50,000 postings/day'), controlTotals: L('Пакет: число проводок и сумма; сверка за операционный день', 'Paket: provodkalar soni va summasi; operatsion kun bo‘yicha solishtirish', 'Batch: count and amount; daily reconciliation') }),
    operations: [
      { id: 'postings.batch', direction: 'out', schemaVersion: '1.3', name: L('Пакет бухгалтерских проводок', 'Buxgalteriya provodkalari paketi', 'Accounting postings batch'),
        sample: () => ({ batch: 'PK-2026-1018-01', entries: [{ debit: '16310000', credit: '10501000', amount: 12_500_000 }, { debit: '56802000', credit: '16310000', amount: 1_250_000 }], controlSum: 13_750_000 }),
        validate: (p) => {
          const entries = Array.isArray(p.entries) ? (p.entries as Payload[]) : [];
          if (!entries.length) return { code: 'validation', message: 'entries: empty batch' };
          if (entries.some((e) => !(num(e, 'amount') > 0) || !/^\d{8}$/.test(String(e.debit ?? '')) || !/^\d{8}$/.test(String(e.credit ?? '')))) return { code: 'validation', message: 'entries: account (8 digits) and amount > 0 required' };
          const sum = entries.reduce((s, e) => s + num(e, 'amount'), 0);
          return sum === num(p, 'controlSum') ? null : { code: 'control_total_mismatch', message: `controlSum ${num(p, 'controlSum')} ≠ Σ ${sum}` };
        },
        amount: (p) => num(p, 'controlSum'), count: (p) => (Array.isArray(p.entries) ? p.entries.length : 0),
        respond: (p) => ack(p, { posted: Array.isArray(p.entries) ? p.entries.length : 0, acceptedAmount: num(p, 'controlSum') }) },
      { id: 'payment.send', direction: 'out', schemaVersion: '1.3', name: L('Платёжное поручение', 'To‘lov topshiriqnomasi', 'Payment order'),
        sample: () => ({ doc: 'PP-2026-0911', account: '20208000900100001010', mfo: '00873', amount: 49_500_000, purpose: 'Оплата по договору DG-2026-0045' }),
        validate: (p) => req(p, ['doc', 'account', 'mfo', 'amount']) ?? (/^\d{20}$/.test(String(p.account)) && /^\d{5}$/.test(String(p.mfo)) && num(p, 'amount') > 0 ? null : { code: 'validation', message: 'account 20 digits, MFO 5 digits, amount > 0' }),
        amount: (p) => num(p, 'amount'), respond: (p) => ack(p, { acceptedAmount: num(p, 'amount') }) },
      { id: 'masterdata.employees', direction: 'in', schemaVersion: '1.0', name: L('Сотрудники и оргструктура', 'Xodimlar va tashkiliy tuzilma', 'Employees and org structure'), sample: () => ({ since: '2026-10-01' }), respond: (_p, r) => ({ changed: Math.floor(r() * 20) }) },
    ],
  },
  {
    id: 'acms', tz: '5.2.2', kind: 'internal', hosts: 'ACMS',
    name: L('ACMS (контроль доступа)', 'ACMS (kirishni nazorat qilish)', 'ACMS (access control)'), purpose: L('Данные о рабочем времени', 'Ish vaqti ma’lumotlari', 'Working time data'),
    modules: ['requests', 'trips'], latency: [100, 400],
    passport: passport({ target: 'ACMS', endpoint: 'https://acms.bank.local/api', protocol: 'REST/JSON', owner: L('Служба безопасности', 'Xavfsizlik xizmati', 'Security Service'), schedule: L('Ежедневно 23:30', 'Har kuni 23:30', 'Daily 23:30') }),
    operations: [{ id: 'timesheet.get', direction: 'in', schemaVersion: '1.0', name: L('Табель рабочего времени', 'Ish vaqti tabeli', 'Timesheet'), sample: () => ({ date: '2026-10-17' }), respond: (_p, r) => ({ records: Math.floor(800 + r() * 300) }) }],
  },
  {
    id: 'laborlaw', tz: '5.2.3', kind: 'internal', hosts: 'Laborlaw (HR & Payroll)',
    name: L('Laborlaw (HR)', 'Laborlaw (HR)', 'Laborlaw (HR)'), purpose: L('Сотрудники, должности, оргструктура; события приёма/перевода/увольнения', 'Xodimlar, lavozimlar, tuzilma; qabul/o‘tkazish/bo‘shatish voqealari', 'Employees, positions, structure; HR events'),
    modules: ['core', 'trips', 'requests'], latency: [120, 450],
    passport: passport({ target: 'Laborlaw', endpoint: 'https://hr.bank.local/api/v1', protocol: 'REST/JSON', owner: L('Департамент персонала', 'Xodimlar departamenti', 'HR Department') }),
    operations: [{ id: 'hr.events', direction: 'in', schemaVersion: '1.0', name: L('Кадровые события', 'Kadrlar voqealari', 'HR events'), sample: () => ({ since: '2026-10-17T00:00:00+05:00' }), respond: (_p, r) => ({ hired: Math.floor(r() * 3), moved: Math.floor(r() * 3), dismissed: Math.floor(r() * 2) }) }],
  },
  {
    id: 'khd', tz: '5.2.3', kind: 'internal', hosts: 'КХД (корпоративное хранилище)',
    name: L('КХД — результаты FTP', 'KXO — FTP natijalari', 'Corporate DWH — FTP results'), purpose: L('Готовые результаты FTP по кредитам и депозитам (без пересчёта в XB-ERP)', 'Kredit va depozitlar bo‘yicha tayyor FTP natijalari', 'Ready FTP results for loans and deposits'),
    modules: ['ftp'], latency: [300, 900],
    passport: passport({ target: 'КХД', endpoint: 'sftp://khd.bank.local/ftp-out', protocol: 'SFTP/ETL', owner: L('Казначейство', 'G‘aznachilik', 'Treasury'), schedule: L('Ежемесячно, 3-й рабочий день', 'Har oy, 3-ish kuni', 'Monthly, 3rd business day') }),
    operations: [{ id: 'ftp.results', direction: 'in', schemaVersion: '1.1', name: L('Загрузка результатов FTP', 'FTP natijalarini yuklash', 'Load FTP results'), sample: () => ({ period: '2026-09' }), validate: (p) => req(p, ['period']), respond: (_p, r) => ({ rows: Math.floor(1000 + r() * 500), controlSum: 1 }) }],
  },
  {
    id: 'cashsys', tz: '5.2.4', kind: 'internal', hosts: 'OptiLoad, процессинг, Service Desk',
    name: L('Системы НДО и кассовой инфраструктуры', 'NPA va kassa infratuzilmasi tizimlari', 'Cash circulation systems'), purpose: L('Остатки и движение наличных, устройства, инкассация, сервисные события', 'Naqd pul qoldiqlari va harakati, qurilmalar, inkassatsiya', 'Cash balances, devices, collection, service events'),
    modules: ['cash', 'terminals', 'operations'], latency: [150, 500],
    passport: passport({ target: 'OptiLoad / Processing', endpoint: 'https://cash.bank.local/api', protocol: 'REST/JSON + ETL', owner: L('Департамент НДО', 'NPA departamenti', 'Cash Department'), controlTotals: L('Остатки по объектам и валютам на конец дня', 'Kun oxiridagi qoldiqlar', 'End-of-day balances') }),
    operations: [{ id: 'balances.get', direction: 'in', schemaVersion: '1.0', name: L('Остатки наличных', 'Naqd pul qoldiqlari', 'Cash balances'), sample: () => ({ date: '2026-10-17' }), respond: (_p, r) => ({ objects: Math.floor(500 + r() * 100) }) }],
  },
  {
    id: 'dwh', tz: '5.2.5', kind: 'internal', hosts: 'DWH / BI',
    name: L('DWH (хранилище данных)', 'DWH (ma’lumotlar ombori)', 'DWH (data warehouse)'), purpose: L('Витрины данных для отчётности, обмен с моделями ИИ (5.3)', 'Hisobot uchun ma’lumotlar vitrinalari, AI modellari bilan almashinuv', 'Data marts for reporting, AI models exchange'),
    modules: ['reporting', 'operations', 'ai'], latency: [400, 1200],
    passport: passport({ target: 'DWH', endpoint: 'sftp://dwh.bank.local/marts', protocol: 'SFTP/ETL', owner: L('Департамент данных', 'Ma’lumotlar departamenti', 'Data Department'), schedule: L('Ежедневно 01:00', 'Har kuni 01:00', 'Daily 01:00') }),
    operations: [
      { id: 'mart.publish', direction: 'out', schemaVersion: '1.0', name: L('Публикация витрины', 'Vitrinani nashr qilish', 'Publish data mart'),
        sample: () => ({ mart: 'budget_execution', rows: 1240, controlSum: 98_450_000_000 }), validate: (p) => req(p, ['mart', 'rows']), amount: (p) => num(p, 'controlSum'), count: (p) => num(p, 'rows'), respond: (p) => ack(p, { acceptedAmount: num(p, 'controlSum') }) },
    ],
  },
];

// ---------- Состояние шины ----------

const states = new Map<string, SystemState>();
const records: ExchangeRecord[] = [];
const queue: ID[] = [];
const config = { timeScale: 1, maxAttempts: 3, backoffMs: 400 };
let rnd = seededRandom(20261018);

function nowIso() {
  return new Date().toISOString();
}

function sys(id: string): IntegrationSystem {
  const s = INTEGRATION_SYSTEMS.find((x) => x.id === id);
  if (!s) throw apiError('UNKNOWN_SYSTEM', id);
  return s;
}

function state(id: string): SystemState {
  let st = states.get(id);
  if (!st) {
    st = { id, up: true, failureRate: 0.03, changedAt: nowIso() };
    states.set(id, st);
  }
  return st;
}

function op(system: IntegrationSystem, operation: string): IntegrationOperation | undefined {
  return system.operations.find((o) => o.id === operation);
}

function newKey(): string {
  const h = sha256Hex(`${Date.now()}-${rnd()}-${records.length}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function stablePayload(p: Payload): string {
  return JSON.stringify(p, Object.keys(p).sort());
}

/** Выполнить попытки отправки записи (с повторами и экспоненциальной паузой). */
async function deliver(rec: ExchangeRecord, simulate: ExchangeSimulation, maxAttempts: number): Promise<void> {
  const system = sys(rec.systemId);
  const operation = op(system, rec.operation)!;
  const st = state(rec.systemId);
  for (let n = 1; n <= maxAttempts; n++) {
    if (!st.up) {
      // Система упала во время повторов — запрос уходит в очередь.
      rec.status = 'queued';
      rec.error = 'unavailable';
      if (!queue.includes(rec.id)) queue.push(rec.id);
      rec.updatedAt = nowIso();
      emit();
      return;
    }
    const [lo, hi] = system.latency;
    const ms = Math.round(lo + rnd() * (hi - lo));
    await sleep(ms * config.timeScale);
    const fail = simulate === 'permanent' || (simulate === 'transient' && n === 1) || (simulate === 'normal' && rnd() < st.failureRate);
    const attemptNo = rec.attempts.length + 1;
    if (fail) {
      const error: IntegrationErrorCode = simulate === 'permanent' ? 'http_500' : rnd() < 0.5 ? 'timeout' : 'http_503';
      rec.attempts.push({ n: attemptNo, at: nowIso(), ok: false, ms, error });
      rec.error = error;
      st.lastErrorAt = nowIso();
      rec.updatedAt = nowIso();
      emit();
      if (n < maxAttempts) await sleep((system.retry?.backoffMs ?? config.backoffMs) * 2 ** (n - 1) * config.timeScale);
      continue;
    }
    rec.attempts.push({ n: attemptNo, at: nowIso(), ok: true, ms });
    rec.response = operation.respond(rec.payload, rnd);
    rec.status = 'success';
    delete rec.error;
    delete rec.errorMessage;
    rec.updatedAt = nowIso();
    st.lastSuccessAt = rec.updatedAt;
    serviceAudit({ userId: rec.userId ?? 'system', action: 'integration.call', entity: rec.systemId, entityId: rec.id, details: `${rec.operation} → success (${rec.attempts.length})` });
    emit();
    return;
  }
  rec.status = 'failed';
  rec.updatedAt = nowIso();
  serviceAudit({ userId: rec.userId ?? 'system', action: 'integration.call', entity: rec.systemId, entityId: rec.id, details: `${rec.operation} → failed: ${rec.error}` });
  emit();
}

let replaying = false;
/** Повторная отправка накопленной очереди (после восстановления системы). */
async function replayQueue(): Promise<void> {
  if (replaying) return;
  replaying = true;
  try {
    for (;;) {
      const nextId = queue.find((id) => {
        const r = records.find((x) => x.id === id);
        return r && state(r.systemId).up;
      });
      if (!nextId) break;
      queue.splice(queue.indexOf(nextId), 1);
      const rec = records.find((x) => x.id === nextId)!;
      if (rec.status !== 'queued') continue;
      rec.status = 'pending';
      rec.note = 'replayed';
      emit();
      await deliver(rec, 'normal', sys(rec.systemId).retry?.maxAttempts ?? config.maxAttempts);
    }
  } finally {
    replaying = false;
  }
}

export interface CallOptions {
  idempotencyKey?: string;
  userId?: ID;
  /** sync — ошибка сразу, если система недоступна (подпись, вход); async — запрос встаёт в очередь. */
  mode?: 'sync' | 'async';
  simulate?: ExchangeSimulation;
  maxAttempts?: number;
  /** Не ждать завершения доставки (запись вернётся в статусе pending). */
  background?: boolean;
}

export const integrationHub = {
  systems: INTEGRATION_SYSTEMS,

  /** Настройка имитации (для тестов): ускорение времени, число попыток, базовая пауза. */
  configure(c: Partial<typeof config> & { seed?: number }): void {
    const { seed, ...rest } = c;
    if (seed !== undefined) rnd = seededRandom(seed);
    Object.assign(config, rest);
  },

  /**
   * Вызов операции внешней/внутренней системы. Возвращает запись журнала обмена.
   * Повтор с тем же idempotencyKey и тем же содержимым не выполняет операцию повторно.
   */
  async call(systemId: string, operation: string, payload: Payload, opts: CallOptions = {}): Promise<ExchangeRecord> {
    const system = sys(systemId);
    const o = op(system, operation);
    const st = state(systemId);
    const key = opts.idempotencyKey ?? newKey();
    const payloadHash = sha256Hex(stablePayload(payload));
    const existing = records.find((r) => r.systemId === systemId && r.idempotencyKey === key && r.status !== 'discarded');
    if (existing && existing.payloadHash === payloadHash && existing.status !== 'failed') {
      existing.duplicates++;
      existing.updatedAt = nowIso();
      emit();
      return JSON.parse(JSON.stringify(existing)) as ExchangeRecord;
    }
    if (existing && existing.payloadHash === payloadHash && existing.status === 'failed') {
      return integrationHub.retry(existing.id, opts.userId);
    }
    if (system.disabled) throw new IntegrationUnavailableError(systemId); // P4-GEN: отключена в конструкторе
    if (opts.mode === 'sync' && !st.up) throw new IntegrationUnavailableError(systemId);
    const t = nowIso();
    const rec: ExchangeRecord = {
      id: nextId('ix'),
      systemId,
      operation,
      direction: o?.direction ?? 'out',
      schemaVersion: o?.schemaVersion ?? '—',
      idempotencyKey: key,
      payloadHash,
      payload: JSON.parse(JSON.stringify(payload)) as Payload,
      status: 'pending',
      attempts: [],
      createdAt: t,
      updatedAt: t,
      duplicates: 0,
      ...(opts.userId ? { userId: opts.userId } : {}),
    };
    if (o?.amount) rec.amount = o.amount(payload);
    if (o?.count) rec.count = o.count(payload);
    records.push(rec);
    // Карантин: неизвестная операция, конфликт идемпотентности, сообщение не прошло проверку.
    let bad: { code: IntegrationErrorCode; message: string } | null = null;
    if (!o) bad = { code: 'unknown_operation', message: operation };
    else if (existing) bad = { code: 'idempotency_conflict', message: `key ${key} reused with different payload` };
    else if (opts.simulate === 'invalid') bad = { code: 'validation', message: 'Schema validation failed (simulated)' };
    else bad = o.validate?.(payload) ?? null;
    if (bad) {
      rec.status = 'quarantined';
      rec.error = bad.code;
      rec.errorMessage = bad.message;
      serviceAudit({ userId: opts.userId ?? 'system', action: 'integration.quarantine', entity: systemId, entityId: rec.id, details: `${operation}: ${bad.code}` });
      emit();
      return JSON.parse(JSON.stringify(rec)) as ExchangeRecord;
    }
    if (!st.up) {
      rec.status = 'queued';
      rec.error = 'unavailable';
      queue.push(rec.id);
      emit();
      return JSON.parse(JSON.stringify(rec)) as ExchangeRecord;
    }
    emit();
    const run = deliver(rec, opts.simulate ?? 'normal', opts.maxAttempts ?? system.retry?.maxAttempts ?? config.maxAttempts);
    if (opts.background) {
      void run;
      return JSON.parse(JSON.stringify(rec)) as ExchangeRecord;
    }
    await run;
    if (opts.mode === 'sync' && rec.status !== 'success') throw new IntegrationUnavailableError(systemId);
    return JSON.parse(JSON.stringify(rec)) as ExchangeRecord;
  },

  /** Повторить неуспешный обмен (тот же ключ идемпотентности). */
  async retry(recordId: ID, userId?: ID, payload?: Payload): Promise<ExchangeRecord> {
    const rec = records.find((r) => r.id === recordId);
    if (!rec) throw apiError('EXCHANGE_RECORD_NOT_FOUND');
    if (!['failed', 'quarantined', 'queued'].includes(rec.status)) throw apiError('RECORD_CANNOT_BE_RETRIED');
    const system = sys(rec.systemId);
    const o = op(system, rec.operation);
    if (payload) {
      rec.payload = JSON.parse(JSON.stringify(payload)) as Payload;
      rec.payloadHash = sha256Hex(stablePayload(payload));
      if (o?.amount) rec.amount = o.amount(payload);
      if (o?.count) rec.count = o.count(payload);
    }
    if (rec.status === 'quarantined') {
      const bad = !o ? { code: 'unknown_operation' as const, message: rec.operation } : o.validate?.(rec.payload) ?? null;
      if (bad) {
        rec.error = bad.code;
        rec.errorMessage = bad.message;
        rec.updatedAt = nowIso();
        emit();
        return JSON.parse(JSON.stringify(rec)) as ExchangeRecord;
      }
      rec.note = 'released';
    }
    const idx = queue.indexOf(rec.id);
    if (idx >= 0) queue.splice(idx, 1);
    serviceAudit({ userId: userId ?? 'system', action: 'integration.retry', entity: rec.systemId, entityId: rec.id, details: rec.operation });
    if (!state(rec.systemId).up) {
      rec.status = 'queued';
      rec.error = 'unavailable';
      queue.push(rec.id);
      emit();
      return JSON.parse(JSON.stringify(rec)) as ExchangeRecord;
    }
    rec.status = 'pending';
    emit();
    await deliver(rec, 'normal', system.retry?.maxAttempts ?? config.maxAttempts);
    return JSON.parse(JSON.stringify(rec)) as ExchangeRecord;
  },

  /** Отклонить сообщение из карантина (не учитывается в сверке). */
  discard(recordId: ID, userId: ID, reason: string): Promise<void> {
    const rec = records.find((r) => r.id === recordId);
    if (!rec || !['quarantined', 'failed'].includes(rec.status)) throw apiError('RECORD_CANNOT_BE_DISCARDED');
    rec.status = 'discarded';
    rec.note = reason;
    rec.updatedAt = nowIso();
    serviceAudit({ userId, action: 'integration.discard', entity: rec.systemId, entityId: rec.id, details: reason });
    emit();
    return later(undefined);
  },

  /** Демо: «уронить»/поднять систему. При восстановлении очередь отправляется автоматически. */
  setSystemUp(systemId: string, up: boolean, userId?: ID): Promise<void> {
    sys(systemId);
    const st = state(systemId);
    st.up = up;
    st.changedAt = nowIso();
    serviceAudit({ userId: userId ?? 'system', action: up ? 'integration.up' : 'integration.down', entity: systemId, entityId: systemId });
    emit();
    if (up) void replayQueue();
    return later(undefined);
  },

  setFailureRate(systemId: string, rate: number): void {
    state(systemId).failureRate = Math.max(0, Math.min(1, rate));
    emit();
  },

  listSystems(): Promise<(SystemSummary & { system: IntegrationSystem })[]> {
    return later(
      INTEGRATION_SYSTEMS.map((s) => {
        const st = state(s.id);
        const mine = records.filter((r) => r.systemId === s.id);
        const done = mine.filter((r) => r.attempts.length);
        const allAttempts = done.flatMap((r) => r.attempts);
        const success = mine.filter((r) => r.status === 'success').length;
        const finished = mine.filter((r) => r.status === 'success' || r.status === 'failed').length;
        const lastOk = mine.filter((r) => r.status === 'success').reduce<string | undefined>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), undefined);
        return {
          ...st,
          ...(st.lastSuccessAt || !lastOk ? {} : { lastSuccessAt: lastOk }),
          system: s,
          total: mine.length,
          success,
          failed: mine.filter((r) => r.status === 'failed').length,
          queued: mine.filter((r) => r.status === 'queued').length,
          quarantined: mine.filter((r) => r.status === 'quarantined').length,
          avgMs: allAttempts.length ? Math.round(allAttempts.reduce((a, x) => a + x.ms, 0) / allAttempts.length) : 0,
          successRate: finished ? success / finished : 1,
        };
      }),
    );
  },

  listExchanges(filter: { systemId?: string; status?: ExchangeStatus | ''; operation?: string; query?: string; from?: string; to?: string } = {}): Promise<ExchangeRecord[]> {
    const q = filter.query?.trim().toLowerCase();
    const list = records
      .filter(
        (r) =>
          (!filter.systemId || r.systemId === filter.systemId) &&
          (!filter.status || r.status === filter.status) &&
          (!filter.operation || r.operation === filter.operation) &&
          (!filter.from || r.createdAt.slice(0, 10) >= filter.from) &&
          (!filter.to || r.createdAt.slice(0, 10) <= filter.to) &&
          (!q || r.id.toLowerCase().includes(q) || r.idempotencyKey.includes(q) || JSON.stringify(r.payload).toLowerCase().includes(q)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return later(JSON.parse(JSON.stringify(list)) as ExchangeRecord[]);
  },

  getExchange(id: ID): Promise<ExchangeRecord | undefined> {
    const r = records.find((x) => x.id === id);
    return later(r ? (JSON.parse(JSON.stringify(r)) as ExchangeRecord) : undefined);
  },

  queueLength(systemId?: string): number {
    return queue.filter((id) => !systemId || records.find((r) => r.id === id)?.systemId === systemId).length;
  },

  /**
   * Сверка контрольных итогов: отправлено нами vs подтверждено получателем (по операциям со суммой).
   * Сообщения в карантине и отклонённые не учитываются (PR-INT-004).
   */
  reconciliation(filter: { from?: string; to?: string } = {}): Promise<ReconciliationRow[]> {
    const rows = new Map<string, ReconciliationRow>();
    for (const r of records) {
      if (r.direction !== 'out' || r.amount === undefined) continue;
      const d = r.createdAt.slice(0, 10);
      if ((filter.from && d < filter.from) || (filter.to && d > filter.to)) continue;
      if (r.status === 'quarantined' || r.status === 'discarded') continue;
      const k = `${r.systemId}|${r.operation}`;
      const row = rows.get(k) ?? { systemId: r.systemId, operation: r.operation, sent: 0, sentAmount: 0, confirmed: 0, confirmedAmount: 0, rejected: 0, inQueue: 0, diffCount: 0, diffAmount: 0, ok: true };
      row.sent++;
      row.sentAmount += r.amount;
      if (r.status === 'success') {
        row.confirmed++;
        row.confirmedAmount += typeof r.response?.acceptedAmount === 'number' ? (r.response.acceptedAmount as number) : r.amount;
      } else if (r.status === 'failed') row.rejected++;
      else row.inQueue++;
      rows.set(k, row);
    }
    const out = [...rows.values()].map((row) => {
      row.diffCount = row.sent - row.confirmed;
      row.diffAmount = row.sentAmount - row.confirmedAmount;
      row.ok = row.diffCount === 0 && row.diffAmount === 0;
      return row;
    });
    return later(out.sort((a, b) => Number(a.ok) - Number(b.ok) || a.systemId.localeCompare(b.systemId)));
  },
};

// ---------- Демо-история обмена (детерминированная) ----------
(function seed() {
  const r = seededRandom(7);
  const base = Date.parse('2026-10-18T06:00:00Z');
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]!;
  const outOps = INTEGRATION_SYSTEMS.flatMap((s) => s.operations.map((o) => ({ s, o })));
  for (let i = 0; i < 56; i++) {
    const { s, o } = pick(outOps);
    const at = new Date(base - Math.floor(r() * 6 * 86_400_000)).toISOString();
    const payload = o.sample();
    const roll = r();
    const status: ExchangeStatus = roll < 0.82 ? 'success' : roll < 0.92 ? 'failed' : 'quarantined';
    const attempts: ExchangeAttempt[] = [];
    const n = status === 'success' ? (r() < 0.85 ? 1 : 2) : status === 'failed' ? 3 : 0;
    for (let k = 1; k <= n; k++) {
      const ok = status === 'success' && k === n;
      attempts.push({ n: k, at, ok, ms: Math.round(s.latency[0] + r() * (s.latency[1] - s.latency[0])), ...(ok ? {} : { error: pick<IntegrationErrorCode>(['timeout', 'http_503', 'http_500']) }) });
    }
    const rec: ExchangeRecord = {
      id: `ix${i + 1}`,
      systemId: s.id,
      operation: o.id,
      direction: o.direction,
      schemaVersion: o.schemaVersion,
      idempotencyKey: sha256Hex(`seed-${i}`).slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'),
      payloadHash: sha256Hex(stablePayload(payload)),
      payload,
      status,
      attempts,
      createdAt: at,
      updatedAt: at,
      duplicates: 0,
      userId: pick(['u3', 'u4', 'u7', 'u8']),
    };
    if (o.amount) rec.amount = o.amount(payload);
    if (o.count) rec.count = o.count(payload);
    if (status === 'success') rec.response = o.respond(payload, r);
    if (status === 'failed') rec.error = attempts[attempts.length - 1]?.error ?? 'timeout';
    if (status === 'quarantined') {
      rec.error = 'validation';
      rec.errorMessage = 'Schema validation failed';
    }
    records.push(rec);
  }
  // Пакет проводок iABS с нарушенным контрольным итогом — в карантине.
  records.push({
    id: 'ix900', systemId: 'iabs', operation: 'postings.batch', direction: 'out', schemaVersion: '1.3', idempotencyKey: '5b1f0c2e-77aa-4d0e-a1c3-0f5e2d9b7a01',
    payloadHash: '—', payload: { batch: 'PK-2026-1017-04', entries: [{ debit: '16310000', credit: '10501000', amount: 8_000_000 }, { debit: '56802000', credit: '16310000', amount: 800_000 }], controlSum: 8_900_000 },
    status: 'quarantined', attempts: [], createdAt: '2026-10-17T13:05:00Z', updatedAt: '2026-10-17T13:05:00Z', duplicates: 0, userId: 'u7', error: 'control_total_mismatch', errorMessage: 'controlSum 8900000 ≠ Σ 8800000', amount: 8_900_000, count: 2,
  });
  // Платёж, по которому получатель подтвердил другую сумму — расхождение в сверке.
  records.push({
    id: 'ix901', systemId: 'iabs', operation: 'payment.send', direction: 'out', schemaVersion: '1.3', idempotencyKey: '9c4d1e3f-0b2a-4c5d-8e7f-1a2b3c4d5e6f',
    payloadHash: '—', payload: { doc: 'PP-2026-0907', account: '20208000900100001010', mfo: '00873', amount: 12_000_000, purpose: 'Оплата по договору DG-2026-0031' },
    status: 'success', attempts: [{ n: 1, at: '2026-10-17T10:20:00Z', ok: true, ms: 310 }], createdAt: '2026-10-17T10:20:00Z', updatedAt: '2026-10-17T10:20:00Z', duplicates: 0, userId: 'u8', amount: 12_000_000,
    response: { accepted: true, externalId: 'EXT-778120', acceptedAmount: 1_200_000 },
  });
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
})();
