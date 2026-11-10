/** Переименование долга и рассрочки (решение владельца 10.11, D150): меняется только название. */
import { describe, it, expect } from 'vitest';
import { makeInstallment, renameObligation, OBLIGATION_TITLE_MAX } from '../../engine/obligations';
import { tenge } from '../../engine/money';

const ob = () => makeInstallment({ id: 'ob1', title: 'Дом 6 658', owner: 'self', remaining: tenge(40_000), remainingAsOf: '2026-11-04', payment: tenge(6_658), firstDate: '2026-12-04' });

describe('renameObligation', () => {
  it('меняет только название, пробелы по краям убираются', () => {
    const o = ob();
    const r = renameObligation(o, '  Духи  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ ...o, title: 'Духи' });
  });
  it('пустое и слишком длинное название — ошибка, исходник не меняется', () => {
    const o = ob();
    const before = JSON.stringify(o);
    expect(renameObligation(o, '   ').ok).toBe(false);
    expect(renameObligation(o, 'я'.repeat(OBLIGATION_TITLE_MAX + 1)).ok).toBe(false);
    expect(JSON.stringify(o)).toBe(before);
  });
  it('то же название — без изменений', () => {
    const o = ob();
    const r = renameObligation(o, 'Дом 6 658');
    expect(r.ok && r.value).toEqual(o);
  });
});
