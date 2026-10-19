// Ручной ввод договора (PR-CON-016, 019…022, 026): вид и подвид, контрагент с проверкой допуска,
// шаблон с подстановкой реквизитов, подразделения-инициаторы, МВЗ, условия оплаты и редактируемый график,
// этапы и обязательства по приёмке, неустойка; доходные договоры банка и платежи без договора по инвойсу.
import { useEffect, useMemo, useState } from 'react';
import {
  CONTRACT_KINDS, CONTRACT_SUBKINDS, contractsApi, formatMoney, generateSchedule, supplierAdmission, tk,
  type ContractKind, type ContractPayment, type ContractPaymentTerms, type ContractStage, type ContractSubkind, type PaymentTermsType,
} from '@xb/shared';
import { Button, Card, Checkbox, Field, Input, PageHeader, RouteSteps, Select, Textarea, useToast } from '../../components/ui';
import { navigate, useQuery } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { CostCenterSelect, plusDays, todayIso, useCostCenters, useErr } from '../procurement/shared';

const TERMS: PaymentTermsType[] = ['full', 'advance', 'periodic', 'by_invoice', 'by_act'];
type StageDraft = Omit<ContractStage, 'id' | 'status'>;

export function ContractFormPage() {
  const { t, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useErr();
  const query = useQuery();
  const tpls = useApi(() => contractsApi.listTemplates(), []);
  const kindSettings = useApi(() => contractsApi.listKindSettings(), []);
  const initiators = useApi(() => contractsApi.initiatorDepts(), []);
  const [kind, setKind] = useState<ContractKind>((query.get('kind') as ContractKind | null) ?? 'services');
  const [subkind, setSubkind] = useState<ContractSubkind | ''>('');
  const [subject, setSubject] = useState('');
  const [counterpartyId, setCp] = useState('');
  const [departmentId, setDept] = useState(user.departmentId);
  const [extra, setExtra] = useState<string[]>([]);
  const [costCenterKey, setCc] = useState(user.costCenterKey ?? '');
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState<'UZS' | 'USD' | 'EUR'>('UZS');
  const [startDate, setStart] = useState(todayIso());
  const [endDate, setEnd] = useState(plusDays(365));
  const [terms, setTerms] = useState<ContractPaymentTerms>({ type: 'advance', advancePct: 30 });
  const [templateId, setTemplateId] = useState('');
  const [objectInfo, setObjectInfo] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [penaltyRate, setPenaltyRate] = useState(0.1);
  const [penaltyCap, setPenaltyCap] = useState(10);
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [schedule, setSchedule] = useState<ContractPayment[] | null>(null);
  const [showErr, setShowErr] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = kindSettings.data?.find((k) => k.kind === kind);
    if (s) setTerms(s.defaultTerms);
    const tpl = tpls.data?.find((x) => x.kind === kind);
    setTemplateId(tpl?.id ?? '');
    if (tpl) {
      setPenaltyRate(tpl.penalty.ratePerDay);
      setPenaltyCap(tpl.penalty.capPct);
    }
    setSubkind(CONTRACT_SUBKINDS[kind]?.[0] ?? '');
    if (kind === 'swift' && currency === 'UZS') setCurrency('USD');
    setSchedule(null);
  }, [kind, kindSettings.data, tpls.data]);

  useEffect(() => {
    if (initiators.data && !initiators.data.includes(departmentId)) setDept(initiators.data[0] ?? departmentId);
  }, [initiators.data]);

  const ccs = useCostCenters();
  useEffect(() => {
    if (!ccs.rows.length) return;
    if (costCenterKey && ccs.rows.some((c) => c.key === costCenterKey && (c.orgUnitKey === departmentId || c.key === user.costCenterKey))) return;
    const def = ccs.forUnit(departmentId)[0]?.key ?? '';
    if (def !== costCenterKey) setCc(def);
  }, [departmentId, ccs.rows]);

  const generated = useMemo(() => (amount > 0 && startDate && endDate >= startDate ? generateSchedule(terms, amount, startDate, endDate) : []), [terms, amount, startDate, endDate]);
  const payments = schedule ?? generated;
  const sum = payments.reduce((s, p) => s + p.amount, 0);
  const admission = counterpartyId && kind !== 'bank_services' ? supplierAdmission(counterpartyId) : undefined;
  const cps = lk.counterparties.filter((c) => (kind === 'swift' ? c.type === 'foreign' : true));
  const req = (ok: unknown) => (showErr && !ok ? t('formRequired') : undefined);
  const setPay = (i: number, p: Partial<ContractPayment>) => setSchedule(payments.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function save(submit: boolean) {
    if (!subject.trim() || !counterpartyId || !(amount > 0) || !costCenterKey || endDate < startDate) {
      setShowErr(true);
      return;
    }
    setBusy(true);
    try {
      const c = await contractsApi.createManual(
        {
          kind, ...(subkind ? { subkind } : {}), subject, counterpartyId, departmentId, initiatorDeptIds: extra, costCenterKey, amount, currency, startDate, endDate, paymentTerms: terms,
          ...(templateId ? { templateId } : {}), ...(objectInfo ? { objectInfo } : {}), ...(kind === 'other_receivables' ? { invoiceRef: { number: invoiceNo, date: invoiceDate } } : {}),
          penalty: { ratePerDay: penaltyRate, capPct: penaltyCap }, payments, stages, submit,
        },
        user,
      );
      toast(`${c.number}: ${t(tk('cstatus_', c.status))}`);
      navigate(`/contracts/${c.id}`);
    } catch (e) {
      toast(`${t('actionFailed')}: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader crumbs={[{ label: t('navContracts'), to: '/contracts' }, { label: t('con_new') }]} title={t('con_new')} subtitle={t('con_newSub')} />
      <Card title={t('details')}>
        <div className="form-grid">
          <Field label={t('con_kind')} required>
            <Select<ContractKind> value={kind} onChange={setKind} options={CONTRACT_KINDS.map((k) => ({ value: k, label: t(tk('con_kind_', k)) }))} ariaLabel={t('con_kind')} />
          </Field>
          {CONTRACT_SUBKINDS[kind] ? (
            <Field label={t('con_subkind')} required>
              <Select<ContractSubkind> value={subkind as ContractSubkind} onChange={setSubkind} options={(CONTRACT_SUBKINDS[kind] ?? []).map((s) => ({ value: s, label: t(tk('con_sub_', s)) }))} ariaLabel={t('con_subkind')} />
            </Field>
          ) : <div />}
          <Field label={t('subject')} required error={req(subject.trim())} className="span-2">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} ariaLabel={t('subject')} />
          </Field>
          <Field label={kind === 'bank_services' ? t('con_buyer') : t('counterparty')} required error={req(counterpartyId)}>
            <Select<string> value={counterpartyId} onChange={setCp} placeholder="—" options={cps.map((c) => ({ value: c.id, label: `${c.name} · ${c.tin}` }))} ariaLabel={t('counterparty')} />
          </Field>
          <Field label={t('con_template')} hint={t('con_templateHint')}>
            <Select<string> value={templateId} onChange={setTemplateId} placeholder="—" options={(tpls.data ?? []).map((x) => ({ value: x.id, label: loc(x.name) }))} ariaLabel={t('con_template')} />
          </Field>
          {admission && !admission.allowed && <div className="pc-danger span-2">{t('proc_supplierNotAllowed')}: {admission.reasons.map((r) => t(tk('proc_list_', r))).join(', ')}</div>}
          <Field label={t('con_initiator')} required>
            <Select<string> value={departmentId} onChange={setDept} options={lk.departments.filter((d) => initiators.data?.includes(d.id)).map((d) => ({ value: d.id, label: loc(d.name) }))} ariaLabel={t('con_initiator')} />
          </Field>
          <Field label={t('proc_costCenter')} required error={req(costCenterKey)}>
            <CostCenterSelect value={costCenterKey} onChange={setCc} unit={departmentId} ariaLabel={t('proc_costCenter')} />
          </Field>
          <Field label={t('con_extraInitiators')} className="span-2">
            <div className="pc-row">
              {lk.departments.filter((d) => initiators.data?.includes(d.id) && d.id !== departmentId).map((d) => (
                <Checkbox key={d.id} checked={extra.includes(d.id)} onChange={(v) => setExtra((x) => (v ? [...x, d.id] : x.filter((y) => y !== d.id)))}>{d.code}</Checkbox>
              ))}
            </div>
          </Field>
          <Field label={t('amount')} required error={showErr && !(amount > 0) ? t('amountPositive') : undefined} hint={formatMoney(amount || 0, currency)}>
            <Input type="number" value={amount || ''} onChange={(e) => { setAmount(Number(e.target.value)); setSchedule(null); }} ariaLabel={t('amount')} />
          </Field>
          <Field label={t('con_currency')} required>
            <Select<'UZS' | 'USD' | 'EUR'> value={currency} onChange={setCurrency} options={[{ value: 'UZS', label: 'UZS' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }]} ariaLabel={t('con_currency')} />
          </Field>
          <Field label={t('startDate')} required>
            <Input type="date" value={startDate} onChange={(e) => { setStart(e.target.value); setSchedule(null); }} ariaLabel={t('startDate')} />
          </Field>
          <Field label={t('endDate')} required error={showErr && endDate < startDate ? t('endBeforeStart') : undefined}>
            <Input type="date" value={endDate} onChange={(e) => { setEnd(e.target.value); setSchedule(null); }} ariaLabel={t('endDate')} />
          </Field>
          {['rent', 'utilities', 'construction'].includes(kind) && (
            <Field label={t('con_objectInfo')} className="span-2">
              <Input value={objectInfo} onChange={(e) => setObjectInfo(e.target.value)} ariaLabel={t('con_objectInfo')} />
            </Field>
          )}
          {kind === 'other_receivables' && (
            <>
              <Field label={t('con_invoiceNo')} required><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} ariaLabel={t('con_invoiceNo')} /></Field>
              <Field label={t('con_invoiceDate')} required><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} ariaLabel={t('con_invoiceDate')} /></Field>
            </>
          )}
        </div>
      </Card>

      <Card title={t('con_paymentTerms')}>
        <div className="form-grid">
          <Field label={t('con_terms')} required>
            <Select<PaymentTermsType> value={terms.type} onChange={(v) => { setTerms({ ...terms, type: v }); setSchedule(null); }} options={TERMS.map((x) => ({ value: x, label: t(tk('con_terms_', x)) }))} ariaLabel={t('con_terms')} />
          </Field>
          {(terms.type === 'advance' || terms.type === 'by_act') && (
            <Field label={t('con_advancePct')}>
              <Input type="number" value={terms.advancePct ?? 0} onChange={(e) => { setTerms({ ...terms, advancePct: Number(e.target.value) }); setSchedule(null); }} ariaLabel={t('con_advancePct')} />
            </Field>
          )}
          {(terms.type === 'periodic' || terms.type === 'by_invoice') && (
            <Field label={t('con_periodicity')}>
              <Select<'monthly' | 'quarterly'> value={terms.periodicity ?? 'monthly'} onChange={(v) => { setTerms({ ...terms, periodicity: v }); setSchedule(null); }} options={[{ value: 'monthly', label: t('con_monthly') }, { value: 'quarterly', label: t('con_quarterly') }]} ariaLabel={t('con_periodicity')} />
            </Field>
          )}
          <Field label={t('con_penaltyRate')}><Input type="number" value={penaltyRate} onChange={(e) => setPenaltyRate(Number(e.target.value))} ariaLabel={t('con_penaltyRate')} /></Field>
          <Field label={t('con_penaltyCap')}><Input type="number" value={penaltyCap} onChange={(e) => setPenaltyCap(Number(e.target.value))} ariaLabel={t('con_penaltyCap')} /></Field>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table pc-mini-table">
            <thead>
              <tr><th>#</th><th>{t('date')}</th><th>{t('con_payKind')}</th><th className="right">{t('amount')}</th><th /></tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td><Input type="date" className="pc-sched-input" value={p.dueDate} onChange={(e) => setPay(i, { dueDate: e.target.value })} ariaLabel={t('date')} /></td>
                  <td className="muted small">{t(tk('con_pk_', p.kind ?? 'final'))}</td>
                  <td><Input type="number" className="pc-sched-input" value={p.amount} onChange={(e) => setPay(i, { amount: Number(e.target.value) })} ariaLabel={t('amount')} /></td>
                  <td><Button size="small" type="text" icon="trash" disabled={payments.length === 1} onClick={() => setSchedule(payments.filter((_, j) => j !== i))} title={t('proc_removeItem')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pc-row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
          <Button size="small" icon="plus" onClick={() => setSchedule([...payments, { dueDate: endDate, amount: 0, paid: false, kind: 'final' }])}>{t('con_addPayment')}</Button>
          <span className={sum === amount ? 'muted small' : 'error-text'}>{t('total')}: {formatMoney(sum, currency)} / {formatMoney(amount || 0, currency)}</span>
        </div>
      </Card>

      <Card title={t('con_stagesObligations')} actions={<Button size="small" icon="plus" onClick={() => setStages((s) => [...s, { name: '', obligation: 'delivery', dueDate: endDate }])}>{t('con_addStage')}</Button>}>
        {!stages.length ? <p className="muted small" style={{ margin: 0 }}>{t('con_noStages')}</p> : stages.map((s, i) => (
          <div key={i} className="form-grid" style={{ marginBottom: 8 }}>
            <Field label={t('con_stage')} required><Input value={s.name} onChange={(e) => setStages((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} ariaLabel={t('con_stage')} /></Field>
            <Field label={t('con_obligation')}>
              <Select<ContractStage['obligation']> value={s.obligation} onChange={(v) => setStages((x) => x.map((y, j) => (j === i ? { ...y, obligation: v } : y)))} options={(['delivery', 'works', 'acceptance', 'payment', 'other'] as const).map((o) => ({ value: o, label: t(tk('con_obl_', o)) }))} ariaLabel={t('con_obligation')} />
            </Field>
            <Field label={t('deadline')}><Input type="date" value={s.dueDate} onChange={(e) => setStages((x) => x.map((y, j) => (j === i ? { ...y, dueDate: e.target.value } : y)))} ariaLabel={t('deadline')} /></Field>
            <Field label={t('amount')}><Input type="number" value={s.amount ?? ''} onChange={(e) => setStages((x) => x.map((y, j) => (j === i ? { ...y, amount: Number(e.target.value) || undefined } : y)))} ariaLabel={t('amount')} /></Field>
          </div>
        ))}
      </Card>

      {kind !== 'other_receivables' && (
        <Card title={t('route')}>
          <RouteSteps preview={{ entity: 'contract', context: { amount, currency, kind, departmentId, requesterId: user.id } }} />
        </Card>
      )}

      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate('/contracts')}>{t('cancel')}</Button>
        {kind !== 'other_receivables' && <Button disabled={busy} onClick={() => save(false)}>{t('saveDraft')}</Button>}
        <Button type="primary" disabled={busy} onClick={() => save(true)}>{kind === 'other_receivables' ? t('con_register') : t('submitForApproval')}</Button>
      </div>
    </>
  );
}
