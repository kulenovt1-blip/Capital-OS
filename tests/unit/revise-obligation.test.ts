import { expect, test } from 'vitest';
import { makeInstallment, makeRecurring, reviseObligation, tenge } from '../../engine/index';

const inst = () => makeInstallment({ id: 'o1', title: 'Телефон', owner: 'self', remaining: tenge(300_000), remainingAsOf: '2026-11-01' as never, payment: tenge(50_000), firstDate: '2026-12-01' as never, match: { tags: ['телефон'] } });

test('без чисел меняются название, «чья», привязка; график цел', () => {
  const o = inst();
  const r = reviseObligation(o, { title: 'Айфон', owner: 'family', match: undefined });
  expect(r.title).toBe('Айфон');
  expect(r.owner).toBe('family');
  expect(r.match).toBeUndefined();
  expect(r.schedule).toEqual(o.schedule);
  expect(r.remaining).toBe(o.remaining);
});

test('с числами график пересчитан от новой даты и остатка, id и вид сохранены', () => {
  const o = inst();
  const r = reviseObligation(o, { title: o.title, owner: 'self', match: o.match, numbers: { remaining: tenge(100_000), payment: tenge(40_000), firstDate: '2027-01-05' as never, months: 1, asOf: '2026-11-11' as never } });
  expect(r.id).toBe('o1');
  expect(r.kind).toBe('installment');
  expect(r.remaining).toBe(tenge(100_000));
  expect(r.remainingAsOf).toBe('2026-11-11');
  expect(r.schedule.map((e) => e.amount)).toEqual([tenge(40_000), tenge(40_000), tenge(20_000)]);
  expect(r.schedule[0]!.date).toBe('2027-01-05');
});

test('регулярный платёж: сумма и число месяцев', () => {
  const o = makeRecurring({ id: 'r1', title: 'Кружок', owner: 'self', amount: tenge(10_000), firstDate: '2026-12-01' as never, months: 3 });
  const r = reviseObligation(o, { title: 'Кружок', owner: 'self', numbers: { remaining: tenge(0), payment: tenge(12_000), firstDate: '2026-12-01' as never, months: 5, asOf: '2026-11-11' as never } });
  expect(r.kind).toBe('recurring');
  expect(r.schedule).toHaveLength(5);
  expect(r.schedule[0]!.amount).toBe(tenge(12_000));
});
