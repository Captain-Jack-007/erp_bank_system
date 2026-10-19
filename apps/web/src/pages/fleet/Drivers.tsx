// Водители: реестр и карточка (ФИО, табельный №, удостоверение, медсправка, закреплённые ТС, история закреплений,
// статистика поездок) — PR-FLT-035…041.
import { useState } from 'react';
import { fleetApi, fleetCanManage, formatDate, formatMoney, formatNumber, tk, type FleetDriver, type FleetPeriod } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, FilterBar, Input, Loading, PageHeader, Stat, StatusBadge, type Column } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { FieldHistory } from '../../components/FieldHistory';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { dec, DueDate, FLEET_TONE, FleetNav, PeriodPicker, Plate, periodLabel, useOrgRefs } from './shared';
import { DriverFormModal } from './forms';
import { TripsTable } from './Trips';

export function DriversPage() {
  const { t } = useSession();
  const user = useUser();
  const canManage = fleetCanManage(user);
  const org = useOrgRefs();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(false);
  const list = useApi(() => fleetApi.listDrivers({ search }), [search]);
  const vehicles = useApi(() => fleetApi.list(), []);
  const assigned = (d: FleetDriver) => (vehicles.data ?? []).filter((v) => v.primaryDriverId === d.id || v.reserveDriverId === d.id);
  const columns: Column<FleetDriver>[] = [
    { header: t('fleet_fullName'), render: (d) => (<><b>{d.fullName}</b><div className="sub">{d.personnelNo} · {d.phone}</div></>) },
    { header: t('fleet_licenseNo'), render: (d) => (<>{d.licenseNo}<div className="sub">{d.licenseCategories.join(', ')}</div></>) },
    { header: t('fleet_licenseUntil'), render: (d) => <DueDate value={d.licenseUntil} /> },
    { header: t('fleet_medicalUntil'), render: (d) => <DueDate value={d.medicalUntil} /> },
    { header: t('fleet_assignedVehicles'), render: (d) => <div className="flt-row">{assigned(d).map((v) => <span key={v.id} title={t(v.primaryDriverId === d.id ? 'fleet_role_primary' : 'fleet_role_reserve')}><Plate value={v.plate} /></span>)}</div> },
    { header: t('fleet_orgUnit'), render: (d) => <span className="muted small">{org.unitName(d.orgUnitKey)}</span> },
    { header: t('status'), render: (d) => <Badge tone={d.active ? 'ok' : 'muted'}>{t(d.active ? 'fleet_driverActive' : 'fleet_driverInactive')}</Badge> },
  ];
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_drivers') }]}
        title={t('fleet_nav_drivers')}
        subtitle={t('fleet_driversSub')}
        actions={
          <>
            <ExportButton<FleetDriver>
              filename={t('fleet_nav_drivers')}
              rows={list.data ?? []}
              columns={[
                { header: t('fleet_fullName'), value: (d) => d.fullName, width: 26 },
                { header: t('fleet_personnelNo'), value: (d) => d.personnelNo },
                { header: t('fleet_licenseNo'), value: (d) => d.licenseNo },
                { header: t('fleet_categories'), value: (d) => d.licenseCategories.join(', ') },
                { header: t('fleet_licenseUntil'), value: (d) => d.licenseUntil, format: 'date' },
                { header: t('fleet_medicalUntil'), value: (d) => d.medicalUntil, format: 'date' },
                { header: t('fleet_assignedVehicles'), value: (d) => assigned(d).map((v) => v.plate).join(', '), width: 26 },
                { header: t('fleet_orgUnit'), value: (d) => org.unitName(d.orgUnitKey), width: 30 },
              ]}
            />
            {canManage && <Button type="primary" icon="plus" onClick={() => setForm(true)}>{t('fleet_newDriver')}</Button>}
          </>
        }
      />
      <FleetNav active="drivers" />
      <Card flush>
        <FilterBar>
          <Input placeholder={`${t('search')}: ${t('fleet_fullName').toLowerCase()}, ${t('fleet_personnelNo').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} ariaLabel={t('search')} />
        </FilterBar>
        <DataTable rows={list.data} loading={list.loading} rowKey={(d) => d.id} columns={columns} onRowClick={(d) => navigate(`/fleet/drivers/${d.id}`)} />
      </Card>
      {form && <DriverFormModal onClose={() => setForm(false)} onSaved={(id) => navigate(`/fleet/drivers/${id}`)} />}
    </>
  );
}

export function DriverDetailPage({ id }: { id: string }) {
  const { t, lang } = useSession();
  const user = useUser();
  const lk = useLookups();
  const org = useOrgRefs();
  const canManage = fleetCanManage(user);
  const dq = useApi(() => fleetApi.getDriver(id), [id]);
  const vehicles = useApi(() => fleetApi.driverVehicles(id), [id]);
  const assigns = useApi(() => fleetApi.listAssignments({ driverId: id }), [id]);
  const allVehicles = useApi(() => fleetApi.list(), []);
  const [period, setPeriod] = useState<FleetPeriod>(() => fleetApi.currentPeriod('quarter'));
  const report = useApi(() => fleetApi.report(period), [period.type, period.value]);
  const [form, setForm] = useState(false);
  if (dq.loading && !dq.data) return <Card><Loading /></Card>;
  const d = dq.data;
  if (!d) return <Card><Empty text={t('empty')} /></Card>;
  const stats = report.data?.drivers.find((x) => x.driverId === d.id);
  const plate = (vid: string) => allVehicles.data?.find((v) => v.id === vid)?.plate ?? vid;
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_drivers'), to: '/fleet/drivers' }, { label: d.fullName }]}
        title={d.fullName}
        subtitle={`${t('fleet_personnelNo')}: ${d.personnelNo} · ${org.unitName(d.orgUnitKey)}`}
        actions={
          <>
            <Badge tone={d.active ? 'ok' : 'muted'}>{t(d.active ? 'fleet_driverActive' : 'fleet_driverInactive')}</Badge>
            {canManage && <Button onClick={() => setForm(true)} icon="pen">{t('fleet_editDriver')}</Button>}
          </>
        }
      />
      <div className="grid grid-main">
        <div className="flt-stack">
          <Card title={t('fleet_tripStats')} actions={<PeriodPicker value={period} onChange={setPeriod} />}>
            <div className="flt-kpis" data-testid="flt-driver-stats">
              <Stat label={t('fleet_tripsCount')} value={stats?.trips ?? 0} icon="route" foot={periodLabel(period, lang)} />
              <Stat label={t('fleet_distance')} value={formatNumber(stats?.km ?? 0)} icon="chart" />
              <Stat label={t('fleet_fuelVsNorm')} value={`${dec(stats?.usedLitres ?? 0)} / ${dec(stats?.normLitres ?? 0)}`} icon="wallet" foot={`${t('fleet_overrun')}: ${dec(stats?.overrunLitres ?? 0)} · ${t('fleet_saving')}: ${dec(stats?.savingLitres ?? 0)}`} />
              <Stat label={t('fleet_fines')} value={stats?.finesCount ?? 0} tone={stats?.finesCount ? 'alert' : undefined} icon="alert" foot={formatMoney(stats?.fines ?? 0)} />
            </div>
          </Card>
          <Card title={t('fleet_trips')} flush>
            <TripsTable driverId={d.id} />
          </Card>
          <Card title={t('fleet_assignHistory')} flush>
            <DataTable rows={assigns.data} loading={assigns.loading} rowKey={(a) => a.id} onRowClick={(a) => navigate(`/fleet/assignments/${a.id}`)} columns={[
              { header: '№', render: (a) => <span className="doc-num">{a.number}</span> },
              { header: t('fleet_plate'), render: (a) => <Plate value={plate(a.vehicleId)} /> },
              { header: t('fleet_assignRole'), render: (a) => (a.driverId === d.id ? t(tk('fleet_role_', a.role)) : t('fleet_handedOver')) },
              { header: t('fleet_periodAssign'), render: (a) => `${formatDate(a.effectiveFrom)} — ${a.effectiveTo ? formatDate(a.effectiveTo) : a.status === 'completed' ? t('fleet_now') : '…'}` },
              { header: t('status'), render: (a) => <Badge tone={a.status === 'completed' ? 'ok' : 'warn'}>{t(tk('fleet_astatus_', a.status))}</Badge> },
            ]} />
          </Card>
        </div>
        <div className="flt-stack">
          <Card title={t('details')}>
            <dl className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
              <dt>{t('fleet_phone')}</dt><dd>{d.phone || '—'}</dd>
              <dt>{t('fleet_licenseNo')}</dt><dd>{d.licenseNo}</dd>
              <dt>{t('fleet_categories')}</dt><dd>{d.licenseCategories.join(', ')}</dd>
              <dt>{t('fleet_licenseUntil')}</dt><dd><DueDate value={d.licenseUntil} /></dd>
              <dt>{t('fleet_medicalUntil')}</dt><dd><DueDate value={d.medicalUntil} /></dd>
              <dt>{t('fleet_account')}</dt><dd>{d.userId ? lk.user(d.userId)?.fullName ?? d.userId : <span className="muted">—</span>}</dd>
            </dl>
          </Card>
          <Card title={t('fleet_assignedVehicles')} flush>
            {vehicles.data?.length ? vehicles.data.map((v) => (
              <div key={v.id} className="flt-list-item">
                <div className="flt-li-main">
                  <Link to={`/fleet/${v.id}`}><Plate value={v.plate} /></Link> {v.brand} {v.model}
                  <div className="flt-li-sub">{t(v.primaryDriverId === d.id ? 'fleet_role_primary' : 'fleet_role_reserve')}</div>
                </div>
                <StatusBadge prefix="fleet_status_" status={v.status} tone={FLEET_TONE[v.status]} />
              </div>
            )) : <Empty text={t('fleet_noVehicles')} icon="car" />}
          </Card>
          <Card title={t('fleet_changeHistory')}>
            <FieldHistory entity="fleet_driver" entityId={d.id} />
          </Card>
        </div>
      </div>
      {form && <DriverFormModal driver={d} onClose={() => setForm(false)} />}
    </>
  );
}
