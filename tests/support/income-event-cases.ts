/**
 * Синтетические состояния с событиями, которые меняют потоки дохода (income_start / income_stop / income_change),
 * и с индексируемым доходом. Нужны двум проверкам T03: «прогноз не изменился после выноса сборки потоков»
 * (tests/fixtures/position/simulate-baseline.json снят со старого кода) и статусам источников.
 * Все данные выдуманы. Даты — относительно TODAY (2026-11-04).
 */
import type { AppState } from '../../engine/state';
import type { LifeEvent } from '../../engine/simulate';
import { tenge } from '../../engine/money';
import { build, SPECS2 } from './position-profiles';

const [A, B, , , E] = SPECS2;

function withEvents(st: AppState, events: LifeEvent[]): AppState {
  return { ...st, settings: { ...st.settings, plannedEvents: [...st.settings.plannedEvents, ...events] } };
}

function indexed(st: AppState, ids: string[], inflationBp = 800): AppState {
  return {
    ...st,
    settings: { ...st.settings, inflationBp, incomeSchedule: st.settings.incomeSchedule.map((i) => (ids.includes(i.id) ? { ...i, indexed: true, indexMonth: 3 } : i)) },
  };
}

export interface EventCase { name: string; state: AppState }

export function incomeEventCases(): EventCase[] {
  const a = build(A!);
  const b = build(B!);
  const e = build(E!);
  return [
    { name: 'B: доход прекращается', state: withEvents(b, [{ id: 'ev1', title: 'Увольнение', date: '2027-03-01', kind: 'income_stop', target: 'job', amount: tenge(0) }]) },
    { name: 'B: доход меняется без срока', state: withEvents(b, [{ id: 'ev1', title: 'Повышение', date: '2027-02-01', kind: 'income_change', target: 'job', amount: tenge(500_000) }]) },
    { name: 'B: доход меняется на срок', state: withEvents(b, [{ id: 'ev1', title: 'Проект', date: '2027-02-01', kind: 'income_change', target: 'job', amount: tenge(550_000), until: '2027-07-31' }]) },
    {
      name: 'B: смена, затем прекращение того же дохода',
      state: withEvents(b, [
        { id: 'ev1', title: 'Повышение', date: '2027-01-01', kind: 'income_change', target: 'job', amount: tenge(450_000) },
        { id: 'ev2', title: 'Уход', date: '2027-06-01', kind: 'income_stop', target: 'job', amount: tenge(0) },
      ]),
    },
    { name: 'B: смена несуществующего дохода', state: withEvents(b, [{ id: 'ev1', title: 'Ошибка', date: '2027-02-01', kind: 'income_change', target: 'nothing', amount: tenge(1) }]) },
    { name: 'A: новая работа (ожидаемый доход)', state: withEvents(a, [{ id: 'ev1', title: 'Новая работа', date: '2027-07-01', kind: 'income_start', amount: tenge(60_000), incomeKind: 'work', dayOfMonth: 10 }]) },
    { name: 'A: подработка на срок', state: withEvents(a, [{ id: 'ev1', title: 'Подработка', date: '2027-01-15', kind: 'income_start', target: 'side', amount: tenge(30_000), until: '2027-04-30', incomeKind: 'irregular' }]) },
    {
      name: 'A: все виды событий вперемешку',
      state: withEvents(a, [
        { id: 'ev1', title: 'Новая работа', date: '2027-03-05', kind: 'income_start', target: 'newjob', amount: tenge(80_000), incomeKind: 'work' },
        { id: 'ev2', title: 'Стипендия растёт', date: '2027-02-01', kind: 'income_change', target: 'stip', amount: tenge(70_000) },
        { id: 'ev3', title: 'Трата', date: '2027-02-10', kind: 'one_off', amount: tenge(100_000) },
        { id: 'ev4', title: 'Меньше трат', date: '2027-01-01', kind: 'recurring_change', amount: -tenge(5_000) },
        { id: 'ev5', title: 'Погашение', date: '2026-12-10', kind: 'obligation_payoff', target: 'ph', amount: tenge(0) },
      ]),
    },
    { name: 'B: индексируемый доход', state: indexed(b, ['job']) },
    { name: 'B: индексируемый доход и смена', state: withEvents(indexed(b, ['job']), [{ id: 'ev1', title: 'Повышение', date: '2027-05-01', kind: 'income_change', target: 'job', amount: tenge(520_000) }]) },
    { name: 'E: нерегулярный доход и новая работа', state: withEvents(e, [{ id: 'ev1', title: 'Работа', date: '2027-04-01', kind: 'income_start', amount: tenge(300_000), incomeKind: 'work' }]) },
    { name: 'A: событие в день 31 в коротком месяце', state: withEvents(a, [{ id: 'ev1', title: 'Доход 31-го', date: '2027-01-31', kind: 'income_start', amount: tenge(10_000), dayOfMonth: 31 }]) },
  ];
}
