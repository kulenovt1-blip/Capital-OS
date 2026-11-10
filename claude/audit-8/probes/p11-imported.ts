// @ts-nocheck
import { STATES, TODAY } from '../../../scripts/ui-states';
import { positionViewOf } from '../../../engine/position/view';
import { computeIndicators } from '../../../engine/position/indicators';
import { reserveNow } from '../../../engine/reserve';
for (const n of ['imported', 'configured']) {
  const s = STATES[n](); const v = positionViewOf(s, TODAY); const r = computeIndicators(s, TODAY);
  console.log(`\n${n}: ур.${v.level} ${v.levelName} G=${v.g?.toFixed(1)} held=${v.held} limits=${v.limitsFired.map((x) => x.text)} essentialMissing=${v.essentialMissing}`);
  console.log(' dirs', v.directions.map((d) => `${d.name}=${d.score?.toFixed(1)}`).join(' '), 'vals', JSON.stringify(Object.fromEntries(Object.entries(r.values).map(([k, x]) => [k, x === null ? null : +x.toFixed(0)]))));
  const i = r.inputs; console.log(' needE', i.needEssential, 'needL', i.needLifestyle, 'netLiq', i.netLiquid, 'запасE', i.reserveEssentialMonths.toFixed(2), 'норма', i.savingRate?.toFixed(2), 'incM', i.incomeMonthly, 'cover', reserveNow(s, TODAY)?.coverMonths, 'range', v.range && `${v.range.low.toFixed(0)}-${v.range.high.toFixed(0)}`, 'sched', s.settings.incomeSchedule.length);
}
