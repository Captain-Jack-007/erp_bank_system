// Пополевая история изменений записи (ТЗ PR-SEC-023): кто, когда, какое поле, с какого значения на какое.
// Источник — общий журнал аудита ядра (auditApi.history). Использование:
//   <FieldHistory entity="cost_center" entityId={key} fieldLabel={(f) => t(...)} />
import { auditApi, formatDateTime, tk, type AuditEntry } from '@xb/shared';
import { Badge, Empty, Loading, type Tone } from './ui';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export const AUDIT_TONES: Partial<Record<AuditEntry['action'], Tone>> = {
  create: 'ok', update: 'info', delete: 'danger', approve: 'ok', reject: 'danger', submit: 'warn', block: 'danger', unblock: 'ok',
  login: 'ok', logout: 'muted', login_failed: 'danger', lockout: 'danger', unlock: 'ok', access_change: 'warn', settings: 'warn',
  activate: 'ok', deactivate: 'danger', export: 'info', step_up: 'ok', step_up_failed: 'danger', session_timeout: 'muted',
};

export function AuditActionBadge({ action, result }: { action: AuditEntry['action']; result?: AuditEntry['result'] }) {
  const { t } = useSession();
  return <Badge tone={result === 'failure' ? 'danger' : (AUDIT_TONES[action] ?? 'muted')}>{t(tk('audit_action_', action))}</Badge>;
}

export function ChangesTable({ changes, fieldLabel }: { changes: NonNullable<AuditEntry['changes']>; fieldLabel?: (field: string) => string }) {
  const { t } = useSession();
  return (
    <table className="table changes-table">
      <thead>
        <tr>
          <th>{t('audit_field')}</th>
          <th>{t('audit_from')}</th>
          <th>{t('audit_to')}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c, i) => (
          <tr key={i}>
            <td className="change-field">{fieldLabel ? fieldLabel(c.field) : c.field}</td>
            <td className="change-from">{c.from}</td>
            <td className="change-to">{c.to}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FieldHistory({ entity, entityId, fieldLabel }: { entity: string; entityId: string; fieldLabel?: (field: string) => string }) {
  const { t } = useSession();
  const h = useApi(() => auditApi.history(entity, entityId), [entity, entityId]);
  if (h.loading && !h.data) return <Loading />;
  const rows = h.data ?? [];
  if (!rows.length) return <Empty text={t('audit_history_empty')} icon="clock" />;
  return (
    <ul className="field-history">
      {rows.map((e) => (
        <li key={e.id}>
          <div className="fh-head">
            <AuditActionBadge action={e.action} result={e.result} />
            <b>{e.userName}</b>
            <span className="muted small num">{formatDateTime(e.at)}</span>
            {e.details && <span className="muted small">· {e.details}</span>}
          </div>
          {!!e.changes?.length && <ChangesTable changes={e.changes} {...(fieldLabel ? { fieldLabel } : {})} />}
        </li>
      ))}
    </ul>
  );
}
