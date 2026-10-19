// Демо-данные модуля «Терминалы» (вымышленные серийные номера, коды и адреса).
import type { TerminalDevice, TerminalIabsRule, TerminalModel, TerminalTicket } from './types';

export const terminalModelsSeed: TerminalModel[] = [
  { id: 'tmod-a930', brand: 'PAX', model: 'PAX A930', type: 'pos', paySystems: ['humo', 'uzcard'], serialPrefix: 'A930', active: true },
  { id: 'tmod-p3', brand: 'Sunmi', model: 'Sunmi P3', type: 'pos', paySystems: ['humo', 'uzcard'], serialPrefix: 'P3', active: true },
  { id: 'tmod-ing', brand: 'Ingenico', model: 'Ingenico Move/5000', type: 'pos', paySystems: ['humo', 'uzcard'], serialPrefix: 'ING', active: true },
  { id: 'tmod-b200', brand: 'XB-Tech', model: 'Банкомат B-200', type: 'atm', paySystems: ['humo', 'uzcard'], serialPrefix: 'B200', active: true },
  { id: 'tmod-c100', brand: 'XB-Tech', model: 'Банкомат C-100 (ресайклинг)', type: 'atm', paySystems: ['humo', 'uzcard'], serialPrefix: 'C100', active: true },
  { id: 'tmod-k5', brand: 'XB-Tech', model: 'Терминал самообслуживания K-5', type: 'kiosk', paySystems: ['humo', 'uzcard'], serialPrefix: 'K5', active: true },
];

export const terminalIabsRulesSeed: TerminalIabsRule[] = [
  { id: 'ir1', paySystem: 'humo', prefix: 'A930', flag: 'HUMO-POS', section: 'HUMO · POS-терминалы', priority: 10, active: true },
  { id: 'ir2', paySystem: 'uzcard', prefix: 'A930', flag: 'UZC-POS', section: 'Uzcard · POS-терминалы', priority: 10, active: true },
  { id: 'ir3', paySystem: 'humo', prefix: 'P3', flag: 'HUMO-POS', section: 'HUMO · POS-терминалы', priority: 10, active: true },
  { id: 'ir4', paySystem: 'uzcard', prefix: 'P3', flag: 'UZC-POS', section: 'Uzcard · POS-терминалы', priority: 10, active: true },
  { id: 'ir5', paySystem: 'humo', rangeFrom: 'ING-000000', rangeTo: 'ING-499999', flag: 'HUMO-POS-I', section: 'HUMO · POS Ingenico', priority: 20, active: true },
  { id: 'ir6', paySystem: 'uzcard', rangeFrom: 'ING-500000', rangeTo: 'ING-999999', flag: 'UZC-POS-I', section: 'Uzcard · POS Ingenico', priority: 20, active: true },
  { id: 'ir7', paySystem: 'humo', prefix: 'B200', flag: 'HUMO-ATM', section: 'HUMO · Банкоматы', priority: 10, active: true },
  { id: 'ir8', paySystem: 'uzcard', prefix: 'B200', flag: 'UZC-ATM', section: 'Uzcard · Банкоматы', priority: 10, active: true },
  { id: 'ir9', paySystem: 'humo', prefix: 'C100', flag: 'HUMO-ATM', section: 'HUMO · Банкоматы', priority: 10, active: true },
  { id: 'ir10', paySystem: 'uzcard', prefix: 'C100', flag: 'UZC-ATM', section: 'Uzcard · Банкоматы', priority: 10, active: true },
  { id: 'ir11', paySystem: 'humo', prefix: 'K5', flag: 'HUMO-KSK', section: 'HUMO · Киоски', priority: 10, active: true },
  { id: 'ir12', paySystem: 'uzcard', prefix: 'K5', flag: 'UZC-KSK', section: 'Uzcard · Киоски', priority: 10, active: true },
];

type Seed = Omit<TerminalDevice, 'iabsFlag' | 'iabsSection' | 'iabsStatus' | 'history'> & Partial<Pick<TerminalDevice, 'iabsStatus'>>;
const T = (t: Seed): Seed => t;

/** Признак и раздел iABS вычисляются по правилам при загрузке модуля. */
export const terminalDevicesSeed: Seed[] = [
  T({ id: 'tm1', code: 'ATM-TSH-0012', serialNo: 'B200-22-004512', modelId: 'tmod-b200', model: 'Банкомат B-200', type: 'atm', paySystem: 'humo', assetId: 'as1', inventoryNo: 'OS-01-004512', orgUnitKey: 'R01-B01', region: 'Toshkent sh.', branch: 'ЦБУ Юнусабад', address: "Amir Temur ko'ch., 108", state: 'in_use', status: 'online', cashLevel: 72, lastCollection: '2026-10-16T07:30:00Z', uptime30d: 99.2, installedAt: '2022-03-15', iabsTerminalId: 'T-004512', txLast7: [412, 438, 401, 455, 470, 389, 320] }),
  T({ id: 'tm2', code: 'ATM-TSH-0027', serialNo: 'B200-21-003118', modelId: 'tmod-b200', model: 'Банкомат B-200', type: 'atm', paySystem: 'uzcard', assetId: 'as9', inventoryNo: 'OS-01-003118', orgUnitKey: 'R01-B02', region: 'Toshkent sh.', branch: 'ЦБУ Чиланзар', address: "Bunyodkor shoh ko'ch., 3", state: 'in_use', status: 'online', cashLevel: 14, lastCollection: '2026-10-13T08:10:00Z', uptime30d: 97.8, installedAt: '2021-11-02', iabsTerminalId: 'T-003118', txLast7: [520, 548, 590, 602, 611, 498, 455] }),
  T({ id: 'tm3', code: 'ATM-SAM-0004', serialNo: 'C100-20-002204', modelId: 'tmod-c100', model: 'Банкомат C-100 (ресайклинг)', type: 'atm', paySystem: 'humo', assetId: 'as10', inventoryNo: 'OS-01-002204', orgUnitKey: 'R09-B01', region: 'Samarqand vil.', branch: 'Филиал Самарканд', address: "Registon ko'ch., 3", state: 'in_use', status: 'offline', cashLevel: 0, lastCollection: '2026-10-11T09:00:00Z', uptime30d: 88.4, installedAt: '2020-06-20', iabsTerminalId: 'T-002204', txLast7: [302, 315, 288, 140, 0, 0, 0] }),
  T({ id: 'tm4', code: 'KSK-TSH-0101', serialNo: 'K5-25-004988', modelId: 'tmod-k5', model: 'Терминал самообслуживания K-5', type: 'kiosk', paySystem: 'uzcard', assetId: 'as8', inventoryNo: 'OS-01-004988', orgUnitKey: 'R01-B02', region: 'Toshkent sh.', branch: 'ЦБУ Чиланзар', address: "Bunyodkor shoh ko'ch., 3", state: 'in_use', status: 'online', uptime30d: 99.6, installedAt: '2025-09-10', iabsTerminalId: 'T-004988', txLast7: [210, 198, 225, 240, 233, 190, 160] }),
  T({ id: 'tm5', code: 'KSK-FER-0018', serialNo: 'K5-23-004102', modelId: 'tmod-k5', model: 'Терминал самообслуживания K-5', type: 'kiosk', paySystem: 'humo', assetId: 'as11', inventoryNo: 'OS-01-004102', orgUnitKey: 'R12-B01', region: "Farg'ona vil.", branch: 'Филиал Фергана', address: "Mustaqillik ko'ch., 12", state: 'in_use', status: 'maintenance', uptime30d: 91.0, installedAt: '2023-02-14', iabsTerminalId: 'T-004102', txLast7: [140, 152, 133, 0, 0, 61, 118] }),
  T({ id: 'tm6', code: 'POS-TSH-5521', serialNo: 'A930-24-115521', modelId: 'tmod-a930', model: 'PAX A930', type: 'pos', paySystem: 'humo', assetId: 'as12', inventoryNo: 'OS-01-005521', orgUnitKey: 'R01-B01', region: 'Toshkent sh.', branch: 'Корпоративный клиент: торговая сеть', address: 'Chilonzor t., 21-uy', state: 'in_use', status: 'online', uptime30d: 99.9, installedAt: '2024-07-01', iabsTerminalId: 'T-115521', txLast7: [880, 912, 940, 1010, 1102, 1240, 1180] }),
  T({ id: 'tm7', code: 'POS-SAM-2207', serialNo: 'P3-24-862207', modelId: 'tmod-p3', model: 'Sunmi P3', type: 'pos', paySystem: 'uzcard', assetId: 'as13', inventoryNo: 'OS-01-005522', orgUnitKey: 'R09-B01', region: 'Samarqand vil.', branch: 'Корпоративный клиент: АЗС', address: 'Samarqand sh., halqa yoʻli', state: 'free', status: 'online', uptime30d: 98.7, installedAt: '2024-11-12', iabsTerminalId: 'T-862207', iabsStatus: 'free', txLast7: [610, 590, 642, 655, 670, 720, 701] }),
  T({ id: 'tm8', code: 'ATM-NAM-0009', serialNo: 'B200-22-004207', modelId: 'tmod-b200', model: 'Банкомат B-200', type: 'atm', paySystem: 'humo', assetId: 'as14', inventoryNo: 'OS-01-004207', orgUnitKey: 'R08-B01', region: 'Namangan vil.', branch: 'Филиал Наманган', address: "Navoiy ko'ch., 45", state: 'in_use', status: 'online', cashLevel: 38, lastCollection: '2026-10-15T08:00:00Z', uptime30d: 98.1, installedAt: '2022-08-08', iabsTerminalId: 'T-004207', txLast7: [280, 302, 295, 310, 330, 260, 240] }),
];

export const terminalTicketsSeed: TerminalTicket[] = [
  { id: 'tt1', number: 'TK-2026-0871', terminalId: 'tm3', issue: 'network', description: 'Нет связи с процессинговым центром с 14.10, канал провайдера недоступен.', status: 'open', openedAt: '2026-10-14T11:20:00Z', openedBy: 'u2' },
  { id: 'tt2', number: 'TK-2026-0874', terminalId: 'tm5', issue: 'printer', description: 'Не печатает чеки, замятие ленты.', status: 'open', openedAt: '2026-10-15T09:05:00Z', openedBy: 'u8' },
  { id: 'tt3', number: 'TK-2026-0862', terminalId: 'tm2', issue: 'cash_jam', description: 'Застревание купюр в диспенсере.', status: 'closed', openedAt: '2026-10-09T13:00:00Z', openedBy: 'u8', closedAt: '2026-10-09T17:40:00Z', resolution: 'Очищен тракт диспенсера, проведён тест выдачи.' },
];
