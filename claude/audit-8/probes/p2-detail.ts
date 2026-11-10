import { positionViewOf } from '../../../engine/position/view';
import { computeIndicators } from '../../../engine/position/indicators';
import { reserveNow } from '../../../engine/reserve';
import { build, randomSpec, randomSpecDyn, TODAY } from '../../../tests/support/position-profiles';
const pick: Record<string, any> = { R9: build(randomSpec(9)), D382: build(randomSpecDyn(382)), R108: build(randomSpec(108)), R5: build(randomSpec(5)) };
for (const [n, s] of Object.entries(pick)) {
  const v = positionViewOf(s, TODAY);
  const rep = computeIndicators(s, TODAY);
  const rv = reserveNow(s, TODAY)!;
  console.log(`\n### ${n}: ур.${v.level} «${v.levelName}» — ${v.levelMeaning}`);
  console.log(' G', v.g?.toFixed(1), 'направления', v.directions.map((d) => `${d.name}=${d.score?.toFixed(1)}`).join(', '));
  console.log(' показатели', JSON.stringify(Object.fromEntries(Object.entries(rep.values).map(([k, x]) => [k, x === null ? null : +(x as number).toFixed(1)]))));
  const i = rep.inputs!;
  console.log(' need ess/life', i.needEssential, i.needLifestyle, 'netLiquid', i.netLiquid, 'запас необх', i.reserveEssentialMonths.toFixed(2), 'обычн', i.reserveLifestyleMonths.toFixed(2), 'норма', i.savingRate?.toFixed(3));
  console.log(' Обзор: cover', rv.coverMonths, 'liquid', rv.liquid / 100, 'need', rv.needMonthly / 100, 'surplus', rv.surplusMonthly / 100);
  console.log(' held', v.held, '| next', JSON.stringify(v.next), '| limits', v.limitsFired.map((x) => x.text), '| runway', v.runway.status, v.runway.months?.toFixed(1));
}
