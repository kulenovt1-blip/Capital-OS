/**
 * D151: человеческие названия уровней и условия-факты.
 *
 * Название уровня должно быть правдой, поэтому кроме очков каждый уровень требует факта:
 *  «От зарплаты до зарплаты» — доходы покрывают расходы (норма сбережений ≥ 0) или запас ≥ 3 мес.;
 *  «Есть подушка» — запас ≥ 3 мес. необходимых расходов;
 *  «Защищён от ударов» — запас ≥ 6 мес.
 * Ожидаемые значения: ручная арифметика на синтетических входах; на пуле — инварианты (свойства, а не числа)
 * и снимок долей (регрессия, снят кодом после D151 — не независимый эталон).
 */
import { describe, it, expect } from 'vitest';
import { reserveNow } from '../../engine/reserve';
import { gateLevel, levelOf, levelFromIndicators, L3_RESERVE_MONTHS, L4_RESERVE_MONTHS, type LevelInput, type Level } from '../../engine/position/level';
import { computeIndicators } from '../../engine/position/indicators';
import { build, namedProfiles, randomSpec, randomSpecDyn, stressCase, applyProbeOpts, TODAY } from '../support/position-profiles';

const strong: LevelInput = { g: 90, directions: { N: 90, V: 90, F: 90 }, reliable: { N: true, V: true, F: true }, fired: [] };

describe('gateLevel: срез по фактам', () => {
  it('пороги запаса — 3 и 6 месяцев', () => {
    expect([L3_RESERVE_MONTHS, L4_RESERVE_MONTHS]).toEqual([3, 6]);
  });
  it('без фактов уровень не меняется', () => {
    for (const l of [1, 2, 3, 4] as Level[]) expect(gateLevel(l, undefined)).toEqual({ level: l, held: null });
  });
  it('4 при запасе 5,9 → 3 («reserve6»); при 6 — остаётся 4', () => {
    expect(gateLevel(4, { reserveMonths: 5.9, savingRate: 0.2 })).toEqual({ level: 3, held: { reason: 'reserve6', byScore: 4 } });
    expect(gateLevel(4, { reserveMonths: 6, savingRate: 0.2 }).level).toBe(4);
  });
  it('4 при запасе 2 → 2 («reserve3»); 3 при запасе 2,9 → 2', () => {
    expect(gateLevel(4, { reserveMonths: 2, savingRate: 0.2 })).toEqual({ level: 2, held: { reason: 'reserve3', byScore: 4 } });
    expect(gateLevel(3, { reserveMonths: 2.9, savingRate: 0 }).level).toBe(2);
  });
  it('дефицит и запас < 3 → 1 («deficit»); дефицит при запасе ≥ 3 не опускает ниже очков', () => {
    expect(gateLevel(3, { reserveMonths: 1, savingRate: -0.1 })).toEqual({ level: 1, held: { reason: 'deficit', byScore: 3 } });
    expect(gateLevel(2, { reserveMonths: 1, savingRate: -0.1 }).level).toBe(1);
    expect(gateLevel(3, { reserveMonths: 4, savingRate: -0.5 }).level).toBe(3);
  });
  it('норма сбережений неизвестна — дефицит не проверяется', () => {
    expect(gateLevel(2, { reserveMonths: 0.5, savingRate: null }).level).toBe(2);
  });
});

describe('levelOf с фактами', () => {
  it('очки на «Защищён», запас 4 мес. → «Есть подушка», очков до следующего не показывает', () => {
    const r = levelOf({ ...strong, facts: { reserveMonths: 4, savingRate: 0.2 } });
    expect(r.level).toBe(3);
    expect(r.name).toBe('Есть подушка');
    expect(r.held).toEqual({ reason: 'reserve6', byScore: 4 });
    expect(r.shortfallToNext).toBeNull();
    expect(r.l4Unconfirmed).toBe(false);
  });
  it('запас 6 мес. → «Защищён от ударов»', () => {
    const r = levelOf({ ...strong, facts: { reserveMonths: 6, savingRate: 0.2 } });
    expect([r.level, r.name, r.held]).toEqual([4, 'Защищён от ударов', null]);
  });
});

describe('пул проб с фактами (1120 профилей + именные)', () => {
  const states = [
    ...Array.from({ length: 400 }, (_, i) => build(randomSpec(i + 1))),
    ...Array.from({ length: 400 }, (_, i) => build(randomSpecDyn(i + 1))),
    ...Array.from({ length: 320 }, (_, i) => { const c = stressCase(i); return applyProbeOpts(c.state, c.opts); }),
    ...namedProfiles().map((p) => applyProbeOpts(p.state, p.opts)),
  ];
  const rows = states.map((s) => { const rep = computeIndicators(s, TODAY); return { rep, lv: levelFromIndicators(rep) }; }).filter((r) => r.lv);

  it('инварианты: «Есть подушка» и выше — запас ≥ 3; «Защищён» — запас ≥ 6; дефицит без запаса — «Не хватает на жизнь»', () => {
    for (const { rep, lv } of rows) {
      const i = rep.inputs!, l = lv!.result.level;
      if (l >= 3) expect(i.reserveEssentialMonths).toBeGreaterThanOrEqual(3);
      if (l === 4) expect(i.reserveEssentialMonths).toBeGreaterThanOrEqual(6);
      if (i.savingRate !== null && i.savingRate < 0 && i.reserveEssentialMonths < 3) expect(l).toBe(1);
      expect(l).toBeLessThanOrEqual(lv!.result.held?.byScore ?? l);
    }
  });
  it('факты только опускают: уровень с фактами ≤ уровня по очкам, и опущен ровно тогда, когда есть причина', () => {
    for (const { lv } of rows) {
      const r = lv!.result;
      if (r.held) expect(r.held.byScore).toBeGreaterThan(r.level);
    }
  });
  it('К4 (D157): «Запас» на «Обзоре» и запас в условиях ступени — одно число (с точностью до округления вниз до десятых)', () => {
    let n = 0;
    states.forEach((st) => {
      const rep = computeIndicators(st, TODAY), r = reserveNow(st, TODAY);
      if (!rep.inputs || !r) return;
      n++;
      expect(r.coverMonths).toBe(Math.floor(rep.inputs.reserveEssentialMonths * 10 + 1e-9) / 10);
    });
    expect(n).toBeGreaterThan(1000);
  }, 120_000);
  it('К3 (D156): ступень 1 — только при дефиците и запасе < 3 мес.; иначе поднята до 2 с пометкой', () => {
    for (const { rep, lv } of rows) {
      const i = rep.inputs!, r = lv!.result;
      const deficitNoReserve = i.savingRate !== null && i.savingRate < 0 && i.reserveEssentialMonths < 3;
      if (r.level === 1) expect(deficitNoReserve).toBe(true);
      if (r.lifted) { expect(r.level).toBe(2); expect(deficitNoReserve).toBe(false); }
    }
    expect(rows.filter(({ lv }) => lv!.result.lifted).length).toBe(1);
  });
  it('снимок долей после D151 (регрессия)', () => {
    const c = [0, 0, 0, 0], by = [0, 0, 0, 0];
    for (const { lv } of rows) { c[lv!.result.level - 1]!++; by[(lv!.result.held?.byScore ?? lv!.result.lifted?.byScore ?? lv!.result.level) - 1]!++; }
    // 1131 профиль: по очкам 61 / 184 / 558 / 328; с фактами 144 / 110 / 550 / 327 — 83 профиля с дефицитом без запаса уходят в «Не хватает на жизнь»
    expect({ withFacts: c, byScore: by }).toEqual({ withFacts: [143, 111, 550, 327], byScore: [61, 184, 558, 328] });
    // К3 (D156): «Не хватает на жизнь» — только дефицит и запас < 3 мес.; один профиль с запасом 8,85 мес. (D382) поднят с 1 до 2: 144 / 110 → 143 / 111
  });
});
