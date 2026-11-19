/**
 * D209. Доход для «Долговой нагрузки» (N3): когда в расписании есть строки, действующие сегодня, доход не выше их суммы.
 * Раньше брали среднее за 6 месяцев — в него попадала уже закончившаяся подработка, которой в расписании нет, и нагрузка выглядела легче.
 * Эталон — ручная арифметика: доход = min(среднее за 6 мес., сумма действующих сегодня строк); N3 — по шкалам из debtLoadScore.
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

  it('доход по расписанию выше истории — берётся история (меньшее)', () => {
    const s = build(spec([{ ...stipend, amount: 100_000, sched: 150_000 }]));
    expect(computeIndicators(s, TODAY).inputs!.incomeMonthly).toBeCloseTo(100_000, 0);
  });

  it('ни одной строки расписания, действующей сегодня, — остаётся история', () => {
    const s = build(spec([{ ...stipend, end: '2026-09-30' }]));
    expect(computeIndicators(s, TODAY).inputs!.incomeMonthly).toBeCloseTo(STIPEND, 0);
  });

  it('расписания нет совсем — среднее за 6 месяцев, как раньше', () => {
    const base = build(spec([stipend, summerJob(false)]));
    const s = { ...base, settings: { ...base.settings, incomeSchedule: [] } };
    expect(computeIndicators(s, TODAY).inputs!.incomeMonthly).toBeCloseTo(HISTORY_MEAN, 0);
  });
});

describe('N3: влияние на пул проб (D209)', () => {
  const profiles = probeProfiles();
  const both = profiles.map((p) => {
    const st = applyProbeOpts(p.state, p.opts);
    return { name: p.name, now: computeIndicators(st, TODAY).values, old: computeIndicators(st, TODAY, undefined, { incomeFromSchedule: false }).values };
  });
  it('меняется только N3 и только в сторону «строже»; остальные 11 показателей совпадают', () => {
    for (const { name, now, old } of both) {
      for (const id of INDICATOR_IDS) {
        if (id === 'N3') continue;
        expect(now[id], `${name} ${id}`).toBe(old[id]);
      }
      if (old.N3 == null) expect(now.N3, name).toBe(old.N3);
      else expect(now.N3!, name).toBeLessThanOrEqual(old.N3 + 1e-9);
    }
  });
  it('на 127 пробных профилях N3 меняется у 21', () => {
    expect(both.filter(({ now, old }) => now.N3 !== old.N3).length).toBe(21);
  });
});
