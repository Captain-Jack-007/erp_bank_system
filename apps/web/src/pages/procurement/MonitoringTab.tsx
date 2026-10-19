// Мониторинг и аналитика закупок (PR-PROC-025, 041…046): дашборд со статусами, воронка, просрочки,
// отчёт по заявкам (отправлено/на исполнении/возвращено/принято/исполнено), анализ цен и экономии,
// сводный журнал операций модуля.
import { useState } from 'react';
import { formatDate, formatDateTime, formatMoney, formatMoneyShort, procApi, tk } from '@xb/shared';
import { BarChart, Card, DataTable, Input, Select, Stat } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { AuditActionBadge } from '../../components/FieldHistory';
import { Link } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Segmented } from '../../components/flow';

export function MonitoringTab() {
  const { t, loc } = useSession();
  const lk = useLookups();
  const [view, setView] = useState<'dash' | 'report' | 'analysis' | 'log'>('dash');
  const dash = useApi(() => procApi.dashboard(), []);
  const [branch, setBranch] = useState<'all' | 'ho' | 'branches'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const report = useApi(() => procApi.requestReport({ branch, ...(from ? { from } : {}), ...(to ? { to } : {}) }), [branch, from, to]);
  const analysis = useApi(() => procApi.analysis(), []);
  const [q, setQ] = useState('');
  const log = useApi(() => procApi.operations({ q }), [q]);
  const d = dash.data;
  const unitName = (u: string) => (lk.department(u) ? loc(lk.department(u)!.name) : u);
  const maxFunnel = Math.max(1, ...(d?.funnel.map((f) => f.value) ?? [1]));

  return (
    <div className="pc-stack pc-pad">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'dash', label: t('proc_mon_dash') },
          { value: 'report', label: t('proc_mon_report') },
          { value: 'analysis', label: t('proc_mon_analysis') },
          { value: 'log', label: t('proc_mon_log') },
        ]}
      />
      {view === 'dash' && d && (
        <>
          <div className="pc-kpis k5">
            <Stat label={t('proc_kpiTotal')} value={d.total} icon="cart" />
            <Stat label={t('proc_kpiAmount')} value={formatMoneyShort(d.amount)} icon="wallet" />
            <Stat label={t('proc_kpiRegion')} value={d.regionQueue} icon="inbox" />
            <Stat label={t('proc_kpiClaims')} value={d.openClaims} icon="alert" tone={d.openClaims ? 'alert' : undefined} />
            <Stat label={t('proc_kpiOverdue')} value={d.overdue.length} icon="clock" tone={d.overdue.length ? 'alert' : undefined} />
          </div>
          <div className="grid grid-2">
            <Card title={t('proc_byStatus')}>
              <BarChart data={d.byStatus.map((s) => ({ label: t(tk('pstatus_', s.key)), values: [s.value] }))} series={[{ name: t('proc_count') }]} />
            </Card>
            <Card title={t('proc_byMethod')}>
              <BarChart data={d.byMethod.map((s) => ({ label: t(tk('method_', s.key)), values: [s.value] }))} series={[{ name: t('amount') }]} format={(n) => formatMoneyShort(n)} />
            </Card>
            <Card title={t('proc_funnel')}>
              <div className="pc-funnel">
                {d.funnel.map((f) => (
                  <div key={f.key} className="pc-funnel-row">
                    <span>{t(tk('proc_funnel_', f.key))}</span>
                    <div className="pc-funnel-bar" style={{ width: `${(f.value / maxFunnel) * 100}%` }} />
                    <b className="num">{f.value}</b>
                  </div>
                ))}
              </div>
            </Card>
            <Card title={t('proc_byDept')}>
              <BarChart data={d.byDept.slice(0, 6).map((s) => ({ label: lk.department(s.key)?.code ?? s.key, values: [s.value] }))} series={[{ name: t('amount') }]} format={(n) => formatMoneyShort(n)} />
            </Card>
          </div>
          <Card title={t('proc_overdueList')} flush>
            <DataTable
              rows={d.overdue}
              rowKey={(r) => r.id}
              emptyText={t('proc_noOverdue')}
              columns={[
                { header: t('number'), render: (r) => <Link to={`/procurement/${r.id}`}>{r.number}</Link> },
                { header: t('title'), render: (r) => r.title },
                { header: t('neededBy'), render: (r) => formatDate(r.neededBy) },
                { header: t('status'), render: (r) => t(tk('pstatus_', r.status)) },
              ]}
            />
          </Card>
        </>
      )}
      {view === 'report' && (
        <Card
          title={t('proc_mon_report')}
          actions={
            <span className="pc-row">
              <Select<'all' | 'ho' | 'branches'> value={branch} onChange={setBranch} ariaLabel={t('proc_branch')} options={[{ value: 'all', label: t('all') }, { value: 'ho', label: t('proc_ho') }, { value: 'branches', label: t('proc_branches') }]} />
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={t('proc_from')} />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={t('proc_to')} />
              <ExportButton
                filename={t('proc_mon_report')}
                rows={report.data ?? []}
                columns={[
                  { header: t('proc_unit'), value: (r) => unitName(r.unit) },
                  { header: t('proc_r_sent'), value: (r) => r.sent, format: 'integer', total: true },
                  { header: t('proc_r_inWork'), value: (r) => r.inWork, format: 'integer', total: true },
                  { header: t('proc_r_returned'), value: (r) => r.returned, format: 'integer', total: true },
                  { header: t('proc_r_accepted'), value: (r) => r.accepted, format: 'integer', total: true },
                  { header: t('proc_r_executed'), value: (r) => r.executed, format: 'integer', total: true },
                  { header: t('amount'), value: (r) => r.amount, format: 'money', total: true },
                ]}
              />
            </span>
          }
          flush
        >
          <DataTable
            rows={report.data}
            loading={report.loading}
            rowKey={(r) => r.unit}
            columns={[
              { header: t('proc_unit'), render: (r) => unitName(r.unit) },
              { header: t('proc_r_sent'), align: 'right', render: (r) => r.sent },
              { header: t('proc_r_inWork'), align: 'right', render: (r) => r.inWork },
              { header: t('proc_r_returned'), align: 'right', render: (r) => r.returned },
              { header: t('proc_r_accepted'), align: 'right', render: (r) => r.accepted },
              { header: t('proc_r_executed'), align: 'right', render: (r) => r.executed },
              { header: t('amount'), align: 'right', render: (r) => formatMoney(r.amount) },
            ]}
          />
        </Card>
      )}
      {view === 'analysis' && analysis.data && (
        <>
          <div className="pc-kpis">
            <Stat label={t('proc_totalSaving')} value={formatMoneyShort(analysis.data.totalSaving)} icon="percent" />
            <Stat label={t('proc_avgLead')} value={`${analysis.data.avgLead} ${t('proc_days')}`} icon="clock" />
            <Stat label={t('proc_contractsCount')} value={analysis.data.savings.length} icon="file" />
            <Stat label={t('proc_suppliers')} value={analysis.data.suppliers.length} icon="users" />
          </div>
          <Card title={t('proc_savings')} actions={<ExportButton filename={t('proc_savings')} rows={analysis.data.savings} columns={[{ header: t('navContracts'), value: (s) => s.number }, { header: t('procurementRequests'), value: (s) => s.request }, { header: t('proc_planned'), value: (s) => s.planned, format: 'money', total: true }, { header: t('proc_contracted'), value: (s) => s.contracted, format: 'money', total: true }, { header: t('proc_saving'), value: (s) => s.saving, format: 'money', total: true }, { header: '%', value: (s) => s.savingPct, format: 'number' }, { header: t('proc_leadDays'), value: (s) => s.leadDays, format: 'integer' }]} />} flush>
            <DataTable
              rows={analysis.data.savings}
              rowKey={(s) => s.contractId}
              columns={[
                { header: t('navContracts'), render: (s) => <Link to={`/contracts/${s.contractId}`}>{s.number}</Link> },
                { header: t('method'), render: (s) => t(tk('method_', s.method)) },
                { header: t('proc_planned'), align: 'right', render: (s) => formatMoney(s.planned) },
                { header: t('proc_contracted'), align: 'right', render: (s) => formatMoney(s.contracted) },
                { header: t('proc_saving'), align: 'right', render: (s) => `${formatMoney(s.saving)} (${s.savingPct}%)` },
                { header: t('proc_leadDays'), align: 'right', render: (s) => s.leadDays },
              ]}
            />
          </Card>
          <div className="grid grid-2">
            <Card title={t('proc_priceAnalysis')} flush>
              <DataTable
                rows={analysis.data.prices}
                rowKey={(p) => `${p.request}-${p.name}`}
                columns={[
                  { header: t('itemName'), render: (p) => <>{p.name}<div className="sub">{p.request}</div></> },
                  { header: t('unitPrice'), align: 'right', render: (p) => formatMoney(p.price) },
                  { header: t('proc_refPrice'), align: 'right', render: (p) => formatMoney(p.ref) },
                  { header: '%', align: 'right', render: (p) => <span style={{ color: p.deviationPct > 30 ? 'var(--danger)' : undefined }}>{p.deviationPct > 0 ? '+' : ''}{p.deviationPct}</span> },
                ]}
              />
            </Card>
            <Card title={t('proc_supplierShare')}>
              <BarChart data={analysis.data.suppliers.slice(0, 6).map((s) => ({ label: (lk.counterparty(s.id)?.name ?? s.id).replace(/^(OOO|MChJ|YaTT|AJ)\s*/, '').slice(0, 14), values: [s.amount] }))} series={[{ name: t('amount') }]} format={(n) => formatMoneyShort(n)} />
            </Card>
          </div>
        </>
      )}
      {view === 'log' && (
        <Card
          title={t('proc_mon_log')}
          actions={
            <span className="pc-row">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} />
              <ExportButton filename={t('proc_mon_log')} rows={log.data ?? []} columns={[{ header: t('date'), value: (e) => e.at }, { header: t('proc_user'), value: (e) => e.userName }, { header: t('proc_action'), value: (e) => e.action }, { header: t('proc_object'), value: (e) => `${e.entity} ${e.entityLabel ?? ''}` }, { header: t('description'), value: (e) => e.details ?? '' }]} />
            </span>
          }
          flush
        >
          <DataTable
            rows={log.data?.slice(0, 200)}
            loading={log.loading}
            rowKey={(e) => e.id}
            columns={[
              { header: t('date'), render: (e) => <span className="num small">{formatDateTime(e.at)}</span> },
              { header: t('proc_user'), render: (e) => e.userName },
              { header: t('proc_action'), render: (e) => <AuditActionBadge action={e.action} result={e.result} /> },
              { header: t('proc_object'), render: (e) => <>{e.entity}<div className="sub">{e.entityLabel}</div></> },
              { header: t('description'), render: (e) => <span className="small">{e.details}</span> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
