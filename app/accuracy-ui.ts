/** Блок «Точность расчётов» (аудит UX): сколько данных стоит за цифрами и что сделать, чтобы стало лучше. */
import { dataAccuracy, type Accuracy } from '../engine/index';
import { h } from './dom';
import { ov } from './ctx';
import { getState, today } from './store';

export const accuracyNow = (): Accuracy => dataAccuracy(getState(), today(), ov());

/** Полный блок с причинами — для «Профиля». Хорошая точность — тихая строка без списка. */
export function accuracyBlock(): HTMLElement | null {
  const a = accuracyNow();
  if (a.level === 'none') return null;
  const cls = `acc acc-${a.level}`;
  if (a.level === 'good') return h('div', { class: cls }, h('strong', null, 'Точность расчётов: хорошая'), h('span', { class: 'muted' }, ` · ${a.meaning}`));
  return h(
    'details',
    { class: `card ${cls}` },
    h('summary', null, h('strong', null, `Точность расчётов: ${a.label.toLowerCase()}`), h('span', { class: 'muted' }, ` — ${a.meaning}`)),
    h(
      'ul',
      { class: 'acc-facts' },
      ...a.facts.map((f) =>
        h('li', { class: f.ok ? 'ok' : 'no' }, h('span', { 'aria-hidden': 'true' }, f.ok ? '✓ ' : '✗ '), f.text, f.fix ? h('div', null, h('a', { href: f.fix.href }, `${f.fix.text} ›`)) : null),
      ),
    ),
  );
}

/** Одна строка для «Обзора»: только когда точность не хорошая, ведёт на «Профиль». */
export function accuracyChip(): HTMLElement | null {
  const a = accuracyNow();
  if (a.level === 'none' || a.level === 'good') return null;
  return h('a', { class: `acc-chip acc-${a.level}`, href: '#/position' }, `Точность расчётов: ${a.label.toLowerCase()} · почему ›`);
}
