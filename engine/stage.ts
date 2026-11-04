/**
 * «Твой этап» (D115): где человек сейчас по деньгам и что его ближайший шаг. Не оценка и не баллы — лестница из пяти ступеней
 * и одно предложение про следующую. Считается по деньгам, которые есть на счетах сегодня (не по разнице «доходы − расходы»),
 * и по обычным тратам; доходы и расходы будущих месяцев нужны только для темпа.
 *
 * Ступени (по тому, на сколько месяцев хватит денег, если доход пропадёт):
 *   1. «От дохода до дохода» — меньше месяца
 *   2. «Есть запас на месяц» — от месяца до подушки (по умолчанию 3 мес.)
 *   3. «Подушка есть» — подушка набрана
 *   4. «Копишь на цели» — подушка есть и ещё остаётся откладывать
 *   5. «Запас на год и больше» — год и больше без дохода при том, что остаётся откладывать
 * Опирается только на то, что есть в бэкапе: наличные и долги вне MoneyManager не видны — это сказано в тексте.
 */
import { add, formatKZT, mulDiv, sum, ZERO, type Money } from './money';
import type { IsoDate, MonthKey } from './date';
import { buildOverview } from './overview';
import { baseForecast, runway } from './simple';
import type { AppState } from './state';

export type StageNo = 1 | 2 | 3 | 4 | 5;

export interface PersonStage {
  stage: StageNo;
  title: string;
  /** Одна-две фразы по-человечески: что это значит для жизни. */
  portrait: string;
  /** На сколько месяцев хватит денег без дохода (null — больше 5 лет). */
  coverMonths: number | null;
  /** Деньги, которые есть сейчас и считаются «подушкой» (снимаются сразу). */
  liquid: Money;
  /** Сколько уходит в обычный месяц вместе с платежами по долгам. */
  needMonthly: Money;
  /** Доля дохода, которая уходит на платежи по долгам и рассрочкам (0…1), null — дохода нет. */
  debtShare: number | null;
  /** Сколько остаётся в месяц в среднем за ближайшие полгода (минус — траты больше дохода). */
  surplusMonthly: Money;
  /** Сколько месяцев нужно подушке (из цели «Подушка», по умолчанию 3). */
  cushionMonths: number;
  next: NextStep | null;
}

export interface NextStep {
  /** На какую ступень идём. */
  toStage: StageNo;
  toTitle: string;
  /** Сколько денег не хватает до неё (0 — дело не в деньгах). */
  missing: Money;
  /** К какому месяцу при нынешнем темпе; null — не набирается. */
  by: MonthKey | null;
  /** Готовая фраза. */
  text: string;
}

const STAGES: Record<StageNo, { title: string; portrait: string }> = {
  1: { title: 'От дохода до дохода', portrait: 'Денег хватает меньше чем на месяц без дохода: любая неожиданность бьёт сразу. Сначала нужен хотя бы месячный запас.' },
  2: { title: 'Есть запас на месяц', portrait: 'Неожиданный расход ты переживёшь, а вот потеря дохода — вряд ли. Следующая цель — подушка.' },
  3: { title: 'Подушка есть', portrait: 'Если доход пропадёт, ты продержишься несколько месяцев и успеешь найти выход. Теперь можно думать о целях.' },
  4: { title: 'Копишь на цели', portrait: 'Подушка есть, и ещё остаётся откладывать. Деньги уже работают на то, что тебе нужно.' },
  5: { title: 'Запас на год и больше', portrait: 'Ты можешь год жить без дохода и при этом копить. Теперь это вопрос выбора, а не выживания.' },
};

const tg = (m: Money): string => formatKZT((Math.round(m / 100) * 100) as Money);

/** Через сколько месяцев набирается нужная сумма при темпе `perMonth`: месяц ключом, null — никогда. */
function reachMonth(today: IsoDate, missing: Money, perMonth: Money): MonthKey | null {
  if (missing <= 0) return today.slice(0, 7) as MonthKey;
  if (perMonth <= 0) return null;
  const n = Math.ceil(missing / perMonth);
  if (n > 120) return null;
  const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}` as MonthKey;
}

export function personStage(state: AppState, today: IsoDate): PersonStage | null {
  if (!state.imported) return null;
  const o = buildOverview(state, today);
  const rw = runway(state, today);
  const coverMonths = rw === null ? null : rw.months;
  const cover = coverMonths ?? 999;
  const liquid = o.capital.liquidNow;
  const needMonthly = add(o.spend.usualMonthly, o.spend.obligationsMonthly);
  const income = sum(state.settings.incomeSchedule.filter((x) => (!x.start || x.start <= today) && (!x.end || x.end > today)).map((x) => x.amount));
  const debtShare = income > 0 ? Math.min(1, o.spend.obligationsMonthly / income) : null;
  const sim = baseForecast(state, today, 8);
  const flows = sim.months.slice(1, 7).map((m) => m.income - m.expenses - m.obligations - m.events);
  const surplusMonthly = (flows.length ? mulDiv(sum(flows as Money[]), 1, flows.length) : ZERO) as Money;
  const cush = state.goals.find((g) => g.role === 'safety' && g.parentId === undefined && g.status === 'active');
  const cushionMonths: number = (cush?.targetRule?.kind === 'months_of_base' ? cush.targetRule.months : undefined) ?? state.settings.reserveMonths ?? 3;

  const saving = surplusMonthly > 0;
  let stage: StageNo;
  if (cover < 1) stage = 1;
  else if (cover < cushionMonths) stage = 2;
  else if (cover >= 12 && saving) stage = 5;
  else if (saving) stage = 4;
  else stage = 3;

  let next: NextStep | null = null;
  const need = (months: number): Money => Math.max(0, mulDiv(needMonthly, months, 1) - liquid) as Money;
  if (stage <= 2) {
    const toStage: StageNo = stage === 1 ? 2 : 3;
    const months = stage === 1 ? 1 : cushionMonths;
    const missing = need(months);
    const by = reachMonth(today, missing, surplusMonthly);
    next = {
      toStage,
      toTitle: STAGES[toStage].title,
      missing,
      by,
      text:
        surplusMonthly > 0
          ? `Чтобы денег хватало на ${months === 1 ? 'месяц' : `${months} мес.`} без дохода, не хватает ≈ ${tg(missing)}.`
          : `Сейчас траты больше дохода (на ≈ ${tg((-surplusMonthly) as Money)} в месяц) — пока так, запас не растёт. До ${months === 1 ? 'месячного запаса' : 'подушки'} не хватает ≈ ${tg(missing)}.`,
    };
  } else if (stage === 3) {
    next = { toStage: 4, toTitle: STAGES[4].title, missing: ZERO, by: null, text: 'Чтобы копить на цели, нужно, чтобы доходы были больше трат: сейчас остаток в месяц нулевой или отрицательный. Загляни в «Где можно сэкономить».' };
  } else if (stage === 4) {
    const missing = need(12);
    next = {
      toStage: 5,
      toTitle: STAGES[5].title,
      missing,
      by: reachMonth(today, missing, surplusMonthly),
      text: `Чтобы хватало на год без дохода, не хватает ≈ ${tg(missing)}. Цели тоже важны — как делить деньги между запасом и целями, решаешь ты.`,
    };
  }
  return { stage, ...STAGES[stage], coverMonths, liquid, needMonthly, debtShare, surplusMonthly, cushionMonths, next };
}
