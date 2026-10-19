export * from './types';
export * from './format';
export * from './i18n';
export * from './api';
export * as mockData from './mock/data';
export * from './bus';
export { approvalEngine, type ApprovalHandler, type OpenTaskInput } from './engine';
export { defineDict } from './dict';
export * from './modules';
export * from './search';
// P1-FLOW: движок согласований v2, справочник пользователей для сервисов, центр уведомлений
export {
  approvalsApi, ApprovalError, APPROVAL_ENTITIES, ROUTE_RATES, conditionMatches,
  type ApprovalTaskV2, type ApproverSpec, type ApproverKind, type RouteCondition, type FieldCondition, type ConditionOp,
  type RouteStepTemplate, type RouteTemplate, type RouteTemplateVersion, type Committee, type CommitteeId, type BulkPolicy,
  type Delegation, type RouteContext, type ResolvedApprover, type StepState, type StepDecision, type ResolvedStep,
  type RouteInstance, type RouteEvent, type RouteEventAction, type RoutePreview, type RoutePreviewStep, type RouteView,
  type InboxBox, type InboxItem, type InboxFilter,
} from './engine';
export { directory, setDirectory, type DirectorySource } from './directory';
export * from './notifications';
export * from './audit';
export * from './security';
export * from './accessGovernance'; // P3-GEN
export * from './monitoring'; // P3-GEN
export * from './serviceAccounts'; // P3-GEN
export * from './dlp'; // P3-GEN
export * from './org';
// P1-SVC: документные сервисы (XLSX/CSV, импорт, QR, печать, файлы, E-IMZO, интеграционная шина)
export * from './services';
// P4-GEN: справка, конструктор интеграций, AD/LDAP, регламентные окна и Service Desk
export * from './p4gen';
export * from './errors'; // P4-SEC: коды ошибок API (PR-TEC-008)
export * from './auditRetention'; // P4-SEC: архивирование/уничтожение журнала аудита (PR-SEC-021)
export * from './privacy'; // P4-SEC: реестр ПДн, обезличивание по сроку, маскирование (PR-SEC-049)
