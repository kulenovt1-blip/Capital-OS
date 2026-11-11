import { expect, test } from 'vitest';
import { positionViewOf } from '../../engine/position/view';
import { SPECS2, build, TODAY } from '../support/position-profiles';
import { makeInstallment } from '../../engine/obligations';
import { tenge } from '../../engine/money';
import type { AppState } from '../../engine/state';

const base = (): AppState => build(SPECS2[1]!);
const flat = { id: 'flat', title: 'Квартира', balance: 2_000_000_00, balanceDate: TODAY, liquidity: { kind: 'instant' }, comment: '', assetKind: 'non_investable' } as never;

test('нет закрытых активов — строки «Жильё» нет', () => {
  expect(positionViewOf(base(), TODAY as never).housing).toBeNull();
});

test('жильё без ипотеки: стоимость = доля; ступень та же, что без жилья', () => {
  const st = base();
  const without = positionViewOf(st, TODAY as never);
  const v = positionViewOf({ ...st, manualAccounts: [...st.manualAccounts, flat] }, TODAY as never);
  expect(v.housing).toMatchObject({ assets: 2_000_000, debt: 0, equity: 2_000_000, items: 1, linked: 0 });
  expect(v.level).toBe(without.level);
});

test('жильё с привязанной ипотекой: доля = стоимость − остаток', () => {
  const st0 = base();
  const ob = makeInstallment({ id: 'mort', title: 'Ипотека', owner: 'self', remaining: tenge(1_500_000), remainingAsOf: TODAY as never, payment: tenge(50_000), firstDate: '2026-12-01' as never });
  const st = { ...st0, obligations: [...st0.obligations, ob] };
  const v = positionViewOf({ ...st, manualAccounts: [...st.manualAccounts, { ...flat, loanId: ob.id }] }, TODAY as never);
  expect(v.housing!.linked).toBe(1);
  expect(v.housing!.debt).toBeGreaterThan(1_000_000);
  expect(v.housing!.equity).toBeCloseTo(2_000_000 - v.housing!.debt);
});
