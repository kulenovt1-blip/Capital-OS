/**
 * «Из А в Б» (D117): человек говорит, где хочет быть («Подушка набрана к декабрю 2026»), приложение считает, чего не хватает,
 * и какими рычагами это закрыть — и что каждый рычаг даёт. Обратный расчёт к «Планирую…»: там задаёшь событие и смотришь результат,
 * здесь задаёшь результат и ищешь событие. Цель — любая активная цель (подушка тоже) и месяц. Состояние не меняется.
 *
 * Рычаги:
 *  1. тратить меньше / получать больше — одна и та же сумма в месяц (для денежного потока всё равно), подбирается делением пополам;
 *  2. поставить цель выше в списке — деньги достаются ей раньше, что получат остальные — в `shifts`;
 *  3. деньги в копилках, которые ни за чем не закреплены, — сколько из недостающего они закрывают;
 *  4. сдвинуть срок — когда цель набирается как есть.
 */
import { listOrder } from './ladder';
import { monthsBetween, type IsoDate, type MonthKey } from './date';
import { mulDiv, pos, sub, ZERO, type Money } from './money';
import { buildOverview } from './overview';
import { buildSimInput } from './plan';
import { simulate, type SimResult } from './simulate';
import { cutEvent, goalShifts, reorderGoals, unassignedSavings, type GoalShift } from './simple';
import type { AppState } from './state';

export interface RouteLevers {
  /** Тратить меньше или получать больше на столько в месяц, с первого числа следующего месяца. null — даже полной отменой обычных трат не успеть. */
  perMonth: Money | null;
  /** Какая это доля обычных месячных трат (0…1), null если трат нет. */
  perMonthShareOfSpend: number | null;
  /** Поставить цель на первое место в списке. null — уже первая или не помогает. */
  reorder: { reaches: boolean; month: MonthKey | null; shifts: GoalShift[] } | null;
  /** Свободные деньги в копилках и сколько из недостающего они закрывают. */
  freeSavings: { available: Money; covers: Money };
}

export interface RoutePlan {
  goalId: string;
  title: string;
  target: Money;
  by: MonthKey;
  /** Сколько по прогнозу будет к этому месяцу и сколько не хватает (0 — успеваешь). */
  progressAtBy: Money;
  missing: Money;
  /** Когда цель набирается как есть (null — не за срок прогноза). */
  reachMonth: MonthKey | null;
  onTrack: boolean;
  /** Насколько позже срока (месяцев), если не успеваешь и дата известна. */
  lateMonths: number | null;
  levers: RouteLevers;
}

const MAX_HORIZON = 120;

function monthEnd(by: MonthKey): IsoDate {
  return `${by}-28` as IsoDate;
}

/** Первое число следующего месяца. */
function nextMonthStart(today: IsoDate): IsoDate {
  const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number];
  const n = y * 12 + m;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}-01` as IsoDate;
}

export function planToGoal(state: AppState, today: IsoDate, goalId: string, by: MonthKey): RoutePlan | null {
  if (!state.imported) return null;
  const o = buildOverview(state, today);
  const goal = o.goals.find((g) => g.id === goalId);
  if (!goal || goal.status !== 'active' || goal.folder) return null;
  const toBy = monthsBetween(today, monthEnd(by));
  if (toBy < 1) return null;
  const horizon = Math.min(MAX_HORIZON, Math.max(36, toBy + 1));
  const { input } = buildSimInput(state, today);
  const run = (events: typeof input.events = []): SimResult => simulate({ ...input, events: [...input.events, ...events], horizonMonths: horizon });
  const base = run();
  const target = base.months[0] ? (input.goals.find((g) => g.id === goalId)?.targetMin ?? goal.targetMin) : goal.targetMin;
  const hit = (r: SimResult): boolean => {
    const d = r.goalDates[goalId] ?? null;
    return d !== null && d <= by;
  };
  const row = base.months.find((m) => m.month === by) ?? base.months[base.months.length - 1];
  const progressAtBy = (row?.goalProgress[goalId] ?? ZERO) as Money;
  const reachMonth = base.goalDates[goalId] ?? null;
  const onTrack = hit(base);
  const missing = onTrack ? ZERO : (pos(sub(target, progressAtBy)) as Money);
  const lateMonths = !onTrack && reachMonth ? (Number(reachMonth.slice(0, 4)) - Number(by.slice(0, 4))) * 12 + Number(reachMonth.slice(5, 7)) - Number(by.slice(5, 7)) : null;

  // 1. сколько в месяц: деление пополам по сумме (шаг 500 ₸), потолок — обычные месячные траты
  const from = nextMonthStart(today);
  const spend = o.spend.usualMonthly;
  let perMonth: Money | null = null;
  if (onTrack) perMonth = ZERO;
  else if (spend > 0) {
    const works = (a: number) => hit(run([cutEvent('route', from, a as Money)]));
    const STEP = 50_000; // 500 ₸ в тиынах
    let lo = 0;
    let hi = Math.ceil(spend / STEP);
    if (works(hi * STEP)) {
      while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (works(mid * STEP)) hi = mid;
        else lo = mid;
      }
      perMonth = (hi * STEP) as Money;
    }
  }

  // 2. поставить цель первой
  let reorder: RouteLevers['reorder'] = null;
  const ordered = listOrder(state.goals).filter((g) => g.status === 'active' && !g.folder);
  if (ordered.length > 1 && ordered[0]!.id !== goalId && !onTrack) {
    const ids = [goalId, ...ordered.filter((g) => g.id !== goalId).map((g) => g.id)];
    const moved = { ...state, goals: reorderGoals(state.goals, ids) };
    const mi = buildSimInput(moved, today).input;
    const mr = simulate({ ...mi, horizonMonths: horizon });
    reorder = { reaches: hit(mr), month: mr.goalDates[goalId] ?? null, shifts: goalShifts(state, today, base, mr).filter((x) => x.goalId !== goalId) };
    if (reorder.month === reachMonth) reorder = null;
  }

  const available = unassignedSavings(o);
  const freeSavings = { available, covers: (available < missing ? available : missing) as Money };
  return {
    goalId,
    title: goal.role === 'safety' && goal.parentId === undefined ? 'Подушка' : goal.title,
    target: target as Money,
    by,
    progressAtBy,
    missing,
    reachMonth,
    onTrack,
    lateMonths,
    levers: { perMonth, perMonthShareOfSpend: perMonth !== null && spend > 0 ? perMonth / spend : null, reorder, freeSavings },
  };
}
