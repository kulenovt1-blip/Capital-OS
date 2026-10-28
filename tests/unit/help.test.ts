/**
 * Кнопки ⓘ: у каждой кнопки в интерфейсе есть текст в глоссарии, и тексты не пустые.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP } from '../../app/help-text';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('глоссарий кнопок ⓘ', () => {
  const used = new Set<string>();
  for (const f of files(APP)) for (const m of readFileSync(f, 'utf8').matchAll(/info\('([a-zA-Z0-9]+)'\)/g)) used.add(m[1]!);

  it('кнопки расставлены по экранам', () => {
    expect(used.size).toBeGreaterThanOrEqual(15);
  });
  it('у каждой кнопки есть пояснение', () => {
    expect([...used].filter((k) => !(k in HELP))).toEqual([]);
  });
  it('пояснения не пустые и без сокращений-заглушек', () => {
    for (const [k, v] of Object.entries(HELP)) {
      expect(v.title.length, k).toBeGreaterThan(2);
      expect(v.text.length, k).toBeGreaterThan(40);
      expect(v.text, k).not.toMatch(/TODO|lorem/i);
    }
  });
});
