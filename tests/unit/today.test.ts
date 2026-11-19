/**
 * «Сегодня» простого режима (дизайн A+, D7, app/today.ts): фраза под числом, один следующий шаг, пометка у платежа.
 * Тексты не должны обещать больше, чем знает движок: «с запасом» — только при остатке, «деньги есть» — только до дохода.
 */
import { describe, it, expect } from 'vitest';
import { dayMonth, paymentCover, todayLine, todayStep, type TodayStepInput } from '../../app/today';

const none: TodayStepInput = { firstRunDone: true, arrived: null, cushionPin: null, road: null };

describe('сегодня: фраза под главным числом', () => {
  it('с остатком — «с запасом», до даты дохода', () => {
    expect(todayLine(330_000, { date: '2026-12-05', scheduled: true })).toBe('Если так и дальше, денег хватит до 5 декабря с запасом');
  });
  it('ровно ноль — без запаса, а не «с запасом»', () => {
    expect(todayLine(0, { date: '2026-12-05', scheduled: true })).toBe('Денег хватит до 5 декабря, но без запаса');
  });
  it('нехватка — фразы нет: экран показывает блок «Не хватает…»', () => {
    expect(todayLine(-1, { date: '2026-12-05', scheduled: true })).toBeNull();
  });
  it('доход не задан в расписании — «на 30 дней», а не выдуманная дата', () => {
    expect(todayLine(10, { date: '2026-12-18', scheduled: false })).toBe('Если так и дальше, денег хватит на 30 дней с запасом');
  });
  it('дата — день и месяц словами, без ведущего нуля', () => {
    expect(dayMonth('2026-03-01')).toBe('1 марта');
    expect(dayMonth('2026-12-31')).toBe('31 декабря');
  });
});

describe('сегодня: один следующий шаг', () => {
  it('нечего предложить — шага нет, блок не рисуется', () => {
    expect(todayStep(none)).toBeNull();
  });
  it('порядок: вопросы → пришли деньги → подушка → дорога', () => {
    const all: TodayStepInput = { firstRunDone: false, arrived: { amount: '+300 тыс ₸', title: 'Зарплата', more: 0 }, cushionPin: '120 тыс ₸', road: 'Довести запас до 3 месяцев' };
    expect(todayStep(all)!.key).toBe('first-run');
    expect(todayStep({ ...all, firstRunDone: true })!.key).toBe('arrived');
    expect(todayStep({ ...all, firstRunDone: true, arrived: null })!.key).toBe('cushion');
    expect(todayStep({ ...all, firstRunDone: true, arrived: null, cushionPin: null })!.key).toBe('road');
  });
  it('у каждого шага есть кнопка и адрес, по которому приложение умеет открыть экран', () => {
    expect(todayStep({ ...none, firstRunDone: false })).toMatchObject({ button: 'Ответить', href: '#/start' });
    expect(todayStep({ ...none, arrived: { amount: '+300 тыс ₸', title: 'Зарплата', more: 2 } })).toMatchObject({ title: 'Пришли деньги: Зарплата +300 тыс ₸ · ещё 2', button: 'Распределить', href: '#/income' });
    expect(todayStep({ ...none, cushionPin: '120 тыс ₸' })).toMatchObject({ title: 'Закрепить 120 тыс ₸ за подушкой', href: '#/goals~cushion-fill' });
    expect(todayStep({ ...none, road: 'Поднять общую оценку до 40' })).toMatchObject({ title: 'Поднять общую оценку до 40', href: '#/position' });
  });
});

describe('сегодня: пометка у ближайшего платежа', () => {
  it('платёж до дохода и деньги есть — «покрыт»', () => {
    expect(paymentCover('2026-12-03', '2026-12-05', 1)).toBe('covered');
    expect(paymentCover('2026-12-05', '2026-12-05', 0)).toBe('covered');
  });
  it('платёж до дохода, а денег не хватает — «не хватает», а не молчание', () => {
    expect(paymentCover('2026-12-03', '2026-12-05', -1)).toBe('short');
  });
  it('платёж после дохода — без пометки: из главного числа он не вычтен', () => {
    expect(paymentCover('2026-12-10', '2026-12-05', 500_000)).toBeNull();
  });
});
