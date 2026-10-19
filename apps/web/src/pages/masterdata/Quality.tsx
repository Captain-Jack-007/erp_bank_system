// Качество данных справочников: проверки по всем записям + правила барьера (Data Quality Firewall).
import { orgApi, tk, type TKey } from '@xb/shared';
import { Badge, DataTable } from '../../components/ui';
import { navigate } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';

const RULES = ['dq_rule_required', 'dq_rule_cbu', 'dq_rule_code', 'dq_rule_dup', 'dq_rule_unit', 'dq_rule_attach', 'dq_rule_sod'] as const;

export function QualityTab() {
  const { t } = useSession();
  const dq = useApi(() => orgApi.dataQuality());
  const byCode = new Map<string, number>();
  for (const f of dq.data ?? []) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
  return (
    <>
      <div className="dq-summary">
        <div>
          <b>{t('dq_firewall_title')}</b>
          <ul className="cat-list">
            {RULES.map((r) => (
              <li key={r}>{t(r as TKey)}</li>
            ))}
          </ul>
        </div>
        <div>
          <b>{t('dq_findings')}</b>
          <ul className="cat-list">
            {[...byCode.entries()].map(([code, n]) => (
              <li key={code}>
                <span>{t(code as TKey)}</span> <Badge tone="warn">{n}</Badge>
              </li>
            ))}
            {!byCode.size && <li className="muted">{t('dq_clean')}</li>}
          </ul>
        </div>
      </div>
      <DataTable
        rows={dq.data}
        loading={dq.loading}
        rowKey={(f) => `${f.code}:${f.key}`}
        onRowClick={(f) => navigate(f.entity === 'cost_center' ? `/master-data/cc/${f.key}` : `/master-data/org/${f.key}`)}
        emptyText={t('dq_clean')}
        columns={[
          { header: t('dq_check'), render: (f) => <Badge tone={f.code === 'dqr_cc_in_closed_unit' ? 'danger' : 'warn'}>{t(f.code as TKey)}</Badge> },
          { header: t('mdm_record'), render: (f) => <><div>{f.label}</div><div className="sub">{t(tk('mdm_entity_', f.entity))} · {f.key}</div></> },
          { header: t('audit_details'), render: (f) => <span className="muted small">{f.detail ?? '—'}</span> },
        ]}
      />
    </>
  );
}
