import { expect, test } from 'bun:test';
import { dataAccuracy, essentialMarkupMissing, setupSteps, buildOverview } from '../../engine/index';
import { STATES } from '../../scripts/ui-states';

// Случай из бэкапа мамы: разметка есть, настройка пройдена, но за 6 месяцев нет трат — нули не должны выглядеть как «не размечено»
test('пустая история: точность низкая, а «разметить» не требуется', () => {
  const st = STATES['configured']!();
  const today = '2031-01-01' as never; // далеко после операций: окно из 6 месяцев пустое
  const o = buildOverview(st, today);
  expect(o.baseline.median).toBe(0);
  expect(essentialMarkupMissing(o)).toBe(false);
  const a = dataAccuracy(st, today, o);
  expect(a.level).toBe('low');
  expect(a.filledMonths).toBe(0);
  expect(a.facts.some((f) => !f.ok && f.fix)).toBe(true);
});

test('цель с правилом суммы не считается «без суммы»', () => {
  const st = STATES['configured']!();
  const g = st.goals.find((x) => x.targetRule);
  if (!g) return;
  const steps = setupSteps({ ...st, goals: st.goals.map((x) => (x === g ? { ...x, targetMin: 0 as never } : x)) }, '2026-11-11' as never);
  expect(steps.find((s) => s.id === 'goals')!.status).not.toContain('без суммы');
});
