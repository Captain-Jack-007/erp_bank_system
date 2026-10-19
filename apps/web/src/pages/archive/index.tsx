import type { ModuleRoute } from '../../lib/routes';
import { ArchivePage } from './ArchivePage';
import { ArchiveActPage, ArchiveCasePage, ArchiveDocPage } from './ArchiveDetails';

// Маршруты модуля «Архив» (ТЗ 4.2.10). Ссылки глобального поиска ведут на карточку дела / документа.
export const routes: ModuleRoute[] = [
  { path: '/archive', render: () => <ArchivePage /> },
  { path: '/archive/acts/:id', render: (p) => <ArchiveActPage id={p.id!} /> },
  { path: '/archive/docs/:id', render: (p) => <ArchiveDocPage id={p.id!} /> },
  { path: '/archive/:id', render: (p) => <ArchiveCasePage id={p.id!} /> },
];
