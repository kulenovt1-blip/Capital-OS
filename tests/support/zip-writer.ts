/**
 * Минимальный ZIP-писатель для тестов и генерации фикстур.
 * Не часть движка: движку нужен только ридер.
 */
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../../engine/import/zip';

export interface ZipInput {
  name: string;
  data: Uint8Array;
  method?: 0 | 8;
  /** Писать размеры в data descriptor (бит 3), а в локальном заголовке нули. */
  dataDescriptor?: boolean;
}

export function writeZip(files: ZipInput[], comment = ''): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const method = f.method ?? 8;
    const name = enc.encode(f.name);
    const body = method === 8 ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const crc = crc32(f.data);
    const flags = (f.dataDescriptor ? 0x08 : 0) | 0x0800;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, flags, true);
    lh.setUint16(8, method, true);
    lh.setUint32(14, f.dataDescriptor ? 0 : crc, true);
    lh.setUint32(18, f.dataDescriptor ? 0 : body.length, true);
    lh.setUint32(22, f.dataDescriptor ? 0 : f.data.length, true);
    lh.setUint16(26, name.length, true);
    const parts = [new Uint8Array(lh.buffer), name, body];
    if (f.dataDescriptor) {
      const dd = new DataView(new ArrayBuffer(16));
      dd.setUint32(0, 0x08074b50, true);
      dd.setUint32(4, crc, true);
      dd.setUint32(8, body.length, true);
      dd.setUint32(12, f.data.length, true);
      parts.push(new Uint8Array(dd.buffer));
    }
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, flags, true);
    cd.setUint16(10, method, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    for (const p of parts) {
      chunks.push(p);
      offset += p.length;
    }
  }
  const cdStart = offset;
  let cdLen = 0;
  for (const c of central) {
    chunks.push(c);
    cdLen += c.length;
  }
  const cm = enc.encode(comment);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdLen, true);
  eocd.setUint32(16, cdStart, true);
  eocd.setUint16(20, cm.length, true);
  chunks.push(new Uint8Array(eocd.buffer), cm);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
