/**
 * Проверка здравого смысла (D107): не «правильно ли посчитано», а «можно ли верить выводу».
 *
 * Формулы движка проверяют модульные тесты. Здесь — выводы целиком: даёт ли модель на этих данных результат,
 * который здравомыслящий человек признал бы верным. Каждая проверка — инвариант с понятным текстом.
 * Уровни:
 *   fail — вывод приложения противоречит здравому смыслу (ошибка модели или скрытое допущение, искажающее ответ);
 *   warn — вывод верен, но человек должен это увидеть (минус по месяцам, траты по истории с другим доходом…).
 *
 * Чистая функция: ничего не меняет, расчёты не трогает. Используется в tests/sanity и scripts/sanity-check.ts.
 */
import { add, formatKZT, mulDiv, pos, sub, sum, ZERO, type Money } from './money';
import { addDays, formatDateRu, fullMonthsBefore, monthKey, type IsoDate, type MonthKey } from './date';
import { monthlyFlows } from './ledger';
import { classRegistry } from './classes';
import { flattenTree } from './goals';
import { buildSimInput } from './plan';
import { simulate, type SimResult } from './simulate';
import type { Overview } from './overview';
import type { AppState } from './state';

export type SanityLevel = 'fail' | 'warn';

export interface SanityFinding {
  id: SanityId;
  level: SanityLevel;
  text: string;
  /** Месяцы прогноза, к которым относится находка (если есть). */
  months?: MonthKey[];
  /** К чему относится: id дохода (income_drop_flat_spend, one_sided_inflation). */
  ref?: string;
}

export type SanityId =
  | 'cushion_ignores_money'
  | 'labels_exceed_money'
  | 'expense_mismatch'
  | 'income_drop_flat_spend'
  | 'one_sided_inflation'
  | 'negative_months'
  | 'goal_mostly_reached'
  | 'oneoff_averaged'
  | 'baseline_other_income'
  | 'spend_window_small_income'
  | 'cushion_temporary_debt';

/** Пороги — в одном месте, чтобы их можно было обсуждать. */
export const SANITY = {
  /** Прогноз тратит в месяц больше «обычно уходит» на «Обзоре» во столько раз → два разных ответа. */
  expenseRatio: 1.25,
  /** Доход падает на эту долю и больше → траты «как раньше» уже не допущение, а выдумка. */
  incomeDrop: 0.25,
  /** Цель «не достигается», но набрано столько → нельзя показывать как «никогда». */
  mostlyReached: 0.5,
  /** Категория «редкого» с таким числом операций за год и меньше → похоже на разовое. */
  oneoffOps: 2,
  /** Ближайший доход меньше этой доли месячных трат → окно «до дохода» режется мелким поступлением. */
  smallIncome: 0.25,
  /** Доля платежей по рассрочкам в месяце подушки → подушка больше чем наполовину из временного долга. */
  cushionDebtShare: 0.3,
} as const;

/** Целые тенге: тиыны только в сверке (словарь D105). */
const tg = (m: Money) => formatKZT(mulDiv(m, 1, 100) * 100 as Money);
const GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/** «с июля 2027» */
const mo = (k: MonthKey) => `${GEN[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
/** «за октябрь 2026» */
const moN = (k: MonthKey) => `${NOM[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const flow = (m: SimResult['months'][number]): Money => sub(sub(sub(m.income, m.expenses), m.obligations), m.events);

export interface SanityContext {
  overview: Overview;
  sim: SimResult;
}

export function sanityCheck(state: AppState, today: IsoDate): { findings: SanityFinding[]; ctx: SanityContext | null } {
  if (!state.imported) return { findings: [], ctx: null };
  const { input, overview: o } = buildSimInput(state, today);
  const sim = simulate(input);
  const out: SanityFinding[] = [];
  const months = sim.months;
  const full = months.slice(1); // первый месяц неполный

  // 1. Подушка не видит денег, которые уже есть
  const cushion = flattenTree(o.goalTree).find((n) => n.goal.role === 'safety' && n.goal.parentId === undefined && n.goal.status === 'active');
  if (cushion && cushion.goal.targetMin > 0 && cushion.progress < cushion.goal.targetMin && o.spend.onHand >= cushion.goal.targetMin) {
    out.push({
      id: 'cushion_ignores_money',
      // порядок целей — решение человека (04.11): деньги остаются за выбранной целью; это не ошибка модели, но человек должен видеть
      level: 'warn',
      text: `Подушка: ${tg(cushion.progress)} из ${tg(cushion.goal.targetMin)}, хотя на счетах ${tg(o.spend.onHand)}. Приложение считает подушкой только деньги, отложенные именно на неё — деньги других целей не засчитываются`,
    });
  }

  // 2. За целями в прогнозе закреплено больше, чем есть денег
  const roots = new Set(input.goals.filter((g) => g.parentId === undefined).map((g) => g.id));
  const over = months.filter((m) => sum(Object.entries(m.goalProgress).filter(([id]) => roots.has(id)).map(([, v]) => v)) > pos(m.assets)).map((m) => m.month);
  if (over.length) {
    out.push({ id: 'labels_exceed_money', level: 'fail', months: over, text: `С ${mo(over[0]!)} за целями в прогнозе числится больше, чем будет денег — даты целей слишком оптимистичны` });
  }

  // 3. Два разных «сколько я трачу»
  const fcMonthly = full[0]?.expenses ?? ZERO;
  if (o.spend.usualMonthly > 0 && fcMonthly > mulDiv(o.spend.usualMonthly, Math.round(SANITY.expenseRatio * 100), 100)) {
    out.push({
      id: 'expense_mismatch',
      level: 'fail',
      text: `На «Обзоре» обычно уходит ${tg(o.spend.usualMonthly)} в месяц, а прогноз считает ${tg(fcMonthly)} (с редкими тратами) — «хватает» на «Обзоре» сравнивается с меньшим числом`,
    });
  }

  // 4. Доход с датой окончания заметно уменьшает доход, а что изменится — не спрошено (D108)
  const horizonEnd = `${months[months.length - 1]?.month ?? today.slice(0, 7)}-31`;
  const totalIncome = sum(state.settings.incomeSchedule.filter((x) => (!x.start || x.start <= today) && (!x.end || x.end > today)).map((x) => x.amount));
  const answered = new Set(state.settings.incomeEndsAnswered ?? []);
  for (const x of state.settings.incomeSchedule) {
    if (!x.end || x.end <= today || x.end > horizonEnd || totalIncome <= 0) continue;
    if (x.amount < mulDiv(totalIncome, Math.round(SANITY.incomeDrop * 100), 100)) continue;
    const from = addDays(x.end, -62);
    const planned = input.events.some((e) => e.date >= from && ((e.kind === 'recurring_change' && e.amount < 0) || e.kind === 'income_start' || e.kind === 'income_change'));
    if (planned) continue;
    // первый месяц без этого дохода: если последняя выплата успела прийти в месяце окончания — следующий месяц
    const endMonth = Number(x.end.slice(8, 10)) >= x.dayOfMonth ? monthKey(addDays(`${x.end.slice(0, 7)}-28`, 7)) : monthKey(x.end);
    if (answered.has(x.id)) {
      out.push({ id: 'income_drop_flat_spend', level: 'warn', months: [endMonth], ref: x.id, text: `С ${mo(endMonth)} «${x.title}» закончится: доход меньше на ${tg(x.amount)}. Ты указал, что ничего не изменится — траты в прогнозе прежние` });
    } else {
      out.push({ id: 'income_drop_flat_spend', level: 'fail', months: [endMonth], ref: x.id, text: `С ${mo(endMonth)} «${x.title}» закончится: доход меньше на ${tg(x.amount)} в месяц, а траты в прогнозе прежние. Что изменится?` });
    }
  }

  // 5. Траты дорожают, а про рост доходов не спрошено (D108)
  if (input.expenses.some((e) => e.growthBp > 0) && state.settings.incomeSchedule.length) {
    const infl = `${(state.settings.inflationBp / 100).toString().replace('.', ',')} %`;
    // доход, который закончится в течение года, повышение не застанет — про него не спрашиваем
    const yearAhead = addDays(today, 365);
    const unasked = state.settings.incomeSchedule.filter((x) => x.indexed === undefined && (!x.end || x.end > yearAhead));
    if (unasked.length) {
      out.push({ id: 'one_sided_inflation', level: 'fail', ref: unasked.map((x) => x.id).join(','), text: `Траты в прогнозе дорожают на ${infl} в год, а доходы не растут: не указано, повышают ли их (${unasked.map((x) => `«${x.title}»`).join(', ')})` });
    } else if (state.settings.incomeSchedule.every((x) => x.indexed !== true)) {
      out.push({ id: 'one_sided_inflation', level: 'warn', text: `Траты в прогнозе дорожают на ${infl} в год, доходы не растут (так ты указал) — остаток месяца с годами тает` });
    }
  }

  // 6. Месяцы, когда траты больше дохода (человек должен это видеть)
  const neg = full.filter((m) => flow(m) < 0);
  if (neg.length) {
    const worst = neg.reduce((a, m) => (flow(m) < flow(a) ? m : a));
    out.push({
      id: 'negative_months',
      level: 'warn',
      months: neg.map((m) => m.month),
      text: `${neg.length} мес. траты больше дохода (с ${mo(neg[0]!.month)}, до ${tg(sub(ZERO, flow(worst)))} в месяц) — разница уходит из накоплений`,
    });
  }

  // 7. Цель «не достигается», но набрано много
  const last = months[months.length - 1];
  for (const g of input.goals) {
    if (g.status !== 'active' || g.targetMin <= 0 || sim.goalDates[g.id] !== null || !last) continue;
    const p = last.goalProgress[g.id] ?? ZERO;
    if (p >= mulDiv(g.targetMin, Math.round(SANITY.mostlyReached * 100), 100)) {
      out.push({ id: 'goal_mostly_reached', level: 'warn', text: `«${g.title}»: за ${months.length - 1} мес. набирается ${tg(p)} из ${tg(g.targetMin)}` });
    }
  }

  // 8. Разовое, усреднённое как ежегодное
  const ops = o.classification?.ops ?? [];
  const yearStart = fullMonthsBefore(today, 12)[0];
  const reg = classRegistry(state.settings.classes);
  for (const e of input.expenses) {
    const c = reg.find((x) => x.id === e.key);
    if (!c || c.behavior !== 'irregular') continue;
    const n = ops.filter((x) => x.cls === c.id && (!yearStart || monthKey(x.op.date) >= yearStart) && x.op.date < today).length;
    if (n > 0 && n <= SANITY.oneoffOps) {
      out.push({ id: 'oneoff_averaged', level: 'warn', text: `«${c.label}»: ${n === 1 ? 'одна трата' : `${n} траты`} за год, а в прогнозе ${tg(e.monthly)} каждый месяц. Если это было разово — отметь в «Раскладке трат»` });
    }
  }

  // 9. Траты взяты за период с другим доходом
  const win = fullMonthsBefore(today, state.settings.baselineMonths);
  if (win.length >= 4) {
    const fl = monthlyFlows(ops, win);
    const avg = mulDiv(sum(win.map((m) => fl[m]!.income)), 1, win.length);
    const lastM = win[win.length - 1]!;
    const late = fl[lastM]!.income;
    const early = avg;
    if (early > 0 && late < mulDiv(early, Math.round((1 - SANITY.incomeDrop) * 100), 100)) {
      out.push({ id: 'baseline_other_income', level: 'warn', text: `Доход за ${moN(lastM)} — ${tg(late)}, а в среднем за ${win.length} мес. — ${tg(early)}. Траты в прогнозе взяты в том числе за месяцы с большим доходом` });
    }
  }

  // 10. Окно «можно тратить» режется мелким доходом
  const ni = o.nextIncome;
  const sched = ni.source === 'schedule' ? state.settings.incomeSchedule.find((x) => x.title === ni.title) : undefined;
  if (sched && o.spend.usualMonthly > 0 && sched.amount < mulDiv(o.spend.usualMonthly, Math.round(SANITY.smallIncome * 100), 100)) {
    out.push({ id: 'spend_window_small_income', level: 'warn', text: `«Можно тратить до ${formatDateRu(ni.date)}» считается до дохода «${sched.title}» ${tg(sched.amount)} — он меньше четверти месячных трат` });
  }

  // 11. Подушка больше чем наполовину из временного долга
  if (cushion?.goal.targetRule?.kind === 'months_of_base' && cushion.goal.targetRule.basis === 'essential') {
    const ess = add(o.baseline.median, o.spend.obligationsMonthly);
    const endsSoon = (months[12]?.obligations ?? ZERO) === 0 && (full[0]?.obligations ?? ZERO) > 0;
    if (ess > 0 && endsSoon && o.spend.obligationsMonthly > mulDiv(ess, Math.round(SANITY.cushionDebtShare * 100), 100)) {
      out.push({ id: 'cushion_temporary_debt', level: 'warn', text: `Подушка: ${tg(o.spend.obligationsMonthly)} из ${tg(ess)} в месяц — платежи по рассрочкам, которые закончатся в течение года` });
    }
  }

  return { findings: out, ctx: { overview: o, sim } };
}

/** Только id ошибок уровня fail — для «храповика» в tests/sanity. */
export function sanityFails(state: AppState, today: IsoDate): SanityId[] {
  return sanityCheck(state, today).findings.filter((f) => f.level === 'fail').map((f) => f.id).sort();
}
