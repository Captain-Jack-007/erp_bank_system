// Браузерные помощники документных сервисов: скачивание байтов, чтение файла, распаковка deflate.
import type { InflateRaw } from '@xb/shared';

/** Скачать файл из байтов/текста через object URL. */
export function downloadBytes(filename: string, mime: string, data: Uint8Array | string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Распаковка raw deflate средствами браузера (для чтения .xlsx). */
export const inflateRaw: InflateRaw = async (data) => {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Безопасное имя файла: без запрещённых символов, с датой. */
export function safeFilename(base: string, ext: string): string {
  const clean = base.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'export';
  return `${clean} ${new Date().toISOString().slice(0, 10)}.${ext}`;
}

/** Текст из байтов (UTF-8 или CP1251 для старых CSV из Excel). */
export function decodeText(bytes: Uint8Array): string {
  const utf = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Много символов замены — вероятно, Windows-1251.
  const bad = (utf.match(/�/g) ?? []).length;
  if (bad > 3 && bad > utf.length / 200) {
    try {
      return new TextDecoder('windows-1251').decode(bytes);
    } catch {
      return utf;
    }
  }
  return utf;
}
