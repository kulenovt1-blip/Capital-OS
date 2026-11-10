/**
 * T21: личный сценарий «При желаемых расходах (гипотеза)».
 * Решение 8 (t00-final): колонка есть только при заданной сумме; основной уровень не меняется; пример 400 → 600 тыс. ₸
 * даёт капитал для порога L5 315,8 → 473,7 млн ₸.
 */
import { describe, it, expect } from 'vitest';
import type { AppState } from '../../engine/state';
import { tenge } from '../../engine/money';
import { desiredScenarioOf, DESIRED_LABEL, INDEPENDENCE_TEXTS, requiredCapital, horizonYears } from '../../engine/position/independence';
import { positionViewOf } from '../../engine/position/view';
import { emptyState } from '../../engine/state';
import { independenceProfiles, TODAY } from '../support/position-profiles';

const withDesired = (s: AppState, d: number | undefined): AppState => ({
  ...s, settings: { ...s.settings, position: d === undefined ? s.settings.position : { ...s.settings.position, desiredMonthly: tenge(d) } },
});
const fi = (name: string) => independenceProfiles().find((p) => p.name === name)!.state;
const FORBIDDEN = /безопасно|гарантированно|обеспечено/i;

describe('desiredScenarioOf', () => {
  it('без суммы и на пустом состоянии сценария нет', () => {
    expect(desiredScenarioOf(fi('FI2'), TODAY)).toBeNull();
    expect(positionViewOf(fi('FI2'), TODAY).desired).toBeNull();
    expect(desiredScenarioOf(withDesired(emptyState(), 600_000), TODAY)).toBeNull();
  });

  it('пример решения: 400 → 600 тыс. ₸ — капитал для L5 315,8 → 473,7 млн ₸ (центральные допущения, 50 лет)', () => {
    const h = horizonYears(undefined);
    const at = (need: number) => requiredCapital({ need, horizon: h, p: 0, target: 1.25, set: 'central' }) / 1e6;
    expect(at(400_000)).toBeCloseTo(315.8, 1);
    expect(at(600_000)).toBeCloseTo(473.7, 1);
  });

  it('при желаемых расходах те же капитал и поступления, другой расход: покрытие падает пропорционально', () => {
    const base = positionViewOf(fi('FI2'), TODAY);
    const s = positionViewOf(withDesired(fi('FI2'), 800_000), TODAY).desired!;
    expect(s.desired).toBe(800_000);
    expect(s.independence.capital).toBe(base.independence.capital);
    expect(s.independence.c.central).toBeCloseTo(base.independence.c.central * (base.independence.need / 800_000), 9);
    expect(s.requiredCapital.current).toBeCloseTo(base.independence.requiredCapital, 3);
    expect(s.requiredCapital.desired).toBeGreaterThan(s.requiredCapital.current);
  });

  it('запас в месяцах = деньги сразу ÷ желаемые траты', () => {
    const v = positionViewOf(withDesired(fi('FI2'), 500_000), TODAY);
    const s = v.desired!;
    expect(s.reserveMonths).toBeCloseTo(v.money.reserveLifestyleMonths * (s.current / 500_000), 6);
  });

  it('гипотетический уровень: FI2 (капитал 800×) при 600 тыс. не подтверждается, FI8 (1500×) подтверждается; основной уровень тот же', () => {
    const f2 = positionViewOf(withDesired(fi('FI2'), 600_000), TODAY);
    const f8 = positionViewOf(withDesired(fi('FI8'), 600_000), TODAY);
    expect(f2.level).toBe(5);
    expect(f2.desired!.hypotheticalLevel).toBeNull();
    expect(f8.level).toBe(5);
    expect(f8.desired!.hypotheticalLevel).toBe(5);
  });

  it('основной расчёт не меняется ни при какой сумме (все поля вида, кроме desired)', () => {
    for (const n of ['FI1', 'FI3', 'FI4', 'FI5', 'FI7']) {
      const { desired: _a, ...base } = positionViewOf(fi(n), TODAY);
      for (const d of [100_000, 600_000, 50_000_000]) {
        const { desired: s, ...rest } = positionViewOf(withDesired(fi(n), d), TODAY);
        expect(rest, `${n} при ${d}`).toEqual(base);
        expect(s, `${n} при ${d}`).not.toBeNull();
        expect(Object.values(s!).every((x) => typeof x !== 'number' || Number.isFinite(x))).toBe(true);
      }
    }
  });

  it('тексты: метка «гипотеза» и нет запрещённых слов', () => {
    expect(DESIRED_LABEL).toBe('гипотеза');
    expect(DESIRED_LABEL).not.toMatch(FORBIDDEN);
    expect(INDEPENDENCE_TEXTS.scenarioNote).not.toMatch(FORBIDDEN);
  });
});
