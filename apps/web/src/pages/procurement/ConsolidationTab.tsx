// Сведение заявок (ТЗ 4.2.1.2 п. 3, PR-PROC-019…025): очередь областного регионального центра (заявки ЦБУ),
// региональные сводные заявки → центральный аппарат (приём/возврат/повторная обработка), объединение
// однотипных заявок филиалов в консолидированную закупку, распределение товаров по филиалам.
import { useMemo, useState } from 'react';
import { formatDate, formatMoney, procApi, procurementTotal, tk, type ProcConsolidation, type ProcurementRequest } from '@xb/shared';
import { Button, Card, Checkbox, DataTable, Empty, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, Timeline, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link, navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Kv, ToneBadge, useErr, useIsBuyer } from './shared';
import { api } from '@xb/shared';

const regionOf = (b?: string) => (b && /^R\d\d/.test(b) ? b.slice(0, 3) : 'HO');

export function ConsolidationTab() {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const queue = useApi(() => procApi.regionQueue(user), [user.id]);
  const list = useApi(() => procApi.listConsolidations(), []);
  const candidates = useApi(() => procApi.consolidationCandidates(), []);
  const catalog = useApi(() => procApi.listCatalog(), []);
  const all = useApi(() => api.listProcurement(), []);
  const [sel, setSel] = useState<string[]>([]);
  const [region, setRegion] = useState('');
  const [modal, setModal] = useState<{ kind: 'return' | 'summary' | 'decline' | 'consolidate'; id?: string; ids?: string[] } | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const isBuyer = can('procurement', 'edit') && (user.role === 'procurement' || user.role === 'admin');
  const regions = useMemo(() => [...new Set((queue.data ?? []).map((r) => regionOf(r.branchKey)))], [queue.data]);
  const activeRegion = region || regions[0] || '';
  const rows = (queue.data ?? []).filter((r) => !activeRegion || regionOf(r.branchKey) === activeRegion);
  const canRegion = activeRegion ? procApi.canActAsRegion(user, activeRegion) : false;
  const reqById = (id: string) => all.data?.find((r) => r.id === id);
  const regional = (list.data ?? []).filter((c) => c.level === 'region');
  const central = (list.data ?? []).filter((c) => c.level === 'central');

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      setModal(null);
      setText('');
      setError('');
      setSel([]);
    } catch (e) {
      setError(err(e));
      if (!modal) toast(`${t('actionFailed')}: ${err(e)}`);
    }
  };

  return (
    <div className="pc-stack pc-pad">
      <div className="pc-note">{t('proc_consHint')}</div>

      <Card
        title={t('proc_regionQueue')}
        actions={
          <span className="pc-row">
            {regions.length > 1 && <Select<string> value={activeRegion} onChange={setRegion} options={regions.map((r) => ({ value: r, label: r }))} ariaLabel={t('proc_region')} />}
            {canRegion && (
              <Button size="small" type="primary" disabled={!sel.length} onClick={() => setModal({ kind: 'summary', ids: sel })}>
                {t('proc_sendSummary')}
              </Button>
            )}
          </span>
        }
        flush
      >
        <DataTable
          rows={rows}
          loading={queue.loading}
          rowKey={(r) => r.id}
          emptyText={t('proc_queueEmpty')}
          columns={[
            { header: '', width: 36, render: (r) => (canRegion && r.status === 'pending' ? <Checkbox checked={sel.includes(r.id)} onChange={(v) => setSel((s) => (v ? [...s, r.id] : s.filter((x) => x !== r.id)))} /> : null) },
            { header: t('number'), render: (r) => <Link to={`/procurement/${r.id}`}>{r.number}</Link> },
            { header: t('title'), render: (r) => <>{r.title}<div className="sub">{r.branchKey} · {lk.user(r.initiatorId)?.fullName}</div></> },
            { header: t('amount'), align: 'right', render: (r) => formatMoney(procurementTotal(r.items)) },
            { header: t('status'), render: (r) => <StatusBadge prefix="pstatus_" status={r.status} /> },
            { header: '', render: (r) => (canRegion && r.status === 'pending' ? <Button size="small" onClick={() => setModal({ kind: 'return', id: r.id })}>{t('proc_returnToBranch')}</Button> : null) },
          ]}
        />
      </Card>

      <Card title={t('proc_regionalSummaries')} flush>
        <DataTable
          rows={regional}
          loading={list.loading}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/procurement/consolidation/${c.id}`)}
          columns={[
            { header: t('number'), render: (c) => <span className="doc-num">{c.number}</span> },
            { header: t('title'), render: (c) => <>{c.title}<div className="sub">{c.regionKey} · {formatDate(c.createdAt)}</div></> },
            { header: t('proc_requestsCount'), align: 'right', render: (c) => c.requestIds.length },
            { header: t('amount'), align: 'right', render: (c) => formatMoney(c.requestIds.reduce((s, id) => s + (reqById(id) ? procurementTotal(reqById(id)!.items) : 0), 0)) },
            { header: t('status'), render: (c) => <ToneBadge status={c.status} label={t(tk('proc_cs_', c.status))} /> },
            {
              header: '',
              render: (c) => (
                <span className="pc-row" onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}>
                  {isBuyer && c.status === 'sent' && (
                    <>
                      <Button size="small" type="primary" onClick={() => run(() => procApi.decideRegionalSummary(c.id, 'accept', '', user), t('proc_summaryAccepted'))}>{t('proc_accept')}</Button>
                      <Button size="small" onClick={() => setModal({ kind: 'decline', id: c.id })}>{t('proc_return')}</Button>
                    </>
                  )}
                  {c.status === 'returned' && procApi.canActAsRegion(user, c.regionKey ?? '') && (
                    <Button size="small" onClick={() => run(() => procApi.resendRegionalSummary(c.id, user), t('proc_summaryResent'))}>{t('proc_resend')}</Button>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Card title={t('proc_candidates')}>
        {!candidates.data?.length ? (
          <Empty text={t('proc_noCandidates')} />
        ) : (
          candidates.data.map((g) => {
            const cat = catalog.data?.find((c) => c.id === g.catalogId);
            return (
              <div key={g.catalogId} style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
                <div className="pc-row" style={{ justifyContent: 'space-between' }}>
                  <b>{cat ? `${cat.code} · ${cat.name.ru}` : g.catalogId}</b>
                  {isBuyer && (
                    <Button size="small" type="primary" onClick={() => setModal({ kind: 'consolidate', ids: g.requests.map((r) => r.id) })}>
                      {t('proc_consolidate')}
                    </Button>
                  )}
                </div>
                <div className="muted small">{g.requests.map((r) => `${r.number} (${r.branchKey ?? r.departmentId})`).join(', ')}</div>
              </div>
            );
          })
        )}
      </Card>

      <Card title={t('proc_centralPurchases')} flush>
        <DataTable
          rows={central}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/procurement/consolidation/${c.id}`)}
          emptyText={t('empty')}
          columns={[
            { header: t('number'), render: (c) => <span className="doc-num">{c.number}</span> },
            { header: t('title'), render: (c) => c.title },
            { header: t('proc_requestsCount'), align: 'right', render: (c) => c.requestIds.length },
            { header: t('proc_purchase'), render: (c) => (c.resultRequestId ? <Link to={`/procurement/${c.resultRequestId}`}>{reqById(c.resultRequestId)?.number ?? '→'}</Link> : '—') },
            { header: t('status'), render: (c) => <ToneBadge status={c.status} label={t(tk('proc_cs_', c.status))} /> },
          ]}
        />
      </Card>

      {modal && (
        <Modal
          title={t(modal.kind === 'return' ? 'proc_returnToBranch' : modal.kind === 'decline' ? 'proc_return' : modal.kind === 'summary' ? 'proc_sendSummary' : 'proc_consolidate')}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button onClick={() => setModal(null)}>{t('cancel')}</Button>
              <Button
                type="primary"
                onClick={() => {
                  if (modal.kind === 'return') return run(() => procApi.returnToBranch(modal.id!, text, user), t('proc_returned'));
                  if (modal.kind === 'decline') return run(() => procApi.decideRegionalSummary(modal.id!, 'return', text, user), t('proc_returned'));
                  if (modal.kind === 'summary') return run(() => procApi.sendRegionalSummary(activeRegion, modal.ids!, text, user), t('proc_summarySent'));
                  return run(async () => {
                    const d = await procApi.createConsolidatedPurchase(modal.ids!, text, user);
                    navigate(`/procurement/${d.id}`);
                  }, t('proc_consolidated'));
                }}
              >
                {t('save')}
              </Button>
            </>
          }
        >
          {(modal.kind === 'summary' || modal.kind === 'consolidate') && (
            <p className="muted small" style={{ margin: 0 }}>{(modal.ids ?? []).map((id) => reqById(id)?.number ?? id).join(', ')}</p>
          )}
          <Field label={modal.kind === 'summary' || modal.kind === 'consolidate' ? t('title') : t('proc_reason')} required={modal.kind === 'return' || modal.kind === 'decline'} error={error}>
            {modal.kind === 'summary' || modal.kind === 'consolidate' ? <Input value={text} onChange={(e) => setText(e.target.value)} ariaLabel={t('title')} /> : <Textarea value={text} onChange={(e) => setText(e.target.value)} ariaLabel={t('proc_reason')} />}
          </Field>
        </Modal>
      )}
    </div>
  );
}

export function ConsolidationDetailPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const isBuyer = useIsBuyer();
  const cs = useApi(() => procApi.getConsolidation(id), [id]);
  const all = useApi(() => api.listProcurement(), []);
  const c: ProcConsolidation | undefined = cs.data;
  if (!c) return <Card><Empty text={cs.loading ? '…' : t('empty')} /></Card>;
  const reqs = c.requestIds.map((rid) => all.data?.find((r) => r.id === rid)).filter((r): r is ProcurementRequest => !!r);
  const purchase = c.resultRequestId ? all.data?.find((r) => r.id === c.resultRequestId) : undefined;
  const canDistribute = (isBuyer || can('warehouse', 'edit')) && c.level === 'central' && purchase?.status === 'executed' && c.status !== 'distributed';
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('navProcurement'), to: '/procurement?tab=consolidation' }, { label: c.number }]}
        title={c.title}
        subtitle={`${c.number} · ${t(tk('proc_cslevel_', c.level))}`}
        actions={
          <>
            <ToneBadge status={c.status} label={t(tk('proc_cs_', c.status))} />
            {canDistribute && (
              <Button type="primary" onClick={async () => { try { await procApi.distribute(c.id, user); toast(t('proc_distributed')); } catch (e) { toast(`${t('actionFailed')}: ${err(e)}`); } }}>
                {t('proc_distribute')}
              </Button>
            )}
          </>
        }
      />
      {c.returnReason && <div className="pc-warn">{t('proc_returnedReason')}: {c.returnReason}</div>}
      <div className="grid grid-main">
        <div className="pc-stack">
          <Card title={t('proc_requests')} actions={<ExportButton filename={c.number} rows={reqs} columns={[{ header: t('number'), value: (r) => r.number }, { header: t('title'), value: (r) => r.title }, { header: t('proc_branch'), value: (r) => r.branchKey ?? '' }, { header: t('amount'), value: (r) => procurementTotal(r.items), format: 'money', total: true }]} />} flush>
            <DataTable
              rows={reqs}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/procurement/${r.id}`)}
              columns={[
                { header: t('number'), render: (r) => r.number },
                { header: t('title'), render: (r) => <>{r.title}<div className="sub">{r.branchKey} · {lk.department(r.departmentId) ? loc(lk.department(r.departmentId)!.name) : ''}</div></> },
                { header: t('amount'), align: 'right', render: (r) => formatMoney(procurementTotal(r.items)) },
                { header: t('status'), render: (r) => <StatusBadge prefix="pstatus_" status={r.status} /> },
              ]}
            />
          </Card>
          {c.distribution && (
            <Card title={t('proc_distribution')} flush>
              <DataTable
                rows={c.distribution}
                rowKey={(d) => `${d.requestId}-${d.itemName}`}
                columns={[
                  { header: t('proc_branch'), render: (d) => d.branchKey },
                  { header: t('itemName'), render: (d) => d.itemName },
                  { header: t('qty'), align: 'right', render: (d) => `${d.qty} ${d.unit}` },
                  { header: t('proc_warehouse'), render: (d) => d.warehouseId },
                  { header: t('status'), render: (d) => <ToneBadge status={d.status === 'done' ? 'done' : 'planned'} label={t(tk('proc_dist_', d.status))} /> },
                ]}
              />
            </Card>
          )}
        </div>
        <div className="pc-stack">
          <Card title={t('details')}>
            <Kv items={[[t('proc_region'), c.regionKey ?? '—'], [t('initiator'), lk.user(c.createdBy)?.fullName], [t('date'), formatDate(c.createdAt)], [t('proc_purchase'), purchase ? <Link to={`/procurement/${purchase.id}`}>{purchase.number}</Link> : '—']]} />
          </Card>
          <Card title={t('history')}>
            <Timeline events={c.history} />
          </Card>
        </div>
      </div>
    </>
  );
}
