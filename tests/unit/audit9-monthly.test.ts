import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseState, monthlySummaries, monthlySummary, monthlyCardMonth, lastFinishedMonth, summaryMonths } from '../../engine/index';

const r = parseState(readFileSync('public/demo.json', 'utf8'));
if (!r.ok) throw new Error(r.error);
const st = r.value;
const TODAY = '2026-11-04';

describe('D184: итоги месяца', () => {
  it('последний законченный месяц', () => {
    expect(lastFinishedMonth('2026-11-04')).toBe('2026-10');
    expect(lastFinishedMonth('2027-01-02')).toBe('2026-12');
  });
  it('история: месяцы идут от нового к старому, без повторов', () => {
    const ms = summaryMonths(st, TODAY, 12);
    expect(ms[0]).toBe('2026-10');
    expect([...ms].sort().reverse()).toEqual(ms);
    expect(new Set(ms).size).toBe(ms.length);
  });
  it('«осталось» = пришло − ушло; капитал сдвигается, если есть предыдущий месяц', () => {
    const list = monthlySummaries(st, TODAY, 6);
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      expect(s.left).toBe(s.income - s.spent);
      if (s.capitalFrom !== null) expect(s.capitalDelta).toBe(s.capitalTo - s.capitalFrom);
      expect(s.advice.length).toBeGreaterThan(0);
    }
  });
  it('месяц до начала данных — null', () => {
    expect(monthlySummary(st, TODAY, '2000-01')).toBeNull();
  });
  it('карточка: только в первые 7 дней, один раз', () => {
    expect(monthlyCardMonth(st, '2026-11-04')).toBe('2026-10');
    expect(monthlyCardMonth(st, '2026-11-20')).toBeNull();
    const seen = { ...st, settings: { ...st.settings, summarySeen: ['2026-10'] } };
    expect(monthlyCardMonth(seen, '2026-11-04')).toBeNull();
  });
  it('без данных карточки нет', () => {
    expect(monthlyCardMonth({ ...st, imported: null }, '2026-11-04')).toBeNull();
  });
});
