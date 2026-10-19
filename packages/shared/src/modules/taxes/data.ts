// Демо-данные модуля «Налоги» (вымышленные суммы; ставки — демо-настройки).
import type { TaxReturn, TaxSetting } from './types';

export const taxSettings: TaxSetting[] = [
  { type: 'vat', rate: 12, factor: 1, periodicity: 'monthly', dueDay: 20, baseHint: { ru: 'Облагаемый оборот по небанковским услугам', uz: "Bank bo'lmagan xizmatlar bo'yicha soliqqa tortiladigan aylanma" } },
  { type: 'profit', rate: 20, factor: 1, periodicity: 'quarterly', dueDay: 25, baseHint: { ru: 'Налогооблагаемая прибыль за квартал', uz: 'Chorak uchun soliq solinadigan foyda' } },
  { type: 'property', rate: 1.5, factor: 0.25, periodicity: 'quarterly', dueDay: 20, baseHint: { ru: 'Среднегодовая стоимость имущества (квартальный аванс)', uz: "Mol-mulkning o'rtacha yillik qiymati (choraklik avans)" } },
  { type: 'social', rate: 12, factor: 1, periodicity: 'monthly', dueDay: 15, baseHint: { ru: 'Фонд оплаты труда за месяц', uz: "Oylik mehnatga haq to'lash fondi" } },
  { type: 'pit', rate: 12, factor: 1, periodicity: 'monthly', dueDay: 15, baseHint: { ru: 'Доходы сотрудников, удержание у источника', uz: "Xodimlar daromadlari, to'lov manbaida ushlab qolish" } },
  { type: 'withholding', rate: 10, factor: 1, periodicity: 'monthly', dueDay: 20, baseHint: { ru: 'Выплаты нерезидентам (проценты, дивиденды, услуги)', uz: "Norezidentlarga to'lovlar (foizlar, dividendlar, xizmatlar)" } },
  { type: 'land', rate: 0, factor: 0.25, periodicity: 'quarterly', dueDay: 20, baseHint: { ru: 'Площадь земельных участков всех филиалов × ставка за 1 га (квартальный аванс)', uz: "Barcha filiallar yer uchastkalari maydoni × 1 ga stavkasi (choraklik avans)", en: 'Land area of all branches × rate per ha (quarterly advance)' } },
  { type: 'water', rate: 0, factor: 1, periodicity: 'quarterly', dueDay: 20, baseHint: { ru: 'Объём воды за квартал (м³) × ставка по источнику (поверхностный/подземный)', uz: "Chorak uchun suv hajmi (m³) × manba stavkasi (yer usti/yer osti)", en: 'Water volume for the quarter (m³) × rate by source (surface/underground)' } },
  { type: 'rent_pit', rate: 12, factor: 1, periodicity: 'monthly', dueDay: 15, baseHint: { ru: 'Арендная плата физлицам, не ниже минимальной ставки (налоговый агент)', uz: "Jismoniy shaxslarga ijara haqi, minimal stavkadan kam emas (soliq agenti)", en: 'Rent paid to individuals, not below the minimum rate (tax agent)' } },
];

const L = (ru: string, uz: string, amount: number) => ({ label: { ru, uz }, amount });
const B = 1_000_000_000;
const M = 1_000_000;

const vatLines = (k: number) => [
  L('Сдача имущества в аренду', "Mol-mulkni ijaraga berish", Math.round(18.4 * B * k)),
  L('Реализация залогового имущества', "Garov mulkini sotish", Math.round(31.2 * B * k)),
  L('Небанковские комиссии и услуги', "Bank bo'lmagan komissiyalar va xizmatlar", Math.round(46.9 * B * k)),
];
const payrollLines = (k: number) => [
  L('Заработная плата', 'Ish haqi', Math.round(142.6 * B * k)),
  L('Премии и надбавки', "Mukofotlar va ustamalar", Math.round(23.8 * B * k)),
  L('Отпускные и прочие выплаты', "Ta'til va boshqa to'lovlar", Math.round(11.4 * B * k)),
];
const whtLines = (k: number) => [
  L('Проценты по кредитным линиям МФИ', "XMT kredit liniyalari bo'yicha foizlar", Math.round(28.7 * B * k)),
  L('Услуги иностранных поставщиков ПО', "Xorijiy dasturiy ta'minot yetkazib beruvchilari xizmatlari", Math.round(6.3 * B * k)),
];
const profitLines = (k: number) => [
  L('Процентные доходы', 'Foiz daromadlari', Math.round(2_960 * B * k)),
  L('Комиссионные доходы', 'Komissiya daromadlari', Math.round(612 * B * k)),
  L('Процентные расходы', 'Foiz xarajatlari', -Math.round(1_710 * B * k)),
  L('Операционные расходы', 'Operatsion xarajatlar', -Math.round(986 * B * k)),
  L('Резервы под кредитные убытки (вычитаемые)', "Kredit zararlari bo'yicha zaxiralar (chegiriladigan)", -Math.round(318 * B * k)),
];
const propertyLines = [
  L('Здания и сооружения', 'Binolar va inshootlar', 2_840 * B),
  L('Оборудование и транспорт (облагаемая часть)', "Uskunalar va transport (soliqqa tortiladigan qismi)", 610 * B),
];

const ev = (at: string, userId: string, comment?: string) => ({ at, userId, action: 'status_changed' as const, ...(comment ? { comment } : {}) });

export const taxReturns: TaxReturn[] = [
  // НДС
  { id: 'tx1', number: 'TX-2026-0181', type: 'vat', period: '2026-08', dueDate: '2026-09-20', status: 'accepted', baseLines: vatLines(0.97), credits: 4_120 * M, creditsLabel: { ru: 'Входящий НДС к зачёту', uz: "Hisobga olinadigan kiruvchi QQS" },
    payments: [{ date: '2026-09-18', amount: 7_437_520_000, reference: 'PP-48812' }], history: [{ at: '2026-09-05T10:00:00Z', userId: 'u7', action: 'created' }, ev('2026-09-12T09:00:00Z', 'u7', '@taxes_hist_accepted')] },
  { id: 'tx2', number: 'TX-2026-0203', type: 'vat', period: '2026-09', dueDate: '2026-10-20', status: 'calculated', baseLines: vatLines(1), credits: 4_480 * M, creditsLabel: { ru: 'Входящий НДС к зачёту', uz: "Hisobga olinadigan kiruvchi QQS" },
    payments: [], history: [{ at: '2026-10-06T09:30:00Z', userId: 'u7', action: 'created' }] },
  { id: 'tx3', number: 'TX-2026-0227', type: 'vat', period: '2026-10', dueDate: '2026-11-20', status: 'draft', baseLines: vatLines(1.03), credits: 4_600 * M, creditsLabel: { ru: 'Входящий НДС к зачёту', uz: "Hisobga olinadigan kiruvchi QQS" },
    payments: [], history: [{ at: '2026-10-16T09:30:00Z', userId: 'u7', action: 'created' }] },
  // Социальный налог
  { id: 'tx4', number: 'TX-2026-0198', type: 'social', period: '2026-09', dueDate: '2026-10-15', status: 'submitted', baseLines: payrollLines(1), credits: 0,
    payments: [{ date: '2026-10-14', amount: 21_336_000_000, reference: 'PP-49207' }], history: [{ at: '2026-10-03T08:00:00Z', userId: 'u7', action: 'created' }, ev('2026-10-10T11:00:00Z', 'u7', '@taxes_hist_submitted')] },
  { id: 'tx5', number: 'TX-2026-0228', type: 'social', period: '2026-10', dueDate: '2026-11-15', status: 'draft', baseLines: payrollLines(1.01), credits: 0, payments: [], history: [{ at: '2026-10-16T09:40:00Z', userId: 'u7', action: 'created' }] },
  // НДФЛ (удержание)
  { id: 'tx6', number: 'TX-2026-0199', type: 'pit', period: '2026-09', dueDate: '2026-10-15', status: 'draft', baseLines: payrollLines(1), credits: 0, payments: [], history: [{ at: '2026-10-03T08:05:00Z', userId: 'u7', action: 'created' }] },
  // Налог у источника
  { id: 'tx7', number: 'TX-2026-0204', type: 'withholding', period: '2026-09', dueDate: '2026-10-20', status: 'submitted', baseLines: whtLines(1), credits: 0,
    payments: [{ date: '2026-10-12', amount: 3_500_000_000, reference: 'PP-49144' }], history: [{ at: '2026-10-07T10:00:00Z', userId: 'u7', action: 'created' }, ev('2026-10-11T12:00:00Z', 'u7', '@taxes_hist_submitted')] },
  // Налог на прибыль
  { id: 'tx8', number: 'TX-2026-0121', type: 'profit', period: '2026-Q2', dueDate: '2026-07-25', status: 'accepted', baseLines: profitLines(0.39), credits: 0,
    payments: [{ date: '2026-07-22', amount: 106_970_000_000, reference: 'PP-41003' }], history: [{ at: '2026-07-10T10:00:00Z', userId: 'u7', action: 'created' }, ev('2026-07-20T10:00:00Z', 'u7', '@taxes_hist_accepted')] },
  { id: 'tx9', number: 'TX-2026-0211', type: 'profit', period: '2026-Q3', dueDate: '2026-10-25', status: 'draft', baseLines: profitLines(1), credits: 0, creditsLabel: { ru: 'Уплаченные авансовые платежи', uz: "To'langan avans to'lovlari" },
    payments: [], source: 'registry', history: [{ at: '2026-10-09T10:00:00Z', userId: 'u7', action: 'created' }] },
  // Налог на имущество
  { id: 'tx10', number: 'TX-2026-0212', type: 'property', period: '2026-Q3', dueDate: '2026-10-20', status: 'calculated', baseLines: propertyLines, credits: 0, payments: [], source: 'registry', history: [{ at: '2026-10-09T10:10:00Z', userId: 'u7', action: 'created' }] },
  // Земельный налог, налог за воду, НДФЛ по аренде у физлиц — строки формируются из реестров
  { id: 'tx11', number: 'TX-2026-0213', type: 'land', period: '2026-Q3', dueDate: '2026-10-20', status: 'calculated', baseLines: [], credits: 0, payments: [], source: 'registry', history: [{ at: '2026-10-09T10:20:00Z', userId: 'u17', action: 'created' }] },
  { id: 'tx12', number: 'TX-2026-0214', type: 'water', period: '2026-Q3', dueDate: '2026-10-20', status: 'draft', baseLines: [], credits: 0, payments: [], source: 'registry', history: [{ at: '2026-10-10T09:00:00Z', userId: 'u17', action: 'created' }] },
  { id: 'tx13', number: 'TX-2026-0215', type: 'rent_pit', period: '2026-09', dueDate: '2026-10-15', status: 'draft', baseLines: [], credits: 0, payments: [], source: 'registry', history: [{ at: '2026-10-05T09:00:00Z', userId: 'u17', action: 'created' }] },
];
