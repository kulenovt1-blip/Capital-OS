import { describe, it, expect } from 'vitest';
import {
  tiyn, tenge, add, sub, sum, neg, mulDiv, applyBp, ceilTo, formatKZT, parseKZT, isMoney, ZERO, min, max, roundHalfEven, median,
} from '../../engine/money';

describe('money: базовые операции', () => {
  it('создаёт деньги только из целых тиынов', () => {
    expect(tiyn(100)).toBe(100);
    expect(() => tiyn(1.5)).toThrow();
    expect(() => tiyn(Number.NaN)).toThrow();
    expect(() => tiyn(2 ** 60)).toThrow();
  });

  it('tenge() переводит тенге в тиыны без float', () => {
    expect(tenge(30285)).toBe(3028500);
    expect(() => tenge(0.1)).toThrow();
  });

  it('складывает и вычитает', () => {
    expect(add(tiyn(10), tiyn(5))).toBe(15);
    expect(sub(tiyn(10), tiyn(15))).toBe(-5);
    expect(sum([tiyn(1), tiyn(2), tiyn(3)])).toBe(6);
    expect(sum([])).toBe(ZERO);
    expect(neg(tiyn(7))).toBe(-7);
    expect(min(tiyn(3), tiyn(-1))).toBe(-1);
    expect(max(tiyn(3), tiyn(-1))).toBe(3);
  });

  it('isMoney различает целые и дробные', () => {
    expect(isMoney(5)).toBe(true);
    expect(isMoney(5.5)).toBe(false);
    expect(isMoney('5')).toBe(false);
  });
});

describe('money: округление', () => {
  it('roundHalfEven — банковское округление', () => {
    expect(roundHalfEven(5n, 2n)).toBe(2n); // 2.5 → 2
    expect(roundHalfEven(7n, 2n)).toBe(4n); // 3.5 → 4
    expect(roundHalfEven(-5n, 2n)).toBe(-2n);
    expect(roundHalfEven(-7n, 2n)).toBe(-4n);
    expect(roundHalfEven(10n, 3n)).toBe(3n);
    expect(roundHalfEven(11n, 3n)).toBe(4n); // 3.67 → 4
    expect(roundHalfEven(5n, -2n)).toBe(-2n);
  });

  it('mulDiv точен на больших числах (без потери точности float)', () => {
    // 10 млрд ₸ * 1450 / 10000 — float дал бы погрешность
    expect(mulDiv(tiyn(1_000_000_000_000), 1450, 10000)).toBe(145_000_000_000);
    expect(mulDiv(tiyn(3), 1, 2)).toBe(2); // 1.5 → 2
    expect(mulDiv(tiyn(5), 1, 2)).toBe(2); // 2.5 → 2
    expect(() => mulDiv(tiyn(1), 1, 0)).toThrow();
  });

  it('applyBp: проценты в базисных пунктах', () => {
    // 1 000 000 ₸ под 14,5% годовых за 30 дней из 365
    expect(applyBp(tenge(1_000_000), 1450, 30, 365)).toBe(1191781); // 11 917,808... ₸ → 11 917,81 ₸
  });

  it('ceilTo округляет вверх до шага', () => {
    expect(ceilTo(tiyn(1), tenge(100))).toBe(10000);
    expect(ceilTo(tiyn(10000), tenge(100))).toBe(10000);
    expect(ceilTo(tiyn(0), tenge(100))).toBe(0);
    expect(ceilTo(tiyn(-1), tenge(100))).toBe(0);
    expect(ceilTo(tiyn(-10001), tenge(100))).toBe(-10000);
  });

  it('median: банковское округление для чётного числа', () => {
    expect(median([])).toBe(0);
    expect(median([tiyn(5)])).toBe(5);
    expect(median([tiyn(1), tiyn(10), tiyn(4)])).toBe(4);
    expect(median([tiyn(1), tiyn(2)])).toBe(2); // 1.5 → 2
    expect(median([tiyn(1), tiyn(4)])).toBe(2); // 2.5 → 2
  });
});

describe('money: формат', () => {
  const NB = ' ';
  it('форматирует KZT с неразрывными пробелами', () => {
    expect(formatKZT(tenge(30285))).toBe(`30${NB}285${NB}₸`);
    expect(formatKZT(tiyn(3028550))).toBe(`30${NB}285,50${NB}₸`);
    expect(formatKZT(tiyn(5))).toBe(`0,05${NB}₸`);
    expect(formatKZT(tiyn(-123456789))).toBe(`−1${NB}234${NB}567,89${NB}₸`);
    expect(formatKZT(ZERO)).toBe(`0${NB}₸`);
    expect(formatKZT(tenge(1_000_000), { sign: true })).toBe(`+1${NB}000${NB}000${NB}₸`);
  });

  it('parseKZT разбирает ввод пользователя', () => {
    expect(parseKZT('30 285')).toBe(3028500);
    expect(parseKZT('30 285,5')).toBe(3028550);
    expect(parseKZT('1000.25')).toBe(100025);
    expect(parseKZT('-15')).toBe(-1500);
    expect(parseKZT('  ')).toBeNull();
    expect(parseKZT('abc')).toBeNull();
    expect(parseKZT('1,234')).toBeNull(); // три знака после запятой — неоднозначно
  });
});
