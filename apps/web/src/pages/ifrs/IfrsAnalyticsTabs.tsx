// МСФО: Adjustments Engine (ОС, МСФО 16), движение ОС, денежные потоки, KPI, план-факт/ZBB, красные флажки (ТЗ 4.2.18 В–Г).
import { useState } from 'react';
import { formatDecimal, formatMoney, formatNumber, ifrsAnalyticsApi, tk, type IfrsBudgetItem, type IfrsBudgetView, type IfrsLeaseCalc } from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Drawer, Field, Input, LineChart, Modal, Select, Stat, Switch, Textarea } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useP } from '../taxes/common';
import { useEntityName, useIfrsRun } from './IfrsSubsTabs';

const mln = (v: number) => formatNumber(Math.round(v / 1e6));

export function AutoAdjTab() {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const can = useCan()('ifrs', 'edit');
  const ename = useEntityName();
  const fa = useApi(() => ifrsAnalyticsApi.listFaClasses());
  const leases = useApi(() => ifrsAnalyticsApi.listLeases16());
  const { busy, run } = useIfrsRun();
  const [sched, setSched] = useState<IfrsLeaseCalc | null>(null);
  const [edit, setEdit] = useState<{ id: string; life: string; fv: string } | null>(null);
  const [nl, setNl] = useState({ entityId: 'e2', name: '', monthlyPayment: '', termMonths: '36', discountRate: '22', startDate: '2026-10-01' });
  const entities = [...new Set((fa.data ?? []).map((c) => c.cls.entityId))];
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      <Card title={p('Амортизация и переоценка ОС по МСФО (МСФО 16 / МСФО (IAS) 16)', "MHXS bo'yicha AV amortizatsiyasi va qayta baholash (IAS 16)", 'IFRS depreciation and revaluation of fixed assets (IAS 16)')} flush actions={can ? <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{entities.map((e) => <Button key={e} size="small" disabled={busy} onClick={() => run(() => ifrsAnalyticsApi.applyFaAdjustment(e, user), `${ename(e)}: ${p('корректировка ОС сформирована', 'AV tuzatishi shakllantirildi', 'FA adjustment generated')}`)}>{p('Рассчитать', 'Hisoblash', 'Compute')}: {ename(e)}</Button>)}</span> : null}>
        <DataTable rows={fa.data} loading={fa.loading} rowKey={(c) => c.cls.id} columns={[
          { header: p('Класс ОС', 'AV sinfi', 'Asset class'), render: (c) => <><b>{loc(c.cls.name)}</b><div className="sub">{ename(c.cls.entityId)}</div></> },
          { header: p('Стоимость', 'Qiymat', 'Cost'), align: 'right', render: (c) => mln(c.cls.cost + c.cls.additions - c.cls.disposals) },
          { header: p('Срок НСБУ / МСФО, лет', 'MBHS / MHXS muddati, yil', 'Life NAS / IFRS, yrs'), align: 'right', render: (c) => `${c.cls.nsbuLifeYears} / ${c.cls.ifrsLifeYears}` },
          { header: p('Аморт. НСБУ', 'Amort. MBHS', 'Dep. NAS'), align: 'right', render: (c) => mln(c.nsbuDep) },
          { header: p('Аморт. МСФО', 'Amort. MHXS', 'Dep. IFRS'), align: 'right', render: (c) => mln(c.ifrsDep) },
          { header: p('Разница', 'Farq', 'Difference'), align: 'right', render: (c) => <b>{mln(c.depDiff)}</b> },
          { header: p('Справедливая ст-ть', 'Adolatli qiymat', 'Fair value'), align: 'right', render: (c) => (c.cls.fairValue !== undefined ? mln(c.cls.fairValue) : '—') },
          { header: p('Переоценка', 'Qayta baholash', 'Revaluation'), align: 'right', render: (c) => (c.revaluation ? mln(c.revaluation) : '—') },
          { header: '', render: (c) => (can ? <Button size="small" onClick={() => setEdit({ id: c.cls.id, life: String(c.cls.ifrsLifeYears), fv: c.cls.fairValue !== undefined ? String(c.cls.fairValue) : '' })}>{p('Политика', 'Siyosat', 'Policy')}</Button> : null) },
        ]} />
        <div className="muted small" style={{ padding: '8px 14px' }}>{p('Суммы — млн; корректировка: ОС −Δамортизации + переоценка, OPEX +Δамортизации, резерв переоценки в капитале.', 'Summalar — mln; tuzatish: AV −Δamortizatsiya + qayta baholash, OPEX +Δamortizatsiya, qayta baholash zaxirasi kapitalda.', 'Amounts in millions; adjustment: FA −Δdepreciation + revaluation, OPEX +Δdepreciation, revaluation reserve in equity.')}</div>
      </Card>
      <Card title={p('Аренда по МСФО 16: право пользования и обязательство', "MHXS 16 bo'yicha ijara: foydalanish huquqi va majburiyat", 'IFRS 16 leases: right-of-use asset and liability')} flush>
        {can && (
          <div className="toolbar" style={{ padding: 12, gap: 8, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <Select<string> value={nl.entityId} onChange={(v) => setNl({ ...nl, entityId: v })} options={['e0', 'e1', 'e2', 'e3', 'e4'].map((e) => ({ value: e, label: ename(e) }))} ariaLabel={p('Предприятие', 'Korxona', 'Entity')} />
            <Input value={nl.name} placeholder={p('Договор', 'Shartnoma', 'Contract')} onChange={(e) => setNl({ ...nl, name: e.target.value })} style={{ width: 180 }} />
            <Input value={nl.monthlyPayment} inputMode="numeric" placeholder={p('Платёж в месяц', "Oylik to'lov", 'Monthly payment')} onChange={(e) => setNl({ ...nl, monthlyPayment: e.target.value })} style={{ width: 150 }} />
            <Input value={nl.termMonths} inputMode="numeric" ariaLabel={p('Срок, мес.', 'Muddat, oy', 'Term, months')} onChange={(e) => setNl({ ...nl, termMonths: e.target.value })} style={{ width: 70 }} />
            <Input value={nl.discountRate} inputMode="decimal" ariaLabel={p('Ставка, %', 'Stavka, %', 'Rate, %')} onChange={(e) => setNl({ ...nl, discountRate: e.target.value })} style={{ width: 70 }} />
            <Input type="date" value={nl.startDate} onChange={(e) => setNl({ ...nl, startDate: e.target.value })} ariaLabel={p('Начало', 'Boshlanish', 'Start')} />
            <Button size="small" disabled={busy} onClick={async () => { if (await run(() => ifrsAnalyticsApi.addLease16({ entityId: nl.entityId, name: nl.name, monthlyPayment: Number(nl.monthlyPayment.replace(/\s/g, '')), termMonths: Number(nl.termMonths), discountRate: Number(nl.discountRate.replace(',', '.')), startDate: nl.startDate }, user), p('Договор добавлен', "Shartnoma qo'shildi", 'Lease added'))) setNl({ ...nl, name: '', monthlyPayment: '' }); }}>{p('Добавить договор', "Shartnoma qo'shish", 'Add lease')}</Button>
          </div>
        )}
        <DataTable rows={leases.data} loading={leases.loading} rowKey={(c) => c.lease.id} columns={[
          { header: p('Договор', 'Shartnoma', 'Contract'), render: (c) => <><b>{loc(c.lease.name)}</b><div className="sub">{ename(c.lease.entityId)} · {c.lease.startDate} · {c.lease.termMonths} {p('мес.', 'oy', 'mo')} · {c.lease.discountRate}%</div></> },
          { header: p('PV платежей', "To'lovlar PV", 'PV of payments'), align: 'right', render: (c) => mln(c.pv) },
          { header: p('Право пользования', 'Foydalanish huquqi', 'Right-of-use'), align: 'right', render: (c) => mln(c.rou) },
          { header: p('Обязательство', 'Majburiyat', 'Liability'), align: 'right', render: (c) => mln(c.liability) },
          { header: p('Проценты / аморт. (год)', 'Foizlar / amort. (yil)', 'Interest / dep. (YTD)'), align: 'right', render: (c) => `${mln(c.interestYtd)} / ${mln(c.depreciationYtd)}` },
          { header: '', render: (c) => <span style={{ display: 'flex', gap: 6 }}><Button size="small" onClick={() => setSched(c)}>{p('График', 'Jadval', 'Schedule')}</Button>{can && <Button size="small" type="primary" disabled={busy} onClick={() => run(() => ifrsAnalyticsApi.applyLease16(c.lease.id, user), p('Корректировка МСФО 16 сформирована', 'MHXS 16 tuzatishi shakllantirildi', 'IFRS 16 adjustment generated'))}>{p('Провести', "O'tkazish", 'Post')}</Button>}</span> },
        ]} />
      </Card>
      {sched && (
        <Drawer open width={760} title={`${p('График МСФО 16', 'MHXS 16 jadvali', 'IFRS 16 schedule')}: ${loc(sched.lease.name)}`} onClose={() => setSched(null)}>
          <DataTable rows={sched.schedule} rowKey={(r) => String(r.month)} columns={[
            { header: '№', render: (r) => <span style={{ fontWeight: r.month <= sched.elapsed ? 700 : 400 }}>{r.month}</span> },
            { header: p('Месяц', 'Oy', 'Month'), render: (r) => r.date },
            { header: p('Платёж', "To'lov", 'Payment'), align: 'right', render: (r) => mln(r.payment) },
            { header: p('Проценты', 'Foizlar', 'Interest'), align: 'right', render: (r) => mln(r.interest) },
            { header: p('Основной долг', 'Asosiy qarz', 'Principal'), align: 'right', render: (r) => mln(r.principal) },
            { header: p('Обязательство', 'Majburiyat', 'Liability'), align: 'right', render: (r) => mln(r.liability) },
            { header: p('Право польз.', 'Foyd. huquqi', 'ROU'), align: 'right', render: (r) => mln(r.rou) },
          ]} />
        </Drawer>
      )}
      {edit && (
        <Modal title={p('Учётная политика МСФО по классу ОС', "AV sinfi bo'yicha MHXS hisob siyosati", 'IFRS policy for the asset class')} onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => ifrsAnalyticsApi.updateFaClass(edit.id, { ifrsLifeYears: Number(edit.life), ...(edit.fv ? { fairValue: Number(edit.fv.replace(/\s/g, '')) } : {}) }, user), p('Политика сохранена', 'Siyosat saqlandi', 'Policy saved'))) setEdit(null); }}>{p('Сохранить', 'Saqlash', 'Save')}</Button></>}>
          <div className="form-grid">
            <Field label={p('Срок полезного использования МСФО, лет', 'MHXS foydali xizmat muddati, yil', 'IFRS useful life, years')} required><Input value={edit.life} inputMode="numeric" onChange={(e) => setEdit({ ...edit, life: e.target.value })} /></Field>
            <Field label={p('Справедливая стоимость (переоценка)', 'Adolatli qiymat (qayta baholash)', 'Fair value (revaluation)')}><Input value={edit.fv} inputMode="numeric" onChange={(e) => setEdit({ ...edit, fv: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

const CAT: Record<string, [string, string, string]> = { leased: ['Арендованные (право пользования)', 'Ijaradagi (foydalanish huquqi)', 'Leased (right-of-use)'], computers: ['Компьютеры', 'Kompyuterlar', 'Computers'], atm: ['Банкоматы', 'Bankomatlar', 'ATMs'], furniture: ['Мебель', 'Mebel', 'Furniture'], vehicles: ['Транспорт', 'Transport', 'Vehicles'], buildings: ['Здания', 'Binolar', 'Buildings'], security: ['Охранные системы', 'Xavfsizlik tizimlari', 'Security systems'] };

export function FaMoveTab() {
  const p = useP();
  const ename = useEntityName();
  const rows = useApi(() => ifrsAnalyticsApi.faMovement());
  const label = (g: string) => (CAT[g] ? p(...CAT[g]!) : g);
  const tot = (k: 'openCost' | 'additions' | 'disposals' | 'closeCost' | 'depNsbu' | 'depIfrs' | 'carryingNsbu' | 'carryingIfrs') => (rows.data ?? []).reduce((s, r) => s + r[k], 0);
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
        <span className="muted small">{p('Отчёт о движении ОС за 9 месяцев 2026: банк — по карточкам модуля ОС, дочерние — по классам ОС пакетов; амортизация по НСБУ и по МСФО.', "2026 yil 9 oy uchun AV harakati hisoboti: bank — AV moduli kartochkalari, sho'ba korxonalar — paketlardagi AV sinflari; MBHS va MHXS amortizatsiyasi.", 'Fixed-asset movement for 9M 2026: bank — asset-module cards, subsidiaries — asset classes; NAS and IFRS depreciation.')}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <ExportButton filename="ifrs-fixed-asset-movement" rows={rows.data ?? []} columns={[
            { header: p('Предприятие', 'Korxona', 'Entity'), value: (r) => ename(r.entityId) }, { header: p('Группа', 'Guruh', 'Group'), value: (r) => label(r.group) },
            { header: p('На 01.01', '01.01 holatiga', 'Opening'), value: (r) => r.openCost, format: 'money', total: true }, { header: p('Поступило', 'Kirim', 'Additions'), value: (r) => r.additions, format: 'money', total: true },
            { header: p('Выбыло', 'Chiqim', 'Disposals'), value: (r) => r.disposals, format: 'money', total: true }, { header: p('На 30.09', '30.09 holatiga', 'Closing'), value: (r) => r.closeCost, format: 'money', total: true },
            { header: p('Аморт. НСБУ', 'Amort. MBHS', 'Dep. NAS'), value: (r) => r.depNsbu, format: 'money', total: true }, { header: p('Аморт. МСФО', 'Amort. MHXS', 'Dep. IFRS'), value: (r) => r.depIfrs, format: 'money', total: true },
            { header: p('Остаточная НСБУ', 'Qoldiq MBHS', 'Carrying NAS'), value: (r) => r.carryingNsbu, format: 'money', total: true }, { header: p('Остаточная МСФО', 'Qoldiq MHXS', 'Carrying IFRS'), value: (r) => r.carryingIfrs, format: 'money', total: true },
          ]} />
          <PrintButton template="registry" label={p('Печать', 'Chop', 'Print')} doc={() => ({ entity: 'ifrs_fa_movement', entityId: '2026-09', title: p('Отчёт о движении основных средств (НСБУ / МСФО)', 'Asosiy vositalar harakati hisoboti (MBHS / MHXS)', 'Fixed asset movement report (NAS / IFRS)'), date: '2026-09-30', landscape: true, table: { columns: [{ header: p('Предприятие', 'Korxona', 'Entity') }, { header: p('Группа', 'Guruh', 'Group') }, { header: '01.01', align: 'right' }, { header: '+', align: 'right' }, { header: '−', align: 'right' }, { header: '30.09', align: 'right' }, { header: p('Аморт. НСБУ', 'Amort. MBHS', 'Dep. NAS'), align: 'right' }, { header: p('Аморт. МСФО', 'Amort. MHXS', 'Dep. IFRS'), align: 'right' }], rows: (rows.data ?? []).map((r) => [ename(r.entityId), label(r.group), mln(r.openCost), mln(r.additions), mln(r.disposals), mln(r.closeCost), mln(r.depNsbu), mln(r.depIfrs)]), totals: ['', '', mln(tot('openCost')), mln(tot('additions')), mln(tot('disposals')), mln(tot('closeCost')), mln(tot('depNsbu')), mln(tot('depIfrs'))] } })} />
        </span>
      </div>
      <DataTable rows={rows.data} loading={rows.loading} rowKey={(r) => `${r.entityId}-${r.group}`} columns={[
        { header: p('Предприятие', 'Korxona', 'Entity'), render: (r) => ename(r.entityId) },
        { header: p('Группа ОС', 'AV guruhi', 'Asset group'), render: (r) => label(r.group) },
        { header: p('На 01.01', '01.01 holatiga', 'Opening'), align: 'right', render: (r) => mln(r.openCost) },
        { header: p('Поступило', 'Kirim', 'Additions'), align: 'right', render: (r) => mln(r.additions) },
        { header: p('Выбыло', 'Chiqim', 'Disposals'), align: 'right', render: (r) => mln(r.disposals) },
        { header: p('На 30.09', '30.09 holatiga', 'Closing'), align: 'right', render: (r) => mln(r.closeCost) },
        { header: p('Аморт. НСБУ / МСФО', 'Amort. MBHS / MHXS', 'Dep. NAS / IFRS'), align: 'right', render: (r) => `${mln(r.depNsbu)} / ${mln(r.depIfrs)}` },
        { header: p('Остаточная НСБУ / МСФО', 'Qoldiq MBHS / MHXS', 'Carrying NAS / IFRS'), align: 'right', render: (r) => `${mln(r.carryingNsbu)} / ${mln(r.carryingIfrs)}` },
      ]} />
    </>
  );
}

export function CashFlowTab() {
  const p = useP();
  const { loc } = useSession();
  const ename = useEntityName();
  const [scope, setScope] = useState<string>('group');
  const cf = useApi(() => ifrsAnalyticsApi.cashFlow(scope), [scope]);
  const c = cf.data;
  const SECTION = { operating: p('Операционная деятельность', 'Operatsion faoliyat', 'Operating activities'), investing: p('Инвестиционная деятельность', 'Investitsiya faoliyati', 'Investing activities'), financing: p('Финансовая деятельность', 'Moliyaviy faoliyat', 'Financing activities') };
  return (
    <div style={{ padding: 14, display: 'grid', gap: 14 }}>
      <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Select<string> value={scope} onChange={setScope} options={[{ value: 'group', label: p('Группа (консолидировано)', 'Guruh (konsolidatsiyalangan)', 'Group (consolidated)') }, ...['e0', 'e1', 'e2', 'e3', 'e4'].map((e) => ({ value: e, label: ename(e) }))]} ariaLabel={p('Разрез', 'Kesim', 'Scope')} />
        {c && <Badge tone={Math.abs(c.check) < 1000 ? 'ok' : 'danger'}>{Math.abs(c.check) < 1000 ? p('ДДС сходится с изменением денежных средств ✓', "PHO pul mablag'lari o'zgarishi bilan mos ✓", 'Cash flow ties to the change in cash ✓') : `${p('Расхождение', 'Farq', 'Difference')} ${formatMoney(c.check)}`}</Badge>}
        {c && <span style={{ marginLeft: 'auto' }}><ExportButton filename={`ifrs-cash-flow-${scope}`} sheets={() => [{ name: 'Indirect', columns: [{ header: p('Раздел', "Bo'lim", 'Section') }, { header: p('Статья', 'Modda', 'Item') }, { header: p('Сумма', 'Summa', 'Amount'), format: 'money', total: true }], rows: c.indirect.map((x) => [SECTION[x.section], loc(x.label), x.amount]) }, { name: 'Direct', columns: [{ header: p('Статья', 'Modda', 'Item') }, { header: p('Сумма', 'Summa', 'Amount'), format: 'money', total: true }], rows: c.direct.map((x) => [loc(x.label), x.amount]) }]} /></span>}
      </div>
      {c && (
        <>
          <div className="grid grid-4">
            <Stat label={p('Денежные средства на 01.01', "01.01 holatiga pul mablag'lari", 'Cash at 1 Jan')} value={mln(c.opening)} icon="wallet" />
            <Stat label={SECTION.operating} value={mln(c.operating)} icon="chart" tone="accent" />
            <Stat label={`${SECTION.investing} / ${SECTION.financing}`} value={`${mln(c.investing)} / ${mln(c.financing)}`} icon="pie" />
            <Stat label={p('Денежные средства на 30.09', "30.09 holatiga pul mablag'lari", 'Cash at 30 Sep')} value={mln(c.closing)} icon="wallet" />
          </div>
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <Card title={p('Косвенный метод, млн', "Bilvosita usul, mln", 'Indirect method, mln')} flush>
              <DataTable rows={c.indirect} rowKey={(x) => x.key} columns={[{ header: p('Раздел', "Bo'lim", 'Section'), render: (x) => <span className="small muted">{SECTION[x.section]}</span> }, { header: p('Статья', 'Modda', 'Item'), render: (x) => loc(x.label) }, { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (x) => mln(x.amount) }]} />
            </Card>
            <Card title={p('Прямой метод (операционная деятельность), млн', "To'g'ridan-to'g'ri usul (operatsion faoliyat), mln", 'Direct method (operating), mln')} flush>
              <DataTable rows={[...c.direct, { key: 'total', label: { ru: 'Итого операционная деятельность', uz: 'Jami operatsion faoliyat', en: 'Total operating' }, amount: c.direct.reduce((s, x) => s + x.amount, 0) }]} rowKey={(x) => x.key} columns={[{ header: p('Статья', 'Modda', 'Item'), render: (x) => (x.key === 'total' ? <b>{loc(x.label)}</b> : loc(x.label)) }, { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (x) => (x.key === 'total' ? <b>{mln(x.amount)}</b> : mln(x.amount)) }]} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export function KpiTab() {
  const p = useP();
  const ename = useEntityName();
  const kpis = useApi(() => ifrsAnalyticsApi.kpis());
  const [scope, setScope] = useState('group');
  const trend = useApi(() => ifrsAnalyticsApi.kpiTrend(scope), [scope]);
  const name = (s: string) => (s === 'group' ? p('Группа', 'Guruh', 'Group') : ename(s));
  return (
    <div style={{ padding: 14, display: 'grid', gap: 14 }}>
      <Card title={p('Ключевые показатели по предприятиям и группе (9 мес. 2026, годовые)', "Korxonalar va guruh bo'yicha asosiy ko'rsatkichlar (2026 yil 9 oy, yillik)", 'KPIs by entity and group (9M 2026, annualised)')} flush actions={<ExportButton filename="ifrs-kpi" rows={kpis.data ?? []} columns={[{ header: p('Предприятие', 'Korxona', 'Entity'), value: (k) => name(k.scope) }, { header: 'ROA %', value: (k) => k.roa, format: 'number' }, { header: 'ROE %', value: (k) => k.roe, format: 'number' }, { header: 'EBITDA', value: (k) => k.ebitda, format: 'money' }, { header: 'CIR %', value: (k) => k.cir, format: 'number' }, { header: 'NPM %', value: (k) => k.npm, format: 'number' }, { header: p('Прибыль', 'Foyda', 'Profit'), value: (k) => k.profit, format: 'money' }]} />}>
        <DataTable rows={kpis.data} loading={kpis.loading} rowKey={(k) => k.scope} onRowClick={(k) => setScope(k.scope)} columns={[
          { header: p('Предприятие', 'Korxona', 'Entity'), render: (k) => <b>{name(k.scope)}</b> },
          { header: 'ROA, %', align: 'right', render: (k) => formatDecimal(k.roa) },
          { header: 'ROE, %', align: 'right', render: (k) => formatDecimal(k.roe) },
          { header: p('EBITDA, млн', 'EBITDA, mln', 'EBITDA, mln'), align: 'right', render: (k) => mln(k.ebitda) },
          { header: 'CIR, %', align: 'right', render: (k) => <span style={{ color: k.cir > 60 ? 'var(--danger)' : undefined }}>{formatDecimal(k.cir)}</span> },
          { header: 'Net Profit Margin, %', align: 'right', render: (k) => formatDecimal(k.npm) },
          { header: p('Прибыль, млн', 'Foyda, mln', 'Profit, mln'), align: 'right', render: (k) => mln(k.profit) },
        ]} />
      </Card>
      <Card title={`${p('Динамика', 'Dinamika', 'Trend')}: ${name(scope)}`} actions={<Select<string> value={scope} onChange={setScope} options={[{ value: 'group', label: p('Группа', 'Guruh', 'Group') }, ...['e0', 'e1', 'e2', 'e3', 'e4'].map((e) => ({ value: e, label: ename(e) }))]} ariaLabel={p('Разрез', 'Kesim', 'Scope')} />}>
        {trend.data && <LineChart labels={trend.data.map((x) => x.month.slice(5))} series={[{ name: 'ROA %', values: trend.data.map((x) => x.roa) }, { name: 'ROE %', values: trend.data.map((x) => x.roe) }, { name: 'CIR %', values: trend.data.map((x) => x.cir) }, { name: 'NPM %', values: trend.data.map((x) => x.npm) }]} format={(n) => formatDecimal(n)} />}
      </Card>
    </div>
  );
}

const ITEM: Record<IfrsBudgetItem, [string, string, string]> = { income: ['Доходы', 'Daromadlar', 'Income'], staff: ['Персонал', 'Xodimlar', 'Staff'], rent: ['Аренда', 'Ijara', 'Rent'], it: ['ИТ', 'AT', 'IT'], marketing: ['Маркетинг', 'Marketing', 'Marketing'], admin: ['Административные', "Ma'muriy", 'Administrative'], capex: ['Капвложения', 'Kapital qo‘yilmalar', 'Capex'] };

export function BudgetTab() {
  const p = useP();
  const user = useUser();
  const can = useCan()('ifrs', 'edit');
  const ename = useEntityName();
  const [entity, setEntity] = useState('');
  const [month, setMonth] = useState('2026-09');
  const list = useApi(() => ifrsAnalyticsApi.listBudget({ ...(entity ? { entityId: entity } : {}), month }), [entity, month]);
  const { run } = useIfrsRun();
  const [edit, setEdit] = useState<IfrsBudgetView | null>(null);
  const [f, setF] = useState({ justification: '', driver: '', varianceComment: '' });
  const rows = list.data ?? [];
  const flagged = rows.filter((r) => r.flags.length).length;
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
        <Select<string> value={entity} onChange={setEntity} options={['e1', 'e2', 'e4'].map((e) => ({ value: e, label: ename(e) }))} placeholder={p('Все предприятия', 'Barcha korxonalar', 'All entities')} ariaLabel={p('Предприятие', 'Korxona', 'Entity')} />
        <Select<string> value={month} onChange={setMonth} options={['2026-08', '2026-09', '2026-10'].map((m) => ({ value: m, label: m }))} ariaLabel={p('Месяц', 'Oy', 'Month')} />
        <Badge tone={flagged ? 'warn' : 'ok'}>{p('Требуют внимания', "E'tibor talab qiladi", 'Need attention')}: {flagged}</Badge>
        <span className="muted small">{p('План утверждается на начало месяца; ZBB: каждая статья обосновывается с нуля (драйвер и расчёт); отклонение > 10% требует пояснения.', "Reja oy boshida tasdiqlanadi; ZBB: har bir modda noldan asoslanadi (drayver va hisob); 10% dan ortiq og'ish izoh talab qiladi.", 'The plan is approved at month start; ZBB: each item is justified from zero (driver and calculation); variance > 10% requires an explanation.')}</span>
        <span style={{ marginLeft: 'auto' }}><ExportButton filename={`subs-plan-fact-${month}`} rows={rows} columns={[{ header: p('Предприятие', 'Korxona', 'Entity'), value: (r) => ename(r.entityId) }, { header: p('Статья', 'Modda', 'Item'), value: (r) => p(...ITEM[r.item]) }, { header: p('План', 'Reja', 'Plan'), value: (r) => r.plan, format: 'money', total: true }, { header: p('Факт', 'Fakt', 'Actual'), value: (r) => r.actual ?? null, format: 'money', total: true }, { header: p('Отклонение', "Og'ish", 'Variance'), value: (r) => r.variance ?? null, format: 'money' }, { header: '%', value: (r) => r.variancePct ?? null, format: 'number' }, { header: 'ZBB', value: (r) => r.justification }, { header: p('Пояснение', 'Izoh', 'Comment'), value: (r) => r.varianceComment ?? '' }]} /></span>
      </div>
      {rows.length > 0 && (
        <div style={{ padding: 14 }}>
          <BarChart data={rows.filter((r) => r.actual !== undefined).map((r) => ({ label: `${ename(r.entityId).slice(0, 8)} ${p(...ITEM[r.item]).slice(0, 6)}`, values: [Math.round(r.plan / 1e8) / 10, Math.round((r.actual ?? 0) / 1e8) / 10] }))} series={[{ name: p('План, млрд', 'Reja, mlrd', 'Plan, bn') }, { name: p('Факт, млрд', 'Fakt, mlrd', 'Actual, bn') }]} height={180} format={(n) => formatDecimal(n)} />
        </div>
      )}
      <DataTable rows={list.data} loading={list.loading} rowKey={(r) => r.id} columns={[
        { header: p('Предприятие / статья', 'Korxona / modda', 'Entity / item'), render: (r) => <><b>{ename(r.entityId)}</b> · {p(...ITEM[r.item])}<div className="sub">{p('утв.', 'tasd.', 'appr.')} {r.approvedAt}</div></> },
        { header: p('План', 'Reja', 'Plan'), align: 'right', render: (r) => mln(r.plan) },
        { header: p('Факт', 'Fakt', 'Actual'), align: 'right', render: (r) => (r.actual !== undefined ? mln(r.actual) : '—') },
        { header: p('Отклонение', "Og'ish", 'Variance'), align: 'right', render: (r) => (r.variance !== undefined ? <span style={{ color: r.adverse ? 'var(--danger)' : 'var(--ok)', fontWeight: 600 }}>{mln(r.variance)} ({formatDecimal(r.variancePct ?? 0)}%)</span> : '—') },
        { header: p('Обоснование ZBB', 'ZBB asoslash', 'ZBB justification'), render: (r) => (r.justification ? <span className="small">{r.justification}<div className="sub">{p('драйвер', 'drayver', 'driver')}: {r.driver}</div></span> : <Badge tone="danger">{p('не обоснована', 'asoslanmagan', 'not justified')}</Badge>) },
        { header: p('Пояснение отклонения', "Og'ish izohi", 'Variance comment'), render: (r) => (r.varianceComment ? <span className="small">{r.varianceComment}</span> : r.flags.includes('no_comment') ? <Badge tone="warn">{p('требуется', 'talab qilinadi', 'required')}</Badge> : '—') },
        { header: '', render: (r) => (can ? <Button size="small" onClick={() => { setEdit(r); setF({ justification: r.justification, driver: r.driver, varianceComment: r.varianceComment ?? '' }); }}>{p('Изменить', "O'zgartirish", 'Edit')}</Button> : null) },
      ]} />
      {edit && (
        <Modal title={`${ename(edit.entityId)} · ${p(...ITEM[edit.item])} · ${edit.month}`} onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => ifrsAnalyticsApi.updateBudgetLine(edit.id, f, user), p('Сохранено', 'Saqlandi', 'Saved'))) setEdit(null); }}>{p('Сохранить', 'Saqlash', 'Save')}</Button></>}>
          <Field label={p('Обоснование по ZBB (расчёт с нуля)', "ZBB bo'yicha asoslash (noldan hisob)", 'ZBB justification (zero-based calculation)')} required><Textarea value={f.justification} rows={3} onChange={(e) => setF({ ...f, justification: e.target.value })} /></Field>
          <Field label={p('Драйвер', 'Drayver', 'Driver')}><Input value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })} /></Field>
          <Field label={p('Пояснение отклонения', "Og'ish izohi", 'Variance explanation')}><Textarea value={f.varianceComment} rows={2} onChange={(e) => setF({ ...f, varianceComment: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}

export function FlagsTab() {
  const p = useP();
  const { loc, t: tr } = useSession();
  const user = useUser();
  const can = useCan()('ifrs', 'edit');
  const ename = useEntityName();
  const triggers = useApi(() => ifrsAnalyticsApi.listTriggers());
  const flags = useApi(() => ifrsAnalyticsApi.redFlags());
  const hist = useApi(() => ifrsAnalyticsApi.overdueHistory());
  const { busy, run } = useIfrsRun();
  const [th, setTh] = useState<Record<string, string>>({});
  return (
    <div style={{ padding: 14, display: 'grid', gap: 14 }}>
      <div className="grid grid-3">
        <Stat label={p('Красные флажки', 'Qizil bayroqlar', 'Red flags')} value={flags.data?.length ?? '—'} tone={flags.data?.length ? 'alert' : undefined} icon="alert" foot={`${p('критичных', 'kritik', 'critical')}: ${flags.data?.filter((f) => f.severity === 'danger').length ?? 0}`} />
        <Stat label={p('Активные триггеры', 'Faol triggerlar', 'Active triggers')} value={triggers.data?.filter((t) => t.enabled).length ?? '—'} icon="bell" />
        <div style={{ display: 'flex', alignItems: 'center' }}>{can && <Button type="primary" icon="bell" disabled={busy} onClick={() => run(() => ifrsAnalyticsApi.checkFlags(user), p('Триггеры проверены, руководители уведомлены', 'Triggerlar tekshirildi, rahbarlarga xabar berildi', 'Triggers checked, managers notified'))}>{p('Проверить и уведомить руководителей', 'Tekshirish va rahbarlarga xabar berish', 'Check and notify managers')}</Button>}</div>
      </div>
      <Card title={p('Сигналы раннего предупреждения', 'Erta ogohlantirish signallari', 'Early-warning signals')} flush>
        <DataTable rows={flags.data} loading={flags.loading} emptyText={p('Сигналов нет', "Signallar yo'q", 'No signals')} rowKey={(f) => f.id} columns={[
          { header: '', render: (f) => <Badge tone={f.severity === 'danger' ? 'danger' : 'warn'}>{f.severity === 'danger' ? p('критично', 'kritik', 'critical') : p('внимание', "e'tibor", 'warning')}</Badge> },
          { header: p('Предприятие', 'Korxona', 'Entity'), render: (f) => <b>{ename(f.entityId)}</b> },
          { header: p('Сигнал', 'Signal', 'Signal'), render: (f) => loc(f.message) },
          { header: p('Тренд', 'Trend', 'Trend'), render: (f) => <span className="small">{f.trend.map((v) => formatDecimal(v)).join(' → ')}</span> },
        ]} />
      </Card>
      <Card title={p('Настройка триггеров', 'Triggerlarni sozlash', 'Trigger settings')} flush>
        <DataTable rows={triggers.data} rowKey={(t) => t.id} columns={[
          { header: p('Триггер', 'Trigger', 'Trigger'), render: (t) => <>{loc(t.name)}<div className="sub">{p('получатели', 'qabul qiluvchilar', 'recipients')}: {t.roles.map((r) => tr(tk("role_", r))).join(', ')}</div></> },
          { header: p('Порог', 'Chegara', 'Threshold'), render: (t) => (can ? <span style={{ display: 'flex', gap: 6 }}><Input value={th[t.id] ?? String(t.threshold)} inputMode="decimal" ariaLabel={`${p('Порог', 'Chegara', 'Threshold')} ${t.id}`} onChange={(e) => setTh({ ...th, [t.id]: e.target.value })} style={{ width: 90 }} /><Button size="small" onClick={() => run(() => ifrsAnalyticsApi.updateTrigger(t.id, { threshold: Number((th[t.id] ?? String(t.threshold)).replace(',', '.')) }, user), p('Порог сохранён', 'Chegara saqlandi', 'Threshold saved'))}>OK</Button></span> : t.threshold) },
          { header: p('Включён', 'Yoqilgan', 'Enabled'), render: (t) => <Switch checked={t.enabled} disabled={!can} ariaLabel={t.id} onChange={(v) => run(() => ifrsAnalyticsApi.updateTrigger(t.id, { enabled: v }, user), p('Сохранено', 'Saqlandi', 'Saved'))} /> },
        ]} />
      </Card>
      {hist.data && (
        <Card title={p('Доля просроченной дебиторки (> 30 дн.), %', "Muddati o'tgan debitorlik ulushi (> 30 kun), %", 'Overdue receivables share (> 30 days), %')}>
          <LineChart labels={['07', '08', '09']} series={Object.entries(hist.data).map(([e, v]) => ({ name: ename(e), values: v }))} format={(n) => `${n}%`} height={180} />
        </Card>
      )}
    </div>
  );
}
