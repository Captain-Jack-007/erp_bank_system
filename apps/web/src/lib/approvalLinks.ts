import type { ApprovalEntity } from '@xb/shared';

/** Куда ведёт задача согласования для каждого типа документа. */
export const APPROVAL_LINKS: Record<ApprovalEntity, (id: string) => string> = {
  procurement: (id) => `/procurement/${id}`,
  contract: (id) => `/contracts/${id}`,
  employee_request: (id) => `/requests/${id}`, // P2-PROC: карточка заявки на обеспечение
  business_trip: (id) => `/trips/${id.split(':')[0]}`, // P2-DOCS: авансовый отчёт — `${tripId}:report`
  einvoice: (id) => `/einvoices/${id}`,
  budget_change: (id) => `/budgeting/changes/${id}`,
  document: (id) => `/documents/${id}`,
  asset_writeoff: (id) => (id.startsWith('wo') ? `/assets/writeoffs/${id}` : `/assets/${id}`), // P2-WMS: акт ОС-4 (wo…)
  // платёж по договору: entityId = `${contractId}:${index}`
  payment: (id) => `/contracts/${id.split(':')[0]}`,
  // P2-PROC: акт выполненных работ
  work_act: (id) => `/procurement/acts/${id}`,
  // P2-DOCS: оплата по документу СЭД (`${documentId}:pay`) и акты архива
  doc_payment: (id) => `/documents/${id.split(':')[0]}`,
  archive_act: (id) => `/archive/acts/${id}`,
  // P2-WMS: склад (заявка на выдачу, акт списания ТМЗ/МБП) и ОС (акт списания ОС-4, передача)
  warehouse_issue: (id) => `/warehouse/issues/${id}`,
  warehouse_writeoff: (id) => `/warehouse/writeoffs/${id}`,
  asset_transfer: (id) => `/assets/operations/${id}`,
  // P2-FINPLAN: бюджет — ZBB-пакет, подтверждение превышения лимита (soft-check), заявка CAPEX/инвестиций
  budget_zbb: (id) => `/budgeting/zbb/${id}`,
  budget_overrun: (id) => `/budgeting/control/${id}`,
  capex_request: (id) => `/budgeting/capex/${id}`,
  // P2-FLT: автопарк — путевой лист, распоряжение о закреплении ТС, зачисление на топливные карты
  fleet_trip: (id) => `/fleet/trips/${id}`,
  fleet_assignment: (id) => `/fleet/assignments/${id}`,
  fleet_topup: (id) => `/fleet/topups/${id}`,
  // P2-FINREP: НДО — правило аллокации и закрытие периода
  cash_rule: () => '/cash/ndo?tab=alloc',
  cash_close: () => '/cash/ndo?tab=close',
  // P4-GEN: регламентное технологическое окно
  maintenance_window: (id) => `/maintenance?id=${id}`,
  audit_retention: () => '/audit?tab=retention', // P4-SEC
  pd_anonymize: () => '/privacy?tab=due', // P4-SEC
  mdm_change: (id) => `/master-data/changes/${id}`, // P4 (PR-MDM-003): заявка на изменение справочника
};
