import { expect, test } from 'vitest';
import { dataAccuracy, essentialMarkupMissing, setupSteps, buildOverview } from '../../engine/index';
import { SPECS2, build, TODAY } from '../support/position-profiles';

const configured = () => build(SPECS2[1]!); // «B Работающий»: полная история, есть доходы и расходы

// Случай из бэкапа мамы: разметка есть, настройка пройдена, но за 6 месяцев нет трат — нули не должны выглядеть как «не размечено»
test('пустая история: точность низкая, а «разметить» не требуется', () => {
  const st = configured();
  const today = '2031-01-01' as never; // далеко после операций: окно из 6 месяцев пустое
  void TODAY;
  const o = buildOverview(st, today);
  expect(o.baseline.median).toBe(0);
  expect(essentialMarkupMissing(o)).toBe(false);
  const a = dataAccuracy(st, today, o);
  expect(a.level).toBe('low');
  expect(a.filledMonths).toBe(0);
  expect(a.facts.some((f) => !f.ok && f.fix)).toBe(true);
});

test('цель с правилом суммы не считается «без суммы»', () => {
  const st = configured();
  const g = st.goals.find((x) => x.targetRule);
  if (!g) return;
  const steps = setupSteps({ ...st, goals: st.goals.map((x) => (x === g ? { ...x, targetMin: 0 as never } : x)) }, '2026-11-11' as never);
  expect(steps.find((s) => s.id === 'goals')!.status).not.toContain('без суммы');
});

// «Начал вести вчера»: полных месяцев нет, записи за последние дни есть — «обычно» оценивается по ним, а не нулём, с пометкой
test('холодный старт: обычные траты по последним дням, точность низкая', () => {
  const st = configured();
  const ops = st.imported!.operations;
  const last = ops.map((x) => x.date).sort().at(-1)!;
  const month = last.slice(0, 7);
  // записи только текущего месяца, 14 дней подряд: полных месяцев нет, свежих записей достаточно
  const spend = ops.filter((x) => x.kind === 'expense');
  const recent = Array.from({ length: 14 }, (_, i) => ({ ...spend[i % spend.length]!, id: `cold-${i}`, date: `${month}-${String(i + 1).padStart(2, '0')}` }));
  const short = { ...st, imported: { ...st.imported!, operations: recent } };
  const today = `${month}-14` as never;
  const o = buildOverview(short, today);
  expect(o.baseline.partialDays).toBeGreaterThanOrEqual(7);
  expect(o.baseline.median).toBeGreaterThan(0);
  expect(dataAccuracy(short, today, o).level).toBe('low');
  // с историей числа не меняются
  expect(buildOverview(st, last as never).baseline.partialDays).toBeUndefined();
});
