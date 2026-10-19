import type { ModuleRoute } from '../../lib/routes';
import { IfrsPage } from './IfrsPage';

// Маршруты модуля «МСФО и дочерние предприятия» (ТЗ 4.2.18).
export const routes: ModuleRoute[] = [{ path: '/ifrs', render: () => <IfrsPage /> }];
