/** Подсказка внизу экрана в простом режиме (D186): человек видит, что часть спрятана, и как вернуть. */
import { h } from './dom';
import { isSimpleMode } from '../engine/index';
import { getState } from './store';

export function simpleHint(what: string): HTMLElement | null {
  if (!isSimpleMode(getState().settings)) return null;
  return h('a', { class: 'mode-hint', href: '#/prefs' }, `Простой режим: ${what}. Показать всё ›`);
}
