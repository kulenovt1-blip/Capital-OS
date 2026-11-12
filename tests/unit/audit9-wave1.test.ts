/**
 * Аудит 9, этап 1 (DECISIONS D171–D172): долговая нагрузка без дохода; одна подушка — свободные деньги копилок
 * засчитываются ей сами; «Пришли деньги» считает поступление после них.
 */
import { describe, it, expect } from 'vitest';
import { flattenTree, assignMoney, createGoal, withoutAuto, AUTO_CUSHION_PREFIX, type Goal } from '../../engine/goals';
import { buildOverview } from '../../engine/overview';
import { splitIncome } from '../../engine/simple';
import { mergeAccountSettings, type AccountSettings } from '../../engine/settings';
import { emptyState, type AppState } from '../../engine/state';
import { tenge } from '../../engine/money';
import { acc, dataset, inc, trf } from '../support/build';

const TODAY = '2026-10-28';

function goal(id: string, role: Goal['role'], target: number, extra: Partial<Goal> = {}): Goal {
  const r = createGoal({ id, title: id, role, targetMin: tenge(target), importance: 3, ...extra }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, ...extra };
}

/** Карта 400 000 и копилка 200 000 без привязки к целям; подушка 150 000, цель «trip» 60 000 к марту. */
function world(): AppState {
  const data = dataset({
    accounts: [acc('card', 'Kaspi'), acc('stash', 'Копилка')],
    categories: [],
    operations: [inc('2026-01-01', 'card', 600_000, null), trf('2026-02-01', 'card', 'stash', 200_000)],
  });
  const s = emptyState();
  const accounts = mergeAccountSettings([], data.accounts).map((a): AccountSettings => (a.accountId === 'stash' ? { ...a, kind: 'savings', reviewed: true } : a));
  return {
    ...s,
    imported: data,
    importedAt: TODAY,
    settings: { ...s.settings, accounts, incomeSchedule: [{ id: 'sal', title: 'Зарплата', dayOfMonth: 5, amount: tenge(200_000), kind: 'work' }] },
    goals: [goal('reserve', 'safety', 150_000, { order: 0 }), goal('trip', 'capital', 60_000, { order: 1, deadline: '2027-03-01' })],
  };
}

describe('D172: одна подушка', () => {
  it('свободные деньги копилки засчитываются подушке сами; в сохранённых метках их нет', () => {
    const st = world();
    const o = buildOverview(st, TODAY);
    const cushion = flattenTree(o.goalTree).find((n) => n.goal.id === 'reserve')!;
    expect(cushion.progress).toBe(tenge(150_000));
    expect(o.fundings.filter((f) => f.id.startsWith(AUTO_CUSHION_PREFIX)).map((f) => f.accountId)).toEqual(['stash']);
    expect(st.fundings).toEqual([]);
  });

  it('подушка не берёт больше, чем ей нужно, и явная метка забирает деньги у автоматической', () => {
    const st = world();
    const o = buildOverview(st, TODAY);
    // свободно на копилке 200 000: подушке 150 000 автоматически, но назначить 100 000 на цель можно — автоматическая часть не в счёт
    const r = assignMoney({ id: 'x', goalId: 'trip', accountId: 'stash', amount: tenge(100_000), date: TODAY, decisionId: null }, { goals: o.goals, fundings: withoutAuto(o.fundings), balances: o.balances });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = buildOverview({ ...st, fundings: [r.value] }, TODAY);
    const cushion = flattenTree(after.goalTree).find((n) => n.goal.id === 'reserve')!;
    expect(cushion.progress).toBe(tenge(100_000)); // осталось свободных 100 000
  });
});

describe('D172: «Пришли деньги» после копилок', () => {
  it('подушка закрыта деньгами копилки — поступление идёт целям со сроком, а не в подушку', () => {
    const sp = splitIncome(world(), TODAY, tenge(50_000), true);
    expect(sp.lines.find((l) => l.goalId === 'reserve')?.amount ?? 0).toBe(0);
    expect(sp.lines.find((l) => l.goalId === 'trip')!.amount).toBeGreaterThan(0);
    expect(sp.setAside).toBeLessThanOrEqual(tenge(50_000));
  });
});
