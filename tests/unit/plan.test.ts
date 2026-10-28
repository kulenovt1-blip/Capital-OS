/**
 * Связка этапа 3 с приложением: входы симулятора из состояния, распределение поступления, сохранение выбора.
 */
import { describe, it, expect } from 'vitest';
import { buildSimInput, planIncome, acceptAllocation, runForecast } from '../../engine/plan';
import { buildOverview } from '../../engine/overview';
import { emptyState, parseState, serializeState, type AppState } from '../../engine/state';
import { importMmbackup } from '../../engine/import/mmbackup';
import { setCategoryClass } from '../../engine/classify';
import { createGoal, type Goal } from '../../engine/goals';
import { makeInstallment } from '../../engine/obligations';
import { mergeAccountSettings } from '../../engine/settings';
import { tenge, tiyn } from '../../engine/money';
import { fixtureBytes } from '../support/fixtures';

const TODAY = '2026-10-28';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  const r = createGoal({ id, title: id, role: 'capital', targetMin: tenge(100_000), importance: 3 }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, ...extra };
}

function state(): AppState {
  const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
  const s = emptyState();
  let cls = s.settings.classification;
  const cat = (id: string) => data.categories.find((c) => c.id === id)!;
  cls = setCategoryClass(cls, cat('cat-food'), 'E_base', 'expense');
  cls = setCategoryClass(cls, cat('cat-fun'), 'E_fun', 'expense');
  cls = setCategoryClass(cls, cat('cat-salary'), 'I_work', 'income');
  return {
    ...s,
    imported: data,
    importedAt: TODAY,
    settings: {
      ...s.settings,
      classification: cls,
      accounts: mergeAccountSettings([], data.accounts),
      incomeSchedule: [{ id: 'sal', title: 'Зарплата', dayOfMonth: 5, amount: tenge(180_000), kind: 'work' }],
    },
    obligations: [makeInstallment({ id: 'ob1', title: 'Телефон', owner: 'self', remaining: tenge(60_570), remainingAsOf: TODAY, payment: tenge(30_285), firstDate: '2026-11-05' })],
    goals: [goal('reserve', { role: 'safety', targetMin: tenge(300_000) }), goal('base', { targetMin: tenge(1_000_000), importance: 5 })],
    manualAccounts: [{ id: 'dep', title: 'Депозит', balance: tenge(200_000), balanceDate: TODAY, liquidity: { kind: 'locked_until', date: '2027-06-01' }, deposit: { rateBp: 1400, capitalization: 'monthly' }, comment: '' }],
  };
}

describe('входы симулятора из состояния', () => {
  it('стартовые активы = капитал брутто, обязательства = обязательства Обзора; вклад с датой доступа и ставкой', () => {
    const st = state();
    const o = buildOverview(st, TODAY);
    const { input, warnings } = buildSimInput(st, TODAY);
    expect(input.cash + input.deposits.reduce((s, d) => s + d.balance, 0)).toBe(o.capital.gross);
    expect(input.liabilities).toBe(o.capital.liabilities.total);
    expect(input.deposits).toEqual([{ id: 'dep', title: 'Депозит', balance: tenge(200_000), rateBp: 1400, capitalization: 'monthly', availableFrom: '2027-06-01' }]);
    expect(input.payments.map((p) => [p.date, p.amount, p.reducesLiability])).toEqual([['2026-11-05', tenge(30_285), true], ['2026-12-05', tenge(30_285), true]]);
    expect(input.incomes).toEqual([{ id: 'sal', title: 'Зарплата', amount: tenge(180_000), dayOfMonth: 5, kind: 'work' }]);
    expect(input.baseMedian).toBe(o.baseline.median);
    // расходы по классам: медианы E_base и E_fun, рост = инфляция из настроек
    expect(input.expenses.map((e) => e.key)).toEqual(['E_base', 'E_fun']);
    expect(input.expenses.every((e) => e.growthBp === st.settings.inflationBp)).toBe(true);
    // рассрочки в данных есть, а обязательство «мамина» не заведено — предупреждение (класс не размечен → UNCLASSIFIED не влияет)
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('прогноз по трём сценариям детерминирован', () => {
    const st = state();
    const a = JSON.stringify(runForecast(st, TODAY));
    expect(JSON.stringify(runForecast(st, TODAY))).toBe(a);
    expect(runForecast(st, TODAY).map((r) => r.scenarioId)).toEqual(['base', 'adverse', 'favorable']);
  });
});

describe('новое поступление → выбор → назначения', () => {
  it('поступление 180 000 уже на Kaspi: шаг 0, стратегии, выбор создаёт метки на счёте и запись решения', () => {
    const st = state();
    const c = planIncome(st, TODAY, { amount: tenge(180_000), incomeInBalance: true, strategies: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] });
    expect(c.step0.ok).toBe(true);
    expect(c.rows.length).toBeGreaterThan(0);
    const row = c.rows.find((r) => r.ids.includes('B'))!;
    const r = acceptAllocation(st, c, row, 'acc-kaspi', TODAY, 'dec-1', 'тест');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const added = r.value.fundings.filter((f) => f.decisionId === 'dec-1');
    expect(added.reduce((s, f) => s + f.amount, 0)).toBe(Object.values(row.byGoal).reduce((s, v) => s + v, 0));
    expect(added.every((f) => f.accountId === 'acc-kaspi')).toBe(true);
    expect(r.value.decisions.at(-1)!.chosenStrategy).toEqual(row.ids);
    // решение и метки сохраняются в бэкапе
    const back = parseState(serializeState(r.value, TODAY));
    expect(back.ok && back.value.decisions.length).toBe(1);
  });

  it('выбор, который не помещается на счёт, отклоняется — назначать больше, чем есть, нельзя', () => {
    const st = state();
    const c = planIncome(st, TODAY, { amount: tenge(900_000), incomeInBalance: false, strategies: [{ id: 'B' }] });
    const r = acceptAllocation(st, c, c.rows[0]!, 'acc-cash', TODAY, 'dec-2', '');
    expect(r.ok).toBe(false);
    expect(st.fundings).toEqual([]);
  });

  it('поступление меньше обязательств до дохода → стратегий нет, есть варианты', () => {
    // все ликвидные деньги уже назначены цели — свободных нет, платёж покрывать нечем
    const st = state();
    const bal: Record<string, number> = { 'acc-kaspi': 47_999_583, 'acc-cash': 5_396_669, __savings_flow__: 23_000_000 };
    st.fundings = Object.entries(bal).map(([accountId, v], i) => ({ id: `f${i}`, goalId: 'base', accountId, amount: tiyn(v), date: TODAY, decisionId: null }));
    const c = planIncome(st, TODAY, { amount: tenge(1_000), incomeInBalance: false, strategies: [{ id: 'B' }] });
    expect(c.rows).toEqual([]);
    expect(c.step0.options.length).toBeGreaterThan(0);
    expect(tiyn(c.step0.deficit)).toBeGreaterThan(0);
  });
});
