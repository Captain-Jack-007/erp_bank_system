// Командировки: справочники норм (суточные, проживание, классы проезда по грейдам) и отчёты
// (по подразделениям / сотрудникам / направлениям, план-факт бюджета, средняя стоимость) — PR-TRV-013, 014.
import { useState } from 'react';
import {
  canEditTripNorms, formatMoney, formatNumber, pick, tk, tripPlace, tripsApi, tripDestination,
  type TripCurrency, type TripDestination, type TripGrade, type TripGradeNorm, type TripReportRow, type TripTransportClass,
} from '@xb/shared';
import { BarChart, Button, Card, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, Tabs, type Column } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Note, useAction, yearStart } from '../documents/p2docs';

const ALL_CLASSES: TripTransportClass[] = ['economy', 'business', 'rail_seat', 'rail_coupe', 'rail_sv', 'car', 'bus'];

export function TripNormsPage() {
  const { t, lang } = useSession();
  const user = useUser();
  const norms = useApi(() => tripsApi.norms());
  const [edit, setEdit] = useState<TripDestination | null>(null);
  const [grade, setGrade] = useState<TripGradeNorm | null>(null);
  const editable = canEditTripNorms(user);
  const n = norms.data;
  const cols: Column<TripDestination>[] = [
    { header: t('trips_destination'), render: (d) => { const p = tripPlace(d, lang); return <><b>{p.city}</b><div className="sub">{p.country}</div></>; } },
    { header: t('trips_destinationType'), render: (d) => (d.type === 'abroad' ? t('trips_dest_abroad') : t('trips_dest_domestic')) },
    { header: t('trips_perDiem'), align: 'right', render: (d) => (d.currency === 'USD' ? `${d.perDiem} USD` : formatMoney(d.perDiem)) },
    { header: t('trips_hotelLimit'), align: 'right', render: (d) => (d.currency === 'USD' ? `${d.hotelLimit} USD` : formatMoney(d.hotelLimit)) },
    { header: pick(lang, 'В сумах (по курсу)', 'So‘mda (kurs bo‘yicha)', 'In UZS (at rate)'), align: 'right', render: (d) => (d.currency === 'USD' && n ? `${formatNumber(d.perDiem * n.usdRate)} / ${formatNumber(d.hotelLimit * n.usdRate)}` : '—') },
    { header: '', render: (d) => (editable ? <Button size="small" onClick={() => setEdit(d)}>{pick(lang, 'Изменить', 'O‘zgartirish', 'Edit')}</Button> : null) },
  ];
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('trips_title'), to: '/trips' }, { label: pick(lang, 'Нормы и лимиты', 'Me’yorlar va limitlar', 'Norms and limits') }]}
        title={pick(lang, 'Нормы суточных, проживания и проезда', 'Kundalik, yashash va yo‘l me’yorlari', 'Per diem, accommodation and travel norms')}
        subtitle={pick(lang, 'Справочник ведут бухгалтерия и HR; при превышении лимита система предупреждает в заявке и отчёте', 'Ma’lumotnomani buxgalteriya va HR yuritadi; limit oshsa, tizim ariza va hisobotda ogohlantiradi', 'Maintained by accounting and HR; the system warns when a limit is exceeded')}
        actions={<ExportButton filename={pick(lang, 'Нормы командировок', 'Safar me’yorlari', 'Trip norms')} columns={[{ header: t('trips_destination'), value: (d: TripDestination) => tripPlace(d, lang).city }, { header: pick(lang, 'Валюта', 'Valyuta', 'Currency'), value: (d: TripDestination) => d.currency }, { header: t('trips_perDiem'), value: (d: TripDestination) => d.perDiem, format: 'number' }, { header: t('trips_hotelLimit'), value: (d: TripDestination) => d.hotelLimit, format: 'number' }]} rows={n?.destinations ?? []} />}
      />
      {n && <Note>{pick(lang, `Курс для пересчёта зарубежных норм: 1 USD = ${formatNumber(n.usdRate)} сум`, `Xorijiy me’yorlar kursi: 1 USD = ${formatNumber(n.usdRate)} so‘m`, `Rate for foreign norms: 1 USD = ${formatNumber(n.usdRate)} UZS`)}</Note>}
      <Card title={pick(lang, 'Лимиты по грейдам должностей', 'Lavozim gradelari bo‘yicha limitlar', 'Limits by position grade')} flush>
        <DataTable
          rows={n?.grades}
          loading={norms.loading}
          rowKey={(g) => g.grade}
          columns={[
            { header: pick(lang, 'Грейд', 'Grade', 'Grade'), render: (g) => <b>{t(tk('trips_grade_', g.grade))}</b> },
            { header: pick(lang, 'Разрешённые классы проезда', 'Ruxsat etilgan klasslar', 'Allowed classes'), render: (g) => <span className="small">{g.allowedClasses.map((c) => t(tk('trips_class_', c))).join(', ')}</span> },
            { header: pick(lang, 'Коэффициент к лимиту проживания', 'Yashash limiti koeffitsienti', 'Hotel limit factor'), align: 'right', render: (g) => `×${g.hotelFactor}` },
            { header: pick(lang, 'Представительские, на поездку', 'Vakillik, safar uchun', 'Hospitality per trip'), align: 'right', render: (g) => formatMoney(g.hospitalityLimit) },
            { header: '', render: (g) => (editable ? <Button size="small" onClick={() => setGrade(g)}>{pick(lang, 'Изменить', 'O‘zgartirish', 'Edit')}</Button> : null) },
          ]}
        />
      </Card>
      <Card title={pick(lang, 'Нормы по направлениям', 'Yo‘nalishlar bo‘yicha me’yorlar', 'Norms by destination')} flush>
        <DataTable rows={n?.destinations} loading={norms.loading} columns={cols} rowKey={(d) => d.id} />
      </Card>
      {edit && <DestModal d={edit} onClose={() => setEdit(null)} />}
      {grade && <GradeModal g={grade} onClose={() => setGrade(null)} />}
    </>
  );
}

function DestModal({ d, onClose }: { d: TripDestination; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [perDiem, setPerDiem] = useState(String(d.perDiem));
  const [hotel, setHotel] = useState(String(d.hotelLimit));
  const [currency, setCurrency] = useState<TripCurrency>(d.currency);
  const valid = Number(perDiem) > 0 && Number(hotel) > 0;
  return (
    <Modal
      title={`${t('trips_destination')}: ${tripPlace(d, lang).city}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} disabled={!valid} onClick={async () => { if (await run(() => tripsApi.updateDestinationNorm(d.id, { perDiem: Number(perDiem), hotelLimit: Number(hotel), currency }, user), t('saved'))) onClose(); }}>{t('save')}</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('trips_perDiem')} required><Input type="number" value={perDiem} onChange={(e) => setPerDiem(e.target.value)} ariaLabel={t('trips_perDiem')} /></Field>
        <Field label={t('trips_hotelLimit')} required><Input type="number" value={hotel} onChange={(e) => setHotel(e.target.value)} ariaLabel={t('trips_hotelLimit')} /></Field>
        <Field label={pick(lang, 'Валюта нормы', 'Me’yor valyutasi', 'Norm currency')}><Select<TripCurrency> value={currency} onChange={setCurrency} options={[{ value: 'UZS', label: 'UZS' }, { value: 'USD', label: 'USD' }]} ariaLabel="currency" /></Field>
      </div>
    </Modal>
  );
}

function GradeModal({ g, onClose }: { g: TripGradeNorm; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [classes, setClasses] = useState<TripTransportClass[]>(g.allowedClasses);
  const [factor, setFactor] = useState(String(g.hotelFactor));
  const [hosp, setHosp] = useState(String(g.hospitalityLimit));
  const valid = classes.length > 0 && Number(factor) > 0 && Number(hosp) >= 0;
  return (
    <Modal
      title={`${pick(lang, 'Грейд', 'Grade', 'Grade')}: ${t(tk('trips_grade_', g.grade))}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} disabled={!valid} onClick={async () => { if (await run(() => tripsApi.updateGradeNorm(g.grade as TripGrade, { allowedClasses: classes, hotelFactor: Number(factor), hospitalityLimit: Number(hosp) }, user), t('saved'))) onClose(); }}>{t('save')}</Button>
        </>
      }
    >
      <Field label={pick(lang, 'Разрешённые классы проезда', 'Ruxsat etilgan klasslar', 'Allowed classes')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {ALL_CLASSES.map((c) => <Checkbox key={c} checked={classes.includes(c)} onChange={(v) => setClasses(v ? [...classes, c] : classes.filter((x) => x !== c))}>{t(tk('trips_class_', c))}</Checkbox>)}
        </div>
      </Field>
      <div className="form-grid">
        <Field label={pick(lang, 'Коэффициент к лимиту проживания', 'Yashash limiti koeffitsienti', 'Hotel limit factor')}><Input type="number" value={factor} onChange={(e) => setFactor(e.target.value)} ariaLabel="factor" /></Field>
        <Field label={pick(lang, 'Представительские, сум', 'Vakillik, so‘m', 'Hospitality, UZS')}><Input type="number" value={hosp} onChange={(e) => setHosp(e.target.value)} ariaLabel="hospitality" /></Field>
      </div>
    </Modal>
  );
}

type RTab = 'department' | 'employee' | 'destination' | 'budget';

export function TripReportsPage() {
  const { t, lang, loc } = useSession();
  const can = useCan();
  const lk = useLookups();
  const [tab, setTab] = useState<RTab>('department');
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const rows = useApi(() => (tab === 'budget' ? Promise.resolve([] as TripReportRow[]) : tripsApi.report(tab, { from, to })), [tab, from, to]);
  const budget = useApi(() => tripsApi.budgetReport(), []);
  if (!can('trips', 'approve') && !can('trips', 'admin')) return <Card><Note tone="warn">{t('noAccess')}</Note></Card>;
  const keyName = (k: string) => (tab === 'department' ? (lk.department(k) ? loc(lk.department(k)!.name) : k) : tab === 'employee' ? (lk.user(k)?.fullName ?? k) : tripPlace(tripDestination(k), lang).city);
  const cols: Column<TripReportRow>[] = [
    { header: tab === 'department' ? t('department') : tab === 'employee' ? t('trips_employee') : t('trips_destination'), render: (r) => <b>{keyName(r.key)}</b> },
    { header: pick(lang, 'Командировок', 'Safarlar', 'Trips'), align: 'right', render: (r) => r.trips },
    { header: t('trips_days'), align: 'right', render: (r) => r.days },
    { header: pick(lang, 'План (авансы)', 'Reja (avanslar)', 'Plan (advances)'), align: 'right', render: (r) => formatMoney(r.planned) },
    { header: pick(lang, 'Факт (отчёты)', 'Fakt (hisobotlar)', 'Actual (reports)'), align: 'right', render: (r) => formatMoney(r.actual) },
    { header: pick(lang, 'Отклонение', 'Farq', 'Variance'), align: 'right', render: (r) => <span style={{ color: r.actual > r.planned ? 'var(--danger)' : undefined }}>{formatMoney(r.actual - r.planned)}</span> },
    { header: pick(lang, 'Средняя стоимость', 'O‘rtacha narx', 'Avg cost'), align: 'right', render: (r) => formatMoney(r.avgCost) },
    { header: pick(lang, 'В сутки', 'Kuniga', 'Per day'), align: 'right', render: (r) => formatMoney(r.avgPerDay) },
  ];
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('trips_title'), to: '/trips' }, { label: pick(lang, 'Отчёты', 'Hisobotlar', 'Reports') }]}
        title={pick(lang, 'Аналитика командировочных расходов', 'Xizmat safari xarajatlari tahlili', 'Business travel analytics')}
        actions={
          tab === 'budget' ? (
            <ExportButton filename={pick(lang, 'Бюджет командировок', 'Safar byudjeti', 'Travel budget')} columns={[{ header: t('department'), value: (r: { departmentId: string }) => keyNameDep(r.departmentId) }, { header: pick(lang, 'Лимит', 'Limit', 'Limit'), value: (r: { limit: number }) => r.limit, format: 'money', total: true }, { header: pick(lang, 'Исполнено YTD', 'YTD ijro', 'Used YTD'), value: (r: { used: number }) => r.used, format: 'money', total: true }, { header: pick(lang, 'Авансы', 'Avanslar', 'Advances'), value: (r: { tripsPlanned: number }) => r.tripsPlanned, format: 'money', total: true }, { header: pick(lang, 'Факт', 'Fakt', 'Actual'), value: (r: { tripsActual: number }) => r.tripsActual, format: 'money', total: true }]} rows={budget.data ?? []} />
          ) : (
            <ExportButton filename={pick(lang, 'Отчёт по командировкам', 'Safarlar hisoboti', 'Trips report')} columns={[{ header: pick(lang, 'Разрез', 'Kesim', 'Key'), value: (r: TripReportRow) => keyName(r.key) }, { header: pick(lang, 'Командировок', 'Safarlar', 'Trips'), value: (r: TripReportRow) => r.trips, format: 'integer', total: true }, { header: t('trips_days'), value: (r: TripReportRow) => r.days, format: 'integer', total: true }, { header: pick(lang, 'План', 'Reja', 'Plan'), value: (r: TripReportRow) => r.planned, format: 'money', total: true }, { header: pick(lang, 'Факт', 'Fakt', 'Actual'), value: (r: TripReportRow) => r.actual, format: 'money', total: true }, { header: pick(lang, 'Средняя стоимость', 'O‘rtacha narx', 'Avg cost'), value: (r: TripReportRow) => r.avgCost, format: 'money' }]} rows={rows.data ?? []} />
          )
        }
      />
      <Card flush>
        <Tabs<RTab> value={tab} onChange={setTab} items={[
          { value: 'department', label: pick(lang, 'По подразделениям', 'Bo‘linmalar bo‘yicha', 'By department') },
          { value: 'employee', label: pick(lang, 'По сотрудникам', 'Xodimlar bo‘yicha', 'By employee') },
          { value: 'destination', label: pick(lang, 'По направлениям', 'Yo‘nalishlar bo‘yicha', 'By destination') },
          { value: 'budget', label: pick(lang, 'Исполнение бюджета (план-факт)', 'Byudjet ijrosi (reja-fakt)', 'Budget execution (plan vs actual)') },
        ]} />
        {tab !== 'budget' ? (
          <>
            <div className="p2-filter-wide">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={pick(lang, 'Период с', 'Davr boshi', 'From')} />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={pick(lang, 'Период по', 'Davr oxiri', 'To')} />
            </div>
            {rows.data && rows.data.length > 0 && (
              <div style={{ padding: 14 }}>
                <BarChart data={rows.data.slice(0, 8).map((r, i, all) => { const short = keyName(r.key).split(' ').slice(0, 2).join(' '); const dup = all.slice(0, i).some((x) => keyName(x.key).split(' ').slice(0, 2).join(' ') === short); return { label: dup ? `${short} (${i + 1})` : short, values: [Math.round(r.planned / 1e6), Math.round(r.actual / 1e6)] }; })} series={[{ name: pick(lang, 'План, млн', 'Reja, mln', 'Plan, mn') }, { name: pick(lang, 'Факт, млн', 'Fakt, mln', 'Actual, mn') }]} />
              </div>
            )}
            <DataTable rows={rows.data} loading={rows.loading} columns={cols} rowKey={(r) => r.key} />
          </>
        ) : budget.error ? (
          <div style={{ padding: 14 }}><Note tone="danger">{budget.error.message}</Note></div>
        ) : (
          <DataTable
            rows={budget.data}
            loading={budget.loading}
            rowKey={(r) => r.departmentId}
            columns={[
              { header: t('department'), render: (r) => <b>{keyNameDep(r.departmentId)}</b> },
              { header: pick(lang, 'Лимит статьи на год', 'Yillik modda limiti', 'Annual limit'), align: 'right', render: (r) => (r.limit ? formatMoney(r.limit) : <span className="muted">{t('trips_budget_no_line')}</span>) },
              { header: pick(lang, 'Исполнено YTD (бюджет)', 'YTD ijro (byudjet)', 'Used YTD'), align: 'right', render: (r) => formatMoney(r.used) },
              { header: pick(lang, 'Авансы по командировкам', 'Safar avanslari', 'Trip advances'), align: 'right', render: (r) => formatMoney(r.tripsPlanned) },
              { header: pick(lang, 'Факт по отчётам', 'Hisobotlar bo‘yicha fakt', 'Actual by reports'), align: 'right', render: (r) => formatMoney(r.tripsActual) },
              { header: pick(lang, 'Остаток лимита', 'Limit qoldig‘i', 'Remaining'), align: 'right', render: (r) => (r.limit ? <span style={{ color: r.available < 0 ? 'var(--danger)' : undefined }}>{formatMoney(r.available)}</span> : '—') },
            ]}
          />
        )}
      </Card>
    </>
  );

  function keyNameDep(id: string): string {
    return lk.department(id) ? loc(lk.department(id)!.name) : id;
  }
}
