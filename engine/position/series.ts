/**
 * «Положение» v4, ряды (T02): то, из чего потом считаются показатели «Здесь и сейчас» и «Вектор».
 * Чистая функция от состояния и даты: без доступа к времени и хранилищу, деньги — целые тиыны.
 *
 * Что собирается:
 *  - потоки по полным месяцам (до 12 последних, только с начала данных): доход, расход, остаток, платежи по своим рассрочкам,
 *    взято в долг у людей, возвращено людям;
 *  - капитал подтверждённого слоя на 7 дат: сегодня и концы месяцев 1…6 месяцев назад (подтверждённый слой — всё, что видно в бэкапе:
 *    счета с корректировками, без ручных активов; долги и рассрочки вычтены);
 *  - долг людям (F_borrowed − F_borrowed_back + долги до начала учёта) и весь долг на те же даты;
 *  - просрочки по графикам обязательств;
 *  - ликвидные деньги сегодня, доступные за 30 дней и «чистая ликвидность» (ликвидные минус долг людям).
 *
 * Определения перенесены из проб (series/series4, project docs: position-probe-v3-a, position-probe-v4-a) без изменения модели.
 * Намеренные отличия от пробы, не влияющие на её числа там, где данные есть:
 *  - на дату, раньше которой в бэкапе нет ни одной операции, ряды дают `null`, а не число (проба считала там баланс 0);
 *  - платежи по рассрочкам «после даты» берутся по датам операций (дата прошлой точки < дата платежа ≤ сегодня), а не по календарным
 *    месяцам ряда: платёж в текущем неполном месяце тоже возвращается в долг прошлой даты. На данных проб (операции кончаются
 *    в прошлом месяце) результат тот же;
 *  - долг людям считается так же, как в `computeCapital` (с долгами до начала учёта и без ухода ниже нуля), а не сырой суммой.
 */
import { add, sub, sum, tiyn, ZERO, type Money } from '../money';
import { addDays, addMonths, endOfMonth, fullMonthsBefore, monthKey, startOfMonth, type IsoDate, type MonthKey } from '../date';
import type { AppState } from '../state';
import { buildOverview } from '../overview';
import { computeCapital, liquidOn, monthlyFlows } from '../ledger';

/** Сколько прошлых точек капитала в ряду (кроме «сегодня»). */
export const SERIES_LOOKBACK = 6;
/** Сколько последних полных месяцев берётся для потоков. */
export const SERIES_FLOW_MONTHS = 12;
/** Горизонт «доступно за N дней» для строки интерфейса и инвестируемого капитала. */
export const LIQUID_HORIZON_DAYS = 30;

export interface PositionSeries {
  /** Есть ли в бэкапе хотя бы одна операция. Без неё все ряды пусты. */
  hasData: boolean;
  today: IsoDate;
  /** Последний полный месяц (месяц перед месяцем `today`). */
  lastMonth: MonthKey;
  /** Полных месяцев истории: от месяца первой операции до `lastMonth` включительно. */
  histMonths: number;

  /** Последние ≤12 полных месяцев по возрастанию, только с месяца первой операции. Остальные потоковые ряды — той же длины. */
  months: MonthKey[];
  income: Money[];
  expense: Money[];
  /** Остаток месяца: доход − расход. */
  free: Money[];
  /** Платежи по своим рассрочкам (класс E_installment_own). */
  installmentsPaid: Money[];
  /** Взято в долг у людей. */
  borrowed: Money[];
  /** Возвращено людям. */
  borrowedBack: Money[];

  /**
   * Даты точек ряда: [0] — `today`, [h] — конец месяца за h месяцев до последнего полного.
   * Для h = 6 при today в ноябре это 30 апреля.
   */
  dates: IsoDate[];
  /** Капитал подтверждённого слоя (счета бэкапа с корректировками минус все долги) на каждую дату; null — на эту дату данных ещё нет. */
  netConfirmed: (Money | null)[];
  /** Весь долг (рассрочки, долги вручную, долг людям) на каждую дату. */
  debt: (Money | null)[];
  /** Долг людям на каждую дату. */
  payables: (Money | null)[];

  /** Капитал нетто сегодня, включая ручные активы (как в «Обзоре»). */
  netNow: Money;
  /** Деньги, доступные сегодня (не ниже нуля). */
  liquidNow: Money;
  /** Деньги, доступные не позже чем через 30 дней (не ниже нуля). */
  liquid30: Money;
  /** Чистая ликвидность: доступные сегодня минус долг людям (не ниже нуля). Заёмные деньги запасом не считаются. */
  netLiquid: Money;
  /** Платежей по графикам, которых нет в операциях (после даты, на которую введён остаток). */
  overdueCount: number;
}

const nulls = (): null[] => Array.from({ length: SERIES_LOOKBACK + 1 }, () => null);

/** Месяц `d` не раньше месяца первой операции — значит, на эту дату в бэкапе уже что-то было. */
const hasDataOn = (d: IsoDate, firstMonth: MonthKey): boolean => monthKey(d) >= firstMonth;

export function buildPositionSeries(state: AppState, today: IsoDate): PositionSeries {
  const o = buildOverview(state, today);
  const data = state.imported;
  const hasData = !!data && data.operations.length > 0;
  const lastMonth = monthKey(addMonths(startOfMonth(today), -1));
  const dates: IsoDate[] = [today];
  for (let h = 1; h <= SERIES_LOOKBACK; h++) dates.push(endOfMonth(addMonths(startOfMonth(today), -1 - h)));

  const payablesNow = o.capital.liabilities.payablesFromOps;
  const liquidNow = o.capital.liquidNow > 0 ? o.capital.liquidNow : ZERO;
  const liquid30Raw = liquidOn(o.capital, addDays(today, LIQUID_HORIZON_DAYS));
  const base = {
    today, lastMonth, dates,
    netNow: o.capital.net,
    liquidNow,
    liquid30: liquid30Raw > 0 ? liquid30Raw : ZERO,
    netLiquid: sub(liquidNow, payablesNow) > 0 ? sub(liquidNow, payablesNow) : ZERO,
    overdueCount: o.obligations.reduce((a, st) => a + st.entries.filter((e) => e.status === 'overdue' && e.date > st.obligation.remainingAsOf).length, 0),
  };
  if (!hasData || !o.classification) {
    return { ...base, hasData: false, histMonths: 0, months: [], income: [], expense: [], free: [], installmentsPaid: [], borrowed: [], borrowedBack: [], netConfirmed: nulls(), debt: nulls(), payables: nulls() };
  }

  let firstDate = data!.operations[0]!.date;
  for (const op of data!.operations) if (op.date < firstDate) firstDate = op.date;
  const firstMonth = monthKey(firstDate);
  const histMonths = lastMonth < firstMonth ? 0 : (Number(lastMonth.slice(0, 4)) - Number(firstMonth.slice(0, 4))) * 12 + (Number(lastMonth.slice(5, 7)) - Number(firstMonth.slice(5, 7))) + 1;

  const ops = o.classification.ops;
  const months = fullMonthsBefore(today, SERIES_FLOW_MONTHS).filter((m) => m >= firstMonth);
  const flows = monthlyFlows(ops, months);
  const income = months.map((m) => flows[m]!.income);
  const expense = months.map((m) => flows[m]!.expense);
  const free = income.map((x, i) => sub(x, expense[i]!));
  const installmentsPaid = months.map((m) => flows[m]!.byClass['E_installment_own']);
  const borrowed = months.map((m) => flows[m]!.byClass['F_borrowed']);
  const borrowedBack = months.map((m) => flows[m]!.byClass['F_borrowed_back']);

  // долги по графикам и вручную: остаток сейчас; на прошлую дату — плюс платежи по своим рассрочкам, сделанные после неё
  const liab = o.capital.liabilities;
  const obligationsNow = sum([liab.installmentsOwn, liab.installmentsFamily, liab.debtsManual]);
  const paidAfter = (d: IsoDate): Money => {
    let s = ZERO;
    for (const c of ops) if (c.cls === 'E_installment_own' && c.op.kind !== 'transfer' && c.op.date > d && c.op.date <= today) s = add(s, c.op.amount);
    return s;
  };

  const netConfirmed: (Money | null)[] = [];
  const debt: (Money | null)[] = [];
  const payables: (Money | null)[] = [];
  for (let h = 0; h <= SERIES_LOOKBACK; h++) {
    const d = dates[h]!;
    if (h > 0 && !hasDataOn(d, firstMonth)) {
      netConfirmed.push(null); debt.push(null); payables.push(null);
      continue;
    }
    // тот же расчёт, что «Обзор», но на дату d и без ручных активов; обязательства подставляются отдельно (остаток на прошлую дату восстанавливается выше)
    const cap = computeCapital({
      data: data!, classified: ops, accountSettings: state.settings.accounts, manualAccounts: [], adjustments: state.adjustments,
      obligations: [], today: d, openingDebts: state.settings.openingDebts, savingsFlows: state.settings.savingsFlows,
    });
    const people = cap.liabilities.payablesFromOps;
    const total = tiyn(add(add(obligationsNow, paidAfter(d)), people));
    payables.push(people);
    debt.push(total);
    netConfirmed.push(sub(cap.gross, total));
  }

  return { ...base, hasData: true, histMonths, months, income, expense, free, installmentsPaid, borrowed, borrowedBack, netConfirmed, debt, payables };
}
