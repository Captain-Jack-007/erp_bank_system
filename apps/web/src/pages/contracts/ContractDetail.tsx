// Карточка договора (ТЗ 4.2.2): вид, инициаторы, МВЗ, текст по шаблону, редактируемый график платежей,
// этапы и обязательства по приёмке, санкции, расчёты (дебиторка/кредиторка), резерв, ЭСФ, приёмка и акты,
// платёжные поручения, электронный договор (Didox), подпись E-IMZO, печать с QR, вложения, история.
import { useMemo, useState, type ReactNode } from 'react';
import {
  api, contractsApi, formatDate, formatMoney, procApi, signatureService, supplierAdmission, today, tk,
  type Contract, type ContractPayment, type ContractStage, type PrintDocument,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Empty, Field, Input, Loading, Modal, PageHeader, Progress, RouteSteps, Select, StatusBadge, Textarea, Timeline, useToast } from '../../components/ui';
import { Attachments } from '../../components/Attachments';
import { PrintButton } from '../../components/PrintView';
import { SignaturesPanel } from '../../components/SignModal';
import { FieldHistory } from '../../components/FieldHistory';
import { Link, navigate } from '../../lib/router';
import { useCan, useStepUp } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Kv, ToneBadge, useCostCenters, useErr } from '../procurement/shared';
import { PostingsCard } from '../procurement/PostingsCard';
import { AcceptanceFormModal } from '../procurement/AcceptanceDetail';
import { ActFormModal } from '../procurement/ActDetail';
import { OrderFormModal } from './PaymentsViews';

export function contractContent(c: Contract) {
  return { type: 'contract', number: c.number, subject: c.subject, counterparty: c.counterpartyId, amount: c.amount, currency: c.currency, start: c.startDate.slice(0, 10), end: c.endDate.slice(0, 10), kind: c.kind ?? 'services', payments: c.payments.map((p) => ({ due: p.dueDate, amount: p.amount })), text: c.text ?? '' };
}

export function ContractDetailPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const cc = useCostCenters();
  const stepUp = useStepUp(); // оплата — операция высокого риска: повторный ввод одноразового кода (P1-ORG)
  const doc = useApi(() => api.getContract(id), [id]);
  const request = useApi(async () => (doc.data?.requestId ? api.getProcurement(doc.data.requestId) : undefined), [doc.data?.requestId]);
  const orders = useApi(() => contractsApi.listOrders({ contractId: id }), [id]);
  const acceptances = useApi(() => procApi.listAcceptances({ contractId: id }), [id]);
  const acts = useApi(() => procApi.listActs({ contractId: id }), [id]);
  const invoices = useApi(() => contractsApi.contractInvoices(id), [id]);
  const tpls = useApi(() => contractsApi.listTemplates(), []);
  const sigs = useApi(() => signatureService.list('contract', id), [id]);
  const [modal, setModal] = useState<null | 'schedule' | 'stages' | 'initiators' | 'acceptance' | 'act' | 'receipt' | 'invoice' | { order: number | undefined }>(null);
  const [busy, setBusy] = useState(false);
  const c = doc.data;
  const content = useMemo(() => (c ? contractContent(c) : null), [c]);
  if (doc.loading && !c) return <Card><Loading /></Card>;
  if (!c || !content) return <Card><Empty text={t('empty')} /></Card>;

  const cp = lk.counterparty(c.counterpartyId);
  const paid = c.payments.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0);
  const paidPct = Math.round((paid / c.amount) * 100);
  const canPay = c.status === 'active' && ['finance', 'treasury', 'accountant', 'admin'].includes(user.role) && can('contracts', 'edit');
  const editor = can('contracts', 'edit');
  const bal = contractsApi.contractBalance(c);
  const openOrder = (i: number) => orders.data?.find((o) => o.paymentIndex === i && !['rejected', 'failed'].includes(o.status));
  const goods = c.kind === 'fixed_assets';
  const supply = !['bank_services', 'other_receivables', 'swift'].includes(c.kind ?? 'services');
  const admission = c.kind !== 'bank_services' ? supplierAdmission(c.counterpartyId) : undefined;
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
    entity: 'contract',
    entityId: c.id,
    title: t('con_printTitle'),
    number: c.number,
    date: c.startDate.slice(0, 10),
    fields: [
      { label: t('subject'), value: c.subject },
      { label: t('con_kind'), value: `${t(tk('con_kind_', c.kind ?? 'services'))}${c.subkind ? ` · ${t(tk('con_sub_', c.subkind))}` : ''}` },
      { label: t('counterparty'), value: `${cp?.name ?? '—'} (${t('tin')} ${cp?.tin ?? '—'})` },
      { label: t('con_initiator'), value: lk.department(c.departmentId) ? loc(lk.department(c.departmentId)!.name) : '' },
      { label: t('proc_costCenter'), value: cc.label(c.costCenterKey) },
      { label: t('amount'), value: formatMoney(c.amount, c.currency) },
      { label: t('period'), value: `${formatDate(c.startDate)} – ${formatDate(c.endDate)}` },
      { label: t('con_terms'), value: c.paymentTerms ? t(tk('con_terms_', c.paymentTerms.type)) : '—' },
    ],
    ...(c.text ? { paragraphs: c.text.split('\n').filter(Boolean) } : {}),
    table: {
      columns: [{ header: '№', align: 'center', width: '8%' }, { header: t('date') }, { header: t('con_payKind') }, { header: t('amount'), align: 'right' }, { header: t('status'), align: 'center' }],
      rows: c.payments.map((p, i) => [String(i + 1), formatDate(p.dueDate), t(tk('con_pk_', p.kind ?? 'final')), formatMoney(p.amount, c.currency), p.paid ? t('paid') : t('unpaid')]),
      totals: ['', t('total'), '', formatMoney(c.payments.reduce((s, p) => s + p.amount, 0), c.currency), ''],
    },
    signers: [
      { role: t('proc_customer'), name: sigs.data?.[0]?.owner ?? user.fullName, ...(sigs.data?.[0] ? { signatureId: sigs.data[0].id } : {}) },
      { role: c.kind === 'bank_services' ? t('con_buyer') : t('proc_contractor'), name: cp?.name ?? '' },
    ],
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('navContracts'), to: '/contracts' }, { label: c.number }]}
        title={c.subject}
        subtitle={c.number}
        actions={
          <>
            <StatusBadge prefix="cstatus_" status={c.status} />
            <PrintButton doc={printDoc} />
            {c.status === 'draft' && ['procurement', 'legal', 'admin'].includes(user.role) && (
              <Button type="primary" disabled={busy} onClick={() => run(() => api.submitContract(c.id, user), `${c.number}: ${t('hist_submitted')}`)}>
                {t('submitForApproval')}
              </Button>
            )}
            {editor && !c.platform && ['active', 'pending'].includes(c.status) && cp?.type !== 'foreign' && (
              <Button disabled={busy} onClick={() => run(() => procApi.sendContractToPlatform(c.id, user), t('con_sentDidox'))}>{t('con_sendDidox')}</Button>
            )}
            {editor && c.platform?.status === 'sent' && c.platform.extId && (
              <Button disabled={busy} icon="refresh" onClick={() => run(() => procApi.syncPlatformContract(c.id, user), t('con_didoxSynced'))}>{t('con_syncDidox')}</Button>
            )}
            {editor && c.status === 'active' && supply && goods && <Button onClick={() => setModal('acceptance')}>{t('proc_newAcceptance')}</Button>}
            {editor && c.status === 'active' && supply && !goods && <Button onClick={() => setModal('act')}>{t('proc_newAct')}</Button>}
            {editor && c.status === 'active' && c.kind === 'bank_services' && (
              <>
                <Button onClick={() => setModal('invoice')}>{t('con_issueInvoice')}</Button>
                <Button onClick={() => setModal('receipt')}>{t('con_registerReceipt')}</Button>
              </>
            )}
          </>
        }
      />

      {admission && !admission.allowed && <div className="pc-danger">{t('proc_supplierNotAllowed')}: {admission.reasons.map((r) => t(tk('proc_list_', r))).join(', ')}</div>}

      <div className="grid grid-main">
        <div className="pc-stack">
          <Card title={t('details')} actions={<Link to={`/procurement/suppliers/${c.counterpartyId}`}>{t('con_supplierCard')}</Link>}>
            <Kv
              items={[
                ...(request.data ? [[t('basedOnRequest'), <Link to={`/procurement/${request.data.id}`}>{request.data.number} · {request.data.title}</Link>] as [string, ReactNode]] : []),
                [t('con_kind'), `${t(tk('con_kind_', c.kind ?? 'services'))}${c.subkind ? ` · ${t(tk('con_sub_', c.subkind))}` : ''}`],
                [c.kind === 'bank_services' ? t('con_buyer') : t('counterparty'), cp?.name],
                [t('tin'), <span className="num">{cp?.tin}</span>],
                [t('proc_requisites'), cp ? `${cp.bankAccount ?? cp.iban ?? '—'} · ${cp.mfo ?? cp.swiftBic ?? '—'} · ${cp.bankName ?? ''}` : '—'],
                [t('department'), lk.department(c.departmentId) ? loc(lk.department(c.departmentId)!.name) : '—'],
                [t('con_extraInitiators'), (c.initiatorDeptIds ?? []).filter((d) => d !== c.departmentId).map((d) => lk.department(d)?.code ?? d).join(', ') || '—'],
                [t('proc_costCenter'), cc.label(c.costCenterKey)],
                [t('amount'), <span className="num">{formatMoney(c.amount, c.currency)}</span>],
                [t('period'), <span className="num">{formatDate(c.startDate)} — {formatDate(c.endDate)}</span>],
                [t('con_terms'), c.paymentTerms ? `${t(tk('con_terms_', c.paymentTerms.type))}${c.paymentTerms.advancePct ? ` · ${c.paymentTerms.advancePct}%` : ''}${c.paymentTerms.periodicity ? ` · ${t(tk('con_', c.paymentTerms.periodicity))}` : ''}` : '—'],
                [t('con_source'), c.source ? t(tk('con_src_', c.source)) : '—'],
                [t('con_penalty'), c.penalty ? `${c.penalty.ratePerDay}% / ${t('proc_days')} · max ${c.penalty.capPct}%` : '—'],
                ...(c.objectInfo ? [[t('con_objectInfo'), c.objectInfo] as [string, ReactNode]] : []),
                ...(c.invoiceRef ? [[t('con_invoiceNo'), `${c.invoiceRef.number} · ${formatDate(c.invoiceRef.date)}`] as [string, ReactNode]] : []),
                ...(c.platform ? [[t('con_platform'), `${t(tk('con_pf_', c.platform.name))} · ${c.platform.extId || '—'} · ${t(tk('con_pcs_', c.platform.status))}`] as [string, ReactNode]] : []),
              ]}
            />
            {editor && (
              <div className="pc-row" style={{ marginTop: 10 }}>
                <Button size="small" onClick={() => setModal('initiators')}>{t('con_editInitiators')}</Button>
              </div>
            )}
          </Card>

          <Card title={t('payments')} actions={editor && !['expired', 'terminated'].includes(c.status) ? <Button size="small" icon="pen" onClick={() => setModal('schedule')}>{t('con_editSchedule')}</Button> : undefined} flush>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>{t('paidTotal')}</span>
                <span className="num" style={{ fontWeight: 600 }}>{formatMoney(paid, c.currency)} · {paidPct}%</span>
              </div>
              <Progress pct={paidPct} />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('date')}</th>
                    <th>{t('con_payKind')}</th>
                    <th className="right">{t('amount')}</th>
                    <th>{t('status')}</th>
                    {(canPay || editor) && <th />}
                  </tr>
                </thead>
                <tbody>
                  {c.payments.map((p, i) => {
                    const o = openOrder(i) ?? (p.orderId ? orders.data?.find((x) => x.id === p.orderId) : undefined);
                    return (
                      <tr key={i}>
                        <td className="num">{formatDate(p.dueDate)}</td>
                        <td className="muted small">{t(tk('con_pk_', p.kind ?? 'final'))}{p.note === 'manual' ? ` · ${t('con_manualMark')}` : ''}</td>
                        <td className="right num">{formatMoney(p.amount, c.currency)}</td>
                        <td>
                          {p.paid ? <Badge tone="ok">{t('paid')}</Badge> : p.dueDate.slice(0, 10) < today() ? <Badge tone="danger">{t('overdue')}</Badge> : <Badge tone="muted">{t('unpaid')}</Badge>}
                          {o && <div className="sub"><Link to={`/contracts/payments/${o.id}`}>{o.number}</Link> · {t(tk('con_po_', o.status))}</div>}
                        </td>
                        {(canPay || editor) && (
                          <td className="right">
                            {!p.paid && c.status === 'active' && (
                              <span className="pc-row" style={{ justifyContent: 'flex-end' }}>
                                {editor && !o && c.kind !== 'bank_services' && <Button size="small" onClick={() => setModal({ order: i })}>{t('con_newOrder')}</Button>}
                                {canPay && !o && (
                                  <button
                                    className="btn btn-sm"
                                    onClick={async () => {
                                      if (!(await stepUp(`${t('markPaid')}: ${c.number} · ${formatMoney(p.amount, c.currency)}`))) return;
                                      try {
                                        await api.markPaymentPaid(c.id, i, user);
                                        toast(`${c.number}: ${t('paid')} ${formatMoney(p.amount, c.currency)}`);
                                      } catch (e) {
                                        toast(`${t('actionFailed')}: ${err(e)}`);
                                      }
                                    }}
                                  >
                                    {t('markPaid')}
                                  </button>
                                )}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t('con_stagesObligations')} actions={editor ? <Button size="small" icon="pen" onClick={() => setModal('stages')}>{t('con_editStages')}</Button> : undefined} flush>
            <DataTable
              rows={c.stages ?? []}
              rowKey={(s) => s.id}
              emptyText={t('con_noStages')}
              columns={[
                { header: t('con_stage'), render: (s) => <>{s.name}<div className="sub">{t(tk('con_obl_', s.obligation))}{s.docRef ? ` · ${s.docRef}` : ''}</div></> },
                { header: t('deadline'), render: (s) => formatDate(s.dueDate) },
                { header: t('amount'), align: 'right', render: (s) => (s.amount ? formatMoney(s.amount, c.currency) : '—') },
                { header: t('status'), render: (s) => { const pen = contractsApi.penaltyFor(c, s); return s.status === 'done' ? <ToneBadge status="done" label={`${t('con_stg_done')} ${s.doneAt ? formatDate(s.doneAt) : ''}`} /> : pen.days ? <ToneBadge status="overdue" label={`${t('overdue')} ${pen.days} ${t('proc_days')}`} /> : <ToneBadge status="planned" label={t('con_stg_planned')} />; } },
                { header: t('con_penalty'), align: 'right', render: (s) => { const pen = contractsApi.penaltyFor(c, s); return pen.amount ? formatMoney(pen.amount, c.currency) : '—'; } },
                {
                  header: '',
                  render: (s) =>
                    editor && s.status === 'planned' ? (
                      <span className="pc-row">
                        <Button size="small" onClick={() => run(() => contractsApi.completeStage(c.id, s.id, '', user), t('con_stageDone'))}>{t('con_completeStage')}</Button>
                        {contractsApi.penaltyFor(c, s).amount > 0 && !(c.sanctions ?? []).some((x) => x.stageId === s.id && x.status !== 'waived') && (
                          <Button size="small" onClick={() => run(() => contractsApi.applySanction(c.id, s.id, user), t('con_sanctionApplied'))}>{t('con_applySanction')}</Button>
                        )}
                      </span>
                    ) : null,
                },
              ]}
            />
          </Card>

          {(c.sanctions ?? []).length > 0 && (
            <Card title={t('con_sanctions')} flush>
              <DataTable
                rows={c.sanctions ?? []}
                rowKey={(s) => s.id}
                columns={[
                  { header: t('date'), render: (s) => formatDate(s.at) },
                  { header: t('con_overdueDays'), align: 'right', render: (s) => s.days },
                  { header: t('con_base'), align: 'right', render: (s) => formatMoney(s.base, c.currency) },
                  { header: t('con_penalty'), align: 'right', render: (s) => formatMoney(s.amount, c.currency) },
                  { header: t('status'), render: (s) => <ToneBadge status={s.status === 'paid' ? 'paid' : s.status === 'waived' ? 'draft' : 'pending'} label={t(tk('con_sn_', s.status))} /> },
                  { header: '', render: (s) => (editor && s.status === 'claimed' ? <span className="pc-row"><Button size="small" onClick={() => run(() => contractsApi.updateSanction(c.id, s.id, 'paid', user), t('saved'))}>{t('con_snPaid')}</Button><Button size="small" onClick={() => run(() => contractsApi.updateSanction(c.id, s.id, 'waived', user), t('saved'))}>{t('con_snWaive')}</Button></span> : null) },
                ]}
              />
            </Card>
          )}

          {(goods || (acceptances.data?.length ?? 0) > 0) && (
            <Card title={t('proc_acceptances')} flush>
              <DataTable rows={acceptances.data} rowKey={(a) => a.id} emptyText={t('proc_noAccYet')} onRowClick={(a) => navigate(`/procurement/acceptance/${a.id}`)} columns={[{ header: t('number'), render: (a) => a.number }, { header: t('date'), render: (a) => formatDate(a.date) }, { header: t('amount'), align: 'right', render: (a) => formatMoney(a.lines.reduce((s, l) => s + l.acceptedQty * l.unitPrice, 0)) }, { header: t('status'), render: (a) => <ToneBadge status={a.status} label={t(tk('proc_acc_', a.status))} /> }]} />
            </Card>
          )}
          {(!goods && supply) || (acts.data?.length ?? 0) > 0 ? (
            <Card title={t('proc_acts')} flush>
              <DataTable rows={acts.data} rowKey={(a) => a.id} emptyText={t('proc_noActsYet')} onRowClick={(a) => navigate(`/procurement/acts/${a.id}`)} columns={[{ header: t('number'), render: (a) => a.number }, { header: t('period'), render: (a) => `${formatDate(a.periodFrom)} — ${formatDate(a.periodTo)}` }, { header: t('amount'), align: 'right', render: (a) => formatMoney(procApi.actTotals(a).total) }, { header: t('status'), render: (a) => <ToneBadge status={a.status} label={t(tk('proc_act_', a.status))} /> }]} />
            </Card>
          ) : null}

          <Card title={t('con_einvoices')} flush>
            <DataTable
              rows={invoices.data}
              rowKey={(i) => i.id}
              emptyText={t('con_noEinvoices')}
              onRowClick={(i) => navigate(`/einvoices/${i.id}`)}
              columns={[
                { header: t('number'), render: (i) => i.number },
                { header: t('date'), render: (i) => formatDate(i.date) },
                { header: t('con_direction'), render: (i) => t(tk('con_dir_', i.direction === 'incoming' ? 'in' : 'out')) },
                { header: t('amount'), align: 'right', render: (i) => formatMoney(Math.round(i.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * (1 + i.vatRate / 100))) },
                { header: t('status'), render: (i) => <StatusBadge prefix="einvoices_status_" status={i.status} /> },
              ]}
            />
          </Card>

          {c.kind === 'bank_services' && (
            <Card title={t('con_receipts')}>
              {!(c.receipts ?? []).length ? <p className="muted" style={{ margin: 0 }}>{t('con_noReceipts')}</p> : (c.receipts ?? []).map((r, i) => <div key={i} className="pc-row" style={{ justifyContent: 'space-between' }}><span>{formatDate(r.at)}</span><b className="num">{formatMoney(r.amount, c.currency)}</b></div>)}
            </Card>
          )}

          <ContractText c={c} templates={tpls.data ?? []} editor={editor} />
          <PostingsCard contractId={c.id} />
        </div>

        <div className="pc-stack">
          <Card title={t('route')}>
            <RouteSteps entityId={id} />
          </Card>
          <Card title={t('con_balance')}>
            <Kv
              items={[
                [t('con_accepted'), formatMoney(bal.accepted, c.currency)],
                [t('paidTotal'), formatMoney(bal.paid, c.currency)],
                [t('con_receivable'), formatMoney(bal.receivable, c.currency)],
                [t('con_payable'), formatMoney(bal.payable, c.currency)],
                [t('status'), bal.closed ? t('con_debtClosed') : t('con_debtOpen')],
                ...(c.reserve ? [[t('con_reserve'), `${formatMoney(c.reserve.amount)} · ${t(tk('con_cls_', c.reserve.classification))} (${c.reserve.pct}%)`] as [string, ReactNode]] : []),
              ]}
            />
          </Card>
          <SignaturesPanel doc={{ entity: 'contract', entityId: c.id, title: `${c.number} · ${c.subject}`, content }} canSign={editor || can('contracts', 'approve')} onSigned={(rec) => void contractsApi.recordSignature(c.id, rec.id, user).catch(() => undefined)} />
          <Attachments entity="contract" entityId={c.id} />
          <Card title={t('history')}>
            <Timeline events={c.history} />
          </Card>
          <Card title={t('proc_fieldHistory')}>
            <FieldHistory entity="contract" entityId={c.id} />
          </Card>
        </div>
      </div>

      {modal === 'schedule' && <ScheduleModal c={c} onClose={() => setModal(null)} />}
      {modal === 'stages' && <StagesModal c={c} onClose={() => setModal(null)} />}
      {modal === 'initiators' && <InitiatorsModal c={c} onClose={() => setModal(null)} />}
      {modal === 'acceptance' && <AcceptanceFormModal contract={c} onClose={() => setModal(null)} />}
      {modal === 'act' && <ActFormModal contract={c} onClose={() => setModal(null)} />}
      {(modal === 'receipt' || modal === 'invoice') && <AmountModal title={t(modal === 'receipt' ? 'con_registerReceipt' : 'con_issueInvoice')} initial={c.amount - (c.receipts ?? []).reduce((s, r) => s + r.amount, 0)} onClose={() => setModal(null)} onSave={(v) => (modal === 'receipt' ? contractsApi.registerReceipt(c.id, v, user) : contractsApi.issueInvoice(c.id, v, user))} />}
      {modal && typeof modal === 'object' && 'order' in modal && <OrderFormModal contract={c} {...(modal.order !== undefined ? { index: modal.order } : {})} onClose={() => setModal(null)} />}
    </>
  );
}

function ContractText({ c, templates, editor }: { c: Contract; templates: { id: string; kind: string; name: { ru: string; uz: string; en?: string } }[]; editor: boolean }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const [tpl, setTpl] = useState(c.templateId ?? templates.find((x) => x.kind === c.kind)?.id ?? '');
  return (
    <Card
      title={t('con_text')}
      actions={
        editor && ['draft', 'pending'].includes(c.status) ? (
          <span className="pc-row">
            <Select<string> value={tpl} onChange={setTpl} placeholder="—" options={templates.map((x) => ({ value: x.id, label: loc(x.name) }))} ariaLabel={t('con_template')} />
            <Button size="small" disabled={!tpl} onClick={async () => { try { await contractsApi.applyTemplate(c.id, tpl, user); toast(t('con_textGenerated')); } catch (e) { toast(err(e)); } }}>{t('con_generateText')}</Button>
          </span>
        ) : undefined
      }
    >
      {c.text ? <pre className="pc-text">{c.text}</pre> : <p className="muted" style={{ margin: 0 }}>{t('con_noText')}</p>}
    </Card>
  );
}

function ScheduleModal({ c, onClose }: { c: Contract; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const [rows, setRows] = useState<ContractPayment[]>(c.payments.map((p) => ({ ...p })));
  const [error, setError] = useState('');
  const sum = rows.reduce((s, p) => s + p.amount, 0);
  const set = (i: number, p: Partial<ContractPayment>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Modal
      title={`${t('con_editSchedule')}: ${c.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" onClick={async () => { try { await contractsApi.updateSchedule(c.id, rows, user); toast(t('saved')); onClose(); } catch (e) { setError(err(e)); } }}>{t('save')}</Button>
        </>
      }
    >
      <div className="table-wrap">
        <table className="table pc-mini-table">
          <thead><tr><th>{t('date')}</th><th>{t('con_payKind')}</th><th>{t('amount')}</th><th /></tr></thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={i}>
                <td><Input type="date" value={p.dueDate} disabled={p.paid} onChange={(e) => set(i, { dueDate: e.target.value })} ariaLabel={t('date')} /></td>
                <td>
                  <Select<NonNullable<ContractPayment['kind']>> value={p.kind ?? 'final'} disabled={p.paid} onChange={(v) => set(i, { kind: v })} options={(['advance', 'final', 'periodic', 'by_invoice', 'by_act'] as const).map((k) => ({ value: k, label: t(tk('con_pk_', k)) }))} ariaLabel={t('con_payKind')} />
                </td>
                <td><Input type="number" value={p.amount} disabled={p.paid} onChange={(e) => set(i, { amount: Number(e.target.value) })} ariaLabel={t('amount')} /></td>
                <td>{!p.paid && <Button size="small" type="text" icon="trash" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} title={t('proc_removeItem')} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pc-row" style={{ justifyContent: 'space-between' }}>
        <Button size="small" icon="plus" onClick={() => setRows((r) => [...r, { dueDate: c.endDate.slice(0, 10), amount: 0, paid: false, kind: 'final' }])}>{t('con_addPayment')}</Button>
        <span className={sum === c.amount ? 'muted small' : 'error-text'}>{t('total')}: {formatMoney(sum, c.currency)} / {formatMoney(c.amount, c.currency)}</span>
      </div>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

function StagesModal({ c, onClose }: { c: Contract; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const [rows, setRows] = useState<ContractStage[]>((c.stages ?? []).map((s) => ({ ...s })));
  const [error, setError] = useState('');
  const set = (i: number, p: Partial<ContractStage>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Modal
      title={`${t('con_editStages')}: ${c.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" onClick={async () => { try { await contractsApi.saveStages(c.id, rows, user); toast(t('saved')); onClose(); } catch (e) { setError(err(e)); } }}>{t('save')}</Button>
        </>
      }
    >
      {rows.map((s, i) => (
        <div key={s.id || i} className="form-grid" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          <Field label={t('con_stage')} required><Input value={s.name} onChange={(e) => set(i, { name: e.target.value })} ariaLabel={t('con_stage')} /></Field>
          <Field label={t('con_obligation')}>
            <Select<ContractStage['obligation']> value={s.obligation} onChange={(v) => set(i, { obligation: v })} options={(['delivery', 'works', 'acceptance', 'payment', 'other'] as const).map((o) => ({ value: o, label: t(tk('con_obl_', o)) }))} ariaLabel={t('con_obligation')} />
          </Field>
          <Field label={t('deadline')}><Input type="date" value={s.dueDate} onChange={(e) => set(i, { dueDate: e.target.value })} ariaLabel={t('deadline')} /></Field>
          <Field label={t('amount')}><Input type="number" value={s.amount ?? ''} onChange={(e) => set(i, { amount: Number(e.target.value) || undefined })} ariaLabel={t('amount')} /></Field>
        </div>
      ))}
      <Button size="small" icon="plus" onClick={() => setRows((r) => [...r, { id: '', name: '', obligation: 'delivery', dueDate: c.endDate.slice(0, 10), status: 'planned' }])}>{t('con_addStage')}</Button>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

function InitiatorsModal({ c, onClose }: { c: Contract; onClose: () => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useErr();
  const allowed = useApi(() => contractsApi.initiatorDepts(), []);
  const [main, setMain] = useState(c.departmentId);
  const [extra, setExtra] = useState<string[]>((c.initiatorDeptIds ?? []).filter((d) => d !== c.departmentId));
  const [error, setError] = useState('');
  const list = lk.departments.filter((d) => allowed.data?.includes(d.id));
  return (
    <Modal
      title={t('con_editInitiators')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" onClick={async () => { try { await contractsApi.setInitiators(c.id, main, extra, user); toast(t('saved')); onClose(); } catch (e) { setError(err(e)); } }}>{t('save')}</Button>
        </>
      }
    >
      <Field label={t('con_initiator')} required>
        <Select<string> value={main} onChange={setMain} options={list.map((d) => ({ value: d.id, label: loc(d.name) }))} ariaLabel={t('con_initiator')} />
      </Field>
      <Field label={t('con_extraInitiators')}>
        <div className="pc-row">
          {list.filter((d) => d.id !== main).map((d) => (
            <Checkbox key={d.id} checked={extra.includes(d.id)} onChange={(v) => setExtra((x) => (v ? [...x, d.id] : x.filter((y) => y !== d.id)))}>{d.code}</Checkbox>
          ))}
        </div>
      </Field>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

function AmountModal({ title, initial, onClose, onSave }: { title: string; initial: number; onClose: () => void; onSave: (v: number) => Promise<unknown> }) {
  const { t } = useSession();
  const toast = useToast();
  const err = useErr();
  const [v, setV] = useState(Math.max(0, initial));
  const [error, setError] = useState('');
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" onClick={async () => { try { await onSave(v); toast(t('saved')); onClose(); } catch (e) { setError(err(e)); } }}>{t('save')}</Button>
        </>
      }
    >
      <Field label={t('amount')} required error={error}>
        <Input type="number" value={v || ''} onChange={(e) => setV(Number(e.target.value))} ariaLabel={t('amount')} />
      </Field>
    </Modal>
  );
}
