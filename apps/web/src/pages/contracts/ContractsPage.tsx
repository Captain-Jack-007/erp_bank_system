// Модуль «Учёт договоров» (ТЗ 4.2.2): меню договоров по видам, дашборд, мониторинг исполнения, табло
// «не оплачено к 25-му», платёжные поручения, электронные договоры (Soliqservis/Didox), отчёты (в т. ч. ЦБ),
// резервы (Положение № 2696), структурные подразделения, настройки.
import { useState } from 'react';
import { api, CONTRACT_KINDS, contractsApi, formatDate, formatMoney, formatMoneyShort, today, tk, type Contract, type ContractKind, type ContractStatus } from '@xb/shared';
import { Button, Card, DataTable, FilterBar, Input, PageHeader, Select, Stat, StatusBadge, Tabs } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Link, navigate, useQuery } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCostCenters } from '../procurement/shared';
import { ContractsDashboard, MonitoringView, BoardView, UnitsView } from './ContractsViews';
import { PaymentsView, PlatformView } from './PaymentsViews';
import { ReportsView, ReservesView } from './ReportsViews';
import { SettingsView } from './SettingsView';

const STATUSES: ContractStatus[] = ['draft', 'pending', 'active', 'expired', 'terminated'];
type TabId = 'registry' | 'dashboard' | 'monitoring' | 'board' | 'payments' | 'platform' | 'reports' | 'reserves' | 'units' | 'settings';
const TABS: TabId[] = ['registry', 'dashboard', 'monitoring', 'board', 'payments', 'platform', 'reports', 'reserves', 'units', 'settings'];

export function ContractsPage() {
  const { t } = useSession();
  const can = useCan();
  const query = useQuery();
  const q0 = query.get('tab') as TabId | null;
  const [tab, setTabState] = useState<TabId>(q0 && TABS.includes(q0) ? q0 : 'registry');
  const dash = useApi(() => contractsApi.dashboard(), []);
  const setTab = (v: TabId) => {
    setTabState(v);
    navigate(`/contracts${v === 'registry' ? '' : `?tab=${v}`}`);
  };
  const d = dash.data;
  return (
    <>
      <PageHeader
        title={t('contractsTitle')}
        subtitle={`${t('tzLabel')} 4.2.2`}
        actions={can('contracts', 'edit') ? <Button type="primary" icon="plus" onClick={() => navigate('/contracts/new')}>{t('con_new')}</Button> : undefined}
      />
      {d && (
        <div className="pc-kpis">
          <Stat label={t('con_kpiActive')} value={formatMoneyShort(d.activeAmount)} icon="file" />
          <Stat label={t('con_kpiOverdue')} value={formatMoneyShort(d.overdue)} icon="alert" tone={d.overdue ? 'alert' : undefined} />
          <Stat label={t('con_kpiStages')} value={d.overdueStages} icon="clock" tone={d.overdueStages ? 'alert' : undefined} />
          <Stat label={t('con_kpiReserves')} value={formatMoneyShort(d.reserves)} icon="wallet" />
        </div>
      )}
      <Card flush>
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          items={TABS.map((v) => ({ value: v, label: t(tk('con_tab_', v)) }))}
        />
        {tab === 'registry' && <Registry />}
        {tab === 'dashboard' && <ContractsDashboard />}
        {tab === 'monitoring' && <MonitoringView />}
        {tab === 'board' && <BoardView />}
        {tab === 'payments' && <PaymentsView />}
        {tab === 'platform' && <PlatformView />}
        {tab === 'reports' && <ReportsView />}
        {tab === 'reserves' && <ReservesView />}
        {tab === 'units' && <UnitsView />}
        {tab === 'settings' && <SettingsView />}
      </Card>
    </>
  );
}

function Registry() {
  const { t, loc } = useSession();
  const lk = useLookups();
  const cc = useCostCenters();
  const query = useQuery();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContractStatus | 'overdue' | ''>(query.get('overdue') ? 'overdue' : '');
  const [cp, setCp] = useState('');
  const [dept, setDept] = useState('');
  const [kind, setKind] = useState<ContractKind | ''>((query.get('kind') as ContractKind | null) ?? '');
  const hasOverdue = (c: Contract) => c.payments.some((p) => !p.paid && p.dueDate < today());
  const all = useApi(() => api.listContracts(), []);
  const list = useApi(
    () =>
      api
        .listContracts({ search, ...(status && status !== 'overdue' ? { status } : {}), ...(cp ? { counterpartyId: cp } : {}) })
        .then((rows) => rows.filter((c) => (status !== 'overdue' || hasOverdue(c)) && (!kind || (c.kind ?? 'services') === kind) && (!dept || c.departmentId === dept || c.initiatorDeptIds?.includes(dept)))),
    [search, status, cp, kind, dept],
  );
  const rows = list.data ?? [];
  const count = (k: ContractKind) => (all.data ?? []).filter((c) => (c.kind ?? 'services') === k).length;
  return (
    <>
      <div className="pc-kinds" role="group" aria-label={t('con_kind')}>
        <button type="button" className={`pc-kind ${kind === '' ? 'on' : ''}`} onClick={() => setKind('')}>
          {t('all')}
          <span className="count">{all.data?.length ?? ''}</span>
        </button>
        {CONTRACT_KINDS.map((k) => (
          <button key={k} type="button" className={`pc-kind ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {t(tk('con_kind_', k))}
            <span className="count">{count(k)}</span>
          </button>
        ))}
      </div>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('number')}, ${t('subject').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select<ContractStatus | 'overdue' | ''> value={status} onChange={setStatus} ariaLabel={t('status')} options={[{ value: '', label: `${t('status')}: ${t('all')}` }, ...STATUSES.map((s) => ({ value: s, label: t(tk('cstatus_', s)) })), { value: 'overdue', label: t('dashOverdue') }]} />
        <Select<string> value={cp} onChange={setCp} ariaLabel={t('counterparty')} options={[{ value: '', label: `${t('counterparty')}: ${t('all')}` }, ...lk.counterparties.map((c) => ({ value: c.id, label: c.name }))]} />
        <Select<string> value={dept} onChange={setDept} ariaLabel={t('con_initiator')} options={[{ value: '', label: `${t('con_initiator')}: ${t('all')}` }, ...lk.departments.map((d) => ({ value: d.id, label: d.code }))]} />
        <ExportButton
          filename={t('contractsTitle')}
          rows={rows}
          columns={[
            { header: t('number'), value: (c) => c.number },
            { header: t('con_kind'), value: (c) => t(tk('con_kind_', c.kind ?? 'services')) },
            { header: t('subject'), value: (c) => c.subject },
            { header: t('counterparty'), value: (c) => lk.counterparty(c.counterpartyId)?.name ?? '' },
            { header: t('con_initiator'), value: (c) => (lk.department(c.departmentId) ? loc(lk.department(c.departmentId)!.name) : '') },
            { header: t('proc_costCenter'), value: (c) => cc.label(c.costCenterKey) },
            { header: t('startDate'), value: (c) => c.startDate.slice(0, 10) },
            { header: t('endDate'), value: (c) => c.endDate.slice(0, 10) },
            { header: t('amount'), value: (c) => c.amount, format: 'money' },
            { header: t('con_currency'), value: (c) => c.currency },
            { header: t('paidTotal'), value: (c) => c.payments.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0), format: 'money' },
            { header: t('status'), value: (c) => t(tk('cstatus_', c.status)) },
          ]}
        />
        <PrintButton
          doc={() => ({
            entity: 'registry',
            entityId: `contracts-${kind || 'all'}`,
            title: `${t('con_registryTitle')}${kind ? `: ${t(tk('con_kind_', kind))}` : ''}`,
            date: today(),
            landscape: true,
            table: {
              columns: [{ header: '№', align: 'center', width: '4%' }, { header: t('number') }, { header: t('subject') }, { header: t('counterparty') }, { header: t('period') }, { header: t('status') }, { header: t('amount'), align: 'right' }],
              rows: rows.map((c, i) => [String(i + 1), c.number, c.subject, lk.counterparty(c.counterpartyId)?.name ?? '', `${formatDate(c.startDate)} – ${formatDate(c.endDate)}`, t(tk('cstatus_', c.status)), formatMoney(c.amount, c.currency)]),
              totals: ['', t('total'), '', '', '', String(rows.length), formatMoney(rows.filter((c) => c.currency === 'UZS').reduce((s, c) => s + c.amount, 0))],
            },
          })}
          template="registry"
        />
      </FilterBar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/contracts/${c.id}`)}
        emptyText={t('empty')}
        columns={[
          { header: t('number'), render: (c) => <span className="doc-num">{c.number}</span> },
          { header: t('subject'), render: (c) => <>{c.subject}<div className="sub">{t(tk('con_kind_', c.kind ?? 'services'))}{c.subkind ? ` · ${t(tk('con_sub_', c.subkind))}` : ''}</div></> },
          { header: t('counterparty'), render: (c) => <>{lk.counterparty(c.counterpartyId)?.name}<div className="sub">{t('tin')} {lk.counterparty(c.counterpartyId)?.tin}</div></> },
          { header: t('period'), render: (c) => <span className="num">{formatDate(c.startDate)} — {formatDate(c.endDate)}</span> },
          { header: t('amount'), align: 'right', render: (c) => formatMoney(c.amount, c.currency) },
          { header: t('paidTotal'), align: 'right', render: (c) => <span className="muted">{Math.round((c.payments.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0) / c.amount) * 100)}%</span> },
          { header: t('status'), render: (c) => <StatusBadge prefix="cstatus_" status={c.status} /> },
        ]}
      />
      <div className="pc-pad muted small">
        <Link to="/contracts?tab=platform">{t('con_platformLink')}</Link>
      </div>
    </>
  );
}
