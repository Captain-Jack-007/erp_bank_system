// Журнал аудита (ТЗ PR-GEN-040, PR-SEC-017…025, 029, 030): фильтры, поиск, пополевые изменения, экспорт,
// проверка целостности цепочки записей. Доступ — аудитор и администратор (модуль `audit` в матрице прав).
import { useState } from 'react';
import { audit, AUDIT_ACTIONS, AUDIT_RETENTION_YEARS, auditApi, formatDateTime, toSiem, tk, type AuditAction, type AuditEntry, type AuditFilter, type TKey } from '@xb/shared';
import { Badge, Button, Card, DataTable, Drawer, Field, FilterBar, Input, PageHeader, Pagination, Select, Stat, useToast } from '../../components/ui';
import { AuditActionBadge, ChangesTable } from '../../components/FieldHistory';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { exportTable } from '../../lib/exportTable';
import { downloadBytes, safeFilename } from '../../components/download';
import { useQuery } from '../../lib/router';
import { AuditRetentionPage, AuditTabs } from './AuditRetention';

const PAGE = 25;

/** Подпись типа объекта журнала: ключ audit_entity_<entity>, иначе — сам код. */
export function useEntityLabel() {
  const { t } = useSession();
  return (entity: string) => {
    const key = tk('audit_entity_', entity);
    const v = t(key as TKey);
    return v === key ? entity : v;
  };
}

/** Журнал аудита; вкладка «Хранение и архивирование» (P4-SEC, PR-SEC-021) — ?tab=retention. */
export function AuditPage() {
  const query = useQuery();
  return query.get('tab') === 'retention' ? <AuditRetentionPage /> : <AuditLogView />;
}

function AuditLogView() {
  const { t } = useSession();
  const toast = useToast();
  const lk = useLookups();
  const entityLabel = useEntityLabel();
  const [filter, setFilter] = useState<AuditFilter>({});
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const [integrity, setIntegrity] = useState<{ ok: boolean; checked: number; brokenAt?: number } | null>(null);
  const data = useApi(() => auditApi.list(filter, page, PAGE), [JSON.stringify(filter), page]);
  const todayStats = useApi(() => auditApi.list({ from: new Date().toISOString().slice(0, 10) }, 1, 100000), []);
  const set = (patch: Partial<AuditFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const today = todayStats.data?.rows ?? [];

  function doExport(format: 'csv' | 'xlsx') {
    // синхронно в обработчике клика — браузер сохраняет имя файла (user activation)
    const rows = audit.query(filter);
    audit.log({ action: 'export', entity: 'audit_log', details: `${format.toUpperCase()} · ${rows.length}` });
    exportTable(
      format,
      t('audit_title'),
      [
        { header: '#', format: 'integer' },
        { header: t('audit_time'), width: 20 },
        { header: t('audit_user'), width: 24 },
        { header: t('role') },
        { header: t('audit_action') },
        { header: t('audit_entity') },
        { header: t('audit_object'), width: 28 },
        { header: t('audit_changes'), width: 60 },
        { header: t('audit_details'), width: 30 },
        { header: 'IP' },
        { header: t('audit_device'), width: 24 },
        { header: t('audit_result') },
        { header: 'hash' },
      ],
      rows.map((e) => [
        e.seq,
        e.at,
        e.userName,
        e.role ? t(tk('role_', e.role)) : '',
        t(tk('audit_action_', e.action)),
        entityLabel(e.entity),
        [e.entityLabel, e.entityId].filter(Boolean).join(' · '),
        (e.changes ?? []).map((c) => `${c.field}: ${c.from} → ${c.to}`).join('; '),
        e.details ?? '',
        e.ip,
        e.device,
        t(tk('audit_result_', e.result)),
        e.hash,
      ]),
      `${t('audit_title')} · ${t('audit_retention').replace('{years}', String(AUDIT_RETENTION_YEARS))}`,
    );
    toast(`${t('audit_exported')}: ${rows.length}`);
    data.reload();
  }

  /** P3-GEN (PR-SEC-042): выгрузка записей по фильтру в формате SIEM банка — syslog/CEF или JSON Lines. */
  function doSiem(format: 'cef' | 'json') {
    const rows = audit.query(filter).slice().reverse();
    audit.log({ action: 'export', entity: 'audit_log', details: `SIEM ${format.toUpperCase()} · ${rows.length}` });
    downloadBytes(safeFilename(`xb-erp-siem`, format === 'cef' ? 'cef' : 'jsonl'), format === 'cef' ? 'text/plain;charset=utf-8' : 'application/x-ndjson', toSiem(rows, format));
    toast(`${t('audit_exported')}: ${rows.length}`);
    data.reload();
  }

  return (
    <>
      <PageHeader
        title={t('audit_title')}
        subtitle={`${t('tzLabel')} PR-GEN-040, PR-SEC-017…025 · ${t('audit_retention').replace('{years}', String(AUDIT_RETENTION_YEARS))}`}
        actions={
          <>
            <Button
              icon="check"
              onClick={async () => {
                const r = await auditApi.verify();
                setIntegrity(r);
                toast(r.ok ? `${t('audit_integrity_ok')} (${r.checked})` : `${t('audit_integrity_broken')} #${r.brokenAt}`);
              }}
            >
              {t('audit_verify')}
            </Button>
            <Button onClick={() => doExport('csv')}>CSV</Button>
            <Button type="primary" onClick={() => doExport('xlsx')}>XLSX</Button>
            <Button className="siem-cef" onClick={() => doSiem('cef')} title={t('audit_siem_hint')}>SIEM · CEF</Button>
            <Button className="siem-json" onClick={() => doSiem('json')} title={t('audit_siem_hint')}>SIEM · JSON</Button>
          </>
        }
      />
      <AuditTabs value="log" />
      <div className="grid grid-4">
        <Stat label={t('audit_total')} value={data.data?.total ?? '…'} foot={t('audit_by_filter')} icon="file" />
        <Stat label={t('audit_logins_today')} value={today.filter((e) => e.action === 'login').length} icon="user" />
        <Stat label={t('audit_failures_today')} value={today.filter((e) => e.result === 'failure').length} tone={today.some((e) => e.result === 'failure') ? 'alert' : undefined} icon="alert" />
        <Stat
          label={t('audit_integrity')}
          value={integrity ? (integrity.ok ? t('audit_integrity_ok_short') : t('audit_integrity_broken_short')) : '—'}
          foot={integrity ? `${t('audit_checked')}: ${integrity.checked}` : t('audit_integrity_hint')}
          tone="accent"
          icon="check"
        />
      </div>
      <Card flush>
        <FilterBar>
          <Input type="search" value={filter.q ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder={`${t('search')}: ${t('audit_search_hint')}`} />
          <Select<string> value={filter.userId ?? ''} onChange={(v) => set({ userId: v || undefined })} placeholder={`${t('audit_user')}: ${t('all')}`} options={lk.users.map((u) => ({ value: u.id, label: u.fullName }))} ariaLabel={t('audit_user')} />
          <Select<string> value={filter.action ?? ''} onChange={(v) => set({ action: (v || '') as AuditAction | '' })} placeholder={`${t('audit_action')}: ${t('all')}`} options={AUDIT_ACTIONS.map((a) => ({ value: a, label: t(tk('audit_action_', a)) }))} ariaLabel={t('audit_action')} />
          <Select<string> value={filter.entity ?? ''} onChange={(v) => set({ entity: v || undefined })} placeholder={`${t('audit_entity')}: ${t('all')}`} options={(data.data?.entities ?? []).map((e) => ({ value: e, label: entityLabel(e) }))} ariaLabel={t('audit_entity')} />
          <Select<string> value={filter.result ?? ''} onChange={(v) => set({ result: (v || '') as AuditFilter['result'] })} placeholder={`${t('audit_result')}: ${t('all')}`} options={[{ value: 'success', label: t('audit_result_success') }, { value: 'failure', label: t('audit_result_failure') }]} ariaLabel={t('audit_result')} />
          <span className="date-range">
            <Input type="date" value={filter.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} ariaLabel={t('audit_from_date')} />
            <span className="muted">—</span>
            <Input type="date" value={filter.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} ariaLabel={t('audit_to_date')} />
          </span>
          {Object.values(filter).some(Boolean) && (
            <Button type="link" size="small" onClick={() => (setFilter({}), setPage(1))}>
              {t('audit_reset')}
            </Button>
          )}
        </FilterBar>
        <DataTable
          rows={data.data?.rows}
          loading={data.loading}
          rowKey={(e) => e.id}
          onRowClick={setOpen}
          emptyText={t('search_nothing')}
          columns={[
            { header: t('audit_time'), render: (e) => <span className="num">{formatDateTime(e.at)}<span className="muted">:{e.at.slice(17, 19)}</span></span>, width: 150 },
            { header: t('audit_user'), render: (e) => <><div style={{ fontWeight: 600 }}>{e.userName}</div>{e.role && <div className="sub">{t(tk('role_', e.role))}</div>}</> },
            { header: t('audit_action'), render: (e) => <AuditActionBadge action={e.action} result={e.result} /> },
            { header: t('audit_entity'), render: (e) => <><div>{entityLabel(e.entity)}</div><div className="sub">{[e.entityLabel, e.entityId].filter(Boolean).join(' · ')}</div></> },
            {
              header: t('audit_changes'),
              render: (e) =>
                e.changes?.length ? (
                  <span className="small">
                    {e.changes.slice(0, 2).map((c) => `${c.field}: ${c.from} → ${c.to}`).join('; ')}
                    {e.changes.length > 2 && ` (+${e.changes.length - 2})`}
                  </span>
                ) : (
                  <span className="muted small">{e.details ?? '—'}</span>
                ),
            },
            { header: 'IP / ' + t('audit_device'), render: (e) => <><div className="num small">{e.ip}</div><div className="sub">{e.device}</div></> },
          ]}
        />
        <Pagination current={page} pageSize={PAGE} total={data.data?.total ?? 0} onChange={(p) => setPage(p)} />
      </Card>
      <p className="muted small">{t('audit_immutable_note')}</p>
      <Drawer open={!!open} title={open ? `${t('audit_record')} #${open.seq}` : ''} onClose={() => setOpen(null)}>
        {open && (
          <>
            <dl className="kv">
              <dt>{t('audit_time')}</dt>
              <dd className="num">{open.at}</dd>
              <dt>{t('audit_user')}</dt>
              <dd>{open.userName}{open.role ? ` · ${t(tk('role_', open.role))}` : ''}{open.userId ? ` (${open.userId})` : ''}</dd>
              <dt>{t('audit_action')}</dt>
              <dd><AuditActionBadge action={open.action} result={open.result} /></dd>
              <dt>{t('audit_entity')}</dt>
              <dd>{entityLabel(open.entity)} {open.entityId && <span className="doc-num">{open.entityId}</span>} {open.entityLabel}</dd>
              {open.details && (<><dt>{t('audit_details')}</dt><dd>{open.details}</dd></>)}
              <dt>IP</dt>
              <dd className="num">{open.ip}</dd>
              <dt>{t('audit_device')}</dt>
              <dd>{open.device}</dd>
              <dt>{t('audit_result')}</dt>
              <dd><Badge tone={open.result === 'success' ? 'ok' : 'danger'}>{t(tk('audit_result_', open.result))}</Badge></dd>
              <dt>{t('audit_chain')}</dt>
              <dd className="num small">{open.prevHash} → <b>{open.hash}</b></dd>
            </dl>
            {!!open.changes?.length && (
              <Field label={t('audit_changes')}>
                <ChangesTable changes={open.changes} />
              </Field>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
