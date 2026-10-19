import type { ModuleRoute } from '../../lib/routes';
import { MasterDataPage } from './MasterDataPage';
import { CostCenterDetailPage, OrgUnitDetailPage } from './Details';
import { ChangeDetailPage } from './Changes';

// Справочники MDM (ТЗ 4.2.12): реестр с вкладками, карточки оргединицы и МВЗ.
export const routes: ModuleRoute[] = [
  { path: '/master-data', render: () => <MasterDataPage /> },
  { path: '/master-data/org/:id', render: (p) => <OrgUnitDetailPage id={p.id!} /> },
  { path: '/master-data/cc/:id', render: (p) => <CostCenterDetailPage id={p.id!} /> },
  { path: '/master-data/changes/:id', render: (p) => <ChangeDetailPage id={p.id!} /> },
];
