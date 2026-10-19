// API модуля «Касса и инкассация».
import { clone, delay, emit, nextId, nextNumber, now, today } from '../../bus';
import { localize, tk, translate } from '../../i18n';
import { matches, registerSearchProvider } from '../../search';
import { audit } from '../../audit';
import { can } from '../../security';
import type { ID, Role, User } from '../../types';
import { CASH_CURRENCIES, CASH_RATES, cashBranchesSeed, cashEconomicsSeed, cashOrdersSeed, cashRoutesSeed } from './data';
import type {
  CashBranch,
  CashBranchEconomics,
  CashCostItem,
  CashCurrency,
  CashEconomicsRecord,
  CashNewOrderInput,
  CashOrder,
  CashOrderStatus,
  CashOverview,
  CashPosition,
  CashRoute,
} from './types';
import { apiError } from '../../errors';

export const CASH_COST_ITEMS: CashCostItem[] = ['staff', 'cit', 'insurance', 'transport', 'counting'];
export const CASH_ORDER_FLOW: CashOrderStatus[] = ['new', 'approved', 'in_transit', 'delivered'];
export { CASH_CURRENCIES, CASH_RATES };

/** Кто ведёт заявки и маршруты инкассации. Остальные роли — только просмотр. */
export const CASH_EDIT_ROLES: Role[] = ['treasury', 'admin'];
/** Право ведения заявок и маршрутов — по матрице прав (модуль cash, уровень «изменение»). */
export const cashCanEdit = (user: Pick<User, 'role'> | null | undefined): boolean => !!user && can(user as User, 'cash', 'edit');
function assertEditor(user: Pick<User, 'role'> | null | undefined) {
  if (!cashCanEdit(user)) throw new Error('cash_err_forbidden');
}

const db = {
  branches: clone(cashBranchesSeed),
  orders: clone(cashOrdersSeed),
  routes: clone(cashRoutesSeed),
  economics: clone(cashEconomicsSeed),
};

const CENTRAL = () => db.branches.find((b) => b.kind === 'central')!;

/** Позиции по валютам относительно лимитов с рекомендуемой суммой заявки до середины коридора. */
export function cashPositions(branch: CashBranch): CashPosition[] {
  return CASH_CURRENCIES.map((currency) => {
    const balance = branch.balances[currency];
    const limit = branch.limits[currency];
    const target = Math.round((limit.min + limit.max) / 2);
    const status = balance > limit.max ? 'over' : balance < limit.min ? 'under' : 'ok';
    const pos: CashPosition = { branchId: branch.id, currency, balance, limit, status, recommended: 0 };
    if (status === 'over') {
      pos.recommended = balance - target;
      pos.recommendedType = 'surrender';
    } else if (status === 'under') {
      pos.recommended = target - balance;
      pos.recommendedType = 'reinforcement';
    }
    return pos;
  });
}

export function cashBranchEconomics(records: CashEconomicsRecord[], branchId: ID): CashBranchEconomics {
  const rs = records.filter((r) => r.branchId === branchId);
  const costs = Object.fromEntries(CASH_COST_ITEMS.map((k) => [k, rs.reduce((s, r) => s + r[k], 0)])) as Record<CashCostItem, number>;
  const volume = rs.reduce((s, r) => s + r.processedVolume, 0);
  const income = rs.reduce((s, r) => s + r.feeIncome, 0);
  const totalCost = CASH_COST_ITEMS.reduce((s, k) => s + costs[k], 0);
  return {
    branchId,
    volume,
    income,
    costs,
    totalCost,
    margin: income - totalCost,
    marginPct: income ? Math.round(((income - totalCost) / income) * 1000) / 10 : 0,
    costPerMln: volume ? Math.round(totalCost / (volume / 1_000_000)) : 0,
  };
}

const toUzs = (amount: number, currency: CashCurrency) => amount * CASH_RATES[currency];

/** Хватает ли наличности у отправителя: при сдаче — у филиала, при подкреплении — в центральном хранилище. */
function checkFunds(order: Pick<CashOrder, 'type' | 'branchId' | 'currency' | 'amount'>) {
  const branch = db.branches.find((b) => b.id === order.branchId);
  if (!branch || branch.kind !== 'branch') throw new Error('cash_err_branch');
  if (order.type === 'surrender' && order.amount > branch.balances[order.currency]) throw new Error('cash_err_branch_funds');
  if (order.type === 'reinforcement' && order.amount > CENTRAL().balances[order.currency]) throw new Error('cash_err_central_funds');
  return branch;
}

/**
 * Отправка заявки (BR-NDO-11, принцип единственного учётного владельца): сумма списывается у отправителя
 * и до доставки числится только в пути — у маршрута инкассации, без двойного отражения.
 */
function dispatch(order: CashOrder) {
  const branch = checkFunds(order);
  if (order.type === 'reinforcement') CENTRAL().balances[order.currency] -= order.amount;
  else branch.balances[order.currency] -= order.amount;
  order.status = 'in_transit';
  order.dispatchedAt = now();
}

/** Доставка заявки: наличность из пути зачисляется получателю. */
function deliver(order: CashOrder) {
  const branch = db.branches.find((b) => b.id === order.branchId);
  if (!branch) throw new Error('cash_err_branch');
  if (order.type === 'reinforcement') branch.balances[order.currency] += order.amount;
  else CENTRAL().balances[order.currency] += order.amount;
  order.status = 'delivered';
  order.deliveredAt = now();
}

export const cashApi = {
  listBranches: () => delay(db.branches),
  getBranch: (id: ID) => delay(db.branches.find((b) => b.id === id)),

  positions: () => delay(db.branches.flatMap(cashPositions)),

  overview(): Promise<CashOverview> {
    const branches = db.branches.filter((b) => b.kind === 'branch');
    const all = branches.map((b) => cashBranchEconomics(db.economics, b.id));
    const volume = all.reduce((s, e) => s + e.volume, 0);
    const cost = all.reduce((s, e) => s + e.totalCost, 0);
    return delay({
      totalCashUzs: db.branches.reduce((s, b) => s + CASH_CURRENCIES.reduce((a, c) => a + toUzs(b.balances[c], c), 0), 0),
      branchesOutOfLimit: db.branches.filter((b) => cashPositions(b).some((p) => p.status !== 'ok')).length,
      openOrders: db.orders.filter((o) => ['new', 'approved', 'in_transit'].includes(o.status)).length,
      activeRoutes: db.routes.filter((r) => r.status !== 'completed').length,
      quarterIncome: all.reduce((s, e) => s + e.income, 0),
      quarterCost: cost,
      costPerMln: volume ? Math.round(cost / (volume / 1_000_000)) : 0,
    });
  },

  listOrders: (branchId?: ID) =>
    delay([...db.orders].filter((o) => !branchId || o.branchId === branchId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),

  async createOrder(input: CashNewOrderInput, user: User): Promise<CashOrder> {
    assertEditor(user);
    if (!(input.amount > 0)) throw apiError('AMOUNT_MUST_BE_POSITIVE');
    if (!input.plannedDate || input.plannedDate < today()) throw new Error('cash_err_date');
    checkFunds({ ...input, amount: Math.round(input.amount) });
    const order: CashOrder = {
      id: nextId('co'),
      number: nextNumber('KZ'),
      type: input.type,
      branchId: input.branchId,
      currency: input.currency,
      amount: Math.round(input.amount),
      status: 'new',
      plannedDate: input.plannedDate,
      createdAt: now(),
      createdBy: user.id,
      ...(input.comment ? { comment: input.comment } : {}),
    };
    db.orders.push(order);
    emit();
    return delay(order);
  },

  /** Следующий шаг заявки. При доставке остатки филиала и центрального хранилища пересчитываются. */
  async advanceOrder(id: ID, user: User): Promise<CashOrder> {
    assertEditor(user);
    const order = db.orders.find((o) => o.id === id);
    if (!order) throw apiError('ORDER_NOT_FOUND');
    const i = CASH_ORDER_FLOW.indexOf(order.status);
    if (i < 0 || i >= CASH_ORDER_FLOW.length - 1) throw apiError('ORDER_IS_CLOSED');
    const next = CASH_ORDER_FLOW[i + 1]!;
    if (next === 'delivered') deliver(order);
    else if (next === 'in_transit') dispatch(order);
    else order.status = next;
    audit.log({ action: 'update', entity: 'cash_order', entityId: order.id, details: `${order.number} → ${order.status}` });
    emit();
    return delay(order);
  },

  async cancelOrder(id: ID, user: User) {
    assertEditor(user);
    const order = db.orders.find((o) => o.id === id);
    if (!order || (order.status !== 'new' && order.status !== 'approved')) throw apiError('ORDER_CANNOT_BE_CANCELLED');
    order.status = 'cancelled';
    emit();
    await delay(null);
  },

  listRoutes: () => delay([...db.routes].sort((a, b) => b.date.localeCompare(a.date))),

  /**
   * Следующий шаг маршрута. Выезд переводит согласованные заявки маршрута «в пути»,
   * завершение маршрута доставляет их (остатки филиалов и хранилища пересчитываются).
   */
  async advanceRoute(id: ID, user: User): Promise<CashRoute> {
    assertEditor(user);
    const r = db.routes.find((x) => x.id === id);
    if (!r) throw apiError('ROUTE_NOT_FOUND');
    const routeOrders = db.orders.filter((o) => o.routeId === r.id);
    if (r.status === 'planned') {
      for (const o of routeOrders) if (o.status === 'approved') checkFunds(o);
      r.status = 'in_transit';
      if (r.stops[0]) r.stops[0].done = true;
      for (const o of routeOrders) if (o.status === 'approved') dispatch(o);
    } else if (r.status === 'in_transit') {
      const next = r.stops.find((s) => !s.done);
      if (next) next.done = true;
      if (r.stops.every((s) => s.done)) {
        r.status = 'completed';
        for (const o of routeOrders) if (o.status === 'in_transit') deliver(o);
      }
    }
    emit();
    return delay(r);
  },

  /** Экономика по филиалам за квартал (или за месяц). */
  economics: (month?: string) => {
    const recs = db.economics.filter((r) => !month || r.month === month);
    return delay(db.branches.filter((b) => b.kind === 'branch').map((b) => cashBranchEconomics(recs, b.id)));
  },

  /** Помесячная динамика по банку (или по филиалу). */
  monthlyTrend: (branchId?: ID) => {
    const months = [...new Set(db.economics.map((r) => r.month))].sort();
    return delay(
      months.map((month) => {
        const rs = db.economics.filter((r) => r.month === month && (!branchId || r.branchId === branchId));
        const income = rs.reduce((s, r) => s + r.feeIncome, 0);
        const cost = rs.reduce((s, r) => s + CASH_COST_ITEMS.reduce((a, k) => a + r[k], 0), 0);
        const volume = rs.reduce((s, r) => s + r.processedVolume, 0);
        return { month, income, cost, volume, costPerMln: volume ? Math.round(cost / (volume / 1_000_000)) : 0 };
      }),
    );
  },
};

/** Внутренний доступ к данным кассы для контура НДО (только чтение, тот же модуль). */
export const cashInternal = {
  branches: () => db.branches,
  orders: () => db.orders,
  routes: () => db.routes,
  economics: () => db.economics,
};

// Глобальный поиск: заявки (номер, комментарий, филиал) и подразделения → карточка подразделения.
registerSearchProvider((q, lang) => {
  const branchName = (id: ID) => localize(db.branches.find((b) => b.id === id)?.name, lang) ?? id;
  return [
    ...db.branches
      .filter((b) => matches(q, b.code, b.name.ru, b.name.uz, b.manager))
      .map((b) => ({ group: 'cash_title', title: `${b.code} · ${localize(b.name, lang)}`, subtitle: localize(b.region, lang), to: `/cash/${b.id}` })),
    ...db.orders
      .filter((o) => matches(q, o.number, o.comment, localize(db.branches.find((b) => b.id === o.branchId)?.name, lang)))
      .map((o) => ({
        group: 'cash_title',
        title: `${o.number} · ${translate(lang, tk('cash_type_', o.type))}`,
        subtitle: `${branchName(o.branchId)} · ${translate(lang, tk('cash_status_', o.status))}`,
        to: `/cash/${o.branchId}`,
      })),
    ...db.routes
      .filter((r) => matches(q, r.number, r.vehicle))
      .map((r) => ({ group: 'cash_title', title: `${r.number} · ${r.vehicle}`, subtitle: translate(lang, tk('cash_route_', r.status)), to: '/cash?tab=routes' })),
  ];
});
