import { positionViewOf } from '../../../engine/position/view';
import { computeIndicators } from '../../../engine/position/indicators';
import { reserveNow } from '../../../engine/reserve';
import { emptyState } from '../../../engine/state';
import { tenge } from '../../../engine/money';
import { build, mk, SPECS2, TODAY, applyProbeOpts } from '../../../tests/support/position-profiles';
import { acc, trf } from '../../../tests/support/build';
const f = (x: any, d = 1) => (x === null || x === undefined ? '—' : typeof x === 'number' ? x.toFixed(d) : x);
function show(label: string, s: any) {
  try {
    const v = positionViewOf(s, TODAY);
    const rep = computeIndicators(s, TODAY);
    const rv = reserveNow(s, TODAY);
    const vals = rep.values;
    console.log(`${label}: status=${v.status} ур=${v.level} «${v.levelName}» G=${f(v.g)} N/V/F=${v.directions.map((d) => f(d.score)).join('/')} rel=${v.directions.map((d) => (d.reliable ? 'y' : 'n')).join('')} range=${v.range ? f(v.range.low) + '–' + f(v.range.high) + ' show=' + v.range.showPoint : '—'} запасНеобх=${f(v.money.reserveEssentialMonths)} cover=${rv?.coverMonths ?? '—'} норма=${f(rep.inputs?.savingRate, 3)} N3=${f(vals.N3)} incM=${f(rep.inputs?.incomeMonthly, 0)} conf=${f(v.confidence, 2)} prelim=${v.preliminary} held=${v.held ?? '-'} indep=${v.independence.status}${v.independenceLine ? ' «' + v.independenceLine + '»' : ''}`);
  } catch (e) { console.log(label, 'ОШИБКА', (e as Error).message); }
}
show('E0 пустое состояние', emptyState());
const B = SPECS2[1]!;
for (const from of ['2026-10', '2026-09', '2026-08', '2026-07', '2026-05', '2026-04', '2026-03']) show(`E1 B, история с ${from}`, build({ ...B, from }));
show('E2 нет расходов вообще', build(mk('Z', 1_000_000, 300_000, [])));
show('E2b только развлечения (нет необходимых)', build(mk('Z2', 1_000_000, 300_000, [['fun', 'E_fun', 100_000]])));
show('E3 дефицит, запас 0', build(mk('Def', 0, 200_000, [['food', 'E_base', 150_000], ['fun', 'E_fun', 100_000]])));
show('E4 крупные суммы ×1000 (доход 400 млн/мес)', build({ ...B, incomes: B.incomes.map((i) => ({ ...i, amount: 400_000_000, sched: 400_000_000 })), expenses: B.expenses.map((e) => ({ ...e, amount: (e.amount as number) * 1000 })) }));
show('E4b очень малые суммы (доход 4 000/мес)', build({ ...B, incomes: B.incomes.map((i) => ({ ...i, amount: 4_000, sched: 4_000 })), expenses: B.expenses.map((e) => ({ ...e, amount: (e.amount as number) / 100 })) }));
// валюта: перевод 3 млн ₸ с копилки на долларовый счёт (+6000 USD)
{
  const s = build(B);
  const data = s.imported!;
  const usd = acc('usd', 'Доллары', { currency: 'USD' });
  const s2 = { ...s, imported: { ...data, accounts: [...data.accounts, usd], operations: [...data.operations, trf('2026-10-28', 'save', 'usd', 3_000_000, 6_000)].sort((a, b) => (a.date < b.date ? -1 : 1)) }, settings: { ...s.settings, accounts: [...s.settings.accounts, { ...s.settings.accounts[1]!, accountId: 'usd' }] } };
  show('E5 B до покупки долларов', s);
  show('E5 B после перевода 3 млн ₸ → 6000 USD', s2);
}
// ручной пассивный доход: в истории уже есть проценты (I_interest), человек добавил тот же доход вручную
{
  const sp = { ...B, incomes: [...B.incomes, { id: 'int', title: 'Проценты', cls: 'I_interest' as const, day: 28, amount: 50_000, kind: 'stable' as const, sched: 0 }] };
  const s = build(sp);
  const sNoSched = { ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.filter((x: any) => x.id !== 'int') } };
  show('E6 проценты 50 тыс. в истории', sNoSched);
  show('E6 + тот же доход вручную (passive)', applyProbeOpts(sNoSched, { manualIncome: [{ id: 'm1', title: 'Проценты', amount: 50_000, passive: true }] }));
  const ended = applyProbeOpts(build(B), { manualIncome: [{ id: 'm2', title: 'Аренда (закончилась)', amount: 300_000, passive: true }] });
  ended.settings.incomeSchedule = ended.settings.incomeSchedule.map((x: any) => (x.id === 'm2' ? { ...x, end: '2025-01-31' } : x));
  show('E7 B без ручного дохода', build(B));
  show('E7 B + ручной пассивный 300 тыс., закончился в 2025', ended);
}
