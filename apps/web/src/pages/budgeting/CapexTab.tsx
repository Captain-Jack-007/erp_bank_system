// Мониторинг CAPEX, крупных закупок и проектных инвестиций (ТЗ 4.2.13.3): заявки департаментов-инициаторов с графиком
// финансирования и обоснованием (PR-BUD-011), инвестпроекты на основе паспорта (PR-BUD-012), исполнение по этапам и Гант (PR-BUD-013).
import { useEffect, useState } from 'react';
import {
  budgetingApi,
  formatDate,
  formatMoney,
  formatMoneyShort,
  today,
  type BudgetingCapexKind,
  type BudgetingCapexRequest,
  type BudgetingMilestone,
  type BudgetingMilestoneStatus,
  type BudgetingProject,
  type BudgetingProjectStatus,
} from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Drawer, Field, FilterBar, Input, Modal, Progress, RouteSteps, Select, Tabs, Textarea, Timeline, useToast, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { FieldHistory } from '../../components/FieldHistory';
import { useCan } from '../../lib/access';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useDocStatusLabel } from './ControlTab';
import { DOC_TONE } from './ZbbTab';
import { parseMln, useErrText, usePick, ymLabel } from './shared';

type Sub = 'requests' | 'projects';

function useKindLabel() {
  const p = usePick();
  return (k: BudgetingCapexKind) => ({ capex: 'CAPEX', large_purchase: p('Крупная закупка', 'Yirik xarid', 'Large purchase'), investment: p('Инвестиционный проект', 'Investitsiya loyihasi', 'Investment project') })[k];
}
function useMsStatus() {
  const p = usePick();
  return (s: BudgetingMilestoneStatus) => ({ planned: p('Запланирован', 'Rejalashtirilgan', 'Planned'), in_progress: p('В работе', 'Jarayonda', 'In progress'), done: p('Завершён', 'Tugallangan', 'Done'), delayed: p('Отставание', 'Kechikish', 'Delayed') })[s];
}
function useProjStatus() {
  const p = usePick();
  return (s: BudgetingProjectStatus) => ({ initiation: p('Инициация', 'Tashabbus', 'Initiation'), in_progress: p('Реализация', 'Amalga oshirish', 'In progress'), on_hold: p('Приостановлен', "To'xtatilgan", 'On hold'), completed: p('Завершён', 'Tugallangan', 'Completed') })[s];
}
const MS_TONE: Record<BudgetingMilestoneStatus, Tone> = { planned: 'muted', in_progress: 'info', done: 'ok', delayed: 'danger' };

export function CapexTab({ capexId, projectId }: { capexId?: string; projectId?: string }) {
  const p = usePick();
  const [sub, setSub] = useState<Sub>(projectId ? 'projects' : 'requests');
  useEffect(() => {
    if (projectId) setSub('projects');
    else if (capexId) setSub('requests');
  }, [capexId, projectId]);
  return (
    <>
      <div className="bud-subtabs">
        <Tabs<Sub> value={sub} onChange={setSub} items={[{ value: 'requests', label: p('План CAPEX и крупных закупок', 'CAPEX va yirik xaridlar rejasi', 'CAPEX & large purchases plan') }, { value: 'projects', label: p('Инвестиционные проекты', 'Investitsiya loyihalari', 'Investment projects') }]} />
      </div>
      {sub === 'requests' ? <Requests openId={capexId} /> : <Projects openId={projectId} />}
    </>
  );
}

function Requests({ openId }: { openId?: string }) {
  const { lang } = useSession();
  const p = usePick();
  const lk = useLookups();
  const st = useDocStatusLabel();
  const kind = useKindLabel();
  const list = useApi(() => budgetingApi.listCapex());
  const plan = useApi(() => budgetingApi.capexPlan());
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [editing, setEditing] = useState<BudgetingCapexRequest | 'new' | null>(null);
  useEffect(() => {
    if (openId) setOpen(openId);
  }, [openId]);
  const cur = list.data?.find((c) => c.id === open);
  const short = (v: number) => formatMoneyShort(v, lang);
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>{p('Департаменты-инициаторы вводят план CAPEX, крупных закупок и инвестиций: наименование, график финансирования, обоснование. Утверждённый план попадает в бюджет статьи.', 'Tashabbuskor departamentlar CAPEX, yirik xaridlar va investitsiyalar rejasini kiritadi: nom, moliyalashtirish jadvali, asoslash. Tasdiqlangan reja modda byudjetiga kiradi.', 'Initiating departments enter the CAPEX, large purchase and investment plan: title, funding schedule, justification. The approved plan is added to the article budget.')}</span>
        <Button type="primary" size="small" icon="plus" onClick={() => setEditing('new')}>{p('Новая заявка', 'Yangi ariza', 'New request')}</Button>
        <ExportButton<BudgetingCapexRequest>
          filename="budget-capex-plan"
          rows={list.data ?? []}
          columns={[
            { header: '№', value: (c) => c.number },
            { header: p('Тип', 'Turi', 'Type'), value: (c) => kind(c.kind) },
            { header: p('Наименование', 'Nomi', 'Title'), value: (c) => c.title },
            { header: p('Подразделение', "Bo'linma", 'Department'), value: (c) => lk.department(c.departmentId)?.code ?? c.departmentId },
            { header: p('Сроки финансирования', 'Moliyalashtirish muddatlari', 'Funding period'), value: (c) => `${c.schedule[0]?.ym ?? ''} — ${c.schedule[c.schedule.length - 1]?.ym ?? ''}` },
            { header: p('Сумма', 'Summa', 'Amount'), value: (c) => c.amount, format: 'money', total: true },
            { header: p('Статус', 'Holat', 'Status'), value: (c) => st(c.status) },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(c) => c.id}
        onRowClick={(c) => setOpen(c.id)}
        columns={[
          { header: '№', render: (c) => <span className="doc-num">{c.number}</span> },
          { header: p('Наименование', 'Nomi', 'Title'), render: (c) => <>{c.title}<div className="sub">{kind(c.kind)} · {lk.department(c.departmentId)?.code}</div></> },
          { header: p('Финансирование', 'Moliyalashtirish', 'Funding'), render: (c) => <span className="small">{c.schedule.map((s) => ymLabel(s.ym, lang)).join(', ')}</span> },
          { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (c) => short(c.amount) },
          { header: p('Статус', 'Holat', 'Status'), render: (c) => <Badge tone={DOC_TONE[c.status] ?? 'muted'}>{st(c.status)}</Badge> },
        ]}
      />
      <div style={{ padding: 18 }}>
        <Card title={p('График финансирования CAPEX и инвестиций по месяцам', 'CAPEX va investitsiyalarni oylar bo‘yicha moliyalashtirish jadvali', 'CAPEX and investment funding by month')}>
          <BarChart
            data={(plan.data ?? []).map((m) => ({ label: ymLabel(m.ym, lang), values: [m.approved, m.pending] }))}
            series={[{ name: p('Утверждено', 'Tasdiqlangan', 'Approved'), color: 'var(--brand-600)' }, { name: p('На согласовании', 'Kelishuvda', 'In approval'), color: 'var(--warn)' }]}
            format={short}
          />
        </Card>
      </div>
      {cur && <CapexModal c={cur} onEdit={() => setEditing(cur)} onClose={() => { setOpen(null); if (openId) navigate('/budgeting?tab=capex'); }} />}
      {editing && <CapexForm req={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={(c) => { setEditing(null); setOpen(c.id); }} />}
    </>
  );
}

function CapexModal({ c, onEdit, onClose }: { c: BudgetingCapexRequest; onEdit: () => void; onClose: () => void }) {
  const { lang, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const lk = useLookups();
  const st = useDocStatusLabel();
  const kind = useKindLabel();
  const articles = useApi(() => budgetingApi.listArticles());
  const goals = useApi(() => budgetingApi.listGoals());
  const art = articles.data?.find((a) => a.id === c.articleId);
  const goal = goals.data?.find((g) => g.id === c.goalId);
  const editable = ['draft', 'returned', 'rejected'].includes(c.status) && c.requesterId === user.id;
  return (
    <Modal
      title={`${c.number} · ${c.title}`}
      onClose={onClose}
      footer={
        <>
          <PrintButton
            doc={{
              entity: 'capex_request', entityId: c.id, number: c.number, date: c.createdAt.slice(0, 10), title: p('Заявка на CAPEX / инвестиции', 'CAPEX / investitsiya arizasi', 'CAPEX / investment request'),
              fields: [
                { label: p('Тип', 'Turi', 'Type'), value: kind(c.kind) },
                { label: p('Подразделение', "Bo'linma", 'Department'), value: lk.department(c.departmentId) ? loc(lk.department(c.departmentId)!.name) : c.departmentId },
                { label: p('Статья', 'Modda', 'Article'), value: art ? `${art.code} · ${loc(art.name)}` : c.articleId },
                { label: p('Сумма', 'Summa', 'Amount'), value: formatMoney(c.amount) },
                { label: p('Цель', 'Maqsad', 'Goal'), value: goal ? loc(goal.name) : '' },
              ],
              paragraphs: [c.justification, c.comments, `Impact of non-funding: ${c.impact}`].filter(Boolean),
              table: { columns: [{ header: p('Месяц', 'Oy', 'Month') }, { header: p('Сумма', 'Summa', 'Amount'), align: 'right' }], rows: c.schedule.map((s) => [s.ym, formatMoney(s.amount)]), totals: ['', formatMoney(c.amount)] },
              signers: [{ role: p('Инициатор', 'Tashabbuskor', 'Initiator'), name: lk.user(c.requesterId)?.fullName ?? '' }],
            }}
          />
          {c.projectId && <Button onClick={() => navigate(`/budgeting/projects/${c.projectId}`)}>{p('Паспорт проекта', 'Loyiha pasporti', 'Project passport')}</Button>}
          {editable && <Button type="primary" onClick={onEdit}>{p('Редактировать', 'Tahrirlash', 'Edit')}</Button>}
          <Button onClick={onClose}>{p('Закрыть', 'Yopish', 'Close')}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone={DOC_TONE[c.status] ?? 'muted'}>{st(c.status)}</Badge>
        <span className="muted small">{kind(c.kind)} · {formatDate(c.createdAt)}</span>
        <b className="num" style={{ marginLeft: 'auto' }}>{formatMoneyShort(c.amount, lang)}</b>
      </div>
      <dl className="kv" style={{ gridTemplateColumns: '160px 1fr' }}>
        <dt>{p('Статья', 'Modda', 'Article')}</dt>
        <dd>{art ? `${art.code} · ${loc(art.name)}` : c.articleId}</dd>
        <dt>{p('График', 'Jadval', 'Schedule')}</dt>
        <dd>{c.schedule.map((s) => `${ymLabel(s.ym, lang)}: ${formatMoneyShort(s.amount, lang)}`).join(' · ')}</dd>
        <dt>{p('Обоснование', 'Asoslash', 'Justification')}</dt>
        <dd style={{ fontWeight: 400 }}>{c.justification}</dd>
        <dt>{p('Комментарии', 'Izohlar', 'Comments')}</dt>
        <dd style={{ fontWeight: 400 }}>{c.comments || '—'}</dd>
        <dt>{p('Цель', 'Maqsad', 'Goal')}</dt>
        <dd>{goal ? `${goal.code} · ${loc(goal.name)}` : '—'}</dd>
        <dt>Impact of non-funding</dt>
        <dd style={{ fontWeight: 400 }}>{c.impact}</dd>
      </dl>
      <Attachments entity="capex_request" entityId={c.id} readOnly={!editable} />
      {c.status === 'draft' ? <RouteSteps preview={{ entity: 'capex_request', context: { amount: c.amount, departmentId: c.departmentId, requesterId: c.requesterId, subtype: c.kind } }} /> : <RouteSteps entityId={c.id} />}
      <Timeline events={c.history} />
    </Modal>
  );
}

function CapexForm({ req, onClose, onSaved }: { req?: BudgetingCapexRequest; onClose: () => void; onSaved: (c: BudgetingCapexRequest) => void }) {
  const { loc } = useSession();
  const p = usePick();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useErrText();
  const kind = useKindLabel();
  const articles = useApi(() => budgetingApi.listArticles());
  const goals = useApi(() => budgetingApi.listGoals());
  const [k, setK] = useState<BudgetingCapexKind>(req?.kind ?? 'capex');
  const [title, setTitle] = useState(req?.title ?? '');
  const [dept, setDept] = useState(req?.departmentId ?? user.departmentId);
  const [article, setArticle] = useState(req?.articleId ?? '');
  const [schedule, setSchedule] = useState<{ ym: string; mln: string }[]>(() => req?.schedule.map((s) => ({ ym: s.ym, mln: String(s.amount / 1_000_000) })) ?? [{ ym: '2026-12', mln: '' }]);
  const [justification, setJustification] = useState(req?.justification ?? '');
  const [comments, setComments] = useState(req?.comments ?? '');
  const [goalId, setGoalId] = useState(req?.goalId ?? '');
  const [impact, setImpact] = useState(req?.impact ?? '');
  const [error, setError] = useState('');
  const total = schedule.reduce((s, x) => s + (parseMln(x.mln) || 0), 0);
  async function save(submit: boolean) {
    setError('');
    try {
      const c = await budgetingApi.saveCapex({ ...(req ? { id: req.id } : {}), kind: k, title, departmentId: dept, articleId: article, schedule: schedule.map((s) => ({ ym: s.ym, amount: parseMln(s.mln) })), justification, comments, goalId, impact }, submit, user);
      toast(`${c.number}: ${submit ? p('отправлена на согласование', 'kelishuvga yuborildi', 'submitted for approval') : p('черновик сохранён', 'qoralama saqlandi', 'draft saved')}`);
      onSaved(c);
    } catch (e) {
      setError(err(e));
    }
  }
  return (
    <Drawer
      open
      width={680}
      title={req ? req.number : p('Новая заявка CAPEX / инвестиции', 'Yangi CAPEX / investitsiya arizasi', 'New CAPEX / investment request')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
          <Button onClick={() => save(false)}>{p('Сохранить черновик', 'Qoralamani saqlash', 'Save draft')}</Button>
          <Button type="primary" onClick={() => save(true)}>{p('Отправить на согласование', 'Kelishuvga yuborish', 'Submit for approval')}</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={p('Тип', 'Turi', 'Type')} required>
          <Select<BudgetingCapexKind> value={k} onChange={setK} ariaLabel={p('Тип', 'Turi', 'Type')} options={(['capex', 'large_purchase', 'investment'] as const).map((v) => ({ value: v, label: kind(v) }))} />
        </Field>
        <Field label={p('Подразделение-инициатор', 'Tashabbuskor bo‘linma', 'Initiating department')} required>
          <Select value={dept} onChange={setDept} ariaLabel={p('Подразделение', "Bo'linma", 'Department')} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} />
        </Field>
        <Field label={p('Наименование', 'Nomi', 'Title')} required className="span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} ariaLabel={p('Наименование', 'Nomi', 'Title')} /></Field>
        <Field label={p('Статья CAPEX', 'CAPEX moddasi', 'CAPEX article')} required>
          <Select value={article} onChange={setArticle} placeholder="—" ariaLabel={p('Статья CAPEX', 'CAPEX moddasi', 'CAPEX article')} options={(articles.data ?? []).filter((a) => a.group === 'capex').map((a) => ({ value: a.id, label: `${a.code} · ${loc(a.name)}` }))} />
        </Field>
        <Field label={p('Стратегическая цель', 'Strategik maqsad', 'Strategic goal')} required>
          <Select value={goalId} onChange={setGoalId} placeholder="—" ariaLabel={p('Цель', 'Maqsad', 'Goal')} options={(goals.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${loc(g.name)}` }))} />
        </Field>
      </div>
      <div style={{ fontWeight: 600, margin: '10px 0 6px' }}>{p('Сроки и суммы финансирования', 'Moliyalashtirish muddatlari va summalari', 'Funding schedule')} · {formatMoney(total)}</div>
      {schedule.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
          <Input value={s.ym} onChange={(e) => setSchedule((l) => l.map((x, j) => (j === i ? { ...x, ym: e.target.value } : x)))} placeholder="2026-12" ariaLabel={`${p('Месяц', 'Oy', 'Month')} ${i + 1}`} style={{ width: 120 }} />
          <Input value={s.mln} inputMode="decimal" onChange={(e) => setSchedule((l) => l.map((x, j) => (j === i ? { ...x, mln: e.target.value } : x)))} placeholder={p('млн сум', 'mln so‘m', 'mln UZS')} ariaLabel={`${p('Сумма', 'Summa', 'Amount')} ${i + 1}`} />
          {schedule.length > 1 && <Button size="small" type="text" icon="trash" title={p('Удалить', "O'chirish", 'Remove')} onClick={() => setSchedule((l) => l.filter((_, j) => j !== i))} />}
        </div>
      ))}
      <Button size="small" icon="plus" onClick={() => setSchedule((l) => [...l, { ym: '', mln: '' }])}>{p('Добавить месяц', "Oy qo'shish", 'Add month')}</Button>
      <Field label={p('Обоснование', 'Asoslash', 'Justification')} required><Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} ariaLabel={p('Обоснование', 'Asoslash', 'Justification')} /></Field>
      <Field label={p('Комментарии', 'Izohlar', 'Comments')}><Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} ariaLabel={p('Комментарии', 'Izohlar', 'Comments')} /></Field>
      <Field label={p('Риски нефинансирования (Impact of non-funding)', 'Moliyalashtirilmaslik xavflari (Impact of non-funding)', 'Impact of non-funding')} required><Textarea value={impact} onChange={(e) => setImpact(e.target.value)} rows={2} ariaLabel="Impact of non-funding" /></Field>
      {error && <div className="error-text">{error}</div>}
      <RouteSteps preview={{ entity: 'capex_request', context: { amount: total, departmentId: dept, requesterId: user.id, subtype: k } }} />
    </Drawer>
  );
}

function Projects({ openId }: { openId?: string }) {
  const { lang } = useSession();
  const p = usePick();
  const lk = useLookups();
  const ps = useProjStatus();
  const list = useApi(() => budgetingApi.listProjects());
  const [open, setOpen] = useState<string | null>(openId ?? null);
  useEffect(() => {
    if (openId) setOpen(openId);
  }, [openId]);
  const cur = list.data?.find((x) => x.id === open);
  const actual = (pj: BudgetingProject) => pj.milestones.reduce((s, m) => s + m.actual, 0);
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>{p('Проекты (строительство, ИТ, оборудование) ведутся по паспорту; исполнение бюджета — по этапам (Milestones).', 'Loyihalar (qurilish, AT, uskunalar) pasport asosida yuritiladi; byudjet ijrosi — bosqichlar (Milestones) bo‘yicha.', 'Projects (construction, IT, equipment) are run by passport; budget execution is tracked by milestones.')}</span>
        <ExportButton<BudgetingProject>
          filename="budget-investment-projects"
          rows={list.data ?? []}
          columns={[
            { header: p('Код', 'Kod', 'Code'), value: (x) => x.code },
            { header: p('Проект', 'Loyiha', 'Project'), value: (x) => x.name },
            { header: p('Начало', 'Boshlanishi', 'Start'), value: (x) => x.start },
            { header: p('Окончание', 'Tugashi', 'End'), value: (x) => x.end },
            { header: p('Бюджет', 'Byudjet', 'Budget'), value: (x) => x.budget, format: 'money', total: true },
            { header: p('Освоено', 'O‘zlashtirildi', 'Spent'), value: (x) => actual(x), format: 'money', total: true },
            { header: p('Статус', 'Holat', 'Status'), value: (x) => ps(x.status) },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(x) => x.id}
        onRowClick={(x) => setOpen(x.id)}
        columns={[
          { header: p('Код', 'Kod', 'Code'), render: (x) => <span className="doc-num">{x.code}</span> },
          { header: p('Проект', 'Loyiha', 'Project'), render: (x) => <>{x.name}<div className="sub">{lk.department(x.departmentId)?.code} · {formatDate(x.start)} — {formatDate(x.end)}</div></> },
          { header: p('Бюджет', 'Byudjet', 'Budget'), align: 'right', render: (x) => formatMoneyShort(x.budget, lang) },
          {
            header: p('Освоение', 'O‘zlashtirish', 'Execution'),
            width: 160,
            render: (x) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}><Progress pct={Math.round((actual(x) / x.budget) * 100)} /></div>
                <span className="num small">{Math.round((actual(x) / x.budget) * 100)}%</span>
              </div>
            ),
          },
          { header: p('Этапы с отставанием', 'Kechikkan bosqichlar', 'Delayed milestones'), align: 'right', render: (x) => { const n = x.milestones.filter((m) => m.status === 'delayed').length; return n ? <Badge tone="danger">{n}</Badge> : '—'; } },
          { header: p('Статус', 'Holat', 'Status'), render: (x) => <Badge tone={x.status === 'completed' ? 'ok' : x.status === 'on_hold' ? 'warn' : 'info'}>{ps(x.status)}</Badge> },
        ]}
      />
      {cur && <ProjectModal pj={cur} onClose={() => { setOpen(null); if (openId) navigate('/budgeting?tab=capex'); }} />}
    </>
  );
}

/** Диаграмма Ганта этапов проекта: полосы по датам, заливка — прогресс, линия — сегодня. */
export function Gantt({ milestones, start, end }: { milestones: BudgetingMilestone[]; start: string; end: string }) {
  const { lang } = useSession();
  const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  const s0 = ms(start);
  const span = Math.max(1, ms(end) - s0);
  const pos = (d: string) => Math.min(100, Math.max(0, ((ms(d) - s0) / span) * 100));
  const months: string[] = [];
  for (let d = new Date(`${start.slice(0, 7)}-01T00:00:00Z`); d.getTime() <= ms(end); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  const status = useMsStatus();
  return (
    <div className="bud-gantt" role="img">
      <div className="bud-gantt-scale">
        {months.filter((_, i) => i % Math.max(1, Math.ceil(months.length / 7)) === 0).map((m) => (
          <span key={m} style={{ left: `${pos(`${m}-01`)}%` }}>{ymLabel(m, lang)}</span>
        ))}
      </div>
      {milestones.map((m) => (
        <div key={m.id} className="bud-gantt-row">
          <div className="bud-gantt-name" title={m.name}>{m.name}</div>
          <div className="bud-gantt-track">
            <div className={`bud-gantt-bar s-${m.status}`} style={{ left: `${pos(m.start)}%`, width: `${Math.max(1.5, pos(m.end) - pos(m.start))}%` }} title={`${m.name}: ${formatDate(m.start)} — ${formatDate(m.end)} · ${status(m.status)} · ${m.progressPct}%`}>
              <div className="bud-gantt-fill" style={{ width: `${m.progressPct}%` }} />
            </div>
            <div className="bud-gantt-today" style={{ left: `${pos(today())}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectModal({ pj, onClose }: { pj: BudgetingProject; onClose: () => void }) {
  const { lang, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const toast = useToast();
  const err = useErrText();
  const ps = useProjStatus();
  const msStatus = useMsStatus();
  const goals = useApi(() => budgetingApi.listGoals());
  const editable = can('budgeting', 'edit') || pj.passport.managerId === user.id;
  const [pass, setPass] = useState<null | { goal: string; scope: string; kpi: string; risks: string; status: BudgetingProjectStatus }>(null);
  const [ms, setMs] = useState<null | { id?: string; name: string; start: string; end: string; budgetMln: string; progress: string; status: BudgetingMilestoneStatus }>(null);
  const [spend, setSpend] = useState<null | { id: string; mln: string }>(null);
  const actual = pj.milestones.reduce((s, m) => s + m.actual, 0);
  const goal = goals.data?.find((g) => g.id === pj.goalId);
  return (
    <Drawer
      open
      width={860}
      title={`${pj.code} · ${pj.name}`}
      onClose={onClose}
      footer={
        <>
          <PrintButton
            label={p('Паспорт проекта', 'Loyiha pasporti', 'Project passport')}
            doc={{
              entity: 'budget_project', entityId: pj.id, number: pj.code, date: today(), title: p('Паспорт инвестиционного проекта', 'Investitsiya loyihasi pasporti', 'Investment project passport'),
              fields: [
                { label: p('Проект', 'Loyiha', 'Project'), value: pj.name },
                { label: p('Подразделение', "Bo'linma", 'Department'), value: lk.department(pj.departmentId) ? loc(lk.department(pj.departmentId)!.name) : pj.departmentId },
                { label: p('Сроки', 'Muddatlar', 'Dates'), value: `${formatDate(pj.start)} — ${formatDate(pj.end)}` },
                { label: p('Бюджет', 'Byudjet', 'Budget'), value: formatMoney(pj.budget) },
                { label: p('Освоено', 'O‘zlashtirildi', 'Spent'), value: formatMoney(actual) },
                { label: p('Цель банка', 'Bank maqsadi', 'Bank goal'), value: goal ? loc(goal.name) : '' },
                { label: p('Источник финансирования', 'Moliyalashtirish manbai', 'Funding source'), value: pj.passport.fundingSource },
              ],
              paragraphs: [`${p('Цель', 'Maqsad', 'Goal')}: ${pj.passport.goal}`, `${p('Содержание', 'Mazmuni', 'Scope')}: ${pj.passport.scope}`, `KPI: ${pj.passport.kpi}`, `${p('Риски', 'Xavflar', 'Risks')}: ${pj.passport.risks}`],
              table: { columns: [{ header: p('Этап', 'Bosqich', 'Milestone') }, { header: p('Сроки', 'Muddatlar', 'Dates') }, { header: p('Бюджет', 'Byudjet', 'Budget'), align: 'right' }, { header: p('Факт', 'Fakt', 'Actual'), align: 'right' }, { header: '%', align: 'right' }], rows: pj.milestones.map((m) => [m.name, `${formatDate(m.start)} — ${formatDate(m.end)}`, formatMoney(m.budget), formatMoney(m.actual), `${m.progressPct}%`]) },
              signers: [{ role: p('Спонсор', 'Homiy', 'Sponsor'), name: lk.user(pj.passport.sponsorId)?.fullName ?? '' }, { role: p('Руководитель проекта', 'Loyiha rahbari', 'Project manager'), name: lk.user(pj.passport.managerId)?.fullName ?? '' }],
            }}
          />
          {editable && <Button onClick={() => setPass({ goal: pj.passport.goal, scope: pj.passport.scope, kpi: pj.passport.kpi, risks: pj.passport.risks, status: pj.status })}>{p('Изменить паспорт', 'Pasportni o‘zgartirish', 'Edit passport')}</Button>}
          <Button onClick={onClose}>{p('Закрыть', 'Yopish', 'Close')}</Button>
        </>
      }
    >
      <div className="bud-drawer-col">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone="info">{ps(pj.status)}</Badge>
        <span className="muted small">{formatDate(pj.start)} — {formatDate(pj.end)} · {lk.user(pj.passport.managerId)?.fullName}</span>
        <b className="num" style={{ marginLeft: 'auto' }}>{formatMoneyShort(actual, lang)} / {formatMoneyShort(pj.budget, lang)}</b>
      </div>
      <dl className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
        <dt>{p('Цель проекта', 'Loyiha maqsadi', 'Project goal')}</dt>
        <dd style={{ fontWeight: 400 }}>{pj.passport.goal}</dd>
        <dt>{p('Содержание', 'Mazmuni', 'Scope')}</dt>
        <dd style={{ fontWeight: 400 }}>{pj.passport.scope}</dd>
        <dt>KPI</dt>
        <dd style={{ fontWeight: 400 }}>{pj.passport.kpi || '—'}</dd>
        <dt>{p('Риски', 'Xavflar', 'Risks')}</dt>
        <dd style={{ fontWeight: 400 }}>{pj.passport.risks}</dd>
        <dt>{p('Стратегическая цель', 'Strategik maqsad', 'Strategic goal')}</dt>
        <dd>{goal ? `${goal.code} · ${loc(goal.name)}` : '—'}</dd>
      </dl>
      <div style={{ fontWeight: 650 }}>{p('Диаграмма Ганта', 'Gant diagrammasi', 'Gantt chart')}</div>
      <Gantt milestones={pj.milestones} start={pj.start} end={pj.end} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ flex: 1 }}>{p('Этапы и бюджет', 'Bosqichlar va byudjet', 'Milestones and budget')}</b>
        {editable && <Button size="small" icon="plus" onClick={() => setMs({ name: '', start: pj.start, end: pj.end, budgetMln: '', progress: '0', status: 'planned' })}>{p('Этап', 'Bosqich', 'Milestone')}</Button>}
      </div>
      <DataTable
        rows={pj.milestones}
        rowKey={(m) => m.id}
        columns={[
          { header: p('Этап', 'Bosqich', 'Milestone'), render: (m) => <>{m.name}<div className="sub">{formatDate(m.start)} — {formatDate(m.end)}</div></> },
          { header: p('Бюджет', 'Byudjet', 'Budget'), align: 'right', render: (m) => formatMoneyShort(m.budget, lang) },
          { header: p('Факт', 'Fakt', 'Actual'), align: 'right', render: (m) => <span style={{ color: m.actual > m.budget ? 'var(--danger)' : undefined }}>{formatMoneyShort(m.actual, lang)}</span> },
          { header: '%', align: 'right', render: (m) => `${m.progressPct}%` },
          { header: p('Статус', 'Holat', 'Status'), render: (m) => <Badge tone={MS_TONE[m.status]}>{msStatus(m.status)}</Badge> },
          ...(editable
            ? [{
                header: '',
                render: (m: BudgetingMilestone) => (
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <Button size="small" type="text" icon="pen" title={p('Изменить этап', 'Bosqichni o‘zgartirish', 'Edit milestone')} onClick={() => setMs({ id: m.id, name: m.name, start: m.start, end: m.end, budgetMln: String(m.budget / 1_000_000), progress: String(m.progressPct), status: m.status })} />
                    <Button size="small" type="text" icon="coins" title={p('Отразить освоение', 'O‘zlashtirishni aks ettirish', 'Record spend')} onClick={() => setSpend({ id: m.id, mln: '' })} />
                  </span>
                ),
              }]
            : []),
        ]}
      />
      <Attachments entity="budget_project" entityId={pj.id} readOnly={!editable} />
      <FieldHistory entity="budget_project" entityId={pj.id} />
      </div>
      {pass && (
        <Modal
          title={p('Паспорт проекта', 'Loyiha pasporti', 'Project passport')}
          onClose={() => setPass(null)}
          footer={
            <>
              <Button onClick={() => setPass(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await budgetingApi.updatePassport(pj.id, pass, user); toast(p('Паспорт сохранён', 'Pasport saqlandi', 'Passport saved')); setPass(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <Field label={p('Цель проекта', 'Loyiha maqsadi', 'Project goal')}><Textarea value={pass.goal} onChange={(e) => setPass({ ...pass, goal: e.target.value })} rows={2} /></Field>
          <Field label={p('Содержание', 'Mazmuni', 'Scope')}><Textarea value={pass.scope} onChange={(e) => setPass({ ...pass, scope: e.target.value })} rows={2} /></Field>
          <Field label="KPI"><Textarea value={pass.kpi} onChange={(e) => setPass({ ...pass, kpi: e.target.value })} rows={2} /></Field>
          <Field label={p('Риски', 'Xavflar', 'Risks')}><Textarea value={pass.risks} onChange={(e) => setPass({ ...pass, risks: e.target.value })} rows={2} /></Field>
          <Field label={p('Статус', 'Holat', 'Status')}>
            <Select<BudgetingProjectStatus> value={pass.status} onChange={(v) => setPass({ ...pass, status: v })} options={(['initiation', 'in_progress', 'on_hold', 'completed'] as const).map((v) => ({ value: v, label: ps(v) }))} />
          </Field>
        </Modal>
      )}
      {ms && (
        <Modal
          title={ms.id ? p('Этап проекта', 'Loyiha bosqichi', 'Project milestone') : p('Новый этап', 'Yangi bosqich', 'New milestone')}
          onClose={() => setMs(null)}
          footer={
            <>
              <Button onClick={() => setMs(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await budgetingApi.saveMilestone(pj.id, { ...(ms.id ? { id: ms.id } : {}), name: ms.name, start: ms.start, end: ms.end, budget: parseMln(ms.budgetMln), progressPct: Number(ms.progress), status: ms.status }, user); toast(p('Этап сохранён', 'Bosqich saqlandi', 'Milestone saved')); setMs(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={p('Название', 'Nomi', 'Name')} className="span-2"><Input value={ms.name} onChange={(e) => setMs({ ...ms, name: e.target.value })} ariaLabel={p('Название этапа', 'Bosqich nomi', 'Milestone name')} /></Field>
            <Field label={p('Начало', 'Boshlanishi', 'Start')}><Input type="date" value={ms.start} onChange={(e) => setMs({ ...ms, start: e.target.value })} /></Field>
            <Field label={p('Окончание', 'Tugashi', 'End')}><Input type="date" value={ms.end} onChange={(e) => setMs({ ...ms, end: e.target.value })} /></Field>
            <Field label={p('Бюджет, млн сум', 'Byudjet, mln so‘m', 'Budget, mln UZS')}><Input value={ms.budgetMln} inputMode="decimal" onChange={(e) => setMs({ ...ms, budgetMln: e.target.value })} ariaLabel={p('Бюджет этапа', 'Bosqich byudjeti', 'Milestone budget')} /></Field>
            <Field label={p('Прогресс, %', 'Progress, %', 'Progress, %')}><Input value={ms.progress} inputMode="numeric" onChange={(e) => setMs({ ...ms, progress: e.target.value })} ariaLabel="%" /></Field>
            <Field label={p('Статус', 'Holat', 'Status')} className="span-2">
              <Select<BudgetingMilestoneStatus> value={ms.status} onChange={(v) => setMs({ ...ms, status: v })} options={(['planned', 'in_progress', 'done', 'delayed'] as const).map((v) => ({ value: v, label: msStatus(v) }))} />
            </Field>
          </div>
        </Modal>
      )}
      {spend && (
        <Modal
          title={p('Освоение по этапу', 'Bosqich bo‘yicha o‘zlashtirish', 'Milestone spend')}
          onClose={() => setSpend(null)}
          footer={
            <>
              <Button onClick={() => setSpend(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await budgetingApi.recordMilestoneSpend(pj.id, spend.id, parseMln(spend.mln), user); toast(p('Освоение отражено, бюджет статьи списан', 'O‘zlashtirish aks ettirildi, modda byudjeti hisobdan chiqarildi', 'Spend recorded, article budget consumed')); setSpend(null); } catch (e) { toast(err(e)); } }}>{p('Провести', "O'tkazish", 'Post')}</Button>
            </>
          }
        >
          <Field label={p('Сумма, млн сум', 'Summa, mln so‘m', 'Amount, mln UZS')} hint={p('Проходит бюджетный контроль статьи проекта (hard/soft)', 'Loyiha moddasi byudjet nazoratidan o‘tadi (hard/soft)', 'Goes through the project article budget control (hard/soft)')}>
            <Input value={spend.mln} inputMode="decimal" onChange={(e) => setSpend({ ...spend, mln: e.target.value })} ariaLabel={p('Сумма освоения', 'O‘zlashtirish summasi', 'Spend amount')} />
          </Field>
        </Modal>
      )}
    </Drawer>
  );
}
