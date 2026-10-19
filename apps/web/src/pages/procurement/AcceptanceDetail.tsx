// Приёмка товаров (PR-PROC-058…069): акт приёмки, проверка спецификации, расхождения, претензии, сверка со
// счётом-фактурой, «Принял» (подразделение-заявитель или завсклад) → автоматическое оприходование на склад,
// проводки, МВЗ из заявки.
import { useEffect, useMemo, useState } from 'react';
import {
  api, contractsApi, formatDate, formatMoney, procApi, tk, warehouseApi,
  type AcceptanceLine, type Contract, type PrintDocument, type ProcAcceptance,
} from '@xb/shared';
import { Button, Card, Checkbox, DataTable, Empty, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Timeline, useToast } from '../../components/ui';
import { Attachments } from '../../components/Attachments';
import { PrintButton } from '../../components/PrintView';
import { SignaturesPanel } from '../../components/SignModal';
import { Link, navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Kv, ToneBadge, todayIso, plusDays, useCostCenters, useErr, useIsBuyer } from './shared';
import { PostingsCard } from './PostingsCard';
import { PostingsTable } from '../warehouse/wmsShared';

export function AcceptanceFormModal({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const draft = useApi(() => procApi.acceptanceDraft(contract.id), [contract.id]);
  const locations = useApi(() => warehouseApi.listLocations(), []);
  const invoices = useApi(() => contractsApi.contractInvoices(contract.id), [contract.id]);
  const [lines, setLines] = useState<AcceptanceLine[]>([]);
  const [warehouseId, setWarehouseId] = useState('wh1');
  const [date, setDate] = useState(todayIso());
  const [einvoiceId, setEinvoiceId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (draft.data && !lines.length) setLines(draft.data);
  }, [draft.data, lines.length]);
  const set = (i: number, patch: Partial<AcceptanceLine>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const disc = procApi.acceptanceDiscrepancies({ lines });
  return (
    <Modal
      title={`${t('proc_newAcceptance')}: ${contract.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            disabled={!lines.length}
            onClick={async () => {
              try {
                const a = await procApi.createAcceptance({ contractId: contract.id, warehouseId, date, lines, ...(einvoiceId ? { einvoiceId } : {}) }, user);
                toast(`${a.number}: ${t('proc_acc_draft')}`);
                onClose();
                navigate(`/procurement/acceptance/${a.id}`);
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
      {draft.loading && !draft.data ? (
        <Loading />
      ) : !lines.length ? (
        <Empty text={t('proc_nothingToAccept')} />
      ) : (
        <>
          <div className="form-grid">
            <Field label={t('proc_warehouse')} required>
              <Select<string> value={warehouseId} onChange={setWarehouseId} options={(locations.data ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} ariaLabel={t('proc_warehouse')} />
            </Field>
            <Field label={t('date')} required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} ariaLabel={t('date')} />
            </Field>
            <Field label={t('proc_einvoice')} className="span-2">
              <Select<string> value={einvoiceId} onChange={setEinvoiceId} placeholder="—" options={(invoices.data ?? []).filter((i) => i.direction === 'incoming').map((i) => ({ value: i.id, label: `${i.number} · ${formatDate(i.date)}` }))} ariaLabel={t('proc_einvoice')} />
            </Field>
          </div>
          <div className="table-wrap">
            <table className="table pc-mini-table">
              <thead>
                <tr>
                  <th>{t('itemName')}</th>
                  <th className="right">{t('proc_ordered')}</th>
                  <th>{t('proc_delivered')}</th>
                  <th>{t('proc_accepted')}</th>
                  <th>{t('proc_specOk')}</th>
                  <th>{t('proc_quality')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.name}<div className="sub">{formatMoney(l.unitPrice)} / {l.unit}</div></td>
                    <td className="right num">{l.orderedQty}</td>
                    <td><Input type="number" value={l.deliveredQty} onChange={(e) => set(i, { deliveredQty: Number(e.target.value) })} ariaLabel={t('proc_delivered')} style={{ width: 80 }} /></td>
                    <td><Input type="number" value={l.acceptedQty} onChange={(e) => set(i, { acceptedQty: Number(e.target.value) })} ariaLabel={t('proc_accepted')} style={{ width: 80 }} /></td>
                    <td><Checkbox checked={l.specOk} onChange={(v) => set(i, { specOk: v })} /></td>
                    <td><Select<'ok' | 'defect'> value={l.quality} onChange={(v) => set(i, { quality: v })} options={[{ value: 'ok', label: t('proc_q_ok') }, { value: 'defect', label: t('proc_q_defect') }]} ariaLabel={t('proc_quality')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {disc.length > 0 && <div className="pc-warn">{t('proc_discrepancies')}: {disc.map((d) => `${lines[d.line]?.name}: ${t(tk('proc_claim_', d.type))} (${d.detail})`).join('; ')}</div>}
        </>
      )}
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

export function acceptanceContent(a: ProcAcceptance) {
  return { type: 'acceptance', number: a.number, contract: a.contractId, date: a.date, lines: a.lines.map((l) => ({ name: l.name, delivered: l.deliveredQty, accepted: l.acceptedQty, price: l.unitPrice, specOk: l.specOk, quality: l.quality })) };
}

export function AcceptanceDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const cc = useCostCenters();
  const a = useApi(() => procApi.getAcceptance(id), [id]);
  const contract = useApi(async () => (a.data ? api.getContract(a.data.contractId) : undefined), [a.data?.contractId]);
  const request = useApi(async () => (a.data?.requestId ? api.getProcurement(a.data.requestId) : undefined), [a.data?.requestId]);
  const match = useApi(() => procApi.einvoiceMatch(id), [id, a.data?.einvoiceId]);
  const [claim, setClaim] = useState(false);
  const [busy, setBusy] = useState(false);
  const isBuyer = useIsBuyer();
  const doc = a.data;
  const content = useMemo(() => (doc ? acceptanceContent(doc) : null), [doc]);
  if (a.loading && !doc) return <Card><Loading /></Card>;
  if (!doc || !content) return <Card><Empty text={t('empty')} /></Card>;
  const c = contract.data;
  const disc = procApi.acceptanceDiscrepancies(doc);
  const value = doc.lines.reduce((s, l) => s + l.acceptedQty * l.unitPrice, 0);
  const req = request.data;
  const canAccept = doc.status === 'draft' && (user.role === 'admin' || user.role === 'storekeeper' || !!user.extraRoles?.includes('storekeeper') || (!!req && (req.initiatorId === user.id || req.departmentId === user.departmentId)));
  const editor = isBuyer || can('contracts', 'edit') || can('warehouse', 'edit');
  const printDoc = (): PrintDocument => ({
    entity: 'acceptance',
    entityId: doc.id,
    title: t('proc_accActTitle'),
    number: doc.number,
    date: doc.date,
    place: t('svc_demoPlace'),
    fields: [
      { label: t('navContracts'), value: c ? `${c.number} — ${c.subject}` : doc.contractId },
      { label: t('counterparty'), value: c ? lk.counterparty(c.counterpartyId)?.name ?? '' : '' },
      { label: t('proc_warehouse'), value: doc.warehouseId },
      { label: t('proc_costCenter'), value: cc.label(doc.costCenterKey) },
    ],
    table: {
      columns: [{ header: '№', align: 'center', width: '6%' }, { header: t('itemName') }, { header: t('proc_delivered'), align: 'right' }, { header: t('proc_accepted'), align: 'right' }, { header: t('unitPrice'), align: 'right' }, { header: t('amount'), align: 'right' }],
      rows: doc.lines.map((l, i) => [String(i + 1), `${l.name}${!l.specOk ? ` (${t('proc_specMismatch')})` : ''}${l.quality === 'defect' ? ` (${t('proc_q_defect')})` : ''}`, `${l.deliveredQty} ${l.unit}`, `${l.acceptedQty} ${l.unit}`, formatMoney(l.unitPrice), formatMoney(l.acceptedQty * l.unitPrice)]),
      totals: ['', t('total'), '', '', '', formatMoney(value)],
    },
    signers: [
      { role: t('proc_supplier'), name: c ? lk.counterparty(c.counterpartyId)?.name ?? '' : '' },
      { role: t('proc_acceptedBy'), name: doc.acceptedBy ? lk.user(doc.acceptedBy)?.fullName ?? '' : '' },
    ],
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('navProcurement'), to: '/procurement?tab=acceptance' }, { label: doc.number }]}
        title={`${t('proc_newAcceptance')} ${doc.number}`}
        subtitle={c ? `${c.number} · ${c.subject}` : doc.contractId}
        actions={
          <>
            <ToneBadge status={doc.status} label={t(tk('proc_acc_', doc.status))} />
            <PrintButton doc={printDoc} template="act" />
            {(isBuyer || can('contracts', 'edit')) && disc.length > 0 && <Button onClick={() => setClaim(true)}>{t('proc_newClaim')}</Button>}
            {canAccept && (
              <Button
                type="primary"
                icon="check"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await procApi.confirmAcceptance(doc.id, user);
                    toast(t('proc_acceptedToast'));
                  } catch (e) {
                    toast(`${t('actionFailed')}: ${err(e)}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('proc_btnAccepted')}
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-main">
        <div className="pc-stack">
          <Card title={t('details')}>
            <Kv
              items={[
                [t('navContracts'), c ? <Link to={`/contracts/${c.id}`}>{c.number}</Link> : doc.contractId],
                [t('counterparty'), c ? lk.counterparty(c.counterpartyId)?.name : '—'],
                [t('basedOnRequest'), req ? <Link to={`/procurement/${req.id}`}>{req.number}</Link> : '—'],
                [t('date'), formatDate(doc.date)],
                [t('proc_warehouse'), doc.warehouseId],
                [t('proc_costCenter'), cc.label(doc.costCenterKey)],
                [t('proc_acceptedBy'), doc.acceptedBy ? `${lk.user(doc.acceptedBy)?.fullName} · ${formatDate(doc.acceptedAt ?? '')}` : '—'],
                [t('amount'), formatMoney(value)],
              ]}
            />
          </Card>
          <Card title={t('items')} flush>
            <DataTable
              rows={doc.lines}
              rowKey={(l) => l.name}
              columns={[
                { header: t('itemName'), render: (l) => <>{l.name}{l.note && <div className="sub">{l.note}</div>}</> },
                { header: t('proc_ordered'), align: 'right', render: (l) => l.orderedQty },
                { header: t('proc_delivered'), align: 'right', render: (l) => l.deliveredQty },
                { header: t('proc_accepted'), align: 'right', render: (l) => l.acceptedQty },
                { header: t('proc_specOk'), render: (l) => <ToneBadge status={l.specOk ? 'approved' : 'rejected'} label={l.specOk ? t('proc_yes') : t('proc_no')} /> },
                { header: t('proc_quality'), render: (l) => <ToneBadge status={l.quality === 'ok' ? 'approved' : 'rejected'} label={t(tk('proc_q_', l.quality))} /> },
                { header: t('amount'), align: 'right', render: (l) => formatMoney(l.acceptedQty * l.unitPrice) },
              ]}
            />
          </Card>
          <Card title={t('proc_discrepancies')}>
            {!disc.length ? <p className="muted" style={{ margin: 0 }}>{t('proc_noDiscrepancies')}</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {disc.map((d, i) => <li key={i}>{doc.lines[d.line]?.name}: {t(tk('proc_claim_', d.type))} ({d.detail})</li>)}
              </ul>
            )}
          </Card>
          <Card title={t('proc_einvoiceCheck')}>
            {!doc.einvoiceId ? (
              <>
                <p className="muted" style={{ margin: 0 }}>{t('proc_noEinvoice')}</p>
                {/* ЭСФ поставщика может прийти позже акта — привязка до оприходования (PR-PROC-063) */}
                {editor && doc.status === 'draft' && c && <LinkInvoice acceptanceId={doc.id} contractId={c.id} />}
              </>
            ) : match.data ? (
              <Kv items={[[t('proc_einvoice'), <Link to={`/einvoices/${doc.einvoiceId}`}>{match.data.number}</Link>], [t('proc_einvoiceNet'), formatMoney(match.data.net)], [t('proc_acceptedValue'), formatMoney(match.data.value)], [t('proc_diff'), <ToneBadge status={match.data.ok ? 'approved' : 'rejected'} label={match.data.ok ? t('proc_matchOk') : formatMoney(match.data.diff)} />]]} />
            ) : <Loading />}
          </Card>
          {/* Проводки оприходования ведёт модуль «Склад» по приходному ордеру; здесь — зачёт аванса и прочие проводки закупок */}
          {doc.receiptId && <PostingsTable docId={doc.receiptId} title={`${t('proc_postings')} · ${t('proc_whReceipt')}`} />}
          <PostingsCard docId={doc.id} hideEmpty={!!doc.receiptId} />
        </div>
        <div className="pc-stack">
          {doc.status !== 'draft' && <div className="pc-note">{t('proc_autoReceiptNote')} <Link to={doc.receiptId ? `/warehouse/receipts/${doc.receiptId}` : '/warehouse'}>{doc.receiptId ? t('proc_whReceipt') : t('proc_openWarehouse')}</Link></div>}
          <SignaturesPanel doc={{ entity: 'acceptance', entityId: doc.id, title: `${t('proc_newAcceptance')} ${doc.number}`, content }} canSign={editor || canAccept} />
          <Attachments entity="acceptance" entityId={doc.id} title={t('proc_waybillScans')} />
          <Card title={t('history')}>
            <Timeline events={doc.history} />
          </Card>
        </div>
      </div>
      {claim && c && <ClaimModal contract={c} acceptance={doc} amount={doc.lines.reduce((s, l) => s + (l.orderedQty - l.acceptedQty) * l.unitPrice, 0)} type={disc[0]?.type ?? 'shortage'} onClose={() => setClaim(false)} />}
    </>
  );
}

function LinkInvoice({ acceptanceId, contractId }: { acceptanceId: string; contractId: string }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const invoices = useApi(() => contractsApi.contractInvoices(contractId), [contractId]);
  const [id, setId] = useState('');
  const options = (invoices.data ?? []).filter((i) => i.direction === 'incoming').map((i) => ({ value: i.id, label: `${i.number} · ${formatDate(i.date)}` }));
  if (!options.length) return null;
  return (
    <div className="pc-row" style={{ marginTop: 8 }}>
      <Select<string> value={id} onChange={setId} placeholder="—" options={options} ariaLabel={t('proc_einvoice')} />
      <Button size="small" disabled={!id} onClick={async () => { try { await procApi.linkAcceptanceInvoice(acceptanceId, id, user); toast(t('saved')); } catch (e) { toast(err(e)); } }}>{t('proc_linkEinvoice')}</Button>
    </div>
  );
}

export function ClaimModal({ contract, acceptance, actId, amount, type, onClose }: { contract: Contract; acceptance?: ProcAcceptance; actId?: string; amount: number; type: 'shortage' | 'quality' | 'spec' | 'delay' | 'defect'; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const [kind, setKind] = useState(type);
  const [description, setDescription] = useState('');
  const [sum, setSum] = useState(Math.max(0, Math.round(amount)));
  const [due, setDue] = useState(plusDays(10));
  const [error, setError] = useState('');
  return (
    <Modal
      title={`${t('proc_newClaim')}: ${contract.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            onClick={async () => {
              try {
                const cl = await procApi.createClaim({ contractId: contract.id, ...(acceptance ? { acceptanceId: acceptance.id } : {}), ...(actId ? { actId } : {}), type: kind, description, amount: sum, dueDate: due }, user);
                toast(`${cl.number}: ${t('proc_cls_open')}`);
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
      <Field label={t('proc_claimType')} required>
        <Select<typeof kind> value={kind} onChange={setKind} options={(['shortage', 'quality', 'spec', 'delay', 'defect'] as const).map((k) => ({ value: k, label: t(tk('proc_claim_', k)) }))} ariaLabel={t('proc_claimType')} />
      </Field>
      <Field label={t('description')} required>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} ariaLabel={t('description')} />
      </Field>
      <div className="form-grid">
        <Field label={t('amount')} required>
          <Input type="number" value={sum} onChange={(e) => setSum(Number(e.target.value))} ariaLabel={t('amount')} />
        </Field>
        <Field label={t('deadline')} required>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} ariaLabel={t('deadline')} />
        </Field>
      </div>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}
