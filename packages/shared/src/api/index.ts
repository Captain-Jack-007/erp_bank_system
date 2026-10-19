import { createMockApi } from './mock';
import type { Api } from './types';

export * from './types';
export { createMockApi } from './mock';
export { ROUTES } from '../engine';
// P2-PROC: расширенные закупки, договоры, заявки на обеспечение
export * from './procTypes';
export { procApi, procRouteContext, recommendMethod, processPlan, supplierRating, supplierAdmission, acceptanceDiscrepancies, actCheck, type ProcDraft, type SupplierRating } from './procurementExt';
export { contractsApi, CONTRACT_KINDS, CONTRACT_SUBKINDS, generateSchedule, penaltyFor, contractBalance, classify as reserveClassify, type ManualContractInput, type OrderInput } from './contractsExt';
export { supplyApi, SUPPLY_TYPES, isSupplyType, type SupplyRequestInput } from './supplyExt';
export { ProcError } from './procCommon';

// Единая точка доступа к данным. Когда появится бэкенд — заменить на createHttpApi(baseUrl).
export const api: Api = createMockApi();
