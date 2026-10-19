// Реестр модулей платформы: меню, маршруты, ссылки из согласований.
// Новый модуль = папка pages/<id>/ с export const routes + одна запись здесь.
import type { Localized, TKey } from '@xb/shared';
import type { IconName } from './components/icons';
import type { ModuleRoute } from './lib/routes';
import { DashboardPage } from './pages/Dashboard';
import { ApprovalsPage } from './pages/Approvals';
import { DeputiesPage } from './pages/approvals/Deputies';
import { NotificationsPage } from './pages/notifications/NotificationsPage';
import { RouteDesignerPage } from './pages/settings/routes/RouteDesigner';
// P2-PROC: закупки, договоры и заявки на обеспечение — маршруты в своих модулях
import { routes as procurement } from './pages/procurement';
import { routes as contracts } from './pages/contracts';
import { routes as requests } from './pages/requests';
import { routes as warehouse } from './pages/warehouse';
import { routes as assets } from './pages/assets';
import { routes as fleet } from './pages/fleet';
import { routes as terminals } from './pages/terminals';
import { routes as cash } from './pages/cash';
import { routes as einvoices } from './pages/einvoices';
import { routes as documents } from './pages/documents';
import { routes as archive } from './pages/archive';
import { routes as trips } from './pages/trips';
import { routes as budgeting } from './pages/budgeting';
import { routes as allocation } from './pages/allocation';
import { routes as ftp } from './pages/ftp';
import { routes as taxes } from './pages/taxes';
import { routes as ifrs } from './pages/ifrs';
import { routes as operations } from './pages/operations';
import { routes as reporting } from './pages/reporting';
import { routes as ai } from './pages/ai';
import { routes as masterData } from './pages/masterdata';
import { usersRoutes, rolesRoutes, securityRoutes } from './pages/settings';
import { routes as auditRoutes } from './pages/audit';
import { routes as privacyRoutes } from './pages/privacy'; // P4-SEC
import { routes as integrationsRoutes } from './pages/integrations';
import { routes as importRoutes } from './pages/import';
import { routes as printRoutes } from './pages/print';
import { routes as monitoringRoutes } from './pages/monitoring'; // P3-GEN
// P4-GEN: справка пользователя, Service Desk, регламентные работы и аварийный режим
import { routes as helpRoutes } from './pages/help';
import { routes as serviceDeskRoutes } from './pages/servicedesk';
import { routes as maintenanceRoutes } from './pages/maintenance';

export type NavGroup = 'core' | 'procurement' | 'operations' | 'documents' | 'finance' | 'analytics' | 'settings';
export const NAV_GROUPS: NavGroup[] = ['core', 'procurement', 'operations', 'documents', 'finance', 'analytics', 'settings'];

export interface ModuleDef {
  id: string;
  path: string;
  name: Localized | TKey;
  icon: IconName;
  tz?: string;
  group: NavGroup;
  routes: ModuleRoute[];
}

export const MODULES: ModuleDef[] = [
  { id: 'dashboard', path: '/', name: 'navDashboard', icon: 'home', group: 'core', routes: [{ path: '/', render: () => <DashboardPage /> }] },
  {
    id: 'approvals', path: '/approvals', name: 'navApprovals', icon: 'check', group: 'core',
    routes: [
      { path: '/approvals', render: () => <ApprovalsPage /> },
      { path: '/approvals/deputies', render: () => <DeputiesPage /> },
    ],
  },
  { id: 'notifications', path: '/notifications', name: 'flow_nav_notifications', icon: 'bell', group: 'core', routes: [{ path: '/notifications', render: () => <NotificationsPage /> }] },
  { id: 'ai', path: '/ai', name: { ru: 'ИИ-ассистент', uz: 'AI yordamchi', en: 'AI assistant' }, icon: 'sparkles', tz: '5.3', group: 'core', routes: ai },
  { id: 'master-data', path: '/master-data', name: 'navMasterData', icon: 'book', tz: '4.2.12', group: 'core', routes: masterData },

  {
    id: 'procurement', path: '/procurement', name: 'navProcurement', icon: 'cart', tz: '4.2.1', group: 'procurement',
    routes: procurement,
  },
  {
    id: 'contracts', path: '/contracts', name: 'navContracts', icon: 'file', tz: '4.2.2', group: 'procurement',
    routes: contracts,
  },
  { id: 'einvoices', path: '/einvoices', name: { ru: 'Счета-фактуры', uz: 'Hisob-fakturalar', en: 'E-invoices' }, icon: 'receipt', tz: '4.2.3', group: 'procurement', routes: einvoices },

  { id: 'warehouse', path: '/warehouse', name: { ru: 'Склад', uz: 'Ombor', en: 'Warehouse' }, icon: 'box', tz: '4.2.4', group: 'operations', routes: warehouse },
  { id: 'assets', path: '/assets', name: { ru: 'Основные средства', uz: 'Asosiy vositalar', en: 'Fixed assets' }, icon: 'building', tz: '4.2.5', group: 'operations', routes: assets },
  { id: 'fleet', path: '/fleet', name: { ru: 'Автопарк', uz: 'Avtopark', en: 'Vehicle fleet' }, icon: 'car', tz: '4.2.6', group: 'operations', routes: fleet },
  { id: 'terminals', path: '/terminals', name: { ru: 'Терминалы', uz: 'Terminallar', en: 'Terminals' }, icon: 'terminal', tz: '4.2.19', group: 'operations', routes: terminals },
  { id: 'cash', path: '/cash', name: { ru: 'Касса и инкассация', uz: 'Kassa va inkassatsiya', en: 'Cash & collection' }, icon: 'coins', tz: '4.2.20', group: 'operations', routes: cash },

  { id: 'documents', path: '/documents', name: { ru: 'Документооборот', uz: 'Hujjat aylanishi', en: 'Document management' }, icon: 'file', tz: '4.2.9', group: 'documents', routes: documents },
  { id: 'archive', path: '/archive', name: { ru: 'Архив', uz: 'Arxiv', en: 'Archive' }, icon: 'archive', tz: '4.2.10', group: 'documents', routes: archive },
  { id: 'requests', path: '/requests', name: 'navRequests', icon: 'inbox', tz: '4.2.7', group: 'documents', routes: requests },
  { id: 'trips', path: '/trips', name: { ru: 'Командировки', uz: 'Xizmat safarlari', en: 'Business trips' }, icon: 'plane', tz: '4.2.11', group: 'documents', routes: trips },

  { id: 'budgeting', path: '/budgeting', name: { ru: 'Бюджетирование', uz: 'Byudjetlashtirish', en: 'Budgeting' }, icon: 'wallet', tz: '4.2.13', group: 'finance', routes: budgeting },
  { id: 'allocation', path: '/allocation', name: { ru: 'Аллокация', uz: 'Allokatsiya', en: 'Cost allocation' }, icon: 'pie', tz: '4.2.14', group: 'finance', routes: allocation },
  { id: 'ftp', path: '/ftp', name: { ru: 'Трансфертное ценообразование', uz: 'Transfer narxlash (FTP)', en: 'Transfer pricing (FTP)' }, icon: 'percent', tz: '4.2.15', group: 'finance', routes: ftp },
  { id: 'taxes', path: '/taxes', name: { ru: 'Налоги', uz: 'Soliqlar', en: 'Taxes' }, icon: 'receipt', tz: '4.2.17', group: 'finance', routes: taxes },
  { id: 'ifrs', path: '/ifrs', name: { ru: 'МСФО и дочерние', uz: "MHXS va sho'ba korxonalar", en: 'IFRS & subsidiaries' }, icon: 'globe', tz: '4.2.18', group: 'finance', routes: ifrs },

  { id: 'reporting', path: '/reporting', name: { ru: 'Отчётность и аналитика', uz: 'Hisobot va tahlil', en: 'Reporting & analytics' }, icon: 'chart', tz: '4.2.8', group: 'analytics', routes: reporting },
  { id: 'operations', path: '/operations', name: { ru: 'Анализ операций', uz: 'Operatsiyalar tahlili', en: 'Operations analysis' }, icon: 'chart', tz: '4.2.16', group: 'analytics', routes: operations },

  // Администрирование (P1-ORG): пользователи, роли и права (RBAC), политика безопасности, журнал аудита
  { id: 'users', path: '/settings/users', name: 'navUsers', icon: 'users', tz: 'PR-GEN-036', group: 'settings', routes: usersRoutes },
  { id: 'roles', path: '/settings/roles', name: 'navRoles', icon: 'key', tz: 'PR-SEC-035', group: 'settings', routes: rolesRoutes },
  { id: 'security', path: '/settings/security', name: 'navSecurity', icon: 'shield', tz: 'PR-SEC-037', group: 'settings', routes: securityRoutes },
  { id: 'routes', path: '/settings/routes', name: 'flow_nav_routes', icon: 'route', tz: 'PR-PROC-015', group: 'settings', routes: [{ path: '/settings/routes', render: () => <RouteDesignerPage /> }] },
  { id: 'audit', path: '/audit', name: 'navAudit', icon: 'clock', tz: 'PR-GEN-040', group: 'settings', routes: auditRoutes },
  // P4-SEC: персональные данные — реестр ПДн, обезличивание по сроку под контролем двух лиц, журнал пропусков
  { id: 'privacy', path: '/privacy', name: 'pd_nav', icon: 'shield', tz: 'PR-SEC-049', group: 'settings', routes: privacyRoutes },
  // Документные сервисы (P1-SVC): интеграционная шина, импорт/миграция данных, печатные формы и проверка подписи по QR
  { id: 'integrations', path: '/integrations', name: 'svc_navIntegrations', icon: 'plug', tz: '5', group: 'settings', routes: integrationsRoutes },
  { id: 'import', path: '/import', name: 'svc_navImport', icon: 'upload', tz: 'PR-GEN-019', group: 'settings', routes: importRoutes },
  { id: 'print-forms', path: '/print-forms', name: 'svc_navPrint', icon: 'printer', tz: 'PR-SEC-032', group: 'settings', routes: printRoutes },
  // P3-GEN: мониторинг, инциденты, технический журнал, диагностический отчёт
  { id: 'monitoring', path: '/monitoring', name: { ru: 'Мониторинг', uz: 'Monitoring', en: 'Monitoring' }, icon: 'chart', tz: 'PR-GEN-061', group: 'settings', routes: monitoringRoutes },
  // P4-GEN: регламентные окна и аварийный режим (PR-GEN-059/060), Service Desk, справка (PR-TEC-007)
  { id: 'maintenance', path: '/maintenance', name: 'p4g_nav_maintenance', icon: 'wrench', tz: 'PR-GEN-059', group: 'settings', routes: maintenanceRoutes },
  { id: 'service-desk', path: '/service-desk', name: 'p4g_nav_servicedesk', icon: 'lifebuoy', tz: 'PR-GEN-060', group: 'core', routes: serviceDeskRoutes },
  { id: 'help', path: '/help', name: 'p4g_nav_help', icon: 'help', tz: 'PR-TEC-007', group: 'core', routes: helpRoutes },
];

export const ALL_ROUTES: ModuleRoute[] = MODULES.flatMap((m) => m.routes);
