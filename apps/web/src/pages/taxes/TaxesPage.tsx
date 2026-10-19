import { useState } from 'react';
import { decimalSep, formatDate, formatMoneyShort, taxesApi, tk, type TaxReturnStatus, type TaxReturnView, type TaxType } from '@xb/shared';
import { Badge, Button, Card, DataTable, FilterBar, PageHeader, Stat, StatusBadge, Tabs, type Column } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { navigate } from '../../lib/router';
import { BranchSelect, useP } from './common';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';

type Tab = 'calendar' | 'returns' | 'settings';
export const TAX_TYPES: TaxType[] = ['vat', 'profit', 'property', 'land', 'water', 'rent_pit', 'social', 'pit', 'withholding'];
const STATUSES: TaxReturnStatus[] = ['draft', 'calculated', 'submitted', 'accepted'];
const STATUS_TONE = { draft: 'muted', calculated: 'info', submitted: 'warn', accepted: 'ok' } as const;

export function TaxStatus({ status }: { status: TaxReturnStatus }) {
  return <StatusBadge prefix="taxes_status_" status={status} tone={STATUS_TONE[status]} />;
}

export function DueBadge({ r }: { r: TaxReturnView }) {
  const { t } = useSession();
  if (r.overdue) return <Badge tone="danger">{Math.abs(r.daysLeft)} {t('taxes_daysOverdue')}</Badge>;
  if (r.status === 'accepted' && r.outstanding === 0) return null;
  if (r.daysLeft === 0) return <Badge tone="warn">{t('taxes_today')}</Badge>;
  if (r.daysLeft < 0) return null;
  return <Badge tone={r.daysLeft <= 5 ? 'warn' : 'muted'}>{r.daysLeft} {t('taxes_daysLeft')}</Badge>;
}

function useColumns(): Column<TaxReturnView>[] {
  const { t, lang } = useSession();
  return [
    { header: t('taxes_due'), render: (r) => <span className="num" style={{ fontWeight: 600 }}>{formatDate(r.dueDate)}</span> },
    { header: '', render: (r) => <DueBadge r={r} /> },
    {
      header: t('taxes_type'),
      render: (r) => (
        <>
          <div style={{ fontWeight: 600 }}>{t(tk('taxes_type_', r.type))}</div>
          <div className="sub">{r.number}</div>
        </>
      ),
    },
    { header: t('taxes_period'), render: (r) => r.period },
    { header: t('status'), render: (r) => <TaxStatus status={r.status} /> },
    { header: t('taxes_amount'), align: 'right', render: (r) => (r.calc ? formatMoneyShort(r.amount, lang) : '—') },
    { header: t('taxes_paid'), align: 'right', render: (r) => (r.paid ? formatMoneyShort(r.paid, lang) : '—') },
    { header: t('taxes_remaining'), align: 'right', render: (r) => (r.outstanding ? <span style={{ color: r.overdue ? 'var(--danger)' : undefined, fontWeight: 600 }}>{formatMoneyShort(r.outstanding, lang)}</span> : '—') },
  ];
}

export function TaxesPage() {
  const { t, lang } = useSession();
  const p = useP();
  const [tab, setTab] = useState<Tab>('calendar');
  const ov = useApi(() => taxesApi.getOverview());
  const o = ov.data;
  const short = (v: number) => formatMoneyShort(v, lang);

  return (
    <>
      <PageHeader
        title={t('taxes_title')}
        subtitle={`${t('tzLabel')} 4.2.17 · ${t('taxes_subtitle')}`}
        actions={
          <>
            <Button size="small" icon="book" onClick={() => navigate('/taxes/registers')}>{p('Реестры и база', 'Reyestrlar va baza', 'Registers & base')}</Button>
            <Button size="small" icon="chart" onClick={() => navigate('/taxes/profit')}>{p('Налог на прибыль', "Foyda solig'i", 'Profit tax')}</Button>
            <Button size="small" icon="check" onClick={() => navigate('/taxes/control')}>{p('Контроль и сдача', 'Nazorat va topshirish', 'Control & filing')}</Button>
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={t('taxes_dueThisMonth')} value={o?.dueThisMonth.count ?? '—'} tone="accent" icon="clock" foot={o ? short(o.dueThisMonth.amount) : undefined} />
        <Stat label={t('taxes_overdue')} value={o?.overdue ?? '—'} tone={o?.overdue ? 'alert' : undefined} icon="alert" />
        <Stat label={t('taxes_liabilityYtd')} value={o ? short(o.liabilityYtd) : '—'} icon="receipt" />
        <Stat label={t('taxes_paidYtd')} value={o ? short(o.paidYtd) : '—'} icon="wallet" foot={o ? `${t('taxes_outstanding')}: ${short(o.outstanding)}` : undefined} />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'calendar', label: t('taxes_tab_calendar') },
            { value: 'returns', label: t('taxes_tab_returns') },
            { value: 'settings', label: t('taxes_tab_settings') },
          ]}
        />
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'returns' && <ReturnsTab />}
        {tab === 'settings' && <SettingsTab />}
      </Card>
    </>
  );
}

function CalendarTab() {
  const { t } = useSession();
  const cal = useApi(() => taxesApi.calendar());
  const columns = useColumns();
  return (
    <>
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', fontWeight: 650, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {t('taxes_upcoming')}
        <ReturnsExport rows={cal.data ?? []} name="calendar" />
      </div>
      <DataTable rows={cal.data} loading={cal.loading} emptyText={t('taxes_calendarEmpty')} rowKey={(r) => r.id} columns={columns} onRowClick={(r) => navigate(`/taxes/${r.id}`)} />
    </>
  );
}

function ReturnsTab() {
  const { t } = useSession();
  const [type, setType] = useState<TaxType | ''>('');
  const [status, setStatus] = useState<TaxReturnStatus | ''>('');
  const [branch, setBranch] = useState('');
  const list = useApi(() => taxesApi.listReturns({ ...(type ? { type } : {}), ...(status ? { status } : {}), ...(branch ? { branchKey: branch } : {}) }), [type, status, branch]);
  const columns = useColumns();
  return (
    <>
      <FilterBar>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as TaxType | '')} aria-label={t('taxes_type')}>
          <option value="">{t('taxes_type')}: {t('taxes_all')}</option>
          {TAX_TYPES.map((x) => (
            <option key={x} value={x}>{t(tk('taxes_type_', x))}</option>
          ))}
        </select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as TaxReturnStatus | '')} aria-label={t('status')}>
          <option value="">{t('status')}: {t('taxes_all')}</option>
          {STATUSES.map((x) => (
            <option key={x} value={x}>{t(tk('taxes_status_', x))}</option>
          ))}
        </select>
        <BranchSelect value={branch} onChange={setBranch} />
        <span style={{ marginLeft: 'auto' }}><ReturnsExport rows={list.data ?? []} name="returns" /></span>
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(r) => r.id} columns={columns} onRowClick={(r) => navigate(`/taxes/${r.id}`)} />
    </>
  );
}

function SettingsTab() {
  const { t, loc } = useSession();
  const p = useP();
  const settings = useApi(() => taxesApi.listSettings());
  return (
    <>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <Badge tone="warn">{t('taxes_demoRates')}</Badge>
      </div>
      <DataTable
        rows={settings.data}
        loading={settings.loading}
        rowKey={(s) => s.type}
        columns={[
          { header: t('taxes_type'), render: (s) => <span style={{ fontWeight: 600 }}>{t(tk('taxes_type_', s.type))}</span> },
          { header: t('taxes_rate'), align: 'right', render: (s) => (s.rate ? `${String(s.rate).replace('.', decimalSep())}%` : <span className="muted small">{p('по реестру ставок', "stavkalar reyestri bo'yicha", 'per rate register')}</span>) },
          { header: t('taxes_factor'), align: 'right', render: (s) => String(s.factor).replace('.', decimalSep()) },
          { header: t('taxes_periodicity'), render: (s) => t(tk('taxes_periodicity_', s.periodicity)) },
          { header: t('taxes_dueDay'), render: (s) => t('taxes_dueDayValue').replace('{d}', String(s.dueDay)) },
          { header: t('taxes_baseHint'), render: (s) => <span className="muted">{loc(s.baseHint)}</span> },
        ]}
      />
      <div className="muted small" style={{ padding: '12px 18px' }}>{t('taxes_formula')}</div>
    </>
  );
}


/** Экспорт реестра расчётов в Excel/CSV. */
function ReturnsExport({ rows, name }: { rows: TaxReturnView[]; name: string }) {
  const { t } = useSession();
  return (
    <ExportButton<TaxReturnView>
      filename={`taxes-${name}`}
      rows={rows}
      columns={[
        { header: t('number'), value: (r) => r.number },
        { header: t('taxes_type'), value: (r) => t(tk('taxes_type_', r.type)) },
        { header: t('taxes_period'), value: (r) => r.period },
        { header: t('taxes_due'), value: (r) => r.dueDate },
        { header: t('status'), value: (r) => t(tk('taxes_status_', r.status)) },
        { header: t('taxes_amount'), value: (r) => r.amount, format: 'money', total: true },
        { header: t('taxes_paid'), value: (r) => r.paid, format: 'money', total: true },
        { header: t('taxes_remaining'), value: (r) => r.outstanding, format: 'money', total: true },
      ]}
    />
  );
}
