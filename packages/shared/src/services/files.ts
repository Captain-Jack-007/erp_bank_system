// Файловый сервис (вложения к любой карточке): загрузка с проверкой типа/размера, версии,
// кто/когда, контрольная сумма SHA-256, мягкое удаление. Хранилище — в памяти (до бэкенда/S3).
import type { ID, User } from '../types';
import { emit, nextId, now } from '../bus';
import { sha256Hex } from './bytes';
import { later, serviceAudit } from './hooks';
import { apiError } from '../errors';

export interface FileVersion {
  version: number;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  uploadedBy: ID;
  uploadedAt: string;
  comment?: string;
}

export interface StoredFile {
  id: ID;
  entity: string;
  entityId: ID;
  /** Имя последней версии. */
  name: string;
  mime: string;
  size: number;
  category?: string;
  versions: FileVersion[];
  createdBy: ID;
  createdAt: string;
  deletedAt?: string;
  deletedBy?: ID;
}

export interface FilePolicy {
  maxSize: number;
  /** Разрешённые расширения (в нижнем регистре, без точки). */
  extensions: string[];
}

export const DEFAULT_FILE_POLICY: FilePolicy = {
  maxSize: 10 * 1024 * 1024,
  extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'odt', 'ods', 'txt', 'xml', 'json', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'zip', 'p7s', 'sig'],
};

/** Запрещённые всегда — исполняемые файлы и скрипты (OWASP: безопасная загрузка файлов). */
const BLOCKED = ['exe', 'bat', 'cmd', 'com', 'msi', 'js', 'vbs', 'ps1', 'sh', 'jar', 'scr', 'dll', 'html', 'htm', 'svg'];

export type FileErrorCode = 'too_large' | 'bad_type' | 'empty' | 'blocked' | 'bad_name';

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Проверка файла до загрузки. null — можно загружать. */
export function validateFile(name: string, size: number, policy: FilePolicy = DEFAULT_FILE_POLICY): FileErrorCode | null {
  const ext = fileExtension(name);
  if (!name.trim() || /[\\/:*?"<>|]/.test(name.replace(/^.*[\\/]/, ''))) return 'bad_name';
  if (BLOCKED.includes(ext)) return 'blocked';
  if (!policy.extensions.includes(ext)) return 'bad_type';
  if (size <= 0) return 'empty';
  if (size > policy.maxSize) return 'too_large';
  return null;
}

/** Можно ли показать предпросмотр в браузере. */
export function previewKind(mime: string, name: string): 'image' | 'pdf' | 'text' | null {
  const ext = fileExtension(name);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('text/') || ['txt', 'csv', 'json', 'xml'].includes(ext)) return 'text';
  return null;
}

const files: StoredFile[] = [];
const contents = new Map<string, Uint8Array>();
const key = (id: ID, v: number) => `${id}#${v}`;

export class FileValidationError extends Error {
  constructor(public code: FileErrorCode) {
    super(`File rejected: ${code}`);
  }
}

export interface UploadInput {
  entity: string;
  entityId: ID;
  name: string;
  mime: string;
  data: Uint8Array;
  category?: string;
  comment?: string;
}

export const filesApi = {
  list(entity: string, entityId: ID, opts: { includeDeleted?: boolean } = {}): Promise<StoredFile[]> {
    const list = files.filter((f) => f.entity === entity && f.entityId === entityId && (opts.includeDeleted || !f.deletedAt));
    return later(JSON.parse(JSON.stringify(list)) as StoredFile[]);
  },

  count(entity: string, entityId: ID): number {
    return files.filter((f) => f.entity === entity && f.entityId === entityId && !f.deletedAt).length;
  },

  /** Загрузить новый файл или новую версию существующего (replaceId). */
  async upload(input: UploadInput, user: User, opts: { replaceId?: ID; policy?: FilePolicy } = {}): Promise<StoredFile> {
    const err = validateFile(input.name, input.data.length, opts.policy);
    if (err) throw new FileValidationError(err);
    const v: Omit<FileVersion, 'version'> = {
      name: input.name,
      mime: input.mime || 'application/octet-stream',
      size: input.data.length,
      sha256: sha256Hex(input.data),
      uploadedBy: user.id,
      uploadedAt: now(),
      ...(input.comment ? { comment: input.comment } : {}),
    };
    let f = opts.replaceId ? files.find((x) => x.id === opts.replaceId && !x.deletedAt) : undefined;
    if (opts.replaceId && !f) throw apiError('FILE_NOT_FOUND');
    if (f) {
      const version = f.versions.length + 1;
      f.versions.push({ ...v, version });
      Object.assign(f, { name: v.name, mime: v.mime, size: v.size });
      contents.set(key(f.id, version), input.data.slice());
    } else {
      f = {
        id: nextId('f'),
        entity: input.entity,
        entityId: input.entityId,
        name: v.name,
        mime: v.mime,
        size: v.size,
        ...(input.category ? { category: input.category } : {}),
        versions: [{ ...v, version: 1 }],
        createdBy: user.id,
        createdAt: v.uploadedAt,
      };
      files.push(f);
      contents.set(key(f.id, 1), input.data.slice());
    }
    serviceAudit({ userId: user.id, action: opts.replaceId ? 'file.version' : 'file.upload', entity: input.entity, entityId: input.entityId, details: `${v.name} (${v.size} B, sha256 ${v.sha256.slice(0, 12)}…)` });
    emit();
    return later(JSON.parse(JSON.stringify(f)) as StoredFile);
  },

  /** Содержимое версии (по умолчанию — последней). */
  async content(id: ID, version?: number): Promise<{ name: string; mime: string; data: Uint8Array }> {
    const f = files.find((x) => x.id === id);
    if (!f) throw apiError('FILE_NOT_FOUND');
    const v = f.versions.find((x) => x.version === (version ?? f.versions.length)) ?? f.versions[f.versions.length - 1]!;
    const data = contents.get(key(id, v.version));
    if (!data) throw apiError('FILE_CONTENT_NOT_FOUND');
    return later({ name: v.name, mime: v.mime, data }, 40);
  },

  /** Мягкое удаление: файл скрыт, но версии сохраняются для аудита. */
  async remove(id: ID, user: User): Promise<void> {
    const f = files.find((x) => x.id === id);
    if (!f || f.deletedAt) throw apiError('FILE_NOT_FOUND');
    f.deletedAt = now();
    f.deletedBy = user.id;
    serviceAudit({ userId: user.id, action: 'file.delete', entity: f.entity, entityId: f.entityId, details: f.name });
    emit();
    await later(null);
  },
};
