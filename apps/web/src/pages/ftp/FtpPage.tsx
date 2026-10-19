import { useEffect, useState } from 'react';
import {
  decimalSep,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatMoney,
  formatMoneyShort,
  ftpApi,
  ftpInterpolate,
  ftpShapeFactor,
  importRegistry,
  tk,
  today,
  type FtpCurrency,
  type FtpCurve,
  type FtpInterpolation,
  type FtpProductResult,
  type FtpResults,
  type FtpSide,
  type FtpShiftShape, userError } from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Empty, Field, FilterBar, Input, LineChart, Loading, Modal, PageHeader, Select, Stat, Tabs, useToast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ExportButton } from '../../components/Export';
import { ImportWizard } from '../../components/Import';
import { useCan } from '../../lib/access';
import { navigate, useQuery } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { usePick } from '../budgeting/shared';
import { KhdTab, MethodologyTab, RegulatoryTab, RulesTab, RunsTab, useFtpErr } from './FtpTabs';
import '../budgeting/budgeting.css';

type Tab = 'curve' | 'products' | 'units' | 'khd' | 'methodology' | 'regulatory' | 'rules' | 'runs';
const TABS: Tab[] = ['curve', 'products', 'units', 'khd', 'methodology', 'regulatory', 'rules', 'runs'];

/** Ставки — всегда с фиксированным числом знаков и запятой: 19,50. */
export const fx = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits).replace('.', decimalSep()) : '—');
export const signed = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${fx(v, digits)}`;
export const pct = (v: number) => `${fx(v)}%`;
const marginStyle = (v: number) => ({ color: v < 0 ? 'var(--danger)' : 'var(--ok)', fontWeight: 600 });

const SHIFT_LIMIT = 1000;
const clampShift = (v: number) => Math.max(-SHIFT_LIMIT, Math.min(SHIFT_LIMIT, Math.round(v)));
export const tenorLabel = (m: number) => (m < 0.1 ? 'O/N' : m < 1 ? `${Math.round(m * 4)}W` : m >= 12 ? `${formatDecimal(m / 12, m % 12 ? 1 : 0)}Y` : `${m}M`);

export function FtpPage({ productId }: { productId?: string } = {}) {
  const { t, lang } = useSession();
  const p = usePick();
  const query = useQuery();
  const qTab = query.get('tab') as Tab | null;
  const [tab, setTabState] = useState<Tab>(productId ? 'products' : qTab && TABS.includes(qTab) ? qTab : 'curve');
  const [shiftBp, setShiftBpRaw] = useState(0);
  const setShiftBp = (v: number) => setShiftBpRaw(clampShift(v));
  const [shape, setShape] = useState<FtpShiftShape>('parallel');
  // Ссылка /ftp/products/:id (глобальный поиск) — вкладка продуктов с карточкой расчёта.
  useEffect(() => {
    if (productId) setTabState('products');
    else if (qTab && TABS.includes(qTab)) setTabState(qTab);
  }, [productId, qTab]);
  const setTab = (v: Tab) => {
    setTabState(v);
    if (productId || qTab) navigate('/ftp');
  };
  const res = useApi(() => ftpApi.compute(shiftBp, { shape }), [shiftBp, shape]);
  const meth = useApi(() => ftpApi.listMethodologies());
  const r = res.data;
  const short = (v: number) => formatMoneyShort(v, lang);
  const applied = meth.data?.find((m) => m.id === r?.methodologyId);

  return (
    <>
      <PageHeader title={t('ftp_title')} subtitle={`${t('tzLabel')} 4.2.15 · ${t('ftp_subtitle')}`} />
      <div className="grid grid-4">
        <Stat label={t('ftp_assets')} value={r ? short(r.bank.assets) : '—'} icon="chart" tone="accent" foot={r ? `${p('Методология', 'Metodologiya', 'Methodology')}: ${applied?.code ?? r.methodologyId} v${r.methodologyVersion}` : undefined} />
        <Stat label={t('ftp_liabilities')} value={r ? short(r.bank.liabilities) : '—'} icon="wallet" foot={r ? `LCR ${fx(r.liquidity.lcrPct, 1)}%` : undefined} />
        <Stat
          label={t('ftp_nii')}
          value={r ? short(r.bank.nii) : '—'}
          icon="coins"
          foot={r ? `${t('ftp_clientNii')} ${short(r.bank.clientNii)} · ${t('ftp_fundingNii')} ${short(r.bank.fundingNii)}` : undefined}
        />
        <Stat label={t('ftp_nim')} value={r ? pct(r.bank.nimPct) : '—'} icon="percent" />
      </div>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 650 }}>{t('ftp_shift')}</div>
          <input
            type="range"
            min={-300}
            max={300}
            step={25}
            value={shiftBp}
            onChange={(e) => setShiftBp(Number(e.target.value))}
            style={{ flex: 1, minWidth: 180, accentColor: 'var(--brand-600)' }}
            aria-label={t('ftp_shift')}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input className="input" type="number" step={25} min={-SHIFT_LIMIT} max={SHIFT_LIMIT} value={shiftBp} onChange={(e) => setShiftBp(Number(e.target.value) || 0)} style={{ width: 90 }} />
            <span className="muted">{t('ftp_shiftBp')}</span>
          </div>
          <Select<FtpShiftShape>
            value={shape}
            onChange={setShape}
            ariaLabel={p('Форма сдвига', 'Siljish shakli', 'Shift shape')}
            style={{ width: 'auto', minWidth: 170 }}
            options={[
              { value: 'parallel', label: p('Параллельный', 'Parallel', 'Parallel') },
              { value: 'steepen', label: p('Рост крутизны', 'Tiklik oshishi', 'Steepener') },
              { value: 'flatten', label: p('Уплощение', 'Yassilanish', 'Flattener') },
              { value: 'short', label: p('Только до 1 года', 'Faqat 1 yilgacha', 'Short end only') },
            ]}
          />
          <button className="btn btn-sm" disabled={shiftBp === 0 && shape === 'parallel'} onClick={() => { setShiftBp(0); setShape('parallel'); }}>{t('ftp_reset')}</button>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          {t('ftp_shiftHint')} {p('Боевые ставки и результаты по кредитам и депозитам принимаются из КХД (вкладка «КХД»); расчёт здесь — контрольный и сценарный.', 'Kreditlar va depozitlar bo‘yicha amaldagi stavka va natijalar KXO dan qabul qilinadi («KXO» yorlig‘i); bu yerdagi hisob — nazorat va ssenariy uchun.', 'Production rates and results for loans and deposits are received from the DWH (“DWH” tab); this calculation is for control and scenarios.')}
        </div>
      </Card>

      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'curve', label: t('ftp_tab_curve') },
            { value: 'products', label: t('ftp_tab_products'), ...(r ? { count: r.products.length } : {}) },
            { value: 'units', label: t('ftp_tab_units') },
            { value: 'khd', label: p('Приём из КХД', 'KXO dan qabul', 'DWH intake') },
            { value: 'methodology', label: p('Методологии', 'Metodologiyalar', 'Methodologies') },
            { value: 'regulatory', label: p('Регуляторика и ликвидность', 'Regulyator va likvidlik', 'Regulatory & liquidity') },
            { value: 'rules', label: p('Правила ставок', 'Stavka qoidalari', 'Rate rules') },
            { value: 'runs', label: p('Расчёты и история', 'Hisob-kitoblar va tarix', 'Runs & history') },
          ]}
        />
        {!r ? <Loading /> : tab === 'curve' ? <CurveTab shiftBp={shiftBp} shape={shape} /> : tab === 'products' ? <ProductsTab results={r} productId={productId} /> : tab === 'units' ? <UnitsTab results={r} /> : tab === 'khd' ? <KhdTab /> : tab === 'methodology' ? <MethodologyTab results={r} /> : tab === 'regulatory' ? <RegulatoryTab results={r} /> : tab === 'rules' ? <RulesTab /> : <RunsTab />}
      </Card>
    </>
  );
}

const CURVE_COLORS = ['var(--brand-600)', 'var(--info)', 'var(--warn)', 'var(--ok)', 'var(--danger)', 'var(--text-3)', 'var(--accent)'];

function CurveTab({ shiftBp, shape }: { shiftBp: number; shape: FtpShiftShape }) {
  const { t } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const canEdit = can('ftp', 'edit');
  const lk = useLookups();
  const toast = useToast();
  const err = useFtpErr();
  const [asOf, setAsOf] = useState(today());
  const curves = useApi(() => ftpApi.listCurves(asOf), [asOf]);
  const versions = useApi(() => ftpApi.listCurveVersions());
  const log = useApi(() => ftpApi.listCurveLog());
  const [edit, setEdit] = useState<{ currency: FtpCurrency; label: string; rate: number } | null>(null);
  const [addTenor, setAddTenor] = useState<{ currency: FtpCurrency; label: string; months: string; rate: string } | null>(null);
  const [newCurve, setNewCurve] = useState<{ currency: FtpCurrency; spread: string } | null>(null);
  const [market, setMarket] = useState<{ currency: FtpCurrency; short: 'mbk' | 'bloomberg' | 'refinitiv'; long: 'gov' | 'bloomberg' | 'refinitiv'; spread: string; validFrom: string } | null>(null);
  const [importing, setImporting] = useState(false);
  if (!curves.data) return <Loading />;
  const list = curves.data;
  const shift = shiftBp / 100;
  const isToday = asOf === today();
  const labels = [...new Map(list.flatMap((c) => c.points).sort((a, b) => a.tenorMonths - b.tenorMonths).map((x) => [x.label, x])).keys()];
  const series = [
    ...list.map((c, i) => ({ name: c.currency, values: labels.map((l) => c.points.find((x) => x.label === l)?.rate ?? ftpInterpolate(c, list[0]!.points.find((x) => x.label === l)?.tenorMonths ?? 12)), color: CURVE_COLORS[i % CURVE_COLORS.length] })),
    ...(shiftBp ? list.slice(0, 2).map((c, i) => ({ name: `${c.currency} ${signed(shiftBp, 0)} ${t('ftp_shiftBp')}`, values: labels.map((l) => { const pt = c.points.find((x) => x.label === l); return (pt?.rate ?? 0) + shift * ftpShapeFactor(shape, pt?.tenorMonths ?? 12); }), color: i ? 'var(--warn)' : 'var(--accent)' })) : []),
  ];
  const target = importRegistry.get('ftp_curve_points');
  const drafts = (versions.data ?? []).filter((v) => v.status === 'draft');
  const free = (['RUB', 'CNY', 'GBP', 'KZT'] as FtpCurrency[]).filter((c) => !list.some((x) => x.currency === c));

  return (
    <>
      <FilterBar>
        <Field label={p('Кривая на дату', 'Sanaga egri chiziq', 'Curve as of')}>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today())} ariaLabel={p('Кривая на дату', 'Sanaga egri chiziq', 'Curve as of')} />
        </Field>
        <span className="muted small" style={{ flex: 1 }}>{isToday ? p('Действующие версии кривых', 'Amaldagi egri chiziq versiyalari', 'Current curve versions') : p('Историческая кривая восстановлена по версиям на выбранную дату', 'Tanlangan sanaga versiyalar bo‘yicha tarixiy egri chiziq tiklandi', 'Historical curve restored from versions as of the selected date')}</span>
        {canEdit && isToday && (
          <>
            {target && <Button size="small" icon="upload" onClick={() => setImporting(true)}>{p('Импорт Excel/CSV', 'Excel/CSV import', 'Import Excel/CSV')}</Button>}
            <Button size="small" icon="globe" onClick={() => setMarket({ currency: 'UZS', short: 'mbk', long: 'gov', spread: '0', validFrom: today() })}>{p('Из источников', 'Manbalardan', 'From sources')}</Button>
            {free.length > 0 && <Button size="small" icon="plus" onClick={() => setNewCurve({ currency: free[0]!, spread: '50' })}>{p('Новая валюта', 'Yangi valyuta', 'New currency')}</Button>}
          </>
        )}
      </FilterBar>
      <div className="grid grid-main" style={{ padding: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Card title={`${t('ftp_curve')} · ${t('ftp_curveAsOf')} ${formatDate(asOf)}`}>
            <LineChart labels={labels} series={series} format={pct} height={240} />
            <div className="muted small" style={{ marginTop: 6 }}>
              {list.map((c) => `${c.currency}: v${c.version} ${p('с', 'dan', 'from')} ${formatDate(c.asOf)} · ${c.source} · ${c.interpolation}`).join(' | ')}
            </div>
          </Card>
          <Card title={t('ftp_log')} flush>
            {!log.data?.length ? (
              <Empty text={t('ftp_logEmpty')} icon="clock" />
            ) : (
              <DataTable
                rows={log.data}
                rowKey={(l) => `${l.at}-${l.label}-${l.currency}`}
                columns={[
                  { header: t('date'), render: (l) => <span className="num muted">{formatDateTime(l.at)}</span> },
                  { header: t('ftp_currency'), render: (l) => `${l.currency} · ${l.label}` },
                  { header: t('ftp_rate'), align: 'right', render: (l) => (Number.isFinite(l.from) ? `${fx(l.from)} → ${fx(l.to)}` : `+ ${fx(l.to)}`) },
                  { header: t('initiator'), render: (l) => lk.user(l.userId)?.fullName },
                ]}
              />
            )}
          </Card>
          <Card title={p('Версии кривых', 'Egri chiziq versiyalari', 'Curve versions')} flush>
            <DataTable
              rows={versions.data}
              rowKey={(v) => v.id}
              columns={[
                { header: t('ftp_currency'), render: (v) => <b>{v.currency} v{v.version}</b> },
                { header: p('Действует с', 'Amal qiladi', 'Effective from'), render: (v) => formatDate(v.validFrom) },
                { header: p('Источник', 'Manba', 'Source'), render: (v) => <Badge tone={v.source === 'khd' ? 'info' : v.source === 'manual' ? 'muted' : 'warn'}>{v.source}</Badge> },
                { header: p('Статус', 'Holat', 'Status'), render: (v) => <Badge tone={v.status === 'draft' ? 'warn' : 'ok'}>{v.status}</Badge> },
                { header: p('Комментарий', 'Izoh', 'Note'), render: (v) => <span className="small">{v.note}</span> },
                ...(canEdit ? [{ header: '', render: (v: (typeof drafts)[number]) => (v.status === 'draft' ? <Button size="small" onClick={async () => { try { await ftpApi.activateVersion(v.id, user); toast(`${v.currency} v${v.version}: ${p('активирована', 'faollashtirildi', 'activated')}`); } catch (e) { toast(err(e)); } }}>{p('Активировать', 'Faollashtirish', 'Activate')}</Button> : null) }] : []),
              ]}
            />
          </Card>
        </div>
        <Card title={`${t('ftp_curve')}, %`} flush>
          <CurveTable curves={list} onEdit={canEdit && isToday ? (currency, label, rate) => setEdit({ currency, label, rate }) : undefined} />
          {canEdit && isToday && (
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)' }}>
              {list.map((c) => (
                <div key={c.currency} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ width: 40 }}>{c.currency}</b>
                  <Select<FtpInterpolation>
                    value={c.interpolation}
                    ariaLabel={`${p('Интерполяция', 'Interpolyatsiya', 'Interpolation')} ${c.currency}`}
                    onChange={async (v) => { try { await ftpApi.setInterpolation(c.currency, v, user); toast(`${c.currency}: ${v}`); } catch (e) { toast(err(e)); } }}
                    options={[{ value: 'linear', label: 'Linear' }, { value: 'cubic', label: 'Cubic Spline' }, { value: 'flat', label: p('Ступенчатая', 'Pog‘onali', 'Flat (step)') }]}
                  />
                  <Button size="small" icon="plus" onClick={() => setAddTenor({ currency: c.currency, label: '', months: '', rate: '' })}>{p('Срок', 'Muddat', 'Tenor')}</Button>
                </div>
              ))}
            </div>
          )}
          {!canEdit && <div className="muted small" style={{ padding: '10px 18px' }}>{t('ftp_readOnly')}</div>}
        </Card>
        {edit && <EditPointModal point={edit} onClose={() => setEdit(null)} />}
      </div>
      {addTenor && (
        <Modal
          title={`${p('Новый срок кривой', 'Egri chiziqning yangi muddati', 'New curve tenor')} · ${addTenor.currency}`}
          onClose={() => setAddTenor(null)}
          footer={
            <>
              <Button onClick={() => setAddTenor(null)}>{t('cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await ftpApi.addTenor(addTenor.currency, addTenor.label, Number(addTenor.months.replace(',', '.')), Number(addTenor.rate.replace(',', '.')), user); toast(`${addTenor.currency} ${addTenor.label}: ${p('срок добавлен', 'muddat qo‘shildi', 'tenor added')}`); setAddTenor(null); } catch (e) { toast(err(e)); } }}>{t('save')}</Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={p('Обозначение', 'Belgilanish', 'Label')}><Input value={addTenor.label} onChange={(e) => setAddTenor({ ...addTenor, label: e.target.value })} placeholder="18M" ariaLabel={p('Обозначение срока', 'Muddat belgisi', 'Tenor label')} /></Field>
            <Field label={p('Срок, мес.', 'Muddat, oy', 'Tenor, months')}><Input value={addTenor.months} inputMode="decimal" onChange={(e) => setAddTenor({ ...addTenor, months: e.target.value })} ariaLabel={p('Срок, мес.', 'Muddat, oy', 'Tenor, months')} /></Field>
            <Field label={t('ftp_rate')} className="span-2"><Input value={addTenor.rate} inputMode="decimal" onChange={(e) => setAddTenor({ ...addTenor, rate: e.target.value })} ariaLabel={t('ftp_rate')} /></Field>
          </div>
        </Modal>
      )}
      {newCurve && (
        <Modal
          title={p('Новая кривая FTP', 'Yangi FTP egri chizig‘i', 'New FTP curve')}
          onClose={() => setNewCurve(null)}
          footer={
            <>
              <Button onClick={() => setNewCurve(null)}>{t('cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await ftpApi.createCurve(newCurve.currency, Number(newCurve.spread), user); toast(`${newCurve.currency}: ${p('кривая создана', 'egri chiziq yaratildi', 'curve created')}`); setNewCurve(null); } catch (e) { toast(err(e)); } }}>{p('Создать', 'Yaratish', 'Create')}</Button>
            </>
          }
        >
          <Field label={t('ftp_currency')}><Select<FtpCurrency> value={newCurve.currency} onChange={(v) => setNewCurve({ ...newCurve, currency: v })} options={free.map((c) => ({ value: c, label: c }))} ariaLabel={t('ftp_currency')} /></Field>
          <Field label={p('Спред к кривой USD, б.п.', 'USD egri chizig‘iga spred, b.p.', 'Spread to USD curve, bp')}><Input value={newCurve.spread} inputMode="numeric" onChange={(e) => setNewCurve({ ...newCurve, spread: e.target.value })} ariaLabel="spread" /></Field>
        </Modal>
      )}
      {market && (
        <Modal
          title={p('Автоформирование кривой из источников', 'Manbalardan egri chiziqni avtomatik shakllantirish', 'Build curve from sources')}
          onClose={() => setMarket(null)}
          footer={
            <>
              <Button onClick={() => setMarket(null)}>{t('cancel')}</Button>
              <Button type="primary" onClick={async () => { try { const v = await ftpApi.buildFromMarket(market.currency, market.short, market.long, Number(market.spread), market.validFrom, user); toast(`${v.currency} v${v.version}: ${p('черновик создан — требуется активация вторым сотрудником', 'qoralama yaratildi — ikkinchi xodim faollashtirishi kerak', 'draft created — activation by a second employee required')}`); setMarket(null); } catch (e) { toast(err(e)); } }}>{p('Сформировать', 'Shakllantirish', 'Build')}</Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={t('ftp_currency')}><Select<FtpCurrency> value={market.currency} onChange={(v) => setMarket({ ...market, currency: v })} options={list.map((c) => ({ value: c.currency, label: c.currency }))} ariaLabel={t('ftp_currency')} /></Field>
            <Field label={p('Действует с', 'Amal qiladi', 'Effective from')}><Input type="date" value={market.validFrom} onChange={(e) => setMarket({ ...market, validFrom: e.target.value })} ariaLabel={p('Действует с', 'Amal qiladi', 'Effective from')} /></Field>
            <Field label={p('Короткий конец (O/N–3M)', 'Qisqa uchi (O/N–3M)', 'Short end (O/N–3M)')}><Select<'mbk' | 'bloomberg' | 'refinitiv'> value={market.short} onChange={(v) => setMarket({ ...market, short: v })} options={[{ value: 'mbk', label: p('МБК (UZONIA)', 'BBK (UZONIA)', 'Interbank (UZONIA)') }, { value: 'bloomberg', label: 'Bloomberg' }, { value: 'refinitiv', label: 'Refinitiv' }]} ariaLabel="short" /></Field>
            <Field label={p('Длинный конец (6M–10Y)', 'Uzun uchi (6M–10Y)', 'Long end (6M–10Y)')}><Select<'gov' | 'bloomberg' | 'refinitiv'> value={market.long} onChange={(v) => setMarket({ ...market, long: v })} options={[{ value: 'gov', label: p('Доходность ГЦБ', 'DQQ daromadliligi', 'Government bond yields') }, { value: 'bloomberg', label: 'Bloomberg' }, { value: 'refinitiv', label: 'Refinitiv' }]} ariaLabel="long" /></Field>
            <Field label={p('Спред банка, б.п.', 'Bank spredi, b.p.', 'Bank spread, bp')} className="span-2"><Input value={market.spread} inputMode="numeric" onChange={(e) => setMarket({ ...market, spread: e.target.value })} ariaLabel="spread bp" /></Field>
          </div>
        </Modal>
      )}
      {importing && target && (
        <Modal title={p('Импорт кривой из Excel/CSV', 'Excel/CSV dan egri chiziq importi', 'Import curve from Excel/CSV')} onClose={() => setImporting(false)} footer={<Button onClick={() => setImporting(false)}>{p('Закрыть', 'Yopish', 'Close')}</Button>}>
          <ImportWizard target={target} onDone={() => toast(p('Черновики версий созданы', 'Versiya qoralamalari yaratildi', 'Draft versions created'))} />
        </Modal>
      )}
    </>
  );
}

function CurveTable({ curves, onEdit }: { curves: FtpCurve[]; onEdit?: (c: FtpCurrency, label: string, rate: number) => void }) {
  const { t } = useSession();
  const labels = [...new Map(curves.flatMap((c) => c.points).sort((a, b) => a.tenorMonths - b.tenorMonths).map((x) => [x.label, x])).keys()];
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t('ftp_tenor')}</th>
            {curves.map((c) => (
              <th key={c.currency} className="right">{c.currency}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label) => (
            <tr key={label}>
              <td style={{ fontWeight: 600 }}>{label}</td>
              {curves.map((c) => {
                const p = c.points.find((x) => x.label === label);
                return (
                  <td key={c.currency} className="right num">
                    {!p ? '—' : onEdit ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => onEdit(c.currency, label, p.rate)} title={t('ftp_editPoint')}>
                        {fx(p.rate)}
                        <Icon name="chevronRight" size={12} />
                      </button>
                    ) : (
                      fx(p.rate)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditPointModal({ point, onClose }: { point: { currency: FtpCurrency; label: string; rate: number }; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const [value, setValue] = useState(fx(point.rate));
  const [error, setError] = useState('');
  const rate = Number(value.replace(',', '.'));
  return (
    <Modal
      title={`${t('ftp_editPoint')}: ${point.currency} ${point.label}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (!value.trim() || !Number.isFinite(rate) || rate < 0 || rate > 100) return setError(t('ftp_invalidRate'));
              try {
                await ftpApi.updateCurvePoint(point.currency, point.label, rate, user);
                toast(`${point.currency} ${point.label}: ${t('ftp_pointSaved')}`);
                onClose();
              } catch (e) {
                setError(userError(e));
              }
            }}
          >
            {t('save')}
          </button>
        </>
      }
    >
      <Field label={t('ftp_rate')} required error={error}>
        <input className="input" inputMode="decimal" autoFocus value={value} onChange={(e) => { setValue(e.target.value); setError(''); }} />
      </Field>
    </Modal>
  );
}

function ProductsTab({ results, productId }: { results: FtpResults; productId?: string }) {
  const { t, loc, lang } = useSession();
  const p = usePick();
  const units = useApi(() => ftpApi.listUnits());
  const [side, setSide] = useState<FtpSide | ''>('');
  const [unit, setUnit] = useState('');
  const [openId, setOpenId] = useState<string | null>(productId ?? null);
  useEffect(() => {
    if (productId) setOpenId(productId);
  }, [productId]);
  const open = results.products.find((x) => x.id === openId);
  const rows = results.products.filter((x) => (!side || x.side === side) && (!unit || x.unitId === unit));
  const unitName = (id: string) => {
    const u = units.data?.find((x) => x.id === id);
    return u ? loc(u.name) : id;
  };

  return (
    <>
      <FilterBar>
        <select className="select" value={side} onChange={(e) => setSide(e.target.value as FtpSide | '')} aria-label={t('ftp_side')}>
          <option value="">{t('ftp_side')}: {t('ftp_all')}</option>
          <option value="asset">{t('ftp_side_asset')}</option>
          <option value="liability">{t('ftp_side_liability')}</option>
        </select>
        <select className="select" style={{ width: 280 }} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={t('ftp_unit')}>
          <option value="">{t('ftp_unit')}: {t('ftp_all')}</option>
          {units.data?.map((u) => (
            <option key={u.id} value={u.id}>{loc(u.name)}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <ExportButton<FtpProductResult>
          filename="ftp-products"
          rows={rows}
          columns={[
            { header: t('ftp_product'), value: (x) => loc(x.name) },
            { header: t('ftp_unit'), value: (x) => unitName(x.unitId) },
            { header: t('ftp_side'), value: (x) => t(tk('ftp_side_', x.side)) },
            { header: t('ftp_currency'), value: (x) => x.currency },
            { header: t('ftp_balance'), value: (x) => x.balance, format: 'money', total: true },
            { header: t('ftp_tenor'), value: (x) => tenorLabel(x.tenorMonths) },
            { header: t('ftp_clientRate'), value: (x) => x.clientRate, format: 'number' },
            { header: t('ftp_curveRate'), value: (x) => x.curveRate, format: 'number' },
            { header: 'LP', value: (x) => x.lp, format: 'number' },
            { header: p('ФОР+LCR', 'MZF+LCR', 'Reserves+LCR'), value: (x) => x.reg, format: 'number' },
            { header: p('Правила', 'Qoidalar', 'Rules'), value: (x) => x.adj, format: 'number' },
            { header: t('ftp_ftpRate'), value: (x) => x.ftpRate, format: 'number' },
            { header: t('ftp_margin'), value: (x) => x.margin, format: 'number' },
            { header: t('ftp_contribution'), value: (x) => x.clientNii, format: 'money', total: true },
          ]}
        />
      </FilterBar>
      <DataTable<FtpProductResult>
        rows={rows}
        rowKey={(x) => x.id}
        onRowClick={(x) => setOpenId(x.id)}
        columns={[
          {
            header: t('ftp_product'),
            render: (x) => (
              <>
                <div style={{ fontWeight: 600 }}>{loc(x.name)}</div>
                <div className="sub">{unitName(x.unitId)}</div>
              </>
            ),
          },
          { header: t('ftp_side'), render: (x) => <span className={`badge ${x.side === 'asset' ? 'info' : 'muted'}`}>{t(tk('ftp_side_', x.side))}</span> },
          { header: t('ftp_currency'), render: (x) => x.currency },
          { header: t('ftp_balance'), align: 'right', render: (x) => formatMoneyShort(x.balance, lang) },
          { header: t('ftp_tenor'), align: 'right', render: (x) => tenorLabel(x.tenorMonths) },
          { header: t('ftp_clientRate'), align: 'right', render: (x) => pct(x.clientRate) },
          { header: p('По кривой', 'Egri chiziq bo‘yicha', 'Curve'), align: 'right', render: (x) => pct(x.curveRate) },
          { header: p('Надбавки', 'Ustamalar', 'Add-ons'), align: 'right', render: (x) => <span className="muted small">{signed(x.lp + x.adj - x.reg)}</span> },
          { header: t('ftp_ftpRate'), align: 'right', render: (x) => <b>{pct(x.ftpRate)}</b> },
          { header: t('ftp_margin'), align: 'right', render: (x) => <span style={marginStyle(x.margin)}>{signed(x.margin)}%</span> },
          { header: t('ftp_contribution'), align: 'right', render: (x) => <span style={marginStyle(x.clientNii)}>{formatMoneyShort(x.clientNii, lang)}</span> },
        ]}
      />
      {open && (
        <ProductModal
          product={open}
          shiftBp={results.shiftBp}
          unitName={unitName(open.unitId)}
          onClose={() => {
            setOpenId(null);
            if (productId) navigate('/ftp');
          }}
        />
      )}
    </>
  );
}

/** Карточка продукта: как получена ставка FTP (кривая + сдвиг + LP − ФОР/LCR + правила), маржа и доход. */
function ProductModal({ product: x, shiftBp, unitName, onClose }: { product: FtpProductResult; shiftBp: number; unitName: string; onClose: () => void }) {
  const { t, loc } = useSession();
  const p = usePick();
  const curves = useApi(() => ftpApi.listCurves());
  const rules = useApi(() => ftpApi.listRules());
  const curve = curves.data?.find((c) => c.currency === x.currency);
  const pts = curve ? [...curve.points].sort((a, b) => a.tenorMonths - b.tenorMonths) : [];
  const node = pts.find((q) => q.tenorMonths === x.tenorMonths);
  const hi = pts.findIndex((q) => q.tenorMonths > x.tenorMonths);
  const a = hi > 0 ? pts[hi - 1] : undefined;
  const b = hi > 0 ? pts[hi] : undefined;
  const base = curve ? ftpInterpolate(curve, x.tenorMonths) : 0;
  const f2 = (v: number) => fx(v);
  let how: string;
  if (node) how = `${t('ftp_nodeRate')} ${node.label}: ${f2(node.rate)}%`;
  else if (a && b) how = `${t('ftp_interpolation')} (${curve?.interpolation}): ${f2(a.rate)} … ${f2(b.rate)} → ${f2(base)}%`;
  else how = `${t('ftp_extrapolation')}: ${f2(base)}%`;
  return (
    <Modal title={loc(x.name)} onClose={onClose} footer={<button className="btn" onClick={onClose}>{t('ftp_close')}</button>}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`badge ${x.side === 'asset' ? 'info' : 'muted'}`}>{t(tk('ftp_side_', x.side))}</span>
        <span className="small muted">{unitName} · {x.currency} · {tenorLabel(x.tenorMonths)}</span>
      </div>
      <div style={{ fontWeight: 650 }}>{t('ftp_calcDetail')}</div>
      <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
        <dt>{t('ftp_balance')}</dt>
        <dd className="num">{formatMoney(x.balance)}</dd>
        <dt>{t('ftp_curveRate')} ({tenorLabel(x.tenorMonths)})</dt>
        <dd className="num">{curve ? `${f2(base)}%` : '—'}</dd>
        <dt>{t('ftp_shift')}</dt>
        <dd className="num">{signed(shiftBp, 0)} {t('ftp_shiftBp')}</dd>
        <dt>{p('Надбавка за ликвидность (LP)', 'Likvidlik ustamasi (LP)', 'Liquidity premium (LP)')}</dt>
        <dd className="num">{signed(x.lp)}</dd>
        {x.side === 'liability' && (
          <>
            <dt>{p('Стоимость ФОР', 'MZF qiymati', 'Reserve requirement cost')}</dt>
            <dd className="num">{signed(-x.reserveCost)}</dd>
            <dt>{p('Стоимость LCR (HQLA)', 'LCR (HQLA) qiymati', 'LCR (HQLA) cost')}</dt>
            <dd className="num">{signed(-x.lcrCost)}</dd>
          </>
        )}
        <dt>{p('Правила применения', 'Qo‘llash qoidalari', 'Application rules')}</dt>
        <dd className="num">{signed(x.adj)}{x.rules.length ? ` (${x.rules.map((id) => rules.data?.find((r) => r.id === id)?.name ?? id).join('; ')})` : ''}</dd>
        <dt>{t('ftp_ftpRate')}</dt>
        <dd className="num" style={{ fontWeight: 700 }}>{pct(x.ftpRate)}</dd>
        <dt>{t('ftp_clientRate')}</dt>
        <dd className="num">{pct(x.clientRate)}</dd>
        <dt>{t('ftp_margin')}</dt>
        <dd className="num" style={marginStyle(x.margin)}>{signed(x.margin)}%</dd>
        <dt>{t('ftp_contribution')}, {t('ftp_annual')}</dt>
        <dd className="num" style={marginStyle(x.clientNii)}>{formatMoney(x.clientNii)}</dd>
        <dt>{t('ftp_ftpCharge')}</dt>
        <dd className="num">{formatMoney(x.ftpCharge)}</dd>
      </dl>
      {curve && <div className="muted small">{how}</div>}
    </Modal>
  );
}

function UnitsTab({ results }: { results: FtpResults }) {
  const { t, loc, lang } = useSession();
  const p = usePick();
  const units = useApi(() => ftpApi.listUnits());
  const khd = useApi(() => ftpApi.acceptedKhd());
  const [source, setSource] = useState<'calc' | 'khd'>('calc');
  const unitName = (id: string) => {
    const u = units.data?.find((x) => x.id === id);
    return u ? loc(u.name) : id;
  };
  const short = (v: number) => formatMoneyShort(v, lang);
  const sumCheck = results.units.reduce((s, u) => s + u.totalNii, 0);
  const khdByUnit = (unitId: string) => (khd.data?.rows ?? []).filter((r) => r.unitId === unitId);

  return (
    <>
      <FilterBar>
        <Select<'calc' | 'khd'> value={source} onChange={setSource} ariaLabel={p('Источник', 'Manba', 'Source')} options={[{ value: 'calc', label: p('Контрольный расчёт XB-ERP', 'XB-ERP nazorat hisobi', 'XB-ERP control calculation') }, { value: 'khd', label: `${p('Результаты КХД', 'KXO natijalari', 'DWH results')}${khd.data ? ` · ${khd.data.period} v${khd.data.version}` : ''}` }]} />
        <span className="muted small" style={{ flex: 1 }}>{t('ftp_unitsHint')}</span>
        <ExportButton
          filename="ftp-units"
          rows={results.units}
          columns={[
            { header: t('ftp_unit'), value: (u) => unitName(u.unitId) },
            { header: t('ftp_assets'), value: (u) => u.assets, format: 'money', total: true },
            { header: t('ftp_liabilities'), value: (u) => u.liabilities, format: 'money', total: true },
            { header: p('Плата за ресурсы', 'Resurslar uchun to‘lov', 'Funding charge'), value: (u) => u.ftpExpense, format: 'money', total: true },
            { header: p('Кредит за ресурсы', 'Resurslar uchun kredit', 'Funding credit'), value: (u) => u.ftpIncome, format: 'money', total: true },
            { header: t('ftp_clientNii'), value: (u) => u.clientNii, format: 'money', total: true },
            { header: t('ftp_fundingNii'), value: (u) => u.fundingNii, format: 'money', total: true },
            { header: t('ftp_nii'), value: (u) => u.totalNii, format: 'money', total: true },
            { header: 'NIM, %', value: (u) => u.nimPct, format: 'number' },
          ]}
        />
      </FilterBar>
      {source === 'khd' ? (
        !khd.data ? (
          <Empty text={p('Нет принятой версии результатов КХД', 'KXO natijalarining qabul qilingan versiyasi yo‘q', 'No accepted DWH results version')} />
        ) : (
          <DataTable
            rows={results.units}
            rowKey={(u) => u.unitId}
            columns={[
              { header: t('ftp_unit'), render: (u) => <span style={{ fontWeight: 600 }}>{unitName(u.unitId)}</span> },
              { header: p('Остатки (КХД)', 'Qoldiqlar (KXO)', 'Balances (DWH)'), align: 'right', render: (u) => short(khdByUnit(u.unitId).reduce((s, r) => s + (r.balance ?? 0), 0)) },
              { header: p('Трансфертные расходы (КХД)', 'Transfer xarajatlari (KXO)', 'Transfer expense (DWH)'), align: 'right', render: (u) => short(khdByUnit(u.unitId).filter((r) => results.products.find((x) => x.id === r.productId)?.side === 'asset').reduce((s, r) => s + (r.ftpCharge ?? 0), 0)) },
              { header: p('Трансфертные доходы (КХД)', 'Transfer daromadlari (KXO)', 'Transfer income (DWH)'), align: 'right', render: (u) => short(khdByUnit(u.unitId).filter((r) => results.products.find((x) => x.id === r.productId)?.side === 'liability').reduce((s, r) => s + (r.ftpCharge ?? 0), 0)) },
              { header: p('Контрольный расчёт: расход / доход', 'Nazorat hisobi: xarajat / daromad', 'Control: expense / income'), align: 'right', render: (u) => `${short(u.ftpExpense)} / ${short(u.ftpIncome)}` },
            ]}
          />
        )
      ) : (
        <DataTable
          rows={results.units}
          rowKey={(u) => u.unitId}
          columns={[
            { header: t('ftp_unit'), render: (u) => <span style={{ fontWeight: 600 }}>{unitName(u.unitId)}</span> },
            { header: t('ftp_assets'), align: 'right', render: (u) => short(u.assets) },
            { header: t('ftp_liabilities'), align: 'right', render: (u) => short(u.liabilities) },
            { header: p('Плата / кредит FTP', 'FTP to‘lov / kredit', 'FTP charge / credit'), align: 'right', render: (u) => `${short(u.ftpExpense)} / ${short(u.ftpIncome)}` },
            { header: t('ftp_clientNii'), align: 'right', render: (u) => short(u.clientNii) },
            { header: t('ftp_fundingNii'), align: 'right', render: (u) => (u.fundingNii ? short(u.fundingNii) : '—') },
            { header: t('ftp_nii'), align: 'right', render: (u) => <b>{short(u.totalNii)}</b> },
            { header: `${t('ftp_clientNii')}, %`, align: 'right', render: (u) => pct(u.clientMarginPct) },
            { header: `${t('ftp_fundingNii')}, %`, align: 'right', render: (u) => pct(u.fundingMarginPct) },
            { header: 'NIM', align: 'right', render: (u) => <b>{pct(u.nimPct)}</b> },
          ]}
        />
      )}
      <div style={{ padding: 18, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 650, marginBottom: 8 }}>{t('ftp_niiChart')}</div>
        <BarChart
          height={200}
          data={results.units.map((u) => ({ label: unitName(u.unitId).split(' (')[0]!, values: [u.clientNii, u.fundingNii] }))}
          series={[{ name: t('ftp_clientNii') }, { name: t('ftp_fundingNii'), color: 'var(--accent)' }]}
          format={short}
        />
        <div className="small muted" style={{ marginTop: 10 }}>
          {t('ftp_check')}: {short(sumCheck)} = {short(results.bank.nii)} {sumCheck === results.bank.nii ? '✓' : '✗'}
        </div>
      </div>
    </>
  );
}
