// P3-GEN: сервисные учётные записи интеграций (PR-SEC-040) и правила DLP для экспорта/печати (PR-SEC-072, PR-SEC-046).
import { ACCESS_LEVELS, DATA_CATEGORIES, dlpApi, formatDate, secretOverdue, serviceAccountsApi, tk, type AccessLevel, type DataCategory } from '@xb/shared';
import { Badge, Button, Card, DataTable, Select, Switch, useToast } from '../../components/ui';
import { useStepUp } from '../../lib/access';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { MODULES } from '../../modules';

export function ServiceAccountsCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useSession();
  const toast = useToast();
  const stepUp = useStepUp();
  const list = useApi(() => serviceAccountsApi.list());
  const rows = list.data ?? [];
  return (
    <Card title={`${t('sa_title')} · ${rows.length}`} flush>
      <p className="muted small" style={{ padding: '10px 14px 0', margin: 0 }}>{t('sa_hint')}</p>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(a) => a.id}
        columns={[
          { header: t('sa_login'), render: (a) => <><span className="doc-num">{a.login}</span><div className="sub">{t('sa_interactive_off')}</div></> },
          { header: t('sa_scopes'), render: (a) => <span className="small">{a.scopes.join(', ')}</span> },
          { header: t('sa_secret'), render: (a) => <><div className="num small sa-ref">{a.secretRef}</div><div className="sub">{a.auth}</div></> },
          {
            header: t('sa_rotated'),
            render: (a) => (
              <>
                <div className="num small">{formatDate(a.rotatedAt)}</div>
                {secretOverdue(a) ? <Badge tone="danger">{t('sa_overdue')}</Badge> : <div className="sub">≤ {a.rotationDays} {t('pwd_days_left')}</div>}
              </>
            ),
          },
          {
            header: '',
            align: 'right',
            render: (a) =>
              canEdit ? (
                <Button
                  size="small"
                  onClick={async () => {
                    if (!(await stepUp(`${t('sa_rotate')}: ${a.login}`))) return;
                    await serviceAccountsApi.rotate(a.id);
                    toast(`${a.login}: ${t('sa_rotated_done')}`);
                  }}
                >
                  {t('sa_rotate')}
                </Button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}

export function DlpCard({ canEdit }: { canEdit: boolean }) {
  const { t, loc } = useSession();
  const toast = useToast();
  const rules = useApi(() => dlpApi.getRules());
  const cats = dlpApi.categories();
  const modsOf = (c: DataCategory) =>
    MODULES.filter((m) => cats[m.id] === c)
      .map((m) => (typeof m.name === 'string' ? t(m.name) : loc(m.name)))
      .join(', ');
  const save = async (c: DataCategory, patch: Partial<{ exportLevel: AccessLevel; printLevel: AccessLevel; stepUp: boolean }>) => {
    const cur = rules.data![c];
    await dlpApi.setRule(c, { ...cur, ...patch });
    toast(`DLP · ${t(tk('dlp_cat_', c))}: ${t('saved')}`);
  };
  const levelOpts = ACCESS_LEVELS.filter((l) => l !== 'none').map((l) => ({ value: l, label: t(tk('acc_level_', l)) }));
  return (
    <Card title={t('dlp_title')} flush actions={canEdit && <Button size="small" onClick={async () => (await dlpApi.reset(), toast(t('saved')))}>{t('dlp_reset')}</Button>}>
      <p className="muted small" style={{ padding: '10px 14px 0', margin: 0 }}>{t('dlp_hint')}</p>
      <DataTable
        rows={rules.data ? DATA_CATEGORIES : undefined}
        loading={rules.loading}
        rowKey={(c) => c}
        columns={[
          { header: t('dlp_category'), render: (c) => <><div style={{ fontWeight: 600 }}>{t(tk('dlp_cat_', c))}</div><div className="sub">{modsOf(c) || '—'}</div></> },
          {
            header: t('dlp_export'),
            render: (c) =>
              canEdit ? (
                <Select<AccessLevel> value={rules.data![c].exportLevel} onChange={(v) => save(c, { exportLevel: v })} options={levelOpts} ariaLabel={`${t('dlp_export')} · ${t(tk('dlp_cat_', c))}`} />
              ) : (
                t(tk('acc_level_', rules.data![c].exportLevel))
              ),
          },
          {
            header: t('dlp_print'),
            render: (c) =>
              canEdit ? (
                <Select<AccessLevel> value={rules.data![c].printLevel} onChange={(v) => save(c, { printLevel: v })} options={levelOpts} ariaLabel={`${t('dlp_print')} · ${t(tk('dlp_cat_', c))}`} />
              ) : (
                t(tk('acc_level_', rules.data![c].printLevel))
              ),
          },
          { header: t('dlp_stepup'), render: (c) => <Switch checked={rules.data![c].stepUp} onChange={(v) => save(c, { stepUp: v })} disabled={!canEdit} ariaLabel={`${t('dlp_stepup')} · ${t(tk('dlp_cat_', c))}`} /> },
        ]}
      />
    </Card>
  );
}
