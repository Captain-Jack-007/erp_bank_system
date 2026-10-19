import type { ModuleRoute } from '../../lib/routes';
import { DashboardPage } from './DashboardPage';
import { ReportingPage } from './ReportingPage';
import { ReportPage } from './ReportPage';

// Маршруты модуля «Отчётность и аналитика» (ТЗ 4.2.8).
export const routes: ModuleRoute[] = [
  { path: '/reporting', render: () => <ReportingPage /> },
  { path: '/reporting/dashboard', render: () => <DashboardPage /> },
  { path: '/reporting/:id', render: (p) => <ReportPage id={p.id!} /> },
];
