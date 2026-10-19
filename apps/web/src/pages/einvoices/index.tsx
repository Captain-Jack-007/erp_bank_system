import type { ModuleRoute } from '../../lib/routes';
import { EinvoicesPage } from './EinvoicesPage';
import { EinvoiceDetailPage } from './EinvoiceDetail';
import { EinvoiceFormPage } from './EinvoiceForm';
import { EinvoiceReportsPage } from './EinvoiceReports';

// Маршруты модуля «Электронные счета-фактуры» (ТЗ 4.2.3).
export const routes: ModuleRoute[] = [
  { path: '/einvoices', render: () => <EinvoicesPage /> },
  { path: '/einvoices/new', render: () => <EinvoiceFormPage /> },
  { path: '/einvoices/reports', render: () => <EinvoiceReportsPage /> },
  { path: '/einvoices/:id', render: (p) => <EinvoiceDetailPage id={p.id!} /> },
];
