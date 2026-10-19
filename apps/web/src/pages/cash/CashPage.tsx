import { useEffect, useState } from 'react';
import { CASH_COST_ITEMS, cashApi, cashCanEdit, pick, currencyLabel, decimalSep, formatDate, formatMoneyShort, formatNumber, tk, type CashBranch, type CashOrder, type CashOrderStatus, type CashPosition, type CashRoute } from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Empty, FilterBar, LineChart, Loading, PageHeader, Progress, Stat, StatusBadge, Tabs, useToast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { Link, navigate, useLocation } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { CURRENCIES, errText, LimitBar, money, NewOrderModal, OrderActions, PositionBadge } from './shared';

type Tab = 'positions' | 'orders' | 'routes' | 'economics';
const TABS: Tab[] = ['positions', 'orders', 'routes', 'economics'];
const tabFromPath = (path: string): Tab | null => {
  const v = new URLSearchParams(path.split('?')[1] ?? '').get('tab');
  return TABS.includes(v as Tab) ? (v as Tab) : null;
};
const bln = (v: number) => Math.round((v / 1e9) * 10) / 10;
const ORDER_TONE: Record<CashOrderStatus, 'info' | 'warn' | 'ok' | 'muted'> = { new: 'info', approved: 'warn', in_transit: 'info', delivered: 'ok', cancelled: 'muted' };

export function CashPage() {
  const { t, lang } = useSession();
  const user = useUser();
  const canEdit = cashCanEdit(user);
  const path = useLocation();
  const [tab, setTab] = useState<Tab>(() => tabFromPath(path) ?? 'positions');
  useEffect(() => {
    const fromUrl = tabFromPath(path);
    if (fromUrl) setTab(fromUrl);
  }, [path]);
  const overview = useApi(() => cashApi.overview());
  const branches = useApi(() => cashApi.listBranches());
  const [creating, setCreating] = useState(false);
  const o = overview.data;
  const margin = o ? o.quarterIncome - o.quarterCost : 0;

  return (
    <>
      <PageHeader
        title={t('cash_title')}
        subtitle={t('cash_subtitle')}
        actions={
          <>
            <Button size="small" icon="pie" onClick={() => navigate('/cash/ndo')}>{pick(lang, 'Экономика НДО', 'NPA iqtisodiyoti', 'Cash economics')}</Button>
            {canEdit ? (
              <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!branches.data}>
                <Icon name="plus" size={16} /> {t('cash_new_order')}
              </button>
            ) : (
              <span className="muted small">{t('cash_read_only')}</span>
            )}
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={t('cash_kpi_total')} value={o ? `${formatMoneyShort(o.totalCashUzs, lang)} ${currencyLabel()}` : '—'} tone="accent" icon="coins" />
        <Stat label={t('cash_kpi_out_of_limit')} value={o?.branchesOutOfLimit ?? '—'} tone={o?.branchesOutOfLimit ? 'alert' : undefined} icon="alert" foot={o && `${t('cash_kpi_orders')}: ${o.openOrders}`} />
        <Stat label={t('cash_kpi_cost_per_mln')} value={o ? `${formatNumber(o.costPerMln)} ${currencyLabel()}` : '—'} icon="pie" foot={t('cash_period_quarter')} />
        <Stat label={t('cash_kpi_margin')} value={o ? `${formatMoneyShort(margin, lang)} ${currencyLabel()}` : '—'} icon="chart" foot={o && `${t('cash_income')}: ${formatMoneyShort(o.quarterIncome, lang)} · ${t('cash_total_cost')}: ${formatMoneyShort(o.quarterCost, lang)}`} />
      </div>

      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'positions', label: t('cash_tab_positions') },
            { value: 'orders', label: t('cash_tab_orders'), ...(o ? { count: o.openOrders } : {}) },
            { value: 'routes', label: t('cash_tab_routes'), ...(o ? { count: o.activeRoutes } : {}) },
            { value: 'economics', label: t('cash_tab_economics') },
          ]}
        />
        {!branches.data ? (
          <Loading />
        ) : tab === 'positions' ? (
          <Positions branches={branches.data} />
        ) : tab === 'orders' ? (
          <Orders branches={branches.data} />
        ) : tab === 'routes' ? (
          <Routes branches={branches.data} />
        ) : (
          <Economics branches={branches.data} />
        )}
      </Card>
      {creating && branches.data && <NewOrderModal branches={branches.data} onClose={() => setCreating(false)} />}
    </>
  );
}

function Positions({ branches }: { branches: CashBranch[] }) {
  const { t, loc, lang } = useSession();
  const positions = useApi(() => cashApi.positions());
  const pos = (b: CashBranch, c: string) => positions.data?.find((p) => p.branchId === b.id && p.currency === c);
  const worst = (b: CashBranch): CashPosition['status'] => {
    const ps = positions.data?.filter((p) => p.branchId === b.id) ?? [];
    return ps.some((p) => p.status === 'under') ? 'under' : ps.some((p) => p.status === 'over') ? 'over' : 'ok';
  };
  return (
    <DataTable
      rows={branches}
      loading={positions.loading && !positions.data}
      rowKey={(b) => b.id}
      onRowClick={(b) => navigate(`/cash/${b.id}`)}
      columns={[
        {
          header: t('cash_branch'),
          render: (b) => (
            <>
              <div style={{ fontWeight: 600 }}>{loc(b.name)}</div>
              <div className="sub">
                {b.code} · {loc(b.region)}
                {b.kind === 'branch' && ` · ${b.desks} / ${b.atms}`}
              </div>
            </>
          ),
        },
        ...CURRENCIES.map((c) => ({
          header: c,
          width: 170,
          render: (b: CashBranch) => {
            const p = pos(b, c);
            if (!p) return null;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="num" style={{ fontWeight: 600, color: p.status === 'ok' ? undefined : p.status === 'over' ? 'var(--warn)' : 'var(--danger)' }}>
                  {c === 'UZS' ? `${formatMoneyShort(p.balance, lang)} ${currencyLabel()}` : money(p.balance, c)}
                </span>
                <LimitBar position={p} />
              </div>
            );
          },
        })),
        { header: t('status'), render: (b) => <PositionBadge status={worst(b)} /> },
      ]}
    />
  );
}

function Orders({ branches }: { branches: CashBranch[] }) {
  const { t, loc } = useSession();
  const [status, setStatus] = useState<CashOrderStatus | ''>('');
  const orders = useApi(() => cashApi.listOrders());
  const rows = orders.data?.filter((o) => !status || o.status === status);
  const branchName = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? loc(b.name) : id;
  };
  return (
    <>
      <FilterBar>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as CashOrderStatus | '')}>
          <option value="">
            {t('status')}: {t('all')}
          </option>
          {(['new', 'approved', 'in_transit', 'delivered', 'cancelled'] as CashOrderStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(tk('cash_status_', s))}
            </option>
          ))}
        </select>
      </FilterBar>
      <DataTable<CashOrder>
        rows={rows}
        loading={orders.loading}
        rowKey={(o) => o.id}
        onRowClick={(o) => navigate(`/cash/${o.branchId}`)}
        columns={[
          { header: t('number'), render: (o) => <span className="doc-num">{o.number}</span> },
          {
            header: t('cash_order_type'),
            render: (o) => (
              <Badge tone={o.type === 'reinforcement' ? 'info' : 'muted'}>{t(tk('cash_type_', o.type))}</Badge>
            ),
          },
          {
            header: t('cash_branch'),
            render: (o) => (
              <>
                {branchName(o.branchId)}
                {o.comment && <div className="sub">{o.comment}</div>}
              </>
            ),
          },
          { header: t('cash_amount'), align: 'right', render: (o) => money(o.amount, o.currency) },
          { header: t('cash_planned_date'), render: (o) => <span className="num">{formatDate(o.plannedDate)}</span> },
          { header: t('status'), render: (o) => <StatusBadge prefix="cash_status_" status={o.status} tone={ORDER_TONE[o.status]} /> },
          { header: '', render: (o) => <OrderActions order={o} /> },
        ]}
      />
    </>
  );
}

function Routes({ branches }: { branches: CashBranch[] }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const routes = useApi(() => cashApi.listRoutes());
  const orders = useApi(() => cashApi.listOrders());
  if (!routes.data) return <Loading />;
  if (!routes.data.length) return <Empty text={t('empty')} />;
  const tone = (r: CashRoute) => (r.status === 'completed' ? 'ok' : r.status === 'in_transit' ? 'info' : 'muted');
  return (
    <div className="grid grid-2" style={{ padding: 16 }}>
      {routes.data.map((r) => {
        const done = r.stops.filter((s) => s.done).length;
        return (
          <div key={r.id} className="card" style={{ boxShadow: 'none' }}>
            <div className="card-head">
              <div>
                <div className="doc-num" style={{ color: 'var(--brand-700)', fontWeight: 600 }}>
                  {r.number}
                </div>
                <div className="muted small">
                  {formatDate(r.date)} · {t('cash_vehicle')}: {r.vehicle} · {r.distanceKm} km
                </div>
              </div>
              <Badge tone={tone(r)}>{t(tk('cash_route_', r.status))}</Badge>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="small">
                <span className="muted">{t('cash_crew')}: </span>
                {r.crew.join(', ')}
              </div>
              <Progress pct={Math.round((done / r.stops.length) * 100)} />
              <ul className="timeline">
                {r.stops.map((s, i) => {
                  const b = branches.find((x) => x.id === s.branchId);
                  const order = orders.data?.find((o) => o.id === s.orderId);
                  return (
                    <li key={i}>
                      <span className="dot" style={s.done ? undefined : { background: 'var(--border-strong)', boxShadow: '0 0 0 3px var(--muted-bg)' }} />
                      <div>
                        <div className="what" style={s.done ? undefined : { color: 'var(--text-2)' }}>
                          {s.time} · {b ? <Link to={`/cash/${b.id}`}>{loc(b.name)}</Link> : s.branchId}
                        </div>
                        {order && (
                          <div className="meta">
                            {order.number} · {t(tk('cash_type_', order.type))} · {money(order.amount, order.currency)}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {r.status !== 'completed' && cashCanEdit(user) && (
                <button
                  className="btn btn-sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={async () => {
                    try {
                      await cashApi.advanceRoute(r.id, user);
                      toast(`${r.number}: ${t('cash_route_updated')}`);
                    } catch (e) {
                      toast(`${r.number}: ${errText(e, t)}`);
                    }
                  }}
                >
                  {r.status === 'planned' ? t('cash_route_start') : t('cash_route_next_stop')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Economics({ branches }: { branches: CashBranch[] }) {
  const { t, loc, lang } = useSession();
  const eco = useApi(() => cashApi.economics());
  const trend = useApi(() => cashApi.monthlyTrend());
  if (!eco.data || !trend.data) return <Loading />;
  const code = (id: string) => branches.find((b) => b.id === id)?.code ?? id;
  const totals = Object.fromEntries(CASH_COST_ITEMS.map((k) => [k, eco.data!.reduce((s, e) => s + e.costs[k], 0)])) as Record<string, number>;
  const totalCost = Object.values(totals).reduce((a, b) => a + b, 0);
  const sorted = [...eco.data].sort((a, b) => a.costPerMln - b.costPerMln);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="grid grid-main" style={{ padding: 16 }}>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            {t('cash_income_vs_cost')} · {t('cash_period_quarter')}
          </div>
          <BarChart
            data={eco.data.map((e) => ({ label: code(e.branchId), values: [bln(e.income), bln(e.totalCost)] }))}
            series={[{ name: t('cash_income') }, { name: t('cash_total_cost'), color: 'var(--accent)' }]}
            format={(n) => String(n).replace('.', decimalSep())}
          />
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            {t('cash_cost_structure')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {CASH_COST_ITEMS.map((k) => {
              const pct = Math.round(((totals[k] ?? 0) / totalCost) * 100);
              return (
                <div key={k}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }} className="small">
                    <span>{t(tk('cash_cost_', k))}</span>
                    <span className="num muted">
                      {formatMoneyShort(totals[k] ?? 0, lang)} · {pct}%
                    </span>
                  </div>
                  <Progress pct={pct} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <div className="small muted" style={{ marginBottom: 6 }}>
          {t('cash_trend')}
        </div>
        <LineChart
          height={180}
          labels={trend.data.map((m) => m.month)}
          series={[
            { name: t('cash_income'), values: trend.data.map((m) => bln(m.income)) },
            { name: t('cash_total_cost'), values: trend.data.map((m) => bln(m.cost)), color: 'var(--accent)' },
          ]}
          format={(n) => String(n).replace('.', decimalSep())}
        />
      </div>
      <DataTable
        rows={sorted}
        rowKey={(e) => e.branchId}
        onRowClick={(e) => navigate(`/cash/${e.branchId}`)}
        columns={[
          {
            header: t('cash_branch'),
            render: (e) => {
              const b = branches.find((x) => x.id === e.branchId);
              return b ? loc(b.name) : e.branchId;
            },
          },
          { header: t('cash_volume'), align: 'right', render: (e) => formatMoneyShort(e.volume, lang) },
          { header: t('cash_income'), align: 'right', render: (e) => formatMoneyShort(e.income, lang) },
          { header: t('cash_total_cost'), align: 'right', render: (e) => formatMoneyShort(e.totalCost, lang) },
          {
            header: t('cash_margin'),
            align: 'right',
            render: (e) => <span style={{ color: e.margin < 0 ? 'var(--danger)' : 'var(--ok)', fontWeight: 600 }}>{formatMoneyShort(e.margin, lang)}</span>,
          },
          { header: t('cash_margin_pct'), align: 'right', render: (e) => `${String(e.marginPct).replace('.', decimalSep())}%` },
          {
            header: t('cash_cost_per_mln'),
            align: 'right',
            render: (e) => (
              <>
                {formatNumber(e.costPerMln)} {currencyLabel()} {e.margin < 0 && <Badge tone="danger">{t('cash_loss_making')}</Badge>}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
