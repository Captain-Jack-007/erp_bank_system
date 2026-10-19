// P2-PROC: общие помощники экранов закупок, договоров и заявок на обеспечение.
import { useMemo, type ReactNode } from 'react';
import { dictionaries, orgApi, ProcError, type TKey, userMessage } from '@xb/shared';
import { Badge, Select, type Tone } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { NoAccessPage, useCan } from '../../lib/access';
import './proc.css';

/** Закупщик: отдел закупок или администратор (у сотрудников право «procurement: edit» только для подачи заявок). */
export function useIsBuyer(): boolean {
  const can = useCan();
  const user = useUser();
  return can('procurement', 'edit') && (user.role === 'procurement' || user.role === 'admin' || !!user.extraRoles?.includes('procurement'));
}

/** Текст ошибки API: коды proc_err_* переводятся, прочие показываются как есть. */
export function useErr(): (e: unknown) => string {
  const { t } = useSession();
  return (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    const detail = e instanceof ProcError && e.detail ? `: ${e.detail}` : '';
    if (msg in dictionaries.ru) return `${t(msg as TKey)}${detail}`;
    return userMessage(msg);
  };
}

/** Справочник МВЗ (все действующие) — подписи «код · название». */
export function useCostCenters() {
  const { loc } = useSession();
  const all = useApi(() => orgApi.listCostCenters({ pageSize: 1000, status: 'active' }), []);
  return useMemo(() => {
    const rows = all.data?.rows ?? [];
    const map = new Map(rows.map((c) => [c.key, c]));
    return {
      rows,
      label: (key?: string) => {
        if (!key) return '—';
        const c = map.get(key);
        return c ? `${c.code} · ${loc(c.name)}` : key;
      },
      forUnit: (unit?: string) => rows.filter((c) => !unit || c.orgUnitKey === unit),
    };
  }, [all.data, loc]);
}

/** Выбор МВЗ: сначала МВЗ оргединицы, затем остальные (поиск по коду в списке). */
export function CostCenterSelect({ value, onChange, unit, disabled, ariaLabel }: { value: string; onChange: (v: string) => void; unit?: string; disabled?: boolean; ariaLabel?: string }) {
  const cc = useCostCenters();
  const own = cc.forUnit(unit);
  const list = own.length ? own : cc.rows.slice(0, 300);
  const opts = list.map((c) => ({ value: c.key, label: cc.label(c.key) }));
  if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: cc.label(value) });
  return <Select<string> value={value} onChange={onChange} options={opts} placeholder="—" disabled={!!disabled} ariaLabel={ariaLabel ?? 'MVZ'} />;
}

export const STATUS_TONES: Record<string, Tone> = {
  draft: 'muted', pending: 'info', approved: 'ok', rejected: 'danger', returned: 'warn', in_tender: 'info', in_exchange: 'info', contracted: 'ok', consolidated: 'muted', executed: 'ok',
  sent: 'info', accepted: 'ok', purchased: 'ok', distributed: 'ok', received: 'ok', open: 'warn', satisfied: 'ok', closed: 'muted', signed: 'ok', completed: 'ok', posted: 'ok', failed: 'danger',
  incoming: 'warn', counter_signed: 'ok', executed_order: 'ok', warehouse: 'info', reserved: 'info', issued: 'warn', done: 'ok', in_progress: 'info', planned: 'muted', overdue: 'danger', due: 'warn', paid: 'ok', late: 'warn',
};

export function ToneBadge({ status, label }: { status: string; label: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'muted'}>{label}</Badge>;
}

/** Поле «ключ: значение» для карточек (kv-список). */
export function Kv({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <span key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </span>
      ))}
    </dl>
  );
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Форма создания документа доступна только с правом edit на модуль (иначе — страница 403). */
export function EditGate({ moduleId, children }: { moduleId: string; children: ReactNode }) {
  const can = useCan();
  return can(moduleId, 'edit') ? <>{children}</> : <NoAccessPage moduleId={moduleId} />;
}
