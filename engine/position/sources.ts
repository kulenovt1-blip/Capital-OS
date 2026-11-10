/**
 * Источники дохода и их статусы для «Положения» (T03).
 *
 * Потоки собираются той же функцией, что и в прогнозе (`assembleIncomeStreams`), поэтому статусы не расходятся с прогнозом.
 * Статус по умолчанию выводится из данных:
 *  X — поток появился из события (начало или смена дохода);
 *  I — вид «нерегулярный»;
 *  T — конец в ближайшие 12 месяцев;
 *  P — остальное.
 * Переопределение в расписании (`status`) побеждает выведенное значение, объём не меняет и помечается (`overridden`).
 * Объём — сумма выплат строго после сегодняшнего дня и не позже чем через 12 месяцев. «Обрыв» — поток из расписания,
 * заканчивающийся в ближайшие 6 месяцев.
 *
 * Отличие от пробы: границы +12 и +6 месяцев считаются `addMonths` (прижимаются к концу месяца, как везде в движке),
 * а не через `Date.setUTCMonth`, который переносит 29–31-е число в следующий месяц.
 */
import { addMonths, startOfMonth, withDay, type IsoDate } from '../date';
import { assembleIncomeStreams, type SimInput } from '../simulate';
import { buildSimInput } from '../plan';
import { ZERO, add, type Money } from '../money';
import type { AppState } from '../state';
import type { IncomeStatus } from './settings';

export const SOURCE_HORIZON_MONTHS = 12;
export const SOURCE_CLIFF_MONTHS = 6;

export interface IncomeSource {
  id: string;
  title: string;
  /** Сумма одной выплаты. */
  monthly: Money;
  status: IncomeStatus;
  /** Сумма выплат за ближайшие 12 месяцев. */
  volume: Money;
  /** Поток из расписания, заканчивающийся в ближайшие 6 месяцев. */
  endsWithin6m: boolean;
  /** Статус задан человеком, а не выведен. */
  overridden: boolean;
}

export function incomeSources(input: Pick<SimInput, 'incomes' | 'events'>, today: IsoDate): IncomeSource[] {
  const streams = assembleIncomeStreams(input.incomes, input.events, today);
  const hEnd = addMonths(today, SOURCE_HORIZON_MONTHS);
  const h6 = addMonths(today, SOURCE_CLIFF_MONTHS);
  const out: IncomeSource[] = [];
  for (const s of streams) {
    let volume: Money = ZERO;
    for (let k = 0; k <= SOURCE_HORIZON_MONTHS; k++) {
      const date = withDay(addMonths(startOfMonth(today), k), s.dayOfMonth);
      if (date <= today || date > hEnd) continue;
      if ((s.start && date < s.start) || (s.end && date > s.end)) continue;
      volume = add(volume, s.amount);
    }
    if (volume <= 0) continue;
    const derived: IncomeStatus = s.origin === 'event' ? 'X' : s.kind === 'irregular' ? 'I' : s.end && s.end <= hEnd ? 'T' : 'P';
    const overridden = s.origin === 'schedule' && s.status !== undefined;
    out.push({
      id: s.id, title: s.title, monthly: s.amount, status: overridden ? s.status! : derived, volume,
      endsWithin6m: !!(s.end && s.end <= h6 && s.origin === 'schedule'), overridden,
    });
  }
  return out;
}

export function incomeSourcesOf(state: AppState, today: IsoDate): IncomeSource[] {
  return incomeSources(buildSimInput(state, today).input, today);
}
