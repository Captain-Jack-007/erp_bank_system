import { useState } from 'react';
import {
  currencyLabel, formatDate, formatMoney, formatMoneyShort, pick, tk, tripDays, tripDestination, tripJournalStatus, tripPlace, tripSettlement, tripsApi,
  type TripDestinationType, type TripFilter, type TripRequest,
} from '@xb/shared';
import { Card, DataTable, Input, PageHeader, Select, Stat, StatusBadge, type Column } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link, navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { TRIP_TONE } from './shared';

const STATUSES: NonNullable<TripFilter['status']>[] = ['draft', 'pending', 'approved', 'on_trip', 'report_due', 'report_pending', 'closed', 'rejected'];

export function TripsPage() {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TripFilter['status'] | ''>('');
  const [destType, setDestType] = useState<TripDestinationType | ''>('');
  const [employee, setEmployee] = useState('');
  const stats = useApi(() => tripsApi.stats(user), [user.id]);
  const list = useApi(() => tripsApi.list(user, { search, ...(status ? { status } : {}), ...(destType ? { destinationType: destType } : {}), ...(employee ? { employeeId: employee } : {}) }), [user.id, search, status, destType, employee]);
  const s = stats.data;
  const approver = can('trips', 'approve');
  const empTrips = employee ? (list.data ?? []) : [];

  const columns: Column<TripRequest>[] = [
    { header: t('number'), render: (tr) => <><div className="doc-num">{tr.number}</div><div className="sub">{formatDate(tr.startDate)} — {formatDate(tr.endDate)}</div></> },
    { header: t('trips_employee'), render: (tr) => <>{lk.user(tr.employeeId)?.fullName}<div className="sub">{lk.department(tr.departmentId) ? loc(lk.department(tr.departmentId)!.name) : ''}</div></> },
    { header: t('trips_destination'), render: (tr) => { const p = tripPlace(tripDestination(tr.destinationId), lang); return <>{p.city}<div className="sub">{p.country}</div></>; } },
    { header: t('trips_purpose'), render: (tr) => <span className="small">{tr.purpose}</span> },
    { header: t('trips_advance'), align: 'right', render: (tr) => formatMoney(tr.advance) },
    { header: t('status'), render: (tr) => { const js = tripJournalStatus(tr); return <StatusBadge prefix="trips_status_" status={js} tone={TRIP_TONE[js]} />; } },
  ];

  return (
    <>
      <PageHeader
        title={t('trips_title')}
        subtitle={pick(lang, 'ТЗ 4.2.11 · заявление → руководитель → HR → финансы, приказ, аванс, авансовый отчёт, нормы и отчёты', 'TT 4.2.11 · ariza → rahbar → HR → moliya, buyruq, avans, avans hisoboti, me’yorlar va hisobotlar', 'ToR 4.2.11 · application → manager → HR → finance, order, advance, expense report, norms and reports')}
        actions={
          <>
            <Link to="/trips/norms" className="btn">{pick(lang, 'Нормы и лимиты', 'Me’yorlar va limitlar', 'Norms and limits')}</Link>
            {approver && <Link to="/trips/reports" className="btn">{pick(lang, 'Отчёты', 'Hisobotlar', 'Reports')}</Link>}
            {can('trips', 'edit') && <Link to="/trips/new" className="btn btn-primary">{t('trips_new')}</Link>}
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={t('trips_statNow')} value={s?.onTripNow ?? '—'} icon="plane" />
        <Stat label={t('trips_statPending')} value={s?.pending ?? '—'} icon="clock" />
        <Stat label={t('trips_statAdvances')} value={s ? formatMoneyShort(s.advancesMonth, lang) : '—'} icon="wallet" foot={currencyLabel()} />
        <Stat label={t('trips_statReports')} value={s?.reportsDue ?? '—'} tone={s?.reportsDue ? 'alert' : undefined} icon="receipt" foot={s ? `${t('trips_status_report_pending')}: ${s.reportsOnCheck}` : undefined} />
      </div>
      {employee && (
        <Card title={`${pick(lang, 'История командировок сотрудника', 'Xodimning xizmat safarlari tarixi', 'Employee trip history')}: ${lk.user(employee)?.fullName ?? ''}`}>
          <div className="grid grid-4">
            <Stat label={pick(lang, 'Командировок', 'Safarlar', 'Trips')} value={empTrips.length} />
            <Stat label={pick(lang, 'Дней в командировках', 'Safardagi kunlar', 'Days travelling')} value={empTrips.filter((x) => !['draft', 'rejected'].includes(x.status)).reduce((a, x) => a + tripDays(x.startDate, x.endDate), 0)} />
            <Stat label={pick(lang, 'Авансы', 'Avanslar', 'Advances')} value={formatMoneyShort(empTrips.filter((x) => !['draft', 'rejected', 'pending'].includes(x.status)).reduce((a, x) => a + x.advance, 0), lang)} />
            <Stat label={pick(lang, 'Фактические расходы', 'Haqiqiy xarajatlar', 'Actual spend')} value={formatMoneyShort(empTrips.reduce((a, x) => a + (x.report ? tripSettlement(x).spent : 0), 0), lang)} />
          </div>
        </Card>
      )}
      <Card flush>
        <div className="p2-filter-wide">
          <Input placeholder={`${t('search')}: ${t('number')}, ${t('trips_destination').toLowerCase()}, ${t('trips_purpose').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={status} onChange={(v) => setStatus(v as TripFilter['status'])} placeholder={`${t('status')}: ${t('all')}`} options={STATUSES.map((x) => ({ value: x as string, label: t(tk('trips_status_', x)) }))} />
          <Select<TripDestinationType> value={destType} onChange={setDestType} placeholder={`${t('trips_destinationType')}: ${t('all')}`} options={[{ value: 'domestic', label: t('trips_dest_domestic') }, { value: 'abroad', label: t('trips_dest_abroad') }]} />
          {approver ? <Select value={employee} onChange={setEmployee} placeholder={`${t('trips_employee')}: ${t('all')}`} options={lk.users.map((u) => ({ value: u.id, label: u.fullName }))} /> : <span />}
        </div>
        <div className="toolbar" style={{ padding: '10px 14px', justifyContent: 'flex-end' }}>
          <ExportButton
            filename={pick(lang, 'Журнал командировок', 'Xizmat safarlari jurnali', 'Business trip journal')}
            title={t('trips_title')}
            columns={[
              { header: t('number'), value: (tr: TripRequest) => tr.number },
              { header: t('trips_employee'), value: (tr: TripRequest) => lk.user(tr.employeeId)?.fullName ?? '' },
              { header: t('department'), value: (tr: TripRequest) => (lk.department(tr.departmentId) ? loc(lk.department(tr.departmentId)!.name) : '') },
              { header: t('trips_destination'), value: (tr: TripRequest) => tripPlace(tripDestination(tr.destinationId), lang).city },
              { header: t('trips_start'), value: (tr: TripRequest) => tr.startDate },
              { header: t('trips_end'), value: (tr: TripRequest) => tr.endDate },
              { header: t('trips_days'), value: (tr: TripRequest) => tripDays(tr.startDate, tr.endDate), format: 'integer', total: true },
              { header: t('trips_advance'), value: (tr: TripRequest) => tr.advance, format: 'money', total: true },
              { header: t('trips_spent'), value: (tr: TripRequest) => (tr.report ? tripSettlement(tr).spent : 0), format: 'money', total: true },
              { header: t('status'), value: (tr: TripRequest) => t(tk('trips_status_', tripJournalStatus(tr))) },
            ]}
            rows={list.data ?? []}
          />
        </div>
        <DataTable rows={list.data} loading={list.loading} columns={columns} rowKey={(tr) => tr.id} onRowClick={(tr) => navigate(`/trips/${tr.id}`)} />
      </Card>
    </>
  );
}
