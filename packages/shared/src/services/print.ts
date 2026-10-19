// Модель печатных форм: данные, которые модуль передаёт в шаблоны PrintView (web/components/PrintView).
// Шаблоны: карточка документа, акт, реестр (таблица). QR ведёт на страницу проверки документа.
import type { ID } from '../types';

export interface PrintField {
  label: string;
  value: string;
}

export interface PrintTableColumn {
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export interface PrintTable {
  columns: PrintTableColumn[];
  rows: string[][];
  /** Строка итогов (по колонкам; пустые — ''). */
  totals?: string[];
}

export interface PrintSigner {
  /** Роль в документе: «Исполнитель», «Заказчик», «Согласовал»… */
  role: string;
  name: string;
  position?: string;
  /** ID записи подписи E-IMZO (signatureService) — тогда печатается штамп ЭЦП. */
  signatureId?: ID;
}

export interface PrintDocument {
  entity: string;
  entityId: ID;
  title: string;
  number?: string;
  date?: string; // YYYY-MM-DD
  /** Подзаголовок/место составления: «г. Ташкент». */
  place?: string;
  fields?: PrintField[];
  /** Произвольный текст (абзацы). */
  paragraphs?: string[];
  table?: PrintTable;
  signers?: PrintSigner[];
  /** Альбомная ориентация (для широких реестров). */
  landscape?: boolean;
}

/** Путь страницы проверки документа (для QR): /verify/<entity>/<id>. */
export function verifyPath(entity: string, entityId: ID): string {
  return `/verify/${encodeURIComponent(entity)}/${encodeURIComponent(entityId)}`;
}
