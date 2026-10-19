// Справочники (MDM, ТЗ 4.2.12): оргструктура и подразделения, МВЗ, контрагенты, группы расходов и статьи,
// заявки на изменение, качество данных, классификаторы, статьи бюджета, пользователи.
import { useState } from 'react';
import { api, formatMoney, matches, orgApi, tk, type Counterparty, type CounterpartyType, userError, userMessage } from '@xb/shared';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Progress, Select, Stat, Tabs, useToast } from '../../components/ui';
import { FieldHistory } from '../../components/FieldHistory';
import { useCan, useStepUp } from '../../lib/access';
import { Link, useQuery } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { OrgTreeTab } from './OrgTree';
import { useOrgUnits } from './shared';
import { CostCentersTab } from './CostCenters';
import { ChangesTab } from './Changes';
import { QualityTab } from './Quality';
import { ExpenseTab } from './Expense';
import { CatalogsTab } from './Catalogs';
import { MatrixTab } from './Matrix';

type Tab = 'org' | 'cc' | 'counterparties' | 'expense' | 'changes' | 'matrix' | 'quality' | 'catalogs' | 'budget' | 'users';
const TABS: Tab[] = ['counterparties', 'org', 'cc', 'expense', 'changes', 'matrix', 'quality', 'catalogs', 'budget', 'users'];
/** Совместимость со старыми ссылками: ?tab=departments → оргструктура. */
const ALIASES: Record<string, Tab> = { departments: 'org', costcenters: 'cc' };

export function MasterDataPage() {
  const { t } = useSession();
  const query = useQuery();
  const raw = query.get('tab') ?? '';
  const initial = (TABS as string[]).includes(raw) ? (raw as Tab) : ALIASES[raw] ?? 'counterparties';
  const [tab, setTabState] = useState<Tab>(initial);
  const stats = useApi(() => orgApi.stats());
  const lk = useLookups();
  // справочники грузятся один раз на уровне страницы — вкладки переключаются без повторной загрузки
  const orgToday = useOrgUnits();
  const ccCounts = useApi(() => orgApi.costCenterCounts());
  const setTab = (v: Tab) => {
    setTabState(v);
    // адрес вкладки — без перезагрузки экрана (replaceState не вызывает hashchange)
    window.history.replaceState(null, '', `#/master-data?tab=${v}`);
  };

  return (
    <>
      <PageHeader title={t('masterTitle')} subtitle={`${t('tzLabel')} 4.2.12 · MDM · PR-MDM-001…005, PR-GEN-007`} />
      <div className="grid grid-4">
        <Stat label={t('md_stat_units')} value={stats.data ? `${stats.data.regions} / ${stats.data.branchOffices}` : '…'} foot={t('md_stat_units_foot')} icon="sitemap" />
        <Stat label={t('md_stat_cc')} value={stats.data?.costCenters ?? '…'} foot={`${t('md_stat_closed')}: ${stats.data?.costCentersClosed ?? 0}`} icon="wallet" tone="accent" />
        <Stat label={t('md_stat_pending')} value={stats.data?.pendingChanges ?? '…'} foot={t('md_stat_pending_foot')} icon="clock" />
        <Stat label={t('md_stat_dq')} value={stats.data?.dqFindings ?? '…'} foot={t('md_stat_dq_foot')} icon="alert" tone={stats.data?.dqFindings ? 'alert' : undefined} />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'counterparties', label: t('counterparties'), count: lk.counterparties.length },
            { value: 'org', label: t('md_tab_org') },
            { value: 'cc', label: t('md_tab_cc'), ...(stats.data ? { count: stats.data.costCenters } : {}) },
            { value: 'expense', label: t('md_tab_expense') },
            { value: 'changes', label: t('md_tab_changes'), ...(stats.data ? { count: stats.data.pendingChanges } : {}) },
            { value: 'matrix', label: t('md_tab_matrix') },
            { value: 'quality', label: t('md_tab_quality'), ...(stats.data ? { count: stats.data.dqFindings } : {}) },
            { value: 'catalogs', label: t('md_tab_catalogs') },
            { value: 'budget', label: t('budgetLines'), count: lk.budgetLines.length },
            { value: 'users', label: t('users'), count: lk.users.length },
          ]}
        />
        {tab === 'counterparties' && <CounterpartiesTab lk={lk} initialQ={query.get('q') ?? ''} />}
        {tab === 'org' && <OrgTreeTab today={{ units: orgToday, counts: ccCounts.data }} />}
        {tab === 'cc' && <CostCentersTab initialUnit={query.get('unit') ?? ''} />}
        {tab === 'expense' && <ExpenseTab />}
        {tab === 'changes' && <ChangesTab />}
        {tab === 'matrix' && <MatrixTab />}
        {tab === 'quality' && <QualityTab />}
        {tab === 'catalogs' && <CatalogsTab />}
        {tab === 'budget' && <BudgetTab lk={lk} />}
        {tab === 'users' && <UsersDirectoryTab lk={lk} initialQ={query.get('q') ?? ''} />}
      </Card>
    </>
  );
}

// ---------- Контрагенты (MDM) ----------

type Lookups = ReturnType<typeof useLookups>;

function CounterpartiesTab({ initialQ, lk }: { initialQ: string; lk: Lookups }) {
  const { t } = useSession();
  const toast = useToast();
  const allowed = useCan();
  const stepUp = useStepUp();
  const canEdit = allowed('master-data', 'edit');
  const [q, setQ] = useState(initialQ);
  const [editing, setEditing] = useState<Counterparty | 'new' | null>(null);
  const cps = lk.counterparties.filter((c) => !q.trim() || matches(q, c.name, c.tin, c.address));
  return (
    <>
      {editing && <CounterpartyModal value={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}: ${t('title').toLowerCase()}, ${t('tin')}`} />
        <div style={{ flex: 1 }} />
        {canEdit && (
          <Button type="primary" icon="plus" onClick={() => setEditing('new')}>
            {t('addCounterparty')}
          </Button>
        )}
      </div>
      <div className="table-wrap">
        {!cps.length ? (
          <Empty text={t('search_nothing')} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('title')}</th>
                <th>{t('tin')}</th>
                <th>{t('type')}</th>
                <th>{t('rating')}</th>
                <th>{t('status')}</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {cps.map((c) => (
                <tr key={c.id} className={canEdit ? 'clickable' : undefined} onClick={canEdit ? () => setEditing(c) : undefined}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="sub">{c.address} · {c.phone}</div>
                  </td>
                  <td className="num">{c.tin}</td>
                  <td>{t(tk('ctype_', c.type))}</td>
                  <td style={{ color: 'var(--accent)', letterSpacing: 1 }}>{'★'.repeat(c.rating)}<span style={{ color: 'var(--border-strong)' }}>{'★'.repeat(5 - c.rating)}</span></td>
                  <td>{c.blocked ? <Badge tone="danger">{t('blocked')}</Badge> : <Badge tone="ok">{t('activeLabel')}</Badge>}</td>
                  {canEdit && (
                    <td className="right">
                      <Button
                        size="small"
                        danger={!c.blocked}
                        onClick={async (e) => {
                          e.stopPropagation();
                          // Блокировка контрагента — операция высокого риска: повторное подтверждение кодом (PR-GEN-043)
                          if (!c.blocked && !(await stepUp(`${t('block')}: ${c.name}`))) return;
                          try {
                            await api.setCounterpartyBlocked(c.id, !c.blocked);
                            toast(`${c.name}: ${c.blocked ? t('activeLabel') : t('blocked')}`);
                          } catch (err) {
                            toast(`${t('actionFailed')}: ${userError(err)}`);
                          }
                        }}
                      >
                        {c.blocked ? t('unblock') : t('block')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const CP_TYPES: CounterpartyType[] = ['legal', 'individual_entrepreneur', 'foreign'];

function CounterpartyModal({ value, onClose }: { value: Counterparty | null; onClose: () => void }) {
  const { t } = useSession();
  const toast = useToast();
  const lk = useLookups();
  const [form, setForm] = useState({
    name: value?.name ?? '',
    tin: value?.tin ?? '',
    type: value?.type ?? ('legal' as CounterpartyType),
    address: value?.address ?? '',
    phone: value?.phone ?? '',
    rating: value?.rating ?? 3,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!form.name.trim() || !form.address.trim()) return setError(t('formRequired'));
    if (!/^\d{9}$/.test(form.tin)) return setError(t('tinInvalid'));
    const dup = lk.counterparties.find((c) => c.tin === form.tin && c.id !== value?.id);
    if (dup) return setError(`${t('tinDuplicate')}: ${dup.name}`);
    setBusy(true);
    try {
      await api.saveCounterparty({ ...form, name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim(), blocked: value?.blocked ?? false, ...(value ? { id: value.id } : {}) });
      toast(`${form.name}: ${t('saved')}`);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.startsWith('TIN_ALREADY_USED') ? `${t('tinDuplicate')}: ${msg.slice(msg.indexOf(':') + 1)}` : userMessage(msg));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={value ? t('editCounterparty') : t('addCounterparty')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={save}>{t('save')}</Button>
        </>
      }
    >
      <Field label={t('title')} required>
        <Input value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus ariaLabel={t('title')} />
      </Field>
      <div className="form-grid">
        <Field label={t('tin')} required>
          <Input className="num" inputMode="numeric" maxLength={9} value={form.tin} onChange={(e) => set({ tin: e.target.value.replace(/\D/g, '') })} ariaLabel={t('tin')} />
        </Field>
        <Field label={t('type')} required>
          <Select<string> value={form.type} onChange={(v) => set({ type: v as CounterpartyType })} options={CP_TYPES.map((x) => ({ value: x, label: t(tk('ctype_', x)) }))} ariaLabel={t('type')} />
        </Field>
      </div>
      <Field label={t('address')} required>
        <Input value={form.address} onChange={(e) => set({ address: e.target.value })} ariaLabel={t('address')} />
      </Field>
      <div className="form-grid">
        <Field label={t('phone')}>
          <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} ariaLabel={t('phone')} />
        </Field>
        <Field label={t('rating')}>
          <Select<number> value={form.rating} onChange={(v) => set({ rating: v })} options={[1, 2, 3, 4, 5].map((r) => ({ value: r, label: '★'.repeat(r) }))} ariaLabel={t('rating')} />
        </Field>
      </div>
      {error && <span className="error-text">{error}</span>}
      {value && (
        <div>
          <Button type="link" size="small" icon="clock" onClick={() => setShowHistory((v) => !v)}>
            {t('audit_history')}
          </Button>
          {showHistory && <FieldHistory entity="counterparty" entityId={value.id} fieldLabel={(f) => (f === 'name' ? t('title') : f === 'tin' ? t('tin') : f === 'blocked' ? t('blocked') : f)} />}
        </div>
      )}
    </Modal>
  );
}

// ---------- Статьи бюджета и пользователи ----------

function BudgetTab({ lk }: { lk: Lookups }) {
  const { t, loc } = useSession();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t('code')}</th>
            <th>{t('title')}</th>
            <th className="right">{t('planned')}</th>
            <th className="right">{t('spent')}</th>
            <th style={{ width: 180 }}>%</th>
          </tr>
        </thead>
        <tbody>
          {lk.budgetLines.map((b) => {
            const pct = Math.round((b.spent / b.planned) * 100);
            return (
              <tr key={b.id}>
                <td className="doc-num">{b.code}</td>
                <td>{loc(b.name)}</td>
                <td className="right num">{formatMoney(b.planned)}</td>
                <td className="right num">{formatMoney(b.spent)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}><Progress pct={pct} /></div>
                    <span className="num small">{pct}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UsersDirectoryTab({ initialQ, lk }: { initialQ: string; lk: Lookups }) {
  const { t, loc } = useSession();
  const allowed = useCan();
  const [q, setQ] = useState(initialQ);
  const users = lk.users.filter((u) => !q.trim() || matches(q, u.fullName, u.email, loc(u.position)));
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}…`} />
        <div style={{ flex: 1 }} />
        {allowed('users', 'view') && <Link to="/settings/users" className="btn btn-sm">{t('md_manage_users')}</Link>}
      </div>
      <div className="table-wrap">
        {!users.length ? (
          <Empty text={t('search_nothing')} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('title')}</th>
                <th>{t('department')}</th>
                <th>{t('role')}</th>
                <th>{t('email')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.fullName}</div>
                    <div className="sub">{loc(u.position)}</div>
                  </td>
                  <td>{lk.department(u.departmentId)?.code}</td>
                  <td>{t(tk('role_', u.role))}{u.active === false && <> · <Badge tone="muted">{t('usr_status_inactive')}</Badge></>}</td>
                  <td className="muted">{u.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
