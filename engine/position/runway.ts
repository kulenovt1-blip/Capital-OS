/**
 * T08 «Положение» v4: runway — сколько месяцев хватит доступных ресурсов при текущем отрицательном потоке (спец. 9A).
 *
 * Это диагностика: в `G` и уровень не входит, срок не «выкупает» дефицит. Инвариант «дефицит исключает L4»
 * обеспечивается самим условием L4 и проверяется тестом на выборках (tests/unit/position-runway.test.ts).
 * Не путать с `monthsWithoutIncome` из simple.ts (старый «запас прочности»: прогноз без доходов до кассового разрыва).
 * Единицы: тенге (не тиыны), как в indicators.ts.
 */
import type { AppState } from '../state';
import type { IsoDate } from '../date';
import { buildPositionSeries, type PositionSeries } from './series';
import { computeIndicators, medianOf } from './indicators';

/** Дальше этого срока не считаем: 50 лет. Срок, равный горизонту, означает «больше 50 лет». */
export const RUNWAY_HORIZON_MONTHS = 600;
/** Сколько последних месяцев даёт медиану свободного остатка. */
export const RUNWAY_MEDIAN_MONTHS = 3;
/** Инфляция расходов в сценарии «дорожают», в год. */
export const RUNWAY_INFLATION_YEARLY = 0.1;
const INFLATION_MONTHLY = Math.pow(1 + RUNWAY_INFLATION_YEARLY, 1 / 12) - 1;

export type RunwayScenarioId = 'cut10' | 'cut20' | 'essentialOnly' | 'incomeMinus20' | 'inflation10';
export const RUNWAY_SCENARIOS: readonly { id: RunwayScenarioId; name: string }[] = [
  { id: 'cut10', name: 'расходы −10 %' },
  { id: 'cut20', name: 'расходы −20 %' },
  { id: 'essentialOnly', name: 'только необходимое' },
  { id: 'incomeMinus20', name: 'доход −20 %' },
  { id: 'inflation10', name: 'расходы дорожают на 10 % в год' },
];

export interface RunwayScenario { id: RunwayScenarioId; name: string; months: number | null }
export interface Runway {
  /** deficit — медиана остатка за 3 месяца отрицательна; no_deficit — нет; no_data — меньше трёх полных месяцев или нет операций. */
  status: 'deficit' | 'no_deficit' | 'no_data';
  /** Дефицит в месяц, тенге (0, если дефицита нет). */
  deficit: number;
  /** Доступные ресурсы, тенге: ликвидные минус долг людям, не ниже нуля. */
  resources: number;
  /** Срок в месяцах; null — дефицита нет или данных мало; 600 — больше 50 лет. */
  months: number | null;
  scenarios: RunwayScenario[];
}

/** Месяцев до исчерпания `avail` при доходе `inc`, расходах `ex` и росте расходов `g` в месяц; null — дальше горизонта. */
function depletion(avail: number, inc: number, ex: number, g: number): number | null {
  let bal = avail; let e = ex;
  if (inc - e >= 0 && g === 0) return null;
  for (let k = 1; k <= RUNWAY_HORIZON_MONTHS; k++) {
    bal += inc - e;
    if (bal < 0) return k - 1 + (bal + (e - inc)) / (e - inc);
    e *= 1 + g;
  }
  return null;
}

const noData = (resources: number): Runway => ({ status: 'no_data', deficit: 0, resources, months: null, scenarios: RUNWAY_SCENARIOS.map((s) => ({ ...s, months: null })) });

/** `needEssential` — необходимые траты в месяц (тенге), как в `IndicatorInputs`. */
export function computeRunway(series: PositionSeries, needEssential: number): Runway {
  const resources = Math.max(0, series.netLiquid / 100);
  if (!series.hasData || series.free.length < RUNWAY_MEDIAN_MONTHS) return noData(resources);
  const free3 = medianOf(series.free.slice(-RUNWAY_MEDIAN_MONTHS).map((x) => x / 100));
  const inc3 = medianOf(series.income.slice(-RUNWAY_MEDIAN_MONTHS).map((x) => x / 100));
  const deficit = Math.max(0, -free3);
  const ex3 = inc3 - free3; // расходы, согласованные с медианой остатка
  const months = deficit > 0 ? (resources <= 0 ? 0 : depletion(resources, inc3, ex3, 0) ?? RUNWAY_HORIZON_MONTHS) : null;
  const scen = (inc: number, ex: number, g = 0): number | null =>
    deficit > 0 || inc - ex < 0 ? depletion(resources, inc, ex, g) ?? (inc - ex < 0 ? RUNWAY_HORIZON_MONTHS : null) : null;
  const by: Record<RunwayScenarioId, number | null> = {
    cut10: scen(inc3, ex3 * 0.9),
    cut20: scen(inc3, ex3 * 0.8),
    essentialOnly: scen(inc3, Math.min(ex3, needEssential)),
    incomeMinus20: scen(inc3 * 0.8, ex3),
    inflation10: scen(inc3, ex3, INFLATION_MONTHLY),
  };
  return {
    status: deficit > 0 ? 'deficit' : 'no_deficit',
    deficit, resources, months,
    scenarios: RUNWAY_SCENARIOS.map((s) => ({ ...s, months: by[s.id] })),
  };
}

/** Runway по состоянию бэкапа. */
export function runwayOfState(state: AppState, today: IsoDate): Runway {
  const series = buildPositionSeries(state, today);
  const rep = computeIndicators(state, today, series);
  return computeRunway(series, rep.inputs?.needEssential ?? 0);
}
