// P4-SEC (PR-SEC-021): хранение журнала аудита — архивирование и уничтожение по истечении срока хранения
// под контролем двух лиц: администратор ИБ подаёт заявку (2FA), внутренний аудитор утверждает (2FA) через движок
// согласований; цепочка хэшей проверяется до и после, для уничтоженного сегмента хранится якорь.
import { useState } from 'react';
import { approvalsApi, auditRetentionApi, formatDate, formatDateTime, type AuditRetentionKind, type AuditRetentionRequest } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Field, Input, PageHeader, Stat, Tabs, Textarea, useToast } from '../../components/ui';
import { useCan, useErrorText, useStepUp } from '../../lib/access';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { downloadBytes } from '../../components/download';
import '../../components/p4sec.css';

export function AuditTabs({ value }: { value: 'log' | 'retention' }) {
  const { t } = useSession();
  const allowed = useCan();
  if (!allowed('audit_retention', 'view') && value === 'log') return null;
  return (
    <Card flush>
      <Tabs<'log' | 'retention'>
        value={value}
        onChange={(v) => navigate(v === 'log' ? '/audit' : '/audit?tab=retention')}
        items={[
          { value: 'log', label: t('ar_tab_log') },
          { value: 'retention', label: t('ar_tab_retention') },
        ]}
      />
    </Card>
  );
}

const STATUS_TONE = { pending: 'warn', executed: 'ok', rejected: 'danger', failed: 'danger' } as const;

export function AuditRetentionPage() {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const stepUp = useStepUp();
  const errText = useErrorText();
  const allowed = useCan();
  const canInitiate = allowed('audit_retention', 'admin');
  const canApprove = allowed('audit_retention', 'approve');
  const ov = useApi(() => auditRetentionApi.overview(), []);
  const list = useApi(() => auditRetentionApi.list(), []);
  const [regulation, setRegulation] = useState(t('ar_regulation_default'));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const o = ov.data;
  const name = (id?: string) => (id ? (lk.user(id)?.fullName ?? id) : '—');

  async function file(kind: AuditRetentionKind) {
    if (!regulation.trim()) return toast(`${t('actionFailed')}: REGULATION_REQUIRED`);
    if (!(await stepUp(`${t(kind === 'archive' ? 'ar_btn_archive' : 'ar_btn_destroy')} · ${o?.due?.count ?? 0} ${t('ar_records')}`))) return;
    setBusy(true);
    try {
      const r = await auditRetentionApi.request({ kind, regulation, reason });
      toast(`${r.number}: ${t('ar_filed_toast')}`);
      setReason('');
    } catch (e) {
      toast(`${t('actionFailed')}: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function decide(r: AuditRetentionRequest, approve: boolean) {
    const task = (await approvalsApi.inbox(user, 'mine')).find((i) => i.task.entity === 'audit_retention' && i.task.entityId === r.id);
    if (!task) return toast(`${t('actionFailed')}: NOT_ASSIGNED`);
    if (approve && !(await stepUp(`${t('ar_btn_approve')}: ${r.number}`))) return;
    setBusy(true);
    try {
      await approvalsApi.decide(task.task.id, user, approve ? 'approve' : 'reject', approve ? undefined : t('ar_reject_reason'));
      const after = (await auditRetentionApi.list()).find((x) => x.id === r.id);
      if (after?.status === 'failed') toast(`${t('actionFailed')}: ${errText(after.failure)}`);
      else toast(`${r.number}: ${t(approve ? 'ar_approved_toast' : 'ar_rejected_toast')}`);
    } catch (e) {
      toast(`${t('actionFailed')}: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function download(r: AuditRetentionRequest) {
    try {
      const f = await auditRetentionApi.download(r.id);
      downloadBytes(f.fileName, 'application/json;charset=utf-8', f.content);
      toast(`${f.fileName} · SHA-256 ${f.sha256.slice(0, 16)}…`);
    } catch (e) {
      toast(`${t('actionFailed')}: ${errText(e)}`);
    }
  }

  const pending = o?.pending ?? null;
  return (
    <>
      <PageHeader title={t('audit_title')} subtitle={`${t('tzLabel')} PR-SEC-021 · ${t('ar_subtitle')}`} />
      <AuditTabs value="retention" />
      <div className="grid grid-4">
        <Stat label={t('ar_policy')} value={o ? `${o.retentionYears} ${t('ar_years')}` : '…'} foot={o ? `${t('ar_cutoff')}: ${formatDate(o.cutoff)}` : ''} icon="clock" />
        <Stat label={t('ar_due')} value={o ? (o.due?.count ?? 0) : '…'} foot={o?.due ? `#${o.due.fromSeq}–${o.due.toSeq}` : t('ar_due_none')} tone={o?.due ? 'alert' : undefined} icon="archive" />
        <Stat label={t('ar_chain')} value={o ? (o.chain.ok ? t('audit_integrity_ok_short') : t('audit_integrity_broken_short')) : '…'} foot={o ? `${t('audit_checked')}: ${o.chain.checked}` : ''} tone="accent" icon="check" />
        <Stat label={t('ar_anchors')} value={o ? o.anchors.length : '…'} foot={t('ar_anchors_hint')} icon="key" />
      </div>

      <Card title={t('ar_segment_title')}>
        {!o ? null : !o.due ? (
          <Empty text={t('ar_due_none')} icon="check" />
        ) : (
          <div className="ar-segment" data-testid="ar-segment">
            <dl className="kv">
              <dt>{t('ar_segment')}</dt>
              <dd className="num">#{o.due.fromSeq}–{o.due.toSeq} · {o.due.count} {t('ar_records')}</dd>
              <dt>{t('ar_period')}</dt>
              <dd className="num">{formatDateTime(o.due.firstAt)} — {formatDateTime(o.due.lastAt)}</dd>
              <dt>{t('ar_last_hash')}</dt>
              <dd className="num small">{o.due.lastHash}</dd>
              <dt>{t('status')}</dt>
              <dd>{o.due.archived ? <Badge tone="ok">{t('ar_archived')}</Badge> : <Badge tone="warn">{t('ar_not_archived')}</Badge>}</dd>
            </dl>
            {canInitiate ? (
              <div className="ar-form">
                <Field label={t('ar_regulation')} required>
                  <Input value={regulation} onChange={(e) => setRegulation(e.target.value)} ariaLabel={t('ar_regulation')} />
                </Field>
                <Field label={t('ar_reason')}>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} ariaLabel={t('ar_reason')} />
                </Field>
                <div className="ar-actions">
                  <Button type="primary" icon="archive" loading={busy} disabled={!!pending} onClick={() => void file('archive')} className="ar-archive-btn">{t('ar_btn_archive')}</Button>
                  <Button danger icon="trash" loading={busy} disabled={!!pending || !o.due.archived} onClick={() => void file('destroy')} className="ar-destroy-btn">{t('ar_btn_destroy')}</Button>
                </div>
                {!o.due.archived && <p className="muted small" style={{ margin: 0 }}>{t('ar_destroy_needs_archive')}</p>}
              </div>
            ) : null}
            <p className="muted small" style={{ margin: 0 }}>{t('ar_dual_hint')}</p>
          </div>
        )}
      </Card>

      {pending && (
        <Card title={`${t('ar_pending')}: ${pending.number}`}>
          <div className="ar-pending" data-testid="ar-pending">
            <p style={{ margin: 0 }}>
              <b>{t(pending.kind === 'archive' ? 'ar_kind_archive' : 'ar_kind_destroy')}</b> · #{pending.fromSeq}–{pending.toSeq} ({pending.count}) · {pending.regulation}
            </p>
            <p className="muted small" style={{ margin: 0 }}>{t('ar_initiator')}: {name(pending.initiatorId)} · {formatDateTime(pending.createdAt)}</p>
            {canApprove && pending.initiatorId !== user.id ? (
              <div className="ar-actions">
                <Button type="primary" icon="check" loading={busy} onClick={() => void decide(pending, true)} className="ar-approve-btn">{t('ar_btn_approve')}</Button>
                <Button danger loading={busy} onClick={() => void decide(pending, false)}>{t('reject')}</Button>
              </div>
            ) : (
              <p className="small" style={{ margin: 0 }}>{t('ar_wait_second')}</p>
            )}
          </div>
        </Card>
      )}

      <Card title={t('ar_requests')} flush>
        <DataTable
          rows={list.data}
          loading={list.loading}
          rowKey={(r) => r.id}
          emptyText={t('ar_no_requests')}
          columns={[
            { header: '№', render: (r) => <><div className="doc-num">{r.number}</div><div className="sub">{formatDateTime(r.createdAt)}</div></> },
            { header: t('ar_kind'), render: (r) => t(r.kind === 'archive' ? 'ar_kind_archive' : 'ar_kind_destroy') },
            { header: t('status'), render: (r) => <span data-status={r.status}><Badge tone={STATUS_TONE[r.status]}>{t(`ar_status_${r.status}` as 'ar_status_pending')}</Badge></span> },
            { header: t('ar_segment'), render: (r) => <span className="num">#{r.fromSeq}–{r.toSeq} ({r.count})</span> },
            { header: `${t('ar_initiator')} / ${t('ar_approver')}`, render: (r) => <><div>{name(r.initiatorId)}</div><div className="sub">{name(r.approverId)}</div></> },
            {
              header: t('ar_result'),
              render: (r) =>
                r.archive ? (
                  <Button size="small" icon="download" onClick={() => void download(r)} className="ar-download">{t('ar_download')}</Button>
                ) : r.anchor ? (
                  <span className="num small">{t('ar_anchor')}: {r.anchor.lastHash}</span>
                ) : r.failure ? (
                  <span className="small" style={{ color: 'var(--danger)' }}>{errText(r.failure)}</span>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Card>

      <Card title={t('ar_anchor_title')} flush>
        <DataTable
          rows={o?.anchors}
          loading={!o}
          rowKey={(a) => a.id}
          emptyText={t('ar_no_anchors')}
          columns={[
            { header: t('ar_segment'), render: (a) => <span className="num">#{a.fromSeq}–{a.toSeq} ({a.count})</span> },
            { header: t('ar_period'), render: (a) => <span className="num small">{formatDate(a.firstAt)} — {formatDate(a.lastAt)}</span> },
            { header: t('ar_removed_at'), render: (a) => <span className="num small">{formatDateTime(a.removedAt)}</span> },
            { header: t('ar_last_hash'), render: (a) => <span className="num small">{a.lastHash}</span> },
            { header: t('ar_digest'), render: (a) => <span className="num small">{a.segmentDigest}</span> },
            { header: `${t('ar_initiator')} / ${t('ar_approver')}`, render: (a) => <><div>{name(a.initiatorId)}</div><div className="sub">{name(a.approverId)}</div></> },
          ]}
        />
      </Card>
      <p className="muted small">{t('ar_note')}</p>
    </>
  );
}
