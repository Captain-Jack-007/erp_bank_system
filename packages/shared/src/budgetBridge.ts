// Единый источник бюджетной правды (P2-FINPLAN, ТЗ 4.2.13).
// Ядро (закупки, договоры, платежи) хранит только ссылку на статью бюджета (budgetLineId), а план/факт/остаток
// и бюджетный контроль берёт у модуля «Бюджетирование» через этот мост. Модуль регистрирует провайдер при загрузке;
// без провайдера ядро работает по своим демо-данным (как раньше).
import type { BudgetLine, ID, User } from './types';

export interface BudgetPaymentEvent {
  budgetLineId: ID;
  amount: number;
  /** Ссылка на документ-основание (договор:платёж). */
  ref: string;
  refLabel: string;
  user: User;
  departmentId?: ID;
  /** P3: платёж уже исполнен банком (прошёл предварительный контроль) — только списание факта, без блокировки. */
  force?: boolean;
}

/** P3: результат бюджетного контроля для заявки ядра (триада: лимит · кассовый план · склад; режим hard/soft). */
export interface BudgetControlInfo {
  mode: 'hard' | 'soft';
  /** Остаток кассового плана (ОДДС) подразделения на месяц достаточен. */
  cashOk: boolean;
  cashAvailable: number;
  cashMonth: number;
  /** Подходящие ТМЦ на складе (предложение внутреннего ресурса до закупки). */
  stock: { name: string; qty: number; unit: string }[];
}

export interface BudgetSourceProvider {
  /** Статьи бюджета ядра (b1…) с планом и фактом из модуля бюджетирования. */
  lines(seed: BudgetLine[]): BudgetLine[];
  /** Платёж по статье: бюджетный контроль (hard-check блокирует — бросает ошибку) и списание факта. */
  payment(e: BudgetPaymentEvent): void;
  /** P3: предварительная проверка платежа без списания — true, если hard-check заблокирует платёж. */
  paymentBlocked?(e: Omit<BudgetPaymentEvent, 'user' | 'refLabel'>): boolean;
  /** P3: контроль заявки на расход по статье ядра: режим статьи, кассовый план, складские остатки. */
  control?(e: { budgetLineId: ID; amount: number; month?: number; items?: { name: string; qty: number }[] }): Promise<BudgetControlInfo | null>;
}

let provider: BudgetSourceProvider | null = null;

export function registerBudgetSource(p: BudgetSourceProvider): void {
  provider = p;
}

export const budgetSource = {
  lines(seed: BudgetLine[]): BudgetLine[] {
    return provider ? provider.lines(seed) : seed;
  },
  /** true — платёж учтён модулем бюджетирования; false — провайдера нет (ядро ведёт факт само). */
  payment(e: BudgetPaymentEvent): boolean {
    if (!provider) return false;
    provider.payment(e);
    return true;
  },
  /** P3: hard-check заблокирует этот платёж (не допускать создания/отправки платёжного поручения). */
  paymentBlocked(e: Omit<BudgetPaymentEvent, 'user' | 'refLabel'>): boolean {
    return provider?.paymentBlocked ? provider.paymentBlocked(e) : false;
  },
  /** P3: бюджетный контроль заявки ядра (null — провайдера нет или статья не связана с модулем). */
  async control(e: { budgetLineId: ID; amount: number; month?: number; items?: { name: string; qty: number }[] }): Promise<BudgetControlInfo | null> {
    return provider?.control ? provider.control(e) : null;
  },
};
