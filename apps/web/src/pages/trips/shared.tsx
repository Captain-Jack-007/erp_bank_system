import { formatDate, formatMoney, formatNumber, pick, tripPlace, type Lang, type PrintDocument, type TripCalc, type TripDestination, type TripJournalStatus, type TripRequest, type User } from '@xb/shared';
import type { Tone } from '../../components/ui';
import { useSession } from '../../lib/session';

export const TRIP_TONE: Record<TripJournalStatus, Tone> = {
  draft: 'muted',
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
  report_pending: 'warn',
  closed: 'muted',
  on_trip: 'info',
  report_due: 'warn',
};

/** Расшифровка аванса: суточные (с днями в пути и курсом), проживание, проезд, прочие, итог. */
export function CalcTable({ calc, dest }: { calc: TripCalc; dest?: TripDestination | undefined }) {
  const { t, lang } = useSession();
  const row = (label: string, detail: string, amount: number) => (
    <tr>
      <td>{label}</td>
      <td className="muted small num">{detail}</td>
      <td className="right num">{formatMoney(amount)}</td>
    </tr>
  );
  const usd = dest?.currency === 'USD';
  return (
    <table className="table">
      <tbody>
        {row(t('trips_perDiem'), `${calc.perDiemDays} × ${formatNumber(calc.perDiemRate)}${usd ? ` (${dest!.perDiem} USD × ${formatNumber(calc.rate)})` : ''}`, calc.perDiemTotal)}
        {row(t('trips_cat_hotel'), `${calc.nights} × ${formatNumber(calc.nights ? calc.hotelTotal / calc.nights : 0)}`, calc.hotelTotal)}
        {row(t('trips_cat_transport'), '', calc.transport)}
        {calc.other > 0 && row(pick(lang, 'Виза, страховка, представительские, прочие', 'Viza, sug‘urta, vakillik, boshqa', 'Visa, insurance, hospitality, other'), '', calc.other)}
        <tr>
          <td colSpan={2} style={{ fontWeight: 700 }}>{t('trips_advance')}</td>
          <td className="right num" style={{ fontWeight: 700, fontSize: 15 }}>{formatMoney(calc.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Приказ о направлении в командировку с QR (PR-TRV-003). */
export function tripOrderPrint(tr: TripRequest, ctx: { lang: Lang; emp?: User; dest?: TripDestination; position?: string; hr?: string }): PrintDocument {
  const { lang, emp, dest } = ctx;
  const place = tripPlace(dest, lang);
  return {
    entity: 'trip_order',
    entityId: tr.id,
    title: pick(lang, 'Приказ о направлении работника в командировку', 'Xodimni xizmat safariga yuborish to‘g‘risida buyruq', 'Order on sending an employee on a business trip'),
    number: tr.order?.number ?? '',
    date: (tr.order?.createdAt ?? new Date().toISOString()).slice(0, 10),
    place: pick(lang, 'г. Ташкент', 'Toshkent sh.', 'Tashkent'),
    fields: [
      { label: pick(lang, 'Работник', 'Xodim', 'Employee'), value: `${emp?.fullName ?? tr.employeeId}${ctx.position ? `, ${ctx.position}` : ''}` },
      { label: pick(lang, 'Место назначения', 'Manzil', 'Destination'), value: `${place.city}, ${place.country}` },
      { label: pick(lang, 'Срок', 'Muddat', 'Period'), value: `${formatDate(tr.startDate)} — ${formatDate(tr.endDate)}${tr.travelDays ? ` (+${tr.travelDays} ${pick(lang, 'дн. в пути', 'kun yo‘lda', 'travel days')})` : ''}` },
      { label: pick(lang, 'Цель', 'Maqsad', 'Purpose'), value: tr.purpose },
      { label: pick(lang, 'Аванс', 'Avans', 'Advance'), value: formatMoney(tr.advance) },
      { label: pick(lang, 'Основание', 'Asos', 'Basis'), value: pick(lang, `Заявление ${tr.number}`, `${tr.number} arizasi`, `Application ${tr.number}`) },
    ],
    signers: [
      { role: pick(lang, 'Руководитель', 'Rahbar', 'Manager'), name: '' },
      { role: pick(lang, 'Департамент по работе с персоналом', 'Xodimlar bilan ishlash departamenti', 'HR Department'), name: ctx.hr ?? '', ...(tr.order?.signatureIds?.[0] ? { signatureId: tr.order.signatureIds[0] } : {}) },
    ],
  };
}

/** Авансовый отчёт (печатная форма с QR). */
export function tripReportPrint(tr: TripRequest, lang: Lang, catName: (c: string) => string, emp?: string): PrintDocument {
  const lines = tr.report?.lines ?? [];
  const spent = lines.reduce((s, l) => s + l.amount, 0);
  return {
    entity: 'business_trip_report',
    entityId: tr.id,
    title: pick(lang, 'Авансовый отчёт', 'Avans hisoboti', 'Expense report'),
    number: tr.number,
    date: (tr.report?.submittedAt ?? new Date().toISOString()).slice(0, 10),
    fields: [
      { label: pick(lang, 'Подотчётное лицо', 'Hisobdor shaxs', 'Accountable person'), value: emp ?? tr.employeeId },
      { label: pick(lang, 'Получен аванс', 'Olingan avans', 'Advance received'), value: formatMoney(tr.advance) },
      { label: pick(lang, 'Израсходовано', 'Sarflangan', 'Spent'), value: formatMoney(spent) },
      { label: pick(lang, 'Остаток / перерасход', 'Qoldiq / ortiqcha sarf', 'Balance'), value: formatMoney(spent - tr.advance) },
    ],
    table: {
      columns: [{ header: pick(lang, 'Статья', 'Modda', 'Category') }, { header: pick(lang, 'Описание', 'Tavsif', 'Description') }, { header: pick(lang, 'Документ', 'Hujjat', 'Receipt'), align: 'center' }, { header: pick(lang, 'Сумма', 'Summa', 'Amount'), align: 'right' }],
      rows: lines.map((l) => [catName(l.category), l.description, l.hasReceipt ? '✓' : '—', formatMoney(l.amount)]),
      totals: ['', '', '', formatMoney(spent)],
    },
    signers: [
      { role: pick(lang, 'Подотчётное лицо', 'Hisobdor shaxs', 'Accountable person'), name: emp ?? '' },
      { role: pick(lang, 'Проверил (HR)', 'Tekshirdi (HR)', 'Checked (HR)'), name: '', ...(tr.report?.signatureIds?.[0] ? { signatureId: tr.report.signatureIds[0] } : {}) },
      { role: pick(lang, 'Главный бухгалтер', 'Bosh buxgalter', 'Chief accountant'), name: '' },
    ],
  };
}
