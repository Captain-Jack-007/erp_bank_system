// P4 (PR-TRV-015): бронирование авиа/ж-д билетов и гостиниц по согласованной командировке через системы бронирования
// интеграционной шины: поиск предложений, проверка норм (класс по грейду, проезд ≤ план +15%, проживание ≤ лимит)
// и бюджета (резерв статьи «Командировочные расходы»), бронь с документом (электронный билет / ваучер во вложениях),
// отмена с возвратом, очередь и повтор при недоступности системы (видно в /integrations).
import { useEffect, useState } from 'react';
import {
  canBookTrip, formatDateTime, formatMoney, tk, tripCommitted, tripsApi,
  type PrintDocument, type TripBooking, type TripBookingKind, type TripBookingOffer, type TripRequest,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Empty, Field, Loading, Modal, StatusBadge, Textarea, type Tone } from '../../components/ui';
import { PrintButton } from '../../components/PrintView';
import { Link } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useLookups } from '../../lib/useApi';
import { Note, useAction } from '../documents/p2docs';
import './trips.css';

const STATUS_TONE: Record<TripBooking['status'], Tone> = { queued: 'warn', confirmed: 'ok', failed: 'danger', cancelled: 'muted' };
const KINDS: TripBookingKind[] = ['air', 'rail', 'hotel'];

export function TripBookingCard({ trip }: { trip: TripRequest }) {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const { busy, run } = useAction();
  const [search, setSearch] = useState<TripBookingKind | null>(null);
  const [cancel, setCancel] = useState<TripBooking | null>(null);
  const bookings = trip.bookings ?? [];
  const allowed = canBookTrip(user, trip);
  const show = allowed || bookings.length > 0;
  if (!show) return null;
  const c = tripCommitted(trip);
  const ok = (m: string) => `${trip.number}: ${m}`;
  const canCancel = trip.employeeId === user.id || user.role === 'hr' || user.role === 'admin';

  const ticketPrint = (b: TripBooking): PrintDocument => ({
    entity: 'trip_booking',
    entityId: b.id,
    title: `${t('trips_bk_document')}: ${t(tk('trips_bk_kind_', b.kind))}`,
    number: b.documentNo ?? '',
    date: (b.confirmedAt ?? b.createdAt).slice(0, 10),
    fields: [
      { label: 'PNR', value: b.pnr ?? '—' },
      { label: t('trips_employee'), value: lk.user(trip.employeeId)?.fullName ?? trip.employeeId },
      { label: t('trips_bk_offer'), value: b.title },
      { label: t('trips_dates'), value: b.details },
      { label: t('trips_bk_provider'), value: b.provider },
      { label: t('trips_bk_price'), value: formatMoney(b.price) },
      { label: t('trips_bk_rules'), value: b.refundable ? `${t('trips_bk_refundable')} ${b.penaltyPct}%` : t('trips_bk_nonRefundable') },
      { label: t('number'), value: trip.number },
      { label: t('status'), value: t(tk('trips_bk_status_', b.status)) },
    ],
  });

  return (
    <Card
      title={t('trips_bk_title')}
      actions={
        allowed ? (
          <span className="trv-bk-actions">
            {KINDS.map((k) => (
              <Button key={k} size="small" icon={k === 'hotel' ? 'building' : 'plane'} disabled={busy} onClick={() => setSearch(k)}>
                {t(tk('trips_bk_search_', k))}
              </Button>
            ))}
          </span>
        ) : undefined
      }
      flush
    >
      {bookings.some((b) => b.status === 'queued') && (
        <div style={{ padding: '10px 14px 0' }}>
          <Note tone="warn" icon="clock">
            {t('trips_bk_queuedNote')} · <Link to="/integrations">{t('trips_bk_monitor')}</Link>
          </Note>
        </div>
      )}
      <DataTable<TripBooking>
        rows={bookings}
        rowKey={(b) => b.id}
        emptyText={t('trips_bk_empty')}
        columns={[
          { header: t('type'), render: (b) => <>{t(tk('trips_bk_kind_', b.kind))}<div className="sub">{b.transportClass ? t(tk('trips_class_', b.transportClass)) : b.nights ? `${b.nights} ${t('trips_nights').toLowerCase()}` : ''}</div></> },
          { header: t('trips_bk_offer'), render: (b) => <>{b.title}<div className="sub">{b.details} · {b.provider}</div>{b.justification && <div className="sub">{t('trips_bk_justification')}: {b.justification}</div>}</> },
          { header: t('trips_bk_document'), render: (b) => (b.pnr ? <><span className="doc-num">{b.documentNo}</span><div className="sub">PNR {b.pnr}</div></> : '—') },
          {
            header: t('trips_bk_price'),
            align: 'right',
            render: (b) => (
              <>
                <span className="num">{formatMoney(b.price)}</span>
                {b.issues.length > 0 && <div><Badge tone="warn">{t(tk('trips_bk_issue_', b.issues[0]!))}</Badge></div>}
                {b.status === 'cancelled' && <div className="sub">{t('trips_bk_refund')} {formatMoney(b.refundAmount ?? 0)} · {t('trips_bk_penalty')} {formatMoney(b.penalty ?? 0)}</div>}
              </>
            ),
          },
          { header: t('status'), render: (b) => <><StatusBadge prefix="trips_bk_status_" status={b.status} tone={STATUS_TONE[b.status]} /><div className="sub num">{formatDateTime(b.cancelledAt ?? b.confirmedAt ?? b.createdAt)}</div></> },
          {
            header: '',
            render: (b) => (
              <span className="trv-bk-actions">
                {b.status === 'confirmed' && <PrintButton doc={() => ticketPrint(b)} label={t('trips_bk_ticketPrint')} />}
                {b.status === 'confirmed' && canCancel && <Button size="small" danger disabled={busy} onClick={() => setCancel(b)}>{t('trips_bk_cancel')}</Button>}
                {(b.status === 'failed' || b.status === 'queued') && allowed && <Button size="small" disabled={busy} onClick={() => run(() => tripsApi.retryBooking(trip.id, b.id, user))}>{t('trips_bk_retry')}</Button>}
              </span>
            ),
          },
        ]}
      />
      <dl className="kv trv-bk-total">
        <dt>{t('trips_bk_planAdvance')}</dt>
        <dd className="num">{formatMoney(trip.advance)}</dd>
        <dt>{t('trips_bk_booked')}</dt>
        <dd className="num">{formatMoney(c.booked)}</dd>
        <dt>{t('trips_bk_committed')}</dt>
        <dd className="num"><b>{formatMoney(c.total)}</b>{c.penalties ? <span className="muted small"> · {t('trips_bk_penalty')} {formatMoney(c.penalties)}</span> : null}</dd>
        {trip.budget?.reserved !== undefined && (
          <>
            <dt>{t('trips_bk_reserve')}</dt>
            <dd className="num">{formatMoney(trip.budget.reserved)}</dd>
          </>
        )}
      </dl>
      {search && <SearchModal trip={trip} kind={search} onClose={() => setSearch(null)} />}
      {cancel && <CancelModal trip={trip} booking={cancel} onClose={() => setCancel(null)} onDone={() => setCancel(null)} run={run} busy={busy} ok={ok} />}
    </Card>
  );
}

function SearchModal({ trip, kind, onClose }: { trip: TripRequest; kind: TripBookingKind; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [offers, setOffers] = useState<TripBookingOffer[] | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<TripBookingOffer | null>(null);
  const [why, setWhy] = useState('');
  useEffect(() => {
    let alive = true;
    tripsApi.searchOffers(trip.id, kind, user).then(
      (list) => alive && setOffers(list),
      (e: unknown) => {
        if (!alive) return;
        const raw = e instanceof Error ? e.message : '';
        setError(/^trips_err_/.test(raw) ? t(raw as Parameters<typeof t>[0]) : t('actionFailed'));
        setOffers([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [trip.id, kind, user.id]);
  const book = async () => {
    if (!picked) return;
    if (await run(() => tripsApi.book(trip.id, picked.id, user, why), `${trip.number}: ${t('trips_bk_booked_ok')}`)) onClose();
  };
  return (
    <Modal
      title={`${t(tk('trips_bk_search_', kind))} · ${trip.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} disabled={!picked || picked.issues.includes('class_not_allowed') || picked.budget === 'blocked'} onClick={book}>{t('trips_bk_book')}</Button>
        </>
      }
    >
      {offers === null ? (
        <Loading />
      ) : error ? (
        <Note tone="danger" icon="alert">{error}</Note>
      ) : !offers.length ? (
        <Empty text={t('trips_bk_noOffers')} />
      ) : (
        <div className="trv-bk-offers">
          {offers.some((o) => o.stale) && <Note tone="warn" icon="clock">{t('trips_bk_staleNote')}</Note>}
          {offers.map((o) => {
            const blocked = o.issues.includes('class_not_allowed') || o.budget === 'blocked';
            return (
              <div key={o.id} className={`trv-bk-offer${picked?.id === o.id ? ' selected' : ''}${blocked ? ' blocked' : ''}`} data-offer={o.id}>
                <Checkbox checked={picked?.id === o.id} disabled={blocked} onChange={(v) => setPicked(v ? o : null)} />
                <div className="trv-bk-offer-main">
                  <div className="trv-bk-offer-title">{o.title}</div>
                  <div className="sub">{o.details} · {o.provider}{o.transportClass ? ` · ${t(tk('trips_class_', o.transportClass))}` : ''}{o.nights ? ` · ${o.nights} × ${formatMoney(o.unitPrice)}` : ''}</div>
                  <div className="trv-bk-badges">
                    {o.issues.length ? o.issues.map((i) => <Badge key={i} tone={i === 'class_not_allowed' ? 'danger' : 'warn'}>{t(tk('trips_bk_issue_', i))}</Badge>) : <Badge tone="ok">{t('trips_bk_withinNorm')}</Badge>}
                    <Badge tone={o.budget === 'ok' ? 'muted' : o.budget === 'topup' ? 'info' : 'danger'}>{t(tk('trips_bk_budget_', o.budget))}{o.topUp ? ` ${formatMoney(o.topUp)}` : ''}</Badge>
                    <span className="sub">{o.refundable ? `${t('trips_bk_refundable')} ${o.penaltyPct}%` : t('trips_bk_nonRefundable')}</span>
                  </div>
                </div>
                <div className="trv-bk-offer-price">
                  <b className="num">{formatMoney(o.price)}</b>
                  <div className="sub">{t('trips_bk_norm')}: {formatMoney(o.norm)}{kind === 'hotel' ? ` / ${t('trips_perDay').replace(/^в /, '')}` : ''}</div>
                  <div className="sub">{t('trips_bk_after')}: {formatMoney(o.committedAfter)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {picked && picked.issues.length > 0 && !picked.issues.includes('class_not_allowed') && (
        <Field label={t('trips_bk_justify')} required hint={t('trips_bk_justifyHint')}>
          <Textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} ariaLabel={t('trips_bk_justify')} />
        </Field>
      )}
    </Modal>
  );
}

function CancelModal({ trip, booking, onClose, onDone, run, busy, ok }: { trip: TripRequest; booking: TripBooking; onClose: () => void; onDone: () => void; run: ReturnType<typeof useAction>['run']; busy: boolean; ok: (m: string) => string }) {
  const { t } = useSession();
  const user = useUser();
  const [reason, setReason] = useState('');
  const penalty = booking.refundable ? Math.round((booking.price * booking.penaltyPct) / 100) : booking.price;
  return (
    <Modal
      title={`${t('trips_bk_cancel')}: ${booking.pnr ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button danger loading={busy} onClick={async () => { if (await run(() => tripsApi.cancelBooking(trip.id, booking.id, user, reason), ok(t('trips_bk_cancelled_ok')))) onDone(); }}>{t('trips_bk_cancel')}</Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{booking.title} · {booking.details}</p>
      <dl className="kv">
        <dt>{t('trips_bk_price')}</dt>
        <dd className="num">{formatMoney(booking.price)}</dd>
        <dt>{t('trips_bk_penalty')}</dt>
        <dd className="num">{formatMoney(penalty)}</dd>
        <dt>{t('trips_bk_refund')}</dt>
        <dd className="num">{formatMoney(booking.price - penalty)}</dd>
      </dl>
      <Field label={t('trips_bk_cancelReason')} required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} ariaLabel={t('trips_bk_cancelReason')} />
      </Field>
    </Modal>
  );
}
