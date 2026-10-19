import { registerModuleAccess } from '@xb/shared';
import type { ModuleRoute } from '../../lib/routes';
import { MonitoringPage } from './MonitoringPage';

// P3-GEN: мониторинг и диагностика — техподдержка и аудитор (просмотр), администратор (полный доступ).
registerModuleAccess('monitoring', { support: 'view', auditor: 'view' });

export const routes: ModuleRoute[] = [{ path: '/monitoring', render: () => <MonitoringPage /> }];
