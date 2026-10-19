// P4-GEN (ТЗ PR-GEN-018): синхронизация пользователей с Active Directory (каталог имитируется через
// integrationHub): предпросмотр различий (новые / изменённые / отключённые), выбор строк и применение
// с подтверждением кодом 2FA; таблица сопоставления групп AD → роли XB-ERP с редактированием (2FA + аудит).
import { useState } from 'react';
import { adApi, AD_BASE_DN, AD_DOMAIN, formatDateTime, ROLES, tk, type AdDiffRow, type AdSyncPreview, type AdSyncRun, type Role } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Empty, Field, FilterBar, Input, Select, useToast, type Tone } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useCan, useStepUp } from '../../lib/access';
import '../../p4gen.css';

const KIND_TONE: Record<AdDiffRow['kind'], Tone> = { new: 'ok', changed: 'info', disabled: 'danger' };

export function AdSyncTab() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const stepUp = useStepUp();
  const canEdit = useCan()('users', 'edit');
  const mapping = useApi(() => adApi.getMapping());
  const groups = useApi(() => adApi.listGroups());
  const runs = useApi(() => adApi.listRuns());
  const [preview, setPreview] = useState<AdSyncPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [last, setLast] = useState<AdSyncRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [newRole, setNewRole] = useState<Role | ''>('');
  const fieldLabel = (f: string) => t(tk('p4g_ad_field_', f));
  const showVal = (f: string, v: string) => (f === 'role' && v !== '—' ? t(tk('role_', v)) : f === 'extraRoles' && v !== '—' ? v.split(', ').map((r) => t(tk('role_', r))).join(', ') : f === 'active' ? (v === 'true' ? t('p4g_ad_active') : t('p4g_ad_inactive')) : v);

  async function load() {
    setBusy(true);
    setError('');
    try {
      const p = await adApi.previewSync(user.id);
      setPreview(p);
      setSelected(p.rows.filter((r) => !r.issue).map((r) => r.key));
      setLast(null);
    } catch (e) {
      setError(adApi.isUnavailable(e) ? t('p4g_ad_unavailable') : t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview || !selected.length) return;
    if (!(await stepUp(`${t('p4g_ad_apply')} (${selected.length})`))) return;
    setBusy(true);
    try {
      const run = await adApi.applySync(preview.id, selected, user.id);
      setLast(run);
      setPreview({ ...preview, rows: preview.rows.filter((r) => !run.results.some((x) => x.key === r.key && x.ok)) });
      setSelected([]);
      toast(`${t('p4g_ad_applied')}: ${run.applied}${run.failed ? ` · ${t('p4g_ad_failed')}: ${run.failed}` : ''}`);
    } finally {
      setBusy(false);
    }
  }

  async function setMap(group: string, role: Role | null) {
    if (!(await stepUp(`${t('p4g_ad_mapping')}: ${group}`))) return;
    await adApi.setMapping(group, role, user.id);
    toast(`${group} → ${role ? t(tk('role_', role)) : t('p4g_ad_noRole')}`);
    if (preview) await load();
  }

  const roleOptions = [{ value: '' as Role | '', label: t('p4g_ad_noRole') }, ...ROLES.map((r) => ({ value: r as Role | '', label: t(tk('role_', r)) }))];
  const members = (g: string) => groups.data?.find((x) => x.group.toLowerCase() === g.toLowerCase())?.members ?? 0;

  return (
    <>
      <Card
        title={
          <div className="svc-spread" style={{ width: '100%' }}>
            <h2>{t('p4g_ad_syncTitle')}</h2>
            {canEdit && (
              <Button type="primary" icon="refresh" loading={busy} onClick={load} className="ad-load">
                {t('p4g_ad_load')}
              </Button>
            )}
          </div>
        }
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('p4g_ad_hint')} <span className="svc-mono">{AD_DOMAIN} · {AD_BASE_DN}</span>
        </p>
        {error && <div className="banner danger ad-error">{error}</div>}
        {preview && (
          <div data-testid="ad-preview" data-rows={preview.rows.length}>
            <div className="svc-row small" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <span>{t('p4g_ad_accounts')}: <b>{preview.accounts}</b></span>
              <span>{t('p4g_ad_kind_new')}: <b>{preview.rows.filter((r) => r.kind === 'new').length}</b></span>
              <span>{t('p4g_ad_kind_changed')}: <b>{preview.rows.filter((r) => r.kind === 'changed').length}</b></span>
              <span>{t('p4g_ad_kind_disabled')}: <b>{preview.rows.filter((r) => r.kind === 'disabled').length}</b></span>
              <span>{t('p4g_ad_unchanged')}: <b>{preview.unchanged}</b></span>
              <span className="muted">{formatDateTime(preview.at)} · {preview.exchangeId}</span>
            </div>
            {!preview.rows.length ? (
              <Empty text={t('p4g_ad_inSync')} icon="check" />
            ) : (
              <DataTable
                rows={preview.rows}
                rowKey={(r) => r.key}
                columns={[
                  {
                    header: '',
                    render: (r) => (
                      <Checkbox checked={selected.includes(r.key)} disabled={!!r.issue || !canEdit} onChange={(on) => setSelected(on ? [...selected, r.key] : selected.filter((k) => k !== r.key))}>
                        <span className="sr-only">{r.sam}</span>
                      </Checkbox>
                    ),
                  },
                  { header: t('p4g_ad_change'), render: (r) => <span data-testid="ad-row" data-key={r.key}><Badge tone={KIND_TONE[r.kind]}>{t(tk('p4g_ad_kind_', r.kind))}</Badge></span> },
                  { header: t('p4g_ad_account'), render: (r) => <><div>{r.displayName}</div><div className="sub svc-mono">{AD_DOMAIN}\{r.sam}</div></> },
                  {
                    header: t('p4g_ad_diff'),
                    render: (r) => (
                      <ul className="p4-diff">
                        {r.changes.map((c) => (
                          <li key={c.field}>
                            <span className="muted">{fieldLabel(c.field)}:</span> {r.kind !== 'new' && <><s>{showVal(c.field, c.from)}</s> → </>}<b>{showVal(c.field, c.to)}</b>
                          </li>
                        ))}
                        {r.issue && <li className="field-error">{t(tk('p4g_ad_issue_', r.issue))}</li>}
                        {last?.results.find((x) => x.key === r.key && !x.ok) && <li className="field-error">{last.results.find((x) => x.key === r.key)!.error}</li>}
                      </ul>
                    ),
                  },
                ]}
              />
            )}
            {canEdit && preview.rows.length > 0 && (
              <div className="svc-row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button type="primary" icon="check" disabled={!selected.length} loading={busy} onClick={apply} className="ad-apply">
                  {t('p4g_ad_apply')} ({selected.length})
                </Button>
              </div>
            )}
          </div>
        )}
        {!preview && !error && <Empty text={t('p4g_ad_notLoaded')} icon="users" />}
      </Card>

      <Card title={t('p4g_ad_mapping')} flush>
        <p className="small muted" style={{ margin: '0 16px 10px' }}>{t('p4g_ad_mappingHint')}</p>
        <DataTable
          rows={mapping.data}
          loading={mapping.loading}
          rowKey={(m) => m.group}
          columns={[
            { header: t('p4g_ad_group'), render: (m) => <span className="svc-mono" data-testid="ad-map" data-group={m.group} data-role={m.role ?? ''}>{m.group}</span> },
            { header: t('p4g_ad_members'), render: (m) => members(m.group), align: 'right' },
            {
              header: t('p4g_ad_role'),
              render: (m) => (
                <Select<Role | ''> value={m.role ?? ''} disabled={!canEdit} ariaLabel={`${t('p4g_ad_role')} ${m.group}`} onChange={(v) => void setMap(m.group, v || null)} options={roleOptions} />
              ),
            },
          ]}
        />
        {canEdit && (
          <FilterBar>
            <Field label={t('p4g_ad_group')}>
              <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="XB-ERP-…" ariaLabel={t('p4g_ad_group')} />
            </Field>
            <Field label={t('p4g_ad_role')}>
              <Select<Role | ''> value={newRole} onChange={setNewRole} ariaLabel={t('p4g_ad_role')} options={roleOptions} />
            </Field>
            <Button
              icon="plus"
              disabled={!newGroup.trim()}
              onClick={async () => {
                await setMap(newGroup.trim(), newRole || null);
                setNewGroup('');
                setNewRole('');
              }}
            >
              {t('p4g_ad_addMapping')}
            </Button>
          </FilterBar>
        )}
      </Card>

      <Card title={t('p4g_ad_runs')} flush>
        {runs.data && !runs.data.length ? (
          <Empty text={t('p4g_ad_noRuns')} icon="clock" />
        ) : (
          <DataTable
            rows={runs.data}
            loading={runs.loading}
            rowKey={(r) => r.id}
            columns={[
              { header: t('audit_time'), render: (r) => <span className="num small">{formatDateTime(r.at)}</span> },
              { header: t('p4g_ad_applied'), render: (r) => r.applied, align: 'right' },
              { header: t('p4g_ad_failed'), render: (r) => r.failed, align: 'right' },
              { header: t('p4g_ad_diff'), render: (r) => <span className="small">{r.results.map((x) => `${x.key.split(':')[1]}${x.ok ? '' : ` ✗ (${x.error ?? ''})`}`).join(', ')}</span> },
            ]}
          />
        )}
      </Card>
    </>
  );
}

