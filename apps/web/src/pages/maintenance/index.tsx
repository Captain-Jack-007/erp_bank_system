// P4-GEN (ТЗ PR-GEN-059/060): регламентные технологические окна и аварийный режим.
// Окно создаётся не позднее чем за 5 рабочих дней до начала и согласуется через approvalEngine
// ('maintenance_window'); после согласования — уведомления и баннер всем пользователям.
// Аварийный режим (только чтение) включает администратор с подтверждением кодом 2FA.
import { useState } from 'react';
import {
  earliestMaintenanceDate, formatDate, formatDateTime, MAINTENANCE_IMPACTS, maintenanceApi, maintenancePhase, MaintenanceError, MIN_WORKING_DAYS,
  registerModuleAccess, tk, workingDaysBetween, type MaintenanceImpact, type MaintenanceInput, type MaintenanceWindow, type TKey,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Drawer, Empty, Field, Input, Modal, PageHeader, RouteSteps, Select, Stat, Switch, Tabs, Textarea, Timeline, useToast, type Tone } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useCan, useStepUp } from '../../lib/access';
import { useQuery } from '../../lib/router';
import type { ModuleRoute } from '../../lib/routes';
import '../../p4gen.css';

// Администратор — планирование и аварийный режим; техподдержка, аудитор и руководители (согласующие) — просмотр.
registerModuleAccess('maintenance', { support: 'view', auditor: 'view', dept_head: 'view' }); // руководитель — согласующий окна

type Tab = 'windows' | 'emergency';
const STATUS_TONE: Record<string, Tone> = { pending: 'warn', approved: 'ok', rejected: 'danger', returned: 'warn', cancelled: 'muted', scheduled: 'info', in_progress: 'danger', completed: 'muted' };

/** Статус для показа: у согласованного окна — фаза по времени. */
function shownStatus(w: MaintenanceWindow): string {
  return maintenancePhase(w) ?? w.status;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function WindowForm({ initial, onClose }: { initial?: MaintenanceWindow; onClose: () => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const earliest = earliestMaintenanceDate();
  const [v, setV] = useState<MaintenanceInput>(() =>
    initial
      ? { id: initial.id, title: initial.title, description: initial.description, start: toLocalInput(initial.start), end: toLocalInput(initial.end), systems: initial.systems, impact: initial.impact }
      : { title: '', description: '', start: `${earliest}T22:00`, end: `${earliest}T23:59`, systems: ['erp'], impact: 'readonly' },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const comps = maintenanceApi.components();
  const days = v.start && !Number.isNaN(new Date(v.start).getTime()) ? workingDaysBetween(new Date(), new Date(v.start)) : 0;
  const err = (k: string) => (errors[k] ? t(errors[k] as TKey).replace('{n}', String(MIN_WORKING_DAYS)) : undefined);
  return (
    <Modal
      title={initial ? t('p4g_mw_resubmit') : t('p4g_mw_new')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            icon="check"
            loading={busy}
            className="mw-submit"
            onClick={async () => {
              setBusy(true);
              try {
                const w = await maintenanceApi.submit(v, user.id);
                toast(`${w.number}: ${t('p4g_mw_submitted')}`);
                onClose();
              } catch (e) {
                if (e instanceof MaintenanceError) setErrors(e.issues);
                else toast(t('actionFailed'));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('submitForApproval')}
          </Button>
        </>
      }
    >
      <div className="banner info small mw-earliest">
        {t('p4g_mw_leadHint').replace('{n}', String(MIN_WORKING_DAYS))}: <b>{formatDate(earliest)}</b>
      </div>
      <Field label={t('p4g_mw_subject')} required error={err('title')}>
        <Input name="mw-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={120} ariaLabel={t('p4g_mw_subject')} />
      </Field>
      <div className="grid grid-2">
        <Field label={t('p4g_mw_start')} required error={err('start')} hint={`${t('p4g_mw_daysAhead')}: ${days}`}>
          <Input name="mw-start" type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} ariaLabel={t('p4g_mw_start')} />
        </Field>
        <Field label={t('p4g_mw_end')} required error={err('end')}>
          <Input name="mw-end" type="datetime-local" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} ariaLabel={t('p4g_mw_end')} />
        </Field>
      </div>
      <Field label={t('p4g_mw_impact')}>
        <Select<MaintenanceImpact> value={v.impact} onChange={(x) => setV({ ...v, impact: x })} ariaLabel={t('p4g_mw_impact')} options={MAINTENANCE_IMPACTS.map((x) => ({ value: x, label: t(tk('p4g_mw_impact_', x)) }))} />
      </Field>
      <Field label={t('p4g_mw_systems')} required error={err('systems')}>
        <div className="p4-checks">
          {comps.map((c) => (
            <Checkbox key={c.id} checked={v.systems.includes(c.id)} onChange={(on) => setV({ ...v, systems: on ? [...v.systems, c.id] : v.systems.filter((x) => x !== c.id) })}>
              {loc(c.name)}
            </Checkbox>
          ))}
        </div>
      </Field>
      <Field label={t('p4g_mw_description')}>
        <Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} rows={3} ariaLabel={t('p4g_mw_description')} />
      </Field>
      <Field label={t('p4g_mw_route')}>
        <RouteSteps preview={{ entity: 'maintenance_window', context: { subtype: v.impact } }} />
      </Field>
    </Modal>
  );
}

function WindowDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (w: MaintenanceWindow) => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const canAdmin = useCan()('maintenance', 'admin');
  const w = useApi(() => maintenanceApi.get(id), [id]).data;
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const comps = maintenanceApi.components();
  const st = w ? shownStatus(w) : '';
  return (
    <Drawer
      open
      title={w ? `${w.number} · ${w.title}` : '…'}
      onClose={onClose}
      footer={
        <>
          {w && canAdmin && (w.status === 'returned' || w.status === 'rejected') && (
            <Button type="primary" icon="pen" onClick={() => onEdit(w)}>
              {t('p4g_mw_resubmit')}
            </Button>
          )}
          {w && canAdmin && (w.status === 'pending' || (w.status === 'approved' && st !== 'completed')) && (
            <Button danger onClick={() => setCancel(true)}>
              {t('p4g_mw_cancel')}
            </Button>
          )}
          <Button onClick={onClose}>{t('svc_close')}</Button>
        </>
      }
    >
      {w && (
        <div data-testid="mw-drawer" data-status={st}>
          <Badge tone={STATUS_TONE[st] ?? 'muted'}>{t(tk('p4g_mw_status_', st))}</Badge>
          <dl className="svc-kv">
            <dt>{t('p4g_mw_period')}</dt>
            <dd>
              {formatDateTime(w.start)} — {formatDateTime(w.end)}
            </dd>
            <dt>{t('p4g_mw_impact')}</dt>
            <dd>{t(tk('p4g_mw_impact_', w.impact))}</dd>
            <dt>{t('p4g_mw_systems')}</dt>
            <dd>{w.systems.map((s) => (comps.find((c) => c.id === s) ? loc(comps.find((c) => c.id === s)!.name) : s)).join(', ')}</dd>
            <dt>{t('p4g_mw_daysAhead')}</dt>
            <dd>{w.workingDaysAhead}</dd>
            {w.description && (
              <>
                <dt>{t('p4g_mw_description')}</dt>
                <dd>{w.description}</dd>
              </>
            )}
          </dl>
          <Field label={t('p4g_mw_route')}>
            <RouteSteps entityId={w.id} />
          </Field>
          <Field label={t('p4g_sd_history')}>
            <Timeline events={w.history} />
          </Field>
        </div>
      )}
      {cancel && w && (
        <Modal
          title={t('p4g_mw_cancel')}
          onClose={() => setCancel(false)}
          footer={
            <>
              <Button onClick={() => setCancel(false)}>{t('cancel')}</Button>
              <Button
                danger
                disabled={!reason.trim()}
                onClick={async () => {
                  await maintenanceApi.cancel(w.id, user.id, reason.trim());
                  setCancel(false);
                  toast(t('p4g_mw_cancelled'));
                }}
              >
                {t('p4g_mw_cancel')}
              </Button>
            </>
          }
        >
          <Field label={t('p4g_mw_cancelReason')} required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} ariaLabel={t('p4g_mw_cancelReason')} />
          </Field>
        </Modal>
      )}
    </Drawer>
  );
}

function WindowsTab() {
  const { t } = useSession();
  const q = useQuery();
  const canAdmin = useCan()('maintenance', 'admin');
  const list = useApi(() => maintenanceApi.list());
  const [form, setForm] = useState<MaintenanceWindow | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(q.get('id'));
  const rows = list.data ?? [];
  return (
    <>
      <div className="grid grid-4">
        <Stat label={t('p4g_mw_kpiPending')} value={rows.filter((w) => w.status === 'pending').length} icon="clock" />
        <Stat label={t('p4g_mw_kpiScheduled')} value={rows.filter((w) => maintenancePhase(w) === 'scheduled').length} icon="wrench" tone="accent" />
        <Stat label={t('p4g_mw_kpiActive')} value={rows.filter((w) => maintenancePhase(w) === 'in_progress').length} icon="alert" tone={rows.some((w) => maintenancePhase(w) === 'in_progress') ? 'alert' : undefined} />
        <Stat label={t('p4g_mw_kpiLead')} value={`${MIN_WORKING_DAYS}`} icon="check" foot={t('p4g_mw_kpiLeadFoot')} />
      </div>
      <Card
        flush
        title={
          <div className="svc-spread" style={{ width: '100%' }}>
            <h2>{t('p4g_mw_tabWindows')}</h2>
            {canAdmin && (
              <Button type="primary" icon="plus" onClick={() => setForm('new')} className="mw-new">
                {t('p4g_mw_new')}
              </Button>
            )}
          </div>
        }
      >
        {list.data && !rows.length ? (
          <Empty text={t('p4g_mw_empty')} icon="wrench" />
        ) : (
          <DataTable
            rows={rows}
            loading={list.loading}
            rowKey={(w) => w.id}
            onRowClick={(w) => setOpen(w.id)}
            columns={[
              { header: '№', render: (w) => <span className="svc-mono" data-testid="mw-row" data-id={w.id} data-status={shownStatus(w)}>{w.number}</span> },
              { header: t('p4g_mw_subject'), render: (w) => w.title },
              { header: t('p4g_mw_period'), render: (w) => <span className="num small">{formatDateTime(w.start)} — {formatDateTime(w.end)}</span> },
              { header: t('p4g_mw_impact'), render: (w) => t(tk('p4g_mw_impact_', w.impact)) },
              { header: t('p4g_sd_status'), render: (w) => <Badge tone={STATUS_TONE[shownStatus(w)] ?? 'muted'}>{t(tk('p4g_mw_status_', shownStatus(w)))}</Badge> },
            ]}
          />
        )}
      </Card>
      {form && <WindowForm initial={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
      {open && (
        <WindowDrawer
          id={open}
          onClose={() => setOpen(null)}
          onEdit={(w) => {
            setOpen(null);
            setForm(w);
          }}
        />
      )}
    </>
  );
}

function EmergencyTab() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const stepUp = useStepUp();
  const canAdmin = useCan()('maintenance', 'admin');
  const st = useApi(() => maintenanceApi.getEmergency());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const on = !!st.data?.on;
  return (
    <Card title={t('p4g_em_title')}>
      <div className={`banner ${on ? 'danger' : 'info'} em-state`} data-on={on ? '1' : '0'}>
        <b>{t('mon_mode')}:</b> {on ? t('p4g_em_on') : t('mon_mode_normal')}
        {on && st.data?.since && <span className="muted"> · {formatDateTime(st.data.since)} · {st.data.reason}</span>}
      </div>
      <p className="muted small">{t('p4g_em_hint')}</p>
      {!on && (
        <Field label={t('p4g_em_reason')} required error={error}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} disabled={!canAdmin} ariaLabel={t('p4g_em_reason')} />
        </Field>
      )}
      <label className="svc-row" style={{ gap: 10 }}>
        <Switch
          checked={on}
          disabled={!canAdmin}
          ariaLabel={t('p4g_em_toggle')}
          onChange={async (next) => {
            setError('');
            if (next && !reason.trim()) return setError(t('formRequired'));
            if (!(await stepUp(next ? t('p4g_em_turnOn') : t('p4g_em_turnOff')))) return;
            try {
              await maintenanceApi.setEmergency(next, reason, user.id);
              toast(next ? t('p4g_em_on') : t('mon_mode_normal'));
              setReason('');
            } catch {
              toast(t('actionFailed'));
            }
          }}
        />
        <b>{t('p4g_em_toggle')}</b>
      </label>
    </Card>
  );
}

function MaintenancePage() {
  const { t } = useSession();
  const q = useQuery();
  const [tab, setTab] = useState<Tab>(q.get('tab') === 'emergency' ? 'emergency' : 'windows');
  return (
    <>
      <PageHeader title={t('p4g_mw_title')} subtitle={`${t('tzLabel')} PR-GEN-059, PR-GEN-060 · ${t('p4g_mw_subtitle')}`} />
      <Tabs<Tab>
        value={tab}
        onChange={(v) => {
          setTab(v);
          window.history.replaceState(null, '', `#/maintenance?tab=${v}`);
        }}
        items={[
          { value: 'windows', label: t('p4g_mw_tabWindows') },
          { value: 'emergency', label: t('p4g_mw_tabEmergency') },
        ]}
      />
      {tab === 'windows' ? <WindowsTab /> : <EmergencyTab />}
    </>
  );
}

export const routes: ModuleRoute[] = [{ path: '/maintenance', render: () => <MaintenancePage /> }];
