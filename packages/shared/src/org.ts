// Оргструктура и МВЗ (MDM ядра): иерархия головной офис → региональные филиалы → ЦБУ/отделы,
// центры затрат (МВЗ) с версионностью SCD Type 2, группы расходов и статьи, заявки на изменение
// справочников с подтверждающим документом и утверждением, барьеры качества данных (Data Quality Firewalls).
// ТЗ PR-GEN-007, PR-MDM-001…005, PR-SEC-023.
//
// Чтение «на дату»: orgApi.listOrgUnits({ asOf: '2025-01-01' }) — структура, действовавшая на эту дату.
// Масштаб: реестр МВЗ фильтруется и пагинируется на стороне API (рассчитан на 10 000+ записей).
import { audit, diffFields } from './audit';
import { clone, delay, emit, historyEvent, nextNumber, now, today } from './bus';
import { can } from './security';
import { directory } from './directory';
import { ApprovalError, approvalEngine } from './engine';
import { signatureService } from './services/signature';
import { budgetArticles as seedArticles, buildCostCenters, buildOrgUnits, expenseGroups as seedGroups, nextDay, prevDay, SALES_CHANNELS, SEGMENTS } from './mock/orgData';
import type { ApprovalTask, BudgetArticle, BusinessSegment, CostCenter, ExpenseGroup, HistoryEvent, ID, Localized, MdmChangeAction, MdmChangeRequest, MdmEntity, OrgUnit, OrgUnitType, User } from './types';
import { apiError } from './errors';

export { SEGMENTS as BUSINESS_SEGMENTS, SALES_CHANNELS };
export type SalesChannel = (typeof SALES_CHANNELS)[number];

let orgUnits: OrgUnit[] = [];
let costCenters: CostCenter[] = [];
let groups: ExpenseGroup[] = [];
let articles: BudgetArticle[] = [];
let changes: MdmChangeRequest[] = [];
let ccSeq = 0;
let ouSeq = 0;

export function initOrgStore(): void {
  orgUnits = buildOrgUnits();
  costCenters = buildCostCenters(orgUnits);
  groups = clone(seedGroups);
  articles = clone(seedArticles);
  ccSeq = costCenters.reduce((m, c) => Math.max(m, Number(c.key.slice(2))), 0);
  ouSeq = 0;
  changes = [
    {
      id: 'mc1', number: 'MDM-2026-0007', entity: 'cost_center', action: 'update',
      targetKey: costCenters.find((c) => c.orgUnitKey === 'R03-B02' && c.code.endsWith('-04'))?.key ?? 'CC0001',
      payload: { responsibleId: 'u14' }, before: {},
      effectiveFrom: today(), reason: 'Смена ответственного за хозяйственные расходы ЦБУ «Асака» (приказ № 112, демо)',
      attachment: { name: 'prikaz-112.pdf', size: 184_320 }, status: 'pending', requestedBy: 'u4', requestedAt: '2026-10-16T10:20:00Z',
    },
    {
      id: 'mc2', number: 'MDM-2026-0005', entity: 'org_unit', action: 'create', payload: { name: { ru: 'ЦБУ «Регистан»', uz: 'BXM «Registon»' }, type: 'branch_office', parentKey: 'R09', cbuCode: '09004' },
      effectiveFrom: '2026-03-01', reason: 'Открытие ЦБУ по решению Правления № 9 (демо)', attachment: { name: 'reshenie-9.pdf', size: 251_904 },
      status: 'approved', requestedBy: 'u4', requestedAt: '2026-02-20T08:00:00Z', decidedBy: 'u6', decidedAt: '2026-02-24T12:00:00Z', targetKey: 'R09-B04',
    },
  ];
  const t = changes[0]!;
  const cc = currentCc(t.targetKey!);
  if (cc) t.before = { responsibleId: cc.responsibleId ?? null };
}

// ---------- Версии (SCD Type 2) ----------

const valid = (asOf: string) => (v: { validFrom: string; validTo: string | null }) => v.validFrom <= asOf && (v.validTo === null || asOf <= v.validTo);
const atDate = <T extends { key: string; validFrom: string; validTo: string | null }>(list: T[], key: string, asOf = today()) => list.find((v) => v.key === key && valid(asOf)(v));
const currentOu = (key: string, asOf?: string) => atDate(orgUnits, key, asOf);
const currentCc = (key: string, asOf?: string) => atDate(costCenters, key, asOf);
/** Последняя версия ключа (в т.ч. будущая или закрытая). */
const latest = <T extends { key: string; version: number }>(list: T[], key: string) => list.filter((v) => v.key === key).sort((a, b) => b.version - a.version)[0];

function descendants(rootKey: string, asOf: string): Set<string> {
  const units = orgUnits.filter(valid(asOf));
  const out = new Set<string>([rootKey]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) if (u.parentKey && out.has(u.parentKey) && !out.has(u.key)) (out.add(u.key), (grew = true));
  }
  return out;
}

// ---------- Качество данных ----------

export interface DqIssue {
  /** Поле формы или '*' для записи в целом. */
  field: string;
  /** Ключ словаря dq_*. */
  code: string;
  severity: 'error' | 'warning';
  detail?: string;
}

export class DqError extends Error {
  constructor(public issues: DqIssue[]) {
    super('data_quality');
  }
}

// ---------- P4 (PR-MDM-003): справочники других модулей и согласование через движок ----------

/** Справочник, изменения которого проходят через заявки MDM (например, номенклатура закупок). */
export interface MdmTarget {
  /** Текущая запись (для «было» и проверок); undefined — нет записи. */
  current(targetKey: string): Record<string, unknown> | undefined;
  /** Барьер качества данных для предлагаемых значений. */
  validate(input: NewChangeInput, user: User): DqIssue[];
  /** Контекст матрицы согласования (вид товара/услуги, категория). */
  matrix(input: NewChangeInput): { itemKind?: string; category?: string };
  /** Применить утверждённое изменение; вернуть ключ записи. */
  apply(req: MdmChangeRequest, approver: User): string;
  /** Заявка отправлена / отклонена — пометки на записи (статус «на утверждении», неактивна). */
  onSubmitted?(req: MdmChangeRequest): void;
  onRejected?(req: MdmChangeRequest): void;
  /** Подпись записи для заголовков задач. */
  label(req: MdmChangeRequest): string;
}
const mdmTargets = new Map<MdmEntity, MdmTarget>();
export function registerMdmTarget(entity: MdmEntity, target: MdmTarget): void {
  mdmTargets.set(entity, target);
}

/** Каноническое содержимое заявки для подписи E-IMZO согласующего. */
export function mdmChangeSignContent(req: Pick<MdmChangeRequest, 'number' | 'entity' | 'action' | 'targetKey' | 'payload' | 'effectiveFrom'>) {
  return { number: req.number, entity: req.entity, action: req.action, targetKey: req.targetKey ?? null, payload: req.payload, effectiveFrom: req.effectiveFrom };
}

const lastDecider = (entityId: ID): ID | undefined => {
  const inst = approvalEngine.instancesFor(entityId).slice(-1)[0];
  const d = inst?.steps.flatMap((x) => x.decisions).sort((a, b) => a.at.localeCompare(b.at)).slice(-1)[0];
  return d?.userId;
};
const findChange = (id: ID) => changes.find((c) => c.id === id);

approvalEngine.register('mdm_change', {
  onHistory: (id, e) => {
    const req = findChange(id);
    if (req) req.history = [...(req.history ?? []), e];
  },
  onFinal: (id, ok) => {
    const req = findChange(id);
    if (!req || req.status !== 'pending') return;
    const approverId = lastDecider(id) ?? 'system';
    const approver = directory.user(approverId) ?? directory.admins()[0]!;
    req.status = ok ? 'approved' : 'rejected';
    req.decidedBy = approverId;
    req.decidedAt = now();
    if (!ok) {
      const c = req.history?.filter((h) => h.action === 'rejected' || h.action === 'returned').slice(-1)[0]?.comment;
      if (c) req.decisionComment = c;
      mdmTargets.get(req.entity)?.onRejected?.(req);
    } else req.targetKey = applyChange(req, approver);
    emit();
  },
  getContext: (id) => {
    const req = findChange(id);
    return req ? { objectType: req.matrix?.objectType ?? req.entity, ...(req.matrix?.itemKind ? { itemKind: req.matrix.itemKind } : {}), ...(req.matrix?.category ? { category: req.matrix.category } : {}) } : undefined;
  },
  beforeApprove: (id, user, task) => {
    const req = findChange(id);
    if (!req?.requireSignature) return;
    const inst = approvalEngine.instancesFor(id).slice(-1)[0];
    const signed = (req.signatures ?? []).some((s) => s.userId === user.id && s.step === task.step && s.cycle === (inst?.cycle ?? 1));
    if (!signed) throw new ApprovalError('signature_required', 'E-IMZO signature of the approver is required');
  },
});
// Демо-заявка mc1 (смена ответственного МВЗ) — задача администратора MDM в движке согласований.
approvalEngine.seed([{ id: 'a_mc1', entity: 'mdm_change', entityId: 'mc1', title: 'Изменение МВЗ: ответственный (ЦБУ «Асака»)', number: 'MDM-2026-0007', requesterId: 'u4', assigneeRole: 'admin', step: 1, totalSteps: 1, createdAt: '2026-10-16T10:20:00Z', dueAt: '2026-10-19T18:00:00Z', status: 'pending' } as ApprovalTask]);

const CBU_RE = /^\d{5}$/;
const CC_CODE_RE = /^MVZ-\d{2}-\d{3}-[A-Z0-9]{2,3}$/;

export interface CostCenterDraft {
  code?: string;
  name?: Localized;
  orgUnitKey?: string;
  cbuCode?: string;
  segment?: BusinessSegment | '';
  expenseGroupId?: string;
  responsibleId?: string;
}

/** Барьер качества данных для МВЗ: без обязательных атрибутов (код ЦБУ, бизнес-сегмент…) запись не сохраняется. */
export function validateCostCenter(d: CostCenterDraft, key?: string, asOf = today()): DqIssue[] {
  const out: DqIssue[] = [];
  const req = (field: string, ok: boolean) => !ok && out.push({ field, code: 'dq_required', severity: 'error' });
  req('code', !!d.code?.trim());
  req('nameRu', !!d.name?.ru.trim());
  req('nameUz', !!d.name?.uz.trim());
  req('orgUnitKey', !!d.orgUnitKey);
  req('cbuCode', !!d.cbuCode?.trim());
  req('segment', !!d.segment);
  req('expenseGroupId', !!d.expenseGroupId);
  if (d.code?.trim() && !CC_CODE_RE.test(d.code.trim())) out.push({ field: 'code', code: 'dq_code_format', severity: 'error' });
  if (d.cbuCode?.trim() && !CBU_RE.test(d.cbuCode.trim())) out.push({ field: 'cbuCode', code: 'dq_cbu_format', severity: 'error' });
  const active = costCenters.filter(valid(asOf)).filter((c) => c.status === 'active' && c.key !== key);
  const dupCode = d.code && active.find((c) => c.code === d.code!.trim());
  if (dupCode) out.push({ field: 'code', code: 'dq_duplicate_code', severity: 'error', detail: dupCode.code });
  const unit = d.orgUnitKey ? currentOu(d.orgUnitKey, asOf) : undefined;
  if (d.orgUnitKey && !unit) out.push({ field: 'orgUnitKey', code: 'dq_unit_closed', severity: 'error' });
  if (unit && d.cbuCode && unit.cbuCode && unit.cbuCode !== d.cbuCode.trim()) out.push({ field: 'cbuCode', code: 'dq_cbu_mismatch', severity: 'error', detail: unit.cbuCode });
  if (d.cbuCode?.trim() && CBU_RE.test(d.cbuCode.trim()) && !orgUnits.some((u) => u.cbuCode === d.cbuCode!.trim())) out.push({ field: 'cbuCode', code: 'dq_cbu_unknown', severity: 'error' });
  const dupName = d.name?.ru.trim() && active.find((c) => c.orgUnitKey === d.orgUnitKey && c.name.ru.trim().toLowerCase() === d.name!.ru.trim().toLowerCase());
  if (dupName) out.push({ field: 'nameRu', code: 'dq_duplicate_name', severity: 'warning', detail: dupName.code });
  if (!d.responsibleId) out.push({ field: 'responsibleId', code: 'dq_no_responsible', severity: 'warning' });
  return out;
}

export interface OrgUnitDraft {
  code?: string;
  name?: Localized;
  type?: OrgUnitType | '';
  parentKey?: string;
  cbuCode?: string;
  headUserId?: string;
  address?: string;
}

export function validateOrgUnit(d: OrgUnitDraft, key?: string, asOf = today()): DqIssue[] {
  const out: DqIssue[] = [];
  const req = (field: string, ok: boolean) => !ok && out.push({ field, code: 'dq_required', severity: 'error' });
  req('code', !!d.code?.trim());
  req('nameRu', !!d.name?.ru.trim());
  req('nameUz', !!d.name?.uz.trim());
  req('type', !!d.type);
  req('parentKey', d.type === 'head_office' || !!d.parentKey);
  if (d.type === 'branch_office') req('cbuCode', !!d.cbuCode?.trim());
  if (d.cbuCode?.trim() && !CBU_RE.test(d.cbuCode.trim())) out.push({ field: 'cbuCode', code: 'dq_cbu_format', severity: 'error' });
  const units = orgUnits.filter(valid(asOf)).filter((u) => u.key !== key);
  if (d.code?.trim() && units.some((u) => u.code === d.code!.trim())) out.push({ field: 'code', code: 'dq_duplicate_code', severity: 'error' });
  if (d.type === 'branch_office' && d.cbuCode?.trim() && units.some((u) => u.type === 'branch_office' && u.cbuCode === d.cbuCode!.trim())) out.push({ field: 'cbuCode', code: 'dq_duplicate_cbu', severity: 'error' });
  if (d.parentKey && !currentOu(d.parentKey, asOf)) out.push({ field: 'parentKey', code: 'dq_unit_closed', severity: 'error' });
  if (key && d.parentKey && descendants(key, asOf).has(d.parentKey)) out.push({ field: 'parentKey', code: 'dq_cycle', severity: 'error' });
  if (d.parentKey && units.some((u) => u.parentKey === d.parentKey && u.name.ru.trim().toLowerCase() === d.name?.ru.trim().toLowerCase())) out.push({ field: 'nameRu', code: 'dq_duplicate_name', severity: 'warning' });
  return out;
}

export interface DqFinding {
  code: string;
  entity: MdmEntity;
  key: string;
  label: string;
  detail?: string;
}

function dataQualityReport(): DqFinding[] {
  const d = today();
  const units = orgUnits.filter(valid(d));
  const ccs = costCenters.filter(valid(d));
  const out: DqFinding[] = [];
  for (const c of ccs) {
    if (c.status !== 'active') continue;
    if (!units.some((u) => u.key === c.orgUnitKey)) out.push({ code: 'dqr_cc_in_closed_unit', entity: 'cost_center', key: c.key, label: `${c.code} · ${c.name.ru}` });
    if (!c.responsibleId) out.push({ code: 'dqr_cc_no_responsible', entity: 'cost_center', key: c.key, label: `${c.code} · ${c.name.ru}` });
    if (!c.expenseGroupId) out.push({ code: 'dqr_cc_no_group', entity: 'cost_center', key: c.key, label: `${c.code} · ${c.name.ru}` });
  }
  const seen = new Map<string, CostCenter>();
  for (const c of ccs.filter((x) => x.status === 'active')) {
    const k = `${c.orgUnitKey}|${c.name.ru.toLowerCase()}`;
    const prev = seen.get(k);
    if (prev) out.push({ code: 'dqr_cc_duplicate_name', entity: 'cost_center', key: c.key, label: `${c.code} · ${c.name.ru}`, detail: prev.code });
    else seen.set(k, c);
  }
  for (const u of units.filter((x) => x.type === 'region' || x.type === 'department')) {
    if (!u.headUserId && u.parentKey === 'HO') out.push({ code: 'dqr_unit_no_head', entity: 'org_unit', key: u.key, label: `${u.code} · ${u.name.ru}` });
  }
  return out;
}

// ---------- Применение заявок ----------

function applyChange(req: MdmChangeRequest, approver: User): string {
  const target = mdmTargets.get(req.entity);
  if (target) return target.apply(req, approver);
  const eff = req.effectiveFrom;
  const meta = { changedBy: req.requestedBy, changedAt: now(), changeReason: req.reason, changeRequestId: req.id };
  if (req.entity === 'cost_center') {
    if (req.action === 'create') {
      const key = `CC${String(++ccSeq).padStart(4, '0')}`;
      const doc = { ...(req.payload as Partial<CostCenter>), id: `${key}~v1`, key, version: 1, validFrom: eff, validTo: null, status: 'active', ...meta } as CostCenter;
      costCenters.push(doc);
      audit.log({ action: 'create', entity: 'cost_center', entityId: key, entityLabel: doc.code, changes: diffFields({}, doc, ['code', 'name', 'orgUnitKey', 'cbuCode', 'segment', 'expenseGroupId', 'responsibleId']), details: req.number, user: { id: approver.id, fullName: approver.fullName, role: approver.role } });
      return key;
    }
    const cur = latest(costCenters, req.targetKey!)!;
    const next = { ...clone(cur), ...(req.payload as Partial<CostCenter>), ...(req.action === 'close' ? { status: 'closed' as const } : {}), id: `${cur.key}~v${cur.version + 1}`, version: cur.version + 1, validFrom: eff, validTo: null, ...meta };
    cur.validTo = prevDay(eff);
    costCenters.push(next);
    audit.log({ action: req.action === 'close' ? 'delete' : 'update', entity: 'cost_center', entityId: cur.key, entityLabel: next.code, changes: diffFields(cur, next), details: req.number, user: { id: approver.id, fullName: approver.fullName, role: approver.role } });
    return cur.key;
  }
  // org_unit
  if (req.action === 'create') {
    const key = `OU${String(++ouSeq).padStart(3, '0')}`;
    const parent = currentOu(String(req.payload.parentKey ?? ''), eff);
    const doc = { regionCode: parent?.regionCode ?? '01', ...(req.payload as Partial<OrgUnit>), id: `${key}~v1`, key, version: 1, validFrom: eff, validTo: null, ...meta } as OrgUnit;
    orgUnits.push(doc);
    audit.log({ action: 'create', entity: 'org_unit', entityId: key, entityLabel: doc.code, changes: diffFields({}, doc, ['code', 'name', 'type', 'parentKey', 'cbuCode', 'headUserId', 'address']), details: req.number, user: { id: approver.id, fullName: approver.fullName, role: approver.role } });
    return key;
  }
  const cur = latest(orgUnits, req.targetKey!)!;
  if (req.action === 'close') {
    const before = clone(cur);
    cur.validTo = prevDay(eff);
    audit.log({ action: 'delete', entity: 'org_unit', entityId: cur.key, entityLabel: cur.code, changes: [{ field: 'validTo', from: before.validTo ?? '—', to: cur.validTo }], details: req.number, user: { id: approver.id, fullName: approver.fullName, role: approver.role } });
    return cur.key;
  }
  const next = { ...clone(cur), ...(req.payload as Partial<OrgUnit>), id: `${cur.key}~v${cur.version + 1}`, version: cur.version + 1, validFrom: eff, validTo: null, ...meta };
  cur.validTo = prevDay(eff);
  orgUnits.push(next);
  audit.log({ action: 'update', entity: 'org_unit', entityId: cur.key, entityLabel: next.code, changes: diffFields(cur, next), details: req.number, user: { id: approver.id, fullName: approver.fullName, role: approver.role } });
  return cur.key;
}

// ---------- API ----------

export interface CostCenterFilter {
  q?: string;
  /** Оргединица; включает всех потомков. */
  orgUnitKey?: string;
  regionCode?: string;
  segment?: BusinessSegment | '';
  expenseGroupId?: string;
  status?: 'active' | 'closed' | '';
  asOf?: string;
  page?: number;
  pageSize?: number;
  sort?: 'code' | 'name';
}

export interface CostCenterPage {
  rows: CostCenter[];
  total: number;
}

export interface NewChangeInput {
  entity: MdmEntity;
  action: MdmChangeAction;
  targetKey?: string;
  payload: Record<string, unknown>;
  effectiveFrom: string;
  reason: string;
  attachment?: { name: string; size: number };
}

export interface OrgStats {
  regions: number;
  branchOffices: number;
  departments: number;
  costCenters: number;
  costCentersClosed: number;
  versions: number;
  pendingChanges: number;
  dqFindings: number;
}

export const orgApi = {
  /** Оргединицы, действующие на дату (по умолчанию — сегодня). */
  listOrgUnits(opts: { asOf?: string } = {}): Promise<OrgUnit[]> {
    const d = opts.asOf || today();
    return delay(orgUnits.filter(valid(d)).sort((a, b) => a.code.localeCompare(b.code)));
  },
  /** Все версии оргединицы (история изменений SCD2). */
  orgUnitHistory: (key: string): Promise<OrgUnit[]> => delay(orgUnits.filter((u) => u.key === key).sort((a, b) => b.version - a.version)),
  /** Все версии всех оргединиц (для поиска закрытых). */
  listAllOrgUnitVersions: (): Promise<OrgUnit[]> => delay(orgUnits),

  listCostCenters(filter: CostCenterFilter = {}): Promise<CostCenterPage> {
    const d = filter.asOf || today();
    const q = filter.q?.trim().toLowerCase();
    const scope = filter.orgUnitKey ? descendants(filter.orgUnitKey, d) : null;
    const rows = costCenters
      .filter(valid(d))
      .filter((c) => !scope || scope.has(c.orgUnitKey))
      .filter((c) => !filter.regionCode || c.code.slice(4, 6) === filter.regionCode)
      .filter((c) => !filter.segment || c.segment === filter.segment)
      .filter((c) => !filter.expenseGroupId || c.expenseGroupId === filter.expenseGroupId)
      .filter((c) => !filter.status || c.status === filter.status)
      .filter((c) => !q || c.code.toLowerCase().includes(q) || c.name.ru.toLowerCase().includes(q) || c.name.uz.toLowerCase().includes(q) || c.cbuCode.includes(q))
      .sort((a, b) => (filter.sort === 'name' ? a.name.ru.localeCompare(b.name.ru) : a.code.localeCompare(b.code)));
    const size = filter.pageSize ?? 25;
    const page = Math.max(1, filter.page ?? 1);
    return delay({ rows: rows.slice((page - 1) * size, page * size), total: rows.length });
  },
  getCostCenter(key: string): Promise<{ current?: CostCenter; versions: CostCenter[] }> {
    const versions = costCenters.filter((c) => c.key === key).sort((a, b) => b.version - a.version);
    const current = currentCc(key) ?? versions[0];
    return delay(current ? { current, versions } : { versions });
  },
  /** Подсказка кода для нового МВЗ в оргединице. */
  suggestCostCenterCode(orgUnitKey: string): string {
    const u = currentOu(orgUnitKey);
    if (!u) return '';
    const region = u.type === 'department' && u.parentKey === 'HO' ? '00' : u.regionCode;
    const unitNo = u.type === 'department' && u.parentKey === 'HO' ? String(Number(u.key.replace(/\D/g, '')) || 0).padStart(3, '0') : (u.cbuCode ?? '00000').slice(2);
    const used = costCenters.filter((c) => c.orgUnitKey === orgUnitKey).length;
    for (let i = used + 1; i < 100; i++) {
      const code = `MVZ-${region}-${unitNo}-${String(i).padStart(2, '0')}`;
      if (!costCenters.some((c) => c.code === code)) return code;
    }
    return '';
  },

  listExpenseGroups: (): Promise<ExpenseGroup[]> => delay(groups),
  listBudgetArticles: (): Promise<BudgetArticle[]> => delay(articles),
  /** «Амнистия» (PR-MDM-004): переотнесение статьи к другой группе расходов с записью в журнал аудита. */
  async remapArticle(articleId: ID, groupId: ID, reason: string, user: User): Promise<void> {
    if (!can(user, 'master-data', 'edit')) throw apiError('FORBIDDEN');
    if (!reason.trim()) throw new DqError([{ field: 'reason', code: 'dq_required', severity: 'error' }]);
    const a = articles.find((x) => x.id === articleId);
    const g = groups.find((x) => x.id === groupId);
    if (!a || !g) throw apiError('NOT_FOUND');
    if (a.groupId === groupId) return;
    const from = groups.find((x) => x.id === a.groupId);
    a.groupId = groupId;
    audit.log({ action: 'update', entity: 'budget_article', entityId: a.id, entityLabel: a.code, changes: [{ field: 'groupId', from: from ? `${from.code}` : '—', to: g.code }], details: `re-mapping: ${reason.trim()}` });
    emit();
    await delay(null);
  },

  // ---- Заявки на изменение (PR-MDM-003) ----
  listChanges(filter: { status?: MdmChangeRequest['status'] | ''; entity?: MdmEntity; targetKey?: string } = {}): Promise<MdmChangeRequest[]> {
    return delay(changes.filter((c) => (!filter.status || c.status === filter.status) && (!filter.entity || c.entity === filter.entity) && (!filter.targetKey || c.targetKey === filter.targetKey)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)));
  },
  getChange: (id: ID): Promise<MdmChangeRequest | undefined> => delay(findChange(id)),
  /** Отправить изменение на утверждение. Барьер качества данных — до создания заявки. */
  async submitChange(input: NewChangeInput, user: User): Promise<MdmChangeRequest> {
    const target = mdmTargets.get(input.entity);
    if (!target && !can(user, 'master-data', 'edit')) throw new Error('Forbidden');
    const issues: DqIssue[] = [];
    if (!input.reason.trim()) issues.push({ field: 'reason', code: 'dq_required', severity: 'error' });
    if (!input.attachment) issues.push({ field: 'attachment', code: 'dq_attachment', severity: 'error' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) issues.push({ field: 'effectiveFrom', code: 'dq_required', severity: 'error' });
    let before: Record<string, unknown> | undefined;
    if (target) {
      issues.push(...target.validate(input, user));
      if (input.targetKey && changes.some((c) => c.status === 'pending' && c.entity === input.entity && c.targetKey === input.targetKey)) issues.push({ field: '*', code: 'dq_pending_exists', severity: 'error' });
      if (input.action !== 'create') {
        const cur = target.current(input.targetKey ?? '');
        if (!cur) throw new Error('Record not found');
        before = Object.fromEntries(Object.keys(input.payload).map((k) => [k, clone(cur[k] ?? null)]));
        if (input.action === 'update' && Object.keys(input.payload).every((k) => JSON.stringify(cur[k] ?? null) === JSON.stringify(input.payload[k] ?? null))) issues.push({ field: '*', code: 'dq_no_changes', severity: 'error' });
      }
    } else if (input.action !== 'create') {
      const cur = input.entity === 'cost_center' ? latest(costCenters, input.targetKey ?? '') : latest(orgUnits, input.targetKey ?? '');
      if (!cur || cur.validTo !== null) throw new Error('Record is closed');
      if (input.effectiveFrom <= cur.validFrom) issues.push({ field: 'effectiveFrom', code: 'dq_effective_before', severity: 'error', detail: cur.validFrom });
      if (changes.some((c) => c.status === 'pending' && c.targetKey === input.targetKey)) issues.push({ field: '*', code: 'dq_pending_exists', severity: 'error' });
      before = Object.fromEntries(Object.keys(input.payload).map((k) => [k, clone((cur as unknown as Record<string, unknown>)[k] ?? null)]));
      if (input.action === 'close' && input.entity === 'org_unit') {
        const asOf = input.effectiveFrom;
        const kids = orgUnits.filter(valid(asOf)).some((u) => u.parentKey === input.targetKey);
        const ccs = costCenters.filter(valid(asOf)).some((c) => c.orgUnitKey === input.targetKey && c.status === 'active');
        if (kids || ccs) issues.push({ field: '*', code: 'dq_unit_has_children', severity: 'error' });
      }
      if (input.action === 'update') {
        const merged = { ...clone(cur), ...input.payload };
        issues.push(...(input.entity === 'cost_center' ? validateCostCenter(merged as CostCenterDraft, cur.key, input.effectiveFrom) : validateOrgUnit(merged as OrgUnitDraft, cur.key, input.effectiveFrom)));
        if (!diffFields(cur, merged).length) issues.push({ field: '*', code: 'dq_no_changes', severity: 'error' });
      }
    } else {
      issues.push(...(input.entity === 'cost_center' ? validateCostCenter(input.payload as CostCenterDraft, undefined, input.effectiveFrom) : validateOrgUnit(input.payload as OrgUnitDraft, undefined, input.effectiveFrom)));
    }
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) throw new DqError(errors);
    const req: MdmChangeRequest = {
      id: `mc${changes.length + 1}`,
      number: nextNumber('MDM'),
      entity: input.entity,
      action: input.action,
      ...(input.targetKey ? { targetKey: input.targetKey } : {}),
      payload: clone(input.payload),
      ...(before ? { before } : {}),
      effectiveFrom: input.effectiveFrom,
      reason: input.reason.trim(),
      ...(input.attachment ? { attachment: input.attachment } : {}),
      status: 'pending',
      requestedBy: user.id,
      requestedAt: now(),
      matrix: { objectType: input.entity, ...(target ? target.matrix(input) : {}) },
      history: [historyEvent(user.id, 'created'), historyEvent(user.id, 'submitted', input.reason.trim())],
    };
    changes.push(req);
    target?.onSubmitted?.(req);
    // Маршрут — по матрице согласования (шаблоны движка для mdm_change: вид объекта, вид номенклатуры, категория).
    approvalEngine.open({
      entity: 'mdm_change',
      entityId: req.id,
      number: req.number,
      title: `${req.action === 'create' ? 'Создание' : req.action === 'close' ? 'Закрытие' : 'Изменение'}: ${target ? target.label(req) : `${req.entity} ${req.targetKey ?? String(req.payload.code ?? '')}`}`,
      requesterId: user.id,
      context: { objectType: req.entity, ...(req.matrix?.itemKind ? { itemKind: req.matrix.itemKind } : {}), ...(req.matrix?.category ? { category: req.matrix.category } : {}) },
    });
    const inst = approvalEngine.instancesFor(req.id).slice(-1)[0];
    const tpl = inst?.templateId ? approvalEngine.templates('mdm_change').find((t) => t.id === inst.templateId) : undefined;
    if (tpl?.requireSignature) req.requireSignature = true;
    audit.log({ action: 'submit', entity: 'mdm_change', entityId: req.id, entityLabel: req.number, details: `${req.entity}:${req.action}${req.targetKey ? ` ${req.targetKey}` : ''} · ${req.reason} · ${req.attachment?.name ?? ''}${tpl ? ` · route ${tpl.id} v${tpl.version}` : ''}` });
    emit();
    return delay(req);
  },
  /** Права пользователя на текущем этапе маршрута заявки (матрица согласования). */
  changeAuthority(id: ID, user: User): Promise<{ canAct: boolean; canApprove: boolean; step: number; totalSteps: number; final: boolean; blockedReason?: string; requireSignature: boolean }> {
    const req = findChange(id);
    const task = req?.status === 'pending' ? approvalEngine.openFor(id) : undefined;
    if (!req || !task) return delay({ canAct: false, canApprove: false, step: 0, totalSteps: 0, final: false, requireSignature: !!req?.requireSignature });
    const c = approvalEngine.check(task.id, user);
    return delay({ canAct: c.canAct, canApprove: c.canApprove, step: task.step, totalSteps: task.totalSteps, final: task.step >= task.totalSteps, ...(c.blockedReason ? { blockedReason: c.blockedReason } : {}), requireSignature: !!req.requireSignature });
  },
  /**
   * Решение по текущему этапу маршрута. Разделение полномочий: автор заявки не может её утвердить.
   * Если шаблон матрицы требует подписи — signatureId подписи E-IMZO согласующего (SignModal) обязателен.
   * Запись применяется только после финального этапа (onFinal движка).
   */
  async decideChange(id: ID, decision: 'approve' | 'reject', comment: string, user: User, signatureId?: ID): Promise<void> {
    const req = findChange(id);
    if (!req || req.status !== 'pending') throw new Error('Not pending');
    if (req.requestedBy === user.id && decision === 'approve') throw new Error('sod');
    if (decision === 'reject' && !comment.trim()) throw new DqError([{ field: 'comment', code: 'dq_required', severity: 'error' }]);
    const task = approvalEngine.openFor(id);
    if (!task) throw new Error('Not pending');
    const auth = approvalEngine.check(task.id, user);
    if (!auth.canAct) throw new Error('Forbidden');
    if (decision === 'approve' && req.requireSignature) {
      const sig = signatureId ? signatureService.get(signatureId) : undefined;
      if (!sig || sig.entity !== 'mdm_change' || sig.entityId !== id || sig.userId !== user.id) throw new ApprovalError('signature_required');
      const inst = approvalEngine.instancesFor(id).slice(-1)[0];
      req.signatures = [...(req.signatures ?? []).filter((x) => !(x.userId === user.id && x.step === task.step)), { userId: user.id, signatureId: sig.id, step: task.step, cycle: inst?.cycle ?? 1, at: now() }];
    }
    approvalEngine.decide(task.id, user, decision, comment.trim() || undefined);
    audit.log({ action: decision, entity: 'mdm_change', entityId: req.id, entityLabel: req.number, details: `step ${task.step}/${task.totalSteps}${signatureId ? ` · E-IMZO ${signatureService.get(signatureId)?.certSerial ?? ''}` : ''}${comment.trim() ? ` · ${comment.trim()}` : ''}` });
    emit();
    await delay(null);
  },

  dataQuality: (): Promise<DqFinding[]> => delay(dataQualityReport()),

  /** Количество действующих МВЗ по оргединицам (без потомков) на дату. */
  costCenterCounts(asOf?: string): Promise<Record<string, number>> {
    const d = asOf || today();
    const out: Record<string, number> = {};
    for (const c of costCenters) if (c.status === 'active' && valid(d)(c)) out[c.orgUnitKey] = (out[c.orgUnitKey] ?? 0) + 1;
    return delay(out);
  },

  stats(): Promise<OrgStats> {
    const d = today();
    const units = orgUnits.filter(valid(d));
    const ccs = costCenters.filter(valid(d));
    return delay({
      regions: units.filter((u) => u.type === 'region').length,
      branchOffices: units.filter((u) => u.type === 'branch_office').length,
      departments: units.filter((u) => u.type === 'department').length,
      costCenters: ccs.filter((c) => c.status === 'active').length,
      costCentersClosed: ccs.filter((c) => c.status === 'closed').length,
      versions: orgUnits.length + costCenters.length,
      pendingChanges: changes.filter((c) => c.status === 'pending').length,
      dqFindings: dataQualityReport().length,
    });
  },

  /** Демо масштаба (PR-GEN-007): догенерировать МВЗ до заданного количества (по умолчанию 10 000). */
  async generateLoad(target: number, user: User): Promise<number> {
    if (!can(user, 'master-data', 'admin')) throw apiError('FORBIDDEN');
    const d = today();
    // P3-GEN (PR-GEN-007): догенерировать ЦБУ до 500+ (по регионам), чтобы показать масштаб «более 500 филиалов»
    const regions = orgUnits.filter(valid(d)).filter((u) => u.type === 'region');
    let offices = orgUnits.filter(valid(d)).filter((u) => u.type === 'branch_office').length;
    for (let n = 0; offices <= BRANCH_TARGET && regions.length && n < 5000; n++) {
      const r = regions[n % regions.length]!;
      const idx = 100 + Math.floor(n / regions.length);
      const key = `${r.key}-L${idx}`;
      if (orgUnits.some((u) => u.key === key)) continue;
      const cbu = `${r.regionCode}${String(idx).padStart(3, '0')}`;
      orgUnits.push({ id: `${key}~v1`, key, version: 1, validFrom: d, validTo: null, changedBy: user.id, changedAt: now(), changeReason: 'Нагрузочные демо-данные', code: cbu, type: 'branch_office', name: { ru: `ЦБУ (нагрузка) ${cbu}`, uz: `BXM (yuklama) ${cbu}` }, parentKey: r.key, regionCode: r.regionCode, cbuCode: cbu } as OrgUnit);
      offices++;
    }
    const units = orgUnits.filter(valid(d)).filter((u) => u.type === 'branch_office' || u.type === 'department');
    const segs = SEGMENTS;
    let added = 0;
    let i = 0;
    const existing = costCenters.filter(valid(d)).filter((c) => c.status === 'active').length;
    while (existing + added < target && i < 100_000) {
      const u = units[i % units.length]!;
      i++;
      const key = `CC${String(++ccSeq).padStart(5, '0')}`;
      costCenters.push({
        id: `${key}~v1`, key, version: 1, validFrom: d, validTo: null, changedBy: user.id, changedAt: now(), changeReason: 'Нагрузочные демо-данные',
        code: `MVZ-${u.regionCode}-${(u.cbuCode ?? '00000').slice(2)}-${(ccSeq % 46656).toString(36).toUpperCase().padStart(3, '0')}`,
        name: { ru: `Нагрузочный МВЗ ${ccSeq} · ${u.name.ru}`, uz: `Yuklama MXJ ${ccSeq} · ${u.name.uz}` },
        orgUnitKey: u.key, cbuCode: u.cbuCode ?? '00000', segment: segs[ccSeq % segs.length]!, expenseGroupId: groups[ccSeq % groups.length]!.id, status: 'active',
      });
      added++;
    }
    audit.log({ action: 'create', entity: 'cost_center', details: `load-test: +${added}` });
    emit();
    await delay(null);
    return added;
  },
};

/** P3-GEN: целевое число ЦБУ для демо масштаба (ТЗ: более 500 филиалов). */
export const BRANCH_TARGET = 500;

export { nextDay, prevDay };

/** Филиал/ЦБУ оргединицы: ближайший предок типа «ЦБУ» или «региональный филиал»; головной офис — 'HO'. */
export function orgBranchOf(orgUnitKey: string | undefined): string | undefined {
  let u = orgUnitKey ? currentOu(orgUnitKey) : undefined;
  for (let i = 0; u && i < 10; i++) {
    if (u.type === 'branch_office' || u.type === 'region' || u.type === 'head_office') return u.key;
    u = u.parentKey ? currentOu(u.parentKey) : undefined;
  }
  return orgUnitKey;
}
