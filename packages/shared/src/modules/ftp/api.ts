// API модуля «Трансфертное ценообразование (FTP)» (ТЗ 4.2.15).
// Границы (4.2.15.0): ставки и результаты FTP по кредитам и депозитам рассчитывает КХД и передаёт готовыми —
//   модуль обеспечивает приём (integrationHub 'khd'), контроль, сверку с контрольным расчётом, версионирование и применение.
// Контрольный/сценарный расчёт (без дублирования КХД в отчётности):
//   базовая ставка = кривая на срок (Matched Maturity, интерполяция linear / cubic spline / flat) или единая ставка пула (Single Pool) + сдвиг;
//   + надбавка за ликвидность (LP) по сроку; для обязательств — минус стоимость ФОР и LCR (HQLA); + правила применения
//   (валюта, филиал, направление, срок). Актив: маржа = клиентская − FTP; пассив: FTP − клиентская.
//   Казначейство получает маржу несовпадения: Σ FTP по активам − Σ FTP по пассивам. Сумма маржей = ЧПД банка.
import { clone, delay, emit, nextId, nextNumber, now, today } from '../../bus';
import { localize, tk, translate } from '../../i18n';
import { matches, registerSearchProvider } from '../../search';
import { audit, diffFields } from '../../audit';
import { can } from '../../security';
import { importRegistry, type ImportIssue, type ImportValue } from '../../services/importer';
import type { ID, Role, User } from '../../types';
import { FL, finplanEnsureOp, finplanEnsureSystem, integrationHub } from '../budgeting/integrationOps';
import {
  FTP_BRANCH_SHARE,
  FTP_INFLOWS_30D,
  FTP_TENORS,
  FTP_TREASURY_UNIT,
  ftpAccounts,
  ftpCurveVersions,
  ftpHqla,
  ftpLpCurve,
  ftpMethodologies,
  ftpProducts,
  ftpRegParams,
  ftpRules,
  ftpUnits,
} from './data';
import type {
  FtpBranchRow,
  FtpCurrency,
  FtpCurve,
  FtpCurveChange,
  FtpCurvePoint,
  FtpCurveVersion,
  FtpInterpolation,
  FtpKhdBatch,
  FtpKhdIssue,
  FtpKhdKind,
  FtpKhdRow,
  FtpMethodology,
  FtpMethodologyVersion,
  FtpProductResult,
  FtpRateBreakdown,
  FtpRateQuery,
  FtpRateRule,
  FtpRegParams,
  FtpResults,
  FtpRun,
  FtpRunKind,
  FtpSchedule,
  FtpUnitResult,
} from './types';
import { apiError } from '../../errors';

const db = {
  versions: clone(ftpCurveVersions),
  products: clone(ftpProducts),
  units: clone(ftpUnits),
  log: [] as FtpCurveChange[],
  lp: clone(ftpLpCurve),
  reg: clone(ftpRegParams),
  hqla: clone(ftpHqla),
  rules: clone(ftpRules),
  methodologies: clone(ftpMethodologies),
  applied: 'mm' as ID,
  runs: [] as FtpRun[],
  schedule: { daily: true, monthly: true, dailyTime: '06:00', updatedAt: '2026-01-02T09:00:00Z', updatedBy: 'system' } as FtpSchedule,
  khd: [] as FtpKhdBatch[],
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (a: number, b: number) => (b ? round2((a / b) * 100) : 0);
export const FTP_CURRENCIES: FtpCurrency[] = ['UZS', 'USD', 'EUR', 'RUB', 'CNY', 'GBP', 'KZT'];

// ---------- Кривые: версии и интерполяция ----------

/** Естественный кубический сплайн по узлам (x — срок в месяцах). */
function cubic(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n < 3) return linearAt(xs, ys, x);
  const h = xs.slice(1).map((v, i) => v - xs[i]!);
  const alpha = Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) alpha[i] = (3 / h[i]!) * (ys[i + 1]! - ys[i]!) - (3 / h[i - 1]!) * (ys[i]! - ys[i - 1]!);
  const l = Array(n).fill(1);
  const mu = Array(n).fill(0);
  const z = Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (xs[i + 1]! - xs[i - 1]!) - h[i - 1]! * mu[i - 1];
    mu[i] = h[i]! / l[i];
    z[i] = (alpha[i] - h[i - 1]! * z[i - 1]) / l[i];
  }
  const c = Array(n).fill(0);
  const b = Array(n).fill(0);
  const d = Array(n).fill(0);
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (ys[j + 1]! - ys[j]!) / h[j]! - (h[j]! * (c[j + 1] + 2 * c[j])) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]!);
  }
  let k = n - 2;
  for (let i = 0; i < n - 1; i++) if (x <= xs[i + 1]!) { k = i; break; }
  const dx = x - xs[k]!;
  return ys[k]! + b[k] * dx + c[k] * dx * dx + d[k] * dx * dx * dx;
}

function linearAt(xs: number[], ys: number[], x: number): number {
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]!) return ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (x - xs[i - 1]!)) / (xs[i]! - xs[i - 1]!);
  }
  return ys[ys.length - 1]!;
}

/** Ставка кривой на произвольный срок: выбранный метод интерполяции, за пределами — плоская экстраполяция. */
export function ftpInterpolate(curve: Pick<FtpCurve, 'points'> & { interpolation?: FtpInterpolation }, tenorMonths: number): number {
  const pts = [...curve.points].sort((a, b) => a.tenorMonths - b.tenorMonths);
  if (!pts.length) return 0;
  if (tenorMonths <= pts[0]!.tenorMonths) return pts[0]!.rate;
  const last = pts[pts.length - 1]!;
  if (tenorMonths >= last.tenorMonths) return last.rate;
  const node = pts.find((p) => Math.abs(p.tenorMonths - tenorMonths) < 1e-9);
  if (node) return node.rate;
  const xs = pts.map((p) => p.tenorMonths);
  const ys = pts.map((p) => p.rate);
  if (curve.interpolation === 'flat') return [...pts].reverse().find((p) => p.tenorMonths <= tenorMonths)!.rate;
  if (curve.interpolation === 'cubic') return cubic(xs, ys, tenorMonths);
  return linearAt(xs, ys, tenorMonths);
}

function versionAt(currency: FtpCurrency, asOf: string): FtpCurveVersion | undefined {
  return db.versions
    .filter((v) => v.currency === currency && v.status !== 'draft' && v.validFrom <= asOf)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.version - a.version)[0]
    ?? db.versions.filter((v) => v.currency === currency && v.status !== 'draft').sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
}

const asCurve = (v: FtpCurveVersion): FtpCurve => ({ currency: v.currency, asOf: v.validFrom, points: [...v.points].sort((a, b) => a.tenorMonths - b.tenorMonths), interpolation: v.interpolation, versionId: v.id, version: v.version, source: v.source });
const currencies = () => [...new Set(db.versions.map((v) => v.currency))].sort((a, b) => FTP_CURRENCIES.indexOf(a) - FTP_CURRENCIES.indexOf(b));

function lpAt(tenor: number): number {
  const pts = [...db.lp].sort((a, b) => a.tenorMonths - b.tenorMonths);
  return ftpInterpolate({ points: pts.map((p) => ({ tenorMonths: p.tenorMonths, label: p.label, rate: p.bp })), interpolation: 'linear' }, tenor);
}

/** Доля обязательства, которая может быть востребована в 30-дневном горизонте LCR (поведенческая оценка по сроку). */
function lcrMaturityFactor(tenorMonths: number): number {
  return tenorMonths <= 1 ? 1 : tenorMonths <= 12 ? 0.5 : 0.1;
}

function regAt(asOf: string): FtpRegParams {
  return [...db.reg].filter((r) => r.validFrom <= asOf).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? db.reg[0]!;
}

function methodologyAt(id: ID, asOf: string, version?: number): { m: FtpMethodology; v: FtpMethodologyVersion } {
  const m = db.methodologies.find((x) => x.id === id) ?? db.methodologies[0]!;
  if (version) return { m, v: m.versions.find((x) => x.version === version) ?? m.versions[0]! };
  const approved = m.versions.filter((x) => x.status === 'approved');
  const v = approved.filter((x) => x.validFrom <= asOf).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? approved[0] ?? m.versions[0]!;
  return { m, v };
}

function matchRule(r: FtpRateRule, q: { currency: FtpCurrency; side: string; tenorMonths: number; unitId?: ID; branchKey?: string }, asOf: string) {
  if (!r.active || r.validFrom > asOf) return false;
  if (r.currency && r.currency !== q.currency) return false;
  if (r.side && r.side !== q.side) return false;
  if (r.unitId && r.unitId !== q.unitId) return false;
  if (r.branchKey && r.branchKey !== q.branchKey) return false;
  if (r.tenorFrom !== undefined && q.tenorMonths < r.tenorFrom) return false;
  if (r.tenorTo !== undefined && q.tenorMonths > r.tenorTo) return false;
  return true;
}

interface ComputeOpts {
  asOf?: string;
  methodologyId?: ID;
  methodologyVersion?: number;
  /** Временные кривые (What-if / стресс): валюта → точки. */
  curveOverride?: Partial<Record<FtpCurrency, FtpCurvePoint[]>>;
  branchKey?: string;
  /** P2-FINPLAN: форма сдвига кривой (What-if): параллельный, крутизна, уплощение, короткий конец. */
  shape?: FtpShiftShape;
}

export type FtpShiftShape = 'parallel' | 'steepen' | 'flatten' | 'short';
/** Доля сдвига, применяемая к сроку (мес.) для выбранной формы. */
export function ftpShapeFactor(shape: FtpShiftShape | undefined, tenorMonths: number): number {
  if (shape === 'steepen') return Math.min(1, tenorMonths / 120);
  if (shape === 'flatten') return Math.max(0, 1 - tenorMonths / 120);
  if (shape === 'short') return tenorMonths <= 12 ? 1 : 0;
  return 1;
}

/** Ставка FTP по критериям (валюта, срок, направление, филиал) с разбивкой по компонентам. */
function rateFor(q: FtpRateQuery & { shiftBp?: number }, o: ComputeOpts = {}): FtpRateBreakdown {
  const asOf = q.asOf ?? o.asOf ?? today();
  const { m, v } = methodologyAt(q.methodologyId ?? o.methodologyId ?? db.applied, asOf, o.methodologyVersion);
  const reg = regAt(asOf);
  const ver = versionAt(q.currency, asOf);
  const pts = o.curveOverride?.[q.currency] ?? ver?.points ?? [];
  const shiftRaw = (q.shiftBp ?? 0) / 100;
  const shift = shiftRaw * ftpShapeFactor(o.shape, v.method === 'single_pool' ? 12 : q.tenorMonths);
  let base: number;
  let baseLabel: string;
  if (v.method === 'single_pool') {
    base = v.poolRates[q.currency] ?? ftpInterpolate({ points: pts, interpolation: ver?.interpolation ?? 'linear' }, 12);
    baseLabel = 'Single Pool';
  } else {
    base = ftpInterpolate({ points: pts, interpolation: ver?.interpolation ?? 'linear' }, q.tenorMonths);
    baseLabel = `Matched Maturity · ${ver?.interpolation ?? 'linear'}`;
  }
  const curveRate = round2(base + shift);
  const lp = v.includeLp ? round2(lpAt(q.tenorMonths) / 100) : 0;
  let reserveCost = 0;
  let lcrCost = 0;
  if (q.side === 'liability' && v.includeRegulatory) {
    const rr = reg.reserve[q.currency] ?? reg.reserve.USD ?? { short: 0, long: 0 };
    reserveCost = round2(((q.tenorMonths < 12 ? rr.short : rr.long) / 100) * Math.max(0, curveRate - reg.reserveRemuneration));
    const oneY = ftpInterpolate({ points: pts, interpolation: 'linear' }, 12) + shiftRaw * ftpShapeFactor(o.shape, 12);
    const carry = q.currency === 'UZS' ? Math.max(0, oneY - reg.hqlaYield) : 0.5;
    lcrCost = round2(((reg.runoff[q.lcrCategory ?? 'none'] ?? 0) / 100) * lcrMaturityFactor(q.tenorMonths) * carry);
  }
  const rules = v.applyRules ? db.rules.filter((r) => matchRule(r, q, asOf)).sort((a, b) => a.priority - b.priority) : [];
  const fixed = rules.find((r) => r.kind === 'fixed');
  const adj = round2(rules.filter((r) => r.kind === 'adjust').reduce((s, r) => s + r.value, 0) / 100);
  const rate = fixed ? fixed.value : round2(curveRate + lp - reserveCost - lcrCost + adj);
  return {
    base: curveRate, baseLabel, lp, reserveCost, lcrCost, adj, rate,
    rules: rules.map((r) => ({ id: r.id, name: r.name, kind: r.kind, value: r.value })),
    ...(ver ? { curveVersion: ver.version } : {}),
    methodology: `${m.code} v${v.version}`,
  };
}

export function ftpCompute(shiftBp: number, o: ComputeOpts = {}): FtpResults {
  const asOf = o.asOf ?? today();
  const { m, v } = methodologyAt(o.methodologyId ?? db.applied, asOf, o.methodologyVersion);
  const reg = regAt(asOf);
  const products: FtpProductResult[] = db.products.map((p) => {
    const r = rateFor({ currency: p.currency, side: p.side, tenorMonths: p.tenorMonths, unitId: p.unitId, ...(o.branchKey ? { branchKey: o.branchKey } : {}), ...(p.lcrCategory ? { lcrCategory: p.lcrCategory } : {}), shiftBp, asOf, methodologyId: m.id }, o);
    const ftpRate = r.rate;
    const margin = round2(p.side === 'asset' ? p.clientRate - ftpRate : ftpRate - p.clientRate);
    return {
      ...p,
      curveRate: r.base,
      lp: r.lp,
      reg: round2(r.reserveCost + r.lcrCost),
      reserveCost: r.reserveCost,
      lcrCost: r.lcrCost,
      adj: r.adj,
      ftpRate,
      margin,
      clientNii: Math.round((p.balance * margin) / 100),
      ftpCharge: Math.round((p.balance * ftpRate) / 100),
      rules: r.rules.map((x) => x.id),
    };
  });

  const assetFtp = products.filter((p) => p.side === 'asset').reduce((s, p) => s + p.ftpCharge, 0);
  const liabFtp = products.filter((p) => p.side === 'liability').reduce((s, p) => s + p.ftpCharge, 0);
  const fundingNiiTotal = assetFtp - liabFtp;

  const units: FtpUnitResult[] = db.units.map((u) => {
    const own = products.filter((p) => p.unitId === u.id);
    const assets = own.filter((p) => p.side === 'asset').reduce((s, p) => s + p.balance, 0);
    const liabilities = own.filter((p) => p.side === 'liability').reduce((s, p) => s + p.balance, 0);
    const clientNii = own.reduce((s, p) => s + p.clientNii, 0);
    const fundingNii = u.id === FTP_TREASURY_UNIT ? fundingNiiTotal : 0;
    const base = assets + liabilities;
    return {
      unitId: u.id,
      assets,
      liabilities,
      clientNii,
      fundingNii,
      totalNii: clientNii + fundingNii,
      clientMarginPct: pct(clientNii, base),
      fundingMarginPct: pct(fundingNii, base),
      nimPct: pct(clientNii + fundingNii, base),
      ftpIncome: own.filter((p) => p.side === 'liability').reduce((s, p) => s + p.ftpCharge, 0),
      ftpExpense: own.filter((p) => p.side === 'asset').reduce((s, p) => s + p.ftpCharge, 0),
      liquidityCost: own.filter((p) => p.side === 'liability').reduce((s, p) => s + Math.round((p.balance * p.reg) / 100), 0),
      lpCharge: own.filter((p) => p.side === 'asset').reduce((s, p) => s + Math.round((p.balance * p.lp) / 100), 0),
    };
  });

  // Балансовые счета: ставка по WAL (средневзвешенному сроку денежных потоков).
  const accounts = ftpAccounts.map((a) => {
    const share = a.cashflows.reduce((s, c) => s + c.share, 0) || 1;
    const wal = round2(a.cashflows.reduce((s, c) => s + c.months * c.share, 0) / share);
    const ver = versionAt(a.currency, asOf);
    const pts = o.curveOverride?.[a.currency] ?? ver?.points ?? [];
    const rate = round2(ftpInterpolate({ points: pts, interpolation: ver?.interpolation ?? 'linear' }, wal) + shiftBp / 100 + (v.includeLp ? lpAt(wal) / 100 : 0));
    const balance = db.products.filter((p) => p.accountCode === a.code).reduce((s, p) => s + p.balance, 0);
    return { code: a.code, name: a.name, side: a.side, currency: a.currency, unitId: a.unitId, balance, wal, rate };
  });

  // Ликвидность: HQLA (уровни 1/2 с дисконтами и лимитом), чистый отток за 30 дней, LCR; стоимость ФОР/LCR/LP.
  const l1 = db.hqla.filter((h) => h.level === 'l1').reduce((s, h) => s + h.amount * (1 - reg.haircut.l1 / 100), 0);
  const l2raw = db.hqla.filter((h) => h.level !== 'l1').reduce((s, h) => s + h.amount * (1 - (h.level === 'l2a' ? reg.haircut.l2a : reg.haircut.l2b) / 100), 0);
  const l2 = Math.min(l2raw, (l1 * reg.l2Cap) / (100 - reg.l2Cap));
  const outflows = products.filter((p) => p.side === 'liability').reduce((s, p) => s + ((p.balance * (reg.runoff[p.lcrCategory ?? 'none'] ?? 0)) / 100) * lcrMaturityFactor(p.tenorMonths), 0);
  const inflows = Math.min(FTP_INFLOWS_30D, (outflows * reg.inflowCap) / 100);
  const nco = Math.max(1, outflows - inflows);
  const liquidity = {
    hqla: Math.round(l1 + l2), hqlaL1: Math.round(l1), hqlaL2: Math.round(l2), outflows: Math.round(outflows), inflows: Math.round(inflows), nco: Math.round(nco),
    lcrPct: round2(((l1 + l2) / nco) * 100),
    reserveCost: products.filter((p) => p.side === 'liability').reduce((s, p) => s + Math.round((p.balance * p.reserveCost) / 100), 0),
    lcrCost: products.filter((p) => p.side === 'liability').reduce((s, p) => s + Math.round((p.balance * p.lcrCost) / 100), 0),
    lpCost: products.filter((p) => p.side === 'asset').reduce((s, p) => s + Math.round((p.balance * p.lp) / 100), 0),
  };

  const assets = products.filter((p) => p.side === 'asset').reduce((s, p) => s + p.balance, 0);
  const liabilities = products.filter((p) => p.side === 'liability').reduce((s, p) => s + p.balance, 0);
  const clientNii = units.reduce((s, u) => s + u.clientNii, 0);
  const nii = clientNii + fundingNiiTotal;
  return {
    shiftBp, asOf, methodologyId: m.id, methodologyVersion: v.version, method: v.method,
    products, units, accounts, liquidity,
    bank: { assets, liabilities, nii, clientNii, fundingNii: fundingNiiTotal, nimPct: pct(nii, assets) },
  };
}

/** Роли, которым по умолчанию разрешено менять кривую FTP (фактическая проверка — can(user, 'ftp', 'edit')). */
export const FTP_EDIT_ROLES: Role[] = ['treasury', 'finance', 'admin'];
function assertEdit(user: User) {
  if (!can(user, 'ftp', 'edit')) throw apiError('FORBIDDEN');
}
const who = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });

// ---------- Расчёты (запуски) ----------

function makeRun(asOf: string, kind: FtpRunKind, userId: ID | 'system', createdAt: string, extra: Partial<FtpRun> = {}): FtpRun {
  const r = ftpCompute(0, { asOf });
  return {
    id: nextId('fr'), number: nextNumber('FTP'), asOf, kind, methodologyId: r.methodologyId, methodologyVersion: r.methodologyVersion,
    curveVersions: Object.fromEntries(currencies().map((c) => [c, versionAt(c, asOf)?.version ?? 0])), regVersion: regAt(asOf).version,
    bank: r.bank, units: r.units.map((u) => ({ unitId: u.unitId, totalNii: u.totalNii, ftpIncome: u.ftpIncome, ftpExpense: u.ftpExpense })),
    productRates: r.products.map((p) => ({ id: p.id, ftpRate: p.ftpRate, ftpCharge: p.ftpCharge })),
    createdAt, userId, status: 'current', ...extra,
  };
}

// Исторические плановые расчёты: ежемесячные на конец месяца и ежедневные за последние дни.
for (const d of ['2026-07-31', '2026-08-31', '2026-09-30']) db.runs.push(makeRun(d, 'monthly', 'system', `${d}T22:00:00Z`));
for (const d of ['2026-10-15', '2026-10-16', '2026-10-17']) db.runs.push(makeRun(d, 'daily', 'system', `${d}T01:00:00Z`));

// ---------- Регламентные запуски по расписанию (PR-FTP-011) ----------

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Время запуска по расписанию (dailyTime — ташкентское время, UTC+5) для даты. */
function scheduledAt(day: string, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return Date.parse(`${day}T00:00:00Z`) + ((h - 5) * 60 + m) * 60_000;
}

/**
 * Догоняющий планировщик: выполняет пропущенные регламентные расчёты, наступившие к текущему моменту —
 * ежедневные (на каждую дату в dailyTime) и ежемесячные (на конец месяца, 22:00 UTC). Выключенный режим не выполняется.
 */
function runScheduled(nowMs = Date.now()): FtpRun[] {
  const created: FtpRun[] = [];
  const todayIso = isoDay(nowMs);
  if (db.schedule.daily) {
    const last = db.runs.filter((r) => r.kind === 'daily').map((r) => r.asOf).sort().at(-1);
    let d = last ? Date.parse(`${last}T00:00:00Z`) + DAY_MS : Date.parse(`${todayIso}T00:00:00Z`);
    for (let i = 0; i < 31 && isoDay(d) <= todayIso; i++, d += DAY_MS) {
      const day = isoDay(d);
      const at = scheduledAt(day, db.schedule.dailyTime);
      if (at > nowMs) break;
      const r = makeRun(day, 'daily', 'system', new Date(at).toISOString());
      db.runs.push(r);
      created.push(r);
    }
  }
  if (db.schedule.monthly) {
    const last = db.runs.filter((r) => r.kind === 'monthly').map((r) => r.asOf).sort().at(-1);
    let [y, m] = (last ?? todayIso).slice(0, 7).split('-').map(Number) as [number, number];
    for (let i = 0; i < 12; i++) {
      m++;
      if (m > 12) (m = 1), y++;
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const at = Date.parse(`${end}T22:00:00Z`);
      if (at > nowMs) break;
      const r = makeRun(end, 'monthly', 'system', new Date(at).toISOString());
      db.runs.push(r);
      created.push(r);
    }
  }
  for (const r of created) audit.log({ action: 'create', entity: 'ftp_run', entityId: r.id, entityLabel: r.number, details: `scheduled ${r.kind} · as of ${r.asOf}`, user: { id: 'system', fullName: 'Регламент', role: 'admin' } });
  return created;
}

// ---------- КХД: приём результатов и ставок ----------

finplanEnsureOp('khd', { id: 'ftp.rates', direction: 'in', schemaVersion: '1.1', name: FL('Загрузка ставок (кривых) FTP', 'FTP stavkalarini (egri chiziqlarini) yuklash', 'Load FTP rates (curves)'), sample: () => ({ period: '2026-10' }), validate: (p) => (p.period ? null : { code: 'validation', message: 'Missing: period' }), count: (p) => Number(p.rows ?? 0), respond: (p) => ({ accepted: true, period: p.period, rows: p.rows ?? 0 }) }, 'ftp');
finplanEnsureOp('khd', { id: 'risk.el', direction: 'in', schemaVersion: '1.0', name: FL('Ожидаемые убытки (EL) по продуктам — риск-менеджмент / МСФО 9', 'Mahsulotlar bo‘yicha kutilayotgan zararlar (EL) — risk-menejment / MHXS 9', 'Expected loss (EL) by product — risk / IFRS 9'), sample: () => ({ period: '2026-09' }), validate: (p) => (p.period ? null : { code: 'validation', message: 'Missing: period' }), count: (p) => Number(p.rows ?? 0), respond: (p) => ({ accepted: true, period: p.period, rows: p.rows ?? 0 }) }, 'operations');
finplanEnsureSystem({
  id: 'mktdata', tz: '5.2.3', kind: 'external', hosts: 'Bloomberg, Refinitiv, ГЦБ (UzSE), МБК (UZONIA)',
  name: FL('Рыночные данные для кривых FTP', 'FTP egri chiziqlari uchun bozor ma’lumotlari', 'Market data for FTP curves'),
  purpose: FL('Доходность ГЦБ, ставки межбанковского рынка, котировки Bloomberg/Refinitiv для построения внутренних кривых', 'DQQ daromadliligi, banklararo bozor stavkalari, Bloomberg/Refinitiv kotirovkalari', 'Government bond yields, interbank rates, Bloomberg/Refinitiv quotes for internal curves'),
  modules: ['ftp'], latency: [200, 600],
  passport: { source: 'XB-ERP', target: 'Market data', owner: FL('Казначейство', 'G‘aznachilik', 'Treasury'), protocol: 'REST/JSON', format: 'JSON, UTF-8', endpoint: 'https://mkt.bank.local/api/v1', auth: 'OAuth 2.0 client credentials', schedule: FL('Ежедневно 07:00', 'Har kuni 07:00', 'Daily 07:00'), volume: FL('до 200 котировок/сутки', 'kuniga 200 tagacha kotirovka', 'up to 200 quotes/day'), sla: '99.5%', idempotency: 'Idempotency-Key', errorCodes: 'timeout, http_503, validation', controlTotals: FL('Число котировок', 'Kotirovkalar soni', 'Quote count') },
  operations: [{ id: 'curve.build', direction: 'in', schemaVersion: '1.0', name: FL('Котировки для построения кривой', 'Egri chiziq uchun kotirovkalar', 'Quotes for curve build'), sample: () => ({ currency: 'UZS', short: 'mbk', long: 'gov' }), validate: (p) => (p.currency ? null : { code: 'validation', message: 'Missing: currency' }), count: (p) => Number(p.rows ?? 0), respond: (p) => ({ accepted: true, currency: p.currency, rows: p.rows ?? 0 }) }],
});

function periodEnd(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Детерминированное отклонение ставки КХД от контрольного расчёта (б.п.). */
function khdNoise(key: string, period: string, version: number): number {
  let h = 0;
  const s = `${key}|${period}|${version}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  const r = (Math.abs(h) % 1000) / 1000;
  return r < 0.82 ? 0 : r < 0.95 ? (r < 0.88 ? 1 : -2) : 9; // большинство совпадает, единичные — вне допуска
}

function buildKhdRows(kind: FtpKhdKind, period: string, version: number, faulty: boolean): FtpKhdRow[] {
  const asOf = periodEnd(period);
  if (kind === 'rates') {
    const rows: FtpKhdRow[] = [];
    for (const c of currencies()) {
      const v = versionAt(c, asOf);
      for (const p of v?.points ?? []) rows.push({ key: `${c}:${p.label}`, currency: c, label: p.label, tenorMonths: p.tenorMonths, ftpRate: round2(p.rate + khdNoise(`${c}${p.label}`, period, version) / 100) });
    }
    if (faulty) rows[3] = { ...rows[3]!, ftpRate: -1 };
    return rows;
  }
  const res = ftpCompute(0, { asOf });
  const rows: FtpKhdRow[] = res.products.map((p) => {
    const rate = round2(p.ftpRate + khdNoise(p.id, period, version) / 100);
    return { key: p.id, productId: p.id, unitId: p.unitId, currency: p.currency, balance: p.balance, ftpRate: rate, ftpCharge: Math.round((p.balance * rate) / 100) };
  });
  if (faulty) {
    rows[2] = { ...rows[2]!, ftpRate: 140 };
    rows.push({ ...rows[5]! });
  }
  return rows;
}

function validateKhd(b: FtpKhdBatch): FtpKhdIssue[] {
  const issues: FtpKhdIssue[] = [];
  const seen = new Set<string>();
  b.rows.forEach((r, i) => {
    if (seen.has(r.key)) issues.push({ row: i + 1, field: 'key', code: 'duplicate', message: FL(`Дубликат записи ${r.key}`, `${r.key} yozuvi takrorlangan`, `Duplicate record ${r.key}`) });
    seen.add(r.key);
    if (!Number.isFinite(r.ftpRate) || r.ftpRate < 0 || r.ftpRate > 60) issues.push({ row: i + 1, field: 'ftpRate', code: 'range', message: FL(`Ставка ${r.ftpRate}% вне допустимого диапазона 0–60%`, `${r.ftpRate}% stavka 0–60% oralig‘idan tashqarida`, `Rate ${r.ftpRate}% outside 0–60%`) });
    if (b.kind === 'results' && !db.products.some((p) => p.id === r.productId)) issues.push({ row: i + 1, field: 'productId', code: 'unknown', message: FL(`Неизвестный продукт ${r.productId}`, `Noma’lum mahsulot ${r.productId}`, `Unknown product ${r.productId}`) });
  });
  const ctrlRows = b.rows.length;
  const ctrlBal = b.rows.reduce((s, r) => s + (r.balance ?? 0), 0);
  if (ctrlRows !== b.control.rows || (b.kind === 'results' && ctrlBal !== b.control.balance)) {
    issues.push({ row: 0, field: 'control', code: 'control_total', message: FL('Контрольные суммы пакета не совпадают с данными', 'Paket nazorat summalari ma’lumotlarga mos emas', 'Batch control totals do not match the data') });
  }
  return issues;
}

function makeBatch(kind: FtpKhdKind, period: string, faulty: boolean, userId: ID | 'system', receivedAt: string, exchangeId?: ID): FtpKhdBatch {
  const version = db.khd.filter((b) => b.kind === kind && b.period === period).length + 1;
  const rows = buildKhdRows(kind, period, version, faulty);
  const good = faulty ? rows.slice(0, rows.length - (kind === 'results' ? 1 : 0)) : rows;
  const b: FtpKhdBatch = {
    id: nextId('kb'), number: `KHD-${kind === 'results' ? 'R' : 'C'}-${period}-v${version}`, kind, period, version, receivedAt, ...(exchangeId ? { exchangeId } : {}),
    status: 'received', rows,
    control: { rows: good.length, balance: good.reduce((s, r) => s + (r.balance ?? 0), 0), charge: good.reduce((s, r) => s + (r.ftpCharge ?? 0), 0) },
    issues: [], userId,
  };
  b.issues = validateKhd(b);
  b.status = b.issues.length ? 'errors' : 'validated';
  db.khd.push(b);
  return b;
}

const KHD_TOLERANCE_BP = 5;

function reconcileBatch(b: FtpKhdBatch) {
  const asOf = periodEnd(b.period);
  const diffs: NonNullable<FtpKhdBatch['recon']>['diffs'] = [];
  if (b.kind === 'results') {
    const res = ftpCompute(0, { asOf });
    for (const r of b.rows) {
      const ctrl = res.products.find((p) => p.id === r.productId);
      if (!ctrl) continue;
      const diffBp = Math.round((r.ftpRate - ctrl.ftpRate) * 100);
      diffs.push({ key: r.key, khdRate: r.ftpRate, ctrlRate: ctrl.ftpRate, diffBp, flagged: Math.abs(diffBp) > KHD_TOLERANCE_BP });
    }
  } else {
    for (const r of b.rows) {
      const v = versionAt(r.currency, asOf);
      const ctrl = v ? ftpInterpolate(v, r.tenorMonths ?? 12) : 0;
      const diffBp = Math.round((r.ftpRate - ctrl) * 100);
      diffs.push({ key: r.key, khdRate: r.ftpRate, ctrlRate: round2(ctrl), diffBp, flagged: Math.abs(diffBp) > KHD_TOLERANCE_BP });
    }
  }
  b.recon = { tolerance: KHD_TOLERANCE_BP, matched: diffs.filter((d) => !d.flagged).length, diffs, checkedAt: now() };
  if (b.status === 'validated') b.status = 'reconciled';
}

function acceptBatch(b: FtpKhdBatch, userId: ID, comment?: string, at = now()) {
  for (const o of db.khd) if (o.kind === b.kind && o.period === b.period && o.status === 'accepted') o.status = 'superseded';
  b.status = 'accepted';
  b.decidedBy = userId;
  b.decidedAt = at;
  if (comment) b.comment = comment;
  if (b.kind === 'rates') {
    // Принятые ставки КХД становятся новой версией кривой с 1-го числа следующего месяца.
    const [y, m] = b.period.split('-').map(Number) as [number, number];
    const validFrom = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    for (const c of [...new Set(b.rows.map((r) => r.currency))]) {
      const pts = b.rows.filter((r) => r.currency === c).map((r) => ({ tenorMonths: r.tenorMonths ?? 12, label: r.label ?? '', rate: r.ftpRate }));
      const prev = versionAt(c, validFrom);
      db.versions.push({ id: nextId('fcv'), currency: c, version: Math.max(0, ...db.versions.filter((v) => v.currency === c).map((v) => v.version)) + 1, validFrom, points: pts, interpolation: prev?.interpolation ?? 'linear', source: 'khd', status: 'active', note: `${b.number}`, createdBy: userId, createdAt: at });
    }
  }
}

// Демо-история приёма: август — принят; сентябрь — пакет с ошибками отклонён, исправленный принят.
{
  const aug = makeBatch('results', '2026-08', false, 'system', '2026-09-03T06:10:00Z');
  reconcileBatch(aug);
  acceptBatch(aug, 'u8', 'Расхождения в пределах допуска', '2026-09-03T10:00:00Z');
  const sep1 = makeBatch('results', '2026-09', true, 'system', '2026-10-03T06:10:00Z');
  sep1.status = 'rejected';
  sep1.decidedBy = 'u8';
  sep1.decidedAt = '2026-10-03T09:00:00Z';
  sep1.comment = 'Ошибки контроля: ставка вне диапазона, дубликат, контрольные суммы';
  const sep2 = makeBatch('results', '2026-09', false, 'system', '2026-10-04T06:10:00Z');
  reconcileBatch(sep2);
  acceptBatch(sep2, 'u8', 'Повторная выгрузка КХД после исправления', '2026-10-04T11:00:00Z');
}

// ---------- Импорт кривых из Excel/CSV ----------

importRegistry.register({
  id: 'ftp_curve_points',
  name: FL('FTP: точки кривой', 'FTP: egri chiziq nuqtalari', 'FTP: curve points'),
  description: FL('Загрузка кривой FTP из Excel/CSV: валюта, срок, ставка, дата начала действия — создаётся черновик версии кривой', 'Excel/CSV dan FTP egri chizig‘ini yuklash: valyuta, muddat, stavka, amal qilish sanasi — egri chiziq versiyasi qoralamasi yaratiladi', 'Load an FTP curve from Excel/CSV: currency, tenor, rate, effective date — a draft curve version is created'),
  fields: [
    { key: 'currency', label: FL('Валюта', 'Valyuta', 'Currency'), type: 'enum', required: true, options: FTP_CURRENCIES.map((c) => ({ value: c, label: FL(c, c, c) })), sample: 'UZS' },
    { key: 'label', label: FL('Срок', 'Muddat', 'Tenor'), type: 'string', required: true, sample: '1Y' },
    { key: 'months', label: FL('Срок, мес.', 'Muddat, oy', 'Tenor, months'), type: 'number', required: true, min: 0.01, max: 360, sample: '12' },
    { key: 'rate', label: FL('Ставка, %', 'Stavka, %', 'Rate, %'), type: 'number', required: true, min: 0, max: 60, sample: '19.5' },
    { key: 'validFrom', label: FL('Действует с', 'Amal qiladi', 'Effective from'), type: 'date', required: true, sample: '2026-11-01' },
  ],
  async extraValidate(rows) {
    return rows.map((): ImportIssue[] => []);
  },
  async commit(rows: Record<string, ImportValue>[], user: User) {
    assertEdit(user);
    const groups = new Map<string, Record<string, ImportValue>[]>();
    for (const r of rows) groups.set(`${r.currency}|${r.validFrom}`, [...(groups.get(`${r.currency}|${r.validFrom}`) ?? []), r]);
    for (const [key, rs] of groups) {
      const [c, validFrom] = key.split('|') as [FtpCurrency, string];
      const prev = versionAt(c, String(validFrom));
      db.versions.push({ id: nextId('fcv'), currency: c, version: Math.max(0, ...db.versions.filter((v) => v.currency === c).map((v) => v.version)) + 1, validFrom: String(validFrom).slice(0, 10), points: rs.map((r) => ({ label: String(r.label), tenorMonths: Number(r.months), rate: Number(r.rate) })).sort((a, b) => a.tenorMonths - b.tenorMonths), interpolation: prev?.interpolation ?? 'linear', source: 'import', status: 'draft', note: 'Импорт Excel/CSV', createdBy: user.id, createdAt: now() });
    }
    audit.log({ action: 'create', entity: 'ftp_curve', entityId: 'import', details: `${rows.length} points · ${groups.size} versions (draft)`, user: who(user) });
    emit();
    return { created: groups.size, updated: 0, skipped: 0 };
  },
});

// ---------- Глобальный поиск ----------

registerSearchProvider((q, lang) => [
  ...db.products
    .filter((p) => matches(q, p.name.ru, p.name.uz, p.name.en ?? ''))
    .map((p) => ({
      group: 'ftp_title',
      title: `${localize(p.name, lang)} · ${p.currency}`,
      subtitle: `${translate(lang, tk('ftp_side_', p.side))} · ${translate(lang, 'ftp_clientRate')} ${p.clientRate}%`,
      to: `/ftp/products/${p.id}`,
    })),
  ...db.khd.filter((b) => matches(q, b.number)).map((b) => ({ group: 'ftp_title', title: b.number, subtitle: b.status, to: '/ftp?tab=khd' })),
  ...db.runs.filter((r) => matches(q, r.number)).map((r) => ({ group: 'ftp_title', title: `${r.number} · ${r.asOf}`, subtitle: r.kind, to: '/ftp?tab=runs' })),
]);

// ---------- Публичный API ----------

function bumpVersion(currency: FtpCurrency, user: User, note: string, mutate: (pts: FtpCurvePoint[]) => FtpCurvePoint[], interpolation?: FtpInterpolation): FtpCurveVersion {
  const d = today();
  const cur = versionAt(currency, d);
  if (!cur) throw apiError('CURVE_NOT_FOUND');
  // Правка в день действия текущей ручной версии — в той же версии; иначе — новая версия с сегодняшней даты.
  if (cur.validFrom === d && cur.source === 'manual' && cur.createdBy === user.id) {
    cur.points = mutate(cur.points.map((p) => ({ ...p })));
    if (interpolation) cur.interpolation = interpolation;
    cur.note = note;
    return cur;
  }
  const v: FtpCurveVersion = { id: nextId('fcv'), currency, version: Math.max(...db.versions.filter((x) => x.currency === currency).map((x) => x.version)) + 1, validFrom: d, points: mutate(cur.points.map((p) => ({ ...p }))), interpolation: interpolation ?? cur.interpolation, source: 'manual', status: 'active', note, createdBy: user.id, createdAt: now() };
  db.versions.push(v);
  return v;
}

export const ftpApi = {
  treasuryUnitId: FTP_TREASURY_UNIT,
  tenors: FTP_TENORS,

  /** Кривые, действующие на дату (по умолчанию — сегодня). */
  listCurves: (asOf?: string) => delay(currencies().map((c) => versionAt(c, asOf ?? today())).filter(Boolean).map((v) => asCurve(v!))),
  listCurveVersions: (currency?: FtpCurrency) => delay(db.versions.filter((v) => !currency || v.currency === currency).sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.version - a.version)),
  listUnits: () => delay(db.units),
  listProducts: () => delay(db.products),
  listCurveLog: () => delay([...db.log].reverse()),

  /** Расчёт FTP по всем продуктам при параллельном сдвиге кривой (б.п.), на дату и по методологии. */
  compute: (shiftBp = 0, opts: ComputeOpts = {}) => delay(ftpCompute(shiftBp, opts)),
  /** Параллельный расчёт по нескольким методологиям для сравнения. */
  compareMethodologies: (ids: ID[], asOf?: string) => delay(ids.map((id) => ftpCompute(0, { methodologyId: id, ...(asOf ? { asOf } : {}) }))),
  /** Стресс/What-if: временные точки кривых (не сохраняются) — сравнение с базой. */
  stress: (override: Partial<Record<FtpCurrency, FtpCurvePoint[]>>, shiftBp = 0) => delay({ base: ftpCompute(0), stressed: ftpCompute(shiftBp, { curveOverride: override }) }),
  /** Ставка FTP по критериям: валюта, срок, направление, филиал (PR-FTP-014…017). */
  resolveRate: (q: FtpRateQuery) => delay(rateFor(q)),
  /** Отчёт по филиалам: остатки направлений по регионам, ставки с правилами филиала. */
  branchReport(asOf?: string): Promise<FtpBranchRow[]> {
    const rows = Object.entries(FTP_BRANCH_SHARE).map(([branchKey, share]) => {
      const res = ftpCompute(0, { branchKey, ...(asOf ? { asOf } : {}) });
      const a = res.products.filter((p) => p.side === 'asset' && p.unitId !== FTP_TREASURY_UNIT);
      const l = res.products.filter((p) => p.side === 'liability' && p.unitId !== FTP_TREASURY_UNIT);
      const assets = Math.round(a.reduce((s, p) => s + p.balance, 0) * share);
      const liabilities = Math.round(l.reduce((s, p) => s + p.balance, 0) * share);
      const ftpExpense = Math.round(a.reduce((s, p) => s + p.ftpCharge, 0) * share);
      const ftpIncome = Math.round(l.reduce((s, p) => s + p.ftpCharge, 0) * share);
      return {
        branchKey, assets, liabilities, ftpExpense, ftpIncome,
        clientNii: Math.round([...a, ...l].reduce((s, p) => s + p.clientNii, 0) * share),
        avgAssetFtp: assets ? round2((ftpExpense / assets) * 100) : 0,
        avgLiabFtp: liabilities ? round2((ftpIncome / liabilities) * 100) : 0,
      };
    });
    return delay(rows);
  },

  async updateCurvePoint(currency: FtpCurrency, label: string, rate: number, user: User): Promise<void> {
    assertEdit(user);
    const cur = versionAt(currency, today());
    const point = cur?.points.find((p) => p.label === label);
    if (!cur || !point) throw apiError('CURVE_POINT_NOT_FOUND');
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw apiError('INVALID_RATE');
    if (round2(rate) === point.rate) {
      await delay(null); // без изменений — не пишем в журнал
      return;
    }
    db.log.push({ at: now(), userId: user.id, currency, label, from: point.rate, to: round2(rate) });
    const v = bumpVersion(currency, user, `${label}: ${point.rate} → ${round2(rate)}`, (pts) => pts.map((p) => (p.label === label ? { ...p, rate: round2(rate) } : p)));
    audit.log({ action: 'update', entity: 'ftp_curve', entityId: v.id, entityLabel: `${currency} v${v.version}`, changes: [{ field: label, from: String(point.rate), to: String(round2(rate)) }], user: who(user) });
    emit();
    await delay(null);
  },
  /** Добавить срок в кривую (новая версия). */
  async addTenor(currency: FtpCurrency, label: string, months: number, rate: number, user: User): Promise<void> {
    assertEdit(user);
    const cur = versionAt(currency, today());
    if (!cur) throw apiError('CURVE_NOT_FOUND');
    if (!label.trim() || !(months > 0) || months > 360 || !(rate >= 0 && rate <= 60)) throw new Error('ftp_err_tenor');
    if (cur.points.some((p) => p.label === label.trim() || Math.abs(p.tenorMonths - months) < 1e-6)) throw new Error('ftp_err_tenor_dup');
    const v = bumpVersion(currency, user, `+${label}`, (pts) => [...pts, { label: label.trim(), tenorMonths: months, rate: round2(rate) }].sort((a, b) => a.tenorMonths - b.tenorMonths));
    db.log.push({ at: now(), userId: user.id, currency, label: label.trim(), from: NaN, to: round2(rate) });
    audit.log({ action: 'update', entity: 'ftp_curve', entityId: v.id, entityLabel: `${currency} v${v.version}`, details: `add tenor ${label} (${months}M) ${rate}%`, user: who(user) });
    emit();
    await delay(null);
  },
  async setInterpolation(currency: FtpCurrency, method: FtpInterpolation, user: User): Promise<void> {
    assertEdit(user);
    const cur = versionAt(currency, today());
    if (!cur || cur.interpolation === method) return delay(undefined);
    const v = bumpVersion(currency, user, `interpolation → ${method}`, (pts) => pts, method);
    audit.log({ action: 'settings', entity: 'ftp_curve', entityId: v.id, entityLabel: `${currency} v${v.version}`, changes: [{ field: 'interpolation', from: cur.interpolation, to: method }], user: who(user) });
    emit();
    await delay(null);
  },
  /** Создать кривую для новой валюты на основе кривой USD со спредом (б.п.). */
  async createCurve(currency: FtpCurrency, spreadBp: number, user: User): Promise<FtpCurveVersion> {
    assertEdit(user);
    if (!FTP_CURRENCIES.includes(currency) || currencies().includes(currency)) throw new Error('ftp_err_currency');
    const usd = versionAt('USD', today())!;
    const v: FtpCurveVersion = { id: nextId('fcv'), currency, version: 1, validFrom: today(), points: usd.points.map((p) => ({ ...p, rate: round2(Math.max(0, p.rate + spreadBp / 100)) })), interpolation: 'linear', source: 'manual', status: 'active', note: `USD ${spreadBp >= 0 ? '+' : ''}${spreadBp} б.п.`, createdBy: user.id, createdAt: now() };
    db.versions.push(v);
    audit.log({ action: 'create', entity: 'ftp_curve', entityId: v.id, entityLabel: `${currency} v1`, details: v.note, user: who(user) });
    emit();
    return delay(v);
  },
  /** Автоформирование кривой из источников (ГЦБ, МБК, Bloomberg, Refinitiv) — черновик версии. */
  async buildFromMarket(currency: FtpCurrency, short: 'mbk' | 'bloomberg' | 'refinitiv', long: 'gov' | 'bloomberg' | 'refinitiv', spreadBp: number, validFrom: string, user: User): Promise<FtpCurveVersion> {
    assertEdit(user);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) throw new Error('ftp_err_date');
    const base = versionAt(currency, today()) ?? versionAt('USD', today())!;
    const rec = await integrationHub.call('mktdata', 'curve.build', { currency, short, long, rows: base.points.length }, { userId: user.id });
    if (rec.status !== 'success') throw new Error('ftp_err_market_unavailable');
    const srcAdj: Record<string, number> = { mbk: -0.15, gov: 0.1, bloomberg: 0, refinitiv: 0.05 };
    const pts = base.points.map((p) => ({ ...p, rate: round2(Math.max(0, p.rate + (p.tenorMonths <= 3 ? srcAdj[short]! : srcAdj[long]!) + spreadBp / 100)) }));
    const v: FtpCurveVersion = { id: nextId('fcv'), currency, version: Math.max(0, ...db.versions.filter((x) => x.currency === currency).map((x) => x.version)) + 1, validFrom, points: pts, interpolation: base.interpolation, source: 'market', status: 'draft', note: `${short.toUpperCase()} (O/N–3M) + ${long.toUpperCase()} (6M–10Y), спред ${spreadBp} б.п.`, createdBy: user.id, createdAt: now() };
    db.versions.push(v);
    audit.log({ action: 'create', entity: 'ftp_curve', entityId: v.id, entityLabel: `${currency} v${v.version}`, details: `market build · draft · ${v.note}`, user: who(user) });
    emit();
    return delay(v);
  },
  async activateVersion(id: ID, user: User): Promise<void> {
    assertEdit(user);
    const v = db.versions.find((x) => x.id === id);
    if (!v || v.status !== 'draft') throw new Error('ftp_err_version');
    if (v.createdBy === user.id && !can(user, 'ftp', 'admin')) throw new Error('ftp_err_four_eyes');
    v.status = 'active';
    audit.log({ action: 'approve', entity: 'ftp_curve', entityId: v.id, entityLabel: `${v.currency} v${v.version}`, details: `active from ${v.validFrom}`, user: who(user) });
    emit();
    await delay(null);
  },

  // ----- Методологии -----
  listMethodologies: () => delay(db.methodologies),
  appliedMethodologyId: () => db.applied,
  async setAppliedMethodology(id: ID, user: User): Promise<void> {
    assertEdit(user);
    const m = db.methodologies.find((x) => x.id === id);
    if (!m || !m.versions.some((v) => v.status === 'approved')) throw new Error('ftp_err_not_approved');
    if (db.applied !== id) audit.log({ action: 'settings', entity: 'ftp_methodology', entityId: id, changes: [{ field: 'applied', from: db.applied, to: id }], user: who(user) });
    db.applied = id;
    emit();
    await delay(null);
  },
  async saveMethodologyVersion(input: { methodologyId?: ID; code?: string; name?: string } & Omit<FtpMethodologyVersion, 'version' | 'status' | 'createdBy' | 'createdAt' | 'approvedBy' | 'approvedAt'>, user: User): Promise<FtpMethodology> {
    assertEdit(user);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom)) throw new Error('ftp_err_date');
    if (input.method === 'single_pool' && !Object.values(input.poolRates).some((v) => (v ?? 0) > 0)) throw new Error('ftp_err_pool');
    let m = input.methodologyId ? db.methodologies.find((x) => x.id === input.methodologyId) : undefined;
    if (!m) {
      if (!input.code?.trim() || !input.name?.trim()) throw new Error('ftp_err_methodology');
      m = { id: nextId('fm'), code: input.code.trim().toUpperCase(), name: { ru: input.name.trim(), uz: input.name.trim(), en: input.name.trim() }, versions: [] };
      db.methodologies.push(m);
    }
    const v: FtpMethodologyVersion = { version: (m.versions.at(-1)?.version ?? 0) + 1, validFrom: input.validFrom, method: input.method, poolRates: input.poolRates, includeLp: input.includeLp, includeRegulatory: input.includeRegulatory, applyRules: input.applyRules, status: 'draft', note: input.note, createdBy: user.id, createdAt: now() };
    m.versions.push(v);
    audit.log({ action: 'create', entity: 'ftp_methodology', entityId: m.id, entityLabel: `${m.code} v${v.version}`, details: `${v.method} · from ${v.validFrom} · draft`, user: who(user) });
    emit();
    return delay(m);
  },
  /** Утвердить версию методологии (принцип «четырёх глаз»: утверждает не автор). */
  async approveMethodologyVersion(id: ID, version: number, user: User): Promise<void> {
    assertEdit(user);
    const m = db.methodologies.find((x) => x.id === id);
    const v = m?.versions.find((x) => x.version === version);
    if (!m || !v || v.status !== 'draft') throw new Error('ftp_err_version');
    if (v.createdBy === user.id) throw new Error('ftp_err_four_eyes');
    v.status = 'approved';
    v.approvedBy = user.id;
    v.approvedAt = now();
    audit.log({ action: 'approve', entity: 'ftp_methodology', entityId: m.id, entityLabel: `${m.code} v${v.version}`, details: `from ${v.validFrom}`, user: who(user) });
    emit();
    await delay(null);
  },

  // ----- Регуляторные параметры, HQLA, надбавки -----
  listRegParams: () => delay([...db.reg].sort((a, b) => b.validFrom.localeCompare(a.validFrom))),
  async saveRegParams(input: Omit<FtpRegParams, 'version' | 'createdBy' | 'createdAt'>, user: User): Promise<FtpRegParams> {
    assertEdit(user);
    const bad = [input.reserveRemuneration, input.lcrMin, input.l2Cap, input.hqlaYield, input.inflowCap, ...Object.values(input.runoff), input.haircut.l1, input.haircut.l2a, input.haircut.l2b, ...Object.values(input.reserve).flatMap((r) => [r?.short ?? 0, r?.long ?? 0])].some((v) => !Number.isFinite(v) || v < 0 || v > 200);
    if (bad || !/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom) || !input.note.trim()) throw new Error('ftp_err_reg');
    const prev = regAt(input.validFrom);
    const r: FtpRegParams = { ...clone(input), version: Math.max(...db.reg.map((x) => x.version)) + 1, createdBy: user.id, createdAt: now() };
    db.reg.push(r);
    audit.log({ action: 'settings', entity: 'ftp_regulatory', entityId: `v${r.version}`, changes: diffFields({ reserveUZS: JSON.stringify(prev.reserve.UZS), reserveUSD: JSON.stringify(prev.reserve.USD), runoff: JSON.stringify(prev.runoff), haircut: JSON.stringify(prev.haircut), l2Cap: prev.l2Cap, hqlaYield: prev.hqlaYield }, { reserveUZS: JSON.stringify(r.reserve.UZS), reserveUSD: JSON.stringify(r.reserve.USD), runoff: JSON.stringify(r.runoff), haircut: JSON.stringify(r.haircut), l2Cap: r.l2Cap, hqlaYield: r.hqlaYield }), details: `from ${r.validFrom} · ${r.note}`, user: who(user) });
    emit();
    return delay(r);
  },
  listHqla: () => delay(db.hqla),
  async updateHqla(id: ID, amount: number, user: User): Promise<void> {
    assertEdit(user);
    const h = db.hqla.find((x) => x.id === id);
    if (!h || !(amount >= 0)) throw new Error('ftp_err_amount');
    audit.log({ action: 'update', entity: 'ftp_hqla', entityId: id, changes: [{ field: 'amount', from: String(h.amount), to: String(Math.round(amount)) }], user: who(user) });
    h.amount = Math.round(amount);
    emit();
    await delay(null);
  },
  listLp: () => delay([...db.lp].sort((a, b) => a.tenorMonths - b.tenorMonths)),
  async updateLp(label: string, bp: number, user: User, months?: number): Promise<void> {
    assertEdit(user);
    if (!Number.isFinite(bp) || bp < -200 || bp > 500) throw new Error('ftp_err_lp');
    const pt = db.lp.find((x) => x.label === label);
    if (pt) {
      audit.log({ action: 'settings', entity: 'ftp_lp', entityId: label, changes: [{ field: 'bp', from: String(pt.bp), to: String(Math.round(bp)) }], user: who(user) });
      pt.bp = Math.round(bp);
    } else {
      if (!(months && months > 0)) throw new Error('ftp_err_tenor');
      db.lp.push({ label, tenorMonths: months, bp: Math.round(bp) });
      audit.log({ action: 'create', entity: 'ftp_lp', entityId: label, details: `${months}M ${bp} bp`, user: who(user) });
    }
    emit();
    await delay(null);
  },

  // ----- Правила применения ставок -----
  listRules: () => delay([...db.rules].sort((a, b) => a.priority - b.priority)),
  async saveRule(input: Omit<FtpRateRule, 'id' | 'createdBy' | 'updatedAt'> & { id?: ID }, user: User): Promise<FtpRateRule> {
    assertEdit(user);
    if (!input.name.trim() || !Number.isFinite(input.value) || (input.kind === 'fixed' && (input.value < 0 || input.value > 60)) || (input.kind === 'adjust' && Math.abs(input.value) > 1000)) throw new Error('ftp_err_rule');
    if (input.tenorFrom !== undefined && input.tenorTo !== undefined && input.tenorFrom > input.tenorTo) throw new Error('ftp_err_rule');
    let r = input.id ? db.rules.find((x) => x.id === input.id) : undefined;
    const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
    if (r) {
      const before = clone(r);
      const next = clean({ ...input, id: r.id, createdBy: r.createdBy, updatedAt: now() }) as FtpRateRule;
      for (const k of Object.keys(r) as (keyof FtpRateRule)[]) if (!(k in next)) delete (r as unknown as Record<string, unknown>)[k];
      Object.assign(r, next);
      audit.log({ action: 'update', entity: 'ftp_rule', entityId: r.id, entityLabel: r.name, changes: diffFields(before as unknown as Record<string, unknown>, r as unknown as Record<string, unknown>), user: who(user) });
    } else {
      r = clean({ ...input, id: nextId('frl'), createdBy: user.id, updatedAt: now() }) as FtpRateRule;
      db.rules.push(r);
      audit.log({ action: 'create', entity: 'ftp_rule', entityId: r.id, entityLabel: r.name, user: who(user) });
    }
    emit();
    return delay(r);
  },
  async deleteRule(id: ID, user: User): Promise<void> {
    assertEdit(user);
    const r = db.rules.find((x) => x.id === id);
    db.rules = db.rules.filter((x) => x.id !== id);
    if (r) audit.log({ action: 'delete', entity: 'ftp_rule', entityId: id, entityLabel: r.name, user: who(user) });
    emit();
    await delay(null);
  },

  // ----- Расчёты: расписание, запуск на дату, Re-run с историей -----
  getSchedule: () => delay(db.schedule),
  async updateSchedule(patch: Partial<Pick<FtpSchedule, 'daily' | 'monthly' | 'dailyTime'>>, user: User): Promise<void> {
    assertEdit(user);
    const before = { daily: db.schedule.daily, monthly: db.schedule.monthly, dailyTime: db.schedule.dailyTime };
    if (patch.dailyTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.dailyTime)) throw new Error('ftp_err_date');
    Object.assign(db.schedule, patch, { updatedAt: now(), updatedBy: user.id });
    audit.log({ action: 'settings', entity: 'ftp_schedule', entityId: 'schedule', changes: diffFields(before, { daily: db.schedule.daily, monthly: db.schedule.monthly, dailyTime: db.schedule.dailyTime }), user: who(user) });
    emit();
    await delay(null);
  },
  listRuns: () => {
    if (runScheduled().length) emit();
    return delay([...db.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },
  /** Выполнить наступившие регламентные расчёты (ежедневные/ежемесячные) — вызывается планировщиком приложения. */
  runScheduled: (nowMs?: number) => {
    const created = runScheduled(nowMs);
    if (created.length) emit();
    return delay(created);
  },
  getRun: (id: ID) => delay(db.runs.find((r) => r.id === id)),
  async runAsOf(asOf: string, user: User): Promise<FtpRun> {
    assertEdit(user);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || asOf > today()) throw new Error('ftp_err_date');
    const prev = db.runs.find((r) => r.asOf === asOf && r.status === 'current');
    const r = makeRun(asOf, 'adhoc', user.id, now(), prev ? { rerunOf: prev.id, reason: 'Расчёт на дату' } : {});
    if (prev) prev.status = 'superseded';
    db.runs.push(r);
    audit.log({ action: 'create', entity: 'ftp_run', entityId: r.id, entityLabel: r.number, details: `as of ${asOf} · ${r.methodologyId} v${r.methodologyVersion}`, user: who(user) });
    emit();
    return delay(r);
  },
  /** Повторный запуск (Re-run): новая версия результатов, предыдущая сохраняется в истории. */
  async rerun(id: ID, reason: string, user: User): Promise<FtpRun> {
    assertEdit(user);
    const prev = db.runs.find((r) => r.id === id);
    if (!prev) throw apiError('NOT_FOUND');
    if (reason.trim().length < 5) throw new Error('ftp_err_reason');
    const r = makeRun(prev.asOf, prev.kind, user.id, now(), { rerunOf: prev.id, reason: reason.trim() });
    for (const o of db.runs) if (o.asOf === prev.asOf && o.status === 'current') o.status = 'superseded';
    db.runs.push(r);
    audit.log({ action: 'create', entity: 'ftp_run', entityId: r.id, entityLabel: r.number, details: `re-run of ${prev.number} · ${reason.trim()}`, user: who(user) });
    emit();
    return delay(r);
  },

  // ----- КХД -----
  listKhd: () => delay([...db.khd].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))),
  getKhd: (id: ID) => delay(db.khd.find((b) => b.id === id)),
  /** Принятая версия результатов КХД за период (для управленческой отчётности). */
  acceptedKhd: (period?: string) => delay([...db.khd].filter((b) => b.kind === 'results' && b.status === 'accepted' && (!period || b.period === period)).sort((a, b) => b.period.localeCompare(a.period))[0]),
  async requestKhd(kind: FtpKhdKind, period: string, user: User, faulty = false): Promise<FtpKhdBatch> {
    assertEdit(user);
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('ftp_err_period');
    const rows = buildKhdRows(kind, period, 0, faulty).length;
    const rec = await integrationHub.call('khd', kind === 'results' ? 'ftp.results' : 'ftp.rates', { period, rows }, { userId: user.id, idempotencyKey: `khd-${kind}-${period}-${db.khd.length}` });
    if (rec.status !== 'success') throw new Error('ftp_err_khd_unavailable');
    const b = makeBatch(kind, period, faulty, user.id, now(), rec.id);
    audit.log({ action: 'create', entity: 'ftp_khd', entityId: b.id, entityLabel: b.number, details: `${b.rows.length} rows · ${b.status} · ${b.issues.length} issues`, user: who(user) });
    emit();
    return delay(b);
  },
  async reconcileKhd(id: ID, user: User): Promise<FtpKhdBatch> {
    assertEdit(user);
    const b = db.khd.find((x) => x.id === id);
    if (!b || b.status !== 'validated') throw new Error('ftp_err_khd_state');
    reconcileBatch(b);
    audit.log({ action: 'update', entity: 'ftp_khd', entityId: b.id, entityLabel: b.number, details: `reconcile · matched ${b.recon!.matched}/${b.recon!.diffs.length}`, user: who(user) });
    emit();
    return delay(b);
  },
  async acceptKhd(id: ID, comment: string, user: User): Promise<void> {
    assertEdit(user);
    const b = db.khd.find((x) => x.id === id);
    if (!b || b.status !== 'reconciled') throw new Error('ftp_err_khd_state');
    if (b.recon!.diffs.some((d) => d.flagged) && comment.trim().length < 5) throw new Error('ftp_err_khd_comment');
    acceptBatch(b, user.id, comment.trim() || undefined);
    audit.log({ action: 'approve', entity: 'ftp_khd', entityId: b.id, entityLabel: b.number, details: comment.trim(), user: who(user) });
    emit();
    await delay(null);
  },
  async rejectKhd(id: ID, reason: string, user: User): Promise<void> {
    assertEdit(user);
    const b = db.khd.find((x) => x.id === id);
    if (!b || ['accepted', 'rejected', 'superseded'].includes(b.status)) throw new Error('ftp_err_khd_state');
    if (reason.trim().length < 5) throw new Error('ftp_err_reason');
    b.status = 'rejected';
    b.decidedBy = user.id;
    b.decidedAt = now();
    b.comment = reason.trim();
    audit.log({ action: 'reject', entity: 'ftp_khd', entityId: b.id, entityLabel: b.number, details: reason.trim(), user: who(user) });
    emit();
    await delay(null);
  },
};

export type { ComputeOpts as FtpComputeOpts };
