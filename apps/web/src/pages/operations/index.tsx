import type { ModuleRoute } from '../../lib/routes';
import { OperationsPage } from './OperationsPage';

// Маршруты модуля «Анализ операций» (ТЗ 4.2.16).
export const routes: ModuleRoute[] = [{ path: '/operations', render: () => <OperationsPage /> }];
