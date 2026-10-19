import { useEffect, useState, type ReactNode } from 'react';
import { currencyLabel, formatDate, formatMoneyShort, formatNumber, IFRS_ADJUSTMENT_TEMPLATES, IFRS_ALL_LINES, IFRS_EXPENSE_LINES, IFRS_INCOME_LINES, ifrsApi, ifrsCanEdit, tk, type TKey, type IfrsAdjustment, type IfrsAdjustmentType, type IfrsConsolidatedRow, type IfrsConsolidation, type IfrsLine, userMessage } from '@xb/shared';
import { Badge, Card, DataTable, Field, Loading, Modal, PageHeader, Progress, Stat, Tabs, useToast, type Column } from '../../components/ui';
import { Icon } from '../../components/icons';
import { useLocation } from '../../lib/router';
import { useP } from '../taxes/common';
import { CoaTab, ElimsTab, NsiTab, PackagesTab } from './IfrsSubsTabs';
import { AutoAdjTab, BudgetTab, CashFlowTab, FaMoveTab, FlagsTab, KpiTab } from './IfrsAnalyticsTabs';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';

type Tab = 'structure' | 'mapping' | 'adjustments' | 'sfp' | 'pl' | 'close' | 'packages' | 'coa' | 'nsi' | 'elims' | 'auto' | 'fa' | 'cashflow' | 'kpi' | 'budget' | 'flags';
const TABS: Tab[] = ['sfp', 'pl', 'structure', 'mapping', 'adjustments', 'close', 'packages', 'coa', 'nsi', 'elims', 'auto', 'fa', 'cashflow', 'kpi', 'budget', 'flags'];
const tabFromPath = (path: string): Tab | null => {
  const v = new URLSearchParams(path.split('?')[1] ?? '').get('tab');
  return TABS.includes(v as Tab) ? (v as Tab) : null;
};
/** Текст ошибки API: ключ словаря модуля или исходное сообщение. */
const errText = (e: unknown, t: (k: TKey) => string) => {
  const m = e instanceof Error ? e.message : String(e);
  return m.startsWith('ifrs_') ? t(m as TKey) : userMessage(m);
};
const mln = (v: number) => formatNumber(Math.round(v / 1_000_000));
const ADJ_TYPES: IfrsAdjustmentType[] = ['ecl', 'lease', 'deferred_tax', 'fair_value'];

/** Влияние набора строк проводки на прибыль: доходы +, расходы −. */
function profitEffect(lines: { line: IfrsLine; delta: number }[]): number {
  return lines.reduce((s, l) => s + (IFRS_INCOME_LINES.includes(l.line as never) ? l.delta : IFRS_EXPENSE_LINES.includes(l.line as never) ? -l.delta : 0), 0);
}

export function IfrsPage() {
  const { t, lang } = useSession();
  const p = useP();
  const path = useLocation();
  const [tab, setTab] = useState<Tab>(() => tabFromPath(path) ?? 'sfp');
  // Переход из глобального поиска (/ifrs?tab=…) открывает нужную вкладку и на уже открытом экране.
  useEffect(() => {
    const fromUrl = tabFromPath(path);
    if (fromUrl) setTab(fromUrl);
  }, [path]);
  const cons = useApi(() => ifrsApi.getConsolidation());
  const tasks = useApi(() => ifrsApi.listCloseTasks());
  const c = cons.data;
  const done = tasks.data?.filter((x) => x.done).length ?? 0;
  const total = tasks.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title={t('ifrs_title')}
        subtitle={t('ifrs_subtitle')}
        actions={
          c && (
            <>
              <Badge tone="info">
                {t('ifrs_period')}: {formatDate(c.period)}
              </Badge>
              {c.balanced ? <Badge tone="ok">{t('ifrs_balanced')}</Badge> : <Badge tone="danger">{t('ifrs_not_balanced')}</Badge>}
            </>
          )
        }
      />

      <div className="grid grid-4">
        <Stat label={t('ifrs_kpi_assets')} value={c ? `${formatMoneyShort(c.totalAssets, lang)} ${currencyLabel()}` : '—'} tone="accent" icon="globe" foot={c && `${t('ifrs_goodwill_note')}: ${formatMoneyShort(c.goodwill, lang)}`} />
        <Stat label={t('ifrs_kpi_profit')} value={c ? `${formatMoneyShort(c.profitOwners, lang)} ${currencyLabel()}` : '—'} icon="chart" foot={c && `${t('ifrs_line_net_profit')}: ${formatMoneyShort(c.netProfit, lang)}`} />
        <Stat label={t('ifrs_kpi_nci')} value={c ? `${formatMoneyShort(c.nci, lang)} ${currencyLabel()}` : '—'} icon="pie" foot={c && `${t('ifrs_line_profit_nci')}: ${formatMoneyShort(c.profitNci, lang)}`} />
        <Stat
          label={t('ifrs_kpi_close')}
          value={`${done}/${total}`}
          tone={c && c.unmappedAccounts > 0 ? 'alert' : undefined}
          icon="check"
          foot={c && (c.unmappedAccounts ? `${t('ifrs_unmapped')}: ${c.unmappedAccounts}` : t('ifrs_all_mapped'))}
        />
      </div>

      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'sfp', label: t('ifrs_tab_sfp') },
            { value: 'pl', label: t('ifrs_tab_pl') },
            { value: 'structure', label: t('ifrs_tab_structure') },
            { value: 'mapping', label: t('ifrs_tab_mapping'), ...(c?.unmappedAccounts ? { count: c.unmappedAccounts } : {}) },
            { value: 'adjustments', label: t('ifrs_tab_adjustments') },
            { value: 'close', label: t('ifrs_tab_close'), count: total - done },
            { value: 'packages', label: p('Сбор данных дочерних', "Sho'ba korxonalar ma'lumotlari", 'Subsidiary data') },
            { value: 'coa', label: p('План счетов и маппинг', 'Hisobvaraqlar rejasi va mapping', 'Chart of accounts & mapping') },
            { value: 'nsi', label: p('НСИ', "MMA", 'Master data') },
            { value: 'elims', label: p('Элиминации и дивиденды', 'Eliminatsiyalar va dividendlar', 'Eliminations & dividends') },
            { value: 'auto', label: p('Автокорректировки (ОС, МСФО 16)', 'Avtotuzatishlar (AV, MHXS 16)', 'Auto adjustments (FA, IFRS 16)') },
            { value: 'fa', label: p('Движение ОС', 'AV harakati', 'FA movement') },
            { value: 'cashflow', label: p('Денежные потоки', "Pul oqimlari", 'Cash flows') },
            { value: 'kpi', label: 'KPI' },
            { value: 'budget', label: p('План-факт и ZBB', 'Reja-fakt va ZBB', 'Plan vs actual & ZBB') },
            { value: 'flags', label: p('Красные флажки', 'Qizil bayroqlar', 'Red flags') },
          ]}
        />
        {!c ? (
          <Loading />
        ) : tab === 'sfp' ? (
          <Statement c={c} rows={c.sfp} />
        ) : tab === 'pl' ? (
          <Statement c={c} rows={c.pl} />
        ) : tab === 'structure' ? (
          <Structure c={c} />
        ) : tab === 'mapping' ? (
          <Mapping />
        ) : tab === 'adjustments' ? (
          <Adjustments />
        ) : tab === 'packages' ? (
          <PackagesTab />
        ) : tab === 'coa' ? (
          <CoaTab />
        ) : tab === 'nsi' ? (
          <NsiTab />
        ) : tab === 'elims' ? (
          <ElimsTab />
        ) : tab === 'auto' ? (
          <AutoAdjTab />
        ) : tab === 'fa' ? (
          <FaMoveTab />
        ) : tab === 'cashflow' ? (
          <CashFlowTab />
        ) : tab === 'kpi' ? (
          <KpiTab />
        ) : tab === 'budget' ? (
          <BudgetTab />
        ) : tab === 'flags' ? (
          <FlagsTab />
        ) : (
          <CloseChecklist />
        )}
      </Card>
    </>
  );
}

const SECTION_BEFORE: Partial<Record<IfrsConsolidatedRow['line'], 'ifrs_section_assets' | 'ifrs_section_liabilities' | 'ifrs_section_equity'>> = {
  cash: 'ifrs_section_assets',
  deposits: 'ifrs_section_liabilities',
  share_capital: 'ifrs_section_equity',
};

function Statement({ c, rows }: { c: IfrsConsolidation; rows: IfrsConsolidatedRow[] }) {
  const { t } = useSession();
  const span = c.entities.length + 3;
  return (
    <div className="table-wrap">
      <table className="table" style={{ minWidth: 980 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 260 }}>{t('ifrs_line')}, {t('ifrs_in_mln')}</th>
            {c.entities.map((e) => (
              <th key={e.id} className="right" title={e.name}>
                {e.shortName}
              </th>
            ))}
            <th className="right">{t('ifrs_eliminations')}</th>
            <th className="right">{t('ifrs_consolidated')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const section = SECTION_BEFORE[r.line];
            const strong = r.kind !== 'line';
            const style = r.kind === 'total' ? { fontWeight: 700, background: 'var(--surface-2)' } : strong ? { fontWeight: 600 } : undefined;
            return (
              <FragmentRows key={r.line} section={section ? t(section) : undefined} span={span}>
                <tr style={style}>
                  <td style={r.line === 'profit_owners' || r.line === 'profit_nci' ? { paddingLeft: 30 } : undefined}>{t(tk('ifrs_line_', r.line))}</td>
                  {c.entities.map((e) => (
                    <td key={e.id} className="right num">
                      {mln(r.byEntity[e.id] ?? 0)}
                    </td>
                  ))}
                  <td className="right num" style={{ color: r.eliminations ? 'var(--danger)' : 'var(--text-3)' }}>
                    {r.eliminations ? mln(r.eliminations) : '—'}
                  </td>
                  <td className="right num" style={{ fontWeight: 700 }}>
                    {mln(r.consolidated)}
                  </td>
                </tr>
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
      {!c.balanced && (
        <p className="error-text" style={{ padding: '0 14px 14px' }}>
          {t('ifrs_not_balanced')} · {t('ifrs_difference')}: {mln(c.totalAssets - c.totalLiabilitiesAndEquity)} {t('ifrs_in_mln')}
        </p>
      )}
    </div>
  );
}

function FragmentRows({ section, span, children }: { section?: string; span: number; children: ReactNode }) {
  return (
    <>
      {section && (
        <tr>
          <td colSpan={span} style={{ background: 'var(--brand-50)', fontWeight: 700, color: 'var(--brand-700)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {section}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

function Structure({ c }: { c: IfrsConsolidation }) {
  const { t, loc, lang } = useSession();
  const summaries = useApi(() => ifrsApi.entitySummaries());
  const ig = useApi(() => ifrsApi.listIntragroup());
  const entities = useApi(() => ifrsApi.listEntities());
  const name = (id: string) => entities.data?.find((e) => e.id === id)?.shortName ?? id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <DataTable
        rows={summaries.data}
        loading={summaries.loading}
        rowKey={(s) => s.entity.id}
        columns={[
          {
            header: t('ifrs_entity'),
            render: (s) => (
              <>
                <div style={{ fontWeight: 600 }}>{s.entity.name}</div>
                <div className="sub">{loc(s.entity.activity)}</div>
              </>
            ),
          },
          { header: t('ifrs_entity_type'), render: (s) => <Badge tone={s.entity.type === 'parent' ? 'ok' : s.entity.type === 'subsidiary' ? 'info' : 'muted'}>{t(tk('ifrs_type_', s.entity.type))}</Badge> },
          { header: t('ifrs_ownership'), align: 'right', render: (s) => `${s.entity.ownership}%` },
          { header: t('ifrs_method'), render: (s) => t(tk('ifrs_method_', s.entity.method)) },
          {
            header: t('ifrs_currency'),
            render: (s) => (
              <span title={s.rate !== 1 ? `${t('ifrs_rate_note')}: ${formatNumber(s.rate)}` : undefined}>
                {s.entity.currency}
                {s.rate !== 1 && <span className="sub"> · {formatNumber(s.rate)}</span>}
              </span>
            ),
          },
          { header: t('ifrs_investment_cost'), align: 'right', render: (s) => (s.entity.investmentCost ? formatMoneyShort(s.entity.investmentCost, lang) : '—') },
          { header: t('ifrs_total_assets'), align: 'right', render: (s) => formatMoneyShort(s.totalAssets, lang) },
          { header: t('ifrs_equity'), align: 'right', render: (s) => formatMoneyShort(s.equity, lang) },
          { header: t('ifrs_profit_period'), align: 'right', render: (s) => formatMoneyShort(s.profit, lang) },
        ]}
      />
      <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 24, flexWrap: 'wrap' }} className="small">
        <span>
          {t('ifrs_goodwill_note')}: <b className="num">{formatMoneyShort(c.goodwill, lang)}</b>
        </span>
        <span>
          {t('ifrs_associates_note')}: <b className="num">{formatMoneyShort(c.associatesShare, lang)}</b>
        </span>
        <span>
          {t('ifrs_rate_note')}: <b className="num">1 USD = {formatNumber(ifrsApi.usdRate)} {currencyLabel()}</b>
        </span>
      </div>
      <div className="card-head" style={{ borderTop: '1px solid var(--border)' }}>
        <h2>{t('ifrs_intragroup')}</h2>
      </div>
      <DataTable
        rows={ig.data}
        loading={ig.loading}
        rowKey={(x) => x.id}
        columns={[
          { header: t('description'), render: (x) => loc(x.description) },
          { header: t('ifrs_holder'), render: (x) => `${name(x.assetEntityId)} · ${t(tk('ifrs_line_', x.assetLine))}` },
          { header: t('ifrs_counterpart'), render: (x) => `${name(x.liabilityEntityId)} · ${t(tk('ifrs_line_', x.liabilityLine))}` },
          { header: t('amount'), align: 'right', render: (x) => formatMoneyShort(x.amount, lang) },
          { header: t('ifrs_interest'), align: 'right', render: (x) => formatMoneyShort(x.plAmount, lang) },
        ]}
      />
    </div>
  );
}

function ReadOnlyNote() {
  const { t } = useSession();
  return <span className="muted small">{t('ifrs_read_only')}</span>;
}

function Mapping() {
  const { t, loc } = useSession();
  const user = useUser();
  const canEdit = ifrsCanEdit(user);
  const toast = useToast();
  const tb = useApi(() => ifrsApi.listTrialBalance());
  const unmapped = tb.data?.filter((r) => !r.ifrsLine).length ?? 0;
  return (
    <>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {unmapped ? <Badge tone="warn">{t('ifrs_unmapped_warning')}</Badge> : <Badge tone="ok">{t('ifrs_all_mapped')}</Badge>}
        <span className="muted small">{t('ifrs_mapping_hint')}</span>
        {!canEdit && <ReadOnlyNote />}
      </div>
      <DataTable
        rows={tb.data}
        loading={tb.loading}
        rowKey={(r) => r.accountCode}
        columns={[
          { header: t('ifrs_account'), width: 110, render: (r) => <span className="doc-num">{r.accountCode}</span> },
          { header: t('ifrs_account_name'), render: (r) => loc(r.name) },
          { header: `${t('ifrs_balance')}, ${t('ifrs_in_mln')}`, align: 'right', render: (r) => mln(r.balance) },
          {
            header: t('ifrs_line'),
            width: 330,
            render: (r) => (
              <select
                className="select"
                style={!r.ifrsLine ? { borderColor: 'var(--warn)', background: 'var(--warn-bg)' } : undefined}
                value={r.ifrsLine ?? ''}
                disabled={!canEdit}
                aria-label={`${t('ifrs_line')} ${r.accountCode}`}
                onChange={async (e) => {
                  const value = e.target.value;
                  try {
                    await ifrsApi.mapAccount(r.accountCode, (value || null) as IfrsLine | null, user);
                    toast(`${r.accountCode} → ${value ? t(tk('ifrs_line_', value)) : t('ifrs_unmapped')}`);
                  } catch (err) {
                    toast(errText(err, t));
                  }
                }}
              >
                <option value="">— {t('ifrs_unmapped')} —</option>
                {IFRS_ALL_LINES.filter((l) => l !== 'goodwill' && l !== 'share_associates').map((l) => (
                  <option key={l} value={l}>
                    {t(tk('ifrs_line_', l))}
                  </option>
                ))}
              </select>
            ),
          },
        ]}
      />
    </>
  );
}

function Adjustments() {
  const { t, lang } = useSession();
  const user = useUser();
  const canEdit = ifrsCanEdit(user);
  const lk = useLookups();
  const toast = useToast();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const list = useApi(() => ifrsApi.listAdjustments());
  const entities = useApi(() => ifrsApi.listEntities());
  const [creating, setCreating] = useState(false);
  const entityName = (id: string) => entities.data?.find((e) => e.id === id)?.shortName ?? id;

  const columns: Column<IfrsAdjustment>[] = [
    { header: t('number'), render: (a) => <span className="doc-num">{a.number}</span> },
    { header: t('ifrs_entity'), render: (a) => entityName(a.entityId) },
    { header: t('ifrs_adj_type'), render: (a) => <Badge tone="info">{t(tk('ifrs_adj_', a.type))}</Badge> },
    {
      header: t('description'),
      render: (a) => (
        <>
          {a.description}
          <div className="sub">
            {lk.user(a.createdBy)?.fullName} · {formatDate(a.createdAt)}
          </div>
        </>
      ),
    },
    {
      header: t('ifrs_adj_entries'),
      render: (a) => (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {a.lines.map((l) => (
            <span key={l.line}>
              {t(tk('ifrs_line_', l.line))}: <b className="num">{l.delta > 0 ? '+' : ''}{mln(l.delta)}</b>
            </span>
          ))}
        </div>
      ),
    },
    {
      header: t('ifrs_adj_effect'),
      align: 'right',
      render: (a) => {
        const e = profitEffect(a.lines);
        return <span style={{ color: e < 0 ? 'var(--danger)' : e > 0 ? 'var(--ok)' : 'var(--text-3)' }}>{e ? `${e > 0 ? '+' : ''}${formatMoneyShort(e, lang)}` : '—'}</span>;
      },
    },
  ];
  if (canEdit)
    columns.push({
      header: '',
      width: 50,
      render: (a) =>
        confirmId === a.id ? (
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                try {
                  await ifrsApi.removeAdjustment(a.id, user);
                  toast(`${a.number}: ${t('ifrs_adj_removed')}`);
                } catch (err) {
                  toast(errText(err, t));
                }
                setConfirmId(null);
              }}
            >
              {t('ifrs_confirm_remove')}
            </button>
            <button className="btn btn-ghost btn-sm" aria-label={t('cancel')} title={t('cancel')} onClick={() => setConfirmId(null)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" aria-label={t('ifrs_remove')} title={t('ifrs_remove')} onClick={() => setConfirmId(a.id)}>
            <Icon name="trash" size={15} />
          </button>
        ),
    });

  return (
    <>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
        {canEdit ? (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> {t('ifrs_new_adjustment')}
          </button>
        ) : (
          <ReadOnlyNote />
        )}
      </div>
      <DataTable rows={list.data} loading={list.loading} rowKey={(a) => a.id} columns={columns} />
      {creating && <NewAdjustmentModal onClose={() => setCreating(false)} />}
    </>
  );
}

function NewAdjustmentModal({ onClose }: { onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const toast = useToast();
  const entities = useApi(() => ifrsApi.listEntities());
  const [entityId, setEntityId] = useState('e0');
  const [type, setType] = useState<IfrsAdjustmentType>('ecl');
  const [amountMln, setAmountMln] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const amount = Math.round(Number(amountMln) * 1_000_000);
  const lines = IFRS_ADJUSTMENT_TEMPLATES[type].map((l) => ({ line: l.line, delta: l.sign * (amount || 0) }));

  async function save() {
    if (!(amount > 0) || !description.trim()) {
      setError(t('formRequired'));
      return;
    }
    setBusy(true);
    try {
      const adj = await ifrsApi.addAdjustment({ entityId, type, amount, description: description.trim() }, user);
      toast(`${adj.number}: ${t('ifrs_adj_added')}`);
      onClose();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('ifrs_new_adjustment')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {t('save')}
          </button>
        </>
      }
    >
      <Field label={t('ifrs_entity')} required>
        <select className="select" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          {entities.data
            ?.filter((e) => e.method !== 'equity')
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label={t('ifrs_adj_type')} required>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as IfrsAdjustmentType)}>
          {ADJ_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(tk('ifrs_adj_', x))}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('ifrs_amount_mln')} required>
        <input className="input" type="number" min={0} step="0.1" value={amountMln} onChange={(e) => { setAmountMln(e.target.value); setError(''); }} />
      </Field>
      <Field label={t('description')} required error={error}>
        <textarea className="textarea" value={description} onChange={(e) => { setDescription(e.target.value); setError(''); }} />
      </Field>
      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }} className="small">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('ifrs_adj_entries')}</div>
        {lines.map((l) => (
          <div key={l.line} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span>{t(tk('ifrs_line_', l.line))}</span>
            <b className="num">
              {l.delta > 0 ? '+' : ''}
              {mln(l.delta)}
            </b>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <span>{t('ifrs_adj_effect')}</span>
          <b className="num">{formatMoneyShort(profitEffect(lines), lang)}</b>
        </div>
      </div>
    </Modal>
  );
}

function CloseChecklist() {
  const { t, loc } = useSession();
  const user = useUser();
  const canEdit = ifrsCanEdit(user);
  const toast = useToast();
  const lk = useLookups();
  const tasks = useApi(() => ifrsApi.listCloseTasks());
  if (!tasks.data) return <Loading />;
  const done = tasks.data.filter((x) => x.done).length;
  const pct = Math.round((done / tasks.data.length) * 100);
  return (
    <div>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <b>
            {done} / {tasks.data.length} {t('ifrs_close_progress')}
          </b>
          <span className="num muted">{pct}%</span>
        </div>
        <Progress pct={pct} />
        {!canEdit && (
          <div style={{ marginTop: 8 }}>
            <ReadOnlyNote />
          </div>
        )}
      </div>
      {tasks.data.map((task) => (
        <label key={task.id} className="task" style={{ cursor: canEdit ? 'pointer' : 'default' }}>
          <input
            type="checkbox"
            checked={task.done}
            disabled={!canEdit}
            onChange={() => ifrsApi.toggleCloseTask(task.id, user).catch((err) => toast(errText(err, t)))}
            style={{ width: 18, height: 18, accentColor: 'var(--brand-600)' }} />
          <div className="task-body">
            <div className="task-title" style={task.done ? { textDecoration: 'line-through', color: 'var(--text-3)' } : undefined}>
              {loc(task.title)}
            </div>
            <div className="task-meta">
              <span>
                {t('ifrs_owner')}: {lk.user(task.ownerId)?.fullName}
              </span>
              <span>
                {t('ifrs_due')}: {formatDate(task.dueDate)}
              </span>
            </div>
          </div>
          {task.done ? <Badge tone="ok">{t('rstatus_done')}</Badge> : <Badge tone="muted">{t('rstatus_pending')}</Badge>}
        </label>
      ))}
    </div>
  );
}
