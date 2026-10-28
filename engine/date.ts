/**
 * Даты — строки 'YYYY-MM-DD'. Арифметика через UTC, без часовых поясов.
 * Текущая дата в движок всегда передаётся параметром.
 */

export type IsoDate = string;
export type MonthKey = string; // 'YYYY-MM'

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string') return false;
  const m = RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function parts(s: IsoDate): [number, number, number] {
  if (!isIsoDate(s)) throw new RangeError(`Некорректная дата: ${String(s)}`);
  return [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))];
}

function toMs(s: IsoDate): number {
  const [y, m, d] = parts(s);
  return Date.UTC(y, m - 1, d);
}

function fromMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmt(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(s: IsoDate, n: number): IsoDate {
  return fromMs(toMs(s) + n * DAY_MS);
}

/** Добавить месяцы; день прижимается к концу месяца (31.01 + 1 = 28.02). */
export function addMonths(s: IsoDate, n: number): IsoDate {
  const [y, m, d] = parts(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** b − a в днях. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/** Разница в календарных месяцах между месяцами дат (b − a), без учёта дня. */
export function monthsBetween(a: IsoDate, b: IsoDate): number {
  const [ya, ma] = parts(a);
  const [yb, mb] = parts(b);
  return (yb - ya) * 12 + (mb - ma);
}

export function compareDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}
export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

export function monthKey(s: IsoDate): MonthKey {
  parts(s);
  return s.slice(0, 7);
}
export function startOfMonth(s: IsoDate): IsoDate {
  const [y, m] = parts(s);
  return fmt(y, m, 1);
}
export function endOfMonth(s: IsoDate): IsoDate {
  const [y, m] = parts(s);
  return fmt(y, m, daysInMonth(y, m));
}
/** Та же дата с другим днём месяца (прижатым к концу месяца). */
export function withDay(s: IsoDate, day: number): IsoDate {
  const [y, m] = parts(s);
  return fmt(y, m, Math.min(Math.max(1, day), daysInMonth(y, m)));
}
export function monthStart(key: MonthKey): IsoDate {
  return `${key}-01`;
}

/** n полных месяцев перед месяцем даты today, по возрастанию. */
export function fullMonthsBefore(today: IsoDate, n: number): MonthKey[] {
  const first = startOfMonth(today);
  const out: MonthKey[] = [];
  for (let i = n; i >= 1; i--) out.push(monthKey(addMonths(first, -i)));
  return out;
}

/** Ближайшая дата ≥ from с данным днём месяца (день прижимается к концу месяца). */
export function nextDayOfMonth(from: IsoDate, day: number): IsoDate {
  const candidate = withDay(from, day);
  if (candidate >= from) return candidate;
  return withDay(addMonths(startOfMonth(from), 1), day);
}

export function formatDateRu(s: IsoDate): string {
  const [y, m, d] = parts(s);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export function formatMonthRu(key: MonthKey): string {
  const m = Number(key.slice(5, 7));
  return `${MONTHS_RU[m - 1]} ${key.slice(0, 4)}`;
}
