// P2-PROC: небольшие общие блоки экранов закупок.
import { tk, type ProcVerification } from '@xb/shared';
import { Badge } from '../../components/ui';
import { Icon } from '../../components/icons';
import { useSession } from '../../lib/session';

/** Результат верификации заявки: проверка, итог, подробности. */
export function VerificationList({ v }: { v: ProcVerification }) {
  const { t } = useSession();
  return (
    <div className="pc-checks" data-testid="verification">
      <div style={{ marginBottom: 8 }}>
        <Badge tone={v.ok ? 'ok' : 'danger'}>{v.ok ? t('proc_verifyOk') : t('proc_verifyFail')}</Badge>
      </div>
      {v.checks.map((c) => (
        <div key={c.code} className={`pc-check ${c.ok ? 'ok' : c.severity}`}>
          <Icon name={c.ok ? 'check' : 'alert'} size={15} />
          <span>
            {t(tk('proc_', c.code))}
            {!c.ok && c.detail ? <span className="muted"> · {c.detail}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Этапы процесса закупки (PR-PROC-026), текущий выделен. */
export function ProcessChips({ steps, current }: { steps: string[]; current?: number }) {
  const { t } = useSession();
  return (
    <div className="pc-process">
      {steps.map((s, i) => (
        <span key={`${s}-${i}`} className={`pc-chip ${current === undefined ? '' : i < current ? 'done' : i === current ? 'on' : ''}`}>
          <b>{i + 1}</b> {t(tk('proc_step_', s))}
        </span>
      ))}
    </div>
  );
}
