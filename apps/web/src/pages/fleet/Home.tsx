// Обзор (дашборд) автопарка: ТС по статусам, расходы за период, топ расходов, ТО и документы со сроком (PR-FLT-126…131).
import { useEffect, useState } from 'react';
import { fleetApi, fleetCanManage, formatDate, formatMoney, formatMoneyShort, formatNumber, tk, type FleetPeriod } from '@xb/shared';
import { Badge, BarChart, Button, Card, Empty, PageHeader, Stat } from '../../components/ui';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { ALERT_ICON, FLEET_STATUSES, FleetNav, PeriodPicker, Plate, periodLabel } from './shared';
import { OpenTripModal } from './tripForms';
import { Icon } from '../../components/icons';

export function FleetHomePage() {
  const { t, lang } = useSession();
  const user = useUser();
  const canManage = fleetCanManage(user);
  const [period, setPeriod] = useState<FleetPeriod>(() => fleetApi.currentPeriod('month'));
  const [trip, setTrip] = useState(false);
  const stats = useApi(() => fleetApi.getStats(), []);
  const dash = useApi(() => fleetApi.dashboard(period), [period.type, period.value]);
  const s = stats.data;
  const d = dash.data;
  useEffect(() => {
    // первый заход в модуль — проверка сроков и рассылка уведомлений (повторно не дублируются)
    void fleetApi.listAlerts();
  }, []);
  const maxTop = Math.max(1, ...(d?.topVehicles.map((x) => x.total) ?? [1]));
  const maxCat = Math.max(1, ...(d?.topCategories.map((x) => x.total) ?? [1]));

  return (
    <>
      <PageHeader
        title={t('fleet_title')}
        subtitle={t('fleet_subtitle')}
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            {canManage && (
              <Button type="primary" icon="plus" onClick={() => setTrip(true)}>
                {t('fleet_openTrip')}
              </Button>
            )}
          </>
        }
      />
      <FleetNav active="overview" />
      <div className="flt-kpis">
        <Stat label={t('fleet_total')} value={s?.vehicles ?? '—'} icon="car" tone="accent" foot={s ? `${t('fleet_onTrip')}: ${s.onTrip} · ${t('fleet_inMaintenance')}: ${s.maintenance} · ${t('fleet_generators')}: ${s.generators}` : undefined} />
        <Stat label={`${t('fleet_costsPeriod')} · ${periodLabel(period, lang)}`} value={d ? formatMoneyShort(d.costs.total) : '—'} icon="wallet" foot={d ? `${t('fleet_psrc_fuel')}: ${formatMoneyShort(d.costs.fuel)}` : undefined} />
        <Stat label={t('fleet_kmPeriod')} value={d ? formatNumber(d.km) : '—'} icon="chart" foot={d ? `${t('fleet_fuelPeriod')}: ${formatNumber(d.fuelLitres)} ${t('fleet_l')}` : undefined} />
        <Stat label={t('fleet_alerts')} value={s?.alerts ?? '—'} tone={s?.alerts ? 'alert' : undefined} icon="alert" foot={d ? `${t('fleet_pendingTrips')}: ${d.pendingTrips} · ${t('fleet_draftPostings')}: ${d.draftPostings}` : undefined} />
      </div>

      <div className="grid grid-2">
        <Card title={t('fleet_byStatus')}>
          {d ? (
            <BarChart data={FLEET_STATUSES.map((st) => ({ label: t(tk('fleet_statusShort_', st)), values: [d.byStatus[st]] }))} series={[{ name: t('fleet_vehiclesCount') }]} height={200} />
          ) : (
            <Empty text={t('empty')} icon="chart" />
          )}
        </Card>
        <Card title={`${t('fleet_costStructure')} · ${periodLabel(period, lang)}`}>
          {d && d.costs.total > 0 ? (
            <div className="flt-bars" data-testid="flt-cats">
              {d.topCategories.map((c) => (
                <div key={c.key} className="flt-bar">
                  <span>{t(tk('fleet_cat_', c.key))}</span>
                  <span className="flt-bar-track"><span className="flt-bar-fill" style={{ width: `${(c.total / maxCat) * 100}%` }} /></span>
                  <span className="flt-bar-val">{formatMoneyShort(c.total)}</span>
                </div>
              ))}
              <div className="flt-bar"><b>{t('total')}</b><span /><b className="flt-bar-val">{formatMoney(d.costs.total)}</b></div>
            </div>
          ) : (
            <Empty text={t('fleet_noCosts')} icon="wallet" />
          )}
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title={t('fleet_topVehicles')} flush>
          {d?.topVehicles.length ? (
            <div className="flt-bars" style={{ padding: 16 }}>
              {d.topVehicles.map((v) => (
                <div key={v.vehicleId} className="flt-bar">
                  <Link to={`/fleet/${v.vehicleId}`}><Plate value={v.plate} /></Link>
                  <span className="flt-bar-track"><span className="flt-bar-fill" style={{ width: `${(v.total / maxTop) * 100}%`, background: 'var(--accent)' }} /></span>
                  <span className="flt-bar-val">{formatMoneyShort(v.total)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty text={t('fleet_noCosts')} />
          )}
        </Card>
        <Card title={t('fleet_needService')} flush>
          {d?.needService.length ? (
            d.needService.map((x) => (
              <div key={x.vehicleId} className="flt-list-item">
                <div className="flt-li-main">
                  <Link to={`/fleet/${x.vehicleId}`}><Plate value={x.plate} /></Link>
                  <div className="flt-li-sub">{x.detail}</div>
                </div>
                <Badge tone={x.overdue ? 'danger' : 'warn'}>{x.overdue ? t('fleet_overdue') : x.due ? formatDate(x.due) : t('fleet_soon')}</Badge>
              </div>
            ))
          ) : (
            <Empty text={t('fleet_noService')} icon="check" />
          )}
        </Card>
        <Card title={t('fleet_expiringDocs')} flush actions={<Link to="/fleet/alerts" className="btn btn-sm">{t('open')}</Link>}>
          {d?.expiringDocs.length ? (
            d.expiringDocs.slice(0, 8).map((a) => (
              <div key={a.id} className="flt-list-item">
                <div className="flt-li-main">
                  <div><Icon name={ALERT_ICON[a.kind]} size={14} /> {t(tk('fleet_alert_', a.kind))}</div>
                  <div className="flt-li-sub">{a.detail}</div>
                </div>
                <Badge tone={a.expired ? 'danger' : 'warn'}>{a.due ? formatDate(a.due) : '—'}</Badge>
              </div>
            ))
          ) : (
            <Empty text={t('fleet_noAlerts')} icon="check" />
          )}
        </Card>
      </div>
      {trip && <OpenTripModal onClose={() => setTrip(false)} onSaved={(id) => navigate(`/fleet/trips/${id}`)} />}
    </>
  );
}
