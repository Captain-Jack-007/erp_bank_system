// Подпись E-IMZO для любого документа: выбор сертификата, PIN, хэш содержимого, метка времени TSA.
//   <SignModal doc={{ entity: 'contract', entityId: c.id, title: c.number, content: c }} onClose={…} onSigned={(rec) => …} />
//   <SignaturesPanel doc={…} canSign />  — список подписей с проверкой и кнопкой «Подписать».
import { useMemo, useState } from 'react';
import {
  checkSignature, documentHash, formatDate, formatDateTime, signatureService, SignError, tk,
  type SignableDoc, type SignatureRecord, type SignatureStatus,
} from '@xb/shared';
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, useToast, type Tone } from './ui';
import { Icon } from './icons';
import { useSession, useUser } from '../lib/session';
import { useApi } from '../lib/useApi';

const TONE: Record<SignatureStatus, Tone> = { valid: 'ok', expired: 'warn', revoked: 'danger', tampered: 'danger' };

export function SignModal({ doc, onClose, onSigned }: { doc: SignableDoc; onClose: () => void; onSigned?: (rec: SignatureRecord) => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const certs = useApi(() => signatureService.certificates(user), [user.id]);
  const today = new Date().toISOString().slice(0, 10);
  const list = certs.data ?? [];
  const firstValid = list.find((c) => c.validTo >= today && !c.revoked)?.serial ?? list[0]?.serial ?? '';
  const [cert, setCert] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = cert || firstValid;
  const hash = useMemo(() => documentHash(doc.content), [doc.content]);

  async function sign() {
    setError('');
    setBusy(true);
    try {
      const rec = await signatureService.sign(doc, user, selected, pin);
      toast(t('svc_signedOk'));
      onSigned?.(rec);
      onClose();
    } catch (e) {
      setError(t(tk('svc_signErr_', e instanceof SignError ? e.code : 'eimzo_unavailable')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('svc_signTitle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" icon="pen" loading={busy} disabled={!selected} onClick={sign}>
            {t('svc_signButton')}
          </Button>
        </>
      }
    >
      <dl className="svc-kv">
        <dt>{t('svc_signDoc')}</dt>
        <dd>{doc.title}</dd>
        <dt>{t('svc_signHash')}</dt>
        <dd className="svc-hash" data-testid="sign-hash">{hash}</dd>
      </dl>
      <Field label={t('svc_signCert')} required>
        <Select
          value={selected}
          onChange={(v) => {
            setCert(v);
            setError('');
          }}
          ariaLabel={t('svc_signCert')}
          options={list.map((c) => ({
            value: c.serial,
            label: `${c.owner} · ${c.serial} · ${c.validTo < today ? t('svc_signExpiredCert') : t('svc_signValidTo')} ${formatDate(c.validTo)}`,
          }))}
        />
      </Field>
      <Field label={t('svc_signPin')} required hint={t('svc_signPinHint')} error={error}>
        <Input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          maxLength={8}
          ariaLabel={t('svc_signPin')}
          onChange={(e) => {
            setPin(e.target.value);
            setError('');
          }}
          onPressEnter={sign}
        />
      </Field>
    </Modal>
  );
}

/** Бейдж статуса подписи (проверка выполняется на клиенте по хэшу содержимого). */
export function SignatureBadge({ record, content }: { record: SignatureRecord; content?: unknown }) {
  const { t } = useSession();
  const check = checkSignature(record, content);
  return (
    <span title={`${record.owner} · ${record.certSerial} · ${formatDateTime(record.signedAt)}`} data-testid="sig-badge" data-status={check.status}>
      <Badge tone={TONE[check.status]}>{t(tk('svc_sigStatus_', check.status))}</Badge>
    </span>
  );
}

export function SignatureItem({ record, content }: { record: SignatureRecord; content?: unknown }) {
  const { t } = useSession();
  return (
    <div className="svc-sig">
      <div className="svc-sig-head">
        <span>
          <Icon name="shield" size={15} /> {record.owner}
        </span>
        <SignatureBadge record={record} content={content} />
      </div>
      <div className="small muted">
        {t('svc_sigSerial')}: {record.certSerial} · {t('svc_sigCertPeriod')}: {formatDate(record.certValidFrom)} – {formatDate(record.certValidTo)}
      </div>
      <div className="small muted">
        {t('svc_sigTime')}: {formatDateTime(record.signedAt)} · {record.tsaAuthority} #{record.tsaSerial}
      </div>
      <div className="svc-hash">SHA-256: {record.hash}</div>
    </div>
  );
}

/** Карточка «Электронные подписи» для любой карточки документа. */
export function SignaturesPanel({ doc, canSign = true, onSigned }: { doc: SignableDoc; canSign?: boolean; onSigned?: (rec: SignatureRecord) => void }) {
  const { t } = useSession();
  const sigs = useApi(() => signatureService.list(doc.entity, doc.entityId), [doc.entity, doc.entityId]);
  const [open, setOpen] = useState(false);
  return (
    <Card
      title={t('svc_signatures')}
      actions={
        canSign ? (
          <Button size="small" type="primary" icon="pen" onClick={() => setOpen(true)}>
            {t('svc_sign')}
          </Button>
        ) : undefined
      }
    >
      {sigs.data && !sigs.data.length ? (
        <Empty text={t('svc_noSignatures')} icon="shield" />
      ) : (
        <div className="svc-sig-list">
          {(sigs.data ?? []).map((s) => (
            <SignatureItem key={s.id} record={s} content={doc.content} />
          ))}
        </div>
      )}
      {open && <SignModal doc={doc} onClose={() => setOpen(false)} {...(onSigned ? { onSigned } : {})} />}
    </Card>
  );
}
