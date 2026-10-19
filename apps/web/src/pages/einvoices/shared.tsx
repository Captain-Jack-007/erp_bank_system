// Общие элементы модуля счетов-фактур: печатные формы (документ с QR, мемориальный ордер), подписи сторон.
import { einvoiceTotals, EINVOICE_BANK_TIN, formatDate, formatMoney, pick, tk, type Contract, type Counterparty, type EinvoiceDoc, type Lang, type PrintDocument, type TKey } from '@xb/shared';

/** Реквизиты банка-покупателя/продавца в документах (демо). */
export const BANK_TIN = EINVOICE_BANK_TIN;

type T = (k: TKey) => string;

/** Печатная форма документа (счёт-фактура / акт / акт сверки / свободная форма) с QR проверки (PR-EHF-028, 039, 048). */
export function einvoicePrintDoc(d: EinvoiceDoc, ctx: { t: T; lang: Lang; cp?: Counterparty; contract?: Contract; signerName?: string; confirmName?: string }): PrintDocument {
  const { t, lang, cp } = ctx;
  const incoming = d.direction === 'incoming';
  const bank = `${t('einvoices_bank')} (${t('tin')} ${BANK_TIN})`;
  const other = `${cp?.name ?? '—'} (${t('tin')} ${cp?.tin ?? '—'})`;
  const fields = [
    { label: t('einvoices_seller'), value: incoming ? other : bank },
    { label: t('einvoices_buyer'), value: incoming ? bank : other },
    { label: t('einvoices_contract'), value: ctx.contract ? `${ctx.contract.number} · ${ctx.contract.subject}` : t('einvoices_noContract') },
    { label: t('einvoices_operatorId'), value: d.operatorId },
    { label: t('status'), value: t(tk('einvoices_status_', d.status)) },
  ];
  const signers = [
    { role: pick(lang, 'Главный бухгалтер', 'Bosh buxgalter', 'Chief accountant'), name: ctx.signerName ?? '', ...(d.signatureIds?.[0] ? { signatureId: d.signatureIds[0] } : {}) },
    ...(d.assignment?.decision === 'confirmed' ? [{ role: pick(lang, 'Подтвердило подразделение', 'Bo‘linma tasdiqladi', 'Confirmed by unit'), name: ctx.confirmName ?? '', position: ctx.lang === 'ru' ? d.assignment.unitName.ru : d.assignment.unitName.uz }] : []),
  ];
  const base = { entity: 'einvoice', entityId: d.id, title: `${t(tk('einvoices_kind_', d.kind))} № ${d.number}`, number: d.number, date: d.date, place: pick(lang, 'г. Ташкент', 'Toshkent sh.', 'Tashkent'), fields, signers };
  if (d.kind === 'reconciliation_act' && d.reconciliation) {
    const r = d.reconciliation;
    return {
      ...base,
      paragraphs: [pick(lang, `Период: ${formatDate(r.periodFrom)} — ${formatDate(r.periodTo)}. Сальдо на начало: ${formatMoney(r.opening)}. Сальдо на конец: ${formatMoney(r.closing)}.`, `Davr: ${formatDate(r.periodFrom)} — ${formatDate(r.periodTo)}. Boshlang‘ich qoldiq: ${formatMoney(r.opening)}. Yakuniy qoldiq: ${formatMoney(r.closing)}.`, `Period: ${formatDate(r.periodFrom)} — ${formatDate(r.periodTo)}. Opening balance: ${formatMoney(r.opening)}. Closing balance: ${formatMoney(r.closing)}.`)],
      table: {
        columns: [{ header: t('einvoices_date') }, { header: pick(lang, 'Документ', 'Hujjat', 'Document') }, { header: pick(lang, 'Дебет', 'Debet', 'Debit'), align: 'right' }, { header: pick(lang, 'Кредит', 'Kredit', 'Credit'), align: 'right' }],
        rows: r.lines.map((l) => [formatDate(l.date), l.doc, l.debit ? formatMoney(l.debit) : '', l.credit ? formatMoney(l.credit) : '']),
        totals: ['', pick(lang, 'Итого', 'Jami', 'Total'), formatMoney(r.lines.reduce((s, l) => s + l.debit, 0)), formatMoney(r.lines.reduce((s, l) => s + l.credit, 0))],
      },
    };
  }
  const tot = einvoiceTotals(d.lines, d.vatRate);
  return {
    ...base,
    ...(d.text ? { paragraphs: [d.text] } : {}),
    table: {
      columns: [{ header: t('itemName') }, { header: t('qty'), align: 'right' }, { header: t('unit') }, { header: t('unitPrice'), align: 'right' }, { header: t('einvoices_net'), align: 'right' }, { header: t('einvoices_vat'), align: 'right' }],
      rows: d.lines.map((l) => {
        const net = Math.round(l.qty * l.unitPrice);
        return [l.name, String(l.qty), l.unit, formatMoney(l.unitPrice), formatMoney(net), formatMoney(Math.round((net * d.vatRate) / 100))];
      }),
      totals: [t('einvoices_total'), '', '', '', formatMoney(tot.net), `${formatMoney(tot.vat)} / ${formatMoney(tot.total)}`],
    },
  };
}

/** Мемориальный ордер с QR (PR-EHF-029). */
export function einvoicePaymentPrintDoc(d: EinvoiceDoc, ctx: { lang: Lang; cp?: Counterparty; createdBy?: string }): PrintDocument | null {
  const po = d.paymentOrder;
  if (!po) return null;
  const { lang } = ctx;
  return {
    entity: 'einvoice_payment',
    entityId: d.id,
    title: pick(lang, `Мемориальный ордер № ${po.number}`, `Memorial order № ${po.number}`, `Memorial order No. ${po.number}`),
    number: po.number,
    date: po.createdAt.slice(0, 10),
    fields: [
      { label: pick(lang, 'Дебет', 'Debet', 'Debit'), value: po.debit },
      { label: pick(lang, 'Кредит', 'Kredit', 'Credit'), value: po.credit },
      { label: pick(lang, 'Получатель', 'Oluvchi', 'Beneficiary'), value: `${ctx.cp?.name ?? '—'} · ${po.account} · МФО ${po.mfo}` },
      { label: pick(lang, 'Сумма', 'Summa', 'Amount'), value: formatMoney(po.amount) },
      { label: pick(lang, 'Назначение платежа', "To'lov maqsadi", 'Purpose'), value: po.purpose },
      ...(po.transactionId ? [{ label: pick(lang, 'Транзакция', 'Tranzaksiya', 'Transaction'), value: `${po.transactionId} · ${po.paidAt ? formatDate(po.paidAt) : ''}` }] : []),
    ],
    signers: [
      { role: pick(lang, 'Исполнитель', 'Ijrochi', 'Prepared by'), name: ctx.createdBy ?? '' },
      { role: pick(lang, 'Главный бухгалтер', 'Bosh buxgalter', 'Chief accountant'), name: '' },
    ],
  };
}
