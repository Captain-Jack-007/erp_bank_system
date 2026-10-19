// «Заместители»: временная передача права согласования (отпуск, командировка).
import { useState } from 'react';
import { APPROVAL_ENTITIES, approvalsApi, formatDate, today, tk, type ApprovalEntity, type Delegation } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, Switch, Textarea, useToast, type Column } from '../../components/ui';
import { useFlowError } from '../../components/flow';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';

type Draft = { id?: string; userId: string; deputyId: string; from: string; to: string; entities: ApprovalEntity[]; comment: string; active: boolean };

function stateOf(d: Delegation): 'active' | 'planned' | 'expired' | 'off' {
  const now = today();
  if (!d.active) return 'off';
  if (d.to < now) return 'expired';
  if (d.from > now) return 'planned';
  return 'active';
}
const TONE = { active: 'ok', planned: 'info', expired: 'muted', off: 'muted' } as const;

export function DeputiesPage() {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const errText = useFlowError();
  const isAdmin = user.role === 'admin' || !!user.extraRoles?.includes('admin');
  const list = useApi(() => approvalsApi.listDelegations(user), [user.id]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const startNew = () => {
    setErrors({});
    setDraft({ userId: user.id, deputyId: '', from: today(), to: plus(14), entities: [], comment: '', active: true });
  };
  const edit = (d: Delegation) => {
    setErrors({});
    setDraft({ id: d.id, userId: d.userId, deputyId: d.deputyId, from: d.from, to: d.to, entities: d.entities ?? [], comment: d.comment ?? '', active: d.active });
  };

  async function save() {
    if (!draft) return;
    const e: Record<string, string> = {};
    if (!draft.deputyId) e.deputyId = t('formRequired');
    else if (draft.deputyId === draft.userId) e.deputyId = t('flow_err_same');
    if (!draft.from || !draft.to) e.period = t('formRequired');
    else if (draft.to < draft.from) e.period = t('flow_err_period');
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await approvalsApi.saveDelegation({ ...(draft.id ? { id: draft.id } : {}), userId: draft.userId, deputyId: draft.deputyId, from: draft.from, to: draft.to, ...(draft.entities.length ? { entities: draft.entities } : {}), ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}), active: draft.active }, user);
      toast(t('flow_deputy_saved'));
      setDraft(null);
    } catch (err) {
      setErrors({ form: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  const canEdit = (d: Delegation) => isAdmin || d.userId === user.id;
  const columns: Column<Delegation>[] = [
    { header: t('flow_principal'), render: (d) => <b>{lk.user(d.userId)?.fullName ?? d.userId}</b> },
    { header: t('flow_deputy'), render: (d) => lk.user(d.deputyId)?.fullName ?? d.deputyId },
    { header: t('flow_period'), render: (d) => <span className="num">{formatDate(d.from)} — {formatDate(d.to)}</span> },
    { header: t('flow_entities'), render: (d) => (d.entities?.length ? d.entities.map((e) => t(tk('entity_', e))).join(', ') : t('flow_all_types')) },
    { header: t('status'), render: (d) => <Badge tone={TONE[stateOf(d)]}>{t(tk('flow_dl_', stateOf(d)))}</Badge> },
    {
      header: '',
      render: (d) =>
        canEdit(d) ? (
          <span className="toolbar" style={{ justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => edit(d)}>{t('flow_edit')}</Button>
            <Button size="small" danger onClick={() => approvalsApi.removeDelegation(d.id, user)}>{t('flow_remove')}</Button>
          </span>
        ) : null,
    },
  ];

  const users = lk.users.filter((u) => u.active !== false);
  return (
    <>
      <PageHeader
        title={t('flow_deputies_title')}
        subtitle={t('flow_deputies_subtitle')}
        crumbs={[{ label: t('navApprovals'), to: '/approvals' }, { label: t('flow_deputies_title') }]}
        actions={<Button type="primary" icon="plus" onClick={startNew}>{t('flow_add_deputy')}</Button>}
      />
      <div className="flow-hint small muted" style={{ padding: 0 }}>{t('flow_deputies_note')}</div>
      <Card flush>
        <DataTable rows={list.data} loading={list.loading} columns={columns} rowKey={(d) => d.id} emptyText={t('flow_deputies_empty')} />
      </Card>

      {draft && (
        <Modal
          title={draft.id ? t('flow_edit') : t('flow_add_deputy')}
          onClose={() => setDraft(null)}
          footer={
            <>
              <Button onClick={() => setDraft(null)}>{t('cancel')}</Button>
              <Button type="primary" disabled={busy} onClick={save}>{t('save')}</Button>
            </>
          }
        >
          <Field label={t('flow_principal')} required>
            <Select value={draft.userId} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, userId: v })} options={users.map((u) => ({ value: u.id, label: `${u.fullName} · ${t(tk('role_', u.role))}` }))} ariaLabel={t('flow_principal')} />
          </Field>
          <Field label={t('flow_deputy')} required error={errors.deputyId}>
            <Select value={draft.deputyId} placeholder="—" onChange={(v) => setDraft({ ...draft, deputyId: v })} options={users.filter((u) => u.id !== draft.userId).map((u) => ({ value: u.id, label: `${u.fullName} · ${t(tk('role_', u.role))}` }))} ariaLabel={t('flow_deputy')} />
          </Field>
          <Field label={t('flow_period')} required error={errors.period}>
            <span className="flow-period">
              <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} ariaLabel={t('flow_from')} />
              <span className="muted">—</span>
              <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} ariaLabel={t('flow_to')} />
            </span>
          </Field>
          <Field label={t('flow_entities')} hint={t('flow_all_types')}>
            <div className="flow-checks">
              {APPROVAL_ENTITIES.map((e) => (
                <Checkbox key={e} checked={draft.entities.includes(e)} onChange={(v) => setDraft({ ...draft, entities: v ? [...draft.entities, e] : draft.entities.filter((x) => x !== e) })}>
                  {t(tk('entity_', e))}
                </Checkbox>
              ))}
            </div>
          </Field>
          <Field label={t('flow_comment')}>
            <Textarea value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} rows={2} ariaLabel={t('flow_comment')} />
          </Field>
          <span className="flow-switch-row">
            <Switch checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} ariaLabel={t('flow_enabled')} />
            {t('flow_enabled')}
          </span>
          {errors.form && <span className="error-text">{errors.form}</span>}
        </Modal>
      )}
    </>
  );
}
