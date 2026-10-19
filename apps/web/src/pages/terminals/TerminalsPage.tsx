// Терминалы (ТЗ 4.2.19): терминалы как ОС (серийный номер, модель, HUMO/Uzcard, признак iABS), синхронизация с iABS
// «Учёт терминалов», справочник моделей и правил признака; мониторинг устройств и заявки на обслуживание.
import { useEffect, useState } from 'react';
import {
  canAccountTerminals, canReportTerminal, canServiceTerminal, decimalSep, formatDateTime, formatNumber, TERMINAL_LOW_CASH, terminalIabsFlag, terminalsApi, tk, today,
  type TerminalDevice, type TerminalIabsRule, type TerminalModel, type TerminalPaySystem, type TerminalState, type TerminalStatus, type TerminalSyncEntry, type TerminalTicket, type TerminalType,
} from '@xb/shared';
import { Badge, BarChart, Button, Card, Checkbox, DataTable, Field, FilterBar, Input, Modal, PageHeader, Select, Stat, StatusBadge, Tabs, Textarea, useToast, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { CostCenterSelect, OrgUnitSelect, UserSelect, useOrg, useP, useWmsError } from '../warehouse/wmsShared';
import { TicketModal } from './TicketModal';
import { GuardedLink } from '../../lib/access'; // P4-SEC: ссылки с учётом прав

export const TERMINAL_TONE = { online: 'ok', offline: 'danger', maintenance: 'warn' } as const;
export const IABS_TONE: Record<TerminalDevice['iabsStatus'], Tone> = { pending: 'info', active: 'ok', free: 'info', written_off: 'warn', deleted: 'muted', error: 'danger' };
export const STATE_TONE: Record<TerminalState, Tone> = { in_use: 'ok', free: 'info', written_off: 'muted' };
export const SYNC_TONE: Record<TerminalSyncEntry['status'], Tone> = { pending: 'info', success: 'ok', failed: 'danger', queued: 'warn', quarantined: 'danger' };
const TYPES: TerminalType[] = ['atm', 'pos', 'kiosk'];
const STATUSES: TerminalStatus[] = ['online', 'offline', 'maintenance'];
type Tab = 'devices' | 'tickets' | 'sync' | 'catalog';

export function CashLevel({ d }: { d: TerminalDevice }) {
  if (d.type !== 'atm' || d.cashLevel === undefined) return <span className="muted">—</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 90 }}>
      <div style={{ flex: 1 }} className={`progress${d.cashLevel < TERMINAL_LOW_CASH ? ' over' : ''}`}>
        <span style={{ width: `${d.cashLevel}%` }} />
      </div>
      <span className="num small" style={d.cashLevel < TERMINAL_LOW_CASH ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>{d.cashLevel}%</span>
    </div>
  );
}

export function TerminalsPage() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const [tab, setTab] = useState<Tab>('devices');
  const [ticket, setTicket] = useState(false);
  const [register, setRegister] = useState(false);
  const stats = useApi(() => terminalsApi.getStats());
  const s = stats.data;
  return (
    <>
      <PageHeader
        title={t('terminals_title')}
        subtitle={t('terminals_subtitle2')}
        actions={
          <>
            {canAccountTerminals(user) && <Button icon="plus" onClick={() => setRegister(true)}>{t('terminals_register')}</Button>}
            {canReportTerminal(user) && <Button type="primary" icon="plus" onClick={() => setTicket(true)}>{t('terminals_newTicket')}</Button>}
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={t('terminals_total')} value={s?.total ?? '—'} icon="terminal" tone="accent" foot={s ? `HUMO: ${s.humo} · Uzcard: ${s.uzcard} · ${t('terminals_state_free')}: ${s.free}` : undefined} />
        <Stat label={t('terminals_problems')} value={s ? s.offline + s.maintenance : '—'} tone={s && s.offline ? 'alert' : undefined} icon="alert" foot={s ? `${t('terminals_status_offline')}: ${s.offline} · ${t('terminals_status_maintenance')}: ${s.maintenance}` : undefined} />
        <Stat label={t('terminals_uptime')} value={s ? `${String(s.avgUptime).replace('.', decimalSep())}%` : '—'} icon="chart" foot={s ? `${t('terminals_txToday')}: ${formatNumber(s.txToday)}` : undefined} />
        <Stat label={t('terminals_lowCash')} value={s?.lowCash ?? '—'} tone={s?.lowCash ? 'alert' : undefined} icon="coins" foot={s ? `${t('terminals_openTickets')}: ${s.openTickets} · iABS ${p('ошибок', 'xatolar', 'errors')}: ${s.syncErrors}` : undefined} />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'devices', label: t('terminals_devices'), ...(s ? { count: s.total } : {}) },
            { value: 'tickets', label: t('terminals_tickets'), ...(s ? { count: s.openTickets } : {}) },
            { value: 'sync', label: t('terminals_sync'), ...(s?.syncErrors ? { count: s.syncErrors } : {}) },
            { value: 'catalog', label: t('terminals_catalog') },
          ]}
        />
        {tab === 'devices' && <Devices />}
        {tab === 'tickets' && <TicketsTable />}
        {tab === 'sync' && <SyncLog />}
        {tab === 'catalog' && <Catalog />}
      </Card>
      {tab === 'devices' && <ByRegion />}
      {ticket && <TicketModal onClose={() => setTicket(false)} />}
      {register && <RegisterTerminalModal onClose={() => setRegister(false)} />}
    </>
  );
}

function Devices() {
  const { t } = useSession();
  const p = useP();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TerminalType | ''>('');
  const [status, setStatus] = useState<TerminalStatus | ''>('');
  const [region, setRegion] = useState('');
  const [pay, setPay] = useState<TerminalPaySystem | ''>('');
  const [state, setState] = useState<TerminalState | ''>('');
  const regions = useApi(() => terminalsApi.regions());
  const list = useApi(() => terminalsApi.list({ search, ...(type ? { type } : {}), ...(status ? { status } : {}), ...(region ? { region } : {}), ...(pay ? { paySystem: pay } : {}), ...(state ? { state } : {}) }), [search, type, status, region, pay, state]);
  const columns: Column<TerminalDevice>[] = [
    { header: t('terminals_code'), render: (d) => (<><span className="doc-num">{d.code}</span><div className="sub wms-mono">{d.serialNo}</div></>) },
    { header: t('terminals_model'), render: (d) => (<>{d.model}<div className="sub">{t(tk('terminals_type_', d.type))} · {d.inventoryNo}</div></>) },
    { header: t('terminals_paySystem'), render: (d) => (<><Badge tone={d.paySystem === 'humo' ? 'info' : 'ok'}>{t(tk('terminals_pay_', d.paySystem))}</Badge><div className="sub wms-mono">{d.iabsFlag}</div></>) },
    { header: t('terminals_branch'), render: (d) => (<>{d.branch}<div className="sub">{d.region}</div></>) },
    { header: t('terminals_cash'), render: (d) => <CashLevel d={d} /> },
    { header: t('terminals_uptimeShort'), align: 'right', render: (d) => <span style={d.uptime30d < 95 ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{String(d.uptime30d).replace('.', decimalSep())}%</span> },
    { header: t('terminals_state'), render: (d) => (<><StatusBadge prefix="terminals_state_" status={d.state} tone={STATE_TONE[d.state]} /><div className="sub"><StatusBadge prefix="terminals_iabs_" status={d.iabsStatus} tone={IABS_TONE[d.iabsStatus]} /></div></>) },
    { header: t('status'), render: (d) => <StatusBadge prefix="terminals_status_" status={d.status} tone={TERMINAL_TONE[d.status]} /> },
  ];
  return (
    <>
      <FilterBar>
        <Input placeholder={`${t('search')}: ${t('terminals_code')}, ${t('terminals_serial').toLowerCase()}, ${t('terminals_address').toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select<TerminalType> value={type} onChange={setType} placeholder={`${t('terminals_type')}: ${t('all')}`} options={TYPES.map((x) => ({ value: x, label: t(tk('terminals_type_', x)) }))} />
        <Select<TerminalStatus> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={STATUSES.map((x) => ({ value: x, label: t(tk('terminals_status_', x)) }))} />
        <Select value={region} onChange={setRegion} placeholder={`${t('terminals_region')}: ${t('all')}`} options={(regions.data ?? []).map((r) => ({ value: r, label: r }))} />
        <Select<TerminalPaySystem> value={pay} onChange={setPay} placeholder={`${t('terminals_paySystem')}: ${t('all')}`} options={(['humo', 'uzcard'] as const).map((x) => ({ value: x, label: t(tk('terminals_pay_', x)) }))} />
        <Select<TerminalState> value={state} onChange={setState} placeholder={`${t('terminals_state')}: ${t('all')}`} options={(['in_use', 'free', 'written_off'] as const).map((x) => ({ value: x, label: t(tk('terminals_state_', x)) }))} />
        <ExportButton filename={p('Реестр терминалов', 'Terminallar reestri', 'Terminal register')} rows={list.data ?? []} columns={[
          { header: t('terminals_code'), value: (d) => d.code }, { header: t('terminals_serial'), value: (d) => d.serialNo }, { header: t('terminals_invNo'), value: (d) => d.inventoryNo }, { header: t('terminals_model'), value: (d) => d.model },
          { header: t('terminals_paySystem'), value: (d) => t(tk('terminals_pay_', d.paySystem)) }, { header: t('terminals_iabsFlag'), value: (d) => d.iabsFlag }, { header: t('terminals_iabsSection'), value: (d) => d.iabsSection }, { header: t('terminals_branch'), value: (d) => d.branch },
          { header: t('terminals_state'), value: (d) => t(tk('terminals_state_', d.state)) }, { header: t('terminals_iabsStatus'), value: (d) => t(tk('terminals_iabs_', d.iabsStatus)) }, { header: t('status'), value: (d) => t(tk('terminals_status_', d.status)) },
        ]} />
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(d) => d.id} columns={columns} onRowClick={(d) => navigate(`/terminals/${d.id}`)} />
    </>
  );
}

export function TicketsTable({ terminalId }: { terminalId?: string }) {
  const { t } = useSession();
  const user = useUser();
  const canService = canServiceTerminal(user);
  const lk = useLookups();
  const toast = useToast();
  const err = useWmsError('terminals_err_');
  const tickets = useApi(() => terminalsApi.listTickets(terminalId), [terminalId]);
  const devices = useApi(() => terminalsApi.list({ includeWrittenOff: true }));
  const [closing, setClosing] = useState<TerminalTicket | null>(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const dev = (id: string) => devices.data?.find((d) => d.id === id);
  const columns: Column<TerminalTicket>[] = [
    { header: t('terminals_ticketNo'), render: (x) => <span className="doc-num">{x.number}</span> },
    ...(terminalId ? [] : [{ header: t('terminals_code'), render: (x: TerminalTicket) => <Link to={`/terminals/${x.terminalId}`}>{dev(x.terminalId)?.code}</Link> }]),
    { header: t('terminals_issue'), render: (x) => (<><b>{t(tk('terminals_issue_', x.issue))}</b><div className="sub">{x.description}</div>{x.resolution && <div className="sub">✓ {x.resolution}</div>}</>) },
    { header: t('terminals_opened'), render: (x) => (<><span className="num muted">{formatDateTime(x.openedAt)}</span><div className="sub">{lk.user(x.openedBy)?.fullName}</div></>) },
    { header: t('status'), render: (x) => <StatusBadge prefix="terminals_tstatus_" status={x.status} tone={x.status === 'open' ? 'warn' : 'muted'} /> },
    { header: '', render: (x) => (x.status === 'open' && canService ? <Button size="small" onClick={() => { setClosing(x); setResolution(''); }}>{t('terminals_closeTicket')}</Button> : null) },
  ];
  return (
    <>
      <DataTable rows={tickets.data} loading={tickets.loading} rowKey={(x) => x.id} columns={columns} />
      {closing && (
        <Modal
          title={`${t('terminals_closeTicket')}: ${closing.number}`}
          onClose={() => setClosing(null)}
          footer={
            <>
              <Button onClick={() => setClosing(null)}>{t('cancel')}</Button>
              <Button type="primary" disabled={busy || !resolution.trim()} onClick={async () => {
                setBusy(true);
                try {
                  await terminalsApi.closeTicket(closing.id, resolution.trim(), user);
                  toast(`${closing.number}: ${t('terminals_ticketClosed')}`);
                  setClosing(null);
                } catch (e) {
                  toast(err(e));
                } finally {
                  setBusy(false);
                }
              }}>{t('terminals_closeTicket')}</Button>
            </>
          }
        >
          <div className="muted small">{t(tk('terminals_issue_', closing.issue))} · {closing.description}</div>
          <Field label={t('terminals_resolution')} required><Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
        </Modal>
      )}
    </>
  );
}

export function SyncLog({ terminalId }: { terminalId?: string }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useWmsError('terminals_err_');
  const list = useApi(() => terminalsApi.listSync(terminalId), [terminalId]);
  const devices = useApi(() => terminalsApi.list({ includeWrittenOff: true }));
  return (
    <DataTable rows={list.data} loading={list.loading} rowKey={(e) => e.id} columns={[
      { header: p('Время', 'Vaqt', 'Time'), render: (e) => <span className="num muted">{formatDateTime(e.at)}</span> },
      ...(terminalId ? [] : [{ header: t('terminals_code'), render: (e: TerminalSyncEntry) => <Link to={`/terminals/${e.terminalId}`}>{devices.data?.find((d) => d.id === e.terminalId)?.code ?? e.terminalId}</Link> }]),
      { header: p('Операция iABS', 'iABS operatsiyasi', 'iABS operation'), render: (e) => (<>{t(tk('terminals_syncop_', e.operation))}<div className="sub wms-mono">{e.serialNo} · {e.inventoryNo}</div></>) },
      { header: p('Данные', 'Ma’lumotlar', 'Payload'), render: (e) => <span className="wms-note wms-mono">{Object.entries(e.payload).filter(([k]) => !['serialNo', 'inventoryNo'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' · ')}</span> },
      { header: t('initiator'), render: (e) => <span className="muted">{lk.user(e.userId)?.fullName ?? e.userId}</span> },
      { header: t('status'), render: (e) => (<><StatusBadge prefix="terminals_syncst_" status={e.status} tone={SYNC_TONE[e.status]} />{e.error && <div className="sub" style={{ color: 'var(--danger)' }}>{e.error}</div>}{e.exchangeId && <div className="sub"><GuardedLink to="/integrations">{e.exchangeId}</GuardedLink></div>}</>) },
      { header: '', render: (e) => ((e.status === 'failed' || e.status === 'queued') && e.exchangeId ? <Button size="small" icon="refresh" onClick={() => terminalsApi.retrySync(e.id, user).then(() => toast(p('Повторная отправка выполнена', 'Qayta yuborildi', 'Resent'))).catch((x) => toast(err(x)))}>{p('Повторить', 'Takrorlash', 'Retry')}</Button> : null) },
    ]} />
  );
}

function Catalog() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('terminals_err_');
  const models = useApi(() => terminalsApi.listModels());
  const rules = useApi(() => terminalsApi.listRules());
  const [model, setModel] = useState<(Omit<TerminalModel, 'id'> & { id?: string }) | null>(null);
  const [rule, setRule] = useState<(Omit<TerminalIabsRule, 'id'> & { id?: string }) | null>(null);
  const [serial, setSerial] = useState('');
  const [pay, setPay] = useState<TerminalPaySystem>('humo');
  const canEdit = canAccountTerminals(user);
  const preview = serial.trim() ? terminalIabsFlag(serial, pay, rules.data ?? []) : undefined;
  return (
    <div className="wms-pad">
      <Card title={p('Определение признака iABS (проверка)', 'iABS belgisini aniqlash (tekshiruv)', 'iABS flag check')}>
        <div className="wms-row">
          <Input value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} placeholder="A930-26-000123" ariaLabel={t('terminals_serial')} />
          <Select<TerminalPaySystem> value={pay} onChange={setPay} options={(['humo', 'uzcard'] as const).map((x) => ({ value: x, label: t(tk('terminals_pay_', x)) }))} />
          {serial.trim() && (preview ? <Badge tone="ok">{preview.flag} · {preview.section}</Badge> : <Badge tone="danger">{t('terminals_err_NO_IABS_RULE')}</Badge>)}
        </div>
      </Card>
      <Card title={p('Правила признака iABS (префикс / диапазон серийного номера + платёжная система)', 'iABS belgisi qoidalari (seriya raqami prefiksi / diapazoni + to‘lov tizimi)', 'iABS flag rules (serial prefix / range + payment system)')} actions={canEdit ? <Button size="small" icon="plus" onClick={() => setRule({ paySystem: 'humo', prefix: '', flag: '', section: '', priority: 10, active: true })}>{p('Правило', 'Qoida', 'Rule')}</Button> : undefined} flush>
        <DataTable rows={rules.data} rowKey={(r) => r.id} onRowClick={canEdit ? (r) => setRule(r) : undefined} columns={[
          { header: t('terminals_paySystem'), render: (r) => t(tk('terminals_pay_', r.paySystem)) },
          { header: p('Префикс / диапазон', 'Prefiks / diapazon', 'Prefix / range'), render: (r) => <span className="wms-mono">{r.prefix ? `${r.prefix}*` : ''}{r.rangeFrom || r.rangeTo ? `${r.rangeFrom ?? ''} … ${r.rangeTo ?? ''}` : ''}</span> },
          { header: t('terminals_iabsFlag'), render: (r) => <b className="wms-mono">{r.flag}</b> },
          { header: t('terminals_iabsSection'), render: (r) => r.section },
          { header: p('Приоритет', 'Ustuvorlik', 'Priority'), align: 'right', render: (r) => r.priority },
          { header: t('status'), render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? p('активно', 'faol', 'active') : p('выключено', 'o‘chirilgan', 'off')}</Badge> },
        ]} />
      </Card>
      <Card title={p('Справочник моделей терминалов', 'Terminal modellari ma’lumotnomasi', 'Terminal models')} actions={canEdit ? <Button size="small" icon="plus" onClick={() => setModel({ brand: '', model: '', type: 'pos', paySystems: ['humo', 'uzcard'], serialPrefix: '', active: true })}>{p('Модель', 'Model', 'Model')}</Button> : undefined} flush>
        <DataTable rows={models.data} rowKey={(m) => m.id} onRowClick={canEdit ? (m) => setModel(m) : undefined} columns={[
          { header: p('Марка', 'Marka', 'Brand'), render: (m) => m.brand },
          { header: t('terminals_model'), render: (m) => <b>{m.model}</b> },
          { header: t('terminals_type'), render: (m) => t(tk('terminals_type_', m.type)) },
          { header: t('terminals_paySystem'), render: (m) => m.paySystems.map((x) => t(tk('terminals_pay_', x))).join(', ') },
          { header: p('Префикс S/N', 'S/N prefiksi', 'S/N prefix'), render: (m) => <span className="wms-mono">{m.serialPrefix ?? '—'}</span> },
        ]} />
      </Card>
      {model && (
        <Modal title={t('terminals_model')} onClose={() => setModel(null)} footer={<><Button onClick={() => setModel(null)}>{t('cancel')}</Button><Button type="primary" onClick={() => terminalsApi.saveModel(model, user).then(() => { setModel(null); toast(t('saved')); }).catch((e) => toast(err(e)))}>{t('save')}</Button></>}>
          <Field label={p('Марка', 'Marka', 'Brand')} required><Input value={model.brand} onChange={(e) => setModel({ ...model, brand: e.target.value })} /></Field>
          <Field label={t('terminals_model')} required><Input value={model.model} onChange={(e) => setModel({ ...model, model: e.target.value })} /></Field>
          <Field label={t('terminals_type')} required><Select<TerminalType> value={model.type} onChange={(v) => setModel({ ...model, type: v })} options={TYPES.map((x) => ({ value: x, label: t(tk('terminals_type_', x)) }))} /></Field>
          <Field label={p('Префикс серийного номера', 'Seriya raqami prefiksi', 'Serial prefix')}><Input value={model.serialPrefix ?? ''} onChange={(e) => setModel({ ...model, serialPrefix: e.target.value.toUpperCase() })} /></Field>
          <div className="wms-row">
            {(['humo', 'uzcard'] as const).map((x) => <Checkbox key={x} checked={model.paySystems.includes(x)} onChange={(v) => setModel({ ...model, paySystems: v ? [...model.paySystems, x] : model.paySystems.filter((y) => y !== x) })}>{t(tk('terminals_pay_', x))}</Checkbox>)}
          </div>
        </Modal>
      )}
      {rule && (
        <Modal title={t('terminals_iabsFlag')} onClose={() => setRule(null)} footer={<><Button onClick={() => setRule(null)}>{t('cancel')}</Button><Button type="primary" onClick={() => terminalsApi.saveRule(rule, user).then(() => { setRule(null); toast(t('saved')); }).catch((e) => toast(err(e)))}>{t('save')}</Button></>}>
          <Field label={t('terminals_paySystem')} required><Select<TerminalPaySystem> value={rule.paySystem} onChange={(v) => setRule({ ...rule, paySystem: v })} options={(['humo', 'uzcard'] as const).map((x) => ({ value: x, label: t(tk('terminals_pay_', x)) }))} /></Field>
          <Field label={p('Префикс серийного номера', 'Seriya raqami prefiksi', 'Serial prefix')}><Input value={rule.prefix ?? ''} onChange={(e) => setRule({ ...rule, prefix: e.target.value.toUpperCase() })} /></Field>
          <div className="wms-form-grid">
            <Field label={p('Диапазон: от', 'Diapazon: dan', 'Range: from')}><Input value={rule.rangeFrom ?? ''} onChange={(e) => setRule({ ...rule, rangeFrom: e.target.value.toUpperCase() })} /></Field>
            <Field label={p('Диапазон: до', 'Diapazon: gacha', 'Range: to')}><Input value={rule.rangeTo ?? ''} onChange={(e) => setRule({ ...rule, rangeTo: e.target.value.toUpperCase() })} /></Field>
          </div>
          <Field label={t('terminals_iabsFlag')} required><Input value={rule.flag} onChange={(e) => setRule({ ...rule, flag: e.target.value.toUpperCase() })} /></Field>
          <Field label={t('terminals_iabsSection')} required><Input value={rule.section} onChange={(e) => setRule({ ...rule, section: e.target.value })} /></Field>
          <Field label={p('Приоритет', 'Ustuvorlik', 'Priority')}><Input type="number" value={rule.priority} onChange={(e) => setRule({ ...rule, priority: Number(e.target.value) })} /></Field>
          <Checkbox checked={rule.active} onChange={(v) => setRule({ ...rule, active: v })}>{p('Активно', 'Faol', 'Active')}</Checkbox>
        </Modal>
      )}
    </div>
  );
}

function ByRegion() {
  const { t } = useSession();
  const list = useApi(() => terminalsApi.list());
  const all = list.data ?? [];
  const regions = [...new Set(all.map((d) => d.region))];
  if (!regions.length) return null;
  return (
    <Card title={t('terminals_byRegion')}>
      <BarChart data={regions.map((r) => ({ label: r.replace(/ (vil\.|sh\.)$/, ''), values: TYPES.map((ty) => all.filter((d) => d.region === r && d.type === ty).length) }))} series={TYPES.map((ty) => ({ name: t(tk('terminals_type_', ty)) }))} />
    </Card>
  );
}

/** Оприходование терминала как ОС: серийный номер (обязательный, без дубликатов), модель, HUMO/Uzcard, ЦБУ, МОЛ, стоимость. */
export function RegisterTerminalModal({ onClose }: { onClose: () => void }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useWmsError('terminals_err_');
  const models = useApi(() => terminalsApi.listModels());
  const [serial, setSerial] = useState('');
  const [modelId, setModelId] = useState('');
  const [pay, setPay] = useState<TerminalPaySystem | ''>('');
  const [unit, setUnit] = useState('');
  const [dept, setDept] = useState('d9');
  const [cc, setCc] = useState('');
  const [mol, setMol] = useState('');
  const [address, setAddress] = useState('');
  const [cost, setCost] = useState('');
  const [date, setDate] = useState(today());
  const [state, setState] = useState<'in_use' | 'free'>('in_use');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const check = useApi(() => (serial.trim().length >= 4 ? terminalsApi.checkSerial(serial, pay) : Promise.resolve(undefined)), [serial, pay]);
  const m = models.data?.find((x) => x.id === modelId);
  useEffect(() => {
    if (m && pay && !m.paySystems.includes(pay)) setPay('');
  }, [modelId]);
  async function save() {
    setError('');
    setBusy(true);
    try {
      const d = await terminalsApi.registerTerminal({ serialNo: serial, modelId, paySystem: pay as TerminalPaySystem, orgUnitKey: unit, departmentId: dept, costCenterId: cc, responsibleId: mol, address, cost: Number(cost), acquiredAt: date, state }, user);
      toast(`${d.code} · ${d.inventoryNo}: ${t('terminals_registered')}`);
      onClose();
      navigate(`/terminals/${d.id}`);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  const dup = check.data?.duplicate;
  return (
    <Modal title={t('terminals_register')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" loading={busy} disabled={!!dup} onClick={save}>{t('terminals_register')}</Button></>}>
      <Field label={t('terminals_serial')} required error={dup ? `${t('terminals_err_SERIAL_DUP')}: ${dup.code}` : check.data && !check.data.valid ? t('terminals_err_SERIAL_FORMAT') : undefined} hint={check.data?.rule ? `${t('terminals_iabsFlag')}: ${check.data.rule.flag} · ${check.data.rule.section}` : undefined}>
        <Input value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} placeholder={m?.serialPrefix ? `${m.serialPrefix}-…` : 'A930-26-000123'} />
      </Field>
      {dup && <div className="wms-danger"><Link to={dup.kind === 'terminal' ? `/terminals/${dup.id}` : `/assets/${dup.id}`}>{dup.code}</Link></div>}
      <div className="wms-form-grid">
        <Field label={t('terminals_model')} required><Select value={modelId} onChange={setModelId} placeholder="—" options={(models.data ?? []).filter((x) => x.active).map((x) => ({ value: x.id, label: `${x.model} (${t(tk('terminals_type_', x.type))})` }))} /></Field>
        <Field label={t('terminals_paySystem')} required><Select<TerminalPaySystem> value={pay} onChange={setPay} placeholder="—" options={(m?.paySystems ?? ['humo', 'uzcard']).map((x) => ({ value: x, label: t(tk('terminals_pay_', x)) }))} /></Field>
        <Field label={p('ЦБУ', 'BXM', 'Branch (BSC)')} required><OrgUnitSelect value={unit} onChange={(v) => { setUnit(v); setCc(''); }} types={['branch_office', 'region']} /></Field>
        <Field label={t('department')} required><Select value={dept} onChange={setDept} options={lk.departments.map((d) => ({ value: d.id, label: `${d.code} · ${loc(d.name)}` }))} /></Field>
        <Field label={p('МВЗ', 'XMM', 'Cost center')} required><CostCenterSelect value={cc} onChange={setCc} orgUnitKey={unit} /></Field>
        <Field label={p('Материально ответственное лицо', 'Moddiy javobgar shaxs', 'Custodian')} required><UserSelect value={mol} onChange={setMol} /></Field>
        <Field label={t('terminals_address')} required className="wide"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label={p('Первоначальная стоимость', 'Boshlang‘ich qiymat', 'Original cost')} required><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label={p('Дата оприходования', 'Kirim sanasi', 'Registration date')} required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('terminals_state')} required><Select<'in_use' | 'free'> value={state} onChange={setState} options={[{ value: 'in_use', label: t('terminals_state_in_use') }, { value: 'free', label: t('terminals_state_free') }]} /></Field>
      </div>
      <div className="wms-note">{p('Создаётся карточка ОС с автоматическим инвентарным номером; терминал регистрируется в iABS «Учёт терминалов» с признаком и неизменяемым инвентарным номером.', 'Avtomatik inventar raqamli AV kartochkasi yaratiladi; terminal iABS «Terminallar hisobi»da belgi va o‘zgarmas inventar raqami bilan ro‘yxatga olinadi.', 'An asset card with an auto inventory number is created; the terminal is registered in iABS Terminal Accounting with the flag and an immutable inventory number.')}</div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}
