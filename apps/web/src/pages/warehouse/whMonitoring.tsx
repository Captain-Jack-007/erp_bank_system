// Склад: партии (FIFO, сроки годности, залежалость), журнал проводок iABS, ежедневный мониторинг
// (сверка остатков с балансом iABS, незавершённые операции, уведомления).
import { useState } from 'react';
import { formatDate, formatDateTime, formatMoney, formatNumber, tk, warehouseApi, WAREHOUSE_SETTINGS, type WmsModule, type WmsPostingStatus } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, FilterBar, Input, Select, Stat, StatusBadge, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan, GuardedLink } from '../../lib/access';
import { PostingsTable, ReconTable, useP, useWmsError } from './wmsShared';

export function BatchesTab() {
  const { t } = useSession();
  const p = useP();
  const [search, setSearch] = useState('');
  const [wh, setWh] = useState('');
  const [exp, setExp] = useState(false);
  const [stale, setStale] = useState(false);
  const locs = useApi(() => warehouseApi.listLocations());
  const list = useApi(() => warehouseApi.listBatches({ search, expiringOnly: exp, staleOnly: stale, ...(wh ? { warehouseId: wh } : {}) }), [search, wh, exp, stale]);
  type B = NonNullable<typeof list.data>[number];
  const whCode = (id: string) => locs.data?.find((l) => l.id === id)?.code ?? id;
  return (
    <>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('warehouse_sku')}, ${p('партия', 'partiya', 'batch')}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={wh} onChange={setWh} placeholder={`${t('warehouse_warehouse')}: ${t('all')}`} options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        <Checkbox checked={exp} onChange={setExp}>{p(`Срок годности ≤ ${WAREHOUSE_SETTINGS.expiryWarnDays} дн.`, `Muddat ≤ ${WAREHOUSE_SETTINGS.expiryWarnDays} kun`, `Expiry ≤ ${WAREHOUSE_SETTINGS.expiryWarnDays} days`)}</Checkbox>
        <Checkbox checked={stale} onChange={setStale}>{p(`Залежалые (≥ ${WAREHOUSE_SETTINGS.staleDays} дн.)`, `Uzoq saqlangan (≥ ${WAREHOUSE_SETTINGS.staleDays} kun)`, `Slow-moving (≥ ${WAREHOUSE_SETTINGS.staleDays} days)`)}</Checkbox>
        <ExportButton filename={p('Отчёт по партиям (FIFO)', 'Partiyalar hisoboti (FIFO)', 'Batch report (FIFO)')} rows={list.data ?? []} columns={[
          { header: p('Партия', 'Partiya', 'Batch'), value: (b) => b.batchNo }, { header: t('warehouse_sku'), value: (b) => b.sku }, { header: t('warehouse_item'), value: (b) => b.name }, { header: t('warehouse_warehouse'), value: (b) => whCode(b.warehouseId) },
          { header: p('Поступила', 'Kelgan', 'Received'), value: (b) => b.receivedAt }, { header: p('Дней на складе', 'Omborda kun', 'Days in stock'), value: (b) => b.ageDays, format: 'integer' }, { header: p('Остаток', 'Qoldiq', 'Left'), value: (b) => b.qtyLeft, format: 'integer' },
          { header: t('warehouse_unitCost'), value: (b) => b.unitCost, format: 'money' }, { header: t('warehouse_sum'), value: (b) => b.qtyLeft * b.unitCost, format: 'money', total: true }, { header: p('Годен до', 'Yaroqli', 'Expires'), value: (b) => b.expiryDate ?? '' },
        ]} />
      </FilterBar>
      <div className="wms-note" style={{ padding: '8px 18px' }}>{p('Списание и выдача ведутся по FIFO: первой расходуется самая ранняя партия; стоимость расхода — по цене партий.', 'Hisobdan chiqarish va berish FIFO bo‘yicha: birinchi eng erta partiya sarflanadi; sarf qiymati partiya narxida.', 'Issues and write-offs follow FIFO: the oldest batch is consumed first; cost is taken from batch prices.')}</div>
      <DataTable<B> rows={list.data} loading={list.loading} rowKey={(b) => b.id} columns={[
        { header: p('Партия', 'Partiya', 'Batch'), render: (b) => <span className="wms-mono">{b.batchNo}</span> },
        { header: t('warehouse_item'), render: (b) => (<>{b.name}<div className="sub">{b.sku} · {whCode(b.warehouseId)}</div></>) },
        { header: p('Поступила', 'Kelgan', 'Received'), render: (b) => (<>{formatDate(b.receivedAt)}<div className="sub">{b.ageDays} {p('дн.', 'kun', 'days')}{b.stale ? ` · ${p('залежалый', 'uzoq saqlangan', 'slow-moving')} (≥ ${b.staleThreshold})` : ''}</div></>) },
        { header: p('Остаток / приход', 'Qoldiq / kirim', 'Left / in'), align: 'right', render: (b) => `${formatNumber(b.qtyLeft)} / ${formatNumber(b.qtyIn)} ${b.unit}` },
        { header: t('warehouse_unitCost'), align: 'right', render: (b) => formatMoney(b.unitCost) },
        { header: p('Годен до', 'Yaroqli', 'Expires'), render: (b) => (b.expiryDate ? (<>{formatDate(b.expiryDate)}{b.daysToExpiry !== undefined && <div>{b.daysToExpiry < 0 ? <Badge tone="danger">{p('просрочен', 'muddati o‘tgan', 'expired')}</Badge> : b.expiring ? <Badge tone="warn">{b.daysToExpiry} {p('дн.', 'kun', 'days')}</Badge> : null}</div>}</>) : '—') },
      ]} />
    </>
  );
}

export function PostingsTab() {
  const { t } = useSession();
  const p = useP();
  const [module, setModule] = useState<WmsModule | ''>('');
  const [status, setStatus] = useState<WmsPostingStatus | ''>('');
  const [search, setSearch] = useState('');
  const list = useApi(() => warehouseApi.listPostings({ search, ...(module ? { module } : {}), ...(status ? { status } : {}) }), [search, module, status]);
  return (
    <div className="wms-pad">
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('number')}, ${p('документ, счёт', 'hujjat, hisob', 'document, account')}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select<WmsModule> value={module} onChange={setModule} placeholder={`${p('Контур', 'Kontur', 'Area')}: ${t('all')}`} options={(['warehouse', 'mbp', 'assets', 'terminals'] as const).map((m) => ({ value: m, label: t(tk('warehouse_mod_', m)) }))} />
        <Select<WmsPostingStatus> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={(['unsigned', 'sending', 'confirmed', 'error', 'queued', 'reversed'] as const).map((s) => ({ value: s, label: t(tk('warehouse_pst_', s)) }))} />
        <ExportButton filename={p('Журнал проводок', 'Provodkalar jurnali', 'Posting journal')} sheets={() => [{ name: p('Проводки', 'Provodkalar', 'Postings'), totalLabel: t('total'), columns: [{ header: '№' }, { header: t('date') }, { header: p('Документ', 'Hujjat', 'Document') }, { header: p('Дт', 'Dt', 'Dr') }, { header: p('Кт', 'Kt', 'Cr') }, { header: p('МВЗ', 'XMM', 'CC') }, { header: t('amount'), format: 'money', total: true }, { header: 'iABS' }], rows: (list.data ?? []).flatMap((r) => r.entries.map((e) => [r.number, r.date, r.docNumber, e.debit, e.credit, e.costCenterId, e.amount, t(tk('warehouse_pst_', r.status))])) }]} />
      </FilterBar>
      {list.data && <PostingsTable rows={list.data} />}
    </div>
  );
}

export function MonitoringTab() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const can = useCan();
  const toast = useToast();
  const err = useWmsError('warehouse_err_');
  const runs = useApi(() => warehouseApi.listMonitoringRuns());
  const recon = useApi(() => warehouseApi.reconciliation());
  const unf = useApi(() => warehouseApi.listUnfinished());
  const last = runs.data?.[0];
  return (
    <div className="wms-pad">
      <div className="grid grid-4">
        <Stat label={p('Расхождения с iABS', 'iABS bilan farqlar', 'iABS discrepancies')} value={recon.data?.filter((r) => r.diff).length ?? '—'} tone={recon.data?.some((r) => r.diff) ? 'alert' : undefined} />
        <Stat label={p('Незавершённые операции', 'Tugallanmagan operatsiyalar', 'Unfinished operations')} value={unf.data?.length ?? '—'} />
        <Stat label={p('Последняя проверка', 'Oxirgi tekshiruv', 'Last check')} value={last ? formatDateTime(last.at) : '—'} foot={last ? (last.auto ? p('автоматически (ежедневно)', 'avtomatik (har kuni)', 'automatic (daily)') : lk.user(last.by)?.fullName) : undefined} />
        <Stat label={p('Сроки / залежалые', 'Muddatlar / uzoq saqlangan', 'Expiry / slow-moving')} value={last ? `${last.expiring} / ${last.stale}` : '—'} />
      </div>
      <Card title={p('Сверка складских остатков и МБП с балансом iABS', 'Ombor qoldiqlari va MBPni iABS balansi bilan solishtirish', 'Warehouse and LVI vs iABS balance')} actions={can('warehouse', 'edit') ? <Button type="primary" icon="refresh" onClick={() => warehouseApi.runMonitoring(user).then((r) => toast(`${p('Проверка выполнена', 'Tekshiruv bajarildi', 'Check completed')}: ${r.discrepancies} ${p('расхождений', 'farq', 'discrepancies')}`)).catch((e) => toast(err(e)))}>{p('Запустить проверку', 'Tekshiruvni boshlash', 'Run check')}</Button> : undefined}>
        <ReconTable rows={recon.data} loading={recon.loading} />
        <div className="wms-note" style={{ marginTop: 8 }}>{p('Остаток iABS — сумма подтверждённых iABS проводок. Неподтверждённые/ошибочные проводки дают расхождение; повторите передачу на вкладке «Проводки».', 'iABS qoldig‘i — tasdiqlangan provodkalar yig‘indisi. Tasdiqlanmagan/xato provodkalar farq beradi; «Provodkalar» yorlig‘ida qayta yuboring.', 'The iABS balance is the sum of confirmed postings. Unconfirmed or failed postings cause differences; resend them on the Postings tab.')}</div>
      </Card>
      <Card title={p('Незавершённые операции', 'Tugallanmagan operatsiyalar', 'Unfinished operations')} flush>
        <DataTable rows={unf.data} loading={unf.loading} rowKey={(u) => u.id} emptyText={p('Незавершённых операций нет', 'Tugallanmagan operatsiyalar yo‘q', 'No unfinished operations')} columns={[
          { header: p('Тип', 'Turi', 'Type'), render: (u) => t(tk('warehouse_unf_', u.type)) },
          { header: t('number'), render: (u) => <Link to={u.link} className="doc-num">{u.number}</Link> },
          { header: t('status'), render: (u) => <StatusBadge prefix={u.type === 'receipt' ? 'warehouse_rcst_' : u.type === 'issue' ? 'warehouse_isst_' : u.type === 'writeoff' ? 'warehouse_wost_' : 'warehouse_invst_'} status={u.status} /> },
          { header: p('С', 'Dan', 'Since'), render: (u) => formatDateTime(u.since) },
        ]} />
      </Card>
      <Card title={p('Журнал ежедневных проверок', 'Kundalik tekshiruvlar jurnali', 'Daily check log')} flush>
        <DataTable rows={runs.data} loading={runs.loading} rowKey={(r) => r.id} columns={[
          { header: p('Время', 'Vaqt', 'Time'), render: (r) => formatDateTime(r.at) },
          { header: p('Запуск', 'Ishga tushirish', 'Run'), render: (r) => (r.auto ? p('автоматически', 'avtomatik', 'automatic') : lk.user(r.by)?.fullName ?? r.by) },
          { header: p('Расхождения', 'Farqlar', 'Discrepancies'), align: 'right', render: (r) => (r.discrepancies ? <b style={{ color: 'var(--danger)' }}>{r.discrepancies}</b> : 0) },
          { header: p('Незавершённые', 'Tugallanmagan', 'Unfinished'), align: 'right', render: (r) => r.unfinished },
          { header: p('Ниже минимума', 'Minimumdan past', 'Below minimum'), align: 'right', render: (r) => r.lowStock },
          { header: 'iABS', render: (r) => (r.exchangeId ? <GuardedLink to="/integrations">{r.exchangeId}</GuardedLink> : '—') },
        ]} />
      </Card>
    </div>
  );
}
