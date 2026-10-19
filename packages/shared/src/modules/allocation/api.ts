// API модуля «Аллокация» (ТЗ 4.2.14).
// Методы распределения косвенных затрат:
//  • прямой (direct): пул → бизнес-центры пропорционально драйверу пула;
//  • каскадный (step-down): центры по цепочке распределяют свои и полученные затраты на центры ниже по цепочке и бизнес-центры;
//  • взаимный (reciprocal): учёт взаимных услуг обслуживающих центров — решение системы (I − A)·T = D методом Гаусса
//    (матричный метод), для контроля — итерации Якоби до погрешности < 1 сум.
// Целочисленное деление сумм — методом наибольших остатков (копейки не теряются).
import { clone, delay, emit, nextId, nextNumber, now } from '../../bus';
import { localize, tk, translate } from '../../i18n';
import { matches, registerSearchProvider } from '../../search';
import { audit, diffFields } from '../../audit';
import { can } from '../../security';
import { importRegistry, type ImportIssue, type ImportValue } from '../../services/importer';
import type { ID, Role, User } from '../../types';
import { FL, finplanEnsureOp, integrationHub } from '../budgeting/integrationOps';
import { assetsApi } from '../assets';
import { ftpApi } from '../ftp';
import {
  allocationDriverDefs,
  allocationMapping,
  allocationPeriods,
  allocationPoolAmounts,
  allocationPools,
  allocationRules,
  allocationScenarios,
  allocationSeedRuns,
  allocationServiceCenters,
  allocationServiceDrivers,
  allocationSettings,
  allocationUnits,
} from './data';
import type {
  AllocationCenter,
  AllocationCostingFeed,
  AllocationDriver,
  AllocationDriverDef,
  AllocationDriverLog,
  AllocationFlow,
  AllocationGlCategory,
  AllocationGlEntry,
  AllocationGlLoad,
  AllocationMapping,
  AllocationMethod,
  AllocationOverview,
  AllocationPoolCategory,
  AllocationResultCell,
  AllocationRun,
  AllocationScenario,
  AllocationSnapshot,
  AllocationUnitTotal,
  AllocationWhatIf,
} from './types';
import { apiError } from '../../errors';

type Values = Record<string, Record<ID, Record<AllocationDriver, number>>>; // period → center → driver → value

const db = {
  pools: clone(allocationPools),
  units: clone(allocationUnits),
  services: clone(allocationServiceCenters),
  rules: clone(allocationRules),
  amounts: clone(allocationPoolAmounts),
  drivers: clone(allocationDriverDefs),
  settings: clone(allocationSettings),
  mapping: clone(allocationMapping),
  scenarios: clone(allocationScenarios),
  values: {} as Values,
  meta: {} as Record<string, Record<ID, Record<AllocationDriver, { source: 'auto' | 'manual'; at: string; by: ID | 'system'; reason?: string }>>>,
  log: [] as AllocationDriverLog[],
  runs: [] as AllocationRun[],
  gl: [] as AllocationGlEntry[],
  glLoads: [] as AllocationGlLoad[],
  snapshots: [] as AllocationSnapshot[],
  /** Арендуемая площадь центров (не в ОС банка), м². */
  leased: {} as Record<ID, number>,
};

// Значения драйверов: бизнес-центры (из данных направлений) и обслуживающие центры.
for (const p of allocationPeriods) {
  db.values[p] = {};
  for (const u of db.units) db.values[p]![u.id] = { ...u.drivers[p]! };
  for (const [c, v] of Object.entries(allocationServiceDrivers[p] ?? {})) db.values[p]![c] = { ...v };
}

/** Целочисленное распределение суммы по весам без потери копеек (метод наибольших остатков). */
export function allocationSplit(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const base = raw.map(Math.floor);
  let rest = amount - base.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (rest <= 0) break;
    base[o.i]! += 1;
    rest -= 1;
  }
  return base;
}

// ---------- Формулы драйверов (No-code, PR-ALC-018) ----------

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+(?:[.,]\d+)?)|([a-z_][a-z0-9_]*)|([-+*/()]))/giy;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new Error(`allocation_err_formula_syntax:${src.slice(pos, pos + 8)}`);
    }
    if (m[1]) out.push({ t: 'num', v: Number(m[1].replace(',', '.')) });
    else if (m[2]) out.push({ t: 'id', v: m[2].toLowerCase() });
    else if (m[3]) out.push({ t: 'op', v: m[3] });
    pos = re.lastIndex;
  }
  return out;
}

/** Разобрать и вычислить формулу: + − × ÷, скобки, числа, коды драйверов. Без eval. */
export function allocationEvalFormula(src: string, value: (id: string) => number): number {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const expr = (): number => {
    let v = term();
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) v = toks[i++]!.v === '+' ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = toks[i++]!.v;
      const r = factor();
      v = op === '*' ? v * r : r === 0 ? 0 : v / r;
    }
    return v;
  };
  const factor = (): number => {
    const tk = toks[i++];
    if (!tk) throw new Error('allocation_err_formula_syntax:end');
    if (tk.t === 'num') return tk.v;
    if (tk.t === 'id') return value(tk.v);
    if (tk.v === '-') return -factor();
    if (tk.v === '(') {
      const v = expr();
      if (toks[i++]?.v !== ')') throw new Error('allocation_err_formula_syntax:)');
      return v;
    }
    throw new Error(`allocation_err_formula_syntax:${tk.v}`);
  };
  const v = expr();
  if (i < toks.length) throw new Error(`allocation_err_formula_syntax:${String(toks[i]!.v)}`);
  return v;
}

function formulaRefs(src: string): string[] {
  return [...new Set(tokenize(src).filter((t) => t.t === 'id').map((t) => String(t.v)))];
}

function validateFormula(src: string, selfId?: string) {
  if (!src.trim()) throw new Error('allocation_err_formula_empty');
  const refs = formulaRefs(src);
  if (!refs.length) throw new Error('allocation_err_formula_refs');
  for (const r of refs) {
    const d = db.drivers.find((x) => x.id === r);
    if (!d) throw new Error(`allocation_err_formula_unknown:${r}`);
    if (d.source === 'formula' || r === selfId) throw new Error(`allocation_err_formula_nested:${r}`);
  }
  allocationEvalFormula(src, () => 1); // синтаксис
}

/** Значение драйвера центра за период (формульные драйверы вычисляются из базовых). */
function driverValue(period: string, centerId: ID, driverId: AllocationDriver, vals: Values = db.values): number {
  const def = db.drivers.find((d) => d.id === driverId);
  if (def?.source === 'formula' && def.formula) {
    return Math.max(0, allocationEvalFormula(def.formula, (id) => vals[period]?.[centerId]?.[id] ?? 0));
  }
  return vals[period]?.[centerId]?.[driverId] ?? 0;
}

// ---------- Расчёт ----------

const allCenters = (): AllocationCenter[] => [...db.services, ...db.units];
const serviceIds = () => db.services.map((s) => s.id);
const unitIds = () => db.units.map((u) => u.id);
function primaryDriver(centerId: ID, rules: { poolId: ID; driver: AllocationDriver }[]): AllocationDriver {
  const pool = db.pools.find((p) => p.centerId === centerId);
  return rules.find((r) => r.poolId === pool?.id)?.driver ?? 'headcount';
}

interface CalcOpts {
  method: AllocationMethod;
  chain: ID[];
  rules: { poolId: ID; driver: AllocationDriver }[];
  amounts: Record<ID, number>;
  values: Values;
}

interface CalcResult {
  cells: AllocationResultCell[];
  flows: AllocationFlow[];
  iterations?: number;
  residual?: number;
}

/** Доли распределения центра-источника по получателям (по значению драйвера получателей). */
function shares(period: string, driver: AllocationDriver, receivers: ID[], vals: Values): number[] {
  const w = receivers.map((r) => driverValue(period, r, driver, vals));
  const tot = w.reduce((s, v) => s + v, 0);
  return w.map((v) => (tot > 0 ? v / tot : 0));
}

/** Решение СЛАУ методом Гаусса с выбором ведущего элемента (матричный метод взаимной аллокации). */
export function allocationSolve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    const d = m[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let k = c; k <= n; k++) m[c]![k]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      if (f) for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row) => row[n]!);
}

function calc(period: string, o: CalcOpts): CalcResult {
  const units = unitIds();
  const flows = new Map<string, number>();
  const addFlow = (from: ID, to: ID, v: number) => v && flows.set(`${from}>${to}`, (flows.get(`${from}>${to}`) ?? 0) + v);
  const cells: AllocationResultCell[] = [];
  let iterations: number | undefined;
  let residual: number | undefined;
  const push = (poolId: ID, finals: number[], driverVals: number[]) => {
    const amount = Math.round(o.amounts[poolId] ?? 0);
    const parts = allocationSplit(amount, finals.map((f) => Math.max(0, f)));
    const tot = finals.reduce((s, v) => s + v, 0);
    units.forEach((u, i) => cells.push({ poolId, unitId: u, amount: parts[i]!, driverValue: driverVals[i]!, sharePct: tot ? Math.round((finals[i]! / tot) * 10000) / 100 : 0 }));
  };
  for (const rule of o.rules) {
    const pool = db.pools.find((p) => p.id === rule.poolId);
    if (!pool) continue;
    const amount = o.amounts[rule.poolId] ?? 0;
    const unitVals = units.map((u) => driverValue(period, u, rule.driver, o.values));
    if (o.method === 'direct' || !amount) {
      push(rule.poolId, unitVals, unitVals);
      continue;
    }
    if (o.method === 'step_down') {
      // Сумма пула «едет» по цепочке: источник → центры ниже по цепочке и бизнес-центры.
      const chain = o.chain.filter((c) => serviceIds().includes(c));
      const holding = new Map<ID, number>([[pool.centerId, amount]]);
      const startIdx = chain.indexOf(pool.centerId);
      const order = startIdx >= 0 ? chain.slice(startIdx) : [pool.centerId, ...chain];
      const finals = units.map(() => 0);
      order.forEach((c, k) => {
        const amt = holding.get(c) ?? 0;
        if (!amt) return;
        const below = order.slice(k + 1).filter((x) => x !== c);
        const receivers = [...below, ...units];
        const drv = c === pool.centerId ? rule.driver : primaryDriver(c, o.rules);
        const sh = shares(period, drv, receivers, o.values);
        receivers.forEach((r, i) => {
          const v = amt * sh[i]!;
          if (units.includes(r)) finals[units.indexOf(r)]! += v;
          else holding.set(r, (holding.get(r) ?? 0) + v);
          addFlow(c, r, v);
        });
        holding.set(c, 0);
      });
      push(rule.poolId, finals, unitVals);
      continue;
    }
    // Взаимный метод: T = d0 + A·T по обслуживающим центрам, бизнес-центры получают d0 + B·T.
    const S = serviceIds();
    const n = S.length;
    const shareOf = (from: ID, drv: AllocationDriver) => {
      const receivers = [...S.filter((x) => x !== from), ...units];
      const sh = shares(period, drv, receivers, o.values);
      return new Map(receivers.map((r, i) => [r, sh[i]!]));
    };
    const first = shareOf(pool.centerId, rule.driver);
    const sec = new Map(S.map((s) => [s, shareOf(s, primaryDriver(s, o.rules))]));
    const d0 = S.map((s) => amount * (first.get(s) ?? 0));
    const A = S.map((i) => S.map((j) => (i === j ? 0 : sec.get(j)!.get(i) ?? 0)));
    const IA = A.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v));
    const Tm = allocationSolve(IA, d0);
    // Контроль: итерации Якоби до сходимости.
    let Tj = S.map(() => 0);
    let it = 0;
    let diff = Infinity;
    while (diff >= 1 && it < 500) {
      const next = S.map((_, i) => d0[i]! + S.reduce((acc, __, j) => acc + A[i]![j]! * Tj[j]!, 0));
      diff = Math.max(...next.map((v, i) => Math.abs(v - Tj[i]!)));
      Tj = next;
      it++;
    }
    iterations = Math.max(iterations ?? 0, it);
    residual = Math.max(residual ?? 0, ...Tm.map((v, i) => Math.abs(v - Tj[i]!)));
    const finals = units.map((u) => amount * (first.get(u) ?? 0) + S.reduce((acc, s, j) => acc + Tm[j]! * (sec.get(s)!.get(u) ?? 0), 0));
    S.forEach((s, j) => {
      if (d0[j]) addFlow(pool.centerId, s, d0[j]!);
      for (const [r, sh] of sec.get(s)!) addFlow(s, r, Tm[j]! * sh);
    });
    for (const u of units) addFlow(pool.centerId, u, amount * (first.get(u) ?? 0));
    void n;
    push(rule.poolId, finals, unitVals);
  }
  return {
    cells,
    flows: [...flows.entries()].map(([k, v]) => ({ from: k.split('>')[0]!, to: k.split('>')[1]!, amount: Math.round(v) })).filter((f) => f.amount > 0 && f.from !== f.to),
    ...(iterations !== undefined ? { iterations, residual: Math.round((residual ?? 0) * 100) / 100 } : {}),
  };
}

const currentRules = () => db.rules.map((r) => ({ poolId: r.poolId, driver: r.driver }));

function makeRun(period: string, userId: ID, createdAt: string, opts: Partial<CalcOpts> = {}): AllocationRun {
  const o: CalcOpts = { method: db.settings.method, chain: [...db.settings.chain], rules: currentRules(), amounts: db.amounts[period] ?? {}, values: db.values, ...opts };
  const r = calc(period, o);
  return { id: nextId('ar'), number: nextNumber('AL'), period, createdAt, userId, method: o.method, chain: o.chain, rules: o.rules, ...r, total: r.cells.reduce((s, c) => s + c.amount, 0) };
}

function snapshotFor(period: string, run: AllocationRun, userId: ID, at: string): AllocationSnapshot {
  const vals: AllocationSnapshot['driverValues'] = {};
  for (const c of allCenters()) vals[c.id] = Object.fromEntries(db.drivers.map((d) => [d.id, driverValue(period, c.id, d.id)]));
  return {
    period, closedAt: at, closedBy: userId, runId: run.id, runNumber: run.number,
    settings: clone(db.settings), rules: clone(db.rules), drivers: clone(db.drivers), centers: clone(allCenters()).map(({ id, code, name, type, kind, departmentId, orgUnitKey, ftpUnitId }) => ({ id, code, name, type, ...(kind ? { kind } : {}), ...(departmentId ? { departmentId } : {}), ...(orgUnitKey ? { orgUnitKey } : {}), ...(ftpUnitId ? { ftpUnitId } : {}) })),
    pools: clone(db.pools), poolAmounts: { ...(db.amounts[period] ?? {}) }, driverValues: vals, mapping: clone(db.mapping), total: run.total,
  };
}

// ---------- Бухгалтерские счета (PR-ALC-004) ----------

const GL_ACCOUNTS: { account: string; category: AllocationGlCategory; share: Record<AllocationPoolCategory, number> }[] = [
  { account: '56010', category: 'payroll', share: { it: 0.42, hr: 0.7, admin: 0.55, premises: 0.18, operations: 0.72, security: 0.66, marketing: 0.3, corporate: 0.35, taxes: 0 } },
  { account: '56710', category: 'depreciation', share: { it: 0.31, hr: 0.04, admin: 0.08, premises: 0.38, operations: 0.08, security: 0.12, marketing: 0.02, corporate: 0.05, taxes: 0 } },
  { account: '56120', category: 'taxes', share: { it: 0.04, hr: 0.08, admin: 0.07, premises: 0.12, operations: 0.06, security: 0.05, marketing: 0.03, corporate: 0.05, taxes: 1 } },
  { account: '56900', category: 'other', share: { it: 0.23, hr: 0.18, admin: 0.3, premises: 0.32, operations: 0.14, security: 0.17, marketing: 0.65, corporate: 0.55, taxes: 0 } },
];
export const ALLOCATION_GL_ACCOUNTS = GL_ACCOUNTS.map((g) => ({ account: g.account, category: g.category }));

/** Сформировать обороты счетов расходов по пулу (сотрудник / подразделение / ЦБУ); сумма = сумме пула. */
function buildGl(period: string): AllocationGlEntry[] {
  const out: AllocationGlEntry[] = [];
  for (const pool of db.pools) {
    const amount = db.amounts[period]?.[pool.id] ?? 0;
    const byAcc = allocationSplit(amount, GL_ACCOUNTS.map((g) => g.share[pool.category]));
    GL_ACCOUNTS.forEach((g, gi) => {
      const sumAcc = byAcc[gi]!;
      if (!sumAcc) return;
      // Операционный центр и охрана имеют расходы в ЦБУ сети, остальные — в подразделении ГО.
      const units = pool.category === 'operations' || pool.category === 'security' || pool.category === 'premises' ? ['R01-B01', 'R09-B01', 'R12-B01', pool.departmentId] : [pool.departmentId];
      const byUnit = allocationSplit(sumAcc, units.map((_, i) => (i === units.length - 1 ? 2 : 1)));
      units.forEach((ou, ui) => {
        if (g.category === 'payroll') {
          const emp = allocationSplit(byUnit[ui]!, [5, 3, 2]);
          emp.forEach((v, ei) => out.push({ id: `${period}-${pool.id}-${g.account}-${ou}-${ei}`, period, account: g.account, category: g.category, poolId: pool.id, departmentId: pool.departmentId, orgUnitKey: ou, employee: `TAB-${pool.id.slice(2)}${ui}${ei + 1}`, amount: v }));
        } else out.push({ id: `${period}-${pool.id}-${g.account}-${ou}`, period, account: g.account, category: g.category, poolId: pool.id, departmentId: pool.departmentId, orgUnitKey: ou, amount: byUnit[ui]! });
      });
    });
  }
  return out;
}

for (const p of allocationPeriods) {
  db.gl.push(...buildGl(p));
  db.glLoads.push({ period: p, at: `${p.slice(0, 4)}-${String(Number(p.slice(6)) * 3 + 1).padStart(2, '0')}-03T06:00:00Z`, userId: 'system', entries: db.gl.filter((g) => g.period === p).length, total: Object.values(db.amounts[p] ?? {}).reduce((s, v) => s + v, 0) });
}

// Исторические расчёты демо-периодов (и закрытие периода со снимком справочников)
for (const s of allocationSeedRuns) {
  const run = makeRun(s.period, s.userId, s.createdAt);
  db.runs.push(run);
  if (s.close) db.snapshots.push(snapshotFor(s.period, run, s.userId, s.close));
}

/** Итоги по бизнес-направлениям из результата расчёта. */
export function allocationUnitTotals(run: Pick<AllocationRun, 'cells' | 'total'>): AllocationUnitTotal[] {
  const map = new Map<ID, number>();
  run.cells.forEach((c) => map.set(c.unitId, (map.get(c.unitId) ?? 0) + c.amount));
  return [...map.entries()].map(([unitId, amount]) => ({ unitId, amount, sharePct: run.total ? Math.round((amount / run.total) * 1000) / 10 : 0 }));
}

/** Роли, которым по умолчанию разрешено менять правила и запускать расчёт (фактическая проверка — can(user, 'allocation', 'edit')). */
export const ALLOCATION_EDIT_ROLES: Role[] = ['finance', 'accountant', 'admin'];

function assertCanEdit(user: User) {
  if (!can(user, 'allocation', 'edit')) throw apiError('FORBIDDEN');
}
const isClosed = (period: string) => db.snapshots.some((s) => s.period === period);
function assertOpen(period: string) {
  if (isClosed(period)) throw new Error('allocation_err_period_closed');
}
const who = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });

// ---------- Интеграции: операции источников драйверов ----------

finplanEnsureOp('laborlaw', { id: 'hr.fte', direction: 'in', schemaVersion: '1.0', name: FL('Численность (FTE) и нормы рабочего времени', 'Xodimlar soni (FTE) va ish vaqti me’yorlari', 'Headcount (FTE) and working-time norms'), sample: () => ({ period: '2026-Q3' }), validate: (p) => (p.period ? null : { code: 'validation', message: 'Missing: period' }), count: (p) => Number(p.rows ?? 0), respond: (p) => ({ accepted: true, period: p.period, rows: p.rows ?? 0, normHours: 168 }) }, 'allocation');
finplanEnsureOp('iabs', { id: 'transactions.stats', direction: 'in', schemaVersion: '1.0', name: FL('Количество транзакций АБС (Okub) по центрам', 'Markazlar bo‘yicha ABT (Okub) tranzaksiyalari soni', 'Core banking (Okub) transactions by centre'), sample: () => ({ period: '2026-Q3' }), validate: (p) => (p.period ? null : { code: 'validation', message: 'Missing: period' }), count: (p) => Number(p.rows ?? 0), respond: (p) => ({ accepted: true, period: p.period, rows: p.rows ?? 0 }) }, 'allocation');
finplanEnsureOp('acms', { id: 'timesheet.aggregate', direction: 'in', schemaVersion: '1.0', name: FL('Табели: часы по продуктам/проектам в разрезе МВЗ', 'Tabellar: MXJ kesimida mahsulot/loyihalar bo‘yicha soatlar', 'Timesheets: hours by product/project per cost centre'), sample: () => ({ period: '2026-Q3' }), validate: (p) => (p.period ? null : { code: 'validation', message: 'Missing: period' }), count: (p) => Number(p.rows ?? 0), respond: (p) => ({ accepted: true, period: p.period, rows: p.rows ?? 0 }) }, 'allocation');

const SOURCE_OP: Partial<Record<AllocationDriverDef['source'], [string, string]>> = { hr: ['laborlaw', 'hr.fte'], abs: ['iabs', 'transactions.stats'], timesheets: ['acms', 'timesheet.aggregate'] };
/** Источники-модули ERP (обновляются отдельными шагами ниже, не через шину). */
const MODULE_SYSTEMS = ['assets', 'ftp'];

/** Детерминированная «дрожь» значения источника (имитация обновления данных в системе-источнике). */
function drift(seed: string, v: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return Math.round(v * (1 + ((Math.abs(h) % 41) - 20) / 1000));
}

function setValue(period: string, centerId: ID, driverId: AllocationDriver, value: number, source: 'auto' | 'manual', by: ID | 'system', reason?: string) {
  const vals = (db.values[period] ??= {});
  const c = (vals[centerId] ??= {});
  const from = c[driverId] ?? 0;
  if (from === value) return false;
  c[driverId] = value;
  ((db.meta[period] ??= {})[centerId] ??= {})[driverId] = { source, at: now(), by, ...(reason ? { reason } : {}) };
  db.log.unshift({ id: nextId('adl'), at: now(), userId: by, period, centerId, driverId, from, to: value, source, ...(reason ? { reason } : {}) });
  return true;
}

// ---------- Импорт значений драйверов (ручная загрузка при сбое интеграции) ----------

importRegistry.register({
  id: 'allocation_driver_values',
  name: FL('Аллокация: значения драйверов', 'Allokatsiya: drayver qiymatlari', 'Allocation: driver values'),
  description: FL('Ручная загрузка значений драйверов по центрам ответственности (при сбое интеграции), с записью в журнал аудита', 'Mas’uliyat markazlari bo‘yicha drayver qiymatlarini qo‘lda yuklash (integratsiya nosozligida), audit jurnaliga yozib', 'Manual load of driver values per responsibility centre (on integration failure), logged to the audit trail'),
  fields: [
    { key: 'period', label: FL('Период', 'Davr', 'Period'), type: 'string', required: true, pattern: '^\\d{4}-Q[1-4]$', patternHint: '2026-Q3', sample: '2026-Q3' },
    { key: 'center', label: FL('Код центра', 'Markaz kodi', 'Centre code'), type: 'string', required: true, sample: 'RET' },
    { key: 'driver', label: FL('Код драйвера', 'Drayver kodi', 'Driver code'), type: 'string', required: true, sample: 'FTE' },
    { key: 'value', label: FL('Значение', 'Qiymat', 'Value'), type: 'number', required: true, min: 0, sample: '3960' },
    { key: 'reason', label: FL('Причина ручного ввода', 'Qo‘lda kiritish sababi', 'Reason for manual entry'), type: 'string', required: true, sample: 'Сбой интеграции с HR' },
  ],
  async extraValidate(rows) {
    return rows.map((r) => {
      const issues: ImportIssue[] = [];
      const c = allCenters().find((x) => x.code === String(r.center ?? ''));
      const d = db.drivers.find((x) => x.code === String(r.driver ?? '') || x.id === String(r.driver ?? ''));
      if (!c) issues.push({ field: 'center', code: 'reference', value: String(r.center ?? ''), severity: 'error' });
      if (!d || d.source === 'formula') issues.push({ field: 'driver', code: 'reference', value: String(r.driver ?? ''), severity: 'error' });
      if (r.period && !allocationPeriods.includes(String(r.period))) issues.push({ field: 'period', code: 'reference', value: String(r.period), severity: 'error' });
      if (r.period && isClosed(String(r.period))) issues.push({ field: 'period', code: 'rule', value: String(r.period), severity: 'error', detail: 'period closed' });
      return issues;
    });
  },
  async commit(rows: Record<string, ImportValue>[], user: User) {
    assertCanEdit(user);
    let updated = 0;
    for (const r of rows) {
      const c = allCenters().find((x) => x.code === String(r.center));
      const d = db.drivers.find((x) => x.code === String(r.driver) || x.id === String(r.driver));
      if (!c || !d || isClosed(String(r.period))) continue;
      if (setValue(String(r.period), c.id, d.id, Number(r.value), 'manual', user.id, String(r.reason ?? 'import'))) {
        updated++;
        audit.log({ action: 'update', entity: 'allocation_driver', entityId: `${r.period}:${c.code}:${d.code}`, details: `import · ${String(r.reason ?? '')}`, user: who(user) });
      }
    }
    emit();
    return { created: 0, updated, skipped: rows.length - updated };
  },
});

// ---------- Глобальный поиск ----------

registerSearchProvider((q, lang) => [
  ...db.runs
    .filter((r) => matches(q, r.number, r.period))
    .map((r) => ({ group: 'allocation_title', title: `${r.number} · ${r.period}`, subtitle: r.createdAt.slice(0, 10), to: `/allocation/runs/${r.id}` })),
  ...db.pools
    .filter((p) => matches(q, p.code, localize(p.name, lang)))
    .map((p) => {
      const d = db.drivers.find((x) => x.id === db.rules.find((r) => r.poolId === p.id)?.driver);
      return { group: 'allocation_title', title: `${p.code} · ${localize(p.name, lang)}`, subtitle: `${translate(lang, 'allocation_driver')}: ${d ? localize(d.name, lang) : translate(lang, tk('allocation_driver_', 'headcount'))}`, to: '/allocation/rules' };
    }),
]);

// ---------- Публичный API ----------

export const allocationApi = {
  get drivers(): AllocationDriver[] {
    return db.drivers.map((d) => d.id);
  },
  periods: allocationPeriods,

  getOverview(): Promise<AllocationOverview> {
    const runs = [...db.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latestPeriod = allocationPeriods[allocationPeriods.length - 1]!;
    return delay({
      periods: allocationPeriods,
      ...(runs[0] ? { lastRun: runs[0] } : {}),
      poolTotalLatest: Object.values(db.amounts[latestPeriod] ?? {}).reduce((s, v) => s + v, 0),
      runs: runs.length,
      closedPeriods: db.snapshots.map((s) => s.period),
      method: db.settings.method,
    });
  },

  listPools: () => delay(db.pools.map((p) => ({ ...p, amounts: Object.fromEntries(allocationPeriods.map((per) => [per, db.amounts[per]?.[p.id] ?? 0])) }))),
  /** Бизнес-центры (получатели) со значениями драйверов (в т.ч. формульных и введённых вручную). */
  listUnits: () =>
    delay(db.units.map((u) => ({ ...u, drivers: Object.fromEntries(allocationPeriods.map((p) => [p, Object.fromEntries(db.drivers.map((d) => [d.id, driverValue(p, u.id, d.id)]))])) }))),
  listCenters: () => delay(allCenters()),
  listServiceCenters: () => delay(db.services),
  listRules: () => delay(db.rules),
  listDrivers: () => delay(db.drivers),
  getSettings: () => delay(db.settings),

  /** Значения драйверов всех центров за период + признак источника (авто/ручной ввод). */
  driverValues(period: string) {
    return delay(
      allCenters().map((c) => ({
        centerId: c.id,
        values: Object.fromEntries(db.drivers.map((d) => [d.id, driverValue(period, c.id, d.id)])),
        meta: db.meta[period]?.[c.id] ?? {},
      })),
    );
  },
  listDriverLog: (period?: string) => delay(db.log.filter((l) => !period || l.period === period)),

  async updateRule(poolId: ID, driver: AllocationDriver, user: User): Promise<void> {
    assertCanEdit(user);
    if (!db.drivers.some((d) => d.id === driver)) throw apiError('UNKNOWN_DRIVER');
    const rule = db.rules.find((r) => r.poolId === poolId);
    if (!rule) throw apiError('RULE_NOT_FOUND');
    if (rule.driver !== driver) audit.log({ action: 'update', entity: 'allocation_rule', entityId: poolId, entityLabel: db.pools.find((p) => p.id === poolId)?.code, changes: [{ field: 'driver', from: rule.driver, to: driver }], user: who(user) });
    rule.driver = driver;
    rule.updatedAt = now();
    rule.updatedBy = user.id;
    emit();
    await delay(null);
  },

  async updateSettings(patch: { method?: AllocationMethod; chain?: ID[] }, user: User): Promise<void> {
    assertCanEdit(user);
    const before = { method: db.settings.method, chain: db.settings.chain.join(' → ') };
    if (patch.method) {
      if (!['direct', 'step_down', 'reciprocal'].includes(patch.method)) throw apiError('UNKNOWN_METHOD');
      db.settings.method = patch.method;
    }
    if (patch.chain) {
      const ids = serviceIds();
      if (patch.chain.length !== ids.length || patch.chain.some((c) => !ids.includes(c)) || new Set(patch.chain).size !== ids.length) throw new Error('allocation_err_chain');
      db.settings.chain = [...patch.chain];
    }
    const after = { method: db.settings.method, chain: db.settings.chain.join(' → ') };
    const changes = diffFields(before, after);
    if (changes.length) {
      db.settings.version++;
      db.settings.updatedAt = now();
      db.settings.updatedBy = user.id;
      audit.log({ action: 'settings', entity: 'allocation_settings', entityId: 'method', changes, details: `v${db.settings.version}`, user: who(user) });
    }
    emit();
    await delay(null);
  },

  // ----- Библиотека драйверов (No-code) -----

  async saveDriver(input: { id?: string; code: string; name: string; unit: string; formula: string }, user: User): Promise<AllocationDriverDef> {
    assertCanEdit(user);
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9-]{1,11}$/.test(code) || !input.name.trim()) throw new Error('allocation_err_driver_code');
    let d = input.id ? db.drivers.find((x) => x.id === input.id) : undefined;
    if (d?.system) throw new Error('allocation_err_driver_system');
    if (db.drivers.some((x) => x.code === code && x.id !== d?.id)) throw new Error('allocation_err_driver_dup');
    validateFormula(input.formula, d?.id);
    if (d) {
      const before = { name: d.name.ru, unit: d.unit, formula: d.formula ?? '' };
      d.name = { ru: input.name.trim(), uz: input.name.trim(), en: input.name.trim() };
      d.unit = input.unit.trim() || 'idx';
      d.formula = input.formula.trim();
      d.code = code;
      d.updatedAt = now();
      audit.log({ action: 'update', entity: 'allocation_driver_def', entityId: d.id, entityLabel: d.code, changes: diffFields(before, { name: d.name.ru, unit: d.unit, formula: d.formula }), user: who(user) });
    } else {
      d = { id: code.toLowerCase().replace(/-/g, '_'), code, name: { ru: input.name.trim(), uz: input.name.trim(), en: input.name.trim() }, unit: input.unit.trim() || 'idx', source: 'formula', formula: input.formula.trim(), system: false, createdBy: user.id, updatedAt: now() };
      db.drivers.push(d);
      audit.log({ action: 'create', entity: 'allocation_driver_def', entityId: d.id, entityLabel: d.code, details: d.formula, user: who(user) });
    }
    emit();
    return delay(d);
  },
  async deleteDriver(id: string, user: User): Promise<void> {
    assertCanEdit(user);
    const d = db.drivers.find((x) => x.id === id);
    if (!d || d.system) throw new Error('allocation_err_driver_system');
    if (db.rules.some((r) => r.driver === id)) throw new Error('allocation_err_driver_used');
    db.drivers = db.drivers.filter((x) => x.id !== id);
    audit.log({ action: 'delete', entity: 'allocation_driver_def', entityId: id, entityLabel: d.code, user: who(user) });
    emit();
    await delay(null);
  },
  /** Проверка формулы на образце: значение для каждого бизнес-центра за период. */
  testFormula(formula: string, period: string) {
    validateFormula(formula);
    return delay(db.units.map((u) => ({ unitId: u.id, value: Math.round(allocationEvalFormula(formula, (id) => db.values[period]?.[u.id]?.[id] ?? 0) * 100) / 100 })));
  },

  /** Ручной ввод значения драйвера (например, при сбое интеграции) — фиксируется в журнале аудита. */
  async setDriverValue(period: string, centerId: ID, driverId: AllocationDriver, value: number, reason: string, user: User): Promise<void> {
    assertCanEdit(user);
    assertOpen(period);
    const d = db.drivers.find((x) => x.id === driverId);
    if (!d || d.source === 'formula') throw new Error('allocation_err_driver_formula_value');
    if (!Number.isFinite(value) || value < 0) throw new Error('allocation_err_value');
    if (reason.trim().length < 5) throw new Error('allocation_err_reason');
    const from = db.values[period]?.[centerId]?.[driverId] ?? 0;
    if (setValue(period, centerId, driverId, Math.round(value), 'manual', user.id, reason.trim())) {
      audit.log({ action: 'update', entity: 'allocation_driver', entityId: `${period}:${centerId}:${driverId}`, entityLabel: `${allCenters().find((c) => c.id === centerId)?.code} · ${d.code}`, changes: [{ field: `${driverId}[${period}]`, from: String(from), to: String(Math.round(value)) }], details: `manual · ${reason.trim()}`, user: who(user) });
    }
    emit();
    await delay(null);
  },

  /** Обновить драйверы из источников: HR (FTE), ОС (площадь), АБС (транзакции), табели, портфели и доходность (FTP). */
  async refreshDrivers(period: string, user: User): Promise<{ updated: number; exchanges: { system: string; operation: string; status: string }[] }> {
    assertCanEdit(user);
    assertOpen(period);
    let updated = 0;
    const exchanges: { system: string; operation: string; status: string }[] = [];
    const centers = allCenters();
    // 1) Внешние системы через интеграционную шину.
    //    P3 (PR-ALC-019): система и операция источника берутся из маппинга драйвера (Mapping), по умолчанию — по типу источника;
    //    коды центров в системе-источнике — из маппинга (центры без кода не обновляются).
    for (const d of db.drivers) {
      const m = db.mapping.find((x) => x.driverId === d.id && !MODULE_SYSTEMS.includes(x.system));
      const target: [string, string] | undefined = m ? [m.system, m.operation] : SOURCE_OP[d.source];
      if (!target || d.source === 'formula') continue;
      const [system, op] = target;
      const keys = m && Object.values(m.centerKeys).some((v) => v.trim()) ? m.centerKeys : undefined;
      const rec = await integrationHub.call(system, op, { period, driver: d.code, ...(m ? { field: m.field } : {}), rows: centers.length, ...(keys ? { centers: Object.values(keys) } : {}) }, { userId: user.id, idempotencyKey: `alloc-${period}-${d.id}-${db.log.length}` });
      exchanges.push({ system, operation: op, status: rec.status });
      if (rec.status !== 'success') continue; // сбой интеграции — значения остаются, можно ввести вручную
      for (const c of centers) {
        if (keys && c.type === 'business' && !keys[c.id]?.trim()) continue;
        const cur = db.values[period]?.[c.id]?.[d.id] ?? 0;
        if (cur && setValue(period, c.id, d.id, drift(`${period}-${c.id}-${d.id}-${db.log.length}`, cur), 'auto', 'system')) updated++;
      }
    }
    // 2) Площадь — из модуля «Основные средства»: собственные здания (площадь по кадастру) в оргединицах центра
    //    + арендуемая площадь (фиксируется при первой синхронизации). Ввод/выбытие здания в ОС меняет драйвер.
    const buildings = await assetsApi.list({ category: 'buildings' });
    for (const u of db.units) {
      const owned = buildings
        .filter((b) => (u.orgUnitKey ? b.orgUnitKey === u.orgUnitKey || b.orgUnitKey.startsWith(`${u.orgUnitKey}-`) : b.departmentId === u.departmentId && !b.orgUnitKey.startsWith('R')))
        .reduce((s, b) => s + ((b as { taxObject?: { area?: number } }).taxObject?.area ?? 0), 0);
      const key = `${u.id}`;
      if (!(key in db.leased)) db.leased[key] = Math.max(0, (db.values[period]?.[u.id]?.area ?? 0) - owned);
      if (setValue(period, u.id, 'area', owned + db.leased[key]!, 'auto', 'system')) updated++;
    }
    exchanges.push({ system: 'assets', operation: 'module:assets', status: 'success' });
    // 3) Портфели и доходность — из модуля FTP (остатки активов/пассивов и чистый процентный доход направлений).
    const ftp = await ftpApi.compute(0);
    const byFtp = (fu: string) => db.units.filter((u) => u.ftpUnitId === fu);
    for (const fu of new Set(db.units.map((u) => u.ftpUnitId).filter(Boolean) as string[])) {
      const res = ftp.units.find((x) => x.unitId === fu);
      if (!res) continue;
      const members = byFtp(fu);
      const weights = members.map((m) => db.values[period]?.[m.id]?.headcount ?? 1);
      const split = (v: number) => allocationSplit(Math.max(0, Math.round(v)), weights);
      const loans = split(res.assets);
      const deps = split(res.liabilities);
      const prof = split(res.totalNii);
      members.forEach((m, i) => {
        if (setValue(period, m.id, 'loans', loans[i]!, 'auto', 'system')) updated++;
        if (setValue(period, m.id, 'deposits', deps[i]!, 'auto', 'system')) updated++;
        if (setValue(period, m.id, 'profit', prof[i]!, 'auto', 'system')) updated++;
        if (setValue(period, m.id, 'assets_volume', loans[i]!, 'auto', 'system')) updated++;
      });
    }
    exchanges.push({ system: 'ftp', operation: 'module:ftp', status: 'success' });
    audit.log({ action: 'update', entity: 'allocation_driver', entityId: period, details: `refresh from sources · ${updated} values`, user: who(user) });
    emit();
    return delay({ updated, exchanges });
  },

  listMapping: () => delay(db.mapping),
  async saveMapping(m: Omit<AllocationMapping, 'updatedAt' | 'updatedBy'>, user: User): Promise<void> {
    assertCanEdit(user);
    if (!db.drivers.some((d) => d.id === m.driverId) || !m.system.trim() || !m.operation.trim() || !m.field.trim()) throw new Error('allocation_err_mapping');
    const ex = db.mapping.find((x) => x.driverId === m.driverId);
    const next: AllocationMapping = { ...m, system: m.system.trim(), operation: m.operation.trim(), field: m.field.trim(), updatedAt: now(), updatedBy: user.id };
    if (ex) {
      audit.log({ action: 'update', entity: 'allocation_mapping', entityId: m.driverId, changes: diffFields({ system: ex.system, operation: ex.operation, field: ex.field, keys: JSON.stringify(ex.centerKeys) }, { system: next.system, operation: next.operation, field: next.field, keys: JSON.stringify(next.centerKeys) }), user: who(user) });
      Object.assign(ex, next);
    } else {
      db.mapping.push(next);
      audit.log({ action: 'create', entity: 'allocation_mapping', entityId: m.driverId, user: who(user) });
    }
    emit();
    await delay(null);
  },

  // ----- Бухгалтерские счета -----

  listGl(period: string, filter: { category?: AllocationGlCategory | ''; poolId?: ID } = {}) {
    return delay(db.gl.filter((g) => g.period === period && (!filter.category || g.category === filter.category) && (!filter.poolId || g.poolId === filter.poolId)));
  },
  listGlLoads: () => delay([...db.glLoads].sort((a, b) => b.at.localeCompare(a.at))),
  /** Автоагрегация: собрать обороты счетов расходов из iABS и пересчитать суммы пулов за период. */
  async aggregateGl(period: string, user: User): Promise<AllocationGlLoad> {
    assertCanEdit(user);
    assertOpen(period);
    const entries = buildGl(period);
    const total = entries.reduce((s, e) => s + e.amount, 0);
    const rec = await integrationHub.call('iabs', 'gl.balances', { period, rows: entries.length, controlSum: total, accounts: GL_ACCOUNTS.map((g) => g.account) }, { userId: user.id, idempotencyKey: `alloc-gl-${period}-${db.glLoads.length}` });
    if (rec.status !== 'success') throw new Error('allocation_err_gl_unavailable');
    db.gl = [...db.gl.filter((g) => g.period !== period), ...entries];
    const sums: Record<ID, number> = {};
    for (const e of entries) sums[e.poolId] = (sums[e.poolId] ?? 0) + e.amount;
    db.amounts[period] = { ...(db.amounts[period] ?? {}), ...sums };
    const load: AllocationGlLoad = { period, at: now(), userId: user.id, exchangeId: rec.id, entries: entries.length, total };
    db.glLoads.push(load);
    audit.log({ action: 'update', entity: 'allocation_gl', entityId: period, details: `GL aggregate · ${entries.length} · ${total}`, user: who(user) });
    emit();
    return delay(load);
  },

  // ----- Расчёт -----

  /** Предварительный расчёт по текущим правилам и методу без сохранения. */
  preview(period: string): Promise<Pick<AllocationRun, 'period' | 'cells' | 'total' | 'rules' | 'method' | 'flows' | 'chain' | 'iterations' | 'residual'>> {
    const r = makeRun(period, 'preview', now());
    const { id: _id, number: _n, createdAt: _c, userId: _u, ...rest } = r;
    void _id; void _n; void _c; void _u;
    return delay(rest);
  },

  async run(period: string, user: User): Promise<AllocationRun> {
    assertCanEdit(user);
    if (!allocationPeriods.includes(period)) throw apiError('UNKNOWN_PERIOD');
    assertOpen(period);
    const r = makeRun(period, user.id, now());
    db.runs.push(r);
    audit.log({ action: 'create', entity: 'allocation_run', entityId: r.id, entityLabel: r.number, details: `${period} · ${r.method} · ${r.total}`, user: who(user) });
    emit();
    return delay(r);
  },

  listRuns: () => delay([...db.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  getRun: (id: ID) => delay(db.runs.find((r) => r.id === id)),

  /** Сравнение методов на периоде: прямой, каскадный, взаимный (итоги по бизнес-центрам). */
  compareMethods(period: string) {
    const out = (['direct', 'step_down', 'reciprocal'] as AllocationMethod[]).map((m) => {
      const r = makeRun(period, 'preview', now(), { method: m });
      return { method: m, totals: allocationUnitTotals(r), iterations: r.iterations, residual: r.residual, total: r.total };
    });
    return delay(out);
  },

  // ----- What-if -----

  listScenarios: () => delay(db.scenarios),
  async saveScenario(s: Omit<AllocationScenario, 'id' | 'createdAt' | 'createdBy'> & { id?: ID }, user: User): Promise<AllocationScenario> {
    assertCanEdit(user);
    if (!s.name.trim() || [...Object.values(s.poolPct), ...Object.values(s.driverPct)].some((v) => !Number.isFinite(v) || v < -90 || v > 300)) throw new Error('allocation_err_scenario');
    let sc = s.id ? db.scenarios.find((x) => x.id === s.id) : undefined;
    if (sc) Object.assign(sc, { name: s.name.trim(), poolPct: s.poolPct, driverPct: s.driverPct, ...(s.method ? { method: s.method } : {}) });
    else {
      sc = { id: nextId('as'), name: s.name.trim(), poolPct: s.poolPct, driverPct: s.driverPct, ...(s.method ? { method: s.method } : {}), createdBy: user.id, createdAt: now() };
      db.scenarios.push(sc);
    }
    audit.log({ action: s.id ? 'update' : 'create', entity: 'allocation_scenario', entityId: sc.id, entityLabel: sc.name, user: who(user) });
    emit();
    return delay(sc);
  },
  async deleteScenario(id: ID, user: User): Promise<void> {
    assertCanEdit(user);
    db.scenarios = db.scenarios.filter((x) => x.id !== id);
    emit();
    await delay(null);
  },
  /** Песочница: себестоимость и прибыль при изменении сумм пулов (%), драйверов (%) или метода — без изменения правил. */
  async whatIf(period: string, s: Pick<AllocationScenario, 'poolPct' | 'driverPct' | 'method'>): Promise<AllocationWhatIf> {
    const base = makeRun(period, 'what-if', now());
    const amounts = Object.fromEntries(Object.entries(db.amounts[period] ?? {}).map(([k, v]) => [k, Math.round(v * (1 + (s.poolPct[k] ?? 0) / 100))]));
    const values: Values = { [period]: {} };
    for (const c of allCenters()) values[period]![c.id] = Object.fromEntries(Object.entries(db.values[period]?.[c.id] ?? {}).map(([d, v]) => [d, v * (1 + (s.driverPct[d] ?? 0) / 100)]));
    const scenario = makeRun(period, 'what-if', now(), { amounts, values, ...(s.method ? { method: s.method } : {}) });
    const bt = allocationUnitTotals(base);
    const st = allocationUnitTotals(scenario);
    const ftp = await ftpApi.compute(0);
    const income = (u: (typeof db.units)[number]) => {
      const fu = ftp.units.find((x) => x.unitId === u.ftpUnitId);
      const members = db.units.filter((x) => x.ftpUnitId === u.ftpUnitId);
      const w = members.map((m) => db.values[period]?.[m.id]?.revenue ?? 0);
      const tot = w.reduce((a, b) => a + b, 0) || 1;
      return Math.round(((fu?.totalNii ?? 0) / 4) * ((db.values[period]?.[u.id]?.revenue ?? 0) / tot)); // квартал
    };
    const units = db.units.map((u) => {
      const b = bt.find((x) => x.unitId === u.id)?.amount ?? 0;
      const sc = st.find((x) => x.unitId === u.id)?.amount ?? 0;
      const inc = income(u);
      return { unitId: u.id, base: b, scenario: sc, delta: sc - b, income: inc, profitBase: inc - b, profitScenario: inc - sc };
    });
    // Себестоимость продуктов: затраты направления → продукты пропорционально остаткам (как в модуле анализа операций).
    const products = ftp.products.map((pr) => {
      const owners = db.units.filter((u) => u.ftpUnitId === pr.unitId);
      const unitBal = ftp.products.filter((x) => x.unitId === pr.unitId).reduce((a, x) => a + x.balance, 0) || 1;
      const sh = pr.balance / unitBal;
      const b = owners.reduce((a, u) => a + (bt.find((x) => x.unitId === u.id)?.amount ?? 0), 0) * sh;
      const sc = owners.reduce((a, u) => a + (st.find((x) => x.unitId === u.id)?.amount ?? 0), 0) * sh;
      return { productId: pr.id, name: pr.name, base: Math.round(b), scenario: Math.round(sc), delta: Math.round(sc - b) };
    });
    return delay({ period, base, scenario, units, products });
  },

  // ----- Закрытие периода -----

  listSnapshots: () => delay(db.snapshots),
  getSnapshot: (period: string) => delay(db.snapshots.find((s) => s.period === period)),
  async closePeriod(period: string, user: User): Promise<AllocationSnapshot> {
    assertCanEdit(user);
    assertOpen(period);
    const run = [...db.runs].filter((r) => r.period === period).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!run) throw new Error('allocation_err_no_run');
    const snap = snapshotFor(period, run, user.id, now());
    db.snapshots.push(snap);
    audit.log({ action: 'update', entity: 'allocation_period', entityId: period, entityLabel: period, details: `close · ${run.number} · snapshot`, user: who(user) });
    emit();
    return delay(snap);
  },

  /** Косвенные затраты по бизнес-центрам и категориям пулов для себестоимости продуктов (последний расчёт периода или предпросмотр). */
  costingFeed(period: string): Promise<AllocationCostingFeed> {
    const run = [...db.runs].filter((r) => r.period === period).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const src = run ?? makeRun(period, 'preview', now());
    const byUnit = db.units.map((u) => {
      const byCategory = Object.fromEntries(['it', 'hr', 'admin', 'premises', 'operations', 'security', 'marketing', 'corporate', 'taxes'].map((c) => [c, 0])) as Record<AllocationPoolCategory, number>;
      for (const c of src.cells.filter((x) => x.unitId === u.id)) {
        const cat = db.pools.find((p) => p.id === c.poolId)?.category ?? 'admin';
        byCategory[cat] += c.amount;
      }
      return { unitId: u.id, ...(u.ftpUnitId ? { ftpUnitId: u.ftpUnitId } : {}), total: Object.values(byCategory).reduce((a, b) => a + b, 0), byCategory };
    });
    return delay({ period, ...(run ? { runId: run.id, runNumber: run.number } : {}), source: run ? 'run' : 'preview', method: src.method, byUnit, total: src.total });
  },
};
