// Парольная политика и параметры сессий (ТЗ PR-SEC-037/038): настраиваются администратором,
// значения слабее политики ИБ банка не сохраняются. Изменение подтверждается одноразовым кодом.
import { useEffect, useState } from 'react';
import { formatDateTime, passwordViolations, POLICY_FLOOR, securityApi, tk, ValidationError, type SecurityPolicy, type SessionRecord } from '@xb/shared';
import { Badge, Button, Card, DataTable, Field, Input, Loading, PageHeader, Switch, useToast } from '../../components/ui';
import { useCan, useStepUp } from '../../lib/access';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { DlpCard, ServiceAccountsCard } from './SecurityExtras';

export function SecurityPage() {
  const { t } = useSession();
  const toast = useToast();
  const allowed = useCan();
  const stepUp = useStepUp();
  const canEdit = allowed('security', 'edit');
  const saved = useApi(() => securityApi.getPolicy());
  const [p, setP] = useState<SecurityPolicy | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [test, setTest] = useState('');
  useEffect(() => {
    if (saved.data && !p) setP(saved.data);
  }, [saved.data, p]);
  if (!p) return <Loading />;
  const pw = (patch: Partial<SecurityPolicy['password']>) => setP({ ...p, password: { ...p.password, ...patch } });
  const ss = (patch: Partial<SecurityPolicy['session']>) => setP({ ...p, session: { ...p.session, ...patch } });
  const num = (v: string) => Math.max(0, Math.floor(Number(v.replace(/\D/g, '')) || 0));
  const testIssues = test ? passwordViolations(test, p.password) : [];

  async function save() {
    setIssues([]);
    if (!(await stepUp(t('sec_save')))) return;
    try {
      await securityApi.savePolicy(p!);
      toast(t('sec_saved'));
    } catch (e) {
      if (e instanceof ValidationError) setIssues(Object.keys(e.issues));
      else toast(t('actionFailed'));
    }
  }

  return (
    <>
      <PageHeader
        title={t('sec_title')}
        subtitle={`${t('tzLabel')} PR-SEC-037, PR-SEC-038 · ${t('sec_subtitle')}`}
        actions={canEdit && <Button type="primary" onClick={save}>{t('sec_save')}</Button>}
      />
      {!!issues.length && (
        <div className="banner danger" role="alert">
          <b>{t('sec_floor_error')}</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {issues.map((k) => (
              <li key={k}>{t(k as never)}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-2">
        <Card title={t('sec_password')}>
          <div className="form-grid">
            <Field label={t('sec_min_length')} hint={`${t('sec_floor')}: ≥ ${POLICY_FLOOR.minLength}`}>
              <Input value={p.password.minLength} onChange={(e) => pw({ minLength: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t('sec_min_length')} />
            </Field>
            <Field label={t('sec_expiry')} hint={`${t('sec_floor')}: ≤ ${POLICY_FLOOR.maxExpiryDays}`}>
              <Input value={p.password.expiryDays} onChange={(e) => pw({ expiryDays: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t('sec_expiry')} />
            </Field>
            <Field label={t('sec_history')} hint={`${t('sec_floor')}: ≥ ${POLICY_FLOOR.minHistory}`}>
              <Input value={p.password.history} onChange={(e) => pw({ history: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t('sec_history')} />
            </Field>
            <Field label={t('sec_attempts')} hint={`${t('sec_floor')}: ≤ ${POLICY_FLOOR.maxAttempts}`}>
              <Input value={p.password.maxAttempts} onChange={(e) => pw({ maxAttempts: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t('sec_attempts')} />
            </Field>
            <Field label={t('sec_lock_minutes')} hint={`${t('sec_floor')}: ≥ ${POLICY_FLOOR.minLockMinutes}`}>
              <Input value={p.password.lockMinutes} onChange={(e) => pw({ lockMinutes: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t('sec_lock_minutes')} />
            </Field>
          </div>
          <div className="switch-list">
            {(['requireUpper', 'requireLower', 'requireDigit', 'requireSpecial'] as const).map((k) => (
              <label key={k} className="switch-row">
                <Switch checked={p.password[k]} onChange={(v) => pw({ [k]: v })} disabled={!canEdit} ariaLabel={t(`sec_${k}` as never)} />
                <span>{t(`sec_${k}` as never)}</span>
              </label>
            ))}
          </div>
          <Field label={t('sec_tester')} hint={t('sec_tester_hint')}>
            <Input value={test} onChange={(e) => setTest(e.target.value)} type="text" autoComplete="off" ariaLabel={t('sec_tester')} />
          </Field>
          {test && (
            <div className="badges">
              {testIssues.length ? testIssues.map((k) => <Badge key={k} tone="danger">{t(k as never)}</Badge>) : <Badge tone="ok">{t('pwd_ok')}</Badge>}
            </div>
          )}
        </Card>
        <Card title={t('sec_session')}>
          <div className="form-grid">
            <Field label={t('sec_idle')} hint={`${t('sec_floor')}: ≤ ${POLICY_FLOOR.maxIdleMinutes}`}>
              <Input value={p.session.idleMinutes} onChange={(e) => ss({ idleMinutes: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t('sec_idle')} />
            </Field>
            <Field label={t('sec_warn')}>
              <Input value={p.session.warnSeconds} onChange={(e) => ss({ warnSeconds: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t('sec_warn')} />
            </Field>
            <Field label={t('sec_max_hours')} hint={`${t('sec_floor')}: ≤ ${POLICY_FLOOR.maxHours}`}>
              <Input value={p.session.maxHours} onChange={(e) => ss({ maxHours: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t('sec_max_hours')} />
            </Field>
            <Field label={t('sec_max_sessions')} hint={`${t('sec_floor')}: ≤ ${POLICY_FLOOR.maxSessions}`}>
              <Input value={p.session.maxSessions} onChange={(e) => ss({ maxSessions: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t('sec_max_sessions')} />
            </Field>
          </div>
          <div className="switch-list">
            <label className="switch-row">
              <Switch checked={p.session.require2fa} onChange={(v) => ss({ require2fa: v })} disabled={!canEdit} ariaLabel={t('sec_2fa')} />
              <span>{t('sec_2fa')}</span>
            </label>
            <label className="switch-row">
              <Switch checked={p.session.workHoursEnforced} onChange={(v) => ss({ workHoursEnforced: v })} disabled={!canEdit} ariaLabel={t('sec_work_hours')} />
              <span>{t('sec_work_hours')}</span>
            </label>
          </div>
          {p.session.workHoursEnforced && (
            <div className="form-grid">
              <Field label={t('sec_work_from')}>
                <Input value={p.session.workFrom} onChange={(e) => ss({ workFrom: e.target.value })} disabled={!canEdit} ariaLabel={t('sec_work_from')} />
              </Field>
              <Field label={t('sec_work_to')}>
                <Input value={p.session.workTo} onChange={(e) => ss({ workTo: e.target.value })} disabled={!canEdit} ariaLabel={t('sec_work_to')} />
              </Field>
            </div>
          )}
          <ul className="sec-notes">
            <li>{t('sec_note_2fa')}</li>
            <li>{t('sec_note_stepup')}</li>
            <li>{t('sec_note_oneid')}</li>
            <li>{t('sec_note_server')}</li>
          </ul>
        </Card>
      </div>
      <SessionsCard canEdit={canEdit} />
      <DlpCard canEdit={canEdit} />
      <ServiceAccountsCard canEdit={canEdit} />
    </>
  );
}

/** P3-GEN: реестр сессий (PR-SEC-012/038/039) — активные и недавно завершённые, принудительное завершение. */
function SessionsCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useSession();
  const toast = useToast();
  const list = useApi(() => securityApi.listSessions());
  const current = securityApi.currentSessionId();
  const rows = (list.data ?? []) as (SessionRecord & { key: string })[];
  return (
    <Card title={`${t('sess_title')} · ${rows.filter((r) => r.status === 'active').length}`} flush>
      <p className="muted small" style={{ padding: '10px 14px 0', margin: 0 }}>{t('sess_hint')}</p>
      <DataTable
        rows={list.data ? rows : undefined}
        loading={list.loading}
        rowKey={(r) => r.key}
        emptyText="—"
        columns={[
          { header: t('sess_user'), render: (r) => <><div style={{ fontWeight: 600 }}>{r.userName}</div><div className="sub doc-num">{t('sess_id')}: {r.id}{r.key === current ? ` · ${t('sess_current')}` : ''}</div></> },
          { header: t('sess_device'), render: (r) => <><div className="small">{r.device}</div><div className="sub num">{r.ip} · {r.method === 'password+otp' ? t('sess_m_password') : r.method === 'demo' ? t('sess_m_demo') : r.method === 'restore' ? t('sess_m_restore') : r.method}</div></> },
          { header: t('sess_started'), render: (r) => <span className="num small">{formatDateTime(r.startedAt)}</span> },
          {
            header: t('sess_status'),
            render: (r) =>
              r.status === 'active' ? <Badge tone="ok">{t('sess_active')}</Badge> : <><Badge tone="muted">{t('sess_ended')}</Badge><div className="sub">{t(tk('sess_reason_', r.endReason ?? 'unknown'))}{r.endedAt ? ` · ${formatDateTime(r.endedAt)}` : ''}</div></>,
          },
          {
            header: '',
            align: 'right',
            render: (r) =>
              canEdit && r.status === 'active' && r.key !== current ? (
                <Button
                  size="small"
                  danger
                  onClick={async () => {
                    await securityApi.terminateSession(r.key);
                    toast(t('sess_terminated_toast'));
                  }}
                >
                  {t('sess_terminate')}
                </Button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}
