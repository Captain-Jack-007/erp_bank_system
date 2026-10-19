import type { ModuleRoute } from '../../lib/routes';
import { DocumentsPage } from './DocumentsPage';
import { DocumentDetailPage } from './DocumentDetail';
import { DocumentFormPage } from './DocumentForm';
import { AurPage, DisciplinePage } from './DocumentsReports';

// Маршруты модуля «Документооборот» (ТЗ 4.2.9).
export const routes: ModuleRoute[] = [
  { path: '/documents', render: () => <DocumentsPage /> },
  { path: '/documents/new', render: () => <DocumentFormPage /> },
  { path: '/documents/aur', render: () => <AurPage /> },
  { path: '/documents/discipline', render: () => <DisciplinePage /> },
  { path: '/documents/:id', render: (p) => <DocumentDetailPage id={p.id!} /> },
];
