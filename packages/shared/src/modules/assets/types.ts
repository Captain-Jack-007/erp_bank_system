// Типы модуля «Основные средства» (ТЗ 4.2.5).
import type { HistoryEvent, ID, ISODate, Localized } from '../../types';

export type AssetCategory = 'computers' | 'atm' | 'furniture' | 'vehicles' | 'buildings' | 'security' | 'leased';
export type AssetStatus = 'in_use' | 'repair' | 'conservation' | 'leased_out' | 'pending_transfer' | 'pending_writeoff' | 'written_off' | 'sold' | 'missing';
export type AssetMethod = 'linear' | 'declining';
export type AssetSource = 'purchase' | 'gratuitous' | 'warehouse' | 'construction' | 'lease' | 'surplus' | 'transfer_in' | 'other';

/** Группа ОС, открытая в целом по банку, с привязкой счетов (8 знаков, демо-план счетов). */
export interface AssetGroup {
  id: ID;
  code: string;
  /** Префикс инвентарного номера: OS-<prefix>-NNNNNN. */
  invPrefix: string;
  name: Localized;
  category: AssetCategory;
  account: string;
  depAccount: string;
  expenseAccount: string;
  usefulLifeMonths: number;
  method: AssetMethod;
}

export interface AssetComponent {
  id: ID;
  date: ISODate;
  kind: 'capital_repair' | 'part' | 'modernization';
  amount: number;
  description: string;
  fundingAccount: string;
  separatedAt?: ISODate;
  separatedReason?: string;
}

export interface AssetLease {
  direction: 'in' | 'out';
  counterpartyId: ID;
  contractId?: ID;
  from: ISODate;
  to: ISODate;
  monthly: number;
}

export interface AssetTaxObject {
  kind: 'building' | 'land';
  cadastralNo: string;
  area: number;
  landArea?: number;
  cadastralValue: number;
}

export interface AssetAllocationShare {
  costCenterId: string;
  share: number; // %
}

export interface AssetRecord {
  id: ID;
  inventoryNo: string;
  name: string;
  category: AssetCategory;
  groupId: ID;
  location: string;
  departmentId: ID;
  /** Оргединица (ЦБУ/подразделение) — наименование берётся из оргструктуры, поэтому переименование применяется автоматически. */
  orgUnitKey: string;
  costCenterId: string;
  responsibleId: ID;
  acquiredAt: ISODate;
  cost: number;
  usefulLifeMonths: number;
  accumulated: number;
  method: AssetMethod;
  /** Сумма дооценки (счёт 30908). */
  revaluation: number;
  status: AssetStatus;
  source: AssetSource;
  fundingAccount?: string;
  counterpartyId?: ID;
  contractId?: ID;
  serialNo?: string;
  model?: string;
  warrantyUntil?: ISODate;
  lease?: AssetLease;
  taxObject?: AssetTaxObject;
  allocation?: AssetAllocationShare[];
  components: AssetComponent[];
  nfcTagId?: string;
  lastInventoryAt?: ISODate;
  disposedAt?: ISODate;
  history: HistoryEvent[];
}

export interface AssetScheduleRow {
  year: number;
  depreciation: number;
  nbvEnd: number;
}

export interface AssetsStats {
  count: number;
  cost: number;
  nbv: number;
  monthlyDepreciation: number;
  pendingWriteoff: number;
  lastRunPeriod: string;
  nextPeriod: string;
  canRun: boolean;
  depDay: number;
  autoDep: boolean;
  unfinished: number;
  revaluation: number;
  postingsError: number;
}

export interface AssetsRunResult {
  period: string;
  assets: number;
  amount: number;
}

export interface AssetDepRun {
  id: ID;
  period: string;
  at: ISODate;
  by: ID;
  auto: boolean;
  lines: { assetId: ID; amount: number; costCenterId: string; method: AssetMethod }[];
  total: number;
  postingId?: ID;
}

export type AssetOpType =
  | 'registration'
  | 'intake'
  | 'transfer_mol'
  | 'transfer_dept'
  | 'transfer_cbu'
  | 'transfer_branch'
  | 'category_change'
  | 'revaluation'
  | 'improvement'
  | 'separation'
  | 'repair'
  | 'lease_out'
  | 'lease_end'
  | 'correction';
export type AssetOpStatus = 'awaiting_acceptance' | 'pending' | 'returned' | 'completed' | 'rejected' | 'cancelled';

export interface AssetOperation {
  id: ID;
  number: string;
  type: AssetOpType;
  assetIds: ID[];
  date: ISODate;
  status: AssetOpStatus;
  /** Было/стало: МОЛ, подразделение, ЦБУ, МВЗ, группа, суммы. */
  from?: Record<string, string | number>;
  to?: Record<string, string | number>;
  amount: number;
  reason: string;
  /** Номер электронного распоряжения (передача между ЦБУ/филиалами) или акта (МОЛ). */
  orderNo?: string;
  acceptance?: { userId: ID; signatureId: ID; at: ISODate };
  postingId?: ID;
  createdBy: ID;
  createdAt: ISODate;
  completedAt?: ISODate;
  history: HistoryEvent[];
}

export type AssetWriteoffKind = 'liquidation' | 'unusable' | 'gratuitous' | 'sale';
export type AssetWriteoffStatus = 'draft' | 'commission' | 'pending' | 'returned' | 'rejected' | 'completed';

export interface AssetWriteoffAct {
  id: ID;
  number: string;
  kind: AssetWriteoffKind;
  date: ISODate;
  assetIds: ID[];
  reason: string;
  commission: { chairmanId: ID; memberIds: ID[]; protocolNo: string };
  commissionSignatures: { userId: ID; signatureId: ID; at: ISODate }[];
  /** Продажа: цена без НДС, НДС 12 % начисляется автоматически; решение Правления. */
  salePrice?: number;
  vat?: number;
  boardDecisionNo?: string;
  buyerId?: ID;
  /** Безвозмездная передача: получатель. */
  recipient?: string;
  nbv: number;
  costCenterId: string;
  status: AssetWriteoffStatus;
  postingId?: ID;
  source: 'manual' | 'excel';
  createdBy: ID;
  createdAt: ISODate;
  history: HistoryEvent[];
}

export type AssetInventoryStatus = 'counting' | 'completed' | 'approved';
export type AssetCondition = 'good' | 'damaged' | 'unusable';

export interface AssetInventoryLine {
  assetId?: ID;
  /** Излишек: найденный объект без карточки. */
  surplus?: { name: string; groupId: ID; cost: number; code?: string };
  found: boolean;
  condition?: AssetCondition;
  note?: string;
  scannedAt?: ISODate;
}

export interface AssetInventory {
  id: ID;
  number: string;
  orgUnitKey: string;
  method: 'qr' | 'list';
  commission: { chairmanId: ID; memberIds: ID[]; orderNo: string };
  date: ISODate;
  status: AssetInventoryStatus;
  lines: AssetInventoryLine[];
  createdBy: ID;
  approvedBy?: ID;
  approvedAt?: ISODate;
  history: HistoryEvent[];
}

export interface AssetCapRule {
  id: ID;
  account: string;
  groupId: ID;
  minAmount: number;
  description: string;
  active: boolean;
}

/** Числящиеся ценности сотрудника (проверка перед увольнением/переводом). */
export interface AssetHoldings {
  userId: ID;
  allowed: boolean;
  assets: { id: ID; inventoryNo: string; name: string; nbv: number }[];
  mbp: { id: ID; number: string; name: string; qty: number; amount: number }[];
}
