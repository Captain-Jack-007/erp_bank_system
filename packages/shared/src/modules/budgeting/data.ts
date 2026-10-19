// Демо-данные модуля «Бюджетирование» (вымышленные). Бюджет 2026 г., факт закрыт по сентябрь.
import type {
  BudgetingArticle,
  BudgetingCapexRequest,
  BudgetingCashPlanRow,
  BudgetingChange,
  BudgetingGoal,
  BudgetingLine,
  BudgetingOverrun,
  BudgetingProject,
  BudgetingScenario,
  BudgetingSettings,
  BudgetingTxn,
  BudgetingZbbBasis,
  BudgetingZbbPackage,
} from './types';

export const BUDGET_YEAR = 2026;
export const CLOSED_MONTHS = 9; // январь–сентябрь закрыты фактом

export const budgetingArticles: BudgetingArticle[] = [
  { id: 'ba1', code: 'OPEX-01', name: { ru: 'Фонд оплаты труда', uz: "Mehnatga haq to'lash fondi", en: 'Payroll fund' }, group: 'opex', controlMode: 'soft' },
  { id: 'ba2', code: 'OPEX-02', name: { ru: 'Аренда и содержание помещений', uz: 'Ijara va binolarni saqlash', en: 'Rent and premises maintenance' }, group: 'opex', controlMode: 'soft' },
  { id: 'ba3', code: 'OPEX-03', name: { ru: 'Сопровождение ИТ и лицензии', uz: 'AT xizmati va litsenziyalar', en: 'IT support and licences' }, group: 'opex', controlMode: 'soft', mdmCode: '2026-IT-SW' },
  { id: 'ba4', code: 'OPEX-04', name: { ru: 'Связь и каналы передачи данных', uz: "Aloqa va ma'lumot uzatish kanallari", en: 'Telecom and data links' }, group: 'opex', controlMode: 'soft', mdmCode: '2026-OTH-COM' },
  { id: 'ba5', code: 'OPEX-05', name: { ru: 'Маркетинг и реклама', uz: 'Marketing va reklama', en: 'Marketing and advertising' }, group: 'opex', controlMode: 'soft', mdmCode: '2026-MKT-ADV' },
  { id: 'ba6', code: 'OPEX-06', name: { ru: 'Обучение персонала', uz: "Xodimlarni o'qitish", en: 'Staff training' }, group: 'opex', controlMode: 'soft', mdmCode: '2026-HR-TRN' },
  { id: 'ba7', code: 'OPEX-07', name: { ru: 'Командировочные расходы', uz: 'Xizmat safari xarajatlari', en: 'Business travel' }, group: 'opex', controlMode: 'hard' },
  { id: 'ba8', code: 'OPEX-08', name: { ru: 'Консалтинг и аудит', uz: 'Konsalting va audit', en: 'Consulting and audit' }, group: 'opex', controlMode: 'soft' },
  { id: 'ba9', code: 'CAPEX-01', name: { ru: 'ИТ-оборудование', uz: 'AT uskunalari', en: 'IT equipment' }, group: 'capex', controlMode: 'hard', mdmCode: '2026-IT-HW' },
  { id: 'ba10', code: 'CAPEX-02', name: { ru: 'Разработка ПО', uz: "Dasturiy ta'minot ishlab chiqish", en: 'Software development' }, group: 'capex', controlMode: 'hard', mdmCode: '2026-IT-DEV' },
  { id: 'ba11', code: 'CAPEX-03', name: { ru: 'Ремонт и реконструкция зданий', uz: "Binolarni ta'mirlash va rekonstruksiya", en: 'Building repair and reconstruction' }, group: 'capex', controlMode: 'hard' },
  { id: 'ba12', code: 'CAPEX-04', name: { ru: 'Транспортные средства', uz: 'Transport vositalari', en: 'Vehicles' }, group: 'capex', controlMode: 'hard', mdmCode: '2026-ADM-AUTO' },
  { id: 'ba13', code: 'CAPEX-05', name: { ru: 'Мебель и оснащение офисов', uz: 'Mebel va ofis jihozlari', en: 'Office furniture and fittings' }, group: 'capex', controlMode: 'hard', mdmCode: '2026-ADM-FURN' },
];

/** Статьи бюджета ядра (закупки) → строка бюджета модуля (подразделение × статья). Единый источник: ядро только ссылается. */
export const CORE_LINE_MAP: Record<string, { departmentId: string; articleId: string }> = {
  b1: { departmentId: 'd1', articleId: 'ba9' },
  b2: { departmentId: 'd1', articleId: 'ba3' },
  b3: { departmentId: 'd2', articleId: 'ba13' },
  b4: { departmentId: 'd2', articleId: 'ba12' },
};

export const budgetingGoals: BudgetingGoal[] = [
  { id: 'g1', code: 'SG-1', name: { ru: 'Цифровая трансформация банка', uz: 'Bankni raqamli transformatsiya qilish', en: 'Digital transformation of the bank' } },
  { id: 'g2', code: 'SG-2', name: { ru: 'Развитие розничной сети и клиентского сервиса', uz: 'Chakana tarmoq va mijozlarga xizmatni rivojlantirish', en: 'Retail network and customer service development' } },
  { id: 'g3', code: 'SG-3', name: { ru: 'Операционная эффективность (Cost-to-Income)', uz: 'Operatsion samaradorlik (Cost-to-Income)', en: 'Operational efficiency (cost-to-income)' } },
  { id: 'g4', code: 'SG-4', name: { ru: 'Управление рисками и комплаенс', uz: 'Risklarni boshqarish va komplayens', en: 'Risk management and compliance' } },
  { id: 'g5', code: 'SG-5', name: { ru: 'Развитие персонала', uz: 'Xodimlarni rivojlantirish', en: 'People development' } },
];

/** ZBB-обоснование статей бюджета 2026 (экономическое обоснование, цель, риски нефинансирования). */
const ARTICLE_ZBB: Record<string, BudgetingZbbBasis> = {
  ba1: { justification: 'Штатное расписание на 2026 г., индексация окладов 8% с 01.04, нормы премирования по KPI.', goalId: 'g5', impact: 'Отток ключевых сотрудников, невыполнение плана продаж и сервисных нормативов.' },
  ba2: { justification: 'Договоры аренды 46 помещений, тарифы коммунальных услуг 2026 г., график планово-предупредительных работ.', goalId: 'g2', impact: 'Закрытие точек обслуживания, штрафы арендодателей, нарушение санитарных норм.' },
  ba3: { justification: 'Реестр лицензий (842 ед.) со сроками продления, договоры сопровождения АБС и процессинга.', goalId: 'g1', impact: 'Остановка АБС и процессинга, нарушение лицензионных условий.' },
  ba4: { justification: 'Каналы связи филиалов (14) и ЦБУ, резервирование каналов ЦОД.', goalId: 'g3', impact: 'Перебои в обслуживании клиентов, недоступность ДБО.' },
  ba5: { justification: 'Медиаплан кампаний по продуктам розницы, запуск мобильного приложения.', goalId: 'g2', impact: 'Невыполнение плана привлечения клиентов и депозитов.' },
  ba6: { justification: 'План обучения: 1 200 сотрудников, обязательные курсы ЦБ по ПОД/ФТ.', goalId: 'g5', impact: 'Несоответствие требованиям регулятора, рост операционных ошибок.' },
  ba7: { justification: 'План выездных проверок и проектных командировок по регионам.', goalId: 'g4', impact: 'Срыв графика проверок филиалов.' },
  ba8: { justification: 'Обязательный аудит МСФО, консалтинг по внедрению IFRS 9 и ERP.', goalId: 'g4', impact: 'Нарушение сроков отчётности, предписания регулятора.' },
  ba9: { justification: 'План замены оборудования старше 5 лет и расширения резервного ЦОД.', goalId: 'g1', impact: 'Отказы оборудования, риск потери данных.' },
  ba10: { justification: 'Портфель ИТ-проектов: ДБО, ERP, скоринг; трудозатраты по оценке проектного офиса.', goalId: 'g1', impact: 'Отставание от конкурентов в цифровых каналах.' },
  ba11: { justification: 'Дефектные ведомости зданий филиалов, проект реконструкции ЦБУ.', goalId: 'g2', impact: 'Аварийное состояние помещений, закрытие ЦБУ.' },
  ba12: { justification: 'Замена автомобилей инкассации с пробегом более 300 тыс. км.', goalId: 'g3', impact: 'Срыв маршрутов инкассации, рост затрат на ремонт.' },
  ba13: { justification: 'Оснащение новых и реконструируемых ЦБУ по типовому проекту.', goalId: 'g2', impact: 'Задержка открытия ЦБУ.' },
};

/** Годовой план по строкам (млн UZS) и коэффициент исполнения факта (1 = по плану). */
const SPEC: { dep: string; art: string; planMln: number; exec: number }[] = [
  // ИТ
  { dep: 'd1', art: 'ba1', planMln: 96_000, exec: 0.98 },
  { dep: 'd1', art: 'ba3', planMln: 148_000, exec: 1.04 },
  { dep: 'd1', art: 'ba4', planMln: 62_000, exec: 0.95 },
  { dep: 'd1', art: 'ba6', planMln: 4_800, exec: 0.7 },
  { dep: 'd1', art: 'ba9', planMln: 120_000, exec: 0.93 },
  { dep: 'd1', art: 'ba10', planMln: 85_000, exec: 0.82 },
  // АХД
  { dep: 'd2', art: 'ba1', planMln: 54_000, exec: 0.99 },
  { dep: 'd2', art: 'ba2', planMln: 210_000, exec: 1.01 },
  { dep: 'd2', art: 'ba11', planMln: 96_000, exec: 0.64 },
  { dep: 'd2', art: 'ba12', planMln: 38_000, exec: 1.18 },
  { dep: 'd2', art: 'ba7', planMln: 3_200, exec: 0.9 },
  { dep: 'd2', art: 'ba13', planMln: 14_500, exec: 0.72 },
  // Финансы
  { dep: 'd3', art: 'ba1', planMln: 38_000, exec: 0.97 },
  { dep: 'd3', art: 'ba8', planMln: 26_000, exec: 1.09 },
  { dep: 'd3', art: 'ba6', planMln: 1_500, exec: 0.6 },
  // Закупки
  { dep: 'd4', art: 'ba1', planMln: 14_000, exec: 0.96 },
  { dep: 'd4', art: 'ba7', planMln: 900, exec: 1.1 },
  // Юридический
  { dep: 'd5', art: 'ba1', planMln: 18_000, exec: 0.95 },
  { dep: 'd5', art: 'ba8', planMln: 12_000, exec: 0.78 },
  // HR
  { dep: 'd6', art: 'ba1', planMln: 22_000, exec: 1.0 },
  { dep: 'd6', art: 'ba6', planMln: 28_000, exec: 0.88 },
  { dep: 'd6', art: 'ba7', planMln: 2_400, exec: 0.93 },
  // Бухгалтерия
  { dep: 'd7', art: 'ba1', planMln: 31_000, exec: 0.98 },
  { dep: 'd7', art: 'ba3', planMln: 9_500, exec: 1.03 },
  // Казначейство
  { dep: 'd8', art: 'ba1', planMln: 19_000, exec: 0.97 },
  { dep: 'd8', art: 'ba3', planMln: 16_000, exec: 0.99 },
  // Розничный бизнес (ФОТ и аренда — в разрезе региональных филиалов, см. REGION_SPLIT)
  { dep: 'd9', art: 'ba1', planMln: 1_150_000, exec: 1.0 },
  { dep: 'd9', art: 'ba2', planMln: 380_000, exec: 1.02 },
  { dep: 'd9', art: 'ba5', planMln: 145_000, exec: 1.15 },
  { dep: 'd9', art: 'ba7', planMln: 9_800, exec: 0.86 },
  { dep: 'd9', art: 'ba9', planMln: 64_000, exec: 0.91 },
  // Корпоративный бизнес
  { dep: 'd10', art: 'ba1', planMln: 420_000, exec: 0.99 },
  { dep: 'd10', art: 'ba5', planMln: 38_000, exec: 0.76 },
  { dep: 'd10', art: 'ba7', planMln: 7_600, exec: 1.06 },
  { dep: 'd10', art: 'ba8', planMln: 15_000, exec: 0.92 },
];

/** Строки, которые ведутся в разрезе региональных филиалов (МВЗ «Аппарат филиала»): доли регионов в сумме строки. */
const REGION_SPLIT: Record<string, number> = {
  R01: 0.19, R02: 0.07, R03: 0.07, R04: 0.06, R05: 0.04, R06: 0.07, R07: 0.04,
  R08: 0.07, R09: 0.09, R10: 0.05, R11: 0.03, R12: 0.08, R13: 0.06, R14: 0.08,
};
const SPLIT_LINES = new Set(['d9:ba1', 'd9:ba2']);
const REGION_EXEC: Record<string, number> = { R01: 1.01, R03: 1.06, R09: 0.97, R12: 1.08, R14: 0.94 };

/** Сезонность расходов по месяцам (сумма = 12). */
const SEASON = [0.86, 0.9, 1.0, 1.0, 1.02, 1.04, 0.96, 0.92, 1.02, 1.05, 1.06, 1.17];

// Детерминированный псевдослучайный генератор, чтобы демо-цифры были стабильны.
export function budgetingRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const roundM = (v: number) => Math.round(v / 1_000_000) * 1_000_000;

function makeLine(id: string, dep: string, art: string, orgUnitKey: string, annual: number, exec: number, seed: number): BudgetingLine {
  const rand = budgetingRng(seed);
  const plan = SEASON.map((k) => roundM((annual / 12) * k));
  const actual = plan.map((p, m) => (m < CLOSED_MONTHS ? roundM(p * exec * (0.94 + rand() * 0.12)) : 0));
  // Прогноз: тренд исполнения по закрытым месяцам переносится на оставшиеся
  const forecast = plan.map((p, m) => (m >= CLOSED_MONTHS ? roundM(p * (1 + (exec - 1) * 0.8)) : 0));
  return { id, departmentId: dep, articleId: art, orgUnitKey, plan, actual, forecast, zbb: { ...ARTICLE_ZBB[art]! } };
}

export const budgetingLines: BudgetingLine[] = SPEC.flatMap((s, i) => {
  const annual = s.planMln * 1_000_000;
  if (!SPLIT_LINES.has(`${s.dep}:${s.art}`)) return [makeLine(`bl${i + 1}`, s.dep, s.art, s.dep, annual, s.exec, 1000 + i * 7919)];
  return Object.entries(REGION_SPLIT).map(([rk, share], j) =>
    makeLine(`bl${i + 1}-${rk}`, s.dep, s.art, rk, annual * share, s.exec * (REGION_EXEC[rk] ?? 1), 1000 + i * 7919 + j * 31),
  );
});

export const budgetingSettings: BudgetingSettings = { thresholds: [70, 80, 90], checkMonthly: true, checkCash: true, checkStock: true };

/** Кассовый план (ОДДС) подразделений: OPEX — в месяце начисления, CAPEX — с лагом оплаты в 1 месяц; запас 3%. */
export function buildCashPlan(lines: BudgetingLine[], articles: BudgetingArticle[]): BudgetingCashPlanRow[] {
  const deps = [...new Set(lines.map((l) => l.departmentId))];
  const isCapex = (a: string) => articles.find((x) => x.id === a)?.group === 'capex';
  return deps.map((d) => {
    const own = lines.filter((l) => l.departmentId === d);
    const plan = Array.from({ length: 12 }, (_, m) =>
      roundM(own.reduce((s, l) => s + (isCapex(l.articleId) ? (l.plan[Math.max(0, m - 1)] ?? 0) : (l.plan[m] ?? 0)), 0) * 1.03),
    );
    const paid = Array.from({ length: 12 }, (_, m) =>
      m < CLOSED_MONTHS ? own.reduce((s, l) => s + (isCapex(l.articleId) ? (l.actual[Math.max(0, m - 1)] ?? 0) : (l.actual[m] ?? 0)), 0) : 0,
    );
    return { departmentId: d, plan, paid };
  });
}

export const budgetingScenarios: BudgetingScenario[] = [
  { id: 'sc1', code: 'base', name: { ru: 'Базовый', uz: 'Asosiy', en: 'Base' }, opexPct: 0, capexPct: 0, articlePct: {}, fxUsd: 12_650, headcountPct: 0, updatedAt: '2026-01-15T09:00:00Z', updatedBy: 'u4', system: true },
  { id: 'sc2', code: 'optimistic', name: { ru: 'Оптимистичный', uz: 'Optimistik', en: 'Optimistic' }, opexPct: 3, capexPct: 10, articlePct: { ba5: 15 }, fxUsd: 12_400, headcountPct: 4, updatedAt: '2026-07-10T09:00:00Z', updatedBy: 'u4', system: true },
  { id: 'sc3', code: 'pessimistic', name: { ru: 'Пессимистичный', uz: 'Pessimistik', en: 'Pessimistic' }, opexPct: -6, capexPct: -25, articlePct: { ba5: -30, ba10: -40 }, fxUsd: 13_400, headcountPct: -2, updatedAt: '2026-07-10T09:00:00Z', updatedBy: 'u4', system: true },
];

/** Доля статьи, номинированная в USD (лицензии, оборудование) — для валютной чувствительности сценариев. */
export const USD_LINKED: Record<string, number> = { ba3: 0.45, ba9: 0.7, ba10: 0.2, ba4: 0.15 };

export const budgetingChanges: BudgetingChange[] = [
  {
    id: 'bc1',
    number: 'BC-2026-0011',
    type: 'transfer',
    departmentId: 'd1',
    fromArticleId: 'ba10',
    toArticleId: 'ba9',
    amount: 9_000_000_000,
    reason: 'Перенос средств с разработки ПО на ИТ-оборудование: задержка проекта ДБО, срочная замена серверов резервного ЦОД.',
    status: 'pending',
    requesterId: 'u1',
    createdAt: '2026-10-15T10:20:00Z',
    history: [
      { at: '2026-10-15T10:20:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-15T10:22:00Z', userId: 'u1', action: 'submitted' },
    ],
  },
  {
    id: 'bc2',
    number: 'BC-2026-0012',
    type: 'increase',
    departmentId: 'd9',
    toArticleId: 'ba5',
    amount: 12_500_000_000,
    reason: 'Дополнительная рекламная кампания по запуску мобильного приложения в IV квартале.',
    status: 'pending',
    requesterId: 'u2',
    createdAt: '2026-10-16T08:05:00Z',
    history: [
      { at: '2026-10-16T08:05:00Z', userId: 'u2', action: 'created' },
      { at: '2026-10-16T08:06:00Z', userId: 'u2', action: 'submitted' },
    ],
  },
  {
    id: 'bc3',
    number: 'BC-2026-0007',
    type: 'transfer',
    departmentId: 'd2',
    fromArticleId: 'ba11',
    toArticleId: 'ba12',
    amount: 6_000_000_000,
    reason: 'Замена изношенных автомобилей инкассации.',
    status: 'approved',
    requesterId: 'u6',
    createdAt: '2026-08-12T09:00:00Z',
    appliedAt: '2026-08-14T15:30:00Z',
    history: [
      { at: '2026-08-12T09:00:00Z', userId: 'u6', action: 'created' },
      { at: '2026-08-13T11:00:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-08-14T15:30:00Z', userId: 'u4', action: 'approved', comment: 'Изменение применено к плану.' },
    ],
  },
];

const M = 1_000_000;
const B = 1_000_000_000;

/** Транзакции текущего открытого месяца (октябрь): резервы одобренных заявок и списания по оплатам. */
export const budgetingTxns: BudgetingTxn[] = [
  { id: 'bt1', lineId: 'bl2', month: 9, kind: 'consume', amount: 3_400 * M, source: 'payment', ref: 'pay-it-lic-10', refLabel: 'Продление лицензий СУБД · 05.10.2026', userId: 'u8', at: '2026-10-05T10:00:00Z', mode: 'soft' },
  { id: 'bt2', lineId: 'bl5', month: 9, kind: 'reserve', amount: 2_150 * M, source: 'procurement', ref: 'pr-seed-srv', refLabel: 'Серверы резервного ЦОД (заявка на закупку)', userId: 'u1', at: '2026-10-08T09:30:00Z', mode: 'hard' },
  { id: 'bt3', lineId: 'bl10', month: 9, kind: 'consume', amount: 1_900 * M, source: 'payment', ref: 'pay-auto-10', refLabel: 'Автомобили инкассации — 2-й транш', userId: 'u8', at: '2026-10-10T12:00:00Z', mode: 'hard' },
  { id: 'bt4', lineId: 'bl11', month: 9, kind: 'consume', amount: 180 * M, source: 'trip', ref: 'trip-seed-1', refLabel: 'Командировки АХД, октябрь', userId: 'u7', at: '2026-10-12T15:00:00Z', mode: 'hard' },
  { id: 'bt5', lineId: 'bl10', month: 9, kind: 'blocked', amount: 6_500 * M, source: 'procurement', ref: 'pr-seed-bus', refLabel: 'Микроавтобусы для филиалов (заблокировано hard-check)', userId: 'u14', at: '2026-10-14T11:20:00Z', mode: 'hard', note: 'Превышен годовой лимит статьи' },
];

export const budgetingOverruns: BudgetingOverrun[] = [
  {
    id: 'bo1', number: 'BO-2026-0003', lineId: 'bl29', amount: 4_800 * M, excess: 1_250 * M, source: 'procurement', ref: 'pr-seed-promo', refLabel: 'Рекламная кампания «Мобильный банк» (наружная реклама)',
    reason: 'Запуск мобильного приложения перенесён на ноябрь; кампания согласована с Правлением.', impact: 'Срыв плана привлечения 120 тыс. новых пользователей мобильного банка.',
    status: 'pending', requesterId: 'u21', createdAt: '2026-10-16T14:00:00Z',
    history: [
      { at: '2026-10-16T14:00:00Z', userId: 'u21', action: 'created' },
      { at: '2026-10-16T14:01:00Z', userId: 'u21', action: 'submitted' },
    ],
  },
];

export const budgetingZbb: BudgetingZbbPackage[] = [
  {
    id: 'zp1', number: 'ZBB-2027-0004', year: 2027, departmentId: 'd1', title: 'ZBB-пакет ИТ на 2027 год', status: 'pending', requesterId: 'u1', createdAt: '2026-10-10T09:00:00Z',
    items: [
      { id: 'zi1', articleId: 'ba3', amount: 156 * B, calc: '842 лицензии × средняя стоимость продления + сопровождение АБС (договор)', justification: 'Продление лицензий и сопровождение критичных систем; рост числа рабочих мест на 6%.', goalId: 'g1', impact: 'Остановка АБС и процессинга при непродлении лицензий.', priority: 'mandatory' },
      { id: 'zi2', articleId: 'ba9', amount: 98 * B, calc: '420 рабочих мест × 14,5 млн + СХД резервного ЦОД 37 млрд', justification: 'Замена оборудования старше 5 лет, расширение резервного ЦОД.', goalId: 'g1', impact: 'Рост отказов оборудования, риск потери данных.', priority: 'important' },
      { id: 'zi3', articleId: 'ba10', amount: 64 * B, calc: '3 проекта × оценка проектного офиса (чел.-дни × ставка)', justification: 'Развитие ДБО и скоринга.', goalId: 'g1', impact: 'Отставание по цифровым каналам, потеря доли рынка.', priority: 'desirable' },
    ],
    history: [
      { at: '2026-10-10T09:00:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-10T09:05:00Z', userId: 'u1', action: 'submitted' },
    ],
  },
  {
    id: 'zp2', number: 'ZBB-2027-0002', year: 2027, departmentId: 'd6', title: 'ZBB-пакет HR на 2027 год', status: 'approved', requesterId: 'u13', createdAt: '2026-09-20T09:00:00Z',
    items: [
      { id: 'zi4', articleId: 'ba6', amount: 31 * B, calc: '1 300 сотрудников × 23,8 млн (программы обучения)', justification: 'Обязательные курсы ЦБ по ПОД/ФТ, программа кадрового резерва.', goalId: 'g5', impact: 'Предписания регулятора, рост операционных ошибок.', priority: 'mandatory' },
      { id: 'zi5', articleId: 'ba1', amount: 24 * B, calc: 'Штат 96 ед. × средний ФОТ с индексацией 8%', justification: 'ФОТ департамента персонала.', goalId: 'g5', impact: 'Невозможность обеспечить подбор и оценку персонала.', priority: 'mandatory' },
    ],
    history: [
      { at: '2026-09-20T09:00:00Z', userId: 'u13', action: 'created' },
      { at: '2026-09-20T09:10:00Z', userId: 'u13', action: 'submitted' },
      { at: '2026-09-22T10:00:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-09-24T16:00:00Z', userId: 'u4', action: 'approved', comment: 'Включено в бюджет 2027 г.' },
    ],
  },
  {
    id: 'zp3', number: 'ZBB-2027-0006', year: 2027, departmentId: 'd9', title: 'ZBB-пакет розничного бизнеса (маркетинг)', status: 'draft', requesterId: 'u21', createdAt: '2026-10-17T11:00:00Z',
    items: [
      { id: 'zi6', articleId: 'ba5', amount: 162 * B, calc: 'Медиаплан: ТВ 60 млрд, digital 72 млрд, наружная 30 млрд', justification: 'Продвижение мобильного банка и депозитных продуктов.', goalId: 'g2', impact: 'Невыполнение плана по депозитам физлиц (−1,2 трлн).', priority: 'important' },
    ],
    history: [{ at: '2026-10-17T11:00:00Z', userId: 'u21', action: 'created' }],
  },
];

export const budgetingCapex: BudgetingCapexRequest[] = [
  {
    id: 'cx1', number: 'CX-2026-0005', kind: 'investment', departmentId: 'd2', articleId: 'ba11', title: 'Строительство ЦБУ «Регистан» (Самарканд)', amount: 28 * B,
    schedule: [{ ym: '2026-03', amount: 4 * B }, { ym: '2026-06', amount: 8 * B }, { ym: '2026-10', amount: 9 * B }, { ym: '2027-02', amount: 7 * B }],
    justification: 'Открытие ЦБУ по решению Правления № 9: потенциал 18 тыс. клиентов, окупаемость 4,2 года.', comments: 'Типовой проект ЦБУ категории B.', goalId: 'g2',
    impact: 'Потеря клиентов района в пользу конкурентов.', status: 'approved', requesterId: 'u6', createdAt: '2026-01-20T09:00:00Z', projectId: 'pj1',
    history: [
      { at: '2026-01-20T09:00:00Z', userId: 'u6', action: 'created' },
      { at: '2026-01-21T10:00:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-01-25T12:00:00Z', userId: 'u4', action: 'approved' },
    ],
  },
  {
    id: 'cx2', number: 'CX-2026-0014', kind: 'capex', departmentId: 'd1', articleId: 'ba9', title: 'Система хранения данных для резервного ЦОД', amount: 12 * B,
    schedule: [{ ym: '2026-11', amount: 7 * B }, { ym: '2026-12', amount: 5 * B }],
    justification: 'Текущая СХД заполнена на 91%, рост объёма данных 35% в год.', comments: 'Конкурентная закупка через тендер.', goalId: 'g1',
    impact: 'Остановка резервного копирования, нарушение требований ЦБ к непрерывности.', status: 'pending', requesterId: 'u1', createdAt: '2026-10-13T09:00:00Z',
    history: [
      { at: '2026-10-13T09:00:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-13T09:02:00Z', userId: 'u1', action: 'submitted' },
    ],
  },
  {
    id: 'cx3', number: 'CX-2026-0016', kind: 'large_purchase', departmentId: 'd2', articleId: 'ba12', title: 'Бронированные автомобили инкассации (6 ед.)', amount: 9_600 * M,
    schedule: [{ ym: '2027-01', amount: 4_800 * M }, { ym: '2027-03', amount: 4_800 * M }],
    justification: 'Замена автомобилей с пробегом более 300 тыс. км.', comments: '', goalId: 'g3', impact: 'Срыв маршрутов инкассации.', status: 'draft', requesterId: 'u14', createdAt: '2026-10-17T09:00:00Z',
    history: [{ at: '2026-10-17T09:00:00Z', userId: 'u14', action: 'created' }],
  },
];

export const budgetingProjects: BudgetingProject[] = [
  {
    id: 'pj1', code: 'INV-2026-01', name: 'Строительство ЦБУ «Регистан»', type: 'construction', departmentId: 'd2', articleId: 'ba11', goalId: 'g2', start: '2026-02-01', end: '2027-04-30', budget: 28 * B, status: 'in_progress', capexRequestId: 'cx1',
    passport: { goal: 'Открыть ЦБУ категории B в Самарканде для обслуживания 18 тыс. клиентов.', scope: 'Проектирование, строительство, оснащение, ввод в эксплуатацию.', kpi: 'Открытие до 30.04.2027; 18 тыс. клиентов за 2 года; окупаемость ≤ 4,5 года.', fundingSource: 'Собственные средства банка (CAPEX 2026–2027)', risks: 'Рост стоимости стройматериалов, задержка разрешений.', sponsorId: 'u4', managerId: 'u6' },
    milestones: [
      { id: 'ms1', name: 'Проектно-сметная документация', start: '2026-02-01', end: '2026-03-31', budget: 2_500 * M, actual: 2_380 * M, progressPct: 100, status: 'done' },
      { id: 'ms2', name: 'Фундамент и каркас', start: '2026-04-01', end: '2026-07-31', budget: 9_500 * M, actual: 9_870 * M, progressPct: 100, status: 'done' },
      { id: 'ms3', name: 'Инженерные сети и отделка', start: '2026-08-01', end: '2026-12-15', budget: 9_000 * M, actual: 4_150 * M, progressPct: 45, status: 'delayed' },
      { id: 'ms4', name: 'Оснащение и ввод в эксплуатацию', start: '2026-12-16', end: '2027-04-30', budget: 7_000 * M, actual: 0, progressPct: 0, status: 'planned' },
    ],
  },
  {
    id: 'pj2', code: 'INV-2026-02', name: 'ДБО нового поколения', type: 'it', departmentId: 'd1', articleId: 'ba10', goalId: 'g1', start: '2026-01-15', end: '2026-12-31', budget: 42 * B, status: 'in_progress',
    passport: { goal: 'Заменить систему ДБО юрлиц и физлиц, перевести 70% операций в цифровые каналы.', scope: 'Выбор платформы, интеграция с АБС, миграция клиентов.', kpi: 'Доля цифровых операций ≥ 70%; NPS ≥ 45.', fundingSource: 'CAPEX ИТ 2026', risks: 'Задержка интеграции с АБС, нехватка разработчиков.', sponsorId: 'u2', managerId: 'u1' },
    milestones: [
      { id: 'ms5', name: 'Выбор платформы и договор', start: '2026-01-15', end: '2026-03-15', budget: 3_000 * M, actual: 2_900 * M, progressPct: 100, status: 'done' },
      { id: 'ms6', name: 'Интеграция с АБС', start: '2026-03-16', end: '2026-08-31', budget: 18_000 * M, actual: 15_200 * M, progressPct: 85, status: 'delayed' },
      { id: 'ms7', name: 'Пилот и миграция клиентов', start: '2026-09-01', end: '2026-12-31', budget: 21_000 * M, actual: 3_100 * M, progressPct: 20, status: 'in_progress' },
    ],
  },
  {
    id: 'pj3', code: 'INV-2026-03', name: 'Модернизация резервного ЦОД', type: 'equipment', departmentId: 'd1', articleId: 'ba9', goalId: 'g4', start: '2026-05-01', end: '2027-03-31', budget: 35 * B, status: 'in_progress',
    passport: { goal: 'Обеспечить RTO ≤ 4 ч для критичных систем.', scope: 'Серверы, СХД, сети, системы охлаждения.', kpi: 'RTO ≤ 4 ч, RPO ≤ 15 мин; учения 2 раза в год.', fundingSource: 'CAPEX ИТ 2026–2027', risks: 'Сроки поставки оборудования, валютный риск.', sponsorId: 'u2', managerId: 'u18' },
    milestones: [
      { id: 'ms8', name: 'Серверное оборудование', start: '2026-05-01', end: '2026-09-30', budget: 14_000 * M, actual: 13_600 * M, progressPct: 100, status: 'done' },
      { id: 'ms9', name: 'СХД и сеть', start: '2026-10-01', end: '2026-12-31', budget: 12_000 * M, actual: 1_200 * M, progressPct: 10, status: 'in_progress' },
      { id: 'ms10', name: 'Охлаждение и электропитание', start: '2027-01-01', end: '2027-03-31', budget: 9_000 * M, actual: 0, progressPct: 0, status: 'planned' },
    ],
  },
];
