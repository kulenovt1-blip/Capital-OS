/**
 * Окно-карусель поверх экрана (D190): «Что нового» и «Что умеет». Как в банковских приложениях — слайд со значком,
 * точки, «Далее»; листается пальцем. Никуда не уводит: где найти функцию — подсказка внутри слайда.
 * Живёт вне #app, поэтому перерисовка экрана его не закрывает; кнопка «назад» телефона закрывает окно.
 */
import { h } from './dom';
import { CAPABILITIES, LATEST_RELEASE, shouldShowWhatsNew, type Slide } from './whatsnew-data';
import { iconSvg } from './icons';
import { getHealth, getState, update } from './store';
import { modeTour, noteWhatsNewShown } from './tours';

export { iconSvg };

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
  noteWhatsNewShown();
  setTimeout(openWhatsNew, 350);
  mark();
}
