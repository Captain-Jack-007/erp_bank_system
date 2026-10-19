// Центр уведомлений: список, отметка прочтения, настройки каналов, демо-почта, ручной запуск сканера сроков.
import { useEffect, useState } from 'react';
import { NOTIFICATION_KINDS, approvalsApi, formatDateTime, notificationsApi, renderNotificationText, tk, type NotificationKind, type NotificationPrefs } from '@xb/shared';
import { Button, Card, Empty, Loading, PageHeader, Switch, Tabs, useToast } from '../../components/ui';
import { NotificationItem, resolveFlowLink } from '../../components/flow';
import { fmt } from '../../components/flowLabels';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { Link } from '../../lib/router';

type View = 'all' | 'unread';

function Prefs() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const saved = useApi(() => notificationsApi.getPrefs(user), [user.id]);
  const [draft, setDraft] = useState<NotificationPrefs | null>(null);
  useEffect(() => {
    if (saved.data) setDraft(saved.data);
  }, [saved.data]);
  if (!draft) return <Loading />;
  const set = (ch: 'inApp' | 'email', k: NotificationKind, v: boolean) => setDraft({ ...draft, [ch]: { ...draft[ch], [k]: v } });
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('flow_prefs')}</th>
              <th style={{ width: 110 }}>{t('flow_channel_inapp')}</th>
              <th style={{ width: 110 }}>{t('flow_channel_email')}</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_KINDS.map((k) => (
              <tr key={k}>
                <td>{t(tk('flow_nk_', k))}</td>
                <td>
                  <Switch checked={draft.inApp[k]} onChange={(v) => set('inApp', k, v)} ariaLabel={`${t(tk('flow_nk_', k))}: ${t('flow_channel_inapp')}`} />
                </td>
                <td>
                  <Switch checked={draft.email[k]} onChange={(v) => set('email', k, v)} ariaLabel={`${t(tk('flow_nk_', k))}: ${t('flow_channel_email')}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ padding: 14, justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          onClick={async () => {
            await notificationsApi.savePrefs(user, { inApp: draft.inApp, email: draft.email });
            toast(t('flow_prefs_saved'));
          }}
        >
          {t('save')}
        </Button>
      </div>
    </>
  );
}

export function NotificationsPage() {
  const { t, lang } = useSession();
  const user = useUser();
  const toast = useToast();
  const [view, setView] = useState<View>('all');
  const list = useApi(() => notificationsApi.list(user), [user.id]);
  const outbox = useApi(() => notificationsApi.listOutbox(user), [user.id]);
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read).length;
  const shown = view === 'unread' ? items.filter((n) => !n.read) : items;
  const isAdmin = user.role === 'admin' || !!user.extraRoles?.includes('admin');

  return (
    <>
      <PageHeader
        title={t('flow_notif_title')}
        subtitle={t('flow_notif_subtitle')}
        actions={
          <>
            {isAdmin && (
              <Button
                icon="clock"
                onClick={async () => {
                  const r = await approvalsApi.scanDeadlines();
                  toast(fmt(t('flow_scan_result'), { w: r.warned, e: r.escalated }));
                }}
              >
                {t('flow_check_deadlines')}
              </Button>
            )}
            <Button icon="check" disabled={!unread} onClick={() => notificationsApi.markAllRead(user)}>
              {t('flow_mark_all')}
            </Button>
          </>
        }
      />
      <div className="grid grid-main">
        <Card flush>
          <Tabs<View>
            value={view}
            onChange={setView}
            items={[
              { value: 'all', label: t('all'), count: items.length },
              { value: 'unread', label: t('flow_unread'), count: unread },
            ]}
          />
          {list.loading && !list.data ? <Loading /> : shown.length ? shown.map((n) => <NotificationItem key={n.id} n={n} />) : <Empty text={t('flow_notif_empty')} icon="bell" />}
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <Card title={t('flow_prefs')} flush>
            <Prefs />
          </Card>
          <Card title={t('flow_outbox')} flush>
            {outbox.data?.length ? (
              <ul className="flow-outbox">
                {outbox.data.slice(0, 12).map((m) => {
                  const link = resolveFlowLink(m.link);
                  return (
                    <li key={m.id}>
                      <div className="small muted">
                        {m.to} · {formatDateTime(m.at)}
                      </div>
                      <div>{link ? <Link to={link}>{renderNotificationText(m.subject, lang)}</Link> : renderNotificationText(m.subject, lang)}</div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty text={t('flow_outbox_empty')} icon="inbox" />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
