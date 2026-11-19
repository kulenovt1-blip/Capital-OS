/**
 * «На примере»: пять выдуманных людей, на которых видно, как выглядит каждая ступень (docs/DECISIONS D201).
 * Пример живёт в отдельном хранилище; собственные данные не читаются и не пишутся, выход возвращает их как были.
 */
import { h } from '../dom';
import { enterDemo, exitDemo, getDemo, getState } from '../store';
import { LEVEL_NAMES, PERSONAS } from '../personas';
import { sub } from '../ui';

export function renderExamples(): HTMLElement {
  const cur = getDemo();
  const hasOwn = !cur && !!getState().imported;
  return h(
    'div',
    { class: 'screen' },
    h('p', { class: 'one-line' }, hasOwn ? 'Пять выдуманных людей. Твои данные не тронем: пример живёт отдельно, выйти можно одним нажатием.' : 'Пять выдуманных людей — по одному на каждую ступень. Можно открыть любого и посмотреть, как выглядит приложение.'),
    sub('Выбери человека'),
    h(
      'div',
      { class: 'stack' },
      PERSONAS.map((p) =>
        h(
          'div',
          { class: `card persona-card${cur?.id === p.id ? ' on' : ''}` },
          h('div', { class: 'pc-head' }, h('strong', null, p.name), h('span', { class: 'pc-level' }, `Ступень ${p.level} · ${LEVEL_NAMES[p.level]}`)),
          h('p', { class: 'muted', style: 'margin:6px 0 12px' }, p.line),
          h('button', { class: 'btn wide', type: 'button', onclick: () => enterDemo(p.id) }, cur?.id === p.id ? 'Открыто сейчас — открыть заново' : `Открыть: ${p.name}`),
        ),
      ),
    ),
    cur ? h('button', { class: 'btn link wide', type: 'button', onclick: () => exitDemo() }, 'Выйти из примера') : null,
  );
}

/** Плашка сверху в режиме примера: кто открыт и как выйти (одно нажатие, в том числе сразу к загрузке своих данных). */
export function demoBanner(): HTMLElement | null {
  const d = getDemo();
  if (!d) return null;
  return h(
    'div',
    { class: 'demo-banner', role: 'status' },
    h('span', null, h('strong', null, `Пример: ${d.name}`), ' — выдуманные данные. Твои не тронуты.'),
    h('button', { class: 'btn', type: 'button', onclick: () => exitDemo() }, 'Выйти'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => exitDemo(true) }, 'Загрузить мои данные'),
  );
}
