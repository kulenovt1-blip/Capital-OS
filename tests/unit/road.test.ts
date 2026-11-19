/**
 * «Дорога» (дизайн A+, app/road.ts): условия следующей ступени раскладываются из `PositionView`, математика движка не меняется.
 * Профили — те же синтетические «ситуации» (Берик, Серик, Алия, Олжас), что в наброске демо-людей; числа не личные.
 */
import { describe, it, expect } from 'vitest';
import { positionViewOf } from '../../engine/position/view';
import { roadOf } from '../../app/road';
import { build, mk, TODAY } from '../support/position-profiles';

const berik = () => mk('Берик', 0, 220_000, [['food', 'E_base', 90_000], ['rent', 'E_base', 110_000], ['fun', 'E_fun', 15_000], ['loan1', 'E_installment_own', 70_000], ['loan2', 'E_installment_own', 45_000]], { remaining: 1_900_000, payment: 115_000 });
const serik = () => mk('Серик', 30_000, 330_000, [['food', 'E_base', 100_000], ['rent', 'E_base', 120_000], ['fun', 'E_fun', 30_000], ['inst', 'E_installment_own', 35_000]], { remaining: 280_000, payment: 35_000 });
const aliya = () => mk('Алия', 3_500_000, 800_000, [['food', 'E_base', 130_000], ['rent', 'E_base', 60_000], ['fun', 'E_fun', 90_000], ['mort', 'E_installment_own', 230_000]], { remaining: 22_000_000, payment: 230_000 });
const olzhas = () => mk('Олжас', 9_000_000, 1_500_000, [['food', 'E_base', 220_000], ['rent', 'E_base', 90_000], ['fun', 'E_fun', 180_000], ['car', 'E_installment_own', 250_000]], { remaining: 7_000_000, payment: 250_000 });

describe('дорога: условия следующей ступени', () => {
  it('ступень 1: следующая — 2; есть оценка и слова про «доходы покрывают расходы», пройденных нет', () => {
    const v = positionViewOf(build(berik()), TODAY);
    const r = roadOf(v)!;
    expect(v.level).toBe(1);
    expect(r.passed).toBeNull();
    expect(r.next.level).toBe(2);
    expect(r.next.conds.map((c) => c.kind)).toEqual(['score', 'text']);
    expect(r.next.conds[0]!.value).toBe('10 из 20');
    expect(r.next.conds.every((c) => !c.done)).toBe(true);
    expect(r.rest.map((x) => x.level)).toEqual([3, 4, 5]);
  });

  it('ступень 2: запас считается к 3 месяцам, выполненные условия помечены', () => {
    const v = positionViewOf(build(serik()), TODAY);
    const r = roadOf(v)!;
    expect(v.level).toBe(2);
    expect(r.passed).toBe('Ступень 1 пройдена');
    const reserve = r.next.conds.find((c) => c.kind === 'reserve')!;
    expect(reserve.done).toBe(false);
    expect(reserve.value).toMatch(/^\d,\d из 3 мес\.$/);
    expect(r.next.conds.find((c) => c.kind === 'score')!.done).toBe(true);
  });

  it('ступень 3: три условия ступени 4 — запас к 6 месяцам, оценка к 75, каждое направление от 60', () => {
    const v = positionViewOf(build(aliya()), TODAY);
    const r = roadOf(v)!;
    expect(v.level).toBe(3);
    expect(r.passed).toBe('Ступени 1 и 2 пройдены');
    expect(r.next.level).toBe(4);
    expect(r.next.conds.map((c) => c.kind)).toEqual(['reserve', 'score', 'directions']);
    const score = r.next.conds.find((c) => c.kind === 'score')!;
    expect(score.value).toBe(`${Math.round(v.g!)} из 75`);
    expect(score.ratio).toBeCloseTo(v.g! / 75, 5);
    const dirs = r.next.conds.find((c) => c.kind === 'directions')!;
    expect(dirs.done).toBe(v.directions.every((d) => d.score !== null && d.score >= 60));
  });

  it('подсказка под оценкой: что слабее всего — берётся из уже посчитанного; когда условие выполнено — подсказки нет', () => {
    const v = positionViewOf(build(aliya()), TODAY);
    const score = roadOf(v)!.next.conds.find((c) => c.kind === 'score')!;
    if (v.g! < 75 && v.weak) expect(score.hint).toBe(`Слабее всего: ${v.weak.directionName}${v.weak.indicator ? ` · ${v.weak.indicator.label}` : ''}`);
    else expect(score.hint).toBeUndefined();
    const done = roadOf({ ...v, g: 80 })!.next.conds.find((c) => c.kind === 'score')!;
    expect(done.done).toBe(true);
    expect(done.hint).toBeUndefined();
  });

  it('ступень 4 и выше — дороги нет (дальше блок «Независимость»)', () => {
    expect(roadOf(positionViewOf(build(olzhas()), TODAY))).toBeNull();
  });

  it('нечем оценить — дороги нет', () => {
    const v = { ...positionViewOf(build(aliya()), TODAY), level: null };
    expect(roadOf(v)).toBeNull();
  });
});
