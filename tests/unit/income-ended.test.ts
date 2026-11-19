/**
 * D214: закончившийся доход — приложение спрашивает, а не обнуляет тихо.
 */
import { describe, it, expect } from 'vitest';
import { endedIncomeToAsk, ENDED_INCOME_ASK_DAYS } from '../../engine/income-ended';
import { positionViewOf } from '../../engine/position/view';
import { addDays } from '../../engine/date';
import { build, mk, TODAY } from '../support/position-profiles';
import type { AppState } from '../../engine/state';

const base = (): AppState => build(mk('Стипендия', 600_000, 300_000, [['food', 'E_base', 100_000], ['fun', 'E_fun', 50_000]]));
const withEnd = (s: AppState, end: string | undefined, extra: object = {}): AppState => ({ ...s, settings: { ...s.settings, ...extra, incomeSchedule: s.settings.incomeSchedule.map((i) => ({ ...i, end })) } });

describe('endedIncomeToAsk', () => {
  it('строка с прошедшим сроком без ответа — спрашиваем', () => {
    const q = endedIncomeToAsk(withEnd(base(), addDays(TODAY, -20)), TODAY);
    expect(q).toHaveLength(1);
    expect(q[0]!.end).toBe(addDays(TODAY, -20));
  });
  it('срок сегодня или в будущем — не спрашиваем (идёт обычный вопрос про будущее окончание, D108)', () => {
    expect(endedIncomeToAsk(withEnd(base(), TODAY), TODAY)).toHaveLength(0);
    expect(endedIncomeToAsk(withEnd(base(), addDays(TODAY, 30)), TODAY)).toHaveLength(0);
    expect(endedIncomeToAsk(withEnd(base(), undefined), TODAY)).toHaveLength(0);
  });
  it('ответ «закончился» запоминается; очень старые строки не спрашиваем', () => {
    const s = base();
    const id = s.settings.incomeSchedule[0]!.id;
    expect(endedIncomeToAsk(withEnd(s, addDays(TODAY, -20), { incomeEndedAnswered: [id] }), TODAY)).toHaveLength(0);
    expect(endedIncomeToAsk(withEnd(s, addDays(TODAY, -ENDED_INCOME_ASK_DAYS - 1)), TODAY)).toHaveLength(0);
    expect(endedIncomeToAsk(withEnd(s, addDays(TODAY, -ENDED_INCOME_ASK_DAYS)), TODAY)).toHaveLength(1);
  });
});

describe('на «Профиле»', () => {
  it('в PositionView есть доходы без ответа; после ответа «продолжается» (срок убран) и «закончился» — пусто', () => {
    const ended = withEnd(base(), addDays(TODAY, -20));
    expect(positionViewOf(ended, TODAY).endedIncome).toHaveLength(1);
    expect(positionViewOf(withEnd(ended, undefined), TODAY).endedIncome).toHaveLength(0);
    const id = ended.settings.incomeSchedule[0]!.id;
    expect(positionViewOf({ ...ended, settings: { ...ended.settings, incomeEndedAnswered: [id] } }, TODAY).endedIncome).toHaveLength(0);
  });
  it('ответ «продолжается» возвращает доход: «Долговая нагрузка» не хуже, чем при закончившемся источнике', () => {
    const ended = withEnd(base(), addDays(TODAY, -20));
    const alive = withEnd(base(), undefined);
    const nEnded = positionViewOf(ended, TODAY).directions.flatMap((d) => d.indicators).find((i) => i.id === 'N3')!.score!;
    const nAlive = positionViewOf(alive, TODAY).directions.flatMap((d) => d.indicators).find((i) => i.id === 'N3')!.score!;
    expect(nAlive).toBeGreaterThanOrEqual(nEnded);
  });
  it('нет данных — endedIncome всё равно есть и не падает', () => {
    expect(positionViewOf({ ...base(), operations: [] } as AppState, TODAY).endedIncome).toBeDefined();
  });
});
