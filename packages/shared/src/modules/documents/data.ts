// Демо-данные модуля documents (вымышленные). Моменты загрузки писем НК / решений МИБ задаются относительно
// текущего времени — светофор 10-дневного срока и 24-часовое окно принятия наглядны в любой день.
import type { ApprovalTask } from '../../types';
import type { DocumentCategory, DocumentPaymentDetails, DocumentRecord } from './types';

const DAY = 86_400_000;
export const documentAgo = (days: number, hours = 0): string => new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const plus10 = (iso: string) => new Date(new Date(iso).getTime() + 10 * DAY).toISOString().slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

/** Сроки хранения по типам документов, лет (0 — постоянно) — PR-DOC-019. */
export const DOCUMENT_RETENTION: Record<DocumentCategory, number> = {
  letter: 5, order: 0, memo: 5, instruction: 5, appeal: 5, act: 5, protocol: 0,
  mib_decision: 5, tax_demand: 5, notice: 5, collection_order: 5, payment_demand: 5, aur: 5,
};

const t9 = documentAgo(9, 3);
const t7 = documentAgo(6, 20);
const t3 = documentAgo(2, 4);
const t12 = documentAgo(11, 2);
const t30h = documentAgo(1, 7);
const t2h = documentAgo(0, 2);

const mib: DocumentPaymentDetails = { amount: 38_600_000, recipient: 'Бюро принудительного исполнения (депозитный счёт, демо)', recipientTin: '200111222', account: '23402000900100001001', mfo: '00014', treasuryAccount: '400910860262777094100079001', purpose: 'Взыскание по исполнительному документу № 4471/26 (демо)' };
const inkasso: DocumentPaymentDetails = { amount: 74_500_000, recipient: 'Казначейство Министерства финансов (демо)', recipientTin: '200222333', account: '23402000300100002002', mfo: '00014', treasuryAccount: '400910860262777094100079002', purpose: 'Инкассовое поручение ГНИ Мирабадского района № 118 (демо)' };

export const documentSeed: DocumentRecord[] = [
  {
    id: 'doc1', number: 'VH-2026-04812', kind: 'incoming', type: 'letter', source: 'manual', correspondent: 'Центральный банк (запрос, демо)', correspondentNumber: '14-07/2281',
    subject: 'О предоставлении сведений по кредитному портфелю МСБ', summary: 'Предоставить сведения о кредитах субъектам малого бизнеса по регионам за 9 месяцев 2026 года.',
    registeredAt: '2026-10-08T09:14:00Z', deadline: '2026-10-15', executorId: 'u4', departmentId: 'd3', priority: 'high', control: true, status: 'in_progress', pages: 3, retentionYears: 5,
    assignedAt: '2026-10-08T11:00:00Z', acceptedAt: '2026-10-08T12:00:00Z',
    resolution: { authorId: 'u6', text: 'Юсуповой Д. — подготовить ответ, согласовать с Корпоративным бизнесом.', at: '2026-10-08T11:00:00Z' },
    history: [
      { at: '2026-10-08T09:14:00Z', userId: 'u6', action: 'created' },
      { at: '2026-10-08T11:00:00Z', userId: 'u6', action: 'commented', comment: 'Резолюция: подготовить ответ, согласовать с Корпоративным бизнесом.' },
    ],
  },
  {
    id: 'doc2', number: 'VH-2026-04855', kind: 'incoming', type: 'appeal', source: 'manual', correspondent: 'Обращение гражданина (Кодиров А.)',
    subject: 'Жалоба на сроки рассмотрения кредитной заявки', summary: 'Заявитель сообщает о задержке рассмотрения заявки на ипотечный кредит в ЦБУ Юнусабад.',
    registeredAt: '2026-10-14T06:30:00Z', deadline: '2026-10-29', executorId: 'u1', departmentId: 'd9', priority: 'normal', control: true, status: 'in_progress', pages: 1, retentionYears: 5,
    assignedAt: '2026-10-14T08:00:00Z', acceptedAt: '2026-10-14T09:00:00Z',
    resolution: { authorId: 'u2', text: 'Рассмотреть и дать ответ заявителю в установленный срок.', at: '2026-10-14T08:00:00Z' },
    history: [{ at: '2026-10-14T06:30:00Z', userId: 'u6', action: 'created' }],
  },
  {
    id: 'doc3', number: 'VN-2026-01933', kind: 'internal', type: 'memo', source: 'manual', correspondent: 'Департамент ИТ',
    subject: 'О модернизации резервного центра обработки данных', summary: 'Служебная записка с обоснованием закупки серверного оборудования и графиком работ.',
    body: 'Прошу согласовать модернизацию резервного ЦОД: замена 6 серверов, срок — IV квартал 2026 года.',
    registeredAt: '2026-10-16T10:20:00Z', deadline: '2026-10-23', executorId: 'u1', departmentId: 'd1', priority: 'normal', control: false, status: 'pending', pages: 4, retentionYears: 5,
    history: [
      { at: '2026-10-16T10:20:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-16T10:25:00Z', userId: 'u1', action: 'submitted' },
    ],
  },
  {
    id: 'doc4', number: 'VN-2026-01920', kind: 'internal', type: 'order', source: 'manual', correspondent: 'Правление банка',
    subject: 'Об утверждении регламента обработки обращений клиентов', summary: 'Приказ об утверждении новой редакции регламента, вводится с 01.11.2026.',
    registeredAt: '2026-10-10T07:00:00Z', executorId: 'u5', departmentId: 'd5', priority: 'normal', control: false, status: 'done', pages: 12, retentionYears: 0,
    history: [
      { at: '2026-10-10T07:00:00Z', userId: 'u5', action: 'created' },
      { at: '2026-10-11T09:00:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-10-12T09:00:00Z', userId: 'u5', action: 'status_changed', comment: 'Исполнено: приказ доведён до подразделений.' },
    ],
  },
  {
    id: 'doc5', number: 'IS-2026-03107', kind: 'outgoing', type: 'letter', source: 'manual', correspondent: "OOO «Alfa Texnika Servis»",
    subject: 'О продлении договора технического обслуживания', summary: 'Уведомление о намерении продлить договор DG-2026-0287 на 2027 год.', contractId: 'k2',
    registeredAt: '2026-10-13T12:00:00Z', executorId: 'u3', departmentId: 'd4', priority: 'normal', control: false, status: 'done', pages: 1, retentionYears: 5, sentAt: '2026-10-13T12:30:00Z',
    history: [{ at: '2026-10-13T12:00:00Z', userId: 'u3', action: 'created' }],
  },
  {
    id: 'doc6', number: 'VH-2026-04790', kind: 'incoming', type: 'instruction', source: 'manual', correspondent: 'Министерство экономики и финансов (демо)', correspondentNumber: 'МФ-03/917',
    subject: 'О порядке представления отчётности по капитальным вложениям', summary: 'Новые формы отчётности с 4 квартала 2026 года.',
    registeredAt: '2026-10-02T08:00:00Z', deadline: '2026-10-12', executorId: 'u7', departmentId: 'd7', priority: 'high', control: true, status: 'in_progress', pages: 6, retentionYears: 5,
    assignedAt: '2026-10-02T10:00:00Z', acceptedAt: '2026-10-02T11:00:00Z',
    resolution: { authorId: 'u4', text: 'Хасановой М. — внедрить формы, доложить о готовности.', at: '2026-10-02T10:00:00Z' },
    history: [{ at: '2026-10-02T08:00:00Z', userId: 'u6', action: 'created' }],
  },
  {
    id: 'doc7', number: 'VN-2026-01941', kind: 'internal', type: 'act', source: 'manual', correspondent: 'Административно-хозяйственный департамент',
    subject: 'Акт приёмки мебели для филиала в Самарканде', summary: 'Акт приёма-передачи по договору DG-2026-0311, 72 позиции.', contractId: 'k1',
    registeredAt: '2026-10-17T13:40:00Z', executorId: 'u6', departmentId: 'd2', priority: 'normal', control: false, status: 'registered', pages: 2, retentionYears: 5,
    history: [{ at: '2026-10-17T13:40:00Z', userId: 'u6', action: 'created' }],
  },
  {
    id: 'doc8', number: 'VH-2026-04870', kind: 'incoming', type: 'letter', source: 'manual', correspondent: 'MChJ «Ofis Mebel Plus»', correspondentNumber: '118',
    subject: 'Об изменении сроков поставки', summary: 'Поставщик просит перенести вторую партию на 10 рабочих дней.', contractId: 'k1',
    registeredAt: '2026-10-17T05:50:00Z', deadline: '2026-10-21', executorId: 'u3', departmentId: 'd4', priority: 'normal', control: true, status: 'registered', pages: 1, retentionYears: 5,
    history: [{ at: '2026-10-17T05:50:00Z', userId: 'u6', action: 'created' }],
  },
  // --- my3.soliq.uz и МИБ: 10-дневный контроль, светофор, «Акцепт» ---
  {
    id: 'doc9', number: 'VH-2026-04881', kind: 'incoming', type: 'tax_demand', source: 'soliq', correspondent: 'ГНИ Мирабадского района (my3.soliq.uz, демо)', correspondentNumber: 'ST-2026-11871',
    subject: 'Требование о представлении пояснений по декларации по НДС за август', summary: 'Представить пояснения и подтверждающие документы по расхождениям в декларации по НДС за август 2026 года.',
    ocrText: 'ТРЕБОВАНИЕ о представлении пояснений. В течение 10 дней представить пояснения по расхождениям в декларации по налогу на добавленную стоимость за август 2026 года.',
    registeredAt: t7, deadline: plus10(t7), hardDeadline: true, executorId: 'u17', departmentId: 'd7', autoRouted: { departmentId: 'd7', keywords: ['НДС', 'декларац'] },
    priority: 'high', control: true, status: 'in_progress', pages: 2, retentionYears: 5, assignedAt: t7, acceptedAt: documentAgo(6, 18),
    history: [
      { at: t7, userId: 'u6', action: 'created', comment: 'Загружено из my3.soliq.uz; направлено по содержанию: Главная бухгалтерия' },
      { at: documentAgo(6, 18), userId: 'u17', action: 'status_changed', comment: 'Принято к исполнению' },
    ],
  },
  {
    id: 'doc10', number: 'VH-2026-04884', kind: 'incoming', type: 'mib_decision', source: 'mib', correspondent: 'Бюро принудительного исполнения (МИБ, демо)', correspondentNumber: 'MIB-2026-4471',
    subject: 'Решение МИБ о взыскании задолженности по исполнительному документу', summary: 'Списать 38 600 000 сум по исполнительному документу № 4471/26; после оплаты снимается блокировка счёта.',
    ocrText: 'РЕШЕНИЕ о взыскании. Сумма: 38 600 000 сум. Получатель: депозитный счёт МИБ, ИНН 200111222, р/с 23402000900100001001, МФО 00014, казначейский л/с 400910860262777094100079001.',
    registeredAt: t3, deadline: plus10(t3), hardDeadline: true, executorId: 'u17', departmentId: 'd7', autoRouted: { departmentId: 'd5', keywords: ['МИБ', 'исполнительн'] },
    priority: 'high', control: true, status: 'in_progress', pages: 1, retentionYears: 5, paymentDetails: mib, assignedAt: t3, acceptedAt: documentAgo(2, 2),
    history: [
      { at: t3, userId: 'u6', action: 'created', comment: 'Загружено из МИБ; реквизиты платежа извлечены автоматически' },
      { at: documentAgo(2, 2), userId: 'u17', action: 'status_changed', comment: 'Принято к исполнению' },
    ],
  },
  {
    id: 'doc11', number: 'VH-2026-04879', kind: 'incoming', type: 'collection_order', source: 'soliq', correspondent: 'ГНИ Мирабадского района (инкассо, демо)', correspondentNumber: 'INK-118',
    subject: 'Инкассовое поручение на списание недоимки по налогу на имущество', summary: 'Инкассо на сумму 74 500 000 сум; требуется оплата с двухэтапным подтверждением (свыше 50 млн).',
    ocrText: 'ИНКАССОВОЕ ПОРУЧЕНИЕ № 118. Сумма 74 500 000 сум. Получатель: Казначейство, ИНН 200222333, р/с 23402000300100002002, МФО 00014.',
    registeredAt: t9, deadline: plus10(t9), hardDeadline: true, executorId: 'u17', departmentId: 'd7', autoRouted: { departmentId: 'd8', keywords: ['инкассо'] },
    priority: 'high', control: true, status: 'in_progress', pages: 1, retentionYears: 5, paymentDetails: inkasso, assignedAt: t9, acceptedAt: documentAgo(8, 20), warningSentAt: documentAgo(3, 3),
    history: [
      { at: t9, userId: 'u6', action: 'created', comment: 'Загружено из my3.soliq.uz' },
      { at: documentAgo(8, 20), userId: 'u17', action: 'status_changed', comment: 'Принято к исполнению' },
      { at: documentAgo(3, 3), userId: 'system', action: 'commented', comment: 'Предупредительное письмо исполнителю (6-й день срока)' },
    ],
  },
  {
    id: 'doc12', number: 'VH-2026-04866', kind: 'incoming', type: 'notice', source: 'soliq', correspondent: 'ГНИ Юнусабадского района (my3.soliq.uz, демо)', correspondentNumber: 'ST-2026-11402',
    subject: 'Уведомление о вызове для дачи пояснений по земельному налогу', summary: 'Представить расчёт земельного налога по зданию ЦБУ «Юнусабад» и документы на участок.',
    registeredAt: t12, deadline: plus10(t12), hardDeadline: true, executorId: 'u1', departmentId: 'd9', autoRouted: { departmentId: 'd9', keywords: ['ЦБУ'] },
    priority: 'normal', control: true, status: 'in_progress', pages: 1, retentionYears: 5, assignedAt: t12, acceptedAt: documentAgo(10, 6), autoAccepted: true,
    warningSentAt: documentAgo(6, 2), managementNotifiedAt: documentAgo(3, 2),
    history: [
      { at: t12, userId: 'u6', action: 'created', comment: 'Загружено из my3.soliq.uz' },
      { at: documentAgo(10, 6), userId: 'system', action: 'status_changed', comment: 'Принято к исполнению автоматически: 24 часа без ответа' },
    ],
  },
  {
    id: 'doc13', number: 'VH-2026-04889', kind: 'incoming', type: 'letter', source: 'soliq', correspondent: 'ГНИ Яккасарайского района (my3.soliq.uz, демо)', correspondentNumber: 'ST-2026-11920',
    subject: 'Письмо о сверке расчётов по налогу на доходы физических лиц', summary: 'Предлагается провести сверку расчётов по НДФЛ за III квартал 2026 года.',
    registeredAt: t30h, deadline: plus10(t30h), hardDeadline: true, executorId: 'u1', departmentId: 'd9', priority: 'normal', control: true, status: 'assigned', pages: 1, retentionYears: 5, assignedAt: t30h,
    history: [{ at: t30h, userId: 'u6', action: 'created', comment: 'Загружено из my3.soliq.uz; направлено исполнителю' }],
  },
  {
    id: 'doc14', number: 'VH-2026-04890', kind: 'incoming', type: 'letter', source: 'soliq', correspondent: 'ГНИ Чиланзарского района (my3.soliq.uz, демо)', correspondentNumber: 'ST-2026-11933',
    subject: 'Запрос сведений об открытых счетах клиента-должника', summary: 'Представить сведения о счетах и остатках клиента-должника по запросу налогового органа.',
    registeredAt: t2h, deadline: plus10(t2h), hardDeadline: true, executorId: 'u1', departmentId: 'd9', priority: 'high', control: true, status: 'assigned', pages: 1, retentionYears: 5, assignedAt: t2h,
    history: [{ at: t2h, userId: 'u6', action: 'created', comment: 'Загружено из my3.soliq.uz; направлено исполнителю' }],
  },
  // --- АУР: документы операционного дня для сводной папки ---
  {
    id: 'doc15', number: 'VN-2026-01950', kind: 'internal', type: 'aur', source: 'manual', correspondent: 'Административно-хозяйственный департамент',
    subject: 'Счёт за услуги клининга головного офиса', summary: 'Расход АУР: уборка помещений, октябрь 2026.', registeredAt: documentAgo(0, 6), executorId: 'u6', departmentId: 'd2', priority: 'normal', control: false, status: 'done', pages: 2, retentionYears: 5,
    aur: { amount: 18_400_000, costCenterKey: 'CC0002', article: 'OPEX-02', opDay: todayStr() },
    history: [{ at: documentAgo(0, 6), userId: 'u6', action: 'created' }],
  },
  {
    id: 'doc16', number: 'VN-2026-01951', kind: 'internal', type: 'aur', source: 'manual', correspondent: 'Административно-хозяйственный департамент',
    subject: 'Оплата электроэнергии здания головного офиса', summary: 'Расход АУР: электроэнергия, сентябрь 2026.', registeredAt: documentAgo(0, 5), executorId: 'u6', departmentId: 'd2', priority: 'normal', control: false, status: 'done', pages: 1, retentionYears: 5,
    aur: { amount: 32_750_000, costCenterKey: 'CC0002', article: 'OPEX-02', opDay: todayStr() },
    history: [{ at: documentAgo(0, 5), userId: 'u6', action: 'created' }],
  },
  {
    id: 'doc17', number: 'VN-2026-01952', kind: 'internal', type: 'aur', source: 'manual', correspondent: 'Департамент ИТ',
    subject: 'Продление сертификатов SSL для интернет-банкинга', summary: 'Расход АУР: ИТ-лицензии.', registeredAt: documentAgo(0, 4), executorId: 'u2', departmentId: 'd1', priority: 'normal', control: false, status: 'done', pages: 1, retentionYears: 5,
    aur: { amount: 6_900_000, costCenterKey: 'CC0001', article: 'OPEX-03', opDay: todayStr() },
    history: [{ at: documentAgo(0, 4), userId: 'u2', action: 'created' }],
  },
  {
    id: 'doc18', number: 'VN-2026-01944', kind: 'internal', type: 'protocol', source: 'manual', correspondent: 'Кредитный комитет',
    subject: 'Протокол заседания Кредитного комитета № 41', summary: 'Рассмотрено 6 кредитных заявок, одобрено 4.', body: 'Присутствовали: члены комитета (кворум). Повестка: 1. Кредитные заявки корпоративных клиентов. Решили: одобрить 4 заявки, 2 — на доработку.',
    registeredAt: '2026-10-15T12:00:00Z', executorId: 'u10', departmentId: 'd10', priority: 'normal', control: false, status: 'done', pages: 3, retentionYears: 0,
    history: [{ at: '2026-10-15T12:00:00Z', userId: 'u10', action: 'created' }],
  },
];

export const documentApprovalSeed: ApprovalTask[] = [
  {
    id: 'a_doc1', entity: 'document', entityId: 'doc3', title: 'О модернизации резервного центра обработки данных', number: 'VN-2026-01933',
    requesterId: 'u1', assigneeRole: 'dept_head', step: 1, totalSteps: 1,
    createdAt: '2026-10-16T10:25:00Z', dueAt: '2026-10-20T18:00:00Z', status: 'pending',
  },
];

/** Очередь писем my3.soliq.uz и решений МИБ, которые «придут» при следующей загрузке (детерминированно). */
export interface DocumentInboxSeed {
  source: 'soliq' | 'mib';
  type: DocumentCategory;
  correspondent: string;
  correspondentNumber: string;
  subject: string;
  text: string;
}

export const documentInboxQueue: DocumentInboxSeed[] = [
  { source: 'soliq', type: 'tax_demand', correspondent: 'ГНИ Сергелийского района (my3.soliq.uz, демо)', correspondentNumber: 'ST-2026-12011', subject: 'Требование об уплате пени по налогу на прибыль', text: 'ТРЕБОВАНИЕ об уплате пени по налогу на прибыль. Сумма 12 400 000 сум. Получатель: Казначейство, ИНН 200222333, р/с 23402000300100002002, МФО 00014.' },
  { source: 'mib', type: 'mib_decision', correspondent: 'Бюро принудительного исполнения (МИБ, демо)', correspondentNumber: 'MIB-2026-4520', subject: 'Решение МИБ о наложении ареста на счёт клиента и списании задолженности', text: 'РЕШЕНИЕ. Исполнительный документ № 4520/26. Сумма 61 200 000 сум. Получатель: депозитный счёт МИБ, ИНН 200111222, р/с 23402000900100001001, МФО 00014. Судебное решение вступило в силу.' },
  { source: 'soliq', type: 'letter', correspondent: 'ГНИ Мирзо-Улугбекского района (my3.soliq.uz, демо)', correspondentNumber: 'ST-2026-12030', subject: 'Запрос о кредитном договоре и залоговом имуществе заёмщика', text: 'Просим представить копию кредитного договора и сведения о залоговом имуществе заёмщика в срок 10 дней.' },
  { source: 'soliq', type: 'notice', correspondent: 'ГНИ Шайхантахурского района (my3.soliq.uz, демо)', correspondentNumber: 'ST-2026-12044', subject: 'Уведомление о проведении камеральной проверки отчётности по НДС', text: 'Уведомляем о проведении камеральной проверки декларации по НДС. Представить книгу покупок и счета-фактуры.' },
  { source: 'mib', type: 'collection_order', correspondent: 'Бюро принудительного исполнения (МИБ, демо)', correspondentNumber: 'MIB-2026-4533', subject: 'Инкассо по исполнительному листу о взыскании штрафа', text: 'ИНКАССО. Сумма 4 800 000 сум. Получатель: депозитный счёт МИБ, ИНН 200111222, р/с 23402000900100001001, МФО 00014.' },
];
