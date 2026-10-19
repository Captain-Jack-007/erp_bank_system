// Демо-данные модуля «Аллокация» (вымышленные).
import type { AllocationCenter, AllocationDriver, AllocationDriverDef, AllocationMapping, AllocationPool, AllocationRule, AllocationScenario, AllocationSettings, AllocationUnit } from './types';

export const allocationPeriods = ['2026-Q1', '2026-Q2', '2026-Q3'];

/** Административные и обслуживающие центры ответственности (PR-ALC-005…007). */
export const allocationServiceCenters: AllocationCenter[] = [
  { id: 'ad_board', code: 'ADM-BOARD', name: { ru: 'Правление и аппарат управления', uz: 'Boshqaruv va boshqaruv apparati', en: 'Management Board and HQ office' }, type: 'admin', departmentId: 'd2' },
  { id: 'ad_hr', code: 'ADM-HR', name: { ru: 'Департамент персонала (HR)', uz: 'Xodimlar departamenti (HR)', en: 'Human Resources (HR)' }, type: 'admin', departmentId: 'd6' },
  { id: 'sc_it', code: 'SRV-IT', name: { ru: 'Информационные технологии', uz: 'Axborot texnologiyalari', en: 'Information technology' }, type: 'service', departmentId: 'd1' },
  { id: 'sc_sec', code: 'SRV-SEC', name: { ru: 'Служба безопасности', uz: 'Xavfsizlik xizmati', en: 'Security' }, type: 'service', departmentId: 'd2' },
  { id: 'sc_mkt', code: 'SRV-MKT', name: { ru: 'Маркетинг', uz: 'Marketing', en: 'Marketing' }, type: 'service', departmentId: 'd9' },
  { id: 'sc_fac', code: 'SRV-FAC', name: { ru: 'АХД и содержание помещений', uz: "MXD va binolarni saqlash", en: 'Facilities and premises' }, type: 'service', departmentId: 'd2' },
  { id: 'sc_ops', code: 'SRV-OPS', name: { ru: 'Операционный центр (бэк-офис)', uz: 'Operatsion markaz (bek-ofis)', en: 'Operations centre (back office)' }, type: 'service', departmentId: 'd7' },
];

export const allocationPools: AllocationPool[] = [
  { id: 'ap1', code: 'POOL-IT', name: { ru: 'ИТ-инфраструктура и сопровождение', uz: 'AT infratuzilmasi va xizmati', en: 'IT infrastructure and support' }, departmentId: 'd1', centerId: 'sc_it', category: 'it' },
  { id: 'ap2', code: 'POOL-HR', name: { ru: 'Управление персоналом', uz: 'Xodimlarni boshqarish', en: 'Human resources management' }, departmentId: 'd6', centerId: 'ad_hr', category: 'hr' },
  { id: 'ap3', code: 'POOL-ADM', name: { ru: 'Административные расходы', uz: "Ma'muriy xarajatlar", en: 'Administrative expenses' }, departmentId: 'd2', centerId: 'ad_board', category: 'admin' },
  { id: 'ap4', code: 'POOL-PREM', name: { ru: 'Содержание помещений', uz: 'Binolarni saqlash', en: 'Premises maintenance' }, departmentId: 'd2', centerId: 'sc_fac', category: 'premises' },
  { id: 'ap5', code: 'POOL-OPS', name: { ru: 'Операционный центр (бэк-офис)', uz: 'Operatsion markaz (bek-ofis)', en: 'Operations centre (back office)' }, departmentId: 'd7', centerId: 'sc_ops', category: 'operations' },
  { id: 'ap6', code: 'POOL-SEC', name: { ru: 'Безопасность и охрана', uz: "Xavfsizlik va qo'riqlash", en: 'Security and guarding' }, departmentId: 'd2', centerId: 'sc_sec', category: 'security' },
  { id: 'ap7', code: 'POOL-MKT', name: { ru: 'Маркетинг и бренд', uz: 'Marketing va brend', en: 'Marketing and brand' }, departmentId: 'd9', centerId: 'sc_mkt', category: 'marketing' },
  { id: 'ap8', code: 'POOL-CORP', name: { ru: 'Корпоративные расходы (органы управления, спонсорство)', uz: 'Korporativ xarajatlar (boshqaruv organlari, homiylik)', en: 'Corporate expenses (governing bodies, sponsorship)' }, departmentId: 'd2', centerId: 'ad_board', category: 'corporate' },
  { id: 'ap9', code: 'POOL-TAX', name: { ru: 'Налоги (имущество, земля, прочие)', uz: 'Soliqlar (mol-mulk, yer, boshqalar)', en: 'Taxes (property, land, other)' }, departmentId: 'd7', centerId: 'ad_board', category: 'taxes' },
];

const B = 1_000_000_000;
/** Сумма косвенных затрат пула за период, UZS (собирается с бухгалтерских счетов iABS). */
export const allocationPoolAmounts: Record<string, Record<string, number>> = {
  '2026-Q1': { ap1: 86_400_000_000, ap2: 14_200_000_000, ap3: 31_800_000_000, ap4: 58_600_000_000, ap5: 42_300_000_000, ap6: 9.8 * B, ap7: 18.4 * B, ap8: 12.5 * B, ap9: 7.2 * B },
  '2026-Q2': { ap1: 91_700_000_000, ap2: 15_100_000_000, ap3: 33_400_000_000, ap4: 59_900_000_000, ap5: 44_800_000_000, ap6: 10.2 * B, ap7: 21 * B, ap8: 11.9 * B, ap9: 7.4 * B },
  '2026-Q3': { ap1: 97_250_000_000, ap2: 15_650_000_000, ap3: 34_100_000_000, ap4: 61_300_000_000, ap5: 47_900_000_000, ap6: 10.6 * B, ap7: 24.3 * B, ap8: 13.4 * B, ap9: 7.6 * B },
};

/** Библиотека драйверов (PR-ALC-009…014, PR-ALC-018). */
export const allocationDriverDefs: AllocationDriverDef[] = [
  { id: 'headcount', code: 'FTE', name: { ru: 'Численность, чел.', uz: 'Xodimlar soni', en: 'Headcount, FTE' }, unit: 'FTE', source: 'hr', system: true },
  { id: 'area', code: 'SQM', name: { ru: 'Площадь, м²', uz: 'Maydon, m²', en: 'Floor area, m²' }, unit: 'm²', source: 'assets', system: true },
  { id: 'transactions', code: 'TRN', name: { ru: 'Количество транзакций', uz: 'Tranzaksiyalar soni', en: 'Number of transactions' }, unit: 'шт.', source: 'abs', system: true },
  { id: 'revenue', code: 'REV', name: { ru: 'Операционный доход', uz: 'Operatsion daromad', en: 'Operating income' }, unit: 'UZS', source: 'profit', system: true },
  { id: 'timesheets', code: 'TMS', name: { ru: 'Время по табелям, ч', uz: 'Tabel bo‘yicha vaqt, soat', en: 'Timesheet hours' }, unit: 'h', source: 'timesheets', system: true },
  { id: 'loans', code: 'LNS', name: { ru: 'Кредитный портфель', uz: 'Kredit portfeli', en: 'Loan portfolio' }, unit: 'UZS', source: 'portfolio', system: true },
  { id: 'deposits', code: 'DEP', name: { ru: 'Депозитный портфель', uz: 'Depozit portfeli', en: 'Deposit portfolio' }, unit: 'UZS', source: 'portfolio', system: true },
  { id: 'npl', code: 'NPL', name: { ru: 'Проблемные кредиты (NPL)', uz: 'Muammoli kreditlar (NPL)', en: 'Non-performing loans (NPL)' }, unit: 'UZS', source: 'portfolio', system: true },
  { id: 'profit', code: 'PRF', name: { ru: 'Доходность (прибыль до распределения)', uz: 'Daromadlilik (taqsimlashgacha foyda)', en: 'Profitability (pre-allocation profit)' }, unit: 'UZS', source: 'profit', system: true },
  { id: 'assets_volume', code: 'AST', name: { ru: 'Объём активов', uz: 'Aktivlar hajmi', en: 'Total assets' }, unit: 'UZS', source: 'portfolio', system: true },
  { id: 'it_mix', code: 'IT-MIX', name: { ru: 'ИТ-нагрузка (формула)', uz: 'AT yuklamasi (formula)', en: 'IT load (formula)' }, unit: 'idx', source: 'formula', formula: 'transactions / 1000 + headcount * 2', system: false, createdBy: 'u4', updatedAt: '2026-06-02T09:00:00Z' },
];

type DV = Record<AllocationDriver, number>;
const T = 1_000_000_000_000;
function dv(headcount: number, area: number, transactions: number, revenue: number, extra: Partial<DV> = {}): DV {
  return { headcount, area, transactions, revenue, timesheets: Math.round(headcount * 480), loans: 0, deposits: 0, npl: 0, profit: Math.round(revenue * 0.42), assets_volume: 0, ...extra };
}

/** Бизнес-центры (центры прибыли): направления, филиальная сеть, каналы продаж (PR-ALC-008). */
export const allocationUnits: AllocationUnit[] = [
  {
    id: 'au1', code: 'RET', name: { ru: 'Розничный бизнес', uz: 'Chakana biznes', en: 'Retail banking' }, type: 'business', kind: 'line', departmentId: 'd9', ftpUnitId: 'fu1',
    drivers: {
      '2026-Q1': dv(3_850, 41_200, 18_400_000, 612 * B, { loans: 9.2 * T, deposits: 12.1 * T, npl: 0.46 * T, assets_volume: 10.4 * T }),
      '2026-Q2': dv(3_910, 41_200, 19_900_000, 655 * B, { loans: 9.6 * T, deposits: 12.6 * T, npl: 0.48 * T, assets_volume: 10.9 * T }),
      '2026-Q3': dv(3_960, 42_100, 21_300_000, 701 * B, { loans: 10.1 * T, deposits: 13.2 * T, npl: 0.51 * T, assets_volume: 11.4 * T }),
    },
  },
  {
    id: 'au2', code: 'CORP', name: { ru: 'Корпоративный бизнес', uz: 'Korporativ biznes', en: 'Corporate banking' }, type: 'business', kind: 'line', departmentId: 'd10', ftpUnitId: 'fu2',
    drivers: {
      '2026-Q1': dv(1_120, 12_600, 2_100_000, 948 * B, { loans: 31.2 * T, deposits: 17.6 * T, npl: 1.4 * T, assets_volume: 32.6 * T }),
      '2026-Q2': dv(1_135, 12_600, 2_250_000, 991 * B, { loans: 32.1 * T, deposits: 18.2 * T, npl: 1.45 * T, assets_volume: 33.5 * T }),
      '2026-Q3': dv(1_150, 12_600, 2_380_000, 1_032 * B, { loans: 33.0 * T, deposits: 18.8 * T, npl: 1.5 * T, assets_volume: 34.5 * T }),
    },
  },
  {
    id: 'au3', code: 'TRS', name: { ru: 'Казначейство', uz: "G'aznachilik", en: 'Treasury' }, type: 'business', kind: 'line', departmentId: 'd8', ftpUnitId: 'fu3',
    drivers: {
      '2026-Q1': dv(140, 1_900, 96_000, 287 * B, { assets_volume: 4.6 * T, deposits: 14.2 * T }),
      '2026-Q2': dv(142, 1_900, 102_000, 301 * B, { assets_volume: 4.7 * T, deposits: 14.6 * T }),
      '2026-Q3': dv(145, 1_900, 108_000, 318 * B, { assets_volume: 4.85 * T, deposits: 14.9 * T }),
    },
  },
  {
    id: 'au4', code: 'REG-TAS', name: { ru: 'Региональная сеть — Ташкент', uz: 'Hududiy tarmoq — Toshkent', en: 'Regional network — Tashkent' }, type: 'business', kind: 'branch', orgUnitKey: 'R01', ftpUnitId: 'fu1',
    drivers: {
      '2026-Q1': dv(2_240, 27_800, 9_800_000, 205 * B, { loans: 2.9 * T, deposits: 3.6 * T, npl: 0.13 * T, assets_volume: 3.1 * T }),
      '2026-Q2': dv(2_260, 27_800, 10_400_000, 218 * B, { loans: 3.0 * T, deposits: 3.7 * T, npl: 0.14 * T, assets_volume: 3.2 * T }),
      '2026-Q3': dv(2_290, 28_400, 11_100_000, 229 * B, { loans: 3.1 * T, deposits: 3.9 * T, npl: 0.15 * T, assets_volume: 3.35 * T }),
    },
  },
  {
    id: 'au5', code: 'REG-SAM', name: { ru: 'Региональная сеть — Самарканд и Бухара', uz: 'Hududiy tarmoq — Samarqand va Buxoro', en: 'Regional network — Samarkand and Bukhara' }, type: 'business', kind: 'branch', orgUnitKey: 'R09', ftpUnitId: 'fu1',
    drivers: {
      '2026-Q1': dv(1_680, 22_300, 6_200_000, 118 * B, { loans: 1.7 * T, deposits: 1.9 * T, npl: 0.09 * T, assets_volume: 1.8 * T }),
      '2026-Q2': dv(1_700, 22_300, 6_700_000, 126 * B, { loans: 1.8 * T, deposits: 2.0 * T, npl: 0.1 * T, assets_volume: 1.9 * T }),
      '2026-Q3': dv(1_720, 22_300, 7_100_000, 133 * B, { loans: 1.85 * T, deposits: 2.1 * T, npl: 0.11 * T, assets_volume: 1.95 * T }),
    },
  },
  {
    id: 'au6', code: 'REG-FER', name: { ru: 'Региональная сеть — Ферганская долина', uz: "Hududiy tarmoq — Farg'ona vodiysi", en: 'Regional network — Fergana Valley' }, type: 'business', kind: 'branch', orgUnitKey: 'R12', ftpUnitId: 'fu1',
    drivers: {
      '2026-Q1': dv(1_910, 24_700, 7_400_000, 131 * B, { loans: 1.9 * T, deposits: 2.2 * T, npl: 0.12 * T, assets_volume: 2.0 * T }),
      '2026-Q2': dv(1_930, 24_700, 7_900_000, 139 * B, { loans: 2.0 * T, deposits: 2.3 * T, npl: 0.13 * T, assets_volume: 2.1 * T }),
      '2026-Q3': dv(1_960, 25_300, 8_400_000, 147 * B, { loans: 2.1 * T, deposits: 2.4 * T, npl: 0.14 * T, assets_volume: 2.2 * T }),
    },
  },
];

/** Значения драйверов обслуживающих/административных центров (потребление услуг друг друга для step-down и взаимного метода). */
const svc = (headcount: number, area: number, transactions: number): DV => dv(headcount, area, transactions, 0, { profit: 0 });
export const allocationServiceDrivers: Record<string, Record<string, DV>> = Object.fromEntries(
  allocationPeriods.map((p, i) => [
    p,
    {
      ad_board: svc(310 + i * 4, 6_400, 210_000 + i * 9_000),
      ad_hr: svc(96, 1_350, 64_000 + i * 2_000),
      sc_it: svc(420 + i * 12, 5_900, 1_150_000 + i * 60_000),
      sc_sec: svc(260, 2_100, 88_000),
      sc_mkt: svc(74 + i * 3, 900, 52_000),
      sc_fac: svc(380, 3_800, 140_000),
      sc_ops: svc(640 + i * 10, 7_200, 2_400_000 + i * 120_000),
    },
  ]),
);

export const allocationRules: AllocationRule[] = [
  { poolId: 'ap1', driver: 'transactions', updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { poolId: 'ap2', driver: 'headcount', updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { poolId: 'ap3', driver: 'revenue', updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { poolId: 'ap4', driver: 'area', updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { poolId: 'ap5', driver: 'transactions', updatedAt: '2026-04-05T09:00:00Z', updatedBy: 'u4' },
  { poolId: 'ap6', driver: 'area', updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { poolId: 'ap7', driver: 'revenue', updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { poolId: 'ap8', driver: 'profit', updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { poolId: 'ap9', driver: 'assets_volume', updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
];

export const allocationSettings: AllocationSettings = {
  method: 'direct',
  chain: ['ad_board', 'ad_hr', 'sc_it', 'sc_sec', 'sc_fac', 'sc_mkt', 'sc_ops'],
  updatedAt: '2026-01-10T09:00:00Z',
  updatedBy: 'u4',
  version: 1,
};

/** Связь драйверов с источниками (PR-ALC-019). */
export const allocationMapping: AllocationMapping[] = [
  { driverId: 'headcount', system: 'laborlaw', operation: 'hr.fte', field: 'fte', centerKeys: { au1: 'ORG-d9', au2: 'ORG-d10', au3: 'ORG-d8', au4: 'ORG-R01', au5: 'ORG-R09', au6: 'ORG-R12' }, updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { driverId: 'area', system: 'assets', operation: 'module:assets', field: 'buildings.area', centerKeys: { au1: 'd9', au2: 'd10', au3: 'd8', au4: 'R01', au5: 'R09', au6: 'R12' }, updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { driverId: 'transactions', system: 'iabs', operation: 'transactions.stats', field: 'count', centerKeys: { au1: 'SEG-RET', au2: 'SEG-CORP', au3: 'SEG-TRS', au4: 'BR-01', au5: 'BR-09', au6: 'BR-12' }, updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { driverId: 'timesheets', system: 'acms', operation: 'timesheet.aggregate', field: 'hours', centerKeys: { au1: 'd9', au2: 'd10', au3: 'd8', au4: 'R01', au5: 'R09', au6: 'R12' }, updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { driverId: 'loans', system: 'ftp', operation: 'module:ftp', field: 'assets.balance', centerKeys: { au1: 'fu1', au2: 'fu2', au3: 'fu3', au4: 'fu1', au5: 'fu1', au6: 'fu1' }, updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { driverId: 'deposits', system: 'ftp', operation: 'module:ftp', field: 'liabilities.balance', centerKeys: { au1: 'fu1', au2: 'fu2', au3: 'fu3', au4: 'fu1', au5: 'fu1', au6: 'fu1' }, updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
  { driverId: 'profit', system: 'ftp', operation: 'module:ftp', field: 'units.totalNii', centerKeys: { au1: 'fu1', au2: 'fu2', au3: 'fu3', au4: 'fu1', au5: 'fu1', au6: 'fu1' }, updatedAt: '2026-01-10T09:00:00Z', updatedBy: 'u4' },
];

export const allocationScenarios: AllocationScenario[] = [
  { id: 'as1', name: 'ИТ-расходы +20%', poolPct: { ap1: 20 }, driverPct: {}, createdBy: 'u4', createdAt: '2026-10-02T10:00:00Z' },
  { id: 'as2', name: 'Оптимизация площадей −10% и рост транзакций +15%', poolPct: { ap4: -10 }, driverPct: { transactions: 15 }, createdBy: 'u4', createdAt: '2026-10-05T10:00:00Z' },
];

/** Периоды, по которым в демо уже проведены расчёты (результаты считаются при загрузке модуля) и закрыты. */
export const allocationSeedRuns: { period: string; userId: string; createdAt: string; close?: string }[] = [
  { period: '2026-Q1', userId: 'u4', createdAt: '2026-04-08T11:00:00Z', close: '2026-04-15T17:00:00Z' },
  { period: '2026-Q2', userId: 'u4', createdAt: '2026-07-09T10:30:00Z', close: '2026-07-16T17:00:00Z' },
];
