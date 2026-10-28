/**
 * Маленький «мир» для сценарных тестов этапа 3. Все суммы круглые — ожидания считаются вручную.
 * Сегодня 05.11.2026 (день зарплаты), следующий доход 20.11.2026.
 */
import { createGoal, type Goal, type GoalInput } from '../../engine/goals';
import { tenge, type Money } from '../../engine/money';

export const TODAY = '2026-11-05';

export function g(input: Partial<GoalInput> & { id: string }): Goal {
  const { parentId, ...rest } = input;
  const r = createGoal({ title: input.id, role: 'capital', targetMin: tenge(100_000), importance: 3, ...rest }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return parentId === undefined ? r.value : { ...r.value, parentId };
}

/** Резерв 300 000 (есть 200 000), база 1 000 000 (есть 100 000), переезд 600 000 к 01.09.2027 (0), зубы на паузе. */
export function worldGoals(): Goal[] {
  return [
    g({ id: 'reserve', title: 'Резерв', role: 'safety', targetMin: tenge(300_000), importance: 5 }),
    g({ id: 'base', title: 'База 1 млн', role: 'capital', targetMin: tenge(1_000_000), importance: 5 }),
    g({ id: 'move', title: 'Переезд', role: 'life_change', targetMin: tenge(600_000), importance: 4, deadline: '2027-09-01' }),
    g({ id: 'teeth', title: 'Зубы', role: 'quality', targetMin: tenge(200_000), importance: 3, status: 'paused' }),
  ];
}

export function worldProgress(extra: Record<string, number> = {}): Map<string, Money> {
  const p: Record<string, number> = { reserve: 200_000, base: 100_000, move: 0, teeth: 0, ...extra };
  return new Map(Object.entries(p).map(([k, v]) => [k, tenge(v)]));
}
