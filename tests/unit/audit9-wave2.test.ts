import { describe, expect, it } from 'bun:test';
import { step0 } from '../../engine/ladder';
import { tenge } from '../../engine/money';

const base = {
  today: '2026-11-01', income: tenge(200_000), baseMedian: tenge(300_000), liquidFreeBefore: tenge(0), obligationGoalFunds: tenge(0),
  incomeInBalance: false, goalsWithLiquidFunds: [], upcoming: [],
} as never;

describe('D174: защищаемый срок', () => {
  it('зарплата через 8 дней: без минимума резерв маленький, с минимумом — на 30 дней', () => {
    const near = { ...(base as object), nextIncome: '2026-11-09' } as never;
    const short = step0(near);
    const long = step0({ ...(near as object), minHorizonDays: 30 } as never);
    expect(short.H).toBe(8);
    expect(long.H).toBe(30);
    expect(long.R2).toBeGreaterThan(short.R2);
    expect(long.available).toBeLessThan(short.available);
  });
  it('минимум не укорачивает длинный горизонт', () => {
    const far = step0({ ...(base as object), nextIncome: '2026-12-15', minHorizonDays: 30 } as never);
    expect(far.H).toBe(44);
  });
});
