// Маршруты модуля «Учёт договоров» (ТЗ 4.2.2). Конкретные пути — раньше '/contracts/:id'.
import type { ModuleRoute } from '../../lib/routes';
import { EditGate } from '../procurement/shared';
import { ContractsPage } from './ContractsPage';
import { ContractFormPage } from './ContractForm';
import { ContractDetailPage } from './ContractDetail';
import { PaymentOrderDetailPage } from './PaymentsViews';

export const routes: ModuleRoute[] = [
  { path: '/contracts', render: () => <ContractsPage /> },
  { path: '/contracts/new', render: () => <EditGate moduleId="contracts"><ContractFormPage /></EditGate> },
  { path: '/contracts/payments/:id', render: (p) => <PaymentOrderDetailPage id={p.id!} /> },
  { path: '/contracts/:id', render: (p) => <ContractDetailPage id={p.id!} /> },
];
