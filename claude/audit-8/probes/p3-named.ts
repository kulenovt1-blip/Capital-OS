import { computeIndicators } from '../../../engine/position/indicators';
import { levelFromIndicators } from '../../../engine/position/level';
import { positionViewOf } from '../../../engine/position/view';
import { namedProfiles, applyProbeOpts, TODAY } from '../../../tests/support/position-profiles';
const f = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(1));
console.log('профиль | V(D=∞) G(D=∞) ур | V(D=24) G(D=24) ур(очки) ур(факт) | экран: ур, название');
for (const p of namedProfiles()) {
  const s = applyProbeOpts(p.state, p.opts);
  const a = levelFromIndicators(computeIndicators(s, TODAY, undefined, { v1CapMonths: Infinity }))!;
  const b = levelFromIndicators(computeIndicators(s, TODAY))!;
  const v = positionViewOf(s, TODAY);
  console.log(`${p.name} | ${f(a.directions.V.score)} ${f(a.g)} ${a.result.held?.byScore ?? a.result.level} | ${f(b.directions.V.score)} ${f(b.g)} ${b.result.held?.byScore ?? b.result.level} ${b.result.level} | ${v.level} «${v.levelName}» held=${v.held ?? '-'}`);
}
