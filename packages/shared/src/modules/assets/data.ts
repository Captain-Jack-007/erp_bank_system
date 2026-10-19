// Демо-данные модуля «Основные средства» (вымышленные).
import type { ApprovalTask, Localized } from '../../types';
import type { AssetCapRule, AssetGroup, AssetInventory, AssetOperation, AssetRecord, AssetWriteoffAct } from './types';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

export const assetGroupsSeed: AssetGroup[] = [
  { id: 'ag-atm', code: 'ATM', invPrefix: '01', name: L('Банкоматы, киоски и терминалы', 'Bankomatlar, kiosklar va terminallar', 'ATMs, kiosks and terminals'), category: 'atm', account: '16511000', depAccount: '16599000', expenseAccount: '56320000', usefulLifeMonths: 84, method: 'linear' },
  { id: 'ag-pc', code: 'PC', invPrefix: '02', name: L('Компьютерная техника и серверы', 'Kompyuter texnikasi va serverlar', 'Computers and servers'), category: 'computers', account: '16509000', depAccount: '16599000', expenseAccount: '56320000', usefulLifeMonths: 48, method: 'declining' },
  { id: 'ag-fur', code: 'FUR', invPrefix: '03', name: L('Мебель и офисное оборудование', 'Mebel va ofis jihozlari', 'Furniture and office equipment'), category: 'furniture', account: '16503000', depAccount: '16599000', expenseAccount: '56320000', usefulLifeMonths: 120, method: 'linear' },
  { id: 'ag-veh', code: 'VEH', invPrefix: '04', name: L('Транспортные средства', 'Transport vositalari', 'Vehicles'), category: 'vehicles', account: '16507000', depAccount: '16599000', expenseAccount: '56320000', usefulLifeMonths: 72, method: 'linear' },
  { id: 'ag-bld', code: 'BLD', invPrefix: '05', name: L('Здания и сооружения', 'Binolar va inshootlar', 'Buildings and structures'), category: 'buildings', account: '16501000', depAccount: '16599000', expenseAccount: '56320000', usefulLifeMonths: 600, method: 'linear' },
  { id: 'ag-sec', code: 'SEC', invPrefix: '06', name: L('Системы безопасности', 'Xavfsizlik tizimlari', 'Security systems'), category: 'security', account: '16513000', depAccount: '16599000', expenseAccount: '56320000', usefulLifeMonths: 60, method: 'linear' },
  { id: 'ag-rou', code: 'ROU', invPrefix: '07', name: L('Право пользования (аренда, МСФО 16)', 'Foydalanish huquqi (ijara, MHXS 16)', 'Right-of-use (lease, IFRS 16)'), category: 'leased', account: '16521000', depAccount: '16599000', expenseAccount: '56320000', usefulLifeMonths: 60, method: 'linear' },
];

const monthsBetween = (from: string, to: string) => {
  const [y1, m1] = from.split('-').map(Number) as [number, number];
  const [y2, m2] = to.split('-').map(Number) as [number, number];
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
};
/** Накопленная линейная амортизация по сентябрь 2026 включительно (демо). */
const acc = (cost: number, life: number, from: string) => Math.min(cost, Math.round(cost / life) * monthsBetween(from, '2026-10'));
const created = (at: string) => [{ at: `${at}T09:00:00Z`, userId: 'u7', action: 'created' as const }];

type Seed = Omit<AssetRecord, 'components' | 'history' | 'revaluation' | 'method' | 'source'> & Partial<Pick<AssetRecord, 'components' | 'history' | 'revaluation' | 'method' | 'source'>>;
const A = (a: Seed): AssetRecord => ({ components: [], history: created(a.acquiredAt), revaluation: 0, method: 'linear', source: 'purchase', ...a });

export const assetsSeed: AssetRecord[] = [
  A({ id: 'as1', inventoryNo: 'OS-01-004512', name: 'Банкомат B-200', category: 'atm', groupId: 'ag-atm', location: 'ЦБУ Юнусабад, Ташкент', departmentId: 'd9', orgUnitKey: 'R01-B01', costCenterId: 'CC0045', responsibleId: 'u8', acquiredAt: '2022-03-15', cost: 182_000_000, usefulLifeMonths: 84, accumulated: 93_600_000, status: 'in_use', serialNo: 'B200-22-004512', model: 'Банкомат B-200', warrantyUntil: '2025-03-15' }),
  A({ id: 'as2', inventoryNo: 'OS-02-010877', name: 'Сервер 2U, 2×CPU, 256 ГБ', category: 'computers', groupId: 'ag-pc', location: 'ЦОД, Ташкент', departmentId: 'd1', orgUnitKey: 'd1', costCenterId: 'CC0005', responsibleId: 'u2', acquiredAt: '2021-06-01', cost: 248_000_000, usefulLifeMonths: 60, accumulated: 214_933_000, status: 'in_use', serialNo: 'SRV-2U-77810', warrantyUntil: '2024-06-01' }),
  A({ id: 'as3', inventoryNo: 'OS-02-013420', name: 'Ноутбук 14", Core i5', category: 'computers', groupId: 'ag-pc', location: 'Головной офис, каб. 512', departmentId: 'd1', orgUnitKey: 'd1', costCenterId: 'CC0002', responsibleId: 'u1', acquiredAt: '2019-02-10', cost: 9_800_000, usefulLifeMonths: 48, accumulated: 9_800_000, status: 'repair', method: 'declining', serialNo: 'NB14-19-3420', history: [...created('2019-02-10'), { at: '2026-09-20T10:00:00Z', userId: 'u2', action: 'status_changed', comment: 'Передан в ремонт: не включается' }] }),
  A({ id: 'as4', inventoryNo: 'OS-03-002210', name: 'Комплект мебели переговорной', category: 'furniture', groupId: 'ag-fur', location: 'Головной офис, 4 этаж', departmentId: 'd2', orgUnitKey: 'd2', costCenterId: 'CC0006', responsibleId: 'u6', acquiredAt: '2023-08-20', cost: 64_000_000, usefulLifeMonths: 120, accumulated: 17_066_000, status: 'in_use' }),
  A({ id: 'as5', inventoryNo: 'OS-04-000731', name: 'Автомобиль служебный, седан', category: 'vehicles', groupId: 'ag-veh', location: 'Автопарк, Сергели', departmentId: 'd2', orgUnitKey: 'd2', costCenterId: 'CC0007', responsibleId: 'u6', acquiredAt: '2020-11-05', cost: 312_000_000, usefulLifeMonths: 72, accumulated: 307_666_000, status: 'pending_writeoff', serialNo: 'VIN-XB0731SEDAN', history: [...created('2020-11-05'), { at: '2026-10-15T08:30:00Z', userId: 'u6', action: 'submitted', comment: 'Акт ОС-4 WO-2026-0004: пробег 410 000 км, ремонт экономически нецелесообразен' }] }),
  A({ id: 'as6', inventoryNo: 'OS-06-005019', name: 'Система видеонаблюдения ЦБУ (16 камер)', category: 'security', groupId: 'ag-sec', location: 'ЦБУ Самарканд-центр', departmentId: 'd2', orgUnitKey: 'R09-B01', costCenterId: 'CC0198', responsibleId: 'u6', acquiredAt: '2024-04-01', cost: 96_000_000, usefulLifeMonths: 60, accumulated: 49_600_000, status: 'in_use', components: [{ id: 'cmp1', date: '2025-05-12', kind: 'modernization', amount: 8_000_000, description: 'Дополнительные 4 камеры и видеорегистратор', fundingAccount: '16505000' }] }),
  A({ id: 'as7', inventoryNo: 'OS-05-000044', name: 'Здание филиала, Фергана', category: 'buildings', groupId: 'ag-bld', location: "Farg'ona sh., Mustaqillik ko'ch., 12", departmentId: 'd2', orgUnitKey: 'R12', costCenterId: 'CC0241', responsibleId: 'u6', acquiredAt: '2015-01-01', cost: 8_400_000_000, usefulLifeMonths: 600, accumulated: 1_974_000_000, status: 'in_use', revaluation: 600_000_000, taxObject: { kind: 'building', cadastralNo: '12:01:0203:0044', area: 1840, landArea: 2600, cadastralValue: 7_900_000_000 } }),
  A({ id: 'as8', inventoryNo: 'OS-01-004988', name: 'Терминал самообслуживания K-5', category: 'atm', groupId: 'ag-atm', location: 'ЦБУ Чиланзар, Ташкент', departmentId: 'd9', orgUnitKey: 'R01-B02', costCenterId: 'CC0049', responsibleId: 'u8', acquiredAt: '2025-09-10', cost: 64_000_000, usefulLifeMonths: 84, accumulated: 9_904_000, status: 'in_use', serialNo: 'K5-25-004988', model: 'Терминал самообслуживания K-5', warrantyUntil: '2027-09-10' }),
  A({ id: 'as9', inventoryNo: 'OS-01-003118', name: 'Банкомат B-200', category: 'atm', groupId: 'ag-atm', location: 'ЦБУ Чиланзар, Ташкент', departmentId: 'd9', orgUnitKey: 'R01-B02', costCenterId: 'CC0049', responsibleId: 'u8', acquiredAt: '2021-11-02', cost: 176_000_000, usefulLifeMonths: 84, accumulated: acc(176_000_000, 84, '2021-11'), status: 'in_use', serialNo: 'B200-21-003118', model: 'Банкомат B-200' }),
  A({ id: 'as10', inventoryNo: 'OS-01-002204', name: 'Банкомат C-100 (ресайклинг)', category: 'atm', groupId: 'ag-atm', location: 'Филиал Самарканд', departmentId: 'd9', orgUnitKey: 'R09-B01', costCenterId: 'CC0197', responsibleId: 'u21', acquiredAt: '2020-06-20', cost: 210_000_000, usefulLifeMonths: 84, accumulated: acc(210_000_000, 84, '2020-06'), status: 'in_use', serialNo: 'C100-20-002204', model: 'Банкомат C-100 (ресайклинг)' }),
  A({ id: 'as11', inventoryNo: 'OS-01-004102', name: 'Терминал самообслуживания K-5', category: 'atm', groupId: 'ag-atm', location: 'Филиал Фергана', departmentId: 'd9', orgUnitKey: 'R12-B01', costCenterId: 'CC0250', responsibleId: 'u6', acquiredAt: '2023-02-14', cost: 58_000_000, usefulLifeMonths: 84, accumulated: acc(58_000_000, 84, '2023-02'), status: 'in_use', serialNo: 'K5-23-004102', model: 'Терминал самообслуживания K-5' }),
  A({ id: 'as12', inventoryNo: 'OS-01-005521', name: 'POS-терминал PAX A930', category: 'atm', groupId: 'ag-atm', location: 'Корпоративный клиент: торговая сеть', departmentId: 'd9', orgUnitKey: 'R01-B01', costCenterId: 'CC0045', responsibleId: 'u8', acquiredAt: '2024-07-01', cost: 4_600_000, usefulLifeMonths: 60, accumulated: acc(4_600_000, 60, '2024-07'), status: 'in_use', serialNo: 'A930-24-115521', model: 'PAX A930' }),
  A({ id: 'as13', inventoryNo: 'OS-01-005522', name: 'POS-терминал Sunmi P3', category: 'atm', groupId: 'ag-atm', location: 'Корпоративный клиент: АЗС', departmentId: 'd9', orgUnitKey: 'R09-B01', costCenterId: 'CC0197', responsibleId: 'u21', acquiredAt: '2024-11-12', cost: 3_900_000, usefulLifeMonths: 60, accumulated: acc(3_900_000, 60, '2024-11'), status: 'in_use', serialNo: 'P3-24-862207', model: 'Sunmi P3' }),
  A({ id: 'as14', inventoryNo: 'OS-01-004207', name: 'Банкомат B-200', category: 'atm', groupId: 'ag-atm', location: 'Филиал Наманган', departmentId: 'd9', orgUnitKey: 'R08-B01', costCenterId: 'CC0178', responsibleId: 'u21', acquiredAt: '2022-08-08', cost: 180_000_000, usefulLifeMonths: 84, accumulated: acc(180_000_000, 84, '2022-08'), status: 'in_use', serialNo: 'B200-22-004207', model: 'Банкомат B-200' }),
  A({ id: 'as15', inventoryNo: 'OS-07-000012', name: 'Офис ЦБУ «Мирабад» (аренда, право пользования)', category: 'leased', groupId: 'ag-rou', location: 'Toshkent sh., Mirobod t. (demo)', departmentId: 'd9', orgUnitKey: 'R01-B03', costCenterId: 'CC0051', responsibleId: 'u6', acquiredAt: '2025-01-01', cost: 1_210_000_000, usefulLifeMonths: 60, accumulated: acc(1_210_000_000, 60, '2025-01'), status: 'in_use', source: 'lease', counterpartyId: 'c5', lease: { direction: 'in', counterpartyId: 'c5', from: '2025-01-01', to: '2029-12-31', monthly: 26_000_000 } }),
  A({ id: 'as16', inventoryNo: 'OS-02-013655', name: 'Ноутбук 15", Core i7', category: 'computers', groupId: 'ag-pc', location: 'Головной офис, каб. 512', departmentId: 'd1', orgUnitKey: 'd1', costCenterId: 'CC0002', responsibleId: 'u1', acquiredAt: '2025-03-01', cost: 14_200_000, usefulLifeMonths: 48, accumulated: acc(14_200_000, 48, '2025-03'), status: 'pending_transfer', method: 'declining', serialNo: 'NB15-25-3655', source: 'warehouse' }),
];

export const assetOperationsSeed: AssetOperation[] = [
  {
    id: 'ao1', number: 'OP-2026-0201', type: 'revaluation', assetIds: ['as7'], date: '2025-12-31', status: 'completed', from: { cost: 7_800_000_000 }, to: { cost: 8_400_000_000, revaluation: 600_000_000 }, amount: 600_000_000,
    reason: 'Переоценка по заключению независимого оценщика (на 31.12.2025)', createdBy: 'u7', createdAt: '2025-12-31T10:00:00Z', completedAt: '2025-12-31T10:00:00Z', history: [{ at: '2025-12-31T10:00:00Z', userId: 'u7', action: 'approved' }],
  },
  {
    id: 'ao2', number: 'OP-2026-0214', type: 'transfer_mol', assetIds: ['as16'], date: '2026-10-17', status: 'awaiting_acceptance', from: { responsibleId: 'u1' }, to: { responsibleId: 'u2' }, amount: 0, orderNo: 'AKT-2026-0214',
    reason: 'Передача ноутбука руководителю департамента', createdBy: 'u1', createdAt: '2026-10-17T11:00:00Z', history: [{ at: '2026-10-17T11:00:00Z', userId: 'u1', action: 'created', comment: 'Электронный акт приёма-передачи' }],
  },
];

export const assetWriteoffSeed: AssetWriteoffAct[] = [
  {
    id: 'wo1', number: 'WO-2026-0004', kind: 'liquidation', date: '2026-10-15', assetIds: ['as5'], reason: 'Пробег 410 000 км, ремонт экономически нецелесообразен', commission: { chairmanId: 'u6', memberIds: ['u7', 'u14'], protocolNo: 'ПК-2026-019' },
    commissionSignatures: [], nbv: 4_334_000, costCenterId: 'CC0007', status: 'pending', source: 'manual', createdBy: 'u6', createdAt: '2026-10-15T08:00:00Z',
    history: [{ at: '2026-10-15T08:00:00Z', userId: 'u6', action: 'created' }, { at: '2026-10-15T08:30:00Z', userId: 'u6', action: 'submitted', comment: 'Протокол комиссии подписан' }],
  },
];

export const assetsApprovalSeed: ApprovalTask[] = [
  { id: 'a_as1', entity: 'asset_writeoff', entityId: 'wo1', title: 'Списание ОС: Автомобиль служебный, седан', number: 'WO-2026-0004', amount: 4_334_000, requesterId: 'u6', assigneeRole: 'dept_head', step: 1, totalSteps: 2, createdAt: '2026-10-15T08:30:00Z', dueAt: '2026-10-20T18:00:00Z', status: 'pending' },
];

export const assetCapRulesSeed: AssetCapRule[] = [
  { id: 'cr1', account: '16505000', groupId: 'ag-bld', minAmount: 0, description: 'Строительство и реконструкция зданий (счёт 16505)', active: true },
  { id: 'cr2', account: '19907000', groupId: 'ag-pc', minAmount: 5_000_000, description: 'ИТ-оборудование к установке (счёт 19907)', active: true },
  { id: 'cr3', account: '16505000', groupId: 'ag-sec', minAmount: 10_000_000, description: 'Модернизация систем безопасности (счёт 16505)', active: true },
];

export const assetInventoriesSeed: AssetInventory[] = [
  {
    id: 'ai1', number: 'INV-OS-2026-0003', orgUnitKey: 'R12', method: 'qr', commission: { chairmanId: 'u6', memberIds: ['u7', 'u14'], orderNo: 'ПР-2026-080' }, date: '2026-07-15', status: 'approved',
    lines: [{ assetId: 'as7', found: true, condition: 'good', scannedAt: '2026-07-15T10:00:00Z' }], createdBy: 'u7', approvedBy: 'u7', approvedAt: '2026-07-16T09:00:00Z',
    history: [{ at: '2026-07-15T09:00:00Z', userId: 'u7', action: 'created' }, { at: '2026-07-16T09:00:00Z', userId: 'u7', action: 'approved' }],
  },
];
