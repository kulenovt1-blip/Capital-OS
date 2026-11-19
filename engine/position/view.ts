/**
 * «Положение» v4 (T11): модель экрана — всё, что нужно показать, одной чистой функцией от состояния и даты.
 * Экран только рисует эту модель и ничего не считает сам: так каждое число на нём можно проверить тестом без интерфейса.
 * Математика уровней, диапазона, runway и спирали не менялась — здесь они собираются вместе и получают человеческие названия.
 * Независимость («Могу не работать») убрана по решению владельца 20.11.2026 (D216): ступень 5 — «Могу не смотреть на цены», факты в level.ts.
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
import { L3_RESERVE_MONTHS, L4_RESERVE_MONTHS, L5_LIFE_RESERVE_MONTHS, LEVEL_MEANINGS, LEVEL_NAMES, gateLevel, liftLevel1, levelFromIndicators, type BoundaryId, type L5Check, type Level, type LevelFacts } from './level';
import { formatKZT, tenge } from '../money';
import { positionRange, type PositionRange } from './range';
import { endedIncomeToAsk, type EndedIncome } from '../income-ended';
import { boundsContext, essentialBounds, historyBounds, reserveBounds, scheduleBounds, type Bounds } from './unknown';
import { computeRunway, type Runway } from './runway';
import { spiralSigns, type SpiralSigns } from './spiral';
import { confidenceOf, isPreliminary } from './confidence';
import { assetChoiceOf, essentialMarkupMissing } from './inputs';

export const DIRECTION_NAMES: Readonly<Record<Direction, string>> = { N: 'Здесь и сейчас', V: 'Динамика', F: 'Безопасность будущего' };
export const DIRECTION_QUESTIONS: Readonly<Record<Direction, string>> = { N: 'Каково положение сегодня?', V: 'Как оно менялось за полгода?', F: 'Переживёшь ли ты, если доход упадёт или пропадёт?' };

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
export function l4Warnings(i: Pick<IndicatorInputs, 'reserveEssentialMonths' | 'needEssential' | 'troughNet' | 'essentialUnknown'>, blockedShare: number): L4Warning[] {
  const out: L4Warning[] = [];
  if (i.needEssential > 0 && !i.essentialUnknown && i.reserveEssentialMonths < L4_WARN_RESERVE_MONTHS) out.push({ id: 'reserve', text: `Запас по необходимым расходам — ${nfDown(i.reserveEssentialMonths)} мес., это меньше ${L4_WARN_RESERVE_MONTHS}` });
  if (i.needEssential > 0 && !i.essentialUnknown && i.troughNet / i.needEssential < L4_WARN_TROUGH_MONTHS) out.push({ id: 'trough', text: `В неблагоприятном прогнозе запас опускается до ${nfDown(Math.max(0, i.troughNet) / i.needEssential)} мес. необходимых расходов, это меньше ${L4_WARN_TROUGH_MONTHS}` });
  if (blockedShare > L4_WARN_BLOCKED_SHARE) out.push({ id: 'blocked', text: `${Math.round(blockedShare * 100) <= 50 ? 'Больше 50' : Math.round(blockedShare * 100)} % капитала нельзя снять в ближайшие 30 дней` });
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
  /** score — по оценке и фактам; none — оценить нечем. */
  basis: 'score' | 'none';
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
  /** Жильё и закрытые активы: стоимость, остаток привязанных кредитов и доля владения (стоимость − остаток); null — таких активов нет. На ступень не влияет. */
  housing: { assets: number; debt: number; equity: number; items: number; linked: number } | null;
  money: { total: number; gross: number; spendable: number; instant: number; blockedShare: number; reserveEssentialMonths: number; reserveLifestyleMonths: number };
  /** Месячный поток для полосок «Доход / Расходы» (D6): средний доход, обычные расходы вместе с платежами по долгам и сами платежи, тенге. null — оценить нечем. */
  flow: { income: number; spending: number; obligations: number } | null;
  runway: Runway;
  spiral: SpiralSigns;
  /** Просроченные платежи по графику (отдельная пометка). */
  overdue: number;
  /** 0–1; ниже порога — уровень предварительный. */
  confidence: number;
  preliminary: boolean;
  /** Условия ступени 5 по отдельности (D216); null — фактов нет. */
  l5: L5Check | null;
  essentialMissing: boolean;
  /** D212: запас по необходимому не определён (нет отметки «обязательно»): N1, F1, F2 — «нет данных», итог — диапазон; запас на экранах не показывается числом. */
  essentialUnknown: boolean;
  /** D214: доходы с прошедшим сроком без ответа «что дальше» — на «Профиле» про них спрашивается. */
  endedIncome: EndedIncome[];
}

const emptyRunway = (): Runway => ({ status: 'no_data', deficit: 0, resources: 0, months: null, scenarios: [] });
const NO_SPIRAL: SpiralSigns = { status: 'no_data', overdue: null, growth: null, borrowToPay: null, count: 0, spiral: false, overdueCount: 0, growthMonths: null, borrowToPayMonths: null };

/** Интервалы неизвестного по реальным данным: короткая история и отсутствие расписания доходов. Остальное неизвестное — вся шкала 0–100. */
function actualBounds(ctx: ReturnType<typeof boundsContext>, histMonths: number, scheduleKnown: boolean, essentialUnknown = false): Bounds {
  return {
    ...(histMonths < MIN_HISTORY_VECTOR ? historyBounds(ctx, histMonths) : {}),
    ...(scheduleKnown ? {} : { ...scheduleBounds(ctx), ...reserveBounds(ctx) }),
    ...(essentialUnknown ? essentialBounds(ctx, scheduleKnown) : {}),
  };
}

/** Счёт не сошёлся с MoneyManager — но только если он учитывается: исключённый счёт ни на что не влияет. */
function hasMismatch(overview: Overview): boolean {
  const excluded = new Set(overview.capital.accounts.filter((p) => p.excluded).map((p) => p.accountId));
  return overview.reconcile?.accounts.some((a) => a.status === 'mismatch' && !excluded.has(a.accountId)) ?? false;
}

function housingOf(state: AppState, overview: Overview): PositionView['housing'] {
  // имущество — и ручное («жильё / заблокировано»), и счёт MoneyManager с отметкой «имущество» (D218)
  const locked = overview.capital.accounts.filter((p) => p.nonInvestable && !p.excluded);
  if (!locked.length) return null;
  const assets = locked.reduce((s, a) => s + a.balance, 0) / 100;
  const ids = new Set(state.manualAccounts.filter((a) => assetChoiceOf(a) === 'locked').map((a) => a.loanId).filter((x): x is string => !!x));
  const linked = overview.obligations.filter((o) => ids.has(o.obligation.id));
  const debt = linked.reduce((s, o) => s + o.remainingNow, 0) / 100;
  return { assets, debt, equity: assets - debt, items: locked.length, linked: linked.length };
}

/**
 * Очки для показа: целое, но не округлённое вверх через границу, до которой не дошли (74,9 при границе 75 — «74», 59,6 при полу 60 — «59», 79,6 при «сильно» с 80 — «79»).
 * Границы — ступеней (20 / 40 / 75), пола направления (60) и слова «сильно» (80). Аудит 10, находка 8.
 */
export const SCORE_SHOWN_BOUNDS = [20, 40, 60, 75, 80] as const;
export function shownScore(x: number): number {
  const r = Math.round(x);
  for (const b of SCORE_SHOWN_BOUNDS) if (x < b && r >= b) return b - 1;
  return r;
}

/** D210: «Слабое место» не показывается, когда самый низкий из действуемых показателей слабого направления не ниже этого значения; это же граница слова «сильно» рядом с очками (`scoreWord`). */
export const WEAK_NONE_FROM = 80;

export function positionViewOf(state: AppState, today: IsoDate): PositionView {
  const series = buildPositionSeries(state, today);
  const overview = buildOverview(state, today);
  const essentialMissing = essentialMarkupMissing(overview);
  const report = series.hasData ? computeIndicators(state, today, series) : null;
  if (!series.hasData || !report || overview.capital.unrated.length) {
    return {
      status: !series.hasData || !report ? 'no_data' : 'needs_rate', unrated: overview.capital.unrated, reconcileOk: !hasMismatch(overview), level: null, levelName: null, levelMeaning: null, ladder: ladderOf(null), held: null, basis: 'none', g: null, directions: [], weak: null, range: null, rangeLevels: null, limitsFired: [], next: null,
      onBorder: [], l4Unconfirmed: false, l4Warnings: [], housing: null, money: { total: 0, gross: 0, spendable: 0, instant: 0, blockedShare: 0, reserveEssentialMonths: 0, reserveLifestyleMonths: 0 }, flow: null,
      runway: emptyRunway(), spiral: NO_SPIRAL, overdue: 0, confidence: 0, preliminary: true, l5: null, essentialMissing, essentialUnknown: false, endedIncome: endedIncomeToAsk(state, today),
    };
  }

  const base = levelFromIndicators(report);
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
    // D177 (L7): «Капитал» (N4) шкалой до 300 месяцев почти всегда самый низкий, но за месяцы на него не повлиять; при запасе от 3 месяцев называем то, что можно менять
    const actionable = inputs.reserveEssentialMonths >= L3_RESERVE_MONTHS ? known.filter((x) => x.id !== 'N4') : known;
    const low = actionable.length ? actionable.reduce((a, b) => (b.score < a.score ? b : a)) : null;
    // D210: если даже самый низкий из «действуемых» показателей слабого направления не ниже порога, слабого места нет — не называем хорошее слабым
    weak = low && shownScore(low.score) >= WEAK_NONE_FROM ? null : { direction: weakestId, directionName: dv.name, indicator: low };
  }

  // диапазон: только если что-то неизвестно
  let range: PositionRange | null = null;
  let rangeLevels: PositionView['rangeLevels'] = null;
  if (base && Object.values(report.values).some((v) => v === null)) {
    const scheduleKnown = report.values.F3 !== null;
    const baseStates = limitStates(inputs, report.forecast!);
    const states = scheduleKnown ? baseStates : withoutForecast(baseStates);
    range = positionRange(report.values, actualBounds(boundsContext(series, inputs, undefined, report.forecast), series.histMonths, scheduleKnown, inputs.essentialUnknown === true), states);
    // края диапазона проходят те же правила, что и сама ступень: срез по фактам и подъём ступени 1 по D156 (аудит 10, находка 3)
    // факты по запасу ступень проверяет только при необходимых расходах > 0 (D158) — края тоже
    const edgeFacts = inputs.needEssential > 0 && !inputs.essentialUnknown ? factsOf(inputs) : undefined;
    const edgeName = (lv: number): string => { const gated = gateLevel(Math.min(lv, 4) as Level, edgeFacts); return LEVEL_NAMES[gated.held ? gated.level : liftLevel1(gated.level, edgeFacts).level]; };
    if (range) rangeLevels = { low: edgeName(range.levelLow), high: edgeName(range.levelHigh) };
  }

  const blockedShare = cap.gross > 0 ? Math.max(0, 1 - liquidOn(cap, addDays(today, 30)) / cap.gross) : 0;
  const level: Level | null = base ? base.result.level : null;
  const next = base && level !== null && level <= 4 ? nextOf(level, base.g, base.result.margins.find((m) => m.id === 'L3/L4')!.margin, inputs, base.fired, base.result.l5) : null;
  const held = base?.result.held ? heldText(base.result.held.reason, base.result.held.byScore, inputs) : base?.result.lifted ? liftedText(base.result.lifted.reason, inputs) : null;
  const confidence = confidenceOf(state, today);
  const spiral = spiralSigns(series);
  // D174: доступное за месяц — после долгов людям, платежей на 30 дней и обычных трат на 30 дней
  const payments30 = overview.upcoming30.reduce((a, u) => a + u.amount, 0);
  const usual30 = Math.round((overview.spend.usualMonthly * 12 * 30) / 365);
  const spendable = Math.max(0, liquidOn(cap, addDays(today, 30)) - cap.liabilities.payablesFromOps - payments30 - usual30);

  return {
    status: 'ok', unrated: [], reconcileOk: !hasMismatch(overview), level, levelName: level === null ? null : LEVEL_NAMES[level], levelMeaning: level === null ? null : meaningOf(level, inputs, weak?.directionName ?? null, spiral.spiral), ladder: ladderOf(level), held, basis: base ? 'score' : 'none', g: base?.g ?? null, directions, weak, range, rangeLevels,
    limitsFired: (base?.fired ?? []).map((id) => ({ id, text: LIMIT_TEXTS[id] })),
    next, onBorder: borderOf(base?.result.onBorder ?? [], inputs), l4Unconfirmed: base?.result.l4Unconfirmed ?? false,
    l4Warnings: level !== null && level >= 4 ? l4Warnings(inputs, blockedShare) : [],
    housing: housingOf(state, overview),
    money: { total: cap.net / 100, gross: cap.gross / 100, spendable: spendable / 100, instant: series.liquidNow / 100, blockedShare, reserveEssentialMonths: inputs.reserveEssentialMonths, reserveLifestyleMonths: inputs.reserveLifestyleMonths },
    flow: { income: inputs.incomeMonthly, spending: inputs.needLifestyle, obligations: inputs.obligationsMonthly },
    runway: computeRunway(series, inputs.needEssential), spiral, overdue: spiral.overdueCount,
    confidence, preliminary: isPreliminary(confidence) || inputs.needEssential <= 0 || inputs.essentialUnknown === true || hasMismatch(overview),
    l5: base?.result.l5 ?? null, essentialMissing, essentialUnknown: inputs.essentialUnknown === true, endedIncome: endedIncomeToAsk(state, today),
  };
}

// ───────────────────────── ступени и следующий шаг (D151) ─────────────────────────

const factsOf = (i: IndicatorInputs): LevelFacts => ({ reserveMonths: i.reserveEssentialMonths, savingRate: i.savingRate });
const tg = (x: number): string => formatKZT(tenge(Math.round(Math.max(0, x) / 1000) * 1000));
const reserveNeed = (months: number, i: IndicatorInputs): string =>
  // нет необходимых расходов (ничего не отмечено «обязательно») — запас не определён, а не равен 0,0 (аудит 10, находка 5; D158)
  i.needEssential <= 0 || i.essentialUnknown ? `запас от ${months} месяцев необходимых расходов: сначала отметь, что обязательно, — без этого запас не посчитать` :
  `запас от ${months} месяцев необходимых расходов: сейчас ${nfDown(i.reserveEssentialMonths)}, не хватает около ${tg((months - i.reserveEssentialMonths) * i.needEssential)}`;

export function ladderOf(current: number | null): PositionView['ladder'] {
  return ([1, 2, 3, 4, 5] as Level[]).map((l) => ({ level: l, name: LEVEL_NAMES[l], meaning: LEVEL_MEANINGS[l], current: current === l }));
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
  if (i.needEssential > 0 && !i.essentialUnknown) {
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
function meaningOf(level: Level, i: IndicatorInputs, weak: string | null, spiral = false): string {
  // расходы больше доходов: «на жизнь хватает» и «запаса почти нет» были бы неправдой (L6, D173)
  const deficit = i.savingRate !== null && i.savingRate < 0;
  if (level <= 2 && deficit) {
    const base = i.reserveEssentialMonths >= L3_RESERVE_MONTHS
      ? `Расходы больше доходов: живёшь за счёт запаса, его хватит примерно на ${nfDown(i.reserveEssentialMonths)} мес. необходимых расходов, и он тает`
      : `Расходы больше доходов, а запаса меньше ${L3_RESERVE_MONTHS} месяцев: сейчас ${nfDown(i.reserveEssentialMonths)}`;
    return spiral ? `${base}. Долги растут: начни с одного платежа` : base;
  }
  if (level <= 2 && i.reserveEssentialMonths >= L3_RESERVE_MONTHS) return `Запас есть — ${nfDown(i.reserveEssentialMonths)} мес. необходимых расходов, но общая оценка низкая${weak ? `: слабее всего «${weak}»` : ''}`;
  return LEVEL_MEANINGS[level];
}

function nextOf(level: Level, g: number, l4Margin: number, i: IndicatorInputs, fired: readonly LimitId[] = [], l5: L5Check | null = null): PositionView['next'] {
  const to = (level + 1) as Level;
  const needs: string[] = [];
  if (to === 5) {
    // ступень 5 — только факты (D216): очков нет
    if (!l5) return null;
    if (!l5.lifeReserve.ok) needs.push(`деньги на ${L5_LIFE_RESERVE_MONTHS} месяцев обычной жизни: сейчас на ${nfDown(l5.lifeReserve.have)}, не хватает около ${tg((L5_LIFE_RESERVE_MONTHS - l5.lifeReserve.have) * i.needLifestyle)}`);
    if (!l5.essentialShare.ok) needs.push(l5.essentialShare.have === null ? 'доход: без него не посчитать, какая часть уходит на обязательное' : `на обязательное — не больше ${Math.round(l5.essentialShare.max * 100)} % дохода: сейчас ${Math.round(l5.essentialShare.have * 100)} %`);
    if (!l5.savingRate.ok) needs.push(l5.savingRate.have === null ? 'откладывать от 10 % дохода: истории пока мало, чтобы проверить' : `откладывать от ${Math.round(l5.savingRate.min * 100)} % дохода: сейчас ${Math.max(0, Math.round(l5.savingRate.have * 100))} %`);
    if (!l5.habit.ok) needs.push('откладывать хотя бы в 5 из 6 последних месяцев');
    return needs.length ? { level: 5, name: LEVEL_NAMES[5], needs } : null;
  }
  const pts = to === 2 ? 20 - g : to === 3 ? 40 - g : -l4Margin;
  // пока работает ограничитель, G выше его предела не поднимется, сколько ни прибавляй очков (С3, D160): называется само условие
  const threshold = to === 2 ? 20 : to === 3 ? 40 : 75;
  const blocking = fired.filter((id) => LIMIT_VALUES[id] < threshold);
  for (const id of blocking) needs.push(`снять ограничение: ${LIMIT_TEXTS[id]}`);
  if (pts > 0 && !blocking.length) needs.push(`общая оценка от ${threshold} (сейчас ${shownScore(g)} из 100)`);
  if (to === 2 && i.savingRate !== null && i.savingRate < 0 && i.reserveEssentialMonths < L3_RESERVE_MONTHS) needs.push('чтобы доходы покрывали расходы (или запас от 3 месяцев)');
  if (to === 3 && i.reserveEssentialMonths < L3_RESERVE_MONTHS) needs.push(reserveNeed(L3_RESERVE_MONTHS, i));
  if (to === 4 && i.reserveEssentialMonths < L4_RESERVE_MONTHS) needs.push(reserveNeed(L4_RESERVE_MONTHS, i));
  return needs.length ? { level: to, name: LEVEL_NAMES[to], needs } : null;
}
const plural = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? 'очко' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'очка' : 'очков');
