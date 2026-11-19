/**
 * «План» (D217, решение владельца 20.11.2026; раньше «Дорога»): что нужно, чтобы подняться на следующую ступень.
 * Условия — только факты-деньги (запас, минус в месяц, доля обязательного, сколько откладываешь). Общая оценка — не условие-галочка,
 * а шкала над условиями («7 из 100, для ступени 2 нужно 20»): её нельзя «выполнить», она растёт сама, когда меняются деньги.
 * Чистая функция над `PositionView`: ничего не считает заново, только раскладывает уже посчитанное движком. Математику движка не меняет.
 */
import { fmtShort } from './ui';
import { L3_RESERVE_MONTHS, L4_RESERVE_MONTHS, type Money, type MonthKey, shownScore, type PositionView, type ReserveTarget, type Route, type SavingReport } from '../engine/index';

/** Запас — округление вниз до десятых, как на «Профиле» и «Обзоре»: 5,96 → «5,9». */
const nfDown = (x: number): string => (Math.floor(x * 10 + 1e-9) / 10).toFixed(1).replace('.', ',');
const pct = (x: number): string => `${Math.round(x * 100)} %`;
/** Тенге → «≈ 110 тыс ₸», как везде в приложении. */
const approx = (tenge: number): string => `≈ ${fmtShort(Math.round(tenge * 100) as Money)}`;

export interface RoadCond {
  title: string;
  /** Что есть сейчас: «4,5 из 6 мес.», «62 % · нужно не больше 50 %», «выполнено»; пусто — условие только словами. */
  value: string;
  /** 0–1 для полоски; null — полоска не нужна. */
  ratio: number | null;
  done: boolean;
  /** reserve — запас на необходимое (к нему «Как дойти» считает путь); deficit — минус в месяц; life/share/rate/habit — условия ступени 5; text — ограничение словами. */
  kind: 'reserve' | 'deficit' | 'life' | 'share' | 'rate' | 'habit' | 'text';
  /** Одна строка под условием. */
  hint?: string;
}

/** Общая оценка — шкала над условиями: сколько есть из 100 и сколько нужно для следующей ступени. */
export interface RoadScore {
  have: number;
  need: number;
  done: boolean;
  /** Что тянет вниз: самое слабое направление и показатель; для ступени 4 — и направления ниже 60. */
  hint?: string;
}

export interface RoadModel {
  /** «Ступень 1 пройдена» / «Ступени 1 и 2 пройдены»; null — пройденных нет. */
  passed: string | null;
  current: { level: number; name: string };
  next: { level: number; name: string; conds: RoadCond[]; score: RoadScore | null };
  /** Ступени после следующей — одной строкой в конце плана. */
  rest: { level: number; name: string }[];
}

const SCORE_THRESHOLD: Record<number, number> = { 2: 20, 3: 40, 4: 75 };

/**
 * null — плана нет: уровня нет, ступень 5 (вершина) или движок не назвал следующую.
 * Условия идут в порядке «минус в месяц → запас → доля обязательного → откладывать → ограничения».
 */
export function roadOf(v: PositionView): RoadModel | null {
  if (v.level === null || v.levelName === null || v.level >= 5 || !v.next) return null;
  const to = v.next.level;
  const conds: RoadCond[] = [];

  // ступень 2: доходы покрывают расходы (или запас от 3 месяцев) — первым, потому что пока минус, любой запас тает
  if (to === 2 && v.next.needs.some((n) => n.includes('доходы покрывали'))) {
    const r = v.runway;
    conds.push({
      title: 'Доходы покрывают расходы',
      value: r.status === 'deficit' && r.deficit > 0 ? `сейчас минус ${approx(r.deficit)} в месяц` : '',
      ratio: null, done: false, kind: 'deficit',
      hint: `Или запас от ${L3_RESERVE_MONTHS} месяцев необходимых расходов`,
    });
  }

  const reserveTarget = to === 3 ? L3_RESERVE_MONTHS : to === 4 ? L4_RESERVE_MONTHS : null;
  if (reserveTarget !== null) {
    const r = v.money.reserveEssentialMonths;
    if (v.essentialUnknown) conds.push({ title: 'Запас на жизнь', value: 'пока не определить — отметь, что обязательно', ratio: 0, done: false, kind: 'reserve' });
    else conds.push({ title: 'Запас на жизнь', value: r >= reserveTarget ? `выполнено · ${nfDown(r)} мес.` : `${nfDown(r)} из ${reserveTarget} мес.`, ratio: Math.max(0, Math.min(1, r / reserveTarget)), done: r >= reserveTarget, kind: 'reserve', hint: r >= reserveTarget ? undefined : 'Сколько месяцев проживёшь без дохода на необходимом' });
  }

  if (to === 5 && v.l5) {
    const c = v.l5;
    conds.push({ title: 'Деньги на год обычной жизни', value: c.lifeReserve.ok ? `выполнено · ${nfDown(c.lifeReserve.have)} мес.` : `${nfDown(c.lifeReserve.have)} из ${c.lifeReserve.need} мес.`, ratio: Math.max(0, Math.min(1, c.lifeReserve.have / c.lifeReserve.need)), done: c.lifeReserve.ok, kind: 'life', hint: c.lifeReserve.ok ? undefined : 'Со всеми обычными тратами, не только необходимыми' });
    const sh = c.essentialShare.have;
    conds.push({ title: 'На обязательное — до половины дохода', value: sh === null ? 'дохода нет — не посчитать' : c.essentialShare.ok ? `выполнено · ${pct(sh)}` : `${pct(sh)} · нужно не больше ${pct(c.essentialShare.max)}`, ratio: sh === null ? 0 : Math.max(0, Math.min(1, c.essentialShare.max / sh)), done: c.essentialShare.ok, kind: 'share', hint: c.essentialShare.ok ? undefined : 'Еда, жильё, связь, дорога и платежи по долгам' });
    const sr = c.savingRate.have;
    conds.push({ title: 'Откладываешь от 10 % дохода', value: sr === null ? 'истории пока мало' : c.savingRate.ok ? `выполнено · ${pct(sr)}` : `${pct(Math.max(0, sr))} из ${pct(c.savingRate.min)}`, ratio: sr === null ? 0 : Math.max(0, Math.min(1, sr / c.savingRate.min)), done: c.savingRate.ok, kind: 'rate' });
    conds.push({ title: 'Откладываешь стабильно', value: c.habit.ok ? 'выполнено' : c.habit.have === null ? 'истории пока мало' : `${Math.round((c.habit.have / 100) * 6)} из 6 месяцев · нужно от 5`, ratio: c.habit.have === null ? 0 : Math.max(0, Math.min(1, c.habit.have / 100 / (5 / 6))), done: c.habit.ok, kind: 'habit', hint: c.habit.ok ? undefined : 'Месяцы, когда после всех трат что-то осталось' });
  }

  // ограничения оценки — словами: их снимают не очки, а сам факт
  for (const need of v.next.needs) {
    if (need.startsWith('снять ограничение')) conds.push({ title: need.replace('снять ограничение: ', '').replace(/^./, (x) => x.toUpperCase()), value: 'нужно исправить', ratio: null, done: false, kind: 'text' });
  }

  const thr = SCORE_THRESHOLD[to];
  let score: RoadScore | null = null;
  if (thr !== undefined && v.g !== null) {
    const low = to === 4 ? v.directions.filter((d) => d.score !== null && d.score < 60) : [];
    const weak = v.weak ? `Слабее всего: ${v.weak.directionName}${v.weak.indicator ? ` · ${v.weak.indicator.label}` : ''}` : '';
    const dirs = low.length ? `Для этой ступени каждое направление от 60: ${low.map((d) => `${d.name} ${shownScore(d.score!)}`).join(', ')}` : '';
    const done = v.g >= thr && !low.length;
    score = { have: shownScore(v.g), need: thr, done, ...(done ? {} : { hint: [dirs, weak].filter(Boolean).join('. ') || undefined }) };
  }

  const passed = v.level === 1 ? null : v.level === 2 ? 'Ступень 1 пройдена' : `Ступени ${Array.from({ length: v.level - 1 }, (_, i) => i + 1).join(', ').replace(/, (\d)$/, ' и $1')} пройдены`;
  return {
    passed,
    current: { level: v.level, name: v.levelName },
    next: { level: to, name: v.next.name, conds, score },
    rest: v.ladder.filter((l) => l.level > to).map((l) => ({ level: l.level, name: l.name })),
  };
}

/** На сколько хватит денег при минусе — словами (D217). «Хватит на 0 мес.» не говорим: это значит, что запаса нет и минус чем-то закрывается. */
export function leftText(m: number | null): string {
  if (m === null) return 'на сколько хватит денег, определить нельзя';
  if (m >= 600) return 'денег при этом хватит больше чем на 50 лет';
  if (m < 0.1) return 'запаса нет: минус каждый месяц чем-то закрывается — обычно долгами';
  if (m < 1) return 'денег хватит меньше чем на месяц';
  return `денег при этом хватит примерно на ${Math.round(m)} мес.`;
}

/** Ближайший шаг плана одной фразой (для «Обзора» и «Сегодня»). null — шагов нет. */
export function firstStepOf(m: RoadModel): { text: string; value: string; ratio: number | null } | null {
  const c = m.next.conds.find((x) => !x.done);
  if (c) {
    const text = c.kind === 'deficit' ? 'Выйти в плюс: доходы должны покрывать расходы'
      : c.kind === 'reserve' ? `Довести запас до ${m.next.level === 3 ? L3_RESERVE_MONTHS : L4_RESERVE_MONTHS} месяцев`
      : c.kind === 'life' ? 'Накопить на год обычной жизни'
      : c.kind === 'share' ? 'Снизить долю обязательного до половины дохода'
      : c.kind === 'rate' ? 'Откладывать от 10 % дохода'
      : c.kind === 'habit' ? 'Откладывать каждый месяц'
      : c.title;
    return { text, value: c.value, ratio: c.done ? 1 : c.ratio };
  }
  const s = m.next.score;
  if (s && !s.done) return { text: s.hint?.startsWith('Для этой ступени') ? 'Подтянуть слабое направление до 60' : 'Поднять общую оценку', value: `${s.have} из 100 · нужно ${s.need}`, ratio: Math.max(0, Math.min(1, s.have / s.need)) };
  return null;
}

// ───────────────────────── «Как дойти» (D3 → D217: из реальных данных) ─────────────────────────

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
}
export interface RoadHowWeak { direction: 'N' | 'V' | 'F'; directionName: string; id: string; label: string; score: number }
export interface RoadHow {
  /** Минус в месяц (тенге) — шаг первый, пока он есть, запас тает. null — минуса нет. */
  deficit: { monthly: number } | null;
  /** null — условие запаса выполнено, к нему не сводится или сначала нужно выйти в плюс. */
  reserve: RoadHowReserve | null;
  /** Самые крупные траты и что даст урезание на SAVING_CUT_PCT %: и для минуса, и для запаса. */
  savings: RoadHowSaving[];
  /** Самые слабые показатели (ниже 60), не больше трёх; пусто — тянуть нечего. */
  weak: RoadHowWeak[];
}

/** Сколько категорий трат показываем на странице «Как дойти». */
export const ROAD_HOW_SAVINGS = 3;
/** Показатель слабый, если ниже этой оценки (черта 60 — порог направления на ступень 4). */
export const ROAD_HOW_WEAK_BELOW = 60;

/**
 * Страница «Как дойти» (одна вместо «Посчитать путь» и «Как выполнить», D217): ничего не придумывает, раскладывает то, что уже считают `routeTo` (сколько не хватает, добавка к сроку, когда кончатся платежи по долгам),
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
      }
    : null;
  const deficit = v.runway.status === 'deficit' && v.runway.deficit > 0 ? { monthly: v.runway.deficit } : null;
  const savings = (saving?.options ?? []).filter((o) => o.cut !== null).slice(0, ROAD_HOW_SAVINGS).map((o) => ({ categoryId: o.categoryId, title: o.title, monthly: o.monthly, cutPerMonth: o.cut!.perMonth, gain12: o.cut!.capitalGain12 }));
  const weak: RoadHowWeak[] = [];
  for (const d of v.directions) for (const i of d.indicators) if (i.score !== null && i.score < ROAD_HOW_WEAK_BELOW) weak.push({ direction: d.id, directionName: d.name, id: i.id, label: i.label, score: i.score });
  weak.sort((a, b) => a.score - b.score);
  return { deficit, reserve, savings: deficit || reserve ? savings : [], weak: weak.slice(0, 3) };
}
