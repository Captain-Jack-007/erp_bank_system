// P2-PROC: общее in-memory хранилище ядра (закупки, договоры, заявки) и расширенных сущностей.
// Ядро (mock.ts) создаёт таблицы и передаёт их сюда; procurementExt/contractsExt/supplyExt работают с ними напрямую.
import { clone } from '../bus';
import type { BudgetLine, Contract, Counterparty, Department, EmployeeRequest, ID, ProcurementRequest, Tender, User } from '../types';
import type {
  ContractAccount, ContractKindSetting, ContractReportForm, ContractTemplate, PaymentOrder, PlatformContract, ProcAcceptance,
  ProcBusinessGroup, ProcCatalogItem, ProcClaim, ProcConsolidation, ProcPosting, ProcWorkAct, SupplierCheckResult, SupplierListEntry,
} from './procTypes';
import {
  contractAccountsSeed, contractKindSettingsSeed, contractTemplatesSeed, platformContractsSeed, procAcceptancesSeed, procBusinessGroupsSeed,
  procCatalogSeed, procClaimsSeed, procConsolidationsSeed, procWorkActsSeed, supplierListsSeed,
} from './procData';

export interface CoreTables {
  users: User[];
  departments: Department[];
  counterparties: Counterparty[];
  budgetLines: BudgetLine[];
  procurement: ProcurementRequest[];
  tenders: Tender[];
  contracts: Contract[];
  employeeRequests: EmployeeRequest[];
}

export interface ProcTables {
  catalog: ProcCatalogItem[];
  groups: ProcBusinessGroup[];
  lists: SupplierListEntry[];
  checks: SupplierCheckResult[];
  consolidations: ProcConsolidation[];
  acceptances: ProcAcceptance[];
  claims: ProcClaim[];
  acts: ProcWorkAct[];
  postings: ProcPosting[];
  platform: PlatformContract[];
  accounts: ContractAccount[];
  kindSettings: ContractKindSetting[];
  templates: ContractTemplate[];
  orders: PaymentOrder[];
  reportForms: ContractReportForm[];
  /** Отделы-инициаторы договоров (справочник PR-CON-037). */
  initiatorDepts: ID[];
  /** Котировки биржи по позициям номенклатуры (PR-PROC-030). */
  quotes: { catalogId: ID; min: number; avg: number; max: number; deals: number; at: string }[];
  /** Резервирование остатков склада под заявки на обеспечение: requestId → itemId → qty. */
  reservations: { requestId: ID; itemId: ID; qty: number }[];
  /** Бюджетный год контрольной даты табло «не оплачено к 25-му». */
  boardDay: number;
}

let core: CoreTables | null = null;
let ext: ProcTables | null = null;

export function setCoreTables(t: CoreTables): void {
  core = t;
  ext = {
    catalog: clone(procCatalogSeed),
    groups: clone(procBusinessGroupsSeed),
    lists: clone(supplierListsSeed),
    checks: [],
    consolidations: clone(procConsolidationsSeed),
    acceptances: clone(procAcceptancesSeed),
    claims: clone(procClaimsSeed),
    acts: clone(procWorkActsSeed),
    postings: [],
    platform: clone(platformContractsSeed),
    accounts: clone(contractAccountsSeed),
    kindSettings: clone(contractKindSettingsSeed),
    templates: clone(contractTemplatesSeed),
    orders: [],
    reportForms: [],
    initiatorDepts: ['d1', 'd2', 'd3', 'd4', 'd8', 'd9', 'd10'],
    quotes: [],
    reservations: [],
    boardDay: 25,
  };
}

export function coreTables(): CoreTables {
  if (!core) throw new Error('Core store is not initialised');
  return core;
}

export function procTables(): ProcTables {
  if (!ext) throw new Error('Procurement store is not initialised');
  return ext;
}
