// Отчёты по договорам (PR-CON-005, 038, 039) и резервы по Положению № 2696 (PR-CON-040/041).
import { useState } from 'react';
import { api, CONTRACT_KINDS, contractsApi, formatDate, formatMoney, today, tk, type Contract, type ContractKind } from '@xb/shared';
import { Button, Card, Checkbox, DataTable, Field, Input, Modal, Select, Stat, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Link } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Segmented } from '../../components/flow';
import { ToneBadge, useCostCenters, useErr } from '../procurement/shared';

type FormId = 'registry' | 'payments' | 'debts' | 'cb' | string;
const COLS = ['number', 'subject', 'kind', 'counterparty', 'department', 'costCenter', 'amount', 'paid', 'unpaid', 'startDate', 'endDate', 'status'] as const;
type Col = (typeof COLS)[number];

export function ReportsView() {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const cc = useCostCenters();
  const [form, setForm] = useState<FormId>('registry');
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(`${today().slice(0, 4)}-12-31`);
  const contracts = useApi(() => api.listContracts(), []);
  const payments = useApi(() => contractsApi.paymentsReport(from, to), [from, to]);
  const debts = useApi(() => contractsApi.debtsReport(), []);
  const cb = useApi(() => contractsApi.cbReport(), []);
  const forms = useApi(() => contractsApi.listReportForms(), []);
  const [builder, setBuilder] = useState(false);
  const custom = forms.data?.find((f) => f.id === form);
  const cpName = (id: string) => lk.counterparty(id)?.name ?? id;
  const colValue = (c: Contract, col: Col): string | number => {
    const paid = c.payments.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0);
    switch (col) {
      case 'number': return c.number;
      case 'subject': return c.subject;
      case 'kind': return t(tk('con_kind_', c.kind ?? 'services'));
      case 'counterparty': return cpName(c.counterpartyId);
      case 'department': return lk.department(c.departmentId) ? loc(lk.department(c.departmentId)!.name) : c.departmentId;
      case 'costCenter': return cc.label(c.costCenterKey);
      case 'amount': return c.amount;
      case 'paid': return paid;
      case 'unpaid': return c.amount - paid;
      case 'startDate': return c.startDate.slice(0, 10);
      case 'endDate': return c.endDate.slice(0, 10);
      case 'status': return t(tk('cstatus_', c.status));
    }
  };
  const customRows = custom ? (contracts.data ?? []).filter((c) => (!custom.kind || (c.kind ?? 'services') === custom.kind) && (!custom.status || c.status === custom.status)) : [];
  const groupedRows = custom?.groupBy
    ? [...customRows.reduce((m, c) => {
        const k = custom.groupBy === 'kind' ? t(tk('con_kind_', c.kind ?? 'services')) : custom.groupBy === 'department' ? (lk.department(c.departmentId)?.code ?? c.departmentId) : cpName(c.counterpartyId);
        const g = m.get(k) ?? { key: k, count: 0, amount: 0 };
        g.count++;
        g.amount += c.amount;
        m.set(k, g);
        return m;
      }, new Map<string, { key: string; count: number; amount: number }>()).values()]
    : [];
  const money = (col: Col) => ['amount', 'paid', 'unpaid'].includes(col);

  return (
    <div className="pc-stack pc-pad">
      <div className="pc-row" style={{ justifyContent: 'space-between' }}>
        <Segmented<FormId>
          value={form}
          onChange={setForm}
          options={[
            { value: 'registry', label: t('con_rep_registry') },
            { value: 'payments', label: t('con_rep_payments') },
            { value: 'debts', label: t('con_rep_debts') },
            { value: 'cb', label: t('con_rep_cb') },
            ...(forms.data ?? []).map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        <Button size="small" icon="plus" onClick={() => setBuilder(true)}>{t('con_addForm')}</Button>
      </div>

      {form === 'registry' && (
        <Card title={t('con_rep_registry')} actions={<ExportButton filename={t('con_rep_registry')} sheets={() => CONTRACT_KINDS.map((k) => ({ name: t(tk('con_kindShort_', k)).slice(0, 31), title: t(tk('con_kind_', k)), totalLabel: t('svc_total'), columns: [{ header: t('number') }, { header: t('subject') }, { header: t('counterparty') }, { header: t('amount'), format: 'money', total: true }, { header: t('status') }], rows: (contracts.data ?? []).filter((c) => (c.kind ?? 'services') === k).map((c) => [c.number, c.subject, cpName(c.counterpartyId), c.amount, t(tk('cstatus_', c.status))]) }))} />} flush>
          <DataTable
            rows={CONTRACT_KINDS.map((k) => ({ k, list: (contracts.data ?? []).filter((c) => (c.kind ?? 'services') === k) }))}
            rowKey={(r) => r.k}
            columns={[
              { header: t('con_kind'), render: (r) => <Link to={`/contracts?kind=${r.k}`}>{t(tk('con_kind_', r.k))}</Link> },
              { header: t('proc_count'), align: 'right', render: (r) => r.list.length },
              { header: t('amount'), align: 'right', render: (r) => formatMoney(r.list.filter((c) => c.currency === 'UZS').reduce((s, c) => s + c.amount, 0)) },
              { header: t('paidTotal'), align: 'right', render: (r) => formatMoney(r.list.filter((c) => c.currency === 'UZS').reduce((s, c) => s + c.payments.filter((p) => p.paid).reduce((a, p) => a + p.amount, 0), 0)) },
            ]}
          />
        </Card>
      )}
      {form === 'payments' && (
        <Card
          title={t('con_rep_payments')}
          actions={
            <span className="pc-row">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={t('proc_from')} />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={t('proc_to')} />
              <ExportButton filename={t('con_rep_payments')} rows={payments.data ?? []} columns={[{ header: t('date'), value: (p) => p.dueDate }, { header: t('navContracts'), value: (p) => p.number }, { header: t('con_kind'), value: (p) => t(tk('con_kind_', p.kind)) }, { header: t('counterparty'), value: (p) => cpName(p.counterpartyId) }, { header: t('amount'), value: (p) => p.amount, format: 'money', total: true }, { header: t('con_currency'), value: (p) => p.currency }, { header: t('status'), value: (p) => (p.paid ? t('paid') : t('unpaid')) }]} />
            </span>
          }
          flush
        >
          <DataTable
            rows={payments.data}
            rowKey={(p) => `${p.contractId}-${p.index}`}
            columns={[
              { header: t('date'), render: (p) => formatDate(p.dueDate) },
              { header: t('navContracts'), render: (p) => <Link to={`/contracts/${p.contractId}`}>{p.number}</Link> },
              { header: t('counterparty'), render: (p) => cpName(p.counterpartyId) },
              { header: t('amount'), align: 'right', render: (p) => formatMoney(p.amount, p.currency) },
              { header: t('status'), render: (p) => <ToneBadge status={p.paid ? 'paid' : p.dueDate < today() ? 'overdue' : 'due'} label={p.paid ? t('paid') : p.dueDate < today() ? t('overdue') : t('unpaid')} /> },
            ]}
          />
        </Card>
      )}
      {form === 'debts' && (
        <Card title={t('con_rep_debts')} actions={<ExportButton filename={t('con_rep_debts')} rows={debts.data ?? []} columns={[{ header: t('navContracts'), value: (d) => d.number }, { header: t('counterparty'), value: (d) => cpName(d.counterpartyId) }, { header: t('amount'), value: (d) => d.amount, format: 'money' }, { header: t('con_accepted'), value: (d) => d.accepted, format: 'money', total: true }, { header: t('paidTotal'), value: (d) => d.paid, format: 'money', total: true }, { header: t('con_receivable'), value: (d) => d.receivable, format: 'money', total: true }, { header: t('con_payable'), value: (d) => d.payable, format: 'money', total: true }]} />} flush>
          <DataTable
            rows={debts.data}
            rowKey={(d) => d.id}
            columns={[
              { header: t('navContracts'), render: (d) => <><Link to={`/contracts/${d.id}`}>{d.number}</Link><div className="sub">{cpName(d.counterpartyId)}</div></> },
              { header: t('con_accepted'), align: 'right', render: (d) => formatMoney(d.accepted, d.currency) },
              { header: t('paidTotal'), align: 'right', render: (d) => formatMoney(d.paid, d.currency) },
              { header: t('con_receivable'), align: 'right', render: (d) => formatMoney(d.receivable, d.currency) },
              { header: t('con_payable'), align: 'right', render: (d) => formatMoney(d.payable, d.currency) },
              { header: t('status'), render: (d) => (d.closed ? <ToneBadge status="done" label={t('con_debtClosed')} /> : <ToneBadge status="pending" label={t('con_debtOpen')} />) },
            ]}
          />
        </Card>
      )}
      {form === 'cb' && cb.data && (
        <Card
          title={t('con_rep_cb')}
          actions={
            <span className="pc-row">
              <ExportButton filename={t('con_rep_cb')} sheets={() => [
                { name: 'Summary', title: t('con_rep_cb'), totalLabel: t('svc_total'), columns: [{ header: t('con_class') }, { header: '%', format: 'number' }, { header: t('proc_count'), format: 'integer', total: true }, { header: t('con_base'), format: 'money', total: true }, { header: t('con_reserve'), format: 'money', total: true }], rows: cb.data!.summary.map((s) => [t(tk('con_cls_', s.cls)), s.pct, s.count, s.base, s.reserve]) },
                { name: 'Detail', columns: [{ header: t('navContracts') }, { header: t('counterparty') }, { header: t('con_overdueDays'), format: 'integer' }, { header: t('con_class') }, { header: t('con_base'), format: 'money' }, { header: t('con_reserve'), format: 'money' }], rows: cb.data!.rows.map((r) => [r.number, cpName(r.counterpartyId), r.days, t(tk('con_cls_', r.cls)), r.base, r.reserve]) },
              ]} />
              <PrintButton template="registry" doc={() => ({ entity: 'report', entityId: 'cb-2696', title: t('con_rep_cb'), date: today(), landscape: true, table: { columns: [{ header: t('con_class') }, { header: '%', align: 'right' }, { header: t('proc_count'), align: 'right' }, { header: t('con_base'), align: 'right' }, { header: t('con_reserve'), align: 'right' }], rows: cb.data!.summary.map((s) => [t(tk('con_cls_', s.cls)), String(s.pct), String(s.count), formatMoney(s.base), formatMoney(s.reserve)]), totals: [t('svc_total'), '', String(cb.data!.rows.length), formatMoney(cb.data!.summary.reduce((a, s) => a + s.base, 0)), formatMoney(cb.data!.summary.reduce((a, s) => a + s.reserve, 0))] } })} />
            </span>
          }
          flush
        >
          <DataTable
            rows={cb.data.summary}
            rowKey={(s) => s.cls}
            columns={[
              { header: t('con_class'), render: (s) => t(tk('con_cls_', s.cls)) },
              { header: '%', align: 'right', render: (s) => s.pct },
              { header: t('proc_count'), align: 'right', render: (s) => s.count },
              { header: t('con_base'), align: 'right', render: (s) => formatMoney(s.base) },
              { header: t('con_reserve'), align: 'right', render: (s) => formatMoney(s.reserve) },
            ]}
          />
        </Card>
      )}
      {custom && (
        <Card
          title={custom.name}
          actions={
            <span className="pc-row">
              <ExportButton filename={custom.name} rows={customRows} columns={custom.columns.map((col) => ({ header: t(tk('con_col_', col)), value: (c: Contract) => colValue(c, col as Col), ...(money(col as Col) ? { format: 'money' as const, total: true } : {}) }))} />
              <Button size="small" danger onClick={async () => { try { await contractsApi.deleteReportForm(custom.id, user); setForm('registry'); toast(t('saved')); } catch (e) { toast(err(e)); } }}>{t('con_deleteForm')}</Button>
            </span>
          }
          flush
        >
          {custom.groupBy ? (
            <DataTable rows={groupedRows} rowKey={(g) => g.key} columns={[{ header: t(tk('con_group_', custom.groupBy)), render: (g) => g.key }, { header: t('proc_count'), align: 'right', render: (g) => g.count }, { header: t('amount'), align: 'right', render: (g) => formatMoney(g.amount) }]} />
          ) : (
            <DataTable rows={customRows} rowKey={(c) => c.id} columns={custom.columns.map((col) => ({ header: t(tk('con_col_', col)), ...(money(col as Col) ? { align: 'right' as const } : {}), render: (c: Contract) => { const v = colValue(c, col as Col); return typeof v === 'number' ? formatMoney(v, c.currency) : v; } }))} />
          )}
        </Card>
      )}
      {builder && <FormBuilder onClose={() => setBuilder(false)} onSaved={() => setBuilder(false)} />}
    </div>
  );
}

function FormBuilder({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const [name, setName] = useState('');
  const [cols, setCols] = useState<string[]>(['number', 'subject', 'counterparty', 'amount', 'status']);
  const [kind, setKind] = useState<ContractKind | ''>('');
  const [status, setStatus] = useState('');
  const [groupBy, setGroupBy] = useState<'' | 'kind' | 'department' | 'counterparty'>('');
  const [error, setError] = useState('');
  return (
    <Modal
      title={t('con_addForm')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" onClick={async () => { try { await contractsApi.saveReportForm({ name, columns: cols, kind, status, groupBy }, user); toast(t('saved')); onSaved(); } catch (e) { setError(err(e)); } }}>{t('save')}</Button>
        </>
      }
    >
      <Field label={t('con_formName')} required error={error}>
        <Input value={name} onChange={(e) => setName(e.target.value)} ariaLabel={t('con_formName')} />
      </Field>
      <Field label={t('con_columns')} required>
        <div className="pc-row">
          {COLS.map((c) => (
            <Checkbox key={c} checked={cols.includes(c)} onChange={(v) => setCols((x) => (v ? [...x, c] : x.filter((y) => y !== c)))}>{t(tk('con_col_', c))}</Checkbox>
          ))}
        </div>
      </Field>
      <div className="form-grid">
        <Field label={t('con_kind')}>
          <Select<ContractKind | ''> value={kind} onChange={setKind} options={[{ value: '', label: t('all') }, ...CONTRACT_KINDS.map((k) => ({ value: k, label: t(tk('con_kind_', k)) }))]} ariaLabel={t('con_kind')} />
        </Field>
        <Field label={t('status')}>
          <Select<string> value={status} onChange={setStatus} options={[{ value: '', label: t('all') }, ...['draft', 'pending', 'active', 'expired', 'terminated'].map((s) => ({ value: s, label: t(tk('cstatus_', s)) }))]} ariaLabel={t('status')} />
        </Field>
        <Field label={t('con_groupBy')}>
          <Select<'' | 'kind' | 'department' | 'counterparty'> value={groupBy} onChange={setGroupBy} options={[{ value: '', label: '—' }, { value: 'kind', label: t('con_group_kind') }, { value: 'department', label: t('con_group_department') }, { value: 'counterparty', label: t('con_group_counterparty') }]} ariaLabel={t('con_groupBy')} />
        </Field>
      </div>
    </Modal>
  );
}

export function ReservesView() {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const contracts = useApi(() => api.listContracts(), []);
  const [recovery, setRecovery] = useState<Contract | null>(null);
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const rows = (contracts.data ?? []).filter((c) => c.reserve);
  const total = rows.reduce((s, c) => s + (c.reserve?.amount ?? 0), 0);
  const canCalc = can('contracts', 'edit') && ['accountant', 'finance', 'admin'].includes(user.role);
  return (
    <div className="pc-stack pc-pad">
      <div className="pc-row" style={{ justifyContent: 'space-between' }}>
        <span className="muted small">{t('con_reservesHint')}</span>
        {canCalc && (
          <Button size="small" type="primary" icon="refresh" disabled={busy} onClick={async () => { setBusy(true); try { const n = await contractsApi.recalcReserves(user); toast(`${t('con_reservesRecalc')}: ${n}`); } catch (e) { toast(err(e)); } finally { setBusy(false); } }}>
            {t('con_recalc')}
          </Button>
        )}
      </div>
      <div className="pc-kpis">
        <Stat label={t('con_reserveTotal')} value={formatMoney(total)} icon="wallet" />
        <Stat label={t('con_reserveCount')} value={rows.length} icon="file" />
        <Stat label={t('con_writtenOff')} value={formatMoney(rows.reduce((s, c) => s + (c.reserve?.writtenOff?.amount ?? 0), 0))} icon="archive" />
        <Stat label={t('con_recovered')} value={formatMoney(rows.reduce((s, c) => s + (c.reserve?.recoveries ?? []).reduce((a, r) => a + r.amount, 0), 0))} icon="check" />
      </div>
      <Card flush>
        <DataTable
          rows={rows}
          rowKey={(c) => c.id}
          emptyText={t('con_noReserves')}
          columns={[
            { header: t('navContracts'), render: (c) => <><Link to={`/contracts/${c.id}`}>{c.number}</Link><div className="sub">{lk.counterparty(c.counterpartyId)?.name}</div></> },
            { header: t('con_overdueDays'), align: 'right', render: (c) => c.reserve!.overdueDays },
            { header: t('con_class'), render: (c) => <ToneBadge status={c.reserve!.classification === 'bad' ? 'rejected' : c.reserve!.classification === 'standard' ? 'approved' : 'due'} label={`${t(tk('con_cls_', c.reserve!.classification))} · ${c.reserve!.pct}%`} /> },
            { header: t('con_base'), align: 'right', render: (c) => formatMoney(c.reserve!.base) },
            { header: t('con_reserve'), align: 'right', render: (c) => formatMoney(c.reserve!.amount) },
            { header: t('con_writtenOff'), render: (c) => (c.reserve!.writtenOff ? `${formatMoney(c.reserve!.writtenOff.amount)} · ${formatDate(c.reserve!.writtenOff.at)}` : '—') },
            {
              header: '',
              render: (c) =>
                can('contracts', 'edit') ? (
                  <span className="pc-row">
                    {c.reserve!.classification === 'bad' && !c.reserve!.writtenOff && <Button size="small" onClick={async () => { try { await contractsApi.writeOff(c.id, user); toast(t('con_writtenOffDone')); } catch (e) { toast(err(e)); } }}>{t('con_writeOff')}</Button>}
                    {c.reserve!.writtenOff && <Button size="small" onClick={() => setRecovery(c)}>{t('con_recovery')}</Button>}
                  </span>
                ) : null,
            },
          ]}
        />
      </Card>
      {recovery && (
        <Modal
          title={`${t('con_recovery')}: ${recovery.number}`}
          onClose={() => setRecovery(null)}
          footer={
            <>
              <Button onClick={() => setRecovery(null)}>{t('cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await contractsApi.recordRecovery(recovery.id, amount, user); setRecovery(null); toast(t('saved')); } catch (e) { toast(err(e)); } }}>{t('save')}</Button>
            </>
          }
        >
          <Field label={t('amount')} required>
            <Input type="number" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} ariaLabel={t('amount')} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
