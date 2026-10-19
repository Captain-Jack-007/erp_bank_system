// Реестр МВЗ: поиск, фильтры, пагинация на стороне API (рассчитан на 10 000+ записей, PR-GEN-007), экспорт.
import { useState } from 'react';
import { BUSINESS_SEGMENTS, orgApi, tk, type CostCenterFilter } from '@xb/shared';
import { Badge, Button, DataTable, FilterBar, Input, Pagination, Select, useToast } from '../../components/ui';
import { useCan } from '../../lib/access';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { exportTable } from '../../lib/exportTable';
import { ChangeDrawer, todayIso, useExpenseGroups, useOrgUnits } from './shared';

const REGION_CODES = Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, '0'));

export function CostCentersTab({ initialUnit }: { initialUnit: string }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const lk = useLookups();
  const allowed = useCan();
  const canEdit = allowed('master-data', 'edit');
  const canAdmin = allowed('master-data', 'admin');
  const units = useOrgUnits();
  const groups = useExpenseGroups();
  const [f, setF] = useState<CostCenterFilter>({ ...(initialUnit ? { orgUnitKey: initialUnit } : {}), status: 'active', page: 1, pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useApi(() => orgApi.listCostCenters(f), [JSON.stringify(f)]);
  const set = (patch: Partial<CostCenterFilter>) => setF((x) => ({ ...x, ...patch, page: patch.page ?? 1 }));
  const regionName = (code: string) => units.list.find((u) => u.type === 'region' && u.regionCode === code);

  async function doExport(format: 'csv' | 'xlsx') {
    const all = await orgApi.listCostCenters({ ...f, page: 1, pageSize: 100_000 });
    exportTable(
      format,
      t('md_tab_cc'),
      [{ header: t('mdf_code') }, { header: t('mdf_nameRu'), width: 50 }, { header: t('mdf_nameUz'), width: 50 }, { header: t('mdf_orgUnitKey'), width: 36 }, { header: t('mdf_cbuCode') }, { header: t('mdf_segment') }, { header: t('mdf_expenseGroupId'), width: 30 }, { header: t('mdf_responsibleId'), width: 24 }, { header: t('status') }, { header: t('mdf_validFrom') }],
      all.rows.map((c) => [c.code, c.name.ru, c.name.uz, units.label(c.orgUnitKey), c.cbuCode, t(tk('seg_', c.segment)), groups.label(c.expenseGroupId), c.responsibleId ? lk.user(c.responsibleId)?.fullName ?? c.responsibleId : '', t(tk('cc_status_', c.status)), c.validFrom]),
    );
    toast(`${t('audit_exported')}: ${all.total}`);
  }

  return (
    <>
      <FilterBar>
        <Input type="search" value={f.q ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder={`${t('search')}: ${t('cc_search_hint')}`} />
        <Select<string> value={f.regionCode ?? ''} onChange={(v) => set({ regionCode: v || undefined })} placeholder={`${t('org_region')}: ${t('all')}`} options={[{ value: '00', label: `00 · ${t('org_type_head_office')}` }, ...REGION_CODES.map((c) => ({ value: c, label: `${c} · ${regionName(c) ? loc(regionName(c)!.name) : c}` }))]} ariaLabel={t('org_region')} />
        <Select<string> value={f.orgUnitKey ?? ''} onChange={(v) => set({ orgUnitKey: v || undefined })} placeholder={`${t('org_unit')}: ${t('all')}`} options={units.options} ariaLabel={t('org_unit')} />
        <Select<string> value={f.segment ?? ''} onChange={(v) => set({ segment: (v || '') as CostCenterFilter['segment'] })} placeholder={`${t('mdf_segment')}: ${t('all')}`} options={BUSINESS_SEGMENTS.map((s) => ({ value: s, label: t(tk('seg_', s)) }))} ariaLabel={t('mdf_segment')} />
        <Select<string> value={f.expenseGroupId ?? ''} onChange={(v) => set({ expenseGroupId: v || undefined })} placeholder={`${t('mdf_expenseGroupId')}: ${t('all')}`} options={groups.options} ariaLabel={t('mdf_expenseGroupId')} />
        <Select<string> value={f.status ?? ''} onChange={(v) => set({ status: (v || '') as CostCenterFilter['status'] })} placeholder={`${t('status')}: ${t('all')}`} options={[{ value: 'active', label: t('cc_status_active') }, { value: 'closed', label: t('cc_status_closed') }]} ariaLabel={t('status')} />
        <span className="as-of">
          <span className="muted small">{t('org_as_of')}</span>
          <Input type="date" value={f.asOf ?? todayIso()} onChange={(e) => set({ asOf: e.target.value || undefined })} ariaLabel={t('org_as_of')} />
        </span>
        <div style={{ flex: 1 }} />
        <Button size="small" onClick={() => doExport('csv')}>CSV</Button>
        <Button size="small" onClick={() => doExport('xlsx')}>XLSX</Button>
        {canAdmin && (
          <Button
            size="small"
            loading={busy}
            title={t('cc_load_hint')}
            onClick={async () => {
              setBusy(true);
              const started = Date.now();
              const n = await orgApi.generateLoad(10_000, user);
              setBusy(false);
              toast(`${t('cc_load_done')}: +${n} (${Date.now() - started} ms)`);
            }}
          >
            {t('cc_load')}
          </Button>
        )}
        {canEdit && <Button type="primary" icon="plus" onClick={() => setCreating(true)}>{t('cc_new')}</Button>}
      </FilterBar>
      <DataTable
        rows={data.data?.rows}
        loading={data.loading}
        rowKey={(c) => c.key}
        onRowClick={(c) => navigate(`/master-data/cc/${c.key}`)}
        emptyText={t('search_nothing')}
        columns={[
          { header: t('mdf_code'), render: (c) => <span className="doc-num">{c.code}</span> },
          { header: t('mdf_name'), render: (c) => <><div style={{ fontWeight: 500 }}>{loc(c.name).split(' · ')[0]}</div><div className="sub">{units.label(c.orgUnitKey)}</div></> },
          { header: t('mdf_cbuCode'), render: (c) => <span className="num">{c.cbuCode}</span> },
          { header: t('mdf_segment'), render: (c) => t(tk('seg_', c.segment)) },
          { header: t('mdf_expenseGroupId'), render: (c) => <span className="small">{groups.label(c.expenseGroupId)}</span> },
          { header: t('mdf_responsibleId'), render: (c) => (c.responsibleId ? lk.user(c.responsibleId)?.fullName ?? c.responsibleId : <Badge tone="warn">{t('cc_no_responsible')}</Badge>) },
          { header: t('status'), render: (c) => <Badge tone={c.status === 'active' ? 'ok' : 'muted'}>{t(tk('cc_status_', c.status))}</Badge> },
          { header: 'v', align: 'right', render: (c) => <span className="muted small">v{c.version}</span> },
        ]}
      />
      <Pagination current={f.page ?? 1} pageSize={f.pageSize ?? 25} total={data.data?.total ?? 0} onChange={(p) => set({ page: p })} />
      {creating && <ChangeDrawer entity="cost_center" action="create" {...(f.orgUnitKey ? { defaults: { orgUnitKey: f.orgUnitKey } } : {})} onClose={() => setCreating(false)} />}
    </>
  );
}
