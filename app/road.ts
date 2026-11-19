/**
 * «Дорога» (дизайн A+): что нужно, чтобы подняться на следующую ступень, — условиями с цифрами.
 * Чистая функция над `PositionView`: ничего не считает заново, только раскладывает уже посчитанное движком
 * (запас, общая оценка, направления) в строки «сколько есть из сколько нужно». Математику движка не меняет.
 */
import { L3_RESERVE_MONTHS, L4_RESERVE_MONTHS, type Money, type MonthKey, shownScore, type PositionView, type ReserveTarget, type Route, type SavingReport } from '../engine/index';

/** Запас — округление вниз до десятых, как на «Профиле» и «Обзоре»: 5,96 → «5,9». */
const nfDown = (x: number): string => (Math.floor(x * 10 + 1e-9) / 10).toFixed(1).replace('.', ',');

export interface RoadCond {
  title: string;
  /** Что есть сейчас: «4,5 из 6 мес.», «71 из 75», «выполнено»; пусто — условие только словами. */
  value: string;
  /** 0–1 для полоски; null — полоска не нужна. */
  ratio: number | null;
  done: boolean;
  /** Запас/оценка — условия, которые можно подвинуть деньгами; нужны экрану, чтобы повесить «Посчитать путь» к запасу. */
  kind: 'reserve' | 'score' | 'directions' | 'text';
  /** Одна строка под условием: что именно тянет вниз (из уже посчитанного, ничего не выдумываем). Пусто — нечего добавить. */
  hint?: string;
}

export interface RoadModel {
  /** «Ступень 1 пройдена» / «Ступени 1 и 2 пройдены»; null — пройденных нет. */
  passed: string | null;
  current: { level: number; name: string };
  next: { level: number; name: string; conds: RoadCond[] };
  /** Ступени после следующей — одной строкой в конце дороги. */
  rest: { level: number; name: string }[];
}

const SCORE_THRESHOLD: Record<number, number> = { 2: 20, 3: 40, 4: 75 };

/**
 * null — дорогу не рисуем: уровня нет, ступень уже 4 и выше (дальше «Независимость» со своим блоком) или движок не назвал следующую.
 * Условия идут в порядке «что поддаётся деньгами → оценка → направления → слова».
 */
export function roadOf(v: PositionView): RoadModel | null {
  if (v.level === null || v.levelName === null || v.level > 3 || !v.next) return null;
  const to = v.next.level;
  const conds: RoadCond[] = [];

  const reserveTarget = to === 3 ? L3_RESERVE_MONTHS : to === 4 ? L4_RESERVE_MONTHS : null;
  if (reserveTarget !== null) {
    const r = v.money.reserveEssentialMonths;
    if (v.essentialUnknown) conds.push({ title: 'Запас на жизнь', value: 'пока не определить — отметь, что обязательно', ratio: 0, done: false, kind: 'reserve' });
    else conds.push({ title: 'Запас на жизнь', value: r >= reserveTarget ? `выполнено · ${nfDown(r)} мес.` : `${nfDown(r)} из ${reserveTarget} мес.`, ratio: Math.max(0, Math.min(1, r / reserveTarget)), done: r >= reserveTarget, kind: 'reserve' });
  }

  const thr = SCORE_THRESHOLD[to];
  if (thr !== undefined && v.g !== null) {
    const weakHint = v.g < thr && v.weak ? `Слабее всего: ${v.weak.directionName}${v.weak.indicator ? ` · ${v.weak.indicator.label}` : ''}` : undefined;
    conds.push({ title: 'Общая оценка', value: v.g >= thr ? `выполнено · ${shownScore(v.g)}` : `${shownScore(v.g)} из ${thr}`, ratio: Math.max(0, Math.min(1, v.g / thr)), done: v.g >= thr, kind: 'score', ...(weakHint ? { hint: weakHint } : {}) });
  }

  if (to === 4) {
    const low = v.directions.filter((d) => d.score !== null && d.score < 60);
    const unknown = v.directions.some((d) => d.score === null);
    conds.push({
      title: 'Каждое направление от 60',
      value: low.length ? low.map((d) => `${d.name} ${shownScore(d.score!)}`).join(', ') : unknown ? 'данных мало' : 'выполнено',
      ratio: null,
      done: !low.length && !unknown,
      kind: 'directions',
    });
  }

  // условия, которые движок формулирует только словами: ограничения оценки и «доходы покрывают расходы»
  for (const need of v.next.needs) {
    if (need.startsWith('снять ограничение') || need.includes('доходы покрывали')) conds.push({ title: need.charAt(0).toUpperCase() + need.slice(1), value: '', ratio: null, done: false, kind: 'text' });
  }

  const passed = v.level === 1 ? null : v.level === 2 ? 'Ступень 1 пройдена' : 'Ступени 1 и 2 пройдены';
  return {
    passed,
    current: { level: v.level, name: v.levelName },
    next: { level: to, name: v.next.name, conds },
    rest: v.ladder.filter((l) => l.level > to).map((l) => ({ level: l.level, name: l.name })),
  };
}

// ───────────────────────── «Как выполнить» (D3, вариант 3: из реальных данных) ─────────────────────────

export interface RoadHowSaving { categoryId: string; title: string; monthly: Money; cutPerMonth: Money; gain12: Money }
export interface RoadHowReserve {
  /** Запас на сколько месяцев нужен. */
  target: ReserveTarget;
  missing: Money;
  /** Траты больше доходов на столько в месяц (0 — нет). */
  deficitMonthly: Money;
  /** К какому месяцу при нынешнем темпе; null — не за пять лет. */
  by: MonthKey | null;
  /** «Откладывать сверху ≈ X в месяц, чтобы успеть за N месяцев» — только те сроки, где добавка нужна. */
  deadlines: { months: number; month: MonthKey; extraMonthly: Money }[];
  debtFree: { from: MonthKey; freed: Money } | null;
  /** Самые крупные траты и что даст урезание на SAVING_CUT_PCT %. */
  savings: RoadHowSaving[];
}
export interface RoadHowWeak { direction: 'N' | 'V' | 'F'; directionName: string; id: string; label: string; score: number }
export interface RoadHow {
  /** null — условие запаса выполнено или к нему не сводится. */
  reserve: RoadHowReserve | null;
  /** Самые слабые показатели (ниже 60), не больше трёх; пусто — тянуть нечего. */
  weak: RoadHowWeak[];
}

/** Сколько категорий трат показываем на странице «Как выполнить». */
export const ROAD_HOW_SAVINGS = 3;
/** Показатель слабый, если ниже этой оценки (черта 60 — порог направления на ступень 4). */
export const ROAD_HOW_WEAK_BELOW = 60;

/**
 * Страница «Как выполнить»: ничего не придумывает, раскладывает то, что уже считают `routeTo` (сколько не хватает, добавка к сроку, когда кончатся платежи по долгам),
 * `savingOptions` (на что уходят деньги, что даст урезание) и `PositionView` (слабые показатели). Математику движка не меняет.
 */
export function roadHowOf(v: PositionView, route: Route | null, saving: SavingReport | null): RoadHow {
  const reserve: RoadHowReserve | null = route && route.missing > 0
    ? {
        target: route.to,
        missing: route.missing,
        deficitMonthly: route.deficitMonthly,
        by: route.by,
        deadlines: route.deadlines.filter((d) => d.extraMonthly > 0).map((d) => ({ months: d.months, month: d.month, extraMonthly: d.extraMonthly })),
        debtFree: route.debtFree,
        savings: (saving?.options ?? []).filter((o) => o.cut !== null).slice(0, ROAD_HOW_SAVINGS).map((o) => ({ categoryId: o.categoryId, title: o.title, monthly: o.monthly, cutPerMonth: o.cut!.perMonth, gain12: o.cut!.capitalGain12 })),
      }
    : null;
  const weak: RoadHowWeak[] = [];
  for (const d of v.directions) for (const i of d.indicators) if (i.score !== null && i.score < ROAD_HOW_WEAK_BELOW) weak.push({ direction: d.id, directionName: d.name, id: i.id, label: i.label, score: i.score });
  weak.sort((a, b) => a.score - b.score);
  return { reserve, weak: weak.slice(0, 3) };
}
