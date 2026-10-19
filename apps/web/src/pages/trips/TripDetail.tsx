import { useState } from 'react';
import {
  approvalsApi, canSeeTrip, filesApi, formatDate, formatDateTime, formatMoney, pick, tk, today, tripCalc, tripDestination, tripDeviations, tripGradeOf, tripJournalStatus, tripPlace, tripReportSignContent, tripSettlement, tripsApi, TRIP_EXPENSE_CATEGORIES,
  type SignableDoc, type TripExpenseCategory, type TripExpenseLine, type TripRequest,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, Empty, Input, Loading, Modal, PageHeader, RouteSteps, Select, StatusBadge, Timeline } from '../../components/ui';
import { SignModal, SignaturesPanel } from '../../components/SignModal';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { FieldHistory } from '../../components/FieldHistory';
import { Link } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Note, useAction } from '../documents/p2docs';
import { CalcTable, TRIP_TONE, tripOrderPrint, tripReportPrint } from './shared';
import { TripBookingCard } from './TripBooking';

export function TripDetailPage({ id }: { id: string }) {
  const { t, loc, lang } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const { busy, run } = useAction();
  const trip = useApi(() => tripsApi.get(id), [id]);
  const reportTask = useApi(() => approvalsApi.getRoute(`${id}:report`), [id, trip.data?.status]);
  const files = useApi(() => filesApi.list('business_trip', id), [id]);
  const [modal, setModal] = useState<'advance' | 'signOrder' | 'hr' | null>(null);

  if (trip.loading && !trip.data) return <Card><Loading /></Card>;
  const r = trip.data;
  if (!r) return <Card><Empty text={t('empty')} /></Card>;
  if (!canSeeTrip(user, r)) return <Card><Empty text={t('noAccess')} icon="alert" /></Card>;

  const dest = tripDestination(r.destinationId);
  const place = tripPlace(dest, lang);
  const calc = tripCalc(r);
  const owner = r.employeeId === user.id || user.role === 'admin';
  const js = tripJournalStatus(r);
  const reportDue = r.status === 'approved' && r.endDate < today();
  const canReport = r.status === 'approved' && owner && r.startDate <= today();
  const dept = lk.department(r.departmentId);
  const emp = lk.user(r.employeeId);
  const isAccountant = user.role === 'accountant' || user.role === 'admin';
  const reportStep = reportTask.data?.steps.find((s) => s.state === 'current');
  const hrStep = r.status === 'report_pending' && reportStep?.index === 1;
  const accStep = r.status === 'report_pending' && reportStep?.index === 2;
  const orderDoc: SignableDoc = { entity: 'trip_order', entityId: r.id, title: `${pick(lang, 'Приказ', 'Buyruq', 'Order')} ${r.order?.number ?? ''}`, content: { trip: r.number, employee: r.employeeId, destination: r.destinationId, from: r.startDate, to: r.endDate, advance: r.advance } };
  const reportDoc: SignableDoc = { entity: 'business_trip_report', entityId: r.id, title: `${t('trips_report')} ${r.number}`, content: tripReportSignContent(r) };
  const ok = (m: string) => `${r.number}: ${m}`;
  const catName = (c: string) => t(tk('trips_cat_', c));

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('trips_title'), to: '/trips' }, { label: r.number }]}
        title={`${place.city}${dest?.type === 'abroad' ? `, ${place.country}` : ''} · ${formatDate(r.startDate)} — ${formatDate(r.endDate)}`}
        subtitle={`${r.number} · ${emp?.fullName ?? ''}`}
        actions={
          <>
            <StatusBadge prefix="trips_status_" status={js} tone={TRIP_TONE[js]} />
            {['draft', 'rejected'].includes(r.status) && owner && <Button type="primary" disabled={busy} onClick={() => run(() => tripsApi.submit(r.id, user), ok(t('hist_submitted')))}>{t('trips_submitNow')}</Button>}
            {r.order && <PrintButton doc={() => tripOrderPrint(r, { lang, ...(emp ? { emp, position: loc(emp.position) } : {}), ...(dest ? { dest } : {}), hr: lk.users.find((u) => u.role === 'hr')?.fullName ?? '' })} template="act" label={pick(lang, 'Приказ', 'Buyruq', 'Order')} />}
            {r.order && !r.order.signatureIds?.length && can('trips', 'approve') && <Button icon="pen" disabled={busy} onClick={() => setModal('signOrder')}>{pick(lang, 'Подписать приказ', 'Buyruqni imzolash', 'Sign order')}</Button>}
            {r.status === 'approved' && (!r.advancePayment || r.advancePayment.status === 'failed') && (owner || isAccountant) && <Button disabled={busy} onClick={() => setModal('advance')}>{pick(lang, 'Заявка на аванс', 'Avans arizasi', 'Request advance')}</Button>}
            {r.advancePayment && ['requested', 'queued'].includes(r.advancePayment.status) && ((r.advancePayment.method === 'card' && isAccountant) || (r.advancePayment.method === 'cash' && (can('cash', 'edit') || isAccountant))) && (
              <Button type="primary" disabled={busy} onClick={() => run(() => tripsApi.payAdvance(r.id, user), ok(t('trips_adv_paid')))}>{r.advancePayment.method === 'cash' ? pick(lang, 'Выдать из кассы', 'Kassadan berish', 'Pay out in cash') : pick(lang, 'Перечислить на карту', 'Kartaga o‘tkazish', 'Transfer to card')}</Button>
            )}
            {r.report && <PrintButton doc={() => tripReportPrint(r, lang, catName, emp?.fullName)} label={t('trips_report')} />}
            {hrStep && (user.role === 'hr' || user.role === 'admin') && user.id !== r.employeeId && <Button type="primary" icon="pen" disabled={busy} onClick={() => setModal('hr')}>{pick(lang, 'Проверить и подписать (HR)', 'Tekshirish va imzolash (HR)', 'Check and sign (HR)')}</Button>}
            {accStep && isAccountant && user.id !== r.employeeId && <Button type="primary" icon="check" disabled={busy} onClick={() => run(() => tripsApi.acceptReport(r.id, user), ok(t('trips_status_closed')))}>{t('trips_reportAccept')}</Button>}
          </>
        }
      />

      {reportDue && owner && <Note tone="warn">{t('trips_reportDue')}</Note>}
      {r.report?.returnedReason && r.status === 'approved' && <Note tone="danger">{pick(lang, 'Отчёт возвращён на доработку', 'Hisobot qayta ishlashga qaytarildi', 'Report returned for rework')}: {r.report.returnedReason}</Note>}

      <div className="grid grid-main">
        <div className="p2-stack">
          <Card title={t('details')}>
            <dl className="kv">
              <dt>{t('trips_employee')}</dt>
              <dd>{emp?.fullName} <span className="muted small">· {emp ? loc(emp.position) : ''} · {t(tk('trips_grade_', tripGradeOf(r.employeeId)))}</span></dd>
              <dt>{t('department')}</dt>
              <dd>{dept ? loc(dept.name) : '—'}</dd>
              <dt>{t('trips_destination')}</dt>
              <dd>{place.city}, {place.country} <Badge tone={dest?.type === 'abroad' ? 'info' : 'muted'}>{dest?.type === 'abroad' ? t('trips_dest_abroad') : t('trips_dest_domestic')}</Badge></dd>
              <dt>{t('trips_dates')}</dt>
              <dd className="num">{formatDate(r.startDate)} — {formatDate(r.endDate)} · {calc.days} {t('trips_daysShort')}{r.travelDays ? ` + ${r.travelDays} ${pick(lang, 'в пути', 'yo‘lda', 'travel')}` : ''}</dd>
              <dt>{t('trips_transport')}</dt>
              <dd>{t(tk('trips_tr_', r.transport))}{r.transportClass ? ` · ${t(tk('trips_class_', r.transportClass))}` : ''}{!calc.classAllowed && <> <Badge tone="danger">{pick(lang, 'Класс выше лимита грейда', 'Klass grade limitidan yuqori', 'Class above grade limit')}</Badge></>}</dd>
              <dt>{t('trips_purpose')}</dt>
              <dd style={{ fontWeight: 400 }}>{r.purpose}</dd>
              {r.order && (
                <>
                  <dt>{pick(lang, 'Приказ', 'Buyruq', 'Order')}</dt>
                  <dd>{r.order.documentId ? <Link to={`/documents/${r.order.documentId}`}>{r.order.number}</Link> : r.order.number} · {formatDate(r.order.createdAt)}{r.order.signatureIds?.length ? <> <Badge tone="ok">E-IMZO</Badge></> : ''}</dd>
                </>
              )}
              {r.advancePayment && (
                <>
                  <dt>{pick(lang, 'Выплата аванса', 'Avans to‘lovi', 'Advance payment')}</dt>
                  <dd>
                    {r.advancePayment.requestNo} · {r.advancePayment.method === 'cash' ? pick(lang, 'наличными через кассу', 'kassa orqali naqd', 'cash desk') : `${pick(lang, 'на карту', 'kartaga', 'to card')} ${r.advancePayment.card ?? ''}`}{' '}
                    <StatusBadge prefix="trips_adv_" status={r.advancePayment.status} tone={r.advancePayment.status === 'paid' ? 'ok' : r.advancePayment.status === 'failed' ? 'danger' : 'warn'} />
                    {r.advancePayment.paidAt && <span className="muted small"> · {formatDateTime(r.advancePayment.paidAt)}</span>}
                  </dd>
                </>
              )}
            </dl>
          </Card>

          <TripBookingCard trip={r} />

          {r.report ? <ReportView trip={r} /> : canReport ? <ReportForm trip={r} filesCount={files.data?.length ?? 0} onSubmit={(lines) => run(() => tripsApi.submitReport(r.id, user, lines), ok(t('trips_status_report_pending')))} busy={busy} /> : null}

          <Attachments entity="business_trip" entityId={r.id} readOnly={!owner && !isAccountant && user.role !== 'hr'} title={pick(lang, 'Подтверждающие документы и сканы чеков', 'Tasdiqlovchi hujjatlar va chek skanlari', 'Supporting documents and receipt scans')} />
        </div>

        <div className="p2-stack">
          <Card title={t('trips_calc')} flush>
            <CalcTable calc={calc} dest={dest} />
            {calc.hotelOverLimit && <p className="error-text" style={{ padding: '0 14px 12px', margin: 0 }}>{t('trips_hotelOverLimit')}</p>}
          </Card>
          {r.planLines?.length ? (
            <Card title={pick(lang, 'Прочие плановые расходы', 'Boshqa rejali xarajatlar', 'Other planned expenses')}>
              {r.planLines.map((l, i) => <div key={i} className="small">{catName(l.category)} · {l.description}: <b className="num">{formatMoney(l.amount)}</b></div>)}
            </Card>
          ) : null}
          {r.budget && (
            <Card title={pick(lang, 'Бюджетный лимит', 'Byudjet limiti', 'Budget limit')}>
              <Note tone={r.budget.status === 'ok' ? 'ok' : r.budget.status === 'exceeded' ? 'danger' : 'warn'} icon="wallet">
                {t(tk('trips_budget_', r.budget.status))}
                {r.budget.limit ? ` · ${pick(lang, 'доступно', 'mavjud', 'available')} ${formatMoney(r.budget.available)} / ${formatMoney(r.budget.limit)}` : ''}
                {r.budget.reserved ? ` · ${pick(lang, 'резерв', 'rezerv', 'reserved')} ${formatMoney(r.budget.reserved)}` : ''}
              </Note>
            </Card>
          )}
          {r.report && <SettlementCard trip={r} />}
          <Card title={t('route')}>
            {r.status === 'draft' ? <RouteSteps preview={{ entity: 'business_trip', context: { subtype: 'application', departmentId: r.departmentId, amount: r.advance, requesterId: r.employeeId } }} /> : <RouteSteps entityId={r.id} />}
            {r.report && (
              <div style={{ marginTop: 12 }}>
                <div className="muted small" style={{ marginBottom: 6 }}>{t('trips_report')}</div>
                <RouteSteps entityId={`${r.id}:report`} />
              </div>
            )}
          </Card>
          {r.order && <SignaturesPanel doc={orderDoc} canSign={false} />}
          {r.report && <SignaturesPanel doc={reportDoc} canSign={false} />}
          <Card title={t('history')}>
            <Timeline events={r.history} />
          </Card>
          <FieldHistory entity="business_trip" entityId={r.id} />
        </div>
      </div>

      {modal === 'advance' && <AdvanceModal trip={r} onClose={() => setModal(null)} />}
      {modal === 'signOrder' && <SignModal doc={orderDoc} onClose={() => setModal(null)} onSigned={(rec) => void run(() => tripsApi.signOrder(r.id, user, rec.id), ok(pick(lang, 'приказ подписан', 'buyruq imzolandi', 'order signed')))} />}
      {modal === 'hr' && <SignModal doc={reportDoc} onClose={() => setModal(null)} onSigned={(rec) => void run(() => tripsApi.hrConfirm(r.id, user, rec.id), ok(pick(lang, 'отчёт проверен HR', 'hisobot HR tomonidan tekshirildi', 'report checked by HR')))} />}
    </>
  );
}

function AdvanceModal({ trip, onClose }: { trip: TripRequest; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [method, setMethod] = useState<'cash' | 'card'>('card');
  return (
    <Modal
      title={`${pick(lang, 'Заявка на выплату аванса', 'Avans to‘lovi arizasi', 'Advance payment request')}: ${trip.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={async () => { if (await run(() => tripsApi.requestAdvance(trip.id, user, method), `${trip.number}: ${t('trips_adv_requested')}`)) onClose(); }}>{pick(lang, 'Сформировать заявку', 'Ariza shakllantirish', 'Create request')}</Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{t('trips_advance')}: <b className="num">{formatMoney(trip.advance)}</b></p>
      <Select<'cash' | 'card'> value={method} onChange={setMethod} options={[{ value: 'card', label: pick(lang, 'На банковскую карту сотрудника (через АБС)', 'Xodimning bank kartasiga (ABS orqali)', 'To employee card (via core banking)') }, { value: 'cash', label: pick(lang, 'Наличными через кассу', 'Kassa orqali naqd', 'Cash at the cash desk') }]} ariaLabel="method" />
    </Modal>
  );
}

function SettlementCard({ trip }: { trip: TripRequest }) {
  const { t, lang } = useSession();
  const s = tripSettlement(trip);
  const tone = s.balance > 0 ? 'var(--info)' : s.balance < 0 ? 'var(--warn)' : 'var(--ok)';
  return (
    <Card title={t('trips_settlement')}>
      <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
        <dt>{t('trips_advance')}</dt>
        <dd className="num">{formatMoney(s.advance)}</dd>
        <dt>{t('trips_spent')}</dt>
        <dd className="num">{formatMoney(s.spent)}</dd>
      </dl>
      <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', borderLeft: `3px solid ${tone}` }}>
        <div className="muted small">{s.balance > 0 ? t('trips_owedToEmployee') : s.balance < 0 ? t('trips_owedByEmployee') : t('trips_settled')}</div>
        <div className="num" style={{ fontWeight: 700, fontSize: 18 }}>{formatMoney(Math.abs(s.balance))}</div>
      </div>
      {trip.postings?.length ? (
        <div style={{ marginTop: 12 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>{pick(lang, 'Бухгалтерские проводки', 'Buxgalteriya provodkalari', 'Accounting entries')}{trip.postingExchangeId ? ` · ${trip.postingExchangeId}` : ''}</div>
          {trip.postings.map((p, i) => <div key={i} className="small num">{pick(lang, 'Дт', 'Dt', 'Dr')} {p.debit} — {pick(lang, 'Кт', 'Kt', 'Cr')} {p.credit}: {formatMoney(p.amount)}</div>)}
        </div>
      ) : null}
    </Card>
  );
}

function ReportView({ trip }: { trip: TripRequest }) {
  const { t, lang } = useSession();
  const lk = useLookups();
  const report = trip.report!;
  return (
    <Card title={t('trips_report')} actions={<span className="muted small">{formatDateTime(report.submittedAt)}{report.hrCheckedBy ? ` · HR: ${lk.user(report.hrCheckedBy)?.fullName}` : ''}{report.acceptedBy ? ` · ${lk.user(report.acceptedBy)?.fullName}` : ''}</span>} flush>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>{t('trips_expenseCategory')}</th><th>{t('description')}</th><th>{t('trips_receipt')}</th><th className="right">{t('amount')}</th></tr>
          </thead>
          <tbody>
            {report.lines.map((l, i) => (
              <tr key={i}>
                <td>{t(tk('trips_cat_', l.category))}</td>
                <td>{l.description}</td>
                <td>{l.hasReceipt ? <Badge tone="ok">{t('trips_receipt')}</Badge> : <span className="muted small">{t('trips_noReceipt')}</span>}</td>
                <td className="right num">{formatMoney(l.amount)}</td>
              </tr>
            ))}
            <tr><td colSpan={3} className="right" style={{ fontWeight: 700 }}>{t('trips_spent')}</td><td className="right num" style={{ fontWeight: 700 }}>{formatMoney(tripSettlement(trip).spent)}</td></tr>
          </tbody>
        </table>
      </div>
      <PlanFact trip={trip} />
      {report.deviations && (
        <div style={{ padding: '12px 14px' }}>
          {report.deviations.length ? (
            <Note tone="warn">
              <b>{pick(lang, 'Отклонения от норм и лимитов', 'Me’yor va limitlardan chetlanishlar', 'Deviations from norms and limits')}:</b>
              {report.deviations.map((d, i) => <div key={i}>{t(tk('trips_dev_', d.code))} · {t(tk('trips_cat_', d.category))}{d.limit ? `: ${formatMoney(d.amount)} / ${formatMoney(d.limit)}` : d.code === 'no_files' ? '' : `: ${formatMoney(d.amount)}`}</div>)}
            </Note>
          ) : (
            <Note tone="ok" icon="check">{pick(lang, 'Отклонений от норм не выявлено', 'Me’yorlardan chetlanish aniqlanmadi', 'No deviations from norms')}</Note>
          )}
        </div>
      )}
    </Card>
  );
}

/** План-факт по категориям расходов (PR-TRV-005). */
function PlanFact({ trip }: { trip: TripRequest }) {
  const { t, lang } = useSession();
  const c = tripCalc(trip);
  const plan: Record<string, number> = { transport: c.transport, hotel: c.hotelTotal, per_diem: c.perDiemTotal };
  for (const p of trip.planLines ?? []) plan[p.category] = (plan[p.category] ?? 0) + p.amount;
  const fact: Record<string, number> = {};
  for (const l of trip.report?.lines ?? []) fact[l.category] = (fact[l.category] ?? 0) + l.amount;
  const cats = TRIP_EXPENSE_CATEGORIES.filter((k) => plan[k] || fact[k]);
  return (
    <div className="table-wrap" style={{ borderTop: '1px solid var(--border)' }}>
      <table className="table">
        <thead>
          <tr><th>{pick(lang, 'План-факт по статьям', 'Moddalar bo‘yicha reja-fakt', 'Plan vs actual by category')}</th><th className="right">{pick(lang, 'План', 'Reja', 'Plan')}</th><th className="right">{pick(lang, 'Факт', 'Fakt', 'Actual')}</th><th className="right">{pick(lang, 'Отклонение', 'Farq', 'Variance')}</th></tr>
        </thead>
        <tbody>
          {cats.map((k) => {
            const diff = (fact[k] ?? 0) - (plan[k] ?? 0);
            return (
              <tr key={k}>
                <td>{t(tk('trips_cat_', k))}</td>
                <td className="right num">{formatMoney(plan[k] ?? 0)}</td>
                <td className="right num">{formatMoney(fact[k] ?? 0)}</td>
                <td className="right num" style={diff > 0 ? { color: 'var(--danger)' } : undefined}>{formatMoney(diff)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReportForm({ trip, filesCount, onSubmit, busy }: { trip: TripRequest; filesCount: number; onSubmit: (lines: TripExpenseLine[]) => Promise<unknown>; busy: boolean }) {
  const { t, lang } = useSession();
  const calc = tripCalc(trip);
  const [lines, setLines] = useState<TripExpenseLine[]>(() => trip.report?.lines ?? [
    { category: 'transport', description: '', amount: calc.transport, hasReceipt: true },
    { category: 'hotel', description: `${calc.nights} × ${t('trips_nights').toLowerCase()}`, amount: calc.hotelTotal, hasReceipt: true },
    { category: 'per_diem', description: `${calc.perDiemDays} × ${t('trips_daysShort')}`, amount: calc.perDiemTotal, hasReceipt: false },
    ...(trip.planLines ?? []).map((p) => ({ category: p.category as TripExpenseCategory, description: p.description, amount: p.amount, hasReceipt: true })),
  ]);
  const [error, setError] = useState('');
  const set = (i: number, patch: Partial<TripExpenseLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const spent = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const balance = spent - trip.advance;
  const preview = tripDeviations(trip, lines.filter((l) => l.amount > 0), filesCount);

  return (
    <Card title={t('trips_report')} actions={<Button size="small" icon="plus" onClick={() => setLines((l) => [...l, { category: 'other', description: '', amount: 0, hasReceipt: true }])}>{t('trips_addLine')}</Button>} flush>
      <div className="table-wrap">
        <table className="table items-table p2-table-inputs">
          <thead>
            <tr>
              <th style={{ width: 170 }}>{t('trips_expenseCategory')}</th>
              <th>{t('description')}</th>
              <th style={{ width: 160 }}>{t('amount')}</th>
              <th style={{ width: 90 }}>{t('trips_receipt')}</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><Select<TripExpenseCategory> value={l.category} onChange={(v) => set(i, { category: v })} options={TRIP_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(tk('trips_cat_', c)) }))} ariaLabel={t('trips_expenseCategory')} /></td>
                <td><Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} ariaLabel={t('description')} /></td>
                <td><Input type="number" value={l.amount || ''} onChange={(e) => set(i, { amount: Math.max(0, Number(e.target.value) || 0) })} ariaLabel={t('amount')} /></td>
                <td style={{ textAlign: 'center' }}><Checkbox checked={l.hasReceipt} onChange={(v) => set(i, { hasReceipt: v })} /></td>
                <td><Button type="text" size="small" icon="trash" title="Remove" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} /></td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} className="right" style={{ fontWeight: 700 }}>{t('trips_spent')}</td>
              <td className="num" style={{ fontWeight: 700 }}>{formatMoney(spent)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      {preview.length > 0 && (
        <div style={{ padding: '10px 14px 0' }}>
          <Note tone="warn">
            {preview.map((d, i) => <div key={i}>{t(tk('trips_dev_', d.code))} · {t(tk('trips_cat_', d.category))}</div>)}
          </Note>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <span className="small">{balance > 0 ? t('trips_owedToEmployee') : balance < 0 ? t('trips_owedByEmployee') : t('trips_settled')}: <b className="num">{formatMoney(Math.abs(balance))}</b></span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {error && <span className="error-text">{error}</span>}
          <Button
            type="primary"
            disabled={busy}
            onClick={() => {
              const clean = lines.filter((l) => l.amount > 0);
              if (!clean.length || clean.some((l) => l.category === 'other' && !l.description.trim())) return setError(t('formRequired'));
              if (clean.some((l) => l.hasReceipt) && filesCount === 0) return setError(pick(lang, 'Приложите сканы/фото чеков ниже', 'Quyida chek skanlari/fotolarini ilova qiling', 'Attach receipt scans/photos below'));
              setError('');
              void onSubmit(clean.map((l) => ({ ...l, description: l.description.trim() || t(tk('trips_cat_', l.category)) })));
            }}
          >
            {t('trips_reportSubmit')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
