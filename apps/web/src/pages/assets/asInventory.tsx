// ОС: инвентаризация по QR/NFC — комиссия, сканирование (QR-значение, инвентарный номер или UID NFC-метки),
// офлайн-очередь с синхронизацией, подтверждение наличия и состояния, фотофиксация, недостачи/излишки, ведомость.
import { useState } from 'react';
import { assetsApi, canAccountAssets, formatDate, formatMoney, tk, type AssetCondition, type AssetInventory } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Drawer, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, Stat, StatusBadge, Switch, Timeline, useToast, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { OrgUnitSelect, UserSelect, UsersPicker, useOrg, useP, useWmsError } from '../warehouse/wmsShared';

const AI_TONE: Record<AssetInventory['status'], Tone> = { counting: 'info', completed: 'warn', approved: 'ok' };

export function InventoryTab() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const org = useOrg();
  const [creating, setCreating] = useState(false);
  const list = useApi(() => assetsApi.listInventories());
  return (
    <>
      <FilterBar>
        {canAccountAssets(user) && <Button type="primary" icon="plus" onClick={() => setCreating(true)}>{p('Новая инвентаризация', 'Yangi inventarizatsiya', 'New stocktaking')}</Button>}
        <ExportButton filename={p('Инвентаризации ОС', 'AV inventarizatsiyalari', 'Asset stocktakings')} rows={list.data ?? []} columns={[{ header: t('number'), value: (v) => v.number }, { header: t('date'), value: (v) => v.date }, { header: p('Подразделение', 'Bo‘linma', 'Unit'), value: (v) => org.unitName(v.orgUnitKey) }, { header: p('Объектов', 'Obyektlar', 'Assets'), value: (v) => v.lines.length, format: 'integer' }, { header: p('Не обнаружено', 'Topilmadi', 'Missing'), value: (v) => v.lines.filter((l) => l.assetId && !l.found).length, format: 'integer' }, { header: p('Излишки', 'Ortiqchalar', 'Surplus'), value: (v) => v.lines.filter((l) => l.surplus).length, format: 'integer' }, { header: t('status'), value: (v) => t(tk('assets_invst_', v.status)) }]} />
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(v) => v.id} onRowClick={(v) => navigate(`/assets/inventory/${v.id}`)} columns={[
        { header: t('number'), render: (v) => (<><span className="doc-num">{v.number}</span><div className="sub">{v.method === 'qr' ? 'QR / NFC' : p('по списку', 'ro‘yxat bo‘yicha', 'by list')}</div></>) },
        { header: t('date'), render: (v) => formatDate(v.date) },
        { header: p('Подразделение', 'Bo‘linma', 'Unit'), render: (v) => org.unitName(v.orgUnitKey) },
        { header: p('Найдено', 'Topilgan', 'Found'), align: 'right', render: (v) => `${v.lines.filter((l) => l.found).length} / ${v.lines.length}` },
        { header: t('status'), render: (v) => <StatusBadge prefix="assets_invst_" status={v.status} tone={AI_TONE[v.status]} /> },
      ]} />
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('assets_err_');
  const [unit, setUnit] = useState('');
  const [method, setMethod] = useState<'qr' | 'list'>('qr');
  const [chair, setChair] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [order, setOrder] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal title={p('Инвентаризация ОС', 'AV inventarizatsiyasi', 'Asset stocktaking')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" onClick={() => assetsApi.createInventory({ orgUnitKey: unit, method, commission: { chairmanId: chair, memberIds: members, orderNo: order } }, user).then((v) => { toast(`${v.number}: ${t('saved')}`); onClose(); navigate(`/assets/inventory/${v.id}`); }).catch((e) => setError(err(e)))}>{p('Начать', 'Boshlash', 'Start')}</Button></>}>
      <Field label={p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit')} required><OrgUnitSelect value={unit} onChange={setUnit} /></Field>
      <Field label={p('Способ', 'Usul', 'Method')} required><Select<'qr' | 'list'> value={method} onChange={setMethod} options={[{ value: 'qr', label: p('По QR-коду / NFC', 'QR-kod / NFC bo‘yicha', 'By QR / NFC') }, { value: 'list', label: p('По списку', 'Ro‘yxat bo‘yicha', 'By list') }]} /></Field>
      <Field label={p('Приказ №', 'Buyruq №', 'Order no.')} required><Input value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
      <Field label={p('Председатель комиссии', 'Komissiya raisi', 'Chairman')} required><UserSelect value={chair} onChange={setChair} /></Field>
      <Field label={p('Члены комиссии (не менее двух)', 'Komissiya a’zolari (kamida ikki)', 'Members (at least two)')} required error={error}><UsersPicker value={members} onChange={setMembers} exclude={chair ? [chair] : []} /></Field>
    </Modal>
  );
}

type Q = { code?: string; assetId?: string; found?: boolean; condition?: AssetCondition; note?: string };
const key = (id: string) => `xb.wms.asinv.${id}`;
const readQ = (id: string): Q[] => {
  try {
    return JSON.parse(window.localStorage.getItem(key(id)) ?? '[]') as Q[];
  } catch {
    return [];
  }
};
const writeQ = (id: string, q: Q[]) => {
  try {
    if (q.length) window.localStorage.setItem(key(id), JSON.stringify(q));
    else window.localStorage.removeItem(key(id));
  } catch {
    /* хранилище недоступно */
  }
};

export function AssetInventoryPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const org = useOrg();
  const err = useWmsError('assets_err_');
  const d = useApi(() => assetsApi.getInventory(id), [id]);
  const assets = useApi(() => assetsApi.list({ includeDisposed: true }));
  const groups = useApi(() => assetsApi.listGroups());
  const [code, setCode] = useState('');
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<Q[]>(() => readQ(id));
  const [photo, setPhoto] = useState<string | null>(null);
  const [surplus, setSurplus] = useState<string | null>(null);
  const [sName, setSName] = useState('');
  const [sGroup, setSGroup] = useState('');
  const [sCost, setSCost] = useState('');
  if (d.loading && !d.data) return <Card><Loading /></Card>;
  const v = d.data;
  if (!v) return <Card><Empty text={t('empty')} /></Card>;
  const members = [v.commission.chairmanId, ...v.commission.memberIds];
  const canCount = v.status === 'counting' && (canAccountAssets(user) || members.includes(user.id));
  const asset = (aid?: string) => assets.data?.find((a) => a.id === aid);
  const send = async (e: Q) => {
    if (offline) {
      const q = [...queue, e];
      setQueue(q);
      writeQ(id, q);
      toast(p('Сохранено офлайн', 'Oflayn saqlandi', 'Saved offline'));
      return;
    }
    try {
      const r = await assetsApi.markInventory(id, e, user);
      if (r.status === 'unknown') {
        setSurplus(e.code ?? '');
        setSName('');
        setSCost('');
      } else if (r.status === 'other_unit') toast(p('Объект числится в другом подразделении', 'Obyekt boshqa bo‘linmada hisobda', 'The asset belongs to another unit'));
    } catch (x) {
      toast(err(x));
    }
  };
  const sync = async () => {
    let unknown = 0;
    for (const e of queue) {
      try {
        const r = await assetsApi.markInventory(id, e, user);
        if (r.status !== 'ok') unknown++;
      } catch {
        unknown++;
      }
    }
    setQueue([]);
    writeQ(id, []);
    toast(`${p('Синхронизировано', 'Sinxronlandi', 'Synced')}: ${queue.length}${unknown ? ` · ${p('требуют проверки', 'tekshirish kerak', 'need review')}: ${unknown}` : ''}`);
  };
  const lines = v.lines.map((l, i) => ({ ...l, i }));
  const missing = lines.filter((l) => l.assetId && !l.found);
  const missingSum = missing.reduce((s, l) => s + (asset(l.assetId)?.cost ?? 0) - (asset(l.assetId)?.accumulated ?? 0), 0);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('assets_title'), to: '/assets/inventory' }, { label: v.number }]}
        title={`${p('Инвентаризация ОС', 'AV inventarizatsiyasi', 'Asset stocktaking')} ${v.number}`}
        subtitle={`${org.unitName(v.orgUnitKey)} · ${formatDate(v.date)} · ${v.method === 'qr' ? 'QR / NFC' : p('по списку', 'ro‘yxat bo‘yicha', 'by list')}`}
        actions={
          <>
            <StatusBadge prefix="assets_invst_" status={v.status} tone={AI_TONE[v.status]} />
            {v.status === 'counting' && (canAccountAssets(user) || v.commission.chairmanId === user.id) && <Button type="primary" onClick={() => assetsApi.completeInventory(v.id, user).then(() => toast(p('Ведомость сформирована', 'Qaydnoma shakllandi', 'Sheet ready'))).catch((e) => toast(err(e)))}>{p('Сформировать ведомость', 'Qaydnomani shakllantirish', 'Create sheet')}</Button>}
            {v.status === 'completed' && canAccountAssets(user) && <Button type="primary" icon="check" onClick={() => assetsApi.approveInventory(v.id, user).then(() => toast(p('Итоги утверждены', 'Natijalar tasdiqlandi', 'Results approved'))).catch((e) => toast(err(e)))}>{p('Утвердить итоги', 'Natijalarni tasdiqlash', 'Approve results')}</Button>}
            <PrintButton template="registry" label={p('Инвентаризационная ведомость', 'Inventarizatsiya qaydnomasi', 'Stocktaking sheet')} doc={() => ({
              entity: 'asset_inventory', entityId: v.id, title: p('Инвентаризационная опись основных средств', 'Asosiy vositalar inventarizatsiya ro‘yxati', 'Fixed asset inventory list'), number: v.number, date: v.date,
              fields: [{ label: p('Подразделение', 'Bo‘linma', 'Unit'), value: org.unitName(v.orgUnitKey) }, { label: p('Приказ', 'Buyruq', 'Order'), value: v.commission.orderNo }],
              table: { columns: [{ header: t('assets_invNo') }, { header: t('assets_name') }, { header: p('Наличие', 'Mavjudligi', 'Present') }, { header: p('Состояние', 'Holati', 'Condition') }, { header: t('comment') }], rows: lines.map((l) => [asset(l.assetId)?.inventoryNo ?? l.surplus?.code ?? '—', asset(l.assetId)?.name ?? l.surplus?.name ?? '', l.surplus ? p('излишек', 'ortiqcha', 'surplus') : l.found ? '✓' : p('не обнаружен', 'topilmadi', 'missing'), l.condition ? t(tk('assets_cond_', l.condition)) : '', l.note ?? '']) },
              signers: members.map((m, i) => ({ role: i === 0 ? p('Председатель комиссии', 'Komissiya raisi', 'Chairman') : p('Член комиссии', 'Komissiya a’zosi', 'Member'), name: lk.user(m)?.fullName ?? m })),
            })} />
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={p('Подтверждено', 'Tasdiqlangan', 'Confirmed')} value={`${lines.filter((l) => l.assetId && l.found).length} / ${lines.filter((l) => l.assetId).length}`} />
        <Stat label={p('Недостача', 'Kamomad', 'Shortage')} value={missing.length} tone={missing.length ? 'alert' : undefined} foot={formatMoney(missingSum)} />
        <Stat label={p('Излишки', 'Ortiqchalar', 'Surplus')} value={lines.filter((l) => l.surplus).length} />
        <Stat label={p('Непригодно', 'Yaroqsiz', 'Unusable')} value={lines.filter((l) => l.condition === 'unusable').length} />
      </div>
      {canCount && (
        <Card title={p('Сканирование QR / NFC', 'QR / NFC skanerlash', 'QR / NFC scanning')}>
          <div className="wms-scan">
            <Input value={code} placeholder="XB-OS:OS-02-013420 / OS-02-013420 / NFC UID" ariaLabel={p('Код', 'Kod', 'Code')} onChange={(e) => setCode(e.target.value)} onPressEnter={() => { if (code.trim()) { void send({ code: code.trim(), found: true, condition: 'good' }); setCode(''); } }} />
            <Button type="primary" icon="qr" onClick={() => { if (code.trim()) { void send({ code: code.trim(), found: true, condition: 'good' }); setCode(''); } }}>{p('Отметить', 'Belgilash', 'Scan')}</Button>
            <span className="wms-row"><Switch checked={offline} onChange={setOffline} ariaLabel={p('Офлайн-режим', 'Oflayn rejim', 'Offline mode')} /> {p('Офлайн-режим', 'Oflayn rejim', 'Offline mode')}</span>
            {queue.length > 0 && <Button icon="refresh" onClick={() => void sync()}>{p('Синхронизировать', 'Sinxronlash', 'Sync')} ({queue.length})</Button>}
          </div>
          <div className="wms-note" style={{ marginTop: 6 }}>{p('Неизвестный код регистрируется как излишек. В офлайн-режиме отметки сохраняются на устройстве и передаются при синхронизации.', 'Noma’lum kod ortiqcha sifatida qayd etiladi. Oflayn rejimda belgilar qurilmada saqlanadi va sinxronlashda yuboriladi.', 'An unknown code is registered as surplus. Offline, marks are stored on the device and sent on sync.')}</div>
        </Card>
      )}
      <Card title={p('Инвентаризационная ведомость', 'Inventarizatsiya qaydnomasi', 'Stocktaking sheet')} flush>
        <DataTable rows={lines} rowKey={(l) => String(l.i)} columns={[
          { header: t('assets_invNo'), render: (l) => (l.surplus ? <Badge tone="info">{p('Излишек', 'Ortiqcha', 'Surplus')}</Badge> : <span className="doc-num">{asset(l.assetId)?.inventoryNo}</span>) },
          { header: t('assets_name'), render: (l) => (<>{asset(l.assetId)?.name ?? l.surplus?.name}<div className="sub">{asset(l.assetId)?.location ?? (l.surplus ? `${l.surplus.code} · ${formatMoney(l.surplus.cost)}` : '')}</div></>) },
          { header: p('Наличие', 'Mavjudligi', 'Present'), render: (l) => (canCount && l.assetId ? <Checkbox checked={l.found} onChange={(f) => void send({ assetId: l.assetId!, found: f, ...(l.condition ? { condition: l.condition } : { condition: 'good' as const }) })} /> : l.found ? '✓' : <Badge tone="danger">{p('нет', 'yo‘q', 'no')}</Badge>) },
          { header: p('Состояние', 'Holati', 'Condition'), render: (l) => (canCount && l.assetId ? <Select<AssetCondition> value={l.condition ?? ''} placeholder="—" ariaLabel={p('Состояние', 'Holati', 'Condition')} onChange={(c) => void send({ assetId: l.assetId!, found: true, condition: c })} options={(['good', 'damaged', 'unusable'] as const).map((c) => ({ value: c, label: t(tk('assets_cond_', c)) }))} /> : l.condition ? t(tk('assets_cond_', l.condition)) : '—') },
          { header: p('Фото', 'Foto', 'Photo'), render: (l) => <Button size="small" icon="paperclip" title={p('Фотофиксация', 'Fotoqayd', 'Photo record')} onClick={() => setPhoto(l.assetId ?? `s${l.i}`)} /> },
          { header: p('Отметка', 'Belgi', 'Marked'), render: (l) => <span className="wms-note">{l.scannedAt ? l.scannedAt.slice(11, 16) : '—'}</span> },
        ]} />
      </Card>
      <div className="wms-split" style={{ marginTop: 16 }}>
        <Card title={t('history')}><Timeline events={v.history} /></Card>
        <ExportButton filename={v.number} rows={lines} columns={[{ header: t('assets_invNo'), value: (l) => asset(l.assetId)?.inventoryNo ?? l.surplus?.code ?? '' }, { header: t('assets_name'), value: (l) => asset(l.assetId)?.name ?? l.surplus?.name ?? '' }, { header: p('Наличие', 'Mavjudligi', 'Present'), value: (l) => (l.found ? 1 : 0), format: 'integer' }, { header: p('Состояние', 'Holati', 'Condition'), value: (l) => (l.condition ? t(tk('assets_cond_', l.condition)) : '') }]} />
      </div>
      <Drawer open={!!photo} title={p('Фотофиксация', 'Fotoqayd', 'Photo record')} onClose={() => setPhoto(null)}>
        {photo && <Attachments entity="asset_inventory_photo" entityId={`${v.id}:${photo}`} readOnly={!canCount} title={asset(photo)?.inventoryNo ?? p('Излишек', 'Ortiqcha', 'Surplus')} />}
      </Drawer>
      {surplus !== null && (
        <Modal title={`${p('Излишек: код', 'Ortiqcha: kod', 'Surplus: code')} ${surplus}`} onClose={() => setSurplus(null)} footer={<><Button onClick={() => setSurplus(null)}>{t('cancel')}</Button><Button type="primary" onClick={() => assetsApi.markInventory(v.id, { code: surplus || `S-${Date.now()}`, surplus: { name: sName, groupId: sGroup, cost: Number(sCost) } }, user).then(() => { setSurplus(null); toast(p('Излишек зарегистрирован', 'Ortiqcha qayd etildi', 'Surplus registered')); }).catch((e) => toast(err(e)))}>{p('Зарегистрировать излишек', 'Ortiqchani qayd etish', 'Register surplus')}</Button></>}>
          <div className="wms-note">{p('Объект с таким кодом не числится — опишите его для постановки на учёт после утверждения итогов.', 'Bunday kodli obyekt hisobda yo‘q — natijalar tasdiqlangach hisobga olish uchun tavsiflang.', 'No asset with this code — describe it to register after approval.')}</div>
          <Field label={t('assets_name')} required><Input value={sName} onChange={(e) => setSName(e.target.value)} /></Field>
          <Field label={p('Группа', 'Guruh', 'Group')} required><Select value={sGroup} onChange={setSGroup} placeholder="—" options={(groups.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${loc(g.name)}` }))} /></Field>
          <Field label={p('Оценочная стоимость', 'Baholangan qiymat', 'Estimated value')} required><Input type="number" value={sCost} onChange={(e) => setSCost(e.target.value)} /></Field>
        </Modal>
      )}
    </>
  );
}
