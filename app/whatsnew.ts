/**
 * Окно-карусель поверх экрана (D190): «Что нового» и «Что умеет». Как в банковских приложениях — слайд со значком,
 * точки, «Далее»; листается пальцем. Никуда не уводит: где найти функцию — подсказка внутри слайда.
 * Живёт вне #app, поэтому перерисовка экрана его не закрывает; кнопка «назад» телефона закрывает окно.
 */
import { h } from './dom';
import { CAPABILITIES, LATEST_RELEASE, shouldShowWhatsNew, type IconKey, type Slide } from './whatsnew-data';
import { getHealth, getState, update } from './store';
import { modeTour } from './tours';

const ICONS: Record<IconKey, string> = {
  spark: 'M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2zM19 3v4M17 5h4',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM3 7l12-4v4M17 13.5h.01',
  arrive: 'M12 3v10M8 9l4 4 4-4M4 16c0 2.2 3.6 4 8 4s8-1.8 8-4',
  target: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11a1 1 0 1 0 1 1M14 10l6-6M17 4h3v3',
  chart: 'M4 19h16M5 15l4-5 4 3 6-8',
  profile: 'M12 4 20 18H4zM12 10l4 6H8z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3',
  layers: 'M12 3 21 8l-9 5-9-5zM3 13l9 5 9-5',
  share: 'M18 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4',
};

export function iconSvg(key: IconKey): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[key]);
  for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) p.setAttribute(k, v);
  svg.appendChild(p);
  return svg;
}

let openNow: (() => void) | null = null;

/** Открыть карусель. `start` — с какого слайда, `title` — для чтения с экрана. */
export function openSlides(slides: Slide[], opts: { start?: number; title: string; finish?: string }): void {
  if (openNow || !slides.length) return;
  let i = Math.min(Math.max(opts.start ?? 0, 0), slides.length - 1);
  // eslint-disable-next-line prefer-const
  let close: () => void = () => undefined;
  const last = () => i === slides.length - 1;

  const track = h('div', { class: 'm-track' }, slides.map((s, k) =>
    h(
      'div',
      { class: 'm-slide', 'aria-hidden': k === i ? 'false' : 'true' },
      h('div', { class: 'm-hero' }, h('div', { class: 'm-icon' }, iconSvg(s.icon))),
      h(
        'div',
        { class: 'm-body' },
        s.badge ? h('span', { class: 'm-badge' }, s.badge) : null,
        h('div', { class: 'm-title' }, s.title),
        h('p', { class: 'm-text' }, s.text),
        s.where ? h('div', { class: 'm-where' }, h('span', { class: 'm-pin', 'aria-hidden': 'true' }, '⌖'), h('span', null, s.where)) : null,
        // показать на настоящем экране: окно закрывается, подсказка начинается после того, как «назад» отработал
        s.tour === 'mode' ? h('button', { class: 'm-show', type: 'button', onclick: () => (close(), setTimeout(() => void modeTour(), 320)) }, '▶ Показать на экране') : null,
      ),
    ),
  ));
  const dots = h('div', { class: 'm-dots', 'aria-hidden': 'true' }, slides.map(() => h('span')));
  const counter = h('span', { class: 'visually-hidden', 'aria-live': 'polite' });
  const next = h('button', { class: 'btn primary', type: 'button' });
  const skip = h('button', { class: 'btn link', type: 'button' }, 'Пропустить');

  const show = () => {
    track.style.transform = `translateX(${-i * 100}%)`;
    [...track.children].forEach((c, k) => c.setAttribute('aria-hidden', k === i ? 'false' : 'true'));
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    next.textContent = last() ? (opts.finish ?? 'Понятно') : 'Далее';
    skip.style.display = last() || slides.length === 1 ? 'none' : '';
    counter.textContent = `${i + 1} из ${slides.length}: ${slides[i]!.title}`;
  };
  const go = (d: number) => {
    const j = i + d;
    if (j < 0 || j >= slides.length) return;
    i = j;
    show();
  };

  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title }, h('button', { class: 'm-close', type: 'button', 'aria-label': 'Закрыть' }, '×'), h('div', { class: 'm-view' }, track), h('div', { class: 'm-foot' }, dots, h('div', { class: 'm-btns' }, skip, next)), counter);
  const back = h('div', { class: 'modal-back' }, modal);

  let pushed = false;
  const remove = () => {
    if (!openNow) return;
    openNow = null;
    window.removeEventListener('popstate', onPop);
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('modal-open');
    back.classList.add('closing');
    setTimeout(() => back.remove(), 180);
  };
  close = () => {
    if (pushed) history.back(); // закроется в onPop
    else remove();
  };
  const onPop = () => remove();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };

  next.addEventListener('click', () => (last() ? close() : go(1)));
  skip.addEventListener('click', close);
  modal.querySelector('.m-close')!.addEventListener('click', close);
  back.addEventListener('click', (e) => e.target === back && close());
  // листание пальцем
  let x0: number | null = null;
  track.addEventListener('touchstart', (e) => (x0 = e.touches[0]?.clientX ?? null), { passive: true });
  track.addEventListener('touchend', (e) => {
    const x1 = e.changedTouches[0]?.clientX;
    if (x0 !== null && x1 !== undefined && Math.abs(x1 - x0) > 40) go(x1 < x0 ? 1 : -1);
    x0 = null;
  });

  document.body.appendChild(back);
  document.body.classList.add('modal-open');
  try {
    history.pushState({ capitalModal: true }, '');
    pushed = true;
  } catch {
    /* без истории — закрываем кнопками */
  }
  window.addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey);
  openNow = close;
  show();
  next.focus({ preventScroll: true });
}

export const openWhatsNew = (): void => openSlides(LATEST_RELEASE.slides, { title: 'Что нового' });
export const openCapabilities = (start = 0): void =>
  openSlides([{ icon: 'spark', badge: 'Capital OS', title: 'Что умеет приложение', text: 'Помощник к MoneyManager: учёт ведёшь там, а здесь видишь, что с деньгами дальше. Шесть главных вещей — листай.' }, ...CAPABILITIES], { start, title: 'Что умеет приложение' });

let tried = false;
/** При запуске: если вышло обновление, один раз показать «Что нового». Отметка ставится сразу — повторно окно не всплывёт. */
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
  setTimeout(openWhatsNew, 350);
  mark();
}
