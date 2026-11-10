/**
 * T03 «Положение» v4, часть 2: статусы источников дохода P / T / X / I (`incomeSources`).
 *
 * Источники ожидаемых значений — НЕ код движка:
 *  1. tests/fixtures/position/sources-reference.json — снят дословным запуском `sourcesOf()` из проб (position-probe-v2-a.md)
 *     на старом `buildSimInput`, 139 профилей (127 профилей проб и 12 с событиями доходов);
 *  2. ручной подсчёт выплат в окне «после сегодня и не позже чем через 12 месяцев» на выдуманных потоках.
 * Намеренное отличие от пробы: границы окна (+12 и +6 месяцев) считаются функциями движка и прижимаются к концу месяца
 * (как везде в движке), а не через `Date.setUTCMonth`, который 29–31-е число переносит в следующий месяц.
 */
import { describe, it, expect } from 'vitest';
import { incomeSources, incomeSourcesOf, SOURCE_CLIFF_MONTHS, SOURCE_HORIZON_MONTHS } from '../../engine/position/sources';
import { buildSimInput } from '../../engine/plan';
import { emptyState, parseState, serializeState } from '../../engine/state';
import { tenge, type Money } from '../../engine/money';
import type { IncomeStream, LifeEvent } from '../../engine/simulate';
import { fixtureJson } from '../support/fixtures';
import { applyProbeOpts, build, namedProfiles, probeProfiles, SPECS2, TODAY } from '../support/position-profiles';
import { incomeEventCases } from '../support/income-event-cases';

interface RefSource { id: string; title: string; monthly: number; status: 'P' | 'T' | 'X' | 'I'; volume: number; endsWithin6m: boolean }
const REF = fixtureJson<{ today: string; profiles: Record<string, RefSource[]> }>('position/sources-reference.json');

const all = [
  ...probeProfiles().map((p) => ({ name: p.name, state: applyProbeOpts(p.state, p.opts) })),
  ...incomeEventCases().map((c) => ({ name: 'событие|' + c.name, state: c.state })),
];
const strip = (s: ReturnType<typeof incomeSources>[number]) => ({ id: s.id, title: s.title, monthly: s.monthly, status: s.status, volume: s.volume, endsWithin6m: s.endsWithin6m });

describe('эталон проб: состав', () => {
  it('набор профилей совпадает с эталоном по именам (139)', () => {
    expect(all.map((p) => p.name).sort()).toEqual(Object.keys(REF.profiles).sort());
    expect(all.length).toBe(139);
    expect(REF.today).toBe(TODAY);
  });
  it('в эталоне есть все четыре статуса', () => {
    const seen = new Set(Object.values(REF.profiles).flat().map((s) => s.status));
    expect([...seen].sort()).toEqual(['I', 'P', 'T', 'X']);
  });
});

describe('статусы и объёмы совпадают с пробой до тиына', () => {
  for (const p of all) {
    it(p.name, () => {
      const { input } = buildSimInput(p.state, TODAY);
      const got = incomeSources(input, TODAY).map(strip);
      const ref = REF.profiles[p.name]!;
      // D131: у потоков с продолжением после income_change статус и «обрыв» намеренно отличаются от пробы (см. отдельные тесты ниже)
      const bridged = new Set(got.filter((x) => got.some((y) => y.id.startsWith(`${x.id}@`))).map((x) => x.id));
      const norm = (xs: typeof ref) => xs.map((x) => (bridged.has(x.id) ? { ...x, status: 'D131', endsWithin6m: false } : x));
      expect(norm(got)).toEqual(norm(ref));
    });
  }
});

describe('именные профили (ручная проверка)', () => {
  const byName = (n: string) => namedProfiles().find((x) => x.name === n)!;
  const statuses = (n: string) => {
    const p = byName(n);
    return incomeSourcesOf(applyProbeOpts(p.state, p.opts), TODAY).map((s) => [s.id, s.status]);
  };
  it('A: стипендия до 25.06.2027 — временная, пособие — постоянное', () => {
    expect(statuses('A Студент')).toEqual([['stip', 'T'], ['ben', 'P']]);
  });
  it('A: объём стипендии — 8 выплат 23-го с 23.11.2026 по 23.06.2027 по 50 000; пособия — 12 выплат 12-го по 40 000', () => {
    const s = incomeSourcesOf(byName('A Студент').state, TODAY);
    expect(s[0]!.volume).toBe(tenge(400_000));
    expect(s[1]!.volume).toBe(tenge(480_000));
    expect(s.map((x) => x.endsWithin6m)).toEqual([false, false]);
  });
  it('B, C, D: единственная зарплата — постоянная; E: нерегулярный доход — нерегулярный', () => {
    expect(statuses('B Работающий')).toEqual([['job', 'P']]);
    expect(statuses('C С долгами')).toEqual([['job', 'P']]);
    expect(statuses('D Высокий доход')).toEqual([['job', 'P']]);
    expect(statuses('E Капитал, нестабильный')).toEqual([['free', 'I']]);
  });
});

// ───────── ручные случаи на выдуманных потоках ─────────

const T0 = '2026-11-04'; // окно выплат: после этой даты и не позже 2027-11-04; «обрыв» — до 2027-05-04
const stream = (p: Partial<IncomeStream> & Pick<IncomeStream, 'id'>): IncomeStream => ({ title: p.id, amount: tenge(100_000), dayOfMonth: 5, kind: 'work', ...p });
const one = (s: IncomeStream, events: LifeEvent[] = [], today = T0) => incomeSources({ incomes: [s], events }, today);
const ev = (p: Partial<LifeEvent> & Pick<LifeEvent, 'id' | 'kind' | 'date'>): LifeEvent => ({ title: p.id, amount: tenge(0), ...p });
const m100 = (n: number): Money => tenge(100_000 * n);

describe('окно выплат', () => {
  it('константы горизонта', () => {
    expect(SOURCE_HORIZON_MONTHS).toBe(12);
    expect(SOURCE_CLIFF_MONTHS).toBe(6);
  });

  it('5-е число: 05.11.2026 … 05.10.2027 — 12 выплат (05.11.2027 уже за горизонтом)', () => {
    expect(one(stream({ id: 'a' }))[0]!.volume).toBe(m100(12));
  });

  it('4-е число: выплата в день «сегодня» не считается, выплата ровно в конце горизонта (04.11.2027) считается — снова 12', () => {
    expect(one(stream({ id: 'a', dayOfMonth: 4 }))[0]!.volume).toBe(m100(12));
  });

  it('31-е число: в коротких месяцах выплата в последний день месяца; 30.11.2026 … 31.10.2027 — 12 выплат', () => {
    expect(one(stream({ id: 'a', dayOfMonth: 31 }))[0]!.volume).toBe(m100(12));
  });

  it('начало в будущем: с 01.03.2027, 10-е число — 10.03 … 10.10.2027, 8 выплат; статус P', () => {
    const r = one(stream({ id: 'a', dayOfMonth: 10, start: '2027-03-01' }))[0]!;
    expect(r.volume).toBe(m100(8));
    expect(r.status).toBe('P');
  });

  it('начало ровно в день выплаты включает её: 01.07.2027, 1-е число — июль … ноябрь 2027, 5 выплат', () => {
    expect(one(stream({ id: 'a', dayOfMonth: 1, start: '2027-07-01' }))[0]!.volume).toBe(m100(5));
  });

  it('поток, закончившийся до сегодняшнего дня, и поток без выплат в окне исключаются', () => {
    expect(one(stream({ id: 'a', end: '2026-10-31' }))).toEqual([]);
    expect(one(stream({ id: 'a', dayOfMonth: 20, end: '2026-11-10' }))).toEqual([]);
  });

  it('поток с нулевой суммой исключается', () => {
    expect(one(stream({ id: 'a', amount: tenge(0) }))).toEqual([]);
  });
});

describe('статус по дате окончания и «обрыв за 6 месяцев»', () => {
  it('конец ровно через 12 месяцев (04.11.2027) — временный; на день позже — постоянный', () => {
    expect(one(stream({ id: 'a', dayOfMonth: 4, end: '2027-11-04' }))[0]!.status).toBe('T');
    expect(one(stream({ id: 'a', dayOfMonth: 4, end: '2027-11-05' }))[0]!.status).toBe('P');
  });

  it('конец ровно через 6 месяцев (04.05.2027) — «обрыв»; на день позже — нет; считаются выплаты 1-го числа с 01.12.2026 по 01.05.2027', () => {
    const a = one(stream({ id: 'a', dayOfMonth: 1, end: '2027-05-04' }))[0]!;
    expect(a.endsWithin6m).toBe(true);
    expect(a.volume).toBe(m100(6));
    expect(one(stream({ id: 'a', dayOfMonth: 1, end: '2027-05-05' }))[0]!.endsWithin6m).toBe(false);
  });

  it('нерегулярный остаётся нерегулярным и с концом, и без; вид «стабильный» (пенсия) без конца — постоянный', () => {
    expect(one(stream({ id: 'a', kind: 'irregular', end: '2027-03-01' }))[0]!.status).toBe('I');
    expect(one(stream({ id: 'a', kind: 'irregular' }))[0]!.status).toBe('I');
    expect(one(stream({ id: 'a', kind: 'stable' }))[0]!.status).toBe('P');
  });
});

describe('события', () => {
  it('income_start — ожидаемый (X); не «обрыв» даже с концом внутри 6 месяцев', () => {
    const r = one(stream({ id: 'base' }), [ev({ id: 'e1', kind: 'income_start', date: '2027-01-01', amount: tenge(100_000), dayOfMonth: 1, until: '2027-03-31' })]);
    expect(r.map((s) => [s.id, s.status, s.endsWithin6m])).toEqual([['base', 'P', false], ['e1', 'X', false]]);
    expect(r[1]!.volume).toBe(m100(3)); // 01.01, 01.02, 01.03.2027
  });

  it('income_stop делает исходный поток временным и «обрывом»; его объём уменьшается до выплат до остановки', () => {
    const r = one(stream({ id: 'job' }), [ev({ id: 'e1', kind: 'income_stop', date: '2027-03-01', target: 'job' })]);
    expect(r[0]!.status).toBe('T');
    expect(r[0]!.endsWithin6m).toBe(true);
    expect(r[0]!.volume).toBe(m100(4)); // 05.11, 05.12.2026, 05.01, 05.02.2027
  });

  it('income_change без срока (D131): старый поток остаётся постоянным и не «обрыв», новый — ожидаемый с новой суммой', () => {
    const r = one(stream({ id: 'job' }), [ev({ id: 'e1', kind: 'income_change', date: '2027-02-01', target: 'job', amount: tenge(150_000) })]);
    expect(r.map((s) => [s.id, s.status, s.monthly, s.endsWithin6m])).toEqual([['job', 'P', tenge(100_000), false], ['job@2027-02-01', 'X', tenge(150_000), false]]);
    expect(r[0]!.volume).toBe(m100(3)); // 05.11, 05.12.2026, 05.01.2027 — объём до смены не меняется
    expect(r[1]!.volume).toBe(tenge(150_000 * 9)); // 05.02 … 05.10.2027
  });
});

describe('ручное переопределение статуса', () => {
  it('переопределение побеждает выведенный статус и не меняет объём; помечается', () => {
    const [x] = one(stream({ id: 'a', status: 'X' }));
    expect(x!.status).toBe('X');
    expect(x!.overridden).toBe(true);
    expect(x!.volume).toBe(m100(12));
    expect(one(stream({ id: 'a', kind: 'irregular', status: 'P' }))[0]!.status).toBe('P');
    expect(one(stream({ id: 'a', end: '2027-03-01', status: 'P' }))[0]!.status).toBe('P');
    expect(one(stream({ id: 'a', status: 'I' }))[0]!.status).toBe('I');
  });

  it('без переопределения флаг ложный', () => {
    expect(one(stream({ id: 'a' }))[0]!.overridden).toBe(false);
  });

  it('поток, созданный событием, переопределения не наследует: новый поток после income_change остаётся X', () => {
    const r = one(stream({ id: 'job', status: 'P' }), [ev({ id: 'e1', kind: 'income_change', date: '2027-02-01', target: 'job', amount: tenge(150_000) })]);
    expect(r[0]!.status).toBe('P');
    expect(r[0]!.overridden).toBe(true);
    expect(r[1]!.status).toBe('X');
    expect(r[1]!.overridden).toBe(false);
  });
});

describe('границы окна прижимаются к концу месяца', () => {
  it('сегодня 29.02.2028: горизонт — 28.02.2029 (проба через Date.setUTCMonth дала бы 01.03.2029)', () => {
    // конец 01.03.2029: с границей 28.02.2029 это постоянный источник; по пробе был бы временным
    expect(one(stream({ id: 'a', end: '2029-03-01' }), [], '2028-02-29')[0]!.status).toBe('P');
    expect(one(stream({ id: 'a', end: '2029-02-28' }), [], '2028-02-29')[0]!.status).toBe('T');
  });
  it('сегодня 31.08.2026: граница «обрыва» — 28.02.2027', () => {
    expect(one(stream({ id: 'a', dayOfMonth: 1, end: '2027-02-28' }), [], '2026-08-31')[0]!.endsWithin6m).toBe(true);
    expect(one(stream({ id: 'a', dayOfMonth: 1, end: '2027-03-01' }), [], '2026-08-31')[0]!.endsWithin6m).toBe(false);
  });
});

describe('переопределение в состоянии и в расписании', () => {
  const withStatus = (status: unknown) => {
    const st = build(SPECS2[0]!);
    return { ...st, settings: { ...st.settings, incomeSchedule: st.settings.incomeSchedule.map((i) => (i.id === 'ben' ? ({ ...i, status } as never) : i)) } };
  };

  it('статус попадает в поток прогноза; у остальных поля нет', () => {
    const { input } = buildSimInput(withStatus('X'), TODAY);
    expect(input.incomes.find((i) => i.id === 'ben')!.status).toBe('X');
    expect('status' in input.incomes.find((i) => i.id === 'stip')!).toBe(false);
  });

  it('сводка источников учитывает переопределение: пособие стало ожидаемым', () => {
    const s = incomeSourcesOf(withStatus('X'), TODAY);
    expect(s.map((x) => [x.id, x.status, x.overridden])).toEqual([['stip', 'T', false], ['ben', 'X', true]]);
  });

  it('переопределение переживает запись и чтение побайтно', () => {
    const text = serializeState(withStatus('I'), TODAY);
    const r = parseState(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.settings.incomeSchedule.find((i) => i.id === 'ben')!.status).toBe('I');
    expect(serializeState(r.value, TODAY)).toBe(text);
    expect(r.explanation.every((e) => e.level !== 'warn')).toBe(true);
  });

  it('недопустимое значение отбрасывается с предупреждением, остальное читается; повторное чтение чистое', () => {
    for (const bad of ['Z', 'p', 5, true, {}, []]) {
      const r = parseState(serializeState(withStatus(bad), TODAY));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect('status' in r.value.settings.incomeSchedule.find((i) => i.id === 'ben')!).toBe(false);
      expect(r.explanation.filter((e) => e.level === 'warn').map((e) => e.code)).toEqual(['income.status.dropped']);
      const again = parseState(serializeState(r.value, TODAY));
      expect(again.ok && again.explanation.filter((e) => e.level === 'warn')).toEqual([]);
    }
  });

  it('null читается как «нет переопределения» без предупреждения', () => {
    const r = parseState(serializeState(withStatus(null), TODAY));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('status' in r.value.settings.incomeSchedule.find((i) => i.id === 'ben')!).toBe(false);
    expect(r.explanation.filter((e) => e.level === 'warn')).toEqual([]);
  });

  it('состояние без переопределений не меняется при чтении', () => {
    const text = serializeState(build(SPECS2[0]!), TODAY);
    const r = parseState(text);
    expect(r.ok && serializeState(r.value, TODAY)).toBe(text);
  });

  it('пустое состояние: источников нет', () => {
    expect(incomeSourcesOf(emptyState(), TODAY)).toEqual([]);
  });
});

describe('D131: смена суммы — продолжение источника, а не его конец', () => {
  const chg = (id: string, date: string, extra: Partial<LifeEvent> = {}) => ev({ id, kind: 'income_change', date, target: 'job', amount: tenge(150_000), ...extra });
  it('смена на срок: цепочка кончается в until — исходный поток «временный» по концу цепочки, «обрыв» по нему же', () => {
    const r = one(stream({ id: 'job' }), [chg('e1', '2027-02-01', { until: '2027-03-31' })]);
    expect(r[0]!.status).toBe('T'); // цепочка кончается 31.03.2027 — внутри 12 месяцев
    expect(r[0]!.endsWithin6m).toBe(true); // и внутри 6 месяцев (до 04.05.2027)
  });
  it('смена на срок, цепочка кончается позже 6 месяцев — не «обрыв»', () => {
    const r = one(stream({ id: 'job' }), [chg('e1', '2027-02-01', { until: '2027-07-31' })]);
    expect(r[0]!.status).toBe('T');
    expect(r[0]!.endsWithin6m).toBe(false);
  });
  it('смена, затем прекращение: «обрыв» определяется концом цепочки (прекращение 01.06.2027 — позже 04.05.2027, не «обрыв»)', () => {
    const r = one(stream({ id: 'job' }), [chg('e1', '2027-01-01'), ev({ id: 'e2', kind: 'income_stop', date: '2027-06-01', target: 'job' })]);
    expect(r[0]!.endsWithin6m).toBe(false);
    expect(r[0]!.status).toBe('T');
  });
  it('смена, затем прекращение внутри 6 месяцев — «обрыв» у исходного потока', () => {
    const r = one(stream({ id: 'job' }), [chg('e1', '2027-01-01'), ev({ id: 'e2', kind: 'income_stop', date: '2027-03-01', target: 'job' })]);
    expect(r[0]!.endsWithin6m).toBe(true);
  });
  it('прекращение без смены остаётся «обрывом» (не затронуто)', () => {
    const r = one(stream({ id: 'job' }), [ev({ id: 'e2', kind: 'income_stop', date: '2027-03-01', target: 'job' })]);
    expect(r[0]!.endsWithin6m).toBe(true);
    expect(r[0]!.status).toBe('T');
  });
  it('собственный конец исходного потока раньше смены — не продолжение: остаётся «обрывом»', () => {
    const r = one(stream({ id: 'job', end: '2027-01-31' }), [chg('e1', '2027-03-01')]);
    expect(r[0]!.endsWithin6m).toBe(true);
    expect(r[0]!.status).toBe('T');
  });
});
