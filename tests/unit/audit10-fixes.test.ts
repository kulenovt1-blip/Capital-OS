/**
 * Аудит 10 (независимая проверка): граничные значения, округление против порога, подписи.
 * Ожидания — арифметика порогов (20 / 40 / 75, «меньше 3», «больше 50 %»), а не снимок вывода.
 */
import { describe, it, expect } from 'vitest';
import { geometricMean } from '../../engine/position/limits';
import { levelBandOf, LEVEL_NAMES } from '../../engine/position/level';
import { l4Warnings, positionViewOf } from '../../engine/position/view';
import { roadOf } from '../../app/road';
import { build, mk, TODAY } from '../support/position-profiles';

describe('находка 7: плавающая точка на границах ступеней', () => {
  for (const g of [20, 40, 75]) {
    it(`три направления по ${g} дают G = ${g} и ступень по границе`, () => {
      expect(geometricMean([g, g, g])).toBe(g);
      expect(levelBandOf(geometricMean([g, g, g]))).toBe(g === 20 ? 2 : g === 40 ? 3 : 4);
    });
  }
  it('G не округляется заметно: 74,9 остаётся ниже границы', () => {
    expect(levelBandOf(geometricMean([74.9, 74.9, 74.9]))).toBe(3);
  });
});

describe('находка 8: округление против порога в текстах', () => {
  const inputs = (reserve: number, trough: number) => ({ reserveEssentialMonths: reserve, needEssential: 100, troughNet: trough * 100 });
  it('запас 5,96 мес. при пороге 6 — «5,9», а не «6,0 … меньше 6»', () => {
    const w = l4Warnings(inputs(5.96, 10), 0).find((x) => x.id === 'reserve')!;
    expect(w.text).toContain('5,9 мес.');
    expect(w.text).not.toContain('6,0');
  });
  it('минимум запаса 2,96 мес. при пороге 3 — «2,9»', () => {
    const w = l4Warnings(inputs(10, 2.96), 0).find((x) => x.id === 'trough')!;
    expect(w.text).toContain('2,9 мес.');
  });
  it('доля заблокированного 50,4 % при условии «больше 50 %» — не «50 %»', () => {
    const w = l4Warnings(inputs(10, 10), 0.504).find((x) => x.id === 'blocked')!;
    expect(w.text.startsWith('Больше 50 %')).toBe(true);
    expect(l4Warnings(inputs(10, 10), 0.6).find((x) => x.id === 'blocked')!.text.startsWith('60 %')).toBe(true);
    expect(l4Warnings(inputs(10, 10), 0.5).some((x) => x.id === 'blocked')).toBe(false);
  });
  const aliya = () => mk('Алия', 3_500_000, 800_000, [['food', 'E_base', 130_000], ['rent', 'E_base', 60_000], ['fun', 'E_fun', 90_000], ['mort', 'E_installment_own', 230_000]], { remaining: 22_000_000, payment: 230_000 });
  it('«План»: G = 74,91 при пороге 75 — «74 из 100», не «75» (D217: шкала из 100, порог отдельно)', () => {
    const v = positionViewOf(build(aliya()), TODAY);
    expect(v.level).toBe(3);
    const score = roadOf({ ...v, g: 74.91 })!.next.score!;
    expect(score.have).toBe(74);
    expect(score.need).toBe(75);
    expect(score.done).toBe(false);
  });
});

describe('находка 3: края диапазона следуют правилу D156', () => {
  const short = (opening: number, income: number) => build({ ...mk('Короткая история', opening, income, [['food', 'E_base', 150_000], ['rent', 'E_base', 100_000], ['fun', 'E_fun', 60_000]]), from: '2026-08' });
  it('расходы больше доходов, но запас от 3 мес.: ступени 1 («Не хватает на жизнь») нет и на краях диапазона (D156)', () => {
    const v = positionViewOf(short(9_000_000, 200_000), TODAY);
    expect(v.money.reserveEssentialMonths).toBeGreaterThanOrEqual(3);
    expect(v.rangeLevels, 'у короткой истории есть диапазон').not.toBeNull();
    expect(v.rangeLevels!.low).not.toBe(LEVEL_NAMES[1]);
    expect(v.rangeLevels!.high).not.toBe(LEVEL_NAMES[1]);
    expect(v.level).not.toBe(1);
  });
  it('дефицит и запас меньше 3 мес.: край диапазона «Не хватает на жизнь» допустим', () => {
    const v = positionViewOf(short(100_000, 200_000), TODAY);
    expect(v.money.reserveEssentialMonths).toBeLessThan(3);
    if (v.rangeLevels) expect([LEVEL_NAMES[1], LEVEL_NAMES[2]]).toContain(v.rangeLevels.low);
  });
});

describe('находка 5: нет необходимых расходов — запас не выдумывается нулём', () => {
  const noEssential = () => build(mk('Без разметки', 500_000, 300_000, [['fun', 'E_fun', 100_000]]));
  it('в «до следующей ступени» нет «сейчас 0,0, не хватает около …»: сказано, что сначала нужна отметка «обязательно»', () => {
    const v = positionViewOf(noEssential(), TODAY);
    expect(v.essentialMissing).toBe(true);
    const text = (v.next?.needs ?? []).join(' | ');
    expect(text).not.toContain('сейчас 0,0');
    if (v.next?.needs.some((n) => n.startsWith('запас от'))) expect(text).toContain('отметь, что обязательно');
  });
  it('предупреждение «L4, но…» не заявляет «запас 0,0 мес.», когда необходимых расходов нет', () => {
    expect(l4Warnings({ reserveEssentialMonths: 0, needEssential: 0, troughNet: 0 }, 0).some((w) => w.id === 'reserve')).toBe(false);
  });
});

import { shownScore } from '../../engine/position/view';
describe('shownScore (аудит 10, находка 8): не округляем вверх через границу', () => {
  it('74,6 → 74, 59,6 → 59, 79,6 → 79, 39,5 → 39, 19,9 → 19', () => {
    expect(shownScore(74.6)).toBe(74);
    expect(shownScore(59.6)).toBe(59);
    expect(shownScore(79.6)).toBe(79);
    expect(shownScore(39.5)).toBe(39);
    expect(shownScore(19.9)).toBe(19);
  });
  it('на границе и выше — обычное округление; везде монотонно и не больше round', () => {
    expect(shownScore(75)).toBe(75);
    expect(shownScore(80)).toBe(80);
    expect(shownScore(60.4)).toBe(60);
    let prev = -1;
    for (let x = 0; x <= 100; x += 0.1) {
      const v = shownScore(x);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(Math.round(x));
      prev = v;
    }
  });
});
