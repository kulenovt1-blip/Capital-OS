/** «Ещё → Вид»: тема и размер текста (D76). */
import { h } from '../dom';
import { seg, sub } from '../ui';
import { fontPref, setFont, setTheme, themePref, type ThemePref } from '../theme';

export function renderView(rerender: () => void): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    sub('Тема'),
    seg<ThemePref>([['auto', 'Как в телефоне'], ['light', 'Светлая'], ['dark', 'Тёмная']], themePref(), (v) => (setTheme(v), rerender()), 'Тема'),
    sub('Размер текста'),
    seg<'0' | '1'>([['0', 'Обычный'], ['1', 'Крупный']], fontPref(), (v) => (setFont(v), rerender()), 'Размер текста'),
    h('p', { class: 'one-line' }, 'Кнопки и поля от размера текста не становятся меньше.'),
  );
}
