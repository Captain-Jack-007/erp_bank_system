// ZIP без зависимостей: запись (метод store, CRC32) и чтение (store + deflate через внешний inflateRaw).
// Для чтения в браузере inflateRaw = DecompressionStream('deflate-raw'), в Node — zlib.inflateRawSync.
import { concatBytes, crc32, utf8Decode, utf8Encode } from './bytes';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array>;

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/** DOS-время для заголовков ZIP. */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Собрать ZIP-архив (без сжатия). Имена в UTF-8 (флаг 0x0800). */
export function writeZip(entries: ZipEntry[], when: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(when);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = utf8Encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const header = Uint8Array.from([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0),
    ]);
    locals.push(header, name, e.data);
    centrals.push(
      Uint8Array.from([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
        ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]),
      name,
    );
    offset += header.length + name.length + size;
  }
  const central = concatBytes(centrals);
  const end = Uint8Array.from([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(offset), ...u16(0),
  ]);
  return concatBytes([...locals, central, end]);
}

/** Прочитать ZIP: имя файла → содержимое. Поддерживаются методы 0 (store) и 8 (deflate). */
export async function readZip(data: Uint8Array, inflateRaw: InflateRaw): Promise<Map<string, Uint8Array>> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Ищем запись End Of Central Directory с конца файла.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP: end of central directory not found');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP: bad central directory');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = utf8Decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = data.subarray(start, start + compSize);
    if (name.endsWith('/')) continue;
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new Error(`ZIP: unsupported compression method ${method}`);
  }
  return out;
}
