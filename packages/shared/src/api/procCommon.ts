// P2-PROC: общие помощники закупок/договоров/заявок: бюджет с резервированием, филиалы, проводки, ошибки.
import { historyEvent, nextId, nextNumber, now, today } from '../bus';
import { orgBranchOf } from '../org';
import { budgetSource } from '../budgetBridge';
import { notify, type NotificationText } from '../notifications';
import type { Contract, HistoryEvent, ID, ProcurementRequest, User } from '../types';
import type { ContractKind, PostingEntry, PostingSource, ProcPosting } from './procTypes';
import { coreTables, procTables } from './procStore';

/** Ошибка с кодом словаря (`proc_err_*`) — экран переводит её через t(). */
export class ProcError extends Error {
  constructor(public code: string, public detail?: string) {
    super(code);
  }
}
export const fail = (code: string, detail?: string): never => {
  throw new ProcError(`proc_err_${code}`, detail);
};

export const who = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });
export const total = (items: { qty: number; unitPrice: number }[]) => items.reduce((s, i) => s + Math.round(i.qty * i.unitPrice), 0);
export const hist = (doc: { history: HistoryEvent[] }, user: User | ID, action: HistoryEvent['action'], comment?: string) =>
  doc.history.push(historyEvent(typeof user === 'string' ? user : user.id, action, comment));

/** Статусы заявки, при которых её сумма зарезервирована в бюджете статьи (PR-PROC-008/016). */
const RESERVING: ProcurementRequest['status'][] = ['pending', 'approved', 'in_tender', 'in_exchange'];

export interface BudgetCheck {
  lineId: ID;
  planned: number;
  spent: number;
  reserved: number;
  available: number;
  amount: number;
  ok: boolean;
}

/** Остаток статьи с учётом резерва по заявкам в работе и неоплаченных договоров по ним. */
export function budgetCheck(lineId: ID, amount: number, excludeRequestId?: ID): BudgetCheck {
  const db = coreTables();
  // P2-FINPLAN: план и факт статьи — из модуля бюджетирования (мост budgetSource), резерв считаем здесь
  const line = budgetSource.lines(db.budgetLines).find((b) => b.id === lineId);
  const planned = line?.planned ?? 0;
  const spent = line?.spent ?? 0;
  const reqReserved = db.procurement
    .filter((p) => p.budgetLineId === lineId && p.id !== excludeRequestId && RESERVING.includes(p.status))
    .reduce((s, p) => s + total(p.items), 0);
  const contractReserved = db.contracts
    .filter((c) => c.currency === 'UZS' && c.requestId && ['pending', 'active'].includes(c.status))
    .filter((c) => db.procurement.find((p) => p.id === c.requestId)?.budgetLineId === lineId && c.requestId !== excludeRequestId)
    .reduce((s, c) => s + c.payments.filter((p) => !p.paid).reduce((a, p) => a + p.amount, 0), 0);
  const reserved = reqReserved + contractReserved;
  const available = planned - spent - reserved;
  return { lineId, planned, spent, reserved, available, amount, ok: amount <= available };
}

/** Филиал/ЦБУ пользователя: для сотрудников головного офиса — подразделение. */
export function userBranch(user: Pick<User, 'orgUnitKey' | 'departmentId'>): string {
  const key = user.orgUnitKey;
  if (key && /^R\d\d/.test(key)) return orgBranchOf(key) ?? key;
  return user.departmentId;
}
/** Региональный филиал ЦБУ / подразделения филиала: R09-B01 → R09; головной офис → HO. */
export const regionOf = (branchKey: string | undefined): string => (branchKey && /^R\d\d/.test(branchKey) ? branchKey.slice(0, 3) : 'HO');
/** Заявка поступила из ЦБУ (через областной региональный центр). */
export const isCbu = (branchKey: string | undefined): boolean => !!branchKey && /^R\d\d-B\d+/.test(branchKey);

/** Склад филиала для распределения товаров после закупки (PR-PROC-024). */
export function warehouseForBranch(branchKey: string | undefined): string {
  const r = regionOf(branchKey);
  if (r === 'R09') return 'wh2';
  if (r === 'R12') return 'wh3';
  return 'wh1';
}

export function notifyDoc(userIds: ID[], title: NotificationText, body: NotificationText | undefined, link: string, level: 'info' | 'success' | 'warning' | 'danger' = 'info', dedupeKey?: string) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  notify({ userIds: ids, title, ...(body ? { body } : {}), link, level, kind: 'system', ...(dedupeKey ? { dedupeKey } : {}) });
}

export const usersByRole = (role: User['role']) => coreTables().users.filter((u) => u.active !== false && (u.role === role || u.extraRoles?.includes(role))).map((u) => u.id);

// ---------------------------------------------------------------------------------------------
// Бухгалтерские проводки

export function kindSetting(kind: ContractKind | undefined) {
  const t = procTables();
  return t.kindSettings.find((k) => k.kind === (kind ?? 'services')) ?? t.kindSettings[0]!;
}

/** Вид договора по закупке: товары → ОС и МБП, услуги → услуги, работы → строительные расходы. */
export function kindForRequest(req: ProcurementRequest | undefined): ContractKind {
  if (!req) return 'services';
  if (req.kind === 'works') return 'construction';
  if (req.kind === 'services') return 'services';
  return 'fixed_assets';
}

export function addPosting(input: { source: PostingSource; docKind: ProcPosting['docKind']; docId: ID; docNumber: string; contractId?: ID; entries: PostingEntry[]; costCenterKey?: string | undefined }, user: User | ID): ProcPosting {
  const p: ProcPosting = {
    id: nextId('pp'),
    number: nextNumber('PRV'),
    date: today(),
    source: input.source,
    docKind: input.docKind,
    docId: input.docId,
    docNumber: input.docNumber,
    ...(input.contractId ? { contractId: input.contractId } : {}),
    entries: input.entries.filter((e) => e.amount > 0),
    ...(input.costCenterKey ? { costCenterKey: input.costCenterKey } : {}),
    status: 'draft',
    createdBy: typeof user === 'string' ? user : user.id,
    createdAt: now(),
  };
  procTables().postings.unshift(p);
  return p;
}

/** Сумма в UZS (бюджет и проводки ведутся в сумах; валюта — по курсу движка согласований). */
export const RATES: Record<'UZS' | 'USD' | 'EUR', number> = { UZS: 1, USD: 12_650, EUR: 13_700 };
export const toUzs = (amount: number, currency: Contract['currency']) => Math.round(amount * RATES[currency]);

export const daysBetween = (from: string, to: string) => Math.round((new Date(to.slice(0, 10)).getTime() - new Date(from.slice(0, 10)).getTime()) / 86_400_000);
