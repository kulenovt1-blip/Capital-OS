/**
 * Сценарные тесты: ситуации 1–9 из спецификации (§11 инструкции). Ситуация 10 — этап 4.
 * Ожидаемые результаты записаны до реализации; расчёт — в комментариях.
 *
 * Правила дневного расчёта (DECISIONS D44): месячный расход делится на дни месяца поровну в тиынах,
 * остаток деления — по 1 тиыну первым дням. Порядок внутри дня: разблокировка вкладов → доходы →
 * события → платежи → расходы → покрытие минуса из доступных вкладов → проверка разрыва.
 * День «сегодня» не обрабатывается: его доходы и расходы уже в балансе.
 */
import { describe, it, expect } from 'vitest';
import { step0, ladder, compareStrategies, DEFAULT_STRATEGY_SETTINGS, type CompareInput } from '../../engine/allocate';
import { simulate, whatIf, BASE_SCENARIO, type SimInput } from '../../engine/simulate';
import { changeStatus } from '../../engine/goals';
import { tenge, tiyn } from '../../engine/money';
import { g, TODAY, worldGoals, worldProgress } from '../support/world';

const S = DEFAULT_STRATEGY_SETTINGS;
const phone = { obligationId: 'ob-phone', title: 'Телефон', owner: 'self' as const, date: '2026-11-15', amount: tenge(30_285) };

const step0Base = {
  today: TODAY,
  nextIncome: '2026-11-20',
  upcoming: [phone],
  baseMedian: tenge(120_000),
  liquidFreeBefore: tenge(0),
  obligationGoalFunds: tenge(0),
  incomeInBalance: false,
  goalsWithLiquidFunds: [{ goalId: 'base', title: 'База 1 млн', amount: tenge(100_000) }],
};

/** Простой мир для симулятора: зарплата 150 000 ₸ 20-го, базовые расходы 120 000 ₸/мес., без инфляции. */
function simWorld(extra: Partial<SimInput> = {}): SimInput {
  return {
    start: TODAY,
    horizonMonths: 36,
    cash: tenge(100_000),
    deposits: [],
    liabilities: tenge(0),
    payments: [],
    incomes: [{ id: 'salary', title: 'Зарплата', amount: tenge(150_000), dayOfMonth: 20, kind: 'work' }],
    expenses: [{ key: 'E_base', title: 'Базовые', monthly: tenge(120_000), growthBp: 0 }],
    events: [],
    goals: worldGoals(),
    progress: worldProgress(),
    strategy: { id: 'B' },
    strategySettings: S,
    baseMedian: tenge(120_000),
    ...extra,
  };
}

function compareInput(income: number): CompareInput {
  return {
    step0: { ...step0Base, income: tenge(income) },
    goals: worldGoals(),
    progress: worldProgress(),
    fundedThisMonth: new Map(),
    sim: simWorld({ cash: tenge(income) }),
    strategies: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    planStrategy: 'B',
    settings: S,
  };
}

describe('1. Денег хватает на всё', () => {
  it('обязательства и базовые расходы до дохода зарезервированы, резерв и минимумы выполнены, остаток по весам', () => {
    const s0 = step0({ ...step0Base, income: tenge(400_000) });
    expect(s0.available).toBe(tiyn(31_053_692)); // 400 000 − 30 285 − 59 178,08
    const r = ladder({ amount: s0.available, today: TODAY, goals: worldGoals(), progress: worldProgress(), fundedThisMonth: new Map(), strategy: { id: 'B' }, settings: S });
    expect(r.underfunded).toEqual([]);
    expect(r.byGoal).toEqual({ reserve: tenge(100_000), move: tiyn(13_267_300), base: tiyn(7_786_392) });
  });

  it('сравнение стратегий: три варианта, капитал одинаков (назначение — метка, не перевод), у каждой есть «цена выбора»', () => {
    const c = compareStrategies(compareInput(400_000));
    expect(c.rows.map((x) => x.ids.join('+'))).toEqual(['A', 'B', 'C']);
    const caps = c.rows.map((x) => x.capitalAfter[12]);
    expect(new Set(caps).size).toBe(1);
    for (const row of c.rows) expect(row.price.length).toBeGreaterThan(10);
    expect(c.rows.find((x) => x.ids.includes('B'))!.byGoal).toEqual({ reserve: tenge(100_000), move: tiyn(13_267_300), base: tiyn(7_786_392) });
  });
});

describe('2. Хватает на обязательства, но не на все цели', () => {
  it('резерв получает всё, минимум переезда помечен недофинансированным', () => {
    const s0 = step0({ ...step0Base, income: tenge(150_000) });
    expect(s0.available).toBe(tiyn(15_000_000 - 3_028_500 - 5_917_808)); // 60 536,92 ₸
    const r = ladder({ amount: s0.available, today: TODAY, goals: worldGoals(), progress: worldProgress(), fundedThisMonth: new Map(), strategy: { id: 'B' }, settings: S });
    expect(r.byGoal).toEqual({ reserve: tiyn(6_053_692) });
    expect(r.underfunded).toEqual([{ goalId: 'move', required: tenge(60_000), given: tiyn(0) }]);
  });

  it('стратегии, давшие одинаковое распределение, объединены с объяснением', () => {
    const c = compareStrategies(compareInput(150_000));
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]!.ids).toEqual(['A', 'B', 'C']);
    expect(c.merged[0]!.reason).toMatch(/доступно только 60\s536,92/);
  });

  it('если в объединённой группе есть стратегия плана, показывается её прогноз — сдвиг относительно плана нулевой', () => {
    const c = compareStrategies(compareInput(150_000));
    const shifts = Object.values(c.rows[0]!.shiftVsPlan).filter((v) => v !== null);
    expect(shifts.every((v) => v === 0)).toBe(true);
    expect(c.rows[0]!.strategy.id).toBe('B');
  });
});

describe('3. Ближайший платёж больше доступного остатка', () => {
  const big = { ...phone, amount: tenge(90_000) };
  it('стратегии не строятся; показан непокрытый платёж, дефицит и варианты', () => {
    const s0 = step0({ ...step0Base, upcoming: [big], income: tenge(50_000) });
    expect(s0.ok).toBe(false);
    // 50 000 − 90 000 − 59 178,08
    expect(s0.available).toBe(tiyn(5_000_000 - 9_000_000 - 5_917_808));
    expect(s0.deficit).toBe(tiyn(9_917_808));
    const text = s0.explanation.map((x) => x.text).join('\n');
    expect(text).toMatch(/Телефон/);
    expect(text).toMatch(/15\.11\.2026/);
    expect(s0.options.join('\n')).toMatch(/База 1 млн/);
    expect(s0.options.join('\n')).toMatch(/перенести/i);
    const c = compareStrategies({ ...compareInput(50_000), step0: { ...step0Base, upcoming: [big], income: tenge(50_000) } });
    expect(c.rows).toEqual([]);
  });
});

describe('4. Непредвиденный расход', () => {
  it('«что если» −200 000 ₸ 10.12.2026: капитал ниже ровно на 200 000 на всех горизонтах, появляются разрывы', () => {
    const [r] = whatIf(simWorld(), [{ id: 'e', title: 'Ремонт ноутбука', kind: 'one_off', date: '2026-12-10', amount: tenge(200_000) }], [BASE_SCENARIO]);
    expect(r!.base.gaps).toEqual([]);
    expect(r!.deltaCapital).toEqual({ 6: tenge(-200_000), 12: tenge(-200_000), 24: tenge(-200_000), 36: tenge(-200_000) });
    // 30.11: 150 000; 1–10.12 расходы 10 × 3 870,97 = 38 709,70; минус 200 000 → −88 709,70 → разрыв с 10.12
    // до 19.12 ещё 9 дней → −123 548,43; 20.12 зарплата закрывает разрыв
    expect(r!.newGaps[0]).toEqual({ start: '2026-12-10', end: '2026-12-19', maxDeficit: tiyn(12_354_843) });
    expect(r!.newGaps[1]!.start).toBe('2026-12-26');
  });
});

describe('5. Доход временно прекращается', () => {
  it('зарплаты нет январь–март: капитал через 6 мес. ниже на 450 000, разрыв с 14.02.2027', () => {
    const events = [
      { id: 'stop', title: 'Нет работы', kind: 'income_stop' as const, date: '2027-01-01', target: 'salary', amount: tenge(0) },
      { id: 'back', title: 'Новая работа', kind: 'income_start' as const, date: '2027-04-01', target: 'salary2', amount: tenge(150_000), dayOfMonth: 20 },
    ];
    const [r] = whatIf(simWorld(), events, [BASE_SCENARIO]);
    expect(r!.with.months.slice(2, 5).map((m) => m.income)).toEqual([tiyn(0), tiyn(0), tiyn(0)]);
    expect(r!.deltaCapital[6]).toBe(tenge(-450_000));
    // 31.01: 60 000; февраль 120 000 / 28: 12 дней по 4 285,72 и 16 по 4 285,71 → на 14-й день −0,06 ₸
    expect(r!.newGaps[0]!.start).toBe('2027-02-14');
  });
});

describe('6. Две цели конкурируют за одну сумму', () => {
  const goals = [
    g({ id: 'reserve', role: 'safety', targetMin: tenge(300_000), importance: 5 }),
    g({ id: 'x', title: 'Ноутбук', targetMin: tenge(250_000), deadline: '2027-04-01', competesWith: [] }),
    g({ id: 'y', title: 'Курсы', targetMin: tenge(300_000), deadline: '2027-05-01' }),
  ];
  const progress = new Map([['reserve', tenge(300_000)]]);
  it('минимум получает цель с более ранним сроком; вторая помечена недофинансированной', () => {
    const r = ladder({ amount: tenge(70_000), today: TODAY, goals: goals.map((x) => (x.id === 'x' ? { ...x, competesWith: ['y'] } : x)), progress, fundedThisMonth: new Map(), strategy: { id: 'B' }, settings: S });
    expect(r.byGoal).toEqual({ x: tenge(50_000), y: tenge(20_000) });
    expect(r.underfunded).toEqual([{ goalId: 'y', required: tenge(50_000), given: tenge(20_000) }]);
    expect(r.explanation.some((s) => s.code === 'ladder.competition')).toBe(true);
  });
  it('при равных сроке и важности порядок по id — детерминированно', () => {
    const same = goals.map((x) => (x.id === 'x' ? { ...x, targetMin: tenge(300_000), deadline: '2027-05-01' } : x));
    const r = ladder({ amount: tenge(70_000), today: TODAY, goals: same, progress, fundedThisMonth: new Map(), strategy: { id: 'B' }, settings: S });
    expect(r.byGoal).toEqual({ x: tenge(50_000), y: tenge(20_000) });
  });
});

describe('7. Цель выполнена раньше срока', () => {
  it('переезд добирает до минимума (1 000 минимум + 9 000 по весам), излишек уходит базе; дата — ноябрь 2026 вместо сентября 2027', () => {
    const progress = worldProgress({ move: 590_000 });
    const r = ladder({ amount: tiyn(31_053_692), today: TODAY, goals: worldGoals(), progress, fundedThisMonth: new Map(), strategy: { id: 'B' }, settings: S });
    expect(r.byGoal).toEqual({ reserve: tenge(100_000), move: tenge(10_000), base: tiyn(20_053_692) });
    // резерв тоже добирает минимум (200 000 → 300 000) — исправлено ожидание, см. DECISIONS D48
    expect(r.achieved).toEqual(['move', 'reserve']);
    const after = new Map(progress);
    for (const [k, v] of Object.entries(r.byGoal)) after.set(k, tiyn((after.get(k) ?? 0) + v));
    const sim = simulate(simWorld({ progress: after }));
    expect(sim.goalDates['move']).toBe('2026-11');
    expect(sim.explanation.some((s) => s.code === 'sim.goal_early' && s.refs?.goalId === 'move')).toBe(true);
  });
});

describe('8. Пользователь меняет приоритет или отменяет цель', () => {
  const amount = tiyn(31_053_692);
  it('отмена цели: её минимум исчезает, деньги уходят другим целям', () => {
    const goals = worldGoals();
    const c = changeStatus(goals[2]!, 'cancelled', 'остаюсь в своём городе', TODAY, { goals, fundings: [] });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const r = ladder({ amount, today: TODAY, goals: goals.map((x) => (x.id === 'move' ? c.value : x)), progress: worldProgress(), fundedThisMonth: new Map(), strategy: { id: 'B' }, settings: S });
    expect(r.byGoal).toEqual({ reserve: tenge(100_000), base: tiyn(21_053_692) });
  });
  it('понижение важности базы с 5 до 1 перераспределяет остаток (веса 12 и 56)', () => {
    const goals = worldGoals().map((x) => (x.id === 'base' ? { ...x, importance: 1 as const } : x));
    const r = ladder({ amount, today: TODAY, goals, progress: worldProgress(), fundedThisMonth: new Map(), strategy: { id: 'B' }, settings: S });
    // 15 053 692 × 12/68 = 2 656 533,88; × 56/68 = 12 397 158,12 → +1 тиын базе
    expect(r.byGoal).toEqual({ reserve: tenge(100_000), move: tiyn(6_000_000 + 12_397_158), base: tiyn(2_656_534) });
  });
});

describe('9. Депозит приносит проценты, но деньги недоступны', () => {
  const input = simWorld({
    cash: tenge(10_000),
    incomes: [],
    expenses: [{ key: 'E_base', title: 'Базовые', monthly: tenge(30_000), growthBp: 0 }],
    deposits: [{ id: 'dep', title: 'Срочный депозит', balance: tenge(1_000_000), rateBp: 1200, capitalization: 'monthly', availableFrom: '2027-03-01' }],
  });
  it('проценты начисляются, но в ликвидность не входят до даты; разрыв при большом капитале', () => {
    const r = simulate(input);
    const nov = r.months[0]!;
    // 1 000 000 ₸ × 12% × 25 дн. / 365 = 8 219,178 → 8 219,18 ₸
    expect(nov.interestAccrued).toBe(tiyn(821_918));
    expect(nov.depositsEnd).toBe(tiyn(100_821_918));
    expect(nov.liquidEnd).toBe(tenge(-15_000));
    expect(nov.capital).toBe(tiyn(-1_500_000 + 100_821_918));
    expect(r.gaps[0]).toEqual({ start: '2026-11-16', end: '2027-02-28', maxDeficit: tenge(105_000) });
    // с марта вклад доступен — минус покрыт из него, разрывов больше нет
    expect(r.gaps).toHaveLength(1);
    expect(r.months[4]!.liquidEnd).toBeGreaterThan(0);
    expect(r.assumptions.join('\n')).toMatch(/недоступн/);
  });
});
