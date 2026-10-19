// Формы контроля и отчётности (ТЗ 4.2.17.6, PR-TAX-053…056, 063, 065): сводный НДС по филиалам, акты сверки
// с бюджетом по филиалам (печать с QR, подпись E-IMZO), автоматические ЭСФ, файлы отчётов в формате ГНК.
import { useState } from 'react';
import { formatDateTime, formatMoney, signatureService, taxesApi, tk, type TaxReconAct, type TaxReturnView } from '@xb/shared';
import { Badge, Button, Card, DataTable, PageHeader, Select, Stat, Tabs, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { SignModal } from '../../components/SignModal';
import { downloadBytes } from '../../components/download';
import { navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { TaxStatus } from './TaxesPage';
import { useBranches, useErrText, useP, useUrlTab } from './common';

const TABS = ['vat', 'acts', 'esf', 'files'] as const;
type Tab = (typeof TABS)[number];

export function TaxControlPage() {
  const { t } = useSession();
  const p = useP();
  const [tab, setTab] = useUrlTab<Tab>(TABS, 'vat');
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('taxes_title'), to: '/taxes' }, { label: p('Контроль и сдача', 'Nazorat va topshirish', 'Control & filing') }]}
        title={p('Контроль, акты сверки и сдача отчётности', "Nazorat, solishtirish dalolatnomalari va hisobot topshirish", 'Control, reconciliation acts and filing')}
        subtitle={`${t('tzLabel')} 4.2.17.6 · ${p('отчётность сдаётся централизованно Департаментом бухгалтерского учёта и отчётности', "hisobotlar Buxgalteriya hisobi va hisobot departamenti tomonidan markazlashgan holda topshiriladi", 'returns are filed centrally by the Accounting & Reporting Department')}`}
      />
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'vat', label: p('Сводный НДС по филиалам', "Filiallar bo'yicha yig'ma QQS", 'Consolidated VAT by branch') },
            { value: 'acts', label: p('Акты сверки с бюджетом', "Byudjet bilan solishtirish dalolatnomalari", 'Budget reconciliation acts') },
            { value: 'esf', label: p('Автоматические ЭСФ', 'Avtomatik EHF', 'Automatic e-invoices') },
            { value: 'files', label: p('Файлы ГНК', 'DSQ fayllari', 'Tax authority files') },
          ]}
        />
        {tab === 'vat' && <VatTab />}
        {tab === 'acts' && <ActsTab />}
        {tab === 'esf' && <EsfTab />}
        {tab === 'files' && <FilesTab />}
      </Card>
    </>
  );
}

function VatTab() {
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const errText = useErrText();
  const can = useCan()('taxes', 'edit');
  const br = useBranches();
  const [month, setMonth] = useState('2026-10');
  const list = useApi(() => taxesApi.listVatTurnover(month), [month]);
  const rows = list.data ?? [];
  const branches = [...new Set(rows.map((r) => r.branchKey))];
  const table = branches.map((b) => {
    const rs = rows.filter((r) => r.branchKey === b);
    const v = (c: string) => rs.filter((r) => r.category === c).reduce((s, r) => s + r.amount, 0);
    const turnover = rs.reduce((s, r) => s + r.amount, 0);
    const input = rs.reduce((s, r) => s + r.inputVat, 0);
    return { branchKey: b, rent: v('rent'), collateral: v('collateral'), services: v('services'), turnover, output: Math.round(turnover * 0.12), input, payable: Math.round(turnover * 0.12) - input };
  });
  const tot = (k: keyof (typeof table)[number]) => table.reduce((s, r) => s + (r[k] as number), 0);
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
        <Select<string> value={month} onChange={setMonth} options={['2026-09', '2026-10'].map((m) => ({ value: m, label: m }))} ariaLabel={p('Месяц', 'Oy', 'Month')} />
        {can && (
          <Button size="small" type="primary" onClick={async () => {
            try {
              const r = await taxesApi.generateReturn('vat', month, user);
              toast(`${p('Сводный расчёт НДС сформирован', "Yig'ma QQS hisobi shakllantirildi", 'Consolidated VAT return generated')}: ${r.number}`);
              navigate(`/taxes/${r.id}`);
            } catch (e) {
              toast(errText(e));
            }
          }}>{p('Сформировать сводный расчёт НДС', "Yig'ma QQS hisobini shakllantirish", 'Generate consolidated VAT return')}</Button>
        )}
        <span className="muted small">{p('Обороты собираются из ЭСФ и ABS по каждому филиалу; расчёт сдаётся централизованно.', "Aylanmalar har bir filial bo'yicha EHF va ABS dan yig'iladi; hisob markazlashgan holda topshiriladi.", 'Turnover is collected from e-invoices and ABS for each branch; the return is filed centrally.')}</span>
        <span style={{ marginLeft: 'auto' }}>
          <ExportButton filename={`vat-consolidated-${month}`} rows={table} columns={[
            { header: p('Филиал', 'Filial', 'Branch'), value: (r) => `${r.branchKey} ${br.name(r.branchKey)}` },
            { header: p('Аренда', 'Ijara', 'Rent'), value: (r) => r.rent, format: 'money', total: true },
            { header: p('Залоговое имущество', 'Garov mulki', 'Collateral'), value: (r) => r.collateral, format: 'money', total: true },
            { header: p('Небанковские услуги', "Bank bo'lmagan xizmatlar", 'Non-bank services'), value: (r) => r.services, format: 'money', total: true },
            { header: p('НДС начисленный', 'Hisoblangan QQS', 'Output VAT'), value: (r) => r.output, format: 'money', total: true },
            { header: p('НДС к зачёту', 'Hisobga olinadigan QQS', 'Input VAT'), value: (r) => r.input, format: 'money', total: true },
            { header: p('К уплате', "To'lanadigan", 'Payable'), value: (r) => r.payable, format: 'money', total: true },
          ]} />
        </span>
      </div>
      <div className="grid grid-3" style={{ padding: 14 }}>
        <Stat label={p('Облагаемый оборот', 'Soliq solinadigan aylanma', 'Taxable turnover')} value={formatMoney(tot('turnover'))} icon="chart" />
        <Stat label={p('НДС начисленный / к зачёту', 'QQS hisoblangan / hisobga olinadigan', 'Output / input VAT')} value={formatMoney(tot('output'))} foot={formatMoney(tot('input'))} icon="receipt" />
        <Stat label={p('К уплате', "To'lanadigan", 'Payable')} value={formatMoney(tot('payable'))} tone="accent" icon="wallet" foot={`${branches.length} ${p('филиалов', 'filial', 'branches')}`} />
      </div>
      <DataTable
        rows={table}
        loading={list.loading}
        rowKey={(r) => r.branchKey}
        columns={[
          { header: p('Филиал', 'Filial', 'Branch'), render: (r) => <><b>{r.branchKey}</b> <span className="muted">{br.name(r.branchKey)}</span></> },
          { header: p('Аренда', 'Ijara', 'Rent'), align: 'right', render: (r) => formatMoney(r.rent) },
          { header: p('Залоговое имущество', 'Garov mulki', 'Collateral'), align: 'right', render: (r) => formatMoney(r.collateral) },
          { header: p('Услуги', 'Xizmatlar', 'Services'), align: 'right', render: (r) => formatMoney(r.services) },
          { header: p('НДС 12%', 'QQS 12%', 'VAT 12%'), align: 'right', render: (r) => formatMoney(r.output) },
          { header: p('К зачёту', 'Hisobga', 'Input'), align: 'right', render: (r) => formatMoney(r.input) },
          { header: p('К уплате', "To'lanadigan", 'Payable'), align: 'right', render: (r) => <b>{formatMoney(r.payable)}</b> },
        ]}
      />
    </>
  );
}

function ActsTab() {
  const p = useP();
  const { t } = useSession();
  const br = useBranches();
  const can = useCan()('taxes', 'edit');
  const [month, setMonth] = useState('2026-09');
  const acts = useApi(() => taxesApi.reconActs(month), [month]);
  const [signing, setSigning] = useState<TaxReconAct | null>(null);
  const sigs = useApi(async () => {
    const out: Record<string, string> = {};
    for (const a of acts.data ?? []) {
      const s = await signatureService.list('tax_act', a.id);
      if (s[0]) out[a.id] = s[0].id;
    }
    return out;
  }, [acts.data]);
  const actDoc = (a: TaxReconAct) => ({
    entity: 'tax_act', entityId: a.id, title: p('Акт сверки расчётов с бюджетом', 'Byudjet bilan hisob-kitoblarni solishtirish dalolatnomasi', 'Budget settlement reconciliation act'), number: a.id, date: new Date().toISOString().slice(0, 10),
    fields: [{ label: p('Филиал', 'Filial', 'Branch'), value: `${a.branchKey} ${br.name(a.branchKey)}` }, { label: p('Месяц', 'Oy', 'Month'), value: a.month }, { label: p('Начислено', 'Hisoblangan', 'Accrued'), value: formatMoney(a.accrued) }, { label: p('Уплачено', "To'langan", 'Paid'), value: formatMoney(a.paid) }, { label: p('Сальдо', 'Saldo', 'Balance'), value: formatMoney(a.difference) }],
    table: { columns: [{ header: t('taxes_type') }, { header: p('Начислено', 'Hisoblangan', 'Accrued'), align: 'right' as const }, { header: p('Уплачено', "To'langan", 'Paid'), align: 'right' as const }, { header: p('Разница', 'Farq', 'Difference'), align: 'right' as const }], rows: a.rows.map((r) => [t(tk('taxes_type_', r.tax)), formatMoney(r.accrued), formatMoney(r.paid), formatMoney(r.difference)]), totals: [p('Итого', 'Jami', 'Total'), formatMoney(a.accrued), formatMoney(a.paid), formatMoney(a.difference)] },
    signers: [{ role: p('Главный бухгалтер', 'Bosh buxgalter', 'Chief Accountant'), name: '', ...(sigs.data?.[a.id] ? { signatureId: sigs.data[a.id] } : {}) }, { role: p('Налоговый орган', 'Soliq organi', 'Tax authority'), name: '' }],
  });
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
        <Select<string> value={month} onChange={setMonth} options={['2026-08', '2026-09', '2026-10'].map((m) => ({ value: m, label: m }))} ariaLabel={p('Месяц', 'Oy', 'Month')} />
        <span className="muted small">{p('Начисления и платежи распределяются по филиалам пропорционально их налоговой базе / налогу в расчёте.', "Hisoblash va to'lovlar filiallarga hisobdagi soliq bazasi / soliqqa mutanosib taqsimlanadi.", 'Accruals and payments are allocated to branches in proportion to their base / tax in the return.')}</span>
        <span style={{ marginLeft: 'auto' }}>
          <ExportButton filename={`tax-recon-acts-${month}`} sheets={() => [{
            name: month, title: p('Акты сверки с бюджетом по филиалам', "Filiallar bo'yicha byudjet bilan solishtirish dalolatnomalari", 'Budget reconciliation acts by branch'),
            columns: [{ header: p('Филиал', 'Filial', 'Branch') }, { header: t('taxes_type') }, { header: p('Начислено', 'Hisoblangan', 'Accrued'), format: 'money', total: true }, { header: p('Уплачено', "To'langan", 'Paid'), format: 'money', total: true }, { header: p('Разница', 'Farq', 'Difference'), format: 'money', total: true }],
            rows: (acts.data ?? []).flatMap((a) => a.rows.map((r) => [a.branchKey, t(tk('taxes_type_', r.tax)), r.accrued, r.paid, r.difference])),
          }]} />
        </span>
      </div>
      <DataTable
        rows={acts.data}
        loading={acts.loading}
        rowKey={(a) => a.id}
        columns={[
          { header: p('Акт', 'Dalolatnoma', 'Act'), render: (a) => <><span className="doc-num">{a.id}</span><div className="sub">{br.name(a.branchKey)}</div></> },
          { header: p('Налоги', 'Soliqlar', 'Taxes'), render: (a) => <span className="small">{a.rows.map((r) => t(tk('taxes_type_', r.tax))).join(', ')}</span> },
          { header: p('Начислено', 'Hisoblangan', 'Accrued'), align: 'right', render: (a) => formatMoney(a.accrued) },
          { header: p('Уплачено', "To'langan", 'Paid'), align: 'right', render: (a) => formatMoney(a.paid) },
          { header: p('Сальдо', 'Saldo', 'Balance'), align: 'right', render: (a) => <b style={{ color: a.difference > 0 ? 'var(--danger)' : undefined }}>{formatMoney(a.difference)}</b> },
          { header: 'E-IMZO', render: (a) => (sigs.data?.[a.id] ? <Badge tone="ok">{p('подписан', 'imzolangan', 'signed')}</Badge> : <Badge tone="muted">—</Badge>) },
          { header: '', render: (a) => <span style={{ display: 'flex', gap: 6 }}><PrintButton template="act" doc={() => actDoc(a)} label={p('Печать', 'Chop', 'Print')} />{can && !sigs.data?.[a.id] && <Button size="small" icon="pen" onClick={() => setSigning(a)}>{p('Подписать', 'Imzolash', 'Sign')}</Button>}</span> },
        ]}
      />
      {signing && <SignModal doc={{ entity: 'tax_act', entityId: signing.id, title: signing.id, content: signing }} onClose={() => setSigning(null)} onSigned={() => sigs.reload()} />}
    </>
  );
}

function EsfTab() {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const errText = useErrText();
  const can = useCan()('taxes', 'edit');
  const br = useBranches();
  const list = useApi(() => taxesApi.listAutoEsf());
  const services = useApi(() => taxesApi.listServices());
  const clients = useApi(() => taxesApi.listServiceClients());
  const [month, setMonth] = useState('2026-10');
  const [busy, setBusy] = useState(false);
  const ST: Record<string, 'ok' | 'warn' | 'danger' | 'info'> = { delivered: 'ok', sent: 'info', queued: 'warn', failed: 'danger' };
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
        <Select<string> value={month} onChange={setMonth} options={['2026-10', '2026-11', '2026-12'].map((m) => ({ value: m, label: m }))} ariaLabel={p('Месяц', 'Oy', 'Month')} />
        {can && (
          <Button size="small" type="primary" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await taxesApi.generateServiceEsf(month, user);
              toast(`${p('Сформировано и отправлено ЭСФ', 'EHF shakllantirildi va yuborildi', 'E-invoices generated and sent')}: ${r.created}${r.skipped ? ` (${p('уже были', 'avval bor edi', 'already existed')}: ${r.skipped})` : ''}`);
            } catch (e) {
              toast(errText(e));
            } finally {
              setBusy(false);
            }
          }}>{p('Сформировать ЭСФ по услугам за месяц', "Oy uchun xizmatlar bo'yicha EHF shakllantirish", 'Generate service e-invoices for the month')}</Button>
        )}
        <span className="muted small">{p('Услуги с фиксированной стоимостью — каждому клиенту; при продаже имущества ЭСФ формируется автоматически (реестр имущества → «Реализовать»).', "Belgilangan narxdagi xizmatlar — har bir mijozga; mol-mulk sotilganda EHF avtomatik shakllantiriladi (mol-mulk reyestri → «Sotish»).", 'Fixed-price services — to each client; on a property sale the e-invoice is generated automatically (property register → “Sell”).')}</span>
      </div>
      <div className="grid grid-2" style={{ padding: 14 }}>
        <Card title={p('Услуги с фиксированной стоимостью', 'Belgilangan narxdagi xizmatlar', 'Fixed-price services')} flush>
          <DataTable rows={services.data} rowKey={(s) => s.id} columns={[{ header: p('Код', 'Kod', 'Code'), render: (s) => <span className="doc-num">{s.code}</span> }, { header: p('Услуга', 'Xizmat', 'Service'), render: (s) => loc(s.name) }, { header: p('Цена', 'Narx', 'Price'), align: 'right', render: (s) => formatMoney(s.price) }]} />
        </Card>
        <Card title={p('Клиенты', 'Mijozlar', 'Clients')} flush>
          <DataTable rows={clients.data} rowKey={(c) => c.id} columns={[{ header: p('Клиент', 'Mijoz', 'Client'), render: (c) => <>{c.name}<div className="sub">{p('ИНН', 'STIR', 'TIN')} {c.tin} · {c.branchKey}</div></> }, { header: p('Услуги', 'Xizmatlar', 'Services'), render: (c) => <span className="small">{c.serviceIds.map((id) => services.data?.find((s) => s.id === id)?.code ?? id).join(', ')}</span> }]} />
        </Card>
      </div>
      <DataTable
        rows={list.data}
        loading={list.loading}
        emptyText={p('ЭСФ ещё не формировались', 'EHF hali shakllantirilmagan', 'No e-invoices generated yet')}
        rowKey={(e) => e.id}
        columns={[
          { header: p('ЭСФ', 'EHF', 'E-invoice'), render: (e) => <><span className="doc-num">{e.number}</span><div className="sub">{formatDateTime(e.createdAt)}</div></> },
          { header: p('Основание', 'Asos', 'Basis'), render: (e) => (e.kind === 'asset_sale' ? <Badge tone="warn">{p('продажа имущества', 'mol-mulk sotish', 'property sale')}</Badge> : <Badge tone="info">{p('услуги', 'xizmatlar', 'services')} {e.month}</Badge>) },
          { header: p('Покупатель', 'Xaridor', 'Buyer'), render: (e) => <>{e.clientName}<div className="sub">{p('ИНН', 'STIR', 'TIN')} {e.tin} · {br.name(e.branchKey)}</div></> },
          { header: p('Без НДС', 'QQSsiz', 'Net'), align: 'right', render: (e) => formatMoney(e.net) },
          { header: p('НДС', 'QQS', 'VAT'), align: 'right', render: (e) => formatMoney(e.vat) },
          { header: p('Итого', 'Jami', 'Total'), align: 'right', render: (e) => <b>{formatMoney(e.total)}</b> },
          { header: p('Оператор', 'Operator', 'Operator'), render: (e) => <Badge tone={ST[e.status] ?? 'info'}>{e.status}</Badge> },
          { header: '', render: (e) => (can && (e.status === 'failed' || e.status === 'queued') ? <Button size="small" onClick={() => taxesApi.resendEsf(e.id, user).then(() => toast(p('Отправлено повторно', 'Qayta yuborildi', 'Resent')), (x) => toast(errText(x)))}>{p('Повторить', 'Takrorlash', 'Retry')}</Button> : null) },
        ]}
      />
    </>
  );
}

function FilesTab() {
  const p = useP();
  const { t } = useSession();
  const toast = useToast();
  const list = useApi(() => taxesApi.listReturns());
  return (
    <DataTable<TaxReturnView>
      rows={list.data}
      loading={list.loading}
      rowKey={(r) => r.id}
      onRowClick={(r) => navigate(`/taxes/${r.id}`)}
      columns={[
        { header: t('number'), render: (r) => <span className="doc-num">{r.number}</span> },
        { header: t('taxes_type'), render: (r) => t(tk('taxes_type_', r.type)) },
        { header: t('taxes_period'), render: (r) => r.period },
        { header: t('status'), render: (r) => <TaxStatus status={r.status} /> },
        { header: p('Отправка в ГНК', 'DSQ ga yuborish', 'Filing'), render: (r) => (r.filing ? <span className="small">{r.filing.fileName}</span> : <span className="muted small">—</span>) },
        {
          header: '',
          render: (r) => (
            <Button size="small" icon="download" onClick={async (e) => {
              e.stopPropagation();
              const f = await taxesApi.gnkFile(r.id);
              downloadBytes(f.fileName, 'application/xml', f.xml);
              toast(p('Файл сформирован', 'Fayl shakllantirildi', 'File generated'));
            }}>XML</Button>
          ),
        },
      ]}
    />
  );
}

