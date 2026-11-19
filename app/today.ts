/**
 * «Сегодня» (простой режим, дизайн A+, D7): чистые функции без DOM — выбор одного следующего шага и пометка у ближайшего платежа. Ничего не считают заново: только раскладывают уже посчитанное движком в слова.
 */
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «5 декабря» из «2026-12-05». */
export const dayMonth = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;

export interface TodayStep {
  key: 'first-run' | 'arrived' | 'cushion' | 'road';
  title: string;
  button: string;
  href: string;
}

export interface TodayStepInput {
  /** Первые три вопроса («Настроим за минуту») уже закрыты. */
  firstRunDone: boolean;
  /** Пришли деньги, которые ещё не распределены: сумма уже в виде «+300 тыс ₸», название и сколько ещё таких. */
  arrived: { amount: string; title: string; more: number } | null;
  /** Деньги на подушку есть, но не закреплены за ней: сумма в виде «120 тыс ₸». */
  cushionPin: string | null;
  /** Ближайший шаг дороги одной фразой («Довести запас до 3 месяцев»). */
  road: string | null;
}

/**
 * Один следующий шаг — тот, что важнее всего прямо сейчас. Порядок: сначала то, без чего число неточное (вопросы),
 * потом деньги, которые лежат без дела (пришли, не закреплены за подушкой), и только потом путь вверх по ступеням.
 */
export function todayStep(i: TodayStepInput): TodayStep | null {
  if (!i.firstRunDone) return { key: 'first-run', title: 'Ответь на 3 коротких вопроса — число станет точнее', button: 'Ответить', href: '#/start' };
  if (i.arrived) {
    const more = i.arrived.more > 0 ? ` · ещё ${i.arrived.more}` : '';
    return { key: 'arrived', title: `Пришли деньги: ${i.arrived.title} ${i.arrived.amount}${more}`, button: 'Распределить', href: '#/income' };
  }
  if (i.cushionPin) return { key: 'cushion', title: `Закрепить ${i.cushionPin} за подушкой`, button: 'Закрепить', href: '#/goals~cushion-fill' };
  if (i.road) return { key: 'road', title: i.road, button: 'Открыть дорогу', href: '#/position' };
  return null;
}

/**
 * Пометка у ближайшего платежа. Говорим «деньги есть» только про платёж до следующего дохода: именно эти платежи вычтены
 * из главного числа (D111). Платёж после дохода — без пометки: что будет к тому времени, «Сегодня» не знает.
 */
export function paymentCover(paymentDate: string, nextIncomeDate: string, canSpend: number): 'covered' | 'short' | null {
  if (paymentDate > nextIncomeDate) return null;
  return canSpend >= 0 ? 'covered' : 'short';
}
