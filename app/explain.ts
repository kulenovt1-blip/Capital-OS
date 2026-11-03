/**
 * «Как посчитано» в подэкране (D76): каждое число на экране воспроизводимо из объяснения движка.
 * Экран регистрирует источник объяснения, строка «Как посчитано ›» открывает его поверх экрана.
 */
import { formatKZT, type Explanation } from '../engine/index';
import { h } from './dom';
import { defineSheet, sheetHref } from './main';

const providers = new Map<string, { title: string; get: () => Explanation; render?: () => HTMLElement }>();

/**
 * Источник «Как посчитано». `render` — свой вид (цепочка «из чего сложилось число», D93);
 * без него — список шагов движка.
 */
export function registerExplain(key: string, title: string, get: () => Explanation, render?: () => HTMLElement): void {
  providers.set(key, { title, get, ...(render ? { render } : {}) });
}

/**
 * Шаг объяснения — строкой «название — сумма» (D100): текст до двоеточия или «=» — название,
 * остальное — мелкой подписью; сумма шага — справа. Без сплошного текста.
 */
function stepRow(s: Explanation[number]): HTMLElement {
  const t = s.text;
  const m = t.match(/^(.{2,60}?)(?::\s|\s=\s|\s—\s)(.+)$/s);
  const title = m ? m[1]! : t;
  const rest = m ? m[2]! : '';
  return h(
    'div',
    { class: `row${s.level === 'warn' || s.level === 'error' ? ' bad' : ''}` },
    h('div', { class: 'main' }, h('div', { class: 'title' }, title), rest ? h('div', { class: 'rsub' }, rest.length > 160 ? `${rest.slice(0, 157)}…` : rest) : null),
    s.amount !== undefined ? h('div', { class: 'val' }, formatKZT(s.amount)) : null,
  );
}

/** Главные шаги — строками; второстепенные (нули, перечни, исключения) — под «Все шаги». */
export function explainList(e: Explanation): HTMLElement {
  const main = e.filter((s) => !s.detail);
  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'rows' }, (main.length ? main : e).map(stepRow)),
    main.length && main.length < e.length ? h('details', { class: 'fold', 'data-key': 'explain:all' }, h('summary', null, `Все шаги (${e.length})`), h('div', { class: 'rows' }, e.map(stepRow))) : null,
  );
}

/** Строка-ссылка «Как посчитано ›». */
export function explainLink(key: string, label = 'Как посчитано'): HTMLElement {
  return h('a', { class: 'btn link', href: sheetHref('explain', key) }, `${label} ›`);
}

defineSheet('explain', (arg) => {
  const p = providers.get(arg);
  if (!p) return null;
  return { title: p.title, body: p.render ? p.render() : explainList(p.get()) };
});
