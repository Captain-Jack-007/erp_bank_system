// Интеграции (ТЗ, раздел 5): статус систем, паспорт интерфейса, тестовый вызов, журнал обмена,
// очередь при недоступности (PR-GEN-004), повтор, карантин, сверка контрольных итогов (PR-INT-001/004).
import { useMemo, useState } from 'react';
import {
  formatDateTime, formatMoney, integrationHub, tk,
  type ExchangeRecord, type ExchangeSimulation, type ExchangeStatus, type IntegrationKind, type IntegrationSystem,
} from '@xb/shared';
import { Badge, Button, Card, CodeEditor, DataTable, Drawer, Empty, FilterBar, Field, Input, Modal, PageHeader, Select, Stat, StatusBadge, Switch, Tabs, Textarea, useToast, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useQuery, navigate } from '../../lib/router';
import type { ModuleRoute } from '../../lib/routes';
import { useCan } from '../../lib/access';
import { IntegrationDesigner } from './Designer'; // P4-GEN: конструктор интеграций (PR-GEN-020)

type Tab = 'systems' | 'log' | 'quarantine' | 'reconciliation' | 'designer';
const STATUS_TONE: Record<ExchangeStatus, Tone> = { pending: 'info', success: 'ok', failed: 'danger', queued: 'warn', quarantined: 'danger', discarded: 'muted' };
const STATUSES: ExchangeStatus[] = ['success', 'pending', 'failed', 'queued', 'quarantined', 'discarded'];

function useSysName() {
  const { loc } = useSession();
  return (id: string) => {
    const s = integrationHub.systems.find((x) => x.id === id);
    return s ? loc(s.name) : id;
  };
}

function useOpName() {
  const { loc } = useSession();
  return (systemId: string, op: string) => {
    const o = integrationHub.systems.find((x) => x.id === systemId)?.operations.find((x) => x.id === op);
    return o ? loc(o.name) : op;
  };
}

function ExStatus({ s }: { s: ExchangeStatus }) {
  return <StatusBadge prefix="svc_status_" status={s} tone={STATUS_TONE[s]} />;
}

// ---------- Паспорт интерфейса ----------
function PassportDrawer({ system, onClose }: { system: IntegrationSystem; onClose: () => void }) {
  const { t, loc } = useSession();
  const p = system.passport;
  const rows: [string, string][] = [
    [t('svc_pp_tz'), system.tz],
    [t('svc_pp_hosts'), system.hosts],
    [t('svc_pp_source'), p.source],
    [t('svc_pp_target'), p.target],
    [t('svc_pp_owner'), loc(p.owner)],
    [t('svc_pp_protocol'), p.protocol],
    [t('svc_pp_format'), p.format],
    [t('svc_pp_endpoint'), p.endpoint],
    [t('svc_pp_auth'), p.auth],
    [t('svc_pp_schedule'), loc(p.schedule)],
    [t('svc_pp_volume'), loc(p.volume)],
    [t('svc_pp_sla'), p.sla],
    [t('svc_pp_idempotency'), p.idempotency],
    [t('svc_pp_errorCodes'), p.errorCodes],
    [t('svc_pp_controlTotals'), loc(p.controlTotals)],
    [t('svc_intModules'), system.modules.join(', ')],
  ];
  return (
    <Drawer open title={`${t('svc_intPassport')} · ${loc(system.name)}`} onClose={onClose} footer={<Button onClick={onClose}>{t('svc_close')}</Button>}>
      <p className="muted" style={{ margin: 0 }}>{loc(system.purpose)}</p>
      <dl className="svc-kv">
        {rows.map(([k, v]) => (
          <span key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </span>
        ))}
      </dl>
      <Card title={t('svc_intOperation')} flush>
        <DataTable
          rows={system.operations}
          rowKey={(o) => o.id}
          columns={[
            { header: 'ID', render: (o) => <span className="svc-mono">{o.id}</span> },
            { header: t('svc_intOperation'), render: (o) => loc(o.name) },
            { header: '', render: (o) => t(tk('svc_intDirection_', o.direction)) },
            { header: t('svc_intSchema'), render: (o) => `v${o.schemaVersion}` },
          ]}
        />
      </Card>
    </Drawer>
  );
}

// ---------- Тестовый вызов ----------
function TestCallDrawer({ system, onClose, onOpenRecord }: { system: IntegrationSystem; onClose: () => void; onOpenRecord: (id: string) => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const [opId, setOpId] = useState(system.operations[0]!.id);
  const op = system.operations.find((o) => o.id === opId)!;
  const [payload, setPayload] = useState(() => JSON.stringify(system.operations[0]!.sample(), null, 2));
  const [scenario, setScenario] = useState<ExchangeSimulation>('normal');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ExchangeRecord | null>(null);

  async function send() {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(payload) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('obj');
    } catch {
      setError(t('svc_intBadJson'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      const rec = await integrationHub.call(system.id, opId, body, { userId: user.id, simulate: scenario, ...(key.trim() ? { idempotencyKey: key.trim() } : {}) });
      setLast(rec);
      if (!key.trim()) setKey(rec.idempotencyKey);
      toast(rec.status === 'queued' ? t('svc_intQueued') : t('svc_intSent'));
    } catch {
      setError(t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      width={560}
      title={`${t('svc_intTest')} · ${loc(system.name)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('svc_close')}</Button>
          <Button type="primary" icon="plug" loading={busy} onClick={send}>
            {t('svc_intSend')}
          </Button>
        </>
      }
    >
      <Field label={t('svc_intOperation')}>
        <Select
          value={opId}
          ariaLabel={t('svc_intOperation')}
          onChange={(v) => {
            setOpId(v);
            const o = system.operations.find((x) => x.id === v)!;
            setPayload(JSON.stringify(o.sample(), null, 2));
            setKey('');
            setLast(null);
          }}
          options={system.operations.map((o) => ({ value: o.id, label: `${loc(o.name)} (${o.id})` }))}
        />
      </Field>
      <Field label={t('svc_intScenario')}>
        <Select<ExchangeSimulation>
          value={scenario}
          ariaLabel={t('svc_intScenario')}
          onChange={setScenario}
          options={(['normal', 'transient', 'permanent', 'invalid'] as ExchangeSimulation[]).map((s) => ({ value: s, label: t(tk('svc_intScenario_', s)) }))}
        />
      </Field>
      <Field label={t('svc_intIdemKey')} hint={t('svc_intIdemHint')}>
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="UUID" ariaLabel={t('svc_intIdemKey')} />
      </Field>
      <Field label={`${t('svc_intPayload')} · v${op.schemaVersion}`} error={error}>
        <CodeEditor value={payload} onChange={setPayload} ariaLabel={t('svc_intPayload')} />
      </Field>
      {last && (
        <div className="svc-sig" data-testid="test-result" data-status={last.status}>
          <div className="svc-sig-head">
            <span className="svc-mono">{last.id}</span>
            <ExStatus s={last.status} />
          </div>
          <div className="small muted">
            {t('svc_intAttempts')}: {last.attempts.length}
            {last.duplicates > 0 && ` · ${t('svc_intDuplicates')}: ${last.duplicates}`}
            {last.error && ` · ${t(tk('svc_err_', last.error))}`}
          </div>
          <div>
            <Button size="small" type="link" onClick={() => onOpenRecord(last.id)}>
              {t('svc_intDetails')}
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ---------- Детали обмена ----------
function RecordDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const sysName = useSysName();
  const opName = useOpName();
  const rec = useApi(() => integrationHub.getExchange(id), [id]);
  const canEdit = useCan()('integrations', 'edit');
  const [editing, setEditing] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const r = rec.data;

  async function retry(payload?: Record<string, unknown>) {
    if (!r) return;
    setBusy(true);
    try {
      const res = await integrationHub.retry(r.id, user.id, payload);
      toast(res.status === 'queued' ? t('svc_intQueued') : t('svc_intSent'));
      setEditing(null);
    } catch {
      toast(t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      width={600}
      title={`${t('svc_intDetails')} · ${id}`}
      onClose={onClose}
      footer={
        r && (
          <>
            {canEdit && (r.status === 'failed' || r.status === 'queued') && (
              <Button icon="refresh" loading={busy} onClick={() => retry()}>
                {t('svc_intRetry')}
              </Button>
            )}
            {canEdit && r.status === 'quarantined' && editing === null && (
              <Button icon="pen" onClick={() => setEditing(JSON.stringify(r.payload, null, 2))}>
                {t('svc_intRelease')}
              </Button>
            )}
            {editing !== null && (
              <Button
                type="primary"
                loading={busy}
                onClick={() => {
                  try {
                    const p = JSON.parse(editing) as Record<string, unknown>;
                    setJsonError('');
                    void retry(p);
                  } catch {
                    setJsonError(t('svc_intBadJson'));
                  }
                }}
              >
                {t('svc_intSend')}
              </Button>
            )}
            {canEdit && (r.status === 'quarantined' || r.status === 'failed') && (
              <Button danger onClick={() => setDiscard(true)}>
                {t('svc_intDiscard')}
              </Button>
            )}
            <Button onClick={onClose}>{t('svc_close')}</Button>
          </>
        )
      }
    >
      {!r ? null : (
        <>
          <div className="svc-spread">
            <ExStatus s={r.status} />
            <span className="small muted">{formatDateTime(r.createdAt)}</span>
          </div>
          <dl className="svc-kv">
            <dt>{t('svc_intSystem')}</dt>
            <dd>{sysName(r.systemId)}</dd>
            <dt>{t('svc_intOperation')}</dt>
            <dd>
              {opName(r.systemId, r.operation)} <span className="svc-mono">({r.operation}, v{r.schemaVersion})</span>
            </dd>
            <dt>{t('svc_intIdemKey')}</dt>
            <dd className="svc-mono">{r.idempotencyKey}</dd>
            {r.amount !== undefined && (
              <>
                <dt>{t('svc_intAmount')}</dt>
                <dd>{formatMoney(r.amount)}</dd>
              </>
            )}
            {r.error && (
              <>
                <dt>{t('svc_intError')}</dt>
                <dd style={{ color: 'var(--danger)' }}>
                  {t(tk('svc_err_', r.error))}
                  {r.errorMessage ? ` — ${r.errorMessage}` : ''}
                </dd>
              </>
            )}
            {r.duplicates > 0 && (
              <>
                <dt>{t('svc_intDuplicates')}</dt>
                <dd>{r.duplicates}</dd>
              </>
            )}
            {r.note && (
              <>
                <dt>{t('svc_intStatus')}</dt>
                <dd>{r.note === 'replayed' || r.note === 'released' ? t(tk('svc_intNote_', r.note)) : r.note}</dd>
              </>
            )}
          </dl>
          <Field label={t('svc_intPayload')} error={jsonError}>
            {editing !== null ? (
              <CodeEditor value={editing} onChange={setEditing} ariaLabel={t('svc_intPayload')} />
            ) : (
              <pre className="svc-pre">{JSON.stringify(r.payload, null, 2)}</pre>
            )}
          </Field>
          {r.response && (
            <Field label={t('svc_intResponse')}>
              <pre className="svc-pre">{JSON.stringify(r.response, null, 2)}</pre>
            </Field>
          )}
          <Field label={`${t('svc_intAttempts')} · ${r.attempts.length}`}>
            {r.attempts.length ? (
              <ul className="svc-attempts">
                {r.attempts.map((a) => (
                  <li key={a.n}>
                    <Badge tone={a.ok ? 'ok' : 'danger'}>#{a.n}</Badge>
                    <span className="num">{formatDateTime(a.at)}</span>
                    <span className="muted">{a.ms} ms</span>
                    {a.error && <span style={{ color: 'var(--danger)' }}>{t(tk('svc_err_', a.error))}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">—</span>
            )}
          </Field>
        </>
      )}
      {discard && r && (
        <Modal
          title={t('svc_intDiscard')}
          onClose={() => setDiscard(false)}
          footer={
            <>
              <Button onClick={() => setDiscard(false)}>{t('cancel')}</Button>
              <Button
                danger
                disabled={!reason.trim()}
                onClick={async () => {
                  await integrationHub.discard(r.id, user.id, reason.trim());
                  setDiscard(false);
                  toast(t('svc_status_discarded'));
                }}
              >
                {t('svc_intDiscard')}
              </Button>
            </>
          }
        >
          <Field label={t('svc_intDiscardReason')} required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} ariaLabel={t('svc_intDiscardReason')} />
          </Field>
        </Modal>
      )}
    </Drawer>
  );
}

// ---------- Вкладки ----------
function SystemsTab({ onOpenRecord }: { onOpenRecord: (id: string) => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const systems = useApi(() => integrationHub.listSystems(), []);
  const canEdit = useCan()('integrations', 'edit');
  const [kind, setKind] = useState<IntegrationKind | ''>('');
  const [passport, setPassport] = useState<IntegrationSystem | null>(null);
  const [test, setTest] = useState<IntegrationSystem | null>(null);
  const rows = (systems.data ?? []).filter((s) => !kind || s.system.kind === kind);
  return (
    <Card flush>
      <FilterBar>
        <Select<IntegrationKind | ''>
          value={kind}
          onChange={setKind}
          ariaLabel={t('svc_intSystems')}
          options={[{ value: '', label: t('svc_intAll') }, { value: 'external', label: t('svc_intExternal') }, { value: 'internal', label: t('svc_intInternal') }]}
        />
      </FilterBar>
      <DataTable
        rows={rows}
        loading={systems.loading}
        rowKey={(s) => s.id}
        columns={[
          {
            header: t('svc_intSystem'),
            render: (s) => (
              <div data-testid={`sys-${s.id}`} data-up={s.up ? '1' : '0'}>
                <div className="svc-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <span className={`svc-dot ${s.up ? '' : 'down'}`} />
                  <span className="svc-sys-name">{loc(s.system.name)}</span>
                </div>
                <div className="svc-sys-sub">
                  {s.system.tz} · {s.system.hosts}
                </div>
              </div>
            ),
          },
          { header: t('svc_intStatus'), render: (s) => (s.system.disabled ? <Badge tone="muted">{t('p4g_int_off')}</Badge> : <Badge tone={s.up ? 'ok' : 'danger'}>{s.up ? t('svc_intUp') : t('svc_intDown')}</Badge>) },
          { header: t('svc_intQueue'), render: (s) => <span className="num" data-testid={`queue-${s.id}`}>{s.queued}</span>, align: 'right' },
          { header: t('svc_intSuccessRate'), render: (s) => `${Math.round(s.successRate * 100)}%`, align: 'right' },
          { header: t('svc_intAvgMs'), render: (s) => (s.avgMs ? `${s.avgMs} ms` : '—'), align: 'right' },
          { header: t('svc_intLastOk'), render: (s) => <span className="small num">{s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : '—'}</span> },
          {
            header: t('svc_actions'),
            render: (s) => (
              <div className="svc-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <Switch
                  checked={s.up}
                  disabled={!canEdit}
                  ariaLabel={`${s.up ? t('svc_intTakeDown') : t('svc_intBringUp')} ${s.id}`}
                  onChange={async (v) => {
                    await integrationHub.setSystemUp(s.id, v, user.id);
                    toast(`${loc(s.system.name)}: ${v ? t('svc_intUp') : t('svc_intDown')}`);
                  }}
                />
                <Button size="small" icon="book" title={t('svc_intPassport')} onClick={() => setPassport(s.system)} />
                {canEdit && <Button size="small" icon="plug" title={t('svc_intTest')} onClick={() => setTest(s.system)} />}
              </div>
            ),
          },
        ]}
      />
      {passport && <PassportDrawer system={passport} onClose={() => setPassport(null)} />}
      {test && (
        <TestCallDrawer
          system={test}
          onClose={() => setTest(null)}
          onOpenRecord={(id) => {
            setTest(null);
            onOpenRecord(id);
          }}
        />
      )}
    </Card>
  );
}

function LogTab({ onOpenRecord, quarantineOnly }: { onOpenRecord: (id: string) => void; quarantineOnly?: boolean }) {
  const { t } = useSession();
  const sysName = useSysName();
  const opName = useOpName();
  const [systemId, setSystemId] = useState('');
  const [status, setStatus] = useState<ExchangeStatus | ''>('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useApi(
    () => integrationHub.listExchanges({ systemId, status: quarantineOnly ? 'quarantined' : status, query, from, to }),
    [systemId, status, query, from, to, quarantineOnly],
  );
  const rows = list.data;
  return (
    <Card
      flush
      actions={undefined}
      title={
        <div className="svc-spread" style={{ width: '100%' }}>
          <h2>{quarantineOnly ? t('svc_intQuarantine') : t('svc_intLog')}</h2>
          <ExportButton
            filename={quarantineOnly ? t('svc_intQuarantine') : t('svc_intLog')}
            rows={rows ?? []}
            columns={[
              { header: 'ID', value: (r) => r.id },
              { header: t('svc_intTime'), value: (r) => r.createdAt, format: 'datetime' },
              { header: t('svc_intSystem'), value: (r) => sysName(r.systemId) },
              { header: t('svc_intOperation'), value: (r) => r.operation },
              { header: t('svc_intStatus'), value: (r) => t(tk('svc_status_', r.status)) },
              { header: t('svc_intAttempts'), value: (r) => r.attempts.length, format: 'integer' },
              { header: t('svc_intAmount'), value: (r) => r.amount ?? null, format: 'money', total: true },
              { header: t('svc_intError'), value: (r) => (r.error ? t(tk('svc_err_', r.error)) : '') },
              { header: t('svc_intIdemKey'), value: (r) => r.idempotencyKey },
            ]}
          />
        </div>
      }
    >
      <FilterBar>
        <Select
          value={systemId}
          onChange={setSystemId}
          ariaLabel={t('svc_intSystem')}
          options={[{ value: '', label: `${t('svc_intSystem')}: ${t('svc_intAll')}` }, ...integrationHub.systems.map((s) => ({ value: s.id, label: sysName(s.id) }))]}
        />
        {!quarantineOnly && (
          <Select<ExchangeStatus | ''>
            value={status}
            onChange={setStatus}
            ariaLabel={t('svc_intStatus')}
            options={[{ value: '', label: `${t('svc_intStatus')}: ${t('svc_intAll')}` }, ...STATUSES.map((s) => ({ value: s, label: t(tk('svc_status_', s)) }))]}
          />
        )}
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('svc_intSearch')} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={t('svc_intFrom')} style={{ width: 160 }} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={t('svc_intTo')} style={{ width: 160 }} />
      </FilterBar>
      {quarantineOnly && rows && !rows.length ? (
        <Empty text={t('svc_intEmptyQuarantine')} icon="shield" />
      ) : (
        <DataTable
          rows={rows}
          loading={list.loading}
          rowKey={(r) => r.id}
          onRowClick={(r) => onOpenRecord(r.id)}
          columns={[
            { header: t('svc_intTime'), render: (r) => <span className="num small">{formatDateTime(r.createdAt)}</span> },
            { header: t('svc_intSystem'), render: (r) => <span>{sysName(r.systemId)}</span> },
            { header: t('svc_intOperation'), render: (r) => <><div>{opName(r.systemId, r.operation)}</div><div className="sub svc-mono">{r.operation} · {t(tk('svc_intDirection_', r.direction))}</div></> },
            { header: t('svc_intStatus'), render: (r) => <span data-testid="ex-status" data-id={r.id}><ExStatus s={r.status} /></span> },
            { header: quarantineOnly ? t('svc_intError') : t('svc_intAttempts'), render: (r) => (quarantineOnly ? <span className="small" style={{ color: 'var(--danger)' }}>{r.error ? t(tk('svc_err_', r.error)) : ''}</span> : <span className="num">{r.attempts.length}{r.duplicates ? ` (+${r.duplicates})` : ''}</span>) },
            { header: t('svc_intAmount'), render: (r) => (r.amount !== undefined ? formatMoney(r.amount) : '—'), align: 'right' },
          ]}
        />
      )}
    </Card>
  );
}

function ReconciliationTab() {
  const { t } = useSession();
  const sysName = useSysName();
  const opName = useOpName();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const recon = useApi(() => integrationHub.reconciliation({ from, to }), [from, to]);
  const rows = recon.data ?? [];
  return (
    <Card
      flush
      title={
        <div className="svc-spread" style={{ width: '100%' }}>
          <h2>{t('svc_intReconciliation')}</h2>
          <ExportButton
            filename={t('svc_intReconciliation')}
            rows={rows}
            columns={[
              { header: t('svc_intSystem'), value: (r) => sysName(r.systemId) },
              { header: t('svc_intOperation'), value: (r) => r.operation },
              { header: t('svc_intSent2'), value: (r) => r.sent, format: 'integer', total: true },
              { header: `${t('svc_intSent2')}, UZS`, value: (r) => r.sentAmount, format: 'money', total: true },
              { header: t('svc_intConfirmed'), value: (r) => r.confirmed, format: 'integer', total: true },
              { header: `${t('svc_intConfirmed')}, UZS`, value: (r) => r.confirmedAmount, format: 'money', total: true },
              { header: t('svc_intDiff'), value: (r) => r.diffAmount, format: 'money', total: true },
              { header: t('svc_intStatus'), value: (r) => (r.ok ? t('svc_intReconOk') : t('svc_intReconBad')) },
            ]}
          />
        </div>
      }
    >
      <FilterBar>
        <span className="small muted" style={{ flex: '1 1 260px' }}>{t('svc_intReconHint')}</span>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={t('svc_intFrom')} style={{ width: 160 }} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={t('svc_intTo')} style={{ width: 160 }} />
      </FilterBar>
      <DataTable
        rows={recon.data}
        loading={recon.loading}
        rowKey={(r) => `${r.systemId}|${r.operation}`}
        columns={[
          { header: t('svc_intSystem'), render: (r) => <><div>{sysName(r.systemId)}</div><div className="sub">{opName(r.systemId, r.operation)}</div></> },
          { header: t('svc_intSent2'), render: (r) => <><div className="num">{r.sent}</div><div className="sub num">{formatMoney(r.sentAmount)}</div></>, align: 'right' },
          { header: t('svc_intConfirmed'), render: (r) => <><div className="num">{r.confirmed}</div><div className="sub num">{formatMoney(r.confirmedAmount)}</div></>, align: 'right' },
          { header: `${t('svc_intRejected')} / ${t('svc_intQueue')}`, render: (r) => `${r.rejected} / ${r.inQueue}`, align: 'right' },
          { header: t('svc_intDiff'), render: (r) => <span style={{ color: r.diffAmount ? 'var(--danger)' : undefined }}>{formatMoney(r.diffAmount)}</span>, align: 'right' },
          { header: t('svc_intStatus'), render: (r) => <span data-testid="recon-status" data-ok={r.ok ? '1' : '0'} data-key={`${r.systemId}|${r.operation}`}><Badge tone={r.ok ? 'ok' : 'danger'}>{r.ok ? t('svc_intReconOk') : t('svc_intReconBad')}</Badge></span> },
        ]}
      />
    </Card>
  );
}

function IntegrationsPage() {
  const { t } = useSession();
  const q = useQuery();
  const tab = (q.get('tab') as Tab) || 'systems';
  const [record, setRecord] = useState<string | null>(null);
  const systems = useApi(() => integrationHub.listSystems(), []);
  const kpi = useMemo(() => {
    const s = systems.data ?? [];
    return {
      up: s.filter((x) => x.up).length,
      all: s.length,
      total: s.reduce((a, x) => a + x.total, 0),
      queued: s.reduce((a, x) => a + x.queued, 0),
      quarantined: s.reduce((a, x) => a + x.quarantined, 0),
    };
  }, [systems.data]);
  return (
    <>
      <PageHeader title={t('svc_intTitle')} subtitle={t('svc_intSubtitle')} />
      <div className="grid grid-4">
        <Stat label={t('svc_intKpiSystems')} value={`${kpi.up} / ${kpi.all}`} icon="plug" tone={kpi.up < kpi.all ? 'alert' : 'accent'} />
        <Stat label={t('svc_intKpiToday')} value={kpi.total} icon="refresh" />
        <Stat label={t('svc_intKpiQueue')} value={kpi.queued} icon="clock" tone={kpi.queued ? 'alert' : undefined} />
        <Stat label={t('svc_intKpiQuarantine')} value={kpi.quarantined} icon="alert" tone={kpi.quarantined ? 'alert' : undefined} />
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={(v) => navigate(`/integrations?tab=${v}`)}
        items={[
          { value: 'systems', label: t('svc_intSystems'), count: kpi.all },
          { value: 'log', label: t('svc_intLog') },
          { value: 'quarantine', label: t('svc_intQuarantine'), count: kpi.quarantined },
          { value: 'reconciliation', label: t('svc_intReconciliation') },
          { value: 'designer', label: t('p4g_int_designer') },
        ]}
      />
      {tab === 'systems' && <SystemsTab onOpenRecord={setRecord} />}
      {tab === 'log' && <LogTab onOpenRecord={setRecord} />}
      {tab === 'quarantine' && <LogTab onOpenRecord={setRecord} quarantineOnly />}
      {tab === 'reconciliation' && <ReconciliationTab />}
      {tab === 'designer' && <IntegrationDesigner />}
      {record && <RecordDrawer id={record} onClose={() => setRecord(null)} />}
    </>
  );
}

export const routes: ModuleRoute[] = [{ path: '/integrations', render: () => <IntegrationsPage /> }];
