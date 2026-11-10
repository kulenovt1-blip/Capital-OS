/**
 * Неизвестное (T06): допустимый интервал [lo, hi] для показателя, которого нет, — по его природе, а не одной константой.
 *
 * Интервал — самые низкое и самое высокое значения, совместимые с тем, что известно (спец. 5.1). Из границ получаются нижняя и верхняя оценки `G`
 * (подстановкой в обычную формулу с ограничителями). Неизвестное само по себе не улучшает и не ухудшает оценку, оно расширяет диапазон.
 *
 * Все коэффициенты (0,2; 0,02; 0,3; 0,15; 0,05; 12 × 1,3) заданы до проверки и не подгонялись (H).
 * Типы неизвестного (`MaskKind`) — те, на которых модель проверена: короткая история (2 и 4 мес.), нет расписания доходов, нет прогноза, долги неизвестны.
 */
import { SERIES_LOOKBACK, type PositionSeries } from './series';
import {
  INDICATOR_IDS, SCALES, SOURCE_LOSS_PROBABILITY, V1_CAPITAL_CAP_MONTHS, V1_MIN_BASE_MONTHS, monthRate, normalize,
  type IndicatorId, type IndicatorInputs, type Indicators,
} from './indicators';

export type MaskKind = 'hist2' | 'hist4' | 'noSched' | 'noForecast' | 'noDebt';
export const MASK_KINDS: readonly MaskKind[] = ['hist2', 'hist4', 'noSched', 'noForecast', 'noDebt'];
/** Какие показатели скрывает каждый тип неизвестного. */
export const MASKS: Readonly<Record<MaskKind, readonly IndicatorId[]>> = {
  hist2: ['N2', 'V1', 'V2', 'V3', 'V4'],
  hist4: ['N2', 'V1', 'V2', 'V3', 'V4'],
  noSched: ['F2', 'F3', 'F4'],
  noForecast: ['F1', 'F2', 'F3', 'F4'],
  noDebt: ['N3', 'V3'],
};
/** Сколько месяцев истории «наблюдено» в типах hist*. */
export const MASK_HISTORY_MONTHS: Readonly<Partial<Record<MaskKind, number>>> = { hist2: 2, hist4: 4 };

/** Допуски (H). */
export const BOUNDS_TUNING = {
  /** N2: запас вокруг наблюдённых долей месяца. */
  savingMargin: 0.2,
  /** V1: запас вокруг роста в долях капитала. */
  growthMargin: 0.02,
  /** V2: запас вокруг тренда в месячных образах жизни. */
  trendMargin: 0.3,
  /** F4: запас вокруг исторических долей. */
  forecastSavingLow: 0.15,
  forecastSavingHigh: 0.05,
  /** F1: 12 месяцев без дохода при расходах ×1,3. */
  noIncomeMonths: 12,
  noIncomeSpendFactor: 1.3,
  /** F2, нижняя граница: доля дохода, засчитанная как подтверждённая (половина объёма с весом нерегулярного 0,4). */
  reliabilityLowShare: 0.2,
  /** F3: самый плохой случай — единственный нерегулярный источник; самый хороший — три равных постоянных. */
  exposureBestSources: 3,
} as const;

export type Bounds = Partial<Record<IndicatorId, readonly [number, number]>>;

/** Числа, из которых строятся интервалы (тенге, ряды — по возрастанию месяцев). */
export interface BoundsContext {
  income: readonly number[];
  expense: readonly number[];
  free: readonly number[];
  netNowConfirmed: number | null;
  /** Капитал подтверждённого слоя h месяцев назад (h = 0…6); null — на эту дату данных нет. */
  netAgoConfirmed: readonly (number | null)[];
  needLifestyle: number;
  needEssential: number;
  netLiquid: number;
  incomeMonthly: number;
  /** Предел знаменателя V1 (для сверки с пробой без правки D — Infinity). */
  v1CapMonths: number;
}

const FULL: readonly [number, number] = [0, 100];
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp100 = (x: number): number => Math.max(0, Math.min(100, x));

export function boundsContext(series: PositionSeries, inputs: IndicatorInputs, v1CapMonths: number = V1_CAPITAL_CAP_MONTHS): BoundsContext {
  const t = (m: number | null): number | null => (m === null ? null : m / 100);
  return {
    income: series.income.map((x) => x / 100), expense: series.expense.map((x) => x / 100), free: series.free.map((x) => x / 100),
    netNowConfirmed: t(series.netConfirmed[0] ?? null), netAgoConfirmed: series.netConfirmed.map(t),
    needLifestyle: inputs.needLifestyle, needEssential: inputs.needEssential, netLiquid: inputs.netLiquid, incomeMonthly: inputs.incomeMonthly, v1CapMonths,
  };
}

/** Интервалы показателей «Вектора» и N2 при истории в h наблюдённых месяцев (h < 7; для N2 — h < 3). */
export function historyBounds(ctx: BoundsContext, h: number): Bounds {
  const b: Bounds = {};
  const inc = ctx.income.slice(-h), fr = ctx.free.slice(-h);
  if (!inc.length) return { N2: FULL, V1: FULL, V2: FULL, V3: FULL, V4: FULL };
  const rates = inc.map((x, i) => monthRate(x, fr[i]!));
  const m = BOUNDS_TUNING;
  b.N2 = [normalize(Math.min(...rates) - m.savingMargin, SCALES.saving), normalize(Math.max(...rates) + m.savingMargin, SCALES.saving)];
  const now = ctx.netNowConfirmed, ago = ctx.netAgoConfirmed[h] ?? null;
  if (now !== null && ago !== null) {
    // рост капитала за h мес. в долях знаменателя V1 (с тем же ограничением D, что в самом показателе), ± допуск
    const g = (now - ago) / h;
    const floor = V1_MIN_BASE_MONTHS * ctx.needLifestyle;
    const denOld = Math.max(Math.abs(ago), floor, 1);
    const denNew = g > 0 && ago > 0 ? Math.min(Math.max(ago, floor), ctx.v1CapMonths * ctx.needLifestyle) : denOld;
    const r = Math.max(g / denOld, g / denNew);
    b.V1 = [normalize(r - m.growthMargin, SCALES.growth), normalize(r + m.growthMargin, SCALES.growth)];
  } else b.V1 = FULL;
  if (h >= 4) {
    const half = h / 2;
    const a = mean(fr.slice(-half)), p = mean(fr.slice(-h, -half));
    const trend = ctx.needLifestyle > 0 ? (a - p) / ctx.needLifestyle : 0;
    b.V2 = [normalize(trend - m.trendMargin, SCALES.flowTrend), normalize(trend + m.trendMargin, SCALES.flowTrend)];
  } else b.V2 = FULL;
  const pos = fr.filter((x) => x > 0).length;
  b.V4 = [(pos / SERIES_LOOKBACK) * 100, ((pos + SERIES_LOOKBACK - h) / SERIES_LOOKBACK) * 100];
  b.V3 = FULL; // отклонение от графика по короткой истории неизвестно (если применимо)
  return b;
}

/** Интервалы F2–F4 без расписания доходов. */
export function scheduleBounds(ctx: BoundsContext): Bounds {
  const m = BOUNDS_TUNING;
  const volRatio = ctx.needEssential > 0 ? ctx.incomeMonthly / ctx.needEssential : 0;
  const n = Math.min(6, ctx.expense.length);
  const rates = ctx.income.slice(-6).map((x, i) => { const e = ctx.expense[ctx.expense.length - n + i]!; return Math.max(x, e) > 0 ? (x - e) / Math.max(x, e) : 0; });
  return {
    F2: [normalize(m.reliabilityLowShare * volRatio, SCALES.reliability), normalize(volRatio, SCALES.reliability)],
    F3: [normalize(1 * SOURCE_LOSS_PROBABILITY.I, SCALES.exposure), normalize((1 / m.exposureBestSources) * SOURCE_LOSS_PROBABILITY.P, SCALES.exposure)],
    F4: rates.length ? [normalize(Math.min(...rates) - m.forecastSavingLow, SCALES.saving), normalize(Math.max(...rates) + m.forecastSavingHigh, SCALES.saving)] : FULL,
  };
}

/** Интервал F1 без прогноза. */
export function reserveBounds(ctx: BoundsContext): Bounds {
  const m = BOUNDS_TUNING;
  const cov = ctx.needEssential > 0 ? ctx.netLiquid / ctx.needEssential : 0;
  const margin = ctx.needEssential > 0 ? Math.max(0, (ctx.incomeMonthly - ctx.needEssential) / ctx.needEssential) : 0;
  return { F1: [normalize(Math.max(0, cov - m.noIncomeMonths * m.noIncomeSpendFactor), SCALES.reserve), normalize(cov + margin, SCALES.reserve)] };
}

/** Интервалы по типу неизвестного. Показатели, о которых тип ничего не говорит, здесь отсутствуют (подставляется вся шкала 0–100). */
export function boundsFor(kind: MaskKind, ctx: BoundsContext): Bounds {
  switch (kind) {
    case 'hist2': case 'hist4': return historyBounds(ctx, MASK_HISTORY_MONTHS[kind]!);
    case 'noSched': return scheduleBounds(ctx);
    case 'noForecast': return { ...scheduleBounds(ctx), ...reserveBounds(ctx) };
    case 'noDebt': return { N3: FULL, V3: FULL };
  }
}

/** Скрывает показатели, которых тип неизвестного лишает; не применимые (нет ключа) остаются не применимыми. */
export function maskIndicators(ind: Indicators, kind: MaskKind): Indicators {
  const out: Indicators = { ...ind };
  for (const k of MASKS[kind]) if (k in ind) out[k] = null;
  return out;
}

/** Подставляет вместо неизвестных значение `pick(id)`; известные и не применимые не трогает. */
export function fillUnknown(ind: Indicators, pick: (id: IndicatorId) => number): Indicators {
  const out: Indicators = { ...ind };
  for (const id of INDICATOR_IDS) if (id in ind && ind[id] === null) out[id] = clamp100(pick(id));
  return out;
}
export const fillLow = (ind: Indicators, b: Bounds): Indicators => fillUnknown(ind, (id) => (b[id] ?? FULL)[0]);
export const fillHigh = (ind: Indicators, b: Bounds): Indicators => fillUnknown(ind, (id) => (b[id] ?? FULL)[1]);
export const fillMiddle = (ind: Indicators, b: Bounds): Indicators => fillUnknown(ind, (id) => { const [a, c] = b[id] ?? FULL; return (a + c) / 2; });

