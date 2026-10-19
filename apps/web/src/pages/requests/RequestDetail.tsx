// Карточка заявки на обеспечение (PR-REQ-007…015): подпись E-IMZO и QR, многоэтапное согласование, проверка
// бюджета, передача на склад и резервирование, выдача (расход склада), подтверждение «Принял».
import { useMemo, useState } from 'react';
import { api, formatDate, formatDateTime, formatMoney, signatureService, supplyApi, tk, type EmployeeRequest, type PrintDocument } from '@xb/shared';
import { Button, Card, DataTable, Empty, Field, Loading, Modal, PageHeader, RouteSteps, Steps, StatusBadge, Textarea, Timeline, useToast } from '../../components/ui';
import { PrintButton } from '../../components/PrintView';
import { SignModal, SignaturesPanel } from '../../components/SignModal';
import { Link } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Kv, useCostCenters, useErr } from '../procurement/shared';

export function requestContent(r: EmployeeRequest) {
  return { type: 'employee_request', number: r.number, kind: r.type, description: r.description, costCenter: r.costCenterKey ?? '', items: (r.items ?? []).map((i) => ({ sku: i.sku ?? '', name: i.name, qty: i.qty })), amount: r.amount ?? 0 };
}

const FLOW = ['pending', 'warehouse', 'reserved', 'issued', 'done'];

export function RequestDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const cc = useCostCenters();
  const r = useApi(() => supplyApi.get(id), [id]);
  const issue = useApi(() => supplyApi.warehouseIssue(id), [id, r.data?.status]);
  const sigs = useApi(() => signatureService.list('employee_request', id), [id]);
  const [modal, setModal] = useState<'receive' | 'service' | 'serviceConfirm' | 'complete' | null>(null);
  const [comment, setComment] = useState('');
  const [mErr, setMErr] = useState('');
  const [busy, setBusy] = useState(false);
  const d = r.data;
  const content = useMemo(() => (d ? requestContent(d) : null), [d]);
  if (r.loading && !d) return <Card><Loading /></Card>;
  if (!d || !content) return <Card><Empty text={t('empty')} /></Card>;
  const mine = d.initiatorId === user.id;
  const isStore = user.role === 'storekeeper' || user.role === 'admin' || can('warehouse', 'edit');
  const legacy = !['stationery', 'household', 'equipment', 'it', 'service'].includes(d.type);
  const service = d.type === 'service';
  const flow = service ? ['pending', 'in_progress', 'issued', 'done'] : FLOW;
  const step = Math.max(0, flow.indexOf(d.status === 'returned' || d.status === 'draft' ? 'pending' : d.status));
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      setModal(null);
      setComment('');
    } catch (e) {
      toast(`${t('actionFailed')}: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const printDoc = (): PrintDocument => ({
    entity: 'employee_request',
    entityId: d.id,
    title: t('req_printTitle'),
    number: d.number,
    date: d.createdAt.slice(0, 10),
    fields: [
      { label: t('requestType'), value: t(tk('rtype_', d.type)) },
      { label: t('initiator'), value: lk.user(d.initiatorId)?.fullName ?? '' },
      { label: t('department'), value: d.departmentId ? lk.department(d.departmentId)?.code ?? '' : '' },
      { label: t('proc_costCenter'), value: cc.label(d.costCenterKey) },
      { label: t('description'), value: d.description },
      { label: t('status'), value: t(tk('rstatus_', d.status)) },
    ],
    ...(d.items?.length ? { table: { columns: [{ header: '№', align: 'center' as const, width: '6%' }, { header: t('itemName') }, { header: t('qty'), align: 'right' as const }, { header: t('amount'), align: 'right' as const }], rows: d.items.map((i, n) => [String(n + 1), `${i.sku ? `${i.sku} · ` : ''}${i.name}`, `${i.qty} ${i.unit}`, formatMoney(i.qty * i.unitCost)]), totals: ['', t('total'), '', formatMoney(d.amount ?? 0)] } } : {}),
    signers: [
      { role: t('initiator'), name: lk.user(d.initiatorId)?.fullName ?? '', ...(sigs.data?.find((s) => s.userId === d.initiatorId) ? { signatureId: sigs.data.find((s) => s.userId === d.initiatorId)!.id } : {}) },
      // PR-REQ-011/012: подписи E-IMZO согласующих — в печатной форме с QR
      ...[...new Map((sigs.data ?? []).filter((s) => s.userId !== d.initiatorId).map((s) => [s.userId, s])).values()].map((s) => ({ role: t('proc_approver'), name: lk.user(s.userId)?.fullName ?? s.userId, signatureId: s.id })),
      ...(d.receivedAt ? [{ role: t('req_received'), name: lk.user(d.receivedBy ?? d.initiatorId)?.fullName ?? '', ...(sigs.data?.filter((s) => s.userId === d.initiatorId).slice(-1)[0] ? { signatureId: sigs.data.filter((s) => s.userId === d.initiatorId).slice(-1)[0]!.id } : {}) }] : []),
    ],
  });
  // выдачу проводит склад после подписей расхода (руководитель, операционист, завсклад); обычно — автоматически по последней подписи
  const issueSigned = !!issue.data && ['head', 'operator', 'storekeeper'].every((role) => issue.data!.signatures.some((s) => s.role === role)) && issue.data.status !== 'issued' && issue.data.status !== 'received';
  const recvDoc = issue.data ? { entity: 'warehouse_issue', entityId: issue.data.id, title: `${t('req_receiveTitle')} ${issue.data.number}`, content: { issue: issue.data.number, request: d.number, lines: issue.data.lines } } : null;

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('navRequests'), to: '/requests' }, { label: d.number }]}
        title={`${t(tk('rtype_', d.type))}: ${d.description.slice(0, 80)}`}
        subtitle={`${d.number} · ${lk.user(d.initiatorId)?.fullName ?? ''}`}
        actions={
          <>
            <StatusBadge prefix="rstatus_" status={d.status} />
            <PrintButton doc={printDoc} />
            {mine && ['draft', 'returned'].includes(d.status) && <Button type="primary" disabled={busy} onClick={() => run(() => supplyApi.submit(d.id, user), t('hist_submitted'))}>{t('submitForApproval')}</Button>}
            {isStore && d.status === 'warehouse' && <Button type="primary" disabled={busy} onClick={() => run(() => supplyApi.reserve(d.id, user), t('req_reservedToast'))}>{t('req_reserve')}</Button>}
            {isStore && d.status === 'reserved' && issueSigned && <Button type="primary" disabled={busy} onClick={() => run(() => supplyApi.issue(d.id, user), t('req_issuedToast'))}>{t('req_issue')}</Button>}
            {isStore && service && d.status === 'in_progress' && <Button type="primary" onClick={() => setModal('service')}>{t('req_serviceDone')}</Button>}
            {mine && d.status === 'issued' && <Button type="primary" icon="check" onClick={() => setModal(service ? 'serviceConfirm' : 'receive')}>{t('req_btnReceived')}</Button>}
            {legacy && d.status === 'in_progress' && (user.role === 'dept_head' || user.role === 'admin') && <Button onClick={() => setModal('complete')}>{t('markDone')}</Button>}
          </>
        }
      />
      {d.status === 'returned' && d.returnReason && <div className="pc-warn">{t('proc_returnedReason')}: {d.returnReason}</div>}
      {!legacy && (
        <Card>
          <Steps current={d.status === 'done' ? flow.length : step} items={flow.map((s) => ({ title: t(tk('rstatus_', s)) }))} />
        </Card>
      )}
      <div className="grid grid-main">
        <div className="pc-stack">
          <Card title={t('details')}>
            <Kv
              items={[
                [t('requestType'), t(tk('rtype_', d.type))],
                [t('initiator'), lk.user(d.initiatorId)?.fullName],
                [t('department'), d.departmentId ? lk.department(d.departmentId)?.code : '—'],
                [t('proc_costCenter'), cc.label(d.costCenterKey)],
                [t('proc_warehouse'), d.warehouseId ?? '—'],
                [t('amount'), d.amount ? formatMoney(d.amount) : '—'],
                [t('date'), formatDateTime(d.createdAt)],
                [t('req_received'), d.receivedAt ? `${formatDateTime(d.receivedAt)} · ${lk.user(d.receivedBy ?? '')?.fullName ?? ''}` : '—'],
                [t('description'), d.description],
              ]}
            />
          </Card>
          {d.items?.length ? (
            <Card title={t('items')} flush>
              <DataTable
                rows={d.items}
                rowKey={(i) => `${i.warehouseItemId}-${i.name}`}
                columns={[
                  { header: t('itemName'), render: (i) => <>{i.name}<div className="sub">{i.sku}</div></> },
                  { header: t('qty'), align: 'right', render: (i) => `${i.qty} ${i.unit}` },
                  { header: t('req_reservedQty'), align: 'right', render: (i) => i.reservedQty ?? '—' },
                  { header: t('req_issuedQty'), align: 'right', render: (i) => i.issuedQty ?? '—' },
                  { header: t('amount'), align: 'right', render: (i) => formatMoney(i.qty * i.unitCost) },
                ]}
              />
            </Card>
          ) : null}
          {issue.data && (
            <Card title={t('req_warehouseDoc')} actions={<Link to={`/warehouse/issues/${issue.data.id}`}>{t('req_openIssue')}</Link>}>
              <Kv
                items={[
                  [t('number'), issue.data.number],
                  [t('status'), t(tk('req_wis_', issue.data.status))],
                  [t('req_signatures'), issue.data.signatures.map((s) => `${t(tk('req_sign_', s.role))}: ${lk.user(s.userId)?.fullName ?? s.userId}`).join(' · ') || '—'],
                  [t('req_issuedAt'), issue.data.issuedAt ? formatDate(issue.data.issuedAt) : '—'],
                  [t('req_invoiceNo'), issue.data.invoiceNo ?? '—'],
                ]}
              />
              {issue.data.status === 'approved' && !issueSigned && <div className="pc-note" style={{ marginTop: 8 }}>{t('req_issueSignHint')}</div>}
            </Card>
          )}
        </div>
        <div className="pc-stack">
          <Card title={t('route')}>
            <RouteSteps entityId={d.id} />
          </Card>
          <SignaturesPanel doc={{ entity: 'employee_request', entityId: d.id, title: `${d.number} · ${t(tk('rtype_', d.type))}`, content }} canSign={mine || can('requests', 'approve')} onSigned={(rec) => void supplyApi.recordSignature(d.id, rec.id, user).catch(() => undefined)} />
          <Card title={t('history')}>
            <Timeline events={d.history} />
          </Card>
        </div>
      </div>
      {modal === 'receive' && recvDoc && <SignModal doc={recvDoc} onClose={() => setModal(null)} onSigned={(rec) => void supplyApi.confirmReceipt(d.id, rec.id, user).then(() => toast(t('req_receivedToast'))).catch((e) => toast(err(e)))} />}
      {modal === 'serviceConfirm' && <SignModal doc={{ entity: 'employee_request', entityId: d.id, title: `${t('req_receiveTitle')} ${d.number}`, content }} onClose={() => setModal(null)} onSigned={(rec) => void supplyApi.confirmService(d.id, rec.id, user).then(() => toast(t('req_receivedToast'))).catch((e) => toast(err(e)))} />}
      {(modal === 'service' || modal === 'complete') && (
        <Modal
          title={modal === 'service' ? t('req_serviceDone') : t('markDone')}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button onClick={() => setModal(null)}>{t('cancel')}</Button>
              <Button type="primary" disabled={busy} onClick={() => { if (!comment.trim()) return setMErr(t('formRequired')); setMErr(''); return modal === 'service' ? run(() => supplyApi.serviceDone(d.id, comment, user), t('saved')) : run(() => api.completeEmployeeRequest(d.id, user, comment), t('rstatus_done')); }}>{t('save')}</Button>
            </>
          }
        >
          <Field label={t('doneComment')} required error={mErr}>
            <Textarea value={comment} onChange={(e) => { setComment(e.target.value); setMErr(''); }} ariaLabel={t('doneComment')} />
          </Field>
        </Modal>
      )}
    </>
  );
}
