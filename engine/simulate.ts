/**
 * Симулятор (§6): помесячный шаг до горизонта + дневная проверка кассовых разрывов.
 * Жизнь пользователя — только параметры (доходы, расходы, события), специального кода нет.
 *
 * Правила (DECISIONS D43–D47):
 *  - день «сегодня» не обрабатывается для доходов, расходов и процентов (они уже в балансе);
 *    платежи и события с датой «сегодня» — обрабатываются;
 *  - месячный расход делится на дни поровну в тиынах, остаток — по 1 тиыну первым дням;
 *  - порядок дня: доходы → события → платежи → расходы → проценты → покрытие минуса из доступных вкладов → проверка разрыва;
 *  - проценты по вкладу копятся во вкладе и недоступны до availableFrom (§6.2);
 *  - назначения целям — метки: на капитал не влияют; месячный прирост назначается по стратегии.
 */
import { add, applyBp, mulDiv, neg, pos, sub, sum, tiyn, ZERO, type Money } from './money';
import { addDays, addMonths, daysInMonth, endOfMonth, monthKey, monthsBetween, startOfMonth, withDay, type IsoDate, type MonthKey } from './date';
import { day, money, step, type Explanation } from './explain';
import type { IncomeKind } from './settings';
import { ladder, STRATEGY_LABELS, type StrategyParams, type StrategySettings } from './ladder';
import type { Goal, GoalId } from './goals';

export interface IncomeStream {
  id: string;
  title: string;
  amount: Money;
  dayOfMonth: number;
  start?: IsoDate;
  end?: IsoDate;
  /** 'work' — сценарные патчи «зарплата ±%, позже»; 'irregular' — свой коэффициент; 'stable' не меняется (D66). */
  kind: IncomeKind;
  /** Рост на rateBp каждые everyMonths месяцев от начала потока (или симуляции). */
  growth?: { rateBp: number; everyMonths: number };
}

export interface ExpenseBaseline {
  key: string;
  title: string;
  monthly: Money;
  /** Рост, б.п. годовых: шаг раз в 12 месяцев от начала симуляции. */
  growthBp: number;
  start?: IsoDate;
  end?: IsoDate;
}

export interface SimDeposit {
  id: string;
  title: string;
  balance: Money;
  rateBp: number;
  capitalization: 'monthly' | 'daily';
  /** С этой даты деньги и проценты доступны. */
  availableFrom: IsoDate;
}

export interface SimPayment {
  obligationId: string;
  title: string;
  date: IsoDate;
  amount: Money;
  /** Платёж уменьшает остаток обязательства (рассрочка, долг); регулярный — нет. */
  reducesLiability: boolean;
}

export type LifeEventKind = 'one_off' | 'recurring_change' | 'income_start' | 'income_stop' | 'income_change' | 'obligation_payoff';

export interface LifeEvent {
  id: string;
  title: string;
  date: IsoDate;
  kind: LifeEventKind;
  /** income_*: id потока; obligation_payoff: id обязательства; recurring_change: подпись. */
  target?: string;
  /** one_off: расход (минус — поступление); recurring_change: ± в месяц; income_*: сумма в месяц; payoff: сумма погашения (0 — весь остаток). */
  amount: Money;
  until?: IsoDate;
  dayOfMonth?: number;
  incomeKind?: IncomeStream['kind'];
}

export interface SimInput {
  start: IsoDate;
  horizonMonths: number;
  /** Ликвидные деньги (карты, наличные, сбережения с мгновенным доступом). */
  cash: Money;
  deposits: SimDeposit[];
  /** Остаток обязательств на старте (рассрочки, долги). */
  liabilities: Money;
  payments: SimPayment[];
  incomes: IncomeStream[];
  expenses: ExpenseBaseline[];
  events: LifeEvent[];
  goals: Goal[];
  /** Назначено напрямую каждой цели на старте. */
  progress: ReadonlyMap<GoalId, Money>;
  strategy: StrategyParams;
  strategySettings: StrategySettings;
  baseMedian: Money;
}

export interface ScenarioPatch {
  /** Доход вида work × (б.п./10000). */
  workIncomeFactorBp?: number;
  /** Нерегулярный доход × (б.п./10000). Нет поля — без изменений. */
  irregularIncomeFactorBp?: number;
  /** Доход вида work, который ещё не начался, начинается на N месяцев позже. */
  workDelayMonths?: number;
  /** Все расходы × (б.п./10000). */
  expenseFactorBp?: number;
  /** Разовый незапланированный расход: доля месячной медианы базовых расходов, б.п. */
  oneOffMonthsOfBaseBp?: number;
  /** В каком месяце от старта (0 — текущий), 15-го числа. */
  oneOffMonthOffset?: number;
}

export interface Scenario {
  id: string;
  name: string;
  patch: ScenarioPatch;
}

export const BASE_SCENARIO: Scenario = { id: 'base', name: 'Базовый', patch: {} };
export const DEFAULT_SCENARIOS: Scenario[] = [
  BASE_SCENARIO,
  { id: 'adverse', name: 'Неблагоприятный', patch: { workIncomeFactorBp: 8000, irregularIncomeFactorBp: 0, workDelayMonths: 3, expenseFactorBp: 11500, oneOffMonthsOfBaseBp: 10000, oneOffMonthOffset: 1 } },
  { id: 'favorable', name: 'Благоприятный', patch: { workIncomeFactorBp: 11500 } },
];

export interface SimMonth {
  month: MonthKey;
  income: Money;
  expenses: Money;
  obligations: Money;
  /** Разовые события и досрочные погашения (нетто: расход +, поступление −). */
  events: Money;
  interestAccrued: Money;
  cashEnd: Money;
  depositsEnd: Money;
  /** Деньги, доступные на конец месяца: наличные + вклады с наступившей датой доступа. */
  liquidEnd: Money;
  assets: Money;
  liabilities: Money;
  capital: Money;
  /** Прогресс целей (с подцелями) на конец месяца. */
  goalProgress: Record<GoalId, Money>;
  /** Назначено целям из прироста месяца. */
  allocated: Record<GoalId, Money>;
  /** Резерв в десятых долях месяца базовых расходов. */
  reserveMonthsTenths: number | null;
}

export interface Gap {
  start: IsoDate;
  end: IsoDate;
  maxDeficit: Money;
}

export interface SimResult {
  scenarioId: string;
  months: SimMonth[];
  gaps: Gap[];
  goalDates: Record<GoalId, MonthKey | null>;
  capitalAfter: Record<number, Money | null>;
  minCapital: { month: MonthKey; value: Money };
  violations: string[];
  assumptions: string[];
  explanation: Explanation;
}

export const CAPITAL_HORIZONS = [6, 12, 24, 36] as const;

// ───────────────────────── сценарии ─────────────────────────

function cloneInput(i: SimInput): SimInput {
  return {
    ...i,
    deposits: i.deposits.map((d) => ({ ...d })),
    payments: i.payments.map((p) => ({ ...p })),
    incomes: i.incomes.map((x) => ({ ...x })),
    expenses: i.expenses.map((x) => ({ ...x })),
    events: i.events.map((x) => ({ ...x })),
    goals: [...i.goals],
    progress: new Map(i.progress),
  };
}

/** Применить патч сценария. Исходные параметры не меняются. */
export function applyScenario(input: SimInput, p: ScenarioPatch): SimInput {
  const i = cloneInput(input);
  if (p.workIncomeFactorBp !== undefined) {
    for (const s of i.incomes) if (s.kind === 'work') s.amount = mulDiv(s.amount, p.workIncomeFactorBp, 10000);
    for (const e of i.events) if (e.kind === 'income_start' && (e.incomeKind ?? 'work') === 'work') e.amount = mulDiv(e.amount, p.workIncomeFactorBp, 10000);
  }
  if (p.irregularIncomeFactorBp !== undefined) {
    for (const s of i.incomes) if (s.kind === 'irregular') s.amount = mulDiv(s.amount, p.irregularIncomeFactorBp, 10000);
    for (const e of i.events) if (e.kind === 'income_start' && e.incomeKind === 'irregular') e.amount = mulDiv(e.amount, p.irregularIncomeFactorBp, 10000);
  }
  if (p.workDelayMonths) {
    for (const s of i.incomes) if (s.kind === 'work' && s.start && s.start > i.start) s.start = addMonths(s.start, p.workDelayMonths);
    for (const e of i.events) if (e.kind === 'income_start' && (e.incomeKind ?? 'work') === 'work' && e.date > i.start) e.date = addMonths(e.date, p.workDelayMonths);
  }
  if (p.expenseFactorBp !== undefined) for (const x of i.expenses) x.monthly = mulDiv(x.monthly, p.expenseFactorBp, 10000);
  if (p.oneOffMonthsOfBaseBp) {
    const date = withDay(addMonths(startOfMonth(i.start), p.oneOffMonthOffset ?? 1), 15);
    i.events.push({ id: '__scenario_one_off', title: 'Незапланированный расход (сценарий)', date: date > i.start ? date : addDays(i.start, 1), kind: 'one_off', amount: mulDiv(i.baseMedian, p.oneOffMonthsOfBaseBp, 10000) });
  }
  return i;
}

// ───────────────────────── симуляция ─────────────────────────

interface Stream extends IncomeStream {
  anchor: IsoDate;
}

function grow(amount: Money, rateBp: number, steps: number): Money {
  let a = amount;
  for (let k = 0; k < steps; k++) a = mulDiv(a, 10000 + rateBp, 10000);
  return a;
}

/** Доля месячной суммы на день dayIndex (1..days): поровну, остаток по 1 тиыну первым дням. */
function dailyShare(monthly: Money, days: number, dayIndex: number): Money {
  const negative = monthly < 0;
  const a = Math.abs(monthly);
  const base = Math.floor(a / days);
  const r = a % days;
  const v = base + (dayIndex <= r ? 1 : 0);
  return tiyn(negative ? -v : v);
}

function subtreeProgress(goals: readonly Goal[], direct: ReadonlyMap<GoalId, Money>): Record<GoalId, Money> {
  const out: Record<GoalId, Money> = {};
  const kids = new Map<string, Goal[]>();
  for (const g of goals) if (g.parentId !== undefined) kids.set(g.parentId, [...(kids.get(g.parentId) ?? []), g]);
  const calc = (g: Goal, depth: number): Money => {
    if (out[g.id] !== undefined) return out[g.id]!;
    if (depth > goals.length) return ZERO;
    const v = add(direct.get(g.id) ?? ZERO, sum((kids.get(g.id) ?? []).map((c) => calc(c, depth + 1))));
    out[g.id] = v;
    return v;
  };
  for (const g of [...goals].sort((a, b) => (a.id < b.id ? -1 : 1))) calc(g, 0);
  return out;
}

export function simulate(input: SimInput, scenario: Scenario = BASE_SCENARIO): SimResult {
  const inp = applyScenario(input, scenario.patch);
  const explanation: Explanation = [];
  const violations: string[] = [];
  let cash = inp.cash;
  let liabilities = inp.liabilities;
  const deposits = inp.deposits.map((d) => ({ ...d, accrued: ZERO })).sort((a, b) => (a.availableFrom < b.availableFrom ? -1 : a.availableFrom > b.availableFrom ? 1 : a.id < b.id ? -1 : 1));
  const progress = new Map(inp.progress);

  // события, меняющие потоки, применяются к параметрам заранее
  const streams: Stream[] = inp.incomes.map((s) => ({ ...s, anchor: s.start ?? inp.start }));
  const expenses = inp.expenses.map((x) => ({ ...x }));
  const events = [...inp.events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  for (const e of events) {
    if (e.kind === 'income_stop' || e.kind === 'income_change') {
      for (const s of streams) if (s.id === e.target || s.id.startsWith(`${e.target}@`)) if (!s.end || s.end >= e.date) s.end = addDays(e.date, -1);
      const orig = streams.find((s) => s.id === e.target);
      if (e.kind === 'income_change' && orig) streams.push({ ...orig, id: `${orig.id}@${e.date}`, amount: e.amount, start: e.date, anchor: orig.anchor, ...(e.until ? { end: e.until } : { end: undefined }) } as Stream);
    } else if (e.kind === 'income_start') {
      streams.push({ id: e.target ?? e.id, title: e.title, amount: e.amount, dayOfMonth: e.dayOfMonth ?? Number(e.date.slice(8, 10)), start: e.date, anchor: e.date, kind: e.incomeKind ?? 'work', ...(e.until ? { end: e.until } : {}) });
    } else if (e.kind === 'recurring_change') {
      expenses.push({ key: e.id, title: e.title, monthly: e.amount, growthBp: 0, start: e.date, ...(e.until ? { end: e.until } : {}) });
    }
  }
  const daily = events.filter((e) => e.kind === 'one_off' || e.kind === 'obligation_payoff');
  let payments = [...inp.payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.obligationId < b.obligationId ? -1 : 1));

  const months: SimMonth[] = [];
  const gaps: Gap[] = [];
  let gap: Gap | null = null;
  let overAssignedFrom: MonthKey | null = null;

  for (let k = 0; k <= inp.horizonMonths; k++) {
    const first = k === 0 ? inp.start : startOfMonth(addMonths(startOfMonth(inp.start), k));
    const last = endOfMonth(first);
    const dim = daysInMonth(Number(first.slice(0, 4)), Number(first.slice(5, 7)));
    const m: SimMonth = {
      month: monthKey(first), income: ZERO, expenses: ZERO, obligations: ZERO, events: ZERO, interestAccrued: ZERO,
      cashEnd: ZERO, depositsEnd: ZERO, liquidEnd: ZERO, assets: ZERO, liabilities: ZERO, capital: ZERO, goalProgress: {}, allocated: {}, reserveMonthsTenths: null,
    };
    let interestDays = 0;
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const isStart = d === inp.start;
      const dayIdx = Number(d.slice(8, 10));
      if (!isStart) {
        // доходы
        for (const s of streams) {
          if ((s.start && d < s.start) || (s.end && d > s.end)) continue;
          if (dayIdx !== Math.min(s.dayOfMonth, dim)) continue;
          const steps = s.growth && s.growth.everyMonths > 0 ? Math.floor(Math.max(0, monthsBetween(s.anchor, d)) / s.growth.everyMonths) : 0;
          const a = s.growth ? grow(s.amount, s.growth.rateBp, steps) : s.amount;
          cash = add(cash, a);
          m.income = add(m.income, a);
        }
      }
      // события
      for (const e of daily) {
        if (e.date !== d) continue;
        if (e.kind === 'one_off') {
          cash = sub(cash, e.amount);
          m.events = add(m.events, e.amount);
        } else {
          const rest = payments.filter((p) => p.obligationId === e.target && p.date >= d);
          const remaining = sum(rest.filter((p) => p.reducesLiability).map((p) => p.amount));
          const pay = e.amount > 0 ? e.amount : sum(rest.map((p) => p.amount));
          cash = sub(cash, pay);
          liabilities = sub(liabilities, remaining);
          m.events = add(m.events, pay);
          payments = payments.filter((p) => !rest.includes(p));
          explanation.push(step('sim.payoff', `${day(d)}: досрочно погашено «${e.title}» — ${money(pay)}, будущие платежи сняты`, { amount: pay, date: d }));
        }
      }
      // платежи по обязательствам
      for (const p of payments) {
        if (p.date !== d) continue;
        cash = sub(cash, p.amount);
        if (p.reducesLiability) liabilities = sub(liabilities, p.amount);
        m.obligations = add(m.obligations, p.amount);
      }
      if (!isStart) {
        // расходы
        for (const x of expenses) {
          if ((x.start && d < x.start) || (x.end && d > x.end)) continue;
          const monthly = x.growthBp ? grow(x.monthly, x.growthBp, Math.floor(k / 12)) : x.monthly;
          const a = dailyShare(monthly, dim, dayIdx);
          cash = sub(cash, a);
          m.expenses = add(m.expenses, a);
        }
        // проценты
        interestDays++;
        for (const dep of deposits) {
          if (dep.capitalization !== 'daily' || dep.rateBp === 0) continue;
          const it = applyBp(dep.balance, dep.rateBp, 1);
          dep.balance = add(dep.balance, it);
          m.interestAccrued = add(m.interestAccrued, it);
        }
      }
      // покрыть минус из доступных вкладов
      if (cash < 0) {
        for (const dep of deposits) {
          if (cash >= 0) break;
          if (dep.availableFrom > d || dep.balance <= 0) continue;
          const take = dep.balance < neg(cash) ? dep.balance : neg(cash);
          dep.balance = sub(dep.balance, take);
          cash = add(cash, take);
        }
      }
      // разрыв
      if (cash < 0) {
        if (!gap) gap = { start: d, end: d, maxDeficit: neg(cash) };
        gap.end = d;
        if (neg(cash) > gap.maxDeficit) gap.maxDeficit = neg(cash);
      } else if (gap) {
        gaps.push(gap);
        gap = null;
      }
    }
    // месячная капитализация
    for (const dep of deposits) {
      if (dep.capitalization !== 'monthly' || dep.rateBp === 0 || interestDays === 0) continue;
      const it = applyBp(dep.balance, dep.rateBp, interestDays);
      dep.balance = add(dep.balance, it);
      m.interestAccrued = add(m.interestAccrued, it);
    }
    // прирост месяца назначается целям по стратегии (метки, капитал не меняется)
    const surplus = sub(sub(sub(m.income, m.expenses), m.obligations), m.events);
    if (surplus > 0 && inp.goals.length) {
      const r = ladder({ amount: surplus, today: last, goals: inp.goals, progress, fundedThisMonth: new Map(), strategy: inp.strategy, settings: inp.strategySettings });
      for (const [g, a] of Object.entries(r.byGoal)) {
        progress.set(g, add(progress.get(g) ?? ZERO, a));
        m.allocated[g] = a;
      }
    }
    const depositsEnd = sum(deposits.map((x) => x.balance));
    m.cashEnd = cash;
    m.depositsEnd = depositsEnd;
    m.liquidEnd = add(cash, sum(deposits.filter((x) => x.availableFrom <= last).map((x) => x.balance)));
    m.assets = add(cash, depositsEnd);
    m.liabilities = liabilities;
    m.capital = sub(m.assets, liabilities);
    m.goalProgress = subtreeProgress(inp.goals, progress);
    const reserve = inp.goals.find((g) => g.role === 'safety' && g.parentId === undefined && g.status === 'active');
    m.reserveMonthsTenths = reserve && inp.baseMedian > 0 ? Math.floor(((m.goalProgress[reserve.id] ?? 0) * 10) / inp.baseMedian) : null;
    const totalAssigned = sum([...progress.values()]);
    if (!overAssignedFrom && totalAssigned > pos(m.assets)) overAssignedFrom = m.month;
    months.push(m);
  }
  if (gap) gaps.push(gap);

  // даты целей
  const goalDates: Record<GoalId, MonthKey | null> = {};
  for (const g of [...inp.goals].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (g.status === 'cancelled' || g.targetMin <= 0) continue;
    const hit = months.find((m) => (m.goalProgress[g.id] ?? 0) >= g.targetMin);
    goalDates[g.id] = hit ? hit.month : null;
    if (g.status !== 'active' || !g.deadline) continue;
    const dl = monthKey(g.deadline);
    const at = goalDates[g.id] ?? null;
    if (at === null || at > dl) {
      violations.push(`«${g.title}»: к сроку ${day(g.deadline)} минимум ${money(g.targetMin)} не набирается (прогноз: ${at ?? 'за горизонтом'})`);
    } else if (at < dl) {
      const early = monthsBetween(`${at}-01`, `${dl}-01`);
      explanation.push(step('sim.goal_early', `«${g.title}» достигается в ${at} — раньше срока на ${early} мес.`, { refs: { goalId: g.id } }));
    }
  }
  for (const gp of gaps) violations.push(`Кассовый разрыв ${day(gp.start)}–${day(gp.end)}: не хватает до ${money(gp.maxDeficit)}`);
  if (overAssignedFrom) violations.push(`С ${overAssignedFrom} целям назначено больше, чем есть денег`);

  const capitalAfter: Record<number, Money | null> = {};
  for (const h of CAPITAL_HORIZONS) capitalAfter[h] = months[h]?.capital ?? null;
  let minCap = months[0]!;
  for (const m of months) if (m.capital < minCap.capital) minCap = m;

  return {
    scenarioId: scenario.id,
    months,
    gaps,
    goalDates,
    capitalAfter,
    minCapital: { month: minCap.month, value: minCap.capital },
    violations,
    assumptions: assumptions(inp, scenario),
    explanation,
  };
}

/** Блок «Предположения» — из параметров, автоматически (§6.2). */
export function assumptions(i: SimInput, scenario: Scenario): string[] {
  const a: string[] = [];
  a.push(`Сценарий «${scenario.name}», горизонт ${i.horizonMonths} мес. с ${day(i.start)}; день старта уже в балансе`);
  a.push(`Деньги на старте: доступно ${money(i.cash)}, вкладов ${money(sum(i.deposits.map((d) => d.balance)))}, обязательств ${money(i.liabilities)}`);
  for (const s of i.incomes) {
    a.push(`Доход «${s.title}»: ${money(s.amount)} ${s.dayOfMonth}-го числа${s.start ? `, с ${day(s.start)}` : ''}${s.end ? `, по ${day(s.end)}` : ''}${s.growth ? `, рост ${s.growth.rateBp / 100}% каждые ${s.growth.everyMonths} мес.` : ''}`);
  }
  if (!i.incomes.length) a.push('Регулярных доходов нет');
  for (const x of i.expenses) a.push(`Расход «${x.title}»: ${money(x.monthly)} в месяц${x.growthBp ? `, рост ${x.growthBp / 100}% в год` : ', без роста'}${x.start ? `, с ${day(x.start)}` : ''}${x.end ? ` по ${day(x.end)}` : ''}`);
  for (const d of i.deposits) {
    a.push(`Вклад «${d.title}»: ${money(d.balance)}, ${d.rateBp / 100}% годовых, капитализация ${d.capitalization === 'daily' ? 'ежедневная' : 'ежемесячная'}; деньги и проценты недоступны до ${day(d.availableFrom)}`);
  }
  if (i.payments.length) a.push(`Платежи по обязательствам: ${i.payments.length} шт. на ${money(sum(i.payments.map((p) => p.amount)))} по графикам`);
  for (const e of i.events) a.push(`Событие «${e.title}» ${day(e.date)}: ${eventLabel(e)}`);
  a.push(`Месячный прирост назначается целям по стратегии «${STRATEGY_LABELS[i.strategy.id]}»; назначения — метки на деньгах, на капитал не влияют`);
  a.push('Вероятности не считаются: это расчёт «если всё будет так», а не прогноз шансов');
  return a;
}

function eventLabel(e: LifeEvent): string {
  switch (e.kind) {
    case 'one_off':
      return e.amount >= 0 ? `разовый расход ${money(e.amount)}` : `разовое поступление ${money(neg(e.amount))}`;
    case 'recurring_change':
      return `${e.amount >= 0 ? '+' : ''}${money(e.amount)} к расходам в месяц${e.until ? ` до ${day(e.until)}` : ''}`;
    case 'income_start':
      return `новый доход ${money(e.amount)} в месяц${e.until ? ` до ${day(e.until)}` : ''}`;
    case 'income_stop':
      return `доход «${e.target}» прекращается`;
    case 'income_change':
      return `доход «${e.target}» становится ${money(e.amount)}`;
    case 'obligation_payoff':
      return `досрочное погашение «${e.target}»${e.amount > 0 ? ` за ${money(e.amount)}` : ''}`;
  }
}

// ───────────────────────── «что если» ─────────────────────────

export interface WhatIfResult {
  scenarioId: string;
  scenarioName: string;
  base: SimResult;
  with: SimResult;
  deltaCapital: Record<number, Money | null>;
  /** Сдвиг даты цели в месяцах (+ позже, − раньше); null — если цель за горизонтом в одном из вариантов. */
  deltaGoalMonths: Record<GoalId, number | null>;
  minCapitalBase: { month: MonthKey; value: Money };
  minCapitalWith: { month: MonthKey; value: Money };
  /** Разрывы, которых нет в базовом варианте. */
  newGaps: Gap[];
}

function monthDiff(a: MonthKey, b: MonthKey): number {
  return monthsBetween(`${a}-01`, `${b}-01`);
}

function compareRuns(base: SimResult, w: SimResult): Omit<WhatIfResult, 'scenarioId' | 'scenarioName' | 'base' | 'with'> {
  const deltaCapital: Record<number, Money | null> = {};
  for (const h of CAPITAL_HORIZONS) {
    const a = base.capitalAfter[h];
    const b = w.capitalAfter[h];
    deltaCapital[h] = a === null || a === undefined || b === null || b === undefined ? null : sub(b, a);
  }
  const deltaGoalMonths: Record<GoalId, number | null> = {};
  for (const [g, d0] of Object.entries(base.goalDates)) {
    const d1 = w.goalDates[g];
    deltaGoalMonths[g] = d0 && d1 ? monthDiff(d0, d1) : d0 === d1 ? 0 : null;
  }
  const baseStarts = new Set(base.gaps.map((g) => g.start));
  return { deltaCapital, deltaGoalMonths, minCapitalBase: base.minCapital, minCapitalWith: w.minCapital, newGaps: w.gaps.filter((g) => !baseStarts.has(g.start)) };
}

/** «Что если»: базовый вариант и вариант с решением для каждого сценария (§6.4). */
export function whatIf(input: SimInput, decision: readonly LifeEvent[], scenarios: readonly Scenario[]): WhatIfResult[] {
  return scenarios.map((sc) => {
    const base = simulate(input, sc);
    const w = simulate({ ...input, events: [...input.events, ...decision] }, sc);
    return { scenarioId: sc.id, scenarioName: sc.name, base, with: w, ...compareRuns(base, w) };
  });
}

export interface AlternativeResult {
  id: string;
  title: string;
  result: SimResult;
  deltaCapital: Record<number, Money | null>;
  deltaGoalMonths: Record<GoalId, number | null>;
  newGaps: Gap[];
  minCapital: { month: MonthKey; value: Money };
}

/** Сравнение 2–3 альтернатив бок о бок относительно варианта «без решения». */
export function compareAlternatives(input: SimInput, alts: readonly { id: string; title: string; events: LifeEvent[] }[], scenario: Scenario = BASE_SCENARIO): AlternativeResult[] {
  const base = simulate(input, scenario);
  return alts.map((a) => {
    const r = simulate({ ...input, events: [...input.events, ...a.events] }, scenario);
    const c = compareRuns(base, r);
    return { id: a.id, title: a.title, result: r, deltaCapital: c.deltaCapital, deltaGoalMonths: c.deltaGoalMonths, newGaps: c.newGaps, minCapital: r.minCapital };
  });
}
