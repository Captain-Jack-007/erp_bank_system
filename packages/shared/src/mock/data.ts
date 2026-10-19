// Синтетические демо-данные. Все компании, люди и номера вымышлены.
import type {
  ApprovalTask,
  BudgetLine,
  Contract,
  Counterparty,
  Department,
  EmployeeRequest,
  ProcurementRequest,
  Tender,
  User,
} from '../types';

export const departments: Department[] = [
  { id: 'd1', code: 'IT', name: { ru: 'Департамент информационных технологий', uz: 'Axborot texnologiyalari departamenti', en: 'Information Technology Department' }, headId: 'u2' },
  { id: 'd2', code: 'ADM', name: { ru: 'Административно-хозяйственный департамент', uz: "Ma'muriy-xo'jalik departamenti", en: 'Administration and Facilities Department' }, headId: 'u6' },
  { id: 'd3', code: 'FIN', name: { ru: 'Финансовый департамент', uz: 'Moliya departamenti', en: 'Finance Department' }, headId: 'u4' },
  { id: 'd4', code: 'PRC', name: { ru: 'Отдел закупок', uz: "Xaridlar bo'limi", en: 'Procurement Department' }, headId: 'u3' },
  { id: 'd5', code: 'LEG', name: { ru: 'Юридический департамент', uz: 'Yuridik departament', en: 'Legal Department' }, headId: 'u5' },
  { id: 'd6', code: 'HR', name: { ru: 'Департамент по работе с персоналом', uz: 'Xodimlar bilan ishlash departamenti', en: 'Human Resources Department' }, headId: 'u13' },
  { id: 'd7', code: 'ACC', name: { ru: 'Главная бухгалтерия', uz: 'Bosh buxgalteriya', en: 'Chief Accounting Office' }, headId: 'u7' },
  { id: 'd8', code: 'TRS', name: { ru: 'Казначейство', uz: "G'aznachilik", en: 'Treasury' }, headId: 'u8' },
  { id: 'd9', code: 'RET', name: { ru: 'Розничный бизнес', uz: 'Chakana biznes', en: 'Retail Banking' } },
  { id: 'd10', code: 'CORP', name: { ru: 'Корпоративный бизнес', uz: 'Korporativ biznes', en: 'Corporate Banking' } },
  { id: 'd11', code: 'AUD', name: { ru: 'Служба внутреннего аудита', uz: 'Ichki audit xizmati', en: 'Internal Audit Service' }, headId: 'u19' },
];

export const users: User[] = [
  { id: 'u1', fullName: 'Азизов Бекзод', role: 'employee', departmentId: 'd1', position: { ru: 'Ведущий специалист', uz: 'Yetakchi mutaxassis', en: 'Lead Specialist' }, email: 'b.azizov@example.uz', login: 'b.azizov', positionId: 'p1', orgUnitKey: 'd1', active: true },
  { id: 'u2', fullName: 'Каримова Нилуфар', role: 'dept_head', departmentId: 'd1', position: { ru: 'Директор департамента ИТ', uz: 'AT departamenti direktori', en: 'Director of IT Department' }, email: 'n.karimova@example.uz', login: 'n.karimova', positionId: 'p2', orgUnitKey: 'd1', active: true },
  { id: 'u3', fullName: 'Рахимов Жасур', role: 'procurement', departmentId: 'd4', position: { ru: 'Начальник отдела закупок', uz: "Xaridlar bo'limi boshlig'i", en: 'Head of Procurement' }, email: 'j.rahimov@example.uz', login: 'j.rahimov', positionId: 'p3', orgUnitKey: 'd4', active: true },
  { id: 'u4', fullName: 'Юсупова Дилноза', role: 'finance', departmentId: 'd3', position: { ru: 'Финансовый директор', uz: 'Moliya direktori', en: 'Chief Financial Officer' }, email: 'd.yusupova@example.uz', login: 'd.yusupova', positionId: 'p4', orgUnitKey: 'd3', active: true },
  { id: 'u5', fullName: 'Ташкентов Шерзод', role: 'legal', departmentId: 'd5', position: { ru: 'Главный юрист', uz: 'Bosh yurist', en: 'Chief Legal Counsel' }, email: 'sh.tashkentov@example.uz', login: 'sh.tashkentov', positionId: 'p5', orgUnitKey: 'd5', active: true },
  { id: 'u6', fullName: 'Мирзаев Отабек', role: 'admin', departmentId: 'd2', position: { ru: 'Администратор системы', uz: 'Tizim administratori', en: 'System Administrator' }, email: 'o.mirzaev@example.uz', login: 'o.mirzaev', positionId: 'p6', orgUnitKey: 'd2', active: true },
  { id: 'u7', fullName: 'Хасанова Малика', role: 'accountant', departmentId: 'd7', position: { ru: 'Главный бухгалтер', uz: 'Bosh buxgalter', en: 'Chief Accountant' }, email: 'm.hasanova@example.uz', login: 'm.hasanova', positionId: 'p7', orgUnitKey: 'd7', active: true },
  { id: 'u8', fullName: 'Ергашев Сардор', role: 'treasury', departmentId: 'd8', position: { ru: 'Начальник казначейства', uz: "G'aznachilik boshlig'i", en: 'Head of Treasury' }, email: 's.ergashev@example.uz', login: 's.ergashev', positionId: 'p8', orgUnitKey: 'd8', active: true },
  // Роли платформы (ТЗ PR-GEN-063) и роли модулей — по одному демо-пользователю на роль
  { id: 'u9', fullName: 'Норматова Шахноза', role: 'data_entry', departmentId: 'd9', position: { ru: 'Оператор ввода данных', uz: "Ma'lumot kiritish operatori", en: 'Data Entry Operator' }, email: 'sh.normatova@example.uz', login: 'sh.normatova', positionId: 'p9', orgUnitKey: 'R01-OPS', active: true },
  { id: 'u10', fullName: 'Абдуллаев Фаррух', role: 'approver', departmentId: 'd10', position: { ru: 'Заместитель директора департамента', uz: "Departament direktori o'rinbosari", en: 'Deputy Department Director' }, email: 'f.abdullaev@example.uz', login: 'f.abdullaev', positionId: 'p10', orgUnitKey: 'd10', active: true },
  { id: 'u11', fullName: 'Исмоилова Гулноза', role: 'analyst', departmentId: 'd3', position: { ru: 'Аналитик', uz: 'Tahlilchi', en: 'Analyst' }, email: 'g.ismoilova@example.uz', login: 'g.ismoilova', positionId: 'p11', orgUnitKey: 'd3', active: true },
  { id: 'u12', fullName: 'Турсунов Акмал', role: 'cash_operator', departmentId: 'd9', position: { ru: 'Кассир-операционист НДО', uz: 'NDO kassir-operatsionisti', en: 'Teller, Mini-Bank Office' }, email: 'a.tursunov@example.uz', login: 'a.tursunov', positionId: 'p12', orgUnitKey: 'R01-B01', active: true },
  { id: 'u13', fullName: 'Сафарова Дилфуза', role: 'hr', departmentId: 'd6', position: { ru: 'Менеджер по персоналу', uz: "Xodimlar bo'yicha menejer", en: 'HR Manager' }, email: 'd.safarova@example.uz', login: 'd.safarova', positionId: 'p13', orgUnitKey: 'd6', active: true },
  { id: 'u14', fullName: 'Холматов Улугбек', role: 'storekeeper', departmentId: 'd2', position: { ru: 'Заведующий складом', uz: 'Ombor mudiri', en: 'Warehouse Manager' }, email: 'u.holmatov@example.uz', login: 'u.holmatov', positionId: 'p14', orgUnitKey: 'd2', active: true },
  { id: 'u15', fullName: 'Норкулов Бахтиёр', role: 'driver', departmentId: 'd2', position: { ru: 'Водитель', uz: 'Haydovchi', en: 'Driver' }, email: 'b.norqulov@example.uz', login: 'b.norqulov', positionId: 'p15', orgUnitKey: 'd2', active: true },
  { id: 'u16', fullName: 'Каримов Рустам', role: 'archivist', departmentId: 'd2', position: { ru: 'Архивариус', uz: 'Arxivchi', en: 'Archivist' }, email: 'r.karimov@example.uz', login: 'r.karimov', positionId: 'p16', orgUnitKey: 'd2', active: true },
  { id: 'u17', fullName: 'Худойбердиева Нигора', role: 'tax_officer', departmentId: 'd7', position: { ru: 'Специалист по налогам', uz: "Soliqlar bo'yicha mutaxassis", en: 'Tax Specialist' }, email: 'n.xudoyberdiyeva@example.uz', login: 'n.xudoyberdiyeva', positionId: 'p17', orgUnitKey: 'd7', active: true },
  { id: 'u18', fullName: 'Султанов Тимур', role: 'support', departmentId: 'd1', position: { ru: 'Инженер технической поддержки', uz: "Texnik qo'llab-quvvatlash muhandisi", en: 'Technical Support Engineer' }, email: 't.sultanov@example.uz', login: 't.sultanov', positionId: 'p18', orgUnitKey: 'd1', active: true },
  { id: 'u19', fullName: 'Рашидова Зарина', role: 'auditor', departmentId: 'd11', position: { ru: 'Внутренний аудитор', uz: 'Ichki auditor', en: 'Internal Auditor' }, email: 'z.rashidova@example.uz', login: 'z.rashidova', positionId: 'p19', orgUnitKey: 'd11', active: true },
  { id: 'u21', fullName: 'Юлдашев Азиз', role: 'dept_head', departmentId: 'd9', position: { ru: 'Управляющий филиалом', uz: 'Filial boshqaruvchisi', en: 'Branch Manager' }, email: 'a.yuldashev@example.uz', login: 'a.yuldashev', positionId: 'p20', orgUnitKey: 'R09', active: true },
  // P4-SEC: второй бухгалтер главной бухгалтерии (рядовой бухгалтер; главный бухгалтер — u7)
  { id: 'u22', fullName: 'Абдурахмонова Феруза', role: 'accountant', departmentId: 'd7', position: { ru: 'Бухгалтер', uz: 'Buxgalter', en: 'Accountant' }, email: 'f.abdurahmonova@example.uz', login: 'f.abdurahmonova', positionId: 'p21', orgUnitKey: 'd7', active: true },
  // деактивированная учётная запись (увольнение) — для отчёта access review
  { id: 'u20', fullName: 'Обидов Санжар', role: 'employee', departmentId: 'd9', position: { ru: 'Ведущий специалист', uz: 'Yetakchi mutaxassis', en: 'Lead Specialist' }, email: 's.obidov@example.uz', login: 's.obidov', positionId: 'p1', orgUnitKey: 'R09-RET', active: false },
];

export const counterparties: Counterparty[] = [
  { id: 'c1', name: "OOO «Alfa Texnika Servis»", tin: '301234567', type: 'legal', address: "Toshkent sh., Yunusobod t., 14-uy", phone: '+998 71 200-10-10', rating: 5, blocked: false, director: 'Алимов Р. Т.', vatPayer: true, bankName: 'АКБ «Демо Банк»', bankAccount: '20208000400100001001', mfo: '00401' },
  { id: 'c2', name: "OOO «Raqamli Yechimlar»", tin: '302345678', type: 'legal', address: "Toshkent sh., Mirobod t., 7-uy", phone: '+998 71 200-20-20', rating: 4, blocked: false, director: 'Насыров Д. А.', vatPayer: true, bankName: 'АКБ «Демо Банк»', bankAccount: '20208000400100002002', mfo: '00401' },
  { id: 'c3', name: "MChJ «Ofis Mebel Plus»", tin: '303456789', type: 'legal', address: "Samarqand sh., Registon ko'ch., 3-uy", phone: '+998 66 230-30-30', rating: 4, blocked: false, director: 'Хамидов Ш. Б.', vatPayer: true, bankName: 'АКБ «Демо Банк» Самаркандский филиал', bankAccount: '20208000900100003003', mfo: '00873' },
  { id: 'c4', name: "YaTT Qodirov A.", tin: '404567890', type: 'individual_entrepreneur', address: "Toshkent sh., Chilonzor t., 21-uy", phone: '+998 90 123-45-67', rating: 3, blocked: false },
  { id: 'c5', name: "OOO «Avto Park Lizing»", tin: '305678901', type: 'legal', address: "Toshkent sh., Sergeli t., 9-uy", phone: '+998 71 250-50-50', rating: 4, blocked: false, director: 'Мухаммадиев К. О.', vatPayer: true, bankName: 'АКБ «Демо Банк»', bankAccount: '20208000400100005005', mfo: '00401' },
  { id: 'c6', name: "Global Secure Systems LLC", tin: '900000001', type: 'foreign', address: 'Dubai, UAE', phone: '+971 4 000 0000', rating: 2, blocked: true },
  // P2-PROC: контрагенты по видам договоров (аренда, коммунальные, SWIFT, биржа, строительство, покупатели услуг банка)
  { id: 'c7', name: "AJ «Tovar-xomashyo birjasi» (demo)", tin: '200500700', type: 'legal', address: "Toshkent sh., Bobur ko'ch., 77-uy", phone: '+998 71 207-77-77', rating: 5, blocked: false, director: 'Демо Д. Д.', vatPayer: true, bankName: 'АКБ «Демо Банк»', bankAccount: '20208000400100007007', mfo: '00401' },
  { id: 'c8', name: "OOO «Shahar Energiya Ta'minot» (demo)", tin: '201300800', type: 'legal', address: "Toshkent sh., Shayxontohur t., 5-uy", phone: '+998 71 239-00-00', rating: 4, blocked: false, director: 'Демо Э. Э.', vatPayer: true, bankName: 'АКБ «Демо Банк»', bankAccount: '20208000400100008008', mfo: '00401' },
  { id: 'c9', name: 'Ergashev Anvar Bahodirovich (jismoniy shaxs)', tin: '512345678', type: 'individual_entrepreneur', address: "Samarqand sh., Amir Temur ko'ch., 41-uy", phone: '+998 91 555-41-41', rating: 4, blocked: false, bankName: 'АКБ «Демо Банк» Самаркандский филиал', bankAccount: '22618000900100009009', mfo: '00873' },
  { id: 'c10', name: 'Nordic Card Systems AB', tin: '900000010', type: 'foreign', address: 'Stockholm, Sweden', phone: '+46 8 000 0000', rating: 4, blocked: false, director: 'J. Demo', bankName: 'Demo Bank AB', swiftBic: 'DEMOSESS', iban: 'SE4550000000058398257466' },
  { id: 'c11', name: "MChJ «Qurilish Ta'mir Servis»", tin: '306789012', type: 'legal', address: "Toshkent sh., Olmazor t., 18-uy", phone: '+998 71 244-18-18', rating: 4, blocked: false, director: 'Рашидов Б. Б.', vatPayer: true, bankName: 'АКБ «Демо Банк»', bankAccount: '20208000400100011011', mfo: '00401' },
  { id: 'c12', name: "OOO «Samarqand Savdo Markazi»", tin: '307890123', type: 'legal', address: "Samarqand sh., Rudakiy ko'ch., 120-uy", phone: '+998 66 233-12-12', rating: 4, blocked: false, director: 'Каюмов С. С.', vatPayer: true, bankName: 'АКБ «Демо Банк» Самаркандский филиал', bankAccount: '20208000900100012012', mfo: '00873' },
];

export const budgetLines: BudgetLine[] = [
  { id: 'b1', code: '2026-IT-HW', name: { ru: 'ИТ-оборудование', uz: 'AT uskunalari', en: 'IT equipment' }, year: 2026, planned: 12_000_000_000, spent: 7_850_000_000 },
  { id: 'b2', code: '2026-IT-SW', name: { ru: 'Программное обеспечение и лицензии', uz: "Dasturiy ta'minot va litsenziyalar", en: 'Software and licences' }, year: 2026, planned: 8_500_000_000, spent: 6_120_000_000 },
  { id: 'b3', code: '2026-ADM-FURN', name: { ru: 'Мебель и оснащение офисов', uz: 'Mebel va ofis jihozlari', en: 'Office furniture and fittings' }, year: 2026, planned: 3_200_000_000, spent: 1_400_000_000 },
  { id: 'b4', code: '2026-ADM-AUTO', name: { ru: 'Автотранспорт и ГСМ', uz: "Avtotransport va yoqilg'i", en: 'Vehicles and fuel' }, year: 2026, planned: 5_600_000_000, spent: 4_980_000_000 },
];

export const procurementRequests: ProcurementRequest[] = [
  {
    id: 'pr1', number: 'ZK-2026-0141', title: 'Ноутбуки для департамента ИТ', departmentId: 'd1', initiatorId: 'u1', budgetLineId: 'b1',
    kind: 'goods', costCenterKey: 'CC0002', businessGroupId: 'bg1', branchKey: 'd1', intake: 'approval',
    method: 'quotes', status: 'pending', neededBy: '2026-11-20', createdAt: '2026-10-14T09:12:00Z',
    justification: 'Замена устаревшей техники (срок эксплуатации более 5 лет) для 25 сотрудников.',
    items: [
      { name: 'Ноутбук 14", Core i7, 16 ГБ, SSD 512 ГБ', qty: 25, unit: 'шт', unitPrice: 14_500_000, catalogId: 'nc1', spec: 'CPU не ниже Core i7 13-го поколения; ОЗУ 16 ГБ; SSD 512 ГБ; гарантия 3 года' },
      { name: 'Док-станция USB-C', qty: 25, unit: 'шт', unitPrice: 1_900_000, catalogId: 'nc2' },
    ],
    history: [
      { at: '2026-10-14T09:12:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-14T09:20:00Z', userId: 'u1', action: 'submitted' },
    ],
  },
  {
    id: 'pr2', number: 'ZK-2026-0138', title: 'Лицензии антивирусного ПО на 2027 год', departmentId: 'd1', initiatorId: 'u1', budgetLineId: 'b2',
    kind: 'goods', costCenterKey: 'CC0005', businessGroupId: 'bg1', branchKey: 'd1', intake: 'approval',
    method: 'tender', status: 'in_tender', neededBy: '2026-12-25', createdAt: '2026-10-02T11:40:00Z',
    justification: 'Продление защиты рабочих станций и серверов, 3 200 узлов.',
    items: [{ name: 'Лицензия антивирусной защиты, 1 год', qty: 3200, unit: 'лиц', unitPrice: 310_000, catalogId: 'nc7' }],
    history: [
      { at: '2026-10-02T11:40:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-02T12:00:00Z', userId: 'u1', action: 'submitted' },
      { at: '2026-10-04T08:30:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-10-06T10:10:00Z', userId: 'u4', action: 'approved', comment: 'В пределах бюджета статьи 2026-IT-SW.' },
      { at: '2026-10-07T09:00:00Z', userId: 'u3', action: 'status_changed', comment: 'Объявлен тендер TN-2026-0052' },
    ],
  },
  {
    id: 'pr3', number: 'ZK-2026-0133', title: 'Офисная мебель для филиала в Самарканде', departmentId: 'd2', initiatorId: 'u6', budgetLineId: 'b3',
    kind: 'goods', costCenterKey: 'CC0008', businessGroupId: 'bg2', branchKey: 'd2', intake: 'approval',
    method: 'quotes', status: 'contracted', neededBy: '2026-11-01', createdAt: '2026-09-18T07:00:00Z',
    justification: 'Открытие нового центра банковских услуг.',
    items: [
      { name: 'Стол рабочий 1400×700', qty: 30, unit: 'шт', unitPrice: 2_400_000, catalogId: 'nc11' },
      { name: 'Кресло офисное', qty: 30, unit: 'шт', unitPrice: 1_750_000, catalogId: 'nc12' },
      { name: 'Шкаф для документов', qty: 12, unit: 'шт', unitPrice: 3_100_000 },
    ],
    history: [
      { at: '2026-09-18T07:00:00Z', userId: 'u6', action: 'created' },
      { at: '2026-09-19T10:00:00Z', userId: 'u4', action: 'approved' },
      { at: '2026-09-28T14:00:00Z', userId: 'u3', action: 'status_changed', comment: 'Заключён договор DG-2026-0311' },
    ],
  },
  {
    id: 'pr4', number: 'ZK-2026-0144', title: 'Серверное оборудование для резервного ЦОД', departmentId: 'd1', initiatorId: 'u1', budgetLineId: 'b1',
    kind: 'goods', costCenterKey: 'CC0005', businessGroupId: 'bg1', branchKey: 'd1',
    method: 'tender', status: 'draft', neededBy: '2027-02-15', createdAt: '2026-10-17T15:30:00Z',
    justification: 'Расширение вычислительных мощностей резервного центра обработки данных.',
    items: [{ name: 'Сервер 2U, 2×CPU, 512 ГБ RAM', qty: 6, unit: 'шт', unitPrice: 285_000_000, catalogId: 'nc3', spec: '2× Xeon Gold, 512 ГБ RAM, 8× SSD 3,84 ТБ, 2 БП, монтаж в стойку' }],
    history: [{ at: '2026-10-17T15:30:00Z', userId: 'u1', action: 'created' }],
  },
  {
    id: 'pr5', number: 'ZK-2026-0129', title: 'Шины зимние для служебного автопарка', departmentId: 'd2', initiatorId: 'u6', budgetLineId: 'b4',
    kind: 'goods', costCenterKey: 'CC0007', businessGroupId: 'bg3', branchKey: 'd2', intake: 'approval',
    method: 'direct', status: 'rejected', neededBy: '2026-11-10', createdAt: '2026-09-10T08:00:00Z',
    justification: 'Сезонная замена шин, 40 автомобилей.',
    items: [{ name: 'Шина зимняя R16', qty: 160, unit: 'шт', unitPrice: 1_150_000, catalogId: 'nc15' }],
    history: [
      { at: '2026-09-10T08:00:00Z', userId: 'u6', action: 'created' },
      { at: '2026-09-12T09:30:00Z', userId: 'u4', action: 'rejected', comment: 'Лимит статьи 2026-ADM-AUTO почти исчерпан. Перенести на январь.' },
    ],
  },
  {
    id: 'pr6', number: 'ZK-2026-0146', title: 'Терминалы самообслуживания для ЦБУ', departmentId: 'd1', initiatorId: 'u1', budgetLineId: 'b1',
    kind: 'goods', costCenterKey: 'CC0002', businessGroupId: 'bg2', branchKey: 'd1', intake: 'approval',
    method: 'tender', status: 'pending', neededBy: '2027-01-30', createdAt: '2026-10-16T10:05:00Z',
    justification: 'Оснащение 8 новых центров банковских услуг.',
    items: [{ name: 'Платёжный терминал самообслуживания', qty: 16, unit: 'шт', unitPrice: 62_000_000, catalogId: 'nc4' }],
    history: [
      { at: '2026-10-16T10:05:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-16T10:15:00Z', userId: 'u1', action: 'submitted' },
      { at: '2026-10-17T09:00:00Z', userId: 'u2', action: 'approved' },
    ],
  },
];

// P2-PROC: заявки ЦБУ (приём через областной региональный центр), согласованные заявки филиалов для сводной закупки, биржевая закупка
procurementRequests.push(
  {
    id: 'pr7', number: 'ZK-2026-0149', title: 'Бумага и канцтовары для ЦБУ «Юнусабад»', departmentId: 'd9', initiatorId: 'u12', budgetLineId: 'b3',
    kind: 'goods', costCenterKey: 'CC0046', businessGroupId: 'bg3', branchKey: 'R01-B01', intake: 'region',
    method: 'e_shop', status: 'pending', neededBy: '2026-11-30', createdAt: '2026-10-17T06:30:00Z',
    justification: 'Квартальная потребность ЦБУ в расходных материалах.',
    items: [
      { name: 'Бумага A4, 80 г/м², пачка 500 л.', qty: 120, unit: 'пач', unitPrice: 52_000, catalogId: 'nc9' },
      { name: 'Папка-регистратор 75 мм', qty: 60, unit: 'шт', unitPrice: 21_000, catalogId: 'nc10' },
    ],
    history: [
      { at: '2026-10-17T06:30:00Z', userId: 'u12', action: 'created' },
      { at: '2026-10-17T06:40:00Z', userId: 'u12', action: 'submitted', comment: 'Направлено в областной региональный центр' },
    ],
  },
  {
    id: 'pr8', number: 'ZK-2026-0137', title: 'Клавиатуры и картриджи для ЦБУ «Самарканд-центр»', departmentId: 'd9', initiatorId: 'u20', budgetLineId: 'b1',
    kind: 'goods', costCenterKey: 'CC0195', businessGroupId: 'bg2', branchKey: 'R09-B01', intake: 'central', consolidationId: 'cs1',
    method: 'quotes', status: 'pending', neededBy: '2026-12-10', createdAt: '2026-10-08T07:00:00Z',
    justification: 'Замена вышедших из строя устройств на рабочих местах операционистов.',
    items: [
      { name: 'Клавиатура + мышь, комплект', qty: 20, unit: 'компл', unitPrice: 190_000, catalogId: 'nc6' },
      { name: 'Картридж лазерный (чёрный)', qty: 30, unit: 'шт', unitPrice: 640_000, catalogId: 'nc5' },
    ],
    history: [
      { at: '2026-10-08T07:00:00Z', userId: 'u20', action: 'created' },
      { at: '2026-10-08T07:10:00Z', userId: 'u20', action: 'submitted', comment: 'Направлено в областной региональный центр' },
      { at: '2026-10-15T08:05:00Z', userId: 'u21', action: 'status_changed', comment: 'Включено в сводную заявку SV-2026-0014 и направлено в центральный аппарат' },
    ],
  },
  {
    id: 'pr9', number: 'ZK-2026-0131', title: 'Картриджи для Ташкентского городского филиала', departmentId: 'd9', initiatorId: 'u9', budgetLineId: 'b1',
    kind: 'goods', costCenterKey: 'CC0042', businessGroupId: 'bg2', branchKey: 'R01', intake: 'approval',
    method: 'quotes', status: 'approved', neededBy: '2026-12-15', createdAt: '2026-09-30T08:00:00Z',
    justification: 'Расходные материалы для операционного отдела филиала.',
    items: [{ name: 'Картридж лазерный (чёрный)', qty: 40, unit: 'шт', unitPrice: 640_000, catalogId: 'nc5' }],
    history: [
      { at: '2026-09-30T08:00:00Z', userId: 'u9', action: 'created' },
      { at: '2026-09-30T08:10:00Z', userId: 'u9', action: 'submitted' },
      { at: '2026-10-02T09:00:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-10-03T09:00:00Z', userId: 'u4', action: 'approved' },
      { at: '2026-10-03T15:00:00Z', userId: 'u3', action: 'approved' },
    ],
  },
  {
    id: 'pr10', number: 'ZK-2026-0132', title: 'Картриджи для отдела ИТ (резерв)', departmentId: 'd1', initiatorId: 'u1', budgetLineId: 'b1',
    kind: 'goods', costCenterKey: 'CC0002', businessGroupId: 'bg1', branchKey: 'd1', intake: 'approval',
    method: 'quotes', status: 'approved', neededBy: '2026-12-20', createdAt: '2026-10-01T08:00:00Z',
    justification: 'Резерв расходных материалов для печатной техники головного офиса.',
    items: [{ name: 'Картридж лазерный (чёрный)', qty: 60, unit: 'шт', unitPrice: 640_000, catalogId: 'nc5' }],
    history: [
      { at: '2026-10-01T08:00:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-01T08:10:00Z', userId: 'u1', action: 'submitted' },
      { at: '2026-10-02T10:00:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-10-03T10:00:00Z', userId: 'u4', action: 'approved' },
      { at: '2026-10-03T16:00:00Z', userId: 'u3', action: 'approved' },
    ],
  },
  {
    id: 'pr11', number: 'ZK-2026-0127', title: 'Шины зимние через биржевые торги', departmentId: 'd2', initiatorId: 'u6', budgetLineId: 'b4',
    kind: 'goods', costCenterKey: 'CC0007', businessGroupId: 'bg3', branchKey: 'd2', intake: 'approval',
    method: 'exchange', status: 'approved', neededBy: '2026-12-01', createdAt: '2026-09-25T08:00:00Z',
    justification: 'Повторная закупка после отклонения ZK-2026-0129: объём сокращён до 80 шт., закупка через УзРТСБ.',
    items: [{ name: 'Шина зимняя R16', qty: 80, unit: 'шт', unitPrice: 1_100_000, catalogId: 'nc15' }],
    history: [
      { at: '2026-09-25T08:00:00Z', userId: 'u6', action: 'created' },
      { at: '2026-09-25T08:10:00Z', userId: 'u6', action: 'submitted' },
      { at: '2026-09-27T09:00:00Z', userId: 'u4', action: 'approved' },
      { at: '2026-09-29T09:00:00Z', userId: 'u3', action: 'approved' },
    ],
  },
);

export const tenders: Tender[] = [
  {
    id: 't1', number: 'TN-2026-0052', requestId: 'pr2', title: 'Лицензии антивирусного ПО на 2027 год', status: 'evaluation', deadline: '2026-10-28',
    bids: [
      { counterpartyId: 'c2', amount: 948_000_000, deliveryDays: 5, score: 87 },
      { counterpartyId: 'c1', amount: 992_000_000, deliveryDays: 3, score: 81 },
      { counterpartyId: 'c4', amount: 905_000_000, deliveryDays: 14, score: 74 },
    ],
  },
  {
    id: 't2', number: 'TN-2026-0047', requestId: 'pr3', title: 'Офисная мебель для филиала в Самарканде', status: 'awarded', deadline: '2026-09-25', winnerId: 'c3',
    bids: [
      { counterpartyId: 'c3', amount: 161_400_000, deliveryDays: 20, score: 92 },
      { counterpartyId: 'c4', amount: 158_900_000, deliveryDays: 35, score: 78 },
    ],
  },
];

export const contracts: Contract[] = [
  {
    id: 'k1', number: 'DG-2026-0311', subject: 'Поставка офисной мебели для филиала в Самарканде', counterpartyId: 'c3', departmentId: 'd2',
    amount: 161_400_000, currency: 'UZS', startDate: '2026-09-29', endDate: '2026-12-31', status: 'active', requestId: 'pr3',
    kind: 'fixed_assets', paymentTerms: { type: 'advance', advancePct: 30 }, source: 'tender', costCenterKey: 'CC0008', initiatorDeptIds: ['d2'], penalty: { ratePerDay: 0.1, capPct: 10 },
    payments: [
      { dueDate: '2026-10-05', amount: 48_420_000, paid: true, kind: 'advance', paidAt: '2026-10-05' },
      { dueDate: '2026-11-15', amount: 112_980_000, paid: false, kind: 'final' },
    ],
    stages: [
      { id: 'st1', name: 'Поставка мебели на склад филиала', obligation: 'delivery', dueDate: '2026-10-15', amount: 161_400_000, status: 'done', doneAt: '2026-10-12', docRef: 'AP-2026-0031' },
      { id: 'st2', name: 'Замена 2 кресел по претензии', obligation: 'delivery', dueDate: '2026-10-16', status: 'planned' },
      { id: 'st3', name: 'Окончательный расчёт', obligation: 'payment', dueDate: '2026-11-15', amount: 112_980_000, status: 'planned' },
    ],
    history: [
      { at: '2026-09-28T14:00:00Z', userId: 'u3', action: 'created' },
      { at: '2026-09-29T10:00:00Z', userId: 'u5', action: 'approved', comment: 'Юридическая экспертиза пройдена.' },
    ],
  },
  {
    id: 'k2', number: 'DG-2026-0287', subject: 'Техническое обслуживание серверного оборудования', counterpartyId: 'c1', departmentId: 'd1',
    amount: 1_240_000_000, currency: 'UZS', startDate: '2026-01-01', endDate: '2026-12-31', status: 'active',
    kind: 'long_term', paymentTerms: { type: 'periodic', periodicity: 'quarterly' }, source: 'manual', costCenterKey: 'CC0005', initiatorDeptIds: ['d1'], penalty: { ratePerDay: 0.05, capPct: 5 },
    payments: [
      { dueDate: '2026-03-31', amount: 310_000_000, paid: true, kind: 'periodic', paidAt: '2026-03-30' },
      { dueDate: '2026-06-30', amount: 310_000_000, paid: true, kind: 'periodic', paidAt: '2026-06-29' },
      { dueDate: '2026-09-30', amount: 310_000_000, paid: false, kind: 'by_act' },
      { dueDate: '2026-12-31', amount: 310_000_000, paid: false, kind: 'by_act' },
    ],
    stages: [
      { id: 'st1', name: 'Обслуживание за 1 квартал', obligation: 'works', dueDate: '2026-03-31', status: 'done', doneAt: '2026-04-02' },
      { id: 'st2', name: 'Обслуживание за 2 квартал', obligation: 'works', dueDate: '2026-06-30', status: 'done', doneAt: '2026-07-01' },
      { id: 'st3', name: 'Обслуживание за 3 квартал', obligation: 'works', dueDate: '2026-09-30', status: 'done', doneAt: '2026-10-03', docRef: 'AV-2026-0052' },
      { id: 'st4', name: 'Обслуживание за 4 квартал', obligation: 'works', dueDate: '2026-12-31', status: 'planned' },
    ],
    history: [{ at: '2025-12-20T09:00:00Z', userId: 'u3', action: 'created' }],
  },
  {
    id: 'k3', number: 'DG-2026-0319', subject: 'Лизинг служебных автомобилей (10 ед.)', counterpartyId: 'c5', departmentId: 'd2',
    amount: 85_000, currency: 'USD', startDate: '2026-11-01', endDate: '2029-10-31', status: 'pending',
    kind: 'long_term', paymentTerms: { type: 'periodic', periodicity: 'monthly' }, source: 'manual', costCenterKey: 'CC0007', initiatorDeptIds: ['d2'],
    payments: [{ dueDate: '2026-11-15', amount: 8_500, paid: false, kind: 'advance' }],
    history: [
      { at: '2026-10-15T11:00:00Z', userId: 'u3', action: 'created' },
      { at: '2026-10-15T11:10:00Z', userId: 'u3', action: 'submitted' },
    ],
  },
  {
    id: 'k4', number: 'DG-2025-0198', subject: 'Сопровождение системы электронного документооборота', counterpartyId: 'c2', departmentId: 'd1',
    amount: 420_000_000, currency: 'UZS', startDate: '2025-07-01', endDate: '2026-06-30', status: 'expired',
    kind: 'services', paymentTerms: { type: 'full' }, source: 'manual', costCenterKey: 'CC0002', initiatorDeptIds: ['d1'],
    payments: [{ dueDate: '2026-06-30', amount: 420_000_000, paid: true, kind: 'final', paidAt: '2026-06-28' }],
    history: [{ at: '2025-06-25T09:00:00Z', userId: 'u3', action: 'created' }],
  },
];

// P2-PROC: договоры по видам меню 4.2.2.1 (аренда, коммунальные, строительство, SWIFT, услуги банка, прочие дебиторские)
contracts.push(
  {
    id: 'k5', number: 'DG-2026-0102', subject: 'Аренда помещения ЦБУ «Регистан» у физического лица', counterpartyId: 'c9', departmentId: 'd2',
    amount: 216_000_000, currency: 'UZS', startDate: '2026-01-01', endDate: '2026-12-31', status: 'active',
    kind: 'rent', subkind: 'building_individual', paymentTerms: { type: 'periodic', periodicity: 'monthly' }, source: 'manual', costCenterKey: 'CC0198', initiatorDeptIds: ['d2'],
    objectInfo: 'г. Самарканд, ул. Регистан, 12 — нежилое помещение 140 м²', penalty: { ratePerDay: 0.05, capPct: 5 },
    payments: Array.from({ length: 12 }, (_, i) => ({ dueDate: `2026-${String(i + 1).padStart(2, '0')}-20`, amount: 18_000_000, paid: i < 9, kind: 'periodic' as const, ...(i < 9 ? { paidAt: `2026-${String(i + 1).padStart(2, '0')}-18` } : {}) })),
    history: [{ at: '2025-12-20T09:00:00Z', userId: 'u6', action: 'created' }],
  },
  {
    id: 'k6', number: 'DG-2026-0021', subject: 'Электроснабжение головного офиса', counterpartyId: 'c8', departmentId: 'd2',
    amount: 960_000_000, currency: 'UZS', startDate: '2026-01-01', endDate: '2026-12-31', status: 'active',
    kind: 'utilities', subkind: 'electricity', paymentTerms: { type: 'by_invoice', periodicity: 'monthly' }, source: 'manual', costCenterKey: 'CC0007', initiatorDeptIds: ['d2'],
    objectInfo: 'Лицевой счёт 0012-77-001 (демо), г. Ташкент, головной офис',
    payments: Array.from({ length: 12 }, (_, i) => ({ dueDate: `2026-${String(i + 1).padStart(2, '0')}-25`, amount: 80_000_000, paid: i < 9, kind: 'by_invoice' as const, ...(i < 9 ? { paidAt: `2026-${String(i + 1).padStart(2, '0')}-22` } : {}) })),
    history: [{ at: '2025-12-28T09:00:00Z', userId: 'u6', action: 'created' }],
  },
  {
    id: 'k7', number: 'DG-2026-0255', subject: 'Текущий ремонт операционного зала ЦБУ «Юнусабад»', counterpartyId: 'c11', departmentId: 'd2',
    amount: 380_000_000, currency: 'UZS', startDate: '2026-08-01', endDate: '2026-11-30', status: 'active',
    kind: 'construction', subkind: 'current_repair', paymentTerms: { type: 'by_act', advancePct: 20 }, source: 'tender', costCenterKey: 'CC0046', initiatorDeptIds: ['d2', 'd9'], penalty: { ratePerDay: 0.1, capPct: 15 },
    objectInfo: 'г. Ташкент, Юнусабадский р-н, ЦБУ «Юнусабад»',
    payments: [
      { dueDate: '2026-08-05', amount: 76_000_000, paid: true, kind: 'advance', paidAt: '2026-08-05' },
      { dueDate: '2026-10-10', amount: 152_000_000, paid: false, kind: 'by_act' },
      { dueDate: '2026-12-05', amount: 152_000_000, paid: false, kind: 'by_act' },
    ],
    stages: [
      { id: 'st1', name: 'Демонтаж и черновые работы', obligation: 'works', dueDate: '2026-09-15', amount: 150_000_000, status: 'done', doneAt: '2026-09-14' },
      { id: 'st2', name: 'Отделочные работы', obligation: 'works', dueDate: '2026-10-10', amount: 150_000_000, status: 'planned' },
      { id: 'st3', name: 'Сдача объекта, акт приёмки', obligation: 'acceptance', dueDate: '2026-11-30', amount: 80_000_000, status: 'planned' },
    ],
    history: [{ at: '2026-07-25T09:00:00Z', userId: 'u3', action: 'created' }],
  },
  {
    id: 'k8', number: 'DG-2026-0198', subject: 'Поставка карт и персонализация (международный поставщик)', counterpartyId: 'c10', departmentId: 'd9',
    amount: 120_000, currency: 'USD', startDate: '2026-06-01', endDate: '2027-05-31', status: 'active',
    kind: 'swift', paymentTerms: { type: 'advance', advancePct: 50 }, source: 'manual', costCenterKey: 'CC0028', initiatorDeptIds: ['d9'],
    payments: [
      { dueDate: '2026-06-15', amount: 60_000, paid: true, kind: 'advance', paidAt: '2026-06-14' },
      { dueDate: '2026-11-30', amount: 60_000, paid: false, kind: 'final' },
    ],
    history: [{ at: '2026-05-20T09:00:00Z', userId: 'u3', action: 'created' }],
  },
  {
    id: 'k9', number: 'DG-2026-0230', subject: 'Реализация списанных банкоматов (имущество банка)', counterpartyId: 'c12', departmentId: 'd2',
    amount: 96_000_000, currency: 'UZS', startDate: '2026-07-01', endDate: '2026-09-30', status: 'active',
    kind: 'bank_services', subkind: 'property_sale', paymentTerms: { type: 'full' }, source: 'manual', costCenterKey: 'CC0007', initiatorDeptIds: ['d2'],
    payments: [{ dueDate: '2026-08-15', amount: 96_000_000, paid: false, kind: 'final', note: 'Ожидается оплата покупателя' }],
    receipts: [{ at: '2026-07-20', amount: 24_000_000 }],
    history: [{ at: '2026-06-25T09:00:00Z', userId: 'u6', action: 'created' }],
  },
  {
    id: 'k10', number: 'DZ-2026-0044', subject: 'Оплата по инвойсу: членский взнос ассоциации (без договора)', counterpartyId: 'c2', departmentId: 'd3',
    amount: 15_000_000, currency: 'UZS', startDate: '2026-10-10', endDate: '2026-10-31', status: 'active',
    kind: 'other_receivables', subkind: 'invoice', invoiceRef: { number: 'INV-2026/311', date: '2026-10-10' }, paymentTerms: { type: 'full' }, source: 'manual', costCenterKey: 'CC0010', initiatorDeptIds: ['d3'],
    payments: [{ dueDate: '2026-10-25', amount: 15_000_000, paid: false, kind: 'final' }],
    history: [{ at: '2026-10-10T09:00:00Z', userId: 'u4', action: 'created' }],
  },
  {
    id: 'k11', number: 'DG-2026-0117', subject: 'Аренда места под банкомат в ТЦ (юрлицо)', counterpartyId: 'c12', departmentId: 'd9',
    amount: 36_000_000, currency: 'UZS', startDate: '2026-01-01', endDate: '2026-12-31', status: 'active',
    kind: 'rent', subkind: 'atm_legal', paymentTerms: { type: 'periodic', periodicity: 'monthly' }, source: 'manual', costCenterKey: 'CC0197', initiatorDeptIds: ['d9'],
    objectInfo: 'г. Самарканд, ТЦ «Демо», 1 этаж — 2 м² под банкомат',
    payments: Array.from({ length: 12 }, (_, i) => ({ dueDate: `2026-${String(i + 1).padStart(2, '0')}-10`, amount: 3_000_000, paid: i < 10, kind: 'periodic' as const, ...(i < 10 ? { paidAt: `2026-${String(i + 1).padStart(2, '0')}-08` } : {}) })),
    history: [{ at: '2025-12-25T09:00:00Z', userId: 'u6', action: 'created' }],
  },
  // P3-PROC: безнадёжная дебиторка (аванс выплачен, услуги не оказаны > 365 дн.) — демо резерва 100 %, списания на внебаланс и погашения (PR-CON-040/041)
  {
    id: 'k12', number: 'DG-2025-0141', subject: 'Разработка обучающих видеокурсов (исполнитель прекратил деятельность)', counterpartyId: 'c4', departmentId: 'd6',
    amount: 150_000_000, currency: 'UZS', startDate: '2025-03-01', endDate: '2025-08-31', status: 'active',
    kind: 'services', paymentTerms: { type: 'advance', advancePct: 40 }, source: 'manual', costCenterKey: 'CC0020', initiatorDeptIds: ['d6'], penalty: { ratePerDay: 0.1, capPct: 10 },
    payments: [
      { dueDate: '2025-03-05', amount: 60_000_000, paid: true, kind: 'advance', paidAt: '2025-03-05' },
      { dueDate: '2025-08-31', amount: 90_000_000, paid: false, kind: 'final' },
    ],
    stages: [{ id: 'st1', name: 'Передача 12 видеокурсов', obligation: 'works', dueDate: '2025-08-31', amount: 150_000_000, status: 'planned' }],
    history: [{ at: '2025-02-20T09:00:00Z', userId: 'u6', action: 'created' }],
  },
);

export const employeeRequests: EmployeeRequest[] = [
  { id: 'e1', number: 'ZA-2026-1204', type: 'it_access', description: 'Доступ к модулю отчётности для нового сотрудника отдела аналитики.', initiatorId: 'u1', status: 'pending', createdAt: '2026-10-17T08:40:00Z', history: [{ at: '2026-10-17T08:40:00Z', userId: 'u1', action: 'created' }] },
  { id: 'e2', number: 'ZA-2026-1198', type: 'certificate', description: 'Справка с места работы для посольства.', initiatorId: 'u1', status: 'done', createdAt: '2026-10-12T10:00:00Z', history: [{ at: '2026-10-12T10:00:00Z', userId: 'u1', action: 'created' }, { at: '2026-10-13T09:00:00Z', userId: 'u6', action: 'status_changed', comment: 'Справка готова, получить в отделе кадров.' }] },
  { id: 'e3', number: 'ZA-2026-1201', type: 'equipment', description: 'Второй монитор 27" для рабочего места.', initiatorId: 'u1', status: 'in_progress', createdAt: '2026-10-15T13:20:00Z', history: [{ at: '2026-10-15T13:20:00Z', userId: 'u1', action: 'created' }, { at: '2026-10-16T09:00:00Z', userId: 'u2', action: 'approved' }] },
  { id: 'e4', number: 'ZA-2026-1190', type: 'vacation', description: 'Ежегодный отпуск с 01.12.2026 по 14.12.2026.', initiatorId: 'u5', status: 'pending', createdAt: '2026-10-10T07:30:00Z', history: [{ at: '2026-10-10T07:30:00Z', userId: 'u5', action: 'created' }] },
  { id: 'e5', number: 'ZA-2026-1185', type: 'repair', description: 'Не работает кондиционер в кабинете 412.', initiatorId: 'u4', status: 'done', createdAt: '2026-10-06T11:00:00Z', history: [{ at: '2026-10-06T11:00:00Z', userId: 'u4', action: 'created' }] },
  // P2-PROC: заявки на обеспечение со склада (ТЗ 4.2.7)
  {
    id: 'e6', number: 'ZA-2026-1207', type: 'stationery', description: 'Канцтовары для отдела сопровождения ИТ на ноябрь', initiatorId: 'u1', status: 'warehouse', createdAt: '2026-10-16T07:00:00Z',
    departmentId: 'd1', costCenterKey: 'CC0002', warehouseId: 'wh1', budgetLineId: 'b3', amount: 1_460_000,
    items: [
      { warehouseItemId: 'wi1', sku: 'OF-0001', name: 'Бумага A4, 80 г/м², пачка 500 л.', unit: 'пач', qty: 20, unitCost: 52_000 },
      { warehouseItemId: 'wi2', sku: 'OF-0014', name: 'Папка-регистратор 75 мм', unit: 'шт', qty: 20, unitCost: 21_000 },
    ],
    history: [
      { at: '2026-10-16T07:00:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-16T07:05:00Z', userId: 'u1', action: 'submitted' },
      { at: '2026-10-16T12:00:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-10-16T12:00:00Z', userId: 'u2', action: 'status_changed', comment: 'Передана на склад' },
    ],
  },
  {
    id: 'e7', number: 'ZA-2026-1209', type: 'it', description: 'Комплект клавиатура + мышь и картридж для нового сотрудника', initiatorId: 'u1', status: 'pending', createdAt: '2026-10-17T10:00:00Z',
    departmentId: 'd1', costCenterKey: 'CC0002', warehouseId: 'wh1', budgetLineId: 'b1', amount: 830_000,
    items: [
      { warehouseItemId: 'wi4', sku: 'IT-0130', name: 'Клавиатура + мышь, комплект', unit: 'компл', qty: 1, unitCost: 190_000 },
      { warehouseItemId: 'wi3', sku: 'IT-0102', name: 'Картридж лазерный (чёрный)', unit: 'шт', qty: 1, unitCost: 640_000 },
    ],
    history: [
      { at: '2026-10-17T10:00:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-17T10:02:00Z', userId: 'u1', action: 'submitted' },
    ],
  },
];

export const approvalTasks: ApprovalTask[] = [
  { id: 'a1', entity: 'procurement', entityId: 'pr1', title: 'Ноутбуки для департамента ИТ', number: 'ZK-2026-0141', amount: 410_000_000, requesterId: 'u1', assigneeRole: 'dept_head', step: 1, totalSteps: 3, createdAt: '2026-10-14T09:20:00Z', dueAt: '2026-10-16T18:00:00Z', status: 'pending' },
  { id: 'a2', entity: 'procurement', entityId: 'pr6', title: 'Терминалы самообслуживания для ЦБУ', number: 'ZK-2026-0146', amount: 992_000_000, requesterId: 'u1', assigneeRole: 'finance', step: 2, totalSteps: 3, createdAt: '2026-10-17T09:00:00Z', dueAt: '2026-10-21T18:00:00Z', status: 'pending' },
  { id: 'a3', entity: 'contract', entityId: 'k3', title: 'Лизинг служебных автомобилей (10 ед.)', number: 'DG-2026-0319', amount: 85_000, currency: 'USD', requesterId: 'u3', assigneeRole: 'legal', step: 1, totalSteps: 2, createdAt: '2026-10-15T11:10:00Z', dueAt: '2026-10-20T18:00:00Z', status: 'pending' },
  { id: 'a4', entity: 'employee_request', entityId: 'e1', title: 'Доступ к модулю отчётности', number: 'ZA-2026-1204', requesterId: 'u1', assigneeRole: 'dept_head', step: 1, totalSteps: 1, createdAt: '2026-10-17T08:40:00Z', dueAt: '2026-10-19T18:00:00Z', status: 'pending' },
  { id: 'a5', entity: 'employee_request', entityId: 'e4', title: 'Ежегодный отпуск', number: 'ZA-2026-1190', requesterId: 'u5', assigneeRole: 'dept_head', step: 1, totalSteps: 1, createdAt: '2026-10-10T07:30:00Z', dueAt: '2026-10-14T18:00:00Z', status: 'pending' },
  { id: 'a6', entity: 'employee_request', entityId: 'e7', title: 'ИТ: клавиатура, мышь, картридж', number: 'ZA-2026-1209', amount: 830_000, requesterId: 'u1', assigneeRole: 'dept_head', step: 1, totalSteps: 1, createdAt: '2026-10-17T10:02:00Z', dueAt: '2026-10-22T18:00:00Z', status: 'pending' },
];
