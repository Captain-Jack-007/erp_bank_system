import type { ModuleRoute } from '../../lib/routes';
import { WarehousePage } from './WarehousePage';
import { CardDetailPage } from './whCards';
import { ReceiptDetailPage, ReceiptFormPage } from './whReceipts';
import { IssueDetailPage, IssueFormPage } from './whIssues';
import { WriteoffDetailPage, WriteoffFormPage } from './whWriteoffs';
import { InventoryDetailPage } from './whInventory';

// Маршруты модуля «Склад» (ТЗ 4.2.4, 4.2.4.4). Порядок: '/x/new' раньше '/x/:id'.
export const routes: ModuleRoute[] = [
  { path: '/warehouse', render: () => <WarehousePage /> },
  { path: '/warehouse/dashboard', render: () => <WarehousePage tab="dashboard" /> },
  { path: '/warehouse/movements', render: () => <WarehousePage tab="movements" /> },
  { path: '/warehouse/locations', render: () => <WarehousePage tab="locations" /> },
  { path: '/warehouse/cards', render: () => <WarehousePage tab="cards" /> },
  { path: '/warehouse/cards/:id', render: (p) => <CardDetailPage id={p.id!} /> },
  { path: '/warehouse/receipts', render: () => <WarehousePage tab="receipts" /> },
  { path: '/warehouse/receipts/new', render: () => <ReceiptFormPage /> },
  { path: '/warehouse/receipts/:id/edit', render: (p) => <ReceiptFormPage id={p.id!} /> },
  { path: '/warehouse/receipts/:id', render: (p) => <ReceiptDetailPage id={p.id!} /> },
  { path: '/warehouse/issues', render: () => <WarehousePage tab="issues" /> },
  { path: '/warehouse/issues/new', render: () => <IssueFormPage /> },
  { path: '/warehouse/issues/:id', render: (p) => <IssueDetailPage id={p.id!} /> },
  { path: '/warehouse/writeoffs', render: () => <WarehousePage tab="writeoffs" /> },
  { path: '/warehouse/writeoffs/new', render: () => <WriteoffFormPage /> },
  { path: '/warehouse/writeoffs/:id', render: (p) => <WriteoffDetailPage id={p.id!} /> },
  { path: '/warehouse/batches', render: () => <WarehousePage tab="batches" /> },
  { path: '/warehouse/inventory', render: () => <WarehousePage tab="inventory" /> },
  { path: '/warehouse/inventory/:id', render: (p) => <InventoryDetailPage id={p.id!} /> },
  { path: '/warehouse/mbp', render: () => <WarehousePage tab="mbp" /> },
  { path: '/warehouse/postings', render: () => <WarehousePage tab="postings" /> },
  { path: '/warehouse/monitoring', render: () => <WarehousePage tab="monitoring" /> },
  { path: '/warehouse/reports', render: () => <WarehousePage tab="reports" /> },
  { path: '/warehouse/settings', render: () => <WarehousePage tab="settings" /> },
];
