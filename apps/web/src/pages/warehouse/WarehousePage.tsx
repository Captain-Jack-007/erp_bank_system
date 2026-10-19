// Склад (ТЗ 4.2.4): оболочка модуля с вкладками, остатки, журнал движений, склады, дашборд, быстрая операция.
import { useEffect, useState } from 'react';
import {
  canPostWarehouse, canRequestWarehouse, currencyLabel, formatDateTime, formatMoney, formatMoneyShort, formatNumber, tk, warehouseApi, WAREHOUSE_SETTINGS,
  type WarehouseCategory, type WarehouseItem, type WarehouseMovement, type WarehouseMovementType,
} from '@xb/shared';
import { Badge, BarChart, Button, Card, Checkbox, DataTable, Field, FilterBar, Input, LineChart, Modal, PageHeader, Select, Stat, StatusBadge, Tabs, useToast, type Column } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { CostCenterSelect, useOrg, useP, useQueryParam, useWmsError } from './wmsShared';
import { CardsTab } from './whCards';
import { ReceiptsTab } from './whReceipts';
import { IssuesTab } from './whIssues';
import { WriteoffsTab } from './whWriteoffs';
import { InventoryTab } from './whInventory';
import { MbpTab } from './whMbp';
import { BatchesTab, MonitoringTab, PostingsTab } from './whMonitoring';
import { ReportsTab } from './whReports';
import { SettingsTab } from './whSettings';

const CATEGORIES: WarehouseCategory[] = ['office', 'it', 'forms', 'household', 'security', 'mbp', 'fixed'];
const TYPES: WarehouseMovementType[] = ['receipt', 'issue', 'transfer', 'writeoff'];
export type WarehouseTab = 'dashboard' | 'stock' | 'cards' | 'receipts' | 'issues' | 'writeoffs' | 'batches' | 'inventory' | 'mbp' | 'movements' | 'postings' | 'monitoring' | 'reports' | 'locations' | 'settings';
const TAB_PATH: Record<WarehouseTab, string> = {
  dashboard: '/warehouse/dashboard', stock: '/warehouse', cards: '/warehouse/cards', receipts: '/warehouse/receipts', issues: '/warehouse/issues', writeoffs: '/warehouse/writeoffs', batches: '/warehouse/batches',
  inventory: '/warehouse/inventory', mbp: '/warehouse/mbp', movements: '/warehouse/movements', postings: '/warehouse/postings', monitoring: '/warehouse/monitoring', reports: '/warehouse/reports', locations: '/warehouse/locations', settings: '/warehouse/settings',
};

export function WarehousePage({ tab: initial = 'stock' }: { tab?: WarehouseTab }) {
  const { t, lang } = useSession();
  const p = useP();
  const user = useUser();
  const can = useCan();
  const canPost = can('warehouse', 'edit') && canPostWarehouse(user);
  const canRequest = canRequestWarehouse(user);
  const [tab, setTab] = useState<WarehouseTab>(initial);
  const [creating, setCreating] = useState<WarehouseItem | true | null>(null);
  const stats = useApi(() => warehouseApi.getStats());
  const s = stats.data;
  useEffect(() => setTab(initial), [initial]);
  useEffect(() => {
    void warehouseApi.ensureDailyMonitoring(user);
  }, [user.id]);

  const tabs: { value: WarehouseTab; label: string; count?: number }[] = [
    { value: 'dashboard', label: p('Обзор', 'Umumiy', 'Overview') },
    { value: 'stock', label: t('warehouse_stock') },
    { value: 'cards', label: p('Карточки', 'Kartochkalar', 'Item cards') },
    { value: 'receipts', label: p('Поступления', 'Kirimlar', 'Receipts') },
    { value: 'issues', label: p('Выдача', 'Berish', 'Issues'), ...(s?.pendingIssues ? { count: s.pendingIssues } : {}) },
    { value: 'writeoffs', label: p('Списание', 'Hisobdan chiqarish', 'Write-offs') },
    { value: 'batches', label: p('Партии (FIFO)', 'Partiyalar (FIFO)', 'Batches (FIFO)'), ...(s?.expiring ? { count: s.expiring } : {}) },
    { value: 'inventory', label: p('Инвентаризация', 'Inventarizatsiya', 'Stocktaking') },
    { value: 'mbp', label: p('Учёт МБП', 'MBP hisobi', 'Low-value items') },
    { value: 'movements', label: t('warehouse_movements') },
    { value: 'postings', label: p('Проводки', 'Provodkalar', 'Postings'), ...(s?.postingsError ? { count: s.postingsError } : {}) },
    { value: 'monitoring', label: p('Мониторинг', 'Monitoring', 'Monitoring'), ...(s?.unfinished ? { count: s.unfinished } : {}) },
    { value: 'reports', label: p('Отчёты', 'Hisobotlar', 'Reports') },
    { value: 'locations', label: t('warehouse_locations') },
  ];

  return (
    <>
      <PageHeader
        title={t('warehouse_title')}
        subtitle={t('warehouse_subtitle')}
        actions={
          <>
            {can('warehouse', 'view') && (
              <Button icon="key" onClick={() => navigate('/warehouse/settings')}>
                {p('Настройки склада', 'Ombor sozlamalari', 'Warehouse settings')}
              </Button>
            )}
            {canRequest && (
              <Button icon="inbox" onClick={() => navigate('/warehouse/issues/new')}>
                {p('Заявка на выдачу', 'Berish arizasi', 'Issue request')}
              </Button>
            )}
            {canPost && (
              <Button icon="receipt" onClick={() => navigate('/warehouse/receipts/new')}>
                {p('Поступление', 'Kirim', 'Receipt')}
              </Button>
            )}
            {canPost && (
              <Button type="primary" icon="plus" onClick={() => setCreating(true)}>
                {t('warehouse_newMovement')}
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={t('warehouse_items')} value={s?.items ?? '—'} icon="box" tone="accent" foot={s ? `${p('В резерве', 'Zaxirada', 'Reserved')}: ${formatMoneyShort(s.reservedValue, lang)}` : undefined} />
        <Stat label={t('warehouse_value')} value={s ? formatMoneyShort(s.stockValue, lang) : '—'} foot={currencyLabel()} icon="wallet" />
        <Stat label={t('warehouse_low')} value={s?.lowStock ?? '—'} tone={s?.lowStock ? 'alert' : undefined} icon="alert" foot={s?.lowStock ? t('warehouse_lowAlert') : undefined} />
        <Stat label={t('warehouse_movesMonth')} value={s?.movementsMonth ?? '—'} icon="chart" foot={s ? `${p(`Срок годности ≤ ${WAREHOUSE_SETTINGS.expiryWarnDays} дн.`, `Muddat ≤ ${WAREHOUSE_SETTINGS.expiryWarnDays} kun`, `Expiry ≤ ${WAREHOUSE_SETTINGS.expiryWarnDays} days`)}: ${s.expiring} · ${p('залежалые', 'uzoq saqlangan', 'slow-moving')}: ${s.stale}` : undefined} />
      </div>
      <Card flush>
        <Tabs<WarehouseTab>
          value={tab}
          onChange={(v) => {
            setTab(v);
            navigate(TAB_PATH[v]);
          }}
          items={tabs}
        />
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'stock' && <StockTable onAction={canPost ? (item) => setCreating(item) : undefined} />}
        {tab === 'cards' && <CardsTab />}
        {tab === 'receipts' && <ReceiptsTab />}
        {tab === 'issues' && <IssuesTab />}
        {tab === 'writeoffs' && <WriteoffsTab />}
        {tab === 'batches' && <BatchesTab />}
        {tab === 'inventory' && <InventoryTab />}
        {tab === 'mbp' && <MbpTab />}
        {tab === 'movements' && <MovementsTable />}
        {tab === 'postings' && <PostingsTab />}
        {tab === 'monitoring' && <MonitoringTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'locations' && <Locations />}
        {tab === 'settings' && <SettingsTab />}
      </Card>
      {creating && <MovementModal item={creating === true ? undefined : creating} onClose={() => setCreating(null)} />}
    </>
  );
}

function Dashboard() {
  const { t, lang, loc } = useSession();
  const p = useP();
  const d = useApi(() => warehouseApi.getDashboard());
  const x = d.data;
  if (!x) return <div className="wms-pad"><div className="skeleton" style={{ width: '60%' }} /></div>;
  return (
    <div className="wms-pad">
      <div className="grid grid-4">
        <Stat label={t('warehouse_value')} value={formatMoneyShort(x.stockValue, lang)} foot={currencyLabel()} />
        <Stat label={p('Оборачиваемость, раз/год', 'Aylanuvchanlik, marta/yil', 'Turnover, times/year')} value={x.turnover} foot={p('по расходу за 90 дней', '90 kunlik sarf bo‘yicha', 'by 90-day outflow')} />
        <Stat label={p('Незавершённые операции', 'Tugallanmagan operatsiyalar', 'Unfinished operations')} value={x.unfinished.length} tone={x.unfinished.length ? 'alert' : undefined} />
        <Stat label={p('Проводки сегодня (подтверждено)', 'Bugungi provodkalar (tasdiqlangan)', 'Postings today (confirmed)')} value={`${x.postings.todayConfirmed} / ${x.postings.todayTotal}`} foot={x.postings.error ? `${p('ошибок', 'xatolar', 'errors')}: ${x.postings.error}` : undefined} />
      </div>
      <div className="wms-split">
        <Card title={p('Движение запасов по месяцам', 'Oylar bo‘yicha zaxiralar harakati', 'Stock movements by month')}>
          <LineChart
            labels={x.months}
            series={[
              { name: t('warehouse_mv_receipt'), values: x.receipts },
              { name: t('warehouse_mv_issue'), values: x.issues },
              { name: t('warehouse_mv_writeoff'), values: x.writeoffs },
            ]}
            format={(n) => formatMoneyShort(n, lang)}
          />
        </Card>
        <Card title={p('Запасы по складам', 'Omborlar bo‘yicha zaxiralar', 'Stock by warehouse')}>
          <BarChart data={x.byWarehouse.map((w) => ({ label: w.location.code, values: [w.value] }))} series={[{ name: t('warehouse_value') }]} format={(n) => formatMoneyShort(n, lang)} />
        </Card>
      </div>
      <Card title={t('warehouse_byCategory')}>
        <BarChart data={x.byGroup.filter((g) => g.value > 0).map((g) => ({ label: g.group.code, values: [g.value] }))} series={[{ name: t('warehouse_value') }]} format={(n) => formatMoneyShort(n, lang)} />
        <div className="wms-note">{x.byGroup.map((g) => `${g.group.code} — ${loc(g.group.name)}`).join(' · ')}</div>
      </Card>
    </div>
  );
}

function StockTable({ onAction }: { onAction?: (item: WarehouseItem) => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('warehouse_err_');
  const [search, setSearch] = useState(useQueryParam('q'));
  const [wh, setWh] = useState(useQueryParam('wh'));
  const [cat, setCat] = useState<WarehouseCategory | ''>('');
  const [low, setLow] = useState(false);
  const [limits, setLimits] = useState<WarehouseItem | null>(null);
  const locations = useApi(() => warehouseApi.listLocations());
  const items = useApi(() => warehouseApi.listItems({ search, lowOnly: low, ...(wh ? { warehouseId: wh } : {}), ...(cat ? { category: cat } : {}) }), [search, wh, cat, low]);
  const whName = (id: string) => locations.data?.find((l) => l.id === id)?.code ?? id;

  const columns: Column<WarehouseItem>[] = [
    { header: t('warehouse_sku'), render: (i) => <Link to={`/warehouse/cards/${i.cardId}`} className="doc-num">{i.sku}</Link> },
    { header: t('warehouse_item'), render: (i) => (<>{i.name}<div className="sub">{t(tk('warehouse_cat_', i.category))}</div></>) },
    { header: t('warehouse_warehouse'), render: (i) => <span className="muted">{whName(i.warehouseId)}</span> },
    { header: t('warehouse_qty'), align: 'right', render: (i) => <b style={i.qty < i.minQty ? { color: 'var(--danger)' } : undefined}>{formatNumber(i.qty)} {i.unit}</b> },
    { header: p('Резерв / доступно', 'Zaxira / mavjud', 'Reserved / available'), align: 'right', render: (i) => <span className="muted">{formatNumber(i.reserved)} / {formatNumber(i.qty - i.reserved)}</span> },
    { header: t('warehouse_min'), align: 'right', render: (i) => <span className="muted">{formatNumber(i.minQty)}{i.limitQty ? ` · ${p('лимит', 'limit', 'limit')} ${formatNumber(i.limitQty)}` : ''}</span> },
    { header: t('warehouse_unitCost'), align: 'right', render: (i) => formatMoney(i.unitCost) },
    { header: t('warehouse_sum'), align: 'right', render: (i) => formatMoney(i.qty * i.unitCost) },
    { header: t('status'), render: (i) => <StatusBadge prefix="warehouse_status_" status={i.qty < i.minQty ? 'low' : 'ok'} /> },
    ...(onAction
      ? [
          {
            header: '',
            render: (i: WarehouseItem) => (
              <span className="wms-row" style={{ flexWrap: 'nowrap' }}>
                <Button size="small" icon="plus" title={t('warehouse_newMovement')} onClick={() => onAction(i)} />
                <Button size="small" icon="alert" title={p('Мин. запас и лимит', 'Min. zaxira va limit', 'Min. stock and limit')} onClick={() => setLimits(i)} />
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('warehouse_sku')}, ${t('warehouse_item').toLowerCase()}, EAN`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={wh} onChange={setWh} placeholder={`${t('warehouse_warehouse')}: ${t('all')}`} options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        <Select<WarehouseCategory> value={cat} onChange={setCat} placeholder={`${t('warehouse_category')}: ${t('all')}`} options={CATEGORIES.map((c) => ({ value: c, label: t(tk('warehouse_cat_', c)) }))} />
        <Checkbox checked={low} onChange={setLow}>{t('warehouse_lowOnly')}</Checkbox>
        <ExportButton
          filename={p('Остатки склада', 'Ombor qoldiqlari', 'Warehouse stock')}
          rows={items.data ?? []}
          columns={[
            { header: t('warehouse_sku'), value: (i) => i.sku },
            { header: t('warehouse_item'), value: (i) => i.name },
            { header: t('warehouse_warehouse'), value: (i) => whName(i.warehouseId) },
            { header: t('warehouse_qty'), value: (i) => i.qty, format: 'integer', total: true },
            { header: p('Резерв', 'Zaxira', 'Reserved'), value: (i) => i.reserved, format: 'integer' },
            { header: t('warehouse_min'), value: (i) => i.minQty, format: 'integer' },
            { header: t('warehouse_unitCost'), value: (i) => i.unitCost, format: 'money' },
            { header: t('warehouse_sum'), value: (i) => i.qty * i.unitCost, format: 'money', total: true },
          ]}
        />
      </FilterBar>
      <DataTable rows={items.data} loading={items.loading} rowKey={(i) => i.id} columns={columns} />
      {limits && <LimitsModal item={limits} onClose={() => setLimits(null)} onSave={(min, lim) => warehouseApi.setLimits(limits.id, min, lim, user).then(() => { toast(t('saved')); setLimits(null); }).catch((e) => toast(err(e)))} />}
    </>
  );
}

function LimitsModal({ item, onClose, onSave }: { item: WarehouseItem; onClose: () => void; onSave: (min: number, limit: number | undefined) => void }) {
  const { t } = useSession();
  const p = useP();
  const [min, setMin] = useState(String(item.minQty));
  const [limit, setLimit] = useState(item.limitQty ? String(item.limitQty) : '');
  return (
    <Modal title={`${item.sku} · ${p('Минимальный запас и лимит', 'Minimal zaxira va limit', 'Minimum stock and limit')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" onClick={() => onSave(Number(min), limit ? Number(limit) : undefined)}>{t('save')}</Button></>}>
      <Field label={t('warehouse_min')} required hint={p('При достижении — уведомление заведующему складом и отделу закупок', 'Yetganda — ombor mudiri va xarid bo‘limiga bildirishnoma', 'When reached — notify warehouse manager and procurement')}>
        <Input type="number" value={min} onChange={(e) => setMin(e.target.value)} />
      </Field>
      <Field label={p('Лимит ходового товара', 'Tez ketadigan tovar limiti', 'Fast-mover limit')} hint={p('При доступном остатке ≤ лимита создаётся черновик заявки на повторную закупку', 'Mavjud qoldiq ≤ limit bo‘lsa, takroriy xarid arizasi qoralamasi yaratiladi', 'When available ≤ limit a draft re-purchase request is created')}>
        <Input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} />
      </Field>
    </Modal>
  );
}

function MovementsTable() {
  const { t, loc } = useSession();
  const p = useP();
  const lk = useLookups();
  const org = useOrg();
  const [search, setSearch] = useState(useQueryParam('q'));
  const [type, setType] = useState<WarehouseMovementType | ''>('');
  const [wh, setWh] = useState('');
  const items = useApi(() => warehouseApi.listItems({ includeEmpty: true }));
  const locations = useApi(() => warehouseApi.listLocations());
  const moves = useApi(() => warehouseApi.listMovements({ search, ...(type ? { type } : {}), ...(wh ? { warehouseId: wh } : {}) }), [search, type, wh]);
  const item = (id: string) => items.data?.find((i) => i.id === id);
  const whName = (id?: string) => (id ? locations.data?.find((l) => l.id === id)?.code ?? id : '');
  const tone = (m: WarehouseMovementType) => (m === 'receipt' ? 'ok' : m === 'writeoff' ? 'danger' : m === 'transfer' ? 'info' : 'warn');
  const docLink = (m: WarehouseMovement) => (m.docType === 'receipt' ? `/warehouse/receipts/${m.docId}` : m.docType === 'issue' ? `/warehouse/issues/${m.docId}` : m.docType === 'writeoff' ? `/warehouse/writeoffs/${m.docId}` : m.docType === 'inventory' ? `/warehouse/inventory/${m.docId}` : undefined);

  const columns: Column<WarehouseMovement>[] = [
    { header: t('number'), render: (m) => (<><span className="doc-num">{m.number}</span>{m.docNumber && <div className="sub">{docLink(m) ? <Link to={docLink(m)!}>{m.docNumber}</Link> : m.docNumber}</div>}</>) },
    { header: t('date'), render: (m) => <span className="num muted">{formatDateTime(m.at)}</span> },
    { header: t('warehouse_movementType'), render: (m) => (<><Badge tone={tone(m.type)}>{t(tk('warehouse_mv_', m.type))}</Badge>{m.reversed && <div className="sub">{p('сторно', 'storno', 'reversed')}</div>}</>) },
    { header: t('warehouse_item'), render: (m) => (<>{item(m.itemId)?.name ?? m.itemId}<div className="sub">{item(m.itemId)?.sku}</div></>) },
    { header: t('warehouse_qty'), align: 'right', render: (m) => <b>{m.type === 'receipt' ? (m.qty > 0 ? '+' : '') : '−'}{formatNumber(m.qty)} {item(m.itemId)?.unit}</b> },
    { header: t('warehouse_sum'), align: 'right', render: (m) => formatMoney(m.amount) },
    {
      header: `${t('warehouse_warehouse')} / ${t('warehouse_recipient')}`,
      render: (m) => (
        <>
          {whName(m.warehouseId)}
          {m.toWarehouseId && <> → {whName(m.toWarehouseId)}</>}
          {m.departmentId && <> → {lk.department(m.departmentId) ? loc(lk.department(m.departmentId)!.name) : ''}</>}
          {m.counterpartyId && <div className="sub">{lk.counterparty(m.counterpartyId)?.name}</div>}
          {m.comment && <div className="sub">{m.comment}</div>}
        </>
      ),
    },
    { header: p('МВЗ', 'XMM', 'Cost center'), render: (m) => <span className="wms-mono" title={org.ccLabel(m.costCenterId)}>{org.ccCode(m.costCenterId)}</span> },
    { header: t('initiator'), render: (m) => <span className="muted">{lk.user(m.userId)?.fullName}</span> },
  ];
  return (
    <>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('number')}, ${t('warehouse_item').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select<WarehouseMovementType> value={type} onChange={setType} placeholder={`${t('warehouse_movementType')}: ${t('all')}`} options={TYPES.map((x) => ({ value: x, label: t(tk('warehouse_mv_', x)) }))} />
        <Select value={wh} onChange={setWh} placeholder={`${t('warehouse_warehouse')}: ${t('all')}`} options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        <ExportButton
          filename={p('Журнал движений', 'Harakatlar jurnali', 'Movement log')}
          rows={moves.data ?? []}
          columns={[
            { header: t('number'), value: (m) => m.number },
            { header: t('date'), value: (m) => m.at.slice(0, 10) },
            { header: t('warehouse_movementType'), value: (m) => t(tk('warehouse_mv_', m.type)) },
            { header: t('warehouse_item'), value: (m) => item(m.itemId)?.name ?? m.itemId },
            { header: t('warehouse_qty'), value: (m) => m.qty, format: 'integer' },
            { header: t('warehouse_sum'), value: (m) => m.amount, format: 'money', total: true },
            { header: p('МВЗ', 'XMM', 'Cost center'), value: (m) => org.ccCode(m.costCenterId) },
            { header: p('Документ', 'Hujjat', 'Document'), value: (m) => m.docNumber ?? '' },
          ]}
        />
      </FilterBar>
      <DataTable rows={moves.data} loading={moves.loading} rowKey={(m) => m.id} columns={columns} />
    </>
  );
}

function Locations() {
  const { t, lang } = useSession();
  const lk = useLookups();
  const org = useOrg();
  const p = useP();
  const locations = useApi(() => warehouseApi.listLocations());
  const items = useApi(() => warehouseApi.listItems());
  const all = items.data ?? [];
  const byCat = CATEGORIES.map((c) => ({ label: t(tk('warehouse_short_', c)), values: [all.filter((i) => i.category === c).reduce((s, i) => s + i.qty * i.unitCost, 0)] }));

  return (
    <div className="wms-pad">
      <div className="grid grid-3">
        {locations.data?.map((l) => {
          const mine = all.filter((i) => i.warehouseId === l.id);
          const lowCount = mine.filter((i) => i.qty < i.minQty).length;
          return (
            <div key={l.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span className="doc-num" style={{ color: 'var(--brand-700)', fontWeight: 600 }}>{l.code}</span>
                <Badge tone={l.kind === 'central' ? 'info' : 'muted'}>{t(tk('warehouse_kind_', l.kind))}</Badge>
              </div>
              <div style={{ fontWeight: 600 }}>{l.name}</div>
              <div className="muted small">{l.city} · {t('warehouse_manager')}: {lk.user(l.managerId)?.fullName}</div>
              <div className="muted small">{p('Закреплённый руководитель', 'Biriktirilgan rahbar', 'Assigned head')}: {lk.user(l.headId)?.fullName} · {p('МВЗ', 'XMM', 'CC')}: {org.ccCode(l.costCenterId)}</div>
              <div className="num" style={{ fontSize: 18, fontWeight: 700 }}>{formatMoneyShort(mine.reduce((s, i) => s + i.qty * i.unitCost, 0), lang)} {currencyLabel()}</div>
              <div className="small muted">
                {t('warehouse_positions')}: {mine.length} · {lowCount > 0 ? <span style={{ color: 'var(--danger)' }}>{lowCount} {t('warehouse_low').toLowerCase()}</span> : t('warehouse_status_ok')}
              </div>
              <div>
                <Button size="small" onClick={() => navigate(`/warehouse?wh=${l.id}`)}>{t('warehouse_showStock')}</Button>
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>{t('warehouse_byCategory')}</h3>
        <BarChart data={byCat} series={[{ name: t('warehouse_value') }]} format={(n) => formatMoneyShort(n, lang)} />
      </div>
    </div>
  );
}

/** Быстрая операция: приход (цена, партия, срок годности, накладная) или перемещение между складами. */
function MovementModal({ item, onClose }: { item?: WarehouseItem; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useWmsError('warehouse_err_');
  const items = useApi(() => warehouseApi.listItems({ includeEmpty: true }));
  const locations = useApi(() => warehouseApi.listLocations());
  const cards = useApi(() => warehouseApi.listCards());
  const [type, setType] = useState<'receipt' | 'transfer'>('receipt');
  const [itemId, setItemId] = useState(item?.id ?? '');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState(item ? String(item.unitCost) : '');
  const [expiry, setExpiry] = useState('');
  const [waybill, setWaybill] = useState('');
  const [to, setTo] = useState('');
  const [cp, setCp] = useState('');
  const [cc, setCc] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = items.data?.find((i) => i.id === itemId);
  const card = cards.data?.find((c) => c.id === selected?.cardId);
  const whName = (id: string) => locations.data?.find((l) => l.id === id)?.code ?? '';
  const loc = locations.data?.find((l) => l.id === selected?.warehouseId);

  async function submit() {
    const n = Number(qty);
    if (!selected || !qty || (type === 'transfer' && !to)) {
      setError(t('formRequired'));
      return;
    }
    if (!(n > 0) || !Number.isInteger(n)) {
      setError(t('warehouse_qtyInvalid'));
      return;
    }
    if (type === 'transfer' && n > selected.qty - selected.reserved) {
      setError(t('warehouse_insufficient'));
      return;
    }
    setBusy(true);
    try {
      const mv = await warehouseApi.createMovement(
        {
          type, itemId: selected.id, qty: n,
          ...(type === 'transfer' ? { toWarehouseId: to } : { unitCost: Number(price), ...(expiry ? { expiryDate: expiry } : {}), ...(cp ? { counterpartyId: cp } : {}), ...(waybill.trim() ? { basis: waybill.trim() } : {}), ...(cc ? { costCenterId: cc } : {}) }),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
        user,
      );
      toast(`${mv.number}: ${t('warehouse_posted')}`);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('warehouse_newMovement')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={submit}>{t('save')}</Button></>}>
      <Field label={t('warehouse_movementType')} required hint={p('Выдача и списание оформляются документами: «Заявка на выдачу», «Акт списания»', 'Berish va hisobdan chiqarish hujjatlar bilan: «Berish arizasi», «Dalolatnoma»', 'Issues and write-offs are documents: “Issue request”, “Write-off act”')}>
        <Select<'receipt' | 'transfer'> value={type} onChange={(v) => { setType(v); setError(''); }} options={[{ value: 'receipt', label: t('warehouse_mv_receipt') }, { value: 'transfer', label: t('warehouse_mv_transfer') }]} />
      </Field>
      <Field label={t('warehouse_item')} required hint={selected ? `${t('warehouse_qty')}: ${formatNumber(selected.qty)} ${selected.unit} · ${p('доступно', 'mavjud', 'available')} ${formatNumber(selected.qty - selected.reserved)} · ${whName(selected.warehouseId)}` : undefined}>
        <Select value={itemId} onChange={(v) => { setItemId(v); setTo(''); setError(''); const it = items.data?.find((i) => i.id === v); if (it) setPrice(String(it.unitCost)); }} placeholder="—" options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.sku} · ${i.name} (${whName(i.warehouseId)})` }))} />
      </Field>
      <Field label={`${t('qty')}${selected ? `, ${selected.unit}` : ''}`} required>
        <Input type="number" value={qty} onChange={(e) => { setQty(e.target.value); setError(''); }} />
      </Field>
      {type === 'transfer' && (
        <Field label={t('warehouse_toWarehouse')} required>
          <Select value={to} onChange={setTo} placeholder="—" options={(locations.data ?? []).filter((l) => l.id !== selected?.warehouseId).map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
      )}
      {type === 'receipt' && (
        <>
          <Field label={t('warehouse_supplier')}>
            <Select value={cp} onChange={setCp} placeholder="—" options={lk.counterparties.filter((c) => !c.blocked).map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label={p('Цена за ед. (без НДС)', 'Birlik narxi (QQSsiz)', 'Unit price (excl. VAT)')} required>
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label={p('Товарная накладная №', 'Yuk xati №', 'Waybill no.')}>
            <Input value={waybill} onChange={(e) => setWaybill(e.target.value)} />
          </Field>
          {card?.trackExpiry && (
            <Field label={p('Срок годности партии', 'Partiya yaroqlilik muddati', 'Batch expiry date')} required>
              <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </Field>
          )}
          <Field label={p('МВЗ', 'XMM', 'Cost center')} hint={p('По умолчанию — МВЗ склада', 'Standart — ombor XMM', 'Default — warehouse cost center')}>
            <CostCenterSelect value={cc || loc?.costCenterId || ''} onChange={setCc} />
          </Field>
        </>
      )}
      <Field label={t('comment')} error={error}>
        <Input value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  );
}
