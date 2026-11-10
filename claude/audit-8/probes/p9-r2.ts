import { computeIndicators } from '../../../engine/position/indicators';
import { build, randomSpec, randomSpecDyn, stressCase, applyProbeOpts, TODAY } from '../../../tests/support/position-profiles';
const states = [
  ...Array.from({ length: 400 }, (_, i) => build(randomSpec(i + 1))),
  ...Array.from({ length: 400 }, (_, i) => build(randomSpecDyn(i + 1))),
  ...Array.from({ length: 320 }, (_, i) => { const c = stressCase(i); return applyProbeOpts(c.state, c.opts); }),
];
for (const D of [12, 18, 24, 36, Infinity]) {
  const xs: number[] = [], ys: number[] = [];
  for (const s of states) { const v = computeIndicators(s, TODAY, undefined, { v1CapMonths: D }).values; if (typeof v.N2 === 'number' && typeof v.V1 === 'number') { xs.push(v.N2); ys.push(v.V1); } }
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; syy += (ys[i]! - my) ** 2; }
  console.log(`D=${D}: n=${n} R²(N2,V1)=${((sxy * sxy) / (sxx * syy)).toFixed(3)}`);
}
