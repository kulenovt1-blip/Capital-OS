/**
 * Проверка на здравый смысл (D219, замечание владельца 20.11.2026: «ты вообще проводил проверку на здравый смысл?»).
 * Тесты формул сверяют числа со спецификацией; эти — с тем, что увидит человек: не выглядит ли экран абсурдно.
 * Утверждения сформулированы по-человечески и проверяются на всех пяти персонажах «На примере».
 */
import { describe, it, expect } from 'vitest';
import { positionViewOf } from '../../engine/position/view';
import { buildOverview } from '../../engine/overview';
import { monthlySummary, lastFinishedMonth } from '../../engine/monthly';
import { unassignedSavings } from '../../engine/index';
import { firstStepOf, leftText, roadOf } from '../../app/road';
import { PERSONAS, PERSONA_TODAY, personaState } from '../support/personas';

const all = PERSONAS.map((p) => {
  const st = personaState(p.id);
  return { p, st, v: positionViewOf(st, PERSONA_TODAY), o: buildOverview(st, PERSONA_TODAY) };
});
const one = (id: string) => all.find((x) => x.p.id === id)!;

describe('здравый смысл: ступени персонажей', () => {
  it('у каждого персонажа ступень ровно та, что написана на его карточке', () => {
    for (const { p, v } of all) expect(v.level, p.name).toBe(p.level);
  });
  it('название ступени не противоречит фактам: «Не хватает на жизнь» — только при минусе в месяц', () => {
    for (const { p, v } of all) if (v.level === 1) expect(v.runway.status, p.name).toBe('deficit');
  });
  it('на верхней ступени нет минуса в месяц у тех, кто не живёт на капитал на 25 лет вперёд', () => {
    for (const { p, v } of all) if (v.level === 5 && !v.l5!.capitalOnly) expect(v.runway.status, p.name).not.toBe('deficit');
  });
});

describe('здравый смысл: деньги на «Обзоре»', () => {
  it('квартира — не деньги: у Алии «на счетах» и «в копилках» без квартиры, квартира — отдельной строкой', () => {
    const { o } = one('aliya');
    expect(o.spend.property).toBe(26_000_000_00);
    expect(o.spend.onHand).toBeLessThan(o.spend.property / 2);
    expect(o.spend.inSavings).toBeLessThanOrEqual(o.spend.onHand);
    expect(unassignedSavings(o)).toBeLessThan(o.spend.property);
  });
  it('«в копилках» никогда не больше «всего на счетах»', () => {
    for (const { p, o } of all) expect(o.spend.inSavings, p.name).toBeLessThanOrEqual(o.spend.onHand);
  });
  it('у человека на верхней ступени «свободно до дохода» не копеечное: не меньше трёх обычных дней трат', () => {
    for (const { p, v, o } of all) if (v.level === 5) expect(o.spend.canSpend, p.name).toBeGreaterThanOrEqual(o.spend.usualPerDay * 3);
  });
  it('доход с процентов правдоподобен: проценты в год — от 3 до 25 % денег на вкладах', () => {
    const { st, o } = one('dantal');
    const interest = st.settings.incomeSchedule.filter((i) => /процент/i.test(i.title)).reduce((a, i) => a + i.amount, 0) * 12;
    const deposits = o.capital.accounts.filter((a) => o.spend.kinds[a.accountId] === 'savings' && a.source === 'moneymanager').reduce((a, x) => a + x.balance, 0);
    expect(interest / deposits).toBeGreaterThan(0.03);
    expect(interest / deposits).toBeLessThan(0.25);
  });
  it('итоги прошлого месяца на ступенях 4–5 не в минусе, если не было крупной разовой траты', () => {
    for (const { p, st, v } of all) {
      if ((v.level ?? 0) < 4) continue;
      const m = monthlySummary(st, PERSONA_TODAY, lastFinishedMonth(PERSONA_TODAY))!;
      expect(m.left, p.name).toBeGreaterThan(0);
    }
  });
});

describe('здравый смысл: план', () => {
  it('при минусе в месяц первый шаг — выйти в плюс, а не «отложить в запас»', () => {
    for (const { p, v } of all) {
      const m = roadOf(v);
      if (!m || v.runway.status !== 'deficit') continue;
      expect(m.next.conds[0]!.kind, p.name).toBe('deficit');
      expect(firstStepOf(m)!.text, p.name).toMatch(/плюс/);
    }
  });
  it('общая оценка — не условие-галочка: среди условий плана её нет ни у кого', () => {
    for (const { p, v } of all) for (const c of roadOf(v)?.next.conds ?? []) expect(c.title, p.name).not.toMatch(/оценк/i);
  });
  it('у каждого, кроме верхней ступени, в плане есть хотя бы один невыполненный шаг', () => {
    for (const { p, v } of all) if (v.level !== null && v.level < 5) expect(firstStepOf(roadOf(v)!), p.name).not.toBeNull();
  });
  it('«что нужно для следующей ступени» не требует правила чужой ступени: «каждое направление от 60» — только по пути к ступени 4', () => {
    for (const { p, v } of all) {
      const sc = roadOf(v)?.next.score;
      if (sc?.hint?.includes('направление от 60')) expect(v.next!.level, p.name).toBe(4);
    }
  });
});

describe('здравый смысл: слова', () => {
  it('«денег хватит на 0 мес.» не говорим', () => {
    expect(leftText(0)).not.toMatch(/0 мес/);
    expect(leftText(0)).toMatch(/запаса нет/);
    expect(leftText(0.5)).toMatch(/меньше чем на месяц/);
    expect(leftText(7.4)).toBe('денег при этом хватит примерно на 7 мес.');
  });
  it('в смыслах ступеней нет внутренних слов («направление», «G», «L4»)', () => {
    for (const { p, v } of all) expect(v.levelMeaning ?? '', p.name).not.toMatch(/направлени|\bG\b|L[1-5]/);
  });
});
