/**
 * Оценка направления и достаточность данных (T06; формулы направлений — T07 использует то же).
 *
 * Оценка направления — взвешенное среднее известных показателей (веса перенормируются). Неизвестное (`null`) в среднее не входит,
 * не применимое (ключа нет) в знаменатель веса не входит.
 * Направление достоверно (спец. 6), если известны ВСЕ применимые обязательные показатели и известная часть веса не меньше 70 % применимого веса.
 * Порог 70 % — рабочая гипотеза, не норма: в интерфейсе так и называется.
 */
import { INDICATOR_WEIGHTS, KEY_INDICATORS, type Direction, type IndicatorId, type Indicators } from './indicators';

/** Доля известного веса, с которой направление достаточно (рабочая гипотеза H, решение владельца v4 №2). */
export const SUFFICIENT_WEIGHT_SHARE = 0.7;

export interface DirectionScore {
  /** Взвешенное среднее известных показателей; null — не известен ни один. */
  score: number | null;
  knownWeight: number;
  totalWeight: number;
  known: number;
  applicable: number;
  /** Все применимые обязательные показатели известны. */
  keysKnown: boolean;
}

export function directionScore(ind: Indicators, d: Direction): DirectionScore {
  const keys = (Object.keys(ind) as IndicatorId[]).filter((k) => k.startsWith(d));
  let sw = 0, sx = 0, kw = 0, tw = 0, nk = 0;
  for (const k of keys) {
    const w = INDICATOR_WEIGHTS[k];
    tw += w;
    const x = ind[k];
    if (x !== null && x !== undefined) { sw += w; sx += w * x; kw += w; nk++; }
  }
  const keysKnown = KEY_INDICATORS[d].filter((k) => k in ind).every((k) => ind[k] !== null && ind[k] !== undefined);
  return { score: sw > 0 ? sx / sw : null, knownWeight: kw, totalWeight: tw, known: nk, applicable: keys.length, keysKnown };
}

export function isDirectionSufficient(o: DirectionScore, share = SUFFICIENT_WEIGHT_SHARE): boolean {
  if (o.score === null) return false;
  return o.keysKnown && o.knownWeight / o.totalWeight >= share;
}
