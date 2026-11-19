/**
 * «Как дойти» (D3 → D217): `roadHowOf` только раскладывает то, что считают `routeTo`, `savingOptions` и `positionViewOf`.
 * Проверка — на тех же синтетических персонажах, что в примерах приложения.
 */
import { describe, it, expect } from 'vitest';
import { positionViewOf } from '../../engine/position/view';
import { routeTo, savingOptions } from '../../engine/index';
import { roadHowOf, ROAD_HOW_SAVINGS } from '../../app/road';
import { PERSONA_TODAY, personaState } from '../support/personas';

const howOf = (id: 'berik' | 'serik' | 'aliya' | 'olzhas', target: 3 | 6) => {
  const st = personaState(id);
  const v = positionViewOf(st, PERSONA_TODAY);
  return { v, how: roadHowOf(v, routeTo(st, PERSONA_TODAY, target), savingOptions(st, PERSONA_TODAY)), route: routeTo(st, PERSONA_TODAY, target) };
};

describe('«Как дойти»: числа движка, ничего не выдумано', () => {
  it('Серик (запас 2,7 мес. из 3): не хватает ровно столько, сколько считает routeTo; добавки только там, где нужны', () => {
    const { how, route } = howOf('serik', 3);
    expect(route).not.toBeNull();
    expect(how.reserve!.missing).toBe(route!.missing);
    expect(how.reserve!.by).toBe(route!.by);
    expect(how.reserve!.deadlines.every((d) => d.extraMonthly > 0)).toBe(true);
    expect(how.reserve!.deadlines.length).toBeLessThanOrEqual(route!.deadlines.length);
  });

  it('траты: не больше трёх, у каждой есть цена урезания', () => {
    const { how } = howOf('serik', 3);
    expect(how.savings.length).toBeLessThanOrEqual(ROAD_HOW_SAVINGS);
    for (const s of how.savings) {
      expect(s.cutPerMonth).toBeGreaterThan(0);
      expect(s.cutPerMonth).toBeLessThan(s.monthly);
    }
  });

  it('Берик: расходы больше доходов — первый шаг «выйти в плюс» с суммой минуса, траты для урезания есть (D217)', () => {
    const { how, route, v } = howOf('berik', 3);
    expect(route!.deficitMonthly).toBeGreaterThan(0);
    expect(how.deficit).not.toBeNull();
    expect(how.deficit!.monthly).toBe(v.runway.deficit);
    expect(how.reserve!.deficitMonthly).toBe(route!.deficitMonthly);
    expect(how.savings.length).toBeGreaterThan(0);
  });

  it('слабые показатели: ниже 60, по возрастанию, не больше трёх', () => {
    const { how } = howOf('aliya', 6);
    expect(how.weak.length).toBeGreaterThan(0);
    expect(how.weak.length).toBeLessThanOrEqual(3);
    expect(how.weak.every((w) => w.score < 60)).toBe(true);
    expect([...how.weak].sort((a, b) => a.score - b.score)).toEqual(how.weak);
    expect(how.weak[0]!.id).toBe('N3'); // долг по ипотеке — самый слабый показатель Алии (D202: 35)
  });

  it('запас уже есть (маршрута нет) — блока запаса нет', () => {
    const st = personaState('olzhas');
    const v = positionViewOf(st, PERSONA_TODAY);
    expect(roadHowOf(v, null, null).reserve).toBeNull();
    expect(roadHowOf(v, null, null).deficit).toBeNull();
  });
});
