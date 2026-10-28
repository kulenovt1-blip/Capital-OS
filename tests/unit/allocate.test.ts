/**
 * Распределение поступления (§5): шаг 0 и «лестница» для стратегий A–D.
 * Все ожидания посчитаны вручную (см. комментарии) до реализации.
 */
import { describe, it, expect } from 'vitest';
import { step0, ladder, DEFAULT_STRATEGY_SETTINGS, validateCustomStrategy, type LadderInput } from '../../engine/allocate';
import { tenge, tiyn } from '../../engine/money';
import { TODAY, worldGoals, worldProgress } from '../support/world';

const S = DEFAULT_STRATEGY_SETTINGS;

const base0 = {
  today: TODAY,
  nextIncome: '2026-11-20',
  upcoming: [{ obligationId: 'ob-phone', title: 'Телефон', owner: 'self' as const, date: '2026-11-15', amount: tenge(30_285) }],
  baseMedian: tenge(120_000),
  liquidFreeBefore: tenge(0),
  obligationGoalFunds: tenge(0),
  incomeInBalance: false,
  goalsWithLiquidFunds: [],
};

describe('шаг 0 — доступная сумма (§5.1)', () => {
  it('Доступно = поступление − R1 − R2; R2 = медиана × 12 × H / 365', () => {
    const r = step0({ ...base0, income: tenge(400_000) });
    expect(r.H).toBe(15);
    expect(r.R1).toBe(tenge(30_285));
    // 12 000 000 тиын × 180 / 365 = 5 917 808,2 → 5 917 808 тиын
    expect(r.R2).toBe(tiyn(5_917_808));
    expect(r.available).toBe(tiyn(40_000_000 - 3_028_500 - 5_917_808));
    expect(r.ok).toBe(true);
  });

  it('свободные деньги на счетах сначала покрывают R1, остаток — R2 (D41)', () => {
    const r = step0({ ...base0, income: tenge(400_000), liquidFreeBefore: tenge(40_000) });
    expect(r.R1uncovered).toBe(tenge(0));
    // осталось 9 715 ₸ на R2
    expect(r.R2uncovered).toBe(tiyn(5_917_808 - 971_500));
    expect(r.available).toBe(tiyn(40_000_000 - (5_917_808 - 971_500)));
  });

  it('если поступление уже в балансе — оно не считается «свободными деньгами» второй раз', () => {
    const r = step0({ ...base0, income: tenge(400_000), liquidFreeBefore: tenge(440_000), incomeInBalance: true });
    // вне поступления свободно 40 000 — как в предыдущем тесте
    expect(r.available).toBe(tiyn(40_000_000 - (5_917_808 - 971_500)));
  });

  it('деньги цели с ролью «обязательство» покрывают R1', () => {
    const r = step0({ ...base0, income: tenge(400_000), obligationGoalFunds: tenge(30_285) });
    expect(r.R1uncovered).toBe(tenge(0));
    expect(r.available).toBe(tiyn(40_000_000 - 5_917_808));
  });
});

describe('лестница: стратегия B «Баланс»', () => {
  const inp = (amount: number, extra: Partial<LadderInput> = {}): LadderInput => ({
    amount: tiyn(amount), today: TODAY, goals: worldGoals(), progress: worldProgress(), fundedThisMonth: new Map(), strategy: { id: 'B' }, settings: S, ...extra,
  });

  it('резерв до минимума → минимум переезда → остаток по весам importance × urgency', () => {
    // доступно 310 536,92 ₸ = 31 053 692 тиын
    const r = ladder(inp(31_053_692));
    // L1: резерв 300 000 − 200 000 = 100 000; L2: переезд 600 000 / 10 мес. = 60 000
    // L3: 150 536,92 ₸; веса: база 5×12 = 60, переезд 4×(12+2) = 56
    // база 15 053 692 × 60/116 = 7 786 392,41 → 7 786 392; переезд 7 267 299,59 → 7 267 299; остаток 1 тиын → переезд (дробь больше)
    expect(r.byGoal).toEqual({ reserve: tenge(100_000), move: tiyn(6_000_000 + 7_267_300), base: tiyn(7_786_392) });
    expect(r.free).toBe(tiyn(0));
    expect(r.underfunded).toEqual([]);
    expect(r.byGoal['teeth']).toBeUndefined(); // на паузе
  });

  it('уже назначенное в этом месяце уменьшает минимум (несколько доходов в месяц)', () => {
    const r = ladder(inp(31_053_692, { fundedThisMonth: new Map([['move', tenge(45_000)]]) }));
    expect(r.allocations.find((a) => a.goalId === 'move' && a.level === 2)!.amount).toBe(tenge(15_000));
  });

  it('цели «подтвердить» с нулевой суммой пропускаются с объяснением', () => {
    const goals = [...worldGoals(), { ...worldGoals()[1]!, id: 'tbd', title: 'Неизвестно сколько', targetMin: tiyn(0), unconfirmed: true }];
    const r = ladder(inp(31_053_692, { goals }));
    expect(r.byGoal['tbd']).toBeUndefined();
    expect(r.explanation.some((s) => s.code === 'ladder.skip_unconfirmed')).toBe(true);
  });
});

describe('лестница: стратегии A, C, D', () => {
  const inp = (strategy: LadderInput['strategy']): LadderInput => ({
    amount: tiyn(31_053_692), today: TODAY, goals: worldGoals(), progress: worldProgress(), fundedThisMonth: new Map(), strategy, settings: S,
  });

  it('A «Безопасность»: резерв до комфорта ×1,5; остаток 70% в резерв, 30% по весам', () => {
    const r = ladder(inp({ id: 'A' }));
    // L1: 450 000 − 200 000 = 250 000; L2 переезд 60 000; R = 536,92 ₸ = 53 692 тиын
    // 70%: 37 584,4 → 37 584 в резерв; 30%: 16 108 → база 8 331,72 / переезд 7 776,28 → +1 базе → 8 332 / 7 776
    expect(r.byGoal).toEqual({ reserve: tiyn(25_000_000 + 37_584), move: tiyn(6_000_000 + 7_776), base: tiyn(8_332) });
    expect(r.free).toBe(tiyn(0));
  });

  it('C «Ускорение»: минимумы всем, остаток целиком на выбранную цель', () => {
    const r = ladder(inp({ id: 'C', focusGoalIds: ['base'] }));
    expect(r.byGoal).toEqual({ reserve: tenge(100_000), move: tenge(60_000), base: tiyn(15_053_692) });
  });

  it('C: пользователь разрешил 0 минимуму — минимум не выдаётся', () => {
    const r = ladder(inp({ id: 'C', focusGoalIds: ['base'], zeroMinimumGoalIds: ['move'] }));
    expect(r.byGoal).toEqual({ reserve: tenge(100_000), base: tiyn(21_053_692) });
  });

  it('D «Своя»: резерв, фиксированные минимумы и проценты остатка; не распределённое — свободно', () => {
    const custom = { reserveTarget: tenge(350_000), minimums: [{ goalId: 'move', amount: tenge(100_000) }], rest: [{ goalId: 'base', pctBp: 5000 }] };
    const r = ladder(inp({ id: 'D', custom }));
    // L1 150 000; L2 100 000; R = 60 536,92; база 50% = 30 268,46
    expect(r.byGoal).toEqual({ reserve: tenge(150_000), move: tenge(100_000), base: tiyn(3_026_846) });
    expect(r.free).toBe(tiyn(3_026_846));
  });

  it('D: валидатор запрещает нарушать уровень 1 и проценты больше 100%', () => {
    const goals = worldGoals();
    expect(validateCustomStrategy({ reserveTarget: tenge(250_000), minimums: [], rest: [] }, goals).join()).toMatch(/резерв/i);
    expect(validateCustomStrategy({ reserveTarget: tenge(300_000), minimums: [], rest: [{ goalId: 'base', pctBp: 6000 }, { goalId: 'move', pctBp: 5000 }] }, goals).join()).toMatch(/100/);
    expect(validateCustomStrategy({ reserveTarget: tenge(300_000), minimums: [], rest: [{ goalId: 'base', pctBp: 10000 }] }, goals)).toEqual([]);
  });
});
