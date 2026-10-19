// Контур НДО (ТЗ 4.2.20): версионируемый реестр объектов, классификаторы, паспорта наборов данных и загрузки
// с контрольными итогами (iABS, OptiLoad, процессинг, Service Desk, Laborlaw, модули FTP и аллокации), ошибки на
// исправление, корректировки отдельным слоем, бюджет и план-факт с факторами, ежедневные остатки и деньги в пути,
// стоимость фондирования по ставкам FTP, сценарии, аллокация по правилам с согласованием, себестоимость по слоям,
// P&L, экономика устройств и OptiLoad, тарифы, качество данных, закрытие периода с воспроизводимым снимком.
import { clone, delay, emit, nextId, now, today } from '../../bus';
import { audit } from '../../audit';
import { approvalEngine } from '../../engine';
import { notify } from '../../notifications';
import { orgApi } from '../../org';
import { can } from '../../security';
import { sha256Hex } from '../../services/bytes';
import { INTEGRATION_SYSTEMS, integrationHub, type IntegrationOperation } from '../../services/integrations';
import type { HistoryEvent, ID, Localized, User } from '../../types';
import { ftpApi, ftpInterpolate } from '../ftp';
import { cashInternal } from './api';
import { CASH_RATES } from './data';
import { NDO_PERIODS, ndoClassSeed, ndoDatasetsSeed, ndoNoise, ndoObjectsSeed, ndoParamsSeed, ndoRulesSeed, ndoTariffsSeed } from './ndoData';
import type {
  NdoAdjustment, NdoAllocRow, NdoBalance, NdoBudgetLine, NdoClassItem, NdoCloseStep, NdoDqCheck, NdoErrorRecord, NdoFact, NdoFactorRow, NdoFundingRow, NdoLoad, NdoObject,
  NdoObjectResult, NdoObjectType, NdoOptiRec, NdoParams, NdoPeriodState, NdoResults, NdoRule, NdoScenario, NdoScenarioKind, NdoTariffCalc, NdoTransitItem, NdoVolume,
} from './ndoTypes';
import type { CashCurrency } from './types';
import { apiError } from '../../errors';

export { NDO_PERIODS };
const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const B = 1_000_000_000;
const M = 1_000_000;
const CCY: CashCurrency[] = ['UZS', 'USD', 'EUR', 'RUB'];
export const NDO_CLOSE_STEPS: NdoCloseStep[] = ['load', 'dq', 'direct', 'funding', 'allocation', 'cost', 'approve', 'closed'];
/** Курсы ЦБ (UZS за единицу) по периодам и плановый курс бюджета. */
export const NDO_FX: Record<string, Record<CashCurrency, number>> = {
  '2026-07': { UZS: 1, USD: 12_600, EUR: 13_620, RUB: 154 },
  '2026-08': { UZS: 1, USD: 12_640, EUR: 13_680, RUB: 155 },
  '2026-09': { UZS: 1, USD: 12_650, EUR: 13_700, RUB: 155 },
  '2026-10': { UZS: 1, USD: 12_680, EUR: 13_730, RUB: 156 },
  plan: { UZS: 1, USD: 12_500, EUR: 13_500, RUB: 150 },
};
const fx = (period: string, c: CashCurrency) => (NDO_FX[period] ?? CASH_RATES)[c];
const KPERIOD: Record<string, number> = { '2026-07': 0.96, '2026-08': 1.0, '2026-09': 1.07, '2026-10': 0.58 };
const DAYS = (period: string) => (period === '2026-10' ? 17 : new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate());
const ROUTE_OF: Record<string, string> = { cb1: 'NDO-RT-01', cb2: 'NDO-RT-01', cb3: 'NDO-RT-01', cb6: 'NDO-RT-02', cb7: 'NDO-RT-02', cb8: 'NDO-RT-02', cb4: 'NDO-RT-03', cb5: 'NDO-RT-03', cb9: 'NDO-RT-03' };
const VEH_OF: Record<string, string> = { 'NDO-RT-01': 'NDO-VEH-03', 'NDO-RT-02': 'NDO-VEH-01', 'NDO-RT-03': 'NDO-VEH-02' };
const DEVICE_TYPES: NdoObjectType[] = ['atm', 'cash_in', 'recycler'];
const CASH_HOLDERS: NdoObjectType[] = ['vault', 'ekc', 'cbu', 'cash_desk', 'mobile_desk', 'exchange', 'atm', 'cash_in', 'recycler'];

// ---------------------------------------------------------------------------------------------
// Состояние

const db = {
  objects: clone(ndoObjectsSeed),
  classes: clone(ndoClassSeed),
  datasets: clone(ndoDatasetsSeed),
  loads: [] as NdoLoad[],
  facts: [] as NdoFact[],
  volumes: [] as NdoVolume[],
  balances: [] as NdoBalance[],
  opti: [] as NdoOptiRec[],
  errors: [] as NdoErrorRecord[],
  ftp: {} as Record<string, Record<CashCurrency, number>>,
  hoShare: {} as Record<string, number>,
  adjustments: [] as NdoAdjustment[],
  budget: [] as NdoBudgetLine[],
  rules: clone(ndoRulesSeed),
  ruleHistory: {} as Record<ID, HistoryEvent[]>,
  scenarios: [] as NdoScenario[],
  tariffs: clone(ndoTariffsSeed),
  params: clone(ndoParamsSeed),
  periods: {} as Record<string, NdoPeriodState>,
  /** Сопоставление кодов источников с объектами НДО (исправления ошибочных записей). */
  codeMap: {} as Record<string, string>,
  bi: [] as { at: string; period: string; exchangeId: string; rows: number; controlSum: number; status: string }[],
};

const periodEnd = (period: string) => `${period}-${String(DAYS(period)).padStart(2, '0')}`;
/** Версия объекта, действующая на дату. */
function objectsAt(date: string): NdoObject[] {
  const keys = [...new Set(db.objects.map((o) => o.key))];
  return keys.map((k) => db.objects.filter((o) => o.key === k && o.validFrom <= date && (!o.validTo || o.validTo >= date)).sort((a, b) => b.version - a.version)[0]).filter((o): o is NdoObject => !!o);
}
const currentObjects = () => objectsAt(today());
const objByCode = (code: string) => currentObjects().find((o) => o.code === code);
const objByBranch = (cb: string) => currentObjects().find((o) => o.cashBranchId === cb);

// ---------------------------------------------------------------------------------------------
// «Системы-источники»: детерминированные генераторы записей (повторный запуск даёт те же бизнес-ключи)

interface RawRec { key: string; code?: string; article: string; amount: number; currency: CashCurrency; amountFx?: number; process?: string; pool?: string; external: boolean; ref: string }

function econ(cb: string, period: string) {
  const list = cashInternal.economics();
  const p = period === '2026-10' ? '2026-09' : period;
  const r = list.find((e) => e.branchId === cb && e.month === p);
  if (!r) return undefined;
  const k = period === '2026-10' ? 0.58 : 1;
  return { volume: r.processedVolume * k, fee: r.feeIncome * k, staff: r.staff * k, cit: r.cit * k, insurance: r.insurance * k, transport: r.transport * k, counting: r.counting * k };
}

function genGL(period: string): RawRec[] {
  const out: RawRec[] = [];
  const k = KPERIOD[period] ?? 1;
  const add = (code: string, article: string, amount: number, process: string, extra: Partial<RawRec> = {}) => {
    const amt = Math.round(amount);
    if (!amt) return;
    out.push({ key: `GL:${period}:${code}:${article}${extra.currency && extra.currency !== 'UZS' ? ':' + extra.currency : ''}`, code, article, amount: amt, currency: 'UZS', process, external: true, ref: `iABS:${period}:${article}:${code}`, ...extra });
  };
  for (const cb of ['cb1', 'cb2', 'cb3', 'cb4', 'cb5', 'cb6', 'cb7', 'cb8', 'cb9']) {
    const e = econ(cb, period);
    const o = ndoObjectsSeed.find((x) => x.cashBranchId === cb)!;
    if (!e) continue;
    add(o.code, 'INC-CASH', e.fee, 'issuance');
    add(o.code, 'EXP-STAFF', e.staff * 0.55, 'issuance');
    const insUsd = Math.round((e.insurance * 0.4) / fx(period, 'USD'));
    add(o.code, 'EXP-INS', insUsd * fx(period, 'USD'), 'storage', { currency: 'USD', amountFx: insUsd });
    add(o.code, 'EXP-INS', e.insurance * 0.6, 'storage');
    add(o.code, 'EXP-CNT', e.counting * 0.4, 'processing');
    const ekc = ndoObjectsSeed.find((x) => x.key === o.parentKey)!;
    add(`${ekc.code}:${cb}`, 'EXP-CNT', e.counting * 0.6, 'processing', { code: ekc.code });
    add(`${ekc.code}:staff:${cb}`, 'EXP-STAFF', e.staff * 0.45, 'processing', { code: ekc.code });
    const rt = ndoObjectsSeed.find((x) => x.key === ROUTE_OF[cb])!;
    add(`${rt.code}:${cb}`, 'EXP-CIT', e.cit, 'collection', { code: rt.code });
    const veh = ndoObjectsSeed.find((x) => x.key === VEH_OF[rt.key])!;
    add(`${veh.code}:${cb}`, 'EXP-TRN', e.transport, 'transport', { code: veh.code });
  }
  for (const d of ndoObjectsSeed.filter((x) => DEVICE_TYPES.includes(x.type))) {
    const tx = Math.round(42_000 * ndoNoise(d.key + 'tx') * k);
    add(d.code, 'INC-DEV', tx * 3_200 * ndoNoise(d.key + 'fee', 0.1), 'issuance');
    add(d.code, 'EXP-COMM', 1.2 * M * k, 'issuance');
    add(d.code, 'EXP-REP', (d.key.endsWith('F01') ? 38 : 6) * M * ndoNoise(d.key + period + 'rep', 0.3) * k, 'issuance');
  }
  add('EKC-TSH', 'INC-CIT', 0.62 * B * k * ndoNoise(period + 'cit', 0.05), 'collection');
  add('EKC-TSH', 'INT-SRV', 0.31 * B * k, 'processing', { external: false });
  add('EKC-TSH', 'EXP-DSVC', 0.124 * B * k, 'issuance', { pool: 'POOL-DEV', code: 'EKC-TSH' });
  add('SORT-TSH', 'EXP-REP', 14 * M * k, 'processing');
  add('CNT-SAM', 'EXP-REP', 5 * M * k, 'processing');
  const fxUsd = Math.round((0.42 * B * k) / fx(period, 'USD'));
  add('FX-BUX', 'INC-FX', fxUsd * fx(period, 'USD'), 'sale', { currency: 'USD', amountFx: fxUsd });
  add('FX-BUX', 'EXP-RENT', 18 * M * k, 'sale');
  add('DSK-MIR', 'EXP-RENT', 24 * M * k, 'issuance');
  add('DSK-MIR', 'EXP-STAFF', 61 * M * k, 'issuance');
  add('MOB-TO', 'EXP-TRN', 22 * M * k, 'issuance');
  add('MOB-TO', 'EXP-STAFF', 38 * M * k, 'issuance');
  add('DSK-MIR', 'INC-CASH', 0.11 * B * k, 'issuance');
  // Косвенные расходы — пулы (без объекта)
  out.push({ key: `GL:${period}:POOL-ADM:EXP-ADM`, article: 'EXP-ADM', amount: Math.round(0.9 * B * k), currency: 'UZS', process: 'storage', pool: 'POOL-ADM', external: true, ref: `iABS:${period}:EXP-ADM` });
  out.push({ key: `GL:${period}:POOL-ADM:EXP-SEC`, article: 'EXP-SEC', amount: Math.round(0.55 * B * k), currency: 'UZS', process: 'storage', pool: 'POOL-ADM', external: true, ref: `iABS:${period}:EXP-SEC` });
  return out;
}

function genVolumes(period: string): { key: string; code: string; driver: NdoVolume['driver']; value: number; ref: string }[] {
  const out: { key: string; code: string; driver: NdoVolume['driver']; value: number; ref: string }[] = [];
  const k = KPERIOD[period] ?? 1;
  const add = (code: string, driver: NdoVolume['driver'], value: number, src: string) => out.push({ key: `VOL:${period}:${code}:${driver}`, code, driver, value: Math.round(value), ref: `${src}:${period}:${code}:${driver}` });
  const ekcVol: Record<string, number> = {};
  for (const cb of ['cb1', 'cb2', 'cb3', 'cb4', 'cb5', 'cb6', 'cb7', 'cb8', 'cb9']) {
    const e = econ(cb, period);
    const o = ndoObjectsSeed.find((x) => x.cashBranchId === cb)!;
    if (!e) continue;
    add(o.code, 'volume', e.volume, 'CashSys');
    add(o.code, 'collections', 26 * 28 * ndoNoise(o.key + 'col') * k, 'CashSys');
    add(o.code, 'transactions', (e.volume / 9_000_000) * ndoNoise(o.key + 'trx', 0.1), 'Processing');
    ekcVol[o.parentKey!] = (ekcVol[o.parentKey!] ?? 0) + e.volume;
  }
  for (const [key, v] of Object.entries(ekcVol)) add(ndoObjectsSeed.find((x) => x.key === key)!.code, 'volume', v, 'CashSys');
  for (const [code, v] of [['DSK-MIR', 62 * B], ['MOB-TO', 18 * B], ['FX-BUX', 31 * B]] as const) {
    add(code, 'volume', v * k, 'CashSys');
    add(code, 'collections', 9 * 20 * k, 'CashSys');
    add(code, 'transactions', (v * k) / 4_000_000, 'Processing');
  }
  for (const d of ndoObjectsSeed.filter((x) => DEVICE_TYPES.includes(x.type))) {
    add(d.code, 'transactions', 42_000 * ndoNoise(d.key + 'tx') * k, 'Processing');
    add(d.code, 'collections', 12 * ndoNoise(d.key + 'col', 0.3) * k, 'CashSys');
    add(d.code, 'volume', 42_000 * ndoNoise(d.key + 'tx') * k * 640_000, 'Processing');
  }
  for (const r of ndoObjectsSeed.filter((x) => x.type === 'cit_route')) add(r.code, 'route_km', (r.routeKm ?? 0) * 22 * k, 'CashSys');
  return out;
}

function genHr(period: string) {
  const fte: Record<string, number> = { 'EKC-TSH': 64, 'EKC-SAM': 22, TSH: 18, YUN: 11, CHL: 12, SAM: 13, BUX: 9, FAR: 10, NAM: 8, AND: 9, NUK: 7, 'DSK-MIR': 4, 'MOB-TO': 3, 'FX-BUX': 2 };
  return Object.entries(fte).map(([code, v]) => ({ key: `HR:${period}:${code}`, code, driver: 'fte' as const, value: v, ref: `Laborlaw:${period}:${code}` }));
}

function genSd(period: string) {
  const out: { key: string; code: string; driver: NdoVolume['driver']; value: number; ref: string }[] = [];
  for (const d of ndoObjectsSeed.filter((x) => DEVICE_TYPES.includes(x.type))) {
    const inc = Math.max(0, Math.round((d.key.endsWith('F01') ? 9 : 3) * ndoNoise(d.key + period + 'inc', 0.4)));
    out.push({ key: `SD:${period}:${d.code}:incidents`, code: d.code, driver: 'incidents', value: inc, ref: `SD:${period}:${d.code}` });
    out.push({ key: `SD:${period}:${d.code}:downtime`, code: d.code, driver: 'downtime_h', value: Math.round(inc * 5.5 * ndoNoise(d.key + period, 0.3)), ref: `SD:${period}:${d.code}` });
  }
  // В сентябре Service Desk передаёт инцидент по устройству с кодом, отсутствующим в реестре НДО.
  if (period === '2026-09') out.push({ key: `SD:${period}:ATM-T09:incidents`, code: 'ATM-T09', driver: 'downtime_h', value: 14, ref: `SD:${period}:INC-77812` });
  return out;
}

function genOpti(period: string): Omit<NdoOptiRec, 'period'>[] {
  const out: Omit<NdoOptiRec, 'period'>[] = [];
  for (const d of ndoObjectsSeed.filter((x) => x.type === 'atm' || x.type === 'recycler')) {
    for (const day of [3, 10, 17, 24]) {
      if (period === '2026-10' && day > 17) continue;
      const rec = Math.round(((d.normative ?? 0.3 * B) * 1.6 * ndoNoise(d.key + period + day, 0.2)) / M) * M;
      const followed = ndoNoise(d.key + day + period, 0.5) > 0.92 ? false : true;
      const actual = followed ? rec : Math.round((rec * (ndoNoise(d.key + day, 0.4) > 1 ? 1.45 : 0.6)) / M) * M;
      out.push({ id: `OPT:${period}:${d.code}:${day}`, objectKey: d.key, date: `${period}-${String(day).padStart(2, '0')}`, recommended: rec, actual, followed, cashOutHours: followed ? 0 : actual < rec ? Math.round(9 * ndoNoise(d.key + day)) : 0, excessAfter: followed ? 0 : actual > rec ? actual - rec : 0 });
    }
  }
  return out;
}

function genBalances(period: string): NdoBalance[] {
  const out: NdoBalance[] = [];
  const branches = cashInternal.branches();
  for (let day = 1; day <= DAYS(period); day++) {
    const date = `${period}-${String(day).padStart(2, '0')}`;
    for (const o of ndoObjectsSeed.filter((x) => CASH_HOLDERS.includes(x.type))) {
      const br = o.cashBranchId ? branches.find((b) => b.id === o.cashBranchId) : undefined;
      for (const c of CCY) {
        let base: number;
        if (br) base = br.balances[c];
        else if (c !== 'UZS') base = o.type === 'exchange' ? (c === 'USD' ? 52_000 : c === 'EUR' ? 9_000 : 1_400_000) : o.type === 'ekc' ? (c === 'USD' ? 380_000 : c === 'EUR' ? 60_000 : 6_000_000) : 0;
        else base = (o.normative ?? 0) * (o.type === 'ekc' ? 1.35 : DEVICE_TYPES.includes(o.type) ? 0.9 : 1.15);
        if (!base) continue;
        const amount = Math.round(base * ndoNoise(`${o.key}${c}${date}`, 0.12));
        const state = DEVICE_TYPES.includes(o.type) ? 'device' : o.type === 'ekc' ? 'processing' : o.type === 'vault' ? 'vault' : 'desk';
        const bal: NdoBalance = { date, objectKey: o.key, currency: c, state, amount };
        if (c === 'UZS' && (o.type === 'vault' || o.type === 'ekc')) {
          bal.denominations = { '200000': Math.round(amount * 0.46), '100000': Math.round(amount * 0.34), '50000': Math.round(amount * 0.14), '10000': amount - Math.round(amount * 0.46) - Math.round(amount * 0.34) - Math.round(amount * 0.14) };
          bal.unfit = Math.round(3 + ndoNoise(o.key + date, 0.5) * 2);
        }
        out.push(bal);
      }
    }
  }
  return out;
}

/** Ставки FTP из модуля 4.2.15 на срок хранения; EUR и RUB — кривая USD + спред (методика НДО). */
async function readFtp(storageDays: number): Promise<Record<CashCurrency, number>> {
  const curves = await ftpApi.listCurves();
  const tenor = Math.max(1, storageDays / 30);
  const r = (c: 'UZS' | 'USD') => {
    const curve = curves.find((x) => x.currency === c);
    return curve ? Math.round(ftpInterpolate(curve, tenor) * 100) / 100 : c === 'UZS' ? 14.5 : 4.7;
  };
  return { UZS: r('UZS'), USD: r('USD'), EUR: Math.round((r('USD') + 0.5) * 100) / 100, RUB: Math.round((r('USD') + 3) * 100) / 100 };
}

// ---------------------------------------------------------------------------------------------
// Интеграции: регистрация операций шины для наборов данных НДО

function addOps(systemId: string, ops: IntegrationOperation[]) {
  const sys = INTEGRATION_SYSTEMS.find((s) => s.id === systemId);
  if (!sys) return;
  for (const o of ops) if (!sys.operations.some((x) => x.id === o.id)) sys.operations.push(o);
  if (!sys.modules.includes('cash')) sys.modules.push('cash');
}
const sumAmounts = (rs: { amount?: number; value?: number }[]) => rs.reduce((s, r) => s + (r.amount ?? r.value ?? 0), 0);
function sourceOf(dataset: string, period: string): { rows: number; controlSum: number } {
  switch (dataset) {
    case 'DS-GL': {
      const g = genGL(period);
      return { rows: g.length, controlSum: sumAmounts(g) };
    }
    case 'DS-VOL': {
      const v = genVolumes(period);
      return { rows: v.length, controlSum: v.filter((x) => x.driver === 'transactions').reduce((s, x) => s + x.value, 0) };
    }
    case 'DS-SD': {
      const v = genSd(period);
      return { rows: v.length, controlSum: v.filter((x) => x.driver === 'downtime_h').reduce((s, x) => s + x.value, 0) };
    }
    case 'DS-HR': {
      const v = genHr(period);
      return { rows: v.length, controlSum: sumAmounts(v) };
    }
    case 'DS-OPT': {
      const v = genOpti(period);
      return { rows: v.length, controlSum: v.reduce((s, x) => s + x.recommended, 0) };
    }
    case 'DS-CASH': {
      const v = genBalances(period).filter((b) => b.date === periodEnd(period));
      return { rows: genBalances(period).length, controlSum: v.reduce((s, b) => s + Math.round(b.amount * fx(period, b.currency)), 0) };
    }
    default:
      return { rows: 0, controlSum: 0 };
  }
}
const dsOp = (id: string, ru: string, uz: string, en: string): IntegrationOperation => ({
  id, direction: 'in', schemaVersion: '1.0', name: L(ru, uz, en), sample: () => ({ dataset: 'DS-VOL', period: '2026-09' }),
  validate: (p) => (p.dataset && p.period ? null : { code: 'validation', message: 'dataset, period required' }),
  respond: (p) => ({ dataset: p.dataset, period: p.period, ...sourceOf(String(p.dataset), String(p.period)) }),
  amount: (p) => Number(p.expected ?? 0), count: () => 1,
});
addOps('cashsys', [dsOp('ndo.dataset', 'Набор данных НДО (остатки, объёмы, OptiLoad, Service Desk)', "NPA ma'lumotlar to'plami (qoldiqlar, hajmlar, OptiLoad, Service Desk)", 'Cash dataset (balances, volumes, OptiLoad, Service Desk)')]);
addOps('iabs', [dsOp('ndo.gl', 'Обороты ГК по статьям НДО', "NPA moddalari bo'yicha BK aylanmalari", 'GL turnover by cash articles')]);
addOps('laborlaw', [dsOp('ndo.fte', 'Численность персонала НДО по МВЗ', "XJM bo'yicha NPA xodimlari soni", 'Cash staff FTE by cost centre')]);

// ---------------------------------------------------------------------------------------------
// Права и разделение функций (BR-NDO-25)

type Fn = 'input' | 'calc' | 'check' | 'approve';
export function ndoCan(user: Pick<User, 'role' | 'extraRoles' | 'active'> | null | undefined, fn: Fn): boolean {
  if (!user || !can(user as User, 'cash', fn === 'check' || fn === 'approve' ? 'view' : 'edit')) return false;
  if (user.role === 'admin') return true;
  const roles = [user.role, ...(user.extraRoles ?? [])];
  return db.params.roles[fn].some((r) => roles.includes(r));
}
function assertFn(user: User, fn: Fn) {
  if (!ndoCan(user, fn)) throw new Error('ndo_err_role');
}
function assertOpen(period: string) {
  if (db.periods[period]?.status === 'closed') throw new Error('ndo_err_closed');
  if (db.periods[period]?.status === 'pending_approval') throw new Error('ndo_err_pending');
}

// ---------------------------------------------------------------------------------------------
// Загрузка наборов данных (BR-NDO-03/04): полнота, без дублей, повторный запуск, метаданные, прослеживаемость

function resolveObject(code: string): string | undefined {
  return db.codeMap[code] ?? objByCode(code)?.key;
}

function applyLoad(datasetId: string, period: string, userId: ID, exchangeId: string | undefined, source: { rows: number; controlSum: number }): NdoLoad {
  const loadId = nextId('ndl');
  let inserted = 0;
  let updated = 0;
  let duplicates = 0;
  let rejected = 0;
  let controlLoaded = 0;
  const keys: string[] = [];
  const upsert = <T extends { id: string }>(list: T[], rec: T, same: (a: T, b: T) => boolean) => {
    const i = list.findIndex((x) => x.id === rec.id);
    keys.push(rec.id);
    if (i < 0) {
      list.push(rec);
      inserted++;
    } else if (same(list[i]!, rec)) duplicates++;
    else {
      list[i] = rec;
      updated++;
    }
  };
  const reject = (sourceRef: string, code: string, amount: number) => {
    rejected++;
    if (!db.errors.some((e) => e.sourceRef === sourceRef && e.status === 'open')) {
      db.errors.push({ id: nextId('nde'), datasetId, period, sourceRef, reason: 'unknown_object', sourceCode: code, amount, status: 'open', ownerRole: datasetId === 'DS-SD' ? 'support' : 'treasury' });
    }
  };
  if (datasetId === 'DS-GL') {
    for (const r of genGL(period)) {
      const objectKey = r.pool ? undefined : r.code ? resolveObject(r.code) : undefined;
      if (!r.pool && r.code && !objectKey) {
        reject(r.ref, r.code, r.amount);
        continue;
      }
      controlLoaded += r.amount;
      upsert(db.facts, { id: r.key, datasetId, period, article: r.article, ...(objectKey ? { objectKey } : {}), ...(r.pool ? { pool: r.pool } : {}), ...(r.process ? { process: r.process } : {}), currency: r.currency, amount: r.amount, ...(r.amountFx ? { amountFx: r.amountFx } : {}), external: r.external, sourceRef: r.ref, loadId }, (a, b) => a.amount === b.amount && a.objectKey === b.objectKey);
    }
  } else if (datasetId === 'DS-VOL' || datasetId === 'DS-HR' || datasetId === 'DS-SD') {
    const gen = datasetId === 'DS-VOL' ? genVolumes(period) : datasetId === 'DS-HR' ? genHr(period) : genSd(period);
    for (const r of gen) {
      const objectKey = resolveObject(r.code);
      if (!objectKey) {
        reject(r.ref, r.code, r.value);
        continue;
      }
      if (datasetId === 'DS-VOL' && r.driver === 'transactions') controlLoaded += r.value;
      if (datasetId === 'DS-SD' && r.driver === 'downtime_h') controlLoaded += r.value;
      if (datasetId === 'DS-HR') controlLoaded += r.value;
      upsert(db.volumes, { id: r.key, period, objectKey, driver: r.driver, value: r.value, sourceRef: r.ref, loadId }, (a, b) => a.value === b.value && a.objectKey === b.objectKey);
    }
  } else if (datasetId === 'DS-OPT') {
    for (const r of genOpti(period)) {
      controlLoaded += r.recommended;
      upsert(db.opti, { ...r, period }, (a, b) => a.actual === b.actual);
    }
  } else if (datasetId === 'DS-CASH') {
    const gen = genBalances(period);
    const before = db.balances.filter((b) => b.date.startsWith(period)).length;
    db.balances = db.balances.filter((b) => !b.date.startsWith(period)).concat(gen);
    if (before) duplicates = gen.length;
    else inserted = gen.length;
    controlLoaded = gen.filter((b) => b.date === periodEnd(period)).reduce((s, b) => s + Math.round(b.amount * fx(period, b.currency)), 0);
    keys.push(`${period}:${gen.length}`);
  }
  const status = Math.abs(controlLoaded - source.controlSum) > 0 ? 'mismatch' : 'success';
  const load: NdoLoad = { id: loadId, datasetId, period, at: now(), by: userId, ...(exchangeId ? { exchangeId } : {}), status, rows: source.rows, inserted, updated, duplicates, rejected, controlSource: source.controlSum, controlLoaded, hash: sha256Hex(keys.sort().join('|')).slice(0, 16) };
  db.loads.unshift(load);
  return load;
}

async function loadErp(datasetId: string, period: string, userId: ID): Promise<NdoLoad> {
  if (datasetId === 'DS-FTP') {
    db.ftp[period] = await readFtp(db.params.storageDays);
    const load: NdoLoad = { id: nextId('ndl'), datasetId, period, at: now(), by: userId, status: 'success', rows: 4, inserted: 4, updated: 0, duplicates: 0, rejected: 0, controlSource: 4, controlLoaded: 4, hash: sha256Hex(JSON.stringify(db.ftp[period])).slice(0, 16) };
    db.loads.unshift(load);
    return load;
  }
  // Доля общебанковских расходов из модуля аллокации (4.2.14): 2,4% косвенных пулов банка за квартал / 3.
  let share = 0;
  try {
    const alloc = (await import('../allocation')).allocationApi as unknown as { listPools?: () => Promise<{ amounts?: Record<string, number> }[]> };
    const pools = (await alloc.listPools?.()) ?? [];
    const q = `${period.slice(0, 4)}-Q${Math.ceil(Number(period.slice(5, 7)) / 3)}`;
    const total = pools.reduce((s, p) => s + (p.amounts?.[q] ?? 0), 0);
    share = total ? Math.round((total * 0.024) / 3) : 0;
  } catch {
    share = 0;
  }
  if (!share) share = Math.round(1.15 * B * (KPERIOD[period] ?? 1));
  db.hoShare[period] = share;
  const load: NdoLoad = { id: nextId('ndl'), datasetId, period, at: now(), by: userId, status: 'success', rows: 1, inserted: 1, updated: 0, duplicates: 0, rejected: 0, controlSource: share, controlLoaded: share, hash: sha256Hex(`${period}:${share}`).slice(0, 16) };
  db.loads.unshift(load);
  return load;
}

// ---------------------------------------------------------------------------------------------
// Расчёт: прямое отнесение → аллокация → фондирование → себестоимость → P&L

interface Ctx {
  period: string;
  objects: NdoObject[];
  facts: NdoFact[];
  adjustments: NdoAdjustment[];
  volumes: NdoVolume[];
  balances: NdoBalance[];
  transit: NdoTransitItem[];
  rules: NdoRule[];
  params: NdoParams;
  ftp: Record<CashCurrency, number>;
  fx: Record<CashCurrency, number>;
  hoShare: number;
  classVersion: number;
}

function liveCtx(period: string): Ctx {
  const end = periodEnd(period);
  return {
    period,
    objects: objectsAt(end),
    facts: db.facts.filter((f) => f.period === period),
    adjustments: db.adjustments.filter((a) => a.period === period && a.status === 'approved'),
    volumes: db.volumes.filter((v) => v.period === period),
    balances: db.balances.filter((b) => b.date.startsWith(period)),
    transit: period === today().slice(0, 7) ? transitItems() : [],
    rules: db.rules.filter((r) => r.status === 'active' && r.validFrom <= end && (!r.validTo || r.validTo >= end)),
    params: clone(db.params),
    ftp: db.ftp[period] ?? { UZS: 0, USD: 0, EUR: 0, RUB: 0 },
    fx: NDO_FX[period] ?? CASH_RATES,
    hoShare: db.hoShare[period] ?? 0,
    classVersion: Math.max(...db.classes.map((c) => c.version)),
  };
}

const PROCESS_MIX: Partial<Record<NdoObjectType, Record<string, number>>> = {
  cbu: { issuance: 0.35, acceptance: 0.35, storage: 0.1, processing: 0.1, reinforcement: 0.1 },
  cash_desk: { issuance: 0.5, acceptance: 0.5 },
  mobile_desk: { issuance: 0.5, acceptance: 0.5 },
  exchange: { sale: 0.8, storage: 0.2 },
  atm: { issuance: 0.7, reinforcement: 0.2, storage: 0.1 },
  cash_in: { acceptance: 0.7, collection: 0.3 },
  recycler: { issuance: 0.45, acceptance: 0.45, storage: 0.1 },
};
const POOL_SOURCE: Record<string, NdoObjectType[]> = { 'POOL-EKC': ['ekc', 'equipment'], 'POOL-CIT': ['cit_route', 'vehicle'] };
const RULE_ORDER = ['POOL-ADM', 'POOL-EKC', 'POOL-CIT', 'POOL-DEV', 'POOL-HO'];

function fundingRows(ctx: Ctx, scn?: Pick<NdoScenario, 'balancePct' | 'storageDays' | 'fxPct' | 'ftpBp'>, curveRate?: (c: CashCurrency, days: number) => number): NdoFundingRow[] {
  const rows: NdoFundingRow[] = [];
  const days = DAYS(ctx.period);
  for (const o of ctx.objects.filter((x) => CASH_HOLDERS.includes(x.type))) {
    const per = CCY.map((c) => {
      const bs = ctx.balances.filter((b) => b.objectKey === o.key && b.currency === c);
      const avg = bs.length ? bs.reduce((s, b) => s + b.amount, 0) / bs.length : 0;
      const k = scn ? 1 + scn.balancePct / 100 : 1;
      const rate = ctx.fx[c] * (scn && c !== 'UZS' ? 1 + scn.fxPct / 100 : 1);
      return { c, avg: avg * k, avgUzs: avg * k * rate, rate };
    }).filter((x) => x.avg > 0);
    const totalUzs = per.reduce((s, x) => s + x.avgUzs, 0);
    if (!totalUzs) continue;
    const normative = Math.min(totalUzs, o.normative ?? 0);
    const necessary = Math.min(totalUzs - normative, Math.max(0, (o.normative ?? 0) * (ctx.params.necessaryFactor - 1)));
    const excess = Math.max(0, totalUzs - normative - necessary);
    for (const x of per) {
      const share = x.avgUzs / totalUzs;
      const storage = (scn?.storageDays ?? 0) + ctx.params.storageDays;
      const ftpRate = (curveRate ? curveRate(x.c, storage) : ctx.ftp[x.c]) + (scn ? scn.ftpBp / 100 : 0);
      const k = (ftpRate / 100) * (days / 365);
      rows.push({
        objectKey: o.key, currency: x.c, avgBalance: Math.round(x.avg), avgUzs: Math.round(x.avgUzs), normative: Math.round(normative * share), necessary: Math.round(necessary * share), excess: Math.round(excess * share),
        ftpRate: Math.round(ftpRate * 100) / 100, fxRate: Math.round(x.rate * 100) / 100, days,
        cost: Math.round(x.avgUzs * k), costNormative: Math.round(normative * share * k), costNecessary: Math.round(necessary * share * k), costExcess: Math.round(excess * share * k),
      });
    }
  }
  // Деньги в пути: фондирование относится на единственного владельца — маршрут инкассации.
  for (const t of ctx.transit) {
    const avgUzs = t.amount * ctx.fx[t.currency];
    const ftpRate = ctx.ftp[t.currency] + (scn ? scn.ftpBp / 100 : 0);
    const k = (ftpRate / 100) * (1 / 365);
    rows.push({ objectKey: t.ownerKey, currency: t.currency, avgBalance: t.amount, avgUzs: Math.round(avgUzs), normative: 0, necessary: Math.round(avgUzs), excess: 0, ftpRate, fxRate: ctx.fx[t.currency], days: 1, cost: Math.round(avgUzs * k), costNormative: 0, costNecessary: Math.round(avgUzs * k), costExcess: 0 });
  }
  return rows;
}

function compute(ctx: Ctx): NdoResults {
  const byObj = new Map<string, NdoObjectResult>();
  const res = (key: string) => {
    let r = byObj.get(key);
    if (!r) {
      r = { key, income: 0, incomeInternal: 0, direct: 0, ndoAlloc: 0, hoAlloc: 0, funding: 0, total: 0, result: 0, volume: 0, transactions: 0, collections: 0, costPerMln: 0 };
      byObj.set(key, r);
    }
    return r;
  };
  for (const o of ctx.objects) res(o.key);
  const income = (a: string) => a.startsWith('INC-') || a.startsWith('INT-');
  const pools: Record<string, number> = { 'POOL-ADM': 0, 'POOL-DEV': 0, 'POOL-HO': ctx.hoShare, 'POOL-EKC': 0, 'POOL-CIT': 0 };
  // 1. Прямое отнесение (факты + утверждённые корректировки отдельным слоем)
  for (const f of [...ctx.facts, ...ctx.adjustments.map((a) => ({ article: a.article, objectKey: a.objectKey, pool: a.objectKey ? undefined : 'POOL-ADM', amount: a.amount, external: true }))]) {
    if (income(f.article)) {
      if (!f.objectKey) continue;
      if (f.external === false || f.article.startsWith('INT-')) res(f.objectKey).incomeInternal += f.amount;
      else res(f.objectKey).income += f.amount;
      continue;
    }
    if (f.objectKey) res(f.objectKey).direct += f.amount;
    else if (f.pool) pools[f.pool] = (pools[f.pool] ?? 0) + f.amount;
  }
  for (const v of ctx.volumes) {
    const r = res(v.objectKey);
    if (v.driver === 'volume') r.volume += v.value;
    if (v.driver === 'transactions') r.transactions += v.value;
    if (v.driver === 'collections') r.collections += v.value;
  }
  // 2. Аллокация: пулы ЕКЦ и инкассации формируются из прямых расходов объектов-источников (+ полученного по цепочке).
  const allocation: NdoAllocRow[] = [];
  const poolSummary: { pool: string; amount: number; allocated: number }[] = [];
  const driverOf = (key: string, d: NdoVolume['driver']) => ctx.volumes.filter((v) => v.objectKey === key && v.driver === d).reduce((s, v) => s + v.value, 0);
  for (const pool of RULE_ORDER) {
    const rule = ctx.rules.find((r) => r.pool === pool);
    let amount = pools[pool] ?? 0;
    if (POOL_SOURCE[pool]) {
      for (const o of ctx.objects.filter((x) => POOL_SOURCE[pool]!.includes(x.type))) {
        const r = res(o.key);
        const out = r.direct + r.ndoAlloc;
        if (!out) continue;
        amount += out;
        r.ndoAlloc -= out; // перенесено в пул (раскрытие цепочки)
      }
    }
    if (!rule || !amount) {
      if (amount) poolSummary.push({ pool, amount, allocated: 0 });
      continue;
    }
    const receivers = ctx.objects.filter((o) => rule.receiverTypes.includes(o.type) && o.status !== 'closed').map((o) => ({ key: o.key, d: driverOf(o.key, rule.driver) })).filter((x) => x.d > 0);
    const totalD = receivers.reduce((s, x) => s + x.d, 0);
    let left = Math.round(amount);
    const sorted = [...receivers].sort((a, b) => b.d - a.d);
    sorted.forEach((x, i) => {
      const share = totalD ? x.d / totalD : 0;
      const amt = i === sorted.length - 1 ? left : Math.round(amount * share);
      left -= amt;
      allocation.push({ ruleId: rule.id, step: rule.step, pool, receiver: x.key, driverValue: x.d, share: Math.round(share * 10_000) / 10_000, amount: amt });
      if (rule.step === 'bank_share') res(x.key).hoAlloc += amt;
      else res(x.key).ndoAlloc += amt;
    });
    poolSummary.push({ pool, amount: Math.round(amount), allocated: allocation.filter((a) => a.pool === pool).reduce((s, a) => s + a.amount, 0) });
  }
  // 3. Стоимость фондирования
  const funding = fundingRows(ctx);
  for (const f of funding) res(f.objectKey).funding += f.cost;
  // 4. Себестоимость и результат
  const objects = [...byObj.values()].map((r) => {
    const total = r.direct + r.ndoAlloc + r.hoAlloc + r.funding;
    return { ...r, total, result: r.income - total, costPerMln: r.volume ? Math.round(total / (r.volume / M)) : 0 };
  });
  const byProcessMap = new Map<string, number>();
  for (const r of objects) {
    const o = ctx.objects.find((x) => x.key === r.key);
    const mix = o ? PROCESS_MIX[o.type] : undefined;
    if (mix) for (const [p, w] of Object.entries(mix)) byProcessMap.set(p, (byProcessMap.get(p) ?? 0) + Math.round(r.total * w));
    else if (r.total) {
      const k = o?.type === 'cit_route' || o?.type === 'vehicle' ? 'collection' : o?.type === 'ekc' || o?.type === 'equipment' ? 'processing' : 'storage';
      byProcessMap.set(k, (byProcessMap.get(k) ?? 0) + r.total);
    }
  }
  const t = (k: keyof NdoObjectResult) => objects.reduce((s, r) => s + (r[k] as number), 0);
  const totals = { income: t('income'), incomeInternal: t('incomeInternal'), direct: t('direct'), ndoAlloc: t('ndoAlloc'), hoAlloc: t('hoAlloc'), funding: t('funding'), total: t('total'), result: t('result'), volume: objects.filter((r) => ctx.objects.find((o) => o.key === r.key)?.type === 'cbu').reduce((s, r) => s + r.volume, 0) };
  const out: Omit<NdoResults, 'hash'> = { period: ctx.period, objects, allocation, pools: poolSummary, funding, byProcess: [...byProcessMap.entries()].map(([process, cost]) => ({ process, cost })), totals, methodology: ctx.params.methodology };
  return { ...out, hash: sha256Hex(JSON.stringify(out)).slice(0, 24) };
}

function transitItems(): NdoTransitItem[] {
  return cashInternal.orders().filter((o) => o.status === 'in_transit').map((o) => {
    const cbObj = objByBranch(o.branchId);
    // Единственный учётный владелец денег в пути — маршрут инкассации филиала.
    const owner = ROUTE_OF[o.branchId] ?? 'NDO-RT-01';
    return { orderId: o.id, number: o.number, ownerKey: owner, fromKey: o.type === 'reinforcement' ? 'NDO-VLT-00' : cbObj?.key ?? o.branchId, toKey: o.type === 'reinforcement' ? cbObj?.key ?? o.branchId : 'NDO-VLT-00', currency: o.currency, amount: o.amount, since: o.dispatchedAt ?? o.plannedDate };
  });
}

export function ndoResults(period: string): NdoResults {
  const st = db.periods[period];
  if (st?.status === 'closed' && st.snapshot) return st.snapshot.results;
  return compute(liveCtx(period));
}

// ---------------------------------------------------------------------------------------------
// Бюджет и план-факт (BR-NDO-07…09)

function seedBudget() {
  const months = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
  for (const period of months) {
    const basePeriod = NDO_PERIODS.includes(period) && period !== '2026-10' ? period : '2026-09';
    const kPlan = period === '2026-10' || !NDO_PERIODS.includes(period) ? 1.02 : 1;
    const gl = genGL(basePeriod);
    const vol = genVolumes(basePeriod);
    const agg = new Map<string, { article: string; code: string; amount: number; process: string }>();
    for (const r of gl.filter((x) => x.code)) {
      const k = `${r.article}|${r.code}`;
      const a = agg.get(k) ?? { article: r.article, code: r.code!, amount: 0, process: r.process ?? 'storage' };
      a.amount += r.amount;
      agg.set(k, a);
    }
    for (const a of agg.values()) {
      const o = ndoObjectsSeed.find((x) => x.code === a.code);
      if (!o) continue;
      const driverRec = a.article === 'EXP-CIT' ? vol.find((v) => v.code === a.code && v.driver === 'route_km') : a.article === 'EXP-CNT' || a.article === 'INC-CASH' ? vol.find((v) => v.code === a.code && v.driver === 'volume') : a.article === 'INC-DEV' ? vol.find((v) => v.code === a.code && v.driver === 'transactions') : undefined;
      const noise = ndoNoise(`${a.article}${a.code}plan`, 0.06);
      const amount = Math.round(a.amount * kPlan * noise * (a.article.startsWith('INC') ? 1.03 : 0.97));
      const fxLine = a.article === 'INC-FX' || (a.article === 'EXP-INS' && false);
      const line: NdoBudgetLine = {
        id: `bd-${period}-${a.article}-${a.code}`, period, scenario: 'base', article: a.article, objectKey: o.key, costCenterCode: o.costCenterCode, process: a.process, currency: fxLine ? 'USD' : 'UZS',
        method: driverRec ? 'driver' : 'zbb', amount, ...(fxLine ? { fxRate: NDO_FX.plan!.USD } : {}),
        ...(driverRec ? { driver: driverRec.driver, driverVolume: Math.round(driverRec.value * kPlan * ndoNoise(`${a.code}${a.article}pv`, 0.08)), rate: Math.round((amount / Math.max(1, driverRec.value * kPlan * ndoNoise(`${a.code}${a.article}pv`, 0.08))) * 100) / 100 } : { justification: 'ZBB: обоснование статьи с нуля по нормативу и штатному расписанию' }),
      };
      db.budget.push(line);
    }
    db.budget.push({ id: `bd-${period}-POOL-ADM`, period, scenario: 'base', article: 'EXP-ADM', objectKey: 'NDO-EKC-01', costCenterCode: 'MVZ-00-008-02', process: 'storage', currency: 'UZS', method: 'zbb', amount: Math.round(1.38 * B), justification: 'ZBB: управление НДО — 14 шт. ед. + охрана по договору' });
    db.budget.push({ id: `bd-${period}-FUND`, period, scenario: 'base', article: 'FUND', objectKey: 'NDO-VLT-00', costCenterCode: 'MVZ-00-008-02', process: 'storage', currency: 'UZS', method: 'driver', driver: 'volume', amount: Math.round(16.8 * B), justification: 'Плановый средний остаток × плановая ставка FTP (UZS 14,0%, USD 4,5%)' });
    db.budget.push({ id: `bd-${period}-HO`, period, scenario: 'base', article: 'EXP-HO', objectKey: 'NDO-EKC-01', costCenterCode: 'MVZ-00-008-02', process: 'storage', currency: 'UZS', method: 'zbb', amount: Math.round(1.1 * B), justification: 'Плановая доля общебанковских расходов (модуль 4.2.14)' });
  }
}
seedBudget();

const SCN_K: Record<NdoScenarioKind, { inc: number; exp: number }> = { base: { inc: 1, exp: 1 }, optimistic: { inc: 1.08, exp: 0.97 }, stress: { inc: 0.88, exp: 1.09 } };
function budgetFor(period: string, scenario: NdoScenarioKind = 'base'): NdoBudgetLine[] {
  const k = SCN_K[scenario];
  return db.budget.filter((b) => b.period === period && b.scenario === 'base').map((b) => (scenario === 'base' ? b : { ...b, scenario, amount: Math.round(b.amount * (b.article.startsWith('INC') ? k.inc : k.exp)) }));
}

function factorAnalysis(period: string, scenario: NdoScenarioKind = 'base'): NdoFactorRow[] {
  const plan = budgetFor(period, scenario);
  const r = ndoResults(period);
  const facts = db.facts.filter((f) => f.period === period);
  const arts = [...new Set([...plan.map((p) => p.article), ...facts.map((f) => f.article)])];
  const rows: NdoFactorRow[] = [];
  for (const a of arts) {
    const pl = plan.filter((p) => p.article === a);
    let planAmt = pl.reduce((s, p) => s + p.amount, 0);
    let actual = facts.filter((f) => f.article === a).reduce((s, f) => s + f.amount, 0);
    if (a === 'FUND') actual = r.totals.funding;
    if (a === 'EXP-HO') actual = r.totals.hoAlloc;
    if (a === 'EXP-ADM') {
      actual = facts.filter((f) => f.pool === 'POOL-ADM').reduce((s, f) => s + f.amount, 0);
      planAmt = pl.reduce((s, p) => s + p.amount, 0);
    }
    if (a === 'EXP-SEC') continue;
    const variance = actual - planAmt;
    let volume = 0;
    let structure = 0;
    let fxE = 0;
    let ftpE = 0;
    let allocE = 0;
    const drv = pl.find((p) => p.method === 'driver' && p.driver && p.driverVolume)?.driver;
    if (drv && a !== 'FUND') {
      const vp = pl.reduce((s, p) => s + (p.driverVolume ?? 0), 0);
      const va = pl.reduce((s, p) => s + db.volumes.filter((v) => v.period === period && v.objectKey === p.objectKey && v.driver === drv).reduce((x, v) => x + v.value, 0), 0);
      const pp = vp ? planAmt / vp : 0;
      volume = Math.round((va - vp) * pp);
      const objLevel = pl.reduce((s, p) => {
        const vai = db.volumes.filter((v) => v.period === period && v.objectKey === p.objectKey && v.driver === drv).reduce((x, v) => x + v.value, 0);
        return s + (vai - (p.driverVolume ?? 0)) * (p.rate ?? 0);
      }, 0);
      structure = Math.round(objLevel - volume);
    }
    if (a === 'INC-FX') {
      const fxAmt = facts.filter((f) => f.article === a).reduce((s, f) => s + (f.amountFx ?? 0), 0);
      fxE = Math.round(fxAmt * (fx(period, 'USD') - NDO_FX.plan!.USD));
    }
    if (a === 'FUND') {
      const planRate: Record<CashCurrency, number> = { UZS: 14, USD: 4.5, EUR: 5, RUB: 7.5 };
      ftpE = Math.round(r.funding.reduce((s, f) => s + f.avgUzs * ((f.ftpRate - planRate[f.currency]) / 100) * (f.days / 365), 0));
      volume = Math.round(variance - ftpE);
    }
    if (a === 'EXP-HO') allocE = variance;
    const price = variance - volume - structure - fxE - ftpE - allocE;
    rows.push({ article: a, plan: planAmt, actual, variance, volume, price, structure, fx: fxE, ftp: ftpE, allocation: allocE });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Качество данных и закрытие периода (BR-NDO-23/24)

async function dqChecks(period: string): Promise<NdoDqCheck[]> {
  const checks: NdoDqCheck[] = [];
  const latest = (ds: string) => db.loads.find((l) => l.datasetId === ds && l.period === period);
  const missing = db.datasets.filter((d) => d.mandatory && !latest(d.id));
  checks.push({ code: 'completeness', name: L('Полнота: загружены все обязательные наборы данных', "To'liqlik: barcha majburiy to'plamlar yuklangan", 'Completeness: all mandatory datasets loaded'), ok: !missing.length, severity: 'blocker', detail: missing.map((d) => d.id).join(', ') || '✓' });
  const mism = db.datasets.map((d) => latest(d.id)).filter((l): l is NdoLoad => !!l && l.status !== 'success');
  checks.push({ code: 'control_totals', name: L('Контрольные итоги совпадают с источниками', 'Nazorat yig‘indilari manbalar bilan mos', 'Control totals match the sources'), ok: !mism.length, severity: 'blocker', detail: mism.map((l) => `${l.datasetId}: ${l.controlLoaded} ≠ ${l.controlSource}`).join('; ') || '✓' });
  const errs = db.errors.filter((e) => e.period === period && e.status === 'open');
  checks.push({ code: 'errors', name: L('Нет неисправленных ошибочных записей', "Tuzatilmagan xato yozuvlar yo'q", 'No unresolved error records'), ok: !errs.length, severity: 'blocker', detail: errs.map((e) => `${e.datasetId}: ${e.sourceCode}`).join('; ') || '✓' });
  const gl = latest('DS-GL');
  const glFacts = db.facts.filter((f) => f.period === period && f.datasetId === 'DS-GL').reduce((s, f) => s + f.amount, 0);
  const glDiff = gl ? Math.abs(gl.controlSource - glFacts) : 0;
  checks.push({ code: 'gl_recon', name: L('Сверка с главной книгой (iABS)', 'Bosh kitob (iABS) bilan solishtirish', 'Reconciliation with the general ledger (iABS)'), ok: !!gl && glDiff <= db.params.glTolerance, severity: 'blocker', detail: gl ? `Δ ${glDiff}` : '—' });
  const ccs = await orgApi.listCostCenters({ pageSize: 100_000 });
  const codes = new Set(ccs.rows.map((c) => c.code));
  const badCc = objectsAt(periodEnd(period)).filter((o) => !codes.has(o.costCenterCode));
  checks.push({ code: 'mvz', name: L('Все объекты привязаны к действующим МВЗ', 'Barcha obyektlar amaldagi XJM ga bog‘langan', 'All objects linked to valid cost centres'), ok: !badCc.length, severity: 'blocker', detail: badCc.map((o) => o.code).join(', ') || '✓' });
  const keys = new Set(objectsAt(periodEnd(period)).map((o) => o.key));
  const orphans = db.facts.filter((f) => f.period === period && f.objectKey && !keys.has(f.objectKey));
  checks.push({ code: 'orphans', name: L('Нет фактов без действующего объекта', "Amaldagi obyektsiz faktlar yo'q", 'No facts without a valid object'), ok: !orphans.length, severity: 'blocker', detail: orphans.length ? String(orphans.length) : '✓' });
  const r = compute(liveCtx(period));
  const unbalanced = r.pools.filter((p) => p.allocated && Math.abs(p.amount - p.allocated) > 1);
  checks.push({ code: 'alloc_balance', name: L('Распределённые суммы равны исходным пулам', "Taqsimlangan summalar dastlabki pullarga teng", 'Allocated amounts equal source pools'), ok: !unbalanced.length, severity: 'blocker', detail: unbalanced.map((p) => p.pool).join(', ') || '✓' });
  const tr = period === today().slice(0, 7) ? transitItems() : [];
  checks.push({ code: 'transit', name: L('Деньги в пути: единственный учётный владелец', "Yo'ldagi pul: yagona hisob egasi", 'Cash in transit: single accounting owner'), ok: tr.every((x) => !!x.ownerKey), severity: 'blocker', detail: tr.length ? `${tr.length} × ${tr.map((x) => x.ownerKey).join(', ')}` : '✓' });
  const drafts = db.adjustments.filter((a) => a.period === period && a.status === 'draft');
  checks.push({ code: 'adjustments', name: L('Ручные корректировки утверждены', "Qo'lda tuzatishlar tasdiqlangan", 'Manual adjustments approved'), ok: !drafts.length, severity: 'warning', detail: drafts.length ? String(drafts.length) : '✓' });
  return checks;
}

function frozenCtx(period: string): Ctx {
  return clone(liveCtx(period));
}

function versionsNow(period: string): Record<string, number | string> {
  return {
    methodology: db.params.methodology,
    classifiers: Math.max(...db.classes.map((c) => c.version)),
    rules: db.rules.filter((r) => r.status === 'active').map((r) => `${r.code}v${r.version}`).join(','),
    ftpUZS: db.ftp[period]?.UZS ?? 0,
    fxUSD: NDO_FX[period]?.USD ?? 0,
    objects: db.objects.length,
  };
}

function closePeriod(period: string, by: ID) {
  const st = db.periods[period]!;
  const frozen = frozenCtx(period);
  const results = compute(frozen);
  st.snapshot = { at: now(), hash: results.hash, results, frozen, versions: versionsNow(period) };
  st.status = 'closed';
  st.steps.closed = { at: now(), by };
}

approvalEngine.register('cash_close', {
  onHistory: () => undefined,
  onFinal(period, approved) {
    const st = db.periods[period];
    if (!st) return;
    if (approved) {
      closePeriod(period, st.steps.approve?.by ?? 'system');
      audit.log({ action: 'approve', entity: 'ndo_period', entityId: period, details: `Период закрыт, снимок ${st.snapshot?.hash}` });
      notify({ roles: ['treasury', 'finance'], title: L(`Период НДО ${period} закрыт`, `NPA ${period} davri yopildi`, `Cash period ${period} closed`), link: '/cash/ndo?tab=close', level: 'success', kind: 'approved' });
    } else {
      st.status = 'open';
      delete st.steps.approve;
    }
    emit();
  },
  onReturned(period) {
    const st = db.periods[period];
    if (!st) return;
    st.status = 'open';
    delete st.steps.approve;
    emit();
  },
});

approvalEngine.register('cash_rule', {
  onHistory: (id, e) => {
    (db.ruleHistory[id] ??= []).push(e);
  },
  onFinal(id, approved) {
    const r = db.rules.find((x) => x.id === id);
    if (!r) return;
    if (approved) {
      for (const old of db.rules.filter((x) => x.code === r.code && x.id !== r.id && x.status === 'active')) {
        old.status = 'retired';
        old.validTo = new Date(Date.parse(r.validFrom) - 86_400_000).toISOString().slice(0, 10);
      }
      r.status = 'active';
      audit.log({ action: 'approve', entity: 'ndo_rule', entityId: r.id, details: `${r.code} v${r.version}` });
    } else r.status = 'rejected';
    emit();
  },
  onReturned(id) {
    const r = db.rules.find((x) => x.id === id);
    if (r) r.status = 'draft';
    emit();
  },
});

// ---------------------------------------------------------------------------------------------
// Начальное состояние: июль и август загружены и закрыты, сентябрь загружен без Service Desk, октябрь — частично.

async function bootstrap() {
  for (const period of ['2026-07', '2026-08', '2026-09', '2026-10']) {
    for (const ds of db.datasets) {
      if (period === '2026-09' && ds.id === 'DS-SD') continue;
      if (period === '2026-10' && !['DS-CASH', 'DS-FTP'].includes(ds.id)) continue;
      if (ds.system === 'erp_ftp' || ds.system === 'erp_alloc') {
        if (ds.id === 'DS-FTP') db.ftp[period] = { UZS: 14.5 + (period === '2026-07' ? 0.4 : period === '2026-08' ? 0.2 : 0), USD: 4.7, EUR: 5.2, RUB: 7.7 };
        else db.hoShare[period] = Math.round(1.15 * B * (KPERIOD[period] ?? 1));
        db.loads.unshift({ id: nextId('ndl'), datasetId: ds.id, period, at: `${period === '2026-10' ? '2026-10-17' : periodEnd(period)}T20:00:00Z`, by: 'u8', status: 'success', rows: ds.id === 'DS-FTP' ? 4 : 1, inserted: 1, updated: 0, duplicates: 0, rejected: 0, controlSource: 1, controlLoaded: 1, hash: sha256Hex(ds.id + period).slice(0, 16) });
        continue;
      }
      const l = applyLoad(ds.id, period, 'u12', `ix-seed-${ds.id}-${period}`, sourceOf(ds.id, period));
      l.at = `${period === '2026-10' ? '2026-10-17' : periodEnd(period)}T20:00:00Z`;
    }
    db.periods[period] = { period, steps: {}, status: 'open' };
  }
  for (const period of ['2026-07', '2026-08']) {
    const st = db.periods[period]!;
    for (const s of NDO_CLOSE_STEPS.slice(0, -1)) st.steps[s] = { at: `${period === '2026-07' ? '2026-08' : '2026-09'}-06T10:00:00Z`, by: s === 'dq' ? 'u7' : s === 'approve' ? 'u4' : 'u8' };
    closePeriod(period, 'u4');
    st.snapshot!.at = `${period === '2026-07' ? '2026-08' : '2026-09'}-06T12:00:00Z`;
  }
  db.periods['2026-09']!.steps.load = { at: '2026-10-05T09:00:00Z', by: 'u12' };
}
void bootstrap();

// ---------------------------------------------------------------------------------------------
// Публичный API

const findObj = (key: string) => {
  const o = currentObjects().find((x) => x.key === key);
  if (!o) throw new Error('ndo_err_object');
  return o;
};

export interface NdoObjectInput {
  type: NdoObjectType;
  code: string;
  name: Localized;
  status: NdoObject['status'];
  parentKey?: string;
  orgUnitKey: string;
  costCenterCode: string;
  respCenter: string;
  normative?: number;
  routeKm?: number;
  validFrom: string;
  changeReason?: string;
}

export const ndoApi = {
  periods: NDO_PERIODS,
  closeSteps: NDO_CLOSE_STEPS,
  can: ndoCan,

  // --- объекты ---
  listObjects: (asOf?: string) => delay(asOf ? objectsAt(asOf) : currentObjects()),
  objectVersions: (key: string) => delay(db.objects.filter((o) => o.key === key).sort((a, b) => b.version - a.version)),
  async saveObject(key: string | null, input: NdoObjectInput, user: User): Promise<NdoObject> {
    assertFn(user, 'input');
    if (!input.code.trim() || !input.name.ru.trim() || !input.orgUnitKey || !input.costCenterCode) throw new Error('ndo_err_required');
    const ccs = await orgApi.listCostCenters({ pageSize: 100_000 });
    if (!ccs.rows.some((c) => c.code === input.costCenterCode)) throw new Error('ndo_err_mvz');
    if (!key && currentObjects().some((o) => o.code === input.code.trim())) throw new Error('ndo_err_duplicate');
    let obj: NdoObject;
    if (key) {
      const cur = findObj(key);
      if (input.validFrom <= cur.validFrom) throw new Error('ndo_err_valid_from');
      cur.validTo = new Date(Date.parse(input.validFrom) - 86_400_000).toISOString().slice(0, 10);
      obj = { ...cur, ...input, code: input.code.trim(), key, version: cur.version + 1, validFrom: input.validFrom, changedBy: user.id };
      delete obj.validTo;
      audit.log({ action: 'update', entity: 'ndo_object', entityId: key, details: `v${obj.version} с ${obj.validFrom}: ${input.changeReason ?? ''}` });
    } else {
      obj = { ...input, code: input.code.trim(), key: `NDO-${input.type.toUpperCase().slice(0, 3)}-${String(db.objects.length + 1).padStart(2, '0')}`, version: 1, changedBy: user.id };
      audit.log({ action: 'create', entity: 'ndo_object', entityId: obj.key, details: obj.code });
    }
    db.objects.push(obj);
    emit();
    return delay(obj);
  },

  // --- классификаторы ---
  listClasses: (kind?: NdoClassItem['kind']) => delay(db.classes.filter((c) => (!kind || c.kind === kind) && !c.validTo)),
  async saveClass(input: Pick<NdoClassItem, 'kind' | 'code' | 'name' | 'direction' | 'nature' | 'external' | 'unit'> & { validFrom: string }, user: User) {
    assertFn(user, 'calc');
    if (!input.code.trim() || !input.name.ru.trim()) throw new Error('ndo_err_required');
    const cur = db.classes.find((c) => c.kind === input.kind && c.code === input.code && !c.validTo);
    if (cur) cur.validTo = new Date(Date.parse(input.validFrom) - 86_400_000).toISOString().slice(0, 10);
    const item: NdoClassItem = { ...input, version: (cur?.version ?? 0) + 1 };
    db.classes.push(item);
    audit.log({ action: cur ? 'update' : 'create', entity: 'ndo_class', entityId: `${input.kind}:${input.code}`, details: `v${item.version}` });
    emit();
    await delay(null);
  },

  // --- данные ---
  listDatasets: () => delay(db.datasets),
  listLoads: (period?: string) => delay(db.loads.filter((l) => !period || l.period === period)),
  async loadDataset(datasetId: string, period: string, user: User): Promise<NdoLoad> {
    assertFn(user, 'input');
    assertOpen(period);
    const ds = db.datasets.find((d) => d.id === datasetId);
    if (!ds) throw apiError('NOT_FOUND');
    let load: NdoLoad;
    if (!ds.integration) load = await loadErp(datasetId, period, user.id);
    else {
      const expected = sourceOf(datasetId, period);
      const r = await integrationHub.call(ds.integration.systemId, ds.integration.operation, { dataset: datasetId, period, expected: expected.controlSum }, { userId: user.id, idempotencyKey: `ndo-${datasetId}-${period}-${Date.now()}` });
      if (r.status !== 'success') {
        load = { id: nextId('ndl'), datasetId, period, at: now(), by: user.id, exchangeId: r.id, status: r.status === 'queued' ? 'queued' : 'failed', rows: 0, inserted: 0, updated: 0, duplicates: 0, rejected: 0, controlSource: expected.controlSum, controlLoaded: 0, hash: '' };
        db.loads.unshift(load);
      } else load = applyLoad(datasetId, period, user.id, r.id, (r.response as { rows: number; controlSum: number }) ?? expected);
    }
    audit.log({ action: 'create', entity: 'ndo_load', entityId: load.id, result: load.status === 'success' ? 'success' : 'failure', details: `${datasetId} ${period}: +${load.inserted} ~${load.updated} =${load.duplicates} ✖${load.rejected}` });
    if (load.rejected) notify({ roles: [datasetId === 'DS-SD' ? 'support' : 'treasury', 'cash_operator'], title: L(`НДО: ошибочные записи в ${datasetId} за ${period}`, `NPA: ${datasetId} da ${period} uchun xato yozuvlar`, `Cash: error records in ${datasetId} for ${period}`), body: L(`Отклонено записей: ${load.rejected}. Требуется исправление.`, `Rad etilgan yozuvlar: ${load.rejected}. Tuzatish kerak.`, `Rejected records: ${load.rejected}. Fix required.`), link: '/cash/ndo?tab=data', level: 'warning', kind: 'system' });
    emit();
    return delay(load);
  },
  listErrors: (period?: string) => delay(db.errors.filter((e) => !period || e.period === period)),
  /** Исправление: код источника сопоставляется с объектом реестра; затем повторная загрузка без дублей. */
  async fixError(id: ID, objectKey: string, user: User) {
    assertFn(user, 'input');
    const e = db.errors.find((x) => x.id === id);
    if (!e || e.status !== 'open') throw apiError('NOT_FOUND');
    findObj(objectKey);
    db.codeMap[e.sourceCode] = objectKey;
    for (const x of db.errors.filter((y) => y.sourceCode === e.sourceCode && y.status === 'open')) Object.assign(x, { status: 'fixed', fixedObjectKey: objectKey, fixedBy: user.id });
    audit.log({ action: 'update', entity: 'ndo_error', entityId: id, details: `${e.sourceCode} → ${objectKey}` });
    emit();
    await delay(null);
  },
  listFacts: (period: string, filter: { objectKey?: string; article?: string } = {}) => delay(db.facts.filter((f) => f.period === period && (!filter.objectKey || f.objectKey === filter.objectKey) && (!filter.article || f.article === filter.article))),
  listVolumes: (period: string) => delay(db.volumes.filter((v) => v.period === period)),

  // --- корректировки (отдельный слой, разделение ввода и утверждения) ---
  listAdjustments: (period?: string) => delay(db.adjustments.filter((a) => !period || a.period === period)),
  async addAdjustment(input: Pick<NdoAdjustment, 'period' | 'article' | 'objectKey' | 'amount' | 'reason'>, user: User) {
    assertFn(user, 'input');
    assertOpen(input.period);
    if (!input.reason.trim() || !Number.isFinite(input.amount) || !input.amount) throw new Error('ndo_err_required');
    const a: NdoAdjustment = { ...input, id: nextId('nda'), reason: input.reason.trim(), createdBy: user.id, at: now(), status: 'draft' };
    db.adjustments.push(a);
    audit.log({ action: 'create', entity: 'ndo_adjustment', entityId: a.id, details: `${a.article} ${a.amount}: ${a.reason}` });
    emit();
    return delay(a);
  },
  async decideAdjustment(id: ID, approve: boolean, user: User) {
    assertFn(user, 'check');
    const a = db.adjustments.find((x) => x.id === id);
    if (!a || a.status !== 'draft') throw apiError('NOT_FOUND');
    assertOpen(a.period);
    if (a.createdBy === user.id) throw new Error('ndo_err_sod');
    a.status = approve ? 'approved' : 'rejected';
    a.approvedBy = user.id;
    audit.log({ action: approve ? 'approve' : 'reject', entity: 'ndo_adjustment', entityId: id });
    emit();
    await delay(null);
  },

  // --- бюджет ---
  listBudget: (period: string, scenario: NdoScenarioKind = 'base') => delay(budgetFor(period, scenario)),
  /** Скользящий прогноз: факт закрытых/загруженных месяцев + план оставшихся с поправкой на исполнение. */
  rollingForecast(scenario: NdoScenarioKind = 'base') {
    const months = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
    const exp = (p: string) => budgetFor(p, scenario).filter((b) => !b.article.startsWith('INC')).reduce((s, b) => s + b.amount, 0);
    const inc = (p: string) => budgetFor(p, scenario).filter((b) => b.article.startsWith('INC')).reduce((s, b) => s + b.amount, 0);
    const actualCost = (p: string) => ndoResults(p).totals.total;
    const actualInc = (p: string) => ndoResults(p).totals.income;
    const done = ['2026-07', '2026-08', '2026-09'];
    const ratio = done.reduce((s, p) => s + actualCost(p), 0) / Math.max(1, done.reduce((s, p) => s + exp(p), 0));
    return delay(months.map((p) => ({ period: p, planCost: exp(p), planIncome: inc(p), actualCost: done.includes(p) ? actualCost(p) : undefined, actualIncome: done.includes(p) ? actualInc(p) : undefined, forecastCost: done.includes(p) ? actualCost(p) : Math.round(exp(p) * ratio), forecastIncome: done.includes(p) ? actualInc(p) : inc(p) })));
  },
  factors: (period: string, scenario: NdoScenarioKind = 'base') => delay(factorAnalysis(period, scenario)),
  async updateBudgetLine(id: ID, patch: { amount?: number; driverVolume?: number; rate?: number; justification?: string }, user: User) {
    assertFn(user, 'calc');
    const b = db.budget.find((x) => x.id === id);
    if (!b) throw apiError('NOT_FOUND');
    if (db.periods[b.period]?.status === 'closed') throw new Error('ndo_err_closed');
    if (patch.driverVolume !== undefined || patch.rate !== undefined) {
      b.driverVolume = patch.driverVolume ?? b.driverVolume;
      b.rate = patch.rate ?? b.rate;
      b.amount = Math.round((b.driverVolume ?? 0) * (b.rate ?? 0));
    } else if (patch.amount !== undefined) b.amount = Math.round(patch.amount);
    if (patch.justification !== undefined) b.justification = patch.justification;
    audit.log({ action: 'update', entity: 'ndo_budget', entityId: id, details: JSON.stringify(patch) });
    emit();
    await delay(null);
  },
  /** Консолидация бюджета до уровня Банка: по статьям / МВЗ / процессам. */
  budgetConsolidated(period: string, scenario: NdoScenarioKind = 'base', by: 'article' | 'costCenterCode' | 'process' | 'objectKey' = 'article') {
    const m = new Map<string, number>();
    for (const b of budgetFor(period, scenario)) m.set(b[by], (m.get(b[by]) ?? 0) + (b.article.startsWith('INC') ? -b.amount : b.amount));
    return delay([...m.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => b.amount - a.amount));
  },

  // --- остатки, деньги в пути, фондирование ---
  balancesOn: (date: string) => delay(db.balances.filter((b) => b.date === date)),
  balanceDates: (period: string) => delay([...new Set(db.balances.filter((b) => b.date.startsWith(period)).map((b) => b.date))].sort()),
  transit: () => delay(transitItems()),
  funding: (period: string) => delay(ndoResults(period).funding),
  ftpRates: (period: string) => delay(db.ftp[period]),
  listScenarios: () => delay(db.scenarios),
  async addScenario(input: Omit<NdoScenario, 'id' | 'createdBy' | 'at'>, user: User) {
    assertFn(user, 'calc');
    if (!input.name.trim()) throw new Error('ndo_err_required');
    const s: NdoScenario = { ...input, id: nextId('nds'), createdBy: user.id, at: now() };
    db.scenarios.push(s);
    audit.log({ action: 'create', entity: 'ndo_scenario', entityId: s.id, details: JSON.stringify(input) });
    emit();
    return delay(s);
  },
  /** Сценарная оценка стоимости фондирования без изменения фактических данных и закрытых периодов (BR-NDO-13). */
  async scenarioFunding(period: string, scn: Pick<NdoScenario, 'balancePct' | 'storageDays' | 'fxPct' | 'ftpBp'>) {
    const curves = await ftpApi.listCurves();
    const curveRate = (c: CashCurrency, days: number) => {
      const curve = curves.find((x) => x.currency === (c === 'UZS' ? 'UZS' : 'USD'));
      const base = curve ? ftpInterpolate(curve, Math.max(1, days / 30)) : 0;
      return Math.round((base + (c === 'EUR' ? 0.5 : c === 'RUB' ? 3 : 0)) * 100) / 100;
    };
    const ctx = db.periods[period]?.status === 'closed' ? (clone(db.periods[period]!.snapshot!.frozen) as Ctx) : liveCtx(period);
    const base = fundingRows(ctx);
    const sc = fundingRows(ctx, scn, curveRate);
    const sum = (rs: NdoFundingRow[], k: keyof NdoFundingRow) => rs.reduce((s, r) => s + (r[k] as number), 0);
    return delay({ base: { cost: sum(base, 'cost'), excess: sum(base, 'costExcess'), avg: sum(base, 'avgUzs') }, scenario: { cost: sum(sc, 'cost'), excess: sum(sc, 'costExcess'), avg: sum(sc, 'avgUzs') }, rows: sc });
  },

  // --- аллокация ---
  listRules: () => delay(db.rules),
  ruleHistory: (id: ID) => delay(db.ruleHistory[id] ?? []),
  async saveRule(input: Pick<NdoRule, 'code' | 'name' | 'step' | 'pool' | 'receiverTypes' | 'driver' | 'formula' | 'validFrom'>, user: User): Promise<NdoRule> {
    assertFn(user, 'calc');
    if (!input.code.trim() || !input.name.ru.trim() || !input.receiverTypes.length) throw new Error('ndo_err_required');
    const prev = db.rules.filter((r) => r.code === input.code).sort((a, b) => b.version - a.version)[0];
    const rule: NdoRule = { ...input, id: nextId('nr'), status: 'draft', version: (prev?.version ?? 0) + 1, createdBy: user.id };
    db.rules.push(rule);
    audit.log({ action: 'create', entity: 'ndo_rule', entityId: rule.id, details: `${rule.code} v${rule.version}` });
    emit();
    return delay(rule);
  },
  /** Отправка правила на согласование (маршрут cash_rule). */
  async submitRule(id: ID, user: User) {
    assertFn(user, 'calc');
    const r = db.rules.find((x) => x.id === id);
    if (!r || (r.status !== 'draft' && r.status !== 'rejected')) throw new Error('ndo_err_state');
    r.status = 'pending';
    approvalEngine.open({ entity: 'cash_rule', entityId: r.id, number: `${r.code}-v${r.version}`, title: `НДО: ${r.name.ru}`, requesterId: user.id, context: { subtype: r.step } });
    audit.log({ action: 'submit', entity: 'ndo_rule', entityId: r.id });
    emit();
    await delay(null);
  },
  allocation: (period: string) => delay(ndoResults(period)),

  // --- результаты ---
  results: (period: string) => delay(ndoResults(period)),
  /** Детализация до источника: факты, загрузка, правило/драйвер, ставка FTP и курс, версия методики (BR-NDO-22). */
  drill(period: string, objectKey: string) {
    const r = ndoResults(period);
    const facts = (db.periods[period]?.snapshot ? ((db.periods[period]!.snapshot!.frozen as Ctx).facts) : db.facts.filter((f) => f.period === period)).filter((f) => f.objectKey === objectKey);
    return delay({
      object: currentObjects().find((o) => o.key === objectKey),
      result: r.objects.find((o) => o.key === objectKey),
      facts: facts.map((f) => ({ ...f, load: db.loads.find((l) => l.id === f.loadId) })),
      allocation: r.allocation.filter((a) => a.receiver === objectKey).map((a) => ({ ...a, rule: db.rules.find((x) => x.id === a.ruleId) })),
      funding: r.funding.filter((f) => f.objectKey === objectKey),
      methodology: r.methodology,
      hash: r.hash,
    });
  },
  /** Экономика устройств самообслуживания и сравнение OptiLoad с фактом (BR-NDO-19). */
  devices(period: string) {
    const r = ndoResults(period);
    return delay(currentObjects().filter((o) => DEVICE_TYPES.includes(o.type)).map((o) => {
      const res = r.objects.find((x) => x.key === o.key);
      const fs = db.facts.filter((f) => f.period === period && f.objectKey === o.key);
      const vol = (d: NdoVolume['driver']) => db.volumes.filter((v) => v.period === period && v.objectKey === o.key && v.driver === d).reduce((s, v) => s + v.value, 0);
      const opt = db.opti.filter((x) => x.period === period && x.objectKey === o.key);
      const fund = r.funding.filter((f) => f.objectKey === o.key);
      return {
        key: o.key, code: o.code, type: o.type, name: o.name,
        income: res?.income ?? 0, avgBalance: fund.reduce((s, f) => s + f.avgUzs, 0), funding: res?.funding ?? 0,
        service: res?.ndoAlloc ?? 0, comms: fs.filter((f) => f.article === 'EXP-COMM').reduce((s, f) => s + f.amount, 0), repair: fs.filter((f) => f.article === 'EXP-REP').reduce((s, f) => s + f.amount, 0),
        transactions: vol('transactions'), collections: vol('collections'), loads: opt.length, downtime: vol('downtime_h'), incidents: vol('incidents'),
        total: res?.total ?? 0, result: res?.result ?? 0,
        opti: { recs: opt.length, followed: opt.filter((x) => x.followed).length, cashOutHours: opt.reduce((s, x) => s + x.cashOutHours, 0), excess: opt.reduce((s, x) => s + x.excessAfter, 0), items: opt },
      };
    }));
  },
  /** Тарифная модель: себестоимость единицы + FTP + маржа − льготы + налоги (BR-NDO-20). */
  tariffs(period: string): Promise<NdoTariffCalc[]> {
    const r = ndoResults(period);
    const p = db.params;
    const types = (t: NdoObjectType[]) => currentObjects().filter((o) => t.includes(o.type)).map((o) => o.key);
    const sumOf = (keys: string[], k: keyof NdoObjectResult) => r.objects.filter((o) => keys.includes(o.key)).reduce((s, o) => s + (o[k] as number), 0);
    return delay(db.tariffs.map((t) => {
      let cost = 0;
      let ftp = 0;
      let volume = 0;
      if (t.driver === 'collections') {
        const pool = r.pools.find((x) => x.pool === 'POOL-CIT')?.amount ?? 0;
        cost = pool;
        volume = db.volumes.filter((v) => v.period === period && v.driver === 'collections').reduce((s, v) => s + v.value, 0);
      } else if (t.driver === 'volume') {
        const keys = types(['cbu', 'cash_desk', 'mobile_desk', 'exchange']);
        cost = r.pools.find((x) => x.pool === 'POOL-EKC')?.amount ?? 0;
        volume = sumOf(keys, 'volume') / M;
        ftp = 0;
      } else {
        const keys = types(DEVICE_TYPES);
        cost = sumOf(keys, 'total') - sumOf(keys, 'funding');
        ftp = sumOf(keys, 'funding');
        volume = sumOf(keys, 'transactions');
      }
      const unitCost = volume ? cost / volume : 0;
      const unitFtp = volume ? ftp / volume : 0;
      const base = (unitCost + unitFtp) / (1 - p.targetMargin / 100);
      const afterBenefit = base * (1 - t.benefitPct / 100);
      const tax = t.vatApplies ? (afterBenefit * p.vatRate) / 100 : 0;
      const recommended = Math.round(afterBenefit + tax);
      return { ...t, unitCost: Math.round(unitCost), unitFtp: Math.round(unitFtp), margin: Math.round(base - unitCost - unitFtp), tax: Math.round(tax), recommended, gapPct: recommended ? Math.round(((t.currentTariff - recommended) / recommended) * 1000) / 10 : 0, plannedIncome: Math.round(t.currentTariff * t.plannedVolume) };
    }));
  },
  async updateTariff(code: string, patch: { currentTariff?: number; plannedVolume?: number; benefitPct?: number }, user: User) {
    assertFn(user, 'calc');
    const t = db.tariffs.find((x) => x.code === code);
    if (!t) throw apiError('NOT_FOUND');
    Object.assign(t, patch);
    audit.log({ action: 'update', entity: 'ndo_tariff', entityId: code, details: JSON.stringify(patch) });
    emit();
    await delay(null);
  },

  // --- пороговые оповещения (BR-NDO-22) ---
  alerts(period: string) {
    const r = ndoResults(period);
    const out: { key: string; kind: 'excess' | 'cost'; value: number; threshold: number }[] = [];
    const byObj = new Map<string, { avg: number; excess: number }>();
    for (const f of r.funding) {
      const x = byObj.get(f.objectKey) ?? { avg: 0, excess: 0 };
      x.avg += f.avgUzs;
      x.excess += f.excess;
      byObj.set(f.objectKey, x);
    }
    for (const [key, x] of byObj) {
      const pct = x.avg ? Math.round((x.excess / x.avg) * 1000) / 10 : 0;
      if (pct > db.params.excessThresholdPct) out.push({ key, kind: 'excess', value: pct, threshold: db.params.excessThresholdPct });
    }
    for (const o of r.objects) if (o.costPerMln > db.params.costPerMlnThreshold && o.volume) out.push({ key: o.key, kind: 'cost', value: o.costPerMln, threshold: db.params.costPerMlnThreshold });
    return delay(out);
  },
  async notifyAlerts(period: string, user: User) {
    const alerts = await ndoApi.alerts(period);
    let n = 0;
    for (const a of alerts) n += notify({ roles: ['treasury', 'finance'], excludeIds: [user.id], title: a.kind === 'excess' ? L(`НДО: избыточный остаток ${a.key} — ${a.value}%`, `NPA: ortiqcha qoldiq ${a.key} — ${a.value}%`, `Cash: excess balance ${a.key} — ${a.value}%`) : L(`НДО: себестоимость 1 млн ${a.key} — ${a.value}`, `NPA: 1 mln tannarxi ${a.key} — ${a.value}`, `Cash: cost per 1 mln ${a.key} — ${a.value}`), link: '/cash/ndo?tab=dashboard', level: 'warning', kind: 'system', dedupeKey: `ndo-alert-${period}-${a.key}-${a.kind}` }).length;
    return n;
  },

  // --- качество и закрытие ---
  dq: (period: string) => dqChecks(period).then((x) => delay(x)),
  periodState: (period: string) => delay(db.periods[period] ?? { period, steps: {}, status: 'open' as const }),
  listPeriodStates: () => delay(NDO_PERIODS.map((p) => db.periods[p] ?? { period: p, steps: {}, status: 'open' as const })),
  /** Шаг закрытия периода в утверждённой последовательности с разделением функций. */
  async runStep(period: string, step: NdoCloseStep, user: User) {
    assertOpen(period);
    const st = (db.periods[period] ??= { period, steps: {}, status: 'open' });
    const i = NDO_CLOSE_STEPS.indexOf(step);
    if (i < 0 || step === 'closed') throw new Error('ndo_err_state');
    for (const prev of NDO_CLOSE_STEPS.slice(0, i)) if (!st.steps[prev]) throw new Error('ndo_err_sequence');
    if (st.steps[step]) throw new Error('ndo_err_state');
    const fn: Fn = step === 'load' ? 'input' : step === 'dq' ? 'check' : 'calc';
    assertFn(user, fn);
    if (step === 'load') {
      const missing = db.datasets.filter((d) => d.mandatory && db.loads.find((l) => l.datasetId === d.id && l.period === period)?.status !== 'success');
      if (missing.length) throw new Error('ndo_err_incomplete');
    }
    if (step === 'dq') {
      const checks = await dqChecks(period);
      if (checks.some((c) => !c.ok && c.severity === 'blocker')) throw new Error('ndo_err_dq');
    }
    if (['direct', 'funding', 'allocation', 'cost'].includes(step)) {
      if (st.steps.dq?.by === user.id) throw new Error('ndo_err_sod');
      st.calcBy = user.id;
    }
    if (step === 'approve') {
      if (st.calcBy !== user.id && !ndoCan(user, 'calc')) throw new Error('ndo_err_role');
      const r = compute(liveCtx(period));
      st.status = 'pending_approval';
      st.steps.approve = { at: now(), by: user.id };
      approvalEngine.open({ entity: 'cash_close', entityId: period, number: `NDO-CLOSE-${period}`, title: `Закрытие периода НДО ${period}`, requesterId: user.id, amount: r.totals.total, context: { subtype: 'ndo_close' } });
      audit.log({ action: 'submit', entity: 'ndo_period', entityId: period, details: `Отправлено на утверждение, хэш ${r.hash}` });
      emit();
      return delay(null);
    }
    st.steps[step] = { at: now(), by: user.id };
    audit.log({ action: 'update', entity: 'ndo_period', entityId: period, details: `Шаг ${step}` });
    emit();
    return delay(null);
  },
  /** Пересчёт закрытого периода: результат воспроизводится в точности из снимка независимо от последующих изменений. */
  async verifyClosed(period: string) {
    const st = db.periods[period];
    if (!st?.snapshot) throw new Error('ndo_err_state');
    const again = compute(clone(st.snapshot.frozen) as Ctx);
    const current = compute(liveCtx(period));
    return delay({ stored: st.snapshot.hash, recomputed: again.hash, identical: again.hash === st.snapshot.hash, withCurrentSettings: current.hash, differsWithCurrent: current.hash !== st.snapshot.hash, versions: st.snapshot.versions, currentVersions: versionsNow(period) });
  },

  // --- параметры и роли (без изменения кода) ---
  params: () => delay(db.params),
  async updateParams(patch: Partial<NdoParams>, user: User) {
    if (user.role !== 'admin' && !ndoCan(user, 'calc')) throw new Error('ndo_err_role');
    if (patch.roles && user.role !== 'admin') throw new Error('ndo_err_role');
    audit.log({ action: 'settings', entity: 'ndo_params', changes: Object.entries(patch).map(([k, v]) => ({ field: k, from: JSON.stringify((db.params as unknown as Record<string, unknown>)[k]), to: JSON.stringify(v) })) });
    Object.assign(db.params, patch);
    emit();
    await delay(null);
  },

  // --- передача в BI / AI (DWH) ---
  async publishBi(period: string, user: User) {
    assertFn(user, 'calc');
    const r = ndoResults(period);
    const rec = await integrationHub.call('dwh', 'mart.publish', { mart: `ndo_pnl_${period}`, rows: r.objects.length, controlSum: r.totals.total }, { userId: user.id });
    db.bi.unshift({ at: now(), period, exchangeId: rec.id, rows: r.objects.length, controlSum: r.totals.total, status: rec.status });
    audit.log({ action: 'export', entity: 'ndo_bi', entityId: period, details: `${rec.id} ${rec.status}` });
    emit();
    return delay(rec.status);
  },
  listBi: () => delay(db.bi),
};

/** Тексты ошибок API НДО. */
export const NDO_ERRORS: Record<string, Localized> = {
  ndo_err_role: L('Действие недоступно вашей роли (разделение функций НДО)', 'Amal rolingiz uchun mavjud emas (NPA funksiyalarini ajratish)', 'Not available for your role (cash segregation of duties)'),
  ndo_err_closed: L('Период закрыт: данные и результаты защищены от изменений', "Davr yopilgan: ma'lumotlar va natijalar himoyalangan", 'Period closed: data and results are protected'),
  ndo_err_pending: L('Период на утверждении — изменения недоступны', 'Davr tasdiqlashda — o‘zgartirib bo‘lmaydi', 'Period pending approval — changes are locked'),
  ndo_err_required: L('Заполните обязательные поля', "Majburiy maydonlarni to'ldiring", 'Fill in the required fields'),
  ndo_err_mvz: L('МВЗ не найден в справочнике оргструктуры', 'XJM tashkiliy tuzilma ma’lumotnomasida topilmadi', 'Cost centre not found in the org structure'),
  ndo_err_duplicate: L('Объект с таким кодом уже есть', 'Bunday kodli obyekt mavjud', 'An object with this code exists'),
  ndo_err_valid_from: L('Дата новой версии должна быть позже текущей', "Yangi versiya sanasi joriydan keyin bo'lishi kerak", 'The new version date must be after the current one'),
  ndo_err_object: L('Объект не найден', 'Obyekt topilmadi', 'Object not found'),
  ndo_err_sod: L('Разделение функций: этот шаг должен выполнить другой сотрудник', "Funksiyalarni ajratish: bu bosqichni boshqa xodim bajarishi kerak", 'Segregation of duties: another employee must perform this step'),
  ndo_err_state: L('Действие недоступно в текущем состоянии', 'Joriy holatda amal mavjud emas', 'Action not available in the current state'),
  ndo_err_sequence: L('Нарушена последовательность закрытия: выполните предыдущие шаги', "Yopish ketma-ketligi buzildi: oldingi bosqichlarni bajaring", 'Close sequence violated: complete the previous steps'),
  ndo_err_incomplete: L('Не все обязательные наборы данных загружены без расхождений', "Barcha majburiy to'plamlar farqsiz yuklanmagan", 'Not all mandatory datasets are loaded without discrepancies'),
  ndo_err_dq: L('Есть блокирующие замечания качества данных — закрытие невозможно', "Ma'lumotlar sifati bo'yicha blokirovka qiluvchi kamchiliklar bor — yopib bo'lmaydi", 'Blocking data quality issues — close is not possible'),
};
