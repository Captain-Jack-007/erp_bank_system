// P2-FINPLAN: модуль ценообразования / себестоимости продуктов (ТЗ 4.2.16).
//  Себестоимость продукта = прямые расходы (time-based costing: нормы времени × объём × ставка труда + прямые на операцию)
//    + косвенные расходы из модуля аллокации (затраты бизнес-центров → продукты по выбранной базе)
//    + ожидаемые убытки EL = PD × LGD × EAD (импорт из риск-менеджмента / МСФО 9 через КХД или ручной ввод)
//    + стоимость ресурсов FTP (утверждённая методология модуля FTP).
//  Разрезы: продукт, сегмент, канал продаж, филиал (профили расходов ЦБУ с историей SCD-2).
//  Анализ трансфертной маржи: коммерческая и казначейская маржа, Liquidity Effect, Optionality Effect, прибыль казначейства по МВЗ.
import { clone, delay, emit, nextId, now, today } from '../../bus';
import { audit, diffFields } from '../../audit';
import { can, registerModuleAccess } from '../../security';
import { notify } from '../../notifications';
import { orgApi } from '../../org';
import { importRegistry, type ImportIssue, type ImportValue } from '../../services/importer';
import type { ID, User } from '../../types';
import { allocationApi, allocationSplit } from '../allocation';
import { ftpApi, ftpInterpolate } from '../ftp';
import { FL, integrationHub } from '../budgeting/integrationOps';
import { OPA_BRANCH_SHARE, OPA_DEFAULT_TARIFF, OPA_REGION_TARIFF, OPA_VOLUME_GROWTH, opaElInputs, opaProducts, opaSettings, opaTimeStandards, opaVolumes } from './costingData';
import type {
  OpaBreakdownRow,
  OpaCostCategory,
  OpaCostProfile,
  OpaCostingResult,
  OpaElInput,
  OpaMarginRow,
  OpaProductCost,
  OpaSettings,
  OpaTreasuryCcRow,
} from './types';
import { apiError } from '../../errors';

// Права модуля: анализ операций ведёт финансовый департамент; остальные бизнес-роли — просмотр.
registerModuleAccess('operations', { employee: 'view', dept_head: 'view', procurement: 'view', finance: 'edit', legal: 'view', accountant: 'view', treasury: 'view', auditor: 'view', analyst: 'view', approver: 'view' });

const cdb = {
  products: clone(opaProducts),
  volumes: clone(opaVolumes),
  standards: clone(opaTimeStandards),
  settings: clone(opaSettings),
  el: clone(opaElInputs),
  profiles: [] as OpaCostProfile[],
  profilesReady: false,
};

export const OPA_PERIODS = ['2026-Q1', '2026-Q2', '2026-Q3'];
const QEND: Record<string, string> = { Q1: '-03-31', Q2: '-06-30', Q3: '-09-30', Q4: '-12-31' };
const periodEnd = (p: string) => (QEND[p.slice(5)] ? `${p.slice(0, 4)}${QEND[p.slice(5)]}` : today());
const CAT_MAP: Record<string, OpaCostCategory> = { premises: 'rent', it: 'it', operations: 'support', security: 'support', hr: 'general', admin: 'general', corporate: 'general', taxes: 'general', marketing: 'marketing' };
const emptyCats = (): Record<OpaCostCategory, number> => ({ rent: 0, it: 0, support: 0, general: 0, marketing: 0 });
const who = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });
function assertEdit(user: User) {
  if (!can(user, 'operations', 'edit')) throw apiError('FORBIDDEN');
}
const round = Math.round;

// ---------- Профили расходов ЦБУ (динамическая структура, PR-OPA-003) ----------

async function ensureProfiles() {
  if (cdb.profilesReady) return;
  cdb.profilesReady = true;
  const versions = await orgApi.listAllOrgUnitVersions();
  for (const v of versions.filter((x) => x.type === 'branch_office')) {
    if (v.key === 'R09-B04') continue; // новый ЦБУ (открыт 01.03.2026) — профиль создаётся автоматически при проверке структуры
    const region = (v.parentKey ?? `R${v.regionCode}`).slice(1, 3);
    const t = OPA_REGION_TARIFF[region] ?? OPA_DEFAULT_TARIFF;
    cdb.profiles.push({ id: `${v.key}~p${v.version}`, orgUnitKey: v.key, regionCode: region, ...t, validFrom: v.validFrom, validTo: v.validTo, auto: false, note: v.version > 1 ? v.changeReason : 'Тарифы по региону', createdBy: 'system' });
  }
}

function profileAt(orgUnitKey: string, date: string) {
  return cdb.profiles.find((p) => p.orgUnitKey === orgUnitKey && p.validFrom <= date && (p.validTo === null || date <= p.validTo));
}

/** Средний коэффициент стоимости труда региона на дату (по действующим профилям ЦБУ). */
function regionFactor(regionKey: string, date: string): number {
  const ps = cdb.profiles.filter((p) => p.orgUnitKey.startsWith(`${regionKey}-`) && p.validFrom <= date && (p.validTo === null || date <= p.validTo));
  return ps.length ? ps.reduce((s, p) => s + p.laborFactor, 0) / ps.length : (OPA_REGION_TARIFF[regionKey.slice(1)] ?? OPA_DEFAULT_TARIFF).laborFactor;
}

// ---------- Расчёт себестоимости ----------

async function compute(period: string): Promise<OpaCostingResult> {
  const asOf = periodEnd(period);
  const ftp = await ftpApi.compute(0, { asOf });
  const feed = await allocationApi.costingFeed(period);
  const growth = OPA_VOLUME_GROWTH[period] ?? 1;
  const rates = cdb.settings.laborRates;
  const tsFactor = cdb.settings.directMethod === 'timesheet' ? 1.07 : 1; // фактические табели ACMS против норм
  const base = cdb.products.map((p) => {
    const fp = ftp.products.find((x) => x.id === p.id);
    const ops = round((cdb.volumes[p.id] ?? 0) * growth);
    const std = cdb.standards.filter((s) => s.productId === p.id);
    const minutes = std.reduce((s, x) => s + x.minutes, 0) * ops * tsFactor;
    const direct = round(std.reduce((s, x) => s + (x.minutes * tsFactor * ops * rates[x.staff]) / 60, 0) + p.directPerOp * ops);
    const balance = fp?.balance ?? 0;
    const clientIncome = fp ? round(((fp.side === 'asset' ? 1 : -1) * balance * fp.clientRate) / 400) : 0;
    const ftpQ = fp ? round(((fp.side === 'asset' ? -1 : 1) * fp.ftpCharge) / 4) : 0;
    const fees = p.kind === 'service' ? round((p.feePerOp ?? 0) * ops) : 0;
    const el = p.credit ? (() => {
      const e = cdb.el.find((x) => x.productId === p.id);
      return e ? round((balance * e.pd * e.lgd) / 10000 / 4) : 0;
    })() : 0;
    return { p, fp, ops, minutes, direct, balance, clientIncome, ftp: ftpQ, fees, el };
  });
  // Косвенные расходы: затраты бизнес-центров (аллокация) → направление FTP → продукты по выбранной базе.
  const products: OpaProductCost[] = [];
  for (const unitId of [...new Set(cdb.products.map((p) => p.ftpUnitId))]) {
    const members = base.filter((b) => b.p.ftpUnitId === unitId);
    const unitCats = emptyCats();
    for (const u of feed.byUnit.filter((x) => x.ftpUnitId === unitId)) for (const [cat, v] of Object.entries(u.byCategory)) unitCats[CAT_MAP[cat] ?? 'general'] += v;
    const unitTotal = Object.values(unitCats).reduce((a, b) => a + b, 0);
    const balDirect = members.filter((m) => m.balance > 0);
    const ratio = balDirect.reduce((s, m) => s + m.balance, 0) / (balDirect.reduce((s, m) => s + m.direct, 0) || 1);
    const w = members.map((m) => (cdb.settings.indirectBasis === 'operations' ? m.ops : cdb.settings.indirectBasis === 'time' ? m.minutes : m.balance > 0 ? m.balance : m.direct * ratio));
    // P3: распределение каждой категории методом наибольших остатков — Σ по продуктам = сумме аллокации без потерь
    const splits = Object.fromEntries(Object.entries(unitCats).map(([c, v]) => [c, allocationSplit(round(v), w.some((x) => x > 0) ? w : w.map(() => 1))])) as Record<OpaCostCategory, number[]>;
    members.forEach((m, i) => {
      const indirectBy = Object.fromEntries(Object.entries(splits).map(([c, parts]) => [c, parts[i]!])) as Record<OpaCostCategory, number>;
      const indirect = Object.values(indirectBy).reduce((a, b) => a + b, 0);
      const netInterest = m.clientIncome + m.ftp;
      const ftpCost = Math.max(0, -m.ftp);
      const cost = m.direct + indirect + m.el + ftpCost;
      const profit = netInterest + m.fees - m.direct - indirect - m.el;
      const revenue = m.fp ? (m.fp.side === 'asset' ? m.clientIncome : m.ftp) : m.fees;
      products.push({
        productId: m.p.id, name: m.p.name, kind: m.p.kind, segment: m.p.segment, ftpUnitId: unitId, ...(m.fp ? { side: m.fp.side, currency: m.fp.currency } : {}),
        balance: m.balance, operations: m.ops, minutes: round(m.minutes), clientIncome: m.clientIncome, ftp: m.ftp, netInterest, fees: m.fees,
        direct: m.direct, indirect, indirectBy, el: m.el, cost, profit, marginPct: revenue ? Math.round((profit / Math.abs(revenue)) * 1000) / 10 : 0,
        costPerOp: m.ops ? round((m.direct + indirect + m.el) / m.ops) : 0,
      });
    });
    void unitTotal;
  }
  const sum = (f: (x: OpaProductCost) => number) => products.reduce((s, x) => s + f(x), 0);
  const meth = (await ftpApi.listMethodologies()).find((m) => m.id === ftp.methodologyId);
  return {
    period, allocationSource: feed.source, ...(feed.runNumber ? { allocationRun: feed.runNumber } : {}),
    methodology: `${meth?.code ?? ftp.methodologyId} v${ftp.methodologyVersion}`, basis: cdb.settings.indirectBasis, products,
    totals: { treasury: Math.round(ftp.bank.fundingNii / 4), revenue: sum((x) => (x.side === 'asset' ? x.clientIncome : x.side === 'liability' ? x.ftp : x.fees)), ftp: sum((x) => x.ftp), direct: sum((x) => x.direct), indirect: sum((x) => x.indirect), el: sum((x) => x.el), profit: sum((x) => x.profit), allocated: feed.total },
  };
}

function rowOf(key: string, items: { revenue: number; direct: number; indirect: number; el: number; ftp: number; profit: number }[]): OpaBreakdownRow {
  const s = (f: (x: (typeof items)[number]) => number) => round(items.reduce((a, x) => a + f(x), 0));
  return { key, revenue: s((x) => x.revenue), direct: s((x) => x.direct), indirect: s((x) => x.indirect), el: s((x) => x.el), ftp: s((x) => x.ftp), profit: s((x) => x.profit) };
}

const revenueOf = (x: OpaProductCost) => (x.side === 'asset' ? x.clientIncome : x.side === 'liability' ? x.ftp : x.fees);

// ---------- Импорт EL ----------

importRegistry.register({
  id: 'operations_el',
  name: FL('Себестоимость: ожидаемые убытки (EL)', 'Tannarx: kutilayotgan zararlar (EL)', 'Costing: expected loss (EL)'),
  description: FL('PD, LGD и резервы по кредитным продуктам из системы риск-менеджмента / МСФО 9 (Excel/CSV)', 'Risk-menejment / MHXS 9 tizimidan kredit mahsulotlari bo‘yicha PD, LGD va zaxiralar (Excel/CSV)', 'PD, LGD and provisions for credit products from the risk system / IFRS 9 (Excel/CSV)'),
  fields: [
    { key: 'product', label: FL('Код продукта', 'Mahsulot kodi', 'Product code'), type: 'string', required: true, sample: 'fp2' },
    { key: 'pd', label: FL('PD, %', 'PD, %', 'PD, %'), type: 'number', required: true, min: 0, max: 100, sample: '4.8' },
    { key: 'lgd', label: FL('LGD, %', 'LGD, %', 'LGD, %'), type: 'number', required: true, min: 0, max: 100, sample: '55' },
    { key: 'reserve', label: FL('Резерв, сум', 'Zaxira, so‘m', 'Provision, UZS'), type: 'number', min: 0, sample: '241000000000' },
  ],
  keyField: 'product',
  existingKeys: async () => cdb.el.map((e) => e.productId),
  async extraValidate(rows) {
    return rows.map((r): ImportIssue[] => (cdb.products.some((p) => p.id === String(r.product) && p.credit) ? [] : [{ field: 'product', code: 'reference', value: String(r.product ?? ''), severity: 'error' }]));
  },
  async commit(rows: Record<string, ImportValue>[], user: User) {
    assertEdit(user);
    let created = 0;
    let updated = 0;
    for (const r of rows) {
      const id = String(r.product);
      const ex = cdb.el.find((e) => e.productId === id);
      const next: OpaElInput = { productId: id, pd: Number(r.pd), lgd: Number(r.lgd), reserve: Number(r.reserve ?? ex?.reserve ?? 0), source: 'import', period: '2026-09', updatedAt: now(), updatedBy: user.id, reason: 'Excel/CSV' };
      if (ex) (Object.assign(ex, next), updated++);
      else (cdb.el.push(next), created++);
    }
    audit.log({ action: 'update', entity: 'operations_el', entityId: 'import', details: `EL import · ${rows.length}`, user: who(user) });
    emit();
    return { created, updated, skipped: 0 };
  },
});

// ---------- Публичный API ----------

export const operationsCostingApi = {
  periods: OPA_PERIODS,
  compute: (period: string) => compute(period).then((r) => delay(r)),
  async breakdown(period: string, by: 'segment' | 'channel' | 'branch'): Promise<OpaBreakdownRow[]> {
    await ensureProfiles();
    const r = await compute(period);
    const items = r.products.map((x) => ({ x, revenue: revenueOf(x), direct: x.direct, indirect: x.indirect, el: x.el, ftp: x.ftp, profit: x.profit }));
    if (by === 'segment') {
      return delay([...new Set(items.map((i) => i.x.segment))].map((s) => rowOf(s, items.filter((i) => i.x.segment === s))));
    }
    if (by === 'channel') {
      const keys = ['branch', 'internet', 'mobile', 'agent', 'call_center'];
      return delay(keys.map((k) => rowOf(k, items.map((i) => {
        const sh = cdb.products.find((p) => p.id === i.x.productId)?.channels[k] ?? 0;
        return { revenue: i.revenue * sh, direct: i.direct * sh, indirect: i.indirect * sh, el: i.el * sh, ftp: i.ftp * sh, profit: i.profit * sh };
      }))).filter((row) => row.revenue || row.direct));
    }
    // Филиалы: объёмы сети по регионам; прямые расходы — с коэффициентом стоимости труда по профилям ЦБУ на дату периода.
    const date = periodEnd(period);
    const network = items.filter((i) => i.x.segment !== 'treasury');
    return delay(Object.entries(OPA_BRANCH_SHARE).map(([rk, sh]) => {
      const f = regionFactor(rk, date);
      return rowOf(rk, network.map((i) => {
        const direct = i.direct * sh * f;
        return { revenue: i.revenue * sh, direct, indirect: i.indirect * sh, el: i.el * sh, ftp: i.ftp * sh, profit: (i.revenue + (i.x.side === 'asset' ? i.ftp : 0)) * sh - direct - i.indirect * sh - i.el * sh };
      }));
    }));
  },

  /** Анализ трансфертной маржи (годовой): коммерческая, казначейская, Liquidity Effect, Optionality Effect. */
  async margins(period: string): Promise<OpaMarginRow[]> {
    const asOf = periodEnd(period);
    const res = await ftpApi.compute(0, { asOf });
    const sp = (await ftpApi.listMethodologies()).find((m) => m.id === 'sp')?.versions.find((v) => v.status === 'approved');
    const curves = await ftpApi.listCurves(asOf);
    return delay(res.products.map((p) => {
      const pool = sp?.poolRates[p.currency] ?? p.curveRate;
      const total = round(((p.side === 'asset' ? p.clientRate - pool : pool - p.clientRate) * p.balance) / 100);
      const curve = curves.find((c) => c.currency === p.currency);
      const half = curve ? ftpInterpolate(curve, Math.max(1, p.tenorMonths / 2)) : p.curveRate;
      const optionality = p.side === 'asset' && p.prepaymentPct ? round((p.balance * (p.prepaymentPct / 100) * Math.max(0, p.curveRate - half)) / 100) : 0;
      const liquidity = round(((p.side === 'asset' ? 1 : -1) * p.balance * p.lp) / 100);
      const commercial = p.clientNii - optionality;
      return { productId: p.id, name: p.name, side: p.side, currency: p.currency, balance: p.balance, commercial, liquidity, optionality, treasury: total - commercial - liquidity - optionality, total };
    }));
  },

  /** Прибыль казначейства в разрезе МВЗ: книга UZS, валютная книга, управление ликвидностью. */
  async treasuryByCostCenter(period: string): Promise<OpaTreasuryCcRow[]> {
    const m = await operationsCostingApi.margins(period);
    const ccs = (await orgApi.listCostCenters({ orgUnitKey: 'd8', status: 'active', pageSize: 10, sort: 'code' })).rows;
    const books: { book: OpaTreasuryCcRow['book']; profit: number }[] = [
      { book: 'uzs', profit: m.filter((x) => x.currency === 'UZS').reduce((s, x) => s + x.treasury, 0) },
      { book: 'fx', profit: m.filter((x) => x.currency !== 'UZS').reduce((s, x) => s + x.treasury, 0) },
      { book: 'liquidity', profit: m.reduce((s, x) => s + x.liquidity + x.optionality, 0) },
    ];
    return delay(books.map((b, i) => {
      const cc = ccs[i] ?? ccs[0];
      return { costCenterKey: cc?.key ?? 'd8', code: cc?.code ?? 'TRS', name: cc?.name ?? { ru: 'Казначейство', uz: "G'aznachilik" }, book: b.book, profit: b.profit };
    }));
  },

  listProducts: () => delay(cdb.products),
  listStandards: () => delay(cdb.standards),
  async updateStandard(productId: ID, index: number, minutes: number, user: User): Promise<void> {
    assertEdit(user);
    const list = cdb.standards.filter((s) => s.productId === productId);
    const s = list[index];
    if (!s || !(minutes > 0) || minutes > 10_000) throw new Error('operations_err_minutes');
    audit.log({ action: 'update', entity: 'operations_standard', entityId: productId, entityLabel: s.activity.ru, changes: [{ field: 'minutes', from: String(s.minutes), to: String(minutes) }], user: who(user) });
    s.minutes = minutes;
    emit();
    await delay(null);
  },
  getSettings: () => delay(cdb.settings),
  async updateSettings(patch: Partial<Pick<OpaSettings, 'indirectBasis' | 'directMethod' | 'laborRates'>>, user: User): Promise<void> {
    assertEdit(user);
    if (patch.laborRates && Object.values(patch.laborRates).some((v) => !(v > 0))) throw new Error('operations_err_rate');
    const before = { basis: cdb.settings.indirectBasis, direct: cdb.settings.directMethod, rates: JSON.stringify(cdb.settings.laborRates) };
    Object.assign(cdb.settings, patch, { updatedAt: now(), updatedBy: user.id });
    const changes = diffFields(before, { basis: cdb.settings.indirectBasis, direct: cdb.settings.directMethod, rates: JSON.stringify(cdb.settings.laborRates) });
    if (changes.length) audit.log({ action: 'settings', entity: 'operations_costing', entityId: 'settings', changes, user: who(user) });
    emit();
    await delay(null);
  },

  listEl: () => delay(cdb.el),
  async setEl(productId: ID, pd: number, lgd: number, reason: string, user: User): Promise<void> {
    assertEdit(user);
    const e = cdb.el.find((x) => x.productId === productId);
    if (!e || !(pd >= 0 && pd <= 100) || !(lgd >= 0 && lgd <= 100)) throw new Error('operations_err_el');
    if (reason.trim().length < 5) throw new Error('operations_err_reason');
    audit.log({ action: 'update', entity: 'operations_el', entityId: productId, changes: diffFields({ pd: e.pd, lgd: e.lgd }, { pd, lgd }), details: `manual · ${reason.trim()}`, user: who(user) });
    Object.assign(e, { pd, lgd, source: 'manual', updatedAt: now(), updatedBy: user.id, reason: reason.trim() });
    emit();
    await delay(null);
  },
  /** Автоматический импорт EL из системы риск-менеджмента / модуля МСФО 9 (через КХД). */
  async importEl(period: string, user: User): Promise<number> {
    assertEdit(user);
    const rec = await integrationHub.call('khd', 'risk.el', { period, rows: cdb.el.length }, { userId: user.id, idempotencyKey: `el-${period}-${Date.now()}` });
    if (rec.status !== 'success') throw new Error('operations_err_el_unavailable');
    let n = 0;
    for (const e of cdb.el) {
      const h = [...`${e.productId}${period}`].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 997, 7);
      const pd = Math.round(e.pd * (0.94 + (h % 13) / 100) * 100) / 100;
      if (pd !== e.pd) n++;
      Object.assign(e, { pd, source: 'import', period, updatedAt: now(), updatedBy: user.id, reason: `КХД risk.el ${rec.id}` });
    }
    audit.log({ action: 'update', entity: 'operations_el', entityId: period, details: `import risk.el · ${n} changed`, user: who(user) });
    emit();
    return delay(n);
  },

  async listProfiles(): Promise<OpaCostProfile[]> {
    await ensureProfiles();
    return delay([...cdb.profiles].sort((a, b) => a.orgUnitKey.localeCompare(b.orgUnitKey) || a.validFrom.localeCompare(b.validFrom)));
  },
  /** Проверка структуры: новым ЦБУ/филиалам автоматически назначаются действующие тарифы (новый профиль расходов). */
  async scanStructure(user: User): Promise<OpaCostProfile[]> {
    assertEdit(user);
    await ensureProfiles();
    const units = await orgApi.listOrgUnits();
    const created: OpaCostProfile[] = [];
    for (const u of units.filter((x) => x.type === 'branch_office')) {
      if (profileAt(u.key, today())) continue;
      const region = (u.parentKey ?? `R${u.regionCode}`).slice(1, 3);
      const t = OPA_REGION_TARIFF[region] ?? OPA_DEFAULT_TARIFF;
      const p: OpaCostProfile = { id: `${u.key}~p${nextId('')}`, orgUnitKey: u.key, regionCode: region, ...t, validFrom: u.validFrom, validTo: null, auto: true, note: 'Создан автоматически: действующие тарифы региона', createdBy: user.id };
      cdb.profiles.push(p);
      created.push(p);
      audit.log({ action: 'create', entity: 'operations_profile', entityId: p.id, entityLabel: u.code, details: `${p.tariff} · ×${p.laborFactor}`, user: who(user) });
    }
    if (created.length) notify({ roles: ['finance'], title: FL(`Профили расходов созданы для новых ЦБУ: ${created.length}`, `Yangi BXMlar uchun xarajat profillari yaratildi: ${created.length}`, `Cost profiles created for new offices: ${created.length}`), link: '/operations?tab=structure', level: 'info', kind: 'system' });
    emit();
    return delay(created);
  },
  /** Изменение тарифа ЦБУ: старая версия закрывается датой накануне, новая действует с сегодняшнего дня (история сохраняется). */
  async updateProfile(orgUnitKey: string, patch: { tariff?: OpaCostProfile['tariff']; laborFactor?: number; rentPerSqm?: number }, user: User): Promise<void> {
    assertEdit(user);
    await ensureProfiles();
    const cur = profileAt(orgUnitKey, today());
    if (!cur) throw new Error('operations_err_profile');
    if ((patch.laborFactor !== undefined && !(patch.laborFactor > 0 && patch.laborFactor < 3)) || (patch.rentPerSqm !== undefined && !(patch.rentPerSqm > 0))) throw new Error('operations_err_profile');
    const d = today();
    const prev = new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const next: OpaCostProfile = { ...cur, ...patch, id: `${orgUnitKey}~p${nextId('')}`, validFrom: d, validTo: null, auto: false, note: 'Изменение тарифа', createdBy: user.id };
    if (cur.validFrom === d) Object.assign(cur, patch);
    else {
      cur.validTo = prev;
      cdb.profiles.push(next);
    }
    audit.log({ action: 'update', entity: 'operations_profile', entityId: orgUnitKey, changes: diffFields({ tariff: cur.tariff, laborFactor: cur.laborFactor, rentPerSqm: cur.rentPerSqm }, { tariff: next.tariff, laborFactor: next.laborFactor, rentPerSqm: next.rentPerSqm }), user: who(user) });
    emit();
    await delay(null);
  },
};
