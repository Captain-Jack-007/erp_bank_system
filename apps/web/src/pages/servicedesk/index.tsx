// P4-GEN (ТЗ PR-GEN-060): обращения в Service Desk из приложения. Заявка создаётся в Service Desk банка через
// integrationHub (система 'servicedesk'); при недоступности — очередь и доставка после восстановления.
// Статусы синхронизируются (кнопка и фоновый таймер), изменения приходят уведомлением.
import { useState } from 'react';
import {
  formatDateTime, registerModuleAccess, ROLES, SD_CATEGORIES, SD_PRIORITIES, SD_TYPES, serviceDeskApi, tk, MaintenanceError,
  type AccessLevel, type SdCategory, type SdInput, type SdPriority, type SdStatus, type SdTicket, type SdTicketType, type TKey,
} from '@xb/shared';
import { Badge, Button, Card, DataTable, Drawer, Empty, Field, FilterBar, Input, Modal, PageHeader, Select, Stat, Switch, Textarea, useToast, type Tone } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { navigate, useQuery } from '../../lib/router';
import type { ModuleRoute } from '../../lib/routes';
import { MODULES } from '../../modules';
import '../../p4gen.css';

// Обращаться в Service Desk может каждый; техподдержка и администратор видят все обращения.
registerModuleAccess('service-desk', { ...Object.fromEntries(ROLES.map((r) => [r, 'edit' as AccessLevel])), support: 'admin', auditor: 'view' });

const STATUS_TONE: Record<SdStatus, Tone> = { queued: 'warn', new: 'info', in_progress: 'info', resolved: 'ok', closed: 'muted' };
const PRIORITY_TONE: Record<SdPriority, Tone> = { low: 'muted', medium: 'info', high: 'warn', critical: 'danger' };

function TicketDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const tk0 = useApi(() => serviceDeskApi.get(id), [id]);
  const [busy, setBusy] = useState(false);
  const x = tk0.data;
  const mod = x?.moduleId ? MODULES.find((m) => m.id === x.moduleId) : undefined;
  return (
    <Drawer
      open
      title={x ? `${x.externalId ?? x.number} · ${x.title}` : '…'}
      onClose={onClose}
      footer={
        <>
          {x?.status === 'resolved' && x.createdBy === user.id && (
            <Button
              type="primary"
              icon="check"
              loading={busy}
              className="sd-confirm"
              onClick={async () => {
                setBusy(true);
                try {
                  await serviceDeskApi.confirm(x.id, user.id);
                  toast(t('p4g_sd_closed'));
                } catch {
                  toast(t('p4g_sd_unavailable'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('p4g_sd_confirm')}
            </Button>
          )}
          <Button onClick={onClose}>{t('svc_close')}</Button>
        </>
      }
    >
      {!x ? null : (
        <div data-testid="sd-ticket" data-status={x.status}>
          <div className="svc-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={STATUS_TONE[x.status]}>{t(tk('p4g_sd_status_', x.status))}</Badge>
            <Badge tone={PRIORITY_TONE[x.priority]}>{t(tk('p4g_sd_priority_', x.priority))}</Badge>
            <Badge tone="muted">{t(tk('p4g_sd_type_', x.type))}</Badge>
          </div>
          <dl className="svc-kv">
            <dt>{t('p4g_sd_number')}</dt>
            <dd className="svc-mono">{x.number}</dd>
            <dt>{t('p4g_sd_external')}</dt>
            <dd className="svc-mono sd-external">{x.externalId ?? t('p4g_sd_notDelivered')}</dd>
            <dt>{t('p4g_sd_category')}</dt>
            <dd>{t(tk('p4g_sd_cat_', x.category))}</dd>
            {mod && (
              <>
                <dt>{t('p4g_sd_module')}</dt>
                <dd>{typeof mod.name === 'string' ? t(mod.name) : loc(mod.name)}</dd>
              </>
            )}
            <dt>{t('p4g_sd_assignee')}</dt>
            <dd>{x.assignee || '—'}</dd>
            <dt>{t('p4g_sd_lastSync')}</dt>
            <dd>{x.lastSyncAt ? formatDateTime(x.lastSyncAt) : '—'}</dd>
            {x.resolution && (
              <>
                <dt>{t('p4g_sd_resolution')}</dt>
                <dd>{x.resolution}</dd>
              </>
            )}
          </dl>
          <Field label={t('p4g_sd_description')}>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{x.description}</p>
          </Field>
          <Field label={t('p4g_sd_history')}>
            <ul className="svc-attempts">
              {x.history.map((h, i) => (
                <li key={i}>
                  <Badge tone={STATUS_TONE[h.status]}>{t(tk('p4g_sd_status_', h.status))}</Badge>
                  <span className="num small">{formatDateTime(h.at)}</span>
                  {h.comment && <span className="muted small">{h.comment}</span>}
                </li>
              ))}
            </ul>
          </Field>
          <Button size="small" type="link" onClick={() => navigate(`/integrations?tab=log`)}>
            {t('p4g_sd_exchange')}: {x.exchangeId}
          </Button>
        </div>
      )}
    </Drawer>
  );
}

function NewTicketModal({ moduleId, onClose, onCreated }: { moduleId?: string; onClose: () => void; onCreated: (t: SdTicket) => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const [v, setV] = useState<SdInput>({ type: 'incident', category: 'error', priority: 'medium', title: '', description: '', ...(moduleId ? { moduleId } : {}) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SdInput>(k: K, val: SdInput[K]) => setV((p) => ({ ...p, [k]: val }));
  return (
    <Modal
      title={t('p4g_sd_new')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            icon="lifebuoy"
            loading={busy}
            className="sd-send"
            onClick={async () => {
              setBusy(true);
              try {
                const tk1 = await serviceDeskApi.create(v, user.id);
                toast(tk1.externalId ? `${t('p4g_sd_created')}: ${tk1.externalId}` : t('p4g_sd_queuedMsg'));
                onCreated(tk1);
              } catch (e) {
                if (e instanceof MaintenanceError) setErrors(e.issues);
                else toast(t('actionFailed'));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('p4g_sd_send')}
          </Button>
        </>
      }
    >
      <div className="grid grid-2">
        <Field label={t('p4g_sd_type')}>
          <Select<SdTicketType> value={v.type} onChange={(x) => set('type', x)} ariaLabel={t('p4g_sd_type')} options={SD_TYPES.map((x) => ({ value: x, label: t(tk('p4g_sd_type_', x)) }))} />
        </Field>
        <Field label={t('p4g_sd_priority')}>
          <Select<SdPriority> value={v.priority} onChange={(x) => set('priority', x)} ariaLabel={t('p4g_sd_priority')} options={SD_PRIORITIES.map((x) => ({ value: x, label: t(tk('p4g_sd_priority_', x)) }))} />
        </Field>
        <Field label={t('p4g_sd_category')}>
          <Select<SdCategory> value={v.category} onChange={(x) => set('category', x)} ariaLabel={t('p4g_sd_category')} options={SD_CATEGORIES.map((x) => ({ value: x, label: t(tk('p4g_sd_cat_', x)) }))} />
        </Field>
        <Field label={t('p4g_sd_module')}>
          <Select
            value={v.moduleId ?? ''}
            onChange={(x) => set('moduleId', x || undefined)}
            ariaLabel={t('p4g_sd_module')}
            options={[{ value: '', label: '—' }, ...MODULES.map((m) => ({ value: m.id, label: typeof m.name === 'string' ? t(m.name) : loc(m.name) }))]}
          />
        </Field>
      </div>
      <Field label={t('p4g_sd_subject')} required error={errors.title ? t(errors.title as TKey) : undefined}>
        <Input name="sd-title" value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={120} ariaLabel={t('p4g_sd_subject')} />
      </Field>
      <Field label={t('p4g_sd_description')} required error={errors.description ? t(errors.description as TKey) : undefined}>
        <Textarea value={v.description} onChange={(e) => set('description', e.target.value)} rows={4} maxLength={2000} ariaLabel={t('p4g_sd_description')} />
      </Field>
      <p className="small muted" style={{ margin: 0 }}>{t('p4g_sd_hint')}</p>
    </Modal>
  );
}

function ServiceDeskPage() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const q = useQuery();
  const isAdmin = useCan()('service-desk', 'admin');
  const [all, setAll] = useState(false);
  const [status, setStatus] = useState<SdStatus | ''>('');
  const [open, setOpen] = useState<string | null>(q.get('id'));
  const [creating, setCreating] = useState(q.get('new') === '1');
  const [busy, setBusy] = useState(false);
  const filter = { userId: user.id, all: isAdmin && all };
  const list = useApi(() => serviceDeskApi.list(filter), [user.id, filter.all]);
  const rows = (list.data ?? []).filter((x) => !status || x.status === status);
  const data = list.data ?? [];
  return (
    <>
      <PageHeader
        title={t('p4g_sd_title')}
        subtitle={`${t('tzLabel')} PR-GEN-060 · ${t('p4g_sd_subtitle')}`}
        actions={
          <>
            <Button
              icon="refresh"
              loading={busy}
              className="sd-sync"
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await serviceDeskApi.sync(filter);
                  toast(`${t('p4g_sd_synced')}: ${r.changed} / ${r.checked}`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('p4g_sd_sync')}
            </Button>
            <Button type="primary" icon="plus" onClick={() => setCreating(true)} className="sd-new">
              {t('p4g_sd_new')}
            </Button>
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={t('p4g_sd_kpiOpen')} value={data.filter((x) => x.status !== 'closed' && x.status !== 'resolved').length} icon="lifebuoy" />
        <Stat label={t('p4g_sd_kpiQueued')} value={data.filter((x) => x.status === 'queued').length} icon="clock" tone={data.some((x) => x.status === 'queued') ? 'alert' : undefined} />
        <Stat label={t('p4g_sd_kpiResolved')} value={data.filter((x) => x.status === 'resolved').length} icon="check" tone="accent" />
        <Stat label={t('p4g_sd_kpiTotal')} value={data.length} icon="inbox" />
      </div>
      <Card flush>
        <FilterBar>
          <Select<SdStatus | ''>
            value={status}
            onChange={setStatus}
            ariaLabel={t('p4g_sd_status')}
            options={[{ value: '', label: `${t('p4g_sd_status')}: ${t('svc_intAll')}` }, ...(['queued', 'new', 'in_progress', 'resolved', 'closed'] as SdStatus[]).map((s) => ({ value: s, label: t(tk('p4g_sd_status_', s)) }))]}
          />
          {isAdmin && (
            <label className="svc-row small" style={{ gap: 8 }}>
              <Switch checked={all} onChange={setAll} ariaLabel={t('p4g_sd_all')} />
              {t('p4g_sd_all')}
            </label>
          )}
        </FilterBar>
        {list.data && !rows.length ? (
          <Empty text={t('p4g_sd_empty')} icon="lifebuoy" />
        ) : (
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(x) => x.id}
            onRowClick={(x) => setOpen(x.id)}
            columns={[
              { header: t('p4g_sd_external'), render: (x) => <span className="svc-mono" data-testid="sd-row" data-id={x.id} data-status={x.status}>{x.externalId ?? x.number}</span> },
              { header: t('p4g_sd_subject'), render: (x) => <><div>{x.title}</div><div className="sub">{t(tk('p4g_sd_type_', x.type))} · {t(tk('p4g_sd_cat_', x.category))}</div></> },
              { header: t('p4g_sd_priority'), render: (x) => <Badge tone={PRIORITY_TONE[x.priority]}>{t(tk('p4g_sd_priority_', x.priority))}</Badge> },
              { header: t('p4g_sd_status'), render: (x) => <Badge tone={STATUS_TONE[x.status]}>{t(tk('p4g_sd_status_', x.status))}</Badge> },
              { header: t('p4g_sd_updated'), render: (x) => <span className="num small">{formatDateTime(x.updatedAt)}</span> },
            ]}
          />
        )}
      </Card>
      {creating && (
        <NewTicketModal
          moduleId={q.get('m') ?? undefined}
          onClose={() => {
            setCreating(false);
            if (q.get('new')) window.history.replaceState(null, '', '#/service-desk');
          }}
          onCreated={(x) => {
            setCreating(false);
            if (q.get('new')) window.history.replaceState(null, '', '#/service-desk');
            setOpen(x.id);
          }}
        />
      )}
      {open && <TicketDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export const routes: ModuleRoute[] = [{ path: '/service-desk', render: () => <ServiceDeskPage /> }];
