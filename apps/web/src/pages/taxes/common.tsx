// Общие помощники экранов модуля «Налоги»: перевод строк, названия филиалов, ошибки API, вкладка из URL.
import { useEffect, useState } from 'react';
import { formatMoney, formatNumber, localize, orgApi, pick, TAX_BRANCHES, TAX_ERRORS, type OrgUnit, userMessage } from '@xb/shared';
import { Select } from '../../components/ui';
import { useLocation } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';

/** Встроенный перевод: p('рус', 'o‘zb', 'eng'). */
export function useP() {
  const { lang } = useSession();
  return (ru: string, uz: string, en: string) => pick(lang, ru, uz, en);
}

/** Названия филиалов из оргструктуры (HO — головной офис, R01…R14 — региональные филиалы). */
export function useBranches() {
  const { lang } = useSession();
  const units = useApi(() => orgApi.listOrgUnits(), []);
  const byKey = new Map<string, OrgUnit>((units.data ?? []).map((u) => [u.key, u]));
  const name = (key: string | undefined) => {
    if (!key) return '—';
    const u = byKey.get(key);
    return u ? localize(u.name, lang) : key;
  };
  const options = TAX_BRANCHES.map((k) => ({ value: k as string, label: `${k} · ${name(k)}` }));
  return { name, options };
}

/** Текст ошибки API: известный код → перевод, иначе исходное сообщение. */
export function useErrText() {
  const { lang } = useSession();
  return (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    const x = TAX_ERRORS[m];
    return x ? localize(x, lang) : userMessage(m);
  };
}

/** Вкладка из ?tab= (с переходом из уведомлений/поиска на уже открытом экране). */
export function useUrlTab<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const path = useLocation();
  const fromUrl = () => {
    const v = new URLSearchParams(path.split('?')[1] ?? '').get('tab');
    return tabs.includes(v as T) ? (v as T) : null;
  };
  const [tab, setTab] = useState<T>(() => fromUrl() ?? fallback);
  useEffect(() => {
    const v = fromUrl();
    if (v) setTab(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return [tab, setTab];
}

export const money = (v: number) => formatMoney(v);
export const qty = (v: number, unit?: 'uzs' | 'm2' | 'm3') => (unit === 'm2' ? `${formatNumber(v)} м²` : unit === 'm3' ? `${formatNumber(v)} м³` : formatMoney(v));

export function BranchSelect({ value, onChange, allLabel }: { value: string; onChange: (v: string) => void; allLabel?: string }) {
  const p = useP();
  const b = useBranches();
  return <Select<string> value={value} onChange={onChange} options={b.options} placeholder={allLabel ?? `${p('Филиал', 'Filial', 'Branch')}: ${p('все', 'barchasi', 'all')}`} ariaLabel={p('Филиал', 'Filial', 'Branch')} />;
}

export const MONTHS_2026 = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];

import { importRegistry } from '@xb/shared';
import { Drawer } from '../../components/ui';
import { ImportWizard } from '../../components/Import';

/** Боковая панель с мастером импорта Excel/CSV для зарегистрированной цели импорта. */
export function ImportDrawer({ targetId, open, onClose }: { targetId: string; open: boolean; onClose: () => void }) {
  const { loc } = useSession();
  const target = importRegistry.get(targetId);
  if (!open || !target) return null;
  return (
    <Drawer open title={loc(target.name)} onClose={onClose} width={860}>
      <ImportWizard target={target} />
    </Drawer>
  );
}
