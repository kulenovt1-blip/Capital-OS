/**
 * «Расчёт по шагам» и срок «сегодня + N месяцев» (D142): трасса по дням в `simulate`, баланс на дату, цепочка слагаемых.
 * Главное свойство: «на руках сейчас» + сумма строк = итог, ровно до тиына, для любой даты.
 */
import { describe, it, expect } from 'vitest';
import { simulate, type SimInput } from '../../engine/simulate';
import { balanceOn, forecastDate, stepsTo } from '../../engine/forecast-steps';
import { addDays, addMonths } from '../../engine/date';
import { DEFAULT_STRATEGY_SETTINGS } from '../../engine/allocate';
import { tenge } from '../../engine/money';
import { TODAY, worldGoals, worldProgress } from '../support/world';

function world(extra: Partial<SimInput> = {}): SimInput {
  return {
    start: TODAY,
    horizonMonths: 14,
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

/** Богатый вход: вклады (дневная и месячная капитализация), рассрочки, разовое событие, досрочное погашение, два дохода. */
function rich(): SimInput {
  return world({
    cash: tenge(758_000),
    deposits: [
      { id: 'd1', title: 'Вклад (месяц)', balance: tenge(500_000), rateBp: 1200, capitalization: 'monthly', availableFrom: '2026-01-01' },
      { id: 'd2', title: 'Вклад (день)', balance: tenge(200_000), rateBp: 900, capitalization: 'daily', availableFrom: '2027-06-01' },
    ],
    liabilities: tenge(120_000),
    payments: [
      { obligationId: 'ph', title: 'Телефон', date: '2026-11-17', amount: tenge(25_500), reducesLiability: true },
      { obligationId: 'ph', title: 'Телефон', date: '2026-12-17', amount: tenge(25_500), reducesLiability: true },
      { obligationId: 'ph', title: 'Телефон', date: '2027-01-17', amount: tenge(25_500), reducesLiability: true },
      { obligationId: 'dom', title: 'Дом', date: '2026-12-04', amount: tenge(6_658), reducesLiability: true },
      { obligationId: 'dom', title: 'Дом', date: TODAY, amount: tenge(6_658), reducesLiability: true },
    ],
    incomes: [
      { id: 'ben', title: 'Пособие', amount: tenge(81_871), dayOfMonth: 12, kind: 'stable' },
      { id: 'sal', title: 'Зарплата', amount: tenge(150_000), dayOfMonth: 31, kind: 'work' },
    ],
    expenses: [
      { key: 'E_base', title: 'Обычные траты', monthly: tenge(75_857), growthBp: 0 },
      { key: 'E_rare', title: 'Редкие траты', monthly: tenge(10_001), growthBp: 0 },
    ],
    events: [
      { id: 'tv', title: 'Телевизор', date: '2026-11-25', kind: 'one_off', amount: tenge(90_000) },
      { id: 'gift', title: 'Подарок деньгами', date: '2026-12-09', kind: 'one_off', amount: tenge(-20_000) },
      { id: 'po', title: 'Досрочно «Дом»', date: '2027-02-10', kind: 'obligation_payoff', target: 'dom', amount: tenge(0) },
    ],
  });
}

describe('трасса по дням', () => {
  it('по умолчанию выключена и ничего не меняет в результате', () => {
    const plain = simulate(world());
    expect(plain.trace).toBeUndefined();
    const traced = simulate(world(), undefined, { trace: true });
    expect(traced.trace).toBeDefined();
    const { trace: _t, ...rest } = traced;
    void _t;
    expect(rest).toEqual(plain);
  });

  it('на конце каждого месяца баланс трассы равен итогу месяца (деньги и обязательства)', () => {
    for (const input of [world(), rich()]) {
      const r = simulate(input, undefined, { trace: true });
      const days = new Map(r.trace!.days.map((d) => [d.date, d]));
      for (const m of r.months) {
        const lastDay = `${m.month}-${String(new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
        const d = days.get(lastDay);
        expect(d, lastDay).toBeDefined();
        expect(d!.assets).toBe(m.assets);
        expect(d!.liabilities).toBe(m.liabilities);
      }
    }
  });

  it('«на руках сейчас» + все слагаемые = баланс на каждый день', () => {
    const r = simulate(rich(), undefined, { trace: true });
    const t = r.trace!;
    let acc: number = t.startAssets;
    let i = 0;
    for (const d of t.days) {
      while (i < t.items.length && t.items[i]!.date <= d.date) acc += t.items[i++]!.delta;
      expect(d.assets, d.date).toBe(acc);
    }
    expect(i).toBe(t.items.length);
  });
});

describe('срок «сегодня + N месяцев»', () => {
  it('дата считается календарным месяцем с прижатием к концу месяца', () => {
    expect(forecastDate('2026-11-10', 1)).toBe('2026-12-10');
    expect(forecastDate('2026-11-10', 12)).toBe('2027-11-10');
    expect(forecastDate('2026-12-31', 2)).toBe('2027-02-28');
  });

  it('месяц от 5 ноября — окно 6.11–5.12: зарплата 20-го попадает один раз, а не дважды (было 31.12)', () => {
    const r = simulate(world(), undefined, { trace: true });
    const until = forecastDate(TODAY, 1);
    expect(until).toBe('2026-12-05');
    const s = stepsTo(r.trace!, until);
    const salary = s.lines.filter((l) => l.kind === 'income');
    expect(salary).toHaveLength(1);
    expect(salary[0]!.date).toBe('2026-11-20');
    // траты: ноябрь 6–30 = 25 дн. × 4000 = 100 000; декабрь 1–5 = 5 дн. × 120 000/31 ≈ 19 355
    const spend = s.lines.find((l) => l.kind === 'expense')!;
    expect(spend.amount).toBe(-(tenge(100_000) + Math.floor(tenge(120_000) / 31) * 5 + (tenge(120_000) % 31 >= 5 ? 5 : tenge(120_000) % 31)));
    expect(s.total).toBe(balanceOn(r.trace!, until).assets);
    // а старый срок «через месяц» = конец следующего месяца (31.12): в него вошли два начисления зарплаты
    expect(r.months[0]!.income + r.months[1]!.income).toBe(tenge(300_000));
  });
});

describe('цепочка слагаемых', () => {
  const dates = ['2026-11-05', '2026-11-06', '2026-11-13', '2026-11-30', '2026-12-05', '2026-12-31', '2027-02-10', '2027-05-05', '2027-12-31'];

  it('сумма строк = итог до тиына на любую дату (вклады, рассрочки, события, досрочное погашение)', () => {
    const r = simulate(rich(), undefined, { trace: true });
    for (const until of dates) {
      const s = stepsTo(r.trace!, until);
      const sum = s.lines.reduce((a, l) => a + l.amount, 0);
      expect(s.from + sum, until).toBe(s.total);
      expect(s.total, until).toBe(balanceOn(r.trace!, until).assets);
      expect(s.liabilities, until).toBe(balanceOn(r.trace!, until).liabilities);
    }
  });

  it('то же после группировки трат по своему правилу', () => {
    const r = simulate(rich(), undefined, { trace: true });
    const s = stepsTo(r.trace!, '2027-03-15', { group: (key) => (key === 'E_rare' ? { id: 'rare', title: 'Редкие траты' } : { id: 'usual', title: 'Обычные траты' }) });
    const spend = s.lines.filter((l) => l.kind === 'expense');
    expect(spend.map((l) => l.title)).toEqual(['Обычные траты', 'Редкие траты']);
    expect(s.from + s.lines.reduce((a, l) => a + l.amount, 0)).toBe(s.total);
  });

  it('платежи и доходы — отдельными строками с датами, по порядку дат; траты и проценты — одной строкой на группу', () => {
    const r = simulate(rich(), undefined, { trace: true });
    const s = stepsTo(r.trace!, '2026-12-31');
    const dated = s.lines.filter((l) => l.date);
    expect([...dated].sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0))).toEqual(dated);
    expect(dated.filter((l) => l.kind === 'obligation').map((l) => `${l.date} ${l.title}`)).toEqual(['2026-11-05 Дом', '2026-11-17 Телефон', '2026-12-04 Дом', '2026-12-17 Телефон']);
    expect(dated.filter((l) => l.kind === 'income').map((l) => `${l.date} ${l.title}`)).toEqual(['2026-11-12 Пособие', '2026-11-30 Зарплата', '2026-12-12 Пособие', '2026-12-31 Зарплата']);
    expect(s.lines.filter((l) => l.kind === 'interest')).toHaveLength(1);
    expect(s.lines.filter((l) => l.kind === 'expense')).toHaveLength(1);
    // поступление (минус в расходе) стоит со знаком «+»
    expect(s.lines.find((l) => l.title === 'Подарок деньгами')!.amount).toBe(tenge(20_000));
    expect(s.lines.find((l) => l.title === 'Телевизор')!.amount).toBe(-tenge(90_000));
  });

  it('проценты на середину месяца — начисленные к дате, на конец месяца равны капитализации', () => {
    const r = simulate(rich(), undefined, { trace: true });
    const mid = stepsTo(r.trace!, '2026-11-20').lines.find((l) => l.kind === 'interest')!;
    const end = stepsTo(r.trace!, '2026-11-30').lines.find((l) => l.kind === 'interest')!;
    expect(mid.amount).toBeGreaterThan(0);
    expect(end.amount).toBeGreaterThan(mid.amount);
    expect(end.amount).toBe(r.months[0]!.interestAccrued);
  });

  it('свёрнутые повторы: меньше строк, сумма и итог те же', () => {
    const r = simulate(rich(), undefined, { trace: true });
    const full = stepsTo(r.trace!, '2027-11-05');
    const short = stepsTo(r.trace!, '2027-11-05', { collapse: true });
    expect(short.lines.length).toBeLessThan(full.lines.length);
    expect(short.total).toBe(full.total);
    expect(short.from + short.lines.reduce((a, l) => a + l.amount, 0)).toBe(short.total);
    const ben = short.lines.find((l) => l.title === 'Пособие')!;
    expect(ben.count).toBe(12);
    expect(ben.date).toBe('2026-11-12');
    expect(ben.to).toBe('2027-10-12');
    // событие без повторов не сворачивается
    expect(short.lines.find((l) => l.title === 'Телевизор')!.count).toBe(1);
  });

  it('дата за пределами прогноза не падает: берётся последний день', () => {
    const r = simulate(world({ horizonMonths: 2 }), undefined, { trace: true });
    const s = stepsTo(r.trace!, addMonths(TODAY, 24));
    expect(s.from + s.lines.reduce((a, l) => a + l.amount, 0)).toBe(s.total);
    expect(s.until <= addDays(TODAY, 120)).toBe(true);
  });
});
