// P2-DOCS: общие элементы экранов ЭСФ, СЭД, архива и командировок (светофор сроков, выбор оргединицы,
// модалка причины, список проверок, обёртка действий с тостом).
import { useState, type ReactNode } from 'react';
import { orgApi, pick, tk, type Lang, type OrgUnit, userMessage } from '@xb/shared';
import { Button, Field, Modal, Select, Textarea, useToast } from '../../components/ui';
import { Icon, type IconName } from '../../components/icons';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import './p2docs.css';

/** Светофор срока: класс green/yellow/red/black/done/closed + подпись из словаря `${prefix}${light}`. */
export function LightBadge({ light, prefix, day }: { light: string; prefix: string; day?: number }) {
  const { t, lang } = useSession();
  return (
    <span className={`p2-light ${light}`} data-light={light} title={day ? pick(lang, `День ${day}`, `${day}-kun`, `Day ${day}`) : undefined}>
      {t(tk(prefix, light))}
      {day !== undefined && light !== 'done' && light !== 'closed' ? ` · ${pick(lang, 'д.', 'k.', 'd')} ${day}` : ''}
    </span>
  );
}

/** Выполнить действие API: тост об успехе или понятная ошибка; busy — для блокировки кнопок. */
export function useAction(): { busy: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean> } {
  const { t } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: async (fn, ok) => {
      setBusy(true);
      try {
        await fn();
        if (ok) toast(ok);
        return true;
      } catch (e) {
        const raw = e instanceof Error && e.message ? e.message : '';
        const msg = /^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(raw) ? t(raw as Parameters<typeof t>[0]) : raw && userMessage(raw); // P3: коды ошибок словаря
        toast(`${t('actionFailed')}${msg ? `: ${msg}` : ''}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}

export function ReasonModal({ title, label, button, danger = true, onClose, onSubmit }: { title: string; label: string; button?: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<unknown> }) {
  const { t } = useSession();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type={danger ? 'default' : 'primary'}
            danger={danger}
            loading={busy}
            onClick={async () => {
              if (!reason.trim()) return setError(t('formRequired'));
              setBusy(true);
              try {
                await onSubmit(reason.trim());
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {button ?? t('reject')}
          </Button>
        </>
      }
    >
      <Field label={label} required error={error}>
        <Textarea value={reason} ariaLabel={label} onChange={(e) => { setReason(e.target.value); setError(''); }} rows={4} />
      </Field>
    </Modal>
  );
}

/** Подпись оргединицы: «Департамент…», «Регион · ЦБУ «…»». */
export function orgUnitLabel(u: OrgUnit, all: OrgUnit[], lang: Lang, loc: (v: OrgUnit['name']) => string): string {
  if (u.type === 'branch_office') {
    const parent = all.find((x) => x.key === u.parentKey);
    return `${parent ? `${loc(parent.name)} · ` : ''}${loc(u.name)}`;
  }
  if (u.type === 'region') return `${loc(u.name)} (${pick(lang, 'региональный центр', 'hududiy markaz', 'regional centre')})`;
  return loc(u.name);
}

/** Выбор подразделения ЦА / регионального центра / ЦБУ (оргструктура orgApi). */
export function OrgUnitSelect({ value, onChange, placeholder, includeBranchOffices = true, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder?: string; includeBranchOffices?: boolean; ariaLabel?: string }) {
  const { lang, loc } = useSession();
  const units = useApi(() => orgApi.listOrgUnits(), []);
  const all = units.data ?? [];
  const list = all
    .filter((u) => (u.type === 'department' && u.parentKey === 'HO') || u.type === 'region' || (includeBranchOffices && u.type === 'branch_office'))
    .sort((a, b) => (a.type === 'department' ? 0 : 1) - (b.type === 'department' ? 0 : 1) || a.key.localeCompare(b.key));
  return (
    <Select
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel ?? placeholder}
      {...(placeholder !== undefined ? { placeholder } : {})}
      options={list.map((u) => ({ value: u.key, label: orgUnitLabel(u, all, lang, loc) }))}
    />
  );
}

/** Название оргединицы по ключу (асинхронно из orgApi). */
export function useOrgUnitName(): (key: string | undefined) => string {
  const { lang, loc } = useSession();
  const units = useApi(() => orgApi.listOrgUnits(), []);
  return (key) => {
    if (!key) return '—';
    const all = units.data ?? [];
    const u = all.find((x) => x.key === key);
    return u ? orgUnitLabel(u, all, lang, loc) : key;
  };
}

/** Список проверок: зелёная галочка / предупреждение / ошибка. */
export function ChecksList({ items }: { items: { label: string; ok: boolean; warn?: boolean; details?: string }[] }) {
  return (
    <ul className="p2-checks">
      {items.map((c, i) => (
        <li key={i} data-ok={c.ok ? '1' : '0'}>
          <span className={`ic ${c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}`}>{c.ok ? '✓' : c.warn ? '!' : '×'}</span>
          <span>
            {c.label}
            {c.details ? <span className="muted small"> · {c.details}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Note({ tone = 'info', icon = 'alert', children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`p2-note ${tone === 'info' ? '' : tone}`} role="note">
      <Icon name={icon} size={16} />
      <div>{children}</div>
    </div>
  );
}

/** Ключ YYYY-MM-DD → дата для полей периода по умолчанию. */
export const monthStart = (): string => `${new Date().toISOString().slice(0, 7)}-01`;
export const yearStart = (): string => `${new Date().toISOString().slice(0, 4)}-01-01`;
