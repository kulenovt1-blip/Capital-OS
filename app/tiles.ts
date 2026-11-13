/** Плитки со значком (D193): частые действия и выбор — крупно, без подписей в две строки. */
import { h, type Child } from './dom';
import { iconSvg, type Icon } from './icons';

export interface TileOpts {
  icon: Icon;
  title: string;
  sub?: Child;
  href?: string;
  onClick?: () => void;
  tour?: string;
  warn?: boolean;
}

export function tile(o: TileOpts): HTMLElement {
  const inner = [h('span', { class: `ci${o.warn ? ' warn' : ''}` }, iconSvg(o.icon)), h('div', null, h('strong', null, o.title), o.sub ? h('div', { class: 'ct-sub' }, o.sub) : null)];
  const attrs = { class: 'cap-tile', 'data-tour': o.tour };
  if (o.href) return h('a', { ...attrs, href: o.href }, ...inner);
  return h('button', { ...attrs, type: 'button', onclick: o.onClick }, ...inner);
}

export const tiles = (...items: (HTMLElement | null)[]): HTMLElement => h('div', { class: 'cap-grid' }, ...items);

/** Значок в цветном квадрате — для карточек-действий. */
export const iconBox = (icon: Icon): HTMLElement => h('span', { class: 'ibox' }, iconSvg(icon));
