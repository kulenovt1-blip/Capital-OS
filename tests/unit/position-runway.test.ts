/**
 * T08 «Положение» v4: runway — срок до исчерпания ресурсов при текущем отрицательном потоке.
 *
 * Источники ожидаемых значений — НЕ код движка:
 *  1. tests/fixtures/position/runway-reference.json — D34 (спец. 9A.2) и доли профилей с дефицитом (спец. 9A.3);
 *  2. ручная арифметика на синтетических рядах (дефицит = −медиана свободного остатка за 3 месяца, срок = ресурсы ÷ дефицит).
 * Тесты написаны до кода (плановое правило «тесты вперёд»).
 */
import { describe, it, expect } from 'vitest';
import { computeRunway, runwayOfState, RUNWAY_HORIZON_MONTHS, RUNWAY_SCENARIOS, type Runway } from '../../engine/position/runway';
import { buildPositionSeries } from '../../engine/position/series';
import { computeIndicators } from '../../engine/position/indicators';
import { levelFromIndicators } from '../../engine/position/level';
import { emptyState } from '../../engine/state';
import { fixtureJson } from '../support/fixtures';
import { applyProbeOpts, build, namedProfiles, randomSpec, randomSpecDyn, stressCase, TODAY } from '../support/position-profiles';
import type { PositionSeries } from '../../engine/position/series';
import type { Money } from '../../engine/money';

interface Ref {
  d34: { deficitThousand: number; resourcesMillion: number; months: number; scenarios: Record<string, number | null> };
  deficitShares: Record<'random' | 'dynamic' | 'stress', { size: number; deficit: number }>;
  deficitTotalWithNamed: number;
  deficitLevels: number[];
  monthsBeyondHorizon: number;
}
const REF = fixtureJson<Ref>('position/runway-reference.json');
const sc = (r: Runway, id: string) => r.scenarios.find((s) => s.id === id)!.months;

/** Синтетический ряд: только поля, нужные runway (тиыны). */
const T = (x: number): Money => Math.round(x * 100) as Money;
function fake(over: { income: number[]; expense: number[]; netLiquid: number; hasData?: boolean }): PositionSeries {
  return {
    hasData: over.hasData ?? true, histMonths: over.income.length,
    income: over.income.map(T), expense: over.expense.map(T), free: over.income.map((x, i) => T(x - over.expense[i]!)),
    netLiquid: T(over.netLiquid),
  } as unknown as PositionSeries;
}

describe('константы', () => {
  it('горизонт — 50 лет; сценариев ровно пять, в порядке спецификации', () => {
    expect(RUNWAY_HORIZON_MONTHS).toBe(REF.monthsBeyondHorizon);
    expect(RUNWAY_SCENARIOS.map((s) => s.id)).toEqual(['cut10', 'cut20', 'essentialOnly', 'incomeMinus20', 'inflation10']);
  });
});

describe('дефицит: −медиана свободного остатка за 3 месяца', () => {
  it('остатки −100, −300, −200 (тыс.) → медиана −200 → дефицит 200 тыс.', () => {
    const r = computeRunway(fake({ income: [500, 500, 500], expense: [600, 800, 700], netLiquid: 2000 }), 300);
    expect(r.status).toBe('deficit');
    expect(r.deficit).toBeCloseTo(200, 6);
  });
  it('берутся последние три месяца, а не вся история', () => {
    const r = computeRunway(fake({ income: [500, 500, 500, 500, 500], expense: [100, 100, 600, 700, 800], netLiquid: 1000 }), 300);
    expect(r.deficit).toBeCloseTo(200, 6); // последние три: −100, −200, −300 → медиана −200
  });
  it('один плохой месяц из трёх (медиана положительна) → дефицита нет', () => {
    const r = computeRunway(fake({ income: [500, 500, 500], expense: [900, 400, 400], netLiquid: 1000 }), 300);
    expect(r.status).toBe('no_deficit');
    expect(r.months).toBeNull();
    expect(r.deficit).toBe(0);
  });
  it('нулевая медиана → дефицита нет', () => {
    expect(computeRunway(fake({ income: [500, 500, 500], expense: [500, 500, 500], netLiquid: 1000 }), 300).status).toBe('no_deficit');
  });
  it('меньше трёх месяцев истории → оценки нет (no_data), а не нулевой дефицит', () => {
    const r = computeRunway(fake({ income: [500, 500], expense: [900, 900], netLiquid: 1000 }), 300);
    expect(r.status).toBe('no_data');
    expect(r.months).toBeNull();
  });
  it('нет операций → no_data', () => {
    expect(computeRunway(fake({ income: [], expense: [], netLiquid: 0, hasData: false }), 300).status).toBe('no_data');
  });
});

describe('срок: ресурсы ÷ дефицит', () => {
  it('ресурсы 1000, дефицит 200 → ровно 5 месяцев', () => {
    const r = computeRunway(fake({ income: [500, 500, 500], expense: [700, 700, 700], netLiquid: 1000 }), 300);
    expect(r.resources).toBeCloseTo(1000, 6);
    expect(r.months).toBeCloseTo(5, 6);
  });
  it('ресурсы 1050, дефицит 200 → 5,25 (дробная часть последнего месяца)', () => {
    expect(computeRunway(fake({ income: [500, 500, 500], expense: [700, 700, 700], netLiquid: 1050 }), 300).months).toBeCloseTo(5.25, 6);
  });
  it('ресурсов нет → срок 0', () => {
    expect(computeRunway(fake({ income: [500, 500, 500], expense: [700, 700, 700], netLiquid: 0 }), 300).months).toBe(0);
  });
  it('дефицит есть, а ресурсов хватит дольше 50 лет → срок равен горизонту (600), а не null', () => {
    const r = computeRunway(fake({ income: [500, 500, 500], expense: [501, 501, 501], netLiquid: 1_000_000 }), 300);
    expect(r.status).toBe('deficit');
    expect(r.months).toBe(RUNWAY_HORIZON_MONTHS);
  });
  it('срок не убывает с ростом ресурсов и не растёт с ростом дефицита', () => {
    let prev = -1;
    for (const liq of [0, 100, 500, 1000, 5000, 20000]) {
      const m = computeRunway(fake({ income: [500, 500, 500], expense: [700, 700, 700], netLiquid: liq }), 300).months!;
      expect(m).toBeGreaterThanOrEqual(prev); prev = m;
    }
    prev = Infinity;
    for (const ex of [550, 600, 700, 900, 1500]) {
      const m = computeRunway(fake({ income: [500, 500, 500], expense: [ex, ex, ex], netLiquid: 3000 }), 300).months!;
      expect(m).toBeLessThanOrEqual(prev); prev = m;
    }
  });
});

describe('сценарии (доход 500, расходы 700, ресурсы 3000, необходимое 300)', () => {
  const r = computeRunway(fake({ income: [500, 500, 500], expense: [700, 700, 700], netLiquid: 3000 }), 300);
  it('«сейчас» совпадает с основным сроком: 3000 ÷ 200 = 15', () => expect(r.months).toBeCloseTo(15, 6));
  it('расходы −10 %: расход 630, дефицит 130 → 3000 ÷ 130', () => expect(sc(r, 'cut10')).toBeCloseTo(3000 / 130, 6));
  it('расходы −20 %: расход 560, дефицит 60 → 50', () => expect(sc(r, 'cut20')).toBeCloseTo(50, 6));
  it('только необходимое: расход 300 < дохода 500 → дефицита нет (null)', () => expect(sc(r, 'essentialOnly')).toBeNull());
  it('доход −20 %: доход 400, дефицит 300 → 10', () => expect(sc(r, 'incomeMinus20')).toBeCloseTo(10, 6));
  it('инфляция расходов 10 %/год: короче срока «сейчас», но не 0', () => {
    const m = sc(r, 'inflation10')!;
    expect(m).toBeLessThan(15); expect(m).toBeGreaterThan(5);
    // ручная сверка: месячный рост (1,1)^(1/12) − 1; баланс к концу k-го месяца = 3000 − Σ (700·(1+g)^(j−1) − 500)
    const g = Math.pow(1.1, 1 / 12) - 1;
    let bal = 3000, e = 700, k = 0, out = -1;
    for (k = 1; k <= 600; k++) { bal += 500 - e; if (bal < 0) { out = k - 1 + (bal + (e - 500)) / (e - 500); break; } e *= 1 + g; }
    expect(m).toBeCloseTo(out, 6);
  });
  it('необходимое больше расходов → сценарий не лучше «сейчас» (расходы не растут)', () => {
    const r2 = computeRunway(fake({ income: [500, 500, 500], expense: [700, 700, 700], netLiquid: 3000 }), 900);
    expect(sc(r2, 'essentialOnly')).toBeCloseTo(15, 6);
  });
  it('без дефицита сценарии с неотрицательным потоком пусты; «доход −20 %» (поток становится отрицательным) даёт срок', () => {
    const ok = computeRunway(fake({ income: [500, 500, 500], expense: [450, 450, 450], netLiquid: 3000 }), 300);
    expect(ok.status).toBe('no_deficit');
    expect(sc(ok, 'cut10')).toBeNull();
    expect(sc(ok, 'cut20')).toBeNull();
    expect(sc(ok, 'essentialOnly')).toBeNull();
    expect(sc(ok, 'incomeMinus20')).toBeCloseTo(3000 / 50, 6); // 400 − 450 < 0 → срок есть: 60
  });
});

describe('чистота', () => {
  it('два вызова с теми же данными дают равный результат и не меняют вход', () => {
    const s = fake({ income: [500, 500, 500], expense: [700, 700, 700], netLiquid: 3000 });
    const snap = JSON.stringify(s);
    expect(computeRunway(s, 300)).toEqual(computeRunway(s, 300));
    expect(JSON.stringify(s)).toBe(snap);
  });
  it('пустое состояние → no_data без исключений', () => {
    expect(runwayOfState(emptyState(), TODAY).status).toBe('no_data');
  });
});

describe('именной профиль D34 (спец. 9A.2)', () => {
  const st = build(randomSpecDyn(34));
  const r = runwayOfState(st, TODAY);
  it('дефицит ≈ 285 тыс. в месяц', () => expect(Math.abs(r.deficit / 1000 - REF.d34.deficitThousand)).toBeLessThanOrEqual(0.5));
  it('ресурсы ≈ 27,4 млн (ликвидные минус долг людям)', () => expect(Math.abs(r.resources / 1e6 - REF.d34.resourcesMillion)).toBeLessThanOrEqual(0.05));
  it('срок ≈ 96 месяцев', () => expect(Math.abs(r.months! - REF.d34.months)).toBeLessThanOrEqual(0.5));
  for (const [id, want] of Object.entries(REF.d34.scenarios)) {
    it(`сценарий ${id}: ${want === null ? 'дефицита нет' : '≈ ' + want + ' мес.'}`, () => {
      const got = sc(r, id);
      if (want === null) expect(got).toBeNull(); else expect(Math.abs(got! - want)).toBeLessThanOrEqual(0.5);
    });
  }
});

// ───────────── выборки пула проб ─────────────
const OPTS = { v1CapMonths: Infinity };
const pools = {
  random: () => Array.from({ length: 400 }, (_, i) => build(randomSpec(i + 1))),
  dynamic: () => Array.from({ length: 400 }, (_, i) => build(randomSpecDyn(i + 1))),
  stress: () => Array.from({ length: 320 }, (_, i) => { const c = stressCase(i); return applyProbeOpts(c.state, c.opts); }),
  named: () => namedProfiles().map((p) => applyProbeOpts(p.state, p.opts)),
};
const analyse = (states: ReturnType<typeof pools.random>) => states.map((st) => {
  const series = buildPositionSeries(st, TODAY);
  const rep = computeIndicators(st, TODAY, series, OPTS);
  const lv = levelFromIndicators(rep);
  return { runway: computeRunway(series, rep.inputs?.needEssential ?? 0), level: lv ? (lv.result.held?.byScore ?? lv.result.level) : null }; // уровень из очков; факты D151 — position-level-facts.test.ts
});
const memo: Record<string, ReturnType<typeof analyse>> = {};
const get = (k: keyof typeof pools) => (memo[k] ??= analyse(pools[k]()));

describe('доли профилей с дефицитом (спец. 9A.3)', () => {
  for (const k of ['random', 'dynamic', 'stress'] as const) {
    it(`${k}: ${REF.deficitShares[k].deficit} из ${REF.deficitShares[k].size}`, () => {
      const a = get(k);
      expect(a.length).toBe(REF.deficitShares[k].size);
      expect(a.filter((x) => x.runway.status === 'deficit').length).toBe(REF.deficitShares[k].deficit);
    }, 120_000);
  }
});

describe('инвариант: дефицит исключает L4; уровни профилей с дефицитом', () => {
  it('на 1131 профиле: с дефицитом 268, уровни L1 61 / L2 139 / L3 68 / L4 0', () => {
    const all = [...get('random'), ...get('dynamic'), ...get('stress'), ...get('named')];
    expect(all.length).toBe(1131);
    const def = all.filter((x) => x.runway.status === 'deficit');
    expect(def.length).toBe(REF.deficitTotalWithNamed);
    const counts = [1, 2, 3, 4].map((l) => def.filter((x) => x.level === l).length);
    expect(counts).toEqual(REF.deficitLevels);
  }, 240_000);
});
