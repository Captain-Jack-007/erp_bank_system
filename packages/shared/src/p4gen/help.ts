// P4-GEN (PR-TEC-007): API встроенной справки. Содержание — helpContent.ts (данные на ru/uz/en).
import { delay } from '../bus';
import { HELP_ARTICLES, HELP_START_IDS, type HelpArticle } from './helpContent';

export const helpApi = {
  list(): Promise<HelpArticle[]> {
    return delay(HELP_ARTICLES);
  },
  get(id: string): Promise<HelpArticle | undefined> {
    return delay(HELP_ARTICLES.find((a) => a.id === id));
  },
  /** Синхронно — для кнопки «?» и проверки наличия статьи модуля. */
  has(id: string): boolean {
    return HELP_ARTICLES.some((a) => a.id === id);
  },
  startIds: HELP_START_IDS,
};
