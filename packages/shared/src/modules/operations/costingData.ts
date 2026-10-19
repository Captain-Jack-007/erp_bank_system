// P2-FINPLAN: демо-данные расчёта себестоимости продуктов (ТЗ 4.2.16) — вымышленные нормы времени, объёмы, EL.
import type { OpaElInput, OpaProduct, OpaSettings, OpaTimeStandard } from './types';

const ch = (branch: number, mobile: number, internet: number, agent = 0, call_center = 0) => ({ branch, mobile, internet, agent, call_center });

/** Объекты себестоимости: продукты баланса (id = продукт FTP) и комиссионные услуги. */
export const opaProducts: OpaProduct[] = [
  { id: 'fp1', name: { ru: 'Ипотечные кредиты', uz: 'Ipoteka kreditlari', en: 'Mortgage loans' }, kind: 'balance', segment: 'retail', ftpUnitId: 'fu1', directPerOp: 12_000, channels: ch(0.8, 0.12, 0.08), credit: true },
  { id: 'fp2', name: { ru: 'Потребительские кредиты', uz: "Iste'mol kreditlari", en: 'Consumer loans' }, kind: 'balance', segment: 'retail', ftpUnitId: 'fu1', directPerOp: 6_000, channels: ch(0.45, 0.4, 0.1, 0.05), credit: true },
  { id: 'fp3', name: { ru: 'Автокредиты', uz: 'Avtokreditlar', en: 'Car loans' }, kind: 'balance', segment: 'retail', ftpUnitId: 'fu1', directPerOp: 9_000, channels: ch(0.55, 0.15, 0.05, 0.25), credit: true },
  { id: 'fp4', name: { ru: 'Микрозаймы', uz: 'Mikroqarzlar', en: 'Microloans' }, kind: 'balance', segment: 'sme', ftpUnitId: 'fu1', directPerOp: 4_000, channels: ch(0.6, 0.3, 0.1), credit: true },
  { id: 'fp5', name: { ru: 'Кредиты крупному бизнесу', uz: 'Yirik biznes kreditlari', en: 'Large corporate loans' }, kind: 'balance', segment: 'corporate', ftpUnitId: 'fu2', directPerOp: 85_000, channels: ch(1, 0, 0), credit: true },
  { id: 'fp6', name: { ru: 'Кредиты МСБ', uz: "Kichik va o'rta biznes kreditlari", en: 'SME loans' }, kind: 'balance', segment: 'sme', ftpUnitId: 'fu2', directPerOp: 25_000, channels: ch(0.85, 0.05, 0.1), credit: true },
  { id: 'fp19', name: { ru: 'Кредиты по государственным программам', uz: "Davlat dasturlari bo'yicha kreditlar", en: 'State programme loans' }, kind: 'balance', segment: 'corporate', ftpUnitId: 'fu2', directPerOp: 60_000, channels: ch(1, 0, 0), credit: true },
  { id: 'fp7', name: { ru: 'Валютные кредиты (USD)', uz: 'Valyuta kreditlari (USD)', en: 'FX loans (USD)' }, kind: 'balance', segment: 'corporate', ftpUnitId: 'fu2', directPerOp: 90_000, channels: ch(1, 0, 0), credit: true },
  { id: 'fp20', name: { ru: 'Валютные кредиты (EUR)', uz: 'Valyuta kreditlari (EUR)', en: 'FX loans (EUR)' }, kind: 'balance', segment: 'corporate', ftpUnitId: 'fu2', directPerOp: 90_000, channels: ch(1, 0, 0), credit: true },
  { id: 'fp8', name: { ru: 'Овердрафты и кредитные линии', uz: 'Overdraft va kredit liniyalari', en: 'Overdrafts and credit lines' }, kind: 'balance', segment: 'sme', ftpUnitId: 'fu2', directPerOp: 3_000, channels: ch(0.4, 0, 0.6), credit: true },
  { id: 'fp9', name: { ru: 'Государственные облигации', uz: 'Davlat obligatsiyalari', en: 'Government bonds' }, kind: 'balance', segment: 'treasury', ftpUnitId: 'fu3', directPerOp: 150_000, channels: ch(1, 0, 0), credit: false },
  { id: 'fp10', name: { ru: 'Межбанковские депозиты размещённые', uz: 'Joylashtirilgan banklararo depozitlar', en: 'Interbank deposits placed' }, kind: 'balance', segment: 'treasury', ftpUnitId: 'fu3', directPerOp: 120_000, channels: ch(1, 0, 0), credit: false },
  { id: 'fp11', name: { ru: 'Срочные вклады физлиц (UZS)', uz: "Jismoniy shaxslarning muddatli omonatlari (UZS)", en: 'Retail term deposits (UZS)' }, kind: 'balance', segment: 'retail', ftpUnitId: 'fu1', directPerOp: 1_500, channels: ch(0.5, 0.35, 0.15), credit: false },
  { id: 'fp12', name: { ru: 'Вклады до востребования и карты', uz: "Talab qilib olinguncha omonatlar va kartalar", en: 'Demand deposits and cards' }, kind: 'balance', segment: 'retail', ftpUnitId: 'fu1', directPerOp: 800, channels: ch(0.25, 0.6, 0.15), credit: false },
  { id: 'fp13', name: { ru: 'Валютные вклады физлиц (USD)', uz: "Jismoniy shaxslarning valyuta omonatlari (USD)", en: 'Retail FX deposits (USD)' }, kind: 'balance', segment: 'retail', ftpUnitId: 'fu1', directPerOp: 1_800, channels: ch(0.6, 0.3, 0.1), credit: false },
  { id: 'fp21', name: { ru: 'Валютные вклады физлиц (EUR)', uz: "Jismoniy shaxslarning valyuta omonatlari (EUR)", en: 'Retail FX deposits (EUR)' }, kind: 'balance', segment: 'retail', ftpUnitId: 'fu1', directPerOp: 1_800, channels: ch(0.6, 0.3, 0.1), credit: false },
  { id: 'fp14', name: { ru: 'Расчётные счета юрлиц', uz: 'Yuridik shaxslarning hisob raqamlari', en: 'Corporate current accounts' }, kind: 'balance', segment: 'sme', ftpUnitId: 'fu2', directPerOp: 600, channels: ch(0.2, 0.1, 0.7), credit: false },
  { id: 'fp15', name: { ru: 'Срочные депозиты юрлиц', uz: 'Yuridik shaxslarning muddatli depozitlari', en: 'Corporate term deposits' }, kind: 'balance', segment: 'corporate', ftpUnitId: 'fu2', directPerOp: 4_000, channels: ch(0.7, 0, 0.3), credit: false },
  { id: 'fp16', name: { ru: 'Валютные депозиты юрлиц (USD)', uz: 'Yuridik shaxslarning valyuta depozitlari (USD)', en: 'Corporate FX deposits (USD)' }, kind: 'balance', segment: 'corporate', ftpUnitId: 'fu2', directPerOp: 4_000, channels: ch(0.7, 0, 0.3), credit: false },
  { id: 'fp17', name: { ru: 'Кредитные линии МФИ (USD)', uz: 'XMT kredit liniyalari (USD)', en: 'IFI credit lines (USD)' }, kind: 'balance', segment: 'treasury', ftpUnitId: 'fu3', directPerOp: 200_000, channels: ch(1, 0, 0), credit: false },
  { id: 'fp18', name: { ru: 'Средства государственных фондов', uz: "Davlat jamg'armalari mablag'lari", en: 'State fund resources' }, kind: 'balance', segment: 'treasury', ftpUnitId: 'fu3', directPerOp: 150_000, channels: ch(1, 0, 0), credit: false },
  // Комиссионные услуги
  { id: 'sv1', name: { ru: 'Переводы и платежи физлиц', uz: "Jismoniy shaxslarning o'tkazmalari va to'lovlari", en: 'Retail transfers and payments' }, kind: 'service', segment: 'retail', ftpUnitId: 'fu1', feePerOp: 3_200, directPerOp: 450, channels: ch(0.15, 0.7, 0.1, 0.05), credit: false },
  { id: 'sv2', name: { ru: 'Обслуживание банковских карт', uz: 'Bank kartalariga xizmat ko‘rsatish', en: 'Bank card servicing' }, kind: 'service', segment: 'retail', ftpUnitId: 'fu1', feePerOp: 9_500, directPerOp: 2_800, channels: ch(0.3, 0.6, 0.1), credit: false },
  { id: 'sv3', name: { ru: 'Расчётно-кассовое обслуживание юрлиц', uz: 'Yuridik shaxslarga hisob-kassa xizmati', en: 'Corporate cash management' }, kind: 'service', segment: 'sme', ftpUnitId: 'fu2', feePerOp: 14_000, directPerOp: 1_200, channels: ch(0.35, 0.05, 0.6), credit: false },
  { id: 'sv4', name: { ru: 'Инкассация и пересчёт наличности', uz: 'Inkassatsiya va naqd pulni qayta sanash', en: 'Cash collection and counting' }, kind: 'service', segment: 'corporate', ftpUnitId: 'fu2', feePerOp: 260_000, directPerOp: 95_000, channels: ch(1, 0, 0), credit: false },
];

/** Объёмы операций по продукту за квартал (обслуживание, платежи, выдачи). */
export const opaVolumes: Record<string, number> = {
  fp1: 186_000, fp2: 412_000, fp3: 118_000, fp4: 96_000, fp5: 2_400, fp6: 21_500, fp19: 3_100, fp7: 1_900, fp20: 600, fp8: 64_000, fp9: 180, fp10: 260,
  fp11: 905_000, fp12: 4_850_000, fp13: 212_000, fp21: 46_000, fp14: 3_260_000, fp15: 38_000, fp16: 9_400, fp17: 40, fp18: 60,
  sv1: 21_400_000, sv2: 3_900_000, sv3: 1_850_000, sv4: 52_000,
};
/** Рост объёмов к предыдущему кварталу. */
export const OPA_VOLUME_GROWTH: Record<string, number> = { '2026-Q1': 0.9, '2026-Q2': 0.95, '2026-Q3': 1 };

/** Нормы времени (Time-based costing): минуты на операцию по видам работ. */
export const opaTimeStandards: OpaTimeStandard[] = [
  { productId: 'fp1', activity: { ru: 'Сопровождение и платежи по графику', uz: 'Grafik bo‘yicha kuzatish va to‘lovlar', en: 'Servicing and scheduled payments' }, minutes: 6, staff: 'back' },
  { productId: 'fp1', activity: { ru: 'Консультация и приём документов', uz: 'Maslahat va hujjatlarni qabul qilish', en: 'Advice and document intake' }, minutes: 4, staff: 'front' },
  { productId: 'fp1', activity: { ru: 'Кредитный анализ и залог', uz: 'Kredit tahlili va garov', en: 'Credit analysis and collateral' }, minutes: 3, staff: 'credit' },
  { productId: 'fp2', activity: { ru: 'Скоринг и выдача', uz: 'Skoring va berish', en: 'Scoring and disbursement' }, minutes: 3, staff: 'credit' },
  { productId: 'fp2', activity: { ru: 'Обслуживание погашений', uz: 'To‘lovlarni xizmat qilish', en: 'Repayment servicing' }, minutes: 2, staff: 'back' },
  { productId: 'fp3', activity: { ru: 'Выдача и залог авто', uz: 'Berish va avto garovi', en: 'Disbursement and car pledge' }, minutes: 7, staff: 'credit' },
  { productId: 'fp4', activity: { ru: 'Выдача микрозайма', uz: 'Mikroqarz berish', en: 'Microloan disbursement' }, minutes: 9, staff: 'front' },
  { productId: 'fp5', activity: { ru: 'Кредитный комитет и мониторинг', uz: 'Kredit qo‘mitasi va monitoring', en: 'Credit committee and monitoring' }, minutes: 180, staff: 'credit' },
  { productId: 'fp6', activity: { ru: 'Анализ заёмщика МСБ', uz: 'KO‘B qarz oluvchisi tahlili', en: 'SME borrower analysis' }, minutes: 35, staff: 'credit' },
  { productId: 'fp19', activity: { ru: 'Сопровождение госпрограммы', uz: 'Davlat dasturini kuzatish', en: 'State programme servicing' }, minutes: 120, staff: 'credit' },
  { productId: 'fp7', activity: { ru: 'Валютный кредитный анализ', uz: 'Valyuta kredit tahlili', en: 'FX credit analysis' }, minutes: 200, staff: 'credit' },
  { productId: 'fp20', activity: { ru: 'Валютный кредитный анализ', uz: 'Valyuta kredit tahlili', en: 'FX credit analysis' }, minutes: 200, staff: 'credit' },
  { productId: 'fp8', activity: { ru: 'Обслуживание лимитов', uz: 'Limitlarga xizmat ko‘rsatish', en: 'Limit servicing' }, minutes: 2, staff: 'back' },
  { productId: 'fp9', activity: { ru: 'Сделки с ГЦБ', uz: 'DQQ bilan bitimlar', en: 'Government bond deals' }, minutes: 90, staff: 'back' },
  { productId: 'fp10', activity: { ru: 'Межбанковские сделки', uz: 'Banklararo bitimlar', en: 'Interbank deals' }, minutes: 40, staff: 'back' },
  { productId: 'fp11', activity: { ru: 'Открытие/закрытие вклада', uz: 'Omonatni ochish/yopish', en: 'Deposit open/close' }, minutes: 3, staff: 'front' },
  { productId: 'fp12', activity: { ru: 'Операции по счёту и карте', uz: 'Hisob va karta operatsiyalari', en: 'Account and card operations' }, minutes: 0.4, staff: 'back' },
  { productId: 'fp13', activity: { ru: 'Валютный вклад', uz: 'Valyuta omonati', en: 'FX deposit' }, minutes: 4, staff: 'front' },
  { productId: 'fp21', activity: { ru: 'Валютный вклад', uz: 'Valyuta omonati', en: 'FX deposit' }, minutes: 4, staff: 'front' },
  { productId: 'fp14', activity: { ru: 'Платёжные поручения', uz: 'To‘lov topshiriqnomalari', en: 'Payment orders' }, minutes: 0.6, staff: 'back' },
  { productId: 'fp15', activity: { ru: 'Депозитные договоры', uz: 'Depozit shartnomalari', en: 'Deposit agreements' }, minutes: 15, staff: 'back' },
  { productId: 'fp16', activity: { ru: 'Валютные депозиты', uz: 'Valyuta depozitlari', en: 'FX deposits' }, minutes: 18, staff: 'back' },
  { productId: 'fp17', activity: { ru: 'Отчётность перед МФИ', uz: 'XMT oldida hisobot', en: 'IFI reporting' }, minutes: 600, staff: 'back' },
  { productId: 'fp18', activity: { ru: 'Отчётность перед фондами', uz: 'Jamg‘armalar oldida hisobot', en: 'Fund reporting' }, minutes: 400, staff: 'back' },
  { productId: 'sv1', activity: { ru: 'Обработка перевода', uz: 'O‘tkazmani qayta ishlash', en: 'Transfer processing' }, minutes: 0.15, staff: 'it' },
  { productId: 'sv2', activity: { ru: 'Выпуск и обслуживание карты', uz: 'Karta chiqarish va xizmat', en: 'Card issuance and servicing' }, minutes: 0.8, staff: 'back' },
  { productId: 'sv3', activity: { ru: 'Кассовое обслуживание', uz: 'Kassa xizmati', en: 'Cash service' }, minutes: 1.2, staff: 'front' },
  { productId: 'sv4', activity: { ru: 'Маршрут инкассации и пересчёт', uz: 'Inkassatsiya marshruti va qayta sanash', en: 'Collection route and counting' }, minutes: 55, staff: 'back' },
];

export const opaSettings: OpaSettings = {
  indirectBasis: 'balance',
  directMethod: 'standard',
  laborRates: { front: 62_000, back: 58_000, credit: 96_000, it: 120_000 },
  updatedAt: '2026-07-01T09:00:00Z',
  updatedBy: 'u4',
};

/** Ожидаемые убытки: PD/LGD по кредитным продуктам (источник — риск-менеджмент / МСФО 9 через КХД). */
const B = 1_000_000_000;
export const opaElInputs: OpaElInput[] = [
  { productId: 'fp1', pd: 1.2, lgd: 25, reserve: 118 * B },
  { productId: 'fp2', pd: 4.8, lgd: 55, reserve: 241 * B },
  { productId: 'fp3', pd: 2.9, lgd: 40, reserve: 76 * B },
  { productId: 'fp4', pd: 6.5, lgd: 60, reserve: 62 * B },
  { productId: 'fp5', pd: 1.6, lgd: 45, reserve: 298 * B },
  { productId: 'fp6', pd: 3.4, lgd: 50, reserve: 171 * B },
  { productId: 'fp19', pd: 2.1, lgd: 35, reserve: 88 * B },
  { productId: 'fp7', pd: 1.9, lgd: 45, reserve: 132 * B },
  { productId: 'fp20', pd: 1.9, lgd: 45, reserve: 26 * B },
  { productId: 'fp8', pd: 2.5, lgd: 50, reserve: 21 * B },
].map((e) => ({ ...e, source: 'import' as const, period: '2026-09', updatedAt: '2026-10-04T08:00:00Z', updatedBy: 'system' as const }));

/** Профиль расходов по умолчанию для регионов (тариф и коэффициент стоимости труда). */
export const OPA_REGION_TARIFF: Record<string, { tariff: 'urban' | 'standard' | 'rural'; laborFactor: number; rentPerSqm: number }> = {
  '01': { tariff: 'urban', laborFactor: 1.18, rentPerSqm: 165_000 },
  '02': { tariff: 'standard', laborFactor: 1.04, rentPerSqm: 110_000 },
  '05': { tariff: 'rural', laborFactor: 0.88, rentPerSqm: 68_000 },
  '10': { tariff: 'rural', laborFactor: 0.9, rentPerSqm: 70_000 },
  '11': { tariff: 'rural', laborFactor: 0.87, rentPerSqm: 64_000 },
  '14': { tariff: 'rural', laborFactor: 0.9, rentPerSqm: 66_000 },
};
export const OPA_DEFAULT_TARIFF = { tariff: 'standard' as const, laborFactor: 1, rentPerSqm: 95_000 };

/** Доля объёмов по регионам (для разреза по филиалам). */
export const OPA_BRANCH_SHARE: Record<string, number> = {
  R01: 0.31, R02: 0.06, R03: 0.06, R04: 0.05, R05: 0.03, R06: 0.06, R07: 0.04, R08: 0.06, R09: 0.08, R10: 0.04, R11: 0.03, R12: 0.07, R13: 0.05, R14: 0.06,
};
