// Маршруты модуля «Заявки сотрудников» (ТЗ 4.2.7).
import type { ModuleRoute } from '../../lib/routes';
import { EditGate } from '../procurement/shared';
import { EmployeeRequestsPage } from './EmployeeRequestsPage';
import { RequestFormPage } from './RequestForm';
import { RequestDetailPage } from './RequestDetail';

export const routes: ModuleRoute[] = [
  { path: '/requests', render: () => <EmployeeRequestsPage /> },
  { path: '/requests/new', render: () => <EditGate moduleId="requests"><RequestFormPage /></EditGate> },
  { path: '/requests/:id', render: (p) => <RequestDetailPage id={p.id!} /> },
];
