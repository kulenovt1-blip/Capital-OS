/** Блок «Точность расчётов» (аудит UX): сколько данных стоит за цифрами и что сделать, чтобы стало лучше. */
import { dataAccuracy, type Accuracy } from '../engine/index';
import { h } from './dom';
import { ov } from './ctx';
import { getState, today } from './store';

export const accuracyNow = (): Accuracy => dataAccuracy(getState(), today(), ov());

const FILLED: Record<string, number> = { low: 1, mid: 2, good: 3 };

/** Шкала из трёх делений: заполнено 1 / 2 / 3 — смысл не держится на одном цвете. */
function meter(level: string): HTMLElement {
  const n = FILLED[level] ?? 0;
  return h('span', { class: 'acc-meter', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('i', { class: i < n ? 'on' : '' })));
}

/** Карточка «Точность расчётов»: крупная оценка со шкалой, одна фраза, причины раскрываются. */
export function accuracyBlock(): HTMLElement | null {
  const a = accuracyNow();
  if (a.level === 'none') return null;
  const head = h(
    'div',
    { class: 'acc-head' },
    h('div', { class: 'acc-title' }, 'Точность расчётов'),
    h('div', { class: 'acc-grade' }, meter(a.level), h('strong', null, a.label)),
  );
  const why = a.level === 'good' ? null : h(
    'details',
    { class: 'fold acc-why', 'data-key': 'accuracy:why' },
    h('summary', null, 'Почему и что исправить'),
    h(
      'ul',
      { class: 'acc-facts' },
      ...a.facts.map((f) =>
        h('li', { class: f.ok ? 'ok' : 'no' }, h('span', { class: 'acc-mark', 'aria-hidden': 'true' }, f.ok ? '✓' : '!'), h('div', null, h('div', null, f.text), f.fix ? h('a', { href: f.fix.href }, `${f.fix.text} ›`) : null)),
      ),
    ),
  );
  return h('section', { class: `card stack acc acc-${a.level}`, 'aria-label': `Точность расчётов: ${a.label}` }, head, h('p', { class: 'acc-meaning' }, a.meaning), why);
}

/** Одна строка для «Обзора»: только когда точность не хорошая, ведёт на «Профиль». */
export function accuracyChip(): HTMLElement | null {
  const a = accuracyNow();
  if (a.level === 'none' || a.level === 'good') return null;
  return h('a', { class: `acc-chip acc-${a.level}`, href: '#/position' }, h('span', null, 'Точность расчётов'), meter(a.level), h('strong', null, a.label), h('span', { class: 'chev' }, '›'));
}
