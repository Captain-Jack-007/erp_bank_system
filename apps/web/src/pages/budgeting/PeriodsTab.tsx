// Разрез по МВЗ и филиалам; закрытие бюджетного месяца со снимком («заморозкой») справочников (ТЗ 4.2.13, абзац о snapshot).
import { useState } from 'react';
import { budgetingApi, formatDateTime, formatMoneyShort, orgApi, type BudgetingBranchRow, type BudgetingLineView, type BudgetingSnapshot } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, FilterBar, Loading, Modal, Progress, Stat, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { useCan, useStepUp } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { MONTHS_FULL, useErrText, usePick } from './shared';

export function BranchesTab() {
  const { lang, loc } = useSession();
  const p = usePick();
  const lk = useLookups();
  const rows = useApi(() => budgetingApi.branches());
  const [sel, setSel] = useState<string | null>(null);
  const lines = useApi(() => (sel ? budgetingApi.listLines(sel === 'HO' ? {} : { orgUnitKey: sel }) : Promise.resolve([] as BudgetingLineView[])), [sel]);
  const articles = useApi(() => budgetingApi.listArticles());
  const ccs = useApi(() => orgApi.listCostCenters({ pageSize: 2000 }));
  const short = (v: number) => formatMoneyShort(v, lang);
  const ccName = (key?: string) => {
    const c = ccs.data?.rows.find((x) => x.key === key);
    return c ? `${c.code} · ${loc(c.name).split(' · ')[0]}` : '—';
  };
  const shown = (lines.data ?? []).filter((l) => (sel === 'HO' ? !l.orgUnitKey.startsWith('R') : true));
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>{p('Строки бюджета привязаны к оргединице и МВЗ справочника оргструктуры: головной офис — по подразделениям, сеть — по региональным филиалам.', 'Byudjet satrlari tashkiliy birlik va MXJ ga bog‘langan: bosh ofis — bo‘linmalar, tarmoq — hududiy filiallar bo‘yicha.', 'Budget lines are linked to an org unit and cost centre: head office by department, the network by regional branch.')}</span>
        <ExportButton<BudgetingBranchRow>
          filename="budget-by-branch"
          rows={rows.data ?? []}
          columns={[
            { header: p('Филиал', 'Filial', 'Branch'), value: (r) => loc(r.name) },
            { header: p('Строк', 'Satrlar', 'Lines'), value: (r) => r.lines, format: 'integer' },
            { header: p('МВЗ', 'MXJ', 'Cost centres'), value: (r) => r.costCenters, format: 'integer' },
            { header: p('Годовой план', 'Yillik reja', 'Annual plan'), value: (r) => r.planYear, format: 'money', total: true },
            { header: p('Факт с начала года', 'Yil boshidan fakt', 'Actual YTD'), value: (r) => r.actualYtd, format: 'money', total: true },
            { header: p('Прогноз на год', 'Yillik prognoz', 'Full-year forecast'), value: (r) => r.forecastYear, format: 'money', total: true },
            { header: p('Освоение, %', 'O‘zlashtirish, %', 'Usage, %'), value: (r) => r.usagePct, format: 'number' },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={rows.data}
        loading={rows.loading}
        rowKey={(r) => r.key}
        onRowClick={(r) => setSel(r.key === sel ? null : r.key)}
        columns={[
          { header: p('Филиал / головной офис', 'Filial / bosh ofis', 'Branch / head office'), render: (r) => <span style={{ fontWeight: r.key === sel ? 700 : 500 }}>{loc(r.name)}<div className="sub">{r.key}</div></span> },
          { header: p('Строк', 'Satrlar', 'Lines'), align: 'right', render: (r) => r.lines },
          { header: p('МВЗ', 'MXJ', 'Cost centres'), align: 'right', render: (r) => r.costCenters },
          { header: p('Годовой план', 'Yillik reja', 'Annual plan'), align: 'right', render: (r) => short(r.planYear) },
          { header: p('Факт с начала года', 'Yil boshidan fakt', 'Actual YTD'), align: 'right', render: (r) => short(r.actualYtd) },
          { header: p('Прогноз на год', 'Yillik prognoz', 'Full-year forecast'), align: 'right', render: (r) => <span style={{ color: r.forecastYear > r.planYear * 1.02 ? 'var(--danger)' : undefined }}>{short(r.forecastYear)}</span> },
          { header: p('Освоение', 'O‘zlashtirish', 'Usage'), width: 150, render: (r) => <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ flex: 1 }}><Progress pct={r.usagePct} /></div><span className="num small">{r.usagePct}%</span></div> },
        ]}
      />
      {sel && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '14px 18px 0', fontWeight: 650 }}>{p('Строки бюджета', 'Byudjet satrlari', 'Budget lines')} · {rows.data?.find((r) => r.key === sel) ? loc(rows.data.find((r) => r.key === sel)!.name) : sel}</div>
          <DataTable
            rows={shown}
            loading={lines.loading}
            rowKey={(l) => l.id}
            columns={[
              { header: p('МВЗ', 'MXJ', 'Cost centre'), render: (l) => <span className="small">{ccName(l.costCenterKey)}</span> },
              { header: p('Подразделение', "Bo'linma", 'Department'), render: (l) => lk.department(l.departmentId)?.code },
              { header: p('Статья', 'Modda', 'Article'), render: (l) => { const a = articles.data?.find((x) => x.id === l.articleId); return a ? loc(a.name) : l.articleId; } },
              { header: p('План', 'Reja', 'Plan'), align: 'right', render: (l) => short(l.planYear) },
              { header: p('Факт', 'Fakt', 'Actual'), align: 'right', render: (l) => short(l.actualYtd) },
              { header: p('Освоение', 'O‘zlashtirish', 'Usage'), align: 'right', render: (l) => `${l.usagePct}%` },
            ]}
          />
        </div>
      )}
    </>
  );
}

export function PeriodsTab() {
  const { lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const stepUp = useStepUp();
  const toast = useToast();
  const err = useErrText();
  const lk = useLookups();
  const snaps = useApi(() => budgetingApi.listSnapshots());
  const [view, setView] = useState<BudgetingSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const closed = budgetingApi.closedMonths;
  const short = (v: number) => formatMoneyShort(v, lang);
  async function close() {
    if (!(await stepUp(p('Закрытие бюджетного месяца', 'Byudjet oyini yopish', 'Close budget month')))) return;
    setBusy(true);
    try {
      const s = await budgetingApi.closeMonth(user);
      toast(`${s.period}: ${p('месяц закрыт, снимок сохранён', 'oy yopildi, surat saqlandi', 'month closed, snapshot saved')}`);
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>
          {p('После закрытия месяца справочники (статьи, режимы контроля, цели, МВЗ строк) и цифры замораживаются: отчёт за период через годы показывает то же, что в день закрытия.', 'Oy yopilgandan so‘ng ma’lumotnomalar (moddalar, nazorat rejimlari, maqsadlar, MXJ) va raqamlar muzlatiladi: davr hisoboti yillar o‘tib ham yopilgan kundagidek ko‘rinadi.', 'After a month is closed, directories (articles, control modes, goals, cost centres) and figures are frozen: the period report shows the same years later.')}
        </span>
        {can('budgeting', 'edit') && closed < 12 && (
          <Button type="primary" size="small" loading={busy} onClick={close}>
            {p('Закрыть месяц', 'Oyni yopish', 'Close month')}: {MONTHS_FULL[lang][closed]}
          </Button>
        )}
      </FilterBar>
      <DataTable
        rows={snaps.data}
        loading={snaps.loading}
        rowKey={(s) => s.id}
        onRowClick={setView}
        columns={[
          { header: p('Период', 'Davr', 'Period'), render: (s) => <span className="doc-num">{s.period}</span> },
          { header: p('Снимок сделан', 'Surat olingan', 'Snapshot taken'), render: (s) => <span className="num muted small">{formatDateTime(s.takenAt)}</span> },
          { header: p('Кем', 'Kim', 'By'), render: (s) => (s.takenBy === 'system' ? p('Система (регламент)', 'Tizim (reglament)', 'System (schedule)') : lk.user(s.takenBy)?.fullName) },
          { header: p('Статей / строк', 'Moddalar / satrlar', 'Articles / lines'), align: 'right', render: (s) => `${s.articles.length} / ${s.lines.length}` },
          { header: p('План года', 'Yil rejasi', 'Annual plan'), align: 'right', render: (s) => short(s.totals.planYear) },
          { header: p('Факт на дату', 'Sanaga fakt', 'Actual to date'), align: 'right', render: (s) => short(s.totals.actualYtd) },
        ]}
      />
      {view && <SnapshotModal snap={view} onClose={() => setView(null)} />}
      {!snaps.data?.length && !snaps.loading && <Empty text={p('Снимков нет', "Suratlar yo'q", 'No snapshots')} />}
    </>
  );
}

function SnapshotModal({ snap, onClose }: { snap: BudgetingSnapshot; onClose: () => void }) {
  const { lang, loc } = useSession();
  const p = usePick();
  const lk = useLookups();
  const cmp = useApi(() => budgetingApi.compareSnapshot(snap.period), [snap.period]);
  const short = (v: number) => formatMoneyShort(v, lang);
  const changed = (cmp.data?.rows ?? []).filter((r) => r.snapPlan !== r.curPlan || r.snapMode !== r.curMode);
  return (
    <Modal title={`${p('Снимок периода', 'Davr surati', 'Period snapshot')} ${snap.period}`} onClose={onClose} footer={<Button onClick={onClose}>{p('Закрыть', 'Yopish', 'Close')}</Button>}>
      <div className="grid grid-3">
        <Stat label={p('План года (на дату снимка)', 'Yil rejasi (surat sanasiga)', 'Annual plan (as of snapshot)')} value={short(snap.totals.planYear)} />
        <Stat label={p('Факт нарастающим итогом', 'O‘sib boruvchi fakt', 'Cumulative actual')} value={short(snap.totals.actualYtd)} />
        <Stat label={p('Изменилось после закрытия', 'Yopilgandan keyin o‘zgargan', 'Changed after close')} value={cmp.data ? String(cmp.data.changed) : '—'} tone={cmp.data?.changed ? 'alert' : undefined} />
      </div>
      <div className="muted small">{p('Замороженные справочники', 'Muzlatilgan ma’lumotnomalar', 'Frozen directories')}: {p('статьи', 'moddalar', 'articles')} {snap.articles.length}, {p('цели', 'maqsadlar', 'goals')} {snap.goals.length}, {p('пороги', 'chegaralar', 'thresholds')} {snap.settings.thresholds.join('/')}%</div>
      {!cmp.data ? (
        <Loading />
      ) : changed.length ? (
        <DataTable
          rows={changed}
          rowKey={(r) => r.id}
          columns={[
            { header: p('Строка', 'Satr', 'Line'), render: (r) => `${lk.department(r.departmentId)?.code ?? ''}${r.orgUnitKey !== r.departmentId ? '/' + r.orgUnitKey : ''} · ${r.snapName ? loc(r.snapName) : r.articleId}` },
            { header: p('План в снимке', 'Suratdagi reja', 'Plan in snapshot'), align: 'right', render: (r) => short(r.snapPlan) },
            { header: p('План сейчас', 'Hozirgi reja', 'Plan now'), align: 'right', render: (r) => short(r.curPlan) },
            { header: p('Режим (снимок → сейчас)', 'Rejim (surat → hozir)', 'Mode (snapshot → now)'), render: (r) => (r.snapMode === r.curMode ? r.snapMode : <Badge tone="warn">{`${r.snapMode} → ${r.curMode}`}</Badge>) },
          ]}
        />
      ) : (
        <Empty text={p('После закрытия изменений нет — снимок совпадает с текущими данными', 'Yopilgandan keyin o‘zgarish yo‘q — surat joriy ma’lumotlarga mos', 'No changes since closing — the snapshot matches current data')} icon="check" />
      )}
      <Card title={p('Строки снимка', 'Surat satrlari', 'Snapshot lines')} flush>
        <DataTable
          rows={snap.lines.slice(0, 40)}
          rowKey={(l) => l.id}
          columns={[
            { header: p('Строка', 'Satr', 'Line'), render: (l) => { const a = snap.articles.find((x) => x.id === l.articleId); return `${lk.department(l.departmentId)?.code ?? ''}${l.orgUnitKey !== l.departmentId ? '/' + l.orgUnitKey : ''} · ${a ? loc(a.name) : l.articleId}`; } },
            { header: p('План года', 'Yil rejasi', 'Annual plan'), align: 'right', render: (l) => short(l.planYear) },
            { header: p('Факт', 'Fakt', 'Actual'), align: 'right', render: (l) => short(l.actualYtd) },
            { header: p('Прогноз', 'Prognoz', 'Forecast'), align: 'right', render: (l) => short(l.forecastYear) },
          ]}
        />
      </Card>
    </Modal>
  );
}
