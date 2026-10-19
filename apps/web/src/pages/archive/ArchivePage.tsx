// Архив (ARXIV 360, ТЗ 4.2.10): фонд дел, формирование и сдача дел, приём документов (вручную, скан, из систем
// Банка), поиск, выдача и копии, акты уничтожения / передачи в госархив, номенклатура, отчёты.
import { useEffect, useState } from 'react';
import {
  archiveApi, archiveRequestOverdue, canManageArchive, canSubmitArchive, filesApi, formatDate, formatDateTime, formatNumber, pick, tk, today,
  type ArchiveCase, type ArchiveCaseStatus, type ArchiveDestructionAct, type ArchiveDocument, type ArchiveIntakeError, type ArchiveNomenclatureItem, type ArchiveRequest, type ArchiveSearchFilter, type ArchiveSource, ArchiveIntakeRejected,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Empty, Field, Input, Modal, PageHeader, Select, Stat, StatusBadge, Tabs, Textarea, Upload, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { readFileBytes } from '../../components/download';
import { navigate, useQuery } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Note, useAction } from '../documents/p2docs';
import { Location, locText } from './shared';

type Tab = 'cases' | 'forming' | 'intake' | 'search' | 'requests' | 'destruction' | 'nomenclature' | 'reports';
export const CASE_TONE: Record<ArchiveCaseStatus, Tone> = { forming: 'info', submitted: 'warn', stored: 'ok', issued: 'info', expired: 'warn', destroyed: 'muted', transferred: 'muted' };
const CASE_STATUSES: ArchiveCaseStatus[] = ['stored', 'issued', 'expired', 'destroyed', 'transferred'];
const TABS: Tab[] = ['cases', 'forming', 'intake', 'search', 'requests', 'destruction', 'nomenclature', 'reports'];

export function ArchivePage() {
  const { t, lang } = useSession();
  const user = useUser();
  const q = useQuery();
  const qTab = q.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(qTab && TABS.includes(qTab) ? qTab : 'cases');
  useEffect(() => {
    if (qTab && TABS.includes(qTab)) setTab(qTab);
  }, [qTab]);
  const stats = useApi(() => archiveApi.stats());
  const requests = useApi(() => archiveApi.listRequests());
  const s = stats.data;
  const newRequests = requests.data?.filter((r) => r.status === 'new').length ?? 0;
  const manager = canManageArchive(user);

  return (
    <>
      <PageHeader title={t('archive_title')} subtitle={pick(lang, 'ТЗ 4.2.10 · ARXIV 360: приём, дела по номенклатуре, хранение, выдача, сроки хранения, уничтожение', 'TT 4.2.10 · ARXIV 360: qabul, nomenklatura bo‘yicha ishlar, saqlash, berish, muddatlar, yo‘q qilish', 'ToR 4.2.10 · ARXIV 360: intake, cases by nomenclature, storage, loans, retention, destruction')} />
      <div className="grid grid-4">
        <Stat label={t('archive_statCases')} value={s?.cases ?? '—'} icon="archive" foot={s ? `${t('archive_statDocs')}: ${formatNumber(s.documents)}` : undefined} />
        <Stat label={t('archive_statIssued')} value={s?.issued ?? '—'} icon="inbox" foot={s ? `${t('archive_statOverdue')}: ${s.overdueReturns}` : undefined} />
        <Stat label={t('archive_statOverdue')} value={s?.overdueReturns ?? '—'} tone={s?.overdueReturns ? 'alert' : undefined} icon="clock" />
        <Stat label={t('archive_statExpired')} value={s?.expired ?? '—'} icon="alert" foot={s?.expired ? <a href="#/archive" onClick={(e) => { e.preventDefault(); setTab('destruction'); }}>{t('archive_tabDestruction')} →</a> : undefined} />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'cases', label: t('archive_tabCases') },
            { value: 'forming', label: pick(lang, 'Формирование и сдача', 'Shakllantirish va topshirish', 'Forming & hand-over'), ...(s ? { count: s.submitted + s.openTasks } : {}) },
            { value: 'intake', label: pick(lang, 'Приём документов', 'Hujjatlarni qabul qilish', 'Intake'), ...(s?.errors ? { count: s.errors } : {}) },
            { value: 'search', label: t('archive_tabSearch') },
            { value: 'requests', label: t('archive_tabRequests'), ...(newRequests ? { count: newRequests } : {}) },
            { value: 'destruction', label: pick(lang, 'Акты (уничтожение, госархив)', 'Dalolatnomalar (yo‘q qilish, davlat arxivi)', 'Acts (destruction, state archive)') },
            { value: 'nomenclature', label: t('archive_tabNomenclature') },
            { value: 'reports', label: pick(lang, 'Отчёты', 'Hisobotlar', 'Reports') },
          ]}
        />
        {tab === 'cases' && <CasesTab />}
        {tab === 'forming' && <FormingTab />}
        {tab === 'intake' && <IntakeTab manager={manager} />}
        {tab === 'search' && <SearchTab />}
        {tab === 'requests' && <RequestsTab />}
        {tab === 'destruction' && <ActsTab />}
        {tab === 'nomenclature' && <NomenclatureTab />}
        {tab === 'reports' && <ReportsTab />}
      </Card>
    </>
  );
}

// ---------- Фонд дел ----------

function CasesTab() {
  const { t, loc, lang } = useSession();
  const user = useUser();
  const lk = useLookups();
  const [search, setSearch] = useState('');
  const [dep, setDep] = useState('');
  const [status, setStatus] = useState<ArchiveCaseStatus | ''>('');
  const [year, setYear] = useState(0);
  const [request, setRequest] = useState<ArchiveCase | null>(null);
  const cases = useApi(() => archiveApi.listCases({ search, ...(dep ? { departmentId: dep } : {}), ...(status ? { status } : {}), ...(year ? { year } : {}) }, user), [search, dep, status, year, user.id]);
  const inActs = useApi(() => archiveApi.casesInDraftActs());
  const nom = useApi(() => archiveApi.listNomenclature());
  const years = [...new Set((cases.data ?? []).map((c) => c.year))].sort((a, b) => b - a);
  const columns: Column<ArchiveCase>[] = [
    { header: t('archive_caseNumber'), render: (c) => <><div className="doc-num">{c.number}</div><div className="sub">{c.electronic ? pick(lang, 'Электронное дело', 'Elektron ish', 'Electronic case') : nom.data?.find((n) => n.id === c.nomenclatureId)?.article}</div></> },
    { header: t('archive_caseTitle'), render: (c) => <><div style={{ fontWeight: 500 }}>{c.title}{c.restricted && <> <Badge tone="warn">{pick(lang, 'ДСП', 'XFU', 'Restricted')}</Badge></>}</div><div className="sub">{lk.department(c.departmentId) ? loc(lk.department(c.departmentId)!.name) : ''}</div></> },
    { header: t('archive_docs'), align: 'right', render: (c) => `${formatNumber(c.documents)} / ${formatNumber(c.pages)}` },
    { header: t('archive_location'), render: (c) => <Location loc={c.location} /> },
    { header: t('archive_retentionUntil'), render: (c) => (c.retentionUntil ? formatDate(c.retentionUntil) : <span className="muted">{t('archive_permanent')}</span>) },
    {
      header: t('status'),
      render: (c) => (
        <div className="p2-row" onClick={(e) => e.stopPropagation()}>
          <StatusBadge prefix="archive_status_" status={c.status} tone={CASE_TONE[c.status]} />
          {inActs.data?.includes(c.id) ? <Badge tone="warn">{t('archive_inAct')}</Badge> : ['stored', 'expired'].includes(c.status) && <Button size="small" onClick={() => setRequest(c)}>{t('archive_requestCase')}</Button>}
        </div>
      ),
    },
  ];
  return (
    <>
      <div className="p2-filter-wide">
        <Select value={dep} onChange={setDep} placeholder={`${t('department')}: ${t('all')}`} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} />
        <Select<ArchiveCaseStatus> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={CASE_STATUSES.map((x) => ({ value: x, label: t(tk('archive_status_', x)) }))} />
        <Select<number> value={year} onChange={(v) => setYear(Number(v))} options={[{ value: 0, label: t('archive_yearAll') }, ...years.map((y) => ({ value: y, label: String(y) }))]} />
        <Input placeholder={`${t('search')}: ${t('archive_caseNumber').toLowerCase()}, ${t('archive_caseTitle').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="toolbar" style={{ padding: '10px 14px', justifyContent: 'flex-end' }}>
        <ExportButton
          filename={pick(lang, 'Реестр дел архива', 'Arxiv ishlari reestri', 'Archive cases register')}
          title={t('archive_title')}
          columns={[
            { header: t('archive_caseNumber'), value: (c: ArchiveCase) => c.number },
            { header: t('archive_caseTitle'), value: (c: ArchiveCase) => c.title },
            { header: t('archive_year'), value: (c: ArchiveCase) => c.year, format: 'integer' },
            { header: t('department'), value: (c: ArchiveCase) => (lk.department(c.departmentId) ? loc(lk.department(c.departmentId)!.name) : c.departmentId) },
            { header: t('archive_docs'), value: (c: ArchiveCase) => c.documents, format: 'integer', total: true },
            { header: t('archive_pages'), value: (c: ArchiveCase) => c.pages, format: 'integer', total: true },
            { header: t('archive_location'), value: (c: ArchiveCase) => locText(c.location) },
            { header: t('archive_retentionUntil'), value: (c: ArchiveCase) => c.retentionUntil ?? t('archive_permanent') },
            { header: t('status'), value: (c: ArchiveCase) => t(tk('archive_status_', c.status)) },
          ]}
          rows={cases.data ?? []}
        />
      </div>
      <DataTable rows={cases.data} loading={cases.loading} columns={columns} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/archive/${c.id}`)} />
      {request && <RequestModal c={request} onClose={() => setRequest(null)} />}
    </>
  );
}

export function RequestModal({ c, onClose }: { c: ArchiveCase; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [purpose, setPurpose] = useState('');
  const [days, setDays] = useState('14');
  const [copy, setCopy] = useState(false);
  const [error, setError] = useState<{ purpose?: string; days?: string }>({});
  return (
    <Modal
      title={`${t('archive_requestCase')}: ${c.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={async () => {
              const n = Number(days);
              const e = { ...(!purpose.trim() ? { purpose: t('formRequired') } : {}), ...(!(n >= 1 && n <= 90) ? { days: t('archive_daysRange') } : {}) };
              setError(e);
              if (Object.keys(e).length) return;
              if (await run(() => archiveApi.createRequest({ caseId: c.id, purpose: purpose.trim(), days: n, copy }, user), `${c.number}: ${t('archive_req_new')}`)) onClose();
            }}
          >
            {t('create')}
          </Button>
        </>
      }
    >
      <Field label={t('archive_purpose')} required error={error.purpose}>
        <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} ariaLabel={t('archive_purpose')} />
      </Field>
      <Field label={t('archive_days')} required error={error.days}>
        <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} ariaLabel={t('archive_days')} />
      </Field>
      <Checkbox checked={copy} onChange={setCopy}>{pick(lang, 'Нужна заверенная копия (без выдачи подлинника)', 'Tasdiqlangan nusxa kerak (asl nusxasiz)', 'Certified copy (original stays in archive)')}</Checkbox>
    </Modal>
  );
}

// ---------- Формирование и сдача дел ----------

function FormingTab() {
  const { t, loc, lang } = useSession();
  const user = useUser();
  const lk = useLookups();
  const { busy, run } = useAction();
  const work = useApi(() => archiveApi.listWorkCases(user), [user.id]);
  const tasks = useApi(() => archiveApi.listTasks());
  const nom = useApi(() => archiveApi.listNomenclature());
  const [form, setForm] = useState(false);
  const [task, setTask] = useState(false);
  const manager = canManageArchive(user);
  const submitter = canSubmitArchive(user);
  const nomName = (id: string) => {
    const n = nom.data?.find((x) => x.id === id);
    return n ? `${n.index} · ${n.title}` : id;
  };
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="toolbar">
        {submitter && <Button type="primary" icon="plus" onClick={() => setForm(true)}>{pick(lang, 'Сформировать дело', 'Ish shakllantirish', 'Form a case')}</Button>}
        {manager && <Button icon="clock" onClick={() => setTask(true)}>{pick(lang, 'Поручить сдачу дела', 'Ishni topshirishni topshiriq qilish', 'Assign case hand-over')}</Button>}
      </div>
      <Card title={pick(lang, 'Дела в работе подразделений', 'Bo‘linmalardagi ishlar', 'Cases in progress')} flush>
        <DataTable
          rows={work.data}
          loading={work.loading}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/archive/${c.id}`)}
          emptyText={pick(lang, 'Нет формируемых дел', 'Shakllantirilayotgan ishlar yo‘q', 'No cases being formed')}
          columns={[
            { header: t('archive_caseNumber'), render: (c) => <span className="doc-num">{c.number}</span> },
            { header: t('archive_caseTitle'), render: (c) => <>{c.title}<div className="sub">{lk.department(c.departmentId) ? loc(lk.department(c.departmentId)!.name) : ''}</div></> },
            { header: t('archive_docs'), align: 'right', render: (c) => `${c.documents} / ${c.pages}` },
            { header: pick(lang, 'Полнота', 'To‘liqlik', 'Completeness'), render: (c) => { const bad = (c.completeness ?? []).filter((x) => !x.ok && !x.warn).length; const warn = (c.completeness ?? []).filter((x) => !x.ok && x.warn).length; return bad ? <Badge tone="danger">{pick(lang, `Ошибок: ${bad}`, `Xatolar: ${bad}`, `Errors: ${bad}`)}</Badge> : warn ? <Badge tone="warn">{pick(lang, `Замечаний: ${warn}`, `Izohlar: ${warn}`, `Warnings: ${warn}`)}</Badge> : <Badge tone="ok">OK</Badge>; } },
            { header: t('status'), render: (c) => <StatusBadge prefix="archive_status_" status={c.status} tone={CASE_TONE[c.status]} /> },
          ]}
        />
      </Card>
      <Card title={pick(lang, 'Поручения на сдачу дел (график)', 'Ishlarni topshirish topshiriqlari (jadval)', 'Hand-over assignments')} flush>
        <DataTable
          rows={tasks.data}
          loading={tasks.loading}
          rowKey={(x) => x.id}
          columns={[
            { header: t('number'), render: (x) => <span className="doc-num">{x.number}</span> },
            { header: pick(lang, 'Дело по номенклатуре', 'Nomenklatura bo‘yicha ish', 'Nomenclature case'), render: (x) => <>{nomName(x.nomenclatureId)} / {x.year}<div className="sub">{lk.department(x.departmentId) ? loc(lk.department(x.departmentId)!.name) : ''}</div></> },
            { header: pick(lang, 'Ответственный', 'Mas’ul', 'Responsible'), render: (x) => lk.user(x.responsibleId)?.fullName ?? x.responsibleId },
            { header: pick(lang, 'Срок', 'Muddat', 'Due'), render: (x) => <span style={x.status === 'open' && x.dueDate < today() ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{formatDate(x.dueDate)}</span> },
            { header: t('status'), render: (x) => (x.status === 'done' ? <Badge tone="ok">{pick(lang, 'Сдано', 'Topshirildi', 'Done')}</Badge> : x.dueDate < today() ? <Badge tone="danger">{pick(lang, 'Просрочено', 'Kechikkan', 'Overdue')}</Badge> : <Badge tone="info">{pick(lang, 'В работе', 'Ishda', 'Open')}</Badge>) },
          ]}
        />
      </Card>
      {form && <FormCaseModal nom={nom.data ?? []} onClose={() => setForm(false)} />}
      {task && <TaskModal nom={nom.data ?? []} onClose={() => setTask(false)} busy={busy} run={run} />}
    </div>
  );
}

function FormCaseModal({ nom, onClose }: { nom: ArchiveNomenclatureItem[]; onClose: () => void }) {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const { busy, run } = useAction();
  const [nomenclatureId, setNomId] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [departmentId, setDep] = useState(user.departmentId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <Modal
      title={pick(lang, 'Сформировать дело (сводную папку)', 'Ish (yig‘ma papka) shakllantirish', 'Form a case (summary folder)')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={async () => {
              if (!nomenclatureId || !departmentId || !(Number(year) >= 2000)) return setErr(true);
              let id = '';
              const ok = await run(async () => { id = (await archiveApi.formCase({ nomenclatureId, year: Number(year), departmentId, ...(from ? { periodFrom: from } : {}), ...(to ? { periodTo: to } : {}), restricted }, user)).id; }, pick(lang, 'Дело сформировано', 'Ish shakllantirildi', 'Case formed'));
              if (ok) {
                onClose();
                navigate(`/archive/${id}`);
              }
            }}
          >
            {pick(lang, 'Сформировать', 'Shakllantirish', 'Form')}
          </Button>
        </>
      }
    >
      <Field label={t('archive_tabNomenclature')} required error={err && !nomenclatureId ? t('formRequired') : undefined}>
        <Select value={nomenclatureId} onChange={setNomId} placeholder="—" options={nom.map((n) => ({ value: n.id, label: `${n.index} · ${n.title}` }))} ariaLabel="nomenclature" />
      </Field>
      <div className="form-grid">
        <Field label={t('archive_year')} required>
          <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} ariaLabel={t('archive_year')} />
        </Field>
        <Field label={t('department')} required>
          <Select value={departmentId} onChange={setDep} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} ariaLabel={t('department')} />
        </Field>
        <Field label={pick(lang, 'Период с', 'Davr boshi', 'Period from')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={pick(lang, 'Период по', 'Davr oxiri', 'Period to')}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Checkbox checked={restricted} onChange={setRestricted}>{pick(lang, 'Ограниченный доступ (ДСП)', 'Cheklangan kirish (XFU)', 'Restricted access')}</Checkbox>
      <p className="muted small">{pick(lang, 'В дело автоматически сводятся принятые документы подразделения из реестра, подходящие по виду (номенклатуре) и периоду; затем выполняется проверка полноты.', 'Ishga reestrdagi bo‘linmaning turi (nomenklatura) va davri mos hujjatlari avtomatik yig‘iladi; so‘ng to‘liqlik tekshiriladi.', 'Registered documents of the unit matching the nomenclature and period are collected automatically; then completeness is checked.')}</p>
    </Modal>
  );
}

function TaskModal({ nom, onClose, busy, run }: { nom: ArchiveNomenclatureItem[]; onClose: () => void; busy: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean> }) {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const [departmentId, setDep] = useState('');
  const [nomenclatureId, setNomId] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [responsibleId, setResp] = useState('');
  const [dueDate, setDue] = useState('');
  const [err, setErr] = useState(false);
  const valid = departmentId && nomenclatureId && responsibleId && dueDate && dueDate >= today();
  return (
    <Modal
      title={pick(lang, 'Поручение на сдачу дела в архив', 'Ishni arxivga topshirish topshirig‘i', 'Hand-over assignment')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={async () => { if (!valid) return setErr(true); if (await run(() => archiveApi.createTask({ departmentId, nomenclatureId, year: Number(year), responsibleId, dueDate }, user), pick(lang, 'Поручение направлено', 'Topshiriq yuborildi', 'Assignment sent'))) onClose(); }}>{pick(lang, 'Направить', 'Yuborish', 'Send')}</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('department')} required error={err && !departmentId ? t('formRequired') : undefined}>
          <Select value={departmentId} onChange={(v) => { setDep(v); setResp(lk.departments.find((d) => d.id === v)?.headId ?? ''); }} placeholder="—" options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} />
        </Field>
        <Field label={t('archive_tabNomenclature')} required error={err && !nomenclatureId ? t('formRequired') : undefined}>
          <Select value={nomenclatureId} onChange={setNomId} placeholder="—" options={nom.map((n) => ({ value: n.id, label: `${n.index} · ${n.title}` }))} />
        </Field>
        <Field label={t('archive_year')} required>
          <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        </Field>
        <Field label={pick(lang, 'Ответственный', 'Mas’ul', 'Responsible')} required error={err && !responsibleId ? t('formRequired') : undefined}>
          <Select value={responsibleId} onChange={setResp} placeholder="—" options={lk.users.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: u.fullName }))} />
        </Field>
        <Field label={pick(lang, 'Срок сдачи', 'Topshirish muddati', 'Due date')} required error={err && !(dueDate && dueDate >= today()) ? t('formRequired') : undefined}>
          <Input type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------- Приём документов ----------

function IntakeTab({ manager }: { manager: boolean }) {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const { busy, run } = useAction();
  const sources = useApi(() => archiveApi.listSources());
  const registry = useApi(() => archiveApi.listRegistry(user), [user.id]);
  const errors = useApi(() => archiveApi.listErrors());
  const [entry, setEntry] = useState(false);
  const [msg, setMsg] = useState('');
  const openErrors = (errors.data ?? []).filter((e) => e.status === 'open');
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {msg && <Note tone="ok" icon="check">{msg}</Note>}
      <Card
        title={pick(lang, 'Источники: системы Банка и модули ERP', 'Manbalar: Bank tizimlari va ERP modullari', 'Sources: bank systems and ERP modules')}
        actions={canSubmitArchive(user) ? <Button size="small" icon="plus" onClick={() => setEntry(true)}>{pick(lang, 'Ввести документ / скан', 'Hujjat / skan kiritish', 'Enter document / scan')}</Button> : undefined}
        flush
      >
        <DataTable
          rows={sources.data}
          loading={sources.loading}
          rowKey={(s) => s.id}
          columns={[
            { header: pick(lang, 'Источник', 'Manba', 'Source'), render: (s) => <><b>{loc(s.name)}</b><div className="sub">{s.kind === 'module' ? pick(lang, 'Модуль ERP', 'ERP moduli', 'ERP module') : pick(lang, 'Интеграционная шина', 'Integratsiya shinasi', 'Integration bus')}</div></> },
            { header: pick(lang, 'Ожидают приёма', 'Qabulni kutmoqda', 'Pending'), align: 'right', render: (s) => s.pending },
            {
              header: '',
              render: (s) =>
                manager ? (
                  <Button size="small" disabled={busy || !s.pending} onClick={() => run(async () => { const r = await archiveApi.pullSource(s.id, user); setMsg(`${loc(s.name)}: ${pick(lang, 'принято', 'qabul qilindi', 'received')} ${r.received}${r.status !== 'success' ? ` (${r.status})` : ''}`); })}>
                    {pick(lang, 'Принять', 'Qabul qilish', 'Receive')}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
      {openErrors.length > 0 && (
        <Card title={pick(lang, 'Ошибки приёма и интеграции', 'Qabul va integratsiya xatolari', 'Intake and integration errors')} flush>
          <DataTable
            rows={openErrors}
            rowKey={(e) => e.id}
            columns={[
              { header: pick(lang, 'Время', 'Vaqt', 'Time'), render: (e: ArchiveIntakeError) => formatDateTime(e.at) },
              { header: pick(lang, 'Источник', 'Manba', 'Source'), render: (e) => t(tk('archive_source_', e.source)) },
              { header: pick(lang, 'Документ', 'Hujjat', 'Document'), render: (e) => e.docNumber ?? '—' },
              { header: pick(lang, 'Ошибка', 'Xato', 'Error'), render: (e) => <><Badge tone="danger">{t(tk('archive_err_', e.reason))}</Badge><div className="sub">{e.details}</div></> },
              { header: '', render: (e) => (manager ? <div className="p2-row">{e.reason === 'integration' && <Button size="small" disabled={busy} onClick={() => run(() => archiveApi.resolveError(e.id, user, 'retry'), pick(lang, 'Повтор выполнен', 'Qayta urinish bajarildi', 'Retried'))}>{pick(lang, 'Повторить', 'Qayta', 'Retry')}</Button>}<Button size="small" disabled={busy} onClick={() => run(() => archiveApi.resolveError(e.id, user, 'discard'))}>{pick(lang, 'Закрыть', 'Yopish', 'Dismiss')}</Button></div> : null) },
            ]}
          />
        </Card>
      )}
      <Card title={pick(lang, 'Реестр принятых документов (не сведены в дела)', 'Qabul qilingan hujjatlar reestri (ishlarga yig‘ilmagan)', 'Register of received documents (not yet in cases)')} flush>
        <DataTable
          rows={registry.data}
          loading={registry.loading}
          rowKey={(d) => d.id}
          onRowClick={(d) => navigate(`/archive/docs/${d.id}`)}
          columns={[
            { header: 'ID', render: (d: ArchiveDocument) => <span className="doc-num">{d.uid}</span> },
            { header: pick(lang, 'Документ', 'Hujjat', 'Document'), render: (d) => <>{d.kind} {d.docNumber} · {formatDate(d.docDate)}<div className="sub">{d.title}</div></> },
            { header: t('department'), render: (d) => (lk.department(d.departmentId) ? loc(lk.department(d.departmentId)!.name) : d.departmentId) },
            { header: pick(lang, 'Источник / создан', 'Manba / yaratilgan', 'Source / created'), render: (d) => <>{t(tk('archive_source_', d.source))}<div className="sub">{formatDateTime(d.createdAt)}</div></> },
            { header: pick(lang, 'Номенклатура', 'Nomenklatura', 'Nomenclature'), render: (d) => d.nomenclatureIndex ?? '—' },
          ]}
        />
      </Card>
      {entry && <EntryModal onClose={() => setEntry(false)} />}
    </div>
  );
}

function EntryModal({ onClose }: { onClose: () => void }) {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const kinds = useApi(() => archiveApi.listKinds());
  const { busy, run } = useAction();
  const [f, setF] = useState({ docNumber: '', docDate: today(), title: '', kind: '', departmentId: user.departmentId, responsibleId: user.id, pages: '1', text: '', restricted: false });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dup, setDup] = useState('');
  const req = (k: string) => (errors.includes(k) ? t('formRequired') : undefined);
  return (
    <Modal
      title={pick(lang, 'Ввод документа в архив', 'Hujjatni arxivga kiritish', 'Enter a document')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={async () => {
              setDup('');
              const miss = (['docNumber', 'docDate', 'title', 'kind', 'departmentId'] as const).filter((k) => !String(f[k]).trim());
              if (!(Number(f.pages) > 0)) miss.push('pages' as never);
              setErrors(miss);
              if (miss.length) return;
              try {
                const doc = await archiveApi.registerDocument({ source: file ? 'scan' : 'manual', docNumber: f.docNumber, docDate: f.docDate, title: f.title, kind: f.kind, departmentId: f.departmentId, responsibleId: f.responsibleId, pages: Number(f.pages), ...(f.text ? { text: f.text } : {}), restricted: f.restricted }, user);
                if (file) await filesApi.upload({ entity: 'archive_document', entityId: doc.id, name: file.name, mime: file.type, data: await readFileBytes(file), category: 'scan' }, user);
                await run(async () => undefined, `${doc.uid}: ${pick(lang, 'документ принят', 'hujjat qabul qilindi', 'document registered')}`);
                onClose();
              } catch (e) {
                if (e instanceof ArchiveIntakeRejected && e.reason === 'duplicate') setDup(pick(lang, `Дубль: документ уже принят (${e.duplicateOf})`, `Takror: hujjat allaqachon qabul qilingan (${e.duplicateOf})`, `Duplicate: already registered (${e.duplicateOf})`));
                else if (e instanceof ArchiveIntakeRejected) setErrors(e.missing);
                else setDup(t('actionFailed'));
              }
            }}
          >
            {pick(lang, 'Принять', 'Qabul qilish', 'Register')}
          </Button>
        </>
      }
    >
      {dup && <Note tone="danger">{dup}</Note>}
      <div className="form-grid">
        <Field label={pick(lang, 'Номер документа', 'Hujjat raqami', 'Document number')} required error={req('docNumber')}>
          <Input value={f.docNumber} onChange={(e) => setF({ ...f, docNumber: e.target.value })} ariaLabel="docNumber" />
        </Field>
        <Field label={pick(lang, 'Дата документа', 'Hujjat sanasi', 'Document date')} required error={req('docDate')}>
          <Input type="date" value={f.docDate} onChange={(e) => setF({ ...f, docDate: e.target.value })} ariaLabel="docDate" />
        </Field>
        <Field label={pick(lang, 'Заголовок', 'Sarlavha', 'Title')} required error={req('title')} className="span-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} ariaLabel="title" />
        </Field>
        <Field label={pick(lang, 'Вид документа', 'Hujjat turi', 'Document kind')} required error={req('kind')}>
          <Select value={f.kind} onChange={(v) => setF({ ...f, kind: v })} placeholder="—" options={(kinds.data ?? []).map((k) => ({ value: k, label: k }))} ariaLabel="kind" />
        </Field>
        <Field label={t('department')} required error={req('departmentId')}>
          <Select value={f.departmentId} onChange={(v) => setF({ ...f, departmentId: v })} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} ariaLabel={t('department')} />
        </Field>
        <Field label={pick(lang, 'Ответственный', 'Mas’ul', 'Responsible')}>
          <Select value={f.responsibleId} onChange={(v) => setF({ ...f, responsibleId: v })} options={lk.users.map((u) => ({ value: u.id, label: u.fullName }))} ariaLabel="responsible" />
        </Field>
        <Field label={t('archive_pages')} required error={req('pages')}>
          <Input type="number" value={f.pages} onChange={(e) => setF({ ...f, pages: e.target.value })} ariaLabel={t('archive_pages')} />
        </Field>
        <Field label={pick(lang, 'Текст / аннотация (для поиска)', 'Matn / annotatsiya (qidiruv uchun)', 'Text / abstract (searchable)')} className="span-2">
          <Textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} rows={3} ariaLabel="text" />
        </Field>
      </div>
      <Field label={pick(lang, 'Скан-образ (оцифровка)', 'Skan-nusxa (raqamlashtirish)', 'Scan (digitisation)')}>
        <Upload dragger onFiles={(fs) => setFile(fs[0] ?? null)} accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" ariaLabel="scan">{file ? file.name : pick(lang, 'Перетащите файл или нажмите для выбора', 'Faylni torting yoki tanlash uchun bosing', 'Drop a file or click')}</Upload>
      </Field>
      <Checkbox checked={f.restricted} onChange={(v) => setF({ ...f, restricted: v })}>{pick(lang, 'Ограниченный доступ (ДСП)', 'Cheklangan kirish (XFU)', 'Restricted access')}</Checkbox>
    </Modal>
  );
}

// ---------- Поиск ----------

function SearchTab() {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const kinds = useApi(() => archiveApi.listKinds());
  const [f, setF] = useState<ArchiveSearchFilter>({ query: '' });
  const hits = useApi(() => archiveApi.searchDocuments(f, user), [JSON.stringify(f), user.id]);
  const set = (p: Partial<ArchiveSearchFilter>) => setF((x) => ({ ...x, ...p }));
  const any = !!(f.query?.trim() || f.from || f.to || f.departmentId || f.kind || f.responsibleId || f.source);
  return (
    <>
      <div className="p2-filter-wide">
        <Input placeholder={pick(lang, 'Реквизиты или текст документа', 'Rekvizitlar yoki hujjat matni', 'Attributes or full text')} value={f.query ?? ''} onChange={(e) => set({ query: e.target.value })} />
        <Select value={f.kind ?? ''} onChange={(v) => set({ kind: v || undefined })} placeholder={`${pick(lang, 'Вид', 'Turi', 'Kind')}: ${t('all')}`} options={(kinds.data ?? []).map((k) => ({ value: k, label: k }))} />
        <Select value={f.departmentId ?? ''} onChange={(v) => set({ departmentId: v || undefined })} placeholder={`${t('department')}: ${t('all')}`} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} />
        <Select value={f.responsibleId ?? ''} onChange={(v) => set({ responsibleId: v || undefined })} placeholder={`${pick(lang, 'Исполнитель', 'Ijrochi', 'Executor')}: ${t('all')}`} options={lk.users.map((u) => ({ value: u.id, label: u.fullName }))} />
        <Input type="date" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} ariaLabel={pick(lang, 'Дата с', 'Sana boshi', 'From')} />
        <Input type="date" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} ariaLabel={pick(lang, 'Дата по', 'Sana oxiri', 'To')} />
        <Select<ArchiveSource> value={f.source ?? ''} onChange={(v) => set({ source: v || undefined })} placeholder={`${pick(lang, 'Источник', 'Manba', 'Source')}: ${t('all')}`} options={(['manual', 'scan', 'migration', 'sed', 'einvoices', 'trips', 'abs', 'dwh', 'integration', 'audit'] as ArchiveSource[]).map((s) => ({ value: s, label: t(tk('archive_source_', s)) }))} />
        <Select value={f.status ?? ''} onChange={(v) => set({ status: (v || undefined) as ArchiveSearchFilter['status'] })} placeholder={`${t('status')}: ${t('all')}`} options={[{ value: 'in_case', label: pick(lang, 'В деле', 'Ishda', 'In a case') }, { value: 'registry', label: pick(lang, 'В реестре', 'Reestrda', 'In register') }]} />
      </div>
      {!any ? (
        <Empty text={t('archive_searchHint')} icon="search" />
      ) : (
        <DataTable
          rows={hits.data}
          loading={hits.loading}
          rowKey={(h) => h.doc.id}
          onRowClick={(h) => navigate(`/archive/docs/${h.doc.id}`)}
          columns={[
            { header: pick(lang, 'Документ', 'Hujjat', 'Document'), render: (h) => <><div style={{ fontWeight: 500 }}>{h.doc.title}</div><div className="sub">{h.doc.kind} · {h.doc.docNumber} · {formatDate(h.doc.docDate)} · {h.doc.uid}</div>{h.snippet && <div className="p2-snippet">{h.snippet}</div>}</> },
            { header: t('archive_inCase'), render: (h) => (h.caseNumber ? <><div className="doc-num">{h.caseNumber}</div><div className="sub">{h.caseTitle}</div></> : <span className="muted">{pick(lang, 'Реестр', 'Reestr', 'Register')}</span>) },
            { header: t('archive_location'), render: (h) => (h.location ? <Location loc={h.location} /> : <span className="muted">—</span>) },
          ]}
        />
      )}
    </>
  );
}

// ---------- Выдача ----------

function RequestsTab() {
  const { t, lang } = useSession();
  const user = useUser();
  const lk = useLookups();
  const { busy, run } = useAction();
  const reqs = useApi(() => archiveApi.listRequests());
  const cases = useApi(() => archiveApi.listCases({}, user), [user.id]);
  const [reject, setReject] = useState<ArchiveRequest | null>(null);
  const manager = canManageArchive(user);
  const caseOf = (id: string) => cases.data?.find((c) => c.id === id);
  const columns: Column<ArchiveRequest>[] = [
    { header: t('archive_requestNumber'), render: (r) => <><div className="doc-num">{r.number}</div><div className="sub">{formatDate(r.requestedAt)}{r.copy ? ` · ${pick(lang, 'копия', 'nusxa', 'copy')}` : ''}</div></> },
    { header: t('archive_caseNumber'), render: (r) => <><div>{caseOf(r.caseId)?.number ?? r.caseId}</div><div className="sub">{caseOf(r.caseId)?.title}</div></> },
    { header: t('archive_requester'), render: (r) => <><div>{lk.user(r.requesterId)?.fullName}</div><div className="sub">{r.purpose}</div></> },
    { header: t('archive_dueBack'), render: (r) => <span style={archiveRequestOverdue(r) ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{formatDate(r.dueBack)}</span> },
    {
      header: t('status'),
      render: (r) => (
        <div className="p2-row">
          <StatusBadge prefix="archive_req_" status={r.status} tone={r.status === 'issued' ? (archiveRequestOverdue(r) ? 'danger' : 'info') : r.status === 'new' ? 'warn' : r.status === 'rejected' ? 'danger' : 'muted'} />
          {archiveRequestOverdue(r) && <Badge tone="danger">{t('archive_overdueReturn')}</Badge>}
          {r.comment && <span className="muted small">{t('archive_rejectComment')}: {r.comment}</span>}
          {manager && r.status === 'new' && (
            <>
              <Button size="small" type="primary" disabled={busy} onClick={() => run(() => archiveApi.issue(r.id, user), `${r.number}: ${t('archive_req_issued')}`)}>{t('archive_issue')}</Button>
              <Button size="small" disabled={busy} onClick={() => setReject(r)}>{t('reject')}</Button>
            </>
          )}
          {manager && r.status === 'issued' && <Button size="small" disabled={busy} onClick={() => run(() => archiveApi.returnCase(r.id, user), `${r.number}: ${t('archive_req_returned')}`)}>{t('archive_return')}</Button>}
        </div>
      ),
    },
  ];
  return (
    <>
      <div className="toolbar" style={{ padding: '10px 14px', justifyContent: 'flex-end' }}>
        <ExportButton
          filename={pick(lang, 'Выдача дел', 'Ishlarni berish', 'Case loans')}
          columns={[
            { header: t('archive_requestNumber'), value: (r: ArchiveRequest) => r.number },
            { header: t('archive_caseNumber'), value: (r: ArchiveRequest) => caseOf(r.caseId)?.number ?? r.caseId },
            { header: t('archive_requester'), value: (r: ArchiveRequest) => lk.user(r.requesterId)?.fullName ?? '' },
            { header: t('archive_purpose'), value: (r: ArchiveRequest) => r.purpose },
            { header: t('archive_dueBack'), value: (r: ArchiveRequest) => r.dueBack },
            { header: t('status'), value: (r: ArchiveRequest) => t(tk('archive_req_', r.status)) },
          ]}
          rows={reqs.data ?? []}
        />
      </div>
      <DataTable rows={reqs.data} loading={reqs.loading} columns={columns} rowKey={(r) => r.id} />
      {reject && (
        <RejectRequest r={reject} onClose={() => setReject(null)} />
      )}
    </>
  );
}

function RejectRequest({ r, onClose }: { r: ArchiveRequest; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title={`${t('reject')}: ${r.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button danger loading={busy} onClick={async () => { if (!comment.trim()) return setError(t('formRequired')); if (await run(() => archiveApi.rejectRequest(r.id, comment.trim(), user), `${r.number}: ${t('archive_req_rejected')}`)) onClose(); }}>{t('reject')}</Button>
        </>
      }
    >
      <Field label={t('archive_rejectComment')} required error={error}>
        <Textarea value={comment} onChange={(e) => { setComment(e.target.value); setError(''); }} rows={3} ariaLabel={t('archive_rejectComment')} />
      </Field>
    </Modal>
  );
}

// ---------- Акты ----------

function ActsTab() {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const acts = useApi(() => archiveApi.listActs());
  const cand = useApi(() => archiveApi.listDestructionCandidates());
  const state = useApi(() => archiveApi.listStateCandidates());
  const [sel, setSel] = useState<string[]>([]);
  const [selState, setSelState] = useState<string[]>([]);
  const manager = canManageArchive(user);
  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {manager && (
        <div className="grid grid-2">
          <Card title={t('archive_candidates')} actions={<Button size="small" type="primary" disabled={busy || !sel.length} onClick={() => run(async () => { await archiveApi.createAct(sel, user, 'destruction'); setSel([]); }, `${t('archive_act_draft')}: ${t('archive_createAct')}`)}>{t('archive_createAct')}</Button>}>
            {cand.data && !cand.data.length ? <Empty text={t('archive_noCandidates')} /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="muted small">{t('archive_selectCases')}</span>
                {(cand.data ?? []).map((c) => (
                  <label key={c.id} className="task" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                    <Checkbox checked={sel.includes(c.id)} onChange={() => toggle(sel, setSel, c.id)} />
                    <span><b className="doc-num">{c.number}</b> · {c.title} <span className="muted small">({c.retentionUntil ? formatDate(c.retentionUntil) : ''})</span></span>
                  </label>
                ))}
              </div>
            )}
          </Card>
          <Card title={pick(lang, 'Дела постоянного хранения для передачи в госархив (10+ лет)', 'Davlat arxiviga topshirish uchun doimiy saqlanadigan ishlar (10+ yil)', 'Permanent cases for the state archive (10+ years)')} actions={<Button size="small" disabled={busy || !selState.length} onClick={() => run(async () => { await archiveApi.createAct(selState, user, 'state_transfer'); setSelState([]); }, pick(lang, 'Акт передачи сформирован', 'Topshirish dalolatnomasi shakllantirildi', 'Transfer act created'))}>{pick(lang, 'Акт передачи', 'Topshirish dalolatnomasi', 'Transfer act')}</Button>}>
            {state.data && !state.data.length ? <Empty text={pick(lang, 'Нет дел для передачи', 'Topshirish uchun ishlar yo‘q', 'No cases to transfer')} /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(state.data ?? []).map((c) => (
                  <label key={c.id} className="task" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                    <Checkbox checked={selState.includes(c.id)} onChange={() => toggle(selState, setSelState, c.id)} />
                    <span><b className="doc-num">{c.number}</b> · {c.title}</span>
                  </label>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
      <Note>{pick(lang, 'Акт согласует экспертно-проверочная комиссия (юрист и главная бухгалтерия), утверждает руководитель АХД; после этого архивариус подписывает акт ЭЦП и дела помечаются уничтоженными / переданными.', 'Dalolatnomani ekspert-tekshiruv komissiyasi (yurist va bosh buxgalteriya) kelishadi, MXD rahbari tasdiqlaydi; so‘ng arxivchi ERI bilan imzolaydi.', 'The expert commission (legal and accounting) reviews the act, the head of administration approves it; then the archivist signs it and cases are marked destroyed / transferred.')}</Note>
      <Card title={t('archive_actNumber')} flush>
        <DataTable
          rows={acts.data}
          loading={acts.loading}
          rowKey={(a) => a.id}
          onRowClick={(a) => navigate(`/archive/acts/${a.id}`)}
          columns={[
            { header: t('archive_actNumber'), render: (a: ArchiveDestructionAct) => <><div className="doc-num">{a.number}</div><div className="sub">{formatDate(a.createdAt)}</div></> },
            { header: pick(lang, 'Вид', 'Turi', 'Kind'), render: (a) => (a.kind === 'destruction' ? pick(lang, 'Уничтожение', 'Yo‘q qilish', 'Destruction') : pick(lang, 'Передача в госархив', 'Davlat arxiviga', 'State archive')) },
            { header: t('archive_actCases'), align: 'right', render: (a) => a.caseIds.length },
            { header: t('status'), render: (a) => <StatusBadge prefix="archive_actstatus_" status={a.status} tone={a.status === 'signed' ? 'ok' : a.status === 'approved' ? 'info' : a.status === 'rejected' ? 'danger' : a.status === 'pending' ? 'warn' : 'muted'} /> },
            {
              header: '',
              render: (a) =>
                manager && ['draft', 'rejected'].includes(a.status) ? (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Button size="small" disabled={busy} onClick={() => run(() => archiveApi.submitAct(a.id, user), `${a.number}: ${t('archive_actstatus_pending')}`)}>{pick(lang, 'На согласование ЭПК', 'EPK kelishuviga', 'Submit to commission')}</Button>
                  </span>
                ) : null,
            },
          ]}
        />
      </Card>
    </div>
  );
}

// ---------- Номенклатура ----------

function NomenclatureTab() {
  const { t, loc, lang } = useSession();
  const lk = useLookups();
  const nom = useApi(() => archiveApi.listNomenclature());
  const cols: Column<ArchiveNomenclatureItem>[] = [
    { header: t('archive_index'), render: (n) => <span className="doc-num">{n.index}</span> },
    { header: t('archive_caseTitle'), render: (n) => <>{n.title}<div className="sub">{(n.kinds ?? []).join(', ')}</div></> },
    { header: t('department'), render: (n) => (lk.department(n.departmentId) ? loc(lk.department(n.departmentId)!.name) : n.departmentId) },
    { header: t('archive_retention'), render: (n) => (n.retentionYears ? `${n.retentionYears} ${t('archive_years')}` : t('archive_permanent')) },
    { header: t('archive_article'), render: (n) => n.article },
  ];
  return (
    <>
      <div className="toolbar" style={{ padding: '10px 14px', justifyContent: 'flex-end' }}>
        <ExportButton filename={pick(lang, 'Номенклатура дел', 'Ishlar nomenklaturasi', 'Nomenclature')} columns={[{ header: t('archive_index'), value: (n: ArchiveNomenclatureItem) => n.index }, { header: t('archive_caseTitle'), value: (n: ArchiveNomenclatureItem) => n.title }, { header: t('archive_retention'), value: (n: ArchiveNomenclatureItem) => n.retentionYears || t('archive_permanent') }, { header: t('archive_article'), value: (n: ArchiveNomenclatureItem) => n.article }]} rows={nom.data ?? []} />
      </div>
      <DataTable rows={nom.data} loading={nom.loading} columns={cols} rowKey={(n) => n.id} />
    </>
  );
}

// ---------- Отчёты ----------

function ReportsTab() {
  const { t, lang, loc } = useSession();
  const lk = useLookups();
  const [from, setFrom] = useState(`${new Date().getFullYear() - 1}-01-01`);
  const [to, setTo] = useState(today());
  const mv = useApi(() => archiveApi.movementReport({ from, to }), [from, to]);
  const disc = useApi(() => archiveApi.disciplineReport());
  const fund = useApi(() => archiveApi.fundReport());
  const dep = (id: string) => (lk.department(id) ? loc(lk.department(id)!.name) : id);
  const sheets = () => [
    { name: pick(lang, 'Движение', 'Harakat', 'Movement'), columns: [{ header: pick(lang, 'Месяц', 'Oy', 'Month') }, { header: pick(lang, 'Принято док.', 'Qabul', 'Received'), format: 'integer' as const, total: true }, { header: pick(lang, 'Принято дел', 'Ishlar qabul', 'Cases accepted'), format: 'integer' as const, total: true }, { header: pick(lang, 'Выдано', 'Berildi', 'Issued'), format: 'integer' as const, total: true }, { header: pick(lang, 'Возвращено', 'Qaytarildi', 'Returned'), format: 'integer' as const, total: true }, { header: pick(lang, 'Копии', 'Nusxalar', 'Copies'), format: 'integer' as const, total: true }, { header: pick(lang, 'Уничтожено / передано', 'Yo‘q qilindi / topshirildi', 'Destroyed / transferred'), format: 'integer' as const, total: true }], rows: (mv.data ?? []).map((r) => [r.month, r.received, r.accepted, r.issued, r.returned, r.copies, r.destroyed]), totalLabel: t('total') },
    { name: pick(lang, 'Дисциплина', 'Intizom', 'Discipline'), columns: [{ header: pick(lang, 'Сотрудник', 'Xodim', 'Employee') }, { header: t('department') }, { header: pick(lang, 'Выдано', 'Berildi', 'Issued'), format: 'integer' as const }, { header: pick(lang, 'Просрочек', 'Kechikishlar', 'Overdue'), format: 'integer' as const }, { header: pick(lang, 'Дней просрочки', 'Kechikish kunlari', 'Days late'), format: 'integer' as const }, { header: pick(lang, 'Поручений просрочено', 'Kechikkan topshiriqlar', 'Overdue assignments'), format: 'integer' as const }], rows: (disc.data ?? []).map((r) => [lk.user(r.userId)?.fullName ?? r.userId, dep(r.departmentId), r.issued, r.overdue, r.overdueDays, r.tasksOverdue]) },
    { name: pick(lang, 'Фонд', 'Fond', 'Fund'), columns: [{ header: t('department') }, { header: pick(lang, 'Дел', 'Ishlar', 'Cases'), format: 'integer' as const, total: true }, { header: pick(lang, 'Электронных', 'Elektron', 'Electronic'), format: 'integer' as const, total: true }, { header: pick(lang, 'Документов', 'Hujjatlar', 'Documents'), format: 'integer' as const, total: true }, { header: pick(lang, 'Листов', 'Varaqlar', 'Pages'), format: 'integer' as const, total: true }, { header: pick(lang, 'Постоянного хранения', 'Doimiy saqlash', 'Permanent'), format: 'integer' as const, total: true }], rows: (fund.data ?? []).map((r) => [dep(r.departmentId), r.cases, r.electronic, r.documents, r.pages, r.permanent]), totalLabel: t('total') },
  ];
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="toolbar">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={pick(lang, 'Период с', 'Davr boshi', 'From')} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={pick(lang, 'Период по', 'Davr oxiri', 'To')} />
        <ExportButton filename={pick(lang, 'Отчёты архива', 'Arxiv hisobotlari', 'Archive reports')} sheets={sheets} />
      </div>
      <Card title={pick(lang, 'Движение архива по месяцам', 'Arxiv harakati oylar bo‘yicha', 'Archive movement by month')} flush>
        <DataTable rows={mv.data} loading={mv.loading} rowKey={(r) => r.month} columns={[
          { header: pick(lang, 'Месяц', 'Oy', 'Month'), render: (r) => r.month },
          { header: pick(lang, 'Принято док.', 'Qabul', 'Received'), align: 'right', render: (r) => r.received },
          { header: pick(lang, 'Принято дел', 'Ishlar qabul', 'Cases accepted'), align: 'right', render: (r) => r.accepted },
          { header: pick(lang, 'Выдано', 'Berildi', 'Issued'), align: 'right', render: (r) => r.issued },
          { header: pick(lang, 'Возвращено', 'Qaytarildi', 'Returned'), align: 'right', render: (r) => r.returned },
          { header: pick(lang, 'Копии', 'Nusxalar', 'Copies'), align: 'right', render: (r) => r.copies },
          { header: pick(lang, 'Уничтожено / передано', 'Yo‘q qilindi / topshirildi', 'Destroyed / transferred'), align: 'right', render: (r) => r.destroyed },
        ]} />
      </Card>
      <div className="grid grid-2">
        <Card title={pick(lang, 'Исполнительская дисциплина (возврат дел, сдача в архив)', 'Ijro intizomi (ishlarni qaytarish, arxivga topshirish)', 'Discipline (returns, hand-overs)')} flush>
          <DataTable rows={disc.data} loading={disc.loading} rowKey={(r) => r.userId} columns={[
            { header: pick(lang, 'Сотрудник', 'Xodim', 'Employee'), render: (r) => <>{lk.user(r.userId)?.fullName ?? r.userId}<div className="sub">{dep(r.departmentId)}</div></> },
            { header: pick(lang, 'Выдано', 'Berildi', 'Issued'), align: 'right', render: (r) => r.issued },
            { header: pick(lang, 'Просрочки', 'Kechikishlar', 'Overdue'), align: 'right', render: (r) => <span style={r.overdue ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.overdue} ({r.overdueDays} {pick(lang, 'дн.', 'kun', 'd')})</span> },
            { header: pick(lang, 'Поручения', 'Topshiriqlar', 'Assignments'), align: 'right', render: (r) => `${r.tasksOpen} / ${r.tasksOverdue}` },
          ]} />
        </Card>
        <Card title={pick(lang, 'Состав архивного фонда', 'Arxiv fondi tarkibi', 'Archive fund')} flush>
          <DataTable rows={fund.data} loading={fund.loading} rowKey={(r) => r.departmentId} columns={[
            { header: t('department'), render: (r) => dep(r.departmentId) },
            { header: pick(lang, 'Дел', 'Ishlar', 'Cases'), align: 'right', render: (r) => `${r.cases} (${r.electronic} ${pick(lang, 'эл.', 'el.', 'e-')})` },
            { header: pick(lang, 'Документов / листов', 'Hujjat / varaq', 'Docs / pages'), align: 'right', render: (r) => `${formatNumber(r.documents)} / ${formatNumber(r.pages)}` },
            { header: pick(lang, 'Пост. / истекают', 'Doimiy / tugaydi', 'Perm. / expiring'), align: 'right', render: (r) => `${r.permanent} / ${r.expiring}` },
          ]} />
        </Card>
      </div>
    </div>
  );
}
