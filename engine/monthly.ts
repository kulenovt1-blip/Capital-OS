/**
 * «Итоги месяца» (D184): раз в месяц — сколько пришло, сколько ушло, куда сдвинулся капитал, на что ушло сверх обычного и один вывод.
 * Чистые функции: дата — параметр. Только чтение (математику прогноза и распределения не трогает).
 * Капитал на конец месяца — тот же `computeCapital`, что на «Обзоре», на дату конца месяца.
 */
import { addMonths, endOfMonth, monthKey, startOfMonth, type IsoDate, type MonthKey } from './date';
import { buildOverview, type Overview } from './overview';
import { monthlyFlows } from './ledger';
import { classRegistry } from './classes';
import type { ClassifiedOp, OpClass } from './classify';
import { SPIKE_NEVER_CLASS } from './spikes';
import { formatKZT, type Money } from './money';
import type { AppState } from './state';
import { positionViewOf } from './position/view';

export const MONTHLY = {
  /** Карточка итогов на «Обзоре» — в первые N дней месяца. */
  cardDays: 7,
  /** Сколько прошлых месяцев берём для «обычного» по категории. */
  medianMonths: 6,
  /** Сколько месяцев истории минимум, чтобы говорить «сверх обычного». */
  minHistory: 3,
  /** «Сверх обычного» заметно: не меньше этой суммы (тиыны) и не меньше 1,5 обычных. */
  extraMin: 1_000_000 as Money,
  extraRatio: 1.5,
} as const;

export interface MonthlyExtra {
  classId: string;
  label: string;
  amount: Money;
  usual: Money;
}

export interface MonthlySummary {
  month: MonthKey;
  /** Истории за этот месяц неполные (данные начинаются в середине месяца или месяц ещё идёт). */
  partial: boolean;
  income: Money;
  spent: Money;
  /** Пришло − ушло. */
  left: Money;
  /** Доля дохода, оставшаяся после трат; null — дохода не было. */
  leftShare: number | null;
  capitalFrom: Money | null;
  capitalTo: Money;
  capitalDelta: Money | null;
  /** Отложено на цели в этом месяце (метки). */
  toGoals: Money;
  topExtra: MonthlyExtra | null;
  advice: string;
}

const tg = (m: Money): string => formatKZT((Math.round(m / 100) * 100) as Money).replace(/\s*₸$/, ' ₸');
const GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const monthTitle = (m: MonthKey): string => `${NOM[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthTitleGen = (m: MonthKey): string => GEN[Number(m.slice(5, 7)) - 1]!;

/** Последний полностью закончившийся месяц: итоги за него показываем в первые дни следующего. */
export function lastFinishedMonth(today: IsoDate): MonthKey {
  return monthKey(addMonths(startOfMonth(today), -1));
}

/** Месяцы с данными (от последнего законченного назад), не больше n. */
export function summaryMonths(state: AppState, today: IsoDate, n: number): MonthKey[] {
  const ops = state.imported?.operations ?? [];
  if (!ops.length) return [];
  let first = ops[0]!.date;
  for (const o of ops) if (o.date < first) first = o.date;
  const out: MonthKey[] = [];
  let m = lastFinishedMonth(today);
  const firstKey = monthKey(first);
  while (out.length < n && m >= firstKey) {
    out.push(m);
    m = monthKey(addMonths(`${m}-01`, -1));
  }
  return out;
}

function topExtra(ops: readonly ClassifiedOp[], state: AppState, month: MonthKey, firstKey: MonthKey): MonthlyExtra | null {
  const prior: MonthKey[] = [];
  let m = monthKey(addMonths(`${month}-01`, -1));
  while (prior.length < MONTHLY.medianMonths && m >= firstKey) {
    prior.push(m);
    m = monthKey(addMonths(`${m}-01`, -1));
  }
  if (prior.length < MONTHLY.minHistory) return null;
  const flows = monthlyFlows(ops, [month, ...prior]);
  let best: MonthlyExtra | null = null;
  for (const c of classRegistry(state.settings.classes)) {
    if (c.group !== 'expense' || c.behavior === 'excluded' || c.behavior === 'installment' || c.id === SPIKE_NEVER_CLASS) continue;
    const cls = c.id as OpClass;
    const now = flows[month]!.byClass[cls] ?? (0 as Money);
    const hist = prior.map((p) => flows[p]!.byClass[cls] ?? (0 as Money)).sort((a, b) => a - b);
    const usual = hist[Math.floor(hist.length / 2)]!;
    const extra = now - usual;
    if (extra < MONTHLY.extraMin || now < usual * MONTHLY.extraRatio) continue;
    if (!best || extra > best.amount - best.usual) best = { classId: c.id, label: c.label.replace(/^Расход:\s*/, ''), amount: now, usual };
  }
  return best;
}

function adviceOf(s: Pick<MonthlySummary, 'income' | 'spent' | 'left' | 'leftShare' | 'topExtra' | 'partial'>): string {
  const e = s.topExtra;
  // обычные 0 ₸ — категория из тех, где трат почти не бывает: «при обычных 0 ₸» читалось странно
  const extra = e ? ` Больше всего сверх обычного — «${e.label}»: ${tg(e.amount)}${e.usual < 100_000 ? ', в обычные месяцы здесь почти нет трат' : ` при обычных ${tg(e.usual)}`}.` : '';
  if (s.partial) return 'Данные за этот месяц неполные — итоги приблизительные.';
  if (s.income <= 0) return `Дохода за месяц не было, ушло ${tg(s.spent)}.${extra}`;
  if (s.left < 0) return `Месяц в минус: ушло больше, чем пришло, на ${tg((0 - s.left) as Money)}.${extra}`;
  const share = Math.round((s.leftShare ?? 0) * 100);
  if (s.topExtra) return `Месяц в плюсе: осталось ${tg(s.left)} (${share} % дохода).${extra}`;
  return `Месяц в плюсе: осталось ${tg(s.left)} (${share} % дохода). Крупных отклонений от обычного нет.`;
}

/**
 * Итоги за один месяц. `capitalOf` — кэш «капитал на конец месяца», чтобы история из 12 месяцев считала каждый конец один раз.
 */
export function monthlySummary(state: AppState, today: IsoDate, month: MonthKey, cache?: Map<string, Money>): MonthlySummary | null {
  if (!state.imported || !state.imported.operations.length) return null;
  const o: Overview = buildOverview(state, today);
  const ops = o.classification?.ops ?? [];
  let first = ops[0]?.op.date ?? today;
  for (const c of ops) if (c.op.date < first) first = c.op.date;
  const firstKey = monthKey(first);
  if (month < firstKey) return null;
  const f = monthlyFlows(ops, [month])[month]!;
  const capAt = (m: MonthKey): Money => {
    const end = endOfMonth(`${m}-01`);
    const key = `${m}|${state.importedAt ?? ''}`;
    const hit = cache?.get(key);
    if (hit !== undefined) return hit;
    const v = buildOverview(state, end > today ? today : end).capital.net;
    cache?.set(key, v);
    return v;
  };
  const prev = monthKey(addMonths(`${month}-01`, -1));
  const capitalTo = capAt(month);
  const capitalFrom = prev >= firstKey ? capAt(prev) : null;
  const partial = month === firstKey && first > startOfMonth(`${month}-01`) || endOfMonth(`${month}-01`) >= today;
  const left = (f.income - f.expense) as Money;
  const toGoals = state.fundings
    .filter((x) => monthKey(x.date) === month && x.amount > 0)
    .reduce((a, x) => (a + x.amount) as Money, 0 as Money);
  const te = partial ? null : topExtra(ops, state, month, firstKey);
  const base = {
    month,
    partial,
    income: f.income,
    spent: f.expense,
    left,
    leftShare: f.income > 0 ? left / f.income : null,
    capitalFrom,
    capitalTo,
    capitalDelta: capitalFrom === null ? null : ((capitalTo - capitalFrom) as Money),
    toGoals,
    topExtra: te,
  };
  return { ...base, advice: adviceOf(base) };
}

/** История итогов: последние n законченных месяцев, новые сверху. */
export function monthlySummaries(state: AppState, today: IsoDate, n = 12): MonthlySummary[] {
  const cache = new Map<string, Money>();
  return summaryMonths(state, today, n)
    .map((m) => monthlySummary(state, today, m, cache))
    .filter((x): x is MonthlySummary => x !== null);
}

/** Название ступени сейчас — для карточки итогов (считается один раз, только для последнего месяца). */
export function currentStepName(state: AppState, today: IsoDate): { level: number; name: string } | null {
  const v = positionViewOf(state, today);
  return v.status === 'ok' && v.level !== null && v.levelName ? { level: v.level, name: v.levelName } : null;
}

/** Показывать ли карточку итогов на «Обзоре»: первые дни месяца, итоги за прошлый ещё не закрыты и месяц не пустой. */
export function monthlyCardMonth(state: AppState, today: IsoDate): MonthKey | null {
  if (!state.imported) return null;
  if (Number(today.slice(8, 10)) > MONTHLY.cardDays) return null;
  const m = lastFinishedMonth(today);
  if ((state.settings.summarySeen ?? []).includes(m)) return null;
  return summaryMonths(state, today, 1)[0] === m ? m : null;
}

