/**
 * D212: нет отметки «обязательно» — запас по необходимому «нет данных» (спец. §5), итог — диапазон.
 * Ожидания: не выведены из вывода движка. Главное свойство — настоящая оценка (когда человек отметил обязательное) лежит внутри диапазона без отметок.
 */
import { describe, it, expect } from 'vitest';
import { computeIndicators } from '../../engine/position/indicators';
import { positionViewOf } from '../../engine/position/view';
import { essentialBounds, boundsContext, ALL_MASK_KINDS, MASKS } from '../../engine/position/unknown';
import { buildPositionSeries } from '../../engine/position/series';
import { roadOf } from '../../app/road';
import { build, mk, randomSpec, TODAY, type Spec } from '../support/position-profiles';

const unmarked = (sp: Spec): Spec => ({ ...sp, expenses: sp.expenses.map((e) => (e.cls === 'E_base' ? { ...e, cls: 'E_fun' as const } : e)) });
const marked = () => build(mk('С разметкой', 600_000, 300_000, [['food', 'E_base', 120_000], ['rent', 'E_base', 80_000], ['fun', 'E_fun', 60_000]]));
const notMarked = () => build(unmarked(mk('С разметкой', 600_000, 300_000, [['food', 'E_base', 120_000], ['rent', 'E_base', 80_000], ['fun', 'E_fun', 60_000]])));

describe('показатели без отметки «обязательно»', () => {
  it('с отметкой N1, F1, F2 посчитаны; без неё — «нет данных», остальные не тронуты', () => {
    const a = computeIndicators(marked(), TODAY);
    const b = computeIndicators(notMarked(), TODAY);
    for (const id of ['N1', 'F1', 'F2'] as const) { expect(a.values[id], id).not.toBeNull(); expect(b.values[id], id).toBeNull(); }
    for (const id of ['N2', 'N4', 'V1', 'V2', 'V4', 'F3', 'F4'] as const) expect(b.values[id], id).toBe(a.values[id]);
    expect(b.inputs!.essentialUnknown).toBe(true);
    expect(a.inputs!.essentialUnknown).toBeUndefined();
  });
  it('опция essentialUnknown:false возвращает прежние числа (для сверки с пробой)', () => {
    const r = computeIndicators(notMarked(), TODAY, undefined, { essentialUnknown: false });
    expect(r.values.N1).not.toBeNull();
    expect(r.inputs!.essentialUnknown).toBeUndefined();
  });
  it('тип неизвестного noEssential скрывает ровно N1, F1, F2', () => {
    expect([...MASKS.noEssential]).toEqual(['N1', 'F1', 'F2']);
    expect(ALL_MASK_KINDS).toContain('noEssential');
  });
});

describe('диапазон без отметки «обязательно»', () => {
  it('диапазон есть, ступень предварительная, запас числом не заявлен', () => {
    const v = positionViewOf(notMarked(), TODAY);
    expect(v.essentialUnknown).toBe(true);
    expect(v.range).not.toBeNull();
    expect(v.rangeLevels).not.toBeNull();
    expect(v.preliminary).toBe(true);
    expect(v.money.reserveEssentialMonths).toBe(0);
    expect(v.limitsFired.map((l) => l.id)).not.toContain('cover1');
  });
  it('с отметкой диапазона нет и essentialUnknown = false', () => {
    const v = positionViewOf(marked(), TODAY);
    expect(v.essentialUnknown).toBe(false);
  });
  it('границы: N1 не ниже запаса по обычным расходам и не выше его полусуммы со 100; F1 и F2 — до 100', () => {
    const st = notMarked();
    const rep = computeIndicators(st, TODAY);
    const ctx = boundsContext(buildPositionSeries(st, TODAY), rep.inputs!, undefined, rep.forecast);
    const b = essentialBounds(ctx, true);
    expect(b.N1![1]).toBeCloseTo((b.N1![0] + 100) / 2, 9);
    expect(b.F1![1]).toBe(100);
    expect(b.F2![1]).toBe(100);
    for (const id of ['N1', 'F1', 'F2'] as const) expect(b[id]![0]).toBeLessThanOrEqual(b[id]![1]);
    expect(essentialBounds(ctx, false).F1).toEqual([0, 100]);
  });
  it('СВОЙСТВО: настоящий G (с отметками) лежит внутри диапазона тех же данных без отметок — 250 случайных профилей', () => {
    let n = 0;
    for (let seed = 1; seed <= 250; seed++) {
      const sp = randomSpec(seed);
      if (!sp.expenses.some((e) => e.cls === 'E_base')) continue;
      const truth = positionViewOf(build(sp), TODAY);
      const un = positionViewOf(build(unmarked(sp)), TODAY);
      if (truth.g === null) continue;
      n++;
      expect(un.range, `seed ${seed}: диапазон есть`).not.toBeNull();
      expect(truth.g, `seed ${seed} G ≥ low`).toBeGreaterThanOrEqual(un.range!.low - 1e-6);
      expect(truth.g, `seed ${seed} G ≤ high`).toBeLessThanOrEqual(un.range!.high + 1e-6);
    }
    expect(n).toBeGreaterThan(100);
  }, 60_000);
});

describe('только платежи по долгам, трат «обязательно» нет', () => {
  const st = () => build(mk('Платежи', 800_000, 400_000, [['inst', 'E_installment_own', 100_000], ['fun', 'E_fun', 120_000]], { remaining: 600_000, payment: 100_000 }));
  it('запас по необходимому (одни платежи) не выдаётся за настоящий: нет данных, предварительно', () => {
    const v = positionViewOf(st(), TODAY);
    expect(v.essentialMissing).toBe(true);
    expect(v.essentialUnknown).toBe(true);
    expect(v.preliminary).toBe(true);
    expect(v.money.reserveEssentialMonths).toBe(0);
  });
});

describe('«Дорога»: условие запаса', () => {
  it('без отметки условие «Запас на жизнь» не заявляет число месяцев, а просит отметить обязательное', () => {
    const v = positionViewOf(build(unmarked(mk('Мало запаса', 60_000, 250_000, [['food', 'E_base', 120_000], ['fun', 'E_fun', 100_000]]))), TODAY);
    expect(v.essentialUnknown).toBe(true);
    const road = roadOf(v);
    expect(road, 'для ступени ≤ 3 «Дорога» есть').not.toBeNull();
    const cond = road!.next.conds.find((c) => c.kind === 'reserve');
    expect(cond, 'условие запаса есть').toBeDefined();
    expect(cond!.done).toBe(false);
    expect(cond!.value).toContain('отметь, что обязательно');
  });
});
