/**
 * Уровень положения L1–L4 (T07; спец. 7.2, решения владельца 3 и 7).
 *
 * Шкала по `G` (рабочая гипотеза H): L1 — `G` < 20; L2 — 20 ≤ `G` < 40; L3 — 40 ≤ `G`, условия L4 не выполнены.
 * L4 «Безопасность» — одновременно: `G` ≥ 75, каждое направление ≥ 60, не сработал ни один ограничитель, все три направления достоверны.
 * Если всё, кроме достоверности, выполнено, уровень L3 и флаг `l4Unconfirmed` («L4 не подтверждён»).
 * L5 — отдельная ветка независимости (T10), здесь её нет.
 *
 * Уровень — чистая функция актуальных данных: гистерезиса нет. Запас до границы показывается всегда; пометка «на границе» —
 * когда запас до любой границы меньше BORDER_MARGIN очка в любую сторону. Пометка уровень не меняет.
 * Запас до L4 = min(`G` − 75; минимальное направление − 60); `G` здесь уже со срезом ограничителей.
 */
import { directionScore, isDirectionSufficient, type DirectionScore } from './directions';
import { DIRECTIONS, type Direction, type IndicatorsReport } from './indicators';
import { aggregateG, limitStates, withoutForecast, type LimitId } from './limits';

export type Level = 1 | 2 | 3 | 4;
export const LEVEL_NAMES: Readonly<Record<Level, string>> = { 1: 'Выживание', 2: 'Нестабильность', 3: 'Стабильность', 4: 'Безопасность' };
/** Границы L2, L3, L4 по `G` (H). */
export const LEVEL_BOUNDS = [20, 40, 75] as const;
/** Наименьшее значение каждого направления для L4 (H). */
export const L4_DIRECTION_MIN = 60;
/** Запас до границы (очков), меньше которого уровень помечается «на границе» (решение владельца 7; H). */
export const BORDER_MARGIN = 1;

/** Полоса по одному `G` (1–4) без условий L4 по направлениям — для оценки близости границ диапазона (T06). */
export const levelBandOf = (g: number): number => 1 + LEVEL_BOUNDS.filter((t) => g >= t).length;

export type BoundaryId = 'L1/L2' | 'L2/L3' | 'L3/L4';
export interface BoundaryMargin { id: BoundaryId; margin: number }

export interface LevelInput {
  /** `G` после среза ограничителей. */
  g: number;
  /** Оценки направлений; null — не оценено ни одним показателем. */
  directions: Readonly<Record<Direction, number | null>>;
  /** Направление достоверно (обязательные показатели известны и известно не менее 70 % веса). */
  reliable: Readonly<Record<Direction, boolean>>;
  /** Сработавшие ограничители. */
  fired: readonly LimitId[];
}

/** Из чего складывается условие L4 — для строки «до L4 не хватает…». */
export interface L4Check {
  gOk: boolean;
  /** Направление ≥ 60; null — направление не оценено. */
  directionsOk: Record<Direction, boolean | null>;
  limitsOk: boolean;
  /** Все три направления оценены и достоверны. */
  reliableOk: boolean;
  /** Оценённое направление с наименьшим значением; null — не оценено ни одно. */
  weakest: Direction | null;
}

export interface LevelResult {
  level: Level;
  name: string;
  /** Всё для L4 выполнено, кроме достоверности: показывается L3 с пометкой «L4 не подтверждён». */
  l4Unconfirmed: boolean;
  margins: BoundaryMargin[];
  /** Границы, до которых меньше BORDER_MARGIN очка (в любую сторону). */
  onBorder: BoundaryId[];
  /** Сколько очков не хватает до следующего уровня; null — это L4, либо L4 закрыт не оценкой (ограничитель, достоверность). */
  shortfallToNext: number | null;
  l4: L4Check;
}

export function levelOf(i: LevelInput): LevelResult {
  const known = DIRECTIONS.filter((d) => i.directions[d] !== null && i.directions[d] !== undefined);
  const scoreOf = (d: Direction): number => i.directions[d] as number;
  const minDirection = known.length ? Math.min(...known.map(scoreOf)) : Infinity;
  const l4Margin = Math.min(i.g - LEVEL_BOUNDS[2], minDirection - L4_DIRECTION_MIN);

  const gOk = i.g >= LEVEL_BOUNDS[2];
  const limitsOk = i.fired.length === 0;
  const directionsOk = Object.fromEntries(DIRECTIONS.map((d) => [d, known.includes(d) ? scoreOf(d) >= L4_DIRECTION_MIN : null])) as Record<Direction, boolean | null>;
  const reliableOk = DIRECTIONS.every((d) => known.includes(d) && i.reliable[d]);
  const weakest = known.length ? known.reduce((a, d) => (scoreOf(d) < scoreOf(a) ? d : a)) : null;

  const scoreCandidate = gOk && known.every((d) => scoreOf(d) >= L4_DIRECTION_MIN) && limitsOk;
  const level: Level = scoreCandidate && reliableOk ? 4 : (Math.min(levelBandOf(i.g), 3) as Level);

  const margins: BoundaryMargin[] = [
    { id: 'L1/L2', margin: i.g - LEVEL_BOUNDS[0] },
    { id: 'L2/L3', margin: i.g - LEVEL_BOUNDS[1] },
    { id: 'L3/L4', margin: l4Margin },
  ];
  const shortfallToNext = level === 1 ? LEVEL_BOUNDS[0] - i.g : level === 2 ? LEVEL_BOUNDS[1] - i.g : level === 3 && l4Margin < 0 ? -l4Margin : null;

  return {
    level,
    name: LEVEL_NAMES[level],
    l4Unconfirmed: scoreCandidate && !reliableOk,
    margins,
    onBorder: margins.filter((m) => Math.abs(m.margin) < BORDER_MARGIN).map((m) => m.id),
    shortfallToNext,
    l4: { gOk, directionsOk, limitsOk, reliableOk, weakest },
  };
}

export interface PositionLevel {
  directions: Record<Direction, DirectionScore>;
  g: number;
  fired: LimitId[];
  result: LevelResult;
}

/**
 * Уровень по рассчитанным показателям (ориентир: середины интервалов не нужны — берутся известные показатели).
 * null — оценить нечем: нет данных или ни одного оценённого направления.
 * Если расписания доходов нет (F2 неизвестен), «разрыв в прогнозе» и «обрыв дохода» проверить нельзя и они не применяются.
 */
export function levelFromIndicators(report: IndicatorsReport): PositionLevel | null {
  if (!report.inputs || !report.forecast) return null;
  const directions = Object.fromEntries(DIRECTIONS.map((d) => [d, directionScore(report.values, d)])) as Record<Direction, DirectionScore>;
  const scores = DIRECTIONS.map((d) => directions[d].score).filter((x): x is number => x !== null);
  const base = limitStates(report.inputs, report.forecast);
  const states = report.values.F2 === null ? withoutForecast(base) : base;
  const agg = aggregateG(scores, states, 'point');
  if (!agg) return null;
  const result = levelOf({
    g: agg.g,
    directions: Object.fromEntries(DIRECTIONS.map((d) => [d, directions[d].score])) as Record<Direction, number | null>,
    reliable: Object.fromEntries(DIRECTIONS.map((d) => [d, isDirectionSufficient(directions[d])])) as Record<Direction, boolean>,
    fired: agg.fired,
  });
  return { directions, g: agg.g, fired: agg.fired, result };
}
