/**
 * Запас в месяцах (D115, D123; без «этапов» с D143): один понятный измеритель — на сколько месяцев хватит денег, если доход пропадёт.
 * Месяцы запаса = деньги, которые можно снять сразу, ÷ сколько уходит в обычный месяц (траты + платежи по долгам). Больше ничего.
 * Ступеней и их названий нет: уровень человека — в «Положении» (`engine/position`). Здесь — только запас и цели запаса
 * для «Из А в Б»: 1, 3, 6 и 12 месяцев (те же границы, что были у прежних ступеней, поэтому суммы и сроки не изменились).
 * Отдельно, не как цель: сколько остаётся в месяц (+ копится, − тает) — у него свой показатель.
 * Опирается только на то, что есть в бэкапе: наличные и долги вне MoneyManager не видны — это сказано в тексте.
 */
import { add, formatKZT, mulDiv, sum, ZERO, type Money } from './money';
import type { IsoDate, MonthKey } from './date';
import { buildOverview } from './overview';
import { baseForecast } from './simple';
import type { SimResult } from './simulate';
import type { AppState } from './state';

/** Цели запаса, месяцев. */
export const RESERVE_TARGETS = [1, 3, 6, 12] as const;
export type ReserveTarget = (typeof RESERVE_TARGETS)[number];

/** Что значит такой запас по-человечески — одна фраза для списка целей в «Из А в Б». */
export const RESERVE_NOTES: Record<ReserveTarget, string> = {
  1: 'Неожиданный расход переживёшь, а вот потеря дохода уже опасна: запаса хватит на месяц.',
  3: 'Если доход пропадёт, продержишься несколько месяцев и успеешь найти выход.',
  6: 'Полгода без дохода: можно спокойно искать работу получше и не бояться крупных трат.',
  12: 'Год без дохода: деньги работают на тебя, а выбор — не про выживание.',
};

/** Цели запаса выше текущего: те, до которых ещё не дотянул (при ровно столько же месяцев цель достигнута). */
export const higherTargets = (coverMonths: number): ReserveTarget[] => RESERVE_TARGETS.filter((t) => coverMonths < t);

export interface Reserve {
  /** На сколько месяцев хватит денег без дохода: деньги сразу ÷ сколько уходит в месяц, с одним знаком после запятой. */
  coverMonths: number;
  /** Деньги, которые можно снять сразу. */
  liquid: Money;
  /** Сколько уходит в обычный месяц вместе с платежами по долгам. */
  needMonthly: Money;
  /** Из них обычные траты и платежи по долгам и рассрочкам. */
  usualMonthly: Money;
  obligationsMonthly: Money;
  /** Доля дохода, которая уходит на платежи по долгам и рассрочкам (0…1), null — дохода нет. */
  debtShare: number | null;
  /** Сколько остаётся в месяц в среднем за ближайшие полгода (минус — траты больше дохода). */
  surplusMonthly: Money;
  next: NextReserve | null;
}

export interface NextReserve {
  /** Следующая цель запаса, месяцев. */
  months: ReserveTarget;
  /** Сколько денег нужно и сколько не хватает. */
  target: Money;
  missing: Money;
  /** К какому месяцу при нынешнем темпе; null — не набирается. */
  by: MonthKey | null;
  /** Готовая фраза. */
  text: string;
}

const tg = (m: Money): string => formatKZT((Math.round(m / 100) * 100) as Money);

/**
 * Первый месяц, когда деньги на конец месяца дотянут до `target`, если каждый месяц добавлять ещё `extra` (месяц i прогноза — i добавок).
 * Считается по помесячному прогнозу (D122), а не по среднему остатку: конец стипендии, окончание рассрочек и плановые события видны,
 * поэтому «к январю» не врёт, когда через полгода доход упадёт. Проценты на добавку не считаются — это запас в пользу человека.
 * null — не за срок расчёта.
 */
export function liquidReachMonth(sim: SimResult, target: Money, extra: Money = ZERO): MonthKey | null {
  for (let i = 0; i < sim.months.length; i++) {
    const m = sim.months[i]!;
    if (m.liquidEnd + extra * i >= target) return m.month;
  }
  return null;
}

export function reserveNow(state: AppState, today: IsoDate): Reserve | null {
  if (!state.imported) return null;
  const o = buildOverview(state, today);
  const liquid = Math.max(0, o.capital.liquidNow) as Money;
  const usualMonthly = o.spend.usualMonthly;
  const obligationsMonthly = o.spend.obligationsMonthly;
  const needMonthly = add(usualMonthly, obligationsMonthly);
  if (needMonthly <= 0) return null;
  const coverMonths = Math.floor((liquid * 10) / needMonthly) / 10;
  const income = sum(state.settings.incomeSchedule.filter((x) => (!x.start || x.start <= today) && (!x.end || x.end > today)).map((x) => x.amount));
  const debtShare = income > 0 ? Math.min(1, obligationsMonthly / income) : null;
  const sim = baseForecast(state, today, 60);
  const flows = sim.months.slice(1, 7).map((m) => m.income - m.expenses - m.obligations - m.events);
  const surplusMonthly = (flows.length ? mulDiv(sum(flows as Money[]), 1, flows.length) : ZERO) as Money;

  let next: NextReserve | null = null;
  const nextMonths = higherTargets(coverMonths)[0];
  if (nextMonths !== undefined) {
    const target = mulDiv(needMonthly, nextMonths, 1);
    const missing = Math.max(0, target - liquid) as Money;
    next = {
      months: nextMonths,
      target,
      missing,
      by: liquidReachMonth(sim, target),
      text: `До запаса на ${nextMonths} мес. нужно ${nextMonths} × ${tg(needMonthly)} = ${tg(target)}. Не хватает ≈ ${tg(missing)}.${surplusMonthly <= 0 ? ` Сейчас траты не меньше доходов (на ≈ ${tg((-surplusMonthly) as Money)} в месяц больше) — пока так, запас не растёт.` : ''}`,
    };
  }
  return { coverMonths, liquid, needMonthly, usualMonthly, obligationsMonthly, debtShare, surplusMonthly, next };
}
