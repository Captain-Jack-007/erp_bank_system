// Демо-данные контура НДО (вымышленные объекты, суммы и объёмы). Генераторы «систем-источников» детерминированы:
// повторная загрузка того же периода даёт те же записи (проверка загрузки без дублей).
import type { Localized } from '../../types';
import type { NdoClassItem, NdoDataset, NdoObject, NdoParams, NdoRule, NdoTariff } from './ndoTypes';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const B = 1_000_000_000;

export const NDO_PERIODS = ['2026-07', '2026-08', '2026-09', '2026-10'];

const O = (key: string, type: NdoObject['type'], code: string, name: Localized, orgUnitKey: string, costCenterCode: string, extra: Partial<NdoObject> = {}): NdoObject => ({
  key, version: 1, validFrom: '2026-01-01', type, code, name, status: 'active', orgUnitKey, costCenterCode, respCenter: extra.respCenter ?? 'ЦО-НДО', ...extra,
});

export const ndoObjectsSeed: NdoObject[] = [
  O('NDO-EKC-01', 'ekc', 'EKC-TSH', L('ЕКЦ Ташкент', 'YKM Toshkent', 'Cash Centre Tashkent'), 'R01', 'MVZ-01-000-O1', { normative: 120 * B, respCenter: 'ЦО-ЕКЦ' }),
  O('NDO-EKC-02', 'ekc', 'EKC-SAM', L('ЕКЦ Самарканд', 'YKM Samarqand', 'Cash Centre Samarkand'), 'R09', 'MVZ-09-000-O1', { normative: 40 * B, respCenter: 'ЦО-ЕКЦ' }),
  O('NDO-VLT-00', 'vault', 'CV', L('Центральное хранилище', 'Markaziy xazina', 'Central vault'), 'HO', 'MVZ-00-008-02', { cashBranchId: 'cb0', normative: 400 * B, respCenter: 'ЦО-Казначейство' }),
  O('NDO-CBU-TSH', 'cbu', 'TSH', L('Касса Ташкентского городского филиала', 'Toshkent shahar filiali kassasi', 'Tashkent City branch cash'), 'R01', 'MVZ-01-000-O1', { cashBranchId: 'cb1', parentKey: 'NDO-EKC-01', normative: 30 * B }),
  O('NDO-CBU-YUN', 'cbu', 'YUN', L('Касса ЦБУ «Юнусабад»', 'BXM «Yunusobod» kassasi', 'Yunusabad branch cash'), 'R01-B01', 'MVZ-01-001-02', { cashBranchId: 'cb2', parentKey: 'NDO-EKC-01', normative: 20 * B }),
  O('NDO-CBU-CHL', 'cbu', 'CHL', L('Касса ЦБУ «Чиланзар»', 'BXM «Chilonzor» kassasi', 'Chilanzar branch cash'), 'R01-B02', 'MVZ-01-002-02', { cashBranchId: 'cb3', parentKey: 'NDO-EKC-01', normative: 20 * B }),
  O('NDO-CBU-SAM', 'cbu', 'SAM', L('Касса Самаркандского филиала', 'Samarqand filiali kassasi', 'Samarkand branch cash'), 'R09-B01', 'MVZ-09-001-02', { cashBranchId: 'cb4', parentKey: 'NDO-EKC-02', normative: 18 * B }),
  O('NDO-CBU-BUX', 'cbu', 'BUX', L('Касса Бухарского филиала', 'Buxoro filiali kassasi', 'Bukhara branch cash'), 'R04-B01', 'MVZ-04-001-02', { cashBranchId: 'cb5', parentKey: 'NDO-EKC-02', normative: 15 * B }),
  O('NDO-CBU-FAR', 'cbu', 'FAR', L('Касса Ферганского филиала', "Farg'ona filiali kassasi", 'Fergana branch cash'), 'R12', 'MVZ-12-000-O1', { cashBranchId: 'cb6', parentKey: 'NDO-EKC-01', normative: 15 * B }),
  O('NDO-CBU-NAM', 'cbu', 'NAM', L('Касса Наманганского филиала', 'Namangan filiali kassasi', 'Namangan branch cash'), 'R08', 'MVZ-08-000-O1', { cashBranchId: 'cb7', parentKey: 'NDO-EKC-01', normative: 12 * B }),
  O('NDO-CBU-AND', 'cbu', 'AND', L('Касса Андижанского филиала', 'Andijon filiali kassasi', 'Andijan branch cash'), 'R03', 'MVZ-03-000-O1', { cashBranchId: 'cb8', parentKey: 'NDO-EKC-01', normative: 14 * B }),
  O('NDO-CBU-NUK', 'cbu', 'NUK', L('Касса Нукусского филиала', 'Nukus filiali kassasi', 'Nukus branch cash'), 'R14', 'MVZ-14-000-O1', { cashBranchId: 'cb9', parentKey: 'NDO-EKC-02', normative: 10 * B }),
  O('NDO-DSK-01', 'cash_desk', 'DSK-MIR', L('Кассовый пункт «Мирабад»', '«Mirobod» kassa punkti', 'Mirabad cash desk'), 'R01-B03', 'MVZ-01-003-02', { parentKey: 'NDO-CBU-TSH', normative: 2 * B }),
  O('NDO-MOB-01', 'mobile_desk', 'MOB-TO', L('Передвижная касса (Ташкентская обл.)', "Ko'chma kassa (Toshkent vil.)", 'Mobile cash desk (Tashkent region)'), 'R02-B01', 'MVZ-02-001-02', { normative: 1 * B }),
  O('NDO-FX-01', 'exchange', 'FX-BUX', L('Пункт обмена валюты «Бухара»', '«Buxoro» valyuta ayirboshlash shoxobchasi', 'Bukhara FX point'), 'R04-B01', 'MVZ-04-001-02', { parentKey: 'NDO-CBU-BUX', normative: 1.5 * B }),
  O('NDO-RT-01', 'cit_route', 'MR-TSH', L('Маршрут инкассации «Ташкент-город»', '«Toshkent-shahar» inkassatsiya yo‘nalishi', 'CIT route Tashkent city'), 'R01', 'MVZ-01-000-O1', { routeKm: 46 }),
  O('NDO-RT-02', 'cit_route', 'MR-FV', L('Маршрут «Ферганская долина»', '«Farg‘ona vodiysi» yo‘nalishi', 'CIT route Fergana valley'), 'R12', 'MVZ-12-000-O1', { routeKm: 412 }),
  O('NDO-RT-03', 'cit_route', 'MR-SB', L('Маршрут «Самарканд–Бухара»', '«Samarqand–Buxoro» yo‘nalishi', 'CIT route Samarkand–Bukhara'), 'R09', 'MVZ-09-000-O1', { routeKm: 318 }),
  O('NDO-VEH-01', 'vehicle', '01A245KB', L('Спецавтомобиль 01 A 245 KB', 'Maxsus avtomobil 01 A 245 KB', 'Armoured vehicle 01 A 245 KB'), 'R01', 'MVZ-01-000-O1', { parentKey: 'NDO-RT-02' }),
  O('NDO-VEH-02', 'vehicle', '01B718LA', L('Спецавтомобиль 01 B 718 LA', 'Maxsus avtomobil 01 B 718 LA', 'Armoured vehicle 01 B 718 LA'), 'R09', 'MVZ-09-000-O1', { parentKey: 'NDO-RT-03' }),
  O('NDO-VEH-03', 'vehicle', '01C903RA', L('Спецавтомобиль 01 C 903 RA', 'Maxsus avtomobil 01 C 903 RA', 'Armoured vehicle 01 C 903 RA'), 'R01', 'MVZ-01-000-O1', { parentKey: 'NDO-RT-01' }),
  O('NDO-EQ-01', 'equipment', 'SORT-TSH', L('Сортировщик банкнот (ЕКЦ Ташкент)', 'Banknota saralash mashinasi (YKM Toshkent)', 'Banknote sorter (Cash Centre Tashkent)'), 'R01', 'MVZ-01-000-O1', { parentKey: 'NDO-EKC-01', model: 'Sorter-X5' }),
  O('NDO-EQ-02', 'equipment', 'CNT-SAM', L('Счётная машина (ЕКЦ Самарканд)', 'Sanash mashinasi (YKM Samarqand)', 'Counting machine (Cash Centre Samarkand)'), 'R09', 'MVZ-09-000-O1', { parentKey: 'NDO-EKC-02', model: 'Counter-200' }),
  O('NDO-ATM-T01', 'recycler', 'ATM-T01', L('Ресайклер ATM-T01 (Юнусабад)', 'Resaykler ATM-T01 (Yunusobod)', 'Recycler ATM-T01 (Yunusabad)'), 'R01-B01', 'MVZ-01-001-03', { parentKey: 'NDO-CBU-YUN', normative: 0.4 * B, model: 'RC-500' }),
  O('NDO-ATM-T02', 'atm', 'ATM-T02', L('Банкомат ATM-T02 (Чиланзар)', 'Bankomat ATM-T02 (Chilonzor)', 'ATM-T02 (Chilanzar)'), 'R01-B02', 'MVZ-01-002-03', { parentKey: 'NDO-CBU-CHL', normative: 0.3 * B, model: 'B-200' }),
  O('NDO-ATM-T03', 'cash_in', 'ATM-T03', L('Cash-in ATM-T03 (Мирабад)', 'Cash-in ATM-T03 (Mirobod)', 'Cash-in ATM-T03 (Mirabad)'), 'R01-B03', 'MVZ-01-003-03', { parentKey: 'NDO-DSK-01', normative: 0.1 * B, model: 'CI-100' }),
  O('NDO-ATM-S01', 'recycler', 'ATM-S01', L('Ресайклер ATM-S01 (Самарканд)', 'Resaykler ATM-S01 (Samarqand)', 'Recycler ATM-S01 (Samarkand)'), 'R09-B01', 'MVZ-09-001-03', { parentKey: 'NDO-CBU-SAM', normative: 0.35 * B, model: 'RC-500' }),
  O('NDO-ATM-S02', 'atm', 'ATM-S02', L('Банкомат ATM-S02 (Самарканд)', 'Bankomat ATM-S02 (Samarqand)', 'ATM-S02 (Samarkand)'), 'R09-B01', 'MVZ-09-001-03', { parentKey: 'NDO-CBU-SAM', normative: 0.25 * B, model: 'B-200' }),
  O('NDO-ATM-F01', 'atm', 'ATM-F01', L('Банкомат ATM-F01 (Фергана)', "Bankomat ATM-F01 (Farg'ona)", 'ATM-F01 (Fergana)'), 'R12-B01', 'MVZ-12-001-03', { parentKey: 'NDO-CBU-FAR', normative: 0.25 * B, model: 'B-200' }),
  O('NDO-ATM-B01', 'cash_in', 'ATM-B01', L('Cash-in ATM-B01 (Бухара)', 'Cash-in ATM-B01 (Buxoro)', 'Cash-in ATM-B01 (Bukhara)'), 'R04-B01', 'MVZ-04-001-03', { parentKey: 'NDO-CBU-BUX', normative: 0.1 * B, model: 'CI-100' }),
  O('NDO-ATM-N01', 'atm', 'ATM-N01', L('Банкомат ATM-N01 (Нукус)', 'Bankomat ATM-N01 (Nukus)', 'ATM-N01 (Nukus)'), 'R14-B01', 'MVZ-14-001-03', { parentKey: 'NDO-CBU-NUK', normative: 0.2 * B, model: 'B-200' }),
];

const C = (kind: NdoClassItem['kind'], code: string, name: Localized, extra: Partial<NdoClassItem> = {}): NdoClassItem => ({ kind, code, name, version: 1, validFrom: '2026-01-01', ...extra });
export const ndoClassSeed: NdoClassItem[] = [
  ...([
    ['order', 'Заказ наличных', 'Naqd pul buyurtmasi', 'Cash ordering'], ['receipt', 'Получение', 'Qabul qilib olish', 'Receipt'], ['storage', 'Хранение', 'Saqlash', 'Storage'], ['processing', 'Обработка и пересчёт', 'Ishlov berish va sanash', 'Processing and counting'],
    ['transport', 'Перевозка', 'Tashish', 'Transport'], ['reinforcement', 'Подкрепление', 'Mustahkamlash', 'Reinforcement'], ['collection', 'Инкассация', 'Inkassatsiya', 'Collection'], ['acceptance', 'Приём наличных', 'Naqd pul qabul qilish', 'Cash acceptance'],
    ['issuance', 'Выдача наличных', 'Naqd pul berish', 'Cash issuance'], ['return', 'Возврат', 'Qaytarish', 'Return'], ['sale', 'Реализация (обмен валюты)', 'Sotish (valyuta ayirboshlash)', 'Sale (FX exchange)'],
  ] as const).map(([code, ru, uz, en]) => C('process', code, L(ru, uz, en))),
  C('article', 'INC-CASH', L('Комиссии за кассовое обслуживание', 'Kassa xizmati komissiyalari', 'Cash service fees'), { direction: 'income', external: true }),
  C('article', 'INC-CIT', L('Доходы от инкассации клиентов', 'Mijozlarni inkassatsiya qilish daromadlari', 'Client CIT income'), { direction: 'income', external: true }),
  C('article', 'INC-DEV', L('Комиссии устройств самообслуживания', "O'z-o'ziga xizmat qurilmalari komissiyalari", 'Self-service device fees'), { direction: 'income', external: true }),
  C('article', 'INC-FX', L('Доходы от обмена валюты', 'Valyuta ayirboshlash daromadlari', 'FX exchange income'), { direction: 'income', external: true }),
  C('article', 'INT-SRV', L('Внутренние расчёты за кассовые услуги', 'Kassa xizmatlari uchun ichki hisob-kitoblar', 'Internal settlements for cash services'), { direction: 'income', external: false }),
  C('article', 'EXP-STAFF', L('Персонал касс и ЕКЦ', 'Kassalar va YKM xodimlari', 'Cash and cash-centre staff'), { direction: 'expense', nature: 'direct' }),
  C('article', 'EXP-CIT', L('Услуги инкассации (внешние)', "Inkassatsiya xizmatlari (tashqi)", 'CIT services (external)'), { direction: 'expense', nature: 'direct' }),
  C('article', 'EXP-INS', L('Страхование наличности', "Naqd pulni sug'urtalash", 'Cash insurance'), { direction: 'expense', nature: 'direct' }),
  C('article', 'EXP-TRN', L('Транспорт и ГСМ', "Transport va YoMM", 'Transport and fuel'), { direction: 'expense', nature: 'direct' }),
  C('article', 'EXP-CNT', L('Пересчёт и обработка', 'Sanash va ishlov berish', 'Counting and processing'), { direction: 'expense', nature: 'direct' }),
  C('article', 'EXP-DSVC', L('Сервис устройств', 'Qurilmalar servisi', 'Device service'), { direction: 'expense', nature: 'direct' }),
  C('article', 'EXP-COMM', L('Связь устройств', 'Qurilmalar aloqasi', 'Device communication'), { direction: 'expense', nature: 'direct' }),
  C('article', 'EXP-REP', L('Ремонт и запчасти', "Ta'mirlash va ehtiyot qismlar", 'Repair and spare parts'), { direction: 'expense', nature: 'direct' }),
  C('article', 'EXP-RENT', L('Аренда помещений касс', 'Kassa binolari ijarasi', 'Cash premises rent'), { direction: 'expense', nature: 'direct' }),
  C('article', 'EXP-ADM', L('Управление НДО (косвенные)', "NPA boshqaruvi (bilvosita)", 'Cash function management (indirect)'), { direction: 'expense', nature: 'indirect' }),
  C('article', 'EXP-SEC', L('Охрана и безопасность (косвенные)', "Qo'riqlash va xavfsizlik (bilvosita)", 'Security (indirect)'), { direction: 'expense', nature: 'indirect' }),
  C('article', 'EXP-HO', L('Доля общебанковских расходов', 'Umumbank xarajatlari ulushi', 'Share of bank-wide overhead'), { direction: 'expense', nature: 'indirect' }),
  ...(['UZS', 'USD', 'EUR', 'RUB'] as const).map((c) => C('currency', c, L(c, c, c))),
  C('cash_state', 'vault', L('В хранилище', 'Xazinada', 'In vault')), C('cash_state', 'desk', L('В кассе', 'Kassada', 'At desk')), C('cash_state', 'device', L('В устройстве', 'Qurilmada', 'In device')),
  C('cash_state', 'processing', L('В обработке', 'Ishlov berishda', 'In processing')), C('cash_state', 'transit', L('В пути', "Yo'lda", 'In transit')),
  C('device_type', 'atm', L('Банкомат (cash-out)', 'Bankomat (cash-out)', 'ATM (cash-out)')), C('device_type', 'cash_in', L('Cash-in', 'Cash-in', 'Cash-in')), C('device_type', 'recycler', L('Ресайклер', 'Resaykler', 'Recycler')),
  C('driver', 'volume', L('Обработанная наличность', 'Ishlov berilgan naqd pul', 'Processed cash'), { unit: 'UZS' }), C('driver', 'transactions', L('Количество операций', 'Operatsiyalar soni', 'Transactions'), { unit: 'шт.' }),
  C('driver', 'collections', L('Количество инкассаций', 'Inkassatsiyalar soni', 'Collections'), { unit: 'шт.' }), C('driver', 'route_km', L('Пробег маршрутов', "Yo'nalishlar masofasi", 'Route km'), { unit: 'км' }), C('driver', 'fte', L('Численность (FTE)', 'Xodimlar soni (FTE)', 'Headcount (FTE)'), { unit: 'FTE' }),
];

export const ndoDatasetsSeed: NdoDataset[] = [
  { id: 'DS-GL', system: 'iabs', integration: { systemId: 'iabs', operation: 'ndo.gl' }, name: L('Доходы и расходы НДО из главной книги', 'Bosh kitobdan NPA daromad va xarajatlari', 'Cash P&L from the general ledger'), owner: L('Департамент бухучёта', 'Buxgalteriya departamenti', 'Accounting Department'), periodicity: 'monthly', granularity: L('статья × объект (МВЗ) × валюта × месяц', 'modda × obyekt (XJM) × valyuta × oy', 'article × object (cost centre) × currency × month'), businessKeys: ['period', 'account', 'costCenter', 'article', 'currency'], transform: L('Счёт ГК + МВЗ → статья НДО и объект; валюта → UZS по курсу ЦБ на дату', "BK hisobvarag'i + XJM → NPA moddasi va obyekt; valyuta → UZS MB kursi bo'yicha", 'GL account + cost centre → cash article and object; FX → UZS at CBU rate'), controlTotal: L('Сумма оборотов по счетам НДО за месяц', "Oy uchun NPA hisobvaraqlari aylanmalari summasi", 'Sum of cash-account turnover for the month'), mandatory: true },
  { id: 'DS-CASH', system: 'cashsys', integration: { systemId: 'cashsys', operation: 'ndo.dataset' }, name: L('Ежедневные остатки и движение наличных', "Kunlik naqd pul qoldiqlari va harakati", 'Daily cash balances and movements'), owner: L('Казначейство', "G'aznachilik", 'Treasury'), periodicity: 'daily', granularity: L('объект × валюта × состояние × номинал × день', 'obyekt × valyuta × holat × nominal × kun', 'object × currency × state × denomination × day'), businessKeys: ['date', 'object', 'currency', 'state'], transform: L('Коды касс/устройств → объект НДО', 'Kassa/qurilma kodlari → NPA obyekti', 'Desk/device codes → cash object'), controlTotal: L('Остатки на конец дня по валютам', 'Valyutalar bo‘yicha kun oxiridagi qoldiqlar', 'End-of-day balances by currency'), mandatory: true },
  { id: 'DS-VOL', system: 'processing', integration: { systemId: 'cashsys', operation: 'ndo.dataset' }, name: L('Операционные объёмы (пересчёт, операции, инкассации)', 'Operatsion hajmlar (sanash, operatsiyalar, inkassatsiyalar)', 'Operating volumes (counting, transactions, collections)'), owner: L('Департамент НДО', 'NPA departamenti', 'Cash Department'), periodicity: 'monthly', granularity: L('объект × драйвер × месяц', 'obyekt × drayver × oy', 'object × driver × month'), businessKeys: ['period', 'object', 'driver'], transform: L('Терминалы процессинга → устройства НДО', 'Protsessing terminallari → NPA qurilmalari', 'Processing terminals → cash devices'), controlTotal: L('Количество операций за месяц', 'Oy uchun operatsiyalar soni', 'Transactions for the month'), mandatory: true },
  { id: 'DS-OPT', system: 'optiload', integration: { systemId: 'cashsys', operation: 'ndo.dataset' }, name: L('Рекомендации OptiLoad по загрузке устройств', "Qurilmalarni yuklash bo'yicha OptiLoad tavsiyalari", 'OptiLoad device loading recommendations'), owner: L('Департамент НДО', 'NPA departamenti', 'Cash Department'), periodicity: 'daily', granularity: L('устройство × дата', 'qurilma × sana', 'device × date'), businessKeys: ['date', 'device'], transform: L('ID устройства → объект НДО', 'Qurilma ID → NPA obyekti', 'Device ID → cash object'), controlTotal: L('Сумма рекомендованных загрузок', 'Tavsiya etilgan yuklashlar summasi', 'Sum of recommended loads'), mandatory: false },
  { id: 'DS-SD', system: 'servicedesk', integration: { systemId: 'cashsys', operation: 'ndo.dataset' }, name: L('Инциденты и простои устройств (Service Desk)', 'Qurilmalar insidentlari va to‘xtab qolishlari (Service Desk)', 'Device incidents and downtime (Service Desk)'), owner: L('ИТ / Service Desk', 'AT / Service Desk', 'IT / Service Desk'), periodicity: 'monthly', granularity: L('устройство × инцидент', 'qurilma × insident', 'device × incident'), businessKeys: ['ticket'], transform: L('Код оборудования → объект НДО', 'Uskuna kodi → NPA obyekti', 'Equipment code → cash object'), controlTotal: L('Часы простоя', "To'xtab qolish soatlari", 'Downtime hours'), mandatory: true },
  { id: 'DS-HR', system: 'laborlaw', integration: { systemId: 'laborlaw', operation: 'ndo.fte' }, name: L('Численность персонала НДО (Laborlaw)', 'NPA xodimlari soni (Laborlaw)', 'Cash staff headcount (Laborlaw)'), owner: L('Департамент персонала', 'Xodimlar departamenti', 'HR Department'), periodicity: 'monthly', granularity: L('объект × FTE', 'obyekt × FTE', 'object × FTE'), businessKeys: ['period', 'object'], transform: L('Штатная единица → МВЗ → объект НДО', 'Shtat birligi → XJM → NPA obyekti', 'Position → cost centre → cash object'), controlTotal: L('Сумма FTE', 'FTE yig‘indisi', 'Total FTE'), mandatory: true },
  { id: 'DS-FTP', system: 'erp_ftp', name: L('Ставки FTP по валютам (модуль 4.2.15)', "Valyutalar bo'yicha FTP stavkalari (4.2.15 moduli)", 'FTP rates by currency (module 4.2.15)'), owner: L('Казначейство', "G'aznachilik", 'Treasury'), periodicity: 'monthly', granularity: L('валюта × срок', 'valyuta × muddat', 'currency × tenor'), businessKeys: ['period', 'currency'], transform: L('Кривая FTP → ставка на срок хранения', 'FTP egri chizig‘i → saqlash muddati stavkasi', 'FTP curve → rate at storage tenor'), controlTotal: L('Количество точек кривой', 'Egri chiziq nuqtalari soni', 'Curve points'), mandatory: true },
  { id: 'DS-ALLOC', system: 'erp_alloc', name: L('Доля общебанковских расходов на НДО (модуль 4.2.14)', "NPA ga umumbank xarajatlari ulushi (4.2.14 moduli)", 'Bank-wide overhead share for cash (module 4.2.14)'), owner: L('Финансовый департамент', 'Moliya departamenti', 'Finance Department'), periodicity: 'monthly', granularity: L('пул → направление НДО', "pul → NPA yo'nalishi", 'pool → cash function'), businessKeys: ['period', 'pool'], transform: L('Результат аллокации 4.2.14 → пул EXP-HO', '4.2.14 taqsimot natijasi → EXP-HO puli', 'Allocation 4.2.14 result → EXP-HO pool'), controlTotal: L('Сумма распределённой доли', 'Taqsimlangan ulush summasi', 'Allocated share total'), mandatory: true },
];

export const ndoRulesSeed: NdoRule[] = [
  { id: 'nr1', code: 'R-EKC-PROC', name: L('Расходы ЕКЦ → кассы по обработанной наличности', 'YKM xarajatlari → kassalarga ishlov berilgan naqd pul bo‘yicha', 'Cash-centre costs → branch cash by processed volume'), step: 'ndo_internal', pool: 'POOL-EKC', receiverTypes: ['cbu', 'cash_desk', 'mobile_desk', 'exchange'], driver: 'volume', formula: L('доля_i = объём_i / Σ объём', 'ulush_i = hajm_i / Σ hajm', 'share_i = volume_i / Σ volume'), validFrom: '2026-01-01', status: 'active', version: 1, createdBy: 'u8', approvedBy: 'u4' },
  { id: 'nr2', code: 'R-CIT', name: L('Инкассация → объекты по количеству инкассаций', 'Inkassatsiya → obyektlarga inkassatsiyalar soni bo‘yicha', 'CIT → objects by number of collections'), step: 'ndo_internal', pool: 'POOL-CIT', receiverTypes: ['cbu', 'cash_desk', 'atm', 'cash_in', 'recycler', 'exchange'], driver: 'collections', formula: L('доля_i = инкассации_i / Σ инкассаций', 'ulush_i = inkassatsiya_i / Σ inkassatsiya', 'share_i = collections_i / Σ collections'), validFrom: '2026-01-01', status: 'active', version: 1, createdBy: 'u8', approvedBy: 'u4' },
  { id: 'nr3', code: 'R-ADM', name: L('Управление НДО и охрана → объекты по FTE', 'NPA boshqaruvi va qo‘riqlash → obyektlarga FTE bo‘yicha', 'Cash management and security → objects by FTE'), step: 'ndo_internal', pool: 'POOL-ADM', receiverTypes: ['cbu', 'cash_desk', 'mobile_desk', 'exchange', 'ekc'], driver: 'fte', formula: L('доля_i = FTE_i / Σ FTE', 'ulush_i = FTE_i / Σ FTE', 'share_i = FTE_i / Σ FTE'), validFrom: '2026-01-01', status: 'active', version: 1, createdBy: 'u8', approvedBy: 'u4' },
  { id: 'nr4', code: 'R-HO', name: L('Доля общебанковских расходов → конечные объекты по объёму', 'Umumbank xarajatlari ulushi → yakuniy obyektlarga hajm bo‘yicha', 'Bank-wide overhead → final objects by volume'), step: 'bank_share', pool: 'POOL-HO', receiverTypes: ['cbu', 'cash_desk', 'mobile_desk', 'exchange'], driver: 'volume', formula: L('доля_i = объём_i / Σ объём', 'ulush_i = hajm_i / Σ hajm', 'share_i = volume_i / Σ volume'), validFrom: '2026-01-01', status: 'active', version: 1, createdBy: 'u8', approvedBy: 'u4' },
  { id: 'nr5', code: 'R-DEV-CBU', name: L('Расходы ЕКЦ по устройствам → устройства по операциям', 'Qurilmalar bo‘yicha YKM xarajatlari → operatsiyalar bo‘yicha', 'Cash-centre device costs → devices by transactions'), step: 'final', pool: 'POOL-DEV', receiverTypes: ['atm', 'cash_in', 'recycler'], driver: 'transactions', formula: L('доля_i = операции_i / Σ операций', 'ulush_i = operatsiya_i / Σ operatsiya', 'share_i = transactions_i / Σ transactions'), validFrom: '2026-01-01', status: 'active', version: 1, createdBy: 'u8', approvedBy: 'u4' },
];

export const ndoTariffsSeed: NdoTariff[] = [
  { code: 'T-CIT', name: L('Инкассация выручки клиента (выезд)', 'Mijoz tushumini inkassatsiya qilish (chiqish)', 'Client CIT (per visit)'), unit: L('за выезд', 'chiqish uchun', 'per visit'), driver: 'collections', currentTariff: 1_250_000, plannedVolume: 7_400, benefitPct: 0, vatApplies: true },
  { code: 'T-CNT', name: L('Пересчёт наличных (за 1 млн)', 'Naqd pulni sanash (1 mln uchun)', 'Cash counting (per 1 mln)'), unit: L('за 1 млн', '1 mln uchun', 'per 1 mln'), driver: 'volume', currentTariff: 1_450, plannedVolume: 6_300_000, benefitPct: 10, vatApplies: false },
  { code: 'T-ATM', name: L('Снятие в банкомате чужой карты', 'Begona karta bilan bankomatdan yechish', 'ATM withdrawal (other bank card)'), unit: L('за операцию', 'operatsiya uchun', 'per transaction'), driver: 'transactions', currentTariff: 4_000, plannedVolume: 310_000, benefitPct: 0, vatApplies: false },
];

export const ndoParamsSeed: NdoParams = {
  methodology: 'NDO-M-2026.1',
  storageDays: 3,
  necessaryFactor: 1.25,
  targetMargin: 20,
  vatRate: 12,
  excessThresholdPct: 50,
  costPerMlnThreshold: 7_000,
  glTolerance: 5_000_000,
  roles: { input: ['cash_operator', 'treasury'], calc: ['treasury'], check: ['accountant', 'finance'], approve: ['finance'] },
};

/** Детерминированный псевдослучайный множитель (0.85…1.15) по строке. */
export function ndoNoise(s: string, spread = 0.15): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return 1 + (((h >>> 0) % 10_000) / 10_000 - 0.5) * 2 * spread;
}
