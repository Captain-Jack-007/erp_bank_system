import { useState } from 'react';
import {
  api, currencyLabel, einvoiceDay, einvoiceLight, einvoicesApi, einvoiceTotals, EINVOICE_KINDS, formatDate, formatMoney, formatMoneyShort, pick, tk,
  type EinvoiceDirection, type EinvoiceDoc, type EinvoiceKind, type EinvoiceLight, type EinvoiceStatus,
} from '@xb/shared';
import { Button, Card, DataTable, Dropdown, Input, PageHeader, Select, Stat, StatusBadge, Tabs, type Column } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link, navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { LightBadge, Note, useAction, useOrgUnitName } from '../documents/p2docs';

const STATUSES: EinvoiceStatus[] = ['draft', 'new', 'routed', 'pending', 'approved', 'sent', 'accepted', 'signed', 'rejected'];
const LIGHTS: Exclude<EinvoiceLight, 'done'>[] = ['green', 'yellow', 'red', 'black'];
type Tab = EinvoiceDirection | 'mine';

export function EinvoicesPage() {
  const { t, lang } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const unitName = useOrgUnitName();
  const { busy, run } = useAction();
  const [tab, setTab] = useState<Tab>('incoming');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EinvoiceStatus | ''>('');
  const [kind, setKind] = useState<EinvoiceKind | ''>('');
  const [light, setLight] = useState<EinvoiceLight | ''>('');
  const [cp, setCp] = useState('');
  const [intake, setIntake] = useState<string>('');
  const stats = useApi(() => einvoicesApi.stats(user), [user.id]);
  const all = useApi(() => einvoicesApi.list());
  const list = useApi(
    () => einvoicesApi.list({ ...(tab === 'mine' ? { assignedTo: user.id } : { direction: tab }), search, ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(light ? { light } : {}), ...(cp ? { counterpartyId: cp } : {}) }),
    [tab, search, status, kind, light, cp, user.id],
  );
  const contracts = useApi(() => api.listContracts());
  const s = stats.data;
  const operator = can('einvoices', 'edit');
  const count = (d: EinvoiceDirection) => all.data?.filter((x) => x.direction === d).length;
  const holder = (d: EinvoiceDoc) => (d.status === 'routed' && d.assignment ? unitName(d.assignment.orgUnitKey) : d.issuerUnitKey ? unitName(d.issuerUnitKey) : '');

  async function receive(kinds?: EinvoiceKind[]) {
    await run(async () => {
      const r = await einvoicesApi.receiveFromSoliq(user, kinds);
      setIntake(
        r.created.length
          ? pick(lang, `Принято документов: ${r.created.length} (${r.created.map((c) => c.number).join(', ')}); автоматически направлено в подразделения: ${r.autoRouted}`, `Qabul qilindi: ${r.created.length} (${r.created.map((c) => c.number).join(', ')}); bo‘linmalarga avtomatik yuborildi: ${r.autoRouted}`, `Received: ${r.created.length} (${r.created.map((c) => c.number).join(', ')}); auto-routed to units: ${r.autoRouted}`)
          : r.status === 'success'
            ? pick(lang, 'Новых документов нет', 'Yangi hujjatlar yo‘q', 'No new documents')
            : pick(lang, `Налоговый комитет недоступен (${r.status}) — запрос в очереди интеграционной шины`, `Soliq qo‘mitasi mavjud emas (${r.status}) — so‘rov navbatda`, `Tax Committee unavailable (${r.status}) — request queued`),
      );
    });
  }

  const columns: Column<EinvoiceDoc>[] = [
    {
      header: t('number'),
      render: (d) => (
        <>
          <div className="doc-num">{d.number}</div>
          <div className="sub">{t(tk('einvoices_kind_', d.kind))} · {formatDate(d.date)}</div>
        </>
      ),
    },
    {
      header: d0(tab) === 'incoming' ? t('einvoices_seller') : t('einvoices_buyer'),
      render: (d) => (
        <>
          {lk.counterparty(d.counterpartyId)?.name}
          <div className="sub">{t('tin')} {lk.counterparty(d.counterpartyId)?.tin}</div>
        </>
      ),
    },
    { header: t('einvoices_contract'), render: (d) => <span className={d.contractId ? undefined : 'muted'}>{contracts.data?.find((k) => k.id === d.contractId)?.number ?? t('einvoices_noContract')}</span> },
    { header: pick(lang, 'Подразделение', 'Bo‘linma', 'Unit'), render: (d) => <span className="small">{holder(d) || <span className="muted">—</span>}</span> },
    { header: t('einvoices_total'), align: 'right', render: (d) => <b>{formatMoney(d.kind === 'reconciliation_act' ? (d.reconciliation?.closing ?? 0) : einvoiceTotals(d.lines, d.vatRate).total)}</b> },
    { header: pick(lang, 'Срок (10 дн.)', 'Muddat (10 kun)', 'Deadline (10 d)'), render: (d) => <LightBadge light={einvoiceLight(d)} prefix="einvoices_light_" {...(einvoiceLight(d) !== 'done' ? { day: einvoiceDay(d) } : {})} /> },
    { header: t('status'), render: (d) => <StatusBadge prefix="einvoices_status_" status={d.status} /> },
  ];

  const exportCols = [
    { header: t('number'), value: (d: EinvoiceDoc) => d.number },
    { header: pick(lang, 'Вид', 'Turi', 'Kind'), value: (d: EinvoiceDoc) => t(tk('einvoices_kind_', d.kind)) },
    { header: pick(lang, 'Направление', 'Yo‘nalish', 'Direction'), value: (d: EinvoiceDoc) => t(tk('einvoices_dir_', d.direction)) },
    { header: t('einvoices_date'), value: (d: EinvoiceDoc) => d.date },
    { header: t('counterparty'), value: (d: EinvoiceDoc) => lk.counterparty(d.counterpartyId)?.name ?? '' },
    { header: t('tin'), value: (d: EinvoiceDoc) => lk.counterparty(d.counterpartyId)?.tin ?? '' },
    { header: t('einvoices_contract'), value: (d: EinvoiceDoc) => contracts.data?.find((k) => k.id === d.contractId)?.number ?? '' },
    { header: pick(lang, 'Подразделение', 'Bo‘linma', 'Unit'), value: (d: EinvoiceDoc) => holder(d) },
    { header: t('einvoices_net'), value: (d: EinvoiceDoc) => einvoiceTotals(d.lines, d.vatRate).net, format: 'money' as const, total: true },
    { header: t('einvoices_vat'), value: (d: EinvoiceDoc) => einvoiceTotals(d.lines, d.vatRate).vat, format: 'money' as const, total: true },
    { header: t('einvoices_total'), value: (d: EinvoiceDoc) => einvoiceTotals(d.lines, d.vatRate).total, format: 'money' as const, total: true },
    { header: pick(lang, 'Светофор', 'Svetofor', 'Light'), value: (d: EinvoiceDoc) => t(tk('einvoices_light_', einvoiceLight(d))) },
    { header: t('status'), value: (d: EinvoiceDoc) => t(tk('einvoices_status_', d.status)) },
  ];

  return (
    <>
      <PageHeader
        title={t('einvoices_title')}
        subtitle={t('einvoices_subtitle')}
        actions={
          <>
            <Link to="/einvoices/reports" className="btn">{pick(lang, 'Отчёты и дашборд', 'Hisobotlar va dashbord', 'Reports & dashboard')}</Link>
            {operator && (
              <Dropdown
                menu={{
                  items: [
                    { key: 'all', label: pick(lang, 'Все виды документов', 'Barcha hujjat turlari', 'All document kinds'), icon: 'download', onClick: () => void receive() },
                    { key: 'invoice', label: t('einvoices_kind_invoice'), onClick: () => void receive(['invoice']) },
                    { key: 'work_act', label: t('einvoices_kind_work_act'), onClick: () => void receive(['work_act']) },
                    { key: 'reconciliation_act', label: t('einvoices_kind_reconciliation_act'), onClick: () => void receive(['reconciliation_act']) },
                  ],
                }}
              >
                <Button icon="refresh" loading={busy}>{pick(lang, 'Получить из Налогового комитета', 'Soliq qo‘mitasidan olish', 'Receive from Tax Committee')}</Button>
              </Dropdown>
            )}
            {operator && (
              <Link to="/einvoices/new" className="btn btn-primary">
                {t('einvoices_new')}
              </Link>
            )}
          </>
        }
      />
      {intake && <Note tone="ok" icon="check">{intake}</Note>}
      <div className="grid grid-4">
        <Stat label={t('einvoices_statIncoming')} value={s?.incomingNew ?? '—'} tone={s?.incomingNew ? 'accent' : undefined} icon="inbox" foot={s ? `${pick(lang, 'В подразделениях', 'Bo‘linmalarda', 'With units')}: ${s.routed}` : undefined} />
        <Stat label={pick(lang, 'Мне на решение', 'Mening qarorimga', 'Awaiting my decision')} value={s?.myTasks ?? '—'} tone={s?.myTasks ? 'alert' : undefined} icon="clock" />
        <Stat label={t('einvoices_statSigned')} value={s?.signedMonth ?? '—'} icon="check" foot={s?.rejected ? `${t('einvoices_statRejected')}: ${s.rejected}` : undefined} />
        <Stat label={t('einvoices_statVat')} value={s ? formatMoneyShort(s.vatMonth, lang) : '—'} icon="percent" foot={currencyLabel()} />
      </div>
      <div className="p2-kpi-lights" aria-label={pick(lang, 'Светофор 10-дневного срока', '10 kunlik muddat svetofori', '10-day deadline lights')}>
        {LIGHTS.map((l) => (
          <button key={l} className={light === l ? 'on' : ''} onClick={() => setLight(light === l ? '' : l)} data-testid={`ehf-light-${l}`}>
            <LightBadge light={l} prefix="einvoices_light_" />
            <div className="n num">{s?.lights[l] ?? '—'}</div>
          </button>
        ))}
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'incoming', label: t('einvoices_incoming'), count: count('incoming') },
            { value: 'outgoing', label: t('einvoices_outgoing'), count: count('outgoing') },
            { value: 'mine', label: pick(lang, 'Мне на решение', 'Mening qarorimga', 'For my decision'), count: s?.myTasks },
          ]}
        />
        <div className="p2-filter-wide">
          <Input placeholder={`${t('search')}: ${t('number')}, ${t('einvoices_lines').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select<EinvoiceKind> value={kind} onChange={setKind} placeholder={`${pick(lang, 'Вид', 'Turi', 'Kind')}: ${t('all')}`} options={EINVOICE_KINDS.map((k) => ({ value: k, label: t(tk('einvoices_kind_', k)) }))} />
          <Select<EinvoiceStatus> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={STATUSES.map((x) => ({ value: x, label: t(tk('einvoices_status_', x)) }))} />
          <Select value={cp} onChange={setCp} placeholder={`${t('counterparty')}: ${t('all')}`} options={lk.counterparties.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <div className="toolbar" style={{ padding: '10px 14px', justifyContent: 'space-between' }}>
          <span className="muted small">{list.data ? `${pick(lang, 'Найдено', 'Topildi', 'Found')}: ${list.data.length}` : ''}{light ? ` · ${t(tk('einvoices_light_', light))}` : ''}</span>
          <ExportButton filename={pick(lang, 'ЭСФ и акты', 'EHF va dalolatnomalar', 'E-invoices and acts')} title={t('einvoices_title')} columns={exportCols} rows={list.data ?? []} />
        </div>
        <DataTable rows={list.data} loading={list.loading} columns={columns} rowKey={(d) => d.id} onRowClick={(d) => navigate(`/einvoices/${d.id}`)} />
      </Card>
      <p className="muted small" style={{ margin: 0 }}>{t('einvoices_operatorNote')}</p>
    </>
  );
}

const d0 = (tab: Tab): EinvoiceDirection => (tab === 'outgoing' ? 'outgoing' : 'incoming');
