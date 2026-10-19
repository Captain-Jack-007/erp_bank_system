// Карточка заявки на закупку: реквизиты, номенклатура и спецификации, МВЗ, верификация, процесс по способу,
// бюджет с резервом, маршрут, подписи E-IMZO (инициатор и согласующие) с QR в печатной форме, ТЗ,
// биржа (УзРТСБ), тендерная площадка, сводная закупка, договор, приёмка (ТЗ 4.2.1).
import { useEffect, useMemo, useState } from 'react';
import {
  addDays, api, approvalsApi, currencyLabel, formatDate, formatMoney, procApi, procurementTotal, processPlan, signatureService, supplierAdmission, tk,
  type PrintDocument, type ProcurementMethod, type ProcurementRequest, type SignableDoc, type Tender, userError } from '@xb/shared';
import { Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Progress, RouteSteps, Select, StatusBadge, Textarea, Timeline, useToast } from '../../components/ui';
import { Attachments } from '../../components/Attachments';
import { PrintButton } from '../../components/PrintView';
import { SignaturesPanel } from '../../components/SignModal';
import { FieldHistory } from '../../components/FieldHistory';
import { Link, navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Kv, ToneBadge, useCostCenters, useErr } from './shared';
import { ProcessChips, VerificationList } from './parts';
import { PROC_METHODS } from './ProcurementForm';

/** Каноническое содержимое заявки для подписи (не зависит от языка интерфейса). */
export function procurementContent(p: ProcurementRequest) {
  return { type: 'procurement', number: p.number, title: p.title, kind: p.kind ?? 'goods', method: p.method, costCenter: p.costCenterKey ?? '', budgetLine: p.budgetLineId, neededBy: p.neededBy, items: p.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, price: i.unitPrice, spec: i.spec ?? '' })), total: procurementTotal(p.items) };
}

function currentStep(p: ProcurementRequest, steps: string[]): number {
  const idx = (code: string) => Math.max(0, steps.indexOf(code));
  switch (p.status) {
    case 'draft':
    case 'returned':
      return 0;
    case 'pending':
      return idx('approval');
    case 'approved':
    case 'consolidated':
      return idx('approval') + 1;
    case 'in_tender':
      return idx('tender_bids');
    case 'in_exchange':
      return idx('exchange_trading');
    case 'contracted':
      return idx('contract') + 1;
    case 'executed':
      return steps.length - 1;
    default:
      return 0;
  }
}

export function ProcurementDetailPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const toast = useToast();
  const err = useErr();
  const cc = useCostCenters();
  const doc = useApi(() => api.getProcurement(id), [id]);
  const tenders = useApi(() => api.listTenders());
  const contracts = useApi(() => api.listContracts(), []);
  const groups = useApi(() => procApi.listBusinessGroups(), []);
  const route = useApi(() => approvalsApi.getRoute(id), [id]);
  const sigs = useApi(() => signatureService.list('procurement', id), [id]);
  const budget = useApi(async () => (doc.data ? procApi.budgetCheck(doc.data.budgetLineId, procurementTotal(doc.data.items), doc.data.id) : undefined), [doc.data?.id, doc.data?.status]);
  const [modal, setModal] = useState<'tender' | 'contract' | 'method' | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(okMsg);
    } catch (e) {
      toast(`${t('actionFailed')}: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const p = doc.data;
  const content = useMemo(() => (p ? procurementContent(p) : null), [p]);
  if (doc.loading && !p) return <Card><Loading /></Card>;
  if (!p || !content) return <Card><Empty text={t('empty')} /></Card>;

  const total = procurementTotal(p.items);
  const line = lk.budgetLine(p.budgetLineId);
  const tender = tenders.data?.find((x) => x.requestId === p.id);
  const isBuyer = can('procurement', 'edit') && (user.role === 'procurement' || user.role === 'admin' || !!user.extraRoles?.includes('procurement'));
  const canSubmit = p.status === 'draft' && p.initiatorId === user.id;
  const canResubmit = p.status === 'returned' && (p.initiatorId === user.id || user.role === 'admin');
  const canAnnounce = isBuyer && p.status === 'approved' && p.method === 'tender' && !tender;
  const canContract = isBuyer && p.status === 'approved' && p.method !== 'exchange' && (p.method !== 'tender' || tender?.status === 'awarded');
  const canMethod = isBuyer && ['draft', 'pending', 'approved'].includes(p.status) && !tender;
  const steps = processPlan(p);
  const myContracts = (contracts.data ?? []).filter((c) => c.requestId === p.id);
  const group = groups.data?.find((g) => g.id === p.businessGroupId);
  const approverIds = new Set((route.data?.steps ?? []).flatMap((s) => s.decisions.filter((d) => d.decision === 'approved').map((d) => d.userId)));
  const currentApprovers = new Set((route.data?.steps ?? []).filter((s) => s.state === 'current').flatMap((s) => s.approvers.flatMap((a) => a.userIds ?? [])));
  const canSign = p.initiatorId === user.id || approverIds.has(user.id) || currentApprovers.has(user.id) || (route.data?.steps.some((s) => s.state === 'current' && s.approvers.some((a) => !a.userIds && a.role === user.role)) ?? false);
  const signDoc: SignableDoc = { entity: 'procurement', entityId: p.id, title: `${p.number} · ${p.title}`, content };

  const printDoc = (): PrintDocument => ({
    entity: 'procurement',
    entityId: p.id,
    title: t('proc_printTitle'),
    number: p.number,
    date: p.createdAt.slice(0, 10),
    fields: [
      { label: t('title'), value: p.title },
      { label: t('proc_kind'), value: t(tk('proc_kind_', p.kind ?? 'goods')) },
      { label: t('initiator'), value: lk.user(p.initiatorId)?.fullName ?? '' },
      { label: t('department'), value: lk.department(p.departmentId) ? loc(lk.department(p.departmentId)!.name) : '' },
      { label: t('proc_costCenter'), value: cc.label(p.costCenterKey) },
      { label: t('budgetLine'), value: line ? `${line.code} · ${loc(line.name)}` : '' },
      { label: t('method'), value: t(tk('method_', p.method)) },
      { label: t('neededBy'), value: formatDate(p.neededBy) },
      { label: t('justification'), value: p.justification },
    ],
    table: {
      columns: [{ header: '№', align: 'center', width: '6%' }, { header: t('itemName') }, { header: t('proc_spec') }, { header: t('qty'), align: 'right' }, { header: t('unitPrice'), align: 'right' }, { header: t('amount'), align: 'right' }],
      rows: p.items.map((i, n) => [String(n + 1), i.name, i.spec ?? '', `${i.qty} ${i.unit}`, formatMoney(i.unitPrice), formatMoney(i.qty * i.unitPrice)]),
      totals: ['', t('total'), '', '', '', formatMoney(total)],
    },
    signers: [
      { role: t('initiator'), name: lk.user(p.initiatorId)?.fullName ?? '', ...(sigs.data?.find((s) => s.userId === p.initiatorId) ? { signatureId: sigs.data.find((s) => s.userId === p.initiatorId)!.id } : {}) },
      ...[...approverIds].map((uid) => ({ role: t('proc_approver'), name: lk.user(uid)?.fullName ?? uid, ...(sigs.data?.find((s) => s.userId === uid) ? { signatureId: sigs.data.find((s) => s.userId === uid)!.id } : {}) })),
    ],
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('navProcurement'), to: '/procurement' }, { label: p.number }]}
        title={p.title}
        subtitle={`${p.number} · ${lk.department(p.departmentId) ? loc(lk.department(p.departmentId)!.name) : ''}`}
        actions={
          <>
            <StatusBadge prefix="pstatus_" status={p.status} />
            <PrintButton doc={printDoc} />
            {canSubmit && (
              <Button type="primary" disabled={busy} onClick={() => run(() => api.submitProcurement(p.id, user), `${p.number}: ${t('hist_submitted')}`)}>
                {t('submitForApproval')}
              </Button>
            )}
            {canResubmit && (
              <Button type="primary" disabled={busy} onClick={() => run(() => procApi.resubmitReturned(p.id, user), `${p.number}: ${t('hist_submitted')}`)}>
                {t('proc_resubmit')}
              </Button>
            )}
            {canMethod && <Button onClick={() => setModal('method')}>{t('proc_changeMethod')}</Button>}
            {canAnnounce && (
              <Button type="primary" onClick={() => setModal('tender')}>
                {t('announceTender')}
              </Button>
            )}
            {isBuyer && p.status === 'approved' && p.method === 'exchange' && !p.exchange?.lotNo && (
              <Button type="primary" disabled={busy} onClick={() => run(() => procApi.submitToExchange(p.id, user), t('proc_exSubmitted'))}>
                {t('proc_exSubmit')}
              </Button>
            )}
            {canContract && (
              <Button type="primary" onClick={() => setModal('contract')}>
                {t('createContract')}
              </Button>
            )}
          </>
        }
      />

      {modal === 'tender' && <AnnounceTenderModal request={p} onClose={() => setModal(null)} />}
      {modal === 'contract' && <CreateContractModal request={p} tender={tender} onClose={() => setModal(null)} />}
      {modal === 'method' && <MethodModal request={p} onClose={() => setModal(null)} />}

      {p.status === 'returned' && p.returnReason && <div className="pc-warn">{t('proc_returnedReason')}: {p.returnReason}</div>}

      <div className="grid grid-main">
        <div className="pc-stack">
          <Card title={t('details')}>
            <Kv
              items={[
                [t('initiator'), lk.user(p.initiatorId)?.fullName],
                [t('proc_kind'), t(tk('proc_kind_', p.kind ?? 'goods'))],
                [t('method'), t(tk('method_', p.method))],
                [t('neededBy'), formatDate(p.neededBy)],
                [t('budgetLine'), line ? `${line.code} · ${loc(line.name)}` : '—'],
                [t('proc_bpGroup'), group ? `${group.code} · ${loc(group.name)}` : '—'],
                [t('proc_costCenter'), cc.label(p.costCenterKey)],
                [t('proc_branch'), p.branchKey ?? '—'],
                [t('proc_intake'), p.intake ? t(tk('proc_intake_', p.intake)) : '—'],
                [t('justification'), <span style={{ fontWeight: 400 }}>{p.justification}</span>],
              ]}
            />
          </Card>

          <Card title={t('items')} flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('itemName')}</th>
                    <th className="right">{t('qty')}</th>
                    <th>{t('unit')}</th>
                    <th className="right">{t('unitPrice')}</th>
                    <th className="right">{t('amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.items.map((it, i) => (
                    <tr key={i}>
                      <td className="muted">{i + 1}</td>
                      <td>
                        {it.name}
                        {it.spec && <div className="sub">{it.spec}</div>}
                        {!it.catalogId && <div className="sub">{t('proc_freeText')}</div>}
                      </td>
                      <td className="right num">{it.qty}</td>
                      <td className="muted">{it.unit}</td>
                      <td className="right num">{formatMoney(it.unitPrice)}</td>
                      <td className="right num">{formatMoney(it.qty * it.unitPrice)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={5} className="right" style={{ fontWeight: 700 }}>{t('total')}</td>
                    <td className="right num" style={{ fontWeight: 700 }}>{formatMoney(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t('proc_process')}>
            <ProcessChips steps={steps} current={currentStep(p, steps)} />
          </Card>

          {p.verification && (
            <Card title={t('proc_verification')}>
              <VerificationList v={p.verification} />
            </Card>
          )}

          {(p.method === 'exchange' || p.exchange) && <ExchangePanel p={p} isBuyer={isBuyer} />}

          {tender && (
            <Card title={t('tenders')}>
              <Kv
                items={[
                  [t('number'), tender.number],
                  [t('status'), t(tk('tstatus_', tender.status))],
                  [t('deadline'), formatDate(tender.deadline)],
                  [t('proc_platform'), tender.platform ? `${tender.platform} · ${tender.externalId ?? '—'}` : t('proc_notPublished')],
                  [t('proc_bids'), String(tender.bids.length)],
                ]}
              />
              <div style={{ marginTop: 10 }}>
                <Link to="/procurement?tab=tenders">{t('proc_openTenders')}</Link>
              </div>
            </Card>
          )}

          {(p.consolidationId || p.consolidatedFrom) && (
            <Card title={t('proc_consolidation')}>
              {p.consolidatedFrom && <p style={{ margin: '0 0 8px' }}>{t('proc_consolidatedFrom')}: {p.consolidatedFrom.length}</p>}
              {p.consolidationId && (
                <Link to={`/procurement/consolidation/${p.consolidationId}`}>{t('proc_openConsolidation')}</Link>
              )}
            </Card>
          )}

          {myContracts.length > 0 && (
            <Card title={t('navContracts')}>
              {myContracts.map((c) => (
                <div key={c.id} className="pc-row" style={{ justifyContent: 'space-between' }}>
                  <Link to={`/contracts/${c.id}`}>{c.number} · {c.subject}</Link>
                  <span className="pc-row">
                    <span className="num">{formatMoney(c.amount, c.currency)}</span>
                    <StatusBadge prefix="cstatus_" status={c.status} />
                  </span>
                </div>
              ))}
            </Card>
          )}

          <Attachments entity="procurement" entityId={p.attachmentKey ?? p.id} title={t('proc_tzAttachments')} readOnly={!['draft', 'returned', 'pending'].includes(p.status) || (p.initiatorId !== user.id && !isBuyer)} />
        </div>

        <div className="pc-stack">
          <Card title={t('route')}>
            {p.intake === 'region' || p.intake === 'central' ? <div className="pc-note">{t(tk('proc_intakeNote_', p.intake))}</div> : <RouteSteps entityId={id} />}
          </Card>
          {line && budget.data && (
            <Card title={t('proc_budgetCheck')}>
              <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{formatMoney(budget.data.available)}</div>
              <div className="muted small" style={{ margin: '4px 0 10px' }}>
                {t('planned')}: {formatMoney(budget.data.planned)} · {t('spent')}: {formatMoney(budget.data.spent)} · {t('proc_reserved')}: {formatMoney(budget.data.reserved)}
              </div>
              <Progress pct={Math.round(((budget.data.spent + budget.data.reserved) / Math.max(1, budget.data.planned)) * 100)} />
              <div style={{ marginTop: 8 }}>{budget.data.ok ? <ToneBadge status="approved" label={t('proc_budgetOk')} /> : <ToneBadge status="rejected" label={t('proc_budgetLack')} />}</div>
            </Card>
          )}
          <SignaturesPanel doc={signDoc} canSign={canSign} onSigned={(rec) => void procApi.recordSignature(p.id, rec.id, user).catch(() => undefined)} />
          <Card title={t('history')}>
            <Timeline events={p.history} />
          </Card>
          <Card title={t('proc_fieldHistory')}>
            <FieldHistory entity="procurement" entityId={p.id} />
          </Card>
        </div>
      </div>
    </>
  );
}

function ExchangePanel({ p, isBuyer }: { p: ProcurementRequest; isBuyer: boolean }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const [busy, setBusy] = useState(false);
  const lot = p.exchange;
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
    <Card
      title={t('proc_exchange')}
      actions={
        isBuyer ? (
          <span className="pc-row">
            {!lot?.advanceContractId && ['approved', 'in_exchange'].includes(p.status) && (
              <Button size="small" disabled={busy} onClick={() => act(() => procApi.exchangeAdvance(p.id, user), t('proc_exAdvanceDone'))}>{t('proc_exAdvance')}</Button>
            )}
            {lot?.lotNo && lot.status !== 'won' && lot.status !== 'failed' && (
              <>
                <Button size="small" icon="refresh" disabled={busy} onClick={() => act(() => procApi.syncExchange(p.id, user), t('proc_exSynced'))}>{t('proc_exSync')}</Button>
                <Button size="small" type="primary" disabled={busy} onClick={() => act(() => procApi.fetchExchangeResults(p.id, user), t('proc_exResults'))}>{t('proc_exGetResults')}</Button>
              </>
            )}
          </span>
        ) : undefined
      }
    >
      {!lot ? (
        <p className="muted" style={{ margin: 0 }}>{t('proc_exNone')}</p>
      ) : (
        <Kv
          items={[
            [t('proc_exLot'), lot.lotNo ?? '—'],
            [t('status'), t(tk('proc_ex_', lot.status))],
            [t('proc_exStart'), formatMoney(lot.startPrice)],
            [t('proc_exSynced'), lot.syncedAt ? formatDate(lot.syncedAt) : '—'],
            [t('winner'), lot.winnerId ? lk.counterparty(lot.winnerId)?.name : '—'],
            [t('proc_exPrice'), lot.price ? formatMoney(lot.price) : '—'],
            [t('navContracts'), lot.contractId ? <Link to={`/contracts/${lot.contractId}`}>{t('proc_openContract')}</Link> : '—'],
            [t('proc_exAdvance'), lot.advanceContractId ? <Link to={`/contracts/${lot.advanceContractId}`}>{t('proc_openContract')}</Link> : '—'],
          ]}
        />
      )}
    </Card>
  );
}

function MethodModal({ request, onClose }: { request: ProcurementRequest; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const rec = procApi.recommendMethod(procurementTotal(request.items), request.items, request.kind ?? 'goods');
  const [method, setMethod] = useState<ProcurementMethod>(rec.method);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title={`${t('proc_changeMethod')}: ${request.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            onClick={async () => {
              try {
                await procApi.changeMethod(request.id, method, comment, user);
                toast(t('proc_methodChanged'));
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
      <div className="pc-note">{t('proc_recommended')}: {t(tk('method_', rec.method))} — {t(rec.reason as 'proc_rule_small')}</div>
      <Field label={t('method')} required>
        <Select<ProcurementMethod> value={method} onChange={setMethod} options={PROC_METHODS.map((m) => ({ value: m, label: t(tk('method_', m)) }))} ariaLabel={t('method')} />
      </Field>
      <Field label={t('comment')} required error={error}>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} ariaLabel={t('comment')} />
      </Field>
    </Modal>
  );
}

function AnnounceTenderModal({ request, onClose }: { request: ProcurementRequest; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const [deadline, setDeadline] = useState(addDays(14).slice(0, 10));
  const [requirements, setRequirements] = useState(request.items.map((i) => `${i.name}: ${i.qty} ${i.unit}${i.spec ? ` — ${i.spec}` : ''}`).join('\n'));
  const [criteria, setCriteria] = useState(t('proc_defaultCriteria'));
  const [publish, setPublish] = useState<'yes' | 'no'>('yes');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`${t('announceTender')}: ${request.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            disabled={busy || !deadline}
            onClick={async () => {
              setBusy(true);
              try {
                const tn = await api.announceTender(request.id, user, deadline);
                if (publish === 'yes') await procApi.publishTender(tn.id, { requirements, criteria }, user);
                toast(`${tn.number}: ${t('tstatus_open')}`);
                onClose();
              } catch (e) {
                toast(`${t('actionFailed')}: ${err(e)}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('announceTender')}
          </Button>
        </>
      }
    >
      <div style={{ fontWeight: 600 }}>{request.title}</div>
      <Field label={t('deadline')} required>
        <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} ariaLabel={t('deadline')} />
      </Field>
      <Field label={t('proc_publishPlatform')}>
        <Select<'yes' | 'no'> value={publish} onChange={setPublish} options={[{ value: 'yes', label: t('proc_publishYes') }, { value: 'no', label: t('proc_publishNo') }]} ariaLabel={t('proc_publishPlatform')} />
      </Field>
      <Field label={t('proc_tenderRequirements')} required>
        <Textarea value={requirements} rows={4} onChange={(e) => setRequirements(e.target.value)} ariaLabel={t('proc_tenderRequirements')} />
      </Field>
      <Field label={t('proc_tenderCriteria')} required>
        <Input value={criteria} onChange={(e) => setCriteria(e.target.value)} ariaLabel={t('proc_tenderCriteria')} />
      </Field>
    </Modal>
  );
}

function CreateContractModal({ request, tender, onClose }: { request: ProcurementRequest; tender?: Tender | undefined; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const winnerBid = tender?.bids.find((b) => b.counterpartyId === tender.winnerId);
  const [counterpartyId, setCounterpartyId] = useState(tender?.winnerId ?? lk.counterparties.find((c) => !c.blocked)?.id ?? '');
  const [amount, setAmount] = useState(winnerBid?.amount ?? procurementTotal(request.items));
  const [startDate, setStartDate] = useState(addDays(1).slice(0, 10));
  const [endDate, setEndDate] = useState(addDays(180).slice(0, 10));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const admission = counterpartyId ? supplierAdmission(counterpartyId) : undefined;

  useEffect(() => {
    if (!counterpartyId) {
      const first = lk.counterparties.find((c) => !c.blocked);
      if (first) setCounterpartyId(first.id);
    }
  }, [counterpartyId, lk.counterparties]);

  async function save() {
    if (!counterpartyId || !startDate || !endDate) return setError(t('formRequired'));
    if (!(amount > 0)) return setError(t('amountPositive'));
    if (endDate < startDate) return setError(t('endBeforeStart'));
    if (admission && !admission.allowed) return setError(t('proc_err_supplier_blocked'));
    setBusy(true);
    try {
      const c = await api.createContractFromRequest(request.id, { counterpartyId, amount, startDate, endDate }, user);
      toast(`${c.number}: ${t('cstatus_pending')}`);
      onClose();
      navigate(`/contracts/${c.id}`);
    } catch (e) {
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${t('createContract')}: ${request.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" disabled={busy} onClick={save}>{t('createContract')}</Button>
        </>
      }
    >
      <Field label={t('counterparty')} required hint={tender?.winnerId ? `${t('winner')}: ${tender.number}` : undefined}>
        <Select<string>
          value={counterpartyId}
          onChange={setCounterpartyId}
          disabled={!!tender?.winnerId}
          options={lk.counterparties.filter((c) => !c.blocked || c.id === counterpartyId).map((c) => ({ value: c.id, label: c.name }))}
          ariaLabel={t('counterparty')}
        />
      </Field>
      {admission && !admission.allowed && <div className="pc-danger">{t('proc_supplierNotAllowed')}: {admission.reasons.map((r) => t(tk('proc_list_', r))).join(', ')}</div>}
      <Field label={`${t('amount')}, ${currencyLabel()}`} required hint={formatMoney(amount || 0)}>
        <Input type="number" className="num" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} ariaLabel={t('amount')} />
      </Field>
      <div className="form-grid">
        <Field label={t('startDate')} required>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} ariaLabel={t('startDate')} />
        </Field>
        <Field label={t('endDate')} required>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} ariaLabel={t('endDate')} />
        </Field>
      </div>
      <RouteSteps preview={{ entity: 'contract', context: { amount, kind: request.kind === 'works' ? 'construction' : request.kind === 'services' ? 'services' : 'fixed_assets', requesterId: user.id } }} />
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}
