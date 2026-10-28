/**
 * Обязательства: рассрочки, долги вне MoneyManager, регулярные платежи.
 * Рассрочка задаётся остатком, платежом и датой; график генерируется.
 * Фактические платежи из импорта сопоставляются с графиком (DECISIONS D19).
 */
import { add, min, pos, sub, sum, tiyn, ZERO, type Money } from './money';
import { addDays, addMonths, daysBetween, type IsoDate } from './date';
import { day, money, step, type Explanation } from './explain';
import type { ImportedData, Operation } from './types';

export interface ScheduleEntry {
  date: IsoDate;
  amount: Money;
}

export interface PaymentMatch {
  /** Любой из тегов (по названию). */
  tags?: string[];
  categoryIds?: string[];
  commentContains?: string;
}

export interface Obligation {
  id: string;
  title: string;
  kind: 'installment' | 'debt' | 'recurring';
  owner: 'self' | 'family';
  schedule: ScheduleEntry[];
  /** Остаток на дату remainingAsOf (для recurring — 0). */
  remaining: Money;
  remainingAsOf: IsoDate;
  earlyPayoffAllowed: boolean;
  /** Ставка, б.п. годовых (0 — беспроцентная). */
  interestRateBp: number;
  match?: PaymentMatch;
  currency: 'KZT';
  /** TODO-пометка: сумма ещё не подтверждена пользователем. */
  unconfirmed?: boolean;
}

export function generateInstallmentSchedule(p: { remaining: Money; payment: Money; firstDate: IsoDate }): ScheduleEntry[] {
  if (p.payment <= 0) throw new RangeError('Платёж по рассрочке должен быть больше нуля');
  if (p.remaining < 0) throw new RangeError('Остаток не может быть отрицательным');
  const out: ScheduleEntry[] = [];
  let left = p.remaining;
  let i = 0;
  while (left > 0) {
    const amount = min(p.payment, left);
    out.push({ date: addMonths(p.firstDate, i++), amount });
    left = sub(left, amount);
    if (i > 600) throw new RangeError('График длиннее 50 лет — проверь сумму платежа');
  }
  return out;
}

export function makeInstallment(p: {
  id: string;
  title: string;
  owner: 'self' | 'family';
  remaining: Money;
  remainingAsOf: IsoDate;
  payment: Money;
  firstDate: IsoDate;
  match?: PaymentMatch;
  kind?: 'installment' | 'debt';
  interestRateBp?: number;
  earlyPayoffAllowed?: boolean;
}): Obligation {
  return {
    id: p.id,
    title: p.title,
    kind: p.kind ?? 'installment',
    owner: p.owner,
    schedule: generateInstallmentSchedule(p),
    remaining: p.remaining,
    remainingAsOf: p.remainingAsOf,
    earlyPayoffAllowed: p.earlyPayoffAllowed ?? true,
    interestRateBp: p.interestRateBp ?? 0,
    ...(p.match ? { match: p.match } : {}),
    currency: 'KZT',
  };
}

export function makeRecurring(p: { id: string; title: string; owner: 'self' | 'family'; amount: Money; firstDate: IsoDate; months: number; match?: PaymentMatch }): Obligation {
  const schedule: ScheduleEntry[] = [];
  for (let i = 0; i < p.months; i++) schedule.push({ date: addMonths(p.firstDate, i), amount: p.amount });
  return {
    id: p.id,
    title: p.title,
    kind: 'recurring',
    owner: p.owner,
    schedule,
    remaining: ZERO,
    // «на дату накануне первого платежа»: всё, что раньше, к этому обязательству не относится
    remainingAsOf: addDays(p.firstDate, -1),
    earlyPayoffAllowed: false,
    interestRateBp: 0,
    ...(p.match ? { match: p.match } : {}),
    currency: 'KZT',
  };
}

export function validateObligation(o: Obligation): string[] {
  const errs: string[] = [];
  if (!o.title.trim()) errs.push('Нужно название');
  if (o.schedule.length === 0) errs.push('Пустой график');
  if (o.schedule.some((e) => e.amount <= 0)) errs.push('Платёж в графике должен быть больше нуля');
  if (o.kind !== 'recurring' && o.remaining < 0) errs.push('Остаток не может быть отрицательным');
  return errs;
}

export interface MatchedPayment {
  opId: string;
  date: IsoDate;
  amount: Money;
  /** Строка графика или null, если платёж вне графика. */
  entryIndex: number | null;
  manual: boolean;
}

export interface EntryStatus extends ScheduleEntry {
  status: 'paid' | 'due' | 'overdue' | 'upcoming';
  paidByOpId?: string;
}

export interface ObligationStatus {
  obligation: Obligation;
  payments: MatchedPayment[];
  remainingNow: Money;
  entries: EntryStatus[];
  /** Ближайший неоплаченный платёж (с учётом досрочных погашений). */
  nextDue: ScheduleEntry | null;
  /** Неоплаченные будущие платежи, урезанные так, чтобы их сумма = remainingNow (для рассрочек). */
  effectiveUpcoming: ScheduleEntry[];
  explanation: Explanation;
}

export interface MatchOptions {
  matchWindowDays: number;
  /** opId → obligationId. */
  manualMatches?: Record<string, string>;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Подходит ли операция под правило поиска платежей обязательства (тег, категория, комментарий). */
export function isCandidate(op: Operation, m: PaymentMatch | undefined, tagNames: Map<string, string>): boolean {
  if (op.kind !== 'expense' || !m) return false;
  const has = (m.tags?.length ?? 0) > 0 || (m.categoryIds?.length ?? 0) > 0 || (m.commentContains ?? '') !== '';
  if (!has) return false;
  if (m.tags?.length) {
    const opTags = op.tagIds.map((id) => norm(tagNames.get(id) ?? ''));
    if (!m.tags.some((t) => opTags.includes(norm(t)))) return false;
  }
  if (m.categoryIds?.length && (op.categoryId === null || !m.categoryIds.includes(op.categoryId))) return false;
  if (m.commentContains && !norm(op.comment).includes(norm(m.commentContains))) return false;
  return true;
}

export function obligationStatus(o: Obligation, data: Pick<ImportedData, 'operations' | 'tags'>, today: IsoDate, opts: MatchOptions): ObligationStatus {
  const tagNames = new Map(data.tags.map((t) => [t.id, t.name]));
  const manual = opts.manualMatches ?? {};
  const explanation: Explanation = [];
  const ops = data.operations.filter((op) => {
    if (op.kind !== 'expense' || op.date <= o.remainingAsOf || op.date > today) return false;
    const forced = manual[op.id];
    if (forced !== undefined) return forced === o.id;
    return isCandidate(op, o.match, tagNames);
  });

  const paidBy: (string | undefined)[] = o.schedule.map(() => undefined);
  const payments: MatchedPayment[] = [];
  for (const op of ops) {
    if (op.kind !== 'expense') continue;
    let best = -1;
    let bestDist = Infinity;
    o.schedule.forEach((e, i) => {
      if (paidBy[i] !== undefined || e.date <= o.remainingAsOf) return;
      const d = Math.abs(daysBetween(e.date, op.date));
      if (d <= opts.matchWindowDays && d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    if (best >= 0) paidBy[best] = op.id;
    payments.push({ opId: op.id, date: op.date, amount: op.amount, entryIndex: best >= 0 ? best : null, manual: manual[op.id] === o.id });
    if (best < 0) explanation.push(step('obligation.unscheduled', `«${o.title}»: платёж ${money(op.amount)} от ${day(op.date)} вне графика — уменьшает остаток`, { amount: op.amount, date: op.date, refs: { opId: op.id } }));
  }

  const paidSum = sum(payments.map((p) => p.amount));
  let remainingNow = o.remaining;
  if (o.kind !== 'recurring') {
    remainingNow = pos(sub(o.remaining, paidSum));
    if (paidSum > o.remaining) {
      explanation.push(step('obligation.overpaid', `«${o.title}»: оплачено ${money(paidSum)} при остатке ${money(o.remaining)} — проверь остаток или привязку платежей`, { level: 'warn', amount: sub(paidSum, o.remaining) }));
    }
  }

  const entries: EntryStatus[] = o.schedule.map((e, i) => {
    const by = paidBy[i];
    if (by !== undefined) return { ...e, status: 'paid', paidByOpId: by };
    if (e.date < today) return { ...e, status: 'overdue' };
    if (e.date === today) return { ...e, status: 'due' };
    return { ...e, status: 'upcoming' };
  });
  for (const e of entries) {
    if (e.status === 'overdue' && e.date > o.remainingAsOf) {
      explanation.push(step('obligation.overdue', `«${o.title}»: платёж ${money(e.amount)} на ${day(e.date)} не найден в операциях`, { level: 'warn', amount: e.amount, date: e.date, refs: { obligationId: o.id } }));
    }
  }

  // Будущие неоплаченные платежи; для рассрочек их сумма урезается до остатка
  const unpaid = entries.filter((e) => e.status !== 'paid' && e.date > o.remainingAsOf);
  const effectiveUpcoming: ScheduleEntry[] = [];
  if (o.kind === 'recurring') {
    for (const e of unpaid) if (e.date >= today) effectiveUpcoming.push({ date: e.date, amount: e.amount });
  } else {
    let left = remainingNow;
    for (const e of unpaid) {
      if (left <= 0) break;
      const a = min(e.amount, left);
      left = sub(left, a);
      // просроченные переносятся на сегодня: деньги всё равно нужны
      effectiveUpcoming.push({ date: e.date < today ? today : e.date, amount: a });
    }
    if (left > 0) {
      const last = o.schedule[o.schedule.length - 1];
      effectiveUpcoming.push({ date: last && last.date > today ? last.date : today, amount: left });
    }
  }
  const nextDue = effectiveUpcoming[0] ?? null;
  explanation.unshift(
    step('obligation.summary', o.kind === 'recurring' ? `«${o.title}»: регулярный платёж, ближайший ${nextDue ? `${money(nextDue.amount)} на ${day(nextDue.date)}` : '—'}` : `«${o.title}»: остаток ${money(remainingNow)} (на ${day(o.remainingAsOf)} было ${money(o.remaining)}, оплачено после — ${money(paidSum)})`, {
      amount: remainingNow,
      refs: { obligationId: o.id },
    }),
  );
  return { obligation: o, payments, remainingNow, entries, nextDue, effectiveUpcoming, explanation };
}

export interface UpcomingPayment {
  obligationId: string;
  title: string;
  owner: 'self' | 'family';
  date: IsoDate;
  amount: Money;
}

/** Неоплаченные платежи всех обязательств в интервале [from, to], по дате. */
export function upcomingPayments(statuses: ObligationStatus[], from: IsoDate, to: IsoDate): UpcomingPayment[] {
  const out: UpcomingPayment[] = [];
  for (const s of statuses) {
    for (const e of s.effectiveUpcoming) {
      if (e.date >= from && e.date <= to) out.push({ obligationId: s.obligation.id, title: s.obligation.title, owner: s.obligation.owner, date: e.date, amount: e.amount });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.obligationId < b.obligationId ? -1 : 1));
}

export function totalRemaining(statuses: ObligationStatus[], filter: (o: Obligation) => boolean): Money {
  let s = ZERO;
  for (const st of statuses) if (filter(st.obligation) && st.obligation.kind !== 'recurring') s = add(s, st.remainingNow);
  return tiyn(s);
}
