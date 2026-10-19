// Карточки оргединицы и МВЗ: атрибуты, история версий (SCD Type 2), пополевая история изменений,
// заявки на изменение/закрытие.
import { useState } from 'react';
import { formatDate, formatDateTime, orgApi, tk, type CostCenter, type OrgUnit } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Loading, PageHeader } from '../../components/ui';
import { FieldHistory } from '../../components/FieldHistory';
import { useCan } from '../../lib/access';
import { Link } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { ChangeDrawer, OrgTypeBadge, useExpenseGroups, useFieldLabel, useOrgUnits } from './shared';

function VersionPeriod({ from, to }: { from: string; to: string | null }) {
  const { t } = useSession();
  return (
    <span className="num">
      {formatDate(from)} — {to ? formatDate(to) : <Badge tone="ok">{t('scd_current')}</Badge>}
    </span>
  );
}

export function OrgUnitDetailPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const lk = useLookups();
  const allowed = useCan();
  const label = useFieldLabel();
  const canEdit = allowed('master-data', 'edit');
  const history = useApi(() => orgApi.orgUnitHistory(id), [id]);
  const units = useOrgUnits();
  const ccs = useApi(() => orgApi.listCostCenters({ orgUnitKey: id, pageSize: 10, status: 'active' }), [id]);
  const pending = useApi(() => orgApi.listChanges({ status: 'pending' }));
  const [drawer, setDrawer] = useState<'update' | 'close' | null>(null);
  if (history.loading && !history.data) return <Loading />;
  const versions = history.data ?? [];
  const cur = versions.find((v) => v.validTo === null) ?? versions[0];
  if (!cur) return <Empty text="404" />;
  const closed = cur.validTo !== null;
  const kids = units.list.filter((u) => u.parentKey === id);
  const hasPending = pending.data?.some((c) => c.targetKey === id);
  return (
    <>
      <PageHeader
        title={loc(cur.name)}
        subtitle={`${cur.code} · ${t(tk('org_type_', cur.type))}`}
        crumbs={[{ label: t('masterTitle'), to: '/master-data?tab=org' }, { label: t('md_tab_org'), to: '/master-data?tab=org' }, { label: cur.code }]}
        actions={
          canEdit && !closed && cur.type !== 'head_office' && (
            <>
              <Button onClick={() => setDrawer('update')} disabled={hasPending}>{t('mdm_action_update')}</Button>
              <Button danger onClick={() => setDrawer('close')} disabled={hasPending}>{t('mdm_action_close')}</Button>
            </>
          )
        }
      />
      {closed && <div className="banner warn">{t('scd_closed_on').replace('{date}', formatDate(cur.validTo!))}</div>}
      {hasPending && <div className="banner info">{t('mdm_pending_exists')} <Link to="/master-data?tab=changes">{t('md_tab_changes')}</Link></div>}
      <div className="grid grid-main">
        <Card title={t('md_attributes')}>
          <dl className="kv">
            <dt>{label('code')}</dt>
            <dd className="doc-num">{cur.code}</dd>
            <dt>{label('type')}</dt>
            <dd><OrgTypeBadge type={cur.type} /></dd>
            <dt>{label('nameRu')}</dt>
            <dd>{cur.name.ru}</dd>
            <dt>{label('nameUz')}</dt>
            <dd>{cur.name.uz}</dd>
            <dt>{label('parentKey')}</dt>
            <dd>{cur.parentKey ? <Link to={`/master-data/org/${cur.parentKey}`}>{units.label(cur.parentKey)}</Link> : '—'}</dd>
            <dt>{t('org_region')}</dt>
            <dd className="num">{cur.regionCode}</dd>
            <dt>{label('cbuCode')}</dt>
            <dd className="num">{cur.cbuCode ?? '—'}</dd>
            <dt>{label('headUserId')}</dt>
            <dd>{cur.headUserId ? lk.user(cur.headUserId)?.fullName ?? cur.headUserId : '—'}</dd>
            <dt>{label('address')}</dt>
            <dd>{cur.address ?? '—'}</dd>
            <dt>{t('scd_valid')}</dt>
            <dd><VersionPeriod from={cur.validFrom} to={cur.validTo} /></dd>
          </dl>
        </Card>
        <Card title={`${t('org_children')} · ${kids.length}`} actions={<Link to={`/master-data?tab=cc&unit=${id}`} className="btn btn-sm">{t('md_tab_cc')}: {ccs.data?.total ?? '…'}</Link>}>
          {!kids.length ? (
            <span className="muted small">{t('org_no_children')}</span>
          ) : (
            <ul className="cat-list">
              {kids.map((k) => (
                <li key={k.key}><Link to={`/master-data/org/${k.key}`}>{loc(k.name)}</Link> <span className="muted small">· {k.code}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title={`${t('scd_versions')} (SCD Type 2)`} flush>
        <DataTable
          rows={versions}
          rowKey={(v) => v.id}
          columns={[
            { header: 'v', render: (v) => <b>v{v.version}</b>, width: 50 },
            { header: t('scd_valid'), render: (v) => <VersionPeriod from={v.validFrom} to={v.validTo} /> },
            { header: label('nameRu'), render: (v) => loc(v.name) },
            { header: label('parentKey'), render: (v) => v.parentKey ?? '—' },
            { header: t('mdm_reason'), render: (v) => <span className="small">{v.changeReason}</span> },
            { header: t('scd_changed_by'), render: (v) => <span className="small">{lk.user(v.changedBy)?.fullName ?? v.changedBy} · {formatDateTime(v.changedAt)}</span> },
          ]}
        />
      </Card>
      <Card title={t('audit_history')}>
        <FieldHistory entity="org_unit" entityId={id} fieldLabel={label} />
      </Card>
      {drawer && <ChangeDrawer entity="org_unit" action={drawer} target={cur as OrgUnit} onClose={() => setDrawer(null)} />}
    </>
  );
}

export function CostCenterDetailPage({ id }: { id: string }) {
  const { t, loc } = useSession();
  const lk = useLookups();
  const allowed = useCan();
  const label = useFieldLabel();
  const canEdit = allowed('master-data', 'edit');
  const data = useApi(() => orgApi.getCostCenter(id), [id]);
  const units = useOrgUnits();
  const groups = useExpenseGroups();
  const pending = useApi(() => orgApi.listChanges({ status: 'pending' }));
  const [drawer, setDrawer] = useState<'update' | 'close' | null>(null);
  if (data.loading && !data.data) return <Loading />;
  const cur = data.data?.current;
  if (!cur) return <Empty text="404" />;
  const versions = data.data?.versions ?? [];
  const editable = cur.validTo === null && cur.status === 'active';
  const hasPending = pending.data?.some((c) => c.targetKey === id);
  return (
    <>
      <PageHeader
        title={`${cur.code} · ${loc(cur.name).split(' · ')[0]}`}
        subtitle={units.label(cur.orgUnitKey)}
        crumbs={[{ label: t('masterTitle'), to: '/master-data?tab=cc' }, { label: t('md_tab_cc'), to: '/master-data?tab=cc' }, { label: cur.code }]}
        actions={
          canEdit && editable && (
            <>
              <Button onClick={() => setDrawer('update')} disabled={hasPending}>{t('mdm_action_update')}</Button>
              <Button danger onClick={() => setDrawer('close')} disabled={hasPending}>{t('mdm_action_close')}</Button>
            </>
          )
        }
      />
      {hasPending && <div className="banner info">{t('mdm_pending_exists')} <Link to="/master-data?tab=changes">{t('md_tab_changes')}</Link></div>}
      <div className="grid grid-main">
        <Card title={t('md_attributes')}>
          <dl className="kv">
            <dt>{label('code')}</dt>
            <dd className="doc-num">{cur.code}</dd>
            <dt>{label('nameRu')}</dt>
            <dd>{cur.name.ru}</dd>
            <dt>{label('nameUz')}</dt>
            <dd>{cur.name.uz}</dd>
            <dt>{label('orgUnitKey')}</dt>
            <dd><Link to={`/master-data/org/${cur.orgUnitKey}`}>{units.label(cur.orgUnitKey)}</Link></dd>
            <dt>{label('cbuCode')}</dt>
            <dd className="num">{cur.cbuCode}</dd>
            <dt>{label('segment')}</dt>
            <dd>{t(tk('seg_', cur.segment))}</dd>
            <dt>{label('expenseGroupId')}</dt>
            <dd>{groups.label(cur.expenseGroupId)}</dd>
            <dt>{label('responsibleId')}</dt>
            <dd>{cur.responsibleId ? lk.user(cur.responsibleId)?.fullName ?? cur.responsibleId : <Badge tone="warn">{t('cc_no_responsible')}</Badge>}</dd>
            <dt>{t('status')}</dt>
            <dd><Badge tone={cur.status === 'active' ? 'ok' : 'muted'}>{t(tk('cc_status_', cur.status))}</Badge></dd>
            <dt>{t('scd_valid')}</dt>
            <dd><VersionPeriod from={cur.validFrom} to={cur.validTo} /></dd>
          </dl>
        </Card>
        <Card title={t('audit_history')}>
          <FieldHistory entity="cost_center" entityId={id} fieldLabel={label} />
        </Card>
      </div>
      <Card title={`${t('scd_versions')} (SCD Type 2)`} flush>
        <DataTable
          rows={versions}
          rowKey={(v: CostCenter) => v.id}
          columns={[
            { header: 'v', render: (v) => <b>v{v.version}</b>, width: 50 },
            { header: t('scd_valid'), render: (v) => <VersionPeriod from={v.validFrom} to={v.validTo} /> },
            { header: label('expenseGroupId'), render: (v) => <span className="small">{groups.label(v.expenseGroupId)}</span> },
            { header: label('responsibleId'), render: (v) => (v.responsibleId ? lk.user(v.responsibleId)?.fullName ?? v.responsibleId : '—') },
            { header: t('status'), render: (v) => t(tk('cc_status_', v.status)) },
            { header: t('mdm_reason'), render: (v) => <span className="small">{v.changeReason}</span> },
            { header: t('scd_changed_by'), render: (v) => <span className="small">{lk.user(v.changedBy)?.fullName ?? v.changedBy} · {formatDateTime(v.changedAt)}</span> },
          ]}
        />
      </Card>
      {drawer && <ChangeDrawer entity="cost_center" action={drawer} target={cur} onClose={() => setDrawer(null)} />}
    </>
  );
}
