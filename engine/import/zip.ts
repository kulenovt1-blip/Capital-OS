/**
 * Чтение ZIP (только то, что нужно для .mmbackup): stored и deflate, без ZIP64 и шифрования.
 */
import { inflateRaw } from './inflate';

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  return CRC_TABLE;
}

export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc32: number;
  /** Распаковать и проверить CRC. */
  data(): Uint8Array;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Позиция первой сигнатуры `PK\x03\x04` или -1. Смещение не зашито: префикс может быть любой длины. */
export function findZipStart(bytes: Uint8Array): number {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) return i;
  }
  return -1;
}

function decodeName(raw: Uint8Array): string {
  return new TextDecoder('utf-8').decode(raw);
}

function makeEntry(bytes: Uint8Array, dv: DataView, localOffset: number, meta: Omit<ZipEntry, 'data'>): ZipEntry {
  return {
    ...meta,
    data(): Uint8Array {
      if (localOffset + 30 > bytes.length || dv.getUint32(localOffset, true) !== SIG_LOCAL) {
        throw new Error(`ZIP: не найден локальный заголовок для «${meta.name}»`);
      }
      const nameLen = dv.getUint16(localOffset + 26, true);
      const extraLen = dv.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + nameLen + extraLen;
      const end = start + meta.compressedSize;
      if (end > bytes.length) throw new Error(`ZIP: «${meta.name}» обрезан`);
      const raw = bytes.subarray(start, end);
      let out: Uint8Array;
      if (meta.method === 0) out = raw.slice();
      else if (meta.method === 8) out = inflateRaw(raw, meta.size);
      else throw new Error(`ZIP: метод сжатия ${meta.method} не поддерживается`);
      if (crc32(out) !== meta.crc32) throw new Error(`ZIP: CRC не совпадает для «${meta.name}» — файл повреждён`);
      return out;
    },
  };
}

/** Прочитать каталог ZIP. `bytes` должен начинаться с начала ZIP (см. findZipStart). */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD: ищем с конца (комментарий до 65535 байт)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP: не найден конец центрального каталога — файл обрезан или это не ZIP');
  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 не поддерживается');
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CENTRAL) throw new Error('ZIP: повреждён центральный каталог');
    const flags = dv.getUint16(p + 8, true);
    if (flags & 0x1) throw new Error('ZIP: зашифрованные архивы не поддерживаются');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push(makeEntry(bytes, dv, localOffset, { name, method, compressedSize, size, crc32: crc }));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
