import type { ModuleRoute } from '../../lib/routes';
import { TerminalsPage } from './TerminalsPage';
import { TerminalDetailPage } from './TerminalDetail';

// Маршруты модуля «Терминалы» (ТЗ 4.2.19).
export const routes: ModuleRoute[] = [
  { path: '/terminals', render: () => <TerminalsPage /> },
  { path: '/terminals/:id', render: (p) => <TerminalDetailPage id={p.id!} /> },
];
