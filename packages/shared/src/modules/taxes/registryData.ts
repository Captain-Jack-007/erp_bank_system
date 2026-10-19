// Демо-данные реестров налоговой базы (вымышленные объекты, лица и суммы; ставки — демо-значения,
// не являются нормативной справкой). Филиалы — ключи оргструктуры: HO (головной офис), R01…R14.
import type {
  TaxBenefit, TaxFixedService, TaxLandPlot, TaxLease, TaxLedgerLine, TaxMinRent, TaxPropertyObject, TaxRate, TaxServiceClient, TaxVatTurnover, TaxWaterReading,
} from './types';

const B = 1_000_000_000;
const M = 1_000_000;

export const TAX_BRANCHES = ['HO', 'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12', 'R13', 'R14'] as const;
/** Код региона филиала (головной офис — г. Ташкент). */
export const taxRegionOf = (branchKey: string): string => (branchKey === 'HO' ? '01' : branchKey.slice(1, 3));
/** ИНН банка (демо) — плательщик и налоговый агент. */
export const TAX_BANK_TIN = '200000001';

export const taxRatesSeed: TaxRate[] = [
  { id: 'rt1', tax: 'property', kind: 'percent', value: 1.5, regionCode: '*', source: 'tax_code', docRef: 'НК РУз, ст. 415', validFrom: '2020-01-01' },
  { id: 'rt2', tax: 'property_construction', kind: 'percent', value: 3, regionCode: '*', source: 'tax_code', docRef: 'НК РУз, ст. 415 ч. 3', validFrom: '2020-01-01' },
  { id: 'rt3', tax: 'vat', kind: 'percent', value: 12, regionCode: '*', source: 'tax_code', docRef: 'НК РУз, ст. 258', validFrom: '2023-01-01' },
  { id: 'rt4', tax: 'profit', kind: 'percent', value: 20, regionCode: '*', source: 'tax_code', docRef: 'НК РУз, ст. 337 (банки)', validFrom: '2022-01-01' },
  { id: 'rt5', tax: 'pit_rent', kind: 'percent', value: 12, regionCode: '*', source: 'tax_code', docRef: 'НК РУз, ст. 381', validFrom: '2020-01-01' },
  { id: 'rt6', tax: 'water_surface', kind: 'per_m3', value: 300, regionCode: '*', source: 'budget_law', docRef: 'Закон о Госбюджете на 2026 г., прил. 12', validFrom: '2026-01-01' },
  { id: 'rt7', tax: 'water_underground', kind: 'per_m3', value: 370, regionCode: '*', source: 'budget_law', docRef: 'Закон о Госбюджете на 2026 г., прил. 12', validFrom: '2026-01-01' },
  { id: 'rt8', tax: 'water_surface', kind: 'per_m3', value: 270, regionCode: '*', source: 'budget_law', docRef: 'Закон о Госбюджете на 2025 г., прил. 12', validFrom: '2025-01-01', validTo: '2025-12-31' },
  // Земельный налог — абсолютная ставка за 1 га по регионам (Закон о Госбюджете), для г. Ташкента — решение кенгаша
  { id: 'rt9', tax: 'land', kind: 'per_ha', value: 236_000_000, regionCode: '01', source: 'kengash', docRef: 'Решение Ташкентского городского кенгаша № 412 от 25.12.2025', validFrom: '2026-01-01' },
  { id: 'rt10', tax: 'land', kind: 'per_ha', value: 96_000_000, regionCode: '*', source: 'budget_law', docRef: 'Закон о Госбюджете на 2026 г., прил. 11', validFrom: '2026-01-01' },
  { id: 'rt11', tax: 'land', kind: 'per_ha', value: 118_000_000, regionCode: '09', source: 'budget_law', docRef: 'Закон о Госбюджете на 2026 г., прил. 11', validFrom: '2026-01-01' },
  { id: 'rt12', tax: 'land', kind: 'per_ha', value: 104_000_000, regionCode: '12', source: 'kengash', docRef: 'Решение Ферганского областного кенгаша № 77 от 20.12.2025', validFrom: '2026-01-01' },
];

const P = (id: string, cadastralNo: string, ru: string, uz: string, en: string, branchKey: string, address: string, areaM2: number, zone: 'A' | 'B' | 'C', initialCost: number, monthlyDepreciation: number, accumulatedAtYearStart: number, acquiredAt: string, extra: Partial<TaxPropertyObject> = {}): TaxPropertyObject => ({
  id, cadastralNo, name: { ru, uz, en }, branchKey, address, account: '16509', areaM2, zone, initialCost, monthlyDepreciation, accumulatedAtYearStart, acquiredAt, ...extra,
});

export const taxPropertySeed: TaxPropertyObject[] = [
  P('po1', '10:07:01:01:02:0011', 'Здание головного офиса', 'Bosh ofis binosi', 'Head office building', 'HO', 'г. Ташкент, ул. Демо, 1', 18_400, 'A', 312 * B, 1_040 * M, 41.6 * B, '2015-06-01'),
  P('po2', '10:09:03:04:01:0204', 'Здание ЦБУ «Юнусабад»', 'BXM «Yunusobod» binosi', 'Yunusabad branch building', 'R01', 'г. Ташкент, Юнусабадский р-н, кв. 4', 2_100, 'A', 18.6 * B, 62 * M, 6.2 * B, '2017-03-01'),
  P('po3', '10:10:02:02:03:0090', 'Здание ЦБУ «Чиланзар»', 'BXM «Chilonzor» binosi', 'Chilanzar branch building', 'R01', 'г. Ташкент, Чиланзарский р-н, кв. 9', 1_850, 'A', 7.4 * B, 31 * M, 4.9 * B, '2009-09-01'),
  P('po4', '11:02:01:05:02:0310', 'Здание Ташкентского областного филиала', 'Toshkent viloyat filiali binosi', 'Tashkent Region branch building', 'R02', 'г. Нурафшан, ул. Демо, 15', 2_600, 'B', 14.2 * B, 47 * M, 3.8 * B, '2018-01-15'),
  P('po5', '03:01:02:01:01:0132', 'Здание Андижанского филиала', 'Andijon filiali binosi', 'Andijan branch building', 'R03', 'г. Андижан, ул. Демо, 22', 2_250, 'B', 9.8 * B, 33 * M, 5.1 * B, '2012-04-01'),
  P('po6', '02:01:03:02:04:0077', 'Здание Бухарского филиала', 'Buxoro filiali binosi', 'Bukhara branch building', 'R04', 'г. Бухара, ул. Демо, 3', 1_980, 'B', 6.1 * B, 25 * M, 3.4 * B, '2010-10-01'),
  P('po7', '14:01:01:03:02:0451', 'Здание Самаркандского филиала', 'Samarqand filiali binosi', 'Samarkand branch building', 'R09', 'г. Самарканд, ул. Демо, 41', 2_900, 'A', 21.5 * B, 72 * M, 4.3 * B, '2019-07-01'),
  P('po8', '15:01:01:04:03:0012', 'Здание Ферганского филиала', "Farg'ona filiali binosi", 'Fergana branch building', 'R12', "Farg'ona sh., Mustaqillik ko'ch., 12", 2_400, 'B', 16.8 * B, 56 * M, 7.4 * B, '2014-02-01', { assetId: 'as7' }),
  P('po9', '35:01:02:01:01:0019', 'Здание Нукусского филиала', 'Nukus filiali binosi', 'Nukus branch building', 'R14', 'г. Нукус, ул. Демо, 8', 1_700, 'C', 4.2 * B, 17 * M, 2.9 * B, '2008-05-01'),
  // Незавершённое строительство (счёт 16505)
  P('pc1', '10:12:04:01:05:0601', 'Строительство ЦБУ «Сергели» (НЗС)', 'BXM «Sergeli» qurilishi (TQ)', 'Sergeli branch construction (CIP)', 'R01', 'г. Ташкент, Сергелийский р-н, кв. 6', 3_100, 'A', 26.4 * B, 0, 0, '2023-03-01',
    { account: '16505', constructionStart: '2023-03-01', normativeMonths: 30 }),
  P('pc2', '14:03:02:02:01:0088', 'Реконструкция филиала в Ургуте (НЗС)', 'Urgut filiali rekonstruksiyasi (TQ)', 'Urgut branch reconstruction (CIP)', 'R09', 'Самаркандская обл., Ургут, ул. Демо, 5', 1_200, 'C', 8.9 * B, 0, 0, '2025-02-01',
    { account: '16505', constructionStart: '2025-02-01', normativeMonths: 24 }),
  P('pc3', '06:01:01:03:02:0144', 'Строительство кассового центра в Карши (НЗС)', 'Qarshi kassa markazi qurilishi (TQ)', 'Karshi cash centre construction (CIP)', 'R06', 'г. Карши, ул. Демо, 30', 1_650, 'B', 11.3 * B, 0, 0, '2024-05-15',
    { account: '16505', constructionStart: '2024-05-15', normativeMonths: 30 }),
];

/** «База данных» my.soliq.uz: минимальная стоимость за м² по зонам (демо). */
export const SOLIQ_MIN_PER_M2: Record<'A' | 'B' | 'C', number> = { A: 4_200_000, B: 2_600_000, C: 1_500_000 };

/** «Данные ABS» по счёту 16509/16505 (для загрузки): в ABS уже числится новый объект. */
export const absPropertyExtra: TaxPropertyObject = P('po10', '10:11:02:03:04:0718', 'Офис ЦБУ «Яккасарай» (приобретён)', 'BXM «Yakkasaroy» ofisi (sotib olingan)', 'Yakkasaray branch office (acquired)', 'R01', 'г. Ташкент, Яккасарайский р-н, ул. Демо, 17', 980, 'A', 9.6 * B, 40 * M, 0, '2026-08-05');

export const taxLandSeed: TaxLandPlot[] = [
  { id: 'lp1', cadastralNo: '10:07:01:01:02:0011', branchKey: 'HO', address: 'г. Ташкент, ул. Демо, 1', areaHa: 0.86, right: 'own', regionCode: '01', acquiredAt: '2015-06-01' },
  { id: 'lp2', cadastralNo: '10:09:03:04:01:0204', branchKey: 'R01', address: 'г. Ташкент, Юнусабадский р-н, кв. 4', areaHa: 0.18, right: 'own', regionCode: '01', acquiredAt: '2017-03-01' },
  { id: 'lp3', cadastralNo: '10:10:02:02:03:0090', branchKey: 'R01', address: 'г. Ташкент, Чиланзарский р-н, кв. 9', areaHa: 0.15, right: 'possession', regionCode: '01', acquiredAt: '2009-09-01' },
  { id: 'lp4', cadastralNo: '10:12:04:01:05:0601', branchKey: 'R01', address: 'г. Ташкент, Сергелийский р-н, кв. 6', areaHa: 0.42, right: 'use', regionCode: '01', acquiredAt: '2023-03-01' },
  { id: 'lp5', cadastralNo: '11:02:01:05:02:0310', branchKey: 'R02', address: 'г. Нурафшан, ул. Демо, 15', areaHa: 0.31, right: 'own', regionCode: '02', acquiredAt: '2018-01-15' },
  { id: 'lp6', cadastralNo: '03:01:02:01:01:0132', branchKey: 'R03', address: 'г. Андижан, ул. Демо, 22', areaHa: 0.24, right: 'own', regionCode: '03', acquiredAt: '2012-04-01' },
  { id: 'lp7', cadastralNo: '02:01:03:02:04:0077', branchKey: 'R04', address: 'г. Бухара, ул. Демо, 3', areaHa: 0.21, right: 'lease', regionCode: '04', acquiredAt: '2010-10-01' },
  { id: 'lp8', cadastralNo: '06:01:01:03:02:0144', branchKey: 'R06', address: 'г. Карши, ул. Демо, 30', areaHa: 0.37, right: 'use', regionCode: '06', acquiredAt: '2024-05-15' },
  { id: 'lp9', cadastralNo: '14:01:01:03:02:0451', branchKey: 'R09', address: 'г. Самарканд, ул. Демо, 41', areaHa: 0.33, right: 'own', regionCode: '09', acquiredAt: '2019-07-01' },
  { id: 'lp10', cadastralNo: '15:01:01:04:03:0012', branchKey: 'R12', address: "Farg'ona sh., Mustaqillik ko'ch., 12", areaHa: 0.27, right: 'own', regionCode: '12', acquiredAt: '2014-02-01' },
  { id: 'lp11', cadastralNo: '35:01:02:01:01:0019', branchKey: 'R14', address: 'г. Нукус, ул. Демо, 8', areaHa: 0.19, right: 'possession', regionCode: '14', acquiredAt: '2008-05-01' },
];

/** «Данные кадастра»: по одному участку площадь в кадастре уточнена. */
export const KADASTR_AREA_HA: Record<string, number> = { '03:01:02:01:01:0132': 0.262 };

const W = (id: string, branchKey: string, objectName: string, month: string, source: 'surface' | 'underground', m3: number, method: 'meter' | 'invoice' | 'letter', docRef?: string): TaxWaterReading => ({ id, branchKey, objectName, month, source, m3, method, ...(docRef ? { docRef } : {}) });

export const taxWaterSeed: TaxWaterReading[] = [
  ...['2026-07', '2026-08', '2026-09'].flatMap((m, i) => [
    W(`w1${i}`, 'HO', 'Головной офис', m, 'surface', 1_420 + i * 35, 'meter', `СЧ-0012/${m}`),
    W(`w2${i}`, 'R01', 'ЦБУ «Юнусабад»', m, 'surface', 310 + i * 12, 'meter', `СЧ-0451/${m}`),
    W(`w3${i}`, 'R02', 'Ташкентский обл. филиал', m, 'underground', 280 + i * 9, 'meter', `СЧ-0733/${m}`),
    W(`w4${i}`, 'R09', 'Самаркандский филиал', m, 'surface', 365 + i * 10, 'invoice', `SF-SV-${m}-091`),
    W(`w5${i}`, 'R06', 'Кашкадарьинский филиал', m, 'underground', 240 + i * 8, 'letter', `Письмо водоканала № ${41 + i}`),
  ]),
];
/** «soliq.servis.uz»: счета-фактуры водоканала по филиалам без счётчиков (для загрузки). */
export const SOLIQ_WATER_INVOICES: { branchKey: string; objectName: string; source: 'surface' | 'underground'; m3: number }[] = [
  { branchKey: 'R04', objectName: 'Бухарский филиал', source: 'surface', m3: 295 },
  { branchKey: 'R12', objectName: 'Ферганский филиал', source: 'surface', m3: 330 },
  { branchKey: 'R14', objectName: 'Нукусский филиал', source: 'underground', m3: 210 },
];

export const taxMinRentSeed: TaxMinRent[] = [
  { id: 'mr1', year: 2026, regionCode: '01', objectType: 'residential', ratePerM2: 25_000 },
  { id: 'mr2', year: 2026, regionCode: '01', objectType: 'non_residential', ratePerM2: 52_000 },
  { id: 'mr3', year: 2026, regionCode: '*', objectType: 'residential', ratePerM2: 14_000 },
  { id: 'mr4', year: 2026, regionCode: '*', objectType: 'non_residential', ratePerM2: 30_000 },
  { id: 'mr5', year: 2026, regionCode: '09', objectType: 'non_residential', ratePerM2: 36_000 },
  { id: 'mr6', year: 2025, regionCode: '01', objectType: 'non_residential', ratePerM2: 47_000 },
  { id: 'mr7', year: 2025, regionCode: '*', objectType: 'non_residential', ratePerM2: 27_000 },
];

const lease = (id: string, contractNo: string, lessorName: string, lessorPinfl: string, address: string, branchKey: string, objectType: 'residential' | 'non_residential', areaM2: number, monthlyRent: number, startDate: string, endDate: string, ijara: TaxLease['ijara'], responsibleId: string): TaxLease => ({
  id, contractNo, lessorName, lessorPinfl, address, regionCode: branchKey === 'HO' ? '01' : branchKey.slice(1, 3), branchKey, objectType, areaM2, monthlyRent, startDate, endDate, ijara, responsibleId, source: 'abs', payments: [],
});

export const taxLeaseSeed: TaxLease[] = [
  lease('ls1', 'AR-2025-0114', 'Демо Арендодатель А.', '31234567890123', 'г. Ташкент, Мирабадский р-н, ул. Демо, 7 (мини-банк)', 'R01', 'non_residential', 85, 5_200_000, '2025-11-01', '2026-10-25', { status: 'registered', regNo: 'IJ-2025-778812', checkedAt: '2026-10-01' }, 'u17'),
  lease('ls2', 'AR-2026-0021', 'Демо Арендодатель Б.', '32345678901234', 'г. Ташкент, Шайхантахурский р-н, ул. Демо, 18 (касса)', 'R01', 'non_residential', 60, 2_400_000, '2026-02-01', '2027-01-31', { status: 'registered', regNo: 'IJ-2026-104455', checkedAt: '2026-10-01' }, 'u17'),
  lease('ls3', 'AR-2026-0035', 'Демо Арендодатель В.', '33456789012345', 'г. Самарканд, ул. Демо, 4 (офис)', 'R09', 'non_residential', 120, 3_600_000, '2026-03-01', '2027-02-28', { status: 'registered', regNo: 'IJ-2026-201178', checkedAt: '2026-09-15' }, 'u17'),
  lease('ls4', 'AR-2026-0042', 'Демо Арендодатель Г.', '34567890123456', 'г. Андижан, ул. Демо, 11 (склад)', 'R03', 'non_residential', 150, 3_900_000, '2026-04-01', '2027-03-31', { status: 'registered', regNo: 'IJ-2026-310045', checkedAt: '2026-09-15' }, 'u7'),
  lease('ls5', 'AR-2026-0057', 'Демо Арендодатель Д.', '35678901234567', 'г. Нукус, ул. Демо, 2 (квартира для командированных)', 'R14', 'residential', 70, 1_200_000, '2026-05-01', '2026-11-30', { status: 'registered', regNo: 'IJ-2026-412290', checkedAt: '2026-09-20' }, 'u17'),
  lease('ls6', 'AR-2026-0068', 'Демо Арендодатель Е.', '36789012345678', 'г. Карши, ул. Демо, 9 (мини-банк)', 'R06', 'non_residential', 95, 2_100_000, '2026-07-01', '2027-06-30', { status: 'not_registered' }, 'u17'),
  lease('ls7', 'AR-2026-0071', 'Демо Арендодатель Ж.', '37890123456789', 'г. Бухара, ул. Демо, 26 (пункт обмена валюты)', 'R04', 'non_residential', 40, 1_500_000, '2026-08-01', '2027-07-31', { status: 'pending' }, 'u7'),
];
/** «ijara.soliq.uz»: статусы регистрации договоров (для проверки). */
export const IJARA_REGISTRY: Record<string, { status: 'registered' | 'not_registered'; regNo?: string }> = {
  'AR-2025-0114': { status: 'registered', regNo: 'IJ-2025-778812' },
  'AR-2026-0021': { status: 'registered', regNo: 'IJ-2026-104455' },
  'AR-2026-0035': { status: 'registered', regNo: 'IJ-2026-201178' },
  'AR-2026-0042': { status: 'registered', regNo: 'IJ-2026-310045' },
  'AR-2026-0057': { status: 'registered', regNo: 'IJ-2026-412290' },
  'AR-2026-0068': { status: 'not_registered' },
  'AR-2026-0071': { status: 'registered', regNo: 'IJ-2026-509931' },
};
/** «Реестр аренды в ABS»: договор, ещё не заведённый в налоговый реестр. */
export const absLeaseExtra: TaxLease = lease('ls8', 'AR-2026-0090', 'Демо Арендодатель З.', '38901234567890', 'г. Наманган, ул. Демо, 13 (касса)', 'R08', 'non_residential', 55, 1_100_000, '2026-10-01', '2027-09-30', { status: 'not_registered' }, 'u17');

// ---------- Налог на прибыль: обороты главной книги по филиалам за 3 квартал 2026 (демо) ----------
const ledgerProfile: Record<string, number> = { HO: 1.35, R01: 1.6, R02: 0.62, R03: 0.48, R04: 0.4, R05: 0.22, R06: 0.36, R07: 0.31, R08: 0.38, R09: 0.58, R10: 0.27, R11: 0.18, R12: 0.47, R13: 0.24, R14: 0.21 };
const ledgerLossy = new Set(['R05', 'R11']);
const LG = (account: string, ru: string, uz: string, en: string, kind: 'income' | 'expense', cls: TaxLedgerLine['cls'], base: number) => ({ account, name: { ru, uz, en }, kind, cls, base });
const LEDGER_TEMPLATE = [
  LG('40000', 'Процентные доходы', 'Foizli daromadlar', 'Interest income', 'income', 'taxable', 160),
  LG('45000', 'Комиссионные доходы', 'Komission daromadlar', 'Fee income', 'income', 'taxable', 38),
  LG('47200', 'Доходы по гос. ценным бумагам (не облагаются)', "Davlat qimmatli qog'ozlari bo'yicha daromadlar (soliq solinmaydi)", 'Government securities income (non-taxable)', 'income', 'non_taxable', 6),
  LG('50000', 'Процентные расходы', 'Foizli xarajatlar', 'Interest expense', 'expense', 'deductible', 92),
  LG('55000', 'Операционные расходы', 'Operatsion xarajatlar', 'Operating expenses', 'expense', 'deductible', 54),
  LG('56802', 'Резервы на возможные убытки (вычитаемые)', "Ehtimoliy zararlar uchun zaxiralar (chegiriladigan)", 'Loss provisions (deductible)', 'expense', 'deductible', 17),
  LG('55990', 'Штрафы, пени и представительские сверх норм (невычитаемые)', "Jarimalar, penyalar va me'yordan ortiq vakillik xarajatlari (chegirilmaydigan)", 'Fines, penalties and excess entertainment (non-deductible)', 'expense', 'non_deductible', 1.6),
  LG('55995', 'Благотворительность (невычитаемые)', 'Xayriya (chegirilmaydigan)', 'Charity (non-deductible)', 'expense', 'non_deductible', 0.9),
];
export const taxLedgerSeed: TaxLedgerLine[] = (['2026-Q3', '2026-10'] as const).flatMap((period) =>
  Object.entries(ledgerProfile).flatMap(([branchKey, k]) =>
    LEDGER_TEMPLATE.map((t, i) => {
      let amount = t.base * k * B * (period === '2026-Q3' ? 1 : 0.34);
      if (ledgerLossy.has(branchKey) && t.account === '55000') amount *= 2.1; // убыточные филиалы
      return { id: `lg-${period}-${branchKey}-${i}`, branchKey, period, account: t.account, name: t.name, kind: t.kind, cls: t.cls, amount: Math.round(amount / M) * M };
    }),
  ),
);

export const taxBenefitsSeed: TaxBenefit[] = [
  { id: 'bf1', code: 'LG-337-1', name: { ru: 'Освобождение доходов по ипотечным кредитам по госпрограмме', uz: "Davlat dasturi bo'yicha ipoteka kreditlari daromadlarini ozod qilish", en: 'Exemption of state-programme mortgage income' }, basis: 'НК РУз, ст. 356 (демо)', period: '2026-Q3', amount: 21 * B, active: true },
  { id: 'bf3', code: 'LG-337-1', name: { ru: 'Освобождение доходов по ипотечным кредитам по госпрограмме', uz: "Davlat dasturi bo'yicha ipoteka kreditlari daromadlarini ozod qilish", en: 'Exemption of state-programme mortgage income' }, basis: 'НК РУз, ст. 356 (демо)', period: '2026-10', amount: 7.2 * B, active: true },
  { id: 'bf2', code: 'LG-337-2', name: { ru: 'Уменьшение базы на сумму инвестиций в модернизацию', uz: "Bazani modernizatsiyaga investitsiyalar summasiga kamaytirish", en: 'Base reduction for modernisation investment' }, basis: 'НК РУз, ст. 357 (демо)', period: '2026-Q3', amount: 9.5 * B, branchKey: 'HO', active: true },
];

/** Обороты, облагаемые НДС, по филиалам (сводный ежемесячный расчёт, PR-TAX-065). */
const vatProfile: Record<string, [number, number, number]> = {
  HO: [6.2, 4.1, 14.8], R01: [3.9, 6.8, 9.6], R02: [1.1, 2.6, 3.1], R03: [0.9, 2.2, 2.4], R04: [0.7, 1.9, 2.0], R06: [0.6, 1.5, 1.8], R09: [1.4, 3.3, 3.9], R12: [1.0, 2.7, 2.6], R14: [0.5, 1.2, 1.3],
};
export const taxVatSeed: TaxVatTurnover[] = ['2026-09', '2026-10'].flatMap((month, mi) =>
  Object.entries(vatProfile).flatMap(([branchKey, vals]) =>
    (['rent', 'collateral', 'services'] as const).map((category, ci) => {
      const amount = Math.round(vals[ci]! * (mi ? 1.04 : 1) * B / M) * M;
      return { id: `vt-${month}-${branchKey}-${category}`, branchKey, month, category, amount, inputVat: Math.round(amount * 0.045 / M) * M, source: ci === 1 ? 'abs' as const : 'esf' as const };
    }),
  ),
);

export const taxFixedServicesSeed: TaxFixedService[] = [
  { id: 'fs1', code: 'SRV-SAFE', name: { ru: 'Аренда сейфовой ячейки (мес.)', uz: 'Seyf yacheykasini ijaraga olish (oy)', en: 'Safe deposit box rental (month)' }, price: 450_000 },
  { id: 'fs2', code: 'SRV-ENC', name: { ru: 'Инкассация выручки (мес.)', uz: 'Tushumni inkassatsiya qilish (oy)', en: 'Cash collection service (month)' }, price: 1_800_000 },
  { id: 'fs3', code: 'SRV-CONS', name: { ru: 'Консультационное сопровождение ВЭД (мес.)', uz: "TIF bo'yicha maslahat (oy)", en: 'Foreign trade advisory (month)' }, price: 2_500_000 },
];
export const taxServiceClientsSeed: TaxServiceClient[] = [
  { id: 'sc1', name: 'ООО «Демо Ритейл»', tin: '301234561', branchKey: 'R01', serviceIds: ['fs2'] },
  { id: 'sc2', name: 'АО «Демо Агро»', tin: '302345672', branchKey: 'R09', serviceIds: ['fs2', 'fs3'] },
  { id: 'sc3', name: 'ЧП «Демо Сервис»', tin: '303456783', branchKey: 'R01', serviceIds: ['fs1'] },
  { id: 'sc4', name: 'ООО «Демо Логистик»', tin: '304567894', branchKey: 'R02', serviceIds: ['fs2'] },
  { id: 'sc5', name: 'СП «Демо Текстиль»', tin: '305678905', branchKey: 'R12', serviceIds: ['fs3'] },
];
