/**
 * Экран «Обзор» как чистая функция: из состояния и даты — всё, что показывается.
 */
import { applySpikes } from './spikes';
import { sub, sum, ZERO, type Money } from './money';
import { addDays, fullMonthsBefore, monthKey, nextDayOfMonth, maxDate, type IsoDate, type MonthKey } from './date';
import { day, formula, money, plural, step, type Explanation } from './explain';
import { detectInstallments, type InstallmentScan } from './installment-detect';
import { classifyAll, type ClassificationReport, type ClassifiedOp } from './classify';
import { averageMonthly, baselineMonthly, monthlyFlows, computeCapital, reconcileAccounts, type Baseline, type CapitalReport, type ReconcileReport } from './ledger';
import { AUTO_CUSHION_PREFIX, balancesFromPositions, effectiveFundings, flattenTree, freeMoney as goalsFreeMoney, goalTree, invalidBindings, overAssignment, resolveGoalTargets, type Goal, type GoalFunding, type GoalNode, type OverAssignment } from './goals';
import { accountKindGuess, accountsNeedingReview, type AccountKind } from './settings';
import { daysBetween } from './date';
import { add, mulDiv } from './money';
import { obligationStatus, upcomingPayments, type ObligationStatus, type UpcomingPayment } from './obligations';
import type { Settings } from './settings';
import { UNCHECKED_CLASS_ID, classRegistry, type ClassDef } from './classes';
import type { OpClass } from './classify';

/** Классы, из которых складываются базовые расходы (резерв, запас до дохода): поведение «базовый», не закончившиеся. */
export function baseClassIds(reg: readonly ClassDef[], today: IsoDate): OpClass[] {
  return reg.filter((c) => c.group === 'expense' && c.behavior === 'base' && (!c.endDate || c.endDate >= today)).map((c) => c.id);
}
import type { AppState } from './state';
import type { ImportedData } from './types';

/** Доход меньше этой доли обычных месячных трат (в %) не ограничивает окно «до дохода» (D111). */
export const WINDOW_INCOME_SHARE_PCT = 25;

/** Минимум месяцев без работы, при котором режим «без зарплаты» включается (иначе — последние, как раньше). */
export const MIN_NO_WORK_MONTHS = 3;

/**
 * Месяцы для «обычных трат» (D113). По умолчанию — последние `baselineMonths` полных. Режим `no_work` — последние
 * `baselineMonths` полных месяцев, в которых не было дохода от работы, хоть бы и давно: человек, который лето поработал,
 * а до этого полтора года не работал, не должен считать обычные траты по месяцам с зарплатой.
 * Если таких месяцев меньше `MIN_NO_WORK_MONTHS` — как по умолчанию. undefined — по умолчанию (без окна).
 */
export function baselineWindow(state: AppState, ops: readonly ClassifiedOp[], today: IsoDate): MonthKey[] | undefined {
  if (state.settings.baselineMode !== 'no_work') return undefined;
  let first: IsoDate | null = null;
  for (const c of ops) if (first === null || c.op.date < first) first = c.op.date;
  if (first === null) return undefined;
  const reg = classRegistry(state.settings.classes);
  const work = new Set(reg.filter((c) => c.group === 'income' && c.behavior === 'work').map((c) => c.id));
  const all = fullMonthsBefore(today, 120).filter((m) => m >= monthKey(first!));
  const flows = monthlyFlows(ops, all);
  const free = all.filter((m) => ![...work].some((c) => (flows[m]!.byClass[c] ?? ZERO) > 0));
  const pick = free.slice(-state.settings.baselineMonths);
  return pick.length >= MIN_NO_WORK_MONTHS ? pick : undefined;
}

export interface NextIncome {
  date: IsoDate;
  source: 'schedule' | 'default';
  title?: string;
}

/**
 * Ближайшее ожидаемое поступление строго после сегодня (DECISIONS D34).
 * Без расписания — сегодня + defaultIncomeHorizonDays.
 */
export function nextIncomeDate(settings: Settings, today: IsoDate, minAmount: Money = ZERO): NextIncome {
  // D111: «до дохода» — до ближайшего дохода, который что-то значит для трат; мелкое поступление окно не режет.
  // Если крупных нет вовсе — как раньше, ближайший любой.
  const pick = (min: Money): NextIncome | null => {
    let best: NextIncome | null = null;
    const from = addDays(today, 1);
    for (const it of [...settings.incomeSchedule].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (it.amount < min) continue;
      const start = it.start ? maxDate(from, it.start) : from;
      const d = nextDayOfMonth(start, it.dayOfMonth);
      if (it.end && d > it.end) continue;
      if (!best || d < best.date) best = { date: d, source: 'schedule', title: it.title };
    }
    return best;
  };
  return (minAmount > 0 ? pick(minAmount) : null) ?? pick(ZERO) ?? { date: addDays(today, settings.defaultIncomeHorizonDays), source: 'default' };
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
  [/^currency\./, { route: 'settings', section: 'accounts', label: 'Указать курс' }],
  [/^accounts\.bound_invalid$/, { route: 'settings', section: 'accounts', label: 'Открыть счета' }],
  [/^unclassified$/, { route: 'classes', section: 'categories', label: 'Разметить' }],
  [/^capital\.savings/, { route: 'settings', section: 'savings', label: 'Настроить накопления' }],
  [/^capital\.(payables|receivables)_negative$/, { route: 'settings', section: 'debts', label: 'Указать долги' }],
  [/^capital\.double_debt$/, { route: 'settings', section: 'obligations', label: 'Долги и рассрочки' }],
  [/^capital\.excluded$/, { route: 'settings', section: 'accounts', label: 'Открыть счета' }],
  [/^obligation\./, { route: 'settings', section: 'obligations', label: 'Долги и рассрочки' }],
  [/^goals?\./, { route: 'goals', label: 'Открыть цели' }],
  [/^free\.negative$/, { route: 'income', label: 'Что делать' }],
];

/** Действие для предупреждения по его коду; неизвестный код — на «Настройку». */
export function noticeAction(code: string): NoticeAction {
  for (const [re, a] of ACTIONS) if (re.test(code)) return a;
  return { route: 'setup', label: 'Открыть настройку' };
}

/** Классы расходов с поведением «регулярный», не закончившиеся (D96: «регулярное»). */
export function regularClassIds(reg: readonly ClassDef[], today: IsoDate): OpClass[] {
  return reg.filter((c) => c.group === 'expense' && c.behavior === 'regular' && (!c.endDate || c.endDate >= today)).map((c) => c.id);
}

/** Главные числа нового «Обзора» (D96). */
export interface SpendView {
  /** Вид каждого учитываемого счёта. */
  kinds: Record<string, AccountKind>;
  /** Счета, отмеченные копилкой по догадке приложения (не человеком) — показать «проверь» (D103). */
  guessedSavings: string[];
  /** Σ счетов «для трат», доступных сегодня. */
  spendNow: Money;
  /** Отложено, но ещё на счетах для трат (назначения целям на них). */
  setAsideOnSpend: Money;
  /** Свободно после обычных трат до дохода = spendNow − setAsideOnSpend − платежи до дохода − обычные траты до дохода (D174). */
  canSpend: Money;
  /** Обычные траты до следующего дохода (usualMonthly × дни / 30,4). */
  usualUntilIncome: Money;
  /** Дней до следующего дохода (не меньше 1). */
  days: number;
  perDay: Money;
  /** Обычные траты в месяц: повседневное + регулярное + не проверенное (по среднему, D104). */
  usualMonthly: Money;
  /** Из них — траты категорий, которые приложение не узнало: среднее в месяц (D104). */
  uncheckedMonthly: Money;
  usualPerDay: Money;
  /** Все учитываемые счета, включая вклады с датой. */
  onHand: Money;
  inSavings: Money;
  /** Деньги, которые сейчас снять нельзя: счёт и дата. */
  locked: { accountId: string; title: string; balance: Money; availableFrom: IsoDate }[];
  /** Платежи по долгам и рассрочкам в месяц (среднее за 3 месяца вперёд). */
  obligationsMonthly: Money;
  regularMedian: Money;
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
  /** Сами эти платежи — для «Как посчитано» (D93). */
  untilIncome: UpcomingPayment[];
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
  spend: SpendView;
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
  const classified = hasData ? classifyAll(data, state.settings.classification) : null;
  // D175: ответы про всплески трат переводят их операции в «Больше не повторится»
  const classification = classified && state.settings.spikes ? { ...classified, ops: applySpikes(classified.ops, state.settings.spikes) } : classified;
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
    ...(state.settings.currencyRates ? { currencyRates: state.settings.currencyRates } : {}),
  });
  const explicitFundings = effectiveFundings(state.fundings, capital.accounts, state.settings.accounts, state.goals, today);
  let fundings = explicitFundings;
  const installments = detectInstallments(state, today, classification);

  // обычные траты нужны раньше: от них зависит, какой доход считать «настоящим» для окна «до дохода» (D111)
  const reg = classRegistry(state.settings.classes);
  const bWindow = baselineWindow(state, classification?.ops ?? [], today);
  const baseline = baselineMonthly(classification?.ops ?? [], today, baseClassIds(reg, today), state.settings.baselineMonths, undefined, bWindow);
  const regular = baselineMonthly(classification?.ops ?? [], today, regularClassIds(reg, today), state.settings.baselineMonths, 'Регулярные траты', bWindow);
  // как в прогнозе — сумма медиан по каждому классу (D119): иначе «обычные траты» на «Обзоре» и в прогнозе — два разных числа
  const regularMedian = sum(regularClassIds(reg, today).map((c) => baselineMonthly(classification?.ops ?? [], today, c, state.settings.baselineMonths, undefined, bWindow).median));
  const usualEarly = add(baseline.median, regularMedian);
  const nextIncome = nextIncomeDate(state.settings, today, mulDiv(usualEarly, WINDOW_INCOME_SHARE_PCT, 100));
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
    step('overview.reserve', untilIncome.length ? `Резерв под платежи до ${day(nextIncome.date)}: ${money(reserveUntilIncome)} — ${untilIncome.map((u) => `«${u.title}» ${money(u.amount)} ${day(u.date)}`).join(', ')}` : `Платежей по долгам и рассрочкам до ${day(nextIncome.date)} нет`, { amount: reserveUntilIncome, ...(untilIncome.length ? {} : { detail: true }) }),
    step('overview.free', `Свободно ${money(freeMoney)} = ${formula([['на руках', capital.liquidNow, 1], ['за целями', assigned, -1], ['под платежи', reserveUntilIncome, -1]])}`, { amount: freeMoney, level: freeMoney < 0 ? 'warn' : 'info' }),
  );

  // цели: суммы по правилам, дерево, превышения назначений
  const obligationsMonthly = mulDiv(sum(upcomingPayments(obligations, today, addDays(today, 90)).map((u) => u.amount)), 1, 3);
  const resolved = resolveGoalTargets(state.goals, baseline.median, state.settings.reserveMonths, {
    essential: add(baseline.median, obligationsMonthly),
    all: add(add(add(baseline.median, regularMedian), averageMonthly(classification?.ops ?? [], today, UNCHECKED_CLASS_ID, 12).monthly), obligationsMonthly),
  });
  // одна подушка (D172): свободные деньги в копилках — те, что не закреплены ни за какой целью, — засчитываются подушке, пока она не набрана
  const cushion = resolved.goals.find((g) => g.role === 'safety' && g.parentId === undefined && g.status === 'active' && !g.folder);
  if (cushion && cushion.targetMin > 0) {
    const subtree = new Set<string>([cushion.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const g of resolved.goals) if (g.parentId !== undefined && subtree.has(g.parentId) && !subtree.has(g.id)) (subtree.add(g.id), (grew = true));
    }
    let need = Math.max(0, cushion.targetMin - sum(explicitFundings.filter((f) => subtree.has(f.goalId)).map((f) => f.amount))) as Money;
    const pools = capital.accounts
      .filter((p) => !p.excluded && p.availableFrom <= today && accountKindGuess(p, state.settings.accounts, state.manualAccounts).kind === 'savings')
      .map((p) => ({ accountId: p.accountId, free: Math.max(0, p.balance - sum(explicitFundings.filter((f) => f.accountId === p.accountId).map((f) => f.amount))) as Money }))
      .filter((p) => p.free > 0)
      .sort((a, b) => b.free - a.free || (a.accountId < b.accountId ? -1 : 1));
    const auto: GoalFunding[] = [];
    for (const p of pools) {
      if (need <= 0) break;
      const take = Math.min(need, p.free) as Money;
      need = (need - take) as Money;
      auto.push({ id: `${AUTO_CUSHION_PREFIX}${p.accountId}`, goalId: cushion.id, accountId: p.accountId, amount: take, date: today, decisionId: null, note: 'свободные деньги копилки — в подушку' });
    }
    if (auto.length) fundings = [...explicitFundings, ...auto];
  }
  const tree = goalTree(resolved.goals, fundings, today, state.settings.horizonMonths);
  const balances = balancesFromPositions(capital.accounts);
  const overAssigned = overAssignment(fundings, balances, resolved.goals);
  if (state.goals.length) explanation.push(...baseline.explanation, ...resolved.explanation);

  if (!hasData) notices.push({ code: 'import.missing', level: 'info', text: 'Данных пока нет: загрузи бэкап MoneyManager в «Ещё → Импорт»' });
  if (capital.unrated.length) notices.push({ code: 'currency.rate_missing', level: 'warn', text: `Счёт ${capital.unrated.map((a) => `«${a.title}» (${a.currency})`).join(', ')} не в тенге, курса нет — в капитал не входит. Укажи курс в «Ещё → Счета»` });
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
    notices.push({ code: 'accounts.bound_invalid', level: 'warn', text: `Привязка «${t}» к цели не действует: ${b.reason}. Деньги счёта считаются свободными — поправь в «Ещё → Счета»` });
  }
  if (data.meta.defaultCurrency && data.meta.defaultCurrency !== 'KZT') {
    notices.push({ code: 'import.default_currency', level: 'error', text: `Основная валюта в MoneyManager — ${data.meta.defaultCurrency}, а Capital OS считает в тенге: суммы подписаны «₸», хотя это ${data.meta.defaultCurrency}. Числа и выводы приложения здесь неверны. Пока приложение рассчитано на основную валюту KZT` });
  }
  if (data.warnings.length) notices.push({ code: 'import.warnings', level: 'warn', text: `Импорт: ${data.warnings.length} ${plural(data.warnings.length, 'замечание', 'замечания', 'замечаний')} — см. экран «Импорт»` });
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

  // новый «Обзор» (D96): можно тратить, на руках, копилки
  const kinds: Record<string, AccountKind> = {};
  let spendNow = ZERO;
  let onHand = ZERO;
  let inSavings = ZERO;
  const locked: SpendView['locked'] = [];
  const guessedSavings: string[] = [];
  for (const p of capital.accounts) {
    if (p.excluded) continue;
    const g = accountKindGuess(p, state.settings.accounts, state.manualAccounts);
    const k = g.kind;
    kinds[p.accountId] = k;
    if (k === 'savings' && !g.confirmed && p.source === 'moneymanager') guessedSavings.push(p.accountId);
    onHand = add(onHand, p.balance);
    if (k === 'savings') inSavings = add(inSavings, p.balance);
    if (p.availableFrom > today && p.balance > 0) locked.push({ accountId: p.accountId, title: p.title, balance: p.balance, availableFrom: p.availableFrom });
    else if (k === 'spend') spendNow = add(spendNow, p.balance);
  }
  const setAsideOnSpend = sum(fundings.filter((f) => kinds[f.accountId] === 'spend').map((f) => f.amount));
  const days = Math.max(1, daysBetween(today, nextIncome.date));
  // не узнанные категории: в «обычно уходит» — по среднему за месяц, а не медианой как регулярные (D104)
  const unchecked = averageMonthly(classification?.ops ?? [], today, UNCHECKED_CLASS_ID, 12).monthly;
  const usualMonthly = add(add(baseline.median, regularMedian), unchecked);
  // D174: «можно тратить» — это то, что останется после платежей И обычных трат до дохода, а не просто баланс минус платежи
  const usualUntilIncome = mulDiv(usualMonthly, 12 * days, 365);
  const canSpend = sub(sub(sub(spendNow, setAsideOnSpend), reserveUntilIncome), usualUntilIncome);
  const spend: SpendView = {
    kinds, guessedSavings, spendNow, setAsideOnSpend, canSpend, usualUntilIncome, days,
    perDay: canSpend > 0 ? mulDiv(canSpend, 1, days) : ZERO,
    usualMonthly, uncheckedMonthly: unchecked, usualPerDay: mulDiv(usualMonthly, 12, 365),
    onHand, inSavings, locked, obligationsMonthly, regularMedian,
  };
  return {
    spend,
    today, hasData, reconcile, classification, capital, obligations, upcoming30, nextIncome, reserveUntilIncome, untilIncome, assigned, freeMoney,
    baseline, goals: resolved.goals, goalTree: tree, overAssigned, balances, fundings, installments,
    notices, explanation,
  };
}

