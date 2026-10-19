// Отчёты автопарка за месяц / квартал / год (PR-FLT-118…125): сводный, расходы по ТС, по водителям, ГСМ план/факт,
// пробег, простои и использование, ремонт и ТО, виды топлива, статусы. Экспорт в Excel (все листы), печать реестра.
import { useMemo, useState } from 'react';
import { fleetApi, fleetDeviationPct, formatMoney, formatNumber, today, tk, type FleetPeriod, type FleetReport, type FleetVehicleReportRow, type PrintDocument, type XlsxSheet } from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Loading, PageHeader, Stat, Tabs, type Column } from '../../components/ui';
import { exportXlsx, toSheet } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Link } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { dec, FLEET_STATUSES, FleetNav, PeriodPicker, Plate, periodLabel, useOrgRefs } from './shared';

type Kind = 'summary' | 'costs' | 'drivers' | 'fuel' | 'mileage' | 'usage' | 'service' | 'statuses';

export function ReportsPage() {
  const { t, lang } = useSession();
  const user = useUser();
  const org = useOrgRefs();
  const [period, setPeriod] = useState<FleetPeriod>(() => fleetApi.currentPeriod('month'));
  const [kind, setKind] = useState<Kind>('summary');
  const rq = useApi(() => fleetApi.report(period), [period.type, period.value]);
  const vehicles = useApi(() => fleetApi.list(), []);
  const r = rq.data;
  const pl = periodLabel(period, lang);
  const veh = useMemo(() => (r?.vehicles ?? []).filter((x) => x.kind === 'vehicle'), [r]);

  const money = (k: keyof FleetVehicleReportRow) => ({ header: t(tk('fleet_cat_', k as string)), align: 'right' as const, render: (x: FleetVehicleReportRow) => formatMoney(x[k] as number) });
  const plateCol: Column<FleetVehicleReportRow> = { header: t('fleet_plate'), render: (x) => (<><Link to={`/fleet/${x.vehicleId}`}><Plate value={x.plate} /></Link><div className="sub">{x.model}</div></>) };

  const sheets = (rep: FleetReport): XlsxSheet[] => [
    toSheet(t('fleet_rep_costs').slice(0, 31), [
      { header: t('fleet_plate'), value: (x: FleetVehicleReportRow) => x.plate, width: 14 }, { header: t('fleet_model'), value: (x) => x.model, width: 26 }, { header: t('fleet_costCenter'), value: (x) => org.ccCode(x.costCenterKey), width: 16 },
      { header: t('fleet_distance'), value: (x) => x.km, format: 'integer', total: true },
      { header: t('fleet_cat_fuel'), value: (x) => x.fuel, format: 'money', total: true }, { header: t('fleet_cat_maintenance'), value: (x) => x.maintenance, format: 'money', total: true },
      { header: t('fleet_cat_repair'), value: (x) => x.repair, format: 'money', total: true }, { header: t('fleet_cat_insurance'), value: (x) => x.insurance, format: 'money', total: true },
      { header: t('fleet_cat_other'), value: (x) => x.other, format: 'money', total: true }, { header: t('fleet_cat_fines'), value: (x) => x.fines, format: 'money', total: true },
      { header: t('total'), value: (x) => x.total, format: 'money', total: true }, { header: t('fleet_costPerKm'), value: (x) => x.costPerKm, format: 'money' },
    ], rep.vehicles, { title: `${t('fleet_rep_costs')} · ${pl}`, totalLabel: t('total') }),
    toSheet(t('fleet_rep_drivers').slice(0, 31), [
      { header: t('fleet_driver'), value: (x: FleetReport['drivers'][number]) => x.name, width: 26 }, { header: t('fleet_tripsCount'), value: (x) => x.trips, total: true }, { header: t('fleet_distance'), value: (x) => x.km, total: true },
      { header: t('fleet_fuelUsed'), value: (x) => x.usedLitres, format: 'number', total: true }, { header: t('fleet_normUsed'), value: (x) => x.normLitres, format: 'number', total: true },
      { header: t('fleet_overrun'), value: (x) => x.overrunLitres, format: 'number', total: true }, { header: t('fleet_saving'), value: (x) => x.savingLitres, format: 'number', total: true },
      { header: t('fleet_overrunSumH'), value: (x) => x.overrunSum, format: 'money', total: true }, { header: t('fleet_savingSumH'), value: (x) => x.savingSum, format: 'money', total: true },
      { header: t('fleet_cat_fuel'), value: (x) => x.fuelSum, format: 'money', total: true }, { header: t('fleet_cat_fines'), value: (x) => x.fines, format: 'money', total: true }, { header: t('total'), value: (x) => x.expenses, format: 'money', total: true },
    ], rep.drivers, { title: `${t('fleet_rep_drivers')} · ${pl}`, totalLabel: t('total') }),
    toSheet(t('fleet_rep_fuel').slice(0, 31), [
      { header: t('fleet_plate'), value: (x: FleetVehicleReportRow) => x.plate }, { header: t('fleet_fuel'), value: (x) => t(tk('fleet_fuel_', x.fuelType)) },
      { header: t('fleet_normUsed'), value: (x) => x.normLitres, format: 'number', total: true }, { header: t('fleet_fuelUsed'), value: (x) => x.usedLitres, format: 'number', total: true },
      { header: t('fleet_deviation'), value: (x) => (x.normLitres ? fleetDeviationPct(x.usedLitres, x.normLitres) / 100 : 0), format: 'percent' },
      { header: t('fleet_deviationSum'), value: (x) => x.deviationSum, format: 'money', total: true },
      { header: t('fleet_limitLitres'), value: (x) => x.limitLitres, format: 'integer', total: true }, { header: t('fleet_fuelLitresIn'), value: (x) => x.fuelLitres, format: 'number', total: true },
      { header: t('fleet_limitSum'), value: (x) => x.limitSum, format: 'money', total: true }, { header: t('fleet_cat_fuel'), value: (x) => x.fuel, format: 'money', total: true },
    ], rep.vehicles, { title: `${t('fleet_rep_fuel')} · ${pl}`, totalLabel: t('total') }),
    toSheet(t('fleet_rep_mileage').slice(0, 31), [
      { header: t('fleet_plate'), value: (x: FleetVehicleReportRow) => x.plate }, { header: t('fleet_odoStartP'), value: (x) => x.odoStart, format: 'integer' }, { header: t('fleet_odoEndP'), value: (x) => x.odoEnd, format: 'integer' },
      { header: t('fleet_distance'), value: (x) => x.km, format: 'integer', total: true }, { header: t('fleet_tripsCount'), value: (x) => x.trips, total: true },
    ], veh, { title: `${t('fleet_rep_mileage')} · ${pl}`, totalLabel: t('total') }),
    toSheet(t('fleet_rep_usage').slice(0, 31), [
      { header: t('fleet_plate'), value: (x: FleetVehicleReportRow) => x.plate }, { header: t('fleet_days'), value: (x) => x.days }, { header: t('fleet_usedDays'), value: (x) => x.usedDays, total: true },
      { header: t('fleet_downtime'), value: (x) => x.downtimeDays, total: true }, { header: t('fleet_idle'), value: (x) => x.idleDays, total: true }, { header: t('fleet_utilization'), value: (x) => x.utilizationPct / 100, format: 'percent' },
    ], rep.vehicles, { title: `${t('fleet_rep_usage')} · ${pl}`, totalLabel: t('total') }),
    toSheet(t('fleet_rep_service').slice(0, 31), [
      { header: '№', value: (x: FleetReport['services'][number]) => x.number }, { header: t('date'), value: (x) => x.date, format: 'date' }, { header: t('fleet_plate'), value: (x) => x.plate },
      { header: t('type'), value: (x) => t(tk('fleet_svc_', x.kind)) }, { header: t('fleet_contractor'), value: (x) => x.contractor, width: 26 }, { header: t('fleet_warranty'), value: (x) => (x.warranty ? t('svc_yes') : t('svc_no')) },
      { header: t('fleet_works'), value: (x) => x.works, format: 'money', total: true }, { header: t('fleet_parts'), value: (x) => x.parts, format: 'money', total: true }, { header: t('total'), value: (x) => x.total, format: 'money', total: true },
    ], rep.services, { title: `${t('fleet_rep_service')} · ${pl}`, totalLabel: t('total') }),
    toSheet(t('fleet_otherExpenses').slice(0, 31), [
      { header: t('fleet_expenseKind'), value: (x: [string, number]) => t(tk('fleet_exp_', x[0])), width: 24 }, { header: t('amount'), value: (x) => x[1], format: 'money', total: true },
    ], Object.entries(rep.otherByKind) as [string, number][], { title: `${t('fleet_otherExpenses')} · ${pl}`, totalLabel: t('total') }),
    toSheet(t('fleet_byFuelType').slice(0, 31), [
      { header: t('fleet_fuel'), value: (x: FleetReport['fuelTypes'][number]) => t(tk('fleet_fuel_', x.fuel)) }, { header: t('fleet_litres'), value: (x) => x.litres, format: 'number', total: true },
      { header: t('amount'), value: (x) => x.amount, format: 'money', total: true }, { header: t('fleet_vehiclesCount'), value: (x) => x.vehicles },
    ], rep.fuelTypes, { title: `${t('fleet_byFuelType')} · ${pl}`, totalLabel: t('total') }),
  ];

  const printDoc = (): PrintDocument => {
    const rows = r?.vehicles ?? [];
    return {
      entity: 'fleet_report', entityId: `${period.value}:${kind}`, title: `${t('fleet_rep_summary')} · ${pl}`, date: today(), landscape: true,
      table: {
        columns: [{ header: t('fleet_plate') }, { header: t('fleet_distance'), align: 'right' }, { header: t('fleet_cat_fuel'), align: 'right' }, { header: t('fleet_cat_maintenance'), align: 'right' }, { header: t('fleet_cat_repair'), align: 'right' }, { header: t('fleet_cat_insurance'), align: 'right' }, { header: t('fleet_cat_other'), align: 'right' }, { header: t('fleet_cat_fines'), align: 'right' }, { header: t('total'), align: 'right' }],
        rows: rows.map((x) => [x.plate, formatNumber(x.km), formatMoney(x.fuel), formatMoney(x.maintenance), formatMoney(x.repair), formatMoney(x.insurance), formatMoney(x.other), formatMoney(x.fines), formatMoney(x.total)]),
        totals: r ? [t('total'), formatNumber(r.totals.km), formatMoney(r.totals.fuel), formatMoney(r.totals.maintenance), formatMoney(r.totals.repair), formatMoney(r.totals.insurance), formatMoney(r.totals.other), formatMoney(r.totals.fines), formatMoney(r.totals.total)] : [],
      },
      signers: [{ role: t('fleet_responsible'), name: user.fullName }],
    };
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_reports') }]}
        title={t('fleet_nav_reports')}
        subtitle={`${t('fleet_reportsSub')} · ${pl}`}
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            <Button icon="download" disabled={!r} onClick={() => r && exportXlsx(`${t('fleet_nav_reports')} ${period.value}.xlsx`, sheets(r), user.fullName)}>{t('svc_exportExcel')}</Button>
            <PrintButton doc={printDoc} template="registry" />
          </>
        }
      />
      <FleetNav active="reports" />
      {!r ? <Card><Loading /></Card> : (
        <>
          <div className="flt-kpis">
            <Stat label={t('fleet_costsPeriod')} value={formatMoney(r.totals.total)} icon="wallet" tone="accent" foot={pl} />
            <Stat label={t('fleet_distance')} value={formatNumber(r.totals.km)} icon="chart" foot={`${t('fleet_costPerKm')}: ${r.totals.km ? formatMoney(Math.round(veh.reduce((a, x) => a + x.total, 0) / r.totals.km)) : '—'}`} />
            <Stat label={t('fleet_fuelVsNorm')} value={`${dec(r.totals.usedLitres)} / ${dec(r.totals.normLitres)}`} icon="receipt" tone={r.totals.usedLitres > r.totals.normLitres * 1.1 ? 'alert' : undefined} foot={`${t('fleet_deviation')}: ${r.totals.normLitres ? `${dec(fleetDeviationPct(r.totals.usedLitres, r.totals.normLitres))}%` : '—'}`} />
            <Stat label={t('fleet_fuelLitresIn')} value={formatNumber(r.totals.fuelLitres)} icon="plug" foot={formatMoney(r.totals.fuel)} />
          </div>
          <Card flush>
            <Tabs<Kind>
              value={kind}
              onChange={setKind}
              items={[
                { value: 'summary', label: t('fleet_rep_summary') },
                { value: 'costs', label: t('fleet_rep_costs') },
                { value: 'drivers', label: t('fleet_rep_drivers') },
                { value: 'fuel', label: t('fleet_rep_fuel') },
                { value: 'mileage', label: t('fleet_rep_mileage') },
                { value: 'usage', label: t('fleet_rep_usage') },
                { value: 'service', label: t('fleet_rep_service') },
                { value: 'statuses', label: t('fleet_rep_statuses') },
              ]}
            />
            {kind === 'summary' && (
              <div className="grid grid-2" style={{ padding: 16 }}>
                <div>
                  <h4 style={{ margin: '0 0 10px' }}>{t('fleet_costStructure')}</h4>
                  <BarChart data={(['fuel', 'maintenance', 'repair', 'insurance', 'other', 'fines'] as const).map((k) => ({ label: t(tk('fleet_cat_', k)), values: [Math.round(r.totals[k] / 1000)] }))} series={[{ name: t('fleet_thousandSum') }]} height={200} format={(n) => formatNumber(n)} />
                </div>
                <div>
                  <h4 style={{ margin: '0 0 10px' }}>{t('fleet_byFuelType')}</h4>
                  <DataTable rows={r.fuelTypes} rowKey={(x) => x.fuel} emptyText={t('fleet_noCosts')} columns={[
                    { header: t('fleet_fuel'), render: (x) => t(tk('fleet_fuel_', x.fuel)) },
                    { header: t('fleet_litres'), align: 'right', render: (x) => dec(x.litres) },
                    { header: t('amount'), align: 'right', render: (x) => formatMoney(x.amount) },
                    { header: t('fleet_vehiclesCount'), align: 'right', render: (x) => x.vehicles },
                  ]} />
                  <h4 style={{ margin: '14px 0 10px' }}>{t('fleet_otherExpenses')}</h4>
                  <div className="flt-bars">{(Object.entries(r.otherByKind) as [string, number][]).map(([k, v]) => <div key={k} className="flt-bar"><span>{t(tk('fleet_exp_', k))}</span><span /><span className="flt-bar-val">{formatMoney(v)}</span></div>)}</div>
                </div>
              </div>
            )}
            {kind === 'costs' && (
              <DataTable rows={r.vehicles} rowKey={(x) => x.vehicleId} columns={[plateCol, { header: t('fleet_distance'), align: 'right', render: (x) => formatNumber(x.km) }, money('fuel'), money('maintenance'), money('repair'), money('insurance'), money('other'), money('fines'), { header: t('total'), align: 'right', render: (x) => <b>{formatMoney(x.total)}</b> }, { header: t('fleet_costPerKm'), align: 'right', render: (x) => (x.km ? formatMoney(x.costPerKm) : '—') }]} />
            )}
            {kind === 'drivers' && (
              <DataTable rows={r.drivers} rowKey={(x) => x.driverId} columns={[
                { header: t('fleet_driver'), render: (x) => <Link to={`/fleet/drivers/${x.driverId}`}>{x.name}</Link> },
                { header: t('fleet_tripsCount'), align: 'right', render: (x) => x.trips },
                { header: t('fleet_distance'), align: 'right', render: (x) => formatNumber(x.km) },
                { header: t('fleet_fuelVsNorm'), align: 'right', render: (x) => `${dec(x.usedLitres)} / ${dec(x.normLitres)}` },
                { header: t('fleet_overrun'), align: 'right', render: (x) => <span className={x.overrunLitres ? 'flt-over' : ''}>{dec(x.overrunLitres)}</span> },
                { header: t('fleet_saving'), align: 'right', render: (x) => <span className={x.savingLitres ? 'flt-save' : ''}>{dec(x.savingLitres)}</span> },
                { header: t('fleet_overrunSaveSum'), align: 'right', render: (x) => `${formatMoney(x.overrunSum)} / ${formatMoney(x.savingSum)}` },
                { header: t('fleet_cat_fuel'), align: 'right', render: (x) => formatMoney(x.fuelSum) },
                { header: t('fleet_cat_fines'), align: 'right', render: (x) => `${formatMoney(x.fines)} (${x.finesCount})` },
                { header: t('total'), align: 'right', render: (x) => <b>{formatMoney(x.expenses)}</b> },
              ]} />
            )}
            {kind === 'fuel' && (
              <DataTable rows={r.vehicles} rowKey={(x) => x.vehicleId} columns={[
                plateCol,
                { header: t('fleet_normUsed'), align: 'right', render: (x) => dec(x.normLitres) },
                { header: t('fleet_fuelUsed'), align: 'right', render: (x) => dec(x.usedLitres) },
                { header: t('fleet_deviation'), align: 'right', render: (x) => { const d = x.normLitres ? fleetDeviationPct(x.usedLitres, x.normLitres) : 0; return <b className={d > 10 ? 'flt-over' : d < 0 ? 'flt-save' : ''}>{x.normLitres ? `${d > 0 ? '+' : ''}${dec(d)}%` : '—'}</b>; } },
                { header: t('fleet_deviationSum'), align: 'right', render: (x) => <span className={x.deviationSum > 0 ? 'flt-over' : x.deviationSum < 0 ? 'flt-save' : ''}>{x.deviationSum > 0 ? '+' : ''}{formatMoney(x.deviationSum)}</span> },
                { header: t('fleet_limitPlanL'), align: 'right', render: (x) => `${dec(x.fuelLitres)} / ${formatNumber(x.limitLitres)}` },
                { header: t('fleet_limitPlanSum'), align: 'right', render: (x) => <span className={x.limitSum && x.fuel > x.limitSum ? 'flt-over' : ''}>{formatMoney(x.fuel)} / {formatMoney(x.limitSum)}</span> },
              ]} />
            )}
            {kind === 'mileage' && (
              <DataTable rows={veh} rowKey={(x) => x.vehicleId} columns={[
                plateCol,
                { header: t('fleet_odoStartP'), align: 'right', render: (x) => formatNumber(x.odoStart) },
                { header: t('fleet_odoEndP'), align: 'right', render: (x) => formatNumber(x.odoEnd) },
                { header: t('fleet_distance'), align: 'right', render: (x) => <b>{formatNumber(x.km)}</b> },
                { header: t('fleet_tripsCount'), align: 'right', render: (x) => x.trips },
                { header: t('fleet_kmPerDay'), align: 'right', render: (x) => (x.usedDays ? formatNumber(Math.round(x.km / x.usedDays)) : '—') },
              ]} />
            )}
            {kind === 'usage' && (
              <DataTable rows={r.vehicles} rowKey={(x) => x.vehicleId} columns={[
                plateCol,
                { header: t('fleet_days'), align: 'right', render: (x) => x.days },
                { header: t('fleet_usedDays'), align: 'right', render: (x) => x.usedDays },
                { header: t('fleet_downtime'), align: 'right', render: (x) => <span className={x.downtimeDays ? 'flt-over' : ''}>{x.downtimeDays}</span> },
                { header: t('fleet_idle'), align: 'right', render: (x) => x.idleDays },
                { header: t('fleet_utilization'), align: 'right', render: (x) => <b>{dec(x.utilizationPct)}%</b> },
              ]} />
            )}
            {kind === 'service' && (
              <DataTable rows={r.services} rowKey={(x) => x.serviceId} emptyText={t('fleet_noServicePeriod')} columns={[
                { header: '№', render: (x) => <Link to={`/fleet/service/${x.serviceId}`} className="doc-num">{x.number}</Link> },
                { header: t('date'), render: (x) => x.date },
                { header: t('fleet_plate'), render: (x) => <Plate value={x.plate} /> },
                { header: t('type'), render: (x) => t(tk('fleet_svc_', x.kind)) },
                { header: t('fleet_contractor'), render: (x) => x.contractor || '—' },
                { header: t('fleet_works'), align: 'right', render: (x) => formatMoney(x.works) },
                { header: t('fleet_parts'), align: 'right', render: (x) => formatMoney(x.parts) },
                { header: t('total'), align: 'right', render: (x) => (<><b>{formatMoney(x.total)}</b>{x.warranty && <div className="sub">{t('fleet_warranty')}</div>}</>) },
                { header: t('status'), render: (x) => <Badge tone={x.status === 'done' ? 'ok' : 'warn'}>{t(tk('fleet_sstatus_', x.status))}</Badge> },
              ]} />
            )}
            {kind === 'statuses' && (
              <DataTable rows={FLEET_STATUSES} rowKey={(s) => s} columns={[
                { header: t('status'), render: (s) => t(tk('fleet_status_', s)) },
                { header: t('fleet_vehiclesCount'), align: 'right', render: (s) => (vehicles.data ?? []).filter((v) => v.status === s && v.kind === 'vehicle').length },
                { header: t('fleet_generators'), align: 'right', render: (s) => (vehicles.data ?? []).filter((v) => v.status === s && v.kind === 'generator').length },
                { header: t('fleet_vehicles'), render: (s) => <div className="flt-row">{(vehicles.data ?? []).filter((v) => v.status === s).map((v) => <Link key={v.id} to={`/fleet/${v.id}`}><Plate value={v.plate} /></Link>)}</div> },
              ]} />
            )}
          </Card>
        </>
      )}
    </>
  );
}
