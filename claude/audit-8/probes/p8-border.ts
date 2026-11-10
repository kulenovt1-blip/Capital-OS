import { positionViewOf } from '../../../engine/position/view';
import { computeIndicators } from '../../../engine/position/indicators';
import { reserveNow } from '../../../engine/reserve';
import { build, mk, TODAY } from '../../../tests/support/position-profiles';
const spec = (o: number) => mk('X', o, 600_000, [['food', 'E_base', 150_000], ['rent', 'E_base', 150_000], ['fun', 'E_fun', 290_000]]);
const i0 = computeIndicators(build(spec(0)), TODAY).inputs!;
for (const months of [2.99, 3.0, 5.99, 6.0]) {
  const o = Math.round(months * i0.needEssential - i0.netLiquid);
  const s = build(spec(o));
  const v = positionViewOf(s, TODAY);
  console.log(`запас=${v.money.reserveEssentialMonths.toFixed(3)} (Обзор: ${reserveNow(s, TODAY)!.coverMonths} мес.) → ур.${v.level} «${v.levelName}» G=${v.g?.toFixed(2)} onBorder=[${v.onBorder}] held=${v.held ?? '-'} next=${JSON.stringify(v.next?.needs ?? null)}`);
}
