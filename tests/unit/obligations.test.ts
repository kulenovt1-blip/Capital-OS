import { describe, it, expect } from 'vitest';
import { generateInstallmentSchedule, makeInstallment, makeRecurring, obligationStatus, upcomingPayments, validateObligation } from '../../engine/obligations';
import { tenge, tiyn, sum } from '../../engine/money';
import { acc, cat, dataset, exp } from '../support/build';

describe('график рассрочки', () => {
  it('генерирует ежемесячные платежи, последний — остаток', () => {
    const s = generateInstallmentSchedule({ remaining: tenge(100_000), payment: tenge(30_285), firstDate: '2026-11-05' });
    expect(s.map((e) => e.date)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05', '2027-02-05']);
    expect(s.map((e) => e.amount)).toEqual([3028500, 3028500, 3028500, 914500]);
    expect(sum(s.map((e) => e.amount))).toBe(tenge(100_000));
  });

  it('31-е число прижимается к концу месяца', () => {
    const s = generateInstallmentSchedule({ remaining: tenge(3), payment: tenge(1), firstDate: '2027-01-31' });
    expect(s.map((e) => e.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('отклоняет нулевой платёж', () => {
    expect(() => generateInstallmentSchedule({ remaining: tenge(10), payment: tiyn(0), firstDate: '2026-11-05' })).toThrow();
  });
});

describe('сопоставление платежей с графиком', () => {
  const ob = makeInstallment({
    id: 'ob-phone',
    title: 'Телефон',
    owner: 'self',
    remaining: tenge(90_855),
    remainingAsOf: '2026-09-30',
    payment: tenge(30_285),
    firstDate: '2026-10-05',
    match: { tags: ['телефон'] },
  });
  const tags = [{ id: 'tg-phone', name: 'Телефон' }];
  const data = dataset({
    accounts: [acc('a')],
    categories: [cat('inst', 'Рассрочка')],
    tags,
    operations: [
      exp('2026-09-05', 'a', 30_285, 'inst', ['tg-phone']), // до remainingAsOf — уже учтён в остатке
      exp('2026-10-07', 'a', 30_285, 'inst', ['tg-phone']), // в окне ±15 дней от 05.10
      exp('2026-10-20', 'a', 1_000, 'inst', []), // без тега — не наш
    ],
  });

  it('платёж в окне закрывает строку графика; остаток уменьшается', () => {
    const st = obligationStatus(ob, data, '2026-10-28', { matchWindowDays: 15 });
    expect(st.payments.map((p) => p.date)).toEqual(['2026-10-07']);
    expect(st.entries.map((e) => e.status)).toEqual(['paid', 'upcoming', 'upcoming']);
    expect(st.remainingNow).toBe(tenge(60_570));
    expect(st.nextDue).toEqual({ date: '2026-11-05', amount: tenge(30_285) });
  });

  it('пропущенный платёж становится просроченным', () => {
    const st = obligationStatus(ob, data, '2026-11-25', { matchWindowDays: 15 });
    expect(st.entries.map((e) => e.status)).toEqual(['paid', 'overdue', 'upcoming']);
    expect(st.explanation.some((s) => s.code === 'obligation.overdue')).toBe(true);
  });

  it('досрочный платёж вне графика уменьшает остаток и сокращает будущие платежи', () => {
    const d2 = dataset({
      accounts: [acc('a')],
      tags,
      operations: [exp('2026-10-05', 'a', 30_285, null, ['tg-phone']), exp('2026-10-15', 'a', 40_000, null, ['tg-phone'])],
    });
    const st = obligationStatus(ob, d2, '2026-10-28', { matchWindowDays: 15 });
    expect(st.payments.map((p) => p.entryIndex)).toEqual([0, null]);
    expect(st.remainingNow).toBe(tenge(20_570));
    const up = upcomingPayments([st], '2026-10-28', '2027-12-31');
    expect(up.map((u) => [u.date, u.amount])).toEqual([['2026-11-05', tenge(20_570)]]);
  });

  it('ручная привязка перекрывает автоматическую', () => {
    const op = data.operations[2]!;
    const st = obligationStatus(ob, data, '2026-10-28', { matchWindowDays: 15, manualMatches: { [op.id]: 'ob-phone' } });
    expect(st.payments.map((p) => p.opId)).toContain(op.id);
    const other = obligationStatus({ ...ob, id: 'ob-other' }, data, '2026-10-28', { matchWindowDays: 15, manualMatches: { [data.operations[1]!.id]: 'ob-phone' } });
    expect(other.payments.map((p) => p.opId)).not.toContain(data.operations[1]!.id);
  });

  it('переплата не уводит остаток в минус и даёт предупреждение', () => {
    const d3 = dataset({ accounts: [acc('a')], tags, operations: [exp('2026-10-05', 'a', 100_000, null, ['tg-phone'])] });
    const st = obligationStatus(ob, d3, '2026-10-28', { matchWindowDays: 15 });
    expect(st.remainingNow).toBe(0);
    expect(st.explanation.some((s) => s.code === 'obligation.overpaid')).toBe(true);
  });
});

describe('регулярные платежи и список ближайших', () => {
  it('recurring не имеет остатка, но даёт платежи в горизонте', () => {
    const r = makeRecurring({ id: 'rent', title: 'Аренда', owner: 'self', amount: tenge(80_000), firstDate: '2027-09-10', months: 12 });
    expect(r.remaining).toBe(0);
    const st = obligationStatus(r, dataset({ accounts: [] , operations: [] }), '2027-09-01', { matchWindowDays: 15 });
    const up = upcomingPayments([st], '2027-09-01', '2027-11-30');
    expect(up.map((u) => u.date)).toEqual(['2027-09-10', '2027-10-10', '2027-11-10']);
  });

  it('валидация', () => {
    const bad = makeInstallment({ id: 'x', title: '', owner: 'self', remaining: tenge(10), remainingAsOf: '2026-10-01', payment: tenge(5), firstDate: '2026-10-05' });
    expect(validateObligation(bad)).toContain('Нужно название');
    expect(validateObligation({ ...bad, title: 'ok', schedule: [] })).toContain('Пустой график');
  });
});
