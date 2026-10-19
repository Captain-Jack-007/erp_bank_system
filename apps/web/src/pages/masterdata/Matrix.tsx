// Матрица согласования изменений справочников (PR-MDM-003): правила = шаблоны маршрутов движка для mdm_change.
// Условие правила — вид объекта (номенклатура / оргединица / МВЗ), вид номенклатуры (товар / услуга / работа),
// категории; этапы — роль, руководитель подразделения или руководитель инициатора; подпись E-IMZO согласующих.
// Изменять может администратор (версия шаблона и журнал аудита ведёт движок), остальные — просмотр и проверка маршрута.
import { useState } from 'react';
import { approvalsApi, ROLES, tk, type ApproverSpec, type FieldCondition, type ProcItemCategory, type ProcurementKind, type Role, type RouteTemplate, type TKey } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Field, Input, Modal, RouteSteps, Select, Switch, useToast } from '../../components/ui';
import { useFlowError } from '../../components/flow';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import './mdm.css';

const KINDS: ProcurementKind[] = ['goods', 'services', 'works'];
const CATEGORIES: ProcItemCategory[] = ['it_hw', 'software', 'office', 'furniture', 'household', 'security', 'vehicles', 'construction', 'services', 'utilities'];
type ObjectType = '' | 'nomenclature' | 'org_unit' | 'cost_center';
type StepForm = { type: 'role' | 'departmentHead' | 'initiatorHead'; role: Role; departmentId: string; name: string };
type RuleForm = { id?: string; nameRu: string; nameUz: string; nameEn: string; objectType: ObjectType; kinds: string[]; categories: string[]; steps: StepForm[]; requireSignature: boolean; priority: number; active: boolean; system: boolean };

const fieldOf = (t: RouteTemplate, name: string): FieldCondition | undefined => t.conditions.fields?.find((f) => f.field === name);
const listOf = (f?: FieldCondition): string[] => (!f ? [] : Array.isArray(f.value) ? f.value.map(String) : [String(f.value)]);

function toForm(tpl?: RouteTemplate): RuleForm {
  if (!tpl) return { nameRu: '', nameUz: '', nameEn: '', objectType: 'nomenclature', kinds: ['goods'], categories: [], steps: [{ type: 'role', role: 'accountant', departmentId: 'd1', name: '' }, { type: 'role', role: 'admin', departmentId: 'd1', name: '' }], requireSignature: true, priority: 10, active: true, system: false };
  return {
    id: tpl.id,
    nameRu: tpl.name.ru,
    nameUz: tpl.name.uz,
    nameEn: tpl.name.en ?? '',
    objectType: (listOf(fieldOf(tpl, 'objectType'))[0] ?? '') as ObjectType,
    kinds: listOf(fieldOf(tpl, 'itemKind')),
    categories: listOf(fieldOf(tpl, 'category')),
    steps: tpl.steps.map((s) => {
      const a = s.approvers[0];
      return { type: a?.kind === 'departmentHead' ? 'departmentHead' : a?.kind === 'initiatorHead' ? 'initiatorHead' : 'role', role: a?.kind === 'role' ? a.role : 'admin', departmentId: a?.kind === 'departmentHead' ? a.departmentId : 'd1', name: s.name?.ru ?? '' };
    }),
    requireSignature: !!tpl.requireSignature,
    priority: tpl.priority,
    active: tpl.active,
    system: !!tpl.system,
  };
}

export function MatrixTab() {
  const { t, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const flowErr = useFlowError();
  const list = useApi(() => approvalsApi.listTemplates('mdm_change'));
  const [edit, setEdit] = useState<RuleForm | null>(null);
  const [pv, setPv] = useState<{ objectType: string; itemKind: string; category: string }>({ objectType: 'nomenclature', itemKind: 'goods', category: 'it_hw' });
  const isAdmin = user.role === 'admin';
  const approver = (a: ApproverSpec): string =>
    a.kind === 'role' ? t(tk('role_', a.role) as TKey) : a.kind === 'departmentHead' ? `${t('mdm_mx_deptHead')}: ${lk.department(a.departmentId) ? loc(lk.department(a.departmentId)!.name) : a.departmentId}` : a.kind === 'initiatorHead' ? t('mdm_mx_initiatorHead') : a.kind === 'user' ? lk.user(a.userId)?.fullName ?? a.userId : a.kind;
  const appliesTo = (r: RouteTemplate): string => {
    if (r.system) return t('mdm_mx_default');
    const obj = listOf(fieldOf(r, 'objectType'))[0];
    const parts = [obj ? t(tk('mdm_entity_', obj) as TKey) : t('mdm_mx_any')];
    const kinds = listOf(fieldOf(r, 'itemKind'));
    const cats = listOf(fieldOf(r, 'category'));
    if (kinds.length) parts.push(kinds.map((k) => t(tk('proc_kind_', k) as TKey)).join(', '));
    if (cats.length) parts.push(cats.map((c) => t(tk('proc_cat_', c) as TKey)).join(', '));
    return parts.join(' · ');
  };
  const rows = [...(list.data ?? [])].sort((a, b) => b.priority - a.priority);

  async function toggle(r: RouteTemplate, v: boolean) {
    try {
      await approvalsApi.setTemplateActive(r.id, v, user);
      toast(t('saved'));
    } catch (e) {
      toast(flowErr(e));
    }
  }

  return (
    <div className="pc-stack" style={{ padding: 14, display: 'grid', gap: 14 }}>
      <Card title={t('mdm_mx_title')} actions={isAdmin ? <Button size="small" type="primary" icon="plus" onClick={() => setEdit(toForm())}>{t('mdm_mx_add')}</Button> : undefined} flush>
        <p className="muted small" style={{ padding: '0 14px' }}>{t('mdm_mx_hint')}{isAdmin ? '' : ` ${t('mdm_mx_readonly')}.`}</p>
        <DataTable<RouteTemplate>
          rows={rows}
          loading={list.loading}
          rowKey={(r) => r.id}
          onRowClick={isAdmin ? (r) => setEdit(toForm(r)) : undefined}
          columns={[
            { header: t('mdm_mx_name'), render: (r) => <><div>{loc(r.name)}</div><div className="sub">{t('mdm_mx_version')} {r.version} · {t('mdm_mx_priority')} {r.priority}</div></> },
            { header: t('mdm_mx_appliesTo'), render: (r) => <span className="small">{appliesTo(r)}</span> },
            { header: t('mdm_mx_steps'), render: (r) => <ol className="mdm-mx-steps">{r.steps.map((s) => <li key={s.id}>{s.name ? `${loc(s.name)} — ` : ''}{s.approvers.map(approver).join(' / ')}</li>)}</ol> },
            { header: 'E-IMZO', render: (r) => (r.requireSignature ? <Badge tone="ok">E-IMZO</Badge> : <span className="muted">—</span>) },
            { header: t('mdm_mx_active'), render: (r) => (isAdmin ? <span onClick={(e) => e.stopPropagation()}><Switch checked={r.active} onChange={(v) => void toggle(r, v)} /></span> : r.active ? '✓' : '—') },
          ]}
        />
      </Card>
      <Card title={t('mdm_mx_preview')}>
        <p className="muted small" style={{ marginTop: 0 }}>{t('mdm_mx_previewHint')}</p>
        <div className="form-grid">
          <Field label={t('mdm_mx_object')}>
            <Select value={pv.objectType} onChange={(v) => setPv({ ...pv, objectType: v })} ariaLabel={t('mdm_mx_object')} options={(['nomenclature', 'org_unit', 'cost_center'] as const).map((o) => ({ value: o, label: t(tk('mdm_entity_', o) as TKey) }))} />
          </Field>
          {pv.objectType === 'nomenclature' && (
            <>
              <Field label={t('mdm_mx_kinds')}>
                <Select value={pv.itemKind} onChange={(v) => setPv({ ...pv, itemKind: v })} ariaLabel={t('mdm_mx_kinds')} options={KINDS.map((k) => ({ value: k, label: t(tk('proc_kind_', k) as TKey) }))} />
              </Field>
              <Field label={t('mdf_category')}>
                <Select value={pv.category} onChange={(v) => setPv({ ...pv, category: v })} ariaLabel={t('mdf_category')} options={CATEGORIES.map((c) => ({ value: c, label: t(tk('proc_cat_', c) as TKey) }))} />
              </Field>
            </>
          )}
        </div>
        <RouteSteps preview={{ entity: 'mdm_change', context: pv.objectType === 'nomenclature' ? { objectType: pv.objectType, itemKind: pv.itemKind, category: pv.category } : { objectType: pv.objectType } }} />
      </Card>
      {edit && <RuleModal form={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RuleModal({ form, onClose }: { form: RuleForm; onClose: () => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const flowErr = useFlowError();
  const [f, setF] = useState<RuleForm>(form);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<RuleForm>) => setF((x) => ({ ...x, ...p }));
  const setStep = (i: number, p: Partial<StepForm>) => set({ steps: f.steps.map((s, n) => (n === i ? { ...s, ...p } : s)) });
  const toggleIn = (arr: string[], v: string, on: boolean) => (on ? [...new Set([...arr, v])] : arr.filter((x) => x !== v));

  async function save() {
    setError('');
    if (!f.nameRu.trim() || !f.nameUz.trim() || !f.steps.length) {
      setError(t('formRequired'));
      return;
    }
    const fields: FieldCondition[] = [];
    if (f.objectType) fields.push({ field: 'objectType', op: 'eq', value: f.objectType });
    if (f.objectType === 'nomenclature' && f.kinds.length) fields.push({ field: 'itemKind', op: 'in', value: f.kinds });
    if (f.objectType === 'nomenclature' && f.categories.length) fields.push({ field: 'category', op: 'in', value: f.categories });
    const steps = f.steps.map((s, i) => {
      const a: ApproverSpec = s.type === 'role' ? { kind: 'role', role: s.role } : s.type === 'departmentHead' ? { kind: 'departmentHead', departmentId: s.departmentId } : { kind: 'initiatorHead' };
      return { id: `s${i + 1}`, approvers: [a], slaHours: 48, ...(s.name.trim() ? { name: { ru: s.name.trim(), uz: s.name.trim(), en: s.name.trim() } } : {}) };
    });
    setBusy(true);
    try {
      await approvalsApi.saveTemplate({ ...(f.id ? { id: f.id } : {}), entity: 'mdm_change', name: { ru: f.nameRu.trim(), uz: f.nameUz.trim(), en: f.nameEn.trim() || f.nameRu.trim() }, priority: f.system ? 0 : f.priority, active: f.active, conditions: f.system ? {} : { fields }, steps, distinctApprovers: true, requireSignature: f.requireSignature, ...(f.system ? { system: true } : {}) }, user, 'MDM matrix');
      toast(t('saved'));
      onClose();
    } catch (e) {
      setError(flowErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${t('mdm_mx_edit')}${f.id ? `: ${f.nameRu}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={save}>{t('save')}</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={`${t('mdm_mx_name')} (RU)`} required className="span-2"><Input value={f.nameRu} onChange={(e) => set({ nameRu: e.target.value })} ariaLabel="name-ru" /></Field>
        <Field label={`${t('mdm_mx_name')} (UZ)`} required><Input value={f.nameUz} onChange={(e) => set({ nameUz: e.target.value })} ariaLabel="name-uz" /></Field>
        <Field label={`${t('mdm_mx_name')} (EN)`}><Input value={f.nameEn} onChange={(e) => set({ nameEn: e.target.value })} ariaLabel="name-en" /></Field>
        {!f.system && (
          <>
            <Field label={t('mdm_mx_object')}>
              <Select<ObjectType> value={f.objectType} onChange={(v) => set({ objectType: v })} ariaLabel={t('mdm_mx_object')} options={[{ value: '', label: t('mdm_mx_any') }, ...(['nomenclature', 'org_unit', 'cost_center'] as const).map((o) => ({ value: o, label: t(tk('mdm_entity_', o) as TKey) }))]} />
            </Field>
            <Field label={t('mdm_mx_priority')}><Input type="number" value={f.priority} onChange={(e) => set({ priority: Number(e.target.value) || 0 })} ariaLabel={t('mdm_mx_priority')} /></Field>
          </>
        )}
      </div>
      {!f.system && f.objectType === 'nomenclature' && (
        <>
          <Field label={t('mdm_mx_kinds')}>
            <div className="mdm-mx-checks">{KINDS.map((k) => <Checkbox key={k} checked={f.kinds.includes(k)} onChange={(v) => set({ kinds: toggleIn(f.kinds, k, v) })}>{t(tk('proc_kind_', k) as TKey)}</Checkbox>)}</div>
          </Field>
          <Field label={t('mdm_mx_categories')}>
            <div className="mdm-mx-checks">{CATEGORIES.map((c) => <Checkbox key={c} checked={f.categories.includes(c)} onChange={(v) => set({ categories: toggleIn(f.categories, c, v) })}>{t(tk('proc_cat_', c) as TKey)}</Checkbox>)}</div>
          </Field>
        </>
      )}
      <Field label={t('mdm_mx_steps')} required>
        <div className="mdm-mx-step-list">
          {f.steps.map((s, i) => (
            <div key={i} className="mdm-mx-step">
              <span className="doc-num">{i + 1}</span>
              <Select<StepForm['type']> value={s.type} onChange={(v) => setStep(i, { type: v })} ariaLabel={t('mdm_mx_approverType')} options={[{ value: 'role', label: t('mdm_mx_role') }, { value: 'departmentHead', label: t('mdm_mx_deptHead') }, { value: 'initiatorHead', label: t('mdm_mx_initiatorHead') }]} />
              {s.type === 'role' && <Select<Role> value={s.role} onChange={(v) => setStep(i, { role: v })} ariaLabel={t('mdm_mx_role')} options={ROLES.map((r) => ({ value: r, label: t(tk('role_', r) as TKey) }))} />}
              {s.type === 'departmentHead' && <Select value={s.departmentId} onChange={(v) => setStep(i, { departmentId: v })} ariaLabel={t('mdm_mx_deptHead')} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} />}
              <Input value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} placeholder={t('mdm_mx_stepName')} ariaLabel={t('mdm_mx_stepName')} />
              <Button size="small" icon="trash" disabled={f.steps.length <= 1} onClick={() => set({ steps: f.steps.filter((_, n) => n !== i) })} />
            </div>
          ))}
          <Button size="small" icon="plus" onClick={() => set({ steps: [...f.steps, { type: 'role', role: 'admin', departmentId: 'd1', name: '' }] })}>{t('mdm_mx_addStep')}</Button>
        </div>
      </Field>
      <div className="mdm-mx-checks">
        <Checkbox checked={f.requireSignature} onChange={(v) => set({ requireSignature: v })}>{t('mdm_mx_sign')}</Checkbox>
        <Checkbox checked={f.active} onChange={(v) => set({ active: v })}>{t('mdm_mx_active')}</Checkbox>
      </div>
      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}
