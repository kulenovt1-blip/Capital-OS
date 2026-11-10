/**
 * «Положение» v4 (T11): модель экрана — всё, что нужно показать, одной чистой функцией от состояния и даты.
 * Экран только рисует эту модель и ничего не считает сам: так каждое число на нём можно проверить тестом без интерфейса.
 * Математика уровней, диапазона, runway, спирали и независимости не менялась — здесь они собираются вместе и получают человеческие названия.
 */
import type { AppState } from '../state';
import { addDays, type IsoDate } from '../date';
import { buildOverview, type Overview } from '../overview';
import { liquidOn } from '../ledger';
import { buildPositionSeries } from './series';
import {
  DIRECTIONS, INDICATOR_IDS, MIN_HISTORY_VECTOR, computeIndicators, type Direction, type IndicatorId, type IndicatorInputs,
} from './indicators';
import { directionScore, isDirectionSufficient } from './directions';
import { LIMIT_VALUES, limitStates, withoutForecast, type LimitId } from './limits';
import { L3_RESERVE_MONTHS, L4_RESERVE_MONTHS, LEVEL_MEANINGS, LEVEL_NAMES, gateLevel, levelFromIndicators, type BoundaryId, type Level, type LevelFacts } from './level';
import { formatKZT, tenge } from '../money';
import { positionRange, type PositionRange } from './range';
import { boundsContext, historyBounds, reserveBounds, scheduleBounds, type Bounds } from './unknown';
import { computeRunway, type Runway } from './runway';
import { spiralSigns, type SpiralSigns } from './spiral';
import { confidenceOf, isPreliminary } from './confidence';
import { INDEPENDENCE_TEXTS, L5_NAME, desiredScenarioOf, independenceOfState, levelWithIndependence, type DesiredScenario, type IndependenceResult } from './independence';
import { essentialMarkupMissing } from './inputs';

export const DIRECTION_NAMES: Readonly<Record<Direction, string>> = { N: 'Здесь и сейчас', V: 'Динамика', F: 'Безопасность будущего' };
export const DIRECTION_QUESTIONS: Readonly<Record<Direction, string>> = { N: 'Каково положение сегодня?', V: 'Как оно менялось за полгода?', F: 'Выдержит ли оно будущее и удар?' };

/** Названия показателей простыми словами (на экране коды N1, V2 и т. п. не показываются). */
export const INDICATOR_LABELS: Readonly<Record<IndicatorId, string>> = {
  N1: 'Запас денег', N2: 'Сколько откладываю', N3: 'Долговая нагрузка', N4: 'Капитал',
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
/** Месяцы запаса — округляя вниз: «2,99» не должно превращаться в «3,0» рядом со словами «меньше 3» (С6, D163). */
const nfDown = (x: number): string => (Math.floor(x * 10 + 1e-9) / 10).toFixed(1).replace('.', ',');
/** Запас до порога месяцев, меньше которого уровень считается «на границе» по фактам (С6, D163). */
export const RESERVE_BORDER_MARGIN = 0.25;

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
  status: 'no_data' | 'needs_rate' | 'ok';
  /** Счета не в тенге без курса: уровень, запас и прогноз не оцениваются (D155). */
  unrated: { accountId: string; title: string; currency: string }[];
  /** Сверка балансов с MoneyManager сошлась; false — уровень посчитан по неверным балансам и предварительный (С2, D159). */
  reconcileOk: boolean;
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
  /** Что значит текущий уровень — одна фраза (D151). */
  levelMeaning: string | null;
  /** Все пять ступеней: название, смысл, текущая ли (D151). */
  ladder: { level: number; name: string; meaning: string; current: boolean }[];
  /** Уровень ниже, чем по очкам: что не выполнено (D151); null — не опущен. */
  held: string | null;
  /** До следующего уровня: что нужно — очки и/или факты; null — нечего показывать. */
  next: { level: number; name: string; needs: string[] } | null;
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
  return { ...(histMonths < MIN_HISTORY_VECTOR ? historyBounds(ctx, histMonths) : {}), ...(scheduleKnown ? {} : { ...scheduleBounds(ctx), ...reserveBounds(ctx) }) };
}

/** Счёт не сошёлся с MoneyManager — но только если он учитывается: исключённый счёт ни на что не влияет. */
function hasMismatch(overview: Overview): boolean {
  const excluded = new Set(overview.capital.accounts.filter((p) => p.excluded).map((p) => p.accountId));
  return overview.reconcile?.accounts.some((a) => a.status === 'mismatch' && !excluded.has(a.accountId)) ?? false;
}

export function positionViewOf(state: AppState, today: IsoDate): PositionView {
  const series = buildPositionSeries(state, today);
  const overview = buildOverview(state, today);
  const essentialMissing = essentialMarkupMissing(overview);
  // ряд, показатели и обзор считаются один раз и передаются независимости и личному сценарию (T17)
  const report = series.hasData ? computeIndicators(state, today, series) : null;
  const pre = { series, overview, ...(report ? { report } : {}) };
  const independence = independenceOfState(state, today, pre);
  if (!series.hasData || !report || overview.capital.unrated.length) {
    return {
      status: !series.hasData || !report ? 'no_data' : 'needs_rate', unrated: overview.capital.unrated, reconcileOk: !hasMismatch(overview), level: null, levelName: null, levelMeaning: null, ladder: ladderOf(null), held: null, basis: 'none', g: null, directions: [], weak: null, range: null, rangeLevels: null, limitsFired: [], next: null,
      onBorder: [], l4Unconfirmed: false, l4Warnings: [], money: { total: 0, spendable: 0, instant: 0, blockedShare: 0, reserveEssentialMonths: 0, reserveLifestyleMonths: 0 },
      runway: emptyRunway(), spiral: NO_SPIRAL, overdue: 0, confidence: 0, preliminary: true, independence, independenceNote: null,
      independenceLine: levelWithIndependence(null, independence).independenceLine ?? null, essentialMissing, desired: null,
    };
  }

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
    if (range) rangeLevels = { low: LEVEL_NAMES[gateLevel(Math.min(range.levelLow, 4) as Level, factsOf(inputs)).level], high: LEVEL_NAMES[gateLevel(Math.min(range.levelHigh, 4) as Level, factsOf(inputs)).level] };
  }

  const blockedShare = cap.gross > 0 ? Math.max(0, 1 - liquidOn(cap, addDays(today, 30)) / cap.gross) : 0;
  const level = fin.level;
  const next = base && level !== null && level <= 3 && fin.basis === 'score' ? nextOf(level as Level, base.g, base.result.margins.find((m) => m.id === 'L3/L4')!.margin, inputs, base.fired) : null;
  const held = base?.result.held ? heldText(base.result.held.reason, base.result.held.byScore, inputs) : base?.result.lifted ? liftedText(base.result.lifted.reason, inputs) : null;
  const confidence = confidenceOf(state, today);
  const spiral = spiralSigns(series);
  const spendable = Math.max(0, liquidOn(cap, addDays(today, 30)) - cap.liabilities.payablesFromOps);

  return {
    status: 'ok', unrated: [], reconcileOk: !hasMismatch(overview), level, levelName: fin.name, levelMeaning: level === null ? null : level === 5 ? L5_MEANING : meaningOf(level as Level, inputs, weak?.directionName ?? null), ladder: ladderOf(level), held, basis: fin.basis, g: base?.g ?? null, directions, weak, range, rangeLevels,
    limitsFired: (base?.fired ?? []).map((id) => ({ id, text: LIMIT_TEXTS[id] })),
    next, onBorder: borderOf(base?.result.onBorder ?? [], inputs), l4Unconfirmed: base?.result.l4Unconfirmed ?? false,
    l4Warnings: level === 4 ? l4Warnings(inputs, blockedShare) : [],
    money: { total: cap.net / 100, spendable: spendable / 100, instant: series.liquidNow / 100, blockedShare, reserveEssentialMonths: inputs.reserveEssentialMonths, reserveLifestyleMonths: inputs.reserveLifestyleMonths },
    runway: computeRunway(series, inputs.needEssential), spiral, overdue: spiral.overdueCount,
    confidence, preliminary: isPreliminary(confidence) || inputs.needEssential <= 0 || hasMismatch(overview),
    independence, independenceNote: fin.note ?? null, independenceLine: fin.independenceLine ?? null, essentialMissing, desired: desiredScenarioOf(state, today, pre),
  };
}

export { INDEPENDENCE_TEXTS, L5_NAME };

// ───────────────────────── ступени и следующий шаг (D151) ─────────────────────────

export const L5_MEANING = 'Капитал и независимый доход покрывают расходы с запасом — можно не работать ради денег';
const factsOf = (i: IndicatorInputs): LevelFacts => ({ reserveMonths: i.reserveEssentialMonths, savingRate: i.savingRate });
const tg = (x: number): string => formatKZT(tenge(Math.round(Math.max(0, x) / 1000) * 1000));
const reserveNeed = (months: number, i: IndicatorInputs): string =>
  `запас от ${months} месяцев необходимых расходов: сейчас ${nfDown(i.reserveEssentialMonths)}, не хватает около ${tg((months - i.reserveEssentialMonths) * i.needEssential)}`;

export function ladderOf(current: number | null): PositionView['ladder'] {
  const four: PositionView['ladder'] = ([1, 2, 3, 4] as Level[]).map((l) => ({ level: l, name: LEVEL_NAMES[l], meaning: LEVEL_MEANINGS[l], current: current === l }));
  return [...four, { level: 5, name: L5_NAME, meaning: L5_MEANING, current: current === 5 }];
}

export function heldText(reason: 'deficit' | 'reserve3' | 'reserve6', byScore: Level, i: IndicatorInputs): string {
  const why = reason === 'deficit' ? 'за последние месяцы расходы больше доходов, а запас меньше 3 месяцев'
    : reason === 'reserve3' ? `запас меньше ${L3_RESERVE_MONTHS} месяцев необходимых расходов (${nfDown(i.reserveEssentialMonths)})`
    : `запас меньше ${L4_RESERVE_MONTHS} месяцев необходимых расходов (${nfDown(i.reserveEssentialMonths)})`;
  return `По очкам это «${LEVEL_NAMES[byScore]}», но ${why}`;
}

/** «На границе» и по очкам, и по запасу: до порога 3 или 6 месяцев меньше RESERVE_BORDER_MARGIN (С6, D163). */
export function borderOf(byScore: BoundaryId[], i: IndicatorInputs): BoundaryId[] {
  const out = new Set<BoundaryId>(byScore);
  if (i.needEssential > 0) {
    if (Math.abs(i.reserveEssentialMonths - L3_RESERVE_MONTHS) < RESERVE_BORDER_MARGIN) out.add('L2/L3');
    if (Math.abs(i.reserveEssentialMonths - L4_RESERVE_MONTHS) < RESERVE_BORDER_MARGIN) out.add('L3/L4');
  }
  return [...out];
}

function liftedText(reason: 'reserve' | 'income' | 'unknown', i: IndicatorInputs): string {
  const why = reason === 'reserve' ? `запас ${nfDown(i.reserveEssentialMonths)} мес. необходимых расходов — это не «${LEVEL_NAMES[1]}»`
    : reason === 'income' ? 'за последние месяцы расходы не больше доходов'
    : 'данных мало, чтобы подтвердить, что расходы больше доходов';
  return `По очкам это «${LEVEL_NAMES[1]}», но ${why}`;
}

/** Фраза-смысл ступени: при запасе ≥ 3 мес. на ступенях 1–2 общий текст был бы неправдой — называется причина низкой оценки (К3, D156). */
function meaningOf(level: Level, i: IndicatorInputs, weak: string | null): string {
  if (level <= 2 && i.reserveEssentialMonths >= L3_RESERVE_MONTHS) return `Запас есть — ${nfDown(i.reserveEssentialMonths)} мес. необходимых расходов, но общая оценка низкая${weak ? `: слабее всего «${weak}»` : ''}`;
  return LEVEL_MEANINGS[level];
}

function nextOf(level: Level, g: number, l4Margin: number, i: IndicatorInputs, fired: readonly LimitId[] = []): PositionView['next'] {
  const to = (level + 1) as Level;
  const needs: string[] = [];
  const pts = to === 2 ? 20 - g : to === 3 ? 40 - g : -l4Margin;
  // пока работает ограничитель, G выше его предела не поднимется, сколько ни прибавляй очков (С3, D160): называется само условие
  const threshold = to === 2 ? 20 : to === 3 ? 40 : 75;
  const blocking = fired.filter((id) => LIMIT_VALUES[id] < threshold);
  for (const id of blocking) needs.push(`снять ограничение: ${LIMIT_TEXTS[id]}`);
  if (pts > 0 && !blocking.length) needs.push(`${Math.ceil(pts)} ${plural(Math.ceil(pts))} общей оценки`);
  if (to === 2 && i.savingRate !== null && i.savingRate < 0 && i.reserveEssentialMonths < L3_RESERVE_MONTHS) needs.push('чтобы доходы покрывали расходы (или запас от 3 месяцев)');
  if (to === 3 && i.reserveEssentialMonths < L3_RESERVE_MONTHS) needs.push(reserveNeed(L3_RESERVE_MONTHS, i));
  if (to === 4 && i.reserveEssentialMonths < L4_RESERVE_MONTHS) needs.push(reserveNeed(L4_RESERVE_MONTHS, i));
  return needs.length ? { level: to, name: LEVEL_NAMES[to], needs } : null;
}
const plural = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? 'очко' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'очка' : 'очков');
