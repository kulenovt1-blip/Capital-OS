/** К2 (D155): счёт не в тенге входит в капитал по курсу, введённому человеком; без курса — не входит и помечен. */
import { describe, it, expect } from 'vitest';
import { computeCapital } from '../../engine/ledger';
import { tenge } from '../../engine/money';
import { acc, dataset, inc, trf } from '../support/build';

const TODAY = '2026-10-28';
const data = dataset({
  accounts: [acc('kzt', 'Карта'), acc('usd', 'Доллары', { currency: 'USD' })],
  operations: [inc('2026-09-01', 'kzt', 2_000_000, null), trf('2026-09-10', 'kzt', 'usd', 1_500_000, 3000)],
});
const input = (extra = {}) => ({ data, classified: [], accountSettings: [], manualAccounts: [], adjustments: [], obligations: [], today: TODAY, ...extra });

describe('валютный счёт', () => {
  it('без курса: счёт не входит в капитал и помечен, а не обнуляет остальное молча', () => {
    const r = computeCapital(input());
    expect(r.gross).toBe(tenge(500_000));
    expect(r.unrated).toEqual([{ accountId: 'usd', title: 'Доллары', currency: 'USD' }]);
  });
  it('с курсом 500 ₸: 3000 USD = 1 500 000 ₸, капитал возвращается к 2 000 000', () => {
    const r = computeCapital(input({ currencyRates: { USD: 500 } }));
    expect(r.gross).toBe(tenge(2_000_000));
    expect(r.unrated).toEqual([]);
  });
});
