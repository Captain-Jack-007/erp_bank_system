import { useState } from 'react';
import { cashApi, cashCanEdit, cashPositions, currencyLabel, decimalSep, formatDate, formatMoneyShort, formatNumber, tk } from '@xb/shared';
import { Card, DataTable, Empty, LineChart, Loading, PageHeader, StatusBadge, Stat } from '../../components/ui';
import { Icon } from '../../components/icons';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { LimitBar, money, NewOrderModal, OrderActions, PositionBadge } from './shared';

const bln = (v: number) => Math.round((v / 1e9) * 100) / 100;

export function CashBranchPage({ id }: { id: string }) {
  const { t, loc, lang } = useSession();
  const user = useUser();
  const branch = useApi(() => cashApi.getBranch(id), [id]);
  const branches = useApi(() => cashApi.listBranches());
  const orders = useApi(() => cashApi.listOrders(id), [id]);
  const trend = useApi(() => cashApi.monthlyTrend(id), [id]);
  const eco = useApi(() => cashApi.economics(), []);
  const [creating, setCreating] = useState(false);

  if (branch.loading && !branch.data) return <Card><Loading /></Card>;
  const b = branch.data;
  if (!b) return <Card><Empty text={t('empty')} /></Card>;
  const positions = cashPositions(b);
  const e = eco.data?.find((x) => x.branchId === id);

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('cash_title'), to: '/cash' }, { label: b.code }]}
        title={loc(b.name)}
        subtitle={`${loc(b.region)} · ${t('cash_manager')}: ${b.manager}`}
        actions={
          b.kind === 'branch' && cashCanEdit(user) && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} /> {t('cash_new_order')}
            </button>
          )
        }
      />

      {b.kind === 'branch' && (
        <div className="grid grid-4">
          <Stat label={t('cash_desks')} value={b.desks} icon="building" foot={`${t('cash_atms')}: ${b.atms}`} />
          <Stat label={t('cash_volume')} value={e ? formatMoneyShort(e.volume, lang) : '—'} icon="coins" foot={t('cash_period_quarter')} />
          <Stat label={t('cash_margin')} value={e ? formatMoneyShort(e.margin, lang) : '—'} tone={e && e.margin < 0 ? 'alert' : 'accent'} icon="chart" foot={e && `${t('cash_margin_pct')}: ${String(e.marginPct).replace('.', decimalSep())}%`} />
          <Stat label={t('cash_kpi_cost_per_mln')} value={e ? `${formatNumber(e.costPerMln)} ${currencyLabel()}` : '—'} icon="pie" />
        </div>
      )}

      <div className="grid grid-main">
        <Card title={t('cash_tab_positions')} flush>
          <DataTable
            rows={positions}
            rowKey={(p) => p.currency}
            columns={[
              { header: t('cash_currency'), width: 80, render: (p) => <b>{p.currency}</b> },
              { header: t('cash_balance'), align: 'right', render: (p) => money(p.balance, p.currency) },
              { header: t('cash_limit'), render: (p) => <span className="small muted num">{money(p.limit.min, p.currency)} – {money(p.limit.max, p.currency)}</span> },
              { header: '', width: 160, render: (p) => <LimitBar position={p} /> },
              { header: t('status'), render: (p) => <PositionBadge status={p.status} /> },
              {
                header: t('cash_recommended'),
                render: (p) => (p.recommendedType ? <span className="small">{t(tk('cash_type_', p.recommendedType))}: <b className="num">{money(p.recommended, p.currency)}</b></span> : '—'),
              },
            ]}
          />
        </Card>
        {b.kind === 'branch' && (
          <Card title={t('cash_trend')}>
            {trend.data ? (
              <LineChart
                height={200}
                labels={trend.data.map((m) => m.month)}
                series={[
                  { name: t('cash_income'), values: trend.data.map((m) => bln(m.income)) },
                  { name: t('cash_total_cost'), values: trend.data.map((m) => bln(m.cost)), color: 'var(--accent)' },
                ]}
                format={(n) => String(n).replace('.', decimalSep())}
              />
            ) : (
              <Loading />
            )}
          </Card>
        )}
      </div>

      <Card title={t('cash_tab_orders')} flush>
        <DataTable
          rows={orders.data}
          loading={orders.loading}
          rowKey={(o) => o.id}
          columns={[
            { header: t('number'), render: (o) => <span className="doc-num">{o.number}</span> },
            { header: t('cash_order_type'), render: (o) => t(tk('cash_type_', o.type)) },
            { header: t('cash_amount'), align: 'right', render: (o) => money(o.amount, o.currency) },
            { header: t('cash_planned_date'), render: (o) => formatDate(o.plannedDate) },
            { header: t('status'), render: (o) => <StatusBadge prefix="cash_status_" status={o.status} tone={o.status === 'new' ? 'info' : o.status === 'approved' ? 'warn' : o.status === 'delivered' ? 'ok' : o.status === 'cancelled' ? 'muted' : 'info'} /> },
            { header: '', render: (o) => <OrderActions order={o} /> },
          ]}
        />
      </Card>
      {creating && branches.data && <NewOrderModal branches={branches.data} initialBranchId={b.id} onClose={() => setCreating(false)} />}
    </>
  );
}
