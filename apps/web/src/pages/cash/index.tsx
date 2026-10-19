import type { ModuleRoute } from '../../lib/routes';
import { CashPage } from './CashPage';
import { CashBranchPage } from './CashBranchPage';
import { NdoPage } from './NdoPage';

// Маршруты модуля «Касса и инкассация» (ТЗ 4.2.20).
export const routes: ModuleRoute[] = [
  { path: '/cash', render: () => <CashPage /> },
  { path: '/cash/ndo', render: () => <NdoPage /> },
  { path: '/cash/:id', render: (p) => <CashBranchPage id={p.id!} /> },
];
