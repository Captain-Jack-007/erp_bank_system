// Модуль анализа операций (ТЗ 4.2.16): себестоимость банковских продуктов (прямые time-based + косвенные из аллокации +
// EL + стоимость ресурсов FTP), разрезы по продуктам/сегментам/каналам/филиалам, анализ трансфертной маржи,
// ожидаемые убытки, админ-панель ставок FTP, профили расходов ЦБУ. Прежний анализ процессов — во вкладке «Процессы XB-ERP».
import { Fragment, useEffect, useState } from 'react';
import {
  formatDateTime,
  formatDecimal,
  formatMoney,
  formatMoneyShort,
  formatNumber,
  ftpApi,
  importRegistry,
  OPA_PERIODS,
  operationsCostingApi,
  orgApi,
  tk,
  type OpaBreakdownRow,
  type OpaCostCategory,
  type OpaIndirectBasis,
  type OpaMarginRow,
  type OpaProductCost,
  type OpaStaff,
} from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, Stat, Switch, Tabs, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { ImportWizard } from '../../components/Import';
import { useCan } from '../../lib/access';
import { navigate, useLocation } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { usePick, useErrText } from '../budgeting/shared';
import { ProcessAnalytics } from './ProcessAnalytics';
import '../budgeting/budgeting.css';

type Tab = 'costing' | 'breakdown' | 'margin' | 'el' | 'methods' | 'ftp' | 'structure' | 'processes';
const TABS: Tab[] = ['costing', 'breakdown', 'margin', 'el', 'methods', 'ftp', 'structure', 'processes'];
const CATS: OpaCostCategory[] = ['rent', 'it', 'support', 'general', 'marketing'];

function useOpaErr() {
  const base = useErrText();
  const p = usePick();
  return (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    const map: Record<string, string> = {
      operations_err_minutes: p('Норма времени — от 0 до 10 000 минут', 'Vaqt me’yori — 0 dan 10 000 daqiqagacha', 'Time standard must be 0–10,000 minutes'),
      operations_err_rate: p('Ставка труда должна быть больше 0', 'Mehnat stavkasi 0 dan katta bo‘lishi kerak', 'Labour rate must be above 0'),
      operations_err_el: p('PD и LGD — от 0 до 100%', 'PD va LGD — 0 dan 100% gacha', 'PD and LGD must be 0–100%'),
      operations_err_reason: p('Укажите причину ручного ввода (от 5 символов)', 'Qo‘lda kiritish sababini ko‘rsating (5 belgidan)', 'Enter a reason for manual entry (5+ chars)'),
      operations_err_el_unavailable: p('Система риск-менеджмента / КХД недоступна — запрос в очереди', 'Risk-menejment tizimi / KXO mavjud emas — so‘rov navbatda', 'Risk system / DWH unavailable — request queued'),
      operations_err_profile: p('Профиль не найден или неверные параметры (коэффициент 0–3, аренда > 0)', 'Profil topilmadi yoki parametrlar noto‘g‘ri', 'Profile not found or invalid parameters'),
    };
    return map[m] ?? base(e);
  };
}

function useCatLabel() {
  const p = usePick();
  return (c: OpaCostCategory) => ({ rent: p('Аренда и содержание зданий', 'Ijara va binolarni saqlash', 'Rent and premises'), it: p('ИТ-услуги', 'AT xizmatlari', 'IT services'), support: p('Вспомогательный персонал', 'Yordamchi xodimlar', 'Support staff'), general: p('Административные и общехозяйственные', "Ma'muriy va umumxo'jalik", 'Administrative and general'), marketing: p('Маркетинг', 'Marketing', 'Marketing') })[c];
}

export function OperationsPage() {
  const { t, lang } = useSession();
  const p = usePick();
  const path = useLocation();
  const params = new URLSearchParams(path.split('?')[1] ?? '');
  const qTab = (params.get('module') ? 'processes' : params.get('tab')) as Tab | null;
  const [tab, setTabState] = useState<Tab>(qTab && TABS.includes(qTab) ? qTab : 'costing');
  useEffect(() => {
    if (qTab && TABS.includes(qTab)) setTabState(qTab);
  }, [qTab]);
  const setTab = (v: Tab) => {
    setTabState(v);
    if (qTab) navigate('/operations');
  };
  const [period, setPeriod] = useState(OPA_PERIODS[OPA_PERIODS.length - 1]!);
  const res = useApi(() => operationsCostingApi.compute(period), [period]);
  const r = res.data;
  const short = (v: number) => formatMoneyShort(v, lang);

  return (
    <>
      <PageHeader title={p('Анализ операций и себестоимость продуктов', 'Operatsiyalar tahlili va mahsulotlar tannarxi', 'Operations analysis and product costing')} subtitle={`${t('tzLabel')} 4.2.16 · ${p('Ценообразование: прямые и косвенные расходы, EL, стоимость ресурсов FTP, трансфертная маржа', 'Narxlash: to‘g‘ridan-to‘g‘ri va bilvosita xarajatlar, EL, FTP resurslari qiymati, transfer marjasi', 'Pricing: direct and indirect costs, EL, FTP funding cost, transfer margin')}`} />
      {tab !== 'processes' && (
        <div className="grid grid-4">
          <Stat label={`${p('Доходы продуктов', 'Mahsulotlar daromadi', 'Product revenue')} · ${period}`} value={r ? short(r.totals.revenue) : '—'} tone="accent" icon="coins" foot={r ? `FTP ${short(r.totals.ftp)} · ${r.methodology}` : undefined} />
          <Stat label={p('Прямые расходы (time-based)', 'To‘g‘ridan-to‘g‘ri xarajatlar (time-based)', 'Direct costs (time-based)')} value={r ? short(r.totals.direct) : '—'} icon="clock" />
          <Stat label={p('Косвенные из аллокации', 'Allokatsiyadan bilvosita', 'Indirect from allocation')} value={r ? short(r.totals.indirect) : '—'} icon="pie" foot={r ? `${r.allocationSource === 'run' ? r.allocationRun : p('предпросмотр', 'oldindan ko‘rish', 'preview')} · ${p('распределено', 'taqsimlangan', 'allocated')} ${short(r.totals.allocated)}` : undefined} />
          <Stat label={p('Прибыль продуктов', 'Mahsulotlar foydasi', 'Product profit')} value={r ? short(r.totals.profit) : '—'} icon="chart" tone={r && r.totals.profit < 0 ? 'alert' : undefined} foot={r ? `EL ${short(r.totals.el)} · ${p('маржа казначейства', 'g‘aznachilik marjasi', 'treasury margin')} ${short(r.totals.treasury)}` : undefined} />
        </div>
      )}
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'costing', label: p('Себестоимость продуктов', 'Mahsulotlar tannarxi', 'Product costing') },
            { value: 'breakdown', label: p('Сегменты, каналы, филиалы', 'Segmentlar, kanallar, filiallar', 'Segments, channels, branches') },
            { value: 'margin', label: p('Трансфертная маржа', 'Transfer marjasi', 'Transfer margin') },
            { value: 'el', label: p('Ожидаемые убытки (EL)', 'Kutilayotgan zararlar (EL)', 'Expected loss (EL)') },
            { value: 'methods', label: p('Методы и нормы', 'Usullar va me’yorlar', 'Methods & standards') },
            { value: 'ftp', label: p('Ставки и надбавки FTP', 'FTP stavka va ustamalari', 'FTP rates & premiums') },
            { value: 'structure', label: p('Профили ЦБУ', 'BXM profillari', 'Office cost profiles') },
            { value: 'processes', label: p('Процессы XB-ERP', 'XB-ERP jarayonlari', 'XB-ERP processes') },
          ]}
        />
        {tab !== 'processes' && tab !== 'ftp' && tab !== 'structure' && tab !== 'methods' && (
          <FilterBar>
            <Select value={period} onChange={setPeriod} ariaLabel={p('Квартал', 'Chorak', 'Quarter')} options={OPA_PERIODS.map((x) => ({ value: x, label: x }))} />
            <span className="muted small" style={{ flex: 1 }}>{p('Квартальные суммы; косвенные расходы — из последнего расчёта модуля аллокации за квартал, ставки FTP — утверждённая методология на конец квартала.', 'Choraklik summalar; bilvosita xarajatlar — allokatsiya modulining oxirgi hisobidan, FTP stavkalari — chorak oxiridagi tasdiqlangan metodologiya.', 'Quarterly amounts; indirect costs from the latest allocation run for the quarter, FTP rates from the approved methodology at quarter end.')}</span>
          </FilterBar>
        )}
        {tab === 'costing' && (r ? <CostingTab r={r} /> : <Loading />)}
        {tab === 'breakdown' && <BreakdownTab period={period} />}
        {tab === 'margin' && <MarginTab period={period} />}
        {tab === 'el' && <ElTab period={period} />}
        {tab === 'methods' && <MethodsTab />}
        {tab === 'ftp' && <FtpAdminTab />}
        {tab === 'structure' && <StructureTab />}
      </Card>
      {tab === 'processes' && <ProcessAnalytics />}
    </>
  );
}

function CostingTab({ r }: { r: NonNullable<Awaited<ReturnType<typeof operationsCostingApi.compute>>> }) {
  const { lang, loc, t } = useSession();
  const p = usePick();
  const cat = useCatLabel();
  const [seg, setSeg] = useState('');
  const [open, setOpen] = useState<OpaProductCost | null>(null);
  const short = (v: number) => formatMoneyShort(v, lang);
  const rows = r.products.filter((x) => !seg || x.segment === seg);
  return (
    <>
      <FilterBar>
        <Select value={seg} onChange={setSeg} ariaLabel={p('Сегмент', 'Segment', 'Segment')} options={[{ value: '', label: p('Все сегменты', 'Barcha segmentlar', 'All segments') }, ...['retail', 'corporate', 'sme', 'treasury'].map((s) => ({ value: s, label: t(tk('seg_', s)) }))]} />
        <span style={{ flex: 1 }} />
        <ExportButton<OpaProductCost>
          filename={`product-costing-${r.period}`}
          rows={rows}
          columns={[
            { header: p('Продукт', 'Mahsulot', 'Product'), value: (x) => loc(x.name) },
            { header: p('Сегмент', 'Segment', 'Segment'), value: (x) => t(tk('seg_', x.segment)) },
            { header: p('Остаток', 'Qoldiq', 'Balance'), value: (x) => x.balance, format: 'money' },
            { header: p('Операций', 'Operatsiyalar', 'Operations'), value: (x) => x.operations, format: 'integer' },
            { header: p('Процентный доход/расход', 'Foiz daromadi/xarajati', 'Interest income/expense'), value: (x) => x.clientIncome, format: 'money', total: true },
            { header: 'FTP', value: (x) => x.ftp, format: 'money', total: true },
            { header: p('Комиссии', 'Komissiyalar', 'Fees'), value: (x) => x.fees, format: 'money', total: true },
            { header: p('Прямые', 'To‘g‘ridan-to‘g‘ri', 'Direct'), value: (x) => x.direct, format: 'money', total: true },
            ...CATS.map((c) => ({ header: cat(c), value: (x: OpaProductCost) => x.indirectBy[c], format: 'money' as const, total: true })),
            { header: 'EL', value: (x) => x.el, format: 'money', total: true },
            { header: p('Себестоимость', 'Tannarx', 'Cost'), value: (x) => x.cost, format: 'money', total: true },
            { header: p('Прибыль', 'Foyda', 'Profit'), value: (x) => x.profit, format: 'money', total: true },
            { header: p('Затраты на операцию', 'Operatsiyaga xarajat', 'Cost per operation'), value: (x) => x.costPerOp, format: 'money' },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={rows}
        rowKey={(x) => x.productId}
        onRowClick={setOpen}
        columns={[
          { header: p('Продукт', 'Mahsulot', 'Product'), render: (x) => <><div style={{ fontWeight: 600 }}>{loc(x.name)}</div><div className="sub">{t(tk('seg_', x.segment))}{x.currency ? ` · ${x.currency}` : ''} · {formatNumber(x.operations)} {p('опер.', 'oper.', 'ops')}</div></> },
          { header: p('Доход', 'Daromad', 'Revenue'), align: 'right', render: (x) => short(x.side === 'liability' ? x.ftp : x.side === 'asset' ? x.clientIncome : x.fees) },
          { header: p('Стоимость ресурсов', 'Resurslar qiymati', 'Funding cost'), align: 'right', render: (x) => (x.side === 'asset' ? short(-x.ftp) : x.side === 'liability' ? short(-x.clientIncome) : '—') },
          { header: p('Прямые', 'To‘g‘ridan-to‘g‘ri', 'Direct'), align: 'right', render: (x) => short(x.direct) },
          { header: p('Косвенные', 'Bilvosita', 'Indirect'), align: 'right', render: (x) => short(x.indirect) },
          { header: 'EL', align: 'right', render: (x) => (x.el ? short(x.el) : '—') },
          { header: p('Прибыль', 'Foyda', 'Profit'), align: 'right', render: (x) => <b style={{ color: x.profit < 0 ? 'var(--danger)' : 'var(--ok)' }}>{short(x.profit)}</b> },
          { header: p('Рентаб.', 'Rentab.', 'Margin'), align: 'right', render: (x) => `${formatDecimal(x.marginPct)}%` },
          { header: p('На операцию', 'Operatsiyaga', 'Per operation'), align: 'right', render: (x) => formatMoney(x.costPerOp) },
        ]}
      />
      <div style={{ padding: 18 }}>
        <Card title={p('Структура себестоимости по продуктам', 'Mahsulotlar bo‘yicha tannarx tuzilmasi', 'Cost structure by product')}>
          <BarChart
            data={rows.slice(0, 12).map((x, i) => ({ label: `${loc(x.name).slice(0, 9)}${x.currency && x.currency !== 'UZS' ? ` ${x.currency}` : ''}${rows.slice(0, i).some((y) => loc(y.name).slice(0, 9) === loc(x.name).slice(0, 9)) ? ` ${i}` : ''}`, values: [x.direct, x.indirect, x.el, Math.max(0, -x.ftp)] }))}
            series={[{ name: p('Прямые', 'To‘g‘ridan-to‘g‘ri', 'Direct') }, { name: p('Косвенные', 'Bilvosita', 'Indirect'), color: 'var(--accent)' }, { name: 'EL', color: 'var(--danger)' }, { name: 'FTP', color: 'var(--info)' }]}
            format={short}
          />
        </Card>
      </div>
      {open && <ProductCostModal x={open} period={r.period} onClose={() => setOpen(null)} />}
    </>
  );
}

function ProductCostModal({ x, period, onClose }: { x: OpaProductCost; period: string; onClose: () => void }) {
  const { loc, lang, t } = useSession();
  const p = usePick();
  const cat = useCatLabel();
  const std = useApi(() => operationsCostingApi.listStandards());
  const settings = useApi(() => operationsCostingApi.getSettings());
  const short = (v: number) => formatMoneyShort(v, lang);
  const own = (std.data ?? []).filter((s) => s.productId === x.productId);
  const lines: [string, number][] = [
    [p('Процентный доход / расход клиента', 'Mijoz foiz daromadi / xarajati', 'Client interest income / expense'), x.clientIncome],
    [p('Трансфертная плата / кредит (FTP)', 'Transfer to‘lovi / krediti (FTP)', 'Transfer charge / credit (FTP)'), x.ftp],
    [p('Комиссионный доход', 'Komissiya daromadi', 'Fee income'), x.fees],
    [p('Прямые расходы (время × ставка + на операцию)', 'To‘g‘ridan-to‘g‘ri xarajatlar', 'Direct costs (time × rate + per operation)'), -x.direct],
    ...CATS.map((c) => [`${p('Косвенные', 'Bilvosita', 'Indirect')}: ${cat(c)}`, -x.indirectBy[c]] as [string, number]),
    [p('Ожидаемые убытки (EL)', 'Kutilayotgan zararlar (EL)', 'Expected loss (EL)'), -x.el],
  ];
  return (
    <Modal
      title={`${loc(x.name)} · ${period}`}
      onClose={onClose}
      footer={
        <>
          <PrintButton
            doc={{
              entity: 'product_costing', entityId: `${x.productId}-${period}`, number: `${x.productId.toUpperCase()}-${period}`, title: `${p('Калькуляция себестоимости продукта', 'Mahsulot tannarxi kalkulyatsiyasi', 'Product cost calculation')}: ${loc(x.name)}`,
              fields: [{ label: p('Период', 'Davr', 'Period'), value: period }, { label: p('Сегмент', 'Segment', 'Segment'), value: t(tk('seg_', x.segment)) }, { label: p('Остаток', 'Qoldiq', 'Balance'), value: formatMoney(x.balance) }, { label: p('Операций', 'Operatsiyalar', 'Operations'), value: formatNumber(x.operations) }],
              table: { columns: [{ header: p('Статья', 'Modda', 'Item') }, { header: p('Сумма', 'Summa', 'Amount'), align: 'right' }], rows: lines.map(([l, v]) => [l, formatMoney(v)]), totals: [p('Прибыль', 'Foyda', 'Profit'), formatMoney(x.profit)] },
            }}
          />
          <Button onClick={onClose}>{p('Закрыть', 'Yopish', 'Close')}</Button>
        </>
      }
    >
      <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
        {lines.map(([l, v]) => (
          <Fragment key={l}><dt>{l}</dt><dd className="num" style={{ color: v < 0 ? 'var(--danger)' : undefined }}>{short(v)}</dd></Fragment>
        ))}
        <dt><b>{p('Прибыль продукта', 'Mahsulot foydasi', 'Product profit')}</b></dt>
        <dd className="num"><b>{short(x.profit)}</b></dd>
        <dt>{p('Себестоимость на операцию', 'Operatsiya tannarxi', 'Cost per operation')}</dt>
        <dd className="num">{formatMoney(x.costPerOp)}</dd>
      </dl>
      <b>{p('Нормы времени (Time-based costing)', 'Vaqt me’yorlari (Time-based costing)', 'Time standards (time-based costing)')}</b>
      <DataTable
        rows={own}
        rowKey={(s) => loc(s.activity)}
        emptyText="—"
        columns={[
          { header: p('Вид работ', 'Ish turi', 'Activity'), render: (s) => loc(s.activity) },
          { header: p('Мин./опер.', 'Daq./oper.', 'Min/op'), align: 'right', render: (s) => formatDecimal(s.minutes, 2) },
          { header: p('Ставка, сум/ч', 'Stavka, so‘m/soat', 'Rate, UZS/h'), align: 'right', render: (s) => formatNumber(settings.data?.laborRates[s.staff] ?? 0) },
        ]}
      />
    </Modal>
  );
}

function BreakdownTab({ period }: { period: string }) {
  const { lang, t } = useSession();
  const p = usePick();
  const [by, setBy] = useState<'segment' | 'channel' | 'branch'>('segment');
  const rows = useApi(() => operationsCostingApi.breakdown(period, by), [period, by]);
  const short = (v: number) => formatMoneyShort(v, lang);
  const label = (k: string) => (by === 'segment' ? t(tk('seg_', k)) : by === 'channel' ? t(tk('channel_', k)) : k);
  return (
    <>
      <FilterBar>
        <Select<'segment' | 'channel' | 'branch'> value={by} onChange={setBy} ariaLabel={p('Разрез', 'Kesim', 'Breakdown')} options={[{ value: 'segment', label: p('По сегментам', 'Segmentlar bo‘yicha', 'By segment') }, { value: 'channel', label: p('По каналам продаж', 'Savdo kanallari bo‘yicha', 'By sales channel') }, { value: 'branch', label: p('По филиалам (профили ЦБУ)', 'Filiallar bo‘yicha (BXM profillari)', 'By branch (office profiles)') }]} />
        <span style={{ flex: 1 }} />
        <ExportButton<OpaBreakdownRow> filename={`costing-${by}-${period}`} rows={rows.data ?? []} columns={[{ header: p('Разрез', 'Kesim', 'Breakdown'), value: (r) => label(r.key) }, { header: p('Доход', 'Daromad', 'Revenue'), value: (r) => r.revenue, format: 'money', total: true }, { header: p('Прямые', 'To‘g‘ridan-to‘g‘ri', 'Direct'), value: (r) => r.direct, format: 'money', total: true }, { header: p('Косвенные', 'Bilvosita', 'Indirect'), value: (r) => r.indirect, format: 'money', total: true }, { header: 'EL', value: (r) => r.el, format: 'money', total: true }, { header: p('Прибыль', 'Foyda', 'Profit'), value: (r) => r.profit, format: 'money', total: true }]} />
      </FilterBar>
      {!rows.data ? <Loading /> : (
        <>
          <DataTable
            rows={rows.data}
            rowKey={(r) => r.key}
            columns={[
              { header: p('Разрез', 'Kesim', 'Breakdown'), render: (r) => <b>{label(r.key)}</b> },
              { header: p('Доход', 'Daromad', 'Revenue'), align: 'right', render: (r) => short(r.revenue) },
              { header: p('Прямые', 'To‘g‘ridan-to‘g‘ri', 'Direct'), align: 'right', render: (r) => short(r.direct) },
              { header: p('Косвенные', 'Bilvosita', 'Indirect'), align: 'right', render: (r) => short(r.indirect) },
              { header: 'EL', align: 'right', render: (r) => short(r.el) },
              { header: p('Прибыль', 'Foyda', 'Profit'), align: 'right', render: (r) => <b style={{ color: r.profit < 0 ? 'var(--danger)' : 'var(--ok)' }}>{short(r.profit)}</b> },
            ]}
          />
          <div style={{ padding: 18 }}>
            <BarChart data={rows.data.map((r) => ({ label: label(r.key).slice(0, 12), values: [r.revenue, r.direct + r.indirect + r.el] }))} series={[{ name: p('Доход', 'Daromad', 'Revenue') }, { name: p('Затраты', 'Xarajatlar', 'Costs'), color: 'var(--danger)' }]} format={short} />
          </div>
        </>
      )}
    </>
  );
}

function MarginTab({ period }: { period: string }) {
  const { lang, loc } = useSession();
  const p = usePick();
  const m = useApi(() => operationsCostingApi.margins(period), [period]);
  const tr = useApi(() => operationsCostingApi.treasuryByCostCenter(period), [period]);
  const short = (v: number) => formatMoneyShort(v, lang);
  const sum = (f: (r: OpaMarginRow) => number) => (m.data ?? []).reduce((s, r) => s + f(r), 0);
  const bookLabel = (b: string) => ({ uzs: p('Книга UZS (несовпадение сроков)', 'UZS kitobi (muddatlar nomuvofiqligi)', 'UZS book (maturity mismatch)'), fx: p('Валютная книга', 'Valyuta kitobi', 'FX book'), liquidity: p('Управление ликвидностью и опционами', 'Likvidlik va opsionlarni boshqarish', 'Liquidity and option management') })[b] ?? b;
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>{p('Годовые суммы. Коммерческая маржа — у бизнес-направлений; казначейская — несовпадение сроков относительно единой ставки пула; Liquidity Effect — надбавки за ликвидность; Optionality Effect — стоимость права досрочного погашения.', 'Yillik summalar. Tijorat marjasi — biznes yo‘nalishlarda; g‘aznachilik — pul stavkasiga nisbatan muddatlar nomuvofiqligi; Liquidity Effect — likvidlik ustamalari; Optionality Effect — muddatidan oldin to‘lash huquqi qiymati.', 'Annual amounts. Commercial margin stays with business lines; treasury margin is maturity mismatch versus the single pool rate; Liquidity Effect is liquidity premiums; Optionality Effect is the cost of the prepayment option.')}</span>
        <ExportButton<OpaMarginRow> filename={`transfer-margin-${period}`} rows={m.data ?? []} columns={[{ header: p('Продукт', 'Mahsulot', 'Product'), value: (r) => loc(r.name) }, { header: p('Остаток', 'Qoldiq', 'Balance'), value: (r) => r.balance, format: 'money' }, { header: p('Коммерческая', 'Tijorat', 'Commercial'), value: (r) => r.commercial, format: 'money', total: true }, { header: p('Казначейская', 'G‘aznachilik', 'Treasury'), value: (r) => r.treasury, format: 'money', total: true }, { header: 'Liquidity Effect', value: (r) => r.liquidity, format: 'money', total: true }, { header: 'Optionality Effect', value: (r) => r.optionality, format: 'money', total: true }, { header: p('Итого', 'Jami', 'Total'), value: (r) => r.total, format: 'money', total: true }]} />
      </FilterBar>
      {!m.data ? <Loading /> : (
        <>
          <div className="grid grid-4" style={{ padding: 18 }}>
            <Stat label={p('Коммерческая маржа', 'Tijorat marjasi', 'Commercial margin')} value={short(sum((r) => r.commercial))} tone="accent" />
            <Stat label={p('Казначейская маржа', 'G‘aznachilik marjasi', 'Treasury margin')} value={short(sum((r) => r.treasury))} />
            <Stat label="Liquidity Effect" value={short(sum((r) => r.liquidity))} />
            <Stat label="Optionality Effect" value={short(sum((r) => r.optionality))} />
          </div>
          <DataTable
            rows={m.data}
            rowKey={(r) => r.productId}
            columns={[
              { header: p('Продукт', 'Mahsulot', 'Product'), render: (r) => <>{loc(r.name)}<div className="sub">{r.currency} · {short(r.balance)}</div></> },
              { header: p('Коммерческая', 'Tijorat', 'Commercial'), align: 'right', render: (r) => short(r.commercial) },
              { header: p('Казначейская', 'G‘aznachilik', 'Treasury'), align: 'right', render: (r) => short(r.treasury) },
              { header: 'Liquidity', align: 'right', render: (r) => short(r.liquidity) },
              { header: 'Optionality', align: 'right', render: (r) => (r.optionality ? short(r.optionality) : '—') },
              { header: p('Итого', 'Jami', 'Total'), align: 'right', render: (r) => <b>{short(r.total)}</b> },
            ]}
          />
          <div style={{ padding: 18 }}>
            <Card title={p('Прибыль казначейства в разрезе МВЗ', 'MXJ kesimida g‘aznachilik foydasi', 'Treasury profit by cost centre')} flush>
              <DataTable
                rows={tr.data}
                loading={tr.loading}
                rowKey={(x) => x.book}
                columns={[
                  { header: p('МВЗ', 'MXJ', 'Cost centre'), render: (x) => <><b>{x.code}</b><div className="sub">{loc(x.name).split(' · ')[0]}</div></> },
                  { header: p('Книга', 'Kitob', 'Book'), render: (x) => bookLabel(x.book) },
                  { header: p('Прибыль, год', 'Foyda, yil', 'Profit, annual'), align: 'right', render: (x) => <b style={{ color: x.profit < 0 ? 'var(--danger)' : 'var(--ok)' }}>{short(x.profit)}</b> },
                ]}
              />
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function ElTab({ period }: { period: string }) {
  const { loc, lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useOpaErr();
  const lk = useLookups();
  const el = useApi(() => operationsCostingApi.listEl());
  const products = useApi(() => operationsCostingApi.listProducts());
  const costs = useApi(() => operationsCostingApi.compute(period), [period]);
  const [edit, setEdit] = useState<{ productId: string; pd: string; lgd: string; reason: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = can('operations', 'edit');
  const short = (v: number) => formatMoneyShort(v, lang);
  const name = (id: string) => { const x = products.data?.find((q) => q.id === id); return x ? loc(x.name) : id; };
  const target = importRegistry.get('operations_el');
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>{p('EL = PD × LGD × EAD. Показатели импортируются из системы риск-менеджмента / модуля МСФО 9 (через КХД) или вводятся вручную с фиксацией в журнале аудита.', 'EL = PD × LGD × EAD. Ko‘rsatkichlar risk-menejment tizimi / MHXS 9 modulidan (KXO orqali) import qilinadi yoki audit jurnaliga yozilgan holda qo‘lda kiritiladi.', 'EL = PD × LGD × EAD. Inputs are imported from the risk system / IFRS 9 module (via the DWH) or entered manually with an audit log entry.')}</span>
        {editable && (
          <>
            <Button size="small" icon="refresh" loading={busy} onClick={async () => { setBusy(true); try { const n = await operationsCostingApi.importEl('2026-09', user); toast(`${p('Импорт EL: изменено', 'EL importi: o‘zgartirildi', 'EL import: changed')} ${n}`); } catch (e) { toast(err(e)); } finally { setBusy(false); } }}>{p('Импорт из риск-менеджмента', 'Risk-menejmentdan import', 'Import from risk system')}</Button>
            {target && <Button size="small" icon="upload" onClick={() => setImporting(true)}>{p('Загрузить файл', 'Fayl yuklash', 'Upload file')}</Button>}
          </>
        )}
      </FilterBar>
      <DataTable
        rows={el.data}
        loading={el.loading}
        rowKey={(e) => e.productId}
        onRowClick={editable ? (e) => setEdit({ productId: e.productId, pd: String(e.pd), lgd: String(e.lgd), reason: '' }) : undefined}
        columns={[
          { header: p('Кредитный продукт', 'Kredit mahsuloti', 'Credit product'), render: (e) => name(e.productId) },
          { header: 'PD, %', align: 'right', render: (e) => formatDecimal(e.pd, 2) },
          { header: 'LGD, %', align: 'right', render: (e) => formatDecimal(e.lgd, 0) },
          { header: p('EL за квартал', 'Chorak uchun EL', 'EL per quarter'), align: 'right', render: (e) => short(costs.data?.products.find((x) => x.productId === e.productId)?.el ?? 0) },
          { header: p('Резерв', 'Zaxira', 'Provision'), align: 'right', render: (e) => short(e.reserve) },
          { header: p('Источник', 'Manba', 'Source'), render: (e) => <Badge tone={e.source === 'manual' ? 'warn' : 'info'}>{e.source === 'manual' ? p('Ручной ввод', 'Qo‘lda', 'Manual') : p('Импорт', 'Import', 'Import')}</Badge> },
          { header: p('Обновлено', 'Yangilangan', 'Updated'), render: (e) => <span className="small muted">{formatDateTime(e.updatedAt)} · {e.updatedBy === 'system' ? p('Система', 'Tizim', 'System') : lk.user(e.updatedBy)?.fullName}{e.reason ? ` · ${e.reason}` : ''}</span> },
        ]}
      />
      {edit && (
        <Modal
          title={`EL · ${name(edit.productId)}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await operationsCostingApi.setEl(edit.productId, Number(edit.pd.replace(',', '.')), Number(edit.lgd.replace(',', '.')), edit.reason, user); toast(p('EL сохранён, запись в журнале аудита', 'EL saqlandi, audit jurnaliga yozildi', 'EL saved and logged')); setEdit(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="PD, %"><Input value={edit.pd} inputMode="decimal" onChange={(e) => setEdit({ ...edit, pd: e.target.value })} ariaLabel="PD" /></Field>
            <Field label="LGD, %"><Input value={edit.lgd} inputMode="decimal" onChange={(e) => setEdit({ ...edit, lgd: e.target.value })} ariaLabel="LGD" /></Field>
            <Field label={p('Причина ручного ввода', 'Qo‘lda kiritish sababi', 'Reason for manual entry')} required className="span-2"><Input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} ariaLabel={p('Причина', 'Sabab', 'Reason')} /></Field>
          </div>
        </Modal>
      )}
      {importing && target && (
        <Modal title={p('Загрузка EL из файла', 'EL ni fayldan yuklash', 'Upload EL from file')} onClose={() => setImporting(false)} footer={<Button onClick={() => setImporting(false)}>{p('Закрыть', 'Yopish', 'Close')}</Button>}>
          <ImportWizard target={target} onDone={() => toast(p('Загрузка завершена', 'Yuklash yakunlandi', 'Upload complete'))} />
        </Modal>
      )}
    </>
  );
}

function MethodsTab() {
  const { loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useOpaErr();
  const lk = useLookups();
  const settings = useApi(() => operationsCostingApi.getSettings());
  const std = useApi(() => operationsCostingApi.listStandards());
  const products = useApi(() => operationsCostingApi.listProducts());
  const [rates, setRates] = useState<Record<OpaStaff, string> | null>(null);
  const [edit, setEdit] = useState<{ productId: string; index: number; minutes: string; label: string } | null>(null);
  const editable = can('operations', 'edit');
  const s = settings.data;
  if (!s) return <Loading />;
  const staffLabel = (k: OpaStaff) => ({ front: p('Фронт-офис', 'Front-ofis', 'Front office'), back: p('Бэк-офис', 'Bek-ofis', 'Back office'), credit: p('Кредитные специалисты', 'Kredit mutaxassislari', 'Credit officers'), it: p('ИТ-специалисты', 'AT mutaxassislari', 'IT specialists') })[k];
  const save = async (patch: Parameters<typeof operationsCostingApi.updateSettings>[0]) => { try { await operationsCostingApi.updateSettings(patch, user); toast(p('Настройки сохранены', 'Sozlamalar saqlandi', 'Settings saved')); } catch (e) { toast(err(e)); } };
  const cur = rates ?? (Object.fromEntries(Object.entries(s.laborRates).map(([k, v]) => [k, String(v)])) as Record<OpaStaff, string>);
  const idxOf = (productId: string, i: number) => (std.data ?? []).filter((x) => x.productId === productId).indexOf((std.data ?? [])[i]!);
  return (
    <div className="bud-split">
      <Card title={p('Методы формирования себестоимости', 'Tannarxni shakllantirish usullari', 'Costing methods')}>
        <Field label={p('База распределения косвенных расходов', 'Bilvosita xarajatlarni taqsimlash bazasi', 'Indirect cost allocation basis')}>
          <Select<OpaIndirectBasis> value={s.indirectBasis} disabled={!editable} onChange={(v) => save({ indirectBasis: v })} ariaLabel={p('База распределения', 'Taqsimlash bazasi', 'Allocation basis')} options={[{ value: 'balance', label: p('Остатки продуктов', 'Mahsulot qoldiqlari', 'Product balances') }, { value: 'operations', label: p('Количество операций', 'Operatsiyalar soni', 'Number of operations') }, { value: 'time', label: p('Затраты времени (ABC)', 'Vaqt sarfi (ABC)', 'Time spent (ABC)') }]} />
        </Field>
        <Field label={p('Прямые расходы', 'To‘g‘ridan-to‘g‘ri xarajatlar', 'Direct costs')}>
          <Select<'standard' | 'timesheet'> value={s.directMethod} disabled={!editable} onChange={(v) => save({ directMethod: v })} ariaLabel={p('Метод прямых расходов', 'To‘g‘ridan-to‘g‘ri xarajatlar usuli', 'Direct cost method')} options={[{ value: 'standard', label: p('Нормы времени', 'Vaqt me’yorlari', 'Time standards') }, { value: 'timesheet', label: p('Фактические табели (ACMS)', 'Haqiqiy tabellar (ACMS)', 'Actual timesheets (ACMS)') }]} />
        </Field>
        <div style={{ fontWeight: 600, margin: '8px 0' }}>{p('Стоимость часа труда, сум', 'Mehnat soati qiymati, so‘m', 'Labour cost per hour, UZS')}</div>
        <div className="bud-art-grid">
          {(Object.keys(s.laborRates) as OpaStaff[]).map((k) => (
            <label key={k} className="small">{staffLabel(k)}<Input value={cur[k]} inputMode="numeric" disabled={!editable} onChange={(e) => setRates({ ...cur, [k]: e.target.value })} ariaLabel={staffLabel(k)} /></label>
          ))}
        </div>
        {editable && rates && <Button type="primary" style={{ marginTop: 10 }} onClick={() => { void save({ laborRates: Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Number(v)])) as Record<OpaStaff, number> }); setRates(null); }}>{p('Сохранить ставки', 'Stavkalarni saqlash', 'Save rates')}</Button>}
        <div className="muted small" style={{ marginTop: 8 }}>{p('Изменено', 'O‘zgartirilgan', 'Updated')}: {formatDateTime(s.updatedAt)} · {s.updatedBy === 'system' ? '—' : lk.user(s.updatedBy)?.fullName}</div>
      </Card>
      <Card title={p('Нормы времени по продуктам', 'Mahsulotlar bo‘yicha vaqt me’yorlari', 'Time standards by product')} flush>
        <DataTable
          rows={(std.data ?? []).map((x, i) => ({ ...x, i }))}
          rowKey={(x) => `${x.productId}-${x.i}`}
          onRowClick={editable ? (x) => setEdit({ productId: x.productId, index: idxOf(x.productId, x.i), minutes: String(x.minutes), label: loc(x.activity) }) : undefined}
          columns={[
            { header: p('Продукт', 'Mahsulot', 'Product'), render: (x) => { const pr = products.data?.find((q) => q.id === x.productId); return pr ? loc(pr.name) : x.productId; } },
            { header: p('Вид работ', 'Ish turi', 'Activity'), render: (x) => <>{loc(x.activity)}<div className="sub">{staffLabel(x.staff)}</div></> },
            { header: p('Мин./опер.', 'Daq./oper.', 'Min/op'), align: 'right', render: (x) => formatDecimal(x.minutes, 2) },
          ]}
        />
      </Card>
      {edit && (
        <Modal
          title={edit.label}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await operationsCostingApi.updateStandard(edit.productId, edit.index, Number(edit.minutes.replace(',', '.')), user); toast(p('Норма сохранена', 'Me’yor saqlandi', 'Standard saved')); setEdit(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <Field label={p('Минут на операцию', 'Operatsiyaga daqiqa', 'Minutes per operation')}><Input value={edit.minutes} inputMode="decimal" onChange={(e) => setEdit({ ...edit, minutes: e.target.value })} ariaLabel={p('Минут на операцию', 'Operatsiyaga daqiqa', 'Minutes per operation')} /></Field>
        </Modal>
      )}
    </div>
  );
}

/** Админ-панель FTP для бизнес-пользователей: сроки кривых, надбавки за ликвидность и риск (правила), методология. */
function FtpAdminTab() {
  const { loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErrText();
  const lp = useApi(() => ftpApi.listLp());
  const rules = useApi(() => ftpApi.listRules());
  const meth = useApi(() => ftpApi.listMethodologies());
  const curves = useApi(() => ftpApi.listCurves());
  const [lpEdit, setLpEdit] = useState<{ label: string; bp: string } | null>(null);
  const editable = can('ftp', 'edit');
  const applied = meth.data?.find((m) => m.id === ftpApi.appliedMethodologyId());
  return (
    <div className="bud-split">
      <Card title={p('Методология и кривые', 'Metodologiya va egri chiziqlar', 'Methodology and curves')} actions={<Button size="small" onClick={() => navigate('/ftp?tab=methodology')}>{p('Открыть в FTP', 'FTP da ochish', 'Open in FTP')}</Button>}>
        <div className="small">{p('Применяемая методология', 'Qo‘llanadigan metodologiya', 'Applied methodology')}: <b>{applied ? `${applied.code} · ${loc(applied.name)}` : '—'}</b></div>
        <div className="small muted" style={{ marginTop: 6 }}>Matched Maturity: {p('ставка по кривой доходности исходя из срока каждого ресурса/актива', 'har bir resurs/aktiv muddatidan kelib chiqib daromadlilik egri chizig‘i bo‘yicha stavka', 'rate from the yield curve by the tenor of each resource/asset')}</div>
        <div style={{ fontWeight: 600, marginTop: 10 }}>{p('Мультивалютные кривые', 'Ko‘p valyutali egri chiziqlar', 'Multi-currency curves')}</div>
        <DataTable rows={curves.data} rowKey={(c) => c.currency} columns={[{ header: p('Валюта', 'Valyuta', 'Currency'), render: (c) => <b>{c.currency}</b> }, { header: p('Сроки', 'Muddatlar', 'Tenors'), render: (c) => <span className="small">{c.points.map((x) => x.label).join(' · ')}</span> }, { header: p('Версия', 'Versiya', 'Version'), render: (c) => `v${c.version} · ${c.interpolation}` }]} />
      </Card>
      <Card title={p('Надбавки за риск ликвидности (Liquidity Premium)', 'Likvidlik riski ustamalari (Liquidity Premium)', 'Liquidity risk premiums (LP)')} flush>
        <DataTable
          rows={lp.data}
          rowKey={(x) => x.label}
          columns={[
            { header: p('Срок', 'Muddat', 'Tenor'), render: (x) => x.label },
            { header: p('Надбавка, б.п.', 'Ustama, b.p.', 'Premium, bp'), align: 'right', render: (x) => (editable ? <span className="bud-editable" onClick={() => setLpEdit({ label: x.label, bp: String(x.bp) })}>{x.bp}</span> : x.bp) },
          ]}
        />
      </Card>
      <Card title={p('Рисковые надбавки и корректировки (правила)', 'Risk ustamalari va tuzatishlar (qoidalar)', 'Risk premiums and adjustments (rules)')} flush>
        <DataTable
          rows={rules.data}
          rowKey={(r) => r.id}
          columns={[
            { header: p('Правило', 'Qoida', 'Rule'), render: (r) => r.name },
            { header: p('Значение', 'Qiymat', 'Value'), align: 'right', render: (r) => (r.kind === 'adjust' ? `${r.value > 0 ? '+' : ''}${r.value} ${p('б.п.', 'b.p.', 'bp')}` : `${r.value}%`) },
            { header: p('Активно', 'Faol', 'Active'), render: (r) => <Switch checked={r.active} disabled={!editable} ariaLabel={r.name} onChange={async (v) => { try { const { id, createdBy: _c, updatedAt: _u, ...rest } = r; void _c; void _u; await ftpApi.saveRule({ ...rest, id, active: v }, user); toast(p('Правило обновлено', 'Qoida yangilandi', 'Rule updated')); } catch (e) { toast(err(e)); } }} /> },
          ]}
        />
      </Card>
      {lpEdit && (
        <Modal
          title={`LP · ${lpEdit.label}`}
          onClose={() => setLpEdit(null)}
          footer={
            <>
              <Button onClick={() => setLpEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await ftpApi.updateLp(lpEdit.label, Number(lpEdit.bp), user); toast(p('Надбавка сохранена', 'Ustama saqlandi', 'Premium saved')); setLpEdit(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <Field label={p('Надбавка, б.п.', 'Ustama, b.p.', 'Premium, bp')}><Input value={lpEdit.bp} inputMode="numeric" onChange={(e) => setLpEdit({ ...lpEdit, bp: e.target.value })} ariaLabel="LP bp" /></Field>
        </Modal>
      )}
      {!editable && <Empty text={p('Изменять ставки и надбавки может казначейство и финансовый департамент', 'Stavka va ustamalarni g‘aznachilik va moliya departamenti o‘zgartiradi', 'Rates and premiums are managed by treasury and finance')} icon="key" />}
    </div>
  );
}

function StructureTab() {
  const { loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useOpaErr();
  const profiles = useApi(() => operationsCostingApi.listProfiles());
  const units = useApi(() => orgApi.listAllOrgUnitVersions());
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ orgUnitKey: string; tariff: 'urban' | 'standard' | 'rural'; laborFactor: string; rentPerSqm: string } | null>(null);
  const editable = can('operations', 'edit');
  const name = (key: string) => { const u = (units.data ?? []).filter((x) => x.key === key).sort((a, b) => b.version - a.version)[0]; return u ? loc(u.name) : key; };
  const rows = (profiles.data ?? []).filter((x) => !q || x.orgUnitKey.toLowerCase().includes(q.toLowerCase()) || name(x.orgUnitKey).toLowerCase().includes(q.toLowerCase()));
  const tariffLabel = (t: string) => ({ urban: p('Городской', 'Shahar', 'Urban'), standard: p('Стандартный', 'Standart', 'Standard'), rural: p('Сельский', 'Qishloq', 'Rural') })[t] ?? t;
  return (
    <>
      <FilterBar>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={p('Поиск ЦБУ', 'BXM qidirish', 'Search office')} ariaLabel={p('Поиск ЦБУ', 'BXM qidirish', 'Search office')} style={{ width: 220 }} />
        <span className="muted small" style={{ flex: 1 }}>{p('Новым ЦБУ/филиалам автоматически назначаются действующие тарифы региона; при реорганизации версии профиля сохраняют историю (действует с / по).', 'Yangi BXM/filiallarga mintaqaning amaldagi tariflari avtomatik beriladi; qayta tashkil etishda profil versiyalari tarixni saqlaydi.', 'New offices/branches get the region’s current tariffs automatically; on reorganisation profile versions keep history (valid from / to).')}</span>
        {editable && <Button type="primary" size="small" icon="refresh" onClick={async () => { try { const c = await operationsCostingApi.scanStructure(user); toast(c.length ? `${p('Созданы профили', 'Profillar yaratildi', 'Profiles created')}: ${c.map((x) => x.orgUnitKey).join(', ')}` : p('Все ЦБУ имеют профили расходов', 'Barcha BXMlarda xarajat profillari bor', 'All offices have cost profiles')); } catch (e) { toast(err(e)); } }}>{p('Проверить структуру', 'Tuzilmani tekshirish', 'Check structure')}</Button>}
      </FilterBar>
      <DataTable
        rows={rows}
        loading={profiles.loading}
        rowKey={(x) => x.id}
        onRowClick={editable ? (x) => (x.validTo === null ? setEdit({ orgUnitKey: x.orgUnitKey, tariff: x.tariff, laborFactor: String(x.laborFactor), rentPerSqm: String(x.rentPerSqm) }) : undefined) : undefined}
        columns={[
          { header: p('ЦБУ', 'BXM', 'Office'), render: (x) => <>{name(x.orgUnitKey)}<div className="sub">{x.orgUnitKey} · {p('регион', 'mintaqa', 'region')} {x.regionCode}</div></> },
          { header: p('Тариф', 'Tarif', 'Tariff'), render: (x) => tariffLabel(x.tariff) },
          { header: p('Коэфф. труда', 'Mehnat koeff.', 'Labour factor'), align: 'right', render: (x) => formatDecimal(x.laborFactor, 2) },
          { header: p('Аренда, сум/м²', 'Ijara, so‘m/m²', 'Rent, UZS/m²'), align: 'right', render: (x) => formatNumber(x.rentPerSqm) },
          { header: p('Действует', 'Amal qiladi', 'Valid'), render: (x) => <span className="small">{x.validFrom} — {x.validTo ?? '…'}</span> },
          { header: '', render: (x) => (x.auto ? <Badge tone="info">{p('Авто', 'Avto', 'Auto')}</Badge> : x.validTo ? <Badge tone="muted">{p('История', 'Tarix', 'History')}</Badge> : null) },
          { header: p('Основание', 'Asos', 'Note'), render: (x) => <span className="small muted">{x.note}</span> },
        ]}
      />
      {edit && (
        <Modal
          title={name(edit.orgUnitKey)}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await operationsCostingApi.updateProfile(edit.orgUnitKey, { tariff: edit.tariff, laborFactor: Number(edit.laborFactor.replace(',', '.')), rentPerSqm: Number(edit.rentPerSqm) }, user); toast(p('Новая версия профиля с сегодняшнего дня', 'Bugundan profilning yangi versiyasi', 'New profile version from today')); setEdit(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={p('Тариф', 'Tarif', 'Tariff')}><Select<'urban' | 'standard' | 'rural'> value={edit.tariff} onChange={(v) => setEdit({ ...edit, tariff: v })} options={(['urban', 'standard', 'rural'] as const).map((v) => ({ value: v, label: tariffLabel(v) }))} ariaLabel={p('Тариф', 'Tarif', 'Tariff')} /></Field>
            <Field label={p('Коэффициент стоимости труда', 'Mehnat qiymati koeffitsienti', 'Labour cost factor')}><Input value={edit.laborFactor} inputMode="decimal" onChange={(e) => setEdit({ ...edit, laborFactor: e.target.value })} ariaLabel="factor" /></Field>
            <Field label={p('Аренда, сум/м²', 'Ijara, so‘m/m²', 'Rent, UZS/m²')} className="span-2"><Input value={edit.rentPerSqm} inputMode="numeric" onChange={(e) => setEdit({ ...edit, rentPerSqm: e.target.value })} ariaLabel="rent" /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
