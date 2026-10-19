// Платежи по договорам (PR-CON-045…052): платёжные поручения (маршрут `payment`, E-IMZO, QR, отправка в iABS,
// SWIFT), автооплата периодических платежей по ЭСФ; электронные договоры с платформ Soliqservis (PR-PROC-053…057).
import { useState } from 'react';
import {
  api, contractsApi, formatDate, formatDateTime, formatMoney, procApi, tk,
  type Contract, type PaymentOrder, type PlatformContract, type PrintDocument,
} from '@xb/shared';
import { Button, Card, DataTable, Empty, Field, Input, Loading, Modal, PageHeader, RouteSteps, Select, Textarea, Timeline, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { SignModal, SignaturesPanel } from '../../components/SignModal';
import { Link, navigate } from '../../lib/router';
import { useCan, useStepUp, GuardedLink } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Kv, ToneBadge, useCostCenters, useErr } from '../procurement/shared';
import { PostingsCard } from '../procurement/PostingsCard';

const ORDER_STATUSES = ['draft', 'pending', 'approved', 'signed', 'sent', 'executed', 'rejected', 'failed'];

export function PaymentsView() {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const [status, setStatus] = useState('');
  const list = useApi(() => contractsApi.listOrders({ ...(status ? { status } : {}) }), [status]);
  const contracts = useApi(() => api.listContracts(), []);
  const [busy, setBusy] = useState(false);
  const num = (id: string) => contracts.data?.find((c) => c.id === id)?.number ?? id;
  return (
    <div className="pc-stack pc-pad">
      <div className="pc-row" style={{ justifyContent: 'space-between' }}>
        <span className="muted small">{t('con_ordersHint')}</span>
        <span className="pc-row">
          <Select<string> value={status} onChange={setStatus} ariaLabel={t('status')} options={[{ value: '', label: `${t('status')}: ${t('all')}` }, ...ORDER_STATUSES.map((s) => ({ value: s, label: t(tk('con_po_', s)) }))]} />
          {can('contracts', 'edit') && (
            <Button size="small" icon="refresh" disabled={busy} onClick={async () => { setBusy(true); try { const r = await contractsApi.autoMonthly(user); toast(`${t('con_autoCreated')}: ${r.created.length}${r.waiting.length ? ` · ${t('con_autoWaiting')}: ${r.waiting.join(', ')}` : ''}`); } catch (e) { toast(err(e)); } finally { setBusy(false); } }}>
              {t('con_autoMonthly')}
            </Button>
          )}
          <ExportButton filename={t('con_tab_payments')} rows={list.data ?? []} columns={[{ header: t('number'), value: (o) => o.number }, { header: t('date'), value: (o) => o.date }, { header: t('navContracts'), value: (o) => num(o.contractId) }, { header: t('con_beneficiary'), value: (o) => o.beneficiary.name }, { header: t('amount'), value: (o) => o.amount, format: 'money', total: true }, { header: t('con_currency'), value: (o) => o.currency }, { header: t('con_basis'), value: (o) => t(tk('con_basis_', o.basis)) }, { header: t('status'), value: (o) => t(tk('con_po_', o.status)) }]} />
        </span>
      </div>
      <Card flush>
        <DataTable
          rows={list.data}
          loading={list.loading}
          rowKey={(o) => o.id}
          emptyText={t('con_noOrders')}
          onRowClick={(o) => navigate(`/contracts/payments/${o.id}`)}
          columns={[
            { header: t('number'), render: (o) => <><span className="doc-num">{o.number}</span>{o.auto && <div className="sub">{t('con_auto')}</div>}</> },
            { header: t('date'), render: (o) => formatDate(o.date) },
            { header: t('navContracts'), render: (o) => num(o.contractId) },
            { header: t('con_beneficiary'), render: (o) => <>{o.beneficiary.name}<div className="sub">{o.type === 'swift' ? `SWIFT ${o.beneficiary.swiftBic}` : `${o.beneficiary.account} · ${o.beneficiary.mfo}`}</div></> },
            { header: t('amount'), align: 'right', render: (o) => formatMoney(o.amount, o.currency) },
            { header: t('status'), render: (o) => <ToneBadge status={o.status === 'executed' ? 'executed_order' : o.status} label={t(tk('con_po_', o.status))} /> },
          ]}
        />
      </Card>
    </div>
  );
}

export function OrderFormModal({ contract, index, onClose }: { contract: Contract; index?: number; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const p = index !== undefined ? contract.payments[index] : undefined;
  const invoices = useApi(() => contractsApi.contractInvoices(contract.id), [contract.id]);
  const [amount, setAmount] = useState(p?.amount ?? 0);
  const [basis, setBasis] = useState<PaymentOrder['basis']>(p?.kind === 'advance' ? 'advance' : p?.kind === 'by_invoice' ? 'einvoice' : p?.kind === 'by_act' ? 'act' : 'schedule');
  const [einvoiceId, setEinvoiceId] = useState(p?.einvoiceId ?? '');
  const [purpose, setPurpose] = useState(`${t('con_purposePrefix')} ${contract.number} ${p ? `(${formatDate(p.dueDate)})` : ''}`.trim());
  const [error, setError] = useState('');
  const save = async (submit: boolean) => {
    try {
      const o = await contractsApi.createOrder({ contractId: contract.id, ...(index !== undefined ? { paymentIndex: index } : {}), amount, purpose, basis, ...(einvoiceId ? { einvoiceId } : {}), submit }, user);
      toast(`${o.number}: ${submit ? t('hist_submitted') : t('con_po_draft')}`);
      onClose();
      navigate(`/contracts/payments/${o.id}`);
    } catch (e) {
      setError(err(e));
    }
  };
  return (
    <Modal
      title={`${t('con_newOrder')}: ${contract.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={() => save(false)}>{t('saveDraft')}</Button>
          <Button type="primary" onClick={() => save(true)}>{t('submitForApproval')}</Button>
        </>
      }
    >
      <Field label={t('amount')} required hint={formatMoney(amount || 0, contract.currency)}>
        <Input type="number" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} ariaLabel={t('amount')} />
      </Field>
      <div className="form-grid">
        <Field label={t('con_basis')} required>
          <Select<PaymentOrder['basis']> value={basis} onChange={setBasis} options={(['schedule', 'advance', 'einvoice', 'act', 'manual'] as const).map((b) => ({ value: b, label: t(tk('con_basis_', b)) }))} ariaLabel={t('con_basis')} />
        </Field>
        <Field label={t('proc_einvoice')} required={basis === 'einvoice'}>
          <Select<string> value={einvoiceId} onChange={setEinvoiceId} placeholder="—" options={(invoices.data ?? []).filter((i) => i.direction === 'incoming').map((i) => ({ value: i.id, label: `${i.number} · ${formatDate(i.date)}` }))} ariaLabel={t('proc_einvoice')} />
        </Field>
      </div>
      <Field label={t('con_purpose')} required>
        <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} ariaLabel={t('con_purpose')} />
      </Field>
      <RouteSteps preview={{ entity: 'payment', context: { amount, currency: contract.currency, requesterId: user.id, kind: contract.kind, type: contract.kind === 'swift' ? 'swift' : 'domestic' } }} />
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

export function orderContent(o: PaymentOrder) {
  return { type: 'payment_order', number: o.number, date: o.date, amount: o.amount, currency: o.currency, purpose: o.purpose, beneficiary: o.beneficiary, payer: o.payerAccount };
}

export function PaymentOrderDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const stepUp = useStepUp();
  const toast = useToast();
  const err = useErr();
  const cc = useCostCenters();
  const o = useApi(() => contractsApi.getOrder(id), [id]);
  const contract = useApi(async () => (o.data ? api.getContract(o.data.contractId) : undefined), [o.data?.contractId]);
  const [sign, setSign] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = o.data;
  if (o.loading && !d) return <Card><Loading /></Card>;
  if (!d) return <Card><Empty text={t('empty')} /></Card>;
  const c = contract.data;
  const editor = can('contracts', 'edit');
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
  const printDoc = (): PrintDocument => ({
    entity: 'payment_order',
    entityId: d.id,
    title: d.type === 'swift' ? t('con_swiftTitle') : t('con_orderTitle'),
    number: d.number,
    date: d.date,
    fields: [
      { label: t('con_payerAccount'), value: d.payerAccount },
      { label: t('con_beneficiary'), value: `${d.beneficiary.name} (${t('tin')} ${d.beneficiary.tin})` },
      { label: d.type === 'swift' ? 'SWIFT/BIC · IBAN' : `${t('proc_account')} · ${t('proc_mfo')}`, value: d.type === 'swift' ? `${d.beneficiary.swiftBic} · ${d.beneficiary.iban}` : `${d.beneficiary.account} · ${d.beneficiary.mfo}` },
      { label: t('proc_bank'), value: d.beneficiary.bank },
      { label: t('amount'), value: formatMoney(d.amount, d.currency) },
      { label: t('con_purpose'), value: d.purpose },
      { label: t('navContracts'), value: c?.number ?? d.contractId },
      { label: t('proc_costCenter'), value: cc.label(d.costCenterKey) },
    ],
    signers: [{ role: t('con_signedBy'), name: user.fullName, ...(d.signatureId ? { signatureId: d.signatureId } : {}) }],
  });
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('navContracts'), to: '/contracts?tab=payments' }, { label: d.number }]}
        title={`${d.type === 'swift' ? t('con_swiftTitle') : t('con_orderTitle')} ${d.number}`}
        subtitle={c ? `${c.number} · ${c.subject}` : d.contractId}
        actions={
          <>
            <ToneBadge status={d.status === 'executed' ? 'executed_order' : d.status} label={t(tk('con_po_', d.status))} />
            <PrintButton doc={printDoc} />
            {d.status === 'draft' && d.createdBy === user.id && <Button type="primary" disabled={busy} onClick={() => run(() => contractsApi.submitOrder(d.id, user), t('hist_submitted'))}>{t('submitForApproval')}</Button>}
            {d.status === 'approved' && editor && <Button type="primary" icon="pen" onClick={() => setSign(true)}>{t('svc_sign')}</Button>}
            {['signed', 'failed'].includes(d.status) && editor && (
              <Button type="primary" disabled={busy} onClick={async () => { if (!(await stepUp(`${t('con_sendIabs')}: ${d.number} · ${formatMoney(d.amount, d.currency)}`))) return; await run(() => contractsApi.sendOrder(d.id, user), t('con_orderSent')); }}>
                {t('con_sendIabs')}
              </Button>
            )}
            {d.status === 'sent' && editor && <Button icon="refresh" disabled={busy} onClick={() => run(() => contractsApi.refreshOrder(d.id, user), t('con_orderRefreshed'))}>{t('con_refresh')}</Button>}
          </>
        }
      />
      <div className="grid grid-main">
        <div className="pc-stack">
          <Card title={t('details')}>
            <Kv
              items={[
                [t('navContracts'), c ? <Link to={`/contracts/${c.id}`}>{c.number}</Link> : d.contractId],
                [t('date'), formatDate(d.date)],
                [t('amount'), formatMoney(d.amount, d.currency)],
                [t('con_basis'), t(tk('con_basis_', d.basis))],
                [t('proc_einvoice'), d.einvoiceId ? <Link to={`/einvoices/${d.einvoiceId}`}>{d.einvoiceId}</Link> : '—'],
                [t('con_beneficiary'), `${d.beneficiary.name} · ${t('tin')} ${d.beneficiary.tin}`],
                [d.type === 'swift' ? 'SWIFT/BIC · IBAN' : `${t('proc_account')} · ${t('proc_mfo')}`, d.type === 'swift' ? `${d.beneficiary.swiftBic} · ${d.beneficiary.iban}` : `${d.beneficiary.account} · ${d.beneficiary.mfo}`],
                [t('con_purpose'), d.purpose],
                [t('proc_costCenter'), cc.label(d.costCenterKey)],
                [t('con_exchange'), d.exchangeId ? <GuardedLink to="/integrations">{d.exchangeId}</GuardedLink> : '—'],
              ]}
            />
          </Card>
          <PostingsCard docId={d.id} />
        </div>
        <div className="pc-stack">
          <Card title={t('route')}>
            <RouteSteps entityId={`${d.contractId}:${d.id}`} />
          </Card>
          <SignaturesPanel doc={{ entity: 'payment_order', entityId: d.id, title: d.number, content: orderContent(d) }} canSign={false} />
          <Card title={t('history')}>
            <Timeline events={d.history} />
          </Card>
        </div>
      </div>
      {sign && <SignModal doc={{ entity: 'payment_order', entityId: d.id, title: d.number, content: orderContent(d) }} onClose={() => setSign(false)} onSigned={(rec) => void contractsApi.recordOrderSignature(d.id, rec.id, user).then(() => toast(t('svc_signedOk'))).catch((e) => toast(err(e)))} />}
    </>
  );
}

export function PlatformView() {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const list = useApi(() => procApi.listPlatformContracts(), []);
  const [sign, setSign] = useState<PlatformContract | null>(null);
  const [reject, setReject] = useState<PlatformContract | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const editor = can('contracts', 'edit');
  return (
    <div className="pc-stack pc-pad">
      <div className="pc-row" style={{ justifyContent: 'space-between' }}>
        <span className="muted small">{t('con_platformHint')}</span>
        {editor && (
          <Button size="small" icon="download" disabled={busy} onClick={async () => { setBusy(true); try { await procApi.fetchPlatformContracts(user); toast(t('con_platformFetched')); } catch (e) { toast(err(e)); } finally { setBusy(false); } }}>
            {t('con_platformFetch')}
          </Button>
        )}
      </div>
      <Card flush>
        <DataTable
          rows={list.data}
          loading={list.loading}
          rowKey={(p) => p.id}
          columns={[
            { header: t('con_platform'), render: (p) => <>{t(tk('con_pf_', p.platform))}<div className="sub">{p.extId} · {t(tk('con_dir_', p.direction))}</div></> },
            { header: t('number'), render: (p) => <>{p.number}<div className="sub">{formatDate(p.date)}</div></> },
            { header: t('counterparty'), render: (p) => <>{p.counterpartyName}<div className="sub">{t('tin')} {p.counterpartyTin}</div></> },
            { header: t('subject'), render: (p) => p.subject },
            { header: t('amount'), align: 'right', render: (p) => formatMoney(p.amount) },
            { header: t('status'), render: (p) => <>{<ToneBadge status={p.status} label={t(tk('con_pcs_', p.status))} />}{p.rejectReason && <div className="sub">{p.rejectReason}</div>}</> },
            {
              header: '',
              render: (p) =>
                p.contractId ? (
                  <Link to={`/contracts/${p.contractId}`}>{t('proc_openContract')}</Link>
                ) : editor && p.status === 'incoming' ? (
                  <span className="pc-row">
                    <Button size="small" type="primary" icon="pen" onClick={() => setSign(p)}>{t('con_signAccept')}</Button>
                    <Button size="small" onClick={() => setReject(p)}>{t('con_reject')}</Button>
                  </span>
                ) : null,
            },
          ]}
        />
      </Card>
      {sign && (
        <SignModal
          doc={{ entity: 'platform_contract', entityId: sign.id, title: `${sign.extId} · ${sign.number}`, content: { extId: sign.extId, number: sign.number, tin: sign.counterpartyTin, amount: sign.amount, subject: sign.subject } }}
          onClose={() => setSign(null)}
          onSigned={(rec) => void procApi.signPlatformContract(sign.id, rec.id, user).then((c) => { toast(`${c.number}: ${t('cstatus_active')}`); navigate(`/contracts/${c.id}`); }).catch((e) => toast(err(e)))}
        />
      )}
      {reject && (
        <Modal
          title={`${t('con_reject')}: ${reject.extId}`}
          onClose={() => setReject(null)}
          footer={
            <>
              <Button onClick={() => setReject(null)}>{t('cancel')}</Button>
              <Button type="primary" danger onClick={async () => { try { await procApi.rejectPlatformContract(reject.id, reason, user); setReject(null); setReason(''); toast(t('con_rejected')); } catch (e) { toast(err(e)); } }}>{t('con_reject')}</Button>
            </>
          }
        >
          <Field label={t('proc_reason')} required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} ariaLabel={t('proc_reason')} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
