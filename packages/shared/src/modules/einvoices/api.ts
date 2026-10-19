// API модуля «Электронные счета-фактуры» (ТЗ 4.2.3). Обмен с Налоговым комитетом (оператор ЭСФ) и АБС —
// через интеграционную шину (имитация транспорта), подпись — платформенный сервис E-IMZO.
//
// Жизненный цикл входящего документа (счёт-фактура, акт выполненных работ, акт сверки):
//   «Новый» (принят через API НК, день 0 10-дневного срока) → «В подразделении» (направлен в подразделение ЦА /
//   региональный центр / ЦБУ, срок 5 дней) → подтверждение подразделением → «На согласовании» (движок:
//   главный бухгалтер → руководство ЦА сверх 100 млн) → «Принят» → проводки в АБС → подпись ЭЦП (акцепт,
//   ответ поставщику) → мемориальный ордер → оплата → электронный архив.
import { clone, delay, emit, historyEvent, nextId, nextNumber, now } from '../../bus';
import { api } from '../../api';
import { audit } from '../../audit';
import { directory } from '../../directory';
import { approvalEngine } from '../../engine';
import { formatNumber } from '../../format';
import { tk, translate } from '../../i18n';
import { counterparties as counterpartySeed } from '../../mock/data';
import { notify } from '../../notifications';
import { orgApi } from '../../org';
import { matches, registerSearchProvider } from '../../search';
import { can } from '../../security';
import { integrationHub } from '../../services/integrations';
import { signatureService } from '../../services/signature';
import type { ID, Localized, User } from '../../types';
import { archiveApi, registerArchiveSource } from '../archive/api';
import { registerDocsIntegrationOps } from '../documents/integrationOps';
import { einvoiceApprovalSeed, einvoiceSeed, einvoiceSoliqQueue } from './data';
import type {
  EinvoiceAssignment,
  EinvoiceCheck,
  EinvoiceContractMatch,
  EinvoiceDashboard,
  EinvoiceDoc,
  EinvoiceFilter,
  EinvoiceIntakeResult,
  EinvoiceKind,
  EinvoiceLight,
  EinvoiceLine,
  EinvoicePosting,
  EinvoiceReconciliation,
  EinvoiceReportRow,
  EinvoiceStats,
  EinvoiceTotals,
  EinvoiceUnitReportRow,
  NewEinvoiceInput,
} from './types';
import { apiError } from '../../errors';

registerDocsIntegrationOps();

const db: EinvoiceDoc[] = clone(einvoiceSeed);
const byId = (id: ID) => db.find((d) => d.id === id);
const queue = clone(einvoiceSoliqQueue);
const DAY = 86_400_000;
const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

export const EINVOICE_VAT_RATE = 12;
/** Срок исполнения документа подразделением, дней (PR-EHF-017). */
export const EINVOICE_UNIT_DAYS = 5;
/** Срок принятия/отклонения документа, календарных дней (ПКМ № 489, PR-EHF-018). */
export const EINVOICE_LEGAL_DAYS = 10;
/** Порог участия руководства ЦА в маршруте согласования, сум. */
export const EINVOICE_MANAGEMENT_THRESHOLD = 100_000_000;
/** Реквизиты банка в документах (демо). */
export const EINVOICE_BANK_TIN = '201234567';
export const EINVOICE_KINDS: EinvoiceKind[] = ['invoice', 'work_act', 'reconciliation_act', 'free_form'];

/** Право оформлять документы, направлять в подразделения, подписывать (матрица прав модуля einvoices). */
export function canOperateEinvoices(user: User): boolean {
  return can(user, 'einvoices', 'edit');
}
function assertOperator(user: User) {
  if (!canOperateEinvoices(user)) throw apiError('NOT_ALLOWED');
}

/** Сумма без НДС, НДС и итог. Округление НДС до сума. */
export function einvoiceTotals(lines: EinvoiceLine[], vatRate = EINVOICE_VAT_RATE): EinvoiceTotals {
  const net = lines.reduce((s, l) => s + Math.round(l.qty * l.unitPrice), 0);
  const vat = Math.round((net * vatRate) / 100);
  return { net, vat, total: net + vat };
}

/** Каноническое содержимое документа для подписи E-IMZO (не зависит от языка и статуса). */
export function einvoiceSignContent(d: EinvoiceDoc) {
  return { number: d.number, kind: d.kind, direction: d.direction, date: d.date, counterparty: d.counterpartyId, contract: d.contractId ?? '', lines: d.lines, vatRate: d.vatRate, reconciliation: d.reconciliation ?? null, text: d.text ?? '' };
}

const isFinal = (d: EinvoiceDoc) => (d.direction === 'incoming' ? ['signed', 'rejected'].includes(d.status) : ['sent', 'accepted', 'rejected'].includes(d.status));
/** Документ ждёт решения (входящий, срок 10 дней ещё идёт). */
export function einvoiceIsOpen(d: Pick<EinvoiceDoc, 'direction' | 'status'>): boolean {
  return d.direction === 'incoming' && ['new', 'routed', 'pending', 'accepted'].includes(d.status);
}

/** День срока: 1 — первые сутки после поступления. */
export function einvoiceDay(d: Pick<EinvoiceDoc, 'receivedAt'>, at = Date.now()): number {
  return Math.max(1, Math.floor((at - new Date(d.receivedAt).getTime()) / DAY) + 1);
}

/** Светофор 10-дневного срока: зелёный 1–5, жёлтый 6–8, красный 9–10, чёрный 10+ (срок нарушен). */
export function einvoiceLight(d: Pick<EinvoiceDoc, 'direction' | 'status' | 'receivedAt'>, at = Date.now()): EinvoiceLight {
  if (!einvoiceIsOpen(d)) return 'done';
  const day = einvoiceDay(d, at);
  return day <= 5 ? 'green' : day <= 8 ? 'yellow' : day <= EINVOICE_LEGAL_DAYS ? 'red' : 'black';
}

/** Просрочка подразделения, дней (0 — в срок). */
export function einvoiceUnitOverdueDays(a: EinvoiceAssignment | undefined, at = Date.now()): number {
  if (!a) return 0;
  const end = a.decidedAt ? new Date(a.decidedAt).getTime() : at;
  const late = end - new Date(a.dueAt).getTime();
  return late > 0 ? Math.ceil(late / DAY) : 0;
}

const cpName = (id: ID) => counterpartySeed.find((c) => c.id === id)?.name ?? '';
const kindRu: Record<EinvoiceKind, string> = { invoice: 'Счёт-фактура', work_act: 'Акт выполненных работ', reconciliation_act: 'Акт сверки', free_form: 'Документ в свободной форме' };
const docTotal = (d: EinvoiceDoc) => (d.kind === 'reconciliation_act' ? (d.reconciliation?.closing ?? 0) : einvoiceTotals(d.lines, d.vatRate).total);

// ---------- Оргструктура: кто отвечает за подразделение ----------

async function resolveUnit(orgUnitKey: string): Promise<{ name: Localized; type: EinvoiceAssignment['unitType']; assigneeIds: ID[] }> {
  const unit = (await orgApi.listOrgUnits()).find((u) => u.key === orgUnitKey);
  if (!unit) throw apiError('UNIT_NOT_FOUND');
  const users = directory.users().filter((u) => u.active !== false);
  let ids: ID[] = [];
  if (unit.type === 'department') {
    const head = directory.department(orgUnitKey)?.headId ?? unit.headUserId;
    ids = head ? [head] : users.filter((u) => u.departmentId === orgUnitKey).map((u) => u.id);
  } else {
    ids = unit.headUserId ? [unit.headUserId] : users.filter((u) => u.orgUnitKey === orgUnitKey || u.orgUnitKey?.startsWith(`${orgUnitKey}-`)).map((u) => u.id);
  }
  if (!ids.length) ids = directory.admins().map((u) => u.id);
  return { name: unit.name, type: unit.type, assigneeIds: ids };
}

/** Автоматическое подразделение для документа: по договору (подразделение-инициатор договора). */
async function autoUnit(d: EinvoiceDoc): Promise<string | undefined> {
  if (!d.contractId) return undefined;
  const c = await api.getContract(d.contractId);
  return c?.departmentId;
}

async function routeDoc(d: EinvoiceDoc, orgUnitKey: string, user: User, days: number, comment?: string): Promise<void> {
  const u = await resolveUnit(orgUnitKey);
  const at = now();
  const rerouted = !!d.assignment;
  d.assignment = { orgUnitKey, unitName: u.name, unitType: u.type, assigneeIds: u.assigneeIds, routedAt: at, routedBy: user.id, dueAt: new Date(Date.now() + days * DAY).toISOString(), ...(comment?.trim() ? { comment: comment.trim() } : {}) };
  d.status = 'routed';
  d.history.push(historyEvent(user.id, 'status_changed', `${rerouted ? 'Перенаправлен' : 'Направлен'} в подразделение: ${u.name.ru} (срок ${days} дн.)`));
  notify({
    userIds: u.assigneeIds,
    excludeIds: [user.id],
    kind: 'task',
    level: 'info',
    title: L(`${d.number}: документ направлен вашему подразделению`, `${d.number}: hujjat bo'linmangizga yuborildi`, `${d.number}: document routed to your unit`),
    body: L(`${kindRu[d.kind]} · ${cpName(d.counterpartyId)} · срок ${days} дн.`, `${cpName(d.counterpartyId)} · muddat ${days} kun`, `${cpName(d.counterpartyId)} · due in ${days} days`),
    link: `/einvoices/${d.id}`,
  });
  audit.log({ action: 'update', entity: 'einvoice', entityId: d.id, entityLabel: d.number, changes: [{ field: 'orgUnitKey', from: '', to: orgUnitKey }], details: `route → ${orgUnitKey}, ${days}d`, user: { id: user.id, fullName: user.fullName, role: user.role } });
}

// ---------- Согласование (движок v2) ----------

approvalEngine.register('einvoice', {
  onHistory: (id, e) => byId(id)?.history.push(e),
  onFinal: (id, ok) => {
    const d = byId(id);
    if (!d) return;
    if (d.direction === 'incoming') {
      d.status = ok ? 'accepted' : 'rejected';
      if (!ok) {
        d.rejectReason = d.rejectReason ?? 'Отклонено по маршруту согласования';
        void respondToSupplier(d, 'rejected');
        void archiveDoc(d, 'system');
      } else notify({ roles: ['accountant'], kind: 'approved', level: 'success', title: L(`${d.number}: документ принят`, `${d.number}: hujjat qabul qilindi`, `${d.number}: document accepted`), body: L('Сформируйте проводки и подпишите ЭЦП', "Provodkalarni shakllantiring va EImzo bilan imzolang", 'Create postings and sign with e-signature'), link: `/einvoices/${d.id}` });
    } else {
      // Исходящий: после согласования документ подписывается ЭЦП E-IMZO и только затем уходит оператору ЭСФ.
      d.status = ok ? 'approved' : 'draft';
      const issuer = d.history.find((h) => h.action === 'created')?.userId;
      if (ok) notify({ userIds: issuer ? [issuer] : [], roles: ['accountant'], kind: 'approved', level: 'success', title: L(`${d.number}: согласован — подпишите и отправьте`, `${d.number}: kelishildi — imzolang va yuboring`, `${d.number}: approved — sign and send`), link: `/einvoices/${d.id}` });
    }
  },
  onReturned: (id, comment) => {
    const d = byId(id);
    if (!d) return;
    d.status = d.direction === 'incoming' ? 'new' : 'draft';
    d.history.push(historyEvent('system', 'returned', comment));
  },
  getContext: (id) => {
    const d = byId(id);
    return d ? { direction: d.direction, subtype: d.kind, ...(d.assignment ? { orgUnitKey: d.assignment.orgUnitKey } : {}) } : undefined;
  },
});
approvalEngine.seed(einvoiceApprovalSeed);

registerSearchProvider((q, lang) =>
  db
    .filter((d) => matches(q, d.number, d.operatorId, cpName(d.counterpartyId), d.text, ...d.lines.map((l) => l.name)))
    .map((d) => ({
      group: 'einvoices_title',
      title: `${d.number} · ${cpName(d.counterpartyId)}`,
      subtitle: `${translate(lang, tk('einvoices_kind_', d.kind))} · ${translate(lang, tk('einvoices_status_', d.status))}`,
      to: `/einvoices/${d.id}`,
    })),
);

function openTask(doc: EinvoiceDoc, user: User) {
  approvalEngine.open({
    entity: 'einvoice',
    entityId: doc.id,
    number: doc.number,
    title: `${kindRu[doc.kind]} ${doc.direction === 'incoming' ? 'от' : 'для'} ${cpName(doc.counterpartyId)}`.trim(),
    requesterId: user.id,
    amount: docTotal(doc),
    context: { direction: doc.direction, subtype: doc.kind, ...(doc.assignment ? { orgUnitKey: doc.assignment.orgUnitKey } : {}) },
  });
}

// ---------- Обмен с оператором ЭСФ / АБС ----------

async function respondToSupplier(d: EinvoiceDoc, decision: 'accepted' | 'rejected'): Promise<void> {
  try {
    await integrationHub.call('soliq', 'einvoice.respond', { number: d.number, operatorId: d.operatorId, decision, ...(d.rejectReason && decision === 'rejected' ? { reason: d.rejectReason } : {}) }, { idempotencyKey: `ehf-respond-${d.id}-${decision}`, background: true });
  } catch {
    /* ответ встанет в очередь шины */
  }
}

async function sendToOperator(d: EinvoiceDoc, userId: ID): Promise<void> {
  const cp = counterpartySeed.find((c) => c.id === d.counterpartyId);
  const totals = einvoiceTotals(d.lines, d.vatRate);
  const op = d.kind === 'invoice' ? 'einvoice.send' : 'act.send';
  const payload = d.kind === 'invoice' ? { number: d.number, tin: cp?.tin ?? '', date: d.date, amount: totals.total, vat: totals.vat } : { number: d.number, tin: cp?.tin ?? '', amount: docTotal(d), kind: d.kind };
  const key = `ehf-send-${d.id}`;
  // Идентификатор у оператора присваивается при постановке в отправку; статус обмена фиксируется журналом шины.
  if (!d.operatorId || d.operatorId === '—') d.operatorId = `OP-7F3A-${String(1000 + (Math.abs([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 8999))}`;
  emit();
  try {
    const rec = await integrationHub.call('soliq', op, payload, { idempotencyKey: key, userId });
    if (rec.status !== 'success') d.operatorId = `${d.operatorId} · ${rec.status.toUpperCase()}`;
    d.history.push(historyEvent(userId, 'status_changed', rec.status === 'success' ? 'Отправлено оператору ЭСФ' : `Обмен с оператором ЭСФ: ${rec.status}`));
  } catch {
    d.history.push(historyEvent(userId, 'status_changed', 'Оператор ЭСФ недоступен — документ в очереди'));
  }
  emit();
}

/** Бухгалтерские проводки по документу (PR-EHF-010). */
export function einvoicePostings(d: Pick<EinvoiceDoc, 'direction' | 'kind' | 'lines' | 'vatRate' | 'number'>): EinvoicePosting[] {
  if (d.kind === 'reconciliation_act' || d.kind === 'free_form') return [];
  const t = einvoiceTotals(d.lines, d.vatRate);
  if (d.direction === 'incoming') {
    return [
      { debit: '56802000', credit: '29802000', amount: t.net, purpose: `${d.number}: ${d.lines.map((l) => l.name).join('; ').slice(0, 80)}` },
      ...(t.vat ? [{ debit: '19905000', credit: '29802000', amount: t.vat, purpose: `${d.number}: НДС к зачёту` }] : []),
    ];
  }
  return [
    { debit: '16310000', credit: '45994000', amount: t.net, purpose: `${d.number}: доход` },
    ...(t.vat ? [{ debit: '16310000', credit: '29801000', amount: t.vat, purpose: `${d.number}: НДС к уплате` }] : []),
  ];
}

async function archiveDoc(d: EinvoiceDoc, userId: ID): Promise<void> {
  if (d.archivedAt) return;
  try {
    const r = await archiveApi.receiveElectronic(
      {
        source: 'einvoices',
        sourceRef: d.id,
        docNumber: d.number,
        docDate: d.date,
        title: `${kindRu[d.kind]} ${d.number} · ${cpName(d.counterpartyId)}`,
        kind: kindRu[d.kind],
        departmentId: d.assignment?.orgUnitKey && directory.department(d.assignment.orgUnitKey) ? d.assignment.orgUnitKey : 'd7',
        responsibleId: d.signedBy ?? 'u7',
        createdAt: d.receivedAt,
        text: [d.text, ...d.lines.map((l) => l.name)].filter(Boolean).join('\n'),
        content: { number: d.number, kind: d.kind, direction: d.direction, lines: d.lines, vatRate: d.vatRate, status: d.status, counterparty: d.counterpartyId },
        signatureEntity: { entity: 'einvoice', entityId: d.id },
        signatureContent: einvoiceSignContent(d),
        fileEntity: { entity: 'einvoice', entityId: d.id },
        nomenclatureIndex: '05-07',
      },
      directory.user(userId) ?? directory.admins()[0]!,
    );
    d.archivedAt = now();
    d.archiveRef = r.number;
    d.history.push(historyEvent(userId, 'status_changed', `Передан в электронный архив: ${r.number}`));
  } catch {
    /* архив недоступен — повтор вручную */
  }
}

// Источник для электронного архива: финальные документы ЭСФ, ещё не переданные в архив (PR-EHF-014).
registerArchiveSource('einvoices', {
  name: L('Электронные счета-фактуры', 'Elektron hisob-fakturalar', 'E-invoices'),
  pending: () => db.filter((d) => isFinal(d) && !d.archivedAt).length,
  pull: async (user) => {
    const list = db.filter((d) => isFinal(d) && !d.archivedAt);
    for (const d of list) await archiveDoc(d, user.id);
    emit();
    return list.length;
  },
});

// ---------- Контроль сроков и уведомления (PR-EHF-011…013, 017, 018) ----------

let lastScan = 0;
/** Сканер сроков: предупреждения подразделениям, эскалация, светофор 10 дней, штрафы KPI. Идемпотентен. */
export function einvoiceScan(at = Date.now()): number {
  let changes = 0;
  for (const d of db) {
    if (!einvoiceIsOpen(d)) continue;
    const light = einvoiceLight(d, at);
    const link = `/einvoices/${d.id}`;
    if (light === 'yellow') notify({ roles: ['accountant'], kind: 'sla_soon', level: 'warning', title: L(`${d.number}: 6+ дней без решения`, `${d.number}: 6+ kun qarorsiz`, `${d.number}: 6+ days without decision`), body: L('Срок принятия/отклонения по ПКМ № 489 — 10 дней', "VMQ № 489 bo'yicha qabul qilish/rad etish muddati — 10 kun", 'Acceptance deadline (CM Resolution 489) is 10 days'), link, dedupeKey: `ehf-yellow:${d.id}` });
    if (light === 'red') notify({ roles: ['accountant', 'finance'], kind: 'sla_overdue', level: 'danger', title: L(`${d.number}: критический срок (9–10 день)`, `${d.number}: kritik muddat (9–10 kun)`, `${d.number}: critical deadline (day 9–10)`), body: L('Уведомлено руководство', 'Rahbariyat xabardor qilindi', 'Management notified'), link, dedupeKey: `ehf-red:${d.id}` });
    if (light === 'black') notify({ roles: ['accountant', 'finance'], kind: 'escalation', level: 'danger', title: L(`${d.number}: 10-дневный срок нарушен`, `${d.number}: 10 kunlik muddat buzildi`, `${d.number}: 10-day deadline breached`), link, dedupeKey: `ehf-black:${d.id}` });
    const a = d.assignment;
    if (d.status === 'routed' && a && !a.decision) {
      const left = new Date(a.dueAt).getTime() - at;
      if (left > 0 && left < DAY) notify({ userIds: a.assigneeIds, kind: 'sla_soon', level: 'warning', title: L(`${d.number}: срок подразделения истекает`, `${d.number}: bo'linma muddati tugayapti`, `${d.number}: unit deadline is near`), body: L('Подтвердите или отклоните документ', 'Hujjatni tasdiqlang yoki rad eting', 'Confirm or reject the document'), link, dedupeKey: `ehf-unit-soon:${d.id}:${a.routedAt}` });
      if (left <= 0) {
        notify({ userIds: a.assigneeIds, roles: ['accountant'], kind: 'sla_overdue', level: 'danger', title: L(`${d.number}: подразделение нарушило срок`, `${d.number}: bo'linma muddatni buzdi`, `${d.number}: unit missed the deadline`), body: L('Штрафная мера KPI: 1 балл за каждый день просрочки', 'KPI jarima chorasi: har bir kechikish kuni uchun 1 ball', 'KPI penalty: 1 point per overdue day'), link, dedupeKey: `ehf-unit-overdue:${d.id}:${a.routedAt}` });
      }
    }
  }
  lastScan = at;
  return changes;
}

function maybeScan() {
  if (Date.now() - lastScan > 30_000) einvoiceScan();
}

// ---------- Валидация (PR-EHF-021) ----------

async function checksOf(d: EinvoiceDoc): Promise<EinvoiceCheck[]> {
  const cps = await api.listCounterparties();
  const cp = cps.find((c) => c.id === d.counterpartyId);
  const out: EinvoiceCheck[] = [];
  out.push({ code: 'tin', ok: !!cp && /^\d{9}$/.test(cp.tin), details: cp?.tin ?? '—' });
  out.push({ code: 'blocked', ok: !cp?.blocked });
  out.push({ code: 'lines', ok: d.lines.length > 0 && d.lines.every((l) => l.name.trim() && l.qty > 0 && l.unitPrice >= 0) });
  if (d.kind !== 'reconciliation_act' && d.kind !== 'free_form') out.push({ code: 'vat', ok: d.vatRate === EINVOICE_VAT_RATE, details: `${d.vatRate}%` });
  out.push({ code: 'duplicate', ok: !db.some((x) => x.id !== d.id && x.number === d.number && x.counterpartyId === d.counterpartyId) });
  if (d.contractId) {
    const c = await api.getContract(d.contractId);
    out.push({ code: 'contract', ok: !!c && c.counterpartyId === d.counterpartyId && c.status === 'active', warn: !!c && c.counterpartyId === d.counterpartyId, details: c ? c.number : '—' });
    // Сверка с заказом: договор заключён по заявке на закупку (модуль закупок).
    if (c && d.kind !== 'reconciliation_act') {
      const order = c.requestId ? await api.getProcurement(c.requestId) : undefined;
      out.push({ code: 'order', ok: !!order, warn: true, ...(order ? { details: order.number } : {}) });
    }
    if (c && c.currency === 'UZS' && d.kind !== 'reconciliation_act') {
      const invoiced = db.filter((x) => x.contractId === c.id && x.status !== 'rejected' && x.kind === 'invoice').reduce((s, x) => s + einvoiceTotals(x.lines, x.vatRate).total, 0);
      out.push({ code: 'contract_amount', ok: invoiced <= c.amount, details: `${formatNumber(invoiced)} / ${formatNumber(c.amount)}` });
    }
    if (d.kind === 'invoice') {
      const act = db.find((x) => x.contractId === d.contractId && x.kind === 'work_act' && x.status !== 'rejected');
      out.push({ code: 'act', ok: !!act, warn: true, ...(act ? { details: act.number } : {}) });
    }
    if (d.kind === 'work_act') {
      const inv = db.find((x) => x.contractId === d.contractId && x.kind === 'invoice' && x.status !== 'rejected');
      out.push({ code: 'invoice', ok: !!inv, warn: true, ...(inv ? { details: inv.number } : {}) });
    }
  } else out.push({ code: 'contract', ok: false, warn: true });
  return out;
}

// ---------- Отчёты ----------

const inPeriod = (d: EinvoiceDoc, from?: string, to?: string) => (!from || d.date >= from) && (!to || d.date <= to);

function unitRows(list: EinvoiceDoc[], at = Date.now()): EinvoiceUnitReportRow[] {
  const map = new Map<string, EinvoiceUnitReportRow & { daysSum: number; decided: number }>();
  for (const d of list) {
    const a = d.assignment;
    if (!a) continue;
    const r = map.get(a.orgUnitKey) ?? { orgUnitKey: a.orgUnitKey, unitName: a.unitName, routed: 0, confirmed: 0, rejected: 0, open: 0, overdue: 0, penaltyPoints: 0, avgDays: 0, daysSum: 0, decided: 0 };
    r.routed++;
    if (a.decision === 'confirmed') r.confirmed++;
    else if (a.decision === 'rejected') r.rejected++;
    else r.open++;
    const late = einvoiceUnitOverdueDays(a, at);
    if (late) {
      r.overdue++;
      r.penaltyPoints += late;
    }
    if (a.decidedAt) {
      r.decided++;
      r.daysSum += (new Date(a.decidedAt).getTime() - new Date(a.routedAt).getTime()) / DAY;
    }
    map.set(a.orgUnitKey, r);
  }
  return [...map.values()].map(({ daysSum, decided, ...r }) => ({ ...r, avgDays: decided ? Math.round((daysSum / decided) * 10) / 10 : 0 })).sort((a, b) => b.overdue - a.overdue || b.routed - a.routed);
}

function holderOf(d: EinvoiceDoc): string {
  if (d.status === 'routed' && d.assignment) return d.assignment.assigneeIds.map((i) => directory.user(i)?.fullName ?? i).join(', ');
  if (d.status === 'pending') {
    const t = approvalEngine.openFor(d.id) as { assigneeIds?: ID[]; assigneeRole?: string } | undefined;
    if (t?.assigneeIds?.length) return t.assigneeIds.map((i) => directory.user(i)?.fullName ?? i).join(', ');
    return t?.assigneeRole ? directory.byRole(t.assigneeRole as never).map((u) => u.fullName).join(', ') : '—';
  }
  return directory.byRole('accountant').map((u) => u.fullName).join(', ');
}

// ---------- Публичный API ----------

export const einvoicesApi = {
  list(filter: EinvoiceFilter = {}): Promise<EinvoiceDoc[]> {
    maybeScan();
    const q = filter.search?.trim().toLowerCase();
    return delay(
      db
        .filter((d) => !filter.direction || d.direction === filter.direction)
        .filter((d) => !filter.kind || d.kind === filter.kind)
        .filter((d) => !filter.status || d.status === filter.status)
        .filter((d) => !filter.counterpartyId || d.counterpartyId === filter.counterpartyId)
        .filter((d) => !filter.light || einvoiceLight(d) === filter.light)
        .filter((d) => !filter.assignedTo || (d.status === 'routed' && !!d.assignment?.assigneeIds.includes(filter.assignedTo)))
        .filter((d) => !filter.orgUnitKey || d.assignment?.orgUnitKey === filter.orgUnitKey || d.issuerUnitKey === filter.orgUnitKey)
        .filter((d) => inPeriod(d, filter.from, filter.to))
        .filter((d) => !q || d.number.toLowerCase().includes(q) || d.lines.some((l) => l.name.toLowerCase().includes(q)) || (d.text ?? '').toLowerCase().includes(q))
        .sort((a, b) => b.date.localeCompare(a.date) || b.receivedAt.localeCompare(a.receivedAt)),
    );
  },

  get: (id: ID): Promise<EinvoiceDoc | undefined> => {
    maybeScan();
    return delay(byId(id));
  },

  stats(user?: User): Promise<EinvoiceStats> {
    maybeScan();
    const month = now().slice(0, 7);
    const signedThisMonth = db.filter((d) => ['signed', 'sent', 'accepted'].includes(d.status) && d.date.startsWith(month));
    const lights = { green: 0, yellow: 0, red: 0, black: 0 };
    for (const d of db) {
      const l = einvoiceLight(d);
      if (l !== 'done') lights[l]++;
    }
    return delay({
      incomingNew: db.filter((d) => d.direction === 'incoming' && d.status === 'new').length,
      outgoingPending: db.filter((d) => d.direction === 'outgoing' && ['draft', 'pending', 'approved'].includes(d.status)).length,
      signedMonth: signedThisMonth.length,
      vatMonth: signedThisMonth.reduce((s, d) => s + einvoiceTotals(d.lines, d.vatRate).vat, 0),
      rejected: db.filter((d) => d.status === 'rejected').length,
      routed: db.filter((d) => d.status === 'routed').length,
      myTasks: user ? db.filter((d) => d.status === 'routed' && d.assignment?.assigneeIds.includes(user.id)).length : 0,
      lights,
    });
  },

  /** Сверка с договором: сколько уже выставлено по договору и не превышена ли сумма. */
  async contractMatch(contractId: ID): Promise<EinvoiceContractMatch | undefined> {
    const c = await api.getContract(contractId);
    if (!c) return undefined;
    const invoiced = db.filter((d) => d.contractId === contractId && d.status !== 'rejected' && d.kind === 'invoice').reduce((s, d) => s + einvoiceTotals(d.lines, d.vatRate).total, 0);
    return delay({ contractId, contractAmount: c.amount, invoicedTotal: invoiced, remaining: c.amount - invoiced, exceeds: c.currency === 'UZS' && invoiced > c.amount });
  },

  /** Проверки документа: ИНН, блокировка контрагента, договор, сумма, НДС, дубли, наличие акта/фактуры. */
  async checks(id: ID): Promise<EinvoiceCheck[]> {
    const d = byId(id);
    return d ? delay(await checksOf(d)) : delay([]);
  },

  /** Автоприём документов через API Налогового комитета (PR-EHF-020, 033, 042). */
  async receiveFromSoliq(user: User, kinds: EinvoiceKind[] = ['invoice', 'work_act', 'reconciliation_act']): Promise<EinvoiceIntakeResult> {
    assertOperator(user);
    const created: EinvoiceIntakeResult['created'] = [];
    let autoRouted = 0;
    let last: EinvoiceIntakeResult['status'] = 'success';
    let exchangeId = '';
    for (const kind of kinds) {
      const op = kind === 'invoice' ? 'einvoice.receive' : kind === 'work_act' ? 'act.receive' : 'reconciliation.receive';
      const rec = await integrationHub.call('soliq', op, { since: new Date(Date.now() - DAY).toISOString(), buyerTin: EINVOICE_BANK_TIN, kind }, { userId: user.id });
      exchangeId = rec.id;
      if (rec.status !== 'success') {
        last = rec.status === 'queued' ? 'queued' : rec.status === 'quarantined' ? 'quarantined' : 'failed';
        continue;
      }
      const next = queue.findIndex((x) => x.kind === kind);
      if (next < 0) continue;
      const s = queue.splice(next, 1)[0]!;
      const at = now();
      const doc: EinvoiceDoc = {
        id: nextId('ei'),
        number: s.number,
        direction: 'incoming',
        kind: s.kind,
        source: 'soliq',
        date: at.slice(0, 10),
        receivedAt: at,
        counterpartyId: s.counterpartyId,
        ...(s.contractId ? { contractId: s.contractId } : {}),
        status: 'new',
        lines: s.lines,
        vatRate: s.vatRate,
        operatorId: `OP-7F3A-${2000 + db.length}`,
        history: [historyEvent(user.id, 'created', `Получен через API Налогового комитета (обмен ${rec.id})`)],
      };
      if (s.kind === 'reconciliation_act') {
        const r = await einvoicesApi.buildReconciliation(s.counterpartyId, `${at.slice(0, 4)}-07-01`, at.slice(0, 10));
        doc.reconciliation = r;
        doc.lines = [{ name: `Сальдо взаиморасчётов на ${at.slice(0, 10)}`, qty: 1, unit: 'док', unitPrice: r.closing }];
      }
      db.push(doc);
      created.push({ id: doc.id, number: doc.number, kind: doc.kind });
      const unit = await autoUnit(doc);
      if (unit) {
        await routeDoc(doc, unit, user, EINVOICE_UNIT_DAYS, 'Автоматическая маршрутизация по договору');
        autoRouted++;
      }
    }
    audit.log({ action: 'create', entity: 'einvoice', entityId: exchangeId, details: `soliq intake: ${created.length} (${created.map((c) => c.number).join(', ')})`, user: { id: user.id, fullName: user.fullName, role: user.role } });
    emit();
    return delay({ exchangeId, status: created.length ? 'success' : last, created, autoRouted });
  },

  /** Направить документ в подразделение ЦА / региональный центр / ЦБУ (PR-EHF-005…007, 024, 036, 045). */
  async route(id: ID, orgUnitKey: string, user: User, opts: { dueDays?: number; comment?: string } = {}): Promise<void> {
    assertOperator(user);
    const d = byId(id);
    if (!d || d.direction !== 'incoming' || !['new', 'routed'].includes(d.status)) throw apiError('DOCUMENT_CANNOT_BE_ROUTED');
    const days = opts.dueDays ?? EINVOICE_UNIT_DAYS;
    if (!(days >= 1 && days <= EINVOICE_LEGAL_DAYS)) throw apiError('INVALID_DUE_DAYS');
    await routeDoc(d, orgUnitKey, user, days, opts.comment);
    emit();
    await delay(null);
  },

  /** Решение подразделения: подтвердить (документ уходит по маршруту) или отклонить с причиной. */
  async unitDecision(id: ID, user: User, decision: 'confirmed' | 'rejected', reason?: string): Promise<void> {
    const d = byId(id);
    const a = d?.assignment;
    if (!d || !a || d.status !== 'routed' || a.decision) throw apiError('NO_DECISION_EXPECTED');
    if (!a.assigneeIds.includes(user.id) && !directory.hasRole(user, 'admin')) throw apiError('NOT_ALLOWED');
    if (decision === 'rejected' && !reason?.trim()) throw apiError('REASON_REQUIRED');
    a.decision = decision;
    a.decidedAt = now();
    a.decidedBy = user.id;
    if (reason?.trim()) a.reason = reason.trim();
    const late = einvoiceUnitOverdueDays(a);
    if (late) {
      d.penalties = [...(d.penalties ?? []), { orgUnitKey: a.orgUnitKey, unitName: a.unitName, userIds: a.assigneeIds, days: late, points: late, at: now() }];
      notify({ roles: ['hr'], kind: 'system', level: 'warning', title: L(`KPI: нарушение срока по ${d.number}`, `KPI: ${d.number} bo'yicha muddat buzilishi`, `KPI: deadline breach on ${d.number}`), body: L(`${a.unitName.ru}: ${late} дн. просрочки, −${late} балл.`, `${a.unitName.uz}: ${late} kun kechikish, −${late} ball`, `${a.unitName.en ?? a.unitName.uz}: ${late} days late, −${late} points`), link: `/einvoices/${d.id}` });
    }
    audit.log({ action: decision === 'confirmed' ? 'approve' : 'reject', entity: 'einvoice', entityId: d.id, entityLabel: d.number, details: `unit ${a.orgUnitKey}${reason ? `: ${reason}` : ''}`, user: { id: user.id, fullName: user.fullName, role: user.role } });
    if (decision === 'confirmed') {
      d.history.push(historyEvent(user.id, 'approved', `Подразделение подтвердило${late ? ` (просрочка ${late} дн.)` : ''}`));
      d.status = 'pending';
      d.history.push(historyEvent(user.id, 'submitted'));
      openTask(d, user);
    } else {
      d.status = 'rejected';
      d.rejectReason = reason!.trim();
      d.history.push(historyEvent(user.id, 'rejected', `Подразделение отклонило: ${reason}`));
      notify({ roles: ['accountant'], kind: 'rejected', level: 'danger', title: L(`${d.number}: отклонён подразделением`, `${d.number}: bo'linma rad etdi`, `${d.number}: rejected by unit`), body: reason!, link: `/einvoices/${d.id}` });
      void respondToSupplier(d, 'rejected');
      void archiveDoc(d, user.id);
    }
    emit();
    await delay(null);
  },

  async create(input: NewEinvoiceInput, user: User): Promise<EinvoiceDoc> {
    assertOperator(user);
    const kind = input.kind ?? 'invoice';
    if (!input.counterpartyId || !input.lines.length || input.lines.some((l) => !l.name.trim() || !(l.qty > 0) || !(l.unitPrice > 0 || kind === 'reconciliation_act' || (kind === 'free_form' && l.unitPrice >= 0)))) throw apiError('INVALID_INPUT');
    if (kind === 'reconciliation_act' && !input.reconciliation) throw apiError('RECONCILIATION_REQUIRED');
    if (kind === 'free_form' && !input.text?.trim()) throw apiError('TEXT_REQUIRED');
    const prefix = kind === 'invoice' ? 'XB-ESF' : kind === 'work_act' ? 'XB-AVR' : kind === 'reconciliation_act' ? 'XB-SV' : 'XB-DOC';
    const at = now();
    const doc: EinvoiceDoc = {
      id: nextId('ei'),
      number: nextNumber(prefix),
      direction: 'outgoing',
      kind,
      source: 'manual',
      date: input.date,
      receivedAt: at,
      counterpartyId: input.counterpartyId,
      ...(input.contractId ? { contractId: input.contractId } : {}),
      status: input.submit ? 'pending' : 'draft',
      lines: input.lines,
      vatRate: kind === 'reconciliation_act' || kind === 'free_form' ? 0 : EINVOICE_VAT_RATE,
      operatorId: '—',
      ...(input.issuerUnitKey ? { issuerUnitKey: input.issuerUnitKey } : {}),
      ...(input.basis ? { basis: input.basis } : {}),
      ...(input.basisRef ? { basisRef: input.basisRef } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(input.reconciliation ? { reconciliation: input.reconciliation } : {}),
      history: [historyEvent(user.id, 'created')],
    };
    db.push(doc);
    audit.log({ action: 'create', entity: 'einvoice', entityId: doc.id, entityLabel: doc.number, details: `${kind} · ${input.basis ?? ''}`, user: { id: user.id, fullName: user.fullName, role: user.role } });
    if (input.submit) {
      doc.history.push(historyEvent(user.id, 'submitted'));
      openTask(doc, user);
    }
    emit();
    return delay(doc);
  },

  /** Отправить на согласование (входящий — проверка перед акцептом без направления в подразделение, исходящий — перед отправкой). */
  async submit(id: ID, user: User): Promise<void> {
    assertOperator(user);
    const d = byId(id);
    if (!d || !['new', 'draft'].includes(d.status)) throw apiError('DOCUMENT_CANNOT_BE_SUBMITTED');
    d.status = 'pending';
    d.history.push(historyEvent(user.id, 'submitted'));
    openTask(d, user);
    emit();
    await delay(null);
  },

  /**
   * Зафиксировать подпись E-IMZO (запись создаёт платформенный SignModal). Входящий → «Подписан» (акцепт, ответ
   * поставщику через оператора), исходящий → отправка оператору ЭСФ.
   */
  async sign(id: ID, user: User, signatureId: ID): Promise<void> {
    assertOperator(user);
    const d = byId(id);
    if (!d) throw apiError('NOT_FOUND');
    const sig = signatureService.get(signatureId);
    if (!sig || sig.entity !== 'einvoice' || sig.entityId !== id || sig.userId !== user.id) throw apiError('SIGNATURE_NOT_FOUND');
    const allowed = d.direction === 'incoming' ? ['new', 'accepted'] : ['draft', 'approved'];
    if (!allowed.includes(d.status)) throw apiError('DOCUMENT_CANNOT_BE_SIGNED');
    d.signedBy = user.id;
    d.signedAt = sig.signedAt;
    d.signatureIds = [...(d.signatureIds ?? []), sig.id];
    d.history.push(historyEvent(user.id, 'approved', `Подписано ЭЦП E-IMZO (серт. ${sig.certSerial})`));
    audit.log({ action: 'approve', entity: 'einvoice', entityId: d.id, entityLabel: d.number, details: `E-IMZO ${sig.certSerial}`, user: { id: user.id, fullName: user.fullName, role: user.role } });
    if (d.direction === 'incoming') {
      d.status = 'signed';
      if (!d.postings) d.postings = einvoicePostings(d);
      void respondToSupplier(d, 'accepted');
      void archiveDoc(d, user.id);
    } else {
      d.status = 'sent';
      void sendToOperator(d, user.id);
      void archiveDoc(d, user.id);
    }
    emit();
    await delay(null);
  },

  async reject(id: ID, user: User, reason: string): Promise<void> {
    assertOperator(user);
    if (!reason.trim()) throw apiError('REASON_REQUIRED');
    const d = byId(id);
    if (!d || d.direction !== 'incoming' || !['new', 'routed', 'accepted'].includes(d.status)) throw apiError('DOCUMENT_CANNOT_BE_REJECTED');
    d.status = 'rejected';
    d.rejectReason = reason;
    d.history.push(historyEvent(user.id, 'rejected', reason));
    audit.log({ action: 'reject', entity: 'einvoice', entityId: d.id, entityLabel: d.number, details: reason, user: { id: user.id, fullName: user.fullName, role: user.role } });
    void respondToSupplier(d, 'rejected');
    void archiveDoc(d, user.id);
    emit();
    await delay(null);
  },

  /** Имитация ответа покупателя по исходящему документу (в реальности приходит от оператора). */
  async receiveBuyerResponse(id: ID, accepted: boolean): Promise<void> {
    const d = byId(id);
    if (!d || d.direction !== 'outgoing' || d.status !== 'sent') throw apiError('NO_RESPONSE_EXPECTED');
    d.status = accepted ? 'accepted' : 'rejected';
    if (!accepted) d.rejectReason = 'Покупатель отклонил документ';
    d.history.push(historyEvent(d.signedBy ?? 'u7', 'status_changed', accepted ? 'Покупатель подтвердил получение' : 'Покупатель отклонил документ'));
    emit();
    await delay(null);
  },

  /** Бухгалтерские проводки в АБС (пакет postings.batch с контрольной суммой). */
  async post(id: ID, user: User): Promise<void> {
    assertOperator(user);
    const d = byId(id);
    if (!d || !(d.direction === 'incoming' ? ['accepted', 'signed'] : ['sent', 'accepted']).includes(d.status)) throw apiError('DOCUMENT_CANNOT_BE_POSTED');
    if (d.postedAt) throw apiError('ALREADY_POSTED');
    const entries = einvoicePostings(d);
    if (!entries.length) throw apiError('NOTHING_TO_POST');
    const rec = await integrationHub.call('iabs', 'postings.batch', { batch: `EHF-${d.number}`, entries: entries.map((e) => ({ debit: e.debit, credit: e.credit, amount: e.amount })), controlSum: entries.reduce((s, e) => s + e.amount, 0) }, { idempotencyKey: `ehf-post-${d.id}`, userId: user.id });
    d.postings = entries;
    d.postingExchangeId = rec.id;
    if (rec.status === 'success') {
      d.postedAt = now();
      d.history.push(historyEvent(user.id, 'status_changed', `Проводки переданы в АБС (${entries.length}, обмен ${rec.id})`));
    } else d.history.push(historyEvent(user.id, 'status_changed', `Проводки: обмен с АБС — ${rec.status}`));
    emit();
    await delay(null);
  },

  /** Мемориальный ордер на оплату по документу (PR-EHF-029); привязка к графику платежей договора. */
  async createPaymentOrder(id: ID, user: User, input: { account: string; mfo: string }): Promise<void> {
    assertOperator(user);
    const d = byId(id);
    if (!d || d.direction !== 'incoming' || !['accepted', 'signed'].includes(d.status) || d.kind === 'reconciliation_act') throw apiError('PAYMENT_ORDER_NOT_AVAILABLE');
    if (d.paymentOrder && d.paymentOrder.status !== 'failed') throw apiError('PAYMENT_ORDER_EXISTS');
    if (!/^\d{20}$/.test(input.account) || !/^\d{5}$/.test(input.mfo)) throw apiError('INVALID_REQUISITES');
    const c = d.contractId ? await api.getContract(d.contractId) : undefined;
    const idx = c ? c.payments.findIndex((p) => !p.paid) : -1;
    d.paymentOrder = {
      number: nextNumber('MO'),
      createdAt: now(),
      createdBy: user.id,
      debit: '29802000',
      credit: '10301000',
      account: input.account,
      mfo: input.mfo,
      amount: einvoiceTotals(d.lines, d.vatRate).total,
      purpose: `Оплата по ${d.kind === 'work_act' ? 'акту выполненных работ' : d.kind === 'invoice' ? 'счёту-фактуре' : 'документу'} ${d.number}${c ? `, договор ${c.number}` : ''}`,
      status: 'draft',
      ...(idx >= 0 ? { contractPaymentIndex: idx } : {}),
    };
    d.history.push(historyEvent(user.id, 'status_changed', `Сформирован мемориальный ордер ${d.paymentOrder.number}`));
    emit();
    await delay(null);
  },

  /** Отправить мемориальный ордер в АБС; после исполнения закрывается платёж по графику договора. */
  async sendPaymentOrder(id: ID, user: User): Promise<void> {
    assertOperator(user);
    const d = byId(id);
    const po = d?.paymentOrder;
    if (!d || !po || !['draft', 'failed', 'queued'].includes(po.status)) throw apiError('PAYMENT_ORDER_CANNOT_BE_SENT');
    const rec = await integrationHub.call('iabs', 'payment.send', { doc: po.number, account: po.account, mfo: po.mfo, amount: po.amount, purpose: po.purpose }, { idempotencyKey: `ehf-pay-${d.id}-${po.number}`, userId: user.id });
    po.exchangeId = rec.id;
    if (rec.status === 'success') {
      po.status = 'paid';
      po.paidAt = now();
      po.transactionId = String((rec.response as { externalId?: string } | undefined)?.externalId ?? rec.id).replace('EXT', 'TRX');
      d.history.push(historyEvent(user.id, 'status_changed', `Мемориальный ордер ${po.number} исполнен (${po.transactionId})`));
      if (d.contractId && po.contractPaymentIndex !== undefined) {
        try {
          await api.markPaymentPaid(d.contractId, po.contractPaymentIndex, user);
          d.history.push(historyEvent(user.id, 'status_changed', `Закрыт платёж № ${po.contractPaymentIndex + 1} по графику договора`));
        } catch {
          /* договор не активен или платёж уже закрыт */
        }
      }
    } else po.status = rec.status === 'queued' ? 'queued' : 'failed';
    emit();
    await delay(null);
  },

  /** Передать документ в электронный архив вручную. */
  async archive(id: ID, user: User): Promise<void> {
    assertOperator(user);
    const d = byId(id);
    if (!d || !isFinal(d)) throw apiError('DOCUMENT_IS_NOT_FINAL');
    await archiveDoc(d, user.id);
    emit();
    await delay(null);
  },

  /** Расчёт акта сверки по контрагенту за период: документы поставщика (дебет) и оплаты по договорам (кредит). */
  async buildReconciliation(counterpartyId: ID, from: string, to: string): Promise<EinvoiceReconciliation> {
    const contracts = (await api.listContracts()).filter((c) => c.counterpartyId === counterpartyId);
    const lines = [
      ...db
        .filter((d) => d.counterpartyId === counterpartyId && d.direction === 'incoming' && ['accepted', 'signed'].includes(d.status) && d.kind !== 'reconciliation_act' && d.date >= from && d.date <= to)
        .map((d) => ({ date: d.date, doc: d.number, debit: einvoiceTotals(d.lines, d.vatRate).total, credit: 0 })),
      ...contracts.flatMap((c) => c.payments.filter((p) => p.paid && p.dueDate >= from && p.dueDate <= to && c.currency === 'UZS').map((p) => ({ date: p.dueDate, doc: `${c.number} · платёж`, debit: 0, credit: p.amount }))),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const closing = lines.reduce((s, l) => s + l.debit - l.credit, 0);
    return delay({ periodFrom: from, periodTo: to, opening: 0, lines, closing });
  },

  /** Отчёт по документам за период (PR-EHF-031, 040, 051). */
  report(filter: { from?: string; to?: string } = {}): Promise<EinvoiceReportRow[]> {
    const rows: EinvoiceReportRow[] = [];
    for (const direction of ['incoming', 'outgoing'] as const)
      for (const kind of EINVOICE_KINDS) {
        const list = db.filter((d) => d.direction === direction && d.kind === kind && inPeriod(d, filter.from, filter.to));
        if (!list.length) continue;
        const t = list.reduce((acc, d) => {
          const x = d.kind === 'reconciliation_act' ? { net: 0, vat: 0, total: 0 } : einvoiceTotals(d.lines, d.vatRate);
          return { net: acc.net + x.net, vat: acc.vat + x.vat, total: acc.total + x.total };
        }, { net: 0, vat: 0, total: 0 });
        rows.push({
          kind,
          direction,
          count: list.length,
          ...t,
          accepted: list.filter((d) => ['accepted', 'signed', 'sent'].includes(d.status)).length,
          rejected: list.filter((d) => d.status === 'rejected').length,
          open: list.filter((d) => !isFinal(d)).length,
        });
      }
    return delay(rows);
  },

  /** Исполнение по подразделениям: направлено, подтверждено, просрочено, штрафные баллы KPI. */
  unitReport(filter: { from?: string; to?: string } = {}): Promise<EinvoiceUnitReportRow[]> {
    return delay(unitRows(db.filter((d) => inPeriod(d, filter.from, filter.to))));
  },

  /** DASHBOARD исполнения в реальном времени (PR-EHF-052). */
  dashboard(): Promise<EinvoiceDashboard> {
    maybeScan();
    const lights = { green: 0, yellow: 0, red: 0, black: 0 };
    const critical: EinvoiceDashboard['critical'] = [];
    for (const d of db) {
      const l = einvoiceLight(d);
      if (l === 'done') continue;
      lights[l]++;
      if (l !== 'green') critical.push({ id: d.id, number: d.number, kind: d.kind, light: l, day: einvoiceDay(d), holder: holderOf(d) });
    }
    const daily = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(Date.now() - (13 - i) * DAY).toISOString().slice(0, 10);
      return {
        date,
        received: db.filter((d) => d.direction === 'incoming' && d.receivedAt.slice(0, 10) === date).length,
        decided: db.filter((d) => d.history.some((h) => h.at.slice(0, 10) === date && (h.action === 'rejected' || (h.action === 'approved' && /ЭЦП|E-IMZO/.test(h.comment ?? ''))))).length,
      };
    });
    return delay({ lights, byUnit: unitRows(db), daily, critical: critical.sort((a, b) => b.day - a.day) });
  },
};
