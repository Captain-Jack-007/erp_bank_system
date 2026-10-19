// Справочник поставщиков (PR-PROC-047…052): единая база и рейтинг, история работы, синхронизация с биржей,
// тендерными площадками и Soliqservis, проверка по «чёрному списку», санкциям, внутреннему контролю и ГНК.
import { useState } from 'react';
import { formatDate, formatDateTime, formatMoney, procApi, tk } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Field, Input, Loading, Modal, PageHeader, StatusBadge, Tabs, Textarea, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link, navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { Kv, ToneBadge, useErr, useIsBuyer } from './shared';

export function SuppliersTab() {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const list = useApi(() => procApi.listSuppliers(), []);
  const lists = useApi(() => procApi.listSupplierLists(), []);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [bl, setBl] = useState(false);
  const [form, setForm] = useState({ tin: '', name: '', reason: '' });
  const rows = (list.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.tin.includes(q));
  const isBuyer = useIsBuyer();
  const editor = isBuyer || can('master-data', 'edit');

  return (
    <div className="pc-stack pc-pad">
      <Card
        title={t('proc_suppliers')}
        actions={
          <span className="pc-row">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}: ${t('tin')}`} />
            {editor && (
              <Button size="small" icon="refresh" disabled={busy} onClick={async () => { setBusy(true); try { const n = await procApi.syncPlatforms(user); toast(`${t('proc_platformsSynced')}: ${n}`); } catch (e) { toast(err(e)); } finally { setBusy(false); } }}>
                {t('proc_syncPlatforms')}
              </Button>
            )}
            <ExportButton
              filename={t('proc_suppliers')}
              rows={rows}
              columns={[
                { header: t('counterparty'), value: (c) => c.name },
                { header: t('tin'), value: (c) => c.tin },
                { header: t('proc_rating'), value: (c) => c.ratingCalc.score, format: 'number' },
                { header: t('proc_contractsCount'), value: (c) => c.contracts, format: 'integer' },
                { header: t('proc_admission'), value: (c) => (c.admission.allowed ? t('proc_allowed') : t('proc_supplierNotAllowed')) },
              ]}
            />
          </span>
        }
        flush
      >
        <DataTable
          rows={rows}
          loading={list.loading}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/procurement/suppliers/${c.id}`)}
          columns={[
            { header: t('counterparty'), render: (c) => <>{c.name}<div className="sub">{t('tin')} {c.tin} · {t(tk('ctype_', c.type))}</div></> },
            { header: t('proc_rating'), align: 'right', render: (c) => <b>{c.ratingCalc.score.toFixed(1)}</b> },
            { header: t('proc_contractsCount'), align: 'right', render: (c) => c.contracts },
            { header: t('proc_platformStats'), render: (c) => (c.platformStats ? `${c.platformStats.wins}/${c.platformStats.lots}` : '—') },
            { header: t('proc_lastCheck'), render: (c) => (c.admission.lastCheck ? formatDate(c.admission.lastCheck.at) : '—') },
            { header: t('proc_admission'), render: (c) => (c.admission.allowed ? <Badge tone="ok">{t('proc_allowed')}</Badge> : <Badge tone="danger">{c.admission.reasons.map((r) => t(tk('proc_list_', r))).join(', ')}</Badge>) },
          ]}
        />
      </Card>
      <Card title={t('proc_lists')} actions={can('master-data', 'edit') || user.role === 'admin' ? <Button size="small" icon="plus" onClick={() => setBl(true)}>{t('proc_addBlacklist')}</Button> : undefined} flush>
        <DataTable
          rows={lists.data}
          rowKey={(e) => `${e.tin}-${e.list}`}
          columns={[
            { header: t('proc_list'), render: (e) => <ToneBadge status={e.list === 'suspicious_tax' ? 'due' : 'rejected'} label={t(tk('proc_list_', e.list))} /> },
            { header: t('counterparty'), render: (e) => <>{e.name}<div className="sub">{t('tin')} {e.tin}</div></> },
            { header: t('proc_reason'), render: (e) => e.reason },
            { header: t('date'), render: (e) => formatDate(e.since) },
          ]}
        />
      </Card>
      {bl && (
        <Modal
          title={t('proc_addBlacklist')}
          onClose={() => setBl(false)}
          footer={
            <>
              <Button onClick={() => setBl(false)}>{t('cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await procApi.addToBlacklist(form, user); setBl(false); toast(t('saved')); } catch (e) { toast(err(e)); } }}>{t('save')}</Button>
            </>
          }
        >
          <Field label={t('tin')} required><Input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} ariaLabel={t('tin')} /></Field>
          <Field label={t('counterparty')} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} ariaLabel={t('counterparty')} /></Field>
          <Field label={t('proc_reason')} required><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} ariaLabel={t('proc_reason')} /></Field>
        </Modal>
      )}
    </div>
  );
}

export function SupplierDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const list = useApi(() => procApi.listSuppliers(), []);
  const h = useApi(() => procApi.supplierHistory(id), [id]);
  const [tab, setTab] = useState<'contracts' | 'tenders' | 'acceptances' | 'acts' | 'claims' | 'checks'>('contracts');
  const [busy, setBusy] = useState(false);
  const isBuyer = useIsBuyer();
  const cp = list.data?.find((c) => c.id === id);
  if (list.loading && !cp) return <Card><Loading /></Card>;
  if (!cp) return <Card><Empty text={t('empty')} /></Card>;
  const r = h.data?.rating ?? cp.ratingCalc;
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
    } catch (e) {
      toast(`${t('actionFailed')}: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const editor = isBuyer || can('master-data', 'edit');
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('navProcurement'), to: '/procurement?tab=suppliers' }, { label: cp.name }]}
        title={cp.name}
        subtitle={`${t('tin')} ${cp.tin}`}
        actions={
          <>
            {cp.admission.allowed ? <Badge tone="ok">{t('proc_allowed')}</Badge> : <Badge tone="danger">{t('proc_supplierNotAllowed')}</Badge>}
            <Button disabled={busy} icon="check" onClick={() => run(() => procApi.checkSupplier(cp.id, user), t('proc_checkDone'))}>{t('proc_check')}</Button>
            {editor && cp.type !== 'foreign' && <Button disabled={busy} icon="refresh" onClick={() => run(() => procApi.syncSoliq(cp.id, user), t('proc_soliqSynced'))}>{t('proc_syncSoliq')}</Button>}
          </>
        }
      />
      <div className="grid grid-main">
        <div className="pc-stack">
          <Card flush>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'contracts', label: t('navContracts'), count: h.data?.contracts.length },
                { value: 'tenders', label: t('tenders'), count: h.data?.tenders.length },
                { value: 'acceptances', label: t('proc_acceptances'), count: h.data?.acceptances.length },
                { value: 'acts', label: t('proc_acts'), count: h.data?.acts.length },
                { value: 'claims', label: t('proc_claims'), count: h.data?.claims.length },
                { value: 'checks', label: t('proc_checks'), count: h.data?.checks.length },
              ]}
            />
            {tab === 'contracts' && <DataTable rows={h.data?.contracts} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/contracts/${c.id}`)} columns={[{ header: t('number'), render: (c) => c.number }, { header: t('subject'), render: (c) => c.subject }, { header: t('amount'), align: 'right', render: (c) => formatMoney(c.amount, c.currency) }, { header: t('status'), render: (c) => <StatusBadge prefix="cstatus_" status={c.status} /> }]} />}
            {tab === 'tenders' && <DataTable rows={h.data?.tenders} rowKey={(x) => x.id} columns={[{ header: t('number'), render: (x) => <Link to={`/procurement/${x.requestId}`}>{x.number}</Link> }, { header: t('title'), render: (x) => x.title }, { header: t('winner'), render: (x) => (x.winnerId === id ? <Badge tone="ok">{t('winner')}</Badge> : '—') }, { header: t('status'), render: (x) => <StatusBadge prefix="tstatus_" status={x.status} /> }]} />}
            {tab === 'acceptances' && <DataTable rows={h.data?.acceptances} rowKey={(a) => a.id} onRowClick={(a) => navigate(`/procurement/acceptance/${a.id}`)} columns={[{ header: t('number'), render: (a) => a.number }, { header: t('date'), render: (a) => formatDate(a.date) }, { header: t('proc_discrepancies'), align: 'right', render: (a) => procApi.acceptanceDiscrepancies(a).length }, { header: t('status'), render: (a) => <ToneBadge status={a.status} label={t(tk('proc_acc_', a.status))} /> }]} />}
            {tab === 'acts' && <DataTable rows={h.data?.acts} rowKey={(a) => a.id} onRowClick={(a) => navigate(`/procurement/acts/${a.id}`)} columns={[{ header: t('number'), render: (a) => a.number }, { header: t('period'), render: (a) => `${formatDate(a.periodFrom)} — ${formatDate(a.periodTo)}` }, { header: t('proc_quality'), align: 'right', render: (a) => (a.quality ? `${a.quality.score}/5` : '—') }, { header: t('status'), render: (a) => <ToneBadge status={a.status} label={t(tk('proc_act_', a.status))} /> }]} />}
            {tab === 'claims' && <DataTable rows={h.data?.claims} rowKey={(c) => c.id} columns={[{ header: t('number'), render: (c) => c.number }, { header: t('proc_claimType'), render: (c) => t(tk('proc_claim_', c.type)) }, { header: t('amount'), align: 'right', render: (c) => formatMoney(c.amount) }, { header: t('status'), render: (c) => <ToneBadge status={c.status} label={t(tk('proc_cls_', c.status))} /> }]} />}
            {tab === 'checks' && (
              <DataTable
                rows={h.data?.checks}
                rowKey={(c) => c.id}
                emptyText={t('proc_noChecks')}
                columns={[
                  { header: t('date'), render: (c) => formatDateTime(c.at) },
                  { header: t('proc_checkResults'), render: (c) => c.results.map((x) => `${t(tk('proc_list_', x.list))}: ${x.hit ? '⚠' : '✓'}`).join(' · ') },
                  { header: t('proc_admission'), render: (c) => (c.passed ? <Badge tone="ok">{t('proc_allowed')}</Badge> : <Badge tone="danger">{t('proc_supplierNotAllowed')}</Badge>) },
                ]}
              />
            )}
          </Card>
        </div>
        <div className="pc-stack">
          <Card title={t('proc_rating')}>
            <div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{r.score.toFixed(1)} / 5</div>
            <Kv items={[[t('proc_ratingBase'), r.base.toFixed(1)], [t('proc_quality'), r.quality !== null ? r.quality.toFixed(1) : '—'], [t('proc_onTime'), r.onTime !== null ? `${Math.round(r.onTime * 100)}%` : '—'], [t('proc_claims'), String(r.claims)]]} />
          </Card>
          <Card title={t('proc_requisites')}>
            <Kv
              items={[
                [t('address'), cp.address],
                [t('phone'), cp.phone],
                [t('proc_director'), cp.director ?? '—'],
                [t('proc_vatPayer'), cp.vatPayer === undefined ? '—' : cp.vatPayer ? t('proc_yes') : t('proc_no')],
                [t('proc_taxStatus'), cp.taxStatus ? t(tk('proc_tax_', cp.taxStatus)) : '—'],
                [t('proc_bank'), cp.bankName ?? '—'],
                [t('proc_account'), cp.bankAccount ?? cp.iban ?? '—'],
                [t('proc_mfo'), cp.mfo ?? cp.swiftBic ?? '—'],
                [t('proc_soliqSync'), cp.soliqSyncedAt ? formatDateTime(cp.soliqSyncedAt) : '—'],
                [t('proc_platformStats'), cp.platformStats ? `${cp.platformStats.wins}/${cp.platformStats.lots} · ${formatDate(cp.platformStats.syncedAt)}` : '—'],
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
