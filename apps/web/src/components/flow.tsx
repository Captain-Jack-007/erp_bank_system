// Компоненты движка согласований и уведомлений (P1-FLOW): переключатель, ход маршрута, колокольчик.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ApprovalError, errorText,
  approvalsApi,
  formatDateTime,
  notificationsApi,
  renderNotificationText,
  tk,
  type AppNotification,
  type ApprovalEntity,
  type RouteEvent,
  type TKey,
  type User,
} from '@xb/shared';
import { Badge, Button, Drawer, Empty, Field, Loading, RouteSteps, Textarea, useToast } from './ui';
import { Icon } from './icons';
import { fmt, stepNames, stepTitle } from './flowLabels';
import { useSession, useUser } from '../lib/session';
import { useApi, useLookups } from '../lib/useApi';
import { Link, navigate } from '../lib/router';
import { APPROVAL_LINKS } from '../lib/approvalLinks';

/** Сегментированный переключатель режимов (как antd Segmented). Не использует класс .tab. */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`seg-item ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
          {!!o.count && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Текст ошибки движка на языке интерфейса. */
export function useFlowError(): (e: unknown) => string {
  const { t, lang } = useSession();
  // P4-SEC (PR-TEC-008): коды ошибок API — по словарю, технический текст не показывается
  return (e) => (e instanceof ApprovalError ? t(tk('flow_err_', e.code)) : errorText(lang, e));
}

/** Ссылка из уведомления: /approvals?entity=x&doc=id → карточка документа. */
export function resolveFlowLink(link: string | undefined): string | undefined {
  if (!link) return undefined;
  const m = link.match(/^\/approvals\?(.*)$/);
  if (!m) return link;
  const q = new URLSearchParams(m[1]);
  const entity = q.get('entity') as ApprovalEntity | null;
  const doc = q.get('doc');
  if (entity && doc && APPROVAL_LINKS[entity]) return APPROVAL_LINKS[entity](doc);
  return link;
}

const EV_TONE: Partial<Record<RouteEvent['action'], 'ok' | 'danger' | 'warn' | 'info' | 'muted'>> = {
  approved: 'ok',
  rejected: 'danger',
  returned: 'warn',
  escalated: 'danger',
  info_requested: 'info',
  submitted: 'muted',
  resubmitted: 'muted',
  commented: 'muted',
};

/** Подробный ход согласования документа: шаги, решения (кто/когда/за кого), события, комментарий. */
export function RouteDrawer({ entityId, taskId, open, onClose, title }: { entityId: string; taskId?: string; open: boolean; onClose: () => void; title: ReactNode }) {
  const { t, lang } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const errText = useFlowError();
  const route = useApi(() => (open ? approvalsApi.getRoute(entityId) : Promise.resolve(undefined)), [entityId, open]);
  const check = useApi(() => (open && taskId ? approvalsApi.check(taskId, user) : Promise.resolve(undefined)), [taskId, open, user.id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const r = route.data;
  const name = (id?: string) => (!id ? '' : id === 'system' ? t('flow_system_actor') : (lk.user(id)?.fullName ?? id));

  async function run(kind: 'comment' | 'info') {
    if (!text.trim()) return setErr(t('flow_err_reason_required'));
    setBusy(true);
    try {
      if (kind === 'comment') await approvalsApi.comment(entityId, user, text);
      else await approvalsApi.requestInfo(taskId!, user, text);
      toast(t(kind === 'comment' ? 'flow_comment_added' : 'flow_info_sent'));
      setText('');
      setErr('');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={title} width={560}>
      {!r ? (
        route.loading ? <Loading /> : <Empty text={t('empty')} />
      ) : (
        <>
          <div className="flow-route-head">
            {r.templateName && (
              <span className="small muted">
                {t('flow_template')}: <b>{r.templateName[lang === 'uzc' ? 'uz' : lang === 'en' ? 'en' : lang] ?? r.templateName.ru}</b>
              </span>
            )}
            <span className="small muted">{fmt(t('flow_cycle'), { n: r.cycle })}</span>
            <Badge tone={r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'danger' : r.status === 'returned' ? 'warn' : 'info'}>{t(tk('flow_inst_', r.status))}</Badge>
          </div>
          <ol className="flow-steps">
            {r.steps.map((s) => (
              <li key={s.index} className={`flow-step ${s.state}`}>
                <span className="flow-step-dot">{s.state === 'done' ? '✓' : s.index}</span>
                <div className="flow-step-body">
                  <div className="flow-step-title">
                    {stepTitle(s, t, lang)}
                    <Badge tone={s.state === 'done' ? 'ok' : s.state === 'current' ? 'info' : s.state === 'pending' ? 'muted' : 'danger'}>{t(tk('flow_state_', s.state))}</Badge>
                    {s.overdue && <Badge tone="danger">{t('overdue')}</Badge>}
                    {!!s.escalatedTo?.length && <Badge tone="warn">{t('flow_escalated')}</Badge>}
                  </div>
                  <div className="small muted">
                    {stepNames(s)}
                    {s.approvers.length > 1 && ` · ${t('flow_parallel')}: ${t(s.mode === 'any' ? 'flow_mode_any' : 'flow_mode_all')}`}
                    {` · ${fmt(t('flow_sla_h'), { h: s.slaHours })}`}
                    {s.state === 'current' && s.dueAt && ` · ${t('flow_due')}: ${formatDateTime(s.dueAt)}`}
                  </div>
                  {!!s.escalatedTo?.length && <div className="small muted">{t('flow_ev_escalated')}: {s.escalatedTo.map(name).join(', ')}</div>}
                  {s.decisions.map((d, i) => (
                    <div key={i} className="flow-decision">
                      <Badge tone={d.decision === 'approved' ? 'ok' : d.decision === 'rejected' ? 'danger' : 'warn'}>{t(tk('flow_ev_', d.decision))}</Badge>
                      <span>
                        {name(d.userId)}
                        {d.onBehalfOf && ` (${fmt(t('flow_on_behalf'), { name: name(d.onBehalfOf) })})`}
                      </span>
                      <span className="muted small">{formatDateTime(d.at)}</span>
                      {d.comment && <div className="note">{d.comment}</div>}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <div>
            <div className="flow-section-title">{t('flow_events')}</div>
            <ul className="flow-events">
              {[...r.events].reverse().map((e) => (
                <li key={e.id}>
                  <Badge tone={EV_TONE[e.action] ?? 'muted'}>{t(tk('flow_ev_', e.action))}</Badge>
                  <span>
                    {name(e.actorId)}
                    {e.onBehalfOf && ` (${fmt(t('flow_on_behalf'), { name: name(e.onBehalfOf) })})`}
                    {e.targetIds?.length ? ` → ${e.targetIds.map(name).join(', ')}` : ''}
                  </span>
                  <span className="muted small">
                    {formatDateTime(e.at)}
                    {e.step ? ` · ${fmt(t('flow_step_n'), { n: e.step })}` : ''}
                    {e.cycle > 1 ? ` · ${fmt(t('flow_cycle'), { n: e.cycle })}` : ''}
                  </span>
                  {e.comment && <div className="note">{e.comment}</div>}
                </li>
              ))}
            </ul>
          </div>
          <Field label={t('flow_comment')} error={err}>
            <Textarea value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} rows={3} ariaLabel={t('flow_comment')} />
          </Field>
          <div className="toolbar">
            <Button disabled={busy} onClick={() => run('comment')} icon="file">{t('flow_add_comment')}</Button>
            {check.data?.canAct && <Button disabled={busy} onClick={() => run('info')} icon="alert">{t('flow_request_info')}</Button>}
          </div>
        </>
      )}
    </Drawer>
  );
}

const LEVEL_TONE = { info: 'info', success: 'ok', warning: 'warn', danger: 'danger' } as const;

/** Одна строка уведомления (колокольчик и страница). */
export function NotificationItem({ n, onOpen, compact }: { n: AppNotification; onOpen?: () => void; compact?: boolean }) {
  const { t, lang } = useSession();
  const user = useUser();
  const link = resolveFlowLink(n.link);
  return (
    <div className={`notif ${n.read ? '' : 'unread'} ${compact ? 'compact' : ''}`}>
      <span className={`notif-dot ${LEVEL_TONE[n.level]}`} />
      <div className="notif-body">
        <div className="notif-title">{renderNotificationText(n.title, lang)}</div>
        {n.body && <div className="notif-text">{renderNotificationText(n.body, lang)}</div>}
        <div className="notif-meta">
          <Badge tone={LEVEL_TONE[n.level]}>{t(tk('flow_nk_', n.kind))}</Badge>
          <span>{formatDateTime(n.createdAt)}</span>
          {link && (
            <Link
              to={link}
              onClick={() => {
                if (!n.read) void notificationsApi.markRead(n.id, user);
                onOpen?.();
              }}
            >
              {t('open')}
            </Link>
          )}
          {!n.read && !compact && (
            <Button type="link" size="small" onClick={() => notificationsApi.markRead(n.id, user)}>
              {t('flow_mark_read')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Колокольчик в шапке: счётчик непрочитанных и последние уведомления. Здесь же — сканер сроков (раз в минуту). */
export function NotificationBell({ user }: { user: User }) {
  const { t } = useSession();
  const list = useApi(() => notificationsApi.list(user), [user.id]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read).length;

  // Сканер сроков SLA: при загрузке приложения и каждую минуту.
  useEffect(() => {
    void approvalsApi.scanDeadlines();
    const id = window.setInterval(() => void approvalsApi.scanDeadlines(), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="bell" ref={ref}>
      <button className="btn btn-ghost bell-btn" onClick={() => setOpen((v) => !v)} title={t('flow_bell')} aria-label={t('flow_bell')} aria-expanded={open}>
        <Icon name="bell" />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label={t('flow_bell')}>
          <div className="bell-head">
            <b>{t('flow_bell')}</b>
            {unread > 0 && (
              <Button type="link" size="small" onClick={() => notificationsApi.markAllRead(user)}>
                {t('flow_mark_all')}
              </Button>
            )}
          </div>
          <div className="bell-list">
            {items.length ? items.slice(0, 6).map((n) => <NotificationItem key={n.id} n={n} compact onOpen={() => setOpen(false)} />) : <Empty text={t('flow_notif_empty')} icon="bell" />}
          </div>
          <div className="bell-foot">
            <Button type="link" size="small" onClick={() => { setOpen(false); navigate('/notifications'); }}>
              {t('flow_bell_all')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export const flowT = (t: (k: TKey) => string, key: string, params: Record<string, string | number>) => fmt(t(key as TKey), params);
