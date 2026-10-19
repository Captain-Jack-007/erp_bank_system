// Глобальный поиск по системе. Ядро и каждый модуль регистрируют провайдер,
// который ищет по своим данным и возвращает ссылки на экраны.
import type { Lang } from './types';
import { toLatin } from './translit';

export interface SearchResult {
  /** Группа результата: ключ словаря (например navProcurement) или произвольная подпись. */
  group: string;
  title: string;
  subtitle?: string;
  to: string;
}

export type SearchProvider = (query: string, lang: Lang) => SearchResult[];

const providers: SearchProvider[] = [];

export function registerSearchProvider(provider: SearchProvider): void {
  providers.push(provider);
}

/** Нормализация: нижний регистр, без кавычек и лишних пробелов. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[«»"'‘’ʻʼ`]/g, '').replace(/\s+/g, ' ').trim();
}

export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = normalize(query);
  if (!q) return false;
  // Запрос на узбекской кириллице ищем и в латинице (данные хранятся в uz-латинице и ru)
  const qLat = /[ўқғҳ]|[а-яё]/i.test(q) ? normalize(toLatin(q)) : '';
  return fields.some((f) => f !== undefined && (normalize(f).includes(q) || (!!qLat && normalize(f).includes(qLat))));
}

export function searchAll(query: string, lang: Lang, limit = 30): SearchResult[] {
  if (normalize(query).length < 2) return [];
  const out: SearchResult[] = [];
  for (const p of providers) {
    try {
      out.push(...p(query, lang));
    } catch {
      /* ошибка одного провайдера не ломает поиск */
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}
