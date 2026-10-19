// P2-FINPLAN: регистрация операций обмена финансовых модулей (бюджет, аллокация, FTP, анализ операций)
// в справочнике интеграционной шины. Справочник систем ядра (services/integrations.ts) — общий массив;
// модуль только добавляет свои операции/системы при загрузке, не меняя существующие.
import type { Localized } from '../../types';
import { INTEGRATION_SYSTEMS, integrationHub, type ExchangeRecord, type IntegrationOperation, type IntegrationSystem } from '../../services/integrations';

export function finplanEnsureSystem(system: IntegrationSystem): void {
  if (!INTEGRATION_SYSTEMS.some((s) => s.id === system.id)) INTEGRATION_SYSTEMS.push(system);
}

export function finplanEnsureOp(systemId: string, op: IntegrationOperation, module?: string): void {
  const s = INTEGRATION_SYSTEMS.find((x) => x.id === systemId);
  if (!s) return;
  if (!s.operations.some((o) => o.id === op.id)) s.operations.push(op);
  if (module && !s.modules.includes(module)) s.modules.push(module);
}

export const FL = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });

/** Результат обмена: success — данные получены, queued — система недоступна (запрос в очереди), иначе ошибка. */
export function finplanExchangeOk(rec: ExchangeRecord): boolean {
  return rec.status === 'success';
}

export { integrationHub };
