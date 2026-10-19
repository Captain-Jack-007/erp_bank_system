// Реестры налоговой базы (ТЗ 4.2.17.2–4.2.17.6): имущество (16509), НЗС (16505), земля, вода, аренда у физлиц,
// минимальные ставки аренды, ставки налогов, журнал мониторинга изменений базы.
import { useState, type ReactNode } from 'react';
import {
  assetsApi, formatDate, formatDateTime, formatMoney, formatNumber, taxesApi, tk,
  type TaxLandRight, type TaxLeaseObjectType, type TaxPropertyView, type TaxRateKind, type TaxRateSource, type TaxRateTax, type TaxWaterMethod, type TaxWaterSource,
} from '@xb/shared';
import { Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, Stat, Tabs, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { BranchSelect, ImportDrawer, MONTHS_2026, useBranches, useErrText, useP, useUrlTab } from './common';

const TABS = ['property', 'construction', 'land', 'water', 'leases', 'minrent', 'rates', 'monitor'] as const;
type Tab = (typeof TABS)[number];

export function TaxRegistersPage() {
  const { t } = useSession();
  const p = useP();
  const [tab, setTab] = useUrlTab<Tab>(TABS, 'property');
  const prop = useApi(() => taxesApi.listProperty());
  const leases = useApi(() => taxesApi.listLeases());
  const changes = useApi(() => taxesApi.listBaseChanges());
  const props16509 = prop.data?.filter((o) => o.account === '16509' && !o.disposedAt) ?? [];
  const cip = prop.data?.filter((o) => o.account === '16505' && !o.completedAt) ?? [];
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('taxes_title'), to: '/taxes' }, { label: p('Реестры и база', 'Reyestrlar va baza', 'Registers & base') }]}
        title={p('Реестры налоговой базы', 'Soliq bazasi reyestrlari', 'Tax base registers')}
        subtitle={`${t('tzLabel')} 4.2.17.2–4.2.17.6 · ${p('внешние (my.soliq.uz, ijara.soliq.uz, кадастр) и внутренние (ABS) источники', "tashqi (my.soliq.uz, ijara.soliq.uz, kadastr) va ichki (ABS) manbalar", 'external (my.soliq.uz, ijara.soliq.uz, cadastre) and internal (ABS) sources')}`}
      />
      <div className="grid grid-4">
        <Stat label={p('Объекты недвижимости (16509)', "Ko'chmas mulk obyektlari (16509)", 'Real estate objects (16509)')} value={props16509.length} icon="building" foot={formatMoney(props16509.reduce((s, o) => s + o.calc.base, 0))} />
        <Stat label={p('НЗС с истёкшим сроком (3%)', "Muddati o'tgan TQ (3%)", 'Overdue CIP (3%)')} value={cip.filter((o) => o.calc.overdue).length} tone={cip.some((o) => o.calc.overdue) ? 'alert' : undefined} icon="clock" foot={`${p('всего НЗС', 'jami TQ', 'CIP total')}: ${cip.length}`} />
        <Stat label={p('Договоры аренды у физлиц', 'Jismoniy shaxslardan ijara', 'Leases from individuals')} value={leases.data?.length ?? '—'} icon="file" foot={`${p('истекают ≤ 10 дн.', '≤ 10 kunda tugaydi', 'expire ≤ 10 days')}: ${leases.data?.filter((l) => l.daysToEnd >= 0 && l.daysToEnd <= 10).length ?? 0}`} />
        <Stat label={p('Изменения базы', "Baza o'zgarishlari", 'Base changes')} value={changes.data?.length ?? '—'} icon="refresh" tone="accent" />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'property', label: p('Имущество (16509)', 'Mol-mulk (16509)', 'Property (16509)') },
            { value: 'construction', label: p('НЗС (16505)', 'TQ (16505)', 'CIP (16505)'), count: cip.length },
            { value: 'land', label: p('Земельные участки', 'Yer uchastkalari', 'Land plots') },
            { value: 'water', label: p('Водопотребление', "Suv iste'moli", 'Water use') },
            { value: 'leases', label: p('Аренда у физлиц', 'Jismoniy shaxslardan ijara', 'Leases from individuals'), ...(leases.data ? { count: leases.data.length } : {}) },
            { value: 'minrent', label: p('Мин. ставки аренды', 'Minimal ijara stavkalari', 'Minimum rents') },
            { value: 'rates', label: p('Ставки налогов', 'Soliq stavkalari', 'Tax rates') },
            { value: 'monitor', label: p('Мониторинг базы', 'Baza monitoringi', 'Base monitoring'), ...(changes.data ? { count: changes.data.length } : {}) },
          ]}
        />
        {tab === 'property' && <PropertyTab rows={prop.data?.filter((o) => o.account === '16509')} loading={prop.loading} />}
        {tab === 'construction' && <ConstructionTab rows={prop.data?.filter((o) => o.account === '16505')} loading={prop.loading} />}
        {tab === 'land' && <LandTab />}
        {tab === 'water' && <WaterTab />}
        {tab === 'leases' && <LeasesTab />}
        {tab === 'minrent' && <MinRentTab />}
        {tab === 'rates' && <RatesTab />}
        {tab === 'monitor' && <MonitorTab />}
      </Card>
    </>
  );
}

/** Панель действий над таблицей. */
function Bar({ children }: { children: ReactNode }) {
  return <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>{children}</div>;
}
function useRunner() {
  const toast = useToast();
  const errText = useErrText();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string | ((r: never) => string)) => {
    setBusy(true);
    try {
      const r = await fn();
      toast(typeof ok === 'function' ? (ok as (x: unknown) => string)(r) : ok);
      return true;
    } catch (e) {
      toast(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// ---------------------------------------------------------------------------------------------
function PropertyTab({ rows, loading }: { rows: TaxPropertyView[] | undefined; loading: boolean }) {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const br = useBranches();
  const { busy, run } = useRunner();
  const [selling, setSelling] = useState<TaxPropertyView | null>(null);
  return (
    <>
      <Bar>
        {can && (
          <>
            <Button size="small" icon="download" disabled={busy} onClick={() => run(() => taxesApi.loadPropertyFromAbs(user), (r: { added: number; status: string }) => `ABS: ${r.status}; ${p('новых объектов', 'yangi obyektlar', 'new objects')}: ${r.added}`)}>{p('Загрузить из ABS (16509/16505)', 'ABS dan yuklash (16509/16505)', 'Load from ABS (16509/16505)')}</Button>
            <Button size="small" icon="globe" disabled={busy} onClick={() => run(() => taxesApi.fetchMinValues(user), (r: { updated: number; failed: number }) => `my.soliq.uz: ${p('обновлено', 'yangilandi', 'updated')} ${r.updated}, ${p('ошибок', 'xatolar', 'errors')} ${r.failed}`)}>{p('Мин. стоимость с my.soliq.uz', 'my.soliq.uz dan minimal qiymat', 'Min. value from my.soliq.uz')}</Button>
          </>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <ExportButton<TaxPropertyView>
            filename="tax-property-16509"
            rows={rows ?? []}
            columns={[
              { header: p('Кадастровый номер', 'Kadastr raqami', 'Cadastral No.'), value: (o) => o.cadastralNo },
              { header: p('Объект', 'Obyekt', 'Object'), value: (o) => loc(o.name) },
              { header: p('Филиал', 'Filial', 'Branch'), value: (o) => o.branchKey },
              { header: p('Среднегодовая остаточная (ABS)', "O'rtacha yillik qoldiq (ABS)", 'Avg annual residual (ABS)'), value: (o) => o.calc.avgResidual, format: 'money', total: true },
              { header: p('Мин. стоимость (my.soliq.uz)', 'Minimal qiymat (my.soliq.uz)', 'Min. value (my.soliq.uz)'), value: (o) => o.calc.minValue, format: 'money' },
              { header: p('База', 'Baza', 'Base'), value: (o) => o.calc.base, format: 'money', total: true },
              { header: p('Ставка, %', 'Stavka, %', 'Rate, %'), value: (o) => o.calc.rate, format: 'number' },
              { header: p('Налог за год', 'Yillik soliq', 'Annual tax'), value: (o) => o.calc.annualTax, format: 'money', total: true },
            ]}
          />
          <PrintButton
            template="registry"
            label={p('Печать', 'Chop etish', 'Print')}
            doc={() => ({
              entity: 'tax_property_register', entityId: 'p16509', title: p('Реестр объектов налога на имущество', "Mol-mulk solig'i obyektlari reyestri", 'Property tax object register'), date: new Date().toISOString().slice(0, 10), landscape: true,
              table: {
                columns: [{ header: p('Кадастр. №', 'Kadastr №', 'Cadastral No.') }, { header: p('Объект', 'Obyekt', 'Object') }, { header: p('Филиал', 'Filial', 'Branch') }, { header: 'ABS', align: 'right' }, { header: 'my.soliq', align: 'right' }, { header: p('База', 'Baza', 'Base'), align: 'right' }, { header: '%', align: 'right' }, { header: p('Налог', 'Soliq', 'Tax'), align: 'right' }],
                rows: (rows ?? []).map((o) => [o.cadastralNo, loc(o.name), o.branchKey, formatMoney(o.calc.avgResidual), formatMoney(o.calc.minValue), formatMoney(o.calc.base), String(o.calc.rate), formatMoney(o.calc.annualTax)]),
                totals: ['', '', '', '', '', formatMoney((rows ?? []).reduce((s, o) => s + o.calc.base, 0)), '', formatMoney((rows ?? []).reduce((s, o) => s + o.calc.annualTax, 0))],
              },
            })}
          />
        </span>
      </Bar>
      <div className="muted small" style={{ padding: '10px 18px 0' }}>
        {p('База = max(среднегодовая остаточная стоимость по ABS; минимальная стоимость по кадастровому номеру с my.soliq.uz). Среднегодовая стоимость — среднее значений на 1-е число каждого месяца и на конец периода.', "Baza = max(ABS bo'yicha o'rtacha yillik qoldiq qiymat; my.soliq.uz dagi kadastr raqami bo'yicha minimal qiymat). O'rtacha yillik qiymat — har oyning 1-sanasi va davr oxiridagi qiymatlar o'rtachasi.", 'Base = max(average annual residual value from ABS; minimum value per cadastral number from my.soliq.uz). Average annual value = mean of values on the 1st of each month and at period end.')}
      </div>
      <DataTable
        rows={rows}
        loading={loading}
        rowKey={(o) => o.id}
        columns={[
          { header: p('Объект', 'Obyekt', 'Object'), render: (o) => <><div style={{ fontWeight: 600 }}>{loc(o.name)}</div><div className="sub">{o.cadastralNo} · {br.name(o.branchKey)}{o.assetId ? ` · ${p('карточка ОС', 'AV kartochkasi', 'asset card')} ${o.assetId}` : ''}</div></> },
          { header: p('Ср.-год. остаточная (ABS)', "O'rt. yillik qoldiq (ABS)", 'Avg residual (ABS)'), align: 'right', render: (o) => formatMoney(o.calc.avgResidual) },
          { header: 'my.soliq.uz', align: 'right', render: (o) => (o.minValueAt ? formatMoney(o.calc.minValue) : <span className="muted small">{p('не запрошено', "so'ralmagan", 'not requested')}</span>) },
          { header: p('База', 'Baza', 'Base'), align: 'right', render: (o) => <><b>{formatMoney(o.calc.base)}</b><div><Badge tone={o.calc.baseSource === 'soliq' ? 'warn' : 'muted'}>{o.calc.baseSource === 'soliq' ? 'my.soliq.uz' : 'ABS'}</Badge></div></> },
          { header: '%', align: 'right', render: (o) => o.calc.rate },
          { header: p('Налог за год', 'Yillik soliq', 'Annual tax'), align: 'right', render: (o) => formatMoney(o.calc.annualTax) },
          { header: p('Статус', 'Holat', 'Status'), render: (o) => (o.disposedAt ? <Badge tone="muted">{p('выбыл', 'chiqib ketgan', 'disposed')} {formatDate(o.disposedAt)}</Badge> : <Badge tone="ok">{p('на балансе', 'balansda', 'on balance')}</Badge>) },
          { header: '', render: (o) => (can && !o.disposedAt ? <Button size="small" onClick={() => setSelling(o)}>{p('Реализовать', 'Sotish', 'Sell')}</Button> : null) },
        ]}
      />
      {selling && <SellModal obj={selling} onClose={() => setSelling(null)} />}
    </>
  );
}

function SellModal({ obj, onClose }: { obj: TaxPropertyView; onClose: () => void }) {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const errText = useErrText();
  const [buyer, setBuyer] = useState('');
  const [tin, setTin] = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');
  return (
    <Modal
      title={`${p('Реализация имущества', 'Mol-mulkni sotish', 'Property sale')}: ${loc(obj.name)}`}
      onClose={onClose}
      footer={<><Button onClick={onClose}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => {
        try {
          const esf = await taxesApi.sellProperty(obj.id, { buyerName: buyer, buyerTin: tin.trim(), price: Number(price.replace(/\s/g, '')), date }, user);
          toast(`${p('ЭСФ отправлен покупателю', 'EHF xaridorga yuborildi', 'E-invoice sent to buyer')}: ${esf.number} (${esf.status})`);
          onClose();
        } catch (e) { setError(errText(e)); }
      }}>{p('Реализовать и выставить ЭСФ', 'Sotish va EHF yuborish', 'Sell and issue e-invoice')}</Button></>}
    >
      <Field label={p('Покупатель', 'Xaridor', 'Buyer')} required><Input value={buyer} onChange={(e) => setBuyer(e.target.value)} /></Field>
      <div className="form-grid">
        <Field label={p('ИНН покупателя', 'Xaridor STIR', 'Buyer TIN')} required hint="9"><Input value={tin} inputMode="numeric" maxLength={9} onChange={(e) => setTin(e.target.value)} /></Field>
        <Field label={p('Цена без НДС', "QQSsiz narx", 'Price excl. VAT')} required><Input value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label={p('Дата', 'Sana', 'Date')} required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="muted small">{p('Объект выбывает из базы налога на имущество, ЭСФ формируется и отправляется через оператора автоматически.', "Obyekt mol-mulk solig'i bazasidan chiqariladi, EHF avtomatik shakllantiriladi va operator orqali yuboriladi.", 'The object leaves the property tax base; the e-invoice is generated and sent via the operator automatically.')}</div>
    </Modal>
  );
}

function ConstructionTab({ rows, loading }: { rows: TaxPropertyView[] | undefined; loading: boolean }) {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const br = useBranches();
  const { busy, run } = useRunner();
  return (
    <>
      <Bar>
        <Button size="small" icon="bell" disabled={busy} onClick={() => run(() => taxesApi.scanDeadlines(), (n: number) => `${p('Проверка сроков выполнена, уведомлений', "Muddatlar tekshirildi, bildirishnomalar", 'Deadline check done, notifications')}: ${n}`)}>{p('Проверить сроки и уведомить', "Muddatlarni tekshirish va xabar berish", 'Check deadlines and notify')}</Button>
        <span className="muted small">{p('По истечении нормативного срока строительства объект облагается по ставке 3% (уведомление ответственным за 30 дней и в день перехода).', "Qurilishning me'yoriy muddati o'tgach, obyektga 3% stavka qo'llanadi (mas'ullarga 30 kun oldin va o'tish kunida xabar beriladi).", 'After the normative construction term the object is taxed at 3% (owners are notified 30 days ahead and on the switch day).')}</span>
      </Bar>
      <DataTable
        rows={rows}
        loading={loading}
        rowKey={(o) => o.id}
        columns={[
          { header: p('Объект НЗС', 'TQ obyekti', 'CIP object'), render: (o) => <><div style={{ fontWeight: 600 }}>{loc(o.name)}</div><div className="sub">{o.cadastralNo} · {br.name(o.branchKey)}</div></> },
          { header: p('Начало', 'Boshlanish', 'Start'), render: (o) => (o.constructionStart ? formatDate(o.constructionStart) : '—') },
          { header: p('Норм. срок, мес.', "Me'yoriy muddat, oy", 'Norm. term, months'), align: 'right', render: (o) => o.normativeMonths ?? '—' },
          { header: p('Срок ввода', 'Topshirish muddati', 'Deadline'), render: (o) => (o.calc.deadline ? <>{formatDate(o.calc.deadline)} {o.completedAt ? <Badge tone="ok">{p('введён', 'foydalanishga topshirildi', 'completed')}</Badge> : o.calc.overdue ? <Badge tone="danger">{p('срок истёк', "muddat o'tdi", 'overdue')}</Badge> : (o.calc.daysToDeadline ?? 99) <= 30 ? <Badge tone="warn">{o.calc.daysToDeadline} {p('дн.', 'kun', 'd')}</Badge> : <Badge tone="muted">{o.calc.daysToDeadline} {p('дн.', 'kun', 'd')}</Badge>}</> : '—') },
          { header: p('Ср.-год. стоимость (16505)', "O'rt. yillik qiymat (16505)", 'Avg value (16505)'), align: 'right', render: (o) => formatMoney(o.calc.avgResidual) },
          { header: '%', align: 'right', render: (o) => (o.calc.rate ? <b style={{ color: 'var(--danger)' }}>{o.calc.rate}</b> : 0) },
          { header: p('Налог за год', 'Yillik soliq', 'Annual tax'), align: 'right', render: (o) => formatMoney(o.calc.annualTax) },
          { header: '', render: (o) => (can && !o.completedAt ? <Button size="small" disabled={busy} onClick={() => run(() => taxesApi.completeConstruction(o.id, new Date().toISOString().slice(0, 10), user), p('Объект введён в эксплуатацию и переведён на 16509', "Obyekt foydalanishga topshirildi va 16509 ga o'tkazildi", 'Object completed and moved to 16509'))}>{p('Ввести в эксплуатацию', 'Foydalanishga topshirish', 'Complete')}</Button> : null) },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
function LandTab() {
  const p = useP();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const br = useBranches();
  const list = useApi(() => taxesApi.listLand());
  const { busy, run } = useRunner();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; area: string } | null>(null);
  const [branch, setBranch] = useState('');
  const rows = list.data?.filter((x) => !branch || x.branchKey === branch);
  const RIGHT: Record<TaxLandRight, string> = { own: p('собственность', 'mulk', 'ownership'), possession: p('владение', 'egalik', 'possession'), use: p('пользование', 'foydalanish', 'use'), lease: p('аренда', 'ijara', 'lease') };
  return (
    <>
      <Bar>
        <BranchSelect value={branch} onChange={setBranch} />
        {can && <Button size="small" icon="plus" onClick={() => setAdding(true)}>{p('Добавить участок', "Uchastka qo'shish", 'Add plot')}</Button>}
        <span style={{ marginLeft: 'auto' }}>
          <ExportButton
            filename="tax-land-plots"
            rows={rows ?? []}
            columns={[
              { header: p('Кадастровый номер', 'Kadastr raqami', 'Cadastral No.'), value: (x) => x.cadastralNo },
              { header: p('Филиал', 'Filial', 'Branch'), value: (x) => x.branchKey },
              { header: p('Адрес', 'Manzil', 'Address'), value: (x) => x.address },
              { header: p('Площадь, га', 'Maydon, ga', 'Area, ha'), value: (x) => x.areaHa, format: 'number', total: true },
              { header: p('Ставка за 1 га', '1 ga stavkasi', 'Rate per ha'), value: (x) => x.calc.rate, format: 'money' },
              { header: p('Месяцев', 'Oylar', 'Months'), value: (x) => x.calc.months, format: 'integer' },
              { header: p('Налог за год', 'Yillik soliq', 'Annual tax'), value: (x) => x.calc.annualTax, format: 'money', total: true },
            ]}
          />
        </span>
      </Bar>
      <DataTable
        rows={rows}
        loading={list.loading}
        rowKey={(x) => x.id}
        columns={[
          { header: p('Участок', 'Uchastka', 'Plot'), render: (x) => <><div style={{ fontWeight: 600 }}>{x.cadastralNo}</div><div className="sub">{x.address}</div></> },
          { header: p('Филиал', 'Filial', 'Branch'), render: (x) => br.name(x.branchKey) },
          { header: p('Право', 'Huquq', 'Right'), render: (x) => RIGHT[x.right] },
          { header: p('Площадь, га', 'Maydon, ga', 'Area, ha'), align: 'right', render: (x) => <b>{String(x.areaHa).replace('.', ',')}</b> },
          { header: p('Ставка за 1 га', '1 ga stavkasi', 'Rate per ha'), align: 'right', render: (x) => <>{formatMoney(x.calc.rate)}<div className="sub">{x.calc.rateSource ? p({ tax_code: 'НК', budget_law: 'Закон о Госбюджете', kengash: 'кенгаш' }[x.calc.rateSource], { tax_code: 'SK', budget_law: 'Byudjet qonuni', kengash: 'kengash' }[x.calc.rateSource], { tax_code: 'Tax Code', budget_law: 'Budget Law', kengash: 'kengash' }[x.calc.rateSource]) : ''}</div></> },
          { header: p('Налог за год', 'Yillik soliq', 'Annual tax'), align: 'right', render: (x) => formatMoney(x.calc.annualTax) },
          { header: p('Кадастр', 'Kadastr', 'Cadastre'), render: (x) => (x.cadastreCheckedAt ? <span className="small">{formatDateTime(x.cadastreCheckedAt)}</span> : <span className="muted small">—</span>) },
          {
            header: '',
            render: (x) =>
              can && !x.disposedAt ? (
                <span style={{ display: 'flex', gap: 6 }}>
                  <Button size="small" disabled={busy} onClick={() => run(() => taxesApi.checkLandCadastre(x.id, user), (r: { changed: boolean; areaHa: number }) => (r.changed ? `${p('Площадь уточнена по кадастру', "Maydon kadastr bo'yicha aniqlandi", 'Area updated from cadastre')}: ${r.areaHa}` : p('Совпадает с кадастром', 'Kadastr bilan mos', 'Matches cadastre')))}>{p('Сверить с кадастром', 'Kadastr bilan solishtirish', 'Check cadastre')}</Button>
                  <Button size="small" onClick={() => setEditing({ id: x.id, area: String(x.areaHa) })}>{p('Площадь', 'Maydon', 'Area')}</Button>
                </span>
              ) : x.disposedAt ? <Badge tone="muted">{p('выбыл', 'chiqib ketgan', 'disposed')}</Badge> : null,
          },
        ]}
      />
      {adding && <AddLandModal onClose={() => setAdding(false)} />}
      {editing && (
        <Modal title={p('Изменение площади участка', "Uchastka maydonini o'zgartirish", 'Change plot area')} onClose={() => setEditing(null)} footer={<><Button onClick={() => setEditing(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => taxesApi.updateLandArea(editing.id, Number(editing.area.replace(',', '.')), user), p('Площадь изменена, база пересчитана', "Maydon o'zgardi, baza qayta hisoblandi", 'Area changed, base recalculated'))) setEditing(null); }}>{p('Сохранить', 'Saqlash', 'Save')}</Button></>}>
          <Field label={p('Площадь, га', 'Maydon, ga', 'Area, ha')} required><Input value={editing.area} inputMode="decimal" onChange={(e) => setEditing({ ...editing, area: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}

function AddLandModal({ onClose }: { onClose: () => void }) {
  const p = useP();
  const user = useUser();
  const br = useBranches();
  const { run } = useRunner();
  const [f, setF] = useState({ cadastralNo: '', branchKey: 'R01', address: '', areaHa: '', right: 'own' as TaxLandRight, acquiredAt: new Date().toISOString().slice(0, 10) });
  return (
    <Modal title={p('Новый земельный участок', 'Yangi yer uchastkasi', 'New land plot')} onClose={onClose} footer={<><Button onClick={onClose}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => taxesApi.addLand({ cadastralNo: f.cadastralNo, branchKey: f.branchKey, address: f.address, areaHa: Number(f.areaHa.replace(',', '.')), right: f.right, acquiredAt: f.acquiredAt }, user), p('Участок добавлен', "Uchastka qo'shildi", 'Plot added'))) onClose(); }}>{p('Добавить', "Qo'shish", 'Add')}</Button></>}>
      <div className="form-grid">
        <Field label={p('Кадастровый номер', 'Kadastr raqami', 'Cadastral No.')} required><Input value={f.cadastralNo} onChange={(e) => setF({ ...f, cadastralNo: e.target.value })} /></Field>
        <Field label={p('Филиал', 'Filial', 'Branch')} required><Select<string> value={f.branchKey} onChange={(v) => setF({ ...f, branchKey: v })} options={br.options} /></Field>
        <Field label={p('Адрес', 'Manzil', 'Address')} required className="span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label={p('Площадь, га', 'Maydon, ga', 'Area, ha')} required><Input value={f.areaHa} inputMode="decimal" onChange={(e) => setF({ ...f, areaHa: e.target.value })} /></Field>
        <Field label={p('Право', 'Huquq', 'Right')} required><Select<TaxLandRight> value={f.right} onChange={(v) => setF({ ...f, right: v })} options={[{ value: 'own', label: p('собственность', 'mulk', 'ownership') }, { value: 'possession', label: p('владение', 'egalik', 'possession') }, { value: 'use', label: p('пользование', 'foydalanish', 'use') }, { value: 'lease', label: p('аренда', 'ijara', 'lease') }]} /></Field>
        <Field label={p('Дата возникновения права', 'Huquq paydo bo‘lgan sana', 'Right since')} required><Input type="date" value={f.acquiredAt} onChange={(e) => setF({ ...f, acquiredAt: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
function WaterTab() {
  const p = useP();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const br = useBranches();
  const [month, setMonth] = useState('2026-09');
  const list = useApi(() => taxesApi.listWater(month || undefined), [month]);
  const { busy, run } = useRunner();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const asOf = `${month || '2026-09'}-01`;
  const rateS = taxesApi.waterRate('surface', asOf);
  const rateU = taxesApi.waterRate('underground', asOf);
  const METHOD: Record<TaxWaterMethod, string> = { meter: p('счётчик', 'hisoblagich', 'meter'), invoice: p('счёт-фактура (soliq.servis.uz)', 'hisob-faktura (soliq.servis.uz)', 'invoice (soliq.servis.uz)'), letter: p('письмо водоканала', "suv ta'minoti xati", 'utility letter') };
  const rows = list.data ?? [];
  const sumBy = (s: TaxWaterSource) => rows.filter((r) => r.source === s).reduce((a, r) => a + r.m3, 0);
  return (
    <>
      <Bar>
        <Select<string> value={month} onChange={setMonth} options={MONTHS_2026.map((m) => ({ value: m, label: m }))} placeholder={p('Все месяцы', 'Barcha oylar', 'All months')} ariaLabel={p('Месяц', 'Oy', 'Month')} />
        {can && (
          <>
            <Button size="small" icon="plus" onClick={() => setAdding(true)}>{p('Показание / письмо', "Ko'rsatkich / xat", 'Reading / letter')}</Button>
            <Button size="small" icon="download" disabled={busy || !month} onClick={() => run(() => taxesApi.fetchWaterInvoices(month, user), (r: { added: number; status: string }) => `soliq.servis.uz: ${r.status}; +${r.added}`)}>{p('Счета-фактуры soliq.servis.uz', 'soliq.servis.uz hisob-fakturalari', 'soliq.servis.uz invoices')}</Button>
            <Button size="small" icon="upload" onClick={() => setImporting(true)}>{p('Импорт Excel', 'Excel import', 'Import Excel')}</Button>
          </>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <ExportButton filename={`tax-water-${month || 'all'}`} rows={rows} columns={[
            { header: p('Филиал', 'Filial', 'Branch'), value: (w) => w.branchKey }, { header: p('Объект', 'Obyekt', 'Object'), value: (w) => w.objectName }, { header: p('Месяц', 'Oy', 'Month'), value: (w) => w.month },
            { header: p('Источник', 'Manba', 'Source'), value: (w) => w.source }, { header: 'м³', value: (w) => w.m3, format: 'integer', total: true }, { header: p('Основание', 'Asos', 'Basis'), value: (w) => METHOD[w.method] }, { header: p('Документ', 'Hujjat', 'Document'), value: (w) => w.docRef ?? '' },
          ]} />
        </span>
      </Bar>
      <div className="grid grid-2" style={{ padding: 14 }}>
        <Stat label={`${p('Поверхностные', 'Yer usti', 'Surface')} · ${formatMoney(rateS)} / м³`} value={`${formatNumber(sumBy('surface'))} м³`} foot={formatMoney(sumBy('surface') * rateS)} icon="globe" />
        <Stat label={`${p('Подземные', 'Yer osti', 'Underground')} · ${formatMoney(rateU)} / м³`} value={`${formatNumber(sumBy('underground'))} м³`} foot={formatMoney(sumBy('underground') * rateU)} icon="globe" />
      </div>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(w) => w.id}
        columns={[
          { header: p('Филиал / объект', 'Filial / obyekt', 'Branch / object'), render: (w) => <><div style={{ fontWeight: 600 }}>{w.objectName}</div><div className="sub">{br.name(w.branchKey)}</div></> },
          { header: p('Месяц', 'Oy', 'Month'), render: (w) => w.month },
          { header: p('Источник', 'Manba', 'Source'), render: (w) => <Badge tone={w.source === 'surface' ? 'info' : 'warn'}>{w.source === 'surface' ? p('поверхностный', 'yer usti', 'surface') : p('подземный', 'yer osti', 'underground')}</Badge> },
          { header: 'м³', align: 'right', render: (w) => formatNumber(w.m3) },
          { header: p('Ставка (авто)', 'Stavka (avto)', 'Rate (auto)'), align: 'right', render: (w) => formatMoney(taxesApi.waterRate(w.source, `${w.month}-01`)) },
          { header: p('Налог', 'Soliq', 'Tax'), align: 'right', render: (w) => formatMoney(w.m3 * taxesApi.waterRate(w.source, `${w.month}-01`)) },
          { header: p('Основание', 'Asos', 'Basis'), render: (w) => <><div className="small">{METHOD[w.method]}</div><div className="sub">{w.docRef}</div></> },
        ]}
      />
      {adding && <AddWaterModal defaultMonth={month || '2026-09'} onClose={() => setAdding(false)} />}
      <ImportDrawer targetId="tax_water" open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function AddWaterModal({ defaultMonth, onClose }: { defaultMonth: string; onClose: () => void }) {
  const p = useP();
  const user = useUser();
  const br = useBranches();
  const { run } = useRunner();
  const [f, setF] = useState({ branchKey: 'R01', objectName: '', month: defaultMonth, source: 'surface' as TaxWaterSource, m3: '', method: 'meter' as TaxWaterMethod, docRef: '' });
  return (
    <Modal title={p('Водопотребление: показание или письмо', "Suv iste'moli: ko'rsatkich yoki xat", 'Water use: reading or letter')} onClose={onClose} footer={<><Button onClick={onClose}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => taxesApi.addWater({ branchKey: f.branchKey, objectName: f.objectName, month: f.month, source: f.source, m3: Number(f.m3), method: f.method, ...(f.docRef ? { docRef: f.docRef } : {}) }, user), p('Данные сохранены, расчёт обновлён', "Ma'lumotlar saqlandi, hisob yangilandi", 'Saved, return updated'))) onClose(); }}>{p('Сохранить', 'Saqlash', 'Save')}</Button></>}>
      <div className="form-grid">
        <Field label={p('Филиал', 'Filial', 'Branch')} required><Select<string> value={f.branchKey} onChange={(v) => setF({ ...f, branchKey: v })} options={br.options} /></Field>
        <Field label={p('Объект', 'Obyekt', 'Object')} required><Input value={f.objectName} onChange={(e) => setF({ ...f, objectName: e.target.value })} /></Field>
        <Field label={p('Месяц', 'Oy', 'Month')} required><Select<string> value={f.month} onChange={(v) => setF({ ...f, month: v })} options={MONTHS_2026.map((m) => ({ value: m, label: m }))} /></Field>
        <Field label={p('Источник', 'Manba', 'Source')} required><Select<TaxWaterSource> value={f.source} onChange={(v) => setF({ ...f, source: v })} options={[{ value: 'surface', label: p('поверхностный', 'yer usti', 'surface') }, { value: 'underground', label: p('подземный', 'yer osti', 'underground') }]} /></Field>
        <Field label={p('Объём, м³', 'Hajm, m³', 'Volume, m³')} required><Input value={f.m3} inputMode="numeric" onChange={(e) => setF({ ...f, m3: e.target.value })} /></Field>
        <Field label={p('Основание', 'Asos', 'Basis')} required><Select<TaxWaterMethod> value={f.method} onChange={(v) => setF({ ...f, method: v })} options={[{ value: 'meter', label: p('счётчик', 'hisoblagich', 'meter') }, { value: 'invoice', label: p('счёт-фактура', 'hisob-faktura', 'invoice') }, { value: 'letter', label: p('письмо водоканала', "suv ta'minoti xati", 'utility letter') }]} /></Field>
        <Field label={p('Документ', 'Hujjat', 'Document')} className="span-2"><Input value={f.docRef} onChange={(e) => setF({ ...f, docRef: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
function LeasesTab() {
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const can = useCan()('taxes', 'edit');
  const br = useBranches();
  const list = useApi(() => taxesApi.listLeases());
  const { busy, run } = useRunner();
  const [month, setMonth] = useState('2026-10');
  const [adding, setAdding] = useState(false);
  const rows = list.data ?? [];
  const IJ: Record<string, { tone: 'ok' | 'danger' | 'warn'; label: string }> = {
    registered: { tone: 'ok', label: p('зарегистрирован', "ro'yxatdan o'tgan", 'registered') },
    not_registered: { tone: 'danger', label: p('не зарегистрирован', "ro'yxatdan o'tmagan", 'not registered') },
    pending: { tone: 'warn', label: p('на регистрации', "ro'yxatga olinmoqda", 'pending') },
  };
  const pitPaid = (l: (typeof rows)[number]) => l.payments.filter((x) => x.status === 'paid').reduce((s, x) => s + x.pit, 0);
  return (
    <>
      <Bar>
        <Select<string> value={month} onChange={setMonth} options={MONTHS_2026.map((m) => ({ value: m, label: m }))} ariaLabel={p('Месяц оплаты', "To'lov oyi", 'Payment month')} />
        {can && (
          <>
            <Button size="small" icon="plus" onClick={() => setAdding(true)}>{p('Новый договор', 'Yangi shartnoma', 'New lease')}</Button>
            <Button size="small" icon="download" disabled={busy} onClick={() => run(() => taxesApi.loadLeasesFromAbs(user), (r: { added: number; status: string }) => `ABS: ${r.status}; +${r.added}`)}>{p('Реестр аренды из ABS', 'ABS dan ijara reyestri', 'Lease registry from ABS')}</Button>
          </>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <ExportButton filename="tax-lease-register" title={p('Реестр аренды', 'Ijara reyestri', 'Lease register')} rows={rows} columns={[
            { header: p('Договор', 'Shartnoma', 'Contract'), value: (l) => l.contractNo },
            { header: p('Арендодатель', 'Ijaraga beruvchi', 'Lessor'), value: (l) => l.lessorName },
            { header: p('ПИНФЛ / ИНН', 'JShShIR / STIR', 'PINFL / TIN'), value: (l) => l.lessorTin ?? l.lessorPinfl },
            { header: p('Адрес объекта', 'Obyekt manzili', 'Object address'), value: (l) => l.address },
            { header: p('Филиал', 'Filial', 'Branch'), value: (l) => l.branchKey },
            { header: p('Арендная плата', 'Ijara haqi', 'Rent'), value: (l) => l.monthlyRent, format: 'money' },
            { header: p('База (не ниже мин.)', 'Baza (minimaldan kam emas)', 'Base (≥ minimum)'), value: (l) => l.current.base, format: 'money' },
            { header: p('Срок', 'Muddat', 'Term'), value: (l) => `${l.startDate} — ${l.endDate}` },
            { header: 'ijara.soliq.uz', value: (l) => l.ijara.regNo ?? l.ijara.status },
            { header: p('Уплачено НДФЛ', "To'langan JShDS", 'PIT paid'), value: (l) => pitPaid(l), format: 'money', total: true },
          ]} />
          <PrintButton template="registry" label={p('Печать реестра', 'Reyestrni chop etish', 'Print register')} doc={() => ({
            entity: 'tax_lease_register', entityId: 'leases', title: p('Реестр аренды недвижимости у физических лиц', "Jismoniy shaxslardan ko'chmas mulk ijarasi reyestri", 'Register of property leased from individuals'), date: new Date().toISOString().slice(0, 10), landscape: true,
            table: { columns: [{ header: p('Договор', 'Shartnoma', 'Contract') }, { header: p('ПИНФЛ', 'JShShIR', 'PINFL') }, { header: p('Адрес', 'Manzil', 'Address') }, { header: p('Плата', 'Haq', 'Rent'), align: 'right' }, { header: 'ijara', align: 'center' }, { header: p('НДФЛ уплачен', "JShDS to'langan", 'PIT paid'), align: 'right' }], rows: rows.map((l) => [l.contractNo, l.lessorPinfl, l.address, formatMoney(l.monthlyRent), l.ijara.regNo ?? '—', formatMoney(pitPaid(l))]), totals: ['', '', '', '', '', formatMoney(rows.reduce((s, l) => s + pitPaid(l), 0))] },
          })} />
        </span>
      </Bar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(l) => l.id}
        columns={[
          { header: p('Договор / арендодатель', 'Shartnoma / ijaraga beruvchi', 'Contract / lessor'), render: (l) => <><div style={{ fontWeight: 600 }}>{l.contractNo} · {l.lessorName}</div><div className="sub">{p('ПИНФЛ', 'JShShIR', 'PINFL')} {l.lessorPinfl} · {l.address}</div><div className="sub">{br.name(l.branchKey)} · {lk.user(l.responsibleId)?.fullName}</div></> },
          { header: p('Тип, м²', 'Turi, m²', 'Type, m²'), render: (l) => `${l.objectType === 'residential' ? p('жилое', 'turar', 'resid.') : p('нежилое', 'noturar', 'non-res.')} · ${l.areaM2}` },
          { header: p('Плата / мин.', 'Haq / min.', 'Rent / min.'), align: 'right', render: (l) => <>{formatMoney(l.current.rent)}<div className="sub">{p('мин.', 'min.', 'min.')} {formatMoney(l.current.minRent)}</div></> },
          { header: p('База / НДФЛ', 'Baza / JShDS', 'Base / PIT'), align: 'right', render: (l) => <><b>{formatMoney(l.current.base)}</b>{l.current.recalculated && <div><Badge tone="warn">{p('по минимуму', "minimal bo'yicha", 'at minimum')}</Badge></div>}<div className="sub">{formatMoney(l.current.pit)}</div></> },
          { header: p('Срок', 'Muddat', 'Term'), render: (l) => <>{formatDate(l.endDate)} {l.daysToEnd < 0 ? <Badge tone="muted">{p('истёк', 'tugagan', 'expired')}</Badge> : l.daysToEnd <= 10 ? <Badge tone="warn">{l.daysToEnd} {p('дн.', 'kun', 'd')}</Badge> : null}</> },
          { header: 'ijara.soliq.uz', render: (l) => <><Badge tone={IJ[l.ijara.status]!.tone}>{IJ[l.ijara.status]!.label}</Badge>{l.ijara.regNo && <div className="sub">{l.ijara.regNo}</div>}</> },
          { header: p('Оплаты', "To'lovlar", 'Payments'), render: (l) => <span className="small">{l.payments.map((x) => `${x.month.slice(5)}${x.status === 'blocked' ? '⛔' : '✓'}`).join(' ') || '—'}</span> },
          {
            header: '',
            render: (l) =>
              can ? (
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button size="small" disabled={busy} onClick={() => run(() => taxesApi.checkIjara(l.id, user), (r: { status: string }) => `ijara.soliq.uz: ${IJ[r.status]?.label ?? r.status}`)}>{p('Проверить', 'Tekshirish', 'Check')}</Button>
                  {l.ijara.status !== 'registered' && <Button size="small" disabled={busy} onClick={() => run(() => taxesApi.registerIjara(l.id, user), (r: { status: string }) => `ijara.soliq.uz: ${IJ[r.status]?.label ?? r.status}`)}>{p('Зарегистрировать', "Ro'yxatdan o'tkazish", 'Register')}</Button>}
                  <Button size="small" type="primary" disabled={busy} onClick={() => run(() => taxesApi.payLease(l.id, month, user), p('Аренда оплачена, НДФЛ удержан', "Ijara to'landi, JShDS ushlab qolindi", 'Rent paid, PIT withheld'))}>{p('Оплатить', "To'lash", 'Pay')} {month.slice(5)}</Button>
                </span>
              ) : null,
          },
        ]}
      />
      {adding && <AddLeaseModal onClose={() => setAdding(false)} />}
    </>
  );
}

function AddLeaseModal({ onClose }: { onClose: () => void }) {
  const p = useP();
  const user = useUser();
  const br = useBranches();
  const { run } = useRunner();
  const [f, setF] = useState({ contractNo: '', lessorName: '', lessorPinfl: '', address: '', branchKey: 'R01', objectType: 'non_residential' as TaxLeaseObjectType, areaM2: '', monthlyRent: '', startDate: '2026-11-01', endDate: '2027-10-31' });
  return (
    <Modal title={p('Новый договор аренды у физического лица', "Jismoniy shaxs bilan yangi ijara shartnomasi", 'New lease from an individual')} onClose={onClose} footer={<><Button onClick={onClose}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => taxesApi.addLease({ contractNo: f.contractNo, lessorName: f.lessorName, lessorPinfl: f.lessorPinfl.trim(), address: f.address, branchKey: f.branchKey, objectType: f.objectType, areaM2: Number(f.areaM2), monthlyRent: Number(f.monthlyRent.replace(/\s/g, '')), startDate: f.startDate, endDate: f.endDate, responsibleId: user.id }, user), p('Договор добавлен; зарегистрируйте его на ijara.soliq.uz', "Shartnoma qo'shildi; uni ijara.soliq.uz da ro'yxatdan o'tkazing", 'Lease added; register it at ijara.soliq.uz'))) onClose(); }}>{p('Добавить', "Qo'shish", 'Add')}</Button></>}>
      <div className="form-grid">
        <Field label={p('Номер договора', 'Shartnoma raqami', 'Contract No.')} required><Input value={f.contractNo} onChange={(e) => setF({ ...f, contractNo: e.target.value })} /></Field>
        <Field label={p('Филиал', 'Filial', 'Branch')} required><Select<string> value={f.branchKey} onChange={(v) => setF({ ...f, branchKey: v })} options={br.options} /></Field>
        <Field label={p('Арендодатель (ФИО)', 'Ijaraga beruvchi (F.I.Sh.)', 'Lessor (full name)')} required><Input value={f.lessorName} onChange={(e) => setF({ ...f, lessorName: e.target.value })} /></Field>
        <Field label={p('ПИНФЛ', 'JShShIR', 'PINFL')} required hint="14"><Input value={f.lessorPinfl} inputMode="numeric" maxLength={14} onChange={(e) => setF({ ...f, lessorPinfl: e.target.value })} /></Field>
        <Field label={p('Адрес объекта', 'Obyekt manzili', 'Object address')} required className="span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label={p('Тип помещения', 'Joy turi', 'Premises type')} required><Select<TaxLeaseObjectType> value={f.objectType} onChange={(v) => setF({ ...f, objectType: v })} options={[{ value: 'non_residential', label: p('нежилое', 'noturar', 'non-residential') }, { value: 'residential', label: p('жилое', 'turar', 'residential') }]} /></Field>
        <Field label={p('Площадь, м²', 'Maydon, m²', 'Area, m²')} required><Input value={f.areaM2} inputMode="numeric" onChange={(e) => setF({ ...f, areaM2: e.target.value })} /></Field>
        <Field label={p('Плата в месяц', 'Oylik haq', 'Monthly rent')} required><Input value={f.monthlyRent} inputMode="numeric" onChange={(e) => setF({ ...f, monthlyRent: e.target.value })} /></Field>
        <Field label={p('Начало', 'Boshlanish', 'Start')} required><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label={p('Окончание', 'Tugash', 'End')} required><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
function MinRentTab() {
  const p = useP();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const list = useApi(() => taxesApi.listMinRent());
  const { run } = useRunner();
  const [importing, setImporting] = useState(false);
  const [f, setF] = useState({ year: '2027', regionCode: '*', objectType: 'non_residential' as TaxLeaseObjectType, rate: '' });
  return (
    <>
      <Bar>
        {can && (
          <>
            <Input value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} ariaLabel={p('Год', 'Yil', 'Year')} style={{ width: 90 }} />
            <Input value={f.regionCode} onChange={(e) => setF({ ...f, regionCode: e.target.value })} ariaLabel={p('Регион', 'Hudud', 'Region')} style={{ width: 70 }} />
            <Select<TaxLeaseObjectType> value={f.objectType} onChange={(v) => setF({ ...f, objectType: v })} options={[{ value: 'non_residential', label: p('нежилое', 'noturar', 'non-residential') }, { value: 'residential', label: p('жилое', 'turar', 'residential') }]} ariaLabel={p('Тип', 'Turi', 'Type')} />
            <Input value={f.rate} inputMode="numeric" placeholder={p('ставка за м²', 'm² stavkasi', 'rate per m²')} onChange={(e) => setF({ ...f, rate: e.target.value })} style={{ width: 140 }} />
            <Button size="small" type="primary" onClick={() => run(() => taxesApi.upsertMinRent({ year: Number(f.year), regionCode: f.regionCode, objectType: f.objectType, ratePerM2: Number(f.rate) }, user), p('Ставка сохранена', 'Stavka saqlandi', 'Rate saved'))}>{p('Сохранить ставку', 'Stavkani saqlash', 'Save rate')}</Button>
            <Button size="small" icon="upload" onClick={() => setImporting(true)}>{p('Импорт на новый год', 'Yangi yil uchun import', 'Import for new year')}</Button>
          </>
        )}
      </Bar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(m) => m.id}
        columns={[
          { header: p('Год', 'Yil', 'Year'), render: (m) => <b>{m.year}</b> },
          { header: p('Регион', 'Hudud', 'Region'), render: (m) => (m.regionCode === '*' ? p('все регионы', 'barcha hududlar', 'all regions') : m.regionCode) },
          { header: p('Тип помещения', 'Joy turi', 'Premises type'), render: (m) => (m.objectType === 'residential' ? p('жилое', 'turar', 'residential') : p('нежилое', 'noturar', 'non-residential')) },
          { header: p('Ставка за 1 м² в месяц', '1 m² uchun oylik stavka', 'Rate per m² per month'), align: 'right', render: (m) => formatMoney(m.ratePerM2) },
        ]}
      />
      <ImportDrawer targetId="tax_min_rent" open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function RatesTab() {
  const p = useP();
  const { t } = useSession();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const list = useApi(() => taxesApi.listRates());
  const { run } = useRunner();
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const TAX: Record<TaxRateTax, string> = {
    property: p('Имущество', 'Mol-mulk', 'Property'), property_construction: p('НЗС сверх нормативного срока', "Me'yoriy muddatdan o'tgan TQ", 'CIP beyond normative term'), land: p('Земля', 'Yer', 'Land'),
    water_surface: p('Вода (поверхностная)', 'Suv (yer usti)', 'Water (surface)'), water_underground: p('Вода (подземная)', 'Suv (yer osti)', 'Water (underground)'), pit_rent: p('НДФЛ по аренде', "Ijara bo'yicha JShDS", 'PIT on rent'), vat: p('НДС', 'QQS', 'VAT'), profit: p('Налог на прибыль', "Foyda solig'i", 'Profit tax'),
  };
  const KIND: Record<TaxRateKind, string> = { percent: '%', per_ha: p('за 1 га', '1 ga uchun', 'per ha'), per_m3: p('за 1 м³', '1 m³ uchun', 'per m³') };
  const SRC: Record<TaxRateSource, string> = { tax_code: p('Налоговый кодекс', 'Soliq kodeksi', 'Tax Code'), budget_law: p('Закон о Госбюджете', "Davlat byudjeti to'g'risidagi qonun", 'State Budget Law'), kengash: p('Решение кенгаша', 'Kengash qarori', 'Kengash decision') };
  return (
    <>
      <Bar>
        {can && <Button size="small" icon="plus" onClick={() => setAdding(true)}>{p('Новая ставка', 'Yangi stavka', 'New rate')}</Button>}
        {can && <Button size="small" icon="upload" onClick={() => setImporting(true)}>{p('Импорт ставок (Закон о Госбюджете / кенгаш)', 'Stavkalar importi (Byudjet qonuni / kengash)', 'Import rates (Budget Law / kengash)')}</Button>}
        <span className="muted small">{p('Новая версия ставки автоматически закрывает предыдущую; расчёты берут ставку, действующую на дату периода.', "Yangi versiya oldingisini avtomatik yopadi; hisoblar davr sanasida amal qiladigan stavkani oladi.", 'A new rate version closes the previous one; returns use the rate valid at the period date.')}</span>
      </Bar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(r) => r.id}
        columns={[
          { header: t('taxes_type'), render: (r) => <b>{TAX[r.tax]}</b> },
          { header: p('Значение', 'Qiymat', 'Value'), align: 'right', render: (r) => (r.kind === 'percent' ? `${String(r.value).replace('.', ',')}%` : `${formatMoney(r.value)} ${KIND[r.kind]}`) },
          { header: p('Регион', 'Hudud', 'Region'), render: (r) => (r.regionCode === '*' ? p('все', 'barchasi', 'all') : r.regionCode) },
          { header: p('Источник', 'Manba', 'Source'), render: (r) => <><div>{SRC[r.source]}</div><div className="sub">{r.docRef}</div></> },
          { header: p('Период действия', 'Amal qilish davri', 'Validity'), render: (r) => `${formatDate(r.validFrom)} — ${r.validTo ? formatDate(r.validTo) : '…'}` },
          { header: t('status'), render: (r) => (r.validFrom <= today && (!r.validTo || r.validTo >= today) ? <Badge tone="ok">{p('действует', 'amalda', 'active')}</Badge> : r.validFrom > today ? <Badge tone="info">{p('будущая', 'kelgusi', 'future')}</Badge> : <Badge tone="muted">{p('архив', 'arxiv', 'archived')}</Badge>) },
        ]}
      />
      {adding && <AddRateModal TAX={TAX} SRC={SRC} onClose={() => setAdding(false)} run={run} userId={user.id} />}
      <ImportDrawer targetId="tax_rates" open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function AddRateModal({ TAX, SRC, onClose, run }: { TAX: Record<TaxRateTax, string>; SRC: Record<TaxRateSource, string>; onClose: () => void; run: ReturnType<typeof useRunner>['run']; userId: string }) {
  const p = useP();
  const user = useUser();
  const [f, setF] = useState({ tax: 'land' as TaxRateTax, value: '', regionCode: '*', source: 'budget_law' as TaxRateSource, docRef: '', validFrom: '2027-01-01' });
  const kind: TaxRateKind = f.tax === 'land' ? 'per_ha' : f.tax.startsWith('water') ? 'per_m3' : 'percent';
  return (
    <Modal title={p('Новая ставка налога', 'Yangi soliq stavkasi', 'New tax rate')} onClose={onClose} footer={<><Button onClick={onClose}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => taxesApi.addRate({ tax: f.tax, kind, value: Number(f.value.replace(/\s/g, '').replace(',', '.')), regionCode: f.regionCode.trim() || '*', source: f.source, docRef: f.docRef, validFrom: f.validFrom }, user), p('Ставка добавлена', "Stavka qo'shildi", 'Rate added'))) onClose(); }}>{p('Добавить', "Qo'shish", 'Add')}</Button></>}>
      <div className="form-grid">
        <Field label={p('Налог', 'Soliq', 'Tax')} required><Select<TaxRateTax> value={f.tax} onChange={(v) => setF({ ...f, tax: v })} options={(Object.keys(TAX) as TaxRateTax[]).map((k) => ({ value: k, label: TAX[k] }))} /></Field>
        <Field label={`${p('Значение', 'Qiymat', 'Value')} (${kind === 'percent' ? '%' : kind === 'per_ha' ? p('за 1 га', '1 ga', 'per ha') : p('за 1 м³', '1 m³', 'per m³')})`} required><Input value={f.value} inputMode="decimal" onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label={p('Регион (01–14 или *)', 'Hudud (01–14 yoki *)', 'Region (01–14 or *)')} required><Input value={f.regionCode} onChange={(e) => setF({ ...f, regionCode: e.target.value })} /></Field>
        <Field label={p('Источник', 'Manba', 'Source')} required><Select<TaxRateSource> value={f.source} onChange={(v) => setF({ ...f, source: v })} options={(Object.keys(SRC) as TaxRateSource[]).map((k) => ({ value: k, label: SRC[k] }))} /></Field>
        <Field label={p('Документ', 'Hujjat', 'Document')} required className="span-2"><Input value={f.docRef} onChange={(e) => setF({ ...f, docRef: e.target.value })} /></Field>
        <Field label={p('Действует с', 'Amal qilish sanasi', 'Valid from')} required><Input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
function MonitorTab() {
  const p = useP();
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const br = useBranches();
  const list = useApi(() => taxesApi.listBaseChanges());
  const { busy, run } = useRunner();
  const KIND: Record<string, string> = {
    acquisition: p('приобретение', 'sotib olish', 'acquisition'), disposal: p('выбытие', 'chiqib ketish', 'disposal'), area_change: p('изменение площади', "maydon o'zgarishi", 'area change'), min_value: p('мин. стоимость my.soliq.uz', 'my.soliq.uz minimal qiymat', 'my.soliq.uz min. value'),
    abs_load: p('данные ABS / классификация', "ABS ma'lumotlari / tasnif", 'ABS data / classification'), rate_change: p('изменение ставки', "stavka o'zgarishi", 'rate change'), water: p('водопотребление', "suv iste'moli", 'water use'), lease: p('аренда', 'ijara', 'lease'), deadline: p('срок НЗС', 'TQ muddati', 'CIP deadline'),
  };
  return (
    <>
      <Bar>
        <Button size="small" icon="refresh" disabled={busy} onClick={() => run(async () => taxesApi.syncWithAssets(await assetsApi.list(), user), (n: number) => `${p('Синхронизация с модулем ОС: изменений', "AV moduli bilan sinxronlash: o'zgarishlar", 'Sync with fixed assets: changes')} ${n}`)}>{p('Синхронизировать с модулем ОС', 'AV moduli bilan sinxronlash', 'Sync with fixed assets')}</Button>
        <span className="muted small">{p('Приобретение и выбытие имущества, изменение площадей земли, ставок и данных источников автоматически пересчитывают открытые расчёты.', "Mol-mulkni sotib olish va chiqarish, yer maydonlari, stavkalar va manba ma'lumotlarining o'zgarishi ochiq hisoblarni avtomatik qayta hisoblaydi.", 'Acquisitions and disposals, land area, rate and source data changes automatically recalculate open returns.')}</span>
      </Bar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        emptyText={p('Изменений пока нет', "Hozircha o'zgarishlar yo'q", 'No changes yet')}
        rowKey={(c) => c.id}
        columns={[
          { header: p('Когда', 'Qachon', 'When'), render: (c) => <span className="small">{formatDateTime(c.at)}</span> },
          { header: p('Событие', 'Hodisa', 'Event'), render: (c) => <Badge tone="info">{KIND[c.kind] ?? c.kind}</Badge> },
          { header: t('taxes_type'), render: (c) => t(tk('taxes_type_', c.tax)) },
          { header: p('Объект', 'Obyekt', 'Object'), render: (c) => <><div>{c.ref}</div><div className="sub">{br.name(c.branchKey)}</div></> },
          { header: p('Было → стало', 'Edi → bo‘ldi', 'Before → after'), align: 'right', render: (c) => `${formatNumber(c.before)} → ${formatNumber(c.after)}` },
          { header: p('Пересчитано', 'Qayta hisoblandi', 'Recalculated'), render: (c) => (c.recalculated.length ? c.recalculated.join(', ') : '—') },
          { header: p('Пользователь', 'Foydalanuvchi', 'User'), render: (c) => (c.userId ? lk.user(c.userId)?.fullName : p('система', 'tizim', 'system')) },
        ]}
      />
    </>
  );
}

