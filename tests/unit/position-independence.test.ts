/**
 * T10 «Положение» v4: независимость и уровень L5 (решения 3–5, D126; спец. 10.1, t00-decisions раздел 4, model-final 4.2–4.4).
 *
 * Источники ожидаемых значений — НЕ код движка:
 *  1. примеры расчёта из t00-decisions 4.2 и model-final 4.3–4.4 (капитал 100 / 250 / 300 млн, пенсия 160 тыс., требуемый капитал 375 млн);
 *  2. таблица профилей FI1–FI8 (спец. 10.9) через tests/fixtures/position/independence-reference.json;
 *  3. ручная арифметика на границах порогов (1,25; изъятие = дефицит; горизонт 30 / 40 / 50 / 60).
 * Тесты написаны до кода (правило «тесты вперёд»).
 */
import { describe, it, expect } from 'vitest';
import {
  INDEPENDENCE_THRESHOLD, HORIZON_DEFAULT_YEARS, horizonYears, withdrawalRate, requiredCapital,
  computeIndependence, independenceOfState, levelWithIndependence, notAssessedLine, INDEPENDENCE_TEXTS,
  type IndependenceInput,
} from '../../engine/position/independence';
import { computeIndicators } from '../../engine/position/indicators';
import { levelFromIndicators } from '../../engine/position/level';
import { tenge } from '../../engine/money';
import type { AppState } from '../../engine/state';
import type { ManualAccount } from '../../engine/settings';
import { fixtureJson } from '../support/fixtures';
import { independenceProfiles, namedProfiles, TODAY } from '../support/position-profiles';

const M = 1_000_000;
const NEED = 400_000;
const base = (over: Partial<IndependenceInput> = {}): IndependenceInput => ({
  capital: 250 * M, need: NEED, passive: [], deficit: 0, horizon: 50, limitsFired: [], spiral: false, missing: [], ...over,
});

describe('константы и горизонт', () => {
  it('порог 1,25, горизонт по умолчанию 50 лет', () => {
    expect(INDEPENDENCE_THRESHOLD).toBe(1.25);
    expect(HORIZON_DEFAULT_YEARS).toBe(50);
  });
  it('горизонт = 90 − возраст, в пределах 30–60; без возраста 50', () => {
    expect(horizonYears(undefined)).toBe(50);
    expect(horizonYears(20)).toBe(60); // 70 → предел таблицы
    expect(horizonYears(30)).toBe(60);
    expect(horizonYears(40)).toBe(50);
    expect(horizonYears(50)).toBe(40);
    expect(horizonYears(57)).toBe(33);
    expect(horizonYears(60)).toBe(30);
    expect(horizonYears(75)).toBe(30); // 15 → нижний предел
  });
  it('ставки в узлах таблицы: центральная 2,2 / 1,9 / 1,6 %, консервативная 1,1 / 0,8 / 0,5 %', () => {
    expect(withdrawalRate('central', 40)).toBeCloseTo(0.022, 10);
    expect(withdrawalRate('central', 50)).toBeCloseTo(0.019, 10);
    expect(withdrawalRate('central', 60)).toBeCloseTo(0.016, 10);
    expect(withdrawalRate('conservative', 40)).toBeCloseTo(0.011, 10);
    expect(withdrawalRate('conservative', 50)).toBeCloseTo(0.008, 10);
    expect(withdrawalRate('conservative', 60)).toBeCloseTo(0.005, 10);
  });
  it('между узлами — линейно; короче 40 лет — ставка 40 лет (таблица за 40 не оценена; D137)', () => {
    expect(withdrawalRate('central', 45)).toBeCloseTo(0.0205, 10);
    expect(withdrawalRate('conservative', 55)).toBeCloseTo(0.0065, 10);
    expect(withdrawalRate('central', 30)).toBeCloseTo(0.022, 10);
    expect(withdrawalRate('central', 33)).toBeCloseTo(0.022, 10);
    expect(withdrawalRate('central', 70)).toBeCloseTo(0.016, 10); // выше 60 не оценено
  });
  it('чем длиннее горизонт, тем ниже ставка (монотонность на сетке 30–60)', () => {
    for (const set of ['central', 'conservative'] as const) {
      for (let h = 31; h <= 60; h++) expect(withdrawalRate(set, h)).toBeLessThanOrEqual(withdrawalRate(set, h - 1) + 1e-12);
    }
  });
});

describe('C: примеры из t00-decisions 4.2 (расходы 400 тыс., горизонт 50)', () => {
  it('капитал 100 / 250 / 300 млн → C центральная 0,40 / 0,99 / 1,19; консервативная 0,17 / 0,42 / 0,50', () => {
    const exp: [number, number, number][] = [[100, 0.4, 0.17], [250, 0.99, 0.42], [300, 1.19, 0.5]];
    for (const [m, c, cc] of exp) {
      const r = computeIndependence(base({ capital: m * M }));
      expect(r.c.central, `${m} млн`).toBeCloseTo(c, 2);
      expect(r.c.conservative, `${m} млн`).toBeCloseTo(cc, 2);
    }
  });
  it('формула: C = K · w / (12 · need)', () => {
    const r = computeIndependence(base({ capital: 250 * M }));
    expect(r.c.central).toBeCloseTo((250 * M * 0.019) / (12 * NEED), 12);
  });
  it('капитала нет или расходы неизвестны — C = 0 / не оценено, а не NaN', () => {
    const zero = computeIndependence(base({ capital: 0 }));
    expect(zero.c.central).toBe(0);
    const noNeed = computeIndependence(base({ need: 0 }));
    expect(noNeed.status).toBe('not_assessed');
    expect(noNeed.missing).toContain('expenses');
    for (const v of [noNeed.c.central, noNeed.c.conservative, noNeed.p, noNeed.total.central, noNeed.total.conservative]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('P: примеры из t00-decisions 4.2', () => {
  it('пенсия 160 тыс., индексируется → 0,36; не индексируется → 0,18', () => {
    expect(computeIndependence(base({ passive: [{ monthly: 160_000, indexed: true }] })).p).toBeCloseTo(0.36, 10);
    expect(computeIndependence(base({ passive: [{ monthly: 160_000, indexed: false }] })).p).toBeCloseTo(0.18, 10);
  });
  it('аренда 100 тыс., индексируется → 0,225; несколько источников складываются', () => {
    expect(computeIndependence(base({ passive: [{ monthly: 100_000, indexed: true }] })).p).toBeCloseTo(0.225, 10);
    expect(computeIndependence(base({ passive: [{ monthly: 160_000, indexed: true }, { monthly: 100_000, indexed: true }] })).p).toBeCloseTo(0.585, 10);
  });
  it('нет независимых поступлений — P = 0', () => {
    expect(computeIndependence(base()).p).toBe(0);
  });
});

describe('C + P: таблица «Пример 3» из t00-decisions 4.2', () => {
  it('250 млн + пенсия, индексируется: 1,35 центральная / 0,78 консервативная', () => {
    const r = computeIndependence(base({ passive: [{ monthly: 160_000, indexed: true }] }));
    expect(r.total.central).toBeCloseTo(1.35, 2);
    expect(r.total.conservative).toBeCloseTo(0.78, 2);
    expect(r.status).toBe('confirmed');
  });
  it('250 млн + та же пенсия, не индексируется: 1,17 / 0,60 — порог 1,25 не достигнут', () => {
    const r = computeIndependence(base({ passive: [{ monthly: 160_000, indexed: false }] }));
    expect(r.total.central).toBeCloseTo(1.17, 2);
    expect(r.total.conservative).toBeCloseTo(0.6, 2);
    expect(r.status).toBe('not_confirmed');
    expect(r.blockers).toEqual(['coverage']);
  });
  it('консервативное значение возвращается всегда вместе с центральным (при любом статусе, где оно считается)', () => {
    const cases = [base(), base({ deficit: 1_000_000 }), base({ limitsFired: ['gap'] }), base({ spiral: true }), base({ capital: 10 * M })];
    for (const c of cases) {
      const r = computeIndependence(c);
      expect(Number.isFinite(r.total.central)).toBe(true);
      expect(Number.isFinite(r.total.conservative)).toBe(true);
      expect(r.total.conservative).toBeLessThan(r.total.central);
    }
  });
});

describe('порог 1,25 по центральной ставке', () => {
  // капитал, при котором C = 1,25 ровно: K = 1,25 · 12 · need / w
  const exact = (h: number) => (INDEPENDENCE_THRESHOLD * 12 * NEED) / withdrawalRate('central', h);
  it('ровно на пороге — подтверждено; чуть ниже — нет', () => {
    expect(computeIndependence(base({ capital: exact(50) + 1 })).status).toBe('confirmed');
    expect(computeIndependence(base({ capital: exact(50) - 1_000 })).status).toBe('not_confirmed');
  });
  it('требуемый капитал: model-final 4.3–4.4 (60 лет, C + P = 1,25 → 375 млн; 50 лет, C + P = 1 → 252,6 млн)', () => {
    expect(requiredCapital({ need: NEED, horizon: 60, p: 0, target: 1.25, set: 'central' })).toBeCloseTo(375 * M, -2);
    expect(requiredCapital({ need: NEED, horizon: 50, p: 0, target: 1, set: 'central' })).toBeCloseTo(252.63 * M, -4);
    expect(requiredCapital({ need: NEED, horizon: 50, p: 0, target: 1, set: 'conservative' })).toBeCloseTo(600 * M, -2);
    expect(requiredCapital({ need: NEED, horizon: 40, p: 0, target: 2, set: 'central' })).toBeCloseTo(436.36 * M, -4);
  });
  it('P снижает требуемый капитал: пенсия 0,36 при цели 1,25 и 50 лет', () => {
    expect(requiredCapital({ need: NEED, horizon: 50, p: 0.36, target: 1.25, set: 'central' })).toBeCloseTo((0.89 * 12 * NEED) / 0.019, -2);
  });
  it('P выше цели — требуемый капитал 0, а не отрицательный', () => {
    expect(requiredCapital({ need: NEED, horizon: 50, p: 2, target: 1.25, set: 'central' })).toBe(0);
  });
  it('горизонт влияет: 60 лет требует больше капитала, чем 50 (на 19 % по центральной ставке, model-final 4.6)', () => {
    const r60 = requiredCapital({ need: NEED, horizon: 60, p: 0, target: 1.25, set: 'central' });
    const r50 = requiredCapital({ need: NEED, horizon: 50, p: 0, target: 1.25, set: 'central' });
    expect(r60 / r50 - 1).toBeCloseTo(0.1875, 3);
  });
});

describe('устойчивость потока: 12 · дефицит ≤ K · w (центральная ставка)', () => {
  it('пример: 250 млн, дефицит 240 тыс. в месяц → 2,88 млн в год против изъятия 4,75 млн — устойчив', () => {
    const r = computeIndependence(base({ passive: [{ monthly: 160_000, indexed: true }], deficit: 240_000 }));
    expect(r.sustain.deficitYear).toBeCloseTo(2.88 * M, 0);
    expect(r.sustain.withdrawalYear).toBeCloseTo(4.75 * M, 0);
    expect(r.sustain.ok).toBe(true);
    expect(r.status).toBe('confirmed');
  });
  it('граница: изъятие равно дефициту — устойчив; на тенге больше — нет', () => {
    const w = 250 * M * 0.019;
    expect(computeIndependence(base({ deficit: w / 12 })).sustain.ok).toBe(true);
    const r = computeIndependence(base({ deficit: w / 12 + 1 }));
    expect(r.sustain.ok).toBe(false);
    expect(r.status).toBe('not_confirmed');
    expect(r.blockers).toContain('sustain');
  });
  it('капитал большой, но проедается быстрее ставки — не независимость, даже при C + P ≥ 1,25', () => {
    const r = computeIndependence(base({ capital: 400 * M, deficit: 700_000 }));
    expect(r.total.central).toBeGreaterThanOrEqual(1.25);
    expect(r.sustain.ok).toBe(false);
    expect(r.status).toBe('not_confirmed');
  });
  it('нет дефицита — условие выполнено без проверки', () => {
    expect(computeIndependence(base({ deficit: 0 })).sustain.ok).toBe(true);
  });
  it('дефицит неизвестен (мало истории) — не оценено, а не «подтверждено»', () => {
    const r = computeIndependence(base({ deficit: null, missing: ['history'] }));
    expect(r.status).toBe('not_assessed');
    expect(r.sustain.ok).toBeNull();
  });
});

describe('ограничители, спираль, достоверность', () => {
  it('сработавший ограничитель блокирует L5 и называется в причинах', () => {
    const r = computeIndependence(base({ capital: 600 * M, limitsFired: ['gap'] }));
    expect(r.status).toBe('not_confirmed');
    expect(r.blockers).toEqual(['limit']);
  });
  it('долговая спираль блокирует L5', () => {
    const r = computeIndependence(base({ capital: 600 * M, spiral: true }));
    expect(r.status).toBe('not_confirmed');
    expect(r.blockers).toEqual(['spiral']);
  });
  it('все причины перечисляются, не только первая', () => {
    const r = computeIndependence(base({ capital: 10 * M, deficit: 500_000, limitsFired: ['cover1'], spiral: true }));
    expect(r.blockers).toEqual(['coverage', 'sustain', 'limit', 'spiral']);
  });
  it('недостаточно данных — «не оценено» с перечнем, чего не хватает; это не отказ', () => {
    const r = computeIndependence(base({ capital: 600 * M, missing: ['history', 'confidence'] }));
    expect(r.status).toBe('not_assessed');
    expect(r.missing).toEqual(['history', 'confidence']);
    expect(r.blockers).toEqual([]);
  });
  it('спираль «не проверить» (null) не блокирует и не оценивается как признак', () => {
    expect(computeIndependence(base({ capital: 600 * M, spiral: null })).status).toBe('confirmed');
  });
});

describe('ставка по возрасту доходит до расчёта', () => {
  it('возраст 20 (60 лет) требует больше, чем без возраста (50): C ниже при том же капитале', () => {
    const r50 = computeIndependence(base({ horizon: horizonYears(undefined) }));
    const r60 = computeIndependence(base({ horizon: horizonYears(20) }));
    expect(r60.horizon).toBe(60);
    expect(r60.c.central).toBeLessThan(r50.c.central);
    expect(r60.rates.central).toBeCloseTo(0.016, 10);
  });
});

describe('FI1–FI8 (спец. 10.9): C, P и устойчивость на состоянии бэкапа', () => {
  interface Ref {
    profiles: Record<string, { independence: { deficitPctOfCapitalPerYear: number; C: { low: number; central: number }; P: number } }>;
    independenceConfirmedByCentralRate: string[];
    independenceConfirmedByLowRate: string[];
  }
  const REF = fixtureJson<Ref>('position/independence-reference.json');
  const profiles = independenceProfiles();
  /** Пенсия и аренда — независимые поступления (в пробе у FI3–FI7 весь доход считался независимым и индексируемым). */
  const asIndependent = (st: AppState): AppState => ({
    ...st,
    settings: { ...st.settings, incomeSchedule: st.settings.incomeSchedule.map((i) => ({ ...i, passive: true, fromAssets: false, indexed: true })) },
  });
  const stateOf = (name: string): AppState => {
    const p = profiles.find((x) => x.name === name)!;
    return p.monthlyIncome >= 700_000 ? p.state : asIndependent(p.state); // FI1, FI2, FI8 — зарплата
  };
  const res = (name: string) => independenceOfState(stateOf(name), TODAY);

  for (const p of profiles) {
    it(`${p.name}: C (низкая / центральная) и P как в таблице 10.9`, () => {
      const r = res(p.name);
      const ref = REF.profiles[p.name]!.independence;
      expect(r.status, p.name).not.toBe('not_assessed');
      expect(Math.abs(r.c.conservative - ref.C.low), 'C низкая').toBeLessThan(0.011);
      expect(Math.abs(r.c.central - ref.C.central), 'C центральная').toBeLessThan(0.011);
      // P в таблице округлён до сотых и у FI6 записан как 0,4 вместо 0,36 (текст спец. 10.9 даёт 1,14 = 0,78 + 0,36): сверяем с арифметикой и с таблицей грубо
      const expectedP = p.monthlyIncome >= 700_000 ? 0 : (0.9 * p.monthlyIncome) / (NEED * p.expenseFactor);
      expect(r.p, p.name).toBeCloseTo(expectedP, 6);
      expect(Math.abs(r.p - ref.P), 'P против таблицы').toBeLessThan(0.05);
    });
  }

  it('устойчивость: пропускает FI3 и FI6, отклоняет FI4, FI5, FI7; у работающих дефицита нет', () => {
    const ok = (n: string) => res(n).sustain.ok;
    expect(['FI3', 'FI6'].map(ok)).toEqual([true, true]);
    expect(['FI4', 'FI5', 'FI7'].map(ok)).toEqual([false, false, false]);
    expect(['FI1', 'FI2', 'FI8'].map(ok)).toEqual([true, true, true]);
    expect(res('FI1').sustain.deficitYear).toBe(0);
  });
  it('дефицит в процентах капитала в год совпадает с таблицей (допуск 0,02 п. п.)', () => {
    for (const p of profiles) {
      const r = res(p.name);
      const pct = r.capital > 0 ? (100 * r.sustain.deficitYear) / r.capital : 0;
      expect(Math.abs(pct - REF.profiles[p.name]!.independence.deficitPctOfCapitalPerYear), p.name).toBeLessThan(0.02);
    }
  });
  it('по центральной ставке при пороге 1 подтверждены FI2, FI3, FI6, FI8; по низкой — только FI8 (спец. 10.9)', () => {
    const central = profiles.filter((p) => res(p.name).total.central >= 1 && res(p.name).sustain.ok).map((p) => p.name);
    const low = profiles.filter((p) => res(p.name).total.conservative >= 1).map((p) => p.name);
    expect(central).toEqual(REF.independenceConfirmedByCentralRate);
    expect(low).toEqual(REF.independenceConfirmedByLowRate);
  });
  it('при принятом пороге 1,25 подтверждены FI2, FI3, FI8; FI6 (1,14) — нет', () => {
    const confirmed = profiles.filter((p) => res(p.name).status === 'confirmed').map((p) => p.name);
    expect(confirmed).toEqual(['FI2', 'FI3', 'FI8']);
    expect(res('FI6').total.central).toBeCloseTo(1.14, 2);
    expect(res('FI6').blockers).toEqual(['coverage']);
  });
  it('у FI1, FI2, FI8 нет сработавших ограничителей и спирали; K — доступные деньги', () => {
    for (const p of profiles) {
      const r = res(p.name);
      expect(r.blockers.includes('limit'), p.name).toBe(false);
      expect(r.blockers.includes('spiral'), p.name).toBe(false);
    }
  });

  describe('уровень: L5 проверяется первой (план T10: FI8 → L5, FI3 → L5, FI4 → L3, FI1 → L4)', () => {
    const levelOf = (name: string) => {
      const st = stateOf(name);
      const lvl = levelFromIndicators(computeIndicators(st, TODAY));
      return levelWithIndependence(lvl, independenceOfState(st, TODAY));
    };
    it('FI8 → L5, FI3 → L5, FI2 → L5', () => {
      for (const n of ['FI8', 'FI3', 'FI2']) expect(levelOf(n).level, n).toBe(5);
    });
    it('FI4 → L3, FI5 → L3, FI6 → L3, FI7 → L3', () => {
      for (const n of ['FI4', 'FI5', 'FI6', 'FI7']) expect(levelOf(n).level, n).toBe(3);
    });
    it('FI1 → L4 (правка V1), не L5', () => {
      expect(levelOf('FI1').level).toBe(4);
    });
    it('L5 у FI3 при G ≈ 48: основание — независимость, а не G; пометка для живущих на капитал', () => {
      const r = levelOf('FI3');
      expect(r.basis).toBe('independence');
      expect(r.note).toBe(INDEPENDENCE_TEXTS.l5Note);
      expect(r.name).toBe('Свобода выбора');
    });
    it('FI4 остаётся по G: основание — оценка, причина «не хватает капитала»', () => {
      const r = levelOf('FI4');
      expect(r.basis).toBe('score');
      expect(r.independence.blockers).toContain('coverage');
    });
  });
});

describe('levelWithIndependence на синтетике', () => {
  const lvl3 = { level: 3 as const, name: 'Стабильность' };
  const fake = (level: 1 | 2 | 3 | 4) => ({ g: 60, fired: [], directions: {}, result: { level, name: ['', 'Выживание', 'Нестабильность', 'Стабильность', 'Безопасность'][level] } }) as never;
  it('подтверждена — L5 независимо от базового уровня, G не режется', () => {
    for (const l of [1, 2, 3, 4] as const) {
      const r = levelWithIndependence(fake(l), computeIndependence(base({ capital: 600 * M })));
      expect(r.level).toBe(5);
    }
    void lvl3;
  });
  it('не подтверждена или не оценена — уровень по G без изменений; при «не оценена» есть строка с причиной', () => {
    const nc = levelWithIndependence(fake(3), computeIndependence(base({ capital: 10 * M })));
    expect(nc.level).toBe(3);
    expect(nc.note).toBeUndefined();
    const na = levelWithIndependence(fake(3), computeIndependence(base({ missing: ['history'] })));
    expect(na.level).toBe(3);
    expect(na.independenceLine).toBe(notAssessedLine(['history']));
  });
  it('нет базового уровня (нет данных) и независимость не оценена — уровня нет', () => {
    const r = levelWithIndependence(null, computeIndependence(base({ missing: ['no_data'] })));
    expect(r.level).toBeNull();
  });
});

describe('вид актива и доступность: K только из инвестируемого и доступного за 30 дней (D132)', () => {
  const fi3 = independenceProfiles().find((p) => p.name === 'FI3')!;
  const acc = (over: Partial<ManualAccount>): ManualAccount => ({
    id: 'm1', title: 'Ручной счёт', balance: tenge(100 * M), balanceDate: TODAY, liquidity: { kind: 'instant' }, comment: '', ...over,
  });
  const withAcc = (a: ManualAccount): AppState => ({ ...fi3.state, manualAccounts: [a] });
  const k0 = independenceOfState(fi3.state, TODAY).capital;

  it('вклад (и «не указано» = вклад) доступный сразу входит в K', () => {
    expect(independenceOfState(withAcc(acc({ assetKind: 'deposit' })), TODAY).capital).toBeCloseTo(k0 + 100 * M, -1);
    expect(independenceOfState(withAcc(acc({})), TODAY).capital).toBeCloseTo(k0 + 100 * M, -1);
  });
  it('ценные бумаги и наличные входят в K', () => {
    expect(independenceOfState(withAcc(acc({ assetKind: 'securities' })), TODAY).capital).toBeCloseTo(k0 + 100 * M, -1);
    expect(independenceOfState(withAcc(acc({ assetKind: 'cash' })), TODAY).capital).toBeCloseTo(k0 + 100 * M, -1);
  });
  it('«неинвестируемое» (жильё, закрытое) в K не входит, даже если доступно сразу', () => {
    expect(independenceOfState(withAcc(acc({ assetKind: 'non_investable' })), TODAY).capital).toBeCloseTo(k0, -1);
  });
  it('деньги, доступные позже 30 дней, в K не входят; до 30 дней — входят', () => {
    expect(independenceOfState(withAcc(acc({ assetKind: 'deposit', liquidity: { kind: 'days', days: 60 } })), TODAY).capital).toBeCloseTo(k0, -1);
    expect(independenceOfState(withAcc(acc({ assetKind: 'deposit', liquidity: { kind: 'days', days: 20 } })), TODAY).capital).toBeCloseTo(k0 + 100 * M, -1);
    expect(independenceOfState(withAcc(acc({ assetKind: 'deposit', liquidity: { kind: 'locked_until', date: '2027-06-01' } })), TODAY).capital).toBeCloseTo(k0, -1);
  });
  it('заметный счёт сдвигает уровень независимости: FI4 + 400 млн вклада → C + P выше', () => {
    const fi4 = independenceProfiles().find((p) => p.name === 'FI4')!;
    const before = independenceOfState(fi4.state, TODAY);
    const after = independenceOfState({ ...fi4.state, manualAccounts: [acc({ assetKind: 'deposit', balance: tenge(400 * M) })] }, TODAY);
    expect(after.total.central).toBeGreaterThan(before.total.central + 1);
  });
});

describe('пассивные доходы: что входит в P (D130)', () => {
  const fi6 = independenceProfiles().find((p) => p.name === 'FI6')!;
  const withFlags = (flags: Record<string, unknown>): AppState => ({
    ...fi6.state, settings: { ...fi6.state.settings, incomeSchedule: fi6.state.settings.incomeSchedule.map((i) => ({ ...i, ...flags })) },
  });
  const p = (flags: Record<string, unknown>) => independenceOfState(withFlags(flags), TODAY).p;
  it('без признаков — доход от труда, в P не входит', () => {
    expect(p({})).toBe(0);
  });
  it('пассивный без ответа «из этих активов» — с активов K, в P не входит (иначе капитал посчитан дважды)', () => {
    expect(p({ passive: true })).toBe(0);
    expect(p({ passive: true, fromAssets: true })).toBe(0);
  });
  it('пассивный и «не из этих активов»: входит; индексируется — ×1, иначе (и «не указано») — ×0,5, налог 10 %', () => {
    expect(p({ passive: true, fromAssets: false, indexed: true })).toBeCloseTo((0.9 * 160_000) / 400_000, 6);
    expect(p({ passive: true, fromAssets: false, indexed: false })).toBeCloseTo((0.9 * 0.5 * 160_000) / 400_000, 6);
    expect(p({ passive: true, fromAssets: false })).toBeCloseTo((0.9 * 0.5 * 160_000) / 400_000, 6);
  });
  it('нерегулярный источник в P не входит; закончившийся и ещё не начавшийся — тоже', () => {
    expect(p({ passive: true, fromAssets: false, indexed: true, kind: 'irregular' })).toBe(0);
    expect(p({ passive: true, fromAssets: false, indexed: true, end: '2026-10-01' })).toBe(0);
    expect(p({ passive: true, fromAssets: false, indexed: true, start: '2027-03-01' })).toBe(0);
  });
  it('ручное переопределение статуса «ожидаемый» (X) или «временный» (T) не даёт попасть в P: нужен подтверждённый постоянный', () => {
    expect(p({ passive: true, fromAssets: false, indexed: true, status: 'X' })).toBe(0);
    expect(p({ passive: true, fromAssets: false, indexed: true, status: 'T' })).toBe(0);
    expect(p({ passive: true, fromAssets: false, indexed: true, status: 'P' })).toBeGreaterThan(0);
  });
});

describe('нехватка данных', () => {
  it('пустое состояние: «не оценена», без исключений и NaN', () => {
    const r = independenceOfState({ ...independenceProfiles()[0]!.state, imported: undefined } as AppState, TODAY);
    expect(r.status).toBe('not_assessed');
    expect(r.missing).toContain('no_data');
    for (const v of [r.c.central, r.c.conservative, r.p, r.total.central, r.total.conservative, r.capital]) expect(Number.isFinite(v)).toBe(true);
  });
  it('названные профили не дают исключений; все числа конечны', () => {
    for (const p of namedProfiles()) {
      const r = independenceOfState(p.state, TODAY);
      for (const v of [r.c.central, r.c.conservative, r.p, r.total.central, r.total.conservative]) expect(Number.isFinite(v), p.name).toBe(true);
    }
  });
  it('на названных профилях A–E, D34 и др. независимости нет (в выборках она недостижима, спец. 10.9)', () => {
    for (const p of namedProfiles()) expect(independenceOfState(p.state, TODAY).status, p.name).not.toBe('confirmed');
  });
});

describe('чистота и инварианты', () => {
  it('два вызова дают равный результат', () => {
    const st = independenceProfiles()[2]!.state;
    expect(independenceOfState(st, TODAY)).toEqual(independenceOfState(st, TODAY));
  });
  it('желаемые расходы не меняют результат независимости (решение 8: только личный сценарий)', () => {
    const st = independenceProfiles()[2]!.state;
    const withDesired: AppState = { ...st, settings: { ...st.settings, position: { desiredMonthly: tenge(900_000) } } };
    expect(independenceOfState(withDesired, TODAY)).toEqual(independenceOfState(st, TODAY));
  });
  it('возраст меняет только горизонт: те же капитал и P, другая ставка', () => {
    const st = independenceProfiles()[2]!.state;
    const young: AppState = { ...st, settings: { ...st.settings, position: { age: 25 } } };
    const a = independenceOfState(st, TODAY), b = independenceOfState(young, TODAY);
    expect(b.horizon).toBe(60);
    expect(a.horizon).toBe(50);
    expect(b.capital).toBe(a.capital);
    expect(b.c.central).toBeLessThan(a.c.central);
  });
});

describe('формулировки: нет слов «безопасно», «гарантированно», «обеспечено»', () => {
  const FORBIDDEN = /безопасн|гарантир|обеспечен/i;
  const all = (): string[] => [
    ...Object.values(INDEPENDENCE_TEXTS),
    notAssessedLine(['no_data']),
    notAssessedLine(['history', 'confidence', 'expenses']),
  ];
  it('ни одна фиксированная строка не содержит запрещённых слов', () => {
    for (const s of all()) expect(s, s).not.toMatch(FORBIDDEN);
  });
  it('обязательные формулировки: допущения центрального набора, запас 25 %, пометка при L5', () => {
    expect(INDEPENDENCE_TEXTS.assumptions).toContain('20 % в год');
    expect(INDEPENDENCE_TEXTS.assumptions).toContain('5–6 %');
    expect(INDEPENDENCE_TEXTS.l5Label).toBe('независимость при центральных допущениях с запасом 25 %');
    expect(INDEPENDENCE_TEXTS.l5Note).toContain('N2, V4, F2, F4');
    expect(INDEPENDENCE_TEXTS.scenarioNote.toLowerCase()).toContain('сценарная оценка');
  });
  it('строка «не оценена» называет, чего не хватает', () => {
    expect(notAssessedLine(['history'])).toMatch(/^независимость не оценена: не хватает /);
    expect(notAssessedLine(['history'])).toContain('3 полных месяцев');
    expect(notAssessedLine(['no_data'])).toContain('операций');
    expect(notAssessedLine(['history', 'expenses'])).toContain(', ');
  });
});
