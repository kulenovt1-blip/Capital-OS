/**
 * «Положение» v4 (T11): модель экрана — всё, что нужно показать, одной чистой функцией от состояния и даты.
 * Экран только рисует эту модель и ничего не считает сам: так каждое число на нём можно проверить тестом без интерфейса.
 * Математика уровней, диапазона, runway, спирали и независимости не менялась — здесь они собираются вместе и получают человеческие названия.
 */
import type { AppState } from '../state';
import { addDays, type IsoDate } from '../date';
import { buildOverview } from '../overview';
import { liquidOn } from '../ledger';
import { buildPositionSeries } from './series';
import {
  DIRECTIONS, INDICATOR_IDS, MIN_HISTORY_VECTOR, computeIndicators, type Direction, type IndicatorId, type IndicatorInputs,
} from './indicators';
import { directionScore, isDirectionSufficient } from './directions';
import { limitStates, withoutForecast, type LimitId } from './limits';
import { LEVEL_NAMES, levelFromIndicators, type BoundaryId } from './level';
import { positionRange, type PositionRange } from './range';
import { boundsContext, historyBounds, scheduleBounds, type Bounds } from './unknown';
import { computeRunway, type Runway } from './runway';
import { spiralSigns, type SpiralSigns } from './spiral';
import { confidenceOf, isPreliminary } from './confidence';
import { INDEPENDENCE_TEXTS, L5_NAME, desiredScenarioOf, independenceOfState, levelWithIndependence, type DesiredScenario, type IndependenceResult } from './independence';
import { essentialMarkupMissing } from './inputs';

export const DIRECTION_NAMES: Readonly<Record<Direction, string>> = { N: 'Здесь и сейчас', V: 'Вектор', F: 'Безопасность будущего' };
export const DIRECTION_QUESTIONS: Readonly<Record<Direction, string>> = { N: 'Каково положение сегодня?', V: 'Как оно менялось за полгода?', F: 'Выдержит ли оно будущее и удар?' };

/** Названия показателей простыми словами (на экране коды N1, V2 и т. п. не показываются). */
export const INDICATOR_LABELS: Readonly<Record<IndicatorId, string>> = {
  N1: 'Запас денег', N2: 'Норма сбережений', N3: 'Долговая нагрузка', N4: 'Капитал',
  V1: 'Рост капитала', V2: 'Динамика остатка в месяц', V3: 'Платежи по долгу против графика', V4: 'Привычка откладывать',
  F1: 'Запас в плохой период', F2: 'Покрытие необходимого доходом', F3: 'Риск потерять главный доход', F4: 'Будущая норма сбережений',
};

export const LIMIT_TEXTS: Readonly<Record<LimitId, string>> = {
  cover1: 'денег меньше чем на месяц необходимых расходов',
  gap: 'в прогнозе на год есть кассовый разрыв',
  cliff: 'больше половины дохода скоро кончится, а накоплений на этот случай мало',
};

// ───────────────────────── предупреждение «L4, но…» ─────────────────────────

export const L4_WARN_RESERVE_MONTHS = 6;
export const L4_WARN_TROUGH_MONTHS = 3;
export const L4_WARN_BLOCKED_SHARE = 0.5;

export interface L4Warning { id: 'reserve' | 'trough' | 'blocked'; text: string }

const nf = (x: number, d = 1): string => x.toFixed(d).replace('.', ',');

/**
 * Три условия (D128, утверждено 05.11): запас по необходимым расходам < 6 мес.; минимум запаса по неблагоприятному прогнозу < 3 необходимых месяцев;
 * больше 50 % капитала недоступно за 30 дней. Каждое объясняется числом. Уровень предупреждение не меняет.
 */
export function l4Warnings(i: Pick<IndicatorInputs, 'reserveEssentialMonths' | 'needEssential' | 'troughNet'>, blockedShare: number): L4Warning[] {
  const out: L4Warning[] = [];
  if (i.reserveEssentialMonths < L4_WARN_RESERVE_MONTHS) out.push({ id: 'reserve', text: `Запас по необходимым расходам — ${nf(i.reserveEssentialMonths)} мес., это меньше ${L4_WARN_RESERVE_MONTHS}` });
  if (i.needEssential > 0 && i.troughNet / i.needEssential < L4_WARN_TROUGH_MONTHS) out.push({ id: 'trough', text: `В неблагоприятном прогнозе запас опускается до ${nf(Math.max(0, i.troughNet) / i.needEssential)} мес. необходимых расходов, это меньше ${L4_WARN_TROUGH_MONTHS}` });
  if (blockedShare > L4_WARN_BLOCKED_SHARE) out.push({ id: 'blocked', text: `${Math.round(blockedShare * 100)} % капитала нельзя снять в ближайшие 30 дней` });
  return out;
}

// ───────────────────────── модель ─────────────────────────

export interface DirectionView {
  id: Direction;
  name: string;
  question: string;
  /** 0–100; null — оценить нечем. */
  score: number | null;
  /** Достаточно данных (обязательные показатели известны и известно не менее 70 % веса). */
  reliable: boolean;
  indicators: { id: IndicatorId; label: string; score: number | null }[];
}

export interface PositionView {
  /** no_data — в бэкапе нет операций, показывать нечего, кроме подсказки. */
  status: 'no_data' | 'ok';
  level: number | null;
  levelName: string | null;
  /** score — по оценке `G`; independence — L5 по независимости; none — оценить нечем. */
  basis: 'score' | 'independence' | 'none';
  /** `G` со срезом ограничителей. */
  g: number | null;
  directions: DirectionView[];
  /** Слабое место: самое слабое направление и самый слабый показатель в нём. */
  weak: { direction: Direction; directionName: string; indicator: { id: IndicatorId; label: string; score: number } | null } | null;
  /** Диапазон по неизвестному; null — неизвестного нет или оценить нечем. */
  range: PositionRange | null;
  /** Подписи уровней краёв диапазона (по полной функции уровня, D139). */
  rangeLevels: { low: string; high: string } | null;
  limitsFired: { id: LimitId; text: string }[];
  /** До следующего уровня: сколько очков не хватает (null — нечего показывать). */
  next: { level: number; name: string; shortfall: number } | null;
  onBorder: BoundaryId[];
  l4Unconfirmed: boolean;
  /** Только при L4. */
  l4Warnings: L4Warning[];
  /** Две цифры и строка про срок: «Всего капитал» и «Деньги, которые можно потратить» (D138). */
  money: { total: number; spendable: number; instant: number; blockedShare: number; reserveEssentialMonths: number; reserveLifestyleMonths: number };
  runway: Runway;
  spiral: SpiralSigns;
  /** Просроченные платежи по графику (отдельная пометка). */
  overdue: number;
  /** 0–1; ниже порога — уровень предварительный. */
  confidence: number;
  preliminary: boolean;
  independence: IndependenceResult;
  independenceNote: string | null;
  independenceLine: string | null;
  essentialMissing: boolean;
  /** Личный сценарий «при желаемых расходах (гипотеза)»; null — сумма не задана. Основные поля от него не зависят. */
  desired: DesiredScenario | null;
}

const emptyRunway = (): Runway => ({ status: 'no_data', deficit: 0, resources: 0, months: null, scenarios: [] });
const NO_SPIRAL: SpiralSigns = { status: 'no_data', overdue: null, growth: null, borrowToPay: null, count: 0, spiral: false, overdueCount: 0, growthMonths: null, borrowToPayMonths: null };

/** Интервалы неизвестного по реальным данным: короткая история и отсутствие расписания доходов. Остальное неизвестное — вся шкала 0–100. */
function actualBounds(ctx: ReturnType<typeof boundsContext>, histMonths: number, scheduleKnown: boolean): Bounds {
  return { ...(histMonths < MIN_HISTORY_VECTOR ? historyBounds(ctx, histMonths) : {}), ...(scheduleKnown ? {} : scheduleBounds(ctx)) };
}

export function positionViewOf(state: AppState, today: IsoDate): PositionView {
  const series = buildPositionSeries(state, today);
  const overview = buildOverview(state, today);
  const essentialMissing = essentialMarkupMissing(overview);
  const independence = independenceOfState(state, today);
  if (!series.hasData) {
    return {
      status: 'no_data', level: null, levelName: null, basis: 'none', g: null, directions: [], weak: null, range: null, rangeLevels: null, limitsFired: [], next: null,
      onBorder: [], l4Unconfirmed: false, l4Warnings: [], money: { total: 0, spendable: 0, instant: 0, blockedShare: 0, reserveEssentialMonths: 0, reserveLifestyleMonths: 0 },
      runway: emptyRunway(), spiral: NO_SPIRAL, overdue: 0, confidence: 0, preliminary: true, independence, independenceNote: null,
      independenceLine: levelWithIndependence(null, independence).independenceLine ?? null, essentialMissing, desired: null,
    };
  }

  const report = computeIndicators(state, today, series);
  const base = levelFromIndicators(report);
  const fin = levelWithIndependence(base, independence);
  const inputs = report.inputs!;
  const cap = overview.capital;

  const directions: DirectionView[] = DIRECTIONS.map((d) => {
    const ds = directionScore(report.values, d);
    return {
      id: d, name: DIRECTION_NAMES[d], question: DIRECTION_QUESTIONS[d], score: ds.score, reliable: isDirectionSufficient(ds),
      indicators: INDICATOR_IDS.filter((id) => id.startsWith(d) && id in report.values).map((id) => ({ id, label: INDICATOR_LABELS[id], score: (report.values[id] as number | null | undefined) ?? null })),
    };
  });

  let weak: PositionView['weak'] = null;
  const weakestId = base?.result.l4.weakest ?? null;
  if (weakestId) {
    const dv = directions.find((x) => x.id === weakestId)!;
    const known = dv.indicators.filter((x): x is { id: IndicatorId; label: string; score: number } => x.score !== null);
    const low = known.length ? known.reduce((a, b) => (b.score < a.score ? b : a)) : null;
    weak = { direction: weakestId, directionName: dv.name, indicator: low };
  }

  // диапазон: только если что-то неизвестно
  let range: PositionRange | null = null;
  let rangeLevels: PositionView['rangeLevels'] = null;
  if (base && Object.values(report.values).some((v) => v === null)) {
    const scheduleKnown = report.values.F2 !== null;
    const baseStates = limitStates(inputs, report.forecast!);
    const states = scheduleKnown ? baseStates : withoutForecast(baseStates);
    range = positionRange(report.values, actualBounds(boundsContext(series, inputs), series.histMonths, scheduleKnown), states);
    if (range) rangeLevels = { low: LEVEL_NAMES[Math.min(range.levelLow, 4) as 1 | 2 | 3 | 4], high: LEVEL_NAMES[Math.min(range.levelHigh, 4) as 1 | 2 | 3 | 4] };
  }

  const blockedShare = cap.gross > 0 ? Math.max(0, 1 - liquidOn(cap, addDays(today, 30)) / cap.gross) : 0;
  const level = fin.level;
  const shortfall = base?.result.shortfallToNext ?? null;
  const next = base && level !== null && level <= 3 && shortfall !== null ? { level: level + 1, name: LEVEL_NAMES[(level + 1) as 2 | 3 | 4], shortfall } : null;
  const confidence = confidenceOf(state, today);
  const spiral = spiralSigns(series);
  const spendable = Math.max(0, liquidOn(cap, addDays(today, 30)) - cap.liabilities.payablesFromOps);

  return {
    status: 'ok', level, levelName: fin.name, basis: fin.basis, g: base?.g ?? null, directions, weak, range, rangeLevels,
    limitsFired: (base?.fired ?? []).map((id) => ({ id, text: LIMIT_TEXTS[id] })),
    next, onBorder: base?.result.onBorder ?? [], l4Unconfirmed: base?.result.l4Unconfirmed ?? false,
    l4Warnings: level === 4 ? l4Warnings(inputs, blockedShare) : [],
    money: { total: cap.net / 100, spendable: spendable / 100, instant: series.liquidNow / 100, blockedShare, reserveEssentialMonths: inputs.reserveEssentialMonths, reserveLifestyleMonths: inputs.reserveLifestyleMonths },
    runway: computeRunway(series, inputs.needEssential), spiral, overdue: spiral.overdueCount,
    confidence, preliminary: isPreliminary(confidence),
    independence, independenceNote: fin.note ?? null, independenceLine: fin.independenceLine ?? null, essentialMissing, desired: desiredScenarioOf(state, today),
  };
}

export { INDEPENDENCE_TEXTS, L5_NAME };
