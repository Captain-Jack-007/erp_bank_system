// Демо-данные модуля archive (вымышленные).
import type { ArchiveCase, ArchiveDestructionAct, ArchiveDocument, ArchiveIntakeError, ArchiveNomenclatureItem, ArchiveRequest, ArchiveTransferTask } from './types';

const DAY = 86_400_000;
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString();
const inDays = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

export const archiveNomenclatureSeed: ArchiveNomenclatureItem[] = [
  { id: 'n1', index: '01-02', title: 'Приказы по основной деятельности', departmentId: 'd2', retentionYears: 0, article: 'ст. 19а', kinds: ['Приказ', 'Распоряжение'] },
  { id: 'n2', index: '03-11', title: 'Договоры с поставщиками товаров и услуг', departmentId: 'd4', retentionYears: 5, article: 'ст. 436', kinds: ['Договор'] },
  { id: 'n3', index: '05-07', title: 'Первичные бухгалтерские документы (мемориальные ордера)', departmentId: 'd7', retentionYears: 5, article: 'ст. 362', kinds: ['Мемориальный ордер', 'Счёт-фактура', 'Акт выполненных работ', 'Акт сверки', 'Документ в свободной форме'] },
  { id: 'n4', index: '06-01', title: 'Личные дела уволенных работников', departmentId: 'd6', retentionYears: 50, article: 'ст. 618б', kinds: ['Личное дело'] },
  { id: 'n5', index: '02-14', title: 'Переписка с контролирующими органами', departmentId: 'd5', retentionYears: 5, article: 'ст. 34', kinds: ['Письмо', 'Решение МИБ', 'Требование налогового органа', 'Уведомление', 'Инкассо'] },
  { id: 'n6', index: '04-03', title: 'Кредитные досье закрытых кредитов юридических лиц', departmentId: 'd10', retentionYears: 10, article: 'ст. 514', kinds: ['Кредитное досье'] },
  { id: 'n7', index: '05-12', title: 'Кассовые документы и журналы', departmentId: 'd8', retentionYears: 5, article: 'ст. 367', kinds: ['Кассовый журнал'] },
  { id: 'n8', index: '02-01', title: 'Входящая и исходящая корреспонденция, служебные записки', departmentId: 'd2', retentionYears: 5, article: 'ст. 25', kinds: ['Письмо', 'Обращение', 'Служебная записка', 'Протокол', 'Акт'] },
  { id: 'n9', index: '07-01', title: 'Электронные данные операционного дня, реестры, журналы', departmentId: 'd7', retentionYears: 5, article: 'ст. 371', kinds: ['Операционный день', 'Реестр', 'Журнал аудита', 'Протокол обмена', 'Сводная папка АУР'] },
  { id: 'n10', index: '06-05', title: 'Приказы о командировках и авансовые отчёты', departmentId: 'd6', retentionYears: 5, article: 'ст. 655', kinds: ['Приказ о командировке', 'Авансовый отчёт'] },
];

const loc = (room: string, rack: string, shelf: number, box: string) => ({ room, rack, shelf, box });
const accepted = (at: string, by = 'u16') => [{ at: `${at}T09:00:00Z`, userId: by, action: 'accepted' as const, details: 'Принято в архивный фонд' }];

export const archiveCaseSeed: ArchiveCase[] = [
  { id: 'ac1', number: '01-02/2019', nomenclatureId: 'n1', title: 'Приказы по основной деятельности, 2019 г., т. 1', year: 2019, departmentId: 'd2', documents: 214, pages: 486, location: loc('А-014', 'Стеллаж 3', 2, 'К-0107'), status: 'stored', retentionUntil: null, transferredAt: '2021-02-10', movements: accepted('2021-02-10') },
  { id: 'ac2', number: '03-11/2020', nomenclatureId: 'n2', title: 'Договоры с поставщиками ИТ-услуг, 2020 г.', year: 2020, departmentId: 'd4', documents: 38, pages: 612, location: loc('А-014', 'Стеллаж 5', 1, 'К-0219'), status: 'issued', retentionUntil: '2026-01-01', transferredAt: '2022-03-01', movements: accepted('2022-03-01') },
  { id: 'ac3', number: '05-07/2019', nomenclatureId: 'n3', title: 'Мемориальные ордера, IV квартал 2019 г.', year: 2019, departmentId: 'd7', documents: 1840, pages: 1840, location: loc('Б-002', 'Стеллаж 11', 4, 'К-0533'), status: 'stored', retentionUntil: '2025-01-01', transferredAt: '2021-04-15', movements: accepted('2021-04-15') },
  { id: 'ac4', number: '05-07/2020', nomenclatureId: 'n3', title: 'Мемориальные ордера, I квартал 2020 г.', year: 2020, departmentId: 'd7', documents: 1712, pages: 1712, location: loc('Б-002', 'Стеллаж 11', 5, 'К-0534'), status: 'stored', retentionUntil: '2026-01-01', transferredAt: '2021-04-15', movements: accepted('2021-04-15') },
  { id: 'ac5', number: '06-01/2018', nomenclatureId: 'n4', title: 'Личные дела уволенных работников (А–Г), 2018 г.', year: 2018, departmentId: 'd6', documents: 57, pages: 1390, location: loc('А-016', 'Стеллаж 1', 3, 'К-0012'), status: 'stored', retentionUntil: '2069-01-01', transferredAt: '2020-01-20', restricted: true, movements: accepted('2020-01-20') },
  { id: 'ac6', number: '04-03/2021', nomenclatureId: 'n6', title: 'Кредитные досье закрытых кредитов (Ташкент), 2021 г.', year: 2021, departmentId: 'd10', documents: 96, pages: 4310, location: loc('Б-004', 'Стеллаж 2', 1, 'К-0801'), status: 'issued', retentionUntil: '2032-01-01', transferredAt: '2023-02-28', restricted: true, movements: accepted('2023-02-28') },
  { id: 'ac7', number: '02-14/2022', nomenclatureId: 'n5', title: 'Переписка с контролирующими органами, 2022 г.', year: 2022, departmentId: 'd5', documents: 143, pages: 520, location: loc('А-014', 'Стеллаж 7', 2, 'К-0344'), status: 'stored', retentionUntil: '2028-01-01', transferredAt: '2024-01-30', movements: accepted('2024-01-30') },
  { id: 'ac8', number: '05-12/2019', nomenclatureId: 'n7', title: 'Кассовые журналы ЦБУ Мирабад, 2019 г.', year: 2019, departmentId: 'd8', documents: 24, pages: 2880, location: loc('Б-002', 'Стеллаж 14', 1, 'К-0610'), status: 'stored', retentionUntil: '2025-01-01', transferredAt: '2021-05-12', movements: accepted('2021-05-12') },
  { id: 'ac9', number: '01-02/2020', nomenclatureId: 'n1', title: 'Приказы по основной деятельности, 2020 г., т. 1', year: 2020, departmentId: 'd2', documents: 236, pages: 512, location: loc('А-014', 'Стеллаж 3', 3, 'К-0108'), status: 'stored', retentionUntil: null, transferredAt: '2022-02-14', movements: accepted('2022-02-14') },
  { id: 'ac10', number: '01-02/2014', nomenclatureId: 'n1', title: 'Приказы по основной деятельности, 2014 г.', year: 2014, departmentId: 'd2', documents: 198, pages: 431, location: loc('А-012', 'Стеллаж 1', 1, 'К-0031'), status: 'stored', retentionUntil: null, transferredAt: '2016-03-01', movements: accepted('2016-03-01') },
];

type DocSeed = Omit<ArchiveDocument, 'uid' | 'checksum' | 'version' | 'versions' | 'movements' | 'receivedAt' | 'createdAt' | 'departmentId' | 'source'> & Partial<Pick<ArchiveDocument, 'source' | 'createdAt' | 'receivedAt' | 'departmentId'>>;

export const archiveDocumentSeed: DocSeed[] = [
  { id: 'ad1', caseId: 'ac1', docNumber: '№ 112', docDate: '2019-04-18', title: 'Об открытии центра банковских услуг в г. Нукус', kind: 'Приказ', pages: 2, text: 'Открыть центр банковских услуг в г. Нукус с 1 мая 2019 года. Назначить управляющего.' },
  { id: 'ad2', caseId: 'ac1', docNumber: '№ 187', docDate: '2019-07-02', title: 'Об утверждении учётной политики банка', kind: 'Приказ', pages: 14, text: 'Утвердить учётную политику банка на 2019–2020 годы; ввести план счетов.' },
  { id: 'ad3', caseId: 'ac9', docNumber: '№ 41', docDate: '2020-03-16', title: 'О переходе на дистанционный режим работы', kind: 'Приказ', pages: 3, text: 'Перевести сотрудников головного офиса на дистанционную работу в связи с карантином.' },
  { id: 'ad4', caseId: 'ac2', docNumber: 'DG-2020-0145', docDate: '2020-05-20', title: 'Договор сопровождения процессингового ПО', kind: 'Договор', pages: 18, responsibleId: 'u3' },
  { id: 'ad5', caseId: 'ac2', docNumber: 'DG-2020-0201', docDate: '2020-08-11', title: 'Договор поставки сетевого оборудования', kind: 'Договор', pages: 22, responsibleId: 'u3' },
  { id: 'ad6', caseId: 'ac6', docNumber: 'KD-2021-3377', docDate: '2021-09-30', title: 'Кредитное досье OOO «Avto Park Lizing» (закрыт)', kind: 'Кредитное досье', pages: 140, restricted: true },
  { id: 'ad7', caseId: 'ac7', docNumber: '14-07/1832', docDate: '2022-11-04', title: 'Ответ на запрос о соблюдении требований по ПОД/ФТ', kind: 'Письмо', pages: 4, responsibleId: 'u5', text: 'Сообщаем о выполнении требований по противодействию легализации доходов.' },
  { id: 'ad8', caseId: 'ac5', docNumber: 'ЛД-0418', docDate: '2018-12-28', title: 'Личное дело Валиева Г. (уволен)', kind: 'Личное дело', pages: 46, restricted: true },
  { id: 'ad9', caseId: 'ac3', docNumber: 'МО-19-12-0091', docDate: '2019-12-30', title: 'Мемориальный ордер по закрытию операционного дня', kind: 'Мемориальный ордер', pages: 1 },
  // Реестр принятых электронных документов, ещё не сведённых в дела
  { id: 'ad10', caseId: null, docNumber: 'MO-2026-0907', docDate: '2026-10-02', title: 'Мемориальный ордер: оплата лицензий СЭД', kind: 'Мемориальный ордер', source: 'abs', departmentId: 'd7', createdAt: '2026-10-02T11:30:00Z', receivedAt: ago(5), pages: 1, responsibleId: 'u7', nomenclatureIndex: '05-07', text: 'Оплата лицензий СЭД по счёт-фактуре EF-2026-0398' },
  { id: 'ad11', caseId: null, docNumber: 'MO-2026-0908', docDate: '2026-10-03', title: 'Мемориальный ордер: хозяйственные расходы ЦБУ', kind: 'Мемориальный ордер', source: 'abs', departmentId: 'd7', createdAt: '2026-10-03T12:10:00Z', receivedAt: ago(4), pages: 1, responsibleId: 'u7', nomenclatureIndex: '05-07' },
  { id: 'ad12', caseId: null, docNumber: 'MO-2026-0910', docDate: '2026-10-06', title: 'Мемориальный ордер: коммунальные платежи', kind: 'Мемориальный ордер', source: 'abs', departmentId: 'd7', createdAt: '2026-10-06T10:00:00Z', receivedAt: ago(3), pages: 1, responsibleId: 'u7', nomenclatureIndex: '05-07' },
];

export const archiveRequestSeed: ArchiveRequest[] = [
  { id: 'ar1', number: 'AV-2026-0071', caseId: 'ac2', requesterId: 'u3', purpose: 'Подготовка к аудиту договоров с ИТ-поставщиками', requestedAt: '2026-09-29T08:00:00Z', dueBack: '2026-10-13', status: 'issued', issuedAt: '2026-09-30T07:00:00Z' },
  { id: 'ar2', number: 'AV-2026-0074', caseId: 'ac6', requesterId: 'u5', purpose: 'Запрос суда по закрытому кредиту', requestedAt: '2026-10-09T09:00:00Z', dueBack: '2026-10-30', status: 'issued', issuedAt: '2026-10-10T06:30:00Z' },
  { id: 'ar3', number: 'AV-2026-0076', caseId: 'ac1', requesterId: 'u1', purpose: 'Копия приказа об открытии ЦБУ для лицензирования', requestedAt: '2026-10-16T10:00:00Z', dueBack: '2026-10-23', status: 'new' },
  { id: 'ar4', number: 'AV-2026-0062', caseId: 'ac7', requesterId: 'u5', purpose: 'Проверка переписки по ПОД/ФТ', requestedAt: '2026-09-02T08:00:00Z', dueBack: '2026-09-16', status: 'returned', issuedAt: '2026-09-03T06:00:00Z', returnedAt: '2026-09-15T12:00:00Z' },
];

export const archiveActSeed: ArchiveDestructionAct[] = [
  { id: 'aa1', number: 'AU-2026-0003', kind: 'destruction', caseIds: ['ac8'], createdAt: '2026-10-01T09:00:00Z', createdBy: 'u16', status: 'draft', history: [{ at: '2026-10-01T09:00:00Z', userId: 'u16', action: 'created' }] },
];

export const archiveTaskSeed: ArchiveTransferTask[] = [
  { id: 'at1', number: 'SD-2026-0011', departmentId: 'd7', nomenclatureId: 'n3', year: 2025, responsibleId: 'u7', dueDate: inDays(2), createdAt: ago(20), createdBy: 'u16', status: 'open' },
  { id: 'at2', number: 'SD-2026-0009', departmentId: 'd4', nomenclatureId: 'n2', year: 2025, responsibleId: 'u3', dueDate: inDays(-4), createdAt: ago(30), createdBy: 'u16', status: 'open' },
];

export const archiveErrorSeed: ArchiveIntakeError[] = [
  { id: 'ae1', at: ago(2), source: 'abs', sourceRef: 'MO-2026-0907', docNumber: 'MO-2026-0907', reason: 'duplicate', details: 'Документ с этим номером и датой уже принят (ARC-…)', status: 'open' },
];
