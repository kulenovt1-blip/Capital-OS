/**
 * Данные, которые прогноз раньше молча выбрасывал (аудит №5, D110).
 *
 * Принцип владельца: не угадывать, а спрашивать на его же цифрах. Здесь — только факты из истории
 * и то, что из них следует для прогноза, если человек ответит «да». Сам прогноз берёт ответы из настроек (plan.ts),
 * проверка здравого смысла (sanity.ts) превращает неотвеченные вопросы в fail, экран «Прогноза» задаёт вопросы.
 *
 *  1. Проценты по копилке: банк начисляет, а прогноз считал 0.
 *  2. Крупные траты в обычных классах (семья, здоровье, прочее): медиана их выбрасывает целиком.
 *  3. Привычка к рассрочкам: когда текущие кончатся, прогноз считал, что новых не будет.
 *  4. Поступления вне расписания: подарки деньгами, кешбэк, прочее.
 *  5. Месяц повышения дохода — по истории, а не «через год от сегодня».
 */
import { mulDiv, median, sum, ZERO, type Money } from './money';
import { addMonths, endOfMonth, fullMonthsBefore, monthKey, type IsoDate, type MonthKey } from './date';
import { monthlyFlows } from './ledger';
import { classRegistry } from './classes';
import type { ClassifiedOp, OpClass } from './classify';
import type { Overview } from './overview';
import type { AppState } from './state';
import type { IncomeScheduleItem } from './settings';
import type { ExpenseBaseline, SimPayment } from './simulate';

/** Пороги — в одном месте. */
export const HIDDEN = {
  /** Крупные траты сверх обычного месяца меньше этого (тиыны в месяц) — не спрашиваем. */
  lumpsMin: 200000 as Money,
  /** Рассрочки платились столько месяцев из 12 и больше — это привычка, а не разовая покупка. */
  installmentMonths: 6,
  /** Поступления вне расписания меньше этого (тиыны в месяц) — не спрашиваем. */
  extraIncomeMin: 200000 as Money,
  /** Рост дохода на столько и больше месяц к месяцу — повышение. */
  raiseShare: 0.03,
  /** Проценты за месяц меньше этого (тиыны) — не спрашиваем: копейки на счёте для трат. */
  interestMin: 50000 as Money,
  /** Предел подсказанной ставки по копилке, б.п. годовых: больше — скорее всего, ошибка в данных. */
  maxRateBp: 3000,
} as const;

export const LUMPS_SUFFIX = '#lumps';
export const HABIT_KEY = 'installments#habit';
export const EXTRA_INCOME_ID = 'extra#income';
const EXTRA_INCOME_CLASSES: OpClass[] = ['I_gift', 'I_cashback', 'I_other'];
const INSTALLMENT_CLASSES: OpClass[] = ['E_installment_own', 'E_installment_family'];

export interface InterestFact {
  accountId: string;
  title: string;
  balance: Money;
  month: MonthKey;
  amount: Money;
  /** Сколько это годовых от нынешнего остатка, б.п. */
  suggestedRateBp: number;
}

export interface LumpsFact {
  classId: string;
  label: string;
  /** Обычный месяц (медиана, как в прогнозе). */
  median: Money;
  /** Всего за 12 мес. */
  total: Money;
  months: number;
  /** Сверх обычного месяца в среднем: total / months − median. */
  extraMonthly: Money;
  /** Самые крупные траты за год — чтобы человек узнал, о чём речь. */
  top: { date: IsoDate; amount: Money; comment: string }[];
}

export interface InstallmentFact {
  /** В среднем на рассрочки в месяц за 12 мес. */
  avgMonthly: Money;
  /** В скольких месяцах из 12 были платежи. */
  monthsWith: number;
  months: number;
  /** Последний платёж по текущим рассрочкам. */
  currentEnd: IsoDate | null;
}

export interface ExtraIncomeFact {
  /** Медиана за 12 мес. поступлений вне расписания (подарки, кешбэк, прочее). */
  medianMonthly: Money;
  total: Money;
  /** Доходы из расписания, которые, похоже, и есть часть этих поступлений (не считать дважды). */
  covered: { id: string; title: string; amount: Money }[];
  extraMonthly: Money;
}

export interface HiddenFacts {
  interest: InterestFact[];
  lumps: LumpsFact[];
  installments: InstallmentFact | null;
  extraIncome: ExtraIncomeFact | null;
}

function historyMonths(ops: readonly ClassifiedOp[], today: IsoDate, n: number): MonthKey[] {
  let first: IsoDate | null = null;
  for (const c of ops) if (first === null || c.op.date < first) first = c.op.date;
  return first === null ? [] : fullMonthsBefore(today, n).filter((m) => m >= monthKey(first!));
}

export function hiddenFacts(state: AppState, today: IsoDate, o: Overview): HiddenFacts {
  const ops = o.classification?.ops ?? [];
  const months12 = historyMonths(ops, today, 12);
  const flows = monthlyFlows(ops, months12);
  const reg = classRegistry(state.settings.classes);

  // 1. проценты: по каждому счёту — начисления за последний полный месяц
  const interest: InterestFact[] = [];
  const lastM = months12[months12.length - 1];
  if (lastM) {
    const byAcc = new Map<string, Money>();
    for (const c of ops) {
      if (c.cls !== 'I_interest' || c.op.kind !== 'income' || monthKey(c.op.date) !== lastM) continue;
      byAcc.set(c.op.accountId, (( byAcc.get(c.op.accountId) ?? ZERO) + c.op.amount) as Money);
    }
    const manualIds = new Set(state.manualAccounts.map((m) => m.id));
    for (const p of o.capital.accounts) {
      const amount = byAcc.get(p.accountId);
      if (!amount || amount < HIDDEN.interestMin || p.excluded || p.balance <= 0 || manualIds.has(p.accountId)) continue;
      const rate = Math.min(HIDDEN.maxRateBp, Math.round((amount * 12 * 10000) / p.balance));
      interest.push({ accountId: p.accountId, title: p.title, balance: p.balance, month: lastM, amount, suggestedRateBp: rate });
    }
  }

  // 2. крупные траты в обычных классах
  const lumps: LumpsFact[] = [];
  const medMonths = historyMonths(ops, today, state.settings.baselineMonths);
  const medFlows = monthlyFlows(ops, medMonths);
  if (months12.length >= 6) {
    for (const c of reg) {
      if (c.group !== 'expense' || (c.behavior !== 'base' && c.behavior !== 'regular')) continue;
      if (c.endDate && c.endDate < today) continue;
      const total = sum(months12.map((m) => flows[m]!.byClass[c.id as OpClass] ?? ZERO));
      const med = median(medMonths.map((m) => medFlows[m]!.byClass[c.id as OpClass] ?? ZERO));
      const extra = (mulDiv(total, 1, months12.length) - med) as Money;
      if (extra < HIDDEN.lumpsMin) continue;
      const from = months12[0]!;
      const top = ops
        .filter((x) => x.cls === c.id && x.op.kind === 'expense' && monthKey(x.op.date) >= from && x.op.date < today)
        .sort((a, b) => (b.op as { amount: Money }).amount - (a.op as { amount: Money }).amount)
        .slice(0, 3)
        .map((x) => ({ date: x.op.date, amount: (x.op as { amount: Money }).amount, comment: (x.op.comment ?? '').split('\n')[0]!.slice(0, 60) }));
      lumps.push({ classId: c.id, label: c.label, median: med, total, months: months12.length, extraMonthly: extra, top });
    }
    lumps.sort((a, b) => b.extraMonthly - a.extraMonthly);
  }

  // 3. привычка к рассрочкам
  let installments: InstallmentFact | null = null;
  if (months12.length >= 6) {
    const per = months12.map((m) => sum(INSTALLMENT_CLASSES.map((c) => flows[m]!.byClass[c] ?? ZERO)));
    const monthsWith = per.filter((x) => x > 0).length;
    if (monthsWith >= HIDDEN.installmentMonths) {
      const ends = o.obligations.flatMap((s) => s.effectiveUpcoming.map((e) => e.date)).sort();
      installments = { avgMonthly: mulDiv(sum(per), 1, months12.length), monthsWith, months: months12.length, currentEnd: ends[ends.length - 1] ?? null };
    }
  }

  // 4. поступления вне расписания
  let extraIncome: ExtraIncomeFact | null = null;
  if (months12.length >= 6) {
    const per = months12.map((m) => sum(EXTRA_INCOME_CLASSES.map((c) => flows[m]!.byClass[c] ?? ZERO)));
    const med = median(per);
    const covered = state.settings.incomeSchedule
      .filter((x) => x.kind !== 'work' && (!x.end || x.end > today) && x.amount <= med)
      .map((x) => ({ id: x.id, title: x.title, amount: x.amount }));
    const extra = (med - sum(covered.map((x) => x.amount))) as Money;
    if (extra >= HIDDEN.extraIncomeMin) extraIncome = { medianMonthly: med, total: sum(per), covered, extraMonthly: extra };
  }

  return { interest, lumps, installments, extraIncome };
}

/**
 * Месяц последнего повышения дохода по истории: операции дохода, похожие по сумме (±30 %) и около того же числа, по месяцам;
 * последний месяц, где сумма выросла на 3 % и больше. null — повышений не видно.
 */
export function raiseMonth(ops: readonly ClassifiedOp[], today: IsoDate, item: IncomeScheduleItem): number | null {
  const months = historyMonths(ops, today, 24);
  const lo = mulDiv(item.amount, 70, 100);
  const hi = mulDiv(item.amount, 130, 100);
  const best = new Map<MonthKey, Money>();
  for (const c of ops) {
    if (c.op.kind !== 'income' || c.op.amount < lo || c.op.amount > hi) continue;
    // тот же доход — около того же числа месяца (±5 дней), иначе стипендия 23-го путается с пособием 12-го
    const dd = Math.abs(Number(c.op.date.slice(8, 10)) - item.dayOfMonth);
    if (Math.min(dd, 31 - dd) > 5) continue;
    const m = monthKey(c.op.date);
    if (!months.includes(m)) continue;
    if ((best.get(m) ?? 0) < c.op.amount) best.set(m, c.op.amount);
  }
  let found: number | null = null;
  let prev: Money | null = null;
  for (const m of months) {
    const v = best.get(m);
    if (v === undefined) continue;
    if (prev !== null && v >= prev + mulDiv(prev, Math.round(HIDDEN.raiseShare * 1000), 1000)) found = Number(m.slice(5, 7));
    prev = v;
  }
  return found;
}

/** Точка отсчёта роста: последний прошедший месяц повышения (день — день дохода). Шаги роста — каждые 12 мес. от неё. */
export function growthAnchor(today: IsoDate, month: number, day: number): IsoDate {
  const y = Number(today.slice(0, 4));
  const d = String(Math.min(day, 28)).padStart(2, '0');
  const thisYear = `${y}-${String(month).padStart(2, '0')}-${d}` as IsoDate;
  return thisYear <= today ? thisYear : (`${y - 1}-${String(month).padStart(2, '0')}-${d}` as IsoDate);
}

/**
 * Новые рассрочки «как раньше»: в каждом месяце прогноза — сколько не хватает до среднего, с учётом уже запланированных платежей.
 * Отрезки с одинаковой суммой — одной строкой.
 */
export function habitExpenses(avg: Money, payments: readonly SimPayment[], start: IsoDate, horizonMonths: number): ExpenseBaseline[] {
  const byMonth = new Map<MonthKey, Money>();
  for (const p of payments) byMonth.set(monthKey(p.date), ((byMonth.get(monthKey(p.date)) ?? 0) + p.amount) as Money);
  const out: ExpenseBaseline[] = [];
  let cur: { amount: Money; from: IsoDate; to: IsoDate } | null = null;
  const push = () => {
    if (cur && cur.amount > 0) out.push({ key: `${HABIT_KEY}@${cur.from}`, title: 'Новые рассрочки — как раньше (в среднем за 12 мес., за вычетом текущих)', monthly: cur.amount, growthBp: 0, start: cur.from, end: cur.to });
  };
  for (let k = 0; k <= horizonMonths; k++) {
    const first = addMonths(`${start.slice(0, 7)}-01` as IsoDate, k);
    const extra = Math.max(0, avg - (byMonth.get(monthKey(first)) ?? 0)) as Money;
    const to = endOfMonth(first);
    if (cur && cur.amount === extra) cur.to = to;
    else {
      push();
      cur = { amount: extra, from: k === 0 ? start : first, to };
    }
  }
  push();
  return out;
}

/** Строка трат: обычная, редкая (за год / 12, крупные сверх обычного) или новые рассрочки — для одинаковой раскладки на всех экранах. */
export function expensePart(state: AppState, key: string): 'usual' | 'rare' | 'installments' {
  if (key.startsWith(HABIT_KEY)) return 'installments';
  if (key.endsWith(LUMPS_SUFFIX)) return 'rare';
  const c = classRegistry(state.settings.classes).find((x) => x.id === key);
  return c?.behavior === 'irregular' ? 'rare' : 'usual';
}
