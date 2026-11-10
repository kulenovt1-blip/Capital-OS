/**
 * «Жильё / заблокировано» — это капитал, но не деньги (решение владельца 10.11, D149): такой актив не входит в «На руках»,
 * «Деньги, которые можно потратить», запас в месяцах и прогноз денег — при любом сроке снятия, в том числе «Сразу».
 */
import { describe, it, expect } from 'vitest';
import { build, SPECS2, TODAY } from '../support/position-profiles';
import { positionViewOf } from '../../engine/position/view';
import { buildOverview } from '../../engine/overview';
import { buildSimInput } from '../../engine/plan';
import { baseForecast } from '../../engine/simple';
import { tenge } from '../../engine/money';
import type { AppState } from '../../engine/state';
import { lockedByDate } from '../../engine/simple';
import { NEVER_AVAILABLE } from '../../engine/ledger';

const base = (): AppState => build(SPECS2[1]!);
const withAsset = (s: AppState, extra: Record<string, unknown>): AppState => ({
  ...s,
  manualAccounts: [...s.manualAccounts, { id: 'man-x', title: 'Квартира', balance: tenge(30_000_000), balanceDate: TODAY, liquidity: { kind: 'instant' as const }, comment: '', ...extra }],
});

describe('жильё со сроком «Сразу» не деньги', () => {
  const s0 = base();
  const home = withAsset(s0, { assetKind: 'non_investable' });
  const v0 = positionViewOf(s0, TODAY);
  const v1 = positionViewOf(home, TODAY);

  it('капитал вырос ровно на стоимость', () => {
    expect(v1.money.total - v0.money.total).toBe(30_000_000);
  });
  it('«Деньги, которые можно потратить», «на руках» и запас в месяцах не изменились', () => {
    expect(v1.money.spendable).toBe(v0.money.spendable);
    expect(v1.money.instant).toBe(v0.money.instant);
    expect(v1.money.reserveEssentialMonths).toBe(v0.money.reserveEssentialMonths);
    expect(v1.money.reserveLifestyleMonths).toBe(v0.money.reserveLifestyleMonths);
  });
  it('почти весь капитал недоступен', () => {
    expect(v1.money.blockedShare).toBeGreaterThan(0.9);
  });
  it('«На руках» в обзоре и деньги в прогнозе те же; в капитале актив есть', () => {
    const o0 = buildOverview(s0, TODAY).capital;
    const o1 = buildOverview(home, TODAY).capital;
    expect(o1.liquidNow).toBe(o0.liquidNow);
    expect(o1.net - o0.net).toBe(tenge(30_000_000));
    expect(buildSimInput(home, TODAY).input.cash).toBe(buildSimInput(s0, TODAY).input.cash);
    const f0 = baseForecast(s0, TODAY, 12);
    const f1 = baseForecast(home, TODAY, 12);
    expect(f1.months[6]!.liquidEnd).toBe(f0.months[6]!.liquidEnd);
  });
  it('контроль: такой же актив с ответом «деньги» и сроком «Сразу» — деньги', () => {
    const v = positionViewOf(withAsset(s0, {}), TODAY);
    expect(v.money.spendable - v0.money.spendable).toBe(30_000_000);
  });
  it('независимость от жилья не зависит так же, как раньше (K не меняется)', () => {
    expect(v1.independence.capital).toBe(v0.independence.capital);
  });
  it('в «пока не снять» по датам жильё не попадает (даты у него нет)', () => {
    expect(lockedByDate([{ balance: tenge(30_000_000), availableFrom: NEVER_AVAILABLE }, { balance: tenge(10_000), availableFrom: '2027-01-05' }])).toEqual([{ date: '2027-01-05', amount: tenge(10_000) }]);
  });
});
