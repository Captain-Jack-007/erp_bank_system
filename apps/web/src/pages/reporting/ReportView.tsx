// Отображение результата отчёта (диаграмма + таблица с итогами) и экспорт в CSV.
import { formatDateTime, formatDecimal, formatNumber, localize, reportToCsv, type Lang, type ReportCell, type ReportColumn, type ReportResult } from '@xb/shared';
import { useState } from 'react';
import { BarChart, Card, Drawer, Empty } from '../../components/ui';
import { Link } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useP } from '../taxes/common';

export function formatCell(v: ReportCell | undefined, col: ReportColumn): string {
  if (v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (col.type === 'percent') return `${formatDecimal(v)}%`;
  return formatNumber(v);
}

/** Скачивание CSV через Blob и временную ссылку. */
export function downloadCsv(result: ReportResult, lang: Lang, filename: string): void {
  const blob = new Blob([reportToCsv(result, lang)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportView({ result }: { result: ReportResult }) {
  const { t, lang } = useSession();
  const p = useP();
  const [drill, setDrill] = useState<number | null>(null);
  const docs = drill !== null ? (result.rowDocs?.[drill] ?? []) : [];
  const chart = result.chart;
  const seriesCols = chart ? chart.seriesKeys.map((k) => result.columns.find((c) => c.key === k)).filter((c): c is ReportColumn => !!c) : [];
  const isMoney = seriesCols.some((c) => c.type === 'money');
  const scale = isMoney ? 1e9 : 1;
  const labelLen = Math.max(8, Math.min(16, Math.floor(120 / Math.max(1, Math.min(12, result.rows.length)))));

  return (
    <>
      {chart && result.rows.length > 0 && !result.rows.some((r) => seriesCols.some((c) => Number(r[c.key]) < 0)) && (
        <Card title={`${t('reporting_chart')}${isMoney ? `, ${t('reporting_unit_bln')}` : ''}`}>
          <BarChart
            data={result.rows.slice(0, 12).map((r, i, arr) => ({
              label: ((l) => (arr.some((x, j) => j < i && String(x[chart.labelKey] ?? '').slice(0, labelLen) === l) ? `${l.slice(0, labelLen - 3)} ${i + 1}` : l))(String(r[chart.labelKey] ?? '').slice(0, labelLen)),
              values: seriesCols.map((c) => Math.round(((Number(r[c.key]) || 0) / scale) * 100) / 100),
            }))}
            series={seriesCols.map((c) => ({ name: localize(c.label, lang) }))}
            format={(n) => (isMoney ? formatDecimal(n, 2) : formatNumber(n))}
          />
        </Card>
      )}
      <Card title={t('reporting_table')} actions={<span className="muted small">{t('reporting_generated')}: {formatDateTime(result.generatedAt)}</span>} flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c.key} className={c.type === 'text' ? undefined : 'right'}>
                    {localize(c.label, lang)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr
                  key={i}
                  className={result.rowDocs?.[i]?.length ? 'clickable' : undefined}
                  style={result.rowDocs?.[i]?.length ? { cursor: 'pointer' } : undefined}
                  title={result.rowDocs?.[i]?.length ? p('Детализация до документов', 'Hujjatlargacha batafsil', 'Drill down to documents') : undefined}
                  onClick={() => result.rowDocs?.[i]?.length && setDrill(i)}
                >
                  {result.columns.map((c) => (
                    <td key={c.key} className={c.type === 'text' ? undefined : 'right num'}>
                      {formatCell(r[c.key], c)}
                    </td>
                  ))}
                </tr>
              ))}
              {result.totals && (
                <tr style={{ fontWeight: 700, background: 'var(--surface-2)' }}>
                  {result.columns.map((c, i) => (
                    <td key={c.key} className={c.type === 'text' ? undefined : 'right num'}>
                      {i === 0 ? t('reporting_total') : result.totals![c.key] !== undefined && c.type !== 'percent' && c.type !== 'hours' ? formatNumber(result.totals![c.key]!) : ''}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(result.notes?.length || result.rowDocs?.some((d) => d.length)) ? (
          <div className="muted small" style={{ padding: '10px 18px', borderTop: '1px solid var(--border)' }}>
            {result.rowDocs?.some((d) => d.length) && <div>{p('Нажмите на строку, чтобы открыть документы-источники.', "Manba hujjatlarini ochish uchun qatorni bosing.", 'Click a row to open the source documents.')}</div>}
            {result.notes?.map((n, i) => <div key={i}>{localize(n, lang)}</div>)}
          </div>
        ) : null}
      </Card>
      <Drawer
        open={drill !== null}
        onClose={() => setDrill(null)}
        title={`${p('Документы-источники', 'Manba hujjatlari', 'Source documents')}: ${drill !== null ? String(result.rows[drill]?.[result.columns[0]!.key] ?? '') : ''}`}
      >
        {docs.length ? (
          <div className="list">
            <div className="muted small" style={{ marginBottom: 8 }}>{p('Документов', 'Hujjatlar', 'Documents')}: {docs.length}</div>
            {docs.slice(0, 200).map((d, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', overflowWrap: 'anywhere' }}>
                {d.to ? <Link to={d.to}>{d.label}</Link> : d.label}
              </div>
            ))}
          </div>
        ) : (
          <Empty text={t('empty')} />
        )}
      </Drawer>
    </>
  );
}
