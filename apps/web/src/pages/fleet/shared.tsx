// Общие элементы экранов «Автопарк»: навигация по разделам, тона статусов, ошибки, оргструктура/МВЗ, выбор периода.
import { useMemo } from 'react';
import {
  approvalsApi, decimalSep, FleetError, fleetDriverOf, fleetPeriod, fleetPeriodOptions, formatDate, orgApi, today, tk,
  type FleetAlert, type FleetPeriod, type FleetPeriodType, type FleetStatus, type FleetTripStatus, type TKey,
} from '@xb/shared';
import { Select, Tabs, type Tone } from '../../components/ui';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { monthName } from '@xb/shared';
import { TaskRow } from '../Approvals';
import './fleet.css';

export const FLEET_TONE: Record<FleetStatus, Tone> = { in_operation: 'ok', repair: 'warn', inspection: 'info', reserve: 'muted', writeoff_pending: 'warn', written_off: 'danger' };
export const TRIP_TONE: Record<FleetTripStatus, Tone> = { pending: 'warn', returned: 'warn', rejected: 'danger', open: 'info', closed: 'ok', cancelled: 'muted' };
export const FLEET_STATUSES: FleetStatus[] = ['in_operation', 'repair', 'inspection', 'reserve', 'writeoff_pending', 'written_off'];

export type FleetSection = 'overview' | 'vehicles' | 'drivers' | 'trips' | 'expenses' | 'cards' | 'assignments' | 'postings' | 'reports' | 'alerts' | 'my';

/** Разделы модуля (вкладки-навигация). «Мой автомобиль» — для водителя, связанного с учётной записью. */
export function FleetNav({ active }: { active: FleetSection }) {
  const { t } = useSession();
  const user = useUser();
  const me = fleetDriverOf(user);
  const items: { value: FleetSection; label: string }[] = [
    ...(me ? [{ value: 'my' as const, label: t('fleet_nav_my') }] : []),
    { value: 'overview', label: t('fleet_nav_overview') },
    { value: 'vehicles', label: t('fleet_vehicles') },
    { value: 'drivers', label: t('fleet_nav_drivers') },
    { value: 'trips', label: t('fleet_trips') },
    { value: 'expenses', label: t('fleet_nav_expenses') },
    { value: 'cards', label: t('fleet_nav_cards') },
    { value: 'assignments', label: t('fleet_nav_assignments') },
    { value: 'postings', label: t('fleet_nav_postings') },
    { value: 'reports', label: t('fleet_nav_reports') },
    { value: 'alerts', label: t('fleet_alerts') },
  ];
  return (
    <div className="card flt-nav">
      <Tabs<FleetSection> value={active} onChange={(v) => navigate(v === 'overview' ? '/fleet' : `/fleet/${v}`)} items={items} />
    </div>
  );
}

/** Текст ошибки операции автопарка. */
export function useFleetErr(): (e: unknown) => string {
  const { t } = useSession();
  return (e: unknown) => {
    if (e instanceof FleetError) {
      const base = t(tk('fleet_err_', e.code));
      if (e.code === 'driver_license' || e.code === 'driver_medical') return `${base}: ${formatDate(e.detail ?? '')}`;
      if (e.code === 'doc_expired' && e.detail) return `${base}: ${t(tk('fleet_doc_', e.detail))}`;
      if (e.code === 'driver_category' && e.detail) return `${base}: ${e.detail}`;
      return base;
    }
    return t('actionFailed');
  };
}

export const dec = (n: number | undefined, digits = 1): string => (n === undefined ? '—' : String(Math.round(n * 10 ** digits) / 10 ** digits).replace('.', decimalSep()));

export function Plate({ value }: { value: string }) {
  return <span className="plate">{value}</span>;
}

/** Дата со сроком: красная — просрочено, жёлтая — истекает в горизонте предупреждений. */
export function DueDate({ value, horizon = 30 }: { value?: string; horizon?: number }) {
  if (!value) return <span className="muted">—</span>;
  const d0 = today();
  const soon = new Date(Date.parse(`${d0}T00:00:00Z`) + horizon * 86_400_000).toISOString().slice(0, 10);
  const cls = value < d0 ? 'flt-due bad' : value <= soon ? 'flt-due warn' : 'num';
  return <span className={cls}>{formatDate(value)}</span>;
}

/** Оргединицы и МВЗ (справочник MDM) — имена по ключам и списки для выбора. */
export function useOrgRefs() {
  const { loc } = useSession();
  const units = useApi(() => orgApi.listOrgUnits(), []);
  const ccs = useApi(() => orgApi.listCostCenters({ pageSize: 100_000, status: 'active' }), []);
  return useMemo(() => {
    const u = new Map((units.data ?? []).map((x) => [x.key, x]));
    const c = new Map((ccs.data?.rows ?? []).map((x) => [x.key, x]));
    return {
      units: units.data ?? [],
      costCenters: ccs.data?.rows ?? [],
      unitName: (key?: string) => (key ? (u.get(key) ? loc(u.get(key)!.name) : key) : '—'),
      ccLabel: (key?: string) => (key ? (c.get(key) ? `${c.get(key)!.code} · ${loc(c.get(key)!.name)}` : key) : '—'),
      ccCode: (key?: string) => (key ? c.get(key)?.code ?? key : '—'),
      ccsOf: (orgUnitKey?: string) => (ccs.data?.rows ?? []).filter((x) => !orgUnitKey || x.orgUnitKey === orgUnitKey),
    };
  }, [units.data, ccs.data, loc]);
}

export function periodLabel(p: FleetPeriod, lang: Parameters<typeof monthName>[1]): string {
  if (p.type === 'month') return `${monthName(Number(p.value.slice(5, 7)) - 1, lang, true)} ${p.value.slice(0, 4)}`;
  if (p.type === 'quarter') return `${p.value.slice(5)} ${p.value.slice(0, 4)}`;
  return p.value;
}

/** Выбор периода: месяц / квартал / год (PR-FLT-118). */
export function PeriodPicker({ value, onChange }: { value: FleetPeriod; onChange: (p: FleetPeriod) => void }) {
  const { t, lang } = useSession();
  const options = fleetPeriodOptions(value.type, today(), value.type === 'year' ? 4 : value.type === 'quarter' ? 8 : 18);
  return (
    <div className="flt-period">
      <Select<FleetPeriodType>
        value={value.type}
        ariaLabel={t('fleet_periodType')}
        onChange={(type) => onChange(fleetPeriodOptions(type, today(), 1)[0]!)}
        options={(['month', 'quarter', 'year'] as const).map((x) => ({ value: x, label: t(tk('fleet_period_', x)) }))}
      />
      <Select<string>
        value={value.value}
        ariaLabel={t('fleet_period')}
        onChange={(v) => onChange(fleetPeriod(value.type, v))}
        options={options.map((p) => ({ value: p.value, label: periodLabel(p, lang) }))}
      />
    </div>
  );
}

export const ALERT_ICON: Record<FleetAlert['kind'], 'alert' | 'car' | 'chart' | 'user' | 'file' | 'wallet'> = {
  insurance: 'file', kasko: 'file', inspection: 'file', tech_passport: 'file', power_of_attorney: 'file', service: 'car', overconsumption: 'chart', license: 'user', medical: 'user', limit: 'wallet',
};

export const tkf = (prefix: string, v: string): TKey => tk(prefix, v);

/** Задача согласования текущего пользователя по документу (параллельный шаг «любой из» — своя задача). */
export function FleetTaskBox({ entityId }: { entityId: string }) {
  const user = useUser();
  const inbox = useApi(() => approvalsApi.inbox(user, 'mine'), [user.id, entityId]);
  const item = inbox.data?.find((x) => x.task.entityId === entityId);
  if (!item) return null;
  return (
    <div className="card" style={{ padding: 0 }}>
      <TaskRow task={item.task} item={item} />
    </div>
  );
}
