/**
 * Деньги целей-обязательств покрывают платёж, только если их можно снять к дате платежа (D92, аудит №2, п. 1).
 * Правило: деньги на счёте с availableFrom позже даты платежа этот платёж не оплатят, сколько бы их ни было.
 */
import { describe, it, expect } from 'vitest';
import { planIncome } from '../../engine/plan';
import { coverByAvailableFunds } from '../../engine/ladder';
import { emptyState, type AppState } from '../../engine/state';
import { importMmbackup } from '../../engine/import/mmbackup';
import { setCategoryClass } from '../../engine/classify';
import { createGoal, type Goal } from '../../engine/goals';
import { makeInstallment } from '../../engine/obligations';
import { mergeAccountSettings } from '../../engine/settings';
import { tenge, tiyn } from '../../engine/money';
import { fixtureBytes } from '../support/fixtures';

const TODAY = '2026-10-28';
const PAY = tenge(30_285);

describe('покрытие платежей деньгами, доступными к дате', () => {
  it('доступно раньше платежа — покрывает; позже — нет, и это объясняется', () => {
    const r = coverByAvailableFunds(
      [{ date: '2026-11-01', amount: tenge(10_000) }, { date: '2026-11-20', amount: tenge(10_000) }],
      [{ amount: tenge(15_000), availableFrom: '2026-11-10' }],
    );
    // 01.11 — деньги ещё нельзя снять; 20.11 — можно, покрыто 10 000
    expect(r.covered).toBe(tenge(10_000));
    expect(r.notYetAvailable).toEqual([{ date: '2026-11-01', amount: tenge(10_000), availableFrom: '2026-11-10' }]);
  });

  it('сумма покрытия не больше платежей и не больше денег', () => {
    const r = coverByAvailableFunds([{ date: '2026-11-05', amount: tenge(5_000) }], [{ amount: tenge(3_000), availableFrom: '2026-10-28' }, { amount: tenge(9_000), availableFrom: '2026-10-28' }]);
    expect(r.covered).toBe(tenge(5_000));
    expect(r.notYetAvailable).toEqual([]);
  });

  it('доступно в сам день платежа — покрывает', () => {
    expect(coverByAvailableFunds([{ date: '2026-11-05', amount: tenge(1_000) }], [{ amount: tenge(1_000), availableFrom: '2026-11-05' }]).covered).toBe(tenge(1_000));
  });
});

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  const r = createGoal({ id, title: id, role: 'capital', targetMin: tenge(100_000), importance: 3 }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, ...extra };
}

/** Все ликвидные деньги закреплены за «base» (свободных нет), кроме денег цели-обязательства на указанном счёте. */
function state(obligationFundAccount: 'dep' | 'acc-kaspi'): AppState {
  const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
  const s = emptyState();
  let cls = s.settings.classification;
  const cat = (id: string) => data.categories.find((c) => c.id === id)!;
  cls = setCategoryClass(cls, cat('cat-food'), 'E_base', 'expense');
  cls = setCategoryClass(cls, cat('cat-salary'), 'I_work', 'income');
  const bal: Record<string, number> = { 'acc-kaspi': 47_999_583, 'acc-cash': 5_396_669, __savings_flow__: 23_000_000 };
  if (obligationFundAccount === 'acc-kaspi') bal['acc-kaspi']! -= PAY;
  const fundings = Object.entries(bal).map(([accountId, v], i) => ({ id: `f${i}`, goalId: 'base', accountId, amount: tiyn(v), date: TODAY, decisionId: null }));
  fundings.push({ id: 'f-ob', goalId: 'phone', accountId: obligationFundAccount, amount: PAY, date: TODAY, decisionId: null });
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
    obligations: [makeInstallment({ id: 'ob1', title: 'Телефон', owner: 'self', remaining: tenge(60_570), remainingAsOf: TODAY, payment: PAY, firstDate: '2026-11-05' })],
    goals: [goal('base', { targetMin: tenge(1_000_000) }), goal('phone', { role: 'obligation', targetMin: PAY })],
    manualAccounts: [{ id: 'dep', title: 'Депозит', balance: tenge(200_000), balanceDate: TODAY, liquidity: { kind: 'locked_until', date: '2027-06-01' }, deposit: { rateBp: 1400, capitalization: 'monthly' }, comment: '' }],
    fundings,
  };
}

const run = (st: AppState) => planIncome(st, TODAY, { amount: tenge(180_000), incomeInBalance: false, strategies: [{ id: 'B' }] }).step0;

describe('распределение дохода: деньги цели-обязательства на вкладе', () => {
  it('деньги на карте покрывают платёж 05.11', () => {
    const s0 = run(state('acc-kaspi'));
    expect(s0.R1).toBe(PAY);
    expect(s0.R1uncovered).toBe(tiyn(0));
  });

  it('деньги на вкладе до 01.06.2027 платёж 05.11.2026 не покрывают — его закрывает доход, и это сказано', () => {
    const s0 = run(state('dep'));
    expect(s0.R1).toBe(PAY);
    expect(s0.R1uncovered).toBe(PAY);
    expect(s0.explanation.some((e) => e.code === 'step0.r1_goals_locked')).toBe(true);
    // «Можно распределить» меньше на сумму платежа, чем если бы деньги были на карте
    expect(run(state('acc-kaspi')).available - s0.available).toBe(PAY);
  });
});
