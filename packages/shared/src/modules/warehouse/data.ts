// Демо-данные модуля «Склад» и «Учёт МБП» (вымышленные).
import type { ApprovalTask, Localized } from '../../types';
import type {
  MbpRecord, WarehouseBatch, WarehouseCard, WarehouseGroup, WarehouseInventory, WarehouseIssue, WarehouseItem, WarehouseLocation, WarehouseMovement, WarehouseReceipt, WarehouseWriteoff,
} from './types';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

export const warehouseLocationsSeed: WarehouseLocation[] = [
  { id: 'wh1', code: 'TSH-C', name: 'Центральный склад', city: 'Toshkent', kind: 'central', managerId: 'u14', headId: 'u6', orgUnitKey: 'd2', costCenterId: 'CC0007' },
  { id: 'wh2', code: 'SAM-R', name: 'Региональный склад Самарканд', city: 'Samarqand', kind: 'regional', managerId: 'u14', headId: 'u21', orgUnitKey: 'R09', costCenterId: 'CC0188' },
  { id: 'wh3', code: 'FER-R', name: 'Региональный склад Фергана', city: "Farg'ona", kind: 'regional', managerId: 'u14', headId: 'u6', orgUnitKey: 'R12', costCenterId: 'CC0241' },
];

export const warehouseGroupsSeed: WarehouseGroup[] = [
  { id: 'g-of', code: 'OF', name: L('Канцелярские товары', 'Kantselyariya tovarlari', 'Office supplies'), kind: 'tmz', category: 'office', account: '19909000', expenseAccount: '56802000' },
  { id: 'g-it', code: 'IT', name: L('Расходные материалы ИТ', 'AT sarf materiallari', 'IT consumables'), kind: 'tmz', category: 'it', account: '19913000', expenseAccount: '56804000' },
  { id: 'g-fm', code: 'FM', name: L('Бланки строгой отчётности', 'Qat’iy hisobdagi blankalar', 'Controlled forms'), kind: 'tmz', category: 'forms', account: '19911000', offBalanceAccount: '96339000', expenseAccount: '56806000' },
  { id: 'g-hh', code: 'HH', name: L('Хозяйственные товары', 'Xo‘jalik tovarlari', 'Household supplies'), kind: 'tmz', category: 'household', account: '19909000', expenseAccount: '56802000' },
  { id: 'g-sc', code: 'SC', name: L('Средства безопасности и инкассации', 'Xavfsizlik va inkassatsiya vositalari', 'Security and cash-in-transit'), kind: 'tmz', category: 'security', account: '19915000', expenseAccount: '56802000' },
  { id: 'g-mb', code: 'MB', name: L('МБП (мебель, инвентарь)', 'MBP (mebel, inventar)', 'Low-value items (furniture, tools)'), kind: 'mbp', category: 'mbp', account: '19917000', offBalanceAccount: '96335000', expenseAccount: '56812000' },
  { id: 'g-os', code: 'OS', name: L('ОС к вводу в эксплуатацию', 'Foydalanishga beriladigan AV', 'Fixed assets to commission'), kind: 'fa', category: 'fixed', account: '19907000', expenseAccount: '19907000' },
];

/** EAN-13 с контрольной цифрой (внутренний диапазон 200…). */
export function ean13(body12: string): string {
  const d = body12.padStart(12, '0').slice(0, 12);
  const sum = d.split('').reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return d + String((10 - (sum % 10)) % 10);
}

interface CardSpec {
  id: string;
  no: string;
  name: string;
  group: string;
  unit: string;
  price: number;
  expiry?: number;
  parent?: string;
  status?: WarehouseCard['status'];
  offBalance?: boolean;
}
const CARDS: CardSpec[] = [
  { id: 'wc1', no: 'OF-0001', name: 'Бумага A4, 80 г/м², пачка 500 л.', group: 'g-of', unit: 'пач', price: 52_000 },
  { id: 'wc2', no: 'OF-0014', name: 'Папка-регистратор 75 мм', group: 'g-of', unit: 'шт', price: 21_000 },
  { id: 'wc3', no: 'IT-0102', name: 'Картридж лазерный (чёрный)', group: 'g-it', unit: 'шт', price: 640_000, expiry: 1095 },
  { id: 'wc4', no: 'IT-0130', name: 'Клавиатура + мышь, комплект', group: 'g-it', unit: 'компл', price: 190_000 },
  { id: 'wc5', no: 'FM-0007', name: 'Бланк кассового ордера', group: 'g-fm', unit: 'пач', price: 38_000, offBalance: true, status: 'control' },
  { id: 'wc6', no: 'SC-0003', name: 'Пломба номерная для инкассаторских сумок', group: 'g-sc', unit: 'шт', price: 2_400 },
  { id: 'wc7', no: 'HH-0021', name: 'Средство для уборки, 5 л', group: 'g-hh', unit: 'шт', price: 75_000, expiry: 730 },
  { id: 'wc8', no: 'SC-0011', name: 'Сумка инкассаторская', group: 'g-sc', unit: 'шт', price: 410_000 },
  { id: 'wc9', no: 'MB-0001', name: 'Стол рабочий 1400×700', group: 'g-mb', unit: 'шт', price: 2_142_857 },
  { id: 'wc10', no: 'MB-0002', name: 'Кресло офисное', group: 'g-mb', unit: 'шт', price: 1_562_500 },
  { id: 'wc11', no: 'MB-0005', name: 'Шкаф для документов', group: 'g-mb', unit: 'шт', price: 2_900_000 },
  { id: 'wc12', no: 'OS-0001', name: 'Ноутбук 14", Core i5, 16 ГБ', group: 'g-os', unit: 'шт', price: 11_400_000 },
  { id: 'wc13', no: 'OF-0002', name: 'Бумага A4 «Премиум», 80 г/м², пачка 500 л.', group: 'g-of', unit: 'пач', price: 61_000, parent: 'wc1' },
  { id: 'wc14', no: 'HH-0030', name: 'Антисептик для рук, 1 л', group: 'g-hh', unit: 'шт', price: 48_000, expiry: 365 },
  { id: 'wc15', no: 'OS-0002', name: 'POS-терминал PAX A930', group: 'g-os', unit: 'шт', price: 4_800_000 },
  { id: 'wc16', no: 'OF-0040', name: 'Скобы для степлера №24/6 (снято с производства)', group: 'g-of', unit: 'кор', price: 6_000, status: 'archived' },
];

export const warehouseCardsSeed: WarehouseCard[] = CARDS.map((c, i) => ({
  id: c.id,
  cardNo: c.no,
  name: c.name,
  groupId: c.group,
  unit: c.unit,
  barcode: ean13(`2000000${String(i + 1).padStart(5, '0')}`),
  ...(c.parent ? { parentId: c.parent } : {}),
  status: c.status ?? 'active',
  offBalance: !!c.offBalance,
  trackExpiry: !!c.expiry,
  ...(c.expiry ? { shelfLifeDays: c.expiry } : {}),
  defaultPrice: c.price,
  version: 1,
  createdAt: '2025-01-10T09:00:00Z',
  createdBy: 'u14',
  updatedAt: '2025-01-10T09:00:00Z',
  ...(c.status === 'archived' ? { archivedAt: '2026-06-30T09:00:00Z' } : {}),
}));

interface ItemSpec {
  id: string;
  card: string;
  wh: string;
  min: number;
  limit?: number;
  /** Партии: [дата прихода, количество, цена, срок годности?] */
  batches: [string, number, number, string?][];
  reserved?: number;
}
const ITEMS: ItemSpec[] = [
  { id: 'wi1', card: 'wc1', wh: 'wh1', min: 400, limit: 600, batches: [['2025-03-12', 640, 50_000], ['2026-10-02', 600, 54_000]] },
  { id: 'wi2', card: 'wc2', wh: 'wh1', min: 200, batches: [['2026-05-20', 180, 21_000]] },
  { id: 'wi3', card: 'wc3', wh: 'wh1', min: 60, batches: [['2024-02-15', 6, 600_000, '2026-11-05'], ['2026-04-10', 40, 646_000, '2029-04-10']] },
  { id: 'wi4', card: 'wc4', wh: 'wh1', min: 30, batches: [['2026-02-01', 85, 190_000]] },
  { id: 'wi5', card: 'wc5', wh: 'wh1', min: 150, batches: [['2026-01-15', 320, 38_000]] },
  { id: 'wi6', card: 'wc6', wh: 'wh1', min: 3000, limit: 3500, batches: [['2026-03-01', 5200, 2_400]] },
  { id: 'wi7', card: 'wc7', wh: 'wh2', min: 40, batches: [['2024-09-01', 10, 70_000, '2026-09-01'], ['2026-06-15', 24, 77_000, '2028-06-15']] },
  { id: 'wi8', card: 'wc1', wh: 'wh2', min: 150, batches: [['2026-10-09', 260, 52_000]] },
  { id: 'wi9', card: 'wc8', wh: 'wh3', min: 20, batches: [['2023-11-20', 12, 410_000]] },
  { id: 'wi10', card: 'wc5', wh: 'wh3', min: 60, batches: [['2026-02-10', 95, 38_000]] },
  { id: 'wi11', card: 'wc9', wh: 'wh1', min: 4, batches: [['2026-08-05', 12, 2_142_857]] },
  { id: 'wi12', card: 'wc10', wh: 'wh1', min: 5, batches: [['2026-08-05', 20, 1_562_500]], reserved: 2 },
  { id: 'wi13', card: 'wc12', wh: 'wh1', min: 2, batches: [['2026-09-18', 6, 11_400_000]] },
  { id: 'wi14', card: 'wc13', wh: 'wh1', min: 50, batches: [['2026-07-01', 100, 61_000]] },
  { id: 'wi15', card: 'wc14', wh: 'wh2', min: 10, batches: [['2025-11-01', 40, 48_000, '2026-11-01']] },
  { id: 'wi16', card: 'wc15', wh: 'wh1', min: 2, batches: [['2026-10-01', 5, 4_800_000]] },
  { id: 'wi17', card: 'wc11', wh: 'wh2', min: 1, batches: [['2026-03-03', 4, 2_900_000]] },
];

const cardOf = (id: string) => warehouseCardsSeed.find((c) => c.id === id)!;
const groupOf = (id: string) => warehouseGroupsSeed.find((g) => g.id === id)!;

export const warehouseBatchesSeed: WarehouseBatch[] = ITEMS.flatMap((it) =>
  it.batches.map(([at, qty, cost, exp], i) => ({
    id: `wb-${it.id}-${i + 1}`,
    itemId: it.id,
    batchNo: `P-${at.replace(/-/g, '').slice(2)}-${it.id.slice(2).padStart(2, '0')}`,
    receivedAt: at,
    qtyIn: qty,
    qtyLeft: qty,
    unitCost: cost,
    ...(exp ? { expiryDate: exp } : {}),
  })),
);

export const warehouseItemsSeed: WarehouseItem[] = ITEMS.map((it) => {
  const c = cardOf(it.card);
  const qty = it.batches.reduce((s, b) => s + b[1], 0);
  const value = it.batches.reduce((s, b) => s + b[1] * b[2], 0);
  return {
    id: it.id,
    cardId: c.id,
    warehouseId: it.wh,
    qty,
    reserved: it.reserved ?? 0,
    minQty: it.min,
    ...(it.limit ? { limitQty: it.limit } : {}),
    unitCost: qty ? Math.round(value / qty) : c.defaultPrice,
    sku: c.cardNo,
    name: c.name,
    category: groupOf(c.groupId).category,
    unit: c.unit,
  };
});

export const warehouseMovementsSeed: WarehouseMovement[] = [
  { id: 'wm1', number: 'SK-2026-1180', type: 'receipt', itemId: 'wi1', qty: 600, warehouseId: 'wh1', counterpartyId: 'c3', userId: 'u14', at: '2026-10-02T09:15:00Z', comment: 'По договору DG-2026-0311', amount: 32_400_000, costCenterId: 'CC0007', docType: 'receipt', docId: 'rc1', docNumber: 'PO-2026-0412' },
  { id: 'wm2', number: 'SK-2026-1186', type: 'issue', itemId: 'wi3', qty: 24, warehouseId: 'wh1', departmentId: 'd1', userId: 'u14', at: '2026-10-07T11:40:00Z', amount: 15_120_000, costCenterId: 'CC0002', docType: 'issue', docId: 'is1', docNumber: 'ZV-2026-0101' },
  { id: 'wm3', number: 'SK-2026-1191', type: 'transfer', itemId: 'wi1', qty: 200, warehouseId: 'wh1', toWarehouseId: 'wh2', userId: 'u14', at: '2026-10-09T08:05:00Z', amount: 10_400_000, costCenterId: 'CC0188' },
  { id: 'wm4', number: 'SK-2026-1197', type: 'issue', itemId: 'wi5', qty: 40, warehouseId: 'wh1', departmentId: 'd9', userId: 'u14', at: '2026-10-12T14:20:00Z', amount: 1_520_000, costCenterId: 'CC0044', comment: 'Разнарядка РН-2026-014', docType: 'issue', docId: 'is4', docNumber: 'ZV-2026-0106' },
  { id: 'wm5', number: 'SK-2026-1203', type: 'writeoff', itemId: 'wi7', qty: 6, warehouseId: 'wh2', userId: 'u14', at: '2026-10-14T10:00:00Z', comment: 'Повреждение тары при доставке', amount: 420_000, costCenterId: 'CC0188', docType: 'writeoff', docId: 'wa1', docNumber: 'AS-2026-0031' },
  { id: 'wm6', number: 'SK-2026-1210', type: 'issue', itemId: 'wi9', qty: 8, warehouseId: 'wh3', departmentId: 'd8', userId: 'u14', at: '2026-10-16T09:30:00Z', amount: 3_280_000, costCenterId: 'CC0025', comment: 'Разнарядка РН-2026-017', docType: 'issue', docId: 'is5', docNumber: 'ZV-2026-0109' },
];

export const warehouseReceiptsSeed: WarehouseReceipt[] = [
  {
    id: 'rc1', number: 'PO-2026-0412', date: '2026-10-02', warehouseId: 'wh1', supplierId: 'c3', contractId: 'k1', waybillNo: 'TN-58821', waybillDate: '2026-10-01', source: 'contract',
    lines: [{ cardId: 'wc1', qty: 600, price: 54_000 }], costCenterId: 'CC0007', status: 'posted', createdBy: 'u14', createdAt: '2026-10-02T09:00:00Z', postedAt: '2026-10-02T09:15:00Z', postingId: 'wp-seed-1',
    history: [{ at: '2026-10-02T09:00:00Z', userId: 'u14', action: 'created' }, { at: '2026-10-02T09:15:00Z', userId: 'u14', action: 'approved', comment: 'Проведено, М-4' }],
  },
  {
    id: 'rc2', number: 'PO-2026-0419', date: '2026-10-17', warehouseId: 'wh1', supplierId: 'c1', waybillNo: 'TN-60114', waybillDate: '2026-10-17', source: 'manual',
    lines: [{ cardId: 'wc4', qty: 20, price: 195_000 }, { cardId: 'wc3', qty: 10, price: 655_000, expiryDate: '2029-10-01' }], costCenterId: 'CC0007', status: 'draft', createdBy: 'u14', createdAt: '2026-10-17T12:00:00Z',
    history: [{ at: '2026-10-17T12:00:00Z', userId: 'u14', action: 'created' }],
  },
];

export const warehouseIssuesSeed: WarehouseIssue[] = [
  {
    id: 'is1', number: 'ZV-2026-0101', source: 'request', warehouseId: 'wh1', requesterId: 'u1', recipientId: 'u1', departmentId: 'd1', orgUnitKey: 'd1', costCenterId: 'CC0002', purpose: 'Картриджи для принтеров департамента ИТ',
    lines: [{ itemId: 'wi3', qty: 24, amount: 15_120_000 }], status: 'received', amount: 15_120_000, invoiceNo: 'VN-2026-0101',
    signatures: [], createdAt: '2026-10-05T08:00:00Z', submittedAt: '2026-10-05T08:05:00Z', issuedAt: '2026-10-07T11:40:00Z', receivedAt: '2026-10-07T12:10:00Z',
    history: [
      { at: '2026-10-05T08:00:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-05T08:05:00Z', userId: 'u1', action: 'submitted' },
      { at: '2026-10-05T10:00:00Z', userId: 'u2', action: 'approved' },
      { at: '2026-10-07T11:40:00Z', userId: 'u14', action: 'status_changed', comment: 'Выдано со склада (М-11)' },
      { at: '2026-10-07T12:10:00Z', userId: 'u1', action: 'status_changed', comment: '«Принял» — подписано E-IMZO' },
    ],
  },
  {
    id: 'is2', number: 'ZV-2026-0112', source: 'request', warehouseId: 'wh1', requesterId: 'u1', recipientId: 'u1', departmentId: 'd1', orgUnitKey: 'd1', costCenterId: 'CC0002', purpose: 'Рабочее место нового сотрудника',
    lines: [{ itemId: 'wi12', qty: 2 }, { itemId: 'wi4', qty: 2 }], status: 'pending', amount: 3_505_000,
    signatures: [], createdAt: '2026-10-17T09:00:00Z', submittedAt: '2026-10-17T09:05:00Z',
    history: [{ at: '2026-10-17T09:00:00Z', userId: 'u1', action: 'created' }, { at: '2026-10-17T09:05:00Z', userId: 'u1', action: 'submitted' }],
  },
  {
    id: 'is3', number: 'ZV-2026-0108', source: 'allotment', allotmentNo: 'РН-2026-016', warehouseId: 'wh1', requesterId: 'u14', recipientId: 'u12', departmentId: 'd9', orgUnitKey: 'R01-B01', costCenterId: 'CC0044', purpose: 'Пломбы для кассы ЦБУ «Юнусабад» по разнарядке',
    lines: [{ itemId: 'wi6', qty: 1500 }], status: 'approved', amount: 3_600_000,
    signatures: [], createdAt: '2026-10-16T07:30:00Z', submittedAt: '2026-10-16T07:30:00Z',
    history: [{ at: '2026-10-16T07:30:00Z', userId: 'u14', action: 'created', comment: 'Разнарядка РН-2026-016' }],
  },
  {
    id: 'is4', number: 'ZV-2026-0106', source: 'allotment', allotmentNo: 'РН-2026-014', warehouseId: 'wh1', requesterId: 'u14', recipientId: 'u12', departmentId: 'd9', orgUnitKey: 'R01-B01', costCenterId: 'CC0044', purpose: 'Бланки кассовых ордеров',
    lines: [{ itemId: 'wi5', qty: 40, amount: 1_520_000 }], status: 'received', amount: 1_520_000, invoiceNo: 'VN-2026-0106',
    signatures: [], createdAt: '2026-10-12T09:00:00Z', issuedAt: '2026-10-12T14:20:00Z', receivedAt: '2026-10-12T16:00:00Z',
    history: [{ at: '2026-10-12T09:00:00Z', userId: 'u14', action: 'created' }, { at: '2026-10-12T14:20:00Z', userId: 'u14', action: 'status_changed', comment: 'Выдано со склада (М-11)' }],
  },
  {
    id: 'is5', number: 'ZV-2026-0109', source: 'allotment', allotmentNo: 'РН-2026-017', warehouseId: 'wh3', requesterId: 'u14', recipientId: 'u8', departmentId: 'd8', orgUnitKey: 'd8', costCenterId: 'CC0025', purpose: 'Инкассаторские сумки',
    lines: [{ itemId: 'wi9', qty: 8, amount: 3_280_000 }], status: 'issued', amount: 3_280_000, invoiceNo: 'VN-2026-0109',
    signatures: [], createdAt: '2026-10-15T09:00:00Z', issuedAt: '2026-10-16T09:30:00Z',
    history: [{ at: '2026-10-15T09:00:00Z', userId: 'u14', action: 'created' }, { at: '2026-10-16T09:30:00Z', userId: 'u14', action: 'status_changed', comment: 'Выдано со склада (М-11)' }],
  },
];

export const warehouseIssueApprovalSeed: ApprovalTask[] = [
  { id: 'a_wi2', entity: 'warehouse_issue', entityId: 'is2', title: 'Выдача: Рабочее место нового сотрудника', number: 'ZV-2026-0112', amount: 3_505_000, requesterId: 'u1', assigneeRole: 'dept_head', step: 1, totalSteps: 1, createdAt: '2026-10-17T09:05:00Z', dueAt: '2026-10-19T09:05:00Z', status: 'pending' },
];

export const warehouseWriteoffsSeed: WarehouseWriteoff[] = [
  {
    id: 'wa1', number: 'AS-2026-0031', kind: 'tmz', date: '2026-10-14', warehouseId: 'wh2', reason: 'damage', reasonText: 'Повреждение тары при доставке', commission: { chairmanId: 'u21', memberIds: ['u14', 'u7'], orderNo: 'ПР-2026-118' },
    commissionSignatures: [], lines: [{ refId: 'wi7', qty: 6, amount: 420_000 }], amount: 420_000, costCenterId: 'CC0188', status: 'posted', postingId: 'wp-seed-3', createdBy: 'u14', createdAt: '2026-10-13T09:00:00Z',
    history: [{ at: '2026-10-13T09:00:00Z', userId: 'u14', action: 'created' }, { at: '2026-10-14T10:00:00Z', userId: 'u7', action: 'approved' }],
  },
  {
    id: 'wa2', number: 'AS-2026-0035', kind: 'mbp', date: '2026-10-17', orgUnitKey: 'R09-B01', reason: 'wear', reasonText: 'Износ, не подлежит ремонту (протокол комиссии ЦБУ)', commission: { chairmanId: 'u21', memberIds: ['u14', 'u7'], orderNo: 'ПР-2026-121' },
    commissionSignatures: [], lines: [{ refId: 'mb3', qty: 2, amount: 2_700_000 }], amount: 2_700_000, costCenterId: 'CC0198', status: 'draft', createdBy: 'u14', createdAt: '2026-10-17T10:00:00Z',
    history: [{ at: '2026-10-17T10:00:00Z', userId: 'u14', action: 'created' }],
  },
];

export const warehouseInventoriesSeed: WarehouseInventory[] = [
  {
    id: 'iv1', number: 'INV-2026-0007', scope: 'tmz', warehouseId: 'wh3', method: 'scan', commission: { chairmanId: 'u6', memberIds: ['u14', 'u7'], orderNo: 'ПР-2026-110' }, date: '2026-10-10', status: 'completed',
    lines: [
      { refId: 'wi9', expectedQty: 12, actualQty: 11, unitCost: 410_000, scannedAt: '2026-10-10T10:20:00Z', note: 'Одна сумка не обнаружена' },
      { refId: 'wi10', expectedQty: 95, actualQty: 97, unitCost: 38_000, scannedAt: '2026-10-10T10:40:00Z' },
    ],
    createdBy: 'u14', postingIds: [],
    history: [{ at: '2026-10-10T09:00:00Z', userId: 'u14', action: 'created' }, { at: '2026-10-10T11:00:00Z', userId: 'u14', action: 'status_changed', comment: 'Сличительная ведомость сформирована' }],
  },
];

export const mbpSeed: MbpRecord[] = [
  { id: 'mb1', number: 'MBP-2026-0001', cardId: 'wc9', name: 'Стол рабочий 1400×700', unit: 'шт', qty: 6, unitCost: 2_050_000, issuedAt: '2026-03-12', orgUnitKey: 'R01-B01', departmentId: 'd9', responsibleId: 'u12', costCenterId: 'CC0043', offBalanceAccount: '96335000', status: 'in_use', barcode: ean13('210000000001'), history: [{ at: '2026-03-12T09:00:00Z', userId: 'u14', action: 'created', comment: 'Выдача МБП в эксплуатацию' }] },
  { id: 'mb2', number: 'MBP-2026-0002', cardId: 'wc10', name: 'Кресло офисное', unit: 'шт', qty: 8, unitCost: 1_480_000, issuedAt: '2026-03-12', orgUnitKey: 'R01-B01', departmentId: 'd9', responsibleId: 'u12', costCenterId: 'CC0043', offBalanceAccount: '96335000', status: 'in_use', barcode: ean13('210000000002'), history: [{ at: '2026-03-12T09:00:00Z', userId: 'u14', action: 'created', comment: 'Выдача МБП в эксплуатацию' }] },
  { id: 'mb3', number: 'MBP-2026-0003', cardId: 'wc10', name: 'Кресло офисное', unit: 'шт', qty: 5, unitCost: 1_350_000, issuedAt: '2024-05-20', orgUnitKey: 'R09-B01', departmentId: 'd9', responsibleId: 'u21', costCenterId: 'CC0198', offBalanceAccount: '96335000', status: 'in_use', barcode: ean13('210000000003'), history: [{ at: '2024-05-20T09:00:00Z', userId: 'u14', action: 'created', comment: 'Выдача МБП в эксплуатацию' }] },
  { id: 'mb4', number: 'MBP-2026-0004', cardId: 'wc11', name: 'Шкаф для документов', unit: 'шт', qty: 3, unitCost: 2_750_000, issuedAt: '2025-08-01', orgUnitKey: 'R12-B01', departmentId: 'd9', responsibleId: 'u6', costCenterId: 'CC0251', offBalanceAccount: '96335000', status: 'in_use', barcode: ean13('210000000004'), history: [{ at: '2025-08-01T09:00:00Z', userId: 'u14', action: 'created', comment: 'Выдача МБП в эксплуатацию' }] },
  { id: 'mb5', number: 'MBP-2026-0005', cardId: 'wc9', name: 'Стол рабочий 1400×700', unit: 'шт', qty: 4, unitCost: 2_100_000, issuedAt: '2026-06-02', orgUnitKey: 'd1', departmentId: 'd1', responsibleId: 'u2', costCenterId: 'CC0001', offBalanceAccount: '96335000', status: 'in_use', barcode: ean13('210000000005'), history: [{ at: '2026-06-02T09:00:00Z', userId: 'u14', action: 'created', comment: 'Выдача МБП в эксплуатацию' }] },
  { id: 'mb6', number: 'MBP-2026-0006', cardId: 'wc9', name: 'Стол рабочий 1400×700', unit: 'шт', qty: 2, unitCost: 2_300_000, issuedAt: '2026-09-15', orgUnitKey: 'd1', departmentId: 'd1', responsibleId: 'u2', costCenterId: 'CC0001', offBalanceAccount: '96335000', status: 'in_use', barcode: ean13('210000000006'), history: [{ at: '2026-09-15T09:00:00Z', userId: 'u14', action: 'created', comment: 'Выдача МБП в эксплуатацию' }] },
  { id: 'mb7', number: 'MBP-2026-0007', cardId: 'wc10', name: 'Кресло офисное', unit: 'шт', qty: 3, unitCost: 1_420_000, issuedAt: '2025-12-10', orgUnitKey: 'R08-B01', departmentId: 'd9', responsibleId: 'u21', costCenterId: 'CC0176', offBalanceAccount: '96335000', status: 'in_use', barcode: ean13('210000000007'), history: [{ at: '2025-12-10T09:00:00Z', userId: 'u14', action: 'created', comment: 'Выдача МБП в эксплуатацию' }] },
];
