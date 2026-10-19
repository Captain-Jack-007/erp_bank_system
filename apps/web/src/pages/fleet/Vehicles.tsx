// Реестр ТС и генераторов: фильтры, экспорт (в т.ч. отчёт по статусам), загрузка из Excel, новая карточка.
import { useState } from 'react';
import { fleetApi, fleetCanManage, formatMoney, formatNumber, importRegistry, tk, type FleetKind, type FleetPurpose, type FleetStatus, type FleetVehicleType, type FleetVehicleView } from '@xb/shared';
import { Badge, Button, Card, DataTable, Drawer, FilterBar, Input, PageHeader, Select, StatusBadge, type Column } from '../../components/ui';
import { ExportButton, exportXlsx, toSheet } from '../../components/Export';
import { ImportWizard } from '../../components/Import';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { DueDate, FLEET_STATUSES, FLEET_TONE, FleetNav, Plate, useOrgRefs } from './shared';
import { VehicleFormModal } from './forms';

const PURPOSES: FleetPurpose[] = ['collection', 'business', 'management', 'service', 'power'];
const TYPES: FleetVehicleType[] = ['car', 'truck', 'special', 'bus', 'generator'];

export function VehiclesPage() {
  const { t } = useSession();
  const user = useUser();
  const canManage = fleetCanManage(user);
  const org = useOrgRefs();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<FleetStatus | ''>('');
  const [purpose, setPurpose] = useState<FleetPurpose | ''>('');
  const [kind, setKind] = useState<FleetKind | ''>('');
  const [vtype, setVtype] = useState<FleetVehicleType | ''>('');
  const [unit, setUnit] = useState('');
  const [form, setForm] = useState(false);
  const [imp, setImp] = useState(false);
  const list = useApi(
    () => fleetApi.list({ search, ...(status ? { status } : {}), ...(purpose ? { purpose } : {}), ...(kind ? { kind } : {}), ...(vtype ? { vehicleType: vtype } : {}), ...(unit ? { orgUnitKey: unit } : {}) }),
    [search, status, purpose, kind, vtype, unit],
  );
  const all = useApi(() => fleetApi.list(), []);
  const units = [...new Set((all.data ?? []).map((v) => v.orgUnitKey))];
  const target = importRegistry.get('fleet_vehicles');

  const columns: Column<FleetVehicleView>[] = [
    { header: t('fleet_plate'), render: (v) => <Plate value={v.plate} /> },
    { header: t('fleet_model'), render: (v) => (<>{v.brand} {v.model}<div className="sub">{v.year} · {t(tk('fleet_fuel_', v.fuel))} · {t(tk('fleet_type_', v.vehicleType))}</div></>) },
    { header: t('fleet_purpose'), render: (v) => <span className="muted">{t(tk('fleet_purpose_', v.purpose))}</span> },
    { header: t('fleet_driver'), render: (v) => v.driverName ?? <span className="muted">—</span> },
    { header: t('fleet_mileage'), align: 'right', render: (v) => `${formatNumber(v.mileage)}${v.kind === 'generator' ? ` ${t('fleet_h')}` : ''}` },
    { header: t('fleet_insurance'), render: (v) => <DueDate value={v.insuranceUntil} /> },
    { header: t('fleet_inspection'), render: (v) => <DueDate value={v.inspectionUntil} /> },
    { header: t('fleet_costCenter'), render: (v) => <span className="muted small">{org.ccCode(v.costCenterKey)}</span> },
    { header: t('status'), render: (v) => (<><StatusBadge prefix="fleet_status_" status={v.status} tone={FLEET_TONE[v.status]} />{v.onTrip && <div style={{ marginTop: 4 }}><Badge tone="info">{t('fleet_onTrip')}</Badge></div>}</>) },
  ];

  const exportStatuses = () => {
    const rows = all.data ?? [];
    exportXlsx(`${t('fleet_statusReport')}.xlsx`, [
      toSheet(t('fleet_statusSummary').slice(0, 31), [
        { header: t('status'), value: (s: FleetStatus) => t(tk('fleet_status_', s)), width: 26 },
        { header: t('fleet_vehiclesCount'), value: (s: FleetStatus) => rows.filter((v) => v.status === s && v.kind === 'vehicle').length, total: true },
        { header: t('fleet_generators'), value: (s: FleetStatus) => rows.filter((v) => v.status === s && v.kind === 'generator').length, total: true },
      ], FLEET_STATUSES, { title: t('fleet_statusReport'), totalLabel: t('total') }),
      toSheet(t('fleet_vehicles').slice(0, 31), [
        { header: t('fleet_plate'), value: (v: FleetVehicleView) => v.plate, width: 14 },
        { header: t('fleet_model'), value: (v: FleetVehicleView) => `${v.brand} ${v.model}`, width: 28 },
        { header: t('status'), value: (v: FleetVehicleView) => t(tk('fleet_status_', v.status)), width: 18 },
        { header: t('fleet_orgUnit'), value: (v: FleetVehicleView) => org.unitName(v.orgUnitKey), width: 30 },
        { header: t('fleet_costCenter'), value: (v: FleetVehicleView) => org.ccCode(v.costCenterKey), width: 16 },
      ], rows),
    ], user.fullName);
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_vehicles') }]}
        title={t('fleet_vehicles')}
        subtitle={t('fleet_vehiclesSub')}
        actions={
          <>
            <ExportButton<FleetVehicleView>
              filename={t('fleet_vehicles')}
              title={t('fleet_vehicles')}
              rows={list.data ?? []}
              columns={[
                { header: t('fleet_plate'), value: (v) => v.plate, width: 14 },
                { header: t('fleet_kind'), value: (v) => t(tk('fleet_kind_', v.kind)) },
                { header: t('fleet_brand'), value: (v) => v.brand },
                { header: t('fleet_model'), value: (v) => v.model, width: 26 },
                { header: t('fleet_year'), value: (v) => v.year },
                { header: t('fleet_vin'), value: (v) => v.vin, width: 22 },
                { header: t('fleet_techPassport'), value: (v) => v.techPassportNo },
                { header: t('fleet_vehicleType'), value: (v) => t(tk('fleet_type_', v.vehicleType)) },
                { header: t('fleet_fuel'), value: (v) => t(tk('fleet_fuel_', v.fuel)) },
                { header: t('fleet_norm'), value: (v) => v.fuelNorm },
                { header: t('fleet_limitLitres'), value: (v) => v.limitLitres },
                { header: t('fleet_limitSum'), value: (v) => v.limitSum, format: 'money' },
                { header: t('fleet_balanceValue'), value: (v) => v.balanceValue, format: 'money', total: true },
                { header: t('fleet_orgUnit'), value: (v) => org.unitName(v.orgUnitKey), width: 30 },
                { header: t('fleet_costCenter'), value: (v) => org.ccCode(v.costCenterKey), width: 16 },
                { header: t('fleet_driver'), value: (v) => v.driverName ?? '' , width: 22 },
                { header: t('fleet_mileage'), value: (v) => v.mileage },
                { header: t('fleet_insurance'), value: (v) => v.insuranceUntil ?? '' },
                { header: t('fleet_inspection'), value: (v) => v.inspectionUntil ?? '' },
                { header: t('status'), value: (v) => t(tk('fleet_status_', v.status)) },
              ]}
            />
            <Button size="small" icon="download" onClick={exportStatuses}>{t('fleet_statusReport')}</Button>
            {canManage && target && <Button size="small" icon="upload" onClick={() => setImp(true)}>{t('fleet_importExcel')}</Button>}
            {canManage && <Button type="primary" icon="plus" onClick={() => setForm(true)}>{t('fleet_newVehicle')}</Button>}
          </>
        }
      />
      <FleetNav active="vehicles" />
      <Card flush>
        <FilterBar>
          <Input placeholder={`${t('search')}: ${t('fleet_plate')}, VIN, ${t('fleet_driver').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} ariaLabel={t('search')} />
          <Select<FleetStatus> value={status} placeholder={`${t('status')}: ${t('all')}`} ariaLabel={t('status')} onChange={setStatus} options={FLEET_STATUSES.map((x) => ({ value: x, label: t(tk('fleet_status_', x)) }))} />
          <Select<FleetPurpose> value={purpose} placeholder={`${t('fleet_purpose')}: ${t('all')}`} ariaLabel={t('fleet_purpose')} onChange={setPurpose} options={PURPOSES.map((x) => ({ value: x, label: t(tk('fleet_purpose_', x)) }))} />
          <Select<FleetKind> value={kind} placeholder={`${t('fleet_kind')}: ${t('all')}`} ariaLabel={t('fleet_kind')} onChange={setKind} options={(['vehicle', 'generator'] as const).map((x) => ({ value: x, label: t(tk('fleet_kind_', x)) }))} />
          <Select<FleetVehicleType> value={vtype} placeholder={`${t('fleet_vehicleType')}: ${t('all')}`} ariaLabel={t('fleet_vehicleType')} onChange={setVtype} options={TYPES.map((x) => ({ value: x, label: t(tk('fleet_type_', x)) }))} />
          <Select<string> value={unit} placeholder={`${t('fleet_orgUnit')}: ${t('all')}`} ariaLabel={t('fleet_orgUnit')} onChange={setUnit} options={units.map((u) => ({ value: u, label: org.unitName(u) }))} />
        </FilterBar>
        <div className="flt-tablebar">
          <span className="muted">
            {FLEET_STATUSES.map((s) => `${t(tk('fleet_statusShort_', s))}: ${(all.data ?? []).filter((v) => v.status === s).length}`).join(' · ')}
          </span>
          <span className="muted">{t('fleet_balanceTotal')}: {formatMoney((list.data ?? []).reduce((a, v) => a + v.balanceValue, 0))}</span>
        </div>
        <DataTable rows={list.data} loading={list.loading} rowKey={(v) => v.id} columns={columns} onRowClick={(v) => navigate(`/fleet/${v.id}`)} />
      </Card>
      {form && <VehicleFormModal onClose={() => setForm(false)} onSaved={(id) => navigate(`/fleet/${id}`)} />}
      <Drawer open={imp && !!target} title={t('fleet_importExcel')} onClose={() => setImp(false)} width={900}>
        {target && <ImportWizard target={target} onDone={() => all.reload()} />}
      </Drawer>
    </>
  );
}
