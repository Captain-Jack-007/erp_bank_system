// Журнал проводок автопарка (ГСМ, ТО, ремонт, страхование, прочие, штрафы, пополнение карт) и отправка пакетом в iABS
// (PR-FLT-052, 059, 068, 076, 083).
import { useState } from 'react';
import { fleetApi, fleetCanPost, formatDate, formatMoney, tk, type FleetPosting, type FleetPostingSource, type FleetPostingStatus } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, FilterBar, Input, PageHeader, Select, Stat, useToast, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { FleetNav, Plate, useFleetErr, useOrgRefs } from './shared';

const TONE: Record<FleetPostingStatus, Tone> = { draft: 'warn', sending: 'info', posted: 'ok', queued: 'info', failed: 'danger' };
const SOURCES: FleetPostingSource[] = ['fuel', 'maintenance', 'repair', 'insurance', 'other', 'fine', 'topup'];
const STATUSES: FleetPostingStatus[] = ['draft', 'queued', 'posted', 'failed'];

const sourceLink = (p: FleetPosting) =>
  p.source === 'maintenance' || p.source === 'repair' ? `/fleet/service/${p.sourceId}` : p.source === 'topup' ? `/fleet/topups/${p.sourceId}` : `/fleet/${p.vehicleId}`;

export function PostingsPage() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const org = useOrgRefs();
  const canPost = fleetCanPost(user);
  const [status, setStatus] = useState<FleetPostingStatus | ''>('');
  const [source, setSource] = useState<FleetPostingSource | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const list = useApi(() => fleetApi.listPostings({ ...(status ? { status } : {}), ...(source ? { source } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }), [status, source, from, to]);
  const all = useApi(() => fleetApi.listPostings(), []);
  const vehicles = useApi(() => fleetApi.list(), []);
  const rows = list.data ?? [];
  const sendable = rows.filter((p) => p.status === 'draft' || p.status === 'failed');
  const plate = (id: string) => vehicles.data?.find((v) => v.id === id)?.plate ?? id;
  const sum = (s: FleetPostingStatus[]) => (all.data ?? []).filter((p) => s.includes(p.status));
  async function send(ids: string[]) {
    setBusy(true);
    try {
      const r = await fleetApi.sendPostings(ids, user);
      toast(`${r.batch}: ${t(tk('svc_status_', r.status))} · ${r.count} · ${formatMoney(r.amount)}`);
      setSel(new Set());
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_postings') }]}
        title={t('fleet_nav_postings')}
        subtitle={t('fleet_postingsSub')}
        actions={
          <>
            <ExportButton<FleetPosting>
              filename={t('fleet_nav_postings')}
              rows={rows}
              columns={[
                { header: '№', value: (p) => p.number }, { header: t('date'), value: (p) => p.date, format: 'date' }, { header: t('fleet_postingSource'), value: (p) => t(tk('fleet_psrc_', p.source)) },
                { header: t('fleet_document'), value: (p) => p.sourceNumber }, { header: t('fleet_plate'), value: (p) => plate(p.vehicleId) }, { header: t('fleet_costCenter'), value: (p) => org.ccCode(p.costCenterKey) },
                { header: t('fleet_debit'), value: (p) => p.debit }, { header: t('fleet_credit'), value: (p) => p.credit }, { header: t('amount'), value: (p) => p.amount, format: 'money', total: true },
                { header: t('description'), value: (p) => p.description, width: 40 }, { header: t('status'), value: (p) => t(tk('fleet_ps_', p.status)) }, { header: t('fleet_batch'), value: (p) => p.batch ?? '' },
              ]}
            />
            {canPost && <Button disabled={!sel.size || busy} onClick={() => send([...sel])}>{t('fleet_sendSelected')} ({sel.size})</Button>}
            {canPost && <Button type="primary" icon="upload" loading={busy} disabled={!sendable.length} onClick={() => send(sendable.map((p) => p.id))}>{t('fleet_sendAll')} ({sendable.length})</Button>}
          </>
        }
      />
      <FleetNav active="postings" />
      <div className="flt-kpis">
        <Stat label={t('fleet_ps_draft')} value={sum(['draft']).length} icon="file" tone={sum(['draft']).length ? 'alert' : undefined} foot={formatMoney(sum(['draft']).reduce((a, p) => a + p.amount, 0))} />
        <Stat label={t('fleet_ps_queued')} value={sum(['queued', 'sending']).length} icon="clock" foot={formatMoney(sum(['queued', 'sending']).reduce((a, p) => a + p.amount, 0))} />
        <Stat label={t('fleet_ps_posted')} value={sum(['posted']).length} icon="check" tone="accent" foot={formatMoney(sum(['posted']).reduce((a, p) => a + p.amount, 0))} />
        <Stat label={t('fleet_ps_failed')} value={sum(['failed']).length} icon="alert" foot={formatMoney(sum(['failed']).reduce((a, p) => a + p.amount, 0))} />
      </div>
      <Card flush>
        <FilterBar>
          <Select<FleetPostingStatus> value={status} placeholder={`${t('status')}: ${t('all')}`} ariaLabel={t('status')} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(tk('fleet_ps_', s)) }))} />
          <Select<FleetPostingSource> value={source} placeholder={`${t('fleet_postingSource')}: ${t('all')}`} ariaLabel={t('fleet_postingSource')} onChange={setSource} options={SOURCES.map((s) => ({ value: s, label: t(tk('fleet_psrc_', s)) }))} />
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={t('fleet_from')} style={{ width: 160 }} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={t('fleet_to')} style={{ width: 160 }} />
        </FilterBar>
        {!canPost && <div className="flt-tablebar"><span className="muted">{t('fleet_postingRights')}</span></div>}
        <DataTable rows={list.data} loading={list.loading} rowKey={(p) => p.id} columns={[
          ...(canPost ? [{ header: '', width: 36, render: (p: FleetPosting) => (p.status === 'draft' || p.status === 'failed' ? <Checkbox checked={sel.has(p.id)} onChange={(on) => setSel((s) => { const n = new Set(s); if (on) n.add(p.id); else n.delete(p.id); return n; })} /> : null) }] : []),
          { header: '№', render: (p) => (<><span className="doc-num">{p.number}</span><div className="sub">{formatDate(p.date)}</div></>) },
          { header: t('fleet_postingSource'), render: (p) => (<>{t(tk('fleet_psrc_', p.source))}<div className="sub"><Link to={sourceLink(p)}>{p.sourceNumber}</Link></div></>) },
          { header: t('fleet_plate'), render: (p) => <Plate value={plate(p.vehicleId)} /> },
          { header: `${t('fleet_debit')} / ${t('fleet_credit')}`, render: (p) => <span className="num">{p.debit} / {p.credit}</span> },
          { header: t('fleet_costCenter'), render: (p) => <span className="muted small">{org.ccCode(p.costCenterKey)}</span> },
          { header: t('amount'), align: 'right', render: (p) => formatMoney(p.amount) },
          { header: t('status'), render: (p) => (<><Badge tone={TONE[p.status]}>{t(tk('fleet_ps_', p.status))}</Badge>{p.batch && <div className="sub">{p.batch}</div>}{p.error && <div className="sub" style={{ color: 'var(--danger)' }}>{p.error}</div>}</>) },
        ]} />
      </Card>
    </>
  );
}
