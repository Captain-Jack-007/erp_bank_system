// P2-PROC: закупки (ТЗ 4.2.1) — номенклатура, верификация, бюджет с резервом, приём заявок ЦБУ через
// областные центры, сводные закупки и распределение, биржа (УзРТСБ), тендерные площадки, реестр и проверки
// поставщиков, приёмка товаров, акты выполненных работ, претензии, контроль качества, проводки,
// электронные договоры Soliqservis/Didox, мониторинг и аналитика.
import { clone, delay, emit, historyEvent, nextId, nextNumber, now, today, addDays } from '../bus';
import { approvalEngine } from '../engine';
import { audit, auditApi, type AuditEntry } from '../audit';
import { can, registerModuleAccess } from '../security';
import { orgApi, registerMdmTarget, type DqIssue } from '../org';
import { budgetSource } from '../budgetBridge';
import { integrationHub, type ExchangeRecord } from '../services/integrations';
import { signatureService } from '../services/signature';
import type { Contract, Counterparty, ID, ProcurementItem, ProcurementMethod, ProcurementRequest, ProcurementStatus, Tender, User } from '../types';
import type {
  AcceptanceLine, ClaimType, PlatformContract, ProcAcceptance, ProcCatalogItem, ProcClaim, ProcConsolidation, ProcItemCategory,
  ProcPosting, ProcurementKind, ProcVerification, ProcVerificationCheck, ProcWorkAct, SupplierCheckList, SupplierCheckResult, WorkActLine,
} from './procTypes';
import { coreTables, procTables } from './procStore';
import {
  addPosting, budgetCheck, daysBetween, fail, hist, isCbu, kindForRequest, kindSetting, notifyDoc, regionOf, total, userBranch, usersByRole, who, warehouseForBranch,
} from './procCommon';
import { hashOf, registerProcIntegrations } from './procIntegrations';
import { whBridge } from './procWarehouse';

registerProcIntegrations();

// Права по умолчанию (P2-PROC): роли без явной строки матрицы. Заведующий складом — «Принял» по приёмке;
// бухгалтерия — проводки, резервы, платёжные поручения, настройки счетов договоров; все сотрудники — заявки на обеспечение.
registerModuleAccess('procurement', { cash_operator: 'edit', finance: 'view', legal: 'view', accountant: 'view', treasury: 'view', auditor: 'view', analyst: 'view', storekeeper: 'edit' });
registerModuleAccess('contracts', { employee: 'view', dept_head: 'view', accountant: 'approve', auditor: 'view', analyst: 'view', storekeeper: 'view', data_entry: 'view' });
registerModuleAccess('requests', { procurement: 'edit', finance: 'edit', legal: 'edit', accountant: 'edit', treasury: 'edit', analyst: 'edit', auditor: 'view' });

const reqLink = (id: ID) => `/procurement/${id}`;
const isBuyer = (u: User) => can(u, 'procurement', 'edit') && (u.role === 'procurement' || u.role === 'admin' || !!u.extraRoles?.includes('procurement'));
const isAdmin = (u: User) => u.role === 'admin' || !!u.extraRoles?.includes('admin');
/** Подразделение-заказчик договора (инициатор или дополнительный инициатор) — может оформлять акты и оценивать качество. */
const isCustomerDept = (u: User, c: Contract | undefined) => !!c && (u.departmentId === c.departmentId || !!c.initiatorDeptIds?.includes(u.departmentId));
const ensure = (ok: boolean) => {
  if (!ok) fail('forbidden');
};

async function hubCall(systemId: string, operation: string, payload: Record<string, unknown>, user: User, key?: string): Promise<ExchangeRecord> {
  return integrationHub.call(systemId, operation, payload, { userId: user.id, ...(key ? { idempotencyKey: key } : {}) });
}

function setStatus(doc: ProcurementRequest, status: ProcurementStatus, user: User | ID, comment?: string) {
  if (doc.status === status) return;
  const from = doc.status;
  doc.status = status;
  hist(doc, user, 'status_changed', comment);
  audit.log({ action: 'update', entity: 'procurement', entityId: doc.id, entityLabel: doc.number, changes: [{ field: 'status', from, to: status }], ...(comment ? { details: comment } : {}) });
  // PR-PROC-043: уведомление инициатора об изменении статуса
  notifyDoc([doc.initiatorId], { key: 'proc_n_status', params: { number: doc.number, status: { key: `pstatus_${status}` } } }, doc.title, reqLink(doc.id), status === 'returned' ? 'warning' : 'info');
}

// ---------------------------------------------------------------------------------------------
// Номенклатура, группы бизнес-плана, способ закупки

/** Категории номенклатуры, которые торгуются на бирже (УзРТСБ). */
const EXCHANGE_CATEGORIES: ProcItemCategory[] = ['vehicles', 'office', 'household', 'furniture'];

export function itemCategories(items: ProcurementItem[]): ProcItemCategory[] {
  const cat = procTables().catalog;
  return [...new Set(items.map((i) => cat.find((c) => c.id === i.catalogId)?.category).filter((c): c is ProcItemCategory => !!c))];
}

/** Контекст маршрута заявки: способ, вид, подразделение и признаки экспертиз по номенклатуре (PR-PROC-015/018). */
export function procRouteContext(d: Pick<ProcurementRequest, 'method' | 'kind' | 'departmentId' | 'items' | 'budgetLineId'>): Record<string, unknown> {
  const cats = itemCategories(d.items);
  return {
    method: d.method,
    kind: d.kind ?? 'goods',
    departmentId: d.departmentId,
    budgetLineId: d.budgetLineId,
    categories: `|${cats.join('|')}|`,
    needsIt: cats.some((c) => c === 'it_hw' || c === 'software') ? 'yes' : 'no',
    needsTech: d.kind === 'works' || cats.includes('construction') ? 'yes' : 'no',
  };
}

/** Правило определения способа закупки по сумме и номенклатуре (PR-PROC-017). */
export function recommendMethod(amount: number, categories: ProcItemCategory[], kind: ProcurementKind = 'goods'): { method: ProcurementMethod; reason: string } {
  if (kind === 'goods' && categories.length && categories.every((c) => EXCHANGE_CATEGORIES.includes(c)) && amount > 25_000_000) return { method: 'exchange', reason: 'proc_rule_exchange' };
  if (amount <= 25_000_000) return { method: kind === 'goods' ? 'e_shop' : 'direct', reason: 'proc_rule_small' };
  if (amount > 1_000_000_000) return { method: 'tender', reason: 'proc_rule_tender' };
  if (kind === 'works') return { method: 'tender', reason: 'proc_rule_works' };
  return { method: 'quotes', reason: 'proc_rule_quotes' };
}

/** Этапы процесса закупки в зависимости от способа, вида и номенклатуры (PR-PROC-026). */
export function processPlan(req: Pick<ProcurementRequest, 'method' | 'kind' | 'items'>): string[] {
  const cats = itemCategories(req.items);
  const cat = procTables().catalog;
  const items = req.items.map((i) => cat.find((c) => c.id === i.catalogId)).filter((c): c is ProcCatalogItem => !!c);
  const head = ['request', 'verification', 'approval'];
  const byMethod: Record<ProcurementMethod, string[]> = {
    direct: ['direct_offer', 'contract'],
    quotes: ['quotes_collect', 'selection', 'contract'],
    tender: ['tender_docs', 'tender_publish', 'tender_bids', 'tender_result', 'contract'],
    exchange: ['exchange_advance', 'exchange_lot', 'exchange_trading', 'exchange_result', 'contract'],
    e_shop: ['eshop_order', 'contract'],
    auction: ['auction_lot', 'auction_trading', 'contract'],
    special: ['special_platform', 'contract'],
  };
  const tail: string[] = [];
  if (items.some((i) => i.origin === 'import')) tail.push('customs');
  if ((req.kind ?? 'goods') === 'goods') tail.push('acceptance', 'receipt');
  if (items.some((i) => i.install)) tail.push('installation');
  if (items.some((i) => i.license)) tail.push('license_activation');
  if (req.kind === 'services' || req.kind === 'works') tail.push(cats.includes('software') ? 'stages_acts' : 'work_act', 'quality');
  if (req.kind === 'works') tail.push('defects_period');
  return [...head, ...byMethod[req.method], ...tail, 'payment'];
}

export interface ProcDraft {
  id?: ID;
  title: string;
  kind: ProcurementKind;
  departmentId: ID;
  costCenterKey: string;
  businessGroupId?: ID;
  budgetLineId: ID;
  method: ProcurementMethod;
  neededBy: string;
  justification: string;
  items: ProcurementItem[];
}

/** Верификация заявки перед маршрутом (PR-PROC-013): комплектность, МВЗ, бюджет, цены, ТЗ, способ закупки. */
export async function verifyDraft(d: ProcDraft, user: User, hasAttachment: boolean): Promise<ProcVerification> {
  const cat = procTables().catalog;
  const checks: ProcVerificationCheck[] = [];
  const add = (code: string, ok: boolean, severity: 'error' | 'warning', detail?: string) => checks.push({ code, ok, severity, ...(detail ? { detail } : {}) });
  const sum = total(d.items);
  // P3: бюджетный контроль модуля запускается параллельно с проверкой МВЗ (без лишней задержки ответа)
  const nb = d.neededBy && d.neededBy.startsWith('2026-') ? Number(d.neededBy.slice(5, 7)) - 1 : 11;
  const ctlP = budgetSource.control({ budgetLineId: d.budgetLineId, amount: sum, month: nb, items: d.items.map((i) => ({ name: i.name, qty: i.qty })) }).catch(() => null);
  add('v_fields', !!(d.title.trim() && d.justification.trim() && d.neededBy && d.budgetLineId), 'error');
  add('v_items', d.items.length > 0 && d.items.every((i) => i.name.trim() && i.qty > 0 && i.unitPrice > 0), 'error');
  add('v_date', !!d.neededBy && d.neededBy >= today(), 'error');
  const cc = d.costCenterKey ? (await orgApi.getCostCenter(d.costCenterKey)).current : undefined;
  add('v_cc', !!cc && cc.status === 'active', 'error', cc ? cc.code : undefined);
  const b = budgetCheck(d.budgetLineId, sum, d.id);
  // P3 (PR-BUD-004…010/014/015): триада модуля бюджетирования — режим статьи (hard блокирует, soft — предупреждение и
  // подтверждение руководителем по маршруту согласования), кассовый план (ОДДС) на месяц поставки, складские остатки.
  const ctl = await ctlP;
  const soft = ctl?.mode === 'soft';
  add('v_budget', b.ok, soft ? 'warning' : 'error', String(b.available));
  if (ctl) {
    add('v_cash', ctl.cashOk, soft ? 'warning' : 'error', String(ctl.cashAvailable));
    add('v_stock', ctl.stock.length === 0, 'warning', ctl.stock.map((s) => `${s.name} (${s.qty} ${s.unit})`).join(', ') || undefined);
  }
  const group = d.businessGroupId ? procTables().groups.find((g) => g.id === d.businessGroupId) : undefined;
  add('v_group', !group || group.budgetLineIds.includes(d.budgetLineId), 'error');
  const free = d.items.filter((i) => !i.catalogId).length;
  add('v_catalog', free === 0, 'warning', free ? String(free) : undefined);
  const dev = d.items.filter((i) => {
    const c = cat.find((x) => x.id === i.catalogId);
    return c && i.unitPrice > c.refPrice * 1.3;
  });
  add('v_price', dev.length === 0, 'warning', dev.map((i) => i.name).join(', ') || undefined);
  add('v_spec', d.items.every((i) => !cat.find((x) => x.id === i.catalogId)?.fixedAsset || !!i.spec?.trim()), 'warning');
  const needTz = d.kind !== 'goods';
  add('v_tz', hasAttachment || (!needTz && sum <= 500_000_000), needTz ? 'error' : 'warning');
  const rec = recommendMethod(sum, itemCategories(d.items), d.kind);
  add('v_method', rec.method === d.method || (rec.method === 'e_shop' && d.method === 'direct') || (rec.method === 'quotes' && ['auction', 'tender'].includes(d.method)), 'warning', rec.method);
  const dupe = coreTables().procurement.find((p) => p.id !== d.id && p.departmentId === d.departmentId && ['pending', 'approved'].includes(p.status) && p.items.some((i) => i.catalogId && d.items.some((x) => x.catalogId === i.catalogId)));
  add('v_duplicate', !dupe, 'warning', dupe?.number);
  return { at: now(), by: user.id, ok: checks.every((c) => c.ok || c.severity === 'warning'), checks };
}

// ---------------------------------------------------------------------------------------------
// Поставщики: рейтинг, история, проверки

export interface SupplierRating {
  base: number;
  quality: number | null;
  claims: number;
  onTime: number | null;
  score: number;
}

export function supplierRating(cpId: ID): SupplierRating {
  const t = procTables();
  const db = coreTables();
  const cp = db.counterparties.find((c) => c.id === cpId);
  const base = cp?.rating ?? 3;
  const contracts = db.contracts.filter((c) => c.counterpartyId === cpId).map((c) => c.id);
  const q = t.acts.filter((a) => contracts.includes(a.contractId) && a.quality).map((a) => a.quality!.score);
  const quality = q.length ? q.reduce((s, x) => s + x, 0) / q.length : null;
  const claims = t.claims.filter((c) => c.counterpartyId === cpId && c.status !== 'rejected').length;
  const stages = db.contracts.filter((c) => c.counterpartyId === cpId).flatMap((c) => c.stages ?? []).filter((s) => s.status === 'done');
  const onTime = stages.length ? stages.filter((s) => !s.doneAt || s.doneAt <= s.dueDate).length / stages.length : null;
  let score = base;
  if (quality !== null) score = (score + quality) / 2;
  if (onTime !== null) score = score * (0.8 + 0.2 * onTime);
  score = Math.max(1, Math.min(5, score - claims * 0.3));
  return { base, quality, claims, onTime, score: Math.round(score * 10) / 10 };
}

export function listHits(tin: string): { list: SupplierCheckList; detail: string }[] {
  return procTables().lists.filter((e) => e.tin === tin).map((e) => ({ list: e.list as SupplierCheckList, detail: e.reason }));
}

/** Последняя проверка поставщика и признак допуска (используется при выборе поставщика в договоре). */
export function supplierAdmission(cpId: ID): { allowed: boolean; reasons: SupplierCheckList[]; lastCheck?: SupplierCheckResult } {
  const cp = coreTables().counterparties.find((c) => c.id === cpId);
  const hits = cp ? listHits(cp.tin).filter((h) => h.list !== 'suspicious_tax').map((h) => h.list) : [];
  const reasons: SupplierCheckList[] = [...hits];
  if (cp?.blocked) reasons.push('internal_control');
  const lastCheck = procTables().checks.filter((c) => c.counterpartyId === cpId).sort((a, b) => b.at.localeCompare(a.at))[0];
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], ...(lastCheck ? { lastCheck } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Договор из итогов торгов / тендера / платформы (общая часть)

export interface AutoContractInput {
  request?: ProcurementRequest;
  subject: string;
  counterpartyId: ID;
  amount: number;
  source: NonNullable<Contract['source']>;
  departmentId: ID;
  costCenterKey?: string;
  startDate?: string;
  endDate?: string;
  status?: Contract['status'];
  platform?: Contract['platform'];
}

/** Создать договор (тексты/графики по шаблону вида) и проводку по внебалансовому учёту обязательств. */
export function createContractRecord(input: AutoContractInput, user: User): Contract {
  const db = coreTables();
  const kind = kindForRequest(input.request);
  const setting = kindSetting(kind);
  const tpl = procTables().templates.find((x) => x.kind === kind);
  const start = input.startDate ?? today();
  const end = input.endDate ?? addDays(180).slice(0, 10);
  const adv = setting.defaultTerms.type === 'advance' || setting.defaultTerms.type === 'by_act' ? (setting.defaultTerms.advancePct ?? 0) : 0;
  const advAmount = Math.round((input.amount * adv) / 100);
  const c: Contract = {
    id: nextId('k'),
    number: nextNumber('DG'),
    subject: input.subject,
    counterpartyId: input.counterpartyId,
    departmentId: input.departmentId,
    amount: input.amount,
    currency: 'UZS',
    startDate: start,
    endDate: end,
    status: input.status ?? 'pending',
    ...(input.request ? { requestId: input.request.id } : {}),
    kind,
    paymentTerms: clone(setting.defaultTerms),
    source: input.source,
    ...(input.costCenterKey ? { costCenterKey: input.costCenterKey } : {}),
    initiatorDeptIds: [input.departmentId],
    ...(tpl ? { templateId: tpl.id, penalty: clone(tpl.penalty) } : {}),
    ...(input.platform ? { platform: input.platform } : {}),
    payments: [
      ...(advAmount ? [{ dueDate: start, amount: advAmount, paid: false, kind: 'advance' as const }] : []),
      { dueDate: end, amount: input.amount - advAmount, paid: false, kind: kind === 'construction' || kind === 'services' ? ('by_act' as const) : ('final' as const) },
    ],
    stages: [
      { id: 's1', name: kind === 'fixed_assets' ? 'Поставка' : 'Выполнение работ / оказание услуг', obligation: kind === 'fixed_assets' ? 'delivery' : 'works', dueDate: end, amount: input.amount, status: 'planned' },
      { id: 's2', name: 'Приёмка', obligation: 'acceptance', dueDate: end, status: 'planned' },
    ],
    history: [historyEvent(user.id, 'created', input.source)],
  };
  db.contracts.unshift(c);
  addPosting({ source: 'contract', docKind: 'contract', docId: c.id, docNumber: c.number, contractId: c.id, costCenterKey: input.costCenterKey, entries: [{ debit: '90963000', credit: '96399000', amount: c.amount, purpose: `Обязательства по договору ${c.number}` }] }, user);
  audit.log({ action: 'create', entity: 'contract', entityId: c.id, entityLabel: c.number, details: `${input.source} · ${c.amount}`, user: who(user) });
  return c;
}

/** Договор на согласование (юрист → финансы), если он не подписан на платформе. */
function openContractRoute(c: Contract, user: User) {
  c.history.push(historyEvent(user.id, 'submitted'));
  approvalEngine.open({ entity: 'contract', entityId: c.id, number: c.number, title: c.subject, requesterId: user.id, amount: c.amount, currency: c.currency, context: { kind: c.kind, departmentId: c.departmentId } });
}

// ---------------------------------------------------------------------------------------------
// Приёмка: оприходование на склад, проводки, МВЗ

function acceptanceValue(a: ProcAcceptance) {
  return a.lines.reduce((s, l) => s + l.acceptedQty * l.unitPrice, 0);
}

export function acceptanceDiscrepancies(a: Pick<ProcAcceptance, 'lines'>): { line: number; type: ClaimType; detail: string }[] {
  const out: { line: number; type: ClaimType; detail: string }[] = [];
  a.lines.forEach((l, i) => {
    if (l.deliveredQty < l.orderedQty) out.push({ line: i, type: 'shortage', detail: `${l.deliveredQty}/${l.orderedQty}` });
    if (l.acceptedQty < l.deliveredQty) out.push({ line: i, type: l.quality === 'defect' ? 'quality' : 'shortage', detail: `${l.acceptedQty}/${l.deliveredQty}` });
    if (!l.specOk) out.push({ line: i, type: 'spec', detail: l.name });
  });
  return out;
}

/** Остаток по позициям договора/заявки, ещё не принятый по актам приёмки. */
function remainingLines(c: Contract): AcceptanceLine[] {
  const db = coreTables();
  const t = procTables();
  const req = c.requestId ? db.procurement.find((p) => p.id === c.requestId) : undefined;
  const ratio = req && total(req.items) ? c.amount / total(req.items) : 1;
  const base = req
    ? req.items.map((i) => ({ name: i.name, catalogId: i.catalogId, unit: i.unit, qty: i.qty, unitPrice: Math.round(i.unitPrice * ratio) }))
    : [{ name: c.subject, catalogId: undefined, unit: 'шт', qty: 1, unitPrice: c.amount }];
  const done = t.acceptances.filter((a) => a.contractId === c.id && a.status !== 'draft');
  return base
    .map((b) => {
      const accepted = done.flatMap((a) => a.lines).filter((l) => l.name === b.name).reduce((s, l) => s + l.acceptedQty, 0);
      const sku = b.catalogId ? t.catalog.find((x) => x.id === b.catalogId)?.warehouseSku : undefined;
      const left = Math.max(0, b.qty - accepted);
      return { name: b.name, ...(b.catalogId ? { catalogId: b.catalogId } : {}), ...(sku ? { warehouseSku: sku } : {}), unit: b.unit, orderedQty: left, deliveredQty: left, acceptedQty: left, unitPrice: b.unitPrice, specOk: true, quality: 'ok' as const };
    })
    .filter((l) => l.orderedQty > 0);
}

async function postReceipt(a: ProcAcceptance, user: User) {
  const db = coreTables();
  const c = db.contracts.find((x) => x.id === a.contractId)!;
  const req = a.requestId ? db.procurement.find((p) => p.id === a.requestId) : undefined;
  const value = acceptanceValue(a);
  // PR-PROC-065/067: автоматическое оприходование на склад с привязкой к договору и заявке
  const res = await whBridge.receive(
    {
      warehouseId: a.warehouseId,
      contractId: c.id,
      contractNumber: c.number,
      ...(req ? { procurementId: req.id } : {}),
      supplierId: c.counterpartyId,
      ...(a.einvoiceId ? { einvoiceId: a.einvoiceId } : {}),
      costCenterKey: a.costCenterKey ?? c.costCenterKey ?? '',
      acceptanceNumber: a.number,
      lines: a.lines.filter((l) => l.acceptedQty > 0).map((l) => ({ name: l.name, ...(l.warehouseSku ? { sku: l.warehouseSku } : {}), unit: l.unit, qty: l.acceptedQty, unitPrice: l.unitPrice })),
    },
    user,
  );
  a.movementIds = res.movementIds;
  if (res.receiptId) a.receiptId = res.receiptId;
  // PR-PROC-066 / PR-CON-044: кредиторская задолженность признаётся после приёмки; аванс зачитывается
  const setting = kindSetting(c.kind);
  const advancePaid = c.payments.filter((p) => p.kind === 'advance' && p.paid).reduce((s, p) => s + p.amount, 0);
  const offset = Math.min(advancePaid, value);
  const entries = [
    ...(res.posted ? [] : [{ debit: setting.kind === 'fixed_assets' ? '16510000' : setting.expenseAccount, credit: setting.payableAccount, amount: value, purpose: `Оприходование по акту приёмки ${a.number}` }]),
    { debit: setting.payableAccount, credit: setting.advanceAccount, amount: offset, purpose: `Зачёт аванса по договору ${c.number}` },
  ];
  if (entries.some((e) => e.amount > 0)) a.postingId = addPosting({ source: 'receipt', docKind: 'acceptance', docId: a.id, docNumber: a.number, contractId: c.id, costCenterKey: a.costCenterKey, entries }, user).id;
  // выполнение этапа поставки договора
  const st = (c.stages ?? []).find((s) => s.status === 'planned' && s.obligation === 'delivery');
  if (st && remainingLines(c).length === 0) Object.assign(st, { status: 'done', doneAt: today(), docRef: a.number });
  if (req && remainingLines(c).length === 0) setStatus(req, 'executed', user, a.number);
}

// ---------------------------------------------------------------------------------------------
// Акты выполненных работ — согласование через движок (тип work_act)

const actTotal = (a: Pick<ProcWorkAct, 'lines'>) => total(a.lines);
const actVat = (a: Pick<ProcWorkAct, 'lines' | 'vatRate'>) => Math.round((actTotal(a) * a.vatRate) / 100);

export function actCheck(a: Pick<ProcWorkAct, 'lines' | 'vatRate' | 'periodFrom' | 'periodTo' | 'contractId' | 'id'>): { withinAmount: boolean; withinPeriod: boolean; contractAmount: number; previous: number; remaining: number; amount: number } {
  const c = coreTables().contracts.find((x) => x.id === a.contractId);
  const previous = procTables().acts.filter((x) => x.contractId === a.contractId && x.id !== a.id && !['draft', 'rejected'].includes(x.status)).reduce((s, x) => s + actTotal(x) + actVat(x), 0);
  const amount = actTotal(a) + actVat(a);
  const contractAmount = c?.amount ?? 0;
  const remaining = contractAmount - previous;
  return { withinAmount: amount <= remaining, withinPeriod: !!c && a.periodFrom >= c.startDate.slice(0, 10) && a.periodTo <= c.endDate.slice(0, 10) && a.periodFrom <= a.periodTo, contractAmount, previous, remaining, amount };
}

/** Контроль качества по акту: закупки, договорной отдел/бухгалтерия или подразделение-заказчик. */
function actEditor(user: User, a: ProcWorkAct | undefined): boolean {
  const c = a ? coreTables().contracts.find((x) => x.id === a.contractId) : undefined;
  return isBuyer(user) || can(user, 'contracts', 'edit') || (can(user, 'procurement', 'edit') && isCustomerDept(user, c));
}

function completeAct(a: ProcWorkAct, user: User | ID) {
  const db = coreTables();
  const c = db.contracts.find((x) => x.id === a.contractId);
  if (!c) return;
  a.status = 'completed';
  hist(a, user, 'status_changed', 'completed');
  const setting = kindSetting(c.kind);
  const amount = actTotal(a) + actVat(a);
  const advancePaid = c.payments.filter((p) => p.kind === 'advance' && p.paid).reduce((s, p) => s + p.amount, 0);
  const usedAdvance = procTables().postings.filter((p) => p.contractId === c.id && (p.source === 'act' || p.source === 'receipt')).flatMap((p) => p.entries).filter((e) => e.credit === setting.advanceAccount).reduce((s, e) => s + e.amount, 0);
  const offset = Math.min(Math.max(0, advancePaid - usedAdvance), amount);
  a.postingId = addPosting({ source: 'act', docKind: 'act', docId: a.id, docNumber: a.number, contractId: c.id, costCenterKey: a.costCenterKey, entries: [
    { debit: setting.expenseAccount, credit: setting.payableAccount, amount, purpose: `Акт выполненных работ ${a.number} (${a.periodFrom} — ${a.periodTo})` },
    { debit: setting.payableAccount, credit: setting.advanceAccount, amount: offset, purpose: `Зачёт аванса по договору ${c.number}` },
  ] }, user).id;
  const st = (c.stages ?? []).find((s) => s.status === 'planned' && (s.obligation === 'works' || s.obligation === 'acceptance'));
  if (st) Object.assign(st, { status: 'done', doneAt: today(), docRef: a.number });
  const req = a.requestId ? db.procurement.find((p) => p.id === a.requestId) : undefined;
  if (req && actCheck({ ...a, lines: [], id: '__none' }).remaining <= 0) setStatus(req, 'executed', user, a.number);
}

approvalEngine.register('work_act', {
  onHistory: (id, e) => procTables().acts.find((a) => a.id === id)?.history.push(e),
  onFinal: (id, ok) => {
    const a = procTables().acts.find((x) => x.id === id);
    if (!a) return;
    a.status = ok ? 'approved' : 'rejected';
    notifyDoc([a.createdBy], { key: ok ? 'proc_n_act_approved' : 'proc_n_act_rejected', params: { number: a.number } }, a.description, `/procurement/acts/${a.id}`, ok ? 'success' : 'danger');
  },
  onReturned: (id) => {
    const a = procTables().acts.find((x) => x.id === id);
    if (a) a.status = 'draft';
  },
  onResubmitted: (id) => {
    const a = procTables().acts.find((x) => x.id === id);
    if (a) a.status = 'pending';
  },
  getContext: (id) => {
    const a = procTables().acts.find((x) => x.id === id);
    const c = a ? coreTables().contracts.find((x) => x.id === a.contractId) : undefined;
    return c ? { kind: c.kind, departmentId: c.departmentId } : undefined;
  },
});

// ---------------------------------------------------------------------------------------------
// API

export interface ProcOperationsFilter {
  from?: string;
  to?: string;
  action?: string;
  q?: string;
}


// ---------- P4 (PR-MDM-003): номенклатура как справочник MDM ----------

const CATALOG_FIELDS = ['code', 'name', 'kind', 'category', 'unit', 'refPrice', 'spec', 'warehouseSku', 'budgetLineId', 'origin', 'install', 'license', 'fixedAsset', 'active'] as const;
type CatalogField = (typeof CATALOG_FIELDS)[number];
const catalogFields = (c: Partial<ProcCatalogItem>): Record<string, unknown> => Object.fromEntries(CATALOG_FIELDS.filter((k) => c[k] !== undefined).map((k) => [k, clone(c[k])]));
/** Предлагаемые значения: для новой позиции — все поля, для изменения — только изменённые. */
function catalogPayload(input: Omit<ProcCatalogItem, 'id'> & { id?: ID }, cur?: ProcCatalogItem): Record<string, unknown> {
  const next = catalogFields(input);
  if (!cur) return next;
  const before = catalogFields(cur);
  return Object.fromEntries(CATALOG_FIELDS.filter((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(before[k] ?? null)).map((k) => [k, next[k] ?? null]));
}

registerMdmTarget('nomenclature', {
  current: (key) => {
    const c = procTables().catalog.find((x) => x.id === key);
    return c ? catalogFields(c) : undefined;
  },
  validate: (input, user) => {
    if (!isBuyer(user) && !can(user, 'master-data', 'edit')) fail('forbidden');
    const t = procTables();
    const cur = input.action === 'create' ? undefined : t.catalog.find((x) => x.id === input.targetKey);
    const m = { ...(cur ? catalogFields(cur) : {}), ...input.payload } as Partial<Record<CatalogField, unknown>> & { name?: { ru?: string; uz?: string } };
    const issues: DqIssue[] = [];
    if (!String(m.code ?? '').trim()) issues.push({ field: 'code', code: 'dq_required', severity: 'error' });
    if (!m.name?.ru?.trim()) issues.push({ field: 'nameRu', code: 'dq_required', severity: 'error' });
    if (!m.name?.uz?.trim()) issues.push({ field: 'nameUz', code: 'dq_required', severity: 'error' });
    if (!String(m.unit ?? '').trim()) issues.push({ field: 'unit', code: 'dq_required', severity: 'error' });
    if (!(Number(m.refPrice) > 0)) issues.push({ field: 'refPrice', code: 'dq_required', severity: 'error' });
    if (m.code && t.catalog.some((c) => c.code === m.code && c.id !== input.targetKey && c.mdmStatus !== 'rejected')) issues.push({ field: 'code', code: 'dq_duplicate_code', severity: 'error' });
    return issues;
  },
  matrix: (input) => {
    const cur = procTables().catalog.find((x) => x.id === input.targetKey);
    return { itemKind: String(input.payload.kind ?? cur?.kind ?? 'goods'), category: String(input.payload.category ?? cur?.category ?? '') };
  },
  onSubmitted: (req) => {
    const t = procTables();
    if (req.action === 'create') {
      t.catalog.push({ ...(req.payload as unknown as ProcCatalogItem), id: req.targetKey!, active: false, mdmStatus: 'pending', pendingChangeId: req.id });
    } else {
      const c = t.catalog.find((x) => x.id === req.targetKey);
      if (c) c.pendingChangeId = req.id;
    }
    emit();
  },
  onRejected: (req) => {
    const c = procTables().catalog.find((x) => x.id === req.targetKey);
    if (!c) return;
    delete c.pendingChangeId;
    if (req.action === 'create') {
      c.mdmStatus = 'rejected';
      c.active = false;
    }
  },
  apply: (req, approver) => {
    const t = procTables();
    const c = t.catalog.find((x) => x.id === req.targetKey);
    if (!c) return req.targetKey ?? '';
    const before = catalogFields(c);
    const created = req.action === 'create';
    Object.assign(c, clone(req.payload));
    if (created) c.active = req.payload.active === undefined ? true : !!req.payload.active;
    if (req.action === 'close') c.active = false;
    c.mdmStatus = 'approved';
    delete c.pendingChangeId;
    const after = catalogFields(c);
    const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    audit.log({ action: created ? 'create' : 'update', entity: 'proc_catalog', entityId: c.id, entityLabel: c.code, changes: CATALOG_FIELDS.map((k) => ({ field: k, from: created ? '—' : show(before[k]), to: show(after[k]) })).filter((x) => x.from !== x.to), details: req.number, user: who(approver) });
    emit();
    return c.id;
  },
  label: (req) => {
    const c = procTables().catalog.find((x) => x.id === req.targetKey);
    const name = (req.payload.name as { ru?: string } | undefined)?.ru ?? c?.name.ru ?? '';
    return `${String(req.payload.code ?? c?.code ?? '')} ${name}`.trim();
  },
});

export const procApi = {
  // ---------- Номенклатура (PR-PROC-003) ----------
  listCatalog(filter: { q?: string; kind?: ProcurementKind | ''; category?: ProcItemCategory | ''; activeOnly?: boolean } = {}) {
    const q = filter.q?.trim().toLowerCase();
    return delay(
      procTables().catalog.filter(
        (c) =>
          (!filter.activeOnly || c.active) &&
          (!filter.kind || c.kind === filter.kind) &&
          (!filter.category || c.category === filter.category) &&
          (!q || c.code.toLowerCase().includes(q) || c.name.ru.toLowerCase().includes(q) || c.name.uz.toLowerCase().includes(q) || (c.name.en ?? '').toLowerCase().includes(q)),
      ),
    );
  },
  /**
   * P4 (PR-MDM-003): создание/изменение позиции номенклатуры — заявка MDM с подтверждающим документом; маршрут по
   * матрице согласования (вид товара/услуги, категория) с подписью E-IMZO согласующих. Новая позиция видна как
   * «на утверждении» (неактивна) и становится действующей только после финального утверждения.
   */
  async saveCatalogItem(input: Omit<ProcCatalogItem, 'id'> & { id?: ID }, user: User, meta: { reason: string; attachment?: { name: string; size: number }; effectiveFrom?: string } = { reason: '' }) {
    ensure(isBuyer(user) || can(user, 'master-data', 'edit'));
    const t = procTables();
    const cur = input.id ? t.catalog.find((c) => c.id === input.id) : undefined;
    if (input.id && !cur) fail('not_found');
    const payload = catalogPayload(input, cur);
    const req = await orgApi.submitChange({ entity: 'nomenclature', action: cur ? 'update' : 'create', targetKey: cur ? cur.id : nextId('nc'), payload, effectiveFrom: meta.effectiveFrom ?? today(), reason: meta.reason, ...(meta.attachment ? { attachment: meta.attachment } : {}) }, user);
    return delay(req);
  },
  listBusinessGroups: () => delay(procTables().groups),
  budgetCheck: (lineId: ID, amount: number, excludeId?: ID) => delay(budgetCheck(lineId, amount, excludeId)),
  recommendMethod: (amount: number, items: ProcurementItem[], kind: ProcurementKind = 'goods') => recommendMethod(amount, itemCategories(items), kind),
  processPlan: (req: Pick<ProcurementRequest, 'method' | 'kind' | 'items'>) => processPlan(req),
  itemCategories: (items: ProcurementItem[]) => itemCategories(items),
  async verify(d: ProcDraft, user: User, hasAttachment: boolean) {
    return delay(await verifyDraft(d, user, hasAttachment));
  },

  /** Способ закупки определяется/уточняется отделом закупок на этапе согласования (PR-PROC-017). */
  async changeMethod(id: ID, method: ProcurementMethod, comment: string, user: User) {
    ensure(isBuyer(user));
    const d = coreTables().procurement.find((p) => p.id === id);
    if (!d || !['pending', 'approved', 'draft'].includes(d.status)) fail('bad_state');
    if (!comment.trim()) fail('reason');
    const from = d!.method;
    d!.method = method;
    hist(d!, user, 'commented', `${from} → ${method}: ${comment.trim()}`);
    audit.log({ action: 'update', entity: 'procurement', entityId: id, entityLabel: d!.number, changes: [{ field: 'method', from, to: method }], details: comment, user: who(user) });
    emit();
    await delay(null);
  },

  /** Подписи E-IMZO заявки (инициатор и согласующие — PR-PROC-012/018). */
  async recordSignature(id: ID, signatureId: ID, user: User) {
    const d = coreTables().procurement.find((p) => p.id === id);
    const sig = signatureService.get(signatureId);
    if (!d || !sig || sig.entity !== 'procurement' || sig.entityId !== id || sig.userId !== user.id) fail('signature');
    d!.signatureIds = [...new Set([...(d!.signatureIds ?? []), signatureId])];
    hist(d!, user, 'commented', `E-IMZO ${sig!.certSerial}`);
    emit();
    await delay(null);
  },

  // ---------- Приём заявок ЦБУ через областной центр (PR-PROC-021) и в ЦА (PR-PROC-022) ----------
  /** Очередь регионального центра: заявки ЦБУ региона, ожидающие приёма. */
  regionQueue(user: User) {
    const myRegion = regionOf(userBranch(user));
    return delay(
      coreTables().procurement.filter((p) => p.intake === 'region' && ['pending', 'returned'].includes(p.status) && (isAdmin(user) || regionOf(p.branchKey) === myRegion)),
    );
  },
  canActAsRegion(user: User, regionKey: string): boolean {
    return isAdmin(user) || (can(user, 'procurement', 'approve') && regionOf(userBranch(user)) === regionKey);
  },
  async returnToBranch(id: ID, reason: string, user: User) {
    const d = coreTables().procurement.find((p) => p.id === id);
    if (!d || d.intake !== 'region' || d.status !== 'pending') fail('bad_state');
    ensure(procApi.canActAsRegion(user, regionOf(d!.branchKey)));
    if (!reason.trim()) fail('reason');
    d!.returnReason = reason.trim();
    setStatus(d!, 'returned', user, reason.trim());
    emit();
    await delay(null);
  },
  /** Повторная отправка после возврата: заявка снова в очереди регионального центра или на согласовании. */
  async resubmitReturned(id: ID, user: User) {
    const d = coreTables().procurement.find((p) => p.id === id);
    if (!d || d.status !== 'returned') fail('bad_state');
    if (d!.initiatorId !== user.id && !isAdmin(user)) fail('forbidden');
    delete d!.returnReason;
    d!.intake = 'region';
    setStatus(d!, 'pending', user, 'resubmitted');
    hist(d!, user, 'submitted');
    emit();
    await delay(null);
  },
  /** Обобщение: региональная сводная заявка → центральный аппарат. */
  async sendRegionalSummary(regionKey: string, requestIds: ID[], title: string, user: User) {
    ensure(procApi.canActAsRegion(user, regionKey));
    const db = coreTables();
    const reqs = requestIds.map((id) => db.procurement.find((p) => p.id === id)).filter((p): p is ProcurementRequest => !!p);
    if (!reqs.length || reqs.some((r) => r.intake !== 'region' || r.status !== 'pending' || regionOf(r.branchKey) !== regionKey)) fail('bad_state');
    const cs: ProcConsolidation = { id: nextId('cs'), number: nextNumber('SV'), level: 'region', regionKey, title: title.trim() || `Сводная заявка ${regionKey}`, requestIds: reqs.map((r) => r.id), status: 'sent', createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created'), historyEvent(user.id, 'submitted')] };
    procTables().consolidations.unshift(cs);
    for (const r of reqs) {
      r.intake = 'central';
      r.consolidationId = cs.id;
      hist(r, user, 'status_changed', cs.number);
    }
    audit.log({ action: 'submit', entity: 'proc_consolidation', entityId: cs.id, entityLabel: cs.number, details: `${regionKey} · ${reqs.length}`, user: who(user) });
    notifyDoc(usersByRole('procurement'), { key: 'proc_n_summary', params: { number: cs.number } }, cs.title, '/procurement?tab=consolidation');
    emit();
    return delay(cs);
  },
  /** Решение ЦА по региональной сводной: принять (заявки уходят на согласование) или вернуть в регион. */
  async decideRegionalSummary(id: ID, decision: 'accept' | 'return', reason: string, user: User) {
    ensure(isBuyer(user));
    const t = procTables();
    const db = coreTables();
    const cs = t.consolidations.find((c) => c.id === id);
    if (!cs || cs.level !== 'region' || cs.status !== 'sent') fail('bad_state');
    const reqs = cs!.requestIds.map((rid) => db.procurement.find((p) => p.id === rid)).filter((p): p is ProcurementRequest => !!p);
    cs!.decidedBy = user.id;
    cs!.decidedAt = now();
    if (decision === 'return') {
      if (!reason.trim()) fail('reason');
      cs!.status = 'returned';
      cs!.returnReason = reason.trim();
      cs!.history.push(historyEvent(user.id, 'returned', reason.trim()));
      for (const r of reqs) {
        r.intake = 'region';
        hist(r, user, 'returned', reason.trim());
      }
      notifyDoc([cs!.createdBy], { key: 'proc_n_summary_returned', params: { number: cs!.number } }, reason.trim(), '/procurement?tab=consolidation', 'warning');
    } else {
      cs!.status = 'accepted';
      cs!.history.push(historyEvent(user.id, 'approved'));
      for (const r of reqs) {
        r.intake = 'approval';
        hist(r, user, 'submitted', cs!.number);
        approvalEngine.open({ entity: 'procurement', entityId: r.id, number: r.number, title: r.title, requesterId: r.initiatorId, amount: total(r.items), context: procRouteContext(r) });
      }
    }
    audit.log({ action: decision === 'accept' ? 'approve' : 'reject', entity: 'proc_consolidation', entityId: cs!.id, entityLabel: cs!.number, ...(reason ? { details: reason } : {}), user: who(user) });
    emit();
    await delay(null);
  },
  /** Повторная обработка в регионе: исправленная сводная заявка отправляется снова. */
  async resendRegionalSummary(id: ID, user: User) {
    const cs = procTables().consolidations.find((c) => c.id === id);
    if (!cs || cs.level !== 'region' || cs.status !== 'returned') fail('bad_state');
    ensure(procApi.canActAsRegion(user, cs!.regionKey ?? ''));
    const db = coreTables();
    cs!.requestIds = cs!.requestIds.filter((rid) => db.procurement.find((p) => p.id === rid && p.status === 'pending'));
    if (!cs!.requestIds.length) fail('bad_state');
    for (const rid of cs!.requestIds) {
      const r = db.procurement.find((p) => p.id === rid)!;
      r.intake = 'central';
    }
    cs!.status = 'sent';
    delete cs!.returnReason;
    cs!.history.push(historyEvent(user.id, 'submitted', 'resent'));
    emit();
    await delay(null);
  },
  listConsolidations: () => delay(procTables().consolidations),
  getConsolidation: (id: ID) => delay(procTables().consolidations.find((c) => c.id === id)),

  /** Кандидаты на объединение: согласованные заявки разных филиалов с одинаковой номенклатурой (PR-PROC-020). */
  consolidationCandidates() {
    const db = coreTables();
    const free = db.procurement.filter((p) => p.status === 'approved' && !p.consolidatedFrom && p.method !== 'tender' && !db.tenders.some((x) => x.requestId === p.id));
    const groups = new Map<ID, ProcurementRequest[]>();
    for (const p of free) for (const i of p.items) if (i.catalogId) groups.set(i.catalogId, [...(groups.get(i.catalogId) ?? []), p]);
    return delay(
      [...groups.entries()]
        .map(([catalogId, list]) => ({ catalogId, requests: [...new Map(list.map((r) => [r.id, r])).values()] }))
        .filter((g) => g.requests.length > 1 && new Set(g.requests.map((r) => r.branchKey ?? r.departmentId)).size > 1),
    );
  },
  /** Консолидированная (сводная) закупка из нескольких согласованных заявок (PR-PROC-023). */
  async createConsolidatedPurchase(requestIds: ID[], title: string, user: User) {
    ensure(isBuyer(user));
    const db = coreTables();
    const reqs = requestIds.map((id) => db.procurement.find((p) => p.id === id)).filter((p): p is ProcurementRequest => !!p);
    if (reqs.length < 2 || reqs.some((r) => r.status !== 'approved' || r.consolidatedFrom)) fail('bad_state');
    const items = new Map<string, ProcurementItem>();
    for (const r of reqs)
      for (const i of r.items) {
        const k = i.catalogId ?? `${i.name}|${i.unit}`;
        const cur = items.get(k);
        if (cur) cur.qty += i.qty;
        else items.set(k, { ...clone(i) });
      }
    const list = [...items.values()];
    const first = reqs[0]!;
    const amount = total(list);
    const rec = recommendMethod(amount, itemCategories(list), first.kind ?? 'goods');
    const doc: ProcurementRequest = {
      id: nextId('pr'),
      number: nextNumber('ZK'),
      title: title.trim() || `Сводная закупка: ${list.map((i) => i.name).join(', ').slice(0, 80)}`,
      departmentId: 'd4',
      initiatorId: user.id,
      budgetLineId: first.budgetLineId,
      method: rec.method === 'e_shop' ? 'quotes' : rec.method,
      status: 'approved',
      items: list,
      neededBy: reqs.map((r) => r.neededBy).sort()[0]!,
      createdAt: now(),
      justification: `Консолидация заявок: ${reqs.map((r) => r.number).join(', ')}`,
      kind: first.kind ?? 'goods',
      costCenterKey: 'CC0013',
      branchKey: 'd4',
      intake: 'approval',
      consolidatedFrom: reqs.map((r) => r.id),
      history: [historyEvent(user.id, 'created', reqs.map((r) => r.number).join(', '))],
    };
    db.procurement.push(doc);
    const cs: ProcConsolidation = { id: nextId('cs'), number: nextNumber('SV'), level: 'central', title: doc.title, requestIds: doc.consolidatedFrom!, status: 'accepted', resultRequestId: doc.id, createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created', doc.number)] };
    procTables().consolidations.unshift(cs);
    for (const r of reqs) {
      r.consolidationId = cs.id;
      setStatus(r, 'consolidated', user, `${cs.number} → ${doc.number}`);
    }
    audit.log({ action: 'create', entity: 'proc_consolidation', entityId: cs.id, entityLabel: cs.number, details: `${doc.number} · ${reqs.length}`, user: who(user) });
    emit();
    return delay(doc);
  },
  /** Распределение товаров сводной закупки по филиалам-заявителям (PR-PROC-024): перемещения склада. */
  async distribute(consolidationId: ID, user: User) {
    ensure(isBuyer(user) || can(user, 'warehouse', 'edit'));
    const t = procTables();
    const db = coreTables();
    const cs = t.consolidations.find((c) => c.id === consolidationId);
    const purchase = cs?.resultRequestId ? db.procurement.find((p) => p.id === cs.resultRequestId) : undefined;
    if (!cs || cs.level !== 'central' || !purchase || purchase.status !== 'executed') fail('bad_state');
    const lines = cs!.requestIds.flatMap((rid) => {
      const r = db.procurement.find((p) => p.id === rid)!;
      return r.items.map((i) => ({ requestId: r.id, branchKey: r.branchKey ?? r.departmentId, itemName: i.name, unit: i.unit, qty: i.qty, warehouseId: warehouseForBranch(r.branchKey), status: 'planned' as const, sku: i.catalogId ? t.catalog.find((c) => c.id === i.catalogId)?.warehouseSku : undefined }));
    });
    const accepted = t.acceptances.find((a) => a.requestId === purchase!.id && a.status === 'received');
    const from = accepted?.warehouseId ?? 'wh1';
    cs!.distribution = [];
    for (const l of lines) {
      const mv = l.warehouseId !== from ? await whBridge.transfer({ fromWarehouseId: from, toWarehouseId: l.warehouseId, ...(l.sku ? { sku: l.sku } : {}), name: l.itemName, qty: l.qty, comment: `${cs!.number}: ${l.branchKey}` }, user) : undefined;
      cs!.distribution.push({ requestId: l.requestId, branchKey: l.branchKey, itemName: l.itemName, unit: l.unit, qty: l.qty, warehouseId: l.warehouseId, status: 'done', ...(mv ? { movementId: mv } : {}) });
      const r = db.procurement.find((p) => p.id === l.requestId)!;
      if (r.status !== 'executed') setStatus(r, 'executed', user, cs!.number);
    }
    cs!.status = 'distributed';
    cs!.history.push(historyEvent(user.id, 'status_changed', 'distributed'));
    emit();
    await delay(null);
  },

  // ---------- Биржа УзРТСБ (PR-PROC-027…032) ----------
  async submitToExchange(id: ID, user: User) {
    ensure(isBuyer(user));
    const d = coreTables().procurement.find((p) => p.id === id);
    if (!d || d.status !== 'approved' || d.method !== 'exchange') fail('bad_state');
    const amount = total(d!.items);
    const rec = await hubCall('uzex', 'bid.submit', { request: d!.number, lot: d!.items.map((i) => `${i.name} ${i.qty} ${i.unit}`).join('; '), amount }, user, `uzex-bid-${d!.id}`);
    d!.exchange = { status: 'submitted', submittedAt: now(), exchangeId: rec.id, startPrice: amount, ...(rec.status === 'success' ? { lotNo: String((rec.response as { lotNo?: string })?.lotNo ?? '') } : {}) };
    setStatus(d!, 'in_exchange', user, d!.exchange.lotNo ? `УзРТСБ: ${d!.exchange.lotNo}` : `УзРТСБ: ${rec.status}`);
    emit();
    return delay(d!.exchange);
  },
  async syncExchange(id: ID, user: User) {
    const d = coreTables().procurement.find((p) => p.id === id);
    if (!d?.exchange) fail('bad_state');
    const lot = d!.exchange!;
    if (!lot.lotNo) {
      const r = lot.exchangeId ? await integrationHub.getExchange(lot.exchangeId) : undefined;
      if (r?.status !== 'success') fail('integration');
      lot.lotNo = String((r!.response as { lotNo?: string })?.lotNo ?? '');
    }
    const rec = await hubCall('uzex', 'lot.status', { lotNo: lot.lotNo, step: lot.status === 'submitted' ? 1 : 2 }, user);
    if (rec.status !== 'success') fail('integration');
    lot.status = (rec.response as { status: 'trading' | 'submitted' }).status;
    lot.syncedAt = now();
    hist(d!, user, 'status_changed', `УзРТСБ ${lot.lotNo}: ${lot.status}`);
    emit();
    return delay(lot);
  },
  /** Итоги торгов → поставщик (новый — в справочник), договор создаётся автоматически (PR-PROC-029/031). */
  async fetchExchangeResults(id: ID, user: User) {
    ensure(isBuyer(user));
    const db = coreTables();
    const d = db.procurement.find((p) => p.id === id);
    if (!d?.exchange?.lotNo || d.exchange.status === 'won') fail('bad_state');
    const candidates = db.counterparties.filter((c) => !c.blocked && c.type !== 'foreign' && supplierAdmission(c.id).allowed && c.id !== 'c7').map((c) => c.tin);
    const rec = await hubCall('uzex', 'lot.result', { lotNo: d!.exchange!.lotNo, startPrice: d!.exchange!.startPrice, candidates }, user);
    if (rec.status !== 'success') fail('integration');
    const res = rec.response as { status: 'won' | 'failed'; winnerTin: string | null; price: number };
    const lot = d!.exchange!;
    lot.status = res.status;
    lot.syncedAt = now();
    if (res.status !== 'won' || !res.winnerTin) {
      hist(d!, user, 'status_changed', `УзРТСБ ${lot.lotNo}: failed`);
      emit();
      return delay(undefined);
    }
    const cp = db.counterparties.find((c) => c.tin === res.winnerTin)!;
    lot.winnerId = cp.id;
    lot.winnerTin = cp.tin;
    lot.price = res.price;
    const c = createContractRecord({ request: d!, subject: d!.title, counterpartyId: cp.id, amount: res.price, source: 'exchange', departmentId: d!.departmentId, ...(d!.costCenterKey ? { costCenterKey: d!.costCenterKey } : {}) }, user);
    lot.contractId = c.id;
    openContractRoute(c, user);
    setStatus(d!, 'contracted', user, `${lot.lotNo} → ${c.number}`);
    emit();
    return delay(c);
  },
  /** Котировки биржи по номенклатуре (PR-PROC-030). */
  async fetchQuotes(user: User) {
    ensure(isBuyer(user));
    const rec = await hubCall('uzex', 'prices.get', { category: 'ALL' }, user);
    if (rec.status !== 'success') fail('integration');
    const t = procTables();
    const at = now();
    t.quotes = t.catalog.filter((c) => c.kind === 'goods').map((c) => {
      const h = hashOf(c.id + at.slice(0, 10));
      const avg = Math.round((c.refPrice * (92 + (h % 14))) / 100);
      return { catalogId: c.id, min: Math.round(avg * 0.93), avg, max: Math.round(avg * 1.08), deals: 3 + (h % 40), at };
    });
    emit();
    return delay(t.quotes);
  },
  listQuotes: () => delay(procTables().quotes),
  /** Аванс (гарантийный взнос) на биржу — «прочие дебиторские платежи» без договора (PR-CON-010). */
  async exchangeAdvance(id: ID, user: User) {
    ensure(isBuyer(user) || can(user, 'contracts', 'edit'));
    const db = coreTables();
    const d = db.procurement.find((p) => p.id === id);
    if (!d || d.method !== 'exchange' || !['approved', 'in_exchange'].includes(d.status)) fail('bad_state');
    if (d!.exchange?.advanceContractId) fail('bad_state');
    const amount = Math.round(total(d!.items) * 0.03);
    const c: Contract = {
      id: nextId('k'), number: nextNumber('DZ'), subject: `Гарантийный взнос на УзРТСБ по заявке ${d!.number}`, counterpartyId: 'c7', departmentId: d!.departmentId,
      amount, currency: 'UZS', startDate: today(), endDate: addDays(30).slice(0, 10), status: 'active', requestId: d!.id,
      kind: 'other_receivables', subkind: 'exchange_advance', invoiceRef: { number: `UZEX-${d!.number}`, date: today() }, paymentTerms: { type: 'full' }, source: 'exchange',
      ...(d!.costCenterKey ? { costCenterKey: d!.costCenterKey } : {}), initiatorDeptIds: [d!.departmentId],
      payments: [{ dueDate: today(), amount, paid: false, kind: 'advance' }], history: [historyEvent(user.id, 'created', d!.number)],
    };
    db.contracts.unshift(c);
    if (d!.exchange) d!.exchange.advanceContractId = c.id;
    else d!.exchange = { status: 'submitted', submittedAt: now(), startPrice: total(d!.items), advanceContractId: c.id };
    hist(d!, user, 'commented', c.number);
    emit();
    return delay(c);
  },

  // ---------- Тендерные площадки (PR-PROC-033…038) ----------
  /** Передача тендерной документации и объявление тендера на площадке. */
  async publishTender(tenderId: ID, docs: { requirements: string; criteria: string }, user: User) {
    ensure(isBuyer(user));
    const db = coreTables();
    const tn = db.tenders.find((x) => x.id === tenderId);
    if (!tn || tn.status !== 'open') fail('bad_state');
    if (!docs.requirements.trim() || !docs.criteria.trim()) fail('required');
    const req = db.procurement.find((p) => p.id === tn!.requestId);
    const d1 = await hubCall('etender', 'docs.send', { tender: tn!.number, requirements: docs.requirements, criteria: docs.criteria }, user, `et-docs-${tn!.id}`);
    const d2 = await hubCall('etender', 'tender.announce', { tender: tn!.number, deadline: tn!.deadline, amount: req ? total(req.items) : 0 }, user, `et-ann-${tn!.id}`);
    tn!.platform = 'etender';
    tn!.docs = { requirements: docs.requirements.trim(), criteria: docs.criteria.trim(), sentAt: now() };
    tn!.exchangeId = d2.id;
    if (d1.status === 'success' && d2.status === 'success') {
      tn!.externalId = String((d1.response as { externalId?: string })?.externalId ?? '');
      tn!.publishedAt = now();
    }
    if (req) hist(req, user, 'status_changed', `${tn!.number} → etender ${tn!.externalId ?? d2.status}`);
    emit();
    return delay(tn!);
  },
  /** Приём заявок участников с площадки (PR-PROC-036). */
  async fetchTenderBids(tenderId: ID, user: User) {
    ensure(isBuyer(user));
    const db = coreTables();
    const tn = db.tenders.find((x) => x.id === tenderId);
    if (!tn || !['open', 'evaluation'].includes(tn.status)) fail('bad_state');
    const req = db.procurement.find((p) => p.id === tn!.requestId);
    const tins = db.counterparties.filter((c) => !c.blocked && c.type !== 'foreign' && !['c7', 'c8', 'c9', 'c12'].includes(c.id)).map((c) => c.tin);
    const rec = await hubCall('etender', 'bids.get', { tender: tn!.number, amount: req ? total(req.items) : 0, tins }, user);
    if (rec.status !== 'success') fail('integration');
    const bids = (rec.response as { bids: { tin: string; amount: number; deliveryDays: number; score: number }[] }).bids;
    let added = 0;
    for (const b of bids) {
      const cp = db.counterparties.find((c) => c.tin === b.tin);
      if (!cp || tn!.bids.some((x) => x.counterpartyId === cp.id)) continue;
      tn!.bids.push({ counterpartyId: cp.id, amount: b.amount, deliveryDays: b.deliveryDays, score: b.score });
      tn!.bidSources = { ...(tn!.bidSources ?? {}), [cp.id]: 'platform' };
      added++;
    }
    tn!.status = 'evaluation';
    emit();
    return delay(added);
  },
  /** Ручной ввод предложения участника (бумажная заявка, PR-PROC-036). */
  async addManualBid(tenderId: ID, input: { counterpartyId: ID; amount: number; deliveryDays: number }, user: User) {
    ensure(isBuyer(user));
    const tn = coreTables().tenders.find((x) => x.id === tenderId);
    if (!tn || !['open', 'evaluation'].includes(tn.status)) fail('bad_state');
    if (!input.counterpartyId || !(input.amount > 0) || !(input.deliveryDays > 0)) fail('required');
    if (tn!.bids.some((b) => b.counterpartyId === input.counterpartyId)) fail('duplicate_bid');
    if (!supplierAdmission(input.counterpartyId).allowed) fail('supplier_blocked');
    const min = Math.min(input.amount, ...tn!.bids.map((b) => b.amount));
    const score = Math.round(70 * (min / input.amount) + 30 * Math.min(1, 7 / input.deliveryDays));
    tn!.bids.push({ counterpartyId: input.counterpartyId, amount: input.amount, deliveryDays: input.deliveryDays, score });
    tn!.bidSources = { ...(tn!.bidSources ?? {}), [input.counterpartyId]: 'manual' };
    audit.log({ action: 'update', entity: 'tender', entityId: tn!.id, entityLabel: tn!.number, details: `manual bid ${input.counterpartyId} ${input.amount}`, user: who(user) });
    emit();
    await delay(null);
  },
  /** Итоги тендера с площадки: победитель и автоматическое создание договора (PR-PROC-037/038). */
  async fetchTenderResults(tenderId: ID, user: User) {
    ensure(isBuyer(user));
    const db = coreTables();
    const tn = db.tenders.find((x) => x.id === tenderId);
    if (!tn || tn.status === 'awarded' || tn.status === 'cancelled' || !tn.bids.length) fail('bad_state');
    const ranking = [...tn!.bids].filter((b) => supplierAdmission(b.counterpartyId).allowed).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((b) => db.counterparties.find((c) => c.id === b.counterpartyId)?.tin ?? '');
    const rec = await hubCall('etender', 'tender.result', { tender: tn!.number, ranking }, user);
    if (rec.status !== 'success') fail('integration');
    const winnerTin = (rec.response as { winnerTin: string | null }).winnerTin;
    const cp = db.counterparties.find((c) => c.tin === winnerTin);
    if (!cp) fail('bad_state');
    const bid = tn!.bids.find((b) => b.counterpartyId === cp!.id)!;
    tn!.status = 'awarded';
    tn!.winnerId = cp!.id;
    tn!.resultsAt = now();
    const req = db.procurement.find((p) => p.id === tn!.requestId);
    const c = createContractRecord({ ...(req ? { request: req } : {}), subject: tn!.title, counterpartyId: cp!.id, amount: bid.amount, source: 'tender', departmentId: req?.departmentId ?? 'd4', ...(req?.costCenterKey ? { costCenterKey: req.costCenterKey } : {}), endDate: addDays(bid.deliveryDays + 30).slice(0, 10) }, user);
    openContractRoute(c, user);
    if (req) setStatus(req, 'contracted', user, `${tn!.number} → ${c.number}`);
    emit();
    return delay(c);
  },

  // ---------- Поставщики (PR-PROC-047…052) ----------
  supplierRating: (cpId: ID) => supplierRating(cpId),
  supplierAdmission: (cpId: ID) => supplierAdmission(cpId),
  async listSuppliers() {
    const db = coreTables();
    return delay(db.counterparties.map((c) => ({ ...clone(c), ratingCalc: supplierRating(c.id), admission: supplierAdmission(c.id), contracts: db.contracts.filter((k) => k.counterpartyId === c.id).length })));
  },
  async supplierHistory(cpId: ID) {
    const db = coreTables();
    const t = procTables();
    const contracts = db.contracts.filter((c) => c.counterpartyId === cpId);
    const ids = contracts.map((c) => c.id);
    return delay({
      contracts,
      tenders: db.tenders.filter((x) => x.bids.some((b) => b.counterpartyId === cpId)),
      acceptances: t.acceptances.filter((a) => ids.includes(a.contractId)),
      acts: t.acts.filter((a) => ids.includes(a.contractId)),
      claims: t.claims.filter((c) => c.counterpartyId === cpId),
      checks: t.checks.filter((c) => c.counterpartyId === cpId).sort((a, b) => b.at.localeCompare(a.at)),
      rating: supplierRating(cpId),
    });
  },
  /** Проверка: чёрный список банка, санкции, внутренний контроль, сомнительные налогоплательщики (ГНК), долги (МИБ). */
  async checkSupplier(cpId: ID, user: User) {
    const cp = coreTables().counterparties.find((c) => c.id === cpId);
    if (!cp) fail('not_found');
    const hits = listHits(cp!.tin);
    const results: SupplierCheckResult['results'] = [
      { list: 'blacklist', hit: hits.some((h) => h.list === 'blacklist'), ...(hits.find((h) => h.list === 'blacklist') ? { detail: hits.find((h) => h.list === 'blacklist')!.detail } : {}) },
      { list: 'sanctions', hit: hits.some((h) => h.list === 'sanctions'), ...(hits.find((h) => h.list === 'sanctions') ? { detail: hits.find((h) => h.list === 'sanctions')!.detail } : {}) },
      { list: 'internal_control', hit: cp!.blocked },
    ];
    if (/^\d{9}$/.test(cp!.tin) && cp!.type !== 'foreign') {
      const tax = await hubCall('soliq', 'taxpayer.check', { tin: cp!.tin }, user);
      results.push({ list: 'suspicious_tax', hit: tax.status === 'success' ? !!(tax.response as { suspicious?: boolean }).suspicious : false, ...(tax.status !== 'success' ? { detail: tax.status } : {}) });
      const debts = await hubCall('mysud', 'debts.check', { tin: cp!.tin, pinfl: cp!.tin }, user);
      const dr = debts.response as { debts?: number; hasDebt?: boolean; amount?: number } | undefined;
      results.push({ list: 'debts', hit: debts.status === 'success' ? !!(dr?.hasDebt ?? (dr?.debts ?? 0) > 0) : false, ...(debts.status !== 'success' ? { detail: debts.status } : {}) });
    }
    const res: SupplierCheckResult = { id: nextId('sc'), counterpartyId: cp!.id, at: now(), by: user.id, results, passed: !results.some((r) => r.hit && r.list !== 'debts' && r.list !== 'suspicious_tax') };
    procTables().checks.push(res);
    audit.log({ action: 'view', entity: 'supplier_check', entityId: cp!.id, entityLabel: cp!.name, details: results.filter((r) => r.hit).map((r) => r.list).join(', ') || 'ok', user: who(user) });
    emit();
    return delay(res);
  },
  /** Синхронизация реквизитов с Soliqservis по ИНН (PR-PROC-051). */
  async syncSoliq(cpId: ID, user: User) {
    ensure(can(user, 'master-data', 'edit') || isBuyer(user));
    const cp = coreTables().counterparties.find((c) => c.id === cpId);
    if (!cp || cp.type === 'foreign') fail('bad_state');
    const rec = await hubCall('soliq', 'company.get', { tin: cp!.tin }, user);
    if (rec.status !== 'success') fail('integration');
    const r = rec.response as { vatPayer: boolean; status: Counterparty['taxStatus']; director: string; mfo: string; account: string };
    const before = { vatPayer: cp!.vatPayer, taxStatus: cp!.taxStatus, director: cp!.director };
    cp!.vatPayer = r.vatPayer;
    cp!.taxStatus = r.status;
    if (!cp!.director) cp!.director = r.director;
    if (!cp!.mfo) cp!.mfo = r.mfo;
    if (!cp!.bankAccount) cp!.bankAccount = r.account;
    cp!.soliqSyncedAt = now();
    audit.log({ action: 'update', entity: 'counterparty', entityId: cp!.id, entityLabel: cp!.name, changes: [{ field: 'vatPayer', from: String(before.vatPayer ?? '—'), to: String(r.vatPayer) }, { field: 'taxStatus', from: String(before.taxStatus ?? '—'), to: String(r.status) }], details: 'Soliqservis sync', user: who(user) });
    emit();
    return delay(clone(cp!));
  },
  /** Синхронизация с биржевыми и тендерными площадками: участие и победы (PR-PROC-050). */
  async syncPlatforms(user: User) {
    ensure(isBuyer(user) || can(user, 'master-data', 'edit'));
    const db = coreTables();
    let n = 0;
    for (const cp of db.counterparties.filter((c) => c.type !== 'foreign')) {
      const rec = await hubCall('uzex', 'participants.get', { tin: cp.tin }, user);
      if (rec.status !== 'success') continue;
      const r = rec.response as { lots: number; wins: number };
      cp.platformStats = { lots: r.lots, wins: r.wins, syncedAt: now() };
      n++;
    }
    emit();
    return delay(n);
  },
  listSupplierLists: () => delay(procTables().lists),
  async addToBlacklist(input: { tin: string; name: string; reason: string }, user: User) {
    ensure(can(user, 'master-data', 'edit') || isAdmin(user));
    if (!/^\d{9}$/.test(input.tin) || !input.reason.trim()) fail('required');
    procTables().lists.push({ tin: input.tin, name: input.name, list: 'blacklist', reason: input.reason.trim(), since: today() });
    audit.log({ action: 'block', entity: 'supplier_blacklist', entityId: input.tin, entityLabel: input.name, details: input.reason, user: who(user) });
    emit();
    await delay(null);
  },

  // ---------- Приёмка товаров (PR-PROC-058…069) ----------
  listAcceptances: (filter: { contractId?: ID; status?: string } = {}) =>
    delay(procTables().acceptances.filter((a) => (!filter.contractId || a.contractId === filter.contractId) && (!filter.status || a.status === filter.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getAcceptance: (id: ID) => delay(procTables().acceptances.find((a) => a.id === id)),
  /** Позиции к приёмке по договору (остаток по заявке). */
  acceptanceDraft(contractId: ID) {
    const c = coreTables().contracts.find((x) => x.id === contractId);
    return delay(c ? remainingLines(c) : []);
  },
  acceptanceDiscrepancies: (a: Pick<ProcAcceptance, 'lines'>) => acceptanceDiscrepancies(a),
  async createAcceptance(input: { contractId: ID; warehouseId: string; date: string; lines: AcceptanceLine[]; einvoiceId?: ID }, user: User) {
    ensure(isBuyer(user) || can(user, 'warehouse', 'edit') || can(user, 'contracts', 'edit'));
    const db = coreTables();
    const c = db.contracts.find((x) => x.id === input.contractId);
    if (!c || c.status !== 'active') fail('contract_inactive');
    const left = remainingLines(c!);
    if (!input.lines.length || input.lines.some((l) => l.acceptedQty > l.deliveredQty || l.deliveredQty < 0 || l.acceptedQty < 0)) fail('qty');
    for (const l of input.lines) {
      const r = left.find((x) => x.name === l.name);
      if (r && l.acceptedQty > r.orderedQty) fail('qty');
    }
    const req = c!.requestId ? db.procurement.find((p) => p.id === c!.requestId) : undefined;
    const a: ProcAcceptance = {
      id: nextId('ac'), number: nextNumber('AP'), contractId: c!.id, ...(req ? { requestId: req.id } : {}), date: input.date || today(), warehouseId: input.warehouseId,
      lines: clone(input.lines), status: 'draft', ...(input.einvoiceId ? { einvoiceId: input.einvoiceId } : {}),
      // PR-PROC-069: МВЗ фиксируется на основании заявки
      ...(req?.costCenterKey ?? c!.costCenterKey ? { costCenterKey: req?.costCenterKey ?? c!.costCenterKey } : {}),
      claimIds: [], createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created')],
    };
    procTables().acceptances.unshift(a);
    audit.log({ action: 'create', entity: 'acceptance', entityId: a.id, entityLabel: a.number, details: c!.number, user: who(user) });
    emit();
    return delay(a);
  },
  /** Сверка акта приёмки со счётом-фактурой поставщика (PR-PROC-063). */
  async einvoiceMatch(acceptanceId: ID) {
    const a = procTables().acceptances.find((x) => x.id === acceptanceId);
    if (!a?.einvoiceId) return delay(undefined);
    const { einvoicesApi } = await import('../modules/einvoices'); // поздняя загрузка: модуль ЭСФ сам импортирует api ядра
    const inv = await einvoicesApi.get(a.einvoiceId);
    if (!inv) return delay(undefined);
    const net = inv.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const value = acceptanceValue(a);
    return delay({ number: inv.number, net, value, diff: net - value, ok: Math.abs(net - value) <= Math.max(1000, value * 0.005) });
  },
  async linkAcceptanceInvoice(id: ID, einvoiceId: ID, user: User) {
    ensure(isBuyer(user) || can(user, 'warehouse', 'edit') || can(user, 'contracts', 'edit'));
    const a = procTables().acceptances.find((x) => x.id === id);
    if (!a || a.status !== 'draft') fail('bad_state');
    a!.einvoiceId = einvoiceId;
    hist(a!, user, 'commented', `ЭСФ ${einvoiceId}`);
    emit();
    await delay(null);
  },
  /** «Принял» — подразделение-заявитель или завсклад (PR-PROC-068): автооприходование, проводки, МВЗ. */
  async confirmAcceptance(id: ID, user: User) {
    const t = procTables();
    const db = coreTables();
    const a = t.acceptances.find((x) => x.id === id);
    if (!a || a.status !== 'draft') fail('bad_state');
    const req = a!.requestId ? db.procurement.find((p) => p.id === a!.requestId) : undefined;
    const initiatorDept = req ? db.users.find((u) => u.id === req.initiatorId)?.departmentId : undefined;
    const allowed = isAdmin(user) || user.role === 'storekeeper' || !!user.extraRoles?.includes('storekeeper') || (!!req && (user.id === req.initiatorId || user.departmentId === initiatorDept || user.departmentId === req.departmentId));
    ensure(allowed);
    a!.status = 'accepted';
    a!.acceptedBy = user.id;
    a!.acceptedAt = now();
    hist(a!, user, 'approved', 'Принял');
    await postReceipt(a!, user);
    a!.status = 'received';
    const c = db.contracts.find((x) => x.id === a!.contractId);
    if (c) c.history.push(historyEvent(user.id, 'status_changed', `${a!.number}: принято на склад`));
    audit.log({ action: 'approve', entity: 'acceptance', entityId: a!.id, entityLabel: a!.number, details: `Принял · ${acceptanceValue(a!)}`, user: who(user) });
    notifyDoc([...(req ? [req.initiatorId] : []), ...usersByRole('accountant')], { key: 'proc_n_accepted', params: { number: a!.number } }, c?.subject, `/procurement/acceptance/${a!.id}`, 'success');
    emit();
    await delay(null);
  },

  // ---------- Претензии (PR-PROC-062) ----------
  listClaims: (filter: { contractId?: ID; counterpartyId?: ID } = {}) =>
    delay(procTables().claims.filter((c) => (!filter.contractId || c.contractId === filter.contractId) && (!filter.counterpartyId || c.counterpartyId === filter.counterpartyId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  async createClaim(input: { contractId: ID; acceptanceId?: ID; actId?: ID; type: ClaimType; description: string; amount: number; dueDate: string }, user: User) {
    ensure(isBuyer(user) || can(user, 'contracts', 'edit'));
    const c = coreTables().contracts.find((x) => x.id === input.contractId);
    if (!c || !input.description.trim() || !input.dueDate || input.amount < 0) fail('required');
    const cl: ProcClaim = { id: nextId('cl'), number: nextNumber('PT'), counterpartyId: c!.counterpartyId, contractId: c!.id, ...(input.acceptanceId ? { acceptanceId: input.acceptanceId } : {}), ...(input.actId ? { actId: input.actId } : {}), type: input.type, description: input.description.trim(), amount: Math.round(input.amount), dueDate: input.dueDate, status: 'open', createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created')] };
    procTables().claims.unshift(cl);
    if (input.acceptanceId) procTables().acceptances.find((a) => a.id === input.acceptanceId)?.claimIds?.push(cl.id);
    c!.history.push(historyEvent(user.id, 'commented', `Претензия ${cl.number}`));
    audit.log({ action: 'create', entity: 'claim', entityId: cl.id, entityLabel: cl.number, details: `${c!.number} · ${cl.type} · ${cl.amount}`, user: who(user) });
    emit();
    return delay(cl);
  },
  async updateClaim(id: ID, action: 'send' | 'satisfied' | 'rejected' | 'close', response: string, user: User) {
    ensure(isBuyer(user) || can(user, 'contracts', 'edit'));
    const cl = procTables().claims.find((c) => c.id === id);
    if (!cl) fail('not_found');
    const next = { send: 'sent', satisfied: 'satisfied', rejected: 'rejected', close: 'closed' } as const;
    const allowed: Record<typeof action, ProcClaim['status'][]> = { send: ['open'], satisfied: ['sent'], rejected: ['sent'], close: ['satisfied', 'rejected'] };
    if (!allowed[action].includes(cl!.status)) fail('bad_state');
    if ((action === 'satisfied' || action === 'rejected') && !response.trim()) fail('reason');
    cl!.status = next[action];
    if (response.trim()) cl!.response = response.trim();
    cl!.history.push(historyEvent(user.id, 'status_changed', `${action}${response.trim() ? `: ${response.trim()}` : ''}`));
    audit.log({ action: 'update', entity: 'claim', entityId: cl!.id, entityLabel: cl!.number, changes: [{ field: 'status', from: allowed[action][0]!, to: cl!.status }], user: who(user) });
    emit();
    await delay(null);
  },

  // ---------- Акты выполненных работ (PR-PROC-070…082) ----------
  listActs: (filter: { contractId?: ID; status?: string } = {}) =>
    delay(procTables().acts.filter((a) => (!filter.contractId || a.contractId === filter.contractId) && (!filter.status || a.status === filter.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getAct: (id: ID) => delay(procTables().acts.find((a) => a.id === id)),
  actCheck: (a: Pick<ProcWorkAct, 'lines' | 'vatRate' | 'periodFrom' | 'periodTo' | 'contractId' | 'id'>) => actCheck(a),
  actTotals: (a: Pick<ProcWorkAct, 'lines' | 'vatRate'>) => ({ net: actTotal(a), vat: actVat(a), total: actTotal(a) + actVat(a) }),
  async createAct(input: { contractId: ID; periodFrom: string; periodTo: string; description: string; lines: WorkActLine[]; vatRate: number; einvoiceId?: ID; submit: boolean }, user: User) {
    const db = coreTables();
    const c = db.contracts.find((x) => x.id === input.contractId);
    ensure(isBuyer(user) || can(user, 'contracts', 'edit') || (can(user, 'procurement', 'edit') && isCustomerDept(user, c)));
    if (!c || c.status !== 'active') fail('contract_inactive');
    if (!input.description.trim() || !input.lines.length || input.lines.some((l) => !l.description.trim() || !(l.qty > 0) || !(l.unitPrice > 0))) fail('required');
    const req = c!.requestId ? db.procurement.find((p) => p.id === c!.requestId) : undefined;
    const a: ProcWorkAct = {
      id: nextId('wa'), number: nextNumber('AV'), contractId: c!.id, ...(req ? { requestId: req.id } : {}), periodFrom: input.periodFrom, periodTo: input.periodTo, description: input.description.trim(),
      lines: clone(input.lines), vatRate: input.vatRate, status: 'draft',
      // PR-PROC-078: МВЗ из заявки
      ...(req?.costCenterKey ?? c!.costCenterKey ? { costCenterKey: req?.costCenterKey ?? c!.costCenterKey } : {}),
      ...(input.einvoiceId ? { einvoiceId: input.einvoiceId } : {}), defects: [], createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created')],
    };
    const chk = actCheck(a);
    if (!chk.withinAmount) fail('act_amount', String(chk.remaining));
    if (!chk.withinPeriod) fail('act_period');
    procTables().acts.unshift(a);
    audit.log({ action: 'create', entity: 'work_act', entityId: a.id, entityLabel: a.number, details: `${c!.number} · ${chk.amount}`, user: who(user) });
    if (input.submit) await procApi.submitAct(a.id, user);
    emit();
    return delay(a);
  },
  async submitAct(id: ID, user: User) {
    const db = coreTables();
    const a = procTables().acts.find((x) => x.id === id);
    if (!a || a.status !== 'draft') fail('bad_state');
    const chk = actCheck(a!);
    if (!chk.withinAmount) fail('act_amount', String(chk.remaining));
    const c = db.contracts.find((x) => x.id === a!.contractId)!;
    a!.status = 'pending';
    hist(a!, user, 'submitted');
    const prior = approvalEngine.instancesFor(a!.id).length;
    if (prior && approvalsResubmittable(a!.id)) approvalEngine.resubmit(a!.id, user);
    else approvalEngine.open({ entity: 'work_act', entityId: a!.id, number: a!.number, title: a!.description.slice(0, 80), requesterId: user.id, amount: chk.amount, context: { kind: c.kind, departmentId: c.departmentId } });
    audit.log({ action: 'submit', entity: 'work_act', entityId: a!.id, entityLabel: a!.number, user: who(user) });
    emit();
    await delay(null);
  },
  /** Подпись заказчика (E-IMZO) после согласования (PR-PROC-076). */
  async signAct(id: ID, signatureId: ID, user: User) {
    const a = procTables().acts.find((x) => x.id === id);
    const sig = signatureService.get(signatureId);
    if (!a || a.status !== 'approved') fail('bad_state');
    if (!sig || sig.entity !== 'work_act' || sig.entityId !== id || sig.userId !== user.id) fail('signature');
    a!.customerSignatureId = signatureId;
    a!.status = 'signed';
    hist(a!, user, 'status_changed', `E-IMZO ${sig!.certSerial}`);
    emit();
    await delay(null);
  },
  /** Отправка исполнителю через оператора ЭДО (Didox) для двусторонней подписи (PR-PROC-079). */
  async sendActToContractor(id: ID, user: User) {
    const db = coreTables();
    const a = procTables().acts.find((x) => x.id === id);
    if (!a || a.status !== 'signed') fail('bad_state');
    const c = db.contracts.find((x) => x.id === a!.contractId)!;
    const cp = db.counterparties.find((x) => x.id === c.counterpartyId)!;
    const rec = await hubCall('soliq', 'act.send', { number: a!.number, tin: cp.tin, amount: actTotal(a!) + actVat(a!) }, user, `act-send-${a!.id}`);
    a!.platformExchangeId = rec.id;
    if (rec.status === 'success') {
      a!.status = 'sent';
      hist(a!, user, 'status_changed', `Didox ${(rec.response as { extId?: string }).extId ?? ''}`);
    }
    emit();
    return delay(rec.status);
  },
  async syncActStatus(id: ID, user: User) {
    const db = coreTables();
    const a = procTables().acts.find((x) => x.id === id);
    if (!a || a.status !== 'sent' || !a.platformExchangeId) fail('bad_state');
    const sent = await integrationHub.getExchange(a!.platformExchangeId!);
    const extId = String((sent?.response as { extId?: string } | undefined)?.extId ?? a!.number);
    const rec = await hubCall('soliq', 'act.status', { extId }, user);
    if (rec.status !== 'success') fail('integration');
    const c = db.contracts.find((x) => x.id === a!.contractId)!;
    const cp = db.counterparties.find((x) => x.id === c.counterpartyId)!;
    a!.contractorSigned = { at: now(), name: cp.name, extId };
    completeAct(a!, user);
    emit();
    await delay(null);
  },
  /** Оценка качества (PR-PROC-081) — влияет на рейтинг поставщика. */
  async rateAct(id: ID, score: number, comment: string, user: User) {
    const a = procTables().acts.find((x) => x.id === id);
    ensure(actEditor(user, a));
    if (!a || !['signed', 'sent', 'completed'].includes(a.status)) fail('bad_state');
    if (!(score >= 1 && score <= 5)) fail('required');
    if (score <= 3 && !comment.trim()) fail('reason');
    a!.quality = { score, comment: comment.trim(), by: user.id, at: now() };
    hist(a!, user, 'commented', `Оценка качества: ${score}/5`);
    emit();
    await delay(null);
  },
  /** Фиксация недостатков (PR-PROC-082). */
  async addDefect(id: ID, description: string, dueDate: string, user: User) {
    const a = procTables().acts.find((x) => x.id === id);
    ensure(actEditor(user, a));
    if (!a) fail('not_found');
    if (!description.trim() || !dueDate) fail('required');
    a!.defects.push({ id: nextId('df'), description: description.trim(), dueDate, status: 'open' });
    hist(a!, user, 'commented', `Недостаток: ${description.trim()}`);
    const c = coreTables().contracts.find((x) => x.id === a!.contractId);
    if (c) notifyDoc(usersByRole('procurement'), { key: 'proc_n_defect', params: { number: a!.number } }, description, `/procurement/acts/${a!.id}`, 'warning');
    emit();
    await delay(null);
  },
  /** Акт об устранении недостатков. */
  async fixDefect(id: ID, defectId: ID, user: User) {
    const a = procTables().acts.find((x) => x.id === id);
    ensure(actEditor(user, a));
    const d = a?.defects.find((x) => x.id === defectId);
    if (!a || !d || d.status !== 'open') fail('bad_state');
    d!.status = 'fixed';
    d!.fixedAt = now();
    d!.fixActNumber = nextNumber('AU');
    hist(a!, user, 'status_changed', `${d!.fixActNumber}: ${d!.description}`);
    emit();
    await delay(null);
  },

  // ---------- Проводки (PR-PROC-039/040/057/066) ----------
  listPostings: (filter: { contractId?: ID; docId?: ID; status?: string } = {}) =>
    delay(procTables().postings.filter((p) => (!filter.contractId || p.contractId === filter.contractId) && (!filter.docId || p.docId === filter.docId) && (!filter.status || p.status === filter.status))),
  async signPosting(id: ID, signatureId: ID, user: User) {
    ensure(can(user, 'contracts', 'edit') || can(user, 'warehouse', 'edit') || isAdmin(user));
    const p = procTables().postings.find((x) => x.id === id);
    const sig = signatureService.get(signatureId);
    if (!p || p.status !== 'draft') fail('bad_state');
    if (!sig || sig.entity !== 'posting' || sig.entityId !== id || sig.userId !== user.id) fail('signature');
    p!.signatureId = signatureId;
    p!.status = 'signed';
    emit();
    await delay(null);
  },
  /** Пакет проводок в iABS (только подписанный E-IMZO). */
  async sendPosting(id: ID, user: User) {
    const p = procTables().postings.find((x) => x.id === id);
    if (!p || !['signed', 'failed'].includes(p.status)) fail('bad_state');
    const entries = p!.entries.map((e) => ({ debit: e.debit, credit: e.credit, amount: e.amount }));
    const rec = await hubCall('iabs', 'postings.batch', { batch: p!.number, entries, controlSum: entries.reduce((s, e) => s + e.amount, 0) }, user, `post-${p!.id}`);
    p!.exchangeId = rec.id;
    p!.status = rec.status === 'success' ? 'posted' : rec.status === 'queued' || rec.status === 'pending' ? 'sent' : 'failed';
    audit.log({ action: 'update', entity: 'posting', entityId: p!.id, entityLabel: p!.number, details: `iABS: ${rec.status}`, user: who(user) });
    emit();
    return delay(p!.status);
  },

  // ---------- Электронные договоры Soliqservis/Didox (PR-PROC-053…057, PR-CON-018) ----------
  listPlatformContracts: () => delay(procTables().platform),
  async fetchPlatformContracts(user: User) {
    const rec = await hubCall('soliq', 'econtract.receive', { since: addDays(-1).slice(0, 19) }, user);
    if (rec.status !== 'success') fail('integration');
    const t = procTables();
    const n = t.platform.length;
    const cp = coreTables().counterparties.find((c) => c.id === 'c11')!;
    t.platform.unshift({ id: nextId('pc'), platform: 'didox', extId: `DX-2026-${String(118800 + n)}`, direction: 'in', number: `D-${50 + n}/2026`, date: today(), counterpartyTin: cp.tin, counterpartyName: cp.name, subject: 'Сервисное обслуживание систем кондиционирования', amount: 48_000_000 + n * 1_000_000, status: 'incoming', receivedAt: now() });
    emit();
    return delay(1);
  },
  /** Подписание E-IMZO договора с платформы → автоматическое создание договора и проводки (PR-PROC-055/056/057). */
  async signPlatformContract(id: ID, signatureId: ID, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const t = procTables();
    const db = coreTables();
    const pc = t.platform.find((x) => x.id === id);
    const sig = signatureService.get(signatureId);
    if (!pc || pc.status !== 'incoming') fail('bad_state');
    if (!sig || sig.entity !== 'platform_contract' || sig.entityId !== id || sig.userId !== user.id) fail('signature');
    const rec = await hubCall('soliq', 'econtract.sign', { extId: pc!.extId, hash: sig!.hash }, user, `pc-sign-${pc!.id}`);
    if (rec.status !== 'success') fail('integration');
    let cp = db.counterparties.find((c) => c.tin === pc!.counterpartyTin);
    if (!cp) {
      cp = { id: nextId('c'), name: pc!.counterpartyName, tin: pc!.counterpartyTin, type: 'legal', address: '—', phone: '—', rating: 3, blocked: false };
      db.counterparties.push(cp);
    }
    if (!supplierAdmission(cp.id).allowed) fail('supplier_blocked');
    const c = createContractRecord({ subject: pc!.subject, counterpartyId: cp.id, amount: pc!.amount, source: 'platform', departmentId: user.departmentId, status: 'active', platform: { name: pc!.platform, extId: pc!.extId, status: 'signed', exchangeId: rec.id } }, user);
    c.kind = 'services';
    c.signatureIds = [signatureId];
    pc!.status = 'signed';
    pc!.signatureId = signatureId;
    pc!.contractId = c.id;
    audit.log({ action: 'approve', entity: 'platform_contract', entityId: pc!.id, entityLabel: pc!.extId, details: c.number, user: who(user) });
    emit();
    return delay(c);
  },
  async rejectPlatformContract(id: ID, reason: string, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const pc = procTables().platform.find((x) => x.id === id);
    if (!pc || pc.status !== 'incoming') fail('bad_state');
    if (!reason.trim()) fail('reason');
    const rec = await hubCall('soliq', 'econtract.reject', { extId: pc!.extId, reason: reason.trim() }, user, `pc-rej-${pc!.id}`);
    if (rec.status !== 'success') fail('integration');
    pc!.status = 'rejected';
    pc!.rejectReason = reason.trim();
    audit.log({ action: 'reject', entity: 'platform_contract', entityId: pc!.id, entityLabel: pc!.extId, details: reason, user: who(user) });
    emit();
    await delay(null);
  },
  /** Передача договора банка на платформу (PR-PROC-054). */
  async sendContractToPlatform(contractId: ID, user: User) {
    ensure(can(user, 'contracts', 'edit'));
    const db = coreTables();
    const c = db.contracts.find((x) => x.id === contractId);
    if (!c || !['active', 'pending'].includes(c.status) || c.platform) fail('bad_state');
    const cp = db.counterparties.find((x) => x.id === c!.counterpartyId)!;
    if (cp.type === 'foreign') fail('bad_state');
    const rec = await hubCall('soliq', 'econtract.send', { number: c!.number, tin: cp.tin, amount: c!.amount }, user, `pc-send-${c!.id}`);
    c!.platform = { name: 'didox', extId: rec.status === 'success' ? String((rec.response as { extId?: string }).extId ?? '') : '', status: 'sent', exchangeId: rec.id };
    procTables().platform.unshift({ id: nextId('pc'), platform: 'didox', extId: c!.platform.extId, direction: 'out', number: c!.number, date: today(), counterpartyTin: cp.tin, counterpartyName: cp.name, subject: c!.subject, amount: c!.amount, status: 'sent', contractId: c!.id, receivedAt: now() });
    c!.history.push(historyEvent(user.id, 'status_changed', `Didox: ${c!.platform.extId || rec.status}`));
    emit();
    return delay(rec.status);
  },
  async syncPlatformContract(contractId: ID, user: User) {
    const c = coreTables().contracts.find((x) => x.id === contractId);
    if (!c?.platform?.extId) fail('bad_state');
    const rec = await hubCall('soliq', 'econtract.status', { extId: c!.platform!.extId }, user);
    if (rec.status !== 'success') fail('integration');
    c!.platform!.status = 'counter_signed';
    const pc = procTables().platform.find((x) => x.contractId === c!.id && x.direction === 'out');
    if (pc) pc.status = 'counter_signed';
    c!.history.push(historyEvent(user.id, 'status_changed', 'Didox: подписан контрагентом'));
    emit();
    await delay(null);
  },

  // ---------- Мониторинг и аналитика (PR-PROC-025, 041…045) ----------
  async dashboard() {
    const db = coreTables();
    const reqs = db.procurement;
    const byStatus = new Map<string, number>();
    const byMethod = new Map<string, number>();
    const byDept = new Map<string, number>();
    for (const r of reqs) {
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
      byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + total(r.items));
      byDept.set(r.departmentId, (byDept.get(r.departmentId) ?? 0) + total(r.items));
    }
    const submitted = reqs.filter((r) => r.status !== 'draft').length;
    const approved = reqs.filter((r) => ['approved', 'in_tender', 'in_exchange', 'contracted', 'executed', 'consolidated'].includes(r.status)).length;
    const contracted = reqs.filter((r) => ['contracted', 'executed'].includes(r.status)).length;
    const executed = reqs.filter((r) => r.status === 'executed').length;
    const overdue = reqs.filter((r) => r.neededBy < today() && !['executed', 'rejected', 'consolidated', 'draft'].includes(r.status));
    return delay({
      total: reqs.length,
      amount: reqs.filter((r) => r.status !== 'rejected').reduce((s, r) => s + total(r.items), 0),
      byStatus: [...byStatus.entries()].map(([k, v]) => ({ key: k, value: v })),
      byMethod: [...byMethod.entries()].map(([k, v]) => ({ key: k, value: v })),
      byDept: [...byDept.entries()].map(([k, v]) => ({ key: k, value: v })).sort((a, b) => b.value - a.value),
      funnel: [
        { key: 'submitted', value: submitted },
        { key: 'approved', value: approved },
        { key: 'contracted', value: contracted },
        { key: 'executed', value: executed },
      ],
      overdue: overdue.map((r) => ({ id: r.id, number: r.number, title: r.title, neededBy: r.neededBy, status: r.status })),
      regionQueue: reqs.filter((r) => r.intake === 'region' && r.status === 'pending').length,
      openClaims: procTables().claims.filter((c) => ['open', 'sent'].includes(c.status)).length,
      pendingAcceptance: db.contracts.filter((c) => c.status === 'active' && c.kind === 'fixed_assets' && remainingLines(c).length).length,
    });
  },
  /** Отчёт по заявкам: отправлено, на исполнении, возвращено, принято, исполнено (PR-PROC-025). */
  async requestReport(filter: { from?: string; to?: string; branch?: 'all' | 'ho' | 'branches' } = {}) {
    const db = coreTables();
    const rows = db.procurement.filter((r) => (!filter.from || r.createdAt.slice(0, 10) >= filter.from) && (!filter.to || r.createdAt.slice(0, 10) <= filter.to) && (!filter.branch || filter.branch === 'all' || (filter.branch === 'ho' ? regionOf(r.branchKey) === 'HO' : regionOf(r.branchKey) !== 'HO')));
    const groups = new Map<string, { unit: string; sent: number; inWork: number; returned: number; accepted: number; executed: number; amount: number }>();
    for (const r of rows) {
      const unit = regionOf(r.branchKey) === 'HO' ? r.departmentId : regionOf(r.branchKey);
      const g = groups.get(unit) ?? { unit, sent: 0, inWork: 0, returned: 0, accepted: 0, executed: 0, amount: 0 };
      const wasReturned = r.history.some((h) => h.action === 'returned') || r.status === 'returned';
      if (r.status !== 'draft') g.sent++;
      if (r.status === 'pending') g.inWork++;
      if (wasReturned) g.returned++;
      if (['approved', 'in_tender', 'in_exchange', 'contracted', 'consolidated', 'executed'].includes(r.status)) g.accepted++;
      if (r.status === 'executed') g.executed++;
      g.amount += total(r.items);
      groups.set(unit, g);
    }
    return delay([...groups.values()].sort((a, b) => b.sent - a.sent));
  },
  /** Анализ закупок: экономия против справочной цены и стартовой суммы, сроки, доли поставщиков (PR-PROC-045). */
  async analysis() {
    const db = coreTables();
    const cat = procTables().catalog;
    const contracted = db.contracts.filter((c) => c.requestId && c.currency === 'UZS');
    const savings = contracted.map((c) => {
      const r = db.procurement.find((p) => p.id === c.requestId)!;
      const planned = total(r.items);
      const ref = r.items.reduce((s, i) => s + i.qty * (cat.find((x) => x.id === i.catalogId)?.refPrice ?? i.unitPrice), 0);
      return { contractId: c.id, number: c.number, request: r.number, planned, ref, contracted: c.amount, saving: planned - c.amount, savingPct: planned ? Math.round(((planned - c.amount) / planned) * 1000) / 10 : 0, leadDays: daysBetween(r.createdAt, c.history[0]?.at ?? c.startDate), method: r.method };
    });
    const suppliers = new Map<ID, number>();
    for (const c of db.contracts.filter((x) => x.currency === 'UZS')) suppliers.set(c.counterpartyId, (suppliers.get(c.counterpartyId) ?? 0) + c.amount);
    const prices = db.procurement.flatMap((r) => r.items.filter((i) => i.catalogId).map((i) => ({ request: r.number, name: i.name, price: i.unitPrice, ref: cat.find((x) => x.id === i.catalogId)!.refPrice })));
    return delay({
      savings,
      totalSaving: savings.reduce((s, x) => s + x.saving, 0),
      avgLead: savings.length ? Math.round(savings.reduce((s, x) => s + x.leadDays, 0) / savings.length) : 0,
      suppliers: [...suppliers.entries()].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount),
      prices: prices.map((p) => ({ ...p, deviationPct: Math.round(((p.price - p.ref) / p.ref) * 1000) / 10 })),
    });
  },
  /** Сводный журнал операций модуля закупок (PR-PROC-044) — из журнала аудита. */
  async operations(filter: ProcOperationsFilter = {}): Promise<AuditEntry[]> {
    const ENT = ['procurement', 'tender', 'contract', 'acceptance', 'claim', 'work_act', 'proc_consolidation', 'posting', 'platform_contract', 'proc_catalog', 'supplier_check', 'payment_order'];
    const q = filter.q?.trim().toLowerCase();
    const rows = auditApi.snapshot().filter(
      (e) => ENT.includes(e.entity) && (!filter.from || e.at.slice(0, 10) >= filter.from) && (!filter.to || e.at.slice(0, 10) <= filter.to) && (!filter.action || e.action === filter.action) && (!q || `${e.entityLabel ?? ''} ${e.details ?? ''} ${e.userName}`.toLowerCase().includes(q)),
    );
    return delay(rows.sort((a, b) => b.at.localeCompare(a.at)));
  },
};

function approvalsResubmittable(entityId: ID): boolean {
  const inst = approvalEngine.instancesFor(entityId);
  const last = inst[inst.length - 1];
  return !!last && (last.status === 'returned' || last.status === 'rejected');
}

export type { ProcPosting, PlatformContract, Tender };
