// Демо-данные модуля «Анализ операций» — детерминированно сгенерированный журнал работы системы
// за апрель–сентябрь 2026 г. (вымышленный).
import { ROUTES } from '../../engine';
import type { ApprovalEntity, Role } from '../../types';
import type { OperationsApprovalLog, OperationsModuleInfo, OperationsMonthly, OperationsUserActivity } from './types';

export const OPERATIONS_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

export const OPERATIONS_MODULES: OperationsModuleInfo[] = [
  { key: 'procurement', name: { ru: 'Закупки', uz: 'Xaridlar', en: 'Procurement' }, entity: 'procurement' },
  { key: 'contracts', name: { ru: 'Договоры', uz: 'Shartnomalar', en: 'Contracts' }, entity: 'contract' },
  { key: 'requests', name: { ru: 'Заявки сотрудников', uz: 'Xodimlar arizalari', en: 'Employee requests' }, entity: 'employee_request' },
  { key: 'einvoices', name: { ru: 'Счета-фактуры', uz: 'Hisob-fakturalar', en: 'E-invoices' }, entity: 'einvoice' },
  { key: 'warehouse', name: { ru: 'Склад', uz: 'Ombor', en: 'Warehouse' } },
  { key: 'assets', name: { ru: 'Основные средства', uz: 'Asosiy vositalar', en: 'Fixed assets' }, entity: 'asset_writeoff' },
  { key: 'fleet', name: { ru: 'Автопарк', uz: 'Avtopark', en: 'Vehicle fleet' } },
  { key: 'documents', name: { ru: 'Документооборот', uz: 'Hujjat aylanishi', en: 'Document management' }, entity: 'document' },
  { key: 'trips', name: { ru: 'Командировки', uz: 'Xizmat safarlari', en: 'Business trips' }, entity: 'business_trip' },
  { key: 'budgeting', name: { ru: 'Бюджетирование', uz: 'Byudjetlashtirish', en: 'Budgeting' }, entity: 'budget_change' },
  { key: 'cash', name: { ru: 'Касса и инкассация', uz: 'Kassa va inkassatsiya', en: 'Cash & collection' } },
];

/** Нормативный срок этапа согласования по роли, часов. */
export const OPERATIONS_SLA: Record<Role, number> = {
  employee: 24,
  dept_head: 24,
  procurement: 48,
  finance: 48,
  legal: 72,
  accountant: 24,
  treasury: 8,
  admin: 24,
  // роли платформы (P1-ORG): норматив по умолчанию
  data_entry: 24, approver: 24, analyst: 48, cash_operator: 8, hr: 48, storekeeper: 24, driver: 24, archivist: 48, tax_officer: 48, support: 24, auditor: 72,
};

// Генератор псевдослучайных чисел с фиксированным зерном — данные одинаковы при каждом запуске.
let seed = 20261018;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!;

const BASE: Record<string, number> = {
  procurement: 140, contracts: 95, requests: 620, einvoices: 1450, warehouse: 880, assets: 210,
  fleet: 330, documents: 2400, trips: 260, budgeting: 70, cash: 540,
};

export const operationsMonthlySeed: OperationsMonthly[] = OPERATIONS_MONTHS.flatMap((month, mi) =>
  OPERATIONS_MODULES.map((m) => {
    const growth = 1 + mi * 0.045;
    const created = Math.round(BASE[m.key]! * growth * (0.9 + rand() * 0.2));
    const closed = Math.round(created * (0.9 + rand() * 0.11));
    return { month, module: m.key, created, closed };
  }),
);

const ENTITY_WEIGHTS: [ApprovalEntity, number][] = [
  ['procurement', 14], ['contract', 9], ['employee_request', 20], ['business_trip', 12],
  ['einvoice', 22], ['budget_change', 5], ['document', 14], ['asset_writeoff', 4],
];
const ROLE_SPEED: Record<Role, number> = { employee: 10, dept_head: 14, procurement: 30, finance: 41, legal: 58, accountant: 16, treasury: 5, admin: 8, data_entry: 12, approver: 14, analyst: 30, cash_operator: 5, hr: 30, storekeeper: 12, driver: 10, archivist: 30, tax_officer: 30, support: 10, auditor: 40 };
const DEPTS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10'];

function weightedEntity(): ApprovalEntity {
  const total = ENTITY_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [e, w] of ENTITY_WEIGHTS) {
    r -= w;
    if (r <= 0) return e;
  }
  return 'document';
}

export const operationsLogSeed: OperationsApprovalLog[] = Array.from({ length: 520 }, (_, i) => {
  const entity = weightedEntity();
  const route = ROUTES[entity];
  const step = 1 + Math.floor(rand() * route.length);
  const role = route[step - 1]!;
  const monthIdx = Math.floor(rand() * OPERATIONS_MONTHS.length);
  const day = 1 + Math.floor(rand() * 27);
  const hour = 8 + Math.floor(rand() * 9);
  const started = new Date(`${OPERATIONS_MONTHS[monthIdx]}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`);
  // длительность: экспоненциальное распределение вокруг средней скорости роли, с хвостом
  const hours = Math.max(0.5, -Math.log(1 - rand() * 0.98) * ROLE_SPEED[role]);
  return {
    id: `ol${i + 1}`,
    entity,
    step,
    role,
    departmentId: pick(DEPTS),
    startedAt: started.toISOString(),
    finishedAt: new Date(started.getTime() + hours * 3_600_000).toISOString(),
    decision: rand() < 0.92 ? 'approved' : 'rejected',
  };
});

const DEPT_SIZE: Record<string, number> = { d1: 46, d2: 38, d3: 31, d4: 12, d5: 18, d6: 22, d7: 27, d8: 15, d9: 140, d10: 85 };

export const operationsActivitySeed: OperationsUserActivity[] = OPERATIONS_MONTHS.flatMap((month, mi) =>
  DEPTS.map((departmentId) => {
    const size = DEPT_SIZE[departmentId]!;
    const activeUsers = Math.round(size * (0.62 + mi * 0.05 + rand() * 0.08));
    return { month, departmentId, activeUsers: Math.min(size, activeUsers), actions: Math.round(activeUsers * (95 + rand() * 60)) };
  }),
);
