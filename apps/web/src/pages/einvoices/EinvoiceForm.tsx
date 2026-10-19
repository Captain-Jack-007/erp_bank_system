import { useState } from 'react';
import {
  api, assetsApi, einvoicesApi, einvoiceTotals, formatDate, formatMoney, pick, tk, today,
  type EinvoiceBasis, type EinvoiceKind, type EinvoiceLine, type EinvoiceReconciliation, type Lang,
} from '@xb/shared';
import { Button, Card, Empty, Field, Input, PageHeader, RouteSteps, Select, Textarea, useToast } from '../../components/ui';
import { navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { OrgUnitSelect } from '../documents/p2docs';

// Единица измерения по умолчанию — «услуга» на языке интерфейса (поле редактируемое).
const emptyLine = (lang: Lang): EinvoiceLine => ({ name: '', qty: 1, unit: pick(lang, 'усл', 'xizmat', 'service'), unitPrice: 0 });
const KINDS: EinvoiceKind[] = ['invoice', 'work_act', 'reconciliation_act', 'free_form'];
const BASES: EinvoiceBasis[] = ['service', 'goods', 'asset_sale', 'asset_transfer', 'lease', 'other'];

export function EinvoiceFormPage() {
  const { t, lang } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const toast = useToast();
  const contracts = useApi(() => api.listContracts());
  const assets = useApi(() => assetsApi.list({ includeDisposed: true }));
  const [kind, setKind] = useState<EinvoiceKind>('invoice');
  const [issuer, setIssuer] = useState(user.departmentId);
  const [counterpartyId, setCounterpartyId] = useState('');
  const [contractId, setContractId] = useState('');
  const [date, setDate] = useState(today());
  const [basis, setBasis] = useState<EinvoiceBasis>('service');
  const [basisRef, setBasisRef] = useState('');
  const [assetId, setAssetId] = useState('');
  const [text, setText] = useState('');
  const [lines, setLines] = useState<EinvoiceLine[]>(() => [emptyLine(lang)]);
  const [recFrom, setRecFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [recTo, setRecTo] = useState(today());
  const [rec, setRec] = useState<EinvoiceReconciliation | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const isRec = kind === 'reconciliation_act';
  const isFree = kind === 'free_form';
  const effLines: EinvoiceLine[] = isRec ? (rec ? [{ name: pick(lang, `Сальдо взаиморасчётов на ${formatDate(rec.periodTo)}`, `${formatDate(rec.periodTo)} holatiga qoldiq`, `Balance as of ${formatDate(rec.periodTo)}`), qty: 1, unit: pick(lang, 'док', 'hujjat', 'doc'), unitPrice: rec.closing }] : []) : isFree ? [{ name: text.trim().slice(0, 80) || '—', qty: 1, unit: pick(lang, 'док', 'hujjat', 'doc'), unitPrice: Math.max(0, lines[0]?.unitPrice ?? 0) }] : lines;
  const totals = einvoiceTotals(effLines, isRec || isFree ? 0 : 12);
  const linesValid = isRec ? !!rec : isFree ? !!text.trim() : lines.every((l) => l.name.trim() && l.qty > 0 && l.unitPrice > 0);
  const valid = counterpartyId && date && linesValid;
  const cpContracts = (contracts.data ?? []).filter((k) => k.counterpartyId === counterpartyId);
  const setLine = (i: number, patch: Partial<EinvoiceLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const activeCps = lk.counterparties.filter((c) => !c.blocked);
  const assetOptions = (assets.data ?? []).filter((a) => (basis === 'lease' ? a.status === 'leased_out' || !!a.lease : ['sold', 'pending_transfer', 'pending_writeoff', 'in_use', 'leased_out'].includes(a.status)));

  function addAsset(id: string) {
    setAssetId(id);
    const a = assets.data?.find((x) => x.id === id);
    if (!a) return;
    const price = basis === 'lease' && a.lease ? a.lease.monthly : Math.max(1, a.cost - a.accumulated);
    const line = { name: `${a.name} (${a.inventoryNo})`, qty: 1, unit: pick(lang, 'шт', 'dona', 'pcs'), unitPrice: price };
    setLines((ls) => (ls.length === 1 && !ls[0]!.name.trim() ? [line] : [...ls, line]));
    if (!basisRef) setBasisRef(a.inventoryNo);
  }

  async function build() {
    if (!counterpartyId) return setShowErrors(true);
    setRec(await einvoicesApi.buildReconciliation(counterpartyId, recFrom, recTo));
  }

  async function save(submit: boolean) {
    if (!valid) return setShowErrors(true);
    setBusy(true);
    try {
      const doc = await einvoicesApi.create(
        {
          kind,
          counterpartyId,
          ...(contractId ? { contractId } : {}),
          date,
          lines: effLines.map((l) => ({ ...l, name: l.name.trim() })),
          ...(issuer ? { issuerUnitKey: issuer } : {}),
          ...(!isRec ? { basis } : {}),
          ...(basisRef.trim() ? { basisRef: basisRef.trim() } : {}),
          ...(text.trim() ? { text: text.trim() } : {}),
          ...(isRec && rec ? { reconciliation: rec } : {}),
          submit,
        },
        user,
      );
      toast(`${doc.number}: ${submit ? t('hist_submitted') : t('einvoices_status_draft')}`);
      navigate(`/einvoices/${doc.id}`);
    } catch {
      toast(t('einvoices_actionError'));
    } finally {
      setBusy(false);
    }
  }

  if (!can('einvoices', 'edit')) {
    return (
      <>
        <PageHeader crumbs={[{ label: t('einvoices_title'), to: '/einvoices' }, { label: t('einvoices_new') }]} title={t('einvoices_new')} />
        <Card><Empty text={t('noAccess')} icon="alert" /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader crumbs={[{ label: t('einvoices_title'), to: '/einvoices' }, { label: t('einvoices_new') }]} title={t('einvoices_new')} subtitle={pick(lang, 'Оформление подразделением ЦА / региональным центром и отправка клиенту через оператора ЭСФ', 'MA bo‘linmasi / hududiy markaz tomonidan rasmiylashtirish va EHF operatori orqali mijozga yuborish', 'Issued by a head-office unit / regional centre and sent to the client via the e-invoice operator')} />
      <Card title={t('details')}>
        <div className="form-grid">
          <Field label={pick(lang, 'Вид документа', 'Hujjat turi', 'Document kind')} required>
            <Select<EinvoiceKind> value={kind} onChange={(v) => { setKind(v); setRec(null); }} options={KINDS.map((k) => ({ value: k, label: t(tk('einvoices_kind_', k)) }))} ariaLabel={pick(lang, 'Вид документа', 'Hujjat turi', 'Document kind')} />
          </Field>
          <Field label={pick(lang, 'Подразделение-оформитель', 'Rasmiylashtiruvchi bo‘linma', 'Issuing unit')} required>
            <OrgUnitSelect value={issuer} onChange={setIssuer} />
          </Field>
          <Field label={t('einvoices_buyer')} required error={showErrors && !counterpartyId ? t('formRequired') : undefined}>
            <Select
              value={counterpartyId}
              placeholder="—"
              ariaLabel={t('einvoices_buyer')}
              onChange={(v) => { setCounterpartyId(v); setContractId(''); setRec(null); }}
              options={activeCps.map((c) => ({ value: c.id, label: `${c.name} · ${t('tin')} ${c.tin}` }))}
            />
          </Field>
          <Field label={t('einvoices_contract')}>
            <Select value={contractId} onChange={setContractId} disabled={!cpContracts.length} placeholder={t('einvoices_noContract')} ariaLabel={t('einvoices_contract')} options={cpContracts.map((k) => ({ value: k.id, label: `${k.number} · ${k.subject}` }))} />
          </Field>
          <Field label={t('einvoices_date')} required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} ariaLabel={t('einvoices_date')} />
          </Field>
          <Field label={t('einvoices_seller')}>
            <Input value={t('einvoices_bank')} disabled ariaLabel={t('einvoices_seller')} />
          </Field>
          {!isRec && (
            <>
              <Field label={pick(lang, 'Основание (поставка, продажа, передача ОС, аренда, услуги)', 'Asos (yetkazish, sotish, AV topshirish, ijara, xizmatlar)', 'Basis (supply, sale, asset transfer, lease, services)')}>
                <Select<EinvoiceBasis> value={basis} onChange={(v) => { setBasis(v); setAssetId(''); }} options={BASES.map((b) => ({ value: b, label: t(tk('einvoices_basis_', b)) }))} ariaLabel="basis" />
              </Field>
              <Field label={pick(lang, 'Документ-основание', 'Asos hujjat', 'Basis reference')}>
                <Input value={basisRef} onChange={(e) => setBasisRef(e.target.value)} placeholder={pick(lang, 'Договор, акт, накладная…', 'Shartnoma, dalolatnoma, yuk xati…', 'Contract, act, waybill…')} />
              </Field>
              {(basis === 'asset_sale' || basis === 'asset_transfer' || basis === 'lease') && (
                <Field label={pick(lang, 'Основное средство (модуль ОС)', 'Asosiy vosita (AV moduli)', 'Fixed asset (assets module)')} className="span-2">
                  <Select value={assetId} onChange={addAsset} placeholder="—" ariaLabel="asset" options={assetOptions.map((a) => ({ value: a.id, label: `${a.inventoryNo} · ${a.name} · ${formatMoney(Math.max(0, a.cost - a.accumulated))}` }))} />
                </Field>
              )}
            </>
          )}
          {isFree && (
            <Field label={pick(lang, 'Текст документа', 'Hujjat matni', 'Document text')} required className="span-2" error={showErrors && !text.trim() ? t('formRequired') : undefined}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} ariaLabel={pick(lang, 'Текст документа', 'Hujjat matni', 'Document text')} />
            </Field>
          )}
        </div>
      </Card>

      {isRec ? (
        <Card title={pick(lang, 'Акт сверки: расчёт по данным системы', 'Solishtirma dalolatnomasi: tizim ma’lumotlari bo‘yicha hisob', 'Reconciliation: computed from system data')}>
          <div className="form-grid">
            <Field label={pick(lang, 'Период с', 'Davr boshi', 'Period from')}>
              <Input type="date" value={recFrom} onChange={(e) => setRecFrom(e.target.value)} />
            </Field>
            <Field label={pick(lang, 'Период по', 'Davr oxiri', 'Period to')}>
              <Input type="date" value={recTo} onChange={(e) => setRecTo(e.target.value)} />
            </Field>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <Button onClick={build}>{pick(lang, 'Сформировать по документам и оплатам', 'Hujjatlar va to‘lovlar bo‘yicha shakllantirish', 'Build from documents and payments')}</Button>
            {rec && <span className="muted small">{pick(lang, 'Сальдо', 'Qoldiq', 'Balance')}: <b className="num">{formatMoney(rec.closing)}</b> · {rec.lines.length} {pick(lang, 'строк', 'qator', 'rows')}</span>}
          </div>
          {showErrors && !rec && <p className="error-text">{t('formRequired')}</p>}
          {rec && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr><th>{t('einvoices_date')}</th><th>{pick(lang, 'Документ', 'Hujjat', 'Document')}</th><th className="right">{pick(lang, 'Дебет', 'Debet', 'Debit')}</th><th className="right">{pick(lang, 'Кредит', 'Kredit', 'Credit')}</th></tr>
                </thead>
                <tbody>
                  {rec.lines.length ? rec.lines.map((l, i) => (
                    <tr key={i}><td className="num">{formatDate(l.date)}</td><td>{l.doc}</td><td className="right num">{l.debit ? formatMoney(l.debit) : ''}</td><td className="right num">{l.credit ? formatMoney(l.credit) : ''}</td></tr>
                  )) : <tr><td colSpan={4} className="muted">{t('empty')}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : !isFree ? (
        <Card title={t('einvoices_lines')} actions={<Button size="small" icon="plus" onClick={() => setLines((l) => [...l, emptyLine(lang)])}>{t('addItem')}</Button>} flush>
          <div className="table-wrap">
            <table className="table items-table p2-table-inputs">
              <thead>
                <tr>
                  <th style={{ width: '42%' }}>{t('itemName')}</th>
                  <th style={{ width: 90 }}>{t('qty')}</th>
                  <th style={{ width: 80 }}>{t('unit')}</th>
                  <th style={{ width: 160 }}>{t('unitPrice')}</th>
                  <th className="right">{t('einvoices_net')}</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td><Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} ariaLabel={t('itemName')} /></td>
                    <td><Input type="number" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} ariaLabel={t('qty')} /></td>
                    <td><Input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} ariaLabel={t('unit')} /></td>
                    <td><Input type="number" value={l.unitPrice || ''} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} ariaLabel={t('unitPrice')} /></td>
                    <td className="right num">{formatMoney(Math.round(l.qty * l.unitPrice))}</td>
                    <td>
                      <Button type="text" size="small" icon="trash" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} title="Remove" />
                    </td>
                  </tr>
                ))}
                <tr><td colSpan={4} className="right muted">{t('einvoices_net')}</td><td className="right num">{formatMoney(totals.net)}</td><td /></tr>
                <tr><td colSpan={4} className="right muted">{t('einvoices_vat')}</td><td className="right num">{formatMoney(totals.vat)}</td><td /></tr>
                <tr><td colSpan={4} className="right" style={{ fontWeight: 700 }}>{t('einvoices_total')}</td><td className="right num" style={{ fontWeight: 700 }}>{formatMoney(totals.total)}</td><td /></tr>
              </tbody>
            </table>
          </div>
          {showErrors && !linesValid && <p className="error-text" style={{ padding: '0 14px 14px', margin: 0 }}>{t('formRequired')}</p>}
        </Card>
      ) : null}

      <Card title={t('route')}>
        <RouteSteps preview={{ entity: 'einvoice', context: { direction: 'outgoing', subtype: kind, amount: totals.total } }} />
      </Card>

      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate('/einvoices')}>{t('cancel')}</Button>
        <Button disabled={busy} onClick={() => save(false)}>{t('saveDraft')}</Button>
        <Button type="primary" disabled={busy} onClick={() => save(true)}>{t('submitForApproval')}</Button>
      </div>
    </>
  );
}
