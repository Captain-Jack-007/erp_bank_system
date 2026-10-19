// Контракт API. Сейчас его реализует mock (in-memory), позже — HTTP-клиент к бэкенду.
// UI зависит только от этого интерфейса, поэтому замена mock на бэкенд не трогает экраны.
import type {
  ApprovalTask,
  BudgetLine,
  Contract,
  ContractStatus,
  Counterparty,
  DashboardStats,
  Department,
  EmployeeRequest,
  EmployeeRequestType,
  ID,
  ProcurementItem,
  ProcurementMethod,
  ProcurementRequest,
  ProcurementStatus,
  Tender,
  User,
  Lang,
} from '../types';
import type { SearchResult } from '../search';
import type { ProcurementKind } from './procTypes';

export interface ProcurementFilter {
  status?: ProcurementStatus;
  departmentId?: ID;
  search?: string;
}

export interface ContractFilter {
  status?: ContractStatus;
  counterpartyId?: ID;
  search?: string;
}

export interface NewProcurementInput {
  title: string;
  departmentId: ID;
  budgetLineId: ID;
  method: ProcurementMethod;
  neededBy: string;
  justification: string;
  items: ProcurementItem[];
  submit: boolean; // true — отправить на согласование, false — сохранить черновик
  // P2-PROC: вид закупки, МВЗ, группа бизнес-плана, ключ вложений формы (ТЗ)
  kind?: ProcurementKind;
  costCenterKey?: string;
  businessGroupId?: ID;
  attachmentKey?: string;
}

export interface NewEmployeeRequestInput {
  type: EmployeeRequestType;
  description: string;
}

export type Decision = 'approve' | 'reject';

export interface Api {
  // Сессия
  listUsers(): Promise<User[]>;
  /** Демо-вход по выбору пользователя / восстановление сессии (method: 'demo' | 'session_restore'). Вход по паролю + 2FA — securityApi. */
  login(userId: ID, method?: string): Promise<User>;
  /** Завершение сессии (запись в журнал аудита). */
  logout(reason?: 'manual' | 'timeout'): Promise<void>;

  // Справочники (ядро, ТЗ 4.2.12)
  listDepartments(): Promise<Department[]>;
  listCounterparties(): Promise<Counterparty[]>;
  listBudgetLines(): Promise<BudgetLine[]>;
  /** Создать или изменить контрагента (MDM). Проверяет уникальность ИНН. */
  saveCounterparty(input: Omit<Counterparty, 'id'> & { id?: ID }): Promise<Counterparty>;
  setCounterpartyBlocked(id: ID, blocked: boolean): Promise<void>;

  // Дашборд
  getDashboard(user: User): Promise<DashboardStats>;

  // Согласования (движок ядра)
  listApprovals(user: User): Promise<ApprovalTask[]>;
  decideApproval(taskId: ID, user: User, decision: Decision, comment?: string): Promise<void>;
  /** Текущий открытый этап согласования документа (если есть). */
  getOpenApproval(entityId: ID): Promise<ApprovalTask | undefined>;

  // Закупки (ТЗ 4.2.1)
  listProcurement(filter?: ProcurementFilter): Promise<ProcurementRequest[]>;
  getProcurement(id: ID): Promise<ProcurementRequest | undefined>;
  createProcurement(input: NewProcurementInput, user: User): Promise<ProcurementRequest>;
  submitProcurement(id: ID, user: User): Promise<void>;
  listTenders(): Promise<Tender[]>;
  /** Согласованная заявка (способ «тендер») → объявить тендер. */
  announceTender(requestId: ID, user: User, deadline: string): Promise<Tender>;
  /** Определить победителя тендера по лучшему баллу или выбранному участнику. */
  awardTender(tenderId: ID, counterpartyId: ID, user: User): Promise<void>;
  /** Согласованная заявка → проект договора (уходит на согласование: юрист → финансы). */
  createContractFromRequest(requestId: ID, input: { counterpartyId: ID; amount: number; startDate: string; endDate: string }, user: User): Promise<Contract>;

  // Договоры (ТЗ 4.2.2)
  listContracts(filter?: ContractFilter): Promise<Contract[]>;
  getContract(id: ID): Promise<Contract | undefined>;
  submitContract(id: ID, user: User): Promise<void>;
  markPaymentPaid(contractId: ID, index: number, user: User): Promise<void>;

  // Заявки сотрудников (ТЗ 4.2.7)
  listEmployeeRequests(user: User): Promise<EmployeeRequest[]>;
  createEmployeeRequest(input: NewEmployeeRequestInput, user: User): Promise<EmployeeRequest>;
  /** Исполнитель закрывает заявку, которая в работе. */
  completeEmployeeRequest(id: ID, user: User, comment: string): Promise<void>;

  // Глобальный поиск по ядру и всем модулям
  search(query: string, lang: Lang): Promise<SearchResult[]>;

  // Подписка на изменения данных (для обновления экранов после мутаций)
  subscribe(listener: () => void): () => void;
}
