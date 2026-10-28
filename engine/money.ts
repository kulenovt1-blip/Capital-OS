/**
 * Деньги: только целые тиыны (1 ₸ = 100 тиын). Никаких float в суммах.
 * Все округления — в этом файле, с явным правилом.
 */

declare const moneyBrand: unique symbol;
/** Сумма в тиынах. Всегда безопасное целое. */
export type Money = number & { readonly [moneyBrand]: 'tiyn' };

export const ZERO = 0 as Money;
export const TIYN_PER_TENGE = 100;

export function isMoney(v: unknown): v is Money {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** Создать сумму из целого числа тиынов. Бросает на дробях и NaN. */
export function tiyn(n: number): Money {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Сумма должна быть целым числом тиынов, получено: ${n}`);
  return n as Money;
}

/** Создать сумму из целого числа тенге. */
export function tenge(n: number): Money {
  if (!Number.isSafeInteger(n)) throw new RangeError(`tenge() принимает только целые тенге, получено: ${n}`);
  return tiyn(n * TIYN_PER_TENGE);
}

export function add(a: Money, b: Money): Money {
  return tiyn(a + b);
}
export function sub(a: Money, b: Money): Money {
  return tiyn(a - b);
}
export function neg(a: Money): Money {
  return tiyn(a === 0 ? 0 : -a);
}
export function sum(xs: readonly Money[]): Money {
  let s = 0;
  for (const x of xs) s += x;
  return tiyn(s);
}
export function min(a: Money, b: Money): Money {
  return a < b ? a : b;
}
export function max(a: Money, b: Money): Money {
  return a > b ? a : b;
}
export function abs(a: Money): Money {
  return a < 0 ? neg(a) : a;
}
/** max(0, a) */
export function pos(a: Money): Money {
  return a > 0 ? a : ZERO;
}

/**
 * Деление целых с банковским округлением (half-even).
 * Единственное место, где принимается решение об округлении.
 */
export function roundHalfEven(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('Деление на ноль');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const negative = num < 0n;
  const n = negative ? -num : num;
  let q = n / den;
  const r = n % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && q % 2n === 1n)) q += 1n;
  return negative ? -q : q;
}

/** a * num / den с банковским округлением до тиына. Считается в BigInt, точность не теряется. */
export function mulDiv(a: Money, num: number, den: number): Money {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) throw new RangeError('mulDiv: множители должны быть целыми');
  if (den === 0) throw new RangeError('mulDiv: деление на ноль');
  const r = roundHalfEven(BigInt(a) * BigInt(num), BigInt(den));
  return tiyn(Number(r));
}

/**
 * Простые проценты: сумма * ставка(б.п.) * дни / (10000 * дней в году).
 * Ставка в базисных пунктах: 1450 = 14,50% годовых.
 */
export function applyBp(a: Money, rateBp: number, days: number, yearDays = 365): Money {
  if (!Number.isSafeInteger(rateBp) || !Number.isSafeInteger(days)) throw new RangeError('applyBp: ставка и дни — целые');
  return mulDiv(a, rateBp * days, 10000 * yearDays);
}

/** Округление вверх до шага (например, до 100 ₸ = 10 000 тиын). */
export function ceilTo(a: Money, step: Money): Money {
  if (step <= 0) throw new RangeError('ceilTo: шаг должен быть положительным');
  const r = Math.ceil(a / step) * step;
  return tiyn(r === 0 ? 0 : r); // убираем -0
}

/** Медиана сумм; для чётного количества — среднее двух средних с банковским округлением. */
export function median(xs: readonly Money[]): Money {
  if (xs.length === 0) return ZERO;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid]!;
  return tiyn(Number(roundHalfEven(BigInt(s[mid - 1]!) + BigInt(s[mid]!), 2n)));
}

const NBSP = ' ';
const MINUS = '−';

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += NBSP;
    out += digits[i];
  }
  return out;
}

export interface FormatOptions {
  /** Показывать «+» у положительных. */
  sign?: boolean;
  /** Без знака валюты. */
  bare?: boolean;
}

/** «30 285 ₸», «30 285,50 ₸», «−1 234 ₸». Тиыны показываются, только если не нулевые. */
export function formatKZT(a: Money, opts: FormatOptions = {}): string {
  const negative = a < 0;
  const absV = Math.abs(a);
  const whole = Math.floor(absV / TIYN_PER_TENGE);
  const frac = absV % TIYN_PER_TENGE;
  let s = groupThousands(String(whole));
  if (frac !== 0) s += ',' + String(frac).padStart(2, '0');
  const signStr = negative ? MINUS : opts.sign && a > 0 ? '+' : '';
  return signStr + s + (opts.bare ? '' : NBSP + '₸');
}

/**
 * Разбор ввода пользователя в тенге: «30 285», «30285,5», «-15», «1000.25».
 * Возвращает null, если строка не похожа на сумму.
 */
export function parseKZT(input: string): Money | null {
  const s = input.replace(/[\s  ₸]/g, '').replace(MINUS, '-');
  if (s === '') return null;
  const m = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[2]);
  const frac = m[3] ? Number(m[3].padEnd(2, '0')) : 0;
  const v = whole * TIYN_PER_TENGE + frac;
  if (!Number.isSafeInteger(v)) return null;
  return tiyn(m[1] === '-' ? -v : v);
}
