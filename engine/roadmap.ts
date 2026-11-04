/**
 * «Из А в Б» — дорожная карта (D122): от того положения, в котором человек сейчас, к хорошему — по шагам, на его цифрах.
 * «Хорошее» здесь — та же лестница, что у «Твоего этапа» (D115): выйти в плюс → запас на месяц → подушка → копить на цели → запас на год.
 * Для каждого шага: сколько денег нужно, сколько не хватает и к какому месяцу это будет при нынешнем темпе, а у шага «сейчас» —
 * что даст добавка в месяц (меньше тратить или больше получать — для денежного потока одно и то же).
 *
 * Темп — не среднее, а помесячный прогноз («деньги на конец месяца»): конец стипендии, окончание рассрочек и плановые события
 * в нём видны, поэтому «к январю» не врёт, когда через полгода доход упадёт. Опирается только на то, что есть в бэкапе:
 * наличные и долги вне MoneyManager не видны. Состояние не меняется.
 * (Обратный расчёт «успеть к дате» остался как был — `planToGoal` в `route.ts`.)
 */
import type { IsoDate, MonthKey } from './date';
import { listOrder } from './ladder';
import { mulDiv, ZERO, type Money } from './money';
import { liquidReachMonth, personStage, type PersonStage } from './stage';
import { baseForecast } from './simple';
import type { SimResult } from './simulate';
import type { AppState } from './state';
import { buildOverview } from './overview';

export type RoadmapStepId = 'plus' | 'month' | 'cushion' | 'goals' | 'year';
export type RoadmapStatus = 'done' | 'now' | 'next';

/** Что даст добавка к откладываемому: «+15 000 ₸ в месяц → к декабрю, на 1 мес. раньше». */
export interface RoadmapSpeedUp {
  extraMonthly: Money;
  by: MonthKey | null;
  /** На сколько месяцев раньше, чем как сейчас (null — как сейчас не набирается, а так набирается; или не набирается совсем). */
  monthsSooner: number | null;
}

export interface RoadmapGoal {
  id: string;
  title: string;
  target: Money;
  progress: Money;
  /** Когда набирается по прогнозу как сейчас (null — не за срок прогноза). */
  date: MonthKey | null;
}

export interface RoadmapStep {
  id: RoadmapStepId;
  title: string;
  status: RoadmapStatus;
  /** Зачем этот шаг — одна фраза. */
  why: string;
  /** Сколько денег должно быть (шаги-запасы); null у остальных. */
  target: Money | null;
  /** Сколько не хватает: для запасов — всего, для «выйти в плюс» — в месяц (`monthly`). */
  missing: Money;
  monthly: boolean;
  /** К какому месяцу при нынешнем темпе; null — не за срок расчёта. Для «выйти в плюс» — с какого месяца доходы сойдутся сами. */
  by: MonthKey | null;
  /** Только у шага «сейчас» из запасов: что даст добавка в месяц. */
  speedUp: RoadmapSpeedUp[];
  /** Только у «Копить на цели»: ближайшие цели. */
  goals: RoadmapGoal[];
}

export interface Roadmap {
  /** Откуда: «Твой этап». */
  from: PersonStage;
  steps: RoadmapStep[];
  /** Все шаги пройдены — положение хорошее. */
  allDone: boolean;
  /** Деньги сейчас, которые считаются запасом. */
  liquid: Money;
  /** Сколько в месяц уходит вместе с платежами по долгам — по нему считается «на сколько месяцев хватит». */
  needMonthly: Money;
  /** Платежи по долгам кончатся: с какого месяца и сколько в месяц освободится. null — платежей нет или не кончаются за срок расчёта. */
  debtFree: { from: MonthKey; freed: Money } | null;
}

const HORIZON = 60;
/** Добавки в месяц, для которых считаем «что будет»: доли от обычных месячных расходов. */
const SPEED_UP_PCT = [10, 20, 30];
/** Круглим добавки до 5 000 ₸ (в тиынах), чтобы они читались как «взять и сделать». */
const ROUND = 500_000;

const flow = (m: SimResult['months'][number]): Money => (m.income - m.expenses - m.obligations - m.events) as Money;
const diffMonths = (a: MonthKey, b: MonthKey): number => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

export function roadmap(state: AppState, today: IsoDate): Roadmap | null {
  const from = personStage(state, today);
  if (!from || from.needMonthly <= 0) return null;
  const o = buildOverview(state, today);
  const sim = baseForecast(state, today, HORIZON);
  const cover = from.coverMonths ?? 999;
  const { liquid, needMonthly, cushionMonths } = from;
  const need = (n: number): Money => mulDiv(needMonthly, n, 1);
  const lack = (n: number): Money => Math.max(0, need(n) - liquid) as Money;
  const saving = from.surplusMonthly > 0;

  // с какого месяца доходы сойдутся с тратами сами (и дальше не расходятся): кончились рассрочки, пошла новая работа, плановое событие
  const flows = sim.months.slice(1).map(flow);
  let selfFix: MonthKey | null = null;
  for (let i = flows.length - 1; i >= 0 && flows[i]! > 0; i--) selfFix = sim.months[i + 1]!.month;

  // платежи по долгам: когда кончатся и сколько освободится в месяц
  let debtFree: Roadmap['debtFree'] = null;
  const first = sim.months[1]?.obligations ?? ZERO;
  if (first > 0) {
    const end = sim.months.findIndex((m, i) => i >= 1 && m.obligations === 0);
    if (end > 0) debtFree = { from: sim.months[end]!.month, freed: first };
  }

  /** Шаг-запас: «на n месяцев без дохода». Пройден по тому же правилу, что и ступень «Твоего этапа»: денег хватает, если доход пропадёт (с ростом цен). */
  const reserve = (id: RoadmapStepId, title: string, why: string, n: number): RoadmapStep => {
    const target = need(n);
    const done = cover >= n;
    return { id, title, status: done ? 'done' : 'next', why, target, missing: done ? ZERO : lack(n), monthly: false, by: done ? null : liquidReachMonth(sim, target), speedUp: [], goals: [] };
  };

  const plus: RoadmapStep = { id: 'plus', title: 'Выйти в плюс', status: saving ? 'done' : 'next', why: 'Пока траты больше доходов, запас не растёт, а тает.', target: null, missing: Math.max(0, -from.surplusMonthly) as Money, monthly: true, by: saving ? null : selfFix, speedUp: [], goals: [] };
  const month = reserve('month', 'Запас на месяц', 'Месяц без дохода: хватит пережить неожиданный расход.', 1);
  const cushion = reserve('cushion', `Подушка на ${cushionMonths === 1 ? 'месяц' : `${cushionMonths} мес.`}`, 'Если доход пропадёт, продержишься несколько месяцев и успеешь найти выход.', cushionMonths);
  const year = reserve('year', 'Запас на год', 'Год без дохода: деньги работают на тебя, а не ты на деньги.', 12);

  const cushionGoalId = state.goals.find((g) => g.role === 'safety' && g.parentId === undefined && g.status === 'active')?.id;
  const goals: RoadmapGoal[] = listOrder(o.goals)
    .filter((g) => g.status === 'active' && !g.folder && g.id !== cushionGoalId && g.id in sim.goalDates && g.targetMin > 0)
    .slice(0, 4)
    .map((g) => ({ id: g.id, title: g.title, target: g.targetMin, progress: (o.fundings.filter((f) => f.goalId === g.id).reduce((a, f) => a + f.amount, 0)) as Money, date: sim.goalDates[g.id] ?? null }));
  // цели идут рядом с запасом на год, а не вместо него: как делить остаток между ними, решает человек (D115). Открыты, когда есть подушка
  const cushionDone = cushion.status === 'done';
  const goalsStep: RoadmapStep = {
    id: 'goals',
    title: 'Копить на цели',
    status: cushionDone ? (goals.length > 0 && goals.every((g) => g.progress >= g.target) ? 'done' : 'now') : 'next',
    why: 'Когда подушка есть, остаток каждого месяца работает на то, что тебе нужно.',
    target: null,
    missing: ZERO,
    monthly: false,
    by: null,
    speedUp: [],
    goals,
  };

  // лестница: плюс → месяц → подушка → год; первый непройденный шаг — «сейчас». Цели — рядом, между подушкой и годом
  const ladder = [plus, month, cushion, year];
  const now = ladder.find((s) => s.status !== 'done');
  if (now) now.status = 'now';
  const steps = [plus, month, cushion, goalsStep, year];
  const allDone = !now;

  // добавка в месяц — только у шага-запаса «сейчас»
  const cur = now;
  if (cur && cur.target !== null) {
    const baseBy = cur.by;
    // только добавки, которые что-то меняют: приближают месяц (или впервые делают запас достижимым); одинаковый месяц — оставляем меньшую
    const tries = SPEED_UP_PCT.map((p) => Math.max(ROUND, Math.round(mulDiv(needMonthly, p, 100) / ROUND) * ROUND) as Money);
    for (const extra of [...new Set(tries)]) {
      const by = liquidReachMonth(sim, cur.target, extra);
      if (by === null || (baseBy !== null && by >= baseBy) || cur.speedUp.some((x) => x.by === by)) continue;
      cur.speedUp.push({ extraMonthly: extra, by, monthsSooner: baseBy ? diffMonths(by, baseBy) : null });
    }
  }

  return { from, steps, allDone, liquid, needMonthly, debtFree };
}
