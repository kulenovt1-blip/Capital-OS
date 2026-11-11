/** Блок «Точность расчётов» (аудит UX): сколько данных стоит за цифрами и что сделать, чтобы стало лучше. */
import { dataAccuracy, type Accuracy } from '../engine/index';
import { h } from './dom';
import { ov } from './ctx';
import { getState, today } from './store';

export const accuracyNow = (): Accuracy => dataAccuracy(getState(), today(), ov());

const FILLED: Record<string, number> = { low: 1, mid: 2, good: 3 };

/** Шкала из трёх делений: заполнено 1 / 2 / 3 — смысл не держится на одном цвете. */
export function meter(level: string): HTMLElement {
  const n = FILLED[level] ?? 0;
  return h('span', { class: 'acc-meter', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('i', { class: i < n ? 'on' : '' })));
}

/** Панель «Точность расчётов» внутри окна доверия к цифрам: оценка со шкалой, фраза и причины с действиями. */
export function accuracyPanel(): HTMLElement | null {
  const a = accuracyNow();
  if (a.level === 'none') return null;
  return h(
    'section',
    { class: `acc acc-${a.level} stack`, 'aria-label': `Точность расчётов: ${a.label}` },
    h('div', { class: 'acc-head' }, h('div', { class: 'acc-title' }, 'Точность расчётов'), h('div', { class: 'acc-grade' }, meter(a.level), h('strong', null, a.label))),
    h('p', { class: 'acc-meaning' }, a.meaning),
    h(
      'ul',
      { class: 'acc-facts' },
      ...a.facts.map((f) =>
        h('li', { class: f.ok ? 'ok' : 'no' }, h('span', { class: 'acc-mark', 'aria-hidden': 'true' }, f.ok ? '✓' : '!'), h('div', null, h('div', null, f.text), f.fix ? h('a', { href: f.fix.href }, `${f.fix.text} ›`) : null)),
      ),
    ),
  );
}
