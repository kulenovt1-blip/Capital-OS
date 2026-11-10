/**
 * T10 «Положение» v4: независимость и уровень L5 (решения 3–5, D126, D137; спец. 10.1, t00-decisions раздел 4).
 *
 * Это сценарная оценка при названных допущениях, а не гарантия: слова «безопасно», «гарантированно», «обеспечено» в строках
 * этого модуля не используются (проверяется тестом по стемам).
 *
 *  K — инвестируемый капитал: деньги и активы, доступные не позже чем через 30 дней, минус долг людям; счета вида
 *      «неинвестируемое» (жильё, закрытое) не входят (D132: доступность решает запас N1, вид — состав K).
 *  C = K · w / (12 · need_Ж)  — какую долю расходов покрывает изъятие по ставке w (реальной, в тенге, в год).
 *  P = 0,9 · Σ (R_i · idx_i) / need_Ж — независимые поступления: подтверждённые (статус P), «пассивные» и «не из этих активов»,
 *      с коэффициентом 1 (индексируются) или 0,5 (иначе и «не указано»). Порога у P нет — это факт (решение 5).
 *  L5, если одновременно: C + P ≥ 1,25 по центральной ставке; устойчивость потока 12 · дефицит ≤ K · w (центральная);
 *      не сработал ни один ограничитель; нет долговой спирали; данных достаточно для вывода (иначе «не оценена», а не отказ).
 *  Консервативное значение C + P возвращается всегда рядом с центральным.
 *
 * Единицы: тенге (не тиыны), как в indicators.ts. Чистая функция состояния и даты; желаемые расходы не участвуют (решение 8).
 */
import type { AppState } from '../state';
import { addDays, type IsoDate } from '../date';
import { buildOverview } from '../overview';
import { liquidOn } from '../ledger';
import { buildPositionSeries } from './series';
import { computeIndicators } from './indicators';
import { limitStates, withoutForecast, LIMIT_IDS, type LimitId } from './limits';
import { computeRunway } from './runway';
import { spiralSigns } from './spiral';
import { confidenceOf, isPreliminary } from './confidence';
import { incomeSourcesOf } from './sources';
import { incomeOrigin, incomeIndexFactor } from './settings';
import type { PositionLevel } from './level';

/** Порог L5: C + P по центральной ставке, запас 25 % (решение 4). Не вывод из вероятности — защита от ошибки модели. */
export const INDEPENDENCE_THRESHOLD = 1.25;
/** Налог на независимые поступления (H, спец. 10.1). */
export const PASSIVE_TAX = 0.1;
/** Горизонт без возраста, лет. */
export const HORIZON_DEFAULT_YEARS = 50;
/** Принцип планирования на долгую жизнь: горизонт = 90 − возраст (не статистика). */
export const HORIZON_PLAN_AGE = 90;
export const HORIZON_MIN_YEARS = 30;
/** Верх таблицы ставок; дальше модель не оценена. */
export const HORIZON_MAX_YEARS = 60;
/** Деньги доступны для K не позже чем через столько дней. */
export const K_HORIZON_DAYS = 30;

export type RateSet = 'central' | 'conservative';
/**
 * Ставки изъятия, реальные, в тенге, в год, структура «разнесённая» (40 % вклад / 30 % доллары / 30 % акции); спец. 10.4, model-final 4.2.
 * Узлы таблицы — 40 / 50 / 60 лет. Центральный набор: курс возвращается к паритету покупательной способности со скоростью 20 % в год,
 * реальная доходность акций 5–6 %; консервативный — без возврата курса.
 */
const RATE_NODES: Readonly<Record<RateSet, readonly [number, number][]>> = {
  central: [[40, 0.022], [50, 0.019], [60, 0.016]],
  conservative: [[40, 0.011], [50, 0.008], [60, 0.005]],
};

/** Горизонт, лет: 90 − возраст в пределах 30–60; без возраста — 50. */
export function horizonYears(age?: number): number {
  if (age === undefined || !Number.isFinite(age)) return HORIZON_DEFAULT_YEARS;
  return Math.min(HORIZON_MAX_YEARS, Math.max(HORIZON_MIN_YEARS, HORIZON_PLAN_AGE - age));
}

/**
 * Ставка по горизонту: в узлах — из таблицы, между узлами — линейно (D137). Короче 40 лет таблица не оценена: берётся ставка 40 лет
 * (не завышает допустимое изъятие); длиннее 60 — ставка 60 лет.
 */
export function withdrawalRate(set: RateSet, horizon: number): number {
  const n = RATE_NODES[set];
  if (horizon <= n[0]![0]) return n[0]![1];
  for (let i = 1; i < n.length; i++) {
    const [h0, r0] = n[i - 1]!, [h1, r1] = n[i]!;
    if (horizon <= h1) return r0 + ((r1 - r0) * (horizon - h0)) / (h1 - h0);
  }
  return n[n.length - 1]![1];
}

/** Капитал, при котором C + P достигает `target` (при данных P, расходах и горизонте); не ниже нуля. */
export function requiredCapital(i: { need: number; horizon: number; p: number; target: number; set: RateSet }): number {
  const w = withdrawalRate(i.set, i.horizon);
  return Math.max(0, ((i.target - i.p) * 12 * i.need) / w);
}

/** Чего не хватает, чтобы вынести суждение о независимости. */
export type IndependenceMissing = 'no_data' | 'history' | 'expenses' | 'confidence';
/** Почему независимость не подтверждена (при достаточных данных). */
export type IndependenceBlocker = 'coverage' | 'sustain' | 'limit' | 'spiral';

export interface PassiveInput { monthly: number; indexed: boolean }

export interface IndependenceInput {
  /** K, тенге. */
  capital: number;
  /** Обычный месяц с платежами по долгам, тенге. */
  need: number;
  /** Независимые поступления (уже отобранные: подтверждённые, «не из этих активов»). */
  passive: readonly PassiveInput[];
  /** Дефицит в месяц, тенге (0 — нет); null — не известен (мало истории). */
  deficit: number | null;
  horizon: number;
  /** Сработавшие ограничители. */
  limitsFired: readonly LimitId[];
  /** Признак долговой спирали; null — проверить нельзя (не блокирует, как и в D136). */
  spiral: boolean | null;
  missing: readonly IndependenceMissing[];
}

export interface IndependenceResult {
  /** confirmed — L5; not_confirmed — данных достаточно, но условия не выполнены; not_assessed — данных не хватает. */
  status: 'confirmed' | 'not_confirmed' | 'not_assessed';
  horizon: number;
  rates: Record<RateSet, number>;
  capital: number;
  need: number;
  c: Record<RateSet, number>;
  /** Доля расходов, покрытая независимыми поступлениями (показывается как факт, порога нет). */
  p: number;
  total: Record<RateSet, number>;
  sustain: { ok: boolean | null; deficitYear: number; withdrawalYear: number };
  /** Капитал, при котором C + P достигает порога L5 по центральной ставке (0 — уже достигнут за счёт P); для личного сценария и подсказок. */
  requiredCapital: number;
  blockers: IndependenceBlocker[];
  missing: IndependenceMissing[];
}

const EPS = 1e-9;

export function computeIndependence(i: IndependenceInput): IndependenceResult {
  const missing: IndependenceMissing[] = [...i.missing];
  if (!(i.need > 0) && !missing.includes('no_data') && !missing.includes('expenses')) missing.push('expenses');
  // дефицит неизвестен — устойчивость потока проверить нельзя, значит вывод о независимости сделать нельзя
  if (i.deficit === null && !missing.includes('no_data') && !missing.includes('history')) missing.push('history');
  const rates: Record<RateSet, number> = { central: withdrawalRate('central', i.horizon), conservative: withdrawalRate('conservative', i.horizon) };
  const capital = Math.max(0, i.capital);
  const c = (r: number): number => (i.need > 0 ? (capital * r) / (12 * i.need) : 0);
  const p = i.need > 0 ? (1 - PASSIVE_TAX) * i.passive.reduce((a, s) => a + s.monthly * (s.indexed ? 1 : 0.5), 0) / i.need : 0;
  const cc = { central: c(rates.central), conservative: c(rates.conservative) };
  const total = { central: cc.central + p, conservative: cc.conservative + p };
  const withdrawalYear = capital * rates.central;
  const deficitYear = i.deficit === null ? 0 : 12 * Math.max(0, i.deficit);
  const sustainOk = i.deficit === null ? null : deficitYear <= withdrawalYear + 1e-6;

  const blockers: IndependenceBlocker[] = [];
  if (total.central < INDEPENDENCE_THRESHOLD - EPS) blockers.push('coverage');
  if (sustainOk === false) blockers.push('sustain');
  if (i.limitsFired.length > 0) blockers.push('limit');
  if (i.spiral === true) blockers.push('spiral');

  const status = missing.length > 0 ? 'not_assessed' : blockers.length === 0 ? 'confirmed' : 'not_confirmed';
  return {
    status, horizon: i.horizon, rates, capital, need: i.need, c: cc, p, total,
    sustain: { ok: sustainOk, deficitYear, withdrawalYear },
    requiredCapital: i.need > 0 ? requiredCapital({ need: i.need, horizon: i.horizon, p, target: INDEPENDENCE_THRESHOLD, set: 'central' }) : 0,
    blockers: status === 'not_assessed' ? [] : blockers,
    missing,
  };
}

/** Фиксированные формулировки (D126): допущения называются вслух, слов «безопасно», «гарантированно», «обеспечено» нет. */
export const INDEPENDENCE_TEXTS = {
  assumptions: 'оценка при допущениях: реальный курс тенге возвращается к паритету покупательной способности со скоростью 20 % в год; реальная доходность акций 5–6 %',
  l5Label: 'независимость при центральных допущениях с запасом 25 %',
  l5Note: 'Для живущих на капитал показатели накопления (N2, V4, F2, F4) не отражают риск; уровень определён по независимости',
  scenarioNote: 'Это сценарная оценка, не гарантия: при других допущениях результат другой',
  centralLabel: 'при центральных допущениях',
  conservativeLabel: 'при консервативных допущениях',
  syntheticNote: 'Доли успеха получены на синтетических сценариях и не описывают реальную жизнь',
} as const;

const MISSING_TEXT: Readonly<Record<IndependenceMissing, string>> = {
  no_data: 'операций в бэкапе',
  history: 'истории не менее 3 полных месяцев (дефицит потока не определить)',
  expenses: 'данных об обычных расходах',
  confidence: 'достоверности данных (меньше половины)',
};

/** Строка «независимость не оценена: не хватает …» (решение 3). */
export const notAssessedLine = (missing: readonly IndependenceMissing[]): string =>
  `независимость не оценена: не хватает ${missing.map((m) => MISSING_TEXT[m]).join(', ')}`;

/** Независимость по состоянию бэкапа. */
export function independenceOfState(state: AppState, today: IsoDate): IndependenceResult {
  const horizon = horizonYears(state.settings.position?.age);
  const series = buildPositionSeries(state, today);
  if (!series.hasData) {
    return computeIndependence({ capital: 0, need: 0, passive: [], deficit: null, horizon, limitsFired: [], spiral: null, missing: ['no_data'] });
  }
  const rep = computeIndicators(state, today, series);
  const inputs = rep.inputs!;
  const missing: IndependenceMissing[] = [];

  // K: доступное за 30 дней, без счетов «неинвестируемое», минус долг людям
  const cap = buildOverview(state, today).capital;
  const notInvestable = new Set(state.manualAccounts.filter((a) => a.assetKind === 'non_investable').map((a) => a.id));
  const liquid = liquidOn({ ...cap, accounts: cap.accounts.filter((a) => !notInvestable.has(a.accountId)) }, addDays(today, K_HORIZON_DAYS));
  const capital = Math.max(0, (liquid - cap.liabilities.payablesFromOps) / 100);

  // P: подтверждённые (P), действующие, пассивные и «не из этих активов»
  const status = new Map(incomeSourcesOf(state, today).map((s) => [s.id, s.status]));
  const passive: PassiveInput[] = state.settings.incomeSchedule
    .filter((x) => incomeOrigin(x) === 'independent' && status.get(x.id) === 'P' && (!x.start || x.start <= today) && (!x.end || x.end >= today))
    .map((x) => ({ monthly: x.amount / 100, indexed: incomeIndexFactor(x) === 1 }));

  // дефицит: нет трёх полных месяцев — неизвестен
  const runway = computeRunway(series, inputs.needEssential);
  if (runway.status === 'no_data') missing.push('history');
  if (isPreliminary(confidenceOf(state, today))) missing.push('confidence');

  // ограничители проверяются по условиям (а не по срезу G): независимость не должна зависеть от того, куда упал G
  const states = rep.values.F2 === null ? withoutForecast(limitStates(inputs, rep.forecast!)) : limitStates(inputs, rep.forecast!);
  const limitsFired = LIMIT_IDS.filter((id) => states[id] === 'yes');

  return computeIndependence({
    capital, need: inputs.needLifestyle, passive,
    deficit: runway.status === 'no_data' ? null : runway.deficit,
    horizon, limitsFired, spiral: spiralSigns(series).spiral, missing,
  });
}

export type FinalLevel = 1 | 2 | 3 | 4 | 5;
export const L5_NAME = 'Свобода выбора';

export interface FinalLevelResult {
  /** null — оценить нечем (нет данных). */
  level: FinalLevel | null;
  name: string | null;
  /** independence — L5 по независимости; score — по G; none — нет данных. */
  basis: 'independence' | 'score' | 'none';
  /** При L5: пометка для живущих на капитал. */
  note?: string;
  /** Если независимость не оценена: «независимость не оценена: не хватает …». */
  independenceLine?: string;
  independence: IndependenceResult;
  base: PositionLevel | null;
}

/** L5 — ветка, проверяемая первой: подтверждена независимость → L5 при любом G; иначе уровень L1–L4 по G без изменений. */
export function levelWithIndependence(base: PositionLevel | null, independence: IndependenceResult): FinalLevelResult {
  if (independence.status === 'confirmed') {
    return { level: 5, name: L5_NAME, basis: 'independence', note: INDEPENDENCE_TEXTS.l5Note, independence, base };
  }
  const line = independence.status === 'not_assessed' ? notAssessedLine(independence.missing) : undefined;
  if (!base) return { level: null, name: null, basis: 'none', ...(line ? { independenceLine: line } : {}), independence, base };
  return { level: base.result.level, name: base.result.name, basis: 'score', ...(line ? { independenceLine: line } : {}), independence, base };
}
