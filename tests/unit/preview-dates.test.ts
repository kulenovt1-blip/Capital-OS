/**
 * Предпросмотры «Через год» считают на дату «сегодня + N месяцев», как «Прогноз» и «Что если» (D142, D144, D147).
 * Раньше брался конец N-го месяца: событие между датой срока и концом месяца попадало в число.
 */
import { describe, it, expect } from 'vitest';
import { build, SPECS2, TODAY } from '../support/position-profiles';
import { baseForecast, baseForecastTrace, capitalAt, cutEvent, previewBaselineMode, previewEvent, previewIndexed, previewRepeat } from '../../engine/simple';
import { previewAnswer } from '../../engine/hidden';
import { capitalInMonths, capitalOn, forecastDate } from '../../engine/forecast-steps';
import { tenge } from '../../engine/money';
import { addDays } from '../../engine/date';
import { simulate } from '../../engine/simulate';
import { buildSimInput } from '../../engine/plan';

const state = () => build(SPECS2[1]!);
const onDate = (s: ReturnType<typeof state>, k: number) => capitalOn(baseForecastTrace(s, TODAY, Math.max(k, 12)), forecastDate(TODAY, k));

describe('capitalInMonths', () => {
  it('с трассой — капитал на дату; без трассы — конец месяца, как раньше', () => {
    const s = state();
    expect(capitalInMonths(baseForecastTrace(s, TODAY, 12), TODAY, 12)).toBe(onDate(s, 12));
    expect(capitalInMonths(baseForecast(s, TODAY, 12), TODAY, 12)).toBe(capitalAt(baseForecast(s, TODAY, 12), 12));
  });
});

describe('предпросмотры считают на дату', () => {
  it('«Повторятся?»: «как сейчас» = капитал на дату', () => {
    const s = state();
    const cat = s.imported!.categories.find((c) => c.id !== undefined)!;
    expect(previewRepeat(s, TODAY, cat.id, 12).now).toBe(onDate(s, 12));
  });
  it('«Рост дохода»: оба ответа на дату', () => {
    const s = state();
    const pv = previewIndexed(s, TODAY, 'job', 36);
    const set = (v: boolean) => ({ ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.map((x) => (x.id === 'job' ? { ...x, indexed: v } : x)) } });
    expect(pv.yes).toBe(capitalOn(baseForecastTrace(set(true), TODAY, 36), forecastDate(TODAY, 36)));
    expect(pv.no).toBe(capitalOn(baseForecastTrace(set(false), TODAY, 36), forecastDate(TODAY, 36)));
  });
  it('previewAnswer: оба ответа на дату', () => {
    const s = state();
    const set = (st: typeof s, yes: boolean) => ({ ...st, settings: { ...st.settings, baselineMode: yes ? ('no_work' as const) : ('last' as const) } });
    const pv = previewAnswer(s, TODAY, set, 12);
    expect(pv.yes).toBe(capitalOn(baseForecastTrace(set(s, true), TODAY, 12), forecastDate(TODAY, 12)));
  });
  it('«Траты и зарплата»: капитал на дату, если режим применим', () => {
    const s = state();
    const pv = previewBaselineMode(s, TODAY, 12);
    if (pv) expect(pv.capitalNow).toBe(capitalOn(baseForecastTrace({ ...s, settings: { ...s.settings, baselineMode: 'last' } }, TODAY, 12), forecastDate(TODAY, 12)));
  });
  it('«Где можно сэкономить»: событие после даты срока в том же месяце на «Через год» не влияет', () => {
    const s = state();
    const d = forecastDate(TODAY, 12);
    const after = addDays(d, 1);
    expect(after.slice(0, 7)).toBe(d.slice(0, 7)); // тот же месяц — иначе тест ничего не проверяет
    const ev = [{ id: 'x', kind: 'one_off' as const, date: after, title: 'Покупка', amount: tenge(3_000_000) }];
    const pv = previewEvent(s, TODAY, ev, 14);
    const c = pv.capital(12);
    expect(c.with).toBe(c.without);
    // а событие до даты срока уменьшает
    const before = previewEvent(s, TODAY, [{ ...ev[0]!, date: addDays(d, -1) }], 14).capital(12);
    expect(before.with!).toBeLessThan(before.without!);
  });
  it('цели и сдвиги не меняются: ряд по месяцам прежний', () => {
    const s = state();
    const { input } = buildSimInput(s, TODAY);
    const a = simulate({ ...input, horizonMonths: 14 });
    const b = simulate({ ...input, horizonMonths: 14 }, undefined, { trace: true });
    expect(b.months).toEqual(a.months);
    expect(cutEvent).toBeTypeOf('function');
  });
});
