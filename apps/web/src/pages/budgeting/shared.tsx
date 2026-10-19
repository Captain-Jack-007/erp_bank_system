// Общие помощники экранов финансовых модулей бюджетирования.
import type { CSSProperties } from 'react';
import { MONTHS_FULL as CORE_MONTHS_FULL, MONTHS_SHORT, pick, type Lang, type Localized, userMessage } from '@xb/shared';
import { useSession } from '../../lib/session';

// Названия месяцев — из ядра (все языки интерфейса), короткие — с заглавной буквы.
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const MONTHS = Object.fromEntries(Object.entries(MONTHS_SHORT).map(([l, a]) => [l, a.map(cap)])) as Record<Lang, string[]>;
export const MONTHS_FULL: Record<Lang, string[]> = CORE_MONTHS_FULL;

/** Знак отклонения: + перерасход (красный), − экономия (зелёный). */
export function varianceStyle(v: number): CSSProperties {
  if (v > 0) return { color: 'var(--danger)', fontWeight: 600 };
  if (v < 0) return { color: 'var(--ok)', fontWeight: 600 };
  return {};
}

/** Строки интерфейса на месте: p('Текст', 'Matn', 'Text'). */
export function usePick() {
  const { lang } = useSession();
  return (ru: string, uz: string, en: string) => pick(lang, ru, uz, en);
}

/** «2026-10» → «Окт 26». */
export function ymLabel(ym: string, lang: Lang): string {
  const m = Number(ym.slice(5, 7)) - 1;
  return `${MONTHS[lang][m] ?? ym} ${ym.slice(2, 4)}`;
}

const ERRORS: Record<string, Localized> = {
  budget_blocked: { ru: 'Hard-check: транзакция заблокирована — превышен лимит статьи', uz: 'Hard-check: tranzaksiya bloklandi — modda limiti oshdi', en: 'Hard-check: transaction blocked — article limit exceeded' },
  budget_confirmation_required: { ru: 'Soft-check: требуется подтверждение ответственного руководителя', uz: 'Soft-check: mas’ul rahbar tasdig‘i kerak', en: 'Soft-check: responsible manager confirmation required' },
  budget_line_not_found: { ru: 'Строка бюджета не найдена', uz: 'Byudjet satri topilmadi', en: 'Budget line not found' },
  budgeting_err_zbb_empty: { ru: 'Укажите название и хотя бы одну статью', uz: 'Nom va kamida bitta moddani kiriting', en: 'Enter a title and at least one item' },
  budgeting_err_zbb_item: { ru: 'У каждой статьи должны быть статья расходов и сумма больше 0', uz: 'Har bir bandda xarajat moddasi va 0 dan katta summa bo‘lishi kerak', en: 'Each item needs an article and an amount above 0' },
  budgeting_err_zbb_justification: { ru: 'Экономическое обоснование — не короче 20 символов', uz: 'Iqtisodiy asoslash — kamida 20 belgi', en: 'Economic justification must be at least 20 characters' },
  budgeting_err_zbb_goal: { ru: 'Укажите стратегическую цель', uz: 'Strategik maqsadni ko‘rsating', en: 'Select a strategic goal' },
  budgeting_err_zbb_impact: { ru: 'Опишите риски нефинансирования (Impact of non-funding)', uz: 'Moliyalashtirilmaslik xavflarini yozing (Impact of non-funding)', en: 'Describe the impact of non-funding' },
  budgeting_err_capex_article: { ru: 'Укажите наименование и статью CAPEX', uz: 'Nom va CAPEX moddasini ko‘rsating', en: 'Enter a title and a CAPEX article' },
  budgeting_err_capex_schedule: { ru: 'График финансирования: месяц ГГГГ-ММ и сумма больше 0', uz: 'Moliyalashtirish jadvali: YYYY-MM oyi va 0 dan katta summa', en: 'Funding schedule: month YYYY-MM and amount above 0' },
  budgeting_err_capex_past: { ru: 'Нельзя планировать финансирование в закрытых месяцах', uz: 'Yopilgan oylarga moliyalashtirish rejalashtirib bo‘lmaydi', en: 'Funding cannot be planned in closed months' },
  budgeting_err_capex_justification: { ru: 'Обоснование (от 20 символов), цель и риски нефинансирования обязательны', uz: 'Asoslash (20 belgidan), maqsad va xavflar majburiy', en: 'Justification (20+ chars), goal and impact are required' },
  budgeting_err_not_editable: { ru: 'Документ на согласовании или утверждён — изменение невозможно', uz: 'Hujjat kelishuvda yoki tasdiqlangan — o‘zgartirib bo‘lmaydi', en: 'The document is in approval or approved — it cannot be edited' },
  budgeting_err_overrun_reason: { ru: 'Обоснование и риски — не короче 10 символов', uz: 'Asoslash va xavflar — kamida 10 belgi', en: 'Reason and impact must be at least 10 characters' },
  budgeting_err_overrun_not_needed: { ru: 'Лимит не превышен — подтверждение не требуется', uz: 'Limit oshmagan — tasdiq talab qilinmaydi', en: 'The limit is not exceeded — no confirmation needed' },
  budgeting_err_thresholds: { ru: 'Пороги — числа от 1 до 99', uz: 'Chegaralar — 1 dan 99 gacha sonlar', en: 'Thresholds must be numbers between 1 and 99' },
  budgeting_err_cash: { ru: 'Сумму кассового плана можно менять только в открытых месяцах', uz: 'Kassa rejasini faqat ochiq oylarda o‘zgartirish mumkin', en: 'Cash plan can only be changed for open months' },
  budgeting_err_scenario: { ru: 'Проверьте параметры сценария (−90…200%, курс > 0, название)', uz: 'Ssenariy parametrlarini tekshiring (−90…200%, kurs > 0, nom)', en: 'Check scenario parameters (−90…200%, FX > 0, name)' },
  budgeting_err_scenario_system: { ru: 'Базовые сценарии удалить нельзя', uz: 'Asosiy ssenariylarni o‘chirib bo‘lmaydi', en: 'Base scenarios cannot be deleted' },
  budgeting_err_milestone: { ru: 'Этап: название, бюджет > 0, даты и прогресс 0–100%', uz: 'Bosqich: nom, byudjet > 0, sanalar va 0–100% progress', en: 'Milestone: name, budget > 0, dates and progress 0–100%' },
  budgeting_err_milestone_budget: { ru: 'Сумма бюджетов этапов превышает бюджет проекта', uz: 'Bosqichlar byudjeti loyiha byudjetidan oshadi', en: 'Milestone budgets exceed the project budget' },
  budgeting_err_amount: { ru: 'Сумма должна быть больше 0', uz: 'Summa 0 dan katta bo‘lishi kerak', en: 'Amount must be above 0' },
  budgeting_err_year_closed: { ru: 'Все месяцы года закрыты', uz: 'Yilning barcha oylari yopilgan', en: 'All months of the year are closed' },
  budgeting_err_gl_unavailable: { ru: 'iABS недоступна — запрос поставлен в очередь, повторите закрытие позже', uz: 'iABS mavjud emas — so‘rov navbatga qo‘yildi, keyinroq qayta urinib ko‘ring', en: 'iABS unavailable — request queued, retry closing later' },
  Forbidden: { ru: 'Недостаточно прав', uz: 'Huquq yetarli emas', en: 'Insufficient rights' },
};

/** Текст ошибки API модуля на языке интерфейса. */
export function useErrText() {
  const { lang } = useSession();
  return (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    const l = ERRORS[msg];
    return l ? pick(lang, l.ru, l.uz, l.en) : userMessage(msg);
  };
}

/** Сумма в млн из поля ввода («1 250,5» → 1 250 500 000). */
export function parseMln(v: string): number {
  return Math.round(Number(v.replace(/\s/g, '').replace(',', '.')) * 1_000_000);
}
