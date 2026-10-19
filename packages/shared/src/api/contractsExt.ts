// P2-PROC: договоры (ТЗ 4.2.2) — виды и меню, ручной ввод и шаблоны, редактируемые графики, этапы и
// обязательства, санкции, мониторинг и уведомления, дашборд, настройки (счета, виды, инициаторы), отчёты
// (в т. ч. формы ЦБ и пользовательские), резервы по Положению № 2696, табло «не оплачено к 25-му»,
// платёжные поручения с маршрутом `payment`, E-IMZO и отправкой в iABS, автозакрытие задолженности.
import { clone, delay, emit, historyEvent, nextId, nextNumber, now, today } from '../bus';
import { approvalEngine } from '../engine';
import { audit, diffFields } from '../audit';
import { budgetSource } from '../budgetBridge';
import { can } from '../security';
import { integrationHub } from '../services/integrations';
import { signatureService } from '../services/signature';
import type { Contract, ContractPayment, Counterparty, ID, User } from '../types';
import type {
  ContractAccount, ContractKind, ContractKindSetting, ContractPaymentTerms, ContractReportForm, ContractReserve, ContractSanction, ContractStage, ContractSubkind,
  ContractTemplate, PaymentOrder, ReserveClass,
} from './procTypes';
import { coreTables, procTables } from './procStore';
import { addPosting, daysBetween, fail, kindSetting, notifyDoc, toUzs, usersByRole, who } from './procCommon';
import { supplierAdmission } from './procurementExt';

export const CONTRACT_KINDS: ContractKind[] = ['services', 'long_term', 'fixed_assets', 'utilities', 'other_receivables', 'rent', 'construction', 'swift', 'bank_services'];
export const CONTRACT_SUBKINDS: Partial<Record<ContractKind, ContractSubkind[]>> = {
  rent: ['building_legal', 'building_individual', 'atm_legal', 'atm_individual', 'housing'],
  utilities: ['gas', 'electricity', 'water', 'waste', 'heating'],
  construction: ['construction', 'current_repair', 'capital_repair'],
  bank_services: ['property_sale', 'bank_service'],
  other_receivables: ['invoice', 'exchange_advance'],
};
/** Виды с периодическими платежами — табло «не оплачено к 25-му» (PR-CON-042). */
const PERIODIC: ContractKind[] = ['long_term', 'rent', 'utilities'];
const BANK_ACCOUNT = '20210000900100000001';

const isAdmin = (u: User) => u.role === 'admin' || !!u.extraRoles?.includes('admin');
const ensure = (ok: boolean) => {
  if (!ok) fail('forbidden');
};
const link = (c: Pick<Contract, 'id'>) => `/contracts/${c.id}`;
const paidSum = (c: Contract) => c.payments.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0);

// ---------------------------------------------------------------------------------------------
// График платежей и текст по шаблону

/** График платежей по условиям оплаты (PR-CON-006/007): 100% / аванс / периодические / по ЭСФ / по актам. */
export function generateSchedule(terms: ContractPaymentTerms, amount: number, start: string, end: string): ContractPayment[] {
  const s = new Date(start.slice(0, 10));
  const e = new Date(end.slice(0, 10));
  if (terms.type === 'full') return [{ dueDate: end.slice(0, 10), amount, paid: false, kind: 'final' }];
  if (terms.type === 'advance' || (terms.type === 'by_act' && terms.advancePct)) {
    const adv = Math.round((amount * (terms.advancePct ?? 30)) / 100);
    return [
      { dueDate: start.slice(0, 10), amount: adv, paid: false, kind: 'advance' },
      { dueDate: end.slice(0, 10), amount: amount - adv, paid: false, kind: terms.type === 'by_act' ? 'by_act' : 'final' },
    ];
  }
  const step = terms.periodicity === 'quarterly' ? 3 : 1;
  const dates: string[] = [];
  const d = new Date(s.getFullYear(), s.getMonth(), 1);
  while (d <= e && dates.length < 120) {
    const day = terms.type === 'by_invoice' ? 25 : 20;
    const due = new Date(d.getFullYear(), d.getMonth() + step - 1, day);
    dates.push(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + step);
  }
  if (!dates.length) dates.push(end.slice(0, 10));
  const part = Math.floor(amount / dates.length);
  const kind = terms.type === 'by_invoice' ? 'by_invoice' : terms.type === 'by_act' ? 'by_act' : 'periodic';
  return dates.map((dueDate, i) => ({ dueDate, amount: i === dates.length - 1 ? amount - part * (dates.length - 1) : part, paid: false, kind }));
}

/** Текст договора по шаблону с подстановкой реквизитов из справочников (PR-CON-021/022). */
export function renderContractText(tpl: ContractTemplate, c: Pick<Contract, 'number' | 'subject' | 'amount' | 'currency' | 'startDate' | 'endDate' | 'paymentTerms' | 'penalty'>, cp: Counterparty | undefined, signer: string): string {
  const fmt = (n: number) => `${n.toLocaleString('ru-RU')} ${c.currency === 'UZS' ? 'сум' : c.currency}`;
  const terms = c.paymentTerms
    ? ({ full: '100% после исполнения', advance: `аванс ${c.paymentTerms.advancePct ?? 30}%, остаток после приёмки`, periodic: c.paymentTerms.periodicity === 'quarterly' ? 'ежеквартально' : 'ежемесячно', by_invoice: 'ежемесячно на основании счёта-фактуры', by_act: `по актам выполненных работ${c.paymentTerms.advancePct ? `, аванс ${c.paymentTerms.advancePct}%` : ''}` } as const)[c.paymentTerms.type]
    : '—';
  const individual = cp?.type === 'individual_entrepreneur';
  const vars: Record<string, string> = {
    number: c.number,
    date: today(),
    signer,
    counterparty: cp?.name ?? '—',
    tin: cp?.tin ?? '—',
    role: individual ? 'Арендодатель' : 'Исполнитель',
    role_gen: individual ? 'Арендодателя' : 'Исполнителя',
    director: cp?.director ?? '—',
    subject: c.subject,
    amount: fmt(c.amount),
    terms,
    start: c.startDate.slice(0, 10),
    end: c.endDate.slice(0, 10),
    penalty: String(c.penalty?.ratePerDay ?? tpl.penalty.ratePerDay),
    cap: String(c.penalty?.capPct ?? tpl.penalty.capPct),
    account: cp?.bankAccount ?? cp?.iban ?? '—',
    bank: cp?.bankName ?? '—',
    mfo: cp?.mfo ?? cp?.swiftBic ?? '—',
  };
  return tpl.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
}

// ---------------------------------------------------------------------------------------------
// Исполнение: принятая стоимость, задолженность, санкции

/** Расчёты по договору: принято (акты/приёмки/исполненные этапы), оплачено, аванс (дебиторка), кредиторка. */
export function contractBalance(c: Contract) {
  const t = procTables();
  const docs =
    t.acceptances.filter((a) => a.contractId === c.id && a.status === 'received').reduce((s, a) => s + a.lines.reduce((x, l) => x + l.acceptedQty * l.unitPrice, 0), 0) +
    t.acts.filter((a) => a.contractId === c.id && a.status === 'completed').reduce((s, a) => s + a.lines.reduce((x, l) => x + l.qty * l.unitPrice, 0) * (1 + a.vatRate / 100), 0);
  const stagesDone = (c.stages ?? []).filter((s) => s.status === 'done' && (s.obligation === 'works' || s.obligation === 'delivery')).reduce((s, x) => s + (x.amount ?? 0), 0);
  const accrued = PERIODIC.includes(c.kind ?? 'services') ? c.payments.filter((p) => p.dueDate <= today()).reduce((s, p) => s + p.amount, 0) : 0;
  const accepted = Math.round(Math.min(c.amount, Math.max(docs, stagesDone, accrued)));
  const paid = paidSum(c);
  const receivable = Math.max(0, paid - accepted);
  const payable = Math.max(0, accepted - paid);
  return { accepted, paid, receivable, payable, closed: receivable === 0 && payable === 0 && paid >= c.amount };
}

/** Неустойка по просроченному этапу: % в день от суммы этапа, не более cap % от цены договора. */
export function penaltyFor(c: Contract, stage: ContractStage, asOf = today()) {
  const rate = c.penalty?.ratePerDay ?? 0.1;
  const cap = c.penalty?.capPct ?? 10;
  const end = stage.status === 'done' && stage.doneAt ? stage.doneAt.slice(0, 10) : asOf;
  const days = Math.max(0, daysBetween(stage.dueDate, end));
  const base = stage.amount ?? c.amount;
  const already = (c.sanctions ?? []).filter((s) => s.status !== 'waived' && s.stageId !== stage.id).reduce((s, x) => s + x.amount, 0);
  const amount = Math.max(0, Math.min(Math.round((base * rate * days) / 100), Math.round((c.amount * cap) / 100) - already));
  return { days, base, rate, cap, amount };
}

function overdueStages(c: Contract) {
  return (c.stages ?? []).filter((s) => s.status === 'planned' && s.dueDate < today());
}

// ---------------------------------------------------------------------------------------------
// Резервы по Положению № 2696

const RESERVE_CLASSES: { cls: ReserveClass; maxDays: number; pct: number }[] = [
  { cls: 'standard', maxDays: 30, pct: 1 },
  { cls: 'substandard', maxDays: 90, pct: 10 },
  { cls: 'unsatisfactory', maxDays: 180, pct: 25 },
  { cls: 'doubtful', maxDays: 365, pct: 50 },
  { cls: 'bad', maxDays: Infinity, pct: 100 },
];
export function classify(days: number) {
  return RESERVE_CLASSES.find((r) => days <= r.maxDays)!;
}

/** Просроченная дебиторская задолженность по договору и число дней просрочки. */
export function overdueReceivable(c: Contract): { base: number; days: number } {
  if (c.kind === 'bank_services') {
    const received = (c.receipts ?? []).reduce((s, r) => s + r.amount, 0);
    const due = c.payments.filter((p) => p.dueDate < today()).reduce((s, p) => s + p.amount, 0);
    const base = Math.max(0, due - received);
    const first = c.payments.filter((p) => p.dueDate < today()).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    return { base: toUzs(base, c.currency), days: base && first ? daysBetween(first.dueDate, today()) : 0 };
  }
  const bal = contractBalance(c);
  const late = overdueStages(c).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (!bal.receivable || !late) return { base: 0, days: 0 };
  return { base: toUzs(bal.receivable, c.currency), days: daysBetween(late.dueDate, today()) };
}

// ---------------------------------------------------------------------------------------------
// Платёжные поручения: маршрут `payment` (entityId = `${contractId}:${orderId}`)

const orderKey = (o: PaymentOrder) => `${o.contractId}:${o.id}`;
const orderOf = (entityId: ID) => procTables().orders.find((o) => o.id === entityId.split(':')[1] || o.id === entityId);

approvalEngine.register('payment', {
  onHistory: (id, e) => orderOf(id)?.history.push(e),
  onFinal: (id, ok) => {
    const o = orderOf(id);
    if (!o) return;
    o.status = ok ? 'approved' : 'rejected';
    notifyDoc([o.createdBy], { key: ok ? 'proc_n_order_approved' : 'proc_n_order_rejected', params: { number: o.number } }, o.purpose, `/contracts/payments/${o.id}`, ok ? 'success' : 'danger');
  },
  onReturned: (id) => {
    const o = orderOf(id);
    if (o) o.status = 'draft';
  },
  onResubmitted: (id) => {
    const o = orderOf(id);
    if (o) o.status = 'pending';
  },
  getContext: (id) => {
    const o = orderOf(id);
    const c = o ? coreTables().contracts.find((x) => x.id === o.contractId) : undefined;
    return o && c ? { kind: c.kind, type: o.type, basis: o.basis, departmentId: c.departmentId } : undefined;
  },
});

/** P3: платёж по договору из заявки (UZS) заблокирует hard-check статьи бюджета. */
function orderBudgetBlocked(c: Contract, paymentIndex: number | undefined, amount: number): boolean {
  if (c.currency !== 'UZS' || !c.requestId) return false;
  const req = coreTables().procurement.find((r) => r.id === c.requestId);
  if (!req?.budgetLineId) return false;
  return budgetSource.paymentBlocked({ budgetLineId: req.budgetLineId, amount, ref: `${c.id}:${paymentIndex}`, departmentId: req.departmentId });
}

function executeOrder(o: PaymentOrder, user: User) {
  const db = coreTables();
  const c = db.contracts.find((x) => x.id === o.contractId)!;
  o.status = 'executed';
  o.history.push(historyEvent(user.id, 'status_changed', 'executed'));
  const p = o.paymentIndex !== undefined ? c.payments[o.paymentIndex] : undefined;
  if (p && !p.paid) {
    p.paid = true;
    p.paidAt = today();
    p.orderId = o.id;
    // Оплата по договору из заявки списывается со статьи бюджета (UZS)
    const req = c.requestId ? db.procurement.find((r) => r.id === c.requestId) : undefined;
    const line = req ? db.budgetLines.find((b) => b.id === req.budgetLineId) : undefined;
    // P2-FINPLAN: бюджетный контроль и факт — через мост модуля бюджетирования
    // P3: бюджетный контроль выполнен до отправки (createOrder/sendOrder) — здесь только списание факта исполненного платежа
    if (line && c.currency === 'UZS' && !budgetSource.payment({ budgetLineId: line.id, amount: p.amount, ref: `${c.id}:${o.paymentIndex}`, refLabel: `${c.number} · ${o.number}`, user, departmentId: req!.departmentId, force: true })) line.spent += p.amount;
  }
  c.history.push(historyEvent(user.id, 'status_changed', `${o.number}: ${o.amount} ${o.currency}`));
  // PR-CON-044/050: аванс — с дебиторского счёта; после приёмки — кредиторский счёт
  const s = kindSetting(c.kind);
  const advance = o.basis === 'advance' || p?.kind === 'advance';
  o.postingId = addPosting({ source: 'payment', docKind: 'payment_order', docId: o.id, docNumber: o.number, contractId: c.id, costCenterKey: o.costCenterKey, entries: [{ debit: advance ? s.advanceAccount : s.payableAccount, credit: '10501000', amount: toUzs(o.amount, o.currency), purpose: o.purpose }] }, user).id;
  // PR-CON-052: автоматическое закрытие задолженности — зачёт аванса против принятых обязательств
  const bal = contractBalance(c);
  if (bal.closed) c.history.push(historyEvent(user.id, 'status_changed', 'Задолженность по договору закрыта'));
  audit.log({ action: 'update', entity: 'payment_order', entityId: o.id, entityLabel: o.number, details: `executed · ${o.amount} ${o.currency}`, user: who(user) });
}

export interface ManualContractInput {
  kind: ContractKind;
  subkind?: ContractSubkind;
  subject: string;
  counterpartyId: ID;
  departmentId: ID;
  initiatorDeptIds: ID[];
  costCenterKey: string;
  amount: number;
  currency: Contract['currency'];
  startDate: string;
  endDate: string;
  paymentTerms: ContractPaymentTerms;
  templateId?: ID;
  objectInfo?: string;
  invoiceRef?: { number: string; date: string };
  penalty?: { ratePerDay: number; capPct: number };
  payments?: ContractPayment[];
  stages?: Omit<ContractStage, 'id' | 'status'>[];
  submit: boolean;
}

export interface OrderInput {
  contractId: ID;
  paymentIndex?: number;
  amount: number;
  purpose: string;
  basis: PaymentOrder['basis'];
  einvoiceId?: ID;
  actId?: ID;
  submit: boolean;
}

export const contractsApi = {
  kinds: CONTRACT_KINDS,
  subkinds: CONTRACT_SUBKINDS,
  generateSchedule,
  penaltyFor,
  contractBalance,

  // ---------- Ручной ввод договора (PR-CON-016), шаблоны (PR-CON-021/022) ----------
  async createManual(input: ManualContractInput, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const db = coreTables();
    const t = procTables();
    if (!input.subject.trim() || !input.counterpartyId || !input.departmentId || !input.startDate || !input.endDate || !input.costCenterKey) fail('required');
    if (!(input.amount > 0)) fail('amount');
    if (input.endDate < input.startDate) fail('dates');
    if (!t.initiatorDepts.includes(input.departmentId)) fail('initiator');
    if (input.kind === 'other_receivables' && !input.invoiceRef?.number) fail('invoice_ref');
    const cp = db.counterparties.find((c) => c.id === input.counterpartyId);
    if (!cp) fail('required');
    if (input.kind !== 'bank_services' && !supplierAdmission(cp!.id).allowed) fail('supplier_blocked');
    if (input.kind === 'swift' && (cp!.type !== 'foreign' || input.currency === 'UZS')) fail('swift');
    const payments = input.payments?.length ? clone(input.payments) : generateSchedule(input.paymentTerms, input.amount, input.startDate, input.endDate);
    const sum = payments.reduce((s, p) => s + p.amount, 0);
    if (sum !== input.amount) fail('schedule_sum', String(sum));
    const tpl = input.templateId ? t.templates.find((x) => x.id === input.templateId) : t.templates.find((x) => x.kind === input.kind);
    const direct = input.kind === 'other_receivables';
    const c: Contract = {
      id: nextId('k'),
      number: nextNumber(direct ? 'DZ' : 'DG'),
      subject: input.subject.trim(),
      counterpartyId: cp!.id,
      departmentId: input.departmentId,
      amount: Math.round(input.amount),
      currency: input.currency,
      startDate: input.startDate,
      endDate: input.endDate,
      status: direct ? 'active' : input.submit ? 'pending' : 'draft',
      kind: input.kind,
      ...(input.subkind ? { subkind: input.subkind } : {}),
      paymentTerms: clone(input.paymentTerms),
      initiatorDeptIds: [...new Set([input.departmentId, ...input.initiatorDeptIds])],
      costCenterKey: input.costCenterKey,
      source: 'manual',
      ...(tpl ? { templateId: tpl.id } : {}),
      penalty: input.penalty ?? tpl?.penalty ?? { ratePerDay: 0.1, capPct: 10 },
      ...(input.objectInfo?.trim() ? { objectInfo: input.objectInfo.trim() } : {}),
      ...(input.invoiceRef ? { invoiceRef: input.invoiceRef } : {}),
      payments,
      stages: (input.stages ?? []).map((s, i) => ({ ...s, id: `s${i + 1}`, status: 'planned' as const })),
      history: [historyEvent(user.id, 'created')],
    };
    if (tpl) c.text = renderContractText(tpl, c, cp, user.fullName);
    db.contracts.unshift(c);
    if (!direct) addPosting({ source: 'contract', docKind: 'contract', docId: c.id, docNumber: c.number, contractId: c.id, costCenterKey: c.costCenterKey, entries: [{ debit: '90963000', credit: '96399000', amount: toUzs(c.amount, c.currency), purpose: `Обязательства по договору ${c.number}` }] }, user);
    if (c.status === 'pending') {
      c.history.push(historyEvent(user.id, 'submitted'));
      approvalEngine.open({ entity: 'contract', entityId: c.id, number: c.number, title: c.subject, requesterId: user.id, amount: c.amount, currency: c.currency, context: { kind: c.kind, departmentId: c.departmentId } });
    }
    audit.log({ action: 'create', entity: 'contract', entityId: c.id, entityLabel: c.number, details: `manual · ${c.kind} · ${c.amount} ${c.currency}`, user: who(user) });
    emit();
    return delay(c);
  },
  renderText(templateId: ID, contractId: ID, user: User) {
    const db = coreTables();
    const tpl = procTables().templates.find((x) => x.id === templateId);
    const c = db.contracts.find((x) => x.id === contractId);
    if (!tpl || !c) fail('not_found');
    return renderContractText(tpl!, c!, db.counterparties.find((x) => x.id === c!.counterpartyId), user.fullName);
  },
  async applyTemplate(contractId: ID, templateId: ID, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const db = coreTables();
    const c = db.contracts.find((x) => x.id === contractId);
    const tpl = procTables().templates.find((x) => x.id === templateId);
    if (!c || !tpl || !['draft', 'pending'].includes(c.status)) fail('bad_state');
    c!.templateId = tpl!.id;
    c!.text = renderContractText(tpl!, c!, db.counterparties.find((x) => x.id === c!.counterpartyId), user.fullName);
    c!.history.push(historyEvent(user.id, 'commented', `Шаблон: ${tpl!.name.ru}`));
    emit();
    await delay(null);
  },
  async recordSignature(contractId: ID, signatureId: ID, user: User) {
    const c = coreTables().contracts.find((x) => x.id === contractId);
    const sig = signatureService.get(signatureId);
    if (!c || !sig || sig.entity !== 'contract' || sig.entityId !== contractId || sig.userId !== user.id) fail('signature');
    c!.signatureIds = [...new Set([...(c!.signatureIds ?? []), signatureId])];
    c!.history.push(historyEvent(user.id, 'commented', `E-IMZO ${sig!.certSerial}`));
    emit();
    await delay(null);
  },
  /** Подразделения-инициаторы по договору (PR-CON-019/020). */
  async setInitiators(contractId: ID, departmentId: ID, initiatorDeptIds: ID[], user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const c = coreTables().contracts.find((x) => x.id === contractId);
    const allowed = procTables().initiatorDepts;
    if (!c || !allowed.includes(departmentId) || initiatorDeptIds.some((d) => !allowed.includes(d))) fail('initiator');
    const before = { departmentId: c!.departmentId, initiatorDeptIds: (c!.initiatorDeptIds ?? []).join(',') };
    c!.departmentId = departmentId;
    c!.initiatorDeptIds = [...new Set([departmentId, ...initiatorDeptIds])];
    audit.log({ action: 'update', entity: 'contract', entityId: c!.id, entityLabel: c!.number, changes: diffFields(before, { departmentId, initiatorDeptIds: c!.initiatorDeptIds.join(',') }), user: who(user) });
    emit();
    await delay(null);
  },

  // ---------- График и этапы (PR-CON-026/027/043) ----------
  async updateSchedule(contractId: ID, payments: ContractPayment[], user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const c = coreTables().contracts.find((x) => x.id === contractId);
    if (!c || ['expired', 'terminated'].includes(c.status)) fail('bad_state');
    const paidBefore = c!.payments.filter((p) => p.paid);
    const keptPaid = payments.filter((p) => p.paid);
    if (paidBefore.length !== keptPaid.length || paidBefore.some((p, i) => p.amount !== keptPaid[i]?.amount || p.dueDate !== keptPaid[i]?.dueDate)) fail('paid_locked');
    if (payments.some((p) => !(p.amount > 0) || !p.dueDate)) fail('required');
    const sum = payments.reduce((s, p) => s + p.amount, 0);
    if (sum !== c!.amount) fail('schedule_sum', String(sum));
    const before = c!.payments.map((p) => `${p.dueDate}:${p.amount}`).join('; ');
    c!.payments = clone(payments).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    audit.log({ action: 'update', entity: 'contract', entityId: c!.id, entityLabel: c!.number, changes: [{ field: 'payments', from: before, to: c!.payments.map((p) => `${p.dueDate}:${p.amount}`).join('; ') }], user: who(user) });
    c!.history.push(historyEvent(user.id, 'commented', 'График платежей изменён'));
    emit();
    await delay(null);
  },
  async saveStages(contractId: ID, stages: ContractStage[], user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const c = coreTables().contracts.find((x) => x.id === contractId);
    if (!c) fail('not_found');
    if (stages.some((s) => !s.name.trim() || !s.dueDate)) fail('required');
    c!.stages = clone(stages).map((s, i) => ({ ...s, id: s.id || `s${Date.now()}${i}` }));
    audit.log({ action: 'update', entity: 'contract', entityId: c!.id, entityLabel: c!.number, details: `stages: ${stages.length}`, user: who(user) });
    emit();
    await delay(null);
  },
  async completeStage(contractId: ID, stageId: ID, docRef: string, user: User) {
    ensure(can(user, 'contracts', 'edit') || (can(user, 'procurement', 'edit') && (user.role === 'procurement' || isAdmin(user) || !!user.extraRoles?.includes('procurement'))));
    const c = coreTables().contracts.find((x) => x.id === contractId);
    const s = c?.stages?.find((x) => x.id === stageId);
    if (!c || !s || s.status === 'done') fail('bad_state');
    s!.status = 'done';
    s!.doneAt = today();
    if (docRef.trim()) s!.docRef = docRef.trim();
    c!.history.push(historyEvent(user.id, 'status_changed', `Этап исполнен: ${s!.name}`));
    emit();
    await delay(null);
  },
  /** Применение санкции: расчёт неустойки и претензия поставщику (PR-CON-030). */
  async applySanction(contractId: ID, stageId: ID, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const c = coreTables().contracts.find((x) => x.id === contractId);
    const s = c?.stages?.find((x) => x.id === stageId);
    if (!c || !s) fail('not_found');
    const p = penaltyFor(c!, s!);
    if (!p.days || !p.amount) fail('no_penalty');
    if ((c!.sanctions ?? []).some((x) => x.stageId === stageId && x.status !== 'waived')) fail('duplicate_sanction');
    const t = procTables();
    const claimNo = nextNumber('PT');
    const sanction: ContractSanction = { id: nextId('sn'), stageId, days: p.days, base: p.base, amount: p.amount, at: now(), by: user.id, status: 'claimed' };
    const cl = { id: nextId('cl'), number: claimNo, counterpartyId: c!.counterpartyId, contractId: c!.id, type: 'delay' as const, description: `Неустойка за просрочку этапа «${s!.name}»: ${p.days} дн. × ${p.rate}% от ${p.base}`, amount: p.amount, dueDate: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10), status: 'sent' as const, createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created'), historyEvent(user.id, 'submitted')] };
    t.claims.unshift(cl);
    sanction.claimId = cl.id;
    c!.sanctions = [...(c!.sanctions ?? []), sanction];
    c!.history.push(historyEvent(user.id, 'commented', `Санкция ${p.amount} (${claimNo})`));
    audit.log({ action: 'create', entity: 'contract_sanction', entityId: c!.id, entityLabel: c!.number, details: `${p.days}d · ${p.amount}`, user: who(user) });
    emit();
    return delay(sanction);
  },
  async updateSanction(contractId: ID, sanctionId: ID, status: 'paid' | 'waived', user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const s = coreTables().contracts.find((x) => x.id === contractId)?.sanctions?.find((x) => x.id === sanctionId);
    if (!s || s.status !== 'claimed') fail('bad_state');
    s!.status = status;
    emit();
    await delay(null);
  },

  // ---------- Мониторинг исполнения (PR-CON-004, 025, 027…033) ----------
  async monitoring() {
    const db = coreTables();
    const stages = db.contracts.flatMap((c) => (c.stages ?? []).map((s) => ({ contract: c, stage: s, overdueDays: s.status === 'planned' && s.dueDate < today() ? daysBetween(s.dueDate, today()) : 0, penalty: penaltyFor(c, s) })));
    const payments = db.contracts.filter((c) => c.status === 'active').flatMap((c) => c.payments.map((p, i) => ({ contract: c, index: i, payment: p, overdueDays: !p.paid && p.dueDate < today() ? daysBetween(p.dueDate, today()) : 0 }))).filter((x) => !x.payment.paid);
    const expiring = db.contracts.filter((c) => c.status === 'active' && daysBetween(today(), c.endDate) <= 30);
    const conditions = db.contracts.filter((c) => ['active', 'expired'].includes(c.status)).map((c) => {
      const st = c.stages ?? [];
      const obligations = st.length + c.payments.length;
      const done = st.filter((s) => s.status === 'done').length + c.payments.filter((p) => p.paid).length;
      return { contract: c, obligations, done, pct: obligations ? Math.round((done / obligations) * 100) : 100, balance: contractBalance(c) };
    });
    return delay(clone({ stages, payments, expiring, conditions }));
  },
  /** Контроль сроков: автосмена статуса истёкших договоров и уведомления ответственным (PR-CON-025/028/029). */
  async scan(user?: User) {
    const db = coreTables();
    let notified = 0;
    let expired = 0;
    for (const c of db.contracts) {
      if (c.status === 'active' && c.endDate.slice(0, 10) < today() && c.payments.every((p) => p.paid)) {
        c.status = 'expired';
        c.history.push(historyEvent(user?.id ?? 'system', 'status_changed', 'Срок действия истёк'));
        expired++;
      }
      if (c.status !== 'active') continue;
      const resp = [db.departments.find((d) => d.id === c.departmentId)?.headId, ...usersByRole('procurement')].filter((x): x is string => !!x);
      for (const s of overdueStages(c)) {
        notifyDoc(resp, { key: 'proc_n_stage_overdue', params: { number: c.number, name: s.name, days: String(daysBetween(s.dueDate, today())) } }, c.subject, link(c), 'warning', `con-stage:${c.id}:${s.id}`);
        notified++;
      }
      c.payments.forEach((p, i) => {
        if (!p.paid && p.dueDate < today()) {
          notifyDoc([...resp, ...usersByRole('treasury')], { key: 'proc_n_payment_overdue', params: { number: c.number, date: p.dueDate } }, c.subject, link(c), 'warning', `con-pay:${c.id}:${i}`);
          notified++;
        }
      });
      if (daysBetween(today(), c.endDate) <= 30 && daysBetween(today(), c.endDate) >= 0) notifyDoc(resp, { key: 'proc_n_expiring', params: { number: c.number, date: c.endDate.slice(0, 10) } }, c.subject, link(c), 'info', `con-exp:${c.id}`);
    }
    if (expired) emit();
    return delay({ notified, expired });
  },
  /** Дашборд договоров с разделением по видам (PR-CON-031/032). */
  async dashboard() {
    const db = coreTables();
    const list = db.contracts;
    const byKind = CONTRACT_KINDS.map((k) => {
      const rows = list.filter((c) => (c.kind ?? 'services') === k);
      return { kind: k, count: rows.length, active: rows.filter((c) => c.status === 'active').length, amount: rows.reduce((s, c) => s + toUzs(c.amount, c.currency), 0), unpaid: rows.reduce((s, c) => s + toUzs(c.payments.filter((p) => !p.paid).reduce((a, p) => a + p.amount, 0), c.currency), 0) };
    });
    const byStatus = ['draft', 'pending', 'active', 'expired', 'terminated'].map((s) => ({ status: s, count: list.filter((c) => c.status === s).length }));
    const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const upcoming = list.filter((c) => c.status === 'active').flatMap((c) => c.payments.map((p, i) => ({ contractId: c.id, number: c.number, subject: c.subject, index: i, dueDate: p.dueDate, amount: p.amount, currency: c.currency, paid: p.paid }))).filter((p) => !p.paid && p.dueDate >= today() && p.dueDate <= horizon).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const overdue = list.filter((c) => c.status === 'active').flatMap((c) => c.payments.filter((p) => !p.paid && p.dueDate < today()).map((p) => toUzs(p.amount, c.currency))).reduce((s, x) => s + x, 0);
    const cps = new Map<ID, number>();
    for (const c of list) cps.set(c.counterpartyId, (cps.get(c.counterpartyId) ?? 0) + toUzs(c.amount, c.currency));
    return delay({
      byKind, byStatus, upcoming, overdue,
      activeAmount: list.filter((c) => c.status === 'active').reduce((s, c) => s + toUzs(c.amount, c.currency), 0),
      overdueStages: list.reduce((s, c) => s + overdueStages(c).length, 0),
      reserves: list.reduce((s, c) => s + (c.reserve?.amount ?? 0), 0),
      topCounterparties: [...cps.entries()].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5),
    });
  },

  // ---------- Настройки (PR-CON-002, 034…037) ----------
  listAccounts: () => delay(procTables().accounts),
  async saveAccount(acc: ContractAccount, user: User) {
    ensure(can(user, 'contracts', 'approve'));
    if (!/^\d{8}$/.test(acc.code) || !acc.name.ru.trim() || !acc.name.uz.trim()) fail('account');
    const t = procTables();
    const cur = t.accounts.find((a) => a.code === acc.code);
    if (cur) Object.assign(cur, acc);
    else t.accounts.push(clone(acc));
    audit.log({ action: 'settings', entity: 'contract_account', entityId: acc.code, entityLabel: acc.name.ru, user: who(user) });
    emit();
    await delay(null);
  },
  listKindSettings: () => delay(procTables().kindSettings),
  async saveKindSetting(s: ContractKindSetting, user: User) {
    ensure(can(user, 'contracts', 'approve'));
    const t = procTables();
    const codes = t.accounts.map((a) => a.code);
    if (![s.advanceAccount, s.payableAccount, s.expenseAccount].every((c) => codes.includes(c))) fail('account');
    const cur = t.kindSettings.find((k) => k.kind === s.kind);
    const before = cur ? clone(cur) : undefined;
    if (cur) Object.assign(cur, clone(s));
    else t.kindSettings.push(clone(s));
    audit.log({ action: 'settings', entity: 'contract_kind', entityId: s.kind, changes: diffFields(before ?? {}, s, ['advanceAccount', 'payableAccount', 'expenseAccount', 'active']), user: who(user) });
    emit();
    await delay(null);
  },
  listTemplates: () => delay(procTables().templates),
  async saveTemplate(tpl: Omit<ContractTemplate, 'id'> & { id?: ID }, user: User) {
    ensure(can(user, 'contracts', 'approve'));
    if (!tpl.name.ru.trim() || !tpl.body.trim()) fail('required');
    const t = procTables();
    const cur = tpl.id ? t.templates.find((x) => x.id === tpl.id) : undefined;
    if (cur) Object.assign(cur, clone(tpl));
    else t.templates.push({ ...clone(tpl), id: nextId('tpl') });
    audit.log({ action: 'settings', entity: 'contract_template', entityId: tpl.id ?? 'new', entityLabel: tpl.name.ru, user: who(user) });
    emit();
    await delay(null);
  },
  initiatorDepts: () => delay(procTables().initiatorDepts),
  async setInitiatorDepts(ids: ID[], user: User) {
    ensure(can(user, 'contracts', 'approve'));
    if (!ids.length) fail('required');
    const before = procTables().initiatorDepts.join(',');
    procTables().initiatorDepts = [...new Set(ids)];
    audit.log({ action: 'settings', entity: 'contract_initiators', changes: [{ field: 'departments', from: before, to: ids.join(',') }], user: who(user) });
    emit();
    await delay(null);
  },

  // ---------- Отчёты (PR-CON-005, 038, 039) ----------
  async debtsReport() {
    const db = coreTables();
    return delay(db.contracts.filter((c) => c.status !== 'draft').map((c) => ({ id: c.id, number: c.number, subject: c.subject, kind: c.kind ?? 'services', counterpartyId: c.counterpartyId, currency: c.currency, amount: c.amount, ...contractBalance(c) })));
  },
  async paymentsReport(from: string, to: string) {
    const db = coreTables();
    return delay(db.contracts.flatMap((c) => c.payments.map((p, i) => ({ contractId: c.id, number: c.number, kind: c.kind ?? 'services', counterpartyId: c.counterpartyId, index: i, ...p, currency: c.currency }))).filter((p) => p.dueDate >= from && p.dueDate <= to).sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
  },
  /** Регламентная форма ЦБ: классификация дебиторской задолженности и резервы (Положение № 2696). */
  async cbReport() {
    const db = coreTables();
    const rows = db.contracts.filter((c) => c.reserve || overdueReceivable(c).base > 0).map((c) => {
      const r = overdueReceivable(c);
      const cls = c.reserve?.classification ?? classify(r.days).cls;
      return { id: c.id, number: c.number, counterpartyId: c.counterpartyId, base: c.reserve?.base ?? r.base, days: c.reserve?.overdueDays ?? r.days, cls, pct: c.reserve?.pct ?? classify(r.days).pct, reserve: c.reserve?.amount ?? 0, writtenOff: c.reserve?.writtenOff?.amount ?? 0, recovered: (c.reserve?.recoveries ?? []).reduce((s, x) => s + x.amount, 0) };
    });
    const summary = RESERVE_CLASSES.map((rc) => {
      const list = rows.filter((r) => r.cls === rc.cls);
      return { cls: rc.cls, pct: rc.pct, count: list.length, base: list.reduce((s, r) => s + r.base, 0), reserve: list.reduce((s, r) => s + r.reserve, 0) };
    });
    return delay({ rows, summary });
  },
  listReportForms: () => delay(procTables().reportForms),
  async saveReportForm(input: Omit<ContractReportForm, 'id' | 'createdBy' | 'createdAt'> & { id?: ID }, user: User) {
    ensure(can(user, 'contracts', 'view'));
    if (!input.name.trim() || !input.columns.length) fail('required');
    const t = procTables();
    const cur = input.id ? t.reportForms.find((f) => f.id === input.id) : undefined;
    if (cur) Object.assign(cur, clone(input));
    else t.reportForms.push({ ...clone(input), id: nextId('rf'), createdBy: user.id, createdAt: now() });
    emit();
    await delay(null);
  },
  async deleteReportForm(id: ID, user: User) {
    const t = procTables();
    const f = t.reportForms.find((x) => x.id === id);
    if (!f || (f.createdBy !== user.id && !isAdmin(user))) fail('forbidden');
    t.reportForms = t.reportForms.filter((x) => x.id !== id);
    emit();
    await delay(null);
  },

  // ---------- Резервы по Положению № 2696 (PR-CON-040/041) ----------
  async recalcReserves(user: User) {
    ensure(can(user, 'contracts', 'edit') && (user.role === 'accountant' || user.role === 'finance' || isAdmin(user) || !!user.extraRoles?.some((r) => r === 'accountant' || r === 'finance')));
    const db = coreTables();
    const s = kindSetting('services');
    let changed = 0;
    for (const c of db.contracts) {
      if (c.reserve?.writtenOff) continue;
      const { base, days } = overdueReceivable(c);
      const cur = c.reserve?.amount ?? 0;
      if (!base || days <= 0) {
        if (c.reserve && cur > 0) {
          addPosting({ source: 'reserve_reversal', docKind: 'reserve', docId: c.id, docNumber: c.number, contractId: c.id, costCenterKey: c.costCenterKey, entries: [{ debit: '19999000', credit: '56990000', amount: cur, purpose: `Восстановление (сторно) резерва по договору ${c.number}` }] }, user);
          c.reserve.history.push({ at: now(), action: 'reverse', amount: cur, classification: c.reserve.classification });
          Object.assign(c.reserve, { amount: 0, base: 0, overdueDays: 0, updatedAt: now() });
          changed++;
        }
        continue;
      }
      const cls = classify(days);
      const amount = Math.round((base * cls.pct) / 100);
      if (amount === cur && c.reserve?.classification === cls.cls) continue;
      const diff = amount - cur;
      addPosting({ source: diff > 0 ? 'reserve' : 'reserve_reversal', docKind: 'reserve', docId: c.id, docNumber: c.number, contractId: c.id, costCenterKey: c.costCenterKey, entries: [diff > 0 ? { debit: '56990000', credit: '19999000', amount: diff, purpose: `Резерв (${cls.cls}, ${cls.pct}%) по договору ${c.number}` } : { debit: '19999000', credit: '56990000', amount: -diff, purpose: `Уменьшение резерва по договору ${c.number}` }] }, user);
      const r: ContractReserve = c.reserve ?? { classification: cls.cls, pct: cls.pct, base, amount: 0, overdueDays: days, updatedAt: now(), history: [] };
      r.history.push({ at: now(), action: !c.reserve ? 'create' : diff > 0 ? 'increase' : 'decrease', amount: Math.abs(diff), classification: cls.cls });
      Object.assign(r, { classification: cls.cls, pct: cls.pct, base, amount, overdueDays: days, updatedAt: now() });
      c.reserve = r;
      changed++;
    }
    void s;
    audit.log({ action: 'update', entity: 'contract_reserve', details: `recalc: ${changed}`, user: who(user) });
    emit();
    return delay(changed);
  },
  /** Перенос безнадёжной задолженности на внебаланс (100% резерв) с последующим мониторингом погашения. */
  async writeOff(contractId: ID, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const c = coreTables().contracts.find((x) => x.id === contractId);
    if (!c?.reserve || c.reserve.writtenOff || c.reserve.classification !== 'bad') fail('writeoff');
    const r = c!.reserve!;
    const recv = c!.kind === 'bank_services' ? kindSetting('bank_services').advanceAccount : kindSetting(c!.kind).advanceAccount;
    addPosting({ source: 'writeoff', docKind: 'reserve', docId: c!.id, docNumber: c!.number, contractId: c!.id, costCenterKey: c!.costCenterKey, entries: [
      { debit: '19999000', credit: recv, amount: r.base, purpose: `Списание безнадёжной задолженности за счёт резерва (${c!.number})` },
      { debit: '95413000', credit: '96399000', amount: r.base, purpose: `Учёт списанной задолженности на внебалансе (${c!.number})` },
    ] }, user);
    r.writtenOff = { at: now(), amount: r.base };
    r.history.push({ at: now(), action: 'writeoff', amount: r.base, classification: r.classification });
    emit();
    await delay(null);
  },
  async recordRecovery(contractId: ID, amount: number, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const c = coreTables().contracts.find((x) => x.id === contractId);
    if (!c?.reserve?.writtenOff || !(amount > 0)) fail('bad_state');
    const r = c!.reserve!;
    const left = r.writtenOff!.amount - (r.recoveries ?? []).reduce((s, x) => s + x.amount, 0);
    if (amount > left) fail('amount');
    addPosting({ source: 'income', docKind: 'reserve', docId: c!.id, docNumber: c!.number, contractId: c!.id, entries: [
      { debit: '10501000', credit: '45994000', amount, purpose: `Погашение списанной задолженности (${c!.number})` },
      { debit: '96399000', credit: '95413000', amount, purpose: `Уменьшение внебалансового учёта (${c!.number})` },
    ] }, user);
    r.recoveries = [...(r.recoveries ?? []), { at: now(), amount }];
    r.history.push({ at: now(), action: 'recovery', amount, classification: r.classification });
    emit();
    await delay(null);
  },

  // ---------- Табло «не оплачено к 25-му» (PR-CON-042) ----------
  async board(month = today().slice(0, 7)) {
    const db = coreTables();
    const day = procTables().boardDay;
    const control = `${month}-${String(day).padStart(2, '0')}`;
    const rows = db.contracts
      .filter((c) => c.status === 'active' && (PERIODIC.includes(c.kind ?? 'services') || c.paymentTerms?.type === 'periodic' || c.paymentTerms?.type === 'by_invoice'))
      .flatMap((c) => c.payments.map((p, i) => ({ c, p, i })).filter(({ p }) => p.dueDate.slice(0, 7) === month || (!p.paid && p.dueDate.slice(0, 7) < month)))
      .map(({ c, p, i }) => {
        const state = p.paid ? (p.paidAt && p.paidAt > control ? 'late' : 'paid') : p.dueDate.slice(0, 7) < month || today() > control ? 'overdue' : 'due';
        return { contractId: c.id, number: c.number, subject: c.subject, kind: c.kind ?? 'services', subkind: c.subkind, counterpartyId: c.counterpartyId, index: i, dueDate: p.dueDate, amount: p.amount, currency: c.currency, paid: p.paid, paidAt: p.paidAt, orderId: p.orderId, state };
      })
      .sort((a, b) => ['overdue', 'due', 'late', 'paid'].indexOf(a.state) - ['overdue', 'due', 'late', 'paid'].indexOf(b.state));
    return delay({ control, rows });
  },

  // ---------- Платёжные поручения (PR-CON-045…052) ----------
  listOrders: (filter: { contractId?: ID; status?: string } = {}) =>
    delay(procTables().orders.filter((o) => (!filter.contractId || o.contractId === filter.contractId) && (!filter.status || o.status === filter.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getOrder: (id: ID) => delay(procTables().orders.find((o) => o.id === id)),
  async createOrder(input: OrderInput, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const db = coreTables();
    const c = db.contracts.find((x) => x.id === input.contractId);
    if (!c || c.status !== 'active') fail('contract_inactive');
    if (c!.kind === 'bank_services') fail('income_contract');
    const p = input.paymentIndex !== undefined ? c!.payments[input.paymentIndex] : undefined;
    if (input.paymentIndex !== undefined && (!p || p.paid)) fail('bad_state');
    if (p && procTables().orders.some((o) => o.contractId === c!.id && o.paymentIndex === input.paymentIndex && !['rejected', 'failed'].includes(o.status))) fail('duplicate_order');
    if (!(input.amount > 0) || (p && input.amount !== p.amount)) fail('amount');
    if (!input.purpose.trim()) fail('required');
    if (input.basis === 'einvoice' && !input.einvoiceId) fail('invoice_ref');
    // P3 (PR-BUD-014): hard-check бюджета статьи — платёжное поручение сверх лимита не создаётся
    if (orderBudgetBlocked(c!, input.paymentIndex, Math.round(input.amount))) fail('budget');
    const cp = db.counterparties.find((x) => x.id === c!.counterpartyId)!;
    const swift = c!.kind === 'swift' || cp.type === 'foreign';
    if (swift ? !cp.swiftBic || !cp.iban : !/^\d{20}$/.test(cp.bankAccount ?? '') || !/^\d{5}$/.test(cp.mfo ?? '')) fail('requisites');
    const o: PaymentOrder = {
      id: nextId('po'), number: nextNumber('PP'), contractId: c!.id, ...(input.paymentIndex !== undefined ? { paymentIndex: input.paymentIndex } : {}), date: today(), amount: Math.round(input.amount), currency: c!.currency,
      purpose: input.purpose.trim(), type: swift ? 'swift' : 'domestic', basis: input.basis, ...(input.einvoiceId ? { einvoiceId: input.einvoiceId } : {}), ...(input.actId ? { actId: input.actId } : {}),
      beneficiary: { name: cp.name, tin: cp.tin, account: cp.bankAccount ?? '', mfo: cp.mfo ?? '', bank: cp.bankName ?? '', ...(cp.swiftBic ? { swiftBic: cp.swiftBic } : {}), ...(cp.iban ? { iban: cp.iban } : {}) },
      payerAccount: BANK_ACCOUNT, status: 'draft', ...(c!.costCenterKey ? { costCenterKey: c!.costCenterKey } : {}), createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created')],
    };
    procTables().orders.unshift(o);
    audit.log({ action: 'create', entity: 'payment_order', entityId: o.id, entityLabel: o.number, details: `${c!.number} · ${o.amount} ${o.currency}`, user: who(user) });
    if (input.submit) await contractsApi.submitOrder(o.id, user);
    emit();
    return delay(o);
  },
  /** Согласование платежа (PR-CON-048): маршрут `payment` (казначейство; свыше 50 млн — начальник финансов; свыше 1 млрд — Правление). */
  async submitOrder(id: ID, user: User) {
    const o = procTables().orders.find((x) => x.id === id);
    if (!o || o.status !== 'draft') fail('bad_state');
    o!.status = 'pending';
    o!.history.push(historyEvent(user.id, 'submitted'));
    const inst = approvalEngine.instancesFor(orderKey(o!));
    const last = inst[inst.length - 1];
    if (last && (last.status === 'returned' || last.status === 'rejected')) approvalEngine.resubmit(orderKey(o!), user);
    else {
      const c = coreTables().contracts.find((x) => x.id === o!.contractId)!;
      approvalEngine.open({ entity: 'payment', entityId: orderKey(o!), number: o!.number, title: `${c.number}: ${o!.purpose}`.slice(0, 90), requesterId: o!.createdBy, amount: o!.amount, currency: o!.currency, context: { kind: c.kind, type: o!.type, basis: o!.basis } });
    }
    emit();
    await delay(null);
  },
  async recordOrderSignature(id: ID, signatureId: ID, user: User) {
    const o = procTables().orders.find((x) => x.id === id);
    const sig = signatureService.get(signatureId);
    if (!o || o.status !== 'approved') fail('bad_state');
    if (!sig || sig.entity !== 'payment_order' || sig.entityId !== id || sig.userId !== user.id) fail('signature');
    if (!can(user, 'contracts', 'edit')) fail('forbidden');
    o!.signatureId = signatureId;
    o!.status = 'signed';
    o!.history.push(historyEvent(user.id, 'status_changed', `E-IMZO ${sig!.certSerial}`));
    emit();
    await delay(null);
  },
  /** Отправка в iABS (PR-CON-049): только согласованное и подписанное E-IMZO поручение. */
  async sendOrder(id: ID, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const o = procTables().orders.find((x) => x.id === id);
    if (!o || !['signed', 'failed', 'sent'].includes(o.status) || !o.signatureId) fail('bad_state');
    // P3 (PR-BUD-014): повторный hard-check перед отправкой в банк (лимит мог быть израсходован после создания поручения)
    if (o!.status !== 'sent' && orderBudgetBlocked(coreTables().contracts.find((x) => x.id === o!.contractId)!, o!.paymentIndex, o!.amount)) fail('budget');
    const rec =
      o!.type === 'swift'
        ? await integrationHub.call('iabs', 'swift.mt103', { doc: o!.number, bic: o!.beneficiary.swiftBic ?? '', iban: o!.beneficiary.iban ?? '', amount: o!.amount, currency: o!.currency }, { userId: user.id, idempotencyKey: `po-${o!.id}` })
        : await integrationHub.call('iabs', 'payment.send', { doc: o!.number, account: o!.beneficiary.account, mfo: o!.beneficiary.mfo, amount: o!.amount, purpose: o!.purpose }, { userId: user.id, idempotencyKey: `po-${o!.id}` });
    o!.exchangeId = rec.id;
    if (rec.status === 'success') executeOrder(o!, user);
    else {
      o!.status = rec.status === 'queued' || rec.status === 'pending' ? 'sent' : 'failed';
      o!.history.push(historyEvent(user.id, 'status_changed', `iABS: ${rec.status}`));
    }
    emit();
    return delay(o!.status);
  },
  /** Повторная сверка статуса отправленного поручения (очередь iABS после восстановления). */
  async refreshOrder(id: ID, user: User) {
    const o = procTables().orders.find((x) => x.id === id);
    if (!o?.exchangeId || o.status !== 'sent') fail('bad_state');
    const rec = await integrationHub.getExchange(o!.exchangeId!);
    if (rec?.status === 'success') executeOrder(o!, user);
    emit();
    return delay(o!.status);
  },
  /** Автоматическая ежемесячная оплата периодических платежей на основании ЭСФ (PR-CON-051). */
  async autoMonthly(user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const db = coreTables();
    const { einvoicesApi } = await import('../modules/einvoices'); // поздняя загрузка модуля ЭСФ
    const invoices = await einvoicesApi.list({ direction: 'incoming' });
    const month = today().slice(0, 7);
    const created: string[] = [];
    const waiting: string[] = [];
    for (const c of db.contracts.filter((x) => x.status === 'active' && PERIODIC.includes(x.kind ?? 'services'))) {
      for (const [i, p] of c.payments.entries()) {
        if (p.paid || p.dueDate.slice(0, 7) > month || procTables().orders.some((o) => o.contractId === c.id && o.paymentIndex === i && !['rejected', 'failed'].includes(o.status))) continue;
        const inv = invoices.find((x) => x.contractId === c.id && x.date.slice(0, 7) === p.dueDate.slice(0, 7) && x.status !== 'rejected');
        if (c.paymentTerms?.type === 'by_invoice' && !inv) {
          waiting.push(c.number);
          continue;
        }
        try {
          const o = await contractsApi.createOrder({ contractId: c.id, paymentIndex: i, amount: p.amount, purpose: `Оплата по договору ${c.number} за ${p.dueDate.slice(0, 7)}${inv ? `, ЭСФ ${inv.number}` : ''}`, basis: inv ? 'einvoice' : 'schedule', ...(inv ? { einvoiceId: inv.id } : {}), submit: true }, user);
          procTables().orders.find((x) => x.id === o.id)!.auto = true;
          created.push(o.number);
        } catch {
          waiting.push(c.number);
        }
      }
    }
    emit();
    return delay({ created, waiting: [...new Set(waiting)] });
  },

  // ---------- ЭСФ и доходные договоры (PR-CON-014/015/047) ----------
  async contractInvoices(contractId: ID) {
    const { einvoicesApi } = await import('../modules/einvoices');
    return (await einvoicesApi.list({})).filter((i) => i.contractId === contractId);
  },
  /** Счёт-фактура покупателю по доходному договору банка (исходящий ЭСФ). */
  async issueInvoice(contractId: ID, amount: number, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const c = coreTables().contracts.find((x) => x.id === contractId);
    if (!c || c.kind !== 'bank_services' || !(amount > 0)) fail('bad_state');
    const { einvoicesApi } = await import('../modules/einvoices');
    const net = Math.round(amount / 1.12);
    const inv = await einvoicesApi.create({ counterpartyId: c!.counterpartyId, contractId: c!.id, date: today(), lines: [{ name: c!.subject, qty: 1, unit: 'усл', unitPrice: net }], submit: false }, user);
    c!.history.push(historyEvent(user.id, 'commented', `ЭСФ покупателю ${inv.number}`));
    emit();
    return inv;
  },
  async registerReceipt(contractId: ID, amount: number, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const c = coreTables().contracts.find((x) => x.id === contractId);
    if (!c || c.kind !== 'bank_services' || !(amount > 0)) fail('bad_state');
    const received = (c!.receipts ?? []).reduce((s, r) => s + r.amount, 0);
    if (received + amount > c!.amount) fail('amount');
    c!.receipts = [...(c!.receipts ?? []), { at: today(), amount }];
    const s = kindSetting('bank_services');
    addPosting({ source: 'income', docKind: 'contract', docId: c!.id, docNumber: c!.number, contractId: c!.id, costCenterKey: c!.costCenterKey, entries: [{ debit: '10501000', credit: s.advanceAccount, amount, purpose: `Поступление от покупателя по договору ${c!.number}` }] }, user);
    if (received + amount >= c!.amount) c!.payments.forEach((p) => Object.assign(p, { paid: true, paidAt: today() }));
    c!.history.push(historyEvent(user.id, 'status_changed', `Поступление ${amount}`));
    emit();
    await delay(null);
  },
};
