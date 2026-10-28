/**
 * Интерфейс должен объяснять сам (пособие, раздел 7): шаги настройки, у каждого предупреждения — куда идти исправлять,
 * все счета с причиной недоступности, удаление одной цели. Ожидания записаны до реализации.
 */
import { describe, it, expect } from 'vitest';
import { setupSteps, setupProgress } from '../../engine/setup';
import { buildOverview, noticeAction } from '../../engine/overview';
import { buildGoalsView } from '../../engine/goals-view';
import { createGoal, deleteGoal, type Goal } from '../../engine/goals';
import { emptyState, parseState, serializeState, type AppState } from '../../engine/state';
import { importMmbackup } from '../../engine/import/mmbackup';
import { setCategoryClass, type OpClass } from '../../engine/classify';
import { mergeAccountSettings } from '../../engine/settings';
import { makeInstallment } from '../../engine/obligations';
import { tenge } from '../../engine/money';
import { fixtureBytes } from '../support/fixtures';

const TODAY = '2026-10-28';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  const r = createGoal({ id, title: id, role: 'capital', targetMin: tenge(100_000), importance: 3 }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, ...extra };
}

function imported(): AppState {
  const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
  const s = emptyState();
  return { ...s, imported: data, importedAt: TODAY, settings: { ...s.settings, accounts: mergeAccountSettings([], data.accounts) } };
}

/** Состояние, где сделано всё: разметка, ответы о счетах, доходы, накопления, рассрочка, цели, бэкап. */
function complete(): AppState {
  const st = imported();
  let cls = st.settings.classification;
  const map: Record<string, [OpClass, 'income' | 'expense']> = {
    'cat-food': ['E_base', 'expense'], 'cat-transport': ['E_base', 'expense'], 'cat-phone': ['E_base', 'expense'], 'cat-fun': ['E_fun', 'expense'],
    'cat-family': ['E_family', 'expense'], 'cat-fee': ['E_other', 'expense'], 'cat-old': ['E_other', 'expense'], 'cat-salary': ['I_work', 'income'], 'cat-stipend': ['I_stipend', 'income'],
  };
  for (const [id, [c, k]] of Object.entries(map)) cls = setCategoryClass(cls, st.imported!.categories.find((x) => x.id === id)!, c, k);
  st.settings.classification = cls;
  st.settings.accounts = st.settings.accounts.map((a) => (a.accountId === 'acc-tech' ? { ...a, excluded: true, reviewed: true } : a));
  st.settings.incomeSchedule = [{ id: 'sal', title: 'Зарплата', dayOfMonth: 5, amount: tenge(180_000), kind: 'work' }];
  st.settings.savingsFlows = { mode: 'estimate', confirmed: true };
  // обе рассрочки из операций заведены (с D67 незаведённая рассрочка держит шаг открытым)
  st.obligations = [
    makeInstallment({ id: 'ob', title: 'Телефон', owner: 'self', remaining: tenge(60_570), remainingAsOf: TODAY, payment: tenge(30_285), firstDate: '2026-11-05', match: { tags: ['телефон'] } }),
    makeInstallment({ id: 'ob-mom', title: 'Мама', owner: 'family', remaining: tenge(30_000), remainingAsOf: TODAY, payment: tenge(15_000), firstDate: '2026-11-15', match: { tags: ['мама'], categoryIds: ['cat-installment'] } }),
  ];
  st.goals = [goal('reserve', { role: 'safety', targetMin: tenge(300_000) })];
  st.lastBackupAt = '2026-10-20';
  return st;
}

describe('шаги настройки', () => {
  it('пустое состояние: первый шаг — импорт, он не сделан и ведёт на экран «Импорт»', () => {
    const steps = setupSteps(emptyState(), TODAY);
    expect(steps[0]).toMatchObject({ id: 'import', done: false, action: { route: 'import' } });
    expect(setupProgress(steps)).toEqual({ done: 0, total: steps.filter((s) => !s.optional).length });
  });

  it('после импорта: импорт сделан; не сделаны ответ о счетах, разметка, доходы, накопления, цели', () => {
    const steps = setupSteps(imported(), TODAY);
    const done = Object.fromEntries(steps.map((s) => [s.id, s.done]));
    expect(done).toMatchObject({ import: true, accounts: false, classes: false, income: false, savings: false, goals: false });
    expect(steps.find((s) => s.id === 'accounts')!.action).toEqual({ route: 'import', section: 'review', label: expect.any(String) });
    expect(steps.find((s) => s.id === 'savings')!.action).toMatchObject({ route: 'settings', section: 'savings' });
    // в синтетике долг «взял 5 000, вернул 3 000» — отрицательных долгов нет, шаг не нужен
    expect(steps.some((s) => s.id === 'debts')).toBe(false);
  });

  it('всё сделано: обязательные шаги закрыты', () => {
    const steps = setupSteps(complete(), TODAY);
    expect(steps.filter((s) => !s.done).map((s) => s.id)).toEqual([]);
    const p = setupProgress(steps);
    expect(p.done).toBe(p.total);
  });

  it('бэкап старше 30 дней — необязательный шаг снова не сделан', () => {
    const st = { ...complete(), lastBackupAt: '2026-09-01' };
    const b = setupSteps(st, TODAY).find((s) => s.id === 'backup')!;
    expect(b).toMatchObject({ done: false, optional: true });
  });

  it('цель с неподтверждённой нулевой суммой держит шаг «Цели» открытым', () => {
    const st = complete();
    st.goals = [...st.goals, goal('move', { targetMin: tenge(0), unconfirmed: true })];
    expect(setupSteps(st, TODAY).find((s) => s.id === 'goals')!.done).toBe(false);
  });

  it('отрицательный долг в данных — появляется шаг «Долги на начало учёта»; после ввода суммы он закрыт', () => {
    const st = complete();
    st.imported = { ...st.imported!, operations: st.imported!.operations.filter((o) => !(o.kind === 'income' && o.categoryId === 'cat-borrow')) };
    const before = setupSteps(st, TODAY).find((s) => s.id === 'debts')!;
    expect(before).toMatchObject({ done: false, action: { route: 'settings', section: 'debts' } });
    st.settings.openingDebts = { receivable: tenge(0), payable: tenge(3_000) };
    expect(setupSteps(st, TODAY).find((s) => s.id === 'debts')!.done).toBe(true);
  });

  it('lastBackupAt проходит через JSON-бэкап; старый бэкап без поля читается', () => {
    const back = parseState(serializeState(complete(), TODAY));
    expect(back.ok && back.value.lastBackupAt).toBe('2026-10-20');
    const raw = JSON.parse(serializeState(emptyState(), TODAY));
    delete raw.state.lastBackupAt;
    const old = parseState(JSON.stringify(raw));
    expect(old.ok && old.value.lastBackupAt).toBe(null);
  });
});

describe('у предупреждений есть «куда идти исправлять»', () => {
  it('каждое предупреждение «Обзора» несёт действие', () => {
    const st = imported();
    st.goals = [goal('g')];
    st.fundings = [{ id: 'f', goalId: 'g', accountId: 'acc-cash', amount: tenge(60_000), date: TODAY, decisionId: null }];
    const o = buildOverview(st, TODAY);
    const codes = o.notices.map((n) => n.code);
    expect(codes).toEqual(expect.arrayContaining(['accounts.review', 'unclassified', 'capital.savings_flow', 'goals.over_assigned']));
    for (const n of o.notices) expect(n.action, n.code).toBeDefined();
  });
  it('карта действий: накопления → настройки накоплений, долги → долги на начало, неразмеченное → классы', () => {
    expect(noticeAction('capital.savings_flow')).toMatchObject({ route: 'settings', section: 'savings' });
    expect(noticeAction('capital.payables_negative')).toMatchObject({ route: 'settings', section: 'debts' });
    expect(noticeAction('capital.receivables_negative')).toMatchObject({ route: 'settings', section: 'debts' });
    expect(noticeAction('unclassified')).toMatchObject({ route: 'classes' });
    expect(noticeAction('accounts.review')).toMatchObject({ route: 'import', section: 'review' });
    expect(noticeAction('goals.over_assigned')).toMatchObject({ route: 'goals' });
  });
  it('подсказка про оценку накоплений ведёт к настройке, а не к «заведи ручной счёт»', () => {
    const o = buildOverview(imported(), TODAY);
    const n = o.notices.find((x) => x.code === 'capital.savings_flow')!;
    expect(n.text).toMatch(/Куда уходили переводы/);
    expect(n.text).not.toMatch(/заведи ручной сч[её]т с реальным остатком$/);
  });
});

describe('все счета с причиной, почему на них нельзя назначить', () => {
  it('статус и причина для каждого неудалённого счёта', () => {
    const st = imported();
    st.goals = [goal('g'), goal('res', { role: 'safety' })];
    st.settings.accounts = st.settings.accounts.map((a) => (a.accountId === 'acc-cash' ? { ...a, boundGoalId: 'res', reviewed: true } : a));
    st.fundings = [{ id: 'f', goalId: 'g', accountId: 'acc-halyk', amount: tenge(0), date: TODAY, decisionId: null }];
    const v = buildGoalsView(st, TODAY);
    const s = Object.fromEntries(v.allAccounts.map((a) => [a.accountId, a.status]));
    expect(s['acc-kaspi']).toBe('available');
    expect(s['acc-cash']).toBe('bound');
    expect(s['acc-halyk']).toBe('empty');
    expect(s['acc-tech']).toBe('needs_review');
    for (const a of v.allAccounts) if (a.status !== 'available') expect(a.reason.length, a.accountId).toBeGreaterThan(5);
    expect(v.allAccounts.find((a) => a.accountId === 'acc-cash')!.reason).toMatch(/res/);
  });
  it('исключённый после ответа — «исключён»; полностью назначенный — «всё назначено»', () => {
    const st = imported();
    st.goals = [goal('g', { targetMin: tenge(1_000_000) })];
    st.settings.accounts = st.settings.accounts.map((a) => (a.accountId === 'acc-tech' ? { ...a, excluded: true, reviewed: true } : a));
    st.fundings = [{ id: 'f', goalId: 'g', accountId: 'acc-cash', amount: tenge(53_966) + 69, date: TODAY, decisionId: null } as never];
    const v = buildGoalsView(st, TODAY);
    const s = Object.fromEntries(v.allAccounts.map((a) => [a.accountId, a.status]));
    expect(s['acc-tech']).toBe('excluded');
    expect(s['acc-cash']).toBe('fully_assigned');
  });
});

describe('удаление одной цели', () => {
  const g1 = goal('a');
  const parent = goal('p');
  const child = goal('c', { parentId: 'p' });
  it('пустую цель без подцелей можно удалить; её нулевые записи назначений и ссылки других целей убираются', () => {
    const other = goal('o', { competesWith: ['a'], dependsOn: ['a'] });
    const fundings = [
      { id: 'f1', goalId: 'a', accountId: 'k', amount: tenge(5_000), date: TODAY, decisionId: null },
      { id: 'f2', goalId: 'a', accountId: 'k', amount: tenge(-5_000), date: TODAY, decisionId: null },
    ];
    const r = deleteGoal('a', { goals: [g1, other], fundings, accounts: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.goals.map((g) => g.id)).toEqual(['o']);
    expect(r.value.goals[0]!.competesWith).toEqual([]);
    expect(r.value.goals[0]!.dependsOn).toEqual([]);
    expect(r.value.fundings).toEqual([]);
  });
  it('нельзя удалить цель с деньгами, с подцелями или с привязанным счётом — с объяснением', () => {
    const withMoney = deleteGoal('a', { goals: [g1], fundings: [{ id: 'f', goalId: 'a', accountId: 'k', amount: tenge(1), date: TODAY, decisionId: null }], accounts: [] });
    expect(withMoney.ok).toBe(false);
    if (!withMoney.ok) expect(withMoney.error).toMatch(/сними/i);
    const withKids = deleteGoal('p', { goals: [parent, child], fundings: [], accounts: [] });
    expect(withKids.ok).toBe(false);
    if (!withKids.ok) expect(withKids.error).toMatch(/подцел/i);
    const bound = deleteGoal('a', { goals: [g1], fundings: [], accounts: [{ accountId: 'k', excluded: false, liquidity: { kind: 'instant' }, boundGoalId: 'a' }] });
    expect(bound.ok).toBe(false);
    if (!bound.ok) expect(bound.error).toMatch(/привяз/i);
  });
});
