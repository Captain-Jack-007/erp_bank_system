import { useEffect, useState } from 'react';
import { navigate, useQuery } from '../../lib/router';
import {
  budgetingApi,
  formatDate,
  formatDecimal,
  formatMoney,
  formatMoneyShort,
  api,
  tk,
  type BudgetingAlertLevel,
  type BudgetingArticleGroup,
  type BudgetingChange,
  type BudgetingDepartmentView,
  type BudgetingLineView,
} from '@xb/shared';
import {
  Badge,
  BarChart,
  Card,
  DataTable,
  Empty,
  FilterBar,
  Loading,
  Modal,
  PageHeader,
  Progress,
  RouteSteps,
  Stat,
  StatusBadge,
  Tabs,
  Timeline,
  type Column,
  type Tone,
} from '../../components/ui';
import { Icon } from '../../components/icons';
import { ExportButton } from '../../components/Export';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { MONTHS, MONTHS_FULL, usePick, varianceStyle } from './shared';
import { ChangeRequestModal } from './ChangeRequestModal';
import { ControlTab, useSourceLabel } from './ControlTab';
import { RollingTab, ScenariosTab } from './PlanningTabs';
import { ZbbTab } from './ZbbTab';
import { CapexTab } from './CapexTab';
import { BranchesTab, PeriodsTab } from './PeriodsTab';
import './budgeting.css';

type Tab = 'overview' | 'lines' | 'changes' | 'control' | 'rolling' | 'scenarios' | 'zbb' | 'capex' | 'branches' | 'periods';
const TABS: Tab[] = ['overview', 'lines', 'changes', 'control', 'rolling', 'scenarios', 'zbb', 'capex', 'branches', 'periods'];
export interface BudgetingDeepLink {
  changeId?: string;
  zbbId?: string;
  capexId?: string;
  projectId?: string;
  overrunId?: string;
}
const ALERT_TONE: Record<BudgetingAlertLevel, Tone> = { ok: 'ok', warning: 'warn', overrun: 'danger' };

export function AlertBadge({ level }: { level: BudgetingAlertLevel }) {
  return <StatusBadge prefix="budgeting_alert_" status={level} tone={ALERT_TONE[level]} />;
}

export function BudgetingPage({ changeId, zbbId, capexId, projectId, overrunId }: BudgetingDeepLink = {}) {
  const { t, lang } = useSession();
  const p = usePick();
  const query = useQuery();
  const linkTab: Tab | undefined = changeId ? 'changes' : zbbId ? 'zbb' : capexId || projectId ? 'capex' : overrunId ? 'control' : undefined;
  const qTab = query.get('tab') as Tab | null;
  const [tab, setTabState] = useState<Tab>(linkTab ?? (qTab && TABS.includes(qTab) ? qTab : 'overview'));
  const deepLink = !!linkTab;
  const setTab = (v: Tab) => {
    setTabState(v);
    if (deepLink || qTab) navigate(v === 'overview' ? '/budgeting' : `/budgeting?tab=${v}`);
  };
  // Переход по ссылке (поиск, согласования, уведомления) — открыть нужную вкладку.
  useEffect(() => {
    if (linkTab) setTabState(linkTab);
    else if (qTab && TABS.includes(qTab)) setTabState(qTab);
  }, [linkTab, qTab]);
  const [creating, setCreating] = useState(false);
  const ov = useApi(() => budgetingApi.getOverview());
  const o = ov.data;
  const short = (v: number) => formatMoneyShort(v, lang);

  return (
    <>
      <PageHeader
        title={t('budgeting_title')}
        subtitle={`${t('tzLabel')} 4.2.13 · ${t('budgeting_year')} ${budgetingApi.year} · ${t('budgeting_closed')} ${MONTHS_FULL[lang][budgetingApi.closedMonths - 1]}`}
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> {t('budgeting_newChange')}
          </button>
        }
      />

      <div className="grid grid-4">
        <Stat label={t('budgeting_planYear')} value={o ? short(o.total.planYear) : '—'} icon="wallet" tone="accent" foot={o ? `OPEX ${short(o.opex.planYear)} · CAPEX ${short(o.capex.planYear)}` : undefined} />
        <Stat
          label={t('budgeting_actualYtd')}
          value={o ? short(o.total.actualYtd) : '—'}
          icon="chart"
          foot={o ? `${t('budgeting_ytdExecution')}: ${formatDecimal(o.total.ytdPct)}% · ${t('budgeting_execution')}: ${formatDecimal(o.total.executionPct)}%` : undefined}
        />
        <Stat
          label={t('budgeting_forecastYear')}
          value={o ? short(o.total.forecastYear) : '—'}
          icon="clock"
          foot={o ? <span style={varianceStyle(o.total.forecastYear - o.total.planYear)}>{o.total.forecastYear - o.total.planYear > 0 ? '+' : ''}{short(o.total.forecastYear - o.total.planYear)} {t('budgeting_variance').toLowerCase()}</span> : undefined}
        />
        <Stat
          label={t('budgeting_alerts')}
          value={o ? `${o.alerts.overrun} / ${o.alerts.warning}` : '—'}
          icon="alert"
          tone={o?.alerts.overrun ? 'alert' : undefined}
          foot={o ? `${t('budgeting_alertsFoot')} · ${t('budgeting_pendingChanges')}: ${o.pendingChanges}` : undefined}
        />
      </div>

      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'overview', label: t('budgeting_tab_overview') },
            { value: 'lines', label: t('budgeting_tab_lines') },
            { value: 'changes', label: t('budgeting_tab_changes'), ...(o ? { count: o.pendingChanges } : {}) },
            { value: 'control', label: p('Бюджетный контроль', 'Byudjet nazorati', 'Budget control'), ...(o ? { count: o.pendingOverruns } : {}) },
            { value: 'rolling', label: p('Скользящий прогноз', 'Sirpanuvchi prognoz', 'Rolling forecast') },
            { value: 'scenarios', label: p('Сценарии', 'Ssenariylar', 'Scenarios') },
            { value: 'zbb', label: 'ZBB 2027' },
            { value: 'capex', label: p('CAPEX и инвестпроекты', 'CAPEX va investitsiya loyihalari', 'CAPEX & projects') },
            { value: 'branches', label: p('МВЗ и филиалы', 'MXJ va filiallar', 'Cost centres & branches') },
            { value: 'periods', label: p('Закрытие периодов', 'Davrlarni yopish', 'Period close') },
          ]}
        />
        {tab === 'overview' && <OverviewTab />}
        {tab === 'lines' && <LinesTab />}
        {tab === 'changes' && <ChangesTab changeId={changeId} />}
        {tab === 'control' && <ControlTab overrunId={overrunId} />}
        {tab === 'rolling' && <RollingTab />}
        {tab === 'scenarios' && <ScenariosTab />}
        {tab === 'zbb' && <ZbbTab openId={zbbId} />}
        {tab === 'capex' && <CapexTab capexId={capexId} projectId={projectId} />}
        {tab === 'branches' && <BranchesTab />}
        {tab === 'periods' && <PeriodsTab />}
      </Card>

      {creating && (
        <ChangeRequestModal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setTab('changes');
          }}
        />
      )}
    </>
  );
}

function GroupDeptFilter({ group, setGroup, dept, setDept }: { group: BudgetingArticleGroup | ''; setGroup: (g: BudgetingArticleGroup | '') => void; dept?: string; setDept?: (d: string) => void }) {
  const { t, loc } = useSession();
  const lk = useLookups();
  return (
    <>
      <select className="select" value={group} onChange={(e) => setGroup(e.target.value as BudgetingArticleGroup | '')} aria-label={t('budgeting_group')}>
        <option value="">{t('budgeting_group')}: {t('all')}</option>
        <option value="opex">{t('budgeting_group_opex')}</option>
        <option value="capex">{t('budgeting_group_capex')}</option>
      </select>
      {setDept && (
        <select className="select" style={{ width: 260 }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label={t('budgeting_costCenter')}>
          <option value="">{t('budgeting_costCenter')}: {t('all')}</option>
          {lk.departments.map((d) => (
            <option key={d.id} value={d.id}>{loc(d.name)}</option>
          ))}
        </select>
      )}
    </>
  );
}

function OverviewTab() {
  const { t, lang, loc } = useSession();
  const lk = useLookups();
  const [group, setGroup] = useState<BudgetingArticleGroup | ''>('');
  const [dept, setDept] = useState('');
  const filter = { ...(group ? { group } : {}), ...(dept ? { departmentId: dept } : {}) };
  const months = useApi(() => budgetingApi.monthly(filter), [group, dept]);
  const deps = useApi(() => budgetingApi.listDepartments(group ? { group } : {}), [group]);
  const alerts = useApi(() => budgetingApi.listLines({ ...filter, alertsOnly: true }), [group, dept]);
  const articles = useApi(() => budgetingApi.listArticles());
  const short = (v: number) => formatMoneyShort(v, lang);
  const closed = budgetingApi.closedMonths;

  return (
    <>
      <FilterBar>
        <GroupDeptFilter group={group} setGroup={setGroup} dept={dept} setDept={setDept} />
        <span className="muted small">{t('budgeting_rules')}</span>
      </FilterBar>
      <div className="grid grid-main" style={{ padding: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Card title={t('budgeting_monthly')}>
            {months.loading && !months.data ? (
              <Loading />
            ) : (
              <BarChart
                data={(months.data ?? []).map((m) => ({
                  label: MONTHS[lang][m.month]!,
                  values: [m.plan, m.month < closed ? m.actual : 0, m.month >= closed ? m.forecast : 0],
                }))}
                series={[
                  { name: t('budgeting_plan'), color: 'var(--border-strong)' },
                  { name: t('budgeting_actual'), color: 'var(--brand-600)' },
                  { name: t('budgeting_forecast'), color: 'var(--accent)' },
                ]}
                format={short}
              />
            )}
          </Card>
          <Card
            title={t('budgeting_byDepartment')}
            flush
            actions={
              <ExportButton<BudgetingDepartmentView>
                filename="budget-by-department"
                rows={deps.data ?? []}
                columns={[
                  { header: t('budgeting_costCenter'), value: (r) => (lk.department(r.departmentId) ? loc(lk.department(r.departmentId)!.name) : r.departmentId) },
                  { header: t('budgeting_planYear'), value: (r) => r.planYear, format: 'money', total: true },
                  { header: t('budgeting_actualYtd'), value: (r) => r.actualYtd, format: 'money', total: true },
                  { header: t('budgeting_forecastYear'), value: (r) => r.forecastYear, format: 'money', total: true },
                  { header: t('budgeting_execution'), value: (r) => r.executionPct, format: 'number' },
                ]}
              />
            }
          >
            <DataTable
              rows={deps.data}
              loading={deps.loading}
              rowKey={(r) => r.departmentId}
              onRowClick={(r) => setDept(r.departmentId === dept ? '' : r.departmentId)}
              columns={[
                {
                  header: t('budgeting_costCenter'),
                  render: (r) => (
                    <span style={r.departmentId === dept ? { fontWeight: 700, color: 'var(--brand-700)' } : { fontWeight: 500 }}>
                      {lk.department(r.departmentId) ? loc(lk.department(r.departmentId)!.name) : r.departmentId}
                    </span>
                  ),
                },
                { header: t('budgeting_planYear'), align: 'right', render: (r) => short(r.planYear) },
                { header: t('budgeting_actualYtd'), align: 'right', render: (r) => short(r.actualYtd) },
                { header: t('budgeting_forecastYear'), align: 'right', render: (r) => <span style={varianceStyle(r.forecastYear - r.planYear)}>{short(r.forecastYear)}</span> },
                {
                  header: t('budgeting_execution'),
                  width: 150,
                  render: (r) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1 }}><Progress pct={r.executionPct} /></div>
                      <span className="num small">{formatDecimal(r.executionPct)}%</span>
                    </div>
                  ),
                },
                { header: t('status'), render: (r) => <AlertBadge level={r.alert} /> },
              ]}
            />
          </Card>
        </div>
        <Card title={t('budgeting_topAlerts')} flush>
          {alerts.loading && !alerts.data ? (
            <Loading />
          ) : !alerts.data?.length ? (
            <Empty text={t('budgeting_noAlerts')} icon="check" />
          ) : (
            alerts.data.slice(0, 8).map((l) => {
              const art = articles.data?.find((a) => a.id === l.articleId);
              return (
                <div key={l.id} className="task" style={{ alignItems: 'flex-start' }}>
                  <div className="task-icon" style={{ background: l.alert === 'overrun' ? 'var(--danger-bg)' : 'var(--warn-bg)', color: l.alert === 'overrun' ? 'var(--danger)' : 'var(--warn)' }}>
                    <Icon name="alert" />
                  </div>
                  <div className="task-body">
                    <div className="task-title" style={{ whiteSpace: 'normal' }}>{art ? loc(art.name) : l.articleId}</div>
                    <div className="task-meta">
                      <span>{lk.department(l.departmentId)?.code}</span>
                      <span>{t('budgeting_execution')}: {formatDecimal(l.executionPct)}%</span>
                    </div>
                    <div className="task-meta">
                      <span>{t('budgeting_forecastYear')}: {short(l.forecastYear)} / {short(l.planYear)}</span>
                    </div>
                  </div>
                  <AlertBadge level={l.alert} />
                </div>
              );
            })
          )}
        </Card>
      </div>
    </>
  );
}

function LinesTab() {
  const { t, lang, loc } = useSession();
  const lk = useLookups();
  const [group, setGroup] = useState<BudgetingArticleGroup | ''>('');
  const [dept, setDept] = useState('');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [open, setOpen] = useState<BudgetingLineView | null>(null);
  const lines = useApi(() => budgetingApi.listLines({ ...(group ? { group } : {}), ...(dept ? { departmentId: dept } : {}), alertsOnly }), [group, dept, alertsOnly]);
  const articles = useApi(() => budgetingApi.listArticles());
  const art = (id: string) => articles.data?.find((a) => a.id === id);
  const short = (v: number) => formatMoneyShort(v, lang);

  const columns: Column<BudgetingLineView>[] = [
    { header: t('budgeting_costCenter'), render: (l) => <span style={{ fontWeight: 600 }}>{lk.department(l.departmentId)?.code}{l.orgUnitKey !== l.departmentId && <span className="sub" style={{ display: 'block' }}>{l.orgUnitKey}</span>}</span> },
    {
      header: t('budgeting_article'),
      render: (l) => (
        <>
          {art(l.articleId) ? loc(art(l.articleId)!.name) : l.articleId}
          <div className="sub">{art(l.articleId)?.code}</div>
        </>
      ),
    },
    { header: t('budgeting_planYear'), align: 'right', render: (l) => short(l.planYear) },
    { header: t('budgeting_planYtd'), align: 'right', render: (l) => short(l.planYtd) },
    { header: t('budgeting_actualYtd'), align: 'right', render: (l) => short(l.actualYtd) },
    { header: t('budgeting_variance'), align: 'right', render: (l) => <span style={varianceStyle(l.varianceYtd)}>{l.varianceYtd > 0 ? '+' : ''}{short(l.varianceYtd)}</span> },
    { header: t('budgeting_forecastYear'), align: 'right', render: (l) => short(l.forecastYear) },
    {
      header: t('budgeting_execution'),
      width: 140,
      render: (l) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}><Progress pct={l.executionPct} /></div>
          <span className="num small">{formatDecimal(l.executionPct)}%</span>
        </div>
      ),
    },
    { header: t('status'), render: (l) => <AlertBadge level={l.alert} /> },
  ];

  return (
    <>
      <FilterBar>
        <GroupDeptFilter group={group} setGroup={setGroup} dept={dept} setDept={setDept} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} />
          {t('budgeting_alertsOnly')}
        </label>
        <span style={{ flex: 1 }} />
        <ExportButton<BudgetingLineView>
          filename="budget-lines"
          rows={lines.data ?? []}
          columns={[
            { header: t('budgeting_costCenter'), value: (l) => lk.department(l.departmentId)?.code ?? l.departmentId },
            { header: 'Org', value: (l) => l.orgUnitKey },
            { header: t('budgeting_article'), value: (l) => (art(l.articleId) ? `${art(l.articleId)!.code} ${loc(art(l.articleId)!.name)}` : l.articleId) },
            { header: t('budgeting_planYear'), value: (l) => l.planYear, format: 'money', total: true },
            { header: t('budgeting_planYtd'), value: (l) => l.planYtd, format: 'money', total: true },
            { header: t('budgeting_actualYtd'), value: (l) => l.actualYtd, format: 'money', total: true },
            { header: t('budgeting_variance'), value: (l) => l.varianceYtd, format: 'money', total: true },
            { header: t('budgeting_forecastYear'), value: (l) => l.forecastYear, format: 'money', total: true },
            { header: t('budgeting_execution'), value: (l) => l.executionPct, format: 'number' },
            { header: t('status'), value: (l) => t(tk('budgeting_alert_', l.alert)) },
          ]}
        />
      </FilterBar>
      <DataTable rows={lines.data} loading={lines.loading} rowKey={(l) => l.id} columns={columns} onRowClick={setOpen} />
      {open && <LineModal line={open} title={`${lk.department(open.departmentId)?.code} · ${art(open.articleId) ? loc(art(open.articleId)!.name) : ''}`} onClose={() => setOpen(null)} />}
    </>
  );
}

function LineModal({ line, title, onClose }: { line: BudgetingLineView; title: string; onClose: () => void }) {
  const { t, lang, loc } = useSession();
  const p = usePick();
  const lk = useLookups();
  const srcLabel = useSourceLabel();
  const closed = budgetingApi.closedMonths;
  const short = (v: number) => formatMoneyShort(v, lang);
  const goals = useApi(() => budgetingApi.listGoals());
  const txns = useApi(() => budgetingApi.listTxns({ lineId: line.id }), [line.id]);
  const goal = goals.data?.find((g) => g.id === line.zbb?.goalId);
  return (
    <Modal title={title} onClose={onClose} footer={<button className="btn" onClick={onClose}>{t('budgeting_close')}</button>}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <AlertBadge level={line.alert} />
        <span className="small muted">{t('budgeting_execution')}: {formatDecimal(line.executionPct)}% · {t('budgeting_ytdExecution')}: {formatDecimal(line.ytdPct)}% · {p('Освоение лимита', 'Limitdan foydalanish', 'Limit usage')}: {formatDecimal(line.usagePct)}%</span>
      </div>
      <BarChart
        height={180}
        data={line.plan.map((pl, m) => ({ label: MONTHS[lang][m]!, values: [pl, m < closed ? line.actual[m]! : line.forecast[m]!] }))}
        series={[
          { name: t('budgeting_plan'), color: 'var(--border-strong)' },
          { name: `${t('budgeting_actual')} / ${t('budgeting_forecast').toLowerCase()}`, color: 'var(--brand-600)' },
        ]}
        format={short}
      />
      <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
        <dt>{t('budgeting_planYear')}</dt>
        <dd className="num">{formatMoney(line.planYear)}</dd>
        <dt>{t('budgeting_actualYtd')}</dt>
        <dd className="num">{formatMoney(line.actualYtd)}</dd>
        <dt>{p('Списано в открытом периоде', 'Ochiq davrda hisobdan chiqarilgan', 'Consumed in open period')}</dt>
        <dd className="num">{formatMoney(line.consumedOpen)}</dd>
        <dt>{p('Зарезервировано', 'Zaxiralangan', 'Reserved')}</dt>
        <dd className="num">{formatMoney(line.reservedOpen)}</dd>
        <dt>{t('budgeting_forecastYear')}</dt>
        <dd className="num">{formatMoney(line.forecastYear)}</dd>
      </dl>
      {line.zbb && (
        <div className="bud-zbb-item">
          <b>{p('ZBB-обоснование статьи', 'Moddaning ZBB asoslanishi', 'ZBB justification')}</b>
          <div className="small">{line.zbb.justification}</div>
          <div className="small">{p('Стратегическая цель', 'Strategik maqsad', 'Strategic goal')}: {goal ? `${goal.code} · ${loc(goal.name)}` : '—'}</div>
          <div className="small" style={{ color: 'var(--danger)' }}>Impact of non-funding: {line.zbb.impact}</div>
        </div>
      )}
      {!!txns.data?.length && (
        <DataTable
          rows={txns.data.slice(0, 8)}
          rowKey={(x) => x.id}
          columns={[
            { header: p('Операция', 'Operatsiya', 'Operation'), render: (x) => <Badge tone={x.kind === 'blocked' ? 'danger' : x.kind === 'consume' ? 'ok' : 'info'}>{x.kind}</Badge> },
            { header: p('Документ', 'Hujjat', 'Document'), render: (x) => <>{x.refLabel}<div className="sub">{srcLabel(x.source)} · {lk.user(x.userId)?.fullName}</div></> },
            { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (x) => short(x.amount) },
          ]}
        />
      )}
    </Modal>
  );
}

function ChangesTab({ changeId }: { changeId?: string }) {
  const { t, lang, loc } = useSession();
  const lk = useLookups();
  const changes = useApi(() => budgetingApi.listChanges());
  const articles = useApi(() => budgetingApi.listArticles());
  const [openId, setOpenId] = useState<string | null>(changeId ?? null);
  useEffect(() => {
    if (changeId) setOpenId(changeId);
  }, [changeId]);
  const artName = (id?: string) => {
    const a = articles.data?.find((x) => x.id === id);
    return a ? loc(a.name) : '—';
  };

  return (
    <>
      <FilterBar>
        <span style={{ flex: 1 }} />
        <ExportButton<BudgetingChange>
          filename="budget-changes"
          rows={changes.data ?? []}
          columns={[
            { header: t('number'), value: (c) => c.number },
            { header: t('budgeting_changeType'), value: (c) => t(tk('budgeting_type_', c.type)) },
            { header: t('budgeting_costCenter'), value: (c) => lk.department(c.departmentId)?.code ?? c.departmentId },
            { header: t('budgeting_from'), value: (c) => (c.type === 'transfer' ? artName(c.fromArticleId) : '') },
            { header: t('budgeting_to'), value: (c) => artName(c.toArticleId) },
            { header: t('budgeting_amount'), value: (c) => c.amount, format: 'money', total: true },
            { header: t('date'), value: (c) => c.createdAt.slice(0, 10) },
            { header: t('status'), value: (c) => t(tk('budgeting_status_', c.status)) },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={changes.data}
        loading={changes.loading}
        emptyText={t('budgeting_changesEmpty')}
        rowKey={(c) => c.id}
        onRowClick={(c) => setOpenId(c.id)}
        columns={[
          { header: t('number'), render: (c) => <span className="doc-num">{c.number}</span> },
          { header: t('budgeting_changeType'), render: (c) => t(tk('budgeting_type_', c.type)) },
          { header: t('budgeting_costCenter'), render: (c) => lk.department(c.departmentId)?.code },
          {
            header: `${t('budgeting_from')} → ${t('budgeting_to')}`,
            render: (c) => (
              <span>
                {c.type === 'transfer' ? `${artName(c.fromArticleId)} → ` : '+ '}
                <b style={{ fontWeight: 600 }}>{artName(c.toArticleId)}</b>
              </span>
            ),
          },
          { header: t('budgeting_amount'), align: 'right', render: (c) => formatMoneyShort(c.amount, lang) },
          { header: t('initiator'), render: (c) => lk.user(c.requesterId)?.fullName },
          { header: t('date'), render: (c) => <span className="num muted">{formatDate(c.createdAt)}</span> },
          { header: t('status'), render: (c) => <StatusBadge prefix="budgeting_status_" status={c.status} /> },
        ]}
      />
      {openId && (
        <ChangeModal
          id={openId}
          artName={artName}
          onClose={() => {
            setOpenId(null);
            if (changeId) navigate('/budgeting');
          }}
        />
      )}
    </>
  );
}

function ChangeModal({ id, artName, onClose }: { id: string; artName: (id?: string) => string; onClose: () => void }) {
  const { t, loc } = useSession();
  const lk = useLookups();
  const res = useApi(() => budgetingApi.getChange(id), [id]);
  const openTask = useApi(() => api.getOpenApproval(id), [id]);
  const change: BudgetingChange | undefined = res.data;
  const footer = <button className="btn" onClick={onClose}>{t('budgeting_close')}</button>;
  if (!change) {
    return (
      <Modal title={t('budgeting_tab_changes')} onClose={onClose} footer={footer}>
        {res.loading ? <Loading /> : <Empty text={t('empty')} />}
      </Modal>
    );
  }
  const dep = lk.department(change.departmentId);
  return (
    <Modal title={`${change.number} · ${t(tk('budgeting_type_', change.type))}`} onClose={onClose} footer={footer}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge prefix="budgeting_status_" status={change.status} />
        {change.appliedAt && <Badge tone="ok">{t('budgeting_applied')} {formatDate(change.appliedAt)}</Badge>}
        {change.status === 'pending' && openTask.data && (
          <span className="small muted">{t('budgeting_awaiting')}: {t(tk('role_', openTask.data.assigneeRole))}</span>
        )}
      </div>
      <dl className="kv" style={{ gridTemplateColumns: '130px 1fr' }}>
        <dt>{t('budgeting_costCenter')}</dt>
        <dd>{dep ? loc(dep.name) : change.departmentId}</dd>
        {change.type === 'transfer' && (
          <>
            <dt>{t('budgeting_from')}</dt>
            <dd>{artName(change.fromArticleId)}</dd>
          </>
        )}
        <dt>{t('budgeting_to')}</dt>
        <dd>{artName(change.toArticleId)}</dd>
        <dt>{t('budgeting_amount')}</dt>
        <dd className="num">{formatMoney(change.amount)}</dd>
        <dt>{t('budgeting_reason')}</dt>
        <dd style={{ fontWeight: 400 }}>{change.reason}</dd>
      </dl>
      <RouteSteps entityId={change.id} />
      <Timeline events={change.history} />
    </Modal>
  );
}
