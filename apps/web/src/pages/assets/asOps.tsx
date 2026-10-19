// ОС: операции (передачи по акту/распоряжению, переоценка, включение в состав и др.) и акты о списании ОС-4
// (комиссия, подписи E-IMZO, согласование, продажа с НДС по решению Правления, загрузка из Excel).
import { useState } from 'react';
import { assetNbv, assetsApi, canAccountAssets, formatDate, formatDateTime, formatMoney, importRegistry, tk, type AssetOperation, type AssetOpType, type AssetWriteoffAct } from '@xb/shared';
import { Button, Card, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, StatusBadge, Textarea, Timeline, useToast, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { ImportWizard } from '../../components/Import';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { ApprovalBlock, Kv, PostingsTable, SignAction, useOrg, useP, useWmsError } from '../warehouse/wmsShared';

export const OP_TONE: Record<AssetOperation['status'], Tone> = { awaiting_acceptance: 'info', pending: 'warn', returned: 'warn', completed: 'ok', rejected: 'danger', cancelled: 'muted' };
export const AWO_TONE: Record<AssetWriteoffAct['status'], Tone> = { draft: 'muted', commission: 'info', pending: 'warn', returned: 'warn', rejected: 'danger', completed: 'ok' };
const OP_TYPES: AssetOpType[] = ['registration', 'intake', 'transfer_mol', 'transfer_dept', 'transfer_cbu', 'transfer_branch', 'category_change', 'revaluation', 'improvement', 'separation', 'repair', 'lease_out', 'lease_end', 'correction'];

export function OperationsTab() {
  const { t } = useSession();
  const p = useP();
  const [type, setType] = useState<AssetOpType | ''>('');
  const [status, setStatus] = useState<AssetOperation['status'] | ''>('');
  const [search, setSearch] = useState('');
  const list = useApi(() => assetsApi.listOperations({ search, ...(type ? { type } : {}), ...(status ? { status } : {}) }), [search, type, status]);
  const assets = useApi(() => assetsApi.list({ includeDisposed: true }));
  const inv = (ids: string[]) => ids.map((id) => assets.data?.find((a) => a.id === id)?.inventoryNo ?? id).join(', ');
  const cols: Column<AssetOperation>[] = [
    { header: t('number'), render: (o) => (<><span className="doc-num">{o.orderNo ?? o.number}</span>{o.orderNo && <div className="sub">{o.number}</div>}</>) },
    { header: t('date'), render: (o) => formatDate(o.date) },
    { header: p('Операция', 'Operatsiya', 'Operation'), render: (o) => t(tk('assets_op_', o.type)) },
    { header: p('Объекты', 'Obyektlar', 'Assets'), render: (o) => <span className="wms-mono">{inv(o.assetIds)}</span> },
    { header: p('Основание', 'Asos', 'Reason'), render: (o) => <span className="wms-note">{o.reason}</span> },
    { header: t('amount'), align: 'right', render: (o) => (o.amount ? formatMoney(o.amount) : '—') },
    { header: t('status'), render: (o) => <StatusBadge prefix="assets_opst_" status={o.status} tone={OP_TONE[o.status]} /> },
  ];
  return (
    <>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('number')}, ${p('основание', 'asos', 'reason')}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select<AssetOpType> value={type} onChange={setType} placeholder={`${p('Операция', 'Operatsiya', 'Operation')}: ${t('all')}`} options={OP_TYPES.map((x) => ({ value: x, label: t(tk('assets_op_', x)) }))} />
        <Select<AssetOperation['status']> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={(['awaiting_acceptance', 'pending', 'returned', 'completed', 'rejected', 'cancelled'] as const).map((s) => ({ value: s, label: t(tk('assets_opst_', s)) }))} />
        <ExportButton filename={p('Операции ОС', 'AV operatsiyalari', 'Asset operations')} rows={list.data ?? []} columns={[
          { header: t('number'), value: (o) => o.orderNo ?? o.number }, { header: t('date'), value: (o) => o.date }, { header: p('Операция', 'Operatsiya', 'Operation'), value: (o) => t(tk('assets_op_', o.type)) },
          { header: p('Объекты', 'Obyektlar', 'Assets'), value: (o) => inv(o.assetIds) }, { header: p('Основание', 'Asos', 'Reason'), value: (o) => o.reason }, { header: t('amount'), value: (o) => o.amount, format: 'money', total: true }, { header: t('status'), value: (o) => t(tk('assets_opst_', o.status)) },
        ]} />
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(o) => o.id} columns={cols} onRowClick={(o) => navigate(`/assets/operations/${o.id}`)} />
    </>
  );
}

export function OperationDetailPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const org = useOrg();
  const err = useWmsError('assets_err_');
  const d = useApi(() => assetsApi.getOperation(id), [id]);
  const assets = useApi(() => assetsApi.list({ includeDisposed: true }));
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  if (d.loading && !d.data) return <Card><Loading /></Card>;
  const o = d.data;
  if (!o) return <Card><Empty text={t('empty')} /></Card>;
  const list = o.assetIds.map((aid) => assets.data?.find((a) => a.id === aid)).filter((a): a is NonNullable<typeof a> => !!a);
  const fmtVal = (k: string, v: string | number) => (k === 'responsibleId' ? lk.user(String(v))?.fullName ?? v : k === 'orgUnitKey' ? org.unitName(String(v)) : k === 'costCenterId' ? org.ccLabel(String(v)) : k === 'departmentId' ? (lk.department(String(v)) ? loc(lk.department(String(v))!.name) : v) : typeof v === 'number' ? formatMoney(v) : String(v));
  const keyLabel = (k: string) => ({ responsibleId: t('assets_responsible'), orgUnitKey: p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit'), costCenterId: p('МВЗ', 'XMM', 'Cost center'), departmentId: t('department'), location: t('assets_location'), cost: t('assets_cost'), revaluation: p('Дооценка', 'Qayta baholash', 'Revaluation'), groupId: p('Группа', 'Guruh', 'Group') }[k] ?? k);
  const canAccept = o.status === 'awaiting_acceptance' && (o.to?.responsibleId === user.id || user.role === 'admin');
  const isOrder = o.type === 'transfer_cbu' || o.type === 'transfer_dept' || o.type === 'transfer_branch';
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('assets_title'), to: '/assets/operations' }, { label: o.orderNo ?? o.number }]}
        title={`${t(tk('assets_op_', o.type))} ${o.orderNo ?? o.number}`}
        subtitle={`${formatDate(o.date)} · ${lk.user(o.createdBy)?.fullName ?? o.createdBy}`}
        actions={
          <>
            <StatusBadge prefix="assets_opst_" status={o.status} tone={OP_TONE[o.status]} />
            {canAccept && <SignAction errPrefix="assets_err_" doc={{ entity: 'asset_operation', entityId: o.id, title: `${o.orderNo ?? o.number} · ${o.reason}`, content: { assets: o.assetIds, to: o.to } }} label={p('Принять (E-IMZO)', 'Qabul qilish (E-IMZO)', 'Accept (E-IMZO)')} onSigned={(sid) => assetsApi.acceptTransfer(o.id, sid, user).then(() => toast(p('ОС приняты по акту', 'AV dalolatnoma bo‘yicha qabul qilindi', 'Assets accepted')))} />}
            {canAccept && <Button danger onClick={() => { setReason(''); setReject(true); }}>{p('Отказаться', 'Rad etish', 'Decline')}</Button>}
            {(o.status === 'awaiting_acceptance' || o.status === 'returned') && (o.createdBy === user.id || canAccountAssets(user)) && <Button onClick={() => assetsApi.cancelOperation(o.id, user).then(() => toast(t('saved'))).catch((e) => toast(err(e)))}>{p('Отменить', 'Bekor qilish', 'Cancel')}</Button>}
            <PrintButton template="act" label={isOrder ? p('Печать распоряжения', 'Farmoyishni chop etish', 'Print order') : p('Печать акта', 'Dalolatnomani chop etish', 'Print act')} doc={() => ({
              entity: 'asset_operation', entityId: o.id, title: isOrder ? p('Распоряжение о передаче основных средств', 'Asosiy vositalarni topshirish to‘g‘risida farmoyish', 'Order on transfer of fixed assets') : o.type === 'transfer_mol' ? p('Акт приёма-передачи основных средств между МОЛ', 'MJSlar o‘rtasida asosiy vositalarni qabul qilish-topshirish dalolatnomasi', 'Fixed assets handover act between custodians') : t(tk('assets_op_', o.type)), number: o.orderNo ?? o.number, date: o.date,
              fields: [...Object.entries(o.to ?? {}).map(([k, v]) => ({ label: `${keyLabel(k)} (${p('новое', 'yangi', 'new')})`, value: String(fmtVal(k, v)) })), ...Object.entries(o.from ?? {}).filter(([k]) => o.to && k in o.to).map(([k, v]) => ({ label: `${keyLabel(k)} (${p('было', 'edi', 'was')})`, value: String(fmtVal(k, v)) })), { label: p('Основание', 'Asos', 'Reason'), value: o.reason }],
              table: { columns: [{ header: t('assets_invNo') }, { header: t('assets_name') }, { header: t('assets_cost'), align: 'right' }, { header: t('assets_accumulated'), align: 'right' }, { header: t('assets_nbv'), align: 'right' }], rows: list.map((a) => [a.inventoryNo, a.name, formatMoney(a.cost), formatMoney(a.accumulated), formatMoney(assetNbv(a))]) },
              signers: [{ role: p('Передал', 'Topshirdi', 'Handed over'), name: lk.user(String(o.from?.responsibleId ?? o.createdBy))?.fullName ?? '' }, { role: p('Принял', 'Qabul qildi', 'Accepted'), name: lk.user(String(o.to?.responsibleId ?? ''))?.fullName ?? '', ...(o.acceptance ? { signatureId: o.acceptance.signatureId } : {}) }],
            })} />
          </>
        }
      />
      <div className="wms-split">
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Было → стало', 'Edi → bo‘ldi', 'From → to')}>
            <Kv items={[...Object.entries(o.to ?? {}).map(([k, v]) => [keyLabel(k), `${o.from && k in o.from ? `${fmtVal(k, o.from[k]!)} → ` : ''}${fmtVal(k, v)}`] as [string, string]), [p('Основание', 'Asos', 'Reason'), o.reason], ...(o.acceptance ? [[p('Принято', 'Qabul qilingan', 'Accepted'), `${lk.user(o.acceptance.userId)?.fullName} · E-IMZO · ${formatDateTime(o.acceptance.at)}`] as [string, string]] : [])]} />
          </Card>
          <Card title={p('Объекты', 'Obyektlar', 'Assets')} flush>
            <DataTable rows={list} rowKey={(a) => a.id} columns={[
              { header: t('assets_invNo'), render: (a) => <Link to={`/assets/${a.id}`} className="doc-num">{a.inventoryNo}</Link> },
              { header: t('assets_name'), render: (a) => a.name },
              { header: t('assets_cost'), align: 'right', render: (a) => formatMoney(a.cost) },
              { header: t('assets_nbv'), align: 'right', render: (a) => formatMoney(assetNbv(a)) },
            ]} />
          </Card>
          {isOrder && <ApprovalBlock entityId={o.id} preview={{ entity: 'asset_transfer', context: { subtype: o.type.replace('transfer_', ''), amount: o.amount } }} />}
          {o.postingId && <PostingsTable docId={o.id} />}
        </div>
        <div className="wms-pad" style={{ padding: 0 }}>
          <Attachments entity="asset_operation" entityId={o.id} />
          <Card title={t('history')}><Timeline events={o.history} /></Card>
        </div>
      </div>
      {reject && (
        <Modal title={p('Отказ от приёма', 'Qabul qilishdan voz kechish', 'Decline acceptance')} onClose={() => setReject(false)} footer={<><Button onClick={() => setReject(false)}>{t('cancel')}</Button><Button danger disabled={!reason.trim()} onClick={() => assetsApi.acceptTransfer(o.id, null, user, reason).then(() => { setReject(false); toast(t('saved')); }).catch((e) => toast(err(e)))}>{p('Отказаться', 'Rad etish', 'Decline')}</Button></>}>
          <Field label={p('Причина', 'Sabab', 'Reason')} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
        </Modal>
      )}
    </>
  );
}

export function WriteoffsTab() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const [status, setStatus] = useState<AssetWriteoffAct['status'] | ''>('');
  const [importing, setImporting] = useState(false);
  const list = useApi(() => assetsApi.listWriteoffs(status ? { status } : {}), [status]);
  const assets = useApi(() => assetsApi.list({ includeDisposed: true }));
  const target = importRegistry.get('asset_writeoff');
  const inv = (ids: string[]) => ids.map((id) => assets.data?.find((a) => a.id === id)?.inventoryNo ?? id).join(', ');
  return (
    <>
      <FilterBar>
        <Select<AssetWriteoffAct['status']> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={(['draft', 'commission', 'pending', 'returned', 'rejected', 'completed'] as const).map((s) => ({ value: s, label: t(tk('assets_wost_', s)) }))} />
        {canAccountAssets(user) && target && <Button icon="upload" onClick={() => setImporting(true)}>{p('Списание из Excel', 'Exceldan hisobdan chiqarish', 'Write-off from Excel')}</Button>}
        <ExportButton filename={p('Акты списания ОС', 'AV hisobdan chiqarish dalolatnomalari', 'Asset write-off acts')} rows={list.data ?? []} columns={[
          { header: t('number'), value: (w) => w.number }, { header: t('date'), value: (w) => w.date }, { header: p('Вид', 'Turi', 'Kind'), value: (w) => t(tk('assets_wokind_', w.kind)) }, { header: p('Объекты', 'Obyektlar', 'Assets'), value: (w) => inv(w.assetIds) },
          { header: t('assets_nbv'), value: (w) => w.nbv, format: 'money', total: true }, { header: p('Цена продажи', 'Sotish narxi', 'Sale price'), value: (w) => w.salePrice ?? null, format: 'money' }, { header: p('НДС', 'QQS', 'VAT'), value: (w) => w.vat ?? null, format: 'money' }, { header: t('status'), value: (w) => t(tk('assets_wost_', w.status)) },
        ]} />
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(w) => w.id} onRowClick={(w) => navigate(`/assets/writeoffs/${w.id}`)} columns={[
        { header: p('Акт ОС-4', 'OS-4 dalolatnomasi', 'OS-4 act'), render: (w) => (<><span className="doc-num">{w.number}</span><div className="sub">{t(tk('assets_wokind_', w.kind))}{w.source === 'excel' ? ' · Excel' : ''}</div></>) },
        { header: t('date'), render: (w) => formatDate(w.date) },
        { header: p('Объекты', 'Obyektlar', 'Assets'), render: (w) => <span className="wms-mono">{inv(w.assetIds)}</span> },
        { header: p('Основание', 'Asos', 'Reason'), render: (w) => <span className="wms-note">{w.reason}</span> },
        { header: t('assets_nbv'), align: 'right', render: (w) => formatMoney(w.nbv) },
        { header: t('status'), render: (w) => <StatusBadge prefix="assets_wost_" status={w.status} tone={AWO_TONE[w.status]} /> },
      ]} />
      {importing && target && (
        <Modal title={p('Списание ОС по протоколу из Excel', 'Bayonnoma bo‘yicha AVni Exceldan hisobdan chiqarish', 'Asset write-off from Excel')} onClose={() => setImporting(false)} footer={<Button onClick={() => setImporting(false)}>{t('svc_printClose')}</Button>}>
          <ImportWizard target={target} onDone={() => list.reload()} />
        </Modal>
      )}
    </>
  );
}

export function WriteoffActPage({ id }: { id: string }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const org = useOrg();
  const err = useWmsError('assets_err_');
  const d = useApi(() => assetsApi.getWriteoff(id), [id]);
  const assets = useApi(() => assetsApi.list({ includeDisposed: true }));
  if (d.loading && !d.data) return <Card><Loading /></Card>;
  const w = d.data;
  if (!w) return <Card><Empty text={t('empty')} /></Card>;
  const list = w.assetIds.map((aid) => assets.data?.find((a) => a.id === aid)).filter((a): a is NonNullable<typeof a> => !!a);
  const members = [w.commission.chairmanId, ...w.commission.memberIds];
  const signed = (uid: string) => w.commissionSignatures.find((s) => s.userId === uid);
  const signDoc = { entity: 'asset_writeoff', entityId: w.id, title: `${w.number} · ${w.reason}`, content: { number: w.number, assets: w.assetIds, kind: w.kind, protocol: w.commission.protocolNo } };
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('assets_title'), to: '/assets/writeoffs' }, { label: w.number }]}
        title={`${p('Акт о списании ОС', 'AV hisobdan chiqarish dalolatnomasi', 'Asset write-off act')} ${w.number}`}
        subtitle={`${t(tk('assets_wokind_', w.kind))} · ${formatDate(w.date)}`}
        actions={
          <>
            <StatusBadge prefix="assets_wost_" status={w.status} tone={AWO_TONE[w.status]} />
            {(w.status === 'draft' || w.status === 'returned') && (w.createdBy === user.id || canAccountAssets(user)) && <Button type="primary" icon="users" onClick={() => assetsApi.sendWriteoffToCommission(w.id, user).then(() => toast(p('Протокол передан комиссии', 'Bayonnoma komissiyaga yuborildi', 'Protocol sent to the commission'))).catch((e) => toast(err(e)))}>{p('Передать комиссии', 'Komissiyaga yuborish', 'Send to commission')}</Button>}
            <PrintButton template="act" label={p('Печать ОС-4', 'OS-4 chop etish', 'Print OS-4')} doc={() => ({
              entity: 'asset_writeoff', entityId: w.id, title: p('Акт о списании объекта основных средств (форма ОС-4)', 'Asosiy vosita obyektini hisobdan chiqarish dalolatnomasi (OS-4 shakli)', 'Fixed asset write-off act (form OS-4)'), number: w.number, date: w.date,
              fields: [
                { label: p('Вид выбытия', 'Chiqib ketish turi', 'Disposal type'), value: t(tk('assets_wokind_', w.kind)) }, { label: p('Протокол комиссии', 'Komissiya bayonnomasi', 'Commission protocol'), value: w.commission.protocolNo }, { label: p('Основание', 'Asos', 'Reason'), value: w.reason },
                { label: p('МВЗ', 'XMM', 'Cost center'), value: org.ccLabel(w.costCenterId) },
                ...(w.kind === 'sale' ? [{ label: p('Решение Правления', 'Boshqaruv qarori', 'Board decision'), value: w.boardDecisionNo ?? '' }, { label: p('Цена без НДС / НДС', 'QQSsiz narx / QQS', 'Price excl. VAT / VAT'), value: `${formatMoney(w.salePrice ?? 0)} / ${formatMoney(w.vat ?? 0)}` }] : []),
                ...(w.recipient ? [{ label: p('Получатель', 'Qabul qiluvchi', 'Recipient'), value: w.recipient }] : []),
              ],
              table: { columns: [{ header: t('assets_invNo') }, { header: t('assets_name') }, { header: t('assets_acquired') }, { header: t('assets_cost'), align: 'right' }, { header: t('assets_accumulated'), align: 'right' }, { header: t('assets_nbv'), align: 'right' }], rows: list.map((a) => [a.inventoryNo, a.name, formatDate(a.acquiredAt), formatMoney(a.cost), formatMoney(a.accumulated), formatMoney(assetNbv(a))]), totals: ['', t('total'), '', '', '', formatMoney(w.nbv)] },
              signers: members.map((m, i) => ({ role: i === 0 ? p('Председатель комиссии', 'Komissiya raisi', 'Chairman') : p('Член комиссии', 'Komissiya a’zosi', 'Member'), name: lk.user(m)?.fullName ?? m, ...(signed(m) ? { signatureId: signed(m)!.signatureId } : {}) })),
            })} />
          </>
        }
      />
      <div className="wms-split">
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Реквизиты', 'Rekvizitlar', 'Details')}>
            <Kv items={[
              [p('Вид выбытия', 'Chiqib ketish turi', 'Disposal type'), t(tk('assets_wokind_', w.kind))],
              [p('Основание', 'Asos', 'Reason'), w.reason],
              [p('Протокол комиссии', 'Komissiya bayonnomasi', 'Protocol'), w.commission.protocolNo],
              [t('assets_nbv'), formatMoney(w.nbv)],
              ...(w.kind === 'sale' ? [[p('Решение Правления', 'Boshqaruv qarori', 'Board decision'), w.boardDecisionNo ?? ''] as [string, string], [p('Цена без НДС', 'QQSsiz narx', 'Price excl. VAT'), formatMoney(w.salePrice ?? 0)] as [string, string], [p('НДС (начислен автоматически)', 'QQS (avtomatik)', 'VAT (auto)'), formatMoney(w.vat ?? 0)] as [string, string], [p('Покупатель', 'Xaridor', 'Buyer'), w.buyerId ? lk.counterparty(w.buyerId)?.name ?? w.buyerId : '—'] as [string, string]] : []),
              ...(w.recipient ? [[p('Получатель', 'Qabul qiluvchi', 'Recipient'), w.recipient] as [string, string]] : []),
              [p('Источник', 'Manba', 'Source'), w.source === 'excel' ? p('Загрузка из Excel', 'Exceldan yuklash', 'Excel upload') : p('Вручную', 'Qo‘lda', 'Manual')],
            ]} />
          </Card>
          <Card title={p('Списываемые объекты', 'Hisobdan chiqariladigan obyektlar', 'Assets')} flush>
            <DataTable rows={list} rowKey={(a) => a.id} columns={[
              { header: t('assets_invNo'), render: (a) => <Link to={`/assets/${a.id}`} className="doc-num">{a.inventoryNo}</Link> },
              { header: t('assets_name'), render: (a) => a.name },
              { header: t('assets_cost'), align: 'right', render: (a) => formatMoney(a.cost) },
              { header: t('assets_nbv'), align: 'right', render: (a) => formatMoney(assetNbv(a)) },
              { header: t('status'), render: (a) => <StatusBadge prefix="assets_status_" status={a.status} /> },
            ]} />
          </Card>
          <Card title={p('Протокол комиссии по списанию (подписи E-IMZO)', 'Hisobdan chiqarish komissiyasi bayonnomasi (E-IMZO imzolari)', 'Write-off commission protocol (E-IMZO)')}>
            <div className="wms-sigs">
              {members.map((m, i) => (
                <div key={m} className={`wms-sig ${signed(m) ? 'done' : ''}`}>
                  <b>{i === 0 ? p('Председатель', 'Rais', 'Chairman') : p('Член комиссии', 'A’zo', 'Member')}</b>
                  <span>{lk.user(m)?.fullName ?? m}</span>
                  {signed(m) ? <span className="wms-note">✓ E-IMZO · {formatDateTime(signed(m)!.at)}</span> : w.status === 'commission' && user.id === m ? (
                    <SignAction errPrefix="assets_err_" doc={signDoc} label={p('Подписать', 'Imzolash', 'Sign')} onSigned={(sid) => assetsApi.signWriteoff(w.id, sid, user).then(() => toast(p('Протокол подписан', 'Bayonnoma imzolandi', 'Protocol signed')))} />
                  ) : <span className="wms-note">{w.status === 'commission' ? p('Ожидает подписи', 'Imzo kutilmoqda', 'Awaiting signature') : '—'}</span>}
                </div>
              ))}
            </div>
          </Card>
          <ApprovalBlock entityId={w.id} preview={{ entity: 'asset_writeoff', context: { subtype: w.kind, amount: w.kind === 'sale' ? w.salePrice : w.nbv } }} />
          {w.status === 'completed' && <PostingsTable docId={w.id} />}
        </div>
        <div className="wms-pad" style={{ padding: 0 }}>
          <Attachments entity="asset_writeoff" entityId={w.id} title={p('Протокол, решение Правления, фото', 'Bayonnoma, Boshqaruv qarori, foto', 'Protocol, Board decision, photos')} />
          <Card title={t('history')}><Timeline events={w.history} /></Card>
        </div>
      </div>
    </>
  );
}
