// Типы модуля ИИ-ассистента (ТЗ 5.3). В демо ответы строятся правилами по данным ERP;
// в продуктиве — локальная LLM внутри периметра банка с тем же контрактом.
import type { ID, ISODate } from '../../types';

export interface AiLink {
  label: string;
  to: string; // маршрут web-приложения, например /procurement/pr1
}

export interface AiAnswer {
  text: string;
  links: AiLink[];
  /** Необязательная таблица с результатом (заголовки + строки). */
  table?: { headers: string[]; rows: string[][] };
  intent: string;
}

export interface AiChatMessage {
  id: ID;
  role: 'user' | 'assistant';
  text: string;
  at: ISODate;
  answer?: AiAnswer;
}

export type AiDocKind = 'invoice' | 'act' | 'contract' | 'letter' | 'unknown';

export interface AiDocSample {
  id: ID;
  fileName: string;
  text: string; // текст после OCR (демо)
}

export interface AiExtractedField {
  key: 'number' | 'date' | 'tin' | 'counterparty' | 'amount' | 'vat' | 'contractRef';
  value: string;
  confidence: number; // 0..1
}

export interface AiRecognition {
  kind: AiDocKind;
  kindConfidence: number;
  fields: AiExtractedField[];
  suggestion: { kind: 'einvoice' | 'document' | 'contract' | 'none'; to: string };
}

export type AiRiskLevel = 'high' | 'medium' | 'low';

export interface AiContractFinding {
  code: string;
  level: AiRiskLevel;
  /** Цитата из текста, к которой относится замечание (если есть). */
  quote?: string;
}

export interface AiContractCheck {
  contractId?: ID;
  score: number; // 0..100, чем выше — тем меньше риск
  findings: AiContractFinding[];
}

export interface AiAuditEntry {
  id: ID;
  at: ISODate;
  userId: ID;
  action: 'ask' | 'recognize' | 'check_contract';
  summary: string;
  durationMs: number;
}
