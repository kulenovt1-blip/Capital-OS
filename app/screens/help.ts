/**
 * «Как пользоваться» (D94, сокращено в D186): что умеет приложение карточками, пять коротких задач, словарь.
 * Построено по задачам человека, а не по функциям; словарь — те же тексты, что в кнопках ⓘ (один источник).
 * Длинные объяснения живут в «Как посчитано» у самих чисел и в кнопках ⓘ — здесь их не повторяем.
 */
import { h } from '../dom';
import { HELP } from '../help-text';
import { row, rows, sub } from '../ui';
import { HOW_TO } from '../tours';
import { openCapabilities } from '../whatsnew';
import { iconSvg } from '../icons';
import { CAPABILITIES } from '../whatsnew-data';

const SEEN_KEY = 'capital-os.help-seen';

/** Видел ли человек справку (для подсказки «Впервые здесь?» на «Обзоре»). Хранилище браузера может быть недоступно — тогда считаем, что видел. */
export function helpSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markHelpSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* не страшно: подсказка просто покажется ещё раз */
  }
}

export function renderHelp(): HTMLElement {
  markHelpSeen();
  const key = (t: string) => t.replace(/[«»]/g, '');
  const terms = Object.values(HELP).sort((a, b) => key(a.title).localeCompare(key(b.title), 'ru'));
  return h(
    'div',
    { class: 'screen help' },
    h('p', { class: 'help-lead' }, 'Учёт — в MoneyManager, выводы — здесь. Данные не покидают телефон.'),
    sub('Что умеет'),
    // плитки открывают окно-карусель на нужном слайде — экран не меняется (D190)
    h('div', { class: 'cap-grid' }, CAPABILITIES.map((c, k) => h('button', { class: 'cap-tile', type: 'button', onclick: () => openCapabilities(k + 1) }, h('span', { class: 'ci' }, iconSvg(c.icon)), h('strong', null, c.title)))),
    // инструкции — подсказками поверх настоящих экранов, а не текстом по шагам (D193)
    sub('Покажу на экране'),
    rows(...HOW_TO.map((t) => row({ title: t.title, sub: `${t.steps} ${t.steps < 5 ? 'шага' : 'шагов'}`, lead: h('span', { class: 'play', 'aria-hidden': 'true' }, iconSvg('play', 16)), onClick: () => void t.run() }))),
    h(
      'details',
      { class: 'fold', 'data-key': 'help:dictionary' },
      h('summary', null, `Словарь — что значат слова (${terms.length})`),
      h('div', { class: 'stack tight' }, terms.map((t) => h('details', { class: 'fold', 'data-key': `help:term:${t.title}` }, h('summary', null, t.title), h('p', null, t.text)))),
    ),
  );
}
