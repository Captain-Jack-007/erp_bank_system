// Экран отчёта: построение из данных модулей, детализация до документов, экспорт CSV / Excel / Word, печать (PDF).
import { useEffect, useRef, useState } from 'react';
import { localize, reportingApi, reportToDocx, reportToSheet, tk, type PrintDocument, type ReportBuilderQuery, type ReportResult, userMessage } from '@xb/shared';
import { Badge, Button, Card, Empty, Loading, PageHeader, Select, useToast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { downloadBytes } from '../../components/download';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useP } from '../taxes/common';
import { downloadCsv, formatCell, ReportView } from './ReportView';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Печатная форма отчёта (реестр, альбомная ориентация, QR проверки). */
export function reportPrintDoc(id: string, code: string, r: ReportResult, lang: Parameters<typeof localize>[1], totalLabel: string): PrintDocument {
  return {
    entity: 'report',
    entityId: id,
    title: localize(r.title, lang) ?? code,
    number: code,
    date: r.generatedAt.slice(0, 10),
    landscape: r.columns.length > 5,
    table: {
      columns: r.columns.map((c) => ({ header: localize(c.label, lang) ?? c.key, align: c.type === 'text' ? 'left' : 'right' })),
      rows: r.rows.map((row) => r.columns.map((c) => formatCell(row[c.key], c))),
      ...(r.totals ? { totals: r.columns.map((c, i) => (i === 0 ? totalLabel : r.totals![c.key] !== undefined && c.type !== 'percent' && c.type !== 'hours' ? formatCell(r.totals![c.key], c) : '')) } : {}),
    },
    ...(r.notes?.length ? { paragraphs: r.notes.map((n) => localize(n, lang) ?? '') } : {}),
  };
}

export function ReportExports({ id, code, result, filename }: { id: string; code: string; result: ReportResult; filename: string }) {
  const { t, lang } = useSession();
  const p = useP();
  const toast = useToast();
  return (
    <>
      <ExportButton filename={filename} sheets={() => [reportToSheet(result, lang)]} />
      <Button
        icon="file"
        size="small"
        onClick={() => {
          downloadBytes(`${filename}.docx`, DOCX_MIME, reportToDocx(result, lang));
          toast(p('Документ Word сформирован', 'Word hujjati tayyorlandi', 'Word document generated'));
        }}
      >
        Word
      </Button>
      <PrintButton doc={() => reportPrintDoc(id, code, result, lang, t('reporting_total'))} template="registry" label={p('Печать / PDF', 'Chop etish / PDF', 'Print / PDF')} />
    </>
  );
}

const PERIODS: ReportBuilderQuery['periodDays'][] = [0, 30, 90, 365];

export function ReportPage({ id }: { id: string }) {
  const { t, loc, lang } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [periodDays, setPeriodDays] = useState<ReportBuilderQuery['periodDays'] | undefined>(undefined);
  const def = useApi(() => reportingApi.getReport(id), [id]);
  const result = useApi(() => reportingApi.runReport(id, lang, { ...(periodDays !== undefined ? { periodDays } : {}), user }), [id, lang, tick, periodDays]);
  // После ручного обновления — уведомление, когда отчёт пересчитан.
  const refreshing = useRef(false);
  useEffect(() => {
    if (refreshing.current && result.data) {
      refreshing.current = false;
      toast(t('reporting_updated'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.data]);

  if (def.loading && !def.data) return <Card><Loading /></Card>;
  const d = def.data;
  if (!d) return <Card><Empty text={t('empty')} /></Card>;
  const runnable = !!(d.builtin || d.custom);
  const filename = `${d.code}-${new Date().toISOString().slice(0, 10)}`;
  const canDelete = d.kind === 'custom' && (d.ownerId === user.id || user.role === 'admin');

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('reporting_title'), to: '/reporting' }, { label: d.code }]}
        title={loc(d.name)}
        subtitle={`${loc(d.description)} · ${t('reporting_owner')}: ${lk.user(d.ownerId)?.fullName ?? ''}`}
        actions={
          <>
            <Badge tone="info">{t(tk('reporting_schedule_', d.schedule))}</Badge>
            {d.kind === 'custom' && <Badge tone="muted">{d.shared ? p('общий', 'umumiy', 'shared') : p('личный', 'shaxsiy', 'personal')}</Badge>}
            {d.custom && (
              <Select<string>
                value={String(periodDays ?? d.custom.periodDays)}
                onChange={(v) => setPeriodDays(Number(v) as ReportBuilderQuery['periodDays'])}
                ariaLabel={t('reporting_period')}
                options={PERIODS.map((x) => ({ value: String(x), label: t(tk('reporting_period_', String(x))) }))}
              />
            )}
            {!runnable && d.link && (
              <Link to={d.link} className="btn btn-primary">
                {t('reporting_open_module')} →
              </Link>
            )}
            {runnable && (
              <button
                className="btn"
                disabled={result.loading}
                onClick={() => {
                  refreshing.current = true;
                  setTick((n) => n + 1);
                }}
              >
                {t('reporting_refresh')}
              </button>
            )}
            {runnable && (
              <button
                className="btn btn-primary"
                disabled={!result.data}
                onClick={() => {
                  if (!result.data) return;
                  downloadCsv(result.data, lang, filename);
                  toast(t('reporting_exported'));
                }}
              >
                <Icon name="file" size={15} /> {t('reporting_export_csv')}
              </button>
            )}
            {runnable && result.data && <ReportExports id={d.id} code={d.code} result={result.data} filename={filename} />}
            {d.link && runnable && (
              <Link to={d.link} className="btn">
                {t('reporting_open_module')} →
              </Link>
            )}
            {canDelete && (
              <Button
                danger
                size="small"
                onClick={async () => {
                  if (!window.confirm(p('Удалить отчёт из каталога?', 'Hisobot katalogdan o‘chirilsinmi?', 'Delete the report from the catalog?'))) return;
                  try {
                    await reportingApi.deleteCustomReport(d.id, user);
                    toast(p('Отчёт удалён', 'Hisobot o‘chirildi', 'Report deleted'));
                    navigate('/reporting');
                  } catch (e) {
                    const m = e instanceof Error ? e.message : String(e);
                    toast(m.startsWith('reporting_') ? t(m as never) : userMessage(m));
                  }
                }}
              >
                {p('Удалить', 'O‘chirish', 'Delete')}
              </Button>
            )}
          </>
        }
      />
      {result.loading && !result.data ? (
        <Card>
          <Loading />
        </Card>
      ) : result.data ? (
        <ReportView result={result.data} />
      ) : (
        <Card>
          <Empty text={t('reporting_not_builtin')} icon="chart" />
          {d.link && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 18 }}>
              <Link to={d.link} className="btn">
                {t('reporting_open_module')} →
              </Link>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
