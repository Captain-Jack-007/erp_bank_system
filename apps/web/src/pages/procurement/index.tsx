// Маршруты модуля «Закупки и тендеры» (ТЗ 4.2.1). Порядок важен: конкретные пути раньше '/procurement/:id'.
import type { ModuleRoute } from '../../lib/routes';
import { EditGate } from './shared';
import { ProcurementPage } from './ProcurementPage';
import { ProcurementFormPage } from './ProcurementForm';
import { ProcurementDetailPage } from './ProcurementDetail';
import { AcceptanceDetailPage } from './AcceptanceDetail';
import { ActDetailPage } from './ActDetail';
import { SupplierDetailPage } from './SuppliersTab';
import { ConsolidationDetailPage } from './ConsolidationTab';

export const routes: ModuleRoute[] = [
  { path: '/procurement', render: () => <ProcurementPage /> },
  { path: '/procurement/new', render: () => <EditGate moduleId="procurement"><ProcurementFormPage /></EditGate> },
  { path: '/procurement/acceptance/:id', render: (p) => <AcceptanceDetailPage id={p.id!} /> },
  { path: '/procurement/acts/:id', render: (p) => <ActDetailPage id={p.id!} /> },
  { path: '/procurement/suppliers/:id', render: (p) => <SupplierDetailPage id={p.id!} /> },
  { path: '/procurement/consolidation/:id', render: (p) => <ConsolidationDetailPage id={p.id!} /> },
  { path: '/procurement/:id', render: (p) => <ProcurementDetailPage id={p.id!} /> },
];
