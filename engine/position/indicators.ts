/**
 * «Положение» v4, показатели (T05): 12 оценок 0–100 в трёх направлениях.
 *   N — «Здесь и сейчас»: N1 запас, N2 норма сбережений, N3 долговая нагрузка, N4 капитал;
 *   V — «Вектор» (6 месяцев): V1 скорость накопления, V2 тренд потока, V3 отклонение долга от графика, V4 способность откладывать;
 *   F — «Безопасность будущего» (12 месяцев): F1 резерв в плохой период, F2 обеспеченность необходимого, F3 опасность потери источника, F4 будущая норма сбережений.
 *
 * Чистая функция от состояния и даты. Определения перенесены из проб (project docs: position-probe-v2-a measure2.ts, -v3-a measure3.ts, -v4-a measure4.ts),
 * V1 — по `model-final.md` §1.2 (D = 24). Эталон: tests/fixtures/position/indicators-reference.json (снят кодом проб, не движком).
 *
 * Значения: число 0–100; `null` — неизвестно (данных нет или истории мало); ключа нет — показатель не применим (V3 без отклонения от графика).
 * Неизвестное не превращается в 0: его обрабатывает T06 (интервалы).
 *
 * Все точки шкал и веса — гипотезы (H), как в спецификации.
 *
 * Отличия от пробы (D133):
 *  1. N1 и F1 считаются от ЧИСТОЙ ликвидности (доступные деньги минус долг людям, спец. 9.3, решение владельца 5): заёмные деньги запасом не считаются.
 *     Проба считала от доступных денег; на профилях без долга людям (все именные) результат тот же.
 *  2. Ручной пассивный доход (строка расписания с `passive: true`) считается доходом без истории в операциях, как «введён вручную» в пробе:
 *     он входит в средний доход (N3), но не в историю остатков (N2, V2, V4).
 *  3. Нет ни одной операции → все показатели `null` (проба предполагала, что данные есть).
 *  4. Нет расписания доходов (строк нет и событий «начало дохода» нет) → F2, F3, F4 = `null` (спец. 5.1), а не нули.
 *  5. V3 вычисляется по формуле спецификации, но на входе — платежи по графику = фактические платежи по рассрочкам (как в пробе, спец. 8.6),
 *     поэтому на данных он пока всегда «не применим»; смысл появится, когда будут браться плановые платежи графика (T19).
 */
import type { Money } from '../money';
import type { AppState } from '../state';
import { buildOverview } from '../overview';
import { buildSimInput } from '../plan';
import { simulate, DEFAULT_SCENARIOS } from '../simulate';
import type { IsoDate } from '../date';
import { buildPositionSeries, SERIES_LOOKBACK, type PositionSeries } from './series';
import { incomeSources } from './sources';
import type { IncomeStatus } from './settings';

// ───────────────────────── имена, веса, обязательность ─────────────────────────

export const INDICATOR_IDS = ['N1', 'N2', 'N3', 'N4', 'V1', 'V2', 'V3', 'V4', 'F1', 'F2', 'F3', 'F4'] as const;
export type IndicatorId = (typeof INDICATOR_IDS)[number];
export type Direction = 'N' | 'V' | 'F';
export const DIRECTIONS: readonly Direction[] = ['N', 'V', 'F'];

/** Число 0–100; null — неизвестно; отсутствие ключа — не применим. */
export type Indicators = Partial<Record<IndicatorId, number | null>>;

/** Веса внутри направления (H). */
export const INDICATOR_WEIGHTS: Readonly<Record<IndicatorId, number>> = {
  N1: 0.30, N2: 0.25, N3: 0.20, N4: 0.25,
  V1: 0.35, V2: 0.30, V3: 0.15, V4: 0.20,
  F1: 0.35, F2: 0.30, F3: 0.15, F4: 0.20,
};
/** Обязательные показатели направления: без них направление «недостаточно данных» (T06). N3 обязателен, только если применим (долги есть — он всегда считается). */
export const KEY_INDICATORS: Readonly<Record<Direction, readonly IndicatorId[]>> = {
  N: ['N1', 'N2', 'N3'],
  V: ['V1', 'V2'],
  F: ['F1', 'F2'],
};
export const directionOf = (id: IndicatorId): Direction => id[0] as Direction;

/** Минимум полных месяцев истории: для N2 и для всех показателей «Вектора». */
export const MIN_HISTORY_N2 = 3;
export const MIN_HISTORY_VECTOR = 7;

// ───────────────────────── шкалы 0–100 (H) ─────────────────────────

export type Pts = readonly (readonly [number, number])[];

/** Кусочно-линейная нормировка: левее первой точки — её значение, правее последней — последнее; нечисло → 0 (вызывающий отсекает неизвестное до вызова). */
export function normalize(x: number, pts: Pts): number {
  if (!Number.isFinite(x)) return 0;
  const [x0, y0] = pts[0]!;
  if (x <= x0) return y0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [xa, ya] = pts[i - 1]!;
    if (x <= x1) return ya + ((y1 - ya) * (x - xa)) / (x1 - xa);
  }
  return pts[pts.length - 1]![1];
}

export const SCALES = {
  /** N1a, N1b, F1: запас в месяцах. */
  reserve: [[0, 0], [1, 25], [3, 50], [6, 75], [12, 100]],
  /** N2, F4: норма сбережений — доля дохода, которая остаётся. */
  saving: [[0, 0], [0.1, 40], [0.2, 70], [0.35, 100]],
  /** N3: платежи по долгам ÷ доход. */
  debtPayments: [[0, 100], [0.15, 75], [0.3, 40], [0.45, 0]],
  /** N3: остаток долга в годах дохода. */
  debtStock: [[0, 100], [0.5, 60], [1, 30], [2, 0]],
  /** N4: капитал нетто в месяцах образа жизни. */
  capital: [[0, 0], [6, 25], [12, 40], [36, 60], [120, 80], [300, 100]],
  /** V1: рост капитала за месяц в долях знаменателя (капитал 6 мес. назад, не ниже 3 месяцев образа жизни). */
  growth: [[-0.03, 0], [0, 35], [0.02, 60], [0.05, 80], [0.1, 100]],
  /** V2: разность медиан свободного остатка (3 против прежних 3) в месячных образах жизни. */
  flowTrend: [[-0.3, 0], [0, 50], [0.3, 100]],
  /** V3: отклонение долга от графика в долях долга (>0 — погашено сверх графика). */
  debtDeviation: [[-0.3, 0], [0, 50], [0.3, 100]],
  /** F2: ожидаемый доход за 12 мес. с весами статуса ÷ (12 × необходимые расходы). */
  reliability: [[0, 0], [0.5, 40], [1, 80], [1.5, 100]],
  /** F3: опасность потери самого опасного источника. */
  exposure: [[0, 100], [0.15, 65], [0.5, 40], [1, 10]],
} as const satisfies Record<string, Pts>;

/**
 * Предел знаменателя роста V1 в месяцах обычных расходов (решение T00 №2, 05.11.2026; `model-final.md` §1.2).
 * Капитал сверх этого значения перестаёт занижать темп роста.
 * Статус: обоснованный рабочий компромисс, а НЕ универсальная константа: выбран после просмотра чувствительности
 * (D = 12/18/24/36 → R² N2–V1 0,68/0,64/0,61/0,58). Пересматривается в T19 на реальных данных.
 */
export const V1_CAPITAL_CAP_MONTHS = 24;
/** Нижняя граница знаменателя V1: три месяца образа жизни. */
export const V1_MIN_BASE_MONTHS = 3;
/** Минимальное отклонение долга от графика, при котором V3 применим. */
export const V3_MIN_DEVIATION = 0.02;

/** Вес статуса источника в обеспеченности необходимого (F2). */
export const SOURCE_RELIABILITY: Readonly<Record<IncomeStatus, number>> = { P: 1, T: 1, X: 0.5, I: 0.4 };
/** Вероятность потери источника по статусу (F3). */
export const SOURCE_LOSS_PROBABILITY: Readonly<Record<IncomeStatus, number>> = { P: 0.15, T: 0.6, X: 0.4, I: 0.6 };

// ───────────────────────── чистые формулы показателей (в тенге и долях, не в тиынах) ─────────────────────────

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const medianOf = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};

/** Доля дохода, которая остаётся за месяц. Нет дохода: расход → −1, иначе 0. */
export const monthRate = (income: number, free: number): number => (income > 0 ? free / income : free < 0 ? -1 : 0);

/** Запас в месяцах → 0–100. Нет расходов (need ≤ 0) → запас 0 (как в пробе). */
export const reserveScore = (money: number, need: number): number => normalize(need > 0 ? Math.max(0, money) / need : 0, SCALES.reserve);
/** N1: среднее двух запасов — по необходимым и по обычным расходам. */
export const n1Score = (liquid: number, needEssential: number, needLifestyle: number): number => (reserveScore(liquid, needEssential) + reserveScore(liquid, needLifestyle)) / 2;
/** N2 / F4. */
export const savingScore = (rate: number): number => normalize(rate, SCALES.saving);
/**
 * N3: меньшая из двух оценок — доля платежей в доходе и остаток долга в годах дохода.
 * Нет дохода (D171): есть платежи или долг — 0 («отлично» было бы неправдой: долг без дохода опаснее всего); ни платежей, ни долга — 100.
 */
export const debtLoadScore = (obligationsMonthly: number, debtTotal: number, incomeMonthly: number): number => {
  if (!(incomeMonthly > 0)) return obligationsMonthly > 0 || debtTotal > 0 ? 0 : 100;
  return Math.min(normalize(obligationsMonthly / incomeMonthly, SCALES.debtPayments), normalize(debtTotal / (incomeMonthly * 12), SCALES.debtStock));
};
/** N4. */
export const capitalScore = (net: number, needLifestyle: number): number => normalize(needLifestyle > 0 ? net / needLifestyle : 0, SCALES.capital);

/**
 * V1: скорость накопления (подтверждённый слой, без ручных активов).
 * Прежняя оценка: рост за месяц ÷ max(|капитал тогда|, 3 месяца образа жизни, 1).
 * При положительном росте и положительном капитале тогда знаменатель ограничивается D месяцами образа жизни, результат — лучшая из двух оценок.
 */
export function growthScore(netNow: number, netAgo: number, needLifestyle: number, months = SERIES_LOOKBACK, capMonths = V1_CAPITAL_CAP_MONTHS): number {
  const g = (netNow - netAgo) / months;
  const floor = V1_MIN_BASE_MONTHS * needLifestyle;
  const old = normalize(g / Math.max(Math.abs(netAgo), floor, 1), SCALES.growth);
  if (g <= 0) return old;
  const den = netAgo > 0 ? Math.min(Math.max(netAgo, floor), capMonths * needLifestyle) : Math.max(Math.abs(netAgo), floor, 1);
  return Math.max(old, normalize(g / den, SCALES.growth));
}
/** V2: разность медиан остатка за последние 3 и за предыдущие 3 месяца в месячных образах жизни. */
export function flowTrendScore(freeLast6: readonly number[], needLifestyle: number): number {
  const f = freeLast6.slice(-6);
  return normalize(needLifestyle > 0 ? (medianOf(f.slice(-3)) - medianOf(f.slice(0, f.length - 3))) / needLifestyle : 0, SCALES.flowTrend);
}
/** V3: отклонение долга от графика; null — не применим (долга нет или отклонение меньше 2 %). */
export function debtDeviationScore(debtThen: number, scheduledPaid: number, debtNow: number): number | null {
  if (!(debtThen > 0)) return null;
  const expected = debtThen - scheduledPaid;
  const dev = (expected - debtNow) / debtThen;
  return Math.abs(dev) >= V3_MIN_DEVIATION ? normalize(dev, SCALES.debtDeviation) : null;
}
/** V4: доля месяцев с положительным остатком из последних 6 (0–100). */
export const keepScore = (freeLast6: readonly number[]): number => (freeLast6.slice(-6).filter((x) => x > 0).length / 6) * 100;
/** F2 и F3 из источников дохода (деньги — в тенге). */
export interface SourceInput { status: IncomeStatus; volume: number }
export function reliabilityScore(sources: readonly SourceInput[], needEssential: number): number {
  const r = needEssential > 0 ? sources.reduce((a, s) => a + s.volume * SOURCE_RELIABILITY[s.status], 0) / (12 * needEssential) : 0;
  return normalize(r, SCALES.reliability);
}
export function exposureScore(sources: readonly SourceInput[]): number {
  const vol = sources.reduce((a, s) => a + s.volume, 0);
  const e = vol > 0 ? Math.max(...sources.map((s) => (s.volume / vol) * SOURCE_LOSS_PROBABILITY[s.status])) : 1;
  return normalize(e, SCALES.exposure);
}
/** F4: средний доход и средние расходы прогноза за 12 месяцев; доля — от большего из двух. */
export function forecastSavingRate(incomeMonthly: number, outflowMonthly: number): number {
  const m = Math.max(incomeMonthly, outflowMonthly);
  return m > 0 ? (incomeMonthly - outflowMonthly) / m : 0;
}

// ───────────────────────── расчёт по состоянию ─────────────────────────

/** Исходные числа расчёта (тенге) — для строки «как посчитано». */
export interface IndicatorInputs {
  needEssential: number;
  needLifestyle: number;
  liquid: number;
  /** Доступные деньги минус долг людям (не ниже нуля): запас считается от них. */
  netLiquid: number;
  net: number;
  debtTotal: number;
  obligationsMonthly: number;
  /** Средний доход за последние ≤6 месяцев плюс ручной пассивный доход. */
  incomeMonthly: number;
  manualIncomeMonthly: number;
  /** Запас в месяцах (netLiquid ÷ необходимые / обычные). */
  reserveEssentialMonths: number;
  reserveLifestyleMonths: number;
  /** Минимум доступных денег по неблагоприятному сценарию за 12 месяцев минус долг людям. */
  troughNet: number;
  /** Норма сбережений как есть (медиана 3 последних месяцев; < 0 — тратится больше, чем приходит); null — истории меньше 3 месяцев. */
  savingRate: number | null;
}
/** Источник дохода для ограничителей и интервалов (тенге). */
export interface ForecastSource { status: IncomeStatus; monthly: number; volume: number; endsWithin6m: boolean }
/** Что показал прогноз: кассовый разрыв и источники дохода. */
export interface ForecastFacts { hasGap: boolean; sources: ForecastSource[] }
export interface IndicatorsReport {
  values: Indicators;
  inputs: IndicatorInputs | null;
  forecast: ForecastFacts | null;
}
export interface IndicatorOptions {
  /** Предел знаменателя V1 в месяцах; для сверки с пробой без правки D — `Infinity`. */
  v1CapMonths?: number;
}

const T = (m: Money | number): number => m / 100;
const toT = (xs: readonly Money[]): number[] => xs.map((x) => x / 100);

export function emptyIndicators(): Indicators {
  const out: Indicators = {};
  for (const id of INDICATOR_IDS) if (id !== 'V3') out[id] = null;
  return out;
}

export function computeIndicators(state: AppState, today: IsoDate, series: PositionSeries = buildPositionSeries(state, today), options: IndicatorOptions = {}): IndicatorsReport {
  if (!series.hasData) return { values: emptyIndicators(), inputs: null, forecast: null };
  const o = buildOverview(state, today);
  const H = series.histMonths;

  const needEssential = T(o.baseline.median) + T(o.spend.obligationsMonthly);
  const needLifestyle = T(o.spend.usualMonthly) + T(o.spend.obligationsMonthly);
  const obligationsMonthly = T(o.spend.obligationsMonthly);
  const liquid = T(series.liquidNow);
  const netLiquid = T(series.netLiquid);
  const net = T(o.capital.net);
  const debtTotal = T(o.capital.liabilities.total);
  const payablesNow = T(o.capital.liabilities.payablesFromOps);

  const inc = toT(series.income);
  const free = toT(series.free);
  // только действующие сегодня строки, и не те, что уже есть в операциях (D170): закончившийся или ещё не начавшийся доход в нагрузку по долгам не входит (С5, D162)
  const manualIncomeMonthly = state.settings.incomeSchedule.reduce((a, i) => a + (i.passive === true && i.inHistory !== true && (!i.start || i.start <= today) && (!i.end || i.end >= today) ? T(i.amount) : 0), 0);
  const incomeMonthly = mean(inc.slice(-6)) + manualIncomeMonthly;

  const values: Indicators = {};
  // I. Здесь и сейчас
  values.N1 = n1Score(netLiquid, needEssential, needLifestyle);
  const savingRate = H >= MIN_HISTORY_N2 ? medianOf(inc.slice(-3).map((x, i) => monthRate(x, free.slice(-3)[i]!))) : null;
  values.N2 = savingRate === null ? null : normalize(savingRate, SCALES.saving);
  values.N3 = debtLoadScore(obligationsMonthly, debtTotal, incomeMonthly);
  values.N4 = capitalScore(net, needLifestyle);
  // II. Вектор
  if (H >= MIN_HISTORY_VECTOR) {
    const netNowC = series.netConfirmed[0], netAgoC = series.netConfirmed[SERIES_LOOKBACK];
    values.V1 = netNowC !== null && netNowC !== undefined && netAgoC !== null && netAgoC !== undefined ? growthScore(T(netNowC), T(netAgoC), needLifestyle, SERIES_LOOKBACK, options.v1CapMonths ?? V1_CAPITAL_CAP_MONTHS) : null;
    values.V2 = flowTrendScore(free, needLifestyle);
    const paid6 = toT(series.installmentsPaid).slice(-6).reduce((a, b) => a + b, 0);
    const debtThen = netAgoC !== null && netAgoC !== undefined && (netAgoC < 0 || debtTotal > 0) ? debtTotal + paid6 : 0;
    const v3 = debtDeviationScore(debtThen, paid6, debtTotal);
    if (v3 !== null) values.V3 = v3;
    values.V4 = keepScore(free);
  } else {
    values.V1 = null; values.V2 = null; values.V4 = null;
  }
  // III. Безопасность будущего
  const { input } = buildSimInput(state, today);
  const base = simulate({ ...input, horizonMonths: 12 });
  const adverse = simulate({ ...input, horizonMonths: 12 }, DEFAULT_SCENARIOS.find((s) => s.id === 'adverse')!);
  const trough = Math.min(...adverse.months.slice(1, 13).map((m) => T(m.liquidEnd)));
  const troughNet = trough - payablesNow;
  const m12 = base.months.slice(1, 13);
  const facts = incomeSources(input, today).map((s) => ({ status: s.status, monthly: T(s.monthly), volume: T(s.volume), endsWithin6m: s.endsWithin6m }));
  const sources = facts;
  // расписания доходов нет (ни строк, ни событий «начало дохода») — обеспеченность, опасность потери и будущая норма сбережений неизвестны, а не нули (спец. 5.1)
  const scheduleKnown = input.incomes.length > 0 || input.events.some((e) => e.kind === 'income_start');
  values.F1 = scheduleKnown ? reserveScore(troughNet, needEssential) : null;
  values.F2 = scheduleKnown ? reliabilityScore(sources, needEssential) : null;
  values.F3 = scheduleKnown ? exposureScore(sources) : null;
  values.F4 = scheduleKnown ? normalize(forecastSavingRate(mean(m12.map((m) => T(m.income))), mean(m12.map((m) => T(m.expenses) + T(m.obligations)))), SCALES.saving) : null;

  return {
    values,
    inputs: {
      needEssential, needLifestyle, liquid, netLiquid, net, debtTotal, obligationsMonthly, incomeMonthly, manualIncomeMonthly,
      reserveEssentialMonths: needEssential > 0 ? netLiquid / needEssential : 0,
      reserveLifestyleMonths: needLifestyle > 0 ? netLiquid / needLifestyle : 0,
      troughNet,
      savingRate,
    },
    forecast: { hasGap: base.gaps.length > 0, sources: facts },
  };
}
