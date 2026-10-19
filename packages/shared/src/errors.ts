// P4-SEC (PR-TEC-008): коды ошибок mock-API вместо текста. Экран переводит код по словарю (errorsI18n.ts, ru/uz/en);
// технические подробности не показываются пользователю, а уходят в технический журнал (monitoring.reportAppError).
//
// В API модуля:   throw apiError('USER_SELF_DEACTIVATE')            → «Нельзя деактивировать собственную учётную запись»
//                 throw apiError('TIN_ALREADY_USED', dup.name)       → «ИНН уже используется: {0}»
// На экране:      errorText(lang, e)  (в вебе — useErrorText() из lib/access.tsx; тосты «Не удалось…: CODE» переводятся сами)
import { dictionaries, translate, type TKey } from './i18n';
import type { Lang } from './types';
import { getFormatLang } from './format';

/** Ошибка API с кодом из словаря. message = CODE или CODE:arg1|arg2 (совместимо со старыми проверками e.message). */
export class ApiError extends Error {
  readonly code: string;
  readonly params: string[];
  constructor(code: string, params: (string | number)[] = []) {
    super(params.length ? `${code}:${params.map(String).join('|')}` : code);
    this.name = 'ApiError';
    this.code = code;
    this.params = params.map(String);
  }
}

/** Создать ошибку API с кодом: throw apiError('NOT_FOUND'). */
export function apiError(code: string, ...params: (string | number)[]): ApiError {
  return new ApiError(code, params);
}

const fill = (text: string, params: string[]) => params.reduce((s, p, i) => s.split(`{${i}}`).join(p), text).replace(/\{\d+\}/g, '');
const has = (key: string): boolean => key in dictionaries.ru;

/**
 * Текст ошибки для пользователя на языке интерфейса. Порядок: ApiError → код CODE[:args] из словаря err_* →
 * ключ словаря модуля (wh_err_…) → локализованный текст как есть → обобщённое сообщение (без технических деталей).
 */
export function errorText(lang: Lang, e: unknown): string {
  const code = e instanceof Error ? (e as Error & { code?: unknown }).code : undefined;
  if (typeof code === 'string' && !(e instanceof ApiError) && has(`flow_err_${code}`)) return translate(lang, `flow_err_${code}` as TKey);
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return messageText(lang, raw);
}

/** То же для уже извлечённого текста сообщения (например, хвост тоста «Не удалось выполнить действие: CODE»). */
export function messageText(lang: Lang, raw: string): string {
  const msg = raw.trim();
  if (!msg) return translate(lang, 'err_GENERIC');
  const bare = msg.replace(/^auth:/, '');
  if (/^[a-z_]+$/.test(bare) && has(`flow_err_${bare}`)) return translate(lang, `flow_err_${bare}` as TKey); // коды движка согласований / аутентификации
  const m = msg.match(/^([A-Z][A-Z0-9_]+)(?::(.*))?$/s);
  if (m) {
    const key = `err_${m[1]}`;
    const params = m[2] !== undefined ? m[2].split('|') : [];
    if (has(key)) return fill(translate(lang, key as TKey), params);
    return `${translate(lang, 'err_GENERIC')} (${translate(lang, 'err_code')}: ${m[1]})`;
  }
  const k = msg.match(/^([a-z][a-z0-9]*_[a-zA-Z0-9_]+)(?::(.*))?$/s);
  if (k) {
    const name = k[1]!;
    if (has(name)) {
      const text = translate(lang, name as TKey);
      if (k[2] === undefined) return text;
      return text.includes('{0}') ? fill(text, k[2].split('|')) : `${text}: ${k[2]}`;
    }
    return translate(lang, 'err_GENERIC');
  }
  // Сообщения правил модулей уже на языке интерфейса — показываем как есть;
  // технический текст (исключения JS, внутренние сбои, стек) — обобщённым сообщением.
  if (TECHNICAL.test(msg) || msg.length > 400) return translate(lang, 'err_GENERIC');
  return msg;
}

const TECHNICAL = /\b(undefined|null|NaN|is not a function|is not defined|Cannot (read|set) propert|TypeError|ReferenceError|RangeError|SyntaxError|not initiali[sz]ed|stack|Failed to fetch)\b|\.(tsx?|js):\d+|^(ZIP|XLSX|QR|JSON):|\bat [\w.]+ \(/;

/** errorText на текущем языке интерфейса (язык форматирования, setFormatLang) — для помощников экранов без доступа к сессии. */
export function userError(e: unknown): string {
  return errorText(getFormatLang(), e);
}
/** messageText на текущем языке интерфейса. */
export function userMessage(raw: string): string {
  return messageText(getFormatLang(), raw);
}
