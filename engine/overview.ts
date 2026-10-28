/**
 * Экран «Обзор» как чистая функция: из состояния и даты — всё, что показывается.
 */
import { sub, sum, ZERO, type Money } from './money';
import { addDays, nextDayOfMonth, maxDate, type IsoDate } from './date';
import { day, formula, money, step, type Explanation } from './explain';
import { detectInstallments, type InstallmentScan } from './installment-detect';
import { classifyAll, type ClassificationReport } from './classify';
import { baselineMonthly, computeCapital, reconcileAccounts, type Baseline, type CapitalReport, type ReconcileReport } from './ledger';
import { balancesFromPositions, effectiveFundings, flattenTree, freeMoney as goalsFreeMoney, goalTree, invalidBindings, overAssignment, resolveGoalTargets, type Goal, type GoalFunding, type GoalNode, type OverAssignment } from './goals';
import { accountsNeedingReview } from './settings';
import { obligationStatus, upcomingPayments, type ObligationStatus, type UpcomingPayment } from './obligations';
import type { Settings } from './settings';
import { classRegistry, type ClassDef } from './classes';
import type { OpClass } from './classify';

/** Классы, из которых складываются базовые расходы (резерв, запас до дохода): поведение «базовый», не закончившиеся. */
export function baseClassIds(reg: readonly ClassDef[], today: IsoDate): OpClass[] {
  return reg.filter((c) => c.group === 'expense' && c.behavior === 'base' && (!c.endDate || c.endDate >= today)).map((c) => c.id);
}
import type { AppState } from './state';
import type { ImportedData } from './types';

export interface NextIncome {
  date: IsoDate;
  source: 'schedule' | 'default';
  title?: string;
}

/**
 * Ближайшее ожидаемое поступление строго после сегодня (DECISIONS D34).
 * Без расписания — сегодня + defaultIncomeHorizonDays.
 */
export function nextIncomeDate(settings: Settings, today: IsoDate): NextIncome {
  let best: NextIncome | null = null;
  const from = addDays(today, 1);
  for (const it of [...settings.incomeSchedule].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const start = it.start ? maxDate(from, it.start) : from;
    const d = nextDayOfMonth(start, it.dayOfMonth);
    if (it.end && d > it.end) continue;
    if (!best || d < best.date) best = { date: d, source: 'schedule', title: it.title };
  }
  return best ?? { date: addDays(today, settings.defaultIncomeHorizonDays), source: 'default' };
}

/** Куда идти исправлять: экран и, если есть, раздел на нём. */
export interface NoticeAction {
  route: string;
  section?: string;
  label: string;
}

export interface Notice {
  code: string;
  level: 'info' | 'warn' | 'error';
  text: string;
  action?: NoticeAction;
}

const ACTIONS: [RegExp, NoticeAction][] = [
  [/^import\.missing$/, { route: 'import', label: 'Загрузить бэкап' }],
  [/^(reconcile\.|import\.warnings$)/, { route: 'import', label: 'Открыть импорт' }],
  [/^accounts\.review$/, { route: 'import', section: 'review', label: 'Ответить про счета' }],
  [/^accounts\.bound_invalid$/, { route: 'settings', section: 'accounts', label: 'Открыть счета' }],
  [/^unclassified$/, { route: 'classes', section: 'categories', label: 'Разметить' }],
  [/^capital\.savings/, { route: 'settings', section: 'savings', label: 'Настроить накопления' }],
  [/^capital\.(payables|receivables)_negative$/, { route: 'settings', section: 'debts', label: 'Указать долги' }],
  [/^capital\.double_debt$/, { route: 'settings', section: 'obligations', label: 'Открыть обязательства' }],
  [/^capital\.excluded$/, { route: 'settings', section: 'accounts', label: 'Открыть счета' }],
  [/^obligation\./, { route: 'settings', section: 'obligations', label: 'Открыть обязательства' }],
  [/^goals?\./, { route: 'goals', label: 'Открыть цели' }],
  [/^free\.negative$/, { route: 'income', label: 'Что делать' }],
];

/** Действие для предупреждения по его коду; неизвестный код — на «Настройку». */
export function noticeAction(code: string): NoticeAction {
  for (const [re, a] of ACTIONS) if (re.test(code)) return a;
  return { route: 'setup', label: 'Открыть настройку' };
}

export interface Overview {
  today: IsoDate;
  hasData: boolean;
  reconcile: ReconcileReport | null;
  classification: ClassificationReport | null;
  capital: CapitalReport;
  obligations: ObligationStatus[];
  upcoming30: UpcomingPayment[];
  nextIncome: NextIncome;
  /** Платежи по обязательствам с датой в [сегодня, следующий доход]. */
  reserveUntilIncome: Money;
  /** Назначено целям на ликвидных счетах. */
  assigned: Money;
  /** Медиана базовых расходов (E_base) — для резерва и стратегий. */
  baseline: Baseline;
  /** Цели с подставленными суммами по правилам (резерв). */
  goals: Goal[];
  goalTree: GoalNode[];
  overAssigned: OverAssignment[];
  /** Балансы неисключённых счетов (для назначения денег). */
  balances: Record<string, Money>;
  /** Назначения с учётом привязок счетов к целям (D59). */
  fundings: GoalFunding[];
  freeMoney: Money;
  /** Незаведённые рассрочки из операций и расхождения заведённых (D67). */
  installments: InstallmentScan;
  notices: Notice[];
  explanation: Explanation;
}

const EMPTY_DATA: ImportedData = {
  accounts: [],
  categories: [],
  tags: [],
  operations: [],
  reportedBalances: {},
  warnings: [],
  meta: { entryName: '', prefixLength: 0, dbBytes: 0, firstDate: null, lastDate: null },
};

export interface OverviewExtras {
  notices?: Notice[];
  explanation?: Explanation;
}

export function buildOverview(state: AppState, today: IsoDate, extras: OverviewExtras = {}): Overview {
  const data = state.imported ?? EMPTY_DATA;
  const hasData = state.imported !== null;
  const notices: Notice[] = [];
  const explanation: Explanation = [];

  const reconcile = hasData ? reconcileAccounts(data) : null;
  const classification = hasData ? classifyAll(data, state.settings.classification) : null;
  const obligations = state.obligations.map((o) => obligationStatus(o, data, today, { matchWindowDays: state.settings.matchWindowDays, manualMatches: state.manualMatches }));
  const capital = computeCapital({
    data,
    classified: classification?.ops ?? [],
    accountSettings: state.settings.accounts,
    manualAccounts: state.manualAccounts,
    adjustments: state.adjustments,
    obligations,
    today,
    openingDebts: state.settings.openingDebts,
    savingsFlows: state.settings.savingsFlows,
  });
  const fundings = effectiveFundings(state.fundings, capital.accounts, state.settings.accounts, state.goals, today);
  const installments = detectInstallments(state, today, classification);

  const nextIncome = nextIncomeDate(state.settings, today);
  if (nextIncome.source === 'default') {
    explanation.push(step('overview.income_default', `Расписание доходов не задано: горизонт до следующего дохода принят ${state.settings.defaultIncomeHorizonDays} дн. (до ${day(nextIncome.date)})`, { date: nextIncome.date, level: 'warn' }));
  } else {
    explanation.push(step('overview.income', `Следующий доход: «${nextIncome.title}» ${day(nextIncome.date)}`, { date: nextIncome.date }));
  }
  const upcoming30 = upcomingPayments(obligations, today, addDays(today, 30));
  const untilIncome = upcomingPayments(obligations, today, nextIncome.date);
  const reserveUntilIncome = sum(untilIncome.map((u) => u.amount));
  const fm = goalsFreeMoney(capital.accounts, fundings, reserveUntilIncome, today);
  const assigned = fm.result.assignedLiquid;
  const freeMoney = fm.result.free;
  explanation.push(
    step('overview.reserve', untilIncome.length ? `Резерв под платежи до ${day(nextIncome.date)}: ${money(reserveUntilIncome)} — ${untilIncome.map((u) => `«${u.title}» ${money(u.amount)} ${day(u.date)}`).join(', ')}` : `Платежей по обязательствам до ${day(nextIncome.date)} нет`, { amount: reserveUntilIncome, ...(untilIncome.length ? {} : { detail: true }) }),
    step('overview.free', `Свободно ${money(freeMoney)} = ${formula([['на руках', capital.liquidNow, 1], ['за целями', assigned, -1], ['под платежи', reserveUntilIncome, -1]])}`, { amount: freeMoney, level: freeMoney < 0 ? 'warn' : 'info' }),
  );

  // цели: суммы по правилам, дерево, превышения назначений
  const baseline = baselineMonthly(classification?.ops ?? [], today, baseClassIds(classRegistry(state.settings.classes), today), state.settings.baselineMonths);
  const resolved = resolveGoalTargets(state.goals, baseline.median, state.settings.reserveMonths);
  const tree = goalTree(resolved.goals, fundings, today, state.settings.horizonMonths);
  const balances = balancesFromPositions(capital.accounts);
  const overAssigned = overAssignment(fundings, balances, resolved.goals);
  if (state.goals.length) explanation.push(...baseline.explanation, ...resolved.explanation);

  if (!hasData) notices.push({ code: 'import.missing', level: 'info', text: 'Данных пока нет: загрузи бэкап MoneyManager на экране «Импорт»' });
  if (reconcile && !reconcile.ok) notices.push({ code: 'reconcile.fail', level: 'error', text: `Сверка не сошлась по ${reconcile.accounts.filter((a) => a.status !== 'ok').length} счетам — цифры ниже неточны` });
  if (classification && !classification.complete) {
    const total = sum(classification.unclassified.map((g) => g.total));
    notices.push({
      code: 'unclassified',
      level: 'warn',
      text: `Не размечено ${classification.unclassified.reduce((n, g) => n + g.count, 0)} операций на ${money(total)} (${classification.unclassified.map((g) => g.label).join(', ')}). Отчёты неполные`,
    });
  }
  const review = accountsNeedingReview(state.settings.accounts, data.accounts);
  if (review.length) {
    notices.push({ code: 'accounts.review', level: 'warn', text: `В MoneyManager ${review.length === 1 ? 'счёт помечен' : 'счета помечены'} «не учитывать в балансе»: ${review.map((a) => `«${a.title}»`).join(', ')}. Пока не ответишь, технический это счёт или отложенные деньги, ${review.length === 1 ? 'он исключён' : 'они исключены'} из капитала — экран «Импорт»` });
  }
  for (const b of invalidBindings(state.settings.accounts, capital.accounts, state.goals)) {
    const t = capital.accounts.find((p) => p.accountId === b.accountId)?.title ?? b.accountId;
    notices.push({ code: 'accounts.bound_invalid', level: 'warn', text: `Привязка «${t}» к цели не действует: ${b.reason}. Деньги счёта считаются свободными — поправь в «Настройки → Счета»` });
  }
  if (data.warnings.length) notices.push({ code: 'import.warnings', level: 'warn', text: `Импорт: ${data.warnings.length} предупреждений — см. экран «Импорт»` });
  for (const s of capital.explanation) if (s.level === 'warn') notices.push({ code: s.code, level: 'warn', text: s.text });
  const stalled = new Set(installments.checks.filter((c) => c.kind === 'stalled').map((c) => c.obligationId));
  for (const o of obligations) {
    for (const s of o.explanation) if (s.level === 'warn' && !(s.code === 'obligation.overdue' && stalled.has(o.obligation.id))) notices.push({ code: s.code, level: 'warn', text: s.text });
  }
  if (installments.suggestions.length) {
    const n = installments.suggestions.length;
    notices.push({
      code: 'installments.detected',
      level: 'warn',
      text: `В операциях найдены рассрочки, которые не заведены: ${n} (${installments.suggestions.map((s) => s.title).join(', ')}). Без них «Свободно» и прогноз не знают о будущих платежах`,
      action: { route: 'settings', section: 'obligations', label: 'Завести' },
    });
  }
  for (const c of installments.checks) notices.push({ code: `installments.${c.kind}`, level: 'warn', text: c.text, action: { route: 'settings', section: 'obligations', label: 'Проверить' } });
  const titleOf = (id: string) => capital.accounts.find((p) => p.accountId === id)?.title ?? id;
  for (const o of overAssigned) {
    notices.push({ code: 'goals.over_assigned', level: 'error', text: `«${titleOf(o.accountId)}»: ${o.text}: ${o.options.map((x) => `«${x.title}» до ${money(x.amount)}`).join(', ')}` });
  }
  for (const n of flattenTree(tree)) {
    if (n.achieved && n.goal.status === 'active') notices.push({ code: 'goal.achieved', level: 'info', text: `Цель «${n.goal.title}» достигла минимума (${money(n.progress)} из ${money(n.goal.targetMin)}). Отметить выполненной — на экране «Цели»` });
  }
  if (freeMoney < 0) notices.push({ code: 'free.negative', level: 'error', text: `Свободных денег нет: не хватает ${money(sub(ZERO, freeMoney))} до следующего дохода` });
  notices.push(...(extras.notices ?? []));
  explanation.push(...(extras.explanation ?? []));

  for (const n of notices) if (!n.action) n.action = noticeAction(n.code);
  return {
    today, hasData, reconcile, classification, capital, obligations, upcoming30, nextIncome, reserveUntilIncome, assigned, freeMoney,
    baseline, goals: resolved.goals, goalTree: tree, overAssigned, balances, fundings, installments,
    notices, explanation,
  };
}

