// Демо-данные модуля МСФО (вымышленные). Период — 9 месяцев 2026 г. (на 30.09.2026).
import type { IfrsAdjustment, IfrsCloseTask, IfrsEntity, IfrsEntityStatement, IfrsIntragroup, IfrsTrialBalanceRow } from './types';

const B = 1_000_000_000; // 1 млрд UZS
const b = (x: number) => Math.round(x * B);

export const IFRS_PERIOD = '2026-09-30';
/** Курс ЦБ на отчётную дату для пересчёта отчётности в USD. */
export const IFRS_USD_RATE = 12_650;

export const ifrsEntitiesSeed: IfrsEntity[] = [
  { id: 'e0', name: 'АКБ «Народный банк»', shortName: 'XB', type: 'parent', ownership: 100, method: 'parent', currency: 'UZS', activity: { ru: 'Банковская деятельность', uz: 'Bank faoliyati' }, investmentCost: 0 },
  { id: 'e1', name: 'OOO «XB Lizing»', shortName: 'Lizing', type: 'subsidiary', ownership: 100, method: 'full', currency: 'UZS', activity: { ru: 'Лизинг', uz: 'Lizing' }, investmentCost: b(400) },
  { id: 'e2', name: "AJ «XB Sug'urta»", shortName: "Sug'urta", type: 'subsidiary', ownership: 75, method: 'full', currency: 'UZS', activity: { ru: 'Страхование', uz: "Sug'urta" }, investmentCost: b(200) },
  { id: 'e3', name: 'XB Capital Management Ltd', shortName: 'Capital', type: 'subsidiary', ownership: 100, method: 'full', currency: 'USD', activity: { ru: 'Управление активами', uz: 'Aktivlarni boshqarish' }, investmentCost: b(80) },
  { id: 'e4', name: 'MMT «XB Mikromoliya»', shortName: 'Mikromoliya', type: 'subsidiary', ownership: 90, method: 'full', currency: 'UZS', activity: { ru: 'Микрофинансирование', uz: 'Mikromoliyalash' }, investmentCost: b(110) },
  { id: 'e5', name: "AJ «Raqamli To'lov Markazi»", shortName: "To'lov Markazi", type: 'associate', ownership: 30, method: 'equity', currency: 'UZS', activity: { ru: 'Платёжные услуги (ассоциированная)', uz: "To'lov xizmatlari (assotsiatsiyalangan)" }, investmentCost: b(150) },
];

/** ОСВ банка по НСБУ на отчётную дату. Отчётность банка строится из сопоставленных счетов. */
export const ifrsTrialBalanceSeed: IfrsTrialBalanceRow[] = [
  { accountCode: '10101', name: { ru: 'Наличные в кассе', uz: 'Kassadagi naqd pul' }, balance: b(2400), ifrsLine: 'cash' },
  { accountCode: '10301', name: { ru: 'Корреспондентский счёт в ЦБ', uz: 'MBdagi vakillik hisobvarag‘i' }, balance: b(3600), ifrsLine: 'cash' },
  { accountCode: '10501', name: { ru: 'Счета ностро в банках', uz: 'Banklardagi nostro hisobvaraqlar' }, balance: b(1900), ifrsLine: 'due_banks' },
  { accountCode: '10521', name: { ru: 'Депозиты в других банках', uz: 'Boshqa banklardagi depozitlar' }, balance: b(2600), ifrsLine: 'due_banks' },
  { accountCode: '12101', name: { ru: 'Кредиты юридическим лицам', uz: 'Yuridik shaxslarga kreditlar' }, balance: b(51000), ifrsLine: 'loans' },
  { accountCode: '12501', name: { ru: 'Кредиты физическим лицам', uz: 'Jismoniy shaxslarga kreditlar' }, balance: b(27000), ifrsLine: 'loans' },
  { accountCode: '10701', name: { ru: 'Ценные бумаги', uz: "Qimmatli qog'ozlar" }, balance: b(2260), ifrsLine: 'investments' },
  { accountCode: '10901', name: { ru: 'Инвестиции в дочерние и ассоциированные', uz: "Sho'ba va assotsiatsiyalangan kompaniyalarga investitsiyalar" }, balance: b(940), ifrsLine: 'investments' },
  { accountCode: '16501', name: { ru: 'Основные средства', uz: 'Asosiy vositalar' }, balance: b(2800), ifrsLine: 'fixed_assets' },
  { accountCode: '16405', name: { ru: 'Прочие активы', uz: 'Boshqa aktivlar' }, balance: b(1380), ifrsLine: 'other_assets' },
  { accountCode: '16999', name: { ru: 'Прочие дебиторы', uz: 'Boshqa debitorlar' }, balance: b(120), ifrsLine: null },
  { accountCode: '20200', name: { ru: 'Депозиты до востребования', uz: 'Talab qilib olinguncha depozitlar' }, balance: b(21000), ifrsLine: 'deposits' },
  { accountCode: '20600', name: { ru: 'Срочные депозиты', uz: "Muddatli depozitlar" }, balance: b(37000), ifrsLine: 'deposits' },
  { accountCode: '21600', name: { ru: 'Привлечённые кредиты', uz: 'Jalb qilingan kreditlar' }, balance: b(22000), ifrsLine: 'borrowings' },
  { accountCode: '22800', name: { ru: 'Прочие обязательства', uz: 'Boshqa majburiyatlar' }, balance: b(2280), ifrsLine: 'other_liabilities' },
  { accountCode: '29801', name: { ru: 'Прочие кредиторы', uz: 'Boshqa kreditorlar' }, balance: b(120), ifrsLine: null },
  { accountCode: '30300', name: { ru: 'Уставный капитал', uz: 'Ustav kapitali' }, balance: b(7200), ifrsLine: 'share_capital' },
  { accountCode: '31203', name: { ru: 'Нераспределённая прибыль прошлых лет', uz: "O'tgan yillar taqsimlanmagan foydasi" }, balance: b(4600), ifrsLine: 'retained' },
  { accountCode: '40000', name: { ru: 'Процентные доходы', uz: 'Foizli daromadlar' }, balance: b(11500), ifrsLine: 'interest_income' },
  { accountCode: '45000', name: { ru: 'Комиссионные доходы', uz: 'Komission daromadlar' }, balance: b(2300), ifrsLine: 'fee_income' },
  { accountCode: '50000', name: { ru: 'Процентные расходы', uz: 'Foizli xarajatlar' }, balance: b(6200), ifrsLine: 'interest_expense' },
  { accountCode: '55000', name: { ru: 'Операционные расходы', uz: 'Operatsion xarajatlar' }, balance: b(4100), ifrsLine: 'opex' },
  { accountCode: '56802', name: { ru: 'Резервы на возможные убытки', uz: "Ehtimoliy zararlar uchun zaxiralar" }, balance: b(1250), ifrsLine: 'ecl_charge' },
  { accountCode: '57000', name: { ru: 'Налог на прибыль', uz: 'Foyda solig‘i' }, balance: b(450), ifrsLine: 'tax' },
];

/** Отчётность дочерних и ассоциированных компаний (в функциональной валюте). Банк — из ОСВ. */
export const ifrsStatementsSeed: IfrsEntityStatement[] = [
  {
    entityId: 'e1',
    values: {
      cash: b(40), due_banks: b(60), loans: b(1900), fixed_assets: b(120), other_assets: b(80),
      borrowings: b(1500), other_liabilities: b(150), share_capital: b(400), retained: b(90),
      interest_income: b(320), interest_expense: b(190), fee_income: b(10), other_income: b(5), opex: b(55), ecl_charge: b(15), tax: b(15),
    },
  },
  {
    entityId: 'e2',
    values: {
      cash: b(30), due_banks: b(210), investments: b(380), fixed_assets: b(25), other_assets: b(55),
      other_liabilities: b(330), share_capital: b(250), retained: b(80),
      interest_income: b(35), fee_income: b(140), other_income: b(5), opex: b(120), ecl_charge: b(2), tax: b(18),
    },
  },
  {
    entityId: 'e3', // значения в USD
    values: {
      cash: 1_200_000, due_banks: 1_600_000, investments: 3_550_000, fixed_assets: 400_000, other_assets: 800_000,
      other_liabilities: 630_000, share_capital: 6_300_000, retained: 380_000,
      interest_income: 320_000, fee_income: 950_000, opex: 950_000, tax: 80_000,
    },
  },
  {
    entityId: 'e4',
    values: {
      cash: b(25), due_banks: b(15), loans: b(480), fixed_assets: b(10), other_assets: b(20),
      borrowings: b(380), other_liabilities: b(20), share_capital: b(120), retained: b(18),
      interest_income: b(135), interest_expense: b(55), fee_income: b(6), opex: b(52), ecl_charge: b(18), tax: b(4),
    },
  },
  {
    entityId: 'e5',
    values: {
      cash: b(100), due_banks: b(300), investments: b(200), fixed_assets: b(200), other_assets: b(100),
      other_liabilities: b(300), share_capital: b(500), retained: b(60),
      interest_income: b(20), fee_income: b(260), opex: b(220), tax: b(20),
    },
  },
];

export const ifrsIntragroupSeed: IfrsIntragroup[] = [
  { id: 'ig1', description: { ru: 'Кредит банка лизинговой компании', uz: 'Bankning lizing kompaniyasiga krediti' }, assetEntityId: 'e0', assetLine: 'loans', liabilityEntityId: 'e1', liabilityLine: 'borrowings', amount: b(600), incomeLine: 'interest_income', expenseLine: 'interest_expense', plAmount: b(70) },
  { id: 'ig2', description: { ru: 'Кредит банка микрофинансовой организации', uz: 'Bankning mikromoliya tashkilotiga krediti' }, assetEntityId: 'e0', assetLine: 'loans', liabilityEntityId: 'e4', liabilityLine: 'borrowings', amount: b(200), incomeLine: 'interest_income', expenseLine: 'interest_expense', plAmount: b(24) },
  { id: 'ig3', description: { ru: 'Депозит страховой компании в банке', uz: "Sug'urta kompaniyasining bankdagi depoziti" }, assetEntityId: 'e2', assetLine: 'due_banks', liabilityEntityId: 'e0', liabilityLine: 'deposits', amount: b(150), incomeLine: 'interest_income', expenseLine: 'interest_expense', plAmount: b(14) },
];

export const ifrsAdjustmentsSeed: IfrsAdjustment[] = [
  {
    id: 'adj1', number: 'IFRS-2026-0011', entityId: 'e0', type: 'ecl', amount: b(420), createdBy: 'u4', createdAt: '2026-10-08T10:00:00Z',
    description: 'Досоздание резерва ОКУ по стадиям 2 и 3 (модель МСФО 9) сверх резервов по НСБУ',
    lines: [{ line: 'loans', delta: -b(420) }, { line: 'ecl_charge', delta: b(420) }],
  },
  {
    id: 'adj2', number: 'IFRS-2026-0012', entityId: 'e0', type: 'lease', amount: b(180), createdBy: 'u7', createdAt: '2026-10-09T09:30:00Z',
    description: 'Признание актива в форме права пользования и обязательства по аренде офисов ЦБУ (МСФО 16)',
    lines: [{ line: 'fixed_assets', delta: b(180) }, { line: 'other_liabilities', delta: b(180) }],
  },
  {
    id: 'adj3', number: 'IFRS-2026-0013', entityId: 'e0', type: 'deferred_tax', amount: b(84), createdBy: 'u7', createdAt: '2026-10-09T11:00:00Z',
    description: 'Отложенный налоговый актив по временным разницам резерва ОКУ (20%)',
    lines: [{ line: 'other_assets', delta: b(84) }, { line: 'tax', delta: -b(84) }],
  },
  {
    id: 'adj4', number: 'IFRS-2026-0014', entityId: 'e1', type: 'ecl', amount: b(12), createdBy: 'u4', createdAt: '2026-10-10T08:00:00Z',
    description: 'Резерв ОКУ по лизинговому портфелю',
    lines: [{ line: 'loans', delta: -b(12) }, { line: 'ecl_charge', delta: b(12) }],
  },
];

export const ifrsCloseTasksSeed: IfrsCloseTask[] = [
  { id: 'ct1', title: { ru: 'Закрытие ОСВ банка по НСБУ', uz: 'Bank aylanma qoldiq vedomostini yopish (MBHS)' }, ownerId: 'u7', dueDate: '2026-10-05', done: true },
  { id: 'ct2', title: { ru: 'Получение отчётности дочерних компаний', uz: "Sho'ba kompaniyalar hisobotlarini olish" }, ownerId: 'u7', dueDate: '2026-10-07', done: true },
  { id: 'ct3', title: { ru: 'Сопоставление счетов НСБУ со строками МСФО', uz: 'MBHS hisobvaraqlarini MHXS satrlari bilan moslashtirish' }, ownerId: 'u7', dueDate: '2026-10-10', done: false },
  { id: 'ct4', title: { ru: 'Расчёт резервов ОКУ (МСФО 9)', uz: "KKZ zaxiralarini hisoblash (MHXS 9)" }, ownerId: 'u4', dueDate: '2026-10-12', done: true },
  { id: 'ct5', title: { ru: 'Корректировки по аренде (МСФО 16)', uz: "Ijara bo'yicha tuzatishlar (MHXS 16)" }, ownerId: 'u7', dueDate: '2026-10-12', done: true },
  { id: 'ct6', title: { ru: 'Сверка внутригрупповых остатков', uz: 'Guruh ichidagi qoldiqlarni solishtirish' }, ownerId: 'u7', dueDate: '2026-10-14', done: false },
  { id: 'ct7', title: { ru: 'Консолидация и расчёт доли неконтролирующих участников', uz: 'Konsolidatsiya va nazorat qilmaydigan ulushni hisoblash' }, ownerId: 'u4', dueDate: '2026-10-17', done: false },
  { id: 'ct8', title: { ru: 'Проверка аудитором и утверждение отчётности', uz: 'Auditor tekshiruvi va hisobotni tasdiqlash' }, ownerId: 'u4', dueDate: '2026-10-25', done: false },
];
