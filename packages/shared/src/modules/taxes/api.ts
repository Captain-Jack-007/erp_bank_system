// API модуля «Налоги и налогообложение» (ТЗ 4.2.17).
// Расчёт: к уплате = max(0, база × ставка × коэффициент периода − зачёт). Если ставка различается по объектам
// (имущество 1,5%/3%, земля — за 1 га, вода — за 1 м³, НДФЛ по аренде), налог считается по каждой строке реестра.
import { clone, delay, emit, historyEvent, nextNumber, now, today } from '../../bus';
import { audit } from '../../audit';
import { tk, translate } from '../../i18n';
import { matches, registerSearchProvider } from '../../search';
import { can } from '../../security';
import { integrationHub } from '../../services/integrations';
import type { ID, Role, User } from '../../types';
import { taxReturns, taxSettings } from './data';
import { setTaxRecalcHandler, TAX_BANK_TIN, taxPeriodEnd, taxPeriodMonths, taxRateFor, taxRegistryApi, taxRegistryLines } from './registry';
import type { TaxCalculation, TaxOverview, TaxRateTax, TaxReconAct, TaxReturn, TaxReturnStatus, TaxReturnView, TaxSetting, TaxType } from './types';
import { apiError } from '../../errors';

export * from './registry';

const db = {
  settings: clone(taxSettings),
  returns: clone(taxReturns),
};

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export function taxCalculate(ret: Pick<TaxReturn, 'baseLines' | 'credits'>, setting: TaxSetting): TaxCalculation {
  const perLine = ret.baseLines.length > 0 && ret.baseLines.every((l) => l.tax !== undefined);
  const base = perLine ? sum(ret.baseLines.map((l) => l.amount)) : Math.max(0, sum(ret.baseLines.map((l) => l.amount)));
  const gross = perLine ? Math.round(sum(ret.baseLines.map((l) => l.tax ?? 0)) * setting.factor) : Math.round((base * setting.rate * setting.factor) / 100);
  const credits = Math.max(0, ret.credits);
  return { base, rate: setting.rate, factor: setting.factor, gross, credits, amount: Math.max(0, gross - credits), calculatedAt: now() };
}

const baseSetting = (type: TaxType) => db.settings.find((s) => s.type === type)!;
/** Ставка из реестра ставок НК (с периодами действия) приоритетнее демо-настройки вида налога (PR-TAX-030/032). */
const RATE_REGISTRY_TAX: Partial<Record<TaxType, TaxRateTax>> = { vat: 'vat', profit: 'profit', rent_pit: 'pit_rent', property: 'property' };
function setting(type: TaxType, period?: string): TaxSetting {
  const s = baseSetting(type);
  const rt = RATE_REGISTRY_TAX[type];
  if (!rt || !period) return s;
  const r = taxRateFor(rt, '*', taxPeriodEnd(period));
  return r ? { ...s, rate: r.value } : s;
}

/** Заполнить строки расчёта из реестров/ABS (для видов налогов, ведущихся по реестрам). */
function fillLines(r: TaxReturn): boolean {
  const reg = taxRegistryLines(r.type, r.period);
  if (!reg) return false;
  r.baseLines = reg.lines;
  if (reg.credits !== undefined) r.credits = reg.credits;
  if (reg.creditsLabel) r.creditsLabel = reg.creditsLabel;
  r.source = 'registry';
  return true;
}

// Расчёты, ведущиеся по реестрам, заполняются при загрузке демо-данных.
for (const r of db.returns) if (r.source === 'registry') fillLines(r);

// Возвраты в статусах «рассчитан» и далее получают расчёт при загрузке демо-данных.
// Для принятых отчётов демо-платёж равен рассчитанной сумме (полностью оплачены).
for (const r of db.returns) {
  if (r.status === 'draft') continue;
  r.calc = { ...taxCalculate(r, setting(r.type, r.period)), calculatedAt: r.history[0]?.at ?? now() };
  if (r.status === 'accepted' && r.payments[0]) r.payments[0].amount = r.calc.amount;
}

// Мониторинг (PR-TAX-057…060): изменение реестра пересчитывает открытые расчёты этого вида налога.
setTaxRecalcHandler((tax, userId) => {
  const out: string[] = [];
  for (const r of db.returns) {
    if (r.type !== tax || r.source !== 'registry' || (r.status !== 'draft' && r.status !== 'calculated')) continue;
    fillLines(r);
    if (r.status === 'calculated') {
      r.calc = taxCalculate(r, setting(r.type, r.period));
      r.history.push(historyEvent(userId ?? 'system', 'commented', `@taxes_hist_autoRecalc|${r.calc.amount}`));
    }
    out.push(r.number);
  }
  return out;
});

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso.slice(0, 10)).getTime() - new Date(fromIso.slice(0, 10)).getTime()) / 86_400_000);
}

export function taxView(r: TaxReturn, at: string = today()): TaxReturnView {
  const amount = r.calc?.amount ?? 0;
  const paid = sum(r.payments.map((p) => p.amount));
  const outstanding = Math.max(0, amount - paid);
  const daysLeft = daysBetween(at, r.dueDate);
  const notFiled = r.status === 'draft' || r.status === 'calculated';
  return {
    ...r,
    base: sum(r.baseLines.map((l) => l.amount)),
    amount,
    paid,
    outstanding,
    daysLeft,
    overdue: daysLeft < 0 && (notFiled || outstanding > 0),
  };
}

/** Роли с правом «изменение» на модуль налогов по умолчанию (фактическая проверка — can(user, 'taxes', 'edit')). */
export const TAXES_ACTION_ROLES: Role[] = ['accountant', 'finance', 'tax_officer', 'admin'];

function assertCanAct(user: User) {
  if (!can(user, 'taxes', 'edit')) throw apiError('FORBIDDEN');
}

// Глобальный поиск: налоговые отчёты (номер, период, вид налога).
registerSearchProvider((q, lang) =>
  db.returns
    .filter((r) => matches(q, r.number, r.period, translate(lang, tk('taxes_type_', r.type))))
    .map((r) => ({
      group: 'taxes_title',
      title: `${r.number} · ${translate(lang, tk('taxes_type_', r.type))} · ${r.period}`,
      subtitle: translate(lang, tk('taxes_status_', r.status)),
      to: `/taxes/${r.id}`,
    })),
);

function find(id: ID): TaxReturn {
  const r = db.returns.find((x) => x.id === id);
  if (!r) throw apiError('RETURN_NOT_FOUND');
  return r;
}

/** Системные комментарии истории хранятся кодом «@ключ_словаря|аргументы» и переводятся на экране. */
function setStatus(r: TaxReturn, status: TaxReturnStatus, user: User, comment?: string) {
  r.status = status;
  r.history.push(historyEvent(user.id, 'status_changed', comment));
}

/** Код формы налоговой отчётности (демо-коды формата ГНК). */
export const TAX_FORM_CODES: Record<TaxType, string> = {
  vat: 'VAT-M', profit: 'PRF', property: 'PRP-Q', social: 'SOC-M', pit: 'PIT-M', withholding: 'WHT-M', land: 'LND-Q', water: 'WTR-Q', rent_pit: 'PIT-RENT',
};

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Файл отчёта в формате налогового органа (XML, PR-TAX-054). */
export function taxGnkXml(r: TaxReturn): { fileName: string; xml: string } {
  const calc = r.calc ?? taxCalculate(r, setting(r.type, r.period));
  const form = r.type === 'profit' ? (r.period.includes('-Q') ? 'PRF-Q' : 'PRF-M') : TAX_FORM_CODES[r.type];
  const lines = r.baseLines
    .map((l, i) => `    <Line n="${i + 1}" branch="${xmlEsc(l.branchKey ?? 'HO')}" ref="${xmlEsc(l.ref ?? '')}" unit="${l.unit ?? 'uzs'}" base="${l.amount}"${l.tax !== undefined ? ` tax="${l.tax}"` : ''}>${xmlEsc(l.label.ru)}</Line>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Declaration xmlns="urn:soliq.uz:declaration:demo" form="${form}" version="2.1">
  <Header>
    <TIN>${TAX_BANK_TIN}</TIN>
    <Taxpayer>АКБ «Народный банк» (демо)</Taxpayer>
    <Period>${r.period}</Period>
    <Number>${r.number}</Number>
    <Created>${now()}</Created>
  </Header>
  <Lines count="${r.baseLines.length}">
${lines}
  </Lines>
  <Totals base="${calc.base}" rate="${calc.rate}" factor="${calc.factor}" gross="${calc.gross}" credits="${calc.credits}" payable="${calc.amount}"/>
</Declaration>
`;
  return { fileName: `${form}_${TAX_BANK_TIN}_${r.period}_${r.number}.xml`, xml };
}

function dueDateFor(type: TaxType, period: string): string {
  const last = taxPeriodMonths(period).at(-1)!;
  const [y, m] = last.split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const day = baseSetting(type).dueDay;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Акты сверки с бюджетом по филиалам за месяц (PR-TAX-063). */
export function taxReconActs(month: string): TaxReconAct[] {
  const rel = db.returns.filter((r) => taxPeriodMonths(r.period).at(-1) === month && r.calc);
  const acts = new Map<string, TaxReconAct>();
  for (const r of rel) {
    const weights = new Map<string, number>();
    for (const l of r.baseLines) {
      const w = l.tax !== undefined ? l.tax : l.amount;
      if (w <= 0) continue;
      const b = l.branchKey ?? 'HO';
      weights.set(b, (weights.get(b) ?? 0) + w);
    }
    if (!weights.size) weights.set('HO', 1);
    const total = sum([...weights.values()]);
    const accrued = r.calc!.amount;
    const paid = sum(r.payments.map((p) => p.amount));
    const keys = [...weights.keys()];
    let accLeft = accrued;
    let paidLeft = paid;
    keys.forEach((b, i) => {
      const share = weights.get(b)! / total;
      const a = i === keys.length - 1 ? accLeft : Math.round(accrued * share);
      const p = i === keys.length - 1 ? paidLeft : Math.round(paid * share);
      accLeft -= a;
      paidLeft -= p;
      const act = acts.get(b) ?? { id: `ACT-${b}-${month}`, branchKey: b, month, rows: [], accrued: 0, paid: 0, difference: 0 };
      const row = act.rows.find((x) => x.tax === r.type);
      if (row) {
        row.accrued += a;
        row.paid += p;
        row.difference = row.accrued - row.paid;
      } else act.rows.push({ tax: r.type, accrued: a, paid: p, difference: a - p });
      act.accrued += a;
      act.paid += p;
      act.difference = act.accrued - act.paid;
      acts.set(b, act);
    });
  }
  return [...acts.values()].sort((a, b) => (a.branchKey === 'HO' ? -1 : b.branchKey === 'HO' ? 1 : a.branchKey.localeCompare(b.branchKey)));
}

export interface TaxFilingView {
  exchangeId: string;
  status: string;
  fileName: string;
  at: string;
  receipt?: string;
  attempts: number;
}

export const taxesApi = {
  ...taxRegistryApi,

  listSettings: () => delay(db.settings.map((x) => setting(x.type, today().slice(0, 7)))),

  getOverview(): Promise<TaxOverview> {
    const views = db.returns.map((r) => taxView(r));
    const month = today().slice(0, 7);
    // Срок в этом месяце: ещё не подан или не оплачен полностью. Сумма — остаток к уплате;
    // для нерассчитанного черновика — оценка по текущей базе.
    const dueNow = views.filter((v) => v.dueDate.slice(0, 7) === month && (v.status === 'draft' || v.status === 'calculated' || v.outstanding > 0));
    const toPay = (v: TaxReturnView) => (v.calc ? v.outstanding : taxCalculate(v, setting(v.type, v.period)).amount);
    const ytd = views.filter((v) => v.period.startsWith('2026'));
    return delay({
      dueThisMonth: { count: dueNow.length, amount: sum(dueNow.map(toPay)) },
      overdue: views.filter((v) => v.overdue).length,
      liabilityYtd: sum(ytd.map((v) => v.amount)),
      paidYtd: sum(ytd.map((v) => v.paid)),
      outstanding: sum(views.map((v) => v.outstanding)),
    });
  },

  listReturns(filter: { type?: TaxType; status?: TaxReturnStatus; branchKey?: string } = {}): Promise<TaxReturnView[]> {
    return delay(
      db.returns
        .filter((r) => !filter.type || r.type === filter.type)
        .filter((r) => !filter.status || r.status === filter.status)
        .filter((r) => !filter.branchKey || r.baseLines.some((l) => (l.branchKey ?? 'HO') === filter.branchKey))
        .map((r) => taxView(r))
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
    );
  },

  /** Налоговый календарь: незакрытые обязательства по сроку. */
  calendar(): Promise<TaxReturnView[]> {
    return delay(
      db.returns
        .map((r) => taxView(r))
        .filter((v) => v.status !== 'accepted' || v.outstanding > 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    );
  },

  getReturn: (id: ID) => delay(db.returns.find((r) => r.id === id) ? taxView(find(id)) : undefined),

  /** Состояние отправки файла отчёта в налоговый орган (журнал интеграционной шины). */
  async getFiling(id: ID): Promise<TaxFilingView | undefined> {
    const r = db.returns.find((x) => x.id === id);
    if (!r?.filing) return delay(undefined);
    const ex = await integrationHub.getExchange(r.filing.exchangeId);
    const receipt = (ex?.response as { receipt?: string } | undefined)?.receipt;
    return delay({ ...r.filing, status: ex?.status ?? r.filing.status, attempts: ex?.attempts.length ?? 0, ...(receipt ? { receipt } : {}) });
  },

  async updateBaseLine(id: ID, index: number, amount: number, user: User): Promise<void> {
    assertCanAct(user);
    const r = find(id);
    if (r.status === 'submitted' || r.status === 'accepted') throw apiError('RETURN_IS_FILED');
    const line = r.baseLines[index];
    if (!line || !Number.isFinite(amount)) throw apiError('INVALID_LINE');
    const before = line.amount;
    line.amount = Math.round(amount);
    if (line.tax !== undefined) delete line.tax; // ручная правка — расчёт по общей ставке
    audit.log({ action: 'update', entity: 'tax_return', entityId: r.id, changes: [{ field: `baseLines[${index}]`, from: String(before), to: String(line.amount) }] });
    if (r.status === 'calculated') {
      delete r.calc;
      setStatus(r, 'draft', user, '@taxes_hist_baseChanged');
    }
    emit();
    await delay(null);
  },

  async updateCredits(id: ID, credits: number, user: User): Promise<void> {
    assertCanAct(user);
    const r = find(id);
    if (r.status === 'submitted' || r.status === 'accepted') throw apiError('RETURN_IS_FILED');
    r.credits = Math.max(0, Math.round(credits));
    if (r.status === 'calculated') {
      delete r.calc;
      setStatus(r, 'draft', user, '@taxes_hist_creditsChanged');
    }
    emit();
    await delay(null);
  },

  /** Перезаполнить строки из реестров / ABS (PR-TAX-001, PR-TAX-009). */
  async fillFromRegistry(id: ID, user: User): Promise<void> {
    assertCanAct(user);
    const r = find(id);
    if (r.status === 'submitted' || r.status === 'accepted') throw apiError('RETURN_IS_FILED');
    if (!fillLines(r)) throw apiError('NO_REGISTRY_FOR_THIS_TAX');
    if (r.status === 'calculated') r.calc = taxCalculate(r, setting(r.type, r.period));
    r.history.push(historyEvent(user.id, 'commented', `@taxes_hist_filled|${r.baseLines.length}`));
    audit.log({ action: 'update', entity: 'tax_return', entityId: r.id, details: `Заполнено из реестров: ${r.baseLines.length} строк` });
    emit();
    await delay(null);
  },

  /**
   * Сформировать (или обновить) расчёт по реестрам за период: ежемесячный/квартальный расчёт налога на прибыль (PR-TAX-050),
   * сводный ежемесячный расчёт НДС по всем филиалам (PR-TAX-065), земля, вода, имущество, НДФЛ по аренде.
   */
  async generateReturn(type: TaxType, period: string, user: User): Promise<TaxReturnView> {
    assertCanAct(user);
    let r = db.returns.find((x) => x.type === type && x.period === period);
    if (r && (r.status === 'submitted' || r.status === 'accepted')) throw apiError('RETURN_IS_FILED');
    if (!r) {
      r = { id: `tx${Date.now() % 1_000_000}${db.returns.length}`, number: nextNumber('TX'), type, period, dueDate: dueDateFor(type, period), status: 'draft', baseLines: [], credits: 0, payments: [], source: 'registry', history: [historyEvent(user.id, 'created')] };
      db.returns.push(r);
    }
    if (!fillLines(r)) throw apiError('NO_REGISTRY_FOR_THIS_TAX');
    if (r.status === 'calculated') r.calc = taxCalculate(r, setting(r.type, r.period));
    r.history.push(historyEvent(user.id, 'commented', `@taxes_hist_filled|${r.baseLines.length}`));
    audit.log({ action: 'create', entity: 'tax_return', entityId: r.id, details: `${type} ${period}: ${r.baseLines.length} строк` });
    emit();
    return delay(taxView(r));
  },

  async calculate(id: ID, user: User): Promise<void> {
    assertCanAct(user);
    const r = find(id);
    if (r.status === 'submitted' || r.status === 'accepted') throw apiError('RETURN_IS_FILED');
    r.calc = taxCalculate(r, setting(r.type, r.period));
    setStatus(r, 'calculated', user, `@taxes_hist_calculated|${r.calc.amount}`);
    audit.log({ action: 'update', entity: 'tax_return', entityId: r.id, details: `Расчёт: ${r.calc.amount}` });
    emit();
    await delay(null);
  },

  /** Централизованная сдача (PR-TAX-042): статус «отправлен» и передача файла ГНК через интеграционную шину. */
  async submit(id: ID, user: User): Promise<void> {
    assertCanAct(user);
    const r = find(id);
    if (r.status !== 'calculated' || !r.calc) throw apiError('CALCULATE_FIRST');
    setStatus(r, 'submitted', user, '@taxes_hist_submitted');
    const { fileName } = taxGnkXml(r);
    const rec = await integrationHub.call('soliq', 'report.submit', { form: TAX_FORM_CODES[r.type], period: r.period, tin: TAX_BANK_TIN, controlSum: r.calc.amount, lines: r.baseLines.length, number: r.number }, { userId: user.id, background: true, idempotencyKey: `tax-${r.id}-${r.calc.calculatedAt}` });
    r.filing = { exchangeId: rec.id, status: rec.status, fileName, at: now() };
    audit.log({ action: 'submit', entity: 'tax_return', entityId: r.id, details: `${fileName} → soliq (${rec.id})` });
    emit();
    await delay(null);
  },

  /** Повторная отправка файла, если обмен завершился ошибкой. */
  async resendFiling(id: ID, user: User): Promise<void> {
    assertCanAct(user);
    const r = find(id);
    if (!r.filing) throw apiError('NOT_FILED');
    await integrationHub.retry(r.filing.exchangeId, user.id);
    emit();
  },

  /** Отметка о принятии отчёта налоговым органом (в реальной системе — по квитанции из интеграции). */
  async accept(id: ID, user: User): Promise<void> {
    assertCanAct(user);
    const r = find(id);
    if (r.status !== 'submitted') throw apiError('NOT_SUBMITTED');
    setStatus(r, 'accepted', user, '@taxes_hist_accepted');
    emit();
    await delay(null);
  },

  async pay(id: ID, amount: number, user: User): Promise<void> {
    assertCanAct(user);
    const r = find(id);
    if (!r.calc) throw apiError('CALCULATE_FIRST');
    if (!(amount > 0)) throw apiError('INVALID_AMOUNT');
    const outstanding = taxView(r).outstanding;
    if (Math.round(amount) > outstanding) throw apiError('AMOUNT_EXCEEDS_OUTSTANDING');
    const reference = nextNumber('PP');
    r.payments.push({ date: today(), amount: Math.round(amount), reference });
    r.history.push(historyEvent(user.id, 'commented', `@taxes_hist_payment|${Math.round(amount)}|${reference}`));
    audit.log({ action: 'create', entity: 'tax_payment', entityId: r.id, details: `${reference}: ${Math.round(amount)}` });
    emit();
    await delay(null);
  },

  gnkFile: (id: ID) => delay(taxGnkXml(find(id))),
  reconActs: (month: string) => delay(taxReconActs(month)),
};
