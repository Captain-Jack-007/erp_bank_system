// Налог на прибыль (ТЗ PR-TAX-025…028, 039, 044, 049, 050, 066, 067): база из главной книги по филиалам,
// классификация доходов/расходов, льготы, распределение налога на прибыльные филиалы, авансы, сверка 19931/22502.
import { useState } from 'react';
import { formatDate, formatDateTime, formatMoney, formatMoneyShort, TAX_LEDGER_CLASS_LABEL, taxesApi, type TaxLedgerClass } from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, Stat, Tabs, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { BranchSelect, useBranches, useErrText, useP, useUrlTab } from './common';

const TABS = ['branches', 'ledger', 'benefits', 'advances', 'recon'] as const;
type Tab = (typeof TABS)[number];
const PERIODS = ['2026-Q3', '2026-10'];

export function TaxProfitPage() {
  const { t, lang } = useSession();
  const p = useP();
  const [tab, setTab] = useUrlTab<Tab>(TABS, 'branches');
  const [period, setPeriod] = useState('2026-Q3');
  const sum = useApi(() => taxesApi.profitSummary(period), [period]);
  const s = sum.data;
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('taxes_title'), to: '/taxes' }, { label: p('Налог на прибыль', "Foyda solig'i", 'Profit tax') }]}
        title={p('Налог на прибыль: база, филиалы, авансы', "Foyda solig'i: baza, filiallar, avanslar", 'Profit tax: base, branches, advances')}
        subtitle={`${t('tzLabel')} 4.2.17 · ${p('расчёт по консолидированному балансу банка (крупный налогоплательщик)', "bankning konsolidatsiyalangan balansi bo'yicha hisob (yirik soliq to'lovchi)", 'computed on the bank consolidated balance (large taxpayer)')}`}
        actions={<Select<string> value={period} onChange={setPeriod} options={PERIODS.map((x) => ({ value: x, label: x }))} ariaLabel={p('Период', 'Davr', 'Period')} />}
      />
      <div className="grid grid-4">
        <Stat label={p('Налогооблагаемая прибыль', 'Soliq solinadigan foyda', 'Taxable profit')} value={s ? formatMoneyShort(s.taxableProfit, lang) : '—'} icon="chart" tone="accent" />
        <Stat label={p('Льготы', 'Imtiyozlar', 'Benefits')} value={s ? formatMoneyShort(s.benefits, lang) : '—'} icon="percent" />
        <Stat label={p('Налоговая база', 'Soliq bazasi', 'Tax base')} value={s ? formatMoneyShort(s.base, lang) : '—'} icon="receipt" foot={s ? `${s.rate}%` : undefined} />
        <Stat label={p('Налог к начислению', 'Hisoblanadigan soliq', 'Tax accrued')} value={s ? formatMoneyShort(s.tax, lang) : '—'} icon="wallet" foot={s ? `${p('филиалов с прибылью', 'foydali filiallar', 'profitable branches')}: ${s.rows.filter((r) => r.taxableProfit > 0).length}/${s.rows.length}` : undefined} />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'branches', label: p('По филиалам', "Filiallar bo'yicha", 'By branch') },
            { value: 'ledger', label: p('Обороты главной книги', 'Bosh kitob aylanmalari', 'Ledger turnovers') },
            { value: 'benefits', label: p('Льготы', 'Imtiyozlar', 'Benefits') },
            { value: 'advances', label: p('Авансовые платежи', "Avans to'lovlari", 'Advance payments') },
            { value: 'recon', label: p('Сверка 19931 / 22502', 'Solishtirish 19931 / 22502', 'Reconciliation 19931 / 22502') },
          ]}
        />
        {tab === 'branches' && <BranchesTab period={period} />}
        {tab === 'ledger' && <LedgerTab period={period} />}
        {tab === 'benefits' && <BenefitsTab period={period} />}
        {tab === 'advances' && <AdvancesTab />}
        {tab === 'recon' && <ReconTab />}
      </Card>
    </>
  );
}

function useRun() {
  const toast = useToast();
  const errText = useErrText();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async run(fn: () => Promise<unknown>, ok: string) {
      setBusy(true);
      try {
        await fn();
        toast(ok);
        return true;
      } catch (e) {
        toast(errText(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}

function BranchesTab({ period }: { period: string }) {
  const p = useP();
  const { lang } = useSession();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const br = useBranches();
  const sum = useApi(() => taxesApi.profitSummary(period), [period]);
  const rows = sum.data?.rows;
  const { busy, run } = useRun();
  const toast = useToast();
  const errText = useErrText();
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
        {can && (
          <Button
            size="small"
            type="primary"
            disabled={busy}
            onClick={async () => {
              try {
                const r = await taxesApi.generateReturn('profit', period, user);
                toast(`${p('Расчёт сформирован', 'Hisob shakllantirildi', 'Return generated')}: ${r.number}`);
                navigate(`/taxes/${r.id}`);
              } catch (e) {
                toast(errText(e));
              }
            }}
          >
            {period.includes('Q') ? p('Сформировать квартальную декларацию', 'Choraklik deklaratsiyani shakllantirish', 'Generate quarterly declaration') : p('Сформировать ежемесячный расчёт', 'Oylik hisobni shakllantirish', 'Generate monthly calculation')}
          </Button>
        )}
        {can && <Button size="small" disabled={busy} onClick={() => run(() => taxesApi.loadLedgerFromAbs(period, user), p('Обороты загружены из ABS', 'Aylanmalar ABS dan yuklandi', 'Turnovers loaded from ABS'))}>{p('Загрузить обороты из ABS', 'ABS dan aylanmalarni yuklash', 'Load turnovers from ABS')}</Button>}
        <span className="muted small">{p('Налог, начисленный по филиалам с прибылью, покрывается за счёт их собственных средств; убыточные филиалы налог не несут.', "Foydali filiallar bo'yicha hisoblangan soliq ularning o'z mablag'lari hisobidan qoplanadi; zarar ko'rgan filiallar soliq to'lamaydi.", 'Tax accrued for profitable branches is covered from their own funds; loss-making branches bear no tax.')}</span>
        <span style={{ marginLeft: 'auto' }}>
          <ExportButton filename={`profit-tax-branches-${period}`} rows={rows ?? []} columns={[
            { header: p('Филиал', 'Filial', 'Branch'), value: (r) => `${r.branchKey} ${br.name(r.branchKey)}` },
            { header: p('Доходы', 'Daromadlar', 'Income'), value: (r) => r.income, format: 'money', total: true },
            { header: p('Необлагаемые доходы', 'Soliqsiz daromadlar', 'Non-taxable income'), value: (r) => r.nonTaxableIncome, format: 'money', total: true },
            { header: p('Расходы', 'Xarajatlar', 'Expenses'), value: (r) => r.expense, format: 'money', total: true },
            { header: p('Невычитаемые', 'Chegirilmaydigan', 'Non-deductible'), value: (r) => r.nonDeductible, format: 'money', total: true },
            { header: p('Налогооблагаемая прибыль', 'Soliq solinadigan foyda', 'Taxable profit'), value: (r) => r.taxableProfit, format: 'money', total: true },
            { header: p('Налог филиала', 'Filial solig‘i', 'Branch tax'), value: (r) => r.tax, format: 'money', total: true },
          ]} />
        </span>
      </div>
      {rows && (
        <div style={{ padding: 14 }}>
          <BarChart data={rows.map((r) => ({ label: r.branchKey, values: [Math.round(r.taxableProfit / 1e8) / 10, Math.round(r.tax / 1e8) / 10] }))} series={[{ name: p('Прибыль, млрд', 'Foyda, mlrd', 'Profit, bn') }, { name: p('Налог, млрд', 'Soliq, mlrd', 'Tax, bn') }]} format={(n) => String(n).replace('.', ',')} height={180} />
        </div>
      )}
      <DataTable
        rows={rows}
        loading={sum.loading}
        rowKey={(r) => r.branchKey}
        columns={[
          { header: p('Филиал', 'Filial', 'Branch'), render: (r) => <><b>{r.branchKey}</b> <span className="muted">{br.name(r.branchKey)}</span></> },
          { header: p('Доходы', 'Daromadlar', 'Income'), align: 'right', render: (r) => formatMoneyShort(r.income, lang) },
          { header: p('в т.ч. необлагаемые', 'shu jumladan soliqsiz', 'incl. non-taxable'), align: 'right', render: (r) => formatMoneyShort(r.nonTaxableIncome, lang) },
          { header: p('Расходы', 'Xarajatlar', 'Expenses'), align: 'right', render: (r) => formatMoneyShort(r.expense, lang) },
          { header: p('в т.ч. невычитаемые', 'shu jumladan chegirilmaydigan', 'incl. non-deductible'), align: 'right', render: (r) => formatMoneyShort(r.nonDeductible, lang) },
          { header: p('Налогооблагаемая прибыль', 'Soliq solinadigan foyda', 'Taxable profit'), align: 'right', render: (r) => <b style={{ color: r.taxableProfit < 0 ? 'var(--danger)' : undefined }}>{formatMoney(r.taxableProfit)}</b> },
          { header: p('Доля', 'Ulush', 'Share'), align: 'right', render: (r) => `${(r.share * 100).toFixed(1).replace('.', ',')}%` },
          { header: p('Налог за счёт филиала', 'Filial hisobidan soliq', 'Tax borne by branch'), align: 'right', render: (r) => (r.tax ? formatMoney(r.tax) : <Badge tone="muted">{p('убыток', 'zarar', 'loss')}</Badge>) },
        ]}
      />
    </>
  );
}

function LedgerTab({ period }: { period: string }) {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const [branch, setBranch] = useState('HO');
  const list = useApi(() => taxesApi.listLedger(period, branch || undefined), [period, branch]);
  const loads = useApi(() => taxesApi.listLedgerLoads());
  const { run } = useRun();
  const CLS = (Object.keys(TAX_LEDGER_CLASS_LABEL) as TaxLedgerClass[]).map((c) => ({ value: c, label: loc(TAX_LEDGER_CLASS_LABEL[c]) }));
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
        <BranchSelect value={branch} onChange={setBranch} />
        <span className="muted small">{p('Система выделяет необлагаемые доходы и невычитаемые расходы; классификацию счёта можно изменить — база пересчитается.', "Tizim soliq solinmaydigan daromadlar va chegirilmaydigan xarajatlarni ajratadi; tasnifni o'zgartirish mumkin — baza qayta hisoblanadi.", 'The system separates non-taxable income and non-deductible expenses; changing a classification recalculates the base.')}</span>
      </div>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(l) => l.id}
        columns={[
          { header: p('Счёт', 'Hisobvaraq', 'Account'), render: (l) => <span className="doc-num">{l.account}</span> },
          { header: p('Наименование', 'Nomi', 'Name'), render: (l) => <>{loc(l.name)}<div className="sub">{l.branchKey}</div></> },
          { header: p('Вид', 'Turi', 'Kind'), render: (l) => (l.kind === 'income' ? p('доход', 'daromad', 'income') : p('расход', 'xarajat', 'expense')) },
          { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (l) => formatMoney(l.amount) },
          {
            header: p('Налоговый класс', 'Soliq sinfi', 'Tax class'),
            render: (l) => (
              <Select<TaxLedgerClass>
                value={l.cls}
                disabled={!can}
                ariaLabel={`${p('Класс', 'Sinf', 'Class')} ${l.account}`}
                onChange={(v) => run(() => taxesApi.classifyLedger(l.id, v, user), p('Классификация изменена, база пересчитана', "Tasnif o'zgardi, baza qayta hisoblandi", 'Classification changed, base recalculated'))}
                options={CLS.filter((c) => (l.kind === 'income' ? c.value === 'taxable' || c.value === 'non_taxable' : c.value === 'deductible' || c.value === 'non_deductible'))}
              />
            ),
          },
        ]}
      />
      {!!loads.data?.length && (
        <div style={{ padding: 14 }}>
          <div className="muted small" style={{ marginBottom: 6 }}>{p('Загрузки из ABS', 'ABS dan yuklashlar', 'ABS loads')}</div>
          {loads.data.map((x) => (
            <div key={x.exchangeId} className="small">
              {formatDateTime(x.at)} · {x.period} · {x.rows} {p('строк', 'satr', 'rows')} · {p('контрольная сумма', 'nazorat summasi', 'control total')} {formatMoney(x.controlSum)} · {x.matched ? <Badge tone="ok">{p('сходится', 'mos', 'matched')}</Badge> : <Badge tone="danger">{p('расхождение', 'farq', 'mismatch')}</Badge>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BenefitsTab({ period }: { period: string }) {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const list = useApi(() => taxesApi.listBenefits());
  const { run } = useRun();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ code: '', nameRu: '', basis: '', amount: '' });
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', gap: 8 }}>
        {can && <Button size="small" icon="plus" onClick={() => setAdding(true)}>{p('Новая льгота', 'Yangi imtiyoz', 'New benefit')}</Button>}
        <span style={{ marginLeft: 'auto' }}>
          <ExportButton filename="tax-benefits-register" title={p('Регистр налоговых льгот', 'Soliq imtiyozlari reyestri', 'Tax benefit register')} rows={list.data ?? []} columns={[
            { header: p('Код', 'Kod', 'Code'), value: (b) => b.code }, { header: p('Льгота', 'Imtiyoz', 'Benefit'), value: (b) => loc(b.name) }, { header: p('Основание', 'Asos', 'Basis'), value: (b) => b.basis },
            { header: p('Период', 'Davr', 'Period'), value: (b) => b.period }, { header: p('Сумма', 'Summa', 'Amount'), value: (b) => b.amount, format: 'money', total: true }, { header: p('Применяется', "Qo'llanadi", 'Applied'), value: (b) => (b.active ? '✓' : '—') },
          ]} />
        </span>
      </div>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(b) => b.id}
        columns={[
          { header: p('Код', 'Kod', 'Code'), render: (b) => <span className="doc-num">{b.code}</span> },
          { header: p('Льгота', 'Imtiyoz', 'Benefit'), render: (b) => <>{loc(b.name)}<div className="sub">{b.basis}</div></> },
          { header: p('Период', 'Davr', 'Period'), render: (b) => b.period },
          { header: p('Уменьшение базы', 'Bazani kamaytirish', 'Base reduction'), align: 'right', render: (b) => formatMoney(b.amount) },
          { header: p('Статус', 'Holat', 'Status'), render: (b) => (b.active ? <Badge tone="ok">{p('применяется', "qo'llanadi", 'applied')}</Badge> : <Badge tone="muted">{p('отключена', "o'chirilgan", 'disabled')}</Badge>) },
          { header: '', render: (b) => (can ? <Button size="small" onClick={() => run(() => taxesApi.toggleBenefit(b.id, user), p('Статус льготы изменён', "Imtiyoz holati o'zgardi", 'Benefit status changed'))}>{b.active ? p('Отключить', "O'chirish", 'Disable') : p('Применить', "Qo'llash", 'Apply')}</Button> : null) },
        ]}
      />
      {adding && (
        <Modal title={p('Новая налоговая льгота', 'Yangi soliq imtiyozi', 'New tax benefit')} onClose={() => setAdding(false)} footer={<><Button onClick={() => setAdding(false)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => taxesApi.addBenefit({ code: f.code, name: { ru: f.nameRu, uz: f.nameRu, en: f.nameRu }, basis: f.basis, period, amount: Number(f.amount.replace(/\s/g, '')) }, user), p('Льгота добавлена', "Imtiyoz qo'shildi", 'Benefit added'))) setAdding(false); }}>{p('Добавить', "Qo'shish", 'Add')}</Button></>}>
          <div className="form-grid">
            <Field label={p('Код', 'Kod', 'Code')} required><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label={p('Сумма уменьшения базы', 'Bazani kamaytirish summasi', 'Base reduction')} required><Input value={f.amount} inputMode="numeric" onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label={p('Наименование', 'Nomi', 'Name')} required className="span-2"><Input value={f.nameRu} onChange={(e) => setF({ ...f, nameRu: e.target.value })} /></Field>
            <Field label={p('Основание (статья НК)', 'Asos (SK moddasi)', 'Basis (Tax Code article)')} required className="span-2"><Input value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function AdvancesTab() {
  const p = useP();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const list = useApi(() => taxesApi.listAdvances());
  const { busy, run } = useRun();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
        {can && <Button size="small" type="primary" disabled={busy} onClick={() => run(() => taxesApi.computeAdvances('2026-Q3', user), p('Авансы на 4 квартал рассчитаны по итогам 3 квартала', "4-chorak avanslari 3-chorak natijalari bo'yicha hisoblandi", 'Q4 advances computed from Q3 results'))}>{p('Рассчитать авансы на IV квартал', 'IV chorak avanslarini hisoblash', 'Compute Q4 advances')}</Button>}
        <span className="muted small">{p('Аванс = налог за предыдущий квартал / 3; срок — 23-е число месяца. Просрочки контролируются и отправляются в уведомления.', "Avans = oldingi chorak solig'i / 3; muddat — oyning 23-sanasi. Muddati o'tganlar nazorat qilinadi va bildirishnoma yuboriladi.", 'Advance = previous quarter tax / 3; due on the 23rd. Overdue advances are monitored and notified.')}</span>
      </div>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(a) => a.month}
        columns={[
          { header: p('Месяц', 'Oy', 'Month'), render: (a) => <b>{a.month}</b> },
          { header: p('Срок', 'Muddat', 'Due'), render: (a) => <>{formatDate(a.dueDate)} {a.paid < a.amount && a.dueDate < today && <Badge tone="danger">{p('просрочен', "muddati o'tgan", 'overdue')}</Badge>}</> },
          { header: p('Сумма аванса', 'Avans summasi', 'Advance'), align: 'right', render: (a) => formatMoney(a.amount) },
          { header: p('Уплачено', "To'langan", 'Paid'), align: 'right', render: (a) => (a.paid ? <>{formatMoney(a.paid)}<div className="sub">{a.reference} · {a.paidAt ? formatDate(a.paidAt) : ''}</div></> : '—') },
          { header: '', render: (a) => (can && a.paid < a.amount ? <Button size="small" disabled={busy} onClick={() => run(() => taxesApi.payAdvance(a.month, user), p('Аванс уплачен', "Avans to'landi", 'Advance paid'))}>{p('Уплатить', "To'lash", 'Pay')}</Button> : null) },
        ]}
      />
    </>
  );
}

function ReconTab() {
  const p = useP();
  const user = useUser();
  const can = useCan()('taxes', 'edit');
  const rec = useApi(() => taxesApi.recon19931('2026-Q3'));
  const { busy, run } = useRun();
  const r = rec.data;
  return (
    <div style={{ padding: 18, display: 'grid', gap: 14 }}>
      {r && (
        <>
          <dl className="kv" style={{ maxWidth: 560 }}>
            <dt>{p('Период', 'Davr', 'Period')}</dt>
            <dd>{r.period}</dd>
            <dt>{p('Авансы уплачены (Дт 19931)', "To'langan avanslar (Dt 19931)", 'Advances paid (Dr 19931)')}</dt>
            <dd className="num">{formatMoney(r.advances)}</dd>
            <dt>{p('Начислено (Кт 22502)', 'Hisoblangan (Kt 22502)', 'Accrued (Cr 22502)')}</dt>
            <dd className="num">{formatMoney(r.accrued)}</dd>
            <dt>{r.difference >= 0 ? p('Переплата', "Ortiqcha to'lov", 'Overpayment') : p('Недоплата', "Kam to'lov", 'Underpayment')}</dt>
            <dd className="num" style={{ fontWeight: 700, color: r.difference < 0 ? 'var(--danger)' : 'var(--ok)' }}>{formatMoney(Math.abs(r.difference))}</dd>
            <dt>{p('Статус', 'Holat', 'Status')}</dt>
            <dd>{r.status === 'closed' ? <Badge tone="ok">{p('закрыта', 'yopilgan', 'closed')} {r.closedAt ? formatDateTime(r.closedAt) : ''}</Badge> : <Badge tone="warn">{p('открыта', 'ochiq', 'open')}</Badge>}{r.exchangeId && <span className="muted small"> · ABS {r.exchangeId}</span>}</dd>
          </dl>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {can && r.status === 'open' && <Button type="primary" disabled={busy} onClick={() => run(() => taxesApi.closeRecon19931(r.period, user), p('Разница закрыта проводкой в ABS', 'Farq ABS da provodka bilan yopildi', 'Difference closed by ABS posting'))}>{p('Закрыть разницу проводкой', 'Farqni provodka bilan yopish', 'Close the difference by posting')}</Button>}
            <PrintButton template="act" label={p('Печать справки', "Ma'lumotnomani chop etish", 'Print statement')} doc={() => ({
              entity: 'tax_recon_19931', entityId: r.period, title: p('Справка о сверке счетов 19931 и 22502', '19931 va 22502 hisobvaraqlarini solishtirish to‘g‘risida ma’lumotnoma', 'Reconciliation statement, accounts 19931 and 22502'), number: `R19931-${r.period}`, date: new Date().toISOString().slice(0, 10),
              fields: [{ label: p('Период', 'Davr', 'Period'), value: r.period }, { label: '19931', value: formatMoney(r.advances) }, { label: '22502', value: formatMoney(r.accrued) }, { label: p('Разница', 'Farq', 'Difference'), value: formatMoney(r.difference) }],
              signers: [{ role: p('Главный бухгалтер', 'Bosh buxgalter', 'Chief Accountant'), name: '' }],
            })} />
          </div>
          <div className="muted small">{p('При переплате сумма переносится в зачёт будущих платежей (Дт 19997 Кт 19931), при недоплате доначисляется (Дт 22502 Кт 19931). Проводка передаётся в ABS через интеграционную шину.', "Ortiqcha to'lovda summa kelgusi to'lovlar hisobiga o'tkaziladi (Dt 19997 Kt 19931), kam to'lovda qo'shimcha hisoblanadi (Dt 22502 Kt 19931). Provodka integratsiya shinasi orqali ABS ga uzatiladi.", 'An overpayment is carried forward against future payments (Dr 19997 Cr 19931); an underpayment is charged (Dr 22502 Cr 19931). The posting is sent to ABS via the integration bus.')}</div>
        </>
      )}
    </div>
  );
}
