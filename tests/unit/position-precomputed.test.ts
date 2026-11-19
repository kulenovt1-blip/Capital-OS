/** T17 (D148): ряд, показатели и обзор считаются один раз на экран. Независимость и личный сценарий удалены (D216) — экран не должен от них зависеть. */
import { describe, it, expect } from 'vitest';
import { namedProfiles, TODAY } from '../support/position-profiles';
import { positionViewOf } from '../../engine/position/view';
import { tenge } from '../../engine/money';

const withDesired = (s: ReturnType<typeof namedProfiles>[number]['state']) => ({ ...s, settings: { ...s.settings, position: { age: 40, desiredMonthly: tenge(500_000) } } });

describe('старые настройки «О тебе» из бэкапа ничего не меняют', () => {
  for (const p of namedProfiles().slice(0, 6)) {
    it(`${p.name}: экран с возрастом и желаемыми тратами — тот же`, () => {
      expect(positionViewOf(withDesired(p.state), TODAY)).toEqual(positionViewOf(p.state, TODAY));
    });
  }
  it('без данных экран не падает', () => {
    const v = positionViewOf({ ...namedProfiles()[0]!.state, imported: undefined } as never, TODAY);
    expect(v.status).toBe('no_data');
  });
});
