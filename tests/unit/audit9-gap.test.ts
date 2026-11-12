import { describe, expect, it } from 'vitest';
import { spendGap, tenge } from '../../engine/index';

describe('D182: spendGap', () => {
  const base = { inSavings: tenge(809_000), locked: [] as { balance: number }[] };
  it('хватает на счетах — null', () => {
    expect(spendGap({ canSpend: tenge(1), ...base } as never)).toBeNull();
  });
  it('не хватает, копилки покрывают', () => {
    const g = spendGap({ canSpend: tenge(-26_111), ...base } as never)!;
    expect(g.covered).toBe(true);
    expect(g.gap).toBe(tenge(26_111));
  });
  it('заблокированный вклад не считается доступным', () => {
    const g = spendGap({ canSpend: tenge(-26_111), inSavings: tenge(809_000), locked: [{ balance: tenge(800_000) }] } as never)!;
    expect(g.covered).toBe(false);
    expect(g.savings).toBe(tenge(9_000));
  });
});
