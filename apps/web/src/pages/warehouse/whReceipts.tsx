// Склад: поступления — реестр, форма (склад, поставщик, договор/закупка, ЭСФ со сверкой, товарная накладная,
// строки с ценой и сроком годности, МВЗ), карточка с проведением, М-4, корректировкой (сторно), проводками и документами.
import { useEffect, useState, type ReactNode } from 'react';
import { api, einvoicesApi, formatDate, formatMoney, formatNumber, today, tk, warehouseApi, type WarehouseReceipt, type WarehouseReceiptLine } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, StatusBadge, Textarea, Timeline, useToast, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { CostCenterSelect, Kv, PostingsTable, useOrg, useP, useWmsError } from './wmsShared';

export const RC_TONE: Record<WarehouseReceipt['status'], Tone> = { draft: 'muted', posted: 'ok', reversed: 'warn' };
type Row = WarehouseReceipt & { amount: number };

export function ReceiptsTab() {
  const { t } = useSession();
  const p = useP();
  const lk = useLookups();
  const can = useCan();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<WarehouseReceipt['status'] | ''>('');
  const list = useApi(() => warehouseApi.listReceipts({ search, ...(status ? { status } : {}) }), [search, status]);
  const locs = useApi(() => warehouseApi.listLocations());
  const auto = (list.data ?? []).filter((r) => r.status === 'draft' && r.source === 'einvoice');
  const cols: Column<Row>[] = [
    { header: p('Приходный ордер', 'Kirim orderi', 'Receipt order'), render: (r) => (<><span className="doc-num">{r.number}</span><div className="sub">{t(tk('warehouse_rcsrc_', r.source))}</div></>) },
    { header: t('date'), render: (r) => formatDate(r.date) },
    { header: t('warehouse_supplier'), render: (r) => (<>{r.supplierId ? lk.counterparty(r.supplierId)?.name : '—'}<div className="sub">{p('ТН', 'YX', 'WB')} {r.waybillNo} {p('от', 'dan', 'of')} {formatDate(r.waybillDate)}</div></>) },
    { header: p('ЭСФ / договор', 'EHF / shartnoma', 'E-invoice / contract'), render: (r) => (<>{r.einvoiceNumber ?? '—'}{r.diffs?.length ? <div><Badge tone="warn">{p('Расхождения', 'Farqlar', 'Mismatch')}: {r.diffs.length}</Badge></div> : null}</>) },
    { header: t('warehouse_warehouse'), render: (r) => locs.data?.find((l) => l.id === r.warehouseId)?.code ?? r.warehouseId },
    { header: t('amount'), align: 'right', render: (r) => formatMoney(r.amount) },
    { header: t('status'), render: (r) => <StatusBadge prefix="warehouse_rcst_" status={r.status} tone={RC_TONE[r.status]} /> },
  ];
  return (
    <>
      {auto.length > 0 && (
        <div className="wms-pad" style={{ paddingBottom: 0 }}>
          <div className="wms-ok">
            {p('Автооприходование по принятым счетам-фактурам: черновики ждут проверки и проведения', 'Qabul qilingan hisob-fakturalar bo‘yicha avtomatik kirim: qoralamalar tekshirish va o‘tkazishni kutmoqda', 'Auto-receipt from accepted e-invoices: drafts await review and posting')}: {auto.map((r) => <Link key={r.id} to={`/warehouse/receipts/${r.id}`} style={{ marginRight: 8 }}>{r.number} ({r.einvoiceNumber})</Link>)}
          </div>
        </div>
      )}
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('number')}, ${p('накладная', 'yuk xati', 'waybill')}, ЭСФ`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select<WarehouseReceipt['status']> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={(['draft', 'posted', 'reversed'] as const).map((s) => ({ value: s, label: t(tk('warehouse_rcst_', s)) }))} />
        {can('warehouse', 'edit') && <Button type="primary" icon="plus" onClick={() => navigate('/warehouse/receipts/new')}>{p('Новое поступление', 'Yangi kirim', 'New receipt')}</Button>}
        <ExportButton filename={p('Поступления', 'Kirimlar', 'Receipts')} rows={list.data ?? []} columns={[
          { header: t('number'), value: (r) => r.number }, { header: t('date'), value: (r) => r.date }, { header: t('warehouse_supplier'), value: (r) => (r.supplierId ? lk.counterparty(r.supplierId)?.name ?? '' : '') },
          { header: p('Накладная', 'Yuk xati', 'Waybill'), value: (r) => r.waybillNo }, { header: 'ЭСФ', value: (r) => r.einvoiceNumber ?? '' }, { header: t('amount'), value: (r) => r.amount, format: 'money', total: true }, { header: t('status'), value: (r) => t(tk('warehouse_rcst_', r.status)) },
        ]} />
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(r) => r.id} columns={cols} onRowClick={(r) => navigate(`/warehouse/receipts/${r.id}`)} />
    </>
  );
}

interface FormLine extends WarehouseReceiptLine {
  key: number;
}
const toLine = (l: FormLine): WarehouseReceiptLine => ({
  cardId: l.cardId, qty: l.qty, price: l.price, ...(l.expiryDate ? { expiryDate: l.expiryDate } : {}),
  ...(l.invoiceName ? { invoiceName: l.invoiceName } : {}), ...(l.invoiceQty !== undefined ? { invoiceQty: l.invoiceQty } : {}), ...(l.invoicePrice !== undefined ? { invoicePrice: l.invoicePrice } : {}),
});

export function ReceiptFormPage({ id }: { id?: string }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useWmsError('warehouse_err_');
  const existing = useApi(() => (id ? warehouseApi.getReceipt(id) : Promise.resolve(undefined)), [id ?? '']);
  const locs = useApi(() => warehouseApi.listLocations());
  const cards = useApi(() => warehouseApi.listCards());
  const contracts = useApi(() => api.listContracts());
  const procs = useApi(() => api.listProcurement());
  // Только принятые ЭСФ, по которым ещё нет поступления (кроме редактируемого черновика).
  const invoices = useApi(async () => {
    const [list, rs] = await Promise.all([einvoicesApi.list({ direction: 'incoming' }), warehouseApi.listReceipts({})]);
    return list.filter((i) => (i.status === 'accepted' || i.status === 'signed') && !rs.some((r) => r.einvoiceId === i.id && r.id !== id && (r.status === 'draft' || r.status === 'posted')));
  }, [id ?? '']);
  const [wh, setWh] = useState('wh1');
  const [supplier, setSupplier] = useState('');
  const [contract, setContract] = useState('');
  const [proc, setProc] = useState('');
  const [inv, setInv] = useState('');
  const [wbNo, setWbNo] = useState('');
  const [wbDate, setWbDate] = useState(today());
  const [cc, setCc] = useState('');
  const [lines, setLines] = useState<FormLine[]>([{ key: 1, cardId: '', qty: 1, price: 0 }]);
  const [error, setError] = useState('');
  const [mismatch, setMismatch] = useState<WarehouseReceipt | null>(null);
  const [accept, setAccept] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    setWh(r.warehouseId);
    setSupplier(r.supplierId ?? '');
    setContract(r.contractId ?? '');
    setProc(r.procurementId ?? '');
    setInv(r.einvoiceId ?? '');
    setWbNo(r.waybillNo);
    setWbDate(r.waybillDate);
    setCc(r.costCenterId);
    setLines(r.lines.map((l, i) => ({ ...l, key: i + 1 })));
  }, [existing.data?.id]);
  const loc = locs.data?.find((l) => l.id === wh);
  const card = (cid: string) => cards.data?.find((c) => c.id === cid);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const upd = (key: number, patch: Partial<FormLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function fillFromInvoice(invId: string) {
    setInv(invId);
    if (!invId) return;
    const i = invoices.data?.find((x) => x.id === invId);
    if (i) {
      setSupplier(i.counterpartyId);
      if (i.contractId) setContract(i.contractId);
      setWbNo(i.number);
      setWbDate(i.date);
    }
    const ls = await warehouseApi.invoiceLines(invId);
    if (ls.length) setLines(ls.map((l, k) => ({ ...l, key: k + 1 })));
  }

  async function save(post: boolean, acceptDiff?: string) {
    setError('');
    setBusy(true);
    try {
      const r = await warehouseApi.saveReceipt(
        { ...(id ? { id } : {}), warehouseId: wh, ...(supplier ? { supplierId: supplier } : {}), ...(contract ? { contractId: contract } : {}), ...(proc ? { procurementId: proc } : {}), ...(inv ? { einvoiceId: inv } : {}), waybillNo: wbNo, waybillDate: wbDate, lines: lines.map(toLine), ...(cc ? { costCenterId: cc } : {}) },
        user,
        post,
        acceptDiff,
      );
      toast(`${r.number}: ${post ? p('проведено, сформирован приходный ордер М-4', 'o‘tkazildi, M-4 kirim orderi shakllandi', 'posted, receipt order M-4 created') : t('saved')}`);
      navigate(`/warehouse/receipts/${r.id}`);
    } catch (e) {
      if (e instanceof Error && e.message === 'INVOICE_MISMATCH') {
        const list = await warehouseApi.listReceipts({});
        setMismatch(list.find((x) => x.waybillNo === wbNo && x.status === 'draft') ?? null);
      } else setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  if (id && existing.loading && !existing.data) return <Card><Loading /></Card>;
  return (
    <>
      <PageHeader crumbs={[{ label: t('warehouse_title'), to: '/warehouse/receipts' }, { label: id ? existing.data?.number ?? id : p('Новое поступление', 'Yangi kirim', 'New receipt') }]} title={id ? `${p('Поступление', 'Kirim', 'Receipt')} ${existing.data?.number ?? ''}` : p('Регистрация поступления', 'Kirimni ro‘yxatga olish', 'Register receipt')} />
      <Card title={p('Реквизиты поступления', 'Kirim rekvizitlari', 'Receipt details')}>
        <div className="wms-form-grid">
          <Field label={t('warehouse_warehouse')} required><Select value={wh} onChange={setWh} options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Field>
          <Field label={p('Счёт-фактура (ЭСФ) — сверка', 'Hisob-faktura (EHF) — solishtirish', 'E-invoice — reconciliation')} hint={p('Заполняет поставщика, договор и строки; при проведении сверяются количество и цена', 'Yetkazib beruvchi, shartnoma va qatorlarni to‘ldiradi; o‘tkazishda miqdor va narx solishtiriladi', 'Fills supplier, contract and lines; qty and price are reconciled on posting')}>
            <Select value={inv} onChange={(v) => void fillFromInvoice(v)} placeholder="—" options={(invoices.data ?? []).map((i) => ({ value: i.id, label: `${i.number} · ${lk.counterparty(i.counterpartyId)?.name ?? ''}` }))} />
          </Field>
          <Field label={t('warehouse_supplier')} required><Select value={supplier} onChange={setSupplier} placeholder="—" options={lk.counterparties.filter((c) => !c.blocked).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label={p('Договор', 'Shartnoma', 'Contract')}><Select value={contract} onChange={setContract} placeholder="—" options={(contracts.data ?? []).filter((c) => !supplier || c.counterpartyId === supplier).map((c) => ({ value: c.id, label: `${c.number} · ${c.subject}` }))} /></Field>
          <Field label={p('Закупка', 'Xarid', 'Procurement')}><Select value={proc} onChange={setProc} placeholder="—" options={(procs.data ?? []).map((x) => ({ value: x.id, label: `${x.number} · ${x.title}` }))} /></Field>
          <Field label={p('МВЗ', 'XMM', 'Cost center')} hint={p('По умолчанию — МВЗ склада', 'Standart — ombor XMM', 'Default — warehouse cost center')}><CostCenterSelect value={cc || loc?.costCenterId || ''} onChange={setCc} /></Field>
          <Field label={p('Товарная накладная №', 'Yuk xati №', 'Waybill no.')} required><Input value={wbNo} onChange={(e) => setWbNo(e.target.value)} /></Field>
          <Field label={p('Дата накладной', 'Yuk xati sanasi', 'Waybill date')} required><Input type="date" value={wbDate} onChange={(e) => setWbDate(e.target.value)} /></Field>
        </div>
      </Card>
      <Card title={p('Товары: по цене и количеству', 'Tovarlar: narx va miqdor bo‘yicha', 'Goods: price and quantity')} actions={<Button size="small" icon="plus" onClick={() => setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((l) => l.key)) + 1, cardId: '', qty: 1, price: 0 }])}>{p('Строка', 'Qator', 'Line')}</Button>}>
        <div className="wms-lines-wrap">
          <table className="wms-lines">
            <thead>
              <tr>
                <th>{p('Карточка товара', 'Tovar kartochkasi', 'Item card')}</th>
                <th>{t('qty')}</th>
                <th>{p('Цена без НДС', 'QQSsiz narx', 'Price excl. VAT')}</th>
                <th>{p('Годен до', 'Yaroqli', 'Expires')}</th>
                <th className="num">{t('amount')}</th>
                <th>{p('По ЭСФ', 'EHF bo‘yicha', 'Per invoice')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td style={{ minWidth: 220 }}>
                    <Select value={l.cardId} onChange={(v) => upd(l.key, { cardId: v, ...(l.price ? {} : { price: card(v)?.defaultPrice ?? 0 }) })} placeholder="—" ariaLabel={p('Карточка товара', 'Tovar kartochkasi', 'Item card')} options={(cards.data ?? []).filter((c) => c.status !== 'blocked').map((c) => ({ value: c.id, label: `${c.cardNo} · ${c.name}` }))} />
                    {l.invoiceName && <div className="wms-note">{l.invoiceName}</div>}
                  </td>
                  <td><Input type="number" value={l.qty} onChange={(e) => upd(l.key, { qty: Number(e.target.value) })} ariaLabel={t('qty')} /></td>
                  <td><Input type="number" value={l.price} onChange={(e) => upd(l.key, { price: Number(e.target.value) })} ariaLabel={p('Цена', 'Narx', 'Price')} /></td>
                  <td>{card(l.cardId)?.trackExpiry ? <Input type="date" value={l.expiryDate ?? ''} onChange={(e) => upd(l.key, { expiryDate: e.target.value })} ariaLabel={p('Годен до', 'Yaroqli', 'Expires')} /> : <span className="muted">—</span>}</td>
                  <td className="num">{formatMoney(l.qty * l.price)}</td>
                  <td className="wms-note">{l.invoiceQty !== undefined ? `${formatNumber(l.invoiceQty)} × ${formatMoney(l.invoicePrice ?? 0)}` : '—'}</td>
                  <td><Button size="small" icon="trash" title={p('Удалить строку', 'Qatorni o‘chirish', 'Remove line')} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="wms-row end" style={{ marginTop: 10 }}>
          <b>{t('total')}: {formatMoney(total)}</b>
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="wms-row end" style={{ marginTop: 10 }}>
          <Button onClick={() => navigate('/warehouse/receipts')}>{t('cancel')}</Button>
          <Button loading={busy} onClick={() => save(false)}>{p('Сохранить черновик', 'Qoralamani saqlash', 'Save draft')}</Button>
          <Button type="primary" loading={busy} onClick={() => save(true)}>{p('Провести (М-4)', 'O‘tkazish (M-4)', 'Post (M-4)')}</Button>
        </div>
      </Card>
      {mismatch && (
        <Modal title={p('Расхождения со счётом-фактурой', 'Hisob-faktura bilan farqlar', 'E-invoice mismatch')} onClose={() => setMismatch(null)} footer={<><Button onClick={() => navigate(`/warehouse/receipts/${mismatch.id}`)}>{p('Оставить черновиком', 'Qoralama qoldirish', 'Keep as draft')}</Button><Button type="primary" disabled={!accept.trim()} onClick={() => { const r = mismatch; setMismatch(null); void warehouseApi.postReceipt(r.id, user, accept).then(() => { toast(`${r.number}: ${p('проведено с расхождениями', 'farqlar bilan o‘tkazildi', 'posted with differences')}`); navigate(`/warehouse/receipts/${r.id}`); }).catch((e) => toast(err(e))); }}>{p('Провести с расхождениями', 'Farqlar bilan o‘tkazish', 'Post with differences')}</Button></>}>
          <DiffList diffs={mismatch.diffs ?? []} />
          <Field label={p('Основание (акт расхождений, претензия поставщику)', 'Asos (farqlar dalolatnomasi, da’vo)', 'Reason (discrepancy report, claim)')} required>
            <Textarea value={accept} onChange={(e) => setAccept(e.target.value)} rows={2} />
          </Field>
        </Modal>
      )}
    </>
  );
}

function DiffList({ diffs }: { diffs: NonNullable<WarehouseReceipt['diffs']> }) {
  const p = useP();
  if (!diffs.length) return <div className="wms-ok">{p('Сверено: количество и цены совпадают с ЭСФ', 'Solishtirildi: miqdor va narxlar EHF bilan mos', 'Reconciled: quantities and prices match the e-invoice')}</div>;
  const name = (f: string) => (f === 'qty' ? p('количество', 'miqdor', 'quantity') : f === 'price' ? p('цена', 'narx', 'price') : f === 'extra' ? p('нет в ЭСФ', 'EHFda yo‘q', 'not in invoice') : f);
  return (
    <div className="wms-warn">
      {diffs.map((d, i) => (
        <div key={i}>
          {p('Строка', 'Qator', 'Line')} {d.line}: {name(d.field)} — {p('ЭСФ', 'EHF', 'invoice')} {String(d.expected)}, {p('факт', 'fakt', 'actual')} {String(d.actual)}
        </div>
      ))}
    </div>
  );
}

export function ReceiptDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const can = useCan();
  const org = useOrg();
  const err = useWmsError('warehouse_err_');
  const r = useApi(() => warehouseApi.getReceipt(id), [id]);
  const cards = useApi(() => warehouseApi.listCards({ includeArchived: true }));
  const locs = useApi(() => warehouseApi.listLocations());
  const contracts = useApi(() => api.listContracts());
  const procs = useApi(() => api.listProcurement());
  const allRc = useApi(() => warehouseApi.listReceipts({}), [id]);
  const rcNo = (rid: string) => allRc.data?.find((y) => y.id === rid)?.number ?? rid;
  const [correct, setCorrect] = useState(false);
  const [reason, setReason] = useState('');
  const [accept, setAccept] = useState('');
  if (r.loading && !r.data) return <Card><Loading /></Card>;
  const x = r.data;
  if (!x) return <Card><Empty text={t('empty')} /></Card>;
  const canEdit = can('warehouse', 'edit');
  const card = (cid: string) => cards.data?.find((c) => c.id === cid);
  const loc = locs.data?.find((l) => l.id === x.warehouseId);
  const contract = contracts.data?.find((c) => c.id === x.contractId);
  const total = x.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const post = () => warehouseApi.postReceipt(x.id, user, accept || undefined).then(() => toast(`${x.number}: ${p('проведено', 'o‘tkazildi', 'posted')}`)).catch((e) => toast(err(e)));
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('warehouse_title'), to: '/warehouse/receipts' }, { label: x.number }]}
        title={`${p('Приходный ордер', 'Kirim orderi', 'Receipt order')} ${x.number}`}
        subtitle={`${formatDate(x.date)} · ${t(tk('warehouse_rcsrc_', x.source))}`}
        actions={
          <>
            <StatusBadge prefix="warehouse_rcst_" status={x.status} tone={RC_TONE[x.status]} />
            {canEdit && x.status === 'draft' && <Button icon="pen" onClick={() => navigate(`/warehouse/receipts/${x.id}/edit`)}>{p('Изменить', 'O‘zgartirish', 'Edit')}</Button>}
            {canEdit && x.status === 'draft' && <Button type="primary" icon="check" onClick={post}>{p('Провести', 'O‘tkazish', 'Post')}</Button>}
            {canEdit && x.status === 'draft' && <Button danger icon="trash" onClick={() => warehouseApi.deleteReceiptDraft(x.id, user).then(() => navigate('/warehouse/receipts')).catch((e) => toast(err(e)))}>{p('Удалить', 'O‘chirish', 'Delete')}</Button>}
            {canEdit && x.status === 'posted' && <Button icon="refresh" onClick={() => { setReason(''); setCorrect(true); }}>{p('Корректировка (сторно)', 'Tuzatish (storno)', 'Correction (reversal)')}</Button>}
            {x.status !== 'draft' && (
              <PrintButton
                template="act"
                label={p('Печать М-4', 'M-4 chop etish', 'Print M-4')}
                doc={() => ({
                  entity: 'warehouse_receipt', entityId: x.id, title: p('Приходный ордер (форма М-4)', 'Kirim orderi (M-4 shakli)', 'Receipt order (form M-4)'), number: x.number, date: x.date, place: loc?.name,
                  fields: [
                    { label: t('warehouse_warehouse'), value: loc?.name ?? x.warehouseId }, { label: t('warehouse_supplier'), value: x.supplierId ? lk.counterparty(x.supplierId)?.name ?? '' : '—' },
                    { label: p('Товарная накладная', 'Yuk xati', 'Waybill'), value: `${x.waybillNo} ${p('от', 'dan', 'of')} ${formatDate(x.waybillDate)}` }, { label: p('Договор', 'Shartnoma', 'Contract'), value: contract?.number ?? '—' },
                    { label: 'ЭСФ', value: x.einvoiceNumber ?? '—' }, { label: p('МВЗ', 'XMM', 'Cost center'), value: org.ccLabel(x.costCenterId) },
                  ],
                  table: { columns: [{ header: '№' }, { header: t('warehouse_item') }, { header: p('Ед.', 'Birl.', 'Unit') }, { header: t('qty'), align: 'right' }, { header: p('Цена', 'Narx', 'Price'), align: 'right' }, { header: t('amount'), align: 'right' }], rows: x.lines.map((l, i) => [String(i + 1), `${card(l.cardId)?.cardNo ?? ''} ${card(l.cardId)?.name ?? ''}`, card(l.cardId)?.unit ?? '', formatNumber(l.qty), formatMoney(l.price), formatMoney(l.qty * l.price)]), totals: ['', t('total'), '', '', '', formatMoney(total)] },
                  signers: [{ role: p('Принял (заведующий складом)', 'Qabul qildi (ombor mudiri)', 'Received by (warehouse manager)'), name: lk.user(loc?.managerId ?? '')?.fullName ?? '' }, { role: p('Сдал (поставщик)', 'Topshirdi (yetkazib beruvchi)', 'Delivered by (supplier)'), name: x.supplierId ? lk.counterparty(x.supplierId)?.name ?? '' : '' }],
                })}
              />
            )}
          </>
        }
      />
      <div className="wms-split">
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Реквизиты', 'Rekvizitlar', 'Details')}>
            <Kv items={[
              [t('warehouse_warehouse'), loc?.name ?? x.warehouseId],
              [t('warehouse_supplier'), x.supplierId ? lk.counterparty(x.supplierId)?.name : '—'],
              [p('Товарная накладная', 'Yuk xati', 'Waybill'), `${x.waybillNo} · ${formatDate(x.waybillDate)}`],
              [p('Договор', 'Shartnoma', 'Contract'), contract ? <Link to={`/contracts/${contract.id}`}>{contract.number} · {contract.subject}</Link> : '—'],
              [p('Закупка', 'Xarid', 'Procurement'), x.procurementId ? <Link to={`/procurement/${x.procurementId}`}>{(() => { const pr = procs.data?.find((y) => y.id === x.procurementId); return pr ? `${pr.number} · ${pr.title}` : x.procurementId; })()}</Link> : '—'],
              ['ЭСФ', x.einvoiceId ? <Link to={`/einvoices/${x.einvoiceId}`}>{x.einvoiceNumber}</Link> : '—'],
              [p('МВЗ', 'XMM', 'Cost center'), org.ccLabel(x.costCenterId)],
              ...(x.correctionOf ? [[p('Корректировка документа', 'Hujjat tuzatishi', 'Correction of'), <Link key="c" to={`/warehouse/receipts/${x.correctionOf}`}>{rcNo(x.correctionOf)}</Link>] as [string, ReactNode]] : []),
              ...(x.correctedBy ? [[p('Исправлено документом', 'Hujjat bilan tuzatilgan', 'Corrected by'), <Link key="d" to={`/warehouse/receipts/${x.correctedBy}`}>{rcNo(x.correctedBy)}</Link>] as [string, ReactNode]] : []),
              ...(x.diffAccepted ? [[p('Основание расхождений', 'Farqlar asosi', 'Mismatch reason'), x.diffAccepted] as [string, string]] : []),
            ]} />
          </Card>
          <Card title={p('Товары', 'Tovarlar', 'Goods')} flush>
            <DataTable rows={x.lines.map((l, i) => ({ ...l, i }))} rowKey={(l) => String(l.i)} columns={[
              { header: t('warehouse_item'), render: (l) => (<>{card(l.cardId) ? <Link to={`/warehouse/cards/${l.cardId}`}>{card(l.cardId)!.cardNo}</Link> : l.cardId} {card(l.cardId)?.name}{l.invoiceName && <div className="sub">ЭСФ: {l.invoiceName}</div>}</>) },
              { header: t('qty'), align: 'right', render: (l) => `${formatNumber(l.qty)} ${card(l.cardId)?.unit ?? ''}` },
              { header: p('Цена', 'Narx', 'Price'), align: 'right', render: (l) => formatMoney(l.price) },
              { header: t('amount'), align: 'right', render: (l) => formatMoney(l.qty * l.price) },
              { header: p('Годен до', 'Yaroqli', 'Expires'), render: (l) => l.expiryDate ?? '—' },
            ]} />
          </Card>
          {x.einvoiceId && (
            <Card title={p('Сверка со счётом-фактурой', 'Hisob-faktura bilan solishtirish', 'E-invoice reconciliation')}>
              <DiffList diffs={x.diffs ?? []} />
              {x.status === 'draft' && !!x.diffs?.length && canEdit && (
                <Field label={p('Основание для проведения с расхождениями', 'Farqlar bilan o‘tkazish asosi', 'Reason to post with differences')}>
                  <Textarea value={accept} onChange={(e) => setAccept(e.target.value)} rows={2} />
                </Field>
              )}
            </Card>
          )}
          {x.status !== 'draft' && <PostingsTable docId={x.id} />}
        </div>
        <div className="wms-pad" style={{ padding: 0 }}>
          <Attachments entity="warehouse_receipt" entityId={x.id} readOnly={!canEdit} title={p('Накладная, счёт-фактура, сканы', 'Yuk xati, hisob-faktura, skanlar', 'Waybill, invoice, scans')} />
          <Card title={t('history')}><Timeline events={x.history} /></Card>
        </div>
      </div>
      {correct && (
        <Modal title={p('Корректировка поступления', 'Kirimni tuzatish', 'Receipt correction')} onClose={() => setCorrect(false)} footer={<><Button onClick={() => setCorrect(false)}>{t('cancel')}</Button><Button type="primary" disabled={!reason.trim()} onClick={() => warehouseApi.correctReceipt(x.id, reason, user).then((c) => { toast(`${x.number}: ${p('сторно; создан черновик', 'storno; qoralama yaratildi', 'reversed; draft created')} ${c.number}`); setCorrect(false); navigate(`/warehouse/receipts/${c.id}/edit`); }).catch((e) => { toast(err(e)); })}>{p('Сторнировать и исправить', 'Storno qilish va tuzatish', 'Reverse and correct')}</Button></>}>
          <div className="wms-note">{p('Проведение отменяется обратной проводкой; создаётся черновик-копия для исправления. Возможно, только если партии ещё не расходовались.', 'O‘tkazish teskari provodka bilan bekor qilinadi; tuzatish uchun qoralama nusxa yaratiladi. Faqat partiyalar sarflanmagan bo‘lsa.', 'Posting is cancelled by a reversing entry; a draft copy is created. Only if batches are unused.')}</div>
          <Field label={p('Причина', 'Sabab', 'Reason')} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
        </Modal>
      )}
    </>
  );
}
