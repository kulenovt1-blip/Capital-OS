/**
 * Достоверность данных (T06; спец. 5.2, п. 5): `min(1; месяцев с данными ÷ 12) × (1 − доля непроверенных трат)`.
 * Отдельная строка на экране: в диапазон `G` и ориентир не входит. Меньше CONFIDENCE_PRELIMINARY_BELOW — уровень помечается «предварительно».
 */
import type { IsoDate } from '../date';
import type { AppState } from '../state';
import { buildOverview } from '../overview';

/** Достоверность, ниже которой уровень «предварительный» (H). */
export const CONFIDENCE_PRELIMINARY_BELOW = 0.5;
/** Сколько месяцев данных считается полной историей. */
export const CONFIDENCE_FULL_MONTHS = 12;

export interface ConfidenceInput { monthsOfData: number; usualMonthly: number; uncheckedMonthly: number }

export function confidenceFrom(i: ConfidenceInput): number {
  const unchecked = i.usualMonthly > 0 ? Math.min(1, Math.max(0, i.uncheckedMonthly / i.usualMonthly)) : 0;
  return Math.min(1, Math.max(0, i.monthsOfData) / CONFIDENCE_FULL_MONTHS) * (1 - unchecked);
}

export function confidenceOf(state: AppState, today: IsoDate): number {
  const data = state.imported;
  if (!data || !data.operations.length) return 0;
  const o = buildOverview(state, today);
  return confidenceFrom({
    monthsOfData: new Set(data.operations.map((x) => x.date.slice(0, 7))).size,
    usualMonthly: o.spend.usualMonthly, uncheckedMonthly: o.spend.uncheckedMonthly,
  });
}

export const isPreliminary = (confidence: number): boolean => confidence < CONFIDENCE_PRELIMINARY_BELOW;
