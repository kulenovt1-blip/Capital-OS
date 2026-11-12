/**
 * T05 «Положение» v4: показатели N1–N4, V1–V4, F1–F4.
 *
 * Источники ожидаемых значений — НЕ код движка:
 *  1. tests/fixtures/position/indicators-reference.json — снят запуском measure()/series4()/ind3() из проб (127 синтетических профилей);
 *     V1 при положительном росте — по model-final.md §1.2 (D = 24);
 *  2. ручная арифметика на границах шкал и на примерах спецификации (V1 36→67,5 при капитале 1000 месяцев; V3 «долг 10 млн» из unit_v3dev.ts; F3 из таблицы раздела 8).
 * Намеренные отличия от пробы (D133): запас N1/F1 — от доступных денег минус долг людям (в эталоне — отдельное поле `indNet`, для профилей без долга людям
 * совпадает с пробой); ручной пассивный доход входит в средний доход; без операций — всё `null`.
 */
import { describe, it, expect } from 'vitest';
import {
  computeIndicators, emptyIndicators, normalize, SCALES, INDICATOR_IDS, INDICATOR_WEIGHTS, KEY_INDICATORS, V1_CAPITAL_CAP_MONTHS, V3_MIN_DEVIATION,
  reserveScore, n1Score, savingScore, debtLoadScore, capitalScore, growthScore, flowTrendScore, debtDeviationScore, keepScore, reliabilityScore, exposureScore,
  forecastSavingRate, monthRate, medianOf, type IndicatorId, type Indicators,
} from '../../engine/position/indicators';
import { emptyState } from '../../engine/state';
import { tenge } from '../../engine/money';
import { fixtureJson } from '../support/fixtures';
import { applyProbeOpts, build, probeProfiles, SPECS2, TODAY } from '../support/position-profiles';

type Ref = { family: string; ind: Record<string, number | null>; v1Old: number | null; payablesNow: number; indNet: { N1: number; F1: number }; raw: Record<string, number> };
const REF = fixtureJson<{ today: string; profiles: Record<string, Ref> }>('position/indicators-reference.json');
const profiles = probeProfiles();
const near = (a: number, b: number, digits = 6) => expect(Math.abs(a - b)).toBeLessThan(10 ** -digits);

describe('эталон проб: состав', () => {
  it('профили совпадают с эталоном по именам (127), дата — дата проб', () => {
    expect(profiles.map((p) => p.name).sort()).toEqual(Object.keys(REF.profiles).sort());
    expect(REF.today).toBe(TODAY);
  });
  it('на профилях без долга людям расширение «чистая ликвидность» совпадает с пробой (N1, F1)', () => {
    let n = 0;
    for (const [name, r] of Object.entries(REF.profiles)) {
      if (r.payablesNow !== 0) continue;
      n++;
      near(r.indNet.N1, r.ind.N1!, 9); near(r.indNet.F1, r.ind.F1!, 9);
      void name;
    }
    expect(n).toBe(121);
  });
});

describe('каждый показатель равен пробе на всех профилях', () => {
  for (const p of profiles) {
    it(p.name, () => {
      const ref = REF.profiles[p.name]!;
      const expected: Record<string, number | null> = { ...ref.ind, N1: ref.indNet.N1, F1: ref.indNet.F1 };
      const got = computeIndicators(applyProbeOpts(p.state, p.opts), TODAY).values as Record<string, number | null>;
      expect(Object.keys(got).sort()).toEqual(Object.keys(expected).sort()); // null и «нет ключа» различаются
      for (const k of Object.keys(expected)) {
        if (expected[k] === null) expect(got[k], k).toBeNull();
        else near(got[k] as number, expected[k] as number);
      }
    });
  }
});

describe('именные профили: значения из спецификации (раздел 7.4, 9.2, 8)', () => {
  const at = (i: number) => computeIndicators(build(SPECS2[i]!), TODAY).values;
  const r0 = (x: number | null | undefined) => Math.round(x as number);
  it('студент A: N1 79, N2 86, N3 45, N4 17; V1 100, V2 50, V4 100; F1 83, F2 93, F3 56, F4 83', () => {
    const v = at(0);
    expect([v.N1, v.N2, v.N3, v.N4, v.V1, v.V2, v.V4, v.F1, v.F2, v.F3, v.F4].map(r0)).toEqual([79, 86, 45, 17, 100, 50, 100, 83, 93, 56, 83]);
    expect('V3' in v).toBe(false);
  });
  it('B: F2 100, F3 65; D: F2 100; C: F2 83; E: F2 43', () => {
    expect([at(1).F2, at(1).F3, at(3).F2, at(2).F2, at(4).F2].map(r0)).toEqual([100, 65, 100, 83, 43]);
  });
});

describe('шкалы: точки и границы', () => {
  for (const [name, pts] of Object.entries(SCALES)) {
    it(`${name}: в каждой точке — её значение; левее — первое, правее — последнее; между — линейно`, () => {
      for (const [x, y] of pts) near(normalize(x, pts), y, 9);
      near(normalize(pts[0]![0] - 1000, pts), pts[0]![1], 9);
      near(normalize(pts[pts.length - 1]![0] + 1000, pts), pts[pts.length - 1]![1], 9);
      for (let i = 1; i < pts.length; i++) near(normalize((pts[i - 1]![0] + pts[i]![0]) / 2, pts), (pts[i - 1]![1] + pts[i]![1]) / 2, 9);
    });
    it(`${name}: значение всегда в 0–100`, () => {
      for (const [x] of pts) for (const d of [-1e9, -1, 0, 1, 1e9]) { const y = normalize(x + d, pts); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(100); }
    });
  }
  it('не число (NaN, Infinity) не превращается в оценку выше нуля', () => {
    expect(normalize(NaN, SCALES.reserve)).toBe(0);
    expect(normalize(Infinity, SCALES.reserve)).toBe(0);
  });
  it('точки шкал из спецификации не изменены', () => {
    expect(SCALES.growth).toEqual([[-0.03, 0], [0, 35], [0.02, 60], [0.05, 80], [0.1, 100]]);
    expect(SCALES.debtDeviation).toEqual([[-0.3, 0], [0, 50], [0.3, 100]]);
    expect(SCALES.reserve).toEqual([[0, 0], [1, 25], [3, 50], [6, 75], [12, 100]]);
  });
});

describe('формулы показателей', () => {
  it('запас: 0 → 0, 1 мес. → 25, 3 → 50, 6 → 75, 12 и больше → 100; отрицательные деньги = 0; нет расходов → 0', () => {
    expect([0, 100, 300, 600, 1200, 5000].map((m) => reserveScore(m, 100))).toEqual([0, 25, 50, 75, 100, 100]);
    expect(reserveScore(-500, 100)).toBe(0);
    expect(reserveScore(500, 0)).toBe(0);
  });
  it('N1 — среднее двух запасов', () => {
    expect(n1Score(300, 100, 300)).toBe((50 + 25) / 2);
  });
  it('норма сбережений: −1 → 0, 0 → 0, 10 % → 40, 20 % → 70, 35 % и больше → 100', () => {
    expect([-1, 0, 0.1, 0.2, 0.35, 0.9].map(savingScore)).toEqual([0, 0, 40, 70, 100, 100]);
  });
  it('долговая нагрузка: нет долга → 100; берётся меньшая из двух оценок; нет дохода → 100 (доли 0)', () => {
    expect(debtLoadScore(0, 0, 400)).toBe(100);
    expect(debtLoadScore(60, 0, 400)).toBe(75); // платежи 15 %
    near(debtLoadScore(10, 4800 * 2, 400), 0, 9); // остаток долга 2 года дохода → 0, хотя платежи малы
    expect(debtLoadScore(180, 0, 400)).toBe(0); // 45 %
    expect(debtLoadScore(100, 100, 0)).toBe(0); // D171: нет дохода, но есть долг — не «отлично»
    expect(debtLoadScore(100, 0, 0)).toBe(0);
    expect(debtLoadScore(0, 100, 0)).toBe(0);
    expect(debtLoadScore(0, 0, 0)).toBe(100); // ни дохода, ни долга
  });
  it('капитал: отрицательный → 0, 6 мес. → 25, 36 → 60, 300 и больше → 100; нет расходов → 0', () => {
    expect([-1000, 0, 600, 3600, 30000, 99999].map((n) => capitalScore(n, 100))).toEqual([0, 0, 25, 60, 100, 100]);
    expect(capitalScore(1e9, 0)).toBe(0);
  });
  it('доля месяца: нет дохода и расхода → −1, нет дохода и нет расхода → 0', () => {
    expect(monthRate(0, -5)).toBe(-1);
    expect(monthRate(0, 0)).toBe(0);
    expect(monthRate(100, 20)).toBe(0.2);
  });
  it('медиана', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    expect(medianOf([])).toBe(0);
  });
  it('V2: разовая премия не двигает тренд (медианы), устойчивый рост — двигает', () => {
    expect(flowTrendScore([100, 100, 100, 100, 100, 100], 100)).toBe(50);
    expect(flowTrendScore([100, 100, 100, 100, 1000, 100], 100)).toBe(50); // разовый всплеск в последних трёх
    expect(flowTrendScore([100, 100, 100, 130, 130, 130], 100)).toBe(100); // +0,3 месячного образа
    expect(flowTrendScore([130, 130, 130, 100, 100, 100], 100)).toBe(0);
    expect(flowTrendScore([100, 100, 100, 100, 100, 100], 0)).toBe(50); // нет расходов → без тренда
  });
  it('V4: доля месяцев с положительным остатком из последних 6', () => {
    expect(keepScore([1, 1, 1, 1, 1, 1])).toBe(100);
    expect(keepScore([1, -1, 1, 0, 1, 1])).toBeCloseTo(66.666, 2);
    expect(keepScore([-1, -1, -1, -1, -1, -1])).toBe(0);
    expect(keepScore([-9, -9, 1, 1, 1, 1, 1, 1])).toBe(100); // только последние 6
  });
  it('V3: долг 10 млн, по графику −1,2 млн за 6 мес. — числа из unit_v3dev.ts', () => {
    const f = (dNow: number) => debtDeviationScore(10, 1.2, dNow);
    expect(f(8.8)).toBeNull(); // строго по графику — не применим
    expect(Math.round(f(7.8)!)).toBe(67); // досрочно +1 млн
    expect(Math.round(f(5.8)!)).toBe(100); // досрочно +3 млн
    expect(Math.round(f(10.8)!)).toBe(17); // новый заём +2 млн
    expect(Math.round(f(12.8)!)).toBe(0); // новый заём +4 млн
    expect(debtDeviationScore(0, 0, 0)).toBeNull(); // долга нет
    expect(V3_MIN_DEVIATION).toBe(0.02);
    expect(debtDeviationScore(100, 10, 89)).toBeNull(); // отклонение 1 % < 2 %
    expect(debtDeviationScore(100, 10, 87.9)).not.toBeNull(); // 2,1 %
  });
  it('F2 и F3: примеры из таблицы раздела 8 спецификации', () => {
    const one = (status: 'P' | 'T' | 'X' | 'I') => [{ status, volume: 100 }];
    expect(Math.round(exposureScore(one('P')))).toBe(65);
    expect(Math.round(exposureScore(one('T')))).toBe(34);
    expect(Math.round(exposureScore(one('I')))).toBe(34);
    expect(Math.round(exposureScore([{ status: 'I', volume: 50 }, { status: 'I', volume: 50 }]))).toBe(54);
    expect(Math.round(exposureScore([{ status: 'I', volume: 1 }, { status: 'I', volume: 1 }, { status: 'I', volume: 1 }]))).toBe(61);
    expect(exposureScore([])).toBe(10); // нет источников: опасность 1
    expect(reliabilityScore(one('P'), 100 / 12)).toBe(80); // 12 мес. дохода = 12 мес. необходимого
    expect(reliabilityScore(one('X'), 100 / 12)).toBe(40); // ожидаемый доход вдвое слабее
    expect(reliabilityScore(one('P'), 0)).toBe(0);
  });
  it('F4: доля от большего из дохода и расходов прогноза', () => {
    expect(forecastSavingRate(100, 80)).toBeCloseTo(0.2, 9);
    expect(forecastSavingRate(80, 100)).toBeCloseTo(-0.2, 9);
    expect(forecastSavingRate(0, 0)).toBe(0);
  });
});

describe('V1: ограничение знаменателя (D = 24)', () => {
  it('константа одна и равна 24', () => {
    expect(V1_CAPITAL_CAP_MONTHS).toBe(24);
  });
  it('капитал 1000 месяцев расходов, накопление 300 тыс. при расходах 400 тыс.: было ≈36, стало ≈67,5', () => {
    const need = 400_000, ago = 1000 * need, now = ago + 6 * 300_000;
    const oldScore = normalize(300_000 / ago, SCALES.growth);
    expect(oldScore).toBeGreaterThan(35); expect(oldScore).toBeLessThan(37);
    const v = growthScore(now, ago, need);
    // знаменатель 24 × 400 000 = 9,6 млн; 300 000 / 9,6 млн = 0,03125 → 60 + 20 × (0,03125 − 0,02) / 0,03
    near(v, 60 + (20 * (0.03125 - 0.02)) / 0.03, 9);
  });
  it('малый капитал — без изменений: знаменатель не ограничивается', () => {
    const need = 100_000, ago = 10 * need; // 10 месяцев < 24
    const now = ago + 6 * 20_000;
    near(growthScore(now, ago, need), normalize(20_000 / Math.max(ago, 3 * need), SCALES.growth), 9);
  });
  it('отрицательный рост — прежняя оценка, размер капитала не влияет', () => {
    const need = 100_000;
    near(growthScore(1000 * need - 6 * 5000, 1000 * need, need), normalize(-5000 / (1000 * need), SCALES.growth), 9);
  });
  it('отрицательный капитал (долги) не затронут: знаменатель — модуль капитала, но не меньше 3 месяцев образа', () => {
    const need = 100_000, ago = -50_000_000, now = ago + 6 * 500_000; // растёт, но капитал отрицательный
    near(growthScore(now, ago, need), normalize(500_000 / 50_000_000, SCALES.growth), 9);
  });
  it('результат — не хуже прежней оценки и не ниже по мере уменьшения предела D', () => {
    const need = 100_000, ago = 500 * need, now = ago + 6 * 50_000;
    const old = normalize(50_000 / ago, SCALES.growth);
    for (const d of [100, 36, 24, 18, 12]) { const v = growthScore(now, ago, need, 6, d); expect(v).toBeGreaterThanOrEqual(old); expect(v).toBeLessThanOrEqual(100); }
    expect(growthScore(now, ago, need, 6, 12)).toBeGreaterThan(growthScore(now, ago, need, 6, 36));
  });
});

describe('нет данных: null, а не 0', () => {
  it('без операций все показатели null (V3 не применим), inputs — null', () => {
    const r = computeIndicators(emptyState(), TODAY);
    for (const id of INDICATOR_IDS) {
      if (id === 'V3') expect(id in r.values).toBe(false);
      else expect(r.values[id], id).toBeNull();
    }
    expect(r.inputs).toBeNull();
    expect(emptyIndicators()).toEqual(r.values);
  });
  const hist = (from: string) => computeIndicators(build({ ...SPECS2[0]!, from }), TODAY).values;
  it('история 2 месяца: N2 и все показатели «Вектора» — null, остальные — числа', () => {
    const v = hist('2026-09');
    for (const id of ['N2', 'V1', 'V2', 'V4'] as IndicatorId[]) expect(v[id], id).toBeNull();
    for (const id of ['N1', 'N3', 'N4', 'F1', 'F2', 'F3', 'F4'] as IndicatorId[]) expect(typeof v[id], id).toBe('number');
  });
  it('история 3 месяца — N2 уже число; «Вектор» ещё null до 7 месяцев', () => {
    const v = hist('2026-08');
    expect(typeof v.N2).toBe('number');
    expect([v.V1, v.V2, v.V4]).toEqual([null, null, null]);
    const six = hist('2026-05');
    expect([six.V1, six.V2, six.V4]).toEqual([null, null, null]); // 6 полных месяцев
    const seven = hist('2026-04');
    for (const id of ['V1', 'V2', 'V4'] as IndicatorId[]) expect(typeof seven[id], id).toBe('number');
  });
});

describe('чистая ликвидность и ручной пассивный доход (D133)', () => {
  const spiral = profiles.find((p) => p.name === 'spiralA1')!;
  it('запас считается от доступных денег минус долг людям', () => {
    const r = computeIndicators(spiral.state, TODAY);
    const payables = REF.profiles.spiralA1!.payablesNow; // тенге
    expect(payables).toBeGreaterThan(0);
    near(r.inputs!.netLiquid, Math.max(0, r.inputs!.liquid - payables), 6);
    expect(r.inputs!.netLiquid).toBeGreaterThanOrEqual(0);
    expect(r.values.N1!).toBeLessThan(REF.profiles.spiralA1!.ind.N1!); // чище, чем в пробе: заёмные деньги не запас
  });
  it('пассивный доход из расписания: входит в средний доход (N3), но не в историю остатков (N2, V2, V4)', () => {
    const base = build(SPECS2[2]!); // C: платежи по долгам, N3 чувствителен к доходу
    const plain = computeIndicators(base, TODAY);
    const withPassive = computeIndicators({ ...base, settings: { ...base.settings, incomeSchedule: [...base.settings.incomeSchedule, { id: 'div', title: 'Дивиденды', dayOfMonth: 1, amount: tenge(100_000), kind: 'stable' as const, passive: true }] } }, TODAY);
    near(withPassive.inputs!.manualIncomeMonthly, 100_000, 6);
    near(withPassive.inputs!.incomeMonthly - plain.inputs!.incomeMonthly, 100_000, 6);
    expect(withPassive.values.N3!).toBeGreaterThan(plain.values.N3!);
    expect(withPassive.values.N2).toBe(plain.values.N2);
    expect(withPassive.values.V2).toBe(plain.values.V2);
    expect(withPassive.values.V4).toBe(plain.values.V4);
  });
  it('С5 (D162): пассивный доход вне срока (закончился или ещё не начался) в N3 не входит', () => {
    const base = build(SPECS2[2]!);
    const row = { id: 'rent', title: 'Аренда', dayOfMonth: 1, amount: tenge(150_000), kind: 'stable' as const, passive: true };
    const withRow = (extra: object) => computeIndicators({ ...base, settings: { ...base.settings, incomeSchedule: [...base.settings.incomeSchedule, { ...row, ...extra }] } }, TODAY).inputs!;
    expect(withRow({ end: '2025-01-31' }).manualIncomeMonthly).toBe(0);
    expect(withRow({ start: '2030-01-01' }).manualIncomeMonthly).toBe(0);
    near(withRow({ start: '2020-01-01', end: '2099-01-01' }).manualIncomeMonthly, 150_000, 6);
  });
  it('С5 (D170): доход, который уже есть в операциях (inHistory), второй раз не прибавляется', () => {
    const base = build(SPECS2[2]!);
    const row = { id: 'int', title: 'Проценты', dayOfMonth: 1, amount: tenge(50_000), kind: 'stable' as const, passive: true };
    const withRow = (extra: object) => computeIndicators({ ...base, settings: { ...base.settings, incomeSchedule: [...base.settings.incomeSchedule, { ...row, ...extra }] } }, TODAY);
    const none = computeIndicators(base, TODAY).inputs!;
    near(withRow({}).inputs!.manualIncomeMonthly, 50_000, 6); // не спрошено — как раньше
    near(withRow({ inHistory: false }).inputs!.manualIncomeMonthly, 50_000, 6);
    expect(withRow({ inHistory: true }).inputs!.manualIncomeMonthly).toBe(0);
    expect(withRow({ inHistory: true }).inputs!.incomeMonthly).toBe(none.incomeMonthly);
  });
  it('доход без признака «не зависит от труда» второй раз не считается: он уже в операциях', () => {
    const base = build(SPECS2[1]!);
    const same = computeIndicators({ ...base, settings: { ...base.settings, incomeSchedule: base.settings.incomeSchedule.map((i) => ({ ...i })) } }, TODAY);
    expect(same.inputs!.manualIncomeMonthly).toBe(0);
  });
});

describe('веса и обязательность', () => {
  it('веса каждого направления в сумме дают 1', () => {
    for (const d of ['N', 'V', 'F'] as const) near(INDICATOR_IDS.filter((i) => i[0] === d).reduce((a, i) => a + INDICATOR_WEIGHTS[i], 0), 1, 9);
  });
  it('веса и обязательные показатели — как в спецификации', () => {
    expect(INDICATOR_WEIGHTS).toEqual({ N1: 0.30, N2: 0.25, N3: 0.20, N4: 0.25, V1: 0.35, V2: 0.30, V3: 0.15, V4: 0.20, F1: 0.35, F2: 0.30, F3: 0.15, F4: 0.20 });
    expect(KEY_INDICATORS).toEqual({ N: ['N1', 'N2', 'N3'], V: ['V1', 'V2'], F: ['F1', 'F2'] });
  });
});

describe('инварианты', () => {
  it('все значения на профилях проб в пределах 0–100 или null', () => {
    for (const p of profiles) {
      const v: Indicators = computeIndicators(applyProbeOpts(p.state, p.opts), TODAY).values;
      for (const id of INDICATOR_IDS) { const x = v[id]; if (x !== null && x !== undefined) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); } }
    }
  });
  it('вычисление не меняет состояние и повторяемо', () => {
    const st = build(SPECS2[1]!);
    const before = JSON.stringify(st);
    const a = computeIndicators(st, TODAY), b = computeIndicators(st, TODAY);
    expect(JSON.stringify(st)).toBe(before);
    expect(a).toEqual(b);
  });
});
