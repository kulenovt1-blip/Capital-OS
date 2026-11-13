import { describe, expect, it } from 'vitest';
import { CAPABILITIES, LATEST_RELEASE, RELEASES, shouldShowWhatsNew } from '../../app/whatsnew-data';
import { DEFAULT_SETTINGS, emptyState, parseState, serializeState } from '../../engine/index';

describe('D190: окно-карусель — короткие слайды, никуда не уводит', () => {
  const all = [...CAPABILITIES, ...RELEASES.flatMap((r) => r.slides)];
  it('заголовок, текст и подсказка «где» — коротко, без переносов', () => {
    for (const c of all) {
      expect(c.title.length, c.title).toBeLessThanOrEqual(40);
      expect(c.text.length, c.title).toBeLessThanOrEqual(140);
      expect(c.text, c.title).not.toMatch(/\n/);
      if (c.where) expect(c.where.length, c.title).toBeLessThanOrEqual(70);
    }
  });
  it('в окне не больше шести слайдов (плюс обложка)', () => {
    expect(CAPABILITIES.length).toBeLessThanOrEqual(6);
    expect(LATEST_RELEASE.slides.length).toBeLessThanOrEqual(6);
  });
  it('номера выпусков разные, новый — первый', () => {
    const ids = RELEASES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort().reverse()).toEqual(ids);
  });
  it('слайды не содержат ссылок на экраны', () => {
    for (const c of all) expect(Object.keys(c)).not.toContain('href');
  });
});

describe('D186: когда окно «Что нового» всплывает', () => {
  it('новому человеку без данных — не показываем', () => {
    expect(shouldShowWhatsNew(undefined, false)).toBe(false);
  });
  it('есть данные, выпуск не показывали — показываем', () => {
    expect(shouldShowWhatsNew(undefined, true)).toBe(true);
    expect(shouldShowWhatsNew('2026-01-01', true)).toBe(true);
  });
  it('выпуск уже показан — молчим', () => {
    expect(shouldShowWhatsNew(LATEST_RELEASE.id, true)).toBe(false);
  });
  it('отметка о показе переживает сохранение и чтение состояния', () => {
    const st = emptyState();
    st.settings = { ...DEFAULT_SETTINGS, whatsNewSeen: LATEST_RELEASE.id };
    const back = parseState(serializeState(st, '2026-11-13'));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.settings.whatsNewSeen).toBe(LATEST_RELEASE.id);
  });
});
