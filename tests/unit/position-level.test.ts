/**
 * T07 «Положение» v4: уровни L1–L4, условие L4, запас до границ, пометка «на границе».
 *
 * Источники ожидаемых значений — НЕ код движка:
 *  1. tests/fixtures/position/levels-reference.json — именные профили (спец. 13.1, 12.2) и доли уровней на 1120 профилях пула проб (спец. 7.2);
 *     показатели без правки V1 (`v1CapMonths: Infinity`), как в пробе;
 *  2. ручная арифметика на синтетических входах (границы 20 / 40 / 75, направления ≥ 60, запас = min(G − 75; направление − 60));
 *  3. FI1–FI8 из tests/fixtures/position/independence-reference.json (после правки V1 FI1, FI2, FI8 → L4).
 * Тесты написаны до кода (плановое правило «тесты вперёд»).
 */
import { describe, it, expect } from 'vitest';
import {
  levelOf, levelFromIndicators, levelBandOf, LEVEL_BOUNDS, LEVEL_NAMES, L4_DIRECTION_MIN, BORDER_MARGIN, type LevelInput, type Level,
} from '../../engine/position/level';
import { LEVEL_BOUNDS as RANGE_BOUNDS, levelBandOf as rangeBandOf } from '../../engine/position/range';
import { computeIndicators } from '../../engine/position/indicators';
import { emptyState } from '../../engine/state';
import { fixtureJson } from '../support/fixtures';
import { applyProbeOpts, build, independenceProfiles, namedProfiles, randomSpec, randomSpecDyn, stressCase, TODAY } from '../support/position-profiles';

type Dirs = LevelInput['directions'];
const dirs = (n: number | null, v: number | null, f: number | null): Dirs => ({ N: n, V: v, F: f });
const all = { N: true, V: true, F: true };
const input = (g: number, d: Dirs, extra: Partial<LevelInput> = {}): LevelInput => ({ g, directions: d, reliable: all, fired: [], ...extra });
const near = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('константы', () => {
  it('границы 20 / 40 / 75, направление для L4 — 60, «на границе» — меньше 1 очка', () => {
    expect([...LEVEL_BOUNDS]).toEqual([20, 40, 75]);
    expect(L4_DIRECTION_MIN).toBe(60);
    expect(BORDER_MARGIN).toBe(1);
  });
  it('названия уровней из спецификации 7.2', () => {
    expect(LEVEL_NAMES).toEqual({ 1: 'Выживание', 2: 'Нестабильность', 3: 'Стабильность', 4: 'Безопасность' });
  });
  it('границы и полоса по одному G — те же, что использует диапазон (T06)', () => {
    expect([...RANGE_BOUNDS]).toEqual([...LEVEL_BOUNDS]);
    for (const g of [0, 19.99, 20, 39.99, 40, 74.99, 75, 100]) expect(rangeBandOf(g)).toBe(levelBandOf(g));
  });
});

describe('уровень по G', () => {
  const cases: [number, Level][] = [[0, 1], [19.99, 1], [20, 2], [39.99, 2], [40, 3], [74.99, 3]];
  for (const [g, lv] of cases) it(`G ${g} при сильных направлениях → L${lv}`, () => expect(levelOf(input(g, dirs(90, 90, 90))).level).toBe(lv));
  it('G = 75 и все направления ровно 60 → L4 (границы включительно)', () => {
    const r = levelOf(input(75, dirs(60, 60, 60)));
    expect(r.level).toBe(4);
    expect(r.l4Unconfirmed).toBe(false);
  });
  it('G 100 → L4; уровень не выше L4 (L5 — отдельная ветка, T10)', () => expect(levelOf(input(100, dirs(100, 100, 100))).level).toBe(4));
  it('уровень не убывает с ростом G при фиксированных направлениях (сетка 0…100 шагом 0,25)', () => {
    let prev = 0;
    for (let g = 0; g <= 100; g += 0.25) { const lv = levelOf(input(g, dirs(95, 95, 95))).level; expect(lv).toBeGreaterThanOrEqual(prev); prev = lv; }
  });
});

describe('условие L4: G ≥ 75, каждое направление ≥ 60, нет ограничителя, все три направления достоверны', () => {
  it('одно направление 59,99 → L3, запас −0,01', () => {
    const r = levelOf(input(80, dirs(59.99, 90, 90)));
    expect(r.level).toBe(3);
    near(r.margins.find((m) => m.id === 'L3/L4')!.margin, -0.01, 1e-9);
  });
  it('G 74,99 при направлениях 90 → L3', () => expect(levelOf(input(74.99, dirs(90, 90, 90))).level).toBe(3));
  it('сработавший ограничитель закрывает L4, даже если G и направления высоки', () => {
    for (const id of ['cover1', 'gap', 'cliff'] as const) expect(levelOf(input(80, dirs(90, 90, 90), { fired: [id] })).level, id).toBe(3);
  });
  it('направление не оценено (null) → L4 не подтверждён: уровень L3, флаг выставлен', () => {
    const r = levelOf(input(80, dirs(90, null, 90), { reliable: { N: true, V: false, F: true } }));
    expect(r.level).toBe(3);
    expect(r.l4Unconfirmed).toBe(true);
  });
  it('направление оценено по неполным данным (недостаточно) → L4 не подтверждён', () => {
    const r = levelOf(input(80, dirs(90, 90, 90), { reliable: { N: true, V: true, F: false } }));
    expect(r.level).toBe(3);
    expect(r.l4Unconfirmed).toBe(true);
  });
  it('«не подтверждён» только там, где L4 иначе был бы: при G 70 флага нет, при ограничителе нет', () => {
    expect(levelOf(input(70, dirs(90, 90, null), { reliable: { N: true, V: true, F: false } })).l4Unconfirmed).toBe(false);
    expect(levelOf(input(80, dirs(90, 90, null), { reliable: { N: true, V: true, F: false }, fired: ['gap'] })).l4Unconfirmed).toBe(false);
  });
  it('проверка L4 отдаёт слагаемые для строки «до L4 не хватает…»', () => {
    const r = levelOf(input(73.4, dirs(58.6, 82.4, 82.1)));
    expect(r.l4.gOk).toBe(false);
    expect(r.l4.directionsOk).toEqual({ N: false, V: true, F: true });
    expect(r.l4.limitsOk).toBe(true);
    expect(r.l4.reliableOk).toBe(true);
    expect(r.l4.weakest).toBe('N');
  });
});

describe('запас до границ', () => {
  it('студент A из спецификации 7.4: G 73,4, направления 58,6 / 82,4 / 82,1 → L3, запас до L4 −1,6, не хватает 1,6', () => {
    const r = levelOf(input(73.4, dirs(58.6, 82.4, 82.1)));
    expect(r.level).toBe(3);
    near(r.margins.find((m) => m.id === 'L1/L2')!.margin, 53.4, 1e-9);
    near(r.margins.find((m) => m.id === 'L2/L3')!.margin, 33.4, 1e-9);
    near(r.margins.find((m) => m.id === 'L3/L4')!.margin, -1.6, 1e-9);
    near(r.shortfallToNext!, 1.6, 1e-9);
    expect(r.onBorder).toEqual([]);
  });
  it('B из спецификации: G 82,9, направления 77,6 / 82,4 / 89,2 → L4, запас +7,9 (ограничивает направление «Здесь и сейчас» не он, а G)', () => {
    const r = levelOf(input(82.9, dirs(77.6, 82.4, 89.2)));
    expect(r.level).toBe(4);
    near(r.margins.find((m) => m.id === 'L3/L4')!.margin, 7.9, 1e-9);
    expect(r.shortfallToNext).toBeNull();
  });
  it('запас до L4 — меньшее из «G − 75» и «минимальное направление − 60»', () => {
    near(levelOf(input(90, dirs(62, 99, 99))).margins.find((m) => m.id === 'L3/L4')!.margin, 2);
    near(levelOf(input(76, dirs(99, 99, 99))).margins.find((m) => m.id === 'L3/L4')!.margin, 1);
  });
  it('неоценённое направление в запас не входит', () => {
    near(levelOf(input(80, dirs(70, null, 90), { reliable: { N: true, V: false, F: true } })).margins.find((m) => m.id === 'L3/L4')!.margin, 5);
  });
  it('до следующего уровня не хватает: L1 → до 20, L2 → до 40, L3 → до L4', () => {
    near(levelOf(input(12, dirs(12, 12, 12))).shortfallToNext!, 8);
    near(levelOf(input(33.4, dirs(33.4, 33.4, 33.4))).shortfallToNext!, 6.6, 1e-9);
  });
  it('слабое направление — с наименьшей оценкой среди оценённых; нет оценок — null', () => {
    expect(levelOf(input(50, dirs(70, 30, 80))).l4.weakest).toBe('V');
    expect(levelOf(input(50, dirs(null, null, null), { reliable: { N: false, V: false, F: false } })).l4.weakest).toBeNull();
  });
});

describe('пометка «на границе» (решение 7: запас до любой границы меньше 1 очка в любую сторону, без гистерезиса)', () => {
  const border = (g: number, d = dirs(90, 90, 90)) => levelOf(input(g, d)).onBorder;
  it('0,5 над L3 и 0,5 под L3 → L2/L3', () => { expect(border(40.5)).toEqual(['L2/L3']); expect(border(39.5)).toEqual(['L2/L3']); });
  it('ровно 1,0 до границы — ещё не «на границе»; 0,99 — уже да', () => {
    expect(border(41)).toEqual([]);
    expect(border(39)).toEqual([]);
    expect(border(40.99)).toEqual(['L2/L3']);
    expect(border(39.01)).toEqual(['L2/L3']);
  });
  it('граница L1/L2 по G 20', () => { expect(border(20.4)).toEqual(['L1/L2']); expect(border(19.2)).toEqual(['L1/L2']); });
  it('граница L3/L4: по G и по минимальному направлению', () => {
    expect(border(75.5)).toEqual(['L3/L4']);
    expect(border(74.2)).toEqual(['L3/L4']);
    expect(border(90, dirs(60.4, 90, 90))).toEqual(['L3/L4']);
    expect(border(90, dirs(59.4, 90, 90))).toEqual(['L3/L4']);
    expect(border(90, dirs(61.5, 90, 90))).toEqual([]);
  });
  it('граница видна и там, где L4 закрыт ограничителем? G срезан до 39/59, поэтому до L4 далеко — пометки нет', () => {
    expect(levelOf(input(59, dirs(90, 90, 90), { fired: ['gap'] })).onBorder).toEqual([]);
  });
  it('уровень не зависит от пометки: «на границе» только описывает, не меняет level', () => {
    expect(levelOf(input(40.1, dirs(90, 90, 90))).level).toBe(3);
    expect(levelOf(input(39.9, dirs(90, 90, 90))).level).toBe(2);
  });
});

describe('чистота и детерминированность', () => {
  it('два вызова с теми же входами дают равный результат; вход не изменяется', () => {
    const i = input(73.4, dirs(58.6, 82.4, 82.1));
    const copy = JSON.parse(JSON.stringify(i));
    expect(levelOf(i)).toEqual(levelOf(i));
    expect(i).toEqual(copy);
  });
});

describe('на состоянии: levelFromIndicators', () => {
  it('нет операций → нет оценки (null), а не L1', () => {
    expect(levelFromIndicators(computeIndicators(emptyState(), TODAY))).toBeNull();
  });
  it('два вызова на одном состоянии равны', () => {
    const st = build(randomSpec(5));
    expect(levelFromIndicators(computeIndicators(st, TODAY))).toEqual(levelFromIndicators(computeIndicators(st, TODAY)));
  });
});

const LEVELS = fixtureJson<{
  today: string;
  named: Record<string, { N: number; V: number; F: number; G: number; level: number; margin: number }>;
  shares: Record<'random' | 'dynamic' | 'stress', { size: number; counts: number[] }>;
}>('position/levels-reference.json');
const OLD_V1 = { v1CapMonths: Infinity };
const probeLevel = (state: ReturnType<typeof build>) => levelFromIndicators(computeIndicators(state, TODAY, undefined, OLD_V1))!;

describe('именные профили равны пробе (спец. 13.1, 12.2)', () => {
  it('состав и дата', () => {
    expect(namedProfiles().map((p) => p.name).sort()).toEqual(Object.keys(LEVELS.named).sort());
    expect(LEVELS.today).toBe(TODAY);
  });
  for (const p of namedProfiles()) {
    it(p.name, () => {
      const ref = LEVELS.named[p.name]!;
      const got = levelFromIndicators(computeIndicators(applyProbeOpts(p.state, p.opts), TODAY, undefined, OLD_V1))!;
      const d = got.directions;
      // в таблицах спецификации значения записаны до 0,1: допуск 0,06
      near(d.N.score!, ref.N, 0.06); near(d.V.score!, ref.V, 0.06); near(d.F.score!, ref.F, 0.06);
      near(got.g, ref.G, 0.06);
      expect(got.result.level).toBe(ref.level);
      near(got.result.margins.find((m) => m.id === 'L3/L4')!.margin, ref.margin, 0.06);
    });
  }
  it('D34 — L2 на границе L3 (0,5 очка до 40); A — L3 не на границе', () => {
    const byName = (n: string) => namedProfiles().find((p) => p.name === n)!;
    expect(probeLevel(byName('D34').state).result.onBorder).toEqual(['L2/L3']);
    expect(probeLevel(byName('A Студент').state).result.onBorder).toEqual([]);
  });
});

describe('доли уровней на пуле проб (спец. 7.2, колонка v4)', () => {
  const tally = (states: ReturnType<typeof build>[]) => {
    const c = [0, 0, 0, 0];
    for (const s of states) c[probeLevel(s).result.level - 1]!++;
    return c;
  };
  it('случайные R1–R400: 5 / 60 / 214 / 121', () => {
    expect(tally(Array.from({ length: 400 }, (_, i) => build(randomSpec(i + 1))))).toEqual(LEVELS.shares.random.counts);
  }, 120_000);
  it('динамические D1–D400: 24 / 61 / 204 / 111', () => {
    expect(tally(Array.from({ length: 400 }, (_, i) => build(randomSpecDyn(i + 1))))).toEqual(LEVELS.shares.dynamic.counts);
  }, 120_000);
  it('стресс 0–319: 32 / 60 / 144 / 84', () => {
    expect(tally(Array.from({ length: 320 }, (_, i) => { const c = stressCase(i); return applyProbeOpts(c.state, c.opts); }))).toEqual(LEVELS.shares.stress.counts);
  }, 120_000);
});

describe('профили независимости FI1–FI8 (T15a)', () => {
  const REF = fixtureJson<{ profiles: Record<string, { before: { level: number }; after: { level: number } }> }>('position/independence-reference.json');
  const fi = independenceProfiles();
  it('до правки V1 все восемь — L3 (таблица 10.9)', () => {
    for (const p of fi) expect(probeLevel(p.state).result.level, p.name).toBe(REF.profiles[p.name]!.before.level);
  });
  it('после правки V1 (D = 24): FI1, FI2, FI8 → L4, FI3–FI7 → L3', () => {
    for (const p of fi) expect(levelFromIndicators(computeIndicators(p.state, TODAY))!.result.level, p.name).toBe(REF.profiles[p.name]!.after.level);
  });
  it('FI1, FI2, FI8: запас до L4 больше 1 очка, пометки «на границе» нет', () => {
    for (const p of fi.filter((x) => ['FI1', 'FI2', 'FI8'].includes(x.name))) {
      const r = levelFromIndicators(computeIndicators(p.state, TODAY))!.result;
      expect(r.margins.find((m) => m.id === 'L3/L4')!.margin, p.name).toBeGreaterThan(1);
      expect(r.onBorder, p.name).toEqual([]);
    }
  });
});
