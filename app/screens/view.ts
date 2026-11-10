/** «Ещё → Вид»: размер текста (D76). */
import { h } from '../dom';
import { seg, sub } from '../ui';
import { fontPref, setFont } from '../theme';

export function renderView(rerender: () => void): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    sub('Размер текста'),
    seg<'0' | '1'>([['0', 'Обычный'], ['1', 'Крупный']], fontPref(), (v) => (setFont(v), rerender()), 'Размер текста'),
    h('p', { class: 'one-line' }, 'Кнопки и поля от размера текста не становятся меньше.'),
  );
}
