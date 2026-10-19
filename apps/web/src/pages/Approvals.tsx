import { useMemo, useState } from 'react';
import {
  approvalsApi,
  formatDateTime,
  formatMoney,
  formatMoneyShort,
  isOverdue,
  tk,
  type ApprovalEntity,
  type ApprovalTask,
  type ApprovalTaskV2,
  type InboxBox,
  type InboxItem,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, Empty, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui';
import { Icon, type IconName } from '../components/icons';
import { RouteDrawer, Segmented, useFlowError } from '../components/flow';
import { fmt } from '../components/flowLabels';
import { useSession, useUser } from '../lib/session';
import { useApi, useLookups } from '../lib/useApi';
import { navigate, useQuery } from '../lib/router';
import { APPROVAL_LINKS } from '../lib/approvalLinks';
import { useStepUp } from '../lib/access';

const ENTITY_ICON: Record<ApprovalTask['entity'], IconName> = {
  fleet_trip: 'route', // P2-FLT
  fleet_assignment: 'car', // P2-FLT
  fleet_topup: 'wallet', // P2-FLT
  procurement: 'cart',
  contract: 'file',
  employee_request: 'inbox',
  business_trip: 'plane',
  einvoice: 'receipt',
  budget_change: 'wallet',
  document: 'file',
  asset_writeoff: 'building',
  payment: 'coins',
  work_act: 'file', // P2-PROC
  budget_zbb: 'wallet', // P2-FINPLAN
  budget_overrun: 'alert', // P2-FINPLAN
  capex_request: 'building', // P2-FINPLAN
  warehouse_issue: 'box', // P2-WMS
  warehouse_writeoff: 'box', // P2-WMS
  asset_transfer: 'building', // P2-WMS
  doc_payment: 'coins', // P2-DOCS
  archive_act: 'archive', // P2-DOCS
  cash_rule: 'coins', // P2-FINREP
  cash_close: 'coins', // P2-FINREP
  maintenance_window: 'wrench', // P4-GEN
  audit_retention: 'clock', // P4-SEC
  pd_anonymize: 'shield', // P4-SEC
  mdm_change: 'book', // P4 (PR-MDM-003)
};

/** P4-SEC: решения по этим документам — операции высокого риска (контроль двух лиц), требуют 2FA. */
export const STEP_UP_ENTITIES: ReadonlySet<ApprovalEntity> = new Set<ApprovalEntity>(['audit_retention', 'pd_anonymize']);

function entityLink(task: ApprovalTask): string {
  return APPROVAL_LINKS[task.entity]?.(task.entityId) ?? '';
}

/**
 * Задача согласования: согласовать / отклонить (причина) / вернуть на доработку (причина) / ход маршрута.
 * item — данные очереди (SoD, замещение, массовое согласование); без него SoD проверяется по инициатору.
 */
export function TaskRow({ task, compact, item, selected, onSelect }: { task: ApprovalTask; compact?: boolean; item?: InboxItem; selected?: boolean; onSelect?: (v: boolean) => void }) {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const errText = useFlowError();
  const stepUp = useStepUp();
  const [mode, setMode] = useState<'reject' | 'return' | null>(null);
  const [routeOpen, setRouteOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const v2 = task as ApprovalTaskV2;
  const overdue = isOverdue(task.dueAt);
  const blocked = item?.blockedReason ?? (task.requesterId === user.id ? 'sod_initiator' : undefined);
  const onBehalfOf = item?.onBehalfOf;

  async function decide(decision: 'approve' | 'reject' | 'return') {
    if (decision !== 'approve' && !reason.trim()) {
      setError(t(decision === 'reject' ? 'rejectReasonRequired' : 'flow_return_required'));
      return;
    }
    if (decision === 'approve' && STEP_UP_ENTITIES.has(task.entity) && !(await stepUp(`${t('approve')}: ${task.number}`))) return;
    setBusy(true);
    try {
      await approvalsApi.decide(task.id, user, decision, decision === 'approve' ? undefined : reason.trim());
      toast(`${task.number}: ${decision === 'approve' ? t('approved') : decision === 'reject' ? t('rejected') : t('flow_returned_toast')}`);
      setMode(null);
    } catch (e) {
      toast(`${t('actionFailed')}: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const link = entityLink(task);
  const openModal = (m: 'reject' | 'return') => {
    setReason('');
    setError('');
    setMode(m);
  };
  return (
    <div className={`task ${selected ? 'selected' : ''}`}>
      <div className="task-icon">
        <Icon name={ENTITY_ICON[task.entity] ?? 'file'} />
      </div>
      <div className="task-body">
        <div className="task-title">
          {onSelect && (
            <span className="task-check">
              <Checkbox checked={!!selected} onChange={onSelect} />
            </span>
          )}
          {link ? (
            <a href={`#${link}`} style={{ color: 'inherit' }}>
              {task.title}
            </a>
          ) : (
            task.title
          )}
        </div>
        <div className="task-meta">
          <span>{t(tk('entity_', task.entity))} · {task.number}</span>
          {!compact && <span>{lk.user(task.requesterId)?.fullName}</span>}
          <span>
            {t('step')} {task.step} {t('of')} {task.totalSteps}
          </span>
          {overdue ? <Badge tone="danger">{t('overdue')}</Badge> : <span>{t('dueAt')}: {formatDateTime(task.dueAt)}</span>}
          {onBehalfOf && <Badge tone="info">{fmt(t('flow_deputy_for'), { name: lk.user(onBehalfOf)?.fullName ?? onBehalfOf })}</Badge>}
          {!!v2.escalatedTo?.length && <Badge tone="warn">{t('flow_escalated')}</Badge>}
          {v2.infoRequested && <Badge tone="info">{t('flow_info_requested')}</Badge>}
          {item?.lowRisk && !compact && <Badge tone="muted">{t('flow_low_risk')}</Badge>}
          {blocked && <Badge tone="warn">{t(blocked === 'sod_initiator' ? 'flow_sod_initiator' : 'flow_sod_repeat')}</Badge>}
        </div>
      </div>
      {task.amount !== undefined && <div className="task-amount num">{formatMoney(task.amount, task.currency)}</div>}
      <div className="task-actions">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRouteOpen(true)} title={t('flow_route_title')} aria-label={t('flow_route_title')}>
          <Icon name="route" size={16} />
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={() => openModal('return')}>
          {t('flow_return')}
        </button>
        <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => openModal('reject')}>
          {t('reject')}
        </button>
        <button className="btn btn-primary btn-sm" disabled={busy || !!blocked} onClick={() => decide('approve')}>
          {t('approve')}
        </button>
      </div>

      {mode && (
        <Modal
          title={`${mode === 'reject' ? t('reject') : t('flow_return_title')}: ${task.number}`}
          onClose={() => setMode(null)}
          footer={
            <>
              <button className="btn" onClick={() => setMode(null)}>{t('cancel')}</button>
              <button className={`btn ${mode === 'reject' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={() => decide(mode)}>
                {mode === 'reject' ? t('reject') : t('flow_return')}
              </button>
            </>
          }
        >
          <div style={{ fontWeight: 600 }}>{task.title}</div>
          <Field label={t(mode === 'reject' ? 'rejectReason' : 'flow_return_reason')} required error={error}>
            <Textarea
              value={reason}
              ariaLabel={t(mode === 'reject' ? 'rejectReason' : 'flow_return_reason')}
              onChange={(e) => {
                setReason(e.target.value);
                setError('');
              }}
            />
          </Field>
        </Modal>
      )}
      {routeOpen && <RouteDrawer open entityId={task.entityId} taskId={task.id} onClose={() => setRouteOpen(false)} title={`${t('flow_route_title')}: ${task.number}`} />}
    </div>
  );
}

/** Документ, отправленный пользователем: состояние маршрута, повторная отправка после возврата. */
function SentRow({ item }: { item: InboxItem }) {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const errText = useFlowError();
  const [routeOpen, setRouteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { task, instance } = item;
  const v2 = task as ApprovalTaskV2;
  const st = instance!.status;
  const who = v2.assigneeIds?.length ? v2.assigneeIds.map((id) => lk.user(id)?.fullName ?? id).join(', ') : t(tk('role_', task.assigneeRole));
  const link = entityLink(task);

  async function resubmit() {
    setBusy(true);
    try {
      await approvalsApi.resubmit(task.entityId, user);
      toast(`${task.number}: ${t('flow_resubmitted')}`);
    } catch (e) {
      toast(`${t('actionFailed')}: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="task">
      <div className="task-icon">
        <Icon name={ENTITY_ICON[task.entity] ?? 'file'} />
      </div>
      <div className="task-body">
        <div className="task-title">{link ? <a href={`#${link}`} style={{ color: 'inherit' }}>{task.title}</a> : task.title}</div>
        <div className="task-meta">
          <span>{t(tk('entity_', task.entity))} · {task.number}</span>
          <Badge tone={st === 'approved' ? 'ok' : st === 'rejected' ? 'danger' : st === 'returned' ? 'warn' : 'info'}>{t(tk('flow_inst_', st))}</Badge>
          <span>{fmt(t('flow_step_of'), { step: instance!.currentStep, total: instance!.totalSteps })}</span>
          {st === 'in_progress' && <span>{fmt(t('flow_now_at'), { who })}</span>}
          {instance!.cycle > 1 && <span>{fmt(t('flow_cycle'), { n: instance!.cycle })}</span>}
          {item.overdue && <Badge tone="danger">{t('overdue')}</Badge>}
          {(st === 'returned' || st === 'rejected') && v2.comment && <span className="sent-reason">«{v2.comment}»</span>}
        </div>
      </div>
      {task.amount !== undefined && <div className="task-amount num">{formatMoney(task.amount, task.currency)}</div>}
      <div className="task-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => setRouteOpen(true)} title={t('flow_route_title')} aria-label={t('flow_route_title')}>
          <Icon name="route" size={16} />
        </button>
        {st === 'returned' && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={resubmit}>
            {t('flow_resubmit')}
          </button>
        )}
      </div>
      {routeOpen && <RouteDrawer open entityId={task.entityId} onClose={() => setRouteOpen(false)} title={`${t('flow_route_title')}: ${task.number}`} />}
    </div>
  );
}

/** Решение пользователя (вкладка «Мои решения»). */
function HistoryRow({ item }: { item: InboxItem }) {
  const { t } = useSession();
  const lk = useLookups();
  const [routeOpen, setRouteOpen] = useState(false);
  const e = item.event!;
  const link = entityLink(item.task);
  const tone = e.action === 'approved' ? 'ok' : e.action === 'rejected' ? 'danger' : e.action === 'returned' ? 'warn' : 'info';
  return (
    <div className="task">
      <div className="task-icon">
        <Icon name={ENTITY_ICON[e.entity] ?? 'file'} />
      </div>
      <div className="task-body">
        <div className="task-title">{link ? <a href={`#${link}`} style={{ color: 'inherit' }}>{e.title}</a> : e.title}</div>
        <div className="task-meta">
          <span>{t(tk('entity_', e.entity))} · {e.number}</span>
          <Badge tone={tone}>{t(tk('flow_ev_', e.action))}</Badge>
          <span>{formatDateTime(e.at)}</span>
          {e.step && <span>{fmt(t('flow_step_n'), { n: e.step })}</span>}
          {e.onBehalfOf && <Badge tone="info">{fmt(t('flow_on_behalf'), { name: lk.user(e.onBehalfOf)?.fullName ?? e.onBehalfOf })}</Badge>}
          {e.comment && <span className="sent-reason">«{e.comment}»</span>}
        </div>
      </div>
      <div className="task-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => setRouteOpen(true)} title={t('flow_route_title')} aria-label={t('flow_route_title')}>
          <Icon name="route" size={16} />
        </button>
      </div>
      {routeOpen && <RouteDrawer open entityId={e.entityId} onClose={() => setRouteOpen(false)} title={`${t('flow_route_title')}: ${e.number}`} />}
    </div>
  );
}

type Filter = 'all' | ApprovalTask['entity'];
const ENTITIES = Object.keys(ENTITY_ICON) as ApprovalTask['entity'][];
const BOXES: InboxBox[] = ['mine', 'delegated', 'sent', 'history'];

export function ApprovalsPage() {
  const { t, lang } = useSession();
  const user = useUser();
  const toast = useToast();
  const query = useQuery();
  const qBox = query.get('box') as InboxBox | null;
  const [box, setBoxState] = useState<InboxBox>(qBox && BOXES.includes(qBox) ? qBox : 'mine');
  const [filter, setFilter] = useState<Filter>((query.get('entity') as Filter | null) ?? 'all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const flt = { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(overdueOnly ? { overdueOnly } : {}) };
  const data = useApi(() => approvalsApi.inbox(user, box, flt).then((items) => ({ box, items })), [user.id, box, from, to, overdueOnly]);
  const counts = useApi(() => approvalsApi.counts(user), [user.id]);
  const policy = useApi(() => approvalsApi.getBulkPolicy(), []);
  // данные предыдущей вкладки не показываем, пока грузится новая
  const list = data.data?.box === box ? data.data.items : [];
  const entityOf = (i: InboxItem) => i.event?.entity ?? i.task.entity;
  const shown = filter === 'all' ? list : list.filter((x) => entityOf(x) === filter);
  const count = (e: ApprovalEntity) => list.filter((x) => entityOf(x) === e).length;
  const lowRisk = useMemo(() => shown.filter((i) => i.lowRisk && i.canApprove), [shown]);
  const chosen = lowRisk.filter((i) => selected.has(i.task.id));

  const setBox = (b: InboxBox) => {
    setBoxState(b);
    setSelected(new Set());
    if (b !== 'mine' && b !== 'delegated') setOverdueOnly(false);
  };

  async function bulk() {
    setBulkBusy(true);
    try {
      const r = await approvalsApi.bulkApprove(chosen.map((i) => i.task.id), user);
      toast(`${fmt(t('flow_bulk_done'), { n: r.approved.length })}${r.failed.length ? ` · ${fmt(t('flow_bulk_failed'), { n: r.failed.length })}` : ''}`);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  }

  const toggle = (id: string, v: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  const empty = box === 'mine' ? t('approvalsEmpty') : box === 'delegated' ? t('flow_empty_delegated') : box === 'sent' ? t('flow_empty_sent') : t('flow_empty_history');

  return (
    <>
      <PageHeader
        title={t('approvalsTitle')}
        subtitle={t('approvalsSubtitle')}
        actions={
          <Button icon="users" onClick={() => navigate('/approvals/deputies')}>
            {t('flow_nav_deputies')}
          </Button>
        }
      />
      <Segmented<InboxBox>
        value={box}
        onChange={setBox}
        options={BOXES.map((b) => ({ value: b, label: t(tk('flow_box_', b)), ...(b !== 'history' && counts.data ? { count: counts.data[b] } : {}) }))}
      />
      <Card flush>
        {box === 'mine' ? (
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all' as Filter, label: t('all'), count: list.length },
              ...ENTITIES.filter((e) => count(e) > 0 || e === filter).map((e) => ({ value: e as Filter, label: t(tk('entity_', e)), count: count(e) })),
            ]}
          />
        ) : null}
        <FilterBar>
          {box !== 'mine' && (
            <Select<Filter>
              value={filter}
              onChange={setFilter}
              ariaLabel={t('flow_entities')}
              options={[{ value: 'all', label: t('flow_all_types') }, ...ENTITIES.map((e) => ({ value: e as Filter, label: t(tk('entity_', e)) }))]}
              style={{ width: 220 }}
            />
          )}
          <span className="flow-period">
            <span className="small muted">{t('flow_period')}</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={t('flow_from')} style={{ width: 150 }} />
            <span className="muted">—</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={t('flow_to')} style={{ width: 150 }} />
          </span>
          {box !== 'history' && <Checkbox checked={overdueOnly} onChange={setOverdueOnly}>{t('flow_overdue_only')}</Checkbox>}
          {box === 'mine' && lowRisk.length > 0 && (
            <span className="flow-bulk">
              <Checkbox checked={chosen.length === lowRisk.length} onChange={(v) => setSelected(v ? new Set(lowRisk.map((i) => i.task.id)) : new Set())}>
                {t('flow_bulk_select_all')}
              </Checkbox>
              <Button type="primary" size="small" disabled={!chosen.length || bulkBusy} onClick={bulk} icon="check">
                {`${t('flow_bulk_approve')} (${chosen.length})`}
              </Button>
            </span>
          )}
        </FilterBar>
        {box === 'mine' && lowRisk.length > 0 && policy.data && (
          <div className="flow-hint small muted">
            {fmt(t('flow_bulk_hint'), { types: policy.data.entities.map((e) => t(tk('entity_', e))).join(', '), amount: formatMoneyShort(policy.data.maxAmount, lang) })}
          </div>
        )}
        {data.loading && data.data?.box !== box ? (
          <Loading />
        ) : shown.length ? (
          shown.map((item) =>
            box === 'sent' ? (
              <SentRow key={item.task.instanceId ?? item.task.id} item={item} />
            ) : box === 'history' ? (
              <HistoryRow key={item.event!.id} item={item} />
            ) : (
              <TaskRow key={item.task.id} task={item.task} item={item} {...(box === 'mine' && item.lowRisk && item.canApprove ? { selected: selected.has(item.task.id), onSelect: (v: boolean) => toggle(item.task.id, v) } : {})} />
            ),
          )
        ) : (
          <Empty text={empty} icon="check" />
        )}
      </Card>
    </>
  );
}
