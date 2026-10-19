import type { ModuleRoute } from '../../lib/routes';
import { AllocationPage } from './AllocationPage';

// Маршруты модуля «Аллокация» (ТЗ 4.2.14).
export const routes: ModuleRoute[] = [
  { path: '/allocation', render: () => <AllocationPage /> },
  { path: '/allocation/rules', render: () => <AllocationPage initialTab="rules" /> },
  { path: '/allocation/runs/:id', render: (p) => <AllocationPage initialTab="history" runId={p.id!} /> },
];
