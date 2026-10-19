import { useState } from 'react';
import {
  api, classifyDocument, DOCUMENT_CATEGORIES, DOCUMENT_PAYMENT_TYPES, documentsApi, extractPaymentDetails, filesApi, orgApi, pick, tk, today, utf8Decode,
  type DocumentCategory, type DocumentKind, type DocumentPriority, type DocumentSource,
} from '@xb/shared';
import { Button, Card, Checkbox, Field, Input, PageHeader, RouteSteps, Select, Textarea, Upload, useToast } from '../../components/ui';
import { readFileBytes } from '../../components/download';
import { navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Note } from './p2docs';

const KINDS: DocumentKind[] = ['incoming', 'outgoing', 'internal'];
const HARD: DocumentCategory[] = ['mib_decision', 'tax_demand', 'collection_order', 'notice'];
const TEMPLATES: Partial<Record<DocumentCategory, string>> = {
  order: 'ПРИКАЗ\n\nО …\n\nВ целях …\nПРИКАЗЫВАЮ:\n1. …\n2. Контроль за исполнением приказа возложить на …',
  instruction: 'РАСПОРЯЖЕНИЕ\n\n1. …\n2. Срок исполнения — …',
  memo: 'Служебная записка\n\nПрошу …\n\nОбоснование: …',
  protocol: 'ПРОТОКОЛ заседания № …\n\nПрисутствовали: …\nПовестка дня:\n1. …\nСлушали: …\nРешили: …',
  act: 'АКТ\n\nКомиссия в составе: …\nсоставила настоящий акт о том, что …',
  letter: 'Уважаемые коллеги!\n\nСообщаем, что …\n\nС уважением,',
};

export function DocumentFormPage() {
  const { t, loc, lang } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const toast = useToast();
  const contracts = useApi(() => api.listContracts());
  const ccs = useApi(() => orgApi.listCostCenters({ pageSize: 60 }));
  const [kind, setKind] = useState<DocumentKind>('incoming');
  const [type, setType] = useState<DocumentCategory>('letter');
  const [source, setSource] = useState<DocumentSource>('manual');
  const [correspondent, setCorrespondent] = useState('');
  const [correspondentNumber, setCorrespondentNumber] = useState('');
  const [subject, setSubject] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [executorId, setExecutorId] = useState(user.id);
  const [departmentId, setDepartmentId] = useState(user.departmentId);
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState<DocumentPriority>('normal');
  const [control, setControl] = useState(true);
  const [pages, setPages] = useState('1');
  const [contractId, setContractId] = useState('');
  const [pay, setPay] = useState({ amount: '', recipient: '', recipientTin: '', account: '', mfo: '', treasuryAccount: '', purpose: '' });
  const [aur, setAur] = useState({ amount: '', costCenterKey: '', article: 'OPEX-02' });
  const [scan, setScan] = useState<File | null>(null);
  const [ocr, setOcr] = useState('');
  const [hint, setHint] = useState('');
  const [submit, setSubmit] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const hard = kind === 'incoming' && HARD.includes(type);
  const isPay = DOCUMENT_PAYMENT_TYPES.includes(type);
  const isAur = type === 'aur';
  const deadlinePast = !!deadline && deadline < today();
  const pagesN = Number(pages);
  const payValid = !isPay || (Number(pay.amount) > 0 && /^\d{20}$/.test(pay.account) && /^\d{5}$/.test(pay.mfo) && pay.recipient.trim());
  const aurValid = !isAur || (Number(aur.amount) > 0 && aur.costCenterKey);
  const contractValid = type !== 'payment_demand' || !!contractId;
  const valid = correspondent.trim() && subject.trim() && summary.trim() && pagesN > 0 && (hard || !control || deadline) && !deadlinePast && payValid && aurValid && contractValid;
  const err = (ok: unknown) => (showErrors && !ok ? t('formRequired') : undefined);

  function suggest() {
    const c = classifyDocument(`${subject} ${summary} ${ocr}`);
    if (!c) return setHint(pick(lang, 'Правила не нашли профильный департамент — выберите вручную', 'Qoidalar mos departamentni topmadi — qo‘lda tanlang', 'No matching department — choose manually'));
    setDepartmentId(c.departmentId);
    if (c.executorId) setExecutorId(c.executorId);
    setHint(`${pick(lang, 'Направление по содержанию', 'Mazmuniga ko‘ra yo‘nalish', 'Routing by content')}: ${loc(lk.department(c.departmentId)?.name ?? { ru: c.departmentId, uz: c.departmentId })} (${c.keywords.join(', ')})`);
  }

  async function onScan(f: File) {
    setScan(f);
    setSource('scan');
    if (f.type.startsWith('text/') || /\.txt$/i.test(f.name)) {
      const text = utf8Decode(await readFileBytes(f)).replace(/\s+/g, ' ').trim();
      setOcr(text);
      if (!summary) setSummary(text.slice(0, 220));
      const p = extractPaymentDetails(text, subject || text.slice(0, 80));
      if (p) setPay({ amount: String(p.amount), recipient: p.recipient, recipientTin: p.recipientTin, account: p.account, mfo: p.mfo, treasuryAccount: p.treasuryAccount ?? '', purpose: p.purpose });
    }
  }

  async function save() {
    if (!valid) return setShowErrors(true);
    setBusy(true);
    try {
      const doc = await documentsApi.register(
        {
          kind,
          type,
          source,
          correspondent: correspondent.trim(),
          ...(correspondentNumber.trim() ? { correspondentNumber: correspondentNumber.trim() } : {}),
          subject: subject.trim(),
          summary: summary.trim(),
          ...(body.trim() ? { body: body.trim() } : {}),
          ...(ocr ? { ocrText: ocr } : {}),
          ...(deadline && !hard ? { deadline } : {}),
          executorId,
          departmentId,
          priority,
          control,
          pages: pagesN,
          ...(contractId ? { contractId } : {}),
          ...(isPay ? { paymentDetails: { amount: Number(pay.amount), recipient: pay.recipient.trim(), recipientTin: pay.recipientTin.trim(), account: pay.account, mfo: pay.mfo, ...(pay.treasuryAccount ? { treasuryAccount: pay.treasuryAccount } : {}), purpose: pay.purpose.trim() || subject.trim() } } : {}),
          ...(isAur ? { aur: { amount: Number(aur.amount), costCenterKey: aur.costCenterKey, article: aur.article } } : {}),
          submit,
        },
        user,
      );
      if (scan) {
        const f = await filesApi.upload({ entity: 'document', entityId: doc.id, name: scan.name, mime: scan.type, data: await readFileBytes(scan), category: 'scan' }, user);
        if (!ocr) await documentsApi.recognize(doc.id, user, f.id);
      }
      toast(`${doc.number}: ${t(submit ? 'documents_status_pending' : 'documents_status_registered')}`);
      navigate(`/documents/${doc.id}`);
    } catch {
      toast(t('documents_actionError'));
    } finally {
      setBusy(false);
    }
  }

  if (!can('documents', 'edit')) {
    return (
      <>
        <PageHeader crumbs={[{ label: t('documents_title'), to: '/documents' }, { label: t('documents_register') }]} title={t('documents_register')} />
        <Card><Note tone="warn">{t('noAccess')}</Note></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader crumbs={[{ label: t('documents_title'), to: '/documents' }, { label: t('documents_register') }]} title={t('documents_register')} />
      <Card title={pick(lang, 'Скан-образ (сканирование и OCR)', 'Skan-nusxa (skanerlash va OCR)', 'Scan (scanning and OCR)')}>
        <Upload dragger onFiles={(fs) => fs[0] && void onScan(fs[0])} accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.txt" ariaLabel="scan">
          {scan ? scan.name : pick(lang, 'Перетащите скан бумажного документа или нажмите для выбора', 'Qog‘oz hujjat skanini torting yoki tanlash uchun bosing', 'Drop a scan of the paper document or click to choose')}
        </Upload>
        {ocr && <p className="p2-text muted" style={{ marginTop: 10 }}>{ocr.slice(0, 400)}</p>}
      </Card>
      <Card title={t('details')}>
        <div className="form-grid">
          <Field label={t('documents_kindLabel')} required>
            <Select<DocumentKind> value={kind} onChange={(v) => { setKind(v); if (v !== 'incoming' && HARD.includes(type)) setType('letter'); }} options={KINDS.map((k) => ({ value: k, label: t(tk('documents_kind_', k)) }))} ariaLabel={t('documents_kindLabel')} />
          </Field>
          <Field label={t('documents_typeLabel')} required>
            <Select<DocumentCategory> value={type} onChange={(v) => { setType(v); if (!body && TEMPLATES[v] && kind !== 'incoming') setBody(TEMPLATES[v]!); }} options={DOCUMENT_CATEGORIES.filter((c) => kind === 'incoming' || !HARD.includes(c)).map((c) => ({ value: c, label: t(tk('documents_type_', c)) }))} ariaLabel={t('documents_typeLabel')} />
          </Field>
          <Field label={t('documents_correspondent')} required error={err(correspondent.trim())}>
            <Input value={correspondent} onChange={(e) => setCorrespondent(e.target.value)} ariaLabel={t('documents_correspondent')} />
          </Field>
          <Field label={t('documents_correspondentNumber')}>
            <Input value={correspondentNumber} onChange={(e) => setCorrespondentNumber(e.target.value)} ariaLabel={t('documents_correspondentNumber')} />
          </Field>
          <Field label={t('documents_subject')} required error={err(subject.trim())} className="span-2">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} ariaLabel={t('documents_subject')} />
          </Field>
          <Field label={t('documents_summary')} required error={err(summary.trim())} className="span-2">
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} ariaLabel={t('documents_summary')} />
          </Field>
          {kind !== 'incoming' && (
            <Field label={pick(lang, 'Текст проекта документа', 'Hujjat loyihasi matni', 'Draft text')} className="span-2" hint={pick(lang, 'Шаблон подставляется по типу документа', 'Shablon hujjat turiga qarab qo‘yiladi', 'Template inserted by document type')}>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} ariaLabel={pick(lang, 'Текст проекта документа', 'Hujjat loyihasi matni', 'Draft text')} />
            </Field>
          )}
          <Field label={t('department')} hint={hint || undefined}>
            <div className="p2-row" style={{ flexWrap: 'nowrap' }}>
              <Select value={departmentId} onChange={setDepartmentId} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} ariaLabel={t('department')} />
              <Button size="small" icon="sparkles" onClick={suggest} title={pick(lang, 'Определить по содержанию', 'Mazmuniga ko‘ra aniqlash', 'Detect by content')} />
            </div>
          </Field>
          <Field label={t('documents_executor')} required>
            <Select value={executorId} onChange={setExecutorId} options={lk.users.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: u.fullName }))} ariaLabel={t('documents_executor')} />
          </Field>
          <Field label={t('documents_deadline')} required={control && !hard} error={hard ? undefined : deadlinePast ? t('documents_pastDeadline') : err(!control || deadline)} hint={hard ? pick(lang, '10 календарных дней с момента загрузки — устанавливается автоматически', 'Yuklangandan 10 kalendar kun — avtomatik', '10 calendar days from upload — set automatically') : undefined}>
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} disabled={hard} ariaLabel={t('documents_deadline')} />
          </Field>
          <Field label={t('documents_priority')}>
            <Select<DocumentPriority> value={priority} onChange={setPriority} options={[{ value: 'normal', label: t('documents_priority_normal') }, { value: 'high', label: t('documents_priority_high') }]} ariaLabel={t('documents_priority')} />
          </Field>
          <Field label={t('documents_pages')} required error={showErrors && !(pagesN > 0) ? t('formRequired') : undefined}>
            <Input type="number" value={pages} onChange={(e) => setPages(e.target.value)} ariaLabel={t('documents_pages')} />
          </Field>
          <Field label={pick(lang, 'Договор (учёт договоров)', 'Shartnoma (shartnomalar hisobi)', 'Contract (contract register)')} required={type === 'payment_demand'} error={showErrors && !contractValid ? t('formRequired') : undefined}>
            <Select value={contractId} onChange={setContractId} placeholder="—" options={(contracts.data ?? []).map((c) => ({ value: c.id, label: `${c.number} · ${c.subject}` }))} ariaLabel="contract" />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Checkbox checked={control} onChange={setControl}>{t('documents_control')}</Checkbox>
        </div>
      </Card>

      {isPay && (
        <Card title={pick(lang, 'Реквизиты платежа (из документа)', "To'lov rekvizitlari (hujjatdan)", 'Payment details (from the document)')}>
          <div className="form-grid">
            <Field label={pick(lang, 'Сумма, сум', 'Summa, so‘m', 'Amount, UZS')} required error={showErrors && !(Number(pay.amount) > 0) ? t('formRequired') : undefined}>
              <Input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} ariaLabel="amount" />
            </Field>
            <Field label={pick(lang, 'Получатель', 'Oluvchi', 'Beneficiary')} required error={showErrors && !pay.recipient.trim() ? t('formRequired') : undefined}>
              <Input value={pay.recipient} onChange={(e) => setPay({ ...pay, recipient: e.target.value })} ariaLabel="recipient" />
            </Field>
            <Field label={pick(lang, 'Расчётный счёт (20 цифр)', 'Hisob raqami (20 raqam)', 'Account (20 digits)')} required error={showErrors && !/^\d{20}$/.test(pay.account) ? '20' : undefined}>
              <Input value={pay.account} onChange={(e) => setPay({ ...pay, account: e.target.value.replace(/\D/g, '') })} maxLength={20} ariaLabel="account" />
            </Field>
            <Field label={pick(lang, 'МФО (5 цифр)', 'MFO (5 raqam)', 'Bank code (5 digits)')} required error={showErrors && !/^\d{5}$/.test(pay.mfo) ? '5' : undefined}>
              <Input value={pay.mfo} onChange={(e) => setPay({ ...pay, mfo: e.target.value.replace(/\D/g, '') })} maxLength={5} ariaLabel="mfo" />
            </Field>
            <Field label={t('tin')}>
              <Input value={pay.recipientTin} onChange={(e) => setPay({ ...pay, recipientTin: e.target.value.replace(/\D/g, '') })} maxLength={9} ariaLabel="tin" />
            </Field>
            <Field label={pick(lang, 'Казначейский лицевой счёт', 'G‘aznachilik shaxsiy hisobi', 'Treasury account')}>
              <Input value={pay.treasuryAccount} onChange={(e) => setPay({ ...pay, treasuryAccount: e.target.value.replace(/\D/g, '') })} maxLength={27} ariaLabel="treasury" />
            </Field>
            <Field label={pick(lang, 'Назначение платежа', "To'lov maqsadi", 'Purpose')} className="span-2">
              <Input value={pay.purpose} onChange={(e) => setPay({ ...pay, purpose: e.target.value })} ariaLabel="purpose" />
            </Field>
          </div>
        </Card>
      )}

      {isAur && (
        <Card title={pick(lang, 'Административно-управленческий расход', 'Ma’muriy-boshqaruv xarajati', 'Administrative expense')}>
          <div className="form-grid">
            <Field label={pick(lang, 'Сумма, сум', 'Summa, so‘m', 'Amount, UZS')} required error={showErrors && !(Number(aur.amount) > 0) ? t('formRequired') : undefined}>
              <Input type="number" value={aur.amount} onChange={(e) => setAur({ ...aur, amount: e.target.value })} ariaLabel="aur-amount" />
            </Field>
            <Field label={pick(lang, 'МВЗ', 'XJM', 'Cost centre')} required error={showErrors && !aur.costCenterKey ? t('formRequired') : undefined}>
              <Select value={aur.costCenterKey} onChange={(v) => setAur({ ...aur, costCenterKey: v })} placeholder="—" options={(ccs.data?.rows ?? []).map((c) => ({ value: c.key, label: `${c.code} · ${loc(c.name)}` }))} ariaLabel="cost-center" />
            </Field>
            <Field label={pick(lang, 'Статья расходов', 'Xarajat moddasi', 'Expense article')}>
              <Select value={aur.article} onChange={(v) => setAur({ ...aur, article: v })} options={['OPEX-02', 'OPEX-03', 'OPEX-04', 'OPEX-05', 'OPEX-06', 'OPEX-08'].map((a) => ({ value: a, label: a }))} ariaLabel="article" />
            </Field>
          </div>
        </Card>
      )}

      <Card title={t('route')}>
        <Checkbox checked={submit} onChange={setSubmit}>{t('documents_submitOnCreate')}</Checkbox>
        {submit && (
          <div style={{ marginTop: 12 }}>
            <RouteSteps preview={{ entity: 'document', context: { subtype: type, kind, departmentId } }} />
          </div>
        )}
      </Card>

      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate('/documents')}>{t('cancel')}</Button>
        <Button type="primary" disabled={busy} onClick={save}>{t('documents_register')}</Button>
      </div>
    </>
  );
}
