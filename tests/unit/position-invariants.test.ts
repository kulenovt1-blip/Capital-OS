/**
 * T15b «Положение» v4: сквозные инварианты (спец. 16.1 и новые из плана: желаемые расходы, порядок операций).
 *
 * Это защита от дрейфа: каждый инвариант проверяется на пуле профилей (именные, независимости, семейства спирали, стресс) и на
 * урезанных состояниях. Ожидаемых «правильных чисел» здесь нет — только свойства, которые обязаны выполняться при любых числах.
 * Что уже проверено в других файлах и здесь не дублируется: «дефицит исключает L4» на 1131 профиле — position-runway.test.ts;
 * возможные значения показателей 0–100 или null — position-indicators.test.ts; независимость удалена (D216).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emptyState, type AppState } from '../../engine/state';
import { tenge } from '../../engine/money';
import { buildPositionSeries } from '../../engine/position/series';
import { computeIndicators, INDICATOR_WEIGHTS, INDICATOR_IDS, type Indicators } from '../../engine/position/indicators';
import { levelFromIndicators } from '../../engine/position/level';
import { computeRunway } from '../../engine/position/runway';
import { spiralSigns } from '../../engine/position/spiral';
import { LIMIT_IDS, LIMIT_VALUES, limitStates, withoutForecast, aggregateG } from '../../engine/position/limits';
import { directionScore } from '../../engine/position/directions';
import { boundsContext, boundsFor, maskIndicators, MASK_KINDS } from '../../engine/position/unknown';
import { positionRange } from '../../engine/position/range';
import { DIRECTIONS } from '../../engine/position/indicators';
import { forAll } from '../support/prop';
import { applyProbeOpts, build, independenceProfiles, namedProfiles, randomSpec, randomSpecDyn, SPECS2, spiralCase, SPIRAL_FAMS, stressCase, TODAY } from '../support/position-profiles';

// ───────────── вспомогательное ─────────────

/** Всё, что считает «Положение», одним объектом. */
function fullReport(state: AppState) {
  const series = buildPositionSeries(state, TODAY);
  const indicators = computeIndicators(state, TODAY, series);
  const level = levelFromIndicators(indicators);
  const runway = computeRunway(series, indicators.inputs?.needEssential ?? 0);
  const spiral = spiralSigns(series);
  return { series, indicators, level, runway, spiral };
}

/** Пути всех нечисловых «чисел» (NaN, ±Infinity) в объекте; null допустим — это «неизвестно». */
function badNumbers(x: unknown, path = '$', out: string[] = []): string[] {
  if (typeof x === 'number') { if (!Number.isFinite(x)) out.push(`${path} = ${x}`); }
  else if (Array.isArray(x)) x.forEach((v, i) => badNumbers(v, `${path}[${i}]`, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) badNumbers(v, `${path}.${k}`, out);
  return out;
}

interface Item { name: string; state: AppState }
/** Пул: 11 именных, 8 профилей независимости, по одному из каждого семейства спирали, 6 стресс-случаев. */
function pool(): Item[] {
  const items: Item[] = [
    ...namedProfiles().map((p) => ({ name: p.name, state: applyProbeOpts(p.state, p.opts) })),
    ...independenceProfiles().map((p) => ({ name: p.name, state: p.state })),
    ...SPIRAL_FAMS.map((f) => { const c = spiralCase(1, f); return { name: c.name, state: c.state }; }),
  ];
  for (let i = 0; i < 6; i++) { const c = stressCase(i); items.push({ name: c.name, state: applyProbeOpts(c.state, c.opts) }); }
  return items;
}
const POOL = pool();

/** Детерминированная перестановка (не зависит от ключей и порядка): линейный конгруэнтный генератор. */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const a = [...xs];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const B = SPECS2[1]!;
const withEvent = (st: AppState, amountTenge: number, date = '2027-03-10'): AppState => ({
  ...st, settings: { ...st.settings, plannedEvents: [...st.settings.plannedEvents, { id: 'inv-x', title: 'Будущая трата', date, kind: 'one_off', amount: tenge(amountTenge) }] },
});

// ───────────── 1. нет NaN и исключений на неполных данных ─────────────

describe('нет NaN и исключений на неполных данных', () => {
  const b = build(B);
  const ops = b.imported!.operations;
  const cut = (state: AppState, from: string): AppState => ({ ...state, imported: { ...state.imported!, operations: state.imported!.operations.filter((o) => o.date >= from) } });
  const cases: [string, AppState][] = [
    ['пустое состояние', emptyState()],
    ['одна операция', { ...b, imported: { ...b.imported!, operations: [ops[0]!] } }],
    ['история 1 месяц', cut(b, '2026-10-01')],
    ['история 2 месяца', cut(b, '2026-09-01')],
    ['история 4 месяца', cut(b, '2026-07-01')],
    ['нет расписания доходов', { ...b, settings: { ...b.settings, incomeSchedule: [] } }],
    ['нет обязательств', { ...b, obligations: [] }],
    ['нет расписания и нет обязательств', { ...b, obligations: [], settings: { ...b.settings, incomeSchedule: [] } }],
    ['операции только в прошлом, ничего за последние месяцы', cut({ ...b, imported: { ...b.imported!, operations: ops.filter((o) => o.date < '2026-04-01') } }, '2025-01-01')],
  ];
  for (const [name, st] of cases) {
    it(name, () => {
      const r = fullReport(st);
      expect(badNumbers(r), name).toEqual([]);
    });
  }
  it('весь пул профилей: нет NaN и Infinity ни в показателях, ни в уровне, ни в runway, ни в спирали', () => {
    for (const p of POOL) expect(badNumbers(fullReport(p.state)), p.name).toEqual([]);
  }, 120_000);
});

// ───────────── 2. будущее событие меняет только F ─────────────

describe('будущее событие меняет только «Безопасность будущего» (F), но не N и V', () => {
  const states: Item[] = [
    { name: 'B', state: build(B) },
    { name: 'D34', state: build(randomSpecDyn(34)) },
    ...independenceProfiles().slice(2, 4).map((p) => ({ name: p.name, state: p.state })),
  ];
  const NV = ['N1', 'N2', 'N3', 'N4', 'V1', 'V2', 'V3', 'V4'] as const;
  for (const { name, state } of states) {
    it(`${name}: трата 3 млн и 80 млн в будущем`, () => {
      const base = fullReport(state);
      for (const amount of [3_000_000, 80_000_000]) {
        const r = fullReport(withEvent(state, amount));
        for (const id of NV) expect(r.indicators.values[id], `${name} ${id} при ${amount}`).toEqual(base.indicators.values[id]);
        expect(r.indicators.inputs?.netLiquid).toBe(base.indicators.inputs?.netLiquid);
        expect(r.series).toEqual(base.series);
        expect(r.runway).toEqual(base.runway);
      }
    });
  }
  it('большая будущая трата действительно двигает F (иначе тест ничего не проверяет)', () => {
    const s = build(B);
    const base = fullReport(s).indicators.values;
    const hit = fullReport(withEvent(s, 80_000_000)).indicators.values;
    expect(hit.F1 !== base.F1 || hit.F4 !== base.F4).toBe(true);
  });
});

// ───────────── 3. займы не увеличивают запас ─────────────

describe('заёмные деньги не увеличивают запас', () => {
  it('займ у людей 2 млн: доступные деньги растут на 2 млн, чистая ликвидность и N1 не меняются', () => {
    const plain = build(B);
    const borrowed = build({ ...B, incomes: [...B.incomes, { id: 'borrow', title: 'Займ', cls: 'F_borrowed', day: 12, amount: (m: string) => (m === '2026-10' ? 2_000_000 : 0), kind: 'irregular', sched: 0 }] });
    const noSched: AppState = { ...borrowed, settings: { ...borrowed.settings, incomeSchedule: borrowed.settings.incomeSchedule.filter((i) => i.id !== 'borrow') } };
    const a = fullReport(plain), c = fullReport(noSched);
    expect(c.series.liquidNow - a.series.liquidNow).toBe(tenge(2_000_000));
    expect(c.series.netLiquid).toBe(a.series.netLiquid);
    expect(c.indicators.values.N1).toBeCloseTo(a.indicators.values.N1!, 9);
    expect(c.indicators.values.F1).toBeCloseTo(a.indicators.values.F1!, 9);
  });
});

// ───────────── 4. ровно три ограничителя; runway не входит в G ─────────────

describe('ограничители и runway', () => {
  it('ограничителей ровно три: нет запаса → 39, разрыв в прогнозе → 59, обрыв дохода → 59', () => {
    expect([...LIMIT_IDS]).toEqual(['cover1', 'gap', 'cliff']);
    expect(Object.keys(LIMIT_VALUES).sort()).toEqual(['cliff', 'cover1', 'gap']);
    expect(LIMIT_VALUES).toEqual({ cover1: 39, gap: 59, cliff: 59 });
  });
  it('долговая спираль — не ограничитель: на G и список сработавших не влияют', () => {
    for (const f of SPIRAL_FAMS) {
      const r = fullReport(spiralCase(2, f).state);
      expect(r.level?.fired.every((id) => (LIMIT_IDS as readonly string[]).includes(id)), f).toBe(true);
    }
  });
  it('модуль runway не подключает уровни, ограничители и направления: срок до исчерпания в G не входит', () => {
    const src = readFileSync(fileURLToPath(new URL('../../engine/position/runway.ts', import.meta.url)), 'utf8');
    const imports = src.split('\n').filter((l) => /^import /.test(l)).join('\n');
    for (const m of ['./level', './limits', './directions', './range', './unknown']) expect(imports, m).not.toContain(`'${m}'`);
  });
  it('модуль спирали не пишет в G: ни `aggregateG`, ни `directionScore` им не вызываются', () => {
    for (const f of ['spiral.ts']) {
      const src = readFileSync(fileURLToPath(new URL(`../../engine/position/${f}`, import.meta.url)), 'utf8');
      expect(src, f).not.toMatch(/aggregateG\(|directionScore\(/);
    }
  });
  it('дефицит исключает L4; ступень 5 при дефиците — только когда денег на 25 лет обычной жизни (D216)', () => {
    for (const p of POOL) {
      const r = fullReport(p.state);
      if (r.runway.status !== 'deficit') continue;
      expect(r.level?.result.level, p.name).not.toBe(4);
      if (r.level?.result.level === 5) expect(r.level.result.l5!.capitalOnly, p.name).toBe(true);
    }
  }, 120_000);
});

// ───────────── 5. веса: два запаса не удваивают вес ─────────────

describe('веса показателей', () => {
  it('в каждом направлении веса дают единицу; запас N1 один (нет второго показателя запаса)', () => {
    for (const d of DIRECTIONS) {
      const ids = INDICATOR_IDS.filter((id) => id.startsWith(d));
      expect(ids.reduce((a, id) => a + INDICATOR_WEIGHTS[id], 0), d).toBeCloseTo(1, 10);
    }
    expect(INDICATOR_IDS.filter((id) => id.startsWith('N')).length).toBe(4);
    expect(Object.keys(INDICATOR_WEIGHTS).length).toBe(INDICATOR_IDS.length);
  });
});

// ───────────── 6. желаемые расходы ни на что в основном расчёте не влияют ─────────────

describe('желаемые расходы (старая настройка из бэкапа) не меняют ни один выход расчёта', () => {
  it('на пуле профилей: показатели, G, уровень, runway и спираль равны с настройкой и без', () => {
    for (const p of POOL) {
      const base = fullReport(p.state);
      for (const desired of [100_000, 900_000, 20_000_000]) {
        const st: AppState = { ...p.state, settings: { ...p.state.settings, position: { ...p.state.settings.position, desiredMonthly: tenge(desired) } } };
        expect(fullReport(st), `${p.name} при ${desired}`).toEqual(base);
      }
    }
  }, 120_000);
});

// ───────────── 7. порядок операций в бэкапе ─────────────

describe('результат не зависит от порядка операций в бэкапе', () => {
  it('в обратном и в перемешанном порядке всё равно то же, что в исходном (весь пул)', () => {
    for (const p of POOL) {
      const ops = p.state.imported!.operations;
      const base = fullReport(p.state);
      for (const [label, order] of [['обратный', [...ops].reverse()], ['перемешанный', shuffled(ops, 7)], ['перемешанный 2', shuffled(ops, 99)]] as const) {
        const st: AppState = { ...p.state, imported: { ...p.state.imported!, operations: order } };
        expect(fullReport(st), `${p.name}: ${label}`).toEqual(base);
      }
    }
  }, 240_000);
});

// ───────────── 8. расчёт не меняет входные данные и повторяем ─────────────

describe('чистота', () => {
  it('расчёт не меняет состояние; два вызова равны (весь пул)', () => {
    for (const p of POOL) {
      const before = JSON.stringify(p.state);
      const a = fullReport(p.state), b = fullReport(p.state);
      expect(JSON.stringify(p.state), p.name).toBe(before);
      expect(a, p.name).toEqual(b);
    }
  }, 120_000);
});

// ───────────── 9. диапазон содержит истину ─────────────

describe('диапазон G содержит значение при полных данных', () => {
  it('не реже 95 % случаев «профиль × тип неизвестного» (R1–R30, D1–D30; спец. 16.1)', () => {
    let all = 0, hit = 0;
    const misses: string[] = [];
    const items: [string, AppState][] = [];
    for (let i = 1; i <= 30; i++) { items.push([`R${i}`, build(randomSpec(i))]); items.push([`D${i}`, build(randomSpecDyn(i))]); }
    for (const [name, st] of items) {
      const series = buildPositionSeries(st, TODAY);
      const report = computeIndicators(st, TODAY, series);
      const base = limitStates(report.inputs!, report.forecast!);
      const full = report.values.F2 === null ? withoutForecast(base) : base;
      const scores = DIRECTIONS.map((d) => directionScore(report.values, d).score).filter((x): x is number => x !== null);
      const truth = aggregateG(scores, full, 'point')!.g;
      const ctx = boundsContext(series, report.inputs!);
      for (const kind of MASK_KINDS) {
        const masked: Indicators = maskIndicators(report.values, kind);
        if (!Object.values(masked).some((v) => v === null)) continue;
        const r = positionRange(masked, boundsFor(kind, ctx), kind === 'noSched' || kind === 'noForecast' ? withoutForecast(base) : base);
        if (!r) continue;
        all++;
        if (r.low - 0.01 <= truth && truth <= r.high + 0.01) hit++; else misses.push(`${name}/${kind}: ${truth.toFixed(1)} вне [${r.low.toFixed(1)}; ${r.high.toFixed(1)}]`);
      }
    }
    expect(all).toBeGreaterThan(150);
    expect(hit / all, `промахи: ${misses.slice(0, 8).join('; ')}`).toBeGreaterThanOrEqual(0.95);
  }, 120_000);
});

// ───────────── 10. независимость: свойства на случайных входах ─────────────

