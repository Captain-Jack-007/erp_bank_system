// Экспорт таблиц экранов ядра (журнал аудита, access review, МВЗ) в CSV/XLSX через сервисы P1-SVC.
import { buildXlsx, toCsvWithBom, XLSX_MIME, type XlsxCell, type XlsxFormat } from '@xb/shared';
import { downloadBytes, safeFilename } from '../components/download';

export interface ExportColumn {
  header: string;
  format?: XlsxFormat;
  width?: number;
}

export function exportTable(format: 'csv' | 'xlsx', base: string, columns: ExportColumn[], rows: XlsxCell[][], title?: string): void {
  if (format === 'csv') {
    const text = toCsvWithBom([columns.map((c) => c.header), ...rows.map((r) => r.map((v) => (v instanceof Date ? v.toISOString() : v)))]);
    downloadBytes(safeFilename(base, 'csv'), 'text/csv;charset=utf-8', text);
    return;
  }
  const bytes = buildXlsx([{ name: base.slice(0, 31), columns, rows, ...(title ? { title } : {}) }], { creator: 'XB-ERP' });
  downloadBytes(safeFilename(base, 'xlsx'), XLSX_MIME, bytes);
}
