import { describe, it, expect } from 'vitest';
import { crc32, readZip, findZipStart } from '../../engine/import/zip';
import { writeZip, concat } from '../support/zip-writer';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('crc32', () => {
  it('совпадает с эталоном', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('readZip', () => {
  const big = enc.encode('строка базы данных '.repeat(5000));
  const files = [
    { name: 'MyFinance.db', data: big },
    { name: 'meta.json', data: enc.encode('{"v":1}'), method: 0 as const },
    { name: 'папка/файл.txt', data: enc.encode('привет'), dataDescriptor: true },
  ];

  it('читает deflate, stored и data descriptor', () => {
    const entries = readZip(writeZip(files));
    expect(entries.map((e) => e.name)).toEqual(['MyFinance.db', 'meta.json', 'папка/файл.txt']);
    expect(entries[0]!.data()).toEqual(big);
    expect(dec.decode(entries[1]!.data())).toBe('{"v":1}');
    expect(dec.decode(entries[2]!.data())).toBe('привет');
  });

  it('находит начало ZIP после бинарного префикса любой длины', () => {
    for (const prefixLen of [0, 3, 8, 17]) {
      const prefix = new Uint8Array(prefixLen).map((_, i) => (i * 37 + 11) & 0xff);
      const blob = concat(prefix, writeZip(files));
      expect(findZipStart(blob)).toBe(prefixLen);
      const entries = readZip(blob.subarray(findZipStart(blob)));
      expect(entries[0]!.data()).toEqual(big);
    }
  });

  it('читает архив с комментарием в конце', () => {
    const entries = readZip(writeZip(files, 'комментарий архива'));
    expect(entries.length).toBe(3);
  });

  it('ловит повреждение данных по CRC', () => {
    const z = writeZip([{ name: 'a.txt', data: enc.encode('hello world'), method: 0 }]);
    const i = z.indexOf('h'.charCodeAt(0), 30);
    z[i] = 'j'.charCodeAt(0);
    expect(() => readZip(z)[0]!.data()).toThrow(/CRC/);
  });

  it('понятная ошибка, если это не ZIP', () => {
    expect(findZipStart(enc.encode('not a zip at all'))).toBe(-1);
    expect(() => readZip(enc.encode('PK\u0003\u0004 garbage'))).toThrow();
  });
});
