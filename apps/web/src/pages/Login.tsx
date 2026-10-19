import { useEffect, useState } from 'react';
import { adApi, api, AuthError, DEMO_PASSWORD, IS_DEMO_BUILD, formatDate, formatDateTime, getSecurityPolicy, securityApi, tk, toCyrillic, type TKey, type User, userError } from '@xb/shared';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Button, Field, Input, Loading, Modal, Select, Tabs } from '../components/ui';
import { Icon } from '../components/icons';
import { LangSwitch } from '../components/LangSwitch';

type Step =
  | { kind: 'credentials' }
  | { kind: 'otp'; challengeId: string; demoCode: string; phoneMask: string; userName: string; sentAt: number }
  | { kind: 'password'; challengeId: string; userName: string; daysLeft: number };

export function LoginPage() {
  const { t, loc, lang, login, completeLogin } = useSession();
  const users = useApi(() => api.listUsers());
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oneId, setOneId] = useState(false);
  // P4-GEN (PR-GEN-018): вход учётной записью банка или доменной учётной записью Active Directory
  const [mode, setMode] = useState<'local' | 'ad'>('local');
  const policy = getSecurityPolicy();
  // P3-GEN: причина завершения предыдущего сеанса (лимит сессий, рабочее время, блокировка, бездействие…)
  const [endReason] = useState<string | null>(() => {
    try {
      const r = window.localStorage.getItem('xb.endReason');
      window.localStorage.removeItem('xb.endReason');
      return r;
    } catch {
      return null;
    }
  });

  const modules = (
    lang === 'ru'
      ? ['Закупки и тендеры', 'Договоры', 'Склад', 'Основные средства', 'Автопарк', 'Документооборот', 'Бюджетирование', 'FTP', 'МСФО', 'Налоги', 'Касса']
      : lang === 'en'
        ? ['Procurement', 'Contracts', 'Warehouse', 'Fixed assets', 'Fleet', 'Document flow', 'Budgeting', 'FTP', 'IFRS', 'Taxes', 'Cash desk']
        : ['Xaridlar', 'Shartnomalar', 'Ombor', 'Asosiy vositalar', 'Avtopark', 'Hujjat aylanishi', 'Byudjet', 'FTP', 'MHXS', 'Soliqlar', 'Kassa']
  ).map((m) => (lang === 'uzc' ? toCyrillic(m) : m));

  const authMessage = (e: unknown): string => {
    if (!(e instanceof AuthError)) return `${t('actionFailed')}: ${userError(e)}`;
    switch (e.code) {
      case 'invalid':
        return e.extra.attemptsLeft !== undefined ? `${t('auth_err_invalid')} ${t('auth_attempts_left')}: ${e.extra.attemptsLeft}` : t('auth_err_invalid');
      case 'otp_invalid':
        return `${t('auth_otp_invalid')} ${t('auth_attempts_left')}: ${e.extra.attemptsLeft ?? 0}`;
      case 'locked':
        return `${t('auth_err_locked')} ${e.extra.until ? formatDateTime(e.extra.until) : ''}. ${t('auth_err_locked_hint')}`;
      case 'inactive':
        return t('auth_err_inactive');
      case 'otp_expired':
        return t('auth_otp_expired');
      case 'off_hours':
        return t('auth_err_off_hours');
      case 'suspended':
        return `${t('auth_err_suspended')} ${e.extra.until ? formatDate(e.extra.until) : ''}`;
      case 'service_account':
        return t('auth_err_service');
      case 'pwd_policy':
        return `${t('pwd_issues')}: ${(e.extra.issues ?? []).map((k) => t(k as TKey)).join('; ')}`;
      default:
        return t('actionFailed');
    }
  };

  async function submitCredentials() {
    setError('');
    if (!username.trim() || !password) return setError(t('auth_err_required'));
    setBusy(true);
    try {
      if (mode === 'ad') {
        const r = await adApi.authenticate(username, password);
        setCode('');
        setStep({ kind: 'otp', ...r, sentAt: Date.now() });
        return;
      }
      const r = await securityApi.authenticate(username, password);
      setCode('');
      if (r.mustChangePassword) setStep({ kind: 'password', challengeId: r.challengeId, userName: r.userName, daysLeft: r.passwordDaysLeft });
      else setStep({ kind: 'otp', challengeId: r.challengeId, demoCode: r.demoCode, phoneMask: r.phoneMask, userName: r.userName, sentAt: Date.now() });
    } catch (e) {
      setError(mode === 'ad' && adApi.isUnavailable(e) ? t('p4g_login_adDown') : authMessage(e));
      if (e instanceof AuthError && e.code === 'locked') setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp() {
    if (step.kind !== 'otp') return;
    setError('');
    if (!/^\d{6}$/.test(code.trim())) return setError(t('auth_otp_format'));
    setBusy(true);
    try {
      const u = await securityApi.verifyOtp(step.challengeId, code);
      completeLogin(u);
    } catch (e) {
      setError(authMessage(e));
      if (e instanceof AuthError && (e.code === 'locked' || e.code === 'otp_expired')) {
        setStep({ kind: 'credentials' });
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  }

  const active = users.data?.filter((u) => u.active !== false) ?? [];

  return (
    <div className="login">
      <section className="login-hero">
        <div className="brand">
          <div className="brand-mark">XB</div>
          <div>
            <div className="brand-name">{t('appName')}</div>
            <div className="brand-sub" style={{ color: '#cfe7d8' }}>{t('bankName')}</div>
          </div>
        </div>
        <div>
          <h1>{t('loginSubtitle')}</h1>
          <p style={{ marginTop: 14 }}>Xalq Bank Enterprise Resource Planning</p>
        </div>
        <div className="login-modules">
          {modules.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      </section>

      <section className="login-panel">
        <div className="login-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2>{t('loginTitle')}</h2>
            <LangSwitch />
          </div>
          {/* P4-SEC (PR-SEC-043): маркер демо-стенда; в промышленной сборке — пометка о входе с 2FA */}
          {IS_DEMO_BUILD ? (
            <div className="demo-pill build-demo" data-build="demo" style={{ alignSelf: 'flex-start' }}>DEMO · {t('demoMode')}</div>
          ) : (
            <div className="muted small build-prod" data-build="production">{t('auth_prod_note')}</div>
          )}
          {endReason && step.kind === 'credentials' && (
            <div className="banner warn session-ended" role="status">
              {t('sess_end_prefix')}: {t(tk('sess_reason_', endReason))}
            </div>
          )}

          {step.kind === 'credentials' ? (
            <form
              className="login-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitCredentials();
              }}
            >
              <Tabs<'local' | 'ad'>
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setError('');
                }}
                items={[
                  { value: 'local', label: t('p4g_login_local') },
                  { value: 'ad', label: t('p4g_login_ad') },
                ]}
              />
              <Field label={mode === 'ad' ? t('p4g_login_adUser') : t('auth_username')} required hint={mode === 'ad' ? t('p4g_login_adHint') : undefined}>
                <Input name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder={mode === 'ad' ? 'XALQ\\b.azizov' : 'b.azizov'} ariaLabel={mode === 'ad' ? t('p4g_login_adUser') : t('auth_username')} />
              </Field>
              <Field label={t('auth_password')} required>
                <div className="pwd-wrap">
                  <Input name="password" type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" ariaLabel={t('auth_password')} />
                  <button type="button" className="pwd-eye" onClick={() => setShowPwd((v) => !v)} aria-label={t('auth_show_password')} title={t('auth_show_password')}>
                    {showPwd ? '◡' : '◉'}
                  </button>
                </div>
              </Field>
              {error && <div className="login-error" role="alert">{error}</div>}
              <Button htmlType="submit" type={selected ? 'default' : 'primary'} size="large" loading={busy} block>
                {t('loginButton')}
              </Button>
              {IS_DEMO_BUILD && (
                <div className="demo-hint">
                  <Icon name="alert" size={14} />
                  <span>
                    {t('auth_demo_password_hint')} <b className="num demo-password">{DEMO_PASSWORD}</b>
                  </span>
                </div>
              )}
              <p className="muted small" style={{ margin: 0 }}>
                {t('auth_policy_text').replace('{min}', String(policy.password.minLength)).replace('{days}', String(policy.password.expiryDays)).replace('{attempts}', String(policy.password.maxAttempts)).replace('{lock}', String(policy.password.lockMinutes))}
              </p>
              {IS_DEMO_BUILD && (
                <Button type="default" onClick={() => setOneId(true)} block className="oneid-btn">
                  <span className="oneid-mark">ID</span> {t('auth_oneid')}
                </Button>
              )}
            </form>
          ) : step.kind === 'password' ? (
            <ExpiredPasswordStep
              step={step}
              onBack={() => {
                setStep({ kind: 'credentials' });
                setPassword('');
                setError('');
              }}
              onDone={(r) => {
                setCode('');
                setError('');
                setStep({ kind: 'otp', ...r, sentAt: Date.now() });
              }}
              authMessage={authMessage}
            />
          ) : (
            <OtpStep
              step={step}
              code={code}
              setCode={setCode}
              error={error}
              busy={busy}
              onSubmit={submitOtp}
              onBack={() => {
                setStep({ kind: 'credentials' });
                setError('');
              }}
              onResend={async () => {
                const r = await securityApi.resendOtp(step.challengeId);
                setStep({ ...step, demoCode: r.demoCode, sentAt: Date.now() });
                setError('');
              }}
            />
          )}

          {IS_DEMO_BUILD && step.kind === 'credentials' && (
            <div className="login-demo">
              <div className="login-demo-head">
                <b>{t('auth_quick_title')}</b>
                <span className="muted small">{t('auth_quick_hint')}</span>
              </div>
              {users.loading && !users.data ? (
                <Loading />
              ) : (
                <div className="user-list">
                  {active.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className={`user-option ${selected === u.id ? 'on' : ''}`}
                      onClick={() => {
                        setSelected(u.id);
                        setUsername(u.login ?? '');
                        setError('');
                      }}
                    >
                      <div className="avatar">{u.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
                      <div>
                        <div className="name">{u.fullName}</div>
                        <div className="role">
                          {t(tk('role_', u.role))} · {loc(u.position)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selected && (
                <Button
                  type="primary"
                  size="large"
                  className="quick-login-btn"
                  loading={busy}
                  block
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await login(selected);
                    } catch (e) {
                      setError(authMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('auth_quick_button')}
                </Button>
              )}
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>{t('loginSso')}</p>
        </div>
      </section>
      {IS_DEMO_BUILD && oneId && (
        <OneIdModal
          users={active}
          onClose={() => setOneId(false)}
          onDone={(u) => {
            setOneId(false);
            completeLogin(u);
          }}
        />
      )}
    </div>
  );
}

/** PR-SEC-037: смена просроченного пароля на входе (политика, история паролей) → затем второй фактор. */
function ExpiredPasswordStep({
  step, onBack, onDone, authMessage,
}: {
  step: Extract<Step, { kind: 'password' }>;
  onBack: () => void;
  onDone: (r: { challengeId: string; demoCode: string; phoneMask: string; userName: string }) => void;
  authMessage: (e: unknown) => string;
}) {
  const { t } = useSession();
  const policy = getSecurityPolicy();
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setError('');
    if (!next || next !== repeat) return setError(t('pwd_mismatch'));
    setBusy(true);
    try {
      onDone(await securityApi.changeExpiredPassword(step.challengeId, next));
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="login-form pwd-expired-step"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="otp-head">
        <div className="otp-step-badge">!</div>
        <div>
          <b>{step.daysLeft <= 0 ? t('pwd_expired_title') : t('pwd_must_change_badge')}</b>
          <div className="muted small">{step.userName}</div>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{step.daysLeft <= 0 ? t('pwd_expired_text') : t('pwd_must_change_text')}</p>
      <Field label={t('pwd_new')} required hint={t('pwd_rules_hint').replace('{min}', String(policy.password.minLength)).replace('{history}', String(policy.password.history))}>
        <Input name="new-password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" ariaLabel={t('pwd_new')} />
      </Field>
      <Field label={t('pwd_confirm')} required>
        <Input name="repeat-password" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" ariaLabel={t('pwd_confirm')} />
      </Field>
      {error && <div className="login-error" role="alert">{error}</div>}
      <Button htmlType="submit" type="primary" size="large" loading={busy} block>
        {t('pwd_change_btn')}
      </Button>
      <Button type="link" size="small" onClick={onBack} icon="arrowLeft">{t('back')}</Button>
    </form>
  );
}

function OtpStep({
  step, code, setCode, error, busy, onSubmit, onBack, onResend,
}: {
  step: Extract<Step, { kind: 'otp' }>;
  code: string;
  setCode: (v: string) => void;
  error: string;
  busy: boolean;
  onSubmit: () => void;
  onBack: () => void;
  onResend: () => void;
}) {
  const { t } = useSession();
  const [left, setLeft] = useState(300);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, 300 - Math.floor((Date.now() - step.sentAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [step.sentAt]);
  return (
    <form
      className="login-form otp-step"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="otp-head">
        <div className="otp-step-badge">2 / 2</div>
        <div>
          <b>{t('auth_otp_title')}</b>
          <div className="muted small">
            {step.userName} · {t('auth_otp_sent')} {step.phoneMask}
          </div>
        </div>
      </div>
      <Field label={t('auth_otp_label')} required hint={`${t('auth_otp_valid')} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}>
        <Input name="otp" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} autoFocus autoComplete="one-time-code" className="otp-input" ariaLabel={t('auth_otp_label')} />
      </Field>
      {IS_DEMO_BUILD && step.demoCode ? (
        <div className="demo-hint">
          <Icon name="alert" size={14} />
          <span>
            {t('auth_demo_code')}: <b className="demo-code num">{step.demoCode}</b>
          </span>
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>{t('auth_prod_otp_hint')}</p>
      )}
      {error && <div className="login-error" role="alert">{error}</div>}
      <Button htmlType="submit" type="primary" size="large" loading={busy} block>
        {t('auth_otp_verify')}
      </Button>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Button type="link" size="small" onClick={onBack} icon="arrowLeft">{t('back')}</Button>
        <Button type="link" size="small" onClick={onResend}>{t('auth_otp_resend')}</Button>
      </div>
    </form>
  );
}

/** Имитация входа через OneID (id.egov.uz): в продуктиве — OAuth2-редирект и сопоставление по ПИНФЛ. */
function OneIdModal({ users, onClose, onDone }: { users: User[]; onClose: () => void; onDone: (u: User) => void }) {
  const { t } = useSession();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pinfl = (id: string) => `3${String(1000000000000 + Number(id.replace(/\D/g, '')) * 7919).slice(1)}`;
  return (
    <Modal
      title={t('auth_oneid_title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={async () => {
              if (!userId) return setError(t('auth_err_required'));
              setBusy(true);
              try {
                onDone(await securityApi.oneIdLogin(userId));
              } catch (e) {
                setError(e instanceof AuthError && e.code === 'locked' ? t('auth_err_locked') : e instanceof AuthError && e.code === 'off_hours' ? t('auth_err_off_hours') : e instanceof AuthError && e.code === 'suspended' ? `${t('auth_err_suspended')} ${e.extra.until ? formatDate(e.extra.until) : ''}` : t('auth_err_inactive'));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('auth_oneid_confirm')}
          </Button>
        </>
      }
    >
      <div className="oneid-banner">
        <span className="oneid-mark">ID</span>
        <div>
          <b>id.egov.uz</b>
          <div className="small">{t('auth_oneid_text')}</div>
        </div>
      </div>
      <Field label={t('auth_oneid_account')} required error={error}>
        <Select value={userId} onChange={setUserId} placeholder="—" options={users.map((u) => ({ value: u.id, label: `${u.fullName} · ${t('auth_pinfl')} ${pinfl(u.id)}` }))} ariaLabel={t('auth_oneid_account')} />
      </Field>
      <p className="muted small" style={{ margin: 0 }}>{t('auth_oneid_note')}</p>
    </Modal>
  );
}
