// Склад: инвентаризация ТМЗ и МБП — комиссия, подсчёт по списку или сканированием штрихкода/QR (сканер-клавиатура,
// офлайн-очередь с синхронизацией), сличительная ведомость, утверждение итогов с корректировкой остатков и проводками.
import { useState } from 'react';
import { formatDate, formatMoney, formatNumber, warehouseApi, type WarehouseInventory, type WarehouseInventoryScope } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, Stat, StatusBadge, Switch, Timeline, useToast, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { Kv, OrgUnitSelect, PostingsTable, UserSelect, UsersPicker, useOrg, useP, useWmsError } from './wmsShared';

export const INV_TONE: Record<WarehouseInventory['status'], Tone> = { counting: 'info', completed: 'warn', approved: 'ok' };

export function InventoryTab() {
  const { t } = useSession();
  const p = useP();
  const can = useCan();
  const org = useOrg();
  const [scope, setScope] = useState<WarehouseInventoryScope | ''>('');
  const [creating, setCreating] = useState(false);
  const list = useApi(() => warehouseApi.listInventories(scope || undefined), [scope]);
  const locs = useApi(() => warehouseApi.listLocations());
  const cols: Column<WarehouseInventory>[] = [
    { header: t('number'), render: (v) => (<><span className="doc-num">{v.number}</span><div className="sub">{v.scope === 'tmz' ? 'ТМЗ' : 'МБП'} · {v.method === 'scan' ? p('сканирование', 'skanerlash', 'scanning') : p('по списку', 'ro‘yxat bo‘yicha', 'by list')}</div></>) },
    { header: t('date'), render: (v) => formatDate(v.date) },
    { header: p('Объект', 'Obyekt', 'Scope'), render: (v) => (v.warehouseId ? locs.data?.find((l) => l.id === v.warehouseId)?.name : org.unitName(v.orgUnitKey)) },
    { header: p('Расхождения', 'Farqlar', 'Differences'), align: 'right', render: (v) => v.lines.filter((l) => l.actualQty !== undefined && l.actualQty !== l.expectedQty).length },
    { header: t('status'), render: (v) => <StatusBadge prefix="warehouse_invst_" status={v.status} tone={INV_TONE[v.status]} /> },
  ];
  return (
    <>
      <FilterBar>
        <Select<WarehouseInventoryScope> value={scope} onChange={setScope} placeholder={`${p('Объект учёта', 'Hisob obyekti', 'Scope')}: ${t('all')}`} options={[{ value: 'tmz', label: p('ТМЗ на складе', 'Ombordagi TMZ', 'Stock in warehouse') }, { value: 'mbp', label: p('МБП в эксплуатации', 'Foydalanishdagi MBP', 'LVI in use') }]} />
        {can('warehouse', 'edit') && <Button type="primary" icon="plus" onClick={() => setCreating(true)}>{p('Новая инвентаризация', 'Yangi inventarizatsiya', 'New stocktaking')}</Button>}
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(v) => v.id} columns={cols} onRowClick={(v) => navigate(`/warehouse/inventory/${v.id}`)} />
      {creating && <CreateInventory onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateInventory({ onClose }: { onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('warehouse_err_');
  const locs = useApi(() => warehouseApi.listLocations());
  const [scope, setScope] = useState<WarehouseInventoryScope>('tmz');
  const [wh, setWh] = useState('wh1');
  const [unit, setUnit] = useState('');
  const [method, setMethod] = useState<'scan' | 'list'>('scan');
  const [chair, setChair] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [order, setOrder] = useState('');
  const [error, setError] = useState('');
  async function save() {
    setError('');
    try {
      const v = await warehouseApi.createInventory({ scope, ...(scope === 'tmz' ? { warehouseId: wh } : { orgUnitKey: unit }), method, commission: { chairmanId: chair, memberIds: members, orderNo: order } }, user);
      toast(`${v.number}: ${t('saved')}`);
      onClose();
      navigate(`/warehouse/inventory/${v.id}`);
    } catch (e) {
      setError(err(e));
    }
  }
  return (
    <Modal title={p('Инвентаризация: создание комиссии', 'Inventarizatsiya: komissiya tuzish', 'Stocktaking: commission')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" onClick={save}>{p('Начать', 'Boshlash', 'Start')}</Button></>}>
      <Field label={p('Объект учёта', 'Hisob obyekti', 'Scope')} required><Select<WarehouseInventoryScope> value={scope} onChange={setScope} options={[{ value: 'tmz', label: p('ТМЗ на складе', 'Ombordagi TMZ', 'Stock in warehouse') }, { value: 'mbp', label: p('МБП в эксплуатации', 'Foydalanishdagi MBP', 'LVI in use') }]} /></Field>
      {scope === 'tmz' ? <Field label={t('warehouse_warehouse')} required><Select value={wh} onChange={setWh} options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Field> : <Field label={p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit')} required><OrgUnitSelect value={unit} onChange={setUnit} /></Field>}
      <Field label={p('Способ', 'Usul', 'Method')} required><Select<'scan' | 'list'> value={method} onChange={setMethod} options={[{ value: 'scan', label: p('Сканирование штрихкодов / QR', 'Shtrixkod / QR skanerlash', 'Barcode / QR scanning') }, { value: 'list', label: p('По списку', 'Ro‘yxat bo‘yicha', 'By list') }]} /></Field>
      <Field label={p('Приказ №', 'Buyruq №', 'Order no.')} required><Input value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
      <Field label={p('Председатель комиссии', 'Komissiya raisi', 'Chairman')} required><UserSelect value={chair} onChange={setChair} /></Field>
      <Field label={p('Члены комиссии (не менее двух)', 'Komissiya a’zolari (kamida ikki)', 'Members (at least two)')} required error={error}><UsersPicker value={members} onChange={setMembers} exclude={chair ? [chair] : []} /></Field>
    </Modal>
  );
}

type QueueEntry = { refId?: string; code?: string; actualQty?: number };
const qKey = (id: string) => `xb.wms.offline.${id}`;
function readQueue(id: string): QueueEntry[] {
  try {
    return JSON.parse(window.localStorage.getItem(qKey(id)) ?? '[]') as QueueEntry[];
  } catch {
    return [];
  }
}
function writeQueue(id: string, q: QueueEntry[]): void {
  try {
    if (q.length) window.localStorage.setItem(qKey(id), JSON.stringify(q));
    else window.localStorage.removeItem(qKey(id));
  } catch {
    /* хранилище недоступно — очередь только в памяти */
  }
}

export function InventoryDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const can = useCan();
  const org = useOrg();
  const err = useWmsError('warehouse_err_');
  const d = useApi(() => warehouseApi.getInventory(id), [id]);
  const items = useApi(() => warehouseApi.listItems({ includeEmpty: true }));
  const mbp = useApi(() => warehouseApi.listMbp({ status: 'all' }));
  const cards = useApi(() => warehouseApi.listCards({ includeArchived: true }));
  const locs = useApi(() => warehouseApi.listLocations());
  const [code, setCode] = useState('');
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<QueueEntry[]>(() => readQueue(id));
  const [edits, setEdits] = useState<Record<string, string>>({});
  if (d.loading && !d.data) return <Card><Loading /></Card>;
  const v = d.data;
  if (!v) return <Card><Empty text={t('empty')} /></Card>;
  const members = [v.commission.chairmanId, ...v.commission.memberIds];
  const canCount = v.status === 'counting' && (can('warehouse', 'edit') || members.includes(user.id));
  const label = (refId: string) => {
    if (v.scope === 'tmz') {
      const i = items.data?.find((x) => x.id === refId);
      const c = cards.data?.find((x) => x.id === i?.cardId);
      return { title: i ? `${i.sku} · ${i.name}` : refId, code: c?.barcode ?? '', unit: i?.unit ?? '' };
    }
    const m = mbp.data?.find((x) => x.id === refId);
    return { title: m ? `${m.number} · ${m.name}` : refId, code: m?.barcode ?? '', unit: m?.unit ?? '' };
  };
  const push = async (entries: QueueEntry[]) => {
    if (offline) {
      const q = [...queue, ...entries];
      setQueue(q);
      writeQueue(id, q);
      toast(p('Сохранено офлайн — синхронизируйте при появлении связи', 'Oflayn saqlandi — aloqa paydo bo‘lganda sinxronlang', 'Saved offline — sync when online'));
      return;
    }
    try {
      const r = await warehouseApi.countInventory(id, entries, user);
      if (r.unknown) toast(p('Код не найден в ведомости', 'Kod qaydnomada topilmadi', 'Code not found in the sheet'));
    } catch (e) {
      toast(err(e));
    }
  };
  const sync = async () => {
    try {
      const r = await warehouseApi.countInventory(id, queue, user);
      setQueue([]);
      writeQueue(id, []);
      toast(`${p('Синхронизировано', 'Sinxronlandi', 'Synced')}: ${queue.length}${r.unknown ? ` · ${p('не найдено', 'topilmadi', 'unknown')}: ${r.unknown}` : ''}`);
    } catch (e) {
      toast(err(e));
    }
  };
  const diffs = v.lines.map((l) => ({ ...l, diff: (l.actualQty ?? 0) - l.expectedQty }));
  const shortage = diffs.filter((l) => l.actualQty !== undefined && l.diff < 0).reduce((s, l) => s - l.diff * l.unitCost, 0);
  const surplus = diffs.filter((l) => l.diff > 0).reduce((s, l) => s + l.diff * l.unitCost, 0);
  const counted = v.lines.filter((l) => l.actualQty !== undefined).length;
  const place = v.warehouseId ? locs.data?.find((l) => l.id === v.warehouseId)?.name : org.unitName(v.orgUnitKey);
  const cols: Column<(typeof diffs)[number]>[] = [
    { header: t('warehouse_item'), render: (l) => (<>{label(l.refId).title}<div className="sub wms-mono">{label(l.refId).code}</div></>) },
    { header: p('По учёту', 'Hisob bo‘yicha', 'Book'), align: 'right', render: (l) => `${formatNumber(l.expectedQty)} ${label(l.refId).unit}` },
    {
      header: p('Фактически', 'Haqiqatda', 'Actual'),
      render: (l) =>
        canCount ? (
          <span className="wms-row" style={{ flexWrap: 'nowrap' }}>
            <Input type="number" value={edits[l.refId] ?? (l.actualQty !== undefined ? String(l.actualQty) : '')} ariaLabel={`${p('Факт', 'Fakt', 'Actual')} ${label(l.refId).title}`} onChange={(e) => setEdits((x) => ({ ...x, [l.refId]: e.target.value }))} style={{ width: 90 }} />
            <Button size="small" icon="check" title={t('save')} onClick={() => void push([{ refId: l.refId, actualQty: Number(edits[l.refId] ?? l.actualQty ?? 0) }])} />
          </span>
        ) : l.actualQty !== undefined ? formatNumber(l.actualQty) : '—',
    },
    { header: p('Разница', 'Farq', 'Difference'), align: 'right', render: (l) => (l.actualQty === undefined ? '—' : l.diff ? <b style={{ color: l.diff < 0 ? 'var(--danger)' : 'var(--brand-700)' }}>{l.diff > 0 ? '+' : ''}{formatNumber(l.diff)}</b> : <Badge tone="ok">0</Badge>) },
    { header: t('amount'), align: 'right', render: (l) => (l.actualQty !== undefined && l.diff ? formatMoney(l.diff * l.unitCost) : '—') },
    { header: t('comment'), render: (l) => <span className="wms-note">{l.note ?? ''}</span> },
  ];
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('warehouse_title'), to: '/warehouse/inventory' }, { label: v.number }]}
        title={`${p('Инвентаризация', 'Inventarizatsiya', 'Stocktaking')} ${v.number}`}
        subtitle={`${v.scope === 'tmz' ? 'ТМЗ' : 'МБП'} · ${place ?? ''} · ${formatDate(v.date)}`}
        actions={
          <>
            <StatusBadge prefix="warehouse_invst_" status={v.status} tone={INV_TONE[v.status]} />
            {v.status === 'counting' && (can('warehouse', 'edit') || v.commission.chairmanId === user.id) && <Button type="primary" onClick={() => warehouseApi.completeInventory(v.id, user).then(() => toast(p('Сличительная ведомость сформирована', 'Solishtirma qaydnoma shakllandi', 'Count sheet created'))).catch((e) => toast(err(e)))}>{p('Сформировать сличительную ведомость', 'Solishtirma qaydnomani shakllantirish', 'Create count sheet')}</Button>}
            {v.status === 'completed' && (user.role === 'accountant' || user.role === 'admin' || v.commission.chairmanId === user.id) && <Button type="primary" icon="check" onClick={() => warehouseApi.approveInventory(v.id, user).then(() => toast(p('Итоги утверждены, остатки скорректированы', 'Natijalar tasdiqlandi, qoldiqlar tuzatildi', 'Approved, balances corrected'))).catch((e) => toast(err(e)))}>{p('Утвердить и скорректировать остатки', 'Tasdiqlash va qoldiqlarni tuzatish', 'Approve and correct balances')}</Button>}
            <PrintButton template="registry" label={p('Сличительная ведомость', 'Solishtirma qaydnoma', 'Count sheet')} doc={() => ({
              entity: 'warehouse_inventory', entityId: v.id, title: p('Сличительная ведомость результатов инвентаризации', 'Inventarizatsiya natijalari solishtirma qaydnomasi', 'Stocktaking count sheet'), number: v.number, date: v.date,
              fields: [{ label: p('Объект', 'Obyekt', 'Scope'), value: place ?? '' }, { label: p('Приказ', 'Buyruq', 'Order'), value: v.commission.orderNo }],
              table: { columns: [{ header: '№' }, { header: t('warehouse_item') }, { header: p('По учёту', 'Hisob bo‘yicha', 'Book'), align: 'right' }, { header: p('Факт', 'Fakt', 'Actual'), align: 'right' }, { header: p('Недостача', 'Kamomad', 'Shortage'), align: 'right' }, { header: p('Излишек', 'Ortiqcha', 'Surplus'), align: 'right' }], rows: diffs.map((l, i) => [String(i + 1), label(l.refId).title, formatNumber(l.expectedQty), l.actualQty !== undefined ? formatNumber(l.actualQty) : '—', l.diff < 0 && l.actualQty !== undefined ? formatMoney(-l.diff * l.unitCost) : '', l.diff > 0 ? formatMoney(l.diff * l.unitCost) : '']), totals: ['', t('total'), '', '', formatMoney(shortage), formatMoney(surplus)] },
              signers: members.map((m, i) => ({ role: i === 0 ? p('Председатель комиссии', 'Komissiya raisi', 'Chairman') : p('Член комиссии', 'Komissiya a’zosi', 'Member'), name: lk.user(m)?.fullName ?? m })),
            })} />
            <ExportButton filename={`${v.number}`} rows={diffs} columns={[
              { header: t('warehouse_item'), value: (l) => label(l.refId).title }, { header: p('По учёту', 'Hisob bo‘yicha', 'Book'), value: (l) => l.expectedQty, format: 'integer' }, { header: p('Факт', 'Fakt', 'Actual'), value: (l) => l.actualQty ?? null, format: 'integer' },
              { header: p('Разница', 'Farq', 'Difference'), value: (l) => l.diff, format: 'integer' }, { header: t('amount'), value: (l) => l.diff * l.unitCost, format: 'money', total: true },
            ]} />
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={p('Посчитано', 'Sanalgan', 'Counted')} value={`${counted} / ${v.lines.length}`} />
        <Stat label={p('Недостача', 'Kamomad', 'Shortage')} value={formatMoney(shortage)} tone={shortage ? 'alert' : undefined} />
        <Stat label={p('Излишек', 'Ortiqcha', 'Surplus')} value={formatMoney(surplus)} />
        <Stat label={p('Комиссия', 'Komissiya', 'Commission')} value={members.length} foot={v.commission.orderNo} />
      </div>
      {canCount && (
        <Card title={p('Сканирование', 'Skanerlash', 'Scanning')}>
          <div className="wms-scan">
            <Input value={code} placeholder={p('Штрихкод EAN-13 / QR / номер — сканер вводит код как клавиатура', 'Shtrixkod EAN-13 / QR / raqam — skaner kodni klaviatura kabi kiritadi', 'EAN-13 / QR / number — the scanner types like a keyboard')} ariaLabel={p('Код для сканирования', 'Skanerlash kodi', 'Scan code')} onChange={(e) => setCode(e.target.value)} onPressEnter={() => { if (code.trim()) { void push([{ code: code.trim() }]); setCode(''); } }} />
            <Button type="primary" icon="qr" onClick={() => { if (code.trim()) { void push([{ code: code.trim() }]); setCode(''); } }}>{p('Отметить', 'Belgilash', 'Scan')}</Button>
            <span className="wms-row"><Switch checked={offline} onChange={setOffline} ariaLabel={p('Офлайн-режим', 'Oflayn rejim', 'Offline mode')} /> {p('Офлайн-режим', 'Oflayn rejim', 'Offline mode')}</span>
            {queue.length > 0 && <Button icon="refresh" onClick={() => void sync()}>{p('Синхронизировать', 'Sinxronlash', 'Sync')} ({queue.length})</Button>}
          </div>
          <div className="wms-note" style={{ marginTop: 6 }}>{p('Каждое сканирование добавляет 1 к фактическому количеству. Мобильное приложение со сканером камеры — в составе мобильного клиента.', 'Har bir skanerlash fakt miqdoriga 1 qo‘shadi. Kamera skanerli mobil ilova — mobil mijoz tarkibida.', 'Each scan adds 1 to the actual quantity. Camera scanning is provided by the mobile client.')}</div>
        </Card>
      )}
      <div className="wms-split">
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Инвентаризационная опись / сличительная ведомость', 'Inventarizatsiya ro‘yxati / solishtirma qaydnoma', 'Inventory list / count sheet')} flush>
            <DataTable rows={diffs} rowKey={(l) => l.refId} columns={cols} />
          </Card>
          {v.status === 'approved' && <PostingsTable docId={v.id} />}
        </div>
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Комиссия', 'Komissiya', 'Commission')}>
            <Kv items={[[p('Приказ', 'Buyruq', 'Order'), v.commission.orderNo], ...members.map((m, i) => [i === 0 ? p('Председатель', 'Rais', 'Chairman') : p('Член', 'A’zo', 'Member'), lk.user(m)?.fullName ?? m] as [string, string])]} />
          </Card>
          <Attachments entity="warehouse_inventory" entityId={v.id} title={p('Фото и документы инвентаризации', 'Inventarizatsiya foto va hujjatlari', 'Stocktaking photos and documents')} />
          <Card title={t('history')}><Timeline events={v.history} /></Card>
        </div>
      </div>
    </>
  );
}

