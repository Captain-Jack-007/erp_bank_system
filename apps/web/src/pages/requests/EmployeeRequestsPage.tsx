// Модуль заявок сотрудников (ТЗ 4.2.7): заявки на обеспечение материалами, оборудованием и услугами со склада.
import { useState } from 'react';
import { formatDateTime, formatMoney, supplyApi, tk, type EmployeeRequestStatus, type EmployeeRequestType } from '@xb/shared';
import { Button, Card, DataTable, FilterBar, Input, PageHeader, Select, StatusBadge } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Segmented } from '../../components/flow';
import { navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import '../procurement/proc.css';

export const REQ_TYPES: EmployeeRequestType[] = ['stationery', 'household', 'equipment', 'it', 'service'];
const STATUSES: EmployeeRequestStatus[] = ['draft', 'pending', 'returned', 'warehouse', 'reserved', 'in_progress', 'issued', 'done', 'rejected'];
type Scope = 'mine' | 'department' | 'warehouse' | 'all';

export function EmployeeRequestsPage() {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const lk = useLookups();
  const isStore = user.role === 'storekeeper' || user.role === 'admin' || can('warehouse', 'edit');
  const approver = can('requests', 'approve');
  const [scope, setScope] = useState<Scope>(isStore && user.role !== 'admin' ? 'warehouse' : approver ? 'department' : 'mine');
  const [type, setType] = useState<EmployeeRequestType | ''>('');
  const [status, setStatus] = useState<EmployeeRequestStatus | ''>('');
  const [q, setQ] = useState('');
  const list = useApi(() => supplyApi.list(user, { scope, ...(type ? { type } : {}), ...(status ? { status } : {}), q }), [user.id, scope, type, status, q]);
  const scopes: { value: Scope; label: string }[] = [
    { value: 'mine', label: t('req_scope_mine') },
    ...(approver ? [{ value: 'department' as const, label: t('req_scope_department') }] : []),
    ...(isStore ? [{ value: 'warehouse' as const, label: t('req_scope_warehouse') }] : []),
    ...(approver || isStore ? [{ value: 'all' as const, label: t('req_scope_all') }] : []),
  ];
  return (
    <>
      <PageHeader
        title={t('requestsTitle')}
        subtitle={`${t('tzLabel')} 4.2.7 · ${t('req_subtitle')}`}
        actions={
          can('requests', 'edit') ? (
            <Button type="primary" icon="plus" onClick={() => navigate('/requests/new')}>
              {t('newRequest')}
            </Button>
          ) : undefined
        }
      />
      <Card flush>
        <div className="pc-pad">
          <Segmented value={scope} onChange={setScope} options={scopes} />
        </div>
        <FilterBar>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}: ${t('number')}`} />
          <Select<EmployeeRequestType | ''> value={type} onChange={setType} ariaLabel={t('requestType')} options={[{ value: '', label: `${t('requestType')}: ${t('all')}` }, ...REQ_TYPES.map((x) => ({ value: x, label: t(tk('rtype_', x)) }))]} />
          <Select<EmployeeRequestStatus | ''> value={status} onChange={setStatus} ariaLabel={t('status')} options={[{ value: '', label: `${t('status')}: ${t('all')}` }, ...STATUSES.map((s) => ({ value: s, label: t(tk('rstatus_', s)) }))]} />
          <ExportButton
            filename={t('requestsTitle')}
            rows={list.data ?? []}
            columns={[
              { header: t('number'), value: (r) => r.number },
              { header: t('requestType'), value: (r) => t(tk('rtype_', r.type)) },
              { header: t('description'), value: (r) => r.description },
              { header: t('initiator'), value: (r) => lk.user(r.initiatorId)?.fullName ?? '' },
              { header: t('amount'), value: (r) => r.amount ?? 0, format: 'money', total: true },
              { header: t('date'), value: (r) => r.createdAt.slice(0, 10) },
              { header: t('status'), value: (r) => t(tk('rstatus_', r.status)) },
            ]}
          />
        </FilterBar>
        <DataTable
          rows={list.data}
          loading={list.loading}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/requests/${r.id}`)}
          columns={[
            { header: t('number'), render: (r) => <span className="doc-num">{r.number}</span> },
            { header: t('requestType'), render: (r) => t(tk('rtype_', r.type)) },
            { header: t('description'), render: (r) => <>{r.description}{r.items?.length ? <div className="sub">{r.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}</div> : null}</> },
            { header: t('initiator'), render: (r) => lk.user(r.initiatorId)?.fullName },
            { header: t('amount'), align: 'right', render: (r) => (r.amount ? formatMoney(r.amount) : '—') },
            { header: t('date'), render: (r) => <span className="num muted">{formatDateTime(r.createdAt)}</span> },
            { header: t('status'), render: (r) => <StatusBadge prefix="rstatus_" status={r.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
