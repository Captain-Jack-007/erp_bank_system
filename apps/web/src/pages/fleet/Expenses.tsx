// Расходы автопарка: ГСМ, ТО и ремонт (+ обращения водителей), страхование, прочие расходы, штрафы (в т.ч. УБДД);
// карточка заказ-наряда ТО/ремонта (PR-FLT-046…084).
import { useState } from 'react';
import {
  fleetApi, fleetCanManage, fleetServiceCost, fleetServiceTotal, formatDate, formatMoney, formatNumber, tk, today,
  type FleetDocument, type FleetExpense, type FleetFine, type FleetFineStatus, type FleetVehicleView, type PrintDocument,
} from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Loading, PageHeader, Select, Tabs, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { Link, navigate, useQuery } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { dec, DueDate, FleetNav, Plate, useFleetErr, useOrgRefs } from './shared';
import { DocumentModal } from './forms';
import { FuelUpModal } from './tripForms';
import { ExpenseModal, FineModal, ServiceModal } from './expenseForms';
import { FuelTable, ServiceTable } from './VehicleDetail';

type Tab = 'fuel' | 'service' | 'insurance' | 'other' | 'fines';

/** Выбор ТС для добавления операции из общего реестра. */
function VehicleAdd({ label, kind, onPick }: { label: string; kind?: 'vehicle'; onPick: (v: FleetVehicleView) => void }) {
  const { t } = useSession();
  const list = useApi(() => fleetApi.list({ status: 'active', ...(kind ? { kind } : {}) }), [kind]);
  const [id, setId] = useState('');
  const v = list.data?.find((x) => x.id === id);
  return (
    <div className="flt-row">
      <Select<string> value={id} placeholder={`${t('fleet_plate')}…`} ariaLabel={t('fleet_plate')} onChange={setId} options={(list.data ?? []).map((x) => ({ value: x.id, label: `${x.plate} · ${x.brand} ${x.model}` }))} style={{ width: 220 }} />
      <Button size="small" type="primary" icon="plus" disabled={!v} onClick={() => v && onPick(v)}>{label}</Button>
    </div>
  );
}

export function ExpensesPage() {
  const { t } = useSession();
  const user = useUser();
  const q = useQuery();
  const canManage = fleetCanManage(user);
  const [tab, setTab] = useState<Tab>((q.get('tab') as Tab) || 'fuel');
  return (
    <>
      <PageHeader crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_expenses') }]} title={t('fleet_nav_expenses')} subtitle={t('fleet_expensesSub')} />
      <FleetNav active="expenses" />
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'fuel', label: t('fleet_psrc_fuel') },
            { value: 'service', label: t('fleet_service') },
            { value: 'insurance', label: t('fleet_psrc_insurance') },
            { value: 'other', label: t('fleet_otherExpenses') },
            { value: 'fines', label: t('fleet_fines') },
          ]}
        />
      </Card>
      {tab === 'fuel' && <FuelTab canManage={canManage} />}
      {tab === 'service' && <ServiceTab canManage={canManage} />}
      {tab === 'insurance' && <InsuranceTab canManage={canManage} />}
      {tab === 'other' && <OtherTab canManage={canManage} />}
      {tab === 'fines' && <FinesTab canManage={canManage} />}
    </>
  );
}

function FuelTab({ canManage }: { canManage: boolean }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const [pick, setPick] = useState<FleetVehicleView | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useApi(() => fleetApi.listFuelUps(), []);
  const vehicles = useApi(() => fleetApi.list(), []);
  async function sync() {
    setBusy(true);
    try {
      const r = await fleetApi.syncCardTransactions(user);
      toast(r.status === 'success' ? `${t('fleet_cardSyncDone')}: ${r.created}` : `${t('fleet_cardSyncQueued')}: ${t(tk('svc_status_', r.status))}`);
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  }
  const plate = (id: string) => vehicles.data?.find((v) => v.id === id)?.plate ?? id;
  return (
    <>
      <Card flush>
        <div className="flt-tablebar">
          <span className="muted">{t('fleet_fuelTabHint')}</span>
          <div className="flt-row">
            <ExportButton
              filename={t('fleet_fuelUps')}
              rows={list.data ?? []}
              columns={[
                { header: '№', value: (f) => f.number },
                { header: t('date'), value: (f) => f.date, format: 'date' },
                { header: t('fleet_plate'), value: (f) => plate(f.vehicleId) },
                { header: t('fleet_station'), value: (f) => f.station, width: 30 },
                { header: t('fleet_fuel'), value: (f) => t(tk('fleet_fuel_', f.fuel)) },
                { header: t('fleet_litres'), value: (f) => f.litres, format: 'number', total: true },
                { header: t('amount'), value: (f) => f.amount, format: 'money', total: true },
                { header: t('fleet_source'), value: (f) => t(tk('fleet_src_', f.source)) },
              ]}
            />
            {canManage && <Button size="small" icon="refresh" loading={busy} onClick={sync}>{t('fleet_cardSync')}</Button>}
            {canManage && <VehicleAdd label={t('fleet_addFuel')} onPick={setPick} />}
          </div>
        </div>
      </Card>
      <FuelTable />
      {pick && <FuelUpModal vehicle={pick} onClose={() => setPick(null)} />}
    </>
  );
}

function ServiceTab({ canManage }: { canManage: boolean }) {
  const { t } = useSession();
  const faults = useApi(() => fleetApi.listFaults({ status: 'new' }), []);
  const vehicles = useApi(() => fleetApi.list(), []);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const [pick, setPick] = useState<FleetVehicleView | null>(null);
  const [fromFault, setFromFault] = useState<{ v: FleetVehicleView; id: string; text: string } | null>(null);
  const [photo, setPhoto] = useState<{ id: string; number: string } | null>(null);
  return (
    <>
      <Card title={t('fleet_faultReports')} flush>
        {faults.data?.length ? faults.data.map((f) => {
          const v = vehicles.data?.find((x) => x.id === f.vehicleId);
          return (
            <div key={f.id} className="flt-list-item">
              <div className="flt-li-main">
                <b>{f.number}</b> · {v && <Link to={`/fleet/${v.id}`}><Plate value={v.plate} /></Link>} · {f.description}
                <div className="flt-li-sub">{formatDate(f.date)} · {drivers.data?.find((d) => d.id === f.driverId)?.fullName} · {t(tk('fleet_sev_', f.severity))}</div>
              </div>
              <Button size="small" type="text" icon="paperclip" title={t('fleet_faultPhoto')} onClick={() => setPhoto(photo?.id === f.id ? null : { id: f.id, number: f.number })} />
              {canManage && v && <Button size="small" onClick={() => setFromFault({ v, id: f.id, text: f.description })}>{t('fleet_createRepair')}</Button>}
            </div>
          );
        }) : <Empty text={t('fleet_noFaults')} icon="check" />}
      </Card>
      {photo && <Attachments entity="fleet_fault" entityId={photo.id} title={`${t('fleet_faultPhoto')} · ${photo.number}`} readOnly={!canManage} />}
      {canManage && <Card flush><div className="flt-tablebar"><span className="muted">{t('fleet_serviceTabHint')}</span><VehicleAdd label={t('fleet_newService')} onPick={setPick} /></div></Card>}
      <ServiceTable />
      {pick && <ServiceModal vehicle={pick} onClose={() => setPick(null)} onSaved={(id) => navigate(`/fleet/service/${id}`)} />}
      {fromFault && <ServiceModal vehicle={fromFault.v} kind="repair" faultReportId={fromFault.id} fault={fromFault.text} onClose={() => setFromFault(null)} onSaved={(id) => navigate(`/fleet/service/${id}`)} />}
    </>
  );
}

function InsuranceTab({ canManage }: { canManage: boolean }) {
  const { t } = useSession();
  const osago = useApi(() => fleetApi.listDocuments({ type: 'osago', includeReplaced: true }), []);
  const kasko = useApi(() => fleetApi.listDocuments({ type: 'kasko', includeReplaced: true }), []);
  const vehicles = useApi(() => fleetApi.list(), []);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const [renew, setRenew] = useState<FleetDocument | null>(null);
  const [onlyActive, setOnlyActive] = useState(true);
  const rows = [...(osago.data ?? []), ...(kasko.data ?? [])].filter((d) => !onlyActive || d.status === 'active').sort((a, b) => (a.validUntil ?? '').localeCompare(b.validUntil ?? ''));
  const plate = (id: string) => vehicles.data?.find((v) => v.id === id)?.plate ?? id;
  const year = today().slice(0, 4);
  const yearCost = [...(osago.data ?? []), ...(kasko.data ?? [])].filter((d) => d.validFrom.startsWith(year)).reduce((a, d) => a + d.cost, 0);
  const vr = renew ? vehicles.data?.find((v) => v.id === renew.vehicleId) : undefined;
  return (
    <Card
      title={`${t('fleet_policies')} · ${t('fleet_costYear')} ${year}: ${formatMoney(yearCost)}`}
      flush
      actions={
        <div className="flt-row">
          <Button size="small" onClick={() => setOnlyActive((x) => !x)}>{onlyActive ? t('fleet_showReplaced') : t('fleet_hideReplaced')}</Button>
          <ExportButton
            filename={t('fleet_policies')}
            rows={rows}
            columns={[
              { header: t('fleet_plate'), value: (d) => plate(d.vehicleId) },
              { header: t('fleet_docType'), value: (d) => t(tk('fleet_doc_', d.type)) },
              { header: t('fleet_docNumber'), value: (d) => d.number },
              { header: t('fleet_insurer'), value: (d) => d.issuer, width: 26 },
              { header: t('fleet_validFrom'), value: (d) => d.validFrom, format: 'date' },
              { header: t('fleet_validUntil'), value: (d) => d.validUntil ?? '', format: 'date' },
              { header: t('fleet_cost'), value: (d) => d.cost, format: 'money', total: true },
            ]}
          />
        </div>
      }
    >
      <DataTable rows={osago.data && kasko.data ? rows : undefined} loading={osago.loading} rowKey={(d) => d.id} columns={[
        { header: t('fleet_plate'), render: (d) => <Link to={`/fleet/${d.vehicleId}`}><Plate value={plate(d.vehicleId)} /></Link> },
        { header: t('fleet_docType'), render: (d) => t(tk('fleet_doc_', d.type)) },
        { header: t('fleet_docNumber'), render: (d) => (<><b>{d.number}</b><div className="sub">{d.issuer}</div></>) },
        { header: t('fleet_validFrom'), render: (d) => formatDate(d.validFrom) },
        { header: t('fleet_validUntil'), render: (d) => (d.status === 'active' ? <DueDate value={d.validUntil} /> : formatDate(d.validUntil ?? '')) },
        { header: t('fleet_cost'), align: 'right', render: (d) => formatMoney(d.cost) },
        { header: t('status'), render: (d) => <Badge tone={d.status === 'active' ? 'ok' : 'muted'}>{t(tk('fleet_docStatus_', d.status))}</Badge> },
        { header: '', render: (d) => (canManage && d.status === 'active' ? <Button size="small" onClick={() => setRenew(d)}>{t('fleet_renew')}</Button> : null) },
      ]} />
      {renew && vr && <DocumentModal vehicle={vr} type={renew.type} drivers={drivers.data ?? []} onClose={() => setRenew(null)} />}
    </Card>
  );
}

function OtherTab({ canManage }: { canManage: boolean }) {
  const { t } = useSession();
  const list = useApi(() => fleetApi.listExpenses(), []);
  const vehicles = useApi(() => fleetApi.list(), []);
  const [pick, setPick] = useState<FleetVehicleView | null>(null);
  const plate = (id: string) => vehicles.data?.find((v) => v.id === id)?.plate ?? id;
  return (
    <Card
      title={t('fleet_otherExpenses')}
      flush
      actions={
        <div className="flt-row">
          <ExportButton<FleetExpense> filename={t('fleet_otherExpenses')} rows={list.data ?? []} columns={[
            { header: '№', value: (e) => e.number }, { header: t('date'), value: (e) => e.date, format: 'date' }, { header: t('fleet_plate'), value: (e) => plate(e.vehicleId) },
            { header: t('type'), value: (e) => t(tk('fleet_exp_', e.kind)) }, { header: t('description'), value: (e) => e.description, width: 30 }, { header: t('amount'), value: (e) => e.amount, format: 'money', total: true },
          ]} />
          {canManage && <VehicleAdd label={t('fleet_addExpense')} onPick={setPick} />}
        </div>
      }
    >
      <DataTable rows={list.data} loading={list.loading} rowKey={(e) => e.id} columns={[
        { header: '№', render: (e) => <span className="doc-num">{e.number}</span> },
        { header: t('date'), render: (e) => formatDate(e.date) },
        { header: t('fleet_plate'), render: (e) => <Link to={`/fleet/${e.vehicleId}`}><Plate value={plate(e.vehicleId)} /></Link> },
        { header: t('type'), render: (e) => t(tk('fleet_exp_', e.kind)) },
        { header: t('description'), render: (e) => e.description },
        { header: t('amount'), align: 'right', render: (e) => formatMoney(e.amount) },
      ]} />
      {pick && <ExpenseModal vehicle={pick} onClose={() => setPick(null)} />}
    </Card>
  );
}

function FinesTab({ canManage }: { canManage: boolean }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const list = useApi(() => fleetApi.listFines(), []);
  const vehicles = useApi(() => fleetApi.list(), []);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const [pick, setPick] = useState<FleetVehicleView | null>(null);
  const [busy, setBusy] = useState(false);
  const plate = (id: string) => vehicles.data?.find((v) => v.id === id)?.plate ?? id;
  async function fetchUbdd() {
    setBusy(true);
    try {
      const r = await fleetApi.fetchFines(user);
      toast(`${t('fleet_ubddDone')}: ${r.checked} · ${t('fleet_newFines')}: ${r.created}${r.updated ? ` · ${t('fleet_ubddUpdated')}: ${r.updated}` : ''}${r.failed ? ` · ${t('fleet_ubddFailed')}: ${r.failed}` : ''}`);
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  }
  async function act(f: FleetFine, status: FleetFineStatus) {
    try {
      await fleetApi.setFineStatus(f.id, status, user);
      toast(`${f.protocolNo}: ${t(tk('fleet_fine_', status))}`);
    } catch (e) {
      toast(err(e));
    }
  }
  async function recover(f: FleetFine) {
    try {
      await fleetApi.setFineRecovery(f.id, !f.recoverFromDriver, user);
    } catch (e) {
      toast(err(e));
    }
  }
  const unpaid = (list.data ?? []).filter((f) => f.status === 'unpaid');
  return (
    <Card
      title={`${t('fleet_fines')} · ${t('fleet_fine_unpaid')}: ${unpaid.length} (${formatMoney(unpaid.reduce((a, f) => a + f.amount, 0))})`}
      flush
      actions={
        <div className="flt-row">
          <ExportButton<FleetFine> filename={t('fleet_fines')} rows={list.data ?? []} columns={[
            { header: t('date'), value: (f) => f.date, format: 'date' }, { header: t('fleet_plate'), value: (f) => plate(f.vehicleId) }, { header: t('fleet_protocolNo'), value: (f) => f.protocolNo, width: 26 },
            { header: t('fleet_violation'), value: (f) => f.violation, width: 30 }, { header: t('fleet_driver'), value: (f) => drivers.data?.find((d) => d.id === f.driverId)?.fullName ?? '' },
            { header: t('amount'), value: (f) => f.amount, format: 'money', total: true }, { header: t('status'), value: (f) => t(tk('fleet_fine_', f.status)) },
          ]} />
          {canManage && <Button size="small" icon="refresh" loading={busy} onClick={fetchUbdd}>{t('fleet_fetchUbdd')}</Button>}
          {canManage && <VehicleAdd label={t('fleet_addFine')} kind="vehicle" onPick={setPick} />}
        </div>
      }
    >
      <DataTable rows={list.data} loading={list.loading} rowKey={(f) => f.id} columns={[
        { header: t('date'), render: (f) => formatDate(f.date) },
        { header: t('fleet_plate'), render: (f) => <Link to={`/fleet/${f.vehicleId}`}><Plate value={plate(f.vehicleId)} /></Link> },
        { header: t('fleet_protocolNo'), render: (f) => (<>{f.protocolNo}<div className="sub">{t(tk('fleet_src_', f.source))}</div></>) },
        { header: t('fleet_violation'), render: (f) => (<>{f.violation}<div className="sub">{drivers.data?.find((d) => d.id === f.driverId)?.fullName}</div></>) },
        { header: t('amount'), align: 'right', render: (f) => formatMoney(f.amount) },
        { header: t('status'), render: (f) => (<><Badge tone={f.status === 'paid' ? 'ok' : f.status === 'unpaid' ? 'warn' : 'muted'}>{t(tk('fleet_fine_', f.status))}</Badge>{f.recoverFromDriver && <div className="sub">{t('fleet_recover')}</div>}</>) },
        {
          header: '',
          render: (f) => canManage && (f.status === 'unpaid' || f.status === 'disputed') ? (
            <div className="flt-row">
              <Button size="small" type="primary" onClick={() => act(f, 'paid')}>{t('fleet_pay')}</Button>
              {f.status === 'unpaid' && <Button size="small" onClick={() => act(f, 'disputed')}>{t('fleet_dispute')}</Button>}
              {f.status === 'disputed' && <Button size="small" onClick={() => act(f, 'cancelled')}>{t('fleet_cancelFine')}</Button>}
              <Button size="small" type="text" onClick={() => recover(f)}>{f.recoverFromDriver ? t('fleet_noRecover') : t('fleet_recoverBtn')}</Button>
            </div>
          ) : null,
        },
      ]} />
      {pick && <FineModal vehicle={pick} onClose={() => setPick(null)} />}
    </Card>
  );
}

/** Заказ-наряд ТО / ремонта. */
export function ServiceDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const lk = useLookups();
  const org = useOrgRefs();
  const canManage = fleetCanManage(user);
  const sq = useApi(() => fleetApi.getService(id), [id]);
  const s = sq.data;
  const vq = useApi(() => (s ? fleetApi.get(s.vehicleId) : Promise.resolve(undefined)), [s?.vehicleId]);
  const posting = useApi(() => fleetApi.listPostings(), []);
  const [edit, setEdit] = useState(false);
  if (sq.loading && !s) return <Card><Loading /></Card>;
  if (!s) return <Card><Empty text={t('empty')} /></Card>;
  const v = vq.data;
  const tot = fleetServiceTotal(s);
  const p = posting.data?.find((x) => x.sourceId === s.id);
  async function complete() {
    try {
      await fleetApi.completeService(s!.id, { doneDate: today() }, user);
      toast(`${s!.number}: ${t('fleet_sstatus_done')}`);
    } catch (e) {
      toast(err(e));
    }
  }
  async function cancel() {
    try {
      await fleetApi.cancelService(s!.id, user);
      toast(`${s!.number}: ${t('fleet_sstatus_cancelled')}`);
    } catch (e) {
      toast(err(e));
    }
  }
  const actDoc = (): PrintDocument => ({
    entity: 'fleet_service',
    entityId: s.id,
    title: s.kind === 'maintenance' ? t('fleet_actMaintenance') : t('fleet_actRepair'),
    number: s.number,
    date: s.doneDate ?? s.date,
    fields: [
      { label: t('fleet_plate'), value: `${v?.plate ?? ''} · ${v?.brand ?? ''} ${v?.model ?? ''} · VIN ${v?.vin ?? ''}` },
      { label: t('fleet_contractor'), value: lk.counterparty(s.contractorId ?? '')?.name ?? '—' },
      { label: s.kind === 'repair' ? t('fleet_fault') : t('fleet_maintenanceKind'), value: s.fault },
      { label: t('fleet_odometer'), value: formatNumber(s.odometer) },
      { label: t('fleet_warranty'), value: s.warranty ? `${t('svc_yes')} · ${s.warrantyNote}` : t('svc_no') },
      { label: t('fleet_costCenter'), value: org.ccLabel(s.costCenterKey) },
    ],
    table: {
      columns: [{ header: '№', align: 'center', width: '6%' }, { header: t('fleet_workName') }, { header: t('fleet_qty'), align: 'right' }, { header: t('fleet_price'), align: 'right' }, { header: t('amount'), align: 'right' }],
      rows: [
        ...s.works.map((w, i) => [String(i + 1), w.name, `${dec(w.hours)} ${t('fleet_hoursShort')}`, '', formatMoney(w.cost)]),
        ...s.parts.map((pp, i) => [String(s.works.length + i + 1), pp.name, `${dec(pp.qty)} ${pp.unit}`, formatMoney(pp.price), formatMoney(Math.round(pp.qty * pp.price))]),
      ],
      totals: ['', t('total'), '', '', formatMoney(tot.total)],
    },
    signers: [
      { role: t('fleet_contractor'), name: lk.counterparty(s.contractorId ?? '')?.name ?? '' },
      { role: t('fleet_responsible'), name: user.fullName },
    ],
  });
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_expenses'), to: '/fleet/expenses?tab=service' }, { label: s.number }]}
        title={`${s.number} · ${t(tk('fleet_svc_', s.kind))}`}
        subtitle={`${v?.plate ?? ''} · ${formatDate(s.date)}${s.doneDate ? ` — ${formatDate(s.doneDate)}` : ''}`}
        actions={
          <>
            <Badge tone={s.status === 'done' ? 'ok' : s.status === 'open' ? 'warn' : 'muted'}>{t(tk('fleet_sstatus_', s.status))}</Badge>
            {canManage && s.status === 'open' && <Button icon="pen" onClick={() => setEdit(true)}>{t('fleet_editService')}</Button>}
            {canManage && s.status === 'open' && <Button onClick={cancel}>{t('fleet_cancelService')}</Button>}
            {canManage && s.status === 'open' && <Button type="primary" icon="check" onClick={complete}>{t('fleet_completeService')}</Button>}
            <PrintButton doc={actDoc} template="act" />
          </>
        }
      />
      <div className="grid grid-main">
        <div className="flt-stack">
          <Card title={t('fleet_works')} flush>
            <DataTable rows={s.works} rowKey={(w) => w.name} emptyText={t('fleet_noLines')} columns={[
              { header: t('fleet_workName'), render: (w) => w.name },
              { header: t('fleet_hoursShort'), align: 'right', render: (w) => dec(w.hours) },
              { header: t('fleet_cost'), align: 'right', render: (w) => formatMoney(w.cost) },
            ]} />
          </Card>
          <Card title={t('fleet_parts')} flush>
            <DataTable rows={s.parts} rowKey={(pp) => pp.name} emptyText={t('fleet_noLines')} columns={[
              { header: t('fleet_partName'), render: (pp) => pp.name },
              { header: t('fleet_qty'), align: 'right', render: (pp) => `${dec(pp.qty)} ${pp.unit}` },
              { header: t('fleet_price'), align: 'right', render: (pp) => formatMoney(pp.price) },
              { header: t('amount'), align: 'right', render: (pp) => formatMoney(Math.round(pp.qty * pp.price)) },
            ]} />
          </Card>
          <Attachments entity="fleet_service" entityId={s.id} title={t('fleet_serviceDocs')} readOnly={!canManage} />
          {s.faultReportId && <Attachments entity="fleet_fault" entityId={s.faultReportId} title={t('fleet_faultPhoto')} readOnly />}
        </div>
        <div className="flt-stack">
          <Card title={t('details')}>
            <dl className="kv" style={{ gridTemplateColumns: '140px 1fr' }}>
              <dt>{t('fleet_plate')}</dt><dd>{v ? <Link to={`/fleet/${v.id}`}><Plate value={v.plate} /></Link> : '—'}</dd>
              <dt>{s.kind === 'repair' ? t('fleet_fault') : t('fleet_maintenanceKind')}</dt><dd>{s.fault}</dd>
              <dt>{t('fleet_contractor')}</dt><dd>{lk.counterparty(s.contractorId ?? '')?.name ?? <span className="muted">—</span>}</dd>
              <dt>{t('fleet_odometer')}</dt><dd className="num">{formatNumber(s.odometer)}</dd>
              <dt>{t('fleet_warranty')}</dt><dd>{s.warranty ? <Badge tone="info">{t('fleet_warrantyRepair')}</Badge> : t('svc_no')}{s.warrantyNote && <div className="sub">{s.warrantyNote}</div>}</dd>
              <dt>{t('fleet_works')}</dt><dd className="num">{formatMoney(tot.works)}</dd>
              <dt>{t('fleet_parts')}</dt><dd className="num">{formatMoney(tot.parts)}</dd>
              <dt>{t('total')}</dt><dd className="num"><b>{formatMoney(tot.total)}</b></dd>
              <dt>{t('fleet_costForBank')}</dt><dd className="num">{formatMoney(fleetServiceCost(s))}</dd>
              <dt>{t('fleet_costCenter')}</dt><dd>{org.ccLabel(s.costCenterKey)}</dd>
              <dt>{t('fleet_posting')}</dt><dd>{p ? <Link to="/fleet/postings">{p.number} · {t(tk('fleet_ps_', p.status))}</Link> : <span className="muted">{s.status === 'done' ? t('fleet_noPostingWarranty') : t('fleet_postingOnComplete')}</span>}</dd>
            </dl>
          </Card>
        </div>
      </div>
      {edit && v && <ServiceModal vehicle={v} service={s} onClose={() => setEdit(false)} />}
    </>
  );
}
