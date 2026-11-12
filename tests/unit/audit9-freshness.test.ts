import { describe, expect, it } from 'vitest';
import { dataFreshness, FRESH_DAYS, STALE_DAYS } from '../../engine/index';

describe('D180: свежесть данных', () => {
  it('нет импорта — none', () => expect(dataFreshness(null, '2026-11-12')).toEqual({ days: null, level: 'none' }));
  it('до 3 дней — молчим, 4–7 — aging, дольше — stale', () => {
    expect(dataFreshness('2026-11-12', '2026-11-12').level).toBe('fresh');
    expect(dataFreshness('2026-11-09', '2026-11-12')).toEqual({ days: FRESH_DAYS, level: 'fresh' });
    expect(dataFreshness('2026-11-08', '2026-11-12').level).toBe('aging');
    expect(dataFreshness('2026-11-05', '2026-11-12')).toEqual({ days: STALE_DAYS, level: 'aging' });
    expect(dataFreshness('2026-11-04', '2026-11-12').level).toBe('stale');
  });
  it('дата импорта в будущем не даёт отрицательных дней', () => expect(dataFreshness('2026-11-20', '2026-11-12').days).toBe(0));
});
