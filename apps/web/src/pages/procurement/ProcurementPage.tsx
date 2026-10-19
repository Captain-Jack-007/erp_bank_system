// Модуль «Закупки и тендеры» (ТЗ 4.2.1): заявки, сводные заявки и приём заявок ЦБУ, тендеры (площадки),
// биржа УзРТСБ, приёмка товаров и услуг, поставщики, номенклатура, мониторинг и аналитика.
import { useState } from 'react';
import { api, formatDate, formatMoney, procApi, procurementTotal, supplierAdmission, tk, type ProcurementKind, type ProcurementStatus, type Tender } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, StatusBadge, Tabs, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link, navigate, useQuery } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCostCenters, useErr } from './shared';
import { PROC_KINDS } from './ProcurementForm';
import { ConsolidationTab } from './ConsolidationTab';
import { ExchangeTab } from './ExchangeTab';
import { AcceptanceTab } from './AcceptanceTab';
import { SuppliersTab } from './SuppliersTab';
import { CatalogTab } from './CatalogTab';
import { MonitoringTab } from './MonitoringTab';

const STATUSES: ProcurementStatus[] = ['draft', 'pending', 'returned', 'approved', 'in_tender', 'in_exchange', 'contracted', 'consolidated', 'executed', 'rejected'];
type TabId = 'requests' | 'consolidation' | 'tenders' | 'exchange' | 'acceptance' | 'suppliers' | 'catalog' | 'monitoring';
const TABS: TabId[] = ['requests', 'consolidation', 'tenders', 'exchange', 'acceptance', 'suppliers', 'catalog', 'monitoring'];

export function ProcurementPage() {
  const { t } = useSession();
  const can = useCan();
  const query = useQuery();
  const initial = (query.get('tab') as TabId | null) ?? 'requests';
  const [tab, setTabState] = useState<TabId>(TABS.includes(initial) ? initial : 'requests');
  const requests = useApi(() => api.listProcurement());
  const tenders = useApi(() => api.listTenders());
  const setTab = (v: TabId) => {
    setTabState(v);
    navigate(`/procurement${v === 'requests' ? '' : `?tab=${v}`}`);
  };

  return (
    <>
      <PageHeader
        title={t('procurementTitle')}
        subtitle={`${t('tzLabel')} 4.2.1 · Procurement & Tendering`}
        actions={
          can('procurement', 'edit') ? (
            <Link to="/procurement/new" className="btn btn-primary">
              {t('newRequest')}
            </Link>
          ) : undefined
        }
      />
      <Card flush>
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'requests', label: t('procurementRequests'), count: requests.data?.length },
            { value: 'consolidation', label: t('proc_tab_consolidation') },
            { value: 'tenders', label: t('tenders'), count: tenders.data?.length },
            { value: 'exchange', label: t('proc_tab_exchange') },
            { value: 'acceptance', label: t('proc_tab_acceptance') },
            { value: 'suppliers', label: t('proc_tab_suppliers') },
            { value: 'catalog', label: t('proc_tab_catalog') },
            { value: 'monitoring', label: t('proc_tab_monitoring') },
          ]}
        />
        {tab === 'requests' && <RequestsTable />}
        {tab === 'tenders' && <TendersTable />}
        {tab === 'consolidation' && <ConsolidationTab />}
        {tab === 'exchange' && <ExchangeTab />}
        {tab === 'acceptance' && <AcceptanceTab />}
        {tab === 'suppliers' && <SuppliersTab />}
        {tab === 'catalog' && <CatalogTab />}
        {tab === 'monitoring' && <MonitoringTab />}
      </Card>
    </>
  );
}

function RequestsTable() {
  const { t, loc } = useSession();
  const lk = useLookups();
  const cc = useCostCenters();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProcurementStatus | ''>('');
  const [dept, setDept] = useState('');
  const [kind, setKind] = useState<ProcurementKind | ''>('');
  const list = useApi(
    () => api.listProcurement({ search, ...(status ? { status } : {}), ...(dept ? { departmentId: dept } : {}) }).then((rows) => (kind ? rows.filter((r) => (r.kind ?? 'goods') === kind) : rows)),
    [search, status, dept, kind],
  );
  const rows = list.data ?? [];

  return (
    <>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('number')}, ${t('title').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select<ProcurementStatus | ''> value={status} onChange={setStatus} ariaLabel={t('status')} options={[{ value: '', label: `${t('status')}: ${t('all')}` }, ...STATUSES.map((s) => ({ value: s, label: t(tk('pstatus_', s)) }))]} />
        <Select<string> value={dept} onChange={setDept} ariaLabel={t('department')} options={[{ value: '', label: `${t('department')}: ${t('all')}` }, ...lk.departments.map((d) => ({ value: d.id, label: d.code }))]} />
        <Select<ProcurementKind | ''> value={kind} onChange={setKind} ariaLabel={t('proc_kind')} options={[{ value: '', label: `${t('proc_kind')}: ${t('all')}` }, ...PROC_KINDS.map((k) => ({ value: k, label: t(tk('proc_kind_', k)) }))]} />
        <ExportButton
          filename={t('procurementRequests')}
          rows={rows}
          columns={[
            { header: t('number'), value: (p) => p.number },
            { header: t('title'), value: (p) => p.title },
            { header: t('proc_kind'), value: (p) => t(tk('proc_kind_', p.kind ?? 'goods')) },
            { header: t('department'), value: (p) => (lk.department(p.departmentId) ? loc(lk.department(p.departmentId)!.name) : p.departmentId) },
            { header: t('proc_costCenter'), value: (p) => cc.label(p.costCenterKey) },
            { header: t('initiator'), value: (p) => lk.user(p.initiatorId)?.fullName ?? '' },
            { header: t('method'), value: (p) => t(tk('method_', p.method)) },
            { header: t('neededBy'), value: (p) => p.neededBy },
            { header: t('amount'), value: (p) => procurementTotal(p.items), format: 'money', total: true },
            { header: t('status'), value: (p) => t(tk('pstatus_', p.status)) },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/procurement/${p.id}`)}
        columns={[
          { header: t('number'), render: (p) => <span className="doc-num">{p.number}</span> },
          { header: t('title'), render: (p) => <>{p.title}<div className="sub">{lk.department(p.departmentId)?.code} · {t(tk('proc_kind_', p.kind ?? 'goods'))} · {formatDate(p.createdAt)}</div></> },
          { header: t('initiator'), render: (p) => lk.user(p.initiatorId)?.fullName },
          { header: t('method'), render: (p) => <span className="muted">{t(tk('method_', p.method))}</span> },
          { header: t('neededBy'), render: (p) => <span className="num">{formatDate(p.neededBy)}</span> },
          { header: t('amount'), align: 'right', render: (p) => formatMoney(procurementTotal(p.items)) },
          { header: t('status'), render: (p) => <StatusBadge prefix="pstatus_" status={p.status} /> },
        ]}
      />
    </>
  );
}

function TendersTable() {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const canAward = can('procurement', 'edit') && (user.role === 'procurement' || user.role === 'admin');
  const tenders = useApi(() => api.listTenders());
  const [bidFor, setBidFor] = useState<Tender | null>(null);
  const [busy, setBusy] = useState(false);
  if (tenders.loading && !tenders.data) return <Loading />;
  if (!tenders.data?.length) return <Empty text={t('empty')} />;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {tenders.data.map((tn) => {
        const awardable = canAward && !tn.winnerId && (tn.status === 'open' || tn.status === 'evaluation');
        const best = [...tn.bids].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
        return (
          <div key={tn.id} style={{ padding: 18, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div className="doc-num" style={{ color: 'var(--brand-700)', fontWeight: 600 }}>
                  <Link to={`/procurement/${tn.requestId}`}>{tn.number}</Link>
                </div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{tn.title}</div>
                <div className="muted small">
                  {t('deadline')}: {formatDate(tn.deadline)} · {t('proc_platform')}: {tn.platform ? `${tn.platform} ${tn.externalId ?? ''}` : t('proc_notPublished')}
                </div>
              </div>
              <div className="pc-row">
                <StatusBadge prefix="tstatus_" status={tn.status} />
                {awardable && (
                  <>
                    {!tn.platform && (
                      <Button size="small" disabled={busy} onClick={() => act(() => procApi.publishTender(tn.id, { requirements: tn.title, criteria: t('proc_defaultCriteria') }, user), t('proc_published'))}>
                        {t('proc_publish')}
                      </Button>
                    )}
                    <Button size="small" icon="refresh" disabled={busy} onClick={() => act(() => procApi.fetchTenderBids(tn.id, user), t('proc_bidsFetched'))}>
                      {t('proc_fetchBids')}
                    </Button>
                    <Button size="small" icon="plus" disabled={busy} onClick={() => setBidFor(tn)}>
                      {t('proc_manualBid')}
                    </Button>
                    <Button size="small" type="primary" disabled={busy || !tn.bids.length} onClick={() => act(async () => { const c = await procApi.fetchTenderResults(tn.id, user); navigate(`/contracts/${c.id}`); }, t('proc_resultsFetched'))}>
                      {t('proc_fetchResults')}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {tn.docs && <div className="muted small" style={{ marginBottom: 8 }}>{t('proc_tenderCriteria')}: {tn.docs.criteria}</div>}
            <div className="table-wrap">
              <table className="table" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                <thead>
                  <tr>
                    <th>{t('counterparty')}</th>
                    <th className="right">{t('amount')}</th>
                    <th className="right">{t('deliveryDays')}</th>
                    <th className="right">{t('score')}</th>
                    <th>{t('proc_bidSource')}</th>
                    {awardable && <th />}
                  </tr>
                </thead>
                <tbody>
                  {tn.bids.map((b) => {
                    const isWinner = tn.winnerId === b.counterpartyId;
                    const isLeader = !tn.winnerId && best?.counterpartyId === b.counterpartyId;
                    const adm = supplierAdmission(b.counterpartyId);
                    return (
                      <tr key={b.counterpartyId} style={isWinner || isLeader ? { background: 'var(--brand-50)' } : undefined}>
                        <td>
                          {lk.counterparty(b.counterpartyId)?.name}
                          {isWinner && <span className="badge ok" style={{ marginLeft: 8 }}>{t('winner')}</span>}
                          {!adm.allowed && <span style={{ marginLeft: 8 }}><Badge tone="danger">{t('proc_supplierNotAllowed')}</Badge></span>}
                        </td>
                        <td className="right num">{formatMoney(b.amount)}</td>
                        <td className="right num">{b.deliveryDays}</td>
                        <td className="right num" style={{ fontWeight: 700 }}>{b.score ?? '—'}</td>
                        <td className="muted small">{t(tk('proc_src_', tn.bidSources?.[b.counterpartyId] ?? 'platform'))}</td>
                        {awardable && (
                          <td className="right">
                            <button
                              className={`btn btn-sm ${isLeader ? 'btn-primary' : ''}`}
                              disabled={!adm.allowed}
                              onClick={async () => {
                                try {
                                  await api.awardTender(tn.id, b.counterpartyId, user);
                                  toast(`${tn.number}: ${t('winner')} — ${lk.counterparty(b.counterpartyId)?.name ?? ''}`);
                                } catch (e) {
                                  toast(`${t('actionFailed')}: ${err(e)}`);
                                }
                              }}
                            >
                              {t('chooseWinner')}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {bidFor && <ManualBidModal tender={bidFor} onClose={() => setBidFor(null)} />}
    </div>
  );
}

function ManualBidModal({ tender, onClose }: { tender: Tender; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useErr();
  const [cp, setCp] = useState('');
  const [amount, setAmount] = useState(0);
  const [days, setDays] = useState(10);
  const [error, setError] = useState('');
  return (
    <Modal
      title={`${t('proc_manualBid')}: ${tender.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            onClick={async () => {
              try {
                await procApi.addManualBid(tender.id, { counterpartyId: cp, amount, deliveryDays: days }, user);
                toast(t('proc_bidAdded'));
                onClose();
              } catch (e) {
                setError(err(e));
              }
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <Field label={t('counterparty')} required>
        <Select<string> value={cp} onChange={setCp} placeholder="—" options={lk.counterparties.filter((c) => !tender.bids.some((b) => b.counterpartyId === c.id)).map((c) => ({ value: c.id, label: c.name }))} ariaLabel={t('counterparty')} />
      </Field>
      <div className="form-grid">
        <Field label={t('amount')} required>
          <Input type="number" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} ariaLabel={t('amount')} />
        </Field>
        <Field label={t('deliveryDays')} required>
          <Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} ariaLabel={t('deliveryDays')} />
        </Field>
      </div>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}
