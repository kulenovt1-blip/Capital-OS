/**
 * «Из А в Б» (D123, D143): человек видит, какой у него запас в месяцах (А), выбирает цель запаса — 1, 3, 6 или 12 месяцев (Б), — приложение считает путь:
 * сколько денег нужно, сколько не хватает, к какому месяцу при нынешнем темпе, а если нужно быстрее — сколько откладывать
 * в месяц сверху, чтобы успеть за 3 / 6 месяцев, год или два (меньше тратить или больше получать — для денежного потока одно и то же).
 *
 * Запас и цели запаса — `reserve.ts` (запас в месяцах: деньги сразу ÷ сколько уходит в обычный месяц). Деньги для цели Б =
 * месяцы цели × «сколько уходит в месяц». Месяц достижения — по помесячному прогнозу («деньги на конец месяца»): конец стипендии,
 * окончание рассрочек и плановые события в нём видны. Добавка в месяц считается прямо: (нужно − будет к сроку) ÷ месяцев до срока.
 * Проценты на добавку не считаются — это запас в пользу человека. Состояние не меняется.
 * (Обратный расчёт «успеть цели к дате» — `planToGoal` в `route.ts`.)
 */
import type { IsoDate, MonthKey } from './date';
import { mulDiv, ZERO, type Money } from './money';
import { higherTargets, liquidReachMonth, reserveNow, RESERVE_TARGETS, type Reserve, type ReserveTarget } from './reserve';
import { baseForecast } from './simple';
import type { AppState } from './state';

/** Сроки, за которые считаем «сколько откладывать сверху», месяцев. */
export const ROUTE_DEADLINES = [3, 6, 12, 24] as const;
const HORIZON = 60;
/** Добавку округляем вверх до 1 000 ₸ (в тиынах): «взять и сделать», а не 4 873 ₸. */
const ROUND = 100_000;

export interface RouteStep {
  /** Цель запаса, месяцев. */
  months: ReserveTarget;
  /** Сколько денег нужно для этой цели. */
  target: Money;
  /** Когда при нынешнем темпе (null — не за срок расчёта). */
  by: MonthKey | null;
}

export interface RouteDeadline {
  months: number;
  /** Месяц срока (n-й после текущего). */
  month: MonthKey;
  /** Сколько откладывать сверху в месяц, с первого числа следующего месяца; 0 — и так успеваешь. */
  extraMonthly: Money;
}

export interface Route {
  from: Reserve;
  /** Цель Б, месяцев запаса. */
  to: ReserveTarget;
  /** Сколько денег нужно для цели Б и сколько не хватает. */
  target: Money;
  missing: Money;
  /** К какому месяцу при нынешнем темпе (null — не за пять лет прогноза). */
  by: MonthKey | null;
  /** Цели по пути: после А до Б включительно — с месяцем каждой. */
  steps: RouteStep[];
  deadlines: RouteDeadline[];
  /** Траты больше доходов на столько в месяц (0 — нет); пока так, запас тает. */
  deficitMonthly: Money;
  /** Платежи по долгам кончатся: с какого месяца и сколько в месяц освободится. */
  debtFree: { from: MonthKey; freed: Money } | null;
}

export function routeTo(state: AppState, today: IsoDate, toMonths: ReserveTarget): Route | null {
  const from = reserveNow(state, today);
  if (!from || !higherTargets(from.coverMonths).includes(toMonths)) return null;
  const sim = baseForecast(state, today, HORIZON);
  const need = from.needMonthly;
  const targetOf = (months: number): Money => mulDiv(need, months, 1);
  const target = targetOf(toMonths);
  const missing = Math.max(0, target - from.liquid) as Money;
  const steps: RouteStep[] = RESERVE_TARGETS.filter((m) => from.coverMonths < m && m <= toMonths).map((m) => ({ months: m, target: targetOf(m), by: liquidReachMonth(sim, targetOf(m)) }));

  const deadlines: RouteDeadline[] = ROUTE_DEADLINES.filter((n) => n < sim.months.length).map((n) => {
    const will = sim.months[n]!.liquidEnd;
    const extra = Math.max(0, Math.ceil((target - will) / n / ROUND) * ROUND) as Money;
    return { months: n, month: sim.months[n]!.month, extraMonthly: extra };
  });

  let debtFree: Route['debtFree'] = null;
  const first = sim.months[1]?.obligations ?? ZERO;
  if (first > 0) {
    const end = sim.months.findIndex((m, i) => i >= 1 && m.obligations === 0);
    if (end > 0) debtFree = { from: sim.months[end]!.month, freed: first };
  }
  return { from, to: toMonths, target, missing, by: liquidReachMonth(sim, target), steps, deadlines, deficitMonthly: Math.max(0, -from.surplusMonthly) as Money, debtFree };
}
