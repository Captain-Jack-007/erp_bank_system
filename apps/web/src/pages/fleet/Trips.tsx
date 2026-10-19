// Путевые листы: журнал с фильтрами и анализом использования (PR-FLT-098…101), карточка путевого листа
// (подпись диспетчера через маршрут согласования, закрытие, заправки в пути, фото одометра, подписи E-IMZO, печать).
import { useMemo, useState } from 'react';
import {
  api, fleetApi, fleetCanManage, fleetDeviationPct, fleetDriverOf, fleetTripSignContent, formatDate, formatDateTime, formatNumber, signatureService, tk, today,
  type FleetTrip, type FleetTripStatus, type PrintDocument, type SignatureRecord,
} from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, FilterBar, Input, Loading, PageHeader, RouteSteps, Select, Stat, StatusBadge, Timeline, useToast, type Column } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { SignModal, SignatureBadge } from '../../components/SignModal';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { dec, FleetNav, Plate, TRIP_TONE, useFleetErr, FleetTaskBox } from './shared';
import { CloseTripModal, FuelUpModal, OpenTripModal } from './tripForms';

const STATUSES: FleetTripStatus[] = ['pending', 'returned', 'open', 'closed', 'rejected', 'cancelled'];

/** Таблица путевых листов (общая для журнала, карточки ТС и водителя). */
export function TripsTable({ vehicleId, driverId, rows: given }: { vehicleId?: string; driverId?: string; rows?: FleetTrip[] }) {
  const { t } = useSession();
  const trips = useApi(() => (given ? Promise.resolve(given) : fleetApi.listTrips({ ...(vehicleId ? { vehicleId } : {}), ...(driverId ? { driverId } : {}) })), [vehicleId, driverId, given]);
  const vehicles = useApi(() => fleetApi.list(), []);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const v = (id: string) => vehicles.data?.find((x) => x.id === id);
  const columns: Column<FleetTrip>[] = [
    { header: t('fleet_tripNo'), render: (x) => <Link to={`/fleet/trips/${x.id}`} className="doc-num">{x.number}</Link> },
    { header: t('date'), render: (x) => (<><span className="num">{formatDate(x.date)}</span><div className="sub">{x.departTime}–{x.returnTime}</div></>) },
    ...(vehicleId ? [] : [{ header: t('fleet_plate'), render: (x: FleetTrip) => <Link to={`/fleet/${x.vehicleId}`}>{v(x.vehicleId)?.plate}</Link> }]),
    ...(driverId ? [] : [{ header: t('fleet_driver'), render: (x: FleetTrip) => drivers.data?.find((d) => d.id === x.driverId)?.fullName ?? '—' }]),
    { header: t('fleet_route'), render: (x) => (<>{x.routeFrom} → {x.routeTo}<div className="sub">{x.purpose}{x.waypoints ? ` · ${x.waypoints}` : ''}</div></>) },
    { header: t('fleet_distance'), align: 'right', render: (x) => (x.odoEnd ? formatNumber(x.odoEnd - x.odoStart) : '—') },
    { header: t('fleet_fuelUsed'), align: 'right', render: (x) => dec(x.fuelUsed) },
    {
      header: t('fleet_deviation'),
      align: 'right',
      render: (x) => {
        if (!x.fuelUsed || !x.fuelNormUsed) return '—';
        const d = fleetDeviationPct(x.fuelUsed, x.fuelNormUsed);
        return <b className={d > 10 ? 'flt-over' : d < 0 ? 'flt-save' : ''}>{d > 0 ? '+' : ''}{dec(d)}%</b>;
      },
    },
    { header: t('status'), render: (x) => <StatusBadge prefix="fleet_tstatus_" status={x.status} tone={TRIP_TONE[x.status]} /> },
  ];
  return <DataTable rows={trips.data} loading={trips.loading} rowKey={(x) => x.id} columns={columns} onRowClick={(x) => navigate(`/fleet/trips/${x.id}`)} />;
}

/** Журнал путевых листов: фильтры по ТС, водителю, периоду; анализ использования. */
export function TripsJournalPage() {
  const { t } = useSession();
  const user = useUser();
  const canManage = fleetCanManage(user);
  const me = fleetDriverOf(user);
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [status, setStatus] = useState<FleetTripStatus | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const vehicles = useApi(() => fleetApi.list({ kind: 'vehicle' }), []);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const trips = useApi(() => fleetApi.listTrips({ ...(vehicleId ? { vehicleId } : {}), ...(driverId ? { driverId } : {}), ...(status ? { status } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), search }), [vehicleId, driverId, status, from, to, search]);
  const rows = trips.data ?? [];
  const closed = rows.filter((x) => x.status === 'closed');
  const km = closed.reduce((a, x) => a + ((x.odoEnd ?? x.odoStart) - x.odoStart), 0);
  const used = closed.reduce((a, x) => a + (x.fuelUsed ?? 0), 0);
  const norm = closed.reduce((a, x) => a + (x.fuelNormUsed ?? 0), 0);
  const effFrom = from || closed.reduce((m, x) => (x.date < m ? x.date : m), today());
  const effTo = to || today();
  const days = effTo >= effFrom ? Math.round((Date.parse(effTo) - Date.parse(effFrom)) / 86_400_000) + 1 : 0;
  const fleetSize = (vehicles.data ?? []).filter((v) => v.status !== 'written_off').length;
  const usedVehicles = new Set(closed.map((x) => x.vehicleId)).size;
  const vehicleDays = new Set(closed.map((x) => `${x.vehicleId}:${x.date}`)).size;
  const util = days && fleetSize ? Math.round((vehicleDays / (days * (vehicleId ? 1 : fleetSize))) * 1000) / 10 : 0;
  const vname = (id: string) => vehicles.data?.find((v) => v.id === id)?.plate ?? id;
  const dname = (id: string) => drivers.data?.find((d) => d.id === id)?.fullName ?? id;

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_trips') }]}
        title={t('fleet_tripsJournal')}
        subtitle={t('fleet_tripsJournalSub')}
        actions={
          <>
            <ExportButton<FleetTrip>
              filename={t('fleet_tripsJournal')}
              title={`${t('fleet_tripsJournal')} ${from ? formatDate(from) : ''}–${to ? formatDate(to) : ''}`}
              rows={rows}
              columns={[
                { header: t('fleet_tripNo'), value: (x) => x.number, width: 16 },
                { header: t('date'), value: (x) => x.date, format: 'date' },
                { header: t('fleet_departTime'), value: (x) => x.departTime },
                { header: t('fleet_returnTime'), value: (x) => `${x.returnDate} ${x.returnTime}` },
                { header: t('fleet_plate'), value: (x) => vname(x.vehicleId) },
                { header: t('fleet_driver'), value: (x) => dname(x.driverId), width: 22 },
                { header: t('fleet_routeFrom'), value: (x) => x.routeFrom, width: 24 },
                { header: t('fleet_routeTo'), value: (x) => x.routeTo, width: 24 },
                { header: t('fleet_tripPurpose'), value: (x) => x.purpose, width: 24 },
                { header: t('fleet_odoStart'), value: (x) => x.odoStart, format: 'integer' },
                { header: t('fleet_odoEnd'), value: (x) => x.odoEnd ?? null, format: 'integer' },
                { header: t('fleet_distance'), value: (x) => (x.odoEnd ? x.odoEnd - x.odoStart : 0), format: 'integer', total: true },
                { header: t('fleet_fuelUsed'), value: (x) => x.fuelUsed ?? 0, format: 'number', total: true },
                { header: t('fleet_normUsed'), value: (x) => x.fuelNormUsed ?? 0, format: 'number', total: true },
                { header: t('status'), value: (x) => t(tk('fleet_tstatus_', x.status)) },
              ]}
            />
            {(canManage || me) && <Button type="primary" icon="plus" onClick={() => setOpen(true)}>{t('fleet_openTrip')}</Button>}
          </>
        }
      />
      <FleetNav active="trips" />
      <div className="flt-kpis">
        <Stat label={t('fleet_tripsCount')} value={rows.length} icon="route" foot={`${t('fleet_tstatus_closed')}: ${closed.length} · ${t('fleet_tstatus_open')}: ${rows.filter((x) => x.status === 'open').length}`} />
        <Stat label={t('fleet_kmPeriod')} value={formatNumber(km)} icon="chart" foot={`${t('fleet_avgTrip')}: ${closed.length ? formatNumber(Math.round(km / closed.length)) : 0}`} />
        <Stat label={t('fleet_fuelVsNorm')} value={`${dec(used)} / ${dec(norm)}`} icon="wallet" tone={used > norm * 1.1 ? 'alert' : undefined} foot={`${t('fleet_deviation')}: ${norm ? `${used > norm ? '+' : ''}${dec(fleetDeviationPct(used, norm))}%` : '—'}`} />
        <Stat label={t('fleet_utilization')} value={`${dec(util)}%`} icon="car" foot={`${t('fleet_vehiclesUsed')}: ${usedVehicles} / ${vehicleId ? 1 : fleetSize} · ${t('fleet_days')}: ${days}`} />
      </div>
      <Card flush>
        <FilterBar>
          <Input placeholder={`${t('search')}: №, ${t('fleet_route').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} ariaLabel={t('search')} />
          <Select<string> value={vehicleId} placeholder={`${t('fleet_plate')}: ${t('all')}`} ariaLabel={t('fleet_plate')} onChange={setVehicleId} options={(vehicles.data ?? []).map((v) => ({ value: v.id, label: v.plate }))} />
          <Select<string> value={driverId} placeholder={`${t('fleet_driver')}: ${t('all')}`} ariaLabel={t('fleet_driver')} onChange={setDriverId} options={(drivers.data ?? []).map((d) => ({ value: d.id, label: d.fullName }))} />
          <Select<FleetTripStatus> value={status} placeholder={`${t('status')}: ${t('all')}`} ariaLabel={t('status')} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(tk('fleet_tstatus_', s)) }))} />
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={t('fleet_from')} style={{ width: 160 }} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={t('fleet_to')} style={{ width: 160 }} />
          <Button size="small" onClick={() => { setFrom(''); setTo(''); }}>{t('fleet_allPeriod')}</Button>
        </FilterBar>
        <TripsTable rows={rows} />
      </Card>
      {open && <OpenTripModal onClose={() => setOpen(false)} onSaved={(id) => navigate(`/fleet/trips/${id}`)} />}
    </>
  );
}

function SignRow({ role, rec, content, canSign, onSign }: { role: string; rec?: SignatureRecord; content: unknown; canSign: boolean; onSign: () => void }) {
  const { t } = useSession();
  return (
    <div className="flt-sig">
      <span className="flt-sig-role">{role}</span>
      {rec ? (
        <>
          <span>{rec.owner}</span>
          <SignatureBadge record={rec} content={content} />
          <span className="muted small">{formatDateTime(rec.signedAt)}</span>
        </>
      ) : (
        <span className="muted">{t('fleet_notSigned')}</span>
      )}
      {!rec && canSign && <Button size="small" type="primary" icon="pen" onClick={onSign}>{t('svc_signButton')}</Button>}
    </div>
  );
}

/** Карточка путевого листа. */
export function TripDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const canManage = fleetCanManage(user);
  const me = fleetDriverOf(user);
  const trip = useApi(() => fleetApi.getTrip(id), [id]);
  const tr = trip.data;
  const vehicle = useApi(() => (tr ? fleetApi.get(tr.vehicleId) : Promise.resolve(undefined)), [tr?.vehicleId]);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const fuel = useApi(() => fleetApi.listFuelUps({ tripId: id }), [id]);
  const users = useApi(() => api.listUsers(), []);
  const sigs = useApi(() => signatureService.list('fleet_trip', id), [id]);
  const [close, setClose] = useState(false);
  const [edit, setEdit] = useState(false);
  const [fuelUp, setFuelUp] = useState(false);
  const [sign, setSign] = useState<'driver' | 'responsible' | null>(null);
  const content = useMemo(() => (tr ? fleetTripSignContent(tr) : null), [tr]);

  if (trip.loading && !tr) return <Card><Loading /></Card>;
  if (!tr) return <Card><Empty text={t('empty')} /></Card>;
  const v = vehicle.data;
  const driver = drivers.data?.find((d) => d.id === tr.driverId);
  const isDriver = !!me && me.id === tr.driverId;
  if (!canManage && !isDriver && !canViewTrip(user)) return <Card><Empty text={t('noAccess')} icon="alert" /></Card>;
  const uname = (uid?: string) => users.data?.find((u) => u.id === uid)?.fullName ?? '';
  const signDriver = sigs.data?.find((s) => driver?.userId && s.userId === driver.userId);
  const signResp = sigs.data?.find((s) => s.userId !== driver?.userId);
  const km = tr.odoEnd ? tr.odoEnd - tr.odoStart : 0;
  const dev = tr.fuelUsed && tr.fuelNormUsed ? fleetDeviationPct(tr.fuelUsed, tr.fuelNormUsed) : undefined;

  async function cancel() {
    try {
      await fleetApi.cancelTrip(id, user);
      toast(`${tr!.number}: ${t('fleet_tstatus_cancelled')}`);
    } catch (e) {
      toast(err(e));
    }
  }

  const printDoc = (): PrintDocument => ({
    entity: 'fleet_trip',
    entityId: tr.id,
    title: t('fleet_tripPrintTitle'),
    number: tr.number,
    date: tr.date,
    fields: [
      { label: t('fleet_plate'), value: `${v?.plate ?? ''} · ${v?.brand ?? ''} ${v?.model ?? ''}` },
      { label: t('fleet_driver'), value: `${driver?.fullName ?? ''} · ${driver?.licenseNo ?? ''}` },
      { label: t('fleet_departDate'), value: `${formatDate(tr.date)} ${tr.departTime}` },
      { label: t('fleet_returnDate'), value: `${formatDate(tr.returnDate)} ${tr.returnTime}` },
      { label: t('fleet_route'), value: `${tr.routeFrom} → ${tr.routeTo}${tr.waypoints ? ` (${tr.waypoints})` : ''}` },
      { label: t('fleet_tripPurpose'), value: tr.purpose },
      { label: t('status'), value: t(tk('fleet_tstatus_', tr.status)) },
    ],
    table: {
      columns: [{ header: t('fleet_indicator') }, { header: t('fleet_atDeparture'), align: 'right' }, { header: t('fleet_atReturn'), align: 'right' }, { header: t('fleet_result'), align: 'right' }],
      rows: [
        [t('fleet_odometer'), formatNumber(tr.odoStart), tr.odoEnd ? formatNumber(tr.odoEnd) : '—', km ? `${formatNumber(km)} km` : '—'],
        [t('fleet_fuelRemain'), dec(tr.fuelStart), dec(tr.fuelEnd), tr.fuelUsed !== undefined ? `${dec(tr.fuelUsed)} ${t('fleet_l')}` : '—'],
        [t('fleet_normUsed'), '', '', dec(tr.fuelNormUsed)],
      ],
    },
    signers: [
      { role: t('fleet_dispatcher'), name: uname(tr.dispatcherId) || '—', position: tr.dispatchedAt ? formatDateTime(tr.dispatchedAt) : '' },
      { role: t('fleet_driver'), name: driver?.fullName ?? '', ...(signDriver ? { signatureId: signDriver.id } : {}) },
      { role: t('fleet_responsible'), name: signResp?.owner ?? uname(tr.closedBy), ...(signResp ? { signatureId: signResp.id } : {}) },
    ],
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_trips'), to: '/fleet/trips' }, { label: tr.number }]}
        title={`${tr.number} · ${tr.routeFrom} → ${tr.routeTo}`}
        subtitle={`${v?.plate ?? ''} · ${driver?.fullName ?? ''} · ${formatDate(tr.date)} ${tr.departTime}`}
        actions={
          <>
            <StatusBadge prefix="fleet_tstatus_" status={tr.status} tone={TRIP_TONE[tr.status]} />
            {tr.status === 'open' && (canManage || isDriver) && v && <Button onClick={() => setFuelUp(true)} icon="plus">{t('fleet_addFuel')}</Button>}
            {tr.status === 'open' && (canManage || isDriver) && <Button type="primary" onClick={() => setClose(true)}>{t('fleet_closeTrip')}</Button>}
            {(tr.status === 'returned' || tr.status === 'rejected') && (canManage || tr.createdBy === user.id) && <Button type="primary" onClick={() => setEdit(true)}>{t('fleet_editResubmit')}</Button>}
            {(tr.status === 'returned' || tr.status === 'rejected') && (canManage || tr.createdBy === user.id) && <Button onClick={cancel}>{t('fleet_cancelTrip')}</Button>}
            <PrintButton doc={printDoc} template="card" />
          </>
        }
      />
      <FleetTaskBox entityId={id} />
      <div className="grid grid-main">
        <div className="flt-stack">
          <Card title={t('details')}>
            <dl className="kv">
              <dt>{t('fleet_plate')}</dt><dd>{v ? <Link to={`/fleet/${v.id}`}><Plate value={v.plate} /></Link> : '—'} {v ? `${v.brand} ${v.model}` : ''}</dd>
              <dt>{t('fleet_driver')}</dt><dd>{driver ? <Link to={`/fleet/drivers/${driver.id}`}>{driver.fullName}</Link> : '—'}</dd>
              <dt>{t('fleet_departDate')}</dt><dd className="num">{formatDate(tr.date)} {tr.departTime}</dd>
              <dt>{t('fleet_returnDate')}</dt><dd className="num">{formatDate(tr.returnDate)} {tr.returnTime}</dd>
              <dt>{t('fleet_routeFrom')}</dt><dd>{tr.routeFrom}</dd>
              <dt>{t('fleet_routeTo')}</dt><dd>{tr.routeTo}</dd>
              {tr.waypoints && (<><dt>{t('fleet_waypoints')}</dt><dd>{tr.waypoints}</dd></>)}
              <dt>{t('fleet_tripPurpose')}</dt><dd>{tr.purpose}</dd>
              <dt>{t('fleet_cityTrip')}</dt><dd>{tr.city ? t('svc_yes') : t('svc_no')}</dd>
              <dt>{t('fleet_dispatcher')}</dt><dd>{tr.dispatcherId ? `${uname(tr.dispatcherId)} · ${formatDateTime(tr.dispatchedAt!)}` : <span className="muted">{t('fleet_waitDispatcher')}</span>}</dd>
            </dl>
          </Card>
          <Card title={t('fleet_odoFuel')}>
            <div className="flt-calc" style={{ margin: 0 }}>
              <div><span>{t('fleet_odoStart')}</span><b>{formatNumber(tr.odoStart)}</b></div>
              <div><span>{t('fleet_odoEnd')}</span><b>{tr.odoEnd ? formatNumber(tr.odoEnd) : '—'}</b></div>
              <div><span>{t('fleet_distance')}</span><b>{km ? formatNumber(km) : '—'}</b></div>
              <div><span>{t('fleet_fuelStart')}</span><b>{dec(tr.fuelStart)}</b></div>
              <div><span>{t('fleet_refuelled')}</span><b>{dec((fuel.data ?? []).reduce((a, f) => a + f.litres, 0))}</b></div>
              <div><span>{t('fleet_fuelEnd')}</span><b>{dec(tr.fuelEnd)}</b></div>
              <div><span>{t('fleet_fuelUsed')}</span><b>{dec(tr.fuelUsed)}</b></div>
              <div><span>{t('fleet_normUsed')}</span><b>{dec(tr.fuelNormUsed)}</b></div>
              {dev !== undefined && <div><span>{t('fleet_deviation')}</span><b className={dev > 10 ? 'flt-over' : dev < 0 ? 'flt-save' : ''}>{dev > 0 ? '+' : ''}{dec(dev)}%</b></div>}
            </div>
            {tr.overrunReason && <p className="flt-hint" style={{ marginTop: 10 }}>{t('fleet_overrunReason')}: {tr.overrunReason}</p>}
          </Card>
          <Card title={t('fleet_tripFuelUps')} flush>
            <DataTable
              rows={fuel.data}
              loading={fuel.loading}
              rowKey={(f) => f.id}
              emptyText={t('fleet_noFuelUps')}
              columns={[
                { header: '№', render: (f) => <span className="doc-num">{f.number}</span> },
                { header: t('date'), render: (f) => formatDate(f.date) },
                { header: t('fleet_station'), render: (f) => f.station },
                { header: t('fleet_litres'), align: 'right', render: (f) => dec(f.litres) },
                { header: t('amount'), align: 'right', render: (f) => formatNumber(f.amount) },
              ]}
            />
          </Card>
          <Attachments entity="fleet_trip_odo" entityId={tr.id} title={t('fleet_odoPhotos')} readOnly={!(canManage || isDriver) || tr.status === 'cancelled'} />
        </div>
        <div className="flt-stack">
          <Card title={t('fleet_dispatchRoute')}>
            <RouteSteps entityId={tr.id} />
            <p className="flt-hint" style={{ margin: '8px 0 0' }}>{tr.dispatcherId ? `${t('fleet_dispatcher')}: ${uname(tr.dispatcherId)} · ${formatDateTime(tr.dispatchedAt!)}` : t('fleet_waitDispatcher')}</p>
          </Card>
          {tr.status === 'closed' && content && (
            <Card title={t('fleet_signatures')}>
              <SignRow role={t('fleet_driverSignature')} rec={signDriver} content={content} canSign={isDriver && !!driver?.userId} onSign={() => setSign('driver')} />
              <SignRow role={t('fleet_responsibleSignature')} rec={signResp} content={content} canSign={canManage && user.id !== driver?.userId} onSign={() => setSign('responsible')} />
              {signDriver && signResp ? <Badge tone="ok">{t('fleet_fullySigned')}</Badge> : <p className="flt-hint" style={{ marginTop: 8 }}>{t('fleet_signHint')}</p>}
            </Card>
          )}
          <Card title={t('history')}>
            <Timeline events={tr.history} />
          </Card>
        </div>
      </div>
      {close && v && <CloseTripModal trip={tr} vehicle={v} onClose={() => setClose(false)} />}
      {edit && <OpenTripModal trip={tr} onClose={() => setEdit(false)} />}
      {fuelUp && v && <FuelUpModal vehicle={v} onClose={() => setFuelUp(false)} />}
      {sign && content && <SignModal doc={{ entity: 'fleet_trip', entityId: tr.id, title: `${t('fleet_tripPrintTitle')} ${tr.number}`, content }} onClose={() => setSign(null)} onSigned={() => sigs.reload()} />}
    </>
  );
}

/** Просмотр путевого листа доступен всем с правом на модуль (кроме самообслуживания водителя — только свои). */
function canViewTrip(user: ReturnType<typeof useUser>): boolean {
  return !fleetDriverOf(user) || fleetCanManage(user);
}
