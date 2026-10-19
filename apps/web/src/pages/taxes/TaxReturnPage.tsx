import { useState } from 'react';
import { decimalSep, formatDate, formatDateTime, formatMoney, formatNumber, taxesApi, tk, type PrintDocument, type TaxReturnView, type TKey, userError } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Field, Loading, Modal, PageHeader, Timeline, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { downloadBytes } from '../../components/download';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { DueBadge, TaxStatus } from './TaxesPage';
import { qty, useBranches, useErrText, useP } from './common';

const REGISTRY_TYPES = ['property', 'land', 'water', 'rent_pit', 'profit', 'vat'];

export function TaxReturnPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const errText = useErrText();
  const can = useCan();
  const br = useBranches();
  const ret = useApi(() => taxesApi.getReturn(id), [id]);
  const filing = useApi(() => taxesApi.getFiling(id), [id]);
  const settings = useApi(() => taxesApi.listSettings());
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);

  if (ret.loading && !ret.data) return <Card><Loading /></Card>;
  const r = ret.data;
  if (!r) return <Card><Empty text={t('empty')} /></Card>;

  const canAct = can('taxes', 'edit');
  const editable = canAct && (r.status === 'draft' || r.status === 'calculated');
  const setting = settings.data?.find((s) => s.type === r.type);
  const perLine = r.baseLines.length > 0 && r.baseLines.every((l) => l.tax !== undefined);
  const hasBranches = r.baseLines.some((l) => l.branchKey);
  const unit = r.baseLines[0]?.unit;

  /** Перевод системного комментария «@taxes_hist_x|сумма|номер». */
  function histComment(c: string): string {
    if (!c.startsWith('@taxes_')) return c;
    const [key, v, ref] = c.slice(1).split('|');
    return t(key as TKey).replace('{v}', v ? formatMoney(Number(v)) : '').replace('{ref}', ref ?? '');
  }

  async function run(fn: () => Promise<void>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast(`${r!.number}: ${msg}`);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  }

  // Разрез по филиалам: база и доля налога.
  const byBranch = new Map<string, { base: number; tax: number; lines: number }>();
  for (const l of r.baseLines) {
    const k = l.branchKey ?? 'HO';
    const x = byBranch.get(k) ?? { base: 0, tax: 0, lines: 0 };
    x.base += l.amount;
    x.tax += l.tax ?? 0;
    x.lines++;
    byBranch.set(k, x);
  }
  const branchRows = [...byBranch.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.base - a.base);

  const printDoc = (): PrintDocument => ({
    entity: 'tax_return',
    entityId: r.id,
    title: `${t(tk('taxes_type_', r.type))} · ${r.period}`,
    number: r.number,
    date: (r.calc?.calculatedAt ?? r.history[0]?.at ?? '').slice(0, 10),
    fields: [
      { label: p('Налогоплательщик', "Soliq to'lovchi", 'Taxpayer'), value: 'АКБ «Народный банк» (демо), ИНН 200000001' },
      { label: t('taxes_period'), value: r.period },
      { label: t('taxes_due'), value: formatDate(r.dueDate) },
      { label: t('status'), value: t(tk('taxes_status_', r.status)) },
      { label: t('taxes_base'), value: qty(r.base, unit) },
      { label: t('taxes_amount'), value: formatMoney(r.amount) },
    ],
    table: {
      columns: [{ header: '№' }, { header: p('Филиал', 'Filial', 'Branch') }, { header: p('Строка', 'Satr', 'Line') }, { header: t('taxes_base'), align: 'right' }, { header: p('Налог', 'Soliq', 'Tax'), align: 'right' }],
      rows: r.baseLines.map((l, i) => [String(i + 1), l.branchKey ?? 'HO', `${loc(l.label)}${l.ref ? ` (${l.ref})` : ''}`, qty(l.amount, l.unit), l.tax !== undefined ? formatMoney(l.tax) : '—']),
      totals: ['', '', t('taxes_base'), qty(r.base, unit), r.calc ? formatMoney(r.calc.gross) : ''],
    },
    signers: [{ role: p('Главный бухгалтер', 'Bosh buxgalter', 'Chief Accountant'), name: '' }, { role: p('Исполнитель', 'Ijrochi', 'Prepared by'), name: user.fullName }],
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('taxes_title'), to: '/taxes' }, { label: r.number }]}
        title={`${t(tk('taxes_type_', r.type))} · ${r.period}`}
        subtitle={`${r.number} · ${t('taxes_due')}: ${formatDate(r.dueDate)}`}
        actions={
          <>
            <DueBadge r={r} />
            <TaxStatus status={r.status} />
            {editable && REGISTRY_TYPES.includes(r.type) && (
              <button className="btn" disabled={busy} onClick={() => run(() => taxesApi.fillFromRegistry(r.id, user), p('строки заполнены из реестров', "satrlar reyestrlardan to'ldirildi", 'lines filled from registries'))}>
                {p('Заполнить из реестров', "Reyestrlardan to'ldirish", 'Fill from registries')}
              </button>
            )}
            {canAct && (r.status === 'draft' || r.status === 'calculated') && (
              <button className={`btn ${r.status === 'draft' ? 'btn-primary' : ''}`} disabled={busy} onClick={() => run(() => taxesApi.calculate(r.id, user), t('taxes_calculated'))}>
                {r.status === 'draft' ? t('taxes_calculate') : t('taxes_recalculate')}
              </button>
            )}
            {canAct && r.status === 'calculated' && (
              <button className="btn btn-primary" disabled={busy} onClick={() => run(() => taxesApi.submit(r.id, user), t('taxes_submittedToast'))}>
                {t('taxes_submit')}
              </button>
            )}
            {canAct && r.status === 'submitted' && (
              <button className="btn" disabled={busy} onClick={() => run(() => taxesApi.accept(r.id, user), t('taxes_acceptedToast'))}>
                {t('taxes_accept')}
              </button>
            )}
            {canAct && r.calc && r.outstanding > 0 && (
              <button className="btn btn-primary" disabled={busy} onClick={() => setPaying(true)}>
                {t('taxes_pay')}
              </button>
            )}
          </>
        }
      />
      {!canAct && <p className="muted small" style={{ margin: 0 }}>{t('taxes_onlyFinance')}</p>}

      <div className="grid grid-main">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Card
            title={t('taxes_baseLines')}
            flush
            actions={
              <ExportButton
                filename={`${r.number}-lines`}
                rows={r.baseLines}
                columns={[
                  { header: p('Филиал', 'Filial', 'Branch'), value: (l) => l.branchKey ?? 'HO' },
                  { header: p('Строка', 'Satr', 'Line'), value: (l) => loc(l.label) },
                  { header: p('Объект', 'Obyekt', 'Object'), value: (l) => l.ref ?? '' },
                  { header: t('taxes_base'), value: (l) => l.amount, format: 'number', total: true },
                  { header: p('Налог (год)', 'Soliq (yil)', 'Tax (annual)'), value: (l) => l.tax ?? null, format: 'money', total: true },
                ]}
              />
            }
          >
            {editable && !perLine && <div className="muted small" style={{ padding: '12px 18px 0' }}>{t('taxes_editHint')}</div>}
            {r.source === 'registry' && (
              <div className="muted small" style={{ padding: '12px 18px 0' }}>
                {p('Строки сформированы из реестров налоговой базы и ABS; при изменении реестров расчёт пересчитывается автоматически.', "Satrlar soliq bazasi reyestrlari va ABS dan shakllantirilgan; reyestr o'zgarsa, hisob avtomatik qayta hisoblanadi.", 'Lines are built from the tax base registers and ABS; the return is recalculated automatically when registers change.')}
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {r.baseLines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        {loc(l.label)}
                        {(l.branchKey || l.ref) && <div className="sub">{[l.branchKey && br.name(l.branchKey), l.ref].filter(Boolean).join(' · ')}</div>}
                      </td>
                      {perLine && <td className="right num muted small">{l.tax !== undefined ? formatMoney(l.tax) : ''}</td>}
                      <td className="right num" style={{ width: 240 }}>
                        {editable && !perLine ? <AmountInput key={`${i}-${l.amount}`} value={l.amount} onSave={(v) => taxesApi.updateBaseLine(r.id, i, v, user)} /> : qty(l.amount, l.unit)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <td style={{ fontWeight: 700 }}>{t('taxes_base')}</td>
                    {perLine && <td className="right num" style={{ fontWeight: 700 }}>{formatMoney(r.baseLines.reduce((s, l) => s + (l.tax ?? 0), 0))}</td>}
                    <td className="right num" style={{ fontWeight: 700 }}>{qty(r.base, unit)}</td>
                  </tr>
                  <tr>
                    <td>{t('taxes_credits')}{r.creditsLabel ? <div className="sub">{loc(r.creditsLabel)}</div> : null}</td>
                    {perLine && <td />}
                    <td className="right num">{editable ? <AmountInput key={`c-${r.credits}`} value={r.credits} min={0} onSave={(v) => taxesApi.updateCredits(r.id, v, user)} /> : formatMoney(r.credits)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {hasBranches && (
            <Card title={p('Разрез по филиалам', "Filiallar kesimida", 'By branch')} flush>
              <DataTable
                rows={branchRows}
                rowKey={(x) => x.key}
                columns={[
                  { header: p('Филиал', 'Filial', 'Branch'), render: (x) => <><b>{x.key}</b> <span className="muted">{br.name(x.key)}</span></> },
                  { header: p('Строк', 'Satrlar', 'Lines'), align: 'right', render: (x) => x.lines },
                  { header: t('taxes_base'), align: 'right', render: (x) => qty(x.base, unit) },
                  ...(perLine ? [{ header: p('Налог (год)', 'Soliq (yil)', 'Tax (annual)'), align: 'right' as const, render: (x: (typeof branchRows)[number]) => formatMoney(x.tax) }] : []),
                  { header: p('Доля', 'Ulush', 'Share'), align: 'right', render: (x) => `${formatNumber(Math.round((perLine ? x.tax / Math.max(1, r.baseLines.reduce((s, l) => s + (l.tax ?? 0), 0)) : x.base / Math.max(1, r.base)) * 1000) / 10)}%` },
                ]}
              />
            </Card>
          )}

          <Card title={t('taxes_payments')} flush>
            <DataTable
              rows={r.payments}
              emptyText={t('taxes_noPayments')}
              rowKey={(pm) => pm.reference}
              columns={[
                { header: t('date'), render: (pm) => <span className="num">{formatDate(pm.date)}</span> },
                { header: t('taxes_reference'), render: (pm) => <span className="doc-num">{pm.reference}</span> },
                { header: t('amount'), align: 'right', render: (pm) => formatMoney(pm.amount) },
              ]}
            />
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title={t('taxes_calcDetail')}>
            {r.calc ? (
              <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
                <dt>{t('taxes_base')}</dt>
                <dd className="num">{qty(r.calc.base, unit)}</dd>
                {perLine ? (
                  <>
                    <dt>{t('taxes_rate')}</dt>
                    <dd className="small">{p('по объектам (реестр ставок)', "obyektlar bo'yicha (stavkalar reyestri)", 'per object (rate register)')}</dd>
                  </>
                ) : (
                  <>
                    <dt>{t('taxes_rate')}</dt>
                    <dd className="num">{String(r.calc.rate).replace('.', decimalSep())}%</dd>
                  </>
                )}
                {r.calc.factor !== 1 && (
                  <>
                    <dt>{t('taxes_factor')}</dt>
                    <dd className="num">{String(r.calc.factor).replace('.', decimalSep())}</dd>
                  </>
                )}
                <dt>{t('taxes_gross')}</dt>
                <dd className="num">{formatMoney(r.calc.gross)}</dd>
                <dt>{t('taxes_credits')}</dt>
                <dd className="num">− {formatMoney(r.calc.credits)}</dd>
                <dt style={{ fontWeight: 700, color: 'var(--text)' }}>{t('taxes_amount')}</dt>
                <dd className="num" style={{ fontWeight: 700, fontSize: 16 }}>{formatMoney(r.calc.amount)}</dd>
                <dt>{t('taxes_paid')}</dt>
                <dd className="num">{formatMoney(r.paid)}</dd>
                <dt>{t('taxes_remaining')}</dt>
                <dd className="num" style={r.outstanding ? { color: r.overdue ? 'var(--danger)' : undefined, fontWeight: 700 } : undefined}>{formatMoney(r.outstanding)}</dd>
              </dl>
            ) : (
              <Empty text={t('taxes_notCalculated')} icon="receipt" />
            )}
            <div className="muted small" style={{ marginTop: 12 }}>{perLine ? p('Налог = Σ (база объекта × ставка объекта) × коэффициент периода − зачёт', "Soliq = Σ (obyekt bazasi × obyekt stavkasi) × davr koeffitsienti − hisob", 'Tax = Σ (object base × object rate) × period factor − credit') : t('taxes_formula')}</div>
            {setting && <div className="muted small" style={{ marginTop: 4 }}>{loc(setting.baseHint)}</div>}
          </Card>

          <Card title={p('Файл для налогового органа', 'Soliq organi uchun fayl', 'Tax authority file')}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                size="small"
                icon="download"
                onClick={async () => {
                  const f = await taxesApi.gnkFile(r.id);
                  downloadBytes(f.fileName, 'application/xml', f.xml);
                  toast(p('Файл сформирован', 'Fayl shakllantirildi', 'File generated'));
                }}
              >
                {p('Скачать XML (формат ГНК)', 'XML yuklab olish (DSQ formati)', 'Download XML (tax format)')}
              </Button>
              <PrintButton doc={printDoc} template="card" label={p('Печать расчёта', 'Hisobni chop etish', 'Print return')} />
            </div>
            {filing.data ? (
              <dl className="kv" style={{ gridTemplateColumns: '1fr auto', marginTop: 12 }}>
                <dt>{p('Файл', 'Fayl', 'File')}</dt>
                <dd className="small" style={{ wordBreak: 'break-all' }}>{filing.data.fileName}</dd>
                <dt>{p('Отправлен', 'Yuborilgan', 'Sent')}</dt>
                <dd className="small">{formatDateTime(filing.data.at)}</dd>
                <dt>{p('Статус обмена', 'Almashinuv holati', 'Exchange status')}</dt>
                <dd><Badge tone={filing.data.status === 'success' ? 'ok' : filing.data.status === 'failed' || filing.data.status === 'quarantined' ? 'danger' : 'warn'}>{filing.data.status}</Badge></dd>
                {filing.data.receipt && (
                  <>
                    <dt>{p('Квитанция', 'Kvitansiya', 'Receipt')}</dt>
                    <dd className="small">{filing.data.receipt}</dd>
                  </>
                )}
              </dl>
            ) : (
              <div className="muted small" style={{ marginTop: 10 }}>{p('Файл передаётся в налоговый орган при отправке расчёта.', "Fayl hisob yuborilganda soliq organiga uzatiladi.", 'The file is sent to the tax authority when the return is submitted.')}</div>
            )}
            {canAct && filing.data && (filing.data.status === 'failed' || filing.data.status === 'queued') && (
              <Button size="small" icon="refresh" style={{ marginTop: 8 }} onClick={() => run(() => taxesApi.resendFiling(r.id, user), p('отправлено повторно', 'qayta yuborildi', 'resent'))}>
                {p('Повторить отправку', 'Qayta yuborish', 'Resend')}
              </Button>
            )}
          </Card>

          <Card title={t('history')}>
            <Timeline events={r.history.map((e) => (e.comment ? { ...e, comment: histComment(e.comment) } : e))} />
          </Card>
        </div>
      </div>
      {paying && <PayModal ret={r} onClose={() => setPaying(false)} />}
    </>
  );
}

/** Поле суммы: сохраняется при потере фокуса или Enter. */
function AmountInput({ value, onSave, min }: { value: number; onSave: (v: number) => Promise<void>; min?: number }) {
  const [text, setText] = useState(formatNumber(value));
  const commit = async () => {
    const raw = text.trim() ? Number(text.replace(/\s/g, '').replace(',', '.')) : NaN;
    const v = Number.isFinite(raw) && min !== undefined ? Math.max(min, raw) : raw;
    if (Number.isFinite(v) && Math.round(v) !== value) await onSave(v);
    else setText(formatNumber(value));
  };
  return (
    <input
      className="input"
      style={{ height: 32, textAlign: 'right' }}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function PayModal({ ret, onClose }: { ret: TaxReturnView; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const [text, setText] = useState(formatNumber(ret.outstanding));
  const [error, setError] = useState('');
  const amount = Number(text.replace(/\s/g, '').replace(',', '.'));
  return (
    <Modal
      title={`${t('taxes_pay')}: ${ret.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (!(amount > 0)) return setError(t('formRequired'));
              if (Math.round(amount) > ret.outstanding) return setError(t('taxes_overpay'));
              try {
                await taxesApi.pay(ret.id, amount, user);
                toast(`${ret.number}: ${t('taxes_paidToast')}`);
                onClose();
              } catch (e) {
                setError(userError(e));
              }
            }}
          >
            {t('taxes_pay')}
          </button>
        </>
      }
    >
      <Field label={t('taxes_paySum')} required error={error} hint={amount > 0 ? formatMoney(amount) : undefined}>
        <input className="input" inputMode="decimal" autoFocus value={text} onChange={(e) => { setText(e.target.value); setError(''); }} />
      </Field>
      <div className="muted small">{t('taxes_remaining')}: {formatMoney(ret.outstanding)}</div>
    </Modal>
  );
}
