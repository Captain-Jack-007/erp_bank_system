// НДО: бюджет и план-факт с факторами, остатки и деньги в пути, стоимость фондирования и сценарии, аллокация.
import { useState } from 'react';
import { formatDecimal, formatMoney, formatMoneyShort, formatNumber, ndoApi, type NdoObjectType, type NdoRuleStep, type NdoScenarioKind, type NdoVolume } from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Field, Input, LineChart, Modal, RouteSteps, Select, Stat } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useP } from '../taxes/common';
import { useNdoObjects, useNdoRun } from './NdoPage';
import { Bar, NDO_TYPES, useNdoLabels, useTypeLabel } from './NdoTabsA';
import { money } from './shared';

const bn = (v: number) => Math.round(v / 1e8) / 10;

export function BudgetTab({ period }: { period: string }) {
  const p = useP();
  const { lang } = useSession();
  const user = useUser();
  const objs = useNdoObjects();
  const lbl = useNdoLabels();
  const [scenario, setScenario] = useState<NdoScenarioKind>('base');
  const [by, setBy] = useState<'article' | 'costCenterCode' | 'process' | 'objectKey'>('article');
  const lines = useApi(() => ndoApi.listBudget(period, scenario), [period, scenario]);
  const cons = useApi(() => ndoApi.budgetConsolidated(period, scenario, by), [period, scenario, by]);
  const rf = useApi(() => ndoApi.rollingForecast(scenario), [scenario]);
  const fa = useApi(() => ndoApi.factors(period, scenario), [period, scenario]);
  const { run } = useNdoRun();
  const [edit, setEdit] = useState<{ id: string; vol: string; rate: string; amount: string; just: string; driver: boolean } | null>(null);
  const SC = { base: p('базовый', 'asosiy', 'base'), optimistic: p('оптимистичный', 'optimistik', 'optimistic'), stress: p('стресс', 'stress', 'stress') };
  const canCalc = ndoApi.can(user, 'calc');
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Select<NdoScenarioKind> value={scenario} onChange={setScenario} options={(Object.keys(SC) as NdoScenarioKind[]).map((k) => ({ value: k, label: `${p('Сценарий', 'Ssenariy', 'Scenario')}: ${SC[k]}` }))} ariaLabel={p('Сценарий', 'Ssenariy', 'Scenario')} />
        <span className="muted small">{p('Бюджет в разрезе периодов, статей, объектов, МВЗ, процессов и валют; методы ZBB и драйверный (объём × ставка); консолидация до уровня Банка.', "Byudjet davrlar, moddalar, obyektlar, XJM, jarayonlar va valyutalar kesimida; ZBB va drayver usullari; Bank darajasigacha konsolidatsiya.", 'Budget by period, article, object, cost centre, process and currency; ZBB and driver methods; consolidated to bank level.')}</span>
      </div>
      <Card title={p('Скользящий прогноз (факт закрытых месяцев + план оставшихся), млрд', "Sirpanuvchi prognoz (yopilgan oylar fakti + qolgan oylar rejasi), mlrd", 'Rolling forecast (actuals + remaining plan), bn')}>
        {rf.data && <LineChart labels={rf.data.map((x) => x.period.slice(5))} series={[{ name: p('План затрат', 'Xarajatlar rejasi', 'Planned cost'), values: rf.data.map((x) => bn(x.planCost)) }, { name: p('Прогноз/факт затрат', 'Xarajatlar prognozi/fakti', 'Forecast/actual cost'), values: rf.data.map((x) => bn(x.forecastCost)) }, { name: p('План доходов', 'Daromadlar rejasi', 'Planned income'), values: rf.data.map((x) => bn(x.planIncome)) }, { name: p('Прогноз/факт доходов', 'Daromad prognozi/fakti', 'Forecast/actual income'), values: rf.data.map((x) => bn(x.forecastIncome)) }]} format={(n) => formatDecimal(n)} />}
      </Card>
      <Card title={`${p('План-факт с факторным анализом', 'Omilli tahlil bilan reja-fakt', 'Plan vs actual with factor analysis')} · ${period}`} flush actions={<ExportButton filename={`ndo-plan-fact-${period}-${scenario}`} rows={fa.data ?? []} columns={[{ header: p('Статья', 'Modda', 'Article'), value: (r) => r.article }, { header: p('План', 'Reja', 'Plan'), value: (r) => r.plan, format: 'money', total: true }, { header: p('Факт', 'Fakt', 'Actual'), value: (r) => r.actual, format: 'money', total: true }, { header: p('Отклонение', "Og'ish", 'Variance'), value: (r) => r.variance, format: 'money', total: true }, { header: p('Объём', 'Hajm', 'Volume'), value: (r) => r.volume, format: 'money' }, { header: p('Цена', 'Narx', 'Price'), value: (r) => r.price, format: 'money' }, { header: p('Структура', 'Tuzilma', 'Structure'), value: (r) => r.structure, format: 'money' }, { header: p('Курс', 'Kurs', 'FX'), value: (r) => r.fx, format: 'money' }, { header: 'FTP', value: (r) => r.ftp, format: 'money' }, { header: p('Аллокация', 'Taqsimot', 'Allocation'), value: (r) => r.allocation, format: 'money' }]} />}>
        <DataTable rows={fa.data} loading={fa.loading} rowKey={(r) => r.article} columns={[
          { header: p('Статья', 'Modda', 'Article'), render: (r) => <span className="doc-num">{r.article}</span> },
          { header: p('План', 'Reja', 'Plan'), align: 'right', render: (r) => formatMoneyShort(r.plan, lang) },
          { header: p('Факт', 'Fakt', 'Actual'), align: 'right', render: (r) => formatMoneyShort(r.actual, lang) },
          { header: p('Отклонение', "Og'ish", 'Variance'), align: 'right', render: (r) => <b>{formatMoneyShort(r.variance, lang)}</b> },
          { header: p('Объём', 'Hajm', 'Volume'), align: 'right', render: (r) => (r.volume ? formatMoneyShort(r.volume, lang) : '—') },
          { header: p('Цена', 'Narx', 'Price'), align: 'right', render: (r) => (r.price ? formatMoneyShort(r.price, lang) : '—') },
          { header: p('Структура', 'Tuzilma', 'Structure'), align: 'right', render: (r) => (r.structure ? formatMoneyShort(r.structure, lang) : '—') },
          { header: p('Курс', 'Kurs', 'FX'), align: 'right', render: (r) => (r.fx ? formatMoneyShort(r.fx, lang) : '—') },
          { header: 'FTP', align: 'right', render: (r) => (r.ftp ? formatMoneyShort(r.ftp, lang) : '—') },
          { header: p('Аллокация', 'Taqsimot', 'Allocation'), align: 'right', render: (r) => (r.allocation ? formatMoneyShort(r.allocation, lang) : '—') },
        ]} />
      </Card>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title={p('Консолидация бюджета до уровня Банка', 'Byudjetni Bank darajasigacha konsolidatsiyalash', 'Budget consolidated to bank level')} flush actions={<Select<typeof by> value={by} onChange={setBy} options={[{ value: 'article', label: p('по статьям', "moddalar bo'yicha", 'by article') }, { value: 'costCenterCode', label: p('по МВЗ', "XJM bo'yicha", 'by cost centre') }, { value: 'process', label: p('по процессам', "jarayonlar bo'yicha", 'by process') }, { value: 'objectKey', label: p('по объектам', "obyektlar bo'yicha", 'by object') }]} ariaLabel={p('Разрез', 'Kesim', 'Breakdown')} />}>
          <DataTable rows={cons.data} rowKey={(r) => r.key} columns={[{ header: p('Разрез', 'Kesim', 'Key'), render: (r) => (by === 'objectKey' ? objs.name(r.key) : by === 'process' ? lbl(r.key) : r.key) }, { header: p('Нетто-расход (расход − доход)', 'Netto xarajat', 'Net cost (cost − income)'), align: 'right', render: (r) => formatMoney(r.amount) }]} />
        </Card>
        <Card title={`${p('Строки бюджета', 'Byudjet satrlari', 'Budget lines')} · ${period}`} flush>
          <DataTable rows={(lines.data ?? []).slice(0, 60)} loading={lines.loading} rowKey={(b) => b.id} columns={[
            { header: p('Статья / объект', 'Modda / obyekt', 'Article / object'), render: (b) => <><span className="doc-num">{b.article}</span><div className="sub">{objs.name(b.objectKey)} · {b.costCenterCode} · {lbl(b.process)} · {b.currency}</div></> },
            { header: p('Метод', 'Usul', 'Method'),  render: (b) => (b.method === 'driver' ? <span className="small">{lbl(b.driver)}: {formatNumber(b.driverVolume ?? 0)} × {formatDecimal(b.rate ?? 0, 2)}</span> : <Badge tone="info">ZBB</Badge>) },
            { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (b) => formatMoney(b.amount) },
            { header: '', render: (b) => (canCalc && scenario === 'base' ? <Button size="small" onClick={() => setEdit({ id: b.id, vol: String(b.driverVolume ?? ''), rate: String(b.rate ?? ''), amount: String(b.amount), just: b.justification ?? '', driver: b.method === 'driver' })}>✎</Button> : null) },
          ]} />
        </Card>
      </div>
      {edit && (
        <Modal title={p('Строка бюджета', 'Byudjet satri', 'Budget line')} onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => ndoApi.updateBudgetLine(edit.id, edit.driver ? { driverVolume: Number(edit.vol), rate: Number(edit.rate.replace(',', '.')), justification: edit.just } : { amount: Number(edit.amount.replace(/\s/g, '')), justification: edit.just }, user), p('Бюджет обновлён', 'Byudjet yangilandi', 'Budget updated'))) setEdit(null); }}>{p('Сохранить', 'Saqlash', 'Save')}</Button></>}>
          {edit.driver ? (
            <div className="form-grid">
              <Field label={p('Объём драйвера', 'Drayver hajmi', 'Driver volume')}><Input value={edit.vol} inputMode="numeric" onChange={(e) => setEdit({ ...edit, vol: e.target.value })} /></Field>
              <Field label={p('Ставка за единицу', 'Birlik stavkasi', 'Rate per unit')}><Input value={edit.rate} inputMode="decimal" onChange={(e) => setEdit({ ...edit, rate: e.target.value })} /></Field>
            </div>
          ) : (
            <Field label={p('Сумма (ZBB)', 'Summa (ZBB)', 'Amount (ZBB)')}><Input value={edit.amount} inputMode="numeric" onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></Field>
          )}
          <Field label={p('Обоснование', 'Asoslash', 'Justification')}><Input value={edit.just} onChange={(e) => setEdit({ ...edit, just: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function BalancesTab({ period }: { period: string }) {
  const p = useP();
  const { lang } = useSession();
  const user = useUser();
  const objs = useNdoObjects();
  const lbl = useNdoLabels();
  const dates = useApi(() => ndoApi.balanceDates(period), [period]);
  const [date, setDate] = useState('');
  const d = date || dates.data?.at(-1) || '';
  const bal = useApi(() => (d ? ndoApi.balancesOn(d) : Promise.resolve([])), [d]);
  const transit = useApi(() => ndoApi.transit());
  const funding = useApi(() => ndoApi.funding(period), [period]);
  const ftp = useApi(() => ndoApi.ftpRates(period), [period]);
  const scns = useApi(() => ndoApi.listScenarios());
  const [scn, setScn] = useState({ name: '', balancePct: '-15', storageDays: '2', fxPct: '5', ftpBp: '100' });
  const sim = useApi(() => ndoApi.scenarioFunding(period, { balancePct: Number(scn.balancePct), storageDays: Number(scn.storageDays), fxPct: Number(scn.fxPct), ftpBp: Number(scn.ftpBp) }), [period, scn.balancePct, scn.storageDays, scn.fxPct, scn.ftpBp]);
  const { run } = useNdoRun();
  const f = funding.data ?? [];
  const sum = (k: 'cost' | 'costNormative' | 'costNecessary' | 'costExcess' | 'avgUzs') => f.reduce((s, x) => s + x[k], 0);
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      <div className="grid grid-4">
        <Stat label={p('Стоимость фондирования', 'Fondlash qiymati', 'Funding cost')} value={formatMoneyShort(sum('cost'), lang)} icon="percent" tone="accent" foot={`${p('ср. остаток', "o'rt. qoldiq", 'avg balance')} ${formatMoneyShort(sum('avgUzs'), lang)}`} />
        <Stat label={p('Нормативные остатки', "Me'yoriy qoldiqlar", 'Normative balances')} value={formatMoneyShort(sum('costNormative'), lang)} icon="check" />
        <Stat label={p('Необходимые остатки', 'Zarur qoldiqlar', 'Necessary balances')} value={formatMoneyShort(sum('costNecessary'), lang)} icon="clock" />
        <Stat label={p('Избыточные остатки', 'Ortiqcha qoldiqlar', 'Excess balances')} value={formatMoneyShort(sum('costExcess'), lang)} icon="alert" tone={sum('costExcess') > sum('cost') * 0.3 ? 'alert' : undefined} />
      </div>
      <Card title={`${p('Ставки FTP (модуль 4.2.15) за', 'FTP stavkalari (4.2.15 moduli)', 'FTP rates (module 4.2.15) for')} ${period}`}>
        <div className="small">{ftp.data ? Object.entries(ftp.data).map(([c, r]) => `${c}: ${formatDecimal(r, 2)}%`).join(' · ') : '—'} · {p('срок хранения', 'saqlash muddati', 'storage tenor')} ≥ 1M; EUR = USD + 0,5 п.п., RUB = USD + 3 п.п.</div>
      </Card>
      <Card title={p('Стоимость фондирования по объектам и валютам', "Obyektlar va valyutalar bo'yicha fondlash qiymati", 'Funding cost by object and currency')} flush actions={<ExportButton filename={`ndo-funding-${period}`} rows={f} columns={[{ header: p('Объект', 'Obyekt', 'Object'), value: (x) => objs.name(x.objectKey) }, { header: p('Валюта', 'Valyuta', 'Currency'), value: (x) => x.currency }, { header: p('Ср. остаток', "O'rt. qoldiq", 'Avg balance'), value: (x) => x.avgBalance, format: 'number' }, { header: 'UZS', value: (x) => x.avgUzs, format: 'money', total: true }, { header: 'FTP %', value: (x) => x.ftpRate, format: 'number' }, { header: p('Курс', 'Kurs', 'FX'), value: (x) => x.fxRate, format: 'number' }, { header: p('Дней', 'Kun', 'Days'), value: (x) => x.days, format: 'integer' }, { header: p('Стоимость', 'Qiymat', 'Cost'), value: (x) => x.cost, format: 'money', total: true }, { header: p('Норматив.', "Me'yoriy", 'Normative'), value: (x) => x.costNormative, format: 'money', total: true }, { header: p('Необход.', 'Zarur', 'Necessary'), value: (x) => x.costNecessary, format: 'money', total: true }, { header: p('Избыточ.', 'Ortiqcha', 'Excess'), value: (x) => x.costExcess, format: 'money', total: true }]} />}>
        <DataTable rows={f} loading={funding.loading} rowKey={(x) => `${x.objectKey}-${x.currency}-${x.days}`} columns={[
          { header: p('Объект', 'Obyekt', 'Object'), render: (x) => objs.name(x.objectKey) },
          { header: p('Валюта', 'Valyuta', 'Currency'), render: (x) => x.currency },
          { header: p('Ср. остаток', "O'rt. qoldiq", 'Avg balance'), align: 'right', render: (x) => money(x.avgBalance, x.currency) },
          { header: 'FTP / ' + p('курс', 'kurs', 'FX'), align: 'right', render: (x) => `${formatDecimal(x.ftpRate, 2)}% / ${formatNumber(x.fxRate)}` },
          { header: p('Норм. / необх. / избыт.', "Me'y. / zarur / ortiq.", 'Norm. / nec. / excess'), align: 'right', render: (x) => <span className="small">{formatMoneyShort(x.costNormative, lang)} / {formatMoneyShort(x.costNecessary, lang)} / <b style={{ color: x.costExcess ? 'var(--danger)' : undefined }}>{formatMoneyShort(x.costExcess, lang)}</b></span> },
          { header: p('Стоимость', 'Qiymat', 'Cost'), align: 'right', render: (x) => formatMoney(x.cost) },
        ]} />
      </Card>
      <Card title={p('Сценарная оценка (факт и закрытые периоды не изменяются)', "Ssenariy bahosi (fakt va yopilgan davrlar o'zgarmaydi)", 'Scenario assessment (actuals and closed periods unchanged)')}>
        <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <Field label={p('Остатки, %', 'Qoldiqlar, %', 'Balances, %')}><Input value={scn.balancePct} onChange={(e) => setScn({ ...scn, balancePct: e.target.value })} style={{ width: 80 }} /></Field>
          <Field label={p('Срок хранения, +дн.', 'Saqlash muddati, +kun', 'Storage, +days')}><Input value={scn.storageDays} onChange={(e) => setScn({ ...scn, storageDays: e.target.value })} style={{ width: 80 }} /></Field>
          <Field label={p('Курс валют, %', 'Valyuta kursi, %', 'FX, %')}><Input value={scn.fxPct} onChange={(e) => setScn({ ...scn, fxPct: e.target.value })} style={{ width: 80 }} /></Field>
          <Field label={p('FTP, б.п.', 'FTP, b.p.', 'FTP, bp')}><Input value={scn.ftpBp} onChange={(e) => setScn({ ...scn, ftpBp: e.target.value })} style={{ width: 80 }} /></Field>
          {ndoApi.can(user, 'calc') && <Field label={p('Название', 'Nomi', 'Name')}><span style={{ display: 'flex', gap: 6 }}><Input value={scn.name} onChange={(e) => setScn({ ...scn, name: e.target.value })} style={{ width: 160 }} /><Button size="small" onClick={() => run(() => ndoApi.addScenario({ name: scn.name, balancePct: Number(scn.balancePct), storageDays: Number(scn.storageDays), fxPct: Number(scn.fxPct), ftpBp: Number(scn.ftpBp) }, user), p('Сценарий сохранён', 'Ssenariy saqlandi', 'Scenario saved'))}>{p('Сохранить', 'Saqlash', 'Save')}</Button></span></Field>}
        </div>
        {sim.data && (
          <BarChart data={[{ label: p('Стоимость', 'Qiymat', 'Cost'), values: [bn(sim.data.base.cost), bn(sim.data.scenario.cost)] }, { label: p('Избыточные', 'Ortiqcha', 'Excess'), values: [bn(sim.data.base.excess), bn(sim.data.scenario.excess)] }]} series={[{ name: p('Факт, млрд', 'Fakt, mlrd', 'Actual, bn') }, { name: p('Сценарий, млрд', 'Ssenariy, mlrd', 'Scenario, bn') }]} format={(n) => formatDecimal(n)} height={160} />
        )}
        {!!scns.data?.length && <div className="small muted" style={{ marginTop: 6 }}>{p('Сохранённые сценарии', 'Saqlangan ssenariylar', 'Saved scenarios')}: {scns.data.map((s) => <Button key={s.id} size="small" type="link" onClick={() => setScn({ name: s.name, balancePct: String(s.balancePct), storageDays: String(s.storageDays), fxPct: String(s.fxPct), ftpBp: String(s.ftpBp) })}>{s.name}</Button>)}</div>}
      </Card>
      <Card title={p('Деньги в пути: единственный учётный владелец (маршрут инкассации)', "Yo'ldagi pul: yagona hisob egasi (inkassatsiya yo'nalishi)", 'Cash in transit: single accounting owner (CIT route)')} flush>
        <DataTable rows={transit.data} emptyText={p('Нет денег в пути', "Yo'lda pul yo'q", 'No cash in transit')} rowKey={(t) => t.orderId} columns={[
          { header: p('Заявка', 'Ariza', 'Order'), render: (t) => <span className="doc-num">{t.number}</span> },
          { header: p('Владелец (в пути)', 'Egasi (yo‘lda)', 'Owner (in transit)'), render: (t) => <b>{objs.name(t.ownerKey)}</b> },
          { header: p('Откуда → куда', 'Qayerdan → qayerga', 'From → to'), render: (t) => <span className="small">{objs.name(t.fromKey)} → {objs.name(t.toKey)}</span> },
          { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (t) => money(t.amount, t.currency) },
        ]} />
        <div className="muted small" style={{ padding: '8px 14px' }}>{p('При отправке сумма списывается у отправителя и до доставки отражается только у маршрута; у получателя — после подтверждения доставки.', "Yuborishda summa yuboruvchidan hisobdan chiqariladi va yetkazilgunga qadar faqat yo'nalishda aks etadi; oluvchida — yetkazib berish tasdiqlangandan keyin.", 'On dispatch the amount leaves the sender and until delivery is shown only on the route; the receiver gets it after delivery is confirmed.')}</div>
      </Card>
      <Card title={`${p('Ежедневный регистр остатков', 'Kunlik qoldiqlar reyestri', 'Daily balance register')}`} flush actions={<Select<string> value={d} onChange={setDate} options={(dates.data ?? []).map((x) => ({ value: x, label: x }))} ariaLabel={p('Дата', 'Sana', 'Date')} />}>
        <DataTable rows={bal.data} loading={bal.loading} rowKey={(b) => `${b.objectKey}-${b.currency}`} columns={[
          { header: p('Объект', 'Obyekt', 'Object'), render: (b) => objs.name(b.objectKey) },
          { header: p('Валюта', 'Valyuta', 'Currency'), render: (b) => b.currency },
          { header: p('Состояние', 'Holat', 'State'), render: (b) => lbl(b.state) },
          { header: p('Остаток', 'Qoldiq', 'Balance'), align: 'right', render: (b) => money(b.amount, b.currency) },
          { header: p('Номиналы / ветхие', 'Nominallar / eskirgan', 'Denominations / unfit'), render: (b) => (b.denominations ? <span className="small">{Object.entries(b.denominations).map(([n, v]) => `${formatNumber(Number(n))}: ${formatMoneyShort(v, lang)}`).join('; ')} · {b.unfit}%</span> : '—') },
        ]} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function AllocTab({ period }: { period: string }) {
  const p = useP();
  const { loc, lang } = useSession();
  const user = useUser();
  const objs = useNdoObjects();
  const typeLabel = useTypeLabel();
  const lbl = useNdoLabels();
  const rules = useApi(() => ndoApi.listRules());
  const res = useApi(() => ndoApi.allocation(period), [period]);
  const { busy, run } = useNdoRun();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ code: 'R-CIT', nameRu: '', step: 'ndo_internal' as NdoRuleStep, pool: 'POOL-CIT', driver: 'collections' as NdoVolume['driver'], types: ['cbu', 'cash_desk', 'atm', 'cash_in', 'recycler', 'exchange'] as NdoObjectType[], validFrom: '2026-11-01' });
  const r = res.data;
  const ST = { draft: 'muted', pending: 'warn', active: 'ok', rejected: 'danger', retired: 'muted' } as const;
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      <Card title={p('Правила аллокации (источник, получатели, драйвер, формула, период, маршрут согласования)', "Taqsimot qoidalari (manba, oluvchilar, drayver, formula, davr, kelishuv yo'nalishi)", 'Allocation rules (source, receivers, driver, formula, period, approval route)')} flush actions={ndoApi.can(user, 'calc') ? <Button size="small" icon="plus" onClick={() => setAdding(true)}>{p('Новая версия правила', 'Qoidaning yangi versiyasi', 'New rule version')}</Button> : null}>
        <DataTable rows={rules.data} loading={rules.loading} rowKey={(x) => x.id} columns={[
          { header: p('Правило', 'Qoida', 'Rule'), render: (x) => <><b>{x.code}</b> v{x.version}<div className="sub">{loc(x.name)}</div></> },
          { header: p('Шаг', 'Bosqich', 'Step'), render: (x) => lbl(x.step) },
          { header: p('Пул → получатели', 'Pul → oluvchilar', 'Pool → receivers'), render: (x) => <span className="small">{x.pool} → {x.receiverTypes.map(typeLabel).join(', ')}</span> },
          { header: p('Драйвер / формула', 'Drayver / formula', 'Driver / formula'), render: (x) => <span className="small">{lbl(x.driver)}<div className="sub">{loc(x.formula)}</div></span> },
          { header: p('Период', 'Davr', 'Period'), render: (x) => <span className="small">{x.validFrom} — {x.validTo ?? '…'}</span> },
          { header: p('Статус', 'Holat', 'Status'), render: (x) => <Badge tone={ST[x.status]}>{lbl(x.status)}</Badge> },
          { header: '', render: (x) => (x.status === 'draft' || x.status === 'rejected' ? (ndoApi.can(user, 'calc') ? <Button size="small" type="primary" disabled={busy} onClick={() => run(() => ndoApi.submitRule(x.id, user), p('Правило отправлено на согласование', 'Qoida kelishuvga yuborildi', 'Rule sent for approval'))}>{p('На согласование', 'Kelishuvga', 'Submit')}</Button> : null) : x.status === 'pending' ? <RouteSteps entityId={x.id} /> : null) },
        ]} />
      </Card>
      {r && (
        <>
          <Card title={`${p('Баланс пулов', 'Pullar balansi', 'Pool balance')} · ${period}`} flush>
            <DataTable rows={r.pools} rowKey={(x) => x.pool} columns={[
              { header: p('Пул', 'Pul', 'Pool'), render: (x) => <b>{x.pool}</b> },
              { header: p('Сумма пула', 'Pul summasi', 'Pool amount'), align: 'right', render: (x) => formatMoney(x.amount) },
              { header: p('Распределено', 'Taqsimlandi', 'Allocated'), align: 'right', render: (x) => formatMoney(x.allocated) },
              { header: p('Контроль', 'Nazorat', 'Check'), render: (x) => (Math.abs(x.amount - x.allocated) <= 1 ? <Badge tone="ok">= ✓</Badge> : <Badge tone="danger">Δ {formatMoney(x.amount - x.allocated)}</Badge>) },
            ]} />
          </Card>
          <Card title={p('Раскрытие цепочки распределения', 'Taqsimot zanjirini ochish', 'Allocation chain disclosure')} flush actions={<ExportButton filename={`ndo-allocation-${period}`} rows={r.allocation} columns={[{ header: p('Шаг', 'Bosqich', 'Step'), value: (a) => a.step }, { header: p('Пул', 'Pul', 'Pool'), value: (a) => a.pool }, { header: p('Получатель', 'Oluvchi', 'Receiver'), value: (a) => objs.name(a.receiver) }, { header: p('Драйвер', 'Drayver', 'Driver'), value: (a) => a.driverValue, format: 'number' }, { header: p('Доля', 'Ulush', 'Share'), value: (a) => a.share, format: 'number' }, { header: p('Сумма', 'Summa', 'Amount'), value: (a) => a.amount, format: 'money', total: true }]} />}>
            <DataTable rows={r.allocation} rowKey={(a) => `${a.pool}-${a.receiver}`} columns={[
              { header: p('Шаг / пул', 'Bosqich / pul', 'Step / pool'), render: (a) => <span className="small">{lbl(a.step)} · <b>{a.pool}</b></span> },
              { header: p('Получатель', 'Oluvchi', 'Receiver'), render: (a) => objs.name(a.receiver) },
              { header: p('Драйвер', 'Drayver', 'Driver'), align: 'right', render: (a) => formatNumber(a.driverValue) },
              { header: p('Доля', 'Ulush', 'Share'), align: 'right', render: (a) => `${formatDecimal(a.share * 100, 2)}%` },
              { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (a) => formatMoneyShort(a.amount, lang) },
            ]} />
          </Card>
        </>
      )}
      {adding && (
        <Modal title={p('Новая версия правила аллокации', 'Taqsimot qoidasining yangi versiyasi', 'New allocation rule version')} onClose={() => setAdding(false)} footer={<><Button onClick={() => setAdding(false)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => ndoApi.saveRule({ code: f.code, name: { ru: f.nameRu || f.code, uz: f.nameRu || f.code, en: f.nameRu || f.code }, step: f.step, pool: f.pool, receiverTypes: f.types, driver: f.driver, formula: { ru: `доля_i = ${f.driver}_i / Σ ${f.driver}`, uz: `ulush_i = ${f.driver}_i / Σ ${f.driver}`, en: `share_i = ${f.driver}_i / Σ ${f.driver}` }, validFrom: f.validFrom }, user), p('Черновик правила создан — отправьте на согласование', 'Qoida qoralamasi yaratildi — kelishuvga yuboring', 'Draft rule created — submit for approval'))) setAdding(false); }}>{p('Создать', 'Yaratish', 'Create')}</Button></>}>
          <div className="form-grid">
            <Field label={p('Код', 'Kod', 'Code')} required><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label={p('Наименование', 'Nomi', 'Name')}><Input value={f.nameRu} onChange={(e) => setF({ ...f, nameRu: e.target.value })} /></Field>
            <Field label={p('Шаг', 'Bosqich', 'Step')} required><Select<NdoRuleStep> value={f.step} onChange={(v) => setF({ ...f, step: v })} options={(['ndo_internal', 'bank_share', 'final'] as NdoRuleStep[]).map((x) => ({ value: x, label: lbl(x) }))} /></Field>
            <Field label={p('Пул-источник', 'Manba puli', 'Source pool')} required><Select<string> value={f.pool} onChange={(v) => setF({ ...f, pool: v })} options={['POOL-ADM', 'POOL-EKC', 'POOL-CIT', 'POOL-DEV', 'POOL-HO'].map((x) => ({ value: x, label: x }))} /></Field>
            <Field label={p('Драйвер', 'Drayver', 'Driver')} required><Select<NdoVolume['driver']> value={f.driver} onChange={(v) => setF({ ...f, driver: v })} options={(['volume', 'transactions', 'collections', 'route_km', 'fte'] as const).map((x) => ({ value: x, label: lbl(x) }))} /></Field>
            <Field label={p('Действует с', 'Amal qiladi', 'Valid from')} required><Input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
            <Field label={p('Получатели (типы объектов)', 'Oluvchilar (obyekt turlari)', 'Receivers (object types)')} className="span-2">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{NDO_TYPES.map((t) => <Button key={t} size="small" type={f.types.includes(t) ? 'primary' : 'default'} onClick={() => setF({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] })}>{typeLabel(t)}</Button>)}</div>
            </Field>
          </div>
          <RouteSteps preview={{ entity: 'cash_rule', context: { subtype: f.step } }} />
        </Modal>
      )}
    </div>
  );
}
