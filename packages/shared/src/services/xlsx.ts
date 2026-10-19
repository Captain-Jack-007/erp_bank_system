// Экспорт/импорт Excel (.xlsx, Office Open XML) без зависимостей.
// buildXlsx: несколько листов, стили заголовка, ширина колонок, числовые/датовые форматы,
// закреплённая строка заголовка, автофильтр, строка итогов. parseXlsx: чтение листов в строки.
import { utf8Decode, utf8Encode, xmlEscape, xmlUnescape } from './bytes';
import { readZip, writeZip, type InflateRaw } from './zip';

export type XlsxCell = string | number | boolean | Date | null | undefined;
export type XlsxFormat = 'text' | 'integer' | 'number' | 'money' | 'percent' | 'date' | 'datetime';

export interface XlsxColumn {
  header: string;
  /** Ширина в символах; по умолчанию — по содержимому (8..60). */
  width?: number;
  format?: XlsxFormat;
  /** Посчитать сумму колонки в строке итогов. */
  total?: boolean;
}

export interface XlsxSheet {
  name: string;
  columns: XlsxColumn[];
  rows: XlsxCell[][];
  /** Заголовок над таблицей (первая строка листа, жирный). */
  title?: string;
  /** Подпись строки итогов (если хотя бы у одной колонки total). */
  totalLabel?: string;
}

// Индексы стилей в cellXfs (см. STYLES ниже).
const XF = { default: 0, header: 1, integer: 2, number: 3, money: 2, percent: 4, date: 5, datetime: 6, text: 7, title: 8, totalLabel: 9, totalNum: 10 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00894A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F5EE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB7C9BF"/></left><right style="thin"><color rgb="FFB7C9BF"/></right><top style="thin"><color rgb="FFB7C9BF"/></top><bottom style="thin"><color rgb="FFB7C9BF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Номер колонки (0..) → буквы Excel (A, B, …, AA). */
export function colLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Буквы колонки → номер (0..). */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const EPOCH = Date.UTC(1899, 11, 30);
/** Дата → серийный номер Excel (дни с 30.12.1899). Время берётся в UTC, чтобы не зависеть от пояса. */
export function toExcelSerial(d: Date): number {
  return (d.getTime() - EPOCH) / 86_400_000;
}
export function fromExcelSerial(n: number): Date {
  return new Date(EPOCH + Math.round(n * 86_400_000));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let k = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${k++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  base = candidate;
  return base;
}

class SharedStrings {
  list: string[] = [];
  private index = new Map<string, number>();
  count = 0;
  id(s: string): number {
    this.count++;
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.index.set(s, i);
    }
    return i;
  }
}

function cellXml(ref: string, value: XlsxCell, format: XlsxFormat | undefined, ss: SharedStrings, styleOverride?: number): string {
  if (value === null || value === undefined || value === '') return styleOverride !== undefined ? `<c r="${ref}" s="${styleOverride}"/>` : '';
  const fmt = format ?? (typeof value === 'number' ? 'number' : value instanceof Date ? 'date' : 'text');
  let v: number | string | boolean | Date = value;
  if ((fmt === 'date' || fmt === 'datetime') && typeof v === 'string' && ISO_DATE.test(v)) {
    const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
    if (!Number.isNaN(d.getTime())) v = d;
  }
  if (v instanceof Date) {
    const serial = toExcelSerial(v);
    const s = styleOverride ?? (fmt === 'datetime' ? XF.datetime : XF.date);
    return `<c r="${ref}" s="${s}"><v>${fmt === 'datetime' ? serial : Math.floor(serial + 1e-9)}</v></c>`;
  }
  if (typeof v === 'boolean') return `<c r="${ref}" t="b" s="${styleOverride ?? XF.default}"><v>${v ? 1 : 0}</v></c>`;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const s = styleOverride ?? (fmt === 'percent' ? XF.percent : fmt === 'integer' || fmt === 'money' ? XF.integer : fmt === 'text' ? XF.text : XF.number);
    if (fmt === 'text') return `<c r="${ref}" t="s" s="${s}"><v>${ss.id(String(v))}</v></c>`;
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}" t="s" s="${styleOverride ?? XF.text}"><v>${ss.id(String(v))}</v></c>`;
}

function displayLength(v: XlsxCell, fmt?: XlsxFormat): number {
  if (v === null || v === undefined) return 0;
  if (v instanceof Date || fmt === 'date') return 10;
  if (fmt === 'datetime') return 16;
  if (typeof v === 'number') return fmt === 'number' ? v.toFixed(2).length + Math.floor(String(Math.trunc(v)).length / 3) : String(Math.round(v)).length + Math.floor(String(Math.round(v)).length / 3);
  return Math.max(...String(v).split('\n').map((l) => l.length));
}

function sheetXml(sheet: XlsxSheet, ss: SharedStrings): string {
  const cols = sheet.columns;
  const rowsXml: string[] = [];
  let r = 0;
  if (sheet.title) {
    r++;
    rowsXml.push(`<row r="${r}" ht="22" customHeight="1">${cellXml(`A${r}`, sheet.title, 'text', ss, XF.title)}</row>`);
  }
  r++;
  const headerRow = r;
  rowsXml.push(`<row r="${r}" ht="30" customHeight="1">${cols.map((c, i) => cellXml(`${colLetter(i)}${r}`, c.header, 'text', ss, XF.header)).join('')}</row>`);
  const firstData = r + 1;
  for (const row of sheet.rows) {
    r++;
    rowsXml.push(`<row r="${r}">${cols.map((c, i) => cellXml(`${colLetter(i)}${r}`, row[i], c.format, ss)).join('')}</row>`);
  }
  const lastData = r;
  const hasTotals = cols.some((c) => c.total) && sheet.rows.length > 0;
  if (hasTotals) {
    r++;
    const cells = cols.map((c, i) => {
      const ref = `${colLetter(i)}${r}`;
      if (c.total) {
        const sum = sheet.rows.reduce((s, row) => s + (typeof row[i] === 'number' ? (row[i] as number) : 0), 0);
        const style = c.format === 'number' ? XF.number : XF.totalNum;
        return `<c r="${ref}" s="${style}"><f>SUM(${colLetter(i)}${firstData}:${colLetter(i)}${lastData})</f><v>${sum}</v></c>`;
      }
      return i === 0 ? cellXml(ref, sheet.totalLabel ?? 'Итого', 'text', ss, XF.totalLabel) : `<c r="${ref}" s="${XF.totalLabel}"/>`;
    });
    rowsXml.push(`<row r="${r}">${cells.join('')}</row>`);
  }
  const widths = cols.map((c, i) => {
    if (c.width) return c.width;
    const max = Math.max(c.header.length * 0.9, ...sheet.rows.slice(0, 500).map((row) => displayLength(row[i], c.format)));
    return Math.min(60, Math.max(8, Math.ceil(max + 2)));
  });
  const lastCol = colLetter(Math.max(0, cols.length - 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastCol}${Math.max(r, 1)}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
${sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${lastData}"/>` : ''}
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

/** Собрать файл .xlsx. Возвращает байты (в вебе — Blob и скачивание, см. components/Export). */
export function buildXlsx(sheets: XlsxSheet[], meta: { creator?: string; created?: Date } = {}): Uint8Array {
  if (!sheets.length) throw new Error('XLSX: at least one sheet required');
  const ss = new SharedStrings();
  const used = new Set<string>();
  const names = sheets.map((s) => sanitizeSheetName(s.name, used));
  const sheetFiles = sheets.map((s) => sheetXml(s, ss));
  const created = (meta.created ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  // Именованный диапазон _FilterDatabase нужен Excel для автофильтра.
  const defined = sheets
    .map((s, i) => {
      if (!s.rows.length) return '';
      const headerRow = s.title ? 2 : 1;
      const last = headerRow + s.rows.length;
      const quoted = `'${names[i]!.replace(/'/g, "''")}'`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlEscape(quoted)}!$A$${headerRow}:$${colLetter(s.columns.length - 1)}$${last}</definedName>`;
    })
    .join('');
  const files: { name: string; data: Uint8Array }[] = [
    {
      name: '[Content_Types].xml',
      data: utf8Encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    },
    {
      name: '_rels/.rels',
      data: utf8Encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    },
    {
      name: 'docProps/core.xml',
      data: utf8Encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${xmlEscape(meta.creator ?? 'XB-ERP')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`),
    },
    {
      name: 'docProps/app.xml',
      data: utf8Encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>XB-ERP</Application></Properties>`),
    },
    {
      name: 'xl/workbook.xml',
      data: utf8Encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names
        .map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ''}</workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: utf8Encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`),
    },
    { name: 'xl/styles.xml', data: utf8Encode(STYLES) },
    ...sheetFiles.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8Encode(x) })),
  ];
  files.push({
    name: 'xl/sharedStrings.xml',
    data: utf8Encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ss.count}" uniqueCount="${ss.list.length}">${ss.list
        .map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`)
        .join('')}</sst>`,
    ),
  });
  return writeZip(files);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---------- Чтение ----------

export interface ParsedSheet {
  name: string;
  /** Строки как массивы строк (пустые ячейки — ''). Даты → ISO (YYYY-MM-DD). */
  rows: string[][];
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? xmlUnescape(m[1]!) : undefined;
}

function textOf(xml: string): string {
  // Текст из всех <t>…</t> (в том числе в rich text <r><t>).
  let s = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) s += xmlUnescape(m[1] ?? '');
  return s;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormatCode(code: string): boolean {
  const cleaned = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(cleaned) && !/^[#0.,%\s]+$/.test(cleaned);
}

/** Прочитать .xlsx: все листы по порядку книги. */
export async function parseXlsx(data: Uint8Array, inflateRaw: InflateRaw): Promise<ParsedSheet[]> {
  const zip = await readZip(data, inflateRaw);
  const read = (p: string) => {
    const b = zip.get(p);
    return b ? utf8Decode(b) : undefined;
  };
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new Error('XLSX: workbook.xml not found');
  const rels = read('xl/_rels/workbook.xml.rels') ?? '';
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) relMap.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  const shared: string[] = [];
  const sst = read('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]!));

  // Стили: какие xf-индексы — даты.
  const dateXf = new Set<number>();
  const styles = read('xl/styles.xml');
  if (styles) {
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') ?? '');
    const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
    let i = 0;
    for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
      const id = Number(attr(m[0], 'numFmtId') ?? 0);
      if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)!))) dateXf.add(i);
      i++;
    }
  }

  const sheets: ParsedSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], 'name') ?? `Sheet${sheets.length + 1}`;
    const rid = attr(m[0], 'r:id');
    const path = (rid && relMap.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = read(path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const rAttr = rm[1] ?? rm[3] ?? '';
      const rowNum = Number(attr(rAttr, 'r') ?? rows.length + 1);
      const cells: string[] = [];
      let next = 0;
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1] ?? '';
        const inner = cm[2] ?? '';
        const ref = attr(a, 'r');
        const col = ref ? colIndex(ref.replace(/\d+/g, '')) : next;
        next = col + 1;
        const t = attr(a, 't');
        const s = Number(attr(a, 's') ?? -1);
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = '';
        if (t === 's') value = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') value = textOf(inner);
        else if (t === 'str') value = xmlUnescape(v ?? '');
        else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') value = '';
        else if (v !== undefined) {
          const num = Number(v);
          if (dateXf.has(s) && Number.isFinite(num)) {
            const iso = fromExcelSerial(num).toISOString();
            value = num % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
          } else value = v;
        }
        while (cells.length < col) cells.push('');
        cells[col] = value;
      }
      while (rows.length < rowNum - 1) rows.push([]);
      rows[rowNum - 1] = cells;
    }
    sheets.push({ name, rows: rows.map((r) => r ?? []) });
  }
  return sheets;
}
