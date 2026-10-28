/**
 * Автозаполнение рассрочек по операциям (D67).
 *
 * Платежи по рассрочкам уже есть в MoneyManager: сумма, дата, категория, теги, комментарий.
 * Из них восстанавливается всё, кроме остатка — его даёт пользователь одним из трёх способов:
 * срок в месяцах, остаток напрямую или дата последнего платежа.
 *
 * Группировка: по тегам операции; без тегов — по категории и близкой сумме (±3 %).
 * Отсев: операции, уже найденные заведёнными обязательствами, и отклонённые находки.
 * Для заведённых рассрочек — проверка расхождений с жизнью (другой платёж, платежей нет).
 */
import { tiyn, type Money } from './money';
import { addMonths, daysBetween, monthKey, monthsBetween, startOfMonth, withDay, type IsoDate } from './date';
import { money, day } from './explain';
import { classifyAll, type ClassificationReport, type ClassifiedOp } from './classify';
import { classRegistry } from './classes';
import { isCandidate, makeInstallment, obligationStatus, type Obligation, type PaymentMatch } from './obligations';
import type { AppState } from './state';
import type { TxOperation } from './types';

export interface InstallmentSuggestion {
  /** Стабильный ключ находки: 'tag:<теги>' или 'cat:<категория>:<платёж в тиынах>'. По нему находка отклоняется. */
  key: string;
  title: string;
  owner: 'self' | 'family';
  /** Как будущие платежи будут находиться в операциях. */
  match: PaymentMatch;
  payments: { opId: string; date: IsoDate; amount: Money }[];
  count: number;
  /** Типичный платёж: самая частая сумма (если она у половины платежей и больше), иначе медиана. */
  payment: Money;
  /** Самый частый день месяца; при равенстве — меньший. */
  dayOfMonth: number;
  firstDate: IsoDate;
  lastDate: IsoDate;
  /** Последний платёж + месяц, на день платежа. */
  nextDate: IsoDate;
  /** Все интервалы между платежами 25–35 дней. */
  regular: boolean;
  /** Все суммы в пределах 1 % друг от друга — тогда остаток можно считать по сроку. */
  uniform: boolean;
  /** Первый платёж близко к началу данных: до него могли быть платежи, которых в бэкапе нет. */
  mayPredateData: boolean;
  warnings: string[];
}

export interface InstallmentCheck {
  obligationId: string;
  kind: 'amount' | 'stalled';
  /** Для 'amount' — фактический платёж. */
  amount?: Money;
  text: string;
}

export interface InstallmentScan {
  suggestions: InstallmentSuggestion[];
  checks: InstallmentCheck[];
}

export type RemainingResult = { ok: true; remaining: Money; paymentsLeft: number; lastDate: IsoDate } | { ok: false; error: string };

const ACTIVE_DAYS = 40;
const LOOKBACK_MONTHS = 12;
const PREDATE_DAYS = 35;

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Найти незаведённые рассрочки и проверить заведённые. */
export function detectInstallments(state: AppState, today: IsoDate, classification?: ClassificationReport | null): InstallmentScan {
  const data = state.imported;
  if (!data) return { suggestions: [], checks: [] };
  const report = classification ?? classifyAll(data, state.settings.classification);
  const behavior = new Map(classRegistry(state.settings.classes).map((c) => [c.id as string, c.behavior]));
  const tagNames = new Map(data.tags.map((t) => [t.id, t.name]));
  const catLabel = new Map(data.categories.map((c) => [c.id, state.settings.categoryLabels[c.id] || c.label || c.title || c.id]));
  const since = addMonths(today, -LOOKBACK_MONTHS);
  const dataStart = data.meta.firstDate ?? data.operations[0]?.date ?? today;
  const manual = state.manualMatches ?? {};

  const taken = (op: TxOperation) => manual[op.id] !== undefined || state.obligations.some((o) => isCandidate(op, o.match, tagNames));
  const ops: ClassifiedOp[] = report.ops.filter(
    (c) => c.op.kind === 'expense' && behavior.get(c.cls) === 'installment' && c.op.date > since && c.op.date <= today && !taken(c.op as TxOperation),
  );

  // группы по тегам
  const groups = new Map<string, { title: string; match: PaymentMatch; ops: ClassifiedOp[]; warnings: string[] }>();
  const untagged = new Map<string, ClassifiedOp[]>();
  for (const c of ops) {
    const op = c.op as TxOperation;
    const names = op.tagIds.map((id) => tagNames.get(id) ?? '').filter((x) => x.trim() !== '');
    if (names.length) {
      const sorted = [...new Set(names.map((n) => n.trim()))].sort((a, b) => (norm(a) < norm(b) ? -1 : norm(a) > norm(b) ? 1 : 0));
      const key = 'tag:' + sorted.map(norm).join('+');
      const g = groups.get(key) ?? { title: `Рассрочка «${sorted.join(', ')}»`, match: { tags: sorted }, ops: [], warnings: [] };
      g.ops.push(c);
      groups.set(key, g);
    } else if (op.categoryId !== null) {
      const list = untagged.get(op.categoryId) ?? [];
      list.push(c);
      untagged.set(op.categoryId, list);
    }
  }
  // категория одна на всю группу — добавляется к поиску, чтобы тег «мама» не цеплял обычные траты
  for (const g of groups.values()) {
    const cats = new Set(g.ops.map((c) => (c.op as TxOperation).categoryId));
    const [only] = [...cats];
    if (cats.size === 1 && only !== null && only !== undefined) g.match = { ...g.match, categoryIds: [only] };
  }
  // без тегов: кластеры по сумме внутри категории
  for (const [catId, list] of [...untagged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const sorted = [...list].sort((a, b) => (a.op as TxOperation).amount - (b.op as TxOperation).amount || (a.op.id < b.op.id ? -1 : 1));
    const clusters: ClassifiedOp[][] = [];
    for (const c of sorted) {
      const last = clusters[clusters.length - 1];
      const start = last ? (last[0]!.op as TxOperation).amount : 0;
      if (last && (c.op as TxOperation).amount * 100 <= start * 103) last.push(c);
      else clusters.push([c]);
    }
    for (const cl of clusters) {
      const amounts = cl.map((c) => (c.op as TxOperation).amount);
      const rep = typicalPayment(amounts);
      const comments = new Set(cl.map((c) => c.op.comment.trim()));
      const [comment] = [...comments];
      const match: PaymentMatch = { categoryIds: [catId], ...(comments.size === 1 && comment ? { commentContains: comment } : {}) };
      const warnings = [
        `Платежи без тега: будущие платежи будут искаться по категории${match.commentContains ? ' и комментарию' : ''}. Если в этой категории несколько рассрочек, поставь каждой свой тег в MoneyManager.`,
      ];
      if (clusters.length > 1 && !match.commentContains) warnings.push('В этой категории несколько рассрочек с разными суммами — без тегов их платежи могут перепутаться.');
      groups.set(`cat:${catId}:${rep}`, { title: `${catLabel.get(catId) ?? catId} ${money(rep)}`, match, ops: cl, warnings });
    }
  }

  const suggestions: InstallmentSuggestion[] = [];
  for (const [key, g] of groups) {
    if (state.settings.dismissedInstallments.includes(key)) continue;
    const s = summarize(key, g.title, g.match, g.ops, g.warnings, dataStart);
    if (daysBetween(s.lastDate, today) > ACTIVE_DAYS) continue;
    suggestions.push(s);
  }
  suggestions.sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : a.key < b.key ? -1 : 1));
  return { suggestions, checks: checkObligations(state, today) };
}

function typicalPayment(amounts: readonly Money[]): Money {
  const counts = new Map<number, number>();
  for (const a of amounts) counts.set(a, (counts.get(a) ?? 0) + 1);
  let best = -1;
  let bestN = 0;
  for (const [a, n] of counts) if (n > bestN || (n === bestN && a < best)) [best, bestN] = [a, n];
  if (bestN * 2 >= amounts.length) return tiyn(best);
  const s = [...amounts].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

function summarize(key: string, title: string, match: PaymentMatch, list: ClassifiedOp[], warnings: string[], dataStart: IsoDate): InstallmentSuggestion {
  const sorted = [...list].sort((a, b) => (a.op.date < b.op.date ? -1 : a.op.date > b.op.date ? 1 : a.op.id < b.op.id ? -1 : 1));
  const payments = sorted.map((c) => ({ opId: c.op.id, date: c.op.date, amount: (c.op as TxOperation).amount }));
  const amounts = payments.map((p) => p.amount);
  const payment = typicalPayment(amounts);
  const days = new Map<number, number>();
  for (const p of payments) {
    const d = Number(p.date.slice(8, 10));
    days.set(d, (days.get(d) ?? 0) + 1);
  }
  let dayOfMonth = 31;
  let dayN = 0;
  for (const [d, n] of days) if (n > dayN || (n === dayN && d < dayOfMonth)) [dayOfMonth, dayN] = [d, n];
  const firstDate = payments[0]!.date;
  const lastDate = payments[payments.length - 1]!.date;
  const nextDate = withDay(addMonths(startOfMonth(lastDate), 1), dayOfMonth);
  const w = [...warnings];
  const perMonth = new Map<string, number>();
  for (const p of payments) perMonth.set(monthKey(p.date), (perMonth.get(monthKey(p.date)) ?? 0) + 1);
  const multi = [...perMonth.values()].some((n) => n > 1);
  if (multi) w.push('Есть месяцы, где несколько платежей в месяц: возможно, это две рассрочки под одним тегом или доплата. Проверь и при необходимости раздели теги в MoneyManager.');
  let regular = payments.length >= 2;
  for (let i = 1; i < payments.length; i++) {
    const gap = daysBetween(payments[i - 1]!.date, payments[i]!.date);
    if (gap < 25 || gap > 35) regular = false;
  }
  if (payments.length === 1) w.push('Пока только один платёж — проверь сумму и день.');
  else if (!regular && !multi) w.push('Платежи идут не каждый месяц — проверь, что это одна рассрочка.');
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const uniform = max * 100 <= min * 101;
  if (!uniform && !multi) w.push('Суммы платежей разные (была доплата?) — остаток лучше указать напрямую или датой последнего платежа.');
  const mayPredateData = daysBetween(dataStart, firstDate) <= PREDATE_DAYS;
  const owners = sorted.filter((c) => c.cls === 'E_installment_family').length;
  return {
    key,
    title,
    owner: owners * 2 > sorted.length ? 'family' : 'self',
    match,
    payments,
    count: payments.length,
    payment,
    dayOfMonth,
    firstDate,
    lastDate,
    nextDate,
    regular,
    uniform,
    mayPredateData,
    warnings: w,
  };
}

const nth = (s: InstallmentSuggestion, k: number): IsoDate => withDay(addMonths(startOfMonth(s.nextDate), k), s.dayOfMonth);

/** Остаток по сроку рассрочки: (срок − сделано платежей) × платёж. Только при одинаковых платежах. */
export function remainingFromTerm(s: InstallmentSuggestion, termMonths: number, paidCount: number = s.count): RemainingResult {
  if (!Number.isInteger(termMonths) || termMonths <= 0) return { ok: false, error: 'Срок — целое число месяцев больше нуля' };
  if (!s.uniform) return { ok: false, error: 'Суммы платежей разные (доплата или несколько рассрочек) — по сроку остаток посчитать нельзя. Укажи остаток напрямую или дату последнего платежа' };
  const left = termMonths - paidCount;
  if (left <= 0) return { ok: false, error: `По сроку рассрочка уже выплачена: срок ${termMonths} мес., сделано платежей ${paidCount}. Проверь срок или укажи остаток напрямую` };
  return { ok: true, remaining: tiyn(s.payment * left), paymentsLeft: left, lastDate: nth(s, left - 1) };
}

/** Остаток по дате последнего платежа: платежи со следующего по указанный месяц включительно. */
export function remainingFromLastDate(s: InstallmentSuggestion, last: IsoDate): RemainingResult {
  if (monthKey(last) < monthKey(s.nextDate)) return { ok: false, error: `Последний платёж не может быть раньше следующего (${day(s.nextDate)})` };
  const left = monthsBetween(s.nextDate, last) + 1;
  return { ok: true, remaining: tiyn(s.payment * left), paymentsLeft: left, lastDate: nth(s, left - 1) };
}

/** Обязательство из находки: график от ближайшего платежа после «сегодня», поиск будущих платежей — как у находки. */
export function suggestionToObligation(s: InstallmentSuggestion, p: { id: string; remaining: Money; today: IsoDate; title?: string; owner?: 'self' | 'family' }): Obligation {
  let first = s.nextDate;
  for (let k = 1; first <= p.today && k < 24; k++) first = nth(s, k);
  return makeInstallment({
    id: p.id,
    title: p.title?.trim() || s.title,
    owner: p.owner ?? s.owner,
    remaining: p.remaining,
    remainingAsOf: p.today,
    payment: s.payment,
    firstDate: first,
    match: s.match,
  });
}

/** Расхождения заведённых рассрочек с операциями. */
function checkObligations(state: AppState, today: IsoDate): InstallmentCheck[] {
  const data = state.imported;
  if (!data) return [];
  const out: InstallmentCheck[] = [];
  for (const o of state.obligations) {
    if (o.kind !== 'installment' || !o.match) continue;
    const st = obligationStatus(o, data, today, { matchWindowDays: state.settings.matchWindowDays, manualMatches: state.manualMatches });
    const overdue = st.entries.filter((e) => e.status === 'overdue' && e.date > o.remainingAsOf);
    if (st.remainingNow > 0 && overdue.length >= 2) {
      out.push({
        obligationId: o.id,
        kind: 'stalled',
        text: `«${o.title}»: ${overdue.length} платежа по графику не найдены в операциях (последний ожидался ${day(overdue[overdue.length - 1]!.date)}). Если рассрочка закрыта досрочно — удали её или обнови остаток; если платишь без тега — проверь тег`,
      });
      continue;
    }
    const recent = [...st.payments].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-3);
    const planned = o.schedule[0]?.amount;
    if (planned === undefined || recent.length < 2) continue;
    const amounts = recent.map((p) => p.amount);
    const lo = Math.min(...amounts);
    const hi = Math.max(...amounts);
    if (hi * 100 > lo * 101) continue;
    const actual = typicalPayment(amounts);
    if (Math.abs(actual - planned) * 100 > planned) {
      out.push({
        obligationId: o.id,
        kind: 'amount',
        amount: actual,
        text: `«${o.title}»: по графику ${money(planned)}, а последние ${recent.length} платежа по ${money(actual)} — обнови платёж в обязательстве`,
      });
    }
  }
  return out;
}
