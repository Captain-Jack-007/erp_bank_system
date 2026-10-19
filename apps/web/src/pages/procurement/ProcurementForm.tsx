// Форма заявки на закупку (ТЗ 4.2.1.2, PR-PROC-001…013): вид закупки, номенклатура, спецификации, МВЗ,
// группа бизнес-плана, бюджет с резервом, способ закупки по правилу, ТЗ (вложения), верификация, маршрут.
import { useEffect, useMemo, useState } from 'react';
import {
  api, formatMoney, procApi, procRouteContext, procurementTotal, today, tk,
  type ProcurementItem, type ProcurementKind, type ProcurementMethod, type ProcVerification,
} from '@xb/shared';
import { Button, Card, Field, Input, PageHeader, RouteSteps, Select, Textarea, useToast } from '../../components/ui';
import { Attachments } from '../../components/Attachments';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { CostCenterSelect, useCostCenters, useErr } from './shared';
import { VerificationList, ProcessChips } from './parts';

const emptyItem = (unit: string): ProcurementItem => ({ name: '', qty: 1, unit, unitPrice: 0 });
export const PROC_METHODS: ProcurementMethod[] = ['direct', 'quotes', 'tender', 'exchange', 'e_shop', 'auction', 'special'];
export const PROC_KINDS: ProcurementKind[] = ['goods', 'services', 'works'];

export function ProcurementFormPage() {
  const { t, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useErr();
  const cc = useCostCenters();
  const catalog = useApi(() => procApi.listCatalog({ activeOnly: true }), []);
  const groups = useApi(() => procApi.listBusinessGroups(), []);
  const branchUser = !!user.orgUnitKey && /^R\d\d/.test(user.orgUnitKey);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ProcurementKind>('goods');
  const [departmentId, setDepartmentId] = useState(user.departmentId);
  const unit = branchUser ? user.orgUnitKey! : departmentId;
  const [costCenterKey, setCostCenterKey] = useState('');
  const [groupId, setGroupId] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [method, setMethod] = useState<ProcurementMethod>('quotes');
  const [neededBy, setNeededBy] = useState('');
  const [justification, setJustification] = useState('');
  const [items, setItems] = useState<ProcurementItem[]>(() => [emptyItem(t('unitDefault'))]);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<ProcVerification | null>(null);
  const [draftKey] = useState(() => `draft-${user.id}-${Date.now().toString(36)}`);

  // МВЗ по умолчанию: закреплённый за сотрудником, иначе первый МВЗ подразделения.
  useEffect(() => {
    if (costCenterKey && cc.rows.some((c) => c.key === costCenterKey && (c.orgUnitKey === unit || c.key === user.costCenterKey))) return;
    const def = user.costCenterKey ?? cc.forUnit(unit)[0]?.key ?? '';
    if (def !== costCenterKey) setCostCenterKey(def);
  }, [unit, cc.rows, costCenterKey, user.costCenterKey]);

  const total = procurementTotal(items);
  const budget = useApi(() => (budgetLineId ? procApi.budgetCheck(budgetLineId, total) : Promise.resolve(undefined)), [budgetLineId, total]);
  const group = groups.data?.find((g) => g.id === groupId);
  const lines = lk.budgetLines.filter((b) => !group || group.budgetLineIds.includes(b.id));
  const rec = procApi.recommendMethod(total, items, kind);
  const itemsValid = items.length > 0 && items.every((i) => i.name.trim() && i.qty > 0 && i.unitPrice > 0);
  const datePast = !!neededBy && neededBy < today();
  const valid = title.trim() && budgetLineId && neededBy && !datePast && justification.trim() && itemsValid && costCenterKey;
  const errOf = (ok: unknown) => (showErrors && !ok ? t('formRequired') : undefined);
  const setItem = (idx: number, patch: Partial<ProcurementItem>) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const ctx = useMemo(() => ({ amount: total, requesterId: user.id, ...procRouteContext({ method, kind, departmentId, items, budgetLineId }) }), [total, method, kind, departmentId, items, budgetLineId, user.id]);
  const catOptions = (catalog.data ?? []).filter((c) => (kind === 'goods' ? c.kind === 'goods' : c.kind !== 'goods')).map((c) => ({ value: c.id, label: `${c.code} · ${loc(c.name)}` }));

  function pickCatalog(idx: number, id: string) {
    const c = catalog.data?.find((x) => x.id === id);
    if (!c) return setItem(idx, { catalogId: undefined });
    setItem(idx, { catalogId: c.id, name: c.name.ru, unit: c.unit, unitPrice: c.refPrice, spec: c.spec ?? '' });
    if (!budgetLineId && c.budgetLineId) setBudgetLineId(c.budgetLineId);
  }

  const draft = () => ({ title: title.trim(), kind, departmentId, costCenterKey, ...(groupId ? { businessGroupId: groupId } : {}), budgetLineId, method, neededBy, justification: justification.trim(), items });

  async function verify() {
    const v = await procApi.verify(draft(), user, true);
    setVerification(v);
    return v;
  }

  async function save(submit: boolean) {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      const doc = await api.createProcurement({ ...draft(), submit, attachmentKey: draftKey }, user);
      toast(`${doc.number}: ${submit ? t('hist_submitted') : t('pstatus_draft')}`);
      navigate(`/procurement/${doc.id}`);
    } catch (e) {
      toast(`${t('actionFailed')}: ${err(e)}`);
      if (submit) await verify();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader crumbs={[{ label: t('navProcurement'), to: '/procurement' }, { label: t('newRequest') }]} title={t('newRequest')} subtitle={t('proc_formSub')} />

      <Card title={t('details')}>
        <div className="form-grid">
          <Field label={t('title')} required error={errOf(title.trim())} className="span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} ariaLabel={t('title')} />
          </Field>
          <Field label={t('proc_kind')} required hint={t('proc_kindHint')}>
            <Select<ProcurementKind> value={kind} onChange={setKind} options={PROC_KINDS.map((k) => ({ value: k, label: t(tk('proc_kind_', k)) }))} ariaLabel={t('proc_kind')} />
          </Field>
          <Field label={t('department')} required>
            <Select<string> value={departmentId} onChange={setDepartmentId} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} ariaLabel={t('department')} />
          </Field>
          <Field label={t('proc_costCenter')} required error={errOf(costCenterKey)} hint={t('proc_costCenterHint')}>
            <CostCenterSelect value={costCenterKey} onChange={setCostCenterKey} unit={unit} ariaLabel={t('proc_costCenter')} />
          </Field>
          <Field label={t('proc_bpGroup')} hint={t('proc_bpGroupHint')}>
            <Select<string> value={groupId} onChange={(v) => { setGroupId(v); setBudgetLineId(''); }} placeholder={t('all')} options={(groups.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${loc(g.name)}` }))} ariaLabel={t('proc_bpGroup')} />
          </Field>
          <Field
            label={t('budgetLine')}
            required
            error={errOf(budgetLineId)}
            hint={budget.data ? `${t('proc_budgetAvailable')}: ${formatMoney(budget.data.available)} (${t('proc_reserved')}: ${formatMoney(budget.data.reserved)})` : undefined}
          >
            <Select<string> value={budgetLineId} onChange={setBudgetLineId} placeholder="—" options={lines.map((b) => ({ value: b.id, label: `${b.code} · ${loc(b.name)}` }))} ariaLabel={t('budgetLine')} />
          </Field>
          <Field label={t('method')} required hint={`${t('proc_recommended')}: ${t(tk('method_', rec.method))} — ${t(rec.reason as 'proc_rule_small')}`}>
            <Select<ProcurementMethod> value={method} onChange={setMethod} options={PROC_METHODS.map((m) => ({ value: m, label: t(tk('method_', m)) }))} ariaLabel={t('method')} />
          </Field>
          <Field label={t('neededBy')} required error={errOf(neededBy) ?? (datePast ? t('dateInPast') : undefined)}>
            <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} ariaLabel={t('neededBy')} />
          </Field>
          <Field label={t('justification')} required error={errOf(justification.trim())} className="span-2">
            <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} ariaLabel={t('justification')} />
          </Field>
        </div>
      </Card>

      <Card
        title={t('items')}
        actions={
          <Button size="small" icon="plus" onClick={() => setItems((l) => [...l, emptyItem(t('unitDefault'))])}>
            {t('addItem')}
          </Button>
        }
        flush
      >
        <div className="table-wrap">
          <table className="table items-table">
            <thead>
              <tr>
                <th style={{ width: '46%' }}>{t('itemName')} / {t('proc_spec')}</th>
                <th style={{ width: 90 }}>{t('qty')}</th>
                <th style={{ width: 80 }}>{t('unit')}</th>
                <th style={{ width: 160 }}>{t('unitPrice')}</th>
                <th className="right">{t('amount')}</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const ref = catalog.data?.find((c) => c.id === it.catalogId);
                return (
                  <tr key={i}>
                    <td>
                      <div className="pc-item-cell">
                        <Select<string> value={it.catalogId ?? ''} onChange={(v) => pickCatalog(i, v)} placeholder={t('proc_fromCatalog')} options={catOptions} ariaLabel={t('proc_fromCatalog')} />
                        <Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} ariaLabel={t('itemName')} />
                        <Textarea value={it.spec ?? ''} rows={2} placeholder={t('proc_specPh')} onChange={(e) => setItem(i, { spec: e.target.value })} ariaLabel={t('proc_spec')} />
                        {ref && it.unitPrice > ref.refPrice * 1.3 && <span className="error-text">{t('proc_priceAboveRef')}: {formatMoney(ref.refPrice)}</span>}
                      </div>
                    </td>
                    <td><Input type="number" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} ariaLabel={t('qty')} /></td>
                    <td><Input value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} ariaLabel={t('unit')} /></td>
                    <td><Input type="number" value={it.unitPrice || ''} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) })} ariaLabel={t('unitPrice')} /></td>
                    <td className="right num">{formatMoney(it.qty * it.unitPrice)}</td>
                    <td>
                      <Button type="text" size="small" icon="trash" disabled={items.length === 1} onClick={() => setItems((l) => l.filter((_, j) => j !== i))} title={t('proc_removeItem')} />
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={4} className="right" style={{ fontWeight: 700 }}>{t('total')}</td>
                <td className="right num" style={{ fontWeight: 700 }}>{formatMoney(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        {showErrors && !itemsValid && <p className="error-text" style={{ padding: '0 14px 14px', margin: 0 }}>{t('formRequired')}</p>}
        {budget.data && !budget.data.ok && <p className="error-text" style={{ padding: '0 14px 14px', margin: 0 }}>{t('amount')} &gt; {t('budgetLeft').toLowerCase()}</p>}
      </Card>

      <div className="grid grid-2">
        <Attachments entity="procurement" entityId={draftKey} title={t('proc_tzAttachments')} />
        <Card title={t('proc_verification')} actions={<Button size="small" icon="check" onClick={verify}>{t('proc_verify')}</Button>}>
          {verification ? <VerificationList v={verification} /> : <p className="muted small" style={{ margin: 0 }}>{t('proc_verifyHint')}</p>}
        </Card>
      </div>

      <Card title={t('proc_process')}>
        <ProcessChips steps={procApi.processPlan({ method, kind, items })} />
      </Card>

      <Card title={t('route')}>
        <RouteSteps preview={{ entity: 'procurement', context: ctx }} />
      </Card>

      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate('/procurement')}>{t('cancel')}</Button>
        <Button disabled={busy} onClick={() => save(false)}>{t('saveDraft')}</Button>
        <Button type="primary" disabled={busy} onClick={() => save(true)}>{t('submitForApproval')}</Button>
      </div>
    </>
  );
}
