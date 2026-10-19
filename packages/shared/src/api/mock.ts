// In-memory реализация Api ядра (справочники, согласования, закупки, договоры, заявки).
// Модули (склад, бюджет, FTP…) живут в packages/shared/src/modules/* и используют те же bus и engine.
import * as seed from '../mock/data';
import { clone, delay, emit, historyEvent, nextId, nextNumber, now, setLatency, subscribe, today } from '../bus';
import { approvalEngine } from '../engine';
import { setDirectory } from '../directory';
import type { Contract, EmployeeRequest, HistoryEvent, ID, ProcurementRequest, User } from '../types';
import { formatDate, formatMoney, procurementTotal } from '../format';
import type { Api } from './types';
import { matches, registerSearchProvider, searchAll } from '../search';
import { localize, tk, translate } from '../i18n';
import { audit, diffFields } from '../audit';
import { getUsersRef, initSecurityStore, securityApi, seedSecurityAudit } from '../security';
import { initOrgStore, orgBranchOf } from '../org';
import { budgetSource } from '../budgetBridge'; // P2-FINPLAN
import { positions as seedPositions } from '../mock/orgData';
import { notify } from '../notifications';
import { filesApi } from '../services/files';
import { procTables, setCoreTables } from './procStore';
import { budgetCheck, fail, regionOf, userBranch, isCbu, usersByRole } from './procCommon';
import { createContractRecord, procRouteContext, supplierAdmission, verifyDraft } from './procurementExt';
import { apiError } from '../errors';
import { auditRetentionSeed } from '../auditRetention'; // P4-SEC

type CoreDb = {
  users: typeof seed.users;
  counterparties: typeof seed.counterparties;
  procurement: typeof seed.procurementRequests;
  contracts: typeof seed.contracts;
  employeeRequests: typeof seed.employeeRequests;
  tenders: typeof seed.tenders;
};
let coreDb: CoreDb | null = null;
let searchRegistered = false;

function registerCoreSearch() {
  if (searchRegistered) return;
  searchRegistered = true;
  registerSearchProvider((q, lang) => {
    if (!coreDb) return [];
    const db = coreDb;
    return [
      ...db.procurement
        .filter((p) => matches(q, p.number, p.title, p.justification))
        .map((p) => ({ group: 'navProcurement', title: `${p.number} · ${p.title}`, subtitle: translate(lang, tk('pstatus_', p.status)), to: `/procurement/${p.id}` })),
      ...db.tenders
        .filter((x) => matches(q, x.number, x.title))
        .map((x) => ({ group: 'tenders', title: `${x.number} · ${x.title}`, subtitle: translate(lang, tk('tstatus_', x.status)), to: `/procurement/${x.requestId}` })),
      ...db.contracts
        .filter((c) => matches(q, c.number, c.subject, db.counterparties.find((x) => x.id === c.counterpartyId)?.name))
        .map((c) => ({ group: 'navContracts', title: `${c.number} · ${c.subject}`, subtitle: translate(lang, tk('cstatus_', c.status)), to: `/contracts/${c.id}` })),
      ...db.employeeRequests
        .filter((r) => matches(q, r.number, r.description))
        .map((r) => ({ group: 'navRequests', title: `${r.number} · ${r.description}`, subtitle: translate(lang, tk('rstatus_', r.status)), to: '/requests' })),
      ...db.counterparties
        .filter((c) => matches(q, c.name, c.tin))
        .map((c) => ({ group: 'counterparties', title: c.name, subtitle: `${translate(lang, 'tin')} ${c.tin}`, to: `/master-data?tab=counterparties&q=${c.tin}` })),
      ...db.users
        .filter((u) => matches(q, u.fullName, u.email))
        .map((u) => ({ group: 'users', title: u.fullName, subtitle: localize(u.position, lang), to: `/master-data?tab=users&q=${encodeURIComponent(u.fullName)}` })),
    ];
  });
}

export { ROUTES } from '../engine';

export interface MockApiOptions {
  latencyMs?: number;
}

export function createMockApi(options: MockApiOptions = {}): Api {
  setLatency(options.latencyMs ?? 250);
  // Платформенные сервисы ядра (P1-ORG): журнал аудита, пользователи/RBAC (security.ts), оргструктура и МВЗ (org.ts)
  audit.reset();
  const db = {
    users: initSecurityStore(seed.users, seedPositions),
    departments: clone(seed.departments),
    counterparties: clone(seed.counterparties),
    budgetLines: clone(seed.budgetLines),
    procurement: clone(seed.procurementRequests),
    tenders: clone(seed.tenders),
    contracts: clone(seed.contracts),
    employeeRequests: clone(seed.employeeRequests),
  };
  // P2-PROC: расширенные закупки/договоры/заявки работают с теми же таблицами (до reset движка — getContext обработчиков)
  setCoreTables(db);
  // Справочник пользователей для движка согласований и уведомлений — живые таблицы (P1-FLOW).
  setDirectory({ users: () => db.users, departments: () => db.departments });
  approvalEngine.reset(seed.approvalTasks);
  const who = (u: { id: ID; fullName: string; role: User['role'] }) => ({ id: u.id, fullName: u.fullName, role: u.role });
  initOrgStore();
  setDirectory({ branchOf: (u) => orgBranchOf(u.orgUnitKey) });
  // История документов ядра → демо-записи журнала аудита (кто и когда создавал/согласовывал)
  const ACT = { created: 'create', submitted: 'submit', approved: 'approve', rejected: 'reject', returned: 'reject', commented: 'update', status_changed: 'update' } as const;
  const histAudit = (entity: string, list: { id: ID; number: string; history: HistoryEvent[] }[]) =>
    list.flatMap((d) =>
      d.history.map((h) => {
        const u = db.users.find((x) => x.id === h.userId);
        return { action: ACT[h.action], entity, entityId: d.id, entityLabel: d.number, ...(h.comment ? { details: h.comment } : {}), user: u ? who(u) : null, at: h.at, ip: '10.12.4.21', device: 'Chrome 129 / Windows 10' };
      }),
    );
  // P4-SEC: история журнала старше срока хранения (2018–2019) — для архивирования/уничтожения под контролем двух лиц
  seedSecurityAudit([...auditRetentionSeed(), ...histAudit('procurement', db.procurement), ...histAudit('contract', db.contracts), ...histAudit('employee_request', db.employeeRequests)]);
  coreDb = db;
  registerCoreSearch();

  const byId = <T extends { id: ID }>(list: T[]) => (id: ID) => list.find((x) => x.id === id);
  const pushHistory = <T extends { id: ID; history: HistoryEvent[] }>(list: T[]) => (id: ID, e: HistoryEvent) => byId(list)(id)?.history.push(e);

  approvalEngine.register('procurement', {
    onHistory: pushHistory(db.procurement),
    onFinal: (id, ok) => {
      const d = byId(db.procurement)(id);
      if (!d) return;
      if (!ok) {
        d.status = 'rejected';
        return;
      }
      // PR-PROC-016: повторная проверка бюджета при окончательном согласовании — без остатка заявка возвращается
      const b = budgetCheck(d.budgetLineId, procurementTotal(d.items), d.id);
      // P3: soft-check — превышение подтверждено руководителем по маршруту согласования; возврат — только при hard-check
      const softOverrun = d.verification?.checks.some((c) => c.code === 'v_budget' && c.severity === 'warning');
      if (!b.ok && !softOverrun) {
        d.status = 'draft';
        d.history.push(historyEvent('system', 'returned', `budget: ${b.available}`));
        notify({ userIds: [d.initiatorId, ...usersByRole('finance')], kind: 'returned', level: 'warning', title: { key: 'proc_n_budget_returned', params: { number: d.number } }, body: d.title, link: `/procurement/${d.id}` });
        return;
      }
      d.status = 'approved';
    },
    // Возврат на доработку → черновик (инициатор правит и отправляет снова), контекст маршрута — способ закупки.
    onReturned: (id) => {
      const d = byId(db.procurement)(id);
      if (d) d.status = 'draft';
    },
    onResubmitted: (id) => {
      const d = byId(db.procurement)(id);
      if (d) d.status = 'pending';
    },
    getContext: (id) => {
      const d = byId(db.procurement)(id);
      return d ? procRouteContext(d) : undefined;
    },
  });
  approvalEngine.register('contract', {
    onHistory: pushHistory(db.contracts),
    onFinal: (id, ok) => {
      const d = byId(db.contracts)(id);
      if (d) d.status = ok ? 'active' : 'draft';
    },
    onReturned: (id) => {
      const d = byId(db.contracts)(id);
      if (d) d.status = 'draft';
    },
    onResubmitted: (id) => {
      const d = byId(db.contracts)(id);
      if (d) d.status = 'pending';
    },
    getContext: (id) => {
      const d = byId(db.contracts)(id);
      return d ? { departmentId: d.departmentId, counterpartyId: d.counterpartyId } : undefined;
    },
  });
  // employee_request: обработчик зарегистрирован в supplyExt.ts (P2-PROC, заявки на обеспечение)

  /** Отправка заявки: ЦБУ — в очередь областного регионального центра (PR-PROC-021), остальные — на согласование. */
  const submitDoc = (doc: ProcurementRequest, user: User) => {
    doc.status = 'pending';
    if (isCbu(doc.branchKey)) {
      doc.intake = 'region';
      doc.history.push(historyEvent(user.id, 'submitted', `→ ${regionOf(doc.branchKey)}`));
      const heads = db.users.filter((u) => u.role === 'dept_head' && regionOf(userBranch(u)) === regionOf(doc.branchKey)).map((u) => u.id);
      notify({ userIds: heads.length ? heads : usersByRole('admin'), kind: 'task', level: 'info', title: { key: 'proc_n_region_queue', params: { number: doc.number } }, body: doc.title, link: '/procurement?tab=consolidation' });
      return;
    }
    doc.intake = 'approval';
    doc.history.push(historyEvent(user.id, 'submitted'));
    approvalEngine.open({ entity: 'procurement', entityId: doc.id, number: doc.number, title: doc.title, requesterId: user.id, amount: procurementTotal(doc.items), context: procRouteContext(doc) });
  };

  const api: Api = {
    listUsers: () => delay(getUsersRef()),
    login: (userId, method) => securityApi.demoLogin(userId, method),
    logout: (reason) => securityApi.logout(reason),

    listDepartments: () => delay(db.departments),
    listCounterparties: () => delay(db.counterparties),
    listBudgetLines: () => delay(budgetSource.lines(db.budgetLines)), // P2-FINPLAN: план/факт — из модуля бюджетирования

    async saveCounterparty(input) {
      if (!/^\d{9}$/.test(input.tin)) throw new Error('TIN must be 9 digits');
      const dup = db.counterparties.find((c) => c.tin === input.tin && c.id !== input.id);
      if (dup) throw apiError('TIN_ALREADY_USED', dup.name);
      let doc = input.id ? db.counterparties.find((c) => c.id === input.id) : undefined;
      const CP_FIELDS = ['name', 'tin', 'type', 'address', 'phone', 'rating', 'blocked'];
      if (doc) {
        const before = clone(doc);
        Object.assign(doc, input);
        const changes = diffFields(before, doc, CP_FIELDS);
        if (changes.length) audit.log({ action: 'update', entity: 'counterparty', entityId: doc.id, entityLabel: doc.name, changes });
      } else {
        doc = { ...input, id: nextId('c') };
        db.counterparties.push(doc);
        audit.log({ action: 'create', entity: 'counterparty', entityId: doc.id, entityLabel: doc.name, changes: diffFields({}, doc, CP_FIELDS) });
      }
      emit();
      return delay(doc);
    },

    async setCounterpartyBlocked(id, blocked) {
      const doc = db.counterparties.find((c) => c.id === id);
      if (doc && doc.blocked !== blocked) {
        doc.blocked = blocked;
        audit.log({ action: blocked ? 'block' : 'unblock', entity: 'counterparty', entityId: id, entityLabel: doc.name, changes: [{ field: 'blocked', from: String(!blocked), to: String(blocked) }] });
      }
      emit();
      await delay(null);
    },

    getDashboard(user) {
      const active = db.contracts.filter((c) => c.status === 'active');
      const budgetLines = budgetSource.lines(db.budgetLines); // P2-FINPLAN
      const planned = budgetLines.reduce((s, b) => s + b.planned, 0);
      const spent = budgetLines.reduce((s, b) => s + b.spent, 0);
      return delay({
        pendingApprovals: approvalEngine.list(user).length,
        openRequests: db.procurement.filter((p) => ['pending', 'approved', 'in_tender'].includes(p.status)).length,
        activeContracts: active.length,
        activeContractsAmount: active.filter((c) => c.currency === 'UZS').reduce((s, c) => s + c.amount, 0),
        budgetUsedPct: Math.round((spent / planned) * 100),
        overduePayments: db.contracts.flatMap((c) => c.payments).filter((p) => !p.paid && p.dueDate < today()).length,
      });
    },

    listApprovals: (user) => delay(approvalEngine.list(user)),
    async decideApproval(taskId, user, decision, comment) {
      const task = approvalEngine.all().find((a) => a.id === taskId);
      try {
        approvalEngine.decide(taskId, user, decision, comment);
      } catch (e) {
        audit.log({ action: decision, entity: task?.entity ?? 'approval', entityId: task?.entityId ?? taskId, entityLabel: task?.number, details: e instanceof Error ? e.message : String(e), result: 'failure', user: { id: user.id, fullName: user.fullName, role: user.role } });
        emit();
        throw e;
      }
      audit.log({ action: decision, entity: task?.entity ?? 'approval', entityId: task?.entityId ?? taskId, entityLabel: task?.number, details: [task ? `${task.step}/${task.totalSteps}` : '', comment ?? ''].filter(Boolean).join(' · '), user: { id: user.id, fullName: user.fullName, role: user.role } });
      emit();
      await delay(null);
    },
    getOpenApproval: (entityId) => delay(approvalEngine.openFor(entityId)),

    listProcurement(filter = {}) {
      const q = filter.search?.trim().toLowerCase();
      return delay(
        db.procurement
          .filter((p) => !filter.status || p.status === filter.status)
          .filter((p) => !filter.departmentId || p.departmentId === filter.departmentId)
          .filter((p) => !q || p.title.toLowerCase().includes(q) || p.number.toLowerCase().includes(q))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    },
    getProcurement: (id) => delay(byId(db.procurement)(id)),

    async createProcurement(input, user) {
      const branchKey = userBranch(user);
      const doc: ProcurementRequest = {
        id: nextId('pr'),
        number: nextNumber('ZK'),
        title: input.title,
        departmentId: input.departmentId,
        initiatorId: user.id,
        budgetLineId: input.budgetLineId,
        method: input.method,
        status: 'draft',
        items: input.items,
        neededBy: input.neededBy,
        createdAt: now(),
        justification: input.justification,
        history: [historyEvent(user.id, 'created')],
        kind: input.kind ?? 'goods',
        ...(input.costCenterKey ? { costCenterKey: input.costCenterKey } : {}),
        ...(input.businessGroupId ? { businessGroupId: input.businessGroupId } : {}),
        ...(input.attachmentKey ? { attachmentKey: input.attachmentKey } : {}),
        branchKey,
      };
      if (input.submit) {
        // PR-PROC-013: верификация до маршрута; при ошибках заявка не создаётся
        const v = await verifyDraft({ ...input, kind: input.kind ?? 'goods', costCenterKey: input.costCenterKey ?? '' }, user, !!input.attachmentKey && filesApi.count('procurement', input.attachmentKey) > 0);
        if (!v.ok) fail('verification', v.checks.filter((c) => !c.ok && c.severity === 'error').map((c) => c.code).join(','));
        doc.verification = v;
      }
      db.procurement.push(doc);
      if (input.submit) submitDoc(doc, user);
      audit.log({ action: 'create', entity: 'procurement', entityId: doc.id, entityLabel: doc.number, details: `${doc.title} · ${input.submit ? 'submitted' : 'draft'}`, user: who(user) });
      emit();
      return delay(doc);
    },

    async submitProcurement(id, user) {
      const doc = byId(db.procurement)(id);
      if (!doc || doc.status !== 'draft') throw apiError('ONLY_DRAFTS_CAN_BE_SUBMITTED');
      const key = doc.attachmentKey ?? doc.id;
      const v = await verifyDraft({ ...doc, kind: doc.kind ?? 'goods', costCenterKey: doc.costCenterKey ?? '' }, user, filesApi.count('procurement', key) + filesApi.count('procurement', doc.id) > 0);
      doc.verification = v;
      if (!v.ok) {
        emit();
        fail('verification', v.checks.filter((c) => !c.ok && c.severity === 'error').map((c) => c.code).join(','));
      }
      submitDoc(doc, user);
      audit.log({ action: 'submit', entity: 'procurement', entityId: doc.id, entityLabel: doc.number, user: who(user) });
      emit();
      await delay(null);
    },

    listTenders: () => delay(db.tenders),

    async announceTender(requestId, user, deadline) {
      const req = byId(db.procurement)(requestId);
      if (!req || req.status !== 'approved') throw apiError('REQUEST_MUST_BE_APPROVED');
      const tender = {
        id: nextId('t'),
        number: nextNumber('TN'),
        requestId,
        title: req.title,
        status: 'open' as const,
        deadline,
        // демо: участники подают предложения сразу (в продуктиве — через портал поставщиков)
        bids: db.counterparties
          .filter((c) => !c.blocked)
          .slice(0, 3)
          .map((c, i) => {
            const total = procurementTotal(req.items);
            const amount = Math.round(total * (0.9 + i * 0.05));
            return { counterpartyId: c.id, amount, deliveryDays: 7 + i * 6, score: Math.round(95 - i * 7 - (c.rating < 4 ? 5 : 0)) };
          }),
      };
      db.tenders.unshift(tender);
      req.status = 'in_tender';
      req.history.push(historyEvent(user.id, 'status_changed', tender.number));
      audit.log({ action: 'create', entity: 'tender', entityId: tender.id, entityLabel: tender.number, details: `${req.number} · ${deadline}`, user: who(user) });
      emit();
      return delay(tender);
    },

    async awardTender(tenderId, counterpartyId, user) {
      const tender = byId(db.tenders)(tenderId);
      if (!tender || tender.status === 'awarded' || tender.status === 'cancelled') throw apiError('TENDER_IS_CLOSED');
      if (!tender.bids.some((b) => b.counterpartyId === counterpartyId)) throw apiError('UNKNOWN_BIDDER');
      tender.status = 'awarded';
      tender.winnerId = counterpartyId;
      const req = byId(db.procurement)(tender.requestId);
      if (req) {
        req.status = 'approved';
        req.history.push(historyEvent(user.id, 'status_changed', `${tender.number}: ${db.counterparties.find((c) => c.id === counterpartyId)?.name ?? ''}`));
      }
      audit.log({ action: 'update', entity: 'tender', entityId: tender.id, entityLabel: tender.number, changes: [{ field: 'winnerId', from: '—', to: db.counterparties.find((c) => c.id === counterpartyId)?.name ?? counterpartyId }], user: who(user) });
      emit();
      await delay(null);
    },

    async createContractFromRequest(requestId, input, user) {
      const req = byId(db.procurement)(requestId);
      if (!req || req.status !== 'approved') throw apiError('REQUEST_MUST_BE_APPROVED');
      if (!(input.amount > 0)) throw apiError('AMOUNT_MUST_BE_POSITIVE');
      // P2-PROC: проверка поставщика по спискам и внутреннему контролю (PR-PROC-052)
      if (!supplierAdmission(input.counterpartyId).allowed) fail('supplier_blocked');
      const tender = db.tenders.find((x) => x.requestId === requestId && x.status === 'awarded');
      const contract = createContractRecord({ request: req, subject: req.title, counterpartyId: input.counterpartyId, amount: input.amount, source: tender ? 'tender' : 'request', departmentId: req.departmentId, ...(req.costCenterKey ? { costCenterKey: req.costCenterKey } : {}), startDate: input.startDate, endDate: input.endDate }, user);
      contract.history.push(historyEvent(user.id, 'submitted'));
      req.status = 'contracted';
      req.history.push(historyEvent(user.id, 'status_changed', contract.number));
      approvalEngine.open({ entity: 'contract', entityId: contract.id, number: contract.number, title: contract.subject, requesterId: user.id, amount: contract.amount, context: { kind: contract.kind, departmentId: contract.departmentId } });
      notify({ userIds: [req.initiatorId], kind: 'system', level: 'info', title: { key: 'proc_n_status', params: { number: req.number, status: { key: 'pstatus_contracted' } } }, body: contract.number, link: `/procurement/${req.id}` });
      emit();
      return delay(contract);
    },

    listContracts(filter = {}) {
      const q = filter.search?.trim().toLowerCase();
      return delay(
        db.contracts
          .filter((c) => !filter.status || c.status === filter.status)
          .filter((c) => !filter.counterpartyId || c.counterpartyId === filter.counterpartyId)
          .filter((c) => !q || c.subject.toLowerCase().includes(q) || c.number.toLowerCase().includes(q))
          .sort((a, b) => b.startDate.localeCompare(a.startDate)),
      );
    },
    getContract: (id) => delay(byId<Contract>(db.contracts)(id)),

    async submitContract(id, user) {
      const c = byId(db.contracts)(id);
      if (!c || c.status !== 'draft') throw apiError('ONLY_DRAFTS_CAN_BE_SUBMITTED');
      c.status = 'pending';
      c.history.push(historyEvent(user.id, 'submitted'));
      approvalEngine.open({ entity: 'contract', entityId: c.id, number: c.number, title: c.subject, requesterId: user.id, amount: c.amount, currency: c.currency });
      audit.log({ action: 'submit', entity: 'contract', entityId: c.id, entityLabel: c.number, user: who(user) });
      emit();
      await delay(null);
    },

    async markPaymentPaid(contractId, index, user) {
      const c = byId(db.contracts)(contractId);
      const p = c?.payments[index];
      if (!c || !p || p.paid) throw apiError('PAYMENT_NOT_AVAILABLE');
      if (c.status !== 'active') throw apiError('CONTRACT_IS_NOT_ACTIVE');
      // P2-PROC: ручная отметка — регистрация платежа, проведённого в АБС вне ERP (выписка); при открытом платёжном поручении запрещена
      if (procTables().orders.some((o) => o.contractId === c.id && o.paymentIndex === index && !['rejected', 'failed', 'executed'].includes(o.status))) fail('order_open');
      // Оплата по договору из заявки списывается со статьи бюджета (только UZS — бюджет ведётся в сумах).
      // P2-FINPLAN: бюджетный контроль и факт — в модуле бюджетирования (budgetBridge); hard-check блокирует платёж.
      const req = c.requestId ? byId(db.procurement)(c.requestId) : undefined;
      const line = req ? db.budgetLines.find((b) => b.id === req.budgetLineId) : undefined;
      if (line && c.currency === 'UZS') {
        const handled = budgetSource.payment({ budgetLineId: line.id, amount: p.amount, ref: `${c.id}:${index}`, refLabel: `${c.number} · ${formatDate(p.dueDate)}`, user, departmentId: req!.departmentId });
        if (!handled) line.spent += p.amount;
      }
      p.paid = true;
      p.paidAt = today(); // P2-PROC
      p.note = 'manual';
      c.history.push(historyEvent(user.id, 'status_changed', `${formatMoney(p.amount, c.currency)} · ${formatDate(p.dueDate)}`));
      audit.log({ action: 'update', entity: 'contract', entityId: c.id, entityLabel: c.number, changes: [{ field: `payments[${index}].paid`, from: 'false', to: 'true' }], details: `${formatMoney(p.amount, c.currency)} · ${formatDate(p.dueDate)}`, user: who(user) });
      emit();
      await delay(null);
    },

    listEmployeeRequests(user) {
      const mine = !['dept_head', 'admin'].includes(user.role);
      return delay(
        db.employeeRequests
          .filter((r) => !mine || r.initiatorId === user.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    },

    async createEmployeeRequest(input, user) {
      const doc: EmployeeRequest = {
        id: nextId('e'),
        number: nextNumber('ZA'),
        type: input.type,
        description: input.description,
        initiatorId: user.id,
        status: 'pending',
        createdAt: now(),
        history: [historyEvent(user.id, 'created')],
      };
      db.employeeRequests.push(doc);
      approvalEngine.open({ entity: 'employee_request', entityId: doc.id, number: doc.number, title: input.description.slice(0, 60), requesterId: user.id });
      audit.log({ action: 'create', entity: 'employee_request', entityId: doc.id, entityLabel: doc.number, user: who(user) });
      emit();
      return delay(doc);
    },

    async completeEmployeeRequest(id, user, comment) {
      const r = byId(db.employeeRequests)(id);
      if (!r || r.status !== 'in_progress') throw apiError('REQUEST_IS_NOT_IN_PROGRESS');
      r.status = 'done';
      r.history.push(historyEvent(user.id, 'status_changed', comment));
      audit.log({ action: 'update', entity: 'employee_request', entityId: r.id, entityLabel: r.number, changes: [{ field: 'status', from: 'in_progress', to: 'done' }], user: who(user) });
      emit();
      await delay(null);
    },

    search: (query, lang) => delay(searchAll(query, lang)),

    subscribe,
  };

  return api;
}
