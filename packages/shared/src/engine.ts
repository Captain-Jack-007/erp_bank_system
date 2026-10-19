// Движок согласований v2 (ядро платформы). Один на все модули.
// Модуль регистрирует обработчик своего типа документа и открывает задачи через approvalEngine.open().
//
// Что умеет (ТЗ PR-PROC-014/015/022, PR-DOC-011/013/034, PR-CON-048, PR-SEC-036, PR-GEN-080):
//  • шаблоны маршрутов по типу документа с условиями (сумма, подтип/способ закупки, подразделение, филиал,
//    произвольные поля контекста) и шагами: роль, конкретный пользователь, руководитель подразделения
//    инициатора, руководитель указанного подразделения, роль в филиале инициатора, коллегиальный орган
//    (Правление / Кредитный комитет); параллельные шаги (все / любой), SLA в часах, шаг Правления сверх порога;
//  • действия: согласовать, отклонить (с причиной), вернуть на доработку, повторно отправить,
//    заместители на период (решение «за» руководителя), комментарий, запрос информации;
//  • разделение обязанностей: инициатор не согласует свой документ (в т. ч. админ); по флагу шаблона —
//    один человек не согласует два этапа одного документа;
//  • история каждого шага, контроль SLA (предупреждение, просрочка, эскалация руководителю), уведомления.
//
// Обратная совместимость: register/open/seed/list/openFor/decide/ROUTES/reset/all работают как раньше;
// шаблоны по умолчанию повторяют ROUTES.
import { clone, delay, emit, historyEvent, nextId, now } from './bus';
import { directory } from './directory';
import { notify } from './notifications';
import { audit, type AuditAction } from './audit';
import { registerModuleAccess } from './security';
import type { ApprovalEntity, ApprovalTask, HistoryEvent, ID, Localized, Role, User } from './types';

// ---------------------------------------------------------------------------------------------
// Базовые маршруты по ролям (как в v1). Используются шаблонами по умолчанию и мобильным приложением.
export const ROUTES: Record<ApprovalEntity, Role[]> = {
  procurement: ['dept_head', 'finance', 'procurement'],
  contract: ['legal', 'finance'],
  employee_request: ['dept_head'],
  business_trip: ['dept_head', 'accountant'],
  einvoice: ['accountant'],
  budget_change: ['dept_head', 'finance'],
  document: ['dept_head'],
  asset_writeoff: ['dept_head', 'accountant'],
  payment: ['treasury'],
  work_act: ['dept_head', 'accountant'], // P2-PROC: акт выполненных работ
  doc_payment: ['dept_head'], // P2-DOCS
  archive_act: ['legal', 'dept_head'], // P2-DOCS
  warehouse_issue: ['dept_head'], // P2-WMS: руководитель ЦБУ (шаблон — руководитель инициатора)
  warehouse_writeoff: ['accountant'], // P2-WMS
  asset_transfer: ['dept_head', 'accountant'], // P2-WMS
  budget_zbb: ['dept_head', 'finance'], // P2-FINPLAN
  budget_overrun: ['dept_head', 'finance'], // P2-FINPLAN: руководитель инициатора → финансы
  capex_request: ['dept_head', 'finance'], // P2-FINPLAN
  fleet_trip: ['dept_head'], // P2-FLT: диспетчер (шаблон — руководитель АХД или руководитель подразделения)
  fleet_assignment: ['dept_head', 'hr'], // P2-FLT: распоряжение о закреплении ТС
  fleet_topup: ['dept_head', 'accountant'], // P2-FLT: зачисление на топливные карты
  cash_rule: ['finance'], // P2-FINREP: правило аллокации НДО
  cash_close: ['accountant', 'finance'], // P2-FINREP: закрытие периода НДО (проверка → утверждение)
  audit_retention: ['auditor'], // P4-SEC: инициирует администратор ИБ, утверждает внутренний аудитор (контроль двух лиц)
  pd_anonymize: ['legal'], // P4-SEC: инициирует администратор / HR, утверждает юрист (соответствие закону о ПДн)
  maintenance_window: ['dept_head'], // P4-GEN: регламентное окно — согласование с Заказчиком (руководитель ИТ-подразделения)
  mdm_change: ['admin'], // P4 (PR-MDM-003): изменение справочника; матрица по виду номенклатуры — шаблоны p4MdmTemplates
};

export const APPROVAL_ENTITIES = Object.keys(ROUTES) as ApprovalEntity[];

/** Курсы для сравнения сумм с порогами шаблонов (mock; в продуктиве — курс ЦБ на дату документа). */
export const ROUTE_RATES: Record<'UZS' | 'USD' | 'EUR', number> = { UZS: 1, USD: 12_650, EUR: 13_700 };

// ---------------------------------------------------------------------------------------------
// Типы

export type CommitteeId = 'board' | 'credit_committee';

/** Кто согласует шаг. */
export type ApproverSpec =
  | { kind: 'role'; role: Role }
  | { kind: 'user'; userId: ID }
  | { kind: 'initiatorHead' }
  | { kind: 'departmentHead'; departmentId: ID }
  | { kind: 'branchRole'; role: Role }
  | { kind: 'committee'; committee: CommitteeId };

export type ApproverKind = ApproverSpec['kind'];

export type ConditionOp = 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

export interface FieldCondition {
  field: string;
  op: ConditionOp;
  value: string | number | string[];
}

/** Условия применения шаблона или шага. Пустое условие — подходит всегда. Суммы — в UZS-эквиваленте. */
export interface RouteCondition {
  amountGt?: number;
  amountLte?: number;
  /** Подтип документа / способ закупки (context.subtype | method | type | kind). */
  subtypes?: string[];
  departmentIds?: ID[];
  branchIds?: ID[];
  fields?: FieldCondition[];
}

export interface RouteStepTemplate {
  id: string;
  name?: Localized;
  /** Один согласующий или несколько (параллельный шаг). */
  approvers: ApproverSpec[];
  /** Параллельный шаг: 'all' — нужны все, 'any' — достаточно одного. */
  mode?: 'all' | 'any';
  /** Срок шага, часов (по умолчанию 72). */
  slaHours?: number;
  /** Шаг включается только при выполнении условия. */
  when?: RouteCondition;
}

export interface RouteTemplateVersion {
  version: number;
  note?: string;
  at: string;
  by?: ID;
}

export interface RouteTemplate {
  id: string;
  entity: ApprovalEntity;
  name: Localized;
  /** Больше — проверяется раньше. Шаблон по умолчанию — 0. */
  priority: number;
  active: boolean;
  conditions: RouteCondition;
  steps: RouteStepTemplate[];
  /** Один пользователь не может согласовать два этапа одного документа. */
  distinctApprovers?: boolean;
  /** Сумма (UZS), сверх которой добавляется финальный шаг коллегиального органа. */
  boardThreshold?: number;
  boardCommittee?: CommitteeId;
  version: number;
  versionNote?: string;
  updatedAt: string;
  updatedBy?: ID;
  versions: RouteTemplateVersion[];
  /** Системный шаблон (по умолчанию) — нельзя удалить. */
  system?: boolean;
  /** P4 (PR-MDM-003): каждый согласующий подписывает решение ЭЦП E-IMZO (проверяет обработчик модуля в beforeApprove). */
  requireSignature?: boolean;
}

export interface Committee {
  id: CommitteeId;
  name: Localized;
  memberIds: ID[];
  slaHours: number;
}

export interface BulkPolicy {
  entities: ApprovalEntity[];
  /** Максимальная сумма (UZS-эквивалент) для массового согласования; задачи без суммы проходят. */
  maxAmount: number;
}

export interface Delegation {
  id: ID;
  /** Кого замещают. */
  userId: ID;
  /** Заместитель. */
  deputyId: ID;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  /** Только эти типы документов (пусто — все). */
  entities?: ApprovalEntity[];
  comment?: string;
  active: boolean;
  createdAt: string;
  createdBy: ID;
}

/** Контекст маршрутизации: сумма, подтип, подразделение, филиал и любые поля модуля. */
export type RouteContext = Record<string, unknown> & {
  amount?: number;
  amountUzs?: number;
  currency?: 'UZS' | 'USD' | 'EUR';
  requesterId?: ID;
  departmentId?: ID;
  branchId?: ID;
  subtype?: string;
};

export interface ResolvedApprover {
  spec: ApproverSpec;
  /** Роль для отображения и v1-совместимой видимости задачи. */
  role: Role;
  /** Конкретные пользователи (если определены). Нет — задача видна всем с ролью. */
  userIds?: ID[];
  names: string[];
  /** Сработал запасной вариант (например, инициатор сам руководитель). */
  fallback?: boolean;
}

export type StepState = 'pending' | 'current' | 'done' | 'rejected' | 'returned';

export interface StepDecision {
  taskId: ID;
  userId: ID;
  onBehalfOf?: ID;
  decision: 'approved' | 'rejected' | 'returned';
  comment?: string;
  at: string;
}

export interface ResolvedStep {
  index: number;
  name?: Localized;
  approvers: ResolvedApprover[];
  mode: 'all' | 'any';
  slaHours: number;
  committee?: CommitteeId;
  state: StepState;
  startedAt?: string;
  finishedAt?: string;
  dueAt?: string;
  decisions: StepDecision[];
}

export interface RouteInstance {
  id: ID;
  entity: ApprovalEntity;
  entityId: ID;
  number: string;
  title: string;
  requesterId: ID;
  amount?: number;
  currency?: ApprovalTask['currency'];
  templateId?: string;
  templateVersion?: number;
  templateName?: Localized;
  cycle: number;
  status: 'in_progress' | 'approved' | 'rejected' | 'returned';
  steps: ResolvedStep[];
  currentStep: number;
  distinctApprovers: boolean;
  context: RouteContext;
  createdAt: string;
  finishedAt?: string;
  /** Построен по демо-задаче (ранние этапы без истории). */
  legacy?: boolean;
}

export type RouteEventAction =
  | 'submitted'
  | 'resubmitted'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'commented'
  | 'info_requested'
  | 'escalated'
  | 'sla_overdue'
  | 'skipped';

export interface RouteEvent {
  id: ID;
  instanceId: ID;
  entity: ApprovalEntity;
  entityId: ID;
  number: string;
  title: string;
  cycle: number;
  step?: number;
  taskId?: ID;
  at: string;
  actorId: ID;
  onBehalfOf?: ID;
  action: RouteEventAction;
  comment?: string;
  targetIds?: ID[];
}

/** Задача согласования v2: ApprovalTask + поля движка (все необязательные — совместимо с v1). */
export interface ApprovalTaskV2 extends ApprovalTask {
  instanceId?: ID;
  assigneeIds?: ID[];
  escalatedTo?: ID[];
  escalatedAt?: string;
  slaHours?: number;
  stepName?: Localized;
  approver?: ApproverSpec;
  outcome?: 'approved' | 'rejected' | 'returned' | 'skipped' | 'cancelled';
  decidedBy?: ID;
  decidedAt?: string;
  onBehalfOf?: ID;
  comment?: string;
  infoRequested?: boolean;
  slaWarned?: boolean;
  overdueNotified?: boolean;
}

export interface ApprovalHandler {
  /** Записать событие в историю документа (каждое решение). */
  onHistory(entityId: ID, event: HistoryEvent): void;
  /** Финальное решение: approved=true после последнего этапа, false — при отклонении на любом этапе. */
  onFinal(entityId: ID, approved: boolean): void;
  /** Возврат на доработку. Нет обработчика — как отклонение (onFinal(false)), но документ можно отправить повторно. */
  onReturned?(entityId: ID, comment: string): void;
  /** Повторная отправка после возврата/отклонения через approvalEngine.resubmit(). */
  onResubmitted?(entityId: ID): void;
  /** Дополнительный контекст маршрутизации (способ закупки, подразделение…), если open() его не передал. */
  getContext?(entityId: ID): Record<string, unknown> | undefined;
  /** P4 (PR-MDM-003): проверка модуля перед согласованием (например, подпись E-IMZO); бросает ApprovalError, чтобы запретить. */
  beforeApprove?(entityId: ID, user: User, task: ApprovalTask): void;
}

export interface OpenTaskInput {
  entity: ApprovalEntity;
  entityId: ID;
  number: string;
  title: string;
  requesterId: ID;
  amount?: number;
  currency?: ApprovalTask['currency'];
  /** v1: открыть конкретный этап (по умолчанию 1). */
  step?: number;
  /** Поля для условий маршрута: subtype/method, departmentId, branchId и любые другие. */
  context?: Record<string, unknown>;
}

export class ApprovalError extends Error {
  constructor(
    public code: 'not_available' | 'not_allowed' | 'sod_initiator' | 'sod_repeat' | 'reason_required' | 'not_found' | 'not_initiator' | 'invalid' | 'signature_required',
    message?: string,
  ) {
    // P4-SEC (PR-TEC-008): message — код (экран переводит flow_err_<код>), английский текст — только для техжурнала
    super(code);
    this.detail = message ?? code;
  }
  readonly detail: string;
}

export interface RoutePreviewStep {
  index: number;
  name?: Localized;
  approvers: ResolvedApprover[];
  mode: 'all' | 'any';
  slaHours: number;
  committee?: CommitteeId;
}

export interface RoutePreview {
  entity: ApprovalEntity;
  templateId?: string;
  templateName?: Localized;
  distinctApprovers: boolean;
  steps: RoutePreviewStep[];
}

export interface RouteView extends RoutePreview {
  instanceId: ID;
  entityId: ID;
  number: string;
  status: RouteInstance['status'];
  cycle: number;
  currentStep: number;
  requesterId: ID;
  steps: (RoutePreviewStep & { state: StepState; startedAt?: string; finishedAt?: string; dueAt?: string; overdue: boolean; decisions: StepDecision[]; escalatedTo?: ID[] })[];
  events: RouteEvent[];
  legacy?: boolean;
}

export type InboxBox = 'mine' | 'delegated' | 'sent' | 'history';

export interface InboxItem {
  task: ApprovalTaskV2;
  /** Задача видна через замещение: за кого. */
  onBehalfOf?: ID;
  canApprove: boolean;
  /** Почему нельзя согласовать: SoD. */
  blockedReason?: 'sod_initiator' | 'sod_repeat';
  lowRisk: boolean;
  overdue: boolean;
  /** Для «Отправленные мной»: состояние маршрута. */
  instance?: { status: RouteInstance['status']; cycle: number; currentStep: number; totalSteps: number };
  /** Для «История»: событие пользователя. */
  event?: RouteEvent;
}

export interface InboxFilter {
  entity?: ApprovalEntity;
  from?: string;
  to?: string;
  overdueOnly?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Шаблоны и настройки по умолчанию

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const role = (r: Role): ApproverSpec => ({ kind: 'role', role: r });
const MLN = 1_000_000;
const BLN = 1_000_000_000;

const DEFAULT_SLA: Partial<Record<Role, number>> = { dept_head: 72, finance: 72, procurement: 72, legal: 72, accountant: 72, treasury: 72 };

const ENTITY_NAMES: Record<ApprovalEntity, Localized> = {
  procurement: L('Заявка на закупку', 'Xarid arizasi', 'Purchase request'),
  contract: L('Договор', 'Shartnoma', 'Contract'),
  employee_request: L('Заявка сотрудника', 'Xodim arizasi', 'Employee request'),
  business_trip: L('Командировка', 'Xizmat safari', 'Business trip'),
  einvoice: L('Счёт-фактура', 'Hisob-faktura', 'E-invoice'),
  budget_change: L('Изменение бюджета', "Byudjet o'zgarishi", 'Budget change'),
  document: L('Документ', 'Hujjat', 'Document'),
  asset_writeoff: L('Списание ОС', 'AV hisobdan chiqarish', 'Asset write-off'),
  payment: L('Платёж', "To'lov", 'Payment'),
  work_act: L('Акт выполненных работ', 'Bajarilgan ishlar dalolatnomasi', 'Work completion act'), // P2-PROC
  doc_payment: L('Оплата по документу', "Hujjat bo'yicha to'lov", 'Document payment'), // P2-DOCS
  archive_act: L('Акт архива', 'Arxiv dalolatnomasi', 'Archive act'), // P2-DOCS
  warehouse_issue: L('Заявка на выдачу со склада', 'Ombordan berish arizasi', 'Warehouse issue request'), // P2-WMS
  warehouse_writeoff: L('Акт списания ТМЗ/МБП', 'TMZ/MBP hisobdan chiqarish dalolatnomasi', 'Inventory write-off act'), // P2-WMS
  asset_transfer: L('Передача ОС', 'AV ni topshirish', 'Asset transfer'), // P2-WMS
  budget_zbb: L('ZBB-пакет бюджета', 'ZBB byudjet paketi', 'ZBB budget package'), // P2-FINPLAN
  budget_overrun: L('Превышение лимита бюджета', 'Byudjet limitidan oshish', 'Budget limit overrun'), // P2-FINPLAN
  capex_request: L('Заявка CAPEX / инвестиции', 'CAPEX / investitsiya arizasi', 'CAPEX / investment request'), // P2-FINPLAN
  fleet_trip: L('Путевой лист', "Yo'l varaqasi", 'Waybill'), // P2-FLT
  fleet_assignment: L('Закрепление ТС за водителем', 'TV ni haydovchiga biriktirish', 'Vehicle assignment order'), // P2-FLT
  fleet_topup: L('Зачисление на топливные карты', "Yoqilg'i kartalariga o'tkazish", 'Fuel card top-up'), // P2-FLT
  cash_rule: L('Правило аллокации НДО', 'NPA taqsimlash qoidasi', 'Cash allocation rule'), // P2-FINREP
  cash_close: L('Закрытие периода НДО', 'NPA davrini yopish', 'Cash period close'), // P2-FINREP
  audit_retention: L('Архивирование / уничтожение журнала аудита', 'Audit jurnalini arxivlash / yo‘q qilish', 'Audit log archiving / destruction'), // P4-SEC
  pd_anonymize: L('Обезличивание персональных данных', 'Shaxsiy ma’lumotlarni anonimlashtirish', 'Personal data anonymisation'), // P4-SEC
  maintenance_window: L('Регламентное окно', 'Reglament oynasi', 'Maintenance window'), // P4-GEN
  mdm_change: L('Изменение справочника', "Ma'lumotnoma o'zgarishi", 'Reference data change'), // P4 (PR-MDM-003)
};

let tplSeq = 0;
function tpl(entity: ApprovalEntity, t: Omit<RouteTemplate, 'entity' | 'version' | 'updatedAt' | 'versions' | 'id'> & { id?: string }): RouteTemplate {
  const at = '2026-10-01T09:00:00Z';
  return { id: t.id ?? `rt-${entity}-${++tplSeq}`, entity, version: 1, updatedAt: at, versions: [{ version: 1, at, note: 'Начальная версия' }], ...t };
}

function step(id: string, approvers: ApproverSpec[], extra: Partial<RouteStepTemplate> = {}): RouteStepTemplate {
  const first = approvers[0];
  const sla = first?.kind === 'role' ? DEFAULT_SLA[first.role] : undefined;
  return { id, approvers, slaHours: sla ?? 72, ...extra };
}

function defaultTemplates(): RouteTemplate[] {
  tplSeq = 0;
  const base = APPROVAL_ENTITIES.map((e) =>
    tpl(e, {
      id: `rt-${e}-default`,
      name: L(`${ENTITY_NAMES[e].ru}: стандартный маршрут`, `${ENTITY_NAMES[e].uz}: standart yo'nalish`, `${ENTITY_NAMES[e].en}: standard route`),
      priority: 0,
      active: true,
      conditions: {},
      steps: ROUTES[e].map((r, i) => step(`s${i + 1}`, [role(r)])),
      system: true,
    }),
  );
  // Правление сверх порога — для крупных закупок, договоров и платежей (PR-PROC-015).
  for (const t of base) {
    if (t.entity === 'procurement' || t.entity === 'contract' || t.entity === 'payment') {
      t.boardThreshold = BLN;
      t.boardCommittee = 'board';
    }
  }
  const variants: RouteTemplate[] = [
    tpl('procurement', {
      id: 'rt-procurement-direct',
      name: L('Прямая закупка свыше 300 млн', "300 mln dan ortiq to'g'ridan-to'g'ri xarid", 'Direct purchase over 300 mln'),
      priority: 20,
      active: true,
      conditions: { subtypes: ['direct'], amountGt: 300 * MLN },
      steps: [step('s1', [role('dept_head')]), step('s2', [role('finance')]), step('s3', [role('legal')], { name: L('Юридическая экспертиза единственного поставщика', 'Yagona yetkazib beruvchi yuridik ekspertizasi', 'Legal review of single source') }), step('s4', [role('procurement')])],
      distinctApprovers: true,
      boardThreshold: BLN,
      boardCommittee: 'board',
    }),
    tpl('contract', {
      id: 'rt-contract-large',
      name: L('Крупный договор свыше 500 млн', '500 mln dan ortiq yirik shartnoma', 'Large contract over 500 mln'),
      priority: 10,
      active: true,
      conditions: { amountGt: 500 * MLN },
      steps: [
        step('s1', [role('legal'), role('accountant')], { mode: 'all', name: L('Юридическая и бухгалтерская проверка', 'Yuridik va buxgalteriya tekshiruvi', 'Legal and accounting review'), slaHours: 48 }),
        step('s2', [role('finance')], { slaHours: 48 }),
      ],
      boardThreshold: BLN,
      boardCommittee: 'board',
    }),
    tpl('payment', {
      id: 'rt-payment-50m',
      name: L('Платёж свыше 50 млн — второе подтверждение', "50 mln dan ortiq to'lov — ikkinchi tasdiq", 'Payment over 50 mln — second confirmation'),
      priority: 10,
      active: true,
      conditions: { amountGt: 50 * MLN },
      steps: [
        step('s1', [role('treasury')], { slaHours: 24 }),
        step('s2', [{ kind: 'departmentHead', departmentId: 'd3' }], { name: L('Начальник финансового департамента', 'Moliya departamenti boshlig‘i', 'Head of Finance'), slaHours: 24 }),
      ],
      distinctApprovers: true,
      boardThreshold: BLN,
      boardCommittee: 'board',
    }),
    tpl('budget_change', {
      id: 'rt-budget-5b',
      name: L('Изменение бюджета свыше 5 млрд — Правление', "5 mlrd dan ortiq byudjet o'zgarishi — Boshqaruv", 'Budget change over 5 bln — Board'),
      priority: 10,
      active: true,
      conditions: { amountGt: 5 * BLN },
      steps: [step('s1', [role('dept_head')]), step('s2', [role('finance')]), step('s3', [{ kind: 'committee', committee: 'board' }], { slaHours: 120 })],
      distinctApprovers: true,
    }),
    tpl('einvoice', {
      id: 'rt-einvoice-chain',
      name: L('ЭСФ: подразделение → бухгалтерия → руководство', "EHF: bo'linma → buxgalteriya → rahbariyat", 'E-invoice: department → accounting → management'),
      priority: 10,
      active: false,
      conditions: { amountGt: 1 * BLN },
      steps: [step('s1', [{ kind: 'initiatorHead' }]), step('s2', [role('accountant')]), step('s3', [role('finance')])],
    }),
    ...p2DocsTemplates(),
    ...p2WmsTemplates(),
    ...p2FinplanTemplates(),
    ...p2FleetTemplates(),
    ...p4MdmTemplates(),
  ];
  return [...base, ...variants, ...p2procTemplates(base)];
}

// P4 (PR-MDM-003): матрица согласования изменений номенклатуры по виду товара/услуги. Контекст: objectType
// (nomenclature | org_unit | cost_center), itemKind (goods | services | works), category (категория номенклатуры).
// Оргструктура и МВЗ — стандартный маршрут (администратор MDM). Изменяется в «Справочники → Матрица согласования».
function p4MdmTemplates(): RouteTemplate[] {
  const nom: FieldCondition = { field: 'objectType', op: 'eq', value: 'nomenclature' };
  const admin = (n: string) => step(n, [role('admin')], { name: L('Администратор MDM: утверждение', 'MDM administratori: tasdiqlash', 'MDM administrator: approval'), slaHours: 48 });
  const acc = (n: string) => step(n, [role('accountant')], { name: L('Бухгалтерия: счёт учёта', 'Buxgalteriya: hisob schyoti', 'Accounting: ledger account'), slaHours: 48 });
  return [
    tpl('mdm_change', {
      id: 'rt-mdm-goods',
      name: L('Номенклатура: товары', 'Nomenklatura: tovarlar', 'Nomenclature: goods'),
      priority: 10,
      active: true,
      conditions: { fields: [nom, { field: 'itemKind', op: 'eq', value: 'goods' }] },
      steps: [acc('s1'), admin('s2')],
      distinctApprovers: true,
      requireSignature: true,
    }),
    tpl('mdm_change', {
      id: 'rt-mdm-it',
      name: L('Номенклатура: ИТ-оборудование и ПО', 'Nomenklatura: AT uskunalari va DT', 'Nomenclature: IT hardware and software'),
      priority: 20,
      active: true,
      conditions: { fields: [nom, { field: 'category', op: 'in', value: ['it_hw', 'software'] }] },
      steps: [step('s1', [{ kind: 'departmentHead', departmentId: 'd1' }], { name: L('ДИТ: техническая экспертиза', 'ATD: texnik ekspertiza', 'IT Dept: technical review'), slaHours: 48 }), acc('s2'), admin('s3')],
      distinctApprovers: true,
      requireSignature: true,
    }),
    tpl('mdm_change', {
      id: 'rt-mdm-services',
      name: L('Номенклатура: услуги и работы', 'Nomenklatura: xizmatlar va ishlar', 'Nomenclature: services and works'),
      priority: 10,
      active: true,
      conditions: { fields: [nom, { field: 'itemKind', op: 'in', value: ['services', 'works'] }] },
      steps: [step('s1', [role('finance')], { name: L('Финансы: бюджетная статья', 'Moliya: byudjet moddasi', 'Finance: budget article'), slaHours: 48 }), admin('s2')],
      distinctApprovers: true,
      requireSignature: true,
    }),
  ];
}

// P2-PROC: маршруты закупок, заявок на обеспечение, договоров по видам, платежей SWIFT и актов выполненных работ.
// PR-PROC-015/018: в пределах лимита (≤ 20 млн) — полномочия департамента без финансов; ИТ-экспертиза и технадзор —
// по номенклатуре заявки (контекст needsIt / needsTech); свыше 1 млрд — Правление (порог шаблона).
// PR-REQ-009: заявка на обеспечение — руководитель; ИТ — ДИТ; свыше 5 млн — финансовый контроль бюджета.
function p2procTemplates(base: RouteTemplate[]): RouteTemplate[] {
  const proc = base.find((t) => t.entity === 'procurement');
  if (proc) {
    proc.steps = [
      step('s1', [role('dept_head')]),
      step('it', [{ kind: 'departmentHead', departmentId: 'd1' }], { name: L('ИТ-экспертиза (ДИТ)', 'AT ekspertizasi (ATD)', 'IT review (IT Dept)'), when: { fields: [{ field: 'needsIt', op: 'eq', value: 'yes' }, { field: 'departmentId', op: 'neq', value: 'd1' }] } }),
      step('tech', [{ kind: 'departmentHead', departmentId: 'd2' }], { name: L('Технический надзор (АХД)', 'Texnik nazorat (MXD)', 'Technical supervision (Admin Dept)'), when: { fields: [{ field: 'needsTech', op: 'eq', value: 'yes' }, { field: 'departmentId', op: 'neq', value: 'd2' }] } }),
      step('s2', [role('finance')], { when: { amountGt: 20 * MLN } }),
      step('s3', [role('procurement')]),
    ];
  }
  const req = base.find((t) => t.entity === 'employee_request');
  if (req) {
    req.steps = [
      step('s1', [role('dept_head')]),
      step('it', [{ kind: 'departmentHead', departmentId: 'd1' }], { name: L('ДИТ: ИТ-оборудование и ПО', 'ATD: AT uskunalari va DT', 'IT Dept: IT equipment and software'), when: { fields: [{ field: 'type', op: 'eq', value: 'it' }, { field: 'departmentId', op: 'neq', value: 'd1' }] } }),
      step('fin', [role('finance')], { name: L('Контроль бюджета', 'Byudjet nazorati', 'Budget control'), when: { amountGt: 5 * MLN } }),
    ];
  }
  return [
    tpl('contract', {
      id: 'rt-contract-construction',
      name: L('Строительство и ремонт: юрист → технадзор → финансы', 'Qurilish va ta’mir: yurist → texnik nazorat → moliya', 'Construction & repair: legal → technical → finance'),
      priority: 5,
      active: true,
      conditions: { subtypes: ['construction'] },
      steps: [step('s1', [role('legal')]), step('s2', [{ kind: 'departmentHead', departmentId: 'd2' }], { name: L('Технический надзор (АХД)', 'Texnik nazorat (MXD)', 'Technical supervision (Admin Dept)') }), step('s3', [role('finance')])],
      boardThreshold: BLN,
      boardCommittee: 'board',
    }),
    tpl('payment', {
      id: 'rt-payment-swift',
      name: L('Платёж SWIFT: казначейство → валютный контроль (финансы)', 'SWIFT to‘lovi: g‘aznachilik → valyuta nazorati', 'SWIFT payment: treasury → currency control'),
      priority: 15,
      active: true,
      conditions: { subtypes: ['swift'] },
      steps: [step('s1', [role('treasury')], { slaHours: 24 }), step('s2', [{ kind: 'departmentHead', departmentId: 'd3' }], { name: L('Валютный контроль (финансовый департамент)', 'Valyuta nazorati (moliya departamenti)', 'Currency control (Finance)'), slaHours: 24 })],
      distinctApprovers: true,
      boardThreshold: BLN,
      boardCommittee: 'board',
    }),
    tpl('work_act', {
      id: 'rt-work_act-std',
      name: L('Акт выполненных работ: заказчик → бухгалтерия', 'Bajarilgan ishlar dalolatnomasi: buyurtmachi → buxgalteriya', 'Work act: customer → accounting'),
      priority: 5,
      active: true,
      conditions: {},
      steps: [
        step('s1', [{ kind: 'initiatorHead' }], { name: L('Руководитель подразделения-заказчика', 'Buyurtmachi bo‘linma rahbari', 'Head of customer department') }),
        step('tech', [{ kind: 'departmentHead', departmentId: 'd2' }], { name: L('Технический надзор (АХД)', 'Texnik nazorat (MXD)', 'Technical supervision (Admin Dept)'), when: { subtypes: ['construction'] } }),
        step('s2', [role('accountant')], { name: L('Бухгалтерия: соответствие договору', 'Buxgalteriya: shartnomaga muvofiqlik', 'Accounting: contract compliance') }),
      ],
    }),
  ];
}

/** P2-FLT: автопарк (4.2.6) — подпись диспетчера путевого листа, распоряжение о закреплении ТС, зачисление на топливные карты. */
function p2FleetTemplates(): RouteTemplate[] {
  // Диспетчер: руководитель АХД (d2) или любой руководитель подразделения — достаточно одного (инициатор не согласует сам).
  const dispatcher: ApproverSpec[] = [{ kind: 'departmentHead', departmentId: 'd2' }, role('dept_head')];
  return [
    tpl('fleet_trip', {
      id: 'rt-fleet-trip-dispatch',
      name: L('Путевой лист: подпись диспетчера', "Yo'l varaqasi: dispetcher imzosi", 'Waybill: dispatcher signature'),
      priority: 10,
      active: true,
      conditions: {},
      steps: [step('s1', dispatcher, { mode: 'any', name: L('Диспетчер (АХД)', "Dispetcher (MXD)", 'Dispatcher (Facilities)'), slaHours: 4 })],
    }),
    tpl('fleet_assignment', {
      id: 'rt-fleet-assignment',
      name: L('Закрепление ТС: АХД → кадры (приказ); доверенность — юрист', "TV biriktirish: MXD → kadrlar (buyruq); ishonchnoma — yurist", 'Vehicle assignment: Facilities → HR (order); power of attorney — Legal'),
      priority: 10,
      active: true,
      conditions: {},
      steps: [
        step('s1', dispatcher, { mode: 'any', name: L('Руководитель АХД', 'MXD rahbari', 'Head of Facilities'), slaHours: 24 }),
        step('s2', [role('hr')], { name: L('Кадровая служба: приказ', 'Kadrlar xizmati: buyruq', 'HR: order'), slaHours: 48, when: { subtypes: ['order'] } }),
        step('s3', [role('legal')], { name: L('Юрист: доверенность', 'Yurist: ishonchnoma', 'Legal: power of attorney'), slaHours: 48, when: { subtypes: ['power_of_attorney'] } }),
      ],
    }),
    tpl('fleet_topup', {
      id: 'rt-fleet-topup',
      name: L('Зачисление на топливные карты: АХД → бухгалтерия; свыше 50 млн — финансы', "Yoqilg'i kartalariga o'tkazish: MXD → buxgalteriya; 50 mln dan ortiq — moliya", 'Fuel card top-up: Facilities → Accounting; over 50 mln — Finance'),
      priority: 10,
      active: true,
      conditions: {},
      steps: [
        step('s1', dispatcher, { mode: 'any', name: L('Руководитель АХД', 'MXD rahbari', 'Head of Facilities'), slaHours: 24 }),
        step('s2', [role('accountant')], { slaHours: 24 }),
        step('s3', [role('finance')], { slaHours: 24, when: { amountGt: 50 * MLN } }),
      ],
      distinctApprovers: true,
    }),
  ];
}

// P2-DOCS: маршруты документов модулей ЭСФ (4.2.3), СЭД (4.2.9), архива (4.2.10), командировок (4.2.11).
function p2DocsTemplates(): RouteTemplate[] {
  const chiefAccountant: ApproverSpec = { kind: 'departmentHead', departmentId: 'd7' };
  return [
    tpl('einvoice', {
      id: 'rt-einvoice-p2-incoming',
      name: L('Входящий ЭСФ/акт: главный бухгалтер → руководство ЦА', "Kiruvchi EHF/dalolatnoma: bosh buxgalter → MA rahbariyati", 'Incoming invoice/act: chief accountant → management'),
      priority: 15,
      active: true,
      conditions: { fields: [{ field: 'direction', op: 'eq', value: 'incoming' }] },
      steps: [
        step('s1', [chiefAccountant], { name: L('Главный бухгалтер: проверка и проводки', 'Bosh buxgalter: tekshiruv va provodkalar', 'Chief accountant: review and postings'), slaHours: 48 }),
        step('s2', [role('finance')], { name: L('Руководство центрального аппарата', 'Markaziy apparat rahbariyati', 'Head office management'), slaHours: 48, when: { amountGt: 100 * MLN } }),
      ],
      distinctApprovers: true,
    }),
    tpl('einvoice', {
      id: 'rt-einvoice-p2-reconciliation',
      name: L('Акт сверки: бухгалтерия', 'Solishtirma dalolatnomasi: buxgalteriya', 'Reconciliation act: accounting'),
      priority: 20,
      active: true,
      conditions: { subtypes: ['reconciliation_act'] },
      steps: [step('s1', [role('accountant')], { name: L('Бухгалтерия: сверка взаиморасчётов', "Buxgalteriya: o'zaro hisob-kitoblarni solishtirish", 'Accounting: settlement reconciliation'), slaHours: 48 })],
    }),
    tpl('business_trip', {
      id: 'rt-business_trip-p2-application',
      name: L('Командировка: руководитель → HR → финансы', 'Xizmat safari: rahbar → HR → moliya', 'Business trip: manager → HR → finance'),
      priority: 15,
      active: true,
      conditions: { subtypes: ['application'] },
      steps: [
        step('s1', [{ kind: 'initiatorHead' }], { name: L('Руководитель', 'Rahbar', 'Manager'), slaHours: 24 }),
        step('s2', [role('hr')], { name: L('HR: кадровая проверка', 'HR: kadrlar tekshiruvi', 'HR check'), slaHours: 24 }),
        step('s3', [role('finance')], { name: L('Финансы: бюджетный лимит', 'Moliya: byudjet limiti', 'Finance: budget limit'), slaHours: 24 }),
      ],
      distinctApprovers: true,
    }),
    tpl('business_trip', {
      id: 'rt-business_trip-p2-report',
      name: L('Авансовый отчёт: HR → бухгалтерия', "Avans hisoboti: HR → buxgalteriya", 'Expense report: HR → accounting'),
      priority: 15,
      active: true,
      conditions: { subtypes: ['report'] },
      steps: [
        step('s1', [role('hr')], { name: L('HR: проверка норм и лимитов', 'HR: me’yor va limitlarni tekshirish', 'HR: norms and limits check'), slaHours: 48 }),
        step('s2', [role('accountant')], { name: L('Бухгалтерия: окончательный расчёт', 'Buxgalteriya: yakuniy hisob-kitob', 'Accounting: final settlement'), slaHours: 48 }),
      ],
    }),
    tpl('document', {
      id: 'rt-document-p2-outgoing',
      name: L('Исходящий документ: руководитель → юрист', 'Chiquvchi hujjat: rahbar → yurist', 'Outgoing document: manager → legal'),
      priority: 15,
      active: true,
      conditions: { fields: [{ field: 'kind', op: 'eq', value: 'outgoing' }] },
      steps: [step('s1', [{ kind: 'initiatorHead' }]), step('s2', [role('legal')], { name: L('Юридическая проверка', 'Yuridik tekshiruv', 'Legal review'), slaHours: 48 })],
    }),
    tpl('document', {
      id: 'rt-document-p2-order',
      name: L('Приказ / распоряжение: руководитель → юрист → АХД', 'Buyruq / farmoyish: rahbar → yurist → MXD', 'Order / instruction: manager → legal → administration'),
      priority: 20,
      active: true,
      conditions: { subtypes: ['order', 'instruction'] },
      steps: [
        step('s1', [{ kind: 'initiatorHead' }]),
        step('s2', [role('legal')], { name: L('Юридическая экспертиза', 'Yuridik ekspertiza', 'Legal review'), slaHours: 48 }),
        step('s3', [{ kind: 'departmentHead', departmentId: 'd2' }], { name: L('Регистрация и рассылка (АХД)', "Ro'yxatga olish va tarqatish (MXD)", 'Registration and distribution'), slaHours: 24 }),
      ],
      distinctApprovers: true,
    }),
    tpl('doc_payment', {
      id: 'rt-doc_payment-p2-50m',
      name: L('Оплата по документу свыше 50 млн — начальник департамента', "50 mln dan ortiq to'lov — departament boshlig'i", 'Document payment over 50 mln — head of department'),
      priority: 10,
      active: true,
      conditions: { amountGt: 50 * MLN },
      steps: [step('s1', [{ kind: 'initiatorHead' }], { name: L('Второе подтверждение: начальник департамента', "Ikkinchi tasdiq: departament boshlig'i", 'Second confirmation: head of department'), slaHours: 24 })],
    }),
    tpl('archive_act', {
      id: 'rt-archive_act-p2-destruction',
      name: L('Акт уничтожения: ЭПК → руководитель АХД', 'Yo‘q qilish dalolatnomasi: EPK → MXD rahbari', 'Destruction act: expert commission → head of administration'),
      priority: 10,
      active: true,
      conditions: { subtypes: ['destruction'] },
      steps: [
        step('s1', [role('legal'), role('accountant')], { mode: 'all', name: L('Экспертно-проверочная комиссия', 'Ekspert-tekshiruv komissiyasi', 'Expert review commission'), slaHours: 72 }),
        step('s2', [{ kind: 'departmentHead', departmentId: 'd2' }], { name: L('Утверждение руководителем АХД', 'MXD rahbari tasdig‘i', 'Approval by head of administration'), slaHours: 48 }),
      ],
      distinctApprovers: true,
    }),
    tpl('archive_act', {
      id: 'rt-archive_act-p2-state',
      name: L('Передача в госархив: юрист → руководитель АХД', 'Davlat arxiviga topshirish: yurist → MXD rahbari', 'State archive transfer: legal → head of administration'),
      priority: 10,
      active: true,
      conditions: { subtypes: ['state_transfer'] },
      steps: [
        step('s1', [role('legal')], { name: L('Юридическая проверка описи', 'Ro‘yxatni yuridik tekshirish', 'Legal review of inventory'), slaHours: 72 }),
        step('s2', [{ kind: 'departmentHead', departmentId: 'd2' }], { name: L('Утверждение руководителем АХД', 'MXD rahbari tasdig‘i', 'Approval by head of administration'), slaHours: 48 }),
      ],
    }),
  ];
}

/** P2-WMS: маршруты склада (заявка на выдачу, акт списания) и ОС (передача, продажа по решению Правления). */
// P2-FINPLAN: маршруты бюджетных документов (ТЗ 4.2.13): ZBB-пакеты (уровни одобрения по сумме),
// подтверждение превышения лимита при soft-check (руководитель инициатора → финансы; крупное — Правление),
// заявки CAPEX/крупных закупок/инвестиций.
function p2FinplanTemplates(): RouteTemplate[] {
  return [
    tpl('budget_zbb', {
      id: 'rt-budget_zbb-levels',
      name: L('ZBB-пакет: руководитель → финансы (свыше 50 млрд — Правление)', 'ZBB paketi: rahbar → moliya (50 mlrd dan ortiq — Boshqaruv)', 'ZBB package: head → finance (over 50 bln — Board)'),
      priority: 10,
      active: true,
      conditions: {},
      steps: [
        step('s1', [{ kind: 'initiatorHead' }], { name: L('Руководитель подразделения-инициатора', 'Tashabbuskor bo‘linma rahbari', 'Head of initiating unit') }),
        step('s2', [role('finance')], { name: L('Финансовый департамент (экономическая экспертиза)', 'Moliya departamenti (iqtisodiy ekspertiza)', 'Finance (economic review)') }),
      ],
      distinctApprovers: true,
      boardThreshold: 50 * BLN,
      boardCommittee: 'board',
    }),
    tpl('budget_overrun', {
      id: 'rt-budget_overrun-soft',
      name: L('Soft-check: подтверждение руководителя → финансы (свыше 1 млрд — Правление)', 'Soft-check: rahbar tasdig‘i → moliya (1 mlrd dan ortiq — Boshqaruv)', 'Soft-check: manager confirmation → finance (over 1 bln — Board)'),
      priority: 10,
      active: true,
      conditions: {},
      steps: [
        step('s1', [{ kind: 'initiatorHead' }], { name: L('Ответственный руководитель (электронное подтверждение)', 'Mas’ul rahbar (elektron tasdiq)', 'Responsible manager (e-confirmation)'), slaHours: 24 }),
        step('s2', [role('finance')], { name: L('Финансовый контроль', 'Moliyaviy nazorat', 'Financial control'), slaHours: 24 }),
      ],
      distinctApprovers: true,
      boardThreshold: BLN,
      boardCommittee: 'board',
    }),
    tpl('capex_request', {
      id: 'rt-capex_request-levels',
      name: L('CAPEX/инвестиции: руководитель → финансы (свыше 10 млрд — Правление)', 'CAPEX/investitsiyalar: rahbar → moliya (10 mlrd dan ortiq — Boshqaruv)', 'CAPEX/investments: head → finance (over 10 bln — Board)'),
      priority: 10,
      active: true,
      conditions: {},
      steps: [step('s1', [{ kind: 'initiatorHead' }]), step('s2', [role('finance')])],
      distinctApprovers: true,
      boardThreshold: 10 * BLN,
      boardCommittee: 'board',
    }),
  ];
}

function p2WmsTemplates(): RouteTemplate[] {
  return [
    tpl('warehouse_issue', {
      id: 'rt-warehouse_issue-cbu',
      name: L('Заявка на выдачу: руководитель ЦБУ (свыше 50 млн — АХД)', 'Berish arizasi: BXM rahbari (50 mln dan ortiq — MXD)', 'Issue request: branch head (over 50 mln — admin dept)'),
      priority: 5,
      active: true,
      conditions: {},
      steps: [
        step('s1', [{ kind: 'initiatorHead' }], { name: L('Руководитель ЦБУ / подразделения', 'BXM / bo‘linma rahbari', 'Branch / unit head'), slaHours: 24 }),
        step('s2', [{ kind: 'departmentHead', departmentId: 'd2' }], { name: L('Административно-хозяйственный департамент', "Ma'muriy-xo'jalik departamenti", 'Administration department'), when: { amountGt: 50 * MLN } }),
      ],
      distinctApprovers: true,
    }),
    tpl('warehouse_writeoff', {
      id: 'rt-warehouse_writeoff-amount',
      name: L('Акт списания: бухгалтерия (свыше 50 млн — финансы)', 'Hisobdan chiqarish: buxgalteriya (50 mln dan ortiq — moliya)', 'Write-off act: accounting (over 50 mln — finance)'),
      priority: 5,
      active: true,
      conditions: {},
      steps: [step('s1', [role('accountant')], { name: L('Главная бухгалтерия', 'Bosh buxgalteriya', 'Chief accountant') }), step('s2', [role('finance')], { when: { amountGt: 50 * MLN } })],
      distinctApprovers: true,
    }),
    tpl('asset_writeoff', {
      id: 'rt-asset_writeoff-sale',
      name: L('Продажа ОС — решение Правления', 'AV sotish — Boshqaruv qarori', 'Asset sale — Board decision'),
      priority: 10,
      active: true,
      conditions: { subtypes: ['sale'] },
      steps: [step('s1', [role('dept_head')]), step('s2', [role('accountant')]), step('s3', [{ kind: 'committee', committee: 'board' }], { name: L('Решение Правления банка', 'Bank Boshqaruvi qarori', 'Management Board decision'), slaHours: 120 })],
      distinctApprovers: true,
    }),
    tpl('asset_transfer', {
      id: 'rt-asset_transfer-branch',
      name: L('Межфилиальная передача (с баланса на баланс)', 'Filiallararo topshirish (balansdan balansga)', 'Inter-branch transfer (balance to balance)'),
      priority: 10,
      active: true,
      conditions: { subtypes: ['branch'] },
      steps: [step('s1', [role('dept_head')]), step('s2', [role('accountant')]), step('s3', [role('finance')])],
      distinctApprovers: true,
    }),
  ];
}

function defaultCommittees(): Committee[] {
  return [
    { id: 'board', name: L('Правление банка', 'Bank Boshqaruvi', 'Management Board'), memberIds: ['u4', 'u6'], slaHours: 120 },
    { id: 'credit_committee', name: L('Кредитный комитет', "Kredit qo'mitasi", 'Credit Committee'), memberIds: ['u4', 'u8'], slaHours: 120 },
  ];
}

const defaultBulk = (): BulkPolicy => ({ entities: ['employee_request', 'document', 'business_trip'], maxAmount: 10 * MLN });

// ---------------------------------------------------------------------------------------------
// Состояние

const handlers = new Map<ApprovalEntity, ApprovalHandler>();
const moduleSeeds: ApprovalTask[] = [];
let tasks: ApprovalTaskV2[] = [];
let instances: RouteInstance[] = [];
let events: RouteEvent[] = [];
let templates: RouteTemplate[] = defaultTemplates();
let committees: Committee[] = defaultCommittees();
let delegations: Delegation[] = [];
let bulkPolicy: BulkPolicy = defaultBulk();

const nowMs = () => Date.now();
const addHours = (h: number, from = nowMs()) => new Date(from + h * 3_600_000).toISOString();
const todayStr = () => now().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Маршрутизация

function amountUzs(amount: number | undefined, currency: ApprovalTask['currency']): number | undefined {
  return amount === undefined ? undefined : Math.round(amount * ROUTE_RATES[currency ?? 'UZS']);
}

function buildContext(input: Pick<OpenTaskInput, 'entity' | 'entityId' | 'requesterId' | 'amount' | 'currency' | 'context'>): RouteContext {
  const requester = directory.user(input.requesterId);
  const fromHandler = input.entityId ? handlers.get(input.entity)?.getContext?.(input.entityId) : undefined;
  const ctx: RouteContext = {
    ...(requester ? { departmentId: requester.departmentId } : {}),
    ...(directory.branchOf(requester) ? { branchId: directory.branchOf(requester) } : {}),
    ...(fromHandler ?? {}),
    ...(input.context ?? {}),
    requesterId: input.requesterId,
  };
  const amount = (input.amount ?? (typeof ctx.amount === 'number' ? ctx.amount : undefined)) as number | undefined;
  const currency = (input.currency ?? ctx.currency) as RouteContext['currency'];
  if (amount !== undefined) {
    ctx.amount = amount;
    ctx.amountUzs = amountUzs(amount, currency);
  }
  if (currency) ctx.currency = currency;
  const sub = ctx.subtype ?? ctx.method ?? ctx.type ?? ctx.kind;
  if (sub !== undefined) ctx.subtype = String(sub);
  return ctx;
}

function fieldMatch(c: FieldCondition, ctx: RouteContext): boolean {
  const v = ctx[c.field];
  const num = typeof v === 'number' ? v : Number(v);
  const cv = c.value;
  switch (c.op) {
    case 'eq':
      return String(v ?? '') === String(cv);
    case 'neq':
      return String(v ?? '') !== String(cv);
    case 'in':
      return (Array.isArray(cv) ? cv : String(cv).split(',').map((s) => s.trim())).includes(String(v ?? ''));
    case 'contains':
      return String(v ?? '').toLowerCase().includes(String(cv).toLowerCase());
    case 'gt':
      return num > Number(cv);
    case 'gte':
      return num >= Number(cv);
    case 'lt':
      return num < Number(cv);
    case 'lte':
      return num <= Number(cv);
  }
}

export function conditionMatches(c: RouteCondition | undefined, ctx: RouteContext): boolean {
  if (!c) return true;
  const amt = ctx.amountUzs ?? 0;
  if (c.amountGt !== undefined && !(amt > c.amountGt)) return false;
  if (c.amountLte !== undefined && !(amt <= c.amountLte)) return false;
  if (c.subtypes?.length && !c.subtypes.includes(String(ctx.subtype ?? ''))) return false;
  if (c.departmentIds?.length && !c.departmentIds.includes(String(ctx.departmentId ?? ''))) return false;
  if (c.branchIds?.length && !c.branchIds.includes(String(ctx.branchId ?? ''))) return false;
  return (c.fields ?? []).every((f) => fieldMatch(f, ctx));
}

const conditionWeight = (c: RouteCondition) =>
  (c.amountGt !== undefined ? 1 : 0) + (c.amountLte !== undefined ? 1 : 0) + (c.subtypes?.length ? 1 : 0) + (c.departmentIds?.length ? 1 : 0) + (c.branchIds?.length ? 1 : 0) + (c.fields?.length ?? 0);

function pickTemplate(entity: ApprovalEntity, ctx: RouteContext): RouteTemplate | undefined {
  return templates
    .filter((t) => t.entity === entity && t.active && conditionMatches(t.conditions, ctx))
    .sort((a, b) => b.priority - a.priority || conditionWeight(b.conditions) - conditionWeight(a.conditions))[0];
}

function committeeOf(id: CommitteeId): Committee | undefined {
  return committees.find((c) => c.id === id);
}

const without = (ids: ID[], x: ID | undefined) => ids.filter((i) => i !== x);

function resolveApprover(spec: ApproverSpec, ctx: RouteContext): ResolvedApprover {
  const initiator = ctx.requesterId;
  const names = (ids: ID[]) => ids.map((i) => directory.user(i)?.fullName ?? i);
  const byRoleFallback = (r: Role, fallback = true): ResolvedApprover => ({ spec, role: r, names: names(without(directory.byRole(r).map((u) => u.id), initiator)), ...(fallback ? { fallback: true } : {}) });
  const toUsers = (ids: ID[], r?: Role): ResolvedApprover | undefined => {
    const list = without([...new Set(ids)], initiator);
    if (!list.length) return undefined;
    return { spec, role: r ?? directory.user(list[0])?.role ?? 'employee', userIds: list, names: names(list) };
  };
  const managerFallback = (): ResolvedApprover => {
    const m = directory.managerOf(directory.user(initiator));
    if (m && m.id !== initiator) return { ...toUsers([m.id])!, fallback: true };
    const admins = toUsers(directory.admins().map((u) => u.id), 'admin');
    return admins ? { ...admins, fallback: true } : byRoleFallback('admin');
  };
  switch (spec.kind) {
    case 'role':
      return { spec, role: spec.role, names: names(without(directory.byRole(spec.role).map((u) => u.id), initiator)) };
    case 'user':
      return toUsers([spec.userId]) ?? managerFallback();
    case 'initiatorHead': {
      const head = directory.headOf(directory.user(initiator)?.departmentId ?? (ctx.departmentId as ID | undefined));
      if (head && head.id !== initiator) return toUsers([head.id], 'dept_head')!;
      const m = directory.managerOf(directory.user(initiator));
      if (m && m.id !== initiator) return { ...toUsers([m.id], 'dept_head')!, fallback: true };
      return byRoleFallback('dept_head');
    }
    case 'departmentHead': {
      const head = directory.headOf(spec.departmentId);
      return (head && toUsers([head.id])) || managerFallback();
    }
    case 'branchRole': {
      const branch = ctx.branchId;
      const inBranch = branch ? directory.byRole(spec.role).filter((u) => directory.branchOf(u) === branch).map((u) => u.id) : [];
      return toUsers(inBranch, spec.role) ?? byRoleFallback(spec.role);
    }
    case 'committee': {
      const c = committeeOf(spec.committee);
      return toUsers(c?.memberIds ?? []) ?? managerFallback();
    }
  }
}

function resolveSteps(entity: ApprovalEntity, ctx: RouteContext, template = pickTemplate(entity, ctx)): { template?: RouteTemplate; steps: RoutePreviewStep[] } {
  const raw: RouteStepTemplate[] = template ? template.steps.filter((s) => conditionMatches(s.when, ctx)) : ROUTES[entity].map((r, i) => step(`s${i + 1}`, [role(r)]));
  const out: RoutePreviewStep[] = raw.map((s, i) => ({
    index: i + 1,
    ...(s.name ? { name: s.name } : {}),
    approvers: s.approvers.map((a) => resolveApprover(a, ctx)),
    mode: s.approvers.length > 1 ? (s.mode ?? 'all') : 'all',
    slaHours: s.slaHours ?? 72,
    ...(s.approvers.length === 1 && s.approvers[0]!.kind === 'committee' ? { committee: (s.approvers[0] as { committee: CommitteeId }).committee } : {}),
  }));
  if (template?.boardThreshold !== undefined && (ctx.amountUzs ?? 0) > template.boardThreshold) {
    const cid = template.boardCommittee ?? 'board';
    const c = committeeOf(cid);
    out.push({ index: out.length + 1, ...(c ? { name: c.name } : {}), approvers: [resolveApprover({ kind: 'committee', committee: cid }, ctx)], mode: 'all', slaHours: c?.slaHours ?? 120, committee: cid });
  }
  return { ...(template ? { template } : {}), steps: out };
}

// ---------------------------------------------------------------------------------------------
// Видимость, заместители, SoD

function activeDelegationsTo(deputyId: ID, entity?: ApprovalEntity): Delegation[] {
  const d = todayStr();
  return delegations.filter((x) => x.active && x.deputyId === deputyId && x.from <= d && d <= x.to && (!entity || !x.entities?.length || x.entities.includes(entity)));
}

function directlyAssigned(user: User, task: ApprovalTaskV2): boolean {
  if (task.escalatedTo?.includes(user.id)) return true;
  if (task.assigneeIds?.length) return task.assigneeIds.includes(user.id);
  return directory.hasRole(user, task.assigneeRole);
}

/** Кто может действовать по задаче: сам пользователь, админ или заместитель (onBehalfOf). */
function authority(user: User, task: ApprovalTaskV2): { ok: boolean; onBehalfOf?: ID; direct: boolean } {
  if (directlyAssigned(user, task)) return { ok: true, direct: true };
  for (const d of activeDelegationsTo(user.id, task.entity)) {
    const principal = directory.user(d.userId);
    if (principal && principal.id !== user.id && directlyAssigned(principal, task)) return { ok: true, onBehalfOf: principal.id, direct: false };
  }
  if (directory.hasRole(user, 'admin')) return { ok: true, direct: true };
  return { ok: false, direct: false };
}

function instanceOf(task: ApprovalTaskV2): RouteInstance | undefined {
  return task.instanceId ? instances.find((i) => i.id === task.instanceId) : undefined;
}

function sodBlock(user: User, task: ApprovalTaskV2, onBehalfOf?: ID): 'sod_initiator' | 'sod_repeat' | undefined {
  if (user.id === task.requesterId || onBehalfOf === task.requesterId) return 'sod_initiator';
  const inst = instanceOf(task);
  if (inst?.distinctApprovers) {
    const who = new Set([user.id, ...(onBehalfOf ? [onBehalfOf] : [])]);
    const already = inst.steps.some((s) => s.index !== task.step && s.decisions.some((d) => d.decision === 'approved' && (who.has(d.userId) || (d.onBehalfOf && who.has(d.onBehalfOf)))));
    if (already) return 'sod_repeat';
  }
  return undefined;
}

function isLowRisk(task: ApprovalTaskV2): boolean {
  if (!bulkPolicy.entities.includes(task.entity)) return false;
  const amt = amountUzs(task.amount, task.currency);
  return amt === undefined || amt <= bulkPolicy.maxAmount;
}

// ---------------------------------------------------------------------------------------------
// Жизненный цикл маршрута

function entityLink(entity: ApprovalEntity, entityId: ID): string {
  // Ссылки на документы знает web (lib/approvalLinks.ts); здесь — ссылка на очередь с фильтром.
  return `/approvals?entity=${entity}&doc=${encodeURIComponent(entityId)}`;
}

function record(inst: RouteInstance, e: Omit<RouteEvent, 'id' | 'instanceId' | 'entity' | 'entityId' | 'number' | 'title' | 'cycle' | 'at'> & { at?: string }): RouteEvent {
  const ev: RouteEvent = { id: nextId('ev'), instanceId: inst.id, entity: inst.entity, entityId: inst.entityId, number: inst.number, title: inst.title, cycle: inst.cycle, at: e.at ?? now(), ...e };
  events.push(ev);
  return ev;
}

function toHistory(userId: ID, action: HistoryEvent['action'], comment?: string, onBehalfOf?: ID): HistoryEvent {
  return { ...historyEvent(userId, action, comment), ...(onBehalfOf ? { onBehalfOf } : {}) };
}

function recipientsOf(task: ApprovalTaskV2): ID[] {
  const base = task.assigneeIds?.length ? task.assigneeIds : directory.byRole(task.assigneeRole).map((u) => u.id);
  return without(base, task.requesterId);
}

function notifyTask(task: ApprovalTaskV2): void {
  const ids = recipientsOf(task);
  // заместители тоже получают задачу
  const deputies = delegations.filter((d) => d.active && ids.includes(d.userId) && d.from <= todayStr() && todayStr() <= d.to && (!d.entities?.length || d.entities.includes(task.entity))).map((d) => d.deputyId);
  notify({
    userIds: [...ids, ...deputies],
    excludeIds: [task.requesterId],
    kind: 'task',
    level: 'info',
    title: { key: 'flow_n_task', params: { number: task.number } },
    body: { key: 'flow_n_task_body', params: { entity: { key: `entity_${task.entity}` }, title: task.title, step: String(task.step), total: String(task.totalSteps) } },
    link: entityLink(task.entity, task.entityId),
    dedupeKey: `task:${task.id}`,
  });
}

function makeTask(inst: RouteInstance, s: ResolvedStep, a: ResolvedApprover): ApprovalTaskV2 {
  return {
    id: nextId('a'),
    entity: inst.entity,
    entityId: inst.entityId,
    title: inst.title,
    number: inst.number,
    ...(inst.amount !== undefined ? { amount: inst.amount } : {}),
    ...(inst.currency ? { currency: inst.currency } : {}),
    requesterId: inst.requesterId,
    assigneeRole: a.role,
    step: s.index,
    totalSteps: inst.steps.length,
    createdAt: now(),
    dueAt: s.dueAt ?? addHours(s.slaHours),
    status: 'pending',
    instanceId: inst.id,
    ...(a.userIds ? { assigneeIds: [...a.userIds] } : {}),
    slaHours: s.slaHours,
    ...(s.name ? { stepName: s.name } : {}),
    approver: a.spec,
  };
}

function activateStep(inst: RouteInstance, index: number): ApprovalTaskV2 | undefined {
  const s = inst.steps[index - 1];
  if (!s) return undefined;
  inst.currentStep = index;
  s.state = 'current';
  s.startedAt = now();
  s.dueAt = addHours(s.slaHours);
  const created = s.approvers.map((a) => makeTask(inst, s, a));
  tasks.push(...created);
  created.forEach(notifyTask);
  return created[0];
}

function fromPreview(p: RoutePreviewStep): ResolvedStep {
  return { ...clone(p), state: 'pending', decisions: [] };
}

function latestInstance(entityId: ID): RouteInstance | undefined {
  for (let i = instances.length - 1; i >= 0; i--) if (instances[i]!.entityId === entityId) return instances[i];
  return undefined;
}

function startInstance(input: OpenTaskInput, startStep = 1): ApprovalTaskV2 | undefined {
  const prior = latestInstance(input.entityId);
  const ctx = buildContext(input);
  const { template, steps } = resolveSteps(input.entity, ctx);
  if (!steps.length) return undefined;
  const inst: RouteInstance = {
    id: nextId('ri'),
    entity: input.entity,
    entityId: input.entityId,
    number: input.number,
    title: input.title,
    requesterId: input.requesterId,
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(template ? { templateId: template.id, templateVersion: template.version, templateName: template.name } : {}),
    cycle: prior ? prior.cycle + 1 : 1,
    status: 'in_progress',
    steps: steps.map(fromPreview),
    currentStep: startStep,
    distinctApprovers: !!template?.distinctApprovers,
    context: ctx,
    createdAt: now(),
  };
  if (prior && prior.status === 'in_progress') {
    // повторное открытие поверх незавершённого маршрута: старые задачи закрываются
    closeSiblings(prior, undefined, 'cancelled');
    prior.status = 'rejected';
    prior.finishedAt = now();
  }
  for (let i = 1; i < startStep; i++) inst.steps[i - 1]!.state = 'done';
  instances.push(inst);
  record(inst, { actorId: input.requesterId, action: prior && prior.status !== 'approved' ? 'resubmitted' : 'submitted' });
  return activateStep(inst, startStep);
}

function closeSiblings(inst: RouteInstance, keep: ApprovalTaskV2 | undefined, outcome: 'skipped' | 'cancelled'): void {
  for (const t of tasks) {
    if (t.instanceId === inst.id && t.status === 'pending' && t !== keep) {
      t.status = outcome === 'skipped' ? 'approved' : 'rejected';
      t.outcome = outcome;
      t.decidedAt = now();
    }
  }
}

/** Демо-задачи модулей (без маршрута) — построить маршрут, совместимый с v1 (шаги до текущего считаются пройденными). */
function adoptLegacy(task: ApprovalTaskV2): void {
  if (task.instanceId) return;
  const ctx = buildContext({ entity: task.entity, entityId: task.entityId, requesterId: task.requesterId, ...(task.amount !== undefined ? { amount: task.amount } : {}), ...(task.currency ? { currency: task.currency } : {}) });
  const candidates = templates.filter((t) => t.entity === task.entity && t.active && conditionMatches(t.conditions, ctx)).sort((a, b) => b.priority - a.priority);
  let chosen: { template?: RouteTemplate; steps: RoutePreviewStep[] } | undefined;
  for (const t of candidates) {
    const r = resolveSteps(task.entity, ctx, t);
    if (r.steps.length === task.totalSteps && r.steps[task.step - 1]?.approvers.some((a) => a.role === task.assigneeRole)) {
      chosen = r;
      break;
    }
  }
  if (!chosen) {
    const def = templates.find((t) => t.id === `rt-${task.entity}-default`);
    const r = def ? resolveSteps(task.entity, ctx, { ...def, boardThreshold: undefined } as RouteTemplate) : resolveSteps(task.entity, ctx, undefined);
    chosen = r.steps.length === task.totalSteps ? r : { steps: Array.from({ length: task.totalSteps }, (_, i) => ({ index: i + 1, approvers: [resolveApprover(role(i + 1 === task.step ? task.assigneeRole : (ROUTES[task.entity][i] ?? task.assigneeRole)), ctx)], mode: 'all' as const, slaHours: 72 })) };
  }
  const inst: RouteInstance = {
    id: nextId('ri'),
    entity: task.entity,
    entityId: task.entityId,
    number: task.number,
    title: task.title,
    requesterId: task.requesterId,
    ...(task.amount !== undefined ? { amount: task.amount } : {}),
    ...(task.currency ? { currency: task.currency } : {}),
    ...(chosen.template ? { templateId: chosen.template.id, templateVersion: chosen.template.version, templateName: chosen.template.name } : {}),
    cycle: 1,
    status: 'in_progress',
    steps: chosen.steps.map(fromPreview),
    currentStep: task.step,
    distinctApprovers: !!chosen.template?.distinctApprovers,
    context: ctx,
    createdAt: task.createdAt,
    legacy: true,
  };
  inst.steps.forEach((s) => {
    if (s.index < task.step) s.state = 'done';
    if (s.index === task.step) {
      s.state = 'current';
      s.startedAt = task.createdAt;
      s.dueAt = task.dueAt;
    }
  });
  instances.push(inst);
  task.instanceId = inst.id;
  task.slaHours = inst.steps[task.step - 1]?.slaHours ?? 72;
  const sn = inst.steps[task.step - 1]?.name;
  if (sn) task.stepName = sn;
}

function adoptAll(list: ApprovalTaskV2[]): void {
  list.filter((t) => t.status === 'pending').forEach(adoptLegacy);
}

function finishStepIfComplete(inst: RouteInstance, s: ResolvedStep, task: ApprovalTaskV2): void {
  if (s.mode === 'any' || s.approvers.length === 1) closeSiblings(inst, task, 'skipped');
  const open = tasks.some((t) => t.instanceId === inst.id && t.step === s.index && t.status === 'pending');
  if (open) return;
  s.state = 'done';
  s.finishedAt = now();
  const handler = handlers.get(inst.entity);
  if (s.index >= inst.steps.length) {
    inst.status = 'approved';
    inst.finishedAt = now();
    handler?.onFinal(inst.entityId, true);
    notify({ userIds: [inst.requesterId], kind: 'approved', level: 'success', title: { key: 'flow_n_approved', params: { number: inst.number } }, body: { key: 'flow_n_doc_body', params: { entity: { key: `entity_${inst.entity}` }, title: inst.title } }, link: entityLink(inst.entity, inst.entityId) });
  } else activateStep(inst, s.index + 1);
}

// ---------------------------------------------------------------------------------------------
// Публичный движок

export const approvalEngine = {
  /** Сброс к демо-состоянию: задачи ядра + задачи, засеянные модулями; шаблоны и заместители — по умолчанию. */
  reset(coreSeed: ApprovalTask[]): void {
    tasks = clone([...coreSeed, ...moduleSeeds]);
    instances = [];
    events = [];
    templates = defaultTemplates();
    committees = defaultCommittees();
    delegations = [];
    bulkPolicy = defaultBulk();
    adoptAll(tasks);
  },

  /** Модуль добавляет свои демо-задачи (вызывается при загрузке модуля). */
  seed(list: ApprovalTask[]): void {
    moduleSeeds.push(...clone(list));
    const copy = clone(list) as ApprovalTaskV2[];
    tasks.push(...copy);
    adoptAll(copy);
  },

  register(entity: ApprovalEntity, handler: ApprovalHandler): void {
    handlers.set(entity, handler);
  },

  /** Отправить документ на согласование (новый цикл маршрута). Возвращает задачу первого этапа. */
  open(input: OpenTaskInput): ApprovalTask | undefined {
    const stepNo = input.step ?? 1;
    if (stepNo > 1) {
      const inst = latestInstance(input.entityId);
      if (inst && inst.status === 'in_progress' && inst.steps[stepNo - 1]) {
        for (let i = 1; i < stepNo; i++) inst.steps[i - 1]!.state = 'done';
        return activateStep(inst, stepNo);
      }
    }
    return startInstance(input, stepNo);
  },

  /** Задачи, доступные пользователю (свои, по роли, эскалированные, по замещению; админ — все). */
  list(user: User): ApprovalTask[] {
    return tasks.filter((a) => a.status === 'pending' && authority(user, a).ok).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  },

  all(): ApprovalTask[] {
    return tasks;
  },

  openFor(entityId: ID): ApprovalTask | undefined {
    return tasks.find((a) => a.entityId === entityId && a.status === 'pending');
  },

  task(taskId: ID): ApprovalTaskV2 | undefined {
    return tasks.find((t) => t.id === taskId);
  },

  /** Может ли пользователь согласовать задачу (с учётом SoD). */
  check(taskId: ID, user: User): { canAct: boolean; canApprove: boolean; onBehalfOf?: ID; blockedReason?: 'sod_initiator' | 'sod_repeat' } {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status !== 'pending') return { canAct: false, canApprove: false };
    const a = authority(user, task);
    if (!a.ok) return { canAct: false, canApprove: false };
    const block = sodBlock(user, task, a.onBehalfOf);
    return { canAct: true, canApprove: !block, ...(a.onBehalfOf ? { onBehalfOf: a.onBehalfOf } : {}), ...(block ? { blockedReason: block } : {}) };
  },

  /** Решение по задаче: согласовать / отклонить (причина обязательна) / вернуть на доработку (причина обязательна). */
  decide(taskId: ID, user: User, decision: 'approve' | 'reject' | 'return', comment?: string): void {
    const task = tasks.find((a) => a.id === taskId);
    if (!task || task.status !== 'pending') throw new ApprovalError('not_available', 'Task not available');
    const auth = authority(user, task);
    if (!auth.ok) throw new ApprovalError('not_allowed', 'Not allowed');
    const text = comment?.trim();
    if (decision !== 'approve' && !text) throw new ApprovalError('reason_required', 'Reason required');
    if (decision === 'approve') {
      const block = sodBlock(user, task, auth.onBehalfOf);
      if (block) throw new ApprovalError(block, block === 'sod_initiator' ? 'Initiator cannot approve own document' : 'User already approved another step of this document');
      handlers.get(task.entity)?.beforeApprove?.(task.entityId, user, task);
    }
    adoptLegacy(task);
    const inst = instanceOf(task)!;
    const s = inst.steps[task.step - 1]!;
    const outcome = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'returned';
    task.status = decision === 'approve' ? 'approved' : 'rejected';
    task.outcome = outcome;
    task.decidedBy = user.id;
    task.decidedAt = now();
    if (auth.onBehalfOf) task.onBehalfOf = auth.onBehalfOf;
    if (text) task.comment = text;
    s.decisions.push({ taskId: task.id, userId: user.id, ...(auth.onBehalfOf ? { onBehalfOf: auth.onBehalfOf } : {}), decision: outcome, ...(text ? { comment: text } : {}), at: task.decidedAt });
    record(inst, { actorId: user.id, ...(auth.onBehalfOf ? { onBehalfOf: auth.onBehalfOf } : {}), action: outcome, step: task.step, taskId: task.id, ...(text ? { comment: text } : {}) });
    const handler = handlers.get(task.entity);
    handler?.onHistory(task.entityId, toHistory(user.id, outcome, text, auth.onBehalfOf));
    if (decision === 'approve') return finishStepIfComplete(inst, s, task);

    closeSiblings(inst, task, 'cancelled');
    s.state = decision === 'reject' ? 'rejected' : 'returned';
    s.finishedAt = now();
    inst.status = decision === 'reject' ? 'rejected' : 'returned';
    inst.finishedAt = now();
    if (decision === 'reject') handler?.onFinal(task.entityId, false);
    else if (handler?.onReturned) handler.onReturned(task.entityId, text!);
    else handler?.onFinal(task.entityId, false);
    notify({
      userIds: [inst.requesterId],
      kind: decision === 'reject' ? 'rejected' : 'returned',
      level: decision === 'reject' ? 'danger' : 'warning',
      title: { key: decision === 'reject' ? 'flow_n_rejected' : 'flow_n_returned', params: { number: inst.number } },
      body: text!,
      link: entityLink(inst.entity, inst.entityId),
    });
  },

  /** Повторная отправка после возврата/отклонения (новый цикл, история сохраняется). */
  resubmit(entityId: ID, user: User, comment?: string): ApprovalTask | undefined {
    const inst = latestInstance(entityId);
    if (!inst || (inst.status !== 'returned' && inst.status !== 'rejected')) throw new ApprovalError('not_available', 'Nothing to resubmit');
    if (user.id !== inst.requesterId && !directory.hasRole(user, 'admin')) throw new ApprovalError('not_initiator', 'Only initiator can resubmit');
    const handler = handlers.get(inst.entity);
    handler?.onResubmitted?.(entityId);
    handler?.onHistory(entityId, toHistory(user.id, 'submitted', comment?.trim() || undefined));
    return startInstance({ entity: inst.entity, entityId, number: inst.number, title: inst.title, requesterId: inst.requesterId, ...(inst.amount !== undefined ? { amount: inst.amount } : {}), ...(inst.currency ? { currency: inst.currency } : {}), context: inst.context });
  },

  /** Комментарий к документу (участник маршрута или инициатор). Ответ инициатора снимает «запрос информации». */
  comment(entityId: ID, user: User, text: string): void {
    const inst = latestInstance(entityId);
    if (!inst) throw new ApprovalError('not_found', 'No route');
    const body = text.trim();
    if (!body) throw new ApprovalError('reason_required', 'Comment required');
    record(inst, { actorId: user.id, action: 'commented', comment: body, step: inst.currentStep });
    handlers.get(inst.entity)?.onHistory(entityId, toHistory(user.id, 'commented', body));
    const open = tasks.filter((t) => t.instanceId === inst.id && t.status === 'pending');
    if (user.id === inst.requesterId) {
      const asked = open.filter((t) => t.infoRequested);
      asked.forEach((t) => (t.infoRequested = false));
      const to = [...new Set(events.filter((e) => e.instanceId === inst.id && e.action === 'info_requested').map((e) => e.actorId))];
      notify({ userIds: to.length ? to : open.flatMap(recipientsOf), excludeIds: [user.id], kind: 'comment', level: 'info', title: { key: 'flow_n_comment', params: { number: inst.number } }, body: body, link: entityLink(inst.entity, inst.entityId) });
    } else {
      notify({ userIds: [inst.requesterId], excludeIds: [user.id], kind: 'comment', level: 'info', title: { key: 'flow_n_comment', params: { number: inst.number } }, body: body, link: entityLink(inst.entity, inst.entityId) });
    }
  },

  /** Согласующий запрашивает у инициатора информацию (задача остаётся открытой). */
  requestInfo(taskId: ID, user: User, question: string): void {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status !== 'pending') throw new ApprovalError('not_available', 'Task not available');
    const auth = authority(user, task);
    if (!auth.ok) throw new ApprovalError('not_allowed', 'Not allowed');
    const q = question.trim();
    if (!q) throw new ApprovalError('reason_required', 'Question required');
    adoptLegacy(task);
    const inst = instanceOf(task)!;
    task.infoRequested = true;
    record(inst, { actorId: user.id, ...(auth.onBehalfOf ? { onBehalfOf: auth.onBehalfOf } : {}), action: 'info_requested', step: task.step, taskId, comment: q });
    handlers.get(task.entity)?.onHistory(task.entityId, toHistory(user.id, 'commented', q, auth.onBehalfOf));
    notify({ userIds: [task.requesterId], kind: 'info_request', level: 'warning', title: { key: 'flow_n_info', params: { number: task.number } }, body: q, link: entityLink(task.entity, task.entityId) });
  },

  // ---------------- Предпросмотр и ход маршрута ----------------

  /** Маршрут, который получит документ с таким контекстом (для показа до отправки). */
  previewRoute(entity: ApprovalEntity, context: RouteContext = {}): RoutePreview {
    const ctx = buildContext({ entity, entityId: '', requesterId: context.requesterId ?? '', ...(typeof context.amount === 'number' ? { amount: context.amount } : {}), ...(context.currency ? { currency: context.currency } : {}), context });
    const { template, steps } = resolveSteps(entity, ctx);
    return { entity, ...(template ? { templateId: template.id, templateName: template.name } : {}), distinctApprovers: !!template?.distinctApprovers, steps };
  },

  /** Ход согласования документа: шаги со статусами done/current/pending, решения, события. */
  routeFor(entityId: ID): RouteView | undefined {
    const pending = tasks.find((t) => t.entityId === entityId && t.status === 'pending');
    if (pending) adoptLegacy(pending);
    const inst = latestInstance(entityId);
    if (!inst) return undefined;
    const ms = nowMs();
    return clone({
      instanceId: inst.id,
      entity: inst.entity,
      entityId: inst.entityId,
      number: inst.number,
      status: inst.status,
      cycle: inst.cycle,
      currentStep: inst.currentStep,
      requesterId: inst.requesterId,
      ...(inst.templateId ? { templateId: inst.templateId } : {}),
      ...(inst.templateName ? { templateName: inst.templateName } : {}),
      distinctApprovers: inst.distinctApprovers,
      ...(inst.legacy ? { legacy: true } : {}),
      steps: inst.steps.map((s) => {
        const esc = tasks.filter((t) => t.instanceId === inst.id && t.step === s.index).flatMap((t) => t.escalatedTo ?? []);
        return { ...s, overdue: s.state === 'current' && !!s.dueAt && new Date(s.dueAt).getTime() < ms, ...(esc.length ? { escalatedTo: [...new Set(esc)] } : {}) };
      }),
      events: events.filter((e) => e.entityId === entityId),
    });
  },

  /** Все циклы маршрута документа (для истории). */
  instancesFor(entityId: ID): RouteInstance[] {
    return instances.filter((i) => i.entityId === entityId);
  },

  // ---------------- Очередь пользователя ----------------

  inbox(user: User, box: InboxBox, filter: InboxFilter = {}): InboxItem[] {
    const ms = nowMs();
    const inPeriod = (iso: string) => (!filter.from || iso.slice(0, 10) >= filter.from) && (!filter.to || iso.slice(0, 10) <= filter.to);
    const byEntity = (e: ApprovalEntity) => !filter.entity || e === filter.entity;
    let out: InboxItem[] = [];
    if (box === 'mine' || box === 'delegated') {
      for (const t of tasks) {
        if (t.status !== 'pending' || !byEntity(t.entity) || !inPeriod(t.createdAt)) continue;
        const a = authority(user, t);
        if (!a.ok || (box === 'mine') !== a.direct) continue;
        const block = sodBlock(user, t, a.onBehalfOf);
        const overdue = new Date(t.dueAt).getTime() < ms;
        if (filter.overdueOnly && !overdue) continue;
        out.push({ task: t, ...(a.onBehalfOf ? { onBehalfOf: a.onBehalfOf } : {}), canApprove: !block, ...(block ? { blockedReason: block } : {}), lowRisk: isLowRisk(t), overdue });
      }
      out.sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt));
    } else if (box === 'sent') {
      const latest = new Map<ID, RouteInstance>();
      for (const i of instances) if (i.requesterId === user.id) latest.set(i.entityId, i);
      for (const i of latest.values()) {
        if (!byEntity(i.entity) || !inPeriod(i.createdAt)) continue;
        const cur = tasks.find((t) => t.instanceId === i.id && t.step === i.currentStep && (i.status !== 'in_progress' || t.status === 'pending')) ?? tasks.filter((t) => t.instanceId === i.id).slice(-1)[0];
        if (!cur) continue;
        const overdue = i.status === 'in_progress' && new Date(cur.dueAt).getTime() < ms;
        if (filter.overdueOnly && !overdue) continue;
        out.push({ task: cur, canApprove: false, lowRisk: false, overdue, instance: { status: i.status, cycle: i.cycle, currentStep: i.currentStep, totalSteps: i.steps.length } });
      }
      out.sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt));
    } else {
      for (const e of events) {
        if (e.actorId !== user.id || !['approved', 'rejected', 'returned', 'info_requested', 'commented'].includes(e.action) || !byEntity(e.entity) || !inPeriod(e.at)) continue;
        const t = (e.taskId && tasks.find((x) => x.id === e.taskId)) || tasks.find((x) => x.instanceId === e.instanceId);
        if (!t) continue;
        out.push({ task: t, canApprove: false, lowRisk: false, overdue: false, event: e });
      }
      out.sort((a, b) => b.event!.at.localeCompare(a.event!.at));
    }
    return out;
  },

  /** Массовое согласование низкорисковых задач (политика bulkPolicy). */
  bulkApprove(taskIds: ID[], user: User, comment?: string): { approved: ID[]; failed: { id: ID; reason: string }[] } {
    const approved: ID[] = [];
    const failed: { id: ID; reason: string }[] = [];
    for (const id of taskIds) {
      const t = tasks.find((x) => x.id === id);
      if (!t) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }
      if (!isLowRisk(t)) {
        failed.push({ id, reason: 'not_low_risk' });
        continue;
      }
      try {
        approvalEngine.decide(id, user, 'approve', comment);
        approved.push(id);
      } catch (e) {
        failed.push({ id, reason: e instanceof ApprovalError ? e.code : String(e) });
      }
    }
    return { approved, failed };
  },

  // ---------------- Контроль сроков (SLA) ----------------

  /** Сканер сроков: предупреждение о скором истечении, просрочка, эскалация руководителю. */
  scan(at: number = nowMs()): { warned: number; escalated: number } {
    let warned = 0;
    let escalated = 0;
    for (const t of tasks) {
      if (t.status !== 'pending') continue;
      const due = new Date(t.dueAt).getTime();
      const sla = (t.slaHours ?? 72) * 3_600_000;
      const left = due - at;
      const link = entityLink(t.entity, t.entityId);
      if (left > 0 && left <= Math.max(sla * 0.25, 60_000) && !t.slaWarned) {
        t.slaWarned = true;
        warned++;
        notify({ userIds: recipientsOf(t), kind: 'sla_soon', level: 'warning', title: { key: 'flow_n_sla_soon', params: { number: t.number } }, body: { key: 'flow_n_task_body', params: { entity: { key: `entity_${t.entity}` }, title: t.title, step: String(t.step), total: String(t.totalSteps) } }, link, dedupeKey: `sla_soon:${t.id}` });
      }
      if (left <= 0 && !t.escalatedAt) {
        adoptLegacy(t);
        const inst = instanceOf(t);
        const assignees = recipientsOf(t);
        const managers = new Set<ID>();
        for (const id of assignees) {
          const m = directory.managerOf(directory.user(id));
          if (m) managers.add(m.id);
        }
        assignees.forEach((id) => managers.delete(id));
        managers.delete(t.requesterId);
        if (!managers.size) directory.admins().forEach((u) => u.id !== t.requesterId && !assignees.includes(u.id) && managers.add(u.id));
        if (!managers.size) directory.admins().forEach((u) => u.id !== t.requesterId && managers.add(u.id));
        t.escalatedTo = [...managers];
        t.escalatedAt = new Date(at).toISOString();
        t.overdueNotified = true;
        escalated++;
        if (inst) record(inst, { actorId: 'system', action: 'escalated', step: t.step, taskId: t.id, targetIds: t.escalatedTo });
        notify({ userIds: assignees, kind: 'sla_overdue', level: 'danger', title: { key: 'flow_n_overdue', params: { number: t.number } }, body: { key: 'flow_n_task_body', params: { entity: { key: `entity_${t.entity}` }, title: t.title, step: String(t.step), total: String(t.totalSteps) } }, link, dedupeKey: `overdue:${t.id}` });
        notify({ userIds: t.escalatedTo, kind: 'escalation', level: 'danger', title: { key: 'flow_n_escalated', params: { number: t.number } }, body: { key: 'flow_n_escalated_body', params: { entity: { key: `entity_${t.entity}` }, title: t.title, names: assignees.map((i) => directory.user(i)?.fullName ?? i).join(', ') } }, link, dedupeKey: `esc:${t.id}` });
      }
    }
    return { warned, escalated };
  },

  // ---------------- Шаблоны маршрутов (конструктор) ----------------

  templates(entity?: ApprovalEntity): RouteTemplate[] {
    return templates.filter((t) => !entity || t.entity === entity);
  },

  saveTemplate(input: Omit<RouteTemplate, 'version' | 'updatedAt' | 'versions' | 'id'> & { id?: string }, user: User, note?: string): RouteTemplate {
    if (!directory.hasRole(user, 'admin')) throw new ApprovalError('not_allowed', 'Only admin');
    if (!input.steps.length || input.steps.some((s) => !s.approvers.length)) throw new ApprovalError('invalid', 'Each step needs an approver');
    const existing = input.id ? templates.find((t) => t.id === input.id) : undefined;
    const at = now();
    if (existing) {
      const version = existing.version + 1;
      Object.assign(existing, clone(input), { id: existing.id, version, updatedAt: at, updatedBy: user.id, ...(note ? { versionNote: note } : {}), versions: [...existing.versions, { version, at, by: user.id, ...(note ? { note } : {}) }], ...(existing.system ? { system: true } : {}) });
      return clone(existing);
    }
    const created: RouteTemplate = { ...clone(input), id: nextId('rt'), version: 1, updatedAt: at, updatedBy: user.id, ...(note ? { versionNote: note } : {}), versions: [{ version: 1, at, by: user.id, ...(note ? { note } : {}) }] };
    delete created.system;
    templates.push(created);
    return clone(created);
  },

  setTemplateActive(id: string, active: boolean, user: User): void {
    if (!directory.hasRole(user, 'admin')) throw new ApprovalError('not_allowed', 'Only admin');
    const t = templates.find((x) => x.id === id);
    if (!t) throw new ApprovalError('not_found');
    t.active = active;
    t.version += 1;
    t.updatedAt = now();
    t.updatedBy = user.id;
    t.versions.push({ version: t.version, at: t.updatedAt, by: user.id, note: active ? 'activated' : 'deactivated' });
  },

  deleteTemplate(id: string, user: User): void {
    if (!directory.hasRole(user, 'admin')) throw new ApprovalError('not_allowed', 'Only admin');
    const t = templates.find((x) => x.id === id);
    if (!t || t.system) throw new ApprovalError('not_allowed', 'System template');
    templates = templates.filter((x) => x.id !== id);
  },

  committees(): Committee[] {
    return committees;
  },

  saveCommittee(c: Committee, user: User): void {
    if (!directory.hasRole(user, 'admin')) throw new ApprovalError('not_allowed', 'Only admin');
    const i = committees.findIndex((x) => x.id === c.id);
    if (i >= 0) committees[i] = clone(c);
    else committees.push(clone(c));
  },

  bulkPolicy(): BulkPolicy {
    return bulkPolicy;
  },

  setBulkPolicy(p: BulkPolicy, user: User): void {
    if (!directory.hasRole(user, 'admin')) throw new ApprovalError('not_allowed', 'Only admin');
    bulkPolicy = clone(p);
  },

  // ---------------- Заместители ----------------

  delegations(user?: User): Delegation[] {
    if (!user || directory.hasRole(user, 'admin')) return delegations;
    return delegations.filter((d) => d.userId === user.id || d.deputyId === user.id);
  },

  saveDelegation(input: Omit<Delegation, 'id' | 'createdAt' | 'createdBy'> & { id?: ID }, user: User): Delegation {
    const isAdmin = directory.hasRole(user, 'admin');
    if (input.userId !== user.id && !isAdmin) throw new ApprovalError('not_allowed', 'Only own deputies');
    if (input.userId === input.deputyId) throw new ApprovalError('invalid', 'Deputy must differ');
    if (!input.from || !input.to || input.to < input.from) throw new ApprovalError('invalid', 'Invalid period');
    const existing = input.id ? delegations.find((d) => d.id === input.id) : undefined;
    let d: Delegation;
    if (existing) {
      Object.assign(existing, clone(input), { id: existing.id });
      d = existing;
    } else {
      d = { ...clone(input), id: nextId('dl'), createdAt: now(), createdBy: user.id };
      delegations.push(d);
    }
    const principal = directory.user(d.userId);
    notify({ userIds: [d.deputyId], kind: 'delegation', level: 'info', title: { key: 'flow_n_delegation', params: { name: principal?.fullName ?? d.userId } }, body: { key: 'flow_n_delegation_body', params: { from: d.from, to: d.to } }, link: '/approvals?box=delegated', dedupeKey: `dl:${d.id}:${d.from}:${d.to}` });
    return clone(d);
  },

  removeDelegation(id: ID, user: User): void {
    const d = delegations.find((x) => x.id === id);
    if (!d) return;
    if (d.userId !== user.id && !directory.hasRole(user, 'admin')) throw new ApprovalError('not_allowed', 'Only own deputies');
    delegations = delegations.filter((x) => x.id !== id);
  },

  events(): RouteEvent[] {
    return events;
  },
};

// ---------------------------------------------------------------------------------------------
// API движка для экранов (асинхронный, как HTTP; мутации вызывают emit()).

async function mutate<T>(fn: () => T): Promise<T> {
  const out = fn();
  emit();
  return delay(out);
}

const who = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });

/** Мутация с записью в журнал аудита (успех и отказ, в т. ч. нарушение SoD). */
async function audited<T>(user: User, action: AuditAction, entity: string, entityId: string | undefined, label: string | undefined, details: string | undefined, fn: () => T): Promise<T> {
  try {
    const out = fn();
    audit.log({ action, entity, ...(entityId ? { entityId } : {}), ...(label ? { entityLabel: label } : {}), ...(details ? { details } : {}), user: who(user) });
    emit();
    return delay(out);
  } catch (e) {
    audit.log({ action, entity, ...(entityId ? { entityId } : {}), ...(label ? { entityLabel: label } : {}), details: [details, e instanceof Error ? e.message : String(e)].filter(Boolean).join(' · '), result: 'failure', user: who(user) });
    emit();
    throw e;
  }
}

function decideAudited(taskId: ID, user: User, decision: 'approve' | 'reject' | 'return', comment?: string) {
  const task = approvalEngine.task(taskId);
  const check = task ? approvalEngine.check(taskId, user) : undefined;
  const details = [task ? `${task.step}/${task.totalSteps}` : '', decision === 'return' ? 'returned' : '', check?.onBehalfOf ? `on behalf of ${check.onBehalfOf}` : '', comment ?? ''].filter(Boolean).join(' · ');
  return audited(user, decision === 'approve' ? 'approve' : 'reject', task?.entity ?? 'approval', task?.entityId ?? taskId, task?.number, details, () => approvalEngine.decide(taskId, user, decision, comment));
}

// Конструктор маршрутов — только администратор (аудитор — просмотр).
registerModuleAccess('routes', { auditor: 'view' });

export const approvalsApi = {
  inbox: (user: User, box: InboxBox, filter?: InboxFilter) => delay(approvalEngine.inbox(user, box, filter)),
  counts: (user: User) =>
    delay({
      mine: approvalEngine.inbox(user, 'mine').length,
      delegated: approvalEngine.inbox(user, 'delegated').length,
      sent: approvalEngine.inbox(user, 'sent').filter((i) => i.instance?.status === 'in_progress' || i.instance?.status === 'returned').length,
    }),
  check: (taskId: ID, user: User) => delay(approvalEngine.check(taskId, user)),
  decide: (taskId: ID, user: User, decision: 'approve' | 'reject' | 'return', comment?: string) => decideAudited(taskId, user, decision, comment),
  returnForRework: (taskId: ID, user: User, reason: string) => decideAudited(taskId, user, 'return', reason),
  resubmit: (entityId: ID, user: User, comment?: string) => {
    const inst = approvalEngine.instancesFor(entityId).slice(-1)[0];
    return audited(user, 'submit', inst?.entity ?? 'approval', entityId, inst?.number, 'resubmitted', () => approvalEngine.resubmit(entityId, user, comment));
  },
  comment: (entityId: ID, user: User, text: string) => mutate(() => approvalEngine.comment(entityId, user, text)),
  requestInfo: (taskId: ID, user: User, question: string) => mutate(() => approvalEngine.requestInfo(taskId, user, question)),
  bulkApprove: (taskIds: ID[], user: User, comment?: string) => audited(user, 'approve', 'approval', undefined, undefined, `bulk: ${taskIds.length}`, () => approvalEngine.bulkApprove(taskIds, user, comment)),
  previewRoute: (entity: ApprovalEntity, context?: RouteContext) => delay(approvalEngine.previewRoute(entity, context)),
  getRoute: (entityId: ID) => delay(approvalEngine.routeFor(entityId)),
  /** Сканер сроков (web вызывает при загрузке и раз в минуту). emit() — только если что-то изменилось. */
  async scanDeadlines(at?: number): Promise<{ warned: number; escalated: number }> {
    const r = approvalEngine.scan(at);
    if (r.warned || r.escalated) emit();
    return delay(r);
  },
  listTemplates: (entity?: ApprovalEntity) => delay(approvalEngine.templates(entity)),
  saveTemplate: (input: Parameters<typeof approvalEngine.saveTemplate>[0], user: User, note?: string) => audited(user, input.id ? 'update' : 'create', 'approval_route', input.id, input.name.ru, note, () => approvalEngine.saveTemplate(input, user, note)),
  setTemplateActive: (id: string, active: boolean, user: User) => audited(user, active ? 'activate' : 'deactivate', 'approval_route', id, undefined, undefined, () => approvalEngine.setTemplateActive(id, active, user)),
  deleteTemplate: (id: string, user: User) => audited(user, 'delete', 'approval_route', id, undefined, undefined, () => approvalEngine.deleteTemplate(id, user)),
  listCommittees: () => delay(approvalEngine.committees()),
  saveCommittee: (c: Committee, user: User) => audited(user, 'settings', 'approval_committee', c.id, c.name.ru, c.memberIds.join(','), () => approvalEngine.saveCommittee(c, user)),
  getBulkPolicy: () => delay(approvalEngine.bulkPolicy()),
  setBulkPolicy: (p: BulkPolicy, user: User) => audited(user, 'settings', 'approval_bulk_policy', undefined, undefined, `${p.entities.join(',')} ≤ ${p.maxAmount}`, () => approvalEngine.setBulkPolicy(p, user)),
  listDelegations: (user: User) => delay(approvalEngine.delegations(user)),
  saveDelegation: (input: Parameters<typeof approvalEngine.saveDelegation>[0], user: User) => audited(user, 'access_change', 'delegation', input.id, undefined, `${input.userId} → ${input.deputyId} · ${input.from}..${input.to}${input.active ? '' : ' (off)'}`, () => approvalEngine.saveDelegation(input, user)),
  removeDelegation: (id: ID, user: User) => audited(user, 'access_change', 'delegation', id, undefined, 'removed', () => approvalEngine.removeDelegation(id, user)),
};
