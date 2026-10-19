// Общие элементы модуля «Архив»: место хранения, печатные формы (опись дела, акт приёма-передачи, заверенная
// копия, акт уничтожения / передачи в госархив) с QR проверки.
import { formatDate, pick, type ArchiveCase, type ArchiveDestructionAct, type ArchiveDocument, type ArchiveLocation, type ArchiveNomenclatureItem, type Lang, type PrintDocument } from '@xb/shared';

export function Location({ loc }: { loc: ArchiveLocation }) {
  if (loc.room === '—') return <span className="muted small">—</span>;
  return (
    <span className="num small" style={{ whiteSpace: 'nowrap' }}>
      {loc.room} · {loc.rack} · {loc.shelf} · <b>{loc.box}</b>
    </span>
  );
}

export const locText = (l: ArchiveLocation) => (l.room === '—' ? '—' : `${l.room} / ${l.rack} / ${l.shelf} / ${l.box}`);

/** Опись дела (внутренняя опись документов) — реестр для сдачи в архив. */
export function inventoryPrint(c: ArchiveCase, docs: ArchiveDocument[], lang: Lang, dep: string, nom?: ArchiveNomenclatureItem): PrintDocument {
  return {
    entity: 'archive_inventory',
    entityId: c.id,
    title: pick(lang, `Внутренняя опись документов дела № ${c.number}`, `${c.number} ish hujjatlarining ichki ro‘yxati`, `Internal inventory of case No. ${c.number}`),
    number: c.number,
    date: (c.submittedAt ?? c.formedAt ?? new Date().toISOString()).slice(0, 10),
    fields: [
      { label: pick(lang, 'Заголовок дела', 'Ish sarlavhasi', 'Case title'), value: c.title },
      { label: pick(lang, 'Подразделение', 'Bo‘linma', 'Unit'), value: dep },
      { label: pick(lang, 'Номенклатура', 'Nomenklatura', 'Nomenclature'), value: nom ? `${nom.index} · ${nom.title} · ${nom.article}` : '—' },
      { label: pick(lang, 'Документов / листов', 'Hujjatlar / varaqlar', 'Documents / pages'), value: `${c.documents} / ${c.pages}` },
    ],
    table: {
      columns: [{ header: '№', align: 'right', width: '6%' }, { header: pick(lang, 'Номер', 'Raqam', 'Number') }, { header: pick(lang, 'Дата', 'Sana', 'Date') }, { header: pick(lang, 'Заголовок', 'Sarlavha', 'Title') }, { header: pick(lang, 'Вид', 'Turi', 'Kind') }, { header: 'ID' }, { header: pick(lang, 'Листов', 'Varaq', 'Pages'), align: 'right' }],
      rows: docs.map((d, i) => [String(i + 1), d.docNumber, formatDate(d.docDate), d.title, d.kind, d.uid, String(d.pages ?? 1)]),
      totals: ['', '', '', '', '', pick(lang, 'Итого', 'Jami', 'Total'), String(docs.reduce((s, d) => s + (d.pages ?? 1), 0))],
    },
    landscape: true,
    signers: [{ role: pick(lang, 'Ответственный за дело', 'Ish uchun mas’ul', 'Responsible'), name: '' }],
  };
}

/** Акт приёма-передачи дела в архив (PR-ARC-022). */
export function acceptancePrint(c: ArchiveCase, lang: Lang, dep: string, archivist: string, submittedBy: string): PrintDocument {
  return {
    entity: 'archive_case',
    entityId: c.id,
    title: pick(lang, 'Акт приёма-передачи дела в архив', 'Ishni arxivga qabul qilish-topshirish dalolatnomasi', 'Case transfer-acceptance act'),
    ...(c.acceptanceActNo ? { number: c.acceptanceActNo } : {}),
    date: (c.acceptedAt ?? new Date().toISOString()).slice(0, 10),
    place: pick(lang, 'г. Ташкент', 'Toshkent sh.', 'Tashkent'),
    fields: [
      { label: pick(lang, 'Дело', 'Ish', 'Case'), value: `${c.number} · ${c.title}` },
      { label: pick(lang, 'Сдал (подразделение)', 'Topshirdi (bo‘linma)', 'Handed over by'), value: `${dep} · ${submittedBy}` },
      { label: pick(lang, 'Документов / листов', 'Hujjatlar / varaqlar', 'Documents / pages'), value: `${c.documents} / ${c.pages}` },
      { label: pick(lang, 'Место хранения', 'Saqlash joyi', 'Storage location'), value: locText(c.location) },
      { label: pick(lang, 'Хранить до', 'Saqlash muddati', 'Retain until'), value: c.retentionUntil ? formatDate(c.retentionUntil) : pick(lang, 'Постоянно', 'Doimiy', 'Permanent') },
    ],
    signers: [
      { role: pick(lang, 'Сдал', 'Topshirdi', 'Handed over'), name: submittedBy },
      { role: pick(lang, 'Принял (архивариус)', 'Qabul qildi (arxivchi)', 'Accepted (archivist)'), name: archivist, ...(c.signatureIds?.[0] ? { signatureId: c.signatureIds[0] } : {}) },
    ],
  };
}

/** Заверенная копия архивного документа (PR-ARC-044). */
export function copyPrint(d: ArchiveDocument, c: ArchiveCase | undefined, lang: Lang, issuer: string): PrintDocument {
  return {
    entity: 'archive_document',
    entityId: d.id,
    title: pick(lang, 'Архивная копия документа', 'Hujjatning arxiv nusxasi', 'Certified archive copy'),
    number: d.uid,
    date: new Date().toISOString().slice(0, 10),
    fields: [
      { label: pick(lang, 'Документ', 'Hujjat', 'Document'), value: `${d.kind} ${d.docNumber} ${pick(lang, 'от', 'sana', 'of')} ${formatDate(d.docDate)}` },
      { label: pick(lang, 'Заголовок', 'Sarlavha', 'Title'), value: d.title },
      { label: pick(lang, 'Дело', 'Ish', 'Case'), value: c ? `${c.number} · ${c.title}` : pick(lang, 'Реестр электронного архива', 'Elektron arxiv reestri', 'Electronic archive register') },
      { label: 'SHA-256', value: d.checksum },
      { label: pick(lang, 'Версия', 'Versiya', 'Version'), value: String(d.version) },
    ],
    ...(d.text ? { paragraphs: [d.text] } : {}),
    signers: [{ role: pick(lang, 'Копия верна (архивариус)', 'Nusxa to‘g‘ri (arxivchi)', 'True copy (archivist)'), name: issuer }],
  };
}

/** Акт о выделении дел к уничтожению / передаче в госархив (PR-ARC-027). */
export function actPrint(a: ArchiveDestructionAct, cases: ArchiveCase[], lang: Lang, signer: string): PrintDocument {
  const destroy = a.kind === 'destruction';
  return {
    entity: 'archive_act',
    entityId: a.id,
    title: destroy ? pick(lang, 'Акт о выделении к уничтожению документов, не подлежащих хранению', 'Saqlanmaydigan hujjatlarni yo‘q qilishga ajratish dalolatnomasi', 'Act on selecting documents for destruction') : pick(lang, 'Акт приёма-передачи дел в государственный архив', 'Ishlarni davlat arxiviga topshirish dalolatnomasi', 'Act on transfer of cases to the state archive'),
    number: a.number,
    date: a.createdAt.slice(0, 10),
    place: pick(lang, 'г. Ташкент', 'Toshkent sh.', 'Tashkent'),
    table: {
      columns: [{ header: '№', align: 'right' }, { header: pick(lang, 'Дело', 'Ish', 'Case') }, { header: pick(lang, 'Заголовок', 'Sarlavha', 'Title') }, { header: pick(lang, 'Год', 'Yil', 'Year'), align: 'right' }, { header: pick(lang, 'Листов', 'Varaq', 'Pages'), align: 'right' }, { header: pick(lang, 'Хранить до', 'Saqlash', 'Retain until') }],
      rows: cases.map((c, i) => [String(i + 1), c.number, c.title, String(c.year), String(c.pages), c.retentionUntil ? formatDate(c.retentionUntil) : pick(lang, 'Постоянно', 'Doimiy', 'Permanent')]),
      totals: ['', '', pick(lang, 'Итого дел', 'Jami ishlar', 'Total cases'), String(cases.length), String(cases.reduce((s, c) => s + c.pages, 0)), ''],
    },
    signers: [
      { role: pick(lang, 'Экспертно-проверочная комиссия', 'Ekspert-tekshiruv komissiyasi', 'Expert commission'), name: '' },
      { role: pick(lang, 'Архивариус', 'Arxivchi', 'Archivist'), name: signer, ...(a.signatureIds?.[0] ? { signatureId: a.signatureIds[0] } : {}) },
    ],
  };
}
