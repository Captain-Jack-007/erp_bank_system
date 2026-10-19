// Формы карточек: ТС/генератор, водитель, документ ТС, смена статуса, списание, привязка к ОС.
import { useState } from 'react';
import {
  currencyLabel, fleetApi, formatMoney, today, tk,
  type FleetDocType, type FleetDriver, type FleetFuel, type FleetKind, type FleetPurpose, type FleetStatus, type FleetVehicle, type FleetVehicleInput, type FleetVehicleType,
} from '@xb/shared';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui';
import { useStepUp } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useFleetErr, useOrgRefs } from './shared';

const KINDS: FleetKind[] = ['vehicle', 'generator'];
const TYPES: FleetVehicleType[] = ['car', 'truck', 'special', 'bus'];
const FUELS: FleetFuel[] = ['petrol', 'diesel', 'methane', 'propane', 'electric'];
const PURPOSES: FleetPurpose[] = ['collection', 'business', 'management', 'service', 'power'];

const numOr = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

/** Создание / редактирование карточки ТС или генератора (PR-FLT-001…011). */
export function VehicleFormModal({ vehicle, onClose, onSaved }: { vehicle?: FleetVehicle; onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const org = useOrgRefs();
  const v = vehicle;
  const [kind, setKind] = useState<FleetKind>(v?.kind ?? 'vehicle');
  const [f, setF] = useState({
    plate: v?.plate ?? '', brand: v?.brand ?? '', model: v?.model ?? '', year: String(v?.year ?? Number(today().slice(0, 4))), vin: v?.vin ?? '', techPassportNo: v?.techPassportNo ?? '',
    vehicleType: (v?.vehicleType ?? 'car') as FleetVehicleType, purpose: (v?.purpose ?? 'business') as FleetPurpose, fuel: (v?.fuel ?? 'petrol') as FleetFuel,
    fuelNorm: String(v?.fuelNorm ?? ''), winterPct: String(v?.winterPct ?? 10), cityPct: String(v?.cityPct ?? 15), limitLitres: String(v?.limitLitres ?? 0), limitSum: String(v?.limitSum ?? 0),
    bookValue: String(v?.bookValue ?? 0), orgUnitKey: v?.orgUnitKey ?? 'd2', costCenterKey: v?.costCenterKey ?? '', expenseAccount: v?.expenseAccount ?? '56811000', mileage: String(v?.mileage ?? 0),
    serviceIntervalKm: String(v?.serviceIntervalKm ?? 10_000), serviceIntervalMonths: String(v?.serviceIntervalMonths ?? 12), tankLitres: String(v?.tankLitres ?? 60),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (val: string) => {
    setF((x) => ({ ...x, [k]: val }));
    setError('');
  };
  const ccs = org.ccsOf(f.orgUnitKey);
  const gen = kind === 'generator';

  async function save() {
    const input: FleetVehicleInput = {
      kind, plate: f.plate, brand: f.brand, model: f.model, year: Number(f.year), vin: f.vin, techPassportNo: f.techPassportNo, vehicleType: gen ? 'generator' : f.vehicleType,
      purpose: gen ? 'power' : f.purpose, fuel: f.fuel, fuelNorm: numOr(f.fuelNorm), winterPct: numOr(f.winterPct), cityPct: gen ? 0 : numOr(f.cityPct), limitLitres: numOr(f.limitLitres), limitSum: numOr(f.limitSum),
      bookValue: numOr(f.bookValue), orgUnitKey: f.orgUnitKey, costCenterKey: f.costCenterKey, expenseAccount: f.expenseAccount, mileage: numOr(f.mileage),
      serviceIntervalKm: numOr(f.serviceIntervalKm), serviceIntervalMonths: numOr(f.serviceIntervalMonths), tankLitres: numOr(f.tankLitres),
    };
    setBusy(true);
    try {
      if (v) {
        await fleetApi.update(v.id, input, user);
        toast(`${input.plate}: ${t('fleet_saved')}`);
        onSaved?.(v.id);
      } else {
        const created = await fleetApi.create(input, user);
        toast(`${created.plate}: ${t('fleet_created')}`);
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
      title={v ? `${t('fleet_editCard')} · ${v.plate}` : t('fleet_newVehicle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={save}>{t('save')}</Button>
        </>
      }
    >
      <div className="form-grid flt-mk">
        <Field label={t('fleet_kind')} required>
          <Select<FleetKind> value={kind} disabled={!!v} ariaLabel={t('fleet_kind')} onChange={(k) => { setKind(k); if (k === 'generator') setF((x) => ({ ...x, fuel: 'diesel', serviceIntervalKm: '250', cityPct: '0', winterPct: '5' })); }} options={KINDS.map((k) => ({ value: k, label: t(tk('fleet_kind_', k)) }))} />
        </Field>
        <Field label={gen ? t('fleet_plateGen') : t('fleet_plate')} required>
          <Input value={f.plate} onChange={(e) => set('plate')(e.target.value)} placeholder={gen ? 'GEN-HO-002' : '01 A 000 AA'} ariaLabel={t('fleet_plate')} />
        </Field>
        <Field label={t('fleet_brand')} required>
          <Input value={f.brand} onChange={(e) => set('brand')(e.target.value)} ariaLabel={t('fleet_brand')} />
        </Field>
        <Field label={t('fleet_model')} required>
          <Input value={f.model} onChange={(e) => set('model')(e.target.value)} ariaLabel={t('fleet_model')} />
        </Field>
        <Field label={t('fleet_year')} required>
          <Input type="number" value={f.year} onChange={(e) => set('year')(e.target.value)} ariaLabel={t('fleet_year')} />
        </Field>
        <Field label={gen ? t('fleet_serialNo') : t('fleet_vin')} required hint={gen ? undefined : t('fleet_vinHint')}>
          <Input value={f.vin} maxLength={30} onChange={(e) => set('vin')(e.target.value.toUpperCase())} ariaLabel={t('fleet_vin')} />
        </Field>
        <Field label={gen ? t('fleet_genPassport') : t('fleet_techPassport')} required>
          <Input value={f.techPassportNo} onChange={(e) => set('techPassportNo')(e.target.value)} ariaLabel={t('fleet_techPassport')} />
        </Field>
        {!gen && (
          <Field label={t('fleet_vehicleType')} required>
            <Select<FleetVehicleType> value={f.vehicleType} ariaLabel={t('fleet_vehicleType')} onChange={(x) => set('vehicleType')(x)} options={TYPES.map((x) => ({ value: x, label: t(tk('fleet_type_', x)) }))} />
          </Field>
        )}
        {!gen && (
          <Field label={t('fleet_purpose')} required>
            <Select<FleetPurpose> value={f.purpose} ariaLabel={t('fleet_purpose')} onChange={(x) => set('purpose')(x)} options={PURPOSES.filter((x) => x !== 'power').map((x) => ({ value: x, label: t(tk('fleet_purpose_', x)) }))} />
          </Field>
        )}
        <Field label={t('fleet_fuel')} required>
          <Select<FleetFuel> value={f.fuel} ariaLabel={t('fleet_fuel')} onChange={(x) => set('fuel')(x)} options={FUELS.map((x) => ({ value: x, label: t(tk('fleet_fuel_', x)) }))} />
        </Field>
        <Field label={gen ? t('fleet_normGen') : t('fleet_norm')} required>
          <Input type="number" value={f.fuelNorm} onChange={(e) => set('fuelNorm')(e.target.value)} ariaLabel={t('fleet_norm')} />
        </Field>
        <Field label={t('fleet_winterPct')}>
          <Input type="number" value={f.winterPct} onChange={(e) => set('winterPct')(e.target.value)} ariaLabel={t('fleet_winterPct')} />
        </Field>
        {!gen && (
          <Field label={t('fleet_cityPct')}>
            <Input type="number" value={f.cityPct} onChange={(e) => set('cityPct')(e.target.value)} ariaLabel={t('fleet_cityPct')} />
          </Field>
        )}
        <Field label={t('fleet_limitLitres')}>
          <Input type="number" value={f.limitLitres} onChange={(e) => set('limitLitres')(e.target.value)} ariaLabel={t('fleet_limitLitres')} />
        </Field>
        <Field label={`${t('fleet_limitSum')}, ${currencyLabel()}`}>
          <Input type="number" value={f.limitSum} onChange={(e) => set('limitSum')(e.target.value)} ariaLabel={t('fleet_limitSum')} />
        </Field>
        <Field label={`${t('fleet_bookValue')}, ${currencyLabel()}`} hint={v?.assetId ? t('fleet_bookFromAsset') : undefined}>
          <Input type="number" value={f.bookValue} onChange={(e) => set('bookValue')(e.target.value)} ariaLabel={t('fleet_bookValue')} />
        </Field>
        <Field label={gen ? t('fleet_hours') : t('fleet_mileage')} required>
          <Input type="number" value={f.mileage} onChange={(e) => set('mileage')(e.target.value)} ariaLabel={t('fleet_mileage')} />
        </Field>
        <Field label={t('fleet_orgUnit')} required>
          <Select<string> value={f.orgUnitKey} ariaLabel={t('fleet_orgUnit')} onChange={(x) => setF((s) => ({ ...s, orgUnitKey: x, costCenterKey: '' }))} options={org.units.map((u) => ({ value: u.key, label: `${u.code} · ${org.unitName(u.key)}` }))} />
        </Field>
        <Field label={t('fleet_costCenter')} required>
          <Select<string> value={f.costCenterKey} placeholder="—" ariaLabel={t('fleet_costCenter')} onChange={(x) => set('costCenterKey')(x)} options={ccs.map((c) => ({ value: c.key, label: org.ccLabel(c.key) }))} />
        </Field>
        <Field label={t('fleet_expenseAccount')}>
          <Input value={f.expenseAccount} maxLength={8} onChange={(e) => set('expenseAccount')(e.target.value.replace(/\D/g, ''))} ariaLabel={t('fleet_expenseAccount')} />
        </Field>
        <Field label={gen ? t('fleet_serviceIntervalHours') : t('fleet_serviceIntervalKm')} required>
          <Input type="number" value={f.serviceIntervalKm} onChange={(e) => set('serviceIntervalKm')(e.target.value)} ariaLabel={t('fleet_serviceIntervalKm')} />
        </Field>
        <Field label={t('fleet_serviceIntervalMonths')} required>
          <Input type="number" value={f.serviceIntervalMonths} onChange={(e) => set('serviceIntervalMonths')(e.target.value)} ariaLabel={t('fleet_serviceIntervalMonths')} />
        </Field>
        <Field label={t('fleet_tank')} required>
          <Input type="number" value={f.tankLitres} onChange={(e) => set('tankLitres')(e.target.value)} ariaLabel={t('fleet_tank')} />
        </Field>
      </div>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Смена статуса ТС (эксплуатация, ремонт, техосмотр, резерв) с причиной. */
export function StatusModal({ vehicle, onClose }: { vehicle: FleetVehicle; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const options: FleetStatus[] = (['in_operation', 'repair', 'inspection', 'reserve'] as FleetStatus[]).filter((s) => s !== vehicle.status);
  const [status, setStatus] = useState<FleetStatus>(options[0]!);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await fleetApi.setStatus(vehicle.id, status, user, reason);
      toast(`${vehicle.plate}: ${t(tk('fleet_status_', status))}`);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_changeStatus')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('save')}</Button></>}>
      <Field label={t('status')} required>
        <Select<FleetStatus> value={status} ariaLabel={t('status')} onChange={(s) => { setStatus(s); setError(''); }} options={options.map((s) => ({ value: s, label: t(tk('fleet_status_', s)) }))} />
      </Field>
      <Field label={t('fleet_reason')}>
        <Textarea value={reason} rows={2} onChange={(e) => setReason(e.target.value)} ariaLabel={t('fleet_reason')} />
      </Field>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Списание ТС: при связи с ОС — акт ОС-4 с комиссией (модуль «Основные средства»); иначе — сразу (с подтверждением кодом). */
export function WriteoffModal({ vehicle, onClose }: { vehicle: FleetVehicle; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const stepUp = useStepUp();
  const lk = useLookups();
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<'liquidation' | 'unusable'>('liquidation');
  const [protocolNo, setProtocolNo] = useState('');
  const [chairmanId, setChairmanId] = useState('u6');
  const [m1, setM1] = useState('u7');
  const [m2, setM2] = useState('u14');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const people = lk.users.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: u.fullName }));
  async function save() {
    if (!reason.trim()) return setError(t('formRequired'));
    if (!vehicle.assetId && !(await stepUp(t('fleet_writeoff')))) return;
    setBusy(true);
    try {
      const r = await fleetApi.requestWriteoff(vehicle.id, { reason, ...(vehicle.assetId ? { kind, protocolNo, chairmanId, memberIds: [m1, m2] } : {}) }, user);
      toast(`${vehicle.plate}: ${t(r === 'pending' ? 'fleet_writeoffSent' : 'fleet_status_written_off')}`);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_writeoff')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" danger loading={busy} onClick={save}>{t('fleet_writeoff')}</Button></>}>
      <p className="flt-hint">{vehicle.assetId ? t('fleet_writeoffViaAsset') : t('fleet_writeoffDirect')}</p>
      <Field label={t('fleet_reason')} required>
        <Textarea value={reason} rows={3} onChange={(e) => { setReason(e.target.value); setError(''); }} ariaLabel={t('fleet_reason')} />
      </Field>
      {vehicle.assetId && (
        <div className="form-grid flt-mk">
          <Field label={t('fleet_writeoffKind')} required>
            <Select<'liquidation' | 'unusable'> value={kind} ariaLabel={t('fleet_writeoffKind')} onChange={setKind} options={(['liquidation', 'unusable'] as const).map((k) => ({ value: k, label: t(tk('fleet_wo_', k)) }))} />
          </Field>
          <Field label={t('fleet_protocolNoCommission')} required>
            <Input value={protocolNo} onChange={(e) => { setProtocolNo(e.target.value); setError(''); }} ariaLabel={t('fleet_protocolNoCommission')} />
          </Field>
          <Field label={t('fleet_chairman')} required>
            <Select<string> value={chairmanId} ariaLabel={t('fleet_chairman')} onChange={setChairmanId} options={people} />
          </Field>
          <Field label={`${t('fleet_member')} 1`} required>
            <Select<string> value={m1} ariaLabel={`${t('fleet_member')} 1`} onChange={setM1} options={people} />
          </Field>
          <Field label={`${t('fleet_member')} 2`} required>
            <Select<string> value={m2} ariaLabel={`${t('fleet_member')} 2`} onChange={setM2} options={people} />
          </Field>
        </div>
      )}
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Привязка карточки ТС к основному средству (балансовая стоимость — из модуля ОС). */
export function AssetLinkModal({ vehicle, onClose }: { vehicle: FleetVehicle; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const assets = useApi(() => fleetApi.listVehicleAssets(), []);
  const [assetId, setAssetId] = useState(vehicle.assetId ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await fleetApi.linkAsset(vehicle.id, assetId || undefined, user);
      toast(t('fleet_saved'));
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_linkAsset')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('save')}</Button></>}>
      <p className="flt-hint">{t('fleet_linkAssetHint')}</p>
      <Field label={t('fleet_asset')}>
        <Select<string>
          value={assetId}
          placeholder={t('fleet_noAsset')}
          ariaLabel={t('fleet_asset')}
          onChange={(x) => { setAssetId(x); setError(''); }}
          options={(assets.data ?? []).map((a) => ({ value: a.id, label: `${a.inventoryNo} · ${a.name} · ${formatMoney(a.nbv)}${a.linkedTo && a.id !== vehicle.assetId ? ` (${a.linkedTo})` : ''}`, disabled: !!a.linkedTo && a.id !== vehicle.assetId }))}
        />
      </Field>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

const DOC_TYPES: FleetDocType[] = ['tech_passport', 'osago', 'kasko', 'inspection', 'power_of_attorney'];

/** Документ ТС / продление (техпаспорт, ОСАГО, КАСКО, техосмотр, доверенность). */
export function DocumentModal({ vehicle, type: initial, drivers, onClose }: { vehicle: FleetVehicle; type?: FleetDocType; drivers: FleetDriver[]; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const [type, setType] = useState<FleetDocType>(initial ?? 'osago');
  const [number, setNumber] = useState('');
  const [issuer, setIssuer] = useState('');
  const [from, setFrom] = useState(today());
  const [until, setUntil] = useState('');
  const [cost, setCost] = useState('0');
  const [driverId, setDriverId] = useState(vehicle.primaryDriverId ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await fleetApi.addDocument({ vehicleId: vehicle.id, type, number, issuer, validFrom: from, ...(until ? { validUntil: until } : {}), cost: numOr(cost), ...(type === 'power_of_attorney' && driverId ? { driverId } : {}) }, user);
      toast(`${t(tk('fleet_doc_', type))}: ${t('fleet_saved')}`);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  const types = vehicle.kind === 'generator' ? (['tech_passport'] as FleetDocType[]) : DOC_TYPES;
  return (
    <Modal title={`${initial ? t('fleet_renewDoc') : t('fleet_addDoc')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('save')}</Button></>}>
      <div className="form-grid flt-mk">
        <Field label={t('fleet_docType')} required>
          <Select<FleetDocType> value={type} disabled={!!initial} ariaLabel={t('fleet_docType')} onChange={(x) => { setType(x); setError(''); }} options={types.map((x) => ({ value: x, label: t(tk('fleet_doc_', x)) }))} />
        </Field>
        <Field label={t('fleet_docNumber')} required>
          <Input value={number} onChange={(e) => { setNumber(e.target.value); setError(''); }} ariaLabel={t('fleet_docNumber')} />
        </Field>
        <Field label={type === 'osago' || type === 'kasko' ? t('fleet_insurer') : t('fleet_issuer')} required>
          <Input value={issuer} onChange={(e) => { setIssuer(e.target.value); setError(''); }} ariaLabel={t('fleet_issuer')} />
        </Field>
        {type === 'power_of_attorney' && (
          <Field label={t('fleet_driver')} required>
            <Select<string> value={driverId} placeholder="—" ariaLabel={t('fleet_driver')} onChange={setDriverId} options={drivers.filter((d) => d.active).map((d) => ({ value: d.id, label: d.fullName }))} />
          </Field>
        )}
        <Field label={t('fleet_validFrom')} required>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setError(''); }} ariaLabel={t('fleet_validFrom')} />
        </Field>
        <Field label={t('fleet_validUntil')} required={type !== 'tech_passport'}>
          <Input type="date" value={until} onChange={(e) => { setUntil(e.target.value); setError(''); }} ariaLabel={t('fleet_validUntil')} />
        </Field>
        <Field label={`${t('fleet_cost')}, ${currencyLabel()}`}>
          <Input type="number" value={cost} onChange={(e) => { setCost(e.target.value); setError(''); }} ariaLabel={t('fleet_cost')} />
        </Field>
      </div>
      {(type === 'osago' || type === 'kasko') && <p className="flt-hint">{t('fleet_insurancePostingHint')}</p>}
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

const CATS = ['A', 'B', 'BE', 'C', 'CE', 'D', 'DE'];

/** Карточка водителя: ФИО, табельный номер, удостоверение (номер, категории, срок), медсправка (PR-FLT-035…038). */
export function DriverFormModal({ driver, onClose, onSaved }: { driver?: FleetDriver; onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const org = useOrgRefs();
  const lk = useLookups();
  const d = driver;
  const [f, setF] = useState({ fullName: d?.fullName ?? '', personnelNo: d?.personnelNo ?? '', phone: d?.phone ?? '', licenseNo: d?.licenseNo ?? '', licenseUntil: d?.licenseUntil ?? '', medicalUntil: d?.medicalUntil ?? '', orgUnitKey: d?.orgUnitKey ?? 'd2', userId: d?.userId ?? '' });
  const [cats, setCats] = useState<string[]>(d?.licenseCategories ?? ['B']);
  const [active, setActive] = useState(d?.active ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (val: string) => {
    setF((x) => ({ ...x, [k]: val }));
    setError('');
  };
  async function save() {
    setBusy(true);
    try {
      const saved = await fleetApi.saveDriver({ ...f, ...(f.userId ? { userId: f.userId } : {}), licenseCategories: cats, active }, user, d?.id);
      toast(`${saved.fullName}: ${t('fleet_saved')}`);
      onSaved?.(saved.id);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={d ? `${t('fleet_editDriver')} · ${d.fullName}` : t('fleet_newDriver')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('save')}</Button></>}>
      <div className="form-grid flt-mk">
        <Field label={t('fleet_fullName')} required className="span-2">
          <Input value={f.fullName} onChange={(e) => set('fullName')(e.target.value)} ariaLabel={t('fleet_fullName')} />
        </Field>
        <Field label={t('fleet_personnelNo')} required>
          <Input value={f.personnelNo} onChange={(e) => set('personnelNo')(e.target.value)} ariaLabel={t('fleet_personnelNo')} />
        </Field>
        <Field label={t('fleet_phone')}>
          <Input type="tel" value={f.phone} onChange={(e) => set('phone')(e.target.value)} ariaLabel={t('fleet_phone')} />
        </Field>
        <Field label={t('fleet_licenseNo')} required>
          <Input value={f.licenseNo} onChange={(e) => set('licenseNo')(e.target.value)} ariaLabel={t('fleet_licenseNo')} />
        </Field>
        <Field label={t('fleet_licenseUntil')} required>
          <Input type="date" value={f.licenseUntil} onChange={(e) => set('licenseUntil')(e.target.value)} ariaLabel={t('fleet_licenseUntil')} />
        </Field>
        <Field label={t('fleet_medicalUntil')} required>
          <Input type="date" value={f.medicalUntil} onChange={(e) => set('medicalUntil')(e.target.value)} ariaLabel={t('fleet_medicalUntil')} />
        </Field>
        <Field label={t('fleet_orgUnit')} required>
          <Select<string> value={f.orgUnitKey} ariaLabel={t('fleet_orgUnit')} onChange={set('orgUnitKey')} options={org.units.map((u) => ({ value: u.key, label: `${u.code} · ${org.unitName(u.key)}` }))} />
        </Field>
        <Field label={t('fleet_account')} hint={t('fleet_accountHint')}>
          <Select<string> value={f.userId} placeholder="—" ariaLabel={t('fleet_account')} onChange={set('userId')} options={lk.users.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: `${u.fullName} (${u.login ?? u.id})` }))} />
        </Field>
        <Field label={t('fleet_categories')} required className="span-2">
          <div className="flt-row">
            {CATS.map((c) => (
              <Checkbox key={c} checked={cats.includes(c)} onChange={(on) => setCats((x) => (on ? [...x, c] : x.filter((y) => y !== c)))}>{c}</Checkbox>
            ))}
          </div>
        </Field>
        <Field label={t('status')}>
          <Checkbox checked={active} onChange={setActive}>{t('fleet_driverActive')}</Checkbox>
        </Field>
      </div>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}
