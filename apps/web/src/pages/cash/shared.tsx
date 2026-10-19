// Общие элементы экранов модуля «Касса и инкассация».
import { useState } from 'react';
import {
  cashApi,
  cashCanEdit,
  formatMoney,
  formatNumber,
  tk,
  type CashBranch,
  type CashCurrency,
  type CashOrder,
  type CashOrderType,
  type CashPosition,
  type TKey, userMessage } from '@xb/shared';
import { Badge, Field, Modal, useToast, type Tone } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';

export const CURRENCIES: CashCurrency[] = ['UZS', 'USD', 'EUR', 'RUB'];

/** Текст ошибки API: ключ словаря модуля (cash_err_…) или исходное сообщение. */
export function errText(e: unknown, t: (k: TKey) => string): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.startsWith('cash_') ? t(m as TKey) : userMessage(m);
}

/** Сумма в валюте (formatMoney ядра не знает RUB). */
export function money(amount: number, currency: CashCurrency): string {
  return currency === 'RUB' ? `${formatNumber(amount)} RUB` : formatMoney(amount, currency);
}

export const POS_TONE: Record<CashPosition['status'], Tone> = { ok: 'ok', over: 'warn', under: 'danger' };

export function PositionBadge({ status }: { status: CashPosition['status'] }) {
  const { t } = useSession();
  return <Badge tone={POS_TONE[status]}>{t(tk('cash_pos_', status))}</Badge>;
}

/** Шкала остатка относительно коридора лимита: зелёная зона — между мин. и макс. */
export function LimitBar({ position }: { position: CashPosition }) {
  const scale = Math.max(position.limit.max * 1.25, position.balance * 1.05, 1);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const color = position.status === 'ok' ? 'var(--brand-600)' : position.status === 'over' ? 'var(--warn)' : 'var(--danger)';
  return (
    <div style={{ position: 'relative', height: 10, background: 'var(--muted-bg)', borderRadius: 5, overflow: 'hidden' }} aria-hidden>
      <div style={{ position: 'absolute', left: pct(position.limit.min), width: `calc(${pct(position.limit.max)} - ${pct(position.limit.min)})`, top: 0, bottom: 0, background: 'var(--brand-100)' }} />
      <div style={{ position: 'absolute', left: 0, width: pct(position.balance), top: 3, height: 4, borderRadius: 2, background: color }} />
    </div>
  );
}

export function nextActionKey(o: CashOrder): 'cash_action_approve' | 'cash_action_dispatch' | 'cash_action_deliver' | null {
  if (o.status === 'new') return 'cash_action_approve';
  if (o.status === 'approved') return 'cash_action_dispatch';
  if (o.status === 'in_transit') return 'cash_action_deliver';
  return null;
}

export function OrderActions({ order }: { order: CashOrder }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const key = nextActionKey(order);
  if (!key || !cashCanEdit(user)) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast(`${order.number}: ${t('cash_order_updated')}`);
    } catch (e) {
      toast(`${order.number}: ${errText(e, t)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
      {(order.status === 'new' || order.status === 'approved') && (
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => cashApi.cancelOrder(order.id, user))}>
          {t('cash_action_cancel')}
        </button>
      )}
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => cashApi.advanceOrder(order.id, user))}>
        {t(key)}
      </button>
    </div>
  );
}

export function NewOrderModal({ branches, initialBranchId, onClose }: { branches: CashBranch[]; initialBranchId?: string; onClose: () => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const positions = useApi(() => cashApi.positions());
  const [branchId, setBranchId] = useState(initialBranchId ?? branches.find((b) => b.kind === 'branch')?.id ?? '');
  const [currency, setCurrency] = useState<CashCurrency>('UZS');
  const [type, setType] = useState<CashOrderType>('reinforcement');
  const [amount, setAmount] = useState('');
  const minDate = new Date().toISOString().slice(0, 10);
  const [plannedDate, setPlannedDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pos = positions.data?.find((p) => p.branchId === branchId && p.currency === currency);

  async function save() {
    if (!(Number(amount) > 0) || !branchId || !plannedDate) {
      setError(t('formRequired'));
      return;
    }
    setBusy(true);
    try {
      const o = await cashApi.createOrder({ type, branchId, currency, amount: Number(amount), plannedDate, ...(comment.trim() ? { comment: comment.trim() } : {}) }, user);
      toast(`${o.number}: ${t('cash_order_created')}`);
      onClose();
    } catch (e) {
      setError(errText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('cash_new_order')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {t('create')}
          </button>
        </>
      }
    >
      <Field label={t('cash_branch')} required>
        <select className="select" value={branchId} onChange={(e) => { setBranchId(e.target.value); setError(''); }}>
          {branches
            .filter((b) => b.kind === 'branch')
            .map((b) => (
              <option key={b.id} value={b.id}>
                {loc(b.name)}
              </option>
            ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label={t('cash_order_type')} required>
          <select className="select" value={type} onChange={(e) => { setType(e.target.value as CashOrderType); setError(''); }}>
            <option value="reinforcement">{t('cash_type_reinforcement')}</option>
            <option value="surrender">{t('cash_type_surrender')}</option>
          </select>
        </Field>
        <Field label={t('cash_currency')} required>
          <select className="select" value={currency} onChange={(e) => { setCurrency(e.target.value as CashCurrency); setError(''); }}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      {pos && (
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }} className="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>
              {t('cash_balance')}: <b className="num">{money(pos.balance, currency)}</b>
            </span>
            <PositionBadge status={pos.status} />
          </div>
          <LimitBar position={pos} />
          <span className="muted">
            {t('cash_limit')}: {money(pos.limit.min, currency)} – {money(pos.limit.max, currency)}
          </span>
          {pos.recommendedType && (
            <button
              className="btn btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                setType(pos.recommendedType!);
                setAmount(String(pos.recommended));
                setError('');
              }}
            >
              {t('cash_use_recommendation')}: {t(tk('cash_type_', pos.recommendedType))} {money(pos.recommended, currency)}
            </button>
          )}
        </div>
      )}
      <div className="form-grid">
        <Field label={`${t('cash_amount')}, ${currency}`} required error={error}>
          <input className="input" type="number" min={0} value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} />
        </Field>
        <Field label={t('cash_planned_date')} required>
          <input className="input" type="date" min={minDate} value={plannedDate} onChange={(e) => { setPlannedDate(e.target.value); setError(''); }} />
        </Field>
      </div>
      <Field label={t('cash_comment')}>
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  );
}
