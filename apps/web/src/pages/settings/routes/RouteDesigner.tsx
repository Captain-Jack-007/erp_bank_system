// Конструктор маршрутов согласования (админ): шаблоны по типам документов, условия, шаги, версии.
// Изменения применяются к новым задачам (открытые маршруты не перестраиваются).
import { useMemo, useState } from 'react';
import {
  APPROVAL_ENTITIES,
  ROLES,
  approvalsApi,
  formatDateTime,
  formatMoneyShort,
  localize,
  tk,
  type ApprovalEntity,
  type ApproverKind,
  type ApproverSpec,
  type Committee,
  type CommitteeId,
  type ConditionOp,
  type Role,
  type RouteCondition,
  type RouteStepTemplate,
  type RouteTemplate,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, Drawer, Empty, Field, FilterBar, Input, Loading, PageHeader, RouteSteps, Select, Switch, Textarea, useToast } from '../../../components/ui';
import { useFlowError } from '../../../components/flow';
import { fmt } from '../../../components/flowLabels';
import { useSession, useUser } from '../../../lib/session';
import { useApi, useLookups } from '../../../lib/useApi';
import { useQuery } from '../../../lib/router';

type Draft = Omit<RouteTemplate, 'version' | 'updatedAt' | 'versions' | 'id'> & { id?: string };
const KINDS: ApproverKind[] = ['role', 'user', 'initiatorHead', 'departmentHead', 'branchRole', 'committee'];
const OPS: ConditionOp[] = ['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'contains'];
const OP_LABEL: Record<ConditionOp, string> = { eq: '=', neq: '≠', in: '∈', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: '∋' };
const COMMITTEES: CommitteeId[] = ['board', 'credit_committee'];

const num = (s: string): number | undefined => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
let stepSeq = 0;

function defaultSpec(kind: ApproverKind): ApproverSpec {
  switch (kind) {
    case 'role':
      return { kind, role: 'dept_head' };
    case 'branchRole':
      return { kind, role: 'dept_head' };
    case 'user':
      return { kind, userId: 'u2' };
    case 'initiatorHead':
      return { kind };
    case 'departmentHead':
      return { kind, departmentId: 'd3' };
    case 'committee':
      return { kind, committee: 'board' };
  }
}

/** Подпись согласующего по спецификации шаблона (без разрешения на конкретных людей). */
function useSpecLabel() {
  const { t, loc } = useSession();
  const lk = useLookups();
  const cms = useApi(() => approvalsApi.listCommittees(), []);
  return (s: ApproverSpec): string => {
    switch (s.kind) {
      case 'role':
        return t(tk('role_', s.role));
      case 'branchRole':
        return `${t(tk('role_', s.role))} · ${t('flow_kind_branchRole')}`;
      case 'user':
        return lk.user(s.userId)?.fullName ?? s.userId;
      case 'initiatorHead':
        return t('flow_kind_initiatorHead');
      case 'departmentHead': {
        const d = lk.department(s.departmentId);
        return `${t('flow_kind_departmentHead')}: ${d ? loc(d.name) : s.departmentId}`;
      }
      case 'committee': {
        const c = cms.data?.find((x) => x.id === s.committee);
        return c ? loc(c.name) : t('flow_kind_committee');
      }
    }
  };
}

function conditionSummary(c: RouteCondition, t: (k: never) => string, lang: string, depName: (id: string) => string): string[] {
  const tt = t as unknown as (k: string) => string;
  const out: string[] = [];
  const m = (n: number) => formatMoneyShort(n, lang);
  if (c.amountGt !== undefined) out.push(`> ${m(c.amountGt)}`);
  if (c.amountLte !== undefined) out.push(`≤ ${m(c.amountLte)}`);
  if (c.subtypes?.length) out.push(`${tt('flow_cond_subtypes')}: ${c.subtypes.join(', ')}`);
  if (c.departmentIds?.length) out.push(`${tt('department')}: ${c.departmentIds.map(depName).join(', ')}`);
  if (c.branchIds?.length) out.push(`${tt('flow_cond_branches')}: ${c.branchIds.join(', ')}`);
  for (const f of c.fields ?? []) out.push(`${f.field} ${OP_LABEL[f.op]} ${Array.isArray(f.value) ? f.value.join(',') : f.value}`);
  return out;
}

function TemplateCard({ tpl, isAdmin, onEdit, onCopy }: { tpl: RouteTemplate; isAdmin: boolean; onEdit: () => void; onCopy: () => void }) {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const label = useSpecLabel();
  const toast = useToast();
  const errText = useFlowError();
  const [showVersions, setShowVersions] = useState(false);
  const conds = conditionSummary(tpl.conditions, t as never, lang, (id) => (lk.department(id) ? loc(lk.department(id)!.name) : id));
  const m = (n: number) => formatMoneyShort(n, lang);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast(`${t('actionFailed')}: ${errText(e)}`);
    }
  };
  return (
    <Card
      title={
        <div className="tpl-head">
          <h2>{localize(tpl.name, lang)}</h2>
          <span className="tpl-badges">
            <Badge tone={tpl.active ? 'ok' : 'muted'}>{t(tpl.active ? 'flow_active' : 'flow_inactive')}</Badge>
            {tpl.system && <Badge tone="info">{t('flow_system')}</Badge>}
            <Badge tone="muted">{fmt(t('flow_version'), { n: tpl.version })}</Badge>
            <span className="small muted">
              {t('flow_priority')}: {tpl.priority}
            </span>
          </span>
        </div>
      }
      actions={
        isAdmin ? (
          <span className="toolbar">
            <Button size="small" onClick={onEdit}>{t('flow_edit')}</Button>
            <Button size="small" onClick={onCopy}>{t('flow_duplicate')}</Button>
            <Button size="small" onClick={() => act(() => approvalsApi.setTemplateActive(tpl.id, !tpl.active, user))}>{t(tpl.active ? 'flow_deactivate' : 'flow_activate')}</Button>
            {!tpl.system && (
              <Button size="small" danger onClick={() => act(() => approvalsApi.deleteTemplate(tpl.id, user))}>
                {t('flow_delete')}
              </Button>
            )}
          </span>
        ) : undefined
      }
    >
      <div className="tpl-body">
        <div className="small">
          <span className="muted">{t('flow_conditions')}: </span>
          {conds.length ? conds.join(' · ') : t('flow_always')}
        </div>
        <div className="route">
          {tpl.steps.map((s, i) => (
            <span key={s.id} style={{ display: 'contents' }}>
              {i > 0 && <span className="route-arrow">→</span>}
              <span className="route-step pending">
                <b>{i + 1}</b>
                <span className="route-step-text">
                  <span className="route-step-title">{s.name ? localize(s.name, lang) : s.approvers.map(label).join(' + ')}</span>
                  {s.name && <span className="route-step-sub">{s.approvers.map(label).join(' + ')}</span>}
                  <span className="route-step-sub">
                    {fmt(t('flow_sla_h'), { h: s.slaHours ?? 72 })}
                    {s.approvers.length > 1 && ` · ${t(s.mode === 'any' ? 'flow_mode_any' : 'flow_mode_all')}`}
                    {s.when?.amountGt !== undefined && ` · > ${m(s.when.amountGt)}`}
                  </span>
                </span>
              </span>
            </span>
          ))}
          {tpl.boardThreshold !== undefined && (
            <>
              <span className="route-arrow">→</span>
              <span className="route-step pending board">
                <b>+</b>
                <span className="route-step-text">
                  <span className="route-step-title">{label({ kind: 'committee', committee: tpl.boardCommittee ?? 'board' })}</span>
                  <span className="route-step-sub">&gt; {m(tpl.boardThreshold)}</span>
                </span>
              </span>
            </>
          )}
        </div>
        <div className="small muted">
          {tpl.distinctApprovers && <>{t('flow_distinct')} · </>}
          {formatDateTime(tpl.updatedAt)}
          {tpl.versionNote && ` · ${tpl.versionNote}`}
          {' · '}
          <Button type="link" size="small" onClick={() => setShowVersions((v) => !v)}>
            {t('flow_versions')} ({tpl.versions.length})
          </Button>
        </div>
        {showVersions && (
          <ul className="flow-events">
            {[...tpl.versions].reverse().map((v) => (
              <li key={v.version}>
                <Badge tone="muted">{fmt(t('flow_version'), { n: v.version })}</Badge>
                <span>{v.by ? (lk.user(v.by)?.fullName ?? v.by) : '—'}</span>
                <span className="muted small">{formatDateTime(v.at)}</span>
                {v.note && <div className="note">{v.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ApproverEditor({ spec, onChange, onRemove }: { spec: ApproverSpec; onChange: (s: ApproverSpec) => void; onRemove?: () => void }) {
  const { t, loc } = useSession();
  const lk = useLookups();
  const cms = useApi(() => approvalsApi.listCommittees(), []);
  const roleOptions = ROLES.map((r) => ({ value: r, label: t(tk('role_', r)) }));
  return (
    <div className="appr-row">
      <Select<ApproverKind> value={spec.kind} onChange={(k) => onChange(defaultSpec(k))} options={KINDS.map((k) => ({ value: k, label: t(tk('flow_kind_', k)) }))} ariaLabel={t('flow_approver')} />
      {(spec.kind === 'role' || spec.kind === 'branchRole') && <Select<Role> value={spec.role} onChange={(r) => onChange({ ...spec, role: r })} options={roleOptions} ariaLabel={t('flow_kind_role')} />}
      {spec.kind === 'user' && <Select value={spec.userId} onChange={(v) => onChange({ ...spec, userId: v })} options={lk.users.map((u) => ({ value: u.id, label: u.fullName }))} ariaLabel={t('flow_kind_user')} />}
      {spec.kind === 'departmentHead' && <Select value={spec.departmentId} onChange={(v) => onChange({ ...spec, departmentId: v })} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} ariaLabel={t('department')} />}
      {spec.kind === 'committee' && <Select<CommitteeId> value={spec.committee} onChange={(v) => onChange({ ...spec, committee: v })} options={(cms.data ?? []).map((c) => ({ value: c.id, label: loc(c.name) }))} ariaLabel={t('flow_kind_committee')} />}
      {onRemove && (
        <Button size="small" type="text" icon="x" onClick={onRemove} title={t('flow_remove')} />
      )}
    </div>
  );
}

function TemplateEditor({ draft, setDraft, onClose }: { draft: Draft; setDraft: (d: Draft) => void; onClose: () => void }) {
  const { t, lang, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const errText = useFlowError();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const c = draft.conditions;
  const setC = (patch: Partial<RouteCondition>) => {
    const next: RouteCondition = { ...c, ...patch };
    (Object.keys(next) as (keyof RouteCondition)[]).forEach((k) => {
      const v = next[k];
      if (v === undefined || (Array.isArray(v) && !v.length)) delete next[k];
    });
    setDraft({ ...draft, conditions: next });
  };
  const setStep = (i: number, patch: Partial<RouteStepTemplate>) => setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: number) => {
    const steps = [...draft.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(i + d, 0, s!);
    setDraft({ ...draft, steps });
  };
  const m = (n: number | undefined) => (n === undefined ? '' : formatMoneyShort(n, lang));

  async function save() {
    if (!draft.name.ru.trim()) return setError(t('flow_err_name'));
    if (!draft.steps.length || draft.steps.some((s) => !s.approvers.length)) return setError(t('flow_err_steps'));
    setBusy(true);
    try {
      const saved = await approvalsApi.saveTemplate({ ...draft, name: { ru: draft.name.ru.trim(), uz: draft.name.uz.trim() || draft.name.ru.trim(), ...(draft.name.en?.trim() ? { en: draft.name.en.trim() } : {}) } }, user, note.trim() || undefined);
      toast(fmt(t('flow_saved'), { n: saved.version }));
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width={760}
      title={draft.id ? `${t('flow_edit')}: ${localize(draft.name, lang)}` : t('flow_new_template')}
      footer={
        <>
          {error && <span className="error-text" style={{ marginRight: 'auto' }}>{error}</span>}
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" disabled={busy} onClick={save}>{t('save')}</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('flow_name_ru')} required>
          <Input value={draft.name.ru} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, ru: e.target.value } })} ariaLabel={t('flow_name_ru')} />
        </Field>
        <Field label={t('flow_name_uz')}>
          <Input value={draft.name.uz} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, uz: e.target.value } })} ariaLabel={t('flow_name_uz')} />
        </Field>
        <Field label={t('flow_name_en')}>
          <Input value={draft.name.en ?? ''} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, en: e.target.value } })} ariaLabel={t('flow_name_en')} />
        </Field>
        <Field label={t('flow_priority')}>
          <Input type="number" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })} ariaLabel={t('flow_priority')} />
        </Field>
      </div>
      <span className="flow-switch-row">
        <Switch checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} ariaLabel={t('flow_active')} />
        {t('flow_active')}
      </span>

      <div className="flow-section-title">{t('flow_conditions')}</div>
      <div className="form-grid">
        <Field label={t('flow_cond_amount_gt')} hint={m(c.amountGt)}>
          <Input type="number" value={c.amountGt ?? ''} onChange={(e) => setC({ amountGt: num(e.target.value) })} ariaLabel={t('flow_cond_amount_gt')} />
        </Field>
        <Field label={t('flow_cond_amount_lte')} hint={m(c.amountLte)}>
          <Input type="number" value={c.amountLte ?? ''} onChange={(e) => setC({ amountLte: num(e.target.value) })} ariaLabel={t('flow_cond_amount_lte')} />
        </Field>
        <Field label={t('flow_cond_subtypes')} hint={t('flow_cond_subtypes_hint')}>
          <Input value={(c.subtypes ?? []).join(', ')} onChange={(e) => setC({ subtypes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} ariaLabel={t('flow_cond_subtypes')} />
        </Field>
        <Field label={t('flow_cond_branches')}>
          <Input value={(c.branchIds ?? []).join(', ')} onChange={(e) => setC({ branchIds: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} ariaLabel={t('flow_cond_branches')} />
        </Field>
      </div>
      <Field label={t('flow_cond_departments')}>
        <div className="flow-checks">
          {lk.departments.map((d) => (
            <Checkbox key={d.id} checked={!!c.departmentIds?.includes(d.id)} onChange={(v) => setC({ departmentIds: v ? [...(c.departmentIds ?? []), d.id] : (c.departmentIds ?? []).filter((x) => x !== d.id) })}>
              {d.code}
            </Checkbox>
          ))}
        </div>
      </Field>
      <Field label={t('flow_cond_fields')}>
        <div className="flow-fields">
          {(c.fields ?? []).map((f, i) => (
            <div key={i} className="appr-row">
              <Input value={f.field} placeholder={t('flow_field_name')} onChange={(e) => setC({ fields: c.fields!.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })} />
              <Select<ConditionOp> value={f.op} onChange={(op) => setC({ fields: c.fields!.map((x, j) => (j === i ? { ...x, op } : x)) })} options={OPS.map((o) => ({ value: o, label: `${OP_LABEL[o]} (${o})` }))} ariaLabel={t('flow_op')} />
              <Input value={Array.isArray(f.value) ? f.value.join(',') : String(f.value)} placeholder={t('flow_value')} onChange={(e) => setC({ fields: c.fields!.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <Button size="small" type="text" icon="x" title={t('flow_remove')} onClick={() => setC({ fields: c.fields!.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Button size="small" icon="plus" onClick={() => setC({ fields: [...(c.fields ?? []), { field: '', op: 'eq', value: '' }] })}>
            {t('flow_add_field')}
          </Button>
        </div>
      </Field>

      <div className="flow-section-title">{t('flow_steps')}</div>
      {draft.steps.map((s, i) => (
        <div key={s.id} className="step-editor">
          <div className="step-editor-head">
            <b>{fmt(t('flow_step_n'), { n: i + 1 })}</b>
            <span className="toolbar">
              <Button size="small" type="text" disabled={i === 0} onClick={() => move(i, -1)}>{t('flow_move_up')}</Button>
              <Button size="small" type="text" disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)}>{t('flow_move_down')}</Button>
              <Button size="small" danger disabled={draft.steps.length === 1} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}>{t('flow_remove_step')}</Button>
            </span>
          </div>
          <div className="form-grid">
            <Field label={`${t('flow_step_name')} (ru)`}>
              <Input value={s.name?.ru ?? ''} onChange={(e) => setStep(i, e.target.value || s.name?.uz ? { name: { ru: e.target.value, uz: s.name?.uz ?? '' } } : { name: undefined })} ariaLabel={t('flow_step_name')} />
            </Field>
            <Field label={`${t('flow_step_name')} (uz)`}>
              <Input value={s.name?.uz ?? ''} onChange={(e) => setStep(i, { name: { ru: s.name?.ru ?? '', uz: e.target.value } })} />
            </Field>
          </div>
          <Field label={t('flow_approver')}>
            <div className="flow-fields">
              {s.approvers.map((a, j) => (
                <ApproverEditor key={j} spec={a} onChange={(spec) => setStep(i, { approvers: s.approvers.map((x, k) => (k === j ? spec : x)) })} {...(s.approvers.length > 1 ? { onRemove: () => setStep(i, { approvers: s.approvers.filter((_, k) => k !== j) }) } : {})} />
              ))}
              <Button size="small" icon="plus" onClick={() => setStep(i, { approvers: [...s.approvers, defaultSpec('role')], mode: s.mode ?? 'all' })}>
                {t('flow_add_approver')}
              </Button>
            </div>
          </Field>
          <div className="form-grid">
            {s.approvers.length > 1 && (
              <Field label={t('flow_parallel')}>
                <Select<'all' | 'any'> value={s.mode ?? 'all'} onChange={(v) => setStep(i, { mode: v })} options={[{ value: 'all', label: t('flow_mode_all') }, { value: 'any', label: t('flow_mode_any') }]} ariaLabel={t('flow_parallel')} />
              </Field>
            )}
            <Field label={t('flow_sla_hours')}>
              <Input type="number" value={s.slaHours ?? 72} onChange={(e) => setStep(i, { slaHours: Math.max(0, Number(e.target.value) || 0) })} ariaLabel={t('flow_sla_hours')} />
            </Field>
            <Field label={t('flow_step_when')} hint={m(s.when?.amountGt)}>
              <Input type="number" value={s.when?.amountGt ?? ''} onChange={(e) => { const v = num(e.target.value); setStep(i, v === undefined ? { when: undefined } : { when: { amountGt: v } }); }} ariaLabel={t('flow_step_when')} />
            </Field>
          </div>
        </div>
      ))}
      <Button icon="plus" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { id: `n${++stepSeq}-${Date.now()}`, approvers: [defaultSpec('role')], slaHours: 72 }] })}>
        {t('flow_add_step')}
      </Button>

      <div className="form-grid">
        <Field label={t('flow_board_threshold')} hint={m(draft.boardThreshold)}>
          <Input type="number" value={draft.boardThreshold ?? ''} onChange={(e) => setDraft({ ...draft, boardThreshold: num(e.target.value) })} ariaLabel={t('flow_board_threshold')} />
        </Field>
        <Field label={t('flow_board_committee')}>
          <Select<CommitteeId> value={draft.boardCommittee ?? 'board'} onChange={(v) => setDraft({ ...draft, boardCommittee: v })} options={COMMITTEES.map((id) => ({ value: id, label: t(tk('flow_kind_', 'committee')) + ` · ${id === 'board' ? loc({ ru: 'Правление', uz: 'Boshqaruv', en: 'Board' }) : loc({ ru: 'КК', uz: 'KQ', en: 'CC' })}` }))} ariaLabel={t('flow_board_committee')} />
        </Field>
      </div>
      <Checkbox checked={!!draft.distinctApprovers} onChange={(v) => setDraft({ ...draft, distinctApprovers: v })}>
        {t('flow_distinct')}
      </Checkbox>
      <Field label={t('flow_version_note')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} ariaLabel={t('flow_version_note')} />
      </Field>
      <div className="small muted">{t('flow_apply_note')}</div>
    </Drawer>
  );
}

function PreviewCard({ entity }: { entity: ApprovalEntity }) {
  const { t, lang } = useSession();
  const lk = useLookups();
  const [amount, setAmount] = useState('80000000');
  const [subtype, setSubtype] = useState('');
  const [requesterId, setRequesterId] = useState('u1');
  const context = { ...(num(amount) !== undefined ? { amount: num(amount) } : {}), ...(subtype ? { subtype } : {}), requesterId };
  const pv = useApi(() => approvalsApi.previewRoute(entity, context), [entity, amount, subtype, requesterId]);
  return (
    <Card title={t('flow_preview')}>
      <div className="small muted" style={{ marginBottom: 10 }}>{t('flow_preview_hint')}</div>
      <div className="form-grid">
        <Field label={t('flow_preview_amount')} hint={num(amount) !== undefined ? formatMoneyShort(num(amount)!, lang) : undefined}>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} ariaLabel={t('flow_preview_amount')} />
        </Field>
        <Field label={t('flow_preview_subtype')}>
          <Input value={subtype} onChange={(e) => setSubtype(e.target.value)} placeholder="direct / tender / …" ariaLabel={t('flow_preview_subtype')} />
        </Field>
        <Field label={t('flow_preview_requester')}>
          <Select value={requesterId} onChange={setRequesterId} options={lk.users.map((u) => ({ value: u.id, label: u.fullName }))} ariaLabel={t('flow_preview_requester')} />
        </Field>
      </div>
      <div className="preview-result">
        <div className="small" data-testid="preview-template">
          {pv.data?.templateName ? fmt(t('flow_preview_result'), { name: localize(pv.data.templateName, lang) }) : t('flow_preview_fallback')}
        </div>
        <RouteSteps preview={{ entity, context }} />
      </div>
    </Card>
  );
}

function CommitteesCard({ isAdmin }: { isAdmin: boolean }) {
  const { t, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const cms = useApi(() => approvalsApi.listCommittees(), []);
  const policy = useApi(() => approvalsApi.getBulkPolicy(), []);
  const toggle = (c: Committee, id: string, v: boolean) => approvalsApi.saveCommittee({ ...c, memberIds: v ? [...c.memberIds, id] : c.memberIds.filter((x) => x !== id) }, user);
  return (
    <>
      <Card title={t('flow_committees')}>
        {(cms.data ?? []).map((c) => (
          <div key={c.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{loc(c.name)}</div>
            <div className="flow-checks">
              {lk.users.filter((u) => u.active !== false).slice(0, 12).map((u) => (
                <Checkbox key={u.id} disabled={!isAdmin} checked={c.memberIds.includes(u.id)} onChange={(v) => toggle(c, u.id, v)}>
                  {u.fullName}
                </Checkbox>
              ))}
            </div>
          </div>
        ))}
      </Card>
      {policy.data && (
        <Card title={t('flow_bulk_policy')}>
          <div className="flow-checks">
            {APPROVAL_ENTITIES.map((e) => (
              <Checkbox key={e} disabled={!isAdmin} checked={policy.data!.entities.includes(e)} onChange={(v) => approvalsApi.setBulkPolicy({ ...policy.data!, entities: v ? [...policy.data!.entities, e] : policy.data!.entities.filter((x) => x !== e) }, user)}>
                {t(tk('entity_', e))}
              </Checkbox>
            ))}
          </div>
          <Field label={t('flow_bulk_max')}>
            <Input type="number" disabled={!isAdmin} value={policy.data.maxAmount} onChange={(e) => approvalsApi.setBulkPolicy({ ...policy.data!, maxAmount: Number(e.target.value) || 0 }, user)} ariaLabel={t('flow_bulk_max')} />
          </Field>
        </Card>
      )}
    </>
  );
}

export function RouteDesignerPage() {
  const { t } = useSession();
  const user = useUser();
  const query = useQuery();
  const isAdmin = user.role === 'admin' || !!user.extraRoles?.includes('admin');
  const [entity, setEntity] = useState<ApprovalEntity>((query.get('entity') as ApprovalEntity | null) ?? 'procurement');
  const list = useApi(() => approvalsApi.listTemplates(entity), [entity]);
  const all = useApi(() => approvalsApi.listTemplates(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const counts = useMemo(() => {
    const m = new Map<ApprovalEntity, number>();
    (all.data ?? []).forEach((x) => m.set(x.entity, (m.get(x.entity) ?? 0) + 1));
    return m;
  }, [all.data]);

  const toDraft = (tpl: RouteTemplate, copy = false): Draft => {
    const { version: _v, updatedAt: _u, versions: _vs, updatedBy: _b, versionNote: _n, ...rest } = clone(tpl);
    if (copy) {
      const { id: _id, system: _s, ...r } = rest;
      return { ...r, name: { ru: `${r.name.ru} (копия)`, uz: `${r.name.uz} (nusxa)`, ...(r.name.en ? { en: `${r.name.en} (copy)` } : {}) }, priority: r.priority + 1 };
    }
    return rest;
  };
  const blank = (): Draft => ({ entity, name: { ru: '', uz: '' }, priority: 10, active: true, conditions: {}, steps: [{ id: `n${++stepSeq}`, approvers: [defaultSpec('role')], slaHours: 72 }] });

  return (
    <>
      <PageHeader
        title={t('flow_designer_title')}
        subtitle={t('flow_designer_subtitle')}
        actions={isAdmin ? <Button type="primary" icon="plus" onClick={() => setDraft(blank())}>{t('flow_new_template')}</Button> : undefined}
      />
      <Card flush>
        <FilterBar>
          <Select<ApprovalEntity>
            value={entity}
            onChange={setEntity}
            ariaLabel={t('flow_entities')}
            style={{ width: 280 }}
            options={APPROVAL_ENTITIES.map((e) => ({ value: e, label: `${t(tk('entity_', e))} (${counts.get(e) ?? 0})` }))}
          />
          <span className="small muted">{t('flow_apply_note')}</span>
        </FilterBar>
      </Card>
      <div className="grid grid-main">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          {list.loading && !list.data ? (
            <Loading />
          ) : list.data?.length ? (
            [...list.data].sort((a, b) => b.priority - a.priority).map((tpl) => <TemplateCard key={tpl.id} tpl={tpl} isAdmin={isAdmin} onEdit={() => setDraft(toDraft(tpl))} onCopy={() => setDraft(toDraft(tpl, true))} />)
          ) : (
            <Card>
              <Empty text={t('empty')} icon="route" />
            </Card>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <PreviewCard entity={entity} />
          <CommitteesCard isAdmin={isAdmin} />
        </div>
      </div>
      {draft && <TemplateEditor draft={draft} setDraft={setDraft} onClose={() => setDraft(null)} />}
    </>
  );
}
