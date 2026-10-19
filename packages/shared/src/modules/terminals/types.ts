// Типы модуля «Учёт терминалов» (ТЗ 4.2.19): терминал — основное средство с серийным номером, моделью,
// признаком платёжной системы и признаком iABS; синхронизация с iABS «Учёт терминалов»; мониторинг устройств.
import type { HistoryEvent, ID, ISODate } from '../../types';

export type TerminalType = 'atm' | 'pos' | 'kiosk';
/** Состояние устройства (мониторинг). */
export type TerminalStatus = 'online' | 'offline' | 'maintenance';
export type TerminalPaySystem = 'humo' | 'uzcard';
/** Учётное состояние: используется / свободен / списан. */
export type TerminalState = 'in_use' | 'free' | 'written_off';
/** Статус карточки в iABS «Учёт терминалов». */
export type TerminalIabsStatus = 'pending' | 'active' | 'free' | 'written_off' | 'deleted' | 'error';
export type TerminalTicketStatus = 'open' | 'closed';
export type TerminalIssue = 'no_cash' | 'card_reader' | 'printer' | 'network' | 'cash_jam' | 'power';

export interface TerminalModel {
  id: ID;
  brand: string;
  model: string;
  type: TerminalType;
  paySystems: TerminalPaySystem[];
  /** Ожидаемый префикс серийного номера (подсказка и контроль). */
  serialPrefix?: string;
  active: boolean;
}

/** Правило определения признака iABS по префиксу/диапазону серийного номера и платёжной системе. */
export interface TerminalIabsRule {
  id: ID;
  paySystem: TerminalPaySystem;
  prefix?: string;
  rangeFrom?: string;
  rangeTo?: string;
  flag: string;
  section: string;
  priority: number;
  active: boolean;
}

export interface TerminalDevice {
  id: ID;
  code: string;
  serialNo: string;
  modelId: ID;
  model: string;
  type: TerminalType;
  paySystem: TerminalPaySystem;
  iabsFlag: string;
  iabsSection: string;
  iabsStatus: TerminalIabsStatus;
  iabsTerminalId?: string;
  /** Связь с карточкой ОС и неизменяемый инвентарный номер (переносится в iABS). */
  assetId: ID;
  inventoryNo: string;
  orgUnitKey: string;
  region: string;
  branch: string;
  address: string;
  state: TerminalState;
  status: TerminalStatus;
  cashLevel?: number;
  lastCollection?: ISODate;
  uptime30d: number;
  installedAt: ISODate;
  txLast7: number[];
  history: HistoryEvent[];
}

export type TerminalSyncOp = 'register' | 'update' | 'move' | 'status' | 'delete';

export interface TerminalSyncEntry {
  id: ID;
  terminalId: ID;
  serialNo: string;
  inventoryNo: string;
  at: ISODate;
  operation: TerminalSyncOp;
  payload: Record<string, string | number>;
  status: 'pending' | 'success' | 'failed' | 'queued' | 'quarantined';
  exchangeId?: ID;
  error?: string;
  userId: ID;
}

export interface TerminalTicket {
  id: ID;
  number: string;
  terminalId: ID;
  issue: TerminalIssue;
  description: string;
  status: TerminalTicketStatus;
  openedAt: ISODate;
  openedBy: ID;
  closedAt?: ISODate;
  resolution?: string;
}

export interface TerminalsStats {
  total: number;
  online: number;
  offline: number;
  maintenance: number;
  avgUptime: number;
  lowCash: number;
  openTickets: number;
  txToday: number;
  humo: number;
  uzcard: number;
  free: number;
  syncErrors: number;
  pendingMoves: number;
}

export interface NewTerminalTicketInput {
  terminalId: ID;
  issue: TerminalIssue;
  description: string;
}

export interface TerminalRegisterInput {
  serialNo: string;
  modelId: ID;
  paySystem: TerminalPaySystem;
  orgUnitKey: string;
  departmentId: ID;
  costCenterId: string;
  responsibleId: ID;
  address: string;
  cost: number;
  acquiredAt: string;
  usefulLifeMonths?: number;
  state: 'in_use' | 'free';
}
