// Демо-данные модуля «Отчётность»: каталог управленческих отчётов и подписки (вымышленные).
import type { ReportArea, ReportBuiltinKey, ReportDefinition, ReportSchedule, ReportSubscription } from './types';

const R = (id: string, code: string, area: ReportArea, ownerId: string, schedule: ReportSchedule, builtin: ReportBuiltinKey, ru: string, uz: string, en: string, dru: string, duz: string, den: string): ReportDefinition => ({
  id, code, area, ownerId, schedule, builtin, kind: ['regulatory', 'cbu', 'tax', 'statistical'].includes(area) || code.endsWith('-REG') || code.endsWith('-TURN') ? 'regulated' : 'management',
  name: { ru, uz, en }, description: { ru: dru, uz: duz, en: den },
});

export const reportCatalogSeed: ReportDefinition[] = [
  {
    id: 'r1', code: 'RPT-PRC-01', area: 'procurement', ownerId: 'u3', schedule: 'weekly', builtin: 'procurement_by_department',
    name: { ru: 'Заявки на закупку по подразделениям', uz: "Bo'linmalar bo'yicha xarid arizalari", en: 'Purchase requests by department' }, kind: 'management',
    description: { ru: 'Количество и сумма заявок по подразделениям и статусам', uz: "Bo'linmalar va holatlar bo'yicha arizalar soni va summasi", en: 'Number and amount of requests by department and status' },
  },
  {
    id: 'r2', code: 'RPT-CNT-01', area: 'contracts', ownerId: 'u5', schedule: 'monthly', builtin: 'contracts_payments',
    name: { ru: 'Исполнение договоров и платежей', uz: "Shartnomalar va to'lovlar ijrosi", en: 'Contract and payment execution' }, kind: 'management',
    description: { ru: 'Сумма договоров, оплачено, остаток и просроченные платежи', uz: "Shartnomalar summasi, to'langan, qoldiq va muddati o'tgan to'lovlar", en: 'Contract amount, paid, outstanding and overdue payments' },
  },
  {
    id: 'r3', code: 'RPT-APR-01', area: 'approvals', ownerId: 'u6', schedule: 'daily', builtin: 'approvals_sla',
    name: { ru: 'Сроки согласования документов (SLA)', uz: 'Hujjatlarni kelishish muddatlari (SLA)', en: 'Document approval times (SLA)' }, kind: 'management',
    description: { ru: 'Документы на согласовании, просрочки и средний возраст задач', uz: "Kelishuvdagi hujjatlar, muddati o'tganlar va vazifalarning o'rtacha yoshi", en: 'Documents in approval, overdue tasks and average age' },
  },
  {
    id: 'r4', code: 'RPT-BDG-01', area: 'budget', ownerId: 'u4', schedule: 'monthly', builtin: 'budget_execution',
    name: { ru: 'Исполнение бюджета по статьям', uz: "Moddalar bo'yicha byudjet ijrosi", en: 'Budget execution by line' }, kind: 'management',
    description: { ru: 'План, факт, остаток и процент исполнения по статьям', uz: "Moddalar bo'yicha reja, fakt, qoldiq va ijro foizi", en: 'Plan, actual, remaining and execution % by line' },
  },
  {
    id: 'r5', code: 'RPT-FIN-01', area: 'finance', ownerId: 'u4', schedule: 'quarterly', link: '/ifrs',
    name: { ru: 'Консолидированная отчётность по МСФО', uz: 'MHXS bo‘yicha konsolidatsiyalangan hisobot', en: 'Consolidated IFRS statements' }, kind: 'regulated',
    description: { ru: 'Отчёт о финансовом положении и прибылях группы', uz: "Guruhning moliyaviy holati va foydalari to'g'risidagi hisobot", en: 'Group financial position and profit' },
  },
  {
    id: 'r6', code: 'RPT-FIN-02', area: 'finance', ownerId: 'u8', schedule: 'monthly', link: '/cash',
    name: { ru: 'Себестоимость кассового обслуживания', uz: 'Kassa xizmati tannarxi', en: 'Cash service cost' }, kind: 'management',
    description: { ru: 'Доходы, расходы и себестоимость 1 млн сум по филиалам', uz: "Filiallar bo'yicha daromad, xarajat va 1 mln so'm tannarxi", en: 'Income, costs and cost per 1 mln UZS by branch' },
  },
  {
    id: 'r7', code: 'RPT-OPS-01', area: 'operations', ownerId: 'u6', schedule: 'weekly', link: '/operations',
    name: { ru: 'Нагрузка и узкие места XB-ERP', uz: 'XB-ERP yuklamasi va tor joylari', en: 'XB-ERP workload and bottlenecks' }, kind: 'management',
    description: { ru: 'Документооборот по модулям, SLA и активность подразделений', uz: "Modullar bo'yicha hujjat aylanishi, SLA va bo'linmalar faolligi", en: 'Document flow by module, SLA and department activity' },
  },
  // Регламентированная отчётность (PR-REP-001…005)
  R('r8', 'RPT-IFRS-SFP', 'regulatory', 'u4', 'quarterly', 'ifrs_sfp', 'Отчёт о финансовом положении (МСФО, консолидированный)', "Moliyaviy holat to'g'risidagi hisobot (MHXS, konsolidatsiyalangan)", 'Statement of financial position (IFRS, consolidated)', 'Активы, обязательства и капитал группы на отчётную дату', "Hisobot sanasiga guruh aktivlari, majburiyatlari va kapitali", 'Group assets, liabilities and equity at the reporting date'),
  R('r9', 'RPT-IFRS-PL', 'regulatory', 'u4', 'quarterly', 'ifrs_pl', 'Отчёт о прибылях и убытках (МСФО)', "Foyda va zararlar to'g'risidagi hisobot (MHXS)", 'Statement of profit or loss (IFRS)', 'Доходы, расходы, прибыль акционеров и НКД', 'Daromadlar, xarajatlar, aksiyadorlar foydasi va NNU', 'Income, expenses, profit to owners and NCI'),
  R('r10', 'RPT-IFRS-CF', 'regulatory', 'u4', 'quarterly', 'ifrs_cf', 'Отчёт о движении денежных средств (МСФО, косвенный метод)', "Pul mablag'lari harakati to'g'risidagi hisobot (MHXS, bilvosita usul)", 'Statement of cash flows (IFRS, indirect method)', 'Операционная, инвестиционная и финансовая деятельность группы', 'Guruhning operatsion, investitsiya va moliyaviy faoliyati', 'Group operating, investing and financing activities'),
  R('r11', 'RPT-IFRS-EQ', 'regulatory', 'u4', 'quarterly', 'ifrs_equity', 'Отчёт об изменениях в капитале (МСФО)', "Kapitaldagi o'zgarishlar to'g'risidagi hisobot (MHXS)", 'Statement of changes in equity (IFRS)', 'Капитал на начало, прибыль, дивиденды, НКД, капитал на конец', 'Boshidagi kapital, foyda, dividendlar, NNU, oxiridagi kapital', 'Opening equity, profit, dividends, NCI, closing equity'),
  R('r12', 'RPT-IFRS-NOTES', 'regulatory', 'u4', 'quarterly', 'ifrs_notes', 'Примечания к отчётности МСФО (по компаниям группы)', "MHXS hisobotiga izohlar (guruh kompaniyalari bo'yicha)", 'Notes to IFRS statements (by group entity)', 'Доли владения, активы, капитал, прибыль, гудвил и НКД по компаниям', "Kompaniyalar bo'yicha egalik ulushlari, aktivlar, kapital, foyda", 'Ownership, assets, equity, profit, goodwill and NCI by entity'),
  R('r13', 'RPT-NSBU-01', 'regulatory', 'u7', 'monthly', 'nsbu_balance', 'Бухгалтерский баланс банка (НСБУ)', 'Bankning buxgalteriya balansi (MBHS)', 'Bank balance sheet (national standards)', 'Остатки ОСВ по разделам плана счетов ЦБ РУз', "MB RUz hisobvaraqlar rejasi bo'limlari bo'yicha AQV qoldiqlari", 'Trial balance by CBU chart-of-accounts sections'),
  R('r14', 'RPT-CBU-01', 'cbu', 'u7', 'monthly', 'cbu_balance', 'Форма 1 для ЦБ РУз: баланс по главам', "MB RUz uchun 1-shakl: boblar bo'yicha balans", 'CBU Form 1: balance by chapter', 'Сводные остатки по главам плана счетов для Центрального банка', "Markaziy bank uchun hisobvaraqlar rejasi boblari bo'yicha yig'ma qoldiqlar", 'Summary balances by chart chapter for the Central Bank'),
  R('r15', 'RPT-CBU-02', 'cbu', 'u8', 'monthly', 'cbu_cash', 'Отчёт ЦБ о кассовых остатках и лимитах', 'MB uchun kassa qoldiqlari va limitlari hisoboti', 'CBU report on cash balances and limits', 'Остатки наличности по подразделениям и валютам, соблюдение лимитов', "Bo'linmalar va valyutalar bo'yicha naqd pul qoldiqlari, limitlarga rioya", 'Cash balances by unit and currency, limit compliance'),
  R('r16', 'RPT-TAX-01', 'tax', 'u17', 'monthly', 'tax_register', 'Реестр налоговых расчётов и платежей', "Soliq hisob-kitoblari va to'lovlari reyestri", 'Tax returns and payments register', 'Начислено, уплачено, задолженность и статус сдачи по видам налогов', "Soliq turlari bo'yicha hisoblangan, to'langan, qarz va topshirish holati", 'Accrued, paid, outstanding and filing status by tax'),
  R('r17', 'RPT-TAX-02', 'tax', 'u17', 'monthly', 'tax_leases', 'Реестр аренды у физических лиц (НДФЛ)', "Jismoniy shaxslardan ijara reyestri (JShDS)", 'Register of leases from individuals (PIT)', 'Договор, ПИНФЛ арендодателя, адрес, удержанный НДФЛ', 'Shartnoma, ijaraga beruvchi JShShIR, manzil, ushlangan JShDS', 'Contract, lessor PINFL, address, withheld PIT'),
  R('r18', 'RPT-STAT-1T', 'statistical', 'u13', 'quarterly', 'stat_labour', 'Форма 1-Т «Отчёт по труду» (Госкомстат)', "1-T shakli «Mehnat bo'yicha hisobot» (Statistika qo'mitasi)", 'Form 1-T “Labour report” (Statistics Agency)', 'Численность, приём, увольнение, фонд оплаты труда по подразделениям (Laborlaw)', "Bo'linmalar bo'yicha xodimlar soni, qabul, bo'shatish, mehnatga haq to'lash fondi (Laborlaw)", 'Headcount, hires, separations, payroll by department (Laborlaw)'),
  R('r19', 'RPT-STAT-INV', 'statistical', 'u4', 'quarterly', 'stat_capex', 'Форма 2-инвест «Капитальные вложения»', "2-invest shakli «Kapital qo'yilmalar»", 'Form 2-invest “Capital investment”', 'Поступление основных средств за год по видам', "Yil davomida asosiy vositalar kirimi turlari bo'yicha", 'Fixed-asset additions for the year by type'),
  R('r20', 'RPT-AST-REG', 'assets', 'u7', 'monthly', 'assets_register', 'Инвентарная ведомость основных средств', "Asosiy vositalar inventar qaydnomasi", 'Fixed asset inventory statement', 'Инвентарный номер, первоначальная стоимость, амортизация, остаточная стоимость', "Inventar raqami, boshlang'ich qiymat, amortizatsiya, qoldiq qiymat", 'Inventory number, cost, depreciation, net book value'),
  R('r21', 'RPT-WMS-TURN', 'assets', 'u14', 'monthly', 'warehouse_turnover', 'Оборотная ведомость ТМЗ', 'TMZ aylanma qaydnomasi', 'Inventory turnover statement', 'Остаток, поступление, расход и остаток на конец по номенклатуре', "Nomenklatura bo'yicha qoldiq, kirim, chiqim va oxirgi qoldiq", 'Opening, receipts, issues and closing by item'),
  // Управленческая отчётность (PR-REP-008…012)
  R('r22', 'RPT-HR-01', 'hr', 'u13', 'monthly', 'hr_report', 'HR-отчёт: численность, движение, ФОТ', 'HR hisoboti: xodimlar soni, harakati, MHTF', 'HR report: headcount, movement, payroll', 'Данные Laborlaw (HR & Payroll) по подразделениям, текучесть', "Bo'linmalar bo'yicha Laborlaw (HR & Payroll) ma'lumotlari, qo'nimsizlik", 'Laborlaw (HR & Payroll) data by department, turnover'),
  R('r23', 'RPT-WMS-01', 'assets', 'u14', 'weekly', 'warehouse_report', 'Отчёт по складу: остатки и движение по категориям', "Ombor hisoboti: toifalar bo'yicha qoldiq va harakat", 'Warehouse report: stock and movement by category', 'Стоимость запасов, поступление и выдача за период, позиции ниже минимума', "Zaxiralar qiymati, davr uchun kirim va chiqim, minimumdan past pozitsiyalar", 'Stock value, receipts and issues for the period, items below minimum'),
  R('r24', 'RPT-AST-01', 'assets', 'u7', 'monthly', 'assets_report', 'Отчёт по основным средствам: стоимость, износ, движение', "Asosiy vositalar hisoboti: qiymat, eskirish, harakat", 'Fixed asset report: cost, wear, movement', 'По категориям: количество, стоимость, износ, остаточная стоимость, к списанию', "Toifalar bo'yicha: soni, qiymati, eskirishi, qoldiq qiymati, hisobdan chiqarishga", 'By category: count, cost, wear, NBV, pending write-off'),
  R('r25', 'RPT-FLT-01', 'fleet', 'u6', 'monthly', 'fleet_report', 'Отчёт по автопарку: пробег, ГСМ, затраты', "Avtopark hisoboti: masofa, YoMM, xarajatlar", 'Fleet report: mileage, fuel, costs', 'По каждому ТС: рейсы, пробег, расход топлива к норме, затраты на ремонт', "Har bir TV bo'yicha: reyslar, masofa, me'yorga nisbatan yoqilg'i, ta'mirlash xarajatlari", 'Per vehicle: trips, mileage, fuel vs norm, repair costs'),
  R('r26', 'RPT-TRP-01', 'trips', 'u13', 'monthly', 'trips_report', 'Отчёт по служебным командировкам', "Xizmat safarlari bo'yicha hisobot", 'Business trip report', 'Количество и затраты командировок по подразделениям', "Bo'linmalar bo'yicha safarlar soni va xarajatlari", 'Number and cost of trips by department'),
];

export const reportSubscriptionsSeed: ReportSubscription[] = [
  { id: 'rs1', reportId: 'r3', userId: 'u2', frequency: 'daily', format: 'pdf', email: 'n.karimova@example.uz', createdAt: '2026-09-02T08:00:00Z', nextRunAt: '2026-10-18T03:00:00Z', lastRunAt: '2026-10-17T03:00:00Z', active: true },
  { id: 'rs2', reportId: 'r4', userId: 'u4', frequency: 'monthly', format: 'xlsx', email: 'd.yusupova@example.uz', createdAt: '2026-08-15T08:00:00Z', nextRunAt: '2026-11-01T03:00:00Z', lastRunAt: '2026-10-01T03:00:00Z', active: true },
  { id: 'rs3', reportId: 'r1', userId: 'u3', frequency: 'weekly', format: 'xlsx', email: 'j.rahimov@example.uz', createdAt: '2026-09-20T08:00:00Z', nextRunAt: '2026-10-19T03:00:00Z', lastRunAt: '2026-10-12T03:00:00Z', active: true },
];
