/**
 * Закончившийся доход (D214): строка расписания, срок которой прошёл, а человек не сказал, что дальше.
 * Доход для «Долговой нагрузки» берётся из расписания (D209), поэтому закончившаяся строка без ответа может тихо обнулить доход,
 * хотя деньги на самом деле приходят — просто срок в строке не продлили. Приложение спрашивает: «Продолжается? Закончился? Пришёл другой?».
 */
import type { IsoDate } from './date';
import { addDays } from './date';
import type { Money } from './money';
import type { AppState } from './state';

/** Спрашиваем про строки, закончившиеся не раньше этого числа дней назад (старые — давно история). */
export const ENDED_INCOME_ASK_DAYS = 365;

export interface EndedIncome { id: string; title: string; amount: Money; end: IsoDate }

/** Строки с прошедшим `end`, на которые человек не ответил; свежие — первыми. */
export function endedIncomeToAsk(state: AppState, today: IsoDate): EndedIncome[] {
  const answered = new Set(state.settings.incomeEndedAnswered ?? []);
  const since = addDays(today, -ENDED_INCOME_ASK_DAYS);
  return state.settings.incomeSchedule
    .filter((x) => x.end !== undefined && x.end < today && x.end >= since && !answered.has(x.id))
    .map((x) => ({ id: x.id, title: x.title, amount: x.amount, end: x.end! }))
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : a.id < b.id ? -1 : 1));
}
