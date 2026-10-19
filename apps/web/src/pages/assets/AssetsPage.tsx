// Основные средства (ТЗ 4.2.5): оболочка модуля, реестр, дашборд, постановка на учёт, амортизация.
import { useEffect, useState } from 'react';
import {
  assetNbv, assetsApi, canAccountAssets, canRunDepreciation, currencyLabel, formatDateTime, formatMoney, formatMoneyShort, leasePresentValue, today, tk,
  type AssetCategory, type AssetMethod, type AssetRecord, type AssetSource, type AssetStatus,
} from '@xb/shared';
import { BarChart, Button, Card, Checkbox, DataTable, Field, FilterBar, Input, LineChart, Modal, PageHeader, Progress, Select, Stat, StatusBadge, Switch, Tabs, useToast, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { CostCenterSelect, LabelPreview, OrgUnitSelect, UserSelect, useOrg, useP, useWmsError, type WmsLabel } from '../warehouse/wmsShared';
import { OperationsTab, WriteoffsTab } from './asOps';
import { InventoryTab } from './asInventory';
import { MonitoringTab, ReportsTab, SettingsTab } from './asMonitoring';

const CATEGORIES: AssetCategory[] = ['computers', 'atm', 'furniture', 'vehicles', 'buildings', 'security', 'leased'];
const STATUSES: AssetStatus[] = ['in_use', 'repair', 'conservation', 'leased_out', 'pending_transfer', 'pending_writeoff', 'missing', 'written_off', 'sold'];
export const ASSET_TONE: Record<AssetStatus, Tone> = { in_use: 'ok', repair: 'warn', conservation: 'muted', leased_out: 'info', pending_transfer: 'info', pending_writeoff: 'warn', written_off: 'muted', sold: 'muted', missing: 'danger' };
export type AssetsTab = 'register' | 'dashboard' | 'operations' | 'writeoffs' | 'depreciation' | 'inventory' | 'monitoring' | 'reports' | 'settings';
const TAB_PATH: Record<AssetsTab, string> = { register: '/assets', dashboard: '/assets/dashboard', operations: '/assets/operations', writeoffs: '/assets/writeoffs', depreciation: '/assets/depreciation', inventory: '/assets/inventory', monitoring: '/assets/monitoring', reports: '/assets/reports', settings: '/assets/settings' };
export const assetQr = (a: Pick<AssetRecord, 'inventoryNo'>) => `XB-OS:${a.inventoryNo}`;

export function AssetsPage({ tab: initial = 'register' }: { tab?: AssetsTab }) {
  const { t, lang } = useSession();
  const p = useP();
  const user = useUser();
  const [tab, setTab] = useState<AssetsTab>(initial);
  const [confirm, setConfirm] = useState(false);
  const [register, setRegister] = useState(false);
  const stats = useApi(() => assetsApi.getStats());
  const s = stats.data;
  useEffect(() => setTab(initial), [initial]);
  useEffect(() => {
    void assetsApi.ensureDailyMonitoring(user);
    void assetsApi.ensureAutoDepreciation(user);
  }, [user.id]);
  const tabs: { value: AssetsTab; label: string; count?: number }[] = [
    { value: 'register', label: p('Реестр ОС', 'AV reestri', 'Register') },
    { value: 'dashboard', label: p('Обзор', 'Umumiy', 'Overview') },
    { value: 'operations', label: p('Операции', 'Operatsiyalar', 'Operations'), ...(s?.unfinished ? { count: s.unfinished } : {}) },
    { value: 'writeoffs', label: p('Списание (ОС-4)', 'Hisobdan chiqarish (OS-4)', 'Write-off (OS-4)') },
    { value: 'depreciation', label: p('Амортизация', 'Amortizatsiya', 'Depreciation') },
    { value: 'inventory', label: p('Инвентаризация', 'Inventarizatsiya', 'Stocktaking') },
    { value: 'monitoring', label: p('Мониторинг', 'Monitoring', 'Monitoring'), ...(s?.postingsError ? { count: s.postingsError } : {}) },
    { value: 'reports', label: p('Отчёты', 'Hisobotlar', 'Reports') },
    { value: 'settings', label: p('Группы и правила', 'Guruhlar va qoidalar', 'Groups and rules') },
  ];
  return (
    <>
      <PageHeader
        title={t('assets_title')}
        subtitle={t('assets_subtitle')}
        actions={
          <>
            {canAccountAssets(user) && <Button icon="plus" onClick={() => setRegister(true)}>{p('Поставить на учёт', 'Hisobga olish', 'Register asset')}</Button>}
            {canRunDepreciation(user) && <Button type="primary" onClick={() => setConfirm(true)}>{t('assets_runDep')}</Button>}
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={t('assets_count')} value={s?.count ?? '—'} icon="building" tone="accent" foot={s ? `${t('assets_pending')}: ${s.pendingWriteoff}` : undefined} />
        <Stat label={t('assets_cost')} value={s ? formatMoneyShort(s.cost, lang) : '—'} foot={s ? `${currencyLabel()} · ${p('дооценка', 'qayta baholash', 'revaluation')} ${formatMoneyShort(s.revaluation, lang)}` : currencyLabel()} />
        <Stat label={t('assets_nbv')} value={s ? formatMoneyShort(s.nbv, lang) : '—'} foot={currencyLabel()} />
        <Stat label={t('assets_monthly')} value={s ? formatMoneyShort(s.monthlyDepreciation, lang) : '—'} foot={s ? `${t('assets_lastRun')}: ${s.lastRunPeriod} · ${p('авто', 'avto', 'auto')} ${s.autoDep ? `${s.depDay}-${p('го', '', 'th')}` : '—'}` : undefined} />
      </div>
      <Card flush>
        <Tabs<AssetsTab> value={tab} onChange={(v) => { setTab(v); navigate(TAB_PATH[v]); }} items={tabs} />
        {tab === 'register' && <Register />}
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'operations' && <OperationsTab />}
        {tab === 'writeoffs' && <WriteoffsTab />}
        {tab === 'depreciation' && <DepreciationTab />}
        {tab === 'inventory' && <InventoryTab />}
        {tab === 'monitoring' && <MonitoringTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'settings' && <SettingsTab />}
      </Card>
      {confirm && s && <RunDepModal canRun={s.canRun} next={s.nextPeriod} onClose={() => setConfirm(false)} />}
      {register && <RegisterAssetModal onClose={() => setRegister(false)} />}
    </>
  );
}

function RunDepModal({ canRun, next, onClose }: { canRun: boolean; next: string; onClose: () => void }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('assets_err_');
  const errors = assetsApi.depreciationErrors();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t('assets_runDep')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} disabled={!canRun || errors.length > 0} onClick={async () => {
            setBusy(true);
            try {
              const r = await assetsApi.runDepreciation(user);
              toast(`${t('assets_runDone')}: ${r.period} · ${r.assets} · ${formatMoney(r.amount)}`);
              onClose();
            } catch (e) {
              toast(err(e));
            } finally {
              setBusy(false);
            }
          }}>{t('assets_runDep')}</Button>
        </>
      }
    >
      {canRun ? <p>{t('assets_runConfirm')} ({next})</p> : <p>{t('assets_alreadyRun')}. {t('assets_nextRun')}: {next}</p>}
      {errors.length > 0 && <div className="wms-danger">{t('assets_err_DEP_ERRORS')}: {errors.map((e) => e.inventoryNo).join(', ')}</div>}
      <div className="wms-note">{p('Проводки: Дт 56320000 (по МВЗ, с учётом аллокации) — Кт 16599000; передаются в iABS.', 'Provodkalar: Dt 56320000 (XMM bo‘yicha, taqsimot bilan) — Kt 16599000; iABSga yuboriladi.', 'Postings: Dr 56320000 (by cost center, with allocation) — Cr 16599000; sent to iABS.')}</div>
    </Modal>
  );
}

function Register() {
  const { t, loc } = useSession();
  const p = useP();
  const lk = useLookups();
  const org = useOrg();
  const [category, setCategory] = useState<AssetCategory | ''>('');
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('');
  const [mine, setMine] = useState(false);
  const [labels, setLabels] = useState<WmsLabel[] | null>(null);
  const user = useUser();
  const groups = useApi(() => assetsApi.listGroups());
  const list = useApi(() => assetsApi.list({ search, ...(category ? { category } : {}), ...(status ? { status } : {}), ...(unit ? { orgUnitKey: unit } : {}), ...(mine ? { responsibleId: user.id } : {}) }), [search, category, status, unit, mine]);
  const g = (id: string) => groups.data?.find((x) => x.id === id);
  const cols: Column<AssetRecord>[] = [
    { header: t('assets_invNo'), render: (a) => <span className="doc-num">{a.inventoryNo}</span> },
    { header: t('assets_name'), render: (a) => (<>{a.name}<div className="sub">{g(a.groupId) ? `${g(a.groupId)!.code} · ${loc(g(a.groupId)!.name)}` : t(tk('assets_cat_', a.category))}</div></>) },
    { header: t('assets_location'), render: (a) => (<>{org.unitName(a.orgUnitKey)}<div className="sub">{a.location} · {org.ccCode(a.costCenterId)}</div></>) },
    { header: t('assets_responsible'), render: (a) => <span className="muted">{lk.user(a.responsibleId)?.fullName}</span> },
    { header: t('assets_cost'), align: 'right', render: (a) => formatMoney(a.cost) },
    { header: t('assets_nbv'), align: 'right', render: (a) => formatMoney(assetNbv(a)) },
    { header: t('assets_wear'), render: (a) => (<div style={{ minWidth: 70 }}><Progress pct={Math.round((a.accumulated / a.cost) * 100)} /><div className="sub">{Math.round((a.accumulated / a.cost) * 100)}%</div></div>) },
    { header: t('status'), render: (a) => <StatusBadge prefix="assets_status_" status={a.status} tone={ASSET_TONE[a.status]} /> },
  ];
  return (
    <>
      <FilterBar>
        <Select<AssetCategory> value={category} onChange={setCategory} placeholder={`${t('assets_category')}: ${t('all')}`} options={CATEGORIES.map((c) => ({ value: c, label: t(tk('assets_cat_', c)) }))} />
        <Select<AssetStatus> value={status} onChange={setStatus} placeholder={`${t('status')}: ${t('all')}`} options={STATUSES.map((c) => ({ value: c, label: t(tk('assets_status_', c)) }))} />
        <Input placeholder={`${t('search')}: ${t('assets_invNo')}, ${t('assets_location').toLowerCase()}, S/N`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <OrgUnitSelect value={unit} onChange={setUnit} placeholder={`${p('Подразделение / ЦБУ', 'Bo‘linma / BXM', 'Unit / branch')}: ${t('all')}`} />
        <Checkbox checked={mine} onChange={setMine}>{p('Числятся за мной', 'Mening hisobimda', 'Held by me')}</Checkbox>
        <Button icon="printer" disabled={!list.data?.length} onClick={() => setLabels((list.data ?? []).map((a) => ({ title: a.name, sub: `${a.inventoryNo} · ${org.unitName(a.orgUnitKey)}`, qr: assetQr(a) })))}>{p('Этикетки', 'Yorliqlar', 'Labels')}</Button>
        <ExportButton filename={p('Реестр ОС', 'AV reestri', 'Asset register')} rows={list.data ?? []} columns={[
          { header: t('assets_invNo'), value: (a) => a.inventoryNo }, { header: t('assets_name'), value: (a) => a.name }, { header: p('Группа', 'Guruh', 'Group'), value: (a) => g(a.groupId)?.code ?? '' }, { header: p('Счёт', 'Hisob', 'Account'), value: (a) => g(a.groupId)?.account ?? '' },
          { header: p('Подразделение', 'Bo‘linma', 'Unit'), value: (a) => org.unitName(a.orgUnitKey) }, { header: p('МВЗ', 'XMM', 'CC'), value: (a) => org.ccCode(a.costCenterId) }, { header: t('assets_responsible'), value: (a) => lk.user(a.responsibleId)?.fullName ?? '' },
          { header: t('assets_acquired'), value: (a) => a.acquiredAt }, { header: t('assets_cost'), value: (a) => a.cost, format: 'money', total: true }, { header: t('assets_accumulated'), value: (a) => a.accumulated, format: 'money', total: true }, { header: t('assets_nbv'), value: (a) => assetNbv(a), format: 'money', total: true }, { header: t('status'), value: (a) => t(tk('assets_status_', a.status)) },
        ]} />
      </FilterBar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(a) => a.id} columns={cols} onRowClick={(a) => navigate(`/assets/${a.id}`)} />
      {labels && <LabelPreview labels={labels} entity="asset" onClose={() => setLabels(null)} />}
    </>
  );
}

function Dashboard() {
  const { lang, loc } = useSession();
  const p = useP();
  const org = useOrg();
  const d = useApi(() => assetsApi.dashboard());
  const x = d.data;
  if (!x) return <div className="wms-pad"><div className="skeleton" style={{ width: '60%' }} /></div>;
  const bySeg = new Map<string, number>();
  const byUnit = new Map<string, number>();
  for (const a of x.active) {
    const seg = org.cc(a.costCenterId)?.segment ?? '—';
    bySeg.set(seg, (bySeg.get(seg) ?? 0) + assetNbv(a));
    byUnit.set(a.orgUnitKey, (byUnit.get(a.orgUnitKey) ?? 0) + assetNbv(a));
  }
  return (
    <div className="wms-pad">
      <Card title={p('Движение ОС по месяцам (поступление / выбытие / передачи)', 'Oylar bo‘yicha AV harakati (kirim / chiqim / topshirish)', 'Asset movements by month (additions / disposals / transfers)')}>
        <LineChart labels={x.months.map((m) => m.slice(2))} series={[{ name: p('Поступление', 'Kirim', 'Additions'), values: x.added }, { name: p('Выбытие', 'Chiqim', 'Disposals'), values: x.disposed }, { name: p('Передачи', 'Topshirish', 'Transfers'), values: x.transfers }]} format={(n) => formatMoneyShort(n, lang)} />
      </Card>
      <div className="wms-split">
        <Card title={p('Остаточная стоимость по группам', 'Guruhlar bo‘yicha qoldiq qiymat', 'NBV by group')}>
          <BarChart data={x.byGroup.filter((g) => g.nbv > 0).map((g) => ({ label: g.group.code, values: [g.nbv] }))} series={[{ name: p('Остаточная', 'Qoldiq', 'NBV') }]} format={(n) => formatMoneyShort(n, lang)} />
          <div className="wms-note">{x.byGroup.map((g) => `${g.group.code} — ${loc(g.group.name)} (${g.count})`).join(' · ')}</div>
        </Card>
        <Card title={p('По сегментам', 'Segmentlar bo‘yicha', 'By segment')}>
          <BarChart data={[...bySeg.entries()].map(([k, v]) => ({ label: k, values: [v] }))} series={[{ name: p('Остаточная', 'Qoldiq', 'NBV') }]} format={(n) => formatMoneyShort(n, lang)} />
        </Card>
      </div>
      <Card title={p('По подразделениям и ЦБУ', 'Bo‘linmalar va BXM bo‘yicha', 'By unit and branch')} flush>
        <DataTable rows={[...byUnit.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v }))} rowKey={(r) => r.k} columns={[{ header: p('Подразделение', 'Bo‘linma', 'Unit'), render: (r) => org.unitName(r.k) }, { header: p('Остаточная', 'Qoldiq', 'NBV'), align: 'right', render: (r) => formatMoney(r.v) }]} />
      </Card>
      <div className="wms-note">{p('Проводки ОС сегодня', 'Bugungi AV provodkalari', 'Asset postings today')}: {x.postings.todayConfirmed}/{x.postings.todayTotal} · {p('ошибок', 'xatolar', 'errors')}: {x.postings.error}</div>
    </div>
  );
}

function DepreciationTab() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('assets_err_');
  const settings = useApi(() => assetsApi.depreciationSettings());
  const runs = useApi(() => assetsApi.listDepRuns());
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01`);
  const [to, setTo] = useState(today().slice(0, 7));
  const rep = useApi(() => assetsApi.depreciationReport(from, to), [from, to]);
  const [day, setDay] = useState('');
  const org = useOrg();
  const s = settings.data;
  return (
    <div className="wms-pad">
      <Card title={p('Автоматическое начисление', 'Avtomatik hisoblash', 'Automatic charge')}>
        {s && (
          <div className="wms-row">
            <span className="wms-row"><Switch checked={s.auto} disabled={!canRunDepreciation(user)} onChange={(v) => assetsApi.setDepreciationSettings(s.day, v, user).then(() => toast(t('saved'))).catch((e) => toast(err(e)))} ariaLabel={p('Автоначисление', 'Avtomatik hisoblash', 'Auto charge')} /> {p('Начислять автоматически', 'Avtomatik hisoblash', 'Charge automatically')}</span>
            <Field label={p('День месяца (1–28)', 'Oy kuni (1–28)', 'Day of month (1–28)')}><Input type="number" value={day || String(s.day)} onChange={(e) => setDay(e.target.value)} /></Field>
            {canRunDepreciation(user) && <Button onClick={() => assetsApi.setDepreciationSettings(Number(day || s.day), s.auto, user).then(() => { toast(t('saved')); void assetsApi.ensureAutoDepreciation(user); }).catch((e) => toast(err(e)))}>{t('save')}</Button>}
          </div>
        )}
        <div className="wms-note">{p('В установленный день месяца при отсутствии ошибок в карточках (МВЗ, срок, аллокация) амортизация начисляется автоматически с проводками; методы — линейный и уменьшаемого остатка (коэффициент 2).', 'Belgilangan kunda kartochkalarda xato bo‘lmasa, amortizatsiya avtomatik provodkalar bilan hisoblanadi; usullar — chiziqli va kamayuvchi qoldiq (koeffitsient 2).', 'On the set day, if cards have no errors (cost center, life, allocation), depreciation is charged automatically with postings; methods — straight-line and declining balance (factor 2).')}</div>
      </Card>
      <Card title={p('Журнал начислений', 'Hisoblashlar jurnali', 'Charge log')} flush>
        <DataTable rows={runs.data} loading={runs.loading} rowKey={(r) => r.id} columns={[
          { header: p('Период', 'Davr', 'Period'), render: (r) => <b>{r.period}</b> },
          { header: p('Время', 'Vaqt', 'Time'), render: (r) => formatDateTime(r.at) },
          { header: p('Запуск', 'Ishga tushirish', 'Run'), render: (r) => (r.auto ? p('автоматически', 'avtomatik', 'automatic') : p('вручную', 'qo‘lda', 'manual')) },
          { header: p('Объектов', 'Obyektlar', 'Assets'), align: 'right', render: (r) => r.lines.length },
          { header: t('amount'), align: 'right', render: (r) => formatMoney(r.total) },
        ]} />
      </Card>
      <Card title={p('Отчёт по начисленному износу в разрезе карточек', 'Kartochkalar kesimida hisoblangan eskirish hisoboti', 'Depreciation by card')} actions={<ExportButton filename={p('Износ по карточкам', 'Kartochkalar bo‘yicha eskirish', 'Depreciation by card')} rows={rep.data ?? []} columns={[{ header: t('assets_invNo'), value: (r) => r.asset.inventoryNo }, { header: t('assets_name'), value: (r) => r.asset.name }, { header: p('Метод', 'Usul', 'Method'), value: (r) => t(tk('assets_method_', r.asset.method)) }, { header: p('МВЗ', 'XMM', 'CC'), value: (r) => org.ccCode(r.costCenterId) }, { header: p('Месяцев', 'Oylar', 'Months'), value: (r) => r.periods, format: 'integer' }, { header: t('amount'), value: (r) => r.amount, format: 'money', total: true }]} />} flush>
          <FilterBar>
            <Field label={p('С', 'Dan', 'From')}><Input type="text" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={p('По', 'Gacha', 'To')}><Input type="text" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </FilterBar>
        <DataTable rows={rep.data} loading={rep.loading} rowKey={(r) => r.asset.id} columns={[
          { header: t('assets_invNo'), render: (r) => <span className="doc-num">{r.asset.inventoryNo}</span> },
          { header: t('assets_name'), render: (r) => r.asset.name },
          { header: p('Метод', 'Usul', 'Method'), render: (r) => t(tk('assets_method_', r.asset.method)) },
          { header: p('МВЗ', 'XMM', 'CC'), render: (r) => <span className="wms-mono">{org.ccCode(r.costCenterId)}</span> },
          { header: p('Месяцев', 'Oylar', 'Months'), align: 'right', render: (r) => r.periods },
          { header: t('amount'), align: 'right', render: (r) => formatMoney(r.amount) },
        ]} />
      </Card>
    </div>
  );
}

/** Постановка ОС на учёт: группа со счетами, авто инвентарный номер, источник (закупка, безвозмездно, строительство 16505/19907, аренда МСФО 16…). */
export function RegisterAssetModal({ onClose }: { onClose: () => void }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useWmsError('assets_err_');
  const groups = useApi(() => assetsApi.listGroups());
  const rules = useApi(() => assetsApi.listCapRules());
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [source, setSource] = useState<AssetSource>('purchase');
  const [funding, setFunding] = useState('');
  const [unit, setUnit] = useState('');
  const [dept, setDept] = useState('');
  const [cc, setCc] = useState('');
  const [mol, setMol] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(today());
  const [cost, setCost] = useState('');
  const [life, setLife] = useState('');
  const [method, setMethod] = useState<AssetMethod | ''>('');
  const [cp, setCp] = useState('');
  const [serial, setSerial] = useState('');
  const [model, setModel] = useState('');
  const [warranty, setWarranty] = useState('');
  const [monthly, setMonthly] = useState('');
  const [leaseTo, setLeaseTo] = useState('');
  const [error, setError] = useState('');
  const g = groups.data?.find((x) => x.id === groupId);
  const pv = source === 'lease' && Number(monthly) > 0 && leaseTo ? leasePresentValue(Number(monthly), date, leaseTo) : 0;
  async function save() {
    setError('');
    try {
      const a = await assetsApi.registerAsset(
        {
          name, groupId, orgUnitKey: unit, departmentId: dept, costCenterId: cc, responsibleId: mol, acquiredAt: date, cost: Number(cost), usefulLifeMonths: Number(life || g?.usefulLifeMonths || 0), method: (method || g?.method || 'linear') as AssetMethod, source, location,
          ...(funding ? { fundingAccount: funding } : {}), ...(cp ? { counterpartyId: cp } : {}), ...(serial ? { serialNo: serial } : {}), ...(model ? { model } : {}), ...(warranty ? { warrantyUntil: warranty } : {}),
          ...(source === 'lease' ? { lease: { direction: 'in' as const, counterpartyId: cp, from: date, to: leaseTo, monthly: Number(monthly) } } : {}),
        },
        user,
      );
      toast(`${a.inventoryNo}: ${p('поставлено на учёт', 'hisobga olindi', 'registered')}`);
      onClose();
      navigate(`/assets/${a.id}`);
    } catch (e) {
      setError(err(e));
    }
  }
  return (
    <Modal title={p('Постановка ОС на учёт', 'AV ni hisobga olish', 'Register fixed asset')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" onClick={save}>{p('Поставить на учёт', 'Hisobga olish', 'Register')}</Button></>}>
      <Field label={t('assets_name')} required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="wms-form-grid">
        <Field label={p('Группа ОС (счёт)', 'AV guruhi (hisob)', 'Asset group (account)')} required hint={g ? `${g.account} · ${p('инв. №', 'inv. №', 'inv. no.')} ${assetsApi.nextInventoryNo(g.id)}` : undefined}>
          <Select value={groupId} onChange={(v) => { setGroupId(v); const gg = groups.data?.find((x) => x.id === v); if (gg) { setLife(String(gg.usefulLifeMonths)); setMethod(gg.method); } }} placeholder="—" options={(groups.data ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${loc(x.name)}` }))} />
        </Field>
        <Field label={p('Источник поступления', 'Kirim manbai', 'Source')} required>
          <Select<AssetSource> value={source} onChange={setSource} options={(['purchase', 'gratuitous', 'construction', 'lease', 'other'] as const).map((s) => ({ value: s, label: t(tk('assets_src_', s)) }))} />
        </Field>
        {source === 'construction' && (
          <Field label={p('Счёт финансирования', 'Moliyalashtirish hisobi', 'Funding account')} required hint={rules.data?.filter((r) => r.active && r.groupId === groupId).map((r) => `${r.account}: ${r.description}`).join('; ') || p('Нет правил для группы', 'Guruh uchun qoida yo‘q', 'No rules for group')}>
            <Select value={funding} onChange={setFunding} placeholder="—" options={[{ value: '16505000', label: '16505 — ' + p('строительство, модернизация', 'qurilish, modernizatsiya', 'construction, modernization') }, { value: '19907000', label: '19907 — ' + p('ОС к установке', 'o‘rnatiladigan AV', 'assets to install') }]} />
          </Field>
        )}
        {(source === 'purchase' || source === 'lease' || source === 'gratuitous') && (
          <Field label={source === 'lease' ? p('Арендодатель', 'Ijaraga beruvchi', 'Lessor') : t('warehouse_supplier')} required={source === 'lease'}>
            <Select value={cp} onChange={setCp} placeholder="—" options={lk.counterparties.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
        )}
        <Field label={p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit')} required><OrgUnitSelect value={unit} onChange={(v) => { setUnit(v); setCc(''); }} /></Field>
        <Field label={t('department')} required><Select value={dept} onChange={setDept} placeholder="—" options={lk.departments.map((d) => ({ value: d.id, label: `${d.code} · ${loc(d.name)}` }))} /></Field>
        <Field label={p('МВЗ', 'XMM', 'Cost center')} required><CostCenterSelect value={cc} onChange={setCc} orgUnitKey={unit} /></Field>
        <Field label={t('assets_responsible')} required><UserSelect value={mol} onChange={setMol} /></Field>
        <Field label={t('assets_location')} required><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label={t('assets_acquired')} required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {source === 'lease' ? (
          <>
            <Field label={p('Платёж в месяц', 'Oylik to‘lov', 'Monthly payment')} required><Input type="number" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
            <Field label={p('Аренда до', 'Ijara muddati', 'Lease until')} required hint={pv ? `${p('Право пользования (PV, 20 %)', 'Foydalanish huquqi (PV, 20 %)', 'Right-of-use (PV, 20%)')}: ${formatMoney(pv)}` : undefined}><Input type="date" value={leaseTo} onChange={(e) => setLeaseTo(e.target.value)} /></Field>
          </>
        ) : (
          <Field label={t('assets_cost')} required><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        )}
        <Field label={`${t('assets_life')}, ${t('assets_months')}`} required><Input type="number" value={life} onChange={(e) => setLife(e.target.value)} /></Field>
        <Field label={p('Метод амортизации', 'Amortizatsiya usuli', 'Depreciation method')} required><Select<AssetMethod> value={method} onChange={setMethod} placeholder="—" options={(['linear', 'declining'] as const).map((m) => ({ value: m, label: t(tk('assets_method_', m)) }))} /></Field>
        <Field label={p('Серийный номер', 'Seriya raqami', 'Serial number')}><Input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label={p('Модель', 'Model', 'Model')}><Input value={model} onChange={(e) => setModel(e.target.value)} /></Field>
        <Field label={p('Гарантия до', 'Kafolat muddati', 'Warranty until')}><Input type="date" value={warranty} onChange={(e) => setWarranty(e.target.value)} /></Field>
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}
