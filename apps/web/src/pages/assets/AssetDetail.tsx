// Карточка ОС: реквизиты (группа и счета, МВЗ/сегмент, МОЛ, метод, аренда, налоговый объект, аллокация), QR/NFC,
// операции (ремонт, передача, переоценка, включение в состав, аренда, корректировка, списание), прогноз амортизации,
// история, журнал изменений, документы. Незавершённая операция блокирует последующие (PR-FAM-051).
import { useState, type ReactNode } from 'react';
import {
  ASSET_VAT_RATE, assetMonthly, assetNbv, assetsApi, canAccountAssets, canManageAsset, formatDate, formatMoney, formatMoneyShort, tk,
  type AssetComponent, type AssetRecord, type AssetWriteoffKind, userError } from '@xb/shared';
import { BarChart, Button, Card, DataTable, Empty, Field, Input, Loading, Modal, PageHeader, Progress, Select, StatusBadge, Textarea, Timeline, useToast } from '../../components/ui';
import { PrintButton } from '../../components/PrintView';
import { QrCode } from '../../components/QrCode';
import { FieldHistory } from '../../components/FieldHistory';
import { Attachments } from '../../components/Attachments';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { CostCenterSelect, Kv, LabelPreview, OrgUnitSelect, UserSelect, UsersPicker, useOrg, useP, useWmsError, type WmsLabel } from '../warehouse/wmsShared';
import { ASSET_TONE, assetQr } from './AssetsPage';

type Action = 'transfer' | 'revalue' | 'component' | 'lease' | 'correct' | 'writeoff' | 'nfc' | null;

export function AssetDetailPage({ id }: { id: string }) {
  const { t, loc, lang } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const can = useCan();
  const org = useOrg();
  const err = useWmsError('assets_err_');
  const doc = useApi(() => assetsApi.get(id), [id]);
  const sched = useApi(() => assetsApi.getSchedule(id), [id]);
  const open = useApi(() => assetsApi.openOperation(id), [id]);
  const groups = useApi(() => assetsApi.listGroups());
  const ops = useApi(() => assetsApi.listOperations({ assetId: id }), [id]);
  const [action, setAction] = useState<Action>(null);
  const [labels, setLabels] = useState<WmsLabel[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (doc.loading && !doc.data) return <Card><Loading /></Card>;
  const a = doc.data;
  if (!a) return <Card><Empty text={t('empty')} /></Card>;
  const g = groups.data?.find((x) => x.id === a.groupId);
  const nbv = assetNbv(a);
  const wear = Math.round((a.accumulated / a.cost) * 100);
  const manage = canManageAsset(a, user);
  const account = canAccountAssets(user);
  const blocked = !!open.data;
  const active = ['in_use', 'repair', 'conservation', 'leased_out'].includes(a.status);
  const freeToAct = active && !blocked;
  const cc = org.cc(a.costCenterId);
  const openLink = open.data ? ('kind' in open.data ? `/assets/writeoffs/${open.data.id}` : `/assets/operations/${open.data.id}`) : '';

  async function act(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast(msg);
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('assets_title'), to: '/assets' }, { label: a.inventoryNo }]}
        title={a.name}
        subtitle={`${a.inventoryNo} · ${g ? `${g.code} · ${loc(g.name)}` : t(tk('assets_cat_', a.category))}`}
        actions={
          <>
            <StatusBadge prefix="assets_status_" status={a.status} tone={ASSET_TONE[a.status]} />
            {a.status === 'in_use' && manage && !blocked && <Button disabled={busy} onClick={() => act(() => assetsApi.setStatus(a.id, 'repair', user, t('assets_toRepair')), t('assets_status_repair'))}>{t('assets_toRepair')}</Button>}
            {(a.status === 'repair' || a.status === 'conservation') && manage && !blocked && <Button disabled={busy} onClick={() => act(() => assetsApi.setStatus(a.id, 'in_use', user, t('assets_fromRepair')), t('assets_status_in_use'))}>{t('assets_fromRepair')}</Button>}
            {freeToAct && manage && <Button icon="route" onClick={() => setAction('transfer')}>{p('Передать', 'Topshirish', 'Transfer')}</Button>}
            {freeToAct && account && <Button onClick={() => setAction('revalue')}>{p('Переоценка', 'Qayta baholash', 'Revalue')}</Button>}
            {freeToAct && account && <Button onClick={() => setAction('component')}>{p('Включение в состав', 'Tarkibga kiritish', 'Improvement')}</Button>}
            {account && (freeToAct || a.status === 'leased_out') && a.lease?.direction !== 'in' && <Button onClick={() => (a.status === 'leased_out' ? act(() => assetsApi.leaseOut(a.id, null, user), p('Возвращён из аренды', 'Ijaradan qaytarildi', 'Returned from lease')) : setAction('lease'))}>{a.status === 'leased_out' ? p('Вернуть из аренды', 'Ijaradan qaytarish', 'End lease') : p('Сдать в аренду', 'Ijaraga berish', 'Lease out')}</Button>}
            {freeToAct && account && <Button icon="pen" onClick={() => setAction('correct')}>{p('Корректировка', 'Tuzatish', 'Correct')}</Button>}
            {freeToAct && manage && <Button danger onClick={() => setAction('writeoff')}>{t('assets_writeoff')}</Button>}
            <Button icon="qr" onClick={() => setLabels([{ title: a.name, sub: `${a.inventoryNo} · ${org.unitName(a.orgUnitKey)}`, qr: assetQr(a) }])}>{p('Этикетка', 'Yorliq', 'Label')}</Button>
            <PrintButton doc={() => ({
              entity: 'asset', entityId: a.id, title: p('Инвентарная карточка учёта ОС (форма ОС-6)', 'AV inventar kartochkasi (OS-6 shakli)', 'Asset inventory card (form OS-6)'), number: a.inventoryNo, date: a.acquiredAt,
              fields: [
                { label: t('assets_name'), value: a.name }, { label: p('Группа / счёт', 'Guruh / hisob', 'Group / account'), value: g ? `${g.code} · ${g.account}` : '' }, { label: t('assets_location'), value: `${org.unitName(a.orgUnitKey)}, ${a.location}` },
                { label: p('МВЗ', 'XMM', 'Cost center'), value: org.ccLabel(a.costCenterId) }, { label: t('assets_responsible'), value: lk.user(a.responsibleId)?.fullName ?? '' }, { label: t('assets_acquired'), value: formatDate(a.acquiredAt) },
                { label: t('assets_cost'), value: formatMoney(a.cost) }, { label: t('assets_accumulated'), value: formatMoney(a.accumulated) }, { label: t('assets_nbv'), value: formatMoney(nbv) },
                { label: p('Метод / срок', 'Usul / muddat', 'Method / life'), value: `${t(tk('assets_method_', a.method))} · ${a.usefulLifeMonths} ${t('assets_months')}` }, ...(a.serialNo ? [{ label: p('Серийный номер', 'Seriya raqami', 'Serial'), value: a.serialNo }] : []),
              ],
            })} />
          </>
        }
      />
      {blocked && (
        <div className="wms-warn" style={{ marginBottom: 12 }}>
          {t('assets_err_BLOCKED_BY_OPEN_OPERATION')}: <Link to={openLink}>{open.data && ('orderNo' in open.data ? open.data.orderNo ?? open.data.number : open.data.number)}</Link>
        </div>
      )}
      <div className="wms-split">
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('Реквизиты', 'Rekvizitlar', 'Details')}>
            <Kv items={[
              [t('assets_invNo'), <span className="wms-mono">{a.inventoryNo}</span>],
              [p('Группа / счета', 'Guruh / hisoblar', 'Group / accounts'), g ? <span>{g.code} · {loc(g.name)}<div className="wms-note wms-mono">{g.account} / {g.depAccount}{a.revaluation ? ' / 30908000' : ''}</div></span> : '—'],
              [p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit'), org.unitName(a.orgUnitKey)],
              [t('department'), lk.department(a.departmentId) ? loc(lk.department(a.departmentId)!.name) : a.departmentId],
              [p('МВЗ / сегмент', 'XMM / segment', 'Cost center / segment'), `${org.ccLabel(a.costCenterId)}${cc ? ` · ${t(tk('seg_', cc.segment))}` : ''}`],
              [t('assets_location'), a.location],
              [t('assets_responsible'), lk.user(a.responsibleId)?.fullName ?? a.responsibleId],
              [t('assets_acquired'), `${formatDate(a.acquiredAt)} · ${t(tk('assets_src_', a.source))}${a.fundingAccount ? ` (${a.fundingAccount})` : ''}`],
              [`${t('assets_life')} / ${p('метод', 'usul', 'method')}`, `${a.usefulLifeMonths} ${t('assets_months')} · ${t(tk('assets_method_', a.method))}`],
              ...(a.serialNo || a.model ? [[p('Серийный номер / модель', 'Seriya raqami / model', 'Serial / model'), `${a.serialNo ?? '—'} · ${a.model ?? '—'}`] as [string, string]] : []),
              ...(a.warrantyUntil ? [[p('Гарантия до', 'Kafolat muddati', 'Warranty until'), formatDate(a.warrantyUntil)] as [string, string]] : []),
              ...(a.lease ? [[a.lease.direction === 'in' ? p('Получено в аренду', 'Ijaraga olingan', 'Leased in') : p('Сдано в аренду', 'Ijaraga berilgan', 'Leased out'), `${lk.counterparty(a.lease.counterpartyId)?.name ?? a.lease.counterpartyId} · ${formatDate(a.lease.from)} — ${formatDate(a.lease.to)} · ${formatMoney(a.lease.monthly)}/${p('мес', 'oy', 'mo')}`] as [string, string]] : []),
              ...(a.taxObject ? [[p('Налоговый объект', 'Soliq obyekti', 'Tax object'), `${a.taxObject.kind === 'building' ? p('здание', 'bino', 'building') : p('земля', 'yer', 'land')} · ${a.taxObject.cadastralNo} · ${a.taxObject.area} м²${a.taxObject.landArea ? ` / ${p('участок', 'uchastka', 'plot')} ${a.taxObject.landArea} м²` : ''}`] as [string, string]] : []),
              ...(a.allocation?.length ? [[p('Аллокация (распределение)', 'Taqsimot', 'Allocation'), a.allocation.map((x) => `${org.ccCode(x.costCenterId)} ${x.share}%`).join(', ')] as [string, string]] : []),
              ...(a.nfcTagId ? [['NFC', <span className="wms-mono">{a.nfcTagId}</span>] as [string, ReactNode]] : []),
              ...(a.lastInventoryAt ? [[p('Последняя инвентаризация', 'Oxirgi inventarizatsiya', 'Last stocktaking'), formatDate(a.lastInventoryAt)] as [string, string]] : []),
            ]} />
          </Card>
          <Card title={p('Стоимость и износ', 'Qiymat va eskirish', 'Value and wear')}>
            <Kv items={[
              [t('assets_cost'), formatMoney(a.cost)],
              [p('в т.ч. дооценка (30908)', 'shu jumladan qayta baholash (30908)', 'incl. revaluation (30908)'), formatMoney(a.revaluation)],
              [t('assets_accumulated'), formatMoney(a.accumulated)],
              [t('assets_nbv'), <b>{formatMoney(nbv)}</b>],
              [t('assets_monthly'), formatMoney(assetMonthly(a))],
              [t('assets_wear'), <span style={{ display: 'inline-block', minWidth: 140 }}><Progress pct={wear} /> {wear}%</span>],
            ]} />
          </Card>
          <Card title={p('Включено в состав (капремонт, части, модернизация)', 'Tarkibga kiritilgan (kapital ta’mir, qismlar, modernizatsiya)', 'Capital improvements')} flush>
            <DataTable rows={a.components} rowKey={(c) => c.id} emptyText={p('Нет', 'Yo‘q', 'None')} columns={[
              { header: t('date'), render: (c) => formatDate(c.date) },
              { header: p('Вид', 'Turi', 'Kind'), render: (c) => t(tk('assets_cmp_', c.kind)) },
              { header: p('Описание', 'Tavsif', 'Description'), render: (c) => (<>{c.description}{c.separatedAt && <div className="sub">{p('Выделено', 'Ajratilgan', 'Separated')} {formatDate(c.separatedAt)}: {c.separatedReason}</div>}</>) },
              { header: p('Счёт', 'Hisob', 'Account'), render: (c) => <span className="wms-mono">{c.fundingAccount}</span> },
              { header: t('amount'), align: 'right', render: (c) => formatMoney(c.amount) },
              { header: '', render: (c) => (!c.separatedAt && account && freeToAct ? <SeparateButton asset={a} component={c} /> : null) },
            ]} />
          </Card>
          <Card title={t('assets_schedule')}>
            {sched.data?.length ? (
              <>
                <BarChart data={sched.data.map((r) => ({ label: String(r.year), values: [r.depreciation] }))} series={[{ name: t('assets_depYear') }]} format={(n) => formatMoneyShort(n, lang)} />
                <DataTable rows={sched.data} rowKey={(r) => String(r.year)} columns={[
                  { header: p('Год', 'Yil', 'Year'), render: (r) => r.year },
                  { header: t('assets_depYear'), align: 'right', render: (r) => formatMoney(r.depreciation) },
                  { header: t('assets_nbvEnd'), align: 'right', render: (r) => formatMoney(r.nbvEnd) },
                ]} />
              </>
            ) : <Empty text={t('empty')} />}
          </Card>
          <Card title={p('Операции по объекту', 'Obyekt bo‘yicha operatsiyalar', 'Operations')} flush>
            <DataTable rows={ops.data} rowKey={(o) => o.id} columns={[
              { header: t('number'), render: (o) => <Link to={`/assets/operations/${o.id}`} className="doc-num">{o.orderNo ?? o.number}</Link> },
              { header: t('date'), render: (o) => formatDate(o.date) },
              { header: p('Операция', 'Operatsiya', 'Operation'), render: (o) => t(tk('assets_op_', o.type)) },
              { header: p('Основание', 'Asos', 'Reason'), render: (o) => <span className="wms-note">{o.reason}</span> },
              { header: t('status'), render: (o) => <StatusBadge prefix="assets_opst_" status={o.status} /> },
            ]} />
          </Card>
        </div>
        <div className="wms-pad" style={{ padding: 0 }}>
          <Card title={p('QR-код и NFC', 'QR-kod va NFC', 'QR code and NFC')}>
            <div className="wms-qr">
              <QrCode value={assetQr(a)} size={120} />
              <div>
                <div className="wms-mono">{assetQr(a)}</div>
                <div className="wms-note">{a.nfcTagId ? `NFC: ${a.nfcTagId}` : p('NFC-метка не привязана', 'NFC-belgi biriktirilmagan', 'No NFC tag linked')}</div>
                {account && <Button size="small" onClick={() => setAction('nfc')}>{p('Программировать NFC', 'NFC dasturlash', 'Program NFC')}</Button>}
              </div>
            </div>
          </Card>
          <Card title={t('history')}><Timeline events={a.history} /></Card>
          <FieldHistory entity="asset" entityId={a.id} />
          <Attachments entity="asset" entityId={a.id} readOnly={!manage} title={p('Документы ОС (акты, паспорта, фото)', 'AV hujjatlari (dalolatnomalar, pasportlar, foto)', 'Asset documents (acts, passports, photos)')} />
        </div>
      </div>
      {labels && <LabelPreview labels={labels} entity="asset" onClose={() => setLabels(null)} />}
      {action === 'transfer' && <TransferModal asset={a} onClose={() => setAction(null)} />}
      {action === 'revalue' && <RevalueModal asset={a} onClose={() => setAction(null)} />}
      {action === 'component' && <ComponentModal asset={a} onClose={() => setAction(null)} />}
      {action === 'lease' && <LeaseModal asset={a} onClose={() => setAction(null)} />}
      {action === 'correct' && <CorrectModal asset={a} onClose={() => setAction(null)} />}
      {action === 'writeoff' && <WriteoffModal assets={[a]} onClose={() => setAction(null)} />}
      {action === 'nfc' && <NfcModal asset={a} onClose={() => setAction(null)} />}
    </>
  );
}

function SeparateButton({ asset, component }: { asset: AssetRecord; component: AssetComponent }) {
  const p = useP();
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('assets_err_');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>{p('Выделить', 'Ajratish', 'Separate')}</Button>
      {open && (
        <Modal title={p('Выделение из состава (ошибка)', 'Tarkibdan ajratish (xato)', 'Separate component (error)')} onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>{t('cancel')}</Button><Button type="primary" disabled={!reason.trim()} onClick={() => assetsApi.separateComponent(asset.id, component.id, reason, user).then(() => { toast(t('saved')); setOpen(false); }).catch((e) => toast(err(e)))}>{p('Выделить', 'Ajratish', 'Separate')}</Button></>}>
          <div className="wms-note">{component.description} · {formatMoney(component.amount)}</div>
          <Field label={p('Причина', 'Sabab', 'Reason')} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
        </Modal>
      )}
    </>
  );
}

function useSubmit(onClose: () => void) {
  const toast = useToast();
  const err = useWmsError('assets_err_');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      toast(msg);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

/** Передача: МОЛ (электронный акт), подразделение / ЦБУ / филиал (электронное распоряжение и согласование), смена группы. */
export function TransferModal({ asset, onClose }: { asset: AssetRecord; onClose: () => void }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const groups = useApi(() => assetsApi.listGroups());
  const [kind, setKind] = useState<'mol' | 'dept' | 'cbu' | 'branch' | 'category'>('mol');
  const [mol, setMol] = useState('');
  const [unit, setUnit] = useState('');
  const [dept, setDept] = useState(asset.departmentId);
  const [cc, setCc] = useState('');
  const [group, setGroup] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const { error, busy, run } = useSubmit(onClose);
  const canAcc = canAccountAssets(user);
  return (
    <Modal title={`${asset.inventoryNo}: ${p('передача', 'topshirish', 'transfer')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(async () => { const op = await assetsApi.requestTransfer({ assetIds: [asset.id], kind, ...(mol ? { toResponsibleId: mol } : {}), ...(unit ? { toOrgUnitKey: unit } : {}), ...(dept ? { toDepartmentId: dept } : {}), ...(cc ? { toCostCenterId: cc } : {}), ...(group ? { toGroupId: group } : {}), ...(location ? { toLocation: location } : {}), reason }, user); navigate(`/assets/operations/${op.id}`); }, kind === 'mol' ? p('Электронный акт отправлен новому МОЛ', 'Elektron dalolatnoma yangi MJSga yuborildi', 'Electronic act sent to the new custodian') : kind === 'category' ? t('saved') : p('Распоряжение отправлено на согласование', 'Farmoyish kelishuvga yuborildi', 'Order sent for approval'))}>{p('Оформить', 'Rasmiylashtirish', 'Create')}</Button></>}>
      <Field label={p('Вид передачи', 'Topshirish turi', 'Transfer type')} required>
        <Select<'mol' | 'dept' | 'cbu' | 'branch' | 'category'> value={kind} onChange={setKind} options={[
          { value: 'mol', label: t('assets_op_transfer_mol') }, { value: 'dept', label: t('assets_op_transfer_dept') }, { value: 'cbu', label: t('assets_op_transfer_cbu') }, { value: 'branch', label: t('assets_op_transfer_branch') },
          ...(canAcc ? [{ value: 'category' as const, label: t('assets_op_category_change') }] : []),
        ]} />
      </Field>
      {kind === 'mol' && <Field label={p('Новый МОЛ', 'Yangi MJS', 'New custodian')} required hint={p('Новый МОЛ принимает ОС подписью E-IMZO', 'Yangi MJS AVni E-IMZO imzosi bilan qabul qiladi', 'The new custodian accepts with an E-IMZO signature')}><UserSelect value={mol} onChange={setMol} filter={(u) => u.id !== asset.responsibleId} /></Field>}
      {(kind === 'dept' || kind === 'cbu' || kind === 'branch') && (
        <>
          <Field label={p('ЦБУ / подразделение получателя', 'Qabul qiluvchi BXM / bo‘linma', 'Receiving branch / unit')} required><OrgUnitSelect value={unit} onChange={(v) => { setUnit(v); setCc(''); }} /></Field>
          <Field label={t('department')} required><Select value={dept} onChange={setDept} options={lk.departments.map((d) => ({ value: d.id, label: `${d.code} · ${loc(d.name)}` }))} /></Field>
          <Field label={p('МВЗ получателя', 'Qabul qiluvchi XMM', 'Receiving cost center')} required><CostCenterSelect value={cc} onChange={setCc} orgUnitKey={unit} /></Field>
          <Field label={p('Новое местонахождение', 'Yangi joylashuv', 'New location')}><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <div className="wms-note">{p('Автоматически формируется электронное распоряжение; первоначальная стоимость, износ и дооценка (30908) переносятся проводками.', 'Elektron farmoyish avtomatik shakllanadi; boshlang‘ich qiymat, eskirish va qayta baholash (30908) provodkalar bilan o‘tkaziladi.', 'An electronic order is generated; original cost, depreciation and revaluation (30908) are carried over by postings.')}</div>
        </>
      )}
      {kind === 'category' && <Field label={p('Новая группа', 'Yangi guruh', 'New group')} required><Select value={group} onChange={setGroup} placeholder="—" options={(groups.data ?? []).filter((g) => g.id !== asset.groupId).map((g) => ({ value: g.id, label: `${g.code} · ${loc(g.name)} (${g.account})` }))} /></Field>}
      <Field label={p('Основание', 'Asos', 'Reason')} required error={error}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
    </Modal>
  );
}

function RevalueModal({ asset, onClose }: { asset: AssetRecord; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const [value, setValue] = useState(String(assetNbv(asset)));
  const [reason, setReason] = useState('');
  const { error, busy, run } = useSubmit(onClose);
  const diff = Number(value) - assetNbv(asset);
  return (
    <Modal title={`${asset.inventoryNo}: ${p('переоценка', 'qayta baholash', 'revaluation')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(() => assetsApi.revalue(asset.id, Number(value), reason, user), p('Переоценка проведена', 'Qayta baholash o‘tkazildi', 'Revaluation posted'))}>{p('Провести', 'O‘tkazish', 'Post')}</Button></>}>
      <Field label={p('Справедливая (остаточная) стоимость', 'Adolatli (qoldiq) qiymat', 'Fair (net) value')} required hint={`${t('assets_nbv')}: ${formatMoney(assetNbv(asset))} → ${diff > 0 ? p('дооценка', 'qayta baholash', 'upward') : p('уценка', 'arzonlashtirish', 'downward')} ${formatMoney(Math.abs(diff))}${diff < 0 && asset.revaluation ? ` (${p('сначала за счёт 30908', 'avval 30908 hisobidan', '30908 first')})` : ''}`}>
        <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label={p('Основание (заключение оценщика)', 'Asos (baholovchi xulosasi)', 'Basis (appraiser report)')} required error={error}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
    </Modal>
  );
}

function ComponentModal({ asset, onClose }: { asset: AssetRecord; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const [kind, setKind] = useState<AssetComponent['kind']>('capital_repair');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [funding, setFunding] = useState('16505000');
  const [extend, setExtend] = useState('');
  const { error, busy, run } = useSubmit(onClose);
  return (
    <Modal title={`${asset.inventoryNo}: ${p('включение в состав', 'tarkibga kiritish', 'capital improvement')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(() => assetsApi.addComponent(asset.id, { kind, amount: Number(amount), description: desc, fundingAccount: funding, ...(extend ? { extendLifeMonths: Number(extend) } : {}) }, user), p('Стоимость ОС увеличена', 'AV qiymati oshirildi', 'Asset cost increased'))}>{p('Провести', 'O‘tkazish', 'Post')}</Button></>}>
      <Field label={p('Вид', 'Turi', 'Kind')} required><Select<AssetComponent['kind']> value={kind} onChange={setKind} options={(['capital_repair', 'part', 'modernization'] as const).map((k) => ({ value: k, label: t(tk('assets_cmp_', k)) }))} /></Field>
      <Field label={t('amount')} required><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label={p('Счёт капвложений', 'Kapital qo‘yilmalar hisobi', 'Capex account')} required><Select value={funding} onChange={setFunding} options={[{ value: '16505000', label: '16505000' }, { value: '19907000', label: '19907000' }]} /></Field>
      <Field label={p('Продлить срок, мес.', 'Muddatni uzaytirish, oy', 'Extend life, months')}><Input type="number" value={extend} onChange={(e) => setExtend(e.target.value)} /></Field>
      <Field label={p('Описание', 'Tavsif', 'Description')} required error={error}><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} /></Field>
    </Modal>
  );
}

function LeaseModal({ asset, onClose }: { asset: AssetRecord; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const [cp, setCp] = useState('');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState('');
  const [monthly, setMonthly] = useState('');
  const { error, busy, run } = useSubmit(onClose);
  return (
    <Modal title={`${asset.inventoryNo}: ${p('передача в аренду', 'ijaraga berish', 'lease out')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(() => assetsApi.leaseOut(asset.id, { counterpartyId: cp, from, to, monthly: Number(monthly) }, user), p('Передано в аренду', 'Ijaraga berildi', 'Leased out'))}>{p('Оформить', 'Rasmiylashtirish', 'Create')}</Button></>}>
      <Field label={p('Арендатор', 'Ijarachi', 'Lessee')} required><Select value={cp} onChange={setCp} placeholder="—" options={lk.counterparties.map((c) => ({ value: c.id, label: c.name }))} /></Field>
      <div className="wms-form-grid">
        <Field label={p('С', 'Dan', 'From')} required><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={p('По', 'Gacha', 'To')} required><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Field label={p('Арендная плата в месяц', 'Oylik ijara haqi', 'Monthly rent')} required error={error}><Input type="number" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
    </Modal>
  );
}

function CorrectModal({ asset, onClose }: { asset: AssetRecord; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const [name, setName] = useState(asset.name);
  const [location, setLocation] = useState(asset.location);
  const [serial, setSerial] = useState(asset.serialNo ?? '');
  const [model, setModel] = useState(asset.model ?? '');
  const [life, setLife] = useState(String(asset.usefulLifeMonths));
  const [method, setMethod] = useState(asset.method);
  const [cc, setCc] = useState(asset.costCenterId);
  const [alloc, setAlloc] = useState(asset.allocation?.map((x) => `${x.costCenterId}:${x.share}`).join(', ') ?? '');
  const [reason, setReason] = useState('');
  const { error, busy, run } = useSubmit(onClose);
  const parseAlloc = () => alloc.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [c, sh] = s.split(':'); return { costCenterId: (c ?? '').trim(), share: Number(sh) }; });
  return (
    <Modal title={`${asset.inventoryNo}: ${p('корректировка карточки', 'kartochkani tuzatish', 'card correction')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(() => assetsApi.correctAsset(asset.id, { name, location, ...(serial ? { serialNo: serial } : {}), ...(model ? { model } : {}), usefulLifeMonths: Number(life), method, costCenterId: cc, allocation: parseAlloc() }, reason, user), t('saved'))}>{t('save')}</Button></>}>
      <Field label={t('assets_name')} required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t('assets_location')} required><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
      <div className="wms-form-grid">
        <Field label={p('Серийный номер', 'Seriya raqami', 'Serial number')}><Input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label={p('Модель', 'Model', 'Model')}><Input value={model} onChange={(e) => setModel(e.target.value)} /></Field>
        <Field label={`${t('assets_life')}, ${t('assets_months')}`} required><Input type="number" value={life} onChange={(e) => setLife(e.target.value)} /></Field>
        <Field label={p('Метод', 'Usul', 'Method')} required><Select value={method} onChange={setMethod} options={(['linear', 'declining'] as const).map((m) => ({ value: m, label: t(tk('assets_method_', m)) }))} /></Field>
      </div>
      <Field label={p('МВЗ (в пределах подразделения)', 'XMM (bo‘linma doirasida)', 'Cost center (within unit)')} required><CostCenterSelect value={cc} onChange={setCc} orgUnitKey={asset.orgUnitKey} /></Field>
      <Field label={p('Аллокация: МВЗ:доля, … (сумма 100)', 'Taqsimot: XMM:ulush, … (jami 100)', 'Allocation: CC:share, … (total 100)')} hint="CC0001:60, CC0006:40"><Input value={alloc} onChange={(e) => setAlloc(e.target.value)} /></Field>
      <Field label={p('Основание корректировки', 'Tuzatish asosi', 'Reason')} required error={error}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
    </Modal>
  );
}

/** Списание: акт ОС-4 на основании протокола комиссии (ликвидация, негодность, безвозмездно, продажа с НДС). */
export function WriteoffModal({ assets, onClose }: { assets: AssetRecord[]; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const [kind, setKind] = useState<AssetWriteoffKind>('liquidation');
  const [reason, setReason] = useState('');
  const [chair, setChair] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [protocol, setProtocol] = useState('');
  const [price, setPrice] = useState('');
  const [board, setBoard] = useState('');
  const [buyer, setBuyer] = useState('');
  const [recipient, setRecipient] = useState('');
  const { error, busy, run } = useSubmit(onClose);
  const nbv = assets.reduce((s, a) => s + assetNbv(a), 0);
  return (
    <Modal title={`${p('Акт о списании ОС (ОС-4)', 'AV hisobdan chiqarish dalolatnomasi (OS-4)', 'Asset write-off act (OS-4)')}: ${assets.map((a) => a.inventoryNo).join(', ')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(async () => { const act = await assetsApi.createWriteoff({ kind, assetIds: assets.map((a) => a.id), reason, commission: { chairmanId: chair, memberIds: members, protocolNo: protocol }, ...(kind === 'sale' ? { salePrice: Number(price), boardDecisionNo: board, ...(buyer ? { buyerId: buyer } : {}) } : {}), ...(kind === 'gratuitous' ? { recipient } : {}) }, user); navigate(`/assets/writeoffs/${act.id}`); }, p('Акт составлен — передайте протокол комиссии', 'Dalolatnoma tuzildi — bayonnomani komissiyaga yuboring', 'Act created — send the protocol to the commission'))}>{p('Составить акт', 'Dalolatnoma tuzish', 'Create act')}</Button></>}>
      <Field label={p('Вид выбытия', 'Chiqib ketish turi', 'Disposal type')} required><Select<AssetWriteoffKind> value={kind} onChange={setKind} options={(['liquidation', 'unusable', 'gratuitous', 'sale'] as const).map((k) => ({ value: k, label: t(tk('assets_wokind_', k)) }))} /></Field>
      <div className="wms-note">{t('assets_nbv')}: {formatMoney(nbv)}</div>
      {kind === 'sale' && (
        <div className="wms-form-grid">
          <Field label={p('Цена продажи без НДС', 'QQSsiz sotish narxi', 'Sale price excl. VAT')} required hint={Number(price) > 0 ? `${p('НДС', 'QQS', 'VAT')} ${ASSET_VAT_RATE}%: ${formatMoney(Math.round((Number(price) * ASSET_VAT_RATE) / 100))}` : undefined}><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label={p('Решение Правления №', 'Boshqaruv qarori №', 'Board decision no.')} required><Input value={board} onChange={(e) => setBoard(e.target.value)} /></Field>
          <Field label={p('Покупатель', 'Xaridor', 'Buyer')}><Select value={buyer} onChange={setBuyer} placeholder="—" options={lk.counterparties.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        </div>
      )}
      {kind === 'gratuitous' && <Field label={p('Получатель', 'Qabul qiluvchi', 'Recipient')} required><Input value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>}
      <Field label={p('Протокол комиссии №', 'Komissiya bayonnomasi №', 'Commission protocol no.')} required><Input value={protocol} onChange={(e) => setProtocol(e.target.value)} /></Field>
      <Field label={p('Председатель комиссии по списанию', 'Hisobdan chiqarish komissiyasi raisi', 'Write-off commission chairman')} required><UserSelect value={chair} onChange={setChair} /></Field>
      <Field label={p('Члены комиссии (не менее двух)', 'Komissiya a’zolari (kamida ikki)', 'Members (at least two)')} required><UsersPicker value={members} onChange={setMembers} exclude={chair ? [chair] : []} /></Field>
      <Field label={p('Основание для списания', 'Hisobdan chiqarish asosi', 'Reason')} required error={error}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
    </Modal>
  );
}

function NfcModal({ asset, onClose }: { asset: AssetRecord; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const [tag, setTag] = useState(asset.nfcTagId ?? '');
  const [note, setNote] = useState('');
  const { error, busy, run } = useSubmit(onClose);
  const supported = typeof window !== 'undefined' && 'NDEFReader' in window;
  async function write() {
    try {
      const Reader = (window as unknown as { NDEFReader: new () => { write: (m: unknown) => Promise<void> } }).NDEFReader;
      await new Reader().write({ records: [{ recordType: 'text', data: assetQr(asset) }] });
      setNote(p('Метка записана', 'Belgi yozildi', 'Tag written'));
    } catch (e) {
      setNote(userError(e));
    }
  }
  return (
    <Modal title={`${asset.inventoryNo}: NFC`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(() => assetsApi.setNfcTag(asset.id, tag, user), t('saved'))}>{p('Привязать метку', 'Belgini biriktirish', 'Link tag')}</Button></>}>
      <div className="wms-note">{supported ? p('Устройство поддерживает Web NFC: поднесите метку и нажмите «Записать».', 'Qurilma Web NFCni qo‘llab-quvvatlaydi: belgini yaqinlashtiring va «Yozish»ni bosing.', 'This device supports Web NFC: hold the tag and press “Write”.') : p('Браузер не поддерживает Web NFC — запишите метку мобильным приложением и введите её идентификатор.', 'Brauzer Web NFCni qo‘llab-quvvatlamaydi — belgini mobil ilova bilan yozing va identifikatorini kiriting.', 'This browser has no Web NFC — write the tag with the mobile app and enter its ID.')}</div>
      {supported && <Button icon="pen" onClick={() => void write()}>{p('Записать', 'Yozish', 'Write')}</Button>}
      {note && <div className="wms-note">{note}</div>}
      <Field label={p('Идентификатор NFC-метки (UID)', 'NFC-belgi identifikatori (UID)', 'NFC tag ID (UID)')} required error={error}><Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="04:A2:1B:7C:5E:80" /></Field>
    </Modal>
  );
}
