/** Экран «Первые шаги»: что настроено, что нет, и кнопка прямо к нужному месту. */
import { setupProgress, setupSteps } from '../../engine/index';
import { h, section } from '../dom';
import { getState, today } from '../store';
import { href } from '../ui';

export function setupDone(): boolean {
  const p = setupProgress(setupSteps(getState(), today()));
  return p.done === p.total;
}

/** Баннер для «Обзора»: пока обязательные шаги не сделаны. */
export function setupBanner(): HTMLElement | null {
  const steps = setupSteps(getState(), today());
  const p = setupProgress(steps);
  if (p.done === p.total) return null;
  const next = steps.find((s) => !s.done && !s.optional)!;
  return h(
    'a',
    { class: 'setup-banner', href: '#/setup' },
    h('div', null, h('strong', null, `Настройка: ${p.done} из ${p.total}`), h('div', { class: 'muted' }, `Дальше: ${next.title}. Пока шаги не пройдены, цифры ниже неточны.`)),
    h('div', { class: 'bar' }, h('span', { style: `width:${Math.round((p.done / p.total) * 100)}%` })),
  );
}

export function renderSetup(): HTMLElement {
  const steps = setupSteps(getState(), today());
  const p = setupProgress(steps);
  const nextId = steps.find((s) => !s.done && !s.optional)?.id;
  return h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'card' },
      h('strong', null, p.done === p.total ? 'Всё настроено' : `Сделано ${p.done} из ${p.total} обязательных шагов`),
      h('div', { class: 'bar', style: 'margin-top:8px' }, h('span', { style: `width:${Math.round((p.done / p.total) * 100)}%` })),
      h('p', { class: 'muted', style: 'margin-top:8px' }, 'Порядок важен: каждый шаг даёт данные следующему. Кнопка ведёт прямо к нужному месту; вернуться сюда — «Первые шаги» в меню.'),
    ),
    section(
      'Шаги',
      h(
        'ol',
        { class: 'steps' },
        steps.map((s) =>
          h(
            'li',
            { class: `step${s.done ? ' done' : ''}${s.id === nextId ? ' next' : ''}` },
            h('span', { class: 'step-mark', 'aria-hidden': 'true' }, s.done ? '✓' : ''),
            h(
              'div',
              { class: 'step-body' },
              h('div', null, h('strong', null, s.title), s.optional ? h('span', { class: 'badge' }, 'по желанию') : null),
              h('div', { class: 'muted' }, s.status),
              s.done ? null : h('p', { class: 'step-why' }, s.why),
              s.done ? null : h('a', { class: `btn small${s.id === nextId ? ' primary' : ''}`, href: href(s.action.route, s.action.section) }, s.action.label),
            ),
          ),
        ),
      ),
    ),
  );
}
