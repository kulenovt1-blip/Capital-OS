// @ts-nocheck
import { STATES, TODAY } from '../../../scripts/ui-states';
import { positionViewOf } from '../../../engine/position/view';
import { buildOverview } from '../../../engine/overview';
for (const n of ['broken', 'configured', 'imported']) {
  const s = STATES[n](); const v = positionViewOf(s, TODAY); const o = buildOverview(s, TODAY);
  const rec = (o as any).reconcile ?? (o as any).reconciliation;
  console.log(n, 'ур', v.level, v.levelName, 'достоверность', v.confidence.toFixed(2), 'prelim', v.preliminary, 'сверка', JSON.stringify(rec?.accounts?.map((a: any) => [a.title, a.status]) ?? Object.keys(o)));
}
