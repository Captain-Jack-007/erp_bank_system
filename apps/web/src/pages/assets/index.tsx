import type { ModuleRoute } from '../../lib/routes';
import { AssetsPage } from './AssetsPage';
import { AssetDetailPage } from './AssetDetail';
import { OperationDetailPage, WriteoffActPage } from './asOps';
import { AssetInventoryPage } from './asInventory';

// Маршруты модуля «Основные средства» (ТЗ 4.2.5). Именованные разделы — раньше '/assets/:id'.
export const routes: ModuleRoute[] = [
  { path: '/assets', render: () => <AssetsPage /> },
  { path: '/assets/dashboard', render: () => <AssetsPage tab="dashboard" /> },
  { path: '/assets/operations', render: () => <AssetsPage tab="operations" /> },
  { path: '/assets/operations/:id', render: (p) => <OperationDetailPage id={p.id!} /> },
  { path: '/assets/writeoffs', render: () => <AssetsPage tab="writeoffs" /> },
  { path: '/assets/writeoffs/:id', render: (p) => <WriteoffActPage id={p.id!} /> },
  { path: '/assets/depreciation', render: () => <AssetsPage tab="depreciation" /> },
  { path: '/assets/inventory', render: () => <AssetsPage tab="inventory" /> },
  { path: '/assets/inventory/:id', render: (p) => <AssetInventoryPage id={p.id!} /> },
  { path: '/assets/monitoring', render: () => <AssetsPage tab="monitoring" /> },
  { path: '/assets/reports', render: () => <AssetsPage tab="reports" /> },
  { path: '/assets/settings', render: () => <AssetsPage tab="settings" /> },
  { path: '/assets/:id', render: (p) => <AssetDetailPage id={p.id!} /> },
];
