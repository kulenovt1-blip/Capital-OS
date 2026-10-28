/**
 * Распределение нового поступления (§5): шаг 0 → стратегии A–D → сравнение через симулятор (§5.3).
 * Ядро (шаг 0, лестница) — в ladder.ts; здесь — сравнение, объединение и «цена выбора».
 */
import { add, ZERO, type Money } from './money';
import { monthsBetween, type MonthKey } from './date';
import { money, step, type Explanation } from './explain';
import type { Goal, GoalId } from './goals';
import {
  defaultFocus, eligibleGoals, isReserve, ladder, step0, STRATEGY_LABELS, validateCustomStrategy,
  type Allocation, type StrategyId, type StrategyParams, type StrategySettings, type Step0Input, type Step0Result,
} from './ladder';
import { BASE_SCENARIO, simulate, type Gap, type SimInput } from './simulate';

export * from './ladder';

export interface CompareInput {
  step0: Step0Input;
  goals: Goal[];
  progress: ReadonlyMap<GoalId, Money>;
  fundedThisMonth: ReadonlyMap<GoalId, Money>;
  /** Параметры симулятора без стратегии и прогресса — их подставляет сравнение. */
  sim: Omit<SimInput, 'strategy' | 'progress' | 'goals'> & Partial<Pick<SimInput, 'strategy' | 'progress' | 'goals'>>;
  strategies: StrategyParams[];
  /** Стратегия «текущего плана» — относительно неё считается сдвиг дат. */
  planStrategy: StrategyId;
  settings: StrategySettings;
}

export interface StrategyRow {
  /** Несколько id, если стратегии объединены. */
  ids: StrategyId[];
  strategy: StrategyParams;
  label: string;
  byGoal: Record<GoalId, Money>;
  allocations: Allocation[];
  free: Money;
  underfunded: { goalId: GoalId; required: Money; given: Money }[];
  reserveMonthsTenths: number | null;
  goalDates: Record<GoalId, MonthKey | null>;
  /** Сдвиг даты цели относительно плана, мес. (− раньше, + позже). */
  shiftVsPlan: Record<GoalId, number | null>;
  capitalAfter: Record<number, Money | null>;
  gaps: Gap[];
  violations: string[];
  /** Месяц, когда резерв достигает минимума (null — за горизонтом). */
  reserveMinMonth: MonthKey | null;
  price: string;
  explanation: Explanation;
  assumptions: string[];
}

export interface CompareResult {
  step0: Step0Result;
  rows: StrategyRow[];
  merged: { ids: StrategyId[]; reason: string }[];
  explanation: Explanation;
}

function monthDiff(a: MonthKey, b: MonthKey): number {
  return monthsBetween(`${a}-01`, `${b}-01`);
}

export function compareStrategies(ci: CompareInput): CompareResult {
  const s0 = step0(ci.step0);
  const explanation: Explanation = [...s0.explanation];
  if (!s0.ok) return { step0: s0, rows: [], merged: [], explanation };

  const { list } = eligibleGoals(ci.goals);
  const reserve = list.filter(isReserve).sort((a, b) => b.importance - a.importance || (a.id < b.id ? -1 : 1))[0];
  const rows: StrategyRow[] = [];
  for (const st0 of ci.strategies) {
    const st: StrategyParams = st0.id === 'C' && !st0.focusGoalIds?.length ? { ...st0, focusGoalIds: defaultFocus(list.filter((g) => !isReserve(g))) } : st0;
    if (st.id === 'D') {
      const errs = st.custom ? validateCustomStrategy(st.custom, ci.goals) : ['не заданы параметры'];
      if (errs.length) {
        explanation.push(step('compare.d_invalid', `Своя стратегия не построена: ${errs.join('; ')}`, { level: 'warn' }));
        continue;
      }
    }
    const r = ladder({ amount: s0.available, today: ci.step0.today, goals: ci.goals, progress: ci.progress, fundedThisMonth: ci.fundedThisMonth, strategy: st, settings: ci.settings });
    const after = new Map(ci.progress);
    for (const [g, a] of Object.entries(r.byGoal)) after.set(g, add(after.get(g) ?? ZERO, a));
    const sim = simulate({ ...ci.sim, goals: ci.goals, progress: after, strategy: st } as SimInput, BASE_SCENARIO);
    const reserveNow = reserve ? (after.get(reserve.id) ?? ZERO) : ZERO;
    const reserveMinMonth = reserve ? (sim.months.find((m) => (m.goalProgress[reserve.id] ?? 0) >= reserve.targetMin)?.month ?? null) : null;
    rows.push({
      ids: [st.id],
      strategy: st,
      label: STRATEGY_LABELS[st.id],
      byGoal: r.byGoal,
      allocations: r.allocations,
      free: r.free,
      underfunded: r.underfunded,
      reserveMonthsTenths: reserve && ci.step0.baseMedian > 0 ? Math.floor((reserveNow * 10) / ci.step0.baseMedian) : null,
      goalDates: sim.goalDates,
      shiftVsPlan: {},
      capitalAfter: { 6: sim.capitalAfter[6] ?? null, 12: sim.capitalAfter[12] ?? null, 24: sim.capitalAfter[24] ?? null },
      gaps: sim.gaps,
      violations: sim.violations,
      reserveMinMonth,
      price: '',
      explanation: r.explanation,
      assumptions: sim.assumptions,
    });
  }

  // сдвиг относительно плана и «цена выбора»
  const plan = rows.find((r) => r.ids[0] === ci.planStrategy) ?? rows[0];
  const title = (id: string) => ci.goals.find((g) => g.id === id)?.title ?? id;
  for (const row of rows) {
    for (const [g, d] of Object.entries(row.goalDates)) {
      const p = plan?.goalDates[g];
      row.shiftVsPlan[g] = d && p ? monthDiff(p, d) : d === p ? 0 : null;
    }
    row.price = priceOf(row, plan, title, reserve);
  }

  // объединение одинаковых распределений (с точностью до mergeTolerance)
  const merged: CompareResult['merged'] = [];
  const out: StrategyRow[] = [];
  for (const row of rows) {
    const idx = out.findIndex((o) => sameAllocation(o, row, ci.settings.mergeTolerance));
    if (idx < 0) {
      out.push({ ...row, ids: [...row.ids] });
      continue;
    }
    const ids = [...out[idx]!.ids, ...row.ids];
    // если в группе стратегия плана — показываем её прогноз: дальнейшее помесячное распределение у стратегий разное
    out[idx] = row.ids[0] === ci.planStrategy ? { ...row, ids } : { ...out[idx]!, ids };
  }
  for (const o of out) {
    if (o.ids.length < 2) continue;
    const labels = o.ids.map((id) => `${id} «${STRATEGY_LABELS[id]}»`).join(', ');
    const all = out.length === 1;
    const shown = STRATEGY_LABELS[o.strategy.id];
    const reason = `${all ? 'Все стратегии сведены к одному варианту' : `${labels} совпали`}: доступно только ${money(s0.available)} после обязательств и расходов до следующего дохода, и при любой стратегии оно уходит на одни и те же цели (разница меньше ${money(ci.settings.mergeTolerance)}). Даты целей — при дальнейшем распределении по стратегии «${shown}»`;
    merged.push({ ids: o.ids, reason });
    o.label = o.ids.map((id) => STRATEGY_LABELS[id]).join(' = ');
    o.price = reason;
    explanation.push(step('compare.merged', reason));
  }
  return { step0: s0, rows: out, merged, explanation };
}

function sameAllocation(a: StrategyRow, b: StrategyRow, tol: Money): boolean {
  const keys = new Set([...Object.keys(a.byGoal), ...Object.keys(b.byGoal)]);
  for (const k of keys) if (Math.abs((a.byGoal[k] ?? 0) - (b.byGoal[k] ?? 0)) >= tol) return false;
  return Math.abs(a.free - b.free) < tol;
}

/** «Цена выбора» одной фразой из объяснения: что ускоряется, что замедляется, что с резервом и разрывами. */
function priceOf(row: StrategyRow, plan: StrategyRow | undefined, title: (id: string) => string, reserve: Goal | undefined): string {
  const parts: string[] = [];
  const minus: string[] = [];
  if (plan && row !== plan) {
    const shifts = Object.entries(row.shiftVsPlan).filter(([, v]) => v !== null && v !== 0) as [string, number][];
    const faster = shifts.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
    const slower = shifts.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    for (const [g, v] of faster.slice(0, 2)) parts.push(`ускоряет «${title(g)}» на ${-v} мес.`);
    for (const [g, v] of slower.slice(0, 2)) minus.push(`замедляет «${title(g)}» на ${v} мес.`);
    if (!faster.length && !slower.length) parts.push(`сроки целей те же, что у «${plan.label}»`);
  } else {
    parts.push('текущий план — база для сравнения');
  }
  if (reserve) {
    const rm = row.reserveMinMonth;
    if (rm === null) minus.push(`резерв ниже минимума весь горизонт`);
    else if (plan && row !== plan && plan.reserveMinMonth && rm !== plan.reserveMinMonth) (rm > plan.reserveMinMonth ? minus : parts).push(`резерв достигает минимума в ${rm} (в плане — ${plan.reserveMinMonth})`);
    else if (row === plan || !plan) parts.push(`резерв на минимуме с ${rm}`);
  }
  if (row.underfunded.length) minus.push(`недофинансировано: ${row.underfunded.map((u) => `«${title(u.goalId)}»`).join(', ')}`);
  if (row.gaps.length) minus.push(`кассовый разрыв с ${row.gaps[0]!.start}`);
  if (row.free > 0) parts.push(`свободно ${money(row.free)}`);
  const head = `${row.label}: ${parts.join(', ')}`;
  return minus.length ? `${head}, но ${minus.join(', ')}` : head;
}

