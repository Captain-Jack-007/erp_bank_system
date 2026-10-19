// P2-PROC: операции внешних систем для закупок и договоров — регистрируются в существующих системах
// интеграционной шины (УзРТСБ, тендерные площадки, Soliqservis/Didox, iABS) при загрузке модуля.
// Транспорт — имитация integrationHub (очередь, повторы, идемпотентность, карантин, сверка).
import { INTEGRATION_SYSTEMS, type IntegrationOperation } from '../services/integrations';
import type { Localized } from '../types';
import { supplierListsSeed } from './procData';

type P = Record<string, unknown>;
const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const need = (p: P, keys: string[]) => {
  const miss = keys.filter((k) => p[k] === undefined || p[k] === null || p[k] === '');
  return miss.length ? { code: 'validation' as const, message: `Missing: ${miss.join(', ')}` } : null;
};
const tinOk = (p: P, k = 'tin') => (/^\d{9}$/.test(String(p[k] ?? '')) ? null : { code: 'validation' as const, message: `${k}: 9 digits expected` });
const num = (p: P, k: string) => Number(p[k] ?? 0);
export function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const ext = (prefix: string, p: P) => `${prefix}-${String(hashOf(JSON.stringify(p)) % 1_000_000).padStart(6, '0')}`;

const suspicious = new Set(supplierListsSeed.filter((e) => e.list === 'suspicious_tax').map((e) => e.tin));

const OPS: Record<string, IntegrationOperation[]> = {
  uzex: [
    { id: 'lot.status', direction: 'in', schemaVersion: '2.0', name: L('Статус биржевого лота', 'Birja lotining holati', 'Exchange lot status'),
      sample: () => ({ lotNo: 'L-10442', step: 1 }), validate: (p) => need(p, ['lotNo']),
      respond: (p) => ({ lotNo: p.lotNo, status: num(p, 'step') >= 1 ? 'trading' : 'submitted', bids: 2 + (hashOf(String(p.lotNo)) % 4) }) },
    { id: 'lot.result', direction: 'in', schemaVersion: '2.0', name: L('Итоги торгов по лоту', 'Lot bo‘yicha savdo natijalari', 'Lot auction result'),
      sample: () => ({ lotNo: 'L-10442', startPrice: 88_000_000, candidates: ['305678901'] }), validate: (p) => need(p, ['lotNo', 'startPrice']),
      respond: (p) => {
        const c = Array.isArray(p.candidates) ? (p.candidates as string[]) : [];
        const h = hashOf(String(p.lotNo));
        return { lotNo: p.lotNo, status: c.length ? 'won' : 'failed', winnerTin: c.length ? c[h % c.length] : null, price: Math.round((num(p, 'startPrice') * (90 + (h % 8))) / 100) };
      },
      amount: (p) => num(p, 'startPrice') },
    { id: 'participants.get', direction: 'in', schemaVersion: '2.0', name: L('Сведения об участнике торгов', 'Savdo ishtirokchisi to‘g‘risida ma’lumot', 'Bidder record'),
      sample: () => ({ tin: '301234567' }), validate: (p) => tinOk(p),
      respond: (p) => ({ tin: p.tin, lots: 3 + (hashOf(String(p.tin)) % 20), wins: 1 + (hashOf(String(p.tin) + 'w') % 6) }) },
  ],
  etender: [
    { id: 'docs.send', direction: 'out', schemaVersion: '1.0', name: L('Передача тендерной документации', 'Tender hujjatlarini yuborish', 'Send tender documentation'),
      sample: () => ({ tender: 'TN-2026-0012', requirements: 'ТЗ', criteria: 'Цена 70%, срок 30%' }), validate: (p) => need(p, ['tender', 'requirements', 'criteria']),
      respond: (p) => ({ accepted: true, externalId: ext('ET', p) }) },
    { id: 'bids.get', direction: 'in', schemaVersion: '1.0', name: L('Заявки участников тендера', 'Tender ishtirokchilari arizalari', 'Tender bids'),
      sample: () => ({ tender: 'TN-2026-0012', amount: 1_000_000, tins: ['301234567'] }), validate: (p) => need(p, ['tender', 'amount']),
      respond: (p) => {
        const tins = Array.isArray(p.tins) ? (p.tins as string[]) : [];
        return { bids: tins.map((tin, i) => { const h = hashOf(`${String(p.tender)}${tin}`); return { tin, amount: Math.round((num(p, 'amount') * (88 + (h % 15))) / 100), deliveryDays: 5 + (h % 25), score: 70 + (h % 26) - i }; }) };
      } },
    { id: 'tender.result', direction: 'in', schemaVersion: '1.0', name: L('Итоги тендера и победитель', 'Tender natijalari va g‘olib', 'Tender result and winner'),
      sample: () => ({ tender: 'TN-2026-0012', ranking: ['301234567'] }), validate: (p) => need(p, ['tender']),
      respond: (p) => ({ tender: p.tender, winnerTin: Array.isArray(p.ranking) ? (p.ranking as string[])[0] ?? null : null, protocol: ext('PR', p) }) },
  ],
  soliq: [
    { id: 'company.get', direction: 'in', schemaVersion: '1.0', name: L('Реквизиты налогоплательщика по ИНН', 'STIR bo‘yicha soliq to‘lovchi rekvizitlari', 'Taxpayer details by TIN'),
      sample: () => ({ tin: '301234567' }), validate: (p) => tinOk(p),
      respond: (p) => {
        const h = hashOf(String(p.tin));
        return { tin: p.tin, vatPayer: h % 5 !== 0, status: suspicious.has(String(p.tin)) ? 'suspended' : 'active', director: `Директор ${String.fromCharCode(1040 + (h % 28))}. ${String.fromCharCode(1040 + ((h >> 3) % 28))}.`, mfo: String(401 + (h % 500)).padStart(5, '0'), account: `2020800040010${String(h % 10_000_000).padStart(7, '0')}` };
      } },
    { id: 'taxpayer.check', direction: 'in', schemaVersion: '1.0', name: L('Проверка по списку сомнительных налогоплательщиков', 'Shubhali soliq to‘lovchilar ro‘yxati bo‘yicha tekshiruv', 'Suspicious taxpayer check'),
      sample: () => ({ tin: '301234567' }), validate: (p) => tinOk(p), respond: (p) => ({ tin: p.tin, suspicious: suspicious.has(String(p.tin)) }) },
    { id: 'econtract.receive', direction: 'in', schemaVersion: '1.0', name: L('Приём электронных договоров (Didox, Factura.uz)', 'Elektron shartnomalarni qabul qilish (Didox, Factura.uz)', 'Receive e-contracts (Didox, Factura.uz)'),
      sample: () => ({ since: '2026-10-17T00:00:00+05:00' }), respond: (p) => ({ documents: 1, cursor: ext('CUR', p) }) },
    { id: 'econtract.sign', direction: 'out', schemaVersion: '1.0', name: L('Подписание электронного договора E-IMZO', 'Elektron shartnomani E-IMZO bilan imzolash', 'Sign e-contract (E-IMZO)'),
      sample: () => ({ extId: 'DX-2026-118734', hash: 'abc' }), validate: (p) => need(p, ['extId', 'hash']), respond: (p) => ({ accepted: true, status: 'signed', extId: p.extId }) },
    { id: 'econtract.reject', direction: 'out', schemaVersion: '1.0', name: L('Отклонение электронного договора', 'Elektron shartnomani rad etish', 'Reject e-contract'),
      sample: () => ({ extId: 'DX-2026-118734', reason: 'Неверная сумма' }), validate: (p) => need(p, ['extId', 'reason']), respond: (p) => ({ accepted: true, status: 'rejected', extId: p.extId }) },
    { id: 'econtract.send', direction: 'out', schemaVersion: '1.0', name: L('Передача договора на платформу', 'Shartnomani platformaga yuborish', 'Send contract to platform'),
      sample: () => ({ number: 'DG-2026-0311', tin: '303456789', amount: 161_400_000 }), validate: (p) => need(p, ['number', 'tin', 'amount']) ?? tinOk(p), amount: (p) => num(p, 'amount'),
      respond: (p) => ({ accepted: true, extId: ext('DX', p), status: 'sent' }) },
    { id: 'econtract.status', direction: 'in', schemaVersion: '1.0', name: L('Статус договора на платформе', 'Platformadagi shartnoma holati', 'Platform contract status'),
      sample: () => ({ extId: 'DX-000001' }), validate: (p) => need(p, ['extId']), respond: (p) => ({ extId: p.extId, status: 'counter_signed' }) },
    { id: 'act.send', direction: 'out', schemaVersion: '1.0', name: L('Отправка акта выполненных работ исполнителю', 'Bajarilgan ishlar dalolatnomasini ijrochiga yuborish', 'Send work act to contractor'),
      sample: () => ({ number: 'AV-2026-0052', tin: '301234567', amount: 308_000_000 }), validate: (p) => need(p, ['number', 'tin', 'amount']) ?? tinOk(p), amount: (p) => num(p, 'amount'),
      respond: (p) => ({ accepted: true, extId: ext('DXA', p) }) },
    { id: 'act.status', direction: 'in', schemaVersion: '1.0', name: L('Подпись акта исполнителем', 'Dalolatnomaning ijrochi tomonidan imzolanishi', 'Contractor act signature'),
      sample: () => ({ extId: 'DXA-000001' }), validate: (p) => need(p, ['extId']), respond: (p) => ({ extId: p.extId, signed: true, signer: 'Director (demo)' }) },
  ],
  iabs: [
    { id: 'swift.mt103', direction: 'out', schemaVersion: '1.3', name: L('Платёж SWIFT (MT103)', 'SWIFT to‘lovi (MT103)', 'SWIFT payment (MT103)'),
      sample: () => ({ doc: 'PP-2026-0912', bic: 'DEMOSESS', iban: 'SE4550000000058398257466', amount: 60_000, currency: 'USD' }),
      validate: (p) => need(p, ['doc', 'bic', 'iban', 'amount', 'currency']) ?? (/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(p.bic)) && num(p, 'amount') > 0 ? null : { code: 'validation', message: 'BIC 8/11 chars, amount > 0' }),
      amount: (p) => num(p, 'amount'), respond: (p) => ({ accepted: true, uetr: ext('UETR', p) }) },
  ],
};

let registered = false;
/** cross-module (P2-PROC): добавить операции к системам шины (идемпотентно). */
export function registerProcIntegrations(): void {
  if (registered) return;
  registered = true;
  for (const [systemId, ops] of Object.entries(OPS)) {
    const sys = INTEGRATION_SYSTEMS.find((s) => s.id === systemId);
    if (!sys) continue;
    for (const op of ops) if (!sys.operations.some((o) => o.id === op.id)) sys.operations.push(op);
  }
}
