// UI-кит XB-ERP. Все экраны собираются из этих компонентов — новые модули не должны
// вводить собственные кнопки, таблицы или бейджи.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { approvalsApi, formatDate, formatDateTime, messageText, reportAppError, tk, type ApprovalEntity, type HistoryEvent, type Role, type RouteContext, type StepState, type TKey } from '@xb/shared';
import { Icon, type IconName } from './icons';
import { useSession } from '../lib/session';
import { useApi, useLookups } from '../lib/useApi';
import { fmt, stepNames, stepTitle } from './flowLabels';
import { Link } from '../lib/router';

export function PageHeader({ title, subtitle, crumbs, actions }: { title: string; subtitle?: string; crumbs?: { label: string; to?: string }[]; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {crumbs && (
          <div className="crumb">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'contents' }}>
                {i > 0 && <Icon name="chevronRight" size={12} />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </div>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions}
        </div>
      )}
      <div className={`card-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

// Цвет статуса — единое правило для всех модулей.
const TONES: Record<string, Tone> = {
  draft: 'muted', pending: 'warn', approved: 'ok', rejected: 'danger', in_tender: 'info', contracted: 'ok',
  active: 'ok', expired: 'muted', terminated: 'danger',
  open: 'info', evaluation: 'warn', awarded: 'ok', cancelled: 'muted',
  in_progress: 'info', done: 'ok',
  // общие статусы модулей
  new: 'info', submitted: 'warn', review: 'warn', signed: 'ok', sent: 'info', accepted: 'ok', registered: 'ok', archived: 'muted',
  paid: 'ok', unpaid: 'muted', overdue: 'danger', planned: 'muted', closed: 'muted', calculated: 'info', posted: 'ok',
  in_use: 'ok', in_stock: 'info', repair: 'warn', maintenance: 'warn', written_off: 'muted', low: 'warn', out: 'danger',
  online: 'ok', offline: 'danger', warning: 'warn', in_transit: 'info', delivered: 'ok', completed: 'ok', failed: 'danger',
  reserved: 'info', returned: 'muted', blocked: 'danger', ok: 'ok', error: 'danger', available: 'ok',
};

/** Бейдж статуса: текст из словаря по ключу `${prefix}${status}`, цвет — из общей таблицы TONES (или tone). */
export function StatusBadge({ prefix, status, tone }: { prefix: string; status: string; tone?: Tone }) {
  const { t } = useSession();
  return <Badge tone={tone ?? TONES[status] ?? 'muted'}>{t(tk(prefix, status))}</Badge>;
}

export function Stat({ label, value, foot, tone, icon }: { label: string; value: ReactNode; foot?: ReactNode; tone?: 'accent' | 'alert'; icon?: IconName }) {
  return (
    <div className={`card stat ${tone ?? ''}`}>
      <div className="stat-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
        {label}
        {icon && <Icon name={icon} size={16} />}
      </div>
      <div className="stat-value num">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function Field({ label, required, hint, error, children, className }: { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {error ? <span className="error-text">{error}</span> : hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Empty({ text, icon = 'inbox' }: { text: string; icon?: IconName }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <div>{text}</div>
    </div>
  );
}

export function Loading() {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[80, 65, 72, 50].map((w, i) => (
        <div key={i} className="skeleton" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function Modal({ title, children, footer, onClose }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">{title}</div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}

export function Progress({ pct }: { pct: number }) {
  const cls = pct > 100 ? 'over' : pct >= 85 ? 'high' : '';
  return (
    <div className={`progress ${cls}`}>
      <span style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export function Timeline({ events }: { events: HistoryEvent[] }) {
  const { t } = useSession();
  const lk = useLookups();
  return (
    <ul className="timeline">
      {[...events].reverse().map((e, i) => (
        <li key={i}>
          <span className={`dot ${e.action === 'rejected' ? 'rejected' : ''}`} />
          <div>
            <div className="what">{t(tk('hist_', e.action))}</div>
            <div className="meta">
              {lk.user(e.userId)?.fullName ?? e.userId}
              {e.onBehalfOf && ` (${fmt(t('flow_on_behalf'), { name: lk.user(e.onBehalfOf)?.fullName ?? e.onBehalfOf })})`} · {formatDateTime(e.at)}
            </div>
            {e.comment && <div className="note">{e.comment}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Маршрут согласования: шаги «пройден / текущий / ожидает» с именами и датами.
 *  • entityId — фактический ход согласования документа (движок v2);
 *  • preview={{ entity, context }} — маршрут, который получит документ (до отправки, учитывает сумму и условия);
 *  • roles (+ current) — v1-совместимый вид по списку ролей (используется, пока нет данных).
 */
export function RouteSteps({ roles, current, entityId, preview }: { roles?: Role[]; current?: number; entityId?: string; preview?: { entity: ApprovalEntity; context?: RouteContext } }) {
  const { t, lang } = useSession();
  const lk = useLookups();
  const previewKey = preview ? JSON.stringify(preview) : '';
  const route = useApi(() => (entityId ? approvalsApi.getRoute(entityId) : Promise.resolve(undefined)), [entityId ?? '']);
  const pv = useApi(() => (preview ? approvalsApi.previewRoute(preview.entity, preview.context) : Promise.resolve(undefined)), [previewKey]);
  type Item = { title: string; names?: string; state: StepState; sub?: string; overdue?: boolean; parallel?: string };
  let items: Item[] = [];
  const name = (id?: string) => (id ? (lk.user(id)?.fullName ?? id) : '');
  if (route.data) {
    items = route.data.steps.map((s) => {
      const last = s.decisions[s.decisions.length - 1];
      const by = s.decisions.filter((d) => d.decision === 'approved' || s.state !== 'done').map((d) => `${name(d.userId)}${d.onBehalfOf ? ` (${fmt(t('flow_on_behalf'), { name: name(d.onBehalfOf) })})` : ''}`);
      const sub = s.state === 'done' ? [by.join(', '), (last?.at ?? s.finishedAt) && formatDate((last?.at ?? s.finishedAt)!)].filter(Boolean).join(' · ') : s.state === 'current' && s.dueAt ? `${t('flow_due')}: ${formatDateTime(s.dueAt)}` : s.state === 'rejected' || s.state === 'returned' ? [by.join(', '), last && formatDate(last.at)].filter(Boolean).join(' · ') : undefined;
      return { title: stepTitle(s, t, lang), names: s.state === 'done' ? undefined : stepNames(s), state: s.state, ...(sub ? { sub } : {}), overdue: s.overdue, ...(s.approvers.length > 1 ? { parallel: t(s.mode === 'any' ? 'flow_mode_any' : 'flow_mode_all') } : {}) };
    });
  } else if (pv.data) {
    items = pv.data.steps.map((s) => ({ title: stepTitle(s, t, lang), names: stepNames(s), state: 'pending' as const, sub: fmt(t('flow_sla_h'), { h: s.slaHours }), ...(s.approvers.length > 1 ? { parallel: t(s.mode === 'any' ? 'flow_mode_any' : 'flow_mode_all') } : {}) }));
  } else if (roles) {
    items = roles.map((r, i) => ({ title: t(tk('role_', r)), state: current === undefined ? 'pending' : i + 1 < current ? 'done' : i + 1 === current ? 'current' : 'pending' }));
  }
  return (
    <div className="route">
      {items.map((it, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className="route-arrow">→</span>}
          <span className={`route-step ${it.state}`} style={it.state === 'current' ? { borderColor: 'var(--brand-500)', background: 'var(--brand-50)' } : undefined} title={t(tk('flow_state_', it.state))}>
            <b>{it.state === 'done' ? '✓' : it.state === 'rejected' || it.state === 'returned' ? '!' : i + 1}</b>
            <span className="route-step-text">
              <span className="route-step-title">{it.title}</span>
              {it.parallel && <span className="route-step-sub">{t('flow_parallel')}: {it.parallel}</span>}
              {it.names && <span className="route-step-sub">{it.names}</span>}
              {it.sub && <span className={`route-step-sub ${it.overdue ? 'overdue' : ''}`}>{it.sub}</span>}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} className={`tab ${value === it.value ? 'on' : ''}`} onClick={() => onChange(it.value)}>
          {it.label}
          {it.count !== undefined && <span className="count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Toast ----------
const ToastContext = createContext<(msg: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useSession();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const put = useCallback((text: string, error: boolean) => {
    setMsg({ text, error });
    // Новый тост перезапускает таймер — старый таймер не должен скрыть свежее сообщение.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), error ? 8000 : 2600);
  }, []);
  // P3-GEN (PR-FUN-005, PR-TEC-008): сообщение об ошибке получает идентификатор события и следующий шаг,
  // технические подробности уходят в технический журнал и аудит.
  const show = useCallback(
    (m: string) => {
      const failed = t('actionFailed');
      if (failed && m.startsWith(failed)) {
        const id = reportAppError(m);
        // P4-SEC (PR-TEC-008): хвост «…: CODE» переводится по словарю кодов ошибок; технический текст скрыт
        const tail = m.slice(failed.length).replace(/^\s*[:·—-]\s*/, '');
        const shown = tail ? `${failed}: ${messageText(lang, tail)}` : failed;
        put(`${shown} · ${t('err_event_id')}: ${id}. ${t('err_next_step')}`, true);
      } else put(m, false);
    },
    [t, put, lang],
  );
  useEffect(() => {
    const onError = (message: string, details?: string) => {
      if (/ResizeObserver/.test(message)) return;
      const id = reportAppError(message, details);
      put(`${t('err_unexpected')} · ${t('err_event_id')}: ${id}. ${t('err_next_step')}`, true);
    };
    const onErr = (e: ErrorEvent) => onError(e.message || 'error', e.error instanceof Error ? e.error.stack : undefined);
    const onRej = (e: PromiseRejectionEvent) => onError(e.reason instanceof Error ? e.reason.message : String(e.reason), e.reason instanceof Error ? e.reason.stack : undefined);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, [t, put]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div className={`toast${msg.error ? ' toast-error' : ''}`} role={msg.error ? 'alert' : 'status'}>
          {msg.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function useT(): (key: TKey) => string {
  return useSession().t;
}

// ---------- Таблица данных ----------
export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  align?: 'right';
  width?: number | string;
}

/** Типовой реестр: заголовки, строки, клик по строке, загрузка и пустое состояние. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  loading,
  emptyText,
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyText?: string;
}) {
  const { t } = useSession();
  if (loading && !rows) return <Loading />;
  if (!rows?.length) return <Empty text={emptyText ?? t('empty')} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={c.align === 'right' ? 'right' : undefined} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={onRowClick ? 'clickable' : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c, i) => (
                <td key={i} className={c.align === 'right' ? 'right num' : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Панель фильтров над таблицей внутри Card flush. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
      {children}
    </div>
  );
}

// ---------- Графики (SVG, без зависимостей) ----------
export const CHART_COLORS = ['var(--brand-600)', 'var(--accent)', 'var(--info)', 'var(--warn)', 'var(--danger)', 'var(--text-3)'];

export interface ChartSeries {
  name: string;
  color?: string;
}

function ChartLegend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-2)', marginTop: 8 }}>
      {series.map((s, i) => (
        <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** Столбчатая диаграмма: категории по оси X, одна или несколько серий. */
export function BarChart({
  data,
  series,
  format = (n) => String(n),
  height = 220,
}: {
  data: { label: string; values: number[] }[];
  series: ChartSeries[];
  format?: (n: number) => string;
  height?: number;
}) {
  const W = 640;
  const H = height;
  const pad = { l: 8, r: 8, t: 18, b: 28 };
  const max = Math.max(1, ...data.flatMap((d) => d.values.map((v) => Math.abs(v))));
  const groupW = (W - pad.l - pad.r) / Math.max(1, data.length);
  const barW = Math.min(36, (groupW * 0.72) / Math.max(1, series.length));
  const plotH = H - pad.t - pad.b;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + plotH * (1 - f)} y2={pad.t + plotH * (1 - f)} stroke="var(--border)" strokeDasharray="3 4" />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} stroke="var(--border-strong)" />
        {data.map((d, gi) => {
          const gx = pad.l + gi * groupW + (groupW - barW * series.length) / 2;
          return (
            <g key={d.label}>
              {d.values.map((v, si) => {
                const h = (Math.abs(v) / max) * plotH;
                const x = gx + si * barW;
                const y = pad.t + plotH - h;
                return (
                  <g key={si}>
                    <rect x={x + 1} y={y} width={barW - 2} height={h} rx={3} fill={series[si]?.color ?? CHART_COLORS[si % CHART_COLORS.length]}>
                      <title>{`${d.label} · ${series[si]?.name ?? ''}: ${format(v)}`}</title>
                    </rect>
                    {series.length === 1 && (
                      <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={11} fill="var(--text-2)">
                        {format(v)}
                      </text>
                    )}
                  </g>
                );
              })}
              <text x={pad.l + gi * groupW + groupW / 2} y={H - 9} textAnchor="middle" fontSize={11} fill="var(--text-3)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartLegend series={series} />
    </div>
  );
}

/** Линейный график: динамика по периодам, одна или несколько серий. */
export function LineChart({
  labels,
  series,
  format = (n) => String(n),
  height = 220,
}: {
  labels: string[];
  series: (ChartSeries & { values: number[] })[];
  format?: (n: number) => string;
  height?: number;
}) {
  const W = 640;
  const H = height;
  const pad = { l: 8, r: 8, t: 16, b: 28 };
  const all = series.flatMap((s) => s.values);
  const max = Math.max(...all, 1);
  const min = Math.min(...all, 0);
  const plotH = H - pad.t - pad.b;
  const step = (W - pad.l - pad.r) / Math.max(1, labels.length - 1);
  const y = (v: number) => pad.t + plotH - ((v - min) / (max - min || 1)) * plotH;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + plotH * f} y2={pad.t + plotH * f} stroke="var(--border)" strokeDasharray="3 4" />
        ))}
        {series.map((s, si) => {
          const color = s.color ?? CHART_COLORS[si % CHART_COLORS.length];
          const pts = s.values.map((v, i) => `${pad.l + i * step},${y(v)}`).join(' ');
          return (
            <g key={s.name}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) => (
                <circle key={i} cx={pad.l + i * step} cy={y(v)} r={3} fill="#fff" stroke={color} strokeWidth={2}>
                  <title>{`${labels[i]} · ${s.name}: ${format(v)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {labels.map((l, i) => (
          <text key={i} x={pad.l + i * step} y={H - 9} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--text-3)">
            {l}
          </text>
        ))}
      </svg>
      <ChartLegend series={series} />
    </div>
  );
}

// ---------- Формы и навигация (antd-подобные имена пропсов, чтобы миграция на Ant Design была механической) ----------
import type { ChangeEvent as KitChangeEvent, CSSProperties as KitCSS, MouseEvent as KitMouseEvent, ReactNode as KitNode } from 'react';

export function Button({
  type = 'default', danger, size, icon, htmlType = 'button', disabled, loading, block, onClick, title, children, className, style,
}: {
  type?: 'primary' | 'default' | 'text' | 'link';
  danger?: boolean;
  size?: 'small' | 'middle' | 'large';
  icon?: IconName;
  htmlType?: 'button' | 'submit';
  disabled?: boolean;
  loading?: boolean;
  block?: boolean;
  onClick?: (e: KitMouseEvent<HTMLButtonElement>) => void;
  title?: string;
  children?: KitNode;
  className?: string;
  style?: KitCSS;
}) {
  const cls = ['btn', type === 'primary' && 'btn-primary', (type === 'text' || type === 'link') && 'btn-ghost', danger && 'btn-danger', size === 'small' && 'btn-sm', className].filter(Boolean).join(' ');
  return (
    <button type={htmlType} className={cls} disabled={disabled || loading} onClick={onClick} title={title} aria-label={children ? undefined : title} style={{ ...(block ? { width: '100%' } : {}), ...(size === 'large' ? { height: 42 } : {}), ...style }}>
      {icon && <Icon name={icon} size={size === 'small' ? 14 : 16} />}
      {children}
    </button>
  );
}

export function Input({
  value, onChange, placeholder, type = 'text', disabled, maxLength, autoFocus, inputMode, className, style, name, autoComplete, onPressEnter, ariaLabel, readOnly,
}: {
  value: string | number;
  onChange?: (e: KitChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'email' | 'search' | 'tel' | 'date' | 'number' | 'datetime-local' | 'time'; // P4-GEN: дата и время
  disabled?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  inputMode?: 'numeric' | 'text' | 'decimal';
  className?: string;
  style?: KitCSS;
  name?: string;
  autoComplete?: string;
  onPressEnter?: () => void;
  ariaLabel?: string;
  readOnly?: boolean;
}) {
  return (
    <input
      className={`input ${className ?? ''}`}
      style={style}
      type={type}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      maxLength={maxLength}
      autoFocus={autoFocus}
      inputMode={inputMode}
      autoComplete={autoComplete}
      aria-label={ariaLabel ?? placeholder}
      onKeyDown={onPressEnter ? (e) => e.key === 'Enter' && onPressEnter() : undefined}
    />
  );
}

/** Выпадающий список. options — [{ value, label }], onChange получает значение (как в antd). */
export function Select<V extends string | number = string>({
  value, onChange, options, placeholder, disabled, className, style, ariaLabel,
}: {
  value: V | '' | undefined;
  onChange: (value: V) => void;
  options: { value: V; label: string; disabled?: boolean }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: KitCSS;
  ariaLabel?: string;
}) {
  return (
    <select
      className={`select ${className ?? ''}`}
      style={style}
      value={value === undefined ? '' : String(value)}
      disabled={disabled}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        onChange((o ? o.value : (e.target.value as V)) as V);
      }}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Textarea({ value, onChange, placeholder, rows, disabled, maxLength, ariaLabel }: { value: string; onChange?: (e: KitChangeEvent<HTMLTextAreaElement>) => void; placeholder?: string; rows?: number; disabled?: boolean; maxLength?: number; ariaLabel?: string }) {
  return <textarea className="textarea" value={value} onChange={onChange} placeholder={placeholder} rows={rows} disabled={disabled} maxLength={maxLength} aria-label={ariaLabel ?? placeholder} />;
}

/** Флажок. onChange получает checked (в antd — e.target.checked). */
export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (checked: boolean) => void; children?: KitNode; disabled?: boolean }) {
  return (
    <label className="kit-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children && <span>{children}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, disabled, ariaLabel }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled} className={`kit-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

/** Постраничная навигация (как antd Pagination): current с 1. */
export function Pagination({ current, pageSize, total, onChange }: { current: number; pageSize: number; total: number; onChange: (page: number, pageSize: number) => void }) {
  const { t } = useSession();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const nums = [...new Set([1, current - 1, current, current + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <div className="kit-pager">
      <span className="muted small num">
        {from}–{to} {t('kit_of')} {total}
      </span>
      <div className="kit-pager-btns">
        <button className="btn btn-sm" disabled={current <= 1} onClick={() => onChange(current - 1, pageSize)} aria-label={t('kit_prev')}>‹</button>
        {nums.map((n, i) => (
          <span key={n} style={{ display: 'contents' }}>
            {i > 0 && n - nums[i - 1]! > 1 && <span className="muted">…</span>}
            <button className={`btn btn-sm ${n === current ? 'btn-primary' : ''}`} onClick={() => onChange(n, pageSize)}>{n}</button>
          </span>
        ))}
        <button className="btn btn-sm" disabled={current >= pages} onClick={() => onChange(current + 1, pageSize)} aria-label={t('kit_next')}>›</button>
      </div>
    </div>
  );
}

/** Боковая панель (как antd Drawer). */
export function Drawer({ open, title, onClose, children, footer, width = 520 }: { open: boolean; title: KitNode; onClose: () => void; children: KitNode; footer?: KitNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" style={{ width: `min(${width}px, 100vw)` }}>
        <div className="drawer-head">
          <div style={{ fontWeight: 650, fontSize: 16, minWidth: 0 }}>{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="×"><Icon name="x" size={16} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}

// ---------- P1-SVC: шаги, загрузка файлов, выпадающее меню (antd-подобные имена пропсов) ----------
import './services.css';

/** Шаги мастера (как antd Steps): current с 0. */
export function Steps({ current, items }: { current: number; items: { title: string }[] }) {
  return (
    <ol className="kit-steps">
      {items.map((it, i) => (
        <li key={i} className={i < current ? 'done' : i === current ? 'on' : ''} aria-current={i === current ? 'step' : undefined}>
          <span className="kit-step-num">{i < current ? <Icon name="check" size={13} /> : i + 1}</span>
          <span className="kit-step-title">{it.title}</span>
        </li>
      ))}
    </ol>
  );
}

/** Загрузка файлов (как antd Upload / Upload.Dragger): выбор через диалог и drag&drop. */
export function Upload({
  accept, multiple, disabled, dragger, onFiles, children, hint, ariaLabel,
}: {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Большая зона для перетаскивания. */
  dragger?: boolean;
  onFiles: (files: File[]) => void;
  children?: KitNode;
  hint?: KitNode;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = () => !disabled && ref.current?.click();
  const input = (
    <input
      ref={ref}
      type="file"
      hidden
      accept={accept}
      multiple={multiple}
      aria-label={ariaLabel}
      data-testid="kit-upload-input"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (files.length) onFiles(files);
      }}
    />
  );
  if (!dragger)
    return (
      <span className="kit-upload-inline" onClick={pick}>
        {input}
        {children}
      </span>
    );
  return (
    <div
      className={`kit-dragger ${over ? 'over' : ''} ${disabled ? 'disabled' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={pick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && pick()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      {input}
      <Icon name="upload" size={26} />
      <div className="kit-dragger-text">{children}</div>
      {hint && <div className="kit-dragger-hint">{hint}</div>}
    </div>
  );
}

/** Выпадающее меню (как antd Dropdown menu={{ items }}). */
export function Dropdown({ menu, children, align = 'right' }: { menu: { items: { key: string; label: string; icon?: IconName; onClick: () => void; disabled?: boolean }[] }; children: KitNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="kit-dropdown" ref={ref}>
      <span onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {children}
      </span>
      {open && (
        <div className={`kit-menu ${align}`} role="menu">
          {menu.items.map((it) => (
            <button
              key={it.key}
              role="menuitem"
              className="kit-menu-item"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.icon && <Icon name={it.icon} size={15} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Поле для JSON/кода: моноширинный шрифт, без проверки орфографии. onChange получает строку. */
export function CodeEditor({ value, onChange, ariaLabel, rows = 10, readOnly }: { value: string; onChange?: (value: string) => void; ariaLabel?: string; rows?: number; readOnly?: boolean }) {
  return <textarea className="textarea svc-json" value={value} rows={rows} readOnly={readOnly} spellCheck={false} aria-label={ariaLabel} onChange={(e) => onChange?.(e.target.value)} />;
}
