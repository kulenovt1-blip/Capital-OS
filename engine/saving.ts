/**
 * «Где можно сэкономить» (D116): категории трат по размеру и динамике, и у каждой — цена в целях человека: что даст, если тратить
 * меньше на 20 %. Без морали: приложение показывает варианты и их цену, а выбирает человек. Считается по данным бэкапа
 * и тем же прогнозом, что и всё остальное (`previewEvent`), состояние не меняется.
 */
import { classRegistry } from './classes';
import { fullMonthsBefore, monthKey, addMonths, type IsoDate } from './date';
import { add, mulDiv, sum, ZERO, type Money } from './money';
import { buildOverview } from './overview';
import { cutEvent, previewEvent, type GoalShift } from './simple';
import type { AppState } from './state';
import { categoryName } from './import/mmbackup';

/** На сколько процентов урезаем в предпросмотре «цена в целях». */
export const SAVING_CUT_PCT = 20;
/** Сколько категорий показываем и считаем. */
export const SAVING_MAX = 6;
/** Категории меньше этой доли обычных месячных трат не показываем: на них не сэкономить заметно. */
const MIN_SHARE_PCT = 2;

export interface SavingOption {
  categoryId: string;
  title: string;
  /** В среднем в месяц за последние полные месяцы (до 6). */
  monthly: Money;
  /** Доля от всех трат в среднем (0…1). */
  share: number;
  /** Изменение за полгода: последние 3 месяца против предыдущих 3, в процентах (null — истории мало или раньше не тратил). */
  trendPct: number | null;
  /** Цена урезания на SAVING_CUT_PCT %: сколько в месяц, что даст через год и какие цели сдвинутся. */
  cut: { perMonth: Money; capitalGain12: Money; shifts: GoalShift[] } | null;
}

export interface SavingReport {
  /** Всего в среднем в месяц по этим категориям. */
  total: Money;
  months: number;
  options: SavingOption[];
}

export function savingOptions(state: AppState, today: IsoDate): SavingReport | null {
  if (!state.imported) return null;
  const o = buildOverview(state, today);
  const ops = o.classification?.ops ?? [];
  if (!ops.length) return null;
  let first: IsoDate | null = null;
  for (const c of ops) if (first === null || c.op.date < first) first = c.op.date;
  const months = fullMonthsBefore(today, 6).filter((m) => m >= monthKey(first!));
  if (!months.length) return null;
  const reg = classRegistry(state.settings.classes);
  const counts = new Set(reg.filter((c) => c.group === 'expense' && c.behavior !== 'installment' && c.behavior !== 'excluded').map((c) => c.id));
  const byMonth = new Map<string, Map<string, Money>>();
  const inWin = new Set<string>(months);
  for (const c of ops) {
    if (c.op.kind !== 'expense' || c.op.categoryId === null || !counts.has(c.cls)) continue;
    const mk = monthKey(c.op.date);
    if (!inWin.has(mk)) continue;
    const m = byMonth.get(c.op.categoryId) ?? new Map<string, Money>();
    m.set(mk, add(m.get(mk) ?? ZERO, c.op.amount));
    byMonth.set(c.op.categoryId, m);
  }
  const rows: { id: string; total: Money; perMonthly: Money[] }[] = [];
  for (const [id, m] of byMonth) rows.push({ id, total: sum([...m.values()]), perMonthly: months.map((mk) => m.get(mk) ?? ZERO) });
  const all = sum(rows.map((r) => r.total));
  if (all <= 0) return { total: ZERO, months: months.length, options: [] };
  const n = months.length;
  const from = `${addMonths(`${today.slice(0, 7)}-01`, 1).slice(0, 7)}-01` as IsoDate;
  const options: SavingOption[] = [];
  for (const r of rows.sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : 1))) {
    if (options.length >= SAVING_MAX) break;
    if (r.total * 100 < all * MIN_SHARE_PCT) continue;
    const cat = state.imported.categories.find((c) => c.id === r.id);
    if (!cat) continue;
    const monthly = mulDiv(r.total, 1, n);
    let trendPct: number | null = null;
    if (n >= 6) {
      const prev = sum(r.perMonthly.slice(0, 3));
      const last = sum(r.perMonthly.slice(3));
      if (prev > 0) trendPct = Math.round(((last - prev) / prev) * 100);
    }
    const perMonth = mulDiv(monthly, SAVING_CUT_PCT, 100);
    let cut: SavingOption['cut'] = null;
    if (perMonth > 0) {
      const pv = previewEvent(state, today, [cutEvent('save-preview', from, perMonth)]);
      const c = pv.capital(12);
      cut = { perMonth, capitalGain12: ((c.with ?? 0) - (c.without ?? 0)) as Money, shifts: pv.shifts };
    }
    options.push({ categoryId: r.id, title: categoryName(cat, state.settings.categoryLabels), monthly, share: r.total / all, trendPct, cut });
  }
  return { total: mulDiv(all, 1, n), months: n, options };
}
