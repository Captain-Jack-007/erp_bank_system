// Общая шина mock-слоя: задержка «сети», уведомления об изменениях, генерация номеров.
// Используется ядром (api/mock.ts) и всеми модулями (modules/*/api.ts).
import type { HistoryEvent, ID } from './types';

const listeners = new Set<() => void>();
let latency = 250;
let seq = 300;

export function setLatency(ms: number): void {
  latency = ms;
}

export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Возвращает копию значения с задержкой — имитация HTTP-запроса. */
export function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(clone(value)), latency));
}

/** Сообщить экранам, что данные изменились (они перезагрузятся). */
export function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const now = (): string => new Date().toISOString();
export const today = (): string => now().slice(0, 10);
export const addDays = (days: number, from: Date = new Date()): string => new Date(from.getTime() + days * 86_400_000).toISOString();

export function nextId(prefix: string): ID {
  return `${prefix}${++seq}`;
}

/** Номер документа: nextNumber('ZK') → ZK-2026-0301 */
export function nextNumber(prefix: string): string {
  return `${prefix}-2026-${String(++seq).padStart(4, '0')}`;
}

export function historyEvent(userId: ID, action: HistoryEvent['action'], comment?: string): HistoryEvent {
  return { at: now(), userId, action, ...(comment ? { comment } : {}) };
}
