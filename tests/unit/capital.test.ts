/**
 * Капитал, обязательства, дебиторка, ликвидность (§3.3) и инварианты классификации (§3.2).
 * Ожидаемые числа посчитаны вручную в комментариях — до реализации.
 */
import { describe, it, expect } from 'vitest';
import { computeCapital, liquidOn, availableFrom, monthlyFlows, baselineMonthly, validateAdjustment, SAVINGS_FLOW_ACCOUNT_ID, type CapitalInput } from '../../engine/ledger';
import { classifyAll, DEFAULT_CLASSIFICATION, type ClassificationSettings } from '../../engine/classify';
import { makeInstallment, obligationStatus } from '../../engine/obligations';
import { mergeAccountSettings, type AccountSettings, type ManualAccount } from '../../engine/settings';
import { tenge } from '../../engine/money';
import type { ImportedData, Operation } from '../../engine/types';
import { acc, cat, dataset, exp, inc, trf } from '../support/build';

const TODAY = '2026-10-28';

const cats = [
  cat('c-salary', 'Зарплата', 'income'),
  cat('c-food', 'Продукты'),
  cat('c-lent', 'Долг'),
  cat('c-lent-back', 'Возвращают долг', 'income'),
  cat('c-borrow', 'Беру в долг', 'income'),
  cat('c-repay', 'Возвращаю долг'),
  cat('c-save', 'Накопительный счёт'),
  cat('c-save-in', 'Накопление', 'income'),
];
const cls: ClassificationSettings = {
  ...DEFAULT_CLASSIFICATION,
  rules: [...DEFAULT_CLASSIFICATION.rules, { categoryTitle: 'Зарплата', class: 'I_work' }, { categoryTitle: 'Продукты', class: 'E_base' }],
};

const accounts = [acc('a', 'Карта'), acc('b', 'Наличные'), acc('dep', 'Депозит'), acc('tech', 'Технический', { ignoreInBalance: true })];

function baseOps(): Operation[] {
  return [
    inc('2026-09-01', 'a', 200_000, 'c-salary'),
    exp('2026-09-05', 'a', 50_000, 'c-food'),
    trf('2026-09-10', 'a', 'b', 30_000),
    exp('2026-09-12', 'a', 10_000, 'c-lent'),
    inc('2026-09-20', 'a', 4_000, 'c-lent-back'),
    inc('2026-09-21', 'b', 15_000, 'c-borrow'),
    exp('2026-09-25', 'b', 5_000, 'c-repay'),
    exp('2026-09-26', 'a', 20_000, 'c-save'),
    inc('2026-09-27', 'dep', 100_000, null), // начальный остаток депозита
    inc('2026-09-28', 'tech', 7_777, null),
    exp('2026-11-15', 'a', 1_000, 'c-food'), // будущая операция — не входит в баланс на сегодня
  ];
}

const accSettings = (): AccountSettings[] =>
  mergeAccountSettings([], accounts).map((s) => (s.accountId === 'dep' ? { ...s, liquidity: { kind: 'locked_until', date: '2027-03-01' } } : s));

function input(data: ImportedData, extra: Partial<CapitalInput> = {}): CapitalInput {
  const own = makeInstallment({ id: 'ob-own', title: 'Телефон', owner: 'self', remaining: tenge(60_570), remainingAsOf: '2026-10-01', payment: tenge(30_285), firstDate: '2026-11-05' });
  const fam = makeInstallment({ id: 'ob-fam', title: 'Холодильник маме', owner: 'family', remaining: tenge(15_000), remainingAsOf: '2026-10-01', payment: tenge(5_000), firstDate: '2026-11-10' });
  return {
    data,
    classified: classifyAll(data, cls).ops,
    accountSettings: accSettings(),
    manualAccounts: [],
    adjustments: [],
    obligations: [own, fam].map((o) => obligationStatus(o, data, TODAY, { matchWindowDays: 15 })),
    today: TODAY,
    ...extra,
  };
}

const D = () => dataset({ accounts, categories: cats, operations: baseOps() });

describe('капитал брутто, обязательства, нетто, дебиторка (§3.3)', () => {
  it('считает все составляющие по формулам', () => {
    const r = computeCapital(input(D()));
    const bal = Object.fromEntries(r.accounts.map((p) => [p.accountId, p.balance]));
    // a = 200 000 − 50 000 − 30 000 − 10 000 + 4 000 − 20 000 = 94 000
    expect(bal['a']).toBe(tenge(94_000));
    expect(bal['b']).toBe(tenge(40_000));
    expect(bal['dep']).toBe(tenge(100_000));
    expect(bal['tech']).toBe(tenge(7_777));
    // перевод на сбережения вне приложения — псевдосчёт, не трата
    expect(bal[SAVINGS_FLOW_ACCOUNT_ID]).toBe(tenge(20_000));
    // брутто = 94 000 + 40 000 + 100 000 + 20 000 (tech исключён)
    expect(r.gross).toBe(tenge(254_000));
    expect(r.receivables).toBe(tenge(6_000));
    expect(r.liabilities.payablesFromOps).toBe(tenge(10_000));
    expect(r.liabilities.installmentsOwn).toBe(tenge(60_570));
    expect(r.liabilities.installmentsFamily).toBe(tenge(15_000));
    expect(r.liabilities.debtsManual).toBe(tenge(0));
    expect(r.liabilities.total).toBe(tenge(85_570));
    expect(r.net).toBe(tenge(168_430));
    expect(r.netWithReceivables).toBe(tenge(174_430));
  });

  it('исключённый счёт не входит в капитал, но виден в списке с пометкой', () => {
    const r = computeCapital(input(D()));
    const tech = r.accounts.find((p) => p.accountId === 'tech')!;
    expect(tech.excluded).toBe(true);
    expect(r.explanation.some((s) => s.code === 'capital.excluded' && s.refs?.accountId === 'tech')).toBe(true);
  });

  it('ликвидность: заблокированный депозит недоступен до даты разблокировки', () => {
    const r = computeCapital(input(D()));
    expect(r.liquidNow).toBe(tenge(154_000));
    expect(liquidOn(r, '2027-02-28')).toBe(tenge(154_000));
    expect(liquidOn(r, '2027-03-01')).toBe(tenge(254_000));
  });

  it('availableFrom по видам ликвидности', () => {
    expect(availableFrom({ kind: 'instant' }, TODAY)).toBe(TODAY);
    expect(availableFrom({ kind: 'days', days: 3 }, TODAY)).toBe('2026-10-31');
    expect(availableFrom({ kind: 'locked_until', date: '2027-03-01' }, TODAY)).toBe('2027-03-01');
    expect(availableFrom({ kind: 'locked_until', date: '2026-01-01' }, TODAY)).toBe(TODAY);
  });

  it('ручной счёт входит в капитал; если он принимает сбережения, псевдосчёт не создаётся', () => {
    const manual: ManualAccount = {
      id: 'm1', title: 'Депозит в другом банке', balance: tenge(500_000), balanceDate: '2026-10-01',
      liquidity: { kind: 'instant' }, comment: '', receivesSavingsFlows: true,
    };
    const data = dataset({ accounts, categories: cats, operations: [...baseOps(), exp('2026-10-05', 'a', 3_000, 'c-save')] });
    const r = computeCapital(input(data, { manualAccounts: [manual] }));
    const bal = Object.fromEntries(r.accounts.map((p) => [p.accountId, p.balance]));
    expect(bal[SAVINGS_FLOW_ACCOUNT_ID]).toBeUndefined();
    // перевод до даты баланса уже учтён в 500 000; после — добавляется
    expect(bal['m1']).toBe(tenge(503_000));
    expect(r.gross).toBe(tenge(91_000 + 40_000 + 100_000 + 503_000));
  });

  it('ручная корректировка меняет баланс счёта; без комментария — ошибка валидации', () => {
    const r = computeCapital(input(D(), { adjustments: [{ id: 'adj1', accountId: 'a', date: '2026-10-10', amount: tenge(-1_500), comment: 'потерял наличные' }] }));
    expect(r.accounts.find((p) => p.accountId === 'a')!.balance).toBe(tenge(92_500));
    expect(validateAdjustment({ id: 'x', accountId: 'a', date: '2026-10-10', amount: tenge(1), comment: '  ' })).toContain('Нужен комментарий');
    expect(validateAdjustment({ id: 'x', accountId: 'a', date: '2026-10-10', amount: tenge(1), comment: 'ок' })).toEqual([]);
  });

  it('ручной долг + долг из операций → предупреждение о возможном двойном учёте (D16)', () => {
    const data = D();
    const debt = makeInstallment({ id: 'ob-debt', kind: 'debt', title: 'Долг другу', owner: 'self', remaining: tenge(10_000), remainingAsOf: '2026-10-01', payment: tenge(10_000), firstDate: '2026-12-01' });
    const inp = input(data);
    inp.obligations.push(obligationStatus(debt, data, TODAY, { matchWindowDays: 15 }));
    const r = computeCapital(inp);
    expect(r.liabilities.debtsManual).toBe(tenge(10_000));
    expect(r.explanation.some((s) => s.code === 'capital.double_debt' && s.level === 'warn')).toBe(true);
  });

  it('каждое число объяснено: в explanation есть строки брутто, обязательств, нетто', () => {
    const r = computeCapital(input(D()));
    for (const code of ['capital.gross', 'capital.liabilities', 'capital.net', 'capital.receivables', 'capital.liquid']) {
      expect(r.explanation.some((s) => s.code === code)).toBe(true);
    }
  });
});

describe('инварианты классификации (§3.2)', () => {
  const base = () => computeCapital(input(D()));
  const withOp = (op: Operation) => {
    const data = dataset({ accounts, categories: cats, operations: [...baseOps(), op] });
    return { cap: computeCapital(input(data)), flows: monthlyFlows(classifyAll(data, cls).ops, ['2026-10'])['2026-10']! };
  };
  const baseFlows = () => monthlyFlows(classifyAll(D(), cls).ops, ['2026-10'])['2026-10']!;

  it('перевод между своими счетами не меняет капитал и не является расходом', () => {
    const { cap, flows } = withOp(trf('2026-10-10', 'a', 'b', 5_000));
    expect(cap.gross).toBe(base().gross);
    expect(cap.net).toBe(base().net);
    expect(flows.expense).toBe(baseFlows().expense);
    expect(flows.income).toBe(baseFlows().income);
  });

  it('возврат выданного долга — не доход: дебиторка уменьшается, капитал (с дебиторкой) не растёт', () => {
    const { cap, flows } = withOp(inc('2026-10-10', 'a', 3_000, 'c-lent-back'));
    expect(cap.receivables).toBe(tenge(6_000 - 3_000));
    expect(cap.netWithReceivables).toBe(base().netWithReceivables);
    expect(flows.income).toBe(baseFlows().income);
  });

  it('выдача долга — не расход: дебиторка растёт, капитал (с дебиторкой) не падает', () => {
    const { cap, flows } = withOp(exp('2026-10-10', 'a', 2_000, 'c-lent'));
    expect(cap.receivables).toBe(tenge(8_000));
    expect(cap.netWithReceivables).toBe(base().netWithReceivables);
    expect(flows.expense).toBe(baseFlows().expense);
  });

  it('полученный займ — не доход: растёт кредиторка, нетто не меняется', () => {
    const { cap, flows } = withOp(inc('2026-10-10', 'a', 7_000, 'c-borrow'));
    expect(cap.liabilities.payablesFromOps).toBe(tenge(17_000));
    expect(cap.gross).toBe(base().gross + tenge(7_000));
    expect(cap.net).toBe(base().net);
    expect(flows.income).toBe(baseFlows().income);
  });

  it('перевод на сбережения вне приложения — не трата и не меняет капитал', () => {
    const { cap, flows } = withOp(exp('2026-10-10', 'a', 4_000, 'c-save'));
    expect(cap.gross).toBe(base().gross);
    expect(flows.expense).toBe(baseFlows().expense);
  });

  it('снятие со сбережений — не доход и не меняет капитал', () => {
    const { cap, flows } = withOp(inc('2026-10-10', 'a', 4_000, 'c-save-in'));
    expect(cap.gross).toBe(base().gross);
    expect(flows.income).toBe(baseFlows().income);
  });
});

describe('потоки по месяцам и базовые расходы', () => {
  it('monthlyFlows: доходы и расходы только из групп income/expense; разбивка по классам', () => {
    const f = monthlyFlows(classifyAll(D(), cls).ops, ['2026-09', '2026-11']);
    expect(f['2026-09']!.income).toBe(tenge(200_000));
    expect(f['2026-09']!.expense).toBe(tenge(50_000));
    expect(f['2026-09']!.byClass.E_base).toBe(tenge(50_000));
    expect(f['2026-09']!.byClass.F_lent).toBe(tenge(10_000));
    expect(f['2026-11']!.expense).toBe(tenge(1_000));
  });

  it('baselineMonthly: медиана E_base за 6 полных месяцев до текущего', () => {
    const ops = [100, 200, 300, 400, 500, 600].map((v, i) => exp(`2026-0${4 + i}-15`, 'a', v, 'c-food'));
    ops.push(exp('2026-10-01', 'a', 99_999, 'c-food')); // текущий неполный месяц не входит
    const data = dataset({ accounts, categories: cats, operations: ops });
    const r = baselineMonthly(classifyAll(data, cls).ops, TODAY, 'E_base', 6);
    expect(r.months).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(r.median).toBe(tenge(350));
  });

  it('baselineMonthly: месяцы до начала данных не считаются нулями; пустой месяц внутри данных — ноль', () => {
    const ops = [exp('2026-07-10', 'a', 900, 'c-food'), exp('2026-09-10', 'a', 300, 'c-food')];
    const data = dataset({ accounts, categories: cats, operations: ops });
    const r = baselineMonthly(classifyAll(data, cls).ops, TODAY, 'E_base', 6);
    expect(r.months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(r.values).toEqual([tenge(900), tenge(0), tenge(300)]);
    expect(r.median).toBe(tenge(300));
    expect(r.explanation.some((s) => s.code === 'baseline.short')).toBe(true);
  });
});
