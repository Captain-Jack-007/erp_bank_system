// P2-DOCS: операции интеграционной шины, которые нужны модулям ЭСФ, СЭД, архива и командировок.
// Паспорта систем (soliq, mysud, iabs, laborlaw, dwh) ведутся в ядре; модуль добавляет к ним свои операции
// при загрузке — так обмен виден в мониторе /integrations (журнал, повторы, очередь, сверка).
import { integrationHub, type IntegrationOperation } from '../../services/integrations';
import type { Localized } from '../../types';

type Payload = Record<string, unknown>;
const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const num = (p: Payload, k: string) => (typeof p[k] === 'number' ? (p[k] as number) : Number(p[k] ?? 0));
const missing = (p: Payload, keys: string[]) => {
  const miss = keys.filter((k) => p[k] === undefined || p[k] === null || p[k] === '');
  return miss.length ? { code: 'validation' as const, message: `Missing: ${miss.join(', ')}` } : null;
};
const ref = (p: Payload) => `EXT-${Math.abs([...JSON.stringify(p)].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)) % 1_000_000}`;

/** Добавить операции к системе шины (идемпотентно) и отметить модуль-потребитель. */
export function addIntegrationOps(systemId: string, moduleId: string, ops: IntegrationOperation[]): void {
  const sys = integrationHub.systems.find((s) => s.id === systemId);
  if (!sys) return;
  for (const o of ops) if (!sys.operations.some((x) => x.id === o.id)) sys.operations.push(o);
  if (!sys.modules.includes(moduleId)) sys.modules.push(moduleId);
}

let registered = false;
/** Регистрирует все операции группы модулей (вызывается каждым модулем при загрузке). */
export function registerDocsIntegrationOps(): void {
  if (registered) return;
  registered = true;
  addIntegrationOps('soliq', 'einvoices', [
    { id: 'reconciliation.receive', direction: 'in', schemaVersion: '1.0', name: L('Автоприём актов сверки', 'Solishtirma dalolatnomalarini qabul qilish', 'Receive reconciliation acts'),
      sample: () => ({ since: '2026-10-17T00:00:00+05:00' }), respond: (_p, r) => ({ documents: Math.floor(r() * 2) + 1 }), count: () => 1 },
    { id: 'einvoice.respond', direction: 'out', schemaVersion: '1.2', name: L('Ответ поставщику (акцепт / отказ)', "Yetkazib beruvchiga javob (aksept / rad)", 'Response to supplier (accept / reject)'),
      sample: () => ({ number: 'EF-2026-0412', decision: 'accepted' }), validate: (p) => missing(p, ['number', 'decision']), respond: (p) => ({ accepted: true, externalId: ref(p) }) },
    { id: 'act.send', direction: 'out', schemaVersion: '1.0', name: L('Отправка акта / документа в свободной форме', 'Dalolatnoma / erkin shakldagi hujjatni yuborish', 'Send act / free-form document'),
      sample: () => ({ number: 'XB-AVR-2026-0101', tin: '301112223', amount: 9_800_000 }), validate: (p) => missing(p, ['number', 'tin']), amount: (p) => num(p, 'amount'), respond: (p) => ({ accepted: true, externalId: ref(p), acceptedAmount: num(p, 'amount') }) },
  ]);
  addIntegrationOps('soliq', 'documents', [
    { id: 'letters.receive', direction: 'in', schemaVersion: '1.0', name: L('Загрузка писем my3.soliq.uz', 'my3.soliq.uz xatlarini yuklash', 'Load my3.soliq.uz letters'),
      sample: () => ({ since: '2026-10-17T00:00:00+05:00' }), respond: (_p, r) => ({ letters: Math.floor(r() * 2) + 1 }), count: () => 1 },
    { id: 'letter.reply', direction: 'out', schemaVersion: '1.0', name: L('Ответ на письмо налогового органа', 'Soliq organi xatiga javob', 'Reply to tax authority letter'),
      sample: () => ({ number: 'IS-2026-05001', inReplyTo: 'ST-2026-11871' }), validate: (p) => missing(p, ['number']), respond: (p) => ({ accepted: true, externalId: ref(p) }) },
  ]);
  addIntegrationOps('mysud', 'documents', [
    { id: 'decisions.receive', direction: 'in', schemaVersion: '1.0', name: L('Загрузка решений МИБ', 'MIB qarorlarini yuklash', 'Load enforcement decisions'),
      sample: () => ({ since: '2026-10-17T00:00:00+05:00' }), respond: (_p, r) => ({ decisions: Math.floor(r() * 2) + 1 }), count: () => 1 },
    { id: 'debt.closed', direction: 'out', schemaVersion: '1.0', name: L('Уведомление о погашении задолженности', "Qarzdorlik to'langani haqida xabar", 'Debt settled notice'),
      sample: () => ({ doc: 'MIB-2026-4471', transaction: 'TRX-55102', mfo: '00873' }), validate: (p) => missing(p, ['doc', 'transaction']), respond: (p) => ({ accepted: true, unblock: true, externalId: ref(p) }) },
  ]);
  addIntegrationOps('mygov', 'documents', [
    { id: 'edo.send', direction: 'out', schemaVersion: '1.0', name: L('Отправка исходящего письма (межведомственный ЭДО)', 'Chiquvchi xatni yuborish (idoralararo EHA)', 'Send outgoing letter (inter-agency EDI)'),
      sample: () => ({ number: 'IS-2026-05001', addressee: 'Хокимият' }), validate: (p) => missing(p, ['number', 'addressee']), respond: (p) => ({ accepted: true, delivered: true, externalId: ref(p) }) },
  ]);
  addIntegrationOps('iabs', 'documents', [
    { id: 'journal.get', direction: 'in', schemaVersion: '1.0', name: L('Ежедневный бухгалтерский журнал (АУР)', 'Kundalik buxgalteriya jurnali (MBX)', 'Daily accounting journal (admin expenses)'),
      sample: () => ({ date: '2026-10-17' }), validate: (p) => missing(p, ['date']), respond: () => ({ ok: true }) },
    { id: 'opday.export', direction: 'in', schemaVersion: '1.0', name: L('Данные операционного дня для архива', 'Arxiv uchun operatsion kun maʼlumotlari', 'Operational day data for archive'),
      sample: () => ({ date: '2026-10-17' }), validate: (p) => missing(p, ['date']), respond: (_p, r) => ({ files: 3, entries: Math.floor(4000 + r() * 2000) }), count: () => 1 },
    { id: 'payment.status', direction: 'in', schemaVersion: '1.3', name: L('Статус платёжного документа', "To'lov hujjati holati", 'Payment document status'),
      sample: () => ({ doc: 'PP-2026-0911' }), validate: (p) => missing(p, ['doc']), respond: (p) => ({ status: 'debited', transaction: `TRX-${ref(p).slice(4)}`, mfo: '00873' }) },
  ]);
  addIntegrationOps('dwh', 'archive', [
    { id: 'registry.export', direction: 'in', schemaVersion: '1.0', name: L('Электронные реестры и отчёты для архива', 'Arxiv uchun elektron reestrlar va hisobotlar', 'Electronic registers and reports for archive'),
      sample: () => ({ period: '2026-09' }), validate: (p) => missing(p, ['period']), respond: (_p, r) => ({ files: Math.floor(r() * 3) + 2 }), count: () => 1 },
  ]);
  addIntegrationOps('iabs', 'archive', []);
  addIntegrationOps('laborlaw', 'trips', [
    { id: 'employee.get', direction: 'in', schemaVersion: '1.0', name: L('Сведения о сотруднике (должность, грейд)', "Xodim haqida ma'lumot (lavozim, grade)", 'Employee record (position, grade)'),
      sample: () => ({ employee: 'u1' }), validate: (p) => missing(p, ['employee']), respond: (p) => ({ active: true, employee: p.employee }) },
  ]);
  addIntegrationOps('iabs', 'trips', []);
}
