/**
 * Балансы, сверка с account_balance, капитал и ликвидность.
 */
import { add, median, neg, pos, sub, sum, tiyn, ZERO, type Money } from './money';
import { addDays, fullMonthsBefore, monthKey, type IsoDate, type MonthKey } from './date';
import { day, formula, money, plural, step, type Explanation } from './explain';
import type { ImportedData, Operation } from './types';
import { classGroup, ALL_CLASSES, type ClassifiedOp, type OpClass } from './classify';
import { totalRemaining, type ObligationStatus } from './obligations';
import type { AccountSettings, Adjustment, Liquidity, ManualAccount, OpeningDebts, SavingsFlowsSetting } from './settings';

/** Влияние операции на балансы счетов (+ приход, − расход). */
export function operationEffects(op: Operation): [string, Money][] {
  if (op.kind !== 'transfer') return [[op.accountId, op.kind === 'income' ? op.amount : tiyn(-op.amount)]];
  return [
    [op.fromAccountId, tiyn(-op.fromAmount)],
    [op.toAccountId, op.toAmount],
  ];
}

/** Балансы по счетам из операций (включительно до даты `until`, если задана). */
export function computeBalances(ops: readonly Operation[], until?: IsoDate): Map<string, Money> {
  const m = new Map<string, Money>();
  for (const op of ops) {
    if (until && op.date > until) continue;
    for (const [acc, d] of operationEffects(op)) m.set(acc, add(m.get(acc) ?? ZERO, d));
  }
  return m;
}

export interface AccountReconcile {
  accountId: string;
  title: string;
  computed: Money;
  reported: Money | null;
  /** computed − reported */
  diff: Money;
  opCount: number;
  status: 'ok' | 'mismatch' | 'no_reference';
}

export interface ReconcileReport {
  ok: boolean;
  accounts: AccountReconcile[];
  explanation: Explanation;
}

/**
 * Сверка импорта: для каждого неудалённого счёта баланс из операций должен
 * совпасть с account_balance до тиына. Счёт без эталона проходит, только если расчёт = 0 (DECISIONS D9).
 */
export function reconcileAccounts(data: ImportedData): ReconcileReport {
  const balances = computeBalances(data.operations);
  const counts = new Map<string, number>();
  for (const op of data.operations) for (const [acc] of operationEffects(op)) counts.set(acc, (counts.get(acc) ?? 0) + 1);
  const explanation: Explanation = [];
  const accounts: AccountReconcile[] = [];
  for (const a of [...data.accounts].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (a.removed) continue;
    const computed = balances.get(a.id) ?? ZERO;
    const reported = a.id in data.reportedBalances ? data.reportedBalances[a.id]! : null;
    const diff = reported === null ? computed : sub(computed, reported);
    let status: AccountReconcile['status'];
    if (reported === null) status = computed === 0 ? 'ok' : 'no_reference';
    else status = diff === 0 ? 'ok' : 'mismatch';
    accounts.push({ accountId: a.id, title: a.title, computed, reported, diff, opCount: counts.get(a.id) ?? 0, status });
    if (status === 'mismatch') {
      explanation.push(
        step('reconcile.mismatch', `Счёт «${a.title}»: по операциям ${money(computed)}, в MoneyManager ${money(reported!)}, разница ${money(diff)}`, {
          level: 'error',
          amount: diff,
          refs: { accountId: a.id },
        }),
      );
    } else if (status === 'no_reference') {
      explanation.push(
        step('reconcile.no_reference', `Счёт «${a.title}»: нет строки в account_balance, а по операциям ${money(computed)} — сверить нечем`, {
          level: 'error',
          amount: computed,
          refs: { accountId: a.id },
        }),
      );
    } else {
      explanation.push(step('reconcile.ok', `Счёт «${a.title}»: ${money(computed)} — сходится`, { amount: computed, refs: { accountId: a.id } }));
    }
  }
  const ok = accounts.every((a) => a.status === 'ok');
  explanation.unshift(
    step(ok ? 'reconcile.summary.ok' : 'reconcile.summary.fail', ok ? `Все счета сходятся до тиына (${accounts.length})` : `Не сходится счетов: ${accounts.filter((a) => a.status !== 'ok').length} из ${accounts.length}. Импорт не считается успешным`, {
      level: ok ? 'info' : 'error',
    }),
  );
  return { ok, accounts, explanation };
}

// ───────────────────────── Капитал и ликвидность (§3.3) ─────────────────────────


/** Псевдосчёт «сбережения вне приложения», если ни один ручной счёт их не принимает (DECISIONS D29). */
export const SAVINGS_FLOW_ACCOUNT_ID = '__savings_flow__';

export interface CapitalInput {
  data: ImportedData;
  classified: readonly ClassifiedOp[];
  accountSettings: readonly AccountSettings[];
  manualAccounts: readonly ManualAccount[];
  adjustments: readonly Adjustment[];
  obligations: readonly ObligationStatus[];
  today: IsoDate;
  /** Долги до начала учёта (D60). По умолчанию 0. */
  openingDebts?: OpeningDebts;
  /** Куда уходили переводы «Накопительный счёт» (D61). По умолчанию — оценка. */
  savingsFlows?: SavingsFlowsSetting;
}

export interface AccountPosition {
  accountId: string;
  title: string;
  source: 'moneymanager' | 'manual' | 'savings_flow';
  balance: Money;
  excluded: boolean;
  liquidity: Liquidity;
  /** С какой даты деньги доступны. */
  availableFrom: IsoDate;
}

export interface Liabilities {
  installmentsOwn: Money;
  installmentsFamily: Money;
  /** Obligation.kind = 'debt' — долги, которых нет в MoneyManager. */
  debtsManual: Money;
  /** F_borrowed − F_borrowed_back по операциям. */
  payablesFromOps: Money;
  total: Money;
}

export interface CapitalReport {
  asOf: IsoDate;
  accounts: AccountPosition[];
  gross: Money;
  liabilities: Liabilities;
  /** F_lent − F_lent_back по операциям. Показывается отдельно, в нетто не входит. */
  receivables: Money;
  net: Money;
  /** Нетто + дебиторка — справочно, для инвариантов §3.2 (DECISIONS D30). */
  netWithReceivables: Money;
  liquidNow: Money;
  explanation: Explanation;
}

/** Дата, с которой деньги на счёте доступны. */
export function availableFrom(l: Liquidity, today: IsoDate): IsoDate {
  if (l.kind === 'instant') return today;
  if (l.kind === 'days') return addDays(today, Math.max(0, l.days));
  return l.date > today ? l.date : today;
}

export function validateAdjustment(a: Adjustment): string[] {
  const errs: string[] = [];
  if (!a.comment.trim()) errs.push('Нужен комментарий');
  if (a.amount === 0) errs.push('Сумма корректировки не может быть нулевой');
  if (!a.accountId) errs.push('Нужен счёт');
  return errs;
}

function liquidityLabel(l: Liquidity): string {
  if (l.kind === 'instant') return 'доступно сразу';
  if (l.kind === 'days') return `снятие за ${l.days} дн.`;
  return `заблокировано до ${day(l.date)}`;
}

export function computeCapital(inp: CapitalInput): CapitalReport {
  const { data, today } = inp;
  const explanation: Explanation = [];
  const settingsById = new Map(inp.accountSettings.map((s) => [s.accountId, s]));
  const balances = computeBalances(data.operations, today);

  // корректировки (D20): в капитал входят, в сверку импорта — нет
  const adjByAcc = new Map<string, Money>();
  for (const a of inp.adjustments) {
    if (a.date > today) continue;
    adjByAcc.set(a.accountId, add(adjByAcc.get(a.accountId) ?? ZERO, a.amount));
    explanation.push(step('capital.adjustment', `Корректировка ${money(a.amount)} на ${day(a.date)}: ${a.comment}`, { amount: a.amount, date: a.date, refs: { accountId: a.accountId, adjustmentId: a.id } }));
  }

  // поток «на сбережения вне приложения»
  const savingsFlows: { date: IsoDate; amount: Money }[] = [];
  let receivables = inp.openingDebts?.receivable ?? ZERO;
  let payables = inp.openingDebts?.payable ?? ZERO;
  for (const c of inp.classified) {
    if (c.op.kind === 'transfer' || c.op.date > today) continue;
    const a = c.op.amount;
    if (c.cls === 'T_savings_out') savingsFlows.push({ date: c.op.date, amount: a });
    else if (c.cls === 'T_savings_in') savingsFlows.push({ date: c.op.date, amount: neg(a) });
    else if (c.cls === 'F_lent') receivables = add(receivables, a);
    else if (c.cls === 'F_lent_back') receivables = sub(receivables, a);
    else if (c.cls === 'F_borrowed') payables = add(payables, a);
    else if (c.cls === 'F_borrowed_back') payables = sub(payables, a);
  }

  const accounts: AccountPosition[] = [];
  const push = (p: Omit<AccountPosition, 'availableFrom'>) => accounts.push({ ...p, availableFrom: availableFrom(p.liquidity, today) });

  for (const a of [...data.accounts].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (a.removed) continue;
    const s = settingsById.get(a.id);
    const excluded = s ? s.excluded : a.ignoreInBalance;
    const balance = add(balances.get(a.id) ?? ZERO, adjByAcc.get(a.id) ?? ZERO);
    push({ accountId: a.id, title: a.title, source: 'moneymanager', balance, excluded, liquidity: s?.liquidity ?? { kind: 'instant' } });
  }

  const sf: SavingsFlowsSetting = inp.savingsFlows ?? { mode: 'estimate' };
  const receiver =
    sf.mode === 'manual' ? inp.manualAccounts.find((m) => m.id === sf.manualAccountId) : sf.mode === 'estimate' ? inp.manualAccounts.find((m) => m.receivesSavingsFlows) : undefined;
  for (const m of [...inp.manualAccounts].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    let balance = add(m.balance, adjByAcc.get(m.id) ?? ZERO);
    if (m === receiver) {
      const after = sum(savingsFlows.filter((f) => f.date > m.balanceDate).map((f) => f.amount));
      if (after !== 0) {
        balance = add(balance, after);
        explanation.push(step('capital.savings_to_manual', `«${m.title}»: ${money(m.balance)} на ${day(m.balanceDate)} + переводы на сбережения после этой даты ${money(after)}`, { amount: after, refs: { accountId: m.id } }));
      }
    }
    const s = settingsById.get(m.id);
    push({ accountId: m.id, title: m.title, source: 'manual', balance, excluded: s?.excluded ?? false, liquidity: m.liquidity });
  }

  if (sf.mode === 'ignore') {
    const net = sum(savingsFlows.map((f) => f.amount));
    if (net !== 0) explanation.push(step('capital.savings_ignored', `Переводы на сбережения вне MoneyManager (${money(net)}) не учитываются отдельно: по настройке они уже есть в балансах счетов`, { amount: net, detail: true }));
  } else if (!receiver) {
    if (sf.mode === 'manual') explanation.push(step('capital.savings_receiver_missing', 'Выбранный для сбережений ручной счёт не найден — сбережения оценены по переводам', { level: 'warn' }));
    const net = sum(savingsFlows.map((f) => f.amount));
    if (net !== 0) {
      const s = settingsById.get(SAVINGS_FLOW_ACCOUNT_ID);
      push({ accountId: SAVINGS_FLOW_ACCOUNT_ID, title: 'Сбережения вне MoneyManager (по переводам)', source: 'savings_flow', balance: net, excluded: s?.excluded ?? false, liquidity: s?.liquidity ?? { kind: 'instant' } });
      explanation.push(
        step('capital.savings_flow', `Переводы на сбережения вне MoneyManager оценены по сумме: ${money(net)}. Если эти деньги потом вернулись в MoneyManager (например, счётом с начальным остатком), это двойной счёт — укажи это в «Настройки → Куда уходили переводы на сбережения»`, { level: sf.confirmed ? 'info' : 'warn', amount: net, refs: { accountId: SAVINGS_FLOW_ACCOUNT_ID } }),
      );
    }
  }

  let gross = ZERO;
  for (const p of accounts) {
    if (p.excluded) {
      explanation.push(step('capital.excluded', `«${p.title}» исключён из анализа (${money(p.balance)} не учитывается)`, { amount: p.balance, refs: { accountId: p.accountId }, detail: true }));
      continue;
    }
    gross = add(gross, p.balance);
  }

  const installmentsOwn = totalRemaining([...inp.obligations], (o) => o.kind === 'installment' && o.owner === 'self');
  const installmentsFamily = totalRemaining([...inp.obligations], (o) => o.kind === 'installment' && o.owner === 'family');
  const debtsManual = totalRemaining([...inp.obligations], (o) => o.kind === 'debt');
  // долг не бывает отрицательным: минус значит, что долг возник до начала учёта (D60)
  const rawPayables = payables;
  const rawReceivables = receivables;
  payables = pos(payables);
  receivables = pos(receivables);
  const total = sum([installmentsOwn, installmentsFamily, debtsManual, payables]);
  const liabilities: Liabilities = { installmentsOwn, installmentsFamily, debtsManual, payablesFromOps: payables, total };
  const net = sub(gross, total);
  const netWithReceivables = add(net, receivables);
  const liquidNow = sumAvailable(accounts, today);

  if (debtsManual !== 0 && payables !== 0) {
    explanation.push(step('capital.double_debt', `Есть и долги из операций (${money(payables)}), и долги, заведённые вручную (${money(debtsManual)}). Если это один и тот же долг — он посчитан дважды`, { level: 'warn' }));
  }
  // «не знаю — считать 0» (D68): то же число, но без предупреждения
  const ack = inp.openingDebts?.acknowledged === true;
  if (rawReceivables < 0) {
    explanation.push(
      ack
        ? step('capital.receivables_negative', `Тебе вернули на ${money(neg(rawReceivables))} больше, чем ты выдал в данных: долг до начала учёта, сумма неизвестна — считается 0`, { amount: rawReceivables, detail: true })
        : step('capital.receivables_negative', `Тебе вернули на ${money(neg(rawReceivables))} больше, чем ты выдал в данных: долг выдан до начала учёта (в данных ${money(rawReceivables)}). Пока он считается 0. Укажи сумму в «Настройки → Долги на начало учёта» или нажми там «Не знаю — считать 0»`, { level: 'warn', amount: rawReceivables }),
    );
  }
  if (rawPayables < 0) {
    explanation.push(
      ack
        ? step('capital.payables_negative', `Ты вернул на ${money(neg(rawPayables))} больше, чем занял в данных: долг до начала учёта, сумма неизвестна — считается 0`, { amount: rawPayables, detail: true })
        : step('capital.payables_negative', `Ты вернул на ${money(neg(rawPayables))} больше, чем занял в данных: долг взят до начала учёта (в данных ${money(rawPayables)}). Пока он считается 0, чтобы не завышать капитал. Укажи сумму в «Настройки → Долги на начало учёта» или нажми там «Не знаю — считать 0»`, { level: 'warn', amount: rawPayables }),
    );
  }

  const included = accounts.filter((p) => !p.excluded);
  const nonZero = included.filter((p) => p.balance !== 0);
  const zeros = included.length - nonZero.length;
  const locked = included.filter((p) => p.availableFrom > today);
  explanation.unshift(
    step('capital.gross', `Капитал брутто ${money(gross)} = ${nonZero.map((p) => `«${p.title}» ${money(p.balance)}`).join(' + ') || '0'}${zeros ? ` (ещё ${zeros} ${plural(zeros, 'счёт', 'счёта', 'счетов')} с нулевым остатком)` : ''}`, { amount: gross }),
    step('capital.liabilities', total === 0 ? 'Обязательств нет' : `Обязательства ${money(total)} = ${formula([['свои рассрочки', installmentsOwn, 1], ['семейные рассрочки', installmentsFamily, 1], ['долги вручную', debtsManual, 1], ['долги по операциям', payables, 1]])}`, { amount: total }),
    step('capital.net', total === 0 ? `Капитал нетто ${money(net)} = капитал брутто` : `Капитал нетто ${money(net)} = ${money(gross)} − ${money(total)}`, { amount: net }),
    step('capital.receivables', `Дебиторка (тебе должны) ${money(receivables)} — показана отдельно, в нетто не входит`, { amount: receivables, ...(receivables === 0 ? { detail: true } : {}) }),
    step('capital.liquid', `Ликвидно сейчас ${money(liquidNow)}: ${locked.map((p) => `«${p.title}» ${liquidityLabel(p.liquidity)}`).join(', ') || 'все счета доступны сразу'}`, { amount: liquidNow, ...(locked.length ? {} : { detail: true }) }),
  );
  return { asOf: today, accounts, gross, liabilities, receivables, net, netWithReceivables, liquidNow, explanation };
}

function sumAvailable(accounts: readonly AccountPosition[], date: IsoDate): Money {
  let s = ZERO;
  // отрицательный баланс (долг по карте) учитывается всегда, положительный — с даты доступности
  for (const p of accounts) if (!p.excluded && (p.balance < 0 || p.availableFrom <= date)) s = add(s, p.balance);
  return s;
}

/** Ликвидный капитал на дату: сумма денег, доступных к этой дате. */
export function liquidOn(r: CapitalReport, date: IsoDate): Money {
  return sumAvailable(r.accounts, date);
}

// ───────────────────────── Потоки по месяцам ─────────────────────────

export interface MonthFlows {
  /** Только группа income: финансирование и технические не входят. */
  income: Money;
  /** Только группа expense. */
  expense: Money;
  byClass: Record<OpClass, Money>;
}

const opAmount = (c: ClassifiedOp): Money => (c.op.kind === 'transfer' ? c.op.fromAmount : c.op.amount);

export function monthlyFlows(ops: readonly ClassifiedOp[], months: readonly MonthKey[]): Record<MonthKey, MonthFlows> {
  const out: Record<MonthKey, MonthFlows> = {};
  for (const m of months) out[m] = { income: ZERO, expense: ZERO, byClass: Object.fromEntries(ALL_CLASSES.map((c) => [c, ZERO])) as Record<OpClass, Money> };
  for (const c of ops) {
    const f = out[monthKey(c.op.date)];
    if (!f) continue;
    const a = opAmount(c);
    f.byClass[c.cls] = add(f.byClass[c.cls] ?? ZERO, a);
    const g = classGroup(c.cls);
    if (g === 'income') f.income = add(f.income, a);
    else if (g === 'expense') f.expense = add(f.expense, a);
  }
  return out;
}

export interface Baseline {
  cls: OpClass;
  classes: OpClass[];
  months: MonthKey[];
  values: Money[];
  median: Money;
  explanation: Explanation;
}

/**
 * Медиана суммы класса по полным месяцам перед текущим (DECISIONS D31):
 * месяцы до начала данных не участвуют, пустой месяц внутри данных — ноль.
 */
export function baselineMonthly(ops: readonly ClassifiedOp[], today: IsoDate, cls: OpClass | readonly OpClass[], n: number): Baseline {
  const list: readonly OpClass[] = typeof cls === 'string' ? [cls] : cls;
  const name = list.join(' + ') || '—';
  let first: IsoDate | null = null;
  for (const c of ops) if (first === null || c.op.date < first) first = c.op.date;
  const months = first === null ? [] : fullMonthsBefore(today, n).filter((m) => m >= monthKey(first!));
  const flows = monthlyFlows(ops, months);
  const values = months.map((m) => sum(list.map((c) => flows[m]!.byClass[c] ?? ZERO)));
  const med = median(values);
  const explanation: Explanation = [
    step('baseline.median', `${name}: медиана за ${months.length} полн. мес. = ${money(med)} (${months.map((m, i) => `${m}: ${money(values[i]!)}`).join('; ') || 'нет данных'})`, { amount: med }),
  ];
  if (months.length < n) {
    explanation.push(step('baseline.short', `Данных меньше ${n} полных месяцев (${months.length}) — оценка ${name} менее надёжна`, { level: 'warn' }));
  }
  return { cls: list[0] ?? 'E_base', classes: [...list], months, values, median: med, explanation };
}
