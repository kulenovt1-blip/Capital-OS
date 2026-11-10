import { positionViewOf } from '../../../engine/position/view';
import { computeIndicators } from '../../../engine/position/indicators';
import { reserveNow } from '../../../engine/reserve';
import { buildOverview } from '../../../engine/overview';
import { build, SPECS2, TODAY, applyProbeOpts } from '../../../tests/support/position-profiles';
import { acc, trf } from '../../../tests/support/build';
const f = (x: any, d = 1) => (x === null || x === undefined ? '—' : typeof x === 'number' ? x.toFixed(d) : x);
function show(label: string, s: any) {
  const v = positionViewOf(s, TODAY); const rep = computeIndicators(s, TODAY); const rv = reserveNow(s, TODAY); const o = buildOverview(s, TODAY);
  console.log(`${label}: ур=${v.level} «${v.levelName}» G=${f(v.g)} N=${f(v.directions[0]?.score)} N3=${f(rep.values.N3)} incM=${f(rep.inputs?.incomeMonthly, 0)} капитал=${f(o.capital.net / 100, 0)} запасНеобх=${f(v.money.reserveEssentialMonths)} cover=${rv?.coverMonths} limits=${v.limitsFired.map((x) => x.id)}`);
}
const B = SPECS2[1]!;
const s = build(B);
const data = s.imported!;
const usd = acc('usd', 'Доллары', { currency: 'USD' });
const s2 = { ...s, imported: { ...data, accounts: [...data.accounts, usd], operations: [...data.operations, trf('2026-10-28', 'save', 'usd', 1_500_000, 3_000)].sort((a, b) => (a.date < b.date ? -1 : 1)) }, settings: { ...s.settings, accounts: [...s.settings.accounts, { ...s.settings.accounts[1]!, accountId: 'usd' }] } };
show('B до', s);
show('B после перевода 1,5 млн ₸ на долларовый счёт (+3000 USD)', s2);
const C = build(SPECS2[2]!);
show('C С долгами', C);
const C2 = applyProbeOpts(C, { manualIncome: [{ id: 'm2', title: 'Аренда (закончилась)', amount: 150_000, passive: true }] });
C2.settings.incomeSchedule = C2.settings.incomeSchedule.map((x: any) => (x.id === 'm2' ? { ...x, end: '2025-01-31' } : x));
show('C + ручной пассивный 150 тыс., закончился 31.01.2025', C2);
const C3 = applyProbeOpts(C, { manualIncome: [{ id: 'm3', title: 'Аренда с 2030', amount: 150_000, passive: true }] });
C3.settings.incomeSchedule = C3.settings.incomeSchedule.map((x: any) => (x.id === 'm3' ? { ...x, start: '2030-01-01' } : x));
show('C + ручной пассивный 150 тыс., начнётся в 2030', C3);
