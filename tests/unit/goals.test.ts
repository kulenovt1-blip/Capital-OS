/**
 * Цели (§4): модель, дерево, назначение денег без двойного учёта, история изменений.
 * Ожидаемые значения записаны до реализации.
 */
import { describe, it, expect } from 'vitest';
import {
  createGoal, updateGoal, changeStatus, horizonOf, validateGoal, goalTree, assignMoney, withdrawMoney, moveFunding,
  overAssignment, freeMoney, resolveGoalTargets, exampleGoals, balancesFromPositions,
  type Goal, type GoalFunding, type GoalInput,
} from '../../engine/goals';
import { tenge, tiyn, type Money } from '../../engine/money';
import type { AccountPosition } from '../../engine/ledger';

const TODAY = '2026-10-28';
const H: [number, number, number] = [3, 12, 36];

function mk(id: string, extra: Partial<GoalInput> = {}): Goal {
  // родитель проверяется в validateGoal отдельно; здесь подцель собирается без списка целей
  const { parentId, ...rest } = extra;
  const r = createGoal({ id, title: id, role: 'capital', targetMin: tenge(100_000), importance: 3, ...rest }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return parentId === undefined ? r.value : { ...r.value, parentId };
}

const pos = (accountId: string, balance: number, liquidity: AccountPosition['liquidity'] = { kind: 'instant' }, excluded = false): AccountPosition => ({
  accountId, title: accountId, source: 'moneymanager', balance: tenge(balance), excluded, liquidity,
  availableFrom: liquidity.kind === 'locked_until' && liquidity.date > TODAY ? liquidity.date : TODAY,
});

describe('модель цели', () => {
  it('createGoal ставит дефолты и пишет в историю «создана»', () => {
    const g = mk('g1');
    expect(g.status).toBe('active');
    expect(g.flexibility).toBe('flexible');
    expect(g.dependsOn).toEqual([]);
    expect(g.history).toEqual([{ date: TODAY, field: 'created', from: null, to: 'g1', reason: 'создана' }]);
  });

  it('горизонт вычисляется из срока (deadline, иначе desiredDate) и может быть переопределён', () => {
    expect(horizonOf(mk('a', { deadline: '2027-01-15' }), TODAY, H)).toBe('small'); // 3 мес.
    expect(horizonOf(mk('b', { desiredDate: '2027-09-01' }), TODAY, H)).toBe('medium'); // 11 мес.
    expect(horizonOf(mk('c', { deadline: '2029-01-01' }), TODAY, H)).toBe('long'); // 27 мес.
    expect(horizonOf(mk('d', { deadline: '2031-01-01' }), TODAY, H)).toBe('major');
    expect(horizonOf(mk('e'), TODAY, H)).toBe('major');
    expect(horizonOf(mk('f', { deadline: '2027-01-15', horizon: 'long' }), TODAY, H)).toBe('long');
  });

  it('валидация: сумма > 0, важность 1..5, родитель существует, без циклов, comfort ≥ min, desired ≤ deadline', () => {
    const p = mk('p');
    expect(validateGoal({ ...mk('x'), targetMin: tiyn(0) }, [p])).toContain('Минимальная сумма цели должна быть больше нуля');
    expect(validateGoal({ ...mk('x'), importance: 7 as Goal['importance'] }, [p]).join()).toMatch(/Важность/);
    expect(validateGoal({ ...mk('x'), parentId: 'nope' }, [p]).join()).toMatch(/Родительская цель не найдена/);
    const a = { ...mk('a'), parentId: 'b' };
    const b = { ...mk('b'), parentId: 'a' };
    expect(validateGoal(a, [a, b]).join()).toMatch(/цикл/);
    expect(validateGoal({ ...mk('x'), targetComfort: tenge(50_000) }, []).join()).toMatch(/Комфортная/);
    expect(validateGoal({ ...mk('x'), desiredDate: '2027-05-01', deadline: '2027-01-01' }, []).join()).toMatch(/Желаемая дата/);
    expect(validateGoal(mk('ok', { parentId: 'p' }), [p])).toEqual([]);
  });

  it('updateGoal: без причины не меняет; с причиной пишет каждое поле в историю (старое → новое)', () => {
    const g = mk('g', { importance: 3 });
    expect(updateGoal(g, { importance: 5 }, '  ', TODAY, [g]).ok).toBe(false);
    const r = updateGoal(g, { importance: 5, targetMin: tenge(120_000), title: 'g' }, 'передумал', '2026-11-01', [g]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.importance).toBe(5);
    expect(r.value.history.slice(1)).toEqual([
      { date: '2026-11-01', field: 'importance', from: 3, to: 5, reason: 'передумал' },
      { date: '2026-11-01', field: 'targetMin', from: tenge(100_000), to: tenge(120_000), reason: 'передумал' },
    ]);
  });
});

describe('назначение денег («конверты»)', () => {
  const goals = [mk('parent'), mk('child1', { parentId: 'parent' }), mk('child2', { parentId: 'parent' }), mk('solo')];
  const balances = { kaspi: tenge(150_000), dep: tenge(50_000) };
  const ctx = (fundings: GoalFunding[]) => ({ goals, fundings, balances });

  it('назначить можно не больше свободного остатка счёта (инвариант 1)', () => {
    const f1 = assignMoney({ id: 'f1', goalId: 'child1', accountId: 'kaspi', amount: tenge(100_000), date: TODAY, decisionId: null }, ctx([]));
    expect(f1.ok).toBe(true);
    if (!f1.ok) return;
    const f2 = assignMoney({ id: 'f2', goalId: 'solo', accountId: 'kaspi', amount: tenge(60_000), date: TODAY, decisionId: null }, ctx([f1.value]));
    expect(f2.ok).toBe(false);
    if (!f2.ok) expect(f2.error).toMatch(/свободно на счёте 50\s000/);
    const f3 = assignMoney({ id: 'f3', goalId: 'solo', accountId: 'kaspi', amount: tenge(50_000), date: TODAY, decisionId: null }, ctx([f1.value]));
    expect(f3.ok).toBe(true);
  });

  it('нельзя назначить на неизвестный/исключённый счёт, отрицательную сумму, отменённую или выполненную цель', () => {
    expect(assignMoney({ id: 'x', goalId: 'solo', accountId: 'nope', amount: tenge(1), date: TODAY, decisionId: null }, ctx([])).ok).toBe(false);
    expect(assignMoney({ id: 'x', goalId: 'solo', accountId: 'kaspi', amount: tenge(-1), date: TODAY, decisionId: null }, ctx([])).ok).toBe(false);
    const cancelled = { ...mk('c'), status: 'cancelled' as const };
    expect(assignMoney({ id: 'x', goalId: 'c', accountId: 'kaspi', amount: tenge(1), date: TODAY, decisionId: null }, { goals: [cancelled], fundings: [], balances }).ok).toBe(false);
  });

  it('прогресс родителя = Σ подцелей + назначенное напрямую; каждый тенге посчитан один раз (инвариант 2)', () => {
    const fs: GoalFunding[] = [
      { id: 'a', goalId: 'child1', accountId: 'kaspi', amount: tenge(30_000), date: TODAY, decisionId: null },
      { id: 'b', goalId: 'child2', accountId: 'dep', amount: tenge(20_000), date: TODAY, decisionId: null },
      { id: 'c', goalId: 'parent', accountId: 'kaspi', amount: tenge(5_000), date: TODAY, decisionId: null },
      { id: 'd', goalId: 'solo', accountId: 'kaspi', amount: tenge(10_000), date: TODAY, decisionId: null },
    ];
    const tree = goalTree(goals, fs, TODAY, H);
    const parent = tree.find((n) => n.goal.id === 'parent')!;
    expect(parent.direct).toBe(tenge(5_000));
    expect(parent.progress).toBe(tenge(55_000));
    expect(parent.children.map((c) => c.progress)).toEqual([tenge(30_000), tenge(20_000)]);
    // сумма прогресса корней = сумма всех назначений: двойного учёта нет
    expect(tree.reduce((s, n) => s + n.progress, 0)).toBe(tenge(65_000));
    expect(parent.pctPermille).toBe(550);
  });

  it('снять можно не больше назначенного на этой цели и этом счёте', () => {
    const f: GoalFunding = { id: 'a', goalId: 'solo', accountId: 'kaspi', amount: tenge(30_000), date: TODAY, decisionId: null };
    expect(withdrawMoney({ id: 'w', goalId: 'solo', accountId: 'kaspi', amount: tenge(40_000), date: TODAY, decisionId: null }, ctx([f])).ok).toBe(false);
    const w = withdrawMoney({ id: 'w', goalId: 'solo', accountId: 'kaspi', amount: tenge(10_000), date: TODAY, decisionId: null }, ctx([f]));
    expect(w.ok && w.value.amount).toBe(tenge(-10_000));
  });

  it('перенос назначения на другой счёт — две записи, сумма по цели не меняется; на целевом счёте нужно место', () => {
    const f: GoalFunding = { id: 'a', goalId: 'solo', accountId: 'kaspi', amount: tenge(30_000), date: TODAY, decisionId: null };
    const ok = moveFunding({ id: 'm', goalId: 'solo', fromAccountId: 'kaspi', toAccountId: 'dep', amount: tenge(30_000), date: TODAY, decisionId: null }, ctx([f]));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.map((x) => [x.accountId, x.amount])).toEqual([['kaspi', tenge(-30_000)], ['dep', tenge(30_000)]]);
    const tooMuch = moveFunding({ id: 'm', goalId: 'solo', fromAccountId: 'kaspi', toAccountId: 'dep', amount: tenge(60_000), date: TODAY, decisionId: null }, ctx([{ ...f, amount: tenge(60_000) }]));
    expect(tooMuch.ok).toBe(false);
  });
});

describe('«назначено больше, чем есть»', () => {
  it('после трат система не урезает цели молча, а предлагает варианты: сначала менее важные, затем по id', () => {
    const goals = [mk('big', { importance: 5 }), mk('low-b', { importance: 1 }), mk('low-a', { importance: 1 })];
    const fs: GoalFunding[] = [
      { id: '1', goalId: 'big', accountId: 'kaspi', amount: tenge(50_000), date: TODAY, decisionId: null },
      { id: '2', goalId: 'low-b', accountId: 'kaspi', amount: tenge(20_000), date: TODAY, decisionId: null },
      { id: '3', goalId: 'low-a', accountId: 'kaspi', amount: tenge(10_000), date: TODAY, decisionId: null },
    ];
    // баланс упал до 60 000 — назначено 80 000
    const r = overAssignment(fs, { kaspi: tenge(60_000) }, goals);
    expect(r).toHaveLength(1);
    expect(r[0]!.shortfall).toBe(tenge(20_000));
    expect(r[0]!.options.map((o) => [o.goalId, o.amount])).toEqual([['low-a', tenge(10_000)], ['low-b', tenge(20_000)], ['big', tenge(20_000)]]);
    // назначения не изменились
    expect(fs.map((f) => f.amount)).toEqual([tenge(50_000), tenge(20_000), tenge(10_000)]);
  });

  it('счёт, которого больше нет (или исключён), — всё назначенное на нём считается превышением', () => {
    const r = overAssignment([{ id: '1', goalId: 'g', accountId: 'gone', amount: tenge(5_000), date: TODAY, decisionId: null }], {}, [mk('g')]);
    expect(r[0]!.shortfall).toBe(tenge(5_000));
  });
});

describe('свободные деньги (§4.2 п.3, DECISIONS D21)', () => {
  it('Σ по ликвидным счетам (баланс − назначено) − резерв; назначенное на заблокированном депозите не вычитается из ликвидных', () => {
    const positions = [pos('kaspi', 150_000), pos('cash', 20_000), pos('dep', 300_000, { kind: 'locked_until', date: '2027-03-01' }), pos('tech', 9_999, { kind: 'instant' }, true)];
    const fs: GoalFunding[] = [
      { id: '1', goalId: 'g', accountId: 'kaspi', amount: tenge(100_000), date: TODAY, decisionId: null },
      { id: '2', goalId: 'g', accountId: 'dep', amount: tenge(300_000), date: TODAY, decisionId: null },
    ];
    const r = freeMoney(positions, fs, tenge(30_285), TODAY);
    // (150 000 − 100 000) + 20 000 − 30 285
    expect(r.result.free).toBe(tenge(39_715));
    expect(r.result.assignedLiquid).toBe(tenge(100_000));
    expect(r.explanation.length).toBeGreaterThan(0);
  });

  it('balancesFromPositions берёт только неисключённые счета', () => {
    expect(balancesFromPositions([pos('a', 1), pos('t', 2, { kind: 'instant' }, true)])).toEqual({ a: tenge(1) });
  });
});

describe('статусы целей (DECISIONS D25)', () => {
  const g = mk('g');
  const child = mk('ch', { parentId: 'g' });
  it('нельзя отменить или завершить цель, пока на ней (или подцелях) есть деньги — предлагается снять', () => {
    const fs: GoalFunding[] = [{ id: '1', goalId: 'ch', accountId: 'kaspi', amount: tenge(1_000), date: TODAY, decisionId: null }];
    const r = changeStatus(g, 'cancelled', 'не нужна', TODAY, { goals: [g, child], fundings: fs });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1\s000/);
  });
  it('без денег — меняется, с причиной и записью в историю; пауза разрешена с деньгами', () => {
    const r = changeStatus(g, 'cancelled', 'не нужна', TODAY, { goals: [g], fundings: [] });
    expect(r.ok && r.value.status).toBe('cancelled');
    if (r.ok) expect(r.value.history.at(-1)).toEqual({ date: TODAY, field: 'status', from: 'active', to: 'cancelled', reason: 'не нужна' });
    const fs: GoalFunding[] = [{ id: '1', goalId: 'g', accountId: 'kaspi', amount: tenge(1_000), date: TODAY, decisionId: null }];
    expect(changeStatus(g, 'paused', 'потом', TODAY, { goals: [g], fundings: fs }).ok).toBe(true);
  });
  it('цель с достигнутым минимумом помечается achieved, но статус сам не меняется', () => {
    const fs: GoalFunding[] = [{ id: '1', goalId: 'g', accountId: 'kaspi', amount: tenge(100_000), date: TODAY, decisionId: null }];
    const node = goalTree([g], fs, TODAY, H)[0]!;
    expect(node.achieved).toBe(true);
    expect(node.goal.status).toBe('active');
  });
});

describe('резерв как цель (§4.2 п.4, D27) и пример из §4.3 (D28)', () => {
  it('цель-резерв с правилом months_of_base получает targetMin = месяцы × медиана E_base', () => {
    const reserve = mk('reserve', { role: 'safety', targetMin: tiyn(1), targetRule: { kind: 'months_of_base' } });
    const r = resolveGoalTargets([reserve], tenge(120_000) as Money, 3);
    expect(r.goals[0]!.targetMin).toBe(tenge(360_000));
    expect(r.explanation[0]!.text).toMatch(/3 мес/);
  });
  it('при нулевой медиане резерв не обнуляется молча — остаётся заданная сумма и предупреждение', () => {
    const reserve = mk('reserve', { role: 'safety', targetMin: tenge(50_000), targetRule: { kind: 'months_of_base', months: 4 } });
    const r = resolveGoalTargets([reserve], tiyn(0), 3);
    expect(r.goals[0]!.targetMin).toBe(tenge(50_000));
    expect(r.explanation[0]!.level).toBe('warn');
  });
  it('пример из инструкции: дерево целей, суммы помечены «подтвердить», валидно', () => {
    const ex = exampleGoals(TODAY);
    expect(ex.map((g) => g.title)).toEqual(['Финансовая база 1 000 000 ₸', 'Резерв', 'Переезд в другой город', 'Стартовый бюджет переезда', 'Буфер адаптации', 'Лечение']);
    expect(ex.find((g) => g.title === 'Финансовая база 1 000 000 ₸')!.targetMin).toBe(tenge(1_000_000));
    expect(ex.filter((g) => g.unconfirmed).length).toBeGreaterThanOrEqual(4);
    expect(ex.find((g) => g.title === 'Лечение')!.status).toBe('paused');
    for (const g of ex) expect(validateGoal(g, ex)).toEqual([]);
  });
});
