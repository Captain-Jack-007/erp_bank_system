// Пользователи (ТЗ PR-GEN-036, PR-GEN-063, PR-SEC-002/008): создание, редактирование, деактивация,
// назначение ролей, привязка к должности (роль по должности), оргединице и МВЗ, разблокировка.
import { useMemo, useState } from 'react';
import {
  api, formatDate, formatDateTime, isSuspended, orgApi, ROLES, securityApi, tk, ValidationError, accessLevel, levelRank,
  type Role, type User, type UserInput, canSeePd, maskPd } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Drawer, Field, FilterBar, Input, PageHeader, Select, Stat, Tabs, useToast } from '../../components/ui';
import { FieldHistory } from '../../components/FieldHistory';
import { useCan } from '../../lib/access';
import { useQuery } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { MODULES } from '../../modules';
import { HrEventsTab } from './HrEvents';
import { AdSyncTab } from './AdSync'; // P4-GEN: Active Directory (PR-GEN-018)

type Status = '' | 'active' | 'inactive' | 'locked';

export function UsersPage() {
  const { t, loc } = useSession();
  const allowed = useCan();
  const query = useQuery();
  const canEdit = allowed('users', 'edit');
  const users = useApi(() => api.listUsers());
  const auth = useApi(() => securityApi.authInfo());
  const positions = useApi(() => securityApi.listPositions());
  const units = useApi(() => orgApi.listOrgUnits());
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<Status>('');
  const [editing, setEditing] = useState<User | 'new' | null>(() => null);
  const openId = query.get('u');
  const [tab, setTab] = useState<'users' | 'hr' | 'ad'>(() => (query.get('tab') === 'hr' ? 'hr' : query.get('tab') === 'ad' ? 'ad' : 'users'));
  // P4-SEC (PR-SEC-049): ПДн сотрудников (e-mail, телефон) — без маскирования только при праве «Просмотр ПДн»
  const pdFull = canSeePd(useUser());
  const unitName = (key?: string) => {
    const u = units.data?.find((x) => x.key === key);
    return u ? loc(u.name) : key ?? '—';
  };
  const list = (users.data ?? []).filter((u) => {
    const a = auth.data?.[u.id];
    if (q.trim() && !`${u.fullName} ${u.login ?? ''} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (role && u.role !== role && !u.extraRoles?.includes(role)) return false;
    if (status === 'active' && u.active === false) return false;
    if (status === 'inactive' && u.active !== false) return false;
    if (status === 'locked' && !a?.locked) return false;
    return true;
  });
  const current = editing === 'new' ? null : editing ?? (openId ? users.data?.find((u) => u.id === openId) ?? null : null);
  const drawerOpen = editing !== null || (!!openId && !!current);

  return (
    <>
      <PageHeader
        title={t('usr_title')}
        subtitle={`${t('tzLabel')} PR-GEN-036, PR-GEN-063 · ${t('usr_subtitle')}`}
        actions={canEdit && tab === 'users' && <Button type="primary" icon="plus" onClick={() => setEditing('new')}>{t('usr_new')}</Button>}
      />
      <Tabs
        value={tab}
        onChange={(v) => {
          setTab(v);
          window.history.replaceState(null, '', `#/settings/users${v === 'users' ? '' : `?tab=${v}`}`);
        }}
        items={[
          { value: 'users', label: t('usr_title') },
          { value: 'hr', label: t('hr_title') },
          { value: 'ad', label: t('p4g_ad_tab') },
        ]}
      />
      {tab === 'ad' ? <AdSyncTab /> : tab === 'hr' ? <HrEventsTab /> : <>
      <div className="grid grid-4">
        <Stat label={t('usr_total')} value={users.data?.length ?? '…'} icon="user" />
        <Stat label={t('usr_active')} value={users.data?.filter((u) => u.active !== false).length ?? '…'} tone="accent" />
        <Stat label={t('usr_locked')} value={Object.values(auth.data ?? {}).filter((a) => a.locked).length} tone={Object.values(auth.data ?? {}).some((a) => a.locked) ? 'alert' : undefined} icon="alert" />
        <Stat label={t('usr_inactive')} value={users.data?.filter((u) => u.active === false).length ?? '…'} />
      </div>
      <Card flush>
        <FilterBar>
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}: ${t('usr_search_hint')}`} />
          <Select<string> value={role} onChange={(v) => setRole(v as Role | '')} placeholder={`${t('role')}: ${t('all')}`} options={ROLES.map((r) => ({ value: r, label: t(tk('role_', r)) }))} ariaLabel={t('role')} />
          <Select<string> value={status} onChange={(v) => setStatus(v as Status)} placeholder={`${t('status')}: ${t('all')}`} options={(['active', 'inactive', 'locked'] as const).map((s) => ({ value: s, label: t(tk('usr_status_', s)) }))} ariaLabel={t('status')} />
        </FilterBar>
        <DataTable
          rows={users.data ? list : undefined}
          loading={users.loading}
          rowKey={(u) => u.id}
          onRowClick={(u) => setEditing(u)}
          emptyText={t('search_nothing')}
          columns={[
            { header: t('usr_name'), render: (u) => <><div style={{ fontWeight: 600 }}>{u.fullName}</div><div className="sub usr-email">{pdFull ? u.email : maskPd(u.email, 'email')}</div></> },
            { header: t('auth_username'), render: (u) => <span className="doc-num">{u.login ?? '—'}</span> },
            { header: t('usr_position'), render: (u) => <><div>{loc(u.position)}</div><div className="sub">{unitName(u.orgUnitKey)}</div></> },
            { header: t('role'), render: (u) => <>{t(tk('role_', u.role))}{!!u.extraRoles?.length && <div className="sub">+ {u.extraRoles.map((r) => t(tk('role_', r))).join(', ')}</div>}</> },
            {
              header: t('status'),
              render: (u) =>
                u.active === false ? <Badge tone="muted">{t('usr_status_inactive')}</Badge> : auth.data?.[u.id]?.locked ? <Badge tone="danger">{t('usr_status_locked')}</Badge> : isSuspended(u) ? <Badge tone="warn">{t('hr_suspended_until')} {formatDate(u.suspendedUntil!)}</Badge> : <Badge tone="ok">{t('usr_status_active')}</Badge>,
            },
            { header: t('usr_last_login'), render: (u) => <span className="num small">{auth.data?.[u.id]?.lastLogin ? formatDateTime(auth.data[u.id]!.lastLogin!) : '—'}</span> },
          ]}
        />
      </Card>
      </>}
      <Drawer
        open={drawerOpen}
        width={620}
        title={current ? current.fullName : t('usr_new')}
        onClose={() => {
          setEditing(null);
          if (openId) window.location.hash = '/settings/users';
        }}
      >
        {drawerOpen && (
          <UserForm
            key={current?.id ?? 'new'}
            value={current}
            canEdit={canEdit}
            positions={positions.data ?? []}
            units={(units.data ?? []).map((u) => ({ value: u.key, label: `${u.code} · ${loc(u.name)}` }))}
            locked={!!(current && auth.data?.[current.id]?.locked)}
            onDone={() => {
              setEditing(null);
              if (openId) window.location.hash = '/settings/users';
            }}
          />
        )}
      </Drawer>
    </>
  );
}

function UserForm({
  value, canEdit, positions, units, locked, onDone,
}: {
  value: User | null;
  canEdit: boolean;
  positions: { id: string; name: { ru: string; uz: string; en?: string }; defaultRole: Role }[];
  units: { value: string; label: string }[];
  locked: boolean;
  onDone: () => void;
}) {
  const { t, loc } = useSession();
  const toast = useToast();
  const lk = useLookups();
  const pdShow = canSeePd(useUser());
  const [tab, setTab] = useState<'form' | 'access' | 'history'>('form');
  const [form, setForm] = useState<UserInput>({
    ...(value ? { id: value.id } : {}),
    fullName: value?.fullName ?? '',
    login: value?.login ?? '',
    email: value?.email ?? '',
    phone: value?.phone ?? '',
    positionId: value?.positionId ?? '',
    role: value?.role ?? 'employee',
    extraRoles: value?.extraRoles ?? [],
    departmentId: value?.departmentId ?? '',
    orgUnitKey: value?.orgUnitKey ?? '',
    costCenterKey: value?.costCenterKey ?? '',
  });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<UserInput>) => setForm((f) => ({ ...f, ...patch }));
  const ccs = useApi(() => (form.orgUnitKey ? orgApi.listCostCenters({ orgUnitKey: form.orgUnitKey, pageSize: 200, status: 'active' }) : Promise.resolve({ rows: [], total: 0 })), [form.orgUnitKey]);
  const pos = positions.find((p) => p.id === form.positionId);
  const preview = useMemo(() => {
    const u = { role: form.role, extraRoles: form.extraRoles, active: true };
    return MODULES.map((m) => ({ m, level: accessLevel(u, m.id) })).filter((x) => x.level !== 'none');
  }, [form.role, form.extraRoles]);
  const err = (k: string) => (issues[k] ? t(issues[k] as never) : undefined);

  async function save() {
    setBusy(true);
    setIssues({});
    try {
      await securityApi.saveUser(form);
      toast(`${form.fullName}: ${t('saved')}`);
      onDone();
    } catch (e) {
      if (e instanceof ValidationError) setIssues(e.issues);
      else toast(`${t('actionFailed')}: ${e instanceof Error ? e.message : String(e)}`); // тост переводит код и пишет его в технический журнал
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'form', label: t('usr_tab_profile') },
          { value: 'access', label: t('usr_tab_access'), count: preview.length },
          ...(value ? [{ value: 'history' as const, label: t('audit_history') }] : []),
        ]}
      />
      {tab === 'form' && (
        <>
          {locked && (
            <div className="banner danger">
              {t('usr_locked_banner')}
              {canEdit && value && (
                <Button
                  size="small"
                  onClick={async () => {
                    await securityApi.unlockUser(value.id);
                    toast(`${value.fullName}: ${t('usr_unlocked')}`);
                  }}
                >
                  {t('usr_unlock')}
                </Button>
              )}
            </div>
          )}
          {value && <PasswordRow userId={value.id} canEdit={canEdit} />}
          <Field label={t('usr_name')} required error={err('fullName')}>
            <Input value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} disabled={!canEdit} ariaLabel={t('usr_name')} />
          </Field>
          <div className="form-grid">
            <Field label={t('auth_username')} required error={err('login')} hint={t('usr_login_hint')}>
              <Input value={form.login} onChange={(e) => set({ login: e.target.value.toLowerCase() })} disabled={!canEdit} ariaLabel={t('auth_username')} />
            </Field>
            <Field label={t('email')} required error={err('email')}>
              <Input type="email" value={canEdit || pdShow ? form.email : maskPd(form.email, 'email')} onChange={(e) => set({ email: e.target.value })} disabled={!canEdit} ariaLabel={t('email')} />
            </Field>
            <Field label={t('usr_position')} required error={err('positionId')} hint={pos ? `${t('usr_role_by_position')}: ${t(tk('role_', pos.defaultRole))}` : undefined}>
              <Select<string>
                value={form.positionId}
                onChange={(v) => {
                  const p = positions.find((x) => x.id === v);
                  set({ positionId: v, ...(p ? { role: p.defaultRole } : {}) });
                }}
                placeholder="—"
                disabled={!canEdit}
                options={positions.map((p) => ({ value: p.id, label: loc(p.name) }))}
                ariaLabel={t('usr_position')}
              />
            </Field>
            <Field label={t('usr_main_role')} required>
              <Select<string> value={form.role} onChange={(v) => set({ role: v as Role })} disabled={!canEdit} options={ROLES.map((r) => ({ value: r, label: t(tk('role_', r)) }))} ariaLabel={t('usr_main_role')} />
            </Field>
            <Field label={t('department')} required error={err('departmentId')}>
              <Select<string> value={form.departmentId} onChange={(v) => set({ departmentId: v })} placeholder="—" disabled={!canEdit} options={lk.departments.map((d) => ({ value: d.id, label: `${d.code} · ${loc(d.name)}` }))} ariaLabel={t('department')} />
            </Field>
            <Field label={t('phone')}>
              <Input type="tel" value={canEdit || pdShow ? (form.phone ?? '') : maskPd(form.phone, 'phone')} onChange={(e) => set({ phone: e.target.value })} disabled={!canEdit} ariaLabel={t('phone')} />
            </Field>
            <Field label={t('org_unit')}>
              <Select<string> value={form.orgUnitKey ?? ''} onChange={(v) => set({ orgUnitKey: v, costCenterKey: '' })} placeholder="—" disabled={!canEdit} options={units} ariaLabel={t('org_unit')} />
            </Field>
            <Field label={t('cc_short')}>
              <Select<string> value={form.costCenterKey ?? ''} onChange={(v) => set({ costCenterKey: v })} placeholder="—" disabled={!canEdit || !form.orgUnitKey} options={(ccs.data?.rows ?? []).map((c) => ({ value: c.key, label: `${c.code} · ${loc(c.name)}` }))} ariaLabel={t('cc_short')} />
            </Field>
          </div>
          <Field label={t('usr_extra_roles')} hint={t('usr_extra_roles_hint')}>
            <div className="check-grid">
              {ROLES.filter((r) => r !== form.role).map((r) => (
                <Checkbox key={r} checked={form.extraRoles.includes(r)} disabled={!canEdit} onChange={(c) => set({ extraRoles: c ? [...form.extraRoles, r] : form.extraRoles.filter((x) => x !== r) })}>
                  {t(tk('role_', r))}
                </Checkbox>
              ))}
            </div>
          </Field>
          {canEdit && (
            <div className="drawer-actions">
              {value && (
                <Button
                  danger={value.active !== false}
                  onClick={async () => {
                    try {
                      await securityApi.setUserActive(value.id, value.active === false);
                      toast(`${value.fullName}: ${value.active === false ? t('usr_status_active') : t('usr_status_inactive')}`);
                      onDone();
                    } catch (e) {
                      toast(`${t('actionFailed')}: ${e instanceof Error ? e.message : String(e)}`); // тост переводит код и пишет его в технический журнал
                    }
                  }}
                >
                  {value.active === false ? t('usr_activate') : t('usr_deactivate')}
                </Button>
              )}
              <Button type="primary" loading={busy} onClick={save}>{t('save')}</Button>
            </div>
          )}
        </>
      )}
      {tab === 'access' && (
        <>
          <p className="muted small" style={{ margin: 0 }}>{t('usr_access_hint')}</p>
          <table className="table">
            <tbody>
              {preview
                .sort((a, b) => levelRank(b.level) - levelRank(a.level))
                .map(({ m, level }) => (
                  <tr key={m.id}>
                    <td>{typeof m.name === 'string' ? t(m.name) : loc(m.name)}</td>
                    <td className="right"><span className={`lvl-chip lvl-${level}`}>{t(tk('acc_level_', level))}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
      {tab === 'history' && value && <FieldHistory entity="user" entityId={value.id} />}
    </>
  );
}

/** P3-GEN (PR-SEC-037): срок действия пароля пользователя и требование смены при следующем входе. */
function PasswordRow({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const { t } = useSession();
  const toast = useToast();
  const info = useApi(() => securityApi.passwordInfo(userId), [userId]);
  if (!info.data) return null;
  const i = info.data;
  return (
    <div className="pwd-row">
      <span className="small">
        {t('pwd_expires')}: <b className="num">{formatDate(i.expiresAt)}</b>
      </span>
      {i.expired && <Badge tone="danger">{t('pwd_expired_badge')}</Badge>}
      {i.mustChange && <Badge tone="warn">{t('pwd_must_change_badge')}</Badge>}
      {canEdit && !i.mustChange && (
        <Button
          size="small"
          onClick={async () => {
            await securityApi.requirePasswordChange(userId);
            toast(t('pwd_required_done'));
          }}
        >
          {t('pwd_require_change')}
        </Button>
      )}
    </div>
  );
}
