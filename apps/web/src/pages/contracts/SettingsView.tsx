// Настройки модуля договоров (PR-CON-002, 034…037): виды договоров и счета расчётов, план счетов, шаблоны,
// справочник подразделений-инициаторов, поставщики.
import { useEffect, useState } from 'react';
import { contractsApi, tk, type ContractAccount, type ContractKindSetting, type ContractTemplate, type PaymentTermsType } from '@xb/shared';
import { Button, Card, Checkbox, DataTable, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui';
import { Link } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useErr } from '../procurement/shared';
import { Segmented } from '../../components/flow';

const TERMS: PaymentTermsType[] = ['full', 'advance', 'periodic', 'by_invoice', 'by_act'];

export function SettingsView() {
  const { t } = useSession();
  const [view, setView] = useState<'kinds' | 'accounts' | 'templates' | 'initiators'>('kinds');
  return (
    <div className="pc-stack pc-pad">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'kinds', label: t('con_set_kinds') },
          { value: 'accounts', label: t('con_set_accounts') },
          { value: 'templates', label: t('con_set_templates') },
          { value: 'initiators', label: t('con_set_initiators') },
        ]}
      />
      {view === 'kinds' && <KindsSettings />}
      {view === 'accounts' && <AccountsSettings />}
      {view === 'templates' && <TemplatesSettings />}
      {view === 'initiators' && <InitiatorsSettings />}
      <div className="muted small">{t('con_suppliersLink')} <Link to="/procurement?tab=suppliers">{t('proc_suppliers')}</Link></div>
    </div>
  );
}

function KindsSettings() {
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const kinds = useApi(() => contractsApi.listKindSettings(), []);
  const accounts = useApi(() => contractsApi.listAccounts(), []);
  const [rows, setRows] = useState<ContractKindSetting[]>([]);
  useEffect(() => {
    if (kinds.data) setRows(kinds.data);
  }, [kinds.data]);
  const editor = can('contracts', 'approve');
  const accOpts = (type?: ContractAccount['type'][]) => (accounts.data ?? []).filter((a) => !type || type.includes(a.type)).map((a) => ({ value: a.code, label: `${a.code} · ${loc(a.name)}` }));
  const set = (i: number, p: Partial<ContractKindSetting>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Card title={t('con_set_kinds')} flush>
      <DataTable
        rows={rows}
        rowKey={(r) => r.kind}
        columns={[
          { header: t('con_kind'), render: (r) => <b>{t(tk('con_kind_', r.kind))}</b> },
          { header: t('con_advanceAccount'), render: (r) => <Select<string> value={r.advanceAccount} disabled={!editor} onChange={(v) => set(rows.indexOf(r), { advanceAccount: v })} options={accOpts(['receivable'])} ariaLabel={t('con_advanceAccount')} /> },
          { header: t('con_payableAccount'), render: (r) => <Select<string> value={r.payableAccount} disabled={!editor} onChange={(v) => set(rows.indexOf(r), { payableAccount: v })} options={accOpts(['payable'])} ariaLabel={t('con_payableAccount')} /> },
          { header: t('con_expenseAccount'), render: (r) => <Select<string> value={r.expenseAccount} disabled={!editor} onChange={(v) => set(rows.indexOf(r), { expenseAccount: v })} options={accOpts(['expense', 'asset', 'income'])} ariaLabel={t('con_expenseAccount')} /> },
          { header: t('con_terms'), render: (r) => <Select<PaymentTermsType> value={r.defaultTerms.type} disabled={!editor} onChange={(v) => set(rows.indexOf(r), { defaultTerms: { ...r.defaultTerms, type: v } })} options={TERMS.map((x) => ({ value: x, label: t(tk('con_terms_', x)) }))} ariaLabel={t('con_terms')} /> },
          { header: '', render: (r) => (editor ? <Button size="small" onClick={async () => { try { await contractsApi.saveKindSetting(r, user); toast(t('saved')); } catch (e) { toast(err(e)); } }}>{t('save')}</Button> : null) },
        ]}
      />
    </Card>
  );
}

function AccountsSettings() {
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const accounts = useApi(() => contractsApi.listAccounts(), []);
  const [edit, setEdit] = useState<ContractAccount | null>(null);
  const editor = can('contracts', 'approve');
  return (
    <Card title={t('con_set_accounts')} actions={editor ? <Button size="small" icon="plus" onClick={() => setEdit({ code: '', name: { ru: '', uz: '', en: '' }, type: 'expense' })}>{t('con_addAccount')}</Button> : undefined} flush>
      <DataTable
        rows={accounts.data}
        rowKey={(a) => a.code}
        onRowClick={editor ? (a) => setEdit(a) : undefined}
        columns={[
          { header: t('con_account'), render: (a) => <span className="doc-num">{a.code}</span> },
          { header: t('title'), render: (a) => loc(a.name) },
          { header: t('con_accountType'), render: (a) => t(tk('con_acc_', a.type)) },
        ]}
      />
      {edit && (
        <Modal
          title={edit.code || t('con_addAccount')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>{t('cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await contractsApi.saveAccount(edit, user); setEdit(null); toast(t('saved')); } catch (e) { toast(err(e)); } }}>{t('save')}</Button>
            </>
          }
        >
          <Field label={t('con_account')} required hint={t('con_accountHint')}><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} ariaLabel={t('con_account')} /></Field>
          <Field label="RU" required><Input value={edit.name.ru} onChange={(e) => setEdit({ ...edit, name: { ...edit.name, ru: e.target.value } })} ariaLabel="ru" /></Field>
          <Field label="UZ" required><Input value={edit.name.uz} onChange={(e) => setEdit({ ...edit, name: { ...edit.name, uz: e.target.value } })} ariaLabel="uz" /></Field>
          <Field label="EN"><Input value={edit.name.en ?? ''} onChange={(e) => setEdit({ ...edit, name: { ...edit.name, en: e.target.value } })} ariaLabel="en" /></Field>
          <Field label={t('con_accountType')} required>
            <Select<ContractAccount['type']> value={edit.type} onChange={(v) => setEdit({ ...edit, type: v })} options={(['receivable', 'payable', 'expense', 'income', 'asset', 'cash', 'offbalance', 'reserve'] as const).map((x) => ({ value: x, label: t(tk('con_acc_', x)) }))} ariaLabel={t('con_accountType')} />
          </Field>
        </Modal>
      )}
    </Card>
  );
}

function TemplatesSettings() {
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const tpls = useApi(() => contractsApi.listTemplates(), []);
  const [edit, setEdit] = useState<ContractTemplate | null>(null);
  const editor = can('contracts', 'approve');
  return (
    <Card title={t('con_set_templates')} flush>
      <DataTable
        rows={tpls.data}
        rowKey={(x) => x.id}
        onRowClick={(x) => setEdit(x)}
        columns={[
          { header: t('title'), render: (x) => loc(x.name) },
          { header: t('con_kind'), render: (x) => t(tk('con_kind_', x.kind)) },
          { header: t('con_terms'), render: (x) => t(tk('con_terms_', x.defaultTerms.type)) },
          { header: t('con_penalty'), render: (x) => `${x.penalty.ratePerDay}% / ${t('proc_days')} · max ${x.penalty.capPct}%` },
        ]}
      />
      {edit && (
        <Modal
          title={loc(edit.name)}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>{t('cancel')}</Button>
              {editor && <Button type="primary" onClick={async () => { try { await contractsApi.saveTemplate(edit, user); setEdit(null); toast(t('saved')); } catch (e) { toast(err(e)); } }}>{t('save')}</Button>}
            </>
          }
        >
          <p className="muted small" style={{ margin: 0 }}>{t('con_tplVars')}</p>
          <Field label={t('con_tplBody')}>
            <Textarea value={edit.body} rows={12} disabled={!editor} onChange={(e) => setEdit({ ...edit, body: e.target.value })} ariaLabel={t('con_tplBody')} />
          </Field>
          <div className="form-grid">
            <Field label={t('con_penaltyRate')}><Input type="number" value={edit.penalty.ratePerDay} disabled={!editor} onChange={(e) => setEdit({ ...edit, penalty: { ...edit.penalty, ratePerDay: Number(e.target.value) } })} ariaLabel={t('con_penaltyRate')} /></Field>
            <Field label={t('con_penaltyCap')}><Input type="number" value={edit.penalty.capPct} disabled={!editor} onChange={(e) => setEdit({ ...edit, penalty: { ...edit.penalty, capPct: Number(e.target.value) } })} ariaLabel={t('con_penaltyCap')} /></Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function InitiatorsSettings() {
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const cur = useApi(() => contractsApi.initiatorDepts(), []);
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => {
    if (cur.data) setSel(cur.data);
  }, [cur.data]);
  const editor = can('contracts', 'approve');
  return (
    <Card title={t('con_set_initiators')} actions={editor ? <Button size="small" type="primary" onClick={async () => { try { await contractsApi.setInitiatorDepts(sel, user); toast(t('saved')); } catch (e) { toast(err(e)); } }}>{t('save')}</Button> : undefined}>
      <p className="muted small" style={{ marginTop: 0 }}>{t('con_initiatorsHint')}</p>
      <div className="pc-stack" style={{ gap: 6 }}>
        {lk.departments.map((d) => (
          <Checkbox key={d.id} checked={sel.includes(d.id)} disabled={!editor} onChange={(v) => setSel((s) => (v ? [...s, d.id] : s.filter((x) => x !== d.id)))}>
            {d.code} · {loc(d.name)}
          </Checkbox>
        ))}
      </div>
    </Card>
  );
}
