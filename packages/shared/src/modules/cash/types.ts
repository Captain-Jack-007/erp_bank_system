// Типы модуля «Касса и инкассация» (ТЗ 4.2.20): кассы и хранилища, заявки на подкрепление/сдачу,
// маршруты инкассации, доходы/расходы и себестоимость кассового обслуживания.
import type { ID, ISODate, Localized } from '../../types';

export type CashCurrency = 'UZS' | 'USD' | 'EUR' | 'RUB';
export type CashBranchKind = 'central' | 'branch';

export interface CashLimit {
  min: number;
  max: number;
}

export interface CashBranch {
  id: ID;
  code: string;
  name: Localized;
  region: Localized;
  kind: CashBranchKind;
  manager: string;
  desks: number; // кассовые окна
  atms: number; // банкоматы на обслуживании
  balances: Record<CashCurrency, number>;
  limits: Record<CashCurrency, CashLimit>;
}

export type CashPositionStatus = 'ok' | 'over' | 'under';

export interface CashPosition {
  branchId: ID;
  currency: CashCurrency;
  balance: number;
  limit: CashLimit;
  status: CashPositionStatus;
  /** Рекомендуемая сумма заявки до середины коридора лимита. */
  recommended: number;
  recommendedType?: CashOrderType;
}

export type CashOrderType = 'reinforcement' | 'surrender';
export type CashOrderStatus = 'new' | 'approved' | 'in_transit' | 'delivered' | 'cancelled';

export interface CashOrder {
  id: ID;
  number: string;
  type: CashOrderType;
  branchId: ID;
  currency: CashCurrency;
  amount: number;
  status: CashOrderStatus;
  plannedDate: ISODate;
  createdAt: ISODate;
  createdBy: ID;
  routeId?: ID;
  comment?: string;
  dispatchedAt?: ISODate;
  deliveredAt?: ISODate;
}

export type CashRouteStatus = 'planned' | 'in_transit' | 'completed';

export interface CashRouteStop {
  branchId: ID;
  time: string; // 09:30
  orderId?: ID;
  done: boolean;
}

export interface CashRoute {
  id: ID;
  number: string;
  date: ISODate;
  vehicle: string;
  crew: string[];
  status: CashRouteStatus;
  distanceKm: number;
  stops: CashRouteStop[];
}

/** Первичные данные затрат и доходов кассового обслуживания филиала за месяц. */
export interface CashEconomicsRecord {
  branchId: ID;
  month: string; // 2026-07
  processedVolume: number; // пересчитанная наличность, UZS
  feeIncome: number;
  staff: number;
  cit: number; // услуги инкассации
  insurance: number;
  transport: number;
  counting: number; // пересчёт и обработка
}

export type CashCostItem = 'staff' | 'cit' | 'insurance' | 'transport' | 'counting';

/** Рассчитанная экономика филиала. */
export interface CashBranchEconomics {
  branchId: ID;
  volume: number;
  income: number;
  costs: Record<CashCostItem, number>;
  totalCost: number;
  margin: number;
  marginPct: number;
  costPerMln: number; // себестоимость обработки 1 млн so'm
}

export interface CashOverview {
  totalCashUzs: number; // вся наличность в пересчёте на UZS
  branchesOutOfLimit: number;
  openOrders: number;
  activeRoutes: number;
  quarterIncome: number;
  quarterCost: number;
  costPerMln: number;
}

export interface CashNewOrderInput {
  type: CashOrderType;
  branchId: ID;
  currency: CashCurrency;
  amount: number;
  plannedDate: ISODate;
  comment?: string;
}
