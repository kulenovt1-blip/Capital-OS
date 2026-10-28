import type { Money } from './money';
import type { IsoDate } from './date';
import { formatKZT } from './money';
import { formatDateRu } from './date';

/**
 * Шаг объяснения расчёта. Из списка шагов строятся текст в UI и экспорт для ИИ.
 * `text` — готовая фраза по-русски; поля рядом — для машинной обработки.
 */
export interface ExplainStep {
  code: string;
  text: string;
  amount?: Money;
  date?: IsoDate;
  refs?: Record<string, string>;
  level?: 'info' | 'warn' | 'error';
  /** Второстепенный шаг: в «Как посчитано» скрыт под «Все шаги» (D69). */
  detail?: boolean;
}

export type Explanation = ExplainStep[];

export interface Explained<T> {
  result: T;
  explanation: Explanation;
}

/** Результат операции, которая может быть отклонена с объяснением. */
export type Outcome<T> =
  | { ok: true; value: T; explanation: Explanation }
  | { ok: false; error: string; explanation: Explanation };

export const money = (m: Money): string => formatKZT(m);
export const day = (d: IsoDate): string => formatDateRu(d);

export function step(code: string, text: string, extra: Omit<ExplainStep, 'code' | 'text'> = {}): ExplainStep {
  return { code, text, ...extra };
}

/**
 * Формула из слагаемых без нулевых: [['ликвидно', 100, 1], ['назначено', 0, -1]] → «ликвидно 100 ₸».
 * Все нули → «0 ₸». Знак −1 вычитает.
 */
export function formula(terms: readonly (readonly [string, Money, 1 | -1])[]): string {
  const parts: string[] = [];
  for (const [label, amount, sign] of terms) {
    if (amount === 0) continue;
    const t = `${label} ${money(amount)}`;
    parts.push(parts.length === 0 ? (sign < 0 ? `− ${t}` : t) : `${sign < 0 ? '−' : '+'} ${t}`);
  }
  return parts.length ? parts.join(' ') : money(0 as Money);
}

/** Русское множественное число: 1 счёт, 2 счёта, 5 счетов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export function explanationToText(e: Explanation): string {
  return e.map((s) => (s.level === 'warn' ? '⚠ ' : s.level === 'error' ? '✖ ' : '• ') + s.text).join('\n');
}
