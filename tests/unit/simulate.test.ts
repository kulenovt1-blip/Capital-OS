/**
 * Симулятор (§6): помесячный шаг + дневная проверка разрывов, сценарии, «что если», предположения, детерминизм.
 */
import { describe, it, expect } from 'vitest';
import { simulate, whatIf, compareAlternatives, applyScenario, BASE_SCENARIO, DEFAULT_SCENARIOS, type SimInput } from '../../engine/simulate';
import { DEFAULT_STRATEGY_SETTINGS } from '../../engine/allocate';
import { tenge, tiyn } from '../../engine/money';
import { TODAY, worldGoals, worldProgress } from '../support/world';

function world(extra: Partial<SimInput> = {}): SimInput {
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
    strategySettings: DEFAULT_STRATEGY_SETTINGS,
    baseMedian: tenge(120_000),
    ...extra,
  };
}

describe('базовый прогон', () => {
  it('36 месяцев с текущего; первый месяц неполный (день «сегодня» не считается)', () => {
    const r = simulate(world());
    expect(r.months).toHaveLength(37);
    expect(r.months[0]!.month).toBe('2026-11');
    expect(r.months[36]!.month).toBe('2029-11');
    // ноябрь: расходы 6–30 = 25 дн. × 4 000 = 100 000, зарплата 150 000
    expect(r.months[0]!.expenses).toBe(tenge(100_000));
    expect(r.months[0]!.cashEnd).toBe(tenge(150_000));
    expect(r.months[1]!.cashEnd).toBe(tenge(180_000));
    expect(r.capitalAfter[12]).toBe(tenge(150_000 + 30_000 * 12));
  });

  it('месячный прирост назначается целям по стратегии: резерв закрыт в январе 2027, переезд не успевает к сроку', () => {
    const r = simulate(world());
    // ноябрь +50 000, декабрь +30 000, январь +20 000 → резерв 300 000
    expect(r.goalDates['reserve']).toBe('2027-01');
    expect(r.violations.join('\n')).toMatch(/Переезд/);
  });

  it('платежи по обязательствам уменьшают обязательства; досрочное погашение не меняет нетто-капитал', () => {
    const payments = [
      { obligationId: 'ob', title: 'Телефон', date: '2026-11-15', amount: tenge(30_285), reducesLiability: true },
      { obligationId: 'ob', title: 'Телефон', date: '2026-12-15', amount: tenge(30_285), reducesLiability: true },
    ];
    const r = simulate(world({ liabilities: tenge(60_570), payments }));
    expect(r.months[0]!.liabilities).toBe(tenge(30_285));
    expect(r.months[1]!.liabilities).toBe(tenge(0));
    expect(r.months[0]!.obligations).toBe(tenge(30_285));
    const [w] = whatIf(world({ liabilities: tenge(60_570), payments }), [{ id: 'p', title: 'Закрыть телефон', kind: 'obligation_payoff', date: '2026-11-10', target: 'ob', amount: tenge(0) }], [BASE_SCENARIO]);
    expect(w!.with.months[0]!.liabilities).toBe(tenge(0));
    expect(w!.deltaCapital[6]).toBe(tenge(0));
  });

  it('регулярное изменение расходов на период: +20 000 ₸ февраль–июнь 2027 → капитал через 12 мес. ниже на 100 000', () => {
    const [w] = whatIf(world(), [{ id: 'rent', title: 'Аренда', kind: 'recurring_change', date: '2027-02-01', until: '2027-06-30', amount: tenge(20_000) }], [BASE_SCENARIO]);
    expect(w!.deltaCapital[12]).toBe(tenge(-100_000));
  });

  it('рост дохода раз в N месяцев', () => {
    const r = simulate(world({ incomes: [{ id: 'salary', title: 'Зарплата', amount: tenge(150_000), dayOfMonth: 20, kind: 'work', growth: { rateBp: 1000, everyMonths: 12 } }] }));
    expect(r.months[11]!.income).toBe(tenge(150_000));
    expect(r.months[12]!.income).toBe(tenge(165_000));
  });

  it('блок «Предположения» генерируется из параметров', () => {
    const r = simulate(world());
    const a = r.assumptions.join('\n');
    expect(a).toMatch(/Зарплата.*150\s000/);
    expect(a).toMatch(/Базовые.*120\s000/);
    expect(a).toMatch(/метк/);
  });
});

describe('сценарии §6.3', () => {
  const future = world({ incomes: [{ id: 'salary', title: 'Зарплата', amount: tenge(150_000), dayOfMonth: 20, kind: 'work', start: '2027-01-01' }] });

  it('неблагоприятный: зарплата −20% и на 3 мес. позже, расходы +15%, разовый расход в 1 мес. базовых', () => {
    const adverse = DEFAULT_SCENARIOS.find((s) => s.id === 'adverse')!;
    const r = simulate(future, adverse);
    expect(r.months.slice(2, 5).map((m) => m.income)).toEqual([tiyn(0), tiyn(0), tiyn(0)]);
    expect(r.months[5]!.income).toBe(tenge(120_000)); // апрель 2027
    expect(r.months[1]!.expenses).toBe(tenge(138_000));
    expect(r.months[1]!.events).toBe(tenge(120_000));
  });

  it('благоприятный: зарплата +15% с плановой даты', () => {
    const r = simulate(future, DEFAULT_SCENARIOS.find((s) => s.id === 'favorable')!);
    expect(r.months[2]!.income).toBe(tenge(172_500));
  });

  it('патч сценария не меняет исходные параметры', () => {
    const before = JSON.stringify(future, (_k, v) => (v instanceof Map ? [...v] : v));
    applyScenario(future, DEFAULT_SCENARIOS[1]!.patch);
    expect(JSON.stringify(future, (_k, v) => (v instanceof Map ? [...v] : v))).toBe(before);
  });
});

describe('«что если» и альтернативы (§6.4)', () => {
  it('три сценария: Δ капитала, минимум капитала и месяц минимума', () => {
    const rs = whatIf(world(), [{ id: 'buy', title: 'Ноутбук', kind: 'one_off', date: '2027-03-10', amount: tenge(300_000) }], DEFAULT_SCENARIOS);
    expect(rs.map((r) => r.scenarioId)).toEqual(['base', 'adverse', 'favorable']);
    for (const r of rs) {
      expect(r.deltaCapital[36]).toBe(tenge(-300_000));
      expect(r.minCapitalWith.value).toBeLessThanOrEqual(r.minCapitalBase.value);
    }
  });

  it('альтернативы бок о бок: жильё у родственников / вдвоём / одному', () => {
    const alts = [
      { id: 'rel', title: 'У родственников', events: [{ id: 'r1', title: 'Помощь родственникам', kind: 'recurring_change' as const, date: '2027-09-01', amount: tenge(30_000) }] },
      { id: 'two', title: 'Вдвоём', events: [{ id: 'r2', title: 'Аренда вдвоём', kind: 'recurring_change' as const, date: '2027-09-01', amount: tenge(100_000) }] },
      { id: 'one', title: 'Одному', events: [{ id: 'r3', title: 'Аренда одному', kind: 'recurring_change' as const, date: '2027-09-01', amount: tenge(180_000) }] },
    ];
    const c = compareAlternatives(world(), alts, BASE_SCENARIO);
    expect(c.map((x) => x.id)).toEqual(['rel', 'two', 'one']);
    // 12 мес. от ноября 2026 = конец ноября 2027: сентябрь–ноябрь = 3 месяца
    expect(c.map((x) => x.deltaCapital[12])).toEqual([tenge(-90_000), tenge(-300_000), tenge(-540_000)]);
    expect(c[2]!.newGaps.length).toBeGreaterThan(0);
  });
});

describe('детерминизм', () => {
  it('один и тот же вход 100 раз даёт байт-в-байт одинаковый результат', () => {
    const inp = world({ deposits: [{ id: 'd', title: 'Депозит', balance: tenge(500_000), rateBp: 1450, capitalization: 'daily', availableFrom: '2027-06-01' }] });
    const first = JSON.stringify(simulate(inp, DEFAULT_SCENARIOS[1]));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(simulate(inp, DEFAULT_SCENARIOS[1]))).toBe(first);
  });
});
