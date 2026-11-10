/**
 * T11 «Положение» v4: модель экрана (`positionViewOf`).
 *
 * Критерии плана: экран открывается на пустом состоянии, на неполных данных, на профиле с ограничителем и на профиле L5; ни одно число не NaN.
 * Ожидаемые значения — из документов: уровни FI1–FI8 (status-2026-11-10: FI1 L4, FI2/FI3/FI8 L5, FI4–FI7 L3); пороги предупреждения «L4, но…»
 * (t00-closed 2.2: запас < 6 мес., минимум по прогнозу < 3 мес., > 50 % недоступно за 30 дней); решение владельца D138: две строки капитала;
 * решение D139: подписи краёв диапазона по полной функции уровня.
 */
import { describe, it, expect } from 'vitest';
import { emptyState } from '../../engine/state';
import { INDEPENDENCE_TEXTS, positionViewOf, l4Warnings, DIRECTION_NAMES, INDICATOR_LABELS, type PositionView } from '../../engine/position/view';
import { levelFromIndicators } from '../../engine/position/level';
import { computeIndicators } from '../../engine/position/indicators';
import { applyProbeOpts, independenceProfiles, namedProfiles, probeProfiles, TODAY } from '../support/position-profiles';

const view = (state: Parameters<typeof positionViewOf>[0]) => positionViewOf(state, TODAY);
const named = (n: string) => { const p = namedProfiles().find((x) => x.name === n)!; return applyProbeOpts(p.state, p.opts); };

/** Все числа в модели конечные (не NaN и не бесконечность); Infinity допустим только там, где модель сама его обещает — таких полей в экране нет. */
function nonFinite(x: unknown, path = 'view'): string[] {
  if (typeof x === 'number') return Number.isFinite(x) ? [] : [`${path}=${x}`];
  if (Array.isArray(x)) return x.flatMap((v, i) => nonFinite(v, `${path}[${i}]`));
  if (x && typeof x === 'object') return Object.entries(x).flatMap(([k, v]) => nonFinite(v, `${path}.${k}`));
  return [];
}

describe('предупреждение «L4, но…»: три условия на границах', () => {
  const i = (reserve: number, trough: number) => ({ reserveEssentialMonths: reserve, needEssential: 100, troughNet: trough * 100 });
  it('запас по необходимым: 5,9 — предупреждение, 6 — нет', () => {
    expect(l4Warnings(i(5.9, 10), 0).map((w) => w.id)).toEqual(['reserve']);
    expect(l4Warnings(i(6, 10), 0)).toEqual([]);
  });
  it('минимум по неблагоприятному прогнозу: 2,9 — предупреждение, 3 — нет; отрицательный минимум показывается как 0', () => {
    expect(l4Warnings(i(10, 2.9), 0).map((w) => w.id)).toEqual(['trough']);
    expect(l4Warnings(i(10, 3), 0)).toEqual([]);
    expect(l4Warnings(i(10, -2), 0)[0]!.text).toContain('0,0 мес.');
  });
  it('недоступно за 30 дней: ровно 50 % — нет, 51 % — предупреждение с числом', () => {
    expect(l4Warnings(i(10, 10), 0.5)).toEqual([]);
    const w = l4Warnings(i(10, 10), 0.51);
    expect(w.map((x) => x.id)).toEqual(['blocked']);
    expect(w[0]!.text).toContain('51 %');
  });
  it('каждое условие объясняет причину числом и сразу несколько условий показываются все', () => {
    const w = l4Warnings(i(4, 1), 0.8);
    expect(w.map((x) => x.id)).toEqual(['reserve', 'trough', 'blocked']);
    expect(w[0]!.text).toContain('4,0 мес.');
    expect(w[1]!.text).toContain('1,0 мес.');
  });
  it('без необходимых расходов (нечем мерить) условие прогноза не срабатывает', () => {
    expect(l4Warnings({ reserveEssentialMonths: 10, needEssential: 0, troughNet: 0 }, 0)).toEqual([]);
  });
});

describe('пустое и неполное состояние', () => {
  it('пустое состояние: «нет данных», без исключений и без чисел-мусора', () => {
    const v = view(emptyState());
    expect(v.status).toBe('no_data');
    expect(v.level).toBeNull();
    expect(v.directions).toEqual([]);
    expect(v.range).toBeNull();
    expect(nonFinite(v)).toEqual([]);
  });

  it('короткая история: диапазон есть, нижняя граница не выше верхней, ориентир между ними, уровень показан', () => {
    const short = probeProfiles().find((p) => p.name.startsWith('A (история с 2026-09'))!;
    const v = view(short.state);
    expect(v.status).toBe('ok');
    expect(v.range).not.toBeNull();
    const r = v.range!;
    expect(r.low).toBeLessThanOrEqual(r.point + 1e-9);
    expect(r.point).toBeLessThanOrEqual(r.high + 1e-9);
    expect(v.rangeLevels).not.toBeNull();
    expect(nonFinite(v)).toEqual([]);
  });

  it('данных хватает на всё — диапазона нет', () => {
    const v = view(named('B Работающий'));
    const rep = computeIndicators(named('B Работающий'), TODAY);
    const anyUnknown = Object.values(rep.values).some((x) => x === null);
    expect(v.range === null).toBe(!anyUnknown);
  });
});

describe('«Здесь и сейчас», «Вектор», «Безопасность будущего»', () => {
  it('три направления с человеческими названиями; коды показателей наружу не выходят', () => {
    const v = view(named('B Работающий'));
    expect(v.directions.map((d) => d.name)).toEqual([DIRECTION_NAMES.N, DIRECTION_NAMES.V, DIRECTION_NAMES.F]);
    for (const d of v.directions) for (const ind of d.indicators) expect(ind.label).toBe(INDICATOR_LABELS[ind.id]);
    for (const label of Object.values(INDICATOR_LABELS)) expect(label).not.toMatch(/\b[NVF][1-4]\b/);
  });

  it('слабое место — направление с наименьшей оценкой, внутри него показатель с наименьшей оценкой', () => {
    const v = view(named('C С долгами'));
    const scores = v.directions.filter((d) => d.score !== null);
    const min = scores.reduce((a, b) => (b.score! < a.score! ? b : a));
    expect(v.weak!.direction).toBe(min.id);
    const known = min.indicators.filter((x) => x.score !== null);
    expect(v.weak!.indicator!.score).toBe(Math.min(...known.map((x) => x.score!)));
  });
});

describe('уровень совпадает с движком', () => {
  it('уровень и `G` на именных профилях равны результату levelFromIndicators (экран ничего не пересчитывает)', () => {
    for (const np of namedProfiles()) {
      const p = { name: np.name, state: applyProbeOpts(np.state, np.opts) };
      const v = view(p.state);
      const base = levelFromIndicators(computeIndicators(p.state, TODAY));
      if (v.basis === 'independence') continue;
      expect(v.level, p.name).toBe(base ? base.result.level : null);
      expect(v.g, p.name).toBe(base ? base.g : null);
    }
  });

  it('ограничитель показывается словами: M1b «богат, но неликвиден» — «денег меньше чем на месяц», уровень не выше L2', () => {
    const v = view(named('M1b богат, но неликвиден'));
    expect(v.limitsFired.map((l) => l.id)).toContain('cover1');
    expect(v.limitsFired.find((l) => l.id === 'cover1')!.text).toContain('месяц');
    expect(v.level!).toBeLessThanOrEqual(2);
  });

  it('запас до следующего уровня: следующий уровень на единицу выше, нехватка очков положительна; у L4 и выше «следующего» нет', () => {
    for (const np of namedProfiles()) {
      const v = view(applyProbeOpts(np.state, np.opts));
      if (v.next) {
        expect(v.next.level).toBe(v.level! + 1);
        expect(v.next.needs.length).toBeGreaterThan(0);
      }
      if (v.level !== null && v.level >= 4) expect(v.next).toBeNull();
    }
  });
});

describe('независимость и L5', () => {
  const fi = Object.fromEntries(independenceProfiles().map((p) => [p.name, view(p.state)])) as Record<string, PositionView>;
  it('уровни профилей независимости: FI2, FI3, FI8 — L5; FI1 — L4; FI4–FI7 — L3', () => {
    expect(['FI1', 'FI2', 'FI3', 'FI4', 'FI5', 'FI6', 'FI7', 'FI8'].map((n) => fi[n]!.level)).toEqual([4, 5, 5, 3, 3, 3, 3, 5]);
  });
  it('при L5 основание — независимость, есть пометка для живущих на капитал; центральная и консервативная оценки рядом', () => {
    const v = fi.FI8!;
    expect(v.basis).toBe('independence');
    expect(v.independenceNote).toBe(INDEPENDENCE_TEXTS.l5Note);
    expect(v.independence.c.central).toBeGreaterThan(v.independence.c.conservative);
    expect(v.independence.total.central).toBeGreaterThanOrEqual(1.25);
  });
  it('предупреждение «L4, но…» только при L4', () => {
    for (const [n, v] of Object.entries(fi)) if (v.level !== 4) expect(v.l4Warnings, n).toEqual([]);
  });
  it('в текстах независимости нет слов «безопасно», «гарантированно», «обеспечено»', () => {
    for (const t of Object.values(INDEPENDENCE_TEXTS)) expect(t).not.toMatch(/безопасн|гарантир|обеспечен/i);
  });
});

describe('две строки капитала (D138)', () => {
  it('«Всего капитал» не меньше «Денег, которые можно потратить», когда долгов нет; у богатого, но неликвидного различие большое', () => {
    const v = view(named('M1b богат, но неликвиден'));
    expect(v.money.total).toBeGreaterThan(70_000_000);
    expect(v.money.spendable).toBeLessThan(v.money.total * 0.1);
    expect(v.money.blockedShare).toBeGreaterThan(0.5);
  });
  it('деньги, которые можно потратить, никогда не отрицательны', () => {
    for (const p of probeProfiles().slice(0, 60)) expect(view(applyProbeOpts(p.state, p.opts)).money.spendable, p.name).toBeGreaterThanOrEqual(0);
  });
});

describe('вопрос «Что обязательно?» и достоверность', () => {
  it('на пустом состоянии вопрос не задаётся (сначала импорт)', () => {
    expect(view(emptyState()).essentialMissing).toBe(false);
  });
  it('достоверность в пределах 0–1; «предварительно» ровно когда она ниже 0,5', () => {
    for (const p of probeProfiles().slice(0, 40)) {
      const v = view(applyProbeOpts(p.state, p.opts));
      expect(v.confidence).toBeGreaterThanOrEqual(0);
      expect(v.confidence).toBeLessThanOrEqual(1);
      expect(v.preliminary).toBe(v.confidence < 0.5);
    }
  });
});

describe('инвариант: ни одного NaN на всех профилях проб', () => {
  it('1131 профиль без исключений и без нечисловых значений (проверка по выборке: каждый 4-й)', () => {
    const all = probeProfiles();
    const bad: string[] = [];
    for (let i = 0; i < all.length; i += 4) {
      const p = all[i]!;
      const v = view(applyProbeOpts(p.state, p.opts));
      bad.push(...nonFinite(v).map((s) => `${p.name}: ${s}`));
    }
    expect(bad).toEqual([]);
  });
});
