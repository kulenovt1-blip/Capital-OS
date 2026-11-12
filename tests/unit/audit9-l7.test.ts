import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseState, positionViewOf } from '../../engine/index';

const demo = parseState(readFileSync(new URL('../../public/demo.json', import.meta.url), 'utf8'));
if (!demo.ok) throw new Error('demo.json');

describe('D177 (L7): «Капитал» не слабое место при запасе от 3 месяцев', () => {
  it('на демо запас больше 3 месяцев — показатель слабого места не «Капитал»', () => {
    const v = positionViewOf(demo.value, '2026-11-04');
    expect(v.status).toBe('ok');
    expect(v.money!.reserveEssentialMonths).toBeGreaterThanOrEqual(3);
    expect(v.weak?.indicator?.id).not.toBe('N4');
  });
});
