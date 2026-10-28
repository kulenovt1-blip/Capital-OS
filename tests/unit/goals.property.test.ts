/**
 * Property-тест двойного учёта (§4.2): случайные последовательности «назначить / снять / потратить /
 * перевести / перенести назначение / доход» никогда не нарушают инвариант 1 без поднятого предупреждения,
 * а деньги никогда не считаются в двух целях.
 */
import { describe, it, expect } from 'vitest';
import { assignMoney, createGoal, goalTree, moveFunding, overAssignment, withdrawMoney, type Goal, type GoalFunding, type GoalNode } from '../../engine/goals';
import { tenge, tiyn, type Money } from '../../engine/money';
import { forAll } from '../support/prop';

const TODAY = '2026-10-28';
const ACCS = ['kaspi', 'cash', 'dep'] as const;

function goals(): Goal[] {
  const spec: [string, string | undefined, number][] = [
    ['base', undefined, 5],
    ['move', undefined, 4],
    ['move-start', 'move', 3],
    ['move-buffer', 'move', 3],
    ['move-buffer-rent', 'move-buffer', 2],
    ['reserve', undefined, 5],
    ['teeth', undefined, 1],
  ];
  const out: Goal[] = [];
  for (const [id, parentId, importance] of spec) {
    const r = createGoal({ id, title: id, role: 'capital', targetMin: tenge(500_000), importance: importance as Goal['importance'], ...(parentId ? { parentId } : {}) }, out, TODAY);
    if (!r.ok) throw new Error(r.error);
    out.push(r.value);
  }
  return out;
}

const sumBy = (fs: GoalFunding[], pred: (f: GoalFunding) => boolean): number => fs.filter(pred).reduce((s, f) => s + f.amount, 0);

function checkTree(nodes: GoalNode[]): void {
  for (const n of nodes) {
    const kids = n.children.reduce((s, c) => s + c.progress, 0);
    if (n.progress !== n.direct + kids) throw new Error(`прогресс «${n.goal.id}» ${n.progress} ≠ напрямую ${n.direct} + подцели ${kids}`);
    checkTree(n.children);
  }
}

describe('инварианты двойного учёта (property, 300 прогонов × до 60 шагов)', () => {
  it('ни одна последовательность операций не нарушает инварианты', () => {
    const G = goals();
    const ids = G.map((g) => g.id);
    forAll(300, (g) => {
      const balances: Record<string, Money> = { kaspi: tenge(g.int(0, 400_000)), cash: tenge(g.int(0, 50_000)), dep: tenge(g.int(0, 1_000_000)) };
      const fundings: GoalFunding[] = [];
      let seq = 0;
      const steps = g.int(5, 60);
      for (let i = 0; i < steps; i++) {
        const op = g.pick(['assign', 'assign', 'withdraw', 'spend', 'income', 'transfer', 'move'] as const);
        const acc = g.pick(ACCS);
        const goal = g.pick(ids);
        const ctx = { goals: G, fundings, balances };
        if (op === 'assign') {
          const amount = tiyn(g.int(1, Math.max(1, Math.floor(balances[acc]! * 1.3))));
          const r = assignMoney({ id: `f${seq++}`, goalId: goal, accountId: acc, amount, date: TODAY, decisionId: null }, ctx);
          g.log(`assign ${goal} ${acc} ${amount} → ${r.ok ? 'ok' : 'отказ'}`);
          if (r.ok) {
            fundings.push(r.value);
            // назначение само никогда не создаёт превышения
            const assigned = sumBy(fundings, (f) => f.accountId === acc);
            if (assigned > balances[acc]!) throw new Error(`assign принят, но назначено ${assigned} > баланс ${balances[acc]} на ${acc}`);
          }
        } else if (op === 'withdraw') {
          const funded = sumBy(fundings, (f) => f.goalId === goal && f.accountId === acc);
          const amount = tiyn(g.int(1, Math.max(1, Math.floor(funded * 1.3) + 1)));
          const r = withdrawMoney({ id: `f${seq++}`, goalId: goal, accountId: acc, amount, date: TODAY, decisionId: null }, ctx);
          g.log(`withdraw ${goal} ${acc} ${amount} (было ${funded}) → ${r.ok ? 'ok' : 'отказ'}`);
          if (r.ok !== amount <= funded) throw new Error(`withdraw ${amount} при назначенных ${funded}: ok=${r.ok}`);
          if (r.ok) fundings.push(r.value);
        } else if (op === 'spend') {
          const amount = g.int(0, Math.max(0, balances[acc]! + 10_000));
          balances[acc] = tiyn(balances[acc]! - amount);
          g.log(`spend ${acc} ${amount}`);
        } else if (op === 'income') {
          const amount = g.int(0, 30_000_000);
          balances[acc] = tiyn(balances[acc]! + amount);
          g.log(`income ${acc} ${amount}`);
        } else if (op === 'transfer') {
          const to = g.pick(ACCS);
          const amount = g.int(0, Math.max(0, balances[acc]!));
          balances[acc] = tiyn(balances[acc]! - amount);
          balances[to] = tiyn(balances[to]! + amount);
          g.log(`transfer ${acc}→${to} ${amount}`);
        } else {
          const to = g.pick(ACCS);
          const funded = sumBy(fundings, (f) => f.goalId === goal && f.accountId === acc);
          const amount = tiyn(g.int(1, Math.max(1, funded)));
          const r = moveFunding({ id: `m${seq++}`, goalId: goal, fromAccountId: acc, toAccountId: to, amount, date: TODAY, decisionId: null }, ctx);
          g.log(`move ${goal} ${acc}→${to} ${amount} → ${r.ok ? 'ok' : 'отказ'}`);
          if (r.ok) {
            fundings.push(...r.value);
            if (to !== acc && sumBy(fundings, (f) => f.accountId === to) > balances[to]!) throw new Error(`move создал превышение на ${to}`);
          }
        }

        // Инвариант 1: Σ назначенного на счёте ≤ баланс, иначе поднято предупреждение с точной нехваткой.
        // Отрицательный баланс без назначений — овердрафт, а не «назначено больше, чем есть» (DECISIONS D37).
        const alerts = overAssignment(fundings, balances, G);
        for (const a of ACCS) {
          const assigned = sumBy(fundings, (f) => f.accountId === a);
          const alert = alerts.find((x) => x.accountId === a);
          if (assigned > Math.max(0, balances[a]!)) {
            if (!alert) throw new Error(`на ${a} назначено ${assigned} > баланс ${balances[a]}, а предупреждения нет`);
            if (alert.shortfall !== assigned - Math.max(0, balances[a]!)) throw new Error(`неверная нехватка ${alert.shortfall}`);
            if (alert.options.length === 0) throw new Error('предупреждение без вариантов');
          } else if (alert) throw new Error(`ложное предупреждение по ${a}`);
        }
        // назначенное по (цель, счёт) никогда не отрицательно
        for (const gid of ids) for (const a of ACCS) if (sumBy(fundings, (f) => f.goalId === gid && f.accountId === a) < 0) throw new Error(`отрицательное назначение ${gid}/${a}`);
        // Инвариант 2: каждый тенге в одной цели; прогресс родителя = подцели + напрямую
        const tree = goalTree(G, fundings, TODAY, [3, 12, 36]);
        checkTree(tree);
        const roots = tree.reduce((s, n) => s + n.progress, 0);
        const all = sumBy(fundings, () => true);
        if (roots !== all) throw new Error(`Σ корней ${roots} ≠ Σ назначений ${all} — двойной учёт`);
      }
    });
    expect(true).toBe(true);
  });
});
