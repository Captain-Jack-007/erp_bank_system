import { useState } from 'react';
import {
  filesApi, formatMoney, pick, tk, today, tripCalc, tripDestination, tripGradeNorm, tripGradeOf, tripPlace, tripsApi,
  type TripPlanLine, type TripTransport, type TripTransportClass,
} from '@xb/shared';
import { Button, Card, Field, Input, PageHeader, RouteSteps, Select, Textarea, Upload, useToast } from '../../components/ui';
import { readFileBytes } from '../../components/download';
import { navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Note } from '../documents/p2docs';
import { CalcTable } from './shared';

const TRANSPORTS: TripTransport[] = ['air', 'rail', 'car', 'bus'];
const CLASSES: Record<TripTransport, TripTransportClass[]> = { air: ['economy', 'business'], rail: ['rail_seat', 'rail_coupe', 'rail_sv'], car: ['car'], bus: ['bus'] };
const PLAN_CATS: TripPlanLine['category'][] = ['visa', 'insurance', 'hospitality', 'other'];

export function TripFormPage() {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const toast = useToast();
  const dests = useApi(() => tripsApi.destinations());
  const [employeeId, setEmployeeId] = useState(user.id);
  const [destinationId, setDestinationId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [travelDays, setTravelDays] = useState('0');
  const [purpose, setPurpose] = useState('');
  const [transport, setTransport] = useState<TripTransport>('rail');
  const [transportClass, setTransportClass] = useState<TripTransportClass>('rail_coupe');
  const [transportCost, setTransportCost] = useState(0);
  const [hotelNightly, setHotelNightly] = useState(0);
  const [plan, setPlan] = useState<TripPlanLine[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const employee = lk.user(employeeId);
  const departmentId = employee?.departmentId ?? user.departmentId;
  const dest = tripDestination(destinationId);
  const input = { destinationId, startDate, endDate, transportCost, hotelNightly, travelDays: Number(travelDays) || 0, planLines: plan, transportClass, employeeId };
  const calc = tripCalc(input);
  const budget = useApi(() => (calc.total > 0 ? tripsApi.checkBudget(departmentId, calc.total) : Promise.resolve(undefined)), [departmentId, calc.total]);
  const datesInvalid = !!startDate && !!endDate && endDate < startDate;
  const pastStart = !!startDate && startDate < today();
  const planValid = plan.every((l) => l.description.trim() && l.amount > 0);
  const valid = destinationId && startDate && endDate && !datesInvalid && purpose.trim() && planValid;
  const err = (ok: unknown) => (showErrors && !ok ? t('formRequired') : undefined);
  const grade = tripGradeOf(employeeId);
  const gradeNorm = tripGradeNorm(grade);
  const lockEmployee = !can('trips', 'approve');

  async function save(submit: boolean) {
    if (!valid) return setShowErrors(true);
    setBusy(true);
    try {
      const tr = await tripsApi.create({ employeeId, departmentId, destinationId, startDate, endDate, purpose: purpose.trim(), transport, transportClass, transportCost, hotelNightly, travelDays: Number(travelDays) || 0, planLines: plan.map((l) => ({ ...l, description: l.description.trim() })), submit }, user);
      for (const f of files) await filesApi.upload({ entity: 'business_trip', entityId: tr.id, name: f.name, mime: f.type, data: await readFileBytes(f), category: 'invitation' }, user);
      toast(`${tr.number}: ${t(submit ? 'trips_status_pending' : 'trips_status_draft')}`);
      navigate(`/trips/${tr.id}`);
    } catch (e) {
      toast(e instanceof Error && e.message === 'trips_err_budget_blocked' ? t('trips_err_budget_blocked') : t('trips_actionError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader crumbs={[{ label: t('trips_title'), to: '/trips' }, { label: t('trips_new') }]} title={t('trips_new')} />
      <div className="grid grid-main">
        <div className="p2-stack">
          <Card title={t('details')}>
            <div className="form-grid">
              <Field label={t('trips_employee')} required>
                <Select value={employeeId} onChange={setEmployeeId} disabled={lockEmployee} options={lk.users.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: u.fullName }))} ariaLabel={t('trips_employee')} />
              </Field>
              <Field label={t('department')} hint={`${pick(lang, 'Грейд', 'Grade', 'Grade')}: ${t(tk('trips_grade_', grade))}`}>
                <Input disabled value={employee && lk.department(employee.departmentId) ? loc(lk.department(employee.departmentId)!.name) : ''} ariaLabel={t('department')} />
              </Field>
              <Field label={t('trips_destination')} required error={err(destinationId)}>
                <Select
                  value={destinationId}
                  placeholder="—"
                  ariaLabel={t('trips_destination')}
                  onChange={(v) => {
                    setDestinationId(v);
                    const d = tripDestination(v);
                    if (d && !hotelNightly) setHotelNightly(tripCalc({ destinationId: v, startDate: today(), endDate: today(), transportCost: 0, hotelNightly: 0, employeeId }).hotelLimit);
                    if (d?.type === 'abroad') { setTransport('air'); setTransportClass('economy'); }
                  }}
                  options={(dests.data ?? []).map((d) => ({ value: d.id, label: d.type === 'domestic' ? tripPlace(d, lang).city : `${tripPlace(d, lang).city}, ${tripPlace(d, lang).country}` }))}
                />
              </Field>
              <Field label={t('trips_transport')} required>
                <Select<TripTransport> value={transport} onChange={(v) => { setTransport(v); setTransportClass(CLASSES[v][0]!); }} options={TRANSPORTS.map((x) => ({ value: x, label: t(tk('trips_tr_', x)) }))} ariaLabel={t('trips_transport')} />
              </Field>
              <Field label={t('trips_start')} required error={err(startDate)} hint={pastStart ? pick(lang, 'Дата в прошлом — оформление задним числом', 'O‘tgan sana — orqaga sana bilan', 'Past date — retroactive') : undefined}>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} ariaLabel={t('trips_start')} />
              </Field>
              <Field label={t('trips_end')} required error={datesInvalid ? t('trips_invalidDates') : err(endDate)}>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} ariaLabel={t('trips_end')} />
              </Field>
              <Field label={pick(lang, 'Класс проезда', 'Yo‘l klassi', 'Travel class')} error={!calc.classAllowed ? pick(lang, `Класс не разрешён для грейда «${t(tk('trips_grade_', grade))}»`, `«${t(tk('trips_grade_', grade))}» grade uchun ruxsat etilmagan`, `Not allowed for grade "${t(tk('trips_grade_', grade))}"`) : undefined}>
                <Select<TripTransportClass> value={transportClass} onChange={setTransportClass} options={CLASSES[transport].map((c) => ({ value: c, label: `${t(tk('trips_class_', c))}${gradeNorm.allowedClasses.includes(c) ? '' : ' ⚠'}` }))} ariaLabel={pick(lang, 'Класс проезда', 'Yo‘l klassi', 'Travel class')} />
              </Field>
              <Field label={pick(lang, 'Дополнительные дни в пути', 'Qo‘shimcha yo‘l kunlari', 'Extra travel days')} hint={pick(lang, 'Время в пути сверх дат командировки (суточные начисляются)', 'Safar sanalaridan tashqari yo‘l vaqti (kundalik hisoblanadi)', 'Travel time beyond the trip dates (per diem accrues)')}>
                <Input type="number" value={travelDays} onChange={(e) => setTravelDays(String(Math.max(0, Math.min(5, Number(e.target.value) || 0))))} ariaLabel="travelDays" />
              </Field>
              <Field label={t('trips_purpose')} required error={err(purpose.trim())} className="span-2">
                <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} ariaLabel={t('trips_purpose')} />
              </Field>
              <Field label={t('trips_transportCost')}>
                <Input type="number" value={transportCost || ''} onChange={(e) => setTransportCost(Math.max(0, Number(e.target.value) || 0))} ariaLabel={t('trips_transportCost')} />
              </Field>
              <Field label={t('trips_hotelNightly')} hint={dest ? `${t('trips_hotelLimit')}: ${formatMoney(calc.hotelLimit)}` : undefined} error={calc.hotelOverLimit ? t('trips_hotelOverLimit') : undefined}>
                <Input type="number" value={hotelNightly || ''} onChange={(e) => setHotelNightly(Math.max(0, Number(e.target.value) || 0))} ariaLabel={t('trips_hotelNightly')} />
              </Field>
            </div>
          </Card>
          <Card title={pick(lang, 'Прочие расходы (виза, страховка, представительские)', 'Boshqa xarajatlar (viza, sug‘urta, vakillik)', 'Other expenses (visa, insurance, hospitality)')} actions={<Button size="small" icon="plus" onClick={() => setPlan((p) => [...p, { category: 'visa', description: '', amount: 0 }])}>{t('trips_addLine')}</Button>} flush>
            {plan.length ? (
              <div className="table-wrap">
                <table className="table items-table p2-table-inputs">
                  <thead>
                    <tr><th>{t('trips_expenseCategory')}</th><th>{pick(lang, 'Описание', 'Tavsif', 'Description')}</th><th className="right">{pick(lang, 'Сумма', 'Summa', 'Amount')}</th><th /></tr>
                  </thead>
                  <tbody>
                    {plan.map((l, i) => (
                      <tr key={i}>
                        <td><Select<TripPlanLine['category']> value={l.category} onChange={(v) => setPlan((p) => p.map((x, j) => (j === i ? { ...x, category: v } : x)))} options={PLAN_CATS.map((c) => ({ value: c, label: t(tk('trips_cat_', c)) }))} ariaLabel={t('trips_expenseCategory')} /></td>
                        <td><Input value={l.description} onChange={(e) => setPlan((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} ariaLabel="description" /></td>
                        <td><Input type="number" value={l.amount || ''} onChange={(e) => setPlan((p) => p.map((x, j) => (j === i ? { ...x, amount: Math.max(0, Number(e.target.value) || 0) } : x)))} ariaLabel="amount" /></td>
                        <td><Button type="text" size="small" icon="trash" title="Remove" onClick={() => setPlan((p) => p.filter((_, j) => j !== i))} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small" style={{ padding: 14, margin: 0 }}>{pick(lang, 'Нет дополнительных расходов', 'Qo‘shimcha xarajatlar yo‘q', 'No additional expenses')}</p>
            )}
            {showErrors && !planValid && <p className="error-text" style={{ padding: '0 14px 14px', margin: 0 }}>{t('formRequired')}</p>}
            {calc.hospitalityOver && <div style={{ padding: '0 14px 14px' }}><Note tone="warn">{pick(lang, `Представительские превышают лимит грейда (${formatMoney(gradeNorm.hospitalityLimit)})`, `Vakillik xarajatlari grade limitidan oshdi (${formatMoney(gradeNorm.hospitalityLimit)})`, `Hospitality exceeds grade limit (${formatMoney(gradeNorm.hospitalityLimit)})`)}</Note></div>}
          </Card>
          <Card title={pick(lang, 'Подтверждающие документы (приглашение и т. п.)', 'Tasdiqlovchi hujjatlar (taklifnoma va h.k.)', 'Supporting documents (invitation etc.)')}>
            <Upload dragger multiple onFiles={(fs) => setFiles((x) => [...x, ...fs])} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" ariaLabel="invitation">
              {files.length ? files.map((f) => f.name).join(', ') : pick(lang, 'Перетащите файлы или нажмите для выбора', 'Fayllarni torting yoki tanlash uchun bosing', 'Drop files or click to choose')}
            </Upload>
          </Card>
        </div>

        <div className="p2-stack">
          <Card title={t('trips_calc')} flush>
            <CalcTable calc={calc} dest={dest} />
            {dest && (
              <p className="muted small" style={{ padding: '0 14px', margin: '10px 0 14px' }}>
                {t('trips_perDiem')}: {dest.currency === 'USD' ? `${dest.perDiem} USD` : formatMoney(dest.perDiem)} {t('trips_perDay')}. {pick(lang, 'Нормы — из справочника «Нормы и лимиты»', 'Me’yorlar — «Me’yorlar va limitlar» ma’lumotnomasidan', 'Norms from the "Norms and limits" reference')}.
              </p>
            )}
          </Card>
          <Card title={pick(lang, 'Бюджетный лимит (статья «Командировочные расходы»)', 'Byudjet limiti («Xizmat safari xarajatlari»)', 'Budget limit (business travel)')}>
            {budget.data ? (
              <Note tone={budget.data.status === 'ok' ? 'ok' : budget.data.status === 'warning' || budget.data.status === 'no_line' ? 'warn' : 'danger'} icon="wallet">
                {t(tk('trips_budget_', budget.data.status))}
                {budget.data.limit ? ` · ${pick(lang, 'доступно', 'mavjud', 'available')} ${formatMoney(budget.data.available)} / ${formatMoney(budget.data.limit)}` : ''}
              </Note>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>{pick(lang, 'Будет проверен при расчёте аванса', 'Avans hisoblanganda tekshiriladi', 'Checked once the advance is calculated')}</p>
            )}
          </Card>
          <Card title={t('route')}>
            <RouteSteps preview={{ entity: 'business_trip', context: { subtype: 'application', departmentId, amount: calc.total, requesterId: employeeId } }} />
          </Card>
        </div>
      </div>
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate('/trips')}>{t('cancel')}</Button>
        <Button disabled={busy} onClick={() => save(false)}>{t('saveDraft')}</Button>
        <Button type="primary" disabled={busy || !!budget.data?.blocked} title={budget.data?.blocked ? t('trips_err_budget_blocked') : undefined} onClick={() => save(true)}>{t('trips_submitNow')}</Button>
      </div>
    </>
  );
}
