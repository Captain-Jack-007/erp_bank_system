// P3-GEN (ТЗ PR-SEC-040): отдельные сервисные учётные записи для каждой интеграции — интерактивный вход запрещён
// (см. securityApi.authenticate), полномочия ограничены операциями своей системы, секреты — только ссылкой на
// централизованное хранилище (vault/KMS банка), периодическая ротация с записью в журнал аудита.
import { audit } from './audit';
import { clone, delay, emit } from './bus';
import { INTEGRATION_SYSTEMS } from './services/integrations';
import type { ID } from './types';
import { apiError } from './errors';

export interface ServiceAccount {
  id: string;
  login: string;
  systemId: string;
  /** Разрешённые операции (минимальные полномочия). */
  scopes: string[];
  /** Ссылка на секрет в хранилище; сам секрет приложению не показывается. */
  secretRef: string;
  auth: string;
  rotatedAt: string;
  rotationDays: number;
  interactive: false;
}

export const SECRET_ROTATION_DAYS = 90;
let accounts: ServiceAccount[] | null = null;

function init(): ServiceAccount[] {
  if (accounts) return accounts;
  // slug — идентификатор системы в техническом виде (дефисы), для логинов, областей и ссылок на секреты
  const slug = (id: string) => id.replace(/_/g, '-');
  accounts = INTEGRATION_SYSTEMS.map((s, i) => ({
    id: `sa-${s.id}`,
    login: `svc-${slug(s.id)}`,
    systemId: s.id,
    scopes: s.operations.map((o) => `${slug(s.id)}:${o.id}`),
    secretRef: `vault://xb-erp/integrations/${slug(s.id)}`,
    auth: s.passport.auth,
    // демо: у двух учётных записей ротация просрочена
    rotatedAt: new Date(Date.now() - (i === 3 || i === 9 ? 120 : 10 + i * 4) * 86_400_000).toISOString(),
    rotationDays: SECRET_ROTATION_DAYS,
    interactive: false,
  }));
  return accounts;
}

export function secretOverdue(a: ServiceAccount): boolean {
  return Date.now() - new Date(a.rotatedAt).getTime() > a.rotationDays * 86_400_000;
}

export const serviceAccountsApi = {
  list: (): Promise<ServiceAccount[]> => delay(init()),
  /** Ротация секрета (новый секрет создаётся в хранилище; приложение получает только новую версию ссылки). */
  async rotate(id: ID): Promise<ServiceAccount> {
    const a = init().find((x) => x.id === id);
    if (!a) throw apiError('SERVICE_ACCOUNT_NOT_FOUND');
    const before = a.rotatedAt;
    a.rotatedAt = new Date().toISOString();
    const v = (Number(/#v(\d+)$/.exec(a.secretRef)?.[1] ?? '1') || 1) + 1;
    a.secretRef = `${a.secretRef.replace(/#v\d+$/, '')}#v${v}`;
    audit.log({ action: 'update', entity: 'service_account', entityId: a.login, entityLabel: a.login, changes: [{ field: 'secretRotatedAt', from: before.slice(0, 10), to: a.rotatedAt.slice(0, 10) }, { field: 'secretRef', from: `v${v - 1}`, to: `v${v}` }], details: 'secret rotated (vault)' });
    emit();
    return delay(clone(a));
  },
};
