import type { ModuleRoute } from '../../lib/routes';
import { FleetHomePage } from './Home';
import { VehiclesPage } from './Vehicles';
import { VehicleDetailPage } from './VehicleDetail';
import { DriverDetailPage, DriversPage } from './Drivers';
import { TripDetailPage, TripsJournalPage } from './Trips';
import { ExpensesPage, ServiceDetailPage } from './Expenses';
import { CardsPage, TopUpDetailPage } from './Cards';
import { AssignmentDetailPage, AssignmentsPage } from './Assignments';
import { PostingsPage } from './Postings';
import { ReportsPage } from './Reports';
import { AlertsPage } from './Alerts';
import { MyFleetPage } from './My';

// Маршруты модуля «Автопарк» (ТЗ 4.2.6). Конкретные пути — раньше '/fleet/:id' (карточка ТС).
export const routes: ModuleRoute[] = [
  { path: '/fleet', render: () => <FleetHomePage /> },
  { path: '/fleet/vehicles', render: () => <VehiclesPage /> },
  { path: '/fleet/drivers', render: () => <DriversPage /> },
  { path: '/fleet/drivers/:id', render: (p) => <DriverDetailPage id={p.id!} /> },
  { path: '/fleet/trips', render: () => <TripsJournalPage /> },
  { path: '/fleet/trips/:id', render: (p) => <TripDetailPage id={p.id!} /> },
  { path: '/fleet/expenses', render: () => <ExpensesPage /> },
  { path: '/fleet/service/:id', render: (p) => <ServiceDetailPage id={p.id!} /> },
  { path: '/fleet/cards', render: () => <CardsPage /> },
  { path: '/fleet/topups/:id', render: (p) => <TopUpDetailPage id={p.id!} /> },
  { path: '/fleet/assignments', render: () => <AssignmentsPage /> },
  { path: '/fleet/assignments/:id', render: (p) => <AssignmentDetailPage id={p.id!} /> },
  { path: '/fleet/postings', render: () => <PostingsPage /> },
  { path: '/fleet/reports', render: () => <ReportsPage /> },
  { path: '/fleet/alerts', render: () => <AlertsPage /> },
  { path: '/fleet/my', render: () => <MyFleetPage /> },
  { path: '/fleet/:id', render: (p) => <VehicleDetailPage id={p.id!} /> },
];
