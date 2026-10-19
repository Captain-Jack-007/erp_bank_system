// Отчёты и дашборд исполнения ЭСФ / актов (PR-EHF-031, 040, 050…053).
import { useState } from 'react';
import { einvoicesApi, formatMoney, pick, tk, type EinvoiceReportRow, type EinvoiceUnitReportRow } from '@xb/shared';
import { BarChart, Card, DataTable, Input, LineChart, PageHeader, Stat, Tabs, type Column } from '../../components/ui';
import { ExportButton, toSheet } from '../../components/Export';
import { navigate } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { LightBadge, yearStart } from '../documents/p2docs';

type Tab = 'dashboard' | 'documents' | 'units';

export function EinvoiceReportsPage() {
  const { t, lang, loc } = useSession();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const dash = useApi(() => einvoicesApi.dashboard());
  const rows = useApi(() => einvoicesApi.report({ from, to }), [from, to]);
  const units = useApi(() => einvoicesApi.unitReport({ from, to }), [from, to]);
  const d = dash.data;

  const docCols: Column<EinvoiceReportRow>[] = [
    { header: pick(lang, 'Вид', 'Turi', 'Kind'), render: (r) => <b>{t(tk('einvoices_kind_', r.kind))}</b> },
    { header: pick(lang, 'Направление', 'Yo‘nalish', 'Direction'), render: (r) => t(tk('einvoices_dir_', r.direction)) },
    { header: pick(lang, 'Документов', 'Hujjatlar', 'Documents'), align: 'right', render: (r) => r.count },
    { header: pick(lang, 'Принято / отправлено', 'Qabul / yuborilgan', 'Accepted / sent'), align: 'right', render: (r) => r.accepted },
    { header: pick(lang, 'Отклонено', 'Rad etilgan', 'Rejected'), align: 'right', render: (r) => r.rejected },
    { header: pick(lang, 'В работе', 'Ishda', 'Open'), align: 'right', render: (r) => r.open },
    { header: t('einvoices_net'), align: 'right', render: (r) => formatMoney(r.net) },
    { header: t('einvoices_vat'), align: 'right', render: (r) => formatMoney(r.vat) },
    { header: t('einvoices_total'), align: 'right', render: (r) => <b>{formatMoney(r.total)}</b> },
  ];
  const unitCols: Column<EinvoiceUnitReportRow>[] = [
    { header: pick(lang, 'Подразделение / регион', 'Bo‘linma / hudud', 'Unit / region'), render: (r) => loc(r.unitName) },
    { header: pick(lang, 'Направлено', 'Yuborilgan', 'Routed'), align: 'right', render: (r) => r.routed },
    { header: pick(lang, 'Подтверждено', 'Tasdiqlangan', 'Confirmed'), align: 'right', render: (r) => r.confirmed },
    { header: pick(lang, 'Отклонено', 'Rad etilgan', 'Rejected'), align: 'right', render: (r) => r.rejected },
    { header: pick(lang, 'Ожидают', 'Kutilmoqda', 'Open'), align: 'right', render: (r) => r.open },
    { header: pick(lang, 'Просрочено', 'Kechiktirilgan', 'Overdue'), align: 'right', render: (r) => <span style={r.overdue ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.overdue}</span> },
    { header: pick(lang, 'Штраф KPI, баллы', 'KPI jarimasi, ball', 'KPI penalty, pts'), align: 'right', render: (r) => r.penaltyPoints },
    { header: pick(lang, 'Ср. срок, дн.', 'O‘rt. muddat, kun', 'Avg days'), align: 'right', render: (r) => r.avgDays },
  ];
  const exportSheets = () => [
    toSheet(pick(lang, 'Документы', 'Hujjatlar', 'Documents'), [
      { header: pick(lang, 'Вид', 'Turi', 'Kind'), value: (r: EinvoiceReportRow) => t(tk('einvoices_kind_', r.kind)) },
      { header: pick(lang, 'Направление', 'Yo‘nalish', 'Direction'), value: (r: EinvoiceReportRow) => t(tk('einvoices_dir_', r.direction)) },
      { header: pick(lang, 'Документов', 'Hujjatlar', 'Documents'), value: (r: EinvoiceReportRow) => r.count, format: 'integer', total: true },
      { header: pick(lang, 'Принято', 'Qabul', 'Accepted'), value: (r: EinvoiceReportRow) => r.accepted, format: 'integer', total: true },
      { header: pick(lang, 'Отклонено', 'Rad etilgan', 'Rejected'), value: (r: EinvoiceReportRow) => r.rejected, format: 'integer', total: true },
      { header: t('einvoices_net'), value: (r: EinvoiceReportRow) => r.net, format: 'money', total: true },
      { header: t('einvoices_vat'), value: (r: EinvoiceReportRow) => r.vat, format: 'money', total: true },
      { header: t('einvoices_total'), value: (r: EinvoiceReportRow) => r.total, format: 'money', total: true },
    ], rows.data ?? [], { title: `${t('einvoices_title')} · ${from} — ${to}`, totalLabel: t('total') }),
    toSheet(pick(lang, 'Подразделения', 'Bo‘linmalar', 'Units'), [
      { header: pick(lang, 'Подразделение', 'Bo‘linma', 'Unit'), value: (r: EinvoiceUnitReportRow) => loc(r.unitName) },
      { header: pick(lang, 'Направлено', 'Yuborilgan', 'Routed'), value: (r: EinvoiceUnitReportRow) => r.routed, format: 'integer', total: true },
      { header: pick(lang, 'Подтверждено', 'Tasdiqlangan', 'Confirmed'), value: (r: EinvoiceUnitReportRow) => r.confirmed, format: 'integer', total: true },
      { header: pick(lang, 'Просрочено', 'Kechiktirilgan', 'Overdue'), value: (r: EinvoiceUnitReportRow) => r.overdue, format: 'integer', total: true },
      { header: pick(lang, 'Штраф KPI', 'KPI jarimasi', 'KPI penalty'), value: (r: EinvoiceUnitReportRow) => r.penaltyPoints, format: 'integer', total: true },
      { header: pick(lang, 'Ср. срок, дн.', 'O‘rt. muddat', 'Avg days'), value: (r: EinvoiceUnitReportRow) => r.avgDays, format: 'number' },
    ], units.data ?? [], { title: pick(lang, 'Исполнение подразделениями', 'Bo‘linmalar ijrosi', 'Execution by units') }),
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('einvoices_title'), to: '/einvoices' }, { label: pick(lang, 'Отчёты', 'Hisobotlar', 'Reports') }]}
        title={pick(lang, 'Отчёты и дашборд исполнения', 'Hisobotlar va ijro dashbordi', 'Reports and execution dashboard')}
        subtitle={pick(lang, 'Все документы, поступившие в систему: счета-фактуры, акты, акты сверки', 'Tizimga kelgan barcha hujjatlar: hisob-fakturalar, dalolatnomalar', 'All documents received: invoices, acts, reconciliation acts')}
        actions={<ExportButton filename={pick(lang, 'Отчёт ЭСФ', 'EHF hisoboti', 'E-invoice report')} sheets={exportSheets} />}
      />
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'dashboard', label: pick(lang, 'Дашборд', 'Dashbord', 'Dashboard') },
            { value: 'documents', label: pick(lang, 'По видам документов', 'Hujjat turlari bo‘yicha', 'By document kind') },
            { value: 'units', label: pick(lang, 'По подразделениям и регионам', 'Bo‘linmalar va hududlar bo‘yicha', 'By unit and region') },
          ]}
        />
        {tab !== 'dashboard' && (
          <div className="p2-filter-wide">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={pick(lang, 'Период с', 'Davr boshi', 'From')} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={pick(lang, 'Период по', 'Davr oxiri', 'To')} />
          </div>
        )}
        {tab === 'documents' && <DataTable rows={rows.data} loading={rows.loading} columns={docCols} rowKey={(r) => `${r.direction}-${r.kind}`} />}
        {tab === 'units' && <DataTable rows={units.data} loading={units.loading} columns={unitCols} rowKey={(r) => r.orgUnitKey} />}
        {tab === 'dashboard' && d && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="grid grid-4">
              {(['green', 'yellow', 'red', 'black'] as const).map((l) => (
                <Stat key={l} label={t(tk('einvoices_light_', l))} value={d.lights[l]} {...(l === 'black' && d.lights.black ? { tone: 'alert' as const } : {})} icon={l === 'green' ? 'check' : 'clock'} />
              ))}
            </div>
            <div className="grid grid-2">
              <Card title={pick(lang, 'Поступление и решения за 14 дней', '14 kunlik tushum va qarorlar', 'Received and decided, 14 days')}>
                <LineChart labels={d.daily.map((x) => x.date.slice(5))} series={[{ name: pick(lang, 'Поступило', 'Kelgan', 'Received'), values: d.daily.map((x) => x.received) }, { name: pick(lang, 'Решения', 'Qarorlar', 'Decided'), values: d.daily.map((x) => x.decided) }]} />
              </Card>
              <Card title={pick(lang, 'Исполнение по подразделениям', 'Bo‘linmalar ijrosi', 'Execution by unit')}>
                <BarChart data={d.byUnit.slice(0, 8).map((u) => ({ label: loc(u.unitName).split(' ').slice(0, 2).join(' '), values: [u.confirmed, u.open, u.overdue] }))} series={[{ name: pick(lang, 'Подтверждено', 'Tasdiqlangan', 'Confirmed') }, { name: pick(lang, 'Ожидают', 'Kutilmoqda', 'Open') }, { name: pick(lang, 'Просрочено', 'Kechiktirilgan', 'Overdue'), color: 'var(--danger)' }]} />
              </Card>
            </div>
            <Card title={pick(lang, 'Документы с приближающимся и нарушенным сроком', 'Muddati yaqinlashgan va buzilgan hujjatlar', 'Documents near or past deadline')} flush>
              <DataTable
                rows={d.critical}
                columns={[
                  { header: t('number'), render: (r) => <span className="doc-num">{r.number}</span> },
                  { header: pick(lang, 'Вид', 'Turi', 'Kind'), render: (r) => t(tk('einvoices_kind_', r.kind)) },
                  { header: pick(lang, 'Срок', 'Muddat', 'Deadline'), render: (r) => <LightBadge light={r.light} prefix="einvoices_light_" day={r.day} /> },
                  { header: pick(lang, 'У кого документ', 'Hujjat kimda', 'Holder'), render: (r) => <span className="small">{r.holder}</span> },
                ]}
                rowKey={(r) => r.id}
                onRowClick={(r) => navigate(`/einvoices/${r.id}`)}
              />
            </Card>
          </div>
        )}
      </Card>
    </>
  );
}
