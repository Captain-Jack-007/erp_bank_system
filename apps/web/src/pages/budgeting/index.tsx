import type { ModuleRoute } from '../../lib/routes';
import { BudgetingPage } from './BudgetingPage';

// Маршруты модуля «Бюджетирование и мониторинг» (ТЗ 4.2.13).
export const routes: ModuleRoute[] = [
  { path: '/budgeting', render: () => <BudgetingPage /> },
  { path: '/budgeting/changes/:id', render: (p) => <BudgetingPage changeId={p.id!} /> },
  // P2-FINPLAN: ZBB-пакеты, заявки CAPEX, инвестпроекты, подтверждения превышения лимита (soft-check)
  { path: '/budgeting/zbb/:id', render: (p) => <BudgetingPage zbbId={p.id!} /> },
  { path: '/budgeting/capex/:id', render: (p) => <BudgetingPage capexId={p.id!} /> },
  { path: '/budgeting/projects/:id', render: (p) => <BudgetingPage projectId={p.id!} /> },
  { path: '/budgeting/control/:id', render: (p) => <BudgetingPage overrunId={p.id!} /> },
];
