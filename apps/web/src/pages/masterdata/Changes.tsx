// Заявки на изменение справочников (PR-MDM-003): подтверждающий документ, маршрут по матрице согласования
// (движок approvalEngine, entity mdm_change: вид объекта / вид номенклатуры / категория), подпись E-IMZO согласующих,
// разделение полномочий (автор не утверждает), применение записи только после финального этапа.
import { useState, type ReactNode } from 'react';
import { ApprovalError, DqError, formatBytes, formatDate, formatDateTime, mdmChangeSignContent, orgApi, tk, type MdmChangeRequest, type SignableDoc, type TKey } from '@xb/shared';
import { Badge, Button, Card, Drawer, Empty, Field, Loading, PageHeader, RouteSteps, Tabs, Textarea, Timeline, useToast, DataTable } from '../../components/ui';
import { ChangesTable } from '../../components/FieldHistory';
import { SignModal, SignaturesPanel } from '../../components/SignModal';
import { Icon } from '../../components/icons';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useFieldLabel } from './shared';

type Filter = 'pending' | 'approved' | 'rejected' | '';
const TONE = { pending: 'warn', approved: 'ok', rejected: 'danger' } as const;

const show = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'object' && v && 'ru' in v) return `${(v as { ru: string }).ru} / ${(v as { uz: string }).uz}`;
  if (typeof v === 'boolean') return v ? '✓' : '—';
  return String(v);
};

/** Подпись записи заявки: код/наименование номенклатуры или бизнес-ключ оргединицы/МВЗ. */
function targetLabel(r: MdmChangeRequest): string {
  const p = r.payload as { code?: string; name?: { ru?: string } };
  if (r.entity === 'nomenclature') return `${p.code ?? (r.before as { code?: string } | undefined)?.code ?? ''} ${p.name?.ru ?? ''}`.trim() || (r.targetKey ?? '');
  return r.targetKey ?? show(p.code);
}

export function ChangesTab() {
  const { t } = useSession();
  const lk = useLookups();
  const [filter, setFilter] = useState<Filter>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useApi(() => orgApi.listChanges({ status: filter }), [filter]);
  const open = useApi(() => (openId ? orgApi.getChange(openId) : Promise.resolve(undefined)), [openId ?? '']);
  return (
    <>
      <div style={{ padding: '0 8px' }}>
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'pending', label: t('mdm_status_pending') },
            { value: 'approved', label: t('mdm_status_approved') },
            { value: 'rejected', label: t('mdm_status_rejected') },
            { value: '', label: t('all') },
          ]}
        />
      </div>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        emptyText={t('mdm_empty')}
        columns={[
          { header: t('number'), render: (r) => <span className="doc-num">{r.number}</span> },
          { header: t('mdm_what'), render: (r) => <><div>{t(tk('mdm_action_', r.action))}: {t(tk('mdm_entity_', r.entity))}</div><div className="sub">{targetLabel(r)}</div></> },
          { header: t('mdm_reason'), render: (r) => <span className="small">{r.reason}</span> },
          { header: t('mdm_requested_by'), render: (r) => <><div>{lk.user(r.requestedBy)?.fullName ?? r.requestedBy}</div><div className="sub num">{formatDateTime(r.requestedAt)}</div></> },
          { header: t('mdm_effective_from'), render: (r) => <span className="num">{formatDate(r.effectiveFrom)}</span> },
          { header: t('status'), render: (r) => <><Badge tone={TONE[r.status]}>{t(tk('mdm_status_', r.status))}</Badge>{r.requireSignature && <div className="sub">E-IMZO</div>}</> },
        ]}
      />
      {openId && open.data && <ChangeDetail req={open.data} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** Карточка заявки отдельной страницей (ссылка из согласований и уведомлений): /master-data/changes/:id. */
export function ChangeDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const req = useApi(() => orgApi.getChange(id), [id]);
  if (req.loading && !req.data) return <Card><Loading /></Card>;
  if (!req.data) return <Card><Empty text={t('empty')} /></Card>;
  return <ChangeDetail req={req.data} asPage onClose={() => navigate('/master-data?tab=changes')} />;
}

function ChangeDetail({ req, onClose, asPage = false }: { req: MdmChangeRequest; onClose: () => void; asPage?: boolean }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const lk = useLookups();
  const label = useFieldLabel();
  const auth = useApi(() => orgApi.changeAuthority(req.id, user), [req.id, user.id, req.status, req.history?.length ?? 0]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const a = auth.data;
  const own = req.requestedBy === user.id;
  const canDecide = req.status === 'pending' && !!a?.canAct;
  const canApprove = canDecide && !!a?.canApprove && !own;
  const changes = Object.keys(req.payload).map((k) => ({ field: label(k), from: show(req.before?.[k]), to: show(req.payload[k]) }));
  const signDoc: SignableDoc = { entity: 'mdm_change', entityId: req.id, title: `${req.number} · ${t(tk('mdm_action_', req.action))}: ${t(tk('mdm_entity_', req.entity))}`, content: mdmChangeSignContent(req) };

  async function decide(decision: 'approve' | 'reject', signatureId?: string) {
    setError('');
    setBusy(true);
    try {
      await orgApi.decideChange(req.id, decision, comment, user, signatureId);
      const after = await orgApi.getChange(req.id);
      const msg = decision === 'reject' ? t('mdm_status_rejected') : after?.status === 'approved' ? t('mdm_status_approved') : t('mdm_step_done');
      toast(`${req.number}: ${msg}`);
      if (!asPage) onClose();
    } catch (e) {
      if (e instanceof DqError) setError(t('mdm_reject_reason'));
      else if (e instanceof ApprovalError) setError(t(tk('flow_err_', e.code) as TKey));
      else setError(e instanceof Error && e.message === 'sod' ? t('mdm_sod') : t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  const link = req.targetKey
    ? req.entity === 'cost_center' ? `/master-data/cc/${req.targetKey}` : req.entity === 'org_unit' ? `/master-data/org/${req.targetKey}` : '/procurement?tab=catalog'
    : undefined;
  const title = `${req.number} · ${t(tk('mdm_action_', req.action))}: ${t(tk('mdm_entity_', req.entity))}`;
  const frame = (footer: ReactNode, children: ReactNode) =>
    asPage ? (
      <>
        <PageHeader crumbs={[{ label: t('md_tab_changes'), to: '/master-data?tab=changes' }, { label: req.number }]} title={title} actions={footer} />
        <Card>{children}</Card>
      </>
    ) : (
      <Drawer open width={640} title={title} onClose={onClose} footer={footer}>
        {children}
      </Drawer>
    );
  return frame(

        canDecide ? (
          <>
            <Button danger loading={busy} onClick={() => decide('reject')}>{t('reject')}</Button>
            {canApprove && (req.requireSignature ? (
              <Button type="primary" icon="pen" loading={busy} onClick={() => setSigning(true)}>{t('mdm_sign_approve')}</Button>
            ) : (
              <Button type="primary" loading={busy} onClick={() => decide('approve')}>{a?.final ? t('mdm_approve_apply') : t('approve')}</Button>
            ))}
          </>
        ) : undefined
      ,
    <>
      <dl className="kv">
        <dt>{t('status')}</dt>
        <dd><Badge tone={TONE[req.status]}>{t(tk('mdm_status_', req.status))}</Badge>{req.status === 'pending' && a?.totalSteps ? <span className="muted small"> · {t('step')} {a.step} {t('of')} {a.totalSteps}</span> : null}</dd>
        <dt>{t('mdm_requested_by')}</dt>
        <dd>{lk.user(req.requestedBy)?.fullName ?? req.requestedBy} · <span className="num">{formatDateTime(req.requestedAt)}</span></dd>
        <dt>{t('mdm_effective_from')}</dt>
        <dd className="num">{formatDate(req.effectiveFrom)}</dd>
        {link && (<><dt>{t('mdm_record')}</dt><dd><Link to={link}>{targetLabel(req)}</Link></dd></>)}
        {req.matrix?.itemKind && (<><dt>{t('mdf_kind')}</dt><dd>{t(tk('proc_kind_', req.matrix.itemKind) as TKey)}{req.matrix.category ? ` · ${t(tk('proc_cat_', req.matrix.category) as TKey)}` : ''}</dd></>)}
        <dt>{t('mdm_reason')}</dt>
        <dd>{req.reason}</dd>
        <dt>{t('mdm_attachment')}</dt>
        <dd>{req.attachment ? <span className="attach-chip"><Icon name="paperclip" size={13} /> {req.attachment.name} · {formatBytes(req.attachment.size)}</span> : '—'}</dd>
        {req.decidedBy && (<><dt>{t('mdm_decided_by')}</dt><dd>{lk.user(req.decidedBy)?.fullName ?? req.decidedBy} · <span className="num">{req.decidedAt ? formatDateTime(req.decidedAt) : ''}</span>{req.decisionComment ? ` — ${req.decisionComment}` : ''}</dd></>)}
      </dl>
      {!!changes.length && (
        <Field label={t('mdm_changes')}>
          <ChangesTable changes={changes} />
        </Field>
      )}
      <Field label={t('mdm_route')}>
        <RouteSteps entityId={req.id} />
      </Field>
      {req.requireSignature && <div className="banner">{t('mdm_sign_required')}</div>}
      {req.requireSignature && <SignaturesPanel doc={signDoc} canSign={false} />}
      {canDecide && own && <div className="banner warn">{t('mdm_sod')}</div>}
      {req.status === 'pending' && !canDecide && !own && a && <div className="banner">{t('mdm_not_your_step')}</div>}
      {canDecide && (
        <Field label={t('comment')} error={error || undefined} hint={t('mdm_comment_hint')}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} ariaLabel={t('comment')} />
        </Field>
      )}
      {!!req.history?.length && (
        <Field label={t('history')}>
          <Timeline events={req.history} />
        </Field>
      )}
      {signing && <SignModal doc={signDoc} onClose={() => setSigning(false)} onSigned={(rec) => void decide('approve', rec.id)} />}
    </>,
  );
}
