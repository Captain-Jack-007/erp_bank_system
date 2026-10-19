// Бюджетный контроль (ТЗ 4.2.13.2): проверка транзакции по триаде (лимит ZBB год/месяц · кассовый план · склад),
// режимы hard/soft, подтверждение превышения руководителем, журнал транзакций, сигналы 70/80/90%, кассовый план, настройки.
import { useEffect, useState } from 'react';
import {
  budgetingApi,
  BudgetingControlError,
  formatDateTime,
  formatMoney,
  formatMoneyShort,
  orgApi,
  type BudgetingCashPlanView,
  type BudgetingCheckResult,
  type BudgetingControlMode,
  type BudgetingOverrun,
  type BudgetingSource,
  type BudgetingTxn,
  type Localized,
} from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, Progress, RouteSteps, Select, Switch, Tabs, Textarea, Timeline, useToast, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { useCan } from '../../lib/access';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { MONTHS, parseMln, useErrText, usePick } from './shared';

type Sub = 'check' | 'ledger' | 'overruns' | 'signals' | 'cash' | 'settings';

const SOURCES: BudgetingSource[] = ['procurement', 'payment', 'trip', 'employee_request', 'contract', 'project', 'manual'];

export function useSourceLabel() {
  const p = usePick();
  return (s: BudgetingSource) =>
    ({
      procurement: p('Заявка на закупку', 'Xarid arizasi', 'Purchase request'),
      payment: p('Платёж', "To'lov", 'Payment'),
      trip: p('Командировка', 'Xizmat safari', 'Business trip'),
      employee_request: p('Заявка на расход', 'Xarajat arizasi', 'Expense request'),
      contract: p('Договор', 'Shartnoma', 'Contract'),
      project: p('Инвестпроект', 'Investitsiya loyihasi', 'Investment project'),
      manual: p('Ручная операция', "Qo'lda operatsiya", 'Manual entry'),
    })[s];
}

const KIND_TONE: Record<BudgetingTxn['kind'], Tone> = { reserve: 'info', consume: 'ok', release: 'muted', blocked: 'danger' };

export function ControlTab({ overrunId }: { overrunId?: string }) {
  const p = usePick();
  const [sub, setSub] = useState<Sub>(overrunId ? 'overruns' : 'check');
  useEffect(() => {
    if (overrunId) setSub('overruns');
  }, [overrunId]);
  const ov = useApi(() => budgetingApi.listOverruns());
  return (
    <>
      <div className="bud-subtabs">
        <Tabs<Sub>
          value={sub}
          onChange={setSub}
          items={[
            { value: 'check', label: p('Проверка транзакции', 'Tranzaksiyani tekshirish', 'Transaction check') },
            { value: 'ledger', label: p('Журнал', 'Jurnal', 'Ledger') },
            { value: 'overruns', label: p('Подтверждения превышения', 'Oshishni tasdiqlash', 'Overrun confirmations'), count: ov.data?.filter((o) => o.status === 'pending').length ?? 0 },
            { value: 'signals', label: p('Сигналы 70/80/90%', 'Signallar 70/80/90%', 'Signals 70/80/90%') },
            { value: 'cash', label: p('Кассовый план', 'Kassa rejasi', 'Cash plan') },
            { value: 'settings', label: p('Режимы контроля', 'Nazorat rejimlari', 'Control modes') },
          ]}
        />
      </div>
      {sub === 'check' && <CheckPanel />}
      {sub === 'ledger' && <Ledger />}
      {sub === 'overruns' && <Overruns openId={overrunId} />}
      {sub === 'signals' && <Signals />}
      {sub === 'cash' && <CashPlan />}
      {sub === 'settings' && <Settings />}
    </>
  );
}

function ModeBadge({ mode }: { mode: BudgetingControlMode }) {
  return <Badge tone={mode === 'hard' ? 'danger' : 'warn'}>{mode === 'hard' ? 'Hard-check' : 'Soft-check'}</Badge>;
}

function LimitBox({ title, b, month }: { title: string; b: { limit: number; used: number; available: number; ok: boolean }; month?: number }) {
  const { lang } = useSession();
  const p = usePick();
  const usage = b.limit > 0 ? Math.round((b.used / b.limit) * 1000) / 10 : 0;
  return (
    <div className={`bud-limit ${b.ok ? '' : 'bad'}`}>
      <div className="bud-limit-head">
        <b>{title}{month !== undefined ? ` · ${MONTHS[lang][month]}` : ''}</b>
        <Badge tone={b.ok ? 'ok' : 'danger'}>{b.ok ? p('Проходит', "O'tadi", 'Passes') : p('Не проходит', "O'tmaydi", 'Fails')}</Badge>
      </div>
      <Progress pct={usage} />
      <dl className="kv" style={{ gridTemplateColumns: '1fr auto', marginTop: 8 }}>
        <dt>{p('Лимит', 'Limit', 'Limit')}</dt>
        <dd className="num">{formatMoneyShort(b.limit, lang)}</dd>
        <dt>{p('Использовано', 'Foydalanilgan', 'Used')}</dt>
        <dd className="num">{formatMoneyShort(b.used, lang)}</dd>
        <dt>{p('Доступно', 'Mavjud', 'Available')}</dt>
        <dd className="num" style={{ color: b.available < 0 ? 'var(--danger)' : undefined }}>{formatMoneyShort(b.available, lang)}</dd>
      </dl>
    </div>
  );
}

export function CheckResult({ r }: { r: BudgetingCheckResult }) {
  const { loc } = useSession();
  const p = usePick();
  const tone: Tone = r.status === 'ok' ? 'ok' : r.status === 'warning' ? 'warn' : 'danger';
  return (
    <div className="bud-check" data-testid="bud-check">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone={tone}>{r.status === 'ok' ? p('Лимит доступен', 'Limit mavjud', 'Within limit') : r.status === 'warning' ? p('Предупреждение', 'Ogohlantirish', 'Warning') : p('Превышение', 'Oshish', 'Exceeded')}</Badge>
        <ModeBadge mode={r.mode} />
        {r.blocked && <Badge tone="danger">{p('Транзакция заблокирована', 'Tranzaksiya bloklangan', 'Transaction blocked')}</Badge>}
        {r.requiresConfirmation && <Badge tone="warn">{p('Нужно подтверждение руководителя', 'Rahbar tasdig‘i kerak', 'Manager confirmation needed')}</Badge>}
        {r.overrunApproved && <Badge tone="ok">{p('Превышение подтверждено', 'Oshish tasdiqlangan', 'Overrun confirmed')}</Badge>}
        <span className="muted small">{p('Освоение', 'O‘zlashtirish', 'Usage')}: {r.usagePctBefore}% → {r.usagePctAfter}%</span>
      </div>
      <div className="bud-limits">
        <LimitBox title={p('Годовой лимит (ZBB)', 'Yillik limit (ZBB)', 'Annual limit (ZBB)')} b={r.annual} />
        <LimitBox title={p('Лимит нарастающим итогом', 'O‘sib boruvchi limit', 'Cumulative limit')} b={r.monthly} month={r.monthly.month} />
        <LimitBox title={p('Кассовый план (ОДДС)', 'Kassa rejasi (PHO)', 'Cash-flow plan')} b={r.cash} month={r.cash.month} />
      </div>
      {r.messages.length > 0 && (
        <ul className="bud-msgs">
          {r.messages.map((m: Localized, i) => (
            <li key={i}>{loc(m)}</li>
          ))}
        </ul>
      )}
      {r.stock.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>{p('Складские остатки — предложение внутреннего ресурса', 'Ombor qoldiqlari — ichki resurs taklifi', 'Stock on hand — internal resource suggestion')}</div>
          <DataTable
            rows={r.stock}
            rowKey={(s) => s.itemId}
            onRowClick={() => navigate('/warehouse')}
            columns={[
              { header: 'SKU', render: (s) => <span className="doc-num">{s.sku}</span> },
              { header: p('ТМЦ', 'TMB', 'Item'), render: (s) => s.name },
              { header: p('На складе', 'Omborda', 'On hand'), align: 'right', render: (s) => `${s.qty} ${s.unit}` },
              { header: p('Запрошено', "So'ralgan", 'Requested'), align: 'right', render: (s) => s.requested },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function CheckPanel() {
  const { lang, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useErrText();
  const srcLabel = useSourceLabel();
  const lines = useApi(() => budgetingApi.listLines());
  const articles = useApi(() => budgetingApi.listArticles());
  const units = useApi(() => orgApi.listOrgUnits());
  const overruns = useApi(() => budgetingApi.listOverruns());
  const [source, setSource] = useState<BudgetingSource>('procurement');
  const [dept, setDept] = useState('d1');
  const [unit, setUnit] = useState('d1');
  const [cc, setCc] = useState('');
  const [article, setArticle] = useState('ba9');
  const [amountMln, setAmountMln] = useState('500');
  const [doc, setDoc] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [overrunId, setOverrunId] = useState('');
  const [result, setResult] = useState<BudgetingCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ref, setRef] = useState(() => `sim-${Date.now().toString(36)}`);

  const depts = [...new Set((lines.data ?? []).map((l) => l.departmentId))];
  const deptUnits = [...new Set((lines.data ?? []).filter((l) => l.departmentId === dept).map((l) => l.orgUnitKey))];
  const ccs = useApi(() => orgApi.listCostCenters({ orgUnitKey: unit, status: 'active', pageSize: 40 }), [unit]);
  const unitName = (k: string) => (k.startsWith('d') ? (lk.department(k) ? loc(lk.department(k)!.name) : k) : units.data?.find((u) => u.key === k) ? loc(units.data.find((u) => u.key === k)!.name) : k);
  const amount = parseMln(amountMln);
  const label = doc.trim() || `${srcLabel(source)} · ${formatMoney(amount)}`;
  const input = () => ({
    articleId: article, departmentId: dept, orgUnitKey: unit, ...(cc ? { costCenterKey: cc } : {}), amount, source, ref, refLabel: label,
    ...(itemName.trim() ? { items: [{ name: itemName.trim(), qty: Number(itemQty) || 1 }] } : {}), ...(overrunId ? { overrunId } : {}),
  });
  const approvedOverruns = (overruns.data ?? []).filter((o) => o.status === 'approved' && o.ref);

  async function doCheck() {
    if (!(amount > 0)) return toast(err(new Error('budgeting_err_amount')));
    setBusy(true);
    try {
      setResult(await budgetingApi.checkLimit(input()));
    } finally {
      setBusy(false);
    }
  }
  async function post() {
    setBusy(true);
    try {
      const call = source === 'payment' ? budgetingApi.consume : budgetingApi.reserve;
      const r = await call(input(), user);
      toast(`${source === 'payment' ? p('Списано', 'Hisobdan chiqarildi', 'Consumed') : p('Зарезервировано', 'Zaxiralandi', 'Reserved')}: ${formatMoney(r.txn.amount)}`);
      setResult(null);
      setRef(`sim-${Date.now().toString(36)}`);
    } catch (e) {
      if (e instanceof BudgetingControlError && e.check) setResult(e.check);
      toast(err(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bud-split">
      <Card title={p('Транзакция расхода', 'Xarajat tranzaksiyasi', 'Expense transaction')}>
        <div className="form-grid">
          <Field label={p('Источник', 'Manba', 'Source')}>
            <Select<BudgetingSource> value={source} onChange={setSource} ariaLabel={p('Источник', 'Manba', 'Source')} options={SOURCES.map((s) => ({ value: s, label: srcLabel(s) }))} />
          </Field>
          <Field label={p('Подразделение', "Bo'linma", 'Department')}>
            <Select value={dept} onChange={(v) => { setDept(v); setUnit(v); setCc(''); setResult(null); }} ariaLabel={p('Подразделение', "Bo'linma", 'Department')} options={depts.map((d) => ({ value: d, label: lk.department(d) ? loc(lk.department(d)!.name) : d }))} />
          </Field>
          <Field label={p('Оргединица / филиал', 'Tashkiliy birlik / filial', 'Org unit / branch')}>
            <Select value={unit} onChange={(v) => { setUnit(v); setCc(''); setResult(null); }} ariaLabel={p('Оргединица', 'Tashkiliy birlik', 'Org unit')} options={deptUnits.map((u) => ({ value: u, label: unitName(u) }))} />
          </Field>
          <Field label={p('МВЗ', 'MXJ', 'Cost centre')} hint={p('Центр затрат из справочника оргструктуры', 'Tashkiliy tuzilma ma’lumotnomasidagi xarajat markazi', 'Cost centre from the org directory')}>
            <Select value={cc} onChange={(v) => { setCc(v); setResult(null); }} placeholder="—" ariaLabel={p('МВЗ', 'MXJ', 'Cost centre')} options={(ccs.data?.rows ?? []).map((c) => ({ value: c.key, label: `${c.code} · ${loc(c.name).split(' · ')[0]}` }))} />
          </Field>
          <Field label={p('Статья бюджета', 'Byudjet moddasi', 'Budget article')}>
            <Select value={article} onChange={(v) => { setArticle(v); setResult(null); }} ariaLabel={p('Статья бюджета', 'Byudjet moddasi', 'Budget article')} options={(articles.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${loc(a.name)} (${a.controlMode})` }))} />
          </Field>
          <Field label={p('Сумма, млн сум', 'Summa, mln so‘m', 'Amount, mln UZS')} hint={amount > 0 ? formatMoney(amount) : undefined}>
            <Input value={amountMln} inputMode="decimal" onChange={(e) => { setAmountMln(e.target.value); setResult(null); }} ariaLabel={p('Сумма, млн сум', 'Summa, mln so‘m', 'Amount, mln UZS')} />
          </Field>
          <Field label={p('Документ-основание', 'Asos hujjat', 'Source document')} className="span-2">
            <Input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder={p('Например: ZK-2026-0150 · Серверы', 'Masalan: ZK-2026-0150 · Serverlar', 'E.g. ZK-2026-0150 · Servers')} />
          </Field>
          <Field label={p('ТМЦ (для проверки склада)', 'TMB (omborni tekshirish uchun)', 'Item (stock check)')}>
            <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder={p('Бумага офисная', 'Ofis qog‘ozi', 'Office paper')} ariaLabel={p('ТМЦ', 'TMB', 'Item')} />
          </Field>
          <Field label={p('Количество', 'Miqdor', 'Quantity')}>
            <Input value={itemQty} inputMode="numeric" onChange={(e) => setItemQty(e.target.value)} ariaLabel={p('Количество', 'Miqdor', 'Quantity')} />
          </Field>
          {approvedOverruns.length > 0 && (
            <Field label={p('Согласованное превышение', 'Kelishilgan oshish', 'Approved overrun')} className="span-2">
              <Select value={overrunId} onChange={setOverrunId} placeholder="—" ariaLabel={p('Согласованное превышение', 'Kelishilgan oshish', 'Approved overrun')} options={approvedOverruns.map((o) => ({ value: o.id, label: `${o.number} · ${o.refLabel} · ${formatMoneyShort(o.amount, lang)}` }))} />
            </Field>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <Button onClick={doCheck} loading={busy}>{p('Проверить лимит', 'Limitni tekshirish', 'Check limit')}</Button>
          <Button type="primary" onClick={post} disabled={busy || !(amount > 0)}>{source === 'payment' ? p('Провести платёж', "To'lovni o'tkazish", 'Post payment') : p('Зарезервировать', 'Zaxiralash', 'Reserve')}</Button>
          {result?.requiresConfirmation && <Button onClick={() => setConfirm(true)}>{p('Запросить подтверждение руководителя', 'Rahbar tasdig‘ini so‘rash', 'Request manager confirmation')}</Button>}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          {p(
            'Тот же контроль вызывается из закупок, платежей по договорам, командировок и заявок на расход (budgetingApi.checkLimit / reserve / consume).',
            'Xuddi shu nazorat xaridlar, shartnoma to‘lovlari, xizmat safarlari va xarajat arizalaridan chaqiriladi (budgetingApi.checkLimit / reserve / consume).',
            'The same control is called from procurement, contract payments, business trips and expense requests (budgetingApi.checkLimit / reserve / consume).',
          )}
        </p>
      </Card>
      <Card title={p('Результат проверки', 'Tekshiruv natijasi', 'Check result')}>
        {result ? <CheckResult r={result} /> : <Empty text={p('Заполните транзакцию и нажмите «Проверить лимит»', 'Tranzaksiyani to‘ldirib «Limitni tekshirish»ni bosing', 'Fill in the transaction and press “Check limit”')} icon="wallet" />}
      </Card>
      {confirm && result && (
        <OverrunRequestModal
          onClose={() => setConfirm(false)}
          onSubmit={async (reason, impact) => {
            const o = await budgetingApi.requestOverrun({ ...input(), reason, impact }, user);
            toast(`${o.number}: ${p('отправлено на подтверждение', 'tasdiqlashga yuborildi', 'sent for confirmation')}`);
            setConfirm(false);
            setResult(null);
          }}
        />
      )}
    </div>
  );
}

export function OverrunRequestModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string, impact: string) => Promise<void> }) {
  const p = usePick();
  const err = useErrText();
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title={p('Подтверждение превышения лимита', 'Limitdan oshishni tasdiqlash', 'Limit overrun confirmation')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
          <Button type="primary" onClick={async () => { try { await onSubmit(reason, impact); } catch (e) { setError(err(e)); } }}>{p('Отправить на подтверждение', 'Tasdiqlashga yuborish', 'Send for confirmation')}</Button>
        </>
      }
    >
      <Field label={p('Обоснование превышения', 'Oshish asoslanishi', 'Reason for overrun')} required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} ariaLabel={p('Обоснование превышения', 'Oshish asoslanishi', 'Reason for overrun')} />
      </Field>
      <Field label={p('Риски нефинансирования (Impact of non-funding)', 'Moliyalashtirilmaslik xavflari (Impact of non-funding)', 'Impact of non-funding')} required>
        <Textarea value={impact} onChange={(e) => setImpact(e.target.value)} ariaLabel="Impact of non-funding" />
      </Field>
      {error && <span className="error-text">{error}</span>}
      <RouteSteps preview={{ entity: 'budget_overrun', context: {} }} />
    </Modal>
  );
}

function Ledger() {
  const { lang, loc } = useSession();
  const p = usePick();
  const lk = useLookups();
  const srcLabel = useSourceLabel();
  const [kind, setKind] = useState<BudgetingTxn['kind'] | ''>('');
  const txns = useApi(() => budgetingApi.listTxns({ kind }), [kind]);
  const lines = useApi(() => budgetingApi.listLines());
  const articles = useApi(() => budgetingApi.listArticles());
  const lineLabel = (id: string) => {
    const l = lines.data?.find((x) => x.id === id);
    const a = articles.data?.find((x) => x.id === l?.articleId);
    return l ? `${lk.department(l.departmentId)?.code ?? l.departmentId}${l.orgUnitKey !== l.departmentId ? '/' + l.orgUnitKey : ''} · ${a ? loc(a.name) : ''}` : id;
  };
  const kindLabel = (k: BudgetingTxn['kind']) => ({ reserve: p('Резерв', 'Zaxira', 'Reserve'), consume: p('Списание', 'Hisobdan chiqarish', 'Consumption'), release: p('Высвобождение', "Bo'shatish", 'Release'), blocked: p('Заблокировано', 'Bloklangan', 'Blocked') })[k];
  return (
    <>
      <FilterBar>
        <Select<BudgetingTxn['kind'] | ''> value={kind} onChange={setKind} ariaLabel={p('Тип операции', 'Operatsiya turi', 'Operation type')} options={[{ value: '', label: p('Все операции', 'Barcha operatsiyalar', 'All operations') }, ...(['reserve', 'consume', 'release', 'blocked'] as const).map((k) => ({ value: k, label: kindLabel(k) }))]} />
        <span style={{ flex: 1 }} />
        <ExportButton<BudgetingTxn>
          filename="budget-ledger"
          rows={txns.data ?? []}
          columns={[
            { header: p('Дата', 'Sana', 'Date'), value: (t) => t.at.slice(0, 16).replace('T', ' ') },
            { header: p('Операция', 'Operatsiya', 'Operation'), value: (t) => kindLabel(t.kind) },
            { header: p('Источник', 'Manba', 'Source'), value: (t) => srcLabel(t.source) },
            { header: p('Документ', 'Hujjat', 'Document'), value: (t) => t.refLabel },
            { header: p('Строка бюджета', 'Byudjet satri', 'Budget line'), value: (t) => lineLabel(t.lineId) },
            { header: p('Режим', 'Rejim', 'Mode'), value: (t) => t.mode },
            { header: p('Сумма', 'Summa', 'Amount'), value: (t) => t.amount, format: 'money', total: true },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={txns.data}
        loading={txns.loading}
        rowKey={(t) => t.id}
        emptyText={p('Операций нет', 'Operatsiyalar yo‘q', 'No operations')}
        columns={[
          { header: p('Дата', 'Sana', 'Date'), render: (t) => <span className="num muted small">{formatDateTime(t.at)}</span> },
          { header: p('Операция', 'Operatsiya', 'Operation'), render: (t) => <Badge tone={KIND_TONE[t.kind]}>{kindLabel(t.kind)}</Badge> },
          { header: p('Документ', 'Hujjat', 'Document'), render: (t) => <>{t.refLabel}<div className="sub">{srcLabel(t.source)}{t.note ? ` · ${t.note}` : ''}</div></> },
          { header: p('Строка бюджета', 'Byudjet satri', 'Budget line'), render: (t) => lineLabel(t.lineId) },
          { header: p('Режим', 'Rejim', 'Mode'), render: (t) => <ModeBadge mode={t.mode} /> },
          { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (t) => formatMoneyShort(t.amount, lang) },
          { header: p('Пользователь', 'Foydalanuvchi', 'User'), render: (t) => lk.user(t.userId)?.fullName ?? t.userId },
        ]}
      />
    </>
  );
}

const OVR_TONE: Record<BudgetingOverrun['status'], Tone> = { pending: 'warn', approved: 'ok', rejected: 'danger', returned: 'info', used: 'muted' };

export function useDocStatusLabel() {
  const p = usePick();
  return (s: string) =>
    ({
      draft: p('Черновик', 'Qoralama', 'Draft'),
      pending: p('На согласовании', 'Kelishuvda', 'In approval'),
      approved: p('Утверждено', 'Tasdiqlangan', 'Approved'),
      rejected: p('Отклонено', 'Rad etilgan', 'Rejected'),
      returned: p('На доработке', 'Qayta ishlashda', 'Returned'),
      used: p('Использовано', 'Foydalanilgan', 'Used'),
    })[s] ?? s;
}

function Overruns({ openId }: { openId?: string }) {
  const { lang, loc } = useSession();
  const p = usePick();
  const lk = useLookups();
  const st = useDocStatusLabel();
  const list = useApi(() => budgetingApi.listOverruns());
  const lines = useApi(() => budgetingApi.listLines());
  const articles = useApi(() => budgetingApi.listArticles());
  const [open, setOpen] = useState<string | null>(openId ?? null);
  useEffect(() => {
    if (openId) setOpen(openId);
  }, [openId]);
  const lineLabel = (id: string) => {
    const l = lines.data?.find((x) => x.id === id);
    const a = articles.data?.find((x) => x.id === l?.articleId);
    return l ? `${lk.department(l.departmentId)?.code ?? ''} · ${a ? loc(a.name) : ''}` : id;
  };
  const cur = list.data?.find((o) => o.id === open);
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>{p('Soft-check: превышение проводится только после электронного подтверждения ответственного руководителя и финансового контроля.', 'Soft-check: oshish faqat mas’ul rahbar va moliyaviy nazorat elektron tasdig‘idan so‘ng o‘tkaziladi.', 'Soft-check: an overrun is posted only after electronic confirmation by the responsible manager and financial control.')}</span>
        <ExportButton<BudgetingOverrun>
          filename="budget-overruns"
          rows={list.data ?? []}
          columns={[
            { header: '№', value: (o) => o.number },
            { header: p('Документ', 'Hujjat', 'Document'), value: (o) => o.refLabel },
            { header: p('Строка бюджета', 'Byudjet satri', 'Budget line'), value: (o) => lineLabel(o.lineId) },
            { header: p('Сумма', 'Summa', 'Amount'), value: (o) => o.amount, format: 'money' },
            { header: p('Превышение', 'Oshish', 'Excess'), value: (o) => o.excess, format: 'money' },
            { header: p('Статус', 'Holat', 'Status'), value: (o) => st(o.status) },
          ]}
        />
      </FilterBar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(o) => o.id}
        onRowClick={(o) => setOpen(o.id)}
        emptyText={p('Запросов нет', "So'rovlar yo'q", 'No requests')}
        columns={[
          { header: '№', render: (o) => <span className="doc-num">{o.number}</span> },
          { header: p('Документ', 'Hujjat', 'Document'), render: (o) => o.refLabel },
          { header: p('Строка бюджета', 'Byudjet satri', 'Budget line'), render: (o) => lineLabel(o.lineId) },
          { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (o) => formatMoneyShort(o.amount, lang) },
          { header: p('Превышение', 'Oshish', 'Excess'), align: 'right', render: (o) => <span style={{ color: 'var(--danger)' }}>{formatMoneyShort(o.excess, lang)}</span> },
          { header: p('Инициатор', 'Tashabbuskor', 'Initiator'), render: (o) => lk.user(o.requesterId)?.fullName },
          { header: p('Статус', 'Holat', 'Status'), render: (o) => <Badge tone={OVR_TONE[o.status]}>{st(o.status)}</Badge> },
        ]}
      />
      {cur && <OverrunModal o={cur} line={lineLabel(cur.lineId)} onClose={() => { setOpen(null); if (openId) navigate('/budgeting?tab=control'); }} />}
    </>
  );
}

function OverrunModal({ o, line, onClose }: { o: BudgetingOverrun; line: string; onClose: () => void }) {
  const { lang } = useSession();
  const p = usePick();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useErrText();
  const st = useDocStatusLabel();
  const srcLabel = useSourceLabel();
  return (
    <Modal
      title={`${o.number} · ${p('Превышение лимита', 'Limitdan oshish', 'Limit overrun')}`}
      onClose={onClose}
      footer={
        <>
          <PrintButton
            doc={{
              entity: 'budget_overrun', entityId: o.id, number: o.number, date: o.createdAt.slice(0, 10), title: p('Подтверждение превышения лимита бюджета', 'Byudjet limitidan oshishni tasdiqlash', 'Budget limit overrun confirmation'),
              fields: [
                { label: p('Строка бюджета', 'Byudjet satri', 'Budget line'), value: line },
                { label: p('Документ', 'Hujjat', 'Document'), value: `${srcLabel(o.source)} · ${o.refLabel}` },
                { label: p('Сумма', 'Summa', 'Amount'), value: formatMoney(o.amount) },
                { label: p('Превышение', 'Oshish', 'Excess'), value: formatMoney(o.excess) },
                { label: p('Статус', 'Holat', 'Status'), value: st(o.status) },
              ],
              paragraphs: [o.reason, `Impact of non-funding: ${o.impact}`],
              signers: [{ role: p('Инициатор', 'Tashabbuskor', 'Initiator'), name: lk.user(o.requesterId)?.fullName ?? '' }],
            }}
          />
          {o.status === 'returned' && o.requesterId === user.id && (
            <Button type="primary" onClick={async () => { try { await budgetingApi.resubmitOverrun(o.id, user); toast(p('Отправлено повторно', 'Qayta yuborildi', 'Resubmitted')); } catch (e) { toast(err(e)); } }}>{p('Отправить повторно', 'Qayta yuborish', 'Resubmit')}</Button>
          )}
          <Button onClick={onClose}>{p('Закрыть', 'Yopish', 'Close')}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone={OVR_TONE[o.status]}>{st(o.status)}</Badge>
        <span className="muted small">{srcLabel(o.source)}</span>
      </div>
      <dl className="kv" style={{ gridTemplateColumns: '170px 1fr' }}>
        <dt>{p('Строка бюджета', 'Byudjet satri', 'Budget line')}</dt>
        <dd>{line}</dd>
        <dt>{p('Документ', 'Hujjat', 'Document')}</dt>
        <dd>{o.refLabel}</dd>
        <dt>{p('Сумма / превышение', 'Summa / oshish', 'Amount / excess')}</dt>
        <dd className="num">{formatMoneyShort(o.amount, lang)} / {formatMoneyShort(o.excess, lang)}</dd>
        <dt>{p('Обоснование', 'Asoslash', 'Reason')}</dt>
        <dd style={{ fontWeight: 400 }}>{o.reason}</dd>
        <dt>Impact of non-funding</dt>
        <dd style={{ fontWeight: 400 }}>{o.impact}</dd>
      </dl>
      <RouteSteps entityId={o.id} />
      <Timeline events={o.history} />
    </Modal>
  );
}

function Signals() {
  const { lang, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const lk = useLookups();
  const sig = useApi(() => budgetingApi.listSignals());
  const lines = useApi(() => budgetingApi.listLines());
  const articles = useApi(() => budgetingApi.listArticles());
  const settings = useApi(() => budgetingApi.getSettings());
  const lineOf = (id: string) => lines.data?.find((x) => x.id === id);
  const label = (id: string) => {
    const l = lineOf(id);
    const a = articles.data?.find((x) => x.id === l?.articleId);
    return l ? `${lk.department(l.departmentId)?.code ?? ''}${l.orgUnitKey !== l.departmentId ? '/' + l.orgUnitKey : ''} · ${a ? loc(a.name) : ''}` : id;
  };
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>
          {p('Пороги освоения лимита', 'Limitdan foydalanish chegaralari', 'Limit usage thresholds')}: {settings.data?.thresholds.join(' / ')}% · {p('уведомления руководителю подразделения и финансовому департаменту', 'bo‘linma rahbari va moliya departamentiga bildirishnomalar', 'notifications to the unit head and finance')}
        </span>
        {can('budgeting', 'edit') && (
          <Button size="small" icon="bell" onClick={async () => { const n = await budgetingApi.scanSignals(user); toast(`${p('Новых сигналов', 'Yangi signallar', 'New signals')}: ${n}`); }}>
            {p('Проверить пороги', 'Chegaralarni tekshirish', 'Scan thresholds')}
          </Button>
        )}
      </FilterBar>
      <DataTable
        rows={sig.data}
        loading={sig.loading}
        rowKey={(s) => s.id}
        emptyText={p('Сигналов нет', "Signallar yo'q", 'No signals')}
        columns={[
          { header: p('Дата', 'Sana', 'Date'), render: (s) => <span className="num muted small">{formatDateTime(s.at)}</span> },
          { header: p('Порог', 'Chegara', 'Threshold'), render: (s) => <Badge tone={s.threshold >= 90 ? 'danger' : s.threshold >= 80 ? 'warn' : 'info'}>{s.threshold}%</Badge> },
          { header: p('Строка бюджета', 'Byudjet satri', 'Budget line'), render: (s) => label(s.lineId) },
          { header: p('Освоение', 'O‘zlashtirish', 'Usage'), align: 'right', render: (s) => `${s.usagePct}%` },
          { header: p('Получатели', 'Qabul qiluvchilar', 'Recipients'), render: (s) => <span className="small">{s.recipients.map((r) => lk.user(r)?.fullName ?? r).join(', ')}</span> },
          { header: p('Факт / план', 'Fakt / reja', 'Actual / plan'), align: 'right', render: (s) => { const l = lineOf(s.lineId); return l ? `${formatMoneyShort(l.actualYtd + l.consumedOpen + l.reservedOpen, lang)} / ${formatMoneyShort(l.planYear, lang)}` : '—'; } },
        ]}
      />
    </>
  );
}

function CashPlan() {
  const { lang, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const toast = useToast();
  const err = useErrText();
  const rows = useApi(() => budgetingApi.cashPlan());
  const closed = budgetingApi.closedMonths;
  const [edit, setEdit] = useState<{ dept: string; month: number; value: string } | null>(null);
  const months = Array.from({ length: 12 - closed }, (_, i) => closed + i);
  const short = (v: number) => formatMoneyShort(v, lang);
  if (rows.loading && !rows.data) return <Loading />;
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>{p('Кассовый план (ОДДС): лимит выплат подразделения по месяцам; занято — платежи и резервы ERP открытого периода.', 'Kassa rejasi (PHO): bo‘linmaning oylik to‘lov limiti; band — ochiq davrdagi ERP to‘lovlari va zaxiralari.', 'Cash-flow plan: monthly payment limit per unit; used — ERP payments and reservations in the open period.')}</span>
        <ExportButton<BudgetingCashPlanView>
          filename="budget-cash-plan"
          rows={rows.data ?? []}
          columns={[
            { header: p('Подразделение', "Bo'linma", 'Department'), value: (r) => (lk.department(r.departmentId) ? loc(lk.department(r.departmentId)!.name) : r.departmentId) },
            ...months.flatMap((m) => [
              { header: `${MONTHS[lang][m]} · ${p('план', 'reja', 'plan')}`, value: (r: BudgetingCashPlanView) => r.plan[m] ?? 0, format: 'money' as const, total: true },
              { header: `${MONTHS[lang][m]} · ${p('занято', 'band', 'used')}`, value: (r: BudgetingCashPlanView) => r.used[m] ?? 0, format: 'money' as const, total: true },
            ]),
          ]}
        />
      </FilterBar>
      <DataTable
        rows={rows.data}
        rowKey={(r) => r.departmentId}
        columns={[
          { header: p('Подразделение', "Bo'linma", 'Department'), render: (r) => <b style={{ fontWeight: 600 }}>{lk.department(r.departmentId)?.code ?? r.departmentId}</b> },
          ...months.map((m) => ({
            header: MONTHS[lang][m]!,
            align: 'right' as const,
            render: (r: BudgetingCashPlanView) => (
              <span
                className={can('budgeting', 'edit') ? 'bud-editable' : undefined}
                title={can('budgeting', 'edit') ? p('Изменить план', 'Rejani o‘zgartirish', 'Edit plan') : undefined}
                onClick={can('budgeting', 'edit') ? () => setEdit({ dept: r.departmentId, month: m, value: String(Math.round((r.plan[m] ?? 0) / 1_000_000)) }) : undefined}
              >
                {short(r.plan[m] ?? 0)}
                <div className="sub" style={{ color: (r.available[m] ?? 0) < 0 ? 'var(--danger)' : undefined }}>{p('занято', 'band', 'used')} {short(r.used[m] ?? 0)}</div>
              </span>
            ),
          })),
        ]}
      />
      {edit && (
        <Modal
          title={`${lk.department(edit.dept)?.code} · ${MONTHS[lang][edit.month]}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await budgetingApi.updateCashPlan(edit.dept, edit.month, parseMln(edit.value), user); toast(p('Кассовый план обновлён', 'Kassa rejasi yangilandi', 'Cash plan updated')); setEdit(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <Field label={p('План выплат, млн сум', "To'lovlar rejasi, mln so'm", 'Payment plan, mln UZS')}>
            <Input value={edit.value} inputMode="decimal" onChange={(e) => setEdit({ ...edit, value: e.target.value })} />
          </Field>
        </Modal>
      )}
    </>
  );
}

function Settings() {
  const { loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErrText();
  const settings = useApi(() => budgetingApi.getSettings());
  const articles = useApi(() => budgetingApi.listArticles());
  const [th, setTh] = useState('');
  const editable = can('budgeting', 'edit');
  useEffect(() => {
    if (settings.data) setTh(settings.data.thresholds.join(', '));
  }, [settings.data]);
  const save = async (patch: Parameters<typeof budgetingApi.updateSettings>[0]) => {
    try {
      await budgetingApi.updateSettings(patch, user);
      toast(p('Настройки сохранены', 'Sozlamalar saqlandi', 'Settings saved'));
    } catch (e) {
      toast(err(e));
    }
  };
  if (!settings.data) return <Loading />;
  const s = settings.data;
  return (
    <div className="bud-split">
      <Card title={p('Триада проверок и сигналы', 'Tekshiruvlar triadasi va signallar', 'Check triad and signals')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="bud-switch"><Switch checked={s.checkMonthly} disabled={!editable} onChange={(v) => save({ checkMonthly: v })} ariaLabel="monthly" /> {p('Месячный лимит нарастающим итогом (ZBB)', 'Oylik o‘sib boruvchi limit (ZBB)', 'Cumulative monthly limit (ZBB)')}</label>
          <label className="bud-switch"><Switch checked={s.checkCash} disabled={!editable} onChange={(v) => save({ checkCash: v })} ariaLabel="cash" /> {p('Соответствие кассовому плану (ОДДС)', 'Kassa rejasiga (PHO) muvofiqlik', 'Cash-flow plan compliance')}</label>
          <label className="bud-switch"><Switch checked={s.checkStock} disabled={!editable} onChange={(v) => save({ checkStock: v })} ariaLabel="stock" /> {p('Складские остатки ТМЦ (предложить выдачу со склада)', 'TMB ombor qoldiqlari (ombordan berishni taklif qilish)', 'Stock on hand (suggest warehouse issue)')}</label>
          <Field label={p('Пороги сигналов, %', 'Signal chegaralari, %', 'Signal thresholds, %')} hint="70, 80, 90">
            <div style={{ display: 'flex', gap: 8 }}>
              <Input value={th} onChange={(e) => setTh(e.target.value)} disabled={!editable} ariaLabel={p('Пороги сигналов', 'Signal chegaralari', 'Signal thresholds')} />
              {editable && <Button onClick={() => save({ thresholds: th.split(/[,;\s]+/).filter(Boolean).map(Number) })}>{p('Сохранить', 'Saqlash', 'Save')}</Button>}
            </div>
          </Field>
          {!editable && <span className="muted small">{p('Изменять настройки может финансовый департамент.', 'Sozlamalarni moliya departamenti o‘zgartiradi.', 'Settings are managed by the finance department.')}</span>}
        </div>
      </Card>
      <Card title={p('Режим контроля по статьям', 'Moddalar bo‘yicha nazorat rejimi', 'Control mode by article')} flush>
        <DataTable
          rows={articles.data}
          rowKey={(a) => a.id}
          columns={[
            { header: p('Статья', 'Modda', 'Article'), render: (a) => <>{loc(a.name)}<div className="sub">{a.code}{a.mdmCode ? ` · MDM ${a.mdmCode}` : ''}</div></> },
            {
              header: p('Режим', 'Rejim', 'Mode'),
              width: 200,
              render: (a) =>
                editable ? (
                  <Select<BudgetingControlMode>
                    value={a.controlMode}
                    ariaLabel={`${p('Режим', 'Rejim', 'Mode')} ${a.code}`}
                    onChange={async (v) => { try { await budgetingApi.setArticleMode(a.id, v, user); toast(`${a.code}: ${v}`); } catch (e) { toast(err(e)); } }}
                    options={[{ value: 'hard', label: p('Hard — блокировка', 'Hard — bloklash', 'Hard — block') }, { value: 'soft', label: p('Soft — подтверждение', 'Soft — tasdiq', 'Soft — confirmation') }]}
                  />
                ) : (
                  <ModeBadge mode={a.controlMode} />
                ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

