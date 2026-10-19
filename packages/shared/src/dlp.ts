// P3-GEN (ТЗ PR-SEC-072, PR-SEC-046): прикладной контроль экспорта и печати по категории данных и роли.
// Каждый раздел отнесён к категории данных; для категории задаются минимальный уровень доступа для экспорта и
// печати и необходимость подтверждения одноразовым кодом. Все попытки (в т.ч. запрещённые) пишутся в аудит.
// Буфер обмена, внешние носители и почта контролируются DLP-агентом банка на рабочих местах (вне веб-приложения).
import { audit } from './audit';
import { clone, delay, emit } from './bus';
import { accessLevel, levelRank, type AccessLevel } from './security';
import type { User } from './types';

export type DataCategory = 'public' | 'internal' | 'confidential' | 'personal' | 'payment' | 'bank_secret';
export const DATA_CATEGORIES: DataCategory[] = ['public', 'internal', 'confidential', 'personal', 'payment', 'bank_secret'];

export interface DlpRule {
  /** Минимальный уровень доступа к разделу для выгрузки (Excel/CSV). */
  exportLevel: AccessLevel;
  /** Минимальный уровень для печати / PDF. */
  printLevel: AccessLevel;
  /** Требовать подтверждение одноразовым кодом перед выгрузкой. */
  stepUp: boolean;
}

/** Категории разделов (реестр активов данных, PR-SEC-046). */
const MODULE_CATEGORY: Record<string, DataCategory> = {
  dashboard: 'internal', approvals: 'internal', notifications: 'internal', ai: 'internal', 'master-data': 'internal',
  procurement: 'internal', contracts: 'payment', einvoices: 'payment', warehouse: 'internal', assets: 'internal', fleet: 'internal',
  terminals: 'internal', cash: 'bank_secret', documents: 'confidential', archive: 'confidential', requests: 'personal', trips: 'personal',
  budgeting: 'confidential', allocation: 'confidential', ftp: 'confidential', taxes: 'confidential', ifrs: 'confidential',
  reporting: 'confidential', operations: 'confidential', users: 'personal', roles: 'internal', security: 'internal', audit: 'confidential',
  integrations: 'internal', import: 'internal', 'print-forms': 'internal', monitoring: 'internal',
};

// По умолчанию выгрузка разрешена всем, у кого есть просмотр (как было до введения DLP); ужесточение — администратором.
const DEFAULT_RULES: Record<DataCategory, DlpRule> = {
  public: { exportLevel: 'view', printLevel: 'view', stepUp: false },
  internal: { exportLevel: 'view', printLevel: 'view', stepUp: false },
  confidential: { exportLevel: 'view', printLevel: 'view', stepUp: false },
  personal: { exportLevel: 'view', printLevel: 'view', stepUp: false },
  payment: { exportLevel: 'view', printLevel: 'view', stepUp: false },
  bank_secret: { exportLevel: 'view', printLevel: 'view', stepUp: false },
};
let rules: Record<DataCategory, DlpRule> = clone(DEFAULT_RULES);

export function moduleCategory(moduleId: string | undefined): DataCategory {
  return (moduleId && MODULE_CATEGORY[moduleId]) || 'internal';
}

export interface DlpDecision {
  allowed: boolean;
  stepUp: boolean;
  category: DataCategory;
  required: AccessLevel;
}

/** Решение DLP для пользователя: можно ли выгрузить / напечатать данные раздела. */
export function dlpCheck(user: User | null | undefined, moduleId: string | undefined, action: 'export' | 'print'): DlpDecision {
  const category = moduleCategory(moduleId);
  const rule = rules[category];
  const required = action === 'export' ? rule.exportLevel : rule.printLevel;
  const level = moduleId ? accessLevel(user, moduleId) : 'view';
  return { allowed: levelRank(level) >= levelRank(required), stepUp: action === 'export' && rule.stepUp, category, required };
}

/** Запись попытки выгрузки/печати, отклонённой DLP. */
export function dlpDenied(moduleId: string | undefined, action: 'export' | 'print', what: string): void {
  audit.log({ action: action === 'export' ? 'export' : 'print', entity: 'dlp', entityId: moduleId ?? '—', entityLabel: what, details: `denied · ${moduleCategory(moduleId)}`, result: 'failure' });
  emit();
}

export const dlpApi = {
  getRules: (): Promise<Record<DataCategory, DlpRule>> => delay(rules),
  categories: (): Record<string, DataCategory> => ({ ...MODULE_CATEGORY }),
  async setRule(category: DataCategory, rule: DlpRule): Promise<void> {
    const before = rules[category];
    rules = { ...rules, [category]: { ...rule } };
    const changes = (Object.keys(rule) as (keyof DlpRule)[]).filter((k) => before[k] !== rule[k]).map((k) => ({ field: `${category}.${k}`, from: String(before[k]), to: String(rule[k]) }));
    if (changes.length) audit.log({ action: 'settings', entity: 'dlp', entityLabel: category, changes });
    emit();
    await delay(null);
  },
  async reset(): Promise<void> {
    rules = clone(DEFAULT_RULES);
    audit.log({ action: 'settings', entity: 'dlp', details: 'reset to defaults' });
    emit();
    await delay(null);
  },
};
