// ОС: мониторинг (сверка с iABS, незавершённые операции, проводки, контроль приложенных документов),
// отчёты (постановка на учёт, наличие и движение по группам, списание, инвентаризация), настройки
// (группы со счетами, правила капитализации 16505/19907, налоговые объекты и декларация, кадровая проверка).
import { useState } from 'react';
import { assetsApi, ASSET_TAX_RATES, canAccountAssets, filesApi, formatDate, formatDateTime, formatMoney, formatMoneyShort, today, tk, type AssetCapRule } from '@xb/shared';
import { Badge, BarChart, Button, Card, Checkbox, DataTable, Field, FilterBar, Input, Modal, Select, Stat, StatusBadge, Tabs, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Link } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { PostingsTable, ReconTable, UserSelect, useOrg, useP, useWmsError } from '../warehouse/wmsShared';
import { OP_TONE } from './asOps';

export function MonitoringTab() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useWmsError('assets_err_');
  const recon = useApi(() => assetsApi.reconciliation());
  const runs = useApi(() => assetsApi.listMonitoringRuns());
  const ops = useApi(() => assetsApi.listOperations());
  const acts = useApi(() => assetsApi.listWriteoffs());
  const unfinished = (ops.data ?? []).filter((o) => ['pending', 'awaiting_acceptance', 'returned'].includes(o.status));
  const openActs = (acts.data ?? []).filter((w) => ['draft', 'commission', 'pending', 'returned'].includes(w.status));
  const completed = (ops.data ?? []).filter((o) => o.status === 'completed' && o.type !== 'repair').slice(0, 30);
  const last = runs.data?.[0];
  return (
    <div className="wms-pad">
      <div className="grid grid-4">
        <Stat label={p('Расхождения с iABS', 'iABS bilan farqlar', 'iABS discrepancies')} value={recon.data?.filter((r) => r.diff).length ?? '—'} tone={recon.data?.some((r) => r.diff) ? 'alert' : undefined} />
        <Stat label={p('Незавершённые операции', 'Tugallanmagan operatsiyalar', 'Unfinished operations')} value={unfinished.length + openActs.length} />
        <Stat label={p('Последняя проверка', 'Oxirgi tekshiruv', 'Last check')} value={last ? formatDateTime(last.at) : '—'} foot={last ? (last.auto ? p('ежедневно, автоматически', 'har kuni, avtomatik', 'daily, automatic') : lk.user(last.by)?.fullName) : undefined} />
        <Stat label={p('Полностью изношены', 'To‘liq eskirgan', 'Fully depreciated')} value={last?.fullyDepreciated ?? '—'} />
      </div>
      <Card title={p('Ежедневная сверка остатков ОС с iABS', 'AV qoldiqlarini iABS bilan kundalik solishtirish', 'Daily PP&E vs iABS reconciliation')} actions={canAccountAssets(user) ? <Button type="primary" icon="refresh" onClick={() => assetsApi.runMonitoring(user).then((r) => toast(`${p('Проверка выполнена', 'Tekshiruv bajarildi', 'Check completed')}: ${r.discrepancies}`)).catch((e) => toast(err(e)))}>{p('Запустить проверку', 'Tekshiruvni boshlash', 'Run check')}</Button> : undefined}>
        <ReconTable rows={recon.data} loading={recon.loading} />
      </Card>
      <Card title={p('Незавершённые операции (последующие операции по объектам заблокированы)', 'Tugallanmagan operatsiyalar (obyektlar bo‘yicha keyingi operatsiyalar bloklangan)', 'Unfinished operations (further operations are blocked)')} flush>
        <DataTable rows={[...unfinished.map((o) => ({ id: o.id, no: o.orderNo ?? o.number, kind: t(tk('assets_op_', o.type)), status: t(tk('assets_opst_', o.status)), since: o.createdAt, link: `/assets/operations/${o.id}` })), ...openActs.map((w) => ({ id: w.id, no: w.number, kind: p('Акт ОС-4', 'OS-4 dalolatnomasi', 'OS-4 act'), status: t(tk('assets_wost_', w.status)), since: w.createdAt, link: `/assets/writeoffs/${w.id}` }))]} rowKey={(r) => r.id} emptyText={p('Нет', 'Yo‘q', 'None')} columns={[
          { header: t('number'), render: (r) => <Link to={r.link} className="doc-num">{r.no}</Link> },
          { header: p('Операция', 'Operatsiya', 'Operation'), render: (r) => r.kind },
          { header: t('status'), render: (r) => r.status },
          { header: p('С', 'Dan', 'Since'), render: (r) => formatDateTime(r.since) },
        ]} />
      </Card>
      <Card title={p('Контроль операций и приложенных документов', 'Operatsiyalar va ilova qilingan hujjatlar nazorati', 'Operations and attached documents control')} flush>
        <DataTable rows={completed} rowKey={(o) => o.id} columns={[
          { header: t('number'), render: (o) => <Link to={`/assets/operations/${o.id}`} className="doc-num">{o.orderNo ?? o.number}</Link> },
          { header: p('Операция', 'Operatsiya', 'Operation'), render: (o) => t(tk('assets_op_', o.type)) },
          { header: t('date'), render: (o) => formatDate(o.date) },
          { header: p('Проводка', 'Provodka', 'Posting'), render: (o) => (o.postingId ? <Badge tone="ok">✓</Badge> : <Badge tone="muted">—</Badge>) },
          { header: p('Документы', 'Hujjatlar', 'Documents'), render: (o) => { const n = filesApi.count('asset_operation', o.id); return n ? <Badge tone="ok">{n}</Badge> : <Badge tone="warn">{p('нет', 'yo‘q', 'none')}</Badge>; } },
          { header: t('status'), render: (o) => <StatusBadge prefix="assets_opst_" status={o.status} tone={OP_TONE[o.status]} /> },
        ]} />
      </Card>
      <PostingsTable module="assets" title={p('Проводки по операциям ОС (iABS)', 'AV operatsiyalari bo‘yicha provodkalar (iABS)', 'Asset postings (iABS)')} />
    </div>
  );
}

type Rep = 'registration' | 'movement' | 'writeoff' | 'inventory';

export function ReportsTab() {
  const { t, loc, lang } = useSession();
  const p = useP();
  const org = useOrg();
  const [rep, setRep] = useState<Rep>('movement');
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year' | 'custom'>('custom');
  const assets = useApi(() => assetsApi.list({ includeDisposed: true }));
  const groups = useApi(() => assetsApi.listGroups());
  const move = useApi(() => assetsApi.movementReport(from, to), [from, to]);
  const acts = useApi(() => assetsApi.listWriteoffs({ status: 'completed' }));
  const invs = useApi(() => assetsApi.listInventories());
  const setPreset = (k: 'month' | 'quarter' | 'year' | 'custom') => {
    setPeriod(k);
    const d = today();
    if (k === 'month') { setFrom(`${d.slice(0, 7)}-01`); setTo(d); }
    if (k === 'quarter') { const m = Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1; setFrom(`${d.slice(0, 4)}-${String(m).padStart(2, '0')}-01`); setTo(d); }
    if (k === 'year') { setFrom(`${d.slice(0, 4)}-01-01`); setTo(d); }
  };
  const reg = (assets.data ?? []).filter((a) => a.acquiredAt >= from && a.acquiredAt <= to);
  const regByGroup = (groups.data ?? []).map((g) => ({ g, count: reg.filter((a) => a.groupId === g.id).length, cost: reg.filter((a) => a.groupId === g.id).reduce((s, a) => s + a.cost, 0) })).filter((r) => r.count);
  const disposed = (assets.data ?? []).filter((a) => a.disposedAt && a.disposedAt >= from && a.disposedAt <= to);
  const titles: Record<Rep, string> = {
    registration: p('Постановка на учёт', 'Hisobga olish', 'Registrations'),
    movement: p('Наличие и движение ОС (форма для ЦБ/статистики)', 'AV mavjudligi va harakati (MB/statistika shakli)', 'PP&E balance and movement (CB/statistics form)'),
    writeoff: p('Списание и выбытие ОС', 'AV hisobdan chiqarish va chiqib ketish', 'Disposals'),
    inventory: p('Инвентаризация ОС', 'AV inventarizatsiyasi', 'Stocktaking'),
  };
  return (
    <div>
      <Tabs<Rep> value={rep} onChange={setRep} items={(Object.keys(titles) as Rep[]).map((k) => ({ value: k, label: titles[k].split('(')[0]!.trim() }))} />
      <FilterBar>
        <Field label={p('Период', 'Davr', 'Period')}><Select<'month' | 'quarter' | 'year' | 'custom'> value={period} onChange={setPreset} options={[{ value: 'month', label: p('Месяц', 'Oy', 'Month') }, { value: 'quarter', label: p('Квартал', 'Chorak', 'Quarter') }, { value: 'year', label: p('Год', 'Yil', 'Year') }, { value: 'custom', label: p('Произвольный', 'Ixtiyoriy', 'Custom') }]} /></Field>
        <Field label={p('С', 'Dan', 'From')}><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPeriod('custom'); }} /></Field>
        <Field label={p('По', 'Gacha', 'To')}><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPeriod('custom'); }} /></Field>
      </FilterBar>
      <div className="wms-pad">
        {rep === 'registration' && (
          <Card title={titles.registration} actions={<ExportButton filename={titles.registration} rows={reg} columns={[{ header: t('assets_invNo'), value: (a) => a.inventoryNo }, { header: t('assets_name'), value: (a) => a.name }, { header: p('Группа', 'Guruh', 'Group'), value: (a) => groups.data?.find((g) => g.id === a.groupId)?.code ?? '' }, { header: p('Источник', 'Manba', 'Source'), value: (a) => t(tk('assets_src_', a.source)) }, { header: t('assets_acquired'), value: (a) => a.acquiredAt }, { header: p('Подразделение', 'Bo‘linma', 'Unit'), value: (a) => org.unitName(a.orgUnitKey) }, { header: t('assets_cost'), value: (a) => a.cost, format: 'money', total: true }]} />}>
            <BarChart data={regByGroup.map((r) => ({ label: r.g.code, values: [r.cost] }))} series={[{ name: t('assets_cost') }]} format={(n) => formatMoneyShort(n, lang)} />
            <DataTable rows={regByGroup} rowKey={(r) => r.g.id} columns={[{ header: p('Группа', 'Guruh', 'Group'), render: (r) => `${r.g.code} · ${loc(r.g.name)}` }, { header: p('Объектов', 'Obyektlar', 'Assets'), align: 'right', render: (r) => r.count }, { header: t('assets_cost'), align: 'right', render: (r) => formatMoney(r.cost) }]} />
          </Card>
        )}
        {rep === 'movement' && (
          <Card title={titles.movement} actions={<span className="wms-row"><ExportButton filename={p('Наличие и движение ОС', 'AV mavjudligi va harakati', 'PP&E movement')} rows={move.data ?? []} columns={[{ header: p('Группа', 'Guruh', 'Group'), value: (r) => `${r.group.code} ${loc(r.group.name)}` }, { header: p('Счёт', 'Hisob', 'Account'), value: (r) => r.group.account }, { header: p('На начало', 'Boshiga', 'Opening'), value: (r) => r.opening, format: 'money', total: true }, { header: p('Поступило', 'Kirim', 'Additions'), value: (r) => r.added, format: 'money', total: true }, { header: p('Выбыло', 'Chiqim', 'Disposals'), value: (r) => r.disposed, format: 'money', total: true }, { header: p('На конец', 'Oxiriga', 'Closing'), value: (r) => r.closing, format: 'money', total: true }, { header: p('Амортизация за период', 'Davr amortizatsiyasi', 'Depreciation'), value: (r) => r.depreciation, format: 'money', total: true }, { header: t('assets_nbv'), value: (r) => r.nbv, format: 'money', total: true }]} /><PrintButton template="registry" doc={() => ({ entity: 'asset_report', entityId: `movement-${from}-${to}`, title: titles.movement, date: today(), fields: [{ label: p('Период', 'Davr', 'Period'), value: `${from} — ${to}` }], table: { columns: [{ header: p('Группа', 'Guruh', 'Group') }, { header: p('Счёт', 'Hisob', 'Account') }, { header: p('На начало', 'Boshiga', 'Opening'), align: 'right' }, { header: p('Поступило', 'Kirim', 'Additions'), align: 'right' }, { header: p('Выбыло', 'Chiqim', 'Disposals'), align: 'right' }, { header: p('На конец', 'Oxiriga', 'Closing'), align: 'right' }, { header: p('Амортизация', 'Amortizatsiya', 'Depreciation'), align: 'right' }], rows: (move.data ?? []).map((r) => [`${r.group.code} ${loc(r.group.name)}`, r.group.account, formatMoney(r.opening), formatMoney(r.added), formatMoney(r.disposed), formatMoney(r.closing), formatMoney(r.depreciation)]) } })} /></span>} flush>
            <DataTable rows={move.data} loading={move.loading} rowKey={(r) => r.group.id} columns={[
              { header: p('Группа', 'Guruh', 'Group'), render: (r) => (<>{r.group.code} · {loc(r.group.name)}<div className="sub wms-mono">{r.group.account}</div></>) },
              { header: p('На начало', 'Boshiga', 'Opening'), align: 'right', render: (r) => formatMoneyShort(r.opening, lang) },
              { header: p('Поступило', 'Kirim', 'Additions'), align: 'right', render: (r) => formatMoneyShort(r.added, lang) },
              { header: p('Выбыло', 'Chiqim', 'Disposals'), align: 'right', render: (r) => formatMoneyShort(r.disposed, lang) },
              { header: p('На конец', 'Oxiriga', 'Closing'), align: 'right', render: (r) => formatMoneyShort(r.closing, lang) },
              { header: p('Амортизация', 'Amortizatsiya', 'Depreciation'), align: 'right', render: (r) => formatMoneyShort(r.depreciation, lang) },
              { header: t('assets_nbv'), align: 'right', render: (r) => formatMoneyShort(r.nbv, lang) },
            ]} />
          </Card>
        )}
        {rep === 'writeoff' && (
          <Card title={titles.writeoff} actions={<ExportButton filename={titles.writeoff} rows={disposed} columns={[{ header: t('assets_invNo'), value: (a) => a.inventoryNo }, { header: t('assets_name'), value: (a) => a.name }, { header: p('Дата выбытия', 'Chiqib ketish sanasi', 'Disposal date'), value: (a) => a.disposedAt ?? '' }, { header: t('status'), value: (a) => t(tk('assets_status_', a.status)) }, { header: p('МВЗ', 'XMM', 'CC'), value: (a) => org.ccCode(a.costCenterId) }, { header: t('assets_cost'), value: (a) => a.cost, format: 'money', total: true }, { header: t('assets_accumulated'), value: (a) => a.accumulated, format: 'money', total: true }]} />} flush>
            <DataTable rows={disposed} rowKey={(a) => a.id} emptyText={p('Выбытий за период нет', 'Davrda chiqib ketish yo‘q', 'No disposals in period')} columns={[
              { header: t('assets_invNo'), render: (a) => <Link to={`/assets/${a.id}`} className="doc-num">{a.inventoryNo}</Link> }, { header: t('assets_name'), render: (a) => a.name },
              { header: p('Дата выбытия', 'Chiqib ketish sanasi', 'Disposal date'), render: (a) => formatDate(a.disposedAt!) }, { header: t('status'), render: (a) => <StatusBadge prefix="assets_status_" status={a.status} /> },
              { header: p('МВЗ', 'XMM', 'CC'), render: (a) => <span className="wms-mono">{org.ccCode(a.costCenterId)}</span> }, { header: t('assets_cost'), align: 'right', render: (a) => formatMoney(a.cost) },
            ]} />
            <div className="wms-note" style={{ padding: 12 }}>{p('Актов ОС-4 за всё время', 'Jami OS-4 dalolatnomalari', 'OS-4 acts total')}: {acts.data?.length ?? 0} · {p('продажи с НДС', 'QQS bilan sotish', 'sales with VAT')}: {formatMoney((acts.data ?? []).reduce((s, w) => s + (w.vat ?? 0), 0))}</div>
          </Card>
        )}
        {rep === 'inventory' && (
          <Card title={titles.inventory} actions={<ExportButton filename={titles.inventory} rows={invs.data ?? []} columns={[{ header: t('number'), value: (v) => v.number }, { header: t('date'), value: (v) => v.date }, { header: p('Подразделение', 'Bo‘linma', 'Unit'), value: (v) => org.unitName(v.orgUnitKey) }, { header: p('Объектов', 'Obyektlar', 'Assets'), value: (v) => v.lines.filter((l) => l.assetId).length, format: 'integer' }, { header: p('Недостача', 'Kamomad', 'Shortage'), value: (v) => v.lines.filter((l) => l.assetId && !l.found).length, format: 'integer' }, { header: p('Излишки', 'Ortiqchalar', 'Surplus'), value: (v) => v.lines.filter((l) => l.surplus).length, format: 'integer' }, { header: t('status'), value: (v) => t(tk('assets_invst_', v.status)) }]} />} flush>
            <DataTable rows={invs.data} rowKey={(v) => v.id} columns={[
              { header: t('number'), render: (v) => <Link to={`/assets/inventory/${v.id}`} className="doc-num">{v.number}</Link> }, { header: t('date'), render: (v) => formatDate(v.date) }, { header: p('Подразделение', 'Bo‘linma', 'Unit'), render: (v) => org.unitName(v.orgUnitKey) },
              { header: p('Недостача / излишки', 'Kamomad / ortiqcha', 'Shortage / surplus'), align: 'right', render: (v) => `${v.lines.filter((l) => l.assetId && !l.found).length} / ${v.lines.filter((l) => l.surplus).length}` }, { header: t('status'), render: (v) => <StatusBadge prefix="assets_invst_" status={v.status} /> },
            ]} />
          </Card>
        )}
      </div>
    </div>
  );
}

export function SettingsTab() {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useWmsError('assets_err_');
  const groups = useApi(() => assetsApi.listGroups());
  const rules = useApi(() => assetsApi.listCapRules());
  const tax = useApi(() => assetsApi.taxObjects());
  const [rule, setRule] = useState<(Omit<AssetCapRule, 'id'> & { id?: string }) | null>(null);
  const [emp, setEmp] = useState('');
  const holdings = useApi(() => (emp ? assetsApi.holdings(emp) : Promise.resolve(undefined)), [emp]);
  const canAcc = canAccountAssets(user);
  return (
    <div className="wms-pad">
      <Card title={p('Группы ОС (открыты в целом по банку, с привязкой счетов)', 'AV guruhlari (bank bo‘yicha, hisoblar bilan)', 'Asset groups (bank-wide, with accounts)')} flush>
        <DataTable rows={groups.data} rowKey={(g) => g.id} columns={[
          { header: p('Код', 'Kod', 'Code'), render: (g) => <b>{g.code}</b> },
          { header: p('Группа', 'Guruh', 'Group'), render: (g) => loc(g.name) },
          { header: p('Инв. №', 'Inv. №', 'Inv. no.'), render: (g) => <span className="wms-mono">OS-{g.invPrefix}-NNNNNN</span> },
          { header: p('Счёт / износ / расход', 'Hisob / eskirish / xarajat', 'Account / dep. / expense'), render: (g) => <span className="wms-mono">{g.account} / {g.depAccount} / {g.expenseAccount}</span> },
          { header: t('assets_life'), align: 'right', render: (g) => `${g.usefulLifeMonths} ${t('assets_months')}` },
          { header: p('Метод', 'Usul', 'Method'), render: (g) => t(tk('assets_method_', g.method)) },
        ]} />
      </Card>
      <Card title={p('Правила оприходования капвложений (16505, 19907)', 'Kapital qo‘yilmalarni kirim qilish qoidalari (16505, 19907)', 'Capitalization rules (16505, 19907)')} actions={canAcc ? <Button size="small" icon="plus" onClick={() => setRule({ account: '16505000', groupId: 'ag-bld', minAmount: 0, description: '', active: true })}>{p('Правило', 'Qoida', 'Rule')}</Button> : undefined} flush>
        <DataTable rows={rules.data} rowKey={(r) => r.id} onRowClick={canAcc ? (r) => setRule(r) : undefined} columns={[
          { header: p('Счёт', 'Hisob', 'Account'), render: (r) => <span className="wms-mono">{r.account}</span> },
          { header: p('Группа ОС', 'AV guruhi', 'Asset group'), render: (r) => groups.data?.find((g) => g.id === r.groupId)?.code ?? r.groupId },
          { header: p('Порог', 'Chegara', 'Threshold'), align: 'right', render: (r) => formatMoney(r.minAmount) },
          { header: p('Описание', 'Tavsif', 'Description'), render: (r) => r.description },
          { header: t('status'), render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? p('активно', 'faol', 'active') : p('выключено', 'o‘chirilgan', 'off')}</Badge> },
        ]} />
      </Card>
      <Card title={p('Здания и земля: налог на имущество и земельный налог', 'Binolar va yer: mol-mulk va yer solig‘i', 'Buildings and land: property and land tax')} actions={canAcc ? <Button size="small" icon="upload" onClick={() => assetsApi.sendTaxDeclaration(user).then((r) => toast(`Soliq: ${r.status}`)).catch((e) => toast(err(e)))}>{p('Передать в налоговую (Soliq)', 'Soliqqa yuborish', 'Send to tax (Soliq)')}</Button> : undefined} flush>
        <DataTable rows={tax.data} rowKey={(r) => r.asset.id} columns={[
          { header: t('assets_invNo'), render: (r) => <Link to={`/assets/${r.asset.id}`} className="doc-num">{r.asset.inventoryNo}</Link> },
          { header: p('Кадастровый №', 'Kadastr №', 'Cadastral no.'), render: (r) => <span className="wms-mono">{r.asset.taxObject?.cadastralNo}</span> },
          { header: p('Среднегодовая остаточная', 'O‘rtacha yillik qoldiq', 'Avg. NBV'), align: 'right', render: (r) => formatMoney(r.avgNbv) },
          { header: `${p('Налог на имущество', 'Mol-mulk solig‘i', 'Property tax')} ${ASSET_TAX_RATES.property}%`, align: 'right', render: (r) => formatMoney(r.propertyTax) },
          { header: p('Земельный налог', 'Yer solig‘i', 'Land tax'), align: 'right', render: (r) => formatMoney(r.landTax) },
          { header: t('total'), align: 'right', render: (r) => <b>{formatMoney(r.total)}</b> },
        ]} />
      </Card>
      <Card title={p('Кадровая проверка: перевод / увольнение сотрудника', 'Kadrlar tekshiruvi: xodimni o‘tkazish / bo‘shatish', 'HR check: transfer / dismissal')}>
        <Field label={p('Сотрудник', 'Xodim', 'Employee')}><UserSelect value={emp} onChange={setEmp} /></Field>
        {holdings.data && (
          holdings.data.allowed ? <div className="wms-ok">{p('За сотрудником ценности не числятся — перевод и увольнение разрешены.', 'Xodim hisobida qimmatliklar yo‘q — o‘tkazish va bo‘shatishga ruxsat.', 'No valuables held — transfer and dismissal allowed.')}</div> : (
            <div className="wms-danger">
              <b>{p('Перевод и увольнение заблокированы', 'O‘tkazish va bo‘shatish bloklangan', 'Transfer and dismissal blocked')}</b> — {p('за сотрудником числятся', 'xodim hisobida', 'the employee holds')}: {holdings.data.assets.map((a) => <Link key={a.id} to={`/assets/${a.id}`} style={{ marginRight: 6 }}>{a.inventoryNo}</Link>)}{holdings.data.mbp.map((m) => <span key={m.id} style={{ marginRight: 6 }}>{m.number} ({m.qty})</span>)}
              <div className="wms-note">{p('Передайте ОС другому МОЛ по электронному акту (карточка ОС → «Передать»), МБП — актом списания или передачи. Проверка применяется в разделе «Пользователи» при смене подразделения и деактивации.', 'AVni boshqa MJSga elektron dalolatnoma bilan topshiring, MBP — hisobdan chiqarish yoki topshirish dalolatnomasi bilan. Tekshiruv «Foydalanuvchilar» bo‘limida qo‘llaniladi.', 'Transfer assets to another custodian by electronic act; LVI by write-off or transfer act. The check applies in Users on unit change and deactivation.')}</div>
            </div>
          )
        )}
        {emp && <div className="wms-note">{lk.user(emp)?.fullName}</div>}
      </Card>
      {rule && (
        <Modal title={p('Правило капитализации', 'Kapitallashtirish qoidasi', 'Capitalization rule')} onClose={() => setRule(null)} footer={<><Button onClick={() => setRule(null)}>{t('cancel')}</Button><Button type="primary" onClick={() => assetsApi.saveCapRule(rule, user).then(() => { setRule(null); toast(t('saved')); }).catch((e) => toast(err(e)))}>{t('save')}</Button></>}>
          <Field label={p('Счёт', 'Hisob', 'Account')} required><Select value={rule.account} onChange={(v) => setRule({ ...rule, account: v })} options={[{ value: '16505000', label: '16505000' }, { value: '19907000', label: '19907000' }]} /></Field>
          <Field label={p('Группа ОС', 'AV guruhi', 'Asset group')} required><Select value={rule.groupId} onChange={(v) => setRule({ ...rule, groupId: v })} options={(groups.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${loc(g.name)}` }))} /></Field>
          <Field label={p('Минимальная сумма', 'Minimal summa', 'Minimum amount')}><Input type="number" value={rule.minAmount} onChange={(e) => setRule({ ...rule, minAmount: Number(e.target.value) })} /></Field>
          <Field label={p('Описание', 'Tavsif', 'Description')} required><Input value={rule.description} onChange={(e) => setRule({ ...rule, description: e.target.value })} /></Field>
          <Checkbox checked={rule.active} onChange={(v) => setRule({ ...rule, active: v })}>{p('Активно', 'Faol', 'Active')}</Checkbox>
        </Modal>
      )}
    </div>
  );
}

