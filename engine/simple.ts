/**
 * Новый первый слой (D96): числа и правила простых экранов поверх того же движка.
 * «Пришли деньги», «Отложил» с напоминанием, новые доходы из бэкапа, вердикты целей, запас прочности,
 * автоматическая разметка и 4 корзины трат. Чистые функции; дата — параметр.
 */
import { add, median, min, mulDiv, pos, sub, sum, ZERO, type Money } from './money';
import { addDays, addMonths, fullMonthsBefore, monthKey, monthsBetween, type IsoDate, type MonthKey } from './date';
import { classGroup, classifyAll, setCategoryClass, suggestClassForCategory, type ClassificationSettings, type OpClass } from './classify';
import { UNCHECKED_CLASS_ID, classRegistry, type Behavior, type ClassDef, type ClassSettings } from './classes';
export { UNCHECKED_CLASS_ID };
import { eligibleGoals, ladder, listOrder, requiredMonthly, type StrategyParams } from './ladder';
import { BOUND_PREFIX, assignMoney, withoutAuto, flattenTree, type Goal, type GoalFunding } from './goals';
import { step, type Outcome } from './explain';
import { baselineWindow, buildOverview, type Overview } from './overview';
import { buildSimInput, planIncome } from './plan';
import { simulate, type SimResult } from './simulate';
import { capitalInMonths } from './forecast-steps';
import { NEVER_AVAILABLE } from './ledger';
import type { CompareResult } from './allocate';
import type { AppState } from './state';
import type { Category, ImportedData } from './types';
import { categoryName } from './import/mmbackup';
import type { IncomeScheduleItem } from './settings';

// ───────────────────────── «Пришли деньги» ─────────────────────────

export interface ArrivedIncome {
  opId: string;
  date: IsoDate;
  amount: Money;
  accountId: string;
  title: string;
}

/** Доходы, которые не повод «откладывать»: проценты и кэшбэк. */
const MINOR_INCOME = new Set<string>(['I_interest', 'I_cashback']);

/**
 * Поступления, которые ещё не распределены: доходы на счета «для трат» после последнего решения о распределении
 * (не раньше, чем 45 дней назад). Сначала новые.
 */
export function arrivedIncomes(state: AppState, today: IsoDate, o: Overview = buildOverview(state, today)): ArrivedIncome[] {
  if (!state.imported || !o.classification) return [];
  const lastDecision = state.decisions.filter((d) => d.type === 'allocation').map((d) => d.date).sort().pop();
  const from = lastDecision && lastDecision > addDays(today, -45) ? lastDecision : addDays(today, -45);
  const cats = new Map(state.imported.categories.map((c) => [c.id, c]));
  const out: ArrivedIncome[] = [];
  const handled = new Set(state.settings.handledIncomes ?? []);
  for (const c of o.classification.ops) {
    const op = c.op;
    if (op.kind !== 'income' || classGroup(c.cls) !== 'income' || MINOR_INCOME.has(c.cls) || handled.has(op.id)) continue;
    if (op.date <= from || op.date > today) continue;
    if (o.spend.kinds[op.accountId] !== 'spend') continue;
    out.push({ opId: op.id, date: op.date, amount: op.amount, accountId: op.accountId, title: op.categoryId && cats.get(op.categoryId) ? categoryName(cats.get(op.categoryId)!, state.settings.categoryLabels) : 'доход' });
  }
  // подарки — в конце: первым предлагается распределить зарплату, стипендию, пособие (D104)
  const gift = new Set(o.classification.ops.filter((c) => c.cls === 'I_gift').map((c) => c.op.id));
  return out.sort((a, b) => Number(gift.has(a.opId)) - Number(gift.has(b.opId)) || (a.date < b.date ? 1 : a.date > b.date ? -1 : a.opId < b.opId ? 1 : -1));
}

export interface SplitLine {
  goalId: string;
  title: string;
  amount: Money;
  /** «чтобы успеть к …», «подушка», «без срока» … */
  why: string;
  /** Нужно в этом месяце, чтобы успеть (цели со сроком). */
  required?: Money;
}

export interface SimpleSplit {
  compare: CompareResult;
  /** Сколько отложить всего. */
  setAside: Money;
  lines: SplitLine[];
  /** Цели со сроком, которым не хватило до нужного в этом месяце. */
  short: { goalId: string; title: string; required: Money; given: Money; deadline: IsoDate }[];
  /** На жизнь до следующего дохода после «отложить». */
  life: Money;
  lifePerDay: Money;
  usualPerDay: Money;
  nextIncome: IsoDate;
  days: number;
  /** Платежи по долгам до следующего дохода — уже вычтены. */
  payments: { title: string; amount: Money; date: IsoDate }[];
  /** Дохода не хватает на платежи и обычные траты до следующего. */
  deficit: Money;
  /** Деньги в копилках без цели (D172): сначала они закроют цели по порядку списка, и поступление считается уже после них. */
  fromSavings: { total: Money; lines: { goalId: string; title: string; amount: Money }[] };
}

/**
 * Разделить поступление по правилам «По порядку» (стратегия S): платежи и обычные траты до дохода,
 * подушка, цели со сроком — сколько нужно, цели без срока — по порядку. Остаток — на жизнь.
 */
export function splitIncome(state: AppState, today: IsoDate, amount: Money, incomeInBalance: boolean): SimpleSplit {
  const o = buildOverview(state, today);
  const strategy: StrategyParams = { id: 'S' };
  // свободные деньги в копилках закроют цели по порядку списка — поступление считается после них (D172)
  const fromSavingsDist = distributeSavings(o, today, 'virt');
  const compare = planIncome(state, today, { amount, incomeInBalance, strategies: [strategy], simple: true, extraProgress: fromSavingsDist.byGoal });
  const row = compare.rows[0];
  const byId = new Map(o.goals.map((g) => [g.id, g]));
  const { list } = eligibleGoals(o.goals);
  const listed = new Map(list.map((g) => [g.id, g]));
  const lines: SplitLine[] = [];
  const short: SimpleSplit['short'] = [];
  const progress = new Map<string, Money>();
  for (const f of o.fundings) progress.set(f.goalId, add(progress.get(f.goalId) ?? ZERO, f.amount));
  for (const [goalId, a] of Object.entries(fromSavingsDist.byGoal)) progress.set(goalId, add(progress.get(goalId) ?? ZERO, a));
  if (row) {
    for (const g of listOrder(o.goals)) {
      const a = row.byGoal[g.id];
      const lg = listed.get(g.id);
      if (!lg) continue;
      const u = row.underfunded.find((x) => x.goalId === g.id);
      if (u && lg.deadline) short.push({ goalId: g.id, title: g.title, required: u.required, given: u.given, deadline: lg.deadline });
      if (!a || a <= 0) {
        if (!lg.deadline && lg.role !== 'safety') lines.push({ goalId: g.id, title: g.title, amount: ZERO, why: 'без срока — ждёт, пока хватит на цели со сроком' });
        else if (u && lg.deadline) lines.push({ goalId: g.id, title: g.title, amount: ZERO, why: `чтобы успеть к ${ddmm(lg.deadline)}`, required: u.required });
        continue;
      }
      const why = lg.role === 'safety' && lg.parentId === undefined ? 'подушка' : lg.deadline ? `чтобы успеть к ${ddmm(lg.deadline)}` : g.parentId && byId.get(g.parentId)?.splitEqually ? `поровну в папке «${byId.get(g.parentId)!.title}»` : 'без срока, по порядку';
      const req = lg.deadline ? requiredMonthly(lg, progress.get(g.id) ?? ZERO, today, state.settings.strategy) : undefined;
      lines.push({ goalId: g.id, title: g.title, amount: a, why, ...(req !== undefined ? { required: req } : {}) });
    }
  }
  const setAside = sum(lines.map((l) => l.amount));
  // на жизнь: можно тратить сейчас (+ поступление, если его ещё нет в балансе) − отложить
  const base = incomeInBalance ? o.spend.canSpend : add(o.spend.canSpend, amount);
  const life = sub(base, setAside);
  const days = o.spend.days;
  return {
    compare,
    setAside,
    lines,
    short,
    life,
    lifePerDay: life > 0 ? mulDiv(life, 1, days) : ZERO,
    usualPerDay: o.spend.usualPerDay,
    nextIncome: o.nextIncome.date,
    days,
    payments: o.untilIncome.map((u) => ({ title: u.title, amount: u.amount, date: u.date })),
    deficit: compare.step0.ok ? ZERO : compare.step0.deficit,
    fromSavings: {
      total: sum(Object.values(fromSavingsDist.byGoal)),
      lines: listOrder(o.goals).filter((g) => (fromSavingsDist.byGoal[g.id] ?? 0) > 0).map((g) => ({ goalId: g.id, title: g.title, amount: fromSavingsDist.byGoal[g.id]! })),
    },
  };
}

const ddmm = (d: IsoDate) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

// ───────────────────────── «Отложил»: перевод на копилку ─────────────────────────

/**
 * После импорта: переводы со счёта для трат на копилку забирают «отложенные» метки на этот счёт-копилку (D96).
 * Метки — журнал: исходная не меняется, добавляются «снято со счёта для трат» и «на копилку». Старые сначала.
 */
export function settleSetAsides(state: AppState, today: IsoDate): { state: AppState; moved: Money } {
  if (!state.imported) return { state, moved: ZERO };
  const o = buildOverview(state, today);
  const kinds = o.spend.kinds;
  const added: GoalFunding[] = [];
  let moved = ZERO;
  const net = (accountId: string, goalId: string, extra: readonly GoalFunding[]) =>
    sum([...state.fundings, ...extra].filter((f) => f.accountId === accountId && f.goalId === goalId).map((f) => f.amount));
  const spendAccounts = [...new Set(state.fundings.filter((f) => f.pending && kinds[f.accountId] === 'spend').map((f) => f.accountId))].sort();
  for (const acc of spendAccounts) {
    const pending = state.fundings.filter((f) => f.pending && f.accountId === acc).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    const since = pending[0]!.date;
    // переводы с этого счёта на копилки после даты «Отложил», минус то, что уже перенесено раньше
    const transfers = state.imported.operations
      .filter((op) => op.kind === 'transfer' && op.fromAccountId === acc && op.date >= since && kinds[op.toAccountId] === 'savings')
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    const alreadyMoved = sum(state.fundings.filter((f) => f.accountId === acc && f.amount < 0 && f.note === 'переведено на копилку').map((f) => -f.amount as Money));
    // очередь переводов: у каждого свой счёт-копилка и свой остаток; уже перенесённое списывается с самых ранних (D106)
    const queue: { to: string; left: Money }[] = [];
    let skip = alreadyMoved;
    for (const t of transfers) {
      if (t.kind !== 'transfer') continue;
      const cut = min(skip, t.fromAmount);
      skip = sub(skip, cut);
      const left = sub(t.fromAmount, cut);
      if (left > 0) queue.push({ to: t.toAccountId, left });
    }
    const uid = (base: string) => {
      let id = base;
      for (let n = 2; [...state.fundings, ...added].some((x) => x.id === id); n++) id = `${base}-${n}`;
      return id;
    };
    for (const f of pending) {
      if (!queue.length) break;
      let want = min(net(acc, f.goalId, added), f.amount);
      // метки уходят на те копилки, куда реально пошли деньги, по порядку переводов
      while (want > 0 && queue.length) {
        const q = queue[0]!;
        const take = min(want, q.left);
        added.push(
          { id: uid(`${f.id}-out`), goalId: f.goalId, accountId: acc, amount: -take as Money, date: today, decisionId: f.decisionId, note: 'переведено на копилку' },
          { id: uid(`${f.id}-in`), goalId: f.goalId, accountId: q.to, amount: take, date: today, decisionId: f.decisionId, note: 'переведено на копилку' },
        );
        want = sub(want, take);
        q.left = sub(q.left, take);
        moved = add(moved, take);
        if (q.left <= 0) queue.shift();
      }
    }
  }
  return added.length ? { state: { ...state, fundings: [...state.fundings, ...added] }, moved } : { state, moved };
}

export interface SetAsideReminder {
  accountId: string;
  title: string;
  amount: Money;
  since: IsoDate;
}

/** «Отложил N, но перевода на копилку в бэкапе нет»: бэкап новее даты «Отложил», а метки всё ещё на счёте для трат. */
export function setAsideReminders(state: AppState, o: Overview): SetAsideReminder[] {
  const last = state.imported?.meta.lastDate;
  if (!last) return [];
  const out: SetAsideReminder[] = [];
  const accs = [...new Set(state.fundings.filter((f) => f.pending && o.spend.kinds[f.accountId] === 'spend').map((f) => f.accountId))].sort();
  for (const acc of accs) {
    const since = state.fundings.filter((f) => f.pending && f.accountId === acc).map((f) => f.date).sort()[0]!;
    // только «Отложил» на этом счёте за вычетом уже перенесённого на копилку; прежние метки не в счёт
    const net = sum(state.fundings.filter((f) => f.accountId === acc && (f.pending || f.note === 'переведено на копилку')).map((f) => f.amount));
    const amount = min(net, sum(state.fundings.filter((f) => f.accountId === acc).map((f) => f.amount)));
    if (amount <= 0 || last <= since) continue;
    out.push({ accountId: acc, title: o.capital.accounts.find((p) => p.accountId === acc)?.title ?? acc, amount, since });
  }
  return out;
}

// ───────────────────────── новые доходы в бэкапе ─────────────────────────

export interface IncomeCandidate {
  categoryId: string;
  title: string;
  amount: Money;
  dayOfMonth: number;
  months: number;
}

const normTitle = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/**
 * Похоже на регулярный доход, которого нет в «Доходах»: категория дохода (не проценты и не кэшбэк) встречается
 * в 2+ из последних трёх месяцев (включая текущий). Сумма — медиана по месяцам, день — медиана дней.
 */
export function detectNewIncomes(state: AppState, today: IsoDate, o: Overview = buildOverview(state, today)): IncomeCandidate[] {
  if (!state.imported || !o.classification) return [];
  const months = [0, 1, 2, 3].map((k) => monthKey(addMonths(today, -k)));
  const from = `${months[3]}-01`;
  const cats = new Map(state.imported.categories.map((c) => [c.id, c]));
  const by = new Map<string, { perMonth: Map<MonthKey, Money>; days: number[] }>();
  for (const c of o.classification.ops) {
    const op = c.op;
    if (op.kind !== 'income' || classGroup(c.cls) !== 'income' || MINOR_INCOME.has(c.cls) || c.cls === 'I_gift' || !op.categoryId) continue;
    if (op.date < from || op.date > today) continue;
    const e = by.get(op.categoryId) ?? { perMonth: new Map<MonthKey, Money>(), days: [] as number[] };
    e.perMonth.set(monthKey(op.date), add(e.perMonth.get(monthKey(op.date)) ?? ZERO, op.amount));
    e.days.push(Number(op.date.slice(8, 10)));
    by.set(op.categoryId, e);
  }
  const dismissed = new Set(state.settings.dismissedIncomes ?? []);
  // подарки и не узнанные приложением доходы — не повод считать доход регулярным (D104)
  for (const r of state.settings.classification.rules) if (r.categoryId && r.auto && r.class === 'I_other') dismissed.add(r.categoryId);
  const known = state.settings.incomeSchedule;
  const out: IncomeCandidate[] = [];
  for (const [catId, e] of [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const recent = months.slice(0, 3).filter((m) => e.perMonth.has(m));
    if (recent.length < 2 || dismissed.has(catId)) continue;
    const title = cats.get(catId) ? categoryName(cats.get(catId)!, state.settings.categoryLabels) : 'Доход';
    const amount = median(recent.map((m) => e.perMonth.get(m)!));
    if (amount <= 0) continue;
    const days = [...e.days].sort((a, b) => a - b);
    const dayOfMonth = days[Math.floor(days.length / 2)]!;
    if (known.some((k) => matchesIncome(k, title, amount))) continue;
    out.push({ categoryId: catId, title, amount, dayOfMonth, months: recent.length });
  }
  return out;
}

/** Доход уже заведён: то же название или сумма в пределах ±20%. */
function matchesIncome(k: IncomeScheduleItem, title: string, amount: Money): boolean {
  if (normTitle(k.title) === normTitle(title)) return true;
  return Math.abs(k.amount - amount) * 5 <= amount;
}

// ───────────────────────── цели: успеваешь или нет ─────────────────────────

export interface GoalVerdict {
  goalId: string;
  deadline: IsoDate;
  remaining: Money;
  /** Откладывай в месяц, чтобы успеть: осталось ÷ месяцев до срока. */
  perMonth: Money;
  ok: boolean;
  /** Когда наберётся по прогнозу (null — не за срок прогноза). */
  reachMonth: MonthKey | null;
  /** Не успеваешь: сколько ещё нужно в месяц сверх того, что получится. */
  extraPerMonth: Money;
}

/** Вердикт для каждой активной цели со сроком (свой или папки) по прогнозу «как сейчас» (D96). */
export function goalVerdicts(state: AppState, today: IsoDate, sim: SimResult = baseForecast(state, today)): Map<string, GoalVerdict> {
  const o = buildOverview(state, today);
  const out = new Map<string, GoalVerdict>();
  const progress = new Map<string, Money>();
  for (const f of o.fundings) progress.set(f.goalId, add(progress.get(f.goalId) ?? ZERO, f.amount));
  for (const g of eligibleGoals(o.goals).list) {
    if (!g.deadline || g.targetMin <= 0) continue;
    const remaining = pos(sub(g.targetMin, progress.get(g.id) ?? ZERO));
    const m = Math.max(1, monthsBetween(today, g.deadline));
    const reach = sim.goalDates[g.id] ?? null;
    const ok = remaining === 0 || (reach !== null && reach <= monthKey(g.deadline));
    const at = sim.months.find((x) => x.month === monthKey(g.deadline!)) ?? sim.months[sim.months.length - 1];
    const byDeadline = at?.goalProgress[g.id] ?? ZERO;
    out.set(g.id, {
      goalId: g.id,
      deadline: g.deadline,
      remaining,
      perMonth: mulDiv(remaining, 1, m),
      ok,
      reachMonth: reach,
      extraPerMonth: ok ? ZERO : mulDiv(pos(sub(g.targetMin, byDeadline)), 1, m),
    });
  }
  return out;
}

/** Прогноз «как сейчас»: базовый сценарий, стратегия плана, горизонт — не меньше выбранного срока. */
export function baseForecast(state: AppState, today: IsoDate, months = Math.max(state.settings.simulationMonths, state.settings.forecastViewMonths ?? 12)): SimResult {
  const { input } = buildSimInput(state, today);
  return simulate({ ...input, horizonMonths: months });
}

/** То же, что `baseForecast`, но с трассой по дням — для «сколько будет на дату» и «Расчёта по шагам» (D142). Числа те же. */
export function baseForecastTrace(state: AppState, today: IsoDate, months = Math.max(state.settings.simulationMonths, state.settings.forecastViewMonths ?? 12)): SimResult {
  const { input } = buildSimInput(state, today);
  return simulate({ ...input, horizonMonths: months }, undefined, { trace: true });
}

/** Капитал через k месяцев по прогнозу. */
export function capitalAt(sim: SimResult, k: number): Money | null {
  return sim.months[k]?.capital ?? null;
}

/**
 * Запас прочности: если доходы пропадут с завтрашнего дня — сколько месяцев хватит денег (до первого кассового разрыва).
 * null — хватит дольше горизонта.
 */
export function monthsWithoutIncome(state: AppState, today: IsoDate): { months: number; until: IsoDate } | null {
  const { input } = buildSimInput(state, today);
  const sim = simulate({ ...input, incomes: [], events: input.events.filter((e) => e.kind !== 'income_start' && e.kind !== 'income_change'), horizonMonths: Math.max(60, input.horizonMonths) });
  const g = sim.gaps[0];
  if (!g) return null;
  return { months: Math.max(0, monthsBetween(today, g.start)), until: g.start };
}

// ───────────────────────── папки и порядок ─────────────────────────

/** Новый порядок: id по порядку списка → order = 10, 20, … (D96). */
export function reorderGoals(goals: readonly Goal[], ids: readonly string[]): Goal[] {
  const rank = new Map(ids.map((id, i) => [id, (i + 1) * 10]));
  return goals.map((g) => (rank.has(g.id) ? { ...g, order: rank.get(g.id)! } : g));
}

/** Следующий порядок в конце списка (корневого или папки). */
export function nextOrder(goals: readonly Goal[], parentId?: string): number {
  const sib = goals.filter((g) => g.parentId === parentId && g.order !== undefined).map((g) => g.order!);
  return (sib.length ? Math.max(...sib) : 0) + 10;
}

// ───────────────────────── 4 корзины трат ─────────────────────────

export type Basket = 'everyday' | 'regular' | 'oneoff' | 'debts' | 'check';

export const BASKET_LABELS: Record<Basket, string> = {
  everyday: 'Повседневное',
  regular: 'Регулярное',
  oneoff: 'Разовое',
  debts: 'Долги и рассрочки',
  check: 'Нужно проверить',
};

export const BASKET_HINTS: Record<Basket, string> = {
  everyday: 'еда, дорога, связь, быт — без этого не прожить месяц; входит в подушку',
  regular: 'каждый месяц, но можно урезать: развлечения, подписки, учёба',
  oneoff: 'крупные или редкие траты — не завышают «обычно уходит»',
  debts: 'платежи по рассрочкам и кредитам — считаются по графику, вычитаются заранее',
  check: 'приложение не узнало категорию: в «обычно уходит» и прогнозе — по среднему за месяц, а не как каждый месяц',
};


export function basketOf(b: Behavior, classId?: OpClass): Basket | null {
  if (classId === UNCHECKED_CLASS_ID) return 'check';
  if (b === 'base') return 'everyday';
  if (b === 'regular') return 'regular';
  if (b === 'installment') return 'debts';
  if (b === 'irregular' || b === 'temporary' || b === 'excluded') return 'oneoff';
  return null;
}

export const ONEOFF_CLASS_ID = 'U_E_razovoe' as OpClass;
export const NEVER_CLASS_ID = 'U_E_ne_povtoritsya' as OpClass;

/** Как ведёт себя «разовая» трата дальше (D104): повторится иногда / до даты / больше не будет. */
export type OneoffKind = { kind: 'repeat' } | { kind: 'until'; date: IsoDate } | { kind: 'never' };

export const ONEOFF_LABELS = { repeat: 'редкие, но повторяются', until: 'до даты', never: 'больше не повторится' } as const;

/** Тип «Не проверено» есть в настройках (создаётся один раз). */
export function ensureUncheckedClass(classes: ClassSettings): ClassSettings {
  if (classes.custom.some((c) => c.id === UNCHECKED_CLASS_ID)) return classes;
  const def: ClassDef = { id: UNCHECKED_CLASS_ID, label: 'Не проверено', group: 'expense', behavior: 'irregular', builtin: false };
  return { ...classes, custom: [...classes.custom, def] };
}

function ensureClass(classes: ClassSettings, def: ClassDef): ClassSettings {
  return classes.custom.some((c) => c.id === def.id) ? classes : { ...classes, custom: [...classes.custom, def] };
}

/** Класс «Больше не повторится» есть в настройках (создаётся один раз) — для ответов про всплески (D175). */
export function ensureNeverClass(classes: ClassSettings): ClassSettings {
  return ensureClass(classes, { id: NEVER_CLASS_ID, label: 'Больше не повторится', group: 'expense', behavior: 'excluded', builtin: false });
}

/** Класс, которым категория попадает в корзину. Для «разового» — по ответу «повторится / до даты / больше не будет». */
export function basketClass(basket: Basket, classes: ClassSettings, oneoff: OneoffKind = { kind: 'repeat' }): { cls: OpClass; classes: ClassSettings } {
  if (basket === 'everyday') return { cls: 'E_base', classes };
  if (basket === 'regular') return { cls: 'E_other', classes };
  if (basket === 'debts') return { cls: 'E_installment_own', classes };
  if (basket === 'check') return { cls: UNCHECKED_CLASS_ID, classes: ensureUncheckedClass(classes) };
  if (oneoff.kind === 'never') {
    const def: ClassDef = { id: NEVER_CLASS_ID, label: 'Больше не повторится', group: 'expense', behavior: 'excluded', builtin: false };
    return { cls: def.id, classes: ensureClass(classes, def) };
  }
  if (oneoff.kind === 'until') {
    const d = oneoff.date;
    const id = `U_E_do_${d.replace(/-/g, '_')}` as OpClass;
    const def: ClassDef = { id, label: `Временное до ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`, group: 'expense', behavior: 'temporary', endDate: d, builtin: false };
    return { cls: id, classes: ensureClass(classes, def) };
  }
  const def: ClassDef = { id: ONEOFF_CLASS_ID, label: 'Редкие траты', group: 'expense', behavior: 'irregular', builtin: false };
  return { cls: def.id, classes: ensureClass(classes, def) };
}

/** Какой вид «разового» у класса — для подписи. */
export function oneoffOf(c: ClassDef | undefined): keyof typeof ONEOFF_LABELS | null {
  if (!c) return null;
  if (c.behavior === 'irregular') return 'repeat';
  if (c.behavior === 'temporary') return 'until';
  if (c.behavior === 'excluded') return 'never';
  return null;
}

/**
 * Разметить сами категории без правила (D96, D104): по названию (частые слова) — тип по подсказке, с пометкой `auto`
 * («проверь»); не узнанные траты — в «Не проверено» (в прогнозе по среднему, не как регулярные); доходы — «прочий».
 */
export function autoLabelCategories(cls: ClassificationSettings, data: Pick<ImportedData, 'operations' | 'categories' | 'tags'>, classes: ClassSettings = { custom: [], overrides: {} }): { settings: ClassificationSettings; classes: ClassSettings; added: number } {
  const rep = classifyAll(data, cls);
  const cats = new Map<string, Category>(data.categories.map((c) => [c.id, c]));
  const rules = [...cls.rules];
  let added = 0;
  let outClasses = classes;
  for (const u of rep.unclassified) {
    if (u.reason !== 'no_rule' || !u.categoryId) continue;
    const cat = cats.get(u.categoryId);
    if (!cat) continue;
    const name = categoryName(cat);
    const hint = suggestClassForCategory(name, u.opKind);
    let c: OpClass;
    if (hint) c = hint;
    else if (u.opKind === 'expense') {
      c = UNCHECKED_CLASS_ID;
      outClasses = ensureUncheckedClass(outClasses);
    } else c = 'I_other';
    rules.push({ categoryId: cat.id, categoryTitle: name, opKind: u.opKind, class: c, auto: true });
    added++;
  }
  return { settings: added ? { ...cls, rules } : cls, classes: outClasses, added };
}

/** Категории, разложенные приложением и ещё не проверенные человеком (D104). */
export function unconfirmedCategories(cls: ClassificationSettings): { guessed: string[]; unknown: string[] } {
  const guessed: string[] = [];
  const unknown: string[] = [];
  for (const r of cls.rules) {
    if (!r.categoryId) continue;
    if (r.class === UNCHECKED_CLASS_ID) unknown.push(r.categoryId);
    else if (r.auto) guessed.push(r.categoryId);
  }
  return { guessed, unknown };
}

/** «Всё верно»: снять пометку «разложено само» со всех узнанных по названию категорий. Не узнанные остаются «проверить». */
export function confirmGuessedCategories(cls: ClassificationSettings): ClassificationSettings {
  return { ...cls, rules: cls.rules.map((r) => (r.auto && r.class !== UNCHECKED_CLASS_ID ? (({ auto: _a, ...rest }) => rest)(r) : r)) };
}

/** Суммы корзин в обычный месяц — для «Раскладки трат». */
export function basketOfClass(id: OpClass, reg: readonly ClassDef[]): Basket | null {
  const c = reg.find((x) => x.id === id);
  return c && c.group === 'expense' ? basketOf(c.behavior, c.id) : null;
}

// ───────────────────────── нераспределённое в копилках ─────────────────────────

/** Деньги на копилках, не закреплённые ни за одной целью. */
export function unassignedSavings(o: Overview): Money {
  let free = ZERO;
  for (const p of o.capital.accounts) {
    if (p.excluded || o.spend.kinds[p.accountId] !== 'savings') continue;
    const assigned = sum(o.fundings.filter((f) => f.accountId === p.accountId).map((f) => f.amount));
    free = add(free, pos(sub(p.balance, assigned)));
  }
  return free;
}

/**
 * Распределить свободное в копилках по порядку списка (D96, D100): цели сверху вниз, каждая до суммы.
 * Возвращает метки по счетам-копилкам (сначала копилки с бо́льшим свободным остатком).
 */
export function distributeSavings(o: Overview, today: IsoDate, idPrefix: string): { fundings: GoalFunding[]; byGoal: Record<string, Money> } {
  const pools = o.capital.accounts
    .filter((p) => !p.excluded && o.spend.kinds[p.accountId] === 'savings')
    .map((p) => ({ accountId: p.accountId, free: pos(sub(p.balance, sum(o.fundings.filter((f) => f.accountId === p.accountId).map((f) => f.amount)))) }))
    .filter((p) => p.free > 0)
    .sort((a, b) => b.free - a.free || (a.accountId < b.accountId ? -1 : 1));
  const progress = new Map<string, Money>();
  for (const f of o.fundings) progress.set(f.goalId, add(progress.get(f.goalId) ?? ZERO, f.amount));
  const eligible = new Map(eligibleGoals(o.goals).list.map((g) => [g.id, g]));
  const order = listOrder(o.goals).filter((g) => eligible.has(g.id));
  const fundings: GoalFunding[] = [];
  const byGoal: Record<string, Money> = {};
  for (const g of order) {
    let need = pos(sub(g.targetMin, progress.get(g.id) ?? ZERO));
    for (const p of pools) {
      if (need <= 0) break;
      const take = min(need, p.free);
      if (take <= 0) continue;
      p.free = sub(p.free, take);
      need = sub(need, take);
      byGoal[g.id] = add(byGoal[g.id] ?? ZERO, take);
      fundings.push({ id: `${idPrefix}-${g.id}-${p.accountId}`, goalId: g.id, accountId: p.accountId, amount: take, date: today, decisionId: null, note: 'распределено по порядку' });
    }
  }
  return { fundings, byGoal };
}

// ───────────────────────── «Перенести в подушку» (D122) ─────────────────────────

export interface CushionFill {
  cushionId: string;
  /** Сколько подушке не хватает до своей суммы. */
  need: Money;
  /** Сколько переносим (не больше, чем не хватает и чем есть). */
  moved: Money;
  /** Из свободных денег в копилках (ни за какой целью). */
  fromFree: Money;
  /** Из закреплённого за другими целями — снизу списка вверх. */
  fromGoals: { goalId: string; title: string; amount: Money }[];
  /** Записи закрепления: минус у цели-источника, плюс подушке — на том же счёте, сами деньги не двигаются. */
  fundings: GoalFunding[];
}

/**
 * Подушке не хватает до её суммы, а деньги на счетах есть: какие метки переставить в подушку. Сначала свободные деньги в копилках,
 * потом закреплённое за другими целями — с последней в списке (ей достаются деньги позже всех). Деньги по счетам не двигаются —
 * меняются только метки «за какой целью», поэтому на каждом счёте переносится не больше, чем на нём закреплено.
 * Состояние не меняется: функция возвращает записи, добавляет их вызывающий (после подтверждения). null — подушки нет, она набрана или переносить нечего.
 */
export function cushionFill(state: AppState, today: IsoDate, idPrefix: string): CushionFill | null {
  if (!state.imported) return null;
  const o = buildOverview(state, today);
  const node = flattenTree(o.goalTree).find((n) => n.goal.role === 'safety' && n.goal.parentId === undefined && n.goal.status === 'active');
  if (!node || node.goal.targetMin <= 0) return null;
  const need = pos(sub(node.goal.targetMin, node.progress));
  if (need <= 0) return null;
  const cushionId = node.goal.id;
  const own = new Set(flattenTree([node]).map((n) => n.goal.id)); // сама подушка и её подцели: их метки уже в её прогрессе
  const fundings: GoalFunding[] = [];
  let left: Money = need;
  let fromFree: Money = ZERO;
  /** Запись «в подушку»; если источник — явная метка, у цели-источника та же сумма снимается отдельной записью. */
  const put = (goalId: string, accountId: string, takeExplicit: Money, amount: Money, note: string, tag: string) => {
    if (takeExplicit > 0) fundings.push({ id: `${idPrefix}-${tag}-out`, goalId, accountId, amount: -takeExplicit as Money, date: today, decisionId: null, note });
    fundings.push({ id: `${idPrefix}-${tag}-in`, goalId: cushionId, accountId, amount, date: today, decisionId: null, note });
  };

  // 1. свободные деньги в копилках
  for (const p of o.capital.accounts) {
    if (left <= 0) break;
    if (p.excluded || o.spend.kinds[p.accountId] !== 'savings') continue;
    const free = pos(sub(p.balance, sum(o.fundings.filter((f) => f.accountId === p.accountId).map((f) => f.amount))));
    const take = min(left, free);
    if (take <= 0) continue;
    left = sub(left, take);
    fromFree = add(fromFree, take);
    fundings.push({ id: `${idPrefix}-free-${p.accountId}`, goalId: cushionId, accountId: p.accountId, amount: take, date: today, decisionId: null, note: 'в подушку из свободных денег' });
  }

  // 2. закреплённое за другими целями, начиная с последней в списке
  const fromGoals: CushionFill['fromGoals'] = [];
  for (const g of listOrder(o.goals).filter((x) => x.status === 'active' && !x.folder && !own.has(x.id)).reverse()) {
    if (left <= 0) break;
    const title = g.title;
    let got: Money = ZERO;
    for (const accountId of [...new Set(o.fundings.filter((f) => f.goalId === g.id).map((f) => f.accountId))].sort()) {
      if (left <= 0) break;
      const rows = o.fundings.filter((f) => f.goalId === g.id && f.accountId === accountId);
      // «весь остаток счёта за целью» (привязка) — виртуальная метка на то, что не назначено явно: она сама уменьшается, когда на счёте
      // появляется явная метка подушки, поэтому снимать её отдельной записью нельзя (минус и плюс сократились бы, а цель сохранила весь остаток)
      const bound = sum(rows.filter((f) => f.id.startsWith(BOUND_PREFIX)).map((f) => f.amount));
      const have = sum(rows.map((f) => f.amount));
      const take = min(left, have);
      if (take <= 0) continue;
      const takeBound = min(take, pos(bound));
      left = sub(left, take);
      got = add(got, take);
      put(g.id, accountId, sub(take, takeBound), take, `в подушку из «${title}»`, `${g.id}-${accountId}`);
    }
    if (got > 0) fromGoals.push({ goalId: g.id, title, amount: got });
  }
  const moved = sub(need, left);
  if (moved <= 0) return null;
  return { cushionId, need, moved, fromFree, fromGoals, fundings };
}

// ───────────────────────── «Отложить другую сумму» и «Отложил» ─────────────────────────

/** Разложить заданную сумму по правилам «По порядку» — без шага 0 (человек сам решил, сколько отложить). */
export function splitAmount(state: AppState, today: IsoDate, total: Money): { byGoal: Record<string, Money>; lines: SplitLine[] } {
  const o = buildOverview(state, today);
  const progress = new Map<string, Money>();
  for (const f of o.fundings) progress.set(f.goalId, add(progress.get(f.goalId) ?? ZERO, f.amount));
  for (const [goalId, a] of Object.entries(distributeSavings(o, today, 'virt').byGoal)) progress.set(goalId, add(progress.get(goalId) ?? ZERO, a));
  const thisMonth = monthKey(today);
  const fundedThisMonth = new Map<string, Money>();
  for (const f of state.fundings) if (monthKey(f.date) === thisMonth) fundedThisMonth.set(f.goalId, add(fundedThisMonth.get(f.goalId) ?? ZERO, f.amount));
  const r = ladder({ amount: total, today, goals: o.goals, progress, fundedThisMonth, strategy: { id: 'S' }, settings: state.settings.strategy });
  // остаток сверх нужного — по порядку целям со сроком (человек хочет отложить больше)
  const byGoal: Record<string, Money> = { ...r.byGoal };
  let left = r.free;
  for (const g of listOrder(o.goals)) {
    if (left <= 0) break;
    const lg = eligibleGoals(o.goals).list.find((x) => x.id === g.id);
    if (!lg) continue;
    const need = pos(sub(lg.targetMin, add(progress.get(g.id) ?? ZERO, byGoal[g.id] ?? ZERO)));
    const take = min(need, left);
    if (take <= 0) continue;
    byGoal[g.id] = add(byGoal[g.id] ?? ZERO, take);
    left = sub(left, take);
  }
  const title = new Map(o.goals.map((g) => [g.id, g.title]));
  const lines = listOrder(o.goals).filter((g) => (byGoal[g.id] ?? 0) > 0).map((g) => ({ goalId: g.id, title: title.get(g.id) ?? g.id, amount: byGoal[g.id]!, why: '' }));
  return { byGoal, lines };
}

/**
 * «Отложил» (D96): метки на счёте, куда пришли деньги, с пометкой «ещё не переведено» и запись решения.
 * Проверка инварианта 1: закрепить можно не больше свободного остатка счёта.
 */
export function commitSetAside(state: AppState, byGoal: Readonly<Record<string, Money>>, accountId: string, today: IsoDate, decisionId: string, meta: { income: Money; note?: string }): Outcome<AppState> {
  const o = buildOverview(state, today);
  const fundings: GoalFunding[] = [...o.fundings];
  const added: GoalFunding[] = [];
  for (const [goalId, amount] of Object.entries(byGoal).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (amount <= 0) continue;
    const r = assignMoney({ id: `${decisionId}-${goalId}`, goalId, accountId, amount, date: today, decisionId, note: 'отложено' }, { goals: o.goals, fundings: withoutAuto(fundings), balances: o.balances });
    if (!r.ok) return { ok: false, error: `${r.error}. Если денег ещё нет в бэкапе — загрузи свежий`, explanation: r.explanation };
    const f: GoalFunding = { ...r.value, pending: true };
    fundings.push(f);
    added.push(f);
  }
  const total = sum(added.map((f) => f.amount));
  return {
    ok: true,
    value: {
      ...state,
      fundings: [...state.fundings, ...added],
      decisions: [...state.decisions, { id: decisionId, date: today, type: 'allocation', input: { income: meta.income, accountId, setAside: total }, chosenStrategy: ['S'], alternatives: [], explanation: added.map((f) => `${f.goalId}: ${f.amount}`), userNote: meta.note ?? '' }],
    },
    explanation: [step('setaside.done', `Отложено ${total} на цели (${added.length})`)],
  };
}

// ───────────────────────── деньги, которые пока не снять ─────────────────────────

/**
 * Заблокированные деньги по датам (D103): каждая дата — своя сумма. Нельзя складывать вклады и подписывать
 * самой ранней датой: 20 000 с 05.12 и 300 000 с 01.02 — это не «320 000 с 05.12».
 */
export function lockedByDate(locked: readonly { balance: Money; availableFrom: IsoDate }[]): { date: IsoDate; amount: Money }[] {
  const m = new Map<IsoDate, Money>();
  // жильё и заблокированное (D149) — не «деньги, которые разблокируются»: даты у них нет
  for (const x of locked) if (x.availableFrom !== NEVER_AVAILABLE) m.set(x.availableFrom, add(m.get(x.availableFrom) ?? ZERO, x.balance));
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, amount]) => ({ date, amount }));
}

/**
 * Нехватка на счетах для трат до дохода и можно ли закрыть её из копилок (D182, замечание владельца: «не рассматривает деньги в накоплениях»).
 * Только подсказка для показа: числа canSpend и распределения не меняются. Заблокированные вклады (до даты) не считаются доступными.
 */
export function spendGap(sp: { canSpend: Money; inSavings: Money; locked: readonly { balance: Money }[] }): { gap: Money; savings: Money; covered: boolean } | null {
  if (sp.canSpend >= 0) return null;
  const gap = (0 - sp.canSpend) as Money;
  const lockedSum = sp.locked.reduce((a, x) => a + x.balance, 0);
  const savings = Math.max(0, sp.inSavings - lockedSum) as Money;
  return { gap, savings, covered: savings >= gap };
}

/** Состояние подушки для показа (D103): нет подушки, сумму не посчитать (нет данных о тратах), набрана, копится. */
export function cushionStatus(n: { goal: Goal; progress: Money } | undefined): 'none' | 'unknown' | 'ready' | 'saving' {
  if (!n) return 'none';
  if (n.goal.targetMin <= 0) return 'unknown';
  return n.progress >= n.goal.targetMin ? 'ready' : 'saving';
}


/** Редкая трата, про которую не спрошено, повторится ли она (D110). */
export interface SparseExpense {
  categoryId: string;
  title: string;
  count: number;
  total: Money;
  last: IsoDate;
  /** Сколько прогноз берёт на неё сейчас, в месяц. */
  monthly: Money;
}

/** Сколько трат в категории считаем «редкой» (как проверка здравого смысла). */
export const SPARSE_MAX_OPS = 2;

/**
 * Категории, где за последние 12 месяцев было 1–2 траты, а прогноз раскладывает их на каждый месяц (D110, аудит №4, С2):
 * «не проверено» (по среднему) и «редкие» (сумма за год ÷ 12). Уже отвеченные (`repeatAnswered`) не возвращаются.
 * Сначала самые дорогие по вкладу в месяц.
 */
export function sparseExpenses(state: AppState, today: IsoDate, o: Overview = buildOverview(state, today)): SparseExpense[] {
  if (!state.imported || !o.classification) return [];
  const answered = new Set(state.settings.repeatAnswered ?? []);
  const reg = classRegistry(state.settings.classes);
  const ops = o.classification.ops;
  let first: IsoDate | null = null;
  for (const c of ops) if (first === null || c.op.date < first) first = c.op.date;
  if (first === null) return [];
  const months = fullMonthsBefore(today, 12).filter((m) => m >= monthKey(first!));
  if (!months.length) return [];
  const inWindow = new Set<string>(months);
  const by = new Map<string, { classes: Set<OpClass>; count: number; total: Money; last: IsoDate }>();
  for (const c of ops) {
    if (c.op.kind !== 'expense' || c.op.categoryId === null || !inWindow.has(monthKey(c.op.date))) continue;
    const v = by.get(c.op.categoryId) ?? { classes: new Set<OpClass>(), count: 0, total: ZERO, last: c.op.date };
    v.classes.add(c.cls);
    v.count++;
    v.total = add(v.total, c.op.amount);
    if (c.op.date > v.last) v.last = c.op.date;
    by.set(c.op.categoryId, v);
  }
  const out: SparseExpense[] = [];
  for (const [categoryId, v] of by) {
    if (answered.has(categoryId) || v.count > SPARSE_MAX_OPS || v.classes.size !== 1) continue;
    const cls = [...v.classes][0]!;
    const def = reg.find((c) => c.id === cls);
    if (!def || (def.behavior !== 'irregular' && cls !== UNCHECKED_CLASS_ID)) continue;
    const cat = state.imported.categories.find((c) => c.id === categoryId);
    if (!cat) continue;
    out.push({ categoryId, title: categoryName(cat, state.settings.categoryLabels), count: v.count, total: v.total, last: v.last, monthly: mulDiv(v.total, 1, months.length) });
  }
  return out.sort((a, b) => b.monthly - a.monthly || a.title.localeCompare(b.title, 'ru'));
}

/** Ответ на «повторится ли?»: категория уходит из прогноза или остаётся «редкой» (по среднему за год). */
export function applyRepeatAnswer(state: AppState, categoryId: string, answer: 'never' | 'repeat'): AppState {
  const cat = state.imported?.categories.find((c) => c.id === categoryId);
  const answeredSet = [...new Set([...(state.settings.repeatAnswered ?? []), categoryId])];
  if (!cat) return { ...state, settings: { ...state.settings, repeatAnswered: answeredSet } };
  const { cls, classes } = basketClass('oneoff', state.settings.classes, { kind: answer });
  return { ...state, settings: { ...state.settings, classes, repeatAnswered: answeredSet, classification: setCategoryClass(state.settings.classification, cat, cls, 'expense') } };
}

/** Предпросмотр: капитал через k месяцев, если оставить как есть, и если ответить «разовая». */
export function previewRepeat(state: AppState, today: IsoDate, categoryId: string, k = 12): { now: Money | null; ifNever: Money | null } {
  const now = capitalInMonths(baseForecastTrace(state, today, Math.max(k, 12)), today, k);
  const ifNever = capitalInMonths(baseForecastTrace(applyRepeatAnswer(state, categoryId, 'never'), today, Math.max(k, 12)), today, k);
  return { now, ifNever };
}


/** Что даст режим «обычные траты — по месяцам без зарплаты» (D113): для предпросмотра. null — таких месяцев не хватает. */
export function previewBaselineMode(state: AppState, today: IsoDate, k = 12): { months: number; usualNow: Money; usualNoWork: Money; capitalNow: Money | null; capitalNoWork: Money | null } | null {
  const o = buildOverview(state, today);
  const win = baselineWindow({ ...state, settings: { ...state.settings, baselineMode: 'no_work' } }, o.classification?.ops ?? [], today);
  if (!win) return null;
  const alt = { ...state, settings: { ...state.settings, baselineMode: 'no_work' as const } };
  const o2 = buildOverview(alt, today);
  return {
    months: win.length,
    usualNow: o.spend.usualMonthly,
    usualNoWork: o2.spend.usualMonthly,
    capitalNow: capitalInMonths(baseForecastTrace({ ...state, settings: { ...state.settings, baselineMode: 'last' } }, today, Math.max(k, 12)), today, k),
    capitalNoWork: capitalInMonths(baseForecastTrace(alt, today, Math.max(k, 12)), today, k),
  };
}

// ───────────────────────── предпросмотр: «что будет, если…» до нажатия кнопки (D114) ─────────────────────────

export interface GoalShift {
  goalId: string;
  title: string;
  from: MonthKey | null;
  to: MonthKey | null;
  /** Сдвиг в месяцах (+ позже, − раньше); null — одна из дат не определена. */
  months: number | null;
}

/** Цели, у которых дата изменилась между двумя прогонами. */
export function goalShifts(state: AppState, today: IsoDate, a: SimResult, b: SimResult): GoalShift[] {
  const o = buildOverview(state, today);
  const out: GoalShift[] = [];
  for (const g of listOrder(o.goals)) {
    if (g.status !== 'active' || g.folder || !(g.id in a.goalDates)) continue;
    const from = a.goalDates[g.id] ?? null;
    const to = b.goalDates[g.id] ?? null;
    if (from === to) continue;
    const months = from && to ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) : null;
    out.push({ goalId: g.id, title: g.role === 'safety' && g.parentId === undefined ? 'Подушка' : g.title, from, to, months });
  }
  return out;
}

export interface EventPreview {
  base: SimResult;
  with: SimResult;
  /** Капитал через k месяцев: без события и с ним. */
  capital: (k: number) => { without: Money | null; with: Money | null };
  shifts: GoalShift[];
}

/** Прогноз «как сейчас» и с событием (например, «Урежу траты») — для предпросмотра, состояние не меняется. */
export function previewEvent(state: AppState, today: IsoDate, events: readonly import('./simulate').LifeEvent[], months = 36): EventPreview {
  const { input } = buildSimInput(state, today);
  const base = simulate({ ...input, horizonMonths: months }, undefined, { trace: true });
  const w = simulate({ ...input, events: [...input.events, ...events], horizonMonths: months }, undefined, { trace: true });
  return { base, with: w, capital: (k) => ({ without: capitalInMonths(base, today, k), with: capitalInMonths(w, today, k) }), shifts: goalShifts(state, today, base, w) };
}

/** Событие «урежу траты на amount в месяц с даты from» — то же, что собирает форма «Планирую… → Урежу траты». */
export function cutEvent(id: string, from: IsoDate, amount: Money, title = 'Меньше трат'): import('./simulate').LifeEvent {
  return { id, kind: 'recurring_change', date: from, title, amount: -amount as Money };
}

/** Что будет с доходом, если ответить «повышают» и «не повышают» (D108): капитал через k месяцев при каждом ответе. */
export function previewIndexed(state: AppState, today: IsoDate, incomeId: string, k = 36): { yes: Money | null; no: Money | null } {
  const set = (v: boolean): AppState => ({ ...state, settings: { ...state.settings, incomeSchedule: state.settings.incomeSchedule.map((x) => (x.id === incomeId ? { ...x, indexed: v } : x)) } });
  const run = (s: AppState) => capitalInMonths(baseForecastTrace(s, today, Math.max(k, 12)), today, k);
  return { yes: run(set(true)), no: run(set(false)) };
}

/** Долг останется и через год? Тогда «через год» в прогнозе меньше, чем будет на счетах (D114, С6): сколько ещё должен. */
export function debtAfterYear(state: AppState, today: IsoDate): Money {
  const sim = baseForecast(state, today, 13);
  return sim.months[12]?.liabilities ?? ZERO;
}
