// Подписи согласующих и шагов маршрута (без зависимостей от UI-кита — используется и в ui.tsx).
import { localize, tk, type Lang, type Localized, type ResolvedApprover, type RoutePreviewStep, type TKey } from '@xb/shared';

type T = (key: TKey) => string;

/** «за {name}», «Шаг {n}» и т. п.: подстановка параметров в строку словаря. */
export function fmt(text: string, params: Record<string, string | number>): string {
  let s = text;
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Кто согласует: заголовок (роль / вид согласующего) и имена. */
export function approverTitle(a: Pick<ResolvedApprover, 'spec' | 'names'>, t: T, lang: Lang, stepName?: Localized): string {
  const s = a.spec;
  switch (s.kind) {
    case 'role':
      return t(tk('role_', s.role));
    case 'branchRole':
      return `${t(tk('role_', s.role))} · ${t('flow_kind_branchRole')}`;
    case 'user':
      return a.names[0] ?? t('flow_kind_user');
    case 'initiatorHead':
      return t('flow_kind_initiatorHead');
    case 'departmentHead':
      return t('flow_kind_departmentHead');
    case 'committee':
      return stepName ? localize(stepName, lang) : t('flow_kind_committee');
  }
}

/** Подпись шага: явное название или согласующие через «+». */
export function stepTitle(s: Pick<RoutePreviewStep, 'name' | 'approvers'>, t: T, lang: Lang): string {
  if (s.name) return localize(s.name, lang);
  return s.approvers.map((a) => approverTitle(a, t, lang)).join(' + ');
}

/** Имена согласующих шага (кроме ролей, где имена вторичны — тоже показываем, коротко). */
export function stepNames(s: Pick<RoutePreviewStep, 'approvers'>): string {
  const names = [...new Set(s.approvers.flatMap((a) => a.names))];
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
}
