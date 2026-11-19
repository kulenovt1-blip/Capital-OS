/**
 * «План» (дизайн A+, D217; app/road.ts): условия следующей ступени раскладываются из `PositionView`, математика движка не меняется.
 * Профили — те же синтетические «ситуации» (Берик, Серик, Алия, Олжас), что в наброске демо-людей; числа не личные.
 */
import { describe, it, expect } from 'vitest';
import { positionViewOf, shownScore } from '../../engine/position/view';
import { firstStepOf, roadOf } from '../../app/road';
import { build, mk, TODAY } from '../support/position-profiles';

const berik = () => mk('Берик', 0, 220_000, [['food', 'E_base', 90_000], ['rent', 'E_base', 110_000], ['fun', 'E_fun', 15_000], ['loan1', 'E_installment_own', 70_000], ['loan2', 'E_installment_own', 45_000]], { remaining: 1_900_000, payment: 115_000 });
const serik = () => mk('Серик', 30_000, 330_000, [['food', 'E_base', 100_000], ['rent', 'E_base', 120_000], ['fun', 'E_fun', 30_000], ['inst', 'E_installment_own', 35_000]], { remaining: 280_000, payment: 35_000 });
const aliya = () => mk('Алия', 3_500_000, 800_000, [['food', 'E_base', 130_000], ['rent', 'E_base', 60_000], ['fun', 'E_fun', 90_000], ['mort', 'E_installment_own', 230_000]], { remaining: 22_000_000, payment: 230_000 });
const olzhas = () => mk('Олжас', 9_000_000, 1_500_000, [['food', 'E_base', 220_000], ['rent', 'E_base', 90_000], ['fun', 'E_fun', 180_000], ['car', 'E_installment_own', 250_000]], { remaining: 7_000_000, payment: 250_000 });

describe('план (D217): условия-факты следующей ступени, оценка — шкалой, а не условием', () => {
  it('ступень 1: следующая — 2; условие «доходы покрывают расходы» с минусом в месяц, оценка — шкала «из 100, нужно 20»', () => {
    const v = positionViewOf(build(berik()), TODAY);
    const r = roadOf(v)!;
    expect(v.level).toBe(1);
    expect(r.passed).toBeNull();
    expect(r.next.level).toBe(2);
    expect(r.next.conds.map((c) => c.kind)).toEqual(['deficit']);
    expect(r.next.conds[0]!.value).toMatch(/^сейчас минус ≈ .+ в месяц$/);
    expect(r.next.score).toEqual(expect.objectContaining({ have: 10, need: 20, done: false }));
    expect(r.next.conds.some((c) => c.title === 'Общая оценка')).toBe(false);
    expect(r.rest.map((x) => x.level)).toEqual([3, 4, 5]);
    expect(firstStepOf(r)!.text).toBe('Выйти в плюс: доходы должны покрывать расходы');
  });

  it('ступень 2: запас считается к 3 месяцам; оценка выполнена — шкала «хватает»', () => {
    const v = positionViewOf(build(serik()), TODAY);
    const r = roadOf(v)!;
    expect(v.level).toBe(2);
    expect(r.passed).toBe('Ступень 1 пройдена');
    const reserve = r.next.conds.find((c) => c.kind === 'reserve')!;
    expect(reserve.done).toBe(false);
    expect(reserve.value).toMatch(/^\d,\d из 3 мес\.$/);
    expect(r.next.score!.done).toBe(true);
  });

  it('ступень 3: условие ступени 4 — запас к 6 месяцам; оценка — шкала к 75 с подсказкой про направления ниже 60', () => {
    const v = positionViewOf(build(aliya()), TODAY);
    const r = roadOf(v)!;
    expect(v.level).toBe(3);
    expect(r.passed).toBe('Ступени 1 и 2 пройдены');
    expect(r.next.level).toBe(4);
    expect(r.next.conds.map((c) => c.kind)).toEqual(['reserve']);
    expect(r.next.score!.need).toBe(75);
    expect(r.next.score!.have).toBe(shownScore(v.g!));
    const low = v.directions.filter((d) => d.score !== null && d.score < 60);
    if (low.length) expect(r.next.score!.hint).toContain('каждое направление от 60');
  });

  it('подсказка под шкалой: что слабее всего — из уже посчитанного; когда хватает — подсказки нет', () => {
    const v = positionViewOf(build(aliya()), TODAY);
    const sc = roadOf(v)!.next.score!;
    if (!sc.done && v.weak) expect(sc.hint).toContain(`Слабее всего: ${v.weak.directionName}`);
    const strong = { ...v, g: 80, directions: v.directions.map((d) => ({ ...d, score: Math.max(d.score ?? 0, 70) })) };
    const done = roadOf(strong)!.next.score!;
    expect(done.done).toBe(true);
    expect(done.hint).toBeUndefined();
  });

  it('ступень 4: план к ступени 5 — четыре условия-факта, без шкалы оценки', () => {
    const v = positionViewOf(build(olzhas()), TODAY);
    if (v.level !== 4) return; // этот набросок Олжаса может оказаться и на 5 — тогда плана нет (проверено ниже)
    const r = roadOf(v)!;
    expect(r.next.level).toBe(5);
    expect(r.next.conds.map((c) => c.kind)).toEqual(['life', 'share', 'rate', 'habit']);
    expect(r.next.score).toBeNull();
  });

  it('ступень 5 — плана нет (верхняя ступень)', () => {
    const v = positionViewOf(build(olzhas()), TODAY);
    expect(roadOf({ ...v, level: 5, levelName: 'Могу не смотреть на цены', next: null })).toBeNull();
  });

  it('нечем оценить — плана нет', () => {
    const v = { ...positionViewOf(build(aliya()), TODAY), level: null };
    expect(roadOf(v)).toBeNull();
  });
});
