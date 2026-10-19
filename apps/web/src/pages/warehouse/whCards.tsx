// Склад: карточки товаров — реестр, карточка (реквизиты, группа и счета, штрихкод/QR, остатки, партии, история
// движений, архив версий, журнал изменений, документы), создание/изменение, статусы, этикетки, импорт.
import { useState } from 'react';
import { formatDate, formatDateTime, formatMoney, formatNumber, importRegistry, tk, warehouseApi, type WarehouseCard, type WarehouseCardStatus } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, StatusBadge, Textarea, useToast, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { QrCode } from '../../components/QrCode';
import { FieldHistory } from '../../components/FieldHistory';
import { Attachments } from '../../components/Attachments';
import { ImportWizard } from '../../components/Import';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { Ean13, Kv, LabelPreview, useOrg, useP, useWmsError, type WmsLabel } from './wmsShared';

export const CARD_TONE: Record<WarehouseCardStatus, Tone> = { active: 'ok', control: 'info', blocked: 'danger', archived: 'muted' };
const STATUSES: WarehouseCardStatus[] = ['active', 'control', 'blocked', 'archived'];
type CardRow = WarehouseCard & { qty: number; children: number };

export function CardsTab() {
  const { t, loc } = useSession();
  const p = useP();
  const can = useCan();
  const canEdit = can('warehouse', 'edit');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState<WarehouseCardStatus | ''>('');
  const [archived, setArchived] = useState(false);
  const [form, setForm] = useState(false);
  const [labels, setLabels] = useState<WmsLabel[] | null>(null);
  const [importing, setImporting] = useState(false);
  const groups = useApi(() => warehouseApi.listGroups());
  const cards = useApi(() => warehouseApi.listCards({ search, ...(group ? { groupId: group } : {}), ...(status ? { status } : {}), includeArchived: archived }), [search, group, status, archived]);
  const g = (id: string) => groups.data?.find((x) => x.id === id);
  const parentNo = (id?: string) => (id ? cards.data?.find((c) => c.id === id)?.cardNo ?? id : '');
  const cols: Column<CardRow>[] = [
    { header: t('warehouse_sku'), render: (c) => <span className="doc-num">{c.cardNo}</span> },
    { header: t('warehouse_item'), render: (c) => (<>{c.name}{c.parentId && <div className="sub">{p('Общая карточка', 'Umumiy kartochka', 'Common card')}: {parentNo(c.parentId)}</div>}{c.children > 0 && <div className="sub">{p('Привязано однотипных', 'Biriktirilgan bir turdagi', 'Linked similar items')}: {c.children}</div>}</>) },
    { header: p('Группа / счёт', 'Guruh / hisob', 'Group / account'), render: (c) => (<>{g(c.groupId) ? loc(g(c.groupId)!.name) : c.groupId}<div className="sub wms-mono">{g(c.groupId)?.account}{c.offBalance ? ` · ${g(c.groupId)?.offBalanceAccount ?? '96339000'}` : ''}</div></>) },
    { header: p('Ед.', 'Birl.', 'Unit'), render: (c) => c.unit },
    { header: t('warehouse_qty'), align: 'right', render: (c) => formatNumber(c.qty) },
    { header: 'EAN-13', render: (c) => <span className="wms-mono">{c.barcode}</span> },
    { header: t('status'), render: (c) => <StatusBadge prefix="warehouse_cardst_" status={c.status} tone={CARD_TONE[c.status]} /> },
  ];
  const target = importRegistry.get('warehouse_cards');
  return (
    <>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('warehouse_sku')}, ${t('warehouse_item').toLowerCase()}, EAN`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={group} onChange={setGroup} placeholder={`${p('Группа', 'Guruh', 'Group')}: ${t('all')}`} options={(groups.data ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${loc(x.name)}` }))} />
        <Select<WarehouseCardStatus> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={STATUSES.map((s) => ({ value: s, label: t(tk('warehouse_cardst_', s)) }))} />
        <Checkbox checked={archived} onChange={setArchived}>{p('Показывать архив', 'Arxivni ko‘rsatish', 'Show archived')}</Checkbox>
        {canEdit && <Button type="primary" icon="plus" onClick={() => setForm(true)}>{p('Новая карточка', 'Yangi kartochka', 'New card')}</Button>}
        <Button icon="printer" onClick={() => setLabels((cards.data ?? []).map((c) => ({ title: c.name, sub: `${c.cardNo} · ${c.unit}`, barcode: c.barcode, qr: `XB-WH:${c.cardNo}` })))} disabled={!cards.data?.length}>
          {p('Этикетки', 'Yorliqlar', 'Labels')}
        </Button>
        {canEdit && target && <Button icon="upload" onClick={() => setImporting(true)}>{p('Импорт из Excel', 'Exceldan import', 'Import from Excel')}</Button>}
        <ExportButton filename={p('Карточки товаров', 'Tovar kartochkalari', 'Item cards')} rows={cards.data ?? []} columns={[
          { header: t('warehouse_sku'), value: (c) => c.cardNo }, { header: t('warehouse_item'), value: (c) => c.name }, { header: p('Группа', 'Guruh', 'Group'), value: (c) => g(c.groupId)?.code ?? '' },
          { header: p('Счёт', 'Hisob', 'Account'), value: (c) => g(c.groupId)?.account ?? '' }, { header: 'EAN-13', value: (c) => c.barcode }, { header: t('warehouse_qty'), value: (c) => c.qty, format: 'integer' }, { header: t('status'), value: (c) => t(tk('warehouse_cardst_', c.status)) },
        ]} />
      </FilterBar>
      <DataTable rows={cards.data} loading={cards.loading} rowKey={(c) => c.id} columns={cols} onRowClick={(c) => navigate(`/warehouse/cards/${c.id}`)} />
      {form && <CardForm onClose={() => setForm(false)} />}
      {labels && <LabelPreview labels={labels} entity="warehouse_card" onClose={() => setLabels(null)} />}
      {importing && target && (
        <Modal title={p('Импорт карточек', 'Kartochkalarni import qilish', 'Import cards')} onClose={() => setImporting(false)} footer={<Button onClick={() => setImporting(false)}>{t('svc_printClose')}</Button>}>
          <ImportWizard target={target} onDone={() => cards.reload()} />
        </Modal>
      )}
    </>
  );
}

export function CardForm({ card, onClose }: { card?: WarehouseCard; onClose: () => void }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('warehouse_err_');
  const groups = useApi(() => warehouseApi.listGroups());
  const all = useApi(() => warehouseApi.listCards());
  const [name, setName] = useState(card?.name ?? '');
  const [groupId, setGroupId] = useState(card?.groupId ?? '');
  const [unit, setUnit] = useState(card?.unit ?? 'шт');
  const [parentId, setParentId] = useState(card?.parentId ?? '');
  const [offBalance, setOffBalance] = useState(card?.offBalance ?? false);
  const [trackExpiry, setTrackExpiry] = useState(card?.trackExpiry ?? false);
  const [life, setLife] = useState(card?.shelfLifeDays ? String(card.shelfLifeDays) : '');
  const [price, setPrice] = useState(card ? String(card.defaultPrice) : '');
  const [note, setNote] = useState(card?.note ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const g = groups.data?.find((x) => x.id === groupId);
  async function save() {
    setError('');
    try {
      const c = await warehouseApi.saveCard({ ...(card ? { id: card.id } : {}), name, groupId, unit, ...(parentId ? { parentId } : {}), offBalance, trackExpiry, ...(trackExpiry ? { shelfLifeDays: Number(life) } : {}), defaultPrice: Number(price), ...(note ? { note } : {}) }, user, reason);
      toast(`${c.cardNo}: ${t('saved')}`);
      onClose();
      if (!card) navigate(`/warehouse/cards/${c.id}`);
    } catch (e) {
      setError(err(e));
    }
  }
  return (
    <Modal title={card ? `${card.cardNo} · ${p('Изменение карточки', 'Kartochkani o‘zgartirish', 'Edit card')}` : p('Новая карточка товара', 'Yangi tovar kartochkasi', 'New item card')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" onClick={save}>{t('save')}</Button></>}>
      <Field label={t('warehouse_item')} required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="wms-form-grid">
        <Field label={p('Группа (счёт учёта)', 'Guruh (hisob)', 'Group (account)')} required hint={g ? `${g.account}${g.offBalanceAccount ? ` / ${g.offBalanceAccount}` : ''} · ${p('номер', 'raqam', 'no.')} ${card?.cardNo ?? warehouseApi.nextCardNo(g.id)}` : undefined}>
          <Select value={groupId} onChange={setGroupId} placeholder="—" options={(groups.data ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${loc(x.name)}` }))} />
        </Field>
        <Field label={p('Единица измерения', 'O‘lchov birligi', 'Unit')} required><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
        <Field label={p('Учётная цена', 'Hisob narxi', 'Book price')} required><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label={p('Общая карточка (однотипные товары)', 'Umumiy kartochka (bir turdagi tovarlar)', 'Common card (similar items)')}>
          <Select value={parentId} onChange={setParentId} placeholder="—" options={(all.data ?? []).filter((c) => c.id !== card?.id && !c.parentId).map((c) => ({ value: c.id, label: `${c.cardNo} · ${c.name}` }))} />
        </Field>
      </div>
      <div className="wms-row">
        <Checkbox checked={offBalance} onChange={setOffBalance}>{p('Ценность на контроле (внебалансовый учёт)', 'Nazoratdagi qimmatlik (balansdan tashqari)', 'Controlled valuable (off-balance)')}</Checkbox>
        <Checkbox checked={trackExpiry} onChange={setTrackExpiry}>{p('Контроль срока годности', 'Yaroqlilik muddati nazorati', 'Track expiry')}</Checkbox>
      </div>
      {trackExpiry && <Field label={p('Срок годности, дней', 'Yaroqlilik muddati, kun', 'Shelf life, days')} required><Input type="number" value={life} onChange={(e) => setLife(e.target.value)} /></Field>}
      <Field label={t('comment')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {card && <Field label={p('Основание изменения (сохраняется в архиве версий)', 'O‘zgartirish asosi (versiyalar arxivida saqlanadi)', 'Reason (kept in version archive)')} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}

export function CardDetailPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const can = useCan();
  const err = useWmsError('warehouse_err_');
  const d = useApi(() => warehouseApi.getCard(id), [id]);
  const locs = useApi(() => warehouseApi.listLocations());
  const org = useOrg();
  const [edit, setEdit] = useState(false);
  const [statusTo, setStatusTo] = useState<WarehouseCardStatus | null>(null);
  const [reason, setReason] = useState('');
  const [labels, setLabels] = useState<WmsLabel[] | null>(null);
  if (d.loading && !d.data) return <Card><Loading /></Card>;
  const x = d.data;
  if (!x) return <Card><Empty text={t('empty')} /></Card>;
  const c = x.card;
  const canEdit = can('warehouse', 'edit') && c.status !== 'archived';
  const whCode = (wid: string) => locs.data?.find((l) => l.id === wid)?.code ?? wid;
  const total = x.items.reduce((s, i) => s + i.qty, 0);
  const label: WmsLabel = { title: c.name, sub: `${c.cardNo} · ${c.unit}`, barcode: c.barcode, qr: `XB-WH:${c.cardNo}` };
  // Этикетка на каждую складскую позицию: штрихкод карточки + склад и МВЗ места хранения (PR-WMS-021).
  const labelsAll: WmsLabel[] = x.items.length
    ? x.items.map((i) => {
        const l = locs.data?.find((w) => w.id === i.warehouseId);
        return { title: c.name, sub: `${c.cardNo} · ${c.unit} · ${whCode(i.warehouseId)} · ${p('МВЗ', 'XMM', 'CC')} ${org.ccCode(l?.costCenterId)}`, barcode: c.barcode, qr: `XB-WH:${c.cardNo}:${whCode(i.warehouseId)}` };
      })
    : [label];
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('warehouse_title'), to: '/warehouse/cards' }, { label: c.cardNo }]}
        title={c.name}
        subtitle={`${c.cardNo} · ${loc(x.group.name)} · v${c.version}`}
        actions={
          <>
            <StatusBadge prefix="warehouse_cardst_" status={c.status} tone={CARD_TONE[c.status]} />
            {canEdit && <Button icon="pen" onClick={() => setEdit(true)}>{p('Изменить', 'O‘zgartirish', 'Edit')}</Button>}
            {can('warehouse', 'edit') && (
              <Select<WarehouseCardStatus> value="" placeholder={p('Сменить статус…', 'Holatni o‘zgartirish…', 'Change status…')} ariaLabel={p('Сменить статус', 'Holatni o‘zgartirish', 'Change status')} onChange={(v) => { setReason(''); setStatusTo(v); }} options={STATUSES.filter((s) => s !== c.status).map((s) => ({ value: s, label: t(tk('warehouse_cardst_', s)) }))} />
            )}
            <Button icon="qr" onClick={() => setLabels(labelsAll)}>{p('Этикетка', 'Yorliq', 'Label')}</Button>
            <PrintButton
              doc={() => ({
                entity: 'warehouse_card', entityId: c.id, title: p('Карточка складского учёта', 'Ombor hisobi kartochkasi', 'Stock record card'), number: c.cardNo, date: c.updatedAt.slice(0, 10),
                fields: [
                  { label: t('warehouse_item'), value: c.name }, { label: p('Группа / счёт', 'Guruh / hisob', 'Group / account'), value: `${loc(x.group.name)} · ${x.group.account}` },
                  { label: p('Единица', 'Birlik', 'Unit'), value: c.unit }, { label: 'EAN-13', value: c.barcode }, { label: t('warehouse_qty'), value: `${formatNumber(total)} ${c.unit}` },
                ],
                table: { columns: [{ header: '№' }, { header: t('date') }, { header: t('warehouse_movementType') }, { header: t('warehouse_qty'), align: 'right' }, { header: t('warehouse_sum'), align: 'right' }], rows: x.movements.slice(0, 40).map((m) => [m.number, formatDate(m.at), t(tk('warehouse_mv_', m.type)), String(m.qty), formatMoney(m.amount)]) },
              })}
            />
          </>
        }
      />
      <div className="wms-split">
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Реквизиты', 'Rekvizitlar', 'Details')}>
            <Kv
              items={[
                [p('Номер карточки', 'Kartochka raqami', 'Card no.'), <span className="wms-mono">{c.cardNo}</span>],
                [p('Группа', 'Guruh', 'Group'), `${x.group.code} · ${loc(x.group.name)}`],
                [p('Балансовый счёт', 'Balans hisobi', 'Balance account'), <span className="wms-mono">{x.group.account}</span>],
                [p('Внебалансовый счёт', 'Balansdan tashqari hisob', 'Off-balance account'), x.group.offBalanceAccount ? <span className="wms-mono">{x.group.offBalanceAccount}{c.offBalance ? ` (${p('на контроле', 'nazoratda', 'controlled')})` : ''}</span> : '—'],
                [p('Счёт расходов', 'Xarajat hisobi', 'Expense account'), <span className="wms-mono">{x.group.expenseAccount}</span>],
                [p('Ед. изм. / учётная цена', 'Birlik / hisob narxi', 'Unit / book price'), `${c.unit} · ${formatMoney(c.defaultPrice)}`],
                [p('Срок годности', 'Yaroqlilik muddati', 'Shelf life'), c.trackExpiry ? `${c.shelfLifeDays} ${p('дн.', 'kun', 'days')}` : p('не контролируется', 'nazorat qilinmaydi', 'not tracked')],
                [p('Общая карточка', 'Umumiy kartochka', 'Common card'), x.parent ? <Link to={`/warehouse/cards/${x.parent.id}`}>{x.parent.cardNo} · {x.parent.name}</Link> : '—'],
                [p('Однотипные товары', 'Bir turdagi tovarlar', 'Similar items'), x.children.length ? x.children.map((ch) => <div key={ch.id}><Link to={`/warehouse/cards/${ch.id}`}>{ch.cardNo} · {ch.name}</Link></div>) : '—'],
                [p('Создана', 'Yaratilgan', 'Created'), `${formatDateTime(c.createdAt)} · ${lk.user(c.createdBy)?.fullName ?? c.createdBy}`],
                ...(c.note ? [[t('comment'), c.note] as [string, string]] : []),
              ]}
            />
          </Card>
          <Card title={p('Остатки по складам', 'Omborlar bo‘yicha qoldiqlar', 'Stock by warehouse')} flush>
            <DataTable rows={x.items} rowKey={(i) => i.id} columns={[
              { header: t('warehouse_warehouse'), render: (i) => whCode(i.warehouseId) },
              { header: t('warehouse_qty'), align: 'right', render: (i) => `${formatNumber(i.qty)} ${i.unit}` },
              { header: p('Резерв', 'Zaxira', 'Reserved'), align: 'right', render: (i) => formatNumber(i.reserved) },
              { header: t('warehouse_min'), align: 'right', render: (i) => formatNumber(i.minQty) },
              { header: t('warehouse_unitCost'), align: 'right', render: (i) => formatMoney(i.unitCost) },
            ]} />
          </Card>
          <Card title={p('Партии (FIFO)', 'Partiyalar (FIFO)', 'Batches (FIFO)')} flush>
            <DataTable rows={x.batches} rowKey={(b) => b.id} emptyText={p('Партий нет', 'Partiyalar yo‘q', 'No batches')} columns={[
              { header: p('Партия', 'Partiya', 'Batch'), render: (b) => <span className="wms-mono">{b.batchNo}</span> },
              { header: t('warehouse_warehouse'), render: (b) => whCode(x.items.find((i) => i.id === b.itemId)?.warehouseId ?? '') },
              { header: p('Поступила', 'Kelgan', 'Received'), render: (b) => b.receivedAt },
              { header: p('Остаток / приход', 'Qoldiq / kirim', 'Left / in'), align: 'right', render: (b) => `${formatNumber(b.qtyLeft)} / ${formatNumber(b.qtyIn)}` },
              { header: t('warehouse_unitCost'), align: 'right', render: (b) => formatMoney(b.unitCost) },
              { header: p('Годен до', 'Yaroqli', 'Expires'), render: (b) => b.expiryDate ?? '—' },
            ]} />
          </Card>
          <Card title={p('История движений по карточке', 'Kartochka bo‘yicha harakatlar tarixi', 'Movement history')} flush>
            <DataTable rows={x.movements} rowKey={(m) => m.id} columns={[
              { header: '№', render: (m) => (<><span className="doc-num">{m.number}</span>{m.docNumber && <div className="sub">{m.docNumber}</div>}</>) },
              { header: t('date'), render: (m) => formatDateTime(m.at) },
              { header: t('warehouse_movementType'), render: (m) => <Badge tone={m.type === 'receipt' ? 'ok' : m.type === 'writeoff' ? 'danger' : m.type === 'transfer' ? 'info' : 'warn'}>{t(tk('warehouse_mv_', m.type))}</Badge> },
              { header: t('warehouse_warehouse'), render: (m) => `${whCode(m.warehouseId)}${m.toWarehouseId ? ` → ${whCode(m.toWarehouseId)}` : ''}` },
              { header: t('warehouse_qty'), align: 'right', render: (m) => formatNumber(m.qty) },
              { header: t('warehouse_sum'), align: 'right', render: (m) => formatMoney(m.amount) },
            ]} />
          </Card>
        </div>
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Штрихкод и QR', 'Shtrixkod va QR', 'Barcode and QR')}>
            <div className="wms-qr">
              <Ean13 code={c.barcode} />
              <QrCode value={label.qr} size={96} />
            </div>
          </Card>
          <Card title={p('Архив версий карточки', 'Kartochka versiyalari arxivi', 'Card version archive')}>
            {x.versions.length ? (
              <ul className="timeline">
                {x.versions.map((v) => (
                  <li key={v.version}>
                    <span className="dot" />
                    <div>
                      <div className="what">v{v.version}: {v.snapshot.name} · {t(tk('warehouse_cardst_', v.snapshot.status))}</div>
                      <div className="meta">{lk.user(v.by)?.fullName ?? v.by} · {formatDateTime(v.at)}</div>
                      <div className="note">{v.reason}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <Empty text={p('Изменений не было', 'O‘zgarishlar bo‘lmagan', 'No changes yet')} />}
          </Card>
          <FieldHistory entity="warehouse_card" entityId={c.id} />
          <Attachments entity="warehouse_card" entityId={c.id} readOnly={!can('warehouse', 'edit')} />
        </div>
      </div>
      {edit && <CardForm card={c} onClose={() => setEdit(false)} />}
      {labels && <LabelPreview labels={labels} entity="warehouse_card" onClose={() => setLabels(null)} />}
      {statusTo && (
        <Modal title={`${c.cardNo}: ${t(tk('warehouse_cardst_', statusTo))}`} onClose={() => setStatusTo(null)} footer={<><Button onClick={() => setStatusTo(null)}>{t('cancel')}</Button><Button type="primary" onClick={() => warehouseApi.setCardStatus(c.id, statusTo, user, reason).then(() => { toast(t('saved')); setStatusTo(null); }).catch((e) => toast(err(e)))}>{t('save')}</Button></>}>
          <Field label={p('Основание', 'Asos', 'Reason')} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
        </Modal>
      )}
    </>
  );
}
