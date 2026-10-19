// P4-SEC (PR-SEC-049): персональные данные — реестр ПДн (объекты, поля, цель, основание, срок хранения),
// записи с истёкшим сроком и обезличивание под контролем двух лиц (заявка с 2FA → юрист с 2FA),
// журнал пропусков посетителей (минимальный набор полей) и маскирование ПДн для ролей без права «Просмотр ПДн».
import { useState } from 'react';
import {
  approvalsApi, canSeePd, formatDate, formatDateTime, maskPd, privacyApi,
  type PdCategory, type PdRecord, type PdRegisterEntry, type PdRequest,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Empty, Field, FilterBar, Input, PageHeader, Select, Stat, Tabs, useToast } from '../../components/ui';
import { GuardedLink, useCan, useErrorText, useStepUp } from '../../lib/access';
import { useQuery } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import type { ModuleRoute } from '../../lib/routes';
import '../../components/p4sec.css';

type Tab = 'register' | 'due' | 'visitors' | 'requests';
const TABS: Tab[] = ['register', 'due', 'visitors', 'requests'];

export function PrivacyPage() {
  const { t } = useSession();
  const query = useQuery();
  const q = query.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(q && TABS.includes(q) ? q : 'register');
  const user = useUser();
  return (
    <>
      <PageHeader title={t('pd_title')} subtitle={`${t('tzLabel')} PR-SEC-049 · ${t('pd_subtitle')}`} />
      <div className={`banner ${canSeePd(user) ? 'info' : 'warn'} pd-visibility`} data-pd-full={canSeePd(user) ? '1' : '0'}>
        {canSeePd(user) ? t('pd_full_hint') : t('pd_masked_hint')}
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={(v) => {
            setTab(v);
            window.history.replaceState(null, '', `#/privacy?tab=${v}`);
          }}
          items={TABS.map((v) => ({ value: v, label: t(`pd_tab_${v}` as 'pd_tab_register') }))}
        />
        {tab === 'register' && <RegisterTab />}
        {tab === 'due' && <DueTab />}
        {tab === 'visitors' && <VisitorsTab />}
        {tab === 'requests' && <RequestsTab />}
      </Card>
    </>
  );
}

function RegisterTab() {
  const { t, loc } = useSession();
  const toast = useToast();
  const stepUp = useStepUp();
  const errText = useErrorText();
  const allowed = useCan();
  const canAdmin = allowed('privacy', 'admin');
  const reg = useApi(() => privacyApi.register(), []);
  const recs = useApi(() => privacyApi.records(), []);
  const [edit, setEdit] = useState<Partial<Record<PdCategory, string>>>({});

  async function save(e: PdRegisterEntry) {
    const months = Number(edit[e.id]);
    if (!(await stepUp(`${t('pd_retention')}: ${loc(e.name)} → ${months} ${t('pd_months')}`))) return;
    try {
      await privacyApi.setRetention(e.id, months);
      toast(`${loc(e.name)}: ${months} ${t('pd_months')}`);
      setEdit((x) => ({ ...x, [e.id]: undefined }));
    } catch (err) {
      toast(`${t('actionFailed')}: ${errText(err)}`);
    }
  }

  return (
    <div className="pd-register">
      <DataTable
        rows={reg.data}
        loading={reg.loading}
        rowKey={(e) => e.id}
        columns={[
          { header: t('pd_category'), render: (e) => <><div style={{ fontWeight: 600 }}>{loc(e.name)}</div><div className="sub"><GuardedLink to={e.link}>{loc(e.source)}</GuardedLink></div></> },
          { header: t('pd_fields'), render: (e) => <span className="small">{e.fields.map((f) => loc(f.label)).join(', ')}</span> },
          { header: t('pd_purpose'), render: (e) => <><div className="small">{loc(e.purpose)}</div><div className="sub">{loc(e.legalBasis)}</div></> },
          {
            header: t('pd_retention'),
            render: (e) =>
              canAdmin ? (
                <span className="pd-ret-edit" data-cat={e.id}>
                  <Input type="number" value={edit[e.id] ?? String(e.retentionMonths)} onChange={(ev) => setEdit((x) => ({ ...x, [e.id]: ev.target.value }))} ariaLabel={`${t('pd_retention')} · ${loc(e.name)}`} />
                  {edit[e.id] !== undefined && Number(edit[e.id]) !== e.retentionMonths && <Button size="small" type="primary" onClick={() => void save(e)}>{t('save')}</Button>}
                </span>
              ) : (
                <span className="num">{e.retentionMonths} {t('pd_months')}</span>
              ),
          },
          { header: t('pd_trigger'), render: (e) => <span className="small">{loc(e.trigger)}</span> },
          {
            header: t('pd_records'),
            render: (e) => {
              const list = recs.data?.filter((r) => r.category === e.id) ?? [];
              const due = list.filter((r) => r.due).length;
              return <span className="num">{list.length}{due ? <> · <Badge tone="warn">{t('pd_st_due')}: {due}</Badge></> : null}</span>;
            },
          },
        ]}
      />
      <p className="muted small" style={{ margin: '12px 16px' }}>{t('pd_minimisation_note')}</p>
    </div>
  );
}

function RecordValues({ rec, fields }: { rec: PdRecord; fields: PdRegisterEntry['fields'] }) {
  const { loc } = useSession();
  const user = useUser();
  const full = canSeePd(user);
  return (
    <span className="small pd-values">
      {fields
        .filter((f) => f.kind !== 'name')
        .map((f) => `${loc(f.label)}: ${full ? rec.values[f.key] || '—' : maskPd(rec.values[f.key], f.kind)}`)
        .join(' · ')}
    </span>
  );
}

function DueTab() {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const stepUp = useStepUp();
  const errText = useErrorText();
  const allowed = useCan();
  const lk = useLookups();
  const canEdit = allowed('privacy', 'edit');
  const canApprove = allowed('privacy', 'approve');
  const reg = useApi(() => privacyApi.register(), []);
  const recs = useApi(() => privacyApi.records(), []);
  const reqs = useApi(() => privacyApi.requests(), []);
  const [cat, setCat] = useState<PdCategory | ''>('');
  const [onlyDue, setOnlyDue] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [regulation, setRegulation] = useState(t('pd_regulation_default'));
  const [busy, setBusy] = useState(false);
  const fieldsOf = (c: PdCategory) => reg.data?.find((e) => e.id === c)?.fields ?? [];
  const rows = (recs.data ?? []).filter((r) => (!cat || r.category === cat) && (!onlyDue || r.due));
  const all = recs.data ?? [];
  const pending = (reqs.data ?? []).filter((r) => r.status === 'pending');
  const pendingKeys = new Set(pending.flatMap((r) => r.keys));
  const full = canSeePd(user);

  async function request() {
    const keys = picked.filter((k) => all.some((r) => r.key === k && r.due));
    if (!keys.length) return toast(`${t('actionFailed')}: PD_NOTHING_SELECTED`);
    if (!(await stepUp(`${t('pd_btn_request')}: ${keys.length}`))) return;
    setBusy(true);
    try {
      const r = await privacyApi.requestAnonymization(keys, regulation);
      toast(`${r.number}: ${t('pd_req_filed')}`);
      setPicked([]);
    } catch (e) {
      toast(`${t('actionFailed')}: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function decide(r: PdRequest, approve: boolean) {
    const item = (await approvalsApi.inbox(user, 'mine')).find((i) => i.task.entity === 'pd_anonymize' && i.task.entityId === r.id);
    if (!item) return toast(`${t('actionFailed')}: NOT_ASSIGNED`);
    if (approve && !(await stepUp(`${t('pd_btn_approve')}: ${r.number}`))) return;
    setBusy(true);
    try {
      await approvalsApi.decide(item.task.id, user, approve ? 'approve' : 'reject', approve ? undefined : t('ar_reject_reason'));
      const after = (await privacyApi.requests()).find((x) => x.id === r.id);
      if (after?.status === 'failed') toast(`${t('actionFailed')}: ${errText(after.failure)}`);
      else toast(`${r.number}: ${approve ? `${t('pd_req_approved')} (${after?.done ?? 0})` : t('ar_rejected_toast')}`);
    } catch (e) {
      toast(`${t('actionFailed')}: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pd-due">
      <div className="grid grid-3" style={{ padding: 16 }}>
        <Stat label={t('pd_kpi_total')} value={all.length} icon="users" />
        <Stat label={t('pd_kpi_due')} value={all.filter((r) => r.due).length} tone={all.some((r) => r.due) ? 'alert' : undefined} icon="clock" />
        <Stat label={t('pd_kpi_anon')} value={all.filter((r) => r.anonymized).length} tone="accent" icon="shield" />
      </div>
      {pending.map((r) => (
        <div key={r.id} className="banner warn pd-pending" data-testid="pd-pending">
          <b>{r.number}</b> · {t('pd_pending')}: {r.keys.length} · {r.regulation} · {t('ar_initiator')}: {lk.user(r.initiatorId)?.fullName ?? r.initiatorId}
          {canApprove && r.initiatorId !== user.id ? (
            <span className="pd-pending-actions">
              <Button size="small" type="primary" loading={busy} onClick={() => void decide(r, true)} className="pd-approve-btn">{t('pd_btn_approve')}</Button>
              <Button size="small" danger loading={busy} onClick={() => void decide(r, false)}>{t('reject')}</Button>
            </span>
          ) : (
            <span className="small"> · {t('ar_wait_second')}</span>
          )}
        </div>
      ))}
      <FilterBar>
        <Select<string> value={cat} onChange={(v) => setCat(v as PdCategory | '')} placeholder={`${t('pd_category')}: ${t('all')}`} options={(reg.data ?? []).map((e) => ({ value: e.id, label: loc(e.name) }))} ariaLabel={t('pd_category')} />
        <Checkbox checked={onlyDue} onChange={setOnlyDue}>{t('pd_only_due')}</Checkbox>
        {canEdit && (
          <>
            <Input value={regulation} onChange={(e) => setRegulation(e.target.value)} ariaLabel={t('ar_regulation')} placeholder={t('ar_regulation')} />
            <Button type="primary" icon="shield" loading={busy} disabled={!picked.length} onClick={() => void request()} className="pd-request-btn">
              {t('pd_btn_request')}{picked.length ? ` (${picked.length})` : ''}
            </Button>
          </>
        )}
      </FilterBar>
      {!rows.length && !recs.loading ? (
        <Empty text={t('pd_none_due')} icon="check" />
      ) : (
        <DataTable
          rows={rows}
          loading={recs.loading}
          rowKey={(r) => r.key}
          columns={[
            ...(canEdit
              ? [{
                  header: '',
                  width: 36,
                  render: (r: PdRecord) =>
                    r.due && !pendingKeys.has(r.key) ? (
                      <span data-pick={r.key}><Checkbox checked={picked.includes(r.key)} onChange={(v) => setPicked((p) => (v ? [...p, r.key] : p.filter((k) => k !== r.key)))} /></span>
                    ) : null,
                }]
              : []),
            { header: t('pd_category'), render: (r: PdRecord) => <span className="small">{loc(reg.data?.find((e) => e.id === r.category)?.name ?? { ru: r.category, uz: r.category })}</span> },
            { header: t('pd_subject'), render: (r: PdRecord) => <span className="pd-subject">{full || r.anonymized ? r.label : maskPd(r.label, 'name')}</span> },
            { header: t('pd_values'), render: (r: PdRecord) => <RecordValues rec={r} fields={fieldsOf(r.category)} /> },
            { header: t('pd_since'), render: (r: PdRecord) => <span className="num small">{r.since ? formatDate(r.since) : '—'}</span> },
            { header: t('pd_due_date'), render: (r: PdRecord) => <span className="num small">{r.dueDate ? formatDate(r.dueDate) : '—'}</span> },
            {
              header: t('status'),
              render: (r: PdRecord) => (
                <span data-pd-status={r.anonymized ? 'anonymized' : r.due ? 'due' : 'active'}>
                  <Badge tone={r.anonymized ? 'ok' : r.due ? 'warn' : 'muted'}>{t(r.anonymized ? 'pd_st_anonymized' : r.due ? (pendingKeys.has(r.key) ? 'pd_st_pending' : 'pd_st_due') : 'pd_st_active')}</Badge>
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

function VisitorsTab() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const errText = useErrorText();
  const allowed = useCan();
  const lk = useLookups();
  const canEdit = allowed('privacy', 'edit');
  const list = useApi(() => privacyApi.visitors(), []);
  const full = canSeePd(user);
  const [form, setForm] = useState({ fullName: '', passport: '', pinfl: '', phone: '', hostId: '', purpose: '' });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const show = (v: string, kind: Parameters<typeof maskPd>[1]) => (full ? v || '—' : maskPd(v, kind));

  async function add() {
    setBusy(true);
    try {
      await privacyApi.addVisitor(form);
      toast(t('pd_visitor_added'));
      setForm({ fullName: '', passport: '', pinfl: '', phone: '', hostId: '', purpose: '' });
    } catch (e) {
      toast(`${t('actionFailed')}: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pd-visitors">
      {canEdit && (
        <div className="pd-visitor-form">
          <Field label={t('pd_visitor_name')} required><Input value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} ariaLabel={t('pd_visitor_name')} /></Field>
          <Field label={t('pd_passport')} required hint="AA1234567"><Input value={form.passport} onChange={(e) => set({ passport: e.target.value })} ariaLabel={t('pd_passport')} /></Field>
          <Field label={t('pd_pinfl')} hint={t('pd_pinfl_hint')}><Input value={form.pinfl} onChange={(e) => set({ pinfl: e.target.value.replace(/\D/g, '').slice(0, 14) })} inputMode="numeric" ariaLabel={t('pd_pinfl')} /></Field>
          <Field label={t('pd_phone')}><Input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} ariaLabel={t('pd_phone')} /></Field>
          <Field label={t('pd_host')} required><Select value={form.hostId} onChange={(v) => set({ hostId: v })} placeholder="—" options={lk.users.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: u.fullName }))} ariaLabel={t('pd_host')} /></Field>
          <Field label={t('pd_visit_purpose')} required><Input value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} ariaLabel={t('pd_visit_purpose')} /></Field>
          <div><Button type="primary" icon="plus" loading={busy} onClick={() => void add()} className="pd-add-visitor">{t('pd_add_visitor')}</Button></div>
        </div>
      )}
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(v) => v.id}
        columns={[
          { header: t('pd_visit_date'), render: (v) => <span className="num">{formatDate(v.visitDate)}</span> },
          { header: t('pd_visitor_name'), render: (v) => (full || v.anonymized ? v.fullName : maskPd(v.fullName, 'name')) },
          { header: t('pd_passport'), render: (v) => <span className="num pd-passport">{show(v.passport, 'passport')}</span> },
          { header: t('pd_pinfl'), render: (v) => <span className="num">{show(v.pinfl, 'pinfl')}</span> },
          { header: t('pd_phone'), render: (v) => <span className="num">{show(v.phone, 'phone')}</span> },
          { header: t('pd_host'), render: (v) => <><div>{lk.user(v.hostId)?.fullName ?? v.hostId}</div><div className="sub">{v.purpose}</div></> },
          { header: t('status'), render: (v) => (v.anonymized ? <Badge tone="ok">{t('pd_st_anonymized')}</Badge> : null) },
        ]}
      />
      <p className="muted small" style={{ margin: '12px 16px' }}>{t('pd_minimisation_note')}</p>
    </div>
  );
}

function RequestsTab() {
  const { t } = useSession();
  const errText = useErrorText();
  const lk = useLookups();
  const reqs = useApi(() => privacyApi.requests(), []);
  const tone = { pending: 'warn', executed: 'ok', rejected: 'danger', failed: 'danger' } as const;
  return (
    <DataTable
      rows={reqs.data}
      loading={reqs.loading}
      rowKey={(r) => r.id}
      emptyText={t('ar_no_requests')}
      columns={[
        { header: '№', render: (r) => <><div className="doc-num">{r.number}</div><div className="sub">{formatDateTime(r.createdAt)}</div></> },
        { header: t('status'), render: (r) => <span data-status={r.status}><Badge tone={tone[r.status]}>{t(`ar_status_${r.status}` as 'ar_status_pending')}</Badge></span> },
        { header: t('pd_records'), render: (r) => <span className="num">{r.done !== undefined ? `${r.done} / ${r.keys.length}` : r.keys.length}</span> },
        { header: t('ar_regulation'), render: (r) => <span className="small">{r.regulation}</span> },
        { header: `${t('ar_initiator')} / ${t('ar_approver')}`, render: (r) => <><div>{lk.user(r.initiatorId)?.fullName ?? r.initiatorId}</div><div className="sub">{r.approverId ? (lk.user(r.approverId)?.fullName ?? r.approverId) : '—'}</div></> },
        { header: t('ar_result'), render: (r) => (r.failure ? <span className="small" style={{ color: 'var(--danger)' }}>{errText(r.failure)}</span> : '—') },
      ]}
    />
  );
}

export const routes: ModuleRoute[] = [{ path: '/privacy', render: () => <PrivacyPage /> }];
