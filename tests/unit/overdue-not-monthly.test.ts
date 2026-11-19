/**
 * D213: просроченный платёж — разовая задолженность («деньги нужны сейчас»), а не постоянная ежемесячная нагрузка.
 * Раньше при устаревшем бэкапе каждый прошедший срок прибавлял ещё один платёж к «платежу в месяц»: через 5 месяцев 160 тыс. вместо 60 тыс.
 * Ожидания — арифметика: платёж по графику 60 тыс. в месяц ⇒ в месяц 60 тыс., сколько бы сроков ни прошло.
 */
import { describe, it, expect } from 'vitest';
import { buildOverview } from '../../engine/overview';
import { computeIndicators } from '../../engine/position/indicators';
import { addDays } from '../../engine/date';
import { build, mk, TODAY } from '../support/position-profiles';

const st = () => build(mk('Рассрочка', 900_000, 400_000, [['food', 'E_base', 100_000], ['rent', 'E_base', 80_000], ['fun', 'E_fun', 50_000], ['inst', 'E_installment_own', 60_000]], { remaining: 600_000, payment: 60_000 }));
const monthly = (s: ReturnType<typeof st>, days: number) => buildOverview(s, addDays(TODAY, days)).spend.obligationsMonthly / 100;

describe('просроченные платежи и «платёж в месяц»', () => {
  it('прошло 20, 60, 150 дней без обновления бэкапа — в месяц по-прежнему 60 тыс.', () => {
    const s = st();
    for (const d of [0, 20, 60, 150]) expect(monthly(s, d), `+${d} дн`).toBe(60_000);
  });
  it('просроченные платежи при этом видны как просроченные и остаются в долге', () => {
    const s = st();
    const o = buildOverview(s, addDays(TODAY, 60));
    expect(o.obligations.flatMap((x) => x.entries).filter((e) => e.status === 'overdue').length).toBeGreaterThanOrEqual(2);
    expect(o.upcoming30.some((u) => u.date === addDays(TODAY, 60))).toBe(true); // деньги на просроченное нужны сейчас
  });
  it('N3 не падает только оттого, что прошли сроки: без новых данных он не хуже, чем в день бэкапа', () => {
    const s = st();
    const base = computeIndicators(s, TODAY).values.N3!;
    for (const d of [20, 60, 150]) expect(computeIndicators(s, addDays(TODAY, d)).values.N3!, `+${d} дн`).toBeCloseTo(base, 6);
  });
  it('опция overdueAsMonthly возвращает прежний счёт (для сверки с пробой)', () => {
    const s = st();
    const old = computeIndicators(s, addDays(TODAY, 60), undefined, { overdueAsMonthly: true }).inputs!.obligationsMonthly;
    expect(old).toBeGreaterThan(60_000);
  });
});
