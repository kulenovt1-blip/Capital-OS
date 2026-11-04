/**
 * «Твой этап» (D115, переделан в D123): один понятный измеритель — на сколько месяцев хватит денег, если доход пропадёт.
 * Месяцы запаса = деньги, которые можно снять сразу, ÷ сколько уходит в обычный месяц (траты + платежи по долгам). Больше ничего.
 * Пять этапов по этой шкале (границы одинаковы для всех, названия — про запас, а не про «ступени»):
 *   1. «Без запаса» — меньше 1 мес.            4. «Крепкий запас» — от 6 до 12 мес.
 *   2. «Минимальный запас» — от 1 до 3 мес.     5. «Запас на год и больше» — от 12 мес.
 *   3. «Подушка» — от 3 до 6 мес.
 * Отдельно, не как этап: сколько остаётся в месяц (+ копится, − тает) — у него свой показатель.
 * Опирается только на то, что есть в бэкапе: наличные и долги вне MoneyManager не видны — это сказано в тексте.
 */
import { add, formatKZT, mulDiv, sum, ZERO, type Money } from './money';
import type { IsoDate, MonthKey } from './date';
import { buildOverview } from './overview';
import { baseForecast } from './simple';
import type { SimResult } from './simulate';
import type { AppState } from './state';

export type StageNo = 1 | 2 | 3 | 4 | 5;

export interface StageDef {
  no: StageNo;
  title: string;
  /** С какого запаса (месяцев) этап начинается. */
  fromMonths: number;
  /** До какого (не включая); null — без верхней границы. */
  toMonths: number | null;
  /** Одна-две фразы по-человечески: что это значит для жизни. */
  portrait: string;
}

export const STAGE_LIST: readonly StageDef[] = [
  { no: 1, title: 'Без запаса', fromMonths: 0, toMonths: 1, portrait: 'Денег хватит меньше чем на месяц без дохода: любая неожиданность бьёт сразу.' },
  { no: 2, title: 'Минимальный запас', fromMonths: 1, toMonths: 3, portrait: 'Неожиданный расход переживёшь, а вот потеря дохода уже опасна: запаса хватит на месяц-два.' },
  { no: 3, title: 'Подушка', fromMonths: 3, toMonths: 6, portrait: 'Если доход пропадёт, продержишься несколько месяцев и успеешь найти выход.' },
  { no: 4, title: 'Крепкий запас', fromMonths: 6, toMonths: 12, portrait: 'Полгода без дохода: можно спокойно искать работу получше и не бояться крупных трат.' },
  { no: 5, title: 'Запас на год и больше', fromMonths: 12, toMonths: null, portrait: 'Год и дольше без дохода: деньги работают на тебя, а выбор — не про выживание.' },
];

export const stageDef = (no: StageNo): StageDef => STAGE_LIST[no - 1]!;

/** Сколько месяцев в этапе словами: «1–3 мес.», «от 12 мес.». */
export const stageRange = (d: StageDef): string => (d.toMonths === null ? `от ${d.fromMonths} мес.` : d.fromMonths === 0 ? `меньше ${d.toMonths} мес.` : `${d.fromMonths}–${d.toMonths} мес.`);

export interface PersonStage {
  stage: StageNo;
  title: string;
  portrait: string;
  /** На сколько месяцев хватит денег без дохода: деньги сразу ÷ сколько уходит в месяц, с одним знаком после запятой. */
  coverMonths: number;
  /** Деньги, которые можно снять сразу. */
  liquid: Money;
  /** Сколько уходит в обычный месяц вместе с платежами по долгам. */
  needMonthly: Money;
  /** Из них обычные траты и платежи по долгам и рассрочкам. */
  usualMonthly: Money;
  obligationsMonthly: Money;
  /** Доля дохода, которая уходит на платежи по долгам и рассрочкам (0…1), null — дохода нет. */
  debtShare: number | null;
  /** Сколько остаётся в месяц в среднем за ближайшие полгода (минус — траты больше дохода). */
  surplusMonthly: Money;
  next: NextStep | null;
}

export interface NextStep {
  /** На какой этап идём. */
  toStage: StageNo;
  toTitle: string;
  /** Сколько запаса (месяцев) нужно и сколько это денег. */
  needMonths: number;
  target: Money;
  /** Сколько денег не хватает. */
  missing: Money;
  /** К какому месяцу при нынешнем темпе; null — не набирается. */
  by: MonthKey | null;
  /** Готовая фраза. */
  text: string;
}

const tg = (m: Money): string => formatKZT((Math.round(m / 100) * 100) as Money);

/**
 * Первый месяц, когда деньги на конец месяца дотянут до `target`, если каждый месяц добавлять ещё `extra` (месяц i прогноза — i добавок).
 * Считается по помесячному прогнозу (D122), а не по среднему остатку: конец стипендии, окончание рассрочек и плановые события видны,
 * поэтому «к январю» не врёт, когда через полгода доход упадёт. Проценты на добавку не считаются — это запас в пользу человека.
 * null — не за срок расчёта.
 */
export function liquidReachMonth(sim: SimResult, target: Money, extra: Money = ZERO): MonthKey | null {
  for (let i = 0; i < sim.months.length; i++) {
    const m = sim.months[i]!;
    if (m.liquidEnd + extra * i >= target) return m.month;
  }
  return null;
}

export function personStage(state: AppState, today: IsoDate): PersonStage | null {
  if (!state.imported) return null;
  const o = buildOverview(state, today);
  const liquid = Math.max(0, o.capital.liquidNow) as Money;
  const usualMonthly = o.spend.usualMonthly;
  const obligationsMonthly = o.spend.obligationsMonthly;
  const needMonthly = add(usualMonthly, obligationsMonthly);
  if (needMonthly <= 0) return null;
  const coverMonths = Math.floor((liquid * 10) / needMonthly) / 10;
  const income = sum(state.settings.incomeSchedule.filter((x) => (!x.start || x.start <= today) && (!x.end || x.end > today)).map((x) => x.amount));
  const debtShare = income > 0 ? Math.min(1, obligationsMonthly / income) : null;
  const sim = baseForecast(state, today, 60);
  const flows = sim.months.slice(1, 7).map((m) => m.income - m.expenses - m.obligations - m.events);
  const surplusMonthly = (flows.length ? mulDiv(sum(flows as Money[]), 1, flows.length) : ZERO) as Money;

  let stage: StageNo = 1;
  for (const d of STAGE_LIST) if (coverMonths >= d.fromMonths) stage = d.no;

  let next: NextStep | null = null;
  if (stage < 5) {
    const d = stageDef((stage + 1) as StageNo);
    const target = mulDiv(needMonthly, d.fromMonths, 1);
    const missing = Math.max(0, target - liquid) as Money;
    next = {
      toStage: d.no,
      toTitle: d.title,
      needMonths: d.fromMonths,
      target,
      missing,
      by: liquidReachMonth(sim, target),
      text: `До этапа «${d.title}» нужен запас на ${d.fromMonths} мес.: ${d.fromMonths} × ${tg(needMonthly)} = ${tg(target)}. Не хватает ≈ ${tg(missing)}.${surplusMonthly <= 0 ? ` Сейчас траты не меньше доходов (на ≈ ${tg((-surplusMonthly) as Money)} в месяц больше) — пока так, запас не растёт.` : ''}`,
    };
  }
  return { stage, title: stageDef(stage).title, portrait: stageDef(stage).portrait, coverMonths, liquid, needMonthly, usualMonthly, obligationsMonthly, debtShare, surplusMonthly, next };
}
