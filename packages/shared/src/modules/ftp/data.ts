// Демо-данные модуля FTP (вымышленные). Остатки — в эквиваленте UZS.
import type {
  FtpBusinessUnit,
  FtpCurrency,
  FtpCurvePoint,
  FtpCurveVersion,
  FtpHqlaItem,
  FtpLpPoint,
  FtpMethodology,
  FtpProduct,
  FtpRateRule,
  FtpRegParams,
} from './types';

const P = (tenorMonths: number, label: string, rate: number): FtpCurvePoint => ({ tenorMonths, label, rate });
/** Сроки кривой: Overnight, 1 неделя, 1 мес … 10 лет (PR-FTP-003). */
export const FTP_TENORS: [number, string][] = [[1 / 30, 'O/N'], [0.25, '1W'], [1, '1M'], [3, '3M'], [6, '6M'], [12, '1Y'], [24, '2Y'], [36, '3Y'], [60, '5Y'], [84, '7Y'], [120, '10Y']];
const curve = (rates: number[]) => FTP_TENORS.map(([m, l], i) => P(m, l, rates[i]!));

/** Текущие кривые (с 01.10.2026) и история версий (на любую дату). */
const UZS_NOW = [13.0, 13.6, 14.5, 15.5, 16.8, 19.5, 19.7, 19.9, 20.0, 20.2, 20.4];
const USD_NOW = [4.3, 4.45, 4.7, 4.9, 5.2, 5.5, 5.8, 6.0, 6.4, 6.6, 6.8];
const EUR_NOW = [2.6, 2.7, 2.85, 3.0, 3.2, 3.45, 3.7, 3.9, 4.2, 4.4, 4.6];
const shiftAll = (a: number[], d: number) => a.map((v) => Math.round((v + d) * 100) / 100);

let seq = 0;
const V = (currency: FtpCurrency, version: number, validFrom: string, rates: number[], source: FtpCurveVersion['source'], note: string): FtpCurveVersion => ({
  id: `fcv${++seq}`, currency, version, validFrom, points: curve(rates), interpolation: 'linear', source, status: 'active', note, createdBy: source === 'khd' ? 'system' : 'u8', createdAt: `${validFrom}T06:00:00Z`,
});

export const ftpCurveVersions: FtpCurveVersion[] = [
  V('UZS', 1, '2026-01-01', shiftAll(UZS_NOW, 1.0), 'khd', 'Кривая на 2026 год (КХД)'),
  V('UZS', 2, '2026-04-01', shiftAll(UZS_NOW, 0.6), 'khd', 'Снижение ставки рефинансирования ЦБ'),
  V('UZS', 3, '2026-07-01', shiftAll(UZS_NOW, 0.25), 'khd', 'Пересмотр по итогам II квартала'),
  V('UZS', 4, '2026-10-01', UZS_NOW, 'khd', 'Кривая IV квартала (КХД)'),
  V('USD', 1, '2026-01-01', shiftAll(USD_NOW, 0.35), 'khd', 'Кривая на 2026 год (КХД)'),
  V('USD', 2, '2026-07-01', shiftAll(USD_NOW, 0.1), 'khd', 'Пересмотр по итогам II квартала'),
  V('USD', 3, '2026-10-01', USD_NOW, 'khd', 'Кривая IV квартала (КХД)'),
  V('EUR', 1, '2026-01-01', shiftAll(EUR_NOW, 0.3), 'market', 'Построена по Refinitiv + спред'),
  V('EUR', 2, '2026-10-01', EUR_NOW, 'market', 'Построена по Refinitiv + спред'),
];

export const ftpUnits: FtpBusinessUnit[] = [
  { id: 'fu1', name: { ru: 'Розничный бизнес', uz: 'Chakana biznes', en: 'Retail banking' }, departmentId: 'd9' },
  { id: 'fu2', name: { ru: 'Корпоративный бизнес', uz: 'Korporativ biznes', en: 'Corporate banking' }, departmentId: 'd10' },
  { id: 'fu3', name: { ru: 'Казначейство (центр фондирования)', uz: "G'aznachilik (moliyalashtirish markazi)", en: 'Treasury (funding centre)' }, departmentId: 'd8' },
];

/** ID казначейства — получает маржу несовпадения сроков (funding / mismatch). */
export const FTP_TREASURY_UNIT = 'fu3';

const T = 1_000_000_000_000; // трлн
const B = 1_000_000_000; // млрд

const RAW_PRODUCTS: FtpProduct[] = [
  // Активы — розница
  { id: 'fp1', name: { ru: 'Ипотечные кредиты', uz: 'Ipoteka kreditlari', en: 'Mortgage loans' }, side: 'asset', currency: 'UZS', unitId: 'fu1', balance: 9.8 * T, tenorMonths: 84, clientRate: 20.5, prepaymentPct: 6, accountCode: '12401' },
  { id: 'fp2', name: { ru: 'Потребительские кредиты', uz: "Iste'mol kreditlari", en: 'Consumer loans' }, side: 'asset', currency: 'UZS', unitId: 'fu1', balance: 4.6 * T, tenorMonths: 24, clientRate: 25.0, prepaymentPct: 12, accountCode: '12405' },
  { id: 'fp3', name: { ru: 'Автокредиты', uz: 'Avtokreditlar', en: 'Car loans' }, side: 'asset', currency: 'UZS', unitId: 'fu1', balance: 3.1 * T, tenorMonths: 36, clientRate: 22.5, prepaymentPct: 9, accountCode: '12405' },
  { id: 'fp4', name: { ru: 'Микрозаймы', uz: 'Mikroqarzlar', en: 'Microloans' }, side: 'asset', currency: 'UZS', unitId: 'fu1', balance: 1.4 * T, tenorMonths: 12, clientRate: 27.0, prepaymentPct: 4, accountCode: '12405' },
  // Активы — корпоративный бизнес
  { id: 'fp5', name: { ru: 'Кредиты крупному бизнесу', uz: 'Yirik biznes kreditlari', en: 'Large corporate loans' }, side: 'asset', currency: 'UZS', unitId: 'fu2', balance: 12.4 * T, tenorMonths: 60, clientRate: 20.5, prepaymentPct: 5, accountCode: '12501' },
  { id: 'fp6', name: { ru: 'Кредиты МСБ', uz: "Kichik va o'rta biznes kreditlari", en: 'SME loans' }, side: 'asset', currency: 'UZS', unitId: 'fu2', balance: 5.2 * T, tenorMonths: 36, clientRate: 22.0, prepaymentPct: 7, accountCode: '12501' },
  { id: 'fp19', name: { ru: 'Кредиты по государственным программам', uz: "Davlat dasturlari bo'yicha kreditlar", en: 'State programme loans' }, side: 'asset', currency: 'UZS', unitId: 'fu2', balance: 6.0 * T, tenorMonths: 60, clientRate: 14.0, accountCode: '12501' },
  { id: 'fp7', name: { ru: 'Валютные кредиты (USD)', uz: 'Valyuta kreditlari (USD)', en: 'FX loans (USD)' }, side: 'asset', currency: 'USD', unitId: 'fu2', balance: 7.6 * T, tenorMonths: 60, clientRate: 8.5, prepaymentPct: 3, accountCode: '12509' },
  { id: 'fp20', name: { ru: 'Валютные кредиты (EUR)', uz: 'Valyuta kreditlari (EUR)', en: 'FX loans (EUR)' }, side: 'asset', currency: 'EUR', unitId: 'fu2', balance: 1.6 * T, tenorMonths: 36, clientRate: 6.5, prepaymentPct: 3, accountCode: '12509' },
  { id: 'fp8', name: { ru: 'Овердрафты и кредитные линии', uz: 'Overdraft va kredit liniyalari', en: 'Overdrafts and credit lines' }, side: 'asset', currency: 'UZS', unitId: 'fu2', balance: 1.8 * T, tenorMonths: 6, clientRate: 20.0, accountCode: '12501' },
  // Активы — казначейство
  { id: 'fp9', name: { ru: 'Государственные облигации', uz: 'Davlat obligatsiyalari', en: 'Government bonds' }, side: 'asset', currency: 'UZS', unitId: 'fu3', balance: 3.9 * T, tenorMonths: 24, clientRate: 20.0 },
  { id: 'fp10', name: { ru: 'Межбанковские депозиты размещённые', uz: 'Joylashtirilgan banklararo depozitlar', en: 'Interbank deposits placed' }, side: 'asset', currency: 'USD', unitId: 'fu3', balance: 950 * B, tenorMonths: 1, clientRate: 4.9 },
  // Пассивы — розница
  { id: 'fp11', name: { ru: 'Срочные вклады физлиц (UZS)', uz: "Jismoniy shaxslarning muddatli omonatlari (UZS)", en: 'Retail term deposits (UZS)' }, side: 'liability', currency: 'UZS', unitId: 'fu1', balance: 16.0 * T, tenorMonths: 12, clientRate: 19.0, lcrCategory: 'retail_less_stable', accountCode: '20606' },
  { id: 'fp12', name: { ru: 'Вклады до востребования и карты', uz: "Talab qilib olinguncha omonatlar va kartalar", en: 'Demand deposits and cards' }, side: 'liability', currency: 'UZS', unitId: 'fu1', balance: 3.5 * T, tenorMonths: 1, clientRate: 6.0, lcrCategory: 'retail_stable', accountCode: '20206' },
  { id: 'fp13', name: { ru: 'Валютные вклады физлиц (USD)', uz: "Jismoniy shaxslarning valyuta omonatlari (USD)", en: 'Retail FX deposits (USD)' }, side: 'liability', currency: 'USD', unitId: 'fu1', balance: 4.3 * T, tenorMonths: 12, clientRate: 4.5, lcrCategory: 'retail_less_stable', accountCode: '20614' },
  { id: 'fp21', name: { ru: 'Валютные вклады физлиц (EUR)', uz: "Jismoniy shaxslarning valyuta omonatlari (EUR)", en: 'Retail FX deposits (EUR)' }, side: 'liability', currency: 'EUR', unitId: 'fu1', balance: 1.2 * T, tenorMonths: 12, clientRate: 2.4, lcrCategory: 'retail_less_stable', accountCode: '20614' },
  // Пассивы — корпоративный бизнес
  { id: 'fp14', name: { ru: 'Расчётные счета юрлиц', uz: 'Yuridik shaxslarning hisob raqamlari', en: 'Corporate current accounts' }, side: 'liability', currency: 'UZS', unitId: 'fu2', balance: 4.5 * T, tenorMonths: 1, clientRate: 2.0, lcrCategory: 'corp_operational', accountCode: '20208' },
  { id: 'fp15', name: { ru: 'Срочные депозиты юрлиц', uz: 'Yuridik shaxslarning muddatli depozitlari', en: 'Corporate term deposits' }, side: 'liability', currency: 'UZS', unitId: 'fu2', balance: 10.5 * T, tenorMonths: 6, clientRate: 16.5, lcrCategory: 'corp_non_operational', accountCode: '20608' },
  { id: 'fp16', name: { ru: 'Валютные депозиты юрлиц (USD)', uz: 'Yuridik shaxslarning valyuta depozitlari (USD)', en: 'Corporate FX deposits (USD)' }, side: 'liability', currency: 'USD', unitId: 'fu2', balance: 3.8 * T, tenorMonths: 6, clientRate: 4.0, lcrCategory: 'corp_non_operational', accountCode: '20616' },
  // Пассивы — казначейство
  { id: 'fp17', name: { ru: 'Кредитные линии МФИ (USD)', uz: 'XMT kredit liniyalari (USD)', en: 'IFI credit lines (USD)' }, side: 'liability', currency: 'USD', unitId: 'fu3', balance: 5.9 * T, tenorMonths: 84, clientRate: 7.5, lcrCategory: 'financial' },
  { id: 'fp18', name: { ru: 'Средства государственных фондов', uz: "Davlat jamg'armalari mablag'lari", en: 'State fund resources' }, side: 'liability', currency: 'UZS', unitId: 'fu3', balance: 9.0 * T, tenorMonths: 60, clientRate: 13.0, lcrCategory: 'financial' },
];

export const ftpProducts: FtpProduct[] = RAW_PRODUCTS.map((p) => ({ ...p, balance: Math.round(p.balance) }));

/** Балансовые счета, подлежащие FTP, с профилем денежных потоков для WAL (PR-FTP-005): доля потока по срокам. */
export const ftpAccounts: { code: string; name: { ru: string; uz: string; en: string }; side: 'asset' | 'liability'; currency: FtpCurrency; unitId: string; cashflows: { months: number; share: number }[] }[] = [
  { code: '12401', name: { ru: 'Ипотечные кредиты физлицам', uz: 'Jismoniy shaxslarga ipoteka kreditlari', en: 'Retail mortgage loans' }, side: 'asset', currency: 'UZS', unitId: 'fu1', cashflows: [{ months: 12, share: 0.1 }, { months: 36, share: 0.25 }, { months: 60, share: 0.3 }, { months: 120, share: 0.35 }] },
  { code: '12405', name: { ru: 'Потребительские и прочие кредиты физлицам', uz: 'Jismoniy shaxslarga iste’mol va boshqa kreditlar', en: 'Consumer and other retail loans' }, side: 'asset', currency: 'UZS', unitId: 'fu1', cashflows: [{ months: 6, share: 0.25 }, { months: 12, share: 0.3 }, { months: 24, share: 0.3 }, { months: 36, share: 0.15 }] },
  { code: '12501', name: { ru: 'Кредиты юрлицам в UZS', uz: 'Yuridik shaxslarga UZS kreditlari', en: 'Corporate loans in UZS' }, side: 'asset', currency: 'UZS', unitId: 'fu2', cashflows: [{ months: 6, share: 0.15 }, { months: 24, share: 0.3 }, { months: 60, share: 0.4 }, { months: 84, share: 0.15 }] },
  { code: '12509', name: { ru: 'Кредиты юрлицам в иностранной валюте', uz: 'Yuridik shaxslarga xorijiy valyutadagi kreditlar', en: 'Corporate FX loans' }, side: 'asset', currency: 'USD', unitId: 'fu2', cashflows: [{ months: 12, share: 0.2 }, { months: 36, share: 0.35 }, { months: 60, share: 0.45 }] },
  { code: '20206', name: { ru: 'Депозиты до востребования физлиц', uz: 'Jismoniy shaxslarning talab qilinguncha depozitlari', en: 'Retail demand deposits' }, side: 'liability', currency: 'UZS', unitId: 'fu1', cashflows: [{ months: 1, share: 0.3 }, { months: 12, share: 0.3 }, { months: 36, share: 0.4 }] },
  { code: '20208', name: { ru: 'Расчётные счета юрлиц (стабильная часть)', uz: 'Yuridik shaxslar hisob raqamlari (barqaror qism)', en: 'Corporate current accounts (core)' }, side: 'liability', currency: 'UZS', unitId: 'fu2', cashflows: [{ months: 1, share: 0.45 }, { months: 6, share: 0.25 }, { months: 24, share: 0.3 }] },
  { code: '20606', name: { ru: 'Срочные депозиты физлиц в UZS', uz: 'Jismoniy shaxslarning UZS muddatli depozitlari', en: 'Retail term deposits in UZS' }, side: 'liability', currency: 'UZS', unitId: 'fu1', cashflows: [{ months: 3, share: 0.2 }, { months: 6, share: 0.25 }, { months: 12, share: 0.4 }, { months: 24, share: 0.15 }] },
  { code: '20608', name: { ru: 'Срочные депозиты юрлиц в UZS', uz: 'Yuridik shaxslarning UZS muddatli depozitlari', en: 'Corporate term deposits in UZS' }, side: 'liability', currency: 'UZS', unitId: 'fu2', cashflows: [{ months: 1, share: 0.2 }, { months: 3, share: 0.3 }, { months: 6, share: 0.35 }, { months: 12, share: 0.15 }] },
];

/** Надбавка за ликвидность по срокам, б.п. (PR-OPA-010). */
export const ftpLpCurve: FtpLpPoint[] = [
  { tenorMonths: 1 / 30, label: 'O/N', bp: 0 }, { tenorMonths: 1, label: '1M', bp: 5 }, { tenorMonths: 3, label: '3M', bp: 10 }, { tenorMonths: 6, label: '6M', bp: 20 },
  { tenorMonths: 12, label: '1Y', bp: 35 }, { tenorMonths: 24, label: '2Y', bp: 50 }, { tenorMonths: 36, label: '3Y', bp: 60 }, { tenorMonths: 60, label: '5Y', bp: 75 }, { tenorMonths: 120, label: '10Y', bp: 90 },
];

const RUNOFF = { retail_stable: 5, retail_less_stable: 10, corp_operational: 25, corp_non_operational: 40, financial: 100, none: 0 };
export const ftpRegParams: FtpRegParams[] = [
  { version: 1, validFrom: '2026-01-01', reserve: { UZS: { short: 4, long: 2 }, USD: { short: 18, long: 14 }, EUR: { short: 18, long: 14 } }, reserveRemuneration: 0, lcrMin: 100, runoff: { ...RUNOFF }, haircut: { l1: 0, l2a: 15, l2b: 50 }, l2Cap: 40, hqlaYield: 15.5, inflowCap: 75, note: 'Положение ЦБ о нормативах ликвидности (демо)', createdBy: 'u8', createdAt: '2026-01-02T09:00:00Z' },
  { version: 2, validFrom: '2026-07-01', reserve: { UZS: { short: 4, long: 2 }, USD: { short: 20, long: 16 }, EUR: { short: 20, long: 16 } }, reserveRemuneration: 0, lcrMin: 100, runoff: { ...RUNOFF }, haircut: { l1: 0, l2a: 15, l2b: 50 }, l2Cap: 40, hqlaYield: 15.5, inflowCap: 75, note: 'Повышение норматива ФОР по валютным обязательствам (демо)', createdBy: 'u8', createdAt: '2026-06-20T09:00:00Z' },
];

export const ftpHqla: FtpHqlaItem[] = [
  { id: 'h1', name: { ru: 'Наличные в кассах и банкоматах', uz: 'Kassalar va bankomatlardagi naqd pul', en: 'Cash in vaults and ATMs' }, level: 'l1', amount: 2.4 * T },
  { id: 'h2', name: { ru: 'Средства в ЦБ сверх обязательных резервов', uz: 'MBdagi majburiy zaxiradan ortiq mablag‘lar', en: 'Central bank reserves above requirement' }, level: 'l1', amount: 1.8 * T },
  { id: 'h3', name: { ru: 'Государственные облигации и облигации ЦБ', uz: 'Davlat va MB obligatsiyalari', en: 'Government and central bank bonds' }, level: 'l1', amount: 3.9 * T },
  { id: 'h4', name: { ru: 'Корпоративные облигации рейтинга AA', uz: 'AA reytingli korporativ obligatsiyalar', en: 'AA-rated corporate bonds' }, level: 'l2a', amount: 0.9 * T },
  { id: 'h5', name: { ru: 'Акции и облигации нижнего рейтинга', uz: 'Past reytingli aksiya va obligatsiyalar', en: 'Equities and lower-rated bonds' }, level: 'l2b', amount: 0.35 * T },
];
/** Ожидаемые притоки на 30 дней (погашения кредитов, межбанк). */
export const FTP_INFLOWS_30D = 2.6 * T;

export const ftpRules: FtpRateRule[] = [
  { id: 'fr1', name: 'Каракалпакстан: госпрограмма развития региона — −25 б.п. по кредитам', active: true, priority: 10, branchKey: 'R14', side: 'asset', kind: 'adjust', value: -25, validFrom: '2026-03-01', createdBy: 'u8', updatedAt: '2026-03-01T09:00:00Z' },
  { id: 'fr2', name: 'Корпоративный бизнес: валютные пассивы — +10 б.п.', active: true, priority: 20, unitId: 'fu2', currency: 'USD', side: 'liability', kind: 'adjust', value: 10, validFrom: '2026-05-01', createdBy: 'u8', updatedAt: '2026-05-01T09:00:00Z' },
  { id: 'fr3', name: 'Ферганская долина: короткие депозиты (до 6 мес.) — +15 б.п.', active: true, priority: 30, branchKey: 'R12', side: 'liability', tenorTo: 6, kind: 'adjust', value: 15, validFrom: '2026-06-01', createdBy: 'u8', updatedAt: '2026-06-01T09:00:00Z' },
  { id: 'fr4', name: 'Овердрафты: фиксированная ставка 21% (пилот)', active: false, priority: 40, unitId: 'fu2', side: 'asset', tenorTo: 6, kind: 'fixed', value: 21, validFrom: '2026-09-01', createdBy: 'u8', updatedAt: '2026-09-01T09:00:00Z' },
];

/** Распределение остатков направлений по региональным филиалам (для отчёта по филиалам). */
export const FTP_BRANCH_SHARE: Record<string, number> = {
  R01: 0.31, R02: 0.06, R03: 0.06, R04: 0.05, R05: 0.03, R06: 0.06, R07: 0.04, R08: 0.06, R09: 0.08, R10: 0.04, R11: 0.03, R12: 0.07, R13: 0.05, R14: 0.06,
};

export const ftpMethodologies: FtpMethodology[] = [
  {
    id: 'mm', code: 'MM-STD', name: { ru: 'Matched Maturity (стандарт банка)', uz: 'Matched Maturity (bank standarti)', en: 'Matched Maturity (bank standard)' },
    versions: [
      { version: 1, validFrom: '2026-01-01', method: 'matched_maturity', poolRates: {}, includeLp: true, includeRegulatory: true, applyRules: true, status: 'approved', note: 'Кривая по сроку + надбавка за ликвидность + ФОР/LCR + правила применения', createdBy: 'u8', createdAt: '2025-12-20T09:00:00Z', approvedBy: 'u4', approvedAt: '2025-12-27T12:00:00Z' },
      { version: 2, validFrom: '2026-12-01', method: 'matched_maturity', poolRates: {}, includeLp: true, includeRegulatory: true, applyRules: false, status: 'draft', note: 'Без индивидуальных правил филиалов (проект ALCO)', createdBy: 'u8', createdAt: '2026-10-10T09:00:00Z' },
    ],
  },
  {
    id: 'sp', code: 'SP-2026', name: { ru: 'Single Pool (единая ставка фондирования)', uz: 'Single Pool (yagona moliyalashtirish stavkasi)', en: 'Single Pool (single funding rate)' },
    versions: [
      { version: 1, validFrom: '2026-01-01', method: 'single_pool', poolRates: { UZS: 17.5, USD: 5.6, EUR: 3.6 }, includeLp: false, includeRegulatory: true, applyRules: false, status: 'approved', note: 'Упрощённая методология для сравнения и управленческой отчётности', createdBy: 'u8', createdAt: '2025-12-20T09:00:00Z', approvedBy: 'u4', approvedAt: '2025-12-27T12:00:00Z' },
    ],
  },
];
