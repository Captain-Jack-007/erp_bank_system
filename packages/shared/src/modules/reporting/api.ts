// API модуля «Отчётность»: отчёты считаются из данных ядра и модулей (закупки, договоры, согласования, бюджет,
// МСФО, налоги, касса, ОС, склад, автопарк, командировки), конструктор произвольных отчётов с сохранением в каталог,
// детализация до документов-источников, рассылки по расписанию (журнал доставки, письма — в почтовый outbox),
// KPI-дашборды руководства и по направлениям (ТЗ 4.2.8).
import { api } from '../../api';
import { clone, delay, emit, nextId, now, today } from '../../bus';
import { audit } from '../../audit';
import { approvalEngine } from '../../engine';
import { procurementTotal } from '../../format';
import { localize, tk, translate } from '../../i18n';
import { notify } from '../../notifications';
import { matches, registerSearchProvider } from '../../search';
import { can } from '../../security';
import { utf8Encode, xmlEscape } from '../../services/bytes';
import { buildXlsx, type XlsxSheet } from '../../services/xlsx';
import { writeZip } from '../../services/zip';
import type { Contract, ID, Lang, Localized, Role, User } from '../../types';
import { assetsApi } from '../assets';
import { budgetingApi } from '../budgeting';
import { cashApi, CASH_RATES, ndoApi } from '../cash';
import { computeIfrsConsolidation, ifrsAnalyticsApi } from '../ifrs';
import { taxesApi } from '../taxes';
import { warehouseApi } from '../warehouse';
import { reportCatalogSeed, reportSubscriptionsSeed } from './data';
import { runExtraBuiltin } from './extra';
import type {
  ReportBuilderQuery,
  ReportBuiltinKey,
  ReportCell,
  ReportColumn,
  ReportDataset,
  ReportDatasetInfo,
  ReportDefinition,
  ReportDelivery,
  ReportKpi,
  ReportMeasure,
  ReportNewSubscriptionInput,
  ReportResult,
  ReportSubscription,
} from './types';
import { apiError } from '../../errors';

const db = {
  catalog: clone(reportCatalogSeed),
  subscriptions: clone(reportSubscriptionsSeed),
  deliveries: [] as ReportDelivery[],
  targets: {} as Record<string, number>,
};

/** Курсы для приведения валютных договоров к UZS в отчётах. */
const RATES = { UZS: 1, USD: 12_650, EUR: 13_700 } as const;
const toUzs = (c: Contract, amount: number) => amount * RATES[c.currency];

const L = (ru: string, uz: string, en?: string): Localized => ({ ru, uz, ...(en ? { en } : {}) });
const col = (key: string, ru: string, uz: string, type: ReportColumn['type'], en?: string): ReportColumn => ({ key, label: L(ru, uz, en), type });

export const REPORT_DATASETS: ReportDatasetInfo[] = [
  { dataset: 'procurement', groupBy: ['department', 'status', 'method', 'month'], measures: ['count', 'amount'] },
  { dataset: 'contracts', groupBy: ['counterparty', 'status', 'department', 'currency'], measures: ['count', 'amount', 'paid'] },
  { dataset: 'approvals', groupBy: ['entity', 'role', 'status'], measures: ['count', 'amount'] },
  { dataset: 'budget', groupBy: ['line'], measures: ['planned', 'spent'] },
  { dataset: 'assets', groupBy: ['category', 'status', 'department'], measures: ['count', 'amount', 'nbv'] },
  { dataset: 'taxes', groupBy: ['type', 'status', 'period'], measures: ['count', 'amount', 'paid', 'outstanding'] },
  { dataset: 'warehouse', groupBy: ['category', 'type', 'month'], measures: ['count', 'amount'] },
  { dataset: 'cash', groupBy: ['branch', 'currency'], measures: ['balance'] },
];

const MEASURE_TYPE: Record<ReportMeasure, ReportColumn['type']> = { count: 'number', amount: 'money', paid: 'money', planned: 'money', spent: 'money', nbv: 'money', outstanding: 'money', balance: 'money' };

function sumTotals(rows: Record<string, ReportCell>[], columns: ReportColumn[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const c of columns) if (c.type === 'money' || c.type === 'number') totals[c.key] = rows.reduce((s, r) => s + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0), 0);
  return totals;
}

async function runBuiltin(key: ReportBuiltinKey, lang: Lang): Promise<ReportResult> {
  const departments = await api.listDepartments();
  const deptName = (id: ID) => localize(departments.find((d) => d.id === id)?.name, lang) ?? id;

  if (key === 'procurement_by_department') {
    const list = await api.listProcurement();
    const ids = [...new Set(list.map((p) => p.departmentId))];
    const columns = [
      col('department', 'Подразделение', "Bo'linma", 'text', 'Department'),
      col('count', 'Заявок', 'Arizalar', 'number', 'Requests'),
      col('pending', 'На согласовании', 'Kelishuvda', 'number', 'In approval'),
      col('approved', 'Согласовано / в работе', 'Kelishilgan / ishda', 'number', 'Approved / in progress'),
      col('rejected', 'Отклонено', 'Rad etilgan', 'number', 'Rejected'),
      col('amount', 'Сумма', 'Summa', 'money', 'Amount'),
    ];
    const rows = ids.map((id) => {
      const ps = list.filter((p) => p.departmentId === id);
      return {
        id,
        department: deptName(id),
        count: ps.length,
        pending: ps.filter((p) => p.status === 'pending').length,
        approved: ps.filter((p) => ['approved', 'in_tender', 'contracted'].includes(p.status)).length,
        rejected: ps.filter((p) => p.status === 'rejected').length,
        amount: ps.reduce((s, p) => s + procurementTotal(p.items), 0),
      };
    });
    rows.sort((a, b) => b.amount - a.amount);
    const rowDocs = rows.map((r) => list.filter((p) => p.departmentId === r.id).map((p) => ({ label: `${p.number} · ${p.title}`, to: `/procurement/${p.id}` })));
    return { title: L('Заявки на закупку по подразделениям', "Bo'linmalar bo'yicha xarid arizalari", 'Purchase requests by department'), columns, rows: rows.map(({ id: _id, ...r }) => r), totals: sumTotals(rows, columns), chart: { labelKey: 'department', seriesKeys: ['amount'] }, generatedAt: now(), rowDocs };
  }

  if (key === 'contracts_payments') {
    const [list, cps] = await Promise.all([api.listContracts(), api.listCounterparties()]);
    const columns = [
      col('number', 'Договор', 'Shartnoma', 'text', 'Contract'),
      col('counterparty', 'Контрагент', 'Kontragent', 'text', 'Counterparty'),
      col('amount', 'Сумма (в UZS)', 'Summa (UZSda)', 'money', 'Amount (UZS)'),
      col('paid', 'Оплачено', "To'langan", 'money', 'Paid'),
      col('unpaid', 'Остаток', 'Qoldiq', 'money', 'Remaining'),
      col('overdue', 'Просрочено', "Muddati o'tgan", 'money', 'Overdue'),
      col('paidPct', 'Оплачено, %', "To'langan, %", 'percent', 'Paid, %'),
    ];
    const rows = list.map((c) => {
      const paid = toUzs(c, c.payments.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0));
      const overdue = toUzs(c, c.payments.filter((p) => !p.paid && p.dueDate < today()).reduce((s, p) => s + p.amount, 0));
      const amount = toUzs(c, c.amount);
      return { number: c.number, counterparty: cps.find((x) => x.id === c.counterpartyId)?.name ?? '', amount, paid, unpaid: amount - paid, overdue, paidPct: amount ? Math.round((paid / amount) * 100) : 0 };
    });
    return { title: L('Исполнение договоров и платежей', "Shartnomalar va to'lovlar ijrosi", 'Contract and payment execution'), columns, rows, totals: sumTotals(rows.map(({ paidPct: _p, ...r }) => r), columns), chart: { labelKey: 'number', seriesKeys: ['paid', 'unpaid'] }, generatedAt: now(), rowDocs: list.map((c) => [{ label: c.number, to: `/contracts/${c.id}` }]) };
  }

  if (key === 'approvals_sla') {
    const tasks = approvalEngine.all();
    const entities = [...new Set(tasks.map((t) => t.entity))];
    const nowMs = Date.now();
    const columns = [
      col('entity', 'Тип документа', 'Hujjat turi', 'text', 'Document type'),
      col('pending', 'На согласовании', 'Kelishuvda', 'number', 'Pending'),
      col('overdue', 'Просрочено', "Muddati o'tgan", 'number', 'Overdue'),
      col('decided', 'Решено', 'Hal qilingan', 'number', 'Decided'),
      col('avgAge', 'Средний возраст, ч', "O'rtacha yoshi, soat", 'hours', 'Average age, h'),
      col('maxAge', 'Максимум, ч', 'Maksimum, soat', 'hours', 'Maximum, h'),
    ];
    const rows = entities.map((e) => {
      const ts = tasks.filter((t) => t.entity === e);
      const pending = ts.filter((t) => t.status === 'pending');
      const ages = pending.map((t) => (nowMs - new Date(t.createdAt).getTime()) / 3_600_000);
      return {
        e,
        entity: translate(lang, tk('entity_', e)),
        pending: pending.length,
        overdue: pending.filter((t) => new Date(t.dueAt).getTime() < nowMs).length,
        decided: ts.length - pending.length,
        avgAge: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0,
        maxAge: ages.length ? Math.round(Math.max(...ages)) : 0,
      };
    });
    rows.sort((a, b) => b.overdue - a.overdue || b.pending - a.pending);
    const totals = sumTotals(rows, columns.filter((c) => c.type === 'number'));
    const rowDocs = rows.map((r) => tasks.filter((t) => t.entity === r.e && t.status === 'pending').map((t) => ({ label: `${t.number} · ${t.title}`, to: '/approvals' })));
    return { title: L('Сроки согласования документов (SLA)', 'Hujjatlarni kelishish muddatlari (SLA)', 'Document approval times (SLA)'), columns, rows: rows.map(({ e: _e, ...r }) => r), totals, chart: { labelKey: 'entity', seriesKeys: ['pending', 'overdue'] }, generatedAt: now(), rowDocs };
  }

  // budget_execution
  const lines = await api.listBudgetLines();
  const columns = [
    col('code', 'Статья', 'Modda', 'text', 'Line'),
    col('name', 'Наименование', 'Nomi', 'text', 'Name'),
    col('planned', 'План', 'Reja', 'money', 'Plan'),
    col('spent', 'Факт', 'Fakt', 'money', 'Actual'),
    col('left', 'Остаток', 'Qoldiq', 'money', 'Remaining'),
    col('pct', 'Исполнение, %', 'Ijro, %', 'percent', 'Execution, %'),
  ];
  const rows = lines.map((b) => ({ code: b.code, name: localize(b.name, lang), planned: b.planned, spent: b.spent, left: b.planned - b.spent, pct: b.planned ? Math.round((b.spent / b.planned) * 100) : 0 }));
  const totals = sumTotals(rows, columns);
  return { title: L('Исполнение бюджета по статьям', "Moddalar bo'yicha byudjet ijrosi", 'Budget execution by line'), columns, rows, totals, chart: { labelKey: 'code', seriesKeys: ['planned', 'spent'] }, generatedAt: now(), rowDocs: lines.map((b) => [{ label: b.code, to: '/budgeting' }]) };
}

const GROUP_LABEL: Record<string, [string, string, string]> = {
  department: ['Подразделение', "Bo'linma", 'Department'],
  status: ['Статус', 'Holati', 'Status'],
  method: ['Способ закупки', 'Xarid usuli', 'Method'],
  month: ['Месяц', 'Oy', 'Month'],
  counterparty: ['Контрагент', 'Kontragent', 'Counterparty'],
  currency: ['Валюта', 'Valyuta', 'Currency'],
  entity: ['Тип документа', 'Hujjat turi', 'Document type'],
  role: ['Роль', 'Rol', 'Role'],
  line: ['Статья бюджета', 'Byudjet moddasi', 'Budget line'],
  category: ['Категория', 'Toifa', 'Category'],
  type: ['Вид', 'Tur', 'Type'],
  period: ['Период', 'Davr', 'Period'],
  branch: ['Подразделение кассы', "Kassa bo'linmasi", 'Cash unit'],
};
const MEASURE_LABEL: Record<ReportMeasure, [string, string, string]> = {
  count: ['Количество', 'Soni', 'Count'],
  amount: ['Сумма', 'Summa', 'Amount'],
  paid: ['Оплачено', "To'langan", 'Paid'],
  planned: ['План', 'Reja', 'Plan'],
  spent: ['Факт', 'Fakt', 'Actual'],
  nbv: ['Остаточная стоимость', 'Qoldiq qiymat', 'Net book value'],
  outstanding: ['Задолженность', 'Qarz', 'Outstanding'],
  balance: ['Остаток (UZS)', 'Qoldiq (UZS)', 'Balance (UZS)'],
};

interface BuilderRec {
  keys: Record<string, string>;
  m: Partial<Record<ReportMeasure, number>>;
  date?: string;
  doc?: { label: string; to?: string };
}

/** Записи набора данных конструктора: ключи группировок, показатели, дата и документ-источник. */
async function datasetRecords(ds: ReportDataset, lang: Lang): Promise<BuilderRec[]> {
  const departments = await api.listDepartments();
  const dept = (id: ID | undefined) => (id ? localize(departments.find((d) => d.id === id)?.name, lang) ?? id : '—');
  if (ds === 'procurement') {
    return (await api.listProcurement()).map((p) => ({
      keys: { department: dept(p.departmentId), status: translate(lang, tk('pstatus_', p.status)), method: translate(lang, tk('method_', p.method)), month: p.createdAt.slice(0, 7) },
      m: { count: 1, amount: procurementTotal(p.items) }, date: p.createdAt, doc: { label: `${p.number} · ${p.title}`, to: `/procurement/${p.id}` },
    }));
  }
  if (ds === 'contracts') {
    const cps = await api.listCounterparties();
    return (await api.listContracts()).map((c) => ({
      keys: { counterparty: cps.find((x) => x.id === c.counterpartyId)?.name ?? '', status: translate(lang, tk('cstatus_', c.status)), department: dept(c.departmentId), currency: c.currency },
      m: { count: 1, amount: toUzs(c, c.amount), paid: toUzs(c, c.payments.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0)) }, date: c.startDate, doc: { label: c.number, to: `/contracts/${c.id}` },
    }));
  }
  if (ds === 'approvals') {
    return approvalEngine.all().map((t) => ({
      keys: { entity: translate(lang, tk('entity_', t.entity)), role: translate(lang, tk('role_', t.assigneeRole)), status: translate(lang, tk('reporting_astatus_', t.status)) },
      m: { count: 1, amount: t.amount !== undefined ? t.amount * (t.currency ? RATES[t.currency] : 1) : 0 }, date: t.createdAt, doc: { label: `${t.number} · ${t.title}`, to: '/approvals' },
    }));
  }
  if (ds === 'budget') {
    return (await api.listBudgetLines()).map((b) => ({ keys: { line: `${b.code} · ${localize(b.name, lang)}` }, m: { planned: b.planned, spent: b.spent }, doc: { label: b.code, to: '/budgeting' } }));
  }
  if (ds === 'assets') {
    return (await assetsApi.list()).map((a) => ({
      keys: { category: translate(lang, tk('assets_cat_', a.category)), status: translate(lang, tk('assets_status_', a.status)), department: dept(a.departmentId) },
      m: { count: 1, amount: a.cost, nbv: a.cost - a.accumulated }, date: a.acquiredAt, doc: { label: `${a.inventoryNo} · ${a.name}`, to: `/assets/${a.id}` },
    }));
  }
  if (ds === 'taxes') {
    return (await taxesApi.listReturns()).map((r) => ({
      keys: { type: translate(lang, tk('taxes_type_', r.type)), status: translate(lang, tk('taxes_status_', r.status)), period: r.period },
      m: { count: 1, amount: r.amount, paid: r.paid, outstanding: r.outstanding }, date: r.dueDate, doc: { label: r.number, to: `/taxes/${r.id}` },
    }));
  }
  if (ds === 'warehouse') {
    const items = await warehouseApi.listItems();
    const cat = new Map(items.map((i) => [i.id, i.category as string]));
    return (await warehouseApi.listMovements()).map((mv) => ({
      keys: { category: translate(lang, tk('warehouse_cat_', cat.get(mv.itemId) ?? '')), type: translate(lang, tk('warehouse_mv_', mv.type)), month: mv.at.slice(0, 7) },
      m: { count: 1, amount: mv.amount }, date: mv.at, doc: { label: mv.number, to: '/warehouse' },
    }));
  }
  // cash
  const branches = await cashApi.listBranches();
  return branches.flatMap((b) => (['UZS', 'USD', 'EUR', 'RUB'] as const).map((c) => ({ keys: { branch: `${b.code} · ${localize(b.name, lang)}`, currency: c }, m: { balance: Math.round(b.balances[c] * CASH_RATES[c]) }, doc: { label: b.code, to: `/cash/${b.id}` } })));
}

const gl = (k: string, lang: Lang) => {
  const x = GROUP_LABEL[k] ?? [k, k, k];
  return localize(L(x[0], x[1], x[2]), lang);
};

/** Конструктор: набор данных → группировка (+ второе измерение) → показатели → фильтр → период. */
async function runBuilder(q: ReportBuilderQuery, lang: Lang): Promise<ReportResult> {
  const since = q.periodDays ? new Date(Date.now() - q.periodDays * 86_400_000).toISOString() : '';
  let recs = (await datasetRecords(q.dataset, lang)).filter((r) => !since || !r.date || r.date >= since.slice(0, r.date.length > 10 ? 24 : 10));
  if (q.filter?.value?.trim()) {
    const v = q.filter.value.trim().toLowerCase();
    recs = recs.filter((r) => (r.keys[q.filter!.field] ?? '').toLowerCase().includes(v));
  }
  const [gRu, gUz, gEn] = GROUP_LABEL[q.groupBy] ?? [q.groupBy, q.groupBy, q.groupBy];
  const [mRu, mUz, mEn] = MEASURE_LABEL[q.measure];
  const mval = (r: BuilderRec, m: ReportMeasure) => r.m[m] ?? 0;
  const groups = [...new Set(recs.map((r) => r.keys[q.groupBy] ?? '—'))];
  const pivot = q.groupBy2 && q.groupBy2 !== 'none' && q.groupBy2 !== q.groupBy ? q.groupBy2 : undefined;
  let columns: ReportColumn[];
  let rows: Record<string, ReportCell>[];
  let rowDocs: { label: string; to?: string }[][];
  if (pivot) {
    const g2all = [...new Set(recs.map((r) => r.keys[pivot] ?? '—'))];
    const g2 = g2all.map((g) => ({ g, v: recs.filter((r) => r.keys[pivot] === g).reduce((s, r) => s + mval(r, q.measure), 0) })).sort((a, b) => b.v - a.v).slice(0, 8).map((x) => x.g);
    columns = [col('group', gRu, gUz, 'text', gEn), ...g2.map((g, i) => ({ key: `c${i}`, label: L(g, g, g), type: MEASURE_TYPE[q.measure] })), col('value', `${mRu} (итого)`, `${mUz} (jami)`, MEASURE_TYPE[q.measure], `${mEn} (total)`)];
    rows = groups.map((g) => {
      const rs = recs.filter((r) => (r.keys[q.groupBy] ?? '—') === g);
      const row: Record<string, ReportCell> = { group: g };
      g2.forEach((x, i) => (row[`c${i}`] = rs.filter((r) => r.keys[pivot] === x).reduce((s, r) => s + mval(r, q.measure), 0)));
      row.value = rs.reduce((s, r) => s + mval(r, q.measure), 0);
      return row;
    });
  } else {
    const extra = (q.measures2 ?? []).filter((m) => m !== q.measure);
    columns = [col('group', gRu, gUz, 'text', gEn), col('value', mRu, mUz, MEASURE_TYPE[q.measure], mEn), ...extra.map((m) => col(`m_${m}`, MEASURE_LABEL[m][0], MEASURE_LABEL[m][1], MEASURE_TYPE[m], MEASURE_LABEL[m][2]))];
    rows = groups.map((g) => {
      const rs = recs.filter((r) => (r.keys[q.groupBy] ?? '—') === g);
      const row: Record<string, ReportCell> = { group: g, value: rs.reduce((s, r) => s + mval(r, q.measure), 0) };
      for (const m of extra) row[`m_${m}`] = rs.reduce((s, r) => s + mval(r, m), 0);
      return row;
    });
  }
  rows.sort((a, b) => (q.groupBy === 'month' || q.groupBy === 'period' ? String(a.group).localeCompare(String(b.group)) : (b.value as number) - (a.value as number)));
  rowDocs = rows.map((r) => recs.filter((x) => (x.keys[q.groupBy] ?? '—') === r.group && x.doc).map((x) => x.doc!));
  return {
    title: L(`${mRu} · ${gRu}${pivot ? ` × ${GROUP_LABEL[pivot]?.[0] ?? pivot}` : ''}`, `${mUz} · ${gUz}${pivot ? ` × ${GROUP_LABEL[pivot]?.[1] ?? pivot}` : ''}`, `${mEn} · ${gEn}${pivot ? ` × ${GROUP_LABEL[pivot]?.[2] ?? pivot}` : ''}`),
    columns, rows, totals: sumTotals(rows, columns), chart: { labelKey: 'group', seriesKeys: ['value'] }, generatedAt: now(), rowDocs,
  };
}

/** CSV (разделитель «;», BOM для корректного открытия в Excel). */
export function reportToCsv(result: ReportResult, lang: Lang): string {
  const esc = (v: ReportCell) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = result.columns.map((c) => esc(localize(c.label, lang))).join(';');
  const body = result.rows.map((r) => result.columns.map((c) => esc(r[c.key] ?? '')).join(';'));
  // Строка итогов — те же значения, что в строке «Итого» таблицы на экране.
  const totals = result.totals
    ? [result.columns.map((c, i) => (i === 0 ? esc(translate(lang, 'reporting_total')) : result.totals![c.key] !== undefined && c.type !== 'percent' && c.type !== 'hours' ? esc(result.totals![c.key]!) : '')).join(';')]
    : [];
  return '﻿' + [head, ...body, ...totals].join('\r\n');
}

/** Лист XLSX из результата отчёта (с итогами). */
export function reportToSheet(result: ReportResult, lang: Lang): XlsxSheet {
  return {
    name: localize(result.title, lang).slice(0, 31).replace(/[\\/?*[\]:]/g, ' '),
    title: localize(result.title, lang),
    ...(result.totals ? { totalLabel: translate(lang, 'reporting_total') } : {}),
    columns: result.columns.map((c) => ({ header: localize(c.label, lang), ...(c.type === 'money' ? { format: 'money' as const } : c.type === 'number' ? { format: 'integer' as const } : c.type === 'percent' ? { format: 'number' as const } : {}), ...(result.totals && result.totals[c.key] !== undefined && c.type !== 'percent' && c.type !== 'hours' ? { total: true } : {}) })),
    rows: result.rows.map((r) => result.columns.map((c) => r[c.key] ?? '')),
  };
}

/** Документ Word (DOCX, OOXML) с заголовком и таблицей отчёта — без внешних библиотек (PR-REP-017). */
export function reportToDocx(result: ReportResult, lang: Lang): Uint8Array {
  const cell = (t: string, bold = false, right = false) => `<w:tc><w:p>${right ? '<w:pPr><w:jc w:val="right"/></w:pPr>' : ''}<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r></w:p></w:tc>`;
  const fmt = (v: ReportCell | undefined, c: ReportColumn) => (v === undefined || v === '' ? '—' : typeof v === 'number' ? (c.type === 'percent' ? `${v}%` : v.toLocaleString('ru-RU')) : String(v));
  const head = `<w:tr>${result.columns.map((c) => cell(localize(c.label, lang), true, c.type !== 'text')).join('')}</w:tr>`;
  const body = result.rows.map((r) => `<w:tr>${result.columns.map((c) => cell(fmt(r[c.key], c), false, c.type !== 'text')).join('')}</w:tr>`).join('');
  const tot = result.totals ? `<w:tr>${result.columns.map((c, i) => cell(i === 0 ? translate(lang, 'reporting_total') : result.totals![c.key] !== undefined && c.type !== 'percent' && c.type !== 'hours' ? fmt(result.totals![c.key], c) : '', true, c.type !== 'text')).join('')}</w:tr>` : '';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${xmlEscape(localize(result.title, lang))}</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">XB-ERP · ${xmlEscape(result.generatedAt.slice(0, 16).replace('T', ' '))}</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${head}${body}${tot}</w:tbl>
${(result.notes ?? []).map((n) => `<w:p><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xmlEscape(localize(n, lang))}</w:t></w:r></w:p>`).join('')}
<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`;
  return writeZip([
    { name: '[Content_Types].xml', data: utf8Encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: utf8Encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', data: utf8Encode(doc) },
  ]);
}

/** Печатная форма для рассылки «PDF» (HTML для печати в PDF). */
function reportToHtml(result: ReportResult, lang: Lang): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const head = result.columns.map((c) => `<th>${esc(localize(c.label, lang))}</th>`).join('');
  const body = result.rows.map((r) => `<tr>${result.columns.map((c) => `<td>${esc(String(r[c.key] ?? ''))}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(localize(result.title, lang))}</title></head><body><h2>${esc(localize(result.title, lang))}</h2><table border="1" cellspacing="0" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

/** Отписать можно свою рассылку; администратор управляет всеми. */
export const reportingCanManage = (user: Pick<User, 'id' | 'role'> | null | undefined, sub: Pick<ReportSubscription, 'userId'>): boolean =>
  !!user && (user.role === 'admin' || user.id === sub.userId);

/** Следующий запуск рассылки: ежедневно 08:00 (+05:00), еженедельно, ежемесячно 1-го числа. */
export function reportNextRun(freq: ReportSubscription['frequency'], from: string = now()): string {
  const d = new Date(from);
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0));
  if (freq === 'daily') base.setUTCDate(base.getUTCDate() + (base.getTime() <= d.getTime() ? 1 : 0));
  else if (freq === 'weekly') base.setUTCDate(base.getUTCDate() + 7);
  else base.setUTCMonth(base.getUTCMonth() + 1, 1);
  return base.toISOString();
}

for (const s of db.subscriptions) s.nextRunAt ??= reportNextRun(s.frequency, s.createdAt);

async function runDefinition(def: ReportDefinition, lang: Lang, opts: { periodDays?: number; user?: User } = {}): Promise<ReportResult | undefined> {
  if (def.custom) return runBuilder({ ...def.custom, ...(opts.periodDays !== undefined ? { periodDays: opts.periodDays as ReportBuilderQuery['periodDays'] } : {}) }, lang);
  if (!def.builtin) return undefined;
  if (['procurement_by_department', 'contracts_payments', 'approvals_sla', 'budget_execution'].includes(def.builtin)) return runBuiltin(def.builtin, lang);
  return runExtraBuiltin(def.builtin, lang, opts);
}

async function deliver(sub: ReportSubscription, trigger: ReportDelivery['trigger']): Promise<ReportDelivery> {
  const def = db.catalog.find((r) => r.id === sub.reportId);
  const res = def ? await runDefinition(def, 'ru') : undefined;
  const base = `${def?.code ?? sub.reportId}-${today()}`;
  let bytes = 0;
  let fileName = base;
  if (res) {
    if (sub.format === 'xlsx') {
      bytes = buildXlsx([reportToSheet(res, 'ru')]).length;
      fileName += '.xlsx';
    } else if (sub.format === 'csv') {
      bytes = utf8Encode(reportToCsv(res, 'ru')).length;
      fileName += '.csv';
    } else {
      bytes = utf8Encode(reportToHtml(res, 'ru')).length;
      fileName += '.pdf.html';
    }
  }
  const d: ReportDelivery = { id: nextId('rd'), subscriptionId: sub.id, reportId: sub.reportId, at: now(), to: sub.email, format: sub.format, fileName, bytes, rows: res?.rows.length ?? 0, status: res ? 'sent' : 'failed', trigger };
  db.deliveries.unshift(d);
  sub.lastRunAt = d.at;
  if (trigger === 'schedule' || !sub.nextRunAt) sub.nextRunAt = reportNextRun(sub.frequency);
  if (def) {
    notify({
      userIds: [sub.userId],
      title: L(`Рассылка: ${def.name.ru}`, `Yuborish: ${def.name.uz}`, `Report delivery: ${def.name.en ?? def.name.ru}`),
      body: L(`${fileName} (${Math.max(1, Math.round(bytes / 1024))} КБ) отправлен на ${sub.email}`, `${fileName} (${Math.max(1, Math.round(bytes / 1024))} KB) ${sub.email} ga yuborildi`, `${fileName} (${Math.max(1, Math.round(bytes / 1024))} KB) sent to ${sub.email}`),
      link: def.builtin || def.custom ? `/reporting/${def.id}` : '/reporting', level: 'info', kind: 'system', dedupeKey: `rep-${d.id}`,
    });
  }
  audit.log({ action: 'export', entity: 'report_delivery', entityId: d.id, details: `${def?.code} → ${sub.email} (${sub.format}, ${trigger})` });
  return d;
}

let schedulerStarted = false;
/** Планировщик рассылок в браузере (демо-сервер): проверка сроков раз в минуту. */
function startScheduler() {
  if (schedulerStarted || !(globalThis as { document?: unknown }).document) return;
  schedulerStarted = true;
  (globalThis as unknown as { setInterval: (f: () => void, ms: number) => unknown }).setInterval(() => {
    void reportingApi.runDue(now());
  }, 60_000);
}

export const reportingApi = {
  datasets: REPORT_DATASETS,

  /** Каталог: встроенные отчёты, общие пользовательские и собственные пользовательские. */
  listCatalog: (user?: User) => delay(db.catalog.filter((r) => r.kind !== 'custom' || r.shared || !user || r.ownerId === user.id || user.role === 'admin')),
  getReport: (id: ID) => delay(db.catalog.find((r) => r.id === id)),

  async runReport(id: ID, lang: Lang, opts: { periodDays?: number; user?: User } = {}): Promise<ReportResult | undefined> {
    const def = db.catalog.find((r) => r.id === id);
    if (!def) return delay(undefined);
    startScheduler();
    return delay(await runDefinition(def, lang, opts));
  },

  runBuilder: async (q: ReportBuilderQuery, lang: Lang) => delay(await runBuilder(q, lang)),

  /** Сохранение отчёта конструктора в каталог (PR-REP-016, PR-GEN-025). */
  async saveCustomReport(input: { name: string; description?: string; query: ReportBuilderQuery; shared: boolean }, user: User): Promise<ReportDefinition> {
    if (!input.name.trim()) throw new Error('reporting_err_name');
    const n = db.catalog.filter((r) => r.kind === 'custom').length + 1;
    const def: ReportDefinition = {
      id: nextId('rc'), code: `USR-${String(n).padStart(3, '0')}`, name: L(input.name.trim(), input.name.trim(), input.name.trim()), description: L(input.description?.trim() || '—', input.description?.trim() || '—', input.description?.trim() || '—'),
      area: 'custom', ownerId: user.id, schedule: 'on_demand', kind: 'custom', custom: clone(input.query), shared: input.shared, createdAt: now(),
    };
    db.catalog.push(def);
    audit.log({ action: 'create', entity: 'report', entityId: def.id, details: `${def.code}: ${input.name}` });
    emit();
    return delay(def);
  },
  async deleteCustomReport(id: ID, user: User) {
    const def = db.catalog.find((r) => r.id === id);
    if (!def || def.kind !== 'custom') throw apiError('REPORT_NOT_FOUND');
    if (def.ownerId !== user.id && user.role !== 'admin') throw new Error('reporting_err_noaccess');
    db.catalog = db.catalog.filter((r) => r.id !== id);
    db.subscriptions = db.subscriptions.filter((s) => s.reportId !== id);
    audit.log({ action: 'delete', entity: 'report', entityId: id });
    emit();
    await delay(null);
  },

  listSubscriptions: () => delay([...db.subscriptions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),

  async addSubscription(input: ReportNewSubscriptionInput, user: User): Promise<ReportSubscription> {
    if (!/^\S+@\S+\.\S+$/.test(input.email)) throw new Error('reporting_email_invalid');
    if (!db.catalog.some((r) => r.id === input.reportId)) throw apiError('REPORT_NOT_FOUND');
    const email = input.email.trim().toLowerCase();
    if (db.subscriptions.some((s) => s.reportId === input.reportId && s.email.toLowerCase() === email && s.frequency === input.frequency)) throw new Error('reporting_err_duplicate');
    const sub: ReportSubscription = { id: nextId('rs'), reportId: input.reportId, userId: user.id, frequency: input.frequency, format: input.format, email: input.email.trim(), createdAt: now(), nextRunAt: reportNextRun(input.frequency), active: true };
    db.subscriptions.push(sub);
    audit.log({ action: 'create', entity: 'report_subscription', entityId: sub.id, details: `${input.reportId} ${input.frequency} ${input.format}` });
    emit();
    startScheduler();
    return delay(sub);
  },

  async removeSubscription(id: ID, user: User) {
    const sub = db.subscriptions.find((s) => s.id === id);
    if (!sub) throw apiError('SUBSCRIPTION_NOT_FOUND');
    if (!reportingCanManage(user, sub)) throw new Error('reporting_err_forbidden');
    db.subscriptions = db.subscriptions.filter((s) => s.id !== id);
    emit();
    await delay(null);
  },

  async toggleSubscription(id: ID, user: User) {
    const sub = db.subscriptions.find((s) => s.id === id);
    if (!sub) throw apiError('SUBSCRIPTION_NOT_FOUND');
    if (!reportingCanManage(user, sub)) throw new Error('reporting_err_forbidden');
    sub.active = sub.active === false;
    emit();
    await delay(null);
  },

  /** Отправить отчёт по рассылке немедленно. */
  async sendNow(id: ID, user: User): Promise<ReportDelivery> {
    const sub = db.subscriptions.find((s) => s.id === id);
    if (!sub) throw apiError('SUBSCRIPTION_NOT_FOUND');
    if (!reportingCanManage(user, sub)) throw new Error('reporting_err_forbidden');
    const d = await deliver(sub, 'manual');
    emit();
    return delay(d);
  },

  /** Запуск планировщика на момент времени: отправляются все активные рассылки со сроком ≤ asOf (PR-REP-018). */
  async runDue(asOf: string = now()): Promise<number> {
    let n = 0;
    for (const s of db.subscriptions.filter((x) => x.active !== false && x.nextRunAt && x.nextRunAt <= asOf)) {
      await deliver(s, 'schedule');
      n++;
    }
    if (n) emit();
    return n;
  },

  listDeliveries: () => delay(db.deliveries),

  /** KPI-дашборд руководства с целевыми значениями, набор — по роли пользователя (PR-REP-013). */
  async dashboard(user: User): Promise<ReportKpi[]> {
    const role: Role = user.role;
    const groups: ReportKpi['group'][] = ['admin', 'approver', 'finance', 'analyst', 'dept_head', 'auditor'].includes(role)
      ? ['finance', 'budget', 'cash', 'tax', 'operations']
      : ['treasury', 'cash_operator'].includes(role) ? ['cash', 'operations'] : ['accountant', 'tax_officer'].includes(role) ? ['tax', 'finance', 'budget'] : ['operations'];
    const c = computeIfrsConsolidation();
    const [kpis, trendIfrs, lines, cash, ndo, ndoTrend, tax, procList, flags] = await Promise.all([
      ifrsAnalyticsApi.kpis(),
      ifrsAnalyticsApi.kpiTrend('group'),
      api.listBudgetLines(),
      cashApi.overview(),
      ndoApi.results('2026-09'),
      Promise.all(['2026-07', '2026-08', '2026-09'].map((p) => ndoApi.results(p))),
      taxesApi.getOverview(),
      api.listProcurement(),
      ifrsAnalyticsApi.redFlags(),
    ]);
    const group = kpis.find((k) => k.scope === 'group');
    const planned = lines.reduce((s, b) => s + b.planned, 0);
    const spent = lines.reduce((s, b) => s + b.spent, 0);
    const tasks = approvalEngine.all();
    const overdue = tasks.filter((t) => t.status === 'pending' && new Date(t.dueAt).getTime() < Date.now()).length;
    const procPending = procList.filter((p) => p.status === 'pending').length;
    const K = (id: string, ru: string, uz: string, en: string, value: number, unit: ReportKpi['unit'], target: number, better: ReportKpi['better'], link: string, g: ReportKpi['group'], trend?: number[]): ReportKpi => {
      const t = db.targets[id] ?? target;
      const ok = better === 'higher' ? value >= t : value <= t;
      const near = better === 'higher' ? value >= t * 0.9 : value <= t * 1.1 || (t === 0 && value <= 1);
      return { id, name: L(ru, uz, en), value, unit, target: t, better, status: ok ? 'ok' : near ? 'warn' : 'bad', link, group: g, ...(trend ? { trend } : {}) };
    };
    const all: ReportKpi[] = [
      K('fin_profit', 'Чистая прибыль группы (МСФО)', 'Guruh sof foydasi (MHXS)', 'Group net profit (IFRS)', c.profitOwners, 'money', 1_500_000_000_000, 'higher', '/ifrs?tab=pl', 'finance'),
      K('fin_roe', 'ROE группы, %', 'Guruh ROE, %', 'Group ROE, %', group?.roe ?? 0, 'percent', 15, 'higher', '/ifrs?tab=kpi', 'finance', trendIfrs.map((x) => x.roe)),
      K('fin_cir', 'Cost-to-Income группы, %', 'Guruh Cost-to-Income, %', 'Group cost-to-income, %', group?.cir ?? 0, 'percent', 55, 'lower', '/ifrs?tab=kpi', 'finance', trendIfrs.map((x) => x.cir)),
      K('fin_flags', 'Красные флажки по дочерним', "Sho'ba korxonalar qizil bayroqlari", 'Subsidiary red flags', flags.length, 'count', 0, 'lower', '/ifrs?tab=flags', 'finance'),
      K('bud_exec', 'Исполнение бюджета, %', 'Byudjet ijrosi, %', 'Budget execution, %', planned ? Math.round((spent / planned) * 1000) / 10 : 0, 'percent', 80, 'higher', '/budgeting', 'budget'),
      K('cash_total', 'Наличность в кассах и хранилищах', 'Kassalar va xazinalardagi naqd pul', 'Cash in desks and vaults', cash.totalCashUzs, 'money', 1_500_000_000_000, 'lower', '/cash', 'cash'),
      K('cash_cost', 'Себестоимость обработки 1 млн', '1 mln ishlov berish tannarxi', 'Cost of processing 1 mln', cash.costPerMln, 'count', 4_500, 'lower', '/cash?tab=economics', 'cash'),
      K('ndo_result', 'Экономический результат НДО (сентябрь)', 'NPA iqtisodiy natijasi (sentyabr)', 'Cash economic result (Sep)', ndo.totals.result, 'money', -10_000_000_000, 'higher', '/cash/ndo?tab=cost', 'cash', ndoTrend.map((r) => Math.round(r.totals.result / 1e9))),
      K('tax_overdue', 'Просроченные налоговые обязательства', "Muddati o'tgan soliq majburiyatlari", 'Overdue tax obligations', tax.overdue, 'count', 0, 'lower', '/taxes', 'tax'),
      K('tax_outstanding', 'Налоги к уплате', "To'lanadigan soliqlar", 'Taxes payable', tax.outstanding, 'money', 50_000_000_000, 'lower', '/taxes', 'tax'),
      K('ops_overdue', 'Просроченные согласования', "Muddati o'tgan kelishuvlar", 'Overdue approvals', overdue, 'count', 0, 'lower', '/approvals', 'operations'),
      K('ops_proc', 'Заявки на закупку на согласовании', 'Kelishuvdagi xarid arizalari', 'Purchase requests in approval', procPending, 'count', 10, 'lower', '/procurement', 'operations'),
    ];
    return delay(all.filter((k) => groups.includes(k.group)));
  },

  async setTarget(id: string, value: number, user: User) {
    if (!can(user, 'reporting', 'edit') && user.role !== 'finance') throw new Error('reporting_err_noaccess');
    if (!Number.isFinite(value)) throw new Error('reporting_err_target');
    db.targets[id] = value;
    audit.log({ action: 'settings', entity: 'report_kpi_target', entityId: id, details: String(value) });
    emit();
    await delay(null);
  },

  /** Дашборд по направлениям: подразделения (бюджет, закупки) или филиалы (касса, налоги, НДО) — PR-REP-014. */
  async directions(dim: 'department' | 'branch', lang: Lang): Promise<{ key: string; label: string; metrics: Record<string, number>; link: string }[]> {
    if (dim === 'department') {
      const deps = await api.listDepartments();
      const proc = await api.listProcurement();
      const budget = await budgetingApi.listDepartments().catch(() => [] as { departmentId: ID }[]);
      return delay(deps.map((d) => {
        const b = budget.find((x) => x.departmentId === d.id) as Record<string, unknown> | undefined;
        const ps = proc.filter((p) => p.departmentId === d.id);
        return {
          key: d.id, label: localize(d.name, lang), link: `/budgeting`,
          metrics: { plan: Number(b?.planYear ?? 0), actual: Number(b?.actualYtd ?? 0), execution: Number(b?.executionPct ?? 0), procurement: ps.reduce((s, p) => s + procurementTotal(p.items), 0), requests: ps.length },
        };
      }).filter((x) => x.metrics.plan || x.metrics.requests));
    }
    const [objs, ndo, returns, branches] = await Promise.all([ndoApi.listObjects(), ndoApi.results('2026-09'), taxesApi.listReturns(), cashApi.listBranches()]);
    const region = (orgKey: string) => (orgKey === 'HO' ? 'HO' : orgKey.slice(0, 3));
    const keys = new Set<string>();
    const m = new Map<string, Record<string, number>>();
    const add = (k: string, f: string, v: number) => {
      keys.add(k);
      const x = m.get(k) ?? { cash: 0, ndoIncome: 0, ndoCost: 0, taxes: 0 };
      x[f] = (x[f] ?? 0) + v;
      m.set(k, x);
    };
    for (const o of objs.filter((x) => x.cashBranchId)) {
      const b = branches.find((x) => x.id === o.cashBranchId);
      if (b) add(region(o.orgUnitKey), 'cash', (['UZS', 'USD', 'EUR', 'RUB'] as const).reduce((s, c) => s + b.balances[c] * CASH_RATES[c], 0));
    }
    for (const r of ndo.objects) {
      const o = objs.find((x) => x.key === r.key);
      if (!o) continue;
      add(region(o.orgUnitKey), 'ndoIncome', r.income);
      add(region(o.orgUnitKey), 'ndoCost', r.total);
    }
    for (const r of returns) for (const l of r.baseLines) if (l.branchKey && l.tax !== undefined) add(l.branchKey, 'taxes', l.tax);
    const units = await (await import('../../org')).orgApi.listOrgUnits();
    return delay([...keys].sort().map((k) => ({ key: k, label: `${k} · ${localize(units.find((u) => u.key === k)?.name, lang) ?? k}`, metrics: m.get(k) ?? {}, link: '/cash/ndo?tab=cost' })));
  },
};

// Глобальный поиск: отчёты каталога → экран отчёта (или модуль, где он формируется).
registerSearchProvider((q, lang) =>
  db.catalog
    .filter((r) => matches(q, r.code, r.name.ru, r.name.uz, r.name.en))
    .map((r) => ({
      group: 'reporting_title',
      title: `${r.code} · ${localize(r.name, lang)}`,
      subtitle: translate(lang, tk('reporting_schedule_', r.schedule)),
      to: r.builtin || r.custom ? `/reporting/${r.id}` : (r.link ?? '/reporting'),
    })),
);
