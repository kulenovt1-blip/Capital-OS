/**
 * Цели в составе приложения: состояние, Обзор (свободные деньги с назначениями), экран «Цели».
 */
import { describe, it, expect } from 'vitest';
import { buildOverview } from '../../engine/overview';
import { buildGoalsView } from '../../engine/goals-view';
import { emptyState, parseState, serializeState, type AppState } from '../../engine/state';
import { importMmbackup } from '../../engine/import/mmbackup';
import { setCategoryClass } from '../../engine/classify';
import { createGoal, type Goal } from '../../engine/goals';
import { mergeAccountSettings } from '../../engine/settings';
import { median, tenge, tiyn, type Money } from '../../engine/money';
import { fixtureBytes } from '../support/fixtures';

const TODAY = '2026-10-28';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  const r = createGoal({ id, title: id, role: 'capital', targetMin: tenge(100_000), importance: 3 }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, ...extra };
}

function base(): AppState {
  const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
  const s = emptyState();
  const food = data.categories.find((c) => c.id === 'cat-food')!;
  return {
    ...s,
    imported: data,
    importedAt: TODAY,
    settings: { ...s.settings, accounts: mergeAccountSettings([], data.accounts), classification: setCategoryClass(s.settings.classification, food, 'E_base', 'expense') },
  };
}

describe('цели в состоянии и бэкапе', () => {
  it('goals и fundings сохраняются в JSON и проверяются', () => {
    const st = { ...emptyState(), goals: [goal('g')], fundings: [{ id: 'f', goalId: 'g', accountId: 'a', amount: tenge(5), date: TODAY, decisionId: null }] };
    const back = parseState(serializeState(st, TODAY));
    expect(back.ok && back.value.goals[0]!.id).toBe('g');
    const raw = JSON.parse(serializeState(st, TODAY));
    raw.state.fundings[0].amount = 1.5;
    expect(parseState(JSON.stringify(raw)).ok).toBe(false);
  });
  it('старый бэкап без целей читается с пустыми списками', () => {
    const raw = JSON.parse(serializeState(emptyState(), TODAY));
    delete raw.state.goals;
    delete raw.state.fundings;
    const back = parseState(JSON.stringify(raw));
    expect(back.ok && back.value.goals).toEqual([]);
  });
});

describe('Обзор с целями', () => {
  it('свободно = ликвидно − назначено целям на ликвидных счетах − резерв', () => {
    const st = { ...base(), goals: [goal('g')], fundings: [{ id: 'f', goalId: 'g', accountId: 'acc-kaspi', amount: tenge(100_000), date: TODAY, decisionId: null }] };
    const o = buildOverview(st, TODAY);
    expect(o.assigned).toBe(tenge(100_000));
    expect(o.freeMoney).toBe(tiyn(o.capital.liquidNow - tenge(100_000) - o.reserveUntilIncome));
  });

  it('назначено больше, чем есть на счёте → уведомление-ошибка с вариантами; назначения не тронуты', () => {
    const st = { ...base(), goals: [goal('g')], fundings: [{ id: 'f', goalId: 'g', accountId: 'acc-cash', amount: tenge(60_000), date: TODAY, decisionId: null }] };
    const o = buildOverview(st, TODAY);
    const n = o.notices.find((x) => x.code === 'goals.over_assigned')!;
    expect(n.level).toBe('error');
    expect(n.text).toMatch(/Наличные/);
    expect(st.fundings[0]!.amount).toBe(tenge(60_000));
  });

  it('достигнутая цель → информационное уведомление, статус не меняется', () => {
    const st = { ...base(), goals: [goal('g', { targetMin: tenge(1_000) })], fundings: [{ id: 'f', goalId: 'g', accountId: 'acc-kaspi', amount: tenge(1_000), date: TODAY, decisionId: null }] };
    const o = buildOverview(st, TODAY);
    expect(o.notices.find((x) => x.code === 'goal.achieved')!.level).toBe('info');
  });
});

describe('экран «Цели»', () => {
  it('резерв по правилу: 3 × медиана «Продуктов» (E_base) за апрель–сентябрь 2026', () => {
    const st = base();
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const perMonth = months.map((m) => tiyn(st.imported!.operations.filter((op) => op.kind === 'expense' && op.categoryId === 'cat-food' && op.date.startsWith(m)).reduce((s, op) => s + (op.kind === 'expense' ? op.amount : 0), 0)));
    const expected = tiyn(median(perMonth as Money[]) * 3);
    st.goals = [goal('reserve', { role: 'safety', targetMin: tiyn(1), targetRule: { kind: 'months_of_base' } })];
    const v = buildGoalsView(st, TODAY);
    expect(v.baseline.median).toBe(median(perMonth as Money[]));
    expect(v.tree[0]!.goal.targetMin).toBe(expected);
    expect(v.explanation.some((s) => s.code === 'goal.target.rule')).toBe(true);
  });

  it('балансы для назначения — по неисключённым счетам; свободно на счёте = баланс − назначено', () => {
    const st = { ...base(), goals: [goal('g')], fundings: [{ id: 'f', goalId: 'g', accountId: 'acc-kaspi', amount: tenge(100_000), date: TODAY, decisionId: null }] };
    const v = buildGoalsView(st, TODAY);
    expect(v.balances['acc-tech']).toBeUndefined();
    const k = v.accounts.find((a) => a.accountId === 'acc-kaspi')!;
    expect(k.free).toBe(tiyn(k.balance - tenge(100_000)));
  });
});
