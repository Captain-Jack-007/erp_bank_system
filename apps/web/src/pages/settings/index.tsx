import type { ModuleRoute } from '../../lib/routes';
import { UsersPage } from './UsersPage';
import { RolesPage } from './RolesPage';
import { SecurityPage } from './SecurityPage';

// Администрирование (P1-ORG): пользователи, роли и права, политика безопасности.
export const usersRoutes: ModuleRoute[] = [{ path: '/settings/users', render: () => <UsersPage /> }];
export const rolesRoutes: ModuleRoute[] = [{ path: '/settings/roles', render: () => <RolesPage /> }];
export const securityRoutes: ModuleRoute[] = [{ path: '/settings/security', render: () => <SecurityPage /> }];
