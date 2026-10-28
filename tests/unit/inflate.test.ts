import { describe, it, expect } from 'vitest';
import { deflateRawSync, constants } from 'node:zlib';
import { inflateRaw } from '../../engine/import/inflate';

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samples(): Record<string, Uint8Array> {
  const enc = new TextEncoder();
  const r = prng(42);
  const random = new Uint8Array(70_000).map(() => Math.floor(r() * 256));
  const words = ['Продукты', 'Рассрочка', 'Kaspi', 'зарплата', '2026-10-28', 'Накопление', ' ', '\n'];
  let text = '';
  for (let i = 0; i < 40_000; i++) text += words[Math.floor(r() * words.length)];
  const lowEntropy = new Uint8Array(200_000).map((_, i) => (i % 7 === 0 ? 65 : 66 + Math.floor(r() * 3)));
  return {
    empty: new Uint8Array(0),
    one: enc.encode('a'),
    short: enc.encode('Hello, Capital OS! Привет!'),
    repetitive: enc.encode('abc'.repeat(50_000)),
    random,
    text: enc.encode(text),
    lowEntropy,
  };
}

describe('inflateRaw', () => {
  for (const [name, data] of Object.entries(samples())) {
    for (const level of [0, 1, 6, 9]) {
      it(`распаковывает ${name} (уровень ${level})`, () => {
        const packed = deflateRawSync(data, { level });
        const out = inflateRaw(new Uint8Array(packed));
        expect(out.length).toBe(data.length);
        expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true);
      });
    }
  }

  it('распаковывает поток с фиксированными кодами Хаффмана', () => {
    const data = new TextEncoder().encode('aaaaaaaaaabbbbbbbbbbaaaaaaaaaa');
    const packed = deflateRawSync(data, { strategy: constants.Z_FIXED });
    expect(new TextDecoder().decode(inflateRaw(new Uint8Array(packed)))).toBe('aaaaaaaaaabbbbbbbbbbaaaaaaaaaa');
  });

  it('бросает на мусоре', () => {
    expect(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toThrow();
    expect(() => inflateRaw(new Uint8Array([]))).toThrow();
  });

  it('проверяет ожидаемый размер', () => {
    const packed = new Uint8Array(deflateRawSync(new TextEncoder().encode('hello')));
    expect(() => inflateRaw(packed, 6)).toThrow();
    expect(inflateRaw(packed, 5).length).toBe(5);
  });
});
