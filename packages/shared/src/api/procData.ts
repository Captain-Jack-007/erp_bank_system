// P2-PROC: демо-данные расширенных закупок, договоров и заявок на обеспечение. Все названия и реквизиты вымышлены.
import type {
  ContractAccount, ContractKindSetting, ContractTemplate, PlatformContract, ProcAcceptance, ProcBusinessGroup, ProcCatalogItem,
  ProcClaim, ProcConsolidation, ProcWorkAct, SupplierListEntry,
} from './procTypes';

const L = (ru: string, uz: string, en: string) => ({ ru, uz, en });

/** Номенклатурный справочник закупок (PR-PROC-003). */
export const procCatalogSeed: ProcCatalogItem[] = [
  { id: 'nc1', code: 'IT-HW-001', name: L('Ноутбук 14", Core i7, 16 ГБ, SSD 512 ГБ', 'Noutbuk 14", Core i7, 16 GB, SSD 512 GB', 'Laptop 14", Core i7, 16 GB, 512 GB SSD'), kind: 'goods', category: 'it_hw', unit: 'шт', refPrice: 14_200_000, spec: 'CPU не ниже Core i7 13-го поколения; ОЗУ 16 ГБ; SSD 512 ГБ; гарантия 3 года', budgetLineId: 'b1', origin: 'import', fixedAsset: true, active: true },
  { id: 'nc2', code: 'IT-HW-002', name: L('Док-станция USB-C', 'USB-C dok-stansiya', 'USB-C docking station'), kind: 'goods', category: 'it_hw', unit: 'шт', refPrice: 1_850_000, spec: '2×HDMI, 3×USB-A, RJ-45, PD 90 Вт', budgetLineId: 'b1', origin: 'import', active: true },
  { id: 'nc3', code: 'IT-HW-010', name: L('Сервер 2U, 2×CPU, 512 ГБ RAM', 'Server 2U, 2×CPU, 512 GB RAM', 'Server 2U, 2×CPU, 512 GB RAM'), kind: 'goods', category: 'it_hw', unit: 'шт', refPrice: 280_000_000, spec: '2× Xeon Gold, 512 ГБ RAM, 8× SSD 3,84 ТБ, 2 БП, монтаж в стойку', budgetLineId: 'b1', origin: 'import', install: true, fixedAsset: true, active: true },
  { id: 'nc4', code: 'IT-HW-020', name: L('Платёжный терминал самообслуживания', "O'z-o'ziga xizmat ko'rsatish to'lov terminali", 'Self-service payment terminal'), kind: 'goods', category: 'it_hw', unit: 'шт', refPrice: 61_000_000, spec: 'Купюроприёмник, чековый принтер, сенсорный экран 19"', budgetLineId: 'b1', origin: 'import', install: true, fixedAsset: true, active: true },
  { id: 'nc5', code: 'IT-HW-030', name: L('Картридж лазерный (чёрный)', 'Lazer kartrij (qora)', 'Laser cartridge (black)'), kind: 'goods', category: 'it_hw', unit: 'шт', refPrice: 640_000, warehouseSku: 'IT-0102', budgetLineId: 'b1', origin: 'import', active: true },
  { id: 'nc6', code: 'IT-HW-031', name: L('Клавиатура + мышь, комплект', "Klaviatura + sichqoncha, to'plam", 'Keyboard + mouse set'), kind: 'goods', category: 'it_hw', unit: 'компл', refPrice: 190_000, warehouseSku: 'IT-0130', budgetLineId: 'b1', origin: 'local', active: true },
  { id: 'nc7', code: 'SW-001', name: L('Лицензия антивирусной защиты, 1 год', 'Antivirus litsenziyasi, 1 yil', 'Antivirus licence, 1 year'), kind: 'goods', category: 'software', unit: 'лиц', refPrice: 300_000, budgetLineId: 'b2', origin: 'import', license: true, active: true },
  { id: 'nc8', code: 'SW-010', name: L('Разработка программного обеспечения (человеко-день)', "Dasturiy ta'minot ishlab chiqish (kishi-kun)", 'Software development (man-day)'), kind: 'services', category: 'software', unit: 'чел.-дн', refPrice: 2_400_000, budgetLineId: 'b2', origin: 'local', active: true },
  { id: 'nc9', code: 'OF-001', name: L('Бумага A4, 80 г/м², пачка 500 л.', "A4 qog'oz, 80 g/m², 500 varaq", 'A4 paper, 80 g/m², 500 sheets'), kind: 'goods', category: 'office', unit: 'пач', refPrice: 52_000, warehouseSku: 'OF-0001', budgetLineId: 'b3', origin: 'local', active: true },
  { id: 'nc10', code: 'OF-002', name: L('Папка-регистратор 75 мм', 'Registrator papka 75 mm', 'Lever arch file 75 mm'), kind: 'goods', category: 'office', unit: 'шт', refPrice: 21_000, warehouseSku: 'OF-0014', budgetLineId: 'b3', origin: 'local', active: true },
  { id: 'nc11', code: 'FU-001', name: L('Стол рабочий 1400×700', 'Ish stoli 1400×700', 'Office desk 1400×700'), kind: 'goods', category: 'furniture', unit: 'шт', refPrice: 2_350_000, spec: 'ЛДСП 25 мм, кромка ПВХ 2 мм', warehouseSku: 'MB-0001', budgetLineId: 'b3', origin: 'local', active: true },
  { id: 'nc12', code: 'FU-002', name: L('Кресло офисное', 'Ofis kreslosi', 'Office chair'), kind: 'goods', category: 'furniture', unit: 'шт', refPrice: 1_700_000, spec: 'Сетчатая спинка, подлокотники, газлифт 4 класса', warehouseSku: 'MB-0002', budgetLineId: 'b3', origin: 'local', active: true },
  { id: 'nc13', code: 'HH-001', name: L('Средство для уборки, 5 л', 'Tozalash vositasi, 5 l', 'Cleaning agent, 5 l'), kind: 'goods', category: 'household', unit: 'шт', refPrice: 75_000, warehouseSku: 'HH-0021', budgetLineId: 'b3', origin: 'local', active: true },
  { id: 'nc14', code: 'SC-001', name: L('Сумка инкассаторская', 'Inkassator sumkasi', 'Cash-in-transit bag'), kind: 'goods', category: 'security', unit: 'шт', refPrice: 400_000, warehouseSku: 'SC-0011', budgetLineId: 'b3', origin: 'local', active: true },
  { id: 'nc15', code: 'AU-001', name: L('Шина зимняя R16', 'Qishki shina R16', 'Winter tyre R16'), kind: 'goods', category: 'vehicles', unit: 'шт', refPrice: 1_100_000, budgetLineId: 'b4', origin: 'import', active: true },
  { id: 'nc16', code: 'CN-001', name: L('Текущий ремонт помещений (м²)', "Binolarni joriy ta'mirlash (m²)", 'Routine premises repair (m²)'), kind: 'works', category: 'construction', unit: 'м²', refPrice: 450_000, budgetLineId: 'b3', origin: 'local', active: true },
  { id: 'nc17', code: 'SV-001', name: L('Техническое обслуживание оборудования (мес.)', "Uskunalarga texnik xizmat ko'rsatish (oy)", 'Equipment maintenance (month)'), kind: 'services', category: 'services', unit: 'мес', refPrice: 103_000_000, budgetLineId: 'b1', origin: 'local', active: true },
  { id: 'nc18', code: 'SV-002', name: L('Охрана объекта (мес.)', "Obyektni qo'riqlash (oy)", 'Site security (month)'), kind: 'services', category: 'security', unit: 'мес', refPrice: 18_000_000, budgetLineId: 'b3', origin: 'local', active: true },
];

/** Группы бизнес-плана (PR-PROC-007). */
export const procBusinessGroupsSeed: ProcBusinessGroup[] = [
  { id: 'bg1', code: 'BP-IT', name: L('Развитие ИТ-инфраструктуры', 'AT infratuzilmasini rivojlantirish', 'IT infrastructure development'), budgetLineIds: ['b1', 'b2'] },
  { id: 'bg2', code: 'BP-NET', name: L('Развитие сети ЦБУ', 'BXM tarmog‘ini rivojlantirish', 'Branch network development'), budgetLineIds: ['b1', 'b3'] },
  { id: 'bg3', code: 'BP-ADM', name: L('Административно-хозяйственное обеспечение', "Ma'muriy-xo'jalik ta'minoti", 'Administrative support'), budgetLineIds: ['b3', 'b4'] },
];

/** Внутренний «чёрный список», санкции, список сомнительных налогоплательщиков ГНК (локальные копии, демо). */
export const supplierListsSeed: SupplierListEntry[] = [
  { tin: '900000001', name: 'Global Secure Systems LLC', list: 'sanctions', reason: 'Санкционный список (демо): ограничения на поставки оборудования безопасности', since: '2025-03-01' },
  { tin: '900000001', name: 'Global Secure Systems LLC', list: 'blacklist', reason: 'Срыв поставки по договору 2024 года, претензия не удовлетворена', since: '2025-01-15' },
  { tin: '404567890', name: 'YaTT Qodirov A.', list: 'suspicious_tax', reason: 'Включён ГНК в перечень налогоплательщиков с признаками сомнительных операций (демо)', since: '2026-08-01' },
  { tin: '309990001', name: 'MChJ «Tez Savdo Group»', list: 'blacklist', reason: 'Предоставление недостоверных документов при квалификационном отборе', since: '2026-02-10' },
];

/** План счетов (демо) для расчётов по договорам (PR-CON-034). 8-значные коды — формат пакета проводок iABS. */
export const contractAccountsSeed: ContractAccount[] = [
  { code: '10501000', name: L('Корреспондентский счёт банка (расчёты)', 'Bankning vakillik hisobvarag‘i', 'Bank correspondent account'), type: 'cash' },
  { code: '19909000', name: L('Авансы, выданные поставщикам (дебиторская задолженность)', 'Yetkazib beruvchilarga berilgan avanslar (debitorlik)', 'Advances to suppliers (receivables)'), type: 'receivable' },
  { code: '19905000', name: L('Дебиторы по реализации услуг и имущества банка', "Bank xizmatlari va mol-mulkini sotish bo'yicha debitorlar", 'Receivables from bank services and property sales'), type: 'receivable' },
  { code: '29802000', name: L('Расчёты с поставщиками (кредиторская задолженность)', "Yetkazib beruvchilar bilan hisob-kitoblar (kreditorlik)", 'Payables to suppliers'), type: 'payable' },
  { code: '56802000', name: L('Хозяйственные расходы', "Xo'jalik xarajatlari", 'Administrative expenses'), type: 'expense' },
  { code: '56806000', name: L('Расходы на услуги и обслуживание', "Xizmatlar va texnik xizmat xarajatlari", 'Service and maintenance expenses'), type: 'expense' },
  { code: '56804000', name: L('Коммунальные расходы', 'Kommunal xarajatlar', 'Utility expenses'), type: 'expense' },
  { code: '56920000', name: L('Расходы по аренде', 'Ijara xarajatlari', 'Rent expenses'), type: 'expense' },
  { code: '16510000', name: L('Основные средства и капитальные вложения', 'Asosiy vositalar va kapital qo‘yilmalar', 'Fixed assets and capital investments'), type: 'asset' },
  { code: '16910000', name: L('ТМЗ и МБП на складе', "Ombordagi TMZ va kam baholi buyumlar", 'Inventory and low-value items'), type: 'asset' },
  { code: '16610000', name: L('Незавершённое строительство и капремонт', "Tugallanmagan qurilish va kapital ta'mir", 'Construction in progress'), type: 'asset' },
  { code: '45994000', name: L('Доходы от услуг и реализации имущества', "Xizmatlar va mol-mulk sotishdan daromadlar", 'Income from services and property sales'), type: 'income' },
  { code: '56990000', name: L('Расходы на создание резервов', 'Zaxiralar yaratish xarajatlari', 'Provisioning expenses'), type: 'expense' },
  { code: '19999000', name: L('Резерв на возможные убытки по дебиторской задолженности', "Debitorlik qarzlari bo'yicha zaxira", 'Allowance for receivable losses'), type: 'reserve' },
  { code: '90963000', name: L('Внебаланс: обязательства по заключённым договорам', "Balansdan tashqari: tuzilgan shartnomalar bo'yicha majburiyatlar", 'Off-balance: contract commitments'), type: 'offbalance' },
  { code: '96399000', name: L('Внебаланс: контрсчёт обязательств', 'Balansdan tashqari: kontrhisob', 'Off-balance: contra account'), type: 'offbalance' },
  { code: '95413000', name: L('Внебаланс: списанная безнадёжная задолженность', "Balansdan tashqari: hisobdan chiqarilgan umidsiz qarz", 'Off-balance: written-off bad debts'), type: 'offbalance' },
];

/** Настройки видов договоров: счета расчётов и условия оплаты по умолчанию (PR-CON-036). */
export const contractKindSettingsSeed: ContractKindSetting[] = [
  { kind: 'services', advanceAccount: '19909000', payableAccount: '29802000', expenseAccount: '56806000', defaultTerms: { type: 'advance', advancePct: 30 }, active: true },
  { kind: 'long_term', advanceAccount: '19909000', payableAccount: '29802000', expenseAccount: '56806000', defaultTerms: { type: 'periodic', periodicity: 'quarterly' }, active: true },
  { kind: 'fixed_assets', advanceAccount: '19909000', payableAccount: '29802000', expenseAccount: '16510000', defaultTerms: { type: 'advance', advancePct: 30 }, active: true },
  { kind: 'utilities', advanceAccount: '19909000', payableAccount: '29802000', expenseAccount: '56804000', defaultTerms: { type: 'by_invoice', periodicity: 'monthly' }, active: true },
  { kind: 'other_receivables', advanceAccount: '19909000', payableAccount: '29802000', expenseAccount: '56802000', defaultTerms: { type: 'full' }, active: true },
  { kind: 'rent', advanceAccount: '19909000', payableAccount: '29802000', expenseAccount: '56920000', defaultTerms: { type: 'periodic', periodicity: 'monthly' }, active: true },
  { kind: 'construction', advanceAccount: '19909000', payableAccount: '29802000', expenseAccount: '16610000', defaultTerms: { type: 'by_act', advancePct: 20 }, active: true },
  { kind: 'swift', advanceAccount: '19909000', payableAccount: '29802000', expenseAccount: '56806000', defaultTerms: { type: 'full' }, active: true },
  { kind: 'bank_services', advanceAccount: '19905000', payableAccount: '29802000', expenseAccount: '45994000', defaultTerms: { type: 'full' }, active: true },
];

const BODY_SUPPLY = `ДОГОВОР № {{number}}
г. Ташкент, {{date}}

АКБ «Народный банк» (демо), именуемый «Заказчик», в лице {{signer}}, и {{counterparty}} (ИНН {{tin}}), именуемый «{{role}}», в лице директора {{director}}, заключили настоящий договор о нижеследующем.

1. Предмет договора: {{subject}}.
2. Цена договора: {{amount}}. Порядок оплаты: {{terms}}.
3. Срок действия: с {{start}} по {{end}}.
4. Приёмка осуществляется по акту приёмки / акту выполненных работ, подписанному сторонами через E-IMZO.
5. За просрочку исполнения обязательств {{role}} уплачивает пеню {{penalty}} % в день от суммы просроченного обязательства, но не более {{cap}} % от цены договора.
6. Реквизиты {{role_gen}}: р/с {{account}} в {{bank}}, МФО {{mfo}}.`;

/** Шаблоны договоров (PR-CON-021). */
export const contractTemplatesSeed: ContractTemplate[] = [
  { id: 'tpl1', kind: 'services', name: L('Договор на оказание услуг', "Xizmat ko'rsatish shartnomasi", 'Service agreement'), body: BODY_SUPPLY, defaultTerms: { type: 'advance', advancePct: 30 }, penalty: { ratePerDay: 0.1, capPct: 10 } },
  { id: 'tpl2', kind: 'fixed_assets', name: L('Договор поставки ОС и МБП', 'AV va kam baholi buyumlar yetkazib berish shartnomasi', 'Supply agreement (fixed assets, low-value items)'), body: BODY_SUPPLY, defaultTerms: { type: 'advance', advancePct: 30 }, penalty: { ratePerDay: 0.1, capPct: 10 } },
  { id: 'tpl3', kind: 'long_term', name: L('Долгосрочный договор обслуживания', "Uzoq muddatli xizmat ko'rsatish shartnomasi", 'Long-term maintenance agreement'), body: BODY_SUPPLY, defaultTerms: { type: 'periodic', periodicity: 'quarterly' }, penalty: { ratePerDay: 0.05, capPct: 5 } },
  { id: 'tpl4', kind: 'rent', name: L('Договор аренды нежилого помещения', 'Noturar joy ijarasi shartnomasi', 'Commercial lease agreement'), body: BODY_SUPPLY, defaultTerms: { type: 'periodic', periodicity: 'monthly' }, penalty: { ratePerDay: 0.05, capPct: 5 } },
  { id: 'tpl5', kind: 'construction', name: L('Договор подряда на ремонт', "Ta'mirlash pudrat shartnomasi", 'Repair works contract'), body: BODY_SUPPLY, defaultTerms: { type: 'by_act', advancePct: 20 }, penalty: { ratePerDay: 0.1, capPct: 15 } },
  { id: 'tpl6', kind: 'bank_services', name: L('Договор реализации имущества банка', "Bank mol-mulkini sotish shartnomasi", 'Bank property sale agreement'), body: BODY_SUPPLY, defaultTerms: { type: 'full' }, penalty: { ratePerDay: 0.1, capPct: 10 } },
];

/** Региональная сводная заявка (ЦБУ Самаркандского филиала) — отправлена в центральный аппарат. */
export const procConsolidationsSeed: ProcConsolidation[] = [
  {
    id: 'cs1', number: 'SV-2026-0014', level: 'region', regionKey: 'R09', title: 'Сводная заявка Самаркандского филиала: оргтехника для ЦБУ', requestIds: ['pr8'], status: 'sent',
    createdBy: 'u21', createdAt: '2026-10-15T08:00:00Z',
    history: [
      { at: '2026-10-15T08:00:00Z', userId: 'u21', action: 'created' },
      { at: '2026-10-15T08:05:00Z', userId: 'u21', action: 'submitted', comment: 'Направлено в центральный аппарат' },
    ],
  },
];

/** Приёмка по договору k1 (мебель): частичная поставка с расхождением. */
export const procAcceptancesSeed: ProcAcceptance[] = [
  {
    id: 'ac1', number: 'AP-2026-0031', contractId: 'k1', requestId: 'pr3', date: '2026-10-12', warehouseId: 'wh2', status: 'received', costCenterKey: 'CC0008',
    lines: [
      { name: 'Стол рабочий 1400×700', catalogId: 'nc11', unit: 'шт', orderedQty: 30, deliveredQty: 30, acceptedQty: 30, unitPrice: 2_150_000, specOk: true, quality: 'ok' },
      { name: 'Кресло офисное', catalogId: 'nc12', unit: 'шт', orderedQty: 30, deliveredQty: 30, acceptedQty: 28, unitPrice: 1_620_000, specOk: true, quality: 'defect', note: '2 кресла с повреждённой обивкой' },
    ],
    acceptedBy: 'u14', acceptedAt: '2026-10-12T11:30:00Z', claimIds: ['cl1'], createdBy: 'u14', createdAt: '2026-10-12T09:00:00Z',
    history: [
      { at: '2026-10-12T09:00:00Z', userId: 'u14', action: 'created' },
      { at: '2026-10-12T11:30:00Z', userId: 'u14', action: 'approved', comment: 'Принял' },
    ],
  },
];

export const procClaimsSeed: ProcClaim[] = [
  {
    id: 'cl1', number: 'PT-2026-0009', counterpartyId: 'c3', contractId: 'k1', acceptanceId: 'ac1', type: 'quality', description: 'Поставлены 2 кресла с повреждённой обивкой. Требуем замены в течение 10 дней.', amount: 3_240_000,
    dueDate: '2026-10-22', status: 'sent', createdBy: 'u3', createdAt: '2026-10-12T12:00:00Z',
    history: [
      { at: '2026-10-12T12:00:00Z', userId: 'u3', action: 'created' },
      { at: '2026-10-12T12:10:00Z', userId: 'u3', action: 'submitted', comment: 'Направлена поставщику' },
    ],
  },
];

/** Акт выполненных работ по договору k2 (обслуживание серверов) за 3 квартал. */
export const procWorkActsSeed: ProcWorkAct[] = [
  {
    id: 'wa1', number: 'AV-2026-0052', contractId: 'k2', periodFrom: '2026-07-01', periodTo: '2026-09-30', description: 'Техническое обслуживание серверного оборудования за 3 квартал 2026 года',
    lines: [
      { description: 'Плановое ТО серверов (ежемесячно)', unit: 'мес', qty: 3, unitPrice: 76_000_000 },
      { description: 'Аварийные выезды', unit: 'выезд', qty: 4, unitPrice: 20_000_000 },
    ],
    vatRate: 12, costCenterKey: 'CC0005', status: 'completed', einvoiceId: 'ei12',
    contractorSigned: { at: '2026-10-03T10:00:00Z', name: 'OOO «Alfa Texnika Servis»', extId: 'DX-77120' },
    quality: { score: 5, comment: 'Работы выполнены в срок, замечаний нет', by: 'u2', at: '2026-10-04T09:00:00Z' },
    defects: [], createdBy: 'u1', createdAt: '2026-10-01T09:00:00Z',
    history: [
      { at: '2026-10-01T09:00:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-01T09:30:00Z', userId: 'u1', action: 'submitted' },
      { at: '2026-10-02T10:00:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-10-02T15:00:00Z', userId: 'u7', action: 'approved' },
    ],
  },
];

/** Входящие электронные договоры с платформ Soliqservis (Didox, Factura.uz). */
export const platformContractsSeed: PlatformContract[] = [
  { id: 'pc1', platform: 'didox', extId: 'DX-2026-118734', direction: 'in', number: 'D-41/2026', date: '2026-10-16', counterpartyTin: '302345678', counterpartyName: 'OOO «Raqamli Yechimlar»', subject: 'Сопровождение системы электронного документооборота на 2026–2027 гг.', amount: 456_000_000, status: 'incoming', receivedAt: '2026-10-16T12:00:00Z' },
  { id: 'pc2', platform: 'factura', extId: 'FU-552901', direction: 'in', number: 'F-1180', date: '2026-10-17', counterpartyTin: '305678901', counterpartyName: 'OOO «Avto Park Lizing»', subject: 'Техническое обслуживание служебных автомобилей', amount: 64_800_000, status: 'incoming', receivedAt: '2026-10-17T09:40:00Z' },
];
