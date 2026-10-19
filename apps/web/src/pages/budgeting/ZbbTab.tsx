// ZBB — бюджетирование «с нуля» (ТЗ PR-BUD-001, 4.2.13 «По ZBB»): пакеты подразделений на следующий год,
// по каждой статье — расчёт, экономическое обоснование, стратегическая цель, риски нефинансирования (Impact of non-funding),
// приоритет; уровни одобрения — маршрут 'budget_zbb' (руководитель → финансы → Правление сверх порога).
import { useEffect, useState } from 'react';
import { budgetingApi, formatDate, formatMoney, formatMoneyShort, type BudgetingZbbItem, type BudgetingZbbPackage, type BudgetingZbbPriority } from '@xb/shared';
import { Badge, Button, Card, DataTable, Drawer, Field, FilterBar, Input, Modal, RouteSteps, Select, Textarea, Timeline, useToast, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useDocStatusLabel } from './ControlTab';
import { parseMln, useErrText, usePick } from './shared';

export const DOC_TONE: Record<string, Tone> = { draft: 'muted', pending: 'warn', approved: 'ok', rejected: 'danger', returned: 'info' };
type Draft = { articleId: string; amountMln: string; calc: string; justification: string; goalId: string; impact: string; priority: BudgetingZbbPriority };

function usePriorityLabel() {
  const p = usePick();
  return (v: BudgetingZbbPriority) => ({ mandatory: p('Обязательный', 'Majburiy', 'Mandatory'), important: p('Важный', 'Muhim', 'Important'), desirable: p('Желательный', 'Istalgan', 'Desirable') })[v];
}

export function ZbbTab({ openId }: { openId?: string }) {
  const { lang, loc } = useSession();
  const p = usePick();
  const lk = useLookups();
  const st = useDocStatusLabel();
  const list = useApi(() => budgetingApi.listZbb());
  const plan = useApi(() => budgetingApi.plan2027());
  const articles = useApi(() => budgetingApi.listArticles());
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [editing, setEditing] = useState<BudgetingZbbPackage | 'new' | null>(null);
  useEffect(() => {
    if (openId) setOpen(openId);
  }, [openId]);
  const art = (id: string) => articles.data?.find((a) => a.id === id);
  const cur = list.data?.find((x) => x.id === open);
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>
          {p('Бюджет следующего года формируется «с нуля»: каждая статья обосновывается расчётом, связывается со стратегической целью и описывает риски нефинансирования.', 'Keyingi yil byudjeti «noldan» shakllantiriladi: har bir modda hisob-kitob bilan asoslanadi, strategik maqsad bilan bog‘lanadi va moliyalashtirilmaslik xavflari yoziladi.', 'Next year’s budget is built from zero: each item is justified by a calculation, linked to a strategic goal and describes the impact of non-funding.')}
        </span>
        <Button type="primary" size="small" icon="plus" onClick={() => setEditing('new')}>{p('Новый ZBB-пакет', 'Yangi ZBB paketi', 'New ZBB package')}</Button>
        <ExportButton<BudgetingZbbPackage>
          filename="budget-zbb-2027"
          rows={list.data ?? []}
          columns={[
            { header: '№', value: (z) => z.number },
            { header: p('Название', 'Nomi', 'Title'), value: (z) => z.title },
            { header: p('Подразделение', "Bo'linma", 'Department'), value: (z) => lk.department(z.departmentId)?.code ?? z.departmentId },
            { header: p('Статей', 'Moddalar', 'Items'), value: (z) => z.items.length, format: 'integer' },
            { header: p('Сумма', 'Summa', 'Amount'), value: (z) => budgetingApi.zbbTotal(z), format: 'money', total: true },
            { header: p('Статус', 'Holat', 'Status'), value: (z) => st(z.status) },
          ]}
        />
      </FilterBar>
      <div className="bud-split" style={{ padding: 18 }}>
        <Card title={p('ZBB-пакеты 2027', 'ZBB paketlari 2027', 'ZBB packages 2027')} flush>
          <DataTable
            rows={list.data}
            loading={list.loading}
            rowKey={(z) => z.id}
            onRowClick={(z) => setOpen(z.id)}
            columns={[
              { header: '№', render: (z) => <span className="doc-num">{z.number}</span> },
              { header: p('Название', 'Nomi', 'Title'), render: (z) => <>{z.title}<div className="sub">{lk.department(z.departmentId)?.code} · {z.items.length} {p('стат.', 'modda', 'items')}</div></> },
              { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (z) => formatMoneyShort(budgetingApi.zbbTotal(z), lang) },
              { header: p('Статус', 'Holat', 'Status'), render: (z) => <Badge tone={DOC_TONE[z.status] ?? 'muted'}>{st(z.status)}</Badge> },
            ]}
          />
        </Card>
        <Card title={p('Утверждённый бюджет 2027 по ZBB', 'ZBB bo‘yicha tasdiqlangan 2027 byudjeti', 'Approved 2027 budget (ZBB)')} flush>
          <DataTable
            rows={plan.data}
            rowKey={(r) => r.articleId}
            emptyText={p('Утверждённых пакетов нет', "Tasdiqlangan paketlar yo'q", 'No approved packages')}
            columns={[
              { header: p('Статья', 'Modda', 'Article'), render: (r) => <>{art(r.articleId) ? loc(art(r.articleId)!.name) : r.articleId}<div className="sub">{art(r.articleId)?.code}</div></> },
              { header: p('Пакетов', 'Paketlar', 'Packages'), align: 'right', render: (r) => r.packages },
              { header: p('Сумма 2027', '2027 summasi', 'Amount 2027'), align: 'right', render: (r) => formatMoneyShort(r.amount, lang) },
            ]}
          />
        </Card>
      </div>
      {cur && <ZbbModal z={cur} onEdit={() => setEditing(cur)} onClose={() => { setOpen(null); if (openId) navigate('/budgeting?tab=zbb'); }} />}
      {editing && <ZbbForm pkg={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={(z) => { setEditing(null); setOpen(z.id); }} />}
    </>
  );
}

function ZbbModal({ z, onEdit, onClose }: { z: BudgetingZbbPackage; onEdit: () => void; onClose: () => void }) {
  const { lang, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const lk = useLookups();
  const st = useDocStatusLabel();
  const pr = usePriorityLabel();
  const articles = useApi(() => budgetingApi.listArticles());
  const goals = useApi(() => budgetingApi.listGoals());
  const art = (id: string) => articles.data?.find((a) => a.id === id);
  const goal = (id: string) => goals.data?.find((g) => g.id === id);
  const total = budgetingApi.zbbTotal(z);
  const editable = ['draft', 'returned', 'rejected'].includes(z.status) && z.requesterId === user.id;
  return (
    <Modal
      title={`${z.number} · ${z.title}`}
      onClose={onClose}
      footer={
        <>
          <PrintButton
            doc={{
              entity: 'budget_zbb', entityId: z.id, number: z.number, date: z.createdAt.slice(0, 10), title: p('ZBB-пакет бюджета', 'ZBB byudjet paketi', 'ZBB budget package'), landscape: true,
              fields: [
                { label: p('Подразделение', "Bo'linma", 'Department'), value: lk.department(z.departmentId) ? loc(lk.department(z.departmentId)!.name) : z.departmentId },
                { label: p('Год', 'Yil', 'Year'), value: String(z.year) },
                { label: p('Итого', 'Jami', 'Total'), value: formatMoney(total) },
                { label: p('Статус', 'Holat', 'Status'), value: st(z.status) },
              ],
              table: {
                columns: [{ header: p('Статья', 'Modda', 'Article') }, { header: p('Сумма', 'Summa', 'Amount'), align: 'right' }, { header: p('Обоснование', 'Asoslash', 'Justification') }, { header: p('Цель', 'Maqsad', 'Goal') }, { header: 'Impact of non-funding' }],
                rows: z.items.map((i) => [art(i.articleId) ? loc(art(i.articleId)!.name) : i.articleId, formatMoney(i.amount), `${i.justification} (${i.calc})`, goal(i.goalId) ? loc(goal(i.goalId)!.name) : '', i.impact]),
                totals: ['', formatMoney(total), '', '', ''],
              },
              signers: [{ role: p('Инициатор', 'Tashabbuskor', 'Initiator'), name: lk.user(z.requesterId)?.fullName ?? '' }],
            }}
          />
          {editable && <Button type="primary" onClick={onEdit}>{p('Редактировать', 'Tahrirlash', 'Edit')}</Button>}
          <Button onClick={onClose}>{p('Закрыть', 'Yopish', 'Close')}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone={DOC_TONE[z.status] ?? 'muted'}>{st(z.status)}</Badge>
        <span className="muted small">{lk.department(z.departmentId)?.code} · {p('создан', 'yaratilgan', 'created')} {formatDate(z.createdAt)} · {lk.user(z.requesterId)?.fullName}</span>
        <b className="num" style={{ marginLeft: 'auto' }}>{formatMoneyShort(total, lang)}</b>
      </div>
      {z.items.map((i) => (
        <div key={i.id} className="bud-zbb-item">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <b>{art(i.articleId) ? `${art(i.articleId)!.code} · ${loc(art(i.articleId)!.name)}` : i.articleId}</b>
            <span><Badge tone={i.priority === 'mandatory' ? 'danger' : i.priority === 'important' ? 'warn' : 'muted'}>{pr(i.priority)}</Badge> <b className="num">{formatMoneyShort(i.amount, lang)}</b></span>
          </div>
          <div className="small muted">{p('Расчёт', 'Hisob-kitob', 'Calculation')}: {i.calc || '—'}</div>
          <div className="small">{p('Обоснование', 'Asoslash', 'Justification')}: {i.justification}</div>
          <div className="small">{p('Цель', 'Maqsad', 'Goal')}: {goal(i.goalId) ? `${goal(i.goalId)!.code} · ${loc(goal(i.goalId)!.name)}` : '—'}</div>
          <div className="small" style={{ color: 'var(--danger)' }}>Impact of non-funding: {i.impact}</div>
        </div>
      ))}
      {z.status === 'draft' ? <RouteSteps preview={{ entity: 'budget_zbb', context: { amount: total, departmentId: z.departmentId, requesterId: z.requesterId } }} /> : <RouteSteps entityId={z.id} />}
      <Timeline events={z.history} />
    </Modal>
  );
}

function ZbbForm({ pkg, onClose, onSaved }: { pkg?: BudgetingZbbPackage; onClose: () => void; onSaved: (z: BudgetingZbbPackage) => void }) {
  const { loc } = useSession();
  const p = usePick();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useErrText();
  const pr = usePriorityLabel();
  const articles = useApi(() => budgetingApi.listArticles());
  const goals = useApi(() => budgetingApi.listGoals());
  const [title, setTitle] = useState(pkg?.title ?? '');
  const [dept, setDept] = useState(pkg?.departmentId ?? user.departmentId);
  const toDraft = (i: BudgetingZbbItem): Draft => ({ articleId: i.articleId, amountMln: String(i.amount / 1_000_000), calc: i.calc, justification: i.justification, goalId: i.goalId, impact: i.impact, priority: i.priority });
  const empty = (): Draft => ({ articleId: '', amountMln: '', calc: '', justification: '', goalId: '', impact: '', priority: 'important' });
  const [items, setItems] = useState<Draft[]>(() => (pkg?.items.length ? pkg.items.map(toDraft) : [empty()]));
  const [error, setError] = useState('');
  const set = (i: number, patch: Partial<Draft>) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = items.reduce((s, i) => s + (parseMln(i.amountMln) || 0), 0);
  async function save(submit: boolean) {
    setError('');
    try {
      const z = await budgetingApi.saveZbb(
        { ...(pkg ? { id: pkg.id } : {}), title, departmentId: dept, items: items.filter((i) => i.articleId).map((i) => ({ articleId: i.articleId, amount: parseMln(i.amountMln), calc: i.calc, justification: i.justification, goalId: i.goalId, impact: i.impact, priority: i.priority })) },
        submit,
        user,
      );
      toast(`${z.number}: ${submit ? p('отправлен на согласование', 'kelishuvga yuborildi', 'submitted for approval') : p('черновик сохранён', 'qoralama saqlandi', 'draft saved')}`);
      onSaved(z);
    } catch (e) {
      setError(err(e));
    }
  }
  return (
    <Drawer
      open
      width={720}
      title={pkg ? pkg.number : p('Новый ZBB-пакет 2027', 'Yangi ZBB paketi 2027', 'New ZBB package 2027')}
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
        <Field label={p('Название пакета', 'Paket nomi', 'Package title')} required className="span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} ariaLabel={p('Название пакета', 'Paket nomi', 'Package title')} /></Field>
        <Field label={p('Подразделение', "Bo'linma", 'Department')} required>
          <Select value={dept} onChange={setDept} ariaLabel={p('Подразделение', "Bo'linma", 'Department')} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} />
        </Field>
        <Field label={p('Итого', 'Jami', 'Total')}><Input value={formatMoney(total)} readOnly /></Field>
      </div>
      {items.map((it, i) => (
        <div key={i} className="bud-zbb-item">
          <div className="form-grid">
            <Field label={p('Статья расходов', 'Xarajat moddasi', 'Expense article')} required>
              <Select value={it.articleId} onChange={(v) => set(i, { articleId: v })} placeholder="—" ariaLabel={`${p('Статья', 'Modda', 'Article')} ${i + 1}`} options={(articles.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${loc(a.name)}` }))} />
            </Field>
            <Field label={p('Сумма, млн сум', 'Summa, mln so‘m', 'Amount, mln UZS')} required>
              <Input value={it.amountMln} inputMode="decimal" onChange={(e) => set(i, { amountMln: e.target.value })} ariaLabel={`${p('Сумма', 'Summa', 'Amount')} ${i + 1}`} />
            </Field>
            <Field label={p('Расчёт (база × норматив)', 'Hisob-kitob (baza × norma)', 'Calculation (base × rate)')} className="span-2">
              <Input value={it.calc} onChange={(e) => set(i, { calc: e.target.value })} ariaLabel={`${p('Расчёт', 'Hisob-kitob', 'Calculation')} ${i + 1}`} />
            </Field>
            <Field label={p('Экономическое обоснование', 'Iqtisodiy asoslash', 'Economic justification')} required className="span-2">
              <Textarea value={it.justification} onChange={(e) => set(i, { justification: e.target.value })} rows={2} ariaLabel={`${p('Обоснование', 'Asoslash', 'Justification')} ${i + 1}`} />
            </Field>
            <Field label={p('Стратегическая цель', 'Strategik maqsad', 'Strategic goal')} required>
              <Select value={it.goalId} onChange={(v) => set(i, { goalId: v })} placeholder="—" ariaLabel={`${p('Цель', 'Maqsad', 'Goal')} ${i + 1}`} options={(goals.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${loc(g.name)}` }))} />
            </Field>
            <Field label={p('Приоритет', 'Ustuvorlik', 'Priority')}>
              <Select<BudgetingZbbPriority> value={it.priority} onChange={(v) => set(i, { priority: v })} ariaLabel={`${p('Приоритет', 'Ustuvorlik', 'Priority')} ${i + 1}`} options={(['mandatory', 'important', 'desirable'] as const).map((v) => ({ value: v, label: pr(v) }))} />
            </Field>
            <Field label={p('Риски нефинансирования (Impact of non-funding)', 'Moliyalashtirilmaslik xavflari (Impact of non-funding)', 'Impact of non-funding')} required className="span-2">
              <Textarea value={it.impact} onChange={(e) => set(i, { impact: e.target.value })} rows={2} ariaLabel={`Impact ${i + 1}`} />
            </Field>
          </div>
          {items.length > 1 && <Button size="small" type="text" danger icon="trash" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>{p('Удалить статью', "Moddani o'chirish", 'Remove item')}</Button>}
        </div>
      ))}
      <Button size="small" icon="plus" onClick={() => setItems((l) => [...l, empty()])}>{p('Добавить статью', "Modda qo'shish", 'Add item')}</Button>
      {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      <RouteSteps preview={{ entity: 'budget_zbb', context: { amount: total, departmentId: dept, requesterId: user.id } }} />
    </Drawer>
  );
}
