import { useState } from 'react';
import {
  DOCUMENT_CATEGORIES, documentIsOverdue, documentLight, documentsApi, formatDate, pick, tk,
  type DocumentCategory, type DocumentKind, type DocumentLight, type DocumentRecord, type DocumentStatus,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Dropdown, Input, PageHeader, Select, Stat, StatusBadge, Tabs, type Column } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link, navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { DeadlineCell } from './shared';
import { LightBadge, Note, useAction } from './p2docs';

type KindTab = 'all' | DocumentKind | 'mine';
const STATUSES: DocumentStatus[] = ['registered', 'pending', 'assigned', 'in_progress', 'answered', 'payment', 'done', 'rejected'];
const LIGHTS: Exclude<DocumentLight, 'closed'>[] = ['green', 'yellow', 'red', 'black'];

export function DocumentsPage() {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const { busy, run } = useAction();
  const [kind, setKind] = useState<KindTab>('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DocumentStatus | ''>('');
  const [type, setType] = useState<DocumentCategory | ''>('');
  const [executor, setExecutor] = useState('');
  const [light, setLight] = useState<DocumentLight | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [intake, setIntake] = useState('');
  const stats = useApi(() => documentsApi.stats(user), [user.id]);
  const all = useApi(() => documentsApi.list());
  const list = useApi(
    () =>
      documentsApi.list({
        search,
        overdueOnly,
        ...(kind === 'mine' ? { executorId: user.id } : kind !== 'all' ? { kind } : {}),
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(executor && kind !== 'mine' ? { executorId: executor } : {}),
        ...(light ? { light } : {}),
      }),
    [kind, search, status, type, executor, overdueOnly, light, user.id],
  );
  const s = stats.data;
  const count = (k: DocumentKind) => all.data?.filter((d) => d.kind === k).length;

  async function load(sources?: ('soliq' | 'mib')[]) {
    await run(async () => {
      const r = await documentsApi.loadFromSources(user, sources);
      setIntake(
        r.created.length
          ? pick(lang, `Загружено: ${r.created.map((c) => c.number).join(', ')} — направлено исполнителям по содержанию, срок 10 дней`, `Yuklandi: ${r.created.map((c) => c.number).join(', ')} — mazmuniga ko‘ra ijrochilarga yuborildi, muddat 10 kun`, `Loaded: ${r.created.map((c) => c.number).join(', ')} — routed by content, 10-day deadline`)
          : r.status === 'success'
            ? pick(lang, 'Новых писем нет', 'Yangi xatlar yo‘q', 'No new letters')
            : pick(lang, `Источник недоступен (${r.status}) — запрос в очереди шины`, `Manba mavjud emas (${r.status}) — so‘rov navbatda`, `Source unavailable (${r.status}) — request queued`),
      );
    });
  }

  const columns: Column<DocumentRecord>[] = [
    {
      header: t('documents_regNumber'),
      render: (d) => (
        <>
          <div className="doc-num">{d.number}</div>
          <div className="sub">{formatDate(d.registeredAt)}</div>
        </>
      ),
    },
    {
      header: t('documents_subject'),
      render: (d) => (
        <>
          <div style={{ fontWeight: 500 }}>
            {d.priority === 'high' && <span style={{ color: 'var(--danger)', marginRight: 6 }} title={t('documents_priority_high')}>●</span>}
            {d.subject}
          </div>
          <div className="sub">
            {t(tk('documents_type_', d.type))} · {d.correspondent}{d.source !== 'manual' ? ` · ${t(tk('documents_source_', d.source))}` : ''}
          </div>
        </>
      ),
    },
    {
      header: t('documents_executor'),
      render: (d) => (
        <>
          {lk.user(d.executorId)?.fullName ?? '—'}
          <div className="sub">{lk.department(d.departmentId) ? loc(lk.department(d.departmentId)!.name) : ''}</div>
        </>
      ),
    },
    { header: t('documents_deadline'), render: (d) => <DeadlineCell doc={d} /> },
    {
      header: t('status'),
      render: (d) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge prefix="documents_status_" status={d.status} />
          {d.control && !['done', 'answered', 'rejected'].includes(d.status) && <Badge tone={documentIsOverdue(d) ? 'danger' : 'info'}>{t('documents_control')}</Badge>}
          {d.violation && <Badge tone="danger">{pick(lang, 'Акт ИД', 'ID dalolatnomasi', 'Breach act')}</Badge>}
        </div>
      ),
    },
  ];

  const exportCols = [
    { header: t('documents_regNumber'), value: (d: DocumentRecord) => d.number },
    { header: t('documents_regDate'), value: (d: DocumentRecord) => d.registeredAt.replace('T', ' ').slice(0, 19) },
    { header: t('documents_kindLabel'), value: (d: DocumentRecord) => t(tk('documents_kind_', d.kind)) },
    { header: t('documents_typeLabel'), value: (d: DocumentRecord) => t(tk('documents_type_', d.type)) },
    { header: t('documents_correspondent'), value: (d: DocumentRecord) => d.correspondent },
    { header: t('documents_subject'), value: (d: DocumentRecord) => d.subject },
    { header: t('documents_executor'), value: (d: DocumentRecord) => lk.user(d.executorId)?.fullName ?? '' },
    { header: t('documents_deadline'), value: (d: DocumentRecord) => d.deadline ?? '' },
    { header: pick(lang, 'Светофор', 'Svetofor', 'Light'), value: (d: DocumentRecord) => t(tk('documents_light_', documentLight(d))) },
    { header: t('status'), value: (d: DocumentRecord) => t(tk('documents_status_', d.status)) },
    { header: pick(lang, 'Сумма платежа', "To'lov summasi", 'Payment amount'), value: (d: DocumentRecord) => d.paymentDetails?.amount ?? '', format: 'money' as const },
  ];

  return (
    <>
      <PageHeader
        title={t('documents_title')}
        subtitle={t('documents_subtitle')}
        actions={
          <>
            <Link to="/documents/discipline" className="btn">{pick(lang, 'Исполнительская дисциплина', 'Ijro intizomi', 'Executive discipline')}</Link>
            <Link to="/documents/aur" className="btn">{pick(lang, 'Сводная папка АУР', 'MBX yig‘ma papkasi', 'Admin expense folder')}</Link>
            {can('documents', 'edit') && (
              <Dropdown
                menu={{
                  items: [
                    { key: 'all', label: pick(lang, 'my3.soliq.uz и МИБ', 'my3.soliq.uz va MIB', 'my3.soliq.uz and MIB'), icon: 'download', onClick: () => void load() },
                    { key: 'soliq', label: 'my3.soliq.uz', onClick: () => void load(['soliq']) },
                    { key: 'mib', label: pick(lang, 'Решения МИБ', 'MIB qarorlari', 'Enforcement decisions'), onClick: () => void load(['mib']) },
                  ],
                }}
              >
                <Button icon="refresh" loading={busy}>{pick(lang, 'Загрузить письма', 'Xatlarni yuklash', 'Load letters')}</Button>
              </Dropdown>
            )}
            {can('documents', 'edit') && (
              <Link to="/documents/new" className="btn btn-primary">{t('documents_register')}</Link>
            )}
          </>
        }
      />
      {intake && <Note tone="ok" icon="check">{intake}</Note>}
      <div className="grid grid-4">
        <Stat label={t('documents_statMonth')} value={s?.registeredMonth ?? '—'} icon="file" foot={s ? `${t('documents_statPending')}: ${s.pending}` : undefined} />
        <Stat label={t('documents_statControl')} value={s?.onControl ?? '—'} icon="clock" foot={s ? `${t('documents_statSoon')}: ${s.dueSoon}` : undefined} />
        <Stat
          label={t('documents_statOverdue')}
          value={s?.overdue ?? '—'}
          tone={s?.overdue ? 'alert' : undefined}
          icon="alert"
          foot={
            s?.overdue ? (
              <a href="#/documents" onClick={(e) => { e.preventDefault(); setOverdueOnly(true); }}>
                {t('documents_overdueOnly')} →
              </a>
            ) : undefined
          }
        />
        <Stat label={pick(lang, 'Ждут моего принятия (24 ч)', 'Mening qabulimni kutmoqda (24 s)', 'Awaiting my acceptance (24 h)')} value={s?.awaitingAccept ?? '—'} tone={s?.awaitingAccept ? 'accent' : undefined} icon="inbox" foot={s ? `${t('documents_status_payment')}: ${s.inPayment}` : undefined} />
      </div>
      <div className="p2-kpi-lights">
        {LIGHTS.map((l) => (
          <button key={l} className={light === l ? 'on' : ''} onClick={() => setLight(light === l ? '' : l)} data-testid={`doc-light-${l}`}>
            <LightBadge light={l} prefix="documents_light_" />
            <div className="n num">{s?.lights[l] ?? '—'}</div>
          </button>
        ))}
      </div>
      <Card flush>
        <Tabs<KindTab>
          value={kind}
          onChange={setKind}
          items={[
            { value: 'all', label: t('all'), count: all.data?.length },
            { value: 'incoming', label: t('documents_tab_incoming'), count: count('incoming') },
            { value: 'outgoing', label: t('documents_tab_outgoing'), count: count('outgoing') },
            { value: 'internal', label: t('documents_tab_internal'), count: count('internal') },
            { value: 'mine', label: pick(lang, 'Мои на исполнении', 'Mening ijroimdagi', 'Assigned to me'), count: all.data?.filter((d) => d.executorId === user.id && !['done', 'answered', 'rejected'].includes(d.status)).length },
          ]}
        />
        <div className="p2-filter-wide">
          <Input placeholder={`${t('search')}: ${t('number')}, ${t('documents_subject').toLowerCase()}, ${t('documents_correspondent').toLowerCase()}, ${pick(lang, 'текст', 'matn', 'text')}`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select<DocumentStatus> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={STATUSES.map((x) => ({ value: x, label: t(tk('documents_status_', x)) }))} />
          <Select value={executor} onChange={setExecutor} placeholder={`${t('documents_executor')}: ${t('all')}`} options={lk.users.map((u) => ({ value: u.id, label: u.fullName }))} />
          <Select<DocumentCategory> value={type} onChange={setType} placeholder={`${t('documents_typeLabel')}: ${t('all')}`} options={DOCUMENT_CATEGORIES.map((x) => ({ value: x, label: t(tk('documents_type_', x)) }))} />
        </div>
        <div className="toolbar" style={{ padding: '10px 14px', justifyContent: 'space-between' }}>
          <Checkbox checked={overdueOnly} onChange={setOverdueOnly}>{t('documents_overdueOnly')}</Checkbox>
          <ExportButton filename={pick(lang, 'Реестр документов', 'Hujjatlar reestri', 'Document register')} title={t('documents_title')} columns={exportCols} rows={list.data ?? []} />
        </div>
        <DataTable rows={list.data} loading={list.loading} columns={columns} rowKey={(d) => d.id} onRowClick={(d) => navigate(`/documents/${d.id}`)} />
      </Card>
    </>
  );
}
