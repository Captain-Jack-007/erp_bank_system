// Склад: выдача — электронные заявки на выдачу (подпись руководителя ЦБУ), разнарядки ЦБУ, заявки на обеспечение;
// подписи расхода (закреплённый руководитель, операционист, заведующий складом), «Принял» с E-IMZO, М-11, ЭСФ получателя.
import { useMemo, useState, type ReactNode } from 'react';
import { canSignIssueAs, formatDate, formatDateTime, formatMoney, formatNumber, tk, warehouseApi, type WarehouseIssue, type WarehouseIssueSource, type WarehouseSignRole } from '@xb/shared';
import { Button, Card, Checkbox, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, RouteSteps, Select, StatusBadge, Textarea, Timeline, useToast, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { ApprovalBlock, CostCenterSelect, Kv, OrgUnitSelect, PostingsTable, SignAction, UserSelect, useOrg, useP, useWmsError } from './wmsShared';

export const IS_TONE: Record<WarehouseIssue['status'], Tone> = { draft: 'muted', pending: 'warn', returned: 'warn', rejected: 'danger', approved: 'info', issued: 'warn', received: 'ok', cancelled: 'muted' };
const SIGN_ROLES: WarehouseSignRole[] = ['head', 'operator', 'storekeeper', 'recipient'];

export function IssuesTab() {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const org = useOrg();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<WarehouseIssue['status'] | ''>('');
  const [mine, setMine] = useState(false);
  const list = useApi(() => warehouseApi.listIssues({ search, ...(status ? { status } : {}), ...(mine ? { mine: user.id } : {}) }), [search, status, mine, user.id]);
  const cols: Column<WarehouseIssue>[] = [
    { header: t('number'), render: (i) => (<><span className="doc-num">{i.number}</span><div className="sub">{t(tk('warehouse_src_', i.source))}{i.allotmentNo ? ` ${i.allotmentNo}` : ''}{i.externalRef ? ` ${i.externalRef.number}` : ''}</div></>) },
    { header: t('date'), render: (i) => formatDate(i.createdAt) },
    { header: p('Назначение', 'Maqsad', 'Purpose'), render: (i) => (<>{i.purpose}<div className="sub">{lk.department(i.departmentId) ? loc(lk.department(i.departmentId)!.name) : ''} · {org.unitName(i.orgUnitKey)}</div></>) },
    { header: t('warehouse_recipient'), render: (i) => lk.user(i.recipientId)?.fullName ?? i.recipientId },
    { header: p('МВЗ', 'XMM', 'CC'), render: (i) => <span className="wms-mono">{org.ccCode(i.costCenterId)}</span> },
    { header: t('amount'), align: 'right', render: (i) => formatMoney(i.amount) },
    { header: t('status'), render: (i) => <StatusBadge prefix="warehouse_isst_" status={i.status} tone={IS_TONE[i.status]} /> },
  ];
  return (
    <>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('number')}, ${p('назначение', 'maqsad', 'purpose')}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select<WarehouseIssue['status']> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={(['draft', 'pending', 'returned', 'approved', 'issued', 'received', 'rejected', 'cancelled'] as const).map((s) => ({ value: s, label: t(tk('warehouse_isst_', s)) }))} />
        <Checkbox checked={mine} onChange={setMine}>{p('Мои', 'Meniki', 'Mine')}</Checkbox>
        <Button type="primary" icon="plus" onClick={() => navigate('/warehouse/issues/new')}>{p('Заявка на выдачу', 'Berish arizasi', 'Issue request')}</Button>
        <ExportButton filename={p('Выдача со склада', 'Ombordan berish', 'Warehouse issues')} rows={list.data ?? []} columns={[
          { header: t('number'), value: (i) => i.number }, { header: t('date'), value: (i) => i.createdAt.slice(0, 10) }, { header: p('Основание', 'Asos', 'Basis'), value: (i) => t(tk('warehouse_src_', i.source)) },
          { header: p('Назначение', 'Maqsad', 'Purpose'), value: (i) => i.purpose }, { header: t('warehouse_recipient'), value: (i) => lk.user(i.recipientId)?.fullName ?? '' }, { header: p('МВЗ', 'XMM', 'CC'), value: (i) => org.ccCode(i.costCenterId) },
          { header: t('amount'), value: (i) => i.amount, format: 'money', total: true }, { header: t('status'), value: (i) => t(tk('warehouse_isst_', i.status)) },
        ]} />
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(i) => i.id} columns={cols} onRowClick={(i) => navigate(`/warehouse/issues/${i.id}`)} />
    </>
  );
}

export function IssueFormPage() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const can = useCan();
  const err = useWmsError('warehouse_err_');
  const canAllot = can('warehouse', 'edit');
  const locs = useApi(() => warehouseApi.listLocations());
  const [source, setSource] = useState<WarehouseIssueSource>('request');
  const [wh, setWh] = useState('wh1');
  const [recipient, setRecipient] = useState(user.id);
  const [dept, setDept] = useState(user.departmentId);
  const [unit, setUnit] = useState(user.orgUnitKey ?? user.departmentId);
  const [cc, setCc] = useState(user.costCenterKey ?? '');
  const [purpose, setPurpose] = useState('');
  const [allot, setAllot] = useState('');
  const [lines, setLines] = useState<{ key: number; itemId: string; qty: number }[]>([{ key: 1, itemId: '', qty: 1 }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const items = useApi(() => warehouseApi.listItems({ warehouseId: wh }), [wh]);
  const valid = lines.filter((l) => l.itemId && l.qty > 0);
  const estimate = useMemo(() => warehouseApi.estimate(valid.map((l) => ({ itemId: l.itemId, qty: l.qty }))), [JSON.stringify(valid), items.data]);
  async function save(submit: boolean) {
    setError('');
    setBusy(true);
    try {
      const is = await warehouseApi.createIssue({ source, ...(source === 'allotment' ? { allotmentNo: allot } : {}), warehouseId: wh, recipientId: recipient, departmentId: dept, orgUnitKey: unit, costCenterId: cc, purpose, lines: valid.map((l) => ({ itemId: l.itemId, qty: l.qty })), submit }, user);
      toast(`${is.number}: ${submit ? (source === 'allotment' ? p('к расходу — ожидает подписей', 'chiqimga — imzolar kutilmoqda', 'ready to issue — awaiting signatures') : p('отправлена на подпись руководителю', 'rahbar imzosiga yuborildi', 'sent to the head for signature')) : t('saved')}`);
      navigate(`/warehouse/issues/${is.id}`);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader crumbs={[{ label: t('warehouse_title'), to: '/warehouse/issues' }, { label: p('Новая заявка', 'Yangi ariza', 'New request') }]} title={p('Электронная заявка на выдачу со склада', 'Ombordan berish uchun elektron ariza', 'Electronic warehouse issue request')} />
      <Card title={p('Основание и получатель', 'Asos va qabul qiluvchi', 'Basis and recipient')}>
        <div className="wms-form-grid">
          <Field label={p('Основание', 'Asos', 'Basis')} required hint={p('Каждая выдача — по электронной заявке или по разнарядке ЦБУ', 'Har bir berish — elektron ariza yoki BXM taqsimoti bo‘yicha', 'Each issue is based on an e-request or a branch allotment')}>
            <Select<WarehouseIssueSource> value={source} onChange={setSource} options={[{ value: 'request', label: t('warehouse_src_request') }, ...(canAllot ? [{ value: 'allotment' as const, label: t('warehouse_src_allotment') }] : [])]} />
          </Field>
          {source === 'allotment' ? <Field label={p('Номер разнарядки', 'Taqsimot raqami', 'Allotment no.')} required><Input value={allot} onChange={(e) => setAllot(e.target.value)} /></Field> : <span />}
          <Field label={t('warehouse_warehouse')} required><Select value={wh} onChange={(v) => { setWh(v); setLines([{ key: 1, itemId: '', qty: 1 }]); }} options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Field>
          <Field label={t('warehouse_recipient')} required><UserSelect value={recipient} onChange={setRecipient} /></Field>
          <Field label={t('department')} required><Select value={dept} onChange={setDept} options={lk.departments.map((d) => ({ value: d.id, label: d.code }))} /></Field>
          <Field label={p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit')} required><OrgUnitSelect value={unit} onChange={(v) => { setUnit(v); setCc(''); }} /></Field>
          <Field label={p('МВЗ', 'XMM', 'Cost center')} required><CostCenterSelect value={cc} onChange={setCc} orgUnitKey={unit} /></Field>
          <Field label={p('Назначение', 'Maqsad', 'Purpose')} required className="wide"><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
        </div>
      </Card>
      <Card title={p('Товары', 'Tovarlar', 'Items')} actions={<Button size="small" icon="plus" onClick={() => setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((l) => l.key)) + 1, itemId: '', qty: 1 }])}>{p('Строка', 'Qator', 'Line')}</Button>}>
        <div className="wms-lines-wrap">
          <table className="wms-lines">
            <thead><tr><th>{t('warehouse_item')}</th><th className="num">{p('Доступно', 'Mavjud', 'Available')}</th><th>{t('qty')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => {
                const it = items.data?.find((i) => i.id === l.itemId);
                return (
                  <tr key={l.key}>
                    <td style={{ minWidth: 240 }}><Select value={l.itemId} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, itemId: v } : x)))} placeholder="—" ariaLabel={t('warehouse_item')} options={(items.data ?? []).filter((i) => i.qty - i.reserved > 0).map((i) => ({ value: i.id, label: `${i.sku} · ${i.name}` }))} /></td>
                    <td className="num">{it ? `${formatNumber(it.qty - it.reserved)} ${it.unit}` : '—'}</td>
                    <td><Input type="number" value={l.qty} ariaLabel={t('qty')} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: Number(e.target.value) } : x)))} /></td>
                    <td><Button size="small" icon="trash" title={p('Удалить строку', 'Qatorni o‘chirish', 'Remove line')} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="wms-row end" style={{ marginTop: 10 }}><b>{p('Оценка по FIFO', 'FIFO bo‘yicha baho', 'FIFO estimate')}: {formatMoney(estimate)}</b></div>
      </Card>
      {source === 'request' && (
        <Card title={p('Маршрут подписания заявки', 'Arizani imzolash yo‘nalishi', 'Signing route')}>
          <RouteSteps preview={{ entity: 'warehouse_issue', context: { amount: estimate, departmentId: dept, requesterId: user.id } }} />
          <div className="wms-note" style={{ marginTop: 8 }}>{p('После подписи руководителя ЦБУ расход подписывают закреплённый руководитель, операционный сотрудник и заведующий складом; получатель подтверждает «Принял» (E-IMZO).', 'BXM rahbari imzosidan so‘ng chiqimni biriktirilgan rahbar, operatsion xodim va ombor mudiri imzolaydi; qabul qiluvchi «Qabul qildim» (E-IMZO) bilan tasdiqlaydi.', 'After the branch head signs, the assigned head, operations officer and warehouse manager sign the issue; the recipient confirms “Received” (E-IMZO).')}</div>
        </Card>
      )}
      {error && <div className="error-text">{error}</div>}
      <div className="wms-row end">
        <Button onClick={() => navigate('/warehouse/issues')}>{t('cancel')}</Button>
        <Button loading={busy} onClick={() => save(false)}>{p('Сохранить черновик', 'Qoralamani saqlash', 'Save draft')}</Button>
        <Button type="primary" loading={busy} onClick={() => save(true)}>{source === 'allotment' ? p('Передать к расходу', 'Chiqimga o‘tkazish', 'Send to issue') : p('Отправить на подпись', 'Imzoga yuborish', 'Submit for signature')}</Button>
      </div>
    </>
  );
}

export function IssueDetailPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const can = useCan();
  const org = useOrg();
  const err = useWmsError('warehouse_err_');
  const d = useApi(() => warehouseApi.getIssue(id), [id]);
  const items = useApi(() => warehouseApi.listItems({ includeEmpty: true }));
  const locs = useApi(() => warehouseApi.listLocations());
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  if (d.loading && !d.data) return <Card><Loading /></Card>;
  const x = d.data;
  if (!x) return <Card><Empty text={t('empty')} /></Card>;
  const it = (iid: string) => items.data?.find((i) => i.id === iid);
  const whLoc = locs.data?.find((l) => l.id === x.warehouseId);
  const sig = (r: WarehouseSignRole) => x.signatures.find((s) => s.role === r);
  const canManage = x.requesterId === user.id || can('warehouse', 'edit');
  const signDoc = { entity: 'warehouse_issue', entityId: x.id, title: `${x.number} · ${x.purpose}`, content: { number: x.number, lines: x.lines, recipient: x.recipientId, cc: x.costCenterId } };
  const signerHint: Record<WarehouseSignRole, string> = {
    head: lk.user(whLoc?.headId ?? '')?.fullName ?? '',
    operator: p('Бухгалтерия / оператор', 'Buxgalteriya / operator', 'Accounting / operator'),
    storekeeper: lk.user(whLoc?.managerId ?? '')?.fullName ?? '',
    recipient: lk.user(x.recipientId)?.fullName ?? '',
  };
  const tableRows = x.lines.map((l, i) => [String(i + 1), `${it(l.itemId)?.sku ?? ''} ${it(l.itemId)?.name ?? ''}`, it(l.itemId)?.unit ?? '', formatNumber(l.qty), formatMoney(l.amount ?? 0)]);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('warehouse_title'), to: '/warehouse/issues' }, { label: x.number }]}
        title={`${p('Заявка на выдачу', 'Berish arizasi', 'Issue request')} ${x.number}`}
        subtitle={`${t(tk('warehouse_src_', x.source))}${x.allotmentNo ? ` ${x.allotmentNo}` : ''}${x.externalRef ? ` · ${x.externalRef.number}` : ''} · ${formatDate(x.createdAt)}`}
        actions={
          <>
            <StatusBadge prefix="warehouse_isst_" status={x.status} tone={IS_TONE[x.status]} />
            {canManage && (x.status === 'draft' || x.status === 'returned') && <Button type="primary" icon="check" onClick={() => warehouseApi.submitIssue(x.id, user).then(() => toast(`${x.number}: ${p('отправлена', 'yuborildi', 'submitted')}`)).catch((e) => toast(err(e)))}>{p('Отправить', 'Yuborish', 'Submit')}</Button>}
            {canManage && ['draft', 'approved', 'returned', 'rejected'].includes(x.status) && <Button danger onClick={() => { setReason(''); setCancel(true); }}>{p('Отменить', 'Bekor qilish', 'Cancel')}</Button>}
            {(x.status === 'issued' || x.status === 'received') && (
              <>
                <PrintButton template="act" label={p('Печать М-11', 'M-11 chop etish', 'Print M-11')} doc={() => ({
                  entity: 'warehouse_issue', entityId: x.id, title: p('Требование-накладная (форма М-11)', 'Talabnoma-yuk xati (M-11 shakli)', 'Requisition-waybill (form M-11)'), number: x.number, date: (x.issuedAt ?? x.createdAt).slice(0, 10), place: whLoc?.name,
                  fields: [{ label: t('warehouse_warehouse'), value: whLoc?.name ?? '' }, { label: t('warehouse_recipient'), value: lk.user(x.recipientId)?.fullName ?? '' }, { label: t('department'), value: lk.department(x.departmentId) ? loc(lk.department(x.departmentId)!.name) : '' }, { label: p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit'), value: org.unitName(x.orgUnitKey) }, { label: p('МВЗ', 'XMM', 'Cost center'), value: org.ccLabel(x.costCenterId) }, { label: p('Основание', 'Asos', 'Basis'), value: `${t(tk('warehouse_src_', x.source))} ${x.allotmentNo ?? x.externalRef?.number ?? x.number}` }],
                  table: { columns: [{ header: '№' }, { header: t('warehouse_item') }, { header: p('Ед.', 'Birl.', 'Unit') }, { header: t('qty'), align: 'right' }, { header: t('amount'), align: 'right' }], rows: tableRows, totals: ['', t('total'), '', '', formatMoney(x.amount)] },
                  signers: SIGN_ROLES.map((r) => ({ role: t(tk('warehouse_sign_', r)), name: lk.user(sig(r)?.userId ?? '')?.fullName ?? '', ...(sig(r) ? { signatureId: sig(r)!.signatureId } : {}) })),
                })} />
                <PrintButton label={p('ЭСФ получателя', 'Qabul qiluvchi EHF', 'Recipient e-invoice')} doc={() => ({
                  entity: 'warehouse_issue_invoice', entityId: x.id, title: p('Электронный счёт-фактура (внутреннее перемещение)', 'Elektron hisob-faktura (ichki ko‘chirish)', 'E-invoice (internal transfer)'), number: x.invoiceNo ?? '', date: (x.issuedAt ?? x.createdAt).slice(0, 10),
                  fields: [{ label: p('Отправитель', 'Jo‘natuvchi', 'Sender'), value: whLoc?.name ?? '' }, { label: t('warehouse_recipient'), value: `${lk.user(x.recipientId)?.fullName ?? ''} · ${org.unitName(x.orgUnitKey)}` }, { label: p('Основание', 'Asos', 'Basis'), value: x.number }],
                  table: { columns: [{ header: '№' }, { header: t('warehouse_item') }, { header: p('Ед.', 'Birl.', 'Unit') }, { header: t('qty'), align: 'right' }, { header: t('amount'), align: 'right' }], rows: tableRows, totals: ['', t('total'), '', '', formatMoney(x.amount)] },
                  signers: [{ role: t('warehouse_sign_recipient'), name: lk.user(x.recipientId)?.fullName ?? '', ...(sig('recipient') ? { signatureId: sig('recipient')!.signatureId } : {}) }],
                })} />
              </>
            )}
          </>
        }
      />
      <div className="wms-split">
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Реквизиты', 'Rekvizitlar', 'Details')}>
            <Kv items={[
              [p('Назначение', 'Maqsad', 'Purpose'), x.purpose],
              [t('warehouse_warehouse'), whLoc?.name ?? x.warehouseId],
              [t('initiator'), lk.user(x.requesterId)?.fullName ?? x.requesterId],
              [t('warehouse_recipient'), lk.user(x.recipientId)?.fullName ?? x.recipientId],
              [t('department'), lk.department(x.departmentId) ? loc(lk.department(x.departmentId)!.name) : x.departmentId],
              [p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit'), org.unitName(x.orgUnitKey)],
              [p('МВЗ', 'XMM', 'Cost center'), org.ccLabel(x.costCenterId)],
              [t('amount'), formatMoney(x.amount)],
              ...(x.externalRef ? [[p('Заявка на обеспечение', 'Ta’minot arizasi', 'Supply request'), <Link key="r" to={`/requests/${x.externalRef.id}`}>{x.externalRef.number}</Link>] as [string, ReactNode]] : []),
              ...(x.invoiceNo ? [[p('ЭСФ получателя', 'Qabul qiluvchi EHF', 'Recipient e-invoice'), x.invoiceNo] as [string, string]] : []),
              [p('Выдано / получено', 'Berildi / qabul qilindi', 'Issued / received'), `${x.issuedAt ? formatDateTime(x.issuedAt) : '—'} / ${x.receivedAt ? formatDateTime(x.receivedAt) : '—'}`],
            ]} />
          </Card>
          <Card title={p('Товары', 'Tovarlar', 'Items')} flush>
            <DataTable rows={x.lines.map((l, i) => ({ ...l, i }))} rowKey={(l) => String(l.i)} columns={[
              { header: t('warehouse_item'), render: (l) => (<>{it(l.itemId)?.name ?? l.itemId}<div className="sub">{it(l.itemId)?.sku} · {t(tk('warehouse_cat_', it(l.itemId)?.category ?? 'office'))}</div></>) },
              { header: t('qty'), align: 'right', render: (l) => `${formatNumber(l.qty)} ${it(l.itemId)?.unit ?? ''}` },
              { header: t('amount'), align: 'right', render: (l) => (l.amount !== undefined ? formatMoney(l.amount) : <span className="muted">≈ {formatMoney(warehouseApi.estimate([l]))}</span>) },
            ]} />
          </Card>
          {x.source === 'request' && <ApprovalBlock entityId={x.id} preview={{ entity: 'warehouse_issue', context: { amount: x.amount } }} title={p('Подпись руководителя ЦБУ (маршрут)', 'BXM rahbari imzosi (yo‘nalish)', 'Branch head signature (route)')} />}
          <Card title={p('Подписи расхода и «Принял» (E-IMZO)', 'Chiqim imzolari va «Qabul qildim» (E-IMZO)', 'Issue signatures and “Received” (E-IMZO)')}>
            <div className="wms-sigs">
              {SIGN_ROLES.map((r) => {
                const s = sig(r);
                const ready = r === 'recipient' ? x.status === 'issued' : x.status === 'approved';
                return (
                  <div key={r} className={`wms-sig ${s ? 'done' : ''}`} data-testid={`sig-${r}`}>
                    <b>{t(tk('warehouse_sign_', r))}</b>
                    <span>{s ? lk.user(s.userId)?.fullName : signerHint[r]}</span>
                    {s ? <span className="wms-note">✓ E-IMZO · {formatDateTime(s.at)}</span> : ready && canSignIssueAs(x, r, user) ? (
                      <SignAction doc={signDoc} label={r === 'recipient' ? p('Принял', 'Qabul qildim', 'Received') : p('Подписать', 'Imzolash', 'Sign')} onSigned={(sid) => warehouseApi.signIssue(x.id, r, sid, user).then((res) => toast(`${x.number}: ${res.status === 'issued' ? p('расход проведён (М-11), проводки переданы в iABS', 'chiqim o‘tkazildi (M-11), provodkalar iABSga yuborildi', 'issue posted (M-11), postings sent to iABS') : res.status === 'received' ? p('получение подтверждено', 'qabul qilish tasdiqlandi', 'receipt confirmed') : p('подписано', 'imzolandi', 'signed')}`))} />
                    ) : <span className="wms-note">{ready ? p('Ожидает подписи', 'Imzo kutilmoqda', 'Awaiting signature') : '—'}</span>}
                  </div>
                );
              })}
            </div>
          </Card>
          {x.postingId && <PostingsTable docId={x.id} />}
        </div>
        <div className="wms-pad" style={{ padding: 0 }}>
          <Attachments entity="warehouse_issue" entityId={x.id} readOnly={!canManage} />
          <Card title={t('history')}><Timeline events={x.history} /></Card>
        </div>
      </div>
      {cancel && (
        <Modal title={`${x.number}: ${p('отмена', 'bekor qilish', 'cancel')}`} onClose={() => setCancel(false)} footer={<><Button onClick={() => setCancel(false)}>{t('cancel')}</Button><Button danger disabled={!reason.trim()} onClick={() => warehouseApi.cancelIssue(x.id, user, reason).then(() => { setCancel(false); toast(t('saved')); }).catch((e) => toast(err(e)))}>{p('Отменить заявку', 'Arizani bekor qilish', 'Cancel request')}</Button></>}>
          <Field label={p('Причина', 'Sabab', 'Reason')} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
        </Modal>
      )}
    </>
  );
}
