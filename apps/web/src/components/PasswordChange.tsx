// Смена пароля пользователем (P3-GEN, ТЗ PR-SEC-037): текущий пароль, новый — по парольной политике
// (длина, сложность, отсутствие логина) и истории последних паролей; срок действия пароля.
import { useState } from 'react';
import { AuthError, formatDate, getSecurityPolicy, securityApi, type TKey } from '@xb/shared';
import { Button, Field, Input, Modal, useToast } from './ui';
import { useSession, useUser } from '../lib/session';
import { useApi } from '../lib/useApi';
import './p3gen.css';

export function PasswordChangeModal({ onClose }: { onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const info = useApi(() => securityApi.passwordInfo(user.id), [user.id]);
  const policy = getSecurityPolicy();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setError('');
    if (!current || !next) return setError(t('auth_err_required'));
    if (next !== repeat) return setError(t('pwd_mismatch'));
    setBusy(true);
    try {
      await securityApi.changePassword(current, next);
      toast(t('pwd_changed'));
      onClose();
    } catch (e) {
      if (e instanceof AuthError && e.code === 'invalid') setError(t('pwd_wrong_current'));
      else if (e instanceof AuthError && e.code === 'pwd_policy') setError(`${t('pwd_issues')}: ${(e.extra.issues ?? []).map((k) => t(k as TKey)).join('; ')}`);
      else setError(t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('pwd_change_title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={save}>{t('pwd_change_btn')}</Button>
        </>
      }
    >
      <div className="pwd-change">
        {info.data && (
          <p className="muted small pwd-expiry" style={{ margin: 0 }}>
            {t('pwd_expires')}: <b className="num">{formatDate(info.data.expiresAt)}</b> ({Math.max(0, info.data.daysLeft)} {t('pwd_days_left')})
          </p>
        )}
        <Field label={t('pwd_current')} required>
          <Input name="current-password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" ariaLabel={t('pwd_current')} />
        </Field>
        <Field label={t('pwd_new')} required hint={t('pwd_rules_hint').replace('{min}', String(policy.password.minLength)).replace('{history}', String(policy.password.history))}>
          <Input name="new-password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" ariaLabel={t('pwd_new')} />
        </Field>
        <Field label={t('pwd_confirm')} required>
          <Input name="repeat-password" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" ariaLabel={t('pwd_confirm')} onPressEnter={save} />
        </Field>
        {error && <div className="login-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
