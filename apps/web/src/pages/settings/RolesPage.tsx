// «Роли и права» (ТЗ PR-SEC-035/036, PR-GEN-008/036/063): матрица роли × модули (уровень доступа
// none/view/edit/approve/admin), привязка ролей к должностям, отчёт access review с экспортом.
import { useState } from 'react';
import {
  ACCESS_LEVELS, accessReviewApi, defaultRoleAccess, api, formatDate, formatDateTime, ROLE_CATEGORIES, ROLES, securityApi, SOD_RULES, tk, ValidationError,
  type AccessLevel, type AccessReviewRow, type Role, userError } from '@xb/shared';
import { Badge, Button, Card, DataTable, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, Stat, Tabs, Textarea, useToast } from '../../components/ui';
import { useCan, useStepUp } from '../../lib/access';
import { navigate, useQuery } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { exportTable } from '../../lib/exportTable';
import { MODULES, NAV_GROUPS, type ModuleDef } from '../../modules';

type Tab = 'matrix' | 'positions' | 'review';

export function RolesPage() {
  const { t } = useSession();
  const query = useQuery();
  const [tab, setTab] = useState<Tab>(() => (['matrix', 'positions', 'review'].includes(query.get('tab') ?? '') ? (query.get('tab') as Tab) : 'matrix'));
  return (
    <>
      <PageHeader title={t('roles_title')} subtitle={`${t('tzLabel')} PR-SEC-035, PR-SEC-036, PR-GEN-063 · ${t('roles_subtitle')}`} />
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={(v) => {
            setTab(v);
            window.history.replaceState(null, '', `#/settings/roles?tab=${v}`);
          }}
          items={[
            { value: 'matrix', label: t('roles_tab_matrix') },
            { value: 'positions', label: t('roles_tab_positions') },
            { value: 'review', label: t('roles_tab_review') },
          ]}
        />
        {tab === 'matrix' && <Matrix />}
        {tab === 'positions' && <Positions />}
        {tab === 'review' && <AccessReview />}
      </Card>
    </>
  );
}

const moduleName = (m: ModuleDef, t: (k: never) => string, loc: (v: { ru: string; uz: string }) => string) => (typeof m.name === 'string' ? t(m.name as never) : loc(m.name));

function Matrix() {
  const { t, loc } = useSession();
  const toast = useToast();
  const allowed = useCan();
  const stepUp = useStepUp();
  const canEdit = allowed('roles', 'edit');
  const [group, setGroup] = useState<string>('');
  const [role, setRole] = useState<Role | ''>('');
  const mods = MODULES.filter((m) => !group || m.group === group);
  const ids = MODULES.map((m) => m.id);
  const matrix = useApi(() => securityApi.getMatrix(ids), [ids.join(',')]);
  // P4-SEC (PR-SEC-047): особые права вне меню (контроль двух лиц по журналу, просмотр ПДн без маскирования)
  const special = useApi(() => securityApi.getMatrix(['audit_retention', 'pd_full']), []);
  const roles = ROLES.filter((r) => !role || r === role);

  return (
    <>
      <FilterBar>
        <Select<string> value={group} onChange={setGroup} placeholder={`${t('roles_group')}: ${t('all')}`} options={NAV_GROUPS.map((g) => ({ value: g, label: t(tk('navGroup_', g)) }))} ariaLabel={t('roles_group')} />
        <Select<string> value={role} onChange={(v) => setRole(v as Role | '')} placeholder={`${t('role')}: ${t('all')}`} options={ROLES.map((r) => ({ value: r, label: t(tk('role_', r)) }))} ariaLabel={t('role')} />
        <div className="lvl-legend">
          {ACCESS_LEVELS.map((l) => (
            <span key={l} className={`lvl-chip lvl-${l}`}>{t(tk('acc_level_', l))}</span>
          ))}
        </div>
        {canEdit && (
          <Button
            size="small"
            danger
            onClick={async () => {
              if (!(await stepUp(t('roles_reset')))) return;
              await securityApi.resetMatrix();
              toast(t('roles_reset_done'));
            }}
          >
            {t('roles_reset')}
          </Button>
        )}
      </FilterBar>
      <p className="muted small roles-lp-note" style={{ margin: '0 16px 8px' }}>{t('roles_lp_note')}</p>
      {!matrix.data ? (
        <Loading />
      ) : (
        <div className="table-wrap matrix-wrap">
          <table className="table matrix">
            <thead>
              <tr>
                <th className="matrix-role">{t('role')}</th>
                {mods.map((m) => (
                  <th key={m.id} className="matrix-col" title={m.tz ? `${t('tzLabel')} ${m.tz}` : m.id}>
                    <span>{moduleName(m, t, loc)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r} data-role={r}>
                  <th className="matrix-role">{t(tk('role_', r))}</th>
                  {mods.map((m) => {
                    const level = matrix.data![r]?.[m.id] ?? 'none';
                    const custom = level !== defaultRoleAccess(r, m.id);
                    return (
                      <td key={m.id} className={`matrix-cell${custom ? ' lvl-custom' : ''}`} title={custom ? `${t('roles_custom_mark')}: ${t(tk('acc_level_', defaultRoleAccess(r, m.id)))} → ${t(tk('acc_level_', level))}` : undefined}>
                        {canEdit ? (
                          <Select<AccessLevel>
                            value={level}
                            className={`lvl-select lvl-${level}`}
                            ariaLabel={`${t(tk('role_', r))} · ${moduleName(m, t, loc)}`}
                            onChange={async (v) => {
                              try {
                                await securityApi.setAccess(r, m.id, v);
                                toast(`${t(tk('role_', r))} · ${moduleName(m, t, loc)}: ${t(tk('acc_level_', v))}`);
                              } catch (e) {
                                toast(e instanceof Error && e.message === 'ADMIN_LOCKOUT' ? t('roles_admin_lockout') : `${t('actionFailed')}: ${userError(e)}`);
                              }
                            }}
                            options={ACCESS_LEVELS.map((l) => ({ value: l, label: t(tk('acc_level_', l)) }))}
                          />
                        ) : (
                          <span className={`lvl-chip lvl-${level}`}>{t(tk('acc_level_', level))}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {special.data && (
        <div className="table-wrap" style={{ margin: '12px 0' }}>
          <table className="table roles-special">
            <thead>
              <tr>
                <th>{t('roles_special_title')}</th>
                {roles.filter((r) => special.data![r]?.audit_retention !== 'none' || special.data![r]?.pd_full !== 'none').map((r) => (
                  <th key={r}>{t(tk('role_', r))}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['audit_retention', 'pd_full'] as const).map((mid) => (
                <tr key={mid} data-special={mid}>
                  <th>{t(mid === 'audit_retention' ? 'roles_special_audit_retention' : 'roles_special_pd_full')}</th>
                  {roles.filter((r) => special.data![r]?.audit_retention !== 'none' || special.data![r]?.pd_full !== 'none').map((r) => {
                    const level = special.data![r]?.[mid] ?? 'none';
                    return <td key={r}><span className={`lvl-chip lvl-${level}`}>{t(tk('acc_level_', level))}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="roles-foot">
        <div>
          <b>{t('roles_categories')}</b>
          <ul className="cat-list">
            {ROLE_CATEGORIES.map((c) => (
              <li key={c.category}>
                <span>{t(tk('rolecat_', c.category))}</span>
                <span className="muted">→ {c.roles.map((r) => t(tk('role_', r))).join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <b>{t('roles_sod')}</b>
          <ul className="cat-list">
            {SOD_RULES.map((s) => (
              <li key={s.id}>{t(tk('sod_', s.id.replace(/^sod_/, '')))}</li>
            ))}
          </ul>
          <p className="muted small">{t('roles_levels_hint')}</p>
        </div>
      </div>
    </>
  );
}

function Positions() {
  const { t, loc } = useSession();
  const positions = useApi(() => securityApi.listPositions());
  const users = useApi(() => api.listUsers());
  return (
    <>
      <p className="muted small" style={{ padding: '12px 14px 0', margin: 0 }}>{t('roles_positions_hint')}</p>
      <DataTable
        rows={positions.data}
        loading={positions.loading}
        rowKey={(p) => p.id}
        columns={[
          { header: t('code'), render: (p) => <span className="doc-num">{p.code}</span> },
          { header: t('usr_position'), render: (p) => loc(p.name) },
          { header: t('usr_role_by_position'), render: (p) => <Badge tone="info">{t(tk('role_', p.defaultRole))}</Badge> },
          { header: t('usr_title'), align: 'right', render: (p) => users.data?.filter((u) => u.positionId === p.id).length ?? 0 },
        ]}
      />
    </>
  );
}

const FLAG_TONES: Record<AccessReviewRow['flags'][number], 'danger' | 'warn' | 'info' | 'muted'> = {
  privileged: 'warn',
  inactive_with_access: 'danger',
  unused: 'muted',
  locked: 'danger',
  extra_roles: 'info',
};

function AccessReview() {
  const { t, loc } = useSession();
  const toast = useToast();
  const ids = MODULES.map((m) => m.id);
  const review = useApi(() => securityApi.accessReview(ids), [ids.join(',')]);
  const [q, setQ] = useState('');
  const [flag, setFlag] = useState('');
  const [mod, setMod] = useState('');
  const [detail, setDetail] = useState<AccessReviewRow | null>(null);
  const canRevoke = useCan()('users', 'edit');
  const stepUp = useStepUp();
  const rows = (review.data ?? []).filter(
    (r) =>
      (!q.trim() || `${r.fullName} ${r.login}`.toLowerCase().includes(q.trim().toLowerCase())) &&
      (!flag || (flag === 'sod' ? r.sod.length > 0 : r.flags.includes(flag as never))) &&
      (!mod || r.levels[mod] !== 'none'),
  );
  const all = review.data ?? [];

  function doExport(format: 'csv' | 'xlsx') {
    exportTable(
      format,
      t('roles_tab_review'),
      [{ header: t('usr_name'), width: 26 }, { header: t('auth_username') }, { header: t('status') }, { header: t('role'), width: 26 }, { header: t('usr_last_login'), width: 18 }, { header: t('review_flags'), width: 30 }, { header: 'SoD', width: 30 }, ...MODULES.map((m) => ({ header: moduleName(m, t, loc) }))],
      rows.map((r) => [
        r.fullName,
        r.login,
        r.active ? t('usr_status_active') : t('usr_status_inactive'),
        r.roles.map((x) => t(tk('role_', x))).join(', '),
        r.lastLogin ?? '',
        r.flags.map((f) => t(tk('review_flag_', f))).join(', '),
        r.sod.map((s) => t(tk('sod_', s.replace(/^sod_/, '')))).join(', '),
        ...MODULES.map((m) => t(tk('acc_level_', r.levels[m.id] ?? 'none'))),
      ]),
      `${t('roles_tab_review')} · ${formatDateTime(new Date().toISOString())}`,
    );
    toast(`${t('audit_exported')}: ${rows.length}`);
  }

  return (
    <>
      <div className="grid grid-4" style={{ padding: 14 }}>
        <Stat label={t('review_users')} value={all.length} icon="user" />
        <Stat label={t('review_privileged')} value={all.filter((r) => r.flags.includes('privileged')).length} tone="accent" />
        <Stat label={t('review_sod')} value={all.filter((r) => r.sod.length).length} tone={all.some((r) => r.sod.length) ? 'alert' : undefined} icon="alert" />
        <Stat label={t('review_inactive_access')} value={all.filter((r) => r.flags.includes('inactive_with_access')).length} tone={all.some((r) => r.flags.includes('inactive_with_access')) ? 'alert' : undefined} />
      </div>
      <FilterBar>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}…`} />
        <Select<string> value={flag} onChange={setFlag} placeholder={`${t('review_flags')}: ${t('all')}`} options={[...(['privileged', 'inactive_with_access', 'unused', 'locked', 'extra_roles'] as const).map((f) => ({ value: f, label: t(tk('review_flag_', f)) })), { value: 'sod', label: t('review_sod') }]} ariaLabel={t('review_flags')} />
        <Select<string> value={mod} onChange={setMod} placeholder={`${t('review_module')}: ${t('all')}`} options={MODULES.map((m) => ({ value: m.id, label: moduleName(m, t, loc) }))} ariaLabel={t('review_module')} />
        <Button onClick={() => doExport('csv')}>CSV</Button>
        <Button type="primary" onClick={() => doExport('xlsx')}>XLSX</Button>
      </FilterBar>
      <DataTable
        rows={review.data ? rows : undefined}
        loading={review.loading}
        rowKey={(r) => r.userId}
        onRowClick={setDetail}
        emptyText={t('search_nothing')}
        columns={[
          { header: t('usr_name'), render: (r) => <><div style={{ fontWeight: 600 }}>{r.fullName}</div><div className="sub">{r.login}{!r.active && ` · ${t('usr_status_inactive')}`}</div></> },
          { header: t('role'), render: (r) => r.roles.map((x) => t(tk('role_', x))).join(', ') },
          ...(mod ? [{ header: moduleName(MODULES.find((m) => m.id === mod)!, t, loc), render: (r: AccessReviewRow) => <span className={`lvl-chip lvl-${r.levels[mod]}`}>{t(tk('acc_level_', r.levels[mod] ?? 'none'))}</span> }] : []),
          { header: t('review_modules'), align: 'right', render: (r) => Object.values(r.levels).filter((l) => l !== 'none').length },
          { header: t('review_flags'), render: (r) => <div className="badges">{r.flags.map((f) => <Badge key={f} tone={FLAG_TONES[f]}>{t(tk('review_flag_', f))}</Badge>)}{r.sod.map((s) => <Badge key={s} tone="danger">SoD</Badge>)}</div> },
          { header: t('usr_last_login'), render: (r) => <span className="num small">{r.lastLogin ? formatDateTime(r.lastLogin) : '—'}</span> },
        ]}
      />
      <p className="muted small" style={{ padding: '0 14px 14px', margin: 0 }}>{t('review_note')}</p>
      <ReviewSignOff all={all} />
      {detail && (
        <Modal
          title={detail.fullName}
          onClose={() => setDetail(null)}
          footer={
            <>
              <Button onClick={() => setDetail(null)}>{t('cancel')}</Button>
              {canRevoke && detail.roles.length > 1 && (
                <Button
                  danger
                  className="review-revoke"
                  onClick={async () => {
                    if (!(await stepUp(t('review_revoke')))) return;
                    await securityApi.revokeExtraRoles(detail.userId, 'access review');
                    accessReviewApi.noteRevoked();
                    toast(`${detail.fullName}: ${t('review_revoked')}`);
                    setDetail(null);
                  }}
                >
                  {t('review_revoke')}
                </Button>
              )}
              {canRevoke && detail.active && detail.flags.includes('unused') && (
                <Button
                  danger
                  onClick={async () => {
                    if (!(await stepUp(t('usr_deactivate')))) return;
                    try {
                      await securityApi.setUserActive(detail.userId, false);
                      accessReviewApi.noteRevoked();
                      toast(`${detail.fullName}: ${t('usr_status_inactive')}`);
                      setDetail(null);
                    } catch (e) {
                      toast(`${t('actionFailed')}: ${userError(e)}`);
                    }
                  }}
                >
                  {t('usr_deactivate')}
                </Button>
              )}
              <Button type="primary" onClick={() => navigate(`/settings/users?u=${detail.userId}`)}>{t('review_open_user')}</Button>
            </>
          }
        >
          {!!detail.sod.length && (
            <div className="banner danger">
              {detail.sod.map((s) => (
                <div key={s}>SoD: {t(tk('sod_', s.replace(/^sod_/, '')))}</div>
              ))}
            </div>
          )}
          <table className="table">
            <tbody>
              {MODULES.filter((m) => detail.levels[m.id] !== 'none').map((m) => (
                <tr key={m.id}>
                  <td>{moduleName(m, t, loc)}</td>
                  <td className="right"><span className={`lvl-chip lvl-${detail.levels[m.id]}`}>{t(tk('acc_level_', detail.levels[m.id] ?? 'none'))}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </>
  );
}

/** P3-GEN (PR-SEC-035/056): фиксация результата ежемесячного пересмотра прав с участием представителя Службы ИБ. */
function ReviewSignOff({ all }: { all: AccessReviewRow[] }) {
  const { t } = useSession();
  const toast = useToast();
  const canSign = useCan()('roles', 'edit');
  const history = useApi(() => accessReviewApi.list());
  const users = useApi(() => api.listUsers());
  const [officer, setOfficer] = useState('');
  const [comment, setComment] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const due = accessReviewApi.due();
  const officers = (users.data ?? []).filter((u) => u.active !== false && ['auditor', 'support', 'admin'].some((r) => u.role === r || u.extraRoles?.includes(r as never)));
  async function sign() {
    setIssues({});
    try {
      await accessReviewApi.sign({
        securityOfficerId: officer,
        comment,
        stats: {
          users: all.length,
          privileged: all.filter((r) => r.flags.includes('privileged')).length,
          sod: all.filter((r) => r.sod.length).length,
          inactiveWithAccess: all.filter((r) => r.flags.includes('inactive_with_access')).length,
          unused: all.filter((r) => r.flags.includes('unused')).length,
        },
      });
      setComment('');
      toast(t('review_signed'));
    } catch (e) {
      if (e instanceof ValidationError) setIssues(e.issues);
      else toast(t('actionFailed'));
    }
  }
  return (
    <div className="review-signoff">
      <div className={`banner ${due.overdue ? 'danger' : 'info'} review-due`}>
        {due.overdue ? t('review_overdue') : t('review_next')}: <b className="num">{formatDate(due.nextDue)}</b>
        {due.last && <span className="muted"> · {t('review_last')}: {formatDate(due.last)}</span>}
      </div>
      {canSign && (
        <div className="form-grid">
          <Field label={t('review_officer')} required error={issues.securityOfficerId ? t(issues.securityOfficerId as never) : undefined}>
            <Select<string> value={officer} onChange={setOfficer} placeholder="—" options={officers.map((u) => ({ value: u.id, label: `${u.fullName} · ${t(tk('role_', u.role))}` }))} ariaLabel={t('review_officer')} />
          </Field>
          <Field label={t('review_comment')} required error={issues.comment ? t(issues.comment as never) : undefined}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} ariaLabel={t('review_comment')} />
          </Field>
          <div><Button type="primary" icon="check" onClick={sign} className="review-sign-btn">{t('review_sign')}</Button></div>
        </div>
      )}
      <DataTable
        rows={history.data}
        loading={history.loading}
        rowKey={(r) => r.id}
        emptyText="—"
        columns={[
          { header: t('review_date'), render: (r) => <span className="num small">{formatDateTime(r.at)}</span> },
          { header: t('review_participants'), render: (r) => <><div>{r.reviewerName}</div><div className="sub">{t('review_officer')}: {r.securityOfficerName}</div></> },
          { header: t('review_findings'), render: (r) => <span className="small">{t('review_users')}: {r.users} · SoD: {r.sod} · {t('review_privileged')}: {r.privileged} · {t('review_inactive_access')}: {r.inactiveWithAccess} · {t('review_revoked_count')}: {r.revoked}</span> },
          { header: t('review_comment'), render: (r) => <span className="small">{r.comment}</span> },
        ]}
      />
    </div>
  );
}
