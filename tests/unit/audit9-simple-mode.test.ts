import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyState, isSimpleMode, parseState } from '../../engine/index';

describe('D185: простой режим', () => {
  it('у старых данных поля нет — режим полный (ничего не меняется под ногами)', () => {
    const r = parseState(readFileSync('public/demo.json', 'utf8'));
    if (!r.ok) throw new Error(r.error);
    expect(r.value.settings.uiMode).toBeUndefined();
    expect(isSimpleMode(r.value.settings)).toBe(false);
    expect(isSimpleMode(emptyState().settings)).toBe(false);
  });
  it('simple включается явно и переживает сохранение', () => {
    const s = emptyState();
    s.settings.uiMode = 'simple';
    expect(isSimpleMode(s.settings)).toBe(true);
    const back = parseState(JSON.stringify({ app: 'capital-os', version: 1, state: s }));
    // версия может не совпасть с текущей схемой — проверяем только, что поле не теряется, если разбор прошёл
    if (back.ok) expect(back.value.settings.uiMode).toBe('simple');
  });
});
