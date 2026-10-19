// P3-GEN: мониторинг и диагностика (ТЗ PR-GEN-059/060/061, PR-SEC-010/027): состояние компонентов с порогами,
// инциденты Service Desk с уведомлением дежурного, технический журнал (ошибки, сбои, события безопасности),
// диагностический отчёт. Доступ — техподдержка, аудитор (просмотр), администратор.
import { useEffect, useState } from 'react';
import { formatDateTime, monitoringApi, techLogApi, tk, type ComponentHealth, type MonitoringThresholds, type TechLevel, type TechLogEntry, type TechSource, type TKey } from '@xb/shared';
import { Badge, Button, Card, DataTable, Field, FilterBar, Input, Loading, PageHeader, Select, Stat, Tabs, useToast } from '../../components/ui';
import { downloadBytes, safeFilename } from '../../components/download';
import { exportXlsx } from '../../components/Export';
import { useCan } from '../../lib/access';
import { useQuery } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';

type Tab = 'health' | 'incidents' | 'log' | 'thresholds';
const TONE: Record<ComponentHealth['status'], 'ok' | 'warn' | 'danger'> = { ok: 'ok', warning: 'warn', critical: 'danger', down: 'danger' };
const LEVEL_TONE: Record<TechLevel, 'danger' | 'warn' | 'info' | 'muted'> = { error: 'danger', warning: 'warn', security: 'info', info: 'muted' };

export function MonitoringPage() {
  const { t } = useSession();
  const query = useQuery();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(() => (['health', 'incidents', 'log', 'thresholds'].includes(query.get('tab') ?? '') ? (query.get('tab') as Tab) : 'health'));
  const health = useApi(() => monitoringApi.health());
  const incidents = useApi(() => monitoringApi.incidents());
  const comps = health.data ?? [];
  const open = (incidents.data ?? []).filter((i) => i.status === 'open');

  async function report() {
    const r = await monitoringApi.diagnosticReport();
    downloadBytes(safeFilename(t('mon_report_file'), 'json'), 'application/json', JSON.stringify(r, null, 2));
    exportXlsx(t('mon_report_file'), [
      { name: t('mon_tab_health').slice(0, 31), title: `${t('mon_report_file')} · ${formatDateTime(r.generatedAt)}`, columns: [{ header: t('mon_component'), width: 36 }, { header: t('status') }, { header: t('mon_value'), width: 36 }, { header: t('mon_threshold'), width: 24 }], rows: r.components.map((c) => [c.name.ru, c.status, c.value, c.threshold]) },
      { name: t('mon_tab_incidents').slice(0, 31), columns: [{ header: 'ID' }, { header: t('mon_component'), width: 40 }, { header: t('status') }, { header: t('mon_opened'), width: 20 }, { header: t('mon_resolved'), width: 20 }], rows: r.incidents.map((i) => [i.id, i.title, i.status, i.openedAt, i.resolvedAt ?? '']) },
      { name: t('mon_tab_log').slice(0, 31), columns: [{ header: 'ID' }, { header: t('audit_time'), width: 20 }, { header: t('mon_level') }, { header: t('mon_source') }, { header: t('mon_message'), width: 60 }, { header: t('audit_details'), width: 40 }], rows: r.techLog.map((e) => [e.id, e.at, e.level, e.source, e.message, e.details ?? '']) },
    ]);
    toast(t('mon_report_done'));
  }

  return (
    <>
      <PageHeader
        title={t('mon_title')}
        subtitle={`${t('tzLabel')} PR-GEN-059…061, PR-SEC-027 · ${t('mon_subtitle')}`}
        actions={
          <>
            <Button
              icon="refresh"
              className="mon-scan-btn"
              onClick={async () => {
                const r = await monitoringApi.scan();
                toast(`${t('mon_scanned')}: +${r.opened} / −${r.resolved}`);
              }}
            >
              {t('mon_scan')}
            </Button>
            <Button type="primary" icon="download" onClick={report} className="mon-report-btn">{t('mon_report')}</Button>
          </>
        }
      />
      <div className={`banner ${open.length ? 'danger' : 'info'} mon-mode`}>
        <b>{t('mon_mode')}:</b> {open.length ? t('mon_mode_emergency') : t('mon_mode_normal')}
        <span className="muted"> · {t('mon_mode_hint')}</span>
      </div>
      <div className="grid grid-4">
        <Stat label={t('mon_components')} value={comps.length || '…'} icon="sitemap" />
        <Stat label={t('mon_ok')} value={comps.filter((c) => c.status === 'ok').length} tone="accent" icon="check" />
        <Stat label={t('mon_problems')} value={comps.filter((c) => c.status !== 'ok').length} tone={comps.some((c) => c.status === 'down' || c.status === 'critical') ? 'alert' : undefined} icon="alert" />
        <Stat label={t('mon_open_incidents')} value={open.length} tone={open.length ? 'alert' : undefined} icon="bell" />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={(v) => {
            setTab(v);
            window.history.replaceState(null, '', `#/monitoring?tab=${v}`);
          }}
          items={[
            { value: 'health', label: t('mon_tab_health') },
            { value: 'incidents', label: t('mon_tab_incidents'), count: open.length },
            { value: 'log', label: t('mon_tab_log') },
            { value: 'thresholds', label: t('mon_tab_thresholds') },
          ]}
        />
        {tab === 'health' && (
          <DataTable
            rows={health.data}
            loading={health.loading}
            rowKey={(c) => c.id}
            columns={[
              { header: t('mon_component'), render: (c) => <><div style={{ fontWeight: 600 }}><LocName v={c.name} /></div><div className="sub">{t(tk('mon_kind_', c.kind))}</div></> },
              { header: t('status'), render: (c) => <span data-comp={c.id} data-status={c.status}><Badge tone={TONE[c.status]}>{t(tk('mon_status_', c.status))}</Badge></span> },
              { header: t('mon_value'), render: (c) => <span className="num small">{c.value}</span> },
              { header: t('mon_threshold'), render: (c) => <span className="muted small">{c.threshold}</span> },
            ]}
          />
        )}
        {tab === 'incidents' && (
          <DataTable
            rows={incidents.data}
            loading={incidents.loading}
            rowKey={(i) => i.id}
            emptyText={t('mon_no_incidents')}
            columns={[
              { header: t('mon_incident'), render: (i) => <><span className="doc-num">{i.id}</span><div className="sub">Service Desk</div></> },
              { header: t('mon_component'), render: (i) => i.title },
              { header: t('status'), render: (i) => <Badge tone={i.status === 'open' ? 'danger' : 'ok'}>{t(tk('mon_inc_', i.status))}</Badge> },
              { header: t('mon_opened'), render: (i) => <><div className="num small">{formatDateTime(i.openedAt)}</div><div className="sub">{t('mon_notified')}: {formatDateTime(i.notifiedAt)}</div></> },
              { header: t('mon_resolved'), render: (i) => <span className="num small">{i.resolvedAt ? formatDateTime(i.resolvedAt) : '—'}</span> },
            ]}
          />
        )}
        {tab === 'log' && <TechLog />}
        {tab === 'thresholds' && <Thresholds />}
      </Card>
    </>
  );
}

function LocName({ v }: { v: { ru: string; uz: string; en?: string } }) {
  const { loc } = useSession();
  return <>{loc(v)}</>;
}

function TechLog() {
  const { t } = useSession();
  const [level, setLevel] = useState<TechLevel | ''>('');
  const [source, setSource] = useState<TechSource | ''>('');
  const [q, setQ] = useState('');
  const log = useApi(() => techLogApi.list({ level, source, q }), [level, source, q]);
  const tr = (prefix: string, code: string) => {
    const k = tk(prefix, code);
    const v = t(k as TKey);
    return v === k ? null : v;
  };
  const message = (e: TechLogEntry) => {
    if (e.code?.startsWith('audit:')) return `${tr('audit_action_', e.code.slice(6)) ?? e.code.slice(6)}${e.system ? ` · ${e.system}` : ''}`;
    if (e.source === 'integration' && e.code) return `${e.system}: ${e.code === 'retry_ok' ? t('mon_retry_ok') : tr('svc_err_', e.code) ?? tr('svc_status_', e.code) ?? e.code}`;
    return e.message;
  };
  return (
    <>
      <FilterBar>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}…`} />
        <Select<string> value={level} onChange={(v) => setLevel(v as TechLevel | '')} placeholder={`${t('mon_level')}: ${t('all')}`} options={(['error', 'warning', 'security', 'info'] as const).map((l) => ({ value: l, label: t(tk('mon_level_', l)) }))} ariaLabel={t('mon_level')} />
        <Select<string> value={source} onChange={(v) => setSource(v as TechSource | '')} placeholder={`${t('mon_source')}: ${t('all')}`} options={(['app', 'integration', 'security', 'monitoring'] as const).map((s) => ({ value: s, label: t(tk('mon_source_', s)) }))} ariaLabel={t('mon_source')} />
      </FilterBar>
      <DataTable
        rows={log.data}
        loading={log.loading}
        rowKey={(e) => `${e.source}:${e.id}`}
        emptyText={t('search_nothing')}
        columns={[
          { header: t('audit_time'), render: (e) => <><div className="num small">{formatDateTime(e.at)}</div><div className="sub doc-num tech-id">{e.id}</div></>, width: 150 },
          { header: t('mon_level'), render: (e) => <><Badge tone={LEVEL_TONE[e.level]}>{t(tk('mon_level_', e.level))}</Badge><div className="sub">{t(tk('mon_source_', e.source))}</div></> },
          { header: t('mon_message'), render: (e) => <><div className="small tech-msg">{message(e)}</div>{e.details && <div className="sub">{e.details}</div>}</> },
          { header: t('audit_user'), render: (e) => <><div className="small">{e.userName ?? '—'}</div>{e.siem && <div className="sub">SIEM ✓</div>}</> },
        ]}
      />
    </>
  );
}

function Thresholds() {
  const { t } = useSession();
  const toast = useToast();
  const canEdit = useCan()('monitoring', 'edit');
  const saved = useApi(() => monitoringApi.getThresholds());
  const [v, setV] = useState<MonitoringThresholds | null>(null);
  useEffect(() => {
    if (saved.data && !v) setV(saved.data);
  }, [saved.data, v]);
  if (!v) return <Loading />;
  const num = (s: string) => Math.max(0, Math.floor(Number(s.replace(/\D/g, '')) || 0));
  const keys = Object.keys(v) as (keyof MonitoringThresholds)[];
  return (
    <div style={{ padding: 14 }}>
      <div className="form-grid">
        {keys.map((k) => (
          <Field key={k} label={t(tk('mon_th_', k))}>
            <Input value={v[k]} onChange={(e) => setV({ ...v, [k]: num(e.target.value) })} inputMode="numeric" disabled={!canEdit} ariaLabel={t(tk('mon_th_', k))} />
          </Field>
        ))}
      </div>
      {canEdit && (
        <Button
          type="primary"
          onClick={async () => {
            await monitoringApi.setThresholds(v);
            await monitoringApi.scan();
            toast(t('saved'));
          }}
        >
          {t('save')}
        </Button>
      )}
    </div>
  );
}
