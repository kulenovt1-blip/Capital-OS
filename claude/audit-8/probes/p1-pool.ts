import { computeIndicators } from '../../../engine/position/indicators';
import { levelFromIndicators } from '../../../engine/position/level';
import { positionViewOf } from '../../../engine/position/view';
import { reserveNow } from '../../../engine/reserve';
import { build, namedProfiles, randomSpec, randomSpecDyn, stressCase, applyProbeOpts, TODAY, independenceProfiles } from '../../../tests/support/position-profiles';

const pool: { name: string; s: any }[] = [
  ...Array.from({ length: 400 }, (_, i) => ({ name: `R${i + 1}`, s: build(randomSpec(i + 1)) })),
  ...Array.from({ length: 400 }, (_, i) => ({ name: `D${i + 1}`, s: build(randomSpecDyn(i + 1)) })),
  ...Array.from({ length: 320 }, (_, i) => { const c = stressCase(i); return { name: c.name, s: applyProbeOpts(c.state, c.opts) }; }),
  ...namedProfiles().map((p) => ({ name: p.name, s: applyProbeOpts(p.state, p.opts) })),
  ...independenceProfiles().map((p) => ({ name: p.name, s: p.state })),
];
const c = { lvl1_reserve3: [] as string[], lvl1_saveNonNeg: [] as string[], lvl2_reserve3: [] as string[], lvl2_reserve6: [] as string[], l5_res_lt3: [] as string[], l5_res_lt6: [] as string[],
  coverDisagree3: [] as string[], coverDisagree6: [] as string[], nextPtsWithLimit: [] as string[], nextNull: [] as string[], lvl3_noNext: [] as string[] };
const dist = [0, 0, 0, 0, 0, 0];
const ex: Record<string, any> = {};
for (const { name, s } of pool) {
  const v = positionViewOf(s, TODAY);
  if (v.status !== 'ok' || v.level === null) { dist[0]++; continue; }
  dist[v.level]++;
  const r = v.money.reserveEssentialMonths;
  const rep = computeIndicators(s, TODAY);
  const sr = rep.inputs!.savingRate;
  const rv = reserveNow(s, TODAY);
  const cover = rv?.coverMonths ?? NaN;
  const tag = `${name} (ур.${v.level}, G=${v.g?.toFixed(1)}, запас.необх=${r.toFixed(2)}, cover=${cover}, норма=${sr === null ? 'null' : sr.toFixed(2)})`;
  if (v.level === 1 && r >= 3) c.lvl1_reserve3.push(tag);
  if (v.level === 1 && sr !== null && sr >= 0) c.lvl1_saveNonNeg.push(tag);
  if (v.level === 2 && r >= 3) c.lvl2_reserve3.push(tag);
  if (v.level === 2 && r >= 6) c.lvl2_reserve6.push(tag);
  if (v.level === 5 && r < 3) c.l5_res_lt3.push(tag);
  if (v.level === 5 && r < 6) c.l5_res_lt6.push(tag);
  if ((cover >= 3) !== (r >= 3)) c.coverDisagree3.push(tag);
  if ((cover >= 6) !== (r >= 6)) c.coverDisagree6.push(tag);
  if (v.next && v.limitsFired.length && v.next.needs.some((n) => n.includes('очк'))) c.nextPtsWithLimit.push(tag + ' огр=' + v.limitsFired.map((x) => x.id) + ' next=' + v.next.needs.join(' | '));
  if (v.level === 3 && !v.next && v.basis === 'score') c.lvl3_noNext.push(tag + ' огр=' + v.limitsFired.map((x) => x.id) + ' l4Unconf=' + v.l4Unconfirmed);
}
console.log('профилей', pool.length, 'распределение [нет,1,2,3,4,5]', dist);
for (const [k, arr] of Object.entries(c)) { console.log(`\n== ${k}: ${arr.length}`); for (const x of arr.slice(0, 5)) console.log('  ', x); }
