// Журнал бухгалтерских проводок складского контура (склад, МБП, ОС, терминалы) и передача в iABS
// через integrationHub (ТЗ PR-WMS-013/030/045/056/069, PR-FAM-036/050/054). Проводка формируется
// автоматически при проведении документа, уходит пакетом `postings.batch` и подтверждается ответом iABS.
// Подтверждённые проводки формируют «остаток по балансу iABS» для ежедневной сверки с учётными данными.
import { clone, delay, emit, nextId, nextNumber, now, today } from '../../bus';
import { INTEGRATION_SYSTEMS, integrationHub } from '../../services/integrations';
import type { ID, Localized, User } from '../../types';
import type { WmsModule, WmsPosting, WmsPostingEntry } from './types';

const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

/** Демо-план счетов (8 знаков — формат iABS). */
export const WMS_ACCOUNTS: Record<string, Localized> = {
  '19909000': L('ТМЗ: канцелярские и хозяйственные товары', 'TMZ: kantselyariya va xo‘jalik tovarlari', 'Inventory: office and household supplies'),
  '19911000': L('ТМЗ: бланки строгой отчётности', 'TMZ: qat’iy hisobdagi blankalar', 'Inventory: controlled forms'),
  '19913000': L('ТМЗ: расходные материалы ИТ', 'TMZ: AT sarf materiallari', 'Inventory: IT consumables'),
  '19915000': L('ТМЗ: средства безопасности и инкассации', 'TMZ: xavfsizlik va inkassatsiya vositalari', 'Inventory: security and cash-in-transit'),
  '19917000': L('МБП на складе', 'Omborda MBP', 'Low-value items in stock'),
  '19907000': L('Капитальные вложения: ОС к вводу', 'Kapital qo‘yilmalar: foydalanishga beriladigan AV', 'Capital investments: assets to commission'),
  '16505000': L('Строительство, реконструкция, модернизация', 'Qurilish, rekonstruksiya, modernizatsiya', 'Construction and modernization'),
  '96335000': L('МБП в эксплуатации (внебаланс)', 'Foydalanishdagi MBP (balansdan tashqari)', 'Low-value items in use (off-balance)'),
  '96339000': L('Ценности на контроле (внебаланс)', 'Nazoratdagi qimmatliklar (balansdan tashqari)', 'Controlled valuables (off-balance)'),
  '96399000': L('Корреспондирующий внебалансовый счёт', 'Balansdan tashqari korrespondent hisob', 'Off-balance contra account'),
  '56802000': L('Хозяйственные расходы', 'Xo‘jalik xarajatlari', 'Administrative expenses'),
  '56804000': L('Расходные материалы ИТ', 'AT sarf materiallari', 'IT consumables expense'),
  '56806000': L('Расход бланков', 'Blankalar sarfi', 'Forms expense'),
  '56812000': L('МБП, переданные в эксплуатацию', 'Foydalanishga berilgan MBP', 'Low-value items put into use'),
  '56320000': L('Расходы на амортизацию', 'Amortizatsiya xarajatlari', 'Depreciation expense'),
  '56920000': L('Убыток от выбытия ОС', 'AV chiqib ketishidan zarar', 'Loss on asset disposal'),
  '29802000': L('Расчёты с поставщиками', 'Yetkazib beruvchilar bilan hisob-kitoblar', 'Accounts payable'),
  '29862000': L('НДС к уплате', 'To‘lanadigan QQS', 'VAT payable'),
  '19997000': L('Недостачи к взысканию', 'Undiriladigan kamomadlar', 'Shortages receivable'),
  '19901000': L('Расчёты с покупателями', 'Xaridorlar bilan hisob-kitoblar', 'Accounts receivable'),
  '45994000': L('Прочие доходы (излишки)', 'Boshqa daromadlar (ortiqchalar)', 'Other income (surpluses)'),
  '45920000': L('Доход от реализации ОС', 'AV sotishdan daromad', 'Gain on asset sale'),
  '45930000': L('Доход от аренды', 'Ijara daromadi', 'Lease income'),
  '16501000': L('ОС: здания и сооружения', 'AV: binolar va inshootlar', 'PP&E: buildings'),
  '16503000': L('ОС: мебель и офисное оборудование', 'AV: mebel va ofis jihozlari', 'PP&E: furniture and office equipment'),
  '16507000': L('ОС: транспортные средства', 'AV: transport vositalari', 'PP&E: vehicles'),
  '16509000': L('ОС: компьютерная техника', 'AV: kompyuter texnikasi', 'PP&E: computers'),
  '16511000': L('ОС: банкоматы и терминалы', 'AV: bankomatlar va terminallar', 'PP&E: ATMs and terminals'),
  '16513000': L('ОС: системы безопасности', 'AV: xavfsizlik tizimlari', 'PP&E: security systems'),
  '16521000': L('Право пользования (аренда, МСФО 16)', 'Foydalanish huquqi (ijara, MHXS 16)', 'Right-of-use assets (IFRS 16)'),
  '16599000': L('Накопленная амортизация ОС', 'AV jamg‘arilgan amortizatsiyasi', 'Accumulated depreciation'),
  '30908000': L('Дооценка ОС', 'AV qayta baholash', 'Revaluation surplus'),
  '16103000': L('Межфилиальные расчёты', 'Filiallararo hisob-kitoblar', 'Inter-branch settlements'),
  '29840000': L('Обязательства по аренде', 'Ijara majburiyatlari', 'Lease liabilities'),
  '96501000': L('ОС, полученные в аренду (внебаланс)', 'Ijaraga olingan AV (balansdan tashqari)', 'Leased-in assets (off-balance)'),
};

export const accountName = (acc: string): Localized => WMS_ACCOUNTS[acc] ?? L(acc, acc, acc);

// ---------- Регистрация операций iABS, нужных складу/ОС/терминалам ----------
// cross-module (P2-WMS): операции добавляются к системе 'iabs' интеграционной шины при загрузке модуля.
(function registerIabsOperations() {
  const sys = INTEGRATION_SYSTEMS.find((s) => s.id === 'iabs');
  if (!sys) return;
  const has = (id: string) => sys.operations.some((o) => o.id === id);
  const ack = (p: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ accepted: true, ref: `IABS-${String(Math.abs(JSON.stringify(p).length * 7919) % 1e6).padStart(6, '0')}`, ...extra });
  const need = (p: Record<string, unknown>, keys: string[]) => {
    const miss = keys.filter((k) => p[k] === undefined || p[k] === null || p[k] === '');
    return miss.length ? { code: 'validation' as const, message: `required: ${miss.join(', ')}` } : null;
  };
  if (!has('balances.get'))
    sys.operations.push({
      id: 'balances.get', direction: 'in', schemaVersion: '1.0', name: L('Остатки по балансовым счетам (ТМЗ, МБП, ОС)', 'Balans hisoblari qoldiqlari (TMZ, MBP, AV)', 'Account balances (inventory, LVI, PP&E)'),
      sample: () => ({ date: '2026-10-18', accounts: ['19909000', '16509000'] }),
      validate: (p) => need(p, ['date']),
      respond: (p) => ({ date: p.date, accounts: Array.isArray(p.accounts) ? p.accounts.length : 0 }),
    });
  const terminalOp = (id: string, ru: string, uz: string, en: string, keys: string[]) =>
    !has(id) &&
    sys.operations.push({
      id, direction: 'out', schemaVersion: '1.0', name: L(ru, uz, en),
      sample: () => ({ serialNo: 'A930-24-000123', inventoryNo: 'OS-11-000901', paySystem: 'humo', flag: 'HUMO-POS', cbu: '01001' }),
      validate: (p) => need(p, keys),
      respond: (p) => ack(p, { terminalId: `T-${String(p.serialNo ?? '').slice(-6)}` }),
    });
  terminalOp('terminals.register', 'Учёт терминалов: регистрация (связь серийный ↔ инв. номер)', 'Terminallar hisobi: ro‘yxatga olish', 'Terminal accounting: register', ['serialNo', 'inventoryNo', 'paySystem', 'flag']);
  terminalOp('terminals.update', 'Учёт терминалов: изменение карточки', 'Terminallar hisobi: kartochkani o‘zgartirish', 'Terminal accounting: update card', ['serialNo', 'inventoryNo']);
  terminalOp('terminals.move', 'Учёт терминалов: перемещение между ЦБУ', 'Terminallar hisobi: BXMlar o‘rtasida ko‘chirish', 'Terminal accounting: move between branches', ['serialNo', 'inventoryNo', 'cbu']);
  terminalOp('terminals.status', 'Учёт терминалов: смена статуса', 'Terminallar hisobi: holatni o‘zgartirish', 'Terminal accounting: status change', ['serialNo', 'inventoryNo', 'status']);
  terminalOp('terminals.delete', 'Учёт терминалов: удаление списанного', 'Terminallar hisobi: hisobdan chiqarilganini o‘chirish', 'Terminal accounting: delete written-off', ['serialNo', 'inventoryNo']);
  if (!sys.modules.includes('terminals')) sys.modules.push('terminals');
})();

// ---------- Журнал проводок ----------

const postings: WmsPosting[] = [];
/** Остатки iABS на начало демо-периода по счетам (устанавливаются модулями при загрузке). */
const iabsOpening = new Map<string, number>();

export interface WmsPostInput {
  module: WmsModule;
  docType: string;
  docId: ID;
  docNumber: string;
  entries: WmsPostingEntry[];
  requireSign?: boolean;
  date?: string;
}

function toIabs(p: WmsPosting) {
  return { batch: p.number, module: p.module, doc: p.docNumber, entries: p.entries.map((e) => ({ debit: e.debit, credit: e.credit, amount: e.amount, mvz: e.costCenterId })), controlSum: p.entries.reduce((s, e) => s + e.amount, 0) };
}

async function send(p: WmsPosting, userId: ID): Promise<void> {
  p.status = 'sending';
  emit();
  try {
    const r = await integrationHub.call('iabs', 'postings.batch', toIabs(p), { userId, idempotencyKey: `wms-${p.id}` });
    p.exchangeId = r.id;
    if (r.status === 'success') {
      p.status = 'confirmed';
      p.confirmedAt = now();
      delete p.error;
    } else if (r.status === 'queued') {
      p.status = 'queued';
      p.error = r.error ?? 'unavailable';
    } else {
      p.status = 'error';
      p.error = r.errorMessage ?? r.error ?? r.status;
    }
  } catch (e) {
    p.status = 'error';
    p.error = e instanceof Error ? e.message : String(e);
  }
  emit();
}

export const wmsLedger = {
  /** Сформировать проводку (сумма > 0) и, если подпись не требуется, сразу передать в iABS. */
  post(input: WmsPostInput, user: Pick<User, 'id'>): WmsPosting | undefined {
    const entries = input.entries.filter((e) => e.amount > 0).map((e) => ({ ...e, amount: Math.round(e.amount) }));
    if (!entries.length) return undefined;
    const p: WmsPosting = {
      id: nextId('wp'),
      number: nextNumber('PR'),
      date: input.date ?? today(),
      module: input.module,
      docType: input.docType,
      docId: input.docId,
      docNumber: input.docNumber,
      entries,
      amount: entries.reduce((s, e) => s + e.amount, 0),
      status: input.requireSign ? 'unsigned' : 'sending',
      ...(input.requireSign ? { requireSign: true } : {}),
      createdBy: user.id,
      createdAt: now(),
    };
    postings.push(p);
    if (!input.requireSign) void send(p, user.id);
    return p;
  },

  /** Засев демо-проводки с заданным статусом (без обмена). */
  seed(p: Omit<WmsPosting, 'id' | 'amount'> & { id?: ID }): void {
    postings.push({ ...p, id: p.id ?? nextId('wp'), amount: p.entries.reduce((s, e) => s + e.amount, 0) });
  },

  setOpening(account: string, amount: number): void {
    iabsOpening.set(account, (iabsOpening.get(account) ?? 0) + amount);
  },

  list(filter: { module?: WmsModule | ''; status?: string; docId?: ID; search?: string } = {}): Promise<WmsPosting[]> {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      postings
        .filter((p) => !filter.module || p.module === filter.module)
        .filter((p) => !filter.status || p.status === filter.status)
        .filter((p) => !filter.docId || p.docId === filter.docId)
        .filter((p) => !q || p.number.toLowerCase().includes(q) || p.docNumber.toLowerCase().includes(q) || p.entries.some((e) => e.debit.includes(q) || e.credit.includes(q)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },

  get: (id: ID): WmsPosting | undefined => postings.find((p) => p.id === id),

  /** Подписать проводку E-IMZO (ID подписи из signatureService) и передать в iABS. */
  async sign(id: ID, signatureId: ID, user: User): Promise<void> {
    const p = postings.find((x) => x.id === id);
    if (!p || p.status !== 'unsigned') throw new Error('NOT_ALLOWED');
    p.signatureId = signatureId;
    await send(p, user.id);
  },

  /** Повторная передача проводки с ошибкой / из очереди. */
  async retry(id: ID, user: User): Promise<void> {
    const p = postings.find((x) => x.id === id);
    if (!p || (p.status !== 'error' && p.status !== 'queued')) throw new Error('NOT_ALLOWED');
    if (p.exchangeId) {
      p.status = 'sending';
      emit();
      try {
        const r = await integrationHub.retry(p.exchangeId, user.id);
        if (r.status === 'success') {
          p.status = 'confirmed';
          p.confirmedAt = now();
          delete p.error;
        } else {
          p.status = r.status === 'queued' ? 'queued' : 'error';
          p.error = r.errorMessage ?? r.error ?? r.status;
        }
      } catch (e) {
        p.status = 'error';
        p.error = e instanceof Error ? e.message : String(e);
      }
      emit();
      return;
    }
    await send(p, user.id);
  },

  /** Сторно: обратная проводка (при корректировке документа). */
  reverse(id: ID, user: Pick<User, 'id'>, docNumber?: string): WmsPosting | undefined {
    const p = postings.find((x) => x.id === id);
    if (!p || p.status === 'reversed') return undefined;
    const r = wmsLedger.post({ module: p.module, docType: `${p.docType}_storno`, docId: p.docId, docNumber: docNumber ?? `${p.docNumber}-С`, entries: p.entries.map((e) => ({ ...e, debit: e.credit, credit: e.debit, text: `Сторно: ${e.text}` })) }, user);
    if (r) r.reversalOf = p.id;
    p.status = p.status === 'confirmed' ? 'confirmed' : 'reversed';
    emit();
    return r;
  },

  /** Сальдо счёта по подтверждённым iABS проводкам (+ остаток на начало). */
  iabsBalance(account: string): number {
    let s = iabsOpening.get(account) ?? 0;
    for (const p of postings) {
      if (p.status !== 'confirmed') continue;
      for (const e of p.entries) {
        if (e.debit === account) s += e.amount;
        if (e.credit === account) s -= e.amount;
      }
    }
    return s;
  },

  /** Сводка для мониторинга: незавершённые/ошибочные проводки. */
  health(module?: WmsModule) {
    const mine = postings.filter((p) => !module || p.module === module);
    return {
      total: mine.length,
      confirmed: mine.filter((p) => p.status === 'confirmed').length,
      pending: mine.filter((p) => p.status === 'sending' || p.status === 'queued' || p.status === 'unsigned').length,
      error: mine.filter((p) => p.status === 'error').length,
      todayTotal: mine.filter((p) => p.date === today()).length,
      todayConfirmed: mine.filter((p) => p.date === today() && p.status === 'confirmed').length,
    };
  },

  /** Запрос остатков iABS для ежедневной сверки (обмен фиксируется в мониторе интеграций). */
  async requestBalances(accounts: string[], userId: ID): Promise<ID | undefined> {
    try {
      const r = await integrationHub.call('iabs', 'balances.get', { date: today(), accounts }, { userId });
      return r.id;
    } catch {
      return undefined;
    }
  },

  snapshot: () => clone(postings),
};
