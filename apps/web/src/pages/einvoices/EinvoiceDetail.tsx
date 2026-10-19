import { useState } from 'react';
import {
  api, directory, einvoiceDay, einvoiceSignContent, einvoiceLight, einvoicesApi, einvoiceTotals, einvoiceUnitOverdueDays, EINVOICE_LEGAL_DAYS, EINVOICE_UNIT_DAYS, formatDate, formatDateTime, formatMoney, pick, tk,
  type EinvoiceDoc, type SignableDoc,
} from '@xb/shared';
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Progress, RouteSteps, StatusBadge, Textarea, Timeline } from '../../components/ui';
import { SignModal, SignaturesPanel } from '../../components/SignModal';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { FieldHistory } from '../../components/FieldHistory';
import { Link } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { ChecksList, LightBadge, Note, OrgUnitSelect, ReasonModal, useAction, useOrgUnitName } from '../documents/p2docs';
import { BANK_TIN, einvoicePaymentPrintDoc, einvoicePrintDoc } from './shared';

/** Каноническое содержимое для подписи (не зависит от языка интерфейса). */
export { einvoiceSignContent };

export function EinvoiceDetailPage({ id }: { id: string }) {
  const { t, lang } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const unitName = useOrgUnitName();
  const { busy, run } = useAction();
  const doc = useApi(() => einvoicesApi.get(id), [id]);
  const contract = useApi(async () => (doc.data?.contractId ? api.getContract(doc.data.contractId) : undefined), [doc.data?.contractId]);
  const match = useApi(async () => (doc.data?.contractId ? einvoicesApi.contractMatch(doc.data.contractId) : undefined), [doc.data?.contractId]);
  const checks = useApi(() => einvoicesApi.checks(id), [id]);
  const [modal, setModal] = useState<'sign' | 'reject' | 'route' | 'unitReject' | 'payment' | null>(null);

  if (doc.loading && !doc.data) return <Card><Loading /></Card>;
  const d = doc.data;
  if (!d) return <Card><Empty text={t('empty')} /></Card>;

  const totals = einvoiceTotals(d.lines, d.vatRate);
  const cp = lk.counterparty(d.counterpartyId);
  const incoming = d.direction === 'incoming';
  const operator = can('einvoices', 'edit');
  const a = d.assignment;
  const isAssignee = !!a && d.status === 'routed' && !a.decision && (a.assigneeIds.includes(user.id) || user.role === 'admin');
  const light = einvoiceLight(d);
  const day = einvoiceDay(d);
  const unitLate = einvoiceUnitOverdueDays(a);
  const signable: SignableDoc = { entity: 'einvoice', entityId: d.id, title: `${t(tk('einvoices_kind_', d.kind))} ${d.number}`, content: einvoiceSignContent(d) };
  const signerName = d.signedBy ? lk.user(d.signedBy)?.fullName : undefined;
  const confirmName = a?.decidedBy ? lk.user(a.decidedBy)?.fullName : undefined;
  const printDoc = () => einvoicePrintDoc(d, { t, lang, ...(cp ? { cp } : {}), ...(contract.data ? { contract: contract.data } : {}), ...(signerName ? { signerName } : {}), ...(confirmName ? { confirmName } : {}) });
  const payDoc = einvoicePaymentPrintDoc(d, { lang, ...(cp ? { cp } : {}), ...(d.paymentOrder ? { createdBy: lk.user(d.paymentOrder.createdBy)?.fullName ?? '' } : {}) });
  const ok = (msg: string) => `${d.number}: ${msg}`;

  const party = (role: 'seller' | 'buyer') => {
    const isBank = incoming ? role === 'buyer' : role === 'seller';
    return (
      <div className="p2-box">
        <div className="muted small">{role === 'seller' ? t('einvoices_seller') : t('einvoices_buyer')}</div>
        <div style={{ fontWeight: 600, marginTop: 2 }}>{isBank ? t('einvoices_bank') : cp?.name}</div>
        <div className="muted small">{t('tin')} {isBank ? BANK_TIN : cp?.tin}</div>
        {!isBank && cp?.address && <div className="muted small">{cp.address}</div>}
      </div>
    );
  };

  const actions = (
    <>
      <StatusBadge prefix="einvoices_status_" status={d.status} />
      <PrintButton doc={printDoc} label={pick(lang, 'Печать с QR', 'QR bilan chop etish', 'Print with QR')} />
      {isAssignee && (
        <>
          <Button danger disabled={busy} onClick={() => setModal('unitReject')}>{pick(lang, 'Отклонить (подразделение)', 'Rad etish (bo‘linma)', 'Reject (unit)')}</Button>
          <Button type="primary" icon="check" disabled={busy} onClick={() => run(() => einvoicesApi.unitDecision(d.id, user, 'confirmed'), ok(pick(lang, 'подтверждено подразделением', 'bo‘linma tasdiqladi', 'confirmed by unit')))}>
            {pick(lang, 'Подтвердить', 'Tasdiqlash', 'Confirm')}
          </Button>
        </>
      )}
      {operator && incoming && ['new', 'routed'].includes(d.status) && (
        <Button disabled={busy} icon="route" onClick={() => setModal('route')}>{d.status === 'routed' ? pick(lang, 'Перенаправить', 'Qayta yo‘naltirish', 'Re-route') : pick(lang, 'Направить в подразделение', 'Bo‘linmaga yuborish', 'Route to unit')}</Button>
      )}
      {operator && incoming && ['new', 'routed', 'accepted'].includes(d.status) && (
        <Button danger disabled={busy} onClick={() => setModal('reject')}>{t('einvoices_reject')}</Button>
      )}
      {operator && ((incoming && d.status === 'new') || (!incoming && d.status === 'draft')) && (
        <Button disabled={busy} onClick={() => run(() => einvoicesApi.submit(d.id, user), ok(t('hist_submitted')))}>{t('einvoices_sendToApproval')}</Button>
      )}
      {operator && ((incoming && ['new', 'accepted'].includes(d.status)) || (!incoming && ['draft', 'approved'].includes(d.status))) && (
        <Button type="primary" icon="pen" disabled={busy} onClick={() => setModal('sign')}>{incoming ? t('einvoices_sign') : t('einvoices_signSend')}</Button>
      )}
      {operator && !incoming && d.status === 'sent' && (
        <>
          <Button size="small" disabled={busy} onClick={() => run(() => einvoicesApi.receiveBuyerResponse(d.id, false), ok(t('einvoices_status_rejected')))}>{t('einvoices_buyerReject')}</Button>
          <Button size="small" disabled={busy} onClick={() => run(() => einvoicesApi.receiveBuyerResponse(d.id, true), ok(t('einvoices_status_accepted')))}>{t('einvoices_buyerAccept')}</Button>
        </>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('einvoices_title'), to: '/einvoices' }, { label: d.number }]}
        title={`${d.number} · ${t(tk('einvoices_kind_', d.kind))}`}
        subtitle={`${incoming ? t('einvoices_dir_incoming') : t('einvoices_dir_outgoing')} · ${formatDate(d.date)} · ${cp?.name ?? ''}`}
        actions={actions}
      />

      {light !== 'done' && (
        <Note tone={light === 'green' ? 'info' : light === 'yellow' ? 'warn' : 'danger'} icon="clock">
          {pick(lang, `Срок принятия/отклонения по ПКМ № 489: день ${day} из ${EINVOICE_LEGAL_DAYS}`, `VMQ № 489 bo‘yicha muddat: ${EINVOICE_LEGAL_DAYS} kundan ${day}-kun`, `Decision deadline (CM Resolution 489): day ${day} of ${EINVOICE_LEGAL_DAYS}`)}
          {light === 'black' ? ` — ${t('einvoices_light_black')}` : ''}
        </Note>
      )}
      {isAssignee && (
        <Note tone={unitLate ? 'danger' : 'warn'} icon="inbox">
          {pick(lang, `Документ направлен вашему подразделению. Подтвердите или отклоните до ${formatDateTime(a!.dueAt)}.`, `Hujjat bo‘linmangizga yuborilgan. ${formatDateTime(a!.dueAt)} gacha tasdiqlang yoki rad eting.`, `Routed to your unit. Confirm or reject by ${formatDateTime(a!.dueAt)}.`)}
          {unitLate ? ` ${pick(lang, `Просрочка ${unitLate} дн. — штраф KPI`, `${unitLate} kun kechikish — KPI jarimasi`, `${unitLate} days late — KPI penalty`)}` : ''}
        </Note>
      )}

      <div className="grid grid-main">
        <div className="p2-stack">
          <Card title={t('details')}>
            <div className="p2-split" style={{ marginBottom: 16 }}>
              {party('seller')}
              {party('buyer')}
            </div>
            <dl className="kv">
              <dt>{pick(lang, 'Вид документа', 'Hujjat turi', 'Document kind')}</dt>
              <dd>{t(tk('einvoices_kind_', d.kind))}</dd>
              <dt>{pick(lang, 'Источник', 'Manba', 'Source')}</dt>
              <dd>{t(tk('einvoices_source_', d.source))} · {formatDateTime(d.receivedAt)}</dd>
              <dt>{pick(lang, 'Срок (10 дн.)', 'Muddat (10 kun)', 'Deadline (10 d)')}</dt>
              <dd><LightBadge light={light} prefix="einvoices_light_" {...(light !== 'done' ? { day } : {})} /></dd>
              <dt>{t('einvoices_contract')}</dt>
              <dd>{contract.data ? <Link to={`/contracts/${contract.data.id}`}>{contract.data.number} · {contract.data.subject}</Link> : <span className="muted">{t('einvoices_noContract')}</span>}</dd>
              {d.issuerUnitKey && (
                <>
                  <dt>{pick(lang, 'Подразделение-оформитель', 'Rasmiylashtiruvchi bo‘linma', 'Issuing unit')}</dt>
                  <dd>{unitName(d.issuerUnitKey)}</dd>
                </>
              )}
              {d.basis && (
                <>
                  <dt>{pick(lang, 'Основание', 'Asos', 'Basis')}</dt>
                  <dd>{t(tk('einvoices_basis_', d.basis))}{d.basisRef ? ` · ${d.basisRef}` : ''}</dd>
                </>
              )}
              <dt>{t('einvoices_operatorId')}</dt>
              <dd className="num">{d.operatorId}</dd>
              {d.signedBy && (
                <>
                  <dt>{t('einvoices_signedBy')}</dt>
                  <dd>{lk.user(d.signedBy)?.fullName} · {d.signedAt ? formatDateTime(d.signedAt) : ''}</dd>
                </>
              )}
              {d.rejectReason && (
                <>
                  <dt>{t('rejectReason')}</dt>
                  <dd style={{ color: 'var(--danger)' }}>{d.rejectReason}</dd>
                </>
              )}
              {d.archiveRef && (
                <>
                  <dt>{pick(lang, 'Электронный архив', 'Elektron arxiv', 'Electronic archive')}</dt>
                  <dd>{d.archiveRef} · {d.archivedAt ? formatDateTime(d.archivedAt) : ''}</dd>
                </>
              )}
            </dl>
            {d.text && <p className="p2-text" style={{ marginTop: 14 }}>{d.text}</p>}
          </Card>

          {d.kind === 'reconciliation_act' && d.reconciliation ? (
            <Card title={pick(lang, 'Акт сверки взаиморасчётов', 'O‘zaro hisob-kitoblarni solishtirish dalolatnomasi', 'Settlement reconciliation')} flush>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('einvoices_date')}</th>
                      <th>{pick(lang, 'Документ', 'Hujjat', 'Document')}</th>
                      <th className="right">{pick(lang, 'Дебет (начислено)', 'Debet (hisoblangan)', 'Debit (charged)')}</th>
                      <th className="right">{pick(lang, 'Кредит (оплачено)', 'Kredit (to‘langan)', 'Credit (paid)')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.reconciliation.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="num">{formatDate(l.date)}</td>
                        <td>{l.doc}</td>
                        <td className="right num">{l.debit ? formatMoney(l.debit) : ''}</td>
                        <td className="right num">{l.credit ? formatMoney(l.credit) : ''}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2} style={{ fontWeight: 700 }}>{pick(lang, 'Сальдо на конец периода', 'Davr oxiridagi qoldiq', 'Closing balance')}</td>
                      <td colSpan={2} className="right num" style={{ fontWeight: 700 }}>{formatMoney(d.reconciliation.closing)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card title={t('einvoices_lines')} flush>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('itemName')}</th>
                      <th className="right">{t('qty')}</th>
                      <th className="right">{t('unitPrice')}</th>
                      <th className="right">{t('einvoices_net')}</th>
                      <th className="right">{t('einvoices_vat')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.lines.map((l, i) => {
                      const net = Math.round(l.qty * l.unitPrice);
                      return (
                        <tr key={i}>
                          <td>{l.name}</td>
                          <td className="right num">{l.qty} <span className="muted">{l.unit}</span></td>
                          <td className="right num">{formatMoney(l.unitPrice)}</td>
                          <td className="right num">{formatMoney(net)}</td>
                          <td className="right num muted">{formatMoney(Math.round((net * d.vatRate) / 100))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
                <dl className="kv" style={{ gridTemplateColumns: 'auto auto', textAlign: 'right' }}>
                  <dt>{t('einvoices_net')}</dt>
                  <dd className="num">{formatMoney(totals.net)}</dd>
                  <dt>{t('einvoices_vat')}</dt>
                  <dd className="num">{formatMoney(totals.vat)}</dd>
                  <dt style={{ fontWeight: 700, color: 'var(--text)' }}>{t('einvoices_total')}</dt>
                  <dd className="num" style={{ fontWeight: 700, fontSize: 16 }}>{formatMoney(totals.total)}</dd>
                </dl>
              </div>
            </Card>
          )}

          <Card
            title={pick(lang, 'Бухгалтерские проводки', 'Buxgalteriya provodkalari', 'Accounting entries')}
            actions={operator && !d.postedAt && (incoming ? ['accepted', 'signed'].includes(d.status) : ['sent', 'accepted'].includes(d.status)) && d.kind !== 'reconciliation_act' && d.kind !== 'free_form' ? (
              <Button size="small" type="primary" disabled={busy} onClick={() => run(() => einvoicesApi.post(d.id, user), ok(pick(lang, 'проводки переданы в АБС', 'provodkalar ABS ga yuborildi', 'entries sent to core banking')))}>
                {pick(lang, 'Провести в АБС', 'ABS da o‘tkazish', 'Post to core banking')}
              </Button>
            ) : undefined}
            flush
          >
            {d.postings?.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{pick(lang, 'Дебет', 'Debet', 'Debit')}</th>
                      <th>{pick(lang, 'Кредит', 'Kredit', 'Credit')}</th>
                      <th>{pick(lang, 'Назначение', 'Maqsad', 'Purpose')}</th>
                      <th className="right">{pick(lang, 'Сумма', 'Summa', 'Amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.postings.map((p, i) => (
                      <tr key={i}>
                        <td className="num">{p.debit}</td>
                        <td className="num">{p.credit}</td>
                        <td className="small">{p.purpose}</td>
                        <td className="right num">{formatMoney(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted small" style={{ padding: '8px 14px' }}>
                  {d.postedAt ? `${pick(lang, 'Проведено в АБС', 'ABS da o‘tkazilgan', 'Posted')}: ${formatDateTime(d.postedAt)}` : pick(lang, 'Проект проводок — ещё не передан в АБС', 'Provodkalar loyihasi — ABS ga yuborilmagan', 'Draft entries — not yet posted')}
                  {d.postingExchangeId ? ` · ${d.postingExchangeId}` : ''}
                </div>
              </div>
            ) : (
              <Empty text={pick(lang, 'Проводки формируются после принятия документа', 'Provodkalar hujjat qabul qilingandan keyin shakllanadi', 'Entries are created after acceptance')} icon="book" />
            )}
          </Card>

          {incoming && d.kind !== 'reconciliation_act' && (
            <Card
              title={pick(lang, 'Мемориальный ордер на оплату', 'To‘lov uchun memorial order', 'Payment memorial order')}
              actions={
                <div className="p2-row">
                  {payDoc && <PrintButton doc={payDoc} label={pick(lang, 'Печать с QR', 'QR bilan chop etish', 'Print with QR')} />}
                  {operator && ['accepted', 'signed'].includes(d.status) && (!d.paymentOrder || d.paymentOrder.status === 'failed') && (
                    <Button size="small" disabled={busy} onClick={() => setModal('payment')}>{pick(lang, 'Сформировать ордер', 'Order shakllantirish', 'Create order')}</Button>
                  )}
                  {operator && d.paymentOrder && ['draft', 'queued', 'failed'].includes(d.paymentOrder.status) && (
                    <Button size="small" type="primary" disabled={busy} onClick={() => run(() => einvoicesApi.sendPaymentOrder(d.id, user), ok(pick(lang, 'ордер отправлен в АБС', 'order ABS ga yuborildi', 'order sent to core banking')))}>
                      {pick(lang, 'Отправить на оплату', "To'lovga yuborish", 'Send for payment')}
                    </Button>
                  )}
                </div>
              }
            >
              {d.paymentOrder ? (
                <dl className="kv">
                  <dt>{t('number')}</dt>
                  <dd>{d.paymentOrder.number} <StatusBadge prefix="einvoices_pay_" status={d.paymentOrder.status} /></dd>
                  <dt>{pick(lang, 'Дебет / Кредит', 'Debet / Kredit', 'Debit / Credit')}</dt>
                  <dd className="num">{d.paymentOrder.debit} / {d.paymentOrder.credit}</dd>
                  <dt>{pick(lang, 'Счёт получателя / МФО', 'Oluvchi hisobi / MFO', 'Account / MFO')}</dt>
                  <dd className="num">{d.paymentOrder.account} · {d.paymentOrder.mfo}</dd>
                  <dt>{pick(lang, 'Сумма', 'Summa', 'Amount')}</dt>
                  <dd className="num">{formatMoney(d.paymentOrder.amount)}</dd>
                  <dt>{pick(lang, 'Назначение', 'Maqsad', 'Purpose')}</dt>
                  <dd>{d.paymentOrder.purpose}</dd>
                  {d.paymentOrder.transactionId && (
                    <>
                      <dt>{pick(lang, 'Транзакция', 'Tranzaksiya', 'Transaction')}</dt>
                      <dd>{d.paymentOrder.transactionId} · {d.paymentOrder.paidAt ? formatDateTime(d.paymentOrder.paidAt) : ''}</dd>
                    </>
                  )}
                  {d.paymentOrder.contractPaymentIndex !== undefined && (
                    <>
                      <dt>{pick(lang, 'График договора', 'Shartnoma jadvali', 'Contract schedule')}</dt>
                      <dd>{pick(lang, `Платёж № ${d.paymentOrder.contractPaymentIndex + 1}`, `${d.paymentOrder.contractPaymentIndex + 1}-to‘lov`, `Payment #${d.paymentOrder.contractPaymentIndex + 1}`)}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <Empty text={pick(lang, 'Ордер формируется после принятия документа', 'Order hujjat qabul qilingandan keyin shakllanadi', 'The order is created after acceptance')} icon="receipt" />
              )}
            </Card>
          )}

          <Attachments entity="einvoice" entityId={d.id} readOnly={!operator} />
        </div>

        <div className="p2-stack">
          <Card title={t('route')}>
            {incoming && (
              <div className="p2-box" style={{ marginBottom: 12 }} data-testid="ehf-unit-step">
                <div className="muted small">{pick(lang, 'Подразделение (срок 5 дней)', 'Bo‘linma (muddat 5 kun)', 'Unit (5-day deadline)')}</div>
                {a ? (
                  <>
                    <div style={{ fontWeight: 600 }}>{unitName(a.orgUnitKey)}</div>
                    <div className="small">{a.assigneeIds.map((i) => lk.user(i)?.fullName ?? directory.user(i)?.fullName ?? i).join(', ')}</div>
                    <div className="small muted">{pick(lang, 'Срок', 'Muddat', 'Due')}: {formatDateTime(a.dueAt)}</div>
                    <div className="p2-row" style={{ marginTop: 6 }}>
                      {a.decision ? <Badge tone={a.decision === 'confirmed' ? 'ok' : 'danger'}>{a.decision === 'confirmed' ? pick(lang, 'Подтверждено', 'Tasdiqlangan', 'Confirmed') : pick(lang, 'Отклонено', 'Rad etilgan', 'Rejected')}</Badge> : <Badge tone="warn">{pick(lang, 'Ожидает решения', 'Qaror kutilmoqda', 'Awaiting decision')}</Badge>}
                      {unitLate > 0 && <Badge tone="danger">{pick(lang, `Просрочка ${unitLate} дн.`, `${unitLate} kun kechikish`, `${unitLate} d late`)}</Badge>}
                    </div>
                    {a.reason && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{a.reason}</div>}
                  </>
                ) : (
                  <div className="small muted">{pick(lang, 'Не направлен', 'Yuborilmagan', 'Not routed')}</div>
                )}
              </div>
            )}
            {['pending', 'accepted', 'signed', 'sent'].includes(d.status) || d.history.some((h) => h.action === 'submitted') ? (
              <RouteSteps entityId={d.id} />
            ) : (
              <RouteSteps preview={{ entity: 'einvoice', context: { direction: d.direction, subtype: d.kind, amount: totals.total } }} />
            )}
          </Card>
          <Card title={pick(lang, 'Проверки и сверка', 'Tekshiruvlar va solishtirish', 'Checks and matching')}>
            {checks.data ? <ChecksList items={checks.data.map((c) => ({ label: t(tk('einvoices_check_', c.code)), ok: c.ok, ...(c.warn ? { warn: true } : {}), ...(c.details ? { details: c.details } : {}) }))} /> : <Loading />}
          </Card>
          {match.data && contract.data && contract.data.currency === 'UZS' && match.data.contractAmount > 0 && (
            <Card title={t('einvoices_match')}>
              <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
                <dt>{t('einvoices_contractAmount')}</dt>
                <dd className="num">{formatMoney(match.data.contractAmount, contract.data.currency)}</dd>
                <dt>{t('einvoices_invoiced')}</dt>
                <dd className="num">{formatMoney(match.data.invoicedTotal)}</dd>
                <dt>{t('einvoices_remaining')}</dt>
                <dd className="num" style={{ color: match.data.exceeds ? 'var(--danger)' : undefined }}>{formatMoney(match.data.remaining)}</dd>
              </dl>
              <div style={{ marginTop: 12 }}>
                <Progress pct={Math.round((match.data.invoicedTotal / match.data.contractAmount) * 100)} />
              </div>
              <p className={match.data.exceeds ? 'error-text' : 'muted small'} style={{ marginBottom: 0 }}>
                {match.data.exceeds ? t('einvoices_exceeds') : t('einvoices_matchOk')}
              </p>
            </Card>
          )}
          {d.penalties?.length ? (
            <Card title={pick(lang, 'Нарушения сроков (KPI)', 'Muddat buzilishlari (KPI)', 'Deadline breaches (KPI)')}>
              {d.penalties.map((p, i) => (
                <div key={i} className="small">{lang === 'ru' ? p.unitName.ru : p.unitName.uz}: {p.days} {pick(lang, 'дн.', 'kun', 'd')} · −{p.points} {pick(lang, 'балл.', 'ball', 'pts')}</div>
              ))}
            </Card>
          ) : null}
          <SignaturesPanel doc={signable} canSign={false} />
          {operator && d.archivedAt === undefined && ['signed', 'rejected', 'sent', 'accepted'].includes(d.status) && (incoming ? d.status !== 'accepted' : true) && (
            <Button disabled={busy} icon="archive" onClick={() => run(() => einvoicesApi.archive(d.id, user), ok(pick(lang, 'передан в архив', 'arxivga topshirildi', 'archived')))}>
              {pick(lang, 'Передать в архив', 'Arxivga topshirish', 'Send to archive')}
            </Button>
          )}
          <Card title={t('history')}>
            <Timeline events={d.history} />
          </Card>
          <FieldHistory entity="einvoice" entityId={d.id} />
        </div>
      </div>

      {modal === 'sign' && <SignModal doc={signable} onClose={() => setModal(null)} onSigned={(rec) => void run(() => einvoicesApi.sign(d.id, user, rec.id), ok(t('einvoices_signed')))} />}
      {modal === 'reject' && <ReasonModal title={`${t('einvoices_reject')}: ${d.number}`} label={t('einvoices_rejectReason')} onClose={() => setModal(null)} onSubmit={(reason) => run(() => einvoicesApi.reject(d.id, user, reason), ok(t('einvoices_status_rejected')))} />}
      {modal === 'unitReject' && <ReasonModal title={`${pick(lang, 'Отклонить', 'Rad etish', 'Reject')}: ${d.number}`} label={t('einvoices_rejectReason')} onClose={() => setModal(null)} onSubmit={(reason) => run(() => einvoicesApi.unitDecision(d.id, user, 'rejected', reason), ok(t('einvoices_status_rejected')))} />}
      {modal === 'route' && <RouteModal doc={d} onClose={() => setModal(null)} />}
      {modal === 'payment' && <PaymentModal doc={d} onClose={() => setModal(null)} />}
    </>
  );
}

function RouteModal({ doc, onClose }: { doc: EinvoiceDoc; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [unit, setUnit] = useState(doc.assignment?.orgUnitKey ?? '');
  const [days, setDays] = useState(String(EINVOICE_UNIT_DAYS));
  const [comment, setComment] = useState('');
  const [err, setErr] = useState(false);
  const n = Number(days);
  return (
    <Modal
      title={`${pick(lang, 'Направить в подразделение', 'Bo‘linmaga yuborish', 'Route to unit')}: ${doc.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={async () => {
              if (!unit || !(n >= 1 && n <= EINVOICE_LEGAL_DAYS)) return setErr(true);
              if (await run(() => einvoicesApi.route(doc.id, unit, user, { dueDays: n, comment }), `${doc.number}: ${pick(lang, 'направлен', 'yuborildi', 'routed')}`)) onClose();
            }}
          >
            {pick(lang, 'Направить', 'Yuborish', 'Route')}
          </Button>
        </>
      }
    >
      <Field label={pick(lang, 'Подразделение ЦА / региональный центр / ЦБУ', 'MA bo‘linmasi / hududiy markaz / BXM', 'Head-office unit / regional centre / branch')} required error={err && !unit ? t('formRequired') : undefined}>
        <OrgUnitSelect value={unit} onChange={setUnit} placeholder="—" />
      </Field>
      <Field label={pick(lang, 'Срок исполнения, дней', 'Ijro muddati, kun', 'Deadline, days')} required hint={pick(lang, '1–10; по умолчанию 5 (штраф KPI за просрочку)', '1–10; standart 5 (kechikish uchun KPI jarimasi)', '1–10; default 5 (KPI penalty if late)')} error={err && !(n >= 1 && n <= EINVOICE_LEGAL_DAYS) ? '1–10' : undefined}>
        <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} ariaLabel={pick(lang, 'Срок', 'Muddat', 'Deadline')} />
      </Field>
      <Field label={t('comment')}>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} ariaLabel={t('comment')} />
      </Field>
    </Modal>
  );
}

function PaymentModal({ doc, onClose }: { doc: EinvoiceDoc; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [account, setAccount] = useState('20208000300123456001');
  const [mfo, setMfo] = useState('00873');
  const okAcc = /^\d{20}$/.test(account);
  const okMfo = /^\d{5}$/.test(mfo);
  const [err, setErr] = useState(false);
  return (
    <Modal
      title={`${pick(lang, 'Мемориальный ордер', 'Memorial order', 'Memorial order')}: ${doc.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={async () => {
              if (!okAcc || !okMfo) return setErr(true);
              if (await run(() => einvoicesApi.createPaymentOrder(doc.id, user, { account, mfo }), `${doc.number}: ${pick(lang, 'ордер сформирован', 'order shakllantirildi', 'order created')}`)) onClose();
            }}
          >
            {pick(lang, 'Сформировать', 'Shakllantirish', 'Create')}
          </Button>
        </>
      }
    >
      <Field label={pick(lang, 'Расчётный счёт получателя (20 цифр)', 'Oluvchining hisob raqami (20 raqam)', 'Beneficiary account (20 digits)')} required error={err && !okAcc ? pick(lang, 'Нужно 20 цифр', '20 ta raqam kerak', '20 digits required') : undefined}>
        <Input value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))} maxLength={20} inputMode="numeric" ariaLabel="account" />
      </Field>
      <Field label={pick(lang, 'МФО банка получателя', 'Oluvchi banki MFO', 'Beneficiary bank code')} required error={err && !okMfo ? pick(lang, 'Нужно 5 цифр', '5 ta raqam kerak', '5 digits required') : undefined}>
        <Input value={mfo} onChange={(e) => setMfo(e.target.value.replace(/\D/g, ''))} maxLength={5} inputMode="numeric" ariaLabel="mfo" />
      </Field>
      <p className="muted small" style={{ margin: 0 }}>{pick(lang, 'Сумма и назначение платежа берутся из документа; при наличии договора закрывается ближайший платёж по графику.', 'Summa va to‘lov maqsadi hujjatdan olinadi; shartnoma bo‘lsa, jadvaldagi navbatdagi to‘lov yopiladi.', 'Amount and purpose come from the document; the next contract schedule payment is closed.')}</p>
    </Modal>
  );
}
