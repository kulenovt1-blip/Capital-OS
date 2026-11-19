/**
 * Ступень 5 «Могу не смотреть на цены» (D216): сверх ступени 4 — факты, без прогнозов доходности.
 * Деньги на 12 месяцев обычной жизни, на обязательное ≤ 50 % дохода, откладывает ≥ 10 % дохода в 5 из 6 месяцев.
 * Второй путь — денег на 25 лет обычной жизни и ни один ограничитель не сработал.
 */
import { describe, it, expect } from 'vitest';
import { l5CheckOf, levelOf, L5_CAPITAL_ONLY_MONTHS, L5_ESSENTIAL_SHARE_MAX, L5_HABIT_MIN, L5_LIFE_RESERVE_MONTHS, L5_SAVING_RATE_MIN, type LevelFacts, type LevelInput } from '../../engine/position/level';

const facts = (o: Partial<LevelFacts> = {}): LevelFacts => ({ reserveMonths: 20, savingRate: 0.3, lifeReserveMonths: 15, essentialShare: 0.35, habit: 100, ...o });
const strong = (f: LevelFacts, o: Partial<LevelInput> = {}): LevelInput => ({ g: 85, directions: { N: 80, V: 80, F: 80 }, reliable: { N: true, V: true, F: true }, fired: [], facts: f, ...o });

describe('условия ступени 5', () => {
  it('пороги — те, что согласованы с владельцем', () => {
    expect([L5_LIFE_RESERVE_MONTHS, L5_ESSENTIAL_SHARE_MAX, L5_SAVING_RATE_MIN, L5_HABIT_MIN, L5_CAPITAL_ONLY_MONTHS]).toEqual([12, 0.5, 0.1, 80, 300]);
  });
  it('все четыре факта и ступень 4 по очкам — ступень 5', () => {
    expect(levelOf(strong(facts())).level).toBe(5);
  });
  it('не хватает любого одного факта — остаётся 4, и в проверке видно, какого', () => {
    for (const [o, key] of [[{ lifeReserveMonths: 11.9 }, 'lifeReserve'], [{ essentialShare: 0.51 }, 'essentialShare'], [{ savingRate: 0.09 }, 'savingRate'], [{ habit: 67 }, 'habit']] as const) {
      const r = levelOf(strong(facts(o)));
      expect(r.level, key).toBe(4);
      expect(r.l5![key].ok, key).toBe(false);
    }
  });
  it('без дохода доля обязательного не считается — не ступень 5 этим путём', () => {
    expect(levelOf(strong(facts({ essentialShare: null }))).level).toBe(4);
  });
  it('факты выполнены, но по очкам не ступень 4 — не 5 (кроме денег на 25 лет)', () => {
    expect(levelOf(strong(facts(), { g: 60 })).level).toBe(3);
  });
  it('денег на 25 лет обычной жизни — ступень 5 даже при минусе и низких очках; сработавший ограничитель — нет', () => {
    const rich = facts({ lifeReserveMonths: 400, reserveMonths: 600, savingRate: -0.5, essentialShare: 3, habit: 0 });
    expect(levelOf(strong(rich, { g: 55, directions: { N: 80, V: 30, F: 50 } })).level).toBe(5);
    expect(levelOf(strong(rich, { g: 55, fired: ['cliff'] })).level).not.toBe(5);
  });
  it('без фактов ступени 5 нет (старые вызовы, необходимые не отмечены)', () => {
    expect(l5CheckOf(undefined, [])).toBeNull();
    expect(levelOf(strong(facts(), { facts: undefined })).level).toBe(4);
  });
});
