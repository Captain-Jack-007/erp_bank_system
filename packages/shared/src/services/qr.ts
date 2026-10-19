// QR-код (ISO/IEC 18004) без зависимостей: байтовый режим (UTF-8), уровень коррекции M,
// версии 1–10 (до 213 байт), выбор маски по штрафным правилам. Результат — матрица модулей и SVG-путь.
import { utf8Encode } from './bytes';

// [всего кодовых слов, EC на блок, блоков группы 1, данных в блоке гр.1, блоков группы 2, данных в блоке гр.2]
const VERSIONS_M: [number, number, number, number, number, number][] = [
  [26, 10, 1, 16, 0, 0],
  [44, 16, 1, 28, 0, 0],
  [70, 26, 1, 44, 0, 0],
  [100, 18, 2, 32, 0, 0],
  [134, 24, 2, 43, 0, 0],
  [172, 16, 4, 27, 0, 0],
  [196, 18, 4, 31, 0, 0],
  [242, 22, 2, 38, 2, 39],
  [292, 22, 3, 36, 2, 37],
  [346, 26, 4, 43, 1, 44],
];
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

export const QR_MAX_BYTES = 213;

// ---------- Поле Галуа GF(256), полином 0x11D ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** Порождающий многочлен Рида–Соломона степени n (коэффициенты без старшего). */
function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] = next[j]! ^ g[j]!;
      next[j + 1] = next[j + 1]! ^ gmul(g[j]!, EXP[i]!);
    }
    g = next;
  }
  return g.slice(1);
}

/** Кодовые слова коррекции ошибок для блока данных. */
export function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const res = new Array<number>(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ res.shift()!;
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] = res[i]! ^ gmul(gen[i]!, factor);
  }
  return res;
}

export interface QrMatrix {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x] = true — тёмный модуль. */
  modules: boolean[][];
}

function chooseVersion(len: number, forced?: number): number {
  for (let v = forced ?? 1; v <= (forced ?? 10); v++) {
    const [total, ec, b1, , b2] = VERSIONS_M[v - 1]!;
    const dataCw = total - ec * (b1 + b2);
    const bits = 4 + (v < 10 ? 8 : 16) + len * 8;
    if (bits <= dataCw * 8) return v;
  }
  throw new Error(`QR: data too long (${len} bytes, max ${QR_MAX_BYTES})`);
}

function buildCodewords(bytes: Uint8Array, version: number): number[] {
  const [total, ec, b1, d1, b2, d2] = VERSIONS_M[version - 1]!;
  const dataCw = total - ec * (b1 + b2);
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCw * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCw; pad ^= 0xec ^ 0x11) data.push(pad);
  // Разбиение на блоки, коррекция и чередование.
  const blocks: number[][] = [];
  let off = 0;
  for (let i = 0; i < b1; i++, off += d1) blocks.push(data.slice(off, off + d1));
  for (let i = 0; i < b2; i++, off += d2) blocks.push(data.slice(off, off + d2));
  const ecBlocks = blocks.map((b) => rsEncode(b, ec));
  const out: number[] = [];
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i]!);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  m: boolean[][];
  fn: boolean[][];
  constructor(public size: number) {
    this.m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  set(x: number, y: number, dark: boolean) {
    this.m[y]![x] = dark;
    this.fn[y]![x] = true;
  }
}

function drawFunctionPatterns(g: Grid, version: number) {
  const n = g.size;
  for (let i = 0; i < n; i++) {
    g.set(6, i, i % 2 === 0);
    g.set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        g.set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(n - 4, 3);
  finder(3, n - 4);
  const pos = ALIGN[version - 1]!;
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.set(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  drawFormat(g, 0); // резервируем область формата
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.set(a, b, bit);
      g.set(b, a, bit);
    }
  }
}

/** Формат: уровень M (биты 00) + маска, BCH(15,5), XOR 0x5412. */
function drawFormat(g: Grid, mask: number) {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const n = g.size;
  for (let i = 0; i <= 5; i++) g.set(8, i, bit(i));
  g.set(8, 7, bit(6));
  g.set(8, 8, bit(7));
  g.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) g.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) g.set(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) g.set(8, n - 15 + i, bit(i));
  g.set(8, n - 8, true); // тёмный модуль
}

function drawData(g: Grid, cw: number[]) {
  const n = g.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (!g.fn[y]![x] && i < cw.length * 8) {
          g.m[y]![x] = ((cw[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
}

function applyMask(g: Grid, mask: number) {
  const f = MASKS[mask]!;
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fn[y]![x] && f(x, y)) g.m[y]![x] = !g.m[y]![x];
}

/** Штраф по ISO 18004, 8.8.2 (N1=3, N2=3, N3=40, N4=10). */
export function qrPenalty(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
    }
    // Шаблон 1:1:3:1:1 с 4 светлыми модулями с одной из сторон (за пределами символа — светлые).
    const at = (i: number) => (i < 0 || i >= n ? false : get(i));
    for (let i = -4; i < n; i++) {
      const core = at(i) && !at(i + 1) && at(i + 2) && at(i + 3) && at(i + 4) && !at(i + 5) && at(i + 6);
      if (!core) continue;
      const before = !at(i - 1) && !at(i - 2) && !at(i - 3) && !at(i - 4);
      const after = !at(i + 7) && !at(i + 8) && !at(i + 9) && !at(i + 10);
      if (before || after) p += 40;
    }
  };
  for (let y = 0; y < n; y++) line((i) => m[y]![i]!);
  for (let x = 0; x < n; x++) line((i) => m[i]![x]!);
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const c = m[y]![x];
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) p += 3;
    }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const k = Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n));
  p += k * 10;
  return p;
}

/** Закодировать строку (UTF-8) в QR-матрицу. mask — принудительная маска 0..7 (для тестов). */
export function encodeQr(text: string, opts: { version?: number; mask?: number } = {}): QrMatrix {
  const bytes = utf8Encode(text);
  const version = chooseVersion(bytes.length, opts.version);
  const size = 17 + version * 4;
  const cw = buildCodewords(bytes, version);
  const build = (mask: number) => {
    const g = new Grid(size);
    drawFunctionPatterns(g, version);
    drawData(g, cw);
    applyMask(g, mask);
    drawFormat(g, mask);
    return g;
  };
  let best: Grid | null = null;
  let bestMask = 0;
  let bestScore = Infinity;
  const masks = opts.mask !== undefined ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const mk of masks) {
    const g = build(mk);
    const s = qrPenalty(g.m);
    if (s < bestScore) {
      bestScore = s;
      best = g;
      bestMask = mk;
    }
  }
  return { version, size, mask: bestMask, modules: best!.m };
}

/** SVG-путь из тёмных модулей (единица = модуль), с отступом quiet zone. */
export function qrSvgPath(q: QrMatrix, margin = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < q.size; y++) {
    let x = 0;
    while (x < q.size) {
      if (!q.modules[y]![x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < q.size && q.modules[y]![x]) x++;
      parts.push(`M${start + margin} ${y + margin}h${x - start}v1h-${x - start}z`);
    }
  }
  return parts.join('');
}

/** Полный SVG-документ (для печати/скачивания). */
export function qrSvg(text: string, opts: { margin?: number; px?: number; dark?: string; light?: string } = {}): string {
  const q = encodeQr(text);
  const margin = opts.margin ?? 4;
  const dim = q.size + margin * 2;
  const px = opts.px ?? dim * 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${opts.light ?? '#fff'}"/><path d="${qrSvgPath(q, margin)}" fill="${opts.dark ?? '#000'}"/></svg>`;
}
