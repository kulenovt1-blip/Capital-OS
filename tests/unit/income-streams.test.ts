/**
 * T03 «Положение» v4, часть 1: общая сборка потоков дохода (`assembleIncomeStreams`), вынесенная из `simulate`.
 *
 * Главный критерий: прогноз не изменился. Эталон — tests/fixtures/position/simulate-baseline.json, снят запуском
 * СТАРОГО `simulate` (до выноса) на 139 профилях × 3 сценариях: доход по месяцам и sha1 всего результата.
 * Остальное — ручные случаи на самой функции сборки (ожидаемые значения посчитаны вручную, не снимались с кода).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { assembleIncomeStreams, DEFAULT_SCENARIOS, simulate, type IncomeStream, type LifeEvent } from '../../engine/simulate';
import { buildSimInput } from '../../engine/plan';
import { tenge } from '../../engine/money';
import { fixtureJson } from '../support/fixtures';
import { applyProbeOpts, probeProfiles, TODAY } from '../support/position-profiles';
import { incomeEventCases } from '../support/income-event-cases';

interface Baseline { today: string; scenarios: string[]; profiles: Record<string, Record<string, { income: number[]; hash: string }>> }
const BASE = fixtureJson<Baseline>('position/simulate-baseline.json');
const rep = (_k: string, v: unknown) => (v instanceof Map ? [...v.entries()] : v === undefined ? null : v);

const all = [
  ...probeProfiles().map((p) => ({ name: p.name, state: applyProbeOpts(p.state, p.opts) })),
  ...incomeEventCases().map((c) => ({ name: 'событие|' + c.name, state: c.state })),
];

describe('прогноз не изменился после выноса сборки потоков', () => {
  it('набор профилей и сценариев совпадает с эталоном', () => {
    expect(all.map((p) => p.name).sort()).toEqual(Object.keys(BASE.profiles).sort());
    expect(all.length).toBe(139);
    expect(DEFAULT_SCENARIOS.map((s) => s.id)).toEqual(BASE.scenarios);
    expect(TODAY).toBe(BASE.today);
  });

  for (const p of all) {
    it(p.name, () => {
      const { input } = buildSimInput(p.state, TODAY);
      for (const sc of DEFAULT_SCENARIOS) {
        const r = simulate(input, sc);
        const ref = BASE.profiles[p.name]![sc.id]!;
        expect(r.months.map((m) => m.income), `${sc.id}: доход по месяцам`).toEqual(ref.income);
        expect(createHash('sha1').update(JSON.stringify(r, rep)).digest('hex'), `${sc.id}: весь результат`).toBe(ref.hash);
      }
    });
  }

  it('события доходов действительно меняют прогноз (эталон не пустой)', () => {
    const b = incomeEventCases().find((c) => c.name === 'B: доход прекращается')!;
    const plain = all.find((p) => p.name === 'B Работающий')!;
    const withStop = simulate(buildSimInput(b.state, TODAY).input);
    const without = simulate(buildSimInput(plain.state, TODAY).input);
    expect(withStop.months.reduce((a, m) => a + m.income, 0)).toBeLessThan(without.months.reduce((a, m) => a + m.income, 0));
  });
});

// ───────── сборка потоков: ручные случаи ─────────

const START = '2026-11-04';
const salary: IncomeStream = { id: 'job', title: 'Зарплата', amount: tenge(400_000), dayOfMonth: 5, kind: 'work' };
const ev = (p: Partial<LifeEvent> & Pick<LifeEvent, 'id' | 'kind' | 'date'>): LifeEvent => ({ title: p.id, amount: tenge(0), ...p });

describe('assembleIncomeStreams', () => {
  it('без событий: копии расписания, опорная дата роста — growthAnchor, иначе start, иначе старт прогноза; происхождение — расписание', () => {
    const a: IncomeStream = { ...salary, id: 'a', growthAnchor: '2026-03-05', start: '2026-01-01' };
    const b: IncomeStream = { ...salary, id: 'b', start: '2027-01-01' };
    const c: IncomeStream = { ...salary, id: 'c' };
    const r = assembleIncomeStreams([a, b, c], [], START);
    expect(r.map((s) => [s.id, s.anchor, s.origin])).toEqual([['a', '2026-03-05', 'schedule'], ['b', '2027-01-01', 'schedule'], ['c', START, 'schedule']]);
    expect(r[0]).not.toBe(a);
    expect(a).not.toHaveProperty('anchor');
  });

  it('income_stop: конец потока — за день до события; уже закончившийся раньше поток не продлевается', () => {
    const early: IncomeStream = { ...salary, id: 'early', end: '2027-01-10' };
    const open: IncomeStream = { ...salary, id: 'open' };
    const r = assembleIncomeStreams([early, open], [ev({ id: 'e1', kind: 'income_stop', date: '2027-03-01', target: 'open' }), ev({ id: 'e2', kind: 'income_stop', date: '2027-03-01', target: 'early' })], START);
    expect(r.find((s) => s.id === 'open')!.end).toBe('2027-02-28');
    expect(r.find((s) => s.id === 'early')!.end).toBe('2027-01-10');
  });

  it('income_stop у потока с концом позже события — конец сдвигается на день до события', () => {
    const r = assembleIncomeStreams([{ ...salary, end: '2027-12-31' }], [ev({ id: 'e1', kind: 'income_stop', date: '2027-03-01', target: 'job' })], START);
    expect(r[0]!.end).toBe('2027-02-28');
  });

  it('income_change: старый поток заканчивается накануне, новый id@дата с новой суммой, тем же днём, видом и опорной датой; без срока конца нет', () => {
    const orig: IncomeStream = { ...salary, end: '2027-12-31', growthAnchor: '2026-03-05' };
    const r = assembleIncomeStreams([orig], [ev({ id: 'e1', kind: 'income_change', date: '2027-02-01', target: 'job', amount: tenge(500_000) })], START);
    expect(r).toHaveLength(2);
    expect(r[0]!.end).toBe('2027-01-31');
    const n = r[1]!;
    expect(n.id).toBe('job@2027-02-01');
    expect(n.amount).toBe(tenge(500_000));
    expect(n.start).toBe('2027-02-01');
    expect(n.dayOfMonth).toBe(5);
    expect(n.kind).toBe('work');
    expect(n.anchor).toBe('2026-03-05');
    expect(n.end).toBeUndefined();
    expect(n.origin).toBe('event');
  });

  it('income_change со сроком: конец нового потока — until', () => {
    const r = assembleIncomeStreams([salary], [ev({ id: 'e1', kind: 'income_change', date: '2027-02-01', target: 'job', amount: tenge(1), until: '2027-07-31' })], START);
    expect(r[1]!.end).toBe('2027-07-31');
  });

  it('income_change несуществующего потока ничего не создаёт, а чужие потоки не трогает', () => {
    const r = assembleIncomeStreams([salary], [ev({ id: 'e1', kind: 'income_change', date: '2027-02-01', target: 'nothing', amount: tenge(1) })], START);
    expect(r).toHaveLength(1);
    expect(r[0]!.end).toBeUndefined();
  });

  it('income_start: id — target, иначе id события; день — dayOfMonth, иначе день даты; вид по умолчанию work; опорная дата — дата события', () => {
    const r = assembleIncomeStreams([], [
      ev({ id: 'e1', kind: 'income_start', date: '2027-07-19', amount: tenge(60_000), title: 'Новая работа' }),
      ev({ id: 'e2', kind: 'income_start', date: '2027-08-01', target: 'side', dayOfMonth: 10, amount: tenge(30_000), incomeKind: 'irregular', until: '2027-12-31' }),
    ], START);
    expect(r.map((s) => [s.id, s.dayOfMonth, s.kind, s.start, s.anchor, s.end, s.origin])).toEqual([
      ['e1', 19, 'work', '2027-07-19', '2027-07-19', undefined, 'event'],
      ['side', 10, 'irregular', '2027-08-01', '2027-08-01', '2027-12-31', 'event'],
    ]);
    expect(r[0]!.title).toBe('Новая работа');
    expect(r[0]!.amount).toBe(tenge(60_000));
  });

  it('смена, затем прекращение: останавливаются и исходный поток, и все id@…', () => {
    const r = assembleIncomeStreams([salary], [
      ev({ id: 'e2', kind: 'income_stop', date: '2027-06-01', target: 'job' }),
      ev({ id: 'e1', kind: 'income_change', date: '2027-01-01', target: 'job', amount: tenge(450_000) }),
    ], START);
    // порядок событий во входе не важен: сначала по дате
    expect(r.map((s) => [s.id, s.end])).toEqual([['job', '2026-12-31'], ['job@2027-01-01', '2027-05-31']]);
  });

  it('события на одну дату применяются по id; вход не меняется и не сортируется на месте', () => {
    const events = [ev({ id: 'b', kind: 'income_start', date: '2027-02-01', amount: tenge(2) }), ev({ id: 'a', kind: 'income_start', date: '2027-02-01', amount: tenge(1) })];
    const copy = JSON.parse(JSON.stringify(events));
    const incomes = [salary];
    const r = assembleIncomeStreams(incomes, events, START);
    expect(r.map((s) => s.id)).toEqual(['job', 'a', 'b']);
    expect(events).toEqual(copy);
    expect(incomes[0]).toEqual(salary);
  });

  it('события других видов потоки не меняют', () => {
    const r = assembleIncomeStreams([salary], [
      ev({ id: 'x1', kind: 'one_off', date: '2027-01-01', amount: tenge(5) }),
      ev({ id: 'x2', kind: 'recurring_change', date: '2027-01-01', amount: tenge(5) }),
      ev({ id: 'x3', kind: 'obligation_payoff', date: '2027-01-01', target: 'job' }),
    ], START);
    expect(r).toHaveLength(1);
    expect(r[0]!.end).toBeUndefined();
  });
});
