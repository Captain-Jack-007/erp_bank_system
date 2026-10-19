// Договоры: дашборд по видам (PR-CON-031/032), мониторинг исполнения (PR-CON-027…030, 033), табло
// «не оплачено к 25-му» (PR-CON-042), данные структурных подразделений (PR-CON-003).
import { useState } from 'react';
import { api, contractsApi, formatDate, formatMoney, formatMoneyShort, tk } from '@xb/shared';
import { BarChart, Button, Card, DataTable, Progress, Select, Stat, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { ToneBadge, useErr } from '../procurement/shared';

export function ContractsDashboard() {
  const { t } = useSession();
  const lk = useLookups();
  const d = useApi(() => contractsApi.dashboard(), []);
  if (!d.data) return null;
  const x = d.data;
  return (
    <div className="pc-stack pc-pad">
      <div className="grid grid-2">
        <Card title={t('con_byKind')}>
          <BarChart data={x.byKind.filter((k) => k.count).map((k) => ({ label: t(tk('con_kindShort_', k.kind)), values: [k.amount] }))} series={[{ name: t('amount') }]} format={(n) => formatMoneyShort(n)} />
        </Card>
        <Card title={t('con_byStatus')}>
          <BarChart data={x.byStatus.map((s) => ({ label: t(tk('cstatus_', s.status)), values: [s.count] }))} series={[{ name: t('proc_count') }]} />
        </Card>
      </div>
      <Card title={t('con_kindsTable')} actions={<ExportButton filename={t('con_kindsTable')} rows={x.byKind} columns={[{ header: t('con_kind'), value: (k) => t(tk('con_kind_', k.kind)) }, { header: t('proc_count'), value: (k) => k.count, format: 'integer', total: true }, { header: t('con_activeCount'), value: (k) => k.active, format: 'integer', total: true }, { header: t('amount'), value: (k) => k.amount, format: 'money', total: true }, { header: t('unpaid'), value: (k) => k.unpaid, format: 'money', total: true }]} />} flush>
        <DataTable
          rows={x.byKind}
          rowKey={(k) => k.kind}
          columns={[
            { header: t('con_kind'), render: (k) => <Link to={`/contracts?kind=${k.kind}`}>{t(tk('con_kind_', k.kind))}</Link> },
            { header: t('proc_count'), align: 'right', render: (k) => k.count },
            { header: t('con_activeCount'), align: 'right', render: (k) => k.active },
            { header: t('amount'), align: 'right', render: (k) => formatMoney(k.amount) },
            { header: t('unpaid'), align: 'right', render: (k) => formatMoney(k.unpaid) },
          ]}
        />
      </Card>
      <div className="grid grid-2">
        <Card title={t('con_upcoming')} flush>
          <DataTable
            rows={x.upcoming}
            rowKey={(p) => `${p.contractId}-${p.index}`}
            emptyText={t('empty')}
            columns={[
              { header: t('date'), render: (p) => formatDate(p.dueDate) },
              { header: t('navContracts'), render: (p) => <Link to={`/contracts/${p.contractId}`}>{p.number}</Link> },
              { header: t('amount'), align: 'right', render: (p) => formatMoney(p.amount, p.currency) },
            ]}
          />
        </Card>
        <Card title={t('con_topCounterparties')} flush>
          <DataTable
            rows={x.topCounterparties}
            rowKey={(c) => c.id}
            columns={[
              { header: t('counterparty'), render: (c) => <Link to={`/procurement/suppliers/${c.id}`}>{lk.counterparty(c.id)?.name ?? c.id}</Link> },
              { header: t('amount'), align: 'right', render: (c) => formatMoney(c.amount) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

export function MonitoringView() {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const m = useApi(() => contractsApi.monitoring(), []);
  const [busy, setBusy] = useState(false);
  const editor = can('contracts', 'edit');
  const stages = (m.data?.stages ?? []).filter((s) => s.contract.status === 'active' || s.overdueDays);
  return (
    <div className="pc-stack pc-pad">
      <div className="pc-row" style={{ justifyContent: 'space-between' }}>
        <span className="muted small">{t('con_monHint')}</span>
        <Button size="small" icon="bell" disabled={busy} onClick={async () => { setBusy(true); try { const r = await contractsApi.scan(user); toast(`${t('con_scanDone')}: ${r.notified} / ${r.expired}`); } catch (e) { toast(err(e)); } finally { setBusy(false); } }}>
          {t('con_scan')}
        </Button>
      </div>
      <Card title={t('con_stages')} actions={<ExportButton filename={t('con_stages')} rows={stages} columns={[{ header: t('navContracts'), value: (s) => s.contract.number }, { header: t('con_stage'), value: (s) => s.stage.name }, { header: t('deadline'), value: (s) => s.stage.dueDate }, { header: t('status'), value: (s) => t(tk('con_stg_', s.stage.status)) }, { header: t('con_overdueDays'), value: (s) => s.overdueDays, format: 'integer' }, { header: t('con_penalty'), value: (s) => s.penalty.amount, format: 'money' }]} />} flush>
        <DataTable
          rows={stages}
          loading={m.loading}
          rowKey={(s) => `${s.contract.id}-${s.stage.id}`}
          columns={[
            { header: t('navContracts'), render: (s) => <><Link to={`/contracts/${s.contract.id}`}>{s.contract.number}</Link><div className="sub">{lk.counterparty(s.contract.counterpartyId)?.name}</div></> },
            { header: t('con_stage'), render: (s) => <>{s.stage.name}<div className="sub">{t(tk('con_obl_', s.stage.obligation))}</div></> },
            { header: t('deadline'), render: (s) => formatDate(s.stage.dueDate) },
            { header: t('status'), render: (s) => (s.overdueDays ? <ToneBadge status="overdue" label={`${t('overdue')} ${s.overdueDays} ${t('proc_days')}`} /> : <ToneBadge status={s.stage.status === 'done' ? 'done' : 'planned'} label={t(tk('con_stg_', s.stage.status))} />) },
            { header: t('con_penalty'), align: 'right', render: (s) => (s.penalty.amount ? formatMoney(s.penalty.amount, s.contract.currency) : '—') },
            {
              header: '',
              render: (s) =>
                editor && s.overdueDays > 0 && s.penalty.amount > 0 && !(s.contract.sanctions ?? []).some((x) => x.stageId === s.stage.id && x.status !== 'waived') ? (
                  <Button size="small" onClick={async () => { try { await contractsApi.applySanction(s.contract.id, s.stage.id, user); toast(t('con_sanctionApplied')); } catch (e) { toast(err(e)); } }}>{t('con_applySanction')}</Button>
                ) : null,
            },
          ]}
        />
      </Card>
      <div className="grid grid-2">
        <Card title={t('con_overduePayments')} flush>
          <DataTable
            rows={(m.data?.payments ?? []).filter((p) => p.overdueDays > 0)}
            rowKey={(p) => `${p.contract.id}-${p.index}`}
            emptyText={t('empty')}
            columns={[
              { header: t('navContracts'), render: (p) => <Link to={`/contracts/${p.contract.id}`}>{p.contract.number}</Link> },
              { header: t('date'), render: (p) => formatDate(p.payment.dueDate) },
              { header: t('amount'), align: 'right', render: (p) => formatMoney(p.payment.amount, p.contract.currency) },
              { header: t('con_overdueDays'), align: 'right', render: (p) => p.overdueDays },
            ]}
          />
        </Card>
        <Card title={t('con_expiring')} flush>
          <DataTable
            rows={m.data?.expiring}
            rowKey={(c) => c.id}
            emptyText={t('empty')}
            columns={[
              { header: t('navContracts'), render: (c) => <Link to={`/contracts/${c.id}`}>{c.number}</Link> },
              { header: t('subject'), render: (c) => c.subject },
              { header: t('endDate'), render: (c) => formatDate(c.endDate) },
            ]}
          />
        </Card>
      </div>
      <Card title={t('con_conditions')} flush>
        <DataTable
          rows={m.data?.conditions}
          rowKey={(c) => c.contract.id}
          columns={[
            { header: t('navContracts'), render: (c) => <><Link to={`/contracts/${c.contract.id}`}>{c.contract.number}</Link><div className="sub">{c.contract.subject}</div></> },
            { header: t('con_obligations'), align: 'right', render: (c) => `${c.done}/${c.obligations}` },
            { header: t('con_progress'), render: (c) => <div style={{ minWidth: 120 }}><Progress pct={c.pct} /></div> },
            { header: t('con_accepted'), align: 'right', render: (c) => formatMoney(c.balance.accepted, c.contract.currency) },
            { header: t('con_receivable'), align: 'right', render: (c) => formatMoney(c.balance.receivable, c.contract.currency) },
            { header: t('con_payable'), align: 'right', render: (c) => formatMoney(c.balance.payable, c.contract.currency) },
          ]}
        />
      </Card>
    </div>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 9 + i);
  return d.toISOString().slice(0, 7);
});

export function BoardView() {
  const { t } = useSession();
  const lk = useLookups();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const b = useApi(() => contractsApi.board(month), [month]);
  const rows = b.data?.rows ?? [];
  const counts = { overdue: rows.filter((r) => r.state === 'overdue').length, due: rows.filter((r) => r.state === 'due').length, paid: rows.filter((r) => r.state === 'paid' || r.state === 'late').length };
  return (
    <div className="pc-stack pc-pad" data-testid="board25">
      <div className="pc-row" style={{ justifyContent: 'space-between' }}>
        <span>
          {t('con_boardControl')}: <b>{b.data ? formatDate(b.data.control) : '—'}</b>
        </span>
        <span className="pc-row">
          <Select<string> value={month} onChange={setMonth} ariaLabel={t('con_month')} options={MONTHS.map((m) => ({ value: m, label: m }))} />
          <ExportButton filename={t('con_tab_board')} rows={rows} columns={[{ header: t('navContracts'), value: (r) => r.number }, { header: t('subject'), value: (r) => r.subject }, { header: t('counterparty'), value: (r) => lk.counterparty(r.counterpartyId)?.name ?? '' }, { header: t('date'), value: (r) => r.dueDate }, { header: t('amount'), value: (r) => r.amount, format: 'money', total: true }, { header: t('status'), value: (r) => t(tk('con_board_', r.state)) }]} />
        </span>
      </div>
      <div className="pc-kpis">
        <Stat label={t('con_board_overdue')} value={counts.overdue} icon="alert" tone={counts.overdue ? 'alert' : undefined} />
        <Stat label={t('con_board_due')} value={counts.due} icon="clock" />
        <Stat label={t('con_board_paid')} value={counts.paid} icon="check" />
        <Stat label={t('amount')} value={formatMoneyShort(rows.filter((r) => !r.paid && r.currency === 'UZS').reduce((s, r) => s + r.amount, 0))} icon="wallet" />
      </div>
      <Card flush>
        <DataTable
          rows={rows}
          loading={b.loading}
          rowKey={(r) => `${r.contractId}-${r.index}`}
          emptyText={t('empty')}
          columns={[
            { header: t('status'), render: (r) => <ToneBadge status={r.state} label={t(tk('con_board_', r.state))} /> },
            { header: t('navContracts'), render: (r) => <><Link to={`/contracts/${r.contractId}`}>{r.number}</Link><div className="sub">{t(tk('con_kind_', r.kind))}{r.subkind ? ` · ${t(tk('con_sub_', r.subkind))}` : ''}</div></> },
            { header: t('counterparty'), render: (r) => lk.counterparty(r.counterpartyId)?.name },
            { header: t('date'), render: (r) => formatDate(r.dueDate) },
            { header: t('amount'), align: 'right', render: (r) => formatMoney(r.amount, r.currency) },
            { header: t('con_paidAt'), render: (r) => (r.paidAt ? formatDate(r.paidAt) : '—') },
          ]}
        />
      </Card>
    </div>
  );
}

export function UnitsView() {
  const { t, loc } = useSession();
  const lk = useLookups();
  const contracts = useApi(() => api.listContracts(), []);
  const initiators = useApi(() => contractsApi.initiatorDepts(), []);
  const rows = lk.departments.map((d) => {
    const list = (contracts.data ?? []).filter((c) => c.departmentId === d.id || c.initiatorDeptIds?.includes(d.id));
    return { d, count: list.length, active: list.filter((c) => c.status === 'active').length, amount: list.filter((c) => c.currency === 'UZS').reduce((s, c) => s + c.amount, 0), initiator: initiators.data?.includes(d.id) ?? false };
  });
  return (
    <div className="pc-stack pc-pad">
      <div className="pc-note">{t('con_unitsHint')} <Link to="/master-data">{t('con_openOrg')}</Link></div>
      <Card flush actions={<ExportButton filename={t('con_tab_units')} rows={rows} columns={[{ header: t('department'), value: (r) => loc(r.d.name) }, { header: t('proc_count'), value: (r) => r.count, format: 'integer', total: true }, { header: t('con_activeCount'), value: (r) => r.active, format: 'integer', total: true }, { header: t('amount'), value: (r) => r.amount, format: 'money', total: true }]} />}>
        <DataTable
          rows={rows}
          rowKey={(r) => r.d.id}
          columns={[
            { header: t('department'), render: (r) => <>{loc(r.d.name)}<div className="sub">{r.d.code} · {t('con_head')}: {r.d.headId ? lk.user(r.d.headId)?.fullName : '—'}</div></> },
            { header: t('con_isInitiator'), render: (r) => (r.initiator ? <ToneBadge status="approved" label={t('proc_yes')} /> : <ToneBadge status="draft" label={t('proc_no')} />) },
            { header: t('proc_count'), align: 'right', render: (r) => r.count },
            { header: t('con_activeCount'), align: 'right', render: (r) => r.active },
            { header: t('amount'), align: 'right', render: (r) => formatMoney(r.amount) },
          ]}
        />
      </Card>
    </div>
  );
}
