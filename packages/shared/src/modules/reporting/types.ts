// Типы модуля «Отчётность и аналитика» (ТЗ 4.2.8): каталог отчётов, просмотр, конструктор, рассылки.
import type { ID, ISODate, Localized } from '../../types';

export type ReportArea = 'procurement' | 'contracts' | 'approvals' | 'budget' | 'finance' | 'operations' | 'regulatory' | 'cbu' | 'tax' | 'statistical' | 'hr' | 'assets' | 'fleet' | 'trips' | 'custom';
export type ReportSchedule = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'on_demand';
export type ReportBuiltinKey =
  | 'procurement_by_department' | 'contracts_payments' | 'approvals_sla' | 'budget_execution'
  | 'ifrs_sfp' | 'ifrs_pl' | 'ifrs_cf' | 'ifrs_equity' | 'ifrs_notes' | 'nsbu_balance' | 'cbu_balance' | 'cbu_cash' | 'tax_register' | 'tax_leases'
  | 'stat_labour' | 'stat_capex' | 'assets_register' | 'warehouse_turnover' | 'hr_report' | 'warehouse_report' | 'assets_report' | 'fleet_report' | 'trips_report';

export interface ReportDefinition {
  id: ID;
  code: string;
  name: Localized;
  description: Localized;
  area: ReportArea;
  ownerId: ID;
  schedule: ReportSchedule;
  builtin?: ReportBuiltinKey; // отчёт строится здесь, в модуле
  link?: string; // отчёт живёт в другом модуле
  /** Регламентированный / управленческий / пользовательский (PR-REP-001…016). */
  kind?: 'regulated' | 'management' | 'custom';
  /** Пользовательский отчёт конструктора (сохранённый запрос). */
  custom?: ReportBuilderQuery;
  shared?: boolean;
  createdAt?: ISODate;
}

export type ReportColumnType = 'text' | 'money' | 'number' | 'percent' | 'hours';

export interface ReportColumn {
  key: string;
  label: Localized;
  type: ReportColumnType;
}

export type ReportCell = string | number;

export interface ReportResult {
  title: Localized;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals?: Record<string, number>;
  chart?: { labelKey: string; seriesKeys: string[] };
  generatedAt: ISODate;
  /** Детализация (drill-down): документы-источники каждой строки. */
  rowDocs?: { label: string; to?: string }[][];
  /** Примечания под таблицей (методика, источник данных). */
  notes?: Localized[];
}

export type ReportDataset = 'procurement' | 'contracts' | 'approvals' | 'budget' | 'assets' | 'taxes' | 'warehouse' | 'cash';
export type ReportMeasure = 'count' | 'amount' | 'paid' | 'planned' | 'spent' | 'nbv' | 'outstanding' | 'balance';

export interface ReportBuilderQuery {
  dataset: ReportDataset;
  groupBy: string;
  measure: ReportMeasure;
  periodDays: 0 | 30 | 90 | 365; // 0 — весь период
  /** Второе измерение (сводная таблица). */
  groupBy2?: string;
  /** Дополнительные показатели. */
  measures2?: ReportMeasure[];
  /** Фильтр: поле группировки = значение (подстрока). */
  filter?: { field: string; value: string };
}

export interface ReportDatasetInfo {
  dataset: ReportDataset;
  groupBy: string[];
  measures: ReportMeasure[];
}

export type ReportFormat = 'pdf' | 'xlsx' | 'csv';

export interface ReportSubscription {
  id: ID;
  reportId: ID;
  userId: ID;
  frequency: Exclude<ReportSchedule, 'on_demand' | 'quarterly'>;
  format: ReportFormat;
  email: string;
  createdAt: ISODate;
  /** Планировщик: следующий запуск и последний результат (PR-REP-018). */
  nextRunAt?: ISODate;
  lastRunAt?: ISODate;
  active?: boolean;
}

/** Отправка отчёта по рассылке (журнал доставки, письмо — в почтовый outbox). */
export interface ReportDelivery {
  id: ID;
  subscriptionId: ID;
  reportId: ID;
  at: ISODate;
  to: string;
  format: ReportFormat;
  fileName: string;
  bytes: number;
  rows: number;
  status: 'sent' | 'failed';
  trigger: 'schedule' | 'manual';
}

export interface ReportKpi {
  id: string;
  name: Localized;
  value: number;
  unit: 'money' | 'percent' | 'count';
  target: number;
  better: 'higher' | 'lower';
  status: 'ok' | 'warn' | 'bad';
  link: string;
  group: 'finance' | 'budget' | 'cash' | 'tax' | 'operations';
  trend?: number[];
}

export interface ReportNewSubscriptionInput {
  reportId: ID;
  frequency: ReportSubscription['frequency'];
  format: ReportFormat;
  email: string;
}
