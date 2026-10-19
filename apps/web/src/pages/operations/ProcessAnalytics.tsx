// P2-FINPLAN: прежний экран «Анализ операций» (процессы XB-ERP) перенесён в подвкладку модуля себестоимости.
import { useEffect, useState } from 'react';
import { formatDecimal, formatNumber, MONTHS_SHORT as MONTH_SHORT, OPERATIONS_MODULES, operationsApi, tk, type OperationsFilter, type OperationsModuleKey } from '@xb/shared';
import { Badge, BarChart, Card, DataTable, Empty, FilterBar, LineChart, Loading, Progress, Stat } from '../../components/ui';
import { useLocation } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';

/** Анализ процессов XB-ERP (нагрузка, SLA, узкие места) — подвкладка модуля 4.2.16. */
export function ProcessAnalytics() {
  const { t, loc, lang } = useSession();
  const lk = useLookups();
  const [months, setMonths] = useState<OperationsFilter['months']>(6);
  const path = useLocation();
  const moduleFromPath = () => {
    const v = new URLSearchParams(path.split('?')[1] ?? '').get('module');
    return OPERATIONS_MODULES.some((m) => m.key === v) ? (v as OperationsModuleKey) : null;
  };
  const [module, setModule] = useState<OperationsModuleKey | ''>(() => moduleFromPath() ?? '');
  // Переход из глобального поиска (/operations?module=…) выставляет фильтр и на уже открытом экране.
  useEffect(() => {
    const m = moduleFromPath();
    if (m) setModule(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const data = useApi(() => operationsApi.getAnalysis({ months, ...(module ? { module } : {}) }), [months, module]);
  const a = data.data;
  const monthLabel = (m: string) => `${MONTH_SHORT[lang][Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
  const moduleName = (k: string) => {
    const m = OPERATIONS_MODULES.find((x) => x.key === k);
    return m ? loc(m.name) : k;
  };
  const hrs = (n: number) => `${formatDecimal(n)} ${t('operations_hours')}`;
  const worst = a?.bottlenecks[0];
  const maxActions = Math.max(1, ...(a?.departments.map((d) => d.actions) ?? [1]));

  return (
    <>
      <Card flush>
        <FilterBar>
          <select className="select" value={months} onChange={(e) => setMonths(Number(e.target.value) as OperationsFilter['months'])} aria-label={t('operations_period')}>
            <option value={3}>
              {t('operations_period')}: {t('operations_period_3')}
            </option>
            <option value={6}>
              {t('operations_period')}: {t('operations_period_6')}
            </option>
          </select>
          <select className="select" value={module} onChange={(e) => setModule(e.target.value as OperationsModuleKey | '')} aria-label={t('operations_module')}>
            <option value="">{t('operations_all_modules')}</option>
            {OPERATIONS_MODULES.map((m) => (
              <option key={m.key} value={m.key}>
                {loc(m.name)}
              </option>
            ))}
          </select>
          {worst && worst.breachPct > 0 && (
            <span className="small" style={{ marginLeft: 'auto' }}>
              {t('operations_worst')}: <b>{t(tk('role_', worst.role))}</b> · <Badge tone="danger">{formatDecimal(worst.breachPct)}%</Badge>
            </span>
          )}
        </FilterBar>
      </Card>

      {!a ? (
        <Card>
          <Loading />
        </Card>
      ) : (
        <>
          <div className="grid grid-4">
            <Stat label={t('operations_kpi_processed')} value={formatNumber(a.kpis.processed)} tone="accent" icon="file" />
            <Stat label={t('operations_kpi_cycle')} value={hrs(a.kpis.avgCycleHours)} icon="clock" />
            <Stat label={t('operations_kpi_sla')} value={`${formatDecimal(a.kpis.slaBreachPct)}%`} tone={a.kpis.slaBreachPct > 15 ? 'alert' : undefined} icon="alert" />
            <Stat label={t('operations_kpi_open')} value={a.kpis.openNow} icon="check" foot={`${t('operations_kpi_overdue')}: ${a.kpis.overdueNow}`} />
          </div>

          <div className="grid grid-2">
            <Card title={module ? `${t('operations_created')} / ${t('operations_closed')} · ${moduleName(module)}` : t('operations_by_module')}>
              {module ? (
                <BarChart
                  data={a.trend.map((m) => ({ label: monthLabel(m.month), values: [m.created, m.closed] }))}
                  series={[{ name: t('operations_created') }, { name: t('operations_closed'), color: 'var(--accent)' }]}
                  format={formatNumber}
                />
              ) : (
                <BarChart
                  data={a.byModule.slice(0, 7).map((m) => ({ label: moduleName(m.module).slice(0, 12), values: [m.total] }))}
                  series={[{ name: t('operations_created') }]}
                  format={formatNumber}
                />
              )}
            </Card>
            <Card title={t('operations_trend')}>
              <LineChart
                labels={a.trend.map((m) => monthLabel(m.month))}
                series={[
                  { name: t('operations_created'), values: a.trend.map((m) => m.created) },
                  { name: t('operations_closed'), values: a.trend.map((m) => m.closed), color: 'var(--accent)' },
                  { name: t('operations_backlog'), values: a.trend.map((m) => m.backlog), color: 'var(--danger)' },
                ]}
                format={formatNumber}
              />
            </Card>
          </div>

          <Card title={t('operations_bottlenecks')} flush>
            {a.bottlenecks.length ? (
              <DataTable
                rows={a.bottlenecks}
                rowKey={(r) => r.role}
                columns={[
                  { header: t('operations_role'), render: (r) => <b>{t(tk('role_', r.role))}</b> },
                  { header: t('operations_steps_count'), align: 'right', render: (r) => formatNumber(r.steps) },
                  { header: t('operations_avg_step'), align: 'right', render: (r) => formatDecimal(r.avgHours) },
                  { header: t('operations_sla'), align: 'right', render: (r) => r.slaHours },
                  { header: t('operations_breaches'), align: 'right', render: (r) => r.breaches },
                  {
                    header: t('operations_breach_pct'),
                    width: 200,
                    render: (r) => (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1 }} className={`progress ${r.breachPct >= 30 ? 'over' : r.breachPct >= 15 ? 'high' : ''}`}>
                          <span style={{ width: `${Math.min(100, r.breachPct * 2)}%` }} />
                        </div>
                        <span className="num small">{formatDecimal(r.breachPct)}%</span>
                      </div>
                    ),
                  },
                  { header: t('operations_open_now'), align: 'right', render: (r) => r.openNow },
                  { header: t('operations_overdue_now'), align: 'right', render: (r) => (r.overdueNow ? <Badge tone="danger">{r.overdueNow}</Badge> : '0') },
                ]}
              />
            ) : (
              <Empty text={t('operations_no_data')} icon="chart" />
            )}
          </Card>

          <div className="grid grid-2">
            <Card title={t('operations_cycle')} flush>
              {a.cycle.length ? (
                <DataTable
                  rows={a.cycle}
                  rowKey={(r) => r.entity}
                  columns={[
                    { header: t('operations_doc_type'), render: (r) => t(tk('entity_', r.entity)) },
                    { header: t('operations_steps_count'), align: 'right', render: (r) => r.count },
                    { header: t('operations_avg_cycle'), align: 'right', render: (r) => formatDecimal(r.avgHours) },
                    { header: t('operations_p90'), align: 'right', render: (r) => formatDecimal(r.p90Hours) },
                    { header: t('operations_reject_pct'), align: 'right', render: (r) => `${formatDecimal(r.rejectPct)}%` },
                  ]}
                />
              ) : (
                <Empty text={t('operations_no_data')} icon="chart" />
              )}
            </Card>
            <Card title={t('operations_activity')} flush>
              <DataTable
                rows={a.departments}
                rowKey={(r) => r.departmentId}
                columns={[
                  { header: t('department'), render: (r) => lk.department(r.departmentId)?.code ?? r.departmentId },
                  {
                    header: t('operations_actions'),
                    width: 190,
                    render: (r) => (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <Progress pct={Math.round((r.actions / maxActions) * 100)} />
                        </div>
                        <span className="num small">{formatNumber(r.actions)}</span>
                      </div>
                    ),
                  },
                  { header: t('operations_active_users'), align: 'right', render: (r) => r.activeUsers },
                  { header: t('operations_per_user'), align: 'right', render: (r) => r.perUser },
                ]}
              />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
