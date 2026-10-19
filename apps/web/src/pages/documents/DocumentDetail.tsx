import { useState } from 'react';
import {
  api, canResolveDocuments, documentSignContent, documentAcceptHoursLeft, documentDay, documentLight, documentsApi, DOCUMENT_HARD_DAYS, DOCUMENT_PAYMENT_THRESHOLD, filesApi, formatDate, formatDateTime, formatMoney, pick, tk, today,
  type DocumentRecord, type SignableDoc, type StoredFile,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, Empty, Field, Input, Loading, Modal, PageHeader, RouteSteps, Select, StatusBadge, Textarea, Timeline, Upload } from '../../components/ui';
import { SignaturesPanel } from '../../components/SignModal';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { FieldHistory } from '../../components/FieldHistory';
import { readFileBytes } from '../../components/download';
import { Link } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { DeadlineCell, documentOrderPrint, documentViolationPrint } from './shared';
import { LightBadge, Note, ReasonModal, useAction } from './p2docs';

export { documentSignContent };

export function DocumentDetailPage({ id }: { id: string }) {
  const { t, loc, lang } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const { busy, run } = useAction();
  const doc = useApi(() => documentsApi.get(id), [id]);
  const files = useApi(() => filesApi.list('document', id), [id]);
  const contract = useApi(async () => (doc.data?.contractId ? api.getContract(doc.data.contractId) : undefined), [doc.data?.contractId]);
  const [modal, setModal] = useState<'resolution' | 'complete' | 'decline' | 'response' | 'ocr' | null>(null);

  if (doc.loading && !doc.data) return <Card><Loading /></Card>;
  const d = doc.data;
  if (!d) return <Card><Empty text={t('empty')} /></Card>;

  const isExec = user.id === d.executorId || user.role === 'admin';
  const open = !['done', 'answered', 'rejected'].includes(d.status);
  const canResolve = open && !['pending', 'payment'].includes(d.status) && canResolveDocuments(user);
  const dept = lk.department(d.departmentId);
  const light = documentLight(d);
  const hoursLeft = documentAcceptHoursLeft(d);
  const responseFile = files.data?.find((f) => f.id === d.responseFileId);
  const canConfirm = !!d.responseFileId && ['in_progress', 'payment'].includes(d.status) && (canResolveDocuments(user) || d.resolution?.authorId === user.id) && (user.id !== d.executorId || user.role === 'admin');
  const signable: SignableDoc = { entity: 'document', entityId: d.id, title: `${d.number} · ${d.subject}`, content: documentSignContent(d) };
  const orderDoc = documentOrderPrint(d, t, lang, lk.user(d.executorId)?.fullName);
  const actDoc = documentViolationPrint(d, lang, lk.user(d.executorId)?.fullName, dept ? loc(dept.name) : undefined);
  const ok = (m: string) => `${d.number}: ${m}`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('documents_title'), to: '/documents' }, { label: d.number }]}
        title={d.subject}
        subtitle={`${d.number} · ${t(tk('documents_kind_', d.kind))} · ${t(tk('documents_type_', d.type))}`}
        actions={
          <>
            <StatusBadge prefix="documents_status_" status={d.status} />
            {d.status === 'registered' && can('documents', 'edit') && <Button disabled={busy} onClick={() => run(() => documentsApi.submit(d.id, user), ok(t('hist_submitted')))}>{t('documents_submit')}</Button>}
            {canResolve && <Button disabled={busy} onClick={() => setModal('resolution')}>{t('documents_addResolution')}</Button>}
            {d.status === 'assigned' && isExec && (
              <>
                <Button danger disabled={busy} onClick={() => setModal('decline')}>{pick(lang, 'Отклонить с обоснованием', 'Asoslab rad etish', 'Decline with reason')}</Button>
                <Button type="primary" icon="check" disabled={busy} onClick={() => run(() => documentsApi.accept(d.id, user), ok(t('documents_status_in_progress')))}>{pick(lang, 'Принять к исполнению', 'Ijroga qabul qilish', 'Accept')}</Button>
              </>
            )}
            {d.kind === 'incoming' && ['in_progress', 'payment'].includes(d.status) && isExec && (
              <Button type="primary" icon="upload" disabled={busy} onClick={() => setModal('response')}>{d.responseFileId ? pick(lang, 'Заменить ответ', 'Javobni almashtirish', 'Replace response') : pick(lang, 'Загрузить ответ', 'Javobni yuklash', 'Upload response')}</Button>
            )}
            {canConfirm && <Button type="primary" icon="check" disabled={busy} onClick={() => run(() => documentsApi.confirmResponse(d.id, user), ok(t('documents_status_answered')))}>{pick(lang, 'Подтвердить ответ', 'Javobni tasdiqlash', 'Confirm response')}</Button>}
            {d.kind === 'internal' && ['registered', 'in_progress'].includes(d.status) && isExec && (
              <Button type="primary" icon="check" disabled={busy} onClick={() => setModal('complete')}>{t('documents_complete')}</Button>
            )}
            {d.kind === 'outgoing' && d.status === 'in_progress' && (isExec || canResolveDocuments(user)) && (
              <Button type="primary" icon="plane" disabled={busy || !d.signatureIds?.length} title={!d.signatureIds?.length ? pick(lang, 'Сначала подпишите ЭЦП', 'Avval ERI bilan imzolang', 'Sign first') : undefined} onClick={() => run(() => documentsApi.send(d.id, user), ok(pick(lang, 'отправлено адресату', 'adresatga yuborildi', 'sent to addressee')))}>
                {pick(lang, 'Зарегистрировать и отправить', "Ro'yxatga olish va yuborish", 'Register and send')}
              </Button>
            )}
          </>
        }
      />

      {hoursLeft !== undefined && (
        <Note tone={hoursLeft < 4 ? 'danger' : 'warn'} icon="clock">
          {pick(lang, `Окно принятия: осталось ${Math.floor(hoursLeft)} ч ${Math.round((hoursLeft % 1) * 60)} мин. Без ответа документ будет считаться принятым к исполнению.`, `Qabul oynasi: ${Math.floor(hoursLeft)} soat ${Math.round((hoursLeft % 1) * 60)} daqiqa qoldi. Javobsiz hujjat ijroga qabul qilingan hisoblanadi.`, `Acceptance window: ${Math.floor(hoursLeft)} h ${Math.round((hoursLeft % 1) * 60)} min left. Without a reply the document is deemed accepted.`)}
        </Note>
      )}
      {d.hardDeadline && light !== 'closed' && (
        <Note tone={light === 'green' ? 'info' : light === 'yellow' ? 'warn' : 'danger'} icon="alert">
          {pick(lang, `Жёсткий срок ${DOCUMENT_HARD_DAYS} календарных дней с момента загрузки (${formatDateTime(d.registeredAt)}): день ${documentDay(d)}.`, `Yuklangan paytdan (${formatDateTime(d.registeredAt)}) ${DOCUMENT_HARD_DAYS} kalendar kunlik qat’iy muddat: ${documentDay(d)}-kun.`, `Hard deadline of ${DOCUMENT_HARD_DAYS} calendar days from upload (${formatDateTime(d.registeredAt)}): day ${documentDay(d)}.`)}{' '}
          <LightBadge light={light} prefix="documents_light_" />
        </Note>
      )}
      {d.declineReason && d.status === 'registered' && <Note tone="warn" icon="alert">{pick(lang, 'Исполнитель отклонил документ', 'Ijrochi hujjatni rad etdi', 'Executor declined')}: {d.declineReason}</Note>}

      <div className="grid grid-main">
        <div className="p2-stack">
          <Card title={t('details')}>
            <dl className="kv">
              <dt>{t('documents_regNumber')}</dt>
              <dd className="num">{d.number}</dd>
              <dt>{t('documents_regDate')}</dt>
              <dd>{formatDateTime(d.registeredAt)} <span className="muted small">({pick(lang, 'день 0', '0-kun', 'day 0')})</span></dd>
              <dt>{pick(lang, 'Источник', 'Manba', 'Source')}</dt>
              <dd>{t(tk('documents_source_', d.source))}</dd>
              <dt>{t('documents_correspondent')}</dt>
              <dd>{d.correspondent}{d.correspondentNumber ? <span className="muted"> · № {d.correspondentNumber}</span> : null}</dd>
              <dt>{t('department')}</dt>
              <dd>
                {dept ? loc(dept.name) : '—'}
                {d.autoRouted && <span className="muted small"> · {pick(lang, 'определено автоматически', 'avtomatik aniqlangan', 'auto-routed')}: {d.autoRouted.keywords.join(', ')}</span>}
              </dd>
              <dt>{t('documents_executor')}</dt>
              <dd>{lk.user(d.executorId)?.fullName ?? '—'}{d.autoAccepted && <span className="muted small"> · {pick(lang, 'принято автоматически (24 ч)', 'avtomatik qabul (24 s)', 'auto-accepted (24 h)')}</span>}</dd>
              <dt>{t('documents_priority')}</dt>
              <dd>{d.priority === 'high' ? <Badge tone="danger">{t('documents_priority_high')}</Badge> : t('documents_priority_normal')}</dd>
              <dt>{t('documents_deadline')}</dt>
              <dd><DeadlineCell doc={d} /></dd>
              <dt>{t('documents_pages')}</dt>
              <dd>{d.pages}</dd>
              {contract.data && (
                <>
                  <dt>{pick(lang, 'Договор', 'Shartnoma', 'Contract')}</dt>
                  <dd><Link to={`/contracts/${contract.data.id}`}>{contract.data.number} · {contract.data.subject}</Link></dd>
                </>
              )}
              <dt>{pick(lang, 'Срок хранения', 'Saqlash muddati', 'Retention')}</dt>
              <dd>{d.retentionYears ? pick(lang, `${d.retentionYears} лет`, `${d.retentionYears} yil`, `${d.retentionYears} years`) : pick(lang, 'Постоянно', 'Doimiy', 'Permanent')}{d.archiveRef ? ` · ${pick(lang, 'в архиве', 'arxivda', 'archived')} ${d.archiveRef}` : ''}</dd>
              {d.aur && (
                <>
                  <dt>{pick(lang, 'АУР: сумма / МВЗ / статья', 'MBX: summa / XJM / modda', 'Admin expense: amount / cost centre / article')}</dt>
                  <dd>{formatMoney(d.aur.amount)} · {d.aur.costCenterKey} · {d.aur.article} · {formatDate(d.aur.opDay)}</dd>
                </>
              )}
            </dl>
            <h4 style={{ margin: '16px 0 6px' }}>{t('documents_summary')}</h4>
            <p className="p2-text">{d.summary}</p>
            {d.body && (
              <>
                <h4 style={{ margin: '16px 0 6px' }}>{pick(lang, 'Текст документа', 'Hujjat matni', 'Document text')}</h4>
                <p className="p2-text">{d.body}</p>
              </>
            )}
            {d.ocrText && (
              <>
                <h4 style={{ margin: '16px 0 6px' }}>{pick(lang, 'Распознанный текст (OCR)', 'Tanilgan matn (OCR)', 'Recognised text (OCR)')}</h4>
                <p className="p2-text muted">{d.ocrText}</p>
              </>
            )}
          </Card>

          {d.paymentDetails && (
            <Card
              title={pick(lang, 'Платёж («Акцепт»)', "To'lov («Aksept»)", 'Payment ("Acceptance")')}
              actions={
                <div className="p2-row">
                  {orderDoc && <PrintButton doc={orderDoc} label={pick(lang, 'Мемориальный ордер (QR)', 'Memorial order (QR)', 'Memorial order (QR)')} />}
                  {isExec && d.status === 'in_progress' && (!d.payment || d.payment.status === 'rejected') && (
                    <Button type="primary" size="small" disabled={busy} onClick={() => run(() => documentsApi.acceptPayment(d.id, user), ok(pick(lang, 'акцепт: отправлено на оплату', 'aksept: to‘lovga yuborildi', 'accepted: sent for payment')))}>
                      {pick(lang, 'Отправить на оплату', "To'lovga yuborish", 'Send for payment')}
                    </Button>
                  )}
                  {d.payment?.status === 'queued' && <Button size="small" disabled={busy} onClick={() => run(() => documentsApi.resendPayment(d.id, user), ok(pick(lang, 'повторная отправка', 'qayta yuborish', 'resent')))}>{pick(lang, 'Повторить отправку в АБС', 'ABS ga qayta yuborish', 'Resend to core banking')}</Button>}
                  {d.payment?.status === 'ready' && (isExec || can('documents', 'approve') || user.role === 'accountant') && (
                    <Button size="small" disabled={busy} onClick={() => run(() => documentsApi.syncPaymentStatus(d.id, user), ok(t('documents_pay_paid')))}>{pick(lang, 'Получить статус списания из АБС', 'ABS dan yechish holatini olish', 'Get debit status from core banking')}</Button>
                  )}
                </div>
              }
            >
              <dl className="kv">
                <dt>{pick(lang, 'Сумма', 'Summa', 'Amount')}</dt>
                <dd className="num">{formatMoney(d.paymentDetails.amount)}{d.paymentDetails.amount > DOCUMENT_PAYMENT_THRESHOLD && <span className="muted small"> · {pick(lang, 'свыше 50 млн — второе подтверждение', '50 mln dan ortiq — ikkinchi tasdiq', 'over 50 mln — second confirmation')}</span>}</dd>
                <dt>{pick(lang, 'Получатель', 'Oluvchi', 'Beneficiary')}</dt>
                <dd>{d.paymentDetails.recipient}{d.paymentDetails.recipientTin ? ` · ${t('tin')} ${d.paymentDetails.recipientTin}` : ''}</dd>
                <dt>{pick(lang, 'Счёт / МФО', 'Hisob / MFO', 'Account / MFO')}</dt>
                <dd className="num">{d.paymentDetails.account} · {d.paymentDetails.mfo}</dd>
                {d.paymentDetails.treasuryAccount && (
                  <>
                    <dt>{pick(lang, 'Казначейский л/с', 'G‘aznachilik sh/h', 'Treasury account')}</dt>
                    <dd className="num p2-mono">{d.paymentDetails.treasuryAccount}</dd>
                  </>
                )}
                <dt>{pick(lang, 'Назначение', 'Maqsad', 'Purpose')}</dt>
                <dd>{d.paymentDetails.purpose}</dd>
                {d.payment && (
                  <>
                    <dt>{pick(lang, 'Статус платежа', "To'lov holati", 'Payment status')}</dt>
                    <dd><StatusBadge prefix="documents_pay_" status={d.payment.status} tone={d.payment.status === 'paid' ? 'ok' : d.payment.status === 'rejected' ? 'danger' : d.payment.status === 'ready' ? 'info' : 'warn'} /> <span className="muted small">{d.payment.orderNumber}</span></dd>
                    {d.payment.acceptedBy && (
                      <>
                        <dt>{pick(lang, 'Акцепт', 'Aksept', 'Accepted by')}</dt>
                        <dd>{lk.user(d.payment.acceptedBy)?.fullName} · {d.payment.acceptedAt ? formatDateTime(d.payment.acceptedAt) : ''}</dd>
                      </>
                    )}
                    {d.payment.transactionId && (
                      <>
                        <dt>{pick(lang, 'Факт оплаты', "To'lov fakti", 'Payment fact')}</dt>
                        <dd>МФО {d.payment.mfo} · {d.payment.transactionId} · {d.payment.paidAt ? formatDateTime(d.payment.paidAt) : ''}</dd>
                      </>
                    )}
                  </>
                )}
              </dl>
              {d.payment?.secondApproval && (
                <div style={{ marginTop: 12 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>{pick(lang, 'Второе подтверждение (начальник департамента)', 'Ikkinchi tasdiq (departament boshlig‘i)', 'Second confirmation (head of department)')}</div>
                  <RouteSteps entityId={`${d.id}:pay`} />
                </div>
              )}
            </Card>
          )}

          {d.kind === 'incoming' && (
            <Card title={pick(lang, 'Ответ исполнителя', 'Ijrochi javobi', 'Executor response')}>
              {d.responseFileId ? (
                <dl className="kv">
                  <dt>{pick(lang, 'Файл ответа', 'Javob fayli', 'Response file')}</dt>
                  <dd>{responseFile?.name ?? d.responseFileId}</dd>
                  {d.responseNote && (
                    <>
                      <dt>{t('comment')}</dt>
                      <dd>{d.responseNote}</dd>
                    </>
                  )}
                  <dt>{pick(lang, 'Подтверждение', 'Tasdiq', 'Confirmation')}</dt>
                  <dd>{d.responseConfirmedBy ? `${lk.user(d.responseConfirmedBy)?.fullName} · ${d.responseConfirmedAt ? formatDateTime(d.responseConfirmedAt) : ''}` : <Badge tone="warn">{pick(lang, 'Ожидает подтверждения', 'Tasdiq kutilmoqda', 'Awaiting confirmation')}</Badge>}</dd>
                </dl>
              ) : d.responseNote && d.payment?.status === 'paid' ? (
                <p className="p2-text">{d.responseNote}</p>
              ) : (
                <Empty text={pick(lang, 'Статус «Ответ дан» — только после загрузки скана ответного письма или платёжного поручения и его подтверждения', '«Javob berilgan» holati — faqat javob xati yoki to‘lov topshiriqnomasi skani yuklanib tasdiqlangandan keyin', '"Answered" only after the response letter or payment order scan is uploaded and confirmed')} icon="paperclip" />
              )}
            </Card>
          )}

          <Attachments entity="document" entityId={d.id} title={t('documents_attachments')} />
          <div className="p2-row">
            {(files.data?.length ?? 0) > 0 && can('documents', 'edit') && <Button size="small" icon="eye" onClick={() => setModal('ocr')}>{pick(lang, 'Распознать скан (OCR)', 'Skanni tanish (OCR)', 'Recognise scan (OCR)')}</Button>}
            <span className="muted small">{t('documents_scanNote')}</span>
          </div>
        </div>

        <div className="p2-stack">
          <Card title={t('documents_resolution')}>
            {d.resolution ? (
              <>
                <p style={{ margin: '0 0 8px' }}>{d.resolution.text}</p>
                <div className="muted small">{lk.user(d.resolution.authorId)?.fullName} · {formatDateTime(d.resolution.at)}</div>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>{t('documents_noResolution')}</p>
            )}
          </Card>
          <Card title={t('route')}>
            {d.history.some((h) => h.action === 'submitted') ? <RouteSteps entityId={d.id} /> : <RouteSteps preview={{ entity: 'document', context: { subtype: d.type, kind: d.kind, departmentId: d.departmentId } }} />}
          </Card>
          {actDoc && d.violation && (
            <Card title={pick(lang, 'Нарушение исполнительской дисциплины', 'Ijro intizomi buzilishi', 'Executive discipline breach')} actions={<PrintButton doc={actDoc} label={pick(lang, 'Акт', 'Dalolatnoma', 'Act')} />}>
              <dl className="kv">
                <dt>{pick(lang, 'Акт', 'Dalolatnoma', 'Act')}</dt>
                <dd>{d.violation.actNumber} · {formatDate(d.violation.at)}</dd>
                <dt>{pick(lang, 'Просрочка', 'Kechikish', 'Overdue')}</dt>
                <dd>{d.violation.overdueDays} {pick(lang, 'дн.', 'kun', 'd')}</dd>
                <dt>{pick(lang, 'Снижение бонуса', 'Bonusni kamaytirish', 'Bonus cut')}</dt>
                <dd style={{ color: 'var(--danger)' }}>−{d.violation.bonusCutPct}%</dd>
              </dl>
            </Card>
          )}
          {(d.kind !== 'incoming' || (d.signatureIds?.length ?? 0) > 0) && (
            <SignaturesPanel doc={signable} canSign={d.kind !== 'incoming' && ['registered', 'pending', 'in_progress'].includes(d.status) && (isExec || canResolveDocuments(user))} onSigned={(rec) => void run(() => documentsApi.attachSignature(d.id, user, rec.id))} />
          )}
          <Card title={t('history')}>
            <Timeline events={d.history} />
          </Card>
          <FieldHistory entity="document" entityId={d.id} />
        </div>
      </div>

      {modal === 'resolution' && <ResolutionModal doc={d} onClose={() => setModal(null)} />}
      {modal === 'complete' && <CompleteModal doc={d} onClose={() => setModal(null)} />}
      {modal === 'response' && <ResponseModal doc={d} onClose={() => setModal(null)} />}
      {modal === 'ocr' && <OcrModal doc={d} files={files.data ?? []} onClose={() => setModal(null)} />}
      {modal === 'decline' && <ReasonModal title={`${pick(lang, 'Отклонить', 'Rad etish', 'Decline')}: ${d.number}`} label={pick(lang, 'Обоснование', 'Asos', 'Justification')} onClose={() => setModal(null)} onSubmit={(reason) => run(() => documentsApi.decline(d.id, user, reason), ok(pick(lang, 'отклонено исполнителем', 'ijrochi rad etdi', 'declined')))} />}
    </>
  );
}

function ResolutionModal({ doc, onClose }: { doc: DocumentRecord; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const [executorId, setExecutorId] = useState(doc.executorId);
  const [deadline, setDeadline] = useState(doc.deadline ?? '');
  const [control, setControl] = useState(doc.control);
  const [error, setError] = useState('');
  return (
    <Modal
      title={`${t('documents_addResolution')}: ${doc.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={async () => {
              if (!text.trim()) return setError(t('formRequired'));
              if (deadline && deadline < today() && !doc.hardDeadline) return setError(t('documents_pastDeadline'));
              if (await run(() => documentsApi.setResolution(doc.id, user, { text: text.trim(), executorId, ...(deadline ? { deadline } : {}), control }), `${doc.number}: ${t('saved')}`)) onClose();
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <Field label={t('documents_resolutionText')} required error={error}>
        <Textarea value={text} onChange={(e) => { setText(e.target.value); setError(''); }} rows={3} ariaLabel={t('documents_resolutionText')} />
      </Field>
      <div className="form-grid">
        <Field label={t('documents_executor')}>
          <Select value={executorId} onChange={setExecutorId} options={lk.users.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: u.fullName }))} ariaLabel={t('documents_executor')} />
        </Field>
        <Field label={t('documents_deadline')}>
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} disabled={!!doc.hardDeadline} ariaLabel={t('documents_deadline')} />
        </Field>
      </div>
      <Checkbox checked={control} onChange={setControl}>{t('documents_control')}</Checkbox>
    </Modal>
  );
}

function CompleteModal({ doc, onClose }: { doc: DocumentRecord; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  return (
    <Modal
      title={`${t('documents_complete')}: ${doc.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={async () => { if (await run(() => documentsApi.complete(doc.id, user, note.trim()), `${doc.number}: ${t('documents_status_done')}`)) onClose(); }}>{t('documents_complete')}</Button>
        </>
      }
    >
      <Field label={t('documents_completeNote')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} ariaLabel={t('documents_completeNote')} />
      </Field>
    </Modal>
  );
}

/** Загрузка файла ответа (скан ответного письма / платёжного поручения) — обязательна (PR-DOC-024). */
function ResponseModal({ doc, onClose }: { doc: DocumentRecord; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title={`${pick(lang, 'Ответ на документ', 'Hujjatga javob', 'Response')}: ${doc.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={async () => {
              if (!file) return setError(pick(lang, 'Приложите файл ответа', 'Javob faylini ilova qiling', 'Attach the response file'));
              const done = await run(async () => {
                const f = await filesApi.upload({ entity: 'document', entityId: doc.id, name: file.name, mime: file.type, data: await readFileBytes(file), category: 'response' }, user);
                await documentsApi.submitResponse(doc.id, user, f.id, note);
              }, `${doc.number}: ${pick(lang, 'ответ загружен', 'javob yuklandi', 'response uploaded')}`);
              if (done) onClose();
            }}
          >
            {pick(lang, 'Загрузить', 'Yuklash', 'Upload')}
          </Button>
        </>
      }
    >
      <Field label={pick(lang, 'Скан ответного письма или платёжного поручения', 'Javob xati yoki to‘lov topshiriqnomasi skani', 'Scan of the response letter or payment order')} required error={error}>
        <Upload dragger onFiles={(fs) => { setFile(fs[0] ?? null); setError(''); }} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt" ariaLabel="response-file">
          {file ? file.name : pick(lang, 'Перетащите файл или нажмите для выбора', 'Faylni torting yoki tanlash uchun bosing', 'Drop a file or click to choose')}
        </Upload>
      </Field>
      <Field label={t('comment')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} ariaLabel={t('comment')} />
      </Field>
    </Modal>
  );
}

function OcrModal({ doc, files, onClose }: { doc: DocumentRecord; files: StoredFile[]; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [fileId, setFileId] = useState(files[files.length - 1]?.id ?? '');
  return (
    <Modal
      title={`OCR: ${doc.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} disabled={!fileId} onClick={async () => { if (await run(() => documentsApi.recognize(doc.id, user, fileId), `${doc.number}: ${pick(lang, 'текст распознан', 'matn tanildi', 'text recognised')}`)) onClose(); }}>
            {pick(lang, 'Распознать', 'Tanish', 'Recognise')}
          </Button>
        </>
      }
    >
      <Field label={pick(lang, 'Скан-образ', 'Skan-nusxa', 'Scan')}>
        <Select value={fileId} onChange={setFileId} options={files.map((f) => ({ value: f.id, label: f.name }))} ariaLabel="scan" />
      </Field>
      <p className="muted small" style={{ margin: 0 }}>{pick(lang, 'Текстовый слой PDF и текстовые файлы извлекаются в браузере; для решений МИБ, инкассо и требований НО реквизиты платежа заполняются автоматически. Распознавание изображений выполняет сервис OCR на сервере.', 'PDF matn qatlami va matnli fayllar brauzerda olinadi; MIB qarorlari, inkasso va talabnomalar uchun to‘lov rekvizitlari avtomatik to‘ldiriladi. Rasmlarni tanish serverdagi OCR xizmatida.', 'PDF text layers and text files are extracted in the browser; payment details are filled automatically for enforcement decisions, collection orders and tax demands. Image OCR runs on the server.')}</p>
    </Modal>
  );
}
