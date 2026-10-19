// Методология планирования (ТЗ 4.2.13.1): скользящий прогноз на 12 месяцев (PR-BUD-002) и сценарии бюджета (PR-BUD-003).
import { useState } from 'react';
import {
  budgetingApi,
  formatDateTime,
  formatDecimal,
  formatMoneyShort,
  type BudgetingForecastMethod,
  type BudgetingRollingRow,
  type BudgetingScenario,
  type BudgetingScenarioRow,
} from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Field, FilterBar, Input, LineChart, Loading, Modal, Select, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useErrText, usePick, ymLabel } from './shared';

export function RollingTab() {
  const { lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const toast = useToast();
  const err = useErrText();
  const [method, setMethod] = useState<BudgetingForecastMethod>('avg3');
  const data = useApi(() => budgetingApi.rolling(method), [method]);
  const runs = useApi(() => budgetingApi.listRollingRuns());
  const short = (v: number) => formatMoneyShort(v, lang);
  const methods: { value: BudgetingForecastMethod; label: string }[] = [
    { value: 'avg3', label: p('Факт/план за 3 последних месяца', 'Oxirgi 3 oy fakt/reja', 'Actual/plan, last 3 months') },
    { value: 'avg6', label: p('Факт/план за 6 последних месяцев', 'Oxirgi 6 oy fakt/reja', 'Actual/plan, last 6 months') },
    { value: 'trend', label: p('Линейный тренд исполнения', 'Ijroning chiziqli trendi', 'Linear execution trend') },
  ];
  const h = data.data?.horizon ?? [];
  return (
    <>
      <FilterBar>
        <Select<BudgetingForecastMethod> value={method} onChange={setMethod} options={methods} ariaLabel={p('Метод прогноза', 'Prognoz usuli', 'Forecast method')} />
        <span className="muted small" style={{ flex: 1 }}>
          {p('Горизонт — 12 месяцев от первого открытого месяца; обновляется автоматически при закрытии месяца фактом.', 'Gorizont — birinchi ochiq oydan 12 oy; oy fakt bilan yopilganda avtomatik yangilanadi.', 'Horizon — 12 months from the first open month; refreshed automatically when a month is closed.')}
        </span>
        {can('budgeting', 'edit') && (
          <Button type="primary" size="small" icon="refresh" onClick={async () => { try { const r = await budgetingApi.runRolling(method, user); toast(`${p('Прогноз обновлён', 'Prognoz yangilandi', 'Forecast updated')}: ${short(r.total)}`); } catch (e) { toast(err(e)); } }}>
            {p('Пересчитать и применить', 'Qayta hisoblash va qo‘llash', 'Recalculate and apply')}
          </Button>
        )}
        <ExportButton<BudgetingRollingRow>
          filename="budget-rolling-forecast"
          rows={data.data?.departments ?? []}
          columns={[
            { header: p('Подразделение', "Bo'linma", 'Department'), value: (r) => lk.department(r.departmentId)?.code ?? r.departmentId },
            ...h.map((pt, i) => ({ header: pt.ym, value: (r: BudgetingRollingRow) => r.points[i]?.forecast ?? 0, format: 'money' as const, total: true })),
          ]}
        />
      </FilterBar>
      {data.loading && !data.data ? (
        <Loading />
      ) : (
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title={p('Скользящий прогноз на 12 месяцев', '12 oylik sirpanuvchi prognoz', '12-month rolling forecast')}>
            <LineChart
              labels={h.map((x) => ymLabel(x.ym, lang))}
              series={[
                { name: p('План / базовый план', 'Reja / bazaviy reja', 'Plan / baseline'), values: h.map((x) => x.plan), color: 'var(--border-strong)' },
                { name: p('Прогноз', 'Prognoz', 'Forecast'), values: h.map((x) => x.forecast), color: 'var(--accent)' },
              ]}
              format={short}
            />
          </Card>
          <Card title={p('По подразделениям', "Bo'linmalar bo'yicha", 'By department')} flush>
            <DataTable
              rows={data.data?.departments}
              rowKey={(r) => r.departmentId}
              columns={[
                { header: p('Подразделение', "Bo'linma", 'Department'), render: (r) => <b style={{ fontWeight: 600 }}>{lk.department(r.departmentId)?.code ?? r.departmentId}</b> },
                ...h.map((pt, i) => ({ header: ymLabel(pt.ym, lang), align: 'right' as const, render: (r: BudgetingRollingRow) => short(r.points[i]?.forecast ?? 0) })),
                { header: p('Прогноз / план', 'Prognoz / reja', 'Forecast / plan'), align: 'right', render: (r) => <Badge tone={r.ratio > 1.02 ? 'danger' : r.ratio < 0.95 ? 'info' : 'ok'}>{formatDecimal(r.ratio * 100)}%</Badge> },
              ]}
            />
          </Card>
          <Card title={p('Журнал пересчётов', 'Qayta hisoblashlar jurnali', 'Recalculation log')} flush>
            <DataTable
              rows={runs.data}
              rowKey={(r) => r.id}
              emptyText={p('Пересчётов ещё не было — прогноз обновится при закрытии месяца', 'Hali qayta hisoblash bo‘lmagan — oy yopilganda yangilanadi', 'No recalculations yet — refreshed on month close')}
              columns={[
                { header: p('Дата', 'Sana', 'Date'), render: (r) => <span className="num muted small">{formatDateTime(r.at)}</span> },
                { header: p('Основание', 'Asos', 'Trigger'), render: (r) => (r.auto ? <Badge tone="info">{p('Авто: закрытие месяца', 'Avto: oy yopilishi', 'Auto: month close')}</Badge> : lk.user(r.userId)?.fullName ?? r.userId) },
                { header: p('Метод', 'Usul', 'Method'), render: (r) => methods.find((m) => m.value === r.method)?.label },
                { header: p('Факт закрыт, мес.', 'Fakt yopilgan, oy', 'Closed months'), align: 'right', render: (r) => r.basedOnMonths },
                { header: p('Прогноз 12 мес.', '12 oylik prognoz', '12-month forecast'), align: 'right', render: (r) => short(r.total) },
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}

export function ScenariosTab() {
  const { lang, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErrText();
  const [year, setYear] = useState(budgetingApi.year);
  const scen = useApi(() => budgetingApi.listScenarios());
  const table = useApi(() => budgetingApi.scenarioTable(year), [year]);
  const articles = useApi(() => budgetingApi.listArticles());
  const [edit, setEdit] = useState<BudgetingScenario | 'new' | null>(null);
  const short = (v: number) => formatMoneyShort(v, lang);
  const list = scen.data ?? [];
  const base = list.find((s) => s.code === 'base');
  const art = (id: string) => articles.data?.find((a) => a.id === id);
  const diff = (v: number, b: number) => (b ? Math.round(((v - b) / b) * 1000) / 10 : 0);
  return (
    <>
      <FilterBar>
        <Select<number> value={year} onChange={setYear} ariaLabel={p('Год', 'Yil', 'Year')} options={[{ value: budgetingApi.year, label: `${budgetingApi.year} · ${p('факт + остаток плана', 'fakt + reja qoldig‘i', 'actual + remaining plan')}` }, { value: budgetingApi.year + 1, label: `${budgetingApi.year + 1} · ${p('проекция', 'proyeksiya', 'projection')}` }]} />
        <span className="muted small" style={{ flex: 1 }}>{p('Сценарии ведутся одновременно; параметры — изменение OPEX/CAPEX, по статьям, курс USD, численность.', 'Ssenariylar bir vaqtda yuritiladi; parametrlar — OPEX/CAPEX, moddalar, USD kursi, xodimlar soni o‘zgarishi.', 'Scenarios are maintained in parallel; parameters — OPEX/CAPEX change, per-article, USD rate, headcount.')}</span>
        {can('budgeting', 'edit') && <Button size="small" icon="plus" onClick={() => setEdit('new')}>{p('Новый сценарий', 'Yangi ssenariy', 'New scenario')}</Button>}
        <ExportButton<BudgetingScenarioRow>
          filename={`budget-scenarios-${year}`}
          rows={table.data?.rows ?? []}
          columns={[
            { header: p('Статья', 'Modda', 'Article'), value: (r) => (art(r.articleId) ? `${art(r.articleId)!.code} ${loc(art(r.articleId)!.name)}` : r.articleId) },
            ...list.map((s) => ({ header: loc(s.name), value: (r: BudgetingScenarioRow) => r.values[s.id] ?? 0, format: 'money' as const, total: true })),
          ]}
        />
      </FilterBar>
      {!table.data ? (
        <Loading />
      ) : (
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="bud-scen-cards">
            {list.map((s) => {
              const total = table.data!.totals[s.id] ?? 0;
              const d = base ? diff(total, table.data!.totals[base.id] ?? 0) : 0;
              return (
                <div key={s.id} className="bud-scen-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <b>{loc(s.name)}</b>
                    {can('budgeting', 'edit') && <Button size="small" type="text" icon="pen" title={p('Изменить', "O'zgartirish", 'Edit')} onClick={() => setEdit(s)} />}
                  </div>
                  <div className="bud-scen-total">{short(total)}</div>
                  <div className="small muted">
                    {s.code !== 'base' && <span style={{ color: d > 0 ? 'var(--danger)' : 'var(--ok)', fontWeight: 600 }}>{d > 0 ? '+' : ''}{formatDecimal(d)}% · </span>}
                    OPEX {s.opexPct > 0 ? '+' : ''}{s.opexPct}% · CAPEX {s.capexPct > 0 ? '+' : ''}{s.capexPct}% · USD {s.fxUsd}
                  </div>
                </div>
              );
            })}
          </div>
          <Card title={p('Сравнение сценариев по статьям', 'Ssenariylarni moddalar bo‘yicha taqqoslash', 'Scenario comparison by article')} flush>
            <DataTable
              rows={table.data.rows}
              rowKey={(r) => r.articleId}
              columns={[
                { header: p('Статья', 'Modda', 'Article'), render: (r) => <>{art(r.articleId) ? loc(art(r.articleId)!.name) : r.articleId}<div className="sub">{art(r.articleId)?.code}</div></> },
                ...list.map((s) => ({
                  header: loc(s.name),
                  align: 'right' as const,
                  render: (r: BudgetingScenarioRow) => {
                    const v = r.values[s.id] ?? 0;
                    const d = base ? diff(v, r.values[base.id] ?? 0) : 0;
                    return <>{short(v)}{s.code !== 'base' && d !== 0 && <div className="sub" style={{ color: d > 0 ? 'var(--danger)' : 'var(--ok)' }}>{d > 0 ? '+' : ''}{formatDecimal(d)}%</div>}</>;
                  },
                })),
              ]}
            />
          </Card>
          <Card title={p('Итого по сценариям: OPEX и CAPEX', 'Ssenariylar bo‘yicha jami: OPEX va CAPEX', 'Scenario totals: OPEX and CAPEX')}>
            <BarChart
              data={list.map((s) => ({ label: loc(s.name), values: [table.data!.rows.filter((r) => r.group === 'opex').reduce((a, r) => a + (r.values[s.id] ?? 0), 0), table.data!.rows.filter((r) => r.group === 'capex').reduce((a, r) => a + (r.values[s.id] ?? 0), 0)] }))}
              series={[{ name: 'OPEX', color: 'var(--brand-600)' }, { name: 'CAPEX', color: 'var(--accent)' }]}
              format={short}
            />
          </Card>
        </div>
      )}
      {edit && (
        <ScenarioModal
          scenario={edit === 'new' ? undefined : edit}
          onClose={() => setEdit(null)}
          onSave={async (s) => { try { await budgetingApi.saveScenario(s, user); toast(p('Сценарий сохранён', 'Ssenariy saqlandi', 'Scenario saved')); setEdit(null); } catch (e) { toast(err(e)); } }}
          onDelete={edit !== 'new' && !edit.system ? async () => { try { await budgetingApi.deleteScenario(edit.id, user); setEdit(null); } catch (e) { toast(err(e)); } } : undefined}
        />
      )}
    </>
  );
}

function ScenarioModal({ scenario, onClose, onSave, onDelete }: { scenario?: BudgetingScenario; onClose: () => void; onSave: (s: Parameters<typeof budgetingApi.saveScenario>[0]) => void; onDelete?: () => void }) {
  const { loc } = useSession();
  const p = usePick();
  const articles = useApi(() => budgetingApi.listArticles());
  const [name, setName] = useState(scenario ? loc(scenario.name) : '');
  const [opex, setOpex] = useState(String(scenario?.opexPct ?? 0));
  const [capex, setCapex] = useState(String(scenario?.capexPct ?? 0));
  const [fx, setFx] = useState(String(scenario?.fxUsd ?? 12_650));
  const [hc, setHc] = useState(String(scenario?.headcountPct ?? 0));
  const [arts, setArts] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(scenario?.articlePct ?? {}).map(([k, v]) => [k, String(v)])));
  const num = (v: string) => Number(v.replace(',', '.'));
  return (
    <Modal
      title={scenario ? loc(scenario.name) : p('Новый сценарий', 'Yangi ssenariy', 'New scenario')}
      onClose={onClose}
      footer={
        <>
          {onDelete && <Button danger onClick={onDelete}>{p('Удалить', "O'chirish", 'Delete')}</Button>}
          <Button onClick={onClose}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
          <Button
            type="primary"
            onClick={() =>
              onSave({
                ...(scenario ? { id: scenario.id } : {}),
                name: scenario ? { ...scenario.name, ru: scenario.name.ru === loc(scenario.name) ? name : scenario.name.ru, uz: scenario.name.uz === loc(scenario.name) ? name : scenario.name.uz } : { ru: name, uz: name, en: name },
                opexPct: num(opex), capexPct: num(capex), fxUsd: num(fx), headcountPct: num(hc),
                articlePct: Object.fromEntries(Object.entries(arts).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, num(v)])),
              })
            }
          >
            {p('Сохранить', 'Saqlash', 'Save')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={p('Название', 'Nomi', 'Name')} required className="span-2"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="OPEX, %"><Input value={opex} inputMode="decimal" onChange={(e) => setOpex(e.target.value)} ariaLabel="OPEX %" /></Field>
        <Field label="CAPEX, %"><Input value={capex} inputMode="decimal" onChange={(e) => setCapex(e.target.value)} ariaLabel="CAPEX %" /></Field>
        <Field label={p('Курс USD, сум', 'USD kursi, so‘m', 'USD rate, UZS')}><Input value={fx} inputMode="decimal" onChange={(e) => setFx(e.target.value)} ariaLabel="USD" /></Field>
        <Field label={p('Численность, %', 'Xodimlar soni, %', 'Headcount, %')}><Input value={hc} inputMode="decimal" onChange={(e) => setHc(e.target.value)} ariaLabel="headcount %" /></Field>
      </div>
      <div style={{ fontWeight: 600, marginTop: 8 }}>{p('Изменение по статьям, % (переопределяет OPEX/CAPEX)', 'Moddalar bo‘yicha o‘zgarish, % (OPEX/CAPEX ni almashtiradi)', 'Per-article change, % (overrides OPEX/CAPEX)')}</div>
      <div className="bud-art-grid">
        {(articles.data ?? []).map((a) => (
          <label key={a.id} className="small">
            {a.code} · {loc(a.name)}
            <Input value={arts[a.id] ?? ''} inputMode="decimal" placeholder="—" onChange={(e) => setArts({ ...arts, [a.id]: e.target.value })} ariaLabel={`${a.code} %`} />
          </label>
        ))}
      </div>
    </Modal>
  );
}
