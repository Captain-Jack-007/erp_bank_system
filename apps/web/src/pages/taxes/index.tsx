import type { ModuleRoute } from '../../lib/routes';
import { TaxesPage } from './TaxesPage';
import { TaxReturnPage } from './TaxReturnPage';
import { TaxRegistersPage } from './TaxRegistersPage';
import { TaxProfitPage } from './TaxProfitPage';
import { TaxControlPage } from './TaxControlPage';

// Маршруты модуля «Налоги и налогообложение» (ТЗ 4.2.17).
export const routes: ModuleRoute[] = [
  { path: '/taxes', render: () => <TaxesPage /> },
  { path: '/taxes/registers', render: () => <TaxRegistersPage /> },
  { path: '/taxes/profit', render: () => <TaxProfitPage /> },
  { path: '/taxes/control', render: () => <TaxControlPage /> },
  { path: '/taxes/:id', render: (p) => <TaxReturnPage id={p.id!} /> },
];
