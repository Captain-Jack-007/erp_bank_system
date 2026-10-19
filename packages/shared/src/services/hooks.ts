// Точки расширения документных сервисов: журнал аудита и «тихие» промисы без клонирования.
// Сервисы пишут события через serviceAudit(); если подключён общий журнал аудита ядра,
// он регистрирует себя через setServiceAuditSink() (см. services/index.ts).

export interface ServiceAuditEvent {
  at: string;
  userId: string;
  /** file.upload, file.delete, sign.create, sign.verify, export.xlsx, import.commit, integration.call … */
  action: string;
  entity: string;
  entityId: string;
  details?: string;
}

type Sink = (e: ServiceAuditEvent) => void;
const sinks: Sink[] = [];
const log: ServiceAuditEvent[] = [];

export function setServiceAuditSink(fn: Sink): void {
  sinks.push(fn);
}

export function serviceAudit(e: Omit<ServiceAuditEvent, 'at'> & { at?: string }): void {
  const ev: ServiceAuditEvent = { at: e.at ?? new Date().toISOString(), ...e } as ServiceAuditEvent;
  log.push(ev);
  if (log.length > 2000) log.shift();
  for (const s of sinks) {
    try {
      s(ev);
    } catch {
      /* журнал не должен ломать операцию */
    }
  }
}

/** Локальный журнал событий сервисов (для экранов и тестов). */
export function serviceAuditLog(): ServiceAuditEvent[] {
  return log.slice();
}

/** Задержка «сети» без JSON-клонирования (для бинарных данных). */
export function later<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms));

/** Детерминированный ГПСЧ (mulberry32) — для воспроизводимых демо-данных. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
