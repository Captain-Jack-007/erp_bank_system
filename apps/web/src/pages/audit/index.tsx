import type { ModuleRoute } from '../../lib/routes';
import { AuditPage } from './AuditPage';

export const routes: ModuleRoute[] = [{ path: '/audit', render: () => <AuditPage /> }];
