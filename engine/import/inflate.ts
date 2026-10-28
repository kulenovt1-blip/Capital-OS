/**
 * Распаковка raw DEFLATE (RFC 1951). Синхронно, без зависимостей.
 * Нужна для ZIP внутри .mmbackup; работает одинаково в браузере и в тестах.
 */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Канонический код Хаффмана: число кодов каждой длины + символы по порядку. */
interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function buildHuffman(lengths: ArrayLike<number>, n: number): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]!]!++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1]! + counts[i - 1]!;
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const l = lengths[i]!;
    if (l) symbols[offs[l]!++] = i;
  }
  return { counts, symbols };
}

class BitReader {
  pos = 0;
  bitBuf = 0;
  bitCnt = 0;
  constructor(readonly src: Uint8Array) {}

  bits(n: number): number {
    while (this.bitCnt < n) {
      if (this.pos >= this.src.length) throw new Error('DEFLATE: неожиданный конец данных');
      this.bitBuf |= this.src[this.pos++]! << this.bitCnt;
      this.bitCnt += 8;
    }
    const v = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCnt -= n;
    return v;
  }

  decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.bits(1);
      const count = h.counts[len]!;
      if (code - count < first) return h.symbols[index + (code - first)]!;
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('DEFLATE: некорректный код Хаффмана');
  }

  alignToByte(): void {
    this.bitBuf = 0;
    this.bitCnt = 0;
  }
}

class Output {
  buf: Uint8Array;
  len = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(Math.max(size, 1024));
  }
  ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let n = this.buf.length * 2;
    while (n < this.len + extra) n *= 2;
    const b = new Uint8Array(n);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
}

let fixedLit: Huffman | null = null;
let fixedDist: Huffman | null = null;
function fixedTables(): [Huffman, Huffman] {
  if (!fixedLit || !fixedDist) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144);
    l.fill(9, 144, 256);
    l.fill(7, 256, 280);
    l.fill(8, 280, 288);
    fixedLit = buildHuffman(l, 288);
    fixedDist = buildHuffman(new Uint8Array(30).fill(5), 30);
  }
  return [fixedLit, fixedDist];
}

function dynamicTables(br: BitReader): [Huffman, Huffman] {
  const hlit = br.bits(5) + 257;
  const hdist = br.bits(5) + 1;
  const hclen = br.bits(4) + 4;
  const cl = new Uint8Array(19);
  for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]!] = br.bits(3);
  const clH = buildHuffman(cl, 19);
  const lengths = new Uint8Array(hlit + hdist);
  let i = 0;
  while (i < hlit + hdist) {
    const sym = br.decode(clH);
    if (sym < 16) {
      lengths[i++] = sym;
    } else {
      let rep: number;
      let val = 0;
      if (sym === 16) {
        if (i === 0) throw new Error('DEFLATE: повтор без предыдущей длины');
        val = lengths[i - 1]!;
        rep = 3 + br.bits(2);
      } else if (sym === 17) {
        rep = 3 + br.bits(3);
      } else {
        rep = 11 + br.bits(7);
      }
      if (i + rep > hlit + hdist) throw new Error('DEFLATE: длины кодов вне диапазона');
      lengths.fill(val, i, i + rep);
      i += rep;
    }
  }
  return [buildHuffman(lengths.subarray(0, hlit), hlit), buildHuffman(lengths.subarray(hlit), hdist)];
}

/**
 * Распаковать raw DEFLATE. `expectedSize` (если известен из ZIP) используется
 * для выделения памяти и проверки результата.
 */
export function inflateRaw(src: Uint8Array, expectedSize?: number): Uint8Array {
  if (src.length === 0) throw new Error('DEFLATE: пустой поток');
  const br = new BitReader(src);
  const out = new Output(expectedSize ?? src.length * 4);
  let final = 0;
  do {
    final = br.bits(1);
    const type = br.bits(2);
    if (type === 0) {
      br.alignToByte();
      if (br.pos + 4 > src.length) throw new Error('DEFLATE: обрезанный stored-блок');
      const len = src[br.pos]! | (src[br.pos + 1]! << 8);
      const nlen = src[br.pos + 2]! | (src[br.pos + 3]! << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('DEFLATE: повреждён stored-блок');
      br.pos += 4;
      if (br.pos + len > src.length) throw new Error('DEFLATE: обрезанный stored-блок');
      out.ensure(len);
      out.buf.set(src.subarray(br.pos, br.pos + len), out.len);
      out.len += len;
      br.pos += len;
    } else if (type === 1 || type === 2) {
      const [lit, dist] = type === 1 ? fixedTables() : dynamicTables(br);
      for (;;) {
        const sym = br.decode(lit);
        if (sym < 256) {
          out.ensure(1);
          out.buf[out.len++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          if (li >= 29) throw new Error('DEFLATE: некорректная длина');
          const length = LEN_BASE[li]! + br.bits(LEN_EXTRA[li]!);
          const di = br.decode(dist);
          if (di >= 30) throw new Error('DEFLATE: некорректная дистанция');
          const distance = DIST_BASE[di]! + br.bits(DIST_EXTRA[di]!);
          if (distance > out.len) throw new Error('DEFLATE: ссылка за начало данных');
          out.ensure(length);
          const b = out.buf;
          let p = out.len;
          for (let k = 0; k < length; k++, p++) b[p] = b[p - distance]!;
          out.len = p;
        }
      }
    } else {
      throw new Error('DEFLATE: неизвестный тип блока');
    }
  } while (!final);
  if (expectedSize !== undefined && out.len !== expectedSize) {
    throw new Error(`DEFLATE: размер ${out.len}, ожидался ${expectedSize}`);
  }
  return out.buf.slice(0, out.len);
}
