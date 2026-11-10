/** T17 (D148): ряд, показатели и обзор считаются один раз на экран; числа те же, что при отдельном расчёте. */
import { describe, it, expect } from 'vitest';
import { independenceProfiles, namedProfiles, TODAY } from '../support/position-profiles';
import { positionViewOf } from '../../engine/position/view';
import { desiredScenarioOf, independenceOfState } from '../../engine/position/independence';
import { tenge } from '../../engine/money';

const withDesired = (s: ReturnType<typeof namedProfiles>[number]['state']) => ({ ...s, settings: { ...s.settings, position: { age: 40, desiredMonthly: tenge(500_000) } } });

describe('экран и отдельные расчёты дают одно и то же', () => {
  for (const p of [...namedProfiles().slice(0, 6), ...independenceProfiles().slice(0, 4)]) {
    it(`${p.name}: независимость и личный сценарий`, () => {
      const st = withDesired(p.state);
      const v = positionViewOf(st, TODAY);
      expect(v.independence).toEqual(independenceOfState(st, TODAY));
      expect(v.desired).toEqual(desiredScenarioOf(st, TODAY));
    });
  }
  it('без данных экран не падает и сценария нет', () => {
    const v = positionViewOf({ ...namedProfiles()[0]!.state, imported: undefined } as never, TODAY);
    expect(v.status).toBe('no_data');
    expect(v.desired).toBeNull();
  });
});
