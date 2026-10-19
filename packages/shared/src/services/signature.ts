// Электронная подпись E-IMZO (имитация до подключения e-imzo.soliq.uz): сертификаты пользователя
// со сроками действия, PIN, хэш SHA-256 содержимого документа, метка времени TSA через интеграционную
// шину, проверка подписи (действительна / сертификат истёк / отозван / документ изменён).
// ТЗ: PR-GEN-044, PR-SEC-032…034, PR-TEC-005.
import type { ID, User } from '../types';
import { emit, nextId } from '../bus';
import { sha256Hex } from './bytes';
import { later, serviceAudit } from './hooks';
import { integrationHub } from './integrations';

export interface SignCertificate {
  serial: string;
  userId: ID;
  owner: string;
  organization: string;
  /** ИНН организации (демо). */
  tin: string;
  issuer: string;
  validFrom: string; // YYYY-MM-DD
  validTo: string; // YYYY-MM-DD
  revoked?: boolean;
}

export interface SignableDoc {
  entity: string;
  entityId: ID;
  title: string;
  /** Каноническое содержимое документа (строка или объект — объект сериализуется со стабильным порядком ключей). */
  content: unknown;
}

export interface SignatureRecord {
  id: ID;
  entity: string;
  entityId: ID;
  docTitle: string;
  userId: ID;
  certSerial: string;
  owner: string;
  organization: string;
  certValidFrom: string;
  certValidTo: string;
  /** Время подписи по метке времени TSA (ISO 8601). */
  signedAt: string;
  tsaSerial: string;
  tsaAuthority: string;
  /** SHA-256 содержимого документа на момент подписи. */
  hash: string;
  /** Значение подписи (имитация: SHA-256 от хэша, сертификата и времени). */
  value: string;
}

export type SignatureStatus = 'valid' | 'expired' | 'revoked' | 'tampered';

export interface SignatureCheck {
  status: SignatureStatus;
  checkedAt: string;
  /** Совпадает ли хэш текущего содержимого с подписанным (если содержимое передано). */
  contentMatches?: boolean;
}

export type SignErrorCode = 'pin_format' | 'pin_wrong' | 'cert_expired' | 'cert_revoked' | 'cert_not_found' | 'eimzo_unavailable';

export class SignError extends Error {
  constructor(public code: SignErrorCode) {
    super(`Signing failed: ${code}`);
  }
}

/** Стабильная сериализация: ключи объектов по алфавиту — один и тот же документ даёт один хэш. */
export function canonicalize(v: unknown): string {
  if (typeof v === 'string') return v;
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          if (o[k] !== undefined) acc[k] = norm(o[k]);
          return acc;
        }, {});
    }
    return x;
  };
  return JSON.stringify(norm(v));
}

export function documentHash(content: unknown): string {
  return sha256Hex(canonicalize(content));
}

function signatureValue(hash: string, serial: string, signedAt: string, userId: string): string {
  return sha256Hex(`${hash}|${serial}|${signedAt}|${userId}`);
}

function serialFor(userId: string, salt: string): string {
  const h = sha256Hex(`${userId}:${salt}`).toUpperCase();
  return `${h.slice(0, 4)} ${h.slice(4, 8)} ${h.slice(8, 12)}`;
}

const revoked = new Set<string>();
const signatures: SignatureRecord[] = [];
const ORG = 'АКБ «Народный банк» (демо)';
const ISSUER = 'UZ E-IMZO CA (демо)';

/** Демо-сертификаты: действующий ключ организации + истёкший прошлогодний (для проверки отказа). */
export function certificatesOf(user: Pick<User, 'id' | 'fullName'>): SignCertificate[] {
  return [
    { serial: serialFor(user.id, '2026'), userId: user.id, owner: user.fullName, organization: ORG, tin: '200000001', issuer: ISSUER, validFrom: '2025-09-01', validTo: '2027-08-31' },
    { serial: serialFor(user.id, '2024'), userId: user.id, owner: user.fullName, organization: ORG, tin: '200000001', issuer: ISSUER, validFrom: '2023-09-01', validTo: '2025-08-31' },
  ].map((c) => (revoked.has(c.serial) ? { ...c, revoked: true } : c));
}

const today = () => new Date().toISOString().slice(0, 10);

/** Проверка подписи. content — текущее содержимое документа (для обнаружения изменений). */
export function checkSignature(rec: SignatureRecord, content?: unknown): SignatureCheck {
  const checkedAt = new Date().toISOString();
  const valueOk = signatureValue(rec.hash, rec.certSerial, rec.signedAt, rec.userId) === rec.value;
  const contentMatches = content === undefined ? undefined : documentHash(content) === rec.hash;
  const base = { checkedAt, ...(contentMatches === undefined ? {} : { contentMatches }) };
  if (!valueOk || contentMatches === false) return { status: 'tampered', ...base };
  if (revoked.has(rec.certSerial)) return { status: 'revoked', ...base };
  if (rec.certValidTo < today()) return { status: 'expired', ...base };
  return { status: 'valid', ...base };
}

export const signatureService = {
  certificates(user: User): Promise<SignCertificate[]> {
    return later(certificatesOf(user));
  },

  /** Подписать документ выбранным сертификатом. PIN — 4–8 цифр (в демо «0000» считается неверным). */
  async sign(doc: SignableDoc, user: User, certSerial: string, pin: string): Promise<SignatureRecord> {
    if (!/^\d{4,8}$/.test(pin)) throw new SignError('pin_format');
    const cert = certificatesOf(user).find((c) => c.serial === certSerial);
    if (!cert) throw new SignError('cert_not_found');
    if (pin === '0000') throw new SignError('pin_wrong');
    if (cert.revoked) throw new SignError('cert_revoked');
    if (cert.validTo < today()) throw new SignError('cert_expired');
    const hash = documentHash(doc.content);
    let tsa: { serial: string; time: string; tsa: string };
    try {
      const r = await integrationHub.call('eimzo', 'timestamp', { hash }, { mode: 'sync', userId: user.id, maxAttempts: 2 });
      const resp = r.response as { serial?: string; time?: string; tsa?: string } | undefined;
      tsa = { serial: resp?.serial ?? '—', time: resp?.time ?? new Date().toISOString(), tsa: resp?.tsa ?? 'TSA' };
    } catch {
      throw new SignError('eimzo_unavailable');
    }
    const rec: SignatureRecord = {
      id: nextId('sg'),
      entity: doc.entity,
      entityId: doc.entityId,
      docTitle: doc.title,
      userId: user.id,
      certSerial: cert.serial,
      owner: cert.owner,
      organization: cert.organization,
      certValidFrom: cert.validFrom,
      certValidTo: cert.validTo,
      signedAt: tsa.time,
      tsaSerial: tsa.serial,
      tsaAuthority: tsa.tsa,
      hash,
      value: signatureValue(hash, cert.serial, tsa.time, user.id),
    };
    signatures.push(rec);
    serviceAudit({ userId: user.id, action: 'sign.create', entity: doc.entity, entityId: doc.entityId, details: `E-IMZO ${cert.serial} · SHA-256 ${hash.slice(0, 16)}…` });
    emit();
    return later({ ...rec });
  },

  list(entity: string, entityId: ID): Promise<SignatureRecord[]> {
    return later(signatures.filter((s) => s.entity === entity && s.entityId === entityId).map((s) => ({ ...s })));
  },

  listAll(): Promise<SignatureRecord[]> {
    return later(signatures.map((s) => ({ ...s })));
  },

  get(id: ID): SignatureRecord | undefined {
    const s = signatures.find((x) => x.id === id);
    return s ? { ...s } : undefined;
  },

  verify(rec: SignatureRecord, content?: unknown): SignatureCheck {
    return checkSignature(rec, content);
  },

  /** Демо/администрирование: отзыв сертификата (CRL). */
  revoke(serial: string, userId: ID): void {
    revoked.add(serial);
    serviceAudit({ userId, action: 'sign.revoke', entity: 'certificate', entityId: serial });
    emit();
  },

  /** Засев демо-подписи с произвольной датой (для истории и примеров печатных форм). */
  seed(doc: SignableDoc, user: Pick<User, 'id' | 'fullName'>, signedAt: string, certIndex = 0): SignatureRecord {
    const cert = certificatesOf(user)[certIndex]!;
    const hash = documentHash(doc.content);
    const rec: SignatureRecord = {
      id: nextId('sg'),
      entity: doc.entity,
      entityId: doc.entityId,
      docTitle: doc.title,
      userId: user.id,
      certSerial: cert.serial,
      owner: cert.owner,
      organization: cert.organization,
      certValidFrom: cert.validFrom,
      certValidTo: cert.validTo,
      signedAt,
      tsaSerial: String(Math.abs(parseInt(hash.slice(0, 8), 16)) % 1e9),
      tsaAuthority: 'TSA-DEMO-01',
      hash,
      value: signatureValue(hash, cert.serial, signedAt, user.id),
    };
    signatures.push(rec);
    return rec;
  },
};
