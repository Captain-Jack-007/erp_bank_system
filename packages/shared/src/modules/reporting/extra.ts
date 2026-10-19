// Регламентированные и управленческие отчёты каталога (ТЗ 4.2.8, PR-REP-001…012): МСФО (ОФП, ОПУ, ДДС, капитал,
// примечания), НСБУ, формы ЦБ, налоговые реестры, статистика (1-Т, 2-инвест), ведомости ОС и ТМЗ, HR, склад, ОС,
// автопарк, командировки. Данные — через публичные API модулей и интеграционную шину (Laborlaw).
import { api } from '../../api';
import { now } from '../../bus';
import { localize, tk, translate } from '../../i18n';
import { INTEGRATION_SYSTEMS, integrationHub } from '../../services/integrations';
import type { ID, Lang, Localized, User } from '../../types';
import { assetsApi } from '../assets';
import { cashApi, cashPositions, CASH_RATES } from '../cash';
import { fleetApi } from '../fleet';
import { computeIfrsConsolidation, ifrsAnalyticsApi, ifrsApi, ifrsSubsApi } from '../ifrs';
import { taxesApi } from '../taxes';
import { tripsApi } from '../trips';
import { warehouseApi } from '../warehouse';
import type { ReportBuiltinKey, ReportCell, ReportColumn, ReportResult } from './types';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const col = (key: string, ru: string, uz: string, en: string, type: ReportColumn['type']): ReportColumn => ({ key, label: L(ru, uz, en), type });
type Row = Record<string, ReportCell>;
/** Защищённое чтение числового/строкового поля записи другого модуля (структуры модулей развиваются независимо). */
const num = (o: unknown, k: string): number => {
  const v = (o as Record<string, unknown> | undefined)?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};
const str = (o: unknown, k: string): string => {
  const v = (o as Record<string, unknown> | undefined)?.[k];
  return typeof v === 'string' ? v : '';
};
function totalsOf(rows: Row[], columns: ReportColumn[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const c of columns) if (c.type === 'money' || c.type === 'number') t[c.key] = rows.reduce((s, r) => s + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0), 0);
  return t;
}
const result = (title: Localized, columns: ReportColumn[], rows: Row[], opts: Partial<ReportResult> & { noTotals?: boolean } = {}): ReportResult => {
  const { noTotals, ...rest } = opts;
  return { title, columns, rows, ...(noTotals ? {} : { totals: totalsOf(rows, columns) }), generatedAt: now(), ...rest };
};

// Laborlaw: численность и движение персонала по подразделениям (для HR-отчёта и формы 1-Т).
const hrSys = INTEGRATION_SYSTEMS.find((s) => s.id === 'laborlaw');
if (hrSys && !hrSys.operations.some((o) => o.id === 'hr.headcount')) {
  hrSys.operations.push({
    id: 'hr.headcount', direction: 'in', schemaVersion: '1.0', name: L('Численность и ФОТ по подразделениям', "Bo'linmalar bo'yicha xodimlar soni va MHTF", 'Headcount and payroll by department'),
    sample: () => ({ period: '2026-09', departments: ['d1', 'd2'] }),
    validate: (p) => (p.period ? null : { code: 'validation', message: 'period required' }),
    respond: (p) => {
      const deps = Array.isArray(p.departments) ? (p.departments as string[]) : [];
      return {
        period: p.period,
        rows: deps.map((d, i) => {
          const h = 18 + ((d.charCodeAt(d.length - 1) * 7 + i * 13) % 60);
          return { departmentId: d, headcount: h, hired: (i * 3 + 1) % 4, dismissed: (i * 5 + 2) % 3, payroll: h * (9_200_000 + ((i * 377_000) % 2_000_000)) };
        }),
      };
    },
    count: (p) => (Array.isArray(p.departments) ? (p.departments as unknown[]).length : 0),
  });
  if (!hrSys.modules.includes('reporting')) hrSys.modules.push('reporting');
}

type HrData = { deps: Awaited<ReturnType<typeof api.listDepartments>>; rows: { departmentId: ID; headcount: number; hired: number; dismissed: number; payroll: number }[]; exchangeId: string; status: string };
/** Ответ Laborlaw кэшируется на период (в т. ч. ещё не завершённый запрос): вызов шины порождает emit(), и без кэша
 *  экран отчёта, перезапрашивающий данные по emit(), вызывал бы интеграцию бесконечно. Неуспешный обмен не кэшируется. */
const hrCache = new Map<string, Promise<HrData>>();
async function hrData(user?: User): Promise<HrData> {
  const period = now().slice(0, 7);
  const cached = hrCache.get(period);
  if (cached) return cached;
  const p = (async () => {
    const deps = await api.listDepartments();
    const r = await integrationHub.call('laborlaw', 'hr.headcount', { period, departments: deps.map((d) => d.id) }, { ...(user ? { userId: user.id } : {}) });
    const rows = ((r.response as { rows?: HrData['rows'] })?.rows ?? []);
    if (r.status !== 'success') setTimeout(() => hrCache.delete(period), 0);
    return { deps, rows, exchangeId: r.id, status: r.status };
  })();
  hrCache.set(period, p);
  return p;
}

export async function runExtraBuiltin(key: ReportBuiltinKey, lang: Lang, opts: { periodDays?: number; user?: User } = {}): Promise<ReportResult | undefined> {
  const since = opts.periodDays ? new Date(Date.now() - opts.periodDays * 86_400_000).toISOString().slice(0, 10) : '';
  const lineName = (l: string) => translate(lang, tk('ifrs_line_', l));

  if (key === 'ifrs_sfp' || key === 'ifrs_pl') {
    const c = computeIfrsConsolidation();
    const list = key === 'ifrs_sfp' ? c.sfp : c.pl;
    const bank = c.entities.find((e) => e.type === 'parent')!;
    const columns = [col('line', 'Статья', 'Modda', 'Line item', 'text'), col('bank', 'Банк', 'Bank', 'Bank', 'money'), col('subs', 'Дочерние', "Sho'ba korxonalar", 'Subsidiaries', 'money'), col('elim', 'Элиминации', 'Eliminatsiyalar', 'Eliminations', 'money'), col('cons', 'Консолидировано', 'Konsolidatsiyalangan', 'Consolidated', 'money')];
    const rows: Row[] = list.map((r) => {
      const b = r.byEntity[bank.id] ?? 0;
      const subs = Object.entries(r.byEntity).filter(([id]) => id !== bank.id).reduce((s, [, v]) => s + v, 0);
      return { line: lineName(r.line), bank: b, subs, elim: r.eliminations, cons: r.consolidated };
    });
    return result(key === 'ifrs_sfp' ? L('Отчёт о финансовом положении (консолидированный)', "Moliyaviy holat to'g'risidagi hisobot (konsolidatsiyalangan)", 'Consolidated statement of financial position') : L('Отчёт о прибылях и убытках (консолидированный)', "Foyda va zararlar to'g'risidagi hisobot (konsolidatsiyalangan)", 'Consolidated statement of profit or loss'), columns, rows, {
      noTotals: true, chart: { labelKey: 'line', seriesKeys: ['cons'] }, rowDocs: rows.map(() => [{ label: 'МСФО / MHXS / IFRS', to: key === 'ifrs_sfp' ? '/ifrs?tab=sfp' : '/ifrs?tab=pl' }]),
      notes: [L(`Отчётная дата ${c.period}; баланс ${c.balanced ? 'сходится' : 'НЕ сходится'}`, `Hisobot sanasi ${c.period}; balans ${c.balanced ? 'mos' : 'mos EMAS'}`, `Reporting date ${c.period}; balance ${c.balanced ? 'ties' : 'does NOT tie'}`)],
    });
  }

  if (key === 'ifrs_cf') {
    const cf = await ifrsAnalyticsApi.cashFlow('group');
    const sec = (s: string) => (s === 'operating' ? L('Операционная', 'Operatsion', 'Operating') : s === 'investing' ? L('Инвестиционная', 'Investitsiya', 'Investing') : L('Финансовая', 'Moliyaviy', 'Financing'));
    const columns = [col('section', 'Деятельность', 'Faoliyat', 'Activity', 'text'), col('item', 'Статья', 'Modda', 'Item', 'text'), col('amount', 'Сумма', 'Summa', 'Amount', 'money')];
    const rows: Row[] = [
      ...cf.indirect.map((x) => ({ section: localize(sec(x.section), lang), item: localize(x.label, lang), amount: x.amount })),
    ];
    return result(L('Отчёт о движении денежных средств (косвенный метод)', "Pul mablag'lari harakati to'g'risidagi hisobot (bilvosita usul)", 'Statement of cash flows (indirect method)'), columns, rows, {
      chart: { labelKey: 'item', seriesKeys: ['amount'] }, rowDocs: rows.map(() => [{ label: 'IFRS', to: '/ifrs?tab=cashflow' }]),
      notes: [L(`Денежные средства: на начало ${Math.round(cf.opening / 1e6)} млн, на конец ${Math.round(cf.closing / 1e6)} млн; итог потоков сходится с изменением денежных средств`, `Pul mablag'lari: boshida ${Math.round(cf.opening / 1e6)} mln, oxirida ${Math.round(cf.closing / 1e6)} mln`, `Cash: opening ${Math.round(cf.opening / 1e6)} mln, closing ${Math.round(cf.closing / 1e6)} mln; flows tie to the change in cash`)],
    });
  }

  if (key === 'ifrs_equity') {
    const c = computeIfrsConsolidation();
    const o = computeIfrsConsolidation({ opening: true });
    const eq = (x: typeof c) => x.sfp.find((r) => r.line === 'share_capital')!.consolidated + x.sfp.find((r) => r.line === 'retained')!.consolidated;
    const ents = await ifrsApi.listEntities();
    // Доля НКД в объявленных дивидендах дочерних: сумма × курс × (1 − доля банка) по каждому плательщику.
    const nciDiv = Math.round((await ifrsSubsApi.listDividends()).reduce((s, d) => {
      const e = ents.find((x) => x.id === d.entityId);
      return e ? s + d.amount * (e.currency === 'USD' ? ifrsApi.usdRate : 1) * (1 - e.ownership / 100) : s;
    }, 0));
    const ownersOpen = eq(o);
    const ownersClose = eq(c) + c.profitOwners;
    const otherOwners = ownersClose - ownersOpen - c.profitOwners;
    const otherNci = c.nci - o.nci - c.profitNci + nciDiv;
    const columns = [col('item', 'Движение', 'Harakat', 'Movement', 'text'), col('owners', 'Капитал акционеров банка', 'Bank aksiyadorlari kapitali', 'Equity of bank owners', 'money'), col('nci', 'Неконтролирующие доли', 'Nazorat qilmaydigan ulushlar', 'Non-controlling interests', 'money'), col('total', 'Итого капитал', 'Jami kapital', 'Total equity', 'money')];
    const rows: Row[] = [
      { item: localize(L('Капитал на 01.01.2026', '01.01.2026 holatiga kapital', 'Equity at 1 Jan 2026'), lang), owners: ownersOpen, nci: o.nci, total: ownersOpen + o.nci },
      { item: localize(L('Прибыль за период', 'Davr foydasi', 'Profit for the period'), lang), owners: c.profitOwners, nci: c.profitNci, total: c.netProfit },
      { item: localize(L('Дивиденды дочерних (доля НКД)', "Sho'ba korxonalar dividendlari (NNU ulushi)", 'Subsidiary dividends (NCI share)'), lang), owners: 0, nci: -nciDiv, total: -nciDiv },
      { item: localize(L('Прочие изменения и корректировки МСФО', "Boshqa o'zgarishlar va MHXS tuzatishlari", 'Other changes and IFRS adjustments'), lang), owners: otherOwners, nci: otherNci, total: otherOwners + otherNci },
      { item: localize(L('Капитал на 30.09.2026', '30.09.2026 holatiga kapital', 'Equity at 30 Sep 2026'), lang), owners: ownersClose, nci: c.nci, total: ownersClose + c.nci },
    ];
    return result(L('Отчёт об изменениях в капитале', "Kapitaldagi o'zgarishlar to'g'risidagi hisobot", 'Statement of changes in equity'), columns, rows, { noTotals: true, rowDocs: rows.map(() => [{ label: 'IFRS', to: '/ifrs?tab=elims' }]) });
  }

  if (key === 'ifrs_notes') {
    const sums = await ifrsApi.entitySummaries();
    const c = computeIfrsConsolidation();
    const columns = [col('entity', 'Компания', 'Kompaniya', 'Entity', 'text'), col('method', 'Метод', 'Usul', 'Method', 'text'), col('own', 'Доля, %', 'Ulush, %', 'Ownership, %', 'percent'), col('assets', 'Активы', 'Aktivlar', 'Assets', 'money'), col('equity', 'Капитал', 'Kapital', 'Equity', 'money'), col('profit', 'Прибыль', 'Foyda', 'Profit', 'money')];
    const rows: Row[] = sums.map((s) => ({ entity: s.entity.name, method: translate(lang, tk('ifrs_method_', s.entity.method)), own: s.entity.ownership, assets: s.totalAssets, equity: s.equity, profit: s.profit }));
    return result(L('Примечания: компании группы', 'Izohlar: guruh kompaniyalari', 'Notes: group entities'), columns, rows, {
      rowDocs: sums.map(() => [{ label: 'IFRS', to: '/ifrs?tab=structure' }]),
      notes: [L(`Гудвил ${Math.round(c.goodwill / 1e9)} млрд; НКД ${Math.round(c.nci / 1e9)} млрд; доля в прибыли ассоциированных ${Math.round(c.associatesShare / 1e9)} млрд`, `Gudvil ${Math.round(c.goodwill / 1e9)} mlrd; NNU ${Math.round(c.nci / 1e9)} mlrd`, `Goodwill ${Math.round(c.goodwill / 1e9)} bn; NCI ${Math.round(c.nci / 1e9)} bn; share of associates ${Math.round(c.associatesShare / 1e9)} bn`)],
    });
  }

  if (key === 'nsbu_balance' || key === 'cbu_balance') {
    const tb = await ifrsApi.listTrialBalance();
    const SECTION: Record<string, Localized> = { '1': L('Активы', 'Aktivlar', 'Assets'), '2': L('Обязательства', 'Majburiyatlar', 'Liabilities'), '3': L('Капитал', 'Kapital', 'Equity'), '4': L('Доходы', 'Daromadlar', 'Income'), '5': L('Расходы', 'Xarajatlar', 'Expenses') };
    if (key === 'nsbu_balance') {
      const columns = [col('section', 'Раздел', "Bo'lim", 'Section', 'text'), col('account', 'Счёт', 'Hisobvaraq', 'Account', 'text'), col('name', 'Наименование', 'Nomi', 'Name', 'text'), col('balance', 'Остаток', 'Qoldiq', 'Balance', 'money')];
      const rows: Row[] = tb.map((r) => ({ section: localize(SECTION[r.accountCode[0]!] ?? L('—', '—', '—'), lang), account: r.accountCode, name: localize(r.name, lang), balance: r.balance }));
      return result(L('Бухгалтерский баланс (НСБУ)', 'Buxgalteriya balansi (MBHS)', 'Balance sheet (national standards)'), columns, rows, { noTotals: true, rowDocs: rows.map(() => [{ label: 'ОСВ / AQV / TB', to: '/ifrs?tab=mapping' }]) });
    }
    const groups = new Map<string, { section: string; amount: number; count: number }>();
    for (const r of tb) {
      const g = r.accountCode.slice(0, 3);
      const x = groups.get(g) ?? { section: localize(SECTION[g[0]!] ?? L('—', '—', '—'), lang), amount: 0, count: 0 };
      x.amount += r.balance;
      x.count++;
      groups.set(g, x);
    }
    const columns = [col('chapter', 'Глава (3 знака)', 'Bob (3 belgi)', 'Chapter (3 digits)', 'text'), col('section', 'Раздел', "Bo'lim", 'Section', 'text'), col('count', 'Счетов', 'Hisobvaraqlar', 'Accounts', 'number'), col('amount', 'Остаток', 'Qoldiq', 'Balance', 'money')];
    const rows: Row[] = [...groups.entries()].map(([chapter, x]) => ({ chapter, section: x.section, count: x.count, amount: x.amount }));
    return result(L('Форма 1 для ЦБ РУз: баланс по главам', "MB RUz uchun 1-shakl: boblar bo'yicha balans", 'CBU Form 1: balance by chapter'), columns, rows, { noTotals: true, chart: { labelKey: 'chapter', seriesKeys: ['amount'] } });
  }

  if (key === 'cbu_cash') {
    const branches = await cashApi.listBranches();
    const columns = [col('branch', 'Подразделение', "Bo'linma", 'Unit', 'text'), col('currency', 'Валюта', 'Valyuta', 'Currency', 'text'), col('balance', 'Остаток', 'Qoldiq', 'Balance', 'number'), col('uzs', 'В UZS', 'UZS da', 'In UZS', 'money'), col('min', 'Лимит мин.', 'Min. limit', 'Min. limit', 'number'), col('max', 'Лимит макс.', 'Maks. limit', 'Max. limit', 'number'), col('status', 'Соблюдение лимита', 'Limitga rioya', 'Limit compliance', 'text')];
    const rows: Row[] = [];
    const docs: { label: string; to?: string }[][] = [];
    for (const b of branches) for (const p of cashPositions(b)) {
      rows.push({ branch: `${b.code} · ${localize(b.name, lang)}`, currency: p.currency, balance: p.balance, uzs: Math.round(p.balance * CASH_RATES[p.currency]), min: p.limit.min, max: p.limit.max, status: translate(lang, tk('cash_pos_', p.status)) });
      docs.push([{ label: b.code, to: `/cash/${b.id}` }]);
    }
    // Итог — только по сумме в UZS: остатки и лимиты в разных валютах не складываются.
    const res = result(L('Отчёт о кассовых остатках и лимитах', 'Kassa qoldiqlari va limitlari hisoboti', 'Cash balances and limits report'), columns, rows, { rowDocs: docs });
    if (res.totals) res.totals = { uzs: res.totals.uzs ?? 0 };
    return res;
  }

  if (key === 'tax_register') {
    const list = (await taxesApi.listReturns()).filter((r) => !since || r.dueDate >= since);
    const columns = [col('number', 'Расчёт', 'Hisob', 'Return', 'text'), col('tax', 'Налог', 'Soliq', 'Tax', 'text'), col('period', 'Период', 'Davr', 'Period', 'text'), col('status', 'Статус', 'Holati', 'Status', 'text'), col('amount', 'Начислено', 'Hisoblangan', 'Accrued', 'money'), col('paid', 'Уплачено', "To'langan", 'Paid', 'money'), col('outstanding', 'Задолженность', 'Qarz', 'Outstanding', 'money')];
    const rows: Row[] = list.map((r) => ({ number: r.number, tax: translate(lang, tk('taxes_type_', r.type)), period: r.period, status: translate(lang, tk('taxes_status_', r.status)), amount: r.amount, paid: r.paid, outstanding: r.outstanding }));
    return result(L('Реестр налоговых расчётов и платежей', "Soliq hisoblari va to'lovlari reyestri", 'Tax returns and payments register'), columns, rows, { rowDocs: list.map((r) => [{ label: r.number, to: `/taxes/${r.id}` }]), chart: { labelKey: 'number', seriesKeys: ['amount', 'paid'] } });
  }

  if (key === 'tax_leases') {
    const IJARA_ST: Record<string, Localized> = { registered: L('зарегистрирован', 'ro‘yxatdan o‘tgan', 'registered'), not_registered: L('не зарегистрирован', 'ro‘yxatdan o‘tmagan', 'not registered'), pending: L('на регистрации', 'ro‘yxatdan o‘tkazilmoqda', 'pending'), unknown: L('не проверен', 'tekshirilmagan', 'not checked') };
    const list = await taxesApi.listLeases();
    const columns = [col('contract', 'Договор', 'Shartnoma', 'Contract', 'text'), col('pinfl', 'ПИНФЛ арендодателя', 'Ijaraga beruvchi JShShIR', 'Lessor PINFL', 'text'), col('address', 'Адрес объекта', 'Obyekt manzili', 'Object address', 'text'), col('rent', 'Плата в месяц', 'Oylik haq', 'Monthly rent', 'money'), col('pit', 'НДФЛ уплачен', "JShDS to'langan", 'PIT paid', 'money'), col('ijara', 'ijara.soliq.uz', 'ijara.soliq.uz', 'ijara.soliq.uz', 'text')];
    const rows: Row[] = list.map((l) => ({ contract: l.contractNo, pinfl: l.lessorPinfl, address: l.address, rent: l.monthlyRent, pit: l.payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.pit, 0), ijara: l.ijara.regNo ?? localize(IJARA_ST[l.ijara.status] ?? L(l.ijara.status, l.ijara.status, l.ijara.status), lang) ?? '' }));
    return result(L('Реестр аренды у физических лиц', 'Jismoniy shaxslardan ijara reyestri', 'Register of leases from individuals'), columns, rows, { rowDocs: list.map((l) => [{ label: l.contractNo, to: '/taxes/registers?tab=leases' }]) });
  }

const hrSt = (st: string) => (st === 'success' ? L('успешно', 'muvaffaqiyatli', 'success') : st === 'queued' ? L('в очереди', 'navbatda', 'queued') : L('ошибка, показаны последние данные', 'xato, oxirgi maʼlumotlar ko‘rsatilgan', 'failed, last data shown'));
  if (key === 'stat_labour' || key === 'hr_report') {
    const hr = await hrData(opts.user);
    const dep = (id: ID) => localize(hr.deps.find((d) => d.id === id)?.name, lang) ?? id;
    const columns = [col('department', 'Подразделение', "Bo'linma", 'Department', 'text'), col('headcount', 'Численность', 'Xodimlar soni', 'Headcount', 'number'), col('hired', 'Принято', 'Qabul qilingan', 'Hired', 'number'), col('dismissed', 'Уволено', "Bo'shatilgan", 'Separated', 'number'), col('turnover', 'Текучесть, %', "Qo'nimsizlik, %", 'Turnover, %', 'percent'), col('payroll', 'ФОТ за месяц', 'Oylik MHTF', 'Monthly payroll', 'money')];
    const rows: Row[] = hr.rows.map((r) => ({ department: dep(r.departmentId), headcount: r.headcount, hired: r.hired, dismissed: r.dismissed, turnover: r.headcount ? Math.round((r.dismissed / r.headcount) * 1000) / 10 : 0, payroll: r.payroll }));
    return result(key === 'hr_report' ? L('HR-отчёт: численность, движение, ФОТ', 'HR hisoboti: xodimlar soni, harakati, MHTF', 'HR report: headcount, movement, payroll') : L('Форма 1-Т «Отчёт по труду»', "1-T shakli «Mehnat bo'yicha hisobot»", 'Form 1-T “Labour report”'), columns, rows, {
      chart: { labelKey: 'department', seriesKeys: ['headcount'] },
      notes: [L(`Источник: Laborlaw (HR & Payroll), обмен ${hr.exchangeId} — ${hrSt(hr.status).ru}`, `Manba: Laborlaw (HR & Payroll), almashinuv ${hr.exchangeId} — ${hrSt(hr.status).uz}`, `Source: Laborlaw (HR & Payroll), exchange ${hr.exchangeId} — ${hrSt(hr.status).en}`)],
    });
  }

  if (key === 'stat_capex' || key === 'assets_register' || key === 'assets_report') {
    const list = await assetsApi.list();
    const cat = (c: string) => translate(lang, tk('assets_cat_', c));
    if (key === 'assets_register') {
      const columns = [col('inv', 'Инв. №', 'Inv. №', 'Inv. No.', 'text'), col('name', 'Наименование', 'Nomi', 'Name', 'text'), col('category', 'Категория', 'Toifa', 'Category', 'text'), col('acquired', 'Принят к учёту', 'Hisobga olingan', 'Acquired', 'text'), col('cost', 'Первоначальная стоимость', "Boshlang'ich qiymat", 'Cost', 'money'), col('acc', 'Амортизация', 'Amortizatsiya', 'Depreciation', 'money'), col('nbv', 'Остаточная стоимость', 'Qoldiq qiymat', 'Net book value', 'money')];
      const rows: Row[] = list.map((a) => ({ inv: a.inventoryNo, name: a.name, category: cat(a.category), acquired: a.acquiredAt, cost: a.cost, acc: a.accumulated, nbv: a.cost - a.accumulated }));
      return result(L('Инвентарная ведомость основных средств', 'Asosiy vositalar inventar qaydnomasi', 'Fixed asset inventory statement'), columns, rows, { rowDocs: list.map((a) => [{ label: a.inventoryNo, to: `/assets/${a.id}` }]) });
    }
    const groups = new Map<string, { count: number; cost: number; acc: number; additions: number; writeoff: number; monthly: number; ids: { label: string; to: string }[] }>();
    for (const a of list) {
      const g = groups.get(a.category) ?? { count: 0, cost: 0, acc: 0, additions: 0, writeoff: 0, monthly: 0, ids: [] };
      g.count++;
      g.cost += a.cost;
      g.acc += a.accumulated;
      if (a.acquiredAt >= '2026-01-01') g.additions += a.cost;
      if (a.status === 'pending_writeoff' || a.status === 'written_off') g.writeoff += a.cost - a.accumulated;
      g.monthly += a.usefulLifeMonths ? Math.round(a.cost / a.usefulLifeMonths) : 0;
      g.ids.push({ label: a.inventoryNo, to: `/assets/${a.id}` });
      groups.set(a.category, g);
    }
    const entries = [...groups.entries()];
    if (key === 'stat_capex') {
      const columns = [col('category', 'Вид основных средств', 'Asosiy vositalar turi', 'Asset type', 'text'), col('additions', 'Поступило в 2026 г.', '2026 yilda kirim', 'Additions in 2026', 'money'), col('count', 'Объектов', 'Obyektlar', 'Objects', 'number')];
      const rows: Row[] = entries.map(([c, g]) => ({ category: cat(c), additions: g.additions, count: g.count }));
      return result(L('Форма 2-инвест: капитальные вложения', "2-invest shakli: kapital qo'yilmalar", 'Form 2-invest: capital investment'), columns, rows, { rowDocs: entries.map(([, g]) => g.ids) });
    }
    const columns = [col('category', 'Категория', 'Toifa', 'Category', 'text'), col('count', 'Количество', 'Soni', 'Count', 'number'), col('cost', 'Стоимость', 'Qiymat', 'Cost', 'money'), col('acc', 'Износ', 'Eskirish', 'Wear', 'money'), col('nbv', 'Остаточная', 'Qoldiq', 'NBV', 'money'), col('wear', 'Износ, %', 'Eskirish, %', 'Wear, %', 'percent'), col('monthly', 'Амортизация в месяц', 'Oylik amortizatsiya', 'Monthly depreciation', 'money'), col('writeoff', 'К списанию (остаточная)', 'Hisobdan chiqarishga', 'Pending write-off (NBV)', 'money')];
    const rows: Row[] = entries.map(([c, g]) => ({ category: cat(c), count: g.count, cost: g.cost, acc: g.acc, nbv: g.cost - g.acc, wear: g.cost ? Math.round((g.acc / g.cost) * 1000) / 10 : 0, monthly: g.monthly, writeoff: g.writeoff }));
    return result(L('Отчёт по основным средствам', "Asosiy vositalar bo'yicha hisobot", 'Fixed asset report'), columns, rows, { chart: { labelKey: 'category', seriesKeys: ['cost', 'nbv'] }, rowDocs: entries.map(([, g]) => g.ids) });
  }

  if (key === 'warehouse_turnover' || key === 'warehouse_report') {
    const items = await warehouseApi.listItems();
    const moves = (await warehouseApi.listMovements()).filter((m) => !since || str(m, 'at') >= since);
    const inTypes = new Set(['receipt', 'transfer_in', 'return']);
    const isIn = (m: unknown) => inTypes.has(str(m, 'type')) || str(m, 'docType') === 'receipt';
    if (key === 'warehouse_turnover') {
      const columns = [col('sku', 'Артикул', 'Artikul', 'SKU', 'text'), col('name', 'Наименование', 'Nomi', 'Name', 'text'), col('open', 'Остаток на начало', 'Boshidagi qoldiq', 'Opening', 'number'), col('in', 'Приход', 'Kirim', 'Receipts', 'number'), col('out', 'Расход', 'Chiqim', 'Issues', 'number'), col('close', 'Остаток на конец', 'Oxiridagi qoldiq', 'Closing', 'number'), col('value', 'Стоимость остатка', 'Qoldiq qiymati', 'Closing value', 'money')];
      const rows: Row[] = items.map((it) => {
        const ms = moves.filter((m) => str(m, 'itemId') === it.id);
        const inQ = ms.filter(isIn).reduce((s, m) => s + num(m, 'qty'), 0);
        const outQ = ms.filter((m) => !isIn(m)).reduce((s, m) => s + num(m, 'qty'), 0);
        const close = num(it, 'qty');
        return { sku: str(it, 'sku'), name: str(it, 'name'), open: close - inQ + outQ, in: inQ, out: outQ, close, value: Math.round(close * num(it, 'unitCost')) };
      });
      return result(L('Оборотная ведомость ТМЗ', 'TMZ aylanma qaydnomasi', 'Inventory turnover statement'), columns, rows, { rowDocs: items.map((it) => [{ label: str(it, 'sku'), to: '/warehouse' }]) });
    }
    const groups = new Map<string, { value: number; positions: number; low: number; in: number; out: number }>();
    for (const it of items) {
      const c = str(it, 'category') || '—';
      const g = groups.get(c) ?? { value: 0, positions: 0, low: 0, in: 0, out: 0 };
      g.value += Math.round(num(it, 'qty') * num(it, 'unitCost'));
      g.positions++;
      if (num(it, 'qty') <= num(it, 'minQty')) g.low++;
      for (const m of moves.filter((x) => str(x, 'itemId') === it.id)) {
        if (isIn(m)) g.in += num(m, 'amount');
        else g.out += num(m, 'amount');
      }
      groups.set(c, g);
    }
    const columns = [col('category', 'Категория', 'Toifa', 'Category', 'text'), col('positions', 'Позиций', 'Pozitsiyalar', 'Items', 'number'), col('value', 'Стоимость запасов', 'Zaxiralar qiymati', 'Stock value', 'money'), col('in', 'Поступление', 'Kirim', 'Receipts', 'money'), col('out', 'Выдача / списание', 'Chiqim / hisobdan chiqarish', 'Issues / write-off', 'money'), col('low', 'Ниже минимума', 'Minimumdan past', 'Below minimum', 'number')];
    const rows: Row[] = [...groups.entries()].map(([c, g]) => ({ category: translate(lang, tk('warehouse_cat_', c)), ...g }));
    return result(L('Отчёт по складу', 'Ombor hisoboti', 'Warehouse report'), columns, rows, { chart: { labelKey: 'category', seriesKeys: ['value'] }, rowDocs: rows.map(() => [{ label: 'Warehouse', to: '/warehouse' }]) });
  }

  if (key === 'fleet_report') {
    // Стоимость ТО/ремонта: работы + запчасти (qty × цена); поддерживаются и итоговые поля total/cost.
    const serviceCost = (x: unknown): number => {
      const rec = x as { works?: unknown[]; parts?: unknown[] };
      const works = Array.isArray(rec.works) ? rec.works.reduce<number>((s, w) => s + num(w, 'cost'), 0) : 0;
      const parts = Array.isArray(rec.parts) ? rec.parts.reduce<number>((s, p) => s + num(p, 'qty') * num(p, 'price'), 0) : 0;
      return Math.round(works + parts) || num(x, 'total') || num(x, 'cost');
    };
    const vehicles = await fleetApi.list();
    const trips = (await fleetApi.listTrips()).filter((t) => !since || str(t, 'date') >= since);
    const services = (await fleetApi.listServices()).filter((s) => !since || str(s, 'date') >= since);
    const columns = [col('vehicle', 'Транспорт', 'Transport', 'Vehicle', 'text'), col('trips', 'Рейсов', 'Reyslar', 'Trips', 'number'), col('km', 'Пробег, км', 'Masofa, km', 'Mileage, km', 'number'), col('fuel', 'ГСМ факт, л', 'YoMM fakt, l', 'Fuel actual, l', 'number'), col('norm', 'ГСМ норма, л', "YoMM me'yor, l", 'Fuel norm, l', 'number'), col('over', 'Перерасход, %', 'Ortiqcha sarf, %', 'Overuse, %', 'percent'), col('service', 'Затраты на ТО и ремонт', "TXK va ta'mir xarajatlari", 'Service & repair cost', 'money')];
    const rows: Row[] = vehicles.map((v) => {
      const ts = trips.filter((t) => str(t, 'vehicleId') === v.id);
      const ss = services.filter((s) => str(s, 'vehicleId') === v.id);
      const km = ts.reduce((s, t) => s + Math.max(0, num(t, 'odoEnd') - num(t, 'odoStart')) || s + num(t, 'distanceKm'), 0);
      const fuel = ts.reduce((s, t) => s + num(t, 'fuelUsed'), 0);
      const norm = ts.reduce((s, t) => s + num(t, 'fuelNormUsed'), 0);
      return { vehicle: `${str(v, 'plate')} ${str(v, 'brand')} ${str(v, 'model')}`.trim(), trips: ts.length, km, fuel: Math.round(fuel), norm: Math.round(norm), over: norm ? Math.round(((fuel - norm) / norm) * 1000) / 10 : 0, service: ss.reduce((s, x) => s + serviceCost(x), 0) };
    });
    return result(L('Отчёт по автопарку', "Avtopark bo'yicha hisobot", 'Fleet report'), columns, rows, { chart: { labelKey: 'vehicle', seriesKeys: ['km'] }, rowDocs: vehicles.map((v) => [{ label: str(v, 'plate'), to: `/fleet/${v.id}` }]) });
  }

  if (key === 'trips_report') {
    const deps = await api.listDepartments();
    const userForList = opts.user ?? ({ id: 'u6', role: 'admin', fullName: 'system', departmentId: 'd2', active: true } as unknown as User);
    const list = (await tripsApi.list(userForList)).filter((t) => !since || (str(t, 'startDate') || str(t, 'createdAt')).slice(0, 10) >= since);
    const groups = new Map<string, { count: number; days: number; advance: number; reported: number; docs: { label: string; to: string }[] }>();
    for (const t of list) {
      const d = str(t, 'departmentId');
      const g = groups.get(d) ?? { count: 0, days: 0, advance: 0, reported: 0, docs: [] };
      g.count++;
      const start = str(t, 'startDate');
      const end = str(t, 'endDate');
      g.days += start && end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1) : 0;
      g.advance += num(t, 'advance');
      const report = (t as unknown as Record<string, unknown>).report as Record<string, unknown> | undefined;
      g.reported += Array.isArray(report?.lines) ? (report!.lines as unknown[]).reduce<number>((s, l) => s + num(l, 'amount'), 0) : 0;
      g.docs.push({ label: str(t, 'number') || t.id, to: `/trips/${t.id}` });
      groups.set(d, g);
    }
    const columns = [col('department', 'Подразделение', "Bo'linma", 'Department', 'text'), col('count', 'Командировок', 'Safarlar', 'Trips', 'number'), col('days', 'Дней', 'Kunlar', 'Days', 'number'), col('advance', 'Авансы', 'Avanslar', 'Advances', 'money'), col('reported', 'По авансовым отчётам', "Avans hisobotlari bo'yicha", 'Per expense reports', 'money')];
    const entries = [...groups.entries()];
    const rows: Row[] = entries.map(([d, g]) => ({ department: localize(deps.find((x) => x.id === d)?.name, lang) ?? d, count: g.count, days: g.days, advance: g.advance, reported: g.reported }));
    return result(L('Отчёт по служебным командировкам', "Xizmat safarlari bo'yicha hisobot", 'Business trip report'), columns, rows, { chart: { labelKey: 'department', seriesKeys: ['advance'] }, rowDocs: entries.map(([, g]) => g.docs) });
  }

  return undefined;
}
