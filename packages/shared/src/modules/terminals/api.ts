// API модуля «Учёт терминалов» (ТЗ 4.2.19): оприходование терминала как ОС (обязательный уникальный серийный номер,
// модель из справочника, HUMO/Uzcard, признак iABS по префиксу/диапазону серийного номера), синхронизация с iABS
// «Учёт терминалов» через integrationHub (журнал, повтор), перемещение между ЦБУ по распоряжению (через передачу ОС),
// списание (Свободен → «Списан» в iABS; после утверждения — удаление из списка). Мониторинг устройств и заявки сохранены.
import { clone, delay, emit, historyEvent, nextId, nextNumber, now } from '../../bus';
import { audit } from '../../audit';
import { notify } from '../../notifications';
import { orgApi } from '../../org';
import { can } from '../../security';
import { matches, registerSearchProvider } from '../../search';
import { integrationHub } from '../../services/integrations';
import type { ID, Localized, User } from '../../types';
import { assetsApi, onAssetEvent } from '../assets';
import { terminalDevicesSeed, terminalIabsRulesSeed, terminalModelsSeed, terminalTicketsSeed } from './data';
import type {
  NewTerminalTicketInput, TerminalDevice, TerminalIabsRule, TerminalModel, TerminalPaySystem, TerminalRegisterInput, TerminalsStats, TerminalState, TerminalStatus, TerminalSyncEntry, TerminalSyncOp, TerminalType,
} from './types';
import { apiError } from '../../errors';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const models = clone(terminalModelsSeed);
const rules = clone(terminalIabsRulesSeed);
const tickets = clone(terminalTicketsSeed);
const syncLog: TerminalSyncEntry[] = [];

export const TERMINAL_LOW_CASH = 20;
export const TERMINAL_SERIAL_RE = /^[A-Z0-9][A-Z0-9-]{5,29}$/;

/** Признак и раздел iABS: правило с наибольшим приоритетом по платёжной системе и префиксу/диапазону серийного номера. */
export function terminalIabsFlag(serialNo: string, paySystem: TerminalPaySystem, list: TerminalIabsRule[] = rules): TerminalIabsRule | undefined {
  const s = serialNo.trim().toUpperCase();
  return list
    .filter((r) => r.active && r.paySystem === paySystem)
    .filter((r) => (r.prefix ? s.startsWith(r.prefix.toUpperCase()) : true) && (r.rangeFrom ? s >= r.rangeFrom.toUpperCase() : true) && (r.rangeTo ? s <= r.rangeTo.toUpperCase() : true))
    .filter((r) => r.prefix || r.rangeFrom || r.rangeTo)
    .sort((a, b) => b.priority - a.priority)[0];
}

const devices: TerminalDevice[] = clone(terminalDevicesSeed).map((d) => {
  const r = terminalIabsFlag(d.serialNo, d.paySystem);
  return { ...d, iabsFlag: r?.flag ?? '—', iabsSection: r?.section ?? '—', iabsStatus: d.iabsStatus ?? (d.state === 'free' ? 'free' : 'active'), history: [{ at: `${d.installedAt}T09:00:00Z`, userId: 'u7', action: 'created' as const, comment: 'Оприходован как ОС, зарегистрирован в iABS' }] };
});
// История синхронизации (демо).
devices.forEach((d, i) =>
  syncLog.push({ id: `ts-seed-${i + 1}`, terminalId: d.id, serialNo: d.serialNo, inventoryNo: d.inventoryNo, at: `${d.installedAt}T09:05:00Z`, operation: 'register', payload: { serialNo: d.serialNo, inventoryNo: d.inventoryNo, paySystem: d.paySystem, flag: d.iabsFlag }, status: 'success', userId: 'u7' }),
);

const REGION: Record<string, { short: string; name: string }> = {
  R01: { short: 'TSH', name: 'Toshkent sh.' }, R02: { short: 'TSV', name: 'Toshkent vil.' }, R03: { short: 'AND', name: 'Andijon vil.' }, R04: { short: 'BUX', name: 'Buxoro vil.' },
  R05: { short: 'JIZ', name: 'Jizzax vil.' }, R06: { short: 'QSH', name: 'Qashqadaryo vil.' }, R07: { short: 'NAV', name: 'Navoiy vil.' }, R08: { short: 'NAM', name: 'Namangan vil.' },
  R09: { short: 'SAM', name: 'Samarqand vil.' }, R10: { short: 'SUR', name: 'Surxondaryo vil.' }, R11: { short: 'SIR', name: 'Sirdaryo vil.' }, R12: { short: 'FER', name: "Farg'ona vil." },
  R13: { short: 'XOR', name: 'Xorazm vil.' }, R14: { short: 'QQR', name: 'Qoraqalpog‘iston R.' },
};
const regionOf = (orgUnitKey: string) => REGION[orgUnitKey.slice(0, 3)] ?? { short: 'HO', name: 'Toshkent sh.' };

/** Учёт терминалов (оприходование, перемещение, списание) — право «редактирование» в модуле ОС; обслуживание — по модулю «Терминалы». */
export const canAccountTerminals = (user: User): boolean => can(user, 'assets', 'edit');
/** Сообщить о неисправности — руководители ЦБУ (согласование в модуле), казначейство, администрация. */
export const canReportTerminal = (user: User): boolean => can(user, 'terminals', 'edit') || user.role === 'dept_head';
/** Закрыть заявку и отметить инкассацию — служба инкассации (казначейство) и администрация. */
export const canServiceTerminal = (user: User): boolean => can(user, 'terminals', 'edit');
const auditUser = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });

// ---------- Синхронизация с iABS «Учёт терминалов» ----------
const OP: Record<TerminalSyncOp, string> = { register: 'terminals.register', update: 'terminals.update', move: 'terminals.move', status: 'terminals.status', delete: 'terminals.delete' };

async function sync(d: TerminalDevice, operation: TerminalSyncOp, extra: Record<string, string | number>, userId: ID, onSuccess?: () => void): Promise<TerminalSyncEntry> {
  const payload: Record<string, string | number> = { serialNo: d.serialNo, inventoryNo: d.inventoryNo, paySystem: d.paySystem, flag: d.iabsFlag, section: d.iabsSection, ...extra };
  const e: TerminalSyncEntry = { id: nextId('ts'), terminalId: d.id, serialNo: d.serialNo, inventoryNo: d.inventoryNo, at: now(), operation, payload, status: 'pending', userId };
  syncLog.push(e);
  emit();
  try {
    const r = await integrationHub.call('iabs', OP[operation], payload, { userId, idempotencyKey: `trm-${e.id}` });
    e.exchangeId = r.id;
    e.status = r.status === 'success' ? 'success' : r.status === 'queued' ? 'queued' : r.status === 'quarantined' ? 'quarantined' : 'failed';
    if (e.status === 'success') {
      const resp = r.response as { terminalId?: string } | undefined;
      if (operation === 'register' && resp?.terminalId) d.iabsTerminalId = resp.terminalId;
      onSuccess?.();
    } else {
      e.error = r.errorMessage ?? r.error ?? r.status;
      if (operation === 'register') d.iabsStatus = 'error';
      notify({ roles: ['accountant'], kind: 'system', level: 'warning', title: L(`iABS: ошибка синхронизации терминала ${d.code}`, `iABS: ${d.code} terminalini sinxronlash xatosi`, `iABS: terminal ${d.code} sync error`), body: `${OP[operation]}: ${e.error}`, link: `/terminals/${d.id}`, dedupeKey: `trm-sync:${e.id}` });
    }
  } catch (err) {
    e.status = 'failed';
    e.error = err instanceof Error ? err.message : String(err);
  }
  emit();
  return e;
}

// ---------- События ОС: перемещение и списание терминала ----------
onAssetEvent((e, user) => {
  const d = devices.find((x) => x.assetId === e.asset.id);
  if (!d) return;
  if (e.type === 'writeoff_requested') {
    if (d.state !== 'free') throw new Error('TERMINAL_NOT_FREE');
    d.history.push(historyEvent(user.id, 'submitted', `Акт списания ${e.act.number}`));
    void sync(d, 'status', { status: 'written_off', act: e.act.number }, user.id, () => (d.iabsStatus = 'written_off'));
  } else if (e.type === 'writeoff_rejected') {
    d.history.push(historyEvent(user.id, 'rejected', `Списание отклонено (${e.act.number})`));
    void sync(d, 'status', { status: 'free' }, user.id, () => (d.iabsStatus = 'free'));
  } else if (e.type === 'written_off') {
    d.state = 'written_off';
    d.history.push(historyEvent(user.id, 'status_changed', `Списан с учёта ОС по акту ${e.act.number}`));
    void sync(d, 'delete', { act: e.act.number }, user.id, () => (d.iabsStatus = 'deleted'));
  } else if (e.type === 'transferred' && (e.op.type === 'transfer_cbu' || e.op.type === 'transfer_branch' || e.op.type === 'transfer_dept')) {
    void (async () => {
      const units = await orgApi.listOrgUnits();
      const u = units.find((x) => x.key === e.asset.orgUnitKey);
      d.orgUnitKey = e.asset.orgUnitKey;
      d.region = regionOf(d.orgUnitKey).name;
      d.branch = u?.name.ru ?? d.orgUnitKey;
      if (typeof e.op.to?.location === 'string' && e.op.to.location) d.address = e.op.to.location;
      d.history.push(historyEvent(user.id, 'status_changed', `Перемещён в ${d.branch} по распоряжению ${e.op.orderNo ?? e.op.number} (серийный и инв. номер сохранены)`));
      await sync(d, 'move', { cbu: u?.cbuCode ?? d.orgUnitKey, order: e.op.orderNo ?? e.op.number }, user.id);
    })();
  } else if (e.type === 'correcting') {
    // Серийный номер терминала закреплён (связь с iABS): корректировка ОС не может его изменить (PR-TRM-009/011).
    if (e.patch.serialNo !== undefined && e.patch.serialNo.trim().toUpperCase() !== d.serialNo.toUpperCase()) throw new Error('SERIAL_LOCKED');
  } else if (e.type === 'corrected' && e.asset.model && e.asset.model !== d.model) {
    d.model = e.asset.model;
    d.history.push(historyEvent(user.id, 'commented', `model → ${d.model} (корректировка ОС)`));
    void sync(d, 'update', { model: d.model, address: d.address }, user.id); // изменение карточки — сразу в iABS (PR-TRM-010)
  }
});

registerSearchProvider((q) => [
  ...devices
    .filter((d) => matches(q, d.code, d.branch, d.address, d.model, d.serialNo, d.inventoryNo))
    .map((d) => ({ group: 'terminals_title', title: `${d.code} · ${d.branch}`, subtitle: `${d.model} · ${d.serialNo}`, to: `/terminals/${d.id}` })),
  ...tickets
    .filter((t) => matches(q, t.number))
    .map((t) => ({ group: 'terminals_title', title: `${t.number} · ${devices.find((d) => d.id === t.terminalId)?.code ?? ''}`, subtitle: t.description, to: `/terminals/${t.terminalId}` })),
]);

export interface TerminalFilter {
  type?: TerminalType;
  status?: TerminalStatus;
  region?: string;
  paySystem?: TerminalPaySystem;
  state?: TerminalState;
  search?: string;
  includeWrittenOff?: boolean;
}

export const terminalsApi = {
  list(filter: TerminalFilter = {}) {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      devices
        .filter((d) => filter.includeWrittenOff || filter.state === 'written_off' || d.state !== 'written_off')
        .filter((d) => !filter.type || d.type === filter.type)
        .filter((d) => !filter.status || d.status === filter.status)
        .filter((d) => !filter.region || d.region === filter.region)
        .filter((d) => !filter.paySystem || d.paySystem === filter.paySystem)
        .filter((d) => !filter.state || d.state === filter.state)
        .filter((d) => !q || d.code.toLowerCase().includes(q) || d.branch.toLowerCase().includes(q) || d.address.toLowerCase().includes(q) || d.serialNo.toLowerCase().includes(q) || d.inventoryNo.toLowerCase().includes(q)),
    );
  },
  regions: () => delay([...new Set(devices.map((d) => d.region))].sort()),
  get: (id: ID) => delay(devices.find((d) => d.id === id)),
  listTickets: (terminalId?: ID) =>
    delay(tickets.filter((t) => !terminalId || t.terminalId === terminalId).sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.openedAt.localeCompare(a.openedAt))),
  listModels: () => delay(models),
  listRules: () => delay([...rules].sort((a, b) => b.priority - a.priority || a.flag.localeCompare(b.flag))),
  listSync: (terminalId?: ID) => delay(syncLog.filter((e) => !terminalId || e.terminalId === terminalId).sort((a, b) => b.at.localeCompare(a.at))),
  /** Проверка серийного номера: формат, дубликат (среди терминалов и ОС) и признак iABS. */
  async checkSerial(serialNo: string, paySystem: TerminalPaySystem | '') {
    const s = serialNo.trim().toUpperCase();
    const dupTerminal = devices.find((d) => d.serialNo.toUpperCase() === s);
    const dupAsset = dupTerminal ? undefined : (await assetsApi.list({ includeDisposed: true })).find((a) => (a.serialNo ?? '').toUpperCase() === s);
    const rule = paySystem ? terminalIabsFlag(s, paySystem) : undefined;
    return delay({ valid: TERMINAL_SERIAL_RE.test(s), duplicate: dupTerminal ? { kind: 'terminal' as const, code: dupTerminal.code, id: dupTerminal.id } : dupAsset ? { kind: 'asset' as const, code: dupAsset.inventoryNo, id: dupAsset.id } : undefined, rule });
  },

  getStats(): Promise<TerminalsStats> {
    const live = devices.filter((d) => d.state !== 'written_off');
    return delay({
      total: live.length,
      online: live.filter((d) => d.status === 'online').length,
      offline: live.filter((d) => d.status === 'offline').length,
      maintenance: live.filter((d) => d.status === 'maintenance').length,
      avgUptime: live.length ? Math.round((live.reduce((s, d) => s + d.uptime30d, 0) / live.length) * 10) / 10 : 0,
      lowCash: live.filter((d) => d.type === 'atm' && (d.cashLevel ?? 100) < TERMINAL_LOW_CASH).length,
      openTickets: tickets.filter((t) => t.status === 'open').length,
      txToday: live.reduce((s, d) => s + (d.txLast7[d.txLast7.length - 1] ?? 0), 0),
      humo: live.filter((d) => d.paySystem === 'humo').length,
      uzcard: live.filter((d) => d.paySystem === 'uzcard').length,
      free: live.filter((d) => d.state === 'free').length,
      syncErrors: syncLog.filter((e) => e.status === 'failed' || e.status === 'quarantined').length,
      pendingMoves: 0,
    });
  },

  // ---------- Оприходование ----------
  /** Оприходовать терминал как ОС: карточка ОС с авто инв. номером → терминал → регистрация в iABS с признаком. */
  async registerTerminal(input: TerminalRegisterInput, user: User): Promise<TerminalDevice> {
    if (!canAccountTerminals(user)) throw new Error('FORBIDDEN');
    const serial = input.serialNo.trim().toUpperCase();
    if (!serial) throw new Error('SERIAL_REQUIRED');
    if (!TERMINAL_SERIAL_RE.test(serial)) throw new Error('SERIAL_FORMAT');
    const chk = await terminalsApi.checkSerial(serial, input.paySystem);
    if (chk.duplicate) throw new Error(`SERIAL_DUP:${chk.duplicate.code}`);
    const m = models.find((x) => x.id === input.modelId && x.active);
    if (!m) throw new Error('MODEL');
    if (!input.paySystem || !m.paySystems.includes(input.paySystem)) throw new Error('PAY_SYSTEM');
    if (m.serialPrefix && !serial.startsWith(m.serialPrefix)) throw new Error('SERIAL_MODEL');
    const rule = terminalIabsFlag(serial, input.paySystem);
    if (!rule) throw new Error('NO_IABS_RULE');
    if (!input.orgUnitKey || !input.address.trim() || !input.costCenterId || !input.responsibleId || !input.departmentId) throw new Error('REQUIRED');
    const units = await orgApi.listOrgUnits();
    const unit = units.find((u) => u.key === input.orgUnitKey);
    const asset = await assetsApi.registerAsset(
      {
        name: `${m.type === 'pos' ? 'POS-терминал' : m.type === 'atm' ? 'Банкомат' : 'Терминал самообслуживания'} ${m.model}`.replace('Банкомат Банкомат', 'Банкомат').replace('Терминал самообслуживания Терминал самообслуживания', 'Терминал самообслуживания'),
        groupId: 'ag-atm', orgUnitKey: input.orgUnitKey, departmentId: input.departmentId, costCenterId: input.costCenterId, responsibleId: input.responsibleId, acquiredAt: input.acquiredAt, cost: input.cost,
        usefulLifeMonths: input.usefulLifeMonths ?? (m.type === 'pos' ? 60 : 84), method: 'linear', source: 'purchase', location: `${unit?.name.ru ?? input.orgUnitKey}, ${input.address.trim()}`, serialNo: serial, model: m.model,
      },
      user,
    );
    const reg = regionOf(input.orgUnitKey);
    const prefix = m.type === 'kiosk' ? 'KSK' : m.type.toUpperCase();
    const n = devices.filter((d) => d.code.startsWith(`${prefix}-${reg.short}-`)).reduce((mx, d) => Math.max(mx, Number(d.code.split('-')[2]) || 0), 0) + 1;
    const d: TerminalDevice = {
      id: nextId('tm'), code: `${prefix}-${reg.short}-${String(n).padStart(4, '0')}`, serialNo: serial, modelId: m.id, model: m.model, type: m.type, paySystem: input.paySystem, iabsFlag: rule.flag, iabsSection: rule.section,
      iabsStatus: 'pending', assetId: asset.id, inventoryNo: asset.inventoryNo, orgUnitKey: input.orgUnitKey, region: reg.name, branch: unit?.name.ru ?? input.orgUnitKey, address: input.address.trim(), state: input.state,
      status: 'offline', uptime30d: 0, installedAt: input.acquiredAt, txLast7: [0, 0, 0, 0, 0, 0, 0], ...(m.type === 'atm' ? { cashLevel: 0 } : {}),
      history: [historyEvent(user.id, 'created', `Оприходован как ОС ${asset.inventoryNo}; признак iABS ${rule.flag}`)],
    };
    devices.push(d);
    audit.log({ action: 'create', entity: 'terminal', entityId: d.id, entityLabel: d.code, details: `${serial} · ${asset.inventoryNo} · ${rule.flag}`, user: auditUser(user) });
    emit();
    void sync(d, 'register', { cbu: unit?.cbuCode ?? input.orgUnitKey, model: m.model, state: input.state }, user.id, () => (d.iabsStatus = input.state === 'free' ? 'free' : 'active'));
    return delay(d);
  },
  /** Изменение карточки (модель, платёжная система, адрес). Серийный и инвентарный номер не изменяются. */
  async updateTerminal(id: ID, patch: { modelId?: ID; paySystem?: TerminalPaySystem; address?: string }, user: User) {
    if (!canAccountTerminals(user) && !can(user, 'terminals', 'edit')) throw new Error('FORBIDDEN');
    const d = devices.find((x) => x.id === id);
    if (!d || d.state === 'written_off') throw new Error('NOT_ALLOWED');
    const m = models.find((x) => x.id === (patch.modelId ?? d.modelId));
    const pay = patch.paySystem ?? d.paySystem;
    if (!m || !m.paySystems.includes(pay)) throw new Error('PAY_SYSTEM');
    if (m.type !== d.type) throw new Error('MODEL');
    const rule = terminalIabsFlag(d.serialNo, pay);
    if (!rule) throw new Error('NO_IABS_RULE');
    if (patch.address !== undefined && !patch.address.trim()) throw new Error('REQUIRED');
    const before = { model: d.model, paySystem: d.paySystem, address: d.address, iabsFlag: d.iabsFlag };
    d.modelId = m.id;
    d.model = m.model;
    d.paySystem = pay;
    d.iabsFlag = rule.flag;
    d.iabsSection = rule.section;
    if (patch.address !== undefined) d.address = patch.address.trim();
    const changes = (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== d[k]).map((k) => ({ field: k, from: String(before[k]), to: String(d[k]) }));
    if (!changes.length) return delay(d);
    d.history.push(historyEvent(user.id, 'commented', changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join('; ')));
    audit.log({ action: 'update', entity: 'terminal', entityId: d.id, entityLabel: d.code, changes, user: auditUser(user) });
    emit();
    void sync(d, 'update', { model: d.model, address: d.address }, user.id);
    return delay(d);
  },
  /** Учётное состояние: используется / свободен (передаётся в iABS). */
  async setState(id: ID, state: 'in_use' | 'free', user: User) {
    if (!canAccountTerminals(user) && !can(user, 'terminals', 'edit')) throw new Error('FORBIDDEN');
    const d = devices.find((x) => x.id === id);
    if (!d || d.state === 'written_off' || d.state === state) throw new Error('NOT_ALLOWED');
    if (d.iabsStatus === 'written_off') throw new Error('NOT_ALLOWED');
    d.state = state;
    d.history.push(historyEvent(user.id, 'status_changed', state === 'free' ? 'Освобождён (Свободен)' : 'Введён в использование'));
    audit.log({ action: 'update', entity: 'terminal', entityId: d.id, entityLabel: d.code, changes: [{ field: 'state', from: state === 'free' ? 'in_use' : 'free', to: state }], user: auditUser(user) });
    emit();
    void sync(d, 'status', { status: state === 'free' ? 'free' : 'active' }, user.id, () => (d.iabsStatus = state === 'free' ? 'free' : 'active'));
    await delay(null);
  },
  /** Перемещение в другой ЦБУ: распоряжение (передача ОС между ЦБУ) → согласование → iABS. */
  async requestMove(id: ID, input: { toOrgUnitKey: string; toDepartmentId: ID; toCostCenterId: string; toAddress: string; reason: string }, user: User) {
    const d = devices.find((x) => x.id === id);
    if (!d || d.state === 'written_off') throw new Error('NOT_ALLOWED');
    if (!input.toAddress.trim()) throw new Error('REQUIRED');
    const op = await assetsApi.requestTransfer({ assetIds: [d.assetId], kind: 'cbu', toOrgUnitKey: input.toOrgUnitKey, toDepartmentId: input.toDepartmentId, toCostCenterId: input.toCostCenterId, toLocation: input.toAddress.trim(), reason: input.reason }, user);
    d.history.push(historyEvent(user.id, 'submitted', `Распоряжение ${op.orderNo} на перемещение`));
    emit();
    return op;
  },
  /** Списание: только свободный терминал; акт ОС-4 в модуле ОС. */
  async requestWriteoff(id: ID, input: { reason: string; commission: { chairmanId: ID; memberIds: ID[]; protocolNo: string } }, user: User) {
    const d = devices.find((x) => x.id === id);
    if (!d || d.state === 'written_off') throw new Error('NOT_ALLOWED');
    if (d.state !== 'free') throw new Error('TERMINAL_NOT_FREE');
    return assetsApi.createWriteoff({ kind: 'liquidation', assetIds: [d.assetId], reason: input.reason, commission: input.commission }, user);
  },
  async retrySync(entryId: ID, user: User) {
    if (!canAccountTerminals(user) && !can(user, 'terminals', 'edit')) throw new Error('FORBIDDEN');
    const e = syncLog.find((x) => x.id === entryId);
    if (!e || !e.exchangeId || (e.status !== 'failed' && e.status !== 'queued')) throw new Error('NOT_ALLOWED');
    const d = devices.find((x) => x.id === e.terminalId);
    const r = await integrationHub.retry(e.exchangeId, user.id);
    e.status = r.status === 'success' ? 'success' : r.status === 'queued' ? 'queued' : 'failed';
    if (e.status === 'success') {
      delete e.error;
      if (d && e.operation === 'register') d.iabsStatus = d.state === 'free' ? 'free' : 'active';
      if (d && e.operation === 'delete') d.iabsStatus = 'deleted';
      if (d && e.operation === 'status') d.iabsStatus = String(e.payload.status) === 'written_off' ? 'written_off' : String(e.payload.status) === 'free' ? 'free' : 'active';
    } else e.error = r.errorMessage ?? r.error ?? r.status;
    emit();
  },
  /** Справочник моделей (админ/учётная служба). */
  async saveModel(input: Omit<TerminalModel, 'id'> & { id?: ID }, user: User) {
    if (!canAccountTerminals(user)) throw new Error('FORBIDDEN');
    if (!input.brand.trim() || !input.model.trim() || !input.paySystems.length) throw new Error('REQUIRED');
    if (models.some((m) => m.id !== input.id && m.model.toLowerCase() === input.model.trim().toLowerCase())) throw new Error('MODEL_DUP');
    const m = input.id ? models.find((x) => x.id === input.id) : undefined;
    const fields = { ...input, brand: input.brand.trim(), model: input.model.trim(), ...(input.serialPrefix?.trim() ? { serialPrefix: input.serialPrefix.trim().toUpperCase() } : {}) };
    if (m) Object.assign(m, fields);
    else models.push({ ...fields, id: nextId('tmod') });
    audit.log({ action: input.id ? 'update' : 'create', entity: 'terminal_model', entityId: input.id, entityLabel: fields.model, user: auditUser(user) });
    emit();
    await delay(null);
  },
  /** Правила признака iABS (префикс или диапазон серийного номера + платёжная система). */
  async saveRule(input: Omit<TerminalIabsRule, 'id'> & { id?: ID }, user: User) {
    if (!canAccountTerminals(user)) throw new Error('FORBIDDEN');
    if (!input.flag.trim() || !input.section.trim() || (!input.prefix?.trim() && !input.rangeFrom?.trim() && !input.rangeTo?.trim())) throw new Error('REQUIRED');
    if (input.rangeFrom && input.rangeTo && input.rangeFrom.toUpperCase() > input.rangeTo.toUpperCase()) throw new Error('RANGE');
    const r = input.id ? rules.find((x) => x.id === input.id) : undefined;
    const fields = { ...input, flag: input.flag.trim().toUpperCase(), section: input.section.trim(), ...(input.prefix?.trim() ? { prefix: input.prefix.trim().toUpperCase() } : {}), ...(input.rangeFrom?.trim() ? { rangeFrom: input.rangeFrom.trim().toUpperCase() } : {}), ...(input.rangeTo?.trim() ? { rangeTo: input.rangeTo.trim().toUpperCase() } : {}) };
    if (r) {
      delete r.prefix;
      delete r.rangeFrom;
      delete r.rangeTo;
      Object.assign(r, fields);
    } else rules.push({ ...fields, id: nextId('ir') });
    audit.log({ action: input.id ? 'update' : 'create', entity: 'terminal_iabs_rule', entityId: input.id, entityLabel: fields.flag, user: auditUser(user) });
    emit();
    await delay(null);
  },

  // ---------- Мониторинг и обслуживание (сохранено) ----------
  /** Заявка на обслуживание; терминал переводится в статус «обслуживание». */
  async createTicket(input: NewTerminalTicketInput, user: User) {
    if (!canReportTerminal(user)) throw new Error('FORBIDDEN');
    const d = devices.find((x) => x.id === input.terminalId);
    if (!d || !input.description.trim()) throw new Error('REQUIRED');
    const t = { id: nextId('tt'), number: nextNumber('TK'), terminalId: d.id, issue: input.issue, description: input.description, status: 'open' as const, openedAt: now(), openedBy: user.id };
    tickets.push(t);
    if (d.status === 'online') d.status = 'maintenance';
    emit();
    return delay(t);
  },
  /** Закрыть заявку; если открытых заявок по терминалу не осталось — он снова online. */
  async closeTicket(id: ID, resolution: string, user: User) {
    if (!canServiceTerminal(user)) throw new Error('FORBIDDEN');
    const t = tickets.find((x) => x.id === id);
    if (!t || t.status === 'closed') throw new Error('NOT_ALLOWED');
    if (!resolution.trim()) throw new Error('REQUIRED');
    t.status = 'closed';
    t.closedAt = now();
    t.resolution = resolution;
    const d = devices.find((x) => x.id === t.terminalId);
    if (d && !tickets.some((x) => x.terminalId === d.id && x.status === 'open')) d.status = 'online';
    emit();
    await delay(null);
  },
  /** Отметить инкассацию / загрузку кассет банкомата. */
  async registerCollection(id: ID, user: User) {
    if (!canServiceTerminal(user)) throw new Error('FORBIDDEN');
    const d = devices.find((x) => x.id === id);
    if (!d || d.type !== 'atm') throw apiError('ONLY_ATMS');
    d.cashLevel = 100;
    d.lastCollection = now();
    emit();
    await delay(null);
  },
};
