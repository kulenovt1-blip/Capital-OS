/**
 * D209. Доход для «Долговой нагрузки» (N3): когда в расписании есть строки, действующие сегодня, доход не выше их суммы.
 * Раньше брали среднее за 6 месяцев — в него попадала уже закончившаяся подработка, которой в расписании нет, и нагрузка выглядела легче.
 * Эталон — ручная арифметика: доход = сумма действующих сегодня строк расписания (если расписание известно), иначе среднее за 6 мес.; N3 — по шкалам из debtLoadScore (ред. аудита 10).
 * Сверка с пробой идёт с `incomeFromSchedule: false` (в пробе — среднее), поэтому эталоны проб не менялись.
 */
import { describe, it, expect } from 'vitest';
import { computeIndicators, debtLoadScore, INDICATOR_IDS } from '../../engine/position/indicators';
import { build, probeProfiles, applyProbeOpts, TODAY, type Spec } from '../support/position-profiles';

const STIPEND = 150_000;
const JOB = 350_000;
const PAYMENT = 40_000;
const summer = new Set(['2026-07', '2026-08', '2026-09']);

const stipend = { id: 'stip', title: 'Стипендия', cls: 'I_stipend' as const, day: 20, amount: STIPEND, kind: 'stable' as const, sched: STIPEND };
/** Подработка июль–сентябрь; в расписание заносится (с датой окончания) или нет — как у человека, который её туда не вносил. */
const summerJob = (inSchedule: boolean) => ({ id: 'job', title: 'Подработка', cls: 'I_work' as const, day: 10, amount: (m: string) => (summer.has(m) ? JOB : 0), kind: 'work' as const, sched: inSchedule ? JOB : 0, ...(inSchedule ? { end: '2026-09-30' } : {}) });

const spec = (incomes: Spec['incomes']): Spec => ({
  name: 'seasonal', from: '2025-09', opening: 600_000, incomes,
  expenses: [{ id: 'food', title: 'Еда', cls: 'E_base', amount: 40_000, day: 3 }],
  debts: [{ id: 'phone', title: 'Телефон', remaining: 400_000, payment: PAYMENT, firstDate: '2026-11-10' }],
});
// среднее за 6 месяцев (май–октябрь) с летней подработкой: (150 000 × 6 + 350 000 × 3) / 6 = 325 000
const HISTORY_MEAN = 325_000;

describe('N3: доход по действующему расписанию (D209)', () => {
  it('подработка закончилась и в расписании её нет: доход — стипендия, а не среднее за 6 месяцев', () => {
    // sched: 0 у подработки — строки в расписании нет (в расписание попадает только положительная сумма)
    const s = build(spec([stipend, summerJob(false)]));
    const rep = computeIndicators({ ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.filter((i) => i.id !== 'job') } }, TODAY);
    const i = rep.inputs!;
    expect(i.incomeMonthly).toBeCloseTo(STIPEND, 0);
    expect(rep.values.N3).toBeCloseTo(debtLoadScore(i.obligationsMonthly, i.debtTotal, STIPEND), 6);
    expect(rep.values.N3!).toBeLessThan(debtLoadScore(i.obligationsMonthly, i.debtTotal, HISTORY_MEAN));
  });

  it('подработка закончилась и есть в расписании с датой окончания: тот же результат', () => {
    const rep = computeIndicators(build(spec([stipend, summerJob(true)])), TODAY);
    expect(rep.inputs!.incomeMonthly).toBeCloseTo(STIPEND, 0);
  });

  it('опция incomeFromSchedule: false возвращает среднее за 6 месяцев (как в пробе)', () => {
    const rep = computeIndicators(build(spec([stipend, summerJob(true)])), TODAY, undefined, { incomeFromSchedule: false });
    expect(rep.inputs!.incomeMonthly).toBeCloseTo(HISTORY_MEAN, 0);
  });

  it('доход по расписанию выше истории — берётся расписание (повышение или новая работа учитываются сразу)', () => {
    const s = build(spec([{ ...stipend, amount: 100_000, sched: 150_000 }]));
    expect(computeIndicators(s, TODAY).inputs!.incomeMonthly).toBeCloseTo(150_000, 0);
  });

  it('единственная строка закончилась — доход 0, как считает и F; N3 = 0 при долге', () => {
    const s = build(spec([{ ...stipend, end: '2026-11-03' }]));
    const rep = computeIndicators(s, TODAY);
    expect(rep.inputs!.incomeMonthly).toBe(0);
    expect(rep.values.N3).toBe(0);
  });

  it('строка, которая ещё не началась, в доход сегодня не входит', () => {
    const base = build(spec([stipend]));
    const s = { ...base, settings: { ...base.settings, incomeSchedule: base.settings.incomeSchedule.map((i) => ({ ...i, start: '2027-01-01' })) } };
    expect(computeIndicators(s, TODAY).inputs!.incomeMonthly).toBe(0);
  });

  it('больше строк расписания — доход и N3 не ниже (монотонность)', () => {
    const one = computeIndicators(build(spec([stipend])), TODAY);
    const two = computeIndicators(build(spec([stipend, { id: 'side', title: 'Сторона', cls: 'I_work' as const, day: 5, amount: 20_000, kind: 'work' as const, sched: 20_000 }])), TODAY);
    expect(two.inputs!.incomeMonthly).toBeGreaterThan(one.inputs!.incomeMonthly);
    expect(two.values.N3!).toBeGreaterThanOrEqual(one.values.N3!);
  });

  it('автопоток «Подарки, кешбэк» расписанием не считается: без строк доход — история, F — «нет данных»', () => {
    const base = build(spec([stipend, summerJob(false)]));
    const noSchedule = { ...base, settings: { ...base.settings, incomeSchedule: [], extraIncome: true } };
    const rep = computeIndicators(noSchedule, TODAY);
    expect(rep.inputs!.incomeMonthly).toBeCloseTo(HISTORY_MEAN, 0);
    for (const id of ['F1', 'F2', 'F3', 'F4'] as const) expect(rep.values[id], id).toBeNull();
  });

  it('индексация: строка с ростом, повышение которой было раньше, считается с ростом на сегодня', () => {
    const s = build(spec([stipend]));
    const row = s.settings.incomeSchedule[0]!;
    const indexed = { ...s, settings: { ...s.settings, inflationBp: 1000, incomeSchedule: [{ ...row, indexed: true, indexMonth: 3 } as never] } };
    const now = computeIndicators(indexed, TODAY).inputs!.incomeMonthly;
    expect(now).toBeGreaterThanOrEqual(STIPEND);
    expect(now).toBeLessThanOrEqual(STIPEND * 1.1 + 1);
  });

  it('расписания нет совсем — среднее за 6 месяцев, как раньше', () => {
    const base = build(spec([stipend, summerJob(false)]));
    const s = { ...base, settings: { ...base.settings, incomeSchedule: [] } };
    expect(computeIndicators(s, TODAY).inputs!.incomeMonthly).toBeCloseTo(HISTORY_MEAN, 0);
  });
});

describe('N3: влияние на пул проб (D209)', () => {
  const profiles = probeProfiles();
  const rows = profiles.map((p) => {
    const st = applyProbeOpts(p.state, p.opts);
    return { name: p.name, st, now: computeIndicators(st, TODAY), old: computeIndicators(st, TODAY, undefined, { incomeFromSchedule: false }) };
  });
  it('меняется только N3; остальные 11 показателей совпадают с прежними', () => {
    for (const { name, now, old } of rows) for (const id of INDICATOR_IDS) if (id !== 'N3') expect(now.values[id], `${name} ${id}`).toBe(old.values[id]);
  });
  it('доход для N3 = сумма действующих сегодня строк расписания (ручной подсчёт на профилях без индексации и событий)', () => {
    let checked = 0;
    for (const { name, st, now } of rows) {
      const sched = st.settings.incomeSchedule;
      if (!sched.length || sched.some((i) => i.indexed) || st.settings.plannedEvents.length) continue;
      const hand = sched.reduce((a, i) => a + ((!i.start || i.start <= TODAY) && (!i.end || i.end >= TODAY) ? i.amount / 100 : 0), 0);
      expect(now.inputs!.incomeMonthly, name).toBeCloseTo(hand, 0);
      expect(now.values.N3, name).toBeCloseTo(debtLoadScore(now.inputs!.obligationsMonthly, now.inputs!.debtTotal, hand, now.inputs!.secured), 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});
