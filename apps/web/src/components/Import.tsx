// Мастер импорта (PR-GEN-019/047): файл → сопоставление колонок → проверка с ошибками → загрузка.
//   <ImportWizard target={importRegistry.get('counterparties')!} />
import { useMemo, useState } from 'react';
import {
  autoMap, buildXlsx, colLetter, importApi, importTemplate, parseCsv, parseXlsx, tk, validateRows, XLSX_MIME,
  type ImportField, type ImportIssue, type ImportLogEntry, type TKey, type ImportMapping, type ImportMode, type ImportTarget, type ParsedSheet, type ValidatedRow,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Field, Input, Pagination, Select, Stat, Steps, Upload, useToast } from './ui';
import { decodeText, downloadBytes, inflateRaw, readFileBytes, safeFilename } from './download';
import { useSession, useUser } from '../lib/session';

const PAGE = 20;

export function useFieldRules() {
  const { t, loc } = useSession();
  return (f: ImportField): string => {
    const parts = [t(tk('svc_type_', f.type))];
    if (f.required) parts.push(t('svc_required'));
    if (f.unique) parts.push(t('svc_unique'));
    if (f.options) parts.push(f.options.map((o) => loc(o.label)).join(', '));
    if (f.patternHint) parts.push(f.patternHint);
    if (f.min !== undefined || f.max !== undefined) parts.push(`${f.min ?? ''}…${f.max ?? ''}`);
    if (f.maxLength) parts.push(`≤ ${f.maxLength}`);
    return parts.join(' · ');
  };
}

/** Скачать шаблон загрузки для цели импорта. */
export function useTemplateDownload() {
  const { t, lang, loc } = useSession();
  return (target: ImportTarget) => {
    const sheets = importTemplate(target, lang, {
      field: t('svc_tplField'),
      type: t('svc_tplType'),
      required: t('svc_tplRequired'),
      values: t('svc_tplValues'),
      yes: t('svc_yes'),
      no: t('svc_no'),
      instruction: t('svc_tplInstruction'),
      types: {
        string: t('svc_type_string'), number: t('svc_type_number'), integer: t('svc_type_integer'), date: t('svc_type_date'), tin: t('svc_type_tin'),
        enum: t('svc_type_enum'), boolean: t('svc_type_boolean'), email: t('svc_type_email'), phone: t('svc_type_phone'),
      },
    });
    downloadBytes(safeFilename(`${loc(target.name)} — template`, 'xlsx'), XLSX_MIME, buildXlsx(sheets));
  };
}

export function ImportWizard({ target, onDone }: { target: ImportTarget; onDone?: (entry: ImportLogEntry) => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const rules = useFieldRules();
  const downloadTemplate = useTemplateDownload();
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [mode, setMode] = useState<ImportMode>('create');
  const [rows, setRows] = useState<ValidatedRow[]>([]);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportLogEntry | null>(null);

  const sheet = sheets[sheetIdx];
  const headers = useMemo(() => (sheet?.rows[headerRow - 1] ?? []).map((h) => String(h ?? '').trim()), [sheet, headerRow]);
  const data = useMemo(() => sheet?.rows.slice(headerRow) ?? [], [sheet, headerRow]);

  function reset() {
    setStep(0);
    setFileName('');
    setSheets([]);
    setRows([]);
    setResult(null);
    setError('');
    setPage(1);
    setOnlyErrors(false);
  }

  async function onFile(file: File) {
    setError('');
    setBusy(true);
    try {
      const bytes = await readFileBytes(file);
      const ext = file.name.toLowerCase().split('.').pop();
      let parsed: ParsedSheet[];
      if (ext === 'xlsx') parsed = await parseXlsx(bytes, inflateRaw);
      else if (ext === 'csv' || ext === 'txt') parsed = [{ name: file.name, rows: parseCsv(decodeText(bytes)) }];
      else throw new Error('format');
      parsed = parsed.filter((s) => s.rows.some((r) => r.some((c) => c.trim())));
      if (!parsed.length) {
        setError(t('svc_importEmpty'));
        return;
      }
      setSheets(parsed);
      setSheetIdx(0);
      const first = parsed[0]!;
      const hr = Math.max(1, first.rows.findIndex((r) => r.filter((c) => c.trim()).length >= Math.min(2, target.fields.length)) + 1);
      setHeaderRow(hr);
      setMapping(autoMap((first.rows[hr - 1] ?? []).map(String), target.fields));
      setFileName(file.name);
      setStep(1);
    } catch {
      setError(t('svc_importParseError'));
    } finally {
      setBusy(false);
    }
  }

  function changeSheet(i: number) {
    setSheetIdx(i);
    const s = sheets[i];
    if (s) setMapping(autoMap((s.rows[headerRow - 1] ?? []).map(String), target.fields));
  }
  function changeHeader(n: number) {
    const v = Math.max(1, Math.min(n || 1, Math.max(1, (sheet?.rows.length ?? 1))));
    setHeaderRow(v);
    setMapping(autoMap((sheet?.rows[v - 1] ?? []).map(String), target.fields));
  }

  const unmappedRequired = target.fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0);

  async function check() {
    if (unmappedRequired.length) {
      setError(`${t('svc_importRequiredUnmapped')}: ${unmappedRequired.map((f) => loc(f.label)).join(', ')}`);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const existing = await importApi.existing(target.id);
      const base = validateRows(data, mapping, target, existing, headerRow + 1, mode);
      setRows(await importApi.extraValidate(target.id, base));
      setPage(1);
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  const okRows = rows.filter((r) => r.ok && (mode === 'upsert' || !r.exists));
  const errRows = rows.filter((r) => !r.ok);
  const existRows = rows.filter((r) => r.exists);
  const shown = onlyErrors ? errRows : rows;

  async function commit() {
    if (!okRows.length) {
      setError(t('svc_importNothing'));
      return;
    }
    setBusy(true);
    try {
      const entry = await importApi.commit(target.id, rows, user, fileName, mode);
      setResult(entry);
      setStep(3);
      toast(t('svc_importDoneTitle'));
      onDone?.(entry);
    } catch {
      setError(t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  function errorReport() {
    const cols = [{ header: t('svc_importLine'), format: 'integer' as const }, ...target.fields.map((f) => ({ header: loc(f.label), format: 'text' as const })), { header: t('svc_importErrors'), width: 60 }];
    const body = rows
      .filter((r) => r.issues.length)
      .map((r) => [r.line, ...target.fields.map((f) => r.raw[f.key] ?? ''), r.issues.map((i) => `${loc(target.fields.find((f) => f.key === i.field)?.label ?? { ru: i.field, uz: i.field })}: ${issueMsg(i)}${i.value && !i.detail ? ` («${i.value}»)` : ''}`).join('; ')]);
    downloadBytes(safeFilename(`${loc(target.name)} — errors`, 'xlsx'), XLSX_MIME, buildXlsx([{ name: t('svc_importErrors'), title: `${fileName} · ${loc(target.name)}`, columns: cols, rows: body }]));
  }

  const preview = target.fields.slice(0, 4);
  const issueMsg = (i: ImportIssue) => `${i.messageKey ? t(i.messageKey as TKey) : t(tk('svc_issue_', i.code))}${i.detail ? ` (${i.detail})` : ''}`;
  const issueText = (r: ValidatedRow) => (
    <ul className="svc-issues">
      {r.issues.map((i, k) => (
        <li key={k} className={i.severity}>
          {loc(target.fields.find((f) => f.key === i.field)?.label ?? { ru: i.field, uz: i.field })}: {issueMsg(i)}
        </li>
      ))}
    </ul>
  );

  return (
    <Card
      title={loc(target.name)}
      actions={
        <Button size="small" icon="download" onClick={() => downloadTemplate(target)}>
          {t('svc_importTemplate')}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="import-wizard" data-step={step}>
        <Steps current={step} items={[{ title: t('svc_importStepUpload') }, { title: t('svc_importStepMap') }, { title: t('svc_importStepCheck') }, { title: t('svc_importStepDone') }]} />
        <div className="muted small">{loc(target.description)}</div>

        {step === 0 && (
          <Upload dragger accept=".xlsx,.csv,.txt" disabled={busy} onFiles={(fs) => void onFile(fs[0]!)} hint={t('svc_importFormats')} ariaLabel={t('svc_importNoFile')}>
            {t('svc_importDrop')}
          </Upload>
        )}

        {step === 1 && sheet && (
          <>
            <div className="form-grid">
              <Field label={t('svc_importFile')}>
                <Input value={fileName} readOnly ariaLabel={t('svc_importFile')} />
              </Field>
              {sheets.length > 1 ? (
                <Field label={t('svc_importSheet')}>
                  <Select value={sheetIdx} onChange={(v) => changeSheet(Number(v))} options={sheets.map((s, i) => ({ value: i, label: s.name }))} ariaLabel={t('svc_importSheet')} />
                </Field>
              ) : (
                <Field label={t('svc_importRows')}>
                  <Input value={String(data.filter((r) => r.some((c) => c.trim())).length)} readOnly ariaLabel={t('svc_importRows')} />
                </Field>
              )}
              <Field label={t('svc_importHeaderRow')}>
                <Input type="number" value={headerRow} onChange={(e) => changeHeader(Number(e.target.value))} ariaLabel={t('svc_importHeaderRow')} />
              </Field>
              <Field label={t('svc_importMode')}>
                <Select<ImportMode> value={mode} onChange={setMode} ariaLabel={t('svc_importMode')} options={[{ value: 'create', label: t('svc_importModeCreate') }, { value: 'upsert', label: t('svc_importModeUpsert') }]} />
              </Field>
            </div>
            <DataTable
              rows={target.fields}
              rowKey={(f) => f.key}
              columns={[
                { header: t('svc_importField'), render: (f) => <span style={{ fontWeight: 600 }}>{loc(f.label)}{f.required && <span className="req" style={{ color: 'var(--danger)' }}> *</span>}</span> },
                {
                  header: t('svc_importColumn'),
                  render: (f) => (
                    <Select<number>
                      value={mapping[f.key] ?? -1}
                      ariaLabel={`map-${f.key}`}
                      onChange={(v) => setMapping((m) => ({ ...m, [f.key]: Number(v) }))}
                      options={[{ value: -1, label: t('svc_importSkip') }, ...headers.map((h, i) => ({ value: i, label: `${colLetter(i)}: ${h || '—'}` }))]}
                    />
                  ),
                },
                { header: t('svc_importSample'), render: (f) => <span className="muted">{(mapping[f.key] ?? -1) >= 0 ? data.find((r) => (r[mapping[f.key]!] ?? '').trim())?.[mapping[f.key]!] ?? '' : '—'}</span> },
                { header: t('svc_importRules'), render: (f) => <span className="small muted">{rules(f)}</span> },
              ]}
            />
          </>
        )}

        {step === 2 && (
          <>
            <div className="svc-stat-row">
              <Stat label={t('svc_importRows')} value={rows.length} />
              <Stat label={t('svc_importValid')} value={okRows.length} tone="accent" />
              <Stat label={t('svc_importInvalid')} value={errRows.length} tone={errRows.length ? 'alert' : undefined} />
              <Stat label={t('svc_importExisting')} value={existRows.length} />
            </div>
            <div className="svc-spread">
              <Checkbox checked={onlyErrors} onChange={(v) => { setOnlyErrors(v); setPage(1); }}>
                {t('svc_importOnlyErrors')}
              </Checkbox>
              <Button size="small" icon="download" disabled={!rows.some((r) => r.issues.length)} onClick={errorReport}>
                {t('svc_importErrorReport')}
              </Button>
            </div>
            <div className="card" style={{ boxShadow: 'none' }}>
              <DataTable
                rows={shown.slice((page - 1) * PAGE, page * PAGE)}
                rowKey={(r) => String(r.line)}
                emptyText={t('empty')}
                columns={[
                  { header: t('svc_importLine'), render: (r) => <span className="num">{r.line}</span>, width: 60 },
                  {
                    header: t('svc_intStatus'),
                    render: (r) => (!r.ok ? <Badge tone="danger">{t('svc_importInvalid')}</Badge> : r.exists ? <Badge tone="warn">{t('svc_importExisting')}</Badge> : <Badge tone="ok">{t('svc_importValid')}</Badge>),
                  },
                  ...preview.map((f) => ({
                    header: loc(f.label),
                    render: (r: ValidatedRow) => <span className={r.issues.some((i) => i.field === f.key && i.severity === 'error') ? 'svc-cell-err' : undefined}>{r.raw[f.key] || '—'}</span>,
                  })),
                  { header: t('svc_importErrors'), render: (r) => (r.issues.length ? issueText(r) : <span className="muted">—</span>) },
                ]}
              />
              <Pagination current={page} pageSize={PAGE} total={shown.length} onChange={(p) => setPage(p)} />
            </div>
          </>
        )}

        {step === 3 && result && (
          <>
            <div className="svc-stat-row" data-testid="import-result">
              {result.pending > 0 ? (
                <Stat label={t('svc_importPending')} value={result.pending} tone="accent" foot={t('svc_importPendingHint')} />
              ) : (
                <Stat label={t('svc_importCreated')} value={result.created} tone="accent" />
              )}
              <Stat label={t('svc_importUpdated')} value={result.updated} />
              <Stat label={t('svc_importSkipped')} value={result.skipped} />
              <Stat label={t('svc_importInvalid')} value={result.errors} tone={result.errors ? 'alert' : undefined} />
            </div>
          </>
        )}

        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}

        <div className="svc-spread">
          <div>
            {step > 0 && step < 3 && (
              <Button icon="arrowLeft" onClick={() => (step === 1 ? reset() : setStep(step - 1))}>
                {t('svc_back')}
              </Button>
            )}
          </div>
          <div className="svc-row">
            {step === 1 && (
              <Button type="primary" loading={busy} onClick={check}>
                {t('svc_next')}
              </Button>
            )}
            {step === 2 && (
              <Button type="primary" icon="upload" loading={busy} disabled={!okRows.length} onClick={commit}>
                {t('svc_importRun')} ({okRows.length})
              </Button>
            )}
            {step === 3 && <Button onClick={reset}>{t('svc_importAgain')}</Button>}
          </div>
        </div>
      </div>
    </Card>
  );
}
