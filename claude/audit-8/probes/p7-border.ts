import { positionViewOf } from '../../../engine/position/view';
import { computeIndicators } from '../../../engine/position/indicators';
import { build, SPECS2, TODAY, randomSpec, randomSpecDyn, stressCase, applyProbeOpts, probeProfiles } from '../../../tests/support/position-profiles';
const B = SPECS2[1]!;
// подбираем стартовый капитал так, чтобы запас был около 6 мес. необходимых
const base = computeIndicators(build(B), TODAY).inputs!;
console.log('B: необходимые', base.needEssential, 'запас', base.reserveEssentialMonths.toFixed(3), 'netLiquid', base.netLiquid);
for (const add of [-30_000, -10_000, -2_000, 2_000, 10_000]) {
  const target = 6 * base.needEssential - base.netLiquid + add;
  const s = build({ ...B, opening: Math.max(0, Math.round(target)) });
  const v = positionViewOf(s, TODAY);
  console.log(`opening=${Math.round(target)}: запас=${v.money.reserveEssentialMonths.toFixed(3)} ур=${v.level} «${v.levelName}» G=${v.g?.toFixed(2)} onBorder=[${v.onBorder}] held=${v.held ?? '-'}`);
}
// V3: применим ли хоть где-то
let v3 = 0, n = 0;
for (const p of probeProfiles()) { const r = computeIndicators(applyProbeOpts(p.state, p.opts), TODAY); n++; if ('V3' in r.values) v3++; }
for (let i = 1; i <= 400; i++) { for (const s of [build(randomSpec(i)), build(randomSpecDyn(i))]) { n++; if ('V3' in computeIndicators(s, TODAY).values) v3++; } }
console.log(`V3 применим в ${v3} из ${n} профилей`);
