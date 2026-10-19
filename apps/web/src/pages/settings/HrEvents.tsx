// P3-GEN (ТЗ PR-SEC-002, PR-SEC-056): кадровые события из HR-источника (Laborlaw) автоматически создают,
// изменяют, временно ограничивают или блокируют учётные записи. Получение — через интеграционную шину.
import { formatDate, formatDateTime, hrSyncApi, tk, type HrEvent } from '@xb/shared';
import { Badge, Button, Card, DataTable, Stat, useToast } from '../../components/ui';
import { Link } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useState } from 'react';

const KIND_TONE: Record<HrEvent['kind'], 'ok' | 'info' | 'warn' | 'danger' | 'muted'> = { hire: 'ok', transfer: 'info', leave: 'warn', return: 'ok', dismissal: 'danger' };

export function HrEventsTab() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const canEdit = useCan()('users', 'edit');
  const list = useApi(() => hrSyncApi.list());
  const [busy, setBusy] = useState(false);
  const rows = list.data ?? [];
  const pending = hrSyncApi.pendingCount();
  const role = (r: string) => t(tk('role_', r));
  const outcome = (e: HrEvent) => {
    const o = e.outcome;
    if (!o) return e.result;
    if (o.kind === 'created') return `${t('hr_out_created')}: ${o.login} · ${role(o.toRole!)}`;
    if (o.kind === 'changed') return `${(o.fromRoles ?? []).map(role).join(', ')} → ${role(o.toRole!)}`;
    if (o.kind === 'suspended') return `${t('hr_suspended_until')} ${formatDate(o.until!)}`;
    return o.kind === 'restored' ? t('hr_out_restored') : t('hr_out_deactivated');
  };

  async function sync() {
    setBusy(true);
    try {
      const r = await hrSyncApi.sync(user.id);
      toast(r.received ? `${t('hr_synced')}: ${r.received} · ${t('hr_applied')}: ${r.applied} · ${t('hr_errors')}: ${r.errors}` : t('hr_nothing'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid grid-4">
        <Stat label={t('hr_received')} value={rows.length} icon="inbox" />
        <Stat label={t('hr_applied')} value={rows.filter((e) => e.status === 'applied').length} tone="accent" icon="check" />
        <Stat label={t('hr_errors')} value={rows.filter((e) => e.status === 'error').length} tone={rows.some((e) => e.status === 'error') ? 'alert' : undefined} icon="alert" />
        <Stat label={t('hr_waiting')} value={pending} foot="Laborlaw (HR)" icon="clock" />
      </div>
      <Card
        title={t('hr_title')}
        flush
        actions={canEdit && <Button type="primary" icon="refresh" loading={busy} onClick={sync} className="hr-sync-btn">{t('hr_sync')}</Button>}
      >
        <p className="muted small" style={{ padding: '10px 14px 0', margin: 0 }}>{t('hr_hint')}</p>
        <DataTable
          rows={list.data ? rows : undefined}
          loading={list.loading}
          rowKey={(e) => e.id}
          emptyText={t('hr_empty')}
          columns={[
            { header: t('hr_event'), render: (e) => <><Badge tone={KIND_TONE[e.kind]}>{t(tk('hr_kind_', e.kind))}</Badge><div className="sub num">{e.employeeNo} · {formatDate(e.effectiveDate)}</div></> },
            { header: t('usr_name'), render: (e) => <><div style={{ fontWeight: 600 }}>{e.userId ? <Link to={`/settings/users?u=${e.userId}`}>{e.fullName}</Link> : e.fullName}</div>{e.kind === 'leave' && <div className="sub">{formatDate(e.from!)} — {formatDate(e.to!)}</div>}</> },
            {
              header: t('status'),
              render: (e) =>
                e.status === 'applied' ? (
                  <><Badge tone="ok">{t('hr_status_applied')}</Badge><div className="sub hr-result">{outcome(e)}</div></>
                ) : (
                  <><Badge tone="danger">{t('hr_status_error')}</Badge><div className="sub hr-error">{e.error}</div></>
                ),
            },
            { header: t('hr_received_at'), render: (e) => <span className="num small">{formatDateTime(e.receivedAt)}</span> },
            {
              header: '',
              align: 'right',
              render: (e) =>
                canEdit && e.status === 'error' ? (
                  <Button
                    size="small"
                    onClick={async () => {
                      const r = await hrSyncApi.retry(e.id);
                      toast(r.status === 'applied' ? t('hr_status_applied') : `${t('hr_status_error')}: ${r.error}`);
                    }}
                  >
                    {t('hr_retry')}
                  </Button>
                ) : canEdit && e.kind === 'leave' && e.status === 'applied' && e.userId ? (
                  <Button size="small" type="link" onClick={() => (hrSyncApi.queueReturn(e.userId!), toast(t('hr_return_queued')))}>
                    {t('hr_queue_return')}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
    </>
  );
}
