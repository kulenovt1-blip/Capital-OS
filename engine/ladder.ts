/**
 * Распределение поступления (§5): шаг 0 (доступная сумма) и общая «лестница», параметризованная стратегией.
 * Чистые функции; все коэффициенты — в StrategySettings, без скрытых констант.
 */
import { add, ceilTo, min, mulDiv, pos, sub, sum, tenge, tiyn, ZERO, type Money } from './money';
import { daysBetween, monthsBetween, type IsoDate } from './date';
import { day, money, step, type Explanation } from './explain';
import type { Goal, GoalId } from './goals';
import type { UpcomingPayment } from './obligations';

export type StrategyId = 'A' | 'B' | 'C' | 'D';

export const STRATEGY_LABELS: Record<StrategyId, string> = { A: 'Безопасность', B: 'Баланс', C: 'Ускорение', D: 'Своя' };

export interface StrategySettings {
  /** A: комфортный резерв = минимум × (б.п./10000), если у цели не задана комфортная сумма. */
  comfortReserveBp: number;
  /** A: доля остатка (уровень 3) в резерв, б.п. */
  cushionShareBp: number;
  /** Горизонт срочности в формуле urgency = 1 + max(0, U − мес.)/U, месяцев. */
  urgencyMonths: number;
  /** Шаг округления ежемесячного минимума вверх. */
  requiredStep: Money;
  /** Стратегии с разницей меньше этого по каждой цели объединяются. */
  mergeTolerance: Money;
}

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  comfortReserveBp: 15000,
  cushionShareBp: 7000,
  urgencyMonths: 12,
  requiredStep: tenge(100),
  mergeTolerance: tenge(1000),
};

export interface CustomStrategy {
  /** Цель резерва (уровень 1) — не ниже минимума резерва. */
  reserveTarget: Money;
  /** Фиксированные суммы уровня 2. */
  minimums: { goalId: GoalId; amount: Money }[];
  /** Доли остатка уровня 3, б.п. (Σ ≤ 10000). */
  rest: { goalId: GoalId; pctBp: number }[];
}

export interface StrategyParams {
  id: StrategyId;
  /** C: цели, на которые идёт весь остаток. По умолчанию — самая важная не-резервная. */
  focusGoalIds?: GoalId[];
  /** C: цели, которым пользователь разрешил 0 вместо минимума. */
  zeroMinimumGoalIds?: GoalId[];
  custom?: CustomStrategy;
}

// ───────────────────────── шаг 0 ─────────────────────────

export interface Step0Input {
  income: Money;
  today: IsoDate;
  /** Дата следующего ожидаемого поступления (после этого). */
  nextIncome: IsoDate;
  /** Все будущие неоплаченные платежи по обязательствам. */
  upcoming: readonly UpcomingPayment[];
  /** Медиана E_base за полные месяцы. */
  baseMedian: Money;
  /** Свободно на мгновенно доступных счетах (баланс − назначено), включая поступление, если оно уже в балансе. */
  liquidFreeBefore: Money;
  /** Деньги целей с ролью «обязательство» — уже зарезервированы под платежи. */
  obligationGoalFunds: Money;
  /** Поступление уже отражено в балансах (импорт после зачисления). */
  incomeInBalance: boolean;
  /** Цели с деньгами на ликвидных счетах — варианты при дефиците. */
  goalsWithLiquidFunds: readonly { goalId: GoalId; title: string; amount: Money; importance?: number }[];
}

export interface Step0Result {
  H: number;
  R1: Money;
  R1uncovered: Money;
  R2: Money;
  R2uncovered: Money;
  available: Money;
  ok: boolean;
  deficit: Money;
  payments: UpcomingPayment[];
  options: string[];
  explanation: Explanation;
}

/**
 * Доступно = Поступление − R1 − R2 (§5.1) с покрытием (DECISIONS D41):
 * деньги целей-обязательств и свободные деньги на счетах сначала покрывают R1, остаток свободных — R2.
 */
export function step0(i: Step0Input): Step0Result {
  const explanation: Explanation = [];
  const H = Math.max(0, daysBetween(i.today, i.nextIncome));
  const payments = i.upcoming.filter((u) => u.date >= i.today && u.date <= i.nextIncome);
  const R1 = sum(payments.map((p) => p.amount));
  // R2: медиана месяца × H / (365/12) — пропорционально дням
  const R2 = mulDiv(i.baseMedian, 12 * H, 365);

  const existingFree = pos(i.incomeInBalance ? sub(i.liquidFreeBefore, i.income) : i.liquidFreeBefore);
  const afterGoals = pos(sub(R1, i.obligationGoalFunds));
  const coverByFree = min(existingFree, afterGoals);
  const R1uncovered = sub(afterGoals, coverByFree);
  const freeLeft = sub(existingFree, coverByFree);
  const R2uncovered = pos(sub(R2, freeLeft));
  const available = sub(sub(i.income, R1uncovered), R2uncovered);
  const ok = available > 0;

  explanation.push(
    step('step0.horizon', `Горизонт до следующего дохода: ${H} дн. (до ${day(i.nextIncome)})`, { date: i.nextIncome }),
    step('step0.r1', `R1 — платежи по долгам и рассрочкам до ${day(i.nextIncome)}: ${money(R1)}${payments.length ? ' (' + payments.map((p) => `«${p.title}» ${money(p.amount)} ${day(p.date)}`).join(', ') + ')' : ''}`, { amount: R1 }),
  );
  if (i.obligationGoalFunds > 0) explanation.push(step('step0.r1_goals', `Из них покрыто деньгами целей-обязательств: ${money(min(R1, i.obligationGoalFunds))}`));
  if (coverByFree > 0) explanation.push(step('step0.r1_free', `Покрыто свободными деньгами на счетах: ${money(coverByFree)}`));
  explanation.push(
    step('step0.r2', `R2 — базовые расходы на ${H} дн.: медиана ${money(i.baseMedian)} × ${H} / (365/12) = ${money(R2)}${freeLeft > 0 ? `; свободные деньги покрывают ${money(min(R2, freeLeft))}` : ''}`, { amount: R2 }),
    step('step0.available', `Доступно = ${money(i.income)} − ${money(R1uncovered)} − ${money(R2uncovered)} = ${money(available)}`, { amount: available, level: ok ? 'info' : 'error' }),
  );

  const options: string[] = [];
  if (!ok) {
    const deficitNow = sub(ZERO, available);
    explanation.push(step('step0.deficit', `Дефицит ${money(deficitNow)}: дохода не хватает на платежи и обычные траты до следующего. Стратегии не строятся`, { level: 'error', amount: deficitNow }));
    for (const p of payments) options.push(`Перенести или разбить платёж «${p.title}» ${money(p.amount)} от ${day(p.date)} — договориться с банком или продавцом`);
    const goals = [...i.goalsWithLiquidFunds].filter((g) => g.amount > 0).sort((a, b) => (a.importance ?? 0) - (b.importance ?? 0) || (a.goalId < b.goalId ? -1 : 1));
    for (const g of goals) options.push(`Снять до ${money(min(g.amount, deficitNow))} с цели «${g.title}» (сейчас ${money(g.amount)} на ликвидных счетах)`);
    options.push('Ничего не гасить досрочно до следующего дохода');
    if (R2 > 0) options.push(`Сократить расходы до ${day(i.nextIncome)}: заложено ${money(R2)} базовых расходов`);
  }
  return { H, R1, R1uncovered, R2, R2uncovered, available, ok, deficit: ok ? ZERO : sub(ZERO, available), payments, options, explanation };
}

// ───────────────────────── лестница ─────────────────────────

export interface LadderInput {
  amount: Money;
  today: IsoDate;
  goals: readonly Goal[];
  /** Назначено напрямую каждой цели сейчас. */
  progress: ReadonlyMap<GoalId, Money>;
  /** Уже назначено в этом месяце (несколько доходов в месяц). */
  fundedThisMonth: ReadonlyMap<GoalId, Money>;
  strategy: StrategyParams;
  settings: StrategySettings;
}

export interface Allocation {
  goalId: GoalId;
  amount: Money;
  level: 1 | 2 | 3;
  reason: string;
}

export interface LadderResult {
  allocations: Allocation[];
  byGoal: Record<GoalId, Money>;
  free: Money;
  underfunded: { goalId: GoalId; required: Money; given: Money }[];
  /** Цели, которые этим распределением достигают минимума. */
  achieved: GoalId[];
  explanation: Explanation;
}

/** Цели, участвующие в распределении: активные листья с ненулевой суммой. Подцели наследуют срок родителя. */
export function eligibleGoals(goals: readonly Goal[]): { list: Goal[]; skippedUnconfirmed: Goal[] } {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const hasLiveChildren = new Set(goals.filter((g) => g.parentId !== undefined && g.status !== 'cancelled').map((g) => g.parentId!));
  const list: Goal[] = [];
  const skippedUnconfirmed: Goal[] = [];
  for (const g of goals) {
    if (g.status !== 'active' || hasLiveChildren.has(g.id)) continue;
    // родитель на паузе или отменён — подцели тоже не финансируются
    let p = g.parentId !== undefined ? byId.get(g.parentId) : undefined;
    let parentOk = true;
    while (p) {
      if (p.status !== 'active') parentOk = false;
      p = p.parentId !== undefined ? byId.get(p.parentId) : undefined;
    }
    if (!parentOk) continue;
    if (g.targetMin <= 0) {
      skippedUnconfirmed.push(g);
      continue;
    }
    let deadline = g.deadline;
    let q = g.parentId !== undefined ? byId.get(g.parentId) : undefined;
    while (!deadline && q) {
      deadline = q.deadline;
      q = q.parentId !== undefined ? byId.get(q.parentId) : undefined;
    }
    list.push(deadline && deadline !== g.deadline ? { ...g, deadline } : g);
  }
  return { list, skippedUnconfirmed };
}

/** Резерв — корневая цель с ролью safety (DECISIONS D42). */
export const isReserve = (g: Goal): boolean => g.role === 'safety' && g.parentId === undefined;

export function monthsLeft(g: Goal, today: IsoDate): number | null {
  if (!g.deadline) return null;
  return Math.max(1, monthsBetween(today, g.deadline));
}

function ceilDiv(a: Money, b: number): Money {
  return tiyn(Math.ceil(a / b));
}

/** Ежемесячный минимум цели: (min − назначено) / мес. до срока, вверх до шага, не меньше пользовательского пола. */
export function requiredMonthly(g: Goal, progress: Money, today: IsoDate, s: StrategySettings): Money {
  const remaining = pos(sub(g.targetMin, progress));
  if (remaining === 0) return ZERO;
  const m = monthsLeft(g, today);
  let req = m === null ? ZERO : ceilTo(ceilDiv(remaining, m), s.requiredStep);
  if (g.minMonthlyFunding !== undefined && g.minMonthlyFunding > req) req = g.minMonthlyFunding;
  return min(req, remaining);
}

function weight(g: Goal, today: IsoDate, s: StrategySettings): number {
  const m = monthsLeft(g, today);
  const U = s.urgencyMonths;
  return g.importance * (m === null ? U : U + Math.max(0, U - m));
}

/**
 * Пропорциональное распределение в тиынах с потолками: кто упёрся в потолок — получает потолок,
 * остаток перераспределяется. Остаток деления — методом наибольших остатков, при равенстве по id.
 */
export function distribute(total: Money, items: readonly { id: string; w: number; cap: Money }[]): Map<string, Money> {
  const out = new Map<string, Money>();
  let left = BigInt(total);
  let active = items.filter((x) => x.cap > 0 && x.w > 0);
  while (left > 0n && active.length) {
    const W = BigInt(active.reduce((s, x) => s + x.w, 0));
    const capped = active.filter((x) => (left * BigInt(x.w)) / W >= BigInt(x.cap));
    if (capped.length) {
      for (const x of capped) {
        out.set(x.id, x.cap);
        left -= BigInt(x.cap);
      }
      active = active.filter((x) => !capped.includes(x));
      continue;
    }
    const shares = active.map((x) => ({ x, q: (left * BigInt(x.w)) / W, r: (left * BigInt(x.w)) % W }));
    let given = shares.reduce((s, v) => s + v.q, 0n);
    for (const v of shares) out.set(v.x.id, tiyn(Number(v.q)));
    const order = [...shares].sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.x.id < b.x.id ? -1 : 1));
    for (const v of order) {
      if (given >= left) break;
      out.set(v.x.id, tiyn(out.get(v.x.id)! + 1));
      given += 1n;
    }
    left = 0n;
  }
  return out;
}

export function ladder(i: LadderInput): LadderResult {
  const s = i.settings;
  const explanation: Explanation = [];
  const allocations: Allocation[] = [];
  const underfunded: LadderResult['underfunded'] = [];
  const given = new Map<GoalId, Money>();
  let left = i.amount;
  const prog = (g: Goal) => add(i.progress.get(g.id) ?? ZERO, given.get(g.id) ?? ZERO);
  const give = (g: Goal, amount: Money, level: 1 | 2 | 3, reason: string) => {
    if (amount <= 0) return;
    allocations.push({ goalId: g.id, amount, level, reason });
    given.set(g.id, add(given.get(g.id) ?? ZERO, amount));
    left = sub(left, amount);
  };

  const { list, skippedUnconfirmed } = eligibleGoals(i.goals);
  for (const g of skippedUnconfirmed) explanation.push(step('ladder.skip_unconfirmed', `«${g.title}» пропущена: сумма цели не задана (подтверди сумму)`, { level: 'warn', refs: { goalId: g.id } }));
  const byPriority = (a: Goal, b: Goal) => b.importance - a.importance || (a.id < b.id ? -1 : 1);
  const reserves = list.filter(isReserve).sort(byPriority);
  const others = list.filter((g) => !isReserve(g));
  const strategy = i.strategy;
  if (strategy.id === 'D' && !strategy.custom) throw new RangeError('Стратегия D требует пользовательских параметров');

  // Уровень 1 — защита
  reserves.forEach((r, idx) => {
    let target: Money;
    if (strategy.id === 'A') target = r.targetComfort ?? mulDiv(r.targetMin, s.comfortReserveBp, 10000);
    else if (strategy.id === 'D' && idx === 0) target = strategy.custom!.reserveTarget;
    else target = r.targetMin;
    const need = pos(sub(target, prog(r)));
    const amt = min(need, left);
    give(r, amt, 1, `резерв до ${money(target)}`);
    explanation.push(step('ladder.reserve', `Уровень 1: «${r.title}» — цель ${money(target)}, есть ${money(i.progress.get(r.id) ?? ZERO)}, выдано ${money(amt)}${amt < need ? ` (не хватает ${money(sub(need, amt))})` : ''}`, { amount: amt, refs: { goalId: r.id }, level: amt < need ? 'warn' : 'info' }));
  });

  // Уровень 2 — минимумы
  const zero = new Set(strategy.zeroMinimumGoalIds ?? []);
  const reqs: { g: Goal; required: Money }[] = [];
  if (strategy.id === 'D') {
    for (const m of strategy.custom!.minimums) {
      const g = others.find((x) => x.id === m.goalId);
      if (g) reqs.push({ g, required: min(m.amount, pos(sub(g.targetComfort ?? g.targetMin, prog(g)))) });
    }
  } else {
    for (const g of others) {
      if (strategy.id === 'C' && zero.has(g.id)) continue;
      const month = requiredMonthly(g, i.progress.get(g.id) ?? ZERO, i.today, s);
      const now = pos(sub(month, i.fundedThisMonth.get(g.id) ?? ZERO));
      if (now > 0) reqs.push({ g, required: now });
    }
  }
  const order = (a: { g: Goal }, b: { g: Goal }) =>
    Number(b.g.role === 'obligation') - Number(a.g.role === 'obligation') ||
    (a.g.deadline ?? '9999') .localeCompare(b.g.deadline ?? '9999') ||
    b.g.importance - a.g.importance ||
    (a.g.id < b.g.id ? -1 : 1);
  for (const { g, required } of reqs.sort(order)) {
    const amt = min(required, left);
    give(g, amt, 2, `минимум ${money(required)} в месяц`);
    explanation.push(step('ladder.minimum', `Уровень 2: «${g.title}» — минимум ${money(required)}${g.deadline ? ` (к ${day(g.deadline)})` : ''}, выдано ${money(amt)}`, { amount: amt, refs: { goalId: g.id }, level: amt < required ? 'warn' : 'info' }));
    if (amt < required) underfunded.push({ goalId: g.id, required, given: amt });
  }
  if (underfunded.length) {
    explanation.push(step('ladder.underfunded', `Недофинансировано: ${underfunded.map((u) => `«${i.goals.find((g) => g.id === u.goalId)?.title}» ${money(u.given)} из ${money(u.required)}`).join(', ')}`, { level: 'warn' }));
    for (const u of underfunded) {
      const g = i.goals.find((x) => x.id === u.goalId)!;
      const rivals = i.goals.filter((x) => x.id !== g.id && (g.competesWith.includes(x.id) || x.competesWith.includes(g.id)) && (given.get(x.id) ?? 0) > 0);
      if (rivals.length) explanation.push(step('ladder.competition', `«${g.title}» конкурирует с ${rivals.map((r) => `«${r.title}»`).join(', ')}: минимум получила цель с более ранним сроком / большей важностью`, { level: 'warn', refs: { goalId: g.id } }));
    }
  }

  // Уровень 3 — остаток
  const R = left;
  const cap = (g: Goal) => pos(sub(g.targetComfort ?? g.targetMin, prog(g)));
  const weighted = (pool: Goal[], amount: Money, label: string) => {
    const shares = distribute(amount, pool.map((g) => ({ id: g.id, w: weight(g, i.today, s), cap: cap(g) })));
    for (const g of [...pool].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const a = shares.get(g.id) ?? ZERO;
      give(g, a, 3, label);
    }
  };
  if (R > 0) {
    if (strategy.id === 'A') {
      const cushion = mulDiv(R, s.cushionShareBp, 10000);
      const r0 = reserves[0];
      if (r0) give(r0, cushion, 3, `${s.cushionShareBp / 100}% остатка в резерв`);
      weighted(others, sub(R, r0 ? cushion : ZERO), 'по весам важность × срочность');
    } else if (strategy.id === 'B') {
      weighted(others, R, 'по весам важность × срочность');
    } else if (strategy.id === 'C') {
      const focusIds = strategy.focusGoalIds?.length ? strategy.focusGoalIds : defaultFocus(others);
      const pool = others.filter((g) => focusIds.includes(g.id));
      weighted(pool, R, 'ускорение выбранной цели');
    } else {
      for (const r of strategy.custom!.rest) {
        const g = others.find((x) => x.id === r.goalId) ?? reserves.find((x) => x.id === r.goalId);
        if (g) give(g, min(mulDiv(R, r.pctBp, 10000), cap(g)), 3, `${r.pctBp / 100}% остатка`);
      }
    }
    explanation.push(step('ladder.rest', `Уровень 3 (${STRATEGY_LABELS[strategy.id]}): распределено ${money(sub(R, left))} из остатка ${money(R)}`, { amount: sub(R, left) }));
  }
  if (left > 0) explanation.push(step('ladder.free', `Остаётся свободным: ${money(left)}${R > 0 && left === R ? ' — всем целям хватает' : ''}`, { amount: left }));

  const byGoal: Record<GoalId, Money> = {};
  for (const [k, v] of [...given.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (v > 0) byGoal[k] = v;
  const achieved = list.filter((g) => (i.progress.get(g.id) ?? ZERO) < g.targetMin && prog(g) >= g.targetMin).map((g) => g.id).sort();
  for (const id of achieved) explanation.push(step('ladder.achieved', `«${i.goals.find((g) => g.id === id)!.title}» достигает минимума этим распределением`, { refs: { goalId: id } }));
  return { allocations, byGoal, free: left, underfunded, achieved, explanation };
}

/** Цель по умолчанию для стратегии C: самая важная, затем с ближайшим сроком, затем по id. */
export function defaultFocus(others: readonly Goal[]): GoalId[] {
  const g = [...others].sort((a, b) => b.importance - a.importance || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || (a.id < b.id ? -1 : 1))[0];
  return g ? [g.id] : [];
}

export function validateCustomStrategy(c: CustomStrategy, goals: readonly Goal[]): string[] {
  const errs: string[] = [];
  const reserve = eligibleGoals(goals).list.filter(isReserve).sort((a, b) => b.importance - a.importance || (a.id < b.id ? -1 : 1))[0];
  if (reserve && c.reserveTarget < reserve.targetMin) errs.push(`Резерв ${money(c.reserveTarget)} ниже минимума ${money(reserve.targetMin)} — свой вариант не может оставить подушку ниже минимума`);
  const pct = c.rest.reduce((s, r) => s + r.pctBp, 0);
  if (pct > 10000) errs.push(`Доли остатка в сумме ${pct / 100}% — больше 100%`);
  if (c.rest.some((r) => r.pctBp < 0) || c.minimums.some((m) => m.amount < 0)) errs.push('Отрицательные суммы и доли не допускаются');
  const ids = new Set(goals.map((g) => g.id));
  for (const x of [...c.minimums, ...c.rest]) if (!ids.has(x.goalId)) errs.push(`Цель ${x.goalId} не найдена`);
  return errs;
}
