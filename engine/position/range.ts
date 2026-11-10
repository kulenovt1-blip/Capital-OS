/**
 * Диапазон `G` при неизвестных данных и правило показа ориентира (T06; спец. 5.2, решение владельца 6).
 *
 * Результаты — подстановка границ интервалов неизвестного в обычную формулу (направления → среднее геометрическое → ограничители):
 *  low   — все неизвестные на нижней границе, неизвестные ограничители «возможно сработали» (применяются);
 *  high  — все на верхней границе, неизвестные ограничители не применяются;
 *  point — ориентир: середины интервалов, неизвестные ограничители не применяются. Это ориентир, а не «наиболее вероятный результат» и не нижняя граница.
 * Ориентир показывается на главном экране, только если ширина диапазона `G` не больше RANGE_MAX_WIDTH очков и диапазон охватывает не более RANGE_MAX_LEVELS уровней.
 * Обе константы — гипотезы, пересматриваются на реальных данных (T19).
 * Достоверность — отдельное число (confidence.ts), в диапазон и ориентир не входит.
 */
import { directionScore } from './directions';
import { DIRECTIONS, type Indicators } from './indicators';
import { aggregateG, type LimitId, type LimitStates } from './limits';
import { LEVEL_BOUNDS, levelBandOf } from './level';
import { fillHigh, fillLow, fillMiddle, type Bounds } from './unknown';

/** Наибольшая ширина диапазона `G` (очков), при которой ориентир показывается (решение владельца 6; H). */
export const RANGE_MAX_WIDTH = 20;
/** Наибольшее число соседних уровней, которое может охватывать диапазон, чтобы ориентир показывался (H). */
export const RANGE_MAX_LEVELS = 2;
// Границы уровней и полоса по одному `G` определены в level.ts (T07); здесь — для обратной совместимости импортов.
export { LEVEL_BOUNDS, levelBandOf };

export interface PositionRange {
  low: number;
  high: number;
  point: number;
  width: number;
  levelLow: number;
  levelHigh: number;
  levelPoint: number;
  /** Сколько уровней охватывает диапазон (1 — один уровень). */
  levelsCovered: number;
  /** Ограничители, срезавшие нижнюю границу. */
  firedLow: LimitId[];
  /** Показывать ориентир на главном экране. */
  showPoint: boolean;
}

export const canShowPoint = (width: number, levelsCovered: number): boolean => width <= RANGE_MAX_WIDTH && levelsCovered <= RANGE_MAX_LEVELS;

/** Хотя бы одно направление должно быть оценено; иначе диапазона нет (null). */
export function positionRange(ind: Indicators, bounds: Bounds, states: LimitStates): PositionRange | null {
  const g = (filled: Indicators, mode: 'low' | 'high' | 'point') => {
    const dirs = DIRECTIONS.map((d) => directionScore(filled, d).score).filter((x): x is number => x !== null);
    return aggregateG(dirs, states, mode);
  };
  const low = g(fillLow(ind, bounds), 'low');
  const high = g(fillHigh(ind, bounds), 'high');
  const point = g(fillMiddle(ind, bounds), 'point');
  if (!low || !high || !point) return null;
  const levelLow = levelBandOf(low.g), levelHigh = levelBandOf(high.g);
  const width = high.g - low.g;
  const levelsCovered = levelHigh - levelLow + 1;
  return { low: low.g, high: high.g, point: point.g, width, levelLow, levelHigh, levelPoint: levelBandOf(point.g), levelsCovered, firedLow: low.fired, showPoint: canShowPoint(width, levelsCovered) };
}
