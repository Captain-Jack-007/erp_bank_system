// Распоряжения о закреплении ТС за водителями и акты приёма-передачи (PR-FLT-029…034, 042…045):
// маршрут согласования, акт с пробегом/топливом/состоянием, подписи E-IMZO, печать, полная история закреплений.
import { useMemo, useState } from 'react';
import {
  api, fleetActSignContent, fleetApi, fleetCanManage, fleetDriverOf, formatDate, formatDateTime, formatNumber, signatureService, tk,
  type FleetAssignment, type FleetAssignmentStatus, type PrintDocument,
} from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, FilterBar, Loading, PageHeader, RouteSteps, Select, Timeline, useToast, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Attachments } from '../../components/Attachments';
import { SignModal, SignatureBadge } from '../../components/SignModal';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { dec, FleetNav, Plate, useFleetErr, FleetTaskBox } from './shared';
import { ActModal } from './expenseForms';

export const ASG_TONE: Record<FleetAssignmentStatus, Tone> = { draft: 'muted', pending: 'warn', returned: 'warn', rejected: 'danger', approved: 'info', completed: 'ok', cancelled: 'muted' };
const STATUSES: FleetAssignmentStatus[] = ['pending', 'returned', 'approved', 'completed', 'rejected', 'cancelled'];

export function AssignmentsPage() {
  const { t } = useSession();
  const [status, setStatus] = useState<FleetAssignmentStatus | ''>('');
  const [vehicleId, setVehicleId] = useState('');
  const list = useApi(() => fleetApi.listAssignments({ ...(status ? { status } : {}), ...(vehicleId ? { vehicleId } : {}) }), [status, vehicleId]);
  const vehicles = useApi(() => fleetApi.list({ kind: 'vehicle' }), []);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const plate = (id: string) => vehicles.data?.find((v) => v.id === id)?.plate ?? id;
  const dn = (id?: string) => (id ? drivers.data?.find((d) => d.id === id)?.fullName ?? id : '—');
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_assignments') }]}
        title={t('fleet_nav_assignments')}
        subtitle={t('fleet_assignmentsSub')}
        actions={<ExportButton<FleetAssignment> filename={t('fleet_assignHistory')} rows={list.data ?? []} columns={[
          { header: '№', value: (a) => a.number }, { header: t('fleet_plate'), value: (a) => plate(a.vehicleId) }, { header: t('fleet_assignRole'), value: (a) => t(tk('fleet_role_', a.role)) },
          { header: t('fleet_driver'), value: (a) => dn(a.driverId), width: 24 }, { header: t('fleet_fromDriver'), value: (a) => dn(a.fromDriverId), width: 24 }, { header: t('fleet_basis'), value: (a) => t(tk('fleet_basis_', a.basis)) },
          { header: t('fleet_effectiveFrom'), value: (a) => a.effectiveFrom, format: 'date' }, { header: t('fleet_effectiveTo'), value: (a) => a.effectiveTo ?? '', format: 'date' },
          { header: t('fleet_act'), value: (a) => a.act?.number ?? '' }, { header: t('fleet_odometer'), value: (a) => a.act?.odometer ?? null, format: 'integer' }, { header: t('status'), value: (a) => t(tk('fleet_astatus_', a.status)) },
        ]} />}
      />
      <FleetNav active="assignments" />
      <Card flush>
        <FilterBar>
          <Select<string> value={vehicleId} placeholder={`${t('fleet_plate')}: ${t('all')}`} ariaLabel={t('fleet_plate')} onChange={setVehicleId} options={(vehicles.data ?? []).map((v) => ({ value: v.id, label: v.plate }))} />
          <Select<FleetAssignmentStatus> value={status} placeholder={`${t('status')}: ${t('all')}`} ariaLabel={t('status')} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(tk('fleet_astatus_', s)) }))} />
        </FilterBar>
        <DataTable rows={list.data} loading={list.loading} rowKey={(a) => a.id} onRowClick={(a) => navigate(`/fleet/assignments/${a.id}`)} columns={[
          { header: '№', render: (a) => <span className="doc-num">{a.number}</span> },
          { header: t('fleet_plate'), render: (a) => <Plate value={plate(a.vehicleId)} /> },
          { header: t('fleet_assignRole'), render: (a) => (<>{t(tk('fleet_role_', a.role))}<div className="sub">{t(tk('fleet_basis_', a.basis))}</div></>) },
          { header: t('fleet_driver'), render: (a) => (<>{dn(a.driverId)}{a.fromDriverId && <div className="sub">← {dn(a.fromDriverId)}</div>}</>) },
          { header: t('fleet_periodAssign'), render: (a) => `${formatDate(a.effectiveFrom)} — ${a.effectiveTo ? formatDate(a.effectiveTo) : a.status === 'completed' ? t('fleet_now') : '…'}` },
          { header: t('fleet_act'), render: (a) => (a.act ? `${a.act.number} · ${formatNumber(a.act.odometer)} km` : '—') },
          { header: t('status'), render: (a) => <Badge tone={ASG_TONE[a.status]}>{t(tk('fleet_astatus_', a.status))}</Badge> },
        ]} />
      </Card>
    </>
  );
}

export function AssignmentDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const canManage = fleetCanManage(user);
  const me = fleetDriverOf(user);
  const aq = useApi(() => fleetApi.getAssignment(id), [id]);
  const a = aq.data;
  const vq = useApi(() => (a ? fleetApi.get(a.vehicleId) : Promise.resolve(undefined)), [a?.vehicleId]);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const users = useApi(() => api.listUsers(), []);
  const sigs = useApi(() => signatureService.list('fleet_act', id), [id]);
  const [act, setAct] = useState(false);
  const [sign, setSign] = useState(false);
  const content = useMemo(() => (a?.act ? fleetActSignContent(a) : null), [a]);
  if (aq.loading && !a) return <Card><Loading /></Card>;
  if (!a) return <Card><Empty text={t('empty')} /></Card>;
  const v = vq.data;
  const dn = (did?: string) => (did ? drivers.data?.find((d) => d.id === did)?.fullName ?? did : '—');
  const to = drivers.data?.find((d) => d.id === a.driverId);
  const from = drivers.data?.find((d) => d.id === a.fromDriverId);
  const participants = [to?.userId, from?.userId].filter(Boolean) as string[];
  const signed = new Set((sigs.data ?? []).map((s) => s.userId));
  const canSign = !!content && !signed.has(user.id) && (canManage || participants.includes(user.id) || (!!me && (me.id === a.driverId || me.id === a.fromDriverId)));
  async function resubmit() {
    try {
      await fleetApi.resubmitAssignment(a!.id, {}, user);
      toast(`${a!.number}: ${t('fleet_resubmitted')}`);
    } catch (e) {
      toast(err(e));
    }
  }
  async function cancel() {
    try {
      await fleetApi.cancelAssignment(a!.id, user);
      toast(`${a!.number}: ${t('fleet_astatus_cancelled')}`);
    } catch (e) {
      toast(err(e));
    }
  }
  const orderDoc = (): PrintDocument => ({
    entity: 'fleet_assignment', entityId: a.id, title: a.basis === 'order' ? t('fleet_orderTitle') : t('fleet_poaTitle'), number: a.number, date: a.createdAt.slice(0, 10),
    fields: [
      { label: t('fleet_plate'), value: `${v?.plate ?? ''} · ${v?.brand ?? ''} ${v?.model ?? ''} · VIN ${v?.vin ?? ''}` },
      { label: t('fleet_driver'), value: `${dn(a.driverId)} · ${to?.personnelNo ?? ''} · ${to?.licenseNo ?? ''} (${to?.licenseCategories.join(', ') ?? ''})` },
      { label: t('fleet_assignRole'), value: t(tk('fleet_role_', a.role)) },
      { label: t('fleet_fromDriver'), value: dn(a.fromDriverId) },
      { label: t('fleet_effectiveFrom'), value: formatDate(a.effectiveFrom) },
      { label: t('fleet_reason'), value: a.reason },
    ],
    paragraphs: [t('fleet_orderText')],
    signers: [{ role: t('fleet_headFacilities'), name: users.data?.find((u) => u.id === a.history.find((h) => h.action === 'approved')?.userId)?.fullName ?? '' }, { role: t('fleet_driver'), name: dn(a.driverId) }],
  });
  const actDoc = (): PrintDocument => ({
    entity: 'fleet_act', entityId: a.id, title: t('fleet_handoverAct'), number: a.act?.number ?? '', date: a.act?.date ?? '',
    fields: [
      { label: t('fleet_plate'), value: `${v?.plate ?? ''} · ${v?.brand ?? ''} ${v?.model ?? ''}` },
      { label: t('fleet_fromDriver'), value: dn(a.fromDriverId) },
      { label: t('fleet_toDriver'), value: dn(a.driverId) },
      { label: t('fleet_odometer'), value: formatNumber(a.act?.odometer ?? 0) },
      { label: t('fleet_fuelLevel'), value: dec(a.act?.fuelLevel) },
      { label: t('fleet_defects'), value: a.act?.defects || '—' },
    ],
    table: { columns: [{ header: t('fleet_condition') }, { header: t('fleet_result'), align: 'center' }], rows: Object.entries(a.act?.checklist ?? {}).map(([k, ok]) => [t(tk('fleet_check_', k)), ok ? t('fleet_ok') : t('fleet_notOk')]) },
    signers: [
      { role: t('fleet_handed'), name: dn(a.fromDriverId), ...((sigs.data ?? []).find((s) => s.userId === from?.userId) ? { signatureId: (sigs.data ?? []).find((s) => s.userId === from?.userId)!.id } : {}) },
      { role: t('fleet_received'), name: dn(a.driverId), ...((sigs.data ?? []).find((s) => s.userId === to?.userId) ? { signatureId: (sigs.data ?? []).find((s) => s.userId === to?.userId)!.id } : {}) },
      { role: t('fleet_responsible'), name: users.data?.find((u) => u.id === a.act?.completedBy)?.fullName ?? '', ...((sigs.data ?? []).find((s) => s.userId !== to?.userId && s.userId !== from?.userId) ? { signatureId: (sigs.data ?? []).find((s) => s.userId !== to?.userId && s.userId !== from?.userId)!.id } : {}) },
    ],
  });
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_assignments'), to: '/fleet/assignments' }, { label: a.number }]}
        title={`${a.number} · ${v?.plate ?? ''} → ${dn(a.driverId)}`}
        subtitle={`${t(tk('fleet_role_', a.role))} · ${t(tk('fleet_basis_', a.basis))} · ${formatDate(a.effectiveFrom)}`}
        actions={
          <>
            <Badge tone={ASG_TONE[a.status]}>{t(tk('fleet_astatus_', a.status))}</Badge>
            {canManage && a.status === 'approved' && v && <Button type="primary" onClick={() => setAct(true)}>{t('fleet_completeAct')}</Button>}
            {canManage && (a.status === 'returned' || a.status === 'rejected') && <Button type="primary" onClick={resubmit}>{t('fleet_resubmit')}</Button>}
            {canManage && ['returned', 'rejected', 'approved'].includes(a.status) && <Button onClick={cancel}>{t('fleet_cancelOrder')}</Button>}
            <PrintButton doc={orderDoc} template="card" label={t('fleet_printOrder')} />
            {a.act && <PrintButton doc={actDoc} template="act" label={t('fleet_printAct')} />}
          </>
        }
      />
      <FleetTaskBox entityId={id} />
      <div className="grid grid-main">
        <div className="flt-stack">
          <Card title={t('details')}>
            <dl className="kv">
              <dt>{t('fleet_plate')}</dt><dd>{v ? <Link to={`/fleet/${v.id}`}><Plate value={v.plate} /></Link> : '—'}</dd>
              <dt>{t('fleet_toDriver')}</dt><dd>{to ? <Link to={`/fleet/drivers/${to.id}`}>{to.fullName}</Link> : '—'}</dd>
              <dt>{t('fleet_fromDriver')}</dt><dd>{from ? <Link to={`/fleet/drivers/${from.id}`}>{from.fullName}</Link> : '—'}</dd>
              <dt>{t('fleet_assignRole')}</dt><dd>{t(tk('fleet_role_', a.role))}</dd>
              <dt>{t('fleet_basis')}</dt><dd>{t(tk('fleet_basis_', a.basis))}</dd>
              <dt>{t('fleet_periodAssign')}</dt><dd>{formatDate(a.effectiveFrom)} — {a.effectiveTo ? formatDate(a.effectiveTo) : a.status === 'completed' ? t('fleet_now') : '…'}</dd>
              <dt>{t('fleet_reason')}</dt><dd>{a.reason}</dd>
            </dl>
          </Card>
          {a.act ? (
            <Card title={`${t('fleet_handoverAct')} ${a.act.number}`}>
              <dl className="kv">
                <dt>{t('date')}</dt><dd>{formatDate(a.act.date)}</dd>
                <dt>{t('fleet_odometer')}</dt><dd className="num">{formatNumber(a.act.odometer)}</dd>
                <dt>{t('fleet_fuelLevel')}</dt><dd className="num">{dec(a.act.fuelLevel)}</dd>
                <dt>{t('fleet_condition')}</dt><dd>{Object.entries(a.act.checklist).map(([k, ok]) => <Badge key={k} tone={ok ? 'ok' : 'danger'}>{t(tk('fleet_check_', k))}</Badge>)}</dd>
                <dt>{t('fleet_defects')}</dt><dd>{a.act.defects || '—'}</dd>
                <dt>{t('fleet_responsible')}</dt><dd>{users.data?.find((u) => u.id === a.act!.completedBy)?.fullName} · {formatDateTime(a.act.completedAt)}</dd>
              </dl>
            </Card>
          ) : a.status === 'approved' ? <div className="flt-warnbox">{t('fleet_actPendingNote')}</div> : null}
          {content && (
            <Card title={t('fleet_actSignatures')} actions={canSign ? <Button size="small" type="primary" icon="pen" onClick={() => setSign(true)}>{t('svc_signButton')}</Button> : undefined}>
              {(sigs.data ?? []).length ? (sigs.data ?? []).map((s) => (
                <div key={s.id} className="flt-sig"><span className="flt-sig-role">{s.owner}</span><SignatureBadge record={s} content={content} /><span className="muted small">{formatDateTime(s.signedAt)}</span></div>
              )) : <p className="flt-hint">{t('fleet_actSignHint')}</p>}
            </Card>
          )}
          <Attachments entity="fleet_assignment" entityId={a.id} title={t('fleet_orderScans')} readOnly={!canManage} />
        </div>
        <div className="flt-stack">
          <Card title={t('fleet_approvalRoute')}><RouteSteps entityId={a.id} /></Card>
          <Card title={t('history')}><Timeline events={a.history} /></Card>
        </div>
      </div>
      {act && v && <ActModal assignment={a} vehicle={v} onClose={() => setAct(false)} />}
      {sign && content && <SignModal doc={{ entity: 'fleet_act', entityId: a.id, title: `${t('fleet_handoverAct')} ${a.act?.number ?? ''}`, content }} onClose={() => setSign(false)} onSigned={() => sigs.reload()} />}
    </>
  );
}
