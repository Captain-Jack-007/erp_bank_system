// API ИИ-ассистента. Демо-реализация: распознавание интента правилами + расчёт по данным ERP,
// извлечение реквизитов регулярными выражениями, проверка договоров по чек-листу.
// Продуктив: те же методы, но через локальную LLM (данные не покидают банк). Каждый вызов пишется в журнал.
import { api } from '../../api';
import { clone, delay, emit, nextId, now, today } from '../../bus';
import { formatDate, formatMoney, procurementTotal } from '../../format';
import { localize, pick, tk, toLatin, translate } from '../../i18n';
import type { Contract, ID, Lang, User } from '../../types';
import { aiContractTexts, aiDocSamples } from './data';
import type {
  AiAnswer,
  AiAuditEntry,
  AiChatMessage,
  AiContractCheck,
  AiContractFinding,
  AiDocKind,
  AiExtractedField,
  AiRecognition,
} from './types';

const chat: AiChatMessage[] = [];
const audit: AiAuditEntry[] = [];

const L = (lang: Lang, ru: string, uz: string, en?: string) => pick(lang, ru, uz, en);

function log(user: User, action: AiAuditEntry['action'], summary: string, started: number) {
  audit.unshift({ id: nextId('ai'), at: now(), userId: user.id, action, summary: summary.slice(0, 120), durationMs: Date.now() - started + 180 });
}

// ---------- Вопросы по данным ERP ----------

async function answer(question: string, user: User, lang: Lang): Promise<AiAnswer> {
  // Узбекский апостроф пишут по-разному (o', o‘, oʻ, o’) — приводим к одному виду.
  // Узбекская кириллица: добавляем латинский вариант вопроса, чтобы сработали те же ключевые слова.
  if (lang === 'uzc') question = `${question} ${toLatin(question)}`;
  const q = ` ${question.toLowerCase().replace(/[‘’ʻʼ`´]/g, "'").replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()} `;
  const has = (...words: string[]) => words.some((w) => q.includes(w));
  /** Целое слово (рус./лат.), а не часть другого слова: «ИТ», но не «лимит». */
  const word = (...words: string[]) => words.some((w) => new RegExp(`(^|[^a-zа-я'])${w}([^a-zа-я']|$)`).test(q));

  if (has('соглас', 'kelish', 'approv', 'решени', 'qaror', 'tasdiq')) {
    const tasks = await api.listApprovals(user);
    const overdue = tasks.filter((x) => x.dueAt < now()).length;
    return {
      intent: 'approvals',
      text: tasks.length
        ? L(lang, `У вас ${tasks.length} документ(ов) на согласовании, из них просрочено: ${overdue}. Ближайшие по сроку:`, `Sizda kelishuvda ${tasks.length} ta hujjat, shundan muddati o'tgan: ${overdue}. Muddati yaqinlari:`)
        : L(lang, 'Документов на вашем согласовании нет.', "Sizning kelishuvingizda hujjatlar yo'q."),
      table: tasks.length
        ? {
            headers: [L(lang, 'Номер', 'Raqam'), L(lang, 'Документ', 'Hujjat'), L(lang, 'Срок', 'Muddat')],
            rows: tasks.slice(0, 5).map((x) => [x.number, x.title, formatDate(x.dueAt)]),
          }
        : undefined,
      links: [{ label: L(lang, 'Открыть согласования', 'Kelishuvlarni ochish'), to: '/approvals' }],
    };
  }

  if (has('просроч', "muddati o'tgan", 'overdue', 'платеж', 'оплат', "to'lov", 'kechik', 'задолж')) {
    const contracts = await api.listContracts();
    const cps = await api.listCounterparties();
    const rows = contracts.flatMap((c) =>
      c.payments.filter((p) => !p.paid && p.dueDate < today()).map((p) => ({ c, p })),
    );
    return {
      intent: 'overdue_payments',
      text: rows.length
        ? L(lang, `Найдено просроченных платежей по договорам: ${rows.length}.`, `Shartnomalar bo'yicha muddati o'tgan to'lovlar: ${rows.length} ta.`)
        : L(lang, 'Просроченных платежей нет.', "Muddati o'tgan to'lovlar yo'q."),
      table: rows.length
        ? {
            headers: [L(lang, 'Договор', 'Shartnoma'), L(lang, 'Контрагент', 'Kontragent'), L(lang, 'Срок', 'Muddat'), L(lang, 'Сумма', 'Summa')],
            rows: rows.map(({ c, p }) => [c.number, cps.find((x) => x.id === c.counterpartyId)?.name ?? '—', formatDate(p.dueDate), formatMoney(p.amount, c.currency)]),
          }
        : undefined,
      links: rows.map(({ c }) => ({ label: c.number, to: `/contracts/${c.id}` })),
    };
  }

  if (has('бюджет', 'byudjet', 'budget', 'лимит', 'limit')) {
    let lines = await api.listBudgetLines();
    if (word('ит', 'it', 'at', 'айти') || has('информационн', 'axborot texnolog')) lines = lines.filter((b) => b.code.includes('-IT-'));
    const top = [...lines].sort((a, b) => b.spent / b.planned - a.spent / a.planned);
    const risky = top.filter((b) => b.spent / b.planned >= 0.85);
    return {
      intent: 'budget',
      text: L(
        lang,
        `Исполнение бюджета по ${lines.length} статьям. Статей с исполнением 85% и выше: ${risky.length}.`,
        `${lines.length} ta modda bo'yicha byudjet ijrosi. Ijrosi 85% va undan yuqori moddalar: ${risky.length} ta.`,
      ),
      table: {
        headers: [L(lang, 'Статья', 'Modda'), L(lang, 'План', 'Reja'), L(lang, 'Факт', 'Fakt'), '%'],
        rows: top.map((b) => [`${b.code} · ${localize(b.name, lang)}`, formatMoney(b.planned), formatMoney(b.spent), `${Math.round((b.spent / b.planned) * 100)}%`]),
      },
      links: [{ label: L(lang, 'Бюджетирование', 'Byudjetlashtirish'), to: '/budgeting' }],
    };
  }

  const tinMatch = q.match(/\b\d{9}\b/);
  const cps = await api.listCounterparties();
  const nameWords = (name: string) =>
    name.replace(/[«»"]/g, ' ').toLowerCase().split(/\s+/).filter((w) => w.length >= 4 && !['mchj', 'yatt', 'llc'].includes(w));
  const cp = tinMatch ? cps.find((c) => c.tin === tinMatch[0]) : cps.find((c) => nameWords(c.name).some((w) => q.includes(w)));
  if (!cp && has('договор', 'shartnoma', 'contract')) {
    const contracts = await api.listContracts();
    const active = contracts.filter((c) => c.status === 'active');
    const pendingC = contracts.filter((c) => c.status === 'pending' || c.status === 'draft');
    const soon = active.filter((c) => {
      const days = (new Date(c.endDate).getTime() - Date.now()) / 86_400_000;
      return days >= 0 && days <= 75;
    });
    const sumUzs = active.filter((c) => c.currency === 'UZS').reduce((s, c) => s + c.amount, 0);
    const list = [...soon, ...pendingC, ...active.filter((c) => !soon.includes(c))].slice(0, 6);
    return {
      intent: 'contracts',
      text: L(
        lang,
        `Договоров в реестре: ${contracts.length}. Действующих: ${active.length} (в сумах — ${formatMoney(sumUzs)}), на согласовании или в проекте: ${pendingC.length}, истекают в ближайшие 2,5 месяца: ${soon.length}.`,
        `Reyestrda shartnomalar: ${contracts.length} ta. Amaldagi: ${active.length} ta (so'mda — ${formatMoney(sumUzs)}), kelishuvda yoki loyihada: ${pendingC.length} ta, yaqin 2,5 oyda muddati tugaydi: ${soon.length} ta.`,
      ),
      table: list.length
        ? {
            headers: [L(lang, 'Договор', 'Shartnoma'), L(lang, 'Предмет', 'Predmet'), L(lang, 'Окончание', 'Tugash'), L(lang, 'Статус', 'Holat')],
            rows: list.map((c) => [c.number, c.subject, formatDate(c.endDate), translate(lang, tk('cstatus_', c.status))]),
          }
        : undefined,
      links: [...list.map((c) => ({ label: c.number, to: `/contracts/${c.id}` })), { label: L(lang, 'Реестр договоров', 'Shartnomalar reyestri'), to: '/contracts' }],
    };
  }

  if (cp || has('контрагент', 'kontragent', 'поставщик', 'yetkazib beruvchi') || word('инн', 'stir')) {
    if (!cp)
      return {
        intent: 'counterparty_unknown',
        text: L(lang, 'Уточните контрагента: укажите ИНН (9 цифр) или название.', "Kontragentni aniqlang: STIR (9 raqam) yoki nomini kiriting."),
        links: [{ label: L(lang, 'Справочник контрагентов', "Kontragentlar ma'lumotnomasi"), to: '/master-data' }],
      };
    const contracts = (await api.listContracts({ counterpartyId: cp.id })).filter((c) => c.counterpartyId === cp.id);
    const byCurrency = new Map<string, number>();
    contracts.forEach((c) => byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + c.amount));
    const totalText = [...byCurrency].map(([cur, sum]) => formatMoney(sum, cur as 'UZS' | 'USD' | 'EUR')).join(' + ') || '0';
    return {
      intent: 'counterparty',
      text: L(
        lang,
        `${cp.name} (ИНН ${cp.tin}), рейтинг ${cp.rating}/5${cp.blocked ? ', ЗАБЛОКИРОВАН' : ''}. Договоров: ${contracts.length} на ${totalText}.`,
        `${cp.name} (STIR ${cp.tin}), reyting ${cp.rating}/5${cp.blocked ? ', BLOKLANGAN' : ''}. Shartnomalar: ${contracts.length} ta, ${totalText}.`,
      ),
      table: contracts.length
        ? {
            headers: [L(lang, 'Договор', 'Shartnoma'), L(lang, 'Предмет', 'Predmet'), L(lang, 'Сумма', 'Summa'), L(lang, 'Статус', 'Holat')],
            rows: contracts.map((c) => [c.number, c.subject, formatMoney(c.amount, c.currency), translate(lang, tk('cstatus_', c.status))]),
          }
        : undefined,
      links: contracts.map((c) => ({ label: c.number, to: `/contracts/${c.id}` })),
    };
  }

  if (has('закуп', 'xarid', 'заявк', 'ariza', 'procure')) {
    const list = await api.listProcurement();
    const pending = list.filter((p) => p.status === 'pending');
    const top = [...list].sort((a, b) => procurementTotal(b.items) - procurementTotal(a.items)).slice(0, 5);
    return {
      intent: 'procurement',
      text: L(
        lang,
        `Всего заявок на закупку: ${list.length}, на согласовании: ${pending.length} на ${formatMoney(pending.reduce((s, p) => s + procurementTotal(p.items), 0))}. Крупнейшие:`,
        `Jami xarid arizalari: ${list.length}, kelishuvda: ${pending.length} ta, ${formatMoney(pending.reduce((s, p) => s + procurementTotal(p.items), 0))}. Eng yiriklari:`,
      ),
      table: {
        headers: [L(lang, 'Номер', 'Raqam'), L(lang, 'Наименование', 'Nomi'), L(lang, 'Сумма', 'Summa')],
        rows: top.map((p) => [p.number, p.title, formatMoney(procurementTotal(p.items))]),
      },
      links: top.map((p) => ({ label: p.number, to: `/procurement/${p.id}` })),
    };
  }

  return {
    intent: 'help',
    text: L(
      lang,
      'Я могу ответить на вопросы по данным XB-ERP: документы на согласовании, просроченные платежи, исполнение бюджета, заявки на закупку, договоры и контрагенты (по названию или ИНН). Также откройте вкладки «Распознавание документов» и «Проверка договоров».',
      "Men XB-ERP ma'lumotlari bo'yicha savollarga javob bera olaman: kelishuvdagi hujjatlar, muddati o'tgan to'lovlar, byudjet ijrosi, xarid arizalari, shartnomalar va kontragentlar (nomi yoki STIR bo'yicha). Shuningdek, «Hujjatlarni tanib olish» va «Shartnomalarni tekshirish» bo'limlarini oching.",
    ),
    links: [],
  };
}

// ---------- Распознавание документов ----------

const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

export function recognizeText(text: string): AiRecognition {
  const t = text.replace(/\r/g, '');
  const upper = t.toUpperCase();
  let kind: AiDocKind = 'unknown';
  let kindConfidence = 0.4;
  if (/СЧ[ЕЁ]Т-ФАКТУРА|HISOB-FAKTURA/.test(upper)) [kind, kindConfidence] = ['invoice', 0.98];
  else if (/(^|[^А-ЯЁ])АКТ([^А-ЯЁ]|$)|DALOLATNOMA/.test(upper)) [kind, kindConfidence] = ['act', 0.95];
  else if (/ДОГОВОР|SHARTNOMA/.test(upper)) [kind, kindConfidence] = ['contract', 0.93];
  else if (/ИСХ\.|КИР\.|ВХ\.|^В\s/m.test(upper)) [kind, kindConfidence] = ['letter', 0.86];

  const fields: AiExtractedField[] = [];
  const add = (key: AiExtractedField['key'], m: RegExpMatchArray | null, confidence: number, group = 1) => {
    const v = m?.[group]?.trim();
    if (v) fields.push({ key, value: v, confidence });
  };
  add('number', t.match(/№\s*([\w\-/]+)/), 0.96);
  add('date', t.match(/(\d{2}\.\d{2}\.\d{4})/), 0.97);
  add('tin', t.match(/(?:ИНН|STIR)\s*(\d{9})/), 0.99);
  add('counterparty', t.match(/((?:OOO|ООО|MChJ|YaTT)\s*«[^»]+»)/), 0.94);
  const total = t.match(/(?:Итого к оплате|Сумма|Общая сумма)[^:]*:\s*([\d\s]+(?:,\d{2})?)\s*(USD|EUR)?/i);
  if (total?.[1]) fields.push({ key: 'amount', value: `${total[1].trim()}${total[2] ? ` ${total[2].toUpperCase()}` : ''}`, confidence: 0.95 });
  const vat = t.match(/НДС\s*12%:\s*([\d\s]+,\d{2})/i);
  add('vat', vat, 0.93);
  add('contractRef', t.match(/договор[ауе]?\s*№\s*([\w\-]+)/i), 0.9);

  // Контроль арифметики: НДС 12% должен составлять 12/112 от суммы с НДС.
  if (total?.[1] && vat?.[1]) {
    const expected = (num(total[1]) * 12) / 112;
    const ok = Math.abs(expected - num(vat[1])) <= 1;
    const f = fields.find((x) => x.key === 'vat');
    if (f && !ok) f.confidence = 0.45;
  }

  const suggestion: AiRecognition['suggestion'] =
    kind === 'invoice' ? { kind: 'einvoice', to: '/einvoices' }
    : kind === 'act' || kind === 'letter' ? { kind: 'document', to: '/documents' }
    : kind === 'contract' ? { kind: 'contract', to: '/contracts' }
    : { kind: 'none', to: '/' };

  return { kind, kindConfidence, fields, suggestion };
}

// ---------- Проверка договоров ----------

export function checkContractText(text: string, meta: { currency?: string; counterpartyBlocked?: boolean; counterpartyRating?: number; endDate?: string; active?: boolean } = {}): AiContractCheck {
  const findings: AiContractFinding[] = [];
  const t = text.toLowerCase();
  if (!/пен[яиюе]|неустойк|штраф/.test(t)) findings.push({ code: 'no_penalty', level: 'high' });
  if (!/расторг/.test(t)) findings.push({ code: 'no_termination', level: 'medium' });
  if (!/суд|арбитраж/.test(t)) findings.push({ code: 'no_disputes', level: 'medium' });
  if (!/конфиденциальн/.test(t)) findings.push({ code: 'no_confidentiality', level: 'low' });
  const term = text.match(/в течение\s+(\d+)\s+(календарных|банковских)?\s*дн/i);
  if (term?.[1] && Number(term[1]) > 30) findings.push({ code: 'long_payment', level: 'medium', quote: term[0] });
  if (meta.currency && meta.currency !== 'UZS' && !/курс/.test(t)) findings.push({ code: 'fx_no_rate', level: 'high' });
  if (meta.counterpartyBlocked) findings.push({ code: 'cp_blocked', level: 'high' });
  else if (meta.counterpartyRating !== undefined && meta.counterpartyRating <= 2) findings.push({ code: 'cp_low_rating', level: 'medium' });
  if (meta.active && meta.endDate) {
    const days = (new Date(meta.endDate).getTime() - Date.now()) / 86_400_000;
    if (days >= 0 && days <= 75) findings.push({ code: 'expiring', level: 'low' });
  }
  const weight = { high: 25, medium: 12, low: 5 } as const;
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + weight[f.level], 0));
  return { score, findings };
}

/** Текст договора, созданного в системе из заявки, — по типовому шаблону банка (демо). */
function standardContractText(c: Contract, cpName?: string): string {
  const pay = c.payments.map((p, i) => `${i + 1}) ${formatDate(p.dueDate)} — ${formatMoney(p.amount, c.currency)}`).join('; ');
  return [
    `ДОГОВОР № ${c.number}`,
    `1. Предмет: ${c.subject}. Контрагент: ${cpName ?? '—'}.`,
    `2. Общая сумма договора — ${formatMoney(c.amount, c.currency)}${c.currency !== 'UZS' ? ', пересчёт по курсу ЦБ РУз на дату платежа' : ''}.`,
    `3. Оплата по графику: ${pay}; каждый платёж — в течение 10 банковских дней после подписания акта.`,
    `4. Срок действия: ${formatDate(c.startDate)} — ${formatDate(c.endDate)}.`,
    '5. За нарушение сроков исполнения Исполнитель уплачивает пеню 0,1% за каждый день, но не более 10% от суммы договора.',
    '6. Договор может быть расторгнут по соглашению сторон или в одностороннем порядке при существенном нарушении.',
    '7. Споры рассматриваются в экономическом суде г. Ташкента.',
    '8. Стороны обязуются соблюдать конфиденциальность.',
  ].join('\n');
}

// ---------- Публичный API модуля ----------

export const aiApi = {
  listChat: () => delay(chat),

  async ask(question: string, user: User, lang: Lang): Promise<AiChatMessage> {
    const started = Date.now();
    chat.push({ id: nextId('m'), role: 'user', text: question, at: now() });
    const a = await answer(question, user, lang);
    const msg: AiChatMessage = { id: nextId('m'), role: 'assistant', text: a.text, at: now(), answer: a };
    chat.push(msg);
    log(user, 'ask', question, started);
    emit();
    return delay(msg);
  },

  clearChat() {
    chat.length = 0;
    emit();
    return delay(null);
  },

  listSamples: () => delay(aiDocSamples),

  async recognize(input: { sampleId?: ID; text?: string }, user: User): Promise<AiRecognition> {
    const started = Date.now();
    const text = input.text ?? aiDocSamples.find((s) => s.id === input.sampleId)?.text ?? '';
    const result = recognizeText(text);
    log(user, 'recognize', aiDocSamples.find((s) => s.id === input.sampleId)?.fileName ?? text.slice(0, 60), started);
    emit();
    await new Promise((r) => setTimeout(() => r(null), 600)); // «модель думает»
    return delay(result);
  },

  async checkContract(contractId: ID, user: User): Promise<AiContractCheck & { text: string }> {
    const started = Date.now();
    const c = await api.getContract(contractId);
    const cps = await api.listCounterparties();
    const cp = cps.find((x) => x.id === c?.counterpartyId);
    const text = aiContractTexts[contractId] ?? (c ? standardContractText(c, cp?.name) : '');
    const result = checkContractText(text, {
      ...(c ? { currency: c.currency, endDate: c.endDate, active: c.status === 'active' } : {}),
      ...(cp ? { counterpartyBlocked: cp.blocked, counterpartyRating: cp.rating } : {}),
    });
    log(user, 'check_contract', c?.number ?? contractId, started);
    emit();
    await new Promise((r) => setTimeout(() => r(null), 500));
    return delay({ ...result, contractId, text });
  },

  listAudit: () => delay(clone(audit)),
};
