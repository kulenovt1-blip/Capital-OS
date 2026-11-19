/**
 * D210. «Слабое место» не называет хорошее слабым: если даже самый низкий из «действуемых» показателей слабого направления не ниже WEAK_NONE_FROM (80), слабого места нет.
 * Инварианты проверяются на пуле проб и на двух именных профилях; ожидаемые значения — арифметика порога, не снимок вывода.
 */
import { describe, it, expect } from 'vitest';
import { positionViewOf, WEAK_NONE_FROM } from '../../engine/position/view';
import { probeProfiles, applyProbeOpts, TODAY } from '../support/position-profiles';
import { PERSONAS, PERSONA_TODAY, personaState } from '../support/personas';

describe('«Слабое место»: порог D210', () => {
  const views = probeProfiles().map((p) => ({ name: p.name, v: positionViewOf(applyProbeOpts(p.state, p.opts), TODAY) }));
  it('порог — 80', () => expect(WEAK_NONE_FROM).toBe(80));
  it('если слабое место названо с показателем, его оценка ниже порога', () => {
    for (const { name, v } of views) if (v.weak?.indicator) expect(v.weak.indicator.score, name).toBeLessThan(WEAK_NONE_FROM);
  });
  it('если слабого места нет у оценённого профиля, то у слабого направления нет «действуемого» показателя ниже порога', () => {
    let none = 0;
    for (const { name, v } of views) {
      if (v.status !== 'ok' || v.g === null || v.weak) continue;
      none++;
      const scored = v.directions.filter((d) => d.score !== null);
      if (!scored.length) continue;
      const weakest = scored.reduce((a, b) => (b.score! < a.score! ? b : a));
      // N4 («Капитал») при запасе от 3 мес. не считается действуемым (D177), остальные показатели слабого направления — не ниже порога
      const actionable = weakest.indicators.filter((i) => i.score !== null && !(i.id === 'N4' && v.money.reserveEssentialMonths >= 3));
      for (const i of actionable) expect(i.score!, `${name} ${i.id}`).toBeGreaterThanOrEqual(WEAK_NONE_FROM);
    }
    expect(none).toBeGreaterThan(0); // на пуле такие профили есть, иначе проверка пуста
  });
  it('именные примеры с низкими показателями слабое место по-прежнему называют', () => {
    for (const p of PERSONAS) {
      const v = positionViewOf(personaState(p.id), PERSONA_TODAY);
      if (v.level !== null && v.level <= 3) expect(v.weak, p.id).not.toBeNull();
    }
  });
});
