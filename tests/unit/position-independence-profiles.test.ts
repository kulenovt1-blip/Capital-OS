/**
 * T15a «Положение» v4: профили независимости FI1–FI8 как фикстуры.
 *
 * Эталон — tests/fixtures/position/independence-reference.json: значения из вывода проб v4 (спец. 10.9, model-final 1.2–1.3), НЕ с кода движка.
 * Что проверяется уже сейчас (T05/T06): запас в месяцах, направления N/V/F и `G` до правки V1 (v1CapMonths = Infinity, как в пробе)
 * и после неё (D = 24); условия L4 как числа, потому что функции уровня ещё нет (T07).
 * Уровни L1–L4 на этих профилях проверяет position-level.test.ts (T07). C и P, устойчивость потока и L5 — position-independence.test.ts (T10).
 */
import { describe, it, expect } from 'vitest';
import { computeIndicators, type IndicatorsReport } from '../../engine/position/indicators';
import { directionScore } from '../../engine/position/directions';
import { aggregateG, limitStates } from '../../engine/position/limits';
import { fixtureJson } from '../support/fixtures';
import { independenceProfiles, TODAY } from '../support/position-profiles';

interface Ref {
  capitalMonths: number;
  before: { N: number; V: number; F: number; G: number; level: number; V1?: number };
  after: { level: number };
}
const REF = fixtureJson<{ today: string; profiles: Record<string, Ref>; v1AfterFixApprox: number }>('position/independence-reference.json');
const profiles = independenceProfiles();

const NEEDS_FIX = ['FI1', 'FI2', 'FI8'];
const calc = (rep: IndicatorsReport) => {
  const dirs = (['N', 'V', 'F'] as const).map((d) => directionScore(rep.values, d).score!);
  const agg = aggregateG(dirs, limitStates(rep.inputs!, rep.forecast!), 'point')!;
  return { dirs, g: agg.g, fired: agg.fired };
};
const withoutFix = (name: string) => calc(computeIndicators(profiles.find((p) => p.name === name)!.state, TODAY, undefined, { v1CapMonths: Infinity }));
const withFix = (name: string) => {
  const rep = computeIndicators(profiles.find((p) => p.name === name)!.state, TODAY);
  return { rep, ...calc(rep) };
};

describe('состав', () => {
  it('восемь профилей FI1…FI8 в порядке эталона, дата — дата проб', () => {
    expect(profiles.map((p) => p.name)).toEqual(['FI1', 'FI2', 'FI3', 'FI4', 'FI5', 'FI6', 'FI7', 'FI8']);
    expect(Object.keys(REF.profiles)).toEqual(profiles.map((p) => p.name));
    expect(REF.today).toBe(TODAY);
  });
  it('профили детерминированы: два построения дают одинаковые показатели', () => {
    const again = independenceProfiles();
    for (const [i, p] of profiles.entries()) {
      expect(computeIndicators(again[i]!.state, TODAY).values).toEqual(computeIndicators(p.state, TODAY).values);
    }
  });
});

describe('капитал в месячных расходах совпадает с пробой', () => {
  for (const p of profiles) {
    it(`${p.name}: ${p.title}`, () => {
      const inp = computeIndicators(p.state, TODAY).inputs!;
      expect(Math.round(inp.netLiquid / inp.needLifestyle)).toBe(REF.profiles[p.name]!.capitalMonths);
      expect(inp.needLifestyle).toBeCloseTo(400_000 * p.expenseFactor, 0);
      expect(inp.needEssential).toBeCloseTo(300_000 * p.expenseFactor, 0);
    });
  }
});

describe('до правки V1 (старая шкала, как в пробе): направления (допуск 1) и G (допуск 0,05) из таблицы 10.9', () => {
  for (const p of profiles) {
    it(`${p.name}`, () => {
      const ref = REF.profiles[p.name]!.before;
      const got = withoutFix(p.name);
      // в таблице 10.9 направления записаны целыми (округление с вольностью до половины очка), поэтому допуск — меньше одного очка; G записан до 0,1
      [ref.N, ref.V, ref.F].forEach((x, i) => expect(Math.abs(got.dirs[i]! - x), `${p.name} ${'NVF'[i]}`).toBeLessThan(1));
      expect(Math.abs(got.g - ref.G)).toBeLessThan(0.05);
      expect(got.fired).toEqual([]);
    });
  }
  it('V1 у FI1, FI2, FI8 при старой шкале — 38 / 36 / 36 (model-final 1.2)', () => {
    for (const name of NEEDS_FIX) {
      const rep = computeIndicators(profiles.find((p) => p.name === name)!.state, TODAY, undefined, { v1CapMonths: Infinity });
      expect(Math.round(rep.values.V1 as number)).toBe(REF.profiles[name]!.before.V1);
    }
  });
});

describe('после правки V1 (D = 24)', () => {
  it('FI1, FI2, FI8: V1 около 68, все три направления ≥ 60, G ≥ 75, ограничителей нет — условия L4 выполнены', () => {
    for (const name of NEEDS_FIX) {
      const a = withFix(name);
      expect(Math.abs((a.rep.values.V1 as number) - REF.v1AfterFixApprox)).toBeLessThan(1);
      for (const d of a.dirs) expect(d).toBeGreaterThanOrEqual(60);
      expect(a.g).toBeGreaterThanOrEqual(75);
      expect(a.fired).toEqual([]);
      expect(REF.profiles[name]!.after.level).toBe(4);
    }
  });
  it('FI3–FI7 правка не затрагивает (V1 растёт только при положительном росте капитала): все показатели и G те же, «Вектор» ниже 60 — L4 недоступен', () => {
    for (const p of profiles.filter((x) => !NEEDS_FIX.includes(x.name))) {
      const before = computeIndicators(p.state, TODAY, undefined, { v1CapMonths: Infinity }).values;
      const after = withFix(p.name);
      expect(after.rep.values).toEqual(before);
      expect(after.dirs[1]).toBeLessThan(60);
      expect(after.g).toBeGreaterThanOrEqual(40);
      expect(after.g).toBeLessThan(75);
      expect(REF.profiles[p.name]!.after.level).toBe(3);
    }
  });
  it('у всех восьми нет кассового разрыва и обрыва дохода в прогнозе (ограничители не срабатывают)', () => {
    for (const p of profiles) expect(withFix(p.name).fired, p.name).toEqual([]);
  });
});

describe('закрыто в T10', () => {
  // C и P по центральной и низкой ставке, устойчивость потока и уровни L5 на FI1–FI8 проверяет position-independence.test.ts (раздел «FI1–FI8»).
  it('ссылка на проверки T10 (чтобы не потерять при переименовании)', () => {
    expect(REF.independenceConfirmedByCentralRate).toEqual(['FI2', 'FI3', 'FI6', 'FI8']);
  });
});
