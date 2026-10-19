// Склад: акты списания ТМЗ и МБП — комиссия (подписи E-IMZO), причина из справочника, согласование
// (бухгалтерия, свыше 50 млн — финансы), проведение по FIFO, проводки (МБП — с подписью E-IMZO), печатная форма с QR.
import { useState } from 'react';
import { formatDate, formatDateTime, formatMoney, formatNumber, tk, warehouseApi, type WarehouseWriteoff, type WarehouseWriteoffKind, type WarehouseWriteoffReason } from '@xb/shared';
import { Button, Card, DataTable, Empty, Field, FilterBar, Input, Loading, PageHeader, Select, StatusBadge, Textarea, Timeline, useToast, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { ApprovalBlock, Kv, OrgUnitSelect, PostingsTable, SignAction, UserSelect, UsersPicker, useOrg, useP, useQueryParam, useWmsError } from './wmsShared';

export const WO_TONE: Record<WarehouseWriteoff['status'], Tone> = { draft: 'muted', commission: 'info', pending: 'warn', returned: 'warn', rejected: 'danger', posted: 'ok' };
export const REASONS: WarehouseWriteoffReason[] = ['damage', 'expired', 'shortage', 'obsolete', 'wear', 'lost', 'other'];

export function WriteoffsTab() {
  const { t } = useSession();
  const p = useP();
  const can = useCan();
  const org = useOrg();
  const [kind, setKind] = useState<WarehouseWriteoffKind | ''>('');
  const [status, setStatus] = useState<WarehouseWriteoff['status'] | ''>('');
  const [search, setSearch] = useState('');
  const list = useApi(() => warehouseApi.listWriteoffs({ search, ...(kind ? { kind } : {}), ...(status ? { status } : {}) }), [search, kind, status]);
  const cols: Column<WarehouseWriteoff>[] = [
    { header: p('Акт', 'Dalolatnoma', 'Act'), render: (w) => (<><span className="doc-num">{w.number}</span><div className="sub">{t(tk('warehouse_wokind_', w.kind))}</div></>) },
    { header: t('date'), render: (w) => formatDate(w.date) },
    { header: p('Причина', 'Sabab', 'Reason'), render: (w) => (<>{t(tk('warehouse_reason_', w.reason))}<div className="sub">{w.reasonText}</div></>) },
    { header: p('МВЗ', 'XMM', 'CC'), render: (w) => <span className="wms-mono">{org.ccCode(w.costCenterId)}</span> },
    { header: t('amount'), align: 'right', render: (w) => formatMoney(w.amount) },
    { header: t('status'), render: (w) => <StatusBadge prefix="warehouse_wost_" status={w.status} tone={WO_TONE[w.status]} /> },
  ];
  return (
    <>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('number')}, ${p('причина', 'sabab', 'reason')}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select<WarehouseWriteoffKind> value={kind} onChange={setKind} placeholder={`${p('Вид', 'Turi', 'Kind')}: ${t('all')}`} options={(['tmz', 'mbp'] as const).map((k) => ({ value: k, label: t(tk('warehouse_wokind_', k)) }))} />
        <Select<WarehouseWriteoff['status']> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={(['draft', 'commission', 'pending', 'returned', 'rejected', 'posted'] as const).map((s) => ({ value: s, label: t(tk('warehouse_wost_', s)) }))} />
        {can('warehouse', 'edit') && <Button type="primary" icon="plus" onClick={() => navigate('/warehouse/writeoffs/new')}>{p('Акт списания ТМЗ', 'TMZ dalolatnomasi', 'Inventory write-off act')}</Button>}
        {can('warehouse', 'edit') && <Button icon="plus" onClick={() => navigate('/warehouse/writeoffs/new?kind=mbp')}>{p('Акт списания МБП', 'MBP dalolatnomasi', 'LVI write-off act')}</Button>}
        <ExportButton filename={p('Акты списания', 'Hisobdan chiqarish dalolatnomalari', 'Write-off acts')} rows={list.data ?? []} columns={[
          { header: t('number'), value: (w) => w.number }, { header: t('date'), value: (w) => w.date }, { header: p('Вид', 'Turi', 'Kind'), value: (w) => t(tk('warehouse_wokind_', w.kind)) },
          { header: p('Причина', 'Sabab', 'Reason'), value: (w) => `${t(tk('warehouse_reason_', w.reason))}: ${w.reasonText}` }, { header: p('МВЗ', 'XMM', 'CC'), value: (w) => org.ccCode(w.costCenterId) },
          { header: t('amount'), value: (w) => w.amount, format: 'money', total: true }, { header: t('status'), value: (w) => t(tk('warehouse_wost_', w.status)) },
        ]} />
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(w) => w.id} columns={cols} onRowClick={(w) => navigate(`/warehouse/writeoffs/${w.id}`)} />
    </>
  );
}

export function WriteoffFormPage() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('warehouse_err_');
  const [kind, setKind] = useState<WarehouseWriteoffKind>(useQueryParam('kind') === 'mbp' ? 'mbp' : 'tmz');
  const [wh, setWh] = useState('wh1');
  const [unit, setUnit] = useState('');
  const [reason, setReason] = useState<WarehouseWriteoffReason>('damage');
  const [text, setText] = useState('');
  const [chair, setChair] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [order, setOrder] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const locs = useApi(() => warehouseApi.listLocations());
  const items = useApi(() => warehouseApi.listItems({ warehouseId: wh }), [wh]);
  const mbp = useApi(() => (unit ? warehouseApi.listMbp({ orgUnitKey: unit, status: 'in_use' }) : Promise.resolve([])), [unit]);
  const rows = kind === 'tmz' ? (items.data ?? []).filter((i) => i.qty - i.reserved > 0).map((i) => ({ id: i.id, label: `${i.sku} · ${i.name}`, max: i.qty - i.reserved, unit: i.unit, price: i.unitCost })) : (mbp.data ?? []).map((m) => ({ id: m.id, label: `${m.number} · ${m.name}`, max: m.qty, unit: m.unit, price: m.unitCost }));
  const total = rows.reduce((s, r) => s + (qty[r.id] ?? 0) * r.price, 0);
  async function save() {
    setError('');
    try {
      const w = await warehouseApi.createWriteoff({ kind, ...(kind === 'tmz' ? { warehouseId: wh } : { orgUnitKey: unit }), reason, reasonText: text, commission: { chairmanId: chair, memberIds: members, orderNo: order }, lines: Object.entries(qty).filter(([, q]) => q > 0).map(([refId, q]) => ({ refId, qty: q })) }, user);
      toast(`${w.number}: ${t('saved')}`);
      navigate(`/warehouse/writeoffs/${w.id}`);
    } catch (e) {
      setError(err(e));
    }
  }
  return (
    <>
      <PageHeader crumbs={[{ label: t('warehouse_title'), to: '/warehouse/writeoffs' }, { label: p('Новый акт', 'Yangi dalolatnoma', 'New act') }]} title={p('Акт списания', 'Hisobdan chiqarish dalolatnomasi', 'Write-off act')} />
      <Card title={p('Основание и комиссия', 'Asos va komissiya', 'Basis and commission')}>
        <div className="wms-form-grid">
          <Field label={p('Вид', 'Turi', 'Kind')} required><Select<WarehouseWriteoffKind> value={kind} onChange={(v) => { setKind(v); setQty({}); }} options={(['tmz', 'mbp'] as const).map((k) => ({ value: k, label: t(tk('warehouse_wokind_', k)) }))} /></Field>
          {kind === 'tmz' ? (
            <Field label={t('warehouse_warehouse')} required><Select value={wh} onChange={(v) => { setWh(v); setQty({}); }} options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Field>
          ) : (
            <Field label={p('ЦБУ / подразделение (МБП в эксплуатации)', 'BXM / bo‘linma (foydalanishdagi MBP)', 'Branch / unit (LVI in use)')} required><OrgUnitSelect value={unit} onChange={(v) => { setUnit(v); setQty({}); }} /></Field>
          )}
          <Field label={p('Причина (справочник)', 'Sabab (ma’lumotnoma)', 'Reason (catalogue)')} required><Select<WarehouseWriteoffReason> value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: t(tk('warehouse_reason_', r)) }))} /></Field>
          <Field label={p('Приказ о комиссии №', 'Komissiya buyrug‘i №', 'Commission order no.')} required><Input value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
          <Field label={p('Описание причины', 'Sabab tavsifi', 'Reason description')} required className="wide"><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} /></Field>
          <Field label={p('Председатель комиссии', 'Komissiya raisi', 'Commission chairman')} required><UserSelect value={chair} onChange={setChair} /></Field>
          <Field label={p('Члены комиссии (не менее двух)', 'Komissiya a’zolari (kamida ikki)', 'Members (at least two)')} required><UsersPicker value={members} onChange={setMembers} exclude={chair ? [chair] : []} /></Field>
        </div>
      </Card>
      <Card title={kind === 'tmz' ? p('Товары к списанию', 'Hisobdan chiqariladigan tovarlar', 'Items to write off') : p('Список МБП, подлежащих списанию', 'Hisobdan chiqariladigan MBP ro‘yxati', 'LVI to write off')}>
        {rows.length ? (
          <div className="wms-lines-wrap">
            <table className="wms-lines">
              <thead><tr><th>{t('warehouse_item')}</th><th className="num">{p('Доступно', 'Mavjud', 'Available')}</th><th className="num">{t('warehouse_unitCost')}</th><th>{t('qty')}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td className="num">{formatNumber(r.max)} {r.unit}</td>
                    <td className="num">{formatMoney(r.price)}</td>
                    <td style={{ width: 120 }}><Input type="number" value={qty[r.id] ?? ''} ariaLabel={`${t('qty')} ${r.label}`} onChange={(e) => setQty((q) => ({ ...q, [r.id]: Number(e.target.value) }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text={kind === 'mbp' && !unit ? p('Выберите ЦБУ / подразделение', 'BXM / bo‘linmani tanlang', 'Choose a branch / unit') : t('empty')} />}
        <div className="wms-row end" style={{ marginTop: 10 }}><b>{t('total')}: {formatMoney(total)}</b></div>
        {error && <div className="error-text">{error}</div>}
        <div className="wms-row end" style={{ marginTop: 10 }}>
          <Button onClick={() => navigate('/warehouse/writeoffs')}>{t('cancel')}</Button>
          <Button type="primary" onClick={save}>{p('Составить акт', 'Dalolatnoma tuzish', 'Create act')}</Button>
        </div>
      </Card>
    </>
  );
}

export function WriteoffDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const can = useCan();
  const org = useOrg();
  const err = useWmsError('warehouse_err_');
  const d = useApi(() => warehouseApi.getWriteoff(id), [id]);
  const items = useApi(() => warehouseApi.listItems({ includeEmpty: true }));
  const mbp = useApi(() => warehouseApi.listMbp({ status: 'all' }));
  const locs = useApi(() => warehouseApi.listLocations());
  if (d.loading && !d.data) return <Card><Loading /></Card>;
  const w = d.data;
  if (!w) return <Card><Empty text={t('empty')} /></Card>;
  const members = [w.commission.chairmanId, ...w.commission.memberIds];
  const ref = (rid: string) => (w.kind === 'tmz' ? (() => { const i = items.data?.find((x) => x.id === rid); return i ? { label: `${i.sku} · ${i.name}`, unit: i.unit } : { label: rid, unit: '' }; })() : (() => { const m = mbp.data?.find((x) => x.id === rid); return m ? { label: `${m.number} · ${m.name}`, unit: m.unit } : { label: rid, unit: '' }; })());
  const signDoc = { entity: 'warehouse_writeoff', entityId: w.id, title: `${w.number} · ${w.reasonText}`, content: { number: w.number, lines: w.lines, reason: w.reason } };
  const signed = (uid: string) => w.commissionSignatures.find((s) => s.userId === uid);
  const place = w.warehouseId ? locs.data?.find((l) => l.id === w.warehouseId)?.name : org.unitName(w.orgUnitKey);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('warehouse_title'), to: '/warehouse/writeoffs' }, { label: w.number }]}
        title={`${p('Акт списания', 'Hisobdan chiqarish dalolatnomasi', 'Write-off act')} ${w.number}`}
        subtitle={`${t(tk('warehouse_wokind_', w.kind))} · ${formatDate(w.date)} · ${place ?? ''}`}
        actions={
          <>
            <StatusBadge prefix="warehouse_wost_" status={w.status} tone={WO_TONE[w.status]} />
            {can('warehouse', 'edit') && (w.status === 'draft' || w.status === 'returned') && <Button type="primary" icon="users" onClick={() => warehouseApi.sendToCommission(w.id, user).then(() => toast(p('Передано комиссии на подпись', 'Komissiyaga imzoga yuborildi', 'Sent to the commission for signature'))).catch((e) => toast(err(e)))}>{p('Передать комиссии', 'Komissiyaga yuborish', 'Send to commission')}</Button>}
            <PrintButton template="act" label={p('Печать акта', 'Dalolatnomani chop etish', 'Print act')} doc={() => ({
              entity: 'warehouse_writeoff', entityId: w.id, title: w.kind === 'mbp' ? p('Акт списания МБП', 'MBP hisobdan chiqarish dalolatnomasi', 'LVI write-off act') : p('Акт списания товарно-материальных запасов', 'TMZ hisobdan chiqarish dalolatnomasi', 'Inventory write-off act'), number: w.number, date: w.date, place: place ?? '',
              fields: [{ label: p('Причина', 'Sabab', 'Reason'), value: `${t(tk('warehouse_reason_', w.reason))}: ${w.reasonText}` }, { label: p('Приказ о комиссии', 'Komissiya buyrug‘i', 'Commission order'), value: w.commission.orderNo }, { label: p('МВЗ', 'XMM', 'Cost center'), value: org.ccLabel(w.costCenterId) }],
              paragraphs: [p('Комиссия в составе, указанном ниже, произвела осмотр и установила необходимость списания следующих ценностей:', 'Quyida ko‘rsatilgan tarkibdagi komissiya ko‘zdan kechirib, quyidagi qimmatliklarni hisobdan chiqarish zarurligini aniqladi:', 'The commission listed below inspected and confirmed the write-off of the following items:')],
              table: { columns: [{ header: '№' }, { header: t('warehouse_item') }, { header: t('qty'), align: 'right' }, { header: t('amount'), align: 'right' }], rows: w.lines.map((l, i) => [String(i + 1), ref(l.refId).label, `${formatNumber(l.qty)} ${ref(l.refId).unit}`, formatMoney(l.amount)]), totals: ['', t('total'), '', formatMoney(w.amount)] },
              signers: members.map((m, i) => ({ role: i === 0 ? p('Председатель комиссии', 'Komissiya raisi', 'Chairman') : p('Член комиссии', 'Komissiya a’zosi', 'Member'), name: lk.user(m)?.fullName ?? m, ...(signed(m) ? { signatureId: signed(m)!.signatureId } : {}) })),
            })} />
          </>
        }
      />
      <div className="wms-split">
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Реквизиты', 'Rekvizitlar', 'Details')}>
            <Kv items={[
              [p('Причина', 'Sabab', 'Reason'), `${t(tk('warehouse_reason_', w.reason))} — ${w.reasonText}`],
              [p('Место', 'Joy', 'Location'), place ?? '—'],
              [p('Приказ о комиссии', 'Komissiya buyrug‘i', 'Commission order'), w.commission.orderNo],
              [p('МВЗ', 'XMM', 'Cost center'), org.ccLabel(w.costCenterId)],
              [t('amount'), formatMoney(w.amount)],
              [t('initiator'), lk.user(w.createdBy)?.fullName ?? w.createdBy],
            ]} />
          </Card>
          <Card title={p('Списываемые ценности', 'Hisobdan chiqariladigan qimmatliklar', 'Items')} flush>
            <DataTable rows={w.lines} rowKey={(l) => l.refId} columns={[
              { header: t('warehouse_item'), render: (l) => ref(l.refId).label },
              { header: t('qty'), align: 'right', render: (l) => `${formatNumber(l.qty)} ${ref(l.refId).unit}` },
              { header: t('amount'), align: 'right', render: (l) => formatMoney(l.amount) },
            ]} />
          </Card>
          <Card title={p('Подписи комиссии (E-IMZO)', 'Komissiya imzolari (E-IMZO)', 'Commission signatures (E-IMZO)')}>
            <div className="wms-sigs">
              {members.map((m, i) => (
                <div key={m} className={`wms-sig ${signed(m) ? 'done' : ''}`}>
                  <b>{i === 0 ? p('Председатель', 'Rais', 'Chairman') : p('Член комиссии', 'A’zo', 'Member')}</b>
                  <span>{lk.user(m)?.fullName ?? m}</span>
                  {signed(m) ? <span className="wms-note">✓ E-IMZO · {formatDateTime(signed(m)!.at)}</span> : w.status === 'commission' && user.id === m ? (
                    <SignAction doc={signDoc} label={p('Подписать', 'Imzolash', 'Sign')} onSigned={(sid) => warehouseApi.signWriteoff(w.id, sid, user).then(() => toast(p('Акт подписан', 'Dalolatnoma imzolandi', 'Act signed')))} />
                  ) : <span className="wms-note">{w.status === 'commission' ? p('Ожидает подписи', 'Imzo kutilmoqda', 'Awaiting signature') : '—'}</span>}
                </div>
              ))}
            </div>
          </Card>
          <ApprovalBlock entityId={w.id} preview={{ entity: 'warehouse_writeoff', context: { amount: w.amount, subtype: w.kind } }} />
          {w.status === 'posted' && <PostingsTable docId={w.id} title={w.kind === 'mbp' ? p('Автоматические проводки (подписываются E-IMZO)', 'Avtomatik provodkalar (E-IMZO bilan imzolanadi)', 'Automatic postings (signed with E-IMZO)') : undefined} />}
        </div>
        <div className="wms-pad" style={{ padding: 0 }}>
          <Attachments entity="warehouse_writeoff" entityId={w.id} title={p('Протокол комиссии, фото', 'Komissiya bayonnomasi, foto', 'Commission protocol, photos')} />
          <Card title={t('history')}><Timeline events={w.history} /></Card>
        </div>
      </div>
    </>
  );
}
