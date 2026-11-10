/**
 * «Сколько будет на дату» и «Расчёт по шагам» (D142).
 *
 * Срок прогноза — «сегодня + N месяцев» календарным месяцем (10.11 + 1 мес. = 10.12), а не конец месяца k:
 * помесячный ряд `simulate().months` остаётся как есть (цели, пробы, ряды 3/6/12 мес. его используют), а баланс на дату
 * берётся из трассы по дням. Математика прогноза не менялась: трасса только записывает то, что `simulate` и так делает.
 *
 * Свойство, которое держит тест: «на руках сейчас» + сумма строк цепочки = итог, до тиына, на любую дату.
 */
import { add, sub, ZERO, type Money } from './money';
import { addMonths, type IsoDate } from './date';
import type { SimResult, SimTrace, SimTraceItem } from './simulate';

/** Дата прогноза: сегодня + N месяцев; день прижимается к концу месяца. */
export function forecastDate(today: IsoDate, months: number): IsoDate {
  return addMonths(today, months);
}

export interface BalanceOn {
  /** Дата, на которую взят баланс: запрошенная или последний день прогноза, если запрошенная дальше. */
  date: IsoDate;
  assets: Money;
  liabilities: Money;
}

/** Деньги на руках и обязательства на конец дня `date` (дата до начала — состояние на старте). */
export function balanceOn(trace: SimTrace, date: IsoDate): BalanceOn {
  const days = trace.days;
  if (days.length === 0 || date < days[0]!.date) return { date, assets: trace.startAssets, liabilities: trace.startLiabilities };
  // двоичный поиск последнего дня ≤ date
  let lo = 0;
  let hi = days.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (days[mid]!.date <= date) lo = mid;
    else hi = mid - 1;
  }
  const d = days[lo]!;
  return { date: d.date, assets: d.assets, liabilities: d.liabilities };
}

/** Капитал (деньги на руках минус обязательства) на дату; null — если прогон без трассы. */
export function capitalOn(r: SimResult, date: IsoDate): Money | null {
  if (!r.trace) return null;
  const b = balanceOn(r.trace, date);
  return sub(b.assets, b.liabilities);
}

/**
 * Капитал «через k месяцев» для предпросмотров (D147): с трассой — на дату «сегодня + k месяцев» (как «Прогноз» и «Что если»),
 * без трассы — на конец k-го месяца, как раньше.
 */
export function capitalInMonths(r: SimResult, today: IsoDate, k: number): Money | null {
  return r.trace ? capitalOn(r, forecastDate(today, k)) : (r.months[k]?.capital ?? null);
}

export interface StepLine {
  /** Есть у строк-событий (доход, платёж, разовое событие); у траты и процентов — одна строка за весь срок. */
  date?: IsoDate;
  kind: SimTraceItem['kind'];
  title: string;
  /** Со знаком: поступление +, расход −. */
  amount: Money;
  /** У строк «траты» и «проценты»: за сколько дней срока. */
  days?: number;
  /** У свёрнутой строки: сколько раз повторилось и дата последнего раза (`date` — первого). */
  count?: number;
  to?: IsoDate;
}

export interface StepsResult {
  /** Дата итога (может оказаться раньше запрошенной, если прогноз короче). */
  until: IsoDate;
  /** На руках сейчас — старт цепочки. */
  from: Money;
  lines: StepLine[];
  /** На руках на дату `until`. */
  total: Money;
  /** Обязательства на дату `until` (в итог «на руках» не вычитаются). */
  liabilities: Money;
}

export interface StepsOptions {
  /** Как сворачивать траты в строки: по ключу статьи → группа. Без неё все траты — одна строка. */
  group?: (key: string) => { id: string; title: string };
  /** Свернуть повторы доходов, платежей и событий с одним названием в одну строку «× N» (длинные сроки). Сумма та же. */
  collapse?: boolean;
}

/**
 * Цепочка слагаемых от «сейчас» до даты `until`: доходы, платежи по долгам и разовые события — отдельными строками
 * по датам; траты (по группам) и проценты — по одной строке за срок.
 */
export function stepsTo(trace: SimTrace, until: IsoDate, opts: StepsOptions = {}): StepsResult {
  const end = balanceOn(trace, until);
  const last = end.date < until ? end.date : until;
  const lines: StepLine[] = [];
  const groups = new Map<string, StepLine>();
  let interest: Money = ZERO;
  const windowDays = trace.days.filter((d) => d.date <= last).length - (trace.days.length > 0 && trace.days[0]!.date <= last ? 1 : 0);
  for (const it of trace.items) {
    if (it.date > last) break; // записаны по порядку дат
    if (it.kind === 'income' || it.kind === 'obligation' || it.kind === 'event') {
      lines.push({ date: it.date, kind: it.kind, title: it.title, amount: it.delta });
    } else if (it.kind === 'interest') {
      interest = add(interest, it.delta);
    } else {
      const g = opts.group?.(it.key ?? '') ?? { id: 'all', title: 'Траты' };
      const cur = groups.get(g.id);
      if (cur) cur.amount = add(cur.amount, it.delta);
      else groups.set(g.id, { kind: 'expense', title: g.title, amount: it.delta, days: windowDays });
    }
  }
  if (opts.collapse) {
    const merged = new Map<string, StepLine>();
    for (const l of lines) {
      const key = `${l.kind}|${l.title}`;
      const cur = merged.get(key);
      if (!cur) merged.set(key, { ...l, count: 1 });
      else {
        cur.amount = add(cur.amount, l.amount);
        cur.count = (cur.count ?? 1) + 1;
        cur.to = l.date;
      }
    }
    lines.length = 0;
    lines.push(...merged.values());
  }
  for (const g of groups.values()) if (g.amount !== 0) lines.push(g);
  if (interest !== 0) lines.push({ kind: 'interest', title: 'Проценты по вкладам', amount: interest, days: windowDays });
  return { until: last, from: trace.startAssets, lines, total: end.assets, liabilities: end.liabilities };
}

/** Обратная проверка для тестов и отладки: сколько не хватает строкам до итога (должно быть 0). */
export function stepsGap(s: StepsResult): Money {
  let acc: Money = s.from;
  for (const l of s.lines) acc = add(acc, l.amount);
  return sub(s.total, acc);
}
