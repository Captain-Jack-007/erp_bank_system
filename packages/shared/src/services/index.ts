// Документные сервисы платформы (P1-SVC): XLSX/CSV, импорт, QR, печатные формы, файлы, E-IMZO, интеграции.
import { audit, type AuditAction } from '../audit';
import { directory } from '../directory';
import { setServiceAuditSink } from './hooks';

export * from './bytes';
export * from './zip';
export * from './xlsx';
export * from './csv';
export * from './qr';
export * from './files';
export * from './signature';
export * from './print';
export * from './integrations';
export * from './importer';
export { serviceAudit, serviceAuditLog, setServiceAuditSink, type ServiceAuditEvent } from './hooks';
export { servicesI18n } from './i18n';

// События сервисов → общий журнал аудита ядра (PR-GEN-040, PR-SEC-026).
const ACTIONS: Record<string, { action: AuditAction; entity?: string }> = {
  'file.upload': { action: 'create', entity: 'file' },
  'file.version': { action: 'update', entity: 'file' },
  'file.delete': { action: 'delete', entity: 'file' },
  'sign.create': { action: 'create', entity: 'signature' },
  'sign.revoke': { action: 'block', entity: 'certificate' },
  'import.commit': { action: 'create', entity: 'import' },
  'export.file': { action: 'export' },
  'print.document': { action: 'print' },
  'integration.quarantine': { action: 'create', entity: 'integration' },
  'integration.retry': { action: 'update', entity: 'integration' },
  'integration.discard': { action: 'reject', entity: 'integration' },
  'integration.down': { action: 'settings', entity: 'integration' },
  'integration.up': { action: 'settings', entity: 'integration' },
};

setServiceAuditSink((e) => {
  const m = ACTIONS[e.action];
  if (!m) return; // успешные вызовы интеграций — в журнале обмена, не в аудите
  const u = directory.user(e.userId);
  audit.log({
    action: m.action,
    entity: m.entity ?? e.entity,
    entityId: m.entity ? `${e.entity}:${e.entityId}` : e.entityId,
    details: e.details ? `${e.action} · ${e.details}` : e.action,
    ...(u ? { user: { id: u.id, fullName: u.fullName, role: u.role } } : {}),
  });
});
