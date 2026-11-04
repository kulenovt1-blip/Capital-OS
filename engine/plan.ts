/**
 * Этап 3 в составе приложения: входы симулятора из состояния, прогноз по сценариям,
 * распределение нового поступления и сохранение выбора как назначений целям.
 */
import { add, mulDiv, sum, ZERO, type Money } from './money';
import { addMonths, formatDateRu, fullMonthsBefore, monthKey, type IsoDate } from './date';
import { money, step, type Explanation, type Outcome } from './explain';
import type { ClassifiedOp, OpClass } from './classify';
import { averageMonthly, baselineMonthly, monthlyFlows } from './ledger';
import { BEHAVIOR_LABELS, UNCHECKED_CLASS_ID, classRegistry } from './classes';
import { upcomingPayments } from './obligations';
import { normalizeIncomeKind } from './settings';
import { incomeKindRegistry } from './income-kinds';
import { assignMoney, directFunded, type GoalFunding } from './goals';
import { compareStrategies, type CompareResult, type StrategyParams, type StrategyRow } from './allocate';
import { simulate, whatIf, compareAlternatives, type ExpenseBaseline, type LifeEvent, type SimDeposit, type SimInput, type SimResult, type WhatIfResult, type AlternativeResult } from './simulate';
import { baselineWindow, buildOverview, type Overview } from './overview';
import { EXTRA_INCOME_ID, LUMPS_SUFFIX, growthAnchor, habitExpenses, hiddenFacts, raiseMonth } from './hidden';
import type { AppState, Decision } from './state';

/**
 * Расходы в прогнозе — по поведению класса (D51–D53):
 *  базовый / регулярный / временный — медиана за N полных месяцев (временный и с датой — до даты);
 *  нерегулярный — сумма за 12 полных месяцев / 12; пока истории меньше года — оценка / 12, без оценки — средняя (≥ 3 мес.);
 *  вне прогноза и рассрочки (они через обязательства) — не продлеваются.
 */
export function forecastExpenses(state: AppState, today: IsoDate, ops: readonly ClassifiedOp[], warnings: Explanation, notes: Explanation): ExpenseBaseline[] {
  const out: ExpenseBaseline[] = [];
  let first: IsoDate | null = null;
  for (const c of ops) if (first === null || c.op.date < first) first = c.op.date;
  const firstMonth = first ? monthKey(first) : null;
  const flows12 = monthlyFlows(ops, fullMonthsBefore(today, 12));
  const history = firstMonth ? fullMonthsBefore(today, 12).filter((m) => m >= firstMonth) : [];
  for (const c of classRegistry(state.settings.classes)) {
    if (c.group !== 'expense' || c.behavior === 'excluded' || c.behavior === 'installment') continue;
    if (c.endDate && c.endDate < today) {
      notes.push(step('plan.class_ended', `«${c.label}»: закончился ${formatDateRu(c.endDate)} — в прогноз не входит`));
      continue;
    }
    let monthly: Money;
    let how: string;
    if (c.id === UNCHECKED_CLASS_ID) {
      // не узнанные категории (D104): по фактическому среднему за месяц — не как регулярная трата и не ноль
      const a = averageMonthly(ops, today, c.id, 12);
      monthly = a.monthly;
      how = `не проверено — в среднем за ${a.months} мес.`;
      if (monthly > 0) warnings.push(step('plan.unchecked', `«${c.label}»: ${money(monthly)} в месяц по среднему — приложение не узнало эти категории. Разложи их в «Раскладке трат», и прогноз станет точнее`, { level: 'warn', amount: monthly }));
    } else if (c.behavior === 'irregular') {
      const sumN = sum(history.map((m) => flows12[m]!.byClass[c.id] ?? ZERO));
      if (history.length >= 12) {
        monthly = mulDiv(sumN, 1, 12);
        how = `за 12 мес. ${money(sumN)} / 12`;
        if (c.annualEstimate !== undefined) notes.push(step('plan.irregular_vs_estimate', `«${c.label}»: твоя оценка была ${money(c.annualEstimate)} в год, по факту за 12 мес. — ${money(sumN)}; в прогнозе факт`, { amount: sumN }));
      } else if (c.annualEstimate !== undefined) {
        monthly = mulDiv(c.annualEstimate, 1, 12);
        how = `оценка ${money(c.annualEstimate)} в год / 12, истории ${history.length} мес.`;
      } else if (history.length >= 3) {
        monthly = mulDiv(sumN, 1, history.length);
        how = `средняя за ${history.length} мес.`;
        warnings.push(step('plan.irregular_short', `«${c.label}»: истории ${history.length} мес. — меньше года, сезонность не видна. Задай оценку на год в «Разметке → Свои типы»`, { level: 'warn' }));
      } else {
        monthly = ZERO;
        warnings.push(step('plan.irregular_short', `«${c.label}»: истории меньше 3 месяцев и нет оценки на год — в прогнозе 0. Задай оценку в «Разметке → Свои типы»`, { level: 'warn' }));
        continue;
      }
    } else {
      const b = baselineMonthly(ops, today, c.id, state.settings.baselineMonths, undefined, baselineWindow(state, ops, today));
      monthly = b.median;
      how = `медиана за ${b.months.length} мес.`;
    }
    if (monthly <= 0) continue;
    notes.push(step('plan.class', `«${c.label}» (${BEHAVIOR_LABELS[c.behavior]}): ${money(monthly)} в месяц — ${how}${c.endDate ? `, до ${formatDateRu(c.endDate)}` : ''}`, { amount: monthly }));
    out.push({ key: c.id, title: `${c.label} (${how})`, monthly, growthBp: state.settings.inflationBp, ...(c.endDate ? { end: c.endDate } : {}) });
  }
  return out;
}

export interface SimBuild {
  input: SimInput;
  overview: Overview;
  warnings: Explanation;
  /** Как посчитан каждый класс расходов в прогнозе. */
  notes: Explanation;
}

export function buildSimInput(state: AppState, today: IsoDate): SimBuild {
  const o = buildOverview(state, today);
  const warnings: Explanation = [];
  const manual = new Map(state.manualAccounts.map((m) => [m.id, m]));
  const acctRate = new Map(state.settings.accounts.filter((a) => (a.rateBp ?? 0) > 0).map((a) => [a.accountId, a.rateBp!]));
  let cash = ZERO;
  const deposits: SimDeposit[] = [];
  for (const p of o.capital.accounts) {
    if (p.excluded) continue;
    const terms = manual.get(p.accountId)?.deposit;
    // ставка по копилке из MoneyManager — по ответу человека (D119)
    const rate = terms?.rateBp ?? acctRate.get(p.accountId);
    if (terms || rate || p.availableFrom > today) {
      deposits.push({ id: p.accountId, title: p.title, balance: p.balance, rateBp: rate ?? 0, capitalization: terms?.capitalization ?? 'monthly', availableFrom: p.availableFrom });
    } else cash = add(cash, p.balance);
  }
  const payments = o.obligations
    .flatMap((s) => s.effectiveUpcoming.map((e) => ({ obligationId: s.obligation.id, title: s.obligation.title, date: e.date, amount: e.amount, reducesLiability: s.obligation.kind !== 'recurring' })))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.obligationId < b.obligationId ? -1 : 1));

  const ops = o.classification?.ops ?? [];
  const notes: Explanation = [];
  const expenses = forecastExpenses(state, today, ops, warnings, notes);
  // данные, которые прогноз раньше выбрасывал (D119): учитываются только по ответу человека
  const hf = hiddenFacts(state, today, o);
  for (const l of hf.lumps) {
    if (state.settings.lumps?.[l.classId] !== true) continue;
    expenses.push({ key: `${l.classId}${LUMPS_SUFFIX}`, title: `Крупные траты: ${l.label.replace(/^Расход:\s*/, '')} (за 12 мес. сверх обычного месяца)`, monthly: l.extraMonthly, growthBp: state.settings.inflationBp });
  }
  if (hf.installments && state.settings.newInstallments === true) expenses.push(...habitExpenses(hf.installments.avgMonthly, payments, today, state.settings.simulationMonths));
  if (!expenses.length) warnings.push(step('plan.no_expenses', 'Нет размеченных трат — прогноз считает траты нулевыми. Разметь категории в «Разметке»', { level: 'warn' }));
  const instMedian = sum(['E_installment_own', 'E_installment_family'].map((c) => baselineMonthly(ops, today, c as OpClass, state.settings.baselineMonths).median));
  if (instMedian > 0 && !state.obligations.some((x) => x.kind === 'installment')) {
    warnings.push(step('plan.installments_missing', `В операциях есть рассрочки (в обычный месяц ${money(instMedian)}), но они не заведены — в прогнозе не учтены. Заведи их в «Ещё → Долги и рассрочки»`, { level: 'warn' }));
  }
  if (!state.settings.incomeSchedule.length) warnings.push(step('plan.no_income', 'Доходы не заданы — прогноз без доходов. Добавь их в «Ещё → Доходы»', { level: 'warn' }));

  const input: SimInput = {
    incomeKindLabels: Object.fromEntries(incomeKindRegistry(state.settings.incomeKinds).map((k) => [k.id, k.label])),
    start: today,
    horizonMonths: state.settings.simulationMonths,
    cash,
    deposits,
    liabilities: o.capital.liabilities.total,
    payments,
    incomes: [
      ...state.settings.incomeSchedule.map((x) => ({
        id: x.id, title: x.title, amount: x.amount, dayOfMonth: x.dayOfMonth,
        kind: normalizeIncomeKind(x.kind, state.settings.incomeKinds.map((k) => k.id)),
        ...(x.start ? { start: x.start } : {}), ...(x.end ? { end: x.end } : {}),
        // повышение — в месяц, когда его делали раньше (D119), а не через год от сегодня
        ...(x.indexed && state.settings.inflationBp > 0 ? { growth: { rateBp: state.settings.inflationBp, everyMonths: 12 }, growthAnchor: growthAnchor(today, x.indexMonth ?? raiseMonth(ops, today, x) ?? 1, x.dayOfMonth) } : {}),
      })),
      ...(hf.extraIncome && state.settings.extraIncome === true ? [{ id: EXTRA_INCOME_ID, title: 'Подарки, кешбэк и прочее (медиана за 12 мес.)', amount: hf.extraIncome.extraMonthly, dayOfMonth: 15, kind: 'irregular' as const }] : []),
    ],
    expenses,
    events: state.settings.plannedEvents,
    goals: o.goals,
    progress: directFunded(o.fundings),
    strategy: { id: state.settings.planStrategy },
    strategySettings: state.settings.strategy,
    baseMedian: o.baseline.median,
    drawOrder: (state.settings.drawOrder ?? []).filter((id) => o.goals.some((g) => g.id === id && g.status === 'active')),
  };
  return { input, overview: o, warnings, notes };
}

/** Прогноз по всем сценариям из настроек. */
export function runForecast(state: AppState, today: IsoDate): SimResult[] {
  const { input } = buildSimInput(state, today);
  return state.settings.scenarios.map((sc) => simulate(input, sc));
}

export function runWhatIf(state: AppState, today: IsoDate, decision: LifeEvent[]): WhatIfResult[] {
  return whatIf(buildSimInput(state, today).input, decision, state.settings.scenarios);
}

export function runAlternatives(state: AppState, today: IsoDate, alts: { id: string; title: string; events: LifeEvent[] }[]): AlternativeResult[] {
  const sc = state.settings.scenarios[0];
  return compareAlternatives(buildSimInput(state, today).input, alts, sc);
}

export interface IncomeRequest {
  amount: Money;
  /** Поступление уже отражено в импортированных балансах (D43). */
  incomeInBalance: boolean;
  strategies: StrategyParams[];
  /**
   * Новый экран «Пришли деньги» (D96): траты на жизнь до дохода — обычные (повседневное + регулярное),
   * а покрыть их могут только деньги на счетах «для трат», не копилки.
   */
  simple?: boolean;
}

export function planIncome(state: AppState, today: IsoDate, req: IncomeRequest): CompareResult {
  const { input, overview: o } = buildSimInput(state, today);
  const assigned = new Map<string, Money>();
  for (const f of o.fundings) assigned.set(f.accountId, add(assigned.get(f.accountId) ?? ZERO, f.amount));
  let liquidFree = ZERO;
  const liquidIds = new Set<string>();
  for (const p of o.capital.accounts) {
    if (p.excluded || p.liquidity.kind !== 'instant') continue;
    if (req.simple && o.spend.kinds[p.accountId] !== 'spend') continue;
    liquidIds.add(p.accountId);
    liquidFree = add(liquidFree, p.balance - (assigned.get(p.accountId) ?? 0) as Money);
  }
  const goalById = new Map(o.goals.map((g) => [g.id, g]));
  const obligationGoalFunds = sum(o.fundings.filter((f) => goalById.get(f.goalId)?.role === 'obligation').map((f) => f.amount));
  // те же деньги по счетам — с датой, с которой их можно снять (D92): вклад до 01.06 не оплатит платёж 05.11
  const positionById = new Map(o.capital.accounts.map((p) => [p.accountId, p]));
  const obligationByAccount = new Map<string, Money>();
  for (const f of o.fundings) if (goalById.get(f.goalId)?.role === 'obligation') obligationByAccount.set(f.accountId, add(obligationByAccount.get(f.accountId) ?? ZERO, f.amount));
  const obligationGoalFundsByAvailability = [...obligationByAccount.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .flatMap(([accountId, amount]) => {
      const p = positionById.get(accountId);
      return p && !p.excluded && amount > 0 ? [{ amount, availableFrom: p.availableFrom }] : [];
    });
  const perGoalLiquid = new Map<string, Money>();
  for (const f of o.fundings) if (liquidIds.has(f.accountId)) perGoalLiquid.set(f.goalId, add(perGoalLiquid.get(f.goalId) ?? ZERO, f.amount));
  const thisMonth = monthKey(today);
  const fundedThisMonth = new Map<string, Money>();
  for (const f of state.fundings) if (monthKey(f.date) === thisMonth) fundedThisMonth.set(f.goalId, add(fundedThisMonth.get(f.goalId) ?? ZERO, f.amount));

  return compareStrategies({
    step0: {
      income: req.amount,
      today,
      nextIncome: o.nextIncome.date,
      upcoming: upcomingPayments(o.obligations, today, addMonths(today, 1200)),
      baseMedian: req.simple ? o.spend.usualMonthly : o.baseline.median,
      liquidFreeBefore: liquidFree,
      obligationGoalFunds,
      obligationGoalFundsByAvailability,
      incomeInBalance: req.incomeInBalance,
      goalsWithLiquidFunds: [...perGoalLiquid.entries()].map(([goalId, amount]) => ({ goalId, title: goalById.get(goalId)?.title ?? goalId, amount, importance: goalById.get(goalId)?.importance ?? 0 })),
    },
    goals: o.goals,
    progress: input.progress,
    fundedThisMonth,
    sim: { ...input, cash: req.incomeInBalance ? input.cash : add(input.cash, req.amount) },
    strategies: req.strategies,
    planStrategy: state.settings.planStrategy,
    settings: state.settings.strategy,
  });
}

/**
 * Выбор стратегии: метки GoalFunding на счёте, куда пришли деньги, и запись решения.
 * Реальных переводов система не делает (§5.3). Метки проверяются инвариантом 1.
 */
export function acceptAllocation(state: AppState, c: CompareResult, row: StrategyRow, accountId: string, today: IsoDate, decisionId: string, note: string, opts: { pending?: boolean } = {}): Outcome<AppState> {
  const o = buildOverview(state, today);
  const added: GoalFunding[] = [];
  const fundings: GoalFunding[] = [...o.fundings];
  for (const [goalId, amount] of Object.entries(row.byGoal).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (amount <= 0) continue;
    const r = assignMoney({ id: `${decisionId}-${goalId}`, goalId, accountId, amount, date: today, decisionId }, { goals: o.goals, fundings, balances: o.balances });
    if (!r.ok) return { ok: false, error: `${r.error}. Если поступление ещё не в импорте — сначала импортируй свежий бэкап или выбери другой счёт`, explanation: r.explanation };
    const f = opts.pending ? { ...r.value, pending: true as const } : r.value;
    fundings.push(f);
    added.push(f);
  }
  const decision: Decision = {
    id: decisionId,
    date: today,
    type: 'allocation',
    input: { available: c.step0.available, accountId, H: c.step0.H, R1: c.step0.R1, R2: c.step0.R2 },
    chosenStrategy: [...row.ids],
    alternatives: c.rows.filter((x) => x !== row).map((x) => x.price),
    explanation: [...c.step0.explanation, ...row.explanation].map((s) => s.text),
    userNote: note,
  };
  return { ok: true, value: { ...state, fundings: [...state.fundings, ...added], decisions: [...state.decisions, decision] }, explanation: [step('plan.accepted', `Выбран вариант «${row.label}»: деньги закреплены за целями (${Object.keys(row.byGoal).length})`)] };
}
