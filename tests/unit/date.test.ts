import { describe, it, expect } from 'vitest';
import {
  isIsoDate, addDays, addMonths, daysBetween, monthKey, monthsBetween, compareDates, startOfMonth, endOfMonth, daysInMonth,
  withDay, fullMonthsBefore, formatDateRu, maxDate, minDate, nextDayOfMonth,
} from '../../engine/date';

describe('date', () => {
  it('валидирует ISO-даты', () => {
    expect(isIsoDate('2026-10-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
    expect(isIsoDate('2026-10-28T00:00')).toBe(false);
  });

  it('добавляет дни через границы месяцев и лет', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('добавляет месяцы с прижатием к концу месяца', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('считает разницы', () => {
    expect(daysBetween('2026-10-28', '2026-11-05')).toBe(8);
    expect(daysBetween('2026-11-05', '2026-10-28')).toBe(-8);
    expect(monthsBetween('2026-10-28', '2027-09-01')).toBe(11);
    expect(monthsBetween('2026-10-01', '2026-10-31')).toBe(0);
    expect(monthsBetween('2027-09-01', '2026-10-28')).toBe(-11);
  });

  it('месяцы', () => {
    expect(monthKey('2026-10-28')).toBe('2026-10');
    expect(startOfMonth('2026-10-28')).toBe('2026-10-01');
    expect(endOfMonth('2026-02-03')).toBe('2026-02-28');
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(withDay('2026-02-10', 31)).toBe('2026-02-28');
    expect(fullMonthsBefore('2026-10-28', 3)).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('сравнение и формат', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-02')).toBe(0);
    expect(maxDate('2026-01-01', '2026-03-01')).toBe('2026-03-01');
    expect(minDate('2026-01-01', '2026-03-01')).toBe('2026-01-01');
    expect(formatDateRu('2026-11-05')).toBe('05.11.2026');
  });

  it('ближайшая дата с днём месяца', () => {
    expect(nextDayOfMonth('2026-10-28', 5)).toBe('2026-11-05');
    expect(nextDayOfMonth('2026-10-28', 28)).toBe('2026-10-28');
    expect(nextDayOfMonth('2026-01-31', 31)).toBe('2026-01-31');
    expect(nextDayOfMonth('2026-02-01', 31)).toBe('2026-02-28');
  });

  it('бросает на кривых датах', () => {
    expect(() => addDays('2026-13-01', 1)).toThrow();
  });
});
