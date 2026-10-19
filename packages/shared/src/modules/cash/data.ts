// Демо-данные модуля «Касса и инкассация» (вымышленные).
import type { CashBranch, CashCurrency, CashEconomicsRecord, CashLimit, CashOrder, CashRoute } from './types';

const B = 1_000_000_000;
const M = 1_000_000;

/** Курсы для пересчёта валютной наличности в UZS. */
export const CASH_RATES: Record<CashCurrency, number> = { UZS: 1, USD: 12_650, EUR: 13_700, RUB: 155 };
export const CASH_CURRENCIES: CashCurrency[] = ['UZS', 'USD', 'EUR', 'RUB'];

const lim = (uzsMin: number, uzsMax: number, usd: [number, number], eur: [number, number], rub: [number, number]): Record<CashCurrency, CashLimit> => ({
  UZS: { min: uzsMin * B, max: uzsMax * B },
  USD: { min: usd[0] * 1000, max: usd[1] * 1000 },
  EUR: { min: eur[0] * 1000, max: eur[1] * 1000 },
  RUB: { min: rub[0] * M, max: rub[1] * M },
});
const bal = (uzs: number, usdK: number, eurK: number, rubM: number): Record<CashCurrency, number> => ({ UZS: Math.round(uzs * B), USD: usdK * 1000, EUR: eurK * 1000, RUB: Math.round(rubM * M) });

export const cashBranchesSeed: CashBranch[] = [
  { id: 'cb0', code: 'CV', kind: 'central', name: { ru: 'Центральное хранилище', uz: 'Markaziy xazina' }, region: { ru: 'Ташкент', uz: 'Toshkent' }, manager: 'Ергашев С.', desks: 0, atms: 0, balances: bal(820, 9200, 2400, 310), limits: lim(400, 1200, [4000, 15000], [1000, 4000], [100, 500]) },
  { id: 'cb1', code: 'TSH', kind: 'branch', name: { ru: 'Ташкентский городской филиал', uz: 'Toshkent shahar filiali' }, region: { ru: 'Ташкент', uz: 'Toshkent' }, manager: 'Абдуллаев Р.', desks: 24, atms: 86, balances: bal(68, 640, 120, 18), limits: lim(30, 80, [300, 900], [60, 200], [8, 30]) },
  { id: 'cb2', code: 'YUN', kind: 'branch', name: { ru: 'Юнусабадский филиал', uz: 'Yunusobod filiali' }, region: { ru: 'Ташкент', uz: 'Toshkent' }, manager: 'Исмоилова Д.', desks: 14, atms: 42, balances: bal(57, 410, 70, 9), limits: lim(20, 50, [150, 500], [30, 120], [5, 20]) },
  { id: 'cb3', code: 'CHL', kind: 'branch', name: { ru: 'Чиланзарский филиал', uz: 'Chilonzor filiali' }, region: { ru: 'Ташкент', uz: 'Toshkent' }, manager: 'Турсунов А.', desks: 16, atms: 51, balances: bal(31, 220, 40, 6), limits: lim(20, 55, [150, 500], [30, 120], [5, 20]) },
  { id: 'cb4', code: 'SAM', kind: 'branch', name: { ru: 'Самаркандский областной филиал', uz: 'Samarqand viloyat filiali' }, region: { ru: 'Самарканд', uz: 'Samarqand' }, manager: 'Нормуродов Б.', desks: 18, atms: 63, balances: bal(12, 350, 95, 22), limits: lim(18, 60, [150, 600], [40, 160], [8, 30]) },
  { id: 'cb5', code: 'BUX', kind: 'branch', name: { ru: 'Бухарский областной филиал', uz: 'Buxoro viloyat filiali' }, region: { ru: 'Бухара', uz: 'Buxoro' }, manager: 'Жураев Ф.', desks: 12, atms: 38, balances: bal(26, 180, 60, 7), limits: lim(15, 45, [100, 400], [30, 120], [5, 20]) },
  { id: 'cb6', code: 'FAR', kind: 'branch', name: { ru: 'Ферганский областной филиал', uz: "Farg'ona viloyat filiali" }, region: { ru: 'Фергана', uz: "Farg'ona" }, manager: 'Мамадалиев Ш.', desks: 15, atms: 47, balances: bal(39, 90, 25, 31), limits: lim(15, 50, [100, 400], [25, 100], [5, 25]) },
  { id: 'cb7', code: 'NAM', kind: 'branch', name: { ru: 'Наманганский областной филиал', uz: 'Namangan viloyat filiali' }, region: { ru: 'Наманган', uz: 'Namangan' }, manager: 'Хайдаров У.', desks: 11, atms: 33, balances: bal(22, 160, 30, 12), limits: lim(12, 40, [80, 350], [20, 90], [4, 18]) },
  { id: 'cb8', code: 'AND', kind: 'branch', name: { ru: 'Андижанский областной филиал', uz: 'Andijon viloyat filiali' }, region: { ru: 'Андижан', uz: 'Andijon' }, manager: 'Содиков Н.', desks: 12, atms: 36, balances: bal(48, 205, 35, 10), limits: lim(14, 42, [90, 350], [20, 90], [4, 18]) },
  { id: 'cb9', code: 'NUK', kind: 'branch', name: { ru: 'Нукусский филиал', uz: 'Nukus filiali' }, region: { ru: 'Каракалпакстан', uz: "Qoraqalpog'iston" }, manager: 'Утемуратов К.', desks: 9, atms: 24, balances: bal(17, 60, 12, 4), limits: lim(10, 35, [60, 250], [15, 70], [3, 15]) },
];

export const cashOrdersSeed: CashOrder[] = [
  { id: 'co1', number: 'KZ-2026-0412', type: 'reinforcement', branchId: 'cb4', currency: 'UZS', amount: 27 * B, status: 'approved', plannedDate: '2026-10-19', createdAt: '2026-10-17T08:10:00Z', createdBy: 'u8', routeId: 'cr2', comment: 'Выплата пенсий 20.10' },
  { id: 'co2', number: 'KZ-2026-0413', type: 'surrender', branchId: 'cb2', currency: 'UZS', amount: 22 * B, status: 'new', plannedDate: '2026-10-19', createdAt: '2026-10-17T09:30:00Z', createdBy: 'u8' },
  { id: 'co3', number: 'KZ-2026-0409', type: 'surrender', branchId: 'cb6', currency: 'RUB', amount: 16 * M, status: 'in_transit', plannedDate: '2026-10-18', createdAt: '2026-10-16T11:00:00Z', createdBy: 'u8', routeId: 'cr1' },
  { id: 'co4', number: 'KZ-2026-0405', type: 'reinforcement', branchId: 'cb3', currency: 'USD', amount: 150_000, status: 'delivered', plannedDate: '2026-10-15', createdAt: '2026-10-14T10:00:00Z', createdBy: 'u8' },
  { id: 'co5', number: 'KZ-2026-0401', type: 'surrender', branchId: 'cb1', currency: 'UZS', amount: 18 * B, status: 'delivered', plannedDate: '2026-10-14', createdAt: '2026-10-13T15:20:00Z', createdBy: 'u8' },
  { id: 'co6', number: 'KZ-2026-0398', type: 'reinforcement', branchId: 'cb9', currency: 'UZS', amount: 6 * B, status: 'cancelled', plannedDate: '2026-10-12', createdAt: '2026-10-11T09:00:00Z', createdBy: 'u8', comment: 'Объединено с заявкой KZ-2026-0405' },
];

export const cashRoutesSeed: CashRoute[] = [
  {
    id: 'cr1', number: 'MR-1018-01', date: '2026-10-18', vehicle: '01 A 245 KB', crew: ['Каримов Д.', 'Рустамов О.', 'Эргашев Т.'], status: 'in_transit', distanceKm: 412,
    stops: [
      { branchId: 'cb6', time: '08:30', orderId: 'co3', done: true },
      { branchId: 'cb7', time: '10:40', done: true },
      { branchId: 'cb8', time: '12:15', done: false },
      { branchId: 'cb0', time: '17:30', done: false },
    ],
  },
  {
    id: 'cr2', number: 'MR-1019-02', date: '2026-10-19', vehicle: '01 B 718 LA', crew: ['Холматов С.', 'Юлдашев Б.'], status: 'planned', distanceKm: 318,
    stops: [
      { branchId: 'cb0', time: '07:00', done: false },
      { branchId: 'cb4', time: '10:30', orderId: 'co1', done: false },
      { branchId: 'cb5', time: '14:20', done: false },
    ],
  },
  {
    id: 'cr3', number: 'MR-1019-03', date: '2026-10-19', vehicle: '01 C 903 RA', crew: ['Назаров А.', 'Ахмедов Ж.'], status: 'planned', distanceKm: 46,
    stops: [
      { branchId: 'cb2', time: '09:00', done: false },
      { branchId: 'cb1', time: '10:15', done: false },
      { branchId: 'cb3', time: '11:30', done: false },
      { branchId: 'cb0', time: '13:00', done: false },
    ],
  },
  {
    id: 'cr4', number: 'MR-1017-01', date: '2026-10-17', vehicle: '01 A 245 KB', crew: ['Каримов Д.', 'Рустамов О.'], status: 'completed', distanceKm: 52,
    stops: [
      { branchId: 'cb0', time: '08:00', done: true },
      { branchId: 'cb3', time: '09:20', done: true },
      { branchId: 'cb1', time: '10:45', done: true },
    ],
  },
];

/** Помесячная экономика кассового обслуживания (июль–сентябрь 2026). */
const PROFILE: Record<string, { volume: number; feeRate: number; staff: number; cit: number }> = {
  cb1: { volume: 1450, feeRate: 0.0052, staff: 1.9, cit: 1.15 },
  cb2: { volume: 820, feeRate: 0.0049, staff: 1.15, cit: 0.6 },
  cb3: { volume: 910, feeRate: 0.0047, staff: 1.25, cit: 0.66 },
  cb4: { volume: 760, feeRate: 0.0046, staff: 1.35, cit: 0.92 },
  cb5: { volume: 520, feeRate: 0.0045, staff: 0.98, cit: 0.71 },
  cb6: { volume: 610, feeRate: 0.0044, staff: 1.1, cit: 0.83 },
  cb7: { volume: 430, feeRate: 0.0043, staff: 0.86, cit: 0.62 },
  cb8: { volume: 480, feeRate: 0.0044, staff: 0.9, cit: 0.64 },
  cb9: { volume: 290, feeRate: 0.004, staff: 0.74, cit: 0.69 },
};
const MONTHS: [string, number][] = [['2026-07', 0.96], ['2026-08', 1.0], ['2026-09', 1.07]];

export const cashEconomicsSeed: CashEconomicsRecord[] = Object.entries(PROFILE).flatMap(([branchId, p]) =>
  MONTHS.map(([month, k]) => {
    const volume = Math.round(p.volume * k * B);
    return {
      branchId,
      month,
      processedVolume: volume,
      feeIncome: Math.round(volume * p.feeRate),
      staff: Math.round(p.staff * B),
      cit: Math.round(p.cit * k * B),
      insurance: Math.round(volume * 0.00035),
      transport: Math.round(p.cit * 0.38 * k * B),
      counting: Math.round(volume * 0.0006),
    };
  }),
);
