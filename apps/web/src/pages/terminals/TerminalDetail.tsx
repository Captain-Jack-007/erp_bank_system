// Карточка терминала: учётные реквизиты (серийный и инвентарный номер — неизменяемые, модель, платёжная система,
// признак и статус iABS), действия (изменение, свободен/используется, перемещение между ЦБУ по распоряжению, списание),
// журнал синхронизации с iABS, история; мониторинг (транзакции, наличные, заявки на обслуживание).
import { useState } from 'react';
import {
  assetsApi, canAccountTerminals, canReportTerminal, canServiceTerminal, decimalSep, formatDate, formatDateTime, formatNumber, terminalsApi, tk,
  type TerminalDevice, type TerminalPaySystem,
} from '@xb/shared';
import { Button, Card, Empty, Field, Input, LineChart, Loading, Modal, PageHeader, Select, StatusBadge, Textarea, Timeline, useToast } from '../../components/ui';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { CostCenterSelect, Kv, OrgUnitSelect, UserSelect, UsersPicker, useP, useWmsError } from '../warehouse/wmsShared';
import { CashLevel, IABS_TONE, STATE_TONE, SyncLog, TERMINAL_TONE, TicketsTable } from './TerminalsPage';
import { TicketModal } from './TicketModal';

type Action = 'edit' | 'move' | 'writeoff' | null;

export function TerminalDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const can = useCan();
  const err = useWmsError('terminals_err_');
  const d = useApi(() => terminalsApi.get(id), [id]);
  const open = useApi(() => (d.data ? assetsApi.openOperation(d.data.assetId) : Promise.resolve(undefined)), [d.data?.assetId ?? '', d.data?.state ?? '']);
  const [ticket, setTicket] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  if (d.loading && !d.data) return <Card><Loading /></Card>;
  const x = d.data;
  if (!x) return <Card><Empty text={t('empty')} /></Card>;
  const days = x.txLast7.map((_, i) => formatDate(new Date(Date.now() - (x.txLast7.length - 1 - i) * 86_400_000).toISOString()).slice(0, 5));
  const total7 = x.txLast7.reduce((s, n) => s + n, 0);
  const acc = canAccountTerminals(user);
  const editable = (acc || can('terminals', 'edit')) && x.state !== 'written_off';
  const blocked = !!open.data;
  const openLink = open.data ? ('kind' in open.data ? `/assets/writeoffs/${open.data.id}` : `/assets/operations/${open.data.id}`) : '';
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('terminals_title'), to: '/terminals' }, { label: x.code }]}
        title={`${x.code} · ${t(tk('terminals_type_', x.type))}`}
        subtitle={`${x.branch} · ${x.address}`}
        actions={
          <>
            <StatusBadge prefix="terminals_status_" status={x.status} tone={TERMINAL_TONE[x.status]} />
            {x.type === 'atm' && canServiceTerminal(user) && x.state !== 'written_off' && <Button disabled={busy} onClick={() => run(() => terminalsApi.registerCollection(x.id, user), `${x.code}: ${t('terminals_collected')}`)}>{t('terminals_collect')}</Button>}
            {canReportTerminal(user) && x.state !== 'written_off' && <Button type="primary" onClick={() => setTicket(true)}>{t('terminals_newTicket')}</Button>}
            {editable && !blocked && <Button icon="pen" onClick={() => setAction('edit')}>{p('Изменить', 'O‘zgartirish', 'Edit')}</Button>}
            {editable && !blocked && x.iabsStatus !== 'written_off' && <Button disabled={busy} onClick={() => run(() => terminalsApi.setState(x.id, x.state === 'free' ? 'in_use' : 'free', user), t(x.state === 'free' ? 'terminals_state_in_use' : 'terminals_state_free'))}>{x.state === 'free' ? p('Ввести в использование', 'Foydalanishga kiritish', 'Put into use') : p('Освободить', 'Bo‘shatish', 'Release')}</Button>}
            {editable && !blocked && (acc || can('assets', 'approve')) && <Button icon="route" onClick={() => setAction('move')}>{p('Переместить в ЦБУ', 'BXMga ko‘chirish', 'Move to branch')}</Button>}
            {acc && !blocked && x.state === 'free' && <Button danger onClick={() => setAction('writeoff')}>{p('Списать', 'Hisobdan chiqarish', 'Write off')}</Button>}
          </>
        }
      />
      {blocked && <div className="wms-warn" style={{ marginBottom: 12 }}>{t('assets_err_BLOCKED_BY_OPEN_OPERATION')}: <Link to={openLink}>{open.data && ('orderNo' in open.data ? open.data.orderNo ?? open.data.number : open.data.number)}</Link></div>}
      <div className="grid grid-main">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Card title={p('Учёт терминала (ОС)', 'Terminal hisobi (AV)', 'Terminal accounting (asset)')}>
            <Kv items={[
              [t('terminals_serial'), <span className="wms-mono">{x.serialNo}</span>],
              [t('terminals_invNo'), <span className="wms-mono">{x.inventoryNo}</span>],
              [t('terminals_model'), x.model],
              [t('terminals_paySystem'), t(tk('terminals_pay_', x.paySystem))],
              [t('terminals_iabsFlag'), <span className="wms-mono">{x.iabsFlag}</span>],
              [t('terminals_iabsSection'), x.iabsSection],
              [t('terminals_iabsStatus'), <span><StatusBadge prefix="terminals_iabs_" status={x.iabsStatus} tone={IABS_TONE[x.iabsStatus]} />{x.iabsTerminalId ? <span className="wms-note"> · {x.iabsTerminalId}</span> : null}</span>],
              [t('terminals_state'), <StatusBadge prefix="terminals_state_" status={x.state} tone={STATE_TONE[x.state]} />],
            ]} />
          </Card>
          <Card title={`${t('terminals_tx7')} · ${formatNumber(total7)}`}>
            <LineChart labels={days} series={[{ name: t('terminals_tx'), values: x.txLast7 }]} format={formatNumber} />
          </Card>
          <Card title={t('terminals_sync')} flush><SyncLog terminalId={x.id} /></Card>
          <Card title={t('terminals_tickets')} flush><TicketsTable terminalId={x.id} /></Card>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Card title={t('details')}>
            <dl className="kv" style={{ gridTemplateColumns: '130px 1fr' }}>
              <dt>{t('terminals_region')}</dt>
              <dd>{x.region}</dd>
              <dt>{t('terminals_installed')}</dt>
              <dd className="num">{formatDate(x.installedAt)}</dd>
              <dt>{t('terminals_uptime')}</dt>
              <dd>{String(x.uptime30d).replace('.', decimalSep())}%</dd>
              <dt>{t('terminals_asset')}</dt>
              <dd><Link to={`/assets/${x.assetId}`}>{t('open')} →</Link></dd>
            </dl>
          </Card>
          {x.type === 'atm' && (
            <Card title={t('terminals_cash')}>
              <CashLevel d={x} />
              <div className="muted small" style={{ marginTop: 8 }}>{t('terminals_lastCollection')}: {x.lastCollection ? formatDateTime(x.lastCollection) : '—'}</div>
            </Card>
          )}
          <Card title={t('history')}><Timeline events={x.history} /></Card>
        </div>
      </div>
      {ticket && <TicketModal terminalId={x.id} onClose={() => setTicket(false)} />}
      {action === 'edit' && <EditModal d={x} onClose={() => setAction(null)} />}
      {action === 'move' && <MoveModal d={x} onClose={() => setAction(null)} />}
      {action === 'writeoff' && <WriteoffModal d={x} onClose={() => setAction(null)} />}
    </>
  );
}

function useRun(onClose: () => void) {
  const toast = useToast();
  const err = useWmsError('terminals_err_');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return {
    error,
    busy,
    run: async (fn: () => Promise<unknown>, msg: string) => {
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
    },
  };
}

function EditModal({ d, onClose }: { d: TerminalDevice; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const models = useApi(() => terminalsApi.listModels());
  const [modelId, setModelId] = useState(d.modelId);
  const [pay, setPay] = useState<TerminalPaySystem>(d.paySystem);
  const [address, setAddress] = useState(d.address);
  const { error, busy, run } = useRun(onClose);
  return (
    <Modal title={`${d.code}: ${p('изменение карточки', 'kartochkani o‘zgartirish', 'edit card')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(() => terminalsApi.updateTerminal(d.id, { modelId, paySystem: pay, address }, user), p('Сохранено и передано в iABS', 'Saqlandi va iABSga yuborildi', 'Saved and sent to iABS'))}>{t('save')}</Button></>}>
      <Field label={t('terminals_serial')} hint={p('Не изменяется', 'O‘zgartirilmaydi', 'Immutable')}><Input value={d.serialNo} readOnly disabled /></Field>
      <Field label={t('terminals_invNo')} hint={p('Не изменяется', 'O‘zgartirilmaydi', 'Immutable')}><Input value={d.inventoryNo} readOnly disabled /></Field>
      <Field label={t('terminals_model')} required><Select value={modelId} onChange={setModelId} options={(models.data ?? []).filter((m) => m.type === d.type).map((m) => ({ value: m.id, label: m.model }))} /></Field>
      <Field label={t('terminals_paySystem')} required><Select<TerminalPaySystem> value={pay} onChange={setPay} options={(['humo', 'uzcard'] as const).map((x) => ({ value: x, label: t(tk('terminals_pay_', x)) }))} /></Field>
      <Field label={t('terminals_address')} required error={error}><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
    </Modal>
  );
}

function MoveModal({ d, onClose }: { d: TerminalDevice; onClose: () => void }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const [unit, setUnit] = useState('');
  const [dept, setDept] = useState('d9');
  const [cc, setCc] = useState('');
  const [address, setAddress] = useState('');
  const [reason, setReason] = useState('');
  const { error, busy, run } = useRun(onClose);
  return (
    <Modal title={`${d.code}: ${p('перемещение между ЦБУ', 'BXMlar o‘rtasida ko‘chirish', 'move between branches')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(async () => { const op = await terminalsApi.requestMove(d.id, { toOrgUnitKey: unit, toDepartmentId: dept, toCostCenterId: cc, toAddress: address, reason }, user); navigate(`/assets/operations/${op.id}`); }, p('Распоряжение на перемещение отправлено на согласование', 'Ko‘chirish farmoyishi kelishuvga yuborildi', 'Move order sent for approval'))}>{p('Оформить распоряжение', 'Farmoyishni rasmiylashtirish', 'Create order')}</Button></>}>
      <div className="wms-note">{p('Серийный и инвентарный номер сохраняются; после согласования распоряжения данные передаются в iABS.', 'Seriya va inventar raqami saqlanadi; farmoyish kelishilgach ma’lumotlar iABSga yuboriladi.', 'Serial and inventory numbers are kept; after approval the data is sent to iABS.')}</div>
      <Field label={p('ЦБУ-получатель', 'Qabul qiluvchi BXM', 'Receiving branch')} required><OrgUnitSelect value={unit} onChange={(v) => { setUnit(v); setCc(''); }} types={['branch_office', 'region']} /></Field>
      <Field label={t('department')} required><Select value={dept} onChange={setDept} options={lk.departments.map((x) => ({ value: x.id, label: `${x.code} · ${loc(x.name)}` }))} /></Field>
      <Field label={p('МВЗ получателя', 'Qabul qiluvchi XMM', 'Receiving cost center')} required><CostCenterSelect value={cc} onChange={setCc} orgUnitKey={unit} /></Field>
      <Field label={t('terminals_address')} required><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      <Field label={p('Основание', 'Asos', 'Reason')} required error={error}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
    </Modal>
  );
}

function WriteoffModal({ d, onClose }: { d: TerminalDevice; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const [reason, setReason] = useState('');
  const [chair, setChair] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [protocol, setProtocol] = useState('');
  const { error, busy, run } = useRun(onClose);
  return (
    <Modal title={`${d.code}: ${p('списание терминала', 'terminalni hisobdan chiqarish', 'terminal write-off')}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} onClick={() => run(async () => { const act = await terminalsApi.requestWriteoff(d.id, { reason, commission: { chairmanId: chair, memberIds: members, protocolNo: protocol } }, user); navigate(`/assets/writeoffs/${act.id}`); }, p('Акт ОС-4 составлен; в iABS терминал переведён в «Списан»', 'OS-4 dalolatnomasi tuzildi; iABSda terminal «Hisobdan chiqarilgan»ga o‘tkazildi', 'OS-4 act created; terminal set to “Written off” in iABS'))}>{p('Составить акт ОС-4', 'OS-4 dalolatnomasini tuzish', 'Create OS-4 act')}</Button></>}>
      <div className="wms-note">{p('Свободный терминал сразу получает в iABS статус «Списан»; после утверждения списания он удаляется из списка «Списан».', 'Bo‘sh terminal iABSda darhol «Hisobdan chiqarilgan» holatini oladi; tasdiqlangach ro‘yxatdan o‘chiriladi.', 'A free terminal gets “Written off” in iABS immediately; after approval it is removed from that list.')}</div>
      <Field label={p('Протокол комиссии №', 'Komissiya bayonnomasi №', 'Commission protocol no.')} required><Input value={protocol} onChange={(e) => setProtocol(e.target.value)} /></Field>
      <Field label={p('Председатель комиссии', 'Komissiya raisi', 'Chairman')} required><UserSelect value={chair} onChange={setChair} /></Field>
      <Field label={p('Члены комиссии (не менее двух)', 'Komissiya a’zolari (kamida ikki)', 'Members (at least two)')} required><UsersPicker value={members} onChange={setMembers} exclude={chair ? [chair] : []} /></Field>
      <Field label={p('Основание', 'Asos', 'Reason')} required error={error}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
    </Modal>
  );
}
