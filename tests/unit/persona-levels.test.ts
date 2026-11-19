import { describe, expect, test } from 'vitest';
import { positionViewOf } from '../../engine/position/view';
import { PERSONAS, PERSONA_TODAY, personaState } from '../support/personas';

describe('демо-персонажи: ступени через настоящий движок', () => {
  for (const p of PERSONAS) {
    test(`${p.name}: ступень ${p.level}`, () => {
      const v = positionViewOf(personaState(p.id), PERSONA_TODAY);
      expect(v.level).toBe(p.level);
    });
  }

  test('Берик: долговая спираль и нет запаса', () => {
    const v = positionViewOf(personaState('berik'), PERSONA_TODAY);
    expect(v.spiral.spiral).toBe(true);
    expect(v.money.reserveEssentialMonths).toBeLessThan(1);
  });

  test('Серик: по очкам выше, но запас меньше 3 месяцев удерживает на ступени 2', () => {
    const v = positionViewOf(personaState('serik'), PERSONA_TODAY);
    expect(v.money.reserveEssentialMonths).toBeLessThan(3);
    expect(v.held).toBeTruthy();
  });

  test('Алия: запас больше 3 мес., но меньше 6 и общий балл ниже 75 — граница ступени 4', () => {
    const v = positionViewOf(personaState('aliya'), PERSONA_TODAY);
    expect(v.money.reserveEssentialMonths).toBeGreaterThan(3);
    expect(v.g ?? 0).toBeGreaterThan(70);
    expect(v.g ?? 100).toBeLessThan(75);
  });

  test('Алия: ипотека привязана к жилью, «Долговая нагрузка» не ноль (D202)', () => {
    const v = positionViewOf(personaState('aliya'), PERSONA_TODAY);
    const n3 = v.directions.find((d) => d.id === 'N')?.indicators.find((i) => i.id === 'N3')?.score ?? 0;
    expect(n3).toBeGreaterThan(20);
    expect(n3).toBeLessThan(50);
  });

  test('Олжас: запас не меньше 6 мес. и все направления не ниже 60', () => {
    const v = positionViewOf(personaState('olzhas'), PERSONA_TODAY);
    expect(v.money.reserveEssentialMonths).toBeGreaterThanOrEqual(6);
    for (const d of v.directions) expect(d.score ?? 0).toBeGreaterThanOrEqual(60);
  });

  test('Дантал: независимость подтверждена', () => {
    const v = positionViewOf(personaState('dantal'), PERSONA_TODAY);
    expect(v.independence.status).toBe('confirmed');
  });
});

describe('поток для полосок «Доход / Расходы» (D6)', () => {
  test('Берик: доход 220 тыс, расходы 330 тыс — разница равна дефициту из runway', () => {
    const v = positionViewOf(personaState('berik'), PERSONA_TODAY);
    expect(v.flow).not.toBeNull();
    expect(Math.round(v.flow!.spending - v.flow!.income)).toBe(Math.round(v.runway.deficit));
    expect(v.flow!.obligations / v.flow!.income).toBeGreaterThan(1 / 3);
  });
  test('Серик: дефицита нет, платежи меньше трети дохода', () => {
    const v = positionViewOf(personaState('serik'), PERSONA_TODAY);
    expect(v.flow!.income).toBeGreaterThan(v.flow!.spending);
    expect(v.flow!.obligations / v.flow!.income).toBeLessThan(1 / 3);
  });
});
