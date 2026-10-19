// P2-PROC: заявки сотрудников на обеспечение (ТЗ 4.2.7): канцелярские и хозяйственные товары, оборудование
// и инвентарь, ИТ-оборудование и ПО, услуги. МВЗ подразделения сотрудника, подпись E-IMZO и QR, многоэтапное
// согласование с проверкой бюджета, передача на склад с резервированием, выдача и подтверждение «Принял».
// Склад — через публичный warehouseApi (резерв/выдача по заявке, подпись получателя).
import { clone, delay, emit, historyEvent, nextId, nextNumber, now } from '../bus';
import { approvalEngine } from '../engine';
import { audit } from '../audit';
import { can } from '../security';
import { signatureService } from '../services/signature';
import type { EmployeeRequest, EmployeeRequestType, ID, User } from '../types';
import type { SupplyItem } from './procTypes';
import { coreTables } from './procStore';
import { budgetCheck, fail, hist, notifyDoc, usersByRole, who } from './procCommon';
import { whBridge } from './procWarehouse';

/** Типы заявок на обеспечение по ТЗ 4.2.7 (прочие — прежние типы мобильного приложения). */
export const SUPPLY_TYPES: EmployeeRequestType[] = ['stationery', 'household', 'equipment', 'it', 'service'];
export const isSupplyType = (t: EmployeeRequestType) => SUPPLY_TYPES.includes(t);
const BUDGET_LINE: Record<string, ID> = { stationery: 'b3', household: 'b3', equipment: 'b3', it: 'b1', service: 'b3' };
const CATEGORY_HINT: Record<string, string[]> = { stationery: ['office', 'forms'], household: ['household'], equipment: ['mbp', 'fixed', 'security'], it: ['it', 'fixed'], service: [] };

const link = (r: Pick<EmployeeRequest, 'id'>) => `/requests/${r.id}`;
const isAdmin = (u: User) => u.role === 'admin' || !!u.extraRoles?.includes('admin');
const isStore = (u: User) => isAdmin(u) || u.role === 'storekeeper' || !!u.extraRoles?.includes('storekeeper') || can(u, 'warehouse', 'edit');
const wh = () => import('../modules/warehouse');

function setStatus(r: EmployeeRequest, status: EmployeeRequest['status'], user: User | ID, comment?: string) {
  const from = r.status;
  if (from === status) return;
  r.status = status;
  hist(r, user, 'status_changed', comment);
  audit.log({ action: 'update', entity: 'employee_request', entityId: r.id, entityLabel: r.number, changes: [{ field: 'status', from, to: status }], ...(comment ? { details: comment } : {}) });
}

function itemsAmount(items: SupplyItem[] | undefined) {
  return (items ?? []).reduce((s, i) => s + Math.round(i.qty * i.unitCost), 0);
}

/** Передача утверждённой заявки на склад с резервированием остатков (PR-REQ-013/014). */
async function reserve(r: EmployeeRequest, user: User | ID): Promise<boolean> {
  const db = coreTables();
  const actor = typeof user === 'string' ? db.users.find((u) => u.id === user) : user;
  if (!actor || !r.items?.length) return false;
  try {
    const { warehouseApi } = await wh();
    const is = await warehouseApi.reserveForRequest(
      {
        requestId: r.id,
        requestNumber: r.number,
        requesterId: r.initiatorId,
        recipientId: r.initiatorId,
        departmentId: r.departmentId ?? db.users.find((u) => u.id === r.initiatorId)?.departmentId ?? 'd2',
        ...(r.costCenterKey ? { costCenterId: r.costCenterKey } : {}),
        ...(r.warehouseId ? { warehouseId: r.warehouseId } : {}),
        purpose: `${r.number}: ${r.description}`.slice(0, 120),
        lines: r.items.map((i) => ({ ...(i.warehouseItemId ? { itemId: i.warehouseItemId } : {}), name: i.name, qty: i.qty })),
      },
      actor,
    );
    r.items.forEach((i) => (i.reservedQty = i.qty));
    setStatus(r, 'reserved', actor, is.number);
    return true;
  } catch (e) {
    hist(r, actor, 'commented', `Резерв не выполнен: ${e instanceof Error ? e.message : String(e)}`);
    notifyDoc(usersByRole('storekeeper'), { key: 'proc_n_req_reserve_failed', params: { number: r.number } }, r.description, link(r), 'warning');
    return false;
  }
}

approvalEngine.register('employee_request', {
  onHistory: (id, e) => coreTables().employeeRequests.find((r) => r.id === id)?.history.push(e),
  onFinal: (id, ok) => {
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    if (!r) return;
    if (!ok) {
      r.status = 'rejected';
      return;
    }
    if (!isSupplyType(r.type)) {
      r.status = 'in_progress';
      return;
    }
    if (r.type === 'service') {
      setStatus(r, 'in_progress', 'system', 'Передана исполнителю (АХД)');
      notifyDoc(usersByRole('storekeeper'), { key: 'proc_n_req_service', params: { number: r.number } }, r.description, link(r));
      return;
    }
    setStatus(r, 'warehouse', 'system', 'Передана на склад');
    notifyDoc(usersByRole('storekeeper'), { key: 'proc_n_req_warehouse', params: { number: r.number } }, r.description, link(r));
    const head = coreTables().users.find((u) => u.role === 'storekeeper') ?? coreTables().users.find((u) => u.role === 'admin');
    if (head) void reserve(r, head).then(() => emit());
  },
  onReturned: (id, comment) => {
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    if (r) {
      r.status = 'returned';
      r.returnReason = comment;
    }
  },
  onResubmitted: (id) => {
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    if (r) {
      r.status = 'pending';
      delete r.returnReason;
    }
  },
  getContext: (id) => {
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    return r ? { type: r.type, ...(r.departmentId ? { departmentId: r.departmentId } : {}), ...(r.amount !== undefined ? { amount: r.amount } : {}) } : undefined;
  },
});

// События выдачи склада по заявкам → статусы заявки (выдано / получено).
let subscribed = false;
function subscribeWarehouse() {
  if (subscribed) return;
  subscribed = true;
  void wh().then(({ onWarehouseIssueEvent }) =>
    onWarehouseIssueEvent(({ issue, event }) => {
      if (issue.externalRef?.module !== 'requests') return;
      const r = coreTables().employeeRequests.find((x) => x.id === issue.externalRef!.id);
      if (!r) return;
      if (event === 'issued') {
        r.items?.forEach((i) => (i.issuedQty = i.qty));
        setStatus(r, 'issued', 'system', `Выдано со склада: ${issue.number}`);
        notifyDoc([r.initiatorId], { key: 'proc_n_req_issued', params: { number: r.number } }, r.description, link(r), 'success');
      } else if (event === 'received') {
        r.receivedAt = issue.receivedAt ?? now();
        r.receivedBy = r.initiatorId;
        setStatus(r, 'done', r.initiatorId, '«Принял»');
      } else if (event === 'cancelled' || event === 'rejected') {
        r.items?.forEach((i) => delete i.reservedQty);
        if (r.status === 'reserved') setStatus(r, 'warehouse', 'system', `Резерв снят: ${issue.number}`);
      }
      emit();
    }),
  );
}

export interface SupplyRequestInput {
  type: EmployeeRequestType;
  description: string;
  items: SupplyItem[];
  warehouseId?: string;
  costCenterKey: string;
  submit: boolean;
}

export const supplyApi = {
  types: SUPPLY_TYPES,
  categoryHint: CATEGORY_HINT,
  budgetLineFor: (type: EmployeeRequestType) => BUDGET_LINE[type] ?? 'b3',
  stock: (warehouseId?: string) => whBridge.stock(warehouseId),
  locations: () => whBridge.locations(),

  list(user: User, filter: { scope?: 'mine' | 'department' | 'warehouse' | 'all'; status?: string; type?: string; q?: string } = {}) {
    subscribeWarehouse();
    const db = coreTables();
    const q = filter.q?.trim().toLowerCase();
    const scope = filter.scope ?? 'mine';
    return delay(
      db.employeeRequests
        .filter((r) => {
          if (scope === 'mine') return r.initiatorId === user.id;
          if (scope === 'department') return (r.departmentId ?? db.users.find((u) => u.id === r.initiatorId)?.departmentId) === user.departmentId || isAdmin(user);
          if (scope === 'warehouse') return ['warehouse', 'reserved', 'issued'].includes(r.status) || (r.type === 'service' && r.status === 'in_progress');
          return can(user, 'requests', 'approve') || isAdmin(user) || isStore(user);
        })
        .filter((r) => (!filter.status || r.status === filter.status) && (!filter.type || r.type === filter.type) && (!q || r.number.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },
  get(id: ID) {
    subscribeWarehouse();
    return delay(coreTables().employeeRequests.find((r) => r.id === id));
  },
  async warehouseIssue(id: ID) {
    const { warehouseApi } = await wh();
    return warehouseApi.getIssueForRequest(id);
  },
  budget(type: EmployeeRequestType, amount: number) {
    return delay(budgetCheck(BUDGET_LINE[type] ?? 'b3', amount));
  },

  /** Создание заявки на обеспечение (PR-REQ-001…006): позиции со склада, МВЗ подразделения, проверка остатка и бюджета. */
  async create(input: SupplyRequestInput, user: User) {
    if (!can(user, 'requests', 'edit')) fail('forbidden');
    subscribeWarehouse();
    if (!isSupplyType(input.type)) fail('bad_state');
    if (!input.description.trim() || !input.costCenterKey) fail('required');
    const goods = input.type !== 'service';
    if (goods && (!input.items.length || input.items.some((i) => !(i.qty > 0) || !Number.isInteger(i.qty) || !i.name))) fail('items');
    if (goods) {
      const stock = await whBridge.stock(input.warehouseId);
      for (const i of input.items) {
        const s = stock.find((x) => x.id === i.warehouseItemId);
        if (!s || i.qty > s.available) fail('stock', i.name);
      }
    }
    const amount = itemsAmount(input.items);
    const line = BUDGET_LINE[input.type] ?? 'b3';
    if (amount && !budgetCheck(line, amount).ok) fail('budget');
    const db = coreTables();
    const r: EmployeeRequest = {
      id: nextId('e'),
      number: nextNumber('ZA'),
      type: input.type,
      description: input.description.trim(),
      initiatorId: user.id,
      status: input.submit ? 'pending' : 'draft',
      createdAt: now(),
      history: [historyEvent(user.id, 'created')],
      items: clone(input.items),
      departmentId: user.departmentId,
      costCenterKey: input.costCenterKey,
      amount,
      budgetLineId: line,
      ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
    };
    db.employeeRequests.push(r);
    if (input.submit) open(r, user);
    audit.log({ action: 'create', entity: 'employee_request', entityId: r.id, entityLabel: r.number, details: `${r.type} · ${amount}`, user: who(user) });
    emit();
    return delay(r);
  },
  async submit(id: ID, user: User) {
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    if (!r || !['draft', 'returned'].includes(r.status) || r.initiatorId !== user.id) fail('bad_state');
    if (r!.status === 'returned') {
      approvalEngine.resubmit(r!.id, user);
      emit();
      return delay(null);
    }
    r!.status = 'pending';
    open(r!, user);
    emit();
    await delay(null);
  },
  async recordSignature(id: ID, signatureId: ID, user: User) {
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    const sig = signatureService.get(signatureId);
    if (!r || !sig || sig.entity !== 'employee_request' || sig.entityId !== id || sig.userId !== user.id) fail('signature');
    r!.signatureIds = [...new Set([...(r!.signatureIds ?? []), signatureId])];
    hist(r!, user, 'commented', `E-IMZO ${sig!.certSerial}`);
    emit();
    await delay(null);
  },
  /** Резерв вручную (если автоматический не выполнен — например, не было остатка). */
  async reserve(id: ID, user: User) {
    if (!isStore(user)) fail('forbidden');
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    if (!r || r.status !== 'warehouse') fail('bad_state');
    const ok = await reserve(r!, user);
    emit();
    if (!ok) fail('stock');
  },
  /** Выдача по заявке: проводится складом после подписей расхода (руководитель, операционист, завсклад). */
  async issue(id: ID, user: User) {
    if (!isStore(user)) fail('forbidden');
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    if (!r || r.status !== 'reserved') fail('bad_state');
    const { warehouseApi } = await wh();
    try {
      await warehouseApi.issueForRequest(r!.id, user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('SIGNATURES_REQUIRED')) fail('signatures', msg.split(':')[1] ?? '');
      throw e;
    }
    emit();
    await delay(null);
  },
  /** «Принял» по товару: подпись получателя E-IMZO на складском расходе (PR-REQ-015). */
  async confirmReceipt(id: ID, signatureId: ID, user: User) {
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    if (!r || r.status !== 'issued' || r.initiatorId !== user.id) fail('bad_state');
    const { warehouseApi } = await wh();
    const is = await warehouseApi.getIssueForRequest(r!.id);
    if (!is) fail('not_found');
    await warehouseApi.signIssue(is!.id, 'recipient', signatureId, user);
    r!.signatureIds = [...new Set([...(r!.signatureIds ?? []), signatureId])];
    r!.receivedAt = now();
    r!.receivedBy = user.id;
    setStatus(r!, 'done', user, '«Принял» (E-IMZO)');
    emit();
    await delay(null);
  },
  /** Услуга оказана (исполнитель АХД). */
  async serviceDone(id: ID, comment: string, user: User) {
    if (!isStore(user) && !can(user, 'requests', 'approve')) fail('forbidden');
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    if (!r || r.type !== 'service' || r.status !== 'in_progress') fail('bad_state');
    if (!comment.trim()) fail('reason');
    r!.serviceDoneAt = now();
    setStatus(r!, 'issued', user, comment.trim());
    notifyDoc([r!.initiatorId], { key: 'proc_n_req_issued', params: { number: r!.number } }, comment.trim(), link(r!), 'success');
    emit();
    await delay(null);
  },
  /** «Принял» по услуге — подпись E-IMZO на заявке. */
  async confirmService(id: ID, signatureId: ID, user: User) {
    const r = coreTables().employeeRequests.find((x) => x.id === id);
    const sig = signatureService.get(signatureId);
    if (!r || r.type !== 'service' || r.status !== 'issued' || r.initiatorId !== user.id) fail('bad_state');
    if (!sig || sig.entity !== 'employee_request' || sig.entityId !== id || sig.userId !== user.id) fail('signature');
    r!.signatureIds = [...new Set([...(r!.signatureIds ?? []), signatureId])];
    r!.receivedAt = now();
    r!.receivedBy = user.id;
    setStatus(r!, 'done', user, '«Принял» (E-IMZO)');
    emit();
    await delay(null);
  },
};

function open(r: EmployeeRequest, user: User) {
  hist(r, user, 'submitted');
  approvalEngine.open({ entity: 'employee_request', entityId: r.id, number: r.number, title: r.description.slice(0, 60), requesterId: user.id, ...(r.amount ? { amount: r.amount } : {}), context: { type: r.type, ...(r.departmentId ? { departmentId: r.departmentId } : {}) } });
}
