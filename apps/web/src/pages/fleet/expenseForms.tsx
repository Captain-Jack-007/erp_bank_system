// Формы расходов: ТО/ремонт (работы, запчасти, СТО, гарантия), прочие расходы, штрафы; распоряжения:
// закрепление ТС за водителем, акт приёма-передачи, зачисление на топливные карты.
import { useState } from 'react';
import {
  currencyLabel, fleetApi, fleetServiceTotal, formatMoney, formatNumber, today, tk,
  type FleetAssignment, type FleetAssignmentBasis, type FleetAssignmentRole, type FleetChecklistItem, type FleetExpenseKind, type FleetPartLine, type FleetService,
  type FleetServiceKind, type FleetVehicle, type FleetVehicleView, type FleetWorkLine,
} from '@xb/shared';
import { Button, Checkbox, Field, Input, Modal, RouteSteps, Select, Textarea, useToast } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { dec, useFleetErr } from './shared';

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

type WorkRow = { name: string; hours: string; cost: string };
type PartRow = { name: string; qty: string; unit: string; price: string };

/** Перечень работ и запчастей (PR-FLT-055, 064). */
function LinesEditor({ works, parts, setWorks, setParts }: { works: WorkRow[]; parts: PartRow[]; setWorks: (w: WorkRow[]) => void; setParts: (p: PartRow[]) => void }) {
  const { t } = useSession();
  const upd = <T,>(list: T[], i: number, patch: Partial<T>) => list.map((x, j) => (j === i ? { ...x, ...patch } : x));
  return (
    <>
      <div className="flt-row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <b>{t('fleet_works')}</b>
        <Button size="small" icon="plus" onClick={() => setWorks([...works, { name: '', hours: '1', cost: '0' }])}>{t('fleet_addLine')}</Button>
      </div>
      <div className="table-wrap">
        <table className="flt-lines">
          <thead><tr><th className="w-name">{t('fleet_workName')}</th><th className="w-num">{t('fleet_hoursShort')}</th><th className="w-num">{t('fleet_cost')}</th><th /></tr></thead>
          <tbody>
            {works.map((w, i) => (
              <tr key={i}>
                <td><Input value={w.name} onChange={(e) => setWorks(upd(works, i, { name: e.target.value }))} ariaLabel={t('fleet_workName')} /></td>
                <td><Input type="number" value={w.hours} onChange={(e) => setWorks(upd(works, i, { hours: e.target.value }))} ariaLabel={t('fleet_hoursShort')} /></td>
                <td><Input type="number" value={w.cost} onChange={(e) => setWorks(upd(works, i, { cost: e.target.value }))} ariaLabel={t('fleet_cost')} /></td>
                <td className="flt-line-x"><Button size="small" type="text" icon="x" title={t('fleet_removeLine')} onClick={() => setWorks(works.filter((_, j) => j !== i))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flt-row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
        <b>{t('fleet_parts')}</b>
        <Button size="small" icon="plus" onClick={() => setParts([...parts, { name: '', qty: '1', unit: t('fleet_pcs'), price: '0' }])}>{t('fleet_addLine')}</Button>
      </div>
      <div className="table-wrap">
        <table className="flt-lines">
          <thead><tr><th className="w-name">{t('fleet_partName')}</th><th className="w-num">{t('fleet_qty')}</th><th className="w-num">{t('fleet_unit')}</th><th className="w-num">{t('fleet_price')}</th><th /></tr></thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={i}>
                <td><Input value={p.name} onChange={(e) => setParts(upd(parts, i, { name: e.target.value }))} ariaLabel={t('fleet_partName')} /></td>
                <td><Input type="number" value={p.qty} onChange={(e) => setParts(upd(parts, i, { qty: e.target.value }))} ariaLabel={t('fleet_qty')} /></td>
                <td><Input value={p.unit} onChange={(e) => setParts(upd(parts, i, { unit: e.target.value }))} ariaLabel={t('fleet_unit')} /></td>
                <td><Input type="number" value={p.price} onChange={(e) => setParts(upd(parts, i, { price: e.target.value }))} ariaLabel={t('fleet_price')} /></td>
                <td className="flt-line-x"><Button size="small" type="text" icon="x" title={t('fleet_removeLine')} onClick={() => setParts(parts.filter((_, j) => j !== i))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const toWorks = (rows: WorkRow[]): FleetWorkLine[] => rows.map((w) => ({ name: w.name, hours: num(w.hours), cost: num(w.cost) }));
const toParts = (rows: PartRow[]): FleetPartLine[] => rows.map((p) => ({ name: p.name, qty: num(p.qty), unit: p.unit, price: num(p.price) }));

/** Заказ-наряд на ТО или ремонт (PR-FLT-053…066). Новый — или редактирование открытого. */
export function ServiceModal({ vehicle, service, kind: initialKind, faultReportId, fault: initialFault, onClose, onSaved }: { vehicle: FleetVehicle; service?: FleetService; kind?: FleetServiceKind; faultReportId?: string; fault?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const lk = useLookups();
  const s = service;
  const [kind, setKind] = useState<FleetServiceKind>(s?.kind ?? initialKind ?? 'maintenance');
  const [date, setDate] = useState(s?.date ?? today());
  const [odometer, setOdometer] = useState(String(s?.odometer ?? vehicle.mileage));
  const [fault, setFault] = useState(s?.fault ?? initialFault ?? '');
  const [contractorId, setContractorId] = useState(s?.contractorId ?? '');
  const [warranty, setWarranty] = useState(s?.warranty ?? false);
  const [warrantyNote, setWarrantyNote] = useState(s?.warrantyNote ?? '');
  const [offline, setOffline] = useState(kind === 'repair');
  const [works, setWorks] = useState<WorkRow[]>(s?.works.map((w) => ({ name: w.name, hours: String(w.hours), cost: String(w.cost) })) ?? []);
  const [parts, setParts] = useState<PartRow[]>(s?.parts.map((p) => ({ name: p.name, qty: String(p.qty), unit: p.unit, price: String(p.price) })) ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const totals = (() => {
    try {
      return fleetServiceTotal({ works: toWorks(works).map((w) => ({ ...w, cost: w.cost || 0 })), parts: toParts(parts).map((p) => ({ ...p, qty: p.qty || 0, price: p.price || 0 })) });
    } catch {
      return { works: 0, parts: 0, total: 0 };
    }
  })();

  async function save() {
    setBusy(true);
    try {
      if (s) {
        await fleetApi.updateService(s.id, { works: toWorks(works), parts: toParts(parts), ...(contractorId ? { contractorId } : {}), warranty, warrantyNote, fault }, user);
        toast(`${s.number}: ${t('fleet_saved')}`);
        onSaved?.(s.id);
      } else {
        const created = await fleetApi.createService({ vehicleId: vehicle.id, kind, date, odometer: num(odometer), fault, works: toWorks(works), parts: toParts(parts), ...(contractorId ? { contractorId } : {}), warranty, warrantyNote, takeOffline: offline, ...(faultReportId ? { faultReportId } : {}) }, user);
        toast(`${created.number}: ${t('fleet_serviceCreated')}`);
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
    <Modal title={s ? `${t('fleet_editService')} · ${s.number}` : `${t('fleet_newService')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('save')}</Button></>}>
      <div className="form-grid flt-mk">
        <Field label={t('fleet_svcKind')} required>
          <Select<FleetServiceKind> value={kind} disabled={!!s} ariaLabel={t('fleet_svcKind')} onChange={(k) => { setKind(k); setOffline(k === 'repair'); }} options={(['maintenance', 'repair'] as const).map((k) => ({ value: k, label: t(tk('fleet_svc_', k)) }))} />
        </Field>
        <Field label={t('fleet_contractor')} hint={t('fleet_contractorHint')}>
          <Select<string> value={contractorId} placeholder="—" ariaLabel={t('fleet_contractor')} onChange={setContractorId} options={lk.counterparties.filter((c) => !c.blocked).map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label={t('date')} required>
          <Input type="date" value={date} disabled={!!s} onChange={(e) => setDate(e.target.value)} ariaLabel={t('date')} />
        </Field>
        <Field label={vehicle.kind === 'generator' ? t('fleet_hours') : t('fleet_odometer')} required>
          <Input type="number" value={odometer} disabled={!!s} onChange={(e) => setOdometer(e.target.value)} ariaLabel={t('fleet_odometer')} />
        </Field>
        <Field label={kind === 'repair' ? t('fleet_fault') : t('fleet_maintenanceKind')} required className="span-2">
          <Textarea value={fault} rows={2} onChange={(e) => { setFault(e.target.value); setError(''); }} ariaLabel={t('fleet_fault')} />
        </Field>
        <Field label={t('fleet_warranty')}>
          <Checkbox checked={warranty} onChange={setWarranty}>{t('fleet_warrantyRepair')}</Checkbox>
        </Field>
        {!s && (
          <Field label={t('status')}>
            <Checkbox checked={offline} onChange={setOffline}>{t('fleet_takeOffline')}</Checkbox>
          </Field>
        )}
        {warranty && (
          <Field label={t('fleet_warrantyNote')} className="span-2">
            <Input value={warrantyNote} onChange={(e) => setWarrantyNote(e.target.value)} ariaLabel={t('fleet_warrantyNote')} />
          </Field>
        )}
      </div>
      <LinesEditor works={works} parts={parts} setWorks={setWorks} setParts={setParts} />
      <p className="flt-hint" style={{ marginTop: 10 }}>
        {t('fleet_works')}: {formatMoney(totals.works)} · {t('fleet_parts')}: {formatMoney(totals.parts)} · <b>{t('total')}: {formatMoney(totals.total)}</b>{warranty ? ` · ${t('fleet_warrantyZero')}` : ''}
      </p>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

const EXP_KINDS: FleetExpenseKind[] = ['wash', 'parking', 'tires', 'accessories', 'other'];

/** Прочие расходы: мойка, стоянка, шины, аксессуары (PR-FLT-077…082). */
export function ExpenseModal({ vehicle, kind: initial, onClose }: { vehicle: FleetVehicle; kind?: FleetExpenseKind; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const lk = useLookups();
  const [kind, setKind] = useState<FleetExpenseKind>(initial ?? 'wash');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const e = await fleetApi.addExpense({ vehicleId: vehicle.id, kind, date, amount: num(amount), description: description || t(tk('fleet_exp_', kind)), ...(contractorId ? { contractorId } : {}), ...(vehicle.primaryDriverId ? { driverId: vehicle.primaryDriverId } : {}) }, user);
      toast(`${e.number}: ${t('fleet_expenseSaved')}`);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_addExpense')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('save')}</Button></>}>
      <div className="form-grid flt-mk">
        <Field label={t('fleet_expenseKind')} required>
          <Select<FleetExpenseKind> value={kind} ariaLabel={t('fleet_expenseKind')} onChange={setKind} options={EXP_KINDS.map((k) => ({ value: k, label: t(tk('fleet_exp_', k)) }))} />
        </Field>
        <Field label={t('date')} required>
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setError(''); }} ariaLabel={t('date')} />
        </Field>
        <Field label={`${t('amount')}, ${currencyLabel()}`} required>
          <Input type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} ariaLabel={t('amount')} />
        </Field>
        <Field label={t('fleet_contractor')}>
          <Select<string> value={contractorId} placeholder="—" ariaLabel={t('fleet_contractor')} onChange={setContractorId} options={lk.counterparties.filter((c) => !c.blocked).map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label={t('description')} className="span-2">
          <Input value={description} placeholder={t(tk('fleet_exp_', kind))} onChange={(e) => setDescription(e.target.value)} ariaLabel={t('description')} />
        </Field>
      </div>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Штраф (ручной ввод; загрузка из УБДД — на вкладке «Штрафы»). */
export function FineModal({ vehicle, onClose }: { vehicle: FleetVehicle; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const drivers = useApi(() => fleetApi.listDrivers({ active: true }), []);
  const [date, setDate] = useState(today());
  const [protocolNo, setProtocolNo] = useState('');
  const [violation, setViolation] = useState('');
  const [amount, setAmount] = useState('');
  const [driverId, setDriverId] = useState(vehicle.primaryDriverId ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await fleetApi.addFine({ vehicleId: vehicle.id, date, protocolNo, violation, amount: num(amount), ...(driverId ? { driverId } : {}) }, user);
      toast(t('fleet_fineSaved'));
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_addFine')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('save')}</Button></>}>
      <div className="form-grid flt-mk">
        <Field label={t('date')} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} ariaLabel={t('date')} />
        </Field>
        <Field label={t('fleet_protocolNo')} required>
          <Input value={protocolNo} onChange={(e) => { setProtocolNo(e.target.value); setError(''); }} ariaLabel={t('fleet_protocolNo')} />
        </Field>
        <Field label={t('fleet_violation')} required className="span-2">
          <Input value={violation} onChange={(e) => { setViolation(e.target.value); setError(''); }} ariaLabel={t('fleet_violation')} />
        </Field>
        <Field label={`${t('amount')}, ${currencyLabel()}`} required>
          <Input type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} ariaLabel={t('amount')} />
        </Field>
        <Field label={t('fleet_driver')}>
          <Select<string> value={driverId} placeholder="—" ariaLabel={t('fleet_driver')} onChange={setDriverId} options={(drivers.data ?? []).map((d) => ({ value: d.id, label: d.fullName }))} />
        </Field>
      </div>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Распоряжение о закреплении ТС за водителем / смене водителя (PR-FLT-029…031, 042, 043). */
export function AssignmentModal({ vehicle, onClose, onSaved }: { vehicle: FleetVehicleView; onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const drivers = useApi(() => fleetApi.listDrivers({ active: true }), []);
  const [role, setRole] = useState<FleetAssignmentRole>('primary');
  const [basis, setBasis] = useState<FleetAssignmentBasis>('order');
  const [driverId, setDriverId] = useState('');
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = role === 'primary' ? vehicle.driverName : vehicle.reserveDriverName;
  async function save() {
    setBusy(true);
    try {
      const a = await fleetApi.createAssignment({ vehicleId: vehicle.id, driverId, role, basis, effectiveFrom: from, reason }, user);
      toast(`${a.number}: ${t('fleet_assignmentSent')}`);
      onSaved?.(a.id);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_assignDriver')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('fleet_sendForApproval')}</Button></>}>
      <div className="form-grid flt-mk">
        <Field label={t('fleet_assignRole')} required>
          <Select<FleetAssignmentRole> value={role} ariaLabel={t('fleet_assignRole')} onChange={setRole} options={(['primary', 'reserve'] as const).map((r) => ({ value: r, label: t(tk('fleet_role_', r)) }))} />
        </Field>
        <Field label={t('fleet_basis')} required>
          <Select<FleetAssignmentBasis> value={basis} ariaLabel={t('fleet_basis')} onChange={setBasis} options={(['order', 'power_of_attorney'] as const).map((r) => ({ value: r, label: t(tk('fleet_basis_', r)) }))} />
        </Field>
        <Field label={t('fleet_currentDriver')}>
          <Input value={current ?? '—'} readOnly ariaLabel={t('fleet_currentDriver')} />
        </Field>
        <Field label={t('fleet_newDriverField')} required>
          <Select<string> value={driverId} placeholder="—" ariaLabel={t('fleet_newDriverField')} onChange={(x) => { setDriverId(x); setError(''); }} options={(drivers.data ?? []).map((d) => ({ value: d.id, label: `${d.fullName} · ${d.licenseCategories.join(', ')}` }))} />
        </Field>
        <Field label={t('fleet_effectiveFrom')} required>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={t('fleet_effectiveFrom')} />
        </Field>
        <Field label={t('fleet_reason')} required className="span-2">
          <Textarea value={reason} rows={2} onChange={(e) => { setReason(e.target.value); setError(''); }} ariaLabel={t('fleet_reason')} />
        </Field>
      </div>
      <RouteSteps preview={{ entity: 'fleet_assignment', context: { subtype: basis } }} />
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

const CHECK: FleetChecklistItem[] = ['body', 'interior', 'tires', 'equipment', 'documents', 'keys'];

/** Акт приёма-передачи: пробег, топливо, состояние, дефекты (PR-FLT-032, 044, 045). */
export function ActModal({ assignment, vehicle, onClose }: { assignment: FleetAssignment; vehicle: FleetVehicleView; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const [date, setDate] = useState(today());
  const [odometer, setOdometer] = useState(String(vehicle.mileage));
  const [fuel, setFuel] = useState('');
  const [check, setCheck] = useState<Record<FleetChecklistItem, boolean>>({ body: true, interior: true, tires: true, equipment: true, documents: true, keys: true });
  const [defects, setDefects] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await fleetApi.completeAct(assignment.id, { date, odometer: num(odometer), fuelLevel: num(fuel), checklist: check, defects }, user);
      toast(`${assignment.number}: ${t('fleet_actDone')}`);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('fleet_handoverAct')} · ${vehicle.plate}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('fleet_completeAct')}</Button></>}>
      <div className="form-grid flt-mk">
        <Field label={t('date')} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} ariaLabel={t('date')} />
        </Field>
        <Field label={t('fleet_odometer')} required hint={`≥ ${formatNumber(vehicle.mileage)}`}>
          <Input type="number" value={odometer} onChange={(e) => { setOdometer(e.target.value); setError(''); }} ariaLabel={t('fleet_odometer')} />
        </Field>
        <Field label={t('fleet_fuelLevel')} required hint={`${t('fleet_tank')}: ${dec(vehicle.tankLitres, 0)}`}>
          <Input type="number" value={fuel} onChange={(e) => { setFuel(e.target.value); setError(''); }} ariaLabel={t('fleet_fuelLevel')} />
        </Field>
      </div>
      <Field label={t('fleet_condition')}>
        <div className="flt-check">
          {CHECK.map((c) => (
            <Checkbox key={c} checked={check[c]} onChange={(on) => setCheck((x) => ({ ...x, [c]: on }))}>{t(tk('fleet_check_', c))}</Checkbox>
          ))}
        </div>
      </Field>
      <Field label={t('fleet_defects')} hint={t('fleet_defectsHint')}>
        <Textarea value={defects} rows={2} onChange={(e) => { setDefects(e.target.value); setError(''); }} ariaLabel={t('fleet_defects')} />
      </Field>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

/** Распоряжение на зачисление средств на топливные карты в пределах лимитов (4.2.6.1, PR-FLT-051). */
export function TopUpModal({ onClose, onSaved }: { onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const cards = useApi(() => fleetApi.listCards(), []);
  const vehicles = useApi(() => fleetApi.list(), []);
  const next = (() => {
    const d = today();
    const m = Number(d.slice(5, 7));
    return m === 12 ? `${Number(d.slice(0, 4)) + 1}-01` : `${d.slice(0, 4)}-${String(m + 1).padStart(2, '0')}`;
  })();
  const [period, setPeriod] = useState(next);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = (cards.data ?? []).filter((c) => c.status === 'active');
  const total = active.reduce((a, c) => a + (num(amounts[c.id] ?? '') || 0), 0);
  const fillLimits = () => setAmounts(Object.fromEntries(active.map((c) => [c.id, String(fleetApi.cardRemaining(c.id, period))])));
  async function save() {
    setBusy(true);
    try {
      const tu = await fleetApi.createTopUp({ period, comment, lines: active.map((c) => ({ cardId: c.id, amount: num(amounts[c.id] ?? '') || 0 })) }, user);
      toast(`${tu.number}: ${t('fleet_topupSent')}`);
      onSaved?.(tu.id);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('fleet_newTopup')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={save}>{t('fleet_sendForApproval')}</Button></>}>
      <div className="form-grid flt-mk">
        <Field label={t('fleet_topupPeriod')} required hint="YYYY-MM">
          <Input value={period} maxLength={7} onChange={(e) => { setPeriod(e.target.value); setError(''); }} ariaLabel={t('fleet_topupPeriod')} />
        </Field>
        <Field label={t('comment')}>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} ariaLabel={t('comment')} />
        </Field>
      </div>
      <div className="flt-row" style={{ justifyContent: 'space-between', margin: '6px 0' }}>
        <b>{t('fleet_cards')}</b>
        <Button size="small" onClick={fillLimits}>{t('fleet_fillLimits')}</Button>
      </div>
      <div className="table-wrap">
        <table className="flt-lines">
          <thead><tr><th>{t('fleet_card')}</th><th>{t('fleet_plate')}</th><th>{t('fleet_remainingLimit')}</th><th className="w-num">{t('amount')}</th></tr></thead>
          <tbody>
            {active.map((c) => (
              <tr key={c.id}>
                <td>{c.number}</td>
                <td>{vehicles.data?.find((v) => v.id === c.vehicleId)?.plate}</td>
                <td className="num">{formatNumber(fleetApi.cardRemaining(c.id, period))}</td>
                <td><Input type="number" value={amounts[c.id] ?? ''} onChange={(e) => { setAmounts((x) => ({ ...x, [c.id]: e.target.value })); setError(''); }} ariaLabel={`${t('amount')} ${c.number}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flt-hint" style={{ marginTop: 8 }}><b>{t('total')}: {formatMoney(total)}</b></p>
      <RouteSteps preview={{ entity: 'fleet_topup', context: { amount: total } }} />
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}
