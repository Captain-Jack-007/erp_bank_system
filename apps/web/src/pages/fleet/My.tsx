// Самообслуживание водителя (роль «водитель», веб): мой автомобиль, мои путевые листы (открыть / закрыть),
// заправка с фото чека, сообщение о неисправности с фото, история поездок, уведомления (PR-FLT-102…110, web-часть).
import { useState } from 'react';
import { fleetApi, fleetDriverOf, formatDate, formatNumber, tk, type FleetFaultReport, type FleetFuelUp, type FleetVehicleView } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Loading, PageHeader, StatusBadge } from '../../components/ui';
import { Attachments } from '../../components/Attachments';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { dec, DueDate, FLEET_TONE, FleetNav, Plate, TRIP_TONE } from './shared';
import { CloseTripModal, FaultModal, FuelUpModal, OpenTripModal } from './tripForms';

export function MyFleetPage() {
  const { t } = useSession();
  const user = useUser();
  const me = fleetDriverOf(user);
  const vehicles = useApi(() => (me ? fleetApi.driverVehicles(me.id) : Promise.resolve([] as FleetVehicleView[])), [me?.id]);
  const trips = useApi(() => (me ? fleetApi.listTrips({ driverId: me.id }) : Promise.resolve([])), [me?.id]);
  const faults = useApi(() => (me ? fleetApi.listFaults({ driverId: me.id }) : Promise.resolve([])), [me?.id]);
  const fuel = useApi(() => (me ? fleetApi.listFuelUps({ driverId: me.id }) : Promise.resolve([])), [me?.id]);
  const docs = useApi(() => fleetApi.listDocuments(), []);
  const [modal, setModal] = useState<{ kind: 'open' | 'close' | 'fuel' | 'fault'; v: FleetVehicleView } | null>(null);
  const [lastFuel, setLastFuel] = useState<FleetFuelUp['id'] | null>(null);
  const [lastFault, setLastFault] = useState<FleetFaultReport | null>(null);

  if (!me) {
    return (
      <>
        <PageHeader title={t('fleet_nav_my')} />
        <Card><Empty text={t('fleet_notDriver')} icon="user" /></Card>
      </>
    );
  }
  const openTrip = (trips.data ?? []).find((x) => x.status === 'open');
  const pending = (trips.data ?? []).filter((x) => x.status === 'pending' || x.status === 'returned');
  return (
    <>
      <PageHeader title={t('fleet_nav_my')} subtitle={`${me.fullName} · ${me.personnelNo} · ${me.licenseNo} (${me.licenseCategories.join(', ')})`} />
      <FleetNav active="my" />
      <div className="flt-row" style={{ gap: 16 }}>
        <Badge tone="info">{t('fleet_licenseUntil')}: {formatDate(me.licenseUntil)}</Badge>
        <Badge tone={me.medicalUntil < new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) ? 'warn' : 'info'}>{t('fleet_medicalUntil')}: {formatDate(me.medicalUntil)}</Badge>
      </div>
      {vehicles.loading && !vehicles.data ? <Card><Loading /></Card> : !vehicles.data?.length ? <Card><Empty text={t('fleet_noVehicles')} icon="car" /></Card> : (
        <div className="flt-my">
          {vehicles.data.map((v) => {
            const vt = openTrip?.vehicleId === v.id ? openTrip : undefined;
            const vdocs = (docs.data ?? []).filter((d) => d.vehicleId === v.id && d.status === 'active' && d.type !== 'tech_passport');
            return (
              <Card key={v.id} title={<span><Plate value={v.plate} /> {v.brand} {v.model}</span>} actions={<StatusBadge prefix="fleet_status_" status={v.status} tone={FLEET_TONE[v.status]} />}>
                <dl className="kv" style={{ gridTemplateColumns: '140px 1fr' }}>
                  <dt>{t('fleet_assignRole')}</dt><dd>{t(v.primaryDriverId === me.id ? 'fleet_role_primary' : 'fleet_role_reserve')}</dd>
                  <dt>{t('fleet_mileage')}</dt><dd className="num">{formatNumber(v.mileage)}</dd>
                  <dt>{t('fleet_norm')}</dt><dd>{dec(v.fuelNorm)} · {t(tk('fleet_fuel_', v.fuel))}</dd>
                  <dt>{t('fleet_nextService')}</dt><dd>{formatNumber(v.nextServiceKm)} km · {formatDate(v.nextServiceDate)}</dd>
                  {vdocs.map((d) => (<span key={d.id} style={{ display: 'contents' }}><dt>{t(tk('fleet_doc_', d.type))}</dt><dd><DueDate value={d.validUntil} /></dd></span>))}
                </dl>
                <div className="flt-row" style={{ marginTop: 12 }}>
                  {vt ? (
                    <>
                      <Button type="primary" onClick={() => setModal({ kind: 'close', v })}>{t('fleet_closeTrip')} {vt.number}</Button>
                      <Button onClick={() => navigate(`/fleet/trips/${vt.id}`)}>{t('fleet_openTripCard')}</Button>
                    </>
                  ) : (
                    <Button type="primary" icon="plus" disabled={v.status !== 'in_operation' || pending.some((p) => p.vehicleId === v.id)} onClick={() => setModal({ kind: 'open', v })}>{t('fleet_openTrip')}</Button>
                  )}
                  <Button icon="plus" onClick={() => setModal({ kind: 'fuel', v })}>{t('fleet_addFuel')}</Button>
                  <Button icon="alert" onClick={() => setModal({ kind: 'fault', v })}>{t('fleet_reportFault')}</Button>
                </div>
                {vt && <p className="flt-hint" style={{ marginTop: 10 }}>{t('fleet_odoPhotoHint')} <Link to={`/fleet/trips/${vt.id}`}>{vt.number}</Link></p>}
              </Card>
            );
          })}
        </div>
      )}
      {lastFuel && <Attachments entity="fleet_fuel" entityId={lastFuel} title={t('fleet_receiptPhoto')} />}
      {lastFault && <Attachments entity="fleet_fault" entityId={lastFault.id} title={`${t('fleet_faultPhoto')} · ${lastFault.number}`} />}
      {pending.length > 0 && (
        <Card title={t('fleet_myPending')} flush>
          {pending.map((x) => (
            <div key={x.id} className="flt-list-item">
              <div className="flt-li-main"><Link to={`/fleet/trips/${x.id}`} className="doc-num">{x.number}</Link> · {x.routeFrom} → {x.routeTo}<div className="flt-li-sub">{formatDate(x.date)} {x.departTime}</div></div>
              <StatusBadge prefix="fleet_tstatus_" status={x.status} tone={TRIP_TONE[x.status]} />
            </div>
          ))}
        </Card>
      )}
      <Card title={t('fleet_myTrips')} flush>
        <DataTable rows={trips.data} loading={trips.loading} rowKey={(x) => x.id} onRowClick={(x) => navigate(`/fleet/trips/${x.id}`)} columns={[
          { header: t('fleet_tripNo'), render: (x) => <span className="doc-num">{x.number}</span> },
          { header: t('date'), render: (x) => formatDate(x.date) },
          { header: t('fleet_route'), render: (x) => `${x.routeFrom} → ${x.routeTo}` },
          { header: t('fleet_distance'), align: 'right', render: (x) => (x.odoEnd ? formatNumber(x.odoEnd - x.odoStart) : '—') },
          { header: t('fleet_fuelUsed'), align: 'right', render: (x) => dec(x.fuelUsed) },
          { header: t('status'), render: (x) => <StatusBadge prefix="fleet_tstatus_" status={x.status} tone={TRIP_TONE[x.status]} /> },
        ]} />
      </Card>
      <div className="grid grid-2">
        <Card title={t('fleet_myFuel')} flush>
          <DataTable rows={fuel.data} loading={fuel.loading} rowKey={(f) => f.id} columns={[
            { header: '№', render: (f) => <span className="doc-num">{f.number}</span> },
            { header: t('date'), render: (f) => formatDate(f.date) },
            { header: t('fleet_litres'), align: 'right', render: (f) => dec(f.litres) },
            { header: t('amount'), align: 'right', render: (f) => formatNumber(f.amount) },
            { header: '', render: (f) => <Button size="small" type="text" icon="paperclip" title={t('fleet_receiptPhoto')} onClick={() => setLastFuel(f.id)} /> },
          ]} />
        </Card>
        <Card title={t('fleet_myFaults')} flush>
          <DataTable rows={faults.data} loading={faults.loading} rowKey={(f) => f.id} emptyText={t('fleet_noFaults')} columns={[
            { header: '№', render: (f) => <span className="doc-num">{f.number}</span> },
            { header: t('date'), render: (f) => formatDate(f.date) },
            { header: t('description'), render: (f) => f.description },
            { header: t('status'), render: (f) => <Badge tone={f.status === 'closed' ? 'ok' : 'warn'}>{t(tk('fleet_fstatus_', f.status))}</Badge> },
            { header: '', render: (f) => <Button size="small" type="text" icon="paperclip" title={t('fleet_faultPhoto')} onClick={() => setLastFault(f)} /> },
          ]} />
        </Card>
      </div>
      {modal?.kind === 'open' && <OpenTripModal vehicleId={modal.v.id} onClose={() => setModal(null)} />}
      {modal?.kind === 'close' && openTrip && <CloseTripModal trip={openTrip} vehicle={modal.v} onClose={() => setModal(null)} />}
      {modal?.kind === 'fuel' && <FuelUpModal vehicle={modal.v} onClose={() => setModal(null)} onSaved={(id) => setLastFuel(id)} />}
      {modal?.kind === 'fault' && <FaultModal vehicle={modal.v} onClose={() => setModal(null)} onSaved={(f) => setLastFault(f)} />}
    </>
  );
}
