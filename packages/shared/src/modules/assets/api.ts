// API модуля «Основные средства» (ТЗ 4.2.5): постановка на учёт (авто инв. номер, группы со счетами, правила
// капитализации 19907/16505, аренда), приёмка со склада, передачи (МОЛ — электронный акт; подразделение/ЦБУ/филиал —
// распоряжение через согласование), переоценка (30908), включение в состав и выделение, амортизация (линейный и
// уменьшаемого остатка, автозапуск в установленный день, проводки по МВЗ и аллокация), инвентаризация QR/NFC,
// списание по акту ОС-4 с комиссией, продажа с НДС, загрузка из Excel, мониторинг и сверка с iABS, кадровая проверка.
import { clone, delay, emit, historyEvent, nextId, nextNumber, now, today } from '../../bus';
import { approvalEngine } from '../../engine';
import { audit, diffFields } from '../../audit';
import { getFormatLang } from '../../format';
import { pick } from '../../i18n';
import { notify } from '../../notifications';
import { can, registerUserChangeGuard } from '../../security';
import { matches, registerSearchProvider } from '../../search';
import { importRegistry } from '../../services/importer';
import { INTEGRATION_SYSTEMS, integrationHub } from '../../services/integrations';
import { signatureService } from '../../services/signature';
import type { ID, Localized, User } from '../../types';
import { onWarehouseFaIssued, warehouseApi } from '../warehouse';
import { WMS_ACCOUNTS, wmsLedger } from '../warehouse';
import type { WmsPostingEntry, WmsReconRow } from '../warehouse';
import { assetCapRulesSeed, assetGroupsSeed, assetInventoriesSeed, assetOperationsSeed, assetsApprovalSeed, assetsSeed, assetWriteoffSeed } from './data';
import type {
  AssetCapRule, AssetCategory, AssetComponent, AssetCondition, AssetDepRun, AssetGroup, AssetHoldings, AssetInventory, AssetMethod, AssetOperation, AssetOpType, AssetRecord,
  AssetScheduleRow, AssetsRunResult, AssetSource, AssetStatus, AssetsStats, AssetTaxObject, AssetWriteoffAct, AssetWriteoffKind, AssetAllocationShare, AssetLease,
} from './types';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const assets = clone(assetsSeed);
const groups = clone(assetGroupsSeed);
const operations = clone(assetOperationsSeed);
const writeoffActs = clone(assetWriteoffSeed);
const inventories = clone(assetInventoriesSeed);
const capRules = clone(assetCapRulesSeed);
const depRuns: AssetDepRun[] = [];
const monitoringRuns: { id: ID; at: string; by: ID; auto: boolean; rows: WmsReconRow[]; discrepancies: number; unfinished: number; fullyDepreciated: number }[] = [];
let lastRunPeriod = '2026-09';
/** Настройки начисления: день месяца автозапуска и признак автоматического начисления. */
const depSettings = { day: 25, auto: true };
export const ASSET_VAT_RATE = 12;
/** Ставки налогов по объектам недвижимости (демо): налог на имущество, % от среднегодовой остаточной стоимости; земельный налог, сум/м² в год. */
export const ASSET_TAX_RATES = { property: 1.5, landPerSqm: 3_200 };

const byId = (id: ID) => assets.find((a) => a.id === id);
const groupById = (id: ID) => groups.find((g) => g.id === id);
const ACTIVE: AssetStatus[] = ['in_use', 'repair', 'conservation', 'leased_out', 'pending_transfer', 'pending_writeoff', 'missing'];
const isActive = (a: AssetRecord) => ACTIVE.includes(a.status);
const auditUser = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });
const requireText = (s: string | undefined) => {
  if (!s || !s.trim()) throw new Error('REQUIRED');
};

const monthsBetween = (from: string, to: string) => {
  const [y1, m1] = from.slice(0, 7).split('-').map(Number) as [number, number];
  const [y2, m2] = to.slice(0, 7).split('-').map(Number) as [number, number];
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
};

export const assetNbv = (a: AssetRecord): number => Math.max(0, a.cost - a.accumulated);
/** Амортизация за месяц: линейный — стоимость / срок; уменьшаемого остатка — остаточная × 2 / срок, но не меньше равномерного списания остатка за оставшиеся месяцы. */
export function assetMonthly(a: AssetRecord, period = today().slice(0, 7)): number {
  const nbv = assetNbv(a);
  if (nbv <= 0) return 0;
  if (a.method === 'declining') {
    const left = Math.max(1, a.usefulLifeMonths - monthsBetween(a.acquiredAt, period));
    return Math.min(nbv, Math.max(Math.round((nbv * 2) / a.usefulLifeMonths), Math.round(nbv / left)));
  }
  return Math.min(nbv, Math.round(a.cost / a.usefulLifeMonths));
}

const currentPeriod = () => today().slice(0, 7);
const nextPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// ---------- Права ----------
/** Учётные операции (постановка, переоценка, амортизация, списание) — право «редактирование» в модуле ОС. */
export const canAccountAssets = (user: User): boolean => can(user, 'assets', 'edit');
export const canRunDepreciation = (user: User): boolean => can(user, 'assets', 'edit') && (user.role === 'accountant' || user.role === 'admin' || !!user.extraRoles?.includes('accountant'));
/** Управление объектом: учётная служба, руководитель (право согласования) или МОЛ объекта. */
export const canManageAsset = (a: AssetRecord, user: User): boolean => can(user, 'assets', 'edit') || can(user, 'assets', 'approve') || a.responsibleId === user.id;

// ---------- Хуки для модуля терминалов ----------
export type AssetEvent =
  | { type: 'transferred'; asset: AssetRecord; op: AssetOperation }
  | { type: 'writeoff_requested'; asset: AssetRecord; act: AssetWriteoffAct }
  | { type: 'writeoff_rejected'; asset: AssetRecord; act: AssetWriteoffAct }
  | { type: 'written_off'; asset: AssetRecord; act: AssetWriteoffAct }
  | { type: 'correcting'; asset: AssetRecord; patch: Partial<AssetRecord> }
  | { type: 'corrected'; asset: AssetRecord };
const listeners: ((e: AssetEvent, user: User) => void)[] = [];
/** Подписка модулей на события ОС. Обработчики 'writeoff_requested' и 'correcting' могут бросить ошибку — операция блокируется. */
export function onAssetEvent(fn: (e: AssetEvent, user: User) => void): void {
  listeners.push(fn);
}
const fire = (e: AssetEvent, user: User) => listeners.forEach((l) => l(e, user));

// ---------- Незавершённые операции (блокировка последующих) ----------
function openOp(assetId: ID): AssetOperation | undefined {
  return operations.find((o) => o.assetIds.includes(assetId) && (o.status === 'pending' || o.status === 'awaiting_acceptance' || o.status === 'returned'));
}
function openAct(assetId: ID): AssetWriteoffAct | undefined {
  return writeoffActs.find((w) => w.assetIds.includes(assetId) && ['draft', 'commission', 'pending', 'returned'].includes(w.status));
}
function assertFree(a: AssetRecord): void {
  if (!isActive(a) || a.status === 'missing') throw new Error('NOT_ALLOWED');
  if (openOp(a.id) || openAct(a.id)) throw new Error('BLOCKED_BY_OPEN_OPERATION');
}

// ---------- Инвентарный номер ----------
function nextInventoryNo(groupId: ID): string {
  const g = groupById(groupId)!;
  const max = assets.filter((a) => a.inventoryNo.startsWith(`OS-${g.invPrefix}-`)).reduce((m, a) => Math.max(m, Number(a.inventoryNo.split('-')[2]) || 0), 0);
  return `OS-${g.invPrefix}-${String(max + 1).padStart(6, '0')}`;
}
/** Содержимое QR-кода ОС (сканируется при инвентаризации). */
export const assetQrValue = (a: Pick<AssetRecord, 'inventoryNo' | 'name'>) => `XB-OS:${a.inventoryNo}`;

// ---------- Проводки ----------
function post(docType: string, docId: ID, docNumber: string, entries: WmsPostingEntry[], user: Pick<User, 'id'>) {
  return wmsLedger.post({ module: 'assets', docType, docId, docNumber, entries }, user);
}

function reconRows(): WmsReconRow[] {
  const accs = new Map<string, number>();
  const add = (acc: string, v: number) => accs.set(acc, (accs.get(acc) ?? 0) + v);
  for (const a of assets.filter(isActive)) {
    const g = groupById(a.groupId)!;
    add(g.account, a.cost);
    add(g.depAccount, -a.accumulated);
    if (a.revaluation) add('30908000', -a.revaluation);
  }
  return [...accs.entries()]
    .map(([account, erp]) => {
      const iabs = wmsLedger.iabsBalance(account);
      return { module: 'assets' as const, account, name: WMS_ACCOUNTS[account] ?? L(account, account, account), erp: Math.round(erp), iabs: Math.round(iabs), diff: Math.round(erp - iabs) };
    })
    .sort((a, b) => a.account.localeCompare(b.account));
}

// Сальдо iABS на начало = учётные данные (засеянная история проведена ранее); расхождение демонстрирует отдельная ошибка.
(() => {
  for (const r of reconRows()) wmsLedger.setOpening(r.account, r.erp);
  // В iABS не отражена модернизация видеонаблюдения (as6, 8 млн) — расхождение для ежедневного мониторинга.
  wmsLedger.setOpening('16513000', -8_000_000);
})();

// ---------- Согласования ----------
const statusBeforeWriteoff = new Map<ID, AssetStatus>();
const statusBeforeTransfer = new Map<ID, AssetStatus>();

approvalEngine.register('asset_writeoff', {
  onHistory: (id, e) => {
    const act = writeoffActs.find((w) => w.id === id);
    if (act) {
      act.history.push(e);
      act.assetIds.forEach((aid) => byId(aid)?.history.push(e));
    } else byId(id)?.history.push(e);
  },
  onFinal: (id, approved) => {
    const act = writeoffActs.find((w) => w.id === id);
    if (!act) return;
    const sys = { id: act.createdBy, fullName: '', role: 'accountant' } as User;
    if (approved) completeWriteoff(act, sys);
    else {
      act.status = 'rejected';
      act.assetIds.forEach((aid) => {
        const a = byId(aid);
        if (!a) return;
        a.status = statusBeforeWriteoff.get(aid) ?? 'in_use';
        statusBeforeWriteoff.delete(aid);
        fire({ type: 'writeoff_rejected', asset: a, act }, sys);
      });
    }
  },
  onReturned: (id) => {
    const act = writeoffActs.find((w) => w.id === id);
    if (act) {
      act.status = 'returned';
      act.commissionSignatures = [];
    }
  },
  onResubmitted: (id) => {
    const act = writeoffActs.find((w) => w.id === id);
    if (act) act.status = 'pending';
  },
});
approvalEngine.seed(assetsApprovalSeed);

approvalEngine.register('asset_transfer', {
  onHistory: (id, e) => {
    const op = operations.find((o) => o.id === id);
    op?.history.push(e);
    op?.assetIds.forEach((aid) => byId(aid)?.history.push(e));
  },
  onFinal: (id, approved) => {
    const op = operations.find((o) => o.id === id);
    if (!op) return;
    const sys = { id: op.createdBy, fullName: '', role: 'accountant' } as User;
    if (approved) applyTransfer(op, sys);
    else {
      op.status = 'rejected';
      op.assetIds.forEach((aid) => {
        const a = byId(aid);
        if (a) a.status = statusBeforeTransfer.get(aid) ?? 'in_use';
      });
    }
  },
  onReturned: (id) => {
    const op = operations.find((o) => o.id === id);
    if (op) op.status = 'returned';
  },
  onResubmitted: (id) => {
    const op = operations.find((o) => o.id === id);
    if (op) op.status = 'pending';
  },
});

// ---------- Поиск ----------
registerSearchProvider((q) => [
  ...assets.filter((a) => matches(q, a.inventoryNo, a.name, a.location, a.serialNo ?? '')).map((a) => ({ group: 'assets_title', title: `${a.inventoryNo} · ${a.name}`, subtitle: a.location, to: `/assets/${a.id}` })),
  ...writeoffActs.filter((w) => matches(q, w.number)).map((w) => ({ group: 'assets_title', title: `${w.number} · ${w.reason}`, subtitle: w.date, to: `/assets/writeoffs/${w.id}` })),
  ...operations.filter((o) => matches(q, o.number, o.orderNo ?? '')).map((o) => ({ group: 'assets_title', title: `${o.number} · ${o.reason}`, subtitle: o.date, to: `/assets/operations/${o.id}` })),
]);

// ---------- Приёмка ОС со склада (выдача ОС в эксплуатацию) ----------
onWarehouseFaIssued(({ issue, card, qty, amount }, user) => {
  const g = card.name.toLowerCase().includes('pos') || card.name.toLowerCase().includes('терминал') ? groupById('ag-atm')! : groupById('ag-pc')!;
  const unit = Math.round(amount / qty);
  for (let i = 0; i < qty; i++) {
    const a = createAsset(
      {
        name: card.name, groupId: g.id, orgUnitKey: issue.orgUnitKey, departmentId: issue.departmentId, costCenterId: issue.costCenterId, responsibleId: issue.recipientId, acquiredAt: today(), cost: unit,
        usefulLifeMonths: g.usefulLifeMonths, method: g.method, source: 'warehouse', location: issue.purpose,
      },
      user,
      `Приёмка со склада по ${issue.number}`,
    );
    post('intake', a.id, a.inventoryNo, [{ debit: g.account, credit: '19907000', amount: unit, costCenterId: a.costCenterId, text: `Ввод в эксплуатацию со склада ${a.inventoryNo} (${issue.number})` }], user);
  }
});

// ---------- Кадровая проверка: блокировка увольнения/перевода при числящихся ценностях ----------
function holdingsSync(userId: ID) {
  return assets.filter((a) => a.responsibleId === userId && isActive(a));
}
registerUserChangeGuard((u, change) => {
  const list = holdingsSync(u.id);
  if (!list.length) return null;
  const lang = getFormatLang();
  const nos = list.slice(0, 3).map((a) => a.inventoryNo).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');
  return change.kind === 'deactivate'
    ? pick(lang, `Нельзя уволить: за сотрудником числятся ОС (${nos}). Передайте их другому МОЛ.`, `Ishdan bo‘shatib bo‘lmaydi: xodim hisobida AV bor (${nos}). Ularni boshqa MJSga topshiring.`, `Cannot dismiss: the employee holds fixed assets (${nos}). Transfer them to another custodian first.`)
    : pick(lang, `Нельзя перевести: за сотрудником числятся ОС (${nos}). Передайте их другому МОЛ.`, `O‘tkazib bo‘lmaydi: xodim hisobida AV bor (${nos}). Ularni boshqa MJSga topshiring.`, `Cannot transfer: the employee holds fixed assets (${nos}). Transfer them to another custodian first.`);
});

// ---------- Налоговая интеграция (Soliq) ----------
(() => {
  const sys = INTEGRATION_SYSTEMS.find((s) => s.id === 'soliq');
  if (!sys || sys.operations.some((o) => o.id === 'property.declare')) return;
  // cross-module (P2-WMS): операция декларации налога на имущество и земельного налога по объектам ОС.
  sys.operations.push({
    id: 'property.declare', direction: 'out', schemaVersion: '1.0', name: L('Налог на имущество и земельный налог (объекты ОС)', 'Mol-mulk va yer solig‘i (AV obyektlari)', 'Property and land tax (fixed assets)'),
    sample: () => ({ year: 2026, objects: [{ cadastralNo: '12:01:0203:0044', propertyTax: 98_000_000, landTax: 8_320_000 }], total: 106_320_000 }),
    validate: (p) => (Array.isArray(p.objects) && p.objects.length ? null : { code: 'validation', message: 'objects: empty' }),
    amount: (p) => Number(p.total ?? 0),
    count: (p) => (Array.isArray(p.objects) ? p.objects.length : 0),
    respond: (p) => ({ accepted: true, declarationNo: `NP-${String(p.year)}-${String(Array.isArray(p.objects) ? p.objects.length : 0).padStart(4, '0')}` }),
  });
})();

// ---------- Внутренние операции ----------
export interface AssetRegisterInput {
  name: string;
  groupId: ID;
  orgUnitKey: string;
  departmentId: ID;
  costCenterId: string;
  responsibleId: ID;
  acquiredAt: string;
  cost: number;
  usefulLifeMonths: number;
  method: AssetMethod;
  source: AssetSource;
  location: string;
  fundingAccount?: string;
  counterpartyId?: ID;
  contractId?: ID;
  serialNo?: string;
  model?: string;
  warrantyUntil?: string;
  taxObject?: AssetTaxObject;
  allocation?: AssetAllocationShare[];
  lease?: AssetLease;
}

function createAsset(input: AssetRegisterInput, user: User, comment?: string): AssetRecord {
  const g = groupById(input.groupId)!;
  const a: AssetRecord = {
    id: nextId('as'), inventoryNo: nextInventoryNo(g.id), name: input.name.trim(), category: g.category, groupId: g.id, location: input.location.trim(), departmentId: input.departmentId, orgUnitKey: input.orgUnitKey,
    costCenterId: input.costCenterId, responsibleId: input.responsibleId, acquiredAt: input.acquiredAt, cost: Math.round(input.cost), usefulLifeMonths: input.usefulLifeMonths, accumulated: 0, method: input.method, revaluation: 0,
    status: 'in_use', source: input.source, components: [],
    ...(input.fundingAccount ? { fundingAccount: input.fundingAccount } : {}), ...(input.counterpartyId ? { counterpartyId: input.counterpartyId } : {}), ...(input.contractId ? { contractId: input.contractId } : {}),
    ...(input.serialNo ? { serialNo: input.serialNo.trim() } : {}), ...(input.model ? { model: input.model.trim() } : {}), ...(input.warrantyUntil ? { warrantyUntil: input.warrantyUntil } : {}),
    ...(input.taxObject ? { taxObject: input.taxObject } : {}), ...(input.allocation?.length ? { allocation: input.allocation } : {}), ...(input.lease ? { lease: input.lease } : {}),
    history: [historyEvent(user.id, 'created', comment)],
  };
  assets.push(a);
  operations.push({ id: nextId('ao'), number: nextNumber('OP'), type: input.source === 'warehouse' ? 'intake' : 'registration', assetIds: [a.id], date: today(), status: 'completed', to: { cost: a.cost, groupId: g.id, responsibleId: a.responsibleId }, amount: a.cost, reason: comment ?? '', createdBy: user.id, createdAt: now(), completedAt: now(), history: [historyEvent(user.id, 'created', comment)] });
  audit.log({ action: 'create', entity: 'asset', entityId: a.id, entityLabel: a.inventoryNo, details: `${a.name} · ${a.cost}`, user: auditUser(user) });
  return a;
}

/** Приведённая стоимость арендных платежей (МСФО 16, ставка дисконтирования 20 % годовых). */
export function leasePresentValue(monthly: number, from: string, to: string, annualRate = 0.2): number {
  const n = monthsBetween(from, to) + 1;
  const r = annualRate / 12;
  let pv = 0;
  for (let k = 1; k <= n; k++) pv += monthly / (1 + r) ** k;
  return Math.round(pv);
}

function applyTransfer(op: AssetOperation, user: User): void {
  const to = op.to ?? {};
  const entries: WmsPostingEntry[] = [];
  for (const aid of op.assetIds) {
    const a = byId(aid);
    if (!a) continue;
    const g = groupById(a.groupId)!;
    const fromCc = a.costCenterId;
    if (typeof to.responsibleId === 'string') a.responsibleId = to.responsibleId;
    if (typeof to.departmentId === 'string') a.departmentId = to.departmentId;
    if (typeof to.orgUnitKey === 'string') a.orgUnitKey = to.orgUnitKey;
    if (typeof to.costCenterId === 'string') a.costCenterId = to.costCenterId;
    if (typeof to.location === 'string' && to.location) a.location = to.location;
    a.status = statusBeforeTransfer.get(aid) ?? 'in_use';
    if (a.status === 'pending_transfer') a.status = 'in_use';
    statusBeforeTransfer.delete(aid);
    if (op.type === 'transfer_cbu' || op.type === 'transfer_dept') {
      // Перенос первоначальной стоимости, износа и дооценки на МВЗ получателя.
      entries.push({ debit: g.account, credit: g.account, amount: a.cost, costCenterId: a.costCenterId, text: `${a.inventoryNo}: первоначальная стоимость ${fromCc} → ${a.costCenterId}` });
      entries.push({ debit: g.depAccount, credit: g.depAccount, amount: a.accumulated, costCenterId: a.costCenterId, text: `${a.inventoryNo}: износ ${fromCc} → ${a.costCenterId}` });
      if (a.revaluation) entries.push({ debit: '30908000', credit: '30908000', amount: a.revaluation, costCenterId: a.costCenterId, text: `${a.inventoryNo}: дооценка (30908) ${fromCc} → ${a.costCenterId}` });
    } else if (op.type === 'transfer_branch') {
      // Межфилиальная передача с баланса на баланс через счёт межфилиальных расчётов.
      entries.push({ debit: '16103000', credit: g.account, amount: a.cost, costCenterId: fromCc, text: `${a.inventoryNo}: выбытие с баланса филиала-отправителя` });
      entries.push({ debit: g.depAccount, credit: '16103000', amount: a.accumulated, costCenterId: fromCc, text: `${a.inventoryNo}: износ филиала-отправителя` });
      entries.push({ debit: g.account, credit: '16103000', amount: a.cost, costCenterId: a.costCenterId, text: `${a.inventoryNo}: оприходование на баланс филиала-получателя` });
      entries.push({ debit: '16103000', credit: g.depAccount, amount: a.accumulated, costCenterId: a.costCenterId, text: `${a.inventoryNo}: износ филиала-получателя` });
      if (a.revaluation) entries.push({ debit: '30908000', credit: '30908000', amount: a.revaluation, costCenterId: a.costCenterId, text: `${a.inventoryNo}: дооценка (30908)` });
    }
    a.history.push(historyEvent(user.id, 'status_changed', `${op.orderNo ?? op.number}: ${op.reason}`));
    fire({ type: 'transferred', asset: a, op }, user);
  }
  op.status = 'completed';
  op.completedAt = now();
  const p = post(op.type, op.id, op.orderNo ?? op.number, entries, user);
  if (p) op.postingId = p.id;
  op.history.push(historyEvent(user.id, 'status_changed', `Исполнено${p ? `, проводка ${p.number}` : ''}`));
}

function completeWriteoff(act: AssetWriteoffAct, user: User): void {
  const entries: WmsPostingEntry[] = [];
  for (const aid of act.assetIds) {
    const a = byId(aid);
    if (!a) continue;
    const g = groupById(a.groupId)!;
    const nbv = assetNbv(a);
    if (a.accumulated) entries.push({ debit: g.depAccount, credit: g.account, amount: a.accumulated, costCenterId: a.costCenterId, text: `${a.inventoryNo}: списание износа (ОС-4 ${act.number})` });
    if (nbv) entries.push({ debit: '56920000', credit: g.account, amount: nbv, costCenterId: a.costCenterId, text: `${a.inventoryNo}: остаточная стоимость` });
    if (a.revaluation) entries.push({ debit: '30908000', credit: '45994000', amount: a.revaluation, costCenterId: a.costCenterId, text: `${a.inventoryNo}: реализация дооценки (30908)` });
    a.status = act.kind === 'sale' ? 'sold' : 'written_off';
    a.disposedAt = today();
    statusBeforeWriteoff.delete(aid);
    a.history.push(historyEvent(user.id, 'status_changed', `Выбытие по акту ${act.number}`));
    fire({ type: 'written_off', asset: a, act }, user);
  }
  if (act.kind === 'sale' && act.salePrice) {
    const cc = act.costCenterId;
    entries.push({ debit: '19901000', credit: '45920000', amount: act.salePrice, costCenterId: cc, text: `Продажа ОС по решению Правления ${act.boardDecisionNo ?? ''}` });
    entries.push({ debit: '19901000', credit: '29862000', amount: act.vat ?? 0, costCenterId: cc, text: `НДС ${ASSET_VAT_RATE}% с реализации ОС` });
  }
  act.status = 'completed';
  const p = post('writeoff', act.id, act.number, entries, user);
  if (p) act.postingId = p.id;
  act.history.push(historyEvent(user.id, 'status_changed', `Списание утверждено${p ? `, проводка ${p.number}` : ''}`));
}

/** Прогноз амортизации по годам до полного износа (с учётом метода). */
function schedule(a: AssetRecord): AssetScheduleRow[] {
  const rows: AssetScheduleRow[] = [];
  const sim = { ...a };
  let period = nextPeriod(lastRunPeriod);
  let year = Number(period.slice(0, 4));
  let dep = 0;
  for (let i = 0; i < 12 * 60 && assetNbv(sim) > 0 && rows.length < 12; i++) {
    const m = assetMonthly(sim, period);
    if (m <= 0) break;
    sim.accumulated += m;
    dep += m;
    const np = nextPeriod(period);
    if (np.slice(0, 4) !== period.slice(0, 4) || assetNbv(sim) <= 0) {
      rows.push({ year, depreciation: dep, nbvEnd: assetNbv(sim) });
      dep = 0;
      year = Number(np.slice(0, 4));
    }
    period = np;
  }
  return rows;
}

export interface AssetFilter {
  category?: AssetCategory;
  groupId?: ID;
  status?: AssetStatus;
  departmentId?: ID;
  orgUnitKey?: string;
  responsibleId?: ID;
  search?: string;
  includeDisposed?: boolean;
}

// =============================================================================================
export const assetsApi = {
  listGroups: () => delay(groups),
  listCapRules: () => delay(capRules),
  async saveCapRule(rule: Omit<AssetCapRule, 'id'> & { id?: ID }, user: User) {
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    if (!['16505000', '19907000'].includes(rule.account) || !groupById(rule.groupId)) throw new Error('REQUIRED');
    requireText(rule.description);
    const r = rule.id ? capRules.find((x) => x.id === rule.id) : undefined;
    if (r) Object.assign(r, rule);
    else capRules.push({ ...rule, id: nextId('cr') });
    audit.log({ action: rule.id ? 'update' : 'create', entity: 'asset_cap_rule', entityId: rule.id, details: `${rule.account} → ${rule.groupId}`, user: auditUser(user) });
    emit();
    await delay(null);
  },

  list(filter: AssetFilter = {}) {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      assets
        .filter((a) => filter.includeDisposed || filter.status === 'written_off' || filter.status === 'sold' || isActive(a) || a.status === 'written_off')
        .filter((a) => !filter.category || a.category === filter.category)
        .filter((a) => !filter.groupId || a.groupId === filter.groupId)
        .filter((a) => !filter.status || a.status === filter.status)
        .filter((a) => !filter.departmentId || a.departmentId === filter.departmentId)
        .filter((a) => !filter.orgUnitKey || a.orgUnitKey === filter.orgUnitKey || a.orgUnitKey.startsWith(`${filter.orgUnitKey}-`))
        .filter((a) => !filter.responsibleId || a.responsibleId === filter.responsibleId)
        .filter((a) => !q || a.name.toLowerCase().includes(q) || a.inventoryNo.toLowerCase().includes(q) || a.location.toLowerCase().includes(q) || (a.serialNo ?? '').toLowerCase().includes(q)),
    );
  },
  get: (id: ID) => delay(byId(id)),
  getByInventoryNo: (no: string) => delay(assets.find((a) => a.inventoryNo === no.trim() || assetQrValue(a) === no.trim())),
  getSchedule: (id: ID) => {
    const a = byId(id);
    return delay(a && isActive(a) ? schedule(a) : []);
  },
  /** Открытая (незавершённая) операция по объекту — последующие операции заблокированы. */
  openOperation: (id: ID) => delay(openOp(id) ?? openAct(id)),

  async getStats(): Promise<AssetsStats> {
    const active = assets.filter(isActive);
    return delay({
      count: active.length,
      cost: active.reduce((s, a) => s + a.cost, 0),
      nbv: active.reduce((s, a) => s + assetNbv(a), 0),
      monthlyDepreciation: active.reduce((s, a) => s + assetMonthly(a), 0),
      pendingWriteoff: assets.filter((a) => a.status === 'pending_writeoff').length,
      lastRunPeriod,
      nextPeriod: nextPeriod(lastRunPeriod),
      canRun: nextPeriod(lastRunPeriod) <= currentPeriod(),
      depDay: depSettings.day,
      autoDep: depSettings.auto,
      unfinished: operations.filter((o) => ['pending', 'awaiting_acceptance', 'returned'].includes(o.status)).length + writeoffActs.filter((w) => ['draft', 'commission', 'pending', 'returned'].includes(w.status)).length,
      revaluation: active.reduce((s, a) => s + a.revaluation, 0),
      postingsError: wmsLedger.health('assets').error,
    });
  },

  // ---------- Постановка на учёт ----------
  nextInventoryNo: (groupId: ID) => (groupById(groupId) ? nextInventoryNo(groupId) : ''),
  async registerAsset(input: AssetRegisterInput, user: User): Promise<AssetRecord> {
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    requireText(input.name);
    requireText(input.location);
    const g = groupById(input.groupId);
    if (!g || !input.orgUnitKey || !input.departmentId || !input.costCenterId || !input.responsibleId || !input.acquiredAt) throw new Error('REQUIRED');
    if (!(input.usefulLifeMonths > 0) || !Number.isInteger(input.usefulLifeMonths)) throw new Error('LIFE');
    let cost = input.cost;
    if (input.source === 'lease') {
      if (!input.lease || !input.lease.counterpartyId || !(input.lease.monthly > 0) || !input.lease.from || !input.lease.to || input.lease.to < input.lease.from) throw new Error('LEASE');
      cost = leasePresentValue(input.lease.monthly, input.lease.from, input.lease.to);
    }
    if (!(cost > 0)) throw new Error('COST');
    if (input.source === 'construction') {
      if (!input.fundingAccount || !['16505000', '19907000'].includes(input.fundingAccount)) throw new Error('FUNDING');
      const rule = capRules.find((r) => r.active && r.account === input.fundingAccount && r.groupId === input.groupId);
      if (!rule) throw new Error('NO_CAP_RULE');
      if (cost < rule.minAmount) throw new Error('BELOW_RULE_MIN');
    }
    if (input.allocation?.length && input.allocation.reduce((s, x) => s + x.share, 0) !== 100) throw new Error('ALLOCATION');
    const a = createAsset({ ...input, cost }, user, input.source === 'construction' ? `Капитализация со счёта ${input.fundingAccount}` : undefined);
    const credit = input.source === 'purchase' ? '29802000' : input.source === 'construction' ? input.fundingAccount! : input.source === 'warehouse' ? '19907000' : input.source === 'lease' ? '29840000' : '45994000';
    const p = post('registration', a.id, a.inventoryNo, [{ debit: g.account, credit, amount: a.cost, costCenterId: a.costCenterId, text: `Постановка на учёт ${a.inventoryNo}: ${a.name}` }], user);
    if (p) a.history.push(historyEvent(user.id, 'commented', `Проводка ${p.number}`));
    emit();
    return delay(a);
  },

  /** Корректировка карточки (с фиксацией в истории и журнале аудита). Стоимость, МОЛ и подразделение — только операциями. */
  async correctAsset(id: ID, patch: Partial<Pick<AssetRecord, 'name' | 'location' | 'serialNo' | 'model' | 'warrantyUntil' | 'usefulLifeMonths' | 'method' | 'costCenterId' | 'taxObject' | 'allocation'>>, reason: string, user: User) {
    const a = byId(id);
    if (!a) throw new Error('NOT_FOUND');
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    assertFree(a);
    requireText(reason);
    if (patch.usefulLifeMonths !== undefined && (!(patch.usefulLifeMonths > 0) || !Number.isInteger(patch.usefulLifeMonths))) throw new Error('LIFE');
    if (patch.allocation?.length && patch.allocation.reduce((s, x) => s + x.share, 0) !== 100) throw new Error('ALLOCATION');
    if (patch.name !== undefined) requireText(patch.name);
    fire({ type: 'correcting', asset: a, patch }, user); // терминалы: серийный номер не изменяется (PR-TRM-011)
    const before = clone(a);
    Object.assign(a, patch);
    if (patch.allocation && !patch.allocation.length) delete a.allocation;
    const changes = diffFields(before, a, ['name', 'location', 'serialNo', 'model', 'warrantyUntil', 'usefulLifeMonths', 'method', 'costCenterId', 'taxObject', 'allocation']);
    if (!changes.length) return delay(a);
    a.history.push(historyEvent(user.id, 'commented', `Корректировка карточки: ${reason}`));
    operations.push({ id: nextId('ao'), number: nextNumber('OP'), type: 'correction', assetIds: [a.id], date: today(), status: 'completed', amount: 0, reason, from: Object.fromEntries(changes.map((c) => [c.field, c.from])), to: Object.fromEntries(changes.map((c) => [c.field, c.to])), createdBy: user.id, createdAt: now(), completedAt: now(), history: [historyEvent(user.id, 'created')] });
    audit.log({ action: 'update', entity: 'asset', entityId: a.id, entityLabel: a.inventoryNo, changes, details: reason, user: auditUser(user) });
    fire({ type: 'corrected', asset: a }, user);
    emit();
    return delay(a);
  },

  async setStatus(id: ID, status: 'in_use' | 'repair' | 'conservation', user: User, comment?: string) {
    const a = byId(id);
    if (!a || !['in_use', 'repair', 'conservation'].includes(a.status) || a.status === status) throw new Error('NOT_ALLOWED');
    if (!canManageAsset(a, user)) throw new Error('FORBIDDEN');
    if (openOp(a.id) || openAct(a.id)) throw new Error('BLOCKED_BY_OPEN_OPERATION');
    a.status = status;
    a.history.push(historyEvent(user.id, 'status_changed', comment));
    operations.push({ id: nextId('ao'), number: nextNumber('OP'), type: 'repair', assetIds: [a.id], date: today(), status: 'completed', amount: 0, reason: comment ?? status, to: { status }, createdBy: user.id, createdAt: now(), completedAt: now(), history: [historyEvent(user.id, 'created')] });
    emit();
    await delay(null);
  },

  // ---------- Передачи ----------
  /**
   * Передача: 'mol' — электронный акт, принимает новый МОЛ (E-IMZO); 'dept'/'cbu' — распоряжение, согласование;
   * 'branch' — межфилиальная передача с баланса на баланс (дополнительно финансы); 'category' — смена группы (бухгалтерия, сразу).
   */
  async requestTransfer(input: { assetIds: ID[]; kind: 'mol' | 'dept' | 'cbu' | 'branch' | 'category'; toResponsibleId?: ID; toDepartmentId?: ID; toOrgUnitKey?: string; toCostCenterId?: string; toGroupId?: ID; toLocation?: string; reason: string }, user: User) {
    requireText(input.reason);
    if (!input.assetIds.length) throw new Error('REQUIRED');
    const list = input.assetIds.map((id) => byId(id)).filter((a): a is AssetRecord => !!a);
    if (list.length !== input.assetIds.length) throw new Error('NOT_FOUND');
    list.forEach(assertFree);
    if (input.kind === 'mol') {
      if (!input.toResponsibleId) throw new Error('REQUIRED');
      if (list.some((a) => !canManageAsset(a, user))) throw new Error('FORBIDDEN');
      if (list.some((a) => a.responsibleId === input.toResponsibleId)) throw new Error('SAME_MOL');
    } else if (input.kind === 'category') {
      if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
      const g = input.toGroupId ? groupById(input.toGroupId) : undefined;
      if (!g || list.some((a) => a.groupId === g.id)) throw new Error('REQUIRED');
      const entries: WmsPostingEntry[] = [];
      const op: AssetOperation = { id: nextId('ao'), number: nextNumber('OP'), type: 'category_change', assetIds: input.assetIds, date: today(), status: 'completed', from: { groupId: list[0]!.groupId }, to: { groupId: g.id }, amount: list.reduce((s, a) => s + a.cost, 0), reason: input.reason.trim(), createdBy: user.id, createdAt: now(), completedAt: now(), history: [historyEvent(user.id, 'created')] };
      for (const a of list) {
        const old = groupById(a.groupId)!;
        entries.push({ debit: g.account, credit: old.account, amount: a.cost, costCenterId: a.costCenterId, text: `${a.inventoryNo}: перевод из группы ${old.code} в ${g.code}` });
        a.groupId = g.id;
        a.category = g.category;
        a.history.push(historyEvent(user.id, 'status_changed', `Смена группы ${old.code} → ${g.code}: ${input.reason}`));
      }
      operations.push(op);
      const p = post('category_change', op.id, op.number, entries, user);
      if (p) op.postingId = p.id;
      audit.log({ action: 'update', entity: 'asset', entityId: op.id, entityLabel: op.number, details: `category → ${g.code}`, user: auditUser(user) });
      emit();
      return delay(op);
    } else {
      if (!can(user, 'assets', 'edit') && !can(user, 'assets', 'approve')) throw new Error('FORBIDDEN');
      if (!input.toOrgUnitKey || !input.toDepartmentId || !input.toCostCenterId) throw new Error('REQUIRED');
      if (list.some((a) => a.orgUnitKey === input.toOrgUnitKey && a.costCenterId === input.toCostCenterId)) throw new Error('SAME_UNIT');
    }
    const type: AssetOpType = input.kind === 'mol' ? 'transfer_mol' : input.kind === 'dept' ? 'transfer_dept' : input.kind === 'cbu' ? 'transfer_cbu' : 'transfer_branch';
    const first = list[0]!;
    const op: AssetOperation = {
      id: nextId('ao'), number: nextNumber('OP'), type, assetIds: input.assetIds, date: today(), status: input.kind === 'mol' ? 'awaiting_acceptance' : 'pending',
      from: { responsibleId: first.responsibleId, departmentId: first.departmentId, orgUnitKey: first.orgUnitKey, costCenterId: first.costCenterId },
      to: { ...(input.toResponsibleId ? { responsibleId: input.toResponsibleId } : {}), ...(input.toDepartmentId ? { departmentId: input.toDepartmentId } : {}), ...(input.toOrgUnitKey ? { orgUnitKey: input.toOrgUnitKey } : {}), ...(input.toCostCenterId ? { costCenterId: input.toCostCenterId } : {}), ...(input.toLocation ? { location: input.toLocation } : {}) },
      amount: list.reduce((s, a) => s + assetNbv(a), 0), reason: input.reason.trim(), orderNo: nextNumber(input.kind === 'mol' ? 'AKT' : 'RS'), createdBy: user.id, createdAt: now(),
      history: [historyEvent(user.id, 'created', input.kind === 'mol' ? 'Электронный акт приёма-передачи' : 'Электронное распоряжение сформировано автоматически')],
    };
    operations.push(op);
    for (const a of list) {
      statusBeforeTransfer.set(a.id, a.status);
      a.status = 'pending_transfer';
      a.history.push(historyEvent(user.id, 'submitted', `${op.orderNo}: ${op.reason}`));
    }
    if (input.kind === 'mol') {
      notify({ userIds: [input.toResponsibleId!], kind: 'task', level: 'info', title: L(`Примите ОС по акту ${op.orderNo}`, `${op.orderNo} dalolatnomasi bo‘yicha AVni qabul qiling`, `Accept assets under act ${op.orderNo}`), body: list.map((a) => a.inventoryNo).join(', '), link: `/assets/operations/${op.id}`, dedupeKey: `as-acc:${op.id}` });
    } else {
      approvalEngine.open({ entity: 'asset_transfer', entityId: op.id, number: op.orderNo!, title: `Передача ОС (${list.map((a) => a.inventoryNo).join(', ')}): ${op.reason}`, requesterId: user.id, amount: op.amount, context: { subtype: input.kind, departmentId: first.departmentId, branchId: first.orgUnitKey, costCenterId: first.costCenterId } });
    }
    audit.log({ action: 'submit', entity: 'asset_operation', entityId: op.id, entityLabel: op.number, details: `${type} ${input.assetIds.join(',')}`, user: auditUser(user) });
    emit();
    return delay(op);
  },
  /** Новый МОЛ принимает ОС по электронному акту (подпись E-IMZO) или отказывается. */
  async acceptTransfer(opId: ID, signatureId: ID | null, user: User, rejectReason?: string) {
    const op = operations.find((o) => o.id === opId);
    if (!op || op.status !== 'awaiting_acceptance') throw new Error('NOT_ALLOWED');
    if (op.to?.responsibleId !== user.id && user.role !== 'admin') throw new Error('FORBIDDEN');
    if (!signatureId) {
      requireText(rejectReason);
      op.status = 'rejected';
      op.assetIds.forEach((aid) => {
        const a = byId(aid);
        if (a) a.status = statusBeforeTransfer.get(aid) ?? 'in_use';
        if (a && a.status === 'pending_transfer') a.status = 'in_use';
        a?.history.push(historyEvent(user.id, 'rejected', rejectReason));
      });
      op.history.push(historyEvent(user.id, 'rejected', rejectReason));
      emit();
      return delay(op);
    }
    const sig = signatureService.get(signatureId);
    if (!sig || sig.entityId !== op.id || sig.userId !== user.id) throw new Error('SIGNATURE');
    op.acceptance = { userId: user.id, signatureId, at: now() };
    op.history.push(historyEvent(user.id, 'approved', 'Принято по акту (E-IMZO)'));
    applyTransfer(op, user);
    audit.log({ action: 'approve', entity: 'asset_operation', entityId: op.id, entityLabel: op.number, details: 'accepted', user: auditUser(user) });
    emit();
    return delay(op);
  },
  async cancelOperation(opId: ID, user: User) {
    const op = operations.find((o) => o.id === opId);
    if (!op || !['awaiting_acceptance', 'returned'].includes(op.status)) throw new Error('NOT_ALLOWED');
    if (op.createdBy !== user.id && !canAccountAssets(user)) throw new Error('FORBIDDEN');
    op.status = 'cancelled';
    op.assetIds.forEach((aid) => {
      const a = byId(aid);
      if (a) a.status = statusBeforeTransfer.get(aid) ?? 'in_use';
      if (a && a.status === 'pending_transfer') a.status = 'in_use';
    });
    op.history.push(historyEvent(user.id, 'status_changed', 'Отменено'));
    emit();
    await delay(null);
  },
  listOperations(filter: { type?: AssetOpType | ''; status?: string; assetId?: ID; search?: string } = {}) {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      operations
        .filter((o) => !filter.type || o.type === filter.type)
        .filter((o) => !filter.status || o.status === filter.status)
        .filter((o) => !filter.assetId || o.assetIds.includes(filter.assetId))
        .filter((o) => !q || o.number.toLowerCase().includes(q) || (o.orderNo ?? '').toLowerCase().includes(q) || o.reason.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },
  getOperation: (id: ID) => delay(operations.find((o) => o.id === id)),

  // ---------- Переоценка, включение в состав, аренда ----------
  async revalue(id: ID, newNbv: number, reason: string, user: User) {
    const a = byId(id);
    if (!a) throw new Error('NOT_FOUND');
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    assertFree(a);
    requireText(reason);
    if (!(newNbv >= 0)) throw new Error('COST');
    const g = groupById(a.groupId)!;
    const diff = Math.round(newNbv - assetNbv(a));
    if (!diff) throw new Error('NO_CHANGE');
    const entries: WmsPostingEntry[] = [];
    const before = { cost: a.cost, revaluation: a.revaluation };
    if (diff > 0) {
      a.cost += diff;
      a.revaluation += diff;
      entries.push({ debit: g.account, credit: '30908000', amount: diff, costCenterId: a.costCenterId, text: `${a.inventoryNo}: дооценка` });
    } else {
      const down = -diff;
      const fromReserve = Math.min(down, a.revaluation);
      a.cost -= down;
      a.revaluation -= fromReserve;
      if (fromReserve) entries.push({ debit: '30908000', credit: g.account, amount: fromReserve, costCenterId: a.costCenterId, text: `${a.inventoryNo}: уценка за счёт дооценки` });
      if (down - fromReserve) entries.push({ debit: '56920000', credit: g.account, amount: down - fromReserve, costCenterId: a.costCenterId, text: `${a.inventoryNo}: уценка (расход)` });
    }
    const op: AssetOperation = { id: nextId('ao'), number: nextNumber('OP'), type: 'revaluation', assetIds: [a.id], date: today(), status: 'completed', from: before, to: { cost: a.cost, revaluation: a.revaluation }, amount: diff, reason: reason.trim(), createdBy: user.id, createdAt: now(), completedAt: now(), history: [historyEvent(user.id, 'created')] };
    operations.push(op);
    const p = post('revaluation', op.id, op.number, entries, user);
    if (p) op.postingId = p.id;
    a.history.push(historyEvent(user.id, 'commented', `Переоценка ${diff > 0 ? '+' : ''}${diff}: ${reason}`));
    audit.log({ action: 'update', entity: 'asset', entityId: a.id, entityLabel: a.inventoryNo, changes: diffFields(before, { cost: a.cost, revaluation: a.revaluation }), details: `revaluation: ${reason}`, user: auditUser(user) });
    emit();
    return delay(op);
  },
  /** Включение в состав: капремонт/доп. части/модернизация увеличивают стоимость (Дт ОС — Кт 16505/19907). */
  async addComponent(id: ID, input: { kind: AssetComponent['kind']; amount: number; description: string; fundingAccount: string; extendLifeMonths?: number }, user: User) {
    const a = byId(id);
    if (!a) throw new Error('NOT_FOUND');
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    assertFree(a);
    requireText(input.description);
    if (!(input.amount > 0)) throw new Error('COST');
    if (!['16505000', '19907000'].includes(input.fundingAccount)) throw new Error('FUNDING');
    const g = groupById(a.groupId)!;
    const c: AssetComponent = { id: nextId('cmp'), date: today(), kind: input.kind, amount: Math.round(input.amount), description: input.description.trim(), fundingAccount: input.fundingAccount };
    a.components.push(c);
    a.cost += c.amount;
    if (input.extendLifeMonths && input.extendLifeMonths > 0) a.usefulLifeMonths += input.extendLifeMonths;
    const op: AssetOperation = { id: nextId('ao'), number: nextNumber('OP'), type: 'improvement', assetIds: [a.id], date: today(), status: 'completed', to: { component: c.id, amount: c.amount }, amount: c.amount, reason: c.description, createdBy: user.id, createdAt: now(), completedAt: now(), history: [historyEvent(user.id, 'created')] };
    operations.push(op);
    const p = post('improvement', op.id, op.number, [{ debit: g.account, credit: c.fundingAccount, amount: c.amount, costCenterId: a.costCenterId, text: `${a.inventoryNo}: ${c.description}` }], user);
    if (p) op.postingId = p.id;
    a.history.push(historyEvent(user.id, 'commented', `Включение в состав: ${c.description} (+${c.amount})`));
    audit.log({ action: 'update', entity: 'asset', entityId: a.id, entityLabel: a.inventoryNo, changes: [{ field: 'cost', from: String(a.cost - c.amount), to: String(a.cost) }], details: c.description, user: auditUser(user) });
    emit();
    return delay(c);
  },
  /** Выделение ошибочно включённой части (обратная проводка). */
  async separateComponent(id: ID, componentId: ID, reason: string, user: User) {
    const a = byId(id);
    if (!a) throw new Error('NOT_FOUND');
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    assertFree(a);
    requireText(reason);
    const c = a.components.find((x) => x.id === componentId && !x.separatedAt);
    if (!c) throw new Error('NOT_ALLOWED');
    if (a.cost - c.amount < a.accumulated) throw new Error('SEPARATE_NBV');
    const g = groupById(a.groupId)!;
    a.cost -= c.amount;
    c.separatedAt = today();
    c.separatedReason = reason.trim();
    const op: AssetOperation = { id: nextId('ao'), number: nextNumber('OP'), type: 'separation', assetIds: [a.id], date: today(), status: 'completed', from: { component: c.id, amount: c.amount }, amount: -c.amount, reason: reason.trim(), createdBy: user.id, createdAt: now(), completedAt: now(), history: [historyEvent(user.id, 'created')] };
    operations.push(op);
    const p = post('separation', op.id, op.number, [{ debit: c.fundingAccount, credit: g.account, amount: c.amount, costCenterId: a.costCenterId, text: `${a.inventoryNo}: выделение «${c.description}» — ${reason}` }], user);
    if (p) op.postingId = p.id;
    a.history.push(historyEvent(user.id, 'commented', `Выделено из состава: ${c.description} (−${c.amount}): ${reason}`));
    emit();
    return delay(op);
  },
  /** Передача в аренду (сдача) и возврат из аренды. */
  async leaseOut(id: ID, lease: Omit<AssetLease, 'direction'> | null, user: User) {
    const a = byId(id);
    if (!a) throw new Error('NOT_FOUND');
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    if (lease) {
      assertFree(a);
      if (!lease.counterpartyId || !(lease.monthly > 0) || !lease.from || !lease.to || lease.to < lease.from) throw new Error('LEASE');
      a.lease = { ...lease, direction: 'out' };
      a.status = 'leased_out';
      const op: AssetOperation = { id: nextId('ao'), number: nextNumber('OP'), type: 'lease_out', assetIds: [a.id], date: today(), status: 'completed', to: { counterpartyId: lease.counterpartyId, monthly: lease.monthly, from: lease.from, to: lease.to }, amount: lease.monthly, reason: `Передача в аренду до ${lease.to}`, createdBy: user.id, createdAt: now(), completedAt: now(), history: [historyEvent(user.id, 'created')] };
      operations.push(op);
      const p = post('lease_out', op.id, op.number, [{ debit: '19901000', credit: '45930000', amount: lease.monthly, costCenterId: a.costCenterId, text: `${a.inventoryNo}: арендный доход за первый месяц` }], user);
      if (p) op.postingId = p.id;
      a.history.push(historyEvent(user.id, 'status_changed', `Передан в аренду (${lease.from} — ${lease.to})`));
    } else {
      if (a.status !== 'leased_out') throw new Error('NOT_ALLOWED');
      a.status = 'in_use';
      delete a.lease;
      operations.push({ id: nextId('ao'), number: nextNumber('OP'), type: 'lease_end', assetIds: [a.id], date: today(), status: 'completed', amount: 0, reason: 'Возврат из аренды', createdBy: user.id, createdAt: now(), completedAt: now(), history: [historyEvent(user.id, 'created')] });
      a.history.push(historyEvent(user.id, 'status_changed', 'Возвращён из аренды'));
    }
    emit();
    await delay(null);
  },

  // ---------- Амортизация ----------
  depreciationSettings: () => delay({ ...depSettings }),
  async setDepreciationSettings(day: number, auto: boolean, user: User) {
    if (!canRunDepreciation(user)) throw new Error('FORBIDDEN');
    if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error('DAY');
    audit.log({ action: 'settings', entity: 'asset_depreciation', details: `day ${depSettings.day} → ${day}, auto ${auto}`, user: auditUser(user) });
    depSettings.day = day;
    depSettings.auto = auto;
    emit();
    await delay(null);
  },
  /** Проверка перед начислением: у каждого объекта есть группа, МВЗ и срок полезного использования. */
  depreciationErrors(): { assetId: ID; inventoryNo: string; problem: 'no_cc' | 'no_life' | 'allocation' }[] {
    const out: { assetId: ID; inventoryNo: string; problem: 'no_cc' | 'no_life' | 'allocation' }[] = [];
    for (const a of assets.filter(isActive)) {
      if (!a.costCenterId) out.push({ assetId: a.id, inventoryNo: a.inventoryNo, problem: 'no_cc' });
      if (!(a.usefulLifeMonths > 0)) out.push({ assetId: a.id, inventoryNo: a.inventoryNo, problem: 'no_life' });
      if (a.allocation?.length && a.allocation.reduce((s, x) => s + x.share, 0) !== 100) out.push({ assetId: a.id, inventoryNo: a.inventoryNo, problem: 'allocation' });
    }
    return out;
  },
  /** Ежемесячное начисление (централизованно): проводки Дт расходы (по МВЗ, с аллокацией) — Кт накопленная амортизация. */
  async runDepreciation(user: User, auto = false): Promise<AssetsRunResult> {
    if (!auto && !canRunDepreciation(user)) throw new Error('FORBIDDEN');
    const period = nextPeriod(lastRunPeriod);
    if (period > currentPeriod()) throw new Error('ALREADY_RUN');
    if (assetsApi.depreciationErrors().length) throw new Error('DEP_ERRORS');
    const lines: AssetDepRun['lines'] = [];
    const byCc = new Map<string, number>();
    for (const a of assets) {
      if (!isActive(a) || a.status === 'missing') continue;
      const dep = assetMonthly(a, period);
      if (dep <= 0) continue;
      a.accumulated += dep;
      lines.push({ assetId: a.id, amount: dep, costCenterId: a.costCenterId, method: a.method });
      const shares = a.allocation?.length ? a.allocation : [{ costCenterId: a.costCenterId, share: 100 }];
      let rest = dep;
      shares.forEach((s, i) => {
        const part = i === shares.length - 1 ? rest : Math.round((dep * s.share) / 100);
        rest -= part;
        byCc.set(s.costCenterId, (byCc.get(s.costCenterId) ?? 0) + part);
      });
      a.history.push(historyEvent(user.id, 'commented', `Амортизация / Amortizatsiya ${period}: ${dep.toLocaleString('ru-RU').replace(/ /g, ' ')} UZS`));
    }
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const run: AssetDepRun = { id: nextId('dr'), period, at: now(), by: user.id, auto, lines, total };
    const p = post('depreciation', run.id, `AM-${period}`, [...byCc.entries()].map(([cc, amount]) => ({ debit: '56320000', credit: '16599000', amount, costCenterId: cc, text: `Амортизация ОС за ${period}` })), user);
    if (p) run.postingId = p.id;
    depRuns.push(run);
    lastRunPeriod = period;
    audit.log({ action: 'create', entity: 'asset_depreciation', entityId: run.id, entityLabel: period, details: `${lines.length} · ${total}${auto ? ' (auto)' : ''}`, user: auditUser(user) });
    if (auto) notify({ roles: ['accountant'], kind: 'system', level: 'success', title: L(`Амортизация за ${period} начислена автоматически`, `${period} uchun amortizatsiya avtomatik hisoblandi`, `Depreciation for ${period} charged automatically`), body: `${lines.length} · ${total.toLocaleString('ru-RU')} UZS`, link: '/assets/depreciation', dedupeKey: `as-dep:${period}` });
    emit();
    return delay({ period, assets: lines.length, amount: total });
  },
  /** Автозапуск: в установленный день месяца, если период ещё не закрыт и ошибок нет. */
  async ensureAutoDepreciation(user: User): Promise<AssetsRunResult | undefined> {
    const period = nextPeriod(lastRunPeriod);
    if (!depSettings.auto || period > currentPeriod() || Number(today().slice(8, 10)) < depSettings.day) return undefined;
    if (assetsApi.depreciationErrors().length) {
      notify({ roles: ['accountant'], kind: 'system', level: 'danger', title: L(`Автоначисление амортизации за ${period} остановлено: ошибки в карточках`, `${period} amortizatsiyasi to‘xtatildi: kartochkalarda xatolar`, `Auto depreciation for ${period} stopped: card errors`), link: '/assets/depreciation', dedupeKey: `as-dep-err:${period}` });
      return undefined;
    }
    return assetsApi.runDepreciation(user, true);
  },
  listDepRuns: () => delay([...depRuns].reverse()),
  /** Отчёт по начисленному износу в разрезе карточек за период (YYYY-MM … YYYY-MM). */
  async depreciationReport(from: string, to: string) {
    const rows = new Map<ID, { asset: AssetRecord; amount: number; periods: number; costCenterId: string }>();
    for (const r of depRuns.filter((x) => x.period >= from && x.period <= to)) {
      for (const l of r.lines) {
        const a = byId(l.assetId);
        if (!a) continue;
        const row = rows.get(a.id) ?? { asset: a, amount: 0, periods: 0, costCenterId: l.costCenterId };
        row.amount += l.amount;
        row.periods++;
        rows.set(a.id, row);
      }
    }
    return delay([...rows.values()].sort((a, b) => b.amount - a.amount));
  },

  // ---------- Списание (акт ОС-4) ----------
  listWriteoffs: (filter: { status?: string; kind?: AssetWriteoffKind | '' } = {}) => delay(writeoffActs.filter((w) => (!filter.status || w.status === filter.status) && (!filter.kind || w.kind === filter.kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getWriteoff: (id: ID) => delay(writeoffActs.find((w) => w.id === id)),
  async createWriteoff(input: { kind: AssetWriteoffKind; assetIds: ID[]; reason: string; commission: AssetWriteoffAct['commission']; salePrice?: number; boardDecisionNo?: string; buyerId?: ID; recipient?: string; source?: 'manual' | 'excel' }, user: User) {
    if (!can(user, 'assets', 'edit') && !input.assetIds.every((id) => byId(id)?.responsibleId === user.id)) throw new Error('FORBIDDEN');
    requireText(input.reason);
    if (!input.assetIds.length) throw new Error('REQUIRED');
    requireText(input.commission.protocolNo);
    if (!input.commission.chairmanId || input.commission.memberIds.length < 2) throw new Error('COMMISSION');
    if (input.kind === 'sale') {
      if (!(Number(input.salePrice) > 0)) throw new Error('SALE_PRICE');
      requireText(input.boardDecisionNo);
    }
    if (input.kind === 'gratuitous') requireText(input.recipient);
    const list = input.assetIds.map((id) => byId(id)).filter((a): a is AssetRecord => !!a);
    if (list.length !== input.assetIds.length) throw new Error('NOT_FOUND');
    list.forEach(assertFree);
    const act: AssetWriteoffAct = {
      id: nextId('wo'), number: nextNumber('WO'), kind: input.kind, date: today(), assetIds: input.assetIds, reason: input.reason.trim(), commission: { ...input.commission, protocolNo: input.commission.protocolNo.trim() }, commissionSignatures: [],
      ...(input.kind === 'sale' ? { salePrice: Math.round(input.salePrice!), vat: Math.round((input.salePrice! * ASSET_VAT_RATE) / 100), boardDecisionNo: input.boardDecisionNo!.trim(), ...(input.buyerId ? { buyerId: input.buyerId } : {}) } : {}),
      ...(input.recipient ? { recipient: input.recipient.trim() } : {}),
      nbv: list.reduce((s, a) => s + assetNbv(a), 0), costCenterId: list[0]!.costCenterId, status: 'draft', source: input.source ?? 'manual', createdBy: user.id, createdAt: now(), history: [historyEvent(user.id, 'created')],
    };
    for (const a of list) fire({ type: 'writeoff_requested', asset: a, act }, user); // может заблокировать (терминал не свободен)
    writeoffActs.push(act);
    for (const a of list) {
      statusBeforeWriteoff.set(a.id, a.status);
      a.status = 'pending_writeoff';
      a.history.push(historyEvent(user.id, 'submitted', `Акт ОС-4 ${act.number}: ${act.reason}`));
    }
    audit.log({ action: 'create', entity: 'asset_writeoff', entityId: act.id, entityLabel: act.number, details: `${act.kind} ${act.assetIds.length}`, user: auditUser(user) });
    emit();
    return delay(act);
  },
  async sendWriteoffToCommission(id: ID, user: User) {
    const act = writeoffActs.find((w) => w.id === id);
    if (!act || (act.status !== 'draft' && act.status !== 'returned')) throw new Error('NOT_ALLOWED');
    if (act.createdBy !== user.id && !canAccountAssets(user)) throw new Error('FORBIDDEN');
    act.status = 'commission';
    act.commissionSignatures = [];
    act.history.push(historyEvent(user.id, 'submitted', 'Протокол передан комиссии по списанию'));
    notify({ userIds: [act.commission.chairmanId, ...act.commission.memberIds], kind: 'task', level: 'info', title: L(`Подписать протокол списания ${act.number}`, `${act.number} hisobdan chiqarish bayonnomasini imzolash`, `Sign write-off protocol ${act.number}`), body: act.reason, link: `/assets/writeoffs/${act.id}`, dedupeKey: `as-wo:${act.id}:${act.history.length}` });
    emit();
    await delay(null);
  },
  /** Подпись протокола членом комиссии; после всех подписей — согласование (продажа — с решением Правления). */
  async signWriteoff(id: ID, signatureId: ID, user: User) {
    const act = writeoffActs.find((w) => w.id === id);
    if (!act || act.status !== 'commission') throw new Error('NOT_ALLOWED');
    const members = [act.commission.chairmanId, ...act.commission.memberIds];
    if (!members.includes(user.id)) throw new Error('FORBIDDEN');
    if (act.commissionSignatures.some((s) => s.userId === user.id)) throw new Error('ALREADY_SIGNED');
    const sig = signatureService.get(signatureId);
    if (!sig || sig.entityId !== act.id || sig.userId !== user.id) throw new Error('SIGNATURE');
    act.commissionSignatures.push({ userId: user.id, signatureId, at: now() });
    act.history.push(historyEvent(user.id, 'approved', 'Подпись члена комиссии E-IMZO'));
    if (members.every((m) => act.commissionSignatures.some((s) => s.userId === m))) {
      act.status = 'pending';
      const amount = act.kind === 'sale' ? (act.salePrice ?? 0) : act.nbv;
      if (approvalEngine.instancesFor(act.id).length) approvalEngine.resubmit(act.id, { id: act.createdBy } as User);
      else approvalEngine.open({ entity: 'asset_writeoff', entityId: act.id, number: act.number, title: `Списание ОС (${act.assetIds.map((x) => byId(x)?.inventoryNo).join(', ')}): ${act.reason}`, requesterId: act.createdBy, amount, context: { subtype: act.kind, costCenterId: act.costCenterId } });
    }
    emit();
    await delay(null);
  },

  // ---------- Инвентаризация (QR/NFC) ----------
  listInventories: () => delay([...inventories].sort((a, b) => b.date.localeCompare(a.date))),
  getInventory: (id: ID) => delay(inventories.find((v) => v.id === id)),
  async createInventory(input: { orgUnitKey: string; method: 'qr' | 'list'; commission: AssetInventory['commission'] }, user: User) {
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    requireText(input.commission.orderNo);
    if (!input.orgUnitKey) throw new Error('REQUIRED');
    if (!input.commission.chairmanId || input.commission.memberIds.length < 2) throw new Error('COMMISSION');
    const list = assets.filter((a) => isActive(a) && (a.orgUnitKey === input.orgUnitKey || a.orgUnitKey.startsWith(`${input.orgUnitKey}-`)));
    if (!list.length) throw new Error('EMPTY');
    const v: AssetInventory = { id: nextId('ai'), number: nextNumber('INV-OS'), orgUnitKey: input.orgUnitKey, method: input.method, commission: { ...input.commission, orderNo: input.commission.orderNo.trim() }, date: today(), status: 'counting', lines: list.map((a) => ({ assetId: a.id, found: false })), createdBy: user.id, history: [historyEvent(user.id, 'created')] };
    inventories.push(v);
    audit.log({ action: 'create', entity: 'asset_inventory', entityId: v.id, entityLabel: v.number, user: auditUser(user) });
    emit();
    return delay(v);
  },
  /** Отметка наличия и состояния: по QR/инв. номеру (code) или по строке списка (assetId); неизвестный код — излишек. */
  async markInventory(id: ID, entry: { assetId?: ID; code?: string; found?: boolean; condition?: AssetCondition; note?: string; surplus?: { name: string; groupId: ID; cost: number } }, user: User) {
    const v = inventories.find((x) => x.id === id);
    if (!v || v.status !== 'counting') throw new Error('NOT_ALLOWED');
    if (!canAccountAssets(user) && ![v.commission.chairmanId, ...v.commission.memberIds].includes(user.id)) throw new Error('FORBIDDEN');
    let line = entry.assetId ? v.lines.find((l) => l.assetId === entry.assetId) : undefined;
    if (!line && entry.code) {
      const code = entry.code.trim();
      const a = assets.find((x) => x.inventoryNo === code || assetQrValue(x) === code || x.nfcTagId === code);
      line = a ? v.lines.find((l) => l.assetId === a.id) : undefined;
      if (!line) {
        if (entry.surplus) {
          requireText(entry.surplus.name);
          if (!groupById(entry.surplus.groupId) || !(entry.surplus.cost > 0)) throw new Error('REQUIRED');
          line = { surplus: { ...entry.surplus, code }, found: true, condition: entry.condition ?? 'good', ...(entry.note ? { note: entry.note } : {}), scannedAt: now() };
          v.lines.push(line);
          emit();
          return delay({ status: 'surplus' as const });
        }
        return delay({ status: a ? ('other_unit' as const) : ('unknown' as const) });
      }
    }
    if (!line) throw new Error('NOT_FOUND');
    line.found = entry.found ?? true;
    if (entry.condition) line.condition = entry.condition;
    if (entry.note !== undefined) line.note = entry.note;
    line.scannedAt = now();
    emit();
    return delay({ status: 'ok' as const });
  },
  async completeInventory(id: ID, user: User) {
    const v = inventories.find((x) => x.id === id);
    if (!v || v.status !== 'counting') throw new Error('NOT_ALLOWED');
    if (!canAccountAssets(user) && v.commission.chairmanId !== user.id) throw new Error('FORBIDDEN');
    v.status = 'completed';
    v.history.push(historyEvent(user.id, 'status_changed', 'Инвентаризационная ведомость сформирована'));
    emit();
    await delay(null);
  },
  /** Утверждение итогов: недостача → статус «Не обнаружено» и уведомление; излишек → постановка на учёт (источник «излишек»). */
  async approveInventory(id: ID, user: User) {
    const v = inventories.find((x) => x.id === id);
    if (!v || v.status !== 'completed') throw new Error('NOT_ALLOWED');
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    for (const l of v.lines) {
      if (l.assetId) {
        const a = byId(l.assetId);
        if (!a) continue;
        a.lastInventoryAt = v.date;
        if (!l.found) {
          a.status = 'missing';
          a.history.push(historyEvent(user.id, 'status_changed', `Не обнаружен при инвентаризации ${v.number}`));
          notify({ roles: ['accountant'], userIds: [a.responsibleId], kind: 'system', level: 'danger', title: L(`Недостача ОС: ${a.inventoryNo}`, `AV kamomadi: ${a.inventoryNo}`, `Asset shortage: ${a.inventoryNo}`), body: a.name, link: `/assets/${a.id}`, dedupeKey: `as-miss:${a.id}:${v.id}` });
        } else if (l.condition === 'unusable') a.history.push(historyEvent(user.id, 'commented', `Инвентаризация ${v.number}: непригоден — рекомендовано списание`));
      } else if (l.surplus) {
        const g = groupById(l.surplus.groupId)!;
        const a = createAsset({ name: l.surplus.name, groupId: g.id, orgUnitKey: v.orgUnitKey, departmentId: 'd2', costCenterId: 'CC0006', responsibleId: v.commission.chairmanId, acquiredAt: v.date, cost: l.surplus.cost, usefulLifeMonths: g.usefulLifeMonths, method: g.method, source: 'surplus', location: v.orgUnitKey }, user, `Излишек по инвентаризации ${v.number}`);
        post('registration', a.id, a.inventoryNo, [{ debit: g.account, credit: '45994000', amount: a.cost, costCenterId: a.costCenterId, text: `Излишек ОС ${a.inventoryNo} (${v.number})` }], user);
        l.assetId = a.id;
      }
    }
    v.status = 'approved';
    v.approvedBy = user.id;
    v.approvedAt = now();
    v.history.push(historyEvent(user.id, 'approved', 'Итоги инвентаризации утверждены'));
    audit.log({ action: 'approve', entity: 'asset_inventory', entityId: v.id, entityLabel: v.number, user: auditUser(user) });
    emit();
    await delay(null);
  },
  /** Привязка NFC-метки (идентификатор записан мобильным устройством или Web NFC). */
  async setNfcTag(id: ID, tagId: string, user: User) {
    const a = byId(id);
    if (!a) throw new Error('NOT_FOUND');
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    requireText(tagId);
    if (assets.some((x) => x.id !== id && x.nfcTagId === tagId.trim())) throw new Error('NFC_DUP');
    const before = a.nfcTagId ?? '';
    a.nfcTagId = tagId.trim();
    audit.log({ action: 'update', entity: 'asset', entityId: a.id, entityLabel: a.inventoryNo, changes: [{ field: 'nfcTagId', from: before, to: a.nfcTagId }], user: auditUser(user) });
    emit();
    await delay(null);
  },

  // ---------- Кадровая проверка ----------
  async holdings(userId: ID): Promise<AssetHoldings> {
    const list = holdingsSync(userId);
    const m = await warehouseApi.listMbp({ responsibleId: userId });
    return delay({
      userId,
      allowed: !list.length && !m.length,
      assets: list.map((a) => ({ id: a.id, inventoryNo: a.inventoryNo, name: a.name, nbv: assetNbv(a) })),
      mbp: m.map((r) => ({ id: r.id, number: r.number, name: r.name, qty: r.qty, amount: r.qty * r.unitCost })),
    });
  },

  // ---------- Налоги по объектам недвижимости ----------
  taxObjects() {
    const year = Number(today().slice(0, 4));
    return delay(
      assets
        .filter((a) => a.taxObject && isActive(a))
        .map((a) => {
          const avgNbv = Math.round(assetNbv(a) + (assetMonthly(a) * 6));
          const propertyTax = a.taxObject!.kind === 'building' ? Math.round((avgNbv * ASSET_TAX_RATES.property) / 100) : 0;
          const landTax = Math.round((a.taxObject!.landArea ?? (a.taxObject!.kind === 'land' ? a.taxObject!.area : 0)) * ASSET_TAX_RATES.landPerSqm);
          return { asset: a, year, avgNbv, propertyTax, landTax, total: propertyTax + landTax };
        }),
    );
  },
  async sendTaxDeclaration(user: User) {
    if (!canAccountAssets(user)) throw new Error('FORBIDDEN');
    const rows = await assetsApi.taxObjects();
    const r = await integrationHub.call('soliq', 'property.declare', { year: Number(today().slice(0, 4)), objects: rows.map((x) => ({ cadastralNo: x.asset.taxObject!.cadastralNo, inventoryNo: x.asset.inventoryNo, propertyTax: x.propertyTax, landTax: x.landTax })), total: rows.reduce((s, x) => s + x.total, 0) }, { userId: user.id });
    audit.log({ action: 'export', entity: 'asset_tax', entityId: r.id, details: `soliq property.declare → ${r.status}`, user: auditUser(user) });
    emit();
    return r;
  },

  // ---------- Мониторинг ----------
  reconciliation: () => delay(reconRows()),
  listMonitoringRuns: () => delay([...monitoringRuns].reverse()),
  async runMonitoring(user: User, auto = false) {
    if (!auto && !canAccountAssets(user)) throw new Error('FORBIDDEN');
    const rows = reconRows();
    await wmsLedger.requestBalances(rows.map((r) => r.account), user.id);
    const unfinished = operations.filter((o) => ['pending', 'awaiting_acceptance', 'returned'].includes(o.status)).length + writeoffActs.filter((w) => ['draft', 'commission', 'pending', 'returned'].includes(w.status)).length;
    const full = assets.filter((a) => isActive(a) && assetNbv(a) <= 0);
    const run = { id: nextId('mr'), at: now(), by: user.id, auto, rows, discrepancies: rows.filter((r) => r.diff).length, unfinished, fullyDepreciated: full.length };
    monitoringRuns.push(run);
    const t = today();
    if (run.discrepancies) notify({ roles: ['accountant'], kind: 'system', level: 'danger', title: L(`Расхождение ОС с iABS: ${run.discrepancies}`, `AV va iABS farqi: ${run.discrepancies}`, `PP&E vs iABS discrepancies: ${run.discrepancies}`), body: rows.filter((r) => r.diff).map((r) => `${r.account}: ${r.diff}`).join('; '), link: '/assets/monitoring', dedupeKey: `as-recon:${t}:${run.discrepancies}` });
    // Уведомления по годам эксплуатации: полный износ и «юбилеи» (каждые 5 лет).
    for (const a of assets.filter(isActive)) {
      const years = Math.floor(monthsBetween(a.acquiredAt, t) / 12);
      if (assetNbv(a) <= 0) notify({ userIds: [a.responsibleId], roles: ['accountant'], kind: 'system', level: 'info', title: L(`Полный износ: ${a.inventoryNo}`, `To‘liq eskirish: ${a.inventoryNo}`, `Fully depreciated: ${a.inventoryNo}`), body: L(`${a.name} — ${years} лет эксплуатации; рассмотрите списание или переоценку`, `${a.name} — ${years} yil foydalanish; hisobdan chiqarish yoki qayta baholashni ko‘rib chiqing`, `${a.name} — ${years} years in use; consider write-off or revaluation`), link: `/assets/${a.id}`, dedupeKey: `as-full:${a.id}` });
      else if (years > 0 && years % 5 === 0) notify({ userIds: [a.responsibleId], kind: 'system', level: 'info', title: L(`${years} лет эксплуатации: ${a.inventoryNo}`, `${years} yil foydalanish: ${a.inventoryNo}`, `${years} years in use: ${a.inventoryNo}`), body: a.name, link: `/assets/${a.id}`, dedupeKey: `as-years:${a.id}:${years}` });
    }
    emit();
    return delay(run);
  },
  async ensureDailyMonitoring(user: User) {
    if (monitoringRuns.some((r) => r.at.slice(0, 10) === today())) return;
    await assetsApi.runMonitoring(user, true);
  },
  /** Отчёт о наличии и движении ОС за период по группам (форма для ЦБ/статистики, демо). */
  async movementReport(from: string, to: string) {
    const rows = groups.map((g) => {
      const mine = assets.filter((a) => a.groupId === g.id);
      const inP = (d?: string) => !!d && d >= from && d <= to;
      const added = mine.filter((a) => inP(a.acquiredAt));
      const disposed = mine.filter((a) => inP(a.disposedAt));
      const closingAssets = mine.filter((a) => isActive(a));
      const closingCost = closingAssets.reduce((s, a) => s + a.cost, 0);
      const addedCost = added.reduce((s, a) => s + a.cost, 0);
      const disposedCost = disposed.reduce((s, a) => s + a.cost, 0);
      const dep = depRuns.filter((r) => r.period >= from.slice(0, 7) && r.period <= to.slice(0, 7)).reduce((s, r) => s + r.lines.filter((l) => byId(l.assetId)?.groupId === g.id).reduce((x, l) => x + l.amount, 0), 0);
      return { group: g, opening: closingCost - addedCost + disposedCost, added: addedCost, disposed: disposedCost, closing: closingCost, depreciation: dep, nbv: closingAssets.reduce((s, a) => s + assetNbv(a), 0), count: closingAssets.length };
    });
    return delay(rows);
  },
  /** Динамика по месяцам (поступление/выбытие) и разрезы — для дашборда. */
  async dashboard() {
    const months: string[] = [];
    const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
    for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
    const opsBy = (types: AssetOpType[], m: string) => operations.filter((o) => types.includes(o.type) && o.status === 'completed' && o.date.startsWith(m)).reduce((s, o) => s + Math.abs(o.amount), 0);
    const added = months.map((m) => assets.filter((a) => a.acquiredAt.startsWith(m)).reduce((s, a) => s + a.cost, 0));
    const disposed = months.map((m) => assets.filter((a) => a.disposedAt?.startsWith(m)).reduce((s, a) => s + a.cost, 0));
    const active = assets.filter(isActive);
    const byGroup = groups.map((g) => ({ group: g, nbv: active.filter((a) => a.groupId === g.id).reduce((s, a) => s + assetNbv(a), 0), count: active.filter((a) => a.groupId === g.id).length }));
    return delay({ months, added, disposed, transfers: months.map((m) => opsBy(['transfer_cbu', 'transfer_dept', 'transfer_branch', 'transfer_mol'], m)), byGroup, active, postings: wmsLedger.health('assets') });
  },
};

// ---------- Загрузка списания из Excel (массовое списание по протоколу) ----------
importRegistry.register({
  id: 'asset_writeoff',
  name: L('ОС: списание по протоколу (Excel)', 'AV: bayonnoma bo‘yicha hisobdan chiqarish (Excel)', 'PP&E: write-off by protocol (Excel)'),
  description: L('Инвентарные номера и причина: создаётся один акт ОС-4 на все строки файла', 'Inventar raqamlari va sabab: barcha qatorlar uchun bitta OS-4 dalolatnomasi', 'Inventory numbers and reason: one OS-4 act for all rows'),
  fields: [
    { key: 'inventoryNo', label: L('Инвентарный номер', 'Inventar raqami', 'Inventory no.'), type: 'string', required: true, unique: true, pattern: '^OS-\\d{2}-\\d{6}$', patternHint: 'OS-02-013420', sample: 'OS-02-013420' },
    { key: 'reason', label: L('Причина', 'Sabab', 'Reason'), type: 'string', required: true, maxLength: 300, sample: 'Физический износ, не подлежит ремонту' },
  ],
  extraValidate: async (rows) =>
    rows.map((r) => {
      const a = assets.find((x) => x.inventoryNo === String(r.inventoryNo ?? ''));
      const v = String(r.inventoryNo ?? '');
      if (!a) return [{ field: 'inventoryNo', code: 'reference' as const, value: v, severity: 'error' as const, messageKey: 'assets_imp_notFound' }];
      if (!isActive(a) || openOp(a.id) || openAct(a.id)) return [{ field: 'inventoryNo', code: 'rule' as const, value: v, severity: 'error' as const, messageKey: 'assets_imp_busy' }];
      return [];
    }),
  commit: async (rows, user) => {
    const ids = rows.map((r) => assets.find((a) => a.inventoryNo === String(r.inventoryNo))?.id).filter((x): x is ID => !!x);
    if (!ids.length) return { created: 0, updated: 0, skipped: rows.length };
    await assetsApi.createWriteoff({ kind: 'liquidation', assetIds: ids, reason: [...new Set(rows.map((r) => String(r.reason)))].join('; '), commission: { chairmanId: 'u6', memberIds: ['u7', 'u14'], protocolNo: `Excel ${today()}` }, source: 'excel' }, user);
    return { created: 1, updated: 0, skipped: rows.length - ids.length };
  },
});

// Засев истории начислений (сентябрь 2026) для отчёта по износу.
(() => {
  const lines = assets.filter((a) => isActive(a)).map((a) => ({ assetId: a.id, amount: assetMonthly(a, '2026-09'), costCenterId: a.costCenterId, method: a.method })).filter((l) => l.amount > 0);
  depRuns.push({ id: 'dr-2026-09', period: '2026-09', at: '2026-09-25T18:00:00Z', by: 'system', auto: true, lines, total: lines.reduce((s, l) => s + l.amount, 0) });
})();
