// Отчётность и аналитика (ТЗ 4.2.8): каталог регламентированных, управленческих и пользовательских отчётов,
// конструктор (без программирования, PR-GEN-025) с сохранением в каталог, рассылки по расписанию и журнал доставки.
import { useState } from 'react';
import {
  formatDate,
  formatDateTime,
  reportingApi,
  reportingCanManage,
  tk,
  type TKey,
  type ReportBuilderQuery,
  type ReportDataset,
  type ReportDefinition,
  type ReportDelivery,
  type ReportFormat,
  type ReportMeasure,
  type ReportResult,
  type ReportSubscription, userMessage } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Empty, Field, Input, Loading, Modal, PageHeader, Select, Stat, Tabs, Textarea, useToast } from '../../components/ui';
import { Segmented } from '../../components/flow';
import { Icon } from '../../components/icons';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useP, useUrlTab } from '../taxes/common';
import { ReportExports } from './ReportPage';
import { downloadCsv, ReportView } from './ReportView';

const TABS = ['catalog', 'builder', 'subscriptions', 'deliveries'] as const;
type Tab = (typeof TABS)[number];

/** Текст ошибки API: ключ словаря модуля или исходное сообщение. */
const errText = (e: unknown, t: (k: TKey) => string) => {
  const m = e instanceof Error ? e.message : String(e);
  return m.startsWith('reporting_') ? t(m as TKey) : userMessage(m);
};

export function ReportingPage() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const [tab, setTab] = useUrlTab<Tab>(TABS, 'catalog');
  const catalog = useApi(() => reportingApi.listCatalog(user), [user.id]);
  const subs = useApi(() => reportingApi.listSubscriptions());
  const deliveries = useApi(() => reportingApi.listDeliveries());

  return (
    <>
      <PageHeader
        title={t('reporting_title')}
        subtitle={t('reporting_subtitle')}
        actions={
          <Button type="primary" icon="chart" onClick={() => navigate('/reporting/dashboard')}>
            {p('KPI-дашборд', 'KPI dashbordi', 'KPI dashboard')}
          </Button>
        }
      />
      <div className="grid grid-4">
        <Stat label={t('reporting_kpi_reports')} value={catalog.data?.length ?? '—'} tone="accent" icon="chart" foot={catalog.data ? `${p('пользовательских', 'foydalanuvchi', 'custom')}: ${catalog.data.filter((r) => r.kind === 'custom').length}` : undefined} />
        <Stat label={t('reporting_kpi_builtin')} value={catalog.data?.filter((r) => r.builtin || r.custom).length ?? '—'} icon="file" />
        <Stat label={t('reporting_kpi_subscriptions')} value={subs.data?.length ?? '—'} icon="inbox" foot={subs.data ? `${p('на паузе', 'pauzada', 'paused')}: ${subs.data.filter((s) => s.active === false).length}` : undefined} />
        <Stat label={t('reporting_kpi_daily')} value={subs.data?.filter((s) => s.frequency === 'daily').length ?? '—'} icon="clock" />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'catalog', label: t('reporting_tab_catalog'), ...(catalog.data ? { count: catalog.data.length } : {}) },
            { value: 'builder', label: t('reporting_tab_builder') },
            { value: 'subscriptions', label: t('reporting_tab_subscriptions'), ...(subs.data ? { count: subs.data.length } : {}) },
            { value: 'deliveries', label: p('Журнал доставки', 'Yetkazish jurnali', 'Delivery log'), ...(deliveries.data ? { count: deliveries.data.length } : {}) },
          ]}
        />
        {tab === 'catalog' ? <Catalog rows={catalog.data} loading={catalog.loading} /> : tab === 'subscriptions' ? <Subscriptions catalog={catalog.data ?? []} /> : tab === 'deliveries' ? <Deliveries catalog={catalog.data ?? []} /> : null}
      </Card>
      {tab === 'builder' && <Builder />}
    </>
  );
}

function openReport(r: ReportDefinition) {
  if (r.builtin || r.custom) navigate(`/reporting/${r.id}`);
  else if (r.link) navigate(r.link);
}

type KindFilter = 'all' | 'regulated' | 'management' | 'custom';

function Catalog({ rows, loading }: { rows: ReportDefinition[] | undefined; loading: boolean }) {
  const { t, loc } = useSession();
  const p = useP();
  const lk = useLookups();
  const [kind, setKind] = useState<KindFilter>('all');
  const [q, setQ] = useState('');
  const kindOf = (r: ReportDefinition): KindFilter => r.kind ?? 'management';
  const list = rows?.filter((r) => (kind === 'all' || kindOf(r) === kind) && (!q.trim() || `${r.code} ${loc(r.name)}`.toLowerCase().includes(q.trim().toLowerCase())));
  const kindLabel = (k: KindFilter) => (k === 'regulated' ? p('Регламентированные', 'Reglamentlangan', 'Regulated') : k === 'management' ? p('Управленческие', 'Boshqaruv', 'Management') : k === 'custom' ? p('Пользовательские', 'Foydalanuvchi', 'Custom') : p('Все', 'Barchasi', 'All'));
  return (
    <>
      <div className="toolbar" style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
        <Segmented<KindFilter> value={kind} onChange={setKind} options={(['all', 'regulated', 'management', 'custom'] as const).map((k) => ({ value: k, label: kindLabel(k), count: rows?.filter((r) => k === 'all' || kindOf(r) === k).length ?? 0 }))} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={p('Поиск по коду или названию', 'Kod yoki nom bo‘yicha qidirish', 'Search by code or name')} style={{ maxWidth: 280 }} />
      </div>
      <DataTable
        rows={list}
        loading={loading}
        rowKey={(r) => r.id}
        onRowClick={openReport}
        columns={[
          { header: t('reporting_code'), render: (r) => <span className="doc-num">{r.code}</span> },
          {
            header: t('reporting_name'),
            render: (r) => (
              <>
                <div style={{ fontWeight: 600 }}>{loc(r.name)}</div>
                <div className="sub">{loc(r.description)}</div>
              </>
            ),
          },
          { header: t('reporting_area'), render: (r) => <Badge tone={r.kind === 'regulated' ? 'warn' : r.kind === 'custom' ? 'muted' : 'info'}>{t(tk('reporting_area_', r.area))}</Badge> },
          { header: t('reporting_owner'), render: (r) => lk.user(r.ownerId)?.fullName },
          { header: t('reporting_schedule'), render: (r) => t(tk('reporting_schedule_', r.schedule)) },
          {
            header: '',
            render: (r) => (
              <button
                className="btn btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openReport(r);
                }}
              >
                {r.builtin || r.custom ? t('reporting_open') : `${t('reporting_in_module')} →`}
              </button>
            ),
          },
        ]}
      />
    </>
  );
}

const PERIODS: ReportBuilderQuery['periodDays'][] = [0, 30, 90, 365];
const ALL_MEASURES: ReportMeasure[] = ['count', 'amount', 'paid', 'planned', 'spent', 'nbv', 'outstanding', 'balance'];

function Builder() {
  const { t, lang } = useSession();
  const p = useP();
  const toast = useToast();
  const [dataset, setDataset] = useState<ReportDataset>('procurement');
  const info = reportingApi.datasets.find((d) => d.dataset === dataset)!;
  const [groupBy, setGroupBy] = useState(info.groupBy[0]!);
  const [measure, setMeasure] = useState<ReportMeasure>(info.measures[0]!);
  const [periodDays, setPeriodDays] = useState<ReportBuilderQuery['periodDays']>(0);
  const [groupBy2, setGroupBy2] = useState('none');
  const [measures2, setMeasures2] = useState<ReportMeasure[]>([]);
  const [filterField, setFilterField] = useState(info.groupBy[0]!);
  const [filterValue, setFilterValue] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => setResult(null);
  const changeDataset = (d: ReportDataset) => {
    const next = reportingApi.datasets.find((x) => x.dataset === d)!;
    setDataset(d);
    setGroupBy(next.groupBy[0]!);
    setMeasure(next.measures[0]!);
    setGroupBy2('none');
    setMeasures2([]);
    setFilterField(next.groupBy[0]!);
    setFilterValue('');
    reset();
  };
  const query = (): ReportBuilderQuery => ({
    dataset, groupBy, measure, periodDays,
    ...(groupBy2 !== 'none' ? { groupBy2 } : {}),
    ...(measures2.length ? { measures2 } : {}),
    ...(filterValue.trim() ? { filter: { field: filterField, value: filterValue.trim() } } : {}),
  });

  async function run() {
    setBusy(true);
    try {
      setResult(await reportingApi.runBuilder(query(), lang));
    } finally {
      setBusy(false);
    }
  }

  const groupLabel = (g: string) => t(tk('reporting_group_', g));
  return (
    <>
      <Card title={t('reporting_tab_builder')} actions={<span className="muted small">{p('Шаги: набор данных → группировка → показатель → период → построить', "Qadamlar: ma'lumotlar to‘plami → guruhlash → ko‘rsatkich → davr → tuzish", 'Steps: dataset → grouping → measure → period → build')}</span>}>
        <div className="grid grid-4" style={{ alignItems: 'end' }}>
          <Field label={t('reporting_dataset')}>
            <Select<ReportDataset> value={dataset} onChange={changeDataset} options={reportingApi.datasets.map((d) => ({ value: d.dataset, label: t(tk('reporting_dataset_', d.dataset)) }))} />
          </Field>
          <Field label={t('reporting_group_by')}>
            <Select<string> value={groupBy} onChange={(v) => { setGroupBy(v); reset(); }} options={info.groupBy.map((g) => ({ value: g, label: groupLabel(g) }))} />
          </Field>
          <Field label={t('reporting_measure')}>
            <Select<ReportMeasure> value={measure} onChange={(v) => { setMeasure(v); setMeasures2((m) => m.filter((x) => x !== v)); reset(); }} options={info.measures.map((m) => ({ value: m, label: t(tk('reporting_measure_', m)) }))} />
          </Field>
          <Field label={t('reporting_period')}>
            <Select<string> value={String(periodDays)} disabled={dataset === 'budget' || dataset === 'cash'} onChange={(v) => { setPeriodDays(Number(v) as ReportBuilderQuery['periodDays']); reset(); }} options={PERIODS.map((x) => ({ value: String(x), label: t(tk('reporting_period_', String(x))) }))} />
          </Field>
        </div>
        <div className="grid grid-4" style={{ alignItems: 'end', marginTop: 12 }}>
          <Field label={p('Второе измерение (сводная)', 'Ikkinchi o‘lchov (svodka)', 'Second dimension (pivot)')}>
            <Select<string> value={groupBy2} onChange={(v) => { setGroupBy2(v); reset(); }} options={[{ value: 'none', label: groupLabel('none') }, ...info.groupBy.filter((g) => g !== groupBy).map((g) => ({ value: g, label: groupLabel(g) }))]} />
          </Field>
          <Field label={p('Фильтр: поле', 'Filtr: maydon', 'Filter: field')}>
            <Select<string> value={filterField} onChange={(v) => { setFilterField(v); reset(); }} options={info.groupBy.map((g) => ({ value: g, label: groupLabel(g) }))} />
          </Field>
          <Field label={p('Фильтр: значение содержит', 'Filtr: qiymat o‘z ichiga oladi', 'Filter: value contains')}>
            <Input value={filterValue} onChange={(e) => { setFilterValue(e.target.value); reset(); }} placeholder={p('например, Казначейство', 'masalan, G‘aznachilik', 'e.g. Treasury')} />
          </Field>
          <Field label={p('Дополнительные показатели', 'Qo‘shimcha ko‘rsatkichlar', 'Extra measures')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, minHeight: 36, alignItems: 'center' }}>
              {info.measures.filter((m) => m !== measure).length === 0 && <span className="muted small">—</span>}
              {ALL_MEASURES.filter((m) => info.measures.includes(m) && m !== measure).map((m) => (
                <Checkbox
                  key={m}
                  checked={measures2.includes(m)}
                  disabled={groupBy2 !== 'none'}
                  onChange={(c) => { setMeasures2((x) => (c ? [...x, m] : x.filter((y) => y !== m))); reset(); }}
                >
                  {t(tk('reporting_measure_', m))}
                </Checkbox>
              ))}
            </div>
          </Field>
        </div>
        <div className="toolbar" style={{ marginTop: 16, justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
          {result && (
            <>
              <button
                className="btn"
                onClick={() => {
                  downloadCsv(result, lang, `xb-erp-${dataset}-${groupBy}-${measure}`);
                  toast(t('reporting_exported'));
                }}
              >
                <Icon name="file" size={15} /> {t('reporting_export_csv')}
              </button>
              <ReportExports id={`builder-${dataset}`} code={`XB-${dataset.toUpperCase()}`} result={result} filename={`xb-erp-${dataset}-${groupBy}-${measure}`} />
              <Button icon="plus" onClick={() => setSaving(true)}>
                {p('Сохранить в каталог', 'Katalogga saqlash', 'Save to catalog')}
              </Button>
            </>
          )}
          <button className="btn btn-primary" disabled={busy} onClick={run}>
            <Icon name="chart" size={15} /> {t('reporting_run')}
          </button>
        </div>
      </Card>
      {busy && !result ? (
        <Card>
          <Loading />
        </Card>
      ) : result ? (
        result.rows.length ? (
          <ReportView result={result} />
        ) : (
          <Card>
            <Empty text={t('empty')} icon="chart" />
          </Card>
        )
      ) : (
        <Card>
          <Empty text={t('reporting_builder_hint')} icon="chart" />
        </Card>
      )}
      {saving && <SaveReportModal query={query()} onClose={() => setSaving(false)} />}
    </>
  );
}

function SaveReportModal({ query, onClose }: { query: ReportBuilderQuery; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const def = await reportingApi.saveCustomReport({ name, description, query, shared }, user);
      toast(p(`Отчёт ${def.code} сохранён в каталог`, `${def.code} hisoboti katalogga saqlandi`, `Report ${def.code} saved to the catalog`));
      onClose();
      navigate(`/reporting/${def.id}`);
    } catch (e) {
      setError(errText(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={p('Сохранить отчёт', 'Hisobotni saqlash', 'Save report')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{t('save')}</button>
        </>
      }
    >
      <Field label={t('reporting_name')} required error={error}>
        <Input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={120} autoFocus />
      </Field>
      <Field label={p('Описание', 'Tavsif', 'Description')}>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </Field>
      <Checkbox checked={shared} onChange={setShared}>
        {p('Доступен всем пользователям (общий отчёт)', 'Barcha foydalanuvchilarga ochiq (umumiy hisobot)', 'Available to all users (shared report)')}
      </Checkbox>
    </Modal>
  );
}

function Subscriptions({ catalog }: { catalog: ReportDefinition[] }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const subs = useApi(() => reportingApi.listSubscriptions());
  const [adding, setAdding] = useState(false);
  const reportName = (id: string) => {
    const r = catalog.find((x) => x.id === id);
    return r ? loc(r.name) : id;
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(errText(e, t));
    }
  };
  return (
    <>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> {t('reporting_new_subscription')}
        </button>
      </div>
      <DataTable<ReportSubscription>
        rows={subs.data}
        loading={subs.loading}
        rowKey={(s) => s.id}
        columns={[
          { header: t('reporting_name'), render: (s) => <b>{reportName(s.reportId)}</b> },
          {
            header: t('reporting_subscriber'),
            render: (s) => (
              <>
                {lk.user(s.userId)?.fullName}
                <div className="sub">{s.email}</div>
              </>
            ),
          },
          { header: t('reporting_frequency'), render: (s) => t(tk('reporting_schedule_', s.frequency)) },
          { header: t('reporting_format'), render: (s) => <Badge tone="muted">{s.format.toUpperCase()}</Badge> },
          {
            header: p('Следующая отправка', 'Keyingi yuborish', 'Next run'),
            render: (s) =>
              s.active === false ? <Badge tone="warn">{p('пауза', 'pauza', 'paused')}</Badge> : (
                <>
                  {s.nextRunAt ? formatDateTime(s.nextRunAt) : '—'}
                  {s.lastRunAt && <div className="sub">{p('последняя', 'oxirgi', 'last')}: {formatDateTime(s.lastRunAt)}</div>}
                </>
              ),
          },
          { header: t('reporting_created'), render: (s) => formatDate(s.createdAt) },
          {
            header: '',
            render: (s) =>
              reportingCanManage(user, s) ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm" onClick={() => act(() => reportingApi.sendNow(s.id, user), p('Отчёт отправлен', 'Hisobot yuborildi', 'Report sent'))}>
                    {p('Отправить сейчас', 'Hozir yuborish', 'Send now')}
                  </button>
                  <button className="btn btn-sm" onClick={() => act(() => reportingApi.toggleSubscription(s.id, user), s.active === false ? p('Рассылка возобновлена', 'Yuborish tiklandi', 'Subscription resumed') : p('Рассылка приостановлена', 'Yuborish to‘xtatildi', 'Subscription paused'))}>
                    {s.active === false ? p('Возобновить', 'Tiklash', 'Resume') : p('Пауза', 'Pauza', 'Pause')}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => act(() => reportingApi.removeSubscription(s.id, user), t('reporting_unsubscribed'))}>
                    {t('reporting_unsubscribe')}
                  </button>
                </div>
              ) : null,
          },
        ]}
      />
      {adding && <NewSubscriptionModal catalog={catalog} onClose={() => setAdding(false)} />}
    </>
  );
}

function Deliveries({ catalog }: { catalog: ReportDefinition[] }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const list = useApi(() => reportingApi.listDeliveries());
  const subs = useApi(() => reportingApi.listSubscriptions());
  const mine = (d: ReportDelivery) => user.role === 'admin' || subs.data?.some((s) => s.id === d.subscriptionId && s.userId === user.id);
  const rows = list.data?.filter(mine);
  const reportName = (id: string) => {
    const r = catalog.find((x) => x.id === id);
    return r ? `${r.code} · ${loc(r.name)}` : id;
  };
  return (
    <>
      <div className="toolbar" style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span className="muted small">{p('Планировщик проверяет сроки рассылок раз в минуту; письма с вложением фиксируются в журнале и в уведомлениях получателя.', 'Rejalashtiruvchi yuborish muddatlarini har daqiqada tekshiradi; ilovali xatlar jurnalda va qabul qiluvchi bildirishnomalarida qayd etiladi.', 'The scheduler checks due subscriptions every minute; e-mails with attachments are logged here and in the recipient notifications.')}</span>
        <Button
          size="small"
          icon="clock"
          onClick={async () => {
            const n = await reportingApi.runDue();
            toast(n ? p(`Отправлено по расписанию: ${n}`, `Jadval bo‘yicha yuborildi: ${n}`, `Sent on schedule: ${n}`) : p('Нет рассылок со сроком отправки', 'Yuborish muddati kelgan tarqatmalar yo‘q', 'No subscriptions are due'));
          }}
        >
          {p('Запустить планировщик', 'Rejalashtiruvchini ishga tushirish', 'Run scheduler')}
        </Button>
      </div>
      <DataTable<ReportDelivery>
        rows={rows}
        loading={list.loading}
        rowKey={(d) => d.id}
        emptyText={p('Отправок ещё не было', 'Hali yuborishlar bo‘lmagan', 'No deliveries yet')}
        columns={[
          { header: p('Время', 'Vaqt', 'Time'), render: (d) => formatDateTime(d.at) },
          { header: t('reporting_name'), render: (d) => <b>{reportName(d.reportId)}</b> },
          { header: t('reporting_email'), render: (d) => d.to },
          { header: p('Вложение', 'Ilova', 'Attachment'), render: (d) => <>{d.fileName}<div className="sub">{Math.max(1, Math.round(d.bytes / 1024))} KB · {d.rows} {p('строк', 'qator', 'rows')}</div></> },
          { header: p('Запуск', 'Ishga tushirish', 'Trigger'), render: (d) => (d.trigger === 'schedule' ? p('по расписанию', 'jadval bo‘yicha', 'scheduled') : p('вручную', 'qo‘lda', 'manual')) },
          { header: p('Результат', 'Natija', 'Result'), render: (d) => <Badge tone={d.status === 'sent' ? 'ok' : 'danger'}>{d.status === 'sent' ? p('доставлено', 'yetkazildi', 'delivered') : p('ошибка', 'xato', 'failed')}</Badge> },
        ]}
      />
    </>
  );
}

function NewSubscriptionModal({ catalog, onClose }: { catalog: ReportDefinition[]; onClose: () => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const [reportId, setReportId] = useState(catalog[0]?.id ?? '');
  const [frequency, setFrequency] = useState<ReportSubscription['frequency']>('weekly');
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const [email, setEmail] = useState(user.email);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError(t('reporting_email_invalid'));
      return;
    }
    setBusy(true);
    try {
      await reportingApi.addSubscription({ reportId, frequency, format, email }, user);
      toast(t('reporting_subscribed'));
      onClose();
    } catch (e) {
      setError(errText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('reporting_new_subscription')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {t('create')}
          </button>
        </>
      }
    >
      <Field label={t('reporting_name')} required>
        <Select<string> value={reportId} onChange={(v) => { setReportId(v); setError(''); }} options={catalog.map((r) => ({ value: r.id, label: `${r.code} · ${loc(r.name)}` }))} />
      </Field>
      <div className="form-grid">
        <Field label={t('reporting_frequency')} required>
          <Select<ReportSubscription['frequency']> value={frequency} onChange={(v) => { setFrequency(v); setError(''); }} options={(['daily', 'weekly', 'monthly'] as const).map((f) => ({ value: f, label: t(tk('reporting_schedule_', f)) }))} />
        </Field>
        <Field label={t('reporting_format')} required>
          <Select<ReportFormat> value={format} onChange={setFormat} options={(['pdf', 'xlsx', 'csv'] as const).map((f) => ({ value: f, label: f.toUpperCase() }))} />
        </Field>
      </div>
      <Field label={t('reporting_email')} required error={error}>
        <Input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError('');
          }}
        />
      </Field>
    </Modal>
  );
}
