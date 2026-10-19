import { documentLight, documentDay, documentIsOverdue, formatDate, formatMoney, pick, today, tk, type DocumentRecord, type Lang, type PrintDocument, type TKey } from '@xb/shared';
import { useSession } from '../../lib/session';
import { LightBadge } from './p2docs';

/** Разница в днях между сегодняшним днём и датой (положительная — в будущем). */
export function daysFromToday(date: string): number {
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today()}T00:00:00Z`).getTime()) / 86_400_000);
}

export function DeadlineCell({ doc }: { doc: Pick<DocumentRecord, 'deadline' | 'status' | 'control' | 'registeredAt' | 'hardDeadline'> }) {
  const { t } = useSession();
  const light = documentLight(doc);
  if (!doc.deadline) return <span className="muted">—</span>;
  const overdue = documentIsOverdue(doc);
  const days = daysFromToday(doc.deadline);
  const closed = light === 'closed';
  return (
    <div>
      <div className="num" style={overdue ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{formatDate(doc.deadline)}</div>
      {!closed && (
        <div className="sub" style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
          <LightBadge light={light} prefix="documents_light_" {...(doc.hardDeadline ? { day: documentDay(doc) } : {})} />
          <span style={overdue ? { color: 'var(--danger)' } : days <= 3 ? { color: 'var(--warn)' } : undefined}>{overdue ? `${-days} ${t('documents_daysOverdue')}` : `${days} ${t('documents_daysLeft')}`}</span>
        </div>
      )}
    </div>
  );
}

type T = (k: TKey) => string;

/** Проект мемориального ордера с QR по решению МИБ / инкассо / требованию (PR-DOC-030). */
export function documentOrderPrint(d: DocumentRecord, t: T, lang: Lang, executor?: string): PrintDocument | null {
  const p = d.paymentDetails;
  if (!p) return null;
  return {
    entity: 'document_payment',
    entityId: d.id,
    title: pick(lang, `Мемориальный ордер № ${d.payment?.orderNumber ?? '(проект)'}`, `Memorial order № ${d.payment?.orderNumber ?? '(loyiha)'}`, `Memorial order No. ${d.payment?.orderNumber ?? '(draft)'}`),
    ...(d.payment?.orderNumber ? { number: d.payment.orderNumber } : {}),
    date: (d.payment?.acceptedAt ?? new Date().toISOString()).slice(0, 10),
    fields: [
      { label: pick(lang, 'Основание', 'Asos', 'Basis'), value: `${t(tk('documents_type_', d.type))} ${d.correspondentNumber ?? ''} (${d.number})` },
      { label: pick(lang, 'Получатель', 'Oluvchi', 'Beneficiary'), value: `${p.recipient}${p.recipientTin ? `, ИНН ${p.recipientTin}` : ''}` },
      { label: pick(lang, 'Счёт / МФО', 'Hisob / MFO', 'Account / MFO'), value: `${p.account} / ${p.mfo}` },
      ...(p.treasuryAccount ? [{ label: pick(lang, 'Казначейский л/с', 'G‘aznachilik sh/h', 'Treasury account'), value: p.treasuryAccount }] : []),
      { label: pick(lang, 'Сумма', 'Summa', 'Amount'), value: formatMoney(p.amount) },
      { label: pick(lang, 'Назначение платежа', "To'lov maqsadi", 'Purpose'), value: p.purpose },
      ...(d.payment?.transactionId ? [{ label: pick(lang, 'Исполнено', 'Ijro etildi', 'Executed'), value: `МФО ${d.payment.mfo ?? ''} · ${d.payment.transactionId}` }] : []),
    ],
    signers: [
      { role: pick(lang, 'Исполнитель (акцепт)', 'Ijrochi (aksept)', 'Executor (acceptance)'), name: executor ?? '' },
      { role: pick(lang, 'Главный бухгалтер', 'Bosh buxgalter', 'Chief accountant'), name: '' },
    ],
  };
}

/** Акт «О нарушении исполнительской дисциплины» (PR-DOC-026). */
export function documentViolationPrint(d: DocumentRecord, lang: Lang, executor?: string, department?: string): PrintDocument | null {
  const v = d.violation;
  if (!v) return null;
  return {
    entity: 'document_violation',
    entityId: d.id,
    title: pick(lang, 'Акт о нарушении исполнительской дисциплины', 'Ijro intizomini buzish to‘g‘risida dalolatnoma', 'Executive discipline breach act'),
    number: v.actNumber,
    date: v.at.slice(0, 10),
    place: pick(lang, 'г. Ташкент', 'Toshkent sh.', 'Tashkent'),
    fields: [
      { label: pick(lang, 'Документ', 'Hujjat', 'Document'), value: `${d.number} · ${d.subject}` },
      { label: pick(lang, 'Исполнитель', 'Ijrochi', 'Executor'), value: executor ?? v.executorId },
      { label: pick(lang, 'Подразделение', 'Bo‘linma', 'Unit'), value: department ?? v.departmentId },
      { label: pick(lang, 'Срок исполнения', 'Ijro muddati', 'Deadline'), value: d.deadline ? formatDate(d.deadline) : '—' },
      { label: pick(lang, 'Дней просрочки', 'Kechikish kunlari', 'Days overdue'), value: String(v.overdueDays) },
      { label: pick(lang, 'Снижение бонуса', 'Bonusni kamaytirish', 'Bonus reduction'), value: `${v.bonusCutPct}%` },
    ],
    paragraphs: [pick(lang, 'Акт сформирован автоматически системой по истечении 10-дневного срока и направлен в Департамент по работе с персоналом.', 'Dalolatnoma 10 kunlik muddat tugagach tizim tomonidan avtomatik shakllantirildi va Xodimlar bilan ishlash departamentiga yuborildi.', 'Generated automatically after the 10-day deadline and sent to the HR Department.')],
    signers: [{ role: pick(lang, 'Департамент по работе с персоналом', 'Xodimlar bilan ishlash departamenti', 'HR Department'), name: '' }],
  };
}
