/**
 * Туры по персонажам (app/persona-tours.ts): тексты — про то, что реально видно на экране у человека; числа и утверждения сверяются с движком.
 */
import { describe, it, expect } from 'vitest';
import { positionViewOf } from '../../engine/position/view';
import { personaTourSteps } from '../../app/persona-tours';
import { PERSONAS } from '../../app/personas';
import { PERSONA_TODAY, personaState } from '../support/personas';

const view = (id: Parameters<typeof personaState>[0]) => positionViewOf(personaState(id), PERSONA_TODAY);
const BANNED = /\b(безопасно|гарантированно|обеспечено)\b/i; // D126
const TARGETS = new Set(['[data-tour=level]', '[data-tour=dirs]', '[data-tour=weak]', '[data-tour=path]', '[data-tour=money]', '.pos-now']);

describe('туры по персонажам', () => {
  for (const p of PERSONAS) {
    it(`${p.name}: 2–3 шага, цели — блоки «Профиля», без запрещённых слов, без кодов`, () => {
      const steps = personaTourSteps(p.id, view(p.id));
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps.length).toBeLessThanOrEqual(3);
      for (const s of steps) {
        expect(TARGETS.has(s.target as string)).toBe(true);
        expect(s.title.length).toBeGreaterThan(0);
        expect(`${s.title} ${s.text}`).not.toMatch(BANNED);
        expect(`${s.title} ${s.text}`).not.toMatch(/\b[NVF][1-4]\b|undefined|NaN/);
      }
      expect(steps[0]!.title).toContain(`ступень ${p.level}`);
    });
  }

  it('Берик: названа сумма дефицита, она равна дефициту из движка', () => {
    const v = view('berik');
    const t = personaTourSteps('berik', v)[0]!.text;
    expect(v.runway.deficit).toBeGreaterThan(0);
    expect(t).toContain(`${Math.round(v.runway.deficit / 1000)} тыс ₸`);
  });

  it('Алия: «ниже всех показателей — долговая нагрузка» и «около трети дохода» — правда по движку', () => {
    const v = view('aliya');
    const all = v.directions.flatMap((d) => d.indicators).filter((i) => i.score !== null).sort((a, b) => a.score! - b.score!);
    expect(all[0]!.id).toBe('N3');
    const share = v.flow!.obligations / v.flow!.income;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.4);
  });

  it('Серик: тур берёт текст «удерживает» из движка', () => {
    const v = view('serik');
    expect(v.held).toBeTruthy();
    expect(personaTourSteps('serik', v)[0]!.text).toBe(v.held!);
  });

  it('Олжас и Дантал: «слабое место» у Олжаса есть, у Дантала — ступень 5 и подтверждённая независимость', () => {
    expect(view('olzhas').weak).not.toBeNull();
    const d = view('dantal');
    expect(d.level).toBe(5);
    expect(d.independence.status).toBe('confirmed');
  });
});
