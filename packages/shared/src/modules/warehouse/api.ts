// API модуля «Склад» (ТЗ 4.2.4): карточки, партии (FIFO, сроки годности), поступления (М-4) со сверкой ЭСФ,
// электронные заявки на выдачу с подписями и «Принял» (М-11), акты списания с комиссией, инвентаризация ТМЗ/МБП,
// учёт МБП (4.2.4.4), лимиты и уведомления, проводки в iABS, ежедневный мониторинг, отчёты.
import { clone, delay, emit, historyEvent, nextId, nextNumber, now, today } from '../../bus';
import { api } from '../../api';
import { approvalEngine } from '../../engine';
import { audit, diffFields } from '../../audit';
import { notify } from '../../notifications';
import { orgApi } from '../../org';
import { can } from '../../security';
import { matches, registerSearchProvider } from '../../search';
import { signatureService } from '../../services/signature';
import { importRegistry } from '../../services/importer';
import { einvoicesApi } from '../einvoices';
import type { CostCenter, ID, Localized, User } from '../../types';
import {
  ean13, mbpSeed, warehouseBatchesSeed, warehouseCardsSeed, warehouseGroupsSeed, warehouseInventoriesSeed, warehouseIssueApprovalSeed, warehouseIssuesSeed,
  warehouseItemsSeed, warehouseLocationsSeed, warehouseMovementsSeed, warehouseReceiptsSeed, warehouseWriteoffsSeed,
} from './data';
import { WMS_ACCOUNTS, wmsLedger } from './ledger';
import type {
  MbpRecord, NewWarehouseMovementInput, WarehouseBatch, WarehouseBatchAlloc, WarehouseCard, WarehouseCardStatus, WarehouseCardVersion, WarehouseCategory, WarehouseCommission, WarehouseSettings,
  WarehouseInventory, WarehouseInventoryScope, WarehouseIssue, WarehouseIssueLine, WarehouseIssueReportRow, WarehouseIssueSource, WarehouseItem, WarehouseMovement,
  WarehouseMovementType, WarehouseReceipt, WarehouseReceiptLine, WarehouseReconDiff, WarehouseReserveInput, WarehouseSignRole, WarehouseStats, WarehouseWriteoff,
  WarehouseWriteoffKind, WarehouseWriteoffReason, WmsMonitoringRun, WmsReconRow,
} from './types';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const MLN = 1_000_000;

const locations = clone(warehouseLocationsSeed);
const groups = clone(warehouseGroupsSeed);
const cards = clone(warehouseCardsSeed);
const cardVersions: WarehouseCardVersion[] = [];
const items = clone(warehouseItemsSeed);
const batches = clone(warehouseBatchesSeed);
const movements = clone(warehouseMovementsSeed);
const receipts = clone(warehouseReceiptsSeed);
const issues = clone(warehouseIssuesSeed);
const writeoffs = clone(warehouseWriteoffsSeed);
const inventories = clone(warehouseInventoriesSeed);
const mbp = clone(mbpSeed);
const monitoringRuns: WmsMonitoringRun[] = [];

/**
 * Настройки уведомлений (PR-WMS-040): порог «залежалости» — дней на складе (общий и по категориям номенклатуры)
 * и горизонт предупреждения о сроке годности. Меняются уполномоченной ролью через warehouseApi.updateSettings.
 */
export const WAREHOUSE_SETTINGS: WarehouseSettings = { staleDays: 365, staleByCategory: {}, expiryWarnDays: 30 };
/** Порог залежалости (дней) для категории номенклатуры: настройка категории или общий порог. */
export function warehouseStaleThreshold(category: WarehouseCategory): number {
  return WAREHOUSE_SETTINGS.staleByCategory[category] ?? WAREHOUSE_SETTINGS.staleDays;
}
/** Изменять пороги могут главный бухгалтер, администратор или роль с уровнем «admin» в модуле «Склад». */
export const canEditWarehouseSettings = (user: User): boolean => can(user, 'warehouse', 'admin') || user.role === 'accountant' || user.role === 'admin';
const staleOf = (b: WarehouseBatch, t: string) => daysBetween(b.receivedAt, t) >= warehouseStaleThreshold(itemById(b.itemId)?.category ?? 'office');

// ---------- Исторический журнал для дашборда (май–сентябрь; на остатки не влияет) ----------
(() => {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const plan: [WarehouseMovementType, ID, number, ID | undefined, string][] = [
    ['receipt', 'wi1', 400, undefined, 'CC0007'], ['issue', 'wi1', 260, 'd1', 'CC0002'], ['issue', 'wi3', 18, 'd1', 'CC0002'], ['issue', 'wi5', 60, 'd9', 'CC0044'],
    ['issue', 'wi6', 900, 'd8', 'CC0025'], ['receipt', 'wi6', 1500, undefined, 'CC0007'], ['issue', 'wi2', 40, 'd7', 'CC0022'], ['writeoff', 'wi7', 2, undefined, 'CC0188'],
  ];
  let n = 1000;
  months.forEach((m, mi) => {
    plan.forEach(([type, itemId, qty, dept, cc], pi) => {
      if ((mi + pi) % 3 === 2) return;
      const it = items.find((i) => i.id === itemId)!;
      const q = Math.round(qty * (0.7 + ((mi * 7 + pi * 3) % 6) / 10));
      movements.push({
        id: `wmh${++n}`, number: `SK-2026-${String(n - 100).padStart(4, '0')}`, type, itemId, qty: q, warehouseId: it.warehouseId, ...(dept ? { departmentId: dept } : {}),
        userId: 'u14', at: `${m}-${String(5 + ((pi * 3) % 20)).padStart(2, '0')}T10:00:00Z`, amount: q * it.unitCost, costCenterId: cc, comment: 'Архив журнала',
      });
    });
  });
})();

// ---------- Справочные функции ----------

const cardById = (id: ID) => cards.find((c) => c.id === id);
const groupById = (id: ID) => groups.find((g) => g.id === id);
const itemById = (id: ID) => items.find((i) => i.id === id);
const locById = (id: ID) => locations.find((l) => l.id === id);
const groupOfItem = (it: WarehouseItem) => groupById(cardById(it.cardId)!.groupId)!;
const available = (it: WarehouseItem) => it.qty - it.reserved;
const isLow = (i: WarehouseItem) => i.qty < i.minQty;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);

/** Пересчитать остаток и среднюю цену позиции по партиям, обновить реквизиты карточки. */
function refresh(it: WarehouseItem): void {
  const mine = batches.filter((b) => b.itemId === it.id && b.qtyLeft > 0);
  it.qty = mine.reduce((s, b) => s + b.qtyLeft, 0);
  const value = mine.reduce((s, b) => s + b.qtyLeft * b.unitCost, 0);
  const c = cardById(it.cardId)!;
  if (it.qty > 0) it.unitCost = Math.round(value / it.qty);
  else if (!it.unitCost) it.unitCost = c.defaultPrice;
  it.sku = c.cardNo;
  it.name = c.name;
  it.unit = c.unit;
  it.category = groupById(c.groupId)!.category;
}
const itemValue = (it: WarehouseItem) => batches.filter((b) => b.itemId === it.id).reduce((s, b) => s + b.qtyLeft * b.unitCost, 0);

/** Списать количество по FIFO (самые ранние партии первыми). */
function consumeFifo(it: WarehouseItem, qty: number): { allocs: WarehouseBatchAlloc[]; amount: number } {
  if (qty > it.qty) throw new Error('INSUFFICIENT_STOCK');
  const allocs: WarehouseBatchAlloc[] = [];
  let left = qty;
  for (const b of batches.filter((x) => x.itemId === it.id && x.qtyLeft > 0).sort((a, c) => a.receivedAt.localeCompare(c.receivedAt) || a.id.localeCompare(c.id))) {
    if (left <= 0) break;
    const take = Math.min(left, b.qtyLeft);
    b.qtyLeft -= take;
    left -= take;
    allocs.push({ batchId: b.id, qty: take, unitCost: b.unitCost });
  }
  refresh(it);
  return { allocs, amount: allocs.reduce((s, a) => s + a.qty * a.unitCost, 0) };
}

/** Оценка стоимости списания по FIFO без изменения партий. */
function fifoPreview(it: WarehouseItem, qty: number): number {
  let left = qty;
  let sum = 0;
  for (const b of batches.filter((x) => x.itemId === it.id && x.qtyLeft > 0).sort((a, c) => a.receivedAt.localeCompare(c.receivedAt))) {
    if (left <= 0) break;
    const take = Math.min(left, b.qtyLeft);
    sum += take * b.unitCost;
    left -= take;
  }
  return sum + Math.max(0, left) * it.unitCost;
}

function addBatch(it: WarehouseItem, qty: number, unitCost: number, opts: { receiptId?: ID; expiryDate?: string; receivedAt?: string } = {}): WarehouseBatch {
  const at = opts.receivedAt ?? today();
  const b: WarehouseBatch = {
    id: nextId('wb'),
    itemId: it.id,
    batchNo: `P-${at.replace(/-/g, '').slice(2)}-${String(batches.length + 1).padStart(3, '0')}`,
    receivedAt: at,
    qtyIn: qty,
    qtyLeft: qty,
    unitCost: Math.round(unitCost),
    ...(opts.receiptId ? { receiptId: opts.receiptId } : {}),
    ...(opts.expiryDate ? { expiryDate: opts.expiryDate } : {}),
  };
  batches.push(b);
  refresh(it);
  return b;
}

function itemFor(cardId: ID, warehouseId: ID): WarehouseItem {
  let it = items.find((i) => i.cardId === cardId && i.warehouseId === warehouseId);
  if (!it) {
    const c = cardById(cardId)!;
    it = { id: nextId('wi'), cardId, warehouseId, qty: 0, reserved: 0, minQty: 0, unitCost: c.defaultPrice, sku: c.cardNo, name: c.name, category: groupById(c.groupId)!.category, unit: c.unit };
    items.push(it);
  }
  return it;
}

function pushMovement(m: Omit<WarehouseMovement, 'id' | 'number' | 'at'> & { at?: string }): WarehouseMovement {
  const mv: WarehouseMovement = { id: nextId('wm'), number: nextNumber('SK'), at: m.at ?? now(), ...m };
  movements.push(mv);
  return mv;
}

// ---------- Права ----------

/** Складские операции (приход, перемещение, выдача, документы) — по матрице прав модуля «Склад» (edit). */
export const canPostWarehouse = (user: User): boolean => can(user, 'warehouse', 'edit');
/** Создать электронную заявку на выдачу может любой пользователь с доступом к модулю (просмотр). */
export const canRequestWarehouse = (user: User): boolean => can(user, 'warehouse', 'view');
const isAdmin = (u: User) => u.role === 'admin';
const hasRole = (u: User, ...roles: User['role'][]) => roles.includes(u.role) || !!u.extraRoles?.some((r) => roles.includes(r));

/** Кто вправе подписать расход в роли: закреплённый руководитель, операционный сотрудник, заведующий складом, получатель. */
export function canSignIssueAs(issue: WarehouseIssue, role: WarehouseSignRole, user: User): boolean {
  const loc = locById(issue.warehouseId);
  if (role === 'recipient') return user.id === issue.recipientId;
  if (issue.signatures.some((s) => s.userId === user.id && s.role !== role)) return false; // один человек — одна подпись
  if (role === 'head') return user.id === loc?.headId || isAdmin(user);
  if (role === 'operator') return hasRole(user, 'accountant', 'data_entry') || isAdmin(user);
  return hasRole(user, 'storekeeper') || user.id === loc?.managerId || isAdmin(user);
}

// ---------- Мониторинг: незавершённые операции и сверка с iABS ----------

export interface WarehouseUnfinished {
  type: 'receipt' | 'issue' | 'writeoff' | 'inventory' | 'posting';
  id: ID;
  number: string;
  status: string;
  since: string;
  link: string;
}

function unfinishedList(): WarehouseUnfinished[] {
  const out: WarehouseUnfinished[] = [];
  receipts.filter((r) => r.status === 'draft').forEach((r) => out.push({ type: 'receipt', id: r.id, number: r.number, status: r.status, since: r.createdAt, link: `/warehouse/receipts/${r.id}` }));
  issues.filter((i) => i.status === 'approved' || i.status === 'issued' || i.status === 'pending').forEach((i) => out.push({ type: 'issue', id: i.id, number: i.number, status: i.status, since: i.issuedAt ?? i.submittedAt ?? i.createdAt, link: `/warehouse/issues/${i.id}` }));
  writeoffs.filter((w) => ['draft', 'commission', 'pending', 'returned'].includes(w.status)).forEach((w) => out.push({ type: 'writeoff', id: w.id, number: w.number, status: w.status, since: w.createdAt, link: `/warehouse/writeoffs/${w.id}` }));
  inventories.filter((v) => v.status !== 'approved').forEach((v) => out.push({ type: 'inventory', id: v.id, number: v.number, status: v.status, since: v.date, link: `/warehouse/inventory/${v.id}` }));
  return out.sort((a, b) => a.since.localeCompare(b.since));
}

function reconRows(): WmsReconRow[] {
  const accs = new Map<string, { module: 'warehouse' | 'mbp'; erp: number }>();
  for (const it of items) {
    const g = groupOfItem(it);
    const r = accs.get(g.account) ?? { module: g.kind === 'mbp' ? 'mbp' : 'warehouse', erp: 0 };
    r.erp += itemValue(it);
    accs.set(g.account, r);
  }
  const inUse = mbp.filter((m) => m.status === 'in_use' || m.status === 'pending_writeoff').reduce((s, m) => s + m.qty * m.unitCost, 0);
  accs.set('96335000', { module: 'mbp', erp: inUse });
  return [...accs.entries()]
    .map(([account, r]) => {
      const iabs = wmsLedger.iabsBalance(account);
      return { module: r.module, account, name: WMS_ACCOUNTS[account] ?? L(account, account, account), erp: Math.round(r.erp), iabs: Math.round(iabs), diff: Math.round(r.erp - iabs) };
    })
    .sort((a, b) => a.account.localeCompare(b.account));
}

// Остатки iABS на начало: как будто все засеянные проводки были проведены; неподтверждённые дают расхождение.
function initLedger(): void {
  wmsLedger.seed({ id: 'wp-seed-1', number: 'PR-2026-0901', date: '2026-10-02', module: 'warehouse', docType: 'receipt', docId: 'rc1', docNumber: 'PO-2026-0412', entries: [{ debit: '19909000', credit: '29802000', amount: 32_400_000, costCenterId: 'CC0007', text: 'Поступление ТМЗ, М-4 PO-2026-0412' }], status: 'confirmed', createdBy: 'u14', createdAt: '2026-10-02T09:15:00Z', confirmedAt: '2026-10-02T09:15:30Z' });
  wmsLedger.seed({ id: 'wp-seed-2', number: 'PR-2026-0907', date: '2026-10-07', module: 'warehouse', docType: 'issue', docId: 'is1', docNumber: 'ZV-2026-0101', entries: [{ debit: '56804000', credit: '19913000', amount: 15_120_000, costCenterId: 'CC0002', text: 'Расход ТМЗ, М-11 ZV-2026-0101' }], status: 'confirmed', createdBy: 'u14', createdAt: '2026-10-07T11:40:00Z', confirmedAt: '2026-10-07T11:40:40Z' });
  wmsLedger.seed({ id: 'wp-seed-3', number: 'PR-2026-0914', date: '2026-10-14', module: 'warehouse', docType: 'writeoff', docId: 'wa1', docNumber: 'AS-2026-0031', entries: [{ debit: '56802000', credit: '19909000', amount: 420_000, costCenterId: 'CC0188', text: 'Списание ТМЗ по акту AS-2026-0031' }], status: 'error', error: 'timeout: iABS не ответил за 30 с', createdBy: 'u14', createdAt: '2026-10-14T10:00:00Z' });
  wmsLedger.seed({ id: 'wp-seed-4', number: 'PR-2026-0912', date: '2026-10-12', module: 'warehouse', docType: 'issue', docId: 'is4', docNumber: 'ZV-2026-0106', entries: [{ debit: '56806000', credit: '19911000', amount: 1_520_000, costCenterId: 'CC0044', text: 'Расход бланков, М-11 ZV-2026-0106' }], status: 'confirmed', createdBy: 'u14', createdAt: '2026-10-12T14:20:00Z', confirmedAt: '2026-10-12T14:20:30Z' });
  wmsLedger.seed({ id: 'wp-seed-5', number: 'PR-2026-0916', date: '2026-10-16', module: 'warehouse', docType: 'issue', docId: 'is5', docNumber: 'ZV-2026-0109', entries: [{ debit: '56802000', credit: '19915000', amount: 3_280_000, costCenterId: 'CC0025', text: 'Расход ТМЗ, М-11 ZV-2026-0109' }], status: 'confirmed', createdBy: 'u14', createdAt: '2026-10-16T09:30:00Z', confirmedAt: '2026-10-16T09:30:30Z' });
  const all = wmsLedger.snapshot();
  for (const r of reconRows()) {
    let eff = 0;
    for (const p of all) for (const e of p.entries) eff += (e.debit === r.account ? e.amount : 0) - (e.credit === r.account ? e.amount : 0);
    wmsLedger.setOpening(r.account, r.erp - eff);
  }
}
initLedger();

// ---------- Уведомления о минимальном уровне и лимитах ----------

function stockLink(it: WarehouseItem) {
  return `/warehouse/cards/${it.cardId}`;
}

async function checkThresholds(it: WarehouseItem, user: User): Promise<void> {
  const avail = available(it);
  const loc = locById(it.warehouseId);
  if (avail <= it.minQty && it.minQty > 0) {
    notify({
      roles: ['storekeeper', 'procurement'],
      ...(loc ? { userIds: [loc.managerId] } : {}),
      kind: 'system',
      level: 'warning',
      title: L(`Минимальный запас: ${it.sku}`, `Minimal zaxira: ${it.sku}`, `Minimum stock: ${it.sku}`),
      body: L(`${it.name} — доступно ${avail} ${it.unit} при минимуме ${it.minQty} (${loc?.code ?? ''})`, `${it.name} — mavjud ${avail} ${it.unit}, minimum ${it.minQty} (${loc?.code ?? ''})`, `${it.name} — ${avail} ${it.unit} available, minimum ${it.minQty} (${loc?.code ?? ''})`),
      link: stockLink(it),
      dedupeKey: `wh-min:${it.id}:${today()}`,
    });
  }
  const limit = it.limitQty;
  if (limit && avail <= limit && !it.reorderRequestId) {
    // Повторная закупка: черновик заявки в модуле «Закупки» (ядро) и уведомление отделу закупок.
    try {
      const lines = await api.listBudgetLines();
      const bl = lines.find((b) => b.code.includes('ADM') || b.code.includes('АХ')) ?? lines[0];
      const qty = Math.max(limit * 2 - avail, it.minQty);
      if (bl) {
        const pr = await api.createProcurement(
          {
            title: `Повторная закупка: ${it.name}`,
            departmentId: 'd2',
            budgetLineId: bl.id,
            method: 'quotes',
            neededBy: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
            justification: `Автоматически: доступный остаток ${avail} ${it.unit} достиг лимита ${limit} (склад ${loc?.code ?? ''}, ${it.sku})`,
            items: [{ name: it.name, qty, unit: it.unit, unitPrice: it.unitCost }],
            submit: false,
          },
          user,
        );
        it.reorderRequestId = pr.id;
        notify({
          roles: ['procurement'],
          kind: 'system',
          level: 'info',
          title: L(`Черновик заявки на закупку: ${it.sku}`, `Xarid arizasi qoralamasi: ${it.sku}`, `Draft purchase request: ${it.sku}`),
          body: L(`${pr.number}: ${it.name}, ${qty} ${it.unit}`, `${pr.number}: ${it.name}, ${qty} ${it.unit}`, `${pr.number}: ${it.name}, ${qty} ${it.unit}`),
          link: `/procurement/${pr.id}`,
          dedupeKey: `wh-reorder:${it.id}`,
        });
        audit.log({ action: 'create', entity: 'procurement', entityId: pr.id, entityLabel: pr.number, details: `auto reorder ${it.sku}`, user: { id: user.id, fullName: user.fullName, role: user.role } });
      }
    } catch {
      /* закупки недоступны — уведомление о минимуме уже отправлено */
    }
  }
  if (avail > (limit ?? Infinity)) delete it.reorderRequestId;
}

// ---------- Хуки для модуля ОС (приёмка ОС со склада) ----------

export interface WarehouseFaIssue {
  issue: WarehouseIssue;
  card: WarehouseCard;
  qty: number;
  amount: number;
}
const faHooks: ((e: WarehouseFaIssue, user: User) => void)[] = [];
/** Модуль ОС подписывается на выдачу ОС со склада (автоприёмка в учёт ОС). */
export function onWarehouseFaIssued(fn: (e: WarehouseFaIssue, user: User) => void): void {
  faHooks.push(fn);
}
type IssueEvent = { issue: WarehouseIssue; event: 'reserved' | 'approved' | 'issued' | 'received' | 'cancelled' | 'rejected' };
const issueListeners: ((e: IssueEvent) => void)[] = [];
/** Модуль заявок (P2-PROC) может подписаться на события выдачи по своей заявке. */
export function onWarehouseIssueEvent(fn: (e: IssueEvent) => void): () => void {
  issueListeners.push(fn);
  return () => {
    const i = issueListeners.indexOf(fn);
    if (i >= 0) issueListeners.splice(i, 1);
  };
}
const fireIssue = (issue: WarehouseIssue, event: IssueEvent['event']) => issueListeners.forEach((l) => l({ issue: clone(issue), event }));

// ---------- Согласования ----------

function reserve(issue: WarehouseIssue): void {
  for (const l of issue.lines) {
    const it = itemById(l.itemId);
    if (!it) throw new Error('REQUIRED');
    if (l.qty > available(it)) throw new Error('INSUFFICIENT_STOCK');
  }
  for (const l of issue.lines) itemById(l.itemId)!.reserved += l.qty;
}
function release(issue: WarehouseIssue): void {
  for (const l of issue.lines) {
    const it = itemById(l.itemId);
    if (it) it.reserved = Math.max(0, it.reserved - l.qty);
  }
}

function issueSigners(issue: WarehouseIssue): ID[] {
  const loc = locById(issue.warehouseId);
  return [loc?.headId, loc?.managerId].filter((x): x is ID => !!x);
}

approvalEngine.register('warehouse_issue', {
  onHistory: (id, e) => issues.find((i) => i.id === id)?.history.push(e),
  onFinal: (id, approved) => {
    const is = issues.find((i) => i.id === id);
    if (!is) return;
    if (approved) {
      is.status = 'approved';
      notify({ userIds: issueSigners(is), roles: ['storekeeper'], kind: 'task', level: 'info', title: L(`Подписать расход ${is.number}`, `${is.number} chiqimini imzolash`, `Sign issue ${is.number}`), body: is.purpose, link: `/warehouse/issues/${is.id}`, dedupeKey: `wh-sign:${is.id}` });
      fireIssue(is, 'approved');
    } else {
      is.status = 'rejected';
      release(is);
      fireIssue(is, 'rejected');
    }
  },
  onReturned: (id) => {
    const is = issues.find((i) => i.id === id);
    if (!is) return;
    is.status = 'returned';
    release(is);
  },
  onResubmitted: (id) => {
    const is = issues.find((i) => i.id === id);
    if (!is) return;
    reserve(is);
    is.status = 'pending';
  },
});
approvalEngine.seed(warehouseIssueApprovalSeed);

approvalEngine.register('warehouse_writeoff', {
  onHistory: (id, e) => writeoffs.find((w) => w.id === id)?.history.push(e),
  onFinal: (id, approved) => {
    const w = writeoffs.find((x) => x.id === id);
    if (!w) return;
    if (!approved) {
      w.status = 'rejected';
      if (w.kind === 'mbp') w.lines.forEach((l) => {
        const r = mbp.find((m) => m.id === l.refId);
        if (r && r.status === 'pending_writeoff') r.status = 'in_use';
      });
      return;
    }
    postWriteoff(w, { id: w.createdBy, fullName: '', role: 'storekeeper' } as User);
  },
  onReturned: (id) => {
    const w = writeoffs.find((x) => x.id === id);
    if (w) {
      w.status = 'returned';
      w.commissionSignatures = [];
    }
  },
  onResubmitted: (id) => {
    const w = writeoffs.find((x) => x.id === id);
    if (w) w.status = 'pending';
  },
});

// ---------- Поиск ----------

registerSearchProvider((q) => [
  ...items
    .filter((i) => matches(q, i.sku, i.name, cardById(i.cardId)?.barcode ?? ''))
    .map((i) => ({ group: 'warehouse_title', title: `${i.sku} · ${i.name}`, subtitle: `${locById(i.warehouseId)?.code ?? ''} · ${i.qty} ${i.unit}`, to: `/warehouse?q=${encodeURIComponent(i.sku)}` })),
  ...movements
    .filter((m) => matches(q, m.number))
    .map((m) => ({ group: 'warehouse_title', title: `${m.number} · ${itemById(m.itemId)?.name ?? ''}`, subtitle: m.at.slice(0, 10), to: `/warehouse/movements?q=${encodeURIComponent(m.number)}` })),
  ...receipts.filter((r) => matches(q, r.number, r.waybillNo)).map((r) => ({ group: 'warehouse_title', title: `${r.number} · ${r.waybillNo}`, subtitle: r.date, to: `/warehouse/receipts/${r.id}` })),
  ...issues.filter((r) => matches(q, r.number)).map((r) => ({ group: 'warehouse_title', title: `${r.number} · ${r.purpose}`, subtitle: r.createdAt.slice(0, 10), to: `/warehouse/issues/${r.id}` })),
  ...writeoffs.filter((r) => matches(q, r.number)).map((r) => ({ group: 'warehouse_title', title: `${r.number} · ${r.reasonText}`, subtitle: r.date, to: `/warehouse/writeoffs/${r.id}` })),
  ...mbp.filter((r) => matches(q, r.number, r.barcode)).map((r) => ({ group: 'warehouse_title', title: `${r.number} · ${r.name}`, subtitle: `${r.qty} ${r.unit}`, to: `/warehouse/mbp?q=${encodeURIComponent(r.number)}` })),
]);

// ---------- Фильтры ----------

export interface WarehouseItemFilter {
  warehouseId?: ID;
  category?: WarehouseCategory;
  groupId?: ID;
  lowOnly?: boolean;
  search?: string;
  includeEmpty?: boolean;
}

export interface WarehouseMovementFilter {
  itemId?: ID;
  cardId?: ID;
  type?: WarehouseMovementType;
  warehouseId?: ID;
  search?: string;
  from?: string;
  to?: string;
}

export interface WarehouseCardFilter {
  search?: string;
  groupId?: ID;
  status?: WarehouseCardStatus | '';
  includeArchived?: boolean;
}

export interface WarehouseCardInput {
  name: string;
  groupId: ID;
  unit: string;
  parentId?: ID;
  offBalance: boolean;
  trackExpiry: boolean;
  shelfLifeDays?: number;
  defaultPrice: number;
  note?: string;
}

export interface WarehouseReceiptInput {
  warehouseId: ID;
  supplierId?: ID;
  contractId?: ID;
  procurementId?: ID;
  einvoiceId?: ID;
  waybillNo: string;
  waybillDate: string;
  date?: string;
  lines: WarehouseReceiptLine[];
  costCenterId?: string;
}

export interface WarehouseIssueInput {
  source: WarehouseIssueSource;
  allotmentNo?: string;
  warehouseId: ID;
  recipientId: ID;
  departmentId: ID;
  orgUnitKey: string;
  costCenterId: string;
  purpose: string;
  lines: WarehouseIssueLine[];
  submit: boolean;
}

export interface WarehouseWriteoffInput {
  kind: WarehouseWriteoffKind;
  warehouseId?: ID;
  orgUnitKey?: string;
  reason: WarehouseWriteoffReason;
  reasonText: string;
  commission: WarehouseCommission;
  lines: { refId: ID; qty: number }[];
  costCenterId?: string;
}

export interface WarehouseInventoryInput {
  scope: WarehouseInventoryScope;
  warehouseId?: ID;
  orgUnitKey?: string;
  method: 'scan' | 'list';
  commission: WarehouseCommission;
}

const requireText = (s: string | undefined) => {
  if (!s || !s.trim()) throw new Error('REQUIRED');
};
const auditUser = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });

// ---------- Поступление: проведение и сверка ----------

function reconcile(r: WarehouseReceipt): WarehouseReconDiff[] {
  if (!r.einvoiceId) return [];
  const diffs: WarehouseReconDiff[] = [];
  r.lines.forEach((l, i) => {
    if (l.invoiceQty === undefined) {
      diffs.push({ line: i + 1, field: 'extra', expected: '—', actual: cardById(l.cardId)?.name ?? l.cardId });
      return;
    }
    if (l.invoiceQty !== l.qty) diffs.push({ line: i + 1, field: 'qty', expected: l.invoiceQty, actual: l.qty });
    if (l.invoicePrice !== undefined && Math.abs(l.invoicePrice - l.price) > 1) diffs.push({ line: i + 1, field: 'price', expected: l.invoicePrice, actual: l.price });
  });
  return diffs;
}

function postReceipt(r: WarehouseReceipt, user: User): void {
  const loc = locById(r.warehouseId)!;
  const entries = [];
  for (const l of r.lines) {
    const c = cardById(l.cardId)!;
    const g = groupById(c.groupId)!;
    const it = itemFor(c.id, r.warehouseId);
    addBatch(it, l.qty, l.price, { receiptId: r.id, ...(l.expiryDate ? { expiryDate: l.expiryDate } : {}), receivedAt: r.date });
    const amount = l.qty * l.price;
    pushMovement({ type: 'receipt', itemId: it.id, qty: l.qty, warehouseId: r.warehouseId, ...(r.supplierId ? { counterpartyId: r.supplierId } : {}), userId: user.id, amount, costCenterId: r.costCenterId || loc.costCenterId, docType: 'receipt', docId: r.id, docNumber: r.number, comment: `ТН ${r.waybillNo}` });
    entries.push({ debit: g.account, credit: '29802000', amount, costCenterId: r.costCenterId || loc.costCenterId, text: `Поступление ${c.cardNo}, М-4 ${r.number}` });
    if (c.offBalance) entries.push({ debit: g.offBalanceAccount ?? '96339000', credit: '96399000', amount, costCenterId: r.costCenterId || loc.costCenterId, text: `На контроле (внебаланс) ${c.cardNo}` });
    if (it.reorderRequestId && available(it) > (it.limitQty ?? 0)) delete it.reorderRequestId;
  }
  r.status = 'posted';
  r.postedAt = now();
  const p = wmsLedger.post({ module: 'warehouse', docType: 'receipt', docId: r.id, docNumber: r.number, entries }, user);
  if (p) r.postingId = p.id;
  r.history.push(historyEvent(user.id, 'approved', `Проведено, приходный ордер М-4${p ? `, проводка ${p.number}` : ''}`));
  audit.log({ action: 'approve', entity: 'warehouse_receipt', entityId: r.id, entityLabel: r.number, details: `posted ${r.lines.length} lines`, user: auditUser(user) });
}

/** Автооприходование: по принятым/подписанным входящим ЭСФ, строки которых совпадают с карточками, создаются черновики поступлений. */
async function syncInvoiceReceipts(): Promise<void> {
  let list: Awaited<ReturnType<typeof einvoicesApi.list>> = [];
  try {
    list = await einvoicesApi.list({ direction: 'incoming' });
  } catch {
    return;
  }
  let changed = false;
  for (const inv of list) {
    if (inv.status !== 'accepted' && inv.status !== 'signed') continue;
    if (receipts.some((r) => r.einvoiceId === inv.id)) continue;
    const lines: WarehouseReceiptLine[] = [];
    for (const l of inv.lines) {
      const key = l.name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
      const c = cards.find((x) => x.status !== 'archived' && x.name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '').startsWith(key.slice(0, 12)));
      if (c) lines.push({ cardId: c.id, qty: l.qty, price: l.unitPrice, invoiceName: l.name, invoiceQty: l.qty, invoicePrice: l.unitPrice });
    }
    if (!lines.length) continue;
    const kinds = new Set(lines.map((l) => groupById(cardById(l.cardId)!.groupId)!.kind));
    const r: WarehouseReceipt = {
      id: nextId('rc'), number: nextNumber('PO'), date: today(), warehouseId: 'wh1', supplierId: inv.counterpartyId, ...(inv.contractId ? { contractId: inv.contractId } : {}),
      einvoiceId: inv.id, einvoiceNumber: inv.number, waybillNo: inv.number, waybillDate: inv.date, source: 'einvoice', lines, costCenterId: 'CC0007', status: 'draft',
      createdBy: 'system', createdAt: now(),
      history: [historyEvent('system', 'created', `Автооприходование по ЭСФ ${inv.number}${kinds.has('mbp') || kinds.has('fa') ? ' (МБП/ОС по договору)' : ''}`)],
    };
    r.diffs = reconcile(r);
    receipts.push(r);
    changed = true;
    notify({ roles: ['storekeeper', 'accountant'], kind: 'system', level: 'info', title: L(`Поступление по ЭСФ ${inv.number}`, `EHF ${inv.number} bo‘yicha kirim`, `Receipt from e-invoice ${inv.number}`), body: L(`Черновик ${r.number} — проверьте и проведите`, `${r.number} qoralamasi — tekshiring va o‘tkazing`, `Draft ${r.number} — review and post`), link: `/warehouse/receipts/${r.id}`, dedupeKey: `wh-inv:${inv.id}` });
  }
  if (changed) emit();
}

// ---------- Выдача: проведение ----------

function postIssue(is: WarehouseIssue, user: User): void {
  const loc = locById(is.warehouseId)!;
  for (const l of is.lines) {
    const it = itemById(l.itemId)!;
    if (l.qty > it.qty) throw new Error('INSUFFICIENT_STOCK');
  }
  release(is);
  const entries = [];
  let total = 0;
  for (const l of is.lines) {
    const it = itemById(l.itemId)!;
    const c = cardById(it.cardId)!;
    const g = groupById(c.groupId)!;
    const { allocs, amount } = consumeFifo(it, l.qty);
    l.amount = amount;
    total += amount;
    pushMovement({ type: 'issue', itemId: it.id, qty: l.qty, warehouseId: is.warehouseId, departmentId: is.departmentId, userId: user.id, amount, costCenterId: is.costCenterId, docType: 'issue', docId: is.id, docNumber: is.number, allocs, comment: is.allotmentNo ? `Разнарядка ${is.allotmentNo}` : is.externalRef ? `Заявка ${is.externalRef.number}` : `Заявка ${is.number}` });
    if (g.kind === 'tmz') {
      entries.push({ debit: g.expenseAccount, credit: g.account, amount, costCenterId: is.costCenterId, text: `Расход ${c.cardNo}, М-11 ${is.number}` });
      if (c.offBalance) entries.push({ debit: '96399000', credit: g.offBalanceAccount ?? '96339000', amount, costCenterId: is.costCenterId, text: `Снятие с контроля ${c.cardNo}` });
    } else if (g.kind === 'mbp') {
      entries.push({ debit: g.expenseAccount, credit: g.account, amount, costCenterId: is.costCenterId, text: `Выдача МБП в эксплуатацию ${c.cardNo}` });
      entries.push({ debit: g.offBalanceAccount ?? '96335000', credit: '96399000', amount, costCenterId: is.costCenterId, text: `МБП в эксплуатации (внебаланс) ${c.cardNo}` });
      registerMbp(is, c, l.qty, amount, user);
    } else {
      faHooks.forEach((h) => h({ issue: is, card: c, qty: l.qty, amount }, user));
    }
    void checkThresholds(it, user);
  }
  is.amount = total;
  is.status = 'issued';
  is.issuedAt = now();
  is.invoiceNo = is.invoiceNo ?? nextNumber('VN');
  const p = wmsLedger.post({ module: 'warehouse', docType: 'issue', docId: is.id, docNumber: is.number, entries }, user);
  if (p) is.postingId = p.id;
  is.history.push(historyEvent(user.id, 'status_changed', `Выдано со склада (М-11)${p ? `, проводка ${p.number}` : ''}; ЭСФ получателя ${is.invoiceNo}`));
  notify({ userIds: [is.recipientId], kind: 'task', level: 'info', title: L(`Получите ценности: ${is.number}`, `Qimmatliklarni oling: ${is.number}`, `Collect items: ${is.number}`), body: L('Подтвердите получение кнопкой «Принял» (E-IMZO)', '«Qabul qildim» tugmasi bilan tasdiqlang (E-IMZO)', 'Confirm receipt with “Received” (E-IMZO)'), link: `/warehouse/issues/${is.id}`, dedupeKey: `wh-recv:${is.id}` });
  audit.log({ action: 'approve', entity: 'warehouse_issue', entityId: is.id, entityLabel: is.number, details: `issued ${total}`, user: auditUser(user) });
  fireIssue(is, 'issued');
  void loc;
}

function registerMbp(is: WarehouseIssue, c: WarehouseCard, qty: number, amount: number, user: User): MbpRecord {
  // Объединение однотипных МБП по средней цене: та же карточка, МОЛ и подразделение.
  const same = mbp.find((m) => m.status === 'in_use' && m.cardId === c.id && m.responsibleId === is.recipientId && m.orgUnitKey === is.orgUnitKey);
  if (same) {
    const total = same.qty * same.unitCost + amount;
    same.qty += qty;
    same.unitCost = Math.round(total / same.qty);
    same.history.push(historyEvent(user.id, 'status_changed', `+${qty} ${c.unit} по ${is.number}; средняя цена пересчитана`));
    return same;
  }
  const g = groupById(c.groupId)!;
  const r: MbpRecord = {
    id: nextId('mb'), number: nextNumber('MBP'), cardId: c.id, name: c.name, unit: c.unit, qty, unitCost: Math.round(amount / qty), issuedAt: today(), issueId: is.id,
    orgUnitKey: is.orgUnitKey, departmentId: is.departmentId, responsibleId: is.recipientId, costCenterId: is.costCenterId, offBalanceAccount: g.offBalanceAccount ?? '96335000', status: 'in_use',
    barcode: ean13(`21${String(mbp.length + 1).padStart(10, '0')}`), history: [historyEvent(user.id, 'created', `Выдача МБП в эксплуатацию по ${is.number}`)],
  };
  mbp.push(r);
  return r;
}

// ---------- Списание: проведение ----------

function postWriteoff(w: WarehouseWriteoff, user: User): void {
  const entries = [];
  if (w.kind === 'tmz') {
    let total = 0;
    for (const l of w.lines) {
      const it = itemById(l.refId)!;
      const c = cardById(it.cardId)!;
      const g = groupById(c.groupId)!;
      const { allocs, amount } = consumeFifo(it, Math.min(l.qty, it.qty));
      l.amount = amount;
      total += amount;
      pushMovement({ type: 'writeoff', itemId: it.id, qty: l.qty, warehouseId: it.warehouseId, userId: user.id, amount, costCenterId: w.costCenterId, docType: 'writeoff', docId: w.id, docNumber: w.number, allocs, comment: w.reasonText });
      entries.push({ debit: w.reason === 'shortage' || w.reason === 'lost' ? '19997000' : g.expenseAccount, credit: g.account, amount, costCenterId: w.costCenterId, text: `Списание ${c.cardNo} по акту ${w.number}` });
      void checkThresholds(it, user);
    }
    w.amount = total;
  } else {
    for (const l of w.lines) {
      const r = mbp.find((m) => m.id === l.refId)!;
      const qty = Math.min(l.qty, r.qty);
      const amount = qty * r.unitCost;
      l.amount = amount;
      if (qty >= r.qty) {
        r.status = w.reason === 'lost' || w.reason === 'shortage' ? 'lost' : 'written_off';
      } else {
        r.qty -= qty;
        r.status = 'in_use';
        const part: MbpRecord = { ...clone(r), id: nextId('mb'), number: nextNumber('MBP'), qty, status: w.reason === 'lost' || w.reason === 'shortage' ? 'lost' : 'written_off', history: [historyEvent(user.id, 'status_changed', `Выделено из ${r.number} при списании`)] };
        mbp.push(part);
      }
      r.history.push(historyEvent(user.id, 'status_changed', `Списание по акту ${w.number}: ${qty} ${r.unit}`));
      entries.push({ debit: '96399000', credit: r.offBalanceAccount, amount, costCenterId: r.costCenterId, text: `Списание МБП ${r.number} (внебаланс) по акту ${w.number}` });
      if (w.reason === 'lost' || w.reason === 'shortage') entries.push({ debit: '19997000', credit: '45994000', amount, costCenterId: r.costCenterId, text: `Недостача МБП к взысканию ${r.number}` });
    }
    w.amount = w.lines.reduce((s, l) => s + l.amount, 0);
  }
  w.status = 'posted';
  // МБП: автоматические проводки подписываются E-IMZO бухгалтером до передачи в iABS (PR-WMS-069).
  const p = wmsLedger.post({ module: w.kind === 'mbp' ? 'mbp' : 'warehouse', docType: 'writeoff', docId: w.id, docNumber: w.number, entries, requireSign: w.kind === 'mbp' }, user);
  if (p) w.postingId = p.id;
  w.history.push(historyEvent(user.id, 'status_changed', `Проведено${p ? `, проводка ${p.number}${p.requireSign ? ' (ожидает подписи E-IMZO)' : ''}` : ''}`));
  if (p?.requireSign) notify({ roles: ['accountant'], kind: 'task', level: 'info', title: L(`Подписать проводки: ${w.number}`, `Provodkalarni imzolash: ${w.number}`, `Sign postings: ${w.number}`), link: `/warehouse/writeoffs/${w.id}`, dedupeKey: `wh-sign-post:${p.id}` });
}

// ---------- Отчётные выборки ----------

async function costCenterIndex(): Promise<Map<string, CostCenter>> {
  const page = await orgApi.listCostCenters({ pageSize: 5000 });
  return new Map(page.rows.map((c) => [c.key, c]));
}

// =============================================================================================
export const warehouseApi = {
  listLocations: () => delay(locations),
  listGroups: () => delay(groups),
  accounts: () => WMS_ACCOUNTS,

  // ---------- Карточки ----------
  listCards(filter: WarehouseCardFilter = {}) {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      cards
        .filter((c) => filter.includeArchived || filter.status === 'archived' || c.status !== 'archived')
        .filter((c) => !filter.status || c.status === filter.status)
        .filter((c) => !filter.groupId || c.groupId === filter.groupId)
        .filter((c) => !q || c.name.toLowerCase().includes(q) || c.cardNo.toLowerCase().includes(q) || c.barcode.includes(q))
        .map((c) => ({ ...c, qty: items.filter((i) => i.cardId === c.id).reduce((s, i) => s + i.qty, 0), children: cards.filter((x) => x.parentId === c.id).length }))
        .sort((a, b) => a.cardNo.localeCompare(b.cardNo)),
    );
  },
  getCard(id: ID) {
    const c = cardById(id);
    if (!c) return delay(undefined);
    const its = items.filter((i) => i.cardId === id);
    return delay({
      card: c,
      group: groupById(c.groupId)!,
      parent: c.parentId ? cardById(c.parentId) : undefined,
      children: cards.filter((x) => x.parentId === id),
      items: its,
      batches: batches.filter((b) => its.some((i) => i.id === b.itemId)).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
      movements: movements.filter((m) => its.some((i) => i.id === m.itemId)).sort((a, b) => b.at.localeCompare(a.at)),
      versions: cardVersions.filter((v) => v.cardId === id).sort((a, b) => b.version - a.version),
    });
  },
  /** Следующий номер карточки в группе: <код группы>-<NNNN>. */
  nextCardNo(groupId: ID): string {
    const g = groupById(groupId);
    if (!g) return '';
    const max = cards.filter((c) => c.cardNo.startsWith(`${g.code}-`)).reduce((m, c) => Math.max(m, Number(c.cardNo.split('-')[1]) || 0), 0);
    return `${g.code}-${String(max + 1).padStart(4, '0')}`;
  },
  async saveCard(input: WarehouseCardInput & { id?: ID }, user: User, reason?: string) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    requireText(input.name);
    requireText(input.unit);
    const g = groupById(input.groupId);
    if (!g) throw new Error('REQUIRED');
    if (!(input.defaultPrice >= 0)) throw new Error('QTY');
    if (input.parentId && (input.parentId === input.id || !cardById(input.parentId))) throw new Error('REQUIRED');
    if (input.trackExpiry && !(Number(input.shelfLifeDays) > 0)) throw new Error('REQUIRED');
    const fields = { name: input.name.trim(), groupId: input.groupId, unit: input.unit.trim(), ...(input.parentId ? { parentId: input.parentId } : {}), offBalance: input.offBalance, trackExpiry: input.trackExpiry, ...(input.trackExpiry ? { shelfLifeDays: Number(input.shelfLifeDays) } : {}), defaultPrice: Math.round(input.defaultPrice), ...(input.note?.trim() ? { note: input.note.trim() } : {}) };
    if (input.id) {
      const c = cardById(input.id);
      if (!c) throw new Error('NOT_FOUND');
      if (c.status === 'archived') throw new Error('NOT_ALLOWED');
      if (c.groupId !== input.groupId && items.some((i) => i.cardId === c.id && i.qty > 0)) throw new Error('GROUP_LOCKED');
      requireText(reason);
      const { id: _id, ...snap } = c;
      cardVersions.push({ cardId: c.id, version: c.version, at: now(), by: user.id, reason: reason!.trim(), snapshot: clone(snap) });
      const before = clone(c);
      delete c.parentId;
      delete c.shelfLifeDays;
      delete c.note;
      Object.assign(c, fields, { version: c.version + 1, updatedAt: now() });
      items.filter((i) => i.cardId === c.id).forEach(refresh);
      audit.log({ action: 'update', entity: 'warehouse_card', entityId: c.id, entityLabel: c.cardNo, changes: diffFields(before, c, ['name', 'groupId', 'unit', 'parentId', 'offBalance', 'trackExpiry', 'shelfLifeDays', 'defaultPrice', 'note']), details: reason, user: auditUser(user) });
      emit();
      return delay(c);
    }
    const c: WarehouseCard = { id: nextId('wc'), cardNo: warehouseApi.nextCardNo(input.groupId), barcode: ean13(`2000000${String(cards.length + 1).padStart(5, '0')}`), status: 'active', version: 1, createdAt: now(), createdBy: user.id, updatedAt: now(), ...fields };
    cards.push(c);
    audit.log({ action: 'create', entity: 'warehouse_card', entityId: c.id, entityLabel: c.cardNo, details: c.name, user: auditUser(user) });
    emit();
    return delay(c);
  },
  /** Статус карточки: на контроле / заблокирована / в архиве (архив — только без остатков и резервов). */
  async setCardStatus(id: ID, status: WarehouseCardStatus, user: User, reason: string) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    requireText(reason);
    const c = cardById(id);
    if (!c || c.status === status) throw new Error('NOT_ALLOWED');
    if (status === 'archived' && items.some((i) => i.cardId === id && (i.qty > 0 || i.reserved > 0))) throw new Error('HAS_STOCK');
    const { id: _id, ...snap } = c;
    cardVersions.push({ cardId: c.id, version: c.version, at: now(), by: user.id, reason: reason.trim(), snapshot: clone(snap) });
    const before = c.status;
    c.status = status;
    c.version += 1;
    c.updatedAt = now();
    if (status === 'archived') c.archivedAt = now();
    else delete c.archivedAt;
    audit.log({ action: 'update', entity: 'warehouse_card', entityId: c.id, entityLabel: c.cardNo, changes: [{ field: 'status', from: before, to: status }], details: reason, user: auditUser(user) });
    emit();
    await delay(null);
  },

  // ---------- Остатки ----------
  listItems(filter: WarehouseItemFilter = {}) {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      items
        .filter((i) => filter.includeEmpty || i.qty > 0 || i.reserved > 0 || i.minQty > 0)
        .filter((i) => !filter.warehouseId || i.warehouseId === filter.warehouseId)
        .filter((i) => !filter.category || i.category === filter.category)
        .filter((i) => !filter.groupId || cardById(i.cardId)?.groupId === filter.groupId)
        .filter((i) => !filter.lowOnly || isLow(i))
        .filter((i) => !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || !!cardById(i.cardId)?.barcode.includes(q))
        .sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || a.sku.localeCompare(b.sku)),
    );
  },
  getItem: (id: ID) => delay(itemById(id)),
  /** Минимальный уровень и лимит ходового товара по позиции. */
  async setLimits(itemId: ID, minQty: number, limitQty: number | undefined, user: User) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    const it = itemById(itemId);
    if (!it) throw new Error('NOT_FOUND');
    if (!(minQty >= 0) || !Number.isInteger(minQty) || (limitQty !== undefined && (!(limitQty >= 0) || !Number.isInteger(limitQty)))) throw new Error('QTY');
    const before = { minQty: it.minQty, limitQty: it.limitQty };
    it.minQty = minQty;
    if (limitQty) it.limitQty = limitQty;
    else delete it.limitQty;
    audit.log({ action: 'update', entity: 'warehouse_item', entityId: it.id, entityLabel: it.sku, changes: diffFields(before, { minQty: it.minQty, limitQty: it.limitQty }), user: auditUser(user) });
    await checkThresholds(it, user);
    emit();
    await delay(null);
  },
  listBatches(filter: { warehouseId?: ID; search?: string; expiringOnly?: boolean; staleOnly?: boolean } = {}) {
    const q = filter.search?.trim().toLowerCase();
    const t = today();
    return delay(
      batches
        .filter((b) => b.qtyLeft > 0)
        .map((b) => {
          const it = itemById(b.itemId)!;
          const daysToExpiry = b.expiryDate ? daysBetween(t, b.expiryDate) : undefined;
          const ageDays = daysBetween(b.receivedAt, t);
          return { ...b, sku: it.sku, name: it.name, unit: it.unit, warehouseId: it.warehouseId, ageDays, ...(daysToExpiry !== undefined ? { daysToExpiry } : {}), staleThreshold: warehouseStaleThreshold(it.category), stale: ageDays >= warehouseStaleThreshold(it.category), category: it.category, expiring: daysToExpiry !== undefined && daysToExpiry <= WAREHOUSE_SETTINGS.expiryWarnDays };
        })
        .filter((b) => !filter.warehouseId || b.warehouseId === filter.warehouseId)
        .filter((b) => !q || b.sku.toLowerCase().includes(q) || b.name.toLowerCase().includes(q) || b.batchNo.toLowerCase().includes(q))
        .filter((b) => !filter.expiringOnly || b.expiring)
        .filter((b) => !filter.staleOnly || b.stale)
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
    );
  },

  listMovements(filter: WarehouseMovementFilter = {}) {
    const q = filter.search?.trim().toLowerCase();
    const item = (id: ID) => itemById(id);
    return delay(
      movements
        .filter((m) => !filter.itemId || m.itemId === filter.itemId)
        .filter((m) => !filter.cardId || item(m.itemId)?.cardId === filter.cardId)
        .filter((m) => !filter.type || m.type === filter.type)
        .filter((m) => !filter.warehouseId || m.warehouseId === filter.warehouseId || m.toWarehouseId === filter.warehouseId)
        .filter((m) => !filter.from || m.at.slice(0, 10) >= filter.from)
        .filter((m) => !filter.to || m.at.slice(0, 10) <= filter.to)
        .filter((m) => !q || m.number.toLowerCase().includes(q) || (m.comment ?? '').toLowerCase().includes(q) || (m.docNumber ?? '').toLowerCase().includes(q) || !!item(m.itemId)?.name.toLowerCase().includes(q) || !!item(m.itemId)?.sku.toLowerCase().includes(q))
        .sort((a, b) => b.at.localeCompare(a.at)),
    );
  },

  async getStats(): Promise<WarehouseStats> {
    void syncInvoiceReceipts(); // автооприходование по ЭСФ — в фоне (emit() обновит экран)
    const month = now().slice(0, 7);
    const t = today();
    const live = batches.filter((b) => b.qtyLeft > 0);
    return delay({
      items: items.filter((i) => i.qty > 0 || i.reserved > 0 || i.minQty > 0).length,
      stockValue: items.reduce((s, i) => s + itemValue(i), 0),
      lowStock: items.filter(isLow).length,
      movementsMonth: movements.filter((m) => m.at.startsWith(month)).length,
      reservedValue: items.reduce((s, i) => s + i.reserved * i.unitCost, 0),
      expiring: live.filter((b) => b.expiryDate && daysBetween(t, b.expiryDate) <= WAREHOUSE_SETTINGS.expiryWarnDays).length,
      stale: live.filter((b) => staleOf(b, t)).length,
      pendingIssues: issues.filter((i) => i.status === 'pending' || i.status === 'approved').length,
      unfinished: unfinishedList().length,
      postingsError: wmsLedger.health('warehouse').error + wmsLedger.health('mbp').error,
    });
  },

  /** Динамика движений по месяцам, оборачиваемость и структура по группам — для дашборда. */
  async getDashboard() {
    const months: string[] = [];
    const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
    for (let i = 5; i >= 0; i--) {
      const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
      months.push(x.toISOString().slice(0, 7));
    }
    const sumBy = (type: WarehouseMovementType, m: string) => movements.filter((x) => x.type === type && x.at.startsWith(m) && !x.reversed).reduce((s, x) => s + x.amount, 0);
    const stockValue = items.reduce((s, i) => s + itemValue(i), 0);
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const out90 = movements.filter((x) => (x.type === 'issue' || x.type === 'writeoff') && x.at.slice(0, 10) >= since).reduce((s, x) => s + x.amount, 0);
    const byGroup = groups.map((g) => ({ group: g, value: items.filter((i) => cardById(i.cardId)?.groupId === g.id).reduce((s, i) => s + itemValue(i), 0) }));
    const byWarehouse = locations.map((l) => ({ location: l, value: items.filter((i) => i.warehouseId === l.id).reduce((s, i) => s + itemValue(i), 0) }));
    return delay({
      months,
      receipts: months.map((m) => sumBy('receipt', m)),
      issues: months.map((m) => sumBy('issue', m)),
      writeoffs: months.map((m) => sumBy('writeoff', m)),
      stockValue,
      /** Оборачиваемость (раз в год) по расходу за 90 дней. */
      turnover: stockValue ? Math.round(((out90 * 4) / stockValue) * 10) / 10 : 0,
      byGroup,
      byWarehouse,
      unfinished: unfinishedList(),
      postings: wmsLedger.health('warehouse'),
    });
  },

  /** Быстрая операция: приход (с ценой и партией) или перемещение между складами. */
  async createMovement(input: NewWarehouseMovementInput, user: User) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    const item = itemById(input.itemId);
    if (!item) throw new Error('REQUIRED');
    if (!(input.qty > 0) || !Number.isInteger(input.qty)) throw new Error('QTY');
    const card = cardById(item.cardId)!;
    if (card.status === 'archived' || card.status === 'blocked') throw new Error('CARD_BLOCKED');
    const loc = locById(item.warehouseId)!;
    if (input.type === 'receipt') {
      const price = input.unitCost ?? item.unitCost;
      if (!(price > 0)) throw new Error('PRICE');
      if (card.trackExpiry && !input.expiryDate) throw new Error('EXPIRY');
      const r: WarehouseReceipt = {
        id: nextId('rc'), number: nextNumber('PO'), date: today(), warehouseId: item.warehouseId, ...(input.counterpartyId ? { supplierId: input.counterpartyId } : {}), waybillNo: input.basis?.trim() || '—', waybillDate: today(),
        source: 'manual', lines: [{ cardId: card.id, qty: input.qty, price, ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}) }], costCenterId: input.costCenterId ?? loc.costCenterId, status: 'draft', createdBy: user.id, createdAt: now(),
        history: [historyEvent(user.id, 'created', input.comment)],
      };
      receipts.push(r);
      postReceipt(r, user);
      emit();
      return delay(movements[movements.length - 1]!);
    }
    if (input.type === 'transfer') {
      if (!input.toWarehouseId || input.toWarehouseId === item.warehouseId || !locById(input.toWarehouseId)) throw new Error('REQUIRED');
      if (input.qty > available(item)) throw new Error('INSUFFICIENT_STOCK');
      const target = itemFor(card.id, input.toWarehouseId);
      const src = clone(batches.filter((b) => b.itemId === item.id && b.qtyLeft > 0).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)));
      const { allocs, amount } = consumeFifo(item, input.qty);
      for (const a of allocs) {
        const b = src.find((x) => x.id === a.batchId)!;
        addBatch(target, a.qty, a.unitCost, { receivedAt: b.receivedAt, ...(b.expiryDate ? { expiryDate: b.expiryDate } : {}) });
      }
      const toLoc = locById(input.toWarehouseId)!;
      const mv = pushMovement({ type: 'transfer', itemId: item.id, qty: input.qty, warehouseId: item.warehouseId, toWarehouseId: input.toWarehouseId, userId: user.id, amount, costCenterId: toLoc.costCenterId, docType: 'transfer', allocs, ...(input.comment ? { comment: input.comment } : {}) });
      const g = groupById(card.groupId)!;
      const p = wmsLedger.post({ module: 'warehouse', docType: 'transfer', docId: mv.id, docNumber: mv.number, entries: [{ debit: g.account, credit: g.account, amount, costCenterId: toLoc.costCenterId, text: `Перемещение ${card.cardNo}: ${loc.code} → ${toLoc.code} (МВЗ ${loc.costCenterId} → ${toLoc.costCenterId})` }] }, user);
      if (p) mv.docNumber = p.number;
      audit.log({ action: 'create', entity: 'warehouse_movement', entityId: mv.id, entityLabel: mv.number, details: `transfer ${input.qty}`, user: auditUser(user) });
      void checkThresholds(item, user);
      emit();
      return delay(mv);
    }
    throw new Error('USE_DOCUMENT');
  },

  // ---------- Поступления ----------
  async listReceipts(filter: { status?: string; search?: string; warehouseId?: ID } = {}) {
    await syncInvoiceReceipts();
    const q = filter.search?.trim().toLowerCase();
    return delay(
      receipts
        .filter((r) => !filter.status || r.status === filter.status)
        .filter((r) => !filter.warehouseId || r.warehouseId === filter.warehouseId)
        .filter((r) => !q || r.number.toLowerCase().includes(q) || r.waybillNo.toLowerCase().includes(q) || (r.einvoiceNumber ?? '').toLowerCase().includes(q))
        .map((r) => ({ ...r, amount: r.lines.reduce((s, l) => s + l.qty * l.price, 0) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },
  getReceipt: (id: ID) => delay(receipts.find((r) => r.id === id)),
  /** Строки ЭСФ для заполнения поступления и сверки. */
  async invoiceLines(einvoiceId: ID): Promise<WarehouseReceiptLine[]> {
    const inv = (await einvoicesApi.list({ direction: 'incoming' })).find((i) => i.id === einvoiceId);
    if (!inv) return [];
    return inv.lines.map((l) => {
      const key = l.name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '').slice(0, 12);
      const c = cards.find((x) => x.status !== 'archived' && x.name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '').startsWith(key));
      return { cardId: c?.id ?? '', qty: l.qty, price: l.unitPrice, invoiceName: l.name, invoiceQty: l.qty, invoicePrice: l.unitPrice };
    });
  },
  async saveReceipt(input: WarehouseReceiptInput & { id?: ID }, user: User, post = false, acceptDiff?: string) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    const loc = locById(input.warehouseId);
    if (!loc) throw new Error('REQUIRED');
    requireText(input.waybillNo);
    requireText(input.waybillDate);
    if (!input.lines.length) throw new Error('REQUIRED');
    for (const l of input.lines) {
      const c = cardById(l.cardId);
      if (!c) throw new Error('REQUIRED');
      if (c.status === 'archived' || c.status === 'blocked') throw new Error('CARD_BLOCKED');
      if (!(l.qty > 0) || !Number.isInteger(l.qty)) throw new Error('QTY');
      if (!(l.price > 0)) throw new Error('PRICE');
      if (c.trackExpiry && !l.expiryDate) throw new Error('EXPIRY');
    }
    let r = input.id ? receipts.find((x) => x.id === input.id) : undefined;
    if (r && r.status !== 'draft') throw new Error('NOT_ALLOWED');
    // Один ЭСФ — одно поступление: повторное оприходование по тому же счёту-фактуре не допускается.
    const used = input.einvoiceId ? receipts.find((x) => x.einvoiceId === input.einvoiceId && x.id !== input.id && (x.status === 'draft' || x.status === 'posted')) : undefined;
    if (used) throw new Error(`INVOICE_USED:${used.number}`);
    let einvoiceNumber: string | undefined;
    if (input.einvoiceId) einvoiceNumber = (await einvoicesApi.list({ direction: 'incoming' })).find((i) => i.id === input.einvoiceId)?.number;
    const fields = {
      warehouseId: input.warehouseId, ...(input.supplierId ? { supplierId: input.supplierId } : {}), ...(input.contractId ? { contractId: input.contractId } : {}), ...(input.procurementId ? { procurementId: input.procurementId } : {}),
      ...(input.einvoiceId ? { einvoiceId: input.einvoiceId, einvoiceNumber: einvoiceNumber ?? '' } : {}), waybillNo: input.waybillNo.trim(), waybillDate: input.waybillDate, date: input.date ?? today(),
      lines: input.lines.map((l) => ({ ...l, price: Math.round(l.price) })), costCenterId: input.costCenterId || loc.costCenterId,
      source: (input.einvoiceId ? 'einvoice' : input.contractId ? 'contract' : 'manual') as WarehouseReceipt['source'],
    };
    if (r) {
      delete r.supplierId;
      delete r.contractId;
      delete r.procurementId;
      if (!input.einvoiceId) {
        delete r.einvoiceId;
        delete r.einvoiceNumber;
      }
      Object.assign(r, fields);
      r.history.push(historyEvent(user.id, 'commented', 'Изменён черновик'));
    } else {
      r = { id: nextId('rc'), number: nextNumber('PO'), ...fields, status: 'draft', createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created')] };
      receipts.push(r);
      audit.log({ action: 'create', entity: 'warehouse_receipt', entityId: r.id, entityLabel: r.number, user: auditUser(user) });
    }
    r.diffs = reconcile(r);
    if (post) {
      if (r.diffs.length && !acceptDiff?.trim()) {
        emit();
        throw new Error('INVOICE_MISMATCH');
      }
      if (r.diffs.length) r.diffAccepted = acceptDiff!.trim();
      postReceipt(r, user);
    }
    emit();
    return delay(r);
  },
  async postReceipt(id: ID, user: User, acceptDiff?: string) {
    const r = receipts.find((x) => x.id === id);
    if (!r) throw new Error('NOT_FOUND');
    return warehouseApi.saveReceipt({ ...r, id }, user, true, acceptDiff);
  },
  /** Корректировка проведённого поступления: сторно (если партии не тронуты) и копия в черновик для исправления. */
  async correctReceipt(id: ID, reason: string, user: User) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    requireText(reason);
    const r = receipts.find((x) => x.id === id);
    if (!r || r.status !== 'posted') throw new Error('NOT_ALLOWED');
    const mine = batches.filter((b) => b.receiptId === r.id);
    if (mine.some((b) => b.qtyLeft !== b.qtyIn)) throw new Error('BATCH_USED');
    for (const b of mine) {
      b.qtyLeft = 0;
      const it = itemById(b.itemId)!;
      refresh(it);
      pushMovement({ type: 'receipt', itemId: it.id, qty: -b.qtyIn, warehouseId: r.warehouseId, userId: user.id, amount: -b.qtyIn * b.unitCost, costCenterId: r.costCenterId, docType: 'receipt', docId: r.id, docNumber: `${r.number}-С`, comment: `Сторно: ${reason}`, reversalOf: r.id });
    }
    movements.filter((m) => m.docId === r.id && m.qty > 0).forEach((m) => (m.reversed = true));
    if (r.postingId) wmsLedger.reverse(r.postingId, user, `${r.number}-С`);
    r.status = 'reversed';
    const copy: WarehouseReceipt = { ...clone(r), id: nextId('rc'), number: nextNumber('PO'), status: 'draft', correctionOf: r.id, createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created', `Корректировка ${r.number}: ${reason}`)] };
    delete copy.postedAt;
    delete copy.postingId;
    delete copy.correctedBy;
    delete copy.diffAccepted;
    receipts.push(copy);
    r.correctedBy = copy.id;
    r.history.push(historyEvent(user.id, 'status_changed', `Сторно (корректировка): ${reason} → ${copy.number}`));
    audit.log({ action: 'update', entity: 'warehouse_receipt', entityId: r.id, entityLabel: r.number, details: `storno: ${reason}`, user: auditUser(user) });
    emit();
    return delay(copy);
  },
  async deleteReceiptDraft(id: ID, user: User) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    const i = receipts.findIndex((x) => x.id === id && x.status === 'draft');
    if (i < 0) throw new Error('NOT_ALLOWED');
    const [r] = receipts.splice(i, 1);
    audit.log({ action: 'delete', entity: 'warehouse_receipt', entityId: r!.id, entityLabel: r!.number, user: auditUser(user) });
    emit();
    await delay(null);
  },

  // ---------- Выдача ----------
  listIssues(filter: { status?: string; search?: string; mine?: ID } = {}) {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      issues
        .filter((i) => !filter.status || i.status === filter.status)
        .filter((i) => !filter.mine || i.requesterId === filter.mine || i.recipientId === filter.mine)
        .filter((i) => !q || i.number.toLowerCase().includes(q) || i.purpose.toLowerCase().includes(q) || (i.externalRef?.number ?? '').toLowerCase().includes(q) || (i.allotmentNo ?? '').toLowerCase().includes(q))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },
  getIssue: (id: ID) => delay(issues.find((i) => i.id === id)),
  /** Оценка суммы заявки по FIFO (для маршрута согласования). */
  estimate(lines: WarehouseIssueLine[]): number {
    return lines.reduce((s, l) => {
      const it = itemById(l.itemId);
      return s + (it ? fifoPreview(it, l.qty) : 0);
    }, 0);
  },
  async createIssue(input: WarehouseIssueInput, user: User) {
    if (!canRequestWarehouse(user)) throw new Error('FORBIDDEN');
    if (input.source === 'allotment' && !canPostWarehouse(user)) throw new Error('FORBIDDEN');
    requireText(input.purpose);
    if (!locById(input.warehouseId) || !input.recipientId || !input.departmentId || !input.orgUnitKey || !input.costCenterId) throw new Error('REQUIRED');
    if (input.source === 'allotment') requireText(input.allotmentNo);
    if (!input.lines.length) throw new Error('REQUIRED');
    for (const l of input.lines) {
      const it = itemById(l.itemId);
      if (!it || it.warehouseId !== input.warehouseId) throw new Error('REQUIRED');
      if (!(l.qty > 0) || !Number.isInteger(l.qty)) throw new Error('QTY');
      if (l.qty > available(it)) throw new Error('INSUFFICIENT_STOCK');
      const c = cardById(it.cardId)!;
      if (c.status === 'blocked' || c.status === 'archived') throw new Error('CARD_BLOCKED');
    }
    const is: WarehouseIssue = {
      id: nextId('is'), number: nextNumber('ZV'), source: input.source, ...(input.allotmentNo ? { allotmentNo: input.allotmentNo.trim() } : {}), warehouseId: input.warehouseId, requesterId: user.id,
      recipientId: input.recipientId, departmentId: input.departmentId, orgUnitKey: input.orgUnitKey, costCenterId: input.costCenterId, purpose: input.purpose.trim(), lines: input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      status: 'draft', signatures: [], amount: warehouseApi.estimate(input.lines), createdAt: now(), history: [historyEvent(user.id, 'created', input.allotmentNo ? `Разнарядка ${input.allotmentNo}` : undefined)],
    };
    issues.push(is);
    audit.log({ action: 'create', entity: 'warehouse_issue', entityId: is.id, entityLabel: is.number, user: auditUser(user) });
    if (input.submit) await warehouseApi.submitIssue(is.id, user);
    emit();
    return delay(is);
  },
  /** Отправить заявку: резерв остатков; заявка — на подпись руководителю ЦБУ (разнарядка утверждена заранее — сразу к расходу). */
  async submitIssue(id: ID, user: User) {
    const is = issues.find((i) => i.id === id);
    if (!is || (is.status !== 'draft' && is.status !== 'returned' && is.status !== 'rejected')) throw new Error('NOT_ALLOWED');
    if (is.requesterId !== user.id && !canPostWarehouse(user)) throw new Error('FORBIDDEN');
    const wasReturned = is.status === 'returned' || is.status === 'rejected';
    reserve(is);
    is.amount = warehouseApi.estimate(is.lines);
    is.submittedAt = now();
    if (is.source === 'allotment') {
      is.status = 'approved';
      is.history.push(historyEvent(user.id, 'submitted', `Разнарядка ${is.allotmentNo ?? ''}: к расходу`));
      notify({ userIds: issueSigners(is), roles: ['storekeeper'], kind: 'task', level: 'info', title: L(`Подписать расход ${is.number}`, `${is.number} chiqimini imzolash`, `Sign issue ${is.number}`), body: is.purpose, link: `/warehouse/issues/${is.id}`, dedupeKey: `wh-sign:${is.id}` });
    } else {
      is.status = 'pending';
      is.history.push(historyEvent(user.id, 'submitted'));
      const ctx = { amount: is.amount, departmentId: is.departmentId, branchId: is.orgUnitKey, subtype: is.source, costCenterId: is.costCenterId };
      if (wasReturned && approvalEngine.instancesFor(is.id).length) approvalEngine.resubmit(is.id, user);
      else approvalEngine.open({ entity: 'warehouse_issue', entityId: is.id, number: is.number, title: `Выдача: ${is.purpose}`, requesterId: is.requesterId, amount: is.amount, context: ctx });
    }
    fireIssue(is, 'reserved');
    audit.log({ action: 'submit', entity: 'warehouse_issue', entityId: is.id, entityLabel: is.number, user: auditUser(user) });
    emit();
    await delay(null);
  },
  async cancelIssue(id: ID, user: User, reason: string) {
    const is = issues.find((i) => i.id === id);
    if (!is || !['draft', 'approved', 'returned', 'rejected'].includes(is.status)) throw new Error('NOT_ALLOWED');
    if (is.requesterId !== user.id && !canPostWarehouse(user)) throw new Error('FORBIDDEN');
    requireText(reason);
    if (is.status === 'approved') release(is);
    is.status = 'cancelled';
    is.history.push(historyEvent(user.id, 'status_changed', `Отменено: ${reason}`));
    fireIssue(is, 'cancelled');
    emit();
    await delay(null);
  },
  /**
   * Подпись расхода E-IMZO (signatureId — запись signatureService по entity 'warehouse_issue').
   * После подписей закреплённого руководителя, операциониста и заведующего складом расход проводится (FIFO, М-11, проводки);
   * подпись получателя («Принял») закрывает выдачу и оформляет ЭСФ получателя.
   */
  async signIssue(id: ID, role: WarehouseSignRole, signatureId: ID, user: User) {
    const is = issues.find((i) => i.id === id);
    if (!is) throw new Error('NOT_FOUND');
    const sig = signatureService.get(signatureId);
    if (!sig || sig.entityId !== is.id || sig.userId !== user.id) throw new Error('SIGNATURE');
    if (!canSignIssueAs(is, role, user)) throw new Error('FORBIDDEN');
    if (role === 'recipient') {
      if (is.status !== 'issued') throw new Error('NOT_ALLOWED');
      is.signatures.push({ role, userId: user.id, signatureId, at: now() });
      is.status = 'received';
      is.receivedAt = now();
      is.history.push(historyEvent(user.id, 'status_changed', `«Принял» — подписано E-IMZO; ЭСФ получателя ${is.invoiceNo ?? ''}`));
      audit.log({ action: 'approve', entity: 'warehouse_issue', entityId: is.id, entityLabel: is.number, details: 'received (E-IMZO)', user: auditUser(user) });
      fireIssue(is, 'received');
      emit();
      return delay(is);
    }
    if (is.status !== 'approved') throw new Error('NOT_ALLOWED');
    if (is.signatures.some((s) => s.role === role)) throw new Error('ALREADY_SIGNED');
    is.signatures.push({ role, userId: user.id, signatureId, at: now() });
    is.history.push(historyEvent(user.id, 'approved', `Подпись расхода E-IMZO (${role})`));
    if ((['head', 'operator', 'storekeeper'] as WarehouseSignRole[]).every((r) => is.signatures.some((s) => s.role === r))) postIssue(is, user);
    emit();
    return delay(is);
  },

  // ---------- API для модуля заявок (P2-PROC): заявки на обеспечение ----------
  /**
   * Резерв по утверждённой заявке на обеспечение: создаёт складской расход (статус «к расходу»), резервирует остатки.
   * Повторный вызов по той же заявке возвращает существующий документ.
   */
  async reserveForRequest(input: WarehouseReserveInput, user: User): Promise<WarehouseIssue> {
    const existing = issues.find((i) => i.externalRef?.id === input.requestId && i.status !== 'cancelled');
    if (existing) return delay(existing);
    const lines: WarehouseIssueLine[] = [];
    let whId = input.warehouseId;
    for (const l of input.lines) {
      let it = l.itemId ? itemById(l.itemId) : undefined;
      if (!it) {
        const card = l.cardId ? cardById(l.cardId) : cards.find((c) => c.status !== 'archived' && !!l.name && c.name.toLowerCase().includes(l.name.toLowerCase().slice(0, 10)));
        if (card) it = items.filter((i) => i.cardId === card.id && (!whId || i.warehouseId === whId)).sort((a, b) => available(b) - available(a))[0];
      }
      if (!it) throw new Error('ITEM_NOT_FOUND');
      whId = whId ?? it.warehouseId;
      if (it.warehouseId !== whId) throw new Error('MIXED_WAREHOUSES');
      lines.push({ itemId: it.id, qty: l.qty });
    }
    if (!whId || !lines.length) throw new Error('REQUIRED');
    const requester = await api.listUsers().then((us) => us.find((u) => u.id === input.requesterId));
    const is: WarehouseIssue = {
      id: nextId('is'), number: nextNumber('ZV'), source: 'supply_request', externalRef: { module: 'requests', id: input.requestId, number: input.requestNumber }, warehouseId: whId,
      requesterId: input.requesterId, recipientId: input.recipientId ?? input.requesterId, departmentId: input.departmentId, orgUnitKey: input.orgUnitKey ?? requester?.orgUnitKey ?? input.departmentId,
      costCenterId: input.costCenterId ?? locById(whId)!.costCenterId, purpose: input.purpose?.trim() || `Заявка на обеспечение ${input.requestNumber}`, lines, status: 'draft', signatures: [], amount: warehouseApi.estimate(lines),
      createdAt: now(), history: [historyEvent(user.id, 'created', `По утверждённой заявке ${input.requestNumber}`)],
    };
    reserve(is);
    is.status = 'approved';
    is.submittedAt = now();
    issues.push(is);
    notify({ userIds: issueSigners(is), roles: ['storekeeper'], kind: 'task', level: 'info', title: L(`Подписать расход ${is.number}`, `${is.number} chiqimini imzolash`, `Sign issue ${is.number}`), body: is.purpose, link: `/warehouse/issues/${is.id}`, dedupeKey: `wh-sign:${is.id}` });
    audit.log({ action: 'create', entity: 'warehouse_issue', entityId: is.id, entityLabel: is.number, details: `reserve for ${input.requestNumber}`, user: auditUser(user) });
    fireIssue(is, 'reserved');
    emit();
    return delay(is);
  },
  /** Выдача по заявке на обеспечение: проводит расход, если собраны подписи руководителя, операциониста и завсклада. */
  async issueForRequest(requestId: ID, user: User): Promise<WarehouseIssue> {
    const is = issues.find((i) => i.externalRef?.id === requestId && i.status !== 'cancelled');
    if (!is) throw new Error('NOT_FOUND');
    if (is.status === 'issued' || is.status === 'received') return delay(is);
    if (is.status !== 'approved') throw new Error('NOT_ALLOWED');
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    const missing = (['head', 'operator', 'storekeeper'] as WarehouseSignRole[]).filter((r) => !is.signatures.some((s) => s.role === r));
    if (missing.length) throw new Error(`SIGNATURES_REQUIRED:${missing.join(',')}`);
    postIssue(is, user);
    emit();
    return delay(is);
  },
  getIssueForRequest: (requestId: ID) => delay(issues.find((i) => i.externalRef?.id === requestId && i.status !== 'cancelled')),
  async cancelRequestReservation(requestId: ID, user: User, reason: string) {
    const is = issues.find((i) => i.externalRef?.id === requestId && i.status === 'approved');
    if (!is) throw new Error('NOT_FOUND');
    return warehouseApi.cancelIssue(is.id, user, reason);
  },
  /** Доступный остаток по карточке (сумма по складам) — для формы заявки. */
  availability(cardId: ID) {
    return delay(items.filter((i) => i.cardId === cardId).map((i) => ({ itemId: i.id, warehouseId: i.warehouseId, qty: i.qty, reserved: i.reserved, available: available(i) })));
  },

  // ---------- Списание (акты) ----------
  listWriteoffs(filter: { kind?: WarehouseWriteoffKind | ''; status?: string; search?: string } = {}) {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      writeoffs
        .filter((w) => !filter.kind || w.kind === filter.kind)
        .filter((w) => !filter.status || w.status === filter.status)
        .filter((w) => !q || w.number.toLowerCase().includes(q) || w.reasonText.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },
  getWriteoff: (id: ID) => delay(writeoffs.find((w) => w.id === id)),
  async createWriteoff(input: WarehouseWriteoffInput, user: User) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    requireText(input.reasonText);
    requireText(input.commission.orderNo);
    if (!input.commission.chairmanId || input.commission.memberIds.length < 2) throw new Error('COMMISSION');
    if (!input.lines.length) throw new Error('REQUIRED');
    let cc = input.costCenterId;
    const lines = input.lines.map((l) => {
      if (!(l.qty > 0) || !Number.isInteger(l.qty)) throw new Error('QTY');
      if (input.kind === 'tmz') {
        const it = itemById(l.refId);
        if (!it || (input.warehouseId && it.warehouseId !== input.warehouseId)) throw new Error('REQUIRED');
        if (l.qty > available(it)) throw new Error('INSUFFICIENT_STOCK');
        cc = cc ?? locById(it.warehouseId)!.costCenterId;
        return { refId: l.refId, qty: l.qty, amount: fifoPreview(it, l.qty) };
      }
      const r = mbp.find((m) => m.id === l.refId);
      if (!r || r.status !== 'in_use') throw new Error('REQUIRED');
      if (l.qty > r.qty) throw new Error('INSUFFICIENT_STOCK');
      cc = cc ?? r.costCenterId;
      return { refId: l.refId, qty: l.qty, amount: l.qty * r.unitCost };
    });
    const w: WarehouseWriteoff = {
      id: nextId('wa'), number: nextNumber('AS'), kind: input.kind, date: today(), ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}), ...(input.orgUnitKey ? { orgUnitKey: input.orgUnitKey } : {}),
      reason: input.reason, reasonText: input.reasonText.trim(), commission: { ...input.commission, orderNo: input.commission.orderNo.trim() }, commissionSignatures: [], lines, amount: lines.reduce((s, l) => s + l.amount, 0),
      costCenterId: cc ?? 'CC0007', status: 'draft', createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created')],
    };
    if (w.kind === 'mbp') w.lines.forEach((l) => (mbp.find((m) => m.id === l.refId)!.status = 'pending_writeoff'));
    writeoffs.push(w);
    audit.log({ action: 'create', entity: 'warehouse_writeoff', entityId: w.id, entityLabel: w.number, details: `${w.kind} ${w.reason}`, user: auditUser(user) });
    emit();
    return delay(w);
  },
  /** Передать акт комиссии на подпись. */
  async sendToCommission(id: ID, user: User) {
    const w = writeoffs.find((x) => x.id === id);
    if (!w || (w.status !== 'draft' && w.status !== 'returned')) throw new Error('NOT_ALLOWED');
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    w.status = 'commission';
    w.commissionSignatures = [];
    w.history.push(historyEvent(user.id, 'submitted', 'Передано комиссии на подпись'));
    notify({ userIds: [w.commission.chairmanId, ...w.commission.memberIds], kind: 'task', level: 'info', title: L(`Подписать акт списания ${w.number}`, `${w.number} hisobdan chiqarish dalolatnomasini imzolash`, `Sign write-off act ${w.number}`), body: w.reasonText, link: `/warehouse/writeoffs/${w.id}`, dedupeKey: `wh-wo:${w.id}:${w.history.length}` });
    emit();
    await delay(null);
  },
  /** Подпись члена комиссии (E-IMZO); после всех подписей акт уходит на согласование. */
  async signWriteoff(id: ID, signatureId: ID, user: User) {
    const w = writeoffs.find((x) => x.id === id);
    if (!w || w.status !== 'commission') throw new Error('NOT_ALLOWED');
    const members = [w.commission.chairmanId, ...w.commission.memberIds];
    if (!members.includes(user.id)) throw new Error('FORBIDDEN');
    if (w.commissionSignatures.some((s) => s.userId === user.id)) throw new Error('ALREADY_SIGNED');
    const sig = signatureService.get(signatureId);
    if (!sig || sig.entityId !== w.id || sig.userId !== user.id) throw new Error('SIGNATURE');
    w.commissionSignatures.push({ userId: user.id, signatureId, at: now() });
    w.history.push(historyEvent(user.id, 'approved', 'Подпись члена комиссии E-IMZO'));
    if (members.every((m) => w.commissionSignatures.some((s) => s.userId === m))) {
      w.status = 'pending';
      const ctx = { amount: w.amount, subtype: w.kind, reason: w.reason, costCenterId: w.costCenterId };
      if (approvalEngine.instancesFor(w.id).length) approvalEngine.resubmit(w.id, { id: w.createdBy } as User);
      else approvalEngine.open({ entity: 'warehouse_writeoff', entityId: w.id, number: w.number, title: `Списание ${w.kind === 'mbp' ? 'МБП' : 'ТМЗ'}: ${w.reasonText}`, requesterId: w.createdBy, amount: w.amount, context: ctx });
    }
    emit();
    await delay(null);
  },
  /** Подписать E-IMZO автоматические проводки (МБП) и передать в iABS. */
  async signPosting(postingId: ID, signatureId: ID, user: User) {
    if (!can(user, 'warehouse', 'edit')) throw new Error('FORBIDDEN');
    const sig = signatureService.get(signatureId);
    if (!sig || sig.entityId !== postingId || sig.userId !== user.id) throw new Error('SIGNATURE');
    await wmsLedger.sign(postingId, signatureId, user);
    audit.log({ action: 'approve', entity: 'wms_posting', entityId: postingId, details: 'signed E-IMZO', user: auditUser(user) });
    emit();
  },

  // ---------- Инвентаризация ----------
  listInventories: (scope?: WarehouseInventoryScope) => delay(inventories.filter((v) => !scope || v.scope === scope).sort((a, b) => b.date.localeCompare(a.date))),
  getInventory: (id: ID) => delay(inventories.find((v) => v.id === id)),
  async createInventory(input: WarehouseInventoryInput, user: User) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    requireText(input.commission.orderNo);
    if (!input.commission.chairmanId || input.commission.memberIds.length < 2) throw new Error('COMMISSION');
    let lines;
    if (input.scope === 'tmz') {
      if (!input.warehouseId) throw new Error('REQUIRED');
      lines = items.filter((i) => i.warehouseId === input.warehouseId && i.qty > 0).map((i) => ({ refId: i.id, expectedQty: i.qty, unitCost: i.unitCost }));
    } else {
      if (!input.orgUnitKey) throw new Error('REQUIRED');
      lines = mbp.filter((m) => m.status === 'in_use' && m.orgUnitKey === input.orgUnitKey).map((m) => ({ refId: m.id, expectedQty: m.qty, unitCost: m.unitCost }));
    }
    if (!lines.length) throw new Error('EMPTY');
    const v: WarehouseInventory = {
      id: nextId('iv'), number: nextNumber('INV'), scope: input.scope, ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}), ...(input.orgUnitKey ? { orgUnitKey: input.orgUnitKey } : {}),
      method: input.method, commission: { ...input.commission, orderNo: input.commission.orderNo.trim() }, date: today(), status: 'counting', lines, createdBy: user.id, postingIds: [], history: [historyEvent(user.id, 'created')],
    };
    inventories.push(v);
    audit.log({ action: 'create', entity: 'warehouse_inventory', entityId: v.id, entityLabel: v.number, user: auditUser(user) });
    emit();
    return delay(v);
  },
  /** Ввод фактического количества (по списку) или сканирование штрихкода/QR (+1 к факту). */
  async countInventory(id: ID, entries: { refId?: ID; code?: string; actualQty?: number; note?: string }[], user: User) {
    const v = inventories.find((x) => x.id === id);
    if (!v || v.status !== 'counting') throw new Error('NOT_ALLOWED');
    if (!canPostWarehouse(user) && ![v.commission.chairmanId, ...v.commission.memberIds].includes(user.id)) throw new Error('FORBIDDEN');
    let unknown = 0;
    for (const e of entries) {
      let line = e.refId ? v.lines.find((l) => l.refId === e.refId) : undefined;
      if (!line && e.code) {
        const code = e.code.trim();
        if (v.scope === 'tmz') {
          const it = items.find((i) => i.warehouseId === v.warehouseId && (cardById(i.cardId)?.barcode === code || i.sku === code));
          line = it ? v.lines.find((l) => l.refId === it.id) : undefined;
          if (!line && it) {
            line = { refId: it.id, expectedQty: 0, unitCost: it.unitCost };
            v.lines.push(line);
          }
        } else {
          const r = mbp.find((m) => m.barcode === code || m.number === code);
          line = r ? v.lines.find((l) => l.refId === r.id) : undefined;
        }
      }
      if (!line) {
        unknown++;
        continue;
      }
      if (e.actualQty !== undefined) {
        if (!(e.actualQty >= 0) || !Number.isInteger(e.actualQty)) throw new Error('QTY');
        line.actualQty = e.actualQty;
      } else line.actualQty = (line.actualQty ?? 0) + 1;
      line.scannedAt = now();
      if (e.note !== undefined) line.note = e.note;
    }
    emit();
    return delay({ unknown });
  },
  /** Сформировать сличительную ведомость (непосчитанные строки — факт 0). */
  async completeInventory(id: ID, user: User) {
    const v = inventories.find((x) => x.id === id);
    if (!v || v.status !== 'counting') throw new Error('NOT_ALLOWED');
    if (!canPostWarehouse(user) && v.commission.chairmanId !== user.id) throw new Error('FORBIDDEN');
    v.lines.forEach((l) => (l.actualQty = l.actualQty ?? 0));
    v.status = 'completed';
    v.history.push(historyEvent(user.id, 'status_changed', 'Сличительная ведомость сформирована'));
    emit();
    await delay(null);
  },
  /** Утвердить итоги: корректировка остатков (недостача → к взысканию, излишек → оприходование), проводки. */
  async approveInventory(id: ID, user: User) {
    const v = inventories.find((x) => x.id === id);
    if (!v || v.status !== 'completed') throw new Error('NOT_ALLOWED');
    if (!(hasRole(user, 'accountant') || isAdmin(user) || v.commission.chairmanId === user.id)) throw new Error('FORBIDDEN');
    const entries = [];
    for (const l of v.lines) {
      const diff = (l.actualQty ?? 0) - l.expectedQty;
      if (!diff) continue;
      if (v.scope === 'tmz') {
        const it = itemById(l.refId)!;
        const c = cardById(it.cardId)!;
        const g = groupById(c.groupId)!;
        const cc = locById(it.warehouseId)!.costCenterId;
        if (diff < 0) {
          const { allocs, amount } = consumeFifo(it, Math.min(-diff, it.qty));
          pushMovement({ type: 'writeoff', itemId: it.id, qty: -diff, warehouseId: it.warehouseId, userId: user.id, amount, costCenterId: cc, docType: 'inventory', docId: v.id, docNumber: v.number, allocs, comment: 'Недостача по инвентаризации' });
          entries.push({ debit: '19997000', credit: g.account, amount, costCenterId: cc, text: `Недостача ${c.cardNo} (${v.number})` });
          void checkThresholds(it, user);
        } else {
          addBatch(it, diff, l.unitCost, {});
          const amount = diff * l.unitCost;
          pushMovement({ type: 'receipt', itemId: it.id, qty: diff, warehouseId: it.warehouseId, userId: user.id, amount, costCenterId: cc, docType: 'inventory', docId: v.id, docNumber: v.number, comment: 'Излишек по инвентаризации' });
          entries.push({ debit: g.account, credit: '45994000', amount, costCenterId: cc, text: `Излишек ${c.cardNo} (${v.number})` });
        }
      } else {
        const r = mbp.find((m) => m.id === l.refId)!;
        const amount = Math.abs(diff) * r.unitCost;
        if (diff < 0) {
          r.qty = Math.max(0, r.qty + diff);
          if (!r.qty) r.status = 'lost';
          entries.push({ debit: '96399000', credit: r.offBalanceAccount, amount, costCenterId: r.costCenterId, text: `Недостача МБП ${r.number} (${v.number})` });
          entries.push({ debit: '19997000', credit: '45994000', amount, costCenterId: r.costCenterId, text: `К взысканию: МБП ${r.number}` });
        } else {
          r.qty += diff;
          entries.push({ debit: r.offBalanceAccount, credit: '96399000', amount, costCenterId: r.costCenterId, text: `Излишек МБП ${r.number} (${v.number})` });
        }
        r.history.push(historyEvent(user.id, 'status_changed', `Корректировка по инвентаризации ${v.number}: ${diff > 0 ? '+' : ''}${diff}`));
      }
    }
    const p = wmsLedger.post({ module: v.scope === 'mbp' ? 'mbp' : 'warehouse', docType: 'inventory', docId: v.id, docNumber: v.number, entries, requireSign: v.scope === 'mbp' }, user);
    if (p) v.postingIds.push(p.id);
    v.status = 'approved';
    v.approvedBy = user.id;
    v.approvedAt = now();
    v.history.push(historyEvent(user.id, 'approved', `Итоги утверждены, остатки скорректированы${p ? `; проводка ${p.number}` : ''}`));
    audit.log({ action: 'approve', entity: 'warehouse_inventory', entityId: v.id, entityLabel: v.number, user: auditUser(user) });
    emit();
    await delay(null);
  },

  // ---------- МБП в эксплуатации ----------
  listMbp(filter: { orgUnitKey?: string; responsibleId?: ID; status?: string; search?: string } = {}) {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      mbp
        .filter((m) => !filter.orgUnitKey || m.orgUnitKey === filter.orgUnitKey || m.orgUnitKey.startsWith(`${filter.orgUnitKey}-`))
        .filter((m) => !filter.responsibleId || m.responsibleId === filter.responsibleId)
        .filter((m) => (filter.status === 'all' ? true : filter.status ? m.status === filter.status : m.status === 'in_use' || m.status === 'pending_writeoff'))
        .filter((m) => !q || m.number.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.barcode.includes(q))
        .sort((a, b) => a.number.localeCompare(b.number)),
    );
  },
  getMbp: (id: ID) => delay(mbp.find((m) => m.id === id)),
  /** Объединение однотипных МБП (та же карточка, МОЛ и подразделение) по средневзвешенной цене. */
  async mergeMbp(ids: ID[], user: User) {
    if (!canPostWarehouse(user)) throw new Error('FORBIDDEN');
    const list = ids.map((id) => mbp.find((m) => m.id === id)).filter((m): m is MbpRecord => !!m && m.status === 'in_use');
    if (list.length < 2) throw new Error('MERGE_MIN');
    const [head, ...rest] = list as [MbpRecord, ...MbpRecord[]];
    if (rest.some((m) => m.cardId !== head.cardId || m.responsibleId !== head.responsibleId || m.orgUnitKey !== head.orgUnitKey)) throw new Error('MERGE_MISMATCH');
    const qty = list.reduce((s, m) => s + m.qty, 0);
    const value = list.reduce((s, m) => s + m.qty * m.unitCost, 0);
    head.qty = qty;
    head.unitCost = Math.round(value / qty);
    head.history.push(historyEvent(user.id, 'status_changed', `Объединено с ${rest.map((m) => m.number).join(', ')} по средней цене`));
    rest.forEach((m) => {
      m.status = 'written_off';
      m.qty = 0;
      m.history.push(historyEvent(user.id, 'status_changed', `Объединено в ${head.number}`));
    });
    audit.log({ action: 'update', entity: 'mbp', entityId: head.id, entityLabel: head.number, details: `merge ${rest.length}`, user: auditUser(user) });
    emit();
    return delay(head);
  },
  /** Сводка МБП: по ЦБУ/подразделениям, регионам и банку в целом (+ проводки для дашборда). */
  async mbpSummary() {
    const units = await orgApi.listOrgUnits();
    const unit = (k: string) => units.find((u) => u.key === k);
    const regionOf = (k: string) => {
      let u = unit(k);
      for (let i = 0; u && i < 6; i++) {
        if (u.type === 'region' || u.type === 'head_office') return u;
        if (u.type === 'department' && u.parentKey === 'HO') return units.find((x) => x.key === 'HO');
        u = u.parentKey ? unit(u.parentKey) : undefined;
      }
      return undefined;
    };
    const live = mbp.filter((m) => m.status === 'in_use' || m.status === 'pending_writeoff');
    const agg = <K extends string>(key: (m: MbpRecord) => K) => {
      const map = new Map<K, { key: K; qty: number; amount: number; records: number }>();
      for (const m of live) {
        const k = key(m);
        const r = map.get(k) ?? { key: k, qty: 0, amount: 0, records: 0 };
        r.qty += m.qty;
        r.amount += m.qty * m.unitCost;
        r.records++;
        map.set(k, r);
      }
      return [...map.values()].sort((a, b) => b.amount - a.amount);
    };
    return delay({
      total: { qty: live.reduce((s, m) => s + m.qty, 0), amount: live.reduce((s, m) => s + m.qty * m.unitCost, 0), records: live.length, pendingWriteoff: mbp.filter((m) => m.status === 'pending_writeoff').length, writtenOffYear: mbp.filter((m) => m.status === 'written_off' || m.status === 'lost').length },
      byUnit: agg((m) => m.orgUnitKey).map((r) => ({ ...r, name: unit(r.key)?.name })),
      byRegion: agg((m) => regionOf(m.orgUnitKey)?.key ?? 'HO').map((r) => ({ ...r, name: unit(r.key)?.name })),
      byResponsible: agg((m) => m.responsibleId),
      postings: wmsLedger.health('mbp'),
    });
  },

  // ---------- Проводки ----------
  listPostings: (filter: Parameters<typeof wmsLedger.list>[0] = {}) => wmsLedger.list(filter),
  getPosting: (id: ID) => delay(wmsLedger.get(id)),
  async retryPosting(id: ID, user: User) {
    if (!canPostWarehouse(user) && !can(user, 'assets', 'edit')) throw new Error('FORBIDDEN');
    await wmsLedger.retry(id, user);
    audit.log({ action: 'update', entity: 'wms_posting', entityId: id, details: 'retry', user: auditUser(user) });
  },

  // ---------- Мониторинг ----------
  listUnfinished: () => delay(unfinishedList()),
  listMonitoringRuns: () => delay([...monitoringRuns].reverse()),
  /** Сверка складских остатков и МБП с балансом iABS + проверка сроков, залежалости и незавершённых операций. */
  async runMonitoring(user: User, auto = false): Promise<WmsMonitoringRun> {
    if (!auto && !canPostWarehouse(user)) throw new Error('FORBIDDEN');
    const rows = reconRows();
    const exchangeId = await wmsLedger.requestBalances(rows.map((r) => r.account), user.id);
    const t = today();
    const live = batches.filter((b) => b.qtyLeft > 0);
    const expiring = live.filter((b) => b.expiryDate && daysBetween(t, b.expiryDate) <= WAREHOUSE_SETTINGS.expiryWarnDays);
    const stale = live.filter((b) => staleOf(b, t));
    const unf = unfinishedList();
    const run: WmsMonitoringRun = { id: nextId('mr'), at: now(), by: user.id, auto, rows, discrepancies: rows.filter((r) => r.diff !== 0).length, unfinished: unf.length, lowStock: items.filter(isLow).length, expiring: expiring.length, stale: stale.length, ...(exchangeId ? { exchangeId } : {}) };
    monitoringRuns.push(run);
    if (run.discrepancies) notify({ roles: ['accountant', 'storekeeper'], kind: 'system', level: 'danger', title: L(`Расхождение склада с iABS: ${run.discrepancies}`, `Ombor va iABS farqi: ${run.discrepancies}`, `Warehouse vs iABS discrepancies: ${run.discrepancies}`), body: rows.filter((r) => r.diff).map((r) => `${r.account}: ${r.diff}`).join('; '), link: '/warehouse/monitoring', dedupeKey: `wh-recon:${t}:${run.discrepancies}` });
    if (unf.length) notify({ roles: ['storekeeper'], kind: 'system', level: 'warning', title: L(`Незавершённые складские операции: ${unf.length}`, `Tugallanmagan ombor operatsiyalari: ${unf.length}`, `Unfinished warehouse operations: ${unf.length}`), link: '/warehouse/monitoring', dedupeKey: `wh-unf:${t}` });
    for (const b of expiring) {
      const it = itemById(b.itemId)!;
      notify({ roles: ['storekeeper'], kind: 'system', level: 'warning', title: L(`Срок годности: ${it.sku}, партия ${b.batchNo}`, `Yaroqlilik muddati: ${it.sku}, partiya ${b.batchNo}`, `Expiry: ${it.sku}, batch ${b.batchNo}`), body: `${b.expiryDate} · ${b.qtyLeft} ${it.unit}`, link: '/warehouse/batches', dedupeKey: `wh-exp:${b.id}` });
    }
    for (const b of stale) {
      const it = itemById(b.itemId)!;
      const age = daysBetween(b.receivedAt, t);
      const years = Math.floor(age / 365);
      const thr = warehouseStaleThreshold(it.category);
      const ru = years >= 1 ? `${years} г.` : `${age} дн.`;
      const uz = years >= 1 ? `${years} yil` : `${age} kun`;
      const en = years >= 1 ? `${years} yr` : `${age} days`;
      notify({ roles: ['storekeeper', 'accountant'], kind: 'system', level: 'info', title: L(`Залежалый товар (${ru}): ${it.sku}`, `Uzoq saqlangan tovar (${uz}): ${it.sku}`, `Slow-moving stock (${en}): ${it.sku}`), body: `${b.batchNo} · ${b.receivedAt} · ${b.qtyLeft} ${it.unit} · ≥ ${thr}`, link: '/warehouse/reports?rep=stale', dedupeKey: `wh-stale:${b.id}:${years >= 1 ? `${years}y` : `t${thr}`}` });
    }
    emit();
    return delay(run);
  },
  /** Ежедневный запуск (при первом открытии модуля в день) — регламентное задание в демо. */
  async ensureDailyMonitoring(user: User): Promise<void> {
    if (monitoringRuns.some((r) => r.at.slice(0, 10) === today())) return;
    await warehouseApi.runMonitoring(user, true);
  },
  reconciliation: () => delay(reconRows()),

  // ---------- Настройки (PR-WMS-040) ----------
  getSettings: (): Promise<WarehouseSettings> => delay(clone(WAREHOUSE_SETTINGS)),
  /** Изменить пороги залежалости и срока годности (уполномоченная роль); журнал аудита с изменениями полей. */
  async updateSettings(patch: Partial<WarehouseSettings>, user: User): Promise<WarehouseSettings> {
    if (!canEditWarehouseSettings(user)) throw new Error('FORBIDDEN');
    const okDays = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 3650;
    if (patch.staleDays !== undefined && !okDays(patch.staleDays)) throw new Error('INVALID_SETTINGS');
    if (patch.expiryWarnDays !== undefined && !okDays(patch.expiryWarnDays)) throw new Error('INVALID_SETTINGS');
    if (patch.staleByCategory && Object.values(patch.staleByCategory).some((v) => v !== undefined && !okDays(v))) throw new Error('INVALID_SETTINGS');
    const flat = (x: WarehouseSettings) => ({ staleDays: String(x.staleDays), expiryWarnDays: String(x.expiryWarnDays), ...Object.fromEntries(Object.entries(x.staleByCategory).map(([k, v]) => [`stale_${k}`, String(v)])) });
    const before = flat(WAREHOUSE_SETTINGS);
    if (patch.staleDays !== undefined) WAREHOUSE_SETTINGS.staleDays = patch.staleDays;
    if (patch.expiryWarnDays !== undefined) WAREHOUSE_SETTINGS.expiryWarnDays = patch.expiryWarnDays;
    if (patch.staleByCategory) WAREHOUSE_SETTINGS.staleByCategory = Object.fromEntries(Object.entries(patch.staleByCategory).filter(([, v]) => v !== undefined)) as WarehouseSettings['staleByCategory'];
    const after = flat(WAREHOUSE_SETTINGS);
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])] as (keyof typeof before)[];
    audit.log({ action: 'settings', entity: 'warehouse_settings', entityId: 'warehouse', entityLabel: 'WMS', changes: keys.map((k) => ({ field: k, from: before[k] ?? '—', to: after[k] ?? '—' })).filter((c) => c.from !== c.to), user: auditUser(user) });
    emit();
    return delay(clone(WAREHOUSE_SETTINGS));
  },
  /** Отчёт по залежалым запасам (PR-WMS-040/041): партии старше порога своей категории, стоимость остатка. */
  staleReport(warehouseId?: ID) {
    const t = today();
    return delay(
      batches
        .filter((b) => b.qtyLeft > 0 && staleOf(b, t))
        .map((b) => {
          const it = itemById(b.itemId)!;
          const ageDays = daysBetween(b.receivedAt, t);
          return { batchId: b.id, batchNo: b.batchNo, itemId: it.id, sku: it.sku, name: it.name, unit: it.unit, category: it.category, warehouseId: it.warehouseId, receivedAt: b.receivedAt, ageDays, threshold: warehouseStaleThreshold(it.category), qtyLeft: b.qtyLeft, value: Math.round(b.qtyLeft * b.unitCost) };
        })
        .filter((r) => !warehouseId || r.warehouseId === warehouseId)
        .sort((a, b) => b.ageDays - a.ageDays),
    );
  },

  // ---------- Отчёты ----------
  /** Оборотная ведомость по позициям за период: начальный остаток, приход, расход, списание, конечный остаток. */
  async turnoverReport(from: string, to: string, warehouseId?: ID) {
    return delay(
      items
        .filter((i) => !warehouseId || i.warehouseId === warehouseId)
        .map((it) => {
          const mine = movements.filter((m) => m.itemId === it.id || (m.type === 'transfer' && m.toWarehouseId === it.warehouseId && itemById(m.itemId)?.cardId === it.cardId));
          const inP = (m: WarehouseMovement) => m.at.slice(0, 10) >= from && m.at.slice(0, 10) <= to;
          const after = (m: WarehouseMovement) => m.at.slice(0, 10) > to;
          const signed = (m: WarehouseMovement) => (m.type === 'transfer' ? (m.itemId === it.id ? -m.qty : m.qty) : m.type === 'receipt' ? m.qty : -m.qty);
          const closing = it.qty - mine.filter(after).reduce((s, m) => s + signed(m), 0);
          // Приход нетто: поступления (включая сторно — отрицательные строки) и входящие перемещения.
          const inQty = mine.filter((m) => inP(m) && (m.type === 'receipt' || (m.type === 'transfer' && m.itemId !== it.id))).reduce((s, m) => s + signed(m), 0);
          const issueQty = mine.filter((m) => inP(m) && m.type === 'issue').reduce((s, m) => s + m.qty, 0);
          const woQty = mine.filter((m) => inP(m) && m.type === 'writeoff').reduce((s, m) => s + m.qty, 0);
          const transferOut = mine.filter((m) => inP(m) && m.type === 'transfer' && m.itemId === it.id).reduce((s, m) => s + m.qty, 0);
          const opening = closing - inQty + issueQty + woQty + transferOut;
          return { item: it, opening, receipts: inQty, issues: issueQty, writeoffs: woQty, transfers: transferOut, closing, closingValue: closing * it.unitCost };
        })
        .filter((r) => r.opening || r.receipts || r.issues || r.writeoffs || r.closing),
    );
  },
  /** Остатки на дату (восстановление по журналу движений). */
  async stockOnDate(date: string, warehouseId?: ID) {
    const rows = await warehouseApi.turnoverReport('1900-01-01', date, warehouseId);
    return delay(rows.map((r) => ({ item: r.item, qty: r.closing, value: r.closing * r.item.unitCost })));
  },
  /** Выданные/переданные товары в разрезе подразделений, ЦБУ, МВЗ и сегментов. */
  async issueReport(from: string, to: string, by: 'department' | 'costCenter' | 'segment'): Promise<WarehouseIssueReportRow[]> {
    const ccs = await costCenterIndex();
    const deps = await api.listDepartments();
    const map = new Map<string, WarehouseIssueReportRow>();
    for (const m of movements.filter((x) => x.type === 'issue' && !x.reversed && x.at.slice(0, 10) >= from && x.at.slice(0, 10) <= to)) {
      const cc = ccs.get(m.costCenterId);
      const key = by === 'department' ? (m.departmentId ?? '—') : by === 'costCenter' ? m.costCenterId : (cc?.segment ?? '—');
      const label = by === 'department' ? (deps.find((d) => d.id === m.departmentId)?.name.ru ?? '—') : by === 'costCenter' ? (cc ? `${cc.code} · ${cc.name.ru}` : m.costCenterId) : (cc?.segment ?? '—');
      const r = map.get(key) ?? { key, label, ...(cc?.segment ? { segment: cc.segment } : {}), qty: 0, amount: 0, operations: 0 };
      r.qty += m.qty;
      r.amount += m.amount;
      r.operations++;
      map.set(key, r);
    }
    return delay([...map.values()].sort((a, b) => b.amount - a.amount));
  },
};

// ---------- Импорт карточек (загрузка номенклатуры из Excel) ----------
importRegistry.register({
  id: 'warehouse_cards',
  name: L('Склад: карточки товаров', 'Ombor: tovar kartochkalari', 'Warehouse: item cards'),
  description: L('Новые карточки номенклатуры: номер формируется автоматически по группе', 'Yangi nomenklatura kartochkalari: raqam guruh bo‘yicha avtomatik', 'New item cards: number is generated by group'),
  fields: [
    { key: 'name', label: L('Наименование', 'Nomi', 'Name'), type: 'string', required: true, unique: true, maxLength: 200, sample: 'Маркер перманентный, чёрный' },
    { key: 'group', label: L('Группа', 'Guruh', 'Group'), type: 'enum', required: true, options: warehouseGroupsSeed.map((g) => ({ value: g.id, label: g.name, aliases: [g.code] })), sample: 'OF' },
    { key: 'unit', label: L('Ед. изм.', 'O‘lchov birligi', 'Unit'), type: 'string', required: true, maxLength: 10, sample: 'шт' },
    { key: 'price', label: L('Цена', 'Narx', 'Price'), type: 'number', required: true, min: 0, sample: '12000' },
  ],
  keyField: 'name',
  existingKeys: async () => cards.map((c) => c.name),
  commit: async (rows, user) => {
    let created = 0;
    for (const r of rows) {
      await warehouseApi.saveCard({ name: String(r.name), groupId: String(r.group), unit: String(r.unit), defaultPrice: Number(r.price), offBalance: false, trackExpiry: false }, user);
      created++;
    }
    return { created, updated: 0, skipped: rows.length - created };
  },
});

