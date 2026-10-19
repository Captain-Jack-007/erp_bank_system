// Архив: карточка дела (состав, проверка полноты, сдача-приём, место хранения, журнал движения), карточка
// документа (реквизиты, целостность, версии, файлы, подписи, копия) и карточка акта (маршрут ЭПК, исполнение).
import { useState } from 'react';
import {
  archiveApi, archiveCanSee, archiveSuggestBox, canManageArchive, canSubmitArchive, formatDate, formatDateTime, formatNumber, pick, tk,
  type ArchiveCase, type ArchiveDocument, type ArchiveLocation, type ArchiveMovement, type SignableDoc,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Empty, Field, Input, Loading, Modal, PageHeader, RouteSteps, StatusBadge, Textarea } from '../../components/ui';
import { SignModal, SignaturesPanel } from '../../components/SignModal';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { FieldHistory } from '../../components/FieldHistory';
import { ExportButton } from '../../components/Export';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { ChecksList, Note, ReasonModal, useAction } from '../documents/p2docs';
import { CASE_TONE, RequestModal } from './ArchivePage';
import { acceptancePrint, actPrint, copyPrint, inventoryPrint, Location, locText } from './shared';

function Movements({ list }: { list: ArchiveMovement[] }) {
  const { lang } = useSession();
  const lk = useLookups();
  const label: Record<ArchiveMovement['action'], [string, string, string]> = {
    received: ['Принят в архив', 'Arxivga qabul qilindi', 'Received'], formed: ['Дело сформировано', 'Ish shakllantirildi', 'Case formed'], added: ['Добавлен документ', 'Hujjat qo‘shildi', 'Document added'], removed: ['Исключён документ', 'Hujjat chiqarildi', 'Document removed'],
    checked: ['Проверка полноты', 'To‘liqlik tekshiruvi', 'Completeness check'], submitted: ['Сдано в архив', 'Arxivga topshirildi', 'Submitted'], accepted: ['Принято в фонд', 'Fondga qabul qilindi', 'Accepted'], returned_dept: ['Возвращено на доработку', 'Qayta ishlashga qaytarildi', 'Returned for rework'],
    issued: ['Выдано', 'Berildi', 'Issued'], returned: ['Возвращено', 'Qaytarildi', 'Returned'], moved: ['Перемещено', 'Ko‘chirildi', 'Moved'], copied: ['Выдана копия', 'Nusxa berildi', 'Copy issued'], version: ['Новая версия', 'Yangi versiya', 'New version'],
    act: ['Включено в акт', 'Dalolatnomaga kiritildi', 'Included in act'], destroyed: ['Уничтожено', 'Yo‘q qilindi', 'Destroyed'], transferred: ['Передано в госархив', 'Davlat arxiviga topshirildi', 'Transferred'], viewed: ['Просмотр', 'Ko‘rish', 'Viewed'],
  };
  if (!list.length) return <Empty text={pick(lang, 'Записей нет', 'Yozuvlar yo‘q', 'No records')} />;
  return (
    <ul className="timeline">
      {[...list].sort((a, b) => b.at.localeCompare(a.at)).map((m, i) => (
        <li key={i}>
          <span className={`dot ${m.action === 'destroyed' || m.action === 'returned_dept' ? 'rejected' : ''}`} />
          <div>
            <div className="what">{pick(lang, ...label[m.action])}</div>
            <div className="meta">{lk.user(m.userId)?.fullName ?? m.userId} · {formatDateTime(m.at)}</div>
            {m.details && <div className="note">{m.details}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ArchiveCasePage({ id }: { id: string }) {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const { busy, run } = useAction();
  const data = useApi(() => archiveApi.getCase(id, user), [id, user.id]);
  const registry = useApi(() => archiveApi.listRegistry(user), [user.id]);
  const inActs = useApi(() => archiveApi.casesInDraftActs());
  const [modal, setModal] = useState<'accept' | 'move' | 'return' | 'request' | 'add' | 'sign' | null>(null);
  const [signed, setSigned] = useState<string | undefined>();

  if (data.loading && !data.data) return <Card><Loading /></Card>;
  const d = data.data;
  if (!d) return <Card><Empty text={pick(lang, 'Дело не найдено или доступ ограничен', 'Ish topilmadi yoki kirish cheklangan', 'Case not found or access restricted')} icon="alert" /></Card>;
  const c = d.case;
  const manager = canManageArchive(user);
  const submitter = canSubmitArchive(user);
  const dep = lk.department(c.departmentId) ? loc(lk.department(c.departmentId)!.name) : c.departmentId;
  const checks = c.completeness ?? [];
  const blocking = checks.filter((x) => !x.ok && !x.warn).length;
  const signable: SignableDoc = { entity: 'archive_case', entityId: c.id, title: `${pick(lang, 'Акт приёма дела', 'Ishni qabul qilish dalolatnomasi', 'Case acceptance act')} ${c.number}`, content: { case: c.number, docs: d.docs.map((x) => x.checksum), pages: c.pages } };
  const ok = (m: string) => `${c.number}: ${m}`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('archive_title'), to: '/archive' }, { label: c.number }]}
        title={`${c.number} · ${c.title}`}
        subtitle={`${dep} · ${c.year}${d.nomenclature ? ` · ${d.nomenclature.index} ${d.nomenclature.article}` : ''}`}
        actions={
          <>
            <StatusBadge prefix="archive_status_" status={c.status} tone={CASE_TONE[c.status]} />
            {c.restricted && <Badge tone="warn">{pick(lang, 'ДСП', 'XFU', 'Restricted')}</Badge>}
            <PrintButton doc={() => inventoryPrint(c, d.docs, lang, dep, d.nomenclature)} template="registry" label={pick(lang, 'Опись', 'Ro‘yxat', 'Inventory')} />
            {c.acceptanceActNo && <PrintButton doc={() => acceptancePrint(c, lang, dep, lk.user(c.acceptedBy ?? '')?.fullName ?? '', lk.user(c.submittedBy ?? '')?.fullName ?? '')} template="act" label={pick(lang, 'Акт приёма', 'Qabul dalolatnomasi', 'Acceptance act')} />}
            {c.status === 'forming' && submitter && (
              <>
                <Button disabled={busy} onClick={() => run(() => archiveApi.checkCase(c.id, user), ok(pick(lang, 'проверка выполнена', 'tekshirildi', 'checked')))}>{pick(lang, 'Проверить полноту', 'To‘liqlikni tekshirish', 'Check completeness')}</Button>
                <Button type="primary" disabled={busy || blocking > 0} onClick={() => run(() => archiveApi.submitCase(c.id, user), ok(t('archive_status_submitted')))}>{pick(lang, 'Сдать в архив', 'Arxivga topshirish', 'Hand over to archive')}</Button>
              </>
            )}
            {c.status === 'submitted' && manager && (
              <>
                <Button danger disabled={busy} onClick={() => setModal('return')}>{pick(lang, 'Вернуть на доработку', 'Qayta ishlashga qaytarish', 'Return for rework')}</Button>
                <Button type="primary" icon="pen" disabled={busy} onClick={() => setModal('sign')}>{pick(lang, 'Подписать акт и принять', 'Dalolatnomani imzolash va qabul qilish', 'Sign act and accept')}</Button>
              </>
            )}
            {['stored', 'issued', 'expired'].includes(c.status) && manager && <Button disabled={busy} icon="route" onClick={() => setModal('move')}>{pick(lang, 'Переместить', 'Ko‘chirish', 'Move')}</Button>}
            {['stored', 'expired'].includes(c.status) && !inActs.data?.includes(c.id) && <Button disabled={busy} onClick={() => setModal('request')}>{t('archive_requestCase')}</Button>}
          </>
        }
      />
      {c.returnReason && c.status === 'forming' && <Note tone="warn">{pick(lang, 'Возвращено архивом', 'Arxiv qaytardi', 'Returned by archive')}: {c.returnReason}</Note>}
      <div className="grid grid-main">
        <div className="p2-stack">
          <Card title={t('details')}>
            <dl className="kv">
              <dt>{t('archive_location')}</dt>
              <dd><Location loc={c.location} /></dd>
              <dt>{t('archive_docs')} / {t('archive_pages')}</dt>
              <dd>{formatNumber(c.documents)} / {formatNumber(c.pages)}</dd>
              <dt>{t('archive_retentionUntil')}</dt>
              <dd>{c.retentionUntil ? formatDate(c.retentionUntil) : t('archive_permanent')}{d.nomenclature ? ` (${d.nomenclature.retentionYears ? `${d.nomenclature.retentionYears} ${t('archive_years')}` : t('archive_permanent')})` : ''}</dd>
              {c.electronic && (
                <>
                  <dt>{pick(lang, 'Вид дела', 'Ish turi', 'Case type')}</dt>
                  <dd>{pick(lang, 'Электронная сводная папка', 'Elektron yig‘ma papka', 'Electronic summary folder')}{c.periodFrom ? ` · ${formatDate(c.periodFrom)} — ${c.periodTo ? formatDate(c.periodTo) : ''}` : ''}</dd>
                </>
              )}
              {c.responsibleId && (
                <>
                  <dt>{pick(lang, 'Ответственный', 'Mas’ul', 'Responsible')}</dt>
                  <dd>{lk.user(c.responsibleId)?.fullName}</dd>
                </>
              )}
              {c.acceptanceActNo && (
                <>
                  <dt>{pick(lang, 'Акт приёма', 'Qabul dalolatnomasi', 'Acceptance act')}</dt>
                  <dd>{c.acceptanceActNo} · {c.acceptedAt ? formatDateTime(c.acceptedAt) : ''} · {lk.user(c.acceptedBy ?? '')?.fullName}</dd>
                </>
              )}
              <dt>{pick(lang, 'Передано в архив', 'Arxivga topshirilgan', 'Transferred')}</dt>
              <dd>{c.transferredAt ? formatDate(c.transferredAt) : '—'}</dd>
            </dl>
          </Card>
          <Card
            title={`${pick(lang, 'Документы дела', 'Ish hujjatlari', 'Case documents')} · ${d.docs.length}`}
            actions={
              <div className="p2-row">
                <ExportButton filename={`${c.number}`} columns={[{ header: 'ID', value: (x: ArchiveDocument) => x.uid }, { header: pick(lang, 'Номер', 'Raqam', 'Number'), value: (x: ArchiveDocument) => x.docNumber }, { header: pick(lang, 'Дата', 'Sana', 'Date'), value: (x: ArchiveDocument) => x.docDate }, { header: pick(lang, 'Заголовок', 'Sarlavha', 'Title'), value: (x: ArchiveDocument) => x.title }, { header: pick(lang, 'Вид', 'Turi', 'Kind'), value: (x: ArchiveDocument) => x.kind }, { header: 'SHA-256', value: (x: ArchiveDocument) => x.checksum }]} rows={d.docs} />
                {c.status === 'forming' && submitter && <Button size="small" icon="plus" onClick={() => setModal('add')}>{pick(lang, 'Добавить из реестра', 'Reestrdan qo‘shish', 'Add from register')}</Button>}
              </div>
            }
            flush
          >
            <DataTable
              rows={d.docs}
              rowKey={(x) => x.id}
              onRowClick={(x) => navigate(`/archive/docs/${x.id}`)}
              emptyText={c.electronic ? pick(lang, 'В деле нет документов', 'Ishda hujjatlar yo‘q', 'No documents') : pick(lang, 'Бумажное дело: в системе — выборочная опись', 'Qog‘oz ish: tizimda tanlab ro‘yxat', 'Paper case: partial inventory')}
              columns={[
                { header: pick(lang, 'Документ', 'Hujjat', 'Document'), render: (x) => <><div style={{ fontWeight: 500 }}>{x.title}</div><div className="sub">{x.kind} · {x.docNumber} · {formatDate(x.docDate)}</div></> },
                { header: 'ID', render: (x) => <span className="small num">{x.uid}</span> },
                { header: pick(lang, 'Листов', 'Varaq', 'Pages'), align: 'right', render: (x) => x.pages ?? 1 },
                { header: '', render: (x) => (c.status === 'forming' && submitter ? <span onClick={(e) => e.stopPropagation()}><Button size="small" type="text" icon="x" title={pick(lang, 'Исключить', 'Chiqarish', 'Remove')} onClick={() => run(() => archiveApi.removeFromCase(c.id, x.id, user))} /></span> : null) },
              ]}
            />
          </Card>
          <SignaturesPanel doc={signable} canSign={false} />
        </div>
        <div className="p2-stack">
          {checks.length > 0 && (
            <Card title={pick(lang, 'Проверка полноты и целостности', 'To‘liqlik va yaxlitlik tekshiruvi', 'Completeness and integrity')}>
              <ChecksList items={checks.map((x) => ({ label: t(tk('archive_check_', x.code)), ok: x.ok, ...(x.warn ? { warn: true } : {}), ...(x.details ? { details: x.details } : {}) }))} />
            </Card>
          )}
          <Card title={pick(lang, 'Журнал движения (неизменяемый)', 'Harakat jurnali (o‘zgarmas)', 'Movement log (immutable)')}>
            <Movements list={c.movements} />
          </Card>
          <FieldHistory entity="archive_case" entityId={c.id} />
        </div>
      </div>
      {modal === 'sign' && <SignModal doc={signable} onClose={() => setModal((m) => (m === 'sign' ? null : m))} onSigned={(rec) => { setSigned(rec.id); setModal('accept'); }} />}
      {modal === 'accept' && <LocationModal title={pick(lang, 'Принять дело в архивный фонд', 'Ishni arxiv fondiga qabul qilish', 'Accept case into the fund')} initial={{ room: 'А-014', rack: 'Стеллаж 9', shelf: 1, box: archiveSuggestBox() }} onClose={() => setModal(null)} onSubmit={(loc2) => run(() => archiveApi.acceptCase(c.id, user, { location: loc2, ...(signed ? { signatureId: signed } : {}) }), ok(pick(lang, 'принято в архив', 'arxivga qabul qilindi', 'accepted')))} />}
      {modal === 'move' && <LocationModal title={pick(lang, 'Переместить дело', 'Ishni ko‘chirish', 'Move case')} initial={c.location} onClose={() => setModal(null)} onSubmit={(loc2) => run(() => archiveApi.moveCase(c.id, loc2, user), ok(pick(lang, 'перемещено', 'ko‘chirildi', 'moved')))} />}
      {modal === 'return' && <ReasonModal title={`${pick(lang, 'Вернуть', 'Qaytarish', 'Return')}: ${c.number}`} label={pick(lang, 'Замечания', 'Izohlar', 'Remarks')} onClose={() => setModal(null)} onSubmit={(r) => run(() => archiveApi.returnCaseToDept(c.id, user, r), ok(pick(lang, 'возвращено', 'qaytarildi', 'returned')))} />}
      {modal === 'request' && <RequestModal c={c} onClose={() => setModal(null)} />}
      {modal === 'add' && <AddDocsModal c={c} registry={(registry.data ?? []).filter((x) => x.departmentId === c.departmentId)} onClose={() => setModal(null)} />}
    </>
  );
}

function LocationModal({ title, initial, onClose, onSubmit }: { title: string; initial: ArchiveLocation; onClose: () => void; onSubmit: (l: ArchiveLocation) => Promise<unknown> }) {
  const { t, lang } = useSession();
  const [l, setL] = useState({ room: initial.room === '—' ? '' : initial.room, rack: initial.rack === '—' ? '' : initial.rack, shelf: String(initial.shelf || 1), box: initial.box === '—' ? '' : initial.box });
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = l.room.trim() && l.rack.trim() && Number(l.shelf) > 0 && l.box.trim();
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={async () => { if (!valid) return setErr(true); setBusy(true); try { await onSubmit({ room: l.room, rack: l.rack, shelf: Number(l.shelf), box: l.box }); onClose(); } finally { setBusy(false); } }}>{t('save')}</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('archive_room')} required error={err && !l.room.trim() ? t('formRequired') : undefined}><Input value={l.room} onChange={(e) => setL({ ...l, room: e.target.value })} ariaLabel={t('archive_room')} /></Field>
        <Field label={pick(lang, 'Стеллаж', 'Javon', 'Rack')} required error={err && !l.rack.trim() ? t('formRequired') : undefined}><Input value={l.rack} onChange={(e) => setL({ ...l, rack: e.target.value })} ariaLabel="rack" /></Field>
        <Field label={pick(lang, 'Полка', 'Tokcha', 'Shelf')} required error={err && !(Number(l.shelf) > 0) ? t('formRequired') : undefined}><Input type="number" value={l.shelf} onChange={(e) => setL({ ...l, shelf: e.target.value })} ariaLabel="shelf" /></Field>
        <Field label={pick(lang, 'Короб', 'Quti', 'Box')} required error={err && !l.box.trim() ? t('formRequired') : undefined}><Input value={l.box} onChange={(e) => setL({ ...l, box: e.target.value })} ariaLabel="box" /></Field>
      </div>
    </Modal>
  );
}

function AddDocsModal({ c, registry, onClose }: { c: ArchiveCase; registry: ArchiveDocument[]; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [sel, setSel] = useState<string[]>([]);
  return (
    <Modal
      title={`${pick(lang, 'Добавить документы', 'Hujjatlarni qo‘shish', 'Add documents')}: ${c.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} disabled={!sel.length} onClick={async () => { if (await run(() => archiveApi.addToCase(c.id, sel, user))) onClose(); }}>{pick(lang, 'Добавить', 'Qo‘shish', 'Add')}</Button>
        </>
      }
    >
      {!registry.length ? <Empty text={pick(lang, 'В реестре нет документов подразделения', 'Reestrda bo‘linma hujjatlari yo‘q', 'No documents of this unit in the register')} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {registry.map((x) => (
            <Checkbox key={x.id} checked={sel.includes(x.id)} onChange={(v) => setSel(v ? [...sel, x.id] : sel.filter((y) => y !== x.id))}>
              {x.kind} {x.docNumber} · {formatDate(x.docDate)} — {x.title}
            </Checkbox>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function ArchiveDocPage({ id }: { id: string }) {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const { busy, run } = useAction();
  const data = useApi(() => archiveApi.getDocument(id, user), [id, user.id]);
  const [ver, setVer] = useState(false);
  const [logged, setLogged] = useState(false);
  if (data.loading && !data.data) return <Card><Loading /></Card>;
  const d = data.data;
  if (!d) return <Card><Empty text={pick(lang, 'Документ не найден или доступ ограничен', 'Hujjat topilmadi yoki kirish cheklangan', 'Document not found or access restricted')} icon="alert" /></Card>;
  if (!logged) {
    setLogged(true);
    archiveApi.logView(d.doc.id, user);
  }
  const x = d.doc;
  const manager = canManageArchive(user);
  const sigDoc: SignableDoc | null = x.signatureEntity ? { entity: x.signatureEntity.entity, entityId: x.signatureEntity.entityId, title: x.title, content: undefined } : null;
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('archive_title'), to: '/archive' }, ...(d.case ? [{ label: d.case.number, to: `/archive/${d.case.id}` }] : []), { label: x.uid }]}
        title={x.title}
        subtitle={`${x.kind} · ${x.docNumber} · ${formatDate(x.docDate)} · ${x.uid}`}
        actions={
          <>
            {d.integrity ? <Badge tone="ok">{pick(lang, 'Целостность подтверждена', 'Yaxlitlik tasdiqlandi', 'Integrity confirmed')}</Badge> : <Badge tone="danger">{pick(lang, 'Нарушение целостности', 'Yaxlitlik buzilgan', 'Integrity failure')}</Badge>}
            {archiveCanSee(user, x) && <PrintButton doc={() => copyPrint(x, d.case, lang, user.fullName)} label={pick(lang, 'Заверенная копия', 'Tasdiqlangan nusxa', 'Certified copy')} />}
            {manager && (!d.case || d.case.status === 'forming') && <Button disabled={busy} onClick={() => setVer(true)}>{pick(lang, 'Новая версия', 'Yangi versiya', 'New version')}</Button>}
          </>
        }
      />
      <div className="grid grid-main">
        <div className="p2-stack">
          <Card title={t('details')}>
            <dl className="kv">
              <dt>{pick(lang, 'Единый идентификатор', 'Yagona identifikator', 'Unique ID')}</dt>
              <dd className="num">{x.uid}</dd>
              <dt>{pick(lang, 'Источник', 'Manba', 'Source')}</dt>
              <dd>{t(tk('archive_source_', x.source))}{x.sourceRef ? ` · ${x.sourceRef}` : ''}</dd>
              <dt>{pick(lang, 'Создан в источнике', 'Manbada yaratilgan', 'Created in source')}</dt>
              <dd>{formatDateTime(x.createdAt)}</dd>
              <dt>{pick(lang, 'Принят в архив', 'Arxivga qabul qilingan', 'Received')}</dt>
              <dd>{formatDateTime(x.receivedAt)}</dd>
              <dt>{t('department')}</dt>
              <dd>{lk.department(x.departmentId) ? loc(lk.department(x.departmentId)!.name) : x.departmentId}</dd>
              {x.responsibleId && (<><dt>{pick(lang, 'Ответственный', 'Mas’ul', 'Responsible')}</dt><dd>{lk.user(x.responsibleId)?.fullName}</dd></>)}
              <dt>{t('archive_inCase')}</dt>
              <dd>{d.case ? <Link to={`/archive/${d.case.id}`}>{d.case.number}</Link> : pick(lang, 'Реестр (не сведён в дело)', 'Reestr (ishga yig‘ilmagan)', 'Register (not in a case)')}{d.case ? <> · <Location loc={d.case.location} /></> : null}</dd>
              <dt>SHA-256</dt>
              <dd className="p2-mono">{x.checksum}</dd>
              <dt>{pick(lang, 'Подписей ЭП', 'ERI imzolari', 'E-signatures')}</dt>
              <dd>{x.signatures ?? 0}</dd>
              <dt>{pick(lang, 'Версия', 'Versiya', 'Version')}</dt>
              <dd>{x.version}</dd>
            </dl>
            {x.text && <p className="p2-text" style={{ marginTop: 12 }}>{x.text}</p>}
          </Card>
          <Card title={pick(lang, 'Версии документа', 'Hujjat versiyalari', 'Versions')} flush>
            <DataTable rows={x.versions} rowKey={(v) => String(v.version)} columns={[
              { header: '№', render: (v) => v.version },
              { header: pick(lang, 'Дата', 'Sana', 'Date'), render: (v) => formatDateTime(v.at) },
              { header: pick(lang, 'Автор', 'Muallif', 'By'), render: (v) => lk.user(v.by)?.fullName ?? v.by },
              { header: pick(lang, 'Комментарий', 'Izoh', 'Note'), render: (v) => v.note ?? '' },
              { header: 'SHA-256', render: (v) => <span className="p2-mono">{v.checksum.slice(0, 16)}…</span> },
            ]} />
          </Card>
          {x.fileEntity && <Attachments entity={x.fileEntity.entity} entityId={x.fileEntity.entityId} readOnly title={pick(lang, 'Электронные файлы документа', 'Hujjatning elektron fayllari', 'Electronic files')} />}
          <Attachments entity="archive_document" entityId={x.id} readOnly={!manager} title={pick(lang, 'Скан-образы и файлы архива', 'Arxiv skan-nusxalari va fayllari', 'Archive scans and files')} />
        </div>
        <div className="p2-stack">
          {sigDoc && <SignaturesPanel doc={sigDoc} canSign={false} />}
          <Card title={pick(lang, 'История движения', 'Harakat tarixi', 'Movement history')}>
            <Movements list={x.movements} />
          </Card>
          <FieldHistory entity="archive_document" entityId={x.id} />
        </div>
      </div>
      {ver && <VersionModal doc={x} onClose={() => setVer(false)} />}
    </>
  );
}

function VersionModal({ doc, onClose }: { doc: ArchiveDocument; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [title, setTitle] = useState(doc.title);
  const [text, setText] = useState(doc.text ?? '');
  const [note, setNote] = useState('');
  const [err, setErr] = useState(false);
  return (
    <Modal
      title={`${pick(lang, 'Новая версия', 'Yangi versiya', 'New version')}: ${doc.uid}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={async () => { if (!note.trim()) return setErr(true); if (await run(() => archiveApi.addVersion(doc.id, user, { title, text, note }), pick(lang, 'Версия сохранена', 'Versiya saqlandi', 'Version saved'))) onClose(); }}>{t('save')}</Button>
        </>
      }
    >
      <Field label={pick(lang, 'Заголовок', 'Sarlavha', 'Title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label={pick(lang, 'Текст', 'Matn', 'Text')}><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} /></Field>
      <Field label={pick(lang, 'Основание изменения', 'O‘zgartirish asosi', 'Reason for change')} required error={err ? t('formRequired') : undefined}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

export function ArchiveActPage({ id }: { id: string }) {
  const { t, lang } = useSession();
  const user = useUser();
  const lk = useLookups();
  const { busy, run } = useAction();
  const act = useApi(() => archiveApi.getAct(id), [id]);
  const cases = useApi(() => archiveApi.listCases({}, user), [id, user.id]);
  const [sign, setSign] = useState(false);
  if (act.loading && !act.data) return <Card><Loading /></Card>;
  const a = act.data;
  if (!a) return <Card><Empty text={t('empty')} /></Card>;
  const list = (cases.data ?? []).filter((c) => a.caseIds.includes(c.id));
  const manager = canManageArchive(user);
  const signable: SignableDoc = { entity: 'archive_act', entityId: a.id, title: a.number, content: { number: a.number, kind: a.kind, cases: a.caseIds } };
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('archive_title'), to: '/archive?tab=destruction' }, { label: a.number }]}
        title={`${a.number} · ${a.kind === 'destruction' ? pick(lang, 'Акт о выделении дел к уничтожению', 'Ishlarni yo‘q qilishga ajratish dalolatnomasi', 'Destruction act') : pick(lang, 'Акт передачи дел в госархив', 'Ishlarni davlat arxiviga topshirish dalolatnomasi', 'State archive transfer act')}`}
        subtitle={`${formatDate(a.createdAt)} · ${lk.user(a.createdBy)?.fullName ?? ''}`}
        actions={
          <>
            <StatusBadge prefix="archive_actstatus_" status={a.status} tone={a.status === 'signed' ? 'ok' : a.status === 'approved' ? 'info' : a.status === 'rejected' ? 'danger' : 'warn'} />
            <PrintButton doc={() => actPrint(a, list, lang, lk.user(a.signedBy ?? a.createdBy)?.fullName ?? '')} template="act" />
            {manager && ['draft', 'rejected'].includes(a.status) && <Button disabled={busy} onClick={() => run(() => archiveApi.submitAct(a.id, user), `${a.number}: ${t('archive_actstatus_pending')}`)}>{pick(lang, 'На согласование ЭПК', 'EPK kelishuviga', 'Submit to commission')}</Button>}
            {manager && a.status === 'approved' && <Button type="primary" icon="pen" disabled={busy} onClick={() => setSign(true)}>{pick(lang, 'Подписать и исполнить', 'Imzolash va ijro etish', 'Sign and execute')}</Button>}
          </>
        }
      />
      {a.rejectReason && a.status !== 'signed' && <Note tone="danger">{a.rejectReason}</Note>}
      <div className="grid grid-main">
        <Card title={t('archive_actCases')} flush>
          <DataTable rows={list} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/archive/${c.id}`)} columns={[
            { header: t('archive_caseNumber'), render: (c) => <span className="doc-num">{c.number}</span> },
            { header: t('archive_caseTitle'), render: (c) => c.title },
            { header: t('archive_pages'), align: 'right', render: (c) => c.pages },
            { header: t('archive_location'), render: (c) => locText(c.location) },
            { header: t('status'), render: (c) => <StatusBadge prefix="archive_status_" status={c.status} tone={CASE_TONE[c.status]} /> },
          ]} />
        </Card>
        <div className="p2-stack">
          <Card title={t('route')}>{a.status === 'draft' ? <RouteSteps preview={{ entity: 'archive_act', context: { subtype: a.kind } }} /> : <RouteSteps entityId={a.id} />}</Card>
          <SignaturesPanel doc={signable} canSign={false} />
        </div>
      </div>
      {sign && <SignModal doc={signable} onClose={() => setSign(false)} onSigned={(rec) => void run(() => archiveApi.signAct(a.id, user, rec.id), `${a.number}: ${t('archive_actstatus_signed')}`)} />}
    </>
  );
}
