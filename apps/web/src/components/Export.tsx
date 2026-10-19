// Экспорт реестров в Excel (.xlsx) и CSV. Используется любым модулем:
//   <ExportButton filename="Договоры" columns={[{ header: '№', value: (r) => r.number }, …]} rows={rows} />
//   или sheets={() => [...]} для нескольких листов.
import { buildXlsx, dlpCheck, dlpDenied, serviceAudit, toCsvWithBom, XLSX_MIME, type XlsxCell, type XlsxFormat, type XlsxSheet } from '@xb/shared';
import { Button, Dropdown, useToast } from './ui';
import { downloadBytes, safeFilename } from './download';
import { useSession } from '../lib/session';
import { moduleForPath, useStepUp } from '../lib/access';
import { useLocation } from '../lib/router';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => XlsxCell;
  format?: XlsxFormat;
  width?: number;
  total?: boolean;
}

/** Сформировать и скачать .xlsx. */
export function exportXlsx(filename: string, sheets: XlsxSheet[], creator?: string): void {
  const bytes = buildXlsx(sheets, creator ? { creator } : {});
  downloadBytes(filename.endsWith('.xlsx') ? filename : safeFilename(filename, 'xlsx'), XLSX_MIME, bytes);
}

/** Сформировать и скачать CSV (UTF-8 с BOM, разделитель «;»). Значения-даты — ISO, числа — без форматирования. */
export function exportCsv(filename: string, sheet: XlsxSheet): void {
  const rows = [sheet.columns.map((c) => c.header), ...sheet.rows.map((r) => r.map((v) => (v instanceof Date ? v.toISOString() : v)))];
  // Строка итогов — как в Excel и на экране: суммы по колонкам с признаком total.
  if (sheet.totalLabel && sheet.columns.some((c) => c.total)) {
    rows.push(sheet.columns.map((c, i) => (c.total ? sheet.rows.reduce((s, r) => s + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0) : i === 0 ? sheet.totalLabel! : '')));
  }
  downloadBytes(filename.endsWith('.csv') ? filename : safeFilename(filename, 'csv'), 'text/csv;charset=utf-8', toCsvWithBom(rows));
}

export function toSheet<T>(name: string, columns: ExportColumn<T>[], rows: T[], opts: { title?: string; totalLabel?: string } = {}): XlsxSheet {
  return {
    name,
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.totalLabel ? { totalLabel: opts.totalLabel } : {}),
    columns: columns.map((c) => ({ header: c.header, ...(c.format ? { format: c.format } : {}), ...(c.width ? { width: c.width } : {}), ...(c.total ? { total: true } : {}) })),
    rows: rows.map((r) => columns.map((c) => c.value(r))),
  };
}

/** Кнопка «Экспорт» с выбором Excel / CSV (и печати, если передан onPrint). */
export function ExportButton<T>({
  filename,
  columns,
  rows,
  sheets,
  title,
  onPrint,
  disabled,
  size = 'small',
}: {
  filename: string;
  columns?: ExportColumn<T>[];
  rows?: T[];
  sheets?: () => XlsxSheet[];
  /** Заголовок над таблицей в Excel. */
  title?: string;
  onPrint?: () => void;
  disabled?: boolean;
  size?: 'small' | 'middle';
}) {
  const { t, user } = useSession();
  const toast = useToast();
  const stepUp = useStepUp();
  // P3-GEN (PR-SEC-072): DLP — выгрузка по категории данных раздела и уровню доступа роли
  const moduleId = moduleForPath(useLocation())?.id;
  const dlp = dlpCheck(user, moduleId, 'export');
  // Выгрузка без подтверждения выполняется синхронно в обработчике клика (браузер сохраняет имя файла).
  const guarded = (run: () => void) => () => {
    if (!dlp.allowed) {
      dlpDenied(moduleId, 'export', filename);
      toast(`${t('dlp_denied')} (${t(`dlp_cat_${dlp.category}` as never)})`);
      return;
    }
    if (dlp.stepUp) {
      void stepUp(`${t('svc_export')}: ${filename}`).then((ok) => ok && run());
      return;
    }
    run();
  };
  const build = (): XlsxSheet[] => sheets?.() ?? [toSheet(filename.slice(0, 31), columns ?? [], rows ?? [], { ...(title ? { title } : {}), totalLabel: t('svc_total') })];
  const log = (fmt: string, count: number) => user && serviceAudit({ userId: user.id, action: 'export.file', entity: 'export', entityId: filename, details: `${fmt} · ${count}` });
  const items = [
    {
      key: 'xlsx',
      label: t('svc_exportExcel'),
      icon: 'download' as const,
      onClick: guarded(() => {
        const s = build();
        exportXlsx(filename, s, user?.fullName);
        log('XLSX', s.reduce((a, x) => a + x.rows.length, 0));
        toast(t('svc_exportDone'));
      }),
    },
    {
      key: 'csv',
      label: t('svc_exportCsv'),
      icon: 'file' as const,
      onClick: guarded(() => {
        const s = build()[0]!;
        exportCsv(filename, s);
        log('CSV', s.rows.length);
        toast(t('svc_exportDone'));
      }),
    },
    ...(onPrint ? [{ key: 'print', label: t('svc_exportPrint'), icon: 'printer' as const, onClick: onPrint }] : []),
  ];
  return (
    <Dropdown menu={{ items }}>
      <Button size={size === 'small' ? 'small' : 'middle'} icon="download" disabled={disabled} className="svc-export-btn">
        {t('svc_export')}
      </Button>
    </Dropdown>
  );
}
