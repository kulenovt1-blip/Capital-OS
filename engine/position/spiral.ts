/**
 * T09 «Положение» v4: признаки долговой спирали (спец. 9.3) — диагностика, а не ограничитель.
 *
 * Три признака, «спираль» — выполнены ≥ 2:
 *  1. просрочки: ≥ 2 платежей по графику обязательств, которых нет в операциях;
 *  2. рост долга людям: вырос (шаг больше 1 тенге) в ≥ 3 из последних 6 месяцев и сегодня выше, чем 6 месяцев назад;
 *  3. займы ради платежей: ≥ 3 из последних 6 месяцев, где взят заём, был платёж по своей рассрочке или возврат людям, а остаток месяца отрицателен.
 *
 * На `G`, уровень и ограничители не влияет (ограничителей по-прежнему три; решение владельца v4 №5): модуль не импортирует
 * level / limits / directions и ничего не возвращает туда, где считается `G`. Пользователю результат показывается отдельной пометкой (T11).
 * Просрочка сама по себе спиралью не называется, но число просрочек отдаётся отдельно для пометки «есть просрочки».
 *
 * Перенесено из пробы (`spiralSigns`, project docs: position-probe-v4-a) без изменения порогов. Отличия на границах данных,
 * там, где в пробе данные были всегда (12 месяцев, все даты):
 *  - признак, который по данным проверить нельзя, — `null`, а не «нет»; в счёт «≥ 2 из 3» он не идёт, спираль по нему не объявляется
 *    (признак 2: нет долга людям на дату 6 месяцев назад; признак 3: в окне меньше 6 месяцев и до трёх подходящих месяцев ещё можно добрать);
 *  - признак 3 на коротком окне: три подходящих месяца достаточно и без остальных (они могли бы только усилить признак);
 *  - допуск роста долга — 1 тенге (в пробе деньги были в тенге), здесь 100 тиын.
 */
import type { AppState } from '../state';
import type { IsoDate } from '../date';
import { buildPositionSeries, SERIES_LOOKBACK, type PositionSeries } from './series';

/** Сколько просроченных платежей по графику — уже признак. */
export const SPIRAL_MIN_OVERDUE = 2;
/** Окно признаков 2 и 3, в месяцах (совпадает с глубиной ряда долга людям). */
export const SPIRAL_WINDOW_MONTHS = SERIES_LOOKBACK;
/** Сколько месяцев из окна должен расти долг людям (признак 2). */
export const SPIRAL_GROWTH_MONTHS = 3;
/** Сколько месяцев из окна должны быть «займом ради платежа» (признак 3). */
export const SPIRAL_BORROW_MONTHS = 3;
/** Сколько признаков из трёх делают «спираль». */
export const SPIRAL_SIGNS_NEEDED = 2;
/** Рост долга людям меньше этого шага (1 тенге, в тиынах) месяцем роста не считается. */
export const SPIRAL_GROWTH_STEP = 100;

export interface SpiralSigns {
  /** no_data — в бэкапе нет операций: признаков нет и проверить их нельзя. */
  status: 'ok' | 'no_data';
  /** Признак 1. */
  overdue: boolean | null;
  /** Признак 2; null — нет данных на дату 6 месяцев назад. */
  growth: boolean | null;
  /** Признак 3; null — истории слишком мало, чтобы решить. */
  borrowToPay: boolean | null;
  /** Сколько признаков выполнено (неизвестные не считаются). */
  count: number;
  /** Выполнено ≥ 2 признаков. */
  spiral: boolean;
  /** Просроченных платежей по графику (для отдельной пометки «есть просрочки»). */
  overdueCount: number;
  /** В скольких месяцах из окна долг людям вырос; null — нет данных. */
  growthMonths: number | null;
  /** Сколько месяцев окна — «заём ради платежа»; null — не проверено. */
  borrowToPayMonths: number | null;
}

const noData = (): SpiralSigns => ({
  status: 'no_data', overdue: null, growth: null, borrowToPay: null, count: 0, spiral: false, overdueCount: 0, growthMonths: null, borrowToPayMonths: null,
});

export function spiralSigns(series: PositionSeries): SpiralSigns {
  if (!series.hasData) return noData();

  const overdueCount = series.overdueCount;
  const overdue = overdueCount >= SPIRAL_MIN_OVERDUE;

  // признак 2: p[0] — сегодня, p[h] — конец месяца за h месяцев до последнего полного
  const p = series.payables;
  let growth: boolean | null = null;
  let growthMonths: number | null = null;
  if (p[SPIRAL_WINDOW_MONTHS] !== null && p[SPIRAL_WINDOW_MONTHS] !== undefined) {
    let ups = 0;
    for (let h = SPIRAL_WINDOW_MONTHS; h >= 1; h--) if ((p[h - 1] as number) > (p[h] as number) + SPIRAL_GROWTH_STEP) ups++;
    growthMonths = ups;
    growth = ups >= SPIRAL_GROWTH_MONTHS && (p[0] as number) > (p[SPIRAL_WINDOW_MONTHS] as number);
  }

  // признак 3: последние 6 месяцев потоков
  const w = -SPIRAL_WINDOW_MONTHS;
  const b = series.borrowed.slice(w), pay = series.installmentsPaid.slice(w), rep = series.borrowedBack.slice(w), fr = series.free.slice(w);
  let months = 0;
  for (let i = 0; i < b.length; i++) if (b[i]! > 0 && (pay[i]! + rep[i]!) > 0 && fr[i]! < 0) months++;
  const missing = SPIRAL_WINDOW_MONTHS - b.length;
  const borrowToPay: boolean | null = months >= SPIRAL_BORROW_MONTHS ? true : missing > 0 && months + missing >= SPIRAL_BORROW_MONTHS ? null : false;
  const borrowToPayMonths: number | null = borrowToPay === null ? null : months;

  const count = +(overdue === true) + +(growth === true) + +(borrowToPay === true);
  return { status: 'ok', overdue, growth, borrowToPay, count, spiral: count >= SPIRAL_SIGNS_NEEDED, overdueCount, growthMonths, borrowToPayMonths };
}

/** Признаки спирали по состоянию бэкапа. */
export function spiralOfState(state: AppState, today: IsoDate): SpiralSigns {
  return spiralSigns(buildPositionSeries(state, today));
}
