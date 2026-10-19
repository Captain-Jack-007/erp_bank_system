// НДО: себестоимость и P&L по слоям, детализация до источника, устройства и OptiLoad, тарифы, дашборд с оповещениями,
// качество данных и закрытие периода, параметры и роли.
import { useState } from 'react';
import { formatDateTime, formatDecimal, formatMoney, formatMoneyShort, formatNumber, ndoApi, NDO_PERIODS, ROLES, type NdoCloseStep, type NdoParams, type Role } from '@xb/shared';
import { Badge, BarChart, Button, Card, Checkbox, DataTable, Drawer, Field, Input, Select, Stat } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useP } from '../taxes/common';
import { useNdoObjects, useNdoRun } from './NdoPage';
import { useTypeLabel } from './NdoTabsA';

const bn = (v: number) => Math.round(v / 1e8) / 10;

function DrillDrawer({ period, objectKey, onClose }: { period: string; objectKey: string; onClose: () => void }) {
  const p = useP();
  const { loc } = useSession();
  const objs = useNdoObjects();
  const d = useApi(() => ndoApi.drill(period, objectKey), [period, objectKey]);
  const x = d.data;
  return (
    <Drawer open width={860} title={`${p('Детализация до источника', 'Manbagacha tafsilot', 'Drill-down to source')}: ${objs.name(objectKey)} · ${period}`} onClose={onClose}>
      {x && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="small muted">{p('Методика', 'Metodika', 'Methodology')} {x.methodology} · {p('хэш результата', 'natija xeshi', 'result hash')} {x.hash}</div>
          {x.result && <div className="small">{p('Прямые', "To'g'ridan-to'g'ri", 'Direct')} {formatMoney(x.result.direct)} · {p('аллокация НДО', 'NPA taqsimoti', 'cash allocation')} {formatMoney(x.result.ndoAlloc)} · {p('общебанковские', 'umumbank', 'bank-wide')} {formatMoney(x.result.hoAlloc)} · FTP {formatMoney(x.result.funding)} = <b>{formatMoney(x.result.total)}</b></div>}
          <Card title={p('Первичные записи', 'Birlamchi yozuvlar', 'Source records')} flush>
            <DataTable rows={x.facts} emptyText="—" rowKey={(f) => f.id} columns={[
              { header: p('Статья', 'Modda', 'Article'), render: (f) => f.article },
              { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (f) => formatMoney(f.amount) },
              { header: p('Первичная запись → загрузка', 'Birlamchi yozuv → yuklash', 'Source record → load'), render: (f) => <span className="small">{f.sourceRef}<div className="sub">{f.load ? `${f.load.datasetId} · ${f.load.exchangeId ?? 'ERP'} · ${formatDateTime(f.load.at)} · hash ${f.load.hash}` : f.loadId}</div></span> },
            ]} />
          </Card>
          <Card title={p('Полученная аллокация: правило, драйвер, формула', 'Olingan taqsimot: qoida, drayver, formula', 'Allocation received: rule, driver, formula')} flush>
            <DataTable rows={x.allocation} emptyText="—" rowKey={(a) => a.pool} columns={[
              { header: p('Правило', 'Qoida', 'Rule'), render: (a) => <span className="small"><b>{a.rule?.code}</b> v{a.rule?.version}<div className="sub">{a.rule ? loc(a.rule.formula) : ''}</div></span> },
              { header: p('Драйвер / доля', 'Drayver / ulush', 'Driver / share'), align: 'right', render: (a) => `${formatNumber(a.driverValue)} / ${formatDecimal(a.share * 100, 2)}%` },
              { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (a) => formatMoney(a.amount) },
            ]} />
          </Card>
          <Card title={p('Фондирование: ставка FTP и курс', 'Fondlash: FTP stavkasi va kurs', 'Funding: FTP rate and FX')} flush>
            <DataTable rows={x.funding} emptyText="—" rowKey={(f) => `${f.currency}-${f.days}`} columns={[
              { header: p('Валюта', 'Valyuta', 'Currency'), render: (f) => f.currency },
              { header: p('Ср. остаток UZS', "O'rt. qoldiq UZS", 'Avg UZS'), align: 'right', render: (f) => formatMoney(f.avgUzs) },
              { header: 'FTP / ' + p('курс', 'kurs', 'FX') + ' / ' + p('дней', 'kun', 'days'), align: 'right', render: (f) => `${formatDecimal(f.ftpRate, 2)}% / ${formatNumber(f.fxRate)} / ${f.days}` },
              { header: p('Стоимость', 'Qiymat', 'Cost'), align: 'right', render: (f) => formatMoney(f.cost) },
            ]} />
          </Card>
        </div>
      )}
    </Drawer>
  );
}

export function CostTab({ period }: { period: string }) {
  const p = useP();
  const { lang } = useSession();
  const objs = useNdoObjects();
  const res = useApi(() => ndoApi.results(period), [period]);
  const [cmp, setCmp] = useState('2026-08');
  const prev = useApi(() => ndoApi.results(cmp), [cmp]);
  const bud = useApi(() => ndoApi.listBudget(period), [period]);
  const rf = useApi(() => ndoApi.rollingForecast());
  const [drill, setDrill] = useState<string | null>(null);
  const typeLabel = useTypeLabel();
  const [type, setType] = useState('');
  const r = res.data;
  const rows = (r?.objects ?? []).filter((o) => (o.total || o.income) && (!type || objs.list.find((x) => x.key === o.key)?.type === type));
  const plan = (bud.data ?? []).filter((b) => !b.article.startsWith('INC')).reduce((s, b) => s + b.amount, 0);
  const fc = rf.data?.find((x) => x.period === period)?.forecastCost ?? 0;
  const PROC: Record<string, [string, string, string]> = { issuance: ['Выдача', 'Berish', 'Issuance'], acceptance: ['Приём', 'Qabul', 'Acceptance'], storage: ['Хранение', 'Saqlash', 'Storage'], processing: ['Обработка', 'Ishlov berish', 'Processing'], reinforcement: ['Подкрепление', 'Mustahkamlash', 'Reinforcement'], collection: ['Инкассация', 'Inkassatsiya', 'Collection'], sale: ['Обмен валюты', 'Valyuta ayirboshlash', 'FX exchange'] };
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      {r && (
        <div className="grid grid-4">
          <Stat label={p('Плановая себестоимость', 'Rejaviy tannarx', 'Planned cost')} value={formatMoneyShort(plan, lang)} icon="book" />
          <Stat label={p('Прогнозная', 'Prognoz', 'Forecast')} value={formatMoneyShort(fc, lang)} icon="clock" />
          <Stat label={p('Фактическая (все слои)', 'Haqiqiy (barcha qatlamlar)', 'Actual (all layers)')} value={formatMoneyShort(r.totals.total, lang)} icon="pie" tone="accent" foot={`${p('прямые', "to'g'ridan", 'direct')} ${formatMoneyShort(r.totals.direct, lang)} · FTP ${formatMoneyShort(r.totals.funding, lang)} · ${p('общебанк.', 'umumbank', 'bank-wide')} ${formatMoneyShort(r.totals.hoAlloc, lang)}`} />
          <Stat label={p('Себестоимость 1 млн (кассы)', '1 mln tannarxi (kassalar)', 'Cost per 1 mln (branches)')} value={r.totals.volume ? formatNumber(Math.round(r.objects.filter((o) => objs.list.find((x) => x.key === o.key)?.type === 'cbu').reduce((s, o) => s + o.total, 0) / (r.totals.volume / 1e6))) : '—'} icon="coins" />
        </div>
      )}
      <Card title={p('Управленческий P&L НДО и себестоимость по объектам', "NPA boshqaruv P&L va obyektlar bo'yicha tannarx", 'Cash management P&L and cost by object')} flush actions={
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Select<string> value={type} onChange={setType} options={(['cbu', 'ekc', 'atm', 'cash_in', 'recycler', 'cash_desk', 'exchange', 'cit_route'] as const).map((x) => ({ value: x, label: typeLabel(x) }))} placeholder={p('Все типы', 'Barcha turlar', 'All types')} ariaLabel={p('Тип', 'Tur', 'Type')} />
          {r && <ExportButton filename={`ndo-pnl-${period}`} rows={rows} columns={[{ header: p('Объект', 'Obyekt', 'Object'), value: (o) => objs.name(o.key) }, { header: p('Доходы', 'Daromadlar', 'Income'), value: (o) => o.income, format: 'money', total: true }, { header: p('Прямые', "To'g'ridan", 'Direct'), value: (o) => o.direct, format: 'money', total: true }, { header: p('Аллокация НДО', 'NPA taqsimoti', 'Cash alloc.'), value: (o) => o.ndoAlloc, format: 'money', total: true }, { header: p('Общебанковские', 'Umumbank', 'Bank-wide'), value: (o) => o.hoAlloc, format: 'money', total: true }, { header: 'FTP', value: (o) => o.funding, format: 'money', total: true }, { header: p('Себестоимость', 'Tannarx', 'Cost'), value: (o) => o.total, format: 'money', total: true }, { header: p('Результат', 'Natija', 'Result'), value: (o) => o.result, format: 'money', total: true }, { header: p('Объём', 'Hajm', 'Volume'), value: (o) => o.volume, format: 'money' }, { header: p('На 1 млн', '1 mln ga', 'Per 1 mln'), value: (o) => o.costPerMln, format: 'number' }]} />}
          {r && <PrintButton template="registry" label={p('Печать', 'Chop', 'Print')} doc={() => ({ entity: 'ndo_pnl', entityId: period, title: `${p('P&L НДО', 'NPA P&L', 'Cash P&L')} ${period}`, date: new Date().toISOString().slice(0, 10), landscape: true, table: { columns: [{ header: p('Объект', 'Obyekt', 'Object') }, { header: p('Доходы', 'Daromad', 'Income'), align: 'right' }, { header: p('Прямые', "To'g'ridan", 'Direct'), align: 'right' }, { header: p('Аллокация', 'Taqsimot', 'Allocation'), align: 'right' }, { header: 'FTP', align: 'right' }, { header: p('Себестоимость', 'Tannarx', 'Cost'), align: 'right' }, { header: p('Результат', 'Natija', 'Result'), align: 'right' }], rows: rows.map((o) => [objs.name(o.key), formatMoneyShort(o.income, lang), formatMoneyShort(o.direct, lang), formatMoneyShort(o.ndoAlloc + o.hoAlloc, lang), formatMoneyShort(o.funding, lang), formatMoneyShort(o.total, lang), formatMoneyShort(o.result, lang)]) } })} />}
        </span>
      }>
        <DataTable rows={rows} loading={res.loading} rowKey={(o) => o.key} onRowClick={(o) => setDrill(o.key)} columns={[
          { header: p('Объект', 'Obyekt', 'Object'), render: (o) => <b>{objs.name(o.key)}</b> },
          { header: p('Доходы', 'Daromadlar', 'Income'), align: 'right', render: (o) => formatMoneyShort(o.income, lang) },
          { header: p('Прямые', "To'g'ridan", 'Direct'), align: 'right', render: (o) => formatMoneyShort(o.direct, lang) },
          { header: p('Аллок. НДО', 'NPA taqs.', 'Cash alloc.'), align: 'right', render: (o) => formatMoneyShort(o.ndoAlloc, lang) },
          { header: p('Общебанк.', 'Umumbank', 'Bank-wide'), align: 'right', render: (o) => formatMoneyShort(o.hoAlloc, lang) },
          { header: 'FTP', align: 'right', render: (o) => formatMoneyShort(o.funding, lang) },
          { header: p('Себестоимость', 'Tannarx', 'Cost'), align: 'right', render: (o) => <b>{formatMoneyShort(o.total, lang)}</b> },
          { header: p('Результат', 'Natija', 'Result'), align: 'right', render: (o) => <span style={{ color: o.result < 0 ? 'var(--danger)' : 'var(--ok)' }}>{formatMoneyShort(o.result, lang)}</span> },
          { header: p('На 1 млн / на операцию', '1 mln / operatsiyaga', 'Per 1 mln / per tx'), align: 'right', render: (o) => <span className="small">{o.costPerMln ? formatNumber(o.costPerMln) : '—'}{o.transactions ? ` / ${formatNumber(Math.round(o.total / o.transactions))}` : ''}</span> },
        ]} />
      </Card>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title={p('Себестоимость по процессам', "Jarayonlar bo'yicha tannarx", 'Cost by process')}>
          {r && <BarChart data={r.byProcess.map((x) => ({ label: PROC[x.process] ? p(...PROC[x.process]!) : x.process, values: [bn(x.cost)] }))} series={[{ name: p('млрд', 'mlrd', 'bn') }]} format={(n) => formatDecimal(n)} height={200} />}
        </Card>
        <Card title={p('Сравнение периодов', 'Davrlarni taqqoslash', 'Period comparison')} actions={<Select<string> value={cmp} onChange={setCmp} options={NDO_PERIODS.filter((x) => x !== period).map((x) => ({ value: x, label: x }))} ariaLabel={p('Сравнить с', 'Taqqoslash', 'Compare with')} />}>
          {r && prev.data && <BarChart data={(['income', 'direct', 'funding', 'total'] as const).map((k) => ({ label: { income: p('Доходы', 'Daromad', 'Income'), direct: p('Прямые', "To'g'ridan", 'Direct'), funding: 'FTP', total: p('Себестоимость', 'Tannarx', 'Cost') }[k], values: [bn(prev.data!.totals[k]), bn(r.totals[k])] }))} series={[{ name: cmp }, { name: period }]} format={(n) => formatDecimal(n)} height={200} />}
        </Card>
      </div>
      {drill && <DrillDrawer period={period} objectKey={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

export function DevicesTab({ period }: { period: string }) {
  const p = useP();
  const { loc, lang } = useSession();
  const dev = useApi(() => ndoApi.devices(period), [period]);
  const [sel, setSel] = useState<string | null>(null);
  const rows = dev.data ?? [];
  const d = rows.find((x) => x.key === sel);
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      <Card title={p('Экономика устройств самообслуживания', "O'z-o'ziga xizmat qurilmalari iqtisodiyoti", 'Self-service device economics')} flush actions={<ExportButton filename={`ndo-devices-${period}`} rows={rows} columns={[{ header: p('Устройство', 'Qurilma', 'Device'), value: (x) => x.code }, { header: p('Доход', 'Daromad', 'Income'), value: (x) => x.income, format: 'money', total: true }, { header: p('Ср. остаток', "O'rt. qoldiq", 'Avg balance'), value: (x) => x.avgBalance, format: 'money' }, { header: 'FTP', value: (x) => x.funding, format: 'money', total: true }, { header: p('Сервис/инкассация (аллок.)', 'Servis/inkassatsiya', 'Service/CIT (alloc.)'), value: (x) => x.service, format: 'money', total: true }, { header: p('Связь', 'Aloqa', 'Comms'), value: (x) => x.comms, format: 'money' }, { header: p('Ремонт', "Ta'mir", 'Repair'), value: (x) => x.repair, format: 'money' }, { header: p('Операций', 'Operatsiyalar', 'Transactions'), value: (x) => x.transactions, format: 'integer' }, { header: p('Загрузок', 'Yuklashlar', 'Loads'), value: (x) => x.loads, format: 'integer' }, { header: p('Инкассаций', 'Inkassatsiyalar', 'Collections'), value: (x) => x.collections, format: 'integer' }, { header: p('Простой, ч', "To'xtash, soat", 'Downtime, h'), value: (x) => x.downtime, format: 'integer' }, { header: p('Результат', 'Natija', 'Result'), value: (x) => x.result, format: 'money', total: true }]} />}>
        <DataTable rows={rows} loading={dev.loading} rowKey={(x) => x.key} onRowClick={(x) => setSel(x.key)} columns={[
          { header: p('Устройство', 'Qurilma', 'Device'), render: (x) => <><b>{x.code}</b><div className="sub">{loc(x.name)}</div></> },
          { header: p('Доход', 'Daromad', 'Income'), align: 'right', render: (x) => formatMoneyShort(x.income, lang) },
          { header: p('Остаток / FTP', 'Qoldiq / FTP', 'Balance / FTP'), align: 'right', render: (x) => <span className="small">{formatMoneyShort(x.avgBalance, lang)} / {formatMoneyShort(x.funding, lang)}</span> },
          { header: p('Сервис, связь, ремонт', "Servis, aloqa, ta'mir", 'Service, comms, repair'), align: 'right', render: (x) => <span className="small">{formatMoneyShort(x.service, lang)} · {formatMoneyShort(x.comms, lang)} · {formatMoneyShort(x.repair, lang)}</span> },
          { header: p('Операции / загрузки / инкассации', 'Operatsiya / yuklash / inkassatsiya', 'Tx / loads / collections'), align: 'right', render: (x) => <span className="small">{formatNumber(x.transactions)} / {x.loads} / {x.collections}</span> },
          { header: p('Простой', "To'xtash", 'Downtime'), align: 'right', render: (x) => `${x.downtime} ${p('ч', 'soat', 'h')} (${x.incidents})` },
          { header: 'OptiLoad', render: (x) => <Badge tone={x.opti.followed === x.opti.recs ? 'ok' : 'warn'}>{x.opti.followed}/{x.opti.recs}</Badge> },
          { header: p('Результат', 'Natija', 'Result'), align: 'right', render: (x) => <span style={{ color: x.result < 0 ? 'var(--danger)' : 'var(--ok)', fontWeight: 600 }}>{formatMoneyShort(x.result, lang)}</span> },
        ]} />
      </Card>
      {d && (
        <Card title={`OptiLoad: ${d.code} — ${p('рекомендация против факта', 'tavsiya va fakt', 'recommendation vs actual')}`} flush>
          <DataTable rows={d.opti.items} rowKey={(o) => o.id} columns={[
            { header: p('Дата', 'Sana', 'Date'), render: (o) => o.date },
            { header: p('Рекомендация', 'Tavsiya', 'Recommended'), align: 'right', render: (o) => formatMoney(o.recommended) },
            { header: p('Фактическая загрузка', 'Haqiqiy yuklash', 'Actual load'), align: 'right', render: (o) => formatMoney(o.actual) },
            { header: p('Исполнено', 'Bajarildi', 'Followed'), render: (o) => (o.followed ? <Badge tone="ok">✓</Badge> : <Badge tone="warn">{p('отклонение', "og'ish", 'deviation')}</Badge>) },
            { header: p('Результат', 'Natija', 'Outcome'), render: (o) => (o.cashOutHours ? <span style={{ color: 'var(--danger)' }}>{p('без наличных', 'naqd pulsiz', 'cash-out')} {o.cashOutHours} {p('ч', 'soat', 'h')}</span> : o.excessAfter ? `${p('избыточный остаток', 'ortiqcha qoldiq', 'excess balance')} ${formatMoneyShort(o.excessAfter, lang)}` : '—') },
          ]} />
        </Card>
      )}
    </div>
  );
}

export function TariffsTab({ period }: { period: string }) {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const list = useApi(() => ndoApi.tariffs(period), [period]);
  const params = useApi(() => ndoApi.params());
  const { run } = useNdoRun();
  const [edit, setEdit] = useState<Record<string, string>>({});
  return (
    <div style={{ padding: 14, display: 'grid', gap: 10 }}>
      <div className="muted small">{p('Рекомендуемый тариф = (себестоимость единицы + FTP) / (1 − целевая маржа) × (1 − льгота) + НДС. Себестоимость и объём — из расчёта периода', "Tavsiya etilgan tarif = (birlik tannarxi + FTP) / (1 − maqsadli marja) × (1 − imtiyoz) + QQS. Tannarx va hajm — davr hisobidan", 'Recommended tariff = (unit cost + FTP) / (1 − target margin) × (1 − benefit) + VAT. Unit cost and volume come from the period calculation')} {period}; {p('целевая маржа', 'maqsadli marja', 'target margin')} {params.data?.targetMargin}%.</div>
      <DataTable rows={list.data} loading={list.loading} rowKey={(t) => t.code} columns={[
        { header: p('Услуга', 'Xizmat', 'Service'), render: (t) => <><b>{loc(t.name)}</b><div className="sub">{t.code} · {loc(t.unit)}</div></> },
        { header: p('Себест. ед.', 'Birlik tannarxi', 'Unit cost'), align: 'right', render: (t) => formatNumber(t.unitCost) },
        { header: 'FTP', align: 'right', render: (t) => formatNumber(t.unitFtp) },
        { header: p('Маржа', 'Marja', 'Margin'), align: 'right', render: (t) => formatNumber(t.margin) },
        { header: p('Льгота', 'Imtiyoz', 'Benefit'), align: 'right', render: (t) => `${t.benefitPct}%` },
        { header: p('НДС', 'QQS', 'VAT'), align: 'right', render: (t) => formatNumber(t.tax) },
        { header: p('Рекомендуемый', 'Tavsiya etilgan', 'Recommended'), align: 'right', render: (t) => <b>{formatNumber(t.recommended)}</b> },
        { header: p('Действующий', 'Amaldagi', 'Current'), align: 'right', render: (t) => (ndoApi.can(user, 'calc') ? <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}><Input value={edit[t.code] ?? String(t.currentTariff)} inputMode="numeric" ariaLabel={`tariff ${t.code}`} onChange={(e) => setEdit({ ...edit, [t.code]: e.target.value })} style={{ width: 110, height: 30 }} /><Button size="small" onClick={() => run(() => ndoApi.updateTariff(t.code, { currentTariff: Number((edit[t.code] ?? String(t.currentTariff)).replace(/\s/g, '')) }, user), p('Тариф сохранён', 'Tarif saqlandi', 'Tariff saved'))}>OK</Button></span> : formatNumber(t.currentTariff)) },
        { header: p('Отклонение', "Og'ish", 'Gap'), align: 'right', render: (t) => <Badge tone={t.gapPct < 0 ? 'danger' : 'ok'}>{formatDecimal(t.gapPct)}%</Badge> },
        { header: p('План. объём / доход', 'Rejaviy hajm / daromad', 'Planned volume / income'), align: 'right', render: (t) => <span className="small">{formatNumber(t.plannedVolume)} / {formatMoney(t.plannedIncome)}</span> },
      ]} />
    </div>
  );
}

export function DashboardTab({ period }: { period: string }) {
  const p = useP();
  const { lang } = useSession();
  const user = useUser();
  const objs = useNdoObjects();
  const res = useApi(() => ndoApi.results(period), [period]);
  const alerts = useApi(() => ndoApi.alerts(period), [period]);
  const trend = useApi(async () => Promise.all(NDO_PERIODS.map(async (x) => ({ period: x, r: await ndoApi.results(x) }))));
  const bi = useApi(() => ndoApi.listBi());
  const { busy, run } = useNdoRun();
  const r = res.data;
  const excessShare = r ? Math.round((r.funding.reduce((s, f) => s + f.costExcess, 0) / Math.max(1, r.totals.funding)) * 1000) / 10 : 0;
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      {r && (
        <div className="grid grid-4">
          <Stat label="P&L" value={formatMoneyShort(r.totals.result, lang)} icon="chart" tone={r.totals.result < 0 ? 'alert' : 'accent'} foot={`${p('доходы', 'daromad', 'income')} ${formatMoneyShort(r.totals.income, lang)}`} />
          <Stat label={p('Доля избыточных остатков в FTP', "FTP da ortiqcha qoldiqlar ulushi", 'Excess balances share in FTP')} value={`${formatDecimal(excessShare)}%`} icon="percent" />
          <Stat label={p('Пороговые оповещения', 'Chegaraviy ogohlantirishlar', 'Threshold alerts')} value={alerts.data?.length ?? '—'} icon="bell" tone={alerts.data?.length ? 'alert' : undefined} />
          <Stat label={p('Объём обработки (кассы)', 'Ishlov hajmi (kassalar)', 'Processed volume (branches)')} value={formatMoneyShort(r.totals.volume, lang)} icon="coins" />
        </div>
      )}
      {trend.data && (
        <Card title={p('Динамика по периодам, млрд', "Davrlar bo'yicha dinamika, mlrd", 'Trend by period, bn')}>
          <BarChart data={trend.data.map((x) => ({ label: x.period.slice(5), values: [bn(x.r.totals.income), bn(x.r.totals.direct + x.r.totals.hoAlloc), bn(x.r.totals.funding)] }))} series={[{ name: p('Доходы', 'Daromadlar', 'Income') }, { name: p('Расходы', 'Xarajatlar', 'Costs') }, { name: 'FTP' }]} format={(n) => formatDecimal(n)} height={200} />
        </Card>
      )}
      <Card title={p('Оповещения по порогам', "Chegaralar bo'yicha ogohlantirishlar", 'Threshold alerts')} flush actions={
        <span style={{ display: 'flex', gap: 6 }}>
          <Button size="small" icon="bell" disabled={busy} onClick={() => run(() => ndoApi.notifyAlerts(period, user), p('Оповещения отправлены', 'Ogohlantirishlar yuborildi', 'Alerts sent'))}>{p('Разослать', 'Yuborish', 'Send')}</Button>
          {ndoApi.can(user, 'calc') && <Button size="small" icon="upload" disabled={busy} onClick={() => run(() => ndoApi.publishBi(period, user), p('Витрина передана в DWH/BI', 'Vitrina DWH/BI ga uzatildi', 'Data mart published to DWH/BI'))}>{p('Передать в BI / AI', 'BI / AI ga uzatish', 'Publish to BI / AI')}</Button>}
        </span>
      }>
        <DataTable rows={alerts.data} loading={alerts.loading} emptyText={p('Порогов не превышено', 'Chegaralar oshirilmagan', 'No thresholds exceeded')} rowKey={(a) => `${a.key}-${a.kind}`} columns={[
          { header: p('Объект', 'Obyekt', 'Object'), render: (a) => objs.name(a.key) },
          { header: p('Показатель', "Ko'rsatkich", 'Indicator'), render: (a) => (a.kind === 'excess' ? p('Избыточные остатки, %', 'Ortiqcha qoldiqlar, %', 'Excess balances, %') : p('Себестоимость 1 млн', '1 mln tannarxi', 'Cost per 1 mln')) },
          { header: p('Значение / порог', 'Qiymat / chegara', 'Value / threshold'), align: 'right', render: (a) => `${formatDecimal(a.value)} / ${formatNumber(a.threshold)}` },
        ]} />
        {!!bi.data?.length && <div className="small muted" style={{ padding: '8px 14px' }}>BI: {bi.data.map((b) => `${b.period} ${b.status} (${b.exchangeId})`).join('; ')}</div>}
      </Card>
    </div>
  );
}

const STEP_LABEL: Record<NdoCloseStep, [string, string, string]> = {
  load: ['Загрузка данных', "Ma'lumotlarni yuklash", 'Data load'], dq: ['Проверка качества', 'Sifat tekshiruvi', 'Data quality'], direct: ['Прямое отнесение', "To'g'ridan-to'g'ri o'tkazish", 'Direct assignment'],
  funding: ['Фондирование (FTP)', 'Fondlash (FTP)', 'Funding (FTP)'], allocation: ['Аллокация', 'Taqsimot', 'Allocation'], cost: ['Себестоимость и P&L', 'Tannarx va P&L', 'Cost & P&L'], approve: ['Утверждение', 'Tasdiqlash', 'Approval'], closed: ['Закрыт', 'Yopilgan', 'Closed'],
};

export function CloseTab({ period }: { period: string }) {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const dq = useApi(() => ndoApi.dq(period), [period]);
  const st = useApi(() => ndoApi.periodState(period), [period]);
  const { busy, run } = useNdoRun();
  const [verify, setVerify] = useState<Awaited<ReturnType<typeof ndoApi.verifyClosed>> | null>(null);
  const s = st.data;
  const nextStep = ndoApi.closeSteps.find((x) => x !== 'closed' && !s?.steps[x]);
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      <Card title={`${p('Проверки качества данных', "Ma'lumotlar sifati tekshiruvlari", 'Data quality checks')} · ${period}`} flush>
        <DataTable rows={dq.data} loading={dq.loading} rowKey={(c) => c.code} columns={[
          { header: '', render: (c) => (c.ok ? <Badge tone="ok">✓</Badge> : <Badge tone={c.severity === 'blocker' ? 'danger' : 'warn'}>{c.severity === 'blocker' ? p('блокирует', 'bloklaydi', 'blocker') : p('внимание', "e'tibor", 'warning')}</Badge>) },
          { header: p('Проверка', 'Tekshiruv', 'Check'), render: (c) => loc(c.name) },
          { header: p('Детали', 'Tafsilot', 'Details'), render: (c) => <span className="small">{c.detail}</span> },
        ]} />
      </Card>
      <Card title={p('Закрытие периода в утверждённой последовательности', 'Davrni tasdiqlangan ketma-ketlikda yopish', 'Period close in the approved sequence')}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {ndoApi.closeSteps.map((x, i) => (
            <div key={x} className="small" style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: s?.steps[x] ? 'var(--ok-bg)' : x === nextStep ? 'var(--info-bg)' : undefined }}>
              {i + 1}. {p(...STEP_LABEL[x])}
              {s?.steps[x] && <div className="sub">{lk.user(s.steps[x]!.by)?.fullName ?? s.steps[x]!.by} · {formatDateTime(s.steps[x]!.at)}</div>}
            </div>
          ))}
        </div>
        {s?.status === 'closed' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <Badge tone="ok">{p('Период закрыт; результаты защищены. Хэш снимка', 'Davr yopilgan; natijalar himoyalangan. Snapshot xeshi', 'Period closed; results protected. Snapshot hash')} {s.snapshot?.hash}</Badge>
            <div><Button size="small" icon="refresh" onClick={async () => setVerify(await ndoApi.verifyClosed(period))}>{p('Пересчитать закрытый период', 'Yopilgan davrni qayta hisoblash', 'Recalculate closed period')}</Button></div>
            {verify && (
              <div className="small">
                {verify.identical ? <Badge tone="ok">{p('Результат воспроизведён в точности', 'Natija aynan takrorlandi', 'Result reproduced exactly')}</Badge> : <Badge tone="danger">{p('Расхождение!', 'Farq!', 'Mismatch!')}</Badge>} {verify.stored} = {verify.recomputed}
                <div className="sub">{p('С текущими справочниками и методикой', 'Joriy ma’lumotnomalar va metodika bilan', 'With current classifiers and methodology')}: {verify.withCurrentSettings} {verify.differsWithCurrent ? p('(отличается — закрытый период не изменяется)', "(farq qiladi — yopilgan davr o'zgarmaydi)", '(differs — the closed period is not changed)') : p('(совпадает)', '(mos)', '(same)')}</div>
                <div className="sub">{p('Версии снимка', 'Snapshot versiyalari', 'Snapshot versions')}: {Object.entries(verify.versions).map(([k, v]) => `${k}=${v}`).join(', ')}</div>
              </div>
            )}
          </div>
        ) : s?.status === 'pending_approval' ? (
          <div className="small"><Badge tone="warn">{p('На утверждении (маршрут «Закрытие периода НДО»)', 'Tasdiqlashda («NPA davrini yopish» yo‘nalishi)', 'Pending approval (route “Cash period close”)')}</Badge></div>
        ) : nextStep ? (
          <Button type="primary" disabled={busy} onClick={() => run(() => ndoApi.runStep(period, nextStep, user), `${p('Шаг выполнен', 'Bosqich bajarildi', 'Step completed')}: ${p(...STEP_LABEL[nextStep])}`)}>{p('Выполнить шаг', 'Bosqichni bajarish', 'Run step')}: {p(...STEP_LABEL[nextStep])}</Button>
        ) : null}
        <div className="muted small" style={{ marginTop: 10 }}>{p('Разделение функций: загрузка — ввод данных; проверка качества — бухгалтерия/финансы; расчёт — казначейство (не тот, кто проверял); утверждение — финансовый департамент через маршрут согласования.', "Funksiyalarni ajratish: yuklash — ma'lumot kiritish; sifat tekshiruvi — buxgalteriya/moliya; hisob — g'aznachilik (tekshirgan emas); tasdiqlash — moliya departamenti kelishuv yo'nalishi orqali.", 'Segregation of duties: load — data input; quality check — accounting/finance; calculation — treasury (not the checker); approval — finance via the approval route.')}</div>
      </Card>
    </div>
  );
}

export function ParamsTab() {
  const p = useP();
  const user = useUser();
  const { t } = useSession();
  const params = useApi(() => ndoApi.params());
  const { run } = useNdoRun();
  const [f, setF] = useState<Partial<Record<keyof NdoParams, string>>>({});
  const x = params.data;
  if (!x) return null;
  const num = (k: keyof NdoParams) => f[k] ?? String(x[k]);
  const fields: [keyof NdoParams, string][] = [
    ['methodology', p('Версия методики', 'Metodika versiyasi', 'Methodology version')], ['storageDays', p('Срок хранения для FTP, дн.', 'FTP uchun saqlash muddati, kun', 'Storage tenor for FTP, days')], ['necessaryFactor', p('Коэфф. необходимого остатка', 'Zarur qoldiq koeffitsienti', 'Necessary balance factor')],
    ['targetMargin', p('Целевая маржа тарифа, %', 'Tarifning maqsadli marjasi, %', 'Target tariff margin, %')], ['vatRate', p('НДС, %', 'QQS, %', 'VAT, %')], ['excessThresholdPct', p('Порог избыточных остатков, %', 'Ortiqcha qoldiqlar chegarasi, %', 'Excess balance threshold, %')],
    ['costPerMlnThreshold', p('Порог себестоимости 1 млн', '1 mln tannarxi chegarasi', 'Cost per 1 mln threshold')], ['glTolerance', p('Допуск сверки с ГК, UZS', 'BK bilan solishtirish chegarasi, UZS', 'GL reconciliation tolerance, UZS')],
  ];
  const FN = { input: p('Ввод данных', "Ma'lumot kiritish", 'Data input'), calc: p('Расчёт', 'Hisob', 'Calculation'), check: p('Проверка', 'Tekshiruv', 'Check'), approve: p('Утверждение', 'Tasdiqlash', 'Approval') };
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      <Card title={p('Параметры методики (настраиваются без изменения кода)', 'Metodika parametrlari (kodni o‘zgartirmasdan sozlanadi)', 'Methodology parameters (configured without code changes)')}>
        <div className="grid grid-4">
          {fields.map(([k, label]) => <Field key={k} label={label}><Input value={num(k)} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
        </div>
        <Button type="primary" style={{ marginTop: 10 }} onClick={() => run(() => ndoApi.updateParams(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, k === 'methodology' ? v : Number(String(v).replace(',', '.'))])) as Partial<NdoParams>, user), p('Параметры сохранены (изменения в журнале аудита)', 'Parametrlar saqlandi (o‘zgarishlar audit jurnalida)', 'Parameters saved (changes in the audit log)'))}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
      </Card>
      <Card title={p('Ролевая модель НДО (разделение функций)', 'NPA rol modeli (funksiyalarni ajratish)', 'Cash role model (segregation of duties)')}>
        <div style={{ display: 'grid', gap: 10 }}>
          {(Object.keys(FN) as (keyof NdoParams['roles'])[]).map((fn) => (
            <div key={fn}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{FN[fn]}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {(['cash_operator', 'treasury', 'accountant', 'finance', 'data_entry', 'analyst', 'dept_head'] as Role[]).filter((r) => ROLES.includes(r)).map((r) => (
                  <Checkbox key={r} checked={x.roles[fn].includes(r)} disabled={user.role !== 'admin'} onChange={(v) => run(() => ndoApi.updateParams({ roles: { ...x.roles, [fn]: v ? [...x.roles[fn], r] : x.roles[fn].filter((y) => y !== r) } }, user), p('Ролевая модель обновлена', 'Rol modeli yangilandi', 'Role model updated'))}>{t(`role_${r}` as never)}</Checkbox>
                ))}
              </div>
            </div>
          ))}
          <div className="muted small">{p('Изменять ролевую модель может администратор; все действия фиксируются в журнале аудита.', "Rol modelini administrator o'zgartirishi mumkin; barcha amallar audit jurnalida qayd etiladi.", 'Only an administrator can change the role model; all actions are written to the audit log.')}</div>
        </div>
      </Card>
    </div>
  );
}
