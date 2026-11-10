/**
 * T18 «Положение» v4: сверка движка с пробой на всём пуле из 1131 профиля (11 именных, R1–R400, D1–D400, стресс 0–319).
 *
 * Ожидаемые числа берутся из документов проб (spec 7.3, model-final 1.x/3, t00-closed 2.2, D125, D128), а не из движка.
 * Скрипты проб в репозитории не лежат; сверка идёт по итоговым числам проб, которые они напечатали:
 *  — контроль V1 (D = 24): ровно 10 профилей меняют уровень, все вверх в L4, капитал 35–64 мес.; R² N2–V1 ≤ 0,65 (проба 0,61;
 *    старая формула 0,57); удаление V1 меняет уровень не более чем у 8 % (проба 6,5 %);
 *  — запас до границы L4 (spec 7.3): среди 1104 профилей без сработавших ограничителей в пределах ±1 / ±2 / ±3 / ±5 очков — 34 / 61 / 96 / 154;
 *  — предупреждение «L4, но…» (D128): 10 из 318 профилей L4;
 *  — показ ориентира: 52,8 % на 4000 случаях и одинаковый результат при расчёте краёв по одному G и по полной функции уровня.
 * Построчной проверки G каждого из 1131 профилей против пробы нет: проба сохранила только итоги (именные профили и доли уровней сверены в
 * position-level.test.ts, 127 профилей показателей — в position-indicators.test.ts, 1200 диапазонов — в position-unknown.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { computeIndicators, DIRECTIONS, type IndicatorsReport } from '../../engine/position/indicators';
import { levelFromIndicators, levelOf, type PositionLevel } from '../../engine/position/level';
import { buildPositionSeries } from '../../engine/position/series';
import { boundsContext, boundsFor, maskIndicators, MASK_KINDS, fillLow, fillHigh } from '../../engine/position/unknown';
import { positionRange, canShowPoint } from '../../engine/position/range';
import { limitStates, withoutForecast, aggregateG } from '../../engine/position/limits';
import { directionScore } from '../../engine/position/directions';
import { buildOverview } from '../../engine/overview';
import { liquidOn } from '../../engine/ledger';
import { addDays } from '../../engine/date';
import type { AppState } from '../../engine/state';
import { applyProbeOpts, build, namedProfiles, randomSpec, randomSpecDyn, stressCase, TODAY } from '../support/position-profiles';

interface Row {
  name: string;
  state: AppState;
  report: IndicatorsReport; // D = 24
  probe: IndicatorsReport; // без правки V1, как в пробе
  level: PositionLevel;
  probeLevel: PositionLevel;
}

const pool: Row[] = [];
{
  const states: { name: string; state: AppState }[] = [];
  for (const n of namedProfiles()) states.push({ name: n.name, state: n.state });
  for (let i = 1; i <= 400; i++) { states.push({ name: `R${i}`, state: build(randomSpec(i)) }); states.push({ name: `D${i}`, state: build(randomSpecDyn(i)) }); }
  for (let i = 0; i < 320; i++) { const c = stressCase(i); states.push({ name: c.name, state: applyProbeOpts(c.state, c.opts) }); }
  for (const { name, state } of states) {
    const series = buildPositionSeries(state, TODAY);
    const report = computeIndicators(state, TODAY, series);
    const probe = computeIndicators(state, TODAY, series, { v1CapMonths: Infinity });
    pool.push({ name, state, report, probe, level: levelFromIndicators(report)!, probeLevel: levelFromIndicators(probe)! });
  }
}
/** Первые 11 строк пула — именные профили; остальные 1120 — выборки проб. */
const NAMED = 11;
const named = (n: string) => pool.find((r) => r.name === n)!;
const r2 = (a: number[], b: number[]) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i]! - ma) * (b[i]! - mb); saa += (a[i]! - ma) ** 2; sbb += (b[i]! - mb) ** 2; }
  return (sab * sab) / (saa * sbb);
};

describe('состав пула', () => {
  it('1131 профиль, у каждого есть уровень, G конечен и в пределах 0…100', () => {
    expect(pool.length).toBe(1131);
    for (const r of pool) {
      expect(r.level, r.name).not.toBeNull();
      expect(Number.isFinite(r.level.g), r.name).toBe(true);
      expect(r.level.g, r.name).toBeGreaterThanOrEqual(0);
      expect(r.level.g, r.name).toBeLessThanOrEqual(100);
    }
  });
  it('без правки V1 доли уровней — как в пробе: на всём пуле L4 = 318 (121 + 111 + 84 + 2 именных)', () => {
    expect(pool.filter((r) => r.probeLevel.result.level === 4).length).toBe(318);
  });
  it('правка V1 не меняет G и уровень, если V1 не растёт: G не падает ни у одного профиля', () => {
    for (const r of pool) expect(r.level.g, r.name).toBeGreaterThanOrEqual(r.probeLevel.g - 1e-9);
  });
});

describe('контроль V1 (D125, D = 24)', () => {
  const changed = pool.filter((r) => r.level.result.level !== r.probeLevel.result.level);
  it('ровно 10 профилей меняют уровень, все вверх, все в L4', () => {
    expect(changed.length).toBe(10);
    for (const r of changed) { expect(r.probeLevel.result.level, r.name).toBe(3); expect(r.level.result.level, r.name).toBe(4); }
  });
  it('у всех десяти капитал 35–64 обычных месяцев', () => {
    for (const r of changed) {
      const i = r.report.inputs!;
      const months = i.net / i.needLifestyle;
      expect(months, r.name).toBeGreaterThanOrEqual(35);
      expect(months, r.name).toBeLessThanOrEqual(64.5);
    }
  });
  it('FI1, FI2, FI8 → L4 (в пул они не входят — проверены в position-level.test.ts), на именных A–E уровни не изменились', () => {
    for (const n of ['A Студент', 'B Работающий', 'C С долгами', 'D Высокий доход', 'E Капитал, нестабильный']) expect(named(n).level.result.level, n).toBe(named(n).probeLevel.result.level);
  });
  it('R² N2–V1 ≤ 0,65: с правкой около 0,61, старая формула около 0,57', () => {
    const both = (key: 'report' | 'probe') => pool.filter((r) => r[key].values.N2 != null && r[key].values.V1 != null);
    const a = both('report'), b = both('probe');
    const withFix = r2(a.map((r) => r.report.values.N2 as number), a.map((r) => r.report.values.V1 as number));
    const old = r2(b.map((r) => r.probe.values.N2 as number), b.map((r) => r.probe.values.V1 as number));
    expect(withFix).toBeLessThanOrEqual(0.65);
    expect(withFix).toBeGreaterThan(0.6);
    expect(old).toBeGreaterThan(0.55);
    expect(old).toBeLessThan(0.59);
    expect(withFix).toBeGreaterThan(old); // правка добавляет дублирование, и оно признано (D125)
  });
  it('удаление V1 целиком меняет уровень не более чем у 8 % профилей (проба 6,5 %)', () => {
    let n = 0;
    for (const r of pool) {
      const { V1: _drop, ...rest } = r.report.values;
      const without = levelFromIndicators({ ...r.report, values: rest });
      if (without!.result.level !== r.level.result.level) n++;
    }
    expect(n / pool.length).toBeLessThanOrEqual(0.08);
    expect(n / pool.length).toBeGreaterThan(0.05);
  });
});

describe('запас до границы L4 (spec 7.3, пометка «на границе»)', () => {
  const cand = pool.slice(NAMED).filter((r) => r.probeLevel.fired.length === 0);
  const near = (k: number) => cand.filter((r) => Math.abs(r.probeLevel.result.margins.find((m) => m.id === 'L3/L4')!.margin) < k).length;
  it('1104 профиля без ограничителей; в пределах ±1 / ±2 / ±3 / ±5 очков: 34 / 61 / 96 / 154', () => {
    expect(cand.length).toBe(1104);
    expect([near(1), near(2), near(3), near(5)]).toEqual([34, 61, 96, 154]);
  });
  it('пометка «на границе» по L3/L4 стоит ровно у тех, у кого запас меньше 1 очка (34 профиля без правки V1)', () => {
    expect(cand.filter((r) => r.probeLevel.result.onBorder.includes('L3/L4')).length).toBe(34);
  });
  it('с правкой D = 24 таких 36; из десяти поднятых в L4 на границе не менее пяти', () => {
    expect(cand.filter((r) => r.level.result.onBorder.includes('L3/L4')).length).toBe(36);
    const up = pool.filter((r) => r.level.result.level !== r.probeLevel.result.level);
    expect(up.filter((r) => r.level.result.onBorder.includes('L3/L4')).length).toBeGreaterThanOrEqual(5);
  });
});

describe('предупреждение «L4, но…» (D128): 10 из 318', () => {
  const warn = (r: Row) => {
    const i = r.probe.inputs!;
    const cap = buildOverview(r.state, TODAY).capital;
    const blocked = cap.gross > 0 ? 1 - liquidOn(cap, addDays(TODAY, 30)) / cap.gross : 0;
    return {
      reserve: i.reserveEssentialMonths < 6,
      trough: i.needEssential > 0 && i.troughNet / i.needEssential < 3,
      blocked: blocked > 0.5,
    };
  };
  const l4 = pool.filter((r) => r.probeLevel.result.level === 4);
  const hit = l4.filter((r) => { const w = warn(r); return w.reserve || w.trough || w.blocked; });
  it('срабатывает у 10 из 318 профилей L4 (3,1 %)', () => {
    expect(l4.length).toBe(318);
    expect(hit.length).toBe(10);
  });
  it('по условиям: запас < 6 мес. — 1, минимум по прогнозу < 3 мес. — 5, более 50 % капитала недоступно за 30 дней — 7', () => {
    expect([hit.filter((r) => warn(r).reserve).length, hit.filter((r) => warn(r).trough).length, hit.filter((r) => warn(r).blocked).length]).toEqual([1, 5, 7]);
  });
  it('десять поднятых правкой V1 профилей предупреждения не вызывают', () => {
    const up = pool.filter((r) => r.level.result.level === 4 && r.probeLevel.result.level !== 4);
    expect(up.length).toBe(10);
    for (const r of up) { const w = warn(r); expect(w.reserve || w.trough || w.blocked, r.name).toBe(false); }
  });
});

describe('показ ориентира и уровни краёв диапазона (решение 6, открытый вопрос T07)', () => {
  it('4000 случаев: доля показанных 52,8 % одинакова при краях по одному G и по полной функции уровня; у 133 из 4000 случаев уровень хотя бы одного края различается', () => {
    let all = 0, single = 0, full = 0, edgeDiff = 0;
    for (const r of pool.slice(NAMED).filter((x) => /^[RD]\d/.test(x.name))) {
      const series = buildPositionSeries(r.state, TODAY);
      const ctx = boundsContext(series, r.report.inputs!);
      const base = limitStates(r.report.inputs!, r.report.forecast!);
      for (const kind of MASK_KINDS) {
        const masked = maskIndicators(r.report.values, kind);
        if (!Object.values(masked).some((v) => v === null)) continue;
        const bounds = boundsFor(kind, ctx);
        const states = kind === 'noSched' || kind === 'noForecast' ? withoutForecast(base) : base;
        const rg = positionRange(masked, bounds, states)!;
        const lv = (filled: typeof masked, mode: 'low' | 'high') => {
          const ds = DIRECTIONS.map((d) => directionScore(filled, d).score);
          const agg = aggregateG(ds.filter((x): x is number => x !== null), states, mode)!;
          return levelOf({ g: agg.g, directions: Object.fromEntries(DIRECTIONS.map((d, k) => [d, ds[k]!])) as never, reliable: { N: true, V: true, F: true }, fired: agg.fired }).level;
        };
        const ll = lv(fillLow(masked, bounds), 'low'), lh = lv(fillHigh(masked, bounds), 'high');
        all++;
        if (rg.showPoint) single++;
        if (canShowPoint(rg.width, lh - ll + 1)) full++;
        if (ll !== rg.levelLow || lh !== rg.levelHigh) edgeDiff++;
      }
    }
    expect(all).toBe(4000);
    expect(single).toBe(full);
    expect((100 * single) / all).toBeCloseTo(52.8, 1);
    expect(edgeDiff).toBe(133);
  });
});
