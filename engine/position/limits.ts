/**
 * Ограничители критических рисков и общий результат `G` (T06 нужны для диапазона; T07 строит на них уровни).
 *
 * Ограничителей ровно три (спец. 9, решение владельца v4 №5; «долговая спираль» снята — это диагностика, не ограничитель):
 *  cover1 — «нет запаса»: доступные деньги (за вычетом долга людям) меньше 1 месяца необходимых расходов → `G` не выше 39;
 *  gap    — «разрыв в прогнозе»: базовый прогноз содержит кассовый разрыв → не выше 59;
 *  cliff  — «обрыв дохода»: ≥ 50 % подтверждённого дохода кончается в ближайшие 6 месяцев и оставшегося дохода плюс запаса хватает меньше чем на 12 месяцев → не выше 59.
 * Состояние ограничителя: 'yes' | 'no' | 'unknown' (проверить нельзя — нет прогноза или расписания). Неизвестный применяется только в нижней границе диапазона.
 *
 * Отличие от пробы (D133/D134): запас в cover1 и в сроке «после обрыва» берётся из чистой ликвидности (минус долг людям), как и N1.
 */
import type { ForecastFacts, IndicatorInputs } from './indicators';

export type LimitId = 'cover1' | 'gap' | 'cliff';
export const LIMIT_IDS: readonly LimitId[] = ['cover1', 'gap', 'cliff'];
/** Предел `G` при сработавшем ограничителе (H). */
export const LIMIT_VALUES: Readonly<Record<LimitId, number>> = { cover1: 39, gap: 59, cliff: 59 };
export type LimitState = 'yes' | 'no' | 'unknown';
export type LimitStates = Record<LimitId, LimitState>;

/** Доля дохода, кончающегося за 6 месяцев, начиная с которой это «обрыв» (H). */
export const CLIFF_INCOME_SHARE = 0.5;
/** Сколько месяцев должно хватать денег после обрыва, чтобы ограничитель не сработал (H). */
export const CLIFF_SURVIVAL_MONTHS = 12;
/** Единица «не кончается никогда» для срока выживания без дефицита. */
const NO_DEFICIT_MONTHS = 999;

export function limitStates(inputs: IndicatorInputs, forecast: ForecastFacts): LimitStates {
  const run = forecast.sources.filter((s) => s.status !== 'X').reduce((a, s) => a + s.monthly, 0);
  const ending = forecast.sources.filter((s) => s.endsWithin6m).reduce((a, s) => a + s.monthly, 0);
  const cliffShare = run > 0 ? ending / run : 0;
  const deficitAfter = inputs.needLifestyle - (run - ending);
  const survival = deficitAfter > 0 ? inputs.netLiquid / deficitAfter : NO_DEFICIT_MONTHS;
  return {
    // нет необходимых расходов (не отмечено «обязательно» или трат нет вовсе) — запас в месяцах не определён, а не равен нулю (С1, D158)
    cover1: inputs.needEssential <= 0 ? 'unknown' : inputs.reserveEssentialMonths < 1 ? 'yes' : 'no',
    gap: forecast.hasGap ? 'yes' : 'no',
    cliff: cliffShare >= CLIFF_INCOME_SHARE && survival < CLIFF_SURVIVAL_MONTHS ? 'yes' : 'no',
  };
}
/** Состояния, когда прогноза или расписания нет: gap и cliff проверить нельзя. */
export const withoutForecast = (s: LimitStates): LimitStates => ({ ...s, gap: 'unknown', cliff: 'unknown' });

/** Среднее геометрическое направлений; каждое не ниже 1, чтобы нулевое направление не обнуляло всё (как в пробе). */
export const geometricMean = (xs: readonly number[]): number => Math.pow(xs.reduce((a, x) => a * Math.max(x, 1), 1), 1 / xs.length);

export type AggregateMode = 'low' | 'high' | 'point';
export interface Aggregate { g: number; fired: LimitId[] }

/**
 * `G` по известным направлениям. Ограничители режут сверху; 'unknown' — «возможно сработает»: в нижней границе применяется, в верхней и в ориентире нет.
 * Нет ни одного направления → null (оценить нечем).
 */
export function aggregateG(directions: readonly number[], states: LimitStates, mode: AggregateMode): Aggregate | null {
  if (!directions.length) return null;
  let g = geometricMean(directions);
  const fired: LimitId[] = [];
  for (const id of LIMIT_IDS) {
    const st = states[id];
    const applies = st === 'yes' || (st === 'unknown' && mode === 'low');
    if (applies && g > LIMIT_VALUES[id]) { fired.push(id); g = LIMIT_VALUES[id]; }
  }
  return { g, fired };
}
