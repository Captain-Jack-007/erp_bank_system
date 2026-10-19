// Форматирование без зависимости от Intl (на мобильном Hermes поддержка Intl неполная).
import type { Lang, ProcurementItem } from './types';

// Язык форматирования по умолчанию (единицы «млн/mln/mn», десятичный разделитель, название валюты).
// Устанавливается сессией при смене языка интерфейса; функции также принимают язык явно.
let formatLang: Lang = 'ru';
export function setFormatLang(lang: Lang): void {
  formatLang = lang;
}
export function getFormatLang(): Lang {
  return formatLang;
}

/** Десятичный разделитель: запятая для ru/uz/uzc, точка для en. Разделитель тысяч — пробел во всех языках. */
export function decimalSep(lang: Lang = formatLang): string {
  return lang === 'en' ? '.' : ',';
}

/** Обозначение сума: сум / so‘m / сўм / UZS. */
export function currencyLabel(lang: Lang = formatLang): string {
  return lang === 'ru' ? 'сум' : lang === 'uzc' ? 'сўм' : lang === 'en' ? 'UZS' : "so'm";
}

export const MONTHS_SHORT: Record<Lang, string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  uz: ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'],
  uzc: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
export const MONTHS_FULL: Record<Lang, string[]> = {
  ru: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  uzc: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
/** Название месяца (0–11) на языке интерфейса. */
export function monthName(month: number, lang: Lang = formatLang, full = false): string {
  return (full ? MONTHS_FULL : MONTHS_SHORT)[lang][month] ?? String(month + 1);
}

export function formatNumber(value: number): string {
  const sign = value < 0 ? '-' : '';
  const [int, frac] = Math.abs(value).toFixed(0).split('.');
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + grouped + (frac ? `${decimalSep()}${frac}` : '');
}

export function formatMoney(value: number, currency: 'UZS' | 'USD' | 'EUR' = 'UZS', lang: Lang = formatLang): string {
  const suffix = currency === 'UZS' ? currencyLabel(lang) : currency;
  return `${formatNumber(value)} ${suffix}`;
}

const SHORT_UNITS: Record<Lang, string[]> = {
  ru: ['', 'тыс', 'млн', 'млрд', 'трлн'],
  uz: ['', 'ming', 'mln', 'mlrd', 'trln'],
  uzc: ['', 'минг', 'млн', 'млрд', 'трлн'],
  en: ['', 'K', 'mn', 'bn', 'tn'],
};

/** Компактная запись крупных сумм: 1,2 млрд / 1,2 mlrd / 1,2 млрд / 1.2 bn */
export function formatMoneyShort(value: number, lang: Lang = formatLang): string {
  const units = SHORT_UNITS[lang] ?? SHORT_UNITS.ru;
  let v = value;
  let i = 0;
  while (Math.abs(v) >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const text = (Math.round(v * 10) / 10).toString().replace('.', decimalSep(lang));
  return i === 0 ? text : `${text} ${units[i]}`;
}

export function formatDate(iso: string): string {
  const d = iso.slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function procurementTotal(items: ProcurementItem[]): number {
  return items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
}

export function isOverdue(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

/** Десятичное число: formatDecimal(14.5) → «14,5» (en: «14.5») */
export function formatDecimal(value: number, digits = 1, lang: Lang = formatLang): string {
  return (Math.round(value * 10 ** digits) / 10 ** digits).toString().replace('.', decimalSep(lang));
}
