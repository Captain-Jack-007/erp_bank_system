// CSV: формирование (с BOM для Excel) и разбор (BOM, автоопределение разделителя, кавычки, переводы строк в ячейках).

export type CsvCell = string | number | boolean | null | undefined;

function quote(v: CsvCell, delimiter: string): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Таблица → CSV-текст. По умолчанию «;» — так Excel в ru/uz-локали открывает файл по колонкам. */
export function toCsv(rows: CsvCell[][], delimiter = ';'): string {
  return rows.map((r) => r.map((c) => quote(c, delimiter)).join(delimiter)).join('\r\n');
}

/** CSV с BOM — корректная кириллица/узбекская латиница при открытии в Excel. */
export function toCsvWithBom(rows: CsvCell[][], delimiter = ';'): string {
  return '﻿' + toCsv(rows, delimiter);
}

/** Определить разделитель по первым строкам: тот, что даёт одинаковое и максимальное число колонок. */
export function detectDelimiter(text: string): string {
  const candidates = [';', ',', '\t', '|'];
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 100 + counts[0]!;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/** Разобрать CSV в массив строк. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Пустые строки в конце файла не нужны.
  while (rows.length && rows[rows.length - 1]!.every((c) => c.trim() === '')) rows.pop();
  return rows;
}
