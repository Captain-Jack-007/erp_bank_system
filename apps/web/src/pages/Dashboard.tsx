import { api, currencyLabel, formatDate, formatMoneyShort, procurementTotal, tk } from '@xb/shared';
import { Card, Empty, Loading, Progress, Stat, StatusBadge } from '../components/ui';
import { Link, navigate } from '../lib/router';
import { useSession, useUser } from '../lib/session';
import { useApi, useLookups } from '../lib/useApi';
import { TaskRow } from './Approvals';

export function DashboardPage() {
  const { t, loc, lang } = useSession();
  const user = useUser();
  const lk = useLookups();
  const stats = useApi(() => api.getDashboard(user), [user.id]);
  const tasks = useApi(() => api.listApprovals(user), [user.id]);
  const recent = useApi(() => api.listProcurement());
  const s = stats.data;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            {t('dashGreeting')}, {user.fullName.split(' ')[1] ?? user.fullName}
          </h1>
          <p>
            {loc(user.position)} · {t(tk('role_', user.role))}
          </p>
        </div>
      </div>

      <div className="grid grid-4">
        <Stat label={t('dashPending')} value={s?.pendingApprovals ?? '—'} tone="accent" icon="check" foot={<Link to="/approvals">{t('open')} →</Link>} />
        <Stat label={t('dashOpenRequests')} value={s?.openRequests ?? '—'} icon="cart" foot={<Link to="/procurement">{t('open')} →</Link>} />
        <Stat label={t('dashActiveContracts')} value={s?.activeContracts ?? '—'} icon="file" foot={<Link to="/contracts">{s ? `${formatMoneyShort(s.activeContractsAmount, lang)} ${currencyLabel(lang)}` : t('open')} →</Link>} />
        <Stat label={t('dashOverdue')} value={s?.overduePayments ?? '—'} tone={s?.overduePayments ? 'alert' : undefined} icon="alert" foot={<Link to="/contracts?overdue=1">{t('open')} →</Link>} />
      </div>

      <div className="grid grid-main">
        <Card title={t('dashMyTasks')} actions={<Link to="/approvals" className="small">{t('navApprovals')} →</Link>} flush>
          {tasks.loading && !tasks.data ? (
            <Loading />
          ) : tasks.data?.length ? (
            tasks.data.slice(0, 5).map((task) => <TaskRow key={task.id} task={task} compact />)
          ) : (
            <Empty text={t('approvalsEmpty')} icon="check" />
          )}
        </Card>

        <Card title={`${t('dashBudgetLines')} · ${s?.budgetUsedPct ?? '—'}%`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {lk.budgetLines.map((b) => {
              const pct = Math.round((b.spent / b.planned) * 100);
              return (
                <div key={b.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{loc(b.name)}</span>
                    <span className="num muted small">
                      {formatMoneyShort(b.spent, lang)} / {formatMoneyShort(b.planned, lang)}
                    </span>
                  </div>
                  <Progress pct={pct} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title={t('dashRecent')} actions={<Link to="/procurement" className="small">{t('navProcurement')} →</Link>} flush>
        {recent.loading && !recent.data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('number')}</th>
                  <th>{t('title')}</th>
                  <th>{t('department')}</th>
                  <th className="right">{t('amount')}</th>
                  <th>{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.data?.slice(0, 5).map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/procurement/${p.id}`)}>
                    <td className="doc-num">{p.number}</td>
                    <td>
                      {p.title}
                      <div className="sub">{formatDate(p.createdAt)}</div>
                    </td>
                    <td className="muted">{lk.department(p.departmentId)?.code}</td>
                    <td className="right num">{formatMoneyShort(procurementTotal(p.items), lang)}</td>
                    <td>
                      <StatusBadge prefix="pstatus_" status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
