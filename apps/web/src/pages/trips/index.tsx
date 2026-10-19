import type { ModuleRoute } from '../../lib/routes';
import { TripsPage } from './TripsPage';
import { TripDetailPage } from './TripDetail';
import { TripFormPage } from './TripForm';
import { TripNormsPage, TripReportsPage } from './TripsAdmin';

// Маршруты модуля «Командировки» (ТЗ 4.2.11).
export const routes: ModuleRoute[] = [
  { path: '/trips', render: () => <TripsPage /> },
  { path: '/trips/new', render: () => <TripFormPage /> },
  { path: '/trips/norms', render: () => <TripNormsPage /> },
  { path: '/trips/reports', render: () => <TripReportsPage /> },
  { path: '/trips/:id', render: (p) => <TripDetailPage id={p.id!} /> },
];
