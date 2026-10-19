// Карточка ТС / генератора: реквизиты, фото, QR, лимиты, документы, путевые листы / журнал работы, ГСМ, ТО и ремонт,
// прочие расходы и штрафы, история закреплений, история изменений, отчёт по карточке (PR-FLT-001…028, 046…084).
import { useEffect, useMemo, useState } from 'react';
import {
  currencyLabel, filesApi, fleetApi, fleetCanManage, fleetDriverOf, fleetServiceCost, fleetServiceTotal, formatDate, formatDateTime, formatMoney, formatNumber, previewKind, tk, today,
  type FleetDocType, type FleetPeriod, type FleetVehicleView, type PrintDocument,
} from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Dropdown, Empty, Loading, PageHeader, Progress, StatusBadge, Tabs, useToast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { Attachments } from '../../components/Attachments';
import { FieldHistory } from '../../components/FieldHistory';
import { exportXlsx, toSheet } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { QrCode } from '../../components/QrCode';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { dec, DueDate, FLEET_TONE, PeriodPicker, Plate, periodLabel, useFleetErr, useOrgRefs } from './shared';
import { AssetLinkModal, DocumentModal, StatusModal, VehicleFormModal, WriteoffModal } from './forms';
import { FaultModal, FuelUpModal, OpenTripModal, RunLogModal } from './tripForms';
import { AssignmentModal, ExpenseModal, FineModal, ServiceModal } from './expenseForms';
import { TripsTable } from './Trips';

type Tab = 'overview' | 'documents' | 'trips' | 'fuel' | 'service' | 'other' | 'assignments' | 'history' | 'report';
type ModalKind = 'edit' | 'status' | 'writeoff' | 'asset' | 'doc' | 'trip' | 'fuel' | 'run' | 'service' | 'expense' | 'fine' | 'assign' | 'fault' | null;

/** Фото ТС: последнее изображение из вложений «Фото». */
function PhotoBox({ vehicleId }: { vehicleId: string }) {
  const { t } = useSession();
  const files = useApi(() => filesApi.list('fleet_photo', vehicleId), [vehicleId]);
  const img = (files.data ?? []).filter((f) => previewKind(f.mime, f.name) === 'image').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    if (img)
      filesApi.content(img.id).then((c) => {
        if (!alive) return;
        u = URL.createObjectURL(new Blob([c.data as BlobPart], { type: c.mime }));
        setUrl(u);
      });
    else setUrl(null);
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [img?.id]);
  return <div className="flt-photo" data-testid="flt-photo">{url ? <img src={url} alt={t('fleet_photo')} /> : <span><Icon name="car" size={36} /><br />{t('fleet_noPhoto')}</span>}</div>;
}

function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  return (
    <div className="flt-meter">
      <div className="flt-meter-head"><span>{label}</span><b className={pct > 100 ? 'flt-over' : ''}>{dec(used, 0)} / {formatNumber(limit)} {unit} ({pct}%)</b></div>
      <Progress pct={Math.min(100, pct)} />
    </div>
  );
}

export function VehicleDetailPage({ id }: { id: string }) {
  const { t, loc, lang } = useSession();
  const user = useUser();
  const toast = useToast();
  const org = useOrgRefs();
  const err = useFleetErr();
  const canManage = fleetCanManage(user);
  const me = fleetDriverOf(user);
  const vq = useApi(() => fleetApi.get(id), [id]);
  const docs = useApi(() => fleetApi.listDocuments({ vehicleId: id, includeReplaced: true }), [id]);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const alerts = useApi(() => fleetApi.listAlerts(), []);
  const usage = useApi(() => fleetApi.limitUsage(id), [id]);
  const monthTrips = useApi(() => fleetApi.listTrips({ vehicleId: id, status: 'closed', from: `${today().slice(0, 7)}-01` }), [id]);
  const [tab, setTab] = useState<Tab>('overview');
  const [modal, setModal] = useState<ModalKind>(null);
  const [docType, setDocType] = useState<FleetDocType | undefined>();
  const [showReplaced, setShowReplaced] = useState(false);
  const [period, setPeriod] = useState<FleetPeriod>(() => fleetApi.currentPeriod('month'));

  if (vq.loading && !vq.data) return <Card><Loading /></Card>;
  const v = vq.data;
  if (!v) return <Card><Empty text={t('empty')} /></Card>;
  const gen = v.kind === 'generator';
  const self = !!me && (v.primaryDriverId === me.id || v.reserveDriverId === me.id);
  const live = v.status !== 'written_off';
  const mine = (alerts.data ?? []).filter((a) => a.vehicleId === v.id);
  const unit = gen ? t('fleet_h') : 'km';
  const kmLeft = v.nextServiceKm - v.mileage;
  const servicePct = Math.min(100, Math.max(0, Math.round(((v.serviceIntervalKm - Math.max(0, kmLeft)) / v.serviceIntervalKm) * 100)));
  const open = (m: ModalKind, dt?: FleetDocType) => {
    setDocType(dt);
    setModal(m);
  };
  async function registerAsset() {
    try {
      await fleetApi.registerAsFixedAsset(v!.id, user);
      toast(`${v!.plate}: ${t('fleet_assetRegistered')}`);
    } catch (e) {
      toast(err(e));
    }
  }
  const qrValue = `${window.location.origin}${window.location.pathname}#/fleet/${v.id}`;

  const actions = [
    ...(canManage && live ? [{ key: 'edit', label: t('fleet_editCard'), icon: 'pen' as const, onClick: () => open('edit') }] : []),
    ...(canManage && live && v.status !== 'writeoff_pending' ? [{ key: 'status', label: t('fleet_changeStatus'), icon: 'refresh' as const, onClick: () => open('status') }] : []),
    ...((canManage || self) && live ? [{ key: 'fuel', label: t('fleet_addFuel'), icon: 'plus' as const, onClick: () => open('fuel') }] : []),
    ...(canManage && gen && live ? [{ key: 'run', label: t('fleet_addRun'), icon: 'clock' as const, onClick: () => open('run') }] : []),
    ...(canManage && live ? [{ key: 'service', label: t('fleet_newService'), icon: 'car' as const, onClick: () => open('service') }] : []),
    ...(canManage && live ? [{ key: 'expense', label: t('fleet_addExpense'), icon: 'wallet' as const, onClick: () => open('expense') }] : []),
    ...(canManage && live && !gen ? [{ key: 'fine', label: t('fleet_addFine'), icon: 'alert' as const, onClick: () => open('fine') }] : []),
    ...(canManage && live ? [{ key: 'doc', label: t('fleet_addDoc'), icon: 'file' as const, onClick: () => open('doc') }] : []),
    ...(canManage && live && !gen ? [{ key: 'assign', label: t('fleet_assignDriver'), icon: 'user' as const, onClick: () => open('assign') }] : []),
    ...(canManage && live ? [{ key: 'asset', label: t('fleet_linkAsset'), icon: 'box' as const, onClick: () => open('asset') }] : []),
    ...(canManage && live && !gen && !v.assetId ? [{ key: 'register', label: t('fleet_registerAsset'), icon: 'building' as const, onClick: () => void registerAsset() }] : []),
    ...((self || canManage) && live && !gen ? [{ key: 'fault', label: t('fleet_reportFault'), icon: 'alert' as const, onClick: () => open('fault') }] : []),
    ...(canManage && live && v.status !== 'writeoff_pending' ? [{ key: 'writeoff', label: t('fleet_writeoff'), icon: 'trash' as const, onClick: () => open('writeoff') }] : []),
  ];

  const cardDoc = (): PrintDocument => ({
    entity: 'fleet_vehicle',
    entityId: v.id,
    title: gen ? t('fleet_cardTitleGen') : t('fleet_cardTitle'),
    number: v.plate,
    date: today(),
    fields: [
      { label: t('fleet_brand'), value: `${v.brand} ${v.model}, ${v.year}` },
      { label: gen ? t('fleet_serialNo') : t('fleet_vin'), value: v.vin },
      { label: gen ? t('fleet_genPassport') : t('fleet_techPassport'), value: v.techPassportNo },
      { label: t('fleet_vehicleType'), value: `${t(tk('fleet_type_', v.vehicleType))} · ${t(tk('fleet_purpose_', v.purpose))}` },
      { label: t('fleet_fuel'), value: `${t(tk('fleet_fuel_', v.fuel))} · ${t(gen ? 'fleet_normGen' : 'fleet_norm')}: ${dec(v.fuelNorm)} (+${v.winterPct}% / +${v.cityPct}%)` },
      { label: t('fleet_limits'), value: `${formatNumber(v.limitLitres)} ${t('fleet_l')} · ${formatMoney(v.limitSum)}` },
      { label: t('fleet_balanceValue'), value: `${formatMoney(v.balanceValue)}${v.assetInventoryNo ? ` (${t('fleet_asset')} ${v.assetInventoryNo})` : ''}` },
      { label: t('fleet_orgUnit'), value: org.unitName(v.orgUnitKey) },
      { label: t('fleet_costCenter'), value: org.ccLabel(v.costCenterKey) },
      { label: gen ? t('fleet_hours') : t('fleet_mileage'), value: formatNumber(v.mileage) },
      { label: t('fleet_driver'), value: `${v.driverName ?? '—'}${v.reserveDriverName ? ` / ${t('fleet_role_reserve')}: ${v.reserveDriverName}` : ''}` },
      { label: t('status'), value: t(tk('fleet_status_', v.status)) },
    ],
    table: {
      columns: [{ header: t('fleet_docType') }, { header: t('fleet_docNumber') }, { header: t('fleet_validFrom') }, { header: t('fleet_validUntil') }],
      rows: (docs.data ?? []).filter((d) => d.status === 'active').map((d) => [t(tk('fleet_doc_', d.type)), d.number, formatDate(d.validFrom), d.validUntil ? formatDate(d.validUntil) : '—']),
    },
    signers: [{ role: t('fleet_responsible'), name: user.fullName, position: loc(user.position) }],
  });
  const labelDoc = (): PrintDocument => ({ entity: 'fleet_vehicle', entityId: v.id, title: t('fleet_qrLabel'), number: v.plate, fields: [{ label: t('fleet_model'), value: `${v.brand} ${v.model}` }, { label: gen ? t('fleet_serialNo') : t('fleet_vin'), value: v.vin }, { label: t('fleet_orgUnit'), value: org.unitName(v.orgUnitKey) }], paragraphs: [t('fleet_qrLabelText')] });

  const daily = (() => {
    const days = new Map<string, number>();
    for (const tr of monthTrips.data ?? []) days.set(tr.date, (days.get(tr.date) ?? 0) + ((tr.odoEnd ?? tr.odoStart) - tr.odoStart));
    return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();
  const monthKm = daily.reduce((a, [, k]) => a + k, 0);
  const todayKm = daily.find(([d]) => d === today())?.[1] ?? 0;

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: t('fleet_nav_overview') },
    { value: 'documents', label: t('fleet_documents') },
    { value: 'trips', label: gen ? t('fleet_runLog') : t('fleet_trips') },
    { value: 'fuel', label: t('fleet_psrc_fuel') },
    { value: 'service', label: t('fleet_service') },
    { value: 'other', label: t('fleet_otherFines') },
    ...(gen ? [] : [{ value: 'assignments' as const, label: t('fleet_assignHistory') }]),
    { value: 'history', label: t('history') },
    { value: 'report', label: t('fleet_vehicleReport') },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_vehicles'), to: '/fleet/vehicles' }, { label: v.plate }]}
        title={`${v.plate} · ${v.brand} ${v.model}`}
        subtitle={`${v.year} · ${t(tk('fleet_type_', v.vehicleType))} · ${t(tk('fleet_fuel_', v.fuel))} · ${t(tk('fleet_purpose_', v.purpose))}`}
        actions={
          <>
            <StatusBadge prefix="fleet_status_" status={v.status} tone={FLEET_TONE[v.status]} />
            {v.onTrip && <Badge tone="info">{t('fleet_onTrip')}</Badge>}
            {!gen && (canManage || self) && v.status === 'in_operation' && !v.onTrip && !v.pendingTripId && <Button type="primary" icon="plus" onClick={() => open('trip')}>{t('fleet_openTrip')}</Button>}
            {v.pendingTripId && <Button onClick={() => navigate(`/fleet/trips/${v.pendingTripId}`)}>{t('fleet_pendingTripCard')}</Button>}
            {v.openTripId && <Button onClick={() => navigate(`/fleet/trips/${v.openTripId}`)}>{t('fleet_openTripCard')}</Button>}
            <PrintButton doc={cardDoc} template="card" />
            {actions.length > 0 && (
              <Dropdown menu={{ items: actions }}>
                <Button icon="menu">{t('fleet_actions')}</Button>
              </Dropdown>
            )}
          </>
        }
      />

      {mine.length > 0 && (
        <div className="card" style={{ padding: '12px 16px', borderLeft: '3px solid var(--warn)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <b>{t('fleet_alerts')}:</b>
          {mine.map((a) => (
            <Badge key={a.id} tone={a.expired ? 'danger' : 'warn'}>{t(tk('fleet_alert_', a.kind))}{a.due ? ` · ${formatDate(a.due)}` : ''}</Badge>
          ))}
        </div>
      )}
      {v.status === 'writeoff_pending' && <div className="flt-warnbox">{t('fleet_writeoffPendingNote')} {v.writeoffReason ? `— ${v.writeoffReason}` : ''} {v.writeoffActId && <Link to={`/assets/writeoffs/${v.writeoffActId}`}>{t('fleet_openWriteoffAct')}</Link>} {v.assetId && <Link to={`/assets/${v.assetId}`}>{t('fleet_openAsset')}</Link>}</div>}
      {v.status === 'written_off' && <div className="flt-dangerbox">{t('fleet_writtenOffNote')} {v.writeoffReason ? `— ${v.writeoffReason}` : ''}</div>}

      <Card flush>
        <Tabs<Tab> value={tab} onChange={setTab} items={tabs} />
      </Card>

      {tab === 'overview' && (
        <div className="grid grid-main">
          <div className="flt-stack">
            <Card title={t('fleet_requisites')}>
              <dl className="kv">
                <dt>{t('fleet_kind')}</dt><dd>{t(tk('fleet_kind_', v.kind))}</dd>
                <dt>{gen ? t('fleet_plateGen') : t('fleet_plate')}</dt><dd><Plate value={v.plate} /></dd>
                <dt>{t('fleet_brand')} / {t('fleet_model')}</dt><dd>{v.brand} {v.model}</dd>
                <dt>{t('fleet_year')}</dt><dd>{v.year}</dd>
                <dt>{gen ? t('fleet_serialNo') : t('fleet_vin')}</dt><dd className="num">{v.vin}</dd>
                <dt>{gen ? t('fleet_genPassport') : t('fleet_techPassport')}</dt><dd>{v.techPassportNo}</dd>
                <dt>{t('fleet_vehicleType')}</dt><dd>{t(tk('fleet_type_', v.vehicleType))}</dd>
                <dt>{t('fleet_fuel')}</dt><dd>{t(tk('fleet_fuel_', v.fuel))}</dd>
                <dt>{gen ? t('fleet_normGen') : t('fleet_norm')}</dt><dd>{dec(v.fuelNorm)} · {t('fleet_winterPct')}: +{v.winterPct}%{gen ? '' : ` · ${t('fleet_cityPct')}: +${v.cityPct}%`}</dd>
                <dt>{t('fleet_balanceValue')}</dt><dd>{formatMoney(v.balanceValue)}{v.assetId && <> · <Link to={`/assets/${v.assetId}`}>{t('fleet_asset')} {v.assetInventoryNo ?? v.assetId}</Link></>}{!v.assetId && <span className="muted small"> · {t('fleet_noAsset')}</span>}</dd>
                <dt>{t('fleet_orgUnit')}</dt><dd>{org.unitName(v.orgUnitKey)}</dd>
                <dt>{t('fleet_costCenter')}</dt><dd>{org.ccLabel(v.costCenterKey)}</dd>
                <dt>{t('fleet_expenseAccount')}</dt><dd className="num">{v.expenseAccount}</dd>
                <dt>{gen ? t('fleet_hours') : t('fleet_mileage')}</dt><dd className="num">{formatNumber(v.mileage)}</dd>
                <dt>{t('fleet_tank')}</dt><dd>{dec(v.tankLitres, 0)}</dd>
              </dl>
            </Card>
            <Card title={`${t('fleet_limitMonth')} · ${periodLabel(fleetApi.currentPeriod('month'), lang)}`}>
              {usage.data && (v.limitLitres > 0 || v.limitSum > 0) ? (
                <>
                  <Meter label={t('fleet_limitLitres')} used={usage.data.litres} limit={v.limitLitres} unit={t('fleet_l')} />
                  <Meter label={t('fleet_limitSum')} used={usage.data.amount} limit={v.limitSum} unit={currencyLabel()} />
                </>
              ) : (
                <Empty text={t('fleet_noLimits')} icon="wallet" />
              )}
            </Card>
            {!gen && (
              <Card title={`${t('fleet_dailyMileage')} · ${t('fleet_today')}: ${formatNumber(todayKm)} · ${t('fleet_month')}: ${formatNumber(monthKm)} km`}>
                {daily.length ? <BarChart data={daily.map(([d, k]) => ({ label: d.slice(8, 10), values: [k] }))} series={[{ name: 'km' }]} height={180} /> : <Empty text={t('fleet_noTripsMonth')} icon="chart" />}
              </Card>
            )}
          </div>
          <div className="flt-stack">
            <Card title={t('fleet_photo')}>
              <PhotoBox vehicleId={v.id} />
            </Card>
            <Attachments entity="fleet_photo" entityId={v.id} title={t('fleet_photos')} readOnly={!canManage} />
            <Card title={t('fleet_qr')}>
              <div className="flt-qr">
                <QrCode value={qrValue} size={112} title={v.plate} />
                <div>
                  <div className="small muted">{t('fleet_qrHint')}</div>
                  <div style={{ marginTop: 8 }}><PrintButton doc={labelDoc} template="card" label={t('fleet_printLabel')} /></div>
                  <div className="small muted" style={{ marginTop: 8 }}>{t('fleet_nfcNote')}</div>
                </div>
              </div>
            </Card>
            <Card title={t('fleet_nextService')}>
              <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{formatNumber(v.nextServiceKm)} {unit} · {formatDate(v.nextServiceDate)}</div>
              <div className="muted small" style={{ margin: '4px 0 10px' }}>
                {kmLeft > 0 ? `${t('fleet_left')}: ${formatNumber(kmLeft)} ${unit}` : t('fleet_alert_service')} · {t('fleet_interval')}: {formatNumber(v.serviceIntervalKm)} {unit} / {v.serviceIntervalMonths} {t('fleet_monthsShort')}
              </div>
              <Progress pct={servicePct} />
            </Card>
            {!gen && (
              <Card title={t('fleet_drivers')}>
                <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
                  <dt>{t('fleet_role_primary')}</dt><dd>{v.primaryDriverId ? <Link to={`/fleet/drivers/${v.primaryDriverId}`}>{v.driverName}</Link> : '—'}</dd>
                  <dt>{t('fleet_role_reserve')}</dt><dd>{v.reserveDriverId ? <Link to={`/fleet/drivers/${v.reserveDriverId}`}>{v.reserveDriverName}</Link> : '—'}</dd>
                </dl>
                {canManage && live && <div style={{ marginTop: 10 }}><Button size="small" icon="user" onClick={() => open('assign')}>{t('fleet_assignDriver')}</Button></div>}
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div className="flt-stack">
          <Card
            title={t('fleet_documents')}
            flush
            actions={
              <div className="flt-row">
                <Button size="small" onClick={() => setShowReplaced((x) => !x)}>{showReplaced ? t('fleet_hideReplaced') : t('fleet_showReplaced')}</Button>
                {canManage && live && <Button size="small" type="primary" icon="plus" onClick={() => open('doc')}>{t('fleet_addDoc')}</Button>}
              </div>
            }
          >
            <DataTable
              rows={(docs.data ?? []).filter((d) => showReplaced || d.status === 'active')}
              loading={docs.loading}
              rowKey={(d) => d.id}
              columns={[
                { header: t('fleet_docType'), render: (d) => t(tk('fleet_doc_', d.type)) },
                { header: t('fleet_docNumber'), render: (d) => (<><b>{d.number}</b><div className="sub">{d.issuer}{d.driverId ? ` · ${drivers.data?.find((x) => x.id === d.driverId)?.fullName ?? ''}` : ''}</div></>) },
                { header: t('fleet_validFrom'), render: (d) => formatDate(d.validFrom) },
                { header: t('fleet_validUntil'), render: (d) => (d.status === 'active' ? <DueDate value={d.validUntil} /> : d.validUntil ? formatDate(d.validUntil) : '—') },
                { header: t('fleet_cost'), align: 'right', render: (d) => (d.cost ? formatMoney(d.cost) : '—') },
                { header: t('status'), render: (d) => <Badge tone={d.status === 'active' ? 'ok' : 'muted'}>{t(tk('fleet_docStatus_', d.status))}</Badge> },
                { header: '', render: (d) => (canManage && live && d.status === 'active' && d.type !== 'tech_passport' ? <Button size="small" onClick={() => open('doc', d.type)}>{t('fleet_renew')}</Button> : null) },
              ]}
            />
          </Card>
          <Attachments entity="fleet_vehicle_docs" entityId={v.id} title={t('fleet_docScans')} readOnly={!canManage} />
        </div>
      )}

      {tab === 'trips' && (gen ? <RunLogTable vehicle={v} canAdd={canManage && live} onAdd={() => open('run')} /> : <Card flush title={t('fleet_trips')}><TripsTable vehicleId={v.id} /></Card>)}
      {tab === 'fuel' && <FuelTable vehicle={v} canAdd={(canManage || self) && live} onAdd={() => open('fuel')} />}
      {tab === 'service' && <ServiceTable vehicleId={v.id} canAdd={canManage && live} onAdd={() => open('service')} />}
      {tab === 'other' && <OtherTables vehicle={v} canAdd={canManage && live} onExpense={() => open('expense')} onFine={() => open('fine')} />}
      {tab === 'assignments' && <AssignHistory vehicleId={v.id} />}
      {tab === 'history' && <HistoryTab vehicleId={v.id} />}
      {tab === 'report' && <VehicleReport vehicle={v} period={period} setPeriod={setPeriod} />}

      {modal === 'edit' && <VehicleFormModal vehicle={v} onClose={() => setModal(null)} />}
      {modal === 'status' && <StatusModal vehicle={v} onClose={() => setModal(null)} />}
      {modal === 'writeoff' && <WriteoffModal vehicle={v} onClose={() => setModal(null)} />}
      {modal === 'asset' && <AssetLinkModal vehicle={v} onClose={() => setModal(null)} />}
      {modal === 'doc' && <DocumentModal vehicle={v} {...(docType ? { type: docType } : {})} drivers={drivers.data ?? []} onClose={() => setModal(null)} />}
      {modal === 'trip' && <OpenTripModal vehicleId={v.id} onClose={() => setModal(null)} onSaved={(tid) => navigate(`/fleet/trips/${tid}`)} />}
      {modal === 'fuel' && <FuelUpModal vehicle={v} onClose={() => setModal(null)} />}
      {modal === 'run' && <RunLogModal vehicle={v} onClose={() => setModal(null)} />}
      {modal === 'service' && <ServiceModal vehicle={v} onClose={() => setModal(null)} onSaved={(sid) => navigate(`/fleet/service/${sid}`)} />}
      {modal === 'expense' && <ExpenseModal vehicle={v} onClose={() => setModal(null)} />}
      {modal === 'fine' && <FineModal vehicle={v} onClose={() => setModal(null)} />}
      {modal === 'assign' && <AssignmentModal vehicle={v} onClose={() => setModal(null)} onSaved={(aid) => navigate(`/fleet/assignments/${aid}`)} />}
      {modal === 'fault' && <FaultModal vehicle={v} onClose={() => setModal(null)} onSaved={() => toast(t('fleet_faultSaved'))} />}
    </>
  );
}

function RunLogTable({ vehicle, canAdd, onAdd }: { vehicle: FleetVehicleView; canAdd: boolean; onAdd: () => void }) {
  const { t } = useSession();
  const logs = useApi(() => fleetApi.listRunLogs(vehicle.id), [vehicle.id]);
  return (
    <Card title={t('fleet_runLog')} flush actions={canAdd ? <Button size="small" type="primary" icon="plus" onClick={onAdd}>{t('fleet_addRun')}</Button> : undefined}>
      <DataTable
        rows={logs.data}
        loading={logs.loading}
        rowKey={(r) => r.id}
        columns={[
          { header: t('date'), render: (r) => formatDate(r.date) },
          { header: t('fleet_hours'), render: (r) => `${formatNumber(r.hoursStart)} → ${formatNumber(r.hoursEnd)}` },
          { header: t('fleet_runHours'), align: 'right', render: (r) => dec(r.hoursEnd - r.hoursStart) },
          { header: t('fleet_fuelUsed'), align: 'right', render: (r) => dec(r.fuelUsed) },
          { header: t('fleet_normUsed'), align: 'right', render: (r) => dec(r.fuelNormUsed) },
          { header: t('fleet_deviation'), align: 'right', render: (r) => { const d = r.fuelNormUsed ? Math.round(((r.fuelUsed - r.fuelNormUsed) / r.fuelNormUsed) * 1000) / 10 : 0; return <b className={d > 10 ? 'flt-over' : d < 0 ? 'flt-save' : ''}>{d > 0 ? '+' : ''}{dec(d)}%</b>; } },
          { header: t('comment'), render: (r) => <span className="muted">{r.note}</span> },
        ]}
      />
    </Card>
  );
}

export function FuelTable({ vehicle, canAdd, onAdd }: { vehicle?: FleetVehicleView; canAdd?: boolean; onAdd?: () => void }) {
  const { t } = useSession();
  const list = useApi(() => fleetApi.listFuelUps(vehicle ? { vehicleId: vehicle.id } : {}), [vehicle?.id]);
  const vehicles = useApi(() => fleetApi.list(), []);
  const cards = useApi(() => fleetApi.listCards(), []);
  const [receipt, setReceipt] = useState<string | null>(null);
  const receiptNo = list.data?.find((f) => f.id === receipt)?.number;
  return (
    <>
    <Card title={t('fleet_fuelUps')} flush actions={canAdd && onAdd ? <Button size="small" type="primary" icon="plus" onClick={onAdd}>{t('fleet_addFuel')}</Button> : undefined}>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(f) => f.id}
        columns={[
          { header: '№', render: (f) => <span className="doc-num">{f.number}</span> },
          { header: t('date'), render: (f) => formatDate(f.date) },
          ...(vehicle ? [] : [{ header: t('fleet_plate'), render: (f: { vehicleId: string }) => <Link to={`/fleet/${f.vehicleId}`}>{vehicles.data?.find((x) => x.id === f.vehicleId)?.plate}</Link> }]),
          { header: t('fleet_station'), render: (f) => (<>{f.station}<div className="sub">{t(tk('fleet_src_', f.source))}{f.cardId ? ` · ${cards.data?.find((c) => c.id === f.cardId)?.number ?? ''}` : ''}</div></>) },
          { header: t('fleet_fuel'), render: (f) => t(tk('fleet_fuel_', f.fuel)) },
          { header: t('fleet_litres'), align: 'right', render: (f) => dec(f.litres) },
          { header: t('amount'), align: 'right', render: (f) => formatMoney(f.amount) },
          { header: t('fleet_tripNo'), render: (f) => (f.tripId ? <Link to={`/fleet/trips/${f.tripId}`}>{t('open')}</Link> : '—') },
          { header: '', render: (f) => (f.overLimit ? <Badge tone="danger">{t('fleet_overLimit')}</Badge> : null) },
          { header: '', render: (f) => <Button size="small" type="text" icon="paperclip" title={t('fleet_receiptPhoto')} onClick={() => setReceipt(receipt === f.id ? null : f.id)} /> },
        ]}
      />
    </Card>
    {receipt && <Attachments entity="fleet_fuel" entityId={receipt} title={`${t('fleet_receiptPhoto')} · ${receiptNo ?? ''}`} />}
    </>
  );
}

export function ServiceTable({ vehicleId, canAdd, onAdd }: { vehicleId?: string; canAdd?: boolean; onAdd?: () => void }) {
  const { t } = useSession();
  const lk = useLookups();
  const list = useApi(() => fleetApi.listServices(vehicleId ? { vehicleId } : {}), [vehicleId]);
  const vehicles = useApi(() => fleetApi.list(), []);
  const [kind, setKind] = useState<'' | 'maintenance' | 'repair'>('');
  const rows = (list.data ?? []).filter((s) => !kind || s.kind === kind);
  return (
    <Card
      title={t('fleet_service')}
      flush
      actions={
        <div className="flt-row">
          <Button size="small" type={kind === '' ? 'primary' : 'default'} onClick={() => setKind('')}>{t('all')}</Button>
          <Button size="small" type={kind === 'maintenance' ? 'primary' : 'default'} onClick={() => setKind('maintenance')}>{t('fleet_svc_maintenance')}</Button>
          <Button size="small" type={kind === 'repair' ? 'primary' : 'default'} onClick={() => setKind('repair')}>{t('fleet_svc_repair')}</Button>
          {canAdd && onAdd && <Button size="small" icon="plus" onClick={onAdd}>{t('fleet_newService')}</Button>}
        </div>
      }
    >
      <DataTable
        rows={list.data ? rows : undefined}
        loading={list.loading}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/fleet/service/${s.id}`)}
        columns={[
          { header: '№', render: (s) => <span className="doc-num">{s.number}</span> },
          { header: t('date'), render: (s) => (<>{formatDate(s.date)}{s.doneDate && <div className="sub">{formatDate(s.doneDate)}</div>}</>) },
          ...(vehicleId ? [] : [{ header: t('fleet_plate'), render: (s: { vehicleId: string }) => vehicles.data?.find((x) => x.id === s.vehicleId)?.plate ?? '' }]),
          { header: t('type'), render: (s) => t(tk('fleet_svc_', s.kind)) },
          { header: t('fleet_fault'), render: (s) => (<>{s.fault}{s.contractorId && <div className="sub">{lk.counterparty(s.contractorId)?.name}</div>}</>) },
          { header: t('fleet_cost'), align: 'right', render: (s) => (<>{formatMoney(fleetServiceTotal(s).total)}{s.warranty && <div className="sub">{t('fleet_warranty')}: {formatMoney(fleetServiceCost(s))}</div>}</>) },
          { header: t('status'), render: (s) => <Badge tone={s.status === 'done' ? 'ok' : s.status === 'open' ? 'warn' : 'muted'}>{t(tk('fleet_sstatus_', s.status))}</Badge> },
        ]}
      />
    </Card>
  );
}

function OtherTables({ vehicle, canAdd, onExpense, onFine }: { vehicle: FleetVehicleView; canAdd: boolean; onExpense: () => void; onFine: () => void }) {
  const { t } = useSession();
  const exp = useApi(() => fleetApi.listExpenses({ vehicleId: vehicle.id }), [vehicle.id]);
  const fines = useApi(() => fleetApi.listFines({ vehicleId: vehicle.id }), [vehicle.id]);
  return (
    <div className="flt-stack">
      <Card title={t('fleet_otherExpenses')} flush actions={canAdd ? <Button size="small" type="primary" icon="plus" onClick={onExpense}>{t('fleet_addExpense')}</Button> : undefined}>
        <DataTable rows={exp.data} loading={exp.loading} rowKey={(e) => e.id} columns={[
          { header: '№', render: (e) => <span className="doc-num">{e.number}</span> },
          { header: t('date'), render: (e) => formatDate(e.date) },
          { header: t('type'), render: (e) => t(tk('fleet_exp_', e.kind)) },
          { header: t('description'), render: (e) => e.description },
          { header: t('amount'), align: 'right', render: (e) => formatMoney(e.amount) },
        ]} />
      </Card>
      {vehicle.kind === 'vehicle' && (
        <Card title={t('fleet_fines')} flush actions={canAdd ? <Button size="small" icon="plus" onClick={onFine}>{t('fleet_addFine')}</Button> : undefined}>
          <DataTable rows={fines.data} loading={fines.loading} rowKey={(f) => f.id} columns={[
            { header: t('date'), render: (f) => formatDate(f.date) },
            { header: t('fleet_protocolNo'), render: (f) => (<>{f.protocolNo}<div className="sub">{t(tk('fleet_src_', f.source))}</div></>) },
            { header: t('fleet_violation'), render: (f) => f.violation },
            { header: t('amount'), align: 'right', render: (f) => formatMoney(f.amount) },
            { header: t('status'), render: (f) => <Badge tone={f.status === 'paid' ? 'ok' : f.status === 'unpaid' ? 'warn' : 'muted'}>{t(tk('fleet_fine_', f.status))}</Badge> },
          ]} />
        </Card>
      )}
    </div>
  );
}

function AssignHistory({ vehicleId }: { vehicleId: string }) {
  const { t } = useSession();
  const list = useApi(() => fleetApi.listAssignments({ vehicleId }), [vehicleId]);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const dn = (id?: string) => (id ? drivers.data?.find((d) => d.id === id)?.fullName ?? id : '—');
  return (
    <Card title={t('fleet_assignHistory')} flush>
      <DataTable rows={list.data} loading={list.loading} rowKey={(a) => a.id} onRowClick={(a) => navigate(`/fleet/assignments/${a.id}`)} columns={[
        { header: '№', render: (a) => <span className="doc-num">{a.number}</span> },
        { header: t('fleet_assignRole'), render: (a) => t(tk('fleet_role_', a.role)) },
        { header: t('fleet_driver'), render: (a) => (<>{dn(a.driverId)}{a.fromDriverId && <div className="sub">← {dn(a.fromDriverId)}</div>}</>) },
        { header: t('fleet_periodAssign'), render: (a) => `${formatDate(a.effectiveFrom)} — ${a.effectiveTo ? formatDate(a.effectiveTo) : a.status === 'completed' ? t('fleet_now') : '…'}` },
        { header: t('fleet_basis'), render: (a) => t(tk('fleet_basis_', a.basis)) },
        { header: t('fleet_act'), render: (a) => (a.act ? `${a.act.number} · ${formatNumber(a.act.odometer)} km` : '—') },
        { header: t('status'), render: (a) => <Badge tone={a.status === 'completed' ? 'ok' : a.status === 'rejected' || a.status === 'cancelled' ? 'muted' : 'warn'}>{t(tk('fleet_astatus_', a.status))}</Badge> },
      ]} />
    </Card>
  );
}

function HistoryTab({ vehicleId }: { vehicleId: string }) {
  const { t } = useSession();
  const events = useApi(() => fleetApi.listStatusEvents(vehicleId), [vehicleId]);
  const lk = useLookups();
  const fieldLabel = (f: string) => {
    const map: Record<string, string> = { plate: t('fleet_plate'), brand: t('fleet_brand'), model: t('fleet_model'), year: t('fleet_year'), vin: t('fleet_vin'), techPassportNo: t('fleet_techPassport'), fuelNorm: t('fleet_norm'), limitLitres: t('fleet_limitLitres'), limitSum: t('fleet_limitSum'), bookValue: t('fleet_bookValue'), orgUnitKey: t('fleet_orgUnit'), costCenterKey: t('fleet_costCenter'), mileage: t('fleet_mileage'), status: t('status'), primaryDriverId: t('fleet_role_primary'), reserveDriverId: t('fleet_role_reserve'), assetId: t('fleet_asset') };
    return map[f] ?? f;
  };
  return (
    <div className="grid grid-2">
      <Card title={t('fleet_statusLog')} flush>
        <DataTable rows={events.data} loading={events.loading} rowKey={(e) => e.id} columns={[
          { header: t('date'), render: (e) => <span className="num">{formatDateTime(e.at)}</span> },
          { header: t('status'), render: (e) => (<>{e.from ? `${t(tk('fleet_status_', e.from))} → ` : ''}<b>{t(tk('fleet_status_', e.to))}</b></>) },
          { header: t('fleet_who'), render: (e) => (<>{lk.user(e.userId)?.fullName ?? (e.userId === 'system' ? t('fleet_system') : e.userId)}{e.reason && <div className="sub">{e.reason}</div>}</>) },
        ]} />
      </Card>
      <Card title={t('fleet_changeHistory')}>
        <FieldHistory entity="fleet_vehicle" entityId={vehicleId} fieldLabel={fieldLabel} />
      </Card>
    </div>
  );
}

function VehicleReport({ vehicle, period, setPeriod }: { vehicle: FleetVehicleView; period: FleetPeriod; setPeriod: (p: FleetPeriod) => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const org = useOrgRefs();
  const rep = useApi(() => fleetApi.vehicleReport(vehicle.id, period), [vehicle.id, period.type, period.value]);
  const r = rep.data?.row;
  const gen = vehicle.kind === 'generator';
  const lines = useMemo(() => (r ? [
    [gen ? t('fleet_runHours') : t('fleet_distance'), formatNumber(r.km)],
    [t('fleet_tripsCount'), String(r.trips)],
    [t('fleet_fuelLitresIn'), dec(r.fuelLitres)],
    [t('fleet_fuelUsed'), dec(r.usedLitres)],
    [t('fleet_normUsed'), dec(r.normLitres)],
    [t('fleet_cat_fuel'), formatMoney(r.fuel)],
    [t('fleet_cat_maintenance'), formatMoney(r.maintenance)],
    [t('fleet_cat_repair'), formatMoney(r.repair)],
    [t('fleet_cat_insurance'), formatMoney(r.insurance)],
    [t('fleet_cat_other'), formatMoney(r.other)],
    [t('fleet_cat_fines'), formatMoney(r.fines)],
    [t('total'), formatMoney(r.total)],
    [t('fleet_costPerKm'), r.km ? formatMoney(r.costPerKm) : '—'],
    [t('fleet_utilization'), `${dec(r.utilizationPct)}% · ${t('fleet_usedDays')}: ${r.usedDays} · ${t('fleet_downtime')}: ${r.downtimeDays}`],
  ] : []), [r, t, gen]);
  const doc = (): PrintDocument => ({
    entity: 'fleet_vehicle_report',
    entityId: `${vehicle.id}:${period.value}`,
    title: `${t('fleet_vehicleReport')} · ${periodLabel(period, lang)}`,
    number: vehicle.plate,
    date: today(),
    fields: [{ label: t('fleet_model'), value: `${vehicle.brand} ${vehicle.model}` }, { label: t('fleet_costCenter'), value: org.ccLabel(vehicle.costCenterKey) }],
    table: { columns: [{ header: t('fleet_indicator') }, { header: t('fleet_value'), align: 'right' }], rows: lines.map((l) => [l[0]!, l[1]!]) },
    signers: [{ role: t('fleet_responsible'), name: user.fullName }],
  });
  const exportAll = () => {
    if (!rep.data) return;
    exportXlsx(`${t('fleet_vehicleReport')} ${vehicle.plate} ${period.value}.xlsx`, [
      toSheet(t('fleet_summary').slice(0, 31), [{ header: t('fleet_indicator'), value: (l: string[]) => l[0]!, width: 34 }, { header: t('fleet_value'), value: (l: string[]) => l[1]!, width: 30 }], lines, { title: `${vehicle.plate} · ${periodLabel(period, lang)}` }),
      toSheet(t('fleet_trips').slice(0, 31), [
        { header: '№', value: (x: (typeof rep.data.trips)[number]) => x.number }, { header: t('date'), value: (x) => x.date, format: 'date' }, { header: t('fleet_route'), value: (x) => `${x.routeFrom} → ${x.routeTo}`, width: 40 },
        { header: t('fleet_distance'), value: (x) => (x.odoEnd ?? x.odoStart) - x.odoStart, total: true }, { header: t('fleet_fuelUsed'), value: (x) => x.fuelUsed ?? 0, format: 'number', total: true }, { header: t('fleet_normUsed'), value: (x) => x.fuelNormUsed ?? 0, format: 'number', total: true },
      ], rep.data.trips, { totalLabel: t('total') }),
      toSheet(t('fleet_fuelUps').slice(0, 31), [
        { header: '№', value: (x: (typeof rep.data.fuelUps)[number]) => x.number }, { header: t('date'), value: (x) => x.date, format: 'date' }, { header: t('fleet_station'), value: (x) => x.station, width: 30 },
        { header: t('fleet_litres'), value: (x) => x.litres, format: 'number', total: true }, { header: t('amount'), value: (x) => x.amount, format: 'money', total: true },
      ], rep.data.fuelUps, { totalLabel: t('total') }),
      toSheet(t('fleet_service').slice(0, 31), [
        { header: '№', value: (x: (typeof rep.data.services)[number]) => x.number }, { header: t('type'), value: (x) => t(tk('fleet_svc_', x.kind)) }, { header: t('fleet_fault'), value: (x) => x.fault, width: 40 },
        { header: t('fleet_cost'), value: (x) => fleetServiceCost(x), format: 'money', total: true },
      ], rep.data.services, { totalLabel: t('total') }),
    ], user.fullName);
  };
  return (
    <Card title={`${t('fleet_vehicleReport')} · ${periodLabel(period, lang)}`} actions={<div className="flt-row"><PeriodPicker value={period} onChange={setPeriod} /><Button size="small" icon="download" onClick={exportAll} disabled={!r}>{t('svc_exportExcel')}</Button><PrintButton doc={doc} template="card" /></div>}>
      {!r ? <Loading /> : (
        <dl className="kv" data-testid="flt-vreport">
          {lines.map((l) => (<span key={l[0]} style={{ display: 'contents' }}><dt>{l[0]}</dt><dd className="num">{l[1]}</dd></span>))}
        </dl>
      )}
    </Card>
  );
}
