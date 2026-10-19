// Путевой лист: открытие (на подпись диспетчеру) и закрытие; заправка; журнал работы генератора; неисправность.
import { useMemo, useState } from 'react';
import {
  currencyLabel, fleetApi, fleetCanManage, fleetDriverOf, fleetNormLitres, formatNumber, today, tk,
  type FleetFaultReport, type FleetFuel, type FleetTrip, type FleetTripInput, type FleetVehicleView, type FleetDriver,
} from '@xb/shared';
import { Button, Checkbox, Field, Input, Modal, RouteSteps, Select, Textarea, useToast } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { dec, useFleetErr } from './shared';

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

/** Открытие путевого листа (PR-FLT-085…092): ТС, водитель, дата/время, маршрут, цель, одометр и топливо при выезде. */
export function OpenTripModal({ vehicleId, trip, onClose, onSaved }: { vehicleId?: string; trip?: FleetTrip; onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const me = fleetDriverOf(user);
  const selfOnly = !!me && !fleetCanManage(user);
  const vehicles = useApi(() => fleetApi.list({ kind: 'vehicle', status: 'active' }), []);
  const drivers = useApi(() => fleetApi.listDrivers({ active: true }), []);
  // водитель видит только закреплённые за ним ТС
  const list = (vehicles.data ?? []).filter((v) => !selfOnly || v.primaryDriverId === me.id || v.reserveDriverId === me.id);
  const [vid, setVid] = useState(trip?.vehicleId ?? vehicleId ?? (selfOnly ? list[0]?.id ?? '' : ''));
  const v = list.find((x) => x.id === vid) ?? vehicles.data?.find((x) => x.id === vid);
  const [f, setF] = useState({
    driverId: trip?.driverId ?? '', date: trip?.date ?? today(), departTime: trip?.departTime ?? '09:00', returnDate: trip?.returnDate ?? today(), returnTime: trip?.returnTime ?? '18:00',
    routeFrom: trip?.routeFrom ?? '', routeTo: trip?.routeTo ?? '', waypoints: trip?.waypoints ?? '', purpose: trip?.purpose ?? '', odoStart: trip ? String(trip.odoStart) : '', fuelStart: trip ? String(trip.fuelStart) : '',
  });
  const [city, setCity] = useState(trip?.city ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (val: string) => {
    setF((x) => ({ ...x, [k]: val }));
    setError('');
  };
  const vehicleDrivers = (drivers.data ?? []).filter((d) => v && (d.id === v.primaryDriverId || d.id === v.reserveDriverId));
  const driverId = f.driverId || (selfOnly && me ? me.id : v?.primaryDriverId ?? '');
  const lastFuel = useApi(() => (vid ? fleetApi.listTrips({ vehicleId: vid, status: 'closed' }) : Promise.resolve([])), [vid]);
  const fuelDefault = lastFuel.data?.[0]?.fuelEnd;

  async function submit() {
    if (!v) return setError(t('formRequired'));
    const input: FleetTripInput = {
      vehicleId: v.id, driverId, date: f.date, departTime: f.departTime, returnDate: f.returnDate, returnTime: f.returnTime, routeFrom: f.routeFrom, routeTo: f.routeTo, waypoints: f.waypoints, purpose: f.purpose, city,
      odoStart: f.odoStart.trim() === '' ? v.mileage : num(f.odoStart), fuelStart: f.fuelStart.trim() === '' ? fuelDefault ?? NaN : num(f.fuelStart),
    };
    setBusy(true);
    try {
      if (trip) {
        await fleetApi.resubmitTrip(trip.id, input, user);
        toast(`${trip.number}: ${t('fleet_tripResubmitted')}`);
        onSaved?.(trip.id);
      } else {
        const created = await fleetApi.openTrip(input, user);
        toast(`${created.number}: ${t('fleet_tripSent')}`);
        onSaved?.(created.id);
      }
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={trip ? `${t('fleet_editTrip')} · ${trip.number}` : t('fleet_openTrip')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={submit}>{t('fleet_sendToDispatcher')}</Button>
        </>
      }
    >
      <p className="flt-hint">{t('fleet_openTripHint')}</p>
      <div className="form-grid flt-mk">
        <Field label={t('fleet_plate')} required hint={v ? `${v.brand} ${v.model} · ${t('fleet_mileage')}: ${formatNumber(v.mileage)} · ${t('fleet_norm')}: ${dec(v.fuelNorm)}` : undefined} className="span-2">
          <Select<string>
            value={vid}
            placeholder="—"
            disabled={!!vehicleId || !!trip}
            ariaLabel={t('fleet_plate')}
            onChange={(x) => { setVid(x); setF((s) => ({ ...s, driverId: '', odoStart: '', fuelStart: '' })); setError(''); }}
            options={list.map((x) => ({ value: x.id, label: `${x.plate} · ${x.brand} ${x.model}`, disabled: x.status !== 'in_operation' || x.onTrip }))}
          />
        </Field>
        <Field label={t('fleet_driver')} required>
          <Select<string> value={driverId} placeholder="—" disabled={selfOnly} ariaLabel={t('fleet_driver')} onChange={set('driverId')} options={vehicleDrivers.map((d) => ({ value: d.id, label: `${d.fullName} (${t(d.id === v?.primaryDriverId ? 'fleet_role_primary' : 'fleet_role_reserve')})` }))} />
        </Field>
        <Field label={t('fleet_tripPurpose')} required>
          <Input value={f.purpose} onChange={(e) => set('purpose')(e.target.value)} ariaLabel={t('fleet_tripPurpose')} />
        </Field>
        <Field label={t('fleet_departDate')} required>
          <Input type="date" value={f.date} onChange={(e) => set('date')(e.target.value)} ariaLabel={t('fleet_departDate')} />
        </Field>
        <Field label={t('fleet_departTime')} required hint={t('fleet_timeHint')}>
          <Input value={f.departTime} maxLength={5} inputMode="numeric" onChange={(e) => set('departTime')(e.target.value)} ariaLabel={t('fleet_departTime')} />
        </Field>
        <Field label={t('fleet_returnDate')} required>
          <Input type="date" value={f.returnDate} onChange={(e) => set('returnDate')(e.target.value)} ariaLabel={t('fleet_returnDate')} />
        </Field>
        <Field label={t('fleet_returnTime')} required>
          <Input value={f.returnTime} maxLength={5} inputMode="numeric" onChange={(e) => set('returnTime')(e.target.value)} ariaLabel={t('fleet_returnTime')} />
        </Field>
        <Field label={t('fleet_routeFrom')} required>
          <Input value={f.routeFrom} onChange={(e) => set('routeFrom')(e.target.value)} ariaLabel={t('fleet_routeFrom')} />
        </Field>
        <Field label={t('fleet_routeTo')} required>
          <Input value={f.routeTo} onChange={(e) => set('routeTo')(e.target.value)} ariaLabel={t('fleet_routeTo')} />
        </Field>
        <Field label={t('fleet_waypoints')} className="span-2">
          <Input value={f.waypoints} onChange={(e) => set('waypoints')(e.target.value)} ariaLabel={t('fleet_waypoints')} />
        </Field>
        <Field label={t('fleet_odoStart')} hint={v ? `≥ ${formatNumber(v.mileage)}` : undefined}>
          <Input type="number" value={f.odoStart} placeholder={v ? String(v.mileage) : ''} onChange={(e) => set('odoStart')(e.target.value)} ariaLabel={t('fleet_odoStart')} />
        </Field>
        <Field label={t('fleet_fuelStart')} hint={v ? `${t('fleet_tank')}: ${v.tankLitres}` : undefined}>
          <Input type="number" value={f.fuelStart} placeholder={fuelDefault !== undefined ? String(fuelDefault) : ''} onChange={(e) => set('fuelStart')(e.target.value)} ariaLabel={t('fleet_fuelStart')} />
        </Field>
        <Field label={t('fleet_cityTrip')}>
          <Checkbox checked={city} onChange={setCity}>{t('fleet_cityTripHint')}{v ? ` (+${v.cityPct}%)` : ''}</Checkbox>
        </Field>
      </div>
      <RouteSteps preview={{ entity: 'fleet_trip', context: { subtype: v?.purpose } }} />
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Закрытие путевого листа (PR-FLT-093…097): время возврата, одометр, остаток топлива; сравнение с нормой. */
export function CloseTripModal({ trip, vehicle, onClose }: { trip: FleetTrip; vehicle: FleetVehicleView; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const [returnDate, setReturnDate] = useState(trip.returnDate > today() ? today() : trip.returnDate);
  const [returnTime, setReturnTime] = useState(trip.returnTime);
  const [odoEnd, setOdoEnd] = useState('');
  const [fuelEnd, setFuelEnd] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const calc = useMemo(() => (odoEnd && fuelEnd !== '' ? fleetApi.previewClose(trip.id, num(odoEnd), num(fuelEnd)) : null), [trip.id, odoEnd, fuelEnd]);

  async function submit() {
    setBusy(true);
    try {
      await fleetApi.closeTrip(trip.id, { returnDate, returnTime, odoEnd: num(odoEnd), fuelEnd: num(fuelEnd), ...(reason.trim() ? { overrunReason: reason } : {}) }, user);
      toast(`${trip.number}: ${t('fleet_tripClosed')}`);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_closeTrip')} · ${trip.number}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={submit}>{t('fleet_closeTrip')}</Button></>}>
      <p className="flt-hint">{vehicle.plate} · {trip.routeFrom} → {trip.routeTo} · {t('fleet_odoStart')}: {formatNumber(trip.odoStart)} · {t('fleet_fuelStart')}: {dec(trip.fuelStart)}</p>
      <div className="form-grid flt-mk">
        <Field label={t('fleet_returnDate')} required>
          <Input type="date" value={returnDate} onChange={(e) => { setReturnDate(e.target.value); setError(''); }} ariaLabel={t('fleet_returnDate')} />
        </Field>
        <Field label={t('fleet_returnTime')} required>
          <Input value={returnTime} maxLength={5} inputMode="numeric" onChange={(e) => { setReturnTime(e.target.value); setError(''); }} ariaLabel={t('fleet_returnTime')} />
        </Field>
        <Field label={t('fleet_odoEnd')} required>
          <Input type="number" value={odoEnd} placeholder={String(trip.odoStart + 50)} onChange={(e) => { setOdoEnd(e.target.value); setError(''); }} ariaLabel={t('fleet_odoEnd')} />
        </Field>
        <Field label={t('fleet_fuelEnd')} required>
          <Input type="number" value={fuelEnd} onChange={(e) => { setFuelEnd(e.target.value); setError(''); }} ariaLabel={t('fleet_fuelEnd')} />
        </Field>
      </div>
      {calc && (
        <div className="flt-calc" data-testid="flt-calc">
          <div><span>{t('fleet_distance')}</span><b>{formatNumber(calc.km)}</b></div>
          <div><span>{t('fleet_refuelled')}</span><b>{dec(calc.refuel)}</b></div>
          <div><span>{t('fleet_fuelUsed')}</span><b>{dec(calc.used)}</b></div>
          <div><span>{t('fleet_normUsed')}</span><b>{dec(calc.norm)}</b></div>
          <div><span>{t('fleet_deviation')}</span><b className={calc.over ? 'flt-over' : calc.deviationPct < 0 ? 'flt-save' : ''}>{calc.deviationPct > 0 ? '+' : ''}{dec(calc.deviationPct)}%</b></div>
        </div>
      )}
      {calc?.over && (
        <Field label={t('fleet_overrunReason')} required>
          <Textarea value={reason} rows={2} onChange={(e) => { setReason(e.target.value); setError(''); }} ariaLabel={t('fleet_overrunReason')} />
        </Field>
      )}
      <p className="flt-hint">{t('fleet_closeHint')}</p>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Регистрация заправки (PR-FLT-047/048): дата, АЗС, вид, объём, сумма; карта; путевой лист; контроль лимита. */
export function FuelUpModal({ vehicle, onClose, onSaved }: { vehicle: FleetVehicleView; onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const cards = useApi(() => fleetApi.listCards(), []);
  const open = useApi(() => fleetApi.listTrips({ vehicleId: vehicle.id, status: 'open' }), [vehicle.id]);
  const usage = useApi(() => fleetApi.limitUsage(vehicle.id), [vehicle.id]);
  const settings = useApi(() => fleetApi.getSettings(), []);
  const myCards = (cards.data ?? []).filter((c) => c.vehicleId === vehicle.id && c.status === 'active');
  const [date, setDate] = useState(today());
  const [station, setStation] = useState('');
  const [litres, setLitres] = useState('');
  const [amount, setAmount] = useState('');
  const [cardId, setCardId] = useState('');
  const [tripId, setTripId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fuel: FleetFuel = vehicle.fuel;
  const trip = tripId ?? open.data?.[0]?.id ?? '';
  const l = num(litres);
  const a = num(amount);
  const over = !!usage.data && ((vehicle.limitLitres > 0 && usage.data.litres + (l || 0) > vehicle.limitLitres) || (vehicle.limitSum > 0 && usage.data.amount + (a || 0) > vehicle.limitSum));
  const price = settings.data?.fuelPrices[fuel] ?? 0;

  async function save() {
    setBusy(true);
    try {
      const f = await fleetApi.addFuelUp({ vehicleId: vehicle.id, date, station, fuel, litres: l, amount: a, ...(cardId ? { cardId } : {}), ...(trip ? { tripId: trip } : {}), ...(reason.trim() ? { overLimitReason: reason } : {}) }, user);
      toast(`${f.number}: ${t('fleet_fuelSaved')}`);
      onSaved?.(f.id);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_addFuel')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('save')}</Button></>}>
      {usage.data && (vehicle.limitLitres > 0 || vehicle.limitSum > 0) && (
        <p className="flt-hint">
          {t('fleet_limitMonth')}: {dec(usage.data.litres)} / {formatNumber(vehicle.limitLitres)} {t('fleet_l')} · {formatNumber(usage.data.amount)} / {formatNumber(vehicle.limitSum)} {currencyLabel()}
        </p>
      )}
      <div className="form-grid flt-mk">
        <Field label={t('date')} required>
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setError(''); }} ariaLabel={t('date')} />
        </Field>
        <Field label={t('fleet_fuel')}>
          <Input value={t(tk('fleet_fuel_', fuel))} readOnly ariaLabel={t('fleet_fuel')} />
        </Field>
        <Field label={t('fleet_station')} required className="span-2">
          <Input value={station} onChange={(e) => { setStation(e.target.value); setError(''); }} ariaLabel={t('fleet_station')} />
        </Field>
        <Field label={t('fleet_litres')} required>
          <Input type="number" value={litres} onChange={(e) => { setLitres(e.target.value); if (!amount && price && Number(e.target.value) > 0) setAmount(String(Math.round(Number(e.target.value) * price))); setError(''); }} ariaLabel={t('fleet_litres')} />
        </Field>
        <Field label={`${t('amount')}, ${currencyLabel()}`} required>
          <Input type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} ariaLabel={t('amount')} />
        </Field>
        <Field label={t('fleet_card')}>
          <Select<string> value={cardId} placeholder={t('fleet_noCard')} ariaLabel={t('fleet_card')} onChange={setCardId} options={myCards.map((c) => ({ value: c.id, label: `${c.number} · ${formatNumber(c.balance)} ${currencyLabel()}` }))} />
        </Field>
        <Field label={t('fleet_tripNo')}>
          <Select<string> value={trip} placeholder="—" ariaLabel={t('fleet_tripNo')} onChange={(x) => setTripId(x)} options={(open.data ?? []).map((x) => ({ value: x.id, label: x.number }))} />
        </Field>
      </div>
      {over && (
        <Field label={t('fleet_overLimitReason')} required>
          <Textarea value={reason} rows={2} onChange={(e) => { setReason(e.target.value); setError(''); }} ariaLabel={t('fleet_overLimitReason')} />
        </Field>
      )}
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Журнал работы генератора: моточасы и расход (норма на моточас). */
export function RunLogModal({ vehicle, onClose }: { vehicle: FleetVehicleView; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const [date, setDate] = useState(today());
  const [hoursEnd, setHoursEnd] = useState('');
  const [fuelUsed, setFuelUsed] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hours = num(hoursEnd) - vehicle.mileage;
  const norm = hours > 0 ? fleetNormLitres(vehicle, hours, date) : 0;
  async function save() {
    setBusy(true);
    try {
      await fleetApi.addRunLog(vehicle.id, { date, hoursEnd: num(hoursEnd), fuelUsed: num(fuelUsed), note }, user);
      toast(t('fleet_runSaved'));
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_addRun')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('save')}</Button></>}>
      <div className="form-grid flt-mk">
        <Field label={t('date')} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} ariaLabel={t('date')} />
        </Field>
        <Field label={t('fleet_hoursEnd')} required hint={`> ${formatNumber(vehicle.mileage)}`}>
          <Input type="number" value={hoursEnd} onChange={(e) => { setHoursEnd(e.target.value); setError(''); }} ariaLabel={t('fleet_hoursEnd')} />
        </Field>
        <Field label={t('fleet_fuelUsed')} required hint={norm ? `${t('fleet_normUsed')}: ${dec(norm)}` : undefined}>
          <Input type="number" value={fuelUsed} onChange={(e) => { setFuelUsed(e.target.value); setError(''); }} ariaLabel={t('fleet_fuelUsed')} />
        </Field>
        <Field label={t('comment')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} ariaLabel={t('comment')} />
        </Field>
      </div>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Сообщение о неисправности (водитель): описание, важность; фото — вложением после сохранения. */
export function FaultModal({ vehicle, onClose, onSaved }: { vehicle: FleetVehicleView; onClose: () => void; onSaved?: (f: FleetFaultReport) => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FleetFaultReport['severity']>('medium');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const f = await fleetApi.reportFault({ vehicleId: vehicle.id, description, severity }, user);
      toast(`${f.number}: ${t('fleet_faultSaved')}`);
      onSaved?.(f);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_reportFault')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('fleet_send')}</Button></>}>
      <Field label={t('fleet_faultDescription')} required error={error}>
        <Textarea value={description} rows={3} onChange={(e) => { setDescription(e.target.value); setError(''); }} ariaLabel={t('fleet_faultDescription')} />
      </Field>
      <Field label={t('fleet_severity')}>
        <Select<FleetFaultReport['severity']> value={severity} ariaLabel={t('fleet_severity')} onChange={setSeverity} options={(['low', 'medium', 'high'] as const).map((s) => ({ value: s, label: t(tk('fleet_sev_', s)) }))} />
      </Field>
      <p className="flt-hint">{t('fleet_faultPhotoHint')}</p>
    </Modal>
  );
}

export type { FleetDriver };
