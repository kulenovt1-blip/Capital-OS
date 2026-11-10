/**
 * T06 «Положение» v4: неизвестное — интервалы по природе показателя, достаточность направления, ограничители, диапазон `G`,
 * правило показа ориентира, достоверность.
 *
 * Источники ожидаемых значений — НЕ код движка:
 *  1. tests/fixtures/position/range-reference.json — снят кодом проб (boundsFor/maskInd/dir3/aggG из measure3.ts, exp26.ts) на 1200 случаях
 *     «профиль × тип неизвестного» (R1–R120, D1–D120 × 5 типов) и итог по всем 4000 случаям (показано 52,6 %);
 *  2. ручная арифметика на синтетических входах (веса направлений, границы интервалов, пороги показа).
 * Показатели для сверки с пробой считаются без правки D (`v1CapMonths: Infinity`), как в пробе; с правкой D доля показанных ориентиров должна оставаться 53 % ± 2 п. п.
 */
import { describe, it, expect } from 'vitest';
import { computeIndicators, INDICATOR_WEIGHTS, type Indicators, type IndicatorInputs, type ForecastFacts } from '../../engine/position/indicators';
import { directionScore, isDirectionSufficient, SUFFICIENT_WEIGHT_SHARE } from '../../engine/position/directions';
import { aggregateG, geometricMean, limitStates, withoutForecast, LIMIT_VALUES, type LimitStates } from '../../engine/position/limits';
import { boundsContext, boundsFor, historyBounds, maskIndicators, MASK_KINDS, MASKS, type BoundsContext, type MaskKind } from '../../engine/position/unknown';
import { positionRange, canShowPoint, levelBandOf, RANGE_MAX_LEVELS, RANGE_MAX_WIDTH, LEVEL_BOUNDS } from '../../engine/position/range';
import { confidenceFrom, confidenceOf, isPreliminary, CONFIDENCE_PRELIMINARY_BELOW } from '../../engine/position/confidence';
import { buildPositionSeries } from '../../engine/position/series';
import { emptyState } from '../../engine/state';
import { fixtureJson } from '../support/fixtures';
import { build, randomSpec, randomSpecDyn, SPECS2, TODAY } from '../support/position-profiles';

type RefCase = { name: string; kind: MaskKind; lo: number; mid: number; hi: number; w: number; span: number };
const REF = fixtureJson<{ today: string; totals: { cases: number; shown: number; sharePercent: number }; cases: RefCase[] }>('position/range-reference.json');
const near = (a: number, b: number, digits = 6) => expect(Math.abs(a - b)).toBeLessThan(10 ** -digits);

/** Профиль пула проб: R — случайные, D — динамические. */
const generated = (label: 'R' | 'D', i: number) => build((label === 'R' ? randomSpec : randomSpecDyn)(i));

function rangeFor(state: ReturnType<typeof build>, kind: MaskKind, v1CapMonths?: number) {
  const series = buildPositionSeries(state, TODAY);
  const report = computeIndicators(state, TODAY, series, v1CapMonths === undefined ? {} : { v1CapMonths });
  const masked = maskIndicators(report.values, kind);
  if (!Object.values(masked).some((v) => v === null)) return null;
  const ctx = boundsContext(series, report.inputs!, v1CapMonths);
  const base = limitStates(report.inputs!, report.forecast!);
  const states = kind === 'noSched' || kind === 'noForecast' ? withoutForecast(base) : base;
  return positionRange(masked, boundsFor(kind, ctx), states);
}

describe('диапазон G совпадает с пробой (1200 случаев)', () => {
  const byName = new Map<string, RefCase[]>();
  for (const c of REF.cases) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  it('состав эталона: 240 профилей, 4000 случаев в итоге, 52,6 %', () => {
    expect(byName.size).toBe(240);
    expect(REF.totals.cases).toBe(4000);
    expect(REF.totals.sharePercent).toBeCloseTo(52.65, 1);
    expect(REF.today).toBe(TODAY);
  });
  for (const [name, cases] of byName) {
    it(name, () => {
      const st = generated(name[0] as 'R' | 'D', Number(name.slice(1)));
      const got = MASK_KINDS.map((k) => ({ kind: k, r: rangeFor(st, k, Infinity) })).filter((x) => x.r !== null);
      expect(got.map((x) => x.kind)).toEqual(cases.map((c) => c.kind));
      got.forEach((x, i) => {
        const c = cases[i]!;
        near(x.r!.low, c.lo); near(x.r!.point, c.mid); near(x.r!.high, c.hi);
        near(x.r!.width, c.w);
        expect(x.r!.levelsCovered - 1).toBe(c.span);
      });
    });
  }
});

describe('показ ориентира: на 4000 случаях доля 53 % ± 2 п. п.', () => {
  it('все 800 профилей × 5 типов неизвестного, показатели с правкой D = 24', () => {
    let all = 0, shown = 0;
    for (const label of ['R', 'D'] as const) for (let i = 1; i <= 400; i++) {
      const st = generated(label, i);
      const series = buildPositionSeries(st, TODAY);
      const report = computeIndicators(st, TODAY, series);
      const ctx = boundsContext(series, report.inputs!);
      const base = limitStates(report.inputs!, report.forecast!);
      for (const kind of MASK_KINDS) {
        const masked = maskIndicators(report.values, kind);
        if (!Object.values(masked).some((v) => v === null)) continue;
        const r = positionRange(masked, boundsFor(kind, ctx), kind === 'noSched' || kind === 'noForecast' ? withoutForecast(base) : base)!;
        all++; if (r.showPoint) shown++;
      }
    }
    expect(all).toBe(4000);
    const share = (100 * shown) / all;
    expect(share).toBeGreaterThan(51);
    expect(share).toBeLessThan(55);
  }, 120_000);
});

describe('достаточность направления (спец. 6)', () => {
  const full: Indicators = { N1: 80, N2: 60, N3: 100, N4: 20, V1: 70, V2: 50, V4: 100, F1: 80, F2: 90, F3: 65, F4: 70 };
  const without = (...ids: (keyof Indicators)[]): Indicators => { const o: Indicators = { ...full }; for (const i of ids) o[i] = null; return o; };
  it('порог 70 % — константа', () => {
    expect(SUFFICIENT_WEIGHT_SHARE).toBe(0.7);
  });
  it('оценка — взвешенное среднее: N = 0,30·80 + 0,25·60 + 0,20·100 + 0,25·20 = 64', () => {
    near(directionScore(full, 'N').score!, 64, 9);
  });
  it('неизвестный показатель выпадает из среднего, веса перенормируются', () => {
    // N без N4: (24 + 15 + 20) / 0,75
    near(directionScore(without('N4'), 'N').score!, (24 + 15 + 20) / 0.75, 9);
  });
  it('не применимый показатель (нет ключа) не входит в знаменатель веса: V без V3 — вес 0,85', () => {
    const d = directionScore(full, 'V');
    near(d.totalWeight, 0.85, 9);
    expect(d.applicable).toBe(3);
  });
  it('N без N4 — достаточно (0,75 ≥ 0,7), без обязательного N2 — недостаточно', () => {
    expect(isDirectionSufficient(directionScore(without('N4'), 'N'))).toBe(true);
    expect(isDirectionSufficient(directionScore(without('N2'), 'N'))).toBe(false);
    expect(isDirectionSufficient(directionScore(without('N1'), 'N'))).toBe(false);
  });
  it('V без V4 — достаточно (0,65 / 0,85), без V1 или V2 — недостаточно', () => {
    expect(isDirectionSufficient(directionScore(without('V4'), 'V'))).toBe(true);
    expect(isDirectionSufficient(directionScore(without('V1'), 'V'), 0.5)).toBe(false);
    expect(isDirectionSufficient(directionScore(without('V2'), 'V'), 0.5)).toBe(false);
  });
  it('F без F4 — достаточно (0,8), без F3 и F4 — нет (0,65 < 0,7), без F2 — нет', () => {
    expect(isDirectionSufficient(directionScore(without('F4'), 'F'))).toBe(true);
    expect(isDirectionSufficient(directionScore(without('F3', 'F4'), 'F'))).toBe(false);
    expect(isDirectionSufficient(directionScore(without('F2'), 'F'))).toBe(false);
  });
  it('ничего не известно → оценки нет, направление недостаточно', () => {
    const none: Indicators = { F1: null, F2: null, F3: null, F4: null };
    const d = directionScore(none, 'F');
    expect(d.score).toBeNull();
    expect(isDirectionSufficient(d)).toBe(false);
  });
  it('веса из спецификации', () => {
    expect(INDICATOR_WEIGHTS.N1 + INDICATOR_WEIGHTS.N2 + INDICATOR_WEIGHTS.N3 + INDICATOR_WEIGHTS.N4).toBeCloseTo(1, 9);
  });
});

describe('ограничители и G', () => {
  const none: LimitStates = { cover1: 'no', gap: 'no', cliff: 'no' };
  it('среднее геометрическое; значения ниже 1 поднимаются до 1', () => {
    near(geometricMean([80, 80, 80]), 80, 9);
    near(geometricMean([100, 25, 4]), Math.pow(100 * 25 * 4, 1 / 3), 9);
    near(geometricMean([0, 100]), 10, 9); // sqrt(1·100)
  });
  it('пределы ограничителей — 39 / 59 / 59', () => {
    expect(LIMIT_VALUES).toEqual({ cover1: 39, gap: 59, cliff: 59 });
  });
  it('без ограничителей G — среднее; сработавший режет сверху и попадает в список', () => {
    expect(aggregateG([80, 80, 80], none, 'point')).toEqual({ g: expect.closeTo(80, 9), fired: [] });
    expect(aggregateG([80, 80, 80], { ...none, cover1: 'yes' }, 'point')).toEqual({ g: 39, fired: ['cover1'] });
    expect(aggregateG([80, 80, 80], { ...none, gap: 'yes', cliff: 'yes' }, 'point')).toEqual({ g: 59, fired: ['gap'] }); // второй уже ничего не режет
  });
  it('ограничитель не «срабатывает», если G и так ниже предела', () => {
    expect(aggregateG([30, 30, 30], { ...none, gap: 'yes' }, 'point')!.fired).toEqual([]);
  });
  it('неизвестный ограничитель: в нижней оценке применяется, в верхней и в ориентире — нет', () => {
    const unk: LimitStates = { cover1: 'no', gap: 'unknown', cliff: 'no' };
    expect(aggregateG([80, 80, 80], unk, 'low')!.g).toBe(59);
    near(aggregateG([80, 80, 80], unk, 'high')!.g, 80, 9);
    near(aggregateG([80, 80, 80], unk, 'point')!.g, 80, 9);
  });
  it('нет направлений → null', () => {
    expect(aggregateG([], none, 'point')).toBeNull();
  });
  const inputs = (reserveEssentialMonths: number, netLiquid = 0, needLifestyle = 200): IndicatorInputs => ({
    needEssential: 100, needLifestyle, liquid: netLiquid, netLiquid, net: 0, debtTotal: 0, obligationsMonthly: 0, incomeMonthly: 0, manualIncomeMonthly: 0,
    reserveEssentialMonths, reserveLifestyleMonths: 0, troughNet: 0,
  });
  const src = (monthly: number, endsWithin6m: boolean, status: 'P' | 'T' | 'X' | 'I' = 'P') => ({ status, monthly, volume: monthly * 12, endsWithin6m });
  it('«нет запаса»: меньше 1 месяца необходимых — да, ровно 1 — нет', () => {
    const f: ForecastFacts = { hasGap: false, sources: [] };
    expect(limitStates(inputs(0.99), f).cover1).toBe('yes');
    expect(limitStates(inputs(1), f).cover1).toBe('no');
  });
  it('«разрыв в прогнозе»', () => {
    expect(limitStates(inputs(5), { hasGap: true, sources: [] }).gap).toBe('yes');
    expect(limitStates(inputs(5), { hasGap: false, sources: [] }).gap).toBe('no');
  });
  it('«обрыв дохода»: ≥ 50 % подтверждённого дохода кончается и денег после этого хватает меньше чем на 12 мес.', () => {
    // расходы 200; доход 300 + 300, один кончается: остаётся 300 → дефицита нет → не срабатывает
    expect(limitStates(inputs(5, 1000), { hasGap: false, sources: [src(300, true), src(300, false)] }).cliff).toBe('no');
    // доход 400 + 100, кончается 400 (80 %): остаётся 100, дефицит 100 в месяц; запас 1100 → 11 мес. < 12 → да
    expect(limitStates(inputs(5, 1100), { hasGap: false, sources: [src(400, true), src(100, false)] }).cliff).toBe('yes');
    // запас 1200 → ровно 12 мес. → нет
    expect(limitStates(inputs(5, 1200), { hasGap: false, sources: [src(400, true), src(100, false)] }).cliff).toBe('no');
    // кончается 49 % → нет
    expect(limitStates(inputs(5, 0), { hasGap: false, sources: [src(49, true), src(51, false)] }).cliff).toBe('no');
    // ожидаемый доход (X) в «текущий» не входит
    expect(limitStates(inputs(5, 0), { hasGap: false, sources: [src(100, true), src(900, false, 'X')] }).cliff).toBe('yes');
  });
  it('без прогноза gap и cliff неизвестны, cover1 остаётся', () => {
    expect(withoutForecast({ cover1: 'yes', gap: 'no', cliff: 'no' })).toEqual({ cover1: 'yes', gap: 'unknown', cliff: 'unknown' });
  });
});

describe('интервалы неизвестного: арифметика', () => {
  const ctx = (over: Partial<BoundsContext> = {}): BoundsContext => ({
    income: [400, 400, 400, 400, 400, 400, 400, 400], expense: [260, 260, 260, 260, 260, 260, 260, 260], free: [140, 140, 140, 140, 140, 140, 140, 140],
    netNowConfirmed: 1000, netAgoConfirmed: [1000, 860, 720, 580, 440, 300, 160], needLifestyle: 260, needEssential: 200, netLiquid: 600, incomeMonthly: 400, v1CapMonths: 24, ...over,
  });
  it('какие показатели скрывает тип неизвестного', () => {
    expect(MASKS.hist2).toEqual(['N2', 'V1', 'V2', 'V3', 'V4']);
    expect(MASKS.noSched).toEqual(['F2', 'F3', 'F4']);
    expect(MASKS.noForecast).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(MASKS.noDebt).toEqual(['N3', 'V3']);
  });
  it('история 2 мес., остаток 35 % дохода: N2 от (0,35 − 0,2 → 55) до (0,55 → 100); V4 от 2/6 до 100; V2 — вся шкала', () => {
    const b = historyBounds(ctx(), 2);
    near(b.N2![0], 40 + (30 * 0.05) / 0.1, 9); near(b.N2![1], 100, 9);
    near(b.V4![0], 100 / 3, 9); near(b.V4![1], 100, 9);
    expect(b.V2).toEqual([0, 100]);
    expect(b.V3).toEqual([0, 100]);
  });
  it('история 4 мес.: V2 — сравнение половин; ровный поток → тренд 0 → [normalize(−0,3)=0, normalize(0,3)=100]', () => {
    const b = historyBounds(ctx(), 4);
    near(b.V2![0], 0, 9); near(b.V2![1], 100, 9);
  });
  it('V1: рост 70 в месяц при знаменателе max(капитал 860, 3 × 260 = 780) = 860, допуск ± 0,02', () => {
    const b = historyBounds(ctx({ netAgoConfirmed: [1000, 930, 860, 790, 720, 650, 580] }), 2);
    const r = 70 / 860; // 0,0814
    near(b.V1![0], 80 + (20 * (r - 0.02 - 0.05)) / 0.05, 9); // 84,56
    near(b.V1![1], 100, 9); // r + 0,02 = 0,1014 ≥ 0,1
  });
  it('V1 при огромном капитале использует ограничение D (как сам показатель)', () => {
    const big = ctx({ netNowConfirmed: 1e9 + 600, netAgoConfirmed: [1e9 + 600, 0, 1e9], needLifestyle: 100 });
    const capped = historyBounds(big, 2).V1!;
    const uncapped = historyBounds({ ...big, v1CapMonths: Infinity }, 2).V1!;
    expect(capped[1]).toBeGreaterThan(uncapped[1]);
  });
});

describe('интервалы неизвестного: F1–F4 и «нет долгов»', () => {
  const ctx: BoundsContext = {
    income: [400, 400, 400, 400, 400, 400], expense: [260, 260, 260, 260, 260, 260], free: [140, 140, 140, 140, 140, 140],
    netNowConfirmed: 0, netAgoConfirmed: [0, 0, 0, 0, 0, 0, 0], needLifestyle: 260, needEssential: 200, netLiquid: 600, incomeMonthly: 400, v1CapMonths: 24,
  };
  it('нет прогноза: F1 от max(0, запас − 15,6 мес.) до запас + маржа; запас 3 мес., маржа 1 → [0; 58,3]', () => {
    const b = boundsFor('noForecast', ctx);
    near(b.F1![0], 0, 9);
    near(b.F1![1], 50 + (25 * (4 - 3)) / 3, 9);
  });
  it('нет расписания: F2 от 0,2·(доход ÷ необходимое) до доход ÷ необходимое', () => {
    const b = boundsFor('noSched', ctx);
    near(b.F2![0], 32, 9); // 0,2 × 2 = 0,4 → 40 × 0,4 / 0,5
    expect(b.F2![1]).toBe(100); // 2 ≥ 1,5
  });
  it('нет расписания: F3 — [34; 88,3]; F4 — по исторической норме 35 % − 0,15 … + 0,05', () => {
    const b = boundsFor('noSched', ctx);
    near(b.F3![0], 34, 9);
    near(b.F3![1], 65 + (35 * (0.15 - 0.05)) / 0.15, 9);
    const rate = (400 - 260) / 400; // 0,35
    near(b.F4![0], 40 + (30 * (rate - 0.15 - 0.1)) / 0.1, 9);
    near(b.F4![1], 100, 9);
  });
  it('долги неизвестны: N3 и V3 — вся шкала', () => {
    expect(boundsFor('noDebt', ctx)).toEqual({ N3: [0, 100], V3: [0, 100] });
  });
  it('нет наблюдённых месяцев — вся шкала', () => {
    const b = historyBounds({ ...ctx, income: [], expense: [], free: [] }, 2);
    expect(b.N2).toEqual([0, 100]); expect(b.V4).toEqual([0, 100]);
  });
});

describe('маски', () => {
  it('скрывает только применимые: V3 без ключа не появляется', () => {
    const ind: Indicators = { N1: 1, N2: 2, N3: 3, N4: 4, V1: 5, V2: 6, V4: 7, F1: 8, F2: 9, F3: 10, F4: 11 };
    const m = maskIndicators(ind, 'hist2');
    expect('V3' in m).toBe(false);
    expect([m.N2, m.V1, m.V2, m.V4]).toEqual([null, null, null, null]);
    expect([m.N1, m.N3, m.N4, m.F1]).toEqual([1, 3, 4, 8]);
    expect(ind.N2).toBe(2); // исходные не меняются
  });
});

describe('диапазон и правило показа ориентира', () => {
  it('константы: ширина 20, не более двух уровней, границы L2/L3/L4 = 20/40/75', () => {
    expect(RANGE_MAX_WIDTH).toBe(20);
    expect(RANGE_MAX_LEVELS).toBe(2);
    expect(LEVEL_BOUNDS).toEqual([20, 40, 75]);
  });
  it('уровень по G: 19,99 → 1; 20 → 2; 39,99 → 2; 40 → 3; 74,99 → 3; 75 → 4', () => {
    expect([19.99, 20, 39.99, 40, 74.99, 75, 100].map(levelBandOf)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });
  it('ориентир: ширина 20 и два уровня — показан; 20,01 или три уровня — скрыт', () => {
    expect(canShowPoint(20, 2)).toBe(true);
    expect(canShowPoint(20.01, 2)).toBe(false);
    expect(canShowPoint(5, 3)).toBe(false);
    expect(canShowPoint(0, 1)).toBe(true);
  });
  it('все показатели известны → диапазон вырождается в точку, ориентир показан', () => {
    const ind: Indicators = { N1: 80, N2: 80, N3: 80, N4: 80, V1: 80, V2: 80, V4: 80, F1: 80, F2: 80, F3: 80, F4: 80 };
    const r = positionRange(ind, {}, { cover1: 'no', gap: 'no', cliff: 'no' })!;
    near(r.low, 80, 9); near(r.high, 80, 9); near(r.point, 80, 9);
    expect(r.width).toBeCloseTo(0, 9);
    expect(r.levelsCovered).toBe(1);
    expect(r.showPoint).toBe(true);
  });
  it('неизвестная «Безопасность будущего» целиком — диапазон шире, ориентир скрыт; нижняя оценка учитывает возможные ограничители', () => {
    const ind: Indicators = { N1: 80, N2: 80, N3: 80, N4: 80, V1: 80, V2: 80, V4: 80, F1: null, F2: null, F3: null, F4: null };
    const f: [number, number] = [60, 90];
    const r = positionRange(ind, { F1: f, F2: f, F3: f, F4: f }, { cover1: 'no', gap: 'unknown', cliff: 'unknown' })!;
    near(r.low, 59, 9); // (80·80·60)^(1/3) = 72,7, но «возможный разрыв» режет до 59
    expect(r.firedLow).toEqual(['gap']);
    near(r.high, Math.pow(80 * 80 * 90, 1 / 3), 9); // 83,2: неизвестные ограничители сверху не применяются
    near(r.point, Math.pow(80 * 80 * 75, 1 / 3), 9);
    expect(r.width).toBeGreaterThan(RANGE_MAX_WIDTH);
    expect(r.showPoint).toBe(false);
  });
  it('нет ни одного известного показателя и интервала — диапазон от 1 до 100, не «0»', () => {
    const ind: Indicators = { N1: null, N2: null, N3: null, N4: null, V1: null, V2: null, V4: null, F1: null, F2: null, F3: null, F4: null };
    const r = positionRange(ind, {}, { cover1: 'no', gap: 'no', cliff: 'no' })!;
    expect(r.low).toBe(1); // нижнее направление поднимается до 1 (среднее геометрическое)
    near(r.high, 100, 9);
  });
});

describe('достоверность', () => {
  it('полный год данных без непроверенных трат → 1; полгода → 0,5; доля непроверенных вычитается', () => {
    expect(confidenceFrom({ monthsOfData: 12, usualMonthly: 100, uncheckedMonthly: 0 })).toBe(1);
    expect(confidenceFrom({ monthsOfData: 24, usualMonthly: 100, uncheckedMonthly: 0 })).toBe(1);
    expect(confidenceFrom({ monthsOfData: 6, usualMonthly: 100, uncheckedMonthly: 0 })).toBe(0.5);
    near(confidenceFrom({ monthsOfData: 12, usualMonthly: 100, uncheckedMonthly: 20 }), 0.8, 9);
    near(confidenceFrom({ monthsOfData: 6, usualMonthly: 100, uncheckedMonthly: 20 }), 0.4, 9);
  });
  it('нет обычных расходов — доля непроверенных 0; доля не выходит за 0…1', () => {
    expect(confidenceFrom({ monthsOfData: 12, usualMonthly: 0, uncheckedMonthly: 50 })).toBe(1);
    expect(confidenceFrom({ monthsOfData: 12, usualMonthly: 10, uncheckedMonthly: 50 })).toBe(0);
  });
  it('«предварительно» строго ниже 0,5', () => {
    expect(CONFIDENCE_PRELIMINARY_BELOW).toBe(0.5);
    expect(isPreliminary(0.49)).toBe(true);
    expect(isPreliminary(0.5)).toBe(false);
  });
  it('без операций достоверность 0; на профиле B (14 мес. данных) — выше 0,9', () => {
    expect(confidenceOf(emptyState(), TODAY)).toBe(0);
    expect(confidenceOf(build(SPECS2[1]!), TODAY)).toBeGreaterThan(0.9);
  });
});

describe('нет расписания доходов: F2–F4 неизвестны, а не нули', () => {
  it('профиль B без строк расписания', () => {
    const b = build(SPECS2[1]!);
    const v = computeIndicators({ ...b, settings: { ...b.settings, incomeSchedule: [] } }, TODAY).values;
    expect([v.F2, v.F3, v.F4]).toEqual([null, null, null]);
    expect(v.F1).toBeNull(); // К1 (D154): без расписания направление «Будущее» неизвестно целиком
    expect(typeof v.N1).toBe('number');
  });
});

describe('К1 (D154): без расписания доходов оценка лежит внутри диапазона и не опускает ступень до «Не хватает на жизнь»', () => {
  it('профиль B без расписания: G в [low; high], ступень не ниже 3 при запасе ≥ 3 мес.', async () => {
    const { positionViewOf } = await import('../../engine/position/view');
    const b = build(SPECS2[1]!);
    const v = positionViewOf({ ...b, settings: { ...b.settings, incomeSchedule: [] } }, TODAY);
    expect(v.range).not.toBeNull();
    expect(v.g!).toBeGreaterThanOrEqual(v.range!.low - 1e-9);
    expect(v.g!).toBeLessThanOrEqual(v.range!.high + 1e-9);
    expect(v.money.reserveEssentialMonths).toBeGreaterThanOrEqual(3);
    expect(v.level!).toBeGreaterThanOrEqual(3);
  });
});
