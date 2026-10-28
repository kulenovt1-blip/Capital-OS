/**
 * Цели (§4): дерево, назначение денег («конверты» — метки на деньгах, а не переводы),
 * инварианты против двойного учёта, история изменений.
 *
 * Инварианты §4.2:
 *  1. На каждом счёте Σ назначенного ≤ баланс. Назначение сверх — отказ; падение баланса из-за трат —
 *     предупреждение с вариантами, цели не урезаются молча.
 *  2. Каждая запись GoalFunding принадлежит ровно одной цели; прогресс родителя = подцели + напрямую.
 *  3. Свободные деньги = Σ по ликвидным счетам (баланс − назначено) − резерв под обязательства.
 *  4. Резерв — тоже цель (role = safety).
 */
import { add, max, min, mulDiv, pos, sub, sum, tiyn, ZERO, type Money } from './money';
import { monthsBetween, type IsoDate } from './date';
import { money, step, type Explained, type Explanation, type Outcome } from './explain';
import type { AccountPosition } from './ledger';
import type { AccountSettings } from './settings';

export type GoalId = string;
export type GoalRole = 'obligation' | 'safety' | 'growth' | 'quality' | 'capital' | 'life_change';
export type GoalStatus = 'active' | 'waiting' | 'paused' | 'done' | 'cancelled';
export type Horizon = 'small' | 'medium' | 'long' | 'major';
export type Flexibility = 'fixed' | 'flexible' | 'open';
export type Importance = 1 | 2 | 3 | 4 | 5;

export const ROLE_LABELS: Record<GoalRole, string> = {
  obligation: 'обязательство',
  safety: 'безопасность',
  growth: 'рост',
  quality: 'качество жизни',
  capital: 'капитал',
  life_change: 'смена жизни',
};
export const STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'активна',
  waiting: 'ждёт',
  paused: 'на паузе',
  done: 'выполнена',
  cancelled: 'отменена',
};
export const HORIZON_LABELS: Record<Horizon, string> = { small: 'малая', medium: 'средняя', long: 'долгая', major: 'большая' };

export interface ChangeLogEntry {
  date: IsoDate;
  field: string;
  from: unknown;
  to: unknown;
  reason: string;
}

/** Правило суммы: резерв = N месяцев медианных базовых расходов (D27). */
export interface TargetRule {
  kind: 'months_of_base';
  /** По умолчанию — settings.reserveMonths. */
  months?: number;
}

export interface Goal {
  id: GoalId;
  parentId?: GoalId;
  title: string;
  why: string;
  doneCriteria: string;
  /** Переопределение горизонта; иначе вычисляется из дат. */
  horizon?: Horizon;
  role: GoalRole;
  targetMin: Money;
  targetComfort?: Money;
  targetRule?: TargetRule;
  desiredDate?: IsoDate;
  deadline?: IsoDate;
  flexibility: Flexibility;
  importance: Importance;
  /** Пользовательский пол ежемесячного финансирования. */
  minMonthlyFunding?: Money;
  status: GoalStatus;
  dependsOn: GoalId[];
  competesWith: GoalId[];
  history: ChangeLogEntry[];
  /** Сумма или срок ещё не подтверждены пользователем (TODO: подтвердить). */
  unconfirmed?: boolean;
  currency: 'KZT';
}

/** Метка на деньгах: сумма (со знаком: + назначить, − снять) на счёте за целью. */
export interface GoalFunding {
  id: string;
  goalId: GoalId;
  accountId: string;
  amount: Money;
  date: IsoDate;
  decisionId: string | null;
  note?: string;
}

export type GoalInput = Partial<Omit<Goal, 'id' | 'title' | 'role' | 'targetMin' | 'importance' | 'history' | 'currency'>> & {
  id: GoalId;
  title: string;
  role: GoalRole;
  targetMin: Money;
  importance: Importance;
};

// ───────────────────────── модель ─────────────────────────

export function horizonOf(g: Goal, today: IsoDate, thresholds: readonly [number, number, number]): Horizon {
  if (g.horizon) return g.horizon;
  const d = g.deadline ?? g.desiredDate;
  if (!d) return 'major';
  const m = monthsBetween(today, d);
  if (m <= thresholds[0]) return 'small';
  if (m <= thresholds[1]) return 'medium';
  if (m <= thresholds[2]) return 'long';
  return 'major';
}

export function validateGoal(g: Goal, goals: readonly Goal[]): string[] {
  const errs: string[] = [];
  if (!g.title.trim()) errs.push('Нужно название');
  if (!Number.isSafeInteger(g.targetMin) || (g.targetMin <= 0 && !g.unconfirmed && !g.targetRule)) errs.push('Минимальная сумма цели должна быть больше нуля');
  if (g.targetComfort !== undefined && g.targetComfort < g.targetMin) errs.push('Комфортная сумма не может быть меньше минимальной');
  if (!Number.isInteger(g.importance) || g.importance < 1 || g.importance > 5) errs.push('Важность — от 1 до 5');
  if (g.desiredDate && g.deadline && g.desiredDate > g.deadline) errs.push('Желаемая дата позже дедлайна');
  if (g.minMonthlyFunding !== undefined && g.minMonthlyFunding < 0) errs.push('Минимальный взнос не может быть отрицательным');
  const byId = new Map(goals.map((x) => [x.id, x]));
  byId.set(g.id, g);
  if (g.parentId !== undefined) {
    if (g.parentId === g.id) errs.push('Цель не может быть подцелью самой себя (цикл)');
    else if (!byId.has(g.parentId)) errs.push('Родительская цель не найдена');
    else {
      // подъём по родителям: цикл, если вернулись к себе
      const seen = new Set<string>([g.id]);
      let p: Goal | undefined = byId.get(g.parentId);
      while (p) {
        if (seen.has(p.id)) {
          errs.push('Родители образуют цикл');
          break;
        }
        seen.add(p.id);
        p = p.parentId !== undefined ? byId.get(p.parentId) : undefined;
      }
    }
  }
  for (const d of [...g.dependsOn, ...g.competesWith]) if (!byId.has(d)) errs.push(`Связанная цель ${d} не найдена`);
  return errs;
}

export function createGoal(input: GoalInput, goals: readonly Goal[], date: IsoDate): Outcome<Goal> {
  const g: Goal = {
    why: '',
    doneCriteria: '',
    flexibility: 'flexible',
    status: 'active',
    dependsOn: [],
    competesWith: [],
    ...input,
    history: [{ date, field: 'created', from: null, to: input.title, reason: 'создана' }],
    currency: 'KZT',
  };
  if (goals.some((x) => x.id === g.id)) return { ok: false, error: `Цель с id ${g.id} уже есть`, explanation: [] };
  const errs = validateGoal(g, goals);
  if (errs.length) return { ok: false, error: errs.join('; '), explanation: errs.map((e) => step('goal.invalid', e, { level: 'error' })) };
  return { ok: true, value: g, explanation: [step('goal.created', `Создана цель «${g.title}»`)] };
}

type GoalPatch = Partial<Omit<Goal, 'id' | 'history' | 'status' | 'currency'>>;

/**
 * Изменение цели: только с причиной; каждое изменённое поле пишется в историю (что, когда, старое → новое, почему).
 * Статус меняется отдельно — changeStatus.
 */
export function updateGoal(g: Goal, patch: GoalPatch, reason: string, date: IsoDate, goals: readonly Goal[]): Outcome<Goal> {
  if (!reason.trim()) return { ok: false, error: 'Укажи причину изменения — она сохраняется в истории цели', explanation: [] };
  const next: Goal = { ...g, history: [...g.history] };
  const rec = next as unknown as Record<string, unknown>;
  const old = g as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || k === 'history' || k === 'status' || k === 'currency') continue;
    if (JSON.stringify(old[k]) === JSON.stringify(v)) continue;
    next.history.push({ date, field: k, from: old[k] ?? null, to: v ?? null, reason: reason.trim() });
    if (v === undefined) delete rec[k];
    else rec[k] = v;
  }
  const errs = validateGoal(next, goals.filter((x) => x.id !== g.id));
  if (errs.length) return { ok: false, error: errs.join('; '), explanation: [] };
  return { ok: true, value: next, explanation: [step('goal.updated', `Цель «${next.title}» изменена: ${reason.trim()}`)] };
}

/** Деньги на цели и всех её подцелях. */
export function fundedSubtree(goalId: GoalId, goals: readonly Goal[], fundings: readonly GoalFunding[]): Money {
  const ids = new Set([goalId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of goals) if (g.parentId !== undefined && ids.has(g.parentId) && !ids.has(g.id)) (ids.add(g.id), (grew = true));
  }
  return sum(fundings.filter((f) => ids.has(f.goalId)).map((f) => f.amount));
}

/**
 * Смена статуса с причиной (D25): отменить или завершить цель с деньгами нельзя — сначала снять.
 * Пауза и ожидание разрешены с деньгами.
 */
export function changeStatus(g: Goal, status: GoalStatus, reason: string, date: IsoDate, ctx: { goals: readonly Goal[]; fundings: readonly GoalFunding[] }): Outcome<Goal> {
  if (!reason.trim()) return { ok: false, error: 'Укажи причину смены статуса', explanation: [] };
  if (status === g.status) return { ok: true, value: g, explanation: [] };
  if (status === 'cancelled' || status === 'done') {
    const f = fundedSubtree(g.id, ctx.goals, ctx.fundings);
    if (f > 0) {
      return {
        ok: false,
        error: `На цели «${g.title}» (с подцелями) назначено ${money(f)}. Сначала сними деньги или перенеси их на другую цель — система не делает этого сама`,
        explanation: [step('goal.status.funded', `Нельзя ${status === 'done' ? 'завершить' : 'отменить'}: назначено ${money(f)}`, { level: 'warn', amount: f })],
      };
    }
  }
  return {
    ok: true,
    value: { ...g, status, history: [...g.history, { date, field: 'status', from: g.status, to: status, reason: reason.trim() }] },
    explanation: [step('goal.status', `«${g.title}»: ${STATUS_LABELS[g.status]} → ${STATUS_LABELS[status]} (${reason.trim()})`)],
  };
}

// ───────────────────────── дерево и прогресс ─────────────────────────

export interface GoalNode {
  goal: Goal;
  horizon: Horizon;
  /** Назначено напрямую этой цели. */
  direct: Money;
  /** Напрямую + Σ подцелей. */
  progress: Money;
  /** Прогресс к targetMin в промилле (0..∞), целое. */
  pctPermille: number;
  /** Сколько осталось до минимума (≥ 0). */
  remainingMin: Money;
  /** Минимум достигнут — статус сам не меняется, только предложение (D25). */
  achieved: boolean;
  children: GoalNode[];
}

const byImportanceThenId = (a: Goal, b: Goal) => b.importance - a.importance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function directFunded(fundings: readonly GoalFunding[]): Map<GoalId, Money> {
  const m = new Map<GoalId, Money>();
  for (const f of fundings) m.set(f.goalId, add(m.get(f.goalId) ?? ZERO, f.amount));
  return m;
}

export function goalTree(goals: readonly Goal[], fundings: readonly GoalFunding[], today: IsoDate, thresholds: readonly [number, number, number]): GoalNode[] {
  const direct = directFunded(fundings);
  const ids = new Set(goals.map((g) => g.id));
  const kids = new Map<string | undefined, Goal[]>();
  for (const g of goals) {
    const p = g.parentId !== undefined && ids.has(g.parentId) ? g.parentId : undefined;
    kids.set(p, [...(kids.get(p) ?? []), g]);
  }
  const build = (g: Goal, depth: number): GoalNode => {
    if (depth > goals.length) throw new Error('Цикл в дереве целей');
    const children = (kids.get(g.id) ?? []).sort(byImportanceThenId).map((c) => build(c, depth + 1));
    const d = direct.get(g.id) ?? ZERO;
    const progress = add(d, sum(children.map((c) => c.progress)));
    const pctPermille = g.targetMin > 0 ? Math.floor((progress * 1000) / g.targetMin) : 0;
    return { goal: g, horizon: horizonOf(g, today, thresholds), direct: d, progress, pctPermille, remainingMin: pos(sub(g.targetMin, progress)), achieved: g.targetMin > 0 && progress >= g.targetMin, children };
  };
  return (kids.get(undefined) ?? []).sort(byImportanceThenId).map((g) => build(g, 0));
}

export function flattenTree(nodes: readonly GoalNode[]): GoalNode[] {
  const out: GoalNode[] = [];
  const walk = (ns: readonly GoalNode[]) => ns.forEach((n) => (out.push(n), walk(n.children)));
  walk(nodes);
  return out;
}

// ───────────────────────── назначение денег ─────────────────────────

/** Балансы неисключённых счетов — по ним проверяется инвариант 1. */
export function balancesFromPositions(positions: readonly AccountPosition[]): Record<string, Money> {
  const out: Record<string, Money> = {};
  for (const p of positions) if (!p.excluded) out[p.accountId] = p.balance;
  return out;
}

export function assignedByAccount(fundings: readonly GoalFunding[]): Map<string, Money> {
  const m = new Map<string, Money>();
  for (const f of fundings) m.set(f.accountId, add(m.get(f.accountId) ?? ZERO, f.amount));
  return m;
}

export interface FundingCtx {
  goals: readonly Goal[];
  fundings: readonly GoalFunding[];
  balances: Readonly<Record<string, Money>>;
}

export interface FundingRequest {
  id: string;
  goalId: GoalId;
  accountId: string;
  /** Положительная сумма. */
  amount: Money;
  date: IsoDate;
  decisionId: string | null;
  note?: string;
}

const fail = <T>(error: string): Outcome<T> => ({ ok: false, error, explanation: [step('funding.rejected', error, { level: 'error' })] });

function freeOnAccount(ctx: FundingCtx, accountId: string): Money {
  const bal = ctx.balances[accountId] ?? ZERO;
  return sub(bal, assignedByAccount(ctx.fundings).get(accountId) ?? ZERO);
}

/** Назначить деньги цели (D23): только в пределах свободного остатка счёта. */
export function assignMoney(r: FundingRequest, ctx: FundingCtx): Outcome<GoalFunding> {
  const g = ctx.goals.find((x) => x.id === r.goalId);
  if (!g) return fail('Цель не найдена');
  if (g.status === 'cancelled' || g.status === 'done') return fail(`Цель «${g.title}» ${STATUS_LABELS[g.status]} — назначать на неё нельзя`);
  if (!(r.accountId in ctx.balances)) return fail('Счёт не найден или исключён из анализа');
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0) return fail('Сумма назначения должна быть больше нуля');
  const free = freeOnAccount(ctx, r.accountId);
  if (r.amount > free) return fail(`Нельзя назначить ${money(r.amount)}: свободно на счёте ${money(pos(free))} (баланс ${money(ctx.balances[r.accountId]!)} минус уже назначенное)`);
  const f: GoalFunding = { id: r.id, goalId: r.goalId, accountId: r.accountId, amount: r.amount, date: r.date, decisionId: r.decisionId, ...(r.note ? { note: r.note } : {}) };
  return { ok: true, value: f, explanation: [step('funding.assigned', `Назначено ${money(r.amount)} на «${g.title}»`, { amount: r.amount, refs: { goalId: g.id, accountId: r.accountId } })] };
}

/** Снять деньги с цели: не больше назначенного на этой цели и этом счёте. Запись с минусом. */
export function withdrawMoney(r: FundingRequest, ctx: FundingCtx): Outcome<GoalFunding> {
  const g = ctx.goals.find((x) => x.id === r.goalId);
  if (!g) return fail('Цель не найдена');
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0) return fail('Сумма должна быть больше нуля');
  const funded = sum(ctx.fundings.filter((f) => f.goalId === r.goalId && f.accountId === r.accountId).map((f) => f.amount));
  if (r.amount > funded) return fail(`На «${g.title}» на этом счёте назначено ${money(funded)} — снять ${money(r.amount)} нельзя`);
  const f: GoalFunding = { id: r.id, goalId: r.goalId, accountId: r.accountId, amount: tiyn(-r.amount), date: r.date, decisionId: r.decisionId, ...(r.note ? { note: r.note } : {}) };
  return { ok: true, value: f, explanation: [step('funding.withdrawn', `Снято ${money(r.amount)} с «${g.title}»`, { amount: r.amount, refs: { goalId: g.id, accountId: r.accountId } })] };
}

/** Перенести назначение на другой счёт (после реального перевода денег). Сумма по цели не меняется. */
export function moveFunding(
  r: { id: string; goalId: GoalId; fromAccountId: string; toAccountId: string; amount: Money; date: IsoDate; decisionId: string | null },
  ctx: FundingCtx,
): Outcome<GoalFunding[]> {
  if (r.fromAccountId === r.toAccountId) return fail('Счета совпадают');
  const w = withdrawMoney({ id: `${r.id}-out`, goalId: r.goalId, accountId: r.fromAccountId, amount: r.amount, date: r.date, decisionId: r.decisionId }, ctx);
  if (!w.ok) return w;
  const a = assignMoney({ id: `${r.id}-in`, goalId: r.goalId, accountId: r.toAccountId, amount: r.amount, date: r.date, decisionId: r.decisionId }, { ...ctx, fundings: [...ctx.fundings, w.value] });
  if (!a.ok) return a;
  return { ok: true, value: [w.value, a.value], explanation: [step('funding.moved', `Назначение ${money(r.amount)} перенесено на другой счёт`, { amount: r.amount })] };
}

// ───────────────────────── привязка счёта к цели (D59) ─────────────────────────

export const BOUND_PREFIX = 'bound:';

/** Привязка действует, если цель есть и не отменена/не выполнена, а счёт есть и не исключён. */
export function invalidBindings(settings: readonly AccountSettings[], positions: readonly AccountPosition[], goals: readonly Goal[]): { accountId: string; goalId: string; reason: string }[] {
  const out: { accountId: string; goalId: string; reason: string }[] = [];
  for (const s of settings) {
    if (!s.boundGoalId) continue;
    const g = goals.find((x) => x.id === s.boundGoalId);
    const p = positions.find((x) => x.accountId === s.accountId);
    if (!g) out.push({ accountId: s.accountId, goalId: s.boundGoalId, reason: 'цель удалена' });
    else if (g.status === 'cancelled' || g.status === 'done') out.push({ accountId: s.accountId, goalId: s.boundGoalId, reason: `цель «${g.title}» ${STATUS_LABELS[g.status]}` });
    else if (!p || p.excluded) out.push({ accountId: s.accountId, goalId: s.boundGoalId, reason: 'счёт исключён из анализа' });
  }
  return out;
}

/**
 * Назначения с учётом привязок: явные метки + для каждого привязанного счёта виртуальная метка
 * на остаток, не назначенный явно. Виртуальные метки не хранятся — пересчитываются от баланса.
 */
export function effectiveFundings(fundings: readonly GoalFunding[], positions: readonly AccountPosition[], settings: readonly AccountSettings[], goals: readonly Goal[], asOf: IsoDate = '1970-01-01'): GoalFunding[] {
  const out = [...fundings];
  const bad = new Set(invalidBindings(settings, positions, goals).map((b) => b.accountId));
  const explicit = assignedByAccount(fundings);
  for (const s of [...settings].sort((a, b) => (a.accountId < b.accountId ? -1 : 1))) {
    if (!s.boundGoalId || bad.has(s.accountId)) continue;
    const p = positions.find((x) => x.accountId === s.accountId)!;
    const rest = pos(sub(p.balance, explicit.get(s.accountId) ?? ZERO));
    if (rest > 0) out.push({ id: `${BOUND_PREFIX}${s.accountId}`, goalId: s.boundGoalId, accountId: s.accountId, amount: rest, date: asOf, decisionId: null, note: 'весь остаток счёта за целью' });
  }
  return out;
}

// ───────────────────────── «назначено больше, чем есть» ─────────────────────────

export interface OverAssignmentOption {
  goalId: GoalId;
  title: string;
  /** Сколько предлагается снять с этой цели (≤ назначенного на ней на этом счёте, ≤ нехватки). */
  amount: Money;
}

export interface OverAssignment {
  accountId: string;
  balance: Money;
  assigned: Money;
  /** assigned − max(0, balance). */
  shortfall: Money;
  options: OverAssignmentOption[];
  text: string;
}

/**
 * Нарушение инварианта 1 после трат: назначения не меняются, поднимается предупреждение
 * с вариантами «снять X с цели Y» — сначала менее важные цели, при равенстве по id (D23).
 */
export function overAssignment(fundings: readonly GoalFunding[], balances: Readonly<Record<string, Money>>, goals: readonly Goal[]): OverAssignment[] {
  const out: OverAssignment[] = [];
  const byAcc = assignedByAccount(fundings);
  const goalById = new Map(goals.map((g) => [g.id, g]));
  for (const [accountId, assigned] of [...byAcc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const balance = balances[accountId] ?? ZERO;
    // превышение — только когда за целями есть деньги, которых нет (D37); овердрафт без назначений — не сюда
    if (assigned <= max(ZERO, balance)) continue;
    const shortfall = sub(assigned, max(ZERO, balance));
    const perGoal = new Map<string, Money>();
    for (const f of fundings) if (f.accountId === accountId) perGoal.set(f.goalId, add(perGoal.get(f.goalId) ?? ZERO, f.amount));
    const options = [...perGoal.entries()]
      .filter(([, v]) => v > 0)
      .map(([goalId, v]) => ({ goal: goalById.get(goalId), goalId, v }))
      .sort((a, b) => (a.goal?.importance ?? 0) - (b.goal?.importance ?? 0) || (a.goalId < b.goalId ? -1 : 1))
      .map((x) => ({ goalId: x.goalId, title: x.goal?.title ?? x.goalId, amount: min(x.v, shortfall) }));
    out.push({
      accountId,
      balance,
      assigned,
      shortfall,
      options,
      text: `Назначено больше, чем есть: на счёте ${money(balance)}, за целями ${money(assigned)}, не хватает ${money(shortfall)}. Выбери, с какой цели снять`,
    });
  }
  return out;
}

// ───────────────────────── свободные деньги ─────────────────────────

/** D21: Σ по ликвидным на сегодня счетам (баланс − назначено на нём) − резерв под обязательства до следующего дохода. */
export function freeMoney(positions: readonly AccountPosition[], fundings: readonly GoalFunding[], reserve: Money, today: IsoDate): Explained<{ free: Money; assignedLiquid: Money; liquidUnassigned: Money }> {
  const byAcc = assignedByAccount(fundings);
  let liquidUnassigned = ZERO;
  let assignedLiquid = ZERO;
  const parts: string[] = [];
  for (const p of positions) {
    if (p.excluded || (p.availableFrom > today && p.balance >= 0)) continue;
    const a = byAcc.get(p.accountId) ?? ZERO;
    assignedLiquid = add(assignedLiquid, a);
    liquidUnassigned = add(liquidUnassigned, sub(p.balance, a));
    parts.push(`«${p.title}» ${money(p.balance)}${a ? ` − ${money(a)}` : ''}`);
  }
  const free = sub(liquidUnassigned, reserve);
  return {
    result: { free, assignedLiquid, liquidUnassigned },
    explanation: [
      step('free.liquid', `Ликвидно и не назначено: ${money(liquidUnassigned)} = ${parts.join(' + ') || '0'}`, { amount: liquidUnassigned }),
      step('free.total', `Свободно ${money(free)} = ${money(liquidUnassigned)} − резерв под обязательства ${money(reserve)}`, { amount: free, level: free < 0 ? 'warn' : 'info' }),
    ],
  };
}

// ───────────────────────── резерв и пример ─────────────────────────

/** Подставить суммы по правилам (резерв = месяцы × медиана E_base). Исходные цели не меняются. */
export function resolveGoalTargets(goals: readonly Goal[], baseMedian: Money, reserveMonthsDefault: number): { goals: Goal[]; explanation: Explanation } {
  const explanation: Explanation = [];
  const out = goals.map((g) => {
    if (!g.targetRule || g.targetRule.kind !== 'months_of_base') return g;
    const months = g.targetRule.months ?? reserveMonthsDefault;
    if (baseMedian <= 0) {
      explanation.push(step('goal.target.no_base', `«${g.title}»: медиана базовых расходов неизвестна (0) — оставлена заданная сумма ${money(g.targetMin)}. Разметь категории как E_base`, { level: 'warn', refs: { goalId: g.id } }));
      return g;
    }
    const t = mulDiv(baseMedian, months, 1);
    explanation.push(step('goal.target.rule', `«${g.title}»: ${months} мес. × медиана базовых расходов ${money(baseMedian)} = ${money(t)}`, { amount: t, refs: { goalId: g.id } }));
    return { ...g, targetMin: t };
  });
  return { goals: out, explanation };
}

/**
 * Универсальный старт (D74): одна цель «Резерв» с суммой по правилу — она нужна любому.
 * Остальные цели человек создаёт сам: у каждого они свои.
 */
export function starterGoals(date: IsoDate): Goal[] {
  const r = createGoal({ id: 'goal-reserve', title: 'Резерв', role: 'safety', targetMin: ZERO, importance: 5, targetRule: { kind: 'months_of_base' }, why: 'Подушка на случай потери дохода или непредвиденной траты', doneCriteria: 'Резерв = N месяцев базовых расходов (N — в «Настройки → Расчёты»)' }, [], date);
  if (!r.ok) throw new Error(r.error);
  return [r.value];
}

/**
 * Стартовая конфигурация из инструкции §4.3 — только по кнопке (D28).
 * Суммы, которых нет в инструкции, равны 0 и помечены «подтвердить».
 */
export function exampleGoals(date: IsoDate): Goal[] {
  const spec: GoalInput[] = [
    { id: 'goal-base', title: 'Финансовая база 1 000 000 ₸', role: 'capital', targetMin: tiyn(100_000_000), importance: 5, why: 'Текущая главная цель', doneCriteria: 'Назначено 1 000 000 ₸' },
    { id: 'goal-reserve', title: 'Резерв', role: 'safety', targetMin: ZERO, importance: 5, targetRule: { kind: 'months_of_base' }, unconfirmed: true, why: 'Подушка на случай потери дохода', doneCriteria: 'Резерв = 3 месяца базовых расходов' },
    { id: 'goal-move', title: 'Переезд в другой город', role: 'life_change', targetMin: ZERO, importance: 4, deadline: '2027-09-01', flexibility: 'fixed', unconfirmed: true, why: 'Плановый переезд', doneCriteria: 'Переезд состоялся, первые месяцы покрыты' },
    { id: 'goal-move-start', parentId: 'goal-move', title: 'Стартовый бюджет переезда', role: 'life_change', targetMin: ZERO, importance: 4, deadline: '2027-09-01', unconfirmed: true },
    { id: 'goal-move-buffer', parentId: 'goal-move', title: 'Буфер адаптации', role: 'life_change', targetMin: ZERO, importance: 4, deadline: '2027-09-01', unconfirmed: true },
    { id: 'goal-teeth', title: 'Лечение', role: 'quality', targetMin: ZERO, importance: 3, status: 'paused', unconfirmed: true },
  ];
  const out: Goal[] = [];
  for (const s of spec) {
    const r = createGoal(s, out, date);
    if (!r.ok) throw new Error(r.error);
    out.push(r.value);
  }
  return out;
}

// ───────────────────────── удаление цели ─────────────────────────

/**
 * Удалить одну цель (D64): только пустую — без денег (с подцелями), без подцелей и без привязанного счёта.
 * Нулевые записи назначений этой цели и ссылки других целей на неё убираются. Для истории есть «отменить».
 */
export function deleteGoal(
  goalId: GoalId,
  ctx: { goals: readonly Goal[]; fundings: readonly GoalFunding[]; accounts: readonly AccountSettings[] },
): Outcome<{ goals: Goal[]; fundings: GoalFunding[] }> {
  const g = ctx.goals.find((x) => x.id === goalId);
  if (!g) return { ok: false, error: 'Цель не найдена', explanation: [] };
  const kids = ctx.goals.filter((x) => x.parentId === goalId);
  if (kids.length) return { ok: false, error: `У цели есть подцели (${kids.map((k) => `«${k.title}»`).join(', ')}) — сначала удали или перенеси их`, explanation: [] };
  const funded = fundedSubtree(goalId, ctx.goals, ctx.fundings);
  if (funded !== 0) return { ok: false, error: `На цели назначено ${money(funded)} — сначала сними деньги («Снять или перенести»)`, explanation: [] };
  const bound = ctx.accounts.filter((a) => a.boundGoalId === goalId);
  if (bound.length) return { ok: false, error: 'К цели привязан счёт — сначала отвяжи его', explanation: [] };
  const goals = ctx.goals
    .filter((x) => x.id !== goalId)
    .map((x) => (x.dependsOn.includes(goalId) || x.competesWith.includes(goalId) ? { ...x, dependsOn: x.dependsOn.filter((d) => d !== goalId), competesWith: x.competesWith.filter((d) => d !== goalId) } : x));
  return { ok: true, value: { goals, fundings: ctx.fundings.filter((f) => f.goalId !== goalId) }, explanation: [step('goal.deleted', `Цель «${g.title}» удалена`)] };
}
