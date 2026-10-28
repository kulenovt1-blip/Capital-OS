/**
 * «Как посчитано» в подэкране (D76): каждое число на экране воспроизводимо из объяснения движка.
 * Экран регистрирует источник объяснения, строка «Как посчитано ›» открывает его поверх экрана.
 */
import type { Explanation } from '../engine/index';
import { h } from './dom';
import { defineSheet, sheetHref } from './main';

const providers = new Map<string, { title: string; get: () => Explanation }>();

export function registerExplain(key: string, title: string, get: () => Explanation): void {
  providers.set(key, { title, get });
}

/** Главные шаги — списком; второстепенные (нули, перечни, исключения) — под «Все шаги». */
export function explainList(e: Explanation): HTMLElement {
  const main = e.filter((s) => !s.detail);
  const li = (s: Explanation[number]) => h('li', { class: s.level ?? 'info' }, s.text);
  return h(
    'div',
    { class: 'card' },
    h('ul', { class: 'explain-list' }, (main.length ? main : e).map(li)),
    main.length && main.length < e.length ? h('details', { class: 'explain-more', 'data-key': 'explain:all' }, h('summary', null, `Все шаги (${e.length})`), h('ul', { class: 'explain-list' }, e.map(li))) : null,
  );
}

/** Строка-ссылка «Как посчитано ›». */
export function explainLink(key: string, label = 'Как посчитано'): HTMLElement {
  return h('a', { class: 'btn link', href: sheetHref('explain', key) }, `${label} ›`);
}

defineSheet('explain', (arg) => {
  const p = providers.get(arg);
  if (!p) return null;
  return { title: p.title, body: explainList(p.get()) };
});
