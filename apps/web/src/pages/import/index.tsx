// Импорт и миграция данных (PR-GEN-019/047): мастер загрузки для каждой цели, журнал загрузок, буфер MDM.
import { useState } from 'react';
import { formatDate, formatDateTime, importApi, importRegistry, orgApi, type ImportValue } from '@xb/shared';
import { Card, DataTable, PageHeader, StatusBadge, Tabs } from '../../components/ui';
import { ImportWizard } from '../../components/Import';
import { ExportButton } from '../../components/Export';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Link, useQuery, navigate } from '../../lib/router';
import type { ModuleRoute } from '../../lib/routes';

function ImportPage() {
  const { t, loc } = useSession();
  const q = useQuery();
  const lk = useLookups();
  const targets = importRegistry.list();
  const [targetId, setTargetId] = useState<string>(q.get('target') ?? targets[0]!.id);
  const target = importRegistry.get(targetId) ?? targets[0]!;
  const log = useApi(() => importApi.log(), []);
  const staged = useApi(() => importApi.staged(target.id), [target.id]);
  const showStaged = target.id === 'items';
  const mdm = useApi(() => (target.id === 'cost_centers' ? orgApi.listChanges() : Promise.resolve([])), [target.id]);
  const imported = (mdm.data ?? []).filter((c) => c.entity === 'cost_center' && c.reason.startsWith('Импорт'));

  const cell = (v: ImportValue | undefined) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? t('svc_yes') : t('svc_no')) : String(v));

  return (
    <>
      <PageHeader title={t('svc_importTitle')} subtitle={t('svc_importSubtitle')} />
      <Tabs
        value={target.id}
        onChange={(v) => {
          setTargetId(v);
          navigate(`/import?target=${v}`);
        }}
        items={targets.map((x) => ({ value: x.id, label: loc(x.name) }))}
      />
      <ImportWizard key={target.id} target={target} />

      {showStaged && (
        <Card title={`${t('svc_importStaged')} · ${staged.data?.length ?? 0}`} flush>
          <DataTable
            rows={staged.data}
            loading={staged.loading}
            rowKey={(r) => String(r[target.keyField ?? target.fields[0]!.key])}
            columns={target.fields.map((f) => ({ header: loc(f.label), render: (r: Record<string, ImportValue>) => cell(r[f.key]) }))}
          />
        </Card>
      )}

      {target.id === 'cost_centers' && (
        <Card title={`${t('svc_importPending')} · ${imported.filter((c) => c.status === 'pending').length}`} flush actions={<Link to="/master-data" className="btn btn-sm">{t('svc_navMasterData')}</Link>}>
          <DataTable
            rows={imported}
            loading={mdm.loading}
            rowKey={(c) => c.id}
            emptyText={t('svc_importPendingHint')}
            columns={[
              { header: '№', render: (c) => <span className="doc-num">{c.number}</span> },
              { header: loc(target.fields[0]!.label), render: (c) => <span className="svc-mono">{String(c.payload.code ?? '')}</span> },
              { header: loc(target.fields.find((f) => f.key === 'validFrom')?.label ?? { ru: '', uz: '' }), render: (c) => formatDate(c.effectiveFrom) },
              { header: t('svc_intStatus'), render: (c) => <StatusBadge prefix="svc_mdm_" status={c.status} /> },
            ]}
          />
        </Card>
      )}

      <Card
        title={t('svc_importHistory')}
        flush
        actions={
          <ExportButton
            filename={t('svc_importHistory')}
            rows={log.data ?? []}
            columns={[
              { header: t('svc_intTime'), value: (r) => r.at, format: 'datetime' },
              { header: t('svc_importTarget'), value: (r) => loc(importRegistry.get(r.targetId)?.name ?? { ru: r.targetId, uz: r.targetId }) },
              { header: t('svc_importFile'), value: (r) => r.fileName },
              { header: t('svc_importRows'), value: (r) => r.total, format: 'integer' },
              { header: t('svc_importCreated'), value: (r) => r.created, format: 'integer', total: true },
              { header: t('svc_importUpdated'), value: (r) => r.updated, format: 'integer', total: true },
              { header: t('svc_importInvalid'), value: (r) => r.errors, format: 'integer', total: true },
            ]}
          />
        }
      >
        <DataTable
          rows={log.data}
          loading={log.loading}
          rowKey={(r) => r.id}
          columns={[
            { header: t('svc_intTime'), render: (r) => <span className="num">{formatDateTime(r.at)}</span> },
            { header: t('svc_importTarget'), render: (r) => loc(importRegistry.get(r.targetId)?.name ?? { ru: r.targetId, uz: r.targetId }) },
            { header: t('svc_importFile'), render: (r) => r.fileName },
            { header: t('svc_importCreated'), render: (r) => r.created, align: 'right' },
            { header: t('svc_importUpdated'), render: (r) => r.updated, align: 'right' },
            { header: t('svc_importSkipped'), render: (r) => r.skipped, align: 'right' },
            { header: t('svc_importInvalid'), render: (r) => r.errors, align: 'right' },
            { header: '', render: (r) => <span className="muted small">{lk.user(r.userId)?.fullName ?? r.userId}</span> },
          ]}
        />
      </Card>
    </>
  );
}

export const routes: ModuleRoute[] = [{ path: '/import', render: () => <ImportPage /> }];
