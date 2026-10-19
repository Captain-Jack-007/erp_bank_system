import { useEffect, useState } from 'react';
import {
  allocationApi,
  allocationUnitTotals,
  formatDateTime,
  formatDecimal,
  formatMoney,
  formatMoneyShort,
  formatNumber,
  type AllocationDriver,
  type AllocationDriverDef,
  type AllocationRun,
} from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, Stat, Tabs, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { useCan } from '../../lib/access';
import { navigate, useQuery } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { usePick, useErrText as useBudErr } from '../budgeting/shared';
import { ClosingTab, DriversTab, GlTab, MethodTab, WhatIfTab, useMethodLabel } from './AllocationTabs';
import '../budgeting/budgeting.css';

type Tab = 'run' | 'rules' | 'method' | 'drivers' | 'gl' | 'whatif' | 'history' | 'closing';
const TABS: Tab[] = ['run', 'rules', 'method', 'drivers', 'gl', 'whatif', 'history', 'closing'];
type PoolRow = Awaited<ReturnType<typeof allocationApi.listPools>>[number];
type RunLike = Pick<AllocationRun, 'cells' | 'total' | 'rules'> & Partial<Pick<AllocationRun, 'method' | 'flows' | 'iterations' | 'residual'>>;

/** Подпись драйвера из библиотеки (системные и пользовательские). */
export function useDriverName() {
  const { loc } = useSession();
  const drivers = useApi(() => allocationApi.listDrivers());
  return (id: AllocationDriver) => {
    const d = drivers.data?.find((x) => x.id === id);
    return d ? loc(d.name) : id;
  };
}

export function useAllocErr() {
  const base = useBudErr();
  const p = usePick();
  return (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    const [code, arg] = m.split(':');
    const map: Record<string, string> = {
      allocation_err_period_closed: p('Период закрыт: справочники и драйверы заморожены', 'Davr yopilgan: ma’lumotnomalar va drayverlar muzlatilgan', 'Period closed: directories and drivers are frozen'),
      allocation_err_chain: p('Цепочка должна содержать каждый обслуживающий центр один раз', 'Zanjirda har bir xizmat markazi bir marta bo‘lishi kerak', 'The chain must contain each service centre once'),
      allocation_err_formula_syntax: p('Ошибка в формуле', 'Formulada xato', 'Formula syntax error'),
      allocation_err_formula_empty: p('Введите формулу', 'Formulani kiriting', 'Enter a formula'),
      allocation_err_formula_refs: p('Формула должна ссылаться хотя бы на один драйвер', 'Formula kamida bitta drayverga murojaat qilishi kerak', 'The formula must reference at least one driver'),
      allocation_err_formula_unknown: p('Неизвестный драйвер в формуле', 'Formulada noma’lum drayver', 'Unknown driver in formula'),
      allocation_err_formula_nested: p('Формула может ссылаться только на базовые драйверы', 'Formula faqat asosiy drayverlarga murojaat qilishi mumkin', 'A formula may reference base drivers only'),
      allocation_err_driver_code: p('Код: латиница/цифры (2–12 символов), название обязательно', 'Kod: lotin harflari/raqamlar (2–12 belgi), nom majburiy', 'Code: Latin letters/digits (2–12 chars), name required'),
      allocation_err_driver_system: p('Системный драйвер нельзя изменить или удалить', 'Tizim drayverini o‘zgartirib/o‘chirib bo‘lmaydi', 'System drivers cannot be changed or deleted'),
      allocation_err_driver_dup: p('Драйвер с таким кодом уже есть', 'Bunday kodli drayver mavjud', 'A driver with this code already exists'),
      allocation_err_driver_used: p('Драйвер используется в правилах', 'Drayver qoidalarda ishlatilmoqda', 'The driver is used in rules'),
      allocation_err_driver_formula_value: p('Значение формульного драйвера вычисляется автоматически', 'Formula drayveri qiymati avtomatik hisoblanadi', 'Formula driver values are computed automatically'),
      allocation_err_value: p('Значение должно быть числом ≥ 0', 'Qiymat ≥ 0 son bo‘lishi kerak', 'The value must be a number ≥ 0'),
      allocation_err_reason: p('Укажите причину ручного ввода (от 5 символов)', 'Qo‘lda kiritish sababini ko‘rsating (5 belgidan)', 'Enter the reason for manual entry (5+ chars)'),
      allocation_err_mapping: p('Укажите систему, операцию и поле источника', 'Manba tizimi, operatsiyasi va maydonini ko‘rsating', 'Enter the source system, operation and field'),
      allocation_err_gl_unavailable: p('iABS недоступна — запрос в очереди', 'iABS mavjud emas — so‘rov navbatda', 'iABS unavailable — request queued'),
      allocation_err_scenario: p('Изменения в сценарии: от −90% до +300%, название обязательно', 'Ssenariydagi o‘zgarishlar: −90% dan +300% gacha, nom majburiy', 'Scenario changes: −90% to +300%, name required'),
      allocation_err_no_run: p('Сначала выполните расчёт за период', 'Avval davr uchun hisob-kitobni bajaring', 'Run the allocation for the period first'),
    };
    return map[code!] ? `${map[code!]}${arg ? ` (${arg})` : ''}` : base(e);
  };
}

export function AllocationPage({ initialTab, runId }: { initialTab?: Tab; runId?: string } = {}) {
  const { t, lang } = useSession();
  const p = usePick();
  const query = useQuery();
  const methodLabel = useMethodLabel();
  const qTab = query.get('tab') as Tab | null;
  const [tab, setTabState] = useState<Tab>(initialTab ?? (qTab && TABS.includes(qTab) ? qTab : 'run'));
  // Ссылки /allocation/rules и /allocation/runs/:id (глобальный поиск) открывают нужную вкладку.
  useEffect(() => {
    if (initialTab) setTabState(initialTab);
    else if (qTab && TABS.includes(qTab)) setTabState(qTab);
  }, [initialTab, runId, qTab]);
  const setTab = (v: Tab) => {
    setTabState(v);
    if (initialTab || qTab) navigate('/allocation');
  };
  const ov = useApi(() => allocationApi.getOverview());
  const units = useApi(() => allocationApi.listUnits());
  const pools = useApi(() => allocationApi.listPools());
  const o = ov.data;
  const latest = o?.periods[o.periods.length - 1];

  return (
    <>
      <PageHeader title={t('allocation_title')} subtitle={`${t('tzLabel')} 4.2.14 · ${t('allocation_subtitle')}`} />
      <div className="grid grid-4">
        <Stat label={`${t('allocation_poolsTotal')} · ${latest ?? ''}`} value={o ? formatMoneyShort(o.poolTotalLatest, lang) : '—'} tone="accent" icon="pie" foot={o ? `${p('Метод', 'Usul', 'Method')}: ${methodLabel(o.method)}` : undefined} />
        <Stat label={t('allocation_pools')} value={pools.data?.length ?? '—'} icon="wallet" />
        <Stat label={t('allocation_units')} value={units.data?.length ?? '—'} icon="building" foot={o ? `${p('Закрыто', 'Yopilgan', 'Closed')}: ${o.closedPeriods.join(', ') || '—'}` : undefined} />
        <Stat
          label={t('allocation_lastRun')}
          value={o?.lastRun?.period ?? '—'}
          icon="clock"
          foot={o?.lastRun ? `${o.lastRun.number} · ${formatDateTime(o.lastRun.createdAt)}` : t('allocation_noRuns')}
        />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'run', label: t('allocation_tab_run') },
            { value: 'rules', label: t('allocation_tab_rules') },
            { value: 'method', label: p('Методы и цепочка', 'Usullar va zanjir', 'Methods & chain') },
            { value: 'drivers', label: p('Библиотека драйверов', 'Drayverlar kutubxonasi', 'Driver library') },
            { value: 'gl', label: p('Сбор данных (ГК)', "Ma'lumot yig'ish (BK)", 'Data collection (GL)') },
            { value: 'whatif', label: 'What-if' },
            { value: 'history', label: t('allocation_tab_history'), ...(o ? { count: o.runs } : {}) },
            { value: 'closing', label: p('Закрытие периодов', 'Davrlarni yopish', 'Period close') },
          ]}
        />
        {tab === 'run' && o && <RunTab periods={o.periods} closed={o.closedPeriods} onSaved={() => setTab('history')} />}
        {tab === 'rules' && o && <RulesTab periods={o.periods} closed={o.closedPeriods} />}
        {tab === 'method' && <MethodTab />}
        {tab === 'drivers' && o && <DriversTab periods={o.periods} />}
        {tab === 'gl' && o && <GlTab periods={o.periods} closed={o.closedPeriods} />}
        {tab === 'whatif' && o && <WhatIfTab periods={o.periods} />}
        {tab === 'history' && <HistoryTab runId={runId} />}
        {tab === 'closing' && o && <ClosingTab periods={o.periods} />}
        {!o && <Loading />}
      </Card>
    </>
  );
}

/** Матрица распределения: строки — пулы (с драйвером), столбцы — направления. */
export function Matrix({ run }: { run: RunLike }) {
  const { t, loc, lang } = useSession();
  const units = useApi(() => allocationApi.listUnits());
  const pools = useApi(() => allocationApi.listPools());
  const driverName = useDriverName();
  const totals = allocationUnitTotals(run);
  const short = (v: number) => formatMoneyShort(v, lang);
  if (!units.data || !pools.data) return <Loading />;
  return (
    <div className="table-wrap">
      <table className="table" style={{ minWidth: 980 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 220 }}>{t('allocation_pool')}</th>
            <th>{t('allocation_driver')}</th>
            {units.data.map((u) => (
              <th key={u.id} className="right" title={loc(u.name)}>{u.code}</th>
            ))}
            <th className="right">{t('allocation_total')}</th>
          </tr>
        </thead>
        <tbody>
          {run.rules.map((r) => {
            const pool = pools.data!.find((x) => x.id === r.poolId);
            const row = run.cells.filter((c) => c.poolId === r.poolId);
            const rowTotal = row.reduce((s, c) => s + c.amount, 0);
            return (
              <tr key={r.poolId}>
                <td>
                  <div style={{ fontWeight: 600 }}>{pool ? loc(pool.name) : r.poolId}</div>
                  <div className="sub">{pool?.code}</div>
                </td>
                <td className="muted small">{driverName(r.driver)}</td>
                {units.data!.map((u) => {
                  const c = row.find((x) => x.unitId === u.id);
                  return (
                    <td key={u.id} className="right num" title={c ? `${formatMoney(c.amount)} · ${formatDecimal(c.sharePct, 2)}%` : undefined}>
                      {c ? short(c.amount) : '—'}
                      <div className="sub">{c ? `${formatDecimal(c.sharePct, 2)}%` : ''}</div>
                    </td>
                  );
                })}
                <td className="right num" style={{ fontWeight: 700 }}>{short(rowTotal)}</td>
              </tr>
            );
          })}
          <tr style={{ background: 'var(--surface-2)' }}>
            <td colSpan={2} style={{ fontWeight: 700 }}>{t('allocation_total')}</td>
            {units.data.map((u) => {
              const tot = totals.find((x) => x.unitId === u.id);
              return (
                <td key={u.id} className="right num" style={{ fontWeight: 700 }}>
                  {tot ? short(tot.amount) : '—'}
                  <div className="sub">{tot ? `${formatDecimal(tot.sharePct)}%` : ''}</div>
                </td>
              );
            })}
            <td className="right num" style={{ fontWeight: 700 }}>{short(run.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Вторичные потоки между центрами (step-down / взаимный метод). */
function Flows({ run }: { run: RunLike }) {
  const { lang, loc } = useSession();
  const p = usePick();
  const centers = useApi(() => allocationApi.listCenters());
  if (!run.flows?.length || run.method === 'direct') return null;
  const name = (id: string) => {
    const c = centers.data?.find((x) => x.id === id);
    return c ? `${c.code} · ${loc(c.name)}` : id;
  };
  const services = new Set((centers.data ?? []).filter((c) => c.type !== 'business').map((c) => c.id));
  const between = run.flows.filter((f) => services.has(f.to)).sort((a, b) => b.amount - a.amount);
  return (
    <div style={{ padding: 18, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontWeight: 650, marginBottom: 8 }}>
        {p('Взаимные услуги и каскад между центрами', 'Markazlar orasidagi o‘zaro xizmatlar va kaskad', 'Reciprocal services and cascade between centres')}
        {run.iterations !== undefined && <span className="muted small"> · {p('итераций Якоби', 'Yakobi iteratsiyalari', 'Jacobi iterations')}: {run.iterations} · {p('погрешность матричного решения', 'matritsa yechimi xatoligi', 'matrix solution residual')}: {formatDecimal(run.residual ?? 0, 2)}</span>}
      </div>
      <DataTable
        rows={between.slice(0, 30)}
        rowKey={(f) => `${f.from}>${f.to}`}
        emptyText={p('Нет потоков', "Oqimlar yo'q", 'No flows')}
        columns={[
          { header: p('От центра', 'Markazdan', 'From'), render: (f) => name(f.from) },
          { header: p('К центру', 'Markazga', 'To'), render: (f) => name(f.to) },
          { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (f) => formatMoneyShort(f.amount, lang) },
        ]}
      />
    </div>
  );
}

function UnitChart({ run }: { run: Pick<AllocationRun, 'cells' | 'total'> }) {
  const { lang } = useSession();
  const units = useApi(() => allocationApi.listUnits());
  const totals = allocationUnitTotals(run);
  return (
    <BarChart
      height={200}
      data={(units.data ?? []).map((u) => ({ label: u.code, values: [totals.find((x) => x.unitId === u.id)?.amount ?? 0] }))}
      series={[{ name: '' }]}
      format={(v) => formatMoneyShort(v, lang)}
    />
  );
}

function RunTab({ periods, closed, onSaved }: { periods: string[]; closed: string[]; onSaved: () => void }) {
  const { t, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useAllocErr();
  const methodLabel = useMethodLabel();
  const driverName = useDriverName();
  const [period, setPeriod] = useState(periods[periods.length - 1]!);
  const [busy, setBusy] = useState(false);
  const preview = useApi(() => allocationApi.preview(period), [period]);
  const units = useApi(() => allocationApi.listUnits());
  const pools = useApi(() => allocationApi.listPools());
  const canEdit = can('allocation', 'edit');
  const isClosed = closed.includes(period);

  return (
    <>
      <FilterBar>
        <select className="select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t('allocation_period')}>
          {periods.map((x) => (
            <option key={x} value={x}>{t('allocation_period')}: {x}</option>
          ))}
        </select>
        {preview.data?.method && <Badge tone="info">{methodLabel(preview.data.method)}</Badge>}
        {isClosed && <Badge tone="muted">{p('Период закрыт', 'Davr yopilgan', 'Period closed')}</Badge>}
        <span className="muted small" style={{ flex: 1 }}>{canEdit ? t('allocation_previewHint') : t('allocation_readOnly')}</span>
        {preview.data && units.data && pools.data && (
          <ExportButton
            filename={`allocation-${period}`}
            rows={preview.data.rules}
            columns={[
              { header: t('allocation_pool'), value: (r) => { const pl = pools.data!.find((x) => x.id === r.poolId); return pl ? `${pl.code} ${loc(pl.name)}` : r.poolId; } },
              { header: t('allocation_driver'), value: (r) => driverName(r.driver) },
              ...units.data.map((u) => ({ header: u.code, value: (r: { poolId: string }) => preview.data!.cells.find((c) => c.poolId === r.poolId && c.unitId === u.id)?.amount ?? 0, format: 'money' as const, total: true })),
            ]}
          />
        )}
        {canEdit && !isClosed && (
          <button
            className="btn btn-primary"
            disabled={busy || !preview.data}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await allocationApi.run(period, user);
                toast(`${r.number}: ${t('allocation_runDone')}`);
                onSaved();
              } catch (e) {
                toast(err(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('allocation_run')}
          </button>
        )}
      </FilterBar>
      {preview.loading && !preview.data ? (
        <Loading />
      ) : preview.data ? (
        <>
          <div style={{ padding: '14px 18px 0', fontWeight: 650 }}>{t('allocation_preview')} · {period}</div>
          <Matrix run={preview.data} />
          <Flows run={preview.data} />
          <div style={{ padding: 18, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 650, marginBottom: 8 }}>{t('allocation_byUnit')}</div>
            <UnitChart run={preview.data} />
          </div>
        </>
      ) : null}
    </>
  );
}

function RulesTab({ periods, closed }: { periods: string[]; closed: string[] }) {
  const { t, loc, lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const toast = useToast();
  const err = useAllocErr();
  const rules = useApi(() => allocationApi.listRules());
  const pools = useApi(() => allocationApi.listPools());
  const drivers = useApi(() => allocationApi.listDrivers());
  const centers = useApi(() => allocationApi.listCenters());
  const [period, setPeriod] = useState(periods[periods.length - 1]!);
  const values = useApi(() => allocationApi.driverValues(period), [period]);
  const [edit, setEdit] = useState<{ centerId: string; driver: AllocationDriverDef; value: string; reason: string } | null>(null);
  const canEdit = can('allocation', 'edit');
  const isClosed = closed.includes(period);
  const baseDrivers = drivers.data ?? [];
  const fmt = (d: AllocationDriverDef, v: number) => (d.unit === 'UZS' ? formatMoneyShort(v, lang) : formatNumber(Math.round(v * 100) / 100));
  const centerName = (id: string) => centers.data?.find((c) => c.id === id);

  return (
    <>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 650 }}>{t('allocation_rules')}</div>
        <div className="muted small">{t('allocation_rulesHint')}</div>
        {!canEdit && <div className="muted small" style={{ marginTop: 4 }}>{t('allocation_readOnly')}</div>}
      </div>
      <DataTable
        rows={pools.data}
        loading={pools.loading}
        rowKey={(x) => x.id}
        columns={[
          {
            header: t('allocation_pool'),
            render: (x) => (
              <>
                <div style={{ fontWeight: 600 }}>{loc(x.name)}</div>
                <div className="sub">{x.code} · {lk.department(x.departmentId)?.code} · {centerName(x.centerId)?.code}</div>
              </>
            ),
          },
          ...periods.map((per) => ({ header: per, align: 'right' as const, render: (x: PoolRow) => formatMoneyShort(x.amounts[per] ?? 0, lang) })),
          {
            header: t('allocation_driver'),
            width: 240,
            render: (x) => {
              const rule = rules.data?.find((r) => r.poolId === x.id);
              const label = baseDrivers.find((d) => d.id === rule?.driver);
              if (!canEdit) return rule ? <span style={{ fontWeight: 500 }}>{label ? loc(label.name) : rule.driver}</span> : null;
              return (
                <select
                  className="select"
                  value={rule?.driver ?? ''}
                  aria-label={`${t('allocation_driver')} ${x.code}`}
                  onChange={async (e) => {
                    try {
                      await allocationApi.updateRule(x.id, e.target.value as AllocationDriver, user);
                      toast(`${x.code}: ${t('allocation_ruleSaved')}`);
                    } catch (er) {
                      toast(err(er));
                    }
                  }}
                >
                  {baseDrivers.map((d) => (
                    <option key={d.id} value={d.id}>{loc(d.name)}</option>
                  ))}
                </select>
              );
            },
          },
          {
            header: t('allocation_updated'),
            render: (x) => {
              const rule = rules.data?.find((r) => r.poolId === x.id);
              return rule ? <span className="muted small">{lk.user(rule.updatedBy)?.fullName}<br />{formatDateTime(rule.updatedAt)}</span> : null;
            },
          },
        ]}
      />
      <FilterBar>
        <span style={{ fontWeight: 650, flex: 1 }}>
          {t('allocation_driverValues')}
          {canEdit && !isClosed && <span className="muted small" style={{ fontWeight: 400 }}> · {p('нажмите на значение для ручного ввода (с записью в журнал аудита)', 'qo‘lda kiritish uchun qiymatni bosing (audit jurnaliga yoziladi)', 'click a value for manual entry (logged to the audit trail)')}</span>}
        </span>
        <select className="select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t('allocation_period')}>
          {periods.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
      </FilterBar>
      <DataTable
        rows={values.data}
        loading={values.loading}
        rowKey={(r) => r.centerId}
        columns={[
          { header: t('allocation_unit'), render: (r) => { const c = centerName(r.centerId); return <><div style={{ fontWeight: 600 }}>{c ? loc(c.name) : r.centerId}</div><div className="sub">{c?.code} · {c?.type}</div></>; } },
          ...baseDrivers.map((d) => ({
            header: loc(d.name),
            align: 'right' as const,
            render: (r: { centerId: string; values: Record<string, number>; meta: Record<string, { source: string }> }) => {
              const v = r.values[d.id] ?? 0;
              const manual = r.meta[d.id]?.source === 'manual';
              const editable = canEdit && !isClosed && d.source !== 'formula';
              return (
                <span className={editable ? 'bud-editable' : undefined} onClick={editable ? () => setEdit({ centerId: r.centerId, driver: d, value: String(Math.round(v)), reason: '' }) : undefined} style={manual ? { color: 'var(--warn)', fontWeight: 600 } : undefined} title={manual ? p('Ручной ввод', 'Qo‘lda kiritilgan', 'Manual entry') : undefined}>
                  {fmt(d, v)}
                </span>
              );
            },
          })),
        ]}
      />
      {edit && (
        <Modal
          title={`${centerName(edit.centerId)?.code} · ${loc(edit.driver.name)} · ${period}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await allocationApi.setDriverValue(period, edit.centerId, edit.driver.id, Number(edit.value.replace(/\s/g, '').replace(',', '.')), edit.reason, user); toast(p('Значение сохранено, запись в журнале аудита', 'Qiymat saqlandi, audit jurnaliga yozildi', 'Value saved and logged')); setEdit(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <Field label={p('Значение', 'Qiymat', 'Value')} hint={edit.driver.unit}><Input value={edit.value} inputMode="decimal" onChange={(e) => setEdit({ ...edit, value: e.target.value })} ariaLabel={p('Значение драйвера', 'Drayver qiymati', 'Driver value')} /></Field>
          <Field label={p('Причина ручного ввода', 'Qo‘lda kiritish sababi', 'Reason for manual entry')} required><Input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} ariaLabel={p('Причина', 'Sabab', 'Reason')} placeholder={p('Сбой интеграции с HR-системой', 'HR tizimi bilan integratsiya nosozligi', 'HR system integration failure')} /></Field>
        </Modal>
      )}
    </>
  );
}

function HistoryTab({ runId }: { runId?: string }) {
  const { t, lang } = useSession();
  const lk = useLookups();
  const methodLabel = useMethodLabel();
  const runs = useApi(() => allocationApi.listRuns());
  const [selected, setSelected] = useState<string | null>(runId ?? null);
  useEffect(() => {
    if (runId) setSelected(runId);
  }, [runId]);
  const run = runs.data?.find((r) => r.id === (selected ?? runs.data?.[0]?.id));

  if (runs.loading && !runs.data) return <Loading />;
  if (!runs.data?.length) return <Empty text={t('allocation_noRuns')} />;
  return (
    <>
      <FilterBar>
        <span style={{ flex: 1 }} />
        <ExportButton<AllocationRun>
          filename="allocation-runs"
          rows={runs.data}
          columns={[
            { header: t('number'), value: (r) => r.number },
            { header: t('allocation_period'), value: (r) => r.period },
            { header: 'Method', value: (r) => methodLabel(r.method) },
            { header: t('date'), value: (r) => r.createdAt.slice(0, 16).replace('T', ' ') },
            { header: t('allocation_runBy'), value: (r) => lk.user(r.userId)?.fullName ?? r.userId },
            { header: t('allocation_total'), value: (r) => r.total, format: 'money' },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={runs.data}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSelected(r.id)}
        columns={[
          { header: t('number'), render: (r) => <span className="doc-num" style={r.id === run?.id ? { textDecoration: 'underline' } : undefined}>{r.number}</span> },
          { header: t('allocation_period'), render: (r) => r.period },
          { header: '', render: (r) => <span className="muted small">{methodLabel(r.method)}</span> },
          { header: t('date'), render: (r) => <span className="num muted">{formatDateTime(r.createdAt)}</span> },
          { header: t('allocation_runBy'), render: (r) => lk.user(r.userId)?.fullName },
          { header: t('allocation_total'), align: 'right', render: (r) => formatMoneyShort(r.total, lang) },
        ]}
      />
      {run && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '14px 18px 0', fontWeight: 650 }}>{t('allocation_selected')}: {run.number} · {run.period}</div>
          <Matrix run={run} />
          <Flows run={run} />
        </div>
      )}
    </>
  );
}

