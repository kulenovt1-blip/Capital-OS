import { computeIndicators } from '../../../engine/position/indicators';
import { levelFromIndicators } from '../../../engine/position/level';
import { positionViewOf } from '../../../engine/position/view';
import { independenceProfiles, TODAY } from '../../../tests/support/position-profiles';
const f = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : x.toFixed(d));
for (const p of independenceProfiles()) {
  const s = p.state;
  const a = levelFromIndicators(computeIndicators(s, TODAY, undefined, { v1CapMonths: Infinity }))!;
  const rb = computeIndicators(s, TODAY);
  const b = levelFromIndicators(rb)!;
  const v = positionViewOf(s, TODAY);
  const ind = v.independence;
  console.log(`${p.name} ${p.title} | D=∞: V ${f(a.directions.V.score)} G ${f(a.g)} V1 ${f(computeIndicators(s, TODAY, undefined, { v1CapMonths: Infinity }).values.V1 as number)} | D=24: V ${f(b.directions.V.score)} G ${f(b.g)} V1 ${f(rb.values.V1 as number)} | экран ур.${v.level} ${v.levelName} | C+P ${f(ind.total.central, 3)}/${f(ind.total.conservative, 3)} status ${ind.status} blockers ${ind.blockers} missing ${ind.missing} | запас ${f(v.money.reserveEssentialMonths)}`);
}
