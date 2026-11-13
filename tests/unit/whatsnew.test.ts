import { describe, expect, it } from 'vitest';
import { CAPABILITIES, LATEST_RELEASE, RELEASES, shouldShowWhatsNew } from '../../app/whatsnew-data';
import { DEFAULT_SETTINGS, emptyState, parseState, serializeState } from '../../engine/index';

describe('D186: «Что умеет» и «Что нового» — карточки, не сплошной текст', () => {
  const all = [...CAPABILITIES, ...RELEASES.flatMap((r) => r.items)];
  it('короткие заголовки и одна строка пояснения', () => {
    for (const c of all) {
      expect(c.title.length, c.title).toBeLessThanOrEqual(40);
      expect(c.text.length, c.title).toBeLessThanOrEqual(110);
      expect(c.text, c.title).not.toMatch(/\n/);
    }
  });
  it('в окне не больше шести карточек', () => {
    expect(CAPABILITIES.length).toBeLessThanOrEqual(6);
    expect(LATEST_RELEASE.items.length).toBeLessThanOrEqual(6);
  });
  it('номера выпусков разные, новый — первый', () => {
    const ids = RELEASES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort().reverse()).toEqual(ids);
  });
  it('ссылки ведут на экраны приложения', () => {
    for (const c of all) if (c.href) expect(c.href, c.title).toMatch(/^#\/[a-z-]+$/);
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
