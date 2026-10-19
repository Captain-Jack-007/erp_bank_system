// Доменные типы XB-ERP. Совпадают с будущим контрактом API бэкенда.
// Деньги — целые суммы в UZS (number). На бэкенде — PostgreSQL numeric.

/** Языки интерфейса (ТЗ 4.1.5, 4.3.5): русский, узбекский (латиница), узбекский (кириллица — генерируется из латиницы), английский. */
export type Lang = 'ru' | 'uz' | 'uzc' | 'en';
/** Значение данных на нескольких языках. uzc не хранится — транслитерируется из uz; en — необязательный (иначе uz). */
export type Localized = { ru: string; uz: string; en?: string };
export type ID = string;
export type ISODate = string; // 2026-10-18 или 2026-10-18T09:30:00Z
// P2-PROC: расширения закупок/договоров/заявок (все поля необязательны)
import type { ContractExtra, ContractPaymentExtra, CounterpartyExtra, EmployeeRequestExtra, ProcurementExtra, TenderExtra } from './api/procTypes';

export type Role =
  | 'employee' // сотрудник-инициатор
  | 'dept_head' // руководитель подразделения
  | 'procurement' // отдел закупок
  | 'finance' // финансовый департамент
  | 'legal' // юридический департамент
  | 'accountant' // главная бухгалтерия
  | 'treasury' // казначейство
  | 'admin' // администратор системы
  // Роли ТЗ PR-GEN-063 и роли, нужные модулям (матрица прав — security.ts, редактируется в «Роли и права»)
  | 'data_entry' // оператор ввода данных
  | 'approver' // согласующий
  | 'analyst' // аналитик
  | 'cash_operator' // оператор НДО / кассир
  | 'hr' // кадровая служба
  | 'storekeeper' // кладовщик
  | 'driver' // водитель
  | 'archivist' // архивариус
  | 'tax_officer' // налоговый специалист
  | 'support' // техническая поддержка
  | 'auditor'; // аудитор (журналы аудита, access review — только просмотр)

export interface User {
  id: ID;
  fullName: string;
  /** Основная роль (по должности). */
  role: Role;
  departmentId: ID;
  position: Localized;
  email: string;
  /** Логин для входа по паролю (демо). */
  login?: string;
  /** Дополнительные роли сверх основной; права = максимум по всем ролям. */
  extraRoles?: Role[];
  /** Должность из справочника должностей (права привязаны к должности, PR-GEN-036). */
  positionId?: ID;
  /** Бизнес-ключ оргединицы (филиал/ЦБУ/подразделение) и МВЗ. */
  orgUnitKey?: string;
  costCenterKey?: string;
  phone?: string;
  /** false — учётная запись деактивирована (вход запрещён). */
  active?: boolean;
  /** P3-GEN: временное ограничение доступа по HR-событию (трудовой отпуск) — по эту дату включительно (YYYY-MM-DD). */
  suspendedUntil?: string;
}

export interface Department {
  id: ID;
  code: string;
  name: Localized;
  headId?: ID;
}

export type CounterpartyType = 'legal' | 'individual_entrepreneur' | 'foreign';

export interface Counterparty extends CounterpartyExtra {
  id: ID;
  name: string;
  tin: string; // ИНН / STIR (9 цифр)
  type: CounterpartyType;
  address: string;
  phone: string;
  rating: number; // 1..5, оценка поставщика
  blocked: boolean;
}

export interface BudgetLine {
  id: ID;
  code: string;
  name: Localized;
  year: number;
  planned: number;
  spent: number;
}

export interface HistoryEvent {
  at: ISODate;
  userId: ID;
  action: 'created' | 'submitted' | 'approved' | 'rejected' | 'returned' | 'commented' | 'status_changed';
  comment?: string;
  /** Решение принято заместителем «за» этого пользователя (движок согласований, делегирование). */
  onBehalfOf?: ID;
}

// ---------- Закупки (ТЗ 4.2.1) ----------

/** Способ закупки: прямая, отбор (котировки), тендер, биржа (УзРТСБ), электронный магазин, аукцион, спецплощадки (P2-PROC). */
export type ProcurementMethod = 'direct' | 'quotes' | 'tender' | 'exchange' | 'e_shop' | 'auction' | 'special';
export type ProcurementStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'in_tender' | 'contracted' | 'returned' | 'in_exchange' | 'consolidated' | 'executed';

export interface ProcurementItem {
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  /** Позиция номенклатурного справочника (P2-PROC, PR-PROC-003). */
  catalogId?: ID;
  /** Технические характеристики (PR-PROC-004). */
  spec?: string;
}

export interface ProcurementRequest extends ProcurementExtra {
  id: ID;
  number: string;
  title: string;
  departmentId: ID;
  initiatorId: ID;
  budgetLineId: ID;
  method: ProcurementMethod;
  status: ProcurementStatus;
  items: ProcurementItem[];
  neededBy: ISODate;
  createdAt: ISODate;
  justification: string;
  history: HistoryEvent[];
}

export type TenderStatus = 'open' | 'evaluation' | 'awarded' | 'cancelled';

export interface TenderBid {
  counterpartyId: ID;
  amount: number;
  deliveryDays: number;
  score?: number;
}

export interface Tender extends TenderExtra {
  id: ID;
  number: string;
  requestId: ID;
  title: string;
  status: TenderStatus;
  deadline: ISODate;
  bids: TenderBid[];
  winnerId?: ID;
}

// ---------- Договоры (ТЗ 4.2.2) ----------

export type ContractStatus = 'draft' | 'pending' | 'active' | 'expired' | 'terminated';

export interface ContractPayment extends ContractPaymentExtra {
  dueDate: ISODate;
  amount: number;
  paid: boolean;
}

export interface Contract extends ContractExtra {
  id: ID;
  number: string;
  subject: string;
  counterpartyId: ID;
  departmentId: ID;
  amount: number;
  currency: 'UZS' | 'USD' | 'EUR';
  startDate: ISODate;
  endDate: ISODate;
  status: ContractStatus;
  requestId?: ID;
  payments: ContractPayment[];
  history: HistoryEvent[];
}

// ---------- Заявки сотрудников (ТЗ 4.2.7) ----------

/** Заявки на обеспечение (ТЗ 4.2.7): канцтовары, хозтовары, оборудование и инвентарь, ИТ, услуги; прочие — прежние типы (mobile). */
export type EmployeeRequestType = 'stationery' | 'household' | 'equipment' | 'it' | 'service' | 'certificate' | 'it_access' | 'vacation' | 'pass' | 'repair';
export type EmployeeRequestStatus = 'draft' | 'pending' | 'in_progress' | 'warehouse' | 'reserved' | 'issued' | 'done' | 'rejected' | 'returned';

export interface EmployeeRequest extends EmployeeRequestExtra {
  id: ID;
  number: string;
  type: EmployeeRequestType;
  description: string;
  initiatorId: ID;
  status: EmployeeRequestStatus;
  createdAt: ISODate;
  history: HistoryEvent[];
}

// ---------- Согласования (общий движок ядра) ----------

export type ApprovalEntity =
  | 'procurement'
  | 'contract'
  | 'employee_request'
  | 'business_trip'
  | 'einvoice'
  | 'budget_change'
  | 'document'
  | 'asset_writeoff'
  | 'payment' // платёж по договору (PR-CON-048, PR-DOC-034); entityId = `${contractId}:${index}`
  // P2-PROC: акт выполненных работ / оказанных услуг (PR-PROC-076)
  | 'work_act'
  // P2-DOCS: оплата по документу СЭД (решение МИБ, инкассо, требование НО) сверх норматива — entityId = `${documentId}:pay`
  | 'doc_payment'
  // P2-DOCS: акты архива (уничтожение, передача в госархив) — экспертная комиссия
  | 'archive_act'
  // P2-WMS: склад — электронная заявка на выдачу (руководитель ЦБУ), акт списания ТМЗ/МБП; ОС — передача (распоряжение)
  | 'warehouse_issue'
  | 'warehouse_writeoff'
  | 'asset_transfer'
  // P2-FINPLAN: бюджет — ZBB-пакет (4.2.13.1), подтверждение превышения лимита (soft-check), заявка CAPEX/инвестиций
  | 'budget_zbb'
  | 'budget_overrun'
  | 'capex_request'
  // P2-FLT: автопарк — путевой лист (подпись диспетчера), распоряжение о закреплении ТС, зачисление на топливные карты
  | 'fleet_trip'
  | 'fleet_assignment'
  | 'fleet_topup'
  // P2-FINREP: НДО — правило аллокации (BR-NDO-15), закрытие периода (BR-NDO-24)
  | 'cash_rule'
  | 'cash_close'
  // P4 (PR-MDM-003): изменение справочника (номенклатура товаров/услуг, оргструктура, МВЗ) — матрица по виду, E-IMZO
  | 'mdm_change'
  // P4-SEC: архивирование/уничтожение журнала аудита по сроку (PR-SEC-021), обезличивание ПДн по сроку (PR-SEC-049)
  | 'audit_retention'
  | 'pd_anonymize'
  // P4-GEN: регламентное технологическое окно (PR-GEN-059/060) — согласование не менее чем за 5 рабочих дней
  | 'maintenance_window';

export interface ApprovalTask {
  id: ID;
  entity: ApprovalEntity;
  entityId: ID;
  title: string;
  number: string;
  amount?: number;
  currency?: 'UZS' | 'USD' | 'EUR';
  requesterId: ID;
  assigneeRole: Role;
  step: number;
  totalSteps: number;
  createdAt: ISODate;
  dueAt: ISODate;
  status: 'pending' | 'approved' | 'rejected';
}

export interface DashboardStats {
  pendingApprovals: number;
  openRequests: number;
  activeContracts: number;
  activeContractsAmount: number;
  budgetUsedPct: number;
  overduePayments: number;
}

// ---------- Оргструктура, МВЗ, справочники MDM (ТЗ 4.2.12, PR-GEN-007, PR-MDM-001…005) ----------
// Версионность SCD Type 2: каждая запись — версия бизнес-ключа (key) с интервалом [validFrom, validTo].
// Текущая версия — validTo === null. Изменение = закрыть текущую версию и открыть новую.

export interface ScdVersion {
  /** Суррогатный ID версии. */
  id: ID;
  /** Бизнес-ключ — неизменен между версиями. */
  key: string;
  version: number;
  validFrom: ISODate; // YYYY-MM-DD включительно
  validTo: ISODate | null; // YYYY-MM-DD включительно; null — действует
  changedBy: ID;
  changedAt: ISODate;
  changeReason: string;
  changeRequestId?: ID;
}

export type OrgUnitType = 'head_office' | 'region' | 'branch_office' | 'department';

export interface OrgUnit extends ScdVersion {
  code: string;
  type: OrgUnitType;
  name: Localized;
  parentKey: string | null;
  /** Код региона (01 — г. Ташкент … 14 — Республика Каракалпакстан). */
  regionCode: string;
  /** Код ЦБУ (для ЦБУ и подразделений филиалов). */
  cbuCode?: string;
  headUserId?: ID;
  address?: string;
}

export type BusinessSegment = 'retail' | 'corporate' | 'sme' | 'treasury' | 'support' | 'it';

export interface CostCenter extends ScdVersion {
  /** Код МВЗ: MVZ-<регион>-<оргединица>-<nn>. */
  code: string;
  name: Localized;
  orgUnitKey: string;
  /** Обязательный атрибут (Data Quality Firewall). */
  cbuCode: string;
  /** Обязательный атрибут (Data Quality Firewall). */
  segment: BusinessSegment;
  expenseGroupId?: ID;
  responsibleId?: ID;
  status: 'active' | 'closed';
}

export interface ExpenseGroup {
  id: ID;
  code: string;
  name: Localized;
}

/** Статья расходов (бюджетная статья) с отнесением к группе расходов. */
export interface BudgetArticle {
  id: ID;
  code: string;
  name: Localized;
  groupId: ID;
}

export interface Position {
  id: ID;
  code: string;
  name: Localized;
  /** Роль, которую получает сотрудник на этой должности (RBAC по должностям). */
  defaultRole: Role;
}

/** P4: 'nomenclature' — номенклатура товаров/услуг/работ (справочник закупок). */
export type MdmEntity = 'org_unit' | 'cost_center' | 'nomenclature';
export type MdmChangeAction = 'create' | 'update' | 'close';
export type MdmChangeStatus = 'pending' | 'approved' | 'rejected';

export interface MdmChangeRequest {
  id: ID;
  number: string;
  entity: MdmEntity;
  action: MdmChangeAction;
  /** Бизнес-ключ изменяемой записи (для create — присваивается при применении). */
  targetKey?: string;
  /** Предлагаемые значения полей. */
  payload: Record<string, unknown>;
  /** Значения до изменения (для update/close). */
  before?: Record<string, unknown>;
  effectiveFrom: ISODate;
  reason: string;
  /** Подтверждающий документ (PDF/E-imzo) — имя и размер файла. */
  attachment?: { name: string; size: number };
  status: MdmChangeStatus;
  requestedBy: ID;
  requestedAt: ISODate;
  decidedBy?: ID;
  decidedAt?: ISODate;
  decisionComment?: string;
  /** P4: контекст матрицы согласования — вид объекта, вид номенклатуры (товар/услуга/работа), категория. */
  matrix?: { objectType: MdmEntity; itemKind?: string; category?: string };
  /** P4: подписи E-IMZO согласующих по этапам маршрута. */
  signatures?: { userId: ID; signatureId: ID; step: number; cycle: number; at: ISODate }[];
  /** P4: подпись утверждающего обязательна (по шаблону маршрута на момент отправки). */
  requireSignature?: boolean;
  /** P4: история решений по этапам маршрута (движок согласований). */
  history?: HistoryEvent[];
}
