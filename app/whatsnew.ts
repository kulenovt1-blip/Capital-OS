/** Окна «Что нового» и «Что умеет» (D186): короткие карточки вместо сплошного текста. */
import { h } from './dom';
import { stickyBar } from './ui';
import { LATEST_RELEASE, shouldShowWhatsNew, type InfoCard } from './whatsnew-data';
import { closeSheet, defineSheet, go, openSheet } from './main';
import { getHealth, getState, update } from './store';

/** Одна карточка: заголовок, строка пояснения, стрелка — если есть куда перейти. */
export function infoCard(c: InfoCard): HTMLElement {
  const body = [h('strong', null, c.title), h('span', { class: 'wn-text' }, c.text)];
  if (!c.href) return h('div', { class: 'wn-card' }, ...body);
  const href = c.href;
  return h('a', { class: 'wn-card', href, onclick: (e: Event) => (e.preventDefault(), go(href)) }, h('div', { class: 'wn-main' }, ...body), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
}

defineSheet('whatsnew', () => ({
  title: 'Что нового',
  body: h('div', { class: 'wn-list' }, LATEST_RELEASE.items.map((c) => infoCard(c))),
  bar: stickyBar(null, h('button', { class: 'btn primary', type: 'button', onclick: closeSheet }, 'Понятно')),
}));

let tried = false;
/** При запуске: если вышло обновление, один раз открыть «Что нового». Окно помечается показанным сразу — повторно оно не всплывёт, даже если его закрыли крестиком. */
export function maybeShowWhatsNew(): void {
  if (tried) return;
  tried = true;
  const st = getState();
  if (st.settings.whatsNewSeen === LATEST_RELEASE.id || getHealth().mode !== 'ok') return;
  const mark = () => void update((s) => ({ ...s, settings: { ...s.settings, whatsNewSeen: LATEST_RELEASE.id } }));
  // новому человеку ничего не «нового»: тихо отмечаем и не показываем
  if (!shouldShowWhatsNew(st.settings.whatsNewSeen, !!st.imported)) return mark();
  // только на обычных экранах: не перебиваем мастер настройки и открытый подэкран
  const raw = location.hash.replace(/^#\/?/, '');
  const path = raw.split('/')[0] ?? '';
  if (raw.includes('~') || !['', 'overview', 'goals', 'position', 'forecast', 'more'].includes(path)) return;
  openSheet('whatsnew');
  mark();
}
